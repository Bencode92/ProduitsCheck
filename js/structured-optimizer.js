// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Structured Products Optimizer v1.1
// Allocates liquidity across best proposals, shows real amounts
// Portfolio = locked (info only), Liquidity = deployable cash
// ═══════════════════════════════════════════════════════════════

let _lastStructOptResult = null;

async function loadStructOptimizerResult() {
    try { var d = await github.readFile(CONFIG.DATA_PATH + '/structured-optimizer-result.json'); if (d) _lastStructOptResult = d; } catch(e) {}
}

async function saveStructOptimizerResult(summary, analysis) {
    var result = {
        lastUpdated: new Date().toISOString(), summary: summary, version: '1.1',
        totalLiquidity: analysis.totalLiquidity,
        totalPortfolioInvested: analysis.totalPortfolioInvested,
        totalPortfolioReturn: analysis.totalPortfolioReturn,
        catBenchmark: analysis.catBenchmark,
        // Deployment plan
        deployedAmount: analysis.deployedAmount,
        deployedReturn: analysis.deployedReturn,
        deployedCatReturn: analysis.deployedCatReturn,
        deployedExcess: analysis.deployedExcess,
        remainingCash: analysis.remainingCash,
        // Counts
        portfolioCount: analysis.portfolioAnalysis.length,
        subscribeCount: analysis.allocationPlan.filter(function(a) { return a.recommendation === 'SOUSCRIRE'; }).length,
        // Details
        portfolio: analysis.portfolioAnalysis.map(function(p) {
            return { name: p.name, grade: p.grade, amount: p.amount, coupon: p.coupon,
                annualReturn: p.annualReturn, catReturn: p.catReturn, excessVsCat: p.excessVsCat };
        }),
        allocation: analysis.allocationPlan.map(function(a) {
            return { name: a.name, grade: a.grade, score: a.score, allocatedAmount: a.allocatedAmount,
                coupon: a.coupon, annualReturn: a.annualReturn, catReturn: a.catReturn, excessVsCat: a.excessVsCat,
                recommendation: a.recommendation, reason: a.reason };
        })
    };
    _lastStructOptResult = result;
    await github.writeFile(CONFIG.DATA_PATH + '/structured-optimizer-result.json', result, '[StructBoard] Structured Optimizer v1.1');
}

// ═══ MAIN ENGINE ═════════════════════════════════════════
function buildStructuredOptimization() {
    var portfolio = app.state.portfolio || [];
    var allProposals = [];
    Object.values(app.state.proposals || {}).forEach(function(arr) {
        arr.forEach(function(p) { if (p.status !== 'rejected' && p.status !== 'subscribed') allProposals.push(p); });
    });

    // CAT benchmark
    var catRate = 2.5;
    try { if (typeof _lastOptimizerResult !== 'undefined' && _lastOptimizerResult && _lastOptimizerResult.weightedRate) catRate = _lastOptimizerResult.weightedRate; } catch(e) {}

    // ─── LIQUIDITY: find cash available ───
    var liquidityProducts = portfolio.filter(function(p) {
        return (p.grading && p.grading.grade === '-') || (typeof _isLiquidityProduct === 'function' && typeof _graderNormalize === 'function' && _isLiquidityProduct(_graderNormalize(p)));
    });
    var totalLiquidity = liquidityProducts.reduce(function(s, p) { return s + (parseFloat(p.investedAmount) || 0); }, 0);

    // ─── PORTFOLIO (locked, info only) ───
    var portfolioAnalysis = portfolio.filter(function(p) {
        return !liquidityProducts.some(function(l) { return l.id === p.id; });
    }).map(function(p) {
        var g = p.grading || {};
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(p) : { coupon: 0 };
        var amount = parseFloat(p.investedAmount) || 0;
        var coupon = norm.coupon || 0;
        var annualReturn = Math.round(amount * coupon / 100);
        var catReturn = Math.round(amount * catRate / 100);
        return {
            id: p.id, name: p.name || 'Produit',
            bankName: (typeof BANKS !== 'undefined' ? (BANKS.find(function(b) { return b.id === p.bankId; }) || {}).name : '') || p.bankId || '',
            grade: g.grade || '?', score: g.score, amount: amount,
            coupon: coupon, annualReturn: annualReturn,
            catReturn: catReturn, excessVsCat: annualReturn - catReturn
        };
    });

    var totalPortfolioInvested = portfolioAnalysis.reduce(function(s, p) { return s + p.amount; }, 0);
    var totalPortfolioReturn = portfolioAnalysis.reduce(function(s, p) { return s + p.annualReturn; }, 0);

    // ─── PROPOSALS: grade + rank ───
    var gradedProposals = allProposals.filter(function(p) {
        return p.grading && p.grading.grade && p.grading.grade !== '?' && p.grading.grade !== '-';
    }).map(function(p) {
        var g = p.grading || {};
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(p) : { coupon: 0, capitalProtection: false, couponType: '' };
        return {
            id: p.id, name: p.name || 'Proposition',
            bankName: (typeof BANKS !== 'undefined' ? (BANKS.find(function(b) { return b.id === p.bankId; }) || {}).name : '') || p.bankId || '',
            grade: g.grade, score: g.score || 0,
            coupon: norm.coupon || 0, couponType: norm.couponType,
            capitalProtected: norm.capitalProtection,
            nominal: parseFloat(p.investedAmount || p.nominal) || 0
        };
    });

    // Sort by score descending (best first)
    gradedProposals.sort(function(a, b) { return b.score - a.score; });

    // ─── ALLOCATION: distribute liquidity across proposals ───
    var remaining = totalLiquidity;
    var allocationPlan = gradedProposals.map(function(p) {
        var recommendation, reason;
        // Determine recommendation based on grade
        if (p.grade === 'A' || (p.grade === 'B' && p.score >= 60)) {
            recommendation = 'SOUSCRIRE';
        } else if (p.grade === 'B') {
            recommendation = 'ENVISAGER';
        } else if (p.grade === 'C') {
            recommendation = 'ATTENDRE';
        } else {
            recommendation = 'REJETER';
        }

        // Allocate money only to SOUSCRIRE and ENVISAGER
        var allocatedAmount = 0;
        if ((recommendation === 'SOUSCRIRE' || recommendation === 'ENVISAGER') && remaining > 0) {
            // Use product nominal if specified, else take a fair share
            var targetAmount = p.nominal > 0 ? p.nominal : Math.min(remaining, 50000);
            allocatedAmount = Math.min(targetAmount, remaining);
            remaining -= allocatedAmount;
        }

        var annualReturn = Math.round(allocatedAmount * p.coupon / 100);
        var catReturn = Math.round(allocatedAmount * catRate / 100);
        var excessVsCat = annualReturn - catReturn;

        if (recommendation === 'SOUSCRIRE') {
            reason = 'Grade ' + p.grade + ' (' + p.score + '/100) \u2014 ' + formatNumber(allocatedAmount) + '\u20ac \u2192 +' + formatNumber(excessVsCat) + '\u20ac/an vs CAT';
        } else if (recommendation === 'ENVISAGER') {
            reason = 'Grade ' + p.grade + ' \u2014 n\u00e9gocier coupon ou attendre meilleure offre';
        } else if (recommendation === 'ATTENDRE') {
            reason = 'Grade ' + p.grade + ' (' + p.score + '/100) \u2014 rendement insuffisant pour le risque';
        } else {
            reason = 'Grade ' + p.grade + ' \u2014 garder en CAT';
        }

        return {
            id: p.id, name: p.name, bankName: p.bankName,
            grade: p.grade, score: p.score,
            coupon: p.coupon, couponType: p.couponType,
            capitalProtected: p.capitalProtected,
            allocatedAmount: allocatedAmount,
            annualReturn: annualReturn, catReturn: catReturn, excessVsCat: excessVsCat,
            recommendation: recommendation, reason: reason
        };
    });

    var deployedAmount = allocationPlan.reduce(function(s, a) { return s + a.allocatedAmount; }, 0);
    var deployedReturn = allocationPlan.reduce(function(s, a) { return s + a.annualReturn; }, 0);
    var deployedCatReturn = Math.round(deployedAmount * catRate / 100);

    return {
        portfolioAnalysis: portfolioAnalysis,
        allocationPlan: allocationPlan,
        liquidityProducts: liquidityProducts,
        totalLiquidity: totalLiquidity,
        totalPortfolioInvested: totalPortfolioInvested,
        totalPortfolioReturn: totalPortfolioReturn,
        catBenchmark: catRate,
        deployedAmount: deployedAmount,
        deployedReturn: deployedReturn,
        deployedCatReturn: deployedCatReturn,
        deployedExcess: deployedReturn - deployedCatReturn,
        remainingCash: remaining
    };
}

// ═══ UI — MODAL ══════════════════════════════════════════
function showStructuredOptimizer() {
    var pCount = (app.state.portfolio || []).length;
    var prCount = Object.values(app.state.proposals || {}).reduce(function(s, a) { return s + a.filter(function(p) { return !['rejected','subscribed'].includes(p.status); }).length; }, 0);
    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">' +
        '<h2 class="modal-title">\ud83d\udcca Optimiseur Structur\u00e9s v1.1</h2>' +
        '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">' +
        'Alloue la liquidit\u00e9 disponible sur les meilleures propositions. Compare le rendement r\u00e9el vs \u00ab garder en CAT \u00bb.</div>' +
        '<button class="btn ai-glow lg" style="width:100%" onclick="launchStructOptimizer()">\ud83d\udcca Optimiser (' + pCount + ' portefeuille + ' + prCount + ' propositions)</button>' +
        '<div id="struct-optimizer-results" style="margin-top:16px"></div>' +
        '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>' +
        '</div></div>';
    modal.classList.add('visible');
}

function launchStructOptimizer() {
    document.getElementById('struct-optimizer-results').innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse en cours...</div>';
    setTimeout(function() { runStructOptimizer(); }, 100);
}

async function runStructOptimizer() {
    var results = document.getElementById('struct-optimizer-results');
    if (!results) return;
    try {
        var analysis = buildStructuredOptimization();
        var html = renderStructOptimizationTable(analysis);
        html += '<div id="ai-struct-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse...</div></div>';
        results.innerHTML = html;

        var ai = await getStructOptimizerAISummary(analysis);
        var aiDiv = document.getElementById('ai-struct-summary');
        if (aiDiv) aiDiv.innerHTML = '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden"><div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">\ud83e\udd16</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandations Claude</span></div><div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">' + formatAIText(ai) + '</div></div>';

        await saveStructOptimizerResult(ai, analysis);
        showToast('Optimisation termin\u00e9e', 'success');
        var ma = document.querySelector('.modal-actions');
        if (ma) ma.innerHTML = '<button class="btn" onclick="closeModal()">Fermer</button><button class="btn primary" onclick="closeModal();app.goToDashboard();">\u2705 Dashboard</button>';
    } catch(e) {
        results.innerHTML = '<div style="color:var(--red);padding:16px">\u274c ' + e.message + '</div>';
    }
}

// ═══ TABLE ═══════════════════════════════════════════════
function renderStructOptimizationTable(analysis) {
    var a = analysis;
    var totalReturn = a.totalPortfolioReturn + a.deployedReturn;
    var totalInvested = a.totalPortfolioInvested + a.deployedAmount;
    var totalCatReturn = Math.round(totalInvested * a.catBenchmark / 100);

    // ── Summary cards ──
    var html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:12px">';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement total</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+' + formatNumber(totalReturn) + '\u20ac<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">' + formatNumber(totalInvested) + '\u20ac invest.</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Si tout en CAT</div><div style="font-size:20px;font-weight:800;color:var(--orange);font-family:var(--mono)">+' + formatNumber(totalCatReturn) + '\u20ac<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">' + a.catBenchmark.toFixed(2) + '%</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Exc\u00e9dent vs CAT</div><div style="font-size:20px;font-weight:800;color:' + (totalReturn - totalCatReturn >= 0 ? 'var(--green)' : 'var(--red)') + ';font-family:var(--mono)">' + (totalReturn - totalCatReturn >= 0 ? '+' : '') + formatNumber(totalReturn - totalCatReturn) + '\u20ac</div><div style="font-size:10px;color:var(--text-dim)">rendement suppl.</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Liquidit\u00e9 dispo</div><div style="font-size:20px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + formatNumber(a.totalLiquidity) + '\u20ac</div><div style="font-size:10px;color:var(--text-dim)">\u2192 ' + formatNumber(a.deployedAmount) + '\u20ac \u00e0 d\u00e9ployer</div></div>';
    html += '</div>';

    // ── Deployment summary bar ──
    if (a.deployedAmount > 0) {
        html += '<div style="display:flex;gap:16px;margin-bottom:12px;padding:10px 14px;background:rgba(6,214,160,0.05);border:1px solid rgba(6,214,160,0.15);border-radius:var(--radius-sm);font-size:11px;align-items:center">';
        html += '<span style="color:var(--green);font-weight:700">\u2705 Plan de d\u00e9ploiement</span>';
        html += '<span style="color:var(--text-bright)">' + formatNumber(a.deployedAmount) + '\u20ac \u2192 +' + formatNumber(a.deployedReturn) + '\u20ac/an</span>';
        html += '<span style="color:var(--text-dim)">vs CAT +' + formatNumber(a.deployedCatReturn) + '\u20ac</span>';
        html += '<span style="color:var(--green);font-weight:600">exc\u00e9dent +' + formatNumber(a.deployedExcess) + '\u20ac/an</span>';
        if (a.remainingCash > 0) html += '<span style="color:var(--text-muted)">reste ' + formatNumber(a.remainingCash) + '\u20ac en cash</span>';
        html += '</div>';
    }

    // ── Portfolio table (info only, locked) ──
    if (a.portfolioAnalysis.length > 0) {
        html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
        html += '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;font-weight:600;color:var(--text-bright)">\ud83d\udd12 Portefeuille (bloqu\u00e9)</span><span style="font-size:10px;color:var(--text-dim)">' + formatNumber(a.totalPortfolioInvested) + '\u20ac \u2192 +' + formatNumber(a.totalPortfolioReturn) + '\u20ac/an</span></div>';
        html += '<div style="max-height:250px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
        html += '<th style="padding:6px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th><th style="padding:6px;text-align:center;color:var(--text-muted);font-weight:500">Grade</th><th style="padding:6px;text-align:right;color:var(--text-muted);font-weight:500">Investi</th><th style="padding:6px;text-align:center;color:var(--text-muted);font-weight:500">Coupon</th><th style="padding:6px;text-align:right;color:var(--text-muted);font-weight:500">/an</th><th style="padding:6px;text-align:right;color:var(--text-muted);font-weight:500">vs CAT</th>';
        html += '</tr></thead><tbody>';
        a.portfolioAnalysis.forEach(function(p) {
            var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
            html += '<tr style="border-bottom:1px solid var(--border);opacity:0.75"><td style="padding:6px 10px"><strong style="color:var(--text-bright)">' + p.name.substring(0, 30) + '</strong><div style="font-size:9px;color:var(--text-dim)">' + p.bankName + '</div></td>';
            html += '<td style="padding:6px;text-align:center"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:5px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:11px">' + (p.grade || '?') + '</span></td>';
            html += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-size:10px">' + formatNumber(p.amount) + '\u20ac</td>';
            html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green);font-size:10px">' + p.coupon + '%</td>';
            html += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green);font-size:10px">+' + formatNumber(p.annualReturn) + '\u20ac</td>';
            html += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:600;font-size:10px;color:' + (p.excessVsCat >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (p.excessVsCat >= 0 ? '+' : '') + formatNumber(p.excessVsCat) + '\u20ac</td></tr>';
        });
        html += '</tbody></table></div></div>';
    }

    // ── Allocation table (the action plan) ──
    if (a.allocationPlan.length > 0) {
        html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
        html += '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between"><span style="font-size:12px;font-weight:600;color:var(--cyan)">\ud83d\udce8 Allocation liquidit\u00e9 ' + formatNumber(a.totalLiquidity) + '\u20ac</span><span style="font-size:10px;color:var(--text-dim)">' + a.allocationPlan.length + ' propositions</span></div>';
        html += '<div style="max-height:350px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
        html += '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Proposition</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Grade</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Coupon</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">/an</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">vs CAT</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th>';
        html += '</tr></thead><tbody>';
        a.allocationPlan.forEach(function(p) {
            var rc = p.recommendation === 'SOUSCRIRE' ? 'var(--green)' : p.recommendation === 'ENVISAGER' ? 'var(--cyan)' : p.recommendation === 'ATTENDRE' ? 'var(--orange)' : 'var(--red)';
            var ri = p.recommendation === 'SOUSCRIRE' ? '\u2705' : p.recommendation === 'ENVISAGER' ? '\ud83d\udca1' : p.recommendation === 'ATTENDRE' ? '\u23f3' : '\u274c';
            var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#EF233C';
            var hasAlloc = p.allocatedAmount > 0;
            html += '<tr style="border-bottom:1px solid var(--border);' + (!hasAlloc ? 'opacity:0.5' : '') + '"><td style="padding:8px 10px"><strong style="color:var(--text-bright)">' + p.name.substring(0, 35) + '</strong><div style="font-size:10px;color:var(--text-dim)">' + p.bankName + (p.capitalProtected ? ' \u00b7 prot\u00e9g\u00e9' : '') + '</div></td>';
            html += '<td style="padding:8px 6px;text-align:center"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:12px">' + p.grade + '</span></td>';
            html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green)">' + p.coupon + '%</td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:' + (hasAlloc ? '700' : '400') + ';color:' + (hasAlloc ? 'var(--cyan)' : 'var(--text-dim)') + '">' + (hasAlloc ? formatNumber(p.allocatedAmount) + '\u20ac' : '\u2014') + '</td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + (hasAlloc ? 'var(--green)' : 'var(--text-dim)') + '">' + (hasAlloc ? '+' + formatNumber(p.annualReturn) + '\u20ac' : '\u2014') + '</td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + (p.excessVsCat > 0 ? 'var(--green)' : p.excessVsCat < 0 ? 'var(--red)' : 'var(--text-dim)') + '">' + (hasAlloc ? (p.excessVsCat >= 0 ? '+' : '') + formatNumber(p.excessVsCat) + '\u20ac' : '\u2014') + '</td>';
            html += '<td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:' + rc + ';background:' + rc + '12;border:1px solid ' + rc + '30">' + ri + ' ' + p.recommendation + '</span></td></tr>';
        });
        html += '</tbody></table></div></div>';
    }

    if (a.allocationPlan.length === 0 && a.totalLiquidity > 0) {
        html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">' + formatNumber(a.totalLiquidity) + '\u20ac disponibles mais aucune proposition grad\u00e9e. Ajoutez des brochures et lancez le grading.</div>';
    }
    if (a.totalLiquidity === 0) {
        html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Aucune liquidit\u00e9 d\u00e9tect\u00e9e. Marquez des produits comme \u00ab $ Liquidit\u00e9 \u00bb pour d\u00e9bloquer l\'optimisation.</div>';
    }
    return html;
}

// ═══ AI PROMPT ═══════════════════════════════════════════
async function getStructOptimizerAISummary(analysis) {
    var a = analysis;
    var totalReturn = a.totalPortfolioReturn + a.deployedReturn;
    var totalInvested = a.totalPortfolioInvested + a.deployedAmount;
    var totalCatReturn = Math.round(totalInvested * a.catBenchmark / 100);

    var pfText = a.portfolioAnalysis.map(function(p) {
        return '\u2022 ' + p.name.substring(0, 25) + ' | ' + formatNumber(p.amount) + '\u20ac \u00e0 ' + p.coupon + '% | Grade ' + p.grade + ' | +' + formatNumber(p.annualReturn) + '\u20ac/an';
    }).join('\n');

    var allocText = a.allocationPlan.filter(function(p) { return p.allocatedAmount > 0; }).map(function(p) {
        return '\u2022 ' + p.name.substring(0, 25) + ' | Grade ' + p.grade + ' (' + p.score + '/100) | ' + formatNumber(p.allocatedAmount) + '\u20ac \u00e0 ' + p.coupon + '% \u2192 +' + formatNumber(p.annualReturn) + '\u20ac/an (vs CAT +' + formatNumber(p.catReturn) + '\u20ac) \u2192 ' + p.recommendation;
    }).join('\n');

    var waitText = a.allocationPlan.filter(function(p) { return p.recommendation === 'ATTENDRE' || p.recommendation === 'REJETER'; }).map(function(p) {
        return '\u2022 ' + p.name.substring(0, 25) + ' | Grade ' + p.grade + ' (' + p.score + '/100) | ' + p.coupon + '% \u2192 ' + p.recommendation;
    }).join('\n');

    var prompt = 'Directeur financier. Optimisation structur\u00e9s v1.1 \u2014 allocation de liquidit\u00e9.\n\n' +
        '**LIQUIDIT\u00c9 DISPONIBLE:** ' + formatNumber(a.totalLiquidity) + '\u20ac\n' +
        '**PORTEFEUILLE (bloqu\u00e9):** ' + formatNumber(a.totalPortfolioInvested) + '\u20ac \u2192 +' + formatNumber(a.totalPortfolioReturn) + '\u20ac/an\n' +
        '**CAT BENCHMARK:** ' + a.catBenchmark.toFixed(2) + '%\n\n' +
        (pfText ? 'PORTEFEUILLE EXISTANT:\n' + pfText + '\n\n' : '') +
        (allocText ? 'PLAN DE D\u00c9PLOIEMENT:\n' + allocText + '\n\n' : '') +
        (waitText ? 'ATTENDRE/REJETER:\n' + waitText + '\n\n' : '') +
        '**TOTAL SI D\u00c9PLOY\u00c9:** ' + formatNumber(totalInvested) + '\u20ac \u2192 +' + formatNumber(totalReturn) + '\u20ac/an\n' +
        '**VS TOUT EN CAT:** +' + formatNumber(totalCatReturn) + '\u20ac/an\n' +
        '**EXC\u00c9DENT:** +' + formatNumber(totalReturn - totalCatReturn) + '\u20ac/an\n' +
        (a.remainingCash > 0 ? '**RESTE EN CASH:** ' + formatNumber(a.remainingCash) + '\u20ac\n' : '') +
        '\nFORMAT:\n- R\u00e9sum\u00e9: X\u20ac disponibles \u2192 Y\u20ac \u00e0 d\u00e9ployer \u2192 +Z\u20ac/an\n- Chaque souscription: \u2705 **[Nom]** \u2192 [montant]\u20ac \u00e0 [coupon]% = +[gain]\u20ac/an vs CAT\n- Chaque rejet: \u274c **[Nom]** \u2014 pourquoi\n- Conclusion: votre allocation totale rapporte X\u20ac de plus que le CAT\n- Max 200 mots';

    var res = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) });
    if (!res.ok) throw new Error('IA: ' + res.status);
    var data = await res.json();
    return (data.content || []).map(function(b) { return b.text || ''; }).join('\n') || '';
}

// ═══ DASHBOARD WIDGET ════════════════════════════════════
function renderStructOptimizerDashboard() {
    if (!_lastStructOptResult) return '';
    var r = _lastStructOptResult;
    var dt = r.lastUpdated ? new Date(r.lastUpdated) : null;
    var ds = dt ? dt.toLocaleDateString('fr-FR') + ' ' + dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    var totalReturn = (r.totalPortfolioReturn || 0) + (r.deployedReturn || 0);
    var totalInvested = (r.totalPortfolioInvested || 0) + (r.deployedAmount || 0);
    var totalCatReturn = Math.round(totalInvested * (r.catBenchmark || 2.5) / 100);
    var excess = totalReturn - totalCatReturn;

    var html = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:var(--cyan)"></span>\ud83d\udcca Optimisation Structur\u00e9s</div><div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--text-dim)">' + ds + '</span><button class="btn sm ai-glow" onclick="showStructuredOptimizer()">\ud83d\udd04</button></div></div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement total</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+' + formatNumber(totalReturn) + '\u20ac<span style="font-size:11px">/an</span></div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Si CAT</div><div style="font-size:20px;font-weight:800;color:var(--orange);font-family:var(--mono)">+' + formatNumber(totalCatReturn) + '\u20ac<span style="font-size:11px">/an</span></div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Exc\u00e9dent</div><div style="font-size:20px;font-weight:800;color:' + (excess >= 0 ? 'var(--green)' : 'var(--red)') + ';font-family:var(--mono)">' + (excess >= 0 ? '+' : '') + formatNumber(excess) + '\u20ac</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">\u00c0 d\u00e9ployer</div><div style="font-size:20px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + formatNumber(r.deployedAmount || 0) + '\u20ac</div><div style="font-size:10px;color:var(--text-dim)">' + (r.subscribeCount || 0) + ' souscription' + ((r.subscribeCount || 0) > 1 ? 's' : '') + '</div></div>';
    html += '</div>';
    if (r.summary) {
        html += '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden"><div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">\ud83e\udd16</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandation Claude</span></div><div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">' + formatAIText(r.summary) + '</div></div>';
    }
    html += '</div>';
    return html;
}

// ═══ DASHBOARD INTEGRATION ═══════════════════════════════
(function() {
    var _structOptInterval = setInterval(function() {
        if (typeof renderDashboard !== 'function') return;
        var _prevRenderDash = renderDashboard;
        renderDashboard = function(container, state) {
            _prevRenderDash(container, state);
            setTimeout(function() {
                container.querySelectorAll('.section-header').forEach(function(header) {
                    var title = header.querySelector('.section-title');
                    if (title && title.textContent.indexOf('Portefeuille') >= 0 && !header.querySelector('.btn-struct-opt')) {
                        var btn = document.createElement('button');
                        btn.className = 'btn ai-glow btn-struct-opt';
                        btn.style.cssText = 'margin-right:8px;white-space:nowrap';
                        btn.innerHTML = '\ud83d\udcca Optimiser';
                        btn.onclick = showStructuredOptimizer;
                        var addBtn = header.querySelector('.btn-regrade-all') || header.querySelector('.btn.primary') || header.querySelector('.btn');
                        if (addBtn) header.insertBefore(btn, addBtn);
                        else header.appendChild(btn);
                    }
                });
                if (!container.querySelector('[data-section="struct-optimizer"]')) {
                    var widget = renderStructOptimizerDashboard();
                    if (widget) {
                        var div = document.createElement('div');
                        div.setAttribute('data-section', 'struct-optimizer');
                        div.innerHTML = widget;
                        container.appendChild(div);
                    }
                }
            }, 80);
        };
        clearInterval(_structOptInterval);
    }, 200);
    setTimeout(function() { clearInterval(_structOptInterval); }, 8000);
})();

console.log('[StructBoard] Structured Optimizer v1.1 \u2014 liquidity allocation');

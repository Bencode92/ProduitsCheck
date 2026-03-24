// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Structured Products Optimizer v1.0
// Same pattern as CAT Optimizer: arbitrage, amounts, annual gain
// ═══════════════════════════════════════════════════════════════

let _lastStructOptResult = null;

async function loadStructOptimizerResult() {
    try { var d = await github.readFile(CONFIG.DATA_PATH + '/structured-optimizer-result.json'); if (d) _lastStructOptResult = d; } catch(e) {}
}

async function saveStructOptimizerResult(summary, analysis) {
    var result = {
        lastUpdated: new Date().toISOString(), summary: summary, version: '1.0',
        totalLiquidity: analysis.totalLiquidity,
        totalDeployed: analysis.totalDeployed,
        totalAnnualReturn: analysis.totalAnnualReturn,
        catAlternativeReturn: analysis.catAlternativeReturn,
        excessReturnVsCat: analysis.excessReturnVsCat,
        portfolioCount: analysis.portfolioAnalysis.length,
        proposalCount: analysis.proposalAnalysis.length,
        subscribeCount: analysis.subscribeCount,
        holdCount: analysis.holdCount,
        waitCount: analysis.waitCount,
        catBenchmark: analysis.catBenchmark,
        portfolio: analysis.portfolioAnalysis.map(function(p) {
            return { name: p.name, grade: p.grade, score: p.score, amount: p.amount, coupon: p.coupon,
                annualReturn: p.annualReturn, catReturn: p.catReturn, excessVsCat: p.excessVsCat,
                expectedMaturity: p.expectedMaturity, recommendation: p.recommendation, reason: p.reason };
        }),
        proposals: analysis.proposalAnalysis.map(function(p) {
            return { name: p.name, grade: p.grade, score: p.score, suggestedAmount: p.suggestedAmount,
                coupon: p.coupon, annualReturn: p.annualReturn, catReturn: p.catReturn, excessVsCat: p.excessVsCat,
                recommendation: p.recommendation, reason: p.reason };
        })
    };
    _lastStructOptResult = result;
    await github.writeFile(CONFIG.DATA_PATH + '/structured-optimizer-result.json', result, '[StructBoard] Structured Optimizer v1.0');
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
    try {
        if (_lastOptimizerResult && _lastOptimizerResult.weightedRate) catRate = _lastOptimizerResult.weightedRate;
        else if (typeof _loadCatBenchmark === 'function') { /* async, use cached */ }
    } catch(e) {}
    // Try to get best CAT rate from cached data
    if (_mktCache) {
        try {
            var catData = _lastOptimizerResult;
            if (catData && catData.weightedRate) catRate = catData.weightedRate;
        } catch(e) {}
    }

    // ─── LIQUIDITY: find cash available ───
    var liquidityProducts = portfolio.filter(function(p) {
        return (p.grading && p.grading.grade === '-') || _isLiquidityProduct(_graderNormalize(p));
    });
    var totalLiquidity = liquidityProducts.reduce(function(s, p) { return s + (parseFloat(p.investedAmount) || 0); }, 0);

    // ─── PORTFOLIO ANALYSIS ───
    var portfolioAnalysis = portfolio.filter(function(p) {
        return !liquidityProducts.some(function(l) { return l.id === p.id; });
    }).map(function(p) {
        var g = p.grading || {};
        var norm = _graderNormalize(p);
        var amount = parseFloat(p.investedAmount) || 0;
        var coupon = norm.coupon || 0;
        var annualReturn = Math.round(amount * coupon / 100);
        var catReturn = Math.round(amount * catRate / 100);
        var excessVsCat = annualReturn - catReturn;
        var matInfo = (typeof _estimateExpectedMaturity === 'function') ? _estimateExpectedMaturity(norm) : { expected: norm.maturityYears };

        var recommendation, reason;
        if (g.grade === 'A' || g.grade === 'B') {
            recommendation = 'GARDER';
            reason = 'Grade ' + g.grade + ' — produit de qualité, excédent vs CAT +' + formatNumber(Math.max(0, excessVsCat)) + '€/an';
        } else if (g.grade === 'C') {
            if (matInfo.expected && matInfo.expected <= 3) {
                recommendation = 'GARDER';
                reason = 'Grade C mais maturité espérée ~' + matInfo.expected + 'a — proche du call';
            } else if (excessVsCat > 0) {
                recommendation = 'SURVEILLER';
                reason = 'Grade C, rendement +' + formatNumber(excessVsCat) + '€/an vs CAT — surveiller';
            } else {
                recommendation = 'SURVEILLER';
                reason = 'Grade C, rendement ≤ CAT — envisager sortie si opportunité';
            }
        } else if (g.grade === 'D' || g.grade === 'F') {
            recommendation = 'SURVEILLER';
            reason = 'Grade ' + (g.grade || '?') + ' — sortir si le marché secondaire le permet';
        } else {
            recommendation = 'GRADER';
            reason = 'Non gradé — lancer le grading pour évaluer';
        }

        return {
            id: p.id, name: p.name || 'Produit', bankName: (BANKS.find(function(b) { return b.id === p.bankId; }) || {}).name || p.bankId || '',
            grade: g.grade || '?', score: g.score, amount: amount,
            coupon: coupon, couponType: norm.couponType,
            annualReturn: annualReturn, catReturn: catReturn, excessVsCat: excessVsCat,
            expectedMaturity: matInfo.expected || norm.maturityYears,
            maxMaturity: matInfo.max || norm.maturityYears,
            capitalProtected: norm.capitalProtection,
            recommendation: recommendation, reason: reason
        };
    });

    // ─── PROPOSAL ANALYSIS ───
    var proposalAnalysis = allProposals.filter(function(p) {
        return p.grading && p.grading.grade && p.grading.grade !== '?' && p.grading.grade !== '-';
    }).map(function(p) {
        var g = p.grading || {};
        var norm = _graderNormalize(p);
        var suggestedAmount = totalLiquidity > 0 ? Math.min(totalLiquidity, 100000) : 30000; // default 30K if no liquidity info
        var coupon = norm.coupon || 0;
        var annualReturn = Math.round(suggestedAmount * coupon / 100);
        var catReturn = Math.round(suggestedAmount * catRate / 100);
        var excessVsCat = annualReturn - catReturn;
        var matInfo = (typeof _estimateExpectedMaturity === 'function') ? _estimateExpectedMaturity(norm) : { expected: norm.maturityYears };

        var recommendation, reason;
        if (g.grade === 'A') {
            recommendation = 'SOUSCRIRE';
            reason = 'Grade A (' + g.score + '/100) — excédent +' + formatNumber(excessVsCat) + '€/an vs CAT. Produit de qualité.';
        } else if (g.grade === 'B') {
            if (excessVsCat > 500) {
                recommendation = 'SOUSCRIRE';
                reason = 'Grade B (' + g.score + '/100) — bon produit, +' + formatNumber(excessVsCat) + '€/an vs CAT.';
            } else {
                recommendation = 'ENVISAGER';
                reason = 'Grade B mais spread vs CAT modeste (+' + formatNumber(excessVsCat) + '€/an). Négocier le coupon ?';
            }
        } else if (g.grade === 'C') {
            recommendation = 'ATTENDRE';
            reason = 'Grade C (' + g.score + '/100) — rendement ' + (excessVsCat > 0 ? '+' + formatNumber(excessVsCat) : formatNumber(excessVsCat)) + '€/an vs CAT. Risque élevé pour le rendement.';
        } else {
            recommendation = 'REJETER';
            reason = 'Grade ' + g.grade + ' (' + (g.score || 0) + '/100) — risque trop élevé, garder en CAT.';
        }

        return {
            id: p.id, name: p.name || 'Proposition', bankName: (BANKS.find(function(b) { return b.id === p.bankId; }) || {}).name || p.bankId || '',
            grade: g.grade, score: g.score, suggestedAmount: suggestedAmount,
            coupon: coupon, couponType: norm.couponType,
            annualReturn: annualReturn, catReturn: catReturn, excessVsCat: excessVsCat,
            expectedMaturity: matInfo.expected || norm.maturityYears,
            capitalProtected: norm.capitalProtection,
            recommendation: recommendation, reason: reason
        };
    });

    // Sort: SOUSCRIRE first, then ENVISAGER, ATTENDRE, REJETER
    var recOrder = { 'SOUSCRIRE': 0, 'ENVISAGER': 1, 'ATTENDRE': 2, 'REJETER': 3 };
    proposalAnalysis.sort(function(a, b) { return (recOrder[a.recommendation] || 9) - (recOrder[b.recommendation] || 9); });

    // ─── AGGREGATE ───
    var totalDeployed = portfolioAnalysis.reduce(function(s, p) { return s + p.amount; }, 0);
    var totalAnnualReturn = portfolioAnalysis.reduce(function(s, p) { return s + p.annualReturn; }, 0);
    var catAlternativeReturn = Math.round((totalDeployed + totalLiquidity) * catRate / 100);
    var subscribeCount = proposalAnalysis.filter(function(p) { return p.recommendation === 'SOUSCRIRE'; }).length;
    var holdCount = portfolioAnalysis.filter(function(p) { return p.recommendation === 'GARDER'; }).length;
    var waitCount = proposalAnalysis.filter(function(p) { return p.recommendation === 'ATTENDRE'; }).length;

    // Potential gain if subscribing all recommended
    var potentialNewReturn = proposalAnalysis.filter(function(p) { return p.recommendation === 'SOUSCRIRE' || p.recommendation === 'ENVISAGER'; })
        .reduce(function(s, p) { return s + p.annualReturn; }, 0);
    var potentialNewCatCost = proposalAnalysis.filter(function(p) { return p.recommendation === 'SOUSCRIRE' || p.recommendation === 'ENVISAGER'; })
        .reduce(function(s, p) { return s + p.catReturn; }, 0);

    return {
        portfolioAnalysis: portfolioAnalysis, proposalAnalysis: proposalAnalysis,
        liquidityProducts: liquidityProducts, totalLiquidity: totalLiquidity,
        totalDeployed: totalDeployed, totalAnnualReturn: totalAnnualReturn,
        catAlternativeReturn: catAlternativeReturn,
        excessReturnVsCat: totalAnnualReturn - Math.round(totalDeployed * catRate / 100),
        catBenchmark: catRate,
        subscribeCount: subscribeCount, holdCount: holdCount, waitCount: waitCount,
        potentialNewReturn: potentialNewReturn, potentialNewCatCost: potentialNewCatCost
    };
}

// ═══ UI — MODAL ══════════════════════════════════════════
function showStructuredOptimizer() {
    var pCount = (app.state.portfolio || []).length;
    var prCount = Object.values(app.state.proposals || {}).reduce(function(s, a) { return s + a.filter(function(p) { return !['rejected','subscribed'].includes(p.status); }).length; }, 0);

    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">' +
        '<h2 class="modal-title">\ud83d\udcca Optimiseur Structur\u00e9s v1.0</h2>' +
        '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">' +
        'Compare chaque produit au rendement CAT \u00e9quivalent. Montre le gain annuel net vs \u00ab ne rien faire \u00bb (garder en CAT).</div>' +
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

        // AI analysis
        html += '<div id="ai-struct-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse...</div></div>';
        results.innerHTML = html;

        var ai = await getStructOptimizerAISummary(analysis);
        var aiDiv = document.getElementById('ai-struct-summary');
        if (aiDiv) aiDiv.innerHTML = '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden"><div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">\ud83e\udd16</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandations Claude</span></div><div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">' + formatAIText(ai) + '</div></div>';

        await saveStructOptimizerResult(ai, analysis);
        showToast('Optimisation termin\u00e9e', 'success');
    } catch(e) {
        results.innerHTML = '<div style="color:var(--red);padding:16px">\u274c ' + e.message + '</div>';
    }
}

// ═══ TABLE ═══════════════════════════════════════════════
function renderStructOptimizationTable(analysis) {
    var a = analysis;

    // Summary cards
    var html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:12px">';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Portefeuille Structur\u00e9</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+' + formatNumber(a.totalAnnualReturn) + '\u20ac<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">' + formatNumber(a.totalDeployed) + '\u20ac invest.</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Si tout en CAT</div><div style="font-size:20px;font-weight:800;color:var(--orange);font-family:var(--mono)">+' + formatNumber(a.catAlternativeReturn) + '\u20ac<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">' + a.catBenchmark.toFixed(2) + '% benchmark</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Exc\u00e9dent vs CAT</div><div style="font-size:20px;font-weight:800;color:' + (a.excessReturnVsCat >= 0 ? 'var(--green)' : 'var(--red)') + ';font-family:var(--mono)">' + (a.excessReturnVsCat >= 0 ? '+' : '') + formatNumber(a.excessReturnVsCat) + '\u20ac</div><div style="font-size:10px;color:var(--text-dim)">rendement suppl\u00e9mentaire</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Liquidit\u00e9 dispo</div><div style="font-size:20px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + formatNumber(a.totalLiquidity) + '\u20ac</div><div style="font-size:10px;color:var(--text-dim)">' + a.liquidityProducts.length + ' produit' + (a.liquidityProducts.length > 1 ? 's' : '') + '</div></div>';
    html += '</div>';

    // ─── PORTFOLIO TABLE ───
    if (a.portfolioAnalysis.length > 0) {
        html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
        html += '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between"><span style="font-size:12px;font-weight:600;color:var(--text-bright)">\ud83c\udfe6 Portefeuille — vs CAT ' + a.catBenchmark.toFixed(2) + '%</span><span style="font-size:10px;color:var(--text-dim)">' + a.portfolioAnalysis.length + ' produits</span></div>';
        html += '<div style="max-height:350px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
        html += '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th>';
        html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Grade</th>';
        html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Investi</th>';
        html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Coupon</th>';
        html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Rendement/an</th>';
        html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">vs CAT</th>';
        html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th>';
        html += '</tr></thead><tbody>';

        a.portfolioAnalysis.forEach(function(p) {
            var rc = p.recommendation === 'GARDER' ? 'var(--green)' : p.recommendation === 'SURVEILLER' ? 'var(--orange)' : 'var(--cyan)';
            var ri = p.recommendation === 'GARDER' ? '\u2705' : p.recommendation === 'SURVEILLER' ? '\ud83d\udc40' : '\u2753';
            var gc = p.grade === 'A' ? '#06D6A0' : p.grade === 'B' ? '#4ECDC4' : p.grade === 'C' ? '#FFB627' : p.grade === 'D' ? '#E85D04' : p.grade === 'F' ? '#EF233C' : '#888';

            html += '<tr style="border-bottom:1px solid var(--border)">';
            html += '<td style="padding:8px 10px"><strong style="color:var(--text-bright)">' + p.name.substring(0, 40) + '</strong><div style="font-size:10px;color:var(--text-dim)">' + p.bankName + (p.capitalProtected ? ' \u00b7 prot\u00e9g\u00e9' : '') + '</div></td>';
            html += '<td style="padding:8px 6px;text-align:center"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:12px">' + (p.grade || '?') + '</span></td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono)">' + formatNumber(p.amount) + '\u20ac</td>';
            html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green)">' + p.coupon + '%</td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">+' + formatNumber(p.annualReturn) + '\u20ac</td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + (p.excessVsCat >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (p.excessVsCat >= 0 ? '+' : '') + formatNumber(p.excessVsCat) + '\u20ac</td>';
            html += '<td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:' + rc + ';background:' + rc + '12;border:1px solid ' + rc + '30">' + ri + ' ' + p.recommendation + '</span></td>';
            html += '</tr>';
        });
        html += '</tbody></table></div></div>';
    }

    // ─── PROPOSALS TABLE ───
    if (a.proposalAnalysis.length > 0) {
        html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
        html += '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between"><span style="font-size:12px;font-weight:600;color:var(--cyan)">\ud83d\udce8 Propositions — d\u00e9ployer ' + formatNumber(a.totalLiquidity) + '\u20ac ?</span><span style="font-size:10px;color:var(--text-dim)">' + a.proposalAnalysis.length + ' grad\u00e9es</span></div>';
        html += '<div style="max-height:350px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
        html += '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Proposition</th>';
        html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Grade</th>';
        html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Coupon</th>';
        html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Si 30K\u20ac</th>';
        html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">vs CAT</th>';
        html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th>';
        html += '</tr></thead><tbody>';

        a.proposalAnalysis.forEach(function(p) {
            var rc = p.recommendation === 'SOUSCRIRE' ? 'var(--green)' : p.recommendation === 'ENVISAGER' ? 'var(--cyan)' : p.recommendation === 'ATTENDRE' ? 'var(--orange)' : 'var(--red)';
            var ri = p.recommendation === 'SOUSCRIRE' ? '\u2705' : p.recommendation === 'ENVISAGER' ? '\ud83d\udca1' : p.recommendation === 'ATTENDRE' ? '\u23f3' : '\u274c';
            var gc = p.grade === 'A' ? '#06D6A0' : p.grade === 'B' ? '#4ECDC4' : p.grade === 'C' ? '#FFB627' : p.grade === 'D' ? '#E85D04' : '#EF233C';
            // Show return for 30K€ regardless of suggested amount
            var ret30k = Math.round(30000 * p.coupon / 100);
            var cat30k = Math.round(30000 * a.catBenchmark / 100);

            html += '<tr style="border-bottom:1px solid var(--border)">';
            html += '<td style="padding:8px 10px"><strong style="color:var(--text-bright)">' + p.name.substring(0, 40) + '</strong><div style="font-size:10px;color:var(--text-dim)">' + p.bankName + ' \u00b7 ' + (p.couponType || '') + (p.capitalProtected ? ' \u00b7 prot\u00e9g\u00e9' : '') + '</div></td>';
            html += '<td style="padding:8px 6px;text-align:center"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:12px">' + p.grade + '</span></td>';
            html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green)">' + p.coupon + '%</td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">+' + formatNumber(ret30k) + '\u20ac/an</td>';
            html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + (ret30k - cat30k >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (ret30k - cat30k >= 0 ? '+' : '') + formatNumber(ret30k - cat30k) + '\u20ac</td>';
            html += '<td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:' + rc + ';background:' + rc + '12;border:1px solid ' + rc + '30">' + ri + ' ' + p.recommendation + '</span></td>';
            html += '</tr>';
        });
        html += '</tbody></table></div></div>';
    }

    // No proposals message
    if (a.proposalAnalysis.length === 0) {
        html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Aucune proposition grad\u00e9e en attente. Ajoutez des brochures et lancez le grading.</div>';
    }

    return html;
}

// ═══ AI PROMPT ═══════════════════════════════════════════
async function getStructOptimizerAISummary(analysis) {
    var a = analysis;
    var pfText = a.portfolioAnalysis.map(function(p) {
        return '\u2022 ' + p.name.substring(0, 30) + ' (' + p.bankName + ') | ' + formatNumber(p.amount) + '\u20ac \u00e0 ' + p.coupon + '% | Grade ' + p.grade +
            ' | +' + formatNumber(p.annualReturn) + '\u20ac/an (vs CAT: ' + (p.excessVsCat >= 0 ? '+' : '') + formatNumber(p.excessVsCat) + '\u20ac) \u2192 ' + p.recommendation;
    }).join('\n');
    var prText = a.proposalAnalysis.map(function(p) {
        return '\u2022 ' + p.name.substring(0, 30) + ' (' + p.bankName + ') | ' + p.coupon + '% | Grade ' + p.grade + ' (' + p.score + '/100)' +
            ' | Sur 30K\u20ac: +' + formatNumber(Math.round(30000 * p.coupon / 100)) + '\u20ac/an (vs CAT: ' + (Math.round(30000 * p.coupon / 100) - Math.round(30000 * a.catBenchmark / 100) >= 0 ? '+' : '') + formatNumber(Math.round(30000 * p.coupon / 100) - Math.round(30000 * a.catBenchmark / 100)) + '\u20ac) \u2192 ' + p.recommendation;
    }).join('\n');

    var prompt = 'Directeur financier. Optimisation structur\u00e9s v1.0.\n\n' +
        '**PORTEFEUILLE:** ' + formatNumber(a.totalDeployed) + '\u20ac invest. \u2192 +' + formatNumber(a.totalAnnualReturn) + '\u20ac/an\n' +
        '**SI TOUT EN CAT:** +' + formatNumber(a.catAlternativeReturn) + '\u20ac/an (' + a.catBenchmark.toFixed(2) + '%)\n' +
        '**EXC\u00c9DENT vs CAT:** ' + (a.excessReturnVsCat >= 0 ? '+' : '') + formatNumber(a.excessReturnVsCat) + '\u20ac/an\n' +
        '**LIQUIDIT\u00c9 DISPO:** ' + formatNumber(a.totalLiquidity) + '\u20ac\n\n' +
        (a.portfolioAnalysis.length > 0 ? a.portfolioAnalysis.length + ' PRODUITS EN PORTEFEUILLE:\n' + pfText + '\n\n' : '') +
        (a.proposalAnalysis.length > 0 ? a.proposalAnalysis.length + ' PROPOSITIONS:\n' + prText + '\n\n' : '') +
        'FORMAT:\n' +
        '- **PORTEFEUILLE:** +X\u20ac/an (vs CAT +Y\u20ac = exc\u00e9dent +Z\u20ac)\n' +
        '- Chaque produit: \u2705 GARDER / \ud83d\udc40 SURVEILLER + raison courte\n' +
        '- **PROPOSITIONS:** les\u2705 SOUSCRIRE en premier avec gain vs CAT\n' +
        '- **LIQUIDIT\u00c9:** recommandation de d\u00e9ploiement\n' +
        '- Comparaison r\u00e9sum\u00e9e: "votre portefeuille structur\u00e9 rapporte X\u20ac de plus que si tout \u00e9tait en CAT"\n' +
        '- Max 200 mots';

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

    var html = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:var(--cyan)"></span>\ud83d\udcca Optimisation Structur\u00e9s</div><div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--text-dim)">' + ds + '</span><button class="btn sm ai-glow" onclick="showStructuredOptimizer()">\ud83d\udd04</button></div></div>';

    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement Structur\u00e9s</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+' + formatNumber(r.totalAnnualReturn || 0) + '\u20ac<span style="font-size:11px">/an</span></div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Si CAT</div><div style="font-size:20px;font-weight:800;color:var(--orange);font-family:var(--mono)">+' + formatNumber(r.catAlternativeReturn || 0) + '\u20ac<span style="font-size:11px">/an</span></div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Exc\u00e9dent</div><div style="font-size:20px;font-weight:800;color:' + ((r.excessReturnVsCat || 0) >= 0 ? 'var(--green)' : 'var(--red)') + ';font-family:var(--mono)">' + ((r.excessReturnVsCat || 0) >= 0 ? '+' : '') + formatNumber(r.excessReturnVsCat || 0) + '\u20ac</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">\u00c0 souscrire</div><div style="font-size:20px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + (r.subscribeCount || 0) + '</div><div style="font-size:10px;color:var(--text-dim)">' + (r.portfolioCount || 0) + ' en portefeuille</div></div>';
    html += '</div>';

    if (r.summary) {
        html += '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden"><div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">\ud83e\udd16</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandation Claude</span></div><div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">' + formatAIText(r.summary) + '</div></div>';
    }
    html += '</div>';
    return html;
}

console.log('[StructBoard] Structured Optimizer v1.0 loaded');

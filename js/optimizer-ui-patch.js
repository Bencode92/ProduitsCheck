// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer UI Patch v2: Before/After + Subscription Plan
// Replaces the old 4 summary cards + 2 tables with:
//   1. Before/After comparison table (top)
//   2. Subscription plan with Source column (middle)
//   3. Non-allocated products (compact)
//   4. Claude analysis (below, added by runStructOptimizer)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Override immediately + retry — ensures we catch it before any click
    function _tryOverride() {
        if (typeof renderStructOptimizationTable !== 'function') return false;

        renderStructOptimizationTable = function(analysis) {
            var a = analysis;

            // ═══ CALCULATIONS ═══
            var pfInvested = a.totalPortfolioInvested || 0;
            var pfReturn = a.totalPortfolioReturn || 0;
            var liqTotal = a.totalLiquidity || 0;
            var catRate = a.catBenchmark || 2.5;
            var liqReturn = Math.round(liqTotal * catRate / 100);

            var beforeReturn = pfReturn + liqReturn;
            var beforeTotal = pfInvested + liqTotal;
            var beforeYield = beforeTotal > 0 ? (beforeReturn / beforeTotal * 100) : 0;

            var deployedAmount = a.deployedAmount || 0;
            var deployedReturn = a.deployedReturn || 0;
            var remainCash = a.remainingCash || 0;
            var remainCashReturn = Math.round(remainCash * catRate / 100);

            var afterInvested = pfInvested + deployedAmount;
            var afterReturn = pfReturn + deployedReturn + remainCashReturn;
            var afterTotal = pfInvested + deployedAmount + remainCash;
            var afterYield = afterTotal > 0 ? (afterReturn / afterTotal * 100) : 0;

            var diffReturn = afterReturn - beforeReturn;
            var diffYield = afterYield - beforeYield;

            var liqStruct = a._structuredLiquidity || liqTotal;
            var liqExternal = a._externalLiquidity || 0;
            var subscriptions = (a.allocationPlan || []).filter(function(p) { return p.allocatedAmount > 0; });
            var nonAlloc = (a.allocationPlan || []).filter(function(p) { return p.allocatedAmount <= 0 && p.recommendation; });

            var html = '';

            // ═══ 1. BEFORE / AFTER TABLE ═══
            html += '<div style="border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">';
            html += '<div style="padding:12px 16px;background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.12));border-bottom:1px solid var(--border)">';
            html += '<span style="font-size:14px;font-weight:700;color:var(--accent)">\ud83d\udcca Comparaison Avant / Apr\u00e8s optimisation</span></div>';

            html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
            html += '<thead><tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)">';
            html += '<th style="padding:12px 16px;text-align:left;color:var(--text-muted);font-weight:500;width:38%"></th>';
            html += '<th style="padding:12px 8px;text-align:center;color:var(--text-muted);font-weight:600;width:22%;font-size:11px;text-transform:uppercase">Avant</th>';
            html += '<th style="padding:12px 8px;text-align:center;color:var(--accent);font-weight:700;width:22%;font-size:11px;text-transform:uppercase">\u2192 Apr\u00e8s</th>';
            html += '<th style="padding:12px 8px;text-align:center;width:18%;font-size:11px;text-transform:uppercase;font-weight:600;color:var(--text-muted)">Diff.</th>';
            html += '</tr></thead><tbody>';

            html += _row('\ud83c\udfe6 Investi structur\u00e9s', fmt(pfInvested) + '\u20ac', fmt(afterInvested) + '\u20ac', '+' + fmt(deployedAmount) + '\u20ac', deployedAmount > 0 ? 'green' : 'dim');
            html += _row('\ud83d\udcb0 Liquidit\u00e9 restante', fmt(liqTotal) + '\u20ac', fmt(remainCash) + '\u20ac', '-' + fmt(liqTotal - remainCash) + '\u20ac', 'orange');
            html += _row('\ud83d\udcc8 Rendement /an', '+' + fmt(beforeReturn) + '\u20ac', '+' + fmt(afterReturn) + '\u20ac', (diffReturn >= 0 ? '+' : '') + fmt(diffReturn) + '\u20ac', diffReturn >= 0 ? 'green' : 'red', true);
            html += _row('\ud83d\udcca Rendement %', beforeYield.toFixed(2) + '%', afterYield.toFixed(2) + '%', (diffYield >= 0 ? '+' : '') + diffYield.toFixed(2) + '%', diffYield >= 0 ? 'green' : 'red', true);

            // Arbitrage row
            var arbStruct = Math.min(deployedAmount, liqStruct);
            var arbExternal = Math.max(0, deployedAmount - arbStruct);
            var arbDetail = '';
            if (arbStruct > 0 && arbExternal > 0) arbDetail = '\ud83c\udfe6 ' + fmt(arbStruct) + '\u20ac struct. + \ud83d\udcb5 ' + fmt(arbExternal) + '\u20ac externe';
            else if (arbStruct > 0) arbDetail = '\ud83c\udfe6 ' + fmt(arbStruct) + '\u20ac depuis produits structur\u00e9s';
            else if (arbExternal > 0) arbDetail = '\ud83d\udcb5 ' + fmt(arbExternal) + '\u20ac depuis liquidit\u00e9 externe';

            html += '<tr style="border-top:2px solid var(--accent);background:rgba(59,130,246,0.06)">';
            html += '<td style="padding:12px 16px;font-weight:700;color:var(--accent);font-size:13px">\ud83d\udd04 Arbitrage</td>';
            html += '<td colspan="3" style="padding:12px 16px;text-align:center">';
            html += '<div style="font-size:18px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + fmt(deployedAmount) + '\u20ac \u00e0 d\u00e9ployer</div>';
            if (arbDetail) html += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">' + arbDetail + '</div>';
            html += '</td></tr>';
            html += '</tbody></table></div>';

            // ═══ 2. SUBSCRIPTION PLAN ═══
            if (subscriptions.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:12px 16px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">';
                html += '<span style="font-size:13px;font-weight:700;color:var(--green)">\u2705 Plan de souscription</span>';
                html += '<span style="font-size:11px;color:var(--text-dim)">' + subscriptions.length + ' produit(s) \u2192 +' + fmt(deployedReturn) + '\u20ac/an esp\u00e9r\u00e9</span></div>';

                html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
                html += '<th style="padding:10px 12px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th>';
                html += '<th style="padding:10px 6px;text-align:center;color:var(--text-muted);font-weight:500">Grade</th>';
                html += '<th style="padding:10px 6px;text-align:center;color:var(--text-muted);font-weight:500">Coupon</th>';
                html += '<th style="padding:10px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th>';
                html += '<th style="padding:10px 6px;text-align:right;color:var(--text-muted);font-weight:500">Esp\u00e9r\u00e9/an</th>';
                html += '<th style="padding:10px 6px;text-align:right;color:var(--text-muted);font-weight:500">vs CAT</th>';
                html += '<th style="padding:10px 6px;text-align:center;color:var(--text-muted);font-weight:500">Source</th>';
                html += '</tr></thead><tbody>';

                subscriptions.forEach(function(p) {
                    var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
                    var poolIcon = p._poolLabel || (p._pool === 'structured' ? '\ud83c\udfe6' : '\ud83d\udcb5');
                    var probText = p.probCoupon ? ' (P=' + Math.round(p.probCoupon * 100) + '%)' : '';
                    html += '<tr style="border-bottom:1px solid var(--border)">';
                    html += '<td style="padding:10px 12px"><strong style="color:var(--text-bright)">' + (p.name || '').substring(0, 32) + '</strong>';
                    html += '<div style="font-size:9px;color:var(--text-dim)">' + (p.bankName || '') + probText + '</div></td>';
                    html += '<td style="padding:10px 6px;text-align:center"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:13px">' + p.grade + '</span></td>';
                    html += '<td style="padding:10px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green);font-size:13px">' + p.coupon + '%</td>';
                    html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--cyan);font-size:13px">' + fmt(p.allocatedAmount) + '\u20ac</td>';
                    html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">+' + fmt(p.expectedReturn || p.annualReturn) + '\u20ac</td>';
                    html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + ((p.excessVsCat || 0) >= 0 ? 'var(--green)' : 'var(--red)') + '">' + ((p.excessVsCat || 0) >= 0 ? '+' : '') + fmt(p.excessVsCat || 0) + '\u20ac</td>';
                    html += '<td style="padding:10px 6px;text-align:center;font-size:16px">' + poolIcon + '</td>';
                    html += '</tr>';
                });

                // TOTAL row
                html += '<tr style="border-top:2px solid var(--accent);background:var(--bg-elevated)">';
                html += '<td style="padding:10px 12px;font-weight:800;color:var(--text-bright);font-size:12px" colspan="3">TOTAL</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--cyan);font-size:13px">' + fmt(deployedAmount) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--green);font-size:13px">+' + fmt(deployedReturn) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:' + ((a.deployedExcess || 0) >= 0 ? 'var(--green)' : 'var(--red)') + ';font-size:13px">' + ((a.deployedExcess || 0) >= 0 ? '+' : '') + fmt(a.deployedExcess || 0) + '\u20ac</td>';
                html += '<td></td></tr>';
                html += '</tbody></table></div></div>';
            }

            // ═══ 3. PORTEFEUILLE EXISTANT (compact) ═══
            if (a.portfolioAnalysis && a.portfolioAnalysis.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">';
                html += '<span style="font-size:11px;font-weight:600;color:var(--text-dim)">\ud83d\udd12 Portefeuille existant (bloqu\u00e9)</span>';
                html += '<span style="font-size:10px;color:var(--text-dim)">' + fmt(pfInvested) + '\u20ac \u2192 +' + fmt(pfReturn) + '\u20ac/an</span></div>';
                html += '<div style="padding:6px 14px;max-height:120px;overflow-y:auto">';
                a.portfolioAnalysis.forEach(function(p) {
                    var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:10px">';
                    html += '<span><span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:4px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:9px;margin-right:6px">' + (p.grade || '?') + '</span>';
                    html += '<span style="color:var(--text-bright)">' + (p.name || '').substring(0, 30) + '</span></span>';
                    html += '<span style="font-family:var(--mono);color:var(--text-dim)">' + fmt(p.amount) + '\u20ac \u00e0 ' + p.coupon + '% = +' + fmt(p.annualReturn) + '\u20ac</span>';
                    html += '</div>';
                });
                html += '</div></div>';
            }

            // ═══ 4. NON ALLOUÉS (compact) ═══
            if (nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
                html += '<span style="font-size:11px;font-weight:600;color:var(--text-dim)">\u23f3 Non allou\u00e9s (' + nonAlloc.length + ')</span></div>';
                html += '<div style="padding:6px 14px">';
                nonAlloc.forEach(function(p) {
                    var rc = p.recommendation === 'ATTENDRE' ? 'var(--orange)' : p.recommendation === 'REJETER' ? 'var(--red)' : 'var(--text-dim)';
                    var ri = p.recommendation === 'ATTENDRE' ? '\u23f3' : p.recommendation === 'REJETER' ? '\u274c' : '\u2014';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:10px;' + (p.recommendation === 'REJETER' ? 'opacity:0.5' : '') + '">';
                    html += '<span style="color:var(--text-bright)">' + (p.name || '').substring(0, 35) + ' <span style="color:var(--text-dim)">(' + (p.bankName || '') + ')</span></span>';
                    html += '<span style="color:' + rc + ';font-weight:600">' + ri + ' ' + p.recommendation + ' \u2014 ' + p.coupon + '% ' + p.grade + '</span>';
                    html += '</div>';
                });
                html += '</div></div>';
            }

            // Empty states
            if ((a.allocationPlan || []).length === 0 && liqTotal > 0) {
                html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">' + fmt(liqTotal) + '\u20ac disponibles mais aucune proposition grad\u00e9e.</div>';
            }
            if (liqTotal === 0) {
                html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Aucune liquidit\u00e9 d\u00e9tect\u00e9e.</div>';
            }

            return html;
        };

        console.log('[StructBoard] Optimizer UI v2 \u2014 before/after + plan de souscription');
        return true;
    }

    // Try immediately, then retry every 100ms (faster than 300ms)
    if (!_tryOverride()) {
        var _w = setInterval(function() { if (_tryOverride()) clearInterval(_w); }, 100);
        setTimeout(function() { clearInterval(_w); }, 10000);
    }

    function fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }

    function _row(label, before, after, diff, diffColor, highlight) {
        var bg = highlight ? 'background:rgba(59,130,246,0.04)' : '';
        var cc = diffColor === 'green' ? 'var(--green)' : diffColor === 'red' ? 'var(--red)' : diffColor === 'orange' ? 'var(--orange)' : 'var(--text-dim)';
        return '<tr style="border-bottom:1px solid var(--border);' + bg + '">' +
            '<td style="padding:10px 16px;font-weight:600;color:var(--text-bright);font-size:13px">' + label + '</td>' +
            '<td style="padding:10px 8px;text-align:center;font-family:var(--mono);color:var(--text-muted);font-size:13px">' + before + '</td>' +
            '<td style="padding:10px 8px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--text-bright);font-size:13px">' + after + '</td>' +
            '<td style="padding:10px 8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + cc + ';font-size:13px">' + diff + '</td></tr>';
    }
})();

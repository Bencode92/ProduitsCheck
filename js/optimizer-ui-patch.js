// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer UI Patch: Before/After comparison table
// Adds a clear comparison: AVANT (current) vs APRÈS (optimized)
// Shows: rendement %, rendement €/an, difference, arbitrage amount
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var _waitRender = setInterval(function() {
        if (typeof renderStructOptimizationTable !== 'function') return;
        clearInterval(_waitRender);

        var _origRender = renderStructOptimizationTable;
        renderStructOptimizationTable = function(analysis) {
            var a = analysis;

            // ═══ CALCULATE BEFORE / AFTER ═══
            var pfInvested = a.totalPortfolioInvested || 0;
            var pfReturn = a.totalPortfolioReturn || 0;
            var pfYield = pfInvested > 0 ? (pfReturn / pfInvested * 100) : 0;

            var liqTotal = a.totalLiquidity || 0;
            var liqStruct = a._structuredLiquidity || liqTotal;
            var liqExternal = a._externalLiquidity || 0;
            var catRate = a.catBenchmark || 2.5;
            var liqReturn = Math.round(liqTotal * catRate / 100); // Current: earning CAT rate

            var beforeTotal = pfInvested + liqTotal;
            var beforeReturn = pfReturn + liqReturn;
            var beforeYield = beforeTotal > 0 ? (beforeReturn / beforeTotal * 100) : 0;

            var deployedAmount = a.deployedAmount || 0;
            var deployedReturn = a.deployedReturn || 0;
            var remainCash = a.remainingCash || 0;
            var remainCashReturn = Math.round(remainCash * catRate / 100);

            var afterInvested = pfInvested + deployedAmount;
            var afterReturn = pfReturn + deployedReturn + remainCashReturn;
            var afterYield = (pfInvested + deployedAmount + remainCash) > 0 ? (afterReturn / (pfInvested + deployedAmount + remainCash) * 100) : 0;
            var afterTotal = pfInvested + deployedAmount + remainCash;

            var diffReturn = afterReturn - beforeReturn;
            var diffYield = afterYield - beforeYield;

            // ═══ BEFORE/AFTER TABLE ═══
            var html = '<div style="border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">';
            html += '<div style="padding:10px 14px;background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(139,92,246,0.1));border-bottom:1px solid var(--border)">';
            html += '<span style="font-size:13px;font-weight:700;color:var(--accent)">\ud83d\udcca Comparaison Avant / Apr\u00e8s optimisation</span></div>';

            html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';

            // Header
            html += '<thead><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
            html += '<th style="padding:10px 14px;text-align:left;color:var(--text-muted);font-weight:500;width:35%"></th>';
            html += '<th style="padding:10px 8px;text-align:center;color:var(--text-muted);font-weight:600;width:25%;font-size:11px;text-transform:uppercase">Avant</th>';
            html += '<th style="padding:10px 8px;text-align:center;color:var(--accent);font-weight:700;width:25%;font-size:11px;text-transform:uppercase">\u2192 Apr\u00e8s</th>';
            html += '<th style="padding:10px 8px;text-align:center;color:var(--text-muted);font-weight:600;width:15%;font-size:11px;text-transform:uppercase">Diff.</th>';
            html += '</tr></thead><tbody>';

            // Row: Investi en structurés
            html += _compRow('\ud83c\udfe6 Investi en structur\u00e9s', formatNumber(pfInvested) + '\u20ac', formatNumber(afterInvested) + '\u20ac',
                '+' + formatNumber(deployedAmount) + '\u20ac', deployedAmount > 0 ? 'green' : 'dim');

            // Row: Liquidité disponible
            html += _compRow('\ud83d\udcb0 Liquidit\u00e9 restante', formatNumber(liqTotal) + '\u20ac', formatNumber(remainCash) + '\u20ac',
                '-' + formatNumber(liqTotal - remainCash) + '\u20ac', 'orange');

            // Row: Rendement €/an
            html += _compRow('\ud83d\udcc8 Rendement /an', '+' + formatNumber(beforeReturn) + '\u20ac', '+' + formatNumber(afterReturn) + '\u20ac',
                (diffReturn >= 0 ? '+' : '') + formatNumber(diffReturn) + '\u20ac', diffReturn >= 0 ? 'green' : 'red', true);

            // Row: Rendement %
            html += _compRow('\ud83d\udcca Rendement %', beforeYield.toFixed(2) + '%', afterYield.toFixed(2) + '%',
                (diffYield >= 0 ? '+' : '') + diffYield.toFixed(2) + '%', diffYield >= 0 ? 'green' : 'red', true);

            // Row: Arbitrage (what to withdraw)
            var arbStruct = Math.min(deployedAmount, liqStruct);
            var arbExternal = Math.max(0, deployedAmount - arbStruct);
            var arbDetail = '';
            if (arbStruct > 0 && arbExternal > 0) arbDetail = '\ud83c\udfe6 ' + formatNumber(arbStruct) + '\u20ac struct. + \ud83d\udcb5 ' + formatNumber(arbExternal) + '\u20ac ext.';
            else if (arbStruct > 0) arbDetail = '\ud83c\udfe6 ' + formatNumber(arbStruct) + '\u20ac depuis prod. structur\u00e9s';
            else if (arbExternal > 0) arbDetail = '\ud83d\udcb5 ' + formatNumber(arbExternal) + '\u20ac depuis liquidit\u00e9 externe';

            html += '<tr style="border-top:2px solid var(--accent);background:rgba(59,130,246,0.05)">';
            html += '<td style="padding:10px 14px;font-weight:700;color:var(--accent)">\ud83d\udd04 Arbitrage</td>';
            html += '<td colspan="3" style="padding:10px 14px;text-align:center">';
            html += '<div style="font-size:14px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + formatNumber(deployedAmount) + '\u20ac \u00e0 d\u00e9ployer</div>';
            if (arbDetail) html += '<div style="font-size:10px;color:var(--text-dim);margin-top:2px">' + arbDetail + '</div>';
            html += '</td></tr>';

            html += '</tbody></table></div>';

            // ═══ SUBSCRIPTION PLAN ═══
            var subscriptions = (a.allocationPlan || []).filter(function(p) { return p.allocatedAmount > 0; });
            if (subscriptions.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between">';
                html += '<span style="font-size:12px;font-weight:600;color:var(--green)">\u2705 Plan de souscription</span>';
                html += '<span style="font-size:10px;color:var(--text-dim)">' + subscriptions.length + ' produit(s) \u2192 +' + formatNumber(deployedReturn) + '\u20ac/an</span></div>';

                html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
                html += '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th>';
                html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Grade</th>';
                html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Coupon</th>';
                html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th>';
                html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Esp\u00e9r\u00e9/an</th>';
                html += '<th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">vs CAT</th>';
                html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Source</th>';
                html += '</tr></thead><tbody>';

                subscriptions.forEach(function(p) {
                    var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
                    var poolIcon = p._poolLabel || (p._pool === 'structured' ? '\ud83c\udfe6' : '\ud83d\udcb5');
                    html += '<tr style="border-bottom:1px solid var(--border)">';
                    html += '<td style="padding:8px 10px"><strong style="color:var(--text-bright)">' + (p.name || '').substring(0, 30) + '</strong>';
                    html += '<div style="font-size:9px;color:var(--text-dim)">' + (p.bankName || '') + '</div></td>';
                    html += '<td style="padding:8px 6px;text-align:center"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:12px">' + p.grade + '</span></td>';
                    html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green)">' + p.coupon + '%</td>';
                    html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--cyan)">' + formatNumber(p.allocatedAmount) + '\u20ac</td>';
                    html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">+' + formatNumber(p.expectedReturn || p.annualReturn) + '\u20ac</td>';
                    html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + ((p.excessVsCat || 0) >= 0 ? 'var(--green)' : 'var(--red)') + '">' + ((p.excessVsCat || 0) >= 0 ? '+' : '') + formatNumber(p.excessVsCat || 0) + '\u20ac</td>';
                    html += '<td style="padding:8px 6px;text-align:center;font-size:14px">' + poolIcon + '</td>';
                    html += '</tr>';
                });

                // Total row
                html += '<tr style="border-top:2px solid var(--border);background:var(--bg-elevated)">';
                html += '<td style="padding:8px 10px;font-weight:700;color:var(--text-bright)" colspan="3">TOTAL</td>';
                html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--cyan)">' + formatNumber(deployedAmount) + '\u20ac</td>';
                html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--green)">+' + formatNumber(deployedReturn) + '\u20ac</td>';
                html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:' + ((a.deployedExcess || 0) >= 0 ? 'var(--green)' : 'var(--red)') + '">' + ((a.deployedExcess || 0) >= 0 ? '+' : '') + formatNumber(a.deployedExcess || 0) + '\u20ac</td>';
                html += '<td></td></tr>';
                html += '</tbody></table></div>';
            }

            // ═══ NON-ALLOCATED (ATTENDRE/REJETER) ═══
            var nonAlloc = (a.allocationPlan || []).filter(function(p) { return p.allocatedAmount <= 0 && p.recommendation; });
            if (nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
                html += '<span style="font-size:11px;font-weight:600;color:var(--text-dim)">\u23f3 Non allou\u00e9s</span></div>';
                html += '<div style="padding:8px 14px">';
                nonAlloc.forEach(function(p) {
                    var rc = p.recommendation === 'ATTENDRE' ? 'var(--orange)' : p.recommendation === 'REJETER' ? 'var(--red)' : 'var(--text-dim)';
                    var ri = p.recommendation === 'ATTENDRE' ? '\u23f3' : p.recommendation === 'REJETER' ? '\u274c' : '\u2014';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:11px;' + (p.recommendation === 'REJETER' ? 'opacity:0.5' : '') + '">';
                    html += '<span style="color:var(--text-bright)">' + (p.name || '').substring(0, 35) + ' <span style="color:var(--text-dim)">(' + p.bankName + ')</span></span>';
                    html += '<span style="color:' + rc + ';font-weight:600">' + ri + ' ' + p.recommendation + ' \u2014 ' + p.coupon + '% Grade ' + p.grade + '</span>';
                    html += '</div>';
                });
                html += '</div></div>';
            }

            // Empty states
            if ((a.allocationPlan || []).length === 0 && liqTotal > 0) {
                html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">' + formatNumber(liqTotal) + '\u20ac disponibles mais aucune proposition grad\u00e9e.</div>';
            }
            if (liqTotal === 0) {
                html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Aucune liquidit\u00e9 d\u00e9tect\u00e9e.</div>';
            }

            return html;
        };

        console.log('[StructBoard] Optimizer UI Patch \u2014 before/after comparison table');
    }, 300);
    setTimeout(function() { clearInterval(_waitRender); }, 10000);

    // ═══ HELPER ═══
    function _compRow(label, before, after, diff, diffColor, highlight) {
        var bgStyle = highlight ? 'background:rgba(59,130,246,0.03)' : '';
        var cc = diffColor === 'green' ? 'var(--green)' : diffColor === 'red' ? 'var(--red)' : diffColor === 'orange' ? 'var(--orange)' : 'var(--text-dim)';
        return '<tr style="border-bottom:1px solid var(--border);' + bgStyle + '">' +
            '<td style="padding:8px 14px;font-weight:600;color:var(--text-bright);font-size:12px">' + label + '</td>' +
            '<td style="padding:8px;text-align:center;font-family:var(--mono);color:var(--text-muted);font-size:12px">' + before + '</td>' +
            '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--text-bright);font-size:12px">' + after + '</td>' +
            '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + cc + ';font-size:12px">' + diff + '</td>' +
            '</tr>';
    }
})();

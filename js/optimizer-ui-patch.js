// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer UI Patch v7.1
// v7: Rdt structurés row + Bond 12M arbitrage detail
// v7.1: FIX PERSISTENCE — re-write JSON file after enrichment
//       so data survives page reload
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

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
    function _bigRow(label, before, after, diff, diffColor) {
        var cc = diffColor === 'green' ? 'var(--green)' : diffColor === 'red' ? 'var(--red)' : 'var(--text-dim)';
        return '<tr style="border-bottom:2px solid var(--border);background:rgba(6,214,160,0.04)">' +
            '<td style="padding:12px 16px;font-weight:700;color:var(--text-bright);font-size:14px">' + label + '</td>' +
            '<td style="padding:12px 8px;text-align:center;font-family:var(--mono);color:var(--text-muted);font-size:15px;font-weight:600">' + before + '</td>' +
            '<td style="padding:12px 8px;text-align:center;font-family:var(--mono);font-weight:800;color:var(--green);font-size:15px">' + after + '</td>' +
            '<td style="padding:12px 8px;text-align:center;font-family:var(--mono);font-weight:800;color:' + cc + ';font-size:15px">' + diff + '</td></tr>';
    }
    function _entityLabel(e) { return e === 'bycam' ? '\ud83c\udfe2 ByCam' : e === 'cameleons' ? '\ud83e\udd8e Cam\u00e9leons' : 'Toutes'; }
    function _sourceLabel(p) {
        var pool = p._pool || '', src = p._sourceEntity || '';
        if (src === 'cameleons' && pool === 'structured') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Struct.</span>';
        if (src === 'cameleons') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Cam.</span>';
        if (src === 'bycam') return '<span style="font-size:9px;color:#3B82F6;font-weight:600">\ud83c\udfe2 ByCam</span>';
        if (pool === 'structured') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Struct.</span>';
        if (pool === 'external') return '<span style="font-size:9px;color:var(--green);font-weight:600">\ud83d\udcb5 Ext.</span>';
        return p._poolLabel ? '<span style="font-size:9px;color:var(--text-muted)">' + p._poolLabel + '</span>' : '\u2014';
    }

    // ═══ FIX v7.1: SAVE + PERSIST enriched data to GitHub JSON ═══
    function _tryOverrideSave() {
        if (typeof saveStructOptimizerResult !== 'function') return false;
        var _origSave = saveStructOptimizerResult;
        saveStructOptimizerResult = async function(summary, analysis) {
            // Call original save (writes to GitHub)
            await _origSave(summary, analysis);

            // Enrich _lastStructOptResult IN MEMORY
            if (typeof _lastStructOptResult !== 'undefined' && _lastStructOptResult) {
                _lastStructOptResult._savedAllocation = (analysis.allocationPlan || []).map(function(a) {
                    return {
                        name: a.name, grade: a.grade, score: a.score,
                        allocatedAmount: a.allocatedAmount, coupon: a.coupon,
                        annualReturn: a.annualReturn, expectedReturn: a.expectedReturn,
                        catReturn: a.catReturn, excessVsCat: a.excessVsCat,
                        recommendation: a.recommendation, reason: a.reason, bankName: a.bankName,
                        probCoupon: a.probCoupon || null,
                        _pool: a._pool || null, _poolLabel: a._poolLabel || null,
                        _sourceEntity: a._sourceEntity || null,
                    };
                });
                _lastStructOptResult._savedEntity = analysis._entity || 'all';
                _lastStructOptResult._savedEntityLabel = analysis._entityLabel || _entityLabel(analysis._entity || 'all');
                _lastStructOptResult._savedStructLiq = analysis._structuredLiquidity || 0;
                _lastStructOptResult._savedExtLiq = analysis._externalLiquidity || 0;
                _lastStructOptResult._savedExtByCam = analysis._extByCam || 0;
                _lastStructOptResult._savedExtCameleons = analysis._extCameleons || 0;

                // ★ v7.1: RE-WRITE to GitHub so it persists across reloads
                try {
                    await github.writeFile(
                        CONFIG.DATA_PATH + '/structured-optimizer-result.json',
                        _lastStructOptResult,
                        '[StructBoard] Optimizer v7.1 — enriched save'
                    );
                    console.log('[OptimizerUI] v7.1 persisted enriched data to GitHub');
                } catch(e) {
                    console.warn('[OptimizerUI] v7.1 re-save failed:', e.message);
                }
            }
        };
        return true;
    }

    // ═══ SHARED TABLE ═══
    function _buildTableHTML(a) {
        var pfInvested = a.totalPortfolioInvested || 0, pfReturn = a.totalPortfolioReturn || 0;
        var liqTotal = a.totalLiquidity || 0, catRate = a.catBenchmark || 2.5;
        var liqReturn = Math.round(liqTotal * catRate / 100);
        var deployedAmount = a.deployedAmount || 0, deployedReturn = a.deployedReturn || 0;
        var remainCash = a.remainingCash || 0, remainCashReturn = Math.round(remainCash * catRate / 100);
        var afterInvested = pfInvested + deployedAmount;
        var structRetBefore = pfReturn, structRetAfter = pfReturn + deployedReturn;
        var totalRetBefore = pfReturn + liqReturn, totalRetAfter = pfReturn + deployedReturn + remainCashReturn;
        var totalBefore = pfInvested + liqTotal, totalAfter = pfInvested + deployedAmount + remainCash;
        var yBefore = totalBefore > 0 ? (totalRetBefore / totalBefore * 100) : 0;
        var yAfter = totalAfter > 0 ? (totalRetAfter / totalAfter * 100) : 0;
        var liqStruct = a._structuredLiquidity || a._savedStructLiq || 0;
        var liqExt = a._externalLiquidity || a._savedExtLiq || 0;
        var extBC = a._extByCam || a._savedExtByCam || 0, extCM = a._extCameleons || a._savedExtCameleons || 0;
        var allItems = a.allocationPlan || a._savedAllocation || a.allocation || [];
        var subs = allItems.filter(function(p) { return (p.allocatedAmount || 0) > 0; });
        var nonAlloc = allItems.filter(function(p) { return (p.allocatedAmount || 0) <= 0 && p.recommendation; });
        var eStr = a._entity || a._savedEntity || 'all';
        var eLbl = a._entityLabel || a._savedEntityLabel || _entityLabel(eStr);
        var html = '';

        // Header
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:10px 14px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">';
        html += '<span style="font-size:13px;font-weight:700;color:var(--text-bright)">' + eLbl + '</span><div style="display:flex;gap:12px;font-size:11px">';
        if (liqStruct > 0) html += '<span style="color:#A855F7;font-weight:600">\ud83e\udd8e Struct. ' + fmt(liqStruct) + '\u20ac</span>';
        if (extBC > 0) html += '<span style="color:#3B82F6;font-weight:600">\ud83c\udfe2 ByCam ' + fmt(extBC) + '\u20ac</span>';
        if (extCM > 0) html += '<span style="color:#A855F7;font-weight:600">\ud83e\udd8e Ext. ' + fmt(extCM) + '\u20ac</span>';
        if (liqExt > 0 && extBC === 0 && extCM === 0) html += '<span style="color:var(--green);font-weight:600">\ud83d\udcb5 Ext. ' + fmt(liqExt) + '\u20ac</span>';
        html += '</div></div>';

        // Table
        html += '<div style="border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">';
        html += '<div style="padding:12px 16px;background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.12));border-bottom:1px solid var(--border)">';
        html += '<span style="font-size:14px;font-weight:700;color:var(--accent)">\ud83d\udcca Avant / Apr\u00e8s optimisation</span></div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)">';
        html += '<th style="padding:12px 16px;text-align:left;width:38%"></th>';
        html += '<th style="padding:12px 8px;text-align:center;color:var(--text-muted);font-weight:600;width:22%;font-size:11px;text-transform:uppercase">Avant</th>';
        html += '<th style="padding:12px 8px;text-align:center;color:var(--accent);font-weight:700;width:22%;font-size:11px;text-transform:uppercase">\u2192 Apr\u00e8s</th>';
        html += '<th style="padding:12px 8px;text-align:center;width:18%;font-size:11px;text-transform:uppercase;font-weight:600;color:var(--text-muted)">Diff.</th>';
        html += '</tr></thead><tbody>';
        html += _row('\ud83c\udfe6 Investi structur\u00e9s', fmt(pfInvested) + '\u20ac', fmt(afterInvested) + '\u20ac', '+' + fmt(deployedAmount) + '\u20ac', deployedAmount > 0 ? 'green' : 'dim');
        html += _row('\ud83d\udcb0 Liquidit\u00e9 restante', fmt(liqTotal) + '\u20ac', fmt(remainCash) + '\u20ac', '-' + fmt(liqTotal - remainCash) + '\u20ac', 'orange');
        html += _bigRow('\ud83d\udce6 Rdt structur\u00e9s /an', '+' + fmt(structRetBefore) + '\u20ac', '+' + fmt(structRetAfter) + '\u20ac', '+' + fmt(deployedReturn) + '\u20ac', 'green');
        html += _row('\ud83d\udcc8 Rdt total /an (+ cash)', '+' + fmt(totalRetBefore) + '\u20ac', '+' + fmt(totalRetAfter) + '\u20ac', (totalRetAfter - totalRetBefore >= 0 ? '+' : '') + fmt(totalRetAfter - totalRetBefore) + '\u20ac', totalRetAfter - totalRetBefore >= 0 ? 'green' : 'red');
        html += _row('\ud83d\udcca Rendement %', yBefore.toFixed(2) + '%', yAfter.toFixed(2) + '%', (yAfter - yBefore >= 0 ? '+' : '') + (yAfter - yBefore).toFixed(2) + '%', yAfter - yBefore >= 0 ? 'green' : 'red', true);

        // Arbitrage
        html += '<tr style="border-top:2px solid var(--accent);background:rgba(59,130,246,0.06)"><td style="padding:12px 16px;font-weight:700;color:var(--accent);font-size:13px">\ud83d\udd04 Arbitrage</td>';
        html += '<td colspan="3" style="padding:12px 16px;text-align:center"><div style="font-size:18px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + fmt(deployedAmount) + '\u20ac \u00e0 d\u00e9ployer</div>';
        var det = [];
        if (liqStruct > 0) { var us = Math.min(deployedAmount, liqStruct); if (us > 0) det.push('<span style="color:#A855F7">\ud83e\udd8e Bond 12M arbitr\u00e9 \u2192 ' + fmt(us) + '\u20ac vers Swiss Life</span>'); }
        var ue = Math.max(0, deployedAmount - Math.min(deployedAmount, liqStruct));
        if (ue > 0 && extBC > 0) det.push('<span style="color:#3B82F6">\ud83c\udfe2 ByCam \u2192 ' + fmt(Math.min(ue, extBC)) + '\u20ac vers autres banques</span>');
        if (ue > 0 && extCM > 0) det.push('<span style="color:#A855F7">\ud83e\udd8e Ext. Cam. \u2192 ' + fmt(Math.min(ue, extCM)) + '\u20ac</span>');
        if (ue > 0 && extBC === 0 && extCM === 0 && liqExt > 0) det.push('<span style="color:var(--green)">\ud83d\udcb5 Ext. \u2192 ' + fmt(ue) + '\u20ac</span>');
        if (det.length > 0) { html += '<div style="margin-top:6px;font-size:11px;text-align:left;display:inline-block">'; det.forEach(function(d) { html += '<div style="padding:2px 0">' + d + '</div>'; }); html += '</div>'; }
        html += '</td></tr></tbody></table></div>';

        // Subscription plan
        if (subs.length > 0) {
            html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
            html += '<div style="padding:12px 16px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">';
            html += '<span style="font-size:13px;font-weight:700;color:var(--green)">\u2705 Plan de souscription</span>';
            html += '<span style="font-size:11px;color:var(--text-dim)">' + subs.length + ' produit(s) \u2192 +' + fmt(deployedReturn) + '\u20ac/an esp\u00e9r\u00e9</span></div>';
            html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
            html += '<th style="padding:10px 12px;text-align:left;color:var(--text-muted)">Produit</th>';
            html += '<th style="padding:10px 6px;text-align:center;color:var(--text-muted)">Grade</th>';
            html += '<th style="padding:10px 6px;text-align:center;color:var(--text-muted)">Coupon</th>';
            html += '<th style="padding:10px 6px;text-align:right;color:var(--text-muted)">Montant</th>';
            html += '<th style="padding:10px 6px;text-align:right;color:var(--text-muted)">Esp\u00e9r\u00e9/an</th>';
            html += '<th style="padding:10px 6px;text-align:right;color:var(--text-muted)">vs CAT</th>';
            html += '<th style="padding:10px 6px;text-align:center;color:var(--text-muted)">Source</th>';
            html += '</tr></thead><tbody>';
            subs.forEach(function(p) {
                var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
                var er = p.expectedReturn || p.annualReturn || 0;
                var prob = p.probCoupon ? ' (P=' + Math.round(p.probCoupon * 100) + '%)' : '';
                html += '<tr style="border-bottom:1px solid var(--border)">';
                html += '<td style="padding:10px 12px"><strong style="color:var(--text-bright)">' + (p.name || '').substring(0, 30) + '</strong><div style="font-size:9px;color:var(--text-dim)">' + (p.bankName || '') + prob + '</div></td>';
                html += '<td style="padding:10px 6px;text-align:center"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:13px">' + p.grade + '</span></td>';
                html += '<td style="padding:10px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green);font-size:13px">' + (typeof p.coupon === 'number' ? p.coupon.toFixed(1) : (parseFloat(p.coupon) || 0).toFixed(1)) + '%</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--cyan);font-size:13px">' + fmt(p.allocatedAmount) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">+' + fmt(er) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + ((p.excessVsCat || 0) >= 0 ? 'var(--green)' : 'var(--red)') + '">' + ((p.excessVsCat || 0) >= 0 ? '+' : '') + fmt(p.excessVsCat || 0) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:center">' + _sourceLabel(p) + '</td></tr>';
            });
            var totEx = subs.reduce(function(s, p) { return s + (p.excessVsCat || 0); }, 0);
            html += '<tr style="border-top:2px solid var(--accent);background:var(--bg-elevated)"><td style="padding:10px 12px;font-weight:800;color:var(--text-bright)" colspan="3">TOTAL</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--cyan)">' + fmt(deployedAmount) + '\u20ac</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--green)">+' + fmt(deployedReturn) + '\u20ac</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:' + (totEx >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (totEx >= 0 ? '+' : '') + fmt(totEx) + '\u20ac</td><td></td></tr>';
            html += '</tbody></table></div></div>';
        }
        return { html: html, subscriptions: subs, nonAlloc: nonAlloc, pfInvested: pfInvested, pfReturn: pfReturn };
    }

    // ═══ MODAL ═══
    function _tryOverrideModal() {
        if (typeof renderStructOptimizationTable !== 'function') return false;
        renderStructOptimizationTable = function(a) {
            var r = _buildTableHTML(a); var html = r.html;
            if (a.portfolioAnalysis && a.portfolioAnalysis.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated);display:flex;justify-content:space-between"><span style="font-size:11px;font-weight:600;color:var(--text-dim)">\ud83d\udd12 Portefeuille</span><span style="font-size:10px;color:var(--text-dim)">' + fmt(r.pfInvested) + '\u20ac \u2192 +' + fmt(r.pfReturn) + '\u20ac/an</span></div>';
                html += '<div style="padding:6px 14px;max-height:120px;overflow-y:auto">';
                a.portfolioAnalysis.forEach(function(p) {
                    var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
                    html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:10px"><span><span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:4px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:9px;margin-right:6px">' + (p.grade || '?') + '</span>' + (p.name || '').substring(0, 30) + '</span><span style="font-family:var(--mono);color:var(--text-dim)">' + fmt(p.amount) + '\u20ac \u00e0 ' + (typeof p.coupon === 'number' ? p.coupon.toFixed(1) : (parseFloat(p.coupon) || 0).toFixed(1)) + '% = +' + fmt(p.annualReturn) + '\u20ac</span></div>';
                });
                html += '</div></div>';
            }
            if (r.nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px"><div style="padding:8px 14px;background:var(--bg-elevated)"><span style="font-size:11px;font-weight:600;color:var(--text-dim)">\u274c \u00c9cart\u00e9s (' + r.nonAlloc.length + ')</span></div><div style="padding:6px 14px">';
                r.nonAlloc.forEach(function(p) { html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:10px;' + (p.recommendation === 'REJETER' ? 'opacity:0.5' : '') + '"><span>' + (p.name || '').substring(0, 35) + '</span><span style="color:' + (p.recommendation === 'ATTENDRE' ? 'var(--orange)' : 'var(--red)') + ';font-weight:600">' + p.recommendation + ' ' + (typeof p.coupon === 'number' ? p.coupon.toFixed(1) : (parseFloat(p.coupon) || 0).toFixed(1)) + '% ' + p.grade + '</span></div>'; });
                html += '</div></div>';
            }
            return html;
        };
        return true;
    }

    // ═══ DASHBOARD ═══
    function _tryOverrideDashboard() {
        if (typeof renderStructOptimizerDashboard !== 'function') return false;
        renderStructOptimizerDashboard = function() {
            if (!_lastStructOptResult) return '';
            var r = _lastStructOptResult;
            var dt = r.lastUpdated ? new Date(r.lastUpdated) : null;
            var ds = dt ? dt.toLocaleDateString('fr-FR') + ' ' + dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
            var a = {
                totalPortfolioInvested: r.totalPortfolioInvested || 0, totalPortfolioReturn: r.totalPortfolioReturn || 0,
                totalLiquidity: r.totalLiquidity || 0, catBenchmark: r.catBenchmark || 2.5,
                deployedAmount: r.deployedAmount || 0, deployedReturn: r.deployedReturn || 0, remainingCash: r.remainingCash || 0,
                _structuredLiquidity: r._savedStructLiq || 0, _externalLiquidity: r._savedExtLiq || 0,
                _extByCam: r._savedExtByCam || 0, _extCameleons: r._savedExtCameleons || 0,
                _entity: r._savedEntity || 'all', _entityLabel: r._savedEntityLabel || _entityLabel(r._savedEntity || 'all'),
                allocationPlan: r._savedAllocation || r.allocation || []
            };
            var res = _buildTableHTML(a);
            var html = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:var(--cyan)"></span>\ud83d\udcca Optimisation Structur\u00e9s</div>';
            html += '<div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--text-dim)">' + ds + '</span><button class="btn sm ai-glow" onclick="showStructuredOptimizer()">\ud83d\udd04</button></div></div>';
            html += res.html;
            if (res.nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px"><div style="padding:6px 14px;background:var(--bg-elevated)"><span style="font-size:10px;font-weight:600;color:var(--text-dim)">\u274c \u00c9cart\u00e9s (' + res.nonAlloc.length + ')</span></div><div style="padding:4px 14px">';
                res.nonAlloc.forEach(function(p) { html += '<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px;opacity:0.6"><span>' + (p.name || '').substring(0, 30) + '</span><span style="color:var(--red)">' + (typeof p.coupon === 'number' ? p.coupon.toFixed(1) : (parseFloat(p.coupon) || 0).toFixed(1)) + '% ' + p.grade + '</span></div>'; });
                html += '</div></div>';
            }
            if (r.summary) {
                html += '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden">';
                html += '<div style="padding:10px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:14px">\ud83e\udd16</span><span style="font-size:12px;font-weight:700;color:var(--accent)">Recommandation Claude</span></div>';
                html += '<div style="padding:14px 16px;font-size:11px;line-height:1.7;color:var(--text)" class="ai-summary">' + (typeof formatAIText === 'function' ? formatAIText(r.summary) : r.summary) + '</div></div>';
            }
            html += '</div>';
            return html;
        };
        return true;
    }

    function _tryAll() { var a = _tryOverrideModal(), b = _tryOverrideDashboard(); _tryOverrideSave(); return a && b; }
    if (!_tryAll()) { var _w = setInterval(function() { _tryAll(); if (typeof renderStructOptimizationTable === 'function' && typeof renderStructOptimizerDashboard === 'function') clearInterval(_w); }, 100); setTimeout(function() { clearInterval(_w); }, 12000); }

    console.log('[StructBoard] Optimizer UI v7.1 \u2014 persistent enriched save to GitHub');
})();

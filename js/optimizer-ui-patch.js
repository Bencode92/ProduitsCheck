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

    // ═══ SHARED TABLE v2 — Card-based UI ═══
    function _cpn(v) { return typeof v === 'number' ? v.toFixed(1) : (parseFloat(v) || 0).toFixed(1); }
    function _gc(g) { return { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[g] || '#888'; }
    function _badge(g, s) { var c = _gc(g); return '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:' + c + '22;color:' + c + ';font-weight:700;font-size:13px">' + g + '</span>' + (s != null ? '<span style="font-size:10px;color:var(--text-dim);margin-left:4px">' + s + '</span>' : ''); }

    function _buildTableHTML(a) {
        var pfInvested = a.totalPortfolioInvested || 0, pfReturn = a.totalPortfolioReturn || 0;
        var liqTotal = a.totalLiquidity || 0, catRate = a.catBenchmark || 2.5;
        var liqReturn = Math.round(liqTotal * catRate / 100);
        var deployedAmount = a.deployedAmount || 0;
        var deployedReturn = a.deployedReturn || 0;
        var remainCash = a.remainingCash || (liqTotal - deployedAmount);
        var remainCashReturn = Math.round(remainCash * catRate / 100);
        var afterInvested = pfInvested + deployedAmount;
        var totalRetBefore = pfReturn + liqReturn;
        var totalRetAfter = pfReturn + deployedReturn + remainCashReturn;
        var totalBefore = pfInvested + liqTotal;
        var yBefore = totalBefore > 0 ? (totalRetBefore / totalBefore * 100) : 0;
        var yAfter = totalBefore > 0 ? (totalRetAfter / totalBefore * 100) : 0;
        var liqStruct = a._structuredLiquidity || a._savedStructLiq || 0;
        var liqExt = a._externalLiquidity || a._savedExtLiq || 0;
        var extBC = a._extByCam || a._savedExtByCam || 0, extCM = a._extCameleons || a._savedExtCameleons || 0;
        var allItems = a.allocationPlan || a._savedAllocation || a.allocation || [];
        var subs = allItems.filter(function(p) { return (p.allocatedAmount || 0) > 0; });
        // Recalculate deployedReturn from BS if v4 used facial coupon (= 0)
        if (deployedReturn === 0 && subs.length > 0) {
            deployedReturn = subs.reduce(function(s, p) {
                if (p._rn && p.allocatedAmount > 0) return s + Math.round(p.allocatedAmount * p._rn / 100);
                return s + (p.annualReturn || 0);
            }, 0);
            // Recalculate dependent totals
            totalRetAfter = pfReturn + deployedReturn + remainCashReturn;
            yAfter = totalBefore > 0 ? (totalRetAfter / totalBefore * 100) : 0;
        }
        var nonAlloc = allItems.filter(function(p) { return (p.allocatedAmount || 0) <= 0 && p.recommendation; });
        var eStr = a._entity || a._savedEntity || 'all';
        var eLbl = a._entityLabel || a._savedEntityLabel || _entityLabel(eStr);
        var html = '';

        // ── Header: entity + liquidity sources ──
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:10px 14px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">';
        html += '<span style="font-size:13px;font-weight:700;color:var(--text-bright)">' + eLbl + '</span><div style="display:flex;gap:12px;font-size:11px">';
        if (liqStruct > 0) html += '<span style="color:#A855F7;font-weight:600">\ud83e\udd8e Struct. ' + fmt(liqStruct) + '\u20ac</span>';
        if (extBC > 0) html += '<span style="color:#3B82F6;font-weight:600">\ud83c\udfe2 ByCam ' + fmt(extBC) + '\u20ac</span>';
        if (extCM > 0) html += '<span style="color:#A855F7;font-weight:600">\ud83e\udd8e Ext. ' + fmt(extCM) + '\u20ac</span>';
        html += '</div></div>';

        // ── BLOC 1: AVANT → APRES ──
        html += '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:0;margin-bottom:14px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">';
        html += '<div style="padding:14px;background:var(--bg-card)">';
        html += '<div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:8px">Avant</div>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Investi <span style="float:right;font-family:var(--mono);color:var(--text-bright)">' + fmt(pfInvested) + '\u20ac</span></div>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Cash <span style="float:right;font-family:var(--mono);color:var(--text-bright)">' + fmt(liqTotal) + '\u20ac</span></div>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Rdt/an <span style="float:right;font-family:var(--mono);color:var(--green);font-weight:700">+' + fmt(totalRetBefore) + '\u20ac</span></div>';
        html += '<div style="font-size:11px;color:var(--text-muted)">Yield <span style="float:right;font-family:var(--mono)">' + yBefore.toFixed(1) + '%</span></div>';
        html += '</div>';
        html += '<div style="display:flex;align-items:center;padding:0 10px;background:var(--bg-card);font-size:22px;color:var(--accent)">\u2192</div>';
        html += '<div style="padding:14px;background:var(--bg-card)">';
        html += '<div style="font-size:10px;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:8px">Apr\u00e8s</div>';
        var diffInv = deployedAmount;
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Investi <span style="float:right;font-family:var(--mono);color:var(--text-bright)">' + fmt(afterInvested) + '\u20ac</span>' + (diffInv > 0 ? ' <span style="font-size:9px;color:var(--green)">+' + fmt(diffInv) + '</span>' : '') + '</div>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Cash <span style="float:right;font-family:var(--mono);color:var(--cyan)">' + fmt(remainCash) + '\u20ac</span></div>';
        var diffRdt = totalRetAfter - totalRetBefore;
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Rdt/an <span style="float:right;font-family:var(--mono);color:var(--green);font-weight:700">+' + fmt(totalRetAfter) + '\u20ac</span>' + (diffRdt > 0 ? ' <span style="font-size:9px;color:var(--green)">+' + fmt(diffRdt) + '</span>' : diffRdt < 0 ? ' <span style="font-size:9px;color:var(--red)">' + fmt(diffRdt) + '</span>' : '') + '</div>';
        html += '<div style="font-size:11px;color:var(--text-muted)">Yield <span style="float:right;font-family:var(--mono);color:' + (yAfter > yBefore ? 'var(--green)' : 'var(--text-bright)') + '">' + yAfter.toFixed(1) + '%</span></div>';
        html += '</div></div>';

        // ── BLOC 2: ACTION CARDS ──
        subs.forEach(function(p) {
            // Fix: if BS rendement exists but annualReturn is 0, recalculate here
            if (p._rn && p.allocatedAmount > 0 && (!p.annualReturn || p.annualReturn === 0)) {
                p.annualReturn = Math.round(p.allocatedAmount * p._rn / 100);
                p.expectedReturn = p.annualReturn;
                p.catReturn = Math.round(p.allocatedAmount * catRate / 100);
                p.excessVsCat = p.annualReturn - p.catReturn;
                p.coupon = Math.round(p._rn * 10) / 10;
            }
            var isArb = p._v4match === 'ARBITRAGE' || p.recommendation === 'ARBITRER';
            var borderC = isArb ? 'rgba(78,205,196,0.3)' : 'rgba(6,214,160,0.3)';
            var bgC = isArb ? 'rgba(78,205,196,0.04)' : 'rgba(6,214,160,0.04)';
            var c = _gc(p.grade);
            html += '<div style="border:1px solid ' + borderC + ';background:' + bgC + ';border-radius:var(--radius-sm);padding:12px;margin-bottom:8px">';
            // Header
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
            html += '<span style="font-size:12px;font-weight:700;color:' + (isArb ? 'var(--cyan)' : 'var(--green)') + '">' + (isArb ? '\ud83d\udd04 ARBITRER' : '\u2705 SOUSCRIRE') + '</span>';
            html += _sourceLabel(p);
            html += '</div>';
            // Arbitrage flow
            if (isArb) {
                html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:10px;color:var(--text-muted)">';
                html += '<span style="background:var(--bg-elevated);padding:3px 6px;border-radius:4px">' + (p.bankName || '') + ' liquidit\u00e9</span>';
                html += '<span style="color:var(--cyan)">\u2192</span>';
                html += '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + fmt(p.allocatedAmount) + '\u20ac</span>';
                html += '<span style="color:var(--cyan)">\u2192</span>';
                html += '</div>';
            }
            // Product
            html += '<div style="display:flex;align-items:center;gap:10px">';
            html += '<div>' + _badge(p.grade, p.score) + '</div>';
            html += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (p.name || '') + '</div>';
            html += '<div style="font-size:10px;color:var(--text-dim)">' + (p.bankName || '') + (p.capitalProtected ? ' \u00b7 \ud83d\udee1\ufe0f garanti' : '') + '</div></div>';
            html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;font-size:14px;color:var(--cyan)">' + fmt(p.allocatedAmount) + '\u20ac</div>';
            html += '<div style="font-family:var(--mono);font-size:11px;color:var(--green)">+' + fmt(p.expectedReturn || p.annualReturn || 0) + '\u20ac/an</div></div></div>';
            // Details
            html += '<div style="display:flex;gap:10px;margin-top:6px;font-size:10px;color:var(--text-dim)">';
            html += '<span>Coupon ' + _cpn(p.coupon) + '%</span>';
            if (p.probCoupon) html += '<span>P=' + Math.round(p.probCoupon * 100) + '%</span>';
            if (p._rn != null) html += '<span>BS net ' + p._rn.toFixed(1) + '%</span>';
            if ((p.excessVsCat || 0) > 0) html += '<span style="color:var(--green)">+' + fmt(p.excessVsCat) + '\u20ac vs CAT</span>';
            html += '</div></div>';
        });

        // Cash card
        if (remainCash > 0) {
            html += '<div style="border:1px solid rgba(148,163,184,0.2);background:rgba(148,163,184,0.03);border-radius:var(--radius-sm);padding:12px;margin-bottom:8px">';
            html += '<div style="display:flex;align-items:center;justify-content:space-between">';
            html += '<div><div style="font-size:12px;font-weight:700;color:var(--text-muted)">\ud83d\udcb0 Cash conserv\u00e9</div>';
            html += '<div style="font-size:10px;color:var(--text-dim);margin-top:2px">' + (a.cashReason || 'CAT ' + catRate.toFixed(1) + '% sans risque') + '</div></div>';
            html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;font-size:14px;color:var(--text-bright)">' + fmt(remainCash) + '\u20ac</div>';
            html += '<div style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">+' + fmt(remainCashReturn) + '\u20ac/an</div></div></div></div>';
        }

        // No deployment
        if (subs.length === 0 && liqTotal > 0) {
            html += '<div style="padding:16px;text-align:center;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px"><div style="font-size:12px;color:var(--text-muted)">\ud83d\udcb0 Garder ' + fmt(liqTotal) + '\u20ac en CAT (' + catRate.toFixed(1) + '%). Aucune proposition ne justifie le risque.</div></div>';
        }

        return { html: html, subscriptions: subs, nonAlloc: nonAlloc, pfInvested: pfInvested, pfReturn: pfReturn };
    }

    // ═══ MODAL ═══
    function _tryOverrideModal() {
        if (typeof renderStructOptimizationTable !== 'function') return false;
        renderStructOptimizationTable = function(a) {
            var r = _buildTableHTML(a); var html = r.html;
            // Portfolio (collapsible)
            if (a.portfolioAnalysis && a.portfolioAnalysis.length > 0) {
                html += '<details style="margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">';
                html += '<summary style="padding:8px 14px;background:var(--bg-elevated);cursor:pointer;font-size:11px;font-weight:600;color:var(--text-dim);display:flex;justify-content:space-between;align-items:center"><span>\ud83d\udd12 Portefeuille (' + a.portfolioAnalysis.length + ')</span><span style="font-weight:400">' + fmt(r.pfInvested) + '\u20ac \u2192 +' + fmt(r.pfReturn) + '\u20ac/an</span></summary>';
                a.portfolioAnalysis.forEach(function(p) {
                    var c = _gc(p.grade);
                    html += '<div style="padding:6px 14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:10px;opacity:0.8">';
                    html += '<span style="width:18px;height:18px;line-height:18px;text-align:center;border-radius:4px;background:' + c + '22;color:' + c + ';font-weight:700;font-size:9px;flex-shrink:0">' + (p.grade || '?') + '</span>';
                    html += '<span style="flex:1;color:var(--text-bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (p.name || '').substring(0, 30) + '</span>';
                    html += '<span style="font-family:var(--mono);color:var(--text-dim)">' + fmt(p.amount) + '\u20ac</span>';
                    html += '<span style="font-family:var(--mono);color:var(--green)">+' + fmt(p.annualReturn) + '\u20ac</span></div>';
                });
                html += '</details>';
            }
            // Ecart\u00e9s (collapsible)
            if (r.nonAlloc.length > 0) {
                html += '<details style="margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">';
                html += '<summary style="padding:8px 14px;background:var(--bg-elevated);cursor:pointer;font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center"><span>\u274c \u00c9cart\u00e9s (' + r.nonAlloc.length + ')</span><span style="font-size:10px;color:var(--text-dim)">cliquer pour voir</span></summary>';
                r.nonAlloc.forEach(function(p) {
                    var rc = { 'ATTENDRE':'var(--orange)', 'PASSER':'var(--red)', 'IMPOSSIBLE':'#888' }[p.recommendation] || 'var(--text-dim)';
                    html += '<div style="padding:4px 14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:6px;font-size:10px;opacity:0.6">';
                    html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (p.name || '').substring(0, 35) + '</span>';
                    html += '<span style="font-family:var(--mono)">' + _cpn(p.coupon) + '%</span>';
                    html += '<span style="padding:2px 6px;border-radius:8px;font-size:9px;font-weight:600;color:' + rc + ';background:' + rc + '12">' + p.recommendation + '</span></div>';
                });
                html += '</details>';
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
                html += '<details style="margin-bottom:8px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">';
                html += '<summary style="padding:6px 14px;background:var(--bg-elevated);cursor:pointer;font-size:10px;color:var(--text-dim)">\u274c \u00c9cart\u00e9s (' + res.nonAlloc.length + ')</summary>';
                res.nonAlloc.forEach(function(p) {
                    html += '<div style="padding:3px 14px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:10px;opacity:0.6"><span>' + (p.name || '').substring(0, 30) + '</span><span style="color:var(--red)">' + _cpn(p.coupon) + '% ' + p.grade + '</span></div>';
                });
                html += '</details>';
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

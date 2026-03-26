// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer UI Patch v6
// v5: clear source labels + entity breakdown
// v6: FIX save — post-enrich _lastStructOptResult after save
//     so dashboard has _savedAllocation, _extByCam, etc.
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

    function _entityLabel(entity) {
        if (entity === 'bycam') return '\ud83c\udfe2 ByCam';
        if (entity === 'cameleons') return '\ud83e\udd8e Cam\u00e9leons';
        return 'Toutes entit\u00e9s';
    }

    function _sourceLabel(p) {
        var pool = p._pool || '';
        var src = p._sourceEntity || '';
        if (src === 'cameleons' && pool === 'structured') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Struct.</span>';
        if (src === 'cameleons') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Cam.</span>';
        if (src === 'bycam') return '<span style="font-size:9px;color:#3B82F6;font-weight:600">\ud83c\udfe2 ByCam</span>';
        if (pool === 'structured') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Struct.</span>';
        if (pool === 'external') return '<span style="font-size:9px;color:var(--green);font-weight:600">\ud83d\udcb5 Ext.</span>';
        var lbl = p._poolLabel || '';
        if (lbl) return '<span style="font-size:9px;color:var(--text-muted)">' + lbl + '</span>';
        return '<span style="font-size:9px;color:var(--text-dim)">\u2014</span>';
    }

    // ═══ FIX v6: Override save to POST-ENRICH _lastStructOptResult ═══
    function _tryOverrideSave() {
        if (typeof saveStructOptimizerResult !== 'function') return false;
        var _origSave = saveStructOptimizerResult;
        saveStructOptimizerResult = async function(summary, analysis) {
            // Call original save first
            await _origSave(summary, analysis);
            // POST-ENRICH: add our fields directly to _lastStructOptResult
            if (typeof _lastStructOptResult !== 'undefined' && _lastStructOptResult) {
                _lastStructOptResult._savedAllocation = (analysis.allocationPlan || []).map(function(a) {
                    return {
                        name: a.name, grade: a.grade, score: a.score,
                        allocatedAmount: a.allocatedAmount, coupon: a.coupon,
                        annualReturn: a.annualReturn, expectedReturn: a.expectedReturn,
                        catReturn: a.catReturn, excessVsCat: a.excessVsCat,
                        recommendation: a.recommendation, reason: a.reason, bankName: a.bankName,
                        probCoupon: a.probCoupon || null,
                        _pool: a._pool || null,
                        _poolLabel: a._poolLabel || null,
                        _sourceEntity: a._sourceEntity || null,
                    };
                });
                _lastStructOptResult._savedEntity = analysis._entity || 'all';
                _lastStructOptResult._savedEntityLabel = analysis._entityLabel || _entityLabel(analysis._entity || 'all');
                _lastStructOptResult._savedStructLiq = analysis._structuredLiquidity || 0;
                _lastStructOptResult._savedExtLiq = analysis._externalLiquidity || 0;
                _lastStructOptResult._savedExtByCam = analysis._extByCam || 0;
                _lastStructOptResult._savedExtCameleons = analysis._extCameleons || 0;
                console.log('[OptimizerUI] v6 save enriched: entity=' + _lastStructOptResult._savedEntity + ' struct=' + _lastStructOptResult._savedStructLiq + ' extBC=' + _lastStructOptResult._savedExtByCam + ' extCM=' + _lastStructOptResult._savedExtCameleons);
            }
        };
        return true;
    }

    // ═══ SHARED TABLE BUILDER ═══
    function _buildTableHTML(a) {
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

        var liqStruct = a._structuredLiquidity || a._savedStructLiq || 0;
        var liqExternal = a._externalLiquidity || a._savedExtLiq || 0;
        var extByCam = a._extByCam || a._savedExtByCam || 0;
        var extCameleons = a._extCameleons || a._savedExtCameleons || 0;

        var allItems = a.allocationPlan || a._savedAllocation || a.allocation || [];
        var subscriptions = allItems.filter(function(p) { return (p.allocatedAmount || 0) > 0; });
        var nonAlloc = allItems.filter(function(p) { return (p.allocatedAmount || 0) <= 0 && p.recommendation; });

        var entityStr = a._entity || a._savedEntity || 'all';
        var entityLabelStr = a._entityLabel || a._savedEntityLabel || _entityLabel(entityStr);

        var html = '';

        // ═══ ENTITY + SOURCE HEADER ═══
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:10px 14px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">';
        html += '<span style="font-size:13px;font-weight:700;color:var(--text-bright)">' + entityLabelStr + '</span>';
        html += '<div style="display:flex;gap:12px;font-size:11px">';
        if (liqStruct > 0) html += '<span style="color:#A855F7;font-weight:600">\ud83e\udd8e Struct. ' + fmt(liqStruct) + '\u20ac</span>';
        if (extByCam > 0) html += '<span style="color:#3B82F6;font-weight:600">\ud83c\udfe2 ByCam ' + fmt(extByCam) + '\u20ac</span>';
        if (extCameleons > 0) html += '<span style="color:#A855F7;font-weight:600">\ud83e\udd8e Ext. ' + fmt(extCameleons) + '\u20ac</span>';
        if (liqExternal > 0 && extByCam === 0 && extCameleons === 0) html += '<span style="color:var(--green);font-weight:600">\ud83d\udcb5 Ext. ' + fmt(liqExternal) + '\u20ac</span>';
        html += '</div></div>';

        // ═══ BEFORE / AFTER TABLE ═══
        html += '<div style="border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">';
        html += '<div style="padding:12px 16px;background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.12));border-bottom:1px solid var(--border)">';
        html += '<span style="font-size:14px;font-weight:700;color:var(--accent)">\ud83d\udcca Avant / Apr\u00e8s optimisation</span></div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
        html += '<thead><tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)">';
        html += '<th style="padding:12px 16px;text-align:left;width:38%"></th>';
        html += '<th style="padding:12px 8px;text-align:center;color:var(--text-muted);font-weight:600;width:22%;font-size:11px;text-transform:uppercase">Avant</th>';
        html += '<th style="padding:12px 8px;text-align:center;color:var(--accent);font-weight:700;width:22%;font-size:11px;text-transform:uppercase">\u2192 Apr\u00e8s</th>';
        html += '<th style="padding:12px 8px;text-align:center;width:18%;font-size:11px;text-transform:uppercase;font-weight:600;color:var(--text-muted)">Diff.</th>';
        html += '</tr></thead><tbody>';
        html += _row('\ud83c\udfe6 Investi structur\u00e9s', fmt(pfInvested) + '\u20ac', fmt(afterInvested) + '\u20ac', '+' + fmt(deployedAmount) + '\u20ac', deployedAmount > 0 ? 'green' : 'dim');
        html += _row('\ud83d\udcb0 Liquidit\u00e9 restante', fmt(liqTotal) + '\u20ac', fmt(remainCash) + '\u20ac', '-' + fmt(liqTotal - remainCash) + '\u20ac', 'orange');
        html += _row('\ud83d\udcc8 Rendement /an', '+' + fmt(beforeReturn) + '\u20ac', '+' + fmt(afterReturn) + '\u20ac', (diffReturn >= 0 ? '+' : '') + fmt(diffReturn) + '\u20ac', diffReturn >= 0 ? 'green' : 'red', true);
        html += _row('\ud83d\udcca Rendement %', beforeYield.toFixed(2) + '%', afterYield.toFixed(2) + '%', (diffYield >= 0 ? '+' : '') + diffYield.toFixed(2) + '%', diffYield >= 0 ? 'green' : 'red', true);

        // Arbitrage row with per-source breakdown
        html += '<tr style="border-top:2px solid var(--accent);background:rgba(59,130,246,0.06)">';
        html += '<td style="padding:12px 16px;font-weight:700;color:var(--accent);font-size:13px">\ud83d\udd04 Arbitrage</td>';
        html += '<td colspan="3" style="padding:12px 16px;text-align:center">';
        html += '<div style="font-size:18px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + fmt(deployedAmount) + '\u20ac \u00e0 d\u00e9ployer</div>';
        var parts = [];
        if (liqStruct > 0) { var us = Math.min(deployedAmount, liqStruct); if (us > 0) parts.push('<span style="color:#A855F7">\ud83e\udd8e ' + fmt(us) + '\u20ac struct.</span>'); }
        var ue = Math.max(0, deployedAmount - Math.min(deployedAmount, liqStruct));
        if (ue > 0 && extByCam > 0) parts.push('<span style="color:#3B82F6">\ud83c\udfe2 ' + fmt(Math.min(ue, extByCam)) + '\u20ac ByCam</span>');
        if (ue > 0 && extCameleons > 0) parts.push('<span style="color:#A855F7">\ud83e\udd8e ' + fmt(Math.min(ue, extCameleons)) + '\u20ac ext.</span>');
        if (ue > 0 && extByCam === 0 && extCameleons === 0 && liqExternal > 0) parts.push('<span style="color:var(--green)">\ud83d\udcb5 ' + fmt(ue) + '\u20ac ext.</span>');
        if (parts.length > 0) html += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">' + parts.join(' + ') + '</div>';
        html += '</td></tr></tbody></table></div>';

        // ═══ SUBSCRIPTION PLAN ═══
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
                var srcHtml = _sourceLabel(p);
                var probText = p.probCoupon ? ' (P=' + Math.round(p.probCoupon * 100) + '%)' : '';
                var er = p.expectedReturn || p.annualReturn || 0;
                html += '<tr style="border-bottom:1px solid var(--border)">';
                html += '<td style="padding:10px 12px"><strong style="color:var(--text-bright)">' + (p.name || '').substring(0, 30) + '</strong>';
                html += '<div style="font-size:9px;color:var(--text-dim)">' + (p.bankName || '') + probText + '</div></td>';
                html += '<td style="padding:10px 6px;text-align:center"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:13px">' + p.grade + '</span></td>';
                html += '<td style="padding:10px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green);font-size:13px">' + p.coupon + '%</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--cyan);font-size:13px">' + fmt(p.allocatedAmount) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">+' + fmt(er) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + ((p.excessVsCat || 0) >= 0 ? 'var(--green)' : 'var(--red)') + '">' + ((p.excessVsCat || 0) >= 0 ? '+' : '') + fmt(p.excessVsCat || 0) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:center">' + srcHtml + '</td></tr>';
            });

            var totalExcess = subscriptions.reduce(function(s, p) { return s + (p.excessVsCat || 0); }, 0);
            html += '<tr style="border-top:2px solid var(--accent);background:var(--bg-elevated)">';
            html += '<td style="padding:10px 12px;font-weight:800;color:var(--text-bright)" colspan="3">TOTAL</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--cyan)">' + fmt(deployedAmount) + '\u20ac</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--green)">+' + fmt(deployedReturn) + '\u20ac</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:' + (totalExcess >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (totalExcess >= 0 ? '+' : '') + fmt(totalExcess) + '\u20ac</td>';
            html += '<td></td></tr></tbody></table></div></div>';
        }

        return { html: html, subscriptions: subscriptions, nonAlloc: nonAlloc, pfInvested: pfInvested, pfReturn: pfReturn };
    }

    // ═══ MODAL ═══
    function _tryOverrideModal() {
        if (typeof renderStructOptimizationTable !== 'function') return false;
        renderStructOptimizationTable = function(analysis) {
            var r = _buildTableHTML(analysis);
            var html = r.html;
            var a = analysis;
            if (a.portfolioAnalysis && a.portfolioAnalysis.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between">';
                html += '<span style="font-size:11px;font-weight:600;color:var(--text-dim)">\ud83d\udd12 Portefeuille</span>';
                html += '<span style="font-size:10px;color:var(--text-dim)">' + fmt(r.pfInvested) + '\u20ac \u2192 +' + fmt(r.pfReturn) + '\u20ac/an</span></div>';
                html += '<div style="padding:6px 14px;max-height:120px;overflow-y:auto">';
                a.portfolioAnalysis.forEach(function(p) {
                    var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
                    html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:10px">';
                    html += '<span><span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:4px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:9px;margin-right:6px">' + (p.grade || '?') + '</span>' + (p.name || '').substring(0, 30) + '</span>';
                    html += '<span style="font-family:var(--mono);color:var(--text-dim)">' + fmt(p.amount) + '\u20ac \u00e0 ' + p.coupon + '% = +' + fmt(p.annualReturn) + '\u20ac</span></div>';
                });
                html += '</div></div>';
            }
            if (r.nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated)"><span style="font-size:11px;font-weight:600;color:var(--text-dim)">\u274c \u00c9cart\u00e9s (' + r.nonAlloc.length + ')</span></div>';
                html += '<div style="padding:6px 14px">';
                r.nonAlloc.forEach(function(p) {
                    var rc = p.recommendation === 'ATTENDRE' ? 'var(--orange)' : 'var(--red)';
                    html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:10px;' + (p.recommendation === 'REJETER' ? 'opacity:0.5' : '') + '">';
                    html += '<span>' + (p.name || '').substring(0, 35) + '</span>';
                    html += '<span style="color:' + rc + ';font-weight:600">' + p.recommendation + ' ' + p.coupon + '% ' + p.grade + '</span></div>';
                });
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

            var analysis = {
                totalPortfolioInvested: r.totalPortfolioInvested || 0,
                totalPortfolioReturn: r.totalPortfolioReturn || 0,
                totalLiquidity: r.totalLiquidity || 0,
                catBenchmark: r.catBenchmark || 2.5,
                deployedAmount: r.deployedAmount || 0,
                deployedReturn: r.deployedReturn || 0,
                remainingCash: r.remainingCash || 0,
                _structuredLiquidity: r._savedStructLiq || 0,
                _externalLiquidity: r._savedExtLiq || 0,
                _extByCam: r._savedExtByCam || 0,
                _extCameleons: r._savedExtCameleons || 0,
                _entity: r._savedEntity || 'all',
                _entityLabel: r._savedEntityLabel || _entityLabel(r._savedEntity || 'all'),
                allocationPlan: r._savedAllocation || r.allocation || []
            };

            var result = _buildTableHTML(analysis);
            var html = '<div class="section">';
            html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--cyan)"></span>\ud83d\udcca Optimisation Structur\u00e9s</div>';
            html += '<div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--text-dim)">' + ds + '</span>';
            html += '<button class="btn sm ai-glow" onclick="showStructuredOptimizer()">\ud83d\udd04</button></div></div>';

            html += result.html;

            if (result.nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:6px 14px;background:var(--bg-elevated)"><span style="font-size:10px;font-weight:600;color:var(--text-dim)">\u274c \u00c9cart\u00e9s (' + result.nonAlloc.length + ')</span></div>';
                html += '<div style="padding:4px 14px">';
                result.nonAlloc.forEach(function(p) {
                    html += '<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px;opacity:0.6">';
                    html += '<span>' + (p.name || '').substring(0, 30) + '</span>';
                    html += '<span style="color:var(--red)">' + p.coupon + '% ' + p.grade + '</span></div>';
                });
                html += '</div></div>';
            }

            if (r.summary) {
                html += '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden">';
                html += '<div style="padding:10px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px">';
                html += '<span style="font-size:14px">\ud83e\udd16</span><span style="font-size:12px;font-weight:700;color:var(--accent)">Recommandation Claude</span></div>';
                html += '<div style="padding:14px 16px;font-size:11px;line-height:1.7;color:var(--text)" class="ai-summary">' + (typeof formatAIText === 'function' ? formatAIText(r.summary) : r.summary) + '</div></div>';
            }
            html += '</div>';
            return html;
        };
        return true;
    }

    // ═══ INIT ═══
    function _tryAll() {
        var a = _tryOverrideModal();
        var b = _tryOverrideDashboard();
        _tryOverrideSave();
        return a && b;
    }
    if (!_tryAll()) {
        var _w = setInterval(function() { _tryAll(); if (typeof renderStructOptimizationTable === 'function' && typeof renderStructOptimizerDashboard === 'function') clearInterval(_w); }, 100);
        setTimeout(function() { clearInterval(_w); }, 12000);
    }

    console.log('[StructBoard] Optimizer UI v6 \u2014 fixed save enrichment + source column');
})();

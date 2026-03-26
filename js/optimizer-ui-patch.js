// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer UI Patch v5
// v4: Entity labels + enriched save + Source column on dashboard
// v5: Clear source labels (🦎 Struct. / 🏢 ByCam / etc.)
//     + entity breakdown in header
//     + pool tracks entity origin, not just struct/external
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

    // ═══ SOURCE LABEL — shows WHERE the money comes from ═══
    // Instead of just 🏦/💵, show entity + type
    function _sourceLabel(p, entityMode) {
        var pool = p._pool || '';
        var srcEntity = p._sourceEntity || '';

        // If we have explicit source entity
        if (srcEntity === 'cameleons' && pool === 'structured') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Struct.</span>';
        if (srcEntity === 'cameleons' && pool === 'external') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Ext.</span>';
        if (srcEntity === 'bycam') return '<span style="font-size:9px;color:#3B82F6;font-weight:600">\ud83c\udfe2 ByCam</span>';

        // Fallback: infer from pool type
        if (pool === 'structured') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Struct.</span>';
        if (pool === 'external') {
            // In single-entity mode, we know which entity
            if (entityMode === 'bycam') return '<span style="font-size:9px;color:#3B82F6;font-weight:600">\ud83c\udfe2 ByCam</span>';
            if (entityMode === 'cameleons') return '<span style="font-size:9px;color:#A855F7;font-weight:600">\ud83e\udd8e Cam.</span>';
            return '<span style="font-size:9px;color:var(--green);font-weight:600">\ud83d\udcb5 Externe</span>';
        }

        // Last fallback
        var poolLabel = p._poolLabel || '';
        if (poolLabel) return '<span style="font-size:9px;color:var(--text-dim)">' + poolLabel + '</span>';
        return '<span style="font-size:9px;color:var(--text-dim)">\u2014</span>';
    }

    // ═══════════════════════════════════════════════════════════
    // OVERRIDE saveStructOptimizerResult — enrich with entity source
    // ═══════════════════════════════════════════════════════════
    function _tryOverrideSave() {
        if (typeof saveStructOptimizerResult !== 'function') return false;

        var _origSave = saveStructOptimizerResult;
        saveStructOptimizerResult = async function(summary, analysis) {
            if (analysis.allocationPlan) {
                analysis._savedAllocation = analysis.allocationPlan.map(function(a) {
                    return {
                        name: a.name, grade: a.grade, score: a.score,
                        allocatedAmount: a.allocatedAmount, coupon: a.coupon,
                        annualReturn: a.annualReturn, expectedReturn: a.expectedReturn,
                        catReturn: a.catReturn, excessVsCat: a.excessVsCat,
                        recommendation: a.recommendation, reason: a.reason,
                        bankName: a.bankName,
                        probCoupon: a.probCoupon || null,
                        _pool: a._pool || null,
                        _poolLabel: a._poolLabel || null,
                        _sourceEntity: a._sourceEntity || null,
                        _gradeMultiplier: a._gradeMultiplier || null,
                        entity: a.entity || null,
                    };
                });
            }
            analysis._savedEntity = analysis._entity || (window._optimizerOptions || {}).entity || 'all';
            analysis._savedEntityLabel = analysis._entityLabel || _entityLabel(analysis._savedEntity);
            analysis._savedStructLiq = analysis._structuredLiquidity || 0;
            analysis._savedExtLiq = analysis._externalLiquidity || 0;
            // Save per-entity breakdown
            analysis._savedExtByCam = analysis._extByCam || 0;
            analysis._savedExtCameleons = analysis._extCameleons || 0;

            return _origSave(summary, analysis);
        };
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    // SHARED: Build Before/After + Subscription Plan HTML
    // ═══════════════════════════════════════════════════════════
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
        if (liqStruct === 0 && liqExternal === 0 && liqTotal > 0) liqStruct = liqTotal;

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

        // ═══ 1. BEFORE / AFTER TABLE ═══
        html += '<div style="border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">';
        html += '<div style="padding:12px 16px;background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.12));border-bottom:1px solid var(--border)">';
        html += '<span style="font-size:14px;font-weight:700;color:var(--accent)">\ud83d\udcca Avant / Apr\u00e8s optimisation</span></div>';

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

        // Arbitrage row — breakdown by source
        html += '<tr style="border-top:2px solid var(--accent);background:rgba(59,130,246,0.06)">';
        html += '<td style="padding:12px 16px;font-weight:700;color:var(--accent);font-size:13px">\ud83d\udd04 Arbitrage</td>';
        html += '<td colspan="3" style="padding:12px 16px;text-align:center">';
        html += '<div style="font-size:18px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + fmt(deployedAmount) + '\u20ac \u00e0 d\u00e9ployer</div>';
        // Show per-source breakdown
        var arbParts = [];
        if (liqStruct > 0) {
            var usedStruct = Math.min(deployedAmount, liqStruct);
            if (usedStruct > 0) arbParts.push('<span style="color:#A855F7">\ud83e\udd8e ' + fmt(usedStruct) + '\u20ac struct.</span>');
        }
        var usedExternal = Math.max(0, deployedAmount - Math.min(deployedAmount, liqStruct));
        if (usedExternal > 0 && extByCam > 0) arbParts.push('<span style="color:#3B82F6">\ud83c\udfe2 ' + fmt(Math.min(usedExternal, extByCam)) + '\u20ac ByCam</span>');
        if (usedExternal > 0 && extCameleons > 0) arbParts.push('<span style="color:#A855F7">\ud83e\udd8e ' + fmt(Math.min(usedExternal, extCameleons)) + '\u20ac ext. Cam.</span>');
        if (usedExternal > 0 && extByCam === 0 && extCameleons === 0 && liqExternal > 0) arbParts.push('<span style="color:var(--green)">\ud83d\udcb5 ' + fmt(usedExternal) + '\u20ac externe</span>');
        if (arbParts.length > 0) html += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">' + arbParts.join(' + ') + '</div>';
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
                var srcHtml = _sourceLabel(p, entityStr);
                var probText = p.probCoupon ? ' (P=' + Math.round(p.probCoupon * 100) + '%)' : '';
                var expectedRet = p.expectedReturn || p.annualReturn || 0;

                html += '<tr style="border-bottom:1px solid var(--border)">';
                html += '<td style="padding:10px 12px"><strong style="color:var(--text-bright)">' + (p.name || '').substring(0, 30) + '</strong>';
                html += '<div style="font-size:9px;color:var(--text-dim)">' + (p.bankName || '') + probText + '</div></td>';
                html += '<td style="padding:10px 6px;text-align:center"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:13px">' + p.grade + '</span></td>';
                html += '<td style="padding:10px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green);font-size:13px">' + p.coupon + '%</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--cyan);font-size:13px">' + fmt(p.allocatedAmount) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">+' + fmt(expectedRet) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + ((p.excessVsCat || 0) >= 0 ? 'var(--green)' : 'var(--red)') + '">' + ((p.excessVsCat || 0) >= 0 ? '+' : '') + fmt(p.excessVsCat || 0) + '\u20ac</td>';
                html += '<td style="padding:10px 6px;text-align:center">' + srcHtml + '</td>';
                html += '</tr>';
            });

            var totalExcess = subscriptions.reduce(function(s, p) { return s + (p.excessVsCat || 0); }, 0);
            html += '<tr style="border-top:2px solid var(--accent);background:var(--bg-elevated)">';
            html += '<td style="padding:10px 12px;font-weight:800;color:var(--text-bright);font-size:12px" colspan="3">TOTAL</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--cyan);font-size:13px">' + fmt(deployedAmount) + '\u20ac</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--green);font-size:13px">+' + fmt(deployedReturn) + '\u20ac</td>';
            html += '<td style="padding:10px 6px;text-align:right;font-family:var(--mono);font-weight:800;color:' + (totalExcess >= 0 ? 'var(--green)' : 'var(--red)') + ';font-size:13px">' + (totalExcess >= 0 ? '+' : '') + fmt(totalExcess) + '\u20ac</td>';
            html += '<td></td></tr>';
            html += '</tbody></table></div></div>';
        }

        return { html: html, subscriptions: subscriptions, nonAlloc: nonAlloc, pfInvested: pfInvested, pfReturn: pfReturn, entityStr: entityStr };
    }

    // ═══════════════════════════════════════════════════════════
    // PART A: MODAL TABLE
    // ═══════════════════════════════════════════════════════════
    function _tryOverrideModal() {
        if (typeof renderStructOptimizationTable !== 'function') return false;

        renderStructOptimizationTable = function(analysis) {
            var result = _buildTableHTML(analysis);
            var html = result.html;
            var a = analysis;

            // Portfolio compact
            if (a.portfolioAnalysis && a.portfolioAnalysis.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">';
                html += '<span style="font-size:11px;font-weight:600;color:var(--text-dim)">\ud83d\udd12 Portefeuille existant</span>';
                html += '<span style="font-size:10px;color:var(--text-dim)">' + fmt(result.pfInvested) + '\u20ac \u2192 +' + fmt(result.pfReturn) + '\u20ac/an</span></div>';
                html += '<div style="padding:6px 14px;max-height:120px;overflow-y:auto">';
                a.portfolioAnalysis.forEach(function(p) {
                    var gc = { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[p.grade] || '#888';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:10px">';
                    html += '<span><span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:4px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:9px;margin-right:6px">' + (p.grade || '?') + '</span>';
                    html += '<span style="color:var(--text-bright)">' + (p.name || '').substring(0, 30) + '</span></span>';
                    html += '<span style="font-family:var(--mono);color:var(--text-dim)">' + fmt(p.amount) + '\u20ac \u00e0 ' + p.coupon + '% = +' + fmt(p.annualReturn) + '\u20ac</span></div>';
                });
                html += '</div></div>';
            }

            // Non-allocated
            if (result.nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:8px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
                html += '<span style="font-size:11px;font-weight:600;color:var(--text-dim)">\u274c \u00c9cart\u00e9s (' + result.nonAlloc.length + ')</span></div>';
                html += '<div style="padding:6px 14px">';
                result.nonAlloc.forEach(function(p) {
                    var rc = p.recommendation === 'ATTENDRE' ? 'var(--orange)' : 'var(--red)';
                    var ri = p.recommendation === 'ATTENDRE' ? '\u23f3' : '\u274c';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:10px;' + (p.recommendation === 'REJETER' ? 'opacity:0.5' : '') + '">';
                    html += '<span style="color:var(--text-bright)">' + (p.name || '').substring(0, 35) + ' <span style="color:var(--text-dim)">(' + (p.bankName || '') + ')</span></span>';
                    html += '<span style="color:' + rc + ';font-weight:600">' + ri + ' ' + p.recommendation + ' \u2014 ' + p.coupon + '% ' + p.grade + '</span></div>';
                });
                html += '</div></div>';
            }

            var liqTotal = a.totalLiquidity || 0;
            if ((a.allocationPlan || []).length === 0 && liqTotal > 0) html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">' + fmt(liqTotal) + '\u20ac disponibles mais aucune proposition grad\u00e9e.</div>';
            if (liqTotal === 0) html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Aucune liquidit\u00e9 d\u00e9tect\u00e9e.</div>';

            return html;
        };
        console.log('[OptimizerUI] v5 modal override OK');
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    // PART B: DASHBOARD WIDGET
    // ═══════════════════════════════════════════════════════════
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
                deployedCatReturn: r.deployedCatReturn || 0,
                deployedExcess: r.deployedExcess || 0,
                remainingCash: r.remainingCash || 0,
                _structuredLiquidity: r._savedStructLiq || r._structuredLiquidity || 0,
                _externalLiquidity: r._savedExtLiq || r._externalLiquidity || 0,
                _extByCam: r._savedExtByCam || r._extByCam || 0,
                _extCameleons: r._savedExtCameleons || r._extCameleons || 0,
                _entity: r._savedEntity || 'all',
                _entityLabel: r._savedEntityLabel || _entityLabel(r._savedEntity || 'all'),
                allocationPlan: r._savedAllocation || r.allocation || []
            };

            var result = _buildTableHTML(analysis);

            var html = '<div class="section">';
            html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--cyan)"></span>\ud83d\udcca Optimisation Structur\u00e9s</div>';
            html += '<div style="display:flex;gap:8px;align-items:center">';
            html += '<span style="font-size:10px;color:var(--text-dim)">' + ds + '</span>';
            html += '<button class="btn sm ai-glow" onclick="showStructuredOptimizer()">\ud83d\udd04</button>';
            html += '</div></div>';

            html += result.html;

            // Non-alloués
            if (result.nonAlloc.length > 0) {
                html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
                html += '<div style="padding:6px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
                html += '<span style="font-size:10px;font-weight:600;color:var(--text-dim)">\u274c \u00c9cart\u00e9s (' + result.nonAlloc.length + ')</span></div>';
                html += '<div style="padding:4px 14px">';
                result.nonAlloc.forEach(function(p) {
                    var rc = p.recommendation === 'ATTENDRE' ? 'var(--orange)' : 'var(--red)';
                    var ri = p.recommendation === 'ATTENDRE' ? '\u23f3' : '\u274c';
                    html += '<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px;opacity:0.6">';
                    html += '<span style="color:var(--text-bright)">' + (p.name || '').substring(0, 30) + '</span>';
                    html += '<span style="color:' + rc + '">' + ri + ' ' + p.coupon + '% ' + p.grade + '</span></div>';
                });
                html += '</div></div>';
            }

            // Claude
            if (r.summary) {
                html += '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden">';
                html += '<div style="padding:10px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px">';
                html += '<span style="font-size:14px">\ud83e\udd16</span><span style="font-size:12px;font-weight:700;color:var(--accent)">Recommandation Claude</span></div>';
                html += '<div style="padding:14px 16px;font-size:11px;line-height:1.7;color:var(--text)" class="ai-summary">' + (typeof formatAIText === 'function' ? formatAIText(r.summary) : r.summary) + '</div></div>';
            }

            html += '</div>';
            return html;
        };
        console.log('[OptimizerUI] v5 dashboard override OK');
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
        var _w = setInterval(function() {
            _tryAll();
            if (typeof renderStructOptimizationTable === 'function' && typeof renderStructOptimizerDashboard === 'function') clearInterval(_w);
        }, 100);
        setTimeout(function() { clearInterval(_w); }, 12000);
    }

    console.log('[StructBoard] Optimizer UI v5 \u2014 clear source labels + entity breakdown');
})();

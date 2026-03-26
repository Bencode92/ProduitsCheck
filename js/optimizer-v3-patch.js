// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v3.1 Patch
// v3.1: 2 fixes from OpenAI/Claude joint review
//   Fix #2: Liquidity mode REUSES v2 allocation (no constraint bypass)
//   Fix #7: _getLiquidityScore calls v6 _computeLiquidityScore
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    window._optimizerOptions = {
        entity: 'all',
        liquidityPriority: false
    };

    // ═══ Fix #7: Use v6 liquidity scoring if available ═══
    function _getLiquidityScore(product) {
        // Try v6 grader's _computeLiquidityScore first (much more sophisticated)
        if (typeof _computeLiquidityScore === 'function') {
            try {
                var v6result = _computeLiquidityScore(product);
                if (v6result && typeof v6result.score === 'number') return v6result.score;
            } catch(e) {}
        }

        // Check grading result
        var g = product.grading || {};
        if (g.liquidityLevel) {
            if (g.liquidityLevel === 'L1') return 100;
            if (g.liquidityLevel === 'L2') return 75;
            if (g.liquidityLevel === 'L3') return 40;
            if (g.liquidityLevel === 'L4') return 15;
        }

        // Fallback heuristic
        if (product.capitalProtected) return 90;
        if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(product)) return 75;
        var name = (product.name || '').toLowerCase();
        if (name.indexOf('callable') >= 0 || name.indexOf('taux fixe') >= 0) return 75;
        var maturity = product.maturity || 0;
        if (maturity <= 1) return 80;
        if (maturity <= 3) return 50;
        return 20;
    }

    function _getLiquidityLabel(product) {
        var score = _getLiquidityScore(product);
        if (score >= 90) return '\ud83d\udca7L1';
        if (score >= 70) return '\ud83d\udca7L2';
        if (score >= 35) return '\ud83d\udca7L3';
        return '\ud83d\udca7L4';
    }

    function _filterByEntity(products, entity) {
        if (!entity || entity === 'all') return products;
        return products.filter(function(p) { return p.entity === entity; });
    }

    function _filteredCounts() {
        var opts = window._optimizerOptions;
        var portfolio = app.state.portfolio || [];
        var filtered = _filterByEntity(portfolio, opts.entity);
        var prCount = 0;
        Object.values(app.state.proposals || {}).forEach(function(arr) {
            arr.forEach(function(p) { if (p.status !== 'rejected' && p.status !== 'subscribed') prCount++; });
        });
        return filtered.length + ' portefeuille + ' + prCount + ' propositions';
    }

    function _entityBtn(value, label, current) {
        var active = current === value;
        return '<button class="btn sm" style="' +
            (active ? 'background:var(--accent);color:white;border-color:var(--accent)' : 'opacity:0.6') +
            '" onclick="_setOptimizerEntity(\'' + value + '\')">'
            + label + '</button>';
    }

    window._setOptimizerEntity = function(entity) {
        window._optimizerOptions.entity = entity;
        showStructuredOptimizer();
    };

    window._toggleLiqPriority = function() {
        window._optimizerOptions.liquidityPriority = !window._optimizerOptions.liquidityPriority;
        showStructuredOptimizer();
    };

    // ═══ OVERRIDE showStructuredOptimizer ═══
    var _waitModal = setInterval(function() {
        if (typeof showStructuredOptimizer !== 'function') return;
        clearInterval(_waitModal);

        var _origShowOpt = showStructuredOptimizer;
        showStructuredOptimizer = function() {
            var pCount = (app.state.portfolio || []).length;
            var portfolio = app.state.portfolio || [];
            var bycamCount = portfolio.filter(function(p) { return p.entity === 'bycam'; }).length;
            var camCount = portfolio.filter(function(p) { return p.entity === 'cameleons'; }).length;
            var noEntity = portfolio.filter(function(p) { return !p.entity; }).length;
            var opts = window._optimizerOptions;

            var modal = document.getElementById('modal');
            modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">' +
                '<h2 class="modal-title">\ud83d\udcca Optimiseur Structur\u00e9s v3.1</h2>' +
                '<div style="margin-bottom:12px">' +
                '<label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px">\ud83c\udfe2 Entit\u00e9</label>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                _entityBtn('all', 'Toutes (' + pCount + ')', opts.entity) +
                _entityBtn('bycam', '\ud83c\udfe2 ByCam (' + bycamCount + ')', opts.entity) +
                _entityBtn('cameleons', '\ud83e\udd8e Cam\u00e9leons (' + camCount + ')', opts.entity) +
                (noEntity > 0 ? '<span style="font-size:10px;color:var(--orange);align-self:center">\u26a0 ' + noEntity + ' sans entit\u00e9</span>' : '') +
                '</div></div>' +
                '<div style="margin-bottom:16px">' +
                '<label style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="_toggleLiqPriority()">' +
                '<div id="liq-toggle" style="width:36px;height:20px;border-radius:10px;background:' + (opts.liquidityPriority ? 'var(--green)' : 'var(--border)') + ';position:relative;transition:all 0.2s">' +
                '<div style="width:16px;height:16px;border-radius:50%;background:white;position:absolute;top:2px;' + (opts.liquidityPriority ? 'left:18px' : 'left:2px') + ';transition:all 0.2s"></div></div>' +
                '<span style="font-size:12px;color:var(--text-bright)">\ud83d\udca7 Priorit\u00e9 liquidit\u00e9</span>' +
                '<span style="font-size:10px;color:var(--text-dim)">(favorise L1/L2 remboursables rapidement)</span>' +
                '</label></div>' +
                '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">' +
                'Alloue la liquidit\u00e9 disponible sur les meilleures propositions. Compare le rendement r\u00e9el vs \u00ab garder en CAT \u00bb.' +
                (opts.liquidityPriority ? ' <strong style="color:var(--green)">\ud83d\udca7 Mode liquidit\u00e9:</strong> L1/L2 allou\u00e9s en premier.' : '') +
                '</div>' +
                '<button class="btn ai-glow lg" style="width:100%" onclick="launchStructOptimizer()">\ud83d\udcca Optimiser (' + _filteredCounts() + ')</button>' +
                '<div id="struct-optimizer-results" style="margin-top:16px"></div>' +
                '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>' +
                '</div></div>';
            modal.classList.add('visible');
        };

        console.log('[StructBoard] Optimizer v3.1 \u2014 entity filter + liquidity priority (uses v2 constraints)');
    }, 250);
    setTimeout(function() { clearInterval(_waitModal); }, 10000);

    // ═══ Fix #2: OVERRIDE buildStructuredOptimization ═══
    // Liquidity mode now REUSES _allocateWithConstraints from v2
    // instead of reimplementing its own allocation loop
    var _waitBuild = setInterval(function() {
        if (typeof buildStructuredOptimization !== 'function') return;
        if (typeof _allocateWithConstraints !== 'function') return; // Wait for v2
        clearInterval(_waitBuild);

        var _origBuild = buildStructuredOptimization;
        buildStructuredOptimization = function() {
            var opts = window._optimizerOptions;

            // Filter portfolio by entity (without mutating state — Fix #8)
            var origPortfolio = app.state.portfolio;
            if (opts.entity !== 'all') {
                app.state.portfolio = _filterByEntity(origPortfolio || [], opts.entity);
            }

            // Run v2 chain (which runs v1 inside)
            var analysis = _origBuild();

            // Restore
            app.state.portfolio = origPortfolio;

            analysis._entity = opts.entity;
            analysis._entityLabel = opts.entity === 'bycam' ? 'ByCam' :
                                    opts.entity === 'cameleons' ? 'Cam\u00e9leons' : 'Toutes';

            // Fix #2: If liquidity priority, RE-SORT and RE-ALLOCATE via v2's function
            if (opts.liquidityPriority && analysis.allocationPlan.length > 0) {
                // Sort by liquidity score FIRST, then by grade score
                var resorted = analysis.allocationPlan.slice();
                resorted.sort(function(a, b) {
                    var liqA = _getLiquidityScore(a);
                    var liqB = _getLiquidityScore(b);
                    if (liqA !== liqB) return liqB - liqA;
                    return (b.score || 0) - (a.score || 0);
                });

                // Add liquidity labels
                resorted.forEach(function(p) {
                    p._liquidityLabel = _getLiquidityLabel(p);
                    p._liquidityScore = _getLiquidityScore(p);
                });

                // Re-allocate using v2's FULL constraint engine (FGDR, emitter, underlying, grade-proportional)
                analysis = _allocateWithConstraints(analysis, resorted);

                // Append liquidity info to reasons
                analysis.allocationPlan.forEach(function(p) {
                    if (p.allocatedAmount > 0 && p._liquidityLabel) {
                        p.reason = p._liquidityLabel + ' ' + p.reason;
                    }
                });
            }

            analysis._liquidityPriority = opts.liquidityPriority;
            return analysis;
        };
    }, 300);
    setTimeout(function() { clearInterval(_waitBuild); }, 10000);

})();

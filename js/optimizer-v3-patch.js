// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v3.0 Patch
// v3.0: Entity filter (ByCam/Caméleons) + Liquidity priority
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // State for optimizer options
    window._optimizerOptions = {
        entity: 'all',       // 'all' | 'bycam' | 'cameleons'
        liquidityPriority: false  // true = boost L1/L2 products in ranking
    };

    // ═══ OVERRIDE: showStructuredOptimizer — add entity + liquidity options ═══
    var _waitModal = setInterval(function() {
        if (typeof showStructuredOptimizer !== 'function') return;
        clearInterval(_waitModal);

        var _origShowOpt = showStructuredOptimizer;
        showStructuredOptimizer = function() {
            var pCount = (app.state.portfolio || []).length;
            var prCount = Object.values(app.state.proposals || {}).reduce(function(s, a) {
                return s + a.filter(function(p) { return !['rejected','subscribed'].includes(p.status); }).length;
            }, 0);

            // Count per entity
            var portfolio = app.state.portfolio || [];
            var bycamCount = portfolio.filter(function(p) { return p.entity === 'bycam'; }).length;
            var camCount = portfolio.filter(function(p) { return p.entity === 'cameleons'; }).length;
            var noEntity = portfolio.filter(function(p) { return !p.entity; }).length;

            var opts = window._optimizerOptions;

            var modal = document.getElementById('modal');
            modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">' +
                '<h2 class="modal-title">\ud83d\udcca Optimiseur Structur\u00e9s v3.0</h2>' +

                // Entity selector
                '<div style="margin-bottom:12px">' +
                '<label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px">\ud83c\udfe2 Entit\u00e9</label>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                _entityBtn('all', 'Toutes (' + pCount + ')', opts.entity) +
                _entityBtn('bycam', '\ud83c\udfe2 ByCam (' + bycamCount + ')', opts.entity) +
                _entityBtn('cameleons', '\ud83e\udd8e Cam\u00e9leons (' + camCount + ')', opts.entity) +
                (noEntity > 0 ? '<span style="font-size:10px;color:var(--orange);align-self:center">\u26a0 ' + noEntity + ' sans entit\u00e9</span>' : '') +
                '</div></div>' +

                // Liquidity priority toggle
                '<div style="margin-bottom:16px">' +
                '<label style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="_toggleLiqPriority()">' +
                '<div id="liq-toggle" style="width:36px;height:20px;border-radius:10px;background:' + (opts.liquidityPriority ? 'var(--green)' : 'var(--border)') + ';position:relative;transition:all 0.2s">' +
                '<div style="width:16px;height:16px;border-radius:50%;background:white;position:absolute;top:2px;' + (opts.liquidityPriority ? 'left:18px' : 'left:2px') + ';transition:all 0.2s"></div></div>' +
                '<span style="font-size:12px;color:var(--text-bright)">\ud83d\udca7 Priorit\u00e9 liquidit\u00e9</span>' +
                '<span style="font-size:10px;color:var(--text-dim)">(favorise les produits L1/L2 remboursables rapidement)</span>' +
                '</label></div>' +

                // Info box
                '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">' +
                'Alloue la liquidit\u00e9 disponible sur les meilleures propositions. Compare le rendement r\u00e9el vs \u00ab garder en CAT \u00bb.' +
                (opts.liquidityPriority ? ' <strong style="color:var(--green)">\ud83d\udca7 Mode liquidit\u00e9:</strong> les produits L1/L2 (callables < 6 mois, capital prot\u00e9g\u00e9) sont prioritaires.' : '') +
                '</div>' +

                '<button class="btn ai-glow lg" style="width:100%" onclick="launchStructOptimizer()">\ud83d\udcca Optimiser (' + _filteredCounts() + ')</button>' +
                '<div id="struct-optimizer-results" style="margin-top:16px"></div>' +
                '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>' +
                '</div></div>';
            modal.classList.add('visible');
        };

        console.log('[StructBoard] Optimizer v3.0 \u2014 entity filter + liquidity priority');
    }, 250);
    setTimeout(function() { clearInterval(_waitModal); }, 10000);

    function _entityBtn(value, label, current) {
        var active = current === value;
        return '<button class="btn sm" style="' +
            (active ? 'background:var(--accent);color:white;border-color:var(--accent)' : 'opacity:0.6') +
            '" onclick="_setOptimizerEntity(\'' + value + '\')">' + label + '</button>';
    }

    window._setOptimizerEntity = function(entity) {
        window._optimizerOptions.entity = entity;
        showStructuredOptimizer(); // Re-render modal
    };

    window._toggleLiqPriority = function() {
        window._optimizerOptions.liquidityPriority = !window._optimizerOptions.liquidityPriority;
        showStructuredOptimizer(); // Re-render modal
    };

    function _filteredCounts() {
        var opts = window._optimizerOptions;
        var portfolio = app.state.portfolio || [];
        var filtered = _filterByEntity(portfolio, opts.entity);
        var prCount = 0;
        Object.values(app.state.proposals || {}).forEach(function(arr) {
            arr.forEach(function(p) {
                if (p.status !== 'rejected' && p.status !== 'subscribed') prCount++;
            });
        });
        return filtered.length + ' portefeuille + ' + prCount + ' propositions';
    }

    function _filterByEntity(products, entity) {
        if (!entity || entity === 'all') return products;
        return products.filter(function(p) { return p.entity === entity; });
    }

    // ═══ OVERRIDE: buildStructuredOptimization — filter by entity + liquidity boost ═══
    var _waitBuild = setInterval(function() {
        if (typeof buildStructuredOptimization !== 'function') return;
        clearInterval(_waitBuild);

        var _origBuild = buildStructuredOptimization;
        buildStructuredOptimization = function() {
            var opts = window._optimizerOptions;

            // Temporarily filter portfolio by entity
            var origPortfolio = app.state.portfolio;
            if (opts.entity !== 'all') {
                app.state.portfolio = _filterByEntity(origPortfolio || [], opts.entity);
            }

            // Run original (with v2 patch chain)
            var analysis = _origBuild();

            // Restore original portfolio
            app.state.portfolio = origPortfolio;

            // Add entity info
            analysis._entity = opts.entity;
            analysis._entityLabel = opts.entity === 'bycam' ? 'ByCam' :
                                    opts.entity === 'cameleons' ? 'Cam\u00e9leons' : 'Toutes';

            // ═══ LIQUIDITY PRIORITY: Re-sort proposals if enabled ═══
            if (opts.liquidityPriority && analysis.allocationPlan.length > 0) {
                analysis.allocationPlan.sort(function(a, b) {
                    var liqA = _getLiquidityScore(a);
                    var liqB = _getLiquidityScore(b);
                    // Primary: liquidity score descending (L1=100 > L2=75 > L3=40 > L4=15)
                    if (liqA !== liqB) return liqB - liqA;
                    // Secondary: grade score
                    return (b.score || 0) - (a.score || 0);
                });

                // Re-allocate with new order (liquidity-first)
                var totalLiquidity = analysis.totalLiquidity;
                var remaining = totalLiquidity * 0.90; // Keep 10% cash

                analysis.allocationPlan = analysis.allocationPlan.map(function(p) {
                    if (p.recommendation !== 'SOUSCRIRE' && p.recommendation !== 'ENVISAGER') {
                        p.allocatedAmount = 0;
                        p.annualReturn = 0;
                        p.expectedReturn = 0;
                        return p;
                    }
                    if (remaining <= 0) {
                        p.allocatedAmount = 0;
                        p.annualReturn = 0;
                        p.expectedReturn = 0;
                        p.reason = 'Liquidit\u00e9 \u00e9puis\u00e9e';
                        return p;
                    }

                    var targetAmount = p.nominal > 0 ? p.nominal : Math.min(remaining, 50000);
                    var maxPP = totalLiquidity * 0.30;
                    targetAmount = Math.min(targetAmount, maxPP, remaining);
                    if (targetAmount < 5000) {
                        p.allocatedAmount = 0;
                        return p;
                    }

                    remaining -= targetAmount;
                    p.allocatedAmount = targetAmount;

                    var probCoupon = p.probCoupon || 0.75;
                    p.annualReturn = Math.round(targetAmount * p.coupon / 100);
                    p.expectedReturn = Math.round(p.annualReturn * probCoupon);
                    p.catReturn = Math.round(targetAmount * analysis.catBenchmark / 100);
                    p.excessVsCat = p.expectedReturn - p.catReturn;

                    var liqLabel = _getLiquidityLabel(p);
                    p.reason = liqLabel + ' Grade ' + p.grade + ' (' + p.score + '/100) \u2014 ' + formatNumber(targetAmount) + '\u20ac';

                    return p;
                });

                // Recalculate totals
                analysis.deployedAmount = analysis.allocationPlan.reduce(function(s, a) { return s + a.allocatedAmount; }, 0);
                analysis.deployedReturn = analysis.allocationPlan.reduce(function(s, a) { return s + (a.expectedReturn || 0); }, 0);
                analysis.deployedCatReturn = Math.round(analysis.deployedAmount * analysis.catBenchmark / 100);
                analysis.deployedExcess = analysis.deployedReturn - analysis.deployedCatReturn;
                analysis.remainingCash = totalLiquidity - analysis.deployedAmount;
            }

            analysis._liquidityPriority = opts.liquidityPriority;
            return analysis;
        };
    }, 300);
    setTimeout(function() { clearInterval(_waitBuild); }, 10000);

    // ═══ LIQUIDITY HELPERS ═══
    function _getLiquidityScore(product) {
        // Check grading for liquidity level
        var g = product.grading || {};
        if (g.liquidityLevel) {
            if (g.liquidityLevel === 'L1') return 100;
            if (g.liquidityLevel === 'L2') return 75;
            if (g.liquidityLevel === 'L3') return 40;
            if (g.liquidityLevel === 'L4') return 15;
        }

        // Fallback: infer from product characteristics
        if (product.capitalProtected) return 90; // L1-like
        var name = (product.name || '').toLowerCase();
        if (name.indexOf('callable') >= 0 || name.indexOf('taux fixe') >= 0) return 75; // L2-like

        // Check maturity
        var maturity = product.maturity || 0;
        if (maturity <= 1) return 80;
        if (maturity <= 3) return 50;
        return 20; // Long maturity = illiquid
    }

    function _getLiquidityLabel(product) {
        var score = _getLiquidityScore(product);
        if (score >= 90) return '\ud83d\udca7L1';
        if (score >= 70) return '\ud83d\udca7L2';
        if (score >= 35) return '\ud83d\udca7L3';
        return '\ud83d\udca7L4';
    }

})();

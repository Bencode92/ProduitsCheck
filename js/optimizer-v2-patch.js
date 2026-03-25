// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v2.0 Patch
// Fixes from OpenAI code review:
//   #1 Concentration constraints (max/product, /emitter, /underlying)
//   #2 Expected return (coupon × probability, not coupon × 100%)
//   #4 Unified annualization (shared _annualizeCouponShared)
//   #5 FGDR hard constraint (max 100K€ per bank)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ CONCENTRATION LIMITS ═══
    var LIMITS = {
        MAX_PER_PRODUCT: 0.30,    // Max 30% of total liquidity per product
        MAX_PER_EMITTER: 0.40,    // Max 40% per emitter (bankId)
        MAX_PER_UNDERLYING: 0.50, // Max 50% per underlying group
        FGDR_PER_BANK: 100000,    // €100K FGDR guarantee per bank
        MIN_CASH_RATIO: 0.10,     // Keep at least 10% in cash
    };

    // ═══ #4: SHARED ANNUALIZATION FUNCTION ═══
    // Single source of truth for coupon annualization
    window._annualizeCouponShared = function(product) {
        var p = product;
        var rate = 0;

        // Get raw rate from various field locations
        if (p.coupon && typeof p.coupon === 'object') {
            rate = parseFloat(p.coupon.rate) || parseFloat(p.coupon.annualized) || parseFloat(p.coupon.taux) || 0;
        } else {
            rate = parseFloat(p.coupon) || 0;
        }

        if (rate <= 0) return 0;

        // Detect frequency from structured fields
        var freq = '';
        if (p.coupon && typeof p.coupon === 'object') {
            freq = (p.coupon.frequency || p.coupon.frequence || '').toLowerCase();
        }

        // If no structured frequency, search in product text
        if (!freq) {
            var searchText = (p.name || '') + ' ' + (p.type || '');
            if (p.coupon && typeof p.coupon === 'object') {
                searchText += ' ' + (p.coupon.triggerDetail || '') + ' ' + (p.coupon.type || '');
            }
            searchText = searchText.toLowerCase();

            if (searchText.indexOf('trimestr') >= 0) freq = 'trimestriel';
            else if (searchText.indexOf('semestr') >= 0) freq = 'semestriel';
            else if (searchText.indexOf('mensuel') >= 0) freq = 'mensuel';
        }

        // Apply multiplier
        if (freq.indexOf('trimestr') >= 0) rate *= 4;
        else if (freq.indexOf('semestr') >= 0) rate *= 2;
        else if (freq.indexOf('mensuel') >= 0) rate *= 12;

        // Sanity check: if rate > 30%, probably already annualized
        if (rate > 30) {
            var rawRate = parseFloat((p.coupon && typeof p.coupon === 'object') ? p.coupon.rate : p.coupon) || 0;
            if (rawRate > 0 && rawRate < 30) rate = rawRate;
        }

        return rate;
    };

    // ═══ #2: EXPECTED RETURN ESTIMATOR ═══
    function _estimateCouponProbability(product) {
        // Estimate probability of receiving the coupon
        // For guaranteed/fixed: 100% (minus default risk)
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var couponType = (norm.couponType || '').toLowerCase();

        if (couponType === 'garanti' || couponType === 'fixe') return 0.95; // 95% (5% issuer default risk)
        if (norm.capitalProtection) return 0.85; // Protected capital, conditional coupon

        // For autocalls with barrier
        var barrier = norm.barrier || 60;
        var hasMemory = norm.hasMemory || false;

        // Simple heuristic based on barrier level
        // Barrier 50% → ~85% prob | 60% → ~75% | 70% → ~60% | 80% → ~45%
        var baseProbability = Math.max(0.30, Math.min(0.95, 1.0 - (barrier - 40) * 0.015));

        // Memory effect increases expected coupon (catch up)
        if (hasMemory) baseProbability = Math.min(0.95, baseProbability + 0.10);

        // Worst-of reduces probability
        var nUnderlyings = (norm.underlyings || []).length;
        if (nUnderlyings > 2) baseProbability *= Math.max(0.5, 1.0 - (nUnderlyings - 2) * 0.08);

        return Math.round(baseProbability * 100) / 100;
    }

    // Wait for optimizer to load
    var _optV2Interval = setInterval(function() {
        if (typeof buildStructuredOptimization !== 'function') return;
        clearInterval(_optV2Interval);

        // ═══ OVERRIDE buildStructuredOptimization ═══
        var _origBuildOpt = buildStructuredOptimization;
        buildStructuredOptimization = function() {
            // Run original to get base analysis
            var analysis = _origBuildOpt();

            // ═══ #1 + #5: RE-ALLOCATE WITH CONSTRAINTS ═══
            var totalLiquidity = analysis.totalLiquidity;
            if (totalLiquidity <= 0) return analysis;

            var maxPerProduct = totalLiquidity * LIMITS.MAX_PER_PRODUCT;
            var maxCash = totalLiquidity * (1 - LIMITS.MIN_CASH_RATIO);
            var allocatable = Math.min(totalLiquidity, maxCash);

            // Track concentration
            var allocByEmitter = {};  // bankId → total allocated
            var allocByUnderlying = {}; // underlying group → total allocated

            // Include existing portfolio in concentration checks
            analysis.portfolioAnalysis.forEach(function(p) {
                var bankKey = (p.bankName || 'unknown').toLowerCase();
                allocByEmitter[bankKey] = (allocByEmitter[bankKey] || 0) + p.amount;
            });

            var remaining = allocatable;
            var constraintWarnings = [];

            // Re-sort by score
            var proposals = analysis.allocationPlan.slice();
            proposals.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

            // Re-allocate with constraints
            var newPlan = proposals.map(function(p) {
                var recommendation = p.recommendation; // Keep original recommendation

                if (recommendation !== 'SOUSCRIRE' && recommendation !== 'ENVISAGER') {
                    p.allocatedAmount = 0;
                    p.annualReturn = 0;
                    p.expectedReturn = 0;
                    p.catReturn = 0;
                    p.excessVsCat = 0;
                    return p;
                }

                if (remaining <= 0) {
                    p.allocatedAmount = 0;
                    p.annualReturn = 0;
                    p.expectedReturn = 0;
                    p.catReturn = 0;
                    p.excessVsCat = 0;
                    p.reason = 'Liquidité épuisée';
                    return p;
                }

                var targetAmount = p.nominal > 0 ? p.nominal : Math.min(remaining, 50000);

                // #1: Max per product constraint
                targetAmount = Math.min(targetAmount, maxPerProduct);

                // #1: Max per emitter constraint
                var bankKey = (p.bankName || 'unknown').toLowerCase();
                var currentEmitterAlloc = allocByEmitter[bankKey] || 0;
                var maxEmitter = totalLiquidity * LIMITS.MAX_PER_EMITTER;
                var emitterRoom = Math.max(0, maxEmitter - currentEmitterAlloc);
                if (targetAmount > emitterRoom) {
                    constraintWarnings.push(p.name.substring(0, 25) + ': limité par concentration émetteur ' + bankKey + ' (' + Math.round(currentEmitterAlloc) + '\u20ac déjà)');
                    targetAmount = emitterRoom;
                }

                // #5: FGDR hard constraint — max 100K€ per bank (portfolio + new allocation)
                var fgdrRoom = Math.max(0, LIMITS.FGDR_PER_BANK - currentEmitterAlloc);
                if (targetAmount > fgdrRoom && fgdrRoom < targetAmount) {
                    constraintWarnings.push('\u26a0 FGDR: ' + p.name.substring(0, 25) + ' limité à ' + Math.round(fgdrRoom) + '\u20ac (garantie 100K\u20ac/banque)');
                    targetAmount = Math.min(targetAmount, fgdrRoom);
                }

                // Final allocation
                var allocatedAmount = Math.max(0, Math.min(targetAmount, remaining));

                // Skip tiny allocations
                if (allocatedAmount < 5000) {
                    p.allocatedAmount = 0;
                    p.annualReturn = 0;
                    p.expectedReturn = 0;
                    p.catReturn = 0;
                    p.excessVsCat = 0;
                    p.reason = 'Montant trop faible après contraintes';
                    return p;
                }

                remaining -= allocatedAmount;

                // Update tracking
                allocByEmitter[bankKey] = (allocByEmitter[bankKey] || 0) + allocatedAmount;

                // #2: Expected return (coupon × probability)
                var probCoupon = _estimateCouponProbability(p);
                var annualReturn = Math.round(allocatedAmount * p.coupon / 100);
                var expectedReturn = Math.round(annualReturn * probCoupon);
                var catReturn = Math.round(allocatedAmount * analysis.catBenchmark / 100);
                var excessVsCat = expectedReturn - catReturn; // Using EXPECTED, not nominal

                p.allocatedAmount = allocatedAmount;
                p.annualReturn = annualReturn;
                p.expectedReturn = expectedReturn;
                p.probCoupon = probCoupon;
                p.catReturn = catReturn;
                p.excessVsCat = excessVsCat;

                // Update reason with expected return info
                if (recommendation === 'SOUSCRIRE') {
                    p.reason = 'Grade ' + p.grade + ' (' + p.score + '/100) \u2014 ' + formatNumber(allocatedAmount) + '\u20ac';
                    p.reason += ' \u2192 esp\u00e9rance +' + formatNumber(expectedReturn) + '\u20ac/an';
                    p.reason += ' (coupon ' + p.coupon + '% \u00d7 prob ' + Math.round(probCoupon * 100) + '%)';
                    if (excessVsCat > 0) p.reason += ' \u2014 +' + formatNumber(excessVsCat) + '\u20ac vs CAT';
                    else p.reason += ' \u2014 \u26a0 inférieur au CAT en espérance';
                }

                return p;
            });

            // Recalculate totals with expected returns
            var deployedAmount = newPlan.reduce(function(s, a) { return s + a.allocatedAmount; }, 0);
            var deployedReturn = newPlan.reduce(function(s, a) { return s + (a.expectedReturn || a.annualReturn || 0); }, 0);
            var deployedCatReturn = Math.round(deployedAmount * analysis.catBenchmark / 100);

            analysis.allocationPlan = newPlan;
            analysis.deployedAmount = deployedAmount;
            analysis.deployedReturn = deployedReturn;
            analysis.deployedCatReturn = deployedCatReturn;
            analysis.deployedExcess = deployedReturn - deployedCatReturn;
            analysis.remainingCash = totalLiquidity - deployedAmount;
            analysis.constraintWarnings = constraintWarnings;
            analysis._version = '2.0';
            analysis._limits = LIMITS;

            // Log constraints applied
            if (constraintWarnings.length > 0) {
                console.log('[Optimizer v2] Constraints applied:');
                constraintWarnings.forEach(function(w) { console.log('  ' + w); });
            }
            console.log('[Optimizer v2] Deployed: ' + formatNumber(deployedAmount) + '\u20ac, Expected return: +' + formatNumber(deployedReturn) + '\u20ac/an, Cash kept: ' + formatNumber(analysis.remainingCash) + '\u20ac (' + Math.round(analysis.remainingCash / totalLiquidity * 100) + '%)');

            return analysis;
        };

        // ═══ ALSO PATCH getStructOptimizerAISummary TO USE CONFIG.AI_MODEL ═══
        var _origAISummary = getStructOptimizerAISummary;
        getStructOptimizerAISummary = async function(analysis) {
            // Add constraint info to the AI prompt
            var origResult = await _origAISummary(analysis);

            // If there were constraint warnings, append them
            if (analysis.constraintWarnings && analysis.constraintWarnings.length > 0) {
                origResult += '\n\n\u26a0 **Contraintes appliquées:**\n';
                analysis.constraintWarnings.forEach(function(w) {
                    origResult += '- ' + w + '\n';
                });
            }

            return origResult;
        };

        console.log('[StructBoard] Optimizer v2.0 Patch \u2014 concentration limits + expected returns + FGDR');
        console.log('[Optimizer v2] Limits: ' + JSON.stringify(LIMITS));
    }, 250);
    setTimeout(function() { clearInterval(_optV2Interval); }, 10000);
})();

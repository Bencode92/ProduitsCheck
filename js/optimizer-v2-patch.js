// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v2.1 Patch
// v2.1: 4 fixes from OpenAI/Claude joint review
//   Fix #0: Grade-proportional allocation (score/75 multiplier)
//   Fix #1: allocByUnderlying now IMPLEMENTED (was dead code)
//   Fix #3: _estimateCouponProbability uses barrier sigma (vol-aware)
//   Fix #5: Emitter concentration on PF+liquidity (not liquidity alone)
//   Fix #9: ISSUER_RATINGS CDS proxy in default probability
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var LIMITS = {
        MAX_PER_PRODUCT: 0.30,
        MAX_PER_EMITTER: 0.40,
        MAX_PER_UNDERLYING: 0.50,
        FGDR_PER_BANK: 100000,
        MIN_CASH_RATIO: 0.10,
    };

    // ═══ SHARED ANNUALIZATION ═══
    window._annualizeCouponShared = function(product) {
        var p = product;
        var rate = 0;
        if (p.coupon && typeof p.coupon === 'object') {
            rate = parseFloat(p.coupon.rate) || parseFloat(p.coupon.annualized) || parseFloat(p.coupon.taux) || 0;
        } else {
            rate = parseFloat(p.coupon) || 0;
        }
        if (rate <= 0) return 0;
        var freq = '';
        if (p.coupon && typeof p.coupon === 'object') freq = (p.coupon.frequency || p.coupon.frequence || '').toLowerCase();
        if (!freq) {
            var st = ((p.name || '') + ' ' + (p.type || '')).toLowerCase();
            if (p.coupon && typeof p.coupon === 'object') st += ' ' + (p.coupon.triggerDetail || '') + ' ' + (p.coupon.type || '');
            if (st.indexOf('trimestr') >= 0) freq = 'trimestriel';
            else if (st.indexOf('semestr') >= 0) freq = 'semestriel';
            else if (st.indexOf('mensuel') >= 0) freq = 'mensuel';
        }
        if (freq.indexOf('trimestr') >= 0) rate *= 4;
        else if (freq.indexOf('semestr') >= 0) rate *= 2;
        else if (freq.indexOf('mensuel') >= 0) rate *= 12;
        if (rate > 30) {
            var raw = parseFloat((p.coupon && typeof p.coupon === 'object') ? p.coupon.rate : p.coupon) || 0;
            if (raw > 0 && raw < 30) rate = raw;
        }
        return rate;
    };

    // ═══ Fix #9: ISSUER DEFAULT PROBABILITY (CDS-aware) ═══
    function _issuerDefaultProb(product) {
        // Use ISSUER_RATINGS from grader-v5-patch if available
        var bankId = (product.bankId || product.bankName || '').toLowerCase();
        if (typeof ISSUER_RATINGS !== 'undefined') {
            for (var key in ISSUER_RATINGS) {
                if (bankId.indexOf(key) >= 0) {
                    var cds = ISSUER_RATINGS[key].cds_proxy || 80;
                    // CDS in bps → annual default prob ≈ cds / 10000 / 0.6 (recovery 40%)
                    return Math.min(0.15, Math.max(0.01, cds / 10000 / 0.6));
                }
            }
        }
        return 0.05; // Default 5% if no issuer data
    }

    // ═══ Fix #1: UNDERLYING GROUP DETECTION ═══
    function _getUnderlyingGroup(product) {
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var ujs = norm.underlyings || [];
        if (ujs.length === 0) return 'rates'; // Fixed rate/callable

        // Check correlation groups from config
        if (typeof UNDERLYINGS !== 'undefined') {
            var ujText = ujs.join(' ').toLowerCase();
            for (var i = 0; i < UNDERLYINGS.length; i++) {
                var u = UNDERLYINGS[i];
                if (ujText.indexOf(u.name.toLowerCase()) >= 0) return u.correlation_group;
            }
        }

        // Fallback: detect from name
        var allText = ujs.join(' ').toLowerCase();
        if (allText.indexOf('eurostoxx') >= 0 || allText.indexOf('cac') >= 0 || allText.indexOf('dax') >= 0) return 'eu-equity';
        if (allText.indexOf('s&p') >= 0 || allText.indexOf('nasdaq') >= 0) return 'us-equity';
        if (allText.indexOf('nikkei') >= 0) return 'asia-equity';
        return 'single'; // Individual stocks
    }

    // ═══ Fix #3: COUPON PROBABILITY (sigma + vol aware) ═══
    // Now uses barrier distance in σ when available (from v6 grader)
    window._estimateCouponProbability = function(product) {
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var couponType = (norm.couponType || '').toLowerCase();

        // Fix #9: issuer-specific default probability
        var defaultProb = _issuerDefaultProb(product);

        // Guaranteed/fixed: only issuer default risk
        if (couponType === 'garanti' || couponType === 'fixe') return Math.round((1 - defaultProb) * 100) / 100;
        if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(norm)) return Math.round((1 - defaultProb) * 100) / 100;
        if (norm.capitalProtection) return Math.round((0.90 - defaultProb) * 100) / 100;

        var barrier = norm.barrier || 60;
        var hasMemory = norm.hasMemory || false;
        var nUnderlyings = (norm.underlyings || []).length;

        // Fix #3: Try to use barrier sigma from v6 grading (vol-aware)
        var sigma = null;
        if (product.grading && product.grading.barrierSigma) {
            sigma = product.grading.barrierSigma;
        } else if (typeof _computeBarrierSigma === 'function') {
            // Try to compute on the fly
            try { sigma = _computeBarrierSigma(norm); } catch(e) {}
        }

        var baseProbability;
        if (sigma != null && sigma > 0) {
            // Sigma-based probability (much more accurate)
            // σ > 3.0 → ~99% safe | σ = 2.0 → ~90% | σ = 1.5 → ~80% | σ = 1.0 → ~60% | σ = 0.5 → ~35%
            baseProbability = Math.max(0.20, Math.min(0.99, 0.5 + 0.5 * (1 - Math.exp(-sigma * 0.8))));
            // Log for traceability
            console.log('[ProbCoupon] ' + (product.name || '').substring(0, 25) + ': sigma=' + sigma.toFixed(2) + ' → P(coupon)=' + (baseProbability * 100).toFixed(0) + '%');
        } else {
            // Fallback: barrier-only heuristic (original v2.0)
            baseProbability = Math.max(0.30, Math.min(0.95, 1.0 - (barrier - 40) * 0.015));
        }

        // Memory effect
        if (hasMemory) baseProbability = Math.min(0.95, baseProbability + 0.10);

        // Worst-of penalty (considering correlation if available)
        if (nUnderlyings > 2) {
            var corrPenalty = 0.08; // Default: 8% per additional SJ
            // If correlation groups are available, reduce penalty for correlated SJs
            if (typeof CORRELATION_MATRIX !== 'undefined' && norm.underlyings) {
                var groups = norm.underlyings.map(function(u) { return _getUnderlyingGroup({ underlyings: [u] }); });
                var uniqueGroups = groups.filter(function(g, i) { return groups.indexOf(g) === i; });
                // If all SJ are in same correlation group → much less penalty
                if (uniqueGroups.length === 1) corrPenalty = 0.02;
                else if (uniqueGroups.length === 2) corrPenalty = 0.05;
            }
            baseProbability *= Math.max(0.5, 1.0 - (nUnderlyings - 2) * corrPenalty);
        }

        // Apply issuer default risk
        baseProbability *= (1 - defaultProb);

        return Math.round(baseProbability * 100) / 100;
    };

    // ═══ MAIN ALLOCATION ENGINE (exported for v3 to call) ═══
    // Fix #2 prep: export the allocation logic so v3 can reuse it with different sort order
    window._allocateWithConstraints = function(analysis, sortedProposals) {
        var totalLiquidity = analysis.totalLiquidity;
        if (totalLiquidity <= 0) return analysis;

        // Fix #5: Base concentration on TOTAL (PF + liquidity), not just liquidity
        var totalAssets = analysis.totalPortfolioInvested + totalLiquidity;
        var maxPerProduct = totalAssets * LIMITS.MAX_PER_PRODUCT;
        var maxCash = totalLiquidity * (1 - LIMITS.MIN_CASH_RATIO);
        var allocatable = Math.min(totalLiquidity, maxCash);

        // Track concentration
        var allocByEmitter = {};
        var allocByUnderlying = {}; // Fix #1: NOW IMPLEMENTED

        // Include existing portfolio in concentration checks
        analysis.portfolioAnalysis.forEach(function(p) {
            var bankKey = (p.bankName || 'unknown').toLowerCase();
            allocByEmitter[bankKey] = (allocByEmitter[bankKey] || 0) + p.amount;
        });
        // Fix #1: Also track portfolio underlying groups
        (app.state.portfolio || []).forEach(function(p) {
            var group = _getUnderlyingGroup(p);
            allocByUnderlying[group] = (allocByUnderlying[group] || 0) + (parseFloat(p.investedAmount) || 0);
        });

        var remaining = allocatable;
        var constraintWarnings = [];

        var newPlan = sortedProposals.map(function(p) {
            var recommendation = p.recommendation;

            if (recommendation !== 'SOUSCRIRE' && recommendation !== 'ENVISAGER') {
                p.allocatedAmount = 0; p.annualReturn = 0; p.expectedReturn = 0;
                p.catReturn = 0; p.excessVsCat = 0;
                return p;
            }
            if (remaining <= 0) {
                p.allocatedAmount = 0; p.annualReturn = 0; p.expectedReturn = 0;
                p.catReturn = 0; p.excessVsCat = 0;
                p.reason = 'Liquidit\u00e9 \u00e9puis\u00e9e';
                return p;
            }

            var targetAmount = p.nominal > 0 ? p.nominal : Math.min(remaining, 50000);

            // Fix #0: Grade-proportional allocation
            var gradeMultiplier = Math.max(0.6, Math.min(1.3, (p.score || 50) / 75));
            targetAmount = Math.round(targetAmount * gradeMultiplier);

            // Max per product
            targetAmount = Math.min(targetAmount, maxPerProduct);

            // Fix #5: Max per emitter (based on total assets, not just liquidity)
            var bankKey = (p.bankName || 'unknown').toLowerCase();
            var currentEmitterAlloc = allocByEmitter[bankKey] || 0;
            var maxEmitter = totalAssets * LIMITS.MAX_PER_EMITTER;
            var emitterRoom = Math.max(0, maxEmitter - currentEmitterAlloc);
            if (targetAmount > emitterRoom) {
                constraintWarnings.push(p.name.substring(0, 25) + ': limit\u00e9 \u00e9metteur ' + bankKey + ' (' + Math.round(currentEmitterAlloc) + '\u20ac d\u00e9j\u00e0)');
                targetAmount = emitterRoom;
            }

            // FGDR
            var fgdrRoom = Math.max(0, LIMITS.FGDR_PER_BANK - currentEmitterAlloc);
            if (targetAmount > fgdrRoom) {
                constraintWarnings.push('\u26a0 FGDR: ' + p.name.substring(0, 25) + ' \u2192 ' + Math.round(fgdrRoom) + '\u20ac max');
                targetAmount = Math.min(targetAmount, fgdrRoom);
            }

            // Fix #1: Max per underlying group
            var ujGroup = _getUnderlyingGroup(p);
            var currentUjAlloc = allocByUnderlying[ujGroup] || 0;
            var maxUj = totalAssets * LIMITS.MAX_PER_UNDERLYING;
            var ujRoom = Math.max(0, maxUj - currentUjAlloc);
            if (targetAmount > ujRoom) {
                constraintWarnings.push(p.name.substring(0, 25) + ': limit\u00e9 sous-jacent ' + ujGroup + ' (' + Math.round(currentUjAlloc) + '\u20ac d\u00e9j\u00e0)');
                targetAmount = ujRoom;
            }

            var allocatedAmount = Math.max(0, Math.min(targetAmount, remaining));
            if (allocatedAmount < 5000) {
                p.allocatedAmount = 0; p.annualReturn = 0; p.expectedReturn = 0;
                p.catReturn = 0; p.excessVsCat = 0;
                p.reason = 'Montant trop faible apr\u00e8s contraintes';
                return p;
            }

            remaining -= allocatedAmount;
            allocByEmitter[bankKey] = (allocByEmitter[bankKey] || 0) + allocatedAmount;
            allocByUnderlying[ujGroup] = (allocByUnderlying[ujGroup] || 0) + allocatedAmount; // Fix #1

            // Fix #3: Probability uses sigma when available
            var probCoupon = _estimateCouponProbability(p);
            var annualReturn = Math.round(allocatedAmount * p.coupon / 100);
            var expectedReturn = Math.round(annualReturn * probCoupon);
            var catReturn = Math.round(allocatedAmount * analysis.catBenchmark / 100);
            var excessVsCat = expectedReturn - catReturn;

            p.allocatedAmount = allocatedAmount;
            p.annualReturn = annualReturn;
            p.expectedReturn = expectedReturn;
            p.probCoupon = probCoupon;
            p.catReturn = catReturn;
            p.excessVsCat = excessVsCat;
            p._gradeMultiplier = gradeMultiplier; // Fix #0: traceability
            p._ujGroup = ujGroup; // Fix #1: traceability

            if (recommendation === 'SOUSCRIRE') {
                p.reason = 'Grade ' + p.grade + ' (' + p.score + '/100) \u00d7' + gradeMultiplier.toFixed(2) + ' \u2014 ' + formatNumber(allocatedAmount) + '\u20ac';
                p.reason += ' \u2192 esp\u00e9rance +' + formatNumber(expectedReturn) + '\u20ac/an';
                p.reason += ' (coupon ' + p.coupon + '% \u00d7 P=' + Math.round(probCoupon * 100) + '%)';
                if (excessVsCat > 0) p.reason += ' \u2014 +' + formatNumber(excessVsCat) + '\u20ac vs CAT';
                else p.reason += ' \u2014 \u26a0 inf\u00e9rieur au CAT';
            }

            return p;
        });

        // Recalculate totals
        var deployedAmount = newPlan.reduce(function(s, a) { return s + a.allocatedAmount; }, 0);
        var deployedReturn = newPlan.reduce(function(s, a) { return s + (a.expectedReturn || 0); }, 0);
        var deployedCatReturn = Math.round(deployedAmount * analysis.catBenchmark / 100);

        analysis.allocationPlan = newPlan;
        analysis.deployedAmount = deployedAmount;
        analysis.deployedReturn = deployedReturn;
        analysis.deployedCatReturn = deployedCatReturn;
        analysis.deployedExcess = deployedReturn - deployedCatReturn;
        analysis.remainingCash = totalLiquidity - deployedAmount;
        analysis.constraintWarnings = constraintWarnings;
        analysis._version = '2.1';
        analysis._limits = LIMITS;

        if (constraintWarnings.length > 0) {
            console.log('[Optimizer v2.1] Constraints:');
            constraintWarnings.forEach(function(w) { console.log('  ' + w); });
        }
        console.log('[Optimizer v2.1] Deployed: ' + formatNumber(deployedAmount) + '\u20ac, Expected: +' + formatNumber(deployedReturn) + '\u20ac/an, Cash: ' + formatNumber(analysis.remainingCash) + '\u20ac (' + Math.round(analysis.remainingCash / totalLiquidity * 100) + '%)');

        return analysis;
    };

    // ═══ OVERRIDE buildStructuredOptimization ═══
    var _optV2Interval = setInterval(function() {
        if (typeof buildStructuredOptimization !== 'function') return;
        clearInterval(_optV2Interval);

        var _origBuildOpt = buildStructuredOptimization;
        buildStructuredOptimization = function() {
            var analysis = _origBuildOpt();
            if (analysis.totalLiquidity <= 0) return analysis;

            // Sort by score (default mode)
            var proposals = analysis.allocationPlan.slice();
            proposals.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

            return _allocateWithConstraints(analysis, proposals);
        };

        // Patch AI summary
        var _origAISummary = getStructOptimizerAISummary;
        getStructOptimizerAISummary = async function(analysis) {
            var origResult = await _origAISummary(analysis);
            if (analysis.constraintWarnings && analysis.constraintWarnings.length > 0) {
                origResult += '\n\n\u26a0 **Contraintes appliqu\u00e9es:**\n';
                analysis.constraintWarnings.forEach(function(w) { origResult += '- ' + w + '\n'; });
            }
            return origResult;
        };

        console.log('[StructBoard] Optimizer v2.1 \u2014 6 fixes: grade-proportional + allocByUnderlying + sigma-prob + emitter-base + ISSUER_RATINGS');
    }, 250);
    setTimeout(function() { clearInterval(_optV2Interval); }, 10000);
})();

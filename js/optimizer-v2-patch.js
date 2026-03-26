// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v2.2 Patch
// v2.1: grade-proportional + allocByUnderlying + sigma-prob + ISSUER_RATINGS
// v2.2: REMOVED FGDR + emitter constraints (user decision)
//       Only keeps: max per product 30%, underlying group 50%, min 5K
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var LIMITS = {
        MAX_PER_PRODUCT: 0.30,
        MAX_PER_UNDERLYING: 0.50,
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

    // ═══ ISSUER DEFAULT PROBABILITY (CDS-aware) ═══
    function _issuerDefaultProb(product) {
        var bankId = (product.bankId || product.bankName || '').toLowerCase();
        if (typeof ISSUER_RATINGS !== 'undefined') {
            for (var key in ISSUER_RATINGS) {
                if (bankId.indexOf(key) >= 0) {
                    var cds = ISSUER_RATINGS[key].cds_proxy || 80;
                    return Math.min(0.15, Math.max(0.01, cds / 10000 / 0.6));
                }
            }
        }
        return 0.05;
    }

    // ═══ UNDERLYING GROUP DETECTION ═══
    function _getUnderlyingGroup(product) {
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var ujs = norm.underlyings || [];
        if (ujs.length === 0) return 'rates';
        if (typeof UNDERLYINGS !== 'undefined') {
            var ujText = ujs.join(' ').toLowerCase();
            for (var i = 0; i < UNDERLYINGS.length; i++) {
                var u = UNDERLYINGS[i];
                if (ujText.indexOf(u.name.toLowerCase()) >= 0) return u.correlation_group;
            }
        }
        var allText = ujs.join(' ').toLowerCase();
        if (allText.indexOf('eurostoxx') >= 0 || allText.indexOf('cac') >= 0 || allText.indexOf('dax') >= 0) return 'eu-equity';
        if (allText.indexOf('s&p') >= 0 || allText.indexOf('nasdaq') >= 0) return 'us-equity';
        if (allText.indexOf('nikkei') >= 0) return 'asia-equity';
        return 'single';
    }

    // ═══ COUPON PROBABILITY (sigma + vol aware) ═══
    window._estimateCouponProbability = function(product) {
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var couponType = (norm.couponType || '').toLowerCase();
        var defaultProb = _issuerDefaultProb(product);

        if (couponType === 'garanti' || couponType === 'fixe') return Math.round((1 - defaultProb) * 100) / 100;
        if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(norm)) return Math.round((1 - defaultProb) * 100) / 100;
        if (norm.capitalProtection) return Math.round((0.90 - defaultProb) * 100) / 100;

        var barrier = norm.barrier || 60;
        var hasMemory = norm.hasMemory || false;
        var nUnderlyings = (norm.underlyings || []).length;

        var sigma = null;
        if (product.grading && product.grading.barrierSigma) sigma = product.grading.barrierSigma;
        else if (typeof _computeBarrierSigma === 'function') {
            try { sigma = _computeBarrierSigma(norm); } catch(e) {}
        }

        var baseProbability;
        if (sigma != null && sigma > 0) {
            baseProbability = Math.max(0.20, Math.min(0.99, 0.5 + 0.5 * (1 - Math.exp(-sigma * 0.8))));
        } else {
            baseProbability = Math.max(0.30, Math.min(0.95, 1.0 - (barrier - 40) * 0.015));
        }

        if (hasMemory) baseProbability = Math.min(0.95, baseProbability + 0.10);

        if (nUnderlyings > 2) {
            var corrPenalty = 0.08;
            if (typeof CORRELATION_MATRIX !== 'undefined' && norm.underlyings) {
                var groups = norm.underlyings.map(function(u) { return _getUnderlyingGroup({ underlyings: [u] }); });
                var uniqueGroups = groups.filter(function(g, i) { return groups.indexOf(g) === i; });
                if (uniqueGroups.length === 1) corrPenalty = 0.02;
                else if (uniqueGroups.length === 2) corrPenalty = 0.05;
            }
            baseProbability *= Math.max(0.5, 1.0 - (nUnderlyings - 2) * corrPenalty);
        }

        baseProbability *= (1 - defaultProb);
        return Math.round(baseProbability * 100) / 100;
    };

    // ═══ ALLOCATION ENGINE (exported for v3 to call) ═══
    window._allocateWithConstraints = function(analysis, sortedProposals) {
        var totalLiquidity = analysis.totalLiquidity;
        if (totalLiquidity <= 0) return analysis;

        var totalAssets = analysis.totalPortfolioInvested + totalLiquidity;
        var maxPerProduct = totalAssets * LIMITS.MAX_PER_PRODUCT;
        var maxCash = totalLiquidity * (1 - LIMITS.MIN_CASH_RATIO);
        var allocatable = Math.min(totalLiquidity, maxCash);

        // Track underlying concentration only (no emitter/FGDR)
        var allocByUnderlying = {};
        (app.state.portfolio || []).forEach(function(p) {
            var group = _getUnderlyingGroup(p);
            allocByUnderlying[group] = (allocByUnderlying[group] || 0) + (parseFloat(p.investedAmount) || 0);
        });

        var remaining = allocatable;
        var constraintWarnings = [];

        var newPlan = sortedProposals.map(function(p) {
            if (p.recommendation !== 'SOUSCRIRE' && p.recommendation !== 'ENVISAGER') {
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

            // Grade-proportional
            var gradeMultiplier = Math.max(0.6, Math.min(1.3, (p.score || 50) / 75));
            targetAmount = Math.round(targetAmount * gradeMultiplier);

            // Max per product
            targetAmount = Math.min(targetAmount, maxPerProduct);

            // Max per underlying group
            var ujGroup = _getUnderlyingGroup(p);
            var currentUjAlloc = allocByUnderlying[ujGroup] || 0;
            var maxUj = totalAssets * LIMITS.MAX_PER_UNDERLYING;
            var ujRoom = Math.max(0, maxUj - currentUjAlloc);
            if (targetAmount > ujRoom) {
                constraintWarnings.push(p.name.substring(0, 25) + ': limit\u00e9 sous-jacent ' + ujGroup);
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
            allocByUnderlying[ujGroup] = (allocByUnderlying[ujGroup] || 0) + allocatedAmount;

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
            p._gradeMultiplier = gradeMultiplier;
            p._ujGroup = ujGroup;

            if (p.recommendation === 'SOUSCRIRE') {
                p.reason = 'Grade ' + p.grade + ' (' + p.score + '/100) \u00d7' + gradeMultiplier.toFixed(2) + ' \u2014 ' + formatNumber(allocatedAmount) + '\u20ac';
                p.reason += ' \u2192 esp\u00e9rance +' + formatNumber(expectedReturn) + '\u20ac/an';
                if (excessVsCat > 0) p.reason += ' \u2014 +' + formatNumber(excessVsCat) + '\u20ac vs CAT';
            }

            return p;
        });

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
        analysis._version = '2.2';
        analysis._limits = LIMITS;

        console.log('[Optimizer v2.2] Deployed: ' + formatNumber(deployedAmount) + '\u20ac, Expected: +' + formatNumber(deployedReturn) + '\u20ac/an, Cash: ' + formatNumber(analysis.remainingCash) + '\u20ac');
        return analysis;
    };

    // ═══ OVERRIDE ═══
    var _optV2Interval = setInterval(function() {
        if (typeof buildStructuredOptimization !== 'function') return;
        clearInterval(_optV2Interval);

        var _origBuildOpt = buildStructuredOptimization;
        buildStructuredOptimization = function() {
            var analysis = _origBuildOpt();
            if (analysis.totalLiquidity <= 0) return analysis;
            var proposals = analysis.allocationPlan.slice();
            proposals.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
            return _allocateWithConstraints(analysis, proposals);
        };

        if (typeof getStructOptimizerAISummary === 'function') {
            var _origAISummary = getStructOptimizerAISummary;
            getStructOptimizerAISummary = async function(analysis) {
                var origResult = await _origAISummary(analysis);
                if (analysis.constraintWarnings && analysis.constraintWarnings.length > 0) {
                    origResult += '\n\n\u26a0 **Contraintes appliqu\u00e9es:**\n';
                    analysis.constraintWarnings.forEach(function(w) { origResult += '- ' + w + '\n'; });
                }
                return origResult;
            };
        }

        console.log('[StructBoard] Optimizer v2.2 \u2014 no FGDR/emitter, keeps product 30% + underlying 50%');
    }, 250);
    setTimeout(function() { clearInterval(_optV2Interval); }, 10000);
})();

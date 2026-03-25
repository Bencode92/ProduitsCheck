// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader v5.0c Patch
// Final fixes from OpenAI deep code review (3rd iteration):
//   #1  P4: expected coupon for autocalls (not nominal)
//   #11 P1: coupon saturation fix (18% = 10% before penalties)
//   +   P1: coupon garanti bonus proportional to spread
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ COUPON PROBABILITY ESTIMATOR (shared) ═══
    // Reuses logic from optimizer-v2-patch but accessible globally
    window._estimateCouponProb = function(p) {
        if (!p) return 0.70;
        var couponType = (p.couponType || '').toLowerCase();
        if (couponType === 'garanti' || couponType === 'fixe') return 0.95;
        if (p.capitalProtection) return 0.85;

        var barrier = p.barrier || 60;
        // Heuristic: barrier 40%→90% prob, 50%→85%, 60%→75%, 70%→60%, 80%→45%
        var prob = Math.max(0.30, Math.min(0.95, 1.0 - (barrier - 40) * 0.015));
        if (p.hasMemory) prob = Math.min(0.95, prob + 0.10);
        var n = (p.underlyings || []).length;
        if (n > 2) prob *= Math.max(0.5, 1.0 - (n - 2) * 0.08);

        return Math.round(prob * 100) / 100;
    };

    // ═══ LOSS PROBABILITY ESTIMATOR ═══
    window._estimateLossProb = function(p) {
        if (!p) return 0.05;
        if (p.capitalProtection) return 0.02; // Only issuer default
        var couponType = (p.couponType || '').toLowerCase();
        if (couponType === 'garanti' || couponType === 'fixe') return 0.03;

        var barrier = p.barrier || 60;
        // Barrier 40%→2%, 50%→5%, 60%→10%, 70%→18%, 80%→28%
        var prob = Math.max(0.01, Math.min(0.40, (barrier - 35) * 0.006));
        var n = (p.underlyings || []).length;
        if (n > 1) prob *= (1 + (n - 1) * 0.15); // Worst-of increases loss prob
        return Math.min(0.50, Math.round(prob * 100) / 100);
    };

    var _v5cInterval = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _computeP4 !== 'function') return;
        clearInterval(_v5cInterval);

        // ═══ #11 FIX: P1 COUPON SATURATION ═══
        // Old: min(100, coupon × 10) → 10% and 18% both give 100
        // New: logarithmic curve that preserves granularity above 10%
        var _origP1v5c = _computeP1;
        _computeP1 = function(p) {
            // Check if rates-patch already intercepted (taux fixe)
            if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(p)) {
                return _origP1v5c(p); // Let rates-patch handle it
            }

            var coupon = p.coupon || 0;

            // New formula: linear up to 8%, then logarithmic
            // 5% → 50 | 8% → 80 | 10% → 87 | 12% → 92 | 18% → 98
            var s;
            if (coupon <= 8) {
                s = Math.min(100, coupon * 10);
            } else {
                // 80 + 20 × ln(coupon/8) / ln(3) → saturates around 100 at ~24%
                s = Math.min(100, Math.round(80 + 20 * Math.log(coupon / 8) / Math.log(3)));
            }

            // Barrier penalty (v5.0 recalibrated)
            if (!p.capitalProtection) {
                if (p.barrier > 0 && p.barrier < 100) {
                    var barrierPenalty = Math.pow(Math.max(0, (p.barrier - 30) / 50), 2.0);
                    s = s * (1 - barrierPenalty);
                } else if (p.barrier === 0 || p.barrier === null || p.barrier === undefined) {
                    // Bug #5 already handled by bugfix-patch (sets default 60%)
                    // But double-check: if still 0, don't penalize -25
                    if (!p._barrierUnparsed) s -= 25;
                } else {
                    s -= 25;
                }
            }

            // Worst-of
            if (p.worstOf && p.underlyings && p.underlyings.length > 2) {
                s -= Math.round(3 * Math.pow(p.underlyings.length - 2, 1.3));
            }

            // Memory
            if (p.hasMemory) s += 5;

            // Coupon garanti: proportional to spread vs risk-free
            if (p.couponType === 'garanti' || p.couponType === 'fixe') {
                // Old: flat +15. New: +8 base + up to +10 proportional to coupon
                var guarBonus = Math.min(18, 8 + Math.round(coupon * 1.0));
                s += guarBonus;
            }

            // Maturity
            if (p._maturityInfo) {
                var my = p._maturityInfo.expected || p.maturityYears || 0;
                if (my > 0 && my <= 3) s += 5;
                else if (my > 6 && my <= 10) s -= 5;
                else if (my > 10) s -= 10;
            } else {
                // Fallback: try to estimate
                if (typeof _estimateExpectedMaturity === 'function') {
                    var matInfo = _estimateExpectedMaturity(p);
                    p._maturityInfo = matInfo;
                    var my2 = matInfo.expected || p.maturityYears || 0;
                    if (my2 > 0 && my2 <= 3) s += 5;
                    else if (my2 > 6 && my2 <= 10) s -= 5;
                    else if (my2 > 10) s -= 10;
                }
            }

            return Math.max(0, Math.min(100, Math.round(s)));
        };
        console.log('[v5c] P1 coupon: logarithmic above 8% (18%→98 vs 100 before)');

        // ═══ #1 FIX: P4 EXPECTED RETURN FOR AUTOCALLS ═══
        // Old: spread = coupon - CAT (treats conditional coupon as guaranteed)
        // New: spread = expected_coupon - CAT - illiquidity_premium
        var _origP4v5c = _computeP4;
        _computeP4 = function(p, catRate) {
            // Let rates-patch handle taux fixe
            if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(p)) {
                return _origP4v5c(p, catRate);
            }

            var coupon = p.coupon || 0;
            var cat = catRate || 2.5;
            var mat = p.maturityYears || 5;

            // Estimate expected coupon (coupon × probability)
            var probCoupon = _estimateCouponProb(p);
            var probLoss = _estimateLossProb(p);
            var avgLoss = (p.barrier || 60) / 100; // If barrier hit, lose ~barrier%

            // Expected annual return = coupon × P(coupon) - loss × P(loss) / maturity
            var expectedCoupon = coupon * probCoupon;
            var expectedLoss = avgLoss * 100 * probLoss / Math.max(1, mat);
            var expectedReturn = expectedCoupon - expectedLoss;

            // Illiquidity premium (same as rates-patch)
            var illiqPremium = 0.5 + 0.10 * Math.max(0, mat - 2);

            // Effective spread
            var effectiveSpread = expectedReturn - cat - illiqPremium;

            // Score
            var s;
            if (effectiveSpread <= 0) {
                s = Math.max(5, 30 + Math.round(effectiveSpread * 12));
            } else if (effectiveSpread <= 4) {
                s = Math.min(80, Math.round(30 + effectiveSpread * 12.5));
            } else {
                s = Math.round(80 + 20 * (1 - Math.exp(-(effectiveSpread - 4) / 4)));
            }

            console.log('[v5c] P4 expected: coupon ' + coupon + '% × P(' + Math.round(probCoupon * 100) + '%) = ' + expectedCoupon.toFixed(1) + '% - loss ' + expectedLoss.toFixed(1) + '% - illiq ' + illiqPremium.toFixed(1) + '% - CAT ' + cat + '% = eff.spread ' + effectiveSpread.toFixed(2) + '% → P4=' + s);

            return Math.max(0, Math.min(100, Math.round(s)));
        };
        console.log('[v5c] P4: expected return (coupon×prob - loss×prob - illiquidity) instead of nominal');

        console.log('[StructBoard] Grader v5.0c Patch — P1 saturation fix + P4 expected return');
    }, 400);
    setTimeout(function() { clearInterval(_v5cInterval); }, 12000);
})();

// ═══════════════════════════════════════════════════════════════════════════════
// SPRINT 1 — P0 Critical Fixes (Audit Expert)
//
// Fix 1: BS-based barrier probability (replaces static grid)
// Fix 2: Optimizer rendement espéré (not facial coupon)
// Fix 3: Décrément drag integrated in BS drift
// Fix 4: Barrière coupon >= 95% = conditionnel (not garanti)
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    // ========================================
    // UTILITY: Standard Normal CDF (Abramowitz & Stegun)
    // Accuracy ~1e-7
    // ========================================
    function _normalCDF(x) {
        var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        var sign = x < 0 ? -1 : 1;
        var ax = Math.abs(x) / Math.sqrt(2);
        var t = 1.0 / (1.0 + p * ax);
        var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
        return 0.5 * (1.0 + sign * y);
    }

    // ========================================
    // REGIME MULTIPLIER: connect to Market Intelligence
    // ========================================
    function _getRegimeMultiplier() {
        try {
            if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._mi) {
                var regime = (_mktCache._mi.regime || '').toLowerCase();
                var vix = _mktCache._mi.vix || 0;
                if (regime === 'crisis' || vix > 35) return 1.50;
                if (regime === 'stagflation' || vix > 25) return 1.25;
                if (regime === 'recession' || vix > 20) return 1.15;
                return 1.0;
            }
        } catch(e) {}
        return 1.05; // slight conservatism by default
    }

    // ========================================
    // FIX 1: BS-based barrier survival probability
    // Replaces static grid with Black-Scholes continuous
    // + discrete monitoring adjustment (Broadie-Glasserman-Kou)
    // ========================================
    function _bsBarrierSurvivalProb(barrier_pct, T, vol, drag) {
        if (!T || T <= 0) return 0.95;
        if (!barrier_pct || barrier_pct <= 0 || barrier_pct >= 100) return 0.50;
        if (!vol || vol <= 0) vol = 25; // default

        var sigma = (vol / 100) * _getRegimeMultiplier();
        var drift = -(drag || 0) / 100; // FIX 3: decrement drag reduces drift
        var B = barrier_pct / 100;

        // d2 for P(S_T > B) under log-normal
        var sqrtT = Math.sqrt(Math.max(0.25, T));
        var d2 = (Math.log(1.0 / B) + (drift - sigma * sigma / 2) * T) / (sigma * sqrtT);
        var probContinuous = _normalCDF(d2);

        // Reflection principle correction for continuous monitoring
        // P(survive, continuous) = N(d2) - (B)^(2*drift/sigma^2 - 1) * N(d2 - 2*ln(1/B)/(sigma*sqrt(T)))
        var reflectionTerm = 0;
        if (drift !== 0) {
            var exponent = (2 * drift / (sigma * sigma)) - 1;
            reflectionTerm = Math.pow(B, exponent) * _normalCDF(d2 - 2 * Math.log(1.0 / B) / (sigma * sqrtT));
        } else {
            reflectionTerm = B * _normalCDF(d2 - 2 * Math.log(1.0 / B) / (sigma * sqrtT));
        }
        probContinuous = Math.max(0, probContinuous - reflectionTerm);

        // Discrete monitoring adjustment (simplified Broadie-Glasserman-Kou 1997)
        // For semi-annual monitoring: effective barrier shifts up by ~0.5826*sigma*sqrt(dt)
        // This INCREASES survival probability vs continuous monitoring by ~10-20%
        var obsPerYear = 2; // assume semi-annual (most common for structured products)
        var dt = 1.0 / obsPerYear;
        var barrierShift = 0.5826 * sigma * Math.sqrt(dt);
        var effectiveB = B * Math.exp(-barrierShift); // effective barrier is lower -> higher survival
        var d2_discrete = (Math.log(1.0 / effectiveB) + (drift - sigma * sigma / 2) * T) / (sigma * sqrtT);
        var probDiscrete = _normalCDF(d2_discrete);

        // Blend: 70% discrete (realistic) + 30% continuous (conservative)
        var prob = 0.70 * probDiscrete + 0.30 * probContinuous;

        return Math.max(0.005, Math.min(0.995, Math.round(prob * 1000) / 1000));
    }

    function _bsBarrierLossProb(barrier_pct, T, vol, drag) {
        return Math.max(0.005, Math.min(0.50, 1.0 - _bsBarrierSurvivalProb(barrier_pct, T, vol, drag)));
    }

    // ========================================
    // FIX 1+3: Override window._estimateCouponProb
    // Now uses BS with regime multiplier and decrement drag
    // ========================================
    function _patch() {
        if (typeof ProposalGrader === 'undefined') return false;

        // --- FIX 1+3: Override probability estimators ---
        var _origCouponProb = window._estimateCouponProb;
        window._estimateCouponProb = function(p) {
            if (!p) return 0.70;
            var ct = (p.couponType || '').toLowerCase();

            // FIX 4: barrierCoupon >= 95% is NOT garanti
            if ((ct === 'garanti' || ct === 'fixe') && p.barrierCoupon >= 95) {
                ct = 'conditionnel';
                console.log('[sprint1] barrierCoupon ' + p.barrierCoupon + '% >= 95% -> treating as conditionnel');
            }

            if (ct === 'garanti' || ct === 'fixe') return 0.95;
            if (p.capitalProtection && !p.barrierCoupon) return 0.85;

            var b = p.barrierCoupon || p.barrier || 60;
            var T = p.maturityYears || 5;
            var vol = 25; // default
            var drag = (p._hasDecrement && p._decrementDrag) ? p._decrementDrag : 0;

            // Try to get real vol from market data
            if (typeof _mktCache !== 'undefined' && _mktCache) {
                var allStocks = [].concat(_mktCache.stocksEurope || [], _mktCache.stocksUS || []);
                if (p.underlyings && p.underlyings.length > 0) {
                    var maxVol = 0;
                    p.underlyings.forEach(function(u) {
                        var tk = typeof _resolveAlias === 'function' ? _resolveAlias(u) : u.toUpperCase();
                        var s = allStocks.find(function(x) { return x.ticker === tk; });
                        if (s && s.volatility_3y && s.volatility_3y > maxVol) maxVol = s.volatility_3y;
                    });
                    if (maxVol > 0) vol = maxVol;
                }
            }

            // Also check underlyings_extra
            if (typeof _underlyingsExtra !== 'undefined' && _underlyingsExtra && p.underlyings) {
                p.underlyings.forEach(function(u) {
                    var tk = typeof _resolveAlias === 'function' ? _resolveAlias(u) : u.toUpperCase();
                    var extra = _underlyingsExtra[tk];
                    if (extra && extra.vol_3y && extra.vol_3y > vol) vol = extra.vol_3y;
                });
            }

            var pr = _bsBarrierSurvivalProb(b, T, vol, drag);
            if (p.hasMemory) pr = Math.min(0.95, pr + 0.06);

            // Worst-of adjustment with tail-dependence correction
            var n = (p.underlyings || []).length;
            if (n > 1) {
                var woe = 1.0;
                if (typeof _worstOfExponent === 'function') {
                    woe = _worstOfExponent(p.underlyings);
                } else {
                    woe = 1 + (n - 1) * 0.30; // fallback
                }
                // Tail-dependence correction: multiply woe by 1 + 0.25*(1-rho)*sqrt(n)
                var avgCorr = 1.0 - (woe - 1) / Math.max(1, n - 1);
                var tailCorr = Math.min(1.4, 1 + 0.25 * (1 - avgCorr) * Math.sqrt(n));
                woe = woe * tailCorr;
                pr = Math.max(0.05, Math.pow(pr, woe));
            }

            return Math.round(pr * 100) / 100;
        };

        var _origLossProb = window._estimateLossProb;
        window._estimateLossProb = function(p) {
            if (!p) return 0.05;
            if (p.capitalProtection) return 0.02;
            var ct = (p.couponType || '').toLowerCase();
            if (ct === 'garanti' || ct === 'fixe') return 0.03;

            var b = p.barrier || 60;
            var T = p.maturityYears || 5;
            var vol = 25;
            var drag = (p._hasDecrement && p._decrementDrag) ? p._decrementDrag : 0;

            // Get real vol (same logic as above)
            if (typeof _mktCache !== 'undefined' && _mktCache) {
                var allStocks = [].concat(_mktCache.stocksEurope || [], _mktCache.stocksUS || []);
                if (p.underlyings && p.underlyings.length > 0) {
                    var maxVol = 0;
                    p.underlyings.forEach(function(u) {
                        var tk = typeof _resolveAlias === 'function' ? _resolveAlias(u) : u.toUpperCase();
                        var s = allStocks.find(function(x) { return x.ticker === tk; });
                        if (s && s.volatility_3y && s.volatility_3y > maxVol) maxVol = s.volatility_3y;
                    });
                    if (maxVol > 0) vol = maxVol;
                }
            }
            if (typeof _underlyingsExtra !== 'undefined' && _underlyingsExtra && p.underlyings) {
                p.underlyings.forEach(function(u) {
                    var tk = typeof _resolveAlias === 'function' ? _resolveAlias(u) : u.toUpperCase();
                    var extra = _underlyingsExtra[tk];
                    if (extra && extra.vol_3y && extra.vol_3y > vol) vol = extra.vol_3y;
                });
            }

            var pr = _bsBarrierLossProb(b, T, vol, drag);

            var n = (p.underlyings || []).length;
            if (n > 1) {
                var woe = 1.0;
                if (typeof _worstOfExponent === 'function') {
                    woe = _worstOfExponent(p.underlyings);
                } else {
                    woe = 1 + (n - 1) * 0.30;
                }
                var avgCorr = 1.0 - (woe - 1) / Math.max(1, n - 1);
                var tailCorr = Math.min(1.4, 1 + 0.25 * (1 - avgCorr) * Math.sqrt(n));
                woe = woe * tailCorr;
                pr = Math.min(0.50, 1.0 - Math.pow(1.0 - pr, 1.0 / woe));
            }

            return Math.min(0.50, Math.round(pr * 100) / 100);
        };

        console.log('[sprint1] FIX 1+3: BS-based barrier probs with regime multiplier (' + _getRegimeMultiplier().toFixed(2) + 'x) + decrement drag');

        // --- FIX 2: Optimizer rendement espéré ---
        if (typeof buildStructuredOptimization === 'function') {
            var _origBuild = buildStructuredOptimization;
            window.buildStructuredOptimization = function() {
                var result = _origBuild();

                // Post-process: replace facial returns with expected returns
                var catRate = result.catBenchmark || 2.5;

                // Fix portfolio analysis
                result.portfolioAnalysis.forEach(function(p) {
                    _fixExpectedReturn(p, catRate);
                });

                // Fix allocation plan
                result.allocationPlan.forEach(function(a) {
                    if (a.allocatedAmount > 0) {
                        _fixExpectedReturnAlloc(a, catRate);
                    }
                });

                // Recalculate totals
                result.totalPortfolioReturn = result.portfolioAnalysis.reduce(function(s, p) { return s + p.annualReturn; }, 0);
                result.deployedReturn = result.allocationPlan.reduce(function(s, a) { return s + a.annualReturn; }, 0);
                result.deployedCatReturn = Math.round(result.deployedAmount * catRate / 100);
                result.deployedExcess = result.deployedReturn - result.deployedCatReturn;

                return result;
            };
            console.log('[sprint1] FIX 2: Optimizer now uses expected returns (not facial)');
        }

        // --- FIX 4: BarrierCoupon >= 95% = conditionnel ---
        // Already handled inside _estimateCouponProb override above
        // Also patch normalize to fix couponType at source
        var _origNorm = ProposalGrader.normalize;
        if (_origNorm && !_origNorm._sprint1Patched) {
            var _wrappedNorm = ProposalGrader.normalize;
            ProposalGrader.normalize = function(product) {
                var n = _wrappedNorm.call(this, product);
                // FIX 4: If barrierCoupon >= 95 and couponType is garanti, override
                if (n.barrierCoupon >= 95 && (n.couponType === 'garanti' || n.couponType === 'fixe')) {
                    n.couponType = 'conditionnel';
                    console.log('[sprint1] FIX 4: barrierCoupon ' + n.barrierCoupon + '% -> couponType=conditionnel');
                }
                return n;
            };
            ProposalGrader.normalize._sprint1Patched = true;
        }

        console.log('[sprint1] FIX 4: barrierCoupon >= 95% forces couponType=conditionnel');
        console.log('[sprint1] All 4 P0 fixes applied successfully');
        return true;
    }

    // Helper: compute expected return for a portfolio product
    function _fixExpectedReturn(p, catRate) {
        if (!p.coupon || p.coupon <= 0 || !p.amount || p.amount <= 0) return;

        // Try to get normalized product data for prob estimation
        var probCoupon = 0.70; // default
        var probLoss = 0.05;
        var barrier = 60;
        var matYears = 5;

        // Use the grading metadata if available
        try {
            var pf = (app.state.portfolio || []).find(function(x) { return x.id === p.id; });
            if (pf && pf.grading && pf.grading.metadata) {
                var meta = pf.grading.metadata;
                probCoupon = meta.couponProbability || probCoupon;
                barrier = meta.barrierPct || barrier;
                matYears = meta.maxMaturity || matYears;
                if (meta.couponFrequency === 'annuel' && meta.couponMultiplier === 1) {
                    // Already annualized
                }
            }
            if (pf) {
                var norm = typeof ProposalGrader !== 'undefined' ? ProposalGrader.normalize(pf) : null;
                if (norm) {
                    probCoupon = window._estimateCouponProb(norm);
                    probLoss = window._estimateLossProb(norm);
                    barrier = norm.barrier || 60;
                    matYears = norm.maturityYears || 5;
                }
            }
        } catch(e) {}

        var lossGivenBreach = ((100 - barrier) / 100) * 1.3; // 130% of distance to barrier
        var expectedCouponReturn = Math.round(p.amount * p.coupon / 100 * probCoupon);
        var expectedLoss = Math.round(p.amount * lossGivenBreach * probLoss / Math.max(1, matYears));
        var expectedReturn = expectedCouponReturn - expectedLoss;

        p.annualReturn = Math.max(0, expectedReturn);
        p.catReturn = Math.round(p.amount * catRate / 100);
        p.excessVsCat = p.annualReturn - p.catReturn;
        p._probCoupon = probCoupon;
        p._expectedNote = 'E[ret]=' + expectedCouponReturn + '-' + expectedLoss + '=' + expectedReturn;
    }

    // Helper: compute expected return for an allocation
    function _fixExpectedReturnAlloc(a, catRate) {
        if (!a.coupon || a.coupon <= 0 || !a.allocatedAmount || a.allocatedAmount <= 0) return;

        var probCoupon = 0.70;
        var probLoss = 0.05;
        var barrier = 60;
        var matYears = 5;

        try {
            // Find the proposal
            var allProposals = [];
            Object.values(app.state.proposals || {}).forEach(function(arr) {
                arr.forEach(function(p) { allProposals.push(p); });
            });
            var prop = allProposals.find(function(x) { return x.id === a.id; });
            if (prop) {
                var norm = typeof ProposalGrader !== 'undefined' ? ProposalGrader.normalize(prop) : null;
                if (norm) {
                    probCoupon = window._estimateCouponProb(norm);
                    probLoss = window._estimateLossProb(norm);
                    barrier = norm.barrier || 60;
                    matYears = norm.maturityYears || 5;
                }
            }
        } catch(e) {}

        var lossGivenBreach = ((100 - barrier) / 100) * 1.3;
        var expectedCouponReturn = Math.round(a.allocatedAmount * a.coupon / 100 * probCoupon);
        var expectedLoss = Math.round(a.allocatedAmount * lossGivenBreach * probLoss / Math.max(1, matYears));
        var expectedReturn = expectedCouponReturn - expectedLoss;

        a.annualReturn = Math.max(0, expectedReturn);
        a.catReturn = Math.round(a.allocatedAmount * catRate / 100);
        a.excessVsCat = a.annualReturn - a.catReturn;

        // Update reason with expected return info
        if (a.recommendation === 'SOUSCRIRE') {
            var exSign = a.excessVsCat >= 0 ? '+' : '';
            a.reason = 'Grade ' + a.grade + ' (' + a.score + '/100) \u2014 E[ret] ' + (typeof formatNumber === 'function' ? formatNumber(a.annualReturn) : a.annualReturn) + '\u20ac/an (prob ' + Math.round(probCoupon * 100) + '%) \u2192 ' + exSign + (typeof formatNumber === 'function' ? formatNumber(a.excessVsCat) : a.excessVsCat) + '\u20ac vs CAT';
        }
    }

    // Apply patches when ProposalGrader is ready
    if (!_patch()) {
        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            if (_patch() || attempts > 100) clearInterval(iv);
        }, 200);
    }
})();

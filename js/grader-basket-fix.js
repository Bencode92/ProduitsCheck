// ═══════════════════════════════════════════════════════════════════════════════
// BASKET FIX — 2 critical bugs
//
// Bug 1: "Panier équipondéré" treated as worst-of
//   - Parsing doesn't detect basket vs worst-of
//   - Grader applies worst-of exponent to ALL multi-underlying products
//   - Fix: detect basket keywords in name/rawText, set worstOf=false
//   - For baskets: prob = avg-weighted, not worst-of
//
// Bug 2: P4=0 for capital-guaranteed products
//   - Illiquidity premium + BS prob makes spread negative
//   - But capital-guaranteed = NO loss risk at maturity
//   - Fix: skip loss component in P4, reduce illiquidity premium
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    // ========================================
    // BUG 1: Detect basket vs worst-of
    // ========================================
    var BASKET_KEYWORDS = [
        'panier equi', 'panier équi', 'equiponder', 'équipondér',
        'equally weighted', 'equal weight', 'basket average',
        'average basket', 'panier moyen', 'moyenne pond',
        'somme pondérée', 'somme ponderee'
    ];

    function _isBasketProduct(product) {
        // Check name
        var name = (product.name || '').toLowerCase();
        // Check all text sources
        var rawText = (product.rawText || product._rawText || '').toLowerCase();
        var aiDesc = '';
        if (product.aiParsed) {
            aiDesc = JSON.stringify(product.aiParsed).toLowerCase();
        }
        var allText = name + ' ' + rawText + ' ' + aiDesc;

        for (var i = 0; i < BASKET_KEYWORDS.length; i++) {
            if (allText.indexOf(BASKET_KEYWORDS[i]) >= 0) return true;
        }

        // Also check if product has basketType field from AI parsing
        if (product.aiParsed && product.aiParsed.basketType) {
            var bt = product.aiParsed.basketType.toLowerCase();
            if (bt.indexOf('equi') >= 0 || bt.indexOf('average') >= 0 || bt.indexOf('moyen') >= 0) return true;
        }

        return false;
    }

    function _patch() {
        if (typeof ProposalGrader === 'undefined') return false;

        // --- BUG 1: Patch normalize to detect basket ---
        var _origNorm = ProposalGrader.normalize;
        if (_origNorm && !_origNorm._basketPatched) {
            ProposalGrader.normalize = function(product) {
                var n = _origNorm.call(this, product);

                // Detect basket
                if (n.underlyings && n.underlyings.length > 1) {
                    var isBasket = _isBasketProduct(product);
                    if (isBasket) {
                        n._isBasket = true;
                        n.worstOf = false; // Override worst-of flag
                        n._basketSize = n.underlyings.length;
                        console.log('[basket-fix] Detected BASKET (équipondéré) with ' + n.underlyings.length + ' underlyings → worstOf=false');
                    }
                }

                return n;
            };
            ProposalGrader.normalize._basketPatched = true;
        }

        // --- BUG 1: Patch _estimateCouponProb for baskets ---
        var _origCouponProb = window._estimateCouponProb;
        if (_origCouponProb && !_origCouponProb._basketPatched) {
            window._estimateCouponProb = function(p) {
                // If basket (not worst-of), use single-asset prob on the basket average
                if (p && p._isBasket && p.underlyings && p.underlyings.length > 1) {
                    // For a basket, the effective vol is reduced by diversification
                    // Vol_basket = Vol_avg / sqrt(N) * sqrt(1 + (N-1)*rho)
                    // With rho ~ 0.5 for mixed EU underlyings:
                    var n = p.underlyings.length;
                    var avgCorr = 0.50; // conservative for mixed basket
                    var volReduction = Math.sqrt((1 + (n - 1) * avgCorr) / n);

                    // Save and modify
                    var origWO = p.worstOf;
                    var origUnd = p.underlyings;
                    p.worstOf = false;
                    p.underlyings = [p.underlyings[0]]; // trick: single underlying for BS calc

                    // Get base prob (single asset)
                    var baseProb = _origCouponProb(p);

                    // Restore
                    p.worstOf = origWO;
                    p.underlyings = origUnd;

                    // Basket vol is lower → prob is higher
                    // Adjust: use the vol reduction to boost the prob
                    var adjustedProb = Math.min(0.95, baseProb + (1 - baseProb) * (1 - volReduction) * 0.8);

                    console.log('[basket-fix] Basket coupon prob: base=' + baseProb.toFixed(2) + ' volReduc=' + volReduction.toFixed(2) + ' adjusted=' + adjustedProb.toFixed(2));
                    return adjustedProb;
                }
                return _origCouponProb(p);
            };
            window._estimateCouponProb._basketPatched = true;
        }

        // --- BUG 1: Patch _estimateLossProb for baskets ---
        var _origLossProb = window._estimateLossProb;
        if (_origLossProb && !_origLossProb._basketPatched) {
            window._estimateLossProb = function(p) {
                if (p && p._isBasket && p.underlyings && p.underlyings.length > 1) {
                    // For basket: loss requires the AVERAGE to drop below barrier
                    // Much less likely than a single stock dropping
                    var origWO = p.worstOf;
                    var origUnd = p.underlyings;
                    p.worstOf = false;
                    p.underlyings = [p.underlyings[0]];

                    var baseProb = _origLossProb(p);

                    p.worstOf = origWO;
                    p.underlyings = origUnd;

                    // Basket diversification reduces loss prob significantly
                    var n = p.underlyings.length;
                    var diversificationFactor = Math.pow(0.6, Math.sqrt(n - 1)); // ~0.6 for 2, ~0.47 for 3, ~0.36 for 5
                    var adjustedProb = baseProb * diversificationFactor;

                    console.log('[basket-fix] Basket loss prob: base=' + baseProb.toFixed(3) + ' divFactor=' + diversificationFactor.toFixed(2) + ' adjusted=' + adjustedProb.toFixed(3));
                    return Math.max(0.005, adjustedProb);
                }
                return _origLossProb(p);
            };
            window._estimateLossProb._basketPatched = true;
        }

        // --- BUG 1: Patch P2 scoring for baskets ---
        // For baskets, P2 should use AVERAGE quality, not min()
        // We patch the AI prompt context to flag basket products
        // The actual P2 min() is deep in the grader closure, so we
        // post-process the result
        var _origGrade = ProposalGrader.grade;
        if (_origGrade && !_origGrade._basketP2Patched) {
            ProposalGrader.grade = function(product) {
                var resultPromise = _origGrade.call(this, product);

                // Check if basket
                var norm = ProposalGrader.normalize(product);
                var isBasket = norm._isBasket;

                if (resultPromise && typeof resultPromise.then === 'function') {
                    return resultPromise.then(function(result) {
                        if (isBasket) _fixBasketP2(result, product);
                        _fixCapitalGuaranteedP4(result, product);
                        return result;
                    });
                }
                if (isBasket) _fixBasketP2(resultPromise, product);
                _fixCapitalGuaranteedP4(resultPromise, product);
                return resultPromise;
            };
            ProposalGrader.grade._basketP2Patched = true;
        }

        console.log('[basket-fix] Patched: basket detection + capital-guaranteed P4');
        return true;
    }

    // ========================================
    // BUG 1: Fix P2 for baskets
    // The grader uses min() across all underlyings
    // For baskets, we boost P2 because the diversification
    // means the worst underlying only impacts 1/N of the payoff
    // ========================================
    function _fixBasketP2(result, product) {
        if (!result || !result.pillars || !result.pillars.underlyingQuality) return;

        var p2 = result.pillars.underlyingQuality;
        var oldScore = p2.score;

        // The min() unfairly penalizes baskets
        // For a basket of N, the worst stock is 1/N of the exposure
        // Boost P2 by (100 - P2) * (1 - 1/N) * 0.5
        var norm = ProposalGrader.normalize(product);
        var n = (norm.underlyings || []).length;
        if (n <= 1) return;

        var boost = Math.round((100 - oldScore) * (1 - 1/n) * 0.5);
        p2.score = Math.min(85, oldScore + boost);

        if (p2.reasoning) {
            p2.reasoning += ' | Basket équipondéré ' + n + ' actifs: P2 +' + boost + 'pts (diversification)';
        }

        // Recalculate total
        _recalcTotal(result);

        if (boost > 0) {
            console.log('[basket-fix] P2 boost for basket: ' + oldScore + ' → ' + p2.score + ' (+' + boost + ')');
        }
    }

    // ========================================
    // BUG 2: Fix P4 for capital-guaranteed products
    // Capital guaranteed = no loss at maturity
    // → Don't apply loss component in spread calc
    // → Reduce illiquidity premium (more liquid than at-risk products)
    // ========================================
    function _fixCapitalGuaranteedP4(result, product) {
        if (!result || !result.pillars || !result.pillars.riskPremium) return;
        if (!result.metadata) return;

        var norm = null;
        try { norm = ProposalGrader.normalize(product); } catch(e) { return; }
        if (!norm) return;

        // Only apply to capital-guaranteed products
        var isCapGaranteed = norm.capitalProtection ||
            (result.metadata.productType === 'capital_garanti') ||
            (product.capitalProtected) ||
            (product.aiParsed && product.aiParsed.capitalProtection);

        if (!isCapGaranteed) return;

        var p4 = result.pillars.riskPremium;
        var oldScore = p4.score;

        // For capital guaranteed: coupon vs CAT, no loss risk
        var coupon = norm.coupon || 0;
        if (typeof coupon === 'object') coupon = coupon.rate || 0;
        var catRate = 2.5;
        try {
            if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._catRate) {
                catRate = _mktCache._catRate;
            }
        } catch(e) {}

        var spread = coupon - catRate;
        // For capital guaranteed, illiquidity premium is much lower
        // (you can always get your capital back at maturity, or sell with ~1% bid-ask)
        var mat = norm.maturityYears || 5;
        var illiqPremium = 0.3 + 0.05 * Math.max(0, mat - 2); // much lower: 0.45% for 5Y vs 2.1%

        var effectiveSpread = spread - illiqPremium;

        // Score: spread-based
        var newP4;
        if (effectiveSpread <= 0) {
            newP4 = Math.max(15, 30 + Math.round(effectiveSpread * 10));
        } else if (effectiveSpread < 3) {
            newP4 = 30 + Math.round(effectiveSpread * 15);
        } else {
            newP4 = Math.min(90, 75 + Math.round((effectiveSpread - 3) * 5));
        }

        // Only apply if it improves the score (don't make it worse)
        if (newP4 > oldScore) {
            p4.score = newP4;
            if (p4.reasoning) {
                p4.reasoning = 'Capital garanti: spread ' + coupon.toFixed(1) + '% - CAT ' + catRate + '% - illiq ' + illiqPremium.toFixed(1) + '% = ' + effectiveSpread.toFixed(1) + '%';
            }
            _recalcTotal(result);
            console.log('[basket-fix] Capital garanti P4: ' + oldScore + ' → ' + newP4 + ' (spread ' + effectiveSpread.toFixed(1) + '%)');
        }
    }

    // Recalculate total score from pillars
    function _recalcTotal(result) {
        if (!result || !result.pillars) return;
        var w = result.metadata && result.metadata.isInPortfolio ?
            { adjustedReturn: 0.35, underlyingQuality: 0.35, portfolioFit: 0, riskPremium: 0.30 } :
            { adjustedReturn: 0.30, underlyingQuality: 0.25, portfolioFit: 0.20, riskPremium: 0.25 };

        var newTotal = Math.round(
            (result.pillars.adjustedReturn ? result.pillars.adjustedReturn.score : 0) * w.adjustedReturn +
            (result.pillars.underlyingQuality ? result.pillars.underlyingQuality.score : 0) * w.underlyingQuality +
            (result.pillars.portfolioFit ? result.pillars.portfolioFit.score : 0) * w.portfolioFit +
            (result.pillars.riskPremium ? result.pillars.riskPremium.score : 0) * w.riskPremium
        );

        result.score = newTotal;
        result.grade = newTotal >= 75 ? 'A' : newTotal >= 60 ? 'B' : newTotal >= 45 ? 'C' : newTotal >= 25 ? 'D' : 'F';
    }

    // Apply patches when ready
    if (!_patch()) {
        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            if (_patch() || attempts > 100) clearInterval(iv);
        }, 200);
    }
})();

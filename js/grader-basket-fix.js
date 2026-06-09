// ═══════════════════════════════════════════════════════════════════════════════
// BASKET FIX V1.1 — 3 critical bugs
//
// Bug 1: "Panier équipondéré" treated as worst-of → fix normalize + probs
// Bug 2: P4=0 for capital-guaranteed products → fix spread calc
// Bug 3 (V1.1): P1 still uses worst-stock vol for baskets → fix P1 post-grade
//   Root cause: _computeP1 uses worstMetrics.vol internally (closure),
//   can't be wrapped without crash. Fix: boost P1 in grade() post-processing
//   based on diversification benefit (n stocks, vol reduction).
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var BASKET_KEYWORDS = [
        'panier equi', 'panier équi', 'equiponder', 'équipondér',
        'equally weighted', 'equal weight', 'basket average',
        'average basket', 'panier moyen', 'moyenne pond',
        'somme pondérée', 'somme ponderee'
    ];

    function _isBasketProduct(product) {
        // Check structureType first (from UI dropdown or pdf parser)
        if (product.structureType === 'basket') return true;

        var name = (product.name || '').toLowerCase();
        var rawText = (product.rawText || product._rawText || '').toLowerCase();
        var aiDesc = '';
        if (product.aiParsed) {
            aiDesc = JSON.stringify(product.aiParsed).toLowerCase();
        }
        var allText = name + ' ' + rawText + ' ' + aiDesc;

        for (var i = 0; i < BASKET_KEYWORDS.length; i++) {
            if (allText.indexOf(BASKET_KEYWORDS[i]) >= 0) return true;
        }

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

                if (n.underlyings && n.underlyings.length > 1) {
                    var isBasket = _isBasketProduct(product);
                    if (isBasket) {
                        n._isBasket = true;
                        n.worstOf = false;
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
                if (p && p._isBasket && p.underlyings && p.underlyings.length > 1) {
                    var n = p.underlyings.length;
                    var avgCorr = 0.50;
                    var volReduction = Math.sqrt((1 + (n - 1) * avgCorr) / n);
                    var origWO = p.worstOf;
                    var origUnd = p.underlyings;
                    p.worstOf = false;
                    p.underlyings = [p.underlyings[0]];
                    var baseProb = _origCouponProb(p);
                    p.worstOf = origWO;
                    p.underlyings = origUnd;
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
                    var origWO = p.worstOf;
                    var origUnd = p.underlyings;
                    p.worstOf = false;
                    p.underlyings = [p.underlyings[0]];
                    var baseProb = _origLossProb(p);
                    p.worstOf = origWO;
                    p.underlyings = origUnd;
                    var n = p.underlyings.length;
                    var diversificationFactor = Math.pow(0.6, Math.sqrt(n - 1));
                    var adjustedProb = baseProb * diversificationFactor;
                    console.log('[basket-fix] Basket loss prob: base=' + baseProb.toFixed(3) + ' divFactor=' + diversificationFactor.toFixed(2) + ' adjusted=' + adjustedProb.toFixed(3));
                    return Math.max(0.005, adjustedProb);
                }
                return _origLossProb(p);
            };
            window._estimateLossProb._basketPatched = true;
        }

        // --- BUG 1+3: Patch grade() for P1 boost + P2 boost + P4 fix ---
        var _origGrade = ProposalGrader.grade;
        if (_origGrade && !_origGrade._basketP2Patched) {
            ProposalGrader.grade = function(product) {
                var resultPromise = _origGrade.call(this, product);
                var norm = ProposalGrader.normalize(product);
                var isBasket = norm._isBasket;

                if (resultPromise && typeof resultPromise.then === 'function') {
                    return resultPromise.then(function(result) {
                        if (isBasket) {
                            _fixBasketP1(result, product, norm);
                            _fixBasketP2(result, product);
                        }
                        _fixCapitalGuaranteedP4(result, product);
                        return result;
                    });
                }
                if (isBasket) {
                    _fixBasketP1(resultPromise, product, norm);
                    _fixBasketP2(resultPromise, product);
                }
                _fixCapitalGuaranteedP4(resultPromise, product);
                return resultPromise;
            };
            ProposalGrader.grade._basketP2Patched = true;
        }

        console.log('[basket-fix] V1.1 Patched: basket P1+P2+detection + capital-guaranteed P4');
        return true;
    }

    // ========================================
    // BUG 3 (V1.1): Fix P1 for baskets
    // P1 is computed using worst-stock vol (e.g. ENR 60%)
    // For baskets, the effective vol is much lower (~38%)
    // We boost P1 proportionally to the vol reduction
    // ========================================
    function _fixBasketP1(result, product, norm) {
        if (!result || !result.pillars) return;

        // Find P1 — key might be 'adjustedReturn' or 'couponAndCapital'
        var p1 = result.pillars.adjustedReturn || result.pillars.couponAndCapital;
        if (!p1) return;

        var n = (norm && norm.underlyings) ? norm.underlyings.length : 0;
        if (n < 2) return;

        var oldScore = p1.score;
        var reasoning = (p1.reasoning || '').toLowerCase();

        // Calculate boost based on diversification
        // For 4 stocks with rho=0.5: volReduction = sqrt((1+3*0.5)/4) = sqrt(0.625) = 0.79
        // Worst-of penalty that was applied: 3 * (n-2)^1.3 ≈ 7pts for n=4
        var rho = 0.50;
        var volReduction = Math.sqrt((1 + (n - 1) * rho) / n);
        var worstOfPenaltyReversal = Math.round(3 * Math.pow(Math.max(0, n - 2), 1.3));

        // Vol-based P1 boost: the grader penalized heavily for high vol
        // Each 10% vol reduction ≈ 8pts of P1 improvement
        // For ENR: worst vol ~60%, basket avg ~38%, delta ~22% → ~18pts
        var volBoost = Math.round((1 - volReduction) * 85);

        var totalBoost = worstOfPenaltyReversal + volBoost;
        totalBoost = Math.max(0, Math.min(30, totalBoost)); // cap at 30

        // Don't boost if P1 already high
        if (oldScore >= 60) totalBoost = Math.min(totalBoost, 5);

        if (totalBoost > 0) {
            p1.score = Math.min(75, oldScore + totalBoost);

            // Fix reasoning: replace worst-of language (case-insensitive)
            if (p1.reasoning) {
                p1.reasoning = p1.reasoning
                    .replace(/worst-of/gi, 'basket éq.')
                    .replace(/worst.performer/gi, 'basket avg')
                    .replace(/worst/gi, 'basket');
                p1.reasoning += ' | Basket +' + totalBoost + 'pts (vol÷' + volReduction.toFixed(2) + ')';
            }

            // Also update the pillar under its actual key
            if (result.pillars.adjustedReturn) result.pillars.adjustedReturn = p1;
            if (result.pillars.couponAndCapital) result.pillars.couponAndCapital = p1;

            _recalcTotal(result);
            console.log('[basket-fix] P1 boost for basket: ' + oldScore + ' → ' + p1.score + 
                ' (+' + totalBoost + ', volReduc=' + volReduction.toFixed(2) + ', woReversal=' + worstOfPenaltyReversal + ')');
        }
    }

    // ========================================
    // BUG 1: Fix P2 for baskets
    // ========================================
    function _fixBasketP2(result, product) {
        if (!result || !result.pillars) return;
        var p2 = result.pillars.underlyingQuality;
        if (!p2) return;

        var oldScore = p2.score;
        var norm = ProposalGrader.normalize(product);
        var n = (norm.underlyings || []).length;
        if (n <= 1) return;

        var boost = Math.round((100 - oldScore) * (1 - 1/n) * 0.5);
        p2.score = Math.min(85, oldScore + boost);

        if (p2.reasoning) {
            p2.reasoning += ' | Basket équipondéré ' + n + ' actifs: P2 +' + boost + 'pts (diversification)';
        }

        _recalcTotal(result);

        if (boost > 0) {
            console.log('[basket-fix] P2 boost for basket: ' + oldScore + ' → ' + p2.score + ' (+' + boost + ')');
        }
    }

    // ========================================
    // BUG 2: Fix P4 for capital-guaranteed products
    // ========================================
    function _fixCapitalGuaranteedP4(result, product) {
        if (!result || !result.pillars || !result.pillars.riskPremium) return;
        if (!result.metadata) return;

        var norm = null;
        try { norm = ProposalGrader.normalize(product); } catch(e) { return; }
        if (!norm) return;

        // Capital GARANTI = protégé ET sans barrière. Un produit à barrière (capital à RISQUE)
        // n'est pas capital garanti : ne pas lui appliquer le P4 "capital garanti" (sinon il ignore
        // la perte attendue et le reasoning contredit le score).
        var _aiCp = (product.aiParsed && product.aiParsed.capitalProtection) || {};
        var _protected = norm.capitalProtection === true ||
            (result.metadata.productType === 'capital_garanti') ||
            (product.capitalProtected === true) ||
            (_aiCp.protected === true) ||
            (parseFloat(_aiCp.level) >= 100);
        var _hasBarrier = parseFloat(norm.barrier) > 0 ||
            (product.capitalProtection && parseFloat(product.capitalProtection.barrier) > 0) ||
            (parseFloat(_aiCp.barrier) > 0);
        var isCapGaranteed = _protected && !_hasBarrier;

        if (!isCapGaranteed) return;

        var p4 = result.pillars.riskPremium;
        var oldScore = p4.score;

        var coupon = norm.coupon || 0;
        if (typeof coupon === 'object') coupon = coupon.rate || 0;
        // Coupon CONDITIONNEL (digital / mémoire / barrière coupon) → pondérer par la proba de le toucher.
        // Sinon on compte un coupon « illusoire » comme acquis et la prime vs CAT est surévaluée.
        var _ct = norm.couponType || (product.coupon && product.coupon.type) || '';
        var _cond = /conditionnel|digital|memoire/i.test(_ct) || (parseFloat(norm.barrierCoupon) > 0);
        var couponProb = 1;
        if (_cond && typeof _estimateCouponProb === 'function') {
            try { var _cp = _estimateCouponProb(norm); if (_cp != null) { if (_cp > 1) _cp = _cp / 100; if (_cp >= 0 && _cp <= 1) couponProb = _cp; } } catch(e) {}
        }
        var effCoupon = coupon * couponProb;
        var catRate = 2.5;
        try {
            if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._catRate) {
                catRate = _mktCache._catRate;
            }
        } catch(e) {}

        var spread = effCoupon - catRate;
        var mat = norm.maturityYears || 5;
        var illiqPremium = 0.3 + 0.05 * Math.max(0, mat - 2);
        var effectiveSpread = spread - illiqPremium;

        var newP4;
        if (effectiveSpread <= 0) {
            newP4 = Math.max(15, 30 + Math.round(effectiveSpread * 10));
        } else if (effectiveSpread < 3) {
            newP4 = 30 + Math.round(effectiveSpread * 15);
        } else {
            newP4 = Math.min(90, 75 + Math.round((effectiveSpread - 3) * 5));
        }

        if (newP4 > oldScore) {
            p4.score = newP4;
            if (p4.reasoning) {
                p4.reasoning = 'Capital garanti: ' + (couponProb < 1 ? 'coupon espéré ' + effCoupon.toFixed(1) + '% (' + coupon.toFixed(1) + '%×' + Math.round(couponProb * 100) + '% proba)' : 'coupon ' + coupon.toFixed(1) + '%') + ' - CAT ' + catRate + '% - illiq ' + illiqPremium.toFixed(1) + '% = ' + effectiveSpread.toFixed(1) + '%';
            }
            _recalcTotal(result);
            console.log('[basket-fix] Capital garanti P4: ' + oldScore + ' → ' + newP4 + ' (spread ' + effectiveSpread.toFixed(1) + '%)');
        }
    }

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

    if (!_patch()) {
        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            if (_patch() || attempts > 100) clearInterval(iv);
        }, 200);
    }
})();

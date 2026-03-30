// ═══════════════════════════════════════════════════════════════════════════════
// BASKET DETECTION PATCH v2 — Fix worst-of misclassification
//
// Problem: Products like "OBJECTIF MAI 2026" are panier équipondéré but graded
// as worst-of because:
//   1. No "Panier équipondéré" option in UI dropdown (fixed by edit-modal v1.8)
//   2. basket-fix.js only checks rawText keywords — if rawText isn't stored, detection fails
//   3. No check on structureType === 'basket' from manual selection
//   4. PDF parser doesn't flag basket products
//
// This patch adds 3 layers of detection:
//   Layer 1: structureType === 'basket' (manual selection from UI)
//   Layer 2: Enhanced keyword detection (name, aiParsed, rawText, description)
//   Layer 3: Auto-detection from AI parsed data (basketType field, mechanism description)
//
// Must load AFTER grader-basket-fix.js (which loads after sprint1)
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    // Extended basket keywords (beyond basket-fix.js)
    var BASKET_KEYWORDS_EXTENDED = [
        'panier equi', 'panier \u00e9qui', 'equiponder', '\u00e9quipond\u00e9r',
        'equally weighted', 'equal weight', 'basket average',
        'average basket', 'panier moyen', 'moyenne pond',
        'somme pond\u00e9r\u00e9e', 'somme ponderee',
        // New patterns
        'panier d\'actions \u00e9qui', 'panier d\'actions equi',
        'poids identique', 'poids \u00e9gal',
        'performance moyenne du panier', 'niveau du panier',
        'un panier compos\u00e9', 'un panier equi-pond\u00e9r\u00e9',
        'chaque action repr\u00e9sente un poids identique',
        'chaque action represente un poids identique'
    ];

    // ========================================
    // ENHANCED BASKET DETECTION
    // ========================================
    function _isBasketProductEnhanced(product) {
        // Layer 1: Manual structureType from UI
        if (product.structureType === 'basket') {
            console.log('[BasketV2] Detected via structureType=basket');
            return true;
        }

        // Layer 2: Keywords in all text sources
        var name = (product.name || '').toLowerCase();
        var rawText = (product.rawText || product._rawText || '').toLowerCase();
        var aiDesc = '';
        var mechanism = '';

        if (product.aiParsed) {
            try { aiDesc = JSON.stringify(product.aiParsed).toLowerCase(); } catch(e) {}
            // Check specific aiParsed fields
            mechanism = (product.aiParsed.mechanism || product.aiParsed.mecanisme || '').toLowerCase();
            var desc = (product.aiParsed.description || product.aiParsed.description_courte || '').toLowerCase();
            aiDesc += ' ' + mechanism + ' ' + desc;

            // Layer 3: basketType field from AI
            if (product.aiParsed.basketType || product.aiParsed.basket_type || product.aiParsed.typeBasket) {
                var bt = (product.aiParsed.basketType || product.aiParsed.basket_type || product.aiParsed.typeBasket || '').toLowerCase();
                if (bt.indexOf('equi') >= 0 || bt.indexOf('average') >= 0 || bt.indexOf('moyen') >= 0 || bt.indexOf('equal') >= 0) {
                    console.log('[BasketV2] Detected via aiParsed.basketType=' + bt);
                    return true;
                }
            }

            // Layer 3b: Check if AI says "panier" in underlyingType or productType
            var pType = (product.aiParsed.productType || product.aiParsed.type_produit || product.aiParsed.type || '').toLowerCase();
            if (pType.indexOf('panier') >= 0 && pType.indexOf('worst') < 0) {
                console.log('[BasketV2] Detected via aiParsed.productType=' + pType);
                return true;
            }
        }

        // Also check product-level description
        var productDesc = (product.description || '').toLowerCase();
        
        var allText = name + ' ' + rawText + ' ' + aiDesc + ' ' + productDesc;

        // Check all keywords
        for (var i = 0; i < BASKET_KEYWORDS_EXTENDED.length; i++) {
            if (allText.indexOf(BASKET_KEYWORDS_EXTENDED[i]) >= 0) {
                console.log('[BasketV2] Detected via keyword: "' + BASKET_KEYWORDS_EXTENDED[i] + '"');
                return true;
            }
        }

        // Layer 3c: Heuristic — if mechanism mentions "panier" but NOT "worst" or "pire des"
        if (mechanism && mechanism.indexOf('panier') >= 0 && 
            mechanism.indexOf('worst') < 0 && mechanism.indexOf('pire') < 0) {
            console.log('[BasketV2] Detected via mechanism heuristic (panier without worst)');
            return true;
        }

        return false;
    }

    // ========================================
    // PATCH: Override basket detection in grader-basket-fix
    // ========================================
    function _patchBasketDetection() {
        if (typeof ProposalGrader === 'undefined') return false;

        var _currentNormalize = ProposalGrader.normalize;
        if (!_currentNormalize) return false;
        if (_currentNormalize._basketV2Patched) return true;

        ProposalGrader.normalize = function(product) {
            var n = _currentNormalize.call(this, product);

            // If basket-fix already detected it, great
            if (n._isBasket) return n;

            // Try enhanced detection
            if (n.underlyings && n.underlyings.length > 1) {
                var isBasket = _isBasketProductEnhanced(product);
                if (isBasket) {
                    n._isBasket = true;
                    n.worstOf = false;
                    n._basketSize = n.underlyings.length;
                    
                    if (!product.structureType) {
                        product.structureType = 'basket';
                    }
                    
                    console.log('[BasketV2] OVERRIDE: ' + (product.name || '?') + 
                        ' \u2192 basket with ' + n.underlyings.length + ' underlyings, worstOf=FALSE');
                }
            }

            return n;
        };
        ProposalGrader.normalize._basketV2Patched = true;

        // Patch _estimateCouponProb for basket products
        var _currentCouponProb = window._estimateCouponProb;
        if (_currentCouponProb && !_currentCouponProb._basketV2Patched) {
            window._estimateCouponProb = function(p) {
                var prob = _currentCouponProb(p);

                if (p._isBasket && p._basketSize > 1 && !p.worstOf) {
                    var n = p._basketSize || 4;
                    var rho = 0.50;
                    var volReduction = Math.sqrt((1 + (n - 1) * rho) / n);
                    var adjustment = (1 - prob) * (1 - volReduction) * 0.5;
                    var adjustedProb = Math.min(0.95, prob + adjustment);
                    
                    if (adjustedProb > prob) {
                        console.log('[BasketV2] Coupon prob adjusted: ' + 
                            (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + 
                            '% (basket ' + n + ' stocks, volReduction=' + volReduction.toFixed(2) + ')');
                        return adjustedProb;
                    }
                }

                return prob;
            };
            window._estimateCouponProb._basketV2Patched = true;
        }

        // Patch _estimateLossProb for basket
        var _currentLossProb = window._estimateLossProb;
        if (_currentLossProb && !_currentLossProb._basketV2Patched) {
            window._estimateLossProb = function(p) {
                var prob = _currentLossProb(p);

                if (p._isBasket && p._basketSize > 1 && !p.worstOf) {
                    var n = p._basketSize || 4;
                    var rho = 0.50;
                    var volReduction = Math.sqrt((1 + (n - 1) * rho) / n);
                    var adjustedProb = prob * volReduction;
                    
                    if (adjustedProb < prob) {
                        console.log('[BasketV2] Loss prob adjusted: ' + 
                            (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + 
                            '% (basket diversification)');
                        return Math.max(0.005, adjustedProb);
                    }
                }

                return prob;
            };
            window._estimateLossProb._basketV2Patched = true;
        }

        return true;
    }

    // ========================================
    // PATCH: Override grade() post-processing for basket P2
    // ========================================
    function _patchBasketGrading() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

        var _currentGrade = ProposalGrader.grade;
        if (_currentGrade._basketV2Patched) return true;

        ProposalGrader.grade = async function(product) {
            var result = await _currentGrade.call(this, product);

            var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : null;
            var isBasket = (norm && norm._isBasket) || product.structureType === 'basket';

            if (isBasket && result && result.pillars) {
                var p2 = result.pillars.underlyingQuality;
                if (p2 && p2.score < 50) {
                    var boost = Math.min(15, Math.round((50 - p2.score) * 0.4));
                    p2.score = Math.min(80, p2.score + boost);
                    p2.reasoning = (p2.reasoning || '') + 
                        ' | Basket \u00e9quipond\u00e9r\u00e9 +' + boost + 'pts (risque dilu\u00e9 par moyenne)';
                    console.log('[BasketV2] P2 boosted by ' + boost + ' for basket product');
                }

                var p1 = result.pillars.couponAndCapital;
                if (p1 && p1.reasoning && p1.reasoning.indexOf('Worst') >= 0) {
                    var p1boost = Math.min(10, Math.round(((norm && norm.underlyings) ? norm.underlyings.length : 4) * 2));
                    p1.score = Math.min(100, p1.score + p1boost);
                    p1.reasoning = p1.reasoning.replace(/Worst[^|]*\|?/, '') + 
                        ' | Basket \u00e9quipond\u00e9r\u00e9 +' + p1boost + 'pts';
                    console.log('[BasketV2] P1 boosted by ' + p1boost + ' (removed worst-of penalty)');
                }

                // Recalculate total score
                var weights = { couponAndCapital: 0.30, underlyingQuality: 0.25, 
                                portfolioFit: 0.20, primeVsCat: 0.25 };
                var newScore = 0;
                for (var key in weights) {
                    if (result.pillars[key]) {
                        newScore += result.pillars[key].score * weights[key];
                    }
                }
                newScore = Math.round(newScore);

                if (newScore > result.score) {
                    console.log('[BasketV2] Score recalculated: ' + result.score + ' \u2192 ' + newScore);
                    result.score = newScore;
                    
                    if (newScore >= 75) result.grade = 'A';
                    else if (newScore >= 55) result.grade = 'B';
                    else if (newScore >= 40) result.grade = 'C';
                    else if (newScore >= 25) result.grade = 'D';
                    else result.grade = 'F';
                }
            }

            return result;
        };
        ProposalGrader.grade._basketV2Patched = true;
        return true;
    }

    // ========================================
    // PATCH: Auto-detect structure type for basket products
    // ========================================
    function _patchAutoDetect() {
        if (typeof _autoDetectStructureType !== 'function') return false;
        
        var _origAutoDetect = _autoDetectStructureType;
        if (_origAutoDetect._basketV2Patched) return true;

        window._autoDetectStructureType = function(product) {
            var result = _origAutoDetect(product);
            
            if ((!result || result === 'autocall') && product.underlyings && product.underlyings.length > 1) {
                if (_isBasketProductEnhanced(product)) {
                    console.log('[BasketV2] Auto-detected structure type: basket');
                    return 'basket';
                }
            }

            return result;
        };
        window._autoDetectStructureType._basketV2Patched = true;
        return true;
    }

    // ========================================
    // INIT
    // ========================================
    var _basketV2Interval = setInterval(function() {
        var ok1 = _patchBasketDetection();
        var ok2 = _patchBasketGrading();
        var ok3 = _patchAutoDetect();

        if (ok1 && ok2) {
            clearInterval(_basketV2Interval);
            console.log('[StructBoard] Basket Detection V2 active \u2014 3 layers: structureType + keywords + AI');
        }
    }, 300);

    setTimeout(function() { clearInterval(_basketV2Interval); }, 15000);

})();

console.log('[StructBoard] Basket Detection V2 patch loaded');

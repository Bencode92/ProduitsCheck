// ═══════════════════════════════════════════════════════════════════════════════
// BASKET DETECTION PATCH v2.1 — Fix worst-of misclassification + P2 fix
//
// v2.1: Enhanced P2 scoring for baskets (use average metrics, not worst)
//       + P1 barrier penalty reduction for basket diversification
//       + Better integration with AI grading prompt context
//
// 3 layers of detection:
//   Layer 1: structureType === 'basket' (manual selection from UI or pdf.js V7.8)
//   Layer 2: Enhanced keyword detection (name, aiParsed, rawText, description)
//   Layer 3: Auto-detection from AI parsed data
//
// Must load AFTER grader-basket-fix.js
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var BASKET_KEYWORDS_EXTENDED = [
        'panier equi', 'panier \u00e9qui', 'equiponder', '\u00e9quipond\u00e9r',
        'equally weighted', 'equal weight', 'basket average',
        'average basket', 'panier moyen', 'moyenne pond',
        'somme pond\u00e9r\u00e9e', 'somme ponderee',
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
        if (product.structureType === 'basket') {
            return true;
        }
        var name = (product.name || '').toLowerCase();
        var rawText = (product.rawText || product._rawText || '').toLowerCase();
        // V7.8: also check _rawTextSnippet from pdf.js
        var rawSnippet = (product.aiParsed && product.aiParsed._rawTextSnippet || '').toLowerCase();
        var aiDesc = '';
        var mechanism = '';

        if (product.aiParsed) {
            try { aiDesc = JSON.stringify(product.aiParsed).toLowerCase(); } catch(e) {}
            mechanism = (product.aiParsed.mechanism || product.aiParsed.mecanisme || '').toLowerCase();
            var desc = (product.aiParsed.description || product.aiParsed.description_courte || '').toLowerCase();
            aiDesc += ' ' + mechanism + ' ' + desc;

            if (product.aiParsed.basketType || product.aiParsed.basket_type || product.aiParsed.typeBasket) {
                var bt = (product.aiParsed.basketType || product.aiParsed.basket_type || product.aiParsed.typeBasket || '').toLowerCase();
                if (bt.indexOf('equi') >= 0 || bt.indexOf('average') >= 0 || bt.indexOf('moyen') >= 0 || bt.indexOf('equal') >= 0) {
                    return true;
                }
            }

            var pType = (product.aiParsed.productType || product.aiParsed.type_produit || product.aiParsed.type || '').toLowerCase();
            if (pType.indexOf('panier') >= 0 && pType.indexOf('worst') < 0) {
                return true;
            }

            // V7.8: check underlyingType from pdf parser
            var uType = (product.aiParsed.underlyingType || '').toLowerCase();
            if (uType === 'basket') {
                return true;
            }

            // V7.8: check _isBasket flag from pdf.js
            if (product.aiParsed._isBasket === true) {
                return true;
            }
        }

        var productDesc = (product.description || '').toLowerCase();
        var allText = name + ' ' + rawText + ' ' + rawSnippet + ' ' + aiDesc + ' ' + productDesc;

        for (var i = 0; i < BASKET_KEYWORDS_EXTENDED.length; i++) {
            if (allText.indexOf(BASKET_KEYWORDS_EXTENDED[i]) >= 0) {
                return true;
            }
        }

        if (mechanism && mechanism.indexOf('panier') >= 0 && 
            mechanism.indexOf('worst') < 0 && mechanism.indexOf('pire') < 0) {
            return true;
        }

        return false;
    }

    // ========================================
    // BASKET METRICS HELPER — compute average metrics for basket
    // ========================================
    function _computeBasketAverageMetrics(product, market) {
        if (!market || !market.stocks) return null;
        
        var found = (market.stocks || []).filter(function(s) { return s.found; });
        if (found.length < 2) return null;
        
        var n = found.length;
        var avgVol = 0, avgDD = 0, avgBeta = 0, avgBuffett = 0, avgQuality = 0;
        var countBuffett = 0, countQuality = 0;
        
        found.forEach(function(s) {
            avgVol += (s.volatility_3y || 25) / n;
            avgDD += Math.abs(s.drawdown_3y || -20) / n;
            avgBeta += (s.beta || 1.0) / n;
            if (s.buffett_score !== undefined && s.buffett_score !== null) {
                avgBuffett += s.buffett_score; countBuffett++;
            }
            if (s.quality_score !== undefined && s.quality_score !== null) {
                avgQuality += s.quality_score; countQuality++;
            }
        });
        
        if (countBuffett > 0) avgBuffett /= countBuffett;
        if (countQuality > 0) avgQuality /= countQuality;
        
        // Basket vol is lower than average vol due to diversification
        // vol_basket ≈ vol_avg × sqrt((1 + (n-1) × rho) / n)
        var rho = 0.50; // conservative cross-correlation
        var diversificationFactor = Math.sqrt((1 + (n - 1) * rho) / n);
        var basketVol = avgVol * diversificationFactor;
        var basketDD = avgDD * diversificationFactor; // drawdown also diversified
        
        return {
            vol: Math.round(basketVol * 10) / 10,
            dd: -Math.round(basketDD * 10) / 10,
            beta: Math.round(avgBeta * 100) / 100,
            buffett: Math.round(avgBuffett),
            quality: Math.round(avgQuality),
            nStocks: n,
            diversificationFactor: Math.round(diversificationFactor * 100) / 100
        };
    }

    // ========================================
    // PATCH: Normalize + probabilities
    // ========================================
    function _patchBasketDetection() {
        if (typeof ProposalGrader === 'undefined') return false;

        var _currentNormalize = ProposalGrader.normalize;
        if (!_currentNormalize) return false;
        if (_currentNormalize._basketV2Patched) return true;

        ProposalGrader.normalize = function(product) {
            var n = _currentNormalize.call(this, product);

            if (n._isBasket) return n;

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

        // Patch _estimateCouponProb
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
                        console.log('[BasketV2] Coupon prob: ' + 
                            (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + '%');
                        return adjustedProb;
                    }
                }
                return prob;
            };
            window._estimateCouponProb._basketV2Patched = true;
        }

        // Patch _estimateLossProb
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
                        console.log('[BasketV2] Loss prob: ' + 
                            (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + '%');
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
    // PATCH: P2 — Use average metrics for basket, not worst
    // ========================================
    function _patchBasketP2() {
        if (typeof _computeP2 !== 'function') return false;
        
        var _currentP2 = _computeP2;
        if (_currentP2._basketV2Patched) return true;

        window._computeP2 = function(p, market, productType) {
            // For baskets: override market metrics with averages before computing P2
            if (p._isBasket && market && market.stocks) {
                var avgMetrics = _computeBasketAverageMetrics(null, market);
                if (avgMetrics) {
                    // Create modified market with basket-averaged worst metrics
                    var basketMarket = JSON.parse(JSON.stringify(market));
                    if (basketMarket.worstMetrics) {
                        basketMarket.worstMetrics.volatility_3y = avgMetrics.vol;
                        basketMarket.worstMetrics.drawdown_3y = avgMetrics.dd;
                        basketMarket.worstMetrics.beta = avgMetrics.beta;
                        if (avgMetrics.buffett) basketMarket.worstMetrics.buffett_score = avgMetrics.buffett;
                        if (avgMetrics.quality) basketMarket.worstMetrics.quality_score = avgMetrics.quality;
                        
                        console.log('[BasketV2] P2: using basket average metrics — vol ' + 
                            avgMetrics.vol + '% (×' + avgMetrics.diversificationFactor + '), DD ' + 
                            avgMetrics.dd + '%, beta ' + avgMetrics.beta);
                    }
                    return _currentP2(p, basketMarket, productType);
                }
            }
            
            return _currentP2(p, market, productType);
        };
        window._computeP2._basketV2Patched = true;
        // Also update if ProposalGrader references it
        if (typeof ProposalGrader !== 'undefined') {
            ProposalGrader._computeP2 = window._computeP2;
        }
        return true;
    }

    // ========================================
    // PATCH: grade() post-processing for P1 + recalc
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
                var changed = false;

                // P1: Remove worst-of penalty if still in reasoning
                var p1 = result.pillars.couponAndCapital;
                if (p1 && p1.reasoning && p1.reasoning.indexOf('Worst') >= 0) {
                    var nUnd = (norm && norm.underlyings) ? norm.underlyings.length : 4;
                    var p1boost = Math.min(10, Math.round(nUnd * 2));
                    p1.score = Math.min(100, p1.score + p1boost);
                    p1.reasoning = p1.reasoning.replace(/Worst[^|]*\|?/, '') + 
                        ' | Basket \u00e9quipond\u00e9r\u00e9 +' + p1boost + 'pts';
                    changed = true;
                    console.log('[BasketV2] P1 +' + p1boost + ' (worst-of penalty removed)');
                }

                // P2: Additional boost if P2 was still computed with worst metrics
                // (safety net in case _computeP2 override didn't fire)
                var p2 = result.pillars.underlyingQuality;
                if (p2 && p2.score < 45) {
                    var boost = Math.min(20, Math.round((50 - p2.score) * 0.5));
                    p2.score = Math.min(75, p2.score + boost);
                    p2.reasoning = (p2.reasoning || '') + 
                        ' | Basket \u00e9quipond\u00e9r\u00e9 +' + boost + 'pts (m\u00e9triques moyenn\u00e9es)';
                    changed = true;
                    console.log('[BasketV2] P2 +' + boost + ' (basket averaging safety net)');
                }

                // Recalculate total score if anything changed
                if (changed) {
                    var weights = { couponAndCapital: 0.30, underlyingQuality: 0.25, 
                                    portfolioFit: 0.20, primeVsCat: 0.25 };
                    var newScore = 0;
                    for (var key in weights) {
                        if (result.pillars[key]) {
                            newScore += result.pillars[key].score * weights[key];
                        }
                    }
                    newScore = Math.round(newScore);

                    if (newScore !== result.score) {
                        console.log('[BasketV2] Score: ' + result.score + ' \u2192 ' + newScore);
                        result.score = newScore;
                        
                        if (newScore >= 75) result.grade = 'A';
                        else if (newScore >= 55) result.grade = 'B';
                        else if (newScore >= 40) result.grade = 'C';
                        else if (newScore >= 25) result.grade = 'D';
                        else result.grade = 'F';
                    }
                }

                // Add basket info to result for display
                result._isBasket = true;
                result._basketInfo = 'Panier \u00e9quipond\u00e9r\u00e9 ' + 
                    ((norm && norm.underlyings) ? norm.underlyings.length : '?') + ' actions';
            }

            return result;
        };
        ProposalGrader.grade._basketV2Patched = true;
        return true;
    }

    // ========================================
    // PATCH: Auto-detect structure type
    // ========================================
    function _patchAutoDetect() {
        if (typeof _autoDetectStructureType !== 'function') return false;
        
        var _origAutoDetect = _autoDetectStructureType;
        if (_origAutoDetect._basketV2Patched) return true;

        window._autoDetectStructureType = function(product) {
            var result = _origAutoDetect(product);
            
            if ((!result || result === 'autocall') && product.underlyings && product.underlyings.length > 1) {
                if (_isBasketProductEnhanced(product)) {
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
        var ok4 = _patchBasketP2();

        if (ok1 && ok2 && ok4) {
            clearInterval(_basketV2Interval);
            console.log('[StructBoard] Basket V2.1 active \u2014 detection + P2 average metrics + prob adjustment');
        }
    }, 300);

    setTimeout(function() { clearInterval(_basketV2Interval); }, 15000);

})();

console.log('[StructBoard] Basket Detection V2.1 loaded');

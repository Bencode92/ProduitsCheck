// ═══════════════════════════════════════════════════════════════════════════════
// BASKET DETECTION PATCH v2.2 — Fix P1 + P2 for basket products
//
// v2.2: CRITICAL FIX — wrap _computeP1 to use basket-averaged metrics
//       P1 was still using worst-stock vol (e.g. ENR 60%) instead of
//       basket-averaged vol (~38%). This caused P1=11 instead of ~45.
// v2.1: P2 average metrics, prob adjustment
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

    function _isBasketProductEnhanced(product) {
        if (product.structureType === 'basket') return true;
        var name = (product.name || '').toLowerCase();
        var rawText = (product.rawText || product._rawText || '').toLowerCase();
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
                if (bt.indexOf('equi') >= 0 || bt.indexOf('average') >= 0 || bt.indexOf('moyen') >= 0 || bt.indexOf('equal') >= 0) return true;
            }
            var pType = (product.aiParsed.productType || product.aiParsed.type_produit || product.aiParsed.type || '').toLowerCase();
            if (pType.indexOf('panier') >= 0 && pType.indexOf('worst') < 0) return true;
            var uType = (product.aiParsed.underlyingType || '').toLowerCase();
            if (uType === 'basket') return true;
            if (product.aiParsed._isBasket === true) return true;
        }

        var productDesc = (product.description || '').toLowerCase();
        var allText = name + ' ' + rawText + ' ' + rawSnippet + ' ' + aiDesc + ' ' + productDesc;
        for (var i = 0; i < BASKET_KEYWORDS_EXTENDED.length; i++) {
            if (allText.indexOf(BASKET_KEYWORDS_EXTENDED[i]) >= 0) return true;
        }
        if (mechanism && mechanism.indexOf('panier') >= 0 && 
            mechanism.indexOf('worst') < 0 && mechanism.indexOf('pire') < 0) return true;
        return false;
    }

    // ========================================
    // BASKET METRICS HELPER
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
            if (s.buffett_score !== undefined && s.buffett_score !== null) { avgBuffett += s.buffett_score; countBuffett++; }
            if (s.quality_score !== undefined && s.quality_score !== null) { avgQuality += s.quality_score; countQuality++; }
        });
        
        if (countBuffett > 0) avgBuffett /= countBuffett;
        if (countQuality > 0) avgQuality /= countQuality;
        
        var rho = 0.50;
        var diversificationFactor = Math.sqrt((1 + (n - 1) * rho) / n);
        var basketVol = avgVol * diversificationFactor;
        var basketDD = avgDD * diversificationFactor;
        
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

    // Helper: create a basket-averaged market object from original market
    function _createBasketMarket(market) {
        var avgMetrics = _computeBasketAverageMetrics(null, market);
        if (!avgMetrics) return null;
        
        var basketMarket = JSON.parse(JSON.stringify(market));
        if (basketMarket.worstMetrics) {
            basketMarket.worstMetrics.volatility_3y = avgMetrics.vol;
            basketMarket.worstMetrics.drawdown_3y = avgMetrics.dd;
            basketMarket.worstMetrics.beta = avgMetrics.beta;
            if (avgMetrics.buffett) basketMarket.worstMetrics.buffett_score = avgMetrics.buffett;
            if (avgMetrics.quality) basketMarket.worstMetrics.quality_score = avgMetrics.quality;
            // Override the worst stock name to indicate basket
            basketMarket.worstMetrics.name = 'Basket avg (' + avgMetrics.nStocks + ' stocks)';
            basketMarket.worstMetrics.ticker = 'BASKET';
        }
        basketMarket._basketAvgMetrics = avgMetrics;
        return basketMarket;
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
                    if (!product.structureType) product.structureType = 'basket';
                    console.log('[BasketV2.2] NORMALIZE: ' + (product.name || '?') + 
                        ' \u2192 basket ' + n.underlyings.length + ' stocks, worstOf=FALSE');
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
                        console.log('[BasketV2.2] Coupon prob: ' + (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + '%');
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
                        console.log('[BasketV2.2] Loss prob: ' + (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + '%');
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
    // PATCH: P1 — Use average metrics for basket (THE CRITICAL FIX)
    // ========================================
    function _patchBasketP1() {
        if (typeof _computeP1 !== 'function') return false;
        
        var _currentP1 = _computeP1;
        if (_currentP1._basketV2Patched) return true;

        window._computeP1 = function(p, market, productType) {
            if (p._isBasket && market && market.stocks) {
                var basketMarket = _createBasketMarket(market);
                if (basketMarket) {
                    console.log('[BasketV2.2] P1: using basket avg metrics \u2014 vol ' + 
                        basketMarket._basketAvgMetrics.vol + '% (x' + 
                        basketMarket._basketAvgMetrics.diversificationFactor + '), DD ' + 
                        basketMarket._basketAvgMetrics.dd + '%');
                    return _currentP1(p, basketMarket, productType);
                }
            }
            return _currentP1(p, market, productType);
        };
        window._computeP1._basketV2Patched = true;
        if (typeof ProposalGrader !== 'undefined') {
            ProposalGrader._computeP1 = window._computeP1;
        }
        return true;
    }

    // ========================================
    // PATCH: P2 — Use average metrics for basket
    // ========================================
    function _patchBasketP2() {
        if (typeof _computeP2 !== 'function') return false;
        
        var _currentP2 = _computeP2;
        if (_currentP2._basketV2Patched) return true;

        window._computeP2 = function(p, market, productType) {
            if (p._isBasket && market && market.stocks) {
                var basketMarket = _createBasketMarket(market);
                if (basketMarket) {
                    console.log('[BasketV2.2] P2: using basket avg metrics \u2014 vol ' + 
                        basketMarket._basketAvgMetrics.vol + '%, DD ' + 
                        basketMarket._basketAvgMetrics.dd + '%, beta ' + 
                        basketMarket._basketAvgMetrics.beta);
                    return _currentP2(p, basketMarket, productType);
                }
            }
            return _currentP2(p, market, productType);
        };
        window._computeP2._basketV2Patched = true;
        if (typeof ProposalGrader !== 'undefined') {
            ProposalGrader._computeP2 = window._computeP2;
        }
        return true;
    }

    // ========================================
    // PATCH: grade() post-processing — recalc + basket info
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

                // P1: If reasoning still mentions "Worst" despite our P1 override, fix it
                var p1 = result.pillars.couponAndCapital;
                if (p1 && p1.reasoning) {
                    // Replace worst-of language in reasoning
                    if (p1.reasoning.indexOf('worst-of') >= 0 || p1.reasoning.indexOf('Worst') >= 0 || p1.reasoning.indexOf('worst') >= 0) {
                        p1.reasoning = p1.reasoning
                            .replace(/worst-of/gi, 'basket \u00e9quipond\u00e9r\u00e9')
                            .replace(/Worst[^|]*/g, 'Basket avg ')
                            .replace(/\|\s*\|/g, '|');
                        changed = true;
                    }
                }

                // P2: Safety net if P2 override didn't fire
                var p2 = result.pillars.underlyingQuality;
                if (p2 && p2.score < 40) {
                    var boost = Math.min(25, Math.round((55 - p2.score) * 0.5));
                    p2.score = Math.min(75, p2.score + boost);
                    p2.reasoning = (p2.reasoning || '') + 
                        ' | Basket \u00e9quipond\u00e9r\u00e9 +' + boost + 'pts (safety net)';
                    changed = true;
                    console.log('[BasketV2.2] P2 safety net +' + boost);
                }

                // Recalculate total
                if (changed) {
                    var weights = { couponAndCapital: 0.30, underlyingQuality: 0.25, 
                                    portfolioFit: 0.20, primeVsCat: 0.25 };
                    var newScore = 0;
                    for (var key in weights) {
                        if (result.pillars[key]) newScore += result.pillars[key].score * weights[key];
                    }
                    newScore = Math.round(newScore);
                    if (newScore !== result.score) {
                        console.log('[BasketV2.2] Score: ' + result.score + ' \u2192 ' + newScore);
                        result.score = newScore;
                        if (newScore >= 75) result.grade = 'A';
                        else if (newScore >= 55) result.grade = 'B';
                        else if (newScore >= 40) result.grade = 'C';
                        else if (newScore >= 25) result.grade = 'D';
                        else result.grade = 'F';
                    }
                }

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
                if (_isBasketProductEnhanced(product)) return 'basket';
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
        var ok5 = _patchBasketP1();

        if (ok1 && ok2 && ok4 && ok5) {
            clearInterval(_basketV2Interval);
            console.log('[StructBoard] Basket V2.2 active \u2014 P1+P2 avg metrics + probs + detection');
        }
    }, 300);

    setTimeout(function() { clearInterval(_basketV2Interval); }, 15000);

})();

console.log('[StructBoard] Basket Detection V2.2 loaded');

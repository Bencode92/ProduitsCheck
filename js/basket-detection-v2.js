// ═══════════════════════════════════════════════════════════════════════════════
// BASKET DETECTION PATCH v2.3 — P1 recalc in grade() post-processing
//
// v2.3: APPROACH CHANGE — Don't wrap _computeP1 (crashes with sprint1 chain).
//       Instead, recalculate P1 AFTER grade() using vol-based adjustment.
//       The grader computes P1 with worst-stock vol (ENR 60%).
//       We compute basket-avg vol (~38%) and boost P1 proportionally.
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
        var avgVol = 0, avgDD = 0, avgBeta = 0, worstVol = 0, worstDD = 0;
        
        found.forEach(function(s) {
            var vol = s.volatility_3y || 25;
            var dd = Math.abs(s.drawdown_3y || -20);
            avgVol += vol / n;
            avgDD += dd / n;
            avgBeta += (s.beta || 1.0) / n;
            if (vol > worstVol) worstVol = vol;
            if (dd > worstDD) worstDD = dd;
        });
        
        var rho = 0.50;
        var diversificationFactor = Math.sqrt((1 + (n - 1) * rho) / n);
        var basketVol = avgVol * diversificationFactor;
        var basketDD = avgDD * diversificationFactor;
        
        return {
            vol: Math.round(basketVol * 10) / 10,
            dd: -Math.round(basketDD * 10) / 10,
            beta: Math.round(avgBeta * 100) / 100,
            worstVol: worstVol,
            worstDD: worstDD,
            nStocks: n,
            diversificationFactor: Math.round(diversificationFactor * 100) / 100
        };
    }

    // ========================================
    // P1 BASKET BOOST CALCULATOR
    // Computes how much P1 should be boosted based on vol reduction
    // ========================================
    function _computeP1BasketBoost(p1Score, avgMetrics, barrier, maturityYears) {
        if (!avgMetrics || !avgMetrics.worstVol || avgMetrics.worstVol <= 0) return 0;
        
        var worstVol = avgMetrics.worstVol / 100;
        var basketVol = avgMetrics.vol / 100;
        var bar = (barrier || 60) / 100;
        var T = maturityYears || 6;
        var sqrtT = Math.sqrt(T);
        
        // Barrier distance in sigma terms
        var distanceWorst = (1 - bar) / (worstVol * sqrtT);
        var distanceBasket = (1 - bar) / (basketVol * sqrtT);
        
        // The improvement in sigma distance translates to P1 boost
        // At 0.27σ (ENR worst-of): very risky → P1 ~20-30
        // At 0.43σ (basket avg): moderate → P1 ~45-55
        // Scale: each 0.1σ improvement ≈ +12pts P1
        var sigmaDelta = distanceBasket - distanceWorst;
        var boost = Math.round(sigmaDelta * 120);
        
        // Also boost for diversification benefit (worst-of penalty removal)
        var nStocks = avgMetrics.nStocks || 4;
        var worstOfPenalty = Math.round(3 * Math.pow(nStocks - 2, 1.3));
        boost += worstOfPenalty;
        
        // Cap the boost so P1 doesn't go absurdly high
        boost = Math.max(0, Math.min(35, boost));
        
        // Don't boost if P1 is already high (>60)
        if (p1Score > 60) boost = Math.min(boost, 10);
        
        console.log('[BasketV2.3] P1 boost calc: worstVol=' + (worstVol*100).toFixed(1) + 
            '% basketVol=' + (basketVol*100).toFixed(1) + '% barrier=' + (bar*100) + 
            '% sigmaDelta=' + sigmaDelta.toFixed(3) + ' worstOfPenalty=' + worstOfPenalty + 
            ' → boost=' + boost);
        
        return boost;
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
                    console.log('[BasketV2.3] NORMALIZE: ' + (product.name || '?') + 
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
                        console.log('[BasketV2.3] Coupon prob: ' + (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + '%');
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
                        console.log('[BasketV2.3] Loss prob: ' + (prob * 100).toFixed(1) + '% \u2192 ' + (adjustedProb * 100).toFixed(1) + '%');
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
    // PATCH: P2 — Use average metrics for basket
    // ========================================
    function _patchBasketP2() {
        if (typeof _computeP2 !== 'function') return false;
        
        var _currentP2 = _computeP2;
        if (_currentP2._basketV2Patched) return true;

        window._computeP2 = function(p, market, productType) {
            if (p._isBasket && market && market.stocks) {
                var avgMetrics = _computeBasketAverageMetrics(null, market);
                if (avgMetrics) {
                    try {
                        var basketMarket = JSON.parse(JSON.stringify(market));
                        if (basketMarket.worstMetrics) {
                            basketMarket.worstMetrics.volatility_3y = avgMetrics.vol;
                            basketMarket.worstMetrics.drawdown_3y = avgMetrics.dd;
                            basketMarket.worstMetrics.beta = avgMetrics.beta;
                            console.log('[BasketV2.3] P2: basket avg vol=' + avgMetrics.vol + 
                                '% DD=' + avgMetrics.dd + '%');
                        }
                        return _currentP2(p, basketMarket, productType);
                    } catch(e) {
                        console.warn('[BasketV2.3] P2 override failed, using original:', e.message);
                    }
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
    // PATCH: grade() — THE MAIN FIX: P1 recalc + P2 safety net + reasoning
    // Instead of wrapping _computeP1 (which crashes), we recalculate P1
    // AFTER grade() completes, using the vol-based boost formula.
    // ========================================
    function _patchBasketGrading() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;
        var _currentGrade = ProposalGrader.grade;
        if (_currentGrade._basketV2Patched) return true;

        ProposalGrader.grade = async function(product) {
            var result = await _currentGrade.call(this, product);
            var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : null;
            var isBasket = (norm && norm._isBasket) || product.structureType === 'basket';

            if (!isBasket || !result || !result.pillars) return result;

            var changed = false;
            var p1 = result.pillars.couponAndCapital;
            var p2 = result.pillars.underlyingQuality;

            // ── P1 RECALCULATION (the critical fix) ──
            // Get market data to compute basket avg metrics
            var market = null;
            if (typeof _getMarketData === 'function') {
                try { market = _getMarketData(product); } catch(e) {}
            }
            if (!market && result._marketData) {
                market = result._marketData;
            }
            // Also try to get market from the grading context
            if (!market && typeof window._lastGradingMarket !== 'undefined') {
                market = window._lastGradingMarket;
            }

            if (p1 && market && market.stocks) {
                var avgMetrics = _computeBasketAverageMetrics(null, market);
                if (avgMetrics && avgMetrics.worstVol > avgMetrics.vol) {
                    var barrier = 60;
                    if (norm && norm.barrier) barrier = norm.barrier;
                    else if (product.capitalProtection && product.capitalProtection.barrier) {
                        barrier = parseFloat(product.capitalProtection.barrier) || 60;
                    }
                    var matY = 6;
                    if (norm && norm.maturityYears) matY = norm.maturityYears;
                    else if (product.maturityYears) matY = product.maturityYears;

                    var boost = _computeP1BasketBoost(p1.score, avgMetrics, barrier, matY);
                    if (boost > 0) {
                        var oldP1 = p1.score;
                        p1.score = Math.min(80, p1.score + boost);
                        p1.reasoning = (p1.reasoning || '')
                            .replace(/worst-of/gi, 'basket \u00e9quipond\u00e9r\u00e9')
                            .replace(/Worst[^|]*/g, '')
                            .replace(/\|\s*\|/g, '|');
                        p1.reasoning += ' | Basket +' + boost + 'pts (vol ' + 
                            avgMetrics.worstVol.toFixed(0) + '%\u2192' + avgMetrics.vol.toFixed(0) + '%)';
                        changed = true;
                        console.log('[BasketV2.3] P1: ' + oldP1 + ' \u2192 ' + p1.score + 
                            ' (+' + boost + ') via vol reduction');
                    }
                }
            } else if (p1) {
                // Fallback: no market data, apply fixed boost for basket structure
                var fallbackBoost = 15;
                if (p1.score < 50) {
                    var oldP1 = p1.score;
                    p1.score = Math.min(70, p1.score + fallbackBoost);
                    p1.reasoning = (p1.reasoning || '') + ' | Basket \u00e9quipond\u00e9r\u00e9 +' + fallbackBoost + 'pts (fallback)';
                    changed = true;
                    console.log('[BasketV2.3] P1 fallback: ' + oldP1 + ' \u2192 ' + p1.score);
                }
            }

            // ── P2 SAFETY NET ──
            if (p2 && p2.score < 40) {
                var p2boost = Math.min(25, Math.round((55 - p2.score) * 0.5));
                p2.score = Math.min(75, p2.score + p2boost);
                p2.reasoning = (p2.reasoning || '') + 
                    ' | Basket safety net +' + p2boost + 'pts';
                changed = true;
                console.log('[BasketV2.3] P2 safety net +' + p2boost);
            }

            // ── RECALCULATE TOTAL ──
            if (changed) {
                var weights = { couponAndCapital: 0.30, underlyingQuality: 0.25, 
                                portfolioFit: 0.20, primeVsCat: 0.25 };
                var newScore = 0;
                for (var key in weights) {
                    if (result.pillars[key]) newScore += result.pillars[key].score * weights[key];
                }
                newScore = Math.round(newScore);
                if (newScore !== result.score) {
                    console.log('[BasketV2.3] Total: ' + result.score + ' \u2192 ' + newScore);
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
    // INIT — NO _patchBasketP1 (removed, was crashing)
    // ========================================
    var _basketV2Interval = setInterval(function() {
        var ok1 = _patchBasketDetection();
        var ok2 = _patchBasketGrading();
        var ok3 = _patchAutoDetect();
        var ok4 = _patchBasketP2();

        if (ok1 && ok2 && ok4) {
            clearInterval(_basketV2Interval);
            console.log('[StructBoard] Basket V2.3 active \u2014 P1 recalc in grade() + P2 avg + probs');
        }
    }, 300);

    setTimeout(function() { clearInterval(_basketV2Interval); }, 15000);

})();

console.log('[StructBoard] Basket Detection V2.3 loaded');

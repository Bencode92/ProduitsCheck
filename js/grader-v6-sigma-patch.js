// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader v6.0 Sigma Patch
// #10: Distance barrière en sigmas (σ)
// #11: Scoring liquidité L1-L4
// #12: P2 indices refonte (vol-based + distance σ, moins de momentum)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ #10: DISTANCE BARRIÈRE EN SIGMAS ═══
    // Calcule la distance entre le spot actuel et la barrière en unités de vol
    // distance_σ = -ln(barrier_level) / (vol × √T)
    // Pour produits en PF: utilise strikePrice si dispo, sinon spot ≈ strike
    // Pour propositions: strike = spot actuel (pas encore souscrits)
    window._computeBarrierSigma = function(product, marketData) {
        if (!product) return null;
        var p = product;
        var barrier = p.barrier || 0;
        if (barrier <= 0 || barrier >= 100) return null; // Pas de barrière ou capital protégé
        if (p.capitalProtection) return null;

        var mat = p.maturityYears || p._maturityInfo && p._maturityInfo.expected || 5;
        var vol = null;
        var spotVsStrike = 1.0; // Default: spot = strike (100%)

        // Get vol and spot from market data
        if (marketData && marketData.stocks) {
            marketData.stocks.forEach(function(s) {
                if (!s.found) return;
                // Vol from stock data or proxy
                var sVol = s.volatility_3y || (s._proxy && s._proxy.default_vol) || null;
                if (sVol && (vol === null || sVol > vol)) vol = sVol; // Take worst vol for worst-of

                // Spot price available for actions (stocks_europe/us.json)
                if (s.price && s.price > 0 && !s._proxyType) {
                    // For stocks: if we have strikePrice, compute spot/strike ratio
                    if (p.strikePrice && p.strikePrice > 0) {
                        spotVsStrike = s.price / p.strikePrice;
                    }
                    // Else: spot ≈ strike (approximation for new proposals)
                }

                // For proxy ETFs: use last_close and perf since subscription
                if (s._proxyType && s._proxy && s._proxy._realMetrics) {
                    var rm = s._proxy._realMetrics;
                    // Use perf_ytd as rough proxy for spot movement
                    // This is imprecise but better than nothing
                    if (rm.perf_ytd != null && p.subscriptionDate) {
                        var subDate = new Date(p.subscriptionDate);
                        var now = new Date();
                        var monthsSinceSub = (now - subDate) / (1000 * 60 * 60 * 24 * 30);
                        if (monthsSinceSub < 12 && monthsSinceSub > 0) {
                            // Rough: if subscribed this year, use YTD as proxy
                            spotVsStrike = 1 + (rm.perf_ytd || 0) / 100;
                        }
                    }
                }
            });
        }

        if (!vol || vol <= 0) return null;

        // Effective barrier level = barrier% / spotVsStrike
        // If spot = 100% of strike, effective = barrier%
        // If spot = 90% of strike (down 10%), effective barrier is closer
        var effectiveBarrier = (barrier / 100) / spotVsStrike;
        if (effectiveBarrier >= 1.0) {
            // Spot is BELOW barrier = already breached
            return { sigma: 0, label: 'BARRI\u00c8RE TOUCH\u00c9E', danger: true, vol: vol, mat: mat, effective_barrier: effectiveBarrier, spotVsStrike: spotVsStrike };
        }

        // Distance in sigmas
        // d = -ln(effectiveBarrier) / (vol/100 × √T)
        var sqrtT = Math.sqrt(Math.max(0.25, mat)); // Min 3 months
        var sigma = -Math.log(effectiveBarrier) / (vol / 100 * sqrtT);

        var label;
        if (sigma > 2.5) label = 'Tr\u00e8s safe';
        else if (sigma > 2.0) label = 'Confortable';
        else if (sigma > 1.5) label = 'Ad\u00e9quat';
        else if (sigma > 1.0) label = 'Attention';
        else if (sigma > 0.5) label = 'Danger';
        else label = 'Critique';

        return {
            sigma: Math.round(sigma * 100) / 100,
            label: label,
            danger: sigma < 1.0,
            vol: vol,
            mat: mat,
            effective_barrier: Math.round(effectiveBarrier * 10000) / 100,
            spotVsStrike: Math.round(spotVsStrike * 10000) / 100,
        };
    };

    // ═══ #11: SCORING LIQUIDITÉ L1-L4 ═══
    window._computeLiquidityScore = function(product) {
        if (!product) return { level: 'L4', score: 10, label: 'Bloqu\u00e9' };

        // L1: Cash / money market
        if (product.grading && product.grading.grade === '-') {
            return { level: 'L1', score: 100, label: 'Cash' };
        }
        if (typeof _isLiquidityProduct === 'function') {
            var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
            if (_isLiquidityProduct(norm)) {
                return { level: 'L1', score: 100, label: 'Cash' };
            }
        }

        // Compute residual maturity
        var matDate = product.maturityDate ? new Date(product.maturityDate) : null;
        var now = new Date();
        var residualMonths = matDate ? Math.max(0, (matDate - now) / (1000 * 60 * 60 * 24 * 30)) : 999;

        // L4: Blocked (no redemption possible < 12M, long maturity)
        var er = product.earlyRedemption || {};
        var hasAutocall = er.possible || product.autocall;
        var autocallFreq = (er.frequency || '').toLowerCase();

        // Fixed rate without early redemption
        if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(product)) {
            if (!hasAutocall && residualMonths > 12) {
                return { level: 'L4', score: 10, label: 'Bloqu\u00e9 (taux fixe, ' + Math.round(residualMonths) + 'M restants)' };
            }
            if (hasAutocall && residualMonths <= 12) {
                return { level: 'L2', score: 75, label: 'Callable <12M' };
            }
            if (residualMonths <= 6) {
                return { level: 'L2', score: 80, label: 'Maturit\u00e9 <6M' };
            }
            return { level: 'L3', score: 40, label: 'Callable long terme' };
        }

        // Autocall products
        if (hasAutocall) {
            // Estimate next autocall date
            var startYear = er.startYear || 1;
            var subDate = product.subscriptionDate ? new Date(product.subscriptionDate) : now;
            var firstCallDate = new Date(subDate);
            firstCallDate.setFullYear(firstCallDate.getFullYear() + startYear);

            // Months until next possible call
            var monthsToCall = Math.max(0, (firstCallDate - now) / (1000 * 60 * 60 * 24 * 30));

            // If autocall is semestriel/trimestriel and we're past first call date
            if (firstCallDate <= now) {
                // Past first call date — next call depends on frequency
                if (autocallFreq.indexOf('trimestr') >= 0) monthsToCall = 3;
                else if (autocallFreq.indexOf('semestr') >= 0) monthsToCall = 6;
                else if (autocallFreq.indexOf('annuel') >= 0) monthsToCall = 12;
                else monthsToCall = 6; // Default semestriel
            }

            if (monthsToCall <= 6) {
                // L2: Quasi-liquid — call possible soon
                return { level: 'L2', score: 75, label: 'Rappelable dans ' + Math.round(monthsToCall) + 'M' };
            } else if (monthsToCall <= 18) {
                // L3: Illiquid but with exit horizon
                return { level: 'L3', score: 40, label: 'Rappelable dans ' + Math.round(monthsToCall) + 'M' };
            } else {
                // L4: Blocked — no call for >18 months
                return { level: 'L4', score: 15, label: 'Pas de rappel avant ' + Math.round(monthsToCall) + 'M' };
            }
        }

        // Participation / ETF / other with secondary market
        if ((product.type || '').toLowerCase().indexOf('etf') >= 0 || (product.type || '').toLowerCase().indexOf('participation') >= 0) {
            return { level: 'L2', score: 70, label: 'March\u00e9 secondaire (ETF)' };
        }

        // Default: illiquid
        if (residualMonths <= 12) return { level: 'L3', score: 40, label: 'Maturit\u00e9 <12M' };
        return { level: 'L4', score: 10, label: 'Illiquide (' + Math.round(residualMonths) + 'M restants)' };
    };

    // ═══ PORTFOLIO LIQUIDITY RATIO ═══
    window._computePortfolioLiquidityRatio = function(portfolio) {
        if (!portfolio || portfolio.length === 0) return { ratio: 0, details: [] };
        var totalNotional = 0;
        var weightedLiq = 0;
        var details = [];

        portfolio.forEach(function(p) {
            var amount = parseFloat(p.investedAmount) || 0;
            if (amount <= 0) return;
            var liq = _computeLiquidityScore(p);
            totalNotional += amount;
            weightedLiq += amount * liq.score;
            details.push({ name: (p.name || '?').substring(0, 30), amount: amount, level: liq.level, score: liq.score, label: liq.label });
        });

        return {
            ratio: totalNotional > 0 ? Math.round(weightedLiq / totalNotional) : 0,
            totalNotional: totalNotional,
            details: details,
            // Targets
            target: 40,
            healthy: totalNotional > 0 ? (weightedLiq / totalNotional >= 40) : true,
        };
    };

    // Wait for grader
    var _v6Interval = setInterval(function() {
        if (typeof _computeP2 !== 'function' || typeof _computeP2Index !== 'function' || typeof gradeProposal !== 'function') return;
        clearInterval(_v6Interval);

        // ═══ #12: P2 INDICES REFONTE ═══
        // Replace pure momentum with: 50% vol/DD-based + 30% momentum modulé + 20% distance σ
        var _origComputeP2IndexV6 = _computeP2Index;
        _computeP2Index = function(proxyInfo, hasBarrier, product) {
            var rm = proxyInfo._realMetrics || {};
            var vol = proxyInfo.default_vol || rm.vol || 18;
            var dd = proxyInfo.default_dd || rm.dd || (vol * 1.5);
            var beta = proxyInfo.default_beta || rm.beta || 1.0;

            // === COMPONENT 1: Vol/DD score (50%) ===
            var volScore = Math.max(0, Math.min(100, Math.round(100 - vol * 2.0)));
            // vol 15%→70 | 18%→64 | 25%→50 | 35%→30 | 45%→10
            var ddScore = Math.max(0, Math.min(100, Math.round(100 - dd * 1.8)));
            // dd 10%→82 | 16%→71 | 25%→55 | 35%→37 | 45%→19
            var qualityComp = Math.round(volScore * 0.55 + ddScore * 0.45);

            // === COMPONENT 2: Momentum modulé par vol (30%) ===
            var ytd = rm.perf_ytd != null ? rm.perf_ytd : 0;
            var m3 = rm.perf_3m != null ? rm.perf_3m : 0;
            var w52 = rm.perf_1y != null ? rm.perf_1y : 0;

            // Conviction factor: momentum is less reliable when vol is high
            var conviction = 1.0 / (1 + vol / 25);
            // vol 15%→0.63 | 25%→0.50 | 35%→0.42 | 45%→0.36

            var momentumRaw = 50; // Base neutre
            if (ytd > 10) momentumRaw += 15;
            else if (ytd > 0) momentumRaw += 8;
            else if (ytd > -10) momentumRaw -= 5;
            else momentumRaw -= 15;

            if (m3 > 5) momentumRaw += 8;
            else if (m3 < -10) momentumRaw -= 10;
            else if (m3 < -5) momentumRaw -= 5;

            if (w52 > 20) momentumRaw += 5;
            else if (w52 < -10) momentumRaw -= 10;

            // Apply conviction: reduce momentum impact when vol is high
            var momentumComp = Math.round(50 + (momentumRaw - 50) * conviction);
            momentumComp = Math.max(10, Math.min(90, momentumComp));

            // === COMPONENT 3: Distance σ (20%) ===
            var sigmaComp = 50; // Default if can't compute
            if (hasBarrier && product && product.barrier > 0) {
                // Approximate distance sigma
                var barrier = product.barrier / 100;
                var sqrtT = Math.sqrt(Math.max(0.5, product.maturityYears || 5));
                var distSigma = -Math.log(barrier) / (vol / 100 * sqrtT);
                // Map sigma to score
                if (distSigma > 2.5) sigmaComp = 90;
                else if (distSigma > 2.0) sigmaComp = 75;
                else if (distSigma > 1.5) sigmaComp = 60;
                else if (distSigma > 1.0) sigmaComp = 40;
                else if (distSigma > 0.5) sigmaComp = 20;
                else sigmaComp = 5;
                console.log('[v6-Sigma] P2 Index ' + proxyInfo.proxy + ': distance barri\u00e8re ' + barrier * 100 + '% = ' + distSigma.toFixed(2) + '\u03c3 (vol=' + vol + '%, T=' + (product.maturityYears || 5) + 'a) \u2192 sigmaComp=' + sigmaComp);
            }
            if (!hasBarrier) sigmaComp = 70; // No barrier = safer

            // === COMPOSITE ===
            var s = Math.round(qualityComp * 0.50 + momentumComp * 0.30 + sigmaComp * 0.20);

            // Beta penalty (from v5)
            if (hasBarrier && beta > 1.1) {
                s -= Math.round((beta - 1.0) * 8);
            }

            console.log('[v6-Sigma] P2 Index ' + (proxyInfo.proxy || '?') + ': quality=' + qualityComp + ' (' + vol + '% vol, ' + dd.toFixed(0) + '% dd) momentum=' + momentumComp + ' (conv=' + conviction.toFixed(2) + ') sigma=' + sigmaComp + ' \u2192 P2=' + s);
            return Math.max(0, Math.min(100, s));
        };
        console.log('[v6] P2 indices refonte: 50% vol/DD + 30% momentum*conviction + 20% distance \u03c3');

        // ═══ #10: INJECT SIGMA INTO GRADING METADATA ═══
        var _origGradeProposalV6 = gradeProposal;
        gradeProposal = async function(product) {
            var result = await _origGradeProposalV6(product);
            if (!result || result.grade === '-' || result.grade === '?') return result;

            // Compute barrier sigma
            var ctx = product._lastCtx; // Set by _collectContext if available
            if (!ctx && product._graderMarket) ctx = { market: product._graderMarket };
            var sigma = _computeBarrierSigma(product, ctx ? ctx.market : null);
            if (sigma) {
                result.metadata = result.metadata || {};
                result.metadata.barrier_sigma = sigma.sigma;
                result.metadata.barrier_sigma_label = sigma.label;
                result.metadata.barrier_sigma_danger = sigma.danger;
                result.metadata.barrier_vol = sigma.vol;
                result.metadata.spotVsStrike = sigma.spotVsStrike;
                // Add to keyRisks if dangerous
                if (sigma.danger && result.keyRisks) {
                    result.keyRisks.push('Barri\u00e8re \u00e0 ' + sigma.sigma + '\u03c3 (' + sigma.label + ') \u2014 vol ' + sigma.vol + '%, mat ' + sigma.mat + 'a');
                }
            }

            // Compute liquidity score
            var liq = _computeLiquidityScore(product);
            result.metadata = result.metadata || {};
            result.metadata.liquidity_level = liq.level;
            result.metadata.liquidity_score = liq.score;
            result.metadata.liquidity_label = liq.label;

            product.grading = result;
            return result;
        };
        console.log('[v6] Barrier sigma + liquidity score injected into grading metadata');

        // ═══ PATCH _computeP2Index CALL SIGNATURE ═══
        // The p2-patch calls _computeP2Index(proxyInfo, hasBarrier) without product
        // We need to pass product through for sigma calculation
        // Override _computeP2 to forward the product
        var _origComputeP2V6 = _computeP2;
        _computeP2 = function(p, market, productType) {
            // Store product reference for _computeP2Index to access
            window._currentP2Product = p;
            var result = _origComputeP2V6(p, market, productType);
            window._currentP2Product = null;
            return result;
        };

        // Wrap _computeP2Index to pick up the product
        var _wrappedP2Index = _computeP2Index;
        _computeP2Index = function(proxyInfo, hasBarrier, product) {
            // If product not passed directly, try the global
            if (!product) product = window._currentP2Product;
            return _wrappedP2Index(proxyInfo, hasBarrier, product);
        };

        console.log('[StructBoard] Grader v6.0 Sigma Patch \u2014 distance \u03c3 + liquidity L1-L4 + P2 refonte');
    }, 450);
    setTimeout(function() { clearInterval(_v6Interval); }, 15000);
})();

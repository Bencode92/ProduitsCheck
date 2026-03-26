// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer Market Data Patch v1.0
// Loads & integrates 3 market data sources into the optimizer:
//   1. underlyings_extra.json → real vol/DD → better P(coupon)
//   2. rates.json → ECB rates → callable/fixe comparison to risk-free
//   3. sectors.json → real momentum → refined sector penalty
// Overrides _estimateCouponProbability and _miSectorPenalty from v2.3
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var _dataCache = { underlyings: null, rates: null, sectors: null, ujMap: null, loaded: false };

    // ═══ LOAD ALL MARKET DATA (once) ═══
    window._loadOptimizerMarketData = async function() {
        if (_dataCache.loaded) return _dataCache;
        try {
            var results = await Promise.allSettled([
                github.readFile('data/market/underlyings_extra.json'),
                github.readFile('data/market/rates.json'),
                github.readFile('data/market/sectors.json'),
                github.readFile('data/underlying-map.json')
            ]);
            if (results[0].status === 'fulfilled') _dataCache.underlyings = results[0].value;
            if (results[1].status === 'fulfilled') _dataCache.rates = results[1].value;
            if (results[2].status === 'fulfilled') _dataCache.sectors = results[2].value;
            if (results[3].status === 'fulfilled') _dataCache.ujMap = results[3].value;
            _dataCache.loaded = true;
            console.log('[MarketData] Loaded: UJ=' + !!_dataCache.underlyings + ' Rates=' + !!_dataCache.rates + ' Sectors=' + !!_dataCache.sectors + ' Map=' + !!_dataCache.ujMap);
        } catch(e) {
            console.warn('[MarketData] Load error:', e.message);
        }
        return _dataCache;
    };

    // ═══ HELPER: Find proxy ETF ticker for a product underlying ═══
    function _findProxyTicker(underlyingName) {
        if (!_dataCache.ujMap) return null;
        var name = (underlyingName || '').toLowerCase().trim();
        // Check indices
        if (_dataCache.ujMap.indices) {
            for (var key in _dataCache.ujMap.indices) {
                if (name.indexOf(key) >= 0 || key.indexOf(name) >= 0) {
                    return _dataCache.ujMap.indices[key].proxy;
                }
            }
        }
        // Check commodities
        if (_dataCache.ujMap.commodities) {
            for (var ckey in _dataCache.ujMap.commodities) {
                if (name.indexOf(ckey) >= 0) {
                    var cm = _dataCache.ujMap.commodities[ckey];
                    // Map commodity to proxy ETF ticker from underlyings_extra
                    if (cm.macro_key === 'gold_usd') return 'GLD';
                    if (cm.macro_key === 'silver_usd') return 'SLV';
                    if (cm.macro_key === 'brent_usd') return 'BNO';
                }
            }
        }
        return null;
    }

    // ═══ HELPER: Get real vol/DD for a product ═══
    function _getRealMetrics(product) {
        if (!_dataCache.underlyings || !_dataCache.underlyings.tickers) return null;
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var ujs = norm.underlyings || [];
        if (ujs.length === 0) return null;

        // For each underlying, find proxy and get real metrics
        var metrics = [];
        ujs.forEach(function(uj) {
            var ticker = _findProxyTicker(uj);
            if (ticker && _dataCache.underlyings.tickers[ticker]) {
                var t = _dataCache.underlyings.tickers[ticker];
                metrics.push({
                    ticker: ticker, underlying: uj,
                    vol: t.vol_3y, maxDD: t.max_dd_3y, beta: t.beta,
                    perf3m: t.perf_3m, perfYtd: t.perf_ytd
                });
            }
        });

        if (metrics.length === 0) return null;

        // For worst-of: use highest vol and worst DD (most conservative)
        var worstVol = Math.max.apply(null, metrics.map(function(m) { return m.vol || 20; }));
        var worstDD = Math.max.apply(null, metrics.map(function(m) { return m.maxDD || 20; }));
        var avgBeta = metrics.reduce(function(s, m) { return s + (m.beta || 1); }, 0) / metrics.length;
        var worstPerf3m = Math.min.apply(null, metrics.map(function(m) { return m.perf3m || 0; }));

        return {
            metrics: metrics,
            worstVol: worstVol,
            worstDD: worstDD,
            avgBeta: avgBeta,
            worstPerf3m: worstPerf3m,
            nResolved: metrics.length,
            nTotal: ujs.length
        };
    }

    // ═══ HELPER: Get risk-free rate for maturity ═══
    function _getRiskFreeRate(maturityYears) {
        if (!_dataCache.rates) return 2.5; // fallback
        var y = _dataCache.rates.yields || {};
        var ecbDeposit = (_dataCache.rates.policy_rates && _dataCache.rates.policy_rates.ecb_deposit_rate)
            ? _dataCache.rates.policy_rates.ecb_deposit_rate.current : 2.0;

        // Interpolate yield curve
        var y2 = y.oat_fr_2y ? y.oat_fr_2y.current : ecbDeposit;
        var y5 = y.oat_fr_5y ? y.oat_fr_5y.current : ecbDeposit + 0.5;
        var y10 = y.bund_de_10y ? y.bund_de_10y.current : ecbDeposit + 1.0;

        if (!maturityYears || maturityYears <= 2) return y2;
        if (maturityYears <= 5) return y2 + (y5 - y2) * (maturityYears - 2) / 3;
        if (maturityYears <= 10) return y5 + (y10 - y5) * (maturityYears - 5) / 5;
        return y10;
    }

    // ═══ HELPER: Get sector momentum from real data ═══
    function _getSectorMomentum(sectorName) {
        if (!_dataCache.sectors || !_dataCache.sectors.sectors) return null;
        var sectors = _dataCache.sectors.sectors;
        var name = (sectorName || '').toLowerCase().replace(/\s+/g, '-');

        // Direct match
        if (sectors[name]) {
            var etfs = sectors[name];
            // Average m3 and ytd across all ETFs in sector
            var m3s = etfs.filter(function(e) { return e.m3_num != null; }).map(function(e) { return e.m3_num; });
            var ytds = etfs.filter(function(e) { return e.ytd_num != null; }).map(function(e) { return e.ytd_num; });
            var betas = etfs.filter(function(e) { return e.beta != null; }).map(function(e) { return e.beta; });
            return {
                sector: name,
                m3_avg: m3s.length > 0 ? m3s.reduce(function(a,b){return a+b;},0) / m3s.length : null,
                ytd_avg: ytds.length > 0 ? ytds.reduce(function(a,b){return a+b;},0) / ytds.length : null,
                beta_avg: betas.length > 0 ? betas.reduce(function(a,b){return a+b;},0) / betas.length : null,
                nEtfs: etfs.length
            };
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════
    // OVERRIDE 1: _estimateCouponProbability — use REAL vol/DD
    // ═══════════════════════════════════════════════════════════
    var _waitOverride = setInterval(function() {
        if (typeof _estimateCouponProbability !== 'function') return;
        clearInterval(_waitOverride);

        var _origProb = _estimateCouponProbability;
        window._estimateCouponProbability = function(product) {
            // Get base probability from original function
            var baseProb = _origProb(product);

            // Try to enhance with real data
            var real = _getRealMetrics(product);
            if (!real) return baseProb;

            var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
            var couponType = (norm.couponType || '').toLowerCase();

            // Fixed/guaranteed → real data doesn't change much
            if (couponType === 'garanti' || couponType === 'fixe') return baseProb;
            if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(norm)) return baseProb;

            // Use real vol to compute better barrier sigma
            var barrier = norm.barrier || 60;
            var maturity = norm.maturity || 3;
            var distancePct = (100 - barrier) / 100; // e.g., barrier 60 → 40% distance
            var realVol = real.worstVol / 100; // e.g., 20% → 0.20

            // Sigma = distance / (vol × √maturity)
            var sigma = distancePct / (realVol * Math.sqrt(maturity));

            // P(never hit barrier) ≈ based on sigma
            var realProb = Math.max(0.15, Math.min(0.98, 0.5 + 0.5 * (1 - Math.exp(-sigma * 0.8))));

            // Memory bonus
            if (norm.hasMemory) realProb = Math.min(0.95, realProb + 0.08);

            // Worst-of penalty using real correlation data
            var nUnd = (norm.underlyings || []).length;
            if (nUnd > 1) {
                // More underlyings = more risk for worst-of
                // Use real DD as a proxy for tail risk
                var ddPenalty = Math.min(0.15, real.worstDD / 100 * 0.3); // DD 30% → penalty 9%
                realProb *= Math.max(0.5, 1.0 - ddPenalty);
            }

            // Recent momentum: if 3M perf is strongly negative, increase risk
            if (real.worstPerf3m < -10) {
                realProb *= 0.92; // Strong recent drawdown → 8% more risk
            } else if (real.worstPerf3m < -5) {
                realProb *= 0.96; // Moderate drawdown → 4% more risk
            }

            // Issuer default (keep from original)
            var bankId = (product.bankId || product.bankName || '').toLowerCase();
            var defaultProb = 0.05;
            if (typeof ISSUER_RATINGS !== 'undefined') {
                for (var key in ISSUER_RATINGS) {
                    if (bankId.indexOf(key) >= 0) {
                        defaultProb = Math.min(0.15, Math.max(0.01, (ISSUER_RATINGS[key].cds_proxy || 80) / 10000 / 0.6));
                        break;
                    }
                }
            }
            realProb *= (1 - defaultProb);
            realProb = Math.round(realProb * 100) / 100;

            // Log significant differences
            if (Math.abs(realProb - baseProb) > 0.05) {
                console.log('[MarketData] P(coupon) adjusted: ' + (product.name || '').substring(0, 25) +
                    ' base=' + baseProb + ' real=' + realProb +
                    ' (vol=' + real.worstVol + '% DD=' + real.worstDD + '% perf3m=' + real.worstPerf3m + '%)');
            }

            return realProb;
        };
        console.log('[MarketData] _estimateCouponProbability enhanced with real vol/DD');
    }, 350);
    setTimeout(function() { clearInterval(_waitOverride); }, 12000);

    // ═══════════════════════════════════════════════════════════
    // OVERRIDE 2: _miSectorPenalty — use REAL sector momentum
    // ═══════════════════════════════════════════════════════════
    var _waitSector = setInterval(function() {
        if (typeof _miSectorPenalty !== 'function') return;
        clearInterval(_waitSector);

        var _origSector = _miSectorPenalty;
        window._miSectorPenalty = function(product, mi) {
            // Get base penalty from MI (avoided/favored binary)
            var base = _origSector(product, mi);

            // Try to refine with real sector momentum
            var sector = '';
            var text = ((product.name || '') + ' ' + ((product.underlyings || []).join ? (product.underlyings || []).join(' ') : '')).toLowerCase();
            if (text.indexOf('bank') >= 0 || text.indexOf('financ') >= 0) sector = 'financials';
            else if (text.indexOf('energy') >= 0 || text.indexOf('oil') >= 0) sector = 'energy';
            else if (text.indexOf('tech') >= 0 || text.indexOf('nasdaq') >= 0) sector = 'information-technology';
            else if (text.indexOf('gold') >= 0 || text.indexOf('miner') >= 0) sector = 'materials';
            else if (text.indexOf('consumer') >= 0 || text.indexOf('lvmh') >= 0 || text.indexOf('luxury') >= 0) sector = 'consumer-discretionary';
            else if (text.indexOf('health') >= 0 || text.indexOf('pharma') >= 0) sector = 'healthcare';
            else if (text.indexOf('industr') >= 0) sector = 'industrials';
            else if (text.indexOf('utilit') >= 0) sector = 'utilities';

            if (!sector) return base;

            var momentum = _getSectorMomentum(sector);
            if (!momentum || momentum.m3_avg == null) return base;

            // Proportional penalty based on REAL 3M momentum
            // m3_avg: -15% → ×0.60, -5% → ×0.80, 0% → ×1.00, +10% → ×1.10, +30% → ×1.15
            var m3 = momentum.m3_avg;
            var multiplier;
            if (m3 < -10) multiplier = 0.60;       // Severe downturn
            else if (m3 < -5) multiplier = 0.75;    // Moderate downturn
            else if (m3 < -2) multiplier = 0.85;    // Slight downturn
            else if (m3 < 2) multiplier = 1.00;     // Flat
            else if (m3 < 10) multiplier = 1.05;    // Moderate upturn
            else if (m3 < 25) multiplier = 1.10;    // Strong upturn
            else multiplier = 1.15;                  // Very strong (cap bonus)

            var reason = sector + ' M3=' + m3.toFixed(1) + '% \u2192 \u00d7' + multiplier.toFixed(2);

            // Combine: use the MORE conservative of MI binary and real momentum
            if (base.multiplier < 1.0 && multiplier < 1.0) {
                // Both penalize: use the worse one
                var finalMult = Math.min(base.multiplier, multiplier);
                return { multiplier: finalMult, reason: '\u26a0 ' + reason + ' (MI: ' + base.reason + ')' };
            }
            if (base.multiplier < 1.0) {
                // MI says avoid, but momentum might not be terrible
                // Trust MI but adjust with momentum
                var adjusted = base.multiplier * 0.5 + multiplier * 0.5;
                return { multiplier: Math.min(adjusted, 0.95), reason: '\u26a0 ' + reason };
            }
            if (multiplier < 1.0) {
                // Momentum says avoid even if MI doesn't
                return { multiplier: multiplier, reason: '\u26a0 ' + reason };
            }
            // Both positive
            return { multiplier: Math.min(multiplier, 1.15), reason: base.reason || ('\u2705 ' + reason) };
        };
        console.log('[MarketData] _miSectorPenalty enhanced with real momentum');
    }, 400);
    setTimeout(function() { clearInterval(_waitSector); }, 12000);

    // ═══════════════════════════════════════════════════════════
    // OVERRIDE 3: AI Summary — add rates context + market data
    // ═══════════════════════════════════════════════════════════
    var _waitAI = setInterval(function() {
        if (typeof getStructOptimizerAISummary !== 'function') return;
        clearInterval(_waitAI);

        var _origAI = getStructOptimizerAISummary;
        getStructOptimizerAISummary = async function(analysis) {
            // Ensure data is loaded
            await _loadOptimizerMarketData();

            var result = await _origAI(analysis);

            // Add rates context
            if (_dataCache.rates) {
                var ecb = _dataCache.rates.policy_rates;
                var yields = _dataCache.rates.yields;
                var curve = _dataCache.rates.yield_curve;
                result += '\n\n**\ud83c\udfdb Taux & Courbe:**\n';
                if (ecb && ecb.ecb_deposit_rate) result += '- BCE d\u00e9p\u00f4t: ' + ecb.ecb_deposit_rate.current + '%\n';
                if (yields && yields.oat_fr_2y) result += '- EUR 2Y: ' + yields.oat_fr_2y.current + '% (' + yields.oat_fr_2y.direction + ')\n';
                if (yields && yields.bund_de_10y) result += '- Bund 10Y: ' + yields.bund_de_10y.current + '% (' + yields.bund_de_10y.direction + ')\n';
                if (curve) result += '- Spread 2-10: ' + (curve.spread_2_10 * 100).toFixed(0) + 'bps (' + curve.shape + ')\n';
            }

            // Add real underlying metrics for allocated products
            if (_dataCache.underlyings && analysis.allocationPlan) {
                var enrichedProducts = [];
                analysis.allocationPlan.filter(function(p) { return p.allocatedAmount > 0; }).forEach(function(p) {
                    var real = _getRealMetrics(p);
                    if (real && real.metrics.length > 0) {
                        var names = real.metrics.map(function(m) { return m.ticker + '(vol=' + m.vol + '% DD=' + m.maxDD + '%)'; }).join(', ');
                        enrichedProducts.push((p.name || '').substring(0, 20) + ': ' + names);
                    }
                });
                if (enrichedProducts.length > 0) {
                    result += '\n**\ud83d\udcc9 Donn\u00e9es march\u00e9 r\u00e9elles:**\n';
                    enrichedProducts.forEach(function(e) { result += '- ' + e + '\n'; });
                }
            }

            return result;
        };
        console.log('[MarketData] AI summary enhanced with rates + real data');
    }, 450);
    setTimeout(function() { clearInterval(_waitAI); }, 12000);

    // ═══ PRE-LOAD on init ═══
    var _waitInit = setInterval(function() {
        if (typeof github === 'undefined' || typeof github.readFile !== 'function') return;
        clearInterval(_waitInit);
        _loadOptimizerMarketData().then(function(data) {
            if (data.underlyings) {
                var n = Object.keys(data.underlyings.tickers || {}).length;
                console.log('[MarketData] ' + n + ' proxy ETFs loaded with real vol/DD');
            }
            if (data.rates && data.rates.policy_rates) {
                console.log('[MarketData] ECB deposit: ' + data.rates.policy_rates.ecb_deposit_rate.current + '%');
            }
            if (data.sectors) {
                var ns = Object.keys(data.sectors.sectors || {}).length;
                console.log('[MarketData] ' + ns + ' sectors with real momentum');
            }
        });
    }, 200);
    setTimeout(function() { clearInterval(_waitInit); }, 10000);

    console.log('[StructBoard] Optimizer Market Data Patch v1.0 \u2014 real vol/DD + rates + sector momentum');
})();

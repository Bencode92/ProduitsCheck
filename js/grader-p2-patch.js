// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader P2 Patch v1.0
// Fix P2=35 fallback for indices, commodities, and ETFs
// Uses underlying-map.json + markets.json + macro_indicators
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Cache for underlying map and macro data
    var _underlyingMap = null;
    var _macroData = null;

    // Load underlying-map.json once
    async function _loadUnderlyingMap() {
        if (_underlyingMap) return _underlyingMap;
        try {
            _underlyingMap = await github.readFile('data/underlying-map.json');
            console.log('[P2-Patch] Underlying map loaded: ' + Object.keys(_underlyingMap.indices || {}).length + ' indices, ' + Object.keys(_underlyingMap.commodities || {}).length + ' commodities');
        } catch(e) {
            console.warn('[P2-Patch] underlying-map.json not found');
            _underlyingMap = { indices: {}, commodities: {} };
        }
        return _underlyingMap;
    }

    // Load macro indicators (gold, silver, brent from MI or index)
    async function _loadMacroData() {
        if (_macroData) return _macroData;
        try {
            // Try from index.json (market_intelligence section)
            var idx = await github.readFile('data/market/index.json');
            if (idx && idx.market_intelligence) {
                _macroData = {
                    gold_usd: idx.market_intelligence.gold || null,
                    silver_usd: idx.market_intelligence.silver || null,
                    brent_usd: idx.market_intelligence.brent || null,
                    vix: idx.market_intelligence.vix || null
                };
            }
        } catch(e) {}
        // Fallback: try macro_indicators.json
        if (!_macroData) {
            try {
                var macro = await github.readFile('data/market/macro_indicators.json');
                if (macro && macro._market_data_flat) {
                    _macroData = macro._market_data_flat;
                } else if (macro && macro.macro_environment) {
                    var me = macro.macro_environment;
                    _macroData = {
                        gold_usd: me.gold ? me.gold.price : null,
                        silver_usd: me.silver ? me.silver.price : null,
                        brent_usd: me.brent ? me.brent.price : null,
                        vix: me.vix ? me.vix.value : null
                    };
                }
            } catch(e) {}
        }
        if (!_macroData) _macroData = {};
        return _macroData;
    }

    // Normalize underlying name for fuzzy matching
    function _normalizeUnderlying(name) {
        return (name || '').toLowerCase()
            .replace(/[\u00e9\u00e8\u00ea]/g, 'e')
            .replace(/[^a-z0-9&\s]/g, '')
            .trim();
    }

    // Find proxy data from markets.json for an index
    function _findIndexProxy(underlyingName, marketsData) {
        if (!_underlyingMap || !_underlyingMap.indices) return null;
        var norm = _normalizeUnderlying(underlyingName);
        var mapEntry = _underlyingMap.indices[norm];
        if (!mapEntry) {
            // Try partial match
            var keys = Object.keys(_underlyingMap.indices);
            for (var i = 0; i < keys.length; i++) {
                if (norm.indexOf(keys[i]) >= 0 || keys[i].indexOf(norm) >= 0) {
                    mapEntry = _underlyingMap.indices[keys[i]];
                    break;
                }
            }
        }
        if (!mapEntry) return null;

        // Look up proxy ticker in markets data
        var proxyData = marketsData[mapEntry.proxy] || null;
        return {
            type: 'index',
            name: mapEntry.name,
            proxy: mapEntry.proxy,
            default_vol: mapEntry.default_vol,
            default_beta: mapEntry.default_beta,
            market: proxyData
        };
    }

    // Find commodity data
    function _findCommodityProxy(underlyingName) {
        if (!_underlyingMap || !_underlyingMap.commodities) return null;
        var norm = _normalizeUnderlying(underlyingName);
        var mapEntry = _underlyingMap.commodities[norm];
        if (!mapEntry) {
            var keys = Object.keys(_underlyingMap.commodities);
            for (var i = 0; i < keys.length; i++) {
                if (norm.indexOf(keys[i]) >= 0 || keys[i].indexOf(norm) >= 0) {
                    mapEntry = _underlyingMap.commodities[keys[i]];
                    break;
                }
            }
        }
        if (!mapEntry) return null;

        var price = _macroData ? _macroData[mapEntry.macro_key] : null;
        return {
            type: 'commodity',
            name: mapEntry.name,
            price: price,
            default_vol: mapEntry.default_vol,
            default_beta: mapEntry.default_beta,
            default_dd: mapEntry.default_dd
        };
    }

    // Compute P2 for indices (no Buffett/Quality — use trend/momentum/vol)
    function _computeP2Index(proxyInfo, hasBarrier) {
        var s = 50; // base for index
        var mkt = proxyInfo.market;
        if (mkt) {
            // Trend bonus/malus
            if (mkt.trend === 'up') s += 10;
            else if (mkt.trend === 'down') s -= 5;

            // YTD momentum
            var ytd = mkt.ytd || 0;
            if (ytd > 10) s += 10;
            else if (ytd > 0) s += 5;
            else if (ytd > -5) s -= 0;
            else if (ytd > -15) s -= 5;
            else s -= 15;

            // 3M momentum (more recent signal)
            var m3 = mkt.m3 || 0;
            if (m3 > 5) s += 5;
            else if (m3 < -10) s -= 10;
            else if (m3 < -5) s -= 5;

            // 52W return (structural trend)
            var w52 = mkt.w52 || 0;
            if (w52 > 20) s += 5;
            else if (w52 < 0) s -= 10;
        }

        // Volatility penalty from defaults
        var vol = proxyInfo.default_vol || 18;
        if (vol > 25) s -= 10;
        else if (vol > 20) s -= 5;

        // Barrier context: indices with barriers are more sensitive to DD
        if (hasBarrier) {
            s -= 5; // structural penalty for barrier on index
            var beta = proxyInfo.default_beta || 1.0;
            if (beta > 1.1) s -= Math.round((beta - 1.0) * 10);
        }

        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // Compute P2 for commodities
    function _computeP2Commodity(proxyInfo, hasBarrier) {
        var vol = proxyInfo.default_vol || 20;
        var dd = proxyInfo.default_dd || 20;
        var beta = proxyInfo.default_beta || 0.1;

        // Start from volatility-based score
        // Low vol (gold ~15%) = good, high vol (brent ~35%) = risky
        var s = Math.max(20, Math.min(80, Math.round(100 - vol * 1.5)));

        // DD penalty
        if (dd > 30) s -= 10;
        else if (dd > 20) s -= 5;

        // Decorrelation bonus (low beta = portfolio diversifier)
        if (beta < 0.2) s += 10;
        else if (beta < 0.5) s += 5;

        // Barrier context
        if (hasBarrier) {
            // Commodities with barriers are very risky (high vol)
            s -= Math.round(vol * 0.3);
        }

        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // Wait for grader to load, then override
    var _p2PatchInterval = setInterval(function() {
        if (typeof _extractStockData !== 'function' || typeof _computeP2 !== 'function') return;
        clearInterval(_p2PatchInterval);

        // ═══ Override _extractStockData ═══
        var _origExtractStockData = _extractStockData;
        _extractStockData = function(product, mkt) {
            // First try the original (stocks_europe/us lookup)
            var result = _origExtractStockData(product, mkt);

            // If all underlyings were found, return as-is
            if (result.available) {
                var allFound = result.stocks.every(function(s) { return s.found; });
                if (allFound) return result;
            }

            // For unfound underlyings, try index/commodity mapping
            var marketsData = {};
            if (mkt.indices) {
                // Flatten indices from all regions
                Object.values(mkt.indices).forEach(function(regionIndices) {
                    if (Array.isArray(regionIndices)) {
                        regionIndices.forEach(function(idx) {
                            if (idx.symbol) marketsData[idx.symbol] = idx;
                        });
                    }
                });
            }
            // Also check markets_summary from index.json (already flat)
            if (mkt._marketsSummary) {
                Object.assign(marketsData, mkt._marketsSummary);
            }

            result.stocks = result.stocks.map(function(s) {
                if (s.found) return s;

                // Try index proxy
                var indexProxy = _findIndexProxy(s.name, marketsData);
                if (indexProxy) {
                    s.found = true;
                    s._proxyType = 'index';
                    s._proxy = indexProxy;
                    s.ticker = indexProxy.proxy;
                    s.name = s.name; // keep original name
                    s.sector = 'Index';
                    s.volatility_3y = indexProxy.default_vol;
                    s.beta = indexProxy.default_beta;
                    s.max_drawdown_3y = indexProxy.default_vol * -1.5; // rough estimate
                    if (indexProxy.market) {
                        s.perf_ytd = indexProxy.market.ytd;
                        s.perf_1y = indexProxy.market.w52;
                        s.perf_3m = indexProxy.market.m3;
                    }
                    result.available = true;
                    console.log('[P2-Patch] Index proxy: ' + s.name + ' \u2192 ' + indexProxy.proxy + ' (YTD: ' + (indexProxy.market ? indexProxy.market.ytd : '?') + '%)');
                    return s;
                }

                // Try commodity proxy
                var commodityProxy = _findCommodityProxy(s.name);
                if (commodityProxy) {
                    s.found = true;
                    s._proxyType = 'commodity';
                    s._proxy = commodityProxy;
                    s.ticker = s.name.toUpperCase();
                    s.sector = 'Commodity';
                    s.volatility_3y = commodityProxy.default_vol;
                    s.beta = commodityProxy.default_beta;
                    s.max_drawdown_3y = -(commodityProxy.default_dd || 20);
                    result.available = true;
                    console.log('[P2-Patch] Commodity proxy: ' + s.name + ' (vol: ' + commodityProxy.default_vol + '%, price: ' + (commodityProxy.price || '?') + ')');
                    return s;
                }

                return s;
            });

            // Recalculate worst metrics if we found proxies
            var found = result.stocks.filter(function(s) { return s.found; });
            if (found.length > 0) {
                result.worstMetrics = {
                    worst_buffett: Math.min.apply(null, found.map(function(s) { return s.buffett_score != null ? s.buffett_score : (s._proxyType ? 50 : 35); })),
                    worst_quality: Math.min.apply(null, found.map(function(s) { return s.quality_score != null ? s.quality_score : (s._proxyType ? 50 : 35); })),
                    max_volatility: Math.max.apply(null, found.map(function(s) { return s.volatility_3y || 20; })),
                    max_drawdown: Math.max.apply(null, found.map(function(s) { return Math.abs(s.max_drawdown_3y || 20); })),
                    max_beta: Math.max.apply(null, found.map(function(s) { return s.beta || 1; })),
                    worst_name: found.reduce(function(w, s) {
                        var ws = s.buffett_score != null ? s.buffett_score : (s._proxyType ? 50 : 35);
                        var ww = w.buffett_score != null ? w.buffett_score : (w._proxyType ? 50 : 35);
                        return ws < ww ? s : w;
                    }).name
                };
            }

            return result;
        };

        // ═══ Override _computeP2 ═══
        var _origComputeP2 = _computeP2;
        _computeP2 = function(p, market, productType) {
            // If fixed-rate-callable, use original
            if (productType === 'fixed-rate-callable') return _origComputeP2(p, market, productType);

            // Check if ALL found stocks are proxy-based (index/commodity)
            var hasProxy = market.available && market.stocks && market.stocks.some(function(s) { return s._proxyType; });
            var allProxy = market.available && market.stocks && market.stocks.every(function(s) { return !s.found || s._proxyType; });

            if (!hasProxy) {
                // No proxy stocks — use original (stocks or fallback 35)
                return _origComputeP2(p, market, productType);
            }

            var hasBarrier = !p.capitalProtection && p.barrier > 0;

            // Mixed: some real stocks + some proxies → use original but with enriched data
            if (!allProxy) {
                return _origComputeP2(p, market, productType);
            }

            // ALL underlyings are proxies (indices/commodities)
            // Compute P2 per underlying, take worst-of
            var scores = [];
            market.stocks.forEach(function(s) {
                if (!s.found || !s._proxy) return;
                var score;
                if (s._proxyType === 'index') {
                    score = _computeP2Index(s._proxy, hasBarrier);
                } else if (s._proxyType === 'commodity') {
                    score = _computeP2Commodity(s._proxy, hasBarrier);
                }
                if (score != null) scores.push(score);
            });

            if (scores.length === 0) return 35; // true fallback

            // Worst-of for multi-underlying
            var worstScore = Math.min.apply(null, scores);

            // Worst-of penalty for multi-index/commodity
            if (scores.length > 1) {
                // Correlation penalty: indices are highly correlated, less diversification benefit
                var allIndex = market.stocks.every(function(s) { return s._proxyType === 'index'; });
                if (allIndex && scores.length > 2) worstScore -= 5 * (scores.length - 2);
            }

            return Math.max(0, Math.min(100, Math.round(worstScore)));
        };

        // ═══ Override _collectContext to preload map + macro ═══
        var _origCollectContext = _collectContext;
        _collectContext = async function(product) {
            // Preload underlying map and macro data in parallel
            await Promise.all([_loadUnderlyingMap(), _loadMacroData()]);
            var ctx = await _origCollectContext(product);

            // Inject markets summary into market object for proxy lookup
            if (ctx.market && !ctx.market._marketsSummary) {
                try {
                    var idx = await github.readFile('data/market/index.json');
                    if (idx && idx.markets) {
                        ctx.market._marketsSummary = idx.markets;
                    }
                } catch(e) {}
            }

            return ctx;
        };

        console.log('[StructBoard] Grader P2 Patch v1.0 \u2014 indices + commodities proxy scoring');
    }, 200);
    setTimeout(function() { clearInterval(_p2PatchInterval); }, 10000);
})();

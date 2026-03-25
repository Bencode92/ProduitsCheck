// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader P2 Patch v1.1
// Fix P2=35 fallback for indices, commodities, and ETFs
// Uses underlying-map.json + underlyings_extra.json (REAL DATA)
// + markets.json + macro_indicators
// v1.1: Prioritize real Twelve Data metrics over defaults
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var _underlyingMap = null;
    var _macroData = null;
    var _underlyingsExtra = null; // v1.1: Real data from Twelve Data API

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

    // v1.1: Load real metrics from underlyings_extra.json
    async function _loadUnderlyingsExtra() {
        if (_underlyingsExtra) return _underlyingsExtra;
        try {
            // First try from index.json (injected by workflow)
            var idx = await github.readFile('data/market/index.json');
            if (idx && idx.underlyings_extra && Object.keys(idx.underlyings_extra).length > 0) {
                _underlyingsExtra = idx.underlyings_extra;
                console.log('[P2-Patch] Real metrics loaded from index.json: ' + Object.keys(_underlyingsExtra).length + ' tickers');
                return _underlyingsExtra;
            }
        } catch(e) {}
        // Fallback: try direct file
        try {
            var ue = await github.readFile('data/market/underlyings_extra.json');
            if (ue && ue.tickers) {
                _underlyingsExtra = ue.tickers;
                console.log('[P2-Patch] Real metrics loaded from underlyings_extra.json: ' + Object.keys(_underlyingsExtra).length + ' tickers');
                return _underlyingsExtra;
            }
        } catch(e) {}
        _underlyingsExtra = {};
        console.warn('[P2-Patch] No real metrics available, using defaults');
        return _underlyingsExtra;
    }

    // v1.1: Get real metrics for a proxy ticker, fallback to defaults
    function _getRealMetrics(proxyTicker, defaults) {
        var real = _underlyingsExtra ? _underlyingsExtra[proxyTicker] : null;
        if (!real) return defaults;
        return {
            vol: real.vol_3y != null ? real.vol_3y : defaults.vol,
            dd: real.max_dd_3y != null ? real.max_dd_3y : defaults.dd,
            beta: real.beta != null ? real.beta : defaults.beta,
            perf_ytd: real.perf_ytd,
            perf_1y: real.perf_1y,
            perf_3m: real.perf_3m,
            last_close: real.last_close,
            data_points: real.data_points,
            _source: 'twelve_data'
        };
    }

    async function _loadMacroData() {
        if (_macroData) return _macroData;
        try {
            var idx = await github.readFile('data/market/index.json');
            if (idx && idx.market_intelligence) {
                _macroData = {
                    gold_usd: idx.market_intelligence.gold || null,
                    silver_usd: idx.market_intelligence.silver || null,
                    brent_usd: idx.market_intelligence.brent || null,
                    vix: idx.market_intelligence.vix || null
                };
            }
            // Also merge macro section
            if (idx && idx.macro) {
                if (!_macroData) _macroData = {};
                if (!_macroData.gold_usd && idx.macro.gold_usd) _macroData.gold_usd = idx.macro.gold_usd;
                if (!_macroData.silver_usd && idx.macro.silver_usd) _macroData.silver_usd = idx.macro.silver_usd;
                if (!_macroData.brent_usd && idx.macro.brent_usd) _macroData.brent_usd = idx.macro.brent_usd;
                if (!_macroData.vix && idx.macro.vix) _macroData.vix = idx.macro.vix;
            }
        } catch(e) {}
        if (!_macroData) {
            try {
                var macro = await github.readFile('data/market/macro_indicators.json');
                if (macro && macro._market_data_flat) {
                    _macroData = macro._market_data_flat;
                }
            } catch(e) {}
        }
        if (!_macroData) _macroData = {};
        return _macroData;
    }

    function _normalizeUnderlying(name) {
        return (name || '').toLowerCase()
            .replace(/[\u00e9\u00e8\u00ea]/g, 'e')
            .replace(/[^a-z0-9&\s]/g, '')
            .trim();
    }

    function _findIndexProxy(underlyingName, marketsData) {
        if (!_underlyingMap || !_underlyingMap.indices) return null;
        var norm = _normalizeUnderlying(underlyingName);
        var mapEntry = _underlyingMap.indices[norm];
        if (!mapEntry) {
            var keys = Object.keys(_underlyingMap.indices);
            for (var i = 0; i < keys.length; i++) {
                if (norm.indexOf(keys[i]) >= 0 || keys[i].indexOf(norm) >= 0) {
                    mapEntry = _underlyingMap.indices[keys[i]];
                    break;
                }
            }
        }
        if (!mapEntry) return null;

        var proxyData = marketsData[mapEntry.proxy] || null;

        // v1.1: Enrich with real Twelve Data metrics
        var realMetrics = _getRealMetrics(mapEntry.proxy, {
            vol: mapEntry.default_vol,
            dd: mapEntry.default_vol * 1.5, // rough estimate
            beta: mapEntry.default_beta
        });

        return {
            type: 'index',
            name: mapEntry.name,
            proxy: mapEntry.proxy,
            default_vol: realMetrics.vol,
            default_beta: realMetrics.beta,
            default_dd: realMetrics.dd,
            market: proxyData,
            _realMetrics: realMetrics,
            _hasRealData: realMetrics._source === 'twelve_data'
        };
    }

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

        // v1.1: Check for real commodity ETF data
        // commodity_metrics in underlyings_extra maps macro_key → proxy ETF data
        var realMetrics = null;
        if (_underlyingsExtra) {
            // Try direct: GLD, SLV, BNO
            var commoEtfMap = { 'gold_usd': 'GLD', 'silver_usd': 'SLV', 'brent_usd': 'BNO' };
            var etfTicker = commoEtfMap[mapEntry.macro_key];
            if (etfTicker) {
                realMetrics = _getRealMetrics(etfTicker, {
                    vol: mapEntry.default_vol,
                    dd: mapEntry.default_dd,
                    beta: mapEntry.default_beta
                });
            }
        }
        if (!realMetrics) {
            realMetrics = { vol: mapEntry.default_vol, dd: mapEntry.default_dd, beta: mapEntry.default_beta };
        }

        return {
            type: 'commodity',
            name: mapEntry.name,
            price: price,
            default_vol: realMetrics.vol,
            default_beta: realMetrics.beta,
            default_dd: realMetrics.dd,
            _realMetrics: realMetrics,
            _hasRealData: realMetrics._source === 'twelve_data'
        };
    }

    // Compute P2 for indices
    function _computeP2Index(proxyInfo, hasBarrier) {
        var s = 50;
        var mkt = proxyInfo.market;
        var rm = proxyInfo._realMetrics;

        // v1.1: Use real perf data from Twelve Data if available
        if (rm && rm._source === 'twelve_data') {
            // Trend from YTD + 3M
            var ytd = rm.perf_ytd != null ? rm.perf_ytd : (mkt ? mkt.ytd || 0 : 0);
            var m3 = rm.perf_3m != null ? rm.perf_3m : (mkt ? mkt.m3 || 0 : 0);
            var w52 = rm.perf_1y != null ? rm.perf_1y : (mkt ? mkt.w52 || 0 : 0);

            // Trend from combined signals
            if (ytd > 0 && m3 > 0) s += 10;
            else if (ytd < 0 && m3 < 0) s -= 5;

            // YTD momentum
            if (ytd > 10) s += 10;
            else if (ytd > 0) s += 5;
            else if (ytd > -5) s -= 0;
            else if (ytd > -15) s -= 5;
            else s -= 15;

            // 3M
            if (m3 > 5) s += 5;
            else if (m3 < -10) s -= 10;
            else if (m3 < -5) s -= 5;

            // 52W
            if (w52 > 20) s += 5;
            else if (w52 < 0) s -= 10;

            console.log('[P2-Patch] Index REAL data: ' + proxyInfo.proxy + ' ytd=' + ytd.toFixed(1) + '% 3m=' + m3.toFixed(1) + '% 1y=' + w52.toFixed(1) + '%');
        } else if (mkt) {
            // Fallback: use markets.json data
            if (mkt.trend === 'up') s += 10;
            else if (mkt.trend === 'down') s -= 5;

            var ytd = mkt.ytd || 0;
            if (ytd > 10) s += 10;
            else if (ytd > 0) s += 5;
            else if (ytd > -5) s -= 0;
            else if (ytd > -15) s -= 5;
            else s -= 15;

            var m3 = mkt.m3 || 0;
            if (m3 > 5) s += 5;
            else if (m3 < -10) s -= 10;
            else if (m3 < -5) s -= 5;

            var w52 = mkt.w52 || 0;
            if (w52 > 20) s += 5;
            else if (w52 < 0) s -= 10;
        }

        // v1.1: Use REAL vol from Twelve Data
        var vol = proxyInfo.default_vol || 18;
        if (vol > 30) s -= 15;
        else if (vol > 25) s -= 10;
        else if (vol > 20) s -= 5;

        // v1.1: Use REAL DD from Twelve Data
        var dd = proxyInfo.default_dd || (vol * 1.5);
        if (dd > 40) s -= 10;
        else if (dd > 30) s -= 5;

        // Barrier context
        if (hasBarrier) {
            s -= 5;
            var beta = proxyInfo.default_beta || 1.0;
            if (beta > 1.1) s -= Math.round((beta - 1.0) * 10);
        }

        if (proxyInfo._hasRealData) {
            console.log('[P2-Patch] Index P2 computed: ' + proxyInfo.proxy + ' vol=' + vol + '% dd=' + dd.toFixed(1) + '% beta=' + (proxyInfo.default_beta || '?') + ' → P2=' + Math.round(s));
        }

        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // Compute P2 for commodities
    function _computeP2Commodity(proxyInfo, hasBarrier) {
        var vol = proxyInfo.default_vol || 20;
        var dd = proxyInfo.default_dd || 20;
        var beta = proxyInfo.default_beta || 0.1;

        var s = Math.max(20, Math.min(80, Math.round(100 - vol * 1.5)));

        if (dd > 30) s -= 10;
        else if (dd > 20) s -= 5;

        if (beta < 0.2) s += 10;
        else if (beta < 0.5) s += 5;

        if (hasBarrier) {
            s -= Math.round(vol * 0.3);
        }

        if (proxyInfo._hasRealData) {
            console.log('[P2-Patch] Commodity P2 computed: vol=' + vol + '% dd=' + dd + '% beta=' + beta + ' → P2=' + Math.round(s));
        }

        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // Wait for grader to load
    var _p2PatchInterval = setInterval(function() {
        if (typeof _extractStockData !== 'function' || typeof _computeP2 !== 'function') return;
        clearInterval(_p2PatchInterval);

        // ═══ Override _extractStockData ═══
        var _origExtractStockData = _extractStockData;
        _extractStockData = function(product, mkt) {
            var result = _origExtractStockData(product, mkt);

            if (result.available) {
                var allFound = result.stocks.every(function(s) { return s.found; });
                if (allFound) return result;
            }

            var marketsData = {};
            if (mkt.indices) {
                Object.values(mkt.indices).forEach(function(regionIndices) {
                    if (Array.isArray(regionIndices)) {
                        regionIndices.forEach(function(idx) {
                            if (idx.symbol) marketsData[idx.symbol] = idx;
                        });
                    }
                });
            }
            if (mkt._marketsSummary) {
                Object.assign(marketsData, mkt._marketsSummary);
            }

            result.stocks = result.stocks.map(function(s) {
                if (s.found) return s;

                var indexProxy = _findIndexProxy(s.name, marketsData);
                if (indexProxy) {
                    s.found = true;
                    s._proxyType = 'index';
                    s._proxy = indexProxy;
                    s.ticker = indexProxy.proxy;
                    s.sector = 'Index';
                    // v1.1: Use REAL metrics
                    s.volatility_3y = indexProxy.default_vol;
                    s.beta = indexProxy.default_beta;
                    s.max_drawdown_3y = -(indexProxy.default_dd || indexProxy.default_vol * 1.5);
                    if (indexProxy._realMetrics && indexProxy._realMetrics._source === 'twelve_data') {
                        s.perf_ytd = indexProxy._realMetrics.perf_ytd;
                        s.perf_1y = indexProxy._realMetrics.perf_1y;
                        s.perf_3m = indexProxy._realMetrics.perf_3m;
                        s._dataSource = 'twelve_data';
                        console.log('[P2-Patch] ' + s.name + ' → ' + indexProxy.proxy + ' REAL: vol=' + s.volatility_3y + '% dd=' + s.max_drawdown_3y + '% beta=' + s.beta);
                    } else if (indexProxy.market) {
                        s.perf_ytd = indexProxy.market.ytd;
                        s.perf_1y = indexProxy.market.w52;
                        s.perf_3m = indexProxy.market.m3;
                        s._dataSource = 'markets_json';
                    }
                    result.available = true;
                    return s;
                }

                var commodityProxy = _findCommodityProxy(s.name);
                if (commodityProxy) {
                    s.found = true;
                    s._proxyType = 'commodity';
                    s._proxy = commodityProxy;
                    s.ticker = s.name.toUpperCase();
                    s.sector = 'Commodity';
                    // v1.1: Use REAL metrics
                    s.volatility_3y = commodityProxy.default_vol;
                    s.beta = commodityProxy.default_beta;
                    s.max_drawdown_3y = -(commodityProxy.default_dd || 20);
                    s._dataSource = commodityProxy._hasRealData ? 'twelve_data' : 'defaults';
                    result.available = true;
                    console.log('[P2-Patch] Commodity: ' + s.name + ' vol=' + s.volatility_3y + '% dd=' + s.max_drawdown_3y + '% beta=' + s.beta + ' [' + s._dataSource + ']');
                    return s;
                }

                return s;
            });

            // Recalculate worst metrics
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
            if (productType === 'fixed-rate-callable') return _origComputeP2(p, market, productType);

            var hasProxy = market.available && market.stocks && market.stocks.some(function(s) { return s._proxyType; });
            var allProxy = market.available && market.stocks && market.stocks.every(function(s) { return !s.found || s._proxyType; });

            if (!hasProxy) return _origComputeP2(p, market, productType);

            var hasBarrier = !p.capitalProtection && p.barrier > 0;

            if (!allProxy) return _origComputeP2(p, market, productType);

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

            if (scores.length === 0) return 35;

            var worstScore = Math.min.apply(null, scores);

            if (scores.length > 1) {
                var allIndex = market.stocks.every(function(s) { return s._proxyType === 'index'; });
                if (allIndex && scores.length > 2) worstScore -= 5 * (scores.length - 2);
            }

            return Math.max(0, Math.min(100, Math.round(worstScore)));
        };

        // ═══ Override _collectContext to preload ALL data ═══
        var _origCollectContext = _collectContext;
        _collectContext = async function(product) {
            // v1.1: Load underlyings_extra in parallel with map and macro
            await Promise.all([_loadUnderlyingMap(), _loadMacroData(), _loadUnderlyingsExtra()]);
            var ctx = await _origCollectContext(product);

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

        console.log('[StructBoard] Grader P2 Patch v1.1 — real Twelve Data metrics prioritized');
    }, 200);
    setTimeout(function() { clearInterval(_p2PatchInterval); }, 10000);
})();

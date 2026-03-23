// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Data Fix v2.0
// ═══════════════════════════════════════════════════════════════
// FIX 1: JSON.parse safety for large files from github.readFile
// FIX 2: Accent-insensitive stock matching + extended aliases
// FIX 3: Refresh button on grading section
// Load AFTER proposal-grader.js, BEFORE grader-ui-patch.js
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ─── Helper: strip accents ───────────────────────────────────
    function _stripAccents(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // ─── FIX 1: JSON.parse safety ────────────────────────────────
    function _safeParse(data) {
        if (!data) return null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) {
                console.warn('[GraderFix] JSON parse failed:', e.message);
                return null;
            }
        }
        return data;
    }

    if (typeof _loadAllMarketData === 'function') {
        _loadAllMarketData = async function() {
            if (_mktCache && _mktCacheTs > Date.now() - 3600000) return _mktCache;
            var r = await Promise.all([
                github.readFile('data/market/stocks_europe.json').catch(function() { return null; }),
                github.readFile('data/market/stocks_us.json').catch(function() { return null; }),
                github.readFile('data/market/sectors.json').catch(function() { return null; }),
                github.readFile('data/market/markets.json').catch(function() { return null; }),
                github.readFile('data/market/market_context.json').catch(function() { return null; })
            ]);
            var eu = _safeParse(r[0]), us = _safeParse(r[1]), sec = _safeParse(r[2]), mkt = _safeParse(r[3]), ctx = _safeParse(r[4]);
            _mktCache = {
                stocksEurope: (eu && eu.stocks) ? eu.stocks : [],
                stocksUS: (us && us.stocks) ? us.stocks : [],
                sectors: (sec && sec.sectors) ? sec.sectors : {},
                indices: (mkt && mkt.indices) ? mkt.indices : {},
                context: ctx || {}
            };
            _mktCacheTs = Date.now();
            console.log('[Grader] Market loaded:', _mktCache.stocksEurope.length, 'EU,', _mktCache.stocksUS.length, 'US');
            return _mktCache;
        };
    }

    // ─── FIX 2: Extended aliases + accent-insensitive matching ───

    // Add missing aliases to STOCK_ALIASES
    var EXTRA_ALIASES = {
        'CREDIT AGRICOLE': 'ACA', 'CRÉDIT AGRICOLE': 'ACA', 'CA': 'ACA',
        'SOCIETE GENERALE': 'GLE', 'SOCIÉTÉ GÉNÉRALE': 'GLE', 'SOCGEN': 'GLE', 'SG': 'GLE',
        'BNP PARIBAS': 'BNP', 'BNPP': 'BNP',
        'SAINT GOBAIN': 'SGO', 'SAINT-GOBAIN': 'SGO',
        'SCHNEIDER ELECTRIC': 'SU',
        'AIR LIQUIDE': 'AI', 'AIR LIQUID': 'AI',
        'CAPGEMINI': 'CAP', 'HERMES': 'RMS', 'HERMÈS': 'RMS',
        'KERING': 'KER', 'ORANGE': 'ORA', 'VEOLIA': 'VIE',
        'BOUYGUES': 'EN', 'MICHELIN': 'ML', 'RENAULT': 'RNO',
        'STELLANTIS': 'STLAP', 'UNIBAIL': 'URW',
        'VOLKSWAGEN': 'VOW3', 'VW': 'VOW3',
        'SIEMENS': 'SIE', 'SAP': 'SAP', 'ADIDAS': 'ADS',
        'BAYER': 'BAYN', 'BASF': 'BAS', 'ALLIANZ': 'ALV',
        'DEUTSCHE BANK': 'DBK', 'BMW': 'BMW', 'DAIMLER': 'MBG', 'MERCEDES': 'MBG',
        'NESTLE': 'NESN', 'NESTLÉ': 'NESN', 'NOVARTIS': 'NOVN', 'ROCHE': 'ROG',
        'ZURICH': 'ZURN', 'UBS': 'UBSG', 'ABB': 'ABBN',
        'SHELL': 'SHEL', 'BP': 'BP', 'UNILEVER': 'ULVR', 'ASTRAZENECA': 'AZN',
        'GLAXO': 'GSK', 'GSK': 'GSK', 'HSBC': 'HSBA', 'BARCLAYS': 'BARC',
        'APPLE': 'AAPL', 'MICROSOFT': 'MSFT', 'GOOGLE': 'GOOGL', 'ALPHABET': 'GOOGL',
        'AMAZON': 'AMZN', 'META': 'META', 'FACEBOOK': 'META',
        'NVIDIA': 'NVDA', 'AMD': 'AMD', 'INTEL': 'INTC',
        'JPMORGAN': 'JPM', 'JP MORGAN': 'JPM', 'GOLDMAN': 'GS', 'GOLDMAN SACHS': 'GS',
        'COCA COLA': 'KO', 'COCA-COLA': 'KO', 'PEPSI': 'PEP', 'PEPSICO': 'PEP',
        'JOHNSON': 'JNJ', 'JOHNSON & JOHNSON': 'JNJ', 'PFIZER': 'PFE',
        'PROCTER': 'PG', 'PROCTER & GAMBLE': 'PG', 'WALT DISNEY': 'DIS', 'DISNEY': 'DIS',
        'VISA': 'V', 'MASTERCARD': 'MA',
        'EUROSTOXX': 'SX5E', 'EURO STOXX 50': 'SX5E', 'EUROSTOXX 50': 'SX5E',
        'CAC 40': 'CAC', 'CAC40': 'CAC', 'S&P 500': 'SPX', 'S&P500': 'SPX',
        'NASDAQ': 'NDX', 'NASDAQ 100': 'NDX', 'DAX': 'DAX', 'FTSE': 'UKX',
        'NIKKEI': 'NKY', 'NIKKEI 225': 'NKY'
    };

    if (typeof STOCK_ALIASES !== 'undefined') {
        Object.keys(EXTRA_ALIASES).forEach(function(k) {
            if (!STOCK_ALIASES[k]) STOCK_ALIASES[k] = EXTRA_ALIASES[k];
        });
        console.log('[GraderFix] Extended STOCK_ALIASES to', Object.keys(STOCK_ALIASES).length, 'entries');
    }

    // Patch _resolveAlias to strip accents before lookup
    if (typeof _resolveAlias === 'function') {
        var _origResolve = _resolveAlias;
        _resolveAlias = function(name) {
            // Try original first
            var result = _origResolve(name);
            // If result is same as input (no alias found), try accent-stripped
            if (result === name.toUpperCase().trim()) {
                var stripped = _stripAccents(name.toUpperCase().trim());
                if (typeof STOCK_ALIASES !== 'undefined' && STOCK_ALIASES[stripped]) {
                    return STOCK_ALIASES[stripped];
                }
            }
            return result;
        };
    }

    // Patch _extractStockData to use accent-insensitive matching
    if (typeof _extractStockData === 'function') {
        var _origExtract = _extractStockData;
        _extractStockData = function(product, mkt) {
            var result = _origExtract(product, mkt);

            // Second pass: try to find any "not found" stocks with fuzzy matching
            var all = [].concat(mkt.stocksEurope || [], mkt.stocksUS || []);
            if (all.length === 0) return result;

            result.stocks.forEach(function(s, idx) {
                if (s.found) return; // already found

                var searchName = _stripAccents(s.name.toUpperCase().trim());
                var searchTicker = _stripAccents(s.ticker.toUpperCase().trim());

                var match = all.find(function(x) {
                    var t = (x.ticker || '').toUpperCase();
                    var n = _stripAccents((x.name || '').toUpperCase());
                    var napi = _stripAccents((x.name_api || '').toUpperCase());

                    // Exact ticker match
                    if (t === searchTicker || t === searchName) return true;
                    // Name contains search
                    if (n.indexOf(searchName) >= 0 || napi.indexOf(searchName) >= 0) return true;
                    // Search contains name (for short names like "LVMH" in "LVMH MOET...")
                    if (searchName.length >= 3 && (n.indexOf(searchName) >= 0 || napi.indexOf(searchName) >= 0)) return true;
                    // Partial match: first word
                    var firstWord = searchName.split(/\s+/)[0];
                    if (firstWord.length >= 4 && (n.indexOf(firstWord) >= 0 || napi.indexOf(firstWord) >= 0)) return true;

                    return false;
                });

                if (match) {
                    console.log('[GraderFix] Fuzzy matched:', s.name, '→', match.ticker, match.name);
                    result.stocks[idx] = {
                        name: s.name, ticker: match.ticker, found: true,
                        price: match.price, change_pct: match.change_percent,
                        perf_ytd: match.perf_ytd, perf_1y: match.perf_1y, perf_3y: match.perf_3y,
                        beta: match.beta, volatility_3y: match.volatility_3y,
                        max_drawdown_3y: match.max_drawdown_3y, distance_52w_high: match.distance_52w_high,
                        pe_ratio: match.pe_ratio, roe: match.roe, de_ratio: match.de_ratio,
                        net_margin: match.net_margin, fcf_yield: match.fcf_yield, dividend_yield: match.dividend_yield,
                        buffett_score: match.buffett_score, buffett_grade: match.buffett_grade,
                        quality_score: match.quality_score, quality_subscores: match.quality_subscores,
                        sector: match.sector, sector_api: match.sector_api, industry: match.industry,
                        country: match.country, region: match.region
                    };
                    result.available = true;
                }
            });

            // Recalculate worst metrics after fuzzy pass
            var found = result.stocks.filter(function(s) { return s.found; });
            if (found.length > 0) {
                result.worstMetrics = {
                    worst_buffett: Math.min.apply(null, found.map(function(s) { return s.buffett_score != null ? s.buffett_score : 100; })),
                    worst_quality: Math.min.apply(null, found.map(function(s) { return s.quality_score != null ? s.quality_score : 100; })),
                    worst_perf_1y: Math.min.apply(null, found.map(function(s) { return s.perf_1y != null ? s.perf_1y : 0; })),
                    max_volatility: Math.max.apply(null, found.map(function(s) { return s.volatility_3y || 0; })),
                    max_drawdown: Math.max.apply(null, found.map(function(s) { return Math.abs(s.max_drawdown_3y || 0); })),
                    max_beta: Math.max.apply(null, found.map(function(s) { return s.beta || 1; })),
                    worst_name: found.reduce(function(w, s) { return (s.buffett_score != null ? s.buffett_score : 100) < (w.buffett_score != null ? w.buffett_score : 100) ? s : w; }).name
                };
            }

            return result;
        };
    }

    // ─── FIX 3: Force clear market cache ─────────────────────────
    if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }

    console.log('[GraderFix] v2.0 loaded — JSON.parse safety + accent matching + extended aliases');
})();

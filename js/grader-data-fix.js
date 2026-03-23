// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Data Fix v5.0 — Compatible with Grader v3.1
// ═══════════════════════════════════════════════════════════════
// KEEPS: aliases, fuzzy matching, JSON safety, rate detection
// REMOVES: all prompt/scoring/killcriteria overrides (now in v3.1)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function _stripAccents(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // ─── Rate product detection (kept) ───────────────────────────
    var RATE_KEYWORDS = ['TEC', 'CMS', 'EURIBOR', 'EONIA', 'ESTER', 'EUR3M', 'EUR6M',
        'LIBOR', 'SOFR', 'OAT', 'BUND', 'SWAP', 'TAUX', 'RATE', 'INDICE TEC'];

    function _isRateProduct(product) {
        var unds = (product.underlyings || []).concat(product.name ? [product.name] : []);
        return unds.some(function(u) {
            var up = u.toUpperCase();
            return RATE_KEYWORDS.some(function(kw) { return up.indexOf(kw) >= 0; });
        });
    }

    function _getRateContext(product) {
        var unds = (product.underlyings || []).join(', ').toUpperCase();
        var info = { isRate: true, type: 'taux', underlying: unds };
        if (unds.indexOf('TEC') >= 0) {
            info.type = 'TEC 10';
            info.description = 'Indice OAT fran\u00e7aises 10 ans';
            info.vol = '~12% annuelle';
        } else if (unds.indexOf('CMS') >= 0) {
            info.type = 'CMS'; info.vol = '~10%';
        } else if (unds.indexOf('EURIBOR') >= 0) {
            info.type = 'Euribor'; info.vol = '~5%';
        }
        return info;
    }

    window._isRateProduct = _isRateProduct;
    window._getRateContext = _getRateContext;

    // ─── JSON.parse safety (kept) ────────────────────────────────
    function _safeParse(data) {
        if (!data) return null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return null; }
        }
        return data;
    }

    // Override _loadAllMarketData with _safeParse for large files
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
            console.log('[GraderFix] Market loaded:', _mktCache.stocksEurope.length, 'EU,', _mktCache.stocksUS.length, 'US');
            return _mktCache;
        };
    }

    // ─── Extended aliases (kept) ─────────────────────────────────
    var EXTRA_ALIASES = {
        'CREDIT AGRICOLE': 'ACA', 'CR\u00c9DIT AGRICOLE': 'ACA', 'CA': 'ACA',
        'SOCIETE GENERALE': 'GLE', 'SOCI\u00c9T\u00c9 G\u00c9N\u00c9RALE': 'GLE', 'SOCGEN': 'GLE', 'SG': 'GLE',
        'BNP PARIBAS': 'BNP', 'BNPP': 'BNP',
        'SAINT GOBAIN': 'SGO', 'SAINT-GOBAIN': 'SGO', 'SCHNEIDER ELECTRIC': 'SU',
        'AIR LIQUIDE': 'AI', 'CAPGEMINI': 'CAP',
        'HERMES': 'RMS', 'HERM\u00c8S': 'RMS', 'KERING': 'KER', 'ORANGE': 'ORA', 'VEOLIA': 'VIE',
        'BOUYGUES': 'EN', 'MICHELIN': 'ML', 'RENAULT': 'RNO',
        'STELLANTIS': 'STLAP', 'UNIBAIL': 'URW',
        'VOLKSWAGEN': 'VOW3', 'VW': 'VOW3', 'SIEMENS': 'SIE', 'SAP': 'SAP', 'ADIDAS': 'ADS',
        'BAYER': 'BAYN', 'BASF': 'BAS', 'ALLIANZ': 'ALV',
        'DEUTSCHE BANK': 'DBK', 'BMW': 'BMW', 'MERCEDES': 'MBG',
        'NESTLE': 'NESN', 'NESTL\u00c9': 'NESN', 'NOVARTIS': 'NOVN', 'ROCHE': 'ROG',
        'UBS': 'UBSG', 'ABB': 'ABBN', 'ENEL': 'ENEL', 'ENI': 'ENI',
        'UNICREDIT': 'UCG', 'INTESA': 'ISP', 'MONTE PASCHI': 'BMPS', 'BANCA MONTE': 'BMPS',
        'NOVO NORDISK': 'NOVO-B', 'NOVO': 'NOVO-B',
        'SHELL': 'SHEL', 'BP': 'BP', 'UNILEVER': 'ULVR', 'ASTRAZENECA': 'AZN',
        'GSK': 'GSK', 'HSBC': 'HSBA', 'BARCLAYS': 'BARC',
        'APPLE': 'AAPL', 'MICROSOFT': 'MSFT', 'GOOGLE': 'GOOGL', 'ALPHABET': 'GOOGL',
        'AMAZON': 'AMZN', 'META': 'META', 'NVIDIA': 'NVDA', 'AMD': 'AMD', 'INTEL': 'INTC',
        'JPMORGAN': 'JPM', 'JP MORGAN': 'JPM', 'GOLDMAN SACHS': 'GS',
        'COCA-COLA': 'KO', 'PEPSICO': 'PEP', 'PFIZER': 'PFE',
        'PROCTER & GAMBLE': 'PG', 'DISNEY': 'DIS', 'VISA': 'V', 'MASTERCARD': 'MA'
    };
    if (typeof STOCK_ALIASES !== 'undefined') {
        Object.keys(EXTRA_ALIASES).forEach(function(k) { if (!STOCK_ALIASES[k]) STOCK_ALIASES[k] = EXTRA_ALIASES[k]; });
    }

    // Accent-insensitive alias resolution (kept)
    if (typeof _resolveAlias === 'function') {
        var _origResolve = _resolveAlias;
        _resolveAlias = function(name) {
            var result = _origResolve(name);
            if (result === name.toUpperCase().trim()) {
                var stripped = _stripAccents(name.toUpperCase().trim());
                if (typeof STOCK_ALIASES !== 'undefined' && STOCK_ALIASES[stripped]) return STOCK_ALIASES[stripped];
            }
            return result;
        };
    }

    // Fuzzy second pass for stock matching (kept)
    if (typeof _extractStockData === 'function') {
        var _origExtract = _extractStockData;
        _extractStockData = function(product, mkt) {
            var result = _origExtract(product, mkt);
            var all = [].concat(mkt.stocksEurope || [], mkt.stocksUS || []);
            if (all.length === 0) return result;
            result.stocks.forEach(function(s, idx) {
                if (s.found) return;
                var sn = _stripAccents(s.name.toUpperCase().trim());
                var st = _stripAccents(s.ticker.toUpperCase().trim());
                var match = all.find(function(x) {
                    var t = (x.ticker || '').toUpperCase();
                    var n = _stripAccents((x.name || '').toUpperCase());
                    var na = _stripAccents((x.name_api || '').toUpperCase());
                    if (t === st || t === sn) return true;
                    if (n.indexOf(sn) >= 0 || na.indexOf(sn) >= 0) return true;
                    var fw = sn.split(/\s+/)[0];
                    if (fw.length >= 4 && (n.indexOf(fw) >= 0 || na.indexOf(fw) >= 0)) return true;
                    return false;
                });
                if (match) {
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
            // Recompute worstMetrics after fuzzy matching
            var found = result.stocks.filter(function(s) { return s.found; });
            if (found.length > 0) {
                result.worstMetrics = {
                    worst_buffett: Math.min.apply(null, found.map(function(s) { return s.buffett_score != null ? s.buffett_score : 50; })),
                    worst_quality: Math.min.apply(null, found.map(function(s) { return s.quality_score != null ? s.quality_score : 50; })),
                    max_volatility: Math.max.apply(null, found.map(function(s) { return s.volatility_3y || 30; })),
                    max_drawdown: Math.max.apply(null, found.map(function(s) { return Math.abs(s.max_drawdown_3y || 30); })),
                    max_beta: Math.max.apply(null, found.map(function(s) { return s.beta || 1; })),
                    worst_name: found.reduce(function(w, s) { return (s.buffett_score != null ? s.buffett_score : 50) < (w.buffett_score != null ? w.buffett_score : 50) ? s : w; }).name
                };
            }
            return result;
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // REMOVED — these are now handled by proposal-grader.js v3.1:
    // - _checkKillCriteria override (v3.1 uses 2-arg signature)
    // - _localFallback override (v3.1 has deterministic scoring)
    // - _buildSystemPrompt override (v3.1 has hybrid prompt)
    // - _buildUserPrompt override (v3.1 has product-focused prompt)
    // - _normalizeResult override (v3.1 handles its own normalization)
    // - GRADING_CONFIG grade threshold changes (v3.1 has own thresholds)
    // - _computeCouponProbability (v3.1 doesn't use it — deterministic P1)
    // ═══════════════════════════════════════════════════════════════

    // ─── Clear market cache on load ──────────────────────────────
    if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }

    console.log('[GraderFix] v5.0 \u2014 compatible with Grader v3.1 (aliases + fuzzy + rate + JSON safety only)');
})();

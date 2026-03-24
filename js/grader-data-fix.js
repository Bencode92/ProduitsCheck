// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Data Fix v5.1 — Post-audit expert fixes
// ═══════════════════════════════════════════════════════════════
// v5.1 changes:
// FIX 1: Buffett fallback → quality_score proxy (was hardcoded 35)
// FIX 2: Sector correlation proportional (was binary -10/-5)
// FIX 3: prob_call 50% → 45% for autocall threshold 100%
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function _stripAccents(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // ─── Rate product detection ──────────────────────────────────
    var RATE_KEYWORDS = ['TEC', 'CMS', 'EURIBOR', 'EONIA', 'ESTER', 'EUR3M', 'EUR6M',
        'LIBOR', 'SOFR', 'OAT', 'BUND', 'SWAP', 'TAUX', 'RATE', 'INDICE TEC'];
    function _isRateProduct(product) { var unds = (product.underlyings || []).concat(product.name ? [product.name] : []); return unds.some(function(u) { var up = u.toUpperCase(); return RATE_KEYWORDS.some(function(kw) { return up.indexOf(kw) >= 0; }); }); }
    function _getRateContext(product) { var unds = (product.underlyings || []).join(', ').toUpperCase(); var info = { isRate: true, type: 'taux', underlying: unds }; if (unds.indexOf('TEC') >= 0) { info.type = 'TEC 10'; info.description = 'Indice OAT fran\u00e7aises 10 ans'; info.vol = '~12% annuelle'; } else if (unds.indexOf('CMS') >= 0) { info.type = 'CMS'; info.vol = '~10%'; } else if (unds.indexOf('EURIBOR') >= 0) { info.type = 'Euribor'; info.vol = '~5%'; } return info; }
    window._isRateProduct = _isRateProduct;
    window._getRateContext = _getRateContext;

    // ─── JSON.parse safety ───────────────────────────────────────
    function _safeParse(data) { if (!data) return null; if (typeof data === 'string') { try { return JSON.parse(data); } catch (e) { return null; } } return data; }

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
            _mktCache = { stocksEurope: (eu && eu.stocks) ? eu.stocks : [], stocksUS: (us && us.stocks) ? us.stocks : [], sectors: (sec && sec.sectors) ? sec.sectors : {}, indices: (mkt && mkt.indices) ? mkt.indices : {}, context: ctx || {} };
            _mktCacheTs = Date.now();
            console.log('[GraderFix] Market loaded:', _mktCache.stocksEurope.length, 'EU,', _mktCache.stocksUS.length, 'US');
            return _mktCache;
        };
    }

    // ─── Extended aliases ────────────────────────────────────────
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

    // Accent-insensitive alias resolution
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

    // ═══════════════════════════════════════════════════════════════
    // FIX 1: Buffett fallback → quality_score as proxy
    // ═══════════════════════════════════════════════════════════════
    // PROBLEM: 20% of EU stocks (BMPS, UCG, BNP, GLE, HSBA...) have
    // buffett_score=null. The old fallback was 35, which pulled entire
    // worst-of baskets down unfairly when only 1 stock was missing.
    // FIX: Use quality_score as proxy when buffett_score is null.
    // quality_score has 99% coverage and measures related fundamentals.

    // Helper: get best available score for a stock
    function _bestBuffett(s) {
        if (s.buffett_score != null) return s.buffett_score;
        if (s.quality_score != null) return s.quality_score; // proxy
        return 35; // last resort
    }

    // Fuzzy matching + corrected worstMetrics
    if (typeof _extractStockData === 'function') {
        var _origExtract = _extractStockData;
        _extractStockData = function(product, mkt) {
            var result = _origExtract(product, mkt);
            var all = [].concat(mkt.stocksEurope || [], mkt.stocksUS || []);
            if (all.length === 0) return result;
            // Fuzzy second pass for unmatched stocks
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
            // [FIX 1] Recompute worstMetrics with quality_score as Buffett proxy
            var found = result.stocks.filter(function(s) { return s.found; });
            if (found.length > 0) {
                result.worstMetrics = {
                    worst_buffett: Math.min.apply(null, found.map(function(s) { return _bestBuffett(s); })),
                    worst_quality: Math.min.apply(null, found.map(function(s) { return s.quality_score != null ? s.quality_score : 35; })),
                    max_volatility: Math.max.apply(null, found.map(function(s) { return s.volatility_3y || 30; })),
                    max_drawdown: Math.max.apply(null, found.map(function(s) { return Math.abs(s.max_drawdown_3y || 30); })),
                    max_beta: Math.max.apply(null, found.map(function(s) { return s.beta || 1; })),
                    worst_name: found.reduce(function(w, s) { return _bestBuffett(s) < _bestBuffett(w) ? s : w; }).name
                };
            }
            return result;
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // FIX 2: Sector correlation PROPORTIONAL (was binary -10/-5)
    // ═══════════════════════════════════════════════════════════════
    // PROBLEM: BNP/SG/UCG (3 banks, corr ~0.8) and BNP/Total/SAP
    // (3 sectors, corr ~0.3) both got -5 pts. Now proportional:
    //   penalty = -10 × (1 - nb_sectors / nb_underlyings)
    //   3 banks (1/3)  → -7 pts
    //   2 banks+1 other (2/3) → -3 pts
    //   3 different sectors (3/3) → 0 pts

    if (typeof _computeP2 === 'function') {
        var _origP2 = _computeP2;
        _computeP2 = function(p, market, productType) {
            var score = _origP2(p, market, productType);
            // Only patch for standard products with market data
            if (productType === 'fixed-rate-callable') return score;
            if (!market.available || !market.worstMetrics) return score;
            if (!market.stocks || market.stocks.length <= 1) return score;

            var found = market.stocks.filter(function(x) { return x.found; });
            if (found.length <= 1) return score;

            // Remove old binary penalty (already applied by _origP2)
            var sec = {};
            found.forEach(function(x) { sec[(x.sector_api || '?').toLowerCase()] = 1; });
            var nSectors = Object.keys(sec).length;
            // Undo old penalty
            if (nSectors === 1) score += 10;
            else if (nSectors < found.length) score += 5;
            // Apply new proportional penalty
            var sectorRatio = nSectors / found.length;
            score -= Math.round(10 * (1 - sectorRatio));
            // 1 sector / 3 SJ → -7 | 2/3 → -3 | 3/3 → 0

            return Math.max(0, Math.min(100, Math.round(score)));
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // FIX 3: prob_call 50% → 45% (more conservative for autocall)
    // ═══════════════════════════════════════════════════════════════
    // PROBLEM: 50% per observation date is slightly aggressive.
    // Market data shows 30-40% at first date for EUR autocalls.
    // Compromise: 45% (was 50%). This shifts expected maturity up
    // by ~0.5-1 year for typical products.

    if (typeof _estimateExpectedMaturity === 'function') {
        var _origMaturity = _estimateExpectedMaturity;
        _estimateExpectedMaturity = function(p) {
            var matMax = p.maturityYears || 0;
            if (matMax <= 0) return { expected: 0, max: 0, isEstimated: false };
            if (!p.autocall) return { expected: matMax, max: matMax, isEstimated: false };

            var threshold = p.autocallThreshold || 100;
            var probCallPerDate;
            // [FIX 3] Adjusted probabilities — more conservative
            if (threshold <= 100) probCallPerDate = 0.45;      // was 0.50
            else if (threshold <= 105) probCallPerDate = 0.36;  // was 0.40
            else if (threshold <= 110) probCallPerDate = 0.32;  // was 0.35
            else probCallPerDate = 0.28;                        // was 0.30

            if (p.worstOf && p.underlyings.length > 1) {
                probCallPerDate = Math.pow(probCallPerDate, Math.sqrt(p.underlyings.length));
            }

            var obsPerYear = p.autocallObsPerYear || 1;
            var totalObs = Math.floor(matMax * obsPerYear);
            if (totalObs <= 0) return { expected: matMax, max: matMax, isEstimated: false };

            var firstObsYear = 1.0 / obsPerYear;
            if (firstObsYear < 0.5) firstObsYear = 1;

            var expectedMat = 0;
            var probSurviving = 1.0;
            for (var i = 0; i < totalObs; i++) {
                var dateYear = firstObsYear + (i / obsPerYear);
                if (dateYear > matMax) break;
                var probCallHere = probSurviving * probCallPerDate;
                expectedMat += probCallHere * dateYear;
                probSurviving *= (1 - probCallPerDate);
            }
            expectedMat += probSurviving * matMax;
            expectedMat = Math.round(expectedMat * 10) / 10;

            return {
                expected: expectedMat, max: matMax, isEstimated: true,
                probCallPerDate: Math.round(probCallPerDate * 100),
                probReachMaturity: Math.round(probSurviving * 100),
                totalObsDates: totalObs
            };
        };
        // Update ProposalGrader reference
        if (window.ProposalGrader) window.ProposalGrader.estimateExpectedMaturity = _estimateExpectedMaturity;
    }

    // ─── Clear market cache on load ──────────────────────────────
    if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }

    console.log('[GraderFix] v5.1 \u2014 buffett proxy + proportional correlation + conservative prob_call');
})();

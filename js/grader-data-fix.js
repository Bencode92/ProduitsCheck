// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Data Fix v4.2 — Rate product detection
// ═══════════════════════════════════════════════════════════════
// v4.2: Detects rate products (TEC, CMS, Euribor, etc.)
//       and provides adapted analysis context to Claude
// All v4.1 fixes preserved
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function _stripAccents(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // ─── Rate product detection ──────────────────────────────────
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
            info.type = 'TEC 10 (Taux de l\u2019\u00c9ch\u00e9ance Constante 10 ans)';
            info.description = 'Indice de r\u00e9f\u00e9rence des OAT fran\u00e7aises 10 ans. Refl\u00e8te le rendement des emprunts d\u2019\u00c9tat fran\u00e7ais \u00e0 10 ans.';
            info.currentLevel = 'Environ 3.0-3.5% (mars 2026)';
            info.vol = 'Volatilit\u00e9 faible (5-15% annuelle) vs actions (20-40%)';
            info.risk = 'Risque principal : hausse des taux (BCE hawkish, inflation). Coupon conditionnel si TEC \u2264 seuil.';
        } else if (unds.indexOf('CMS') >= 0) {
            info.type = 'CMS (Constant Maturity Swap)';
            info.description = 'Taux swap de march\u00e9 interbancaire, r\u00e9f\u00e9rence EUR.';
            info.vol = 'Volatilit\u00e9 faible (5-12%)';
        } else if (unds.indexOf('EURIBOR') >= 0) {
            info.type = 'Euribor';
            info.description = 'Taux interbancaire euro, li\u00e9 directement au taux BCE.';
            info.vol = 'Volatilit\u00e9 tr\u00e8s faible (3-8%)';
        }
        return info;
    }

    window._isRateProduct = _isRateProduct;
    window._getRateContext = _getRateContext;

    // ─── JSON.parse safety ───────────────────────────────────────
    function _safeParse(data) {
        if (!data) return null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return null; }
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

    // ─── Extended aliases ────────────────────────────────────────
    var EXTRA_ALIASES = {
        'CREDIT AGRICOLE': 'ACA', 'CRÉDIT AGRICOLE': 'ACA', 'CA': 'ACA',
        'SOCIETE GENERALE': 'GLE', 'SOCIÉTÉ GÉNÉRALE': 'GLE', 'SOCGEN': 'GLE', 'SG': 'GLE',
        'BNP PARIBAS': 'BNP', 'BNPP': 'BNP',
        'SAINT GOBAIN': 'SGO', 'SAINT-GOBAIN': 'SGO', 'SCHNEIDER ELECTRIC': 'SU',
        'AIR LIQUIDE': 'AI', 'CAPGEMINI': 'CAP',
        'HERMES': 'RMS', 'HERMÈS': 'RMS', 'KERING': 'KER', 'ORANGE': 'ORA', 'VEOLIA': 'VIE',
        'BOUYGUES': 'EN', 'MICHELIN': 'ML', 'RENAULT': 'RNO',
        'STELLANTIS': 'STLAP', 'UNIBAIL': 'URW',
        'VOLKSWAGEN': 'VOW3', 'VW': 'VOW3', 'SIEMENS': 'SIE', 'SAP': 'SAP', 'ADIDAS': 'ADS',
        'BAYER': 'BAYN', 'BASF': 'BAS', 'ALLIANZ': 'ALV',
        'DEUTSCHE BANK': 'DBK', 'BMW': 'BMW', 'MERCEDES': 'MBG',
        'NESTLE': 'NESN', 'NESTLÉ': 'NESN', 'NOVARTIS': 'NOVN', 'ROCHE': 'ROG',
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

    // Fuzzy second pass
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
            var found = result.stocks.filter(function(s) { return s.found; });
            if (found.length > 0) {
                result.worstMetrics = {
                    worst_buffett: Math.min.apply(null, found.map(function(s) { return s.buffett_score != null ? s.buffett_score : 40; })),
                    worst_quality: Math.min.apply(null, found.map(function(s) { return s.quality_score != null ? s.quality_score : 40; })),
                    worst_perf_1y: Math.min.apply(null, found.map(function(s) { return s.perf_1y != null ? s.perf_1y : 0; })),
                    max_volatility: Math.max.apply(null, found.map(function(s) { return s.volatility_3y || 30; })),
                    max_drawdown: Math.max.apply(null, found.map(function(s) { return Math.abs(s.max_drawdown_3y || 30); })),
                    max_beta: Math.max.apply(null, found.map(function(s) { return s.beta || 1; })),
                    worst_name: found.reduce(function(w, s) { return (s.buffett_score != null ? s.buffett_score : 40) < (w.buffett_score != null ? w.buffett_score : 40) ? s : w; }).name,
                    missing_data: found.some(function(s) { return s.buffett_score == null; })
                };
            }
            return result;
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // KILL CRITERIA — F7 fix + KC4 removed
    // ═══════════════════════════════════════════════════════════════

    if (typeof _checkKillCriteria === 'function') {
        _checkKillCriteria = function(product, pfCtx, catBench) {
            var kc = GRADING_CONFIG.killCriteria, reasons = [];
            if (product.worstOf && product.underlyings.length > kc.maxWorstOfUnderlyings)
                reasons.push('Worst-of sur ' + product.underlyings.length + ' sous-jacents (max: ' + kc.maxWorstOfUnderlyings + ')');
            if (!product.capitalProtection && product.barrier !== 0) {
                var absB = Math.abs(product.barrier), absT = Math.abs(kc.minBarrierWithoutProtection);
                if (absB < absT) reasons.push('Barri\u00e8re -' + absB + '% sans protection capital (min: -' + absT + '%)');
            }
            var bestCat = catBench.bestRate || 3.0;
            var couponProb = _computeCouponProbability(product);
            var adjRet = product.coupon * couponProb;
            if (product.coupon > 0 && (adjRet - bestCat) < kc.minRiskPremiumVsCat)
                reasons.push('Prime ajust\u00e9e n\u00e9gative: ' + adjRet.toFixed(1) + '% (coupon ' + product.coupon + '% \u00d7 ' + Math.round(couponProb * 100) + '%) vs CAT ' + bestCat + '%');
            if (product.maturityYears > 12 && !product.capitalProtection)
                reasons.push('Maturit\u00e9 ' + product.maturityYears + 'a sans protection');
            return { killed: reasons.length > 0, reasons: reasons };
        };
        if (window.ProposalGrader) window.ProposalGrader.checkKillCriteria = _checkKillCriteria;
    }
    if (typeof GRADING_CONFIG !== 'undefined' && GRADING_CONFIG.killCriteria) delete GRADING_CONFIG.killCriteria.maxSameUnderlying;

    // ═══════════════════════════════════════════════════════════════
    // F1 — Coupon probability model
    // ═══════════════════════════════════════════════════════════════

    function _computeCouponProbability(product) {
        var barrier = Math.abs(product.barrier || 0);
        var vol = 30;
        var mat = product.maturityYears || 3;

        // Rate products: much lower vol than equities
        if (_isRateProduct(product)) {
            vol = 12; // Rate indices vol ~8-15% vs equity 25-40%
            // For rate products, barrier is often a rate level (e.g., TEC 10 ≤ 4.40%)
            // If no barrier %, capital is protected → high probability
            if (barrier === 0 && product.capitalProtection) return 0.85;
        }

        if (_mktCache && product.underlyings && product.underlyings.length > 0 && !_isRateProduct(product)) {
            var all = [].concat(_mktCache.stocksEurope || [], _mktCache.stocksUS || []);
            var maxVol = 0;
            product.underlyings.forEach(function(und) {
                var ticker = (typeof _resolveAlias === 'function') ? _resolveAlias(und) : und.toUpperCase();
                var stripped = _stripAccents(und.toUpperCase());
                var s = all.find(function(x) {
                    return x.ticker === ticker || x.ticker === stripped ||
                        _stripAccents((x.name || '').toUpperCase()).indexOf(stripped) >= 0 ||
                        _stripAccents((x.name_api || '').toUpperCase()).indexOf(stripped) >= 0;
                });
                if (s && s.volatility_3y && s.volatility_3y > maxVol) maxVol = s.volatility_3y;
            });
            if (maxVol > 0) vol = maxVol;
        }
        if (barrier === 0 || barrier >= 100) return 0.95;
        var d = barrier / (vol * Math.sqrt(mat) / 100);
        var prob;
        if (d >= 3.0) prob = 0.95; else if (d >= 2.5) prob = 0.92;
        else if (d >= 2.0) prob = 0.88; else if (d >= 1.5) prob = 0.80;
        else if (d >= 1.2) prob = 0.72; else if (d >= 1.0) prob = 0.65;
        else if (d >= 0.8) prob = 0.58; else if (d >= 0.6) prob = 0.50;
        else if (d >= 0.4) prob = 0.40; else prob = 0.30;
        if (product.autocall) prob = Math.min(0.95, prob + 0.05);
        if (product.hasMemory) prob = Math.min(0.95, prob + 0.03);
        return prob;
    }
    window._computeCouponProbability = _computeCouponProbability;

    function _computeCorrelationPenalty(stocks) {
        if (!stocks || stocks.length <= 1) return 0;
        var found = stocks.filter(function(s) { return s.found; });
        if (found.length <= 1) return 0;
        var sectors = {};
        found.forEach(function(s) { sectors[(s.sector_api || 'Unknown').toLowerCase()] = 1; });
        var nS = Object.keys(sectors).length, nF = found.length;
        var c = nS === 1 ? 0.75 : nS >= nF ? 0.30 : 0.30 + 0.45 * (1 - nS / nF);
        return c >= 0.7 ? 5 : c >= 0.4 ? 10 : 15;
    }

    function _maturityAdjustment(matYears) {
        if (!matYears || matYears <= 0) return 0;
        if (matYears <= 3) return 5; if (matYears <= 6) return 0;
        if (matYears <= 10) return -5; return -10;
    }

    // ═══════════════════════════════════════════════════════════════
    // _localFallback — with rate product awareness
    // ═══════════════════════════════════════════════════════════════

    if (typeof _localFallback === 'function') {
        _localFallback = function(ctx) {
            var p = ctx.product, cat = ctx.cat, pf = ctx.portfolio;
            var isRate = _isRateProduct(p);
            var couponProb = _computeCouponProbability(p);
            var adjRet = p.coupon * couponProb;

            // P1
            var p1 = Math.min(100, adjRet * 10);
            if (!p.capitalProtection) p1 -= 15;
            if (p.worstOf) p1 -= Math.max(0, (p.underlyings.length - 2) * 5);
            if (p.hasMemory) p1 += 5;
            if (p.couponType === 'garanti') p1 += 15;
            p1 += _maturityAdjustment(p.maturityYears);
            p1 = Math.max(0, Math.min(100, p1));

            // P2 — rate products get specific scoring
            var p2 = 40;
            if (isRate) {
                // Rate products: no equity risk, lower vol, but duration risk
                p2 = p.capitalProtection ? 65 : 50; // Protected capital = decent quality
                if (p.maturityYears > 8) p2 -= 5; // Long duration = more rate risk
            } else if (ctx.market.available && ctx.market.worstMetrics) {
                var wm = ctx.market.worstMetrics;
                p2 = Math.min(100, Math.max(0, (wm.worst_buffett || 40) * 0.35 + (wm.worst_quality || 40) * 0.25 + Math.max(0, 100 - (wm.max_volatility || 30)) * 0.2 + Math.max(0, 80 - (wm.max_drawdown || 30)) * 0.2));
                if (ctx.market.stocks && ctx.market.stocks.length > 1) p2 -= _computeCorrelationPenalty(ctx.market.stocks);
            }
            p2 = Math.max(0, Math.min(100, p2));

            // P3
            var p3 = 70;
            if (pf.available) {
                if (pf.currentIssuerPct > 0.3) p3 -= 20;
                p3 -= (pf.overlappingUnderlyings ? pf.overlappingUnderlyings.length : 0) * 10;
            }
            if (isRate) p3 += 10; // Rate = diversification vs equity portfolio
            p3 = Math.max(0, Math.min(100, p3));

            // P4
            var spread = adjRet - (cat.bestRate || 3.0);
            var p4 = spread >= 4 ? 95 : spread >= 2.5 ? 75 : spread >= 1.5 ? 50 : spread >= 0 ? 25 : 5;

            var score = Math.round(p1 * 0.30 + p2 * 0.25 + p3 * 0.25 + p4 * 0.20);
            var grade = score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';
            return { grade: grade, score: score, killCriteria: { triggered: false, reasons: [] },
                pillars: {
                    adjustedReturn: { score: Math.round(p1), couponProbability: couponProb, couponEffective: Math.round(adjRet * 100) / 100, reasoning: 'Coupon ' + p.coupon + '% \u00d7 prob ' + Math.round(couponProb * 100) + '% = ' + adjRet.toFixed(1) + '%' + (isRate ? ' (produit de taux)' : '') },
                    underlyingQuality: { score: Math.round(p2), reasoning: isRate ? 'Produit de taux \u2014 pas de risque action, capital ' + (p.capitalProtection ? 'prot\u00e9g\u00e9' : 'non prot\u00e9g\u00e9') : (ctx.market.available ? 'March\u00e9 \u2713' : 'Pas de donn\u00e9es') },
                    portfolioFit: { score: Math.round(p3), reasoning: isRate ? 'Diversification taux vs actions' : 'Local' },
                    riskPremium: { score: Math.round(p4), spreadVsCat: Math.round(spread * 100) / 100, reasoning: 'Prime ' + adjRet.toFixed(1) + '% vs CAT ' + (cat.bestRate || 3.0) + '%' }
                },
                verdict: (isRate ? 'Produit de taux (' + (p.underlyings || []).join(', ') + '). ' : '') + 'Score ' + score + '/100 (prob coupon ' + Math.round(couponProb * 100) + '%).',
                keyRisks: isRate ? ['Risque de hausse des taux', 'Dur\u00e9e ' + (p.maturityYears || '?') + ' ans'] : [],
                negotiationPoints: [], scenarios: null };
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // Grade thresholds + normalizeResult
    // ═══════════════════════════════════════════════════════════════

    if (typeof GRADING_CONFIG !== 'undefined') {
        GRADING_CONFIG.grades.A.min = 70; GRADING_CONFIG.grades.B.min = 55;
        GRADING_CONFIG.grades.C.min = 40; GRADING_CONFIG.grades.D.min = 20;
    }
    if (typeof _normalizeResult === 'function') {
        _normalizeResult = function(raw) {
            var r = Object.assign({}, raw);
            r.score = Math.max(0, Math.min(100, parseInt(r.score) || 0));
            r.grade = r.score >= 70 ? 'A' : r.score >= 55 ? 'B' : r.score >= 40 ? 'C' : r.score >= 20 ? 'D' : 'F';
            if (r.killCriteria && r.killCriteria.triggered) { r.grade = 'F'; r.score = 0; }
            if (r.pillars) Object.keys(r.pillars).forEach(function(k) { var p = r.pillars[k]; if (p && typeof p.score === 'number') p.score = Math.max(0, Math.min(100, p.score)); });
            return r;
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SYSTEM PROMPT
    // ═══════════════════════════════════════════════════════════════

    if (typeof _buildSystemPrompt === 'function') {
        _buildSystemPrompt = function() {
            return "Tu es un analyste de produits structur\u00e9s pour une tr\u00e9sorerie d'entreprise.\nNote un produit structur\u00e9 sur 4 piliers puis attribue un grade A/B/C/D/F.\n\n## DISTINCTION : \u00c9METTEUR \u2260 SOUS-JACENT\n\u00c9METTEUR = risque CR\u00c9DIT. SOUS-JACENTS = risque MARCH\u00c9. Ne confonds JAMAIS.\n\n## PRODUITS DE TAUX (TEC, CMS, Euribor...)\nSi le sous-jacent est un INDICE DE TAUX (pas une action), adapte l'analyse :\n- P2 : pas de Buffett/Quality score. \u00c9value selon : capital prot\u00e9g\u00e9 ou non, risque de hausse des taux, volatilit\u00e9 plus faible (~10-15% vs 25-40% actions), risque de cr\u00e9dit \u00e9metteur. Capital prot\u00e9g\u00e9 = P2 60-70. Non prot\u00e9g\u00e9 = P2 40-50.\n- P3 : les produits de taux diversifient un portefeuille d'actions (+10 pts).\n- Sc\u00e9narios : raisonne en termes de niveau de taux (ex: TEC 10 \u2264 4.40% = coupon OK, TEC 10 > 4.40% = pas de coupon).\n\n## Pilier 1 \u2014 Rendement ajust\u00e9 (30%)\nUTILISE LA PROBABILIT\u00c9 FOURNIE. Score = rendement ajust\u00e9 \u00d7 10 (cap 100).\n-15 non prot\u00e9g\u00e9, -5/und worst-of >2, +5 m\u00e9moire, +15 garanti.\nMaturit\u00e9: +5 si \u22643a, 0 si 3-6a, -5 si 6-10a, -10 si >10a.\n\n## Pilier 2 \u2014 Qualit\u00e9 sous-jacent (25%)\nActions: Buffett + Quality + Vol + DD. Worst-of = PIRE. Corr\u00e9lation penalty.\nTaux: capital prot\u00e9g\u00e9=65, non prot\u00e9g\u00e9=45. Duration risk si >8a.\n\n## Pilier 3 \u2014 Fit portefeuille (25%)\nConcentration \u00e9metteur -20 si >30%. Overlap -10/doublon. +15 nouveau secteur.\n\n## Pilier 4 \u2014 Prime vs CAT (20%)\nRENDEMENT AJUST\u00c9 vs CAT (pas facial). >4%\u219290. 2.5-4%\u219270. 1.5-2.5%\u219250. 0-1.5%\u219225. <0\u21925.\n\nA\u226570, B 55-69, C 40-54, D 20-39, F <20.\nJSON valide UNIQUEMENT:\n{\"grade\":\"C\",\"score\":48,\"pillars\":{\"adjustedReturn\":{\"score\":55,\"couponEffective\":4.2,\"couponProbability\":0.60,\"reasoning\":\"...\"},\"underlyingQuality\":{\"score\":65,\"worstStock\":\"TEC10\",\"keyRisk\":\"...\",\"reasoning\":\"...\"},\"portfolioFit\":{\"score\":60,\"reasoning\":\"...\"},\"riskPremium\":{\"score\":40,\"spreadVsCat\":1.2,\"reasoning\":\"...\"}},\"verdict\":\"...\",\"keyRisks\":[\"r1\"],\"negotiationPoints\":[],\"scenarios\":{\"optimistic\":{\"return_pct\":6,\"return_eur\":6000,\"probability\":0.30,\"duration_years\":2},\"base\":{\"return_pct\":4,\"return_eur\":12000,\"probability\":0.35,\"duration_years\":5},\"stress\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.25,\"duration_years\":10},\"worst\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.10,\"duration_years\":10}}}";
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // USER PROMPT — with rate product context
    // ═══════════════════════════════════════════════════════════════

    if (typeof _buildUserPrompt === 'function') {
        var _origBuildUser = _buildUserPrompt;
        _buildUserPrompt = function(context) {
            var base = _origBuildUser(context);
            var product = context.product;
            var isRate = _isRateProduct(product);
            var cl = '\n## \u26a0 \u00c9METTEUR \u2260 SOUS-JACENT\n- \u00c9METTEUR: ' + (product.issuer || '?') + '\n- SOUS-JACENTS: ' + (product.underlyings.length > 0 ? product.underlyings.join(', ') : '?') + '\n\n';

            // Rate product context
            if (isRate) {
                var rc = _getRateContext(product);
                cl += '## \ud83d\udcca PRODUIT DE TAUX D\u00c9TECT\u00c9\n';
                cl += '- Type : ' + rc.type + '\n';
                if (rc.description) cl += '- Description : ' + rc.description + '\n';
                if (rc.currentLevel) cl += '- Niveau actuel : ' + rc.currentLevel + '\n';
                if (rc.vol) cl += '- Volatilit\u00e9 : ' + rc.vol + '\n';
                if (rc.risk) cl += '- Risque : ' + rc.risk + '\n';
                cl += '- Capital : ' + (product.capitalProtection ? 'PROT\u00c9G\u00c9 100%' : 'NON PROT\u00c9G\u00c9') + '\n';
                cl += '- PAS DE DONN\u00c9ES ACTIONS \u2014 c\'est normal, c\'est un indice de taux.\n';
                cl += '- Pour P2 : \u00e9value le risque de taux, pas le risque action.\n';
                cl += '- Pour P3 : diversification positive (+10 pts) car diff\u00e9rent des produits actions du portefeuille.\n\n';
            }

            // Coupon probability
            var couponProb = _computeCouponProbability(product);
            var adj = product.coupon * couponProb;
            cl += '## PROBABILIT\u00c9 COUPON\n';
            cl += '- Coupon: ' + product.coupon + '%, Barri\u00e8re: ' + (product.barrier || 'N/A') + ', Mat: ' + (product.maturityYears || '?') + 'a\n';
            if (isRate) cl += '- Vol estim\u00e9e: ~12% (taux), pas ~30% (actions)\n';
            cl += '- Prob: ' + Math.round(couponProb * 100) + '% \u2192 Rendement ajust\u00e9: ' + adj.toFixed(2) + '%\n';
            cl += '- UTILISE ' + adj.toFixed(2) + '% pour P4\n\n';

            // Correlation (equity only)
            if (!isRate && context.market && context.market.stocks && context.market.stocks.length > 1) {
                var fd = context.market.stocks.filter(function(s) { return s.found; });
                if (fd.length > 1) {
                    var ss = {}; fd.forEach(function(s) { ss[(s.sector_api || '?').toLowerCase()] = 1; });
                    var ns = Object.keys(ss).length;
                    cl += '## CORR\u00c9LATION WORST-OF\n- ' + fd.length + ' stocks, ' + ns + ' secteurs \u2192 ' + (ns >= fd.length ? 'FAIBLE' : ns === 1 ? '\u00c9LEV\u00c9E' : 'MOYENNE') + '\n\n';
                }
            }

            // Duration
            var my = product.maturityYears || 0;
            if (my > 0) {
                cl += '## DUR\u00c9E: ' + my + 'a, ajust P1: ' + (_maturityAdjustment(my) >= 0 ? '+' : '') + _maturityAdjustment(my) + 'pts\n';
                if (product.autocall) cl += '- Autocall \u2192 optimiste 0.5-1a\n\n';
                else cl += '- Pas autocall \u2192 bloqu\u00e9 ' + my + 'a\n\n';
            }

            var ip = base.indexOf('## DONN');
            if (ip === -1) ip = base.indexOf('## MACRO');
            if (ip > 0) return base.substring(0, ip) + cl + base.substring(ip);
            return base + cl;
        };
    }

    // ─── Clear cache + old KC4 kills ─────────────────────────────
    if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }
    setTimeout(function() {
        try {
            Object.entries(app.state && app.state.proposals || {}).forEach(function(e) {
                e[1].forEach(function(p) {
                    if (p.grading && p.grading.killCriteria && p.grading.killCriteria.triggered) {
                        var reasons = p.grading.killCriteria.reasons || [];
                        if (reasons.some(function(r) { return r.indexOf('sous-jacents d') >= 0 || r.indexOf('portefeuille') >= 0; })) {
                            delete p.grading;
                            try { app._saveProductFile(e[0], p); } catch(x) {}
                        }
                    }
                });
            });
        } catch(e) {}
    }, 3000);

    console.log('[GraderFix] v4.2 \u2014 rate product detection (TEC/CMS/Euribor) + all audit fixes');
})();

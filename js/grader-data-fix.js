// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Data Fix v4.1 — KC4 overlap → pilier Fit
// ═══════════════════════════════════════════════════════════════
// v4.1: Removes KC4 (underlying overlap) from kill criteria
//       Overlap is already penalized in Pilier 3 Fit (-10 pts/doublon)
//       Same logic as issuer concentration: penalty, not kill
// All other v4.0 audit fixes preserved (F1-F9)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function _stripAccents(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

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

    // ─── Extended aliases + accent matching ──────────────────────
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
            // F9: Buffett fallback = 40
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
    // KILL CRITERIA — F7 fix + KC4 REMOVED (overlap → pilier Fit)
    // ═══════════════════════════════════════════════════════════════
    // Only 3 kill criteria remain:
    //   KC1: worst-of > 5 underlyings
    //   KC2: barrier too shallow without capital protection (sign fixed)
    //   KC3: negative adjusted risk premium vs CAT
    //   KC5: maturity >12Y without protection
    // REMOVED: KC4 (underlying overlap) — now penalized in Pilier 3 (-10 pts/doublon)

    if (typeof _checkKillCriteria === 'function') {
        _checkKillCriteria = function(product, pfCtx, catBench) {
            var kc = GRADING_CONFIG.killCriteria, reasons = [];

            // KC1: Too many worst-of underlyings
            if (product.worstOf && product.underlyings.length > kc.maxWorstOfUnderlyings)
                reasons.push('Worst-of sur ' + product.underlyings.length + ' sous-jacents (max: ' + kc.maxWorstOfUnderlyings + ')');

            // KC2: FIXED — barrier too shallow without capital protection
            if (!product.capitalProtection && product.barrier !== 0) {
                var absBarrier = Math.abs(product.barrier);
                var absThreshold = Math.abs(kc.minBarrierWithoutProtection);
                if (absBarrier < absThreshold) {
                    reasons.push('Barri\u00e8re -' + absBarrier + '% sans protection capital (min: -' + absThreshold + '%)');
                }
            }

            // KC3: Negative adjusted risk premium vs CAT
            var bestCat = catBench.bestRate || 3.0;
            var couponProb = _computeCouponProbability(product);
            var adjustedReturn = product.coupon * couponProb;
            if (product.coupon > 0 && (adjustedReturn - bestCat) < kc.minRiskPremiumVsCat) {
                reasons.push('Prime ajust\u00e9e vs CAT n\u00e9gative: rendement ' + adjustedReturn.toFixed(1) + '% (coupon ' + product.coupon + '% \u00d7 prob ' + Math.round(couponProb * 100) + '%) vs CAT ' + bestCat + '%');
            }

            // KC4: REMOVED — underlying overlap is now a PENALTY in Pilier 3 Fit
            // (-10 pts per overlapping underlying, same approach as issuer concentration)
            // This allows full analysis even when some underlyings are already in portfolio

            // KC5: Excessive maturity without protection
            if (product.maturityYears > 12 && !product.capitalProtection) {
                reasons.push('Maturit\u00e9 ' + product.maturityYears + ' ans sans protection capital');
            }

            return { killed: reasons.length > 0, reasons: reasons };
        };
        if (window.ProposalGrader) window.ProposalGrader.checkKillCriteria = _checkKillCriteria;
    }

    // Also remove maxSameUnderlying from config so it's not used elsewhere
    if (typeof GRADING_CONFIG !== 'undefined' && GRADING_CONFIG.killCriteria) {
        delete GRADING_CONFIG.killCriteria.maxSameUnderlying;
    }

    // ═══════════════════════════════════════════════════════════════
    // F1 — Quantitative coupon probability model
    // ═══════════════════════════════════════════════════════════════

    function _computeCouponProbability(product) {
        var barrier = Math.abs(product.barrier || 0);
        var vol = 30;
        var mat = product.maturityYears || 3;
        if (_mktCache && product.underlyings && product.underlyings.length > 0) {
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
        if (d >= 3.0) prob = 0.95;
        else if (d >= 2.5) prob = 0.92;
        else if (d >= 2.0) prob = 0.88;
        else if (d >= 1.5) prob = 0.80;
        else if (d >= 1.2) prob = 0.72;
        else if (d >= 1.0) prob = 0.65;
        else if (d >= 0.8) prob = 0.58;
        else if (d >= 0.6) prob = 0.50;
        else if (d >= 0.4) prob = 0.40;
        else prob = 0.30;
        if (product.autocall) prob = Math.min(0.95, prob + 0.05);
        if (product.hasMemory) prob = Math.min(0.95, prob + 0.03);
        return prob;
    }
    window._computeCouponProbability = _computeCouponProbability;

    // ═══════════════════════════════════════════════════════════════
    // F2 — Worst-of correlation penalty
    // ═══════════════════════════════════════════════════════════════

    function _computeCorrelationPenalty(stocks) {
        if (!stocks || stocks.length <= 1) return 0;
        var found = stocks.filter(function(s) { return s.found; });
        if (found.length <= 1) return 0;
        var sectors = {};
        found.forEach(function(s) { sectors[(s.sector_api || 'Unknown').toLowerCase()] = (sectors[(s.sector_api || 'Unknown').toLowerCase()] || 0) + 1; });
        var nSectors = Object.keys(sectors).length, nStocks = found.length;
        var avgCorr;
        if (nSectors === 1) avgCorr = 0.75;
        else if (nSectors === 2 && nStocks <= 3) avgCorr = 0.55;
        else if (nSectors >= nStocks) avgCorr = 0.30;
        else avgCorr = 0.30 + 0.45 * (1 - nSectors / nStocks);
        return avgCorr >= 0.7 ? 5 : avgCorr >= 0.4 ? 10 : 15;
    }

    // F8 — Maturity adjustment
    function _maturityAdjustment(matYears) {
        if (!matYears || matYears <= 0) return 0;
        if (matYears <= 3) return 5;
        if (matYears <= 6) return 0;
        if (matYears <= 10) return -5;
        return -10;
    }

    // ═══════════════════════════════════════════════════════════════
    // PATCH _localFallback — F1, F2, F4, F8, F9
    // ═══════════════════════════════════════════════════════════════

    if (typeof _localFallback === 'function') {
        _localFallback = function(ctx) {
            var p = ctx.product, cat = ctx.cat, pf = ctx.portfolio;
            var couponProb = _computeCouponProbability(p);
            var adjustedReturn = p.coupon * couponProb;
            var p1 = Math.min(100, adjustedReturn * 10);
            if (!p.capitalProtection) p1 -= 15;
            if (p.worstOf) p1 -= Math.max(0, (p.underlyings.length - 2) * 5);
            if (p.hasMemory) p1 += 5;
            if (p.couponType === 'garanti') p1 += 15;
            p1 += _maturityAdjustment(p.maturityYears);
            p1 = Math.max(0, Math.min(100, p1));

            var p2 = 40;
            if (ctx.market.available && ctx.market.worstMetrics) {
                var wm = ctx.market.worstMetrics;
                p2 = Math.min(100, Math.max(0, (wm.worst_buffett || 40) * 0.35 + (wm.worst_quality || 40) * 0.25 + Math.max(0, 100 - (wm.max_volatility || 30)) * 0.2 + Math.max(0, 80 - (wm.max_drawdown || 30)) * 0.2));
                if (ctx.market.stocks && ctx.market.stocks.length > 1) p2 -= _computeCorrelationPenalty(ctx.market.stocks);
            }
            p2 = Math.max(0, Math.min(100, p2));

            var p3 = 70;
            if (pf.available) {
                if (pf.currentIssuerPct > 0.3) p3 -= 20;
                p3 -= (pf.overlappingUnderlyings ? pf.overlappingUnderlyings.length : 0) * 10;
            }
            p3 = Math.max(0, Math.min(100, p3));

            var spread = adjustedReturn - (cat.bestRate || 3.0);
            var p4 = spread >= 4 ? 95 : spread >= 2.5 ? 75 : spread >= 1.5 ? 50 : spread >= 0 ? 25 : 5;

            var score = Math.round(p1 * 0.30 + p2 * 0.25 + p3 * 0.25 + p4 * 0.20);
            var grade = score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';
            return { grade: grade, score: score, killCriteria: { triggered: false, reasons: [] },
                pillars: {
                    adjustedReturn: { score: Math.round(p1), couponProbability: couponProb, couponEffective: Math.round(adjustedReturn * 100) / 100, reasoning: 'Coupon ' + p.coupon + '% \u00d7 prob ' + Math.round(couponProb * 100) + '% = ' + adjustedReturn.toFixed(1) + '%' },
                    underlyingQuality: { score: Math.round(p2), reasoning: ctx.market.available ? 'March\u00e9 \u2713' : 'Pas de donn\u00e9es' },
                    portfolioFit: { score: Math.round(p3), reasoning: 'Local' },
                    riskPremium: { score: Math.round(p4), spreadVsCat: Math.round(spread * 100) / 100, reasoning: 'Prime ' + adjustedReturn.toFixed(1) + '% vs CAT ' + (cat.bestRate || 3.0) + '%' }
                },
                verdict: 'Score local ' + score + '/100 (prob coupon ' + Math.round(couponProb * 100) + '%).',
                keyRisks: [], negotiationPoints: [], scenarios: null };
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // RECALIBRATE GRADES + _normalizeResult
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
    // SYSTEM PROMPT + USER PROMPT
    // ═══════════════════════════════════════════════════════════════

    if (typeof _buildSystemPrompt === 'function') {
        _buildSystemPrompt = function() {
            return "Tu es un analyste de produits structur\u00e9s pour une tr\u00e9sorerie d'entreprise.\nNote un produit structur\u00e9 sur 4 piliers puis attribue un grade A/B/C/D/F.\n\n## DISTINCTION CRITIQUE : \u00c9METTEUR \u2260 SOUS-JACENT\nL'\u00c9METTEUR = risque CR\u00c9DIT (contrepartie). Les SOUS-JACENTS = risque MARCH\u00c9.\nNe confonds JAMAIS les deux.\n\n## Pilier 1 \u2014 Rendement ajust\u00e9 (30%)\nUTILISE LA PROBABILIT\u00c9 DE COUPON FOURNIE. Rendement ajust\u00e9 = coupon \u00d7 probabilit\u00e9.\nScore = rendement ajust\u00e9 \u00d7 10 (cap\u00e9 100). -15 non prot\u00e9g\u00e9, -5/und worst-of >2, +5 m\u00e9moire, +15 garanti.\nMaturit\u00e9: +5 si \u22643a, 0 si 3-6a, -5 si 6-10a, -10 si >10a.\n\n## Pilier 2 \u2014 Qualit\u00e9 sous-jacent (25%)\nBuffett + Quality score. Vol, Max DD, Beta. Worst-of = PIRE du panier.\nP\u00c9NALIT\u00c9 CORR\u00c9LATION worst-of: secteurs diff\u00e9rents = -10 \u00e0 -15 pts. M\u00eame secteur = -5 pts.\nBuffett absent = 40/100.\n\n## Pilier 3 \u2014 Fit portefeuille (25%)\nConcentration \u00e9metteur -20 si >30%. Type -15 si >60%. Overlap sous-jacents -10/doublon. +15 nouveau secteur.\n\n## Pilier 4 \u2014 Prime vs CAT (20%)\nCompare RENDEMENT AJUST\u00c9 (pas facial) au CAT. >4%\u219290-100. 2.5-4%\u219270-89. 1.5-2.5%\u219240-69. 0-1.5%\u219210-39. <0\u21920.\n\nScore = P1\u00d70.30 + P2\u00d70.25 + P3\u00d70.25 + P4\u00d70.20. A\u226570, B 55-69, C 40-54, D 20-39, F <20.\n\nSC\u00c9NARIOS: MONTANT NOMINAL + DUR\u00c9E. return_pct = ANNUALIS\u00c9.\nVERDICT: 3-4 phrases, donn\u00e9es concr\u00e8tes, mentionne probabilit\u00e9 coupon.\n\nJSON valide UNIQUEMENT:\n{\"grade\":\"C\",\"score\":48,\"pillars\":{\"adjustedReturn\":{\"score\":55,\"couponEffective\":4.2,\"couponProbability\":0.60,\"reasoning\":\"...\"},\"underlyingQuality\":{\"score\":65,\"worstStock\":\"EL\",\"keyRisk\":\"...\",\"reasoning\":\"...\"},\"portfolioFit\":{\"score\":30,\"issuerOverlap\":true,\"diversificationBenefit\":false,\"reasoning\":\"...\"},\"riskPremium\":{\"score\":40,\"spreadVsCat\":1.2,\"catBenchmark\":3.0,\"reasoning\":\"...\"}},\"verdict\":\"...\",\"keyRisks\":[\"r1\"],\"negotiationPoints\":[\"p1\"],\"scenarios\":{\"optimistic\":{\"return_pct\":7,\"return_eur\":4200,\"probability\":0.20,\"duration_years\":1},\"base\":{\"return_pct\":5,\"return_eur\":6000,\"probability\":0.30,\"duration_years\":3},\"stress\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.30,\"duration_years\":6},\"worst\":{\"return_pct\":-8,\"return_eur\":-12000,\"probability\":0.20,\"duration_years\":6}}}";
        };
    }

    if (typeof _buildUserPrompt === 'function') {
        var _origBuildUser = _buildUserPrompt;
        _buildUserPrompt = function(context) {
            var base = _origBuildUser(context);
            var product = context.product;
            var cl = '\n## \u26a0 \u00c9METTEUR \u2260 SOUS-JACENT\n- \u00c9METTEUR: ' + (product.issuer || '?') + '\n- SOUS-JACENTS: ' + (product.underlyings.length > 0 ? product.underlyings.join(', ') : '?') + '\n\n';
            var couponProb = _computeCouponProbability(product);
            var adj = product.coupon * couponProb;
            cl += '## PROBABILIT\u00c9 COUPON\n- Coupon: ' + product.coupon + '%, Barri\u00e8re: ' + product.barrier + '%, Mat: ' + (product.maturityYears || '?') + 'a\n';
            cl += '- Prob: ' + Math.round(couponProb * 100) + '% \u2192 Rendement ajust\u00e9: ' + adj.toFixed(2) + '%\n';
            cl += '- UTILISE ' + adj.toFixed(2) + '% pour P4 (pas ' + product.coupon + '%)\n\n';
            if (context.market && context.market.stocks && context.market.stocks.length > 1) {
                var fd = context.market.stocks.filter(function(s) { return s.found; });
                if (fd.length > 1) {
                    var ss = {}; fd.forEach(function(s) { ss[(s.sector_api || '?').toLowerCase()] = 1; });
                    var ns = Object.keys(ss).length;
                    cl += '## CORR\u00c9LATION WORST-OF\n- ' + fd.length + ' stocks, ' + ns + ' secteurs \u2192 corr ' + (ns >= fd.length ? 'FAIBLE' : ns === 1 ? '\u00c9LEV\u00c9E' : 'MOYENNE') + '\n\n';
                }
            }
            var my = product.maturityYears || 0;
            if (my > 0) {
                cl += '## DUR\u00c9E: ' + my + 'a, ajust P1: ' + (_maturityAdjustment(my) >= 0 ? '+' : '') + _maturityAdjustment(my) + 'pts\n';
                if (product.autocall) cl += '- Autocall \u2192 optimiste 0.5-1a, base ' + Math.round(my * 0.5) + '-' + Math.round(my * 0.7) + 'a\n\n';
                else cl += '- Pas autocall \u2192 bloqu\u00e9 ' + my + 'a\n\n';
            }
            var ip = base.indexOf('## DONN');
            if (ip === -1) ip = base.indexOf('## MACRO');
            if (ip > 0) return base.substring(0, ip) + cl + base.substring(ip);
            return base + cl;
        };
    }

    // ─── Clear old kill gradings + cache ──────────────────────────
    if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }

    // Clear any F grades caused by old KC4 (underlying overlap)
    setTimeout(function() {
        try {
            var proposals = Object.entries(app.state && app.state.proposals || {});
            proposals.forEach(function(entry) {
                var bankId = entry[0], prods = entry[1];
                prods.forEach(function(p) {
                    if (p.grading && p.grading.killCriteria && p.grading.killCriteria.triggered) {
                        var reasons = p.grading.killCriteria.reasons || [];
                        if (reasons.some(function(r) { return r.indexOf('sous-jacents d') >= 0 || r.indexOf('portefeuille') >= 0; })) {
                            delete p.grading;
                            try { app._saveProductFile(bankId, p); } catch(e) {}
                            console.log('[GraderFix] Cleared KC4 kill for:', p.name);
                        }
                    }
                });
            });
        } catch(e) {}
    }, 3000);

    console.log('[GraderFix] v4.1 \u2014 KC4 overlap removed from kill (now Fit penalty)');
})();

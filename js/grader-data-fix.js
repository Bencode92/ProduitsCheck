// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Data Fix v3.0
// ═══════════════════════════════════════════════════════════════
// FIX 1: JSON.parse safety for large files
// FIX 2: Accent-insensitive stock matching + extended aliases
// FIX 3: Prompt: issuer ≠ underlying + duration-based scenarios
// Load AFTER proposal-grader.js, BEFORE grader-ui-patch.js
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function _stripAccents(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // ─── FIX 1: JSON.parse safety ────────────────────────────────
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

    // ─── FIX 2: Extended aliases + accent matching ───────────────

    var EXTRA_ALIASES = {
        'CREDIT AGRICOLE': 'ACA', 'CRÉDIT AGRICOLE': 'ACA', 'CA': 'ACA',
        'SOCIETE GENERALE': 'GLE', 'SOCIÉTÉ GÉNÉRALE': 'GLE', 'SOCGEN': 'GLE', 'SG': 'GLE',
        'BNP PARIBAS': 'BNP', 'BNPP': 'BNP',
        'SAINT GOBAIN': 'SGO', 'SAINT-GOBAIN': 'SGO',
        'SCHNEIDER ELECTRIC': 'SU',
        'AIR LIQUIDE': 'AI', 'CAPGEMINI': 'CAP',
        'HERMES': 'RMS', 'HERMÈS': 'RMS',
        'KERING': 'KER', 'ORANGE': 'ORA', 'VEOLIA': 'VIE',
        'BOUYGUES': 'EN', 'MICHELIN': 'ML', 'RENAULT': 'RNO',
        'STELLANTIS': 'STLAP', 'UNIBAIL': 'URW',
        'VOLKSWAGEN': 'VOW3', 'VW': 'VOW3',
        'SIEMENS': 'SIE', 'SAP': 'SAP', 'ADIDAS': 'ADS',
        'BAYER': 'BAYN', 'BASF': 'BAS', 'ALLIANZ': 'ALV',
        'DEUTSCHE BANK': 'DBK', 'BMW': 'BMW', 'MERCEDES': 'MBG',
        'NESTLE': 'NESN', 'NESTLÉ': 'NESN', 'NOVARTIS': 'NOVN', 'ROCHE': 'ROG',
        'UBS': 'UBSG', 'ABB': 'ABBN',
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

    // Fuzzy second pass in _extractStockData
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
                    console.log('[GraderFix] Fuzzy:', s.name, '→', match.ticker, match.name);
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

    // ─── FIX 3: Patch prompts — issuer ≠ underlying + duration ──

    if (typeof _buildSystemPrompt === 'function') {
        _buildSystemPrompt = function() {
            return "Tu es un analyste de produits structurés pour une trésorerie d'entreprise.\nNote un produit structuré sur 4 piliers puis attribue un grade A/B/C/D/F.\n\n## DISTINCTION CRITIQUE : ÉMETTEUR ≠ SOUS-JACENT\nL'ÉMETTEUR (ex: Swiss Life, CIC, Natixis) est la banque qui structure et garantit le produit. C'est un risque CRÉDIT (contrepartie).\nLes SOUS-JACENTS (ex: ASML, LVMH, Crédit Agricole) sont les actions/indices dont dépend le coupon et la protection capital. C'est un risque MARCHÉ.\nNe confonds JAMAIS les deux. L'émetteur n'est PAS un sous-jacent. Si l'émetteur est aussi un sous-jacent (rare), mentionne-le explicitement.\n\n## Pilier 1 — Rendement ajusté au risque (30%)\nScore /100. Coupon facial × probabilité de versement (distance barrière + volatilité). -15 si capital non protégé. -5/sous-jacent au-delà de 2 en worst-of. +5 mémoire, +15 garanti.\n\n## Pilier 2 — Qualité sous-jacent (25%)\nScore /100 basé sur données marché RÉELLES. Buffett score + Quality score (poids principal). Vol 3Y, Max Drawdown 3Y, Beta. ROE, dette/equity, marge nette. Worst-of = note du PIRE. Intègre contexte sectoriel et macro.\nATTENTION : utilise UNIQUEMENT les données fournies pour chaque sous-jacent. Ne confonds pas le secteur de l'émetteur avec celui du sous-jacent.\n\n## Pilier 3 — Fit portefeuille (25%)\nScore /100. Concentration ÉMETTEUR -20 pts si >30% du book (risque crédit). Concentration type produit -15 pts si >60%. Overlap sous-jacents -10 pts/doublon. Diversification +15 pts si nouveau secteur/géo.\n\n## Pilier 4 — Prime vs CAT (20%)\nScore /100. Prime > 4% → 90-100. 2.5-4% → 70-89. 1.5-2.5% → 40-69. 0-1.5% → 10-39. <0 → 0.\n\nScore = P1×0.30 + P2×0.25 + P3×0.25 + P4×0.20. A ≥ 75, B 60-74, C 45-59, D 25-44, F < 25.\n\n## SCÉNARIOS (INTÈGRE LA DURÉE)\n4 scénarios avec return_eur basé sur le MONTANT NOMINAL :\n- Optimiste : autocall rapide (S1-S2 si autocall, sinon coupons max sur durée courte). Indique la durée estimée.\n- Base : coupons partiels sur 50-70% de la maturité, puis autocall ou maturité. Durée = 50-70% × maturité.\n- Stress : pas de coupons, capital remboursé à maturité (0% sur durée totale). Durée = 100% maturité.\n- Worst : barrière touchée à maturité, perte proportionnelle au niveau du sous-jacent. Durée = 100% maturité.\nPour chaque scénario, le return_pct est le rendement ANNUALISÉ, pas le rendement total.\n\n## VERDICT\nParagraphe de 3-4 phrases justifiant la note. Mentionne les données concrètes (Buffett score, vol, secteur). Distingue clairement risque émetteur (crédit) et risque sous-jacent (marché).\n\nRÉPONDS en JSON valide UNIQUEMENT (pas de backticks) :\n{\"grade\":\"C\",\"score\":48,\"pillars\":{\"adjustedReturn\":{\"score\":55,\"couponEffective\":4.2,\"couponProbability\":0.60,\"reasoning\":\"...\"},\"underlyingQuality\":{\"score\":65,\"worstStock\":\"EL\",\"keyRisk\":\"...\",\"reasoning\":\"...\"},\"portfolioFit\":{\"score\":30,\"issuerOverlap\":true,\"diversificationBenefit\":false,\"reasoning\":\"...\"},\"riskPremium\":{\"score\":40,\"spreadVsCat\":1.2,\"catBenchmark\":3.0,\"reasoning\":\"...\"}},\"verdict\":\"Paragraphe 3-4 phrases...\",\"keyRisks\":[\"r1\",\"r2\"],\"negotiationPoints\":[\"p1\"],\"scenarios\":{\"optimistic\":{\"return_pct\":7,\"return_eur\":4200,\"probability\":0.20,\"duration_years\":1},\"base\":{\"return_pct\":5,\"return_eur\":6000,\"probability\":0.30,\"duration_years\":3},\"stress\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.30,\"duration_years\":6},\"worst\":{\"return_pct\":-8,\"return_eur\":-12000,\"probability\":0.20,\"duration_years\":6}}}";
        };
    }

    // Patch user prompt to add issuer clarification + duration
    if (typeof _buildUserPrompt === 'function') {
        var _origBuildUser = _buildUserPrompt;
        _buildUserPrompt = function(context) {
            var base = _origBuildUser(context);
            var product = context.product;

            // Add issuer ≠ underlying clarification at the top
            var clarification = '\n## ⚠ RAPPEL : ÉMETTEUR ≠ SOUS-JACENT\n';
            clarification += '- ÉMETTEUR (risque crédit) : ' + (product.issuer || 'inconnu') + '\n';
            clarification += '- SOUS-JACENTS (risque marché) : ' + (product.underlyings.length > 0 ? product.underlyings.join(', ') : 'aucun identifié') + '\n';
            clarification += 'Analyse le risque marché sur les SOUS-JACENTS, pas sur l\'émetteur.\n';

            // Add duration info for scenarios
            var matYears = product.maturityYears || 0;
            if (matYears > 0) {
                clarification += '\n## DURÉE POUR SCÉNARIOS\n';
                clarification += '- Maturité : ' + matYears + ' ans\n';
                if (product.autocall) {
                    var freq = product.couponFrequency || 'semestriel';
                    clarification += '- Autocall : Oui (' + freq + ') → scénario optimiste = sortie rapide (0.5-1 an)\n';
                    clarification += '- Scénario base : coupons partiels + autocall tardif (~' + Math.round(matYears * 0.5) + '-' + Math.round(matYears * 0.7) + ' ans)\n';
                } else {
                    clarification += '- Autocall : Non → capital bloqué ' + matYears + ' ans\n';
                    clarification += '- Scénario optimiste : coupons max sur ' + matYears + ' ans\n';
                }
                clarification += '- Scénarios stress/worst : durée complète ' + matYears + ' ans\n';
                clarification += '- return_pct dans les scénarios = rendement ANNUALISÉ (pas total)\n';
            }

            // Insert after the product JSON block
            var insertPoint = base.indexOf('## DONNÉES');
            if (insertPoint === -1) insertPoint = base.indexOf('## DONN');
            if (insertPoint === -1) insertPoint = base.indexOf('## MACRO');
            if (insertPoint > 0) {
                return base.substring(0, insertPoint) + clarification + '\n' + base.substring(insertPoint);
            }
            return base + clarification;
        };
    }

    // ─── Clear cache ─────────────────────────────────────────────
    if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }

    console.log('[GraderFix] v3.0 — issuer≠underlying + duration scenarios + accent matching');
})();

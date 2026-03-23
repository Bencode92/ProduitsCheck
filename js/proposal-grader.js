// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Proposal Grader v1.0
// ═══════════════════════════════════════════════════════════════
// Grading unifié des propositions de produits structurés.
// Remplace : scoring.js (score/100) + proposal-ai.js (catégorisation)
//          + deep-analysis.js (risque/10 + scénarios) + compatibilité (ui-patches.js)
//
// Pipeline : PDF → extraction → contexte (marché + portefeuille + CAT) → 1 appel Claude → Grade A-F
//
// Dépendances : config.js (CONFIG, BANKS), github.js (github), app.js (app.state)
// ═══════════════════════════════════════════════════════════════

// ─── 1. CONFIGURATION DU GRADING ────────────────────────────

const GRADING_CONFIG = {
    // Pondérations des 4 piliers (total = 100%)
    weights: {
        adjustedReturn: 0.30,   // Rendement ajusté au risque
        underlyingQuality: 0.25, // Qualité sous-jacent (données marché)
        portfolioFit: 0.25,     // Fit portefeuille (concentration, diversification)
        riskPremium: 0.20       // Prime vs CAT sans risque
    },

    // Seuils de grade
    grades: {
        A: { min: 75, label: 'Intégrer',  color: '#06D6A0', action: 'integrate'  },
        B: { min: 60, label: 'Intégrer',  color: '#4ECDC4', action: 'integrate'  },
        C: { min: 45, label: 'Négocier',  color: '#FFB627', action: 'negotiate'  },
        D: { min: 25, label: 'Rejeter',   color: '#E85D04', action: 'reject'     },
        F: { min: 0,  label: 'Rejeter',   color: '#EF233C', action: 'reject'     }
    },

    // Kill criteria → Grade F automatique, peu importe le score
    killCriteria: {
        maxWorstOfUnderlyings: 5,       // > 5 sous-jacents worst-of
        minBarrierWithoutProtection: -50, // Barrière > -50% sans protection capital
        maxIssuerConcentration: 0.40,    // Émetteur déjà > 40% du book
        minRiskPremiumVsCat: 0,          // Prime vs CAT négative
        maxSameUnderlying: 1             // Même sous-jacent déjà en worst-of existant
    },

    // Seuils pour le pilier "Prime vs CAT"
    riskPremium: {
        excellent: 4.0,
        good: 2.5,
        minimum: 1.5,
        insufficient: 0
    }
};

// ─── 2. NORMALISATION PRODUIT ────────────────────────────────
// Les produits viennent du parsing PDF (aiParsed) avec des structures
// imbriquées : coupon.rate, capitalProtection.barrier, etc.
// On normalise en structure plate pour le grading.

function _graderNormalize(product) {
    const p = product || {};
    const ai = p.aiParsed || {};

    // Coupon : peut être un objet {rate, frequency, type, memory} ou un number
    const couponObj = p.coupon || ai.coupon || {};
    const couponRate = typeof couponObj === 'number' ? couponObj
        : parseFloat(couponObj.rate || couponObj.annualized || couponObj.taux) || 0;

    // Capital protection / barrier
    const protObj = p.capitalProtection || ai.capitalProtection || {};
    const barrier = parseFloat(protObj.barrier || protObj.barriere || p.barrier) || 0;

    // Autocall / early redemption
    const autoObj = p.earlyRedemption || ai.earlyRedemption || {};
    const hasAutocall = !!(autoObj.enabled || autoObj.hasAutocall || p.autocall);
    const autocallThreshold = parseFloat(autoObj.threshold || autoObj.seuil || p.autocallThreshold) || 100;

    // Sous-jacents : array of strings or objects
    const rawUnds = p.underlyings || ai.underlyings || [];
    const underlyings = _normalizeUnderlyings(rawUnds);

    // Émetteur : bankId → bank name
    const bankId = p.bankId || '';
    const bankConfig = (typeof BANKS !== 'undefined') ? BANKS.find(b => b.id === bankId) : null;
    const issuer = bankConfig ? bankConfig.name : (p.issuer || p.emetteur || bankId);

    return {
        name: p.name || ai.name || 'Inconnu',
        issuer,
        bankId,
        type: p.type || ai.type || '',
        coupon: couponRate,
        couponFrequency: couponObj.frequency || couponObj.frequence || 'annuel',
        couponType: couponObj.type || (couponObj.conditional ? 'conditionnel' : 'garanti'),
        hasMemory: !!(couponObj.memory || couponObj.memoire),
        barrier,
        barrierType: protObj.type || protObj.barrierType || 'européenne',
        capitalProtection: !!(protObj.guaranteed || protObj.garanti || protObj.full),
        maturity: p.maturity || ai.maturity || '',
        maturityYears: parseFloat(p.maturityYears || ai.maturityYears) || 0,
        autocall: hasAutocall,
        autocallThreshold,
        underlyings,
        worstOf: underlyings.length > 1,
        nominal: parseFloat(p.investedAmount || p.nominal || p.montant) || 0
    };
}

function _normalizeUnderlyings(underlyings) {
    if (typeof underlyings === 'string') {
        return underlyings.split(/[,;/]/).map(u => u.trim()).filter(Boolean);
    }
    if (Array.isArray(underlyings)) {
        return underlyings.map(u =>
            typeof u === 'string' ? u.trim() : (u.name || u.ticker || u.isin || '')
        ).filter(Boolean);
    }
    return [];
}

// ─── 3. COLLECTE DU CONTEXTE ─────────────────────────────────

async function _collectGradingContext(product) {
    const context = {
        product: _graderNormalize(product),
        market: { available: false },
        portfolio: { available: false, totalProducts: 0, totalAmount: 0 },
        cat: { bestRate: 3.0, source: 'fallback' }
    };

    // --- Données marché (index léger) ---
    try {
        const marketIndex = await _loadMarketIndex();
        if (marketIndex) {
            context.market = _extractMarketData(context.product, marketIndex);
        }
    } catch (e) {
        console.warn('[Grader] Données marché indisponibles:', e.message);
    }

    // --- Portefeuille existant ---
    try {
        const portfolio = app.state.portfolio || [];
        if (portfolio.length > 0) {
            context.portfolio = _analyzePortfolioContext(context.product, portfolio);
        }
    } catch (e) {
        console.warn('[Grader] Portefeuille indisponible:', e.message);
    }

    // --- Benchmark CAT ---
    try {
        context.cat = await _loadCatBenchmark();
    } catch (e) {
        console.warn('[Grader] Données CAT indisponibles:', e.message);
    }

    return context;
}

// ─── 4. DONNÉES MARCHÉ ───────────────────────────────────────

let _marketIndexCache = null;
let _marketIndexCacheTs = 0;

async function _loadMarketIndex() {
    if (_marketIndexCache && _marketIndexCacheTs > Date.now() - 3600000) {
        return _marketIndexCache;
    }
    const data = await github.readFile('data/market/index.json');
    if (data) {
        _marketIndexCache = data;
        _marketIndexCacheTs = Date.now();
    }
    return data;
}

function _extractMarketData(product, marketIndex) {
    const result = {
        available: true,
        stocks: [],
        worstMetrics: null,
        indexContext: null
    };

    const allStocks = [
        ...(marketIndex.stocks_europe || []),
        ...(marketIndex.stocks_us || [])
    ];

    for (const underlying of product.underlyings) {
        const ticker = _resolveAlias(underlying);
        const stock = allStocks.find(s =>
            s.ticker === ticker ||
            s.ticker === underlying.toUpperCase() ||
            (s.name && s.name.toUpperCase().includes(underlying.toUpperCase()))
        );

        if (stock) {
            result.stocks.push({
                name: underlying,
                ticker: stock.ticker,
                price: stock.price,
                change_pct: stock.change_pct,
                perf_ytd: stock.perf_ytd,
                perf_1y: stock.perf_1y,
                perf_3y: stock.perf_3y,
                beta: stock.beta,
                volatility_3y: stock.volatility_3y,
                max_dd_3y: stock.max_dd_3y,
                distance_52w_high: stock.distance_52w_high,
                pe_ratio: stock.pe_ratio,
                roe: stock.roe,
                de_ratio: stock.de_ratio,
                net_margin: stock.net_margin,
                fcf_yield: stock.fcf_yield,
                dividend_yield: stock.dividend_yield,
                buffett_score: stock.buffett_score,
                buffett_grade: stock.buffett_grade,
                quality_score: stock.quality_score,
                quality_subscores: stock.quality_subscores,
                sector: stock.sector,
                country: stock.country
            });
        } else {
            result.stocks.push({ name: underlying, ticker, available: false });
        }
    }

    // Worst-of metrics (pire du panier)
    if (result.stocks.length > 1) {
        const avail = result.stocks.filter(s => s.available !== false);
        if (avail.length > 0) {
            result.worstMetrics = {
                worst_buffett: Math.min(...avail.map(s => s.buffett_score || 100)),
                worst_quality: Math.min(...avail.map(s => s.quality_score || 100)),
                worst_perf_1y: Math.min(...avail.map(s => s.perf_1y || 0)),
                max_volatility: Math.max(...avail.map(s => s.volatility_3y || 0)),
                max_drawdown: Math.min(...avail.map(s => s.max_dd_3y || 0)),
                max_beta: Math.max(...avail.map(s => s.beta || 1)),
                worst_name: avail.reduce((w, s) =>
                    (s.buffett_score || 100) < (w.buffett_score || 100) ? s : w
                ).name
            };
        }
    }

    // Indices de contexte
    const indices = marketIndex.markets || marketIndex.indices || [];
    result.indexContext = {
        eurozone: indices.find(i => i.ticker === 'FEZ') || null,
        france: indices.find(i => i.ticker === 'EWQ') || null,
        italy: indices.find(i => i.ticker === 'EWI') || null,
        us: indices.find(i => i.ticker === 'SPY') || null
    };

    return result;
}

function _resolveAlias(name) {
    const COMMON_ALIASES = {
        'DANONE': 'BN', 'ENI': 'ENI', 'TOTALENERGIES': 'TTE', 'TOTAL': 'TTE',
        'LVMH': 'MC', 'SCHNEIDER': 'SU', 'ASML': 'ASML', 'TESLA': 'TSLA',
        'ESTEE LAUDER': 'EL', 'PHILIP MORRIS': 'MO', 'FASTENAL': 'FAST',
        'PERNOD RICARD': 'RI', 'BNP': 'BNP', 'SOCIETE GENERALE': 'GLE',
        'AXA': 'CS', 'SANOFI': 'SAN', 'AIR LIQUIDE': 'AI',
        'EUROSTOXX 50': 'FEZ', 'EUROSTOXX': 'FEZ', 'CAC 40': 'EWQ',
        'S&P 500': 'SPY', 'NASDAQ': 'QQQ', 'NIKKEI': 'EWJ'
    };
    if (typeof BANK_ALIASES !== 'undefined' && BANK_ALIASES[name.toUpperCase()]) {
        return BANK_ALIASES[name.toUpperCase()];
    }
    return COMMON_ALIASES[name.toUpperCase()] || name.toUpperCase();
}

// ─── 5. ANALYSE PORTEFEUILLE ─────────────────────────────────

function _analyzePortfolioContext(product, portfolio) {
    const products = portfolio || [];
    const totalAmount = products.reduce((sum, pr) =>
        sum + (parseFloat(pr.investedAmount || pr.nominal || pr.montant) || 0), 0
    );

    // Concentration par émetteur (via bankId)
    const issuerAmounts = {};
    products.forEach(pr => {
        const iss = (pr.bankId || 'inconnu').toUpperCase();
        issuerAmounts[iss] = (issuerAmounts[iss] || 0) +
            (parseFloat(pr.investedAmount || pr.nominal) || 0);
    });
    const issuerConcentration = {};
    Object.entries(issuerAmounts).forEach(([iss, amount]) => {
        issuerConcentration[iss] = totalAmount > 0 ? amount / totalAmount : 0;
    });

    // Concentration par type
    const typeCounts = {};
    products.forEach(pr => {
        const type = (pr.type || 'autre').toUpperCase();
        typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    // Sous-jacents déjà en portefeuille
    const existingUnderlyings = new Set();
    products.forEach(pr => {
        const unds = pr.underlyings || (pr.aiParsed && pr.aiParsed.underlyings) || [];
        _normalizeUnderlyings(unds).forEach(u => existingUnderlyings.add(u.toUpperCase()));
    });

    // Coupon moyen
    const coupons = products.map(pr => {
        const c = pr.coupon;
        return typeof c === 'number' ? c : parseFloat(c?.rate || c?.taux || 0);
    }).filter(c => c > 0);
    const avgCoupon = coupons.length > 0
        ? Math.round((coupons.reduce((a, b) => a + b, 0) / coupons.length) * 100) / 100
        : 0;

    // Overlap sous-jacents
    const newUnds = product.underlyings.map(u => u.toUpperCase());
    const overlapping = newUnds.filter(u => existingUnderlyings.has(u));

    return {
        available: true,
        totalProducts: products.length,
        totalAmount,
        issuerConcentration,
        currentIssuerPct: issuerConcentration[product.bankId.toUpperCase()] || 0,
        typeCounts,
        existingUnderlyings: [...existingUnderlyings],
        overlappingUnderlyings: overlapping,
        avgCoupon
    };
}

// ─── 6. BENCHMARK CAT ────────────────────────────────────────

async function _loadCatBenchmark() {
    try {
        const rates = await github.readFile('data/cat-market-rates.json');
        if (rates) {
            const allRates = rates.rates || rates || [];
            const ratesList = Array.isArray(allRates) ? allRates : [];

            const bestByDuration = {};
            ratesList.forEach(r => {
                const dur = r.duration || r.duree || '12m';
                const rate = parseFloat(r.rate || r.taux) || 0;
                if (!bestByDuration[dur] || rate > bestByDuration[dur].rate) {
                    bestByDuration[dur] = { rate, bank: r.bank || r.banque, duration: dur };
                }
            });

            const bestOverall = Object.values(bestByDuration)
                .reduce((best, r) => r.rate > best.rate ? r : best, { rate: 0 });

            if (bestOverall.rate > 0) {
                return {
                    bestRate: bestOverall.rate,
                    bestBank: bestOverall.bank || '',
                    bestDuration: bestOverall.duration || '',
                    byDuration: bestByDuration,
                    source: 'market-rates',
                    updatedAt: rates.updatedAt || rates.updated_at || null
                };
            }
        }
    } catch (e) { /* fallthrough */ }

    try {
        const deposits = await github.readFile('data/cat-deposits.json');
        if (deposits) {
            const depList = deposits.deposits || deposits || [];
            const rates = (Array.isArray(depList) ? depList : [])
                .map(d => parseFloat(d.rate || d.taux) || 0)
                .filter(r => r > 0);
            if (rates.length > 0) {
                return { bestRate: Math.max(...rates), source: 'portfolio-cat' };
            }
        }
    } catch (e) { /* fallthrough */ }

    return { bestRate: 3.0, source: 'fallback' };
}

// ─── 7. KILL CRITERIA ────────────────────────────────────────

function _checkKillCriteria(product, portfolioCtx, catBenchmark) {
    const kc = GRADING_CONFIG.killCriteria;
    const reasons = [];

    if (product.worstOf && product.underlyings.length > kc.maxWorstOfUnderlyings) {
        reasons.push(`Worst-of sur ${product.underlyings.length} sous-jacents (max: ${kc.maxWorstOfUnderlyings})`);
    }

    if (!product.capitalProtection && product.barrier !== 0 && product.barrier > kc.minBarrierWithoutProtection) {
        reasons.push(`Barrière ${product.barrier}% sans protection capital (seuil: ${kc.minBarrierWithoutProtection}%)`);
    }

    if (portfolioCtx.available) {
        const currentPct = portfolioCtx.currentIssuerPct || 0;
        if (currentPct > kc.maxIssuerConcentration) {
            reasons.push(`Émetteur ${product.issuer} déjà à ${Math.round(currentPct * 100)}% du book (max: ${Math.round(kc.maxIssuerConcentration * 100)}%)`);
        }
    }

    const bestCat = catBenchmark.bestRate || 3.0;
    if (product.coupon > 0 && (product.coupon - bestCat) < kc.minRiskPremiumVsCat) {
        reasons.push(`Prime vs CAT négative : coupon ${product.coupon}% vs CAT ${bestCat}%`);
    }

    if (portfolioCtx.available && portfolioCtx.overlappingUnderlyings) {
        if (portfolioCtx.overlappingUnderlyings.length > kc.maxSameUnderlying) {
            reasons.push(`${portfolioCtx.overlappingUnderlyings.length} sous-jacents déjà en portefeuille : ${portfolioCtx.overlappingUnderlyings.join(', ')}`);
        }
    }

    return { killed: reasons.length > 0, reasons };
}

// ─── 8. APPEL CLAUDE UNIFIÉ ──────────────────────────────────

function _buildGradingSystemPrompt() {
    return `Tu es un analyste de produits structurés pour une trésorerie d'entreprise.
Tu dois noter un produit structuré proposé par une banque selon 4 piliers, puis attribuer un grade final A/B/C/D/F.

RÈGLES DE NOTATION :

## Pilier 1 — Rendement ajusté au risque (30%)
Score /100. Prends le coupon facial et ajuste-le :
- Coupon conditionnel : estime la probabilité de versement à partir de la distance barrière coupon et la volatilité du sous-jacent
- Rendement effectif = coupon × probabilité
- Pénalité si capital non protégé : -15 points
- Pénalité si worst-of : -5 points par sous-jacent au-delà de 2
- Bonus si effet mémoire : +5 points
- Bonus si coupon garanti : +15 points

## Pilier 2 — Qualité sous-jacent (25%)
Score /100 basé sur les données marché fournies :
- Buffett score et Quality score (poids principal)
- Volatilité 3Y et Max Drawdown 3Y (risque)
- ROE, dette/equity, marge nette (fondamentaux)
- Pour worst-of : la note est tirée par LE PIRE du panier
- Indice diversifié > action mono > action small cap
- Si données marché absentes : score neutre 50/100 avec flag

## Pilier 3 — Fit portefeuille (25%)
Score /100 basé sur le contexte portefeuille :
- Concentration émetteur : -20 pts si émetteur > 30% du book
- Concentration type : -15 pts si même type > 60% du book
- Overlap sous-jacents : -10 pts par sous-jacent déjà en portefeuille
- Apport diversification : +15 pts si nouveau secteur/géographie
- Taille vs book : bonus si < 15% du book, malus si > 25%

## Pilier 4 — Prime vs CAT sans risque (20%)
Score /100 basé sur le spread entre rendement ajusté (pilier 1) et meilleur CAT :
- Prime > 4% : 90-100
- Prime 2.5-4% : 70-89
- Prime 1.5-2.5% : 40-69
- Prime 0-1.5% : 10-39
- Prime < 0% : 0 (kill criteria normalement déclenché)

## Score final et grade
Score = P1×0.30 + P2×0.25 + P3×0.25 + P4×0.20
- A : ≥ 75 (Intégrer sans hésiter)
- B : 60-74 (Intégrer, points faibles acceptables)
- C : 45-59 (Négocier les conditions ou passer)
- D : 25-44 (Rejeter, risque disproportionné)
- F : < 25 ou kill criteria déclenché

RÉPONDS UNIQUEMENT en JSON valide (pas de markdown, pas de backticks) avec cette structure exacte :
{
  "grade": "A",
  "score": 72,
  "pillars": {
    "adjustedReturn": { "score": 75, "couponEffective": 5.2, "couponProbability": 0.74, "reasoning": "..." },
    "underlyingQuality": { "score": 60, "worstStock": "ENI", "keyRisk": "...", "reasoning": "..." },
    "portfolioFit": { "score": 45, "issuerOverlap": true, "diversificationBenefit": false, "reasoning": "..." },
    "riskPremium": { "score": 55, "spreadVsCat": 2.2, "catBenchmark": 3.0, "reasoning": "..." }
  },
  "verdict": "2 phrases max résumant la décision.",
  "keyRisks": ["risque 1", "risque 2"],
  "negotiationPoints": ["point 1 si grade C"],
  "scenarios": {
    "optimistic": { "return_pct": 14, "return_eur": 4200, "probability": 0.25 },
    "base": { "return_pct": 7, "return_eur": 2100, "probability": 0.35 },
    "stress": { "return_pct": 0, "return_eur": 0, "probability": 0.25 },
    "worst": { "return_pct": -40, "return_eur": -12000, "probability": 0.15 }
  }
}`;
}

function _buildGradingUserPrompt(context) {
    const { product, market, portfolio, cat } = context;

    let prompt = `## PRODUIT À ANALYSER\n${JSON.stringify(product, null, 2)}\n\n`;

    if (market.available && market.stocks && market.stocks.length > 0) {
        prompt += `## DONNÉES MARCHÉ SOUS-JACENTS\n`;
        market.stocks.forEach(s => {
            if (s.available === false) {
                prompt += `- ${s.name} (${s.ticker}) : DONNÉES NON DISPONIBLES\n`;
            } else {
                prompt += `- ${s.name} (${s.ticker}) : prix=${s.price}, perf_1y=${s.perf_1y}%, `;
                prompt += `vol_3y=${s.volatility_3y}%, max_dd_3y=${s.max_dd_3y}%, beta=${s.beta}, `;
                prompt += `ROE=${s.roe}%, DE=${s.de_ratio}, marge_nette=${s.net_margin}%, `;
                prompt += `buffett_score=${s.buffett_score}/100 (${s.buffett_grade}), `;
                prompt += `quality_score=${s.quality_score}/100, secteur=${s.sector}\n`;
            }
        });
        if (market.worstMetrics) {
            prompt += `\nWORST-OF METRICS : pire_buffett=${market.worstMetrics.worst_buffett}, `;
            prompt += `pire_quality=${market.worstMetrics.worst_quality}, `;
            prompt += `max_vol=${market.worstMetrics.max_volatility}%, `;
            prompt += `max_dd=${market.worstMetrics.max_drawdown}%, `;
            prompt += `maillon_faible=${market.worstMetrics.worst_name}\n`;
        }
        prompt += '\n';
    } else {
        prompt += `## DONNÉES MARCHÉ : NON DISPONIBLES (score sous-jacent = 50/100 par défaut)\n\n`;
    }

    if (portfolio.available) {
        prompt += `## PORTEFEUILLE EXISTANT\n`;
        prompt += `- ${portfolio.totalProducts} produits structurés, total ${formatNumber(portfolio.totalAmount)}€\n`;
        prompt += `- Coupon moyen : ${portfolio.avgCoupon}%\n`;
        prompt += `- Concentration émetteur ${product.issuer} : ${Math.round((portfolio.currentIssuerPct || 0) * 100)}%\n`;
        prompt += `- Types : ${JSON.stringify(portfolio.typeCounts)}\n`;
        prompt += `- Sous-jacents en commun : ${portfolio.overlappingUnderlyings.length > 0 ? portfolio.overlappingUnderlyings.join(', ') : 'aucun'}\n\n`;
    }

    prompt += `## BENCHMARK CAT SANS RISQUE\n`;
    prompt += `- Meilleur taux : ${cat.bestRate}%`;
    if (cat.bestBank) prompt += ` (${cat.bestBank}, ${cat.bestDuration})`;
    prompt += `\n- Source : ${cat.source}\n`;

    return prompt;
}

async function _callClaudeForGrading(context) {
    const response = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            system: _buildGradingSystemPrompt(),
            messages: [{
                role: 'user',
                content: _buildGradingUserPrompt(context)
            }]
        })
    });

    if (!response.ok) {
        throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = (data.content || [])
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');

    return _repairAndParseJSON(text);
}

function _repairAndParseJSON(text) {
    let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    try { return JSON.parse(cleaned); } catch (e) { /* repair */ }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

    try { return JSON.parse(cleaned); } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}\nRaw: ${text.substring(0, 500)}`);
    }
}

// ─── 9. SCORING LOCAL (fallback si Claude indisponible) ──────

function _computeLocalFallback(context) {
    const p = context.product;
    const cat = context.cat;
    const pf = context.portfolio;

    let p1 = Math.min(100, (p.coupon / 10) * 100);
    if (!p.capitalProtection) p1 -= 15;
    if (p.worstOf) p1 -= Math.max(0, (p.underlyings.length - 2) * 5);
    if (p.hasMemory) p1 += 5;
    p1 = Math.max(0, Math.min(100, p1));

    let p2 = 50;
    if (context.market.available && context.market.worstMetrics) {
        const wm = context.market.worstMetrics;
        p2 = Math.min(100, Math.max(0,
            (wm.worst_buffett || 50) * 0.4 +
            (wm.worst_quality || 50) * 0.3 +
            Math.max(0, 100 - (wm.max_volatility || 30)) * 0.3
        ));
    }

    let p3 = 70;
    if (pf.available) {
        if (pf.currentIssuerPct > 0.3) p3 -= 20;
        if (pf.overlappingUnderlyings && pf.overlappingUnderlyings.length > 0) {
            p3 -= pf.overlappingUnderlyings.length * 10;
        }
    }
    p3 = Math.max(0, Math.min(100, p3));

    const spread = p.coupon - (cat.bestRate || 3.0);
    let p4 = spread >= 4.0 ? 95 : spread >= 2.5 ? 75 : spread >= 1.5 ? 50 : spread >= 0 ? 25 : 5;

    const score = Math.round(p1 * 0.30 + p2 * 0.25 + p3 * 0.25 + p4 * 0.20);
    const grade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : score >= 25 ? 'D' : 'F';

    return {
        grade, score,
        killCriteria: { triggered: false, reasons: [] },
        pillars: {
            adjustedReturn: { score: Math.round(p1), reasoning: 'Scoring local (IA indisponible)' },
            underlyingQuality: { score: Math.round(p2), reasoning: 'Scoring local (IA indisponible)' },
            portfolioFit: { score: Math.round(p3), reasoning: 'Scoring local (IA indisponible)' },
            riskPremium: { score: Math.round(p4), spreadVsCat: Math.round(spread * 100) / 100, reasoning: 'Scoring local (IA indisponible)' }
        },
        verdict: `Score local ${score}/100 (grade ${grade}). Relancer avec IA pour résultat précis.`,
        keyRisks: [], negotiationPoints: [], scenarios: null
    };
}

// ─── 10. NORMALISATION RÉSULTAT ──────────────────────────────

function _normalizeGradingResult(raw) {
    const result = { ...raw };
    result.score = Math.max(0, Math.min(100, parseInt(result.score) || 0));

    if (result.score >= 75) result.grade = 'A';
    else if (result.score >= 60) result.grade = 'B';
    else if (result.score >= 45) result.grade = 'C';
    else if (result.score >= 25) result.grade = 'D';
    else result.grade = 'F';

    if (result.killCriteria && result.killCriteria.triggered) {
        result.grade = 'F';
        result.score = 0;
    }

    if (result.pillars) {
        Object.keys(result.pillars).forEach(key => {
            if (result.pillars[key] && typeof result.pillars[key].score === 'number') {
                result.pillars[key].score = Math.max(0, Math.min(100, result.pillars[key].score));
            }
        });
    }

    return result;
}

// ─── 11. ORCHESTRATEUR PRINCIPAL ─────────────────────────────

async function gradeProposal(product, options = {}) {
    const startTime = Date.now();
    const context = await _collectGradingContext(product);
    const killCheck = _checkKillCriteria(context.product, context.portfolio, context.cat);

    if (killCheck.killed) {
        const result = {
            grade: 'F', score: 0,
            killCriteria: { triggered: true, reasons: killCheck.reasons },
            pillars: {
                adjustedReturn: { score: null, reasoning: 'Kill criteria déclenché' },
                underlyingQuality: { score: null, reasoning: 'Kill criteria déclenché' },
                portfolioFit: { score: null, reasoning: 'Kill criteria déclenché' },
                riskPremium: { score: null, reasoning: 'Kill criteria déclenché' }
            },
            verdict: `Rejet automatique : ${killCheck.reasons[0]}`,
            keyRisks: killCheck.reasons,
            negotiationPoints: [], scenarios: null,
            metadata: { gradedAt: new Date().toISOString(), durationMs: Date.now() - startTime, aiUsed: false, version: '1.0' }
        };
        product.grading = result;
        return result;
    }

    let aiResult;
    try {
        aiResult = await _callClaudeForGrading(context);
    } catch (e) {
        console.error('[Grader] Erreur Claude, fallback local:', e);
        aiResult = _computeLocalFallback(context);
    }

    const result = _normalizeGradingResult(aiResult);
    result.killCriteria = result.killCriteria || { triggered: false, reasons: [] };
    result.metadata = {
        gradedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        aiUsed: true,
        version: '1.0',
        marketDataAvailable: context.market.available || false,
        catBenchmark: context.cat.bestRate
    };

    product.grading = result;
    return result;
}

// ─── 12. BATCH GRADING ───────────────────────────────────────

async function gradeProposalsBatch(proposals, onProgress) {
    const results = [];
    const total = proposals.length;

    for (let i = 0; i < total; i++) {
        try {
            const result = await gradeProposal(proposals[i]);
            results.push({ proposal: proposals[i], grading: result });
        } catch (e) {
            console.error(`[Grader] Erreur proposition ${i + 1}:`, e);
            results.push({
                proposal: proposals[i],
                grading: { grade: '?', score: null, verdict: `Erreur : ${e.message}`, metadata: { error: true } }
            });
        }
        if (onProgress) onProgress(i + 1, total, results[results.length - 1]);
        if (i < total - 1) await new Promise(r => setTimeout(r, 1500));
    }

    const order = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'F': 4, '?': 5 };
    results.sort((a, b) => {
        const ga = order[a.grading.grade] ?? 5;
        const gb = order[b.grading.grade] ?? 5;
        return ga !== gb ? ga - gb : (b.grading.score || 0) - (a.grading.score || 0);
    });

    return results;
}

// ─── 13. UI HELPERS ──────────────────────────────────────────

function renderGradeBadge(grade, score, size = 'small') {
    const config = GRADING_CONFIG.grades[grade] || GRADING_CONFIG.grades.F;
    const color = config.color;

    if (size === 'large') {
        return `<div style="width:80px;height:80px;border-radius:50%;background:${color}22;border:3px solid ${color};display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <span style="font-size:32px;font-weight:700;color:${color};">${grade}</span>
            <span style="font-size:11px;color:${color};opacity:0.8;">${score !== null ? score + '/100' : '—'}</span>
        </div>`;
    }

    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:${color}22;color:${color};font-weight:700;font-size:14px;">${grade}</span>`;
}

function renderGradingSection(grading) {
    if (!grading) {
        return `<div class="grading-section" style="padding:20px;text-align:center;">
            <button onclick="triggerGrading(this)" class="btn primary" style="padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer;">
                🎯 Lancer le grading unifié
            </button>
        </div>`;
    }

    const g = grading;
    const config = GRADING_CONFIG.grades[g.grade] || GRADING_CONFIG.grades.F;
    let html = `<div class="grading-section">`;

    html += `<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        ${renderGradeBadge(g.grade, g.score, 'large')}
        <div style="flex:1;">
            <div style="font-size:18px;font-weight:600;color:${config.color};">Grade ${g.grade} — ${config.label}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${g.verdict || ''}</div>
        </div>
    </div>`;

    if (g.killCriteria && g.killCriteria.triggered) {
        html += `<div style="background:rgba(239,35,60,0.08);border:1px solid rgba(239,35,60,0.25);border-radius:8px;padding:12px;margin-bottom:16px;">
            <div style="font-weight:600;color:#EF233C;margin-bottom:6px;">⛔ Kill criteria déclenchés</div>
            ${g.killCriteria.reasons.map(r => `<div style="font-size:12px;color:#EF233C;padding:2px 0;">• ${r}</div>`).join('')}
        </div>`;
    }

    const pillarNames = { adjustedReturn: 'Rendement ajusté', underlyingQuality: 'Qualité sous-jacent', portfolioFit: 'Fit portefeuille', riskPremium: 'Prime vs CAT' };

    if (g.pillars) {
        html += `<div style="margin-bottom:16px;">`;
        Object.entries(pillarNames).forEach(([key, name]) => {
            const pillar = g.pillars[key] || {};
            const score = pillar.score;
            if (score === null || score === undefined) return;
            const weight = GRADING_CONFIG.weights[key];
            const barColor = score >= 70 ? '#06D6A0' : score >= 45 ? '#FFB627' : '#EF233C';
            html += `<div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                    <span style="color:var(--text-muted);">${name} (${Math.round(weight * 100)}%)</span>
                    <span style="font-weight:600;">${score}/100</span>
                </div>
                <div style="height:6px;background:var(--bg-card);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;width:${score}%;background:${barColor};border-radius:3px;transition:width 0.5s;"></div>
                </div>
                ${pillar.reasoning ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${pillar.reasoning}</div>` : ''}
            </div>`;
        });
        html += `</div>`;
    }

    if (g.scenarios) {
        html += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">`;
        const scenarioLabels = { optimistic: 'Optimiste', base: 'Base', stress: 'Stress', worst: 'Worst' };
        const scenarioColors = { optimistic: '#06D6A0', base: '#4ECDC4', stress: '#FFB627', worst: '#EF233C' };
        Object.entries(scenarioLabels).forEach(([key, label]) => {
            const s = g.scenarios[key];
            if (!s) return;
            const color = scenarioColors[key];
            html += `<div style="text-align:center;padding:8px;border-radius:8px;background:${color}15;border:1px solid ${color}30;">
                <div style="font-size:10px;color:var(--text-muted);">${label}</div>
                <div style="font-size:16px;font-weight:600;color:${color};">${(s.return_eur||0) >= 0 ? '+' : ''}${(s.return_eur||0).toLocaleString('fr-FR')}€</div>
                <div style="font-size:10px;color:var(--text-muted);">${(s.return_pct||0) >= 0 ? '+' : ''}${s.return_pct||0}% · ${Math.round((s.probability||0)*100)}%</div>
            </div>`;
        });
        html += `</div>`;
    }

    if (g.keyRisks && g.keyRisks.length > 0) {
        html += `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;"><strong>Risques :</strong> ${g.keyRisks.join(' · ')}</div>`;
    }

    if (g.grade === 'C' && g.negotiationPoints && g.negotiationPoints.length > 0) {
        html += `<div style="font-size:12px;color:#FFB627;margin-bottom:8px;"><strong>Points à négocier :</strong> ${g.negotiationPoints.join(' · ')}</div>`;
    }

    if (g.metadata) {
        html += `<div style="font-size:10px;color:var(--text-muted);opacity:0.5;margin-top:8px;">Gradé le ${new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR')} ${g.metadata.aiUsed ? '· Claude IA' : '· Scoring local'} · ${g.metadata.durationMs}ms ${g.metadata.marketDataAvailable ? '· Données marché ✓' : '· Sans données marché'}</div>`;
    }

    html += `</div>`;
    return html;
}

// ─── 14. TRIGGER FUNCTION (appelée par le bouton UI) ─────────

async function triggerGrading(btn) {
    const product = app.state.currentProduct;
    if (!product) { showToast('Aucun produit sélectionné', 'error'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Analyse en cours...';

    try {
        showToast('Grading unifié en cours...', 'info');
        const result = await gradeProposal(product);

        const section = btn.closest('.grading-section');
        if (section) {
            section.outerHTML = renderGradingSection(result);
        }

        if (product.bankId) {
            await app._saveProductFile(product.bankId, product);
        }

        const gradeConfig = GRADING_CONFIG.grades[result.grade] || {};
        showToast(`Grade ${result.grade} — ${gradeConfig.label} (${result.score}/100)`, 'success');
    } catch (e) {
        console.error('[Grader] Erreur:', e);
        btn.textContent = '❌ Erreur — Réessayer';
        btn.disabled = false;
        showToast('Erreur grading: ' + e.message, 'error');
    }
}

// ─── 15. EXPORT API ──────────────────────────────────────────

window.ProposalGrader = {
    grade: gradeProposal,
    gradeBatch: gradeProposalsBatch,
    renderBadge: renderGradeBadge,
    renderSection: renderGradingSection,
    checkKillCriteria: _checkKillCriteria,
    normalize: _graderNormalize,
    config: GRADING_CONFIG,
    version: '1.0'
};

console.log('[StructBoard] ProposalGrader v1.0 loaded — unified grading A/B/C/D/F');

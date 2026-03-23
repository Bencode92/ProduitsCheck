// STRUCTBOARD — Proposal Grader v3.0 — Product-focused, deterministic
// PHILOSOPHY: Grade the PRODUCT itself, not the portfolio context.
// - Portfolio products: 3 piliers only (rendement, qualité, prime vs CAT)
// - New proposals: adds Pilier 3 (fit) only for underlying overlap
// - NO issuer/distributor concentration — bankId = distributor, not issuer
// - Deterministic local scoring for P1/P2/P4, Claude only for verdict + scenarios

const GRADING_CONFIG = {
    // Weights adapt based on context
    weightsProposal: { adjustedReturn: 0.30, underlyingQuality: 0.25, portfolioFit: 0.20, riskPremium: 0.25 },
    weightsPortfolio: { adjustedReturn: 0.35, underlyingQuality: 0.35, portfolioFit: 0, riskPremium: 0.30 },
    grades: {
        A: { min: 75, label: 'Excellent', color: '#06D6A0' },
        B: { min: 60, label: 'Bon', color: '#4ECDC4' },
        C: { min: 45, label: 'Moyen', color: '#FFB627' },
        D: { min: 25, label: 'Faible', color: '#E85D04' },
        F: { min: 0,  label: 'Mauvais', color: '#EF233C' }
    },
    killCriteria: { maxWorstOfUnderlyings: 5, minBarrierWithoutProtection: -50, minRiskPremiumVsCat: 0 }
};

// ═══ COUPON ANNUALIZATION ═══
var FREQUENCY_MULTIPLIERS = {
    'trimestriel': 4, 'trimestrielle': 4, 'trimestre': 4, 'quarterly': 4, 'q': 4, '3m': 4, '3 mois': 4,
    'semestriel': 2, 'semestrielle': 2, 'semestre': 2, 'semi-annual': 2, 'semi-annuel': 2, '6m': 2, '6 mois': 2,
    'mensuel': 12, 'mensuelle': 12, 'monthly': 12, '1m': 12, 'mois': 12,
    'annuel': 1, 'annuelle': 1, 'annual': 1, 'yearly': 1, 'an': 1, '12m': 1, '12 mois': 1
};
function _detectCouponFrequency(couponObj, productName) {
    var freq = (couponObj.frequency || couponObj.frequence || '').toLowerCase().trim();
    if (freq && FREQUENCY_MULTIPLIERS[freq]) return { freq: freq, mult: FREQUENCY_MULTIPLIERS[freq], source: 'explicit' };
    var name = (productName || '').toLowerCase();
    var kw = [
        { pattern: /trimestriel/i, freq: 'trimestriel', mult: 4 },
        { pattern: /semestriel/i, freq: 'semestriel', mult: 2 },
        { pattern: /mensuel/i, freq: 'mensuel', mult: 12 },
        { pattern: /quarterly/i, freq: 'quarterly', mult: 4 },
        { pattern: /semi.?annu/i, freq: 'semestriel', mult: 2 },
        { pattern: /monthly/i, freq: 'monthly', mult: 12 }
    ];
    for (var i = 0; i < kw.length; i++) { if (kw[i].pattern.test(name)) return kw[i]; }
    return { freq: 'annuel', mult: 1, source: 'default' };
}
function _annualizeCoupon(rawRate, couponObj, productName) {
    if (!rawRate || rawRate <= 0) return { annual: 0, raw: 0, mult: 1, freq: 'annuel', source: 'zero' };
    var det = _detectCouponFrequency(couponObj, productName);
    if (couponObj.annualized || couponObj.annualise) return { annual: rawRate, raw: rawRate, mult: 1, freq: 'annuel', source: 'pre-annualized' };
    var annual = rawRate * det.mult;
    if (det.mult > 1 && annual > 30) return { annual: rawRate, raw: rawRate, mult: 1, freq: 'annuel', source: 'sanity-cap' };
    return { annual: Math.round(annual * 1000) / 1000, raw: rawRate, mult: det.mult, freq: det.freq, source: det.source };
}

// ═══ NORMALIZE ═══
function _graderNormalize(product) {
    var p = product || {}, ai = p.aiParsed || {};
    var couponObj = p.coupon || ai.coupon || {};
    var rawRate = typeof couponObj === 'number' ? couponObj : parseFloat(couponObj.rate || couponObj.annualized || couponObj.taux) || 0;
    var ci = _annualizeCoupon(rawRate, typeof couponObj === 'object' ? couponObj : {}, p.name || ai.name || '');
    var protObj = p.capitalProtection || ai.capitalProtection || {};
    var barrier = parseFloat(protObj.barrier || protObj.barriere || p.barrier) || 0;
    var autoObj = p.earlyRedemption || ai.earlyRedemption || {};
    var underlyings = _normalizeUnderlyings(p.underlyings || ai.underlyings || []);
    return {
        id: p.id || '', name: p.name||ai.name||'Inconnu',
        type: p.type||ai.type||'',
        coupon: ci.annual, couponRaw: ci.raw, couponMultiplier: ci.mult, couponFrequency: ci.freq, couponFrequencySource: ci.source,
        couponType: (typeof couponObj === 'object' ? couponObj.type : '') || 'conditionnel',
        hasMemory: !!(typeof couponObj === 'object' && (couponObj.memory||couponObj.memoire)),
        barrier: barrier, barrierType: protObj.type||'européenne',
        capitalProtection: !!(protObj.guaranteed||protObj.garanti||protObj.full||protObj.protected===true||protObj.protected==='true'),
        maturity: p.maturity||ai.maturity||'', maturityYears: parseFloat(p.maturityYears||ai.maturityYears)||0,
        autocall: !!(autoObj.enabled||autoObj.hasAutocall||autoObj.possible===true||autoObj.possible==='true'),
        autocallThreshold: parseFloat(autoObj.threshold||autoObj.trigger||autoObj.seuil)||100,
        underlyings: underlyings, worstOf: underlyings.length>1,
        nominal: parseFloat(p.investedAmount||p.nominal||p.montant)||0
    };
}
function _normalizeUnderlyings(u) { if(typeof u==='string')return u.split(/[,;\/]/).map(function(s){return s.trim()}).filter(Boolean); if(Array.isArray(u))return u.map(function(x){return typeof x==='string'?x.trim():(x.name||x.ticker||x.isin||'')}).filter(Boolean); return []; }

// ═══ MARKET DATA ═══
var _mktCache=null,_mktCacheTs=0;
async function _loadAllMarketData(){if(_mktCache&&_mktCacheTs>Date.now()-3600000)return _mktCache;var r=await Promise.all([github.readFile('data/market/stocks_europe.json').catch(function(){return null}),github.readFile('data/market/stocks_us.json').catch(function(){return null}),github.readFile('data/market/sectors.json').catch(function(){return null}),github.readFile('data/market/markets.json').catch(function(){return null}),github.readFile('data/market/market_context.json').catch(function(){return null})]);_mktCache={stocksEurope:(r[0]&&r[0].stocks)?r[0].stocks:[],stocksUS:(r[1]&&r[1].stocks)?r[1].stocks:[],sectors:(r[2]&&r[2].sectors)?r[2].sectors:{},indices:(r[3]&&r[3].indices)?r[3].indices:{},context:r[4]||{}};_mktCacheTs=Date.now();return _mktCache;}

var STOCK_ALIASES={'DANONE':'BN','ENI':'ENI','TOTALENERGIES':'TTE','TOTAL':'TTE','LVMH':'MC','SCHNEIDER':'SU','ASML':'ASML','TESLA':'TSLA','ESTEE LAUDER':'EL','PHILIP MORRIS':'MO','FASTENAL':'FAST','PERNOD RICARD':'RI','BNP':'BNP','SOCIETE GENERALE':'GLE','AXA':'CS','SANOFI':'SAN','AIR LIQUIDE':'AI'};
function _resolveAlias(name){var u=name.toUpperCase().trim();if(typeof BANK_ALIASES!=='undefined'&&BANK_ALIASES[u])return BANK_ALIASES[u];return STOCK_ALIASES[u]||u;}
function _extractStockData(product,mkt){var all=[].concat(mkt.stocksEurope,mkt.stocksUS);var result={available:false,stocks:[],worstMetrics:null,sectorData:null,marketContext:null};product.underlyings.forEach(function(und){var ticker=_resolveAlias(und);var s=all.find(function(x){return x.ticker===ticker||x.ticker===und.toUpperCase()||(x.name&&x.name.toUpperCase().indexOf(und.toUpperCase())>=0)||(x.name_api&&x.name_api.toUpperCase().indexOf(und.toUpperCase())>=0)});if(s){result.available=true;result.stocks.push({name:und,ticker:s.ticker,found:true,price:s.price,change_pct:s.change_percent,perf_ytd:s.perf_ytd,perf_1y:s.perf_1y,perf_3y:s.perf_3y,beta:s.beta,volatility_3y:s.volatility_3y,max_drawdown_3y:s.max_drawdown_3y,distance_52w_high:s.distance_52w_high,pe_ratio:s.pe_ratio,roe:s.roe,de_ratio:s.de_ratio,net_margin:s.net_margin,fcf_yield:s.fcf_yield,dividend_yield:s.dividend_yield,buffett_score:s.buffett_score,buffett_grade:s.buffett_grade,quality_score:s.quality_score,quality_subscores:s.quality_subscores,sector:s.sector,sector_api:s.sector_api,industry:s.industry,country:s.country,region:s.region})}else{result.stocks.push({name:und,ticker:ticker,found:false})}});var found=result.stocks.filter(function(s){return s.found});if(found.length>0){result.worstMetrics={worst_buffett:Math.min.apply(null,found.map(function(s){return s.buffett_score!=null?s.buffett_score:50})),worst_quality:Math.min.apply(null,found.map(function(s){return s.quality_score!=null?s.quality_score:50})),worst_perf_1y:Math.min.apply(null,found.map(function(s){return s.perf_1y!=null?s.perf_1y:0})),max_volatility:Math.max.apply(null,found.map(function(s){return s.volatility_3y||30})),max_drawdown:Math.max.apply(null,found.map(function(s){return Math.abs(s.max_drawdown_3y||30)})),max_beta:Math.max.apply(null,found.map(function(s){return s.beta||1})),worst_name:found.reduce(function(w,s){return(s.buffett_score!=null?s.buffett_score:50)<(w.buffett_score!=null?w.buffett_score:50)?s:w}).name}}result.marketContext=mkt.context||null;return result;}

async function _loadCatBenchmark(){try{var rates=await github.readFile('data/cat-market-rates.json');if(rates){var list=Array.isArray(rates.rates||rates)?(rates.rates||rates):[];var best=list.reduce(function(b,r){var v=parseFloat(r.rate||r.taux)||0;return v>b.rate?{rate:v,bank:r.bank||r.banque}:b},{rate:0});if(best.rate>0)return{bestRate:best.rate,bestBank:best.bank,source:'market-rates'}}}catch(e){}try{var deps=await github.readFile('data/cat-deposits.json');if(deps){var dl=Array.isArray(deps.deposits||deps)?(deps.deposits||deps):[];var rs=dl.map(function(d){return parseFloat(d.rate||d.taux)||0}).filter(function(r){return r>0});if(rs.length>0)return{bestRate:Math.max.apply(null,rs),source:'portfolio-cat'}}}catch(e){}return{bestRate:3.0,source:'fallback'}}

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC LOCAL SCORING — no variability
// ═══════════════════════════════════════════════════════════════

function _computeP1(product) {
    // Pilier 1: Rendement ajusté — pure product metrics
    var coupon = product.coupon;
    var p1 = Math.min(100, coupon * 10); // 10% coupon = 100/100
    if (!product.capitalProtection) p1 -= 15;
    if (product.worstOf) p1 -= Math.max(0, (product.underlyings.length - 2) * 5);
    if (product.hasMemory) p1 += 5;
    if (product.couponType === 'garanti' || product.couponType === 'fixe') p1 += 15;
    // Maturity adjustment
    var my = product.maturityYears || 0;
    if (my > 0 && my <= 3) p1 += 5;
    else if (my > 6 && my <= 10) p1 -= 5;
    else if (my > 10) p1 -= 10;
    return Math.max(0, Math.min(100, Math.round(p1)));
}

function _computeP2(product, market) {
    // Pilier 2: Qualité sous-jacent — market data driven
    if (!market.available || !market.worstMetrics) return 50; // neutral if no data
    var wm = market.worstMetrics;
    var buffett = wm.worst_buffett != null ? wm.worst_buffett : 50;
    var quality = wm.worst_quality != null ? wm.worst_quality : 50;
    var volPenalty = Math.max(0, (wm.max_volatility || 30) - 20) * 0.5; // penalty above 20% vol
    var ddPenalty = Math.max(0, (wm.max_drawdown || 30) - 25) * 0.4; // penalty above 25% dd
    var p2 = buffett * 0.35 + quality * 0.35 + Math.max(0, 100 - volPenalty * 2) * 0.15 + Math.max(0, 100 - ddPenalty * 2) * 0.15;
    // Worst-of correlation penalty (same sector = worse)
    if (market.stocks && market.stocks.length > 1) {
        var found = market.stocks.filter(function(s) { return s.found; });
        if (found.length > 1) {
            var sectors = {};
            found.forEach(function(s) { sectors[(s.sector_api || '?').toLowerCase()] = 1; });
            var nSectors = Object.keys(sectors).length;
            if (nSectors === 1) p2 -= 10; // all same sector = high correlation
            else if (nSectors < found.length) p2 -= 5; // some overlap
        }
    }
    return Math.max(0, Math.min(100, Math.round(p2)));
}

function _computeP3(product, portfolio, isInPortfolio) {
    // Pilier 3: Fit portefeuille
    // For PORTFOLIO products: SKIP — always neutral (already integrated)
    if (isInPortfolio) return 70; // neutral, doesn't affect score
    
    // For NEW proposals only: check underlying overlap
    if (!portfolio || !portfolio.available) return 70;
    var p3 = 70;
    // Only penalize for underlying overlap — NOT issuer/distributor
    var overlap = portfolio.overlappingUnderlyings || [];
    p3 -= overlap.length * 10;
    // Bonus for new sector diversification
    // (simplified: if product has underlyings not in portfolio = good)
    var newUnds = (product.underlyings || []).filter(function(u) {
        return !portfolio.existingUnderlyings.some(function(e) { return e === u.toUpperCase(); });
    });
    if (newUnds.length > 0) p3 += 10;
    return Math.max(0, Math.min(100, Math.round(p3)));
}

function _computeP4(product, catRate) {
    // Pilier 4: Prime vs CAT
    var spread = product.coupon - (catRate || 3.0);
    if (spread >= 5) return 100;
    if (spread >= 4) return 90;
    if (spread >= 3) return 75;
    if (spread >= 2) return 60;
    if (spread >= 1) return 40;
    if (spread >= 0) return 20;
    return 5;
}

// ═══════════════════════════════════════════════════════════════
// KILL CRITERIA — product-only, no portfolio context
// ═══════════════════════════════════════════════════════════════

function _checkKillCriteria(product, catBench) {
    var kc = GRADING_CONFIG.killCriteria, reasons = [];
    if (product.worstOf && product.underlyings.length > kc.maxWorstOfUnderlyings)
        reasons.push('Worst-of sur ' + product.underlyings.length + ' sous-jacents (max: ' + kc.maxWorstOfUnderlyings + ')');
    if (!product.capitalProtection && product.barrier !== 0 && product.barrier > kc.minBarrierWithoutProtection)
        reasons.push('Barrière ' + product.barrier + '% sans protection capital');
    var bestCat = catBench.bestRate || 3.0;
    if (product.coupon > 0 && (product.coupon - bestCat) < kc.minRiskPremiumVsCat)
        reasons.push('Prime vs CAT négative: coupon ' + product.coupon + '% vs CAT ' + bestCat + '%');
    return { killed: reasons.length > 0, reasons: reasons };
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT COLLECTION
// ═══════════════════════════════════════════════════════════════

function _isInPortfolio(productId) {
    return (app.state.portfolio || []).some(function(p) { return p.id === productId; });
}

async function _collectGradingContext(product) {
    var normalized = _graderNormalize(product);
    var ctx = { product: normalized, market: { available: false }, portfolio: { available: false }, cat: { bestRate: 3.0, source: 'fallback' }, isInPortfolio: _isInPortfolio(product.id) };
    try { var mkt = await _loadAllMarketData(); if (mkt) ctx.market = _extractStockData(normalized, mkt); } catch(e) {}
    // Portfolio context only for NEW proposals (not portfolio products)
    if (!ctx.isInPortfolio) {
        try {
            var pf = app.state.portfolio || [];
            if (pf.length > 0) {
                var existingUnds = {};
                pf.forEach(function(p) { _normalizeUnderlyings(p.underlyings || (p.aiParsed && p.aiParsed.underlyings) || []).forEach(function(u) { existingUnds[u.toUpperCase()] = 1; }); });
                var overlap = normalized.underlyings.map(function(u) { return u.toUpperCase(); }).filter(function(u) { return existingUnds[u]; });
                ctx.portfolio = { available: true, totalProducts: pf.length, existingUnderlyings: Object.keys(existingUnds), overlappingUnderlyings: overlap };
            }
        } catch(e) {}
    }
    try { ctx.cat = await _loadCatBenchmark(); } catch(e) {}
    return ctx;
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE PROMPT — product-focused, minimal
// ═══════════════════════════════════════════════════════════════

function _buildSystemPrompt(isInPortfolio) {
    return "Tu es un analyste de produits structurés. Analyse CE PRODUIT uniquement sur ses mérites intrinsèques.\n\n" +
    "Le scoring des 3 piliers est DÉJÀ CALCULÉ. Tu dois fournir :\n" +
    "1. Un VERDICT de 3-4 phrases avec données concrètes (scores, vol, coupon ajusté)\n" +
    "2. Les RISQUES CLÉS (2-3 max)\n" +
    "3. Des SCÉNARIOS chiffrés en €\n\n" +
    "COUPON : le champ 'coupon' est DÉJÀ ANNUALISÉ. Si couponMultiplier > 1, mentionne la fréquence.\n" +
    (isInPortfolio ? "Ce produit est DÉJÀ en portefeuille. Pas de commentaire sur la diversification.\n" : "") +
    "\nJSON valide UNIQUEMENT:\n{\"verdict\":\"3-4 phrases...\",\"keyRisks\":[\"r1\",\"r2\"],\"negotiationPoints\":[],\"scenarios\":{\"optimistic\":{\"return_pct\":7,\"return_eur\":7000,\"probability\":0.25,\"duration_years\":1},\"base\":{\"return_pct\":5,\"return_eur\":15000,\"probability\":0.35,\"duration_years\":3},\"stress\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.25,\"duration_years\":6},\"worst\":{\"return_pct\":-5,\"return_eur\":-5000,\"probability\":0.15,\"duration_years\":6}}}";
}

function _buildUserPrompt(ctx, scores) {
    var p = ctx.product, m = ctx.market;
    var simNominal = p.nominal > 0 ? p.nominal : 100000;
    var prompt = '## PRODUIT (nominal: ' + formatNumber(simNominal) + '€)\n';
    prompt += 'Nom: ' + p.name + '\nCoupon annualisé: ' + p.coupon + '%';
    if (p.couponMultiplier > 1) prompt += ' (' + p.couponRaw + '% × ' + p.couponMultiplier + ' ' + p.couponFrequency + ')';
    prompt += '\nBarrière: ' + (p.barrier || 'N/A') + '% | Capital: ' + (p.capitalProtection ? 'protégé' : 'non protégé');
    prompt += '\nMaturité: ' + (p.maturityYears || '?') + ' ans | Autocall: ' + (p.autocall ? 'oui' : 'non');
    prompt += '\nSous-jacents: ' + p.underlyings.join(', ') + (p.worstOf ? ' (worst-of)' : '') + '\n\n';
    // Market data
    if (m.available && m.stocks.length > 0) {
        prompt += '## DONNÉES MARCHÉ\n';
        m.stocks.forEach(function(s) {
            if (!s.found) { prompt += '- ' + s.name + ': NON TROUVÉ\n'; return; }
            prompt += '- ' + s.name + ' (' + s.ticker + '): Buffett=' + s.buffett_score + '/100, Quality=' + s.quality_score + '/100, vol=' + s.volatility_3y + '%, DD=' + s.max_drawdown_3y + '%, beta=' + s.beta + ', perf_1Y=' + s.perf_1y + '%\n';
        });
        if (m.worstMetrics) prompt += 'Maillon faible: ' + m.worstMetrics.worst_name + ' (Buffett ' + m.worstMetrics.worst_buffett + ')\n';
    }
    // Scores already computed
    prompt += '\n## SCORES CALCULÉS\n';
    prompt += 'P1 (Rendement): ' + scores.p1 + '/100 | P2 (Qualité): ' + scores.p2 + '/100 | P4 (Prime vs CAT ' + ctx.cat.bestRate + '%): ' + scores.p4 + '/100\n';
    prompt += 'Score final: ' + scores.total + '/100 → Grade ' + scores.grade + '\n';
    prompt += '\nMONTANT SIMULATION: ' + formatNumber(simNominal) + '€. Calcule les scénarios en €.\n';
    return prompt;
}

async function _callClaude(ctx, scores) {
    var resp = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: _buildSystemPrompt(ctx.isInPortfolio),
            messages: [{ role: 'user', content: _buildUserPrompt(ctx, scores) }] }) });
    if (!resp.ok) throw new Error('Claude API ' + resp.status);
    var data = await resp.json();
    var text = (data.content || []).filter(function(c) { return c.type === 'text'; }).map(function(c) { return c.text; }).join('');
    return _parseJSON(text);
}
function _parseJSON(text) { var c = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim(); try { return JSON.parse(c); } catch(e) {} var f = c.indexOf('{'), l = c.lastIndexOf('}'); if (f !== -1 && l > f) c = c.slice(f, l + 1); c = c.replace(/,\s*([}\]])/g, '$1'); return JSON.parse(c); }

// ═══════════════════════════════════════════════════════════════
// MAIN GRADING ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

async function gradeProposal(product) {
    var t0 = Date.now();
    var ctx = await _collectGradingContext(product);
    var p = ctx.product;

    // Kill criteria — product-only
    var kill = _checkKillCriteria(p, ctx.cat);
    if (kill.killed) {
        var r = { grade: 'F', score: 0, killCriteria: { triggered: true, reasons: kill.reasons },
            pillars: { adjustedReturn: { score: null }, underlyingQuality: { score: null }, portfolioFit: { score: null }, riskPremium: { score: null } },
            verdict: 'Rejet: ' + kill.reasons[0], keyRisks: kill.reasons, scenarios: null,
            metadata: { gradedAt: new Date().toISOString(), durationMs: Date.now() - t0, aiUsed: false, version: '3.0' } };
        product.grading = r; return r;
    }

    // DETERMINISTIC scoring
    var p1 = _computeP1(p);
    var p2 = _computeP2(p, ctx.market);
    var p3 = _computeP3(p, ctx.portfolio, ctx.isInPortfolio);
    var p4 = _computeP4(p, ctx.cat.bestRate);

    var weights = ctx.isInPortfolio ? GRADING_CONFIG.weightsPortfolio : GRADING_CONFIG.weightsProposal;
    var total = Math.round(p1 * weights.adjustedReturn + p2 * weights.underlyingQuality + p3 * weights.portfolioFit + p4 * weights.riskPremium);
    var grade = total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 25 ? 'D' : 'F';

    var scores = { p1: p1, p2: p2, p3: p3, p4: p4, total: total, grade: grade };

    // Claude only for verdict + scenarios (not for scoring)
    var claudeResult = null;
    try { claudeResult = await _callClaude(ctx, scores); } catch(e) { console.warn('[Grader] Claude:', e.message); }

    var result = {
        grade: grade, score: total,
        killCriteria: { triggered: false, reasons: [] },
        pillars: {
            adjustedReturn: { score: p1, reasoning: 'Coupon ' + p.coupon + '%' + (p.couponMultiplier > 1 ? ' (' + p.couponRaw + '×' + p.couponMultiplier + ')' : '') + (p.capitalProtection ? ', protégé' : ', non protégé') + (p.worstOf ? ', WO ' + p.underlyings.length + ' SJ' : '') },
            underlyingQuality: { score: p2, reasoning: ctx.market.available && ctx.market.worstMetrics ? 'Worst: ' + ctx.market.worstMetrics.worst_name + ' (B:' + ctx.market.worstMetrics.worst_buffett + ', vol:' + ctx.market.worstMetrics.max_volatility + '%)' : 'Pas de données marché' },
            portfolioFit: { score: p3, reasoning: ctx.isInPortfolio ? 'Déjà en portefeuille — neutre' : ((ctx.portfolio.overlappingUnderlyings || []).length > 0 ? 'Overlap: ' + ctx.portfolio.overlappingUnderlyings.join(', ') : 'Pas d\'overlap') },
            riskPremium: { score: p4, spreadVsCat: Math.round((p.coupon - (ctx.cat.bestRate || 3)) * 100) / 100, reasoning: 'Coupon ' + p.coupon + '% vs CAT ' + ctx.cat.bestRate + '% = spread ' + (p.coupon - ctx.cat.bestRate).toFixed(1) + '%' }
        },
        verdict: claudeResult && claudeResult.verdict ? claudeResult.verdict : 'Score ' + total + '/100 (P1:' + p1 + ' P2:' + p2 + ' P4:' + p4 + ').',
        keyRisks: claudeResult && claudeResult.keyRisks ? claudeResult.keyRisks : [],
        negotiationPoints: claudeResult && claudeResult.negotiationPoints ? claudeResult.negotiationPoints : [],
        scenarios: claudeResult && claudeResult.scenarios ? claudeResult.scenarios : null,
        metadata: {
            gradedAt: new Date().toISOString(), durationMs: Date.now() - t0, aiUsed: !!claudeResult, version: '3.0',
            marketDataAvailable: ctx.market.available, catBenchmark: ctx.cat.bestRate,
            couponAnnualized: p.coupon, couponRaw: p.couponRaw, couponMultiplier: p.couponMultiplier, couponFrequency: p.couponFrequency,
            isInPortfolio: ctx.isInPortfolio, weightsUsed: ctx.isInPortfolio ? 'portfolio' : 'proposal'
        }
    };
    product.grading = result;
    return result;
}

async function gradeProposalsBatch(proposals, onProgress) {
    var results = [], total = proposals.length;
    for (var i = 0; i < total; i++) {
        try { var r = await gradeProposal(proposals[i]); results.push({ proposal: proposals[i], grading: r }); }
        catch(e) { results.push({ proposal: proposals[i], grading: { grade: '?', score: null, verdict: 'Erreur: ' + e.message } }); }
        if (onProgress) onProgress(i + 1, total, results[results.length - 1]);
        if (i < total - 1) await new Promise(function(r) { setTimeout(r, 1500); });
    }
    results.sort(function(a, b) { var o = { A:0, B:1, C:2, D:3, F:4, '?':5 }; return (o[a.grading.grade] || 5) - (o[b.grading.grade] || 5) || (b.grading.score || 0) - (a.grading.score || 0); });
    return results;
}

// ═══ UI HELPERS ═══
function renderGradeBadge(grade, score, size) { var cfg = GRADING_CONFIG.grades[grade] || GRADING_CONFIG.grades.F, c = cfg.color; if (size === 'large') return '<div style="width:80px;height:80px;border-radius:50%;background:' + c + '22;border:3px solid ' + c + ';display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:32px;font-weight:700;color:' + c + '">' + grade + '</span><span style="font-size:11px;color:' + c + ';opacity:0.8">' + (score !== null ? score + '/100' : '\u2014') + '</span></div>'; return '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:' + c + '22;color:' + c + ';font-weight:700;font-size:14px">' + grade + '</span>'; }

function renderGradingSection(grading) {
    if (!grading) return '<div class="grading-section" style="padding:20px;text-align:center"><button onclick="triggerGrading(this)" class="btn primary" style="padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer">\ud83c\udfaf Lancer le grading</button></div>';
    var g = grading, cfg = GRADING_CONFIG.grades[g.grade] || GRADING_CONFIG.grades.F;
    var isPortfolio = g.metadata && g.metadata.isInPortfolio;
    var h = '<div class="grading-section"><div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">' + renderGradeBadge(g.grade, g.score, 'large') + '<div style="flex:1"><div style="font-size:18px;font-weight:600;color:' + cfg.color + '">Grade ' + g.grade + ' \u2014 ' + cfg.label + '</div><div style="font-size:13px;color:var(--text-muted);margin-top:4px">' + (g.verdict || '') + '</div></div></div>';
    if (g.killCriteria && g.killCriteria.triggered) h += '<div style="background:rgba(239,35,60,0.08);border:1px solid rgba(239,35,60,0.25);border-radius:8px;padding:12px;margin-bottom:16px"><div style="font-weight:600;color:#EF233C;margin-bottom:6px">\u26d4 Kill criteria</div>' + g.killCriteria.reasons.map(function(r) { return '<div style="font-size:12px;color:#EF233C;padding:2px 0">\u2022 ' + r + '</div>'; }).join('') + '</div>';
    if (g.metadata && g.metadata.couponMultiplier > 1) h += '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px"><strong style="color:var(--accent)">\u2139 Coupon annualis\u00e9</strong> : ' + g.metadata.couponRaw + '% \u00d7 ' + g.metadata.couponMultiplier + ' (' + g.metadata.couponFrequency + ') = <strong>' + g.metadata.couponAnnualized + '% annuel</strong></div>';
    // Piliers — skip P3 for portfolio
    var pn = { adjustedReturn: 'Rendement ajust\u00e9', underlyingQuality: 'Qualit\u00e9 sous-jacent', riskPremium: 'Prime vs CAT' };
    if (!isPortfolio) pn.portfolioFit = 'Fit portefeuille';
    var weights = isPortfolio ? GRADING_CONFIG.weightsPortfolio : GRADING_CONFIG.weightsProposal;
    if (g.pillars) { h += '<div style="margin-bottom:16px">'; ['adjustedReturn', 'underlyingQuality', 'portfolioFit', 'riskPremium'].forEach(function(k) { if (!pn[k]) return; var pl = g.pillars[k] || {}, sc = pl.score; if (sc === null || sc === undefined) return; var w = weights[k]; var bc = sc >= 70 ? '#06D6A0' : sc >= 45 ? '#FFB627' : '#EF233C'; h += '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--text-muted)">' + pn[k] + ' (' + Math.round(w * 100) + '%)</span><span style="font-weight:600">' + sc + '/100</span></div><div style="height:6px;background:var(--bg-card,var(--surface));border-radius:3px;overflow:hidden"><div style="height:100%;width:' + sc + '%;background:' + bc + ';border-radius:3px"></div></div>' + (pl.reasoning ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + pl.reasoning + '</div>' : '') + '</div>'; }); h += '</div>'; }
    if (g.scenarios) { h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">'; [['optimistic', 'Optimiste', '#06D6A0'], ['base', 'Base', '#4ECDC4'], ['stress', 'Stress', '#FFB627'], ['worst', 'Worst', '#EF233C']].forEach(function(x) { var s = g.scenarios[x[0]]; if (!s) return; h += '<div style="text-align:center;padding:8px;border-radius:8px;background:' + x[2] + '15;border:1px solid ' + x[2] + '30"><div style="font-size:10px;color:var(--text-muted)">' + x[1] + '</div><div style="font-size:16px;font-weight:600;color:' + x[2] + '">' + ((s.return_eur || 0) >= 0 ? '+' : '') + (s.return_eur || 0).toLocaleString('fr-FR') + '\u20ac</div><div style="font-size:10px;color:var(--text-muted)">' + ((s.return_pct || 0) >= 0 ? '+' : '') + (s.return_pct || 0) + '% \u00b7 ' + Math.round((s.probability || 0) * 100) + '%</div></div>'; }); h += '</div>'; }
    if (g.keyRisks && g.keyRisks.length > 0) h += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><strong>Risques :</strong> ' + g.keyRisks.join(' \u00b7 ') + '</div>';
    if (g.grade === 'C' && g.negotiationPoints && g.negotiationPoints.length > 0) h += '<div style="font-size:12px;color:#FFB627;margin-bottom:8px"><strong>\u00c0 n\u00e9gocier :</strong> ' + g.negotiationPoints.join(' \u00b7 ') + '</div>';
    h += '<div style="font-size:10px;color:var(--text-muted);opacity:0.5;margin-top:8px">' + (g.metadata.aiUsed ? 'Claude IA' : 'Local') + ' \u00b7 ' + new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR') + ' \u00b7 ' + g.metadata.durationMs + 'ms' + (isPortfolio ? ' \u00b7 Mode portefeuille' : '') + '</div>';
    h += '</div>'; return h;
}

window.ProposalGrader = { grade: gradeProposal, gradeBatch: gradeProposalsBatch, renderBadge: renderGradeBadge, renderSection: renderGradingSection, checkKillCriteria: _checkKillCriteria, normalize: _graderNormalize, config: GRADING_CONFIG, annualizeCoupon: _annualizeCoupon, detectFrequency: _detectCouponFrequency, version: '3.0' };
console.log('[StructBoard] ProposalGrader v3.0 \u2014 product-focused, deterministic scoring');

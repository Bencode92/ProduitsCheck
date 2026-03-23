// STRUCTBOARD — Proposal Grader v3.1 — Hybrid: deterministic base + Claude adjustment
// LOCAL computes base scores → Claude adjusts ±15pts per pillar with context → final score

const GRADING_CONFIG = {
    weightsProposal: { adjustedReturn: 0.30, underlyingQuality: 0.25, portfolioFit: 0.20, riskPremium: 0.25 },
    weightsPortfolio: { adjustedReturn: 0.35, underlyingQuality: 0.35, portfolioFit: 0, riskPremium: 0.30 },
    maxAdjustment: 15, // Claude can adjust each pillar by ±15 pts max
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
function _detectCouponFrequency(obj, name) {
    var f = (obj.frequency || obj.frequence || '').toLowerCase().trim();
    if (f && FREQUENCY_MULTIPLIERS[f]) return { freq: f, mult: FREQUENCY_MULTIPLIERS[f], source: 'explicit' };
    var n = (name || '').toLowerCase();
    var kw = [{p:/trimestriel/i,f:'trimestriel',m:4},{p:/semestriel/i,f:'semestriel',m:2},{p:/mensuel/i,f:'mensuel',m:12},{p:/quarterly/i,f:'quarterly',m:4},{p:/semi.?annu/i,f:'semestriel',m:2},{p:/monthly/i,f:'monthly',m:12}];
    for (var i = 0; i < kw.length; i++) if (kw[i].p.test(n)) return { freq: kw[i].f, mult: kw[i].m, source: 'name' };
    return { freq: 'annuel', mult: 1, source: 'default' };
}
function _annualizeCoupon(raw, obj, name) {
    if (!raw || raw <= 0) return { annual: 0, raw: 0, mult: 1, freq: 'annuel', source: 'zero' };
    var d = _detectCouponFrequency(obj, name);
    if (obj.annualized || obj.annualise) return { annual: raw, raw: raw, mult: 1, freq: 'annuel', source: 'pre-annualized' };
    var a = raw * d.mult;
    if (d.mult > 1 && a > 30) return { annual: raw, raw: raw, mult: 1, freq: 'annuel', source: 'sanity-cap' };
    return { annual: Math.round(a * 1000) / 1000, raw: raw, mult: d.mult, freq: d.freq, source: d.source };
}

// ═══ NORMALIZE ═══
function _graderNormalize(product) {
    var p = product || {}, ai = p.aiParsed || {};
    var co = p.coupon || ai.coupon || {};
    var raw = typeof co === 'number' ? co : parseFloat(co.rate || co.annualized || co.taux) || 0;
    var ci = _annualizeCoupon(raw, typeof co === 'object' ? co : {}, p.name || ai.name || '');
    var pr = p.capitalProtection || ai.capitalProtection || {};
    var ar = p.earlyRedemption || ai.earlyRedemption || {};
    var und = _normalizeUnderlyings(p.underlyings || ai.underlyings || []);
    return {
        id: p.id || '', name: p.name||ai.name||'Inconnu', type: p.type||ai.type||'',
        coupon: ci.annual, couponRaw: ci.raw, couponMultiplier: ci.mult, couponFrequency: ci.freq, couponFrequencySource: ci.source,
        couponType: (typeof co === 'object' ? co.type : '') || 'conditionnel',
        hasMemory: !!(typeof co === 'object' && (co.memory||co.memoire)),
        barrier: parseFloat(pr.barrier || pr.barriere || p.barrier) || 0,
        capitalProtection: !!(pr.guaranteed||pr.garanti||pr.full||pr.protected===true||pr.protected==='true'),
        maturity: p.maturity||ai.maturity||'', maturityYears: parseFloat(p.maturityYears||ai.maturityYears)||0,
        autocall: !!(ar.enabled||ar.hasAutocall||ar.possible===true||ar.possible==='true'),
        autocallThreshold: parseFloat(ar.threshold||ar.trigger||ar.seuil)||100,
        underlyings: und, worstOf: und.length > 1,
        nominal: parseFloat(p.investedAmount||p.nominal||p.montant)||0
    };
}
function _normalizeUnderlyings(u) { if(typeof u==='string')return u.split(/[,;\/]/).map(function(s){return s.trim()}).filter(Boolean); if(Array.isArray(u))return u.map(function(x){return typeof x==='string'?x.trim():(x.name||x.ticker||x.isin||'')}).filter(Boolean); return []; }

// ═══ MARKET DATA ═══
var _mktCache=null,_mktCacheTs=0;
async function _loadAllMarketData(){if(_mktCache&&_mktCacheTs>Date.now()-3600000)return _mktCache;var r=await Promise.all([github.readFile('data/market/stocks_europe.json').catch(function(){return null}),github.readFile('data/market/stocks_us.json').catch(function(){return null}),github.readFile('data/market/sectors.json').catch(function(){return null}),github.readFile('data/market/markets.json').catch(function(){return null}),github.readFile('data/market/market_context.json').catch(function(){return null})]);_mktCache={stocksEurope:(r[0]&&r[0].stocks)?r[0].stocks:[],stocksUS:(r[1]&&r[1].stocks)?r[1].stocks:[],sectors:(r[2]&&r[2].sectors)?r[2].sectors:{},indices:(r[3]&&r[3].indices)?r[3].indices:{},context:r[4]||{}};_mktCacheTs=Date.now();return _mktCache;}
var STOCK_ALIASES={'DANONE':'BN','ENI':'ENI','TOTALENERGIES':'TTE','TOTAL':'TTE','LVMH':'MC','SCHNEIDER':'SU','ASML':'ASML','TESLA':'TSLA','ESTEE LAUDER':'EL','PHILIP MORRIS':'MO','FASTENAL':'FAST','PERNOD RICARD':'RI','BNP':'BNP','SOCIETE GENERALE':'GLE','AXA':'CS','SANOFI':'SAN','AIR LIQUIDE':'AI'};
function _resolveAlias(name){var u=name.toUpperCase().trim();if(typeof BANK_ALIASES!=='undefined'&&BANK_ALIASES[u])return BANK_ALIASES[u];return STOCK_ALIASES[u]||u;}
function _extractStockData(product,mkt){var all=[].concat(mkt.stocksEurope,mkt.stocksUS);var result={available:false,stocks:[],worstMetrics:null,marketContext:null};product.underlyings.forEach(function(und){var ticker=_resolveAlias(und);var s=all.find(function(x){return x.ticker===ticker||x.ticker===und.toUpperCase()||(x.name&&x.name.toUpperCase().indexOf(und.toUpperCase())>=0)||(x.name_api&&x.name_api.toUpperCase().indexOf(und.toUpperCase())>=0)});if(s){result.available=true;result.stocks.push({name:und,ticker:s.ticker,found:true,price:s.price,change_pct:s.change_percent,perf_ytd:s.perf_ytd,perf_1y:s.perf_1y,perf_3y:s.perf_3y,beta:s.beta,volatility_3y:s.volatility_3y,max_drawdown_3y:s.max_drawdown_3y,distance_52w_high:s.distance_52w_high,pe_ratio:s.pe_ratio,roe:s.roe,de_ratio:s.de_ratio,net_margin:s.net_margin,fcf_yield:s.fcf_yield,dividend_yield:s.dividend_yield,buffett_score:s.buffett_score,buffett_grade:s.buffett_grade,quality_score:s.quality_score,quality_subscores:s.quality_subscores,sector:s.sector,sector_api:s.sector_api,industry:s.industry,country:s.country,region:s.region})}else{result.stocks.push({name:und,ticker:ticker,found:false})}});var found=result.stocks.filter(function(s){return s.found});if(found.length>0){result.worstMetrics={worst_buffett:Math.min.apply(null,found.map(function(s){return s.buffett_score!=null?s.buffett_score:50})),worst_quality:Math.min.apply(null,found.map(function(s){return s.quality_score!=null?s.quality_score:50})),max_volatility:Math.max.apply(null,found.map(function(s){return s.volatility_3y||30})),max_drawdown:Math.max.apply(null,found.map(function(s){return Math.abs(s.max_drawdown_3y||30)})),max_beta:Math.max.apply(null,found.map(function(s){return s.beta||1})),worst_name:found.reduce(function(w,s){return(s.buffett_score!=null?s.buffett_score:50)<(w.buffett_score!=null?w.buffett_score:50)?s:w}).name}}result.marketContext=mkt.context||null;return result;}
async function _loadCatBenchmark(){try{var rates=await github.readFile('data/cat-market-rates.json');if(rates){var list=Array.isArray(rates.rates||rates)?(rates.rates||rates):[];var best=list.reduce(function(b,r){var v=parseFloat(r.rate||r.taux)||0;return v>b.rate?{rate:v,bank:r.bank||r.banque}:b},{rate:0});if(best.rate>0)return{bestRate:best.rate,bestBank:best.bank,source:'market-rates'}}}catch(e){}try{var deps=await github.readFile('data/cat-deposits.json');if(deps){var dl=Array.isArray(deps.deposits||deps)?(deps.deposits||deps):[];var rs=dl.map(function(d){return parseFloat(d.rate||d.taux)||0}).filter(function(r){return r>0});if(rs.length>0)return{bestRate:Math.max.apply(null,rs),source:'portfolio-cat'}}}catch(e){}return{bestRate:3.0,source:'fallback'}}

// ═══════════════════════════════════════════════════════════════
// BASE SCORING — deterministic, no variability
// ═══════════════════════════════════════════════════════════════

function _computeP1(p) {
    var s = Math.min(100, p.coupon * 10);
    if (!p.capitalProtection) s -= 15;
    if (p.worstOf) s -= Math.max(0, (p.underlyings.length - 2) * 5);
    if (p.hasMemory) s += 5;
    if (p.couponType === 'garanti' || p.couponType === 'fixe') s += 15;
    var my = p.maturityYears || 0;
    if (my > 0 && my <= 3) s += 5; else if (my > 6 && my <= 10) s -= 5; else if (my > 10) s -= 10;
    return Math.max(0, Math.min(100, Math.round(s)));
}
function _computeP2(p, market) {
    if (!market.available || !market.worstMetrics) return 50;
    var wm = market.worstMetrics;
    var s = (wm.worst_buffett || 50) * 0.35 + (wm.worst_quality || 50) * 0.35 + Math.max(0, 100 - Math.max(0, (wm.max_volatility || 30) - 20) * 1) * 0.15 + Math.max(0, 100 - Math.max(0, (wm.max_drawdown || 30) - 25) * 0.8) * 0.15;
    if (market.stocks && market.stocks.length > 1) {
        var found = market.stocks.filter(function(x) { return x.found; });
        if (found.length > 1) { var sec = {}; found.forEach(function(x) { sec[(x.sector_api||'?').toLowerCase()] = 1; }); if (Object.keys(sec).length === 1) s -= 10; else if (Object.keys(sec).length < found.length) s -= 5; }
    }
    return Math.max(0, Math.min(100, Math.round(s)));
}
function _computeP3(p, portfolio, isInPf) {
    if (isInPf) return 70;
    if (!portfolio || !portfolio.available) return 70;
    var s = 70;
    s -= (portfolio.overlappingUnderlyings || []).length * 10;
    var newU = (p.underlyings || []).filter(function(u) { return !(portfolio.existingUnderlyings || []).some(function(e) { return e === u.toUpperCase(); }); });
    if (newU.length > 0) s += 10;
    return Math.max(0, Math.min(100, Math.round(s)));
}
function _computeP4(p, catRate) {
    var sp = p.coupon - (catRate || 3.0);
    if (sp >= 5) return 100; if (sp >= 4) return 90; if (sp >= 3) return 75; if (sp >= 2) return 60; if (sp >= 1) return 40; if (sp >= 0) return 20; return 5;
}

function _checkKillCriteria(p, cat) {
    var kc = GRADING_CONFIG.killCriteria, reasons = [];
    if (p.worstOf && p.underlyings.length > kc.maxWorstOfUnderlyings) reasons.push('Worst-of ' + p.underlyings.length + ' SJ (max ' + kc.maxWorstOfUnderlyings + ')');
    if (!p.capitalProtection && p.barrier !== 0 && p.barrier > kc.minBarrierWithoutProtection) reasons.push('Barrière ' + p.barrier + '% sans protection');
    if (p.coupon > 0 && (p.coupon - (cat.bestRate || 3)) < kc.minRiskPremiumVsCat) reasons.push('Prime vs CAT négative: ' + p.coupon + '% vs ' + cat.bestRate + '%');
    return { killed: reasons.length > 0, reasons: reasons };
}

function _isInPortfolio(id) { return (app.state.portfolio || []).some(function(p) { return p.id === id; }); }

async function _collectContext(product) {
    var n = _graderNormalize(product);
    var ctx = { product: n, market: { available: false }, portfolio: { available: false }, cat: { bestRate: 3.0, source: 'fallback' }, isInPortfolio: _isInPortfolio(product.id) };
    try { var mkt = await _loadAllMarketData(); if (mkt) ctx.market = _extractStockData(n, mkt); } catch(e) {}
    if (!ctx.isInPortfolio) {
        try { var pf = app.state.portfolio || []; if (pf.length > 0) { var eu = {}; pf.forEach(function(p) { _normalizeUnderlyings(p.underlyings || (p.aiParsed && p.aiParsed.underlyings) || []).forEach(function(u) { eu[u.toUpperCase()] = 1; }); }); ctx.portfolio = { available: true, totalProducts: pf.length, existingUnderlyings: Object.keys(eu), overlappingUnderlyings: n.underlyings.map(function(u) { return u.toUpperCase(); }).filter(function(u) { return eu[u]; }) }; } } catch(e) {}
    }
    try { ctx.cat = await _loadCatBenchmark(); } catch(e) {}
    return ctx;
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE — receives base scores, adjusts ±15 pts with context
// ═══════════════════════════════════════════════════════════════

function _buildSystemPrompt(isInPf) {
    return "Tu es un analyste de produits structurés expert.\n\n" +
    "Un scoring de base a été calculé pour ce produit. Tu dois :\n" +
    "1. AJUSTER chaque pilier de -15 à +15 points en fonction du CONTEXTE MARCHÉ\n" +
    "2. JUSTIFIER chaque ajustement en 1 phrase\n" +
    "3. Fournir un VERDICT de 3-4 phrases avec données concrètes\n" +
    "4. Lister 2-3 RISQUES CLÉS\n" +
    "5. Calculer des SCÉNARIOS chiffrés en €\n\n" +
    "RÈGLES D'AJUSTEMENT :\n" +
    "- P1 (Rendement) : ajuste selon la probabilité RÉELLE du coupon (distance barrière/vol)\n" +
    "- P2 (Qualité) : ajuste selon le contexte macro, momentum sectoriel, fondamentaux détaillés\n" +
    "- P4 (Prime) : ajuste si le spread est trompeur (coupon conditionnel vs garanti)\n" +
    (isInPf ? "- Ce produit est DÉJÀ en portefeuille. Analyse ses mérites propres uniquement.\n" : "- P3 (Fit) : ajuste selon la pertinence des sous-jacents pour le portefeuille\n") +
    "\nCOUPON : le champ 'coupon' est DÉJÀ ANNUALISÉ.\n\n" +
    "JSON UNIQUEMENT (pas de texte autour) :\n" +
    "{\"adjustments\":{\"p1\":{\"delta\":5,\"reason\":\"Barrière profonde + autocall = haute probabilité coupon\"},\"p2\":{\"delta\":-10,\"reason\":\"Secteur cyclique en retournement\"},\"p3\":{\"delta\":0,\"reason\":\"Neutre\"},\"p4\":{\"delta\":-5,\"reason\":\"Coupon conditionnel surestimé\"}},\"verdict\":\"3-4 phrases...\",\"keyRisks\":[\"r1\",\"r2\"],\"negotiationPoints\":[],\"scenarios\":{\"optimistic\":{\"return_pct\":7,\"return_eur\":7000,\"probability\":0.25,\"duration_years\":1},\"base\":{\"return_pct\":5,\"return_eur\":15000,\"probability\":0.35,\"duration_years\":3},\"stress\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.25,\"duration_years\":6},\"worst\":{\"return_pct\":-5,\"return_eur\":-5000,\"probability\":0.15,\"duration_years\":6}}}";
}

function _buildUserPrompt(ctx, base) {
    var p = ctx.product, m = ctx.market;
    var nom = p.nominal > 0 ? p.nominal : 100000;
    var pr = '## PRODUIT (nominal: ' + formatNumber(nom) + '€)\n';
    pr += 'Nom: ' + p.name + '\nCoupon annualisé: ' + p.coupon + '%';
    if (p.couponMultiplier > 1) pr += ' (' + p.couponRaw + '% × ' + p.couponMultiplier + ' ' + p.couponFrequency + ')';
    pr += '\nBarrière: ' + (p.barrier || 'N/A') + '% | Capital: ' + (p.capitalProtection ? 'protégé' : 'non protégé');
    pr += '\nMaturité: ' + (p.maturityYears || '?') + 'a | Autocall: ' + (p.autocall ? 'oui seuil ' + p.autocallThreshold + '%' : 'non');
    pr += '\nSous-jacents: ' + p.underlyings.join(', ') + (p.worstOf ? ' (worst-of)' : '') + '\n\n';
    if (m.available && m.stocks.length > 0) {
        pr += '## DONNÉES MARCHÉ\n';
        m.stocks.forEach(function(s) {
            if (!s.found) { pr += '- ' + s.name + ': NON TROUVÉ\n'; return; }
            pr += '- ' + s.name + ' (' + s.ticker + ', ' + (s.sector || '?') + '): Buffett=' + s.buffett_score + ', Quality=' + s.quality_score + ', vol=' + s.volatility_3y + '%, DD=' + s.max_drawdown_3y + '%, beta=' + s.beta + '\n';
            pr += '  ROE=' + s.roe + '%, marge=' + s.net_margin + '%, perf_1Y=' + s.perf_1y + '%, YTD=' + s.perf_ytd + '%\n';
        });
        if (m.worstMetrics) pr += 'Maillon faible: ' + m.worstMetrics.worst_name + '\n';
    }
    if (m.marketContext && m.marketContext.market_regime) {
        var mc = m.marketContext;
        pr += '\n## MACRO: régime=' + mc.market_regime;
        if (mc.macro_tilts) { if (mc.macro_tilts.favored_sectors) pr += ', favorisés=' + mc.macro_tilts.favored_sectors.join(','); if (mc.macro_tilts.avoided_sectors) pr += ', évités=' + mc.macro_tilts.avoided_sectors.join(','); }
        pr += '\n';
    }
    pr += '\n## SCORES DE BASE (déterministes)\n';
    pr += 'P1 (Rendement): ' + base.p1 + '/100 | P2 (Qualité): ' + base.p2 + '/100 | P3 (Fit): ' + base.p3 + '/100 | P4 (Prime vs CAT ' + ctx.cat.bestRate + '%): ' + base.p4 + '/100\n';
    pr += 'Score base: ' + base.total + '/100 → Grade base ' + base.grade + '\n';
    pr += '\nAJUSTE chaque pilier de -15 à +15 pts selon le contexte. Nominal simulation: ' + formatNumber(nom) + '€\n';
    return pr;
}

async function _callClaude(ctx, base) {
    var resp = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: _buildSystemPrompt(ctx.isInPortfolio),
            messages: [{ role: 'user', content: _buildUserPrompt(ctx, base) }] }) });
    if (!resp.ok) throw new Error('Claude API ' + resp.status);
    var data = await resp.json();
    var text = (data.content || []).filter(function(c) { return c.type === 'text'; }).map(function(c) { return c.text; }).join('');
    return _parseJSON(text);
}
function _parseJSON(t) { var c = t.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim(); try { return JSON.parse(c); } catch(e) {} var f = c.indexOf('{'), l = c.lastIndexOf('}'); if (f !== -1 && l > f) c = c.slice(f, l + 1); c = c.replace(/,\s*([}\]])/g, '$1'); return JSON.parse(c); }

// ═══════════════════════════════════════════════════════════════
// APPLY ADJUSTMENTS — clamp ±15, recalculate total
// ═══════════════════════════════════════════════════════════════

function _applyAdjustments(base, adj, weights) {
    var max = GRADING_CONFIG.maxAdjustment;
    var clamp = function(d) { return Math.max(-max, Math.min(max, d || 0)); };
    var cap = function(v) { return Math.max(0, Math.min(100, Math.round(v))); };

    var p1 = cap(base.p1 + clamp(adj.p1 && adj.p1.delta));
    var p2 = cap(base.p2 + clamp(adj.p2 && adj.p2.delta));
    var p3 = cap(base.p3 + clamp(adj.p3 && adj.p3.delta));
    var p4 = cap(base.p4 + clamp(adj.p4 && adj.p4.delta));
    var total = Math.round(p1 * weights.adjustedReturn + p2 * weights.underlyingQuality + p3 * weights.portfolioFit + p4 * weights.riskPremium);
    var grade = total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 25 ? 'D' : 'F';

    return { p1: p1, p2: p2, p3: p3, p4: p4, total: total, grade: grade,
        deltas: { p1: clamp(adj.p1 && adj.p1.delta), p2: clamp(adj.p2 && adj.p2.delta), p3: clamp(adj.p3 && adj.p3.delta), p4: clamp(adj.p4 && adj.p4.delta) },
        reasons: { p1: adj.p1 && adj.p1.reason || '', p2: adj.p2 && adj.p2.reason || '', p3: adj.p3 && adj.p3.reason || '', p4: adj.p4 && adj.p4.reason || '' }
    };
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

async function gradeProposal(product) {
    var t0 = Date.now();
    var ctx = await _collectContext(product);
    var p = ctx.product;
    var weights = ctx.isInPortfolio ? GRADING_CONFIG.weightsPortfolio : GRADING_CONFIG.weightsProposal;

    // Kill criteria
    var kill = _checkKillCriteria(p, ctx.cat);
    if (kill.killed) {
        var r = { grade: 'F', score: 0, killCriteria: { triggered: true, reasons: kill.reasons },
            pillars: { adjustedReturn: { score: null }, underlyingQuality: { score: null }, portfolioFit: { score: null }, riskPremium: { score: null } },
            verdict: 'Rejet: ' + kill.reasons[0], keyRisks: kill.reasons, scenarios: null,
            metadata: { gradedAt: new Date().toISOString(), durationMs: Date.now() - t0, aiUsed: false, version: '3.1' } };
        product.grading = r; return r;
    }

    // BASE deterministic scores
    var base = {
        p1: _computeP1(p), p2: _computeP2(p, ctx.market),
        p3: _computeP3(p, ctx.portfolio, ctx.isInPortfolio), p4: _computeP4(p, ctx.cat.bestRate)
    };
    base.total = Math.round(base.p1 * weights.adjustedReturn + base.p2 * weights.underlyingQuality + base.p3 * weights.portfolioFit + base.p4 * weights.riskPremium);
    base.grade = base.total >= 75 ? 'A' : base.total >= 60 ? 'B' : base.total >= 45 ? 'C' : base.total >= 25 ? 'D' : 'F';

    // CLAUDE adjustments
    var claudeResult = null, final = base, aiUsed = false;
    try {
        claudeResult = await _callClaude(ctx, base);
        if (claudeResult && claudeResult.adjustments) {
            final = _applyAdjustments(base, claudeResult.adjustments, weights);
            aiUsed = true;
        }
    } catch(e) { console.warn('[Grader] Claude:', e.message); }

    // Build reasoning strings
    function _reason(key, pillarName) {
        var baseStr = pillarName + ': base ' + base[key];
        if (aiUsed && final.deltas[key] !== 0) {
            baseStr += ' → ' + (final.deltas[key] > 0 ? '+' : '') + final.deltas[key] + ' = ' + final[key];
            if (final.reasons[key]) baseStr += ' (' + final.reasons[key] + ')';
        }
        return baseStr;
    }

    var result = {
        grade: final.grade, score: final.total,
        killCriteria: { triggered: false, reasons: [] },
        pillars: {
            adjustedReturn: { score: final.p1, base: base.p1, delta: final.deltas ? final.deltas.p1 : 0, reasoning: _reason('p1', 'Rendement') + ' | Coupon ' + p.coupon + '%' + (p.couponMultiplier > 1 ? ' (' + p.couponRaw + '×' + p.couponMultiplier + ')' : '') + (p.capitalProtection ? ', protégé' : '') },
            underlyingQuality: { score: final.p2, base: base.p2, delta: final.deltas ? final.deltas.p2 : 0, reasoning: _reason('p2', 'Qualité') + (ctx.market.worstMetrics ? ' | Worst: ' + ctx.market.worstMetrics.worst_name + ' B:' + ctx.market.worstMetrics.worst_buffett : '') },
            portfolioFit: { score: final.p3, base: base.p3, delta: final.deltas ? final.deltas.p3 : 0, reasoning: ctx.isInPortfolio ? 'En portefeuille — neutre' : _reason('p3', 'Fit') },
            riskPremium: { score: final.p4, base: base.p4, delta: final.deltas ? final.deltas.p4 : 0, reasoning: _reason('p4', 'Prime') + ' | ' + p.coupon + '% vs CAT ' + ctx.cat.bestRate + '%' }
        },
        verdict: claudeResult && claudeResult.verdict ? claudeResult.verdict : 'Score ' + final.total + '/100 (base ' + base.total + ').',
        keyRisks: claudeResult && claudeResult.keyRisks ? claudeResult.keyRisks : [],
        negotiationPoints: claudeResult && claudeResult.negotiationPoints ? claudeResult.negotiationPoints : [],
        scenarios: claudeResult && claudeResult.scenarios ? claudeResult.scenarios : null,
        metadata: {
            gradedAt: new Date().toISOString(), durationMs: Date.now() - t0, aiUsed: aiUsed, version: '3.1',
            marketDataAvailable: ctx.market.available, catBenchmark: ctx.cat.bestRate,
            couponAnnualized: p.coupon, couponRaw: p.couponRaw, couponMultiplier: p.couponMultiplier, couponFrequency: p.couponFrequency,
            isInPortfolio: ctx.isInPortfolio, baseScore: base.total, baseGrade: base.grade,
            adjustments: aiUsed ? final.deltas : null
        }
    };
    product.grading = result; return result;
}

async function gradeProposalsBatch(proposals, onProgress) {
    var results = [], total = proposals.length;
    for (var i = 0; i < total; i++) {
        try { var r = await gradeProposal(proposals[i]); results.push({ proposal: proposals[i], grading: r }); }
        catch(e) { results.push({ proposal: proposals[i], grading: { grade: '?', score: null, verdict: 'Erreur: ' + e.message } }); }
        if (onProgress) onProgress(i + 1, total, results[results.length - 1]);
        if (i < total - 1) await new Promise(function(r) { setTimeout(r, 1500); });
    }
    results.sort(function(a, b) { var o = { A:0, B:1, C:2, D:3, F:4, '?':5 }; return (o[a.grading.grade] || 5) - (o[b.grading.grade] || 5); });
    return results;
}

// ═══ UI ═══
function renderGradeBadge(g, s, size) { var cfg = GRADING_CONFIG.grades[g] || GRADING_CONFIG.grades.F, c = cfg.color; if (size === 'large') return '<div style="width:80px;height:80px;border-radius:50%;background:' + c + '22;border:3px solid ' + c + ';display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:32px;font-weight:700;color:' + c + '">' + g + '</span><span style="font-size:11px;color:' + c + ';opacity:0.8">' + (s !== null ? s + '/100' : '\u2014') + '</span></div>'; return '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:' + c + '22;color:' + c + ';font-weight:700;font-size:14px">' + g + '</span>'; }

function renderGradingSection(grading) {
    if (!grading) return '<div class="grading-section" style="padding:20px;text-align:center"><button onclick="triggerGrading(this)" class="btn primary" style="padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer">\ud83c\udfaf Lancer le grading</button></div>';
    var g = grading, cfg = GRADING_CONFIG.grades[g.grade] || GRADING_CONFIG.grades.F;
    var isPortfolio = g.metadata && g.metadata.isInPortfolio;
    var h = '<div class="grading-section"><div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">' + renderGradeBadge(g.grade, g.score, 'large') + '<div style="flex:1"><div style="font-size:18px;font-weight:600;color:' + cfg.color + '">Grade ' + g.grade + ' \u2014 ' + cfg.label + '</div><div style="font-size:13px;color:var(--text-muted);margin-top:4px">' + (g.verdict || '') + '</div></div></div>';
    if (g.killCriteria && g.killCriteria.triggered) h += '<div style="background:rgba(239,35,60,0.08);border:1px solid rgba(239,35,60,0.25);border-radius:8px;padding:12px;margin-bottom:16px"><div style="font-weight:600;color:#EF233C;margin-bottom:6px">\u26d4 Kill criteria</div>' + g.killCriteria.reasons.map(function(r) { return '<div style="font-size:12px;color:#EF233C;padding:2px 0">\u2022 ' + r + '</div>'; }).join('') + '</div>';
    if (g.metadata && g.metadata.couponMultiplier > 1) h += '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px"><strong style="color:var(--accent)">\u2139 Coupon</strong> : ' + g.metadata.couponRaw + '% \u00d7 ' + g.metadata.couponMultiplier + ' (' + g.metadata.couponFrequency + ') = <strong>' + g.metadata.couponAnnualized + '% annuel</strong></div>';
    // Base vs final info
    if (g.metadata && g.metadata.aiUsed && g.metadata.baseScore !== undefined) h += '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px">Base d\u00e9terministe: ' + g.metadata.baseScore + '/100 (' + g.metadata.baseGrade + ') \u2192 Apr\u00e8s ajustement IA: <strong>' + g.score + '/100 (' + g.grade + ')</strong></div>';
    var pn = { adjustedReturn: 'Rendement ajust\u00e9', underlyingQuality: 'Qualit\u00e9 sous-jacent', riskPremium: 'Prime vs CAT' };
    if (!isPortfolio) pn.portfolioFit = 'Fit portefeuille';
    var weights = isPortfolio ? GRADING_CONFIG.weightsPortfolio : GRADING_CONFIG.weightsProposal;
    if (g.pillars) { h += '<div style="margin-bottom:16px">'; ['adjustedReturn', 'underlyingQuality', 'portfolioFit', 'riskPremium'].forEach(function(k) { if (!pn[k]) return; var pl = g.pillars[k] || {}, sc = pl.score; if (sc === null || sc === undefined) return; var w = weights[k]; var bc = sc >= 70 ? '#06D6A0' : sc >= 45 ? '#FFB627' : '#EF233C'; var deltaStr = pl.delta && pl.delta !== 0 ? ' <span style="color:' + (pl.delta > 0 ? '#06D6A0' : '#EF233C') + ';font-size:10px">(' + (pl.delta > 0 ? '+' : '') + pl.delta + ' IA)</span>' : ''; h += '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--text-muted)">' + pn[k] + ' (' + Math.round(w * 100) + '%)</span><span style="font-weight:600">' + sc + '/100' + deltaStr + '</span></div><div style="height:6px;background:var(--bg-card,var(--surface));border-radius:3px;overflow:hidden"><div style="height:100%;width:' + sc + '%;background:' + bc + ';border-radius:3px"></div></div>' + (pl.reasoning ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + pl.reasoning + '</div>' : '') + '</div>'; }); h += '</div>'; }
    if (g.scenarios) { h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">'; [['optimistic', 'Optimiste', '#06D6A0'], ['base', 'Base', '#4ECDC4'], ['stress', 'Stress', '#FFB627'], ['worst', 'Worst', '#EF233C']].forEach(function(x) { var s = g.scenarios[x[0]]; if (!s) return; h += '<div style="text-align:center;padding:8px;border-radius:8px;background:' + x[2] + '15;border:1px solid ' + x[2] + '30"><div style="font-size:10px;color:var(--text-muted)">' + x[1] + '</div><div style="font-size:16px;font-weight:600;color:' + x[2] + '">' + ((s.return_eur || 0) >= 0 ? '+' : '') + (s.return_eur || 0).toLocaleString('fr-FR') + '\u20ac</div><div style="font-size:10px;color:var(--text-muted)">' + ((s.return_pct || 0) >= 0 ? '+' : '') + (s.return_pct || 0) + '% \u00b7 ' + Math.round((s.probability || 0) * 100) + '%</div></div>'; }); h += '</div>'; }
    if (g.keyRisks && g.keyRisks.length > 0) h += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><strong>Risques :</strong> ' + g.keyRisks.join(' \u00b7 ') + '</div>';
    if (g.grade === 'C' && g.negotiationPoints && g.negotiationPoints.length > 0) h += '<div style="font-size:12px;color:#FFB627;margin-bottom:8px"><strong>\u00c0 n\u00e9gocier :</strong> ' + g.negotiationPoints.join(' \u00b7 ') + '</div>';
    h += '<div style="font-size:10px;color:var(--text-muted);opacity:0.5;margin-top:8px">' + (g.metadata.aiUsed ? 'Hybride (base + IA)' : 'Local') + ' \u00b7 ' + new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR') + ' \u00b7 ' + g.metadata.durationMs + 'ms' + (isPortfolio ? ' \u00b7 Portefeuille' : '') + '</div>';
    h += '</div>'; return h;
}

window.ProposalGrader = { grade: gradeProposal, gradeBatch: gradeProposalsBatch, renderBadge: renderGradeBadge, renderSection: renderGradingSection, checkKillCriteria: _checkKillCriteria, normalize: _graderNormalize, config: GRADING_CONFIG, version: '3.1' };
console.log('[StructBoard] ProposalGrader v3.1 \u2014 hybrid: deterministic base + Claude ±15pts');

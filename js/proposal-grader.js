// STRUCTBOARD — Proposal Grader v4.3 — Expected maturity for autocall
// Change: P1 maturity adjustment uses EXPECTED maturity (not displayed)
// An autocall 10Y with annual observation has expected maturity ~2-3Y

const GRADING_CONFIG = {
    weightsProposal: { adjustedReturn: 0.30, underlyingQuality: 0.25, portfolioFit: 0.20, riskPremium: 0.25 },
    weightsPortfolio: { adjustedReturn: 0.35, underlyingQuality: 0.35, portfolioFit: 0, riskPremium: 0.30 },
    maxAdjustment: 15,
    grades: {
        A: { min: 75, label: 'Excellent', color: '#06D6A0' },
        B: { min: 60, label: 'Bon', color: '#4ECDC4' },
        C: { min: 45, label: 'Moyen', color: '#FFB627' },
        D: { min: 25, label: 'Faible', color: '#E85D04' },
        F: { min: 0,  label: 'Mauvais', color: '#EF233C' }
    },
    killCriteria: { maxWorstOfUnderlyings: 8 }
};

// ═══ PRODUCT TYPE DETECTION ═══
var LIQUIDITY_KEYWORDS = ['bond 12m', 'compartiment', 'fonds monetaire', 'fonds monétaire', 'money market', 'cash fund', 'tresorerie', 'trésorerie', 'sicav monetaire', 'opcvm monetaire', 'livret', 'compte a terme'];
function _isLiquidityProduct(product) { var name = ((product.name || '') + ' ' + (product.type || '')).toLowerCase(); return LIQUIDITY_KEYWORDS.some(function(kw) { return name.indexOf(kw) >= 0; }); }
var FIXED_RATE_KEYWORDS = ['taux fixe', 'fixed rate', 'callable bonus', 'note callable', 'obligation callable'];
function _isFixedRateCallable(product) { var name = (product.name || '').toLowerCase(); var hasFixedKw = FIXED_RATE_KEYWORDS.some(function(kw) { return name.indexOf(kw) >= 0; }); var isFixedCoupon = product.couponType === 'fixe' || product.couponType === 'garanti'; var noEquity = !product.underlyings || product.underlyings.length === 0; return hasFixedKw || (isFixedCoupon && product.capitalProtection && noEquity); }

// ═══ COUPON ANNUALIZATION ═══
var FREQUENCY_MULTIPLIERS = {'trimestriel':4,'trimestrielle':4,'trimestre':4,'quarterly':4,'q':4,'3m':4,'3 mois':4,'semestriel':2,'semestrielle':2,'semestre':2,'semi-annual':2,'semi-annuel':2,'6m':2,'6 mois':2,'mensuel':12,'mensuelle':12,'monthly':12,'1m':12,'mois':12,'annuel':1,'annuelle':1,'annual':1,'yearly':1,'an':1,'12m':1,'12 mois':1};
function _detectCouponFrequency(obj,name){var f=(obj.frequency||obj.frequence||'').toLowerCase().trim();if(f&&FREQUENCY_MULTIPLIERS[f])return{freq:f,mult:FREQUENCY_MULTIPLIERS[f],source:'explicit'};var n=(name||'').toLowerCase();var kw=[{p:/trimestriel/i,f:'trimestriel',m:4},{p:/semestriel/i,f:'semestriel',m:2},{p:/mensuel/i,f:'mensuel',m:12},{p:/quarterly/i,f:'quarterly',m:4},{p:/semi.?annu/i,f:'semestriel',m:2},{p:/monthly/i,f:'monthly',m:12}];for(var i=0;i<kw.length;i++)if(kw[i].p.test(n))return{freq:kw[i].f,mult:kw[i].m,source:'name'};return{freq:'annuel',mult:1,source:'default'};}
function _annualizeCoupon(raw,obj,name){if(!raw||raw<=0)return{annual:0,raw:0,mult:1,freq:'annuel',source:'zero'};var d=_detectCouponFrequency(obj,name);if(obj.annualized||obj.annualise)return{annual:raw,raw:raw,mult:1,freq:'annuel',source:'pre-annualized'};var a=raw*d.mult;if(d.mult>1&&a>30)return{annual:raw,raw:raw,mult:1,freq:'annuel',source:'sanity-cap'};return{annual:Math.round(a*1000)/1000,raw:raw,mult:d.mult,freq:d.freq,source:d.source};}

// ═══ NORMALIZE ═══
function _graderNormalize(product){var p=product||{},ai=p.aiParsed||{};var co=p.coupon||ai.coupon||{};var raw=typeof co==='number'?co:parseFloat(co.rate||co.annualized||co.taux)||0;var ci=_annualizeCoupon(raw,typeof co==='object'?co:{},p.name||ai.name||'');var pr=p.capitalProtection||ai.capitalProtection||{};var ar=p.earlyRedemption||ai.earlyRedemption||{};var und=_normalizeUnderlyings(p.underlyings||ai.underlyings||[]);
    // Detect autocall observation frequency
    var acFreq = (ar.frequency || ar.frequence || '').toLowerCase().trim();
    var acObsPerYear = 1; // default annual
    if (acFreq && FREQUENCY_MULTIPLIERS[acFreq]) acObsPerYear = FREQUENCY_MULTIPLIERS[acFreq];
    else { var nm = (p.name || ai.name || '').toLowerCase(); if (/trimestriel/i.test(nm)) acObsPerYear = 4; else if (/semestriel/i.test(nm)) acObsPerYear = 2; else if (/mensuel/i.test(nm) || /monthly/i.test(nm)) acObsPerYear = 12; }
    return{id:p.id||'',name:p.name||ai.name||'Inconnu',type:p.type||ai.type||'',coupon:ci.annual,couponRaw:ci.raw,couponMultiplier:ci.mult,couponFrequency:ci.freq,couponFrequencySource:ci.source,couponType:(typeof co==='object'?co.type:'')||'conditionnel',hasMemory:!!(typeof co==='object'&&(co.memory||co.memoire)),barrier:parseFloat(pr.barrier||pr.barriere||p.barrier)||0,capitalProtection:!!(pr.guaranteed||pr.garanti||pr.full||pr.protected===true||pr.protected==='true'),maturity:p.maturity||ai.maturity||'',maturityYears:parseFloat(p.maturityYears||ai.maturityYears)||0,autocall:!!(ar.enabled||ar.hasAutocall||ar.possible===true||ar.possible==='true'),autocallThreshold:parseFloat(ar.threshold||ar.trigger||ar.seuil)||100,autocallObsPerYear:acObsPerYear,underlyings:und,worstOf:und.length>1,nominal:parseFloat(p.investedAmount||p.nominal||p.montant)||0};}
function _normalizeUnderlyings(u){if(typeof u==='string')return u.split(/[,;\/]/).map(function(s){return s.trim()}).filter(Boolean);if(Array.isArray(u))return u.map(function(x){return typeof x==='string'?x.trim():(x.name||x.ticker||x.isin||'')}).filter(Boolean);return[];}

// ═══════════════════════════════════════════════════════════════
// EXPECTED MATURITY — autocall reduces effective duration
// ═══════════════════════════════════════════════════════════════
// For an autocall product, the displayed maturity is the MAX (worst case).
// The expected maturity depends on:
//   - Number of observation dates (frequency × years)
//   - Probability of call at each date (~45-50% if threshold = 100%)
//   - Higher threshold (>100%) = lower prob per date
//
// Formula: E[maturity] = Σ (prob_call_at_i × date_i) + prob_reach_maturity × maturity
//   where prob_call_at_i = p × (1-p)^(i-1)  (geometric distribution)
//
// Example: 10Y annual, threshold 100%, p=0.50 per date
//   E[maturity] = 0.50×1 + 0.25×2 + 0.125×3 + ... + (1-0.50)^10 × 10 ≈ 2.8Y

function _estimateExpectedMaturity(p) {
    var matMax = p.maturityYears || 0;
    if (matMax <= 0) return { expected: 0, max: 0, isEstimated: false };
    if (!p.autocall) return { expected: matMax, max: matMax, isEstimated: false };

    // Probability of call at each observation date
    // Threshold 100% → ~50% (at-the-money, roughly even odds)
    // Threshold 105% → ~40% (slightly out-of-money)
    // Threshold 110% → ~35%
    var threshold = p.autocallThreshold || 100;
    var probCallPerDate;
    if (threshold <= 100) probCallPerDate = 0.50;
    else if (threshold <= 105) probCallPerDate = 0.40;
    else if (threshold <= 110) probCallPerDate = 0.35;
    else probCallPerDate = 0.30;

    // Worst-of reduces call probability (ALL underlyings must be above threshold)
    if (p.worstOf && p.underlyings.length > 1) {
        // Approximate: prob_all_above = prob_single ^ sqrt(n) (correlated assets)
        probCallPerDate = Math.pow(probCallPerDate, Math.sqrt(p.underlyings.length));
    }

    // Observation dates
    var obsPerYear = p.autocallObsPerYear || 1;
    var totalObs = Math.floor(matMax * obsPerYear);
    if (totalObs <= 0) return { expected: matMax, max: matMax, isEstimated: false };

    // First observation typically at year 1 (skip first period)
    var firstObsYear = 1.0 / obsPerYear;
    if (firstObsYear < 0.5) firstObsYear = 1; // most products start at year 1

    // Calculate expected maturity using geometric distribution
    var expectedMat = 0;
    var probSurviving = 1.0; // prob of NOT having been called yet

    for (var i = 0; i < totalObs; i++) {
        var dateYear = firstObsYear + (i / obsPerYear);
        if (dateYear > matMax) break;

        var probCallHere = probSurviving * probCallPerDate;
        expectedMat += probCallHere * dateYear;
        probSurviving *= (1 - probCallPerDate);
    }
    // Add probability of reaching maturity
    expectedMat += probSurviving * matMax;

    // Round to 1 decimal
    expectedMat = Math.round(expectedMat * 10) / 10;

    return {
        expected: expectedMat,
        max: matMax,
        isEstimated: true,
        probCallPerDate: Math.round(probCallPerDate * 100),
        probReachMaturity: Math.round(probSurviving * 100),
        totalObsDates: totalObs
    };
}

// ═══ MARKET DATA ═══
var _mktCache=null,_mktCacheTs=0;
async function _loadAllMarketData(){if(_mktCache&&_mktCacheTs>Date.now()-3600000)return _mktCache;var r=await Promise.all([github.readFile('data/market/stocks_europe.json').catch(function(){return null}),github.readFile('data/market/stocks_us.json').catch(function(){return null}),github.readFile('data/market/sectors.json').catch(function(){return null}),github.readFile('data/market/markets.json').catch(function(){return null}),github.readFile('data/market/market_context.json').catch(function(){return null})]);_mktCache={stocksEurope:(r[0]&&r[0].stocks)?r[0].stocks:[],stocksUS:(r[1]&&r[1].stocks)?r[1].stocks:[],sectors:(r[2]&&r[2].sectors)?r[2].sectors:{},indices:(r[3]&&r[3].indices)?r[3].indices:{},context:r[4]||{}};_mktCacheTs=Date.now();return _mktCache;}
var STOCK_ALIASES={'DANONE':'BN','ENI':'ENI','TOTALENERGIES':'TTE','TOTAL':'TTE','LVMH':'MC','SCHNEIDER':'SU','ASML':'ASML','TESLA':'TSLA','ESTEE LAUDER':'EL','PHILIP MORRIS':'MO','FASTENAL':'FAST','PERNOD RICARD':'RI','BNP':'BNP','SOCIETE GENERALE':'GLE','AXA':'CS','SANOFI':'SAN','AIR LIQUIDE':'AI'};
function _resolveAlias(name){var u=name.toUpperCase().trim();if(typeof BANK_ALIASES!=='undefined'&&BANK_ALIASES[u])return BANK_ALIASES[u];return STOCK_ALIASES[u]||u;}
function _extractStockData(product,mkt){var all=[].concat(mkt.stocksEurope,mkt.stocksUS);var result={available:false,stocks:[],worstMetrics:null,marketContext:null};product.underlyings.forEach(function(und){var ticker=_resolveAlias(und);var s=all.find(function(x){return x.ticker===ticker||x.ticker===und.toUpperCase()||(x.name&&x.name.toUpperCase().indexOf(und.toUpperCase())>=0)||(x.name_api&&x.name_api.toUpperCase().indexOf(und.toUpperCase())>=0)});if(s){result.available=true;result.stocks.push({name:und,ticker:s.ticker,found:true,price:s.price,change_pct:s.change_percent,perf_ytd:s.perf_ytd,perf_1y:s.perf_1y,perf_3y:s.perf_3y,beta:s.beta,volatility_3y:s.volatility_3y,max_drawdown_3y:s.max_drawdown_3y,distance_52w_high:s.distance_52w_high,pe_ratio:s.pe_ratio,roe:s.roe,de_ratio:s.de_ratio,net_margin:s.net_margin,fcf_yield:s.fcf_yield,dividend_yield:s.dividend_yield,buffett_score:s.buffett_score,buffett_grade:s.buffett_grade,quality_score:s.quality_score,quality_subscores:s.quality_subscores,sector:s.sector,sector_api:s.sector_api,industry:s.industry,country:s.country,region:s.region})}else{result.stocks.push({name:und,ticker:ticker,found:false})}});var found=result.stocks.filter(function(s){return s.found});if(found.length>0){result.worstMetrics={worst_buffett:Math.min.apply(null,found.map(function(s){return s.buffett_score!=null?s.buffett_score:35})),worst_quality:Math.min.apply(null,found.map(function(s){return s.quality_score!=null?s.quality_score:35})),max_volatility:Math.max.apply(null,found.map(function(s){return s.volatility_3y||30})),max_drawdown:Math.max.apply(null,found.map(function(s){return Math.abs(s.max_drawdown_3y||30)})),max_beta:Math.max.apply(null,found.map(function(s){return s.beta||1})),worst_name:found.reduce(function(w,s){return(s.buffett_score!=null?s.buffett_score:35)<(w.buffett_score!=null?w.buffett_score:35)?s:w}).name}}result.marketContext=mkt.context||null;return result;}
async function _loadCatBenchmark(){try{var rates=await github.readFile('data/cat-market-rates.json');if(rates){var list=Array.isArray(rates.rates||rates)?(rates.rates||rates):[];var best=list.reduce(function(b,r){var v=parseFloat(r.rate||r.taux)||0;return v>b.rate?{rate:v,bank:r.bank||r.banque}:b},{rate:0});if(best.rate>0)return{bestRate:best.rate,bestBank:best.bank,source:'market-rates'}}}catch(e){}try{var deps=await github.readFile('data/cat-deposits.json');if(deps){var dl=Array.isArray(deps.deposits||deps)?(deps.deposits||deps):[];var rs=dl.map(function(d){return parseFloat(d.rate||d.taux)||0}).filter(function(r){return r>0});if(rs.length>0)return{bestRate:Math.max.apply(null,rs),source:'portfolio-cat'}}}catch(e){}return{bestRate:2.5,source:'fallback-2026'}}

// ═══ DETERMINISTIC BASE SCORING ═══

function _computeP1(p) {
    var s = Math.min(100, p.coupon * 10);
    if (!p.capitalProtection) {
        if (p.barrier > 0 && p.barrier < 100) {
            var barrierPenalty = Math.pow(Math.max(0, (p.barrier - 30) / 70), 1.5);
            s = s * (1 - barrierPenalty);
        } else { s -= 25; }
    }
    if (p.worstOf && p.underlyings.length > 2) { s -= Math.round(3 * Math.pow(p.underlyings.length - 2, 1.3)); }
    if (p.hasMemory) s += 5;
    if (p.couponType === 'garanti' || p.couponType === 'fixe') s += 15;

    // [v4.3] Use EXPECTED maturity for autocall products
    var matInfo = _estimateExpectedMaturity(p);
    var my = matInfo.expected || p.maturityYears || 0;
    if (my > 0 && my <= 3) s += 5; else if (my > 6 && my <= 10) s -= 5; else if (my > 10) s -= 10;
    // Store maturity info for display
    p._maturityInfo = matInfo;

    return Math.max(0, Math.min(100, Math.round(s)));
}

function _computeP2(p, market, productType) {
    if (productType === 'fixed-rate-callable') { var base = p.capitalProtection ? 70 : 55; if (p.maturityYears > 8) base -= 5; if (p.autocall) base += 5; return Math.max(0, Math.min(100, base)); }
    if (!market.available || !market.worstMetrics) return 35;
    var wm = market.worstMetrics; var hasBarrier = !p.capitalProtection && p.barrier > 0;
    var wB, wQ, wV, wD;
    if (hasBarrier) { wB = 0.20; wQ = 0.20; wV = 0.30; wD = 0.30; } else { wB = 0.35; wQ = 0.35; wV = 0.15; wD = 0.15; }
    var volC = Math.max(0, 100 - Math.max(0, (wm.max_volatility || 30) - 20) * 1.5);
    var ddC = Math.max(0, 100 - Math.max(0, (wm.max_drawdown || 30) - 25) * 1.2);
    var s = (wm.worst_buffett || 35) * wB + (wm.worst_quality || 35) * wQ + volC * wV + ddC * wD;
    if (market.stocks && market.stocks.length > 1) { var found = market.stocks.filter(function(x) { return x.found; }); if (found.length > 1) { var sec = {}; found.forEach(function(x) { sec[(x.sector_api || '?').toLowerCase()] = 1; }); if (Object.keys(sec).length === 1) s -= 10; else if (Object.keys(sec).length < found.length) s -= 5; } }
    return Math.max(0, Math.min(100, Math.round(s)));
}

function _computeP3(p, portfolio, isInPf) { if (isInPf) return 70; if (!portfolio || !portfolio.available) return 70; var s = 70; var overlap = portfolio.overlappingUnderlyings || []; for (var i = 0; i < overlap.length; i++) { s -= 10 + (i * 5); } var newU = (p.underlyings || []).filter(function(u) { return !(portfolio.existingUnderlyings || []).some(function(e) { return e === u.toUpperCase(); }); }); if (newU.length > 0) s += 10; return Math.max(0, Math.min(100, Math.round(s))); }

function _computeP4(p, catRate) { var spreadBps = (p.coupon - (catRate || 2.5)) * 100; if (spreadBps <= 0) return 5; if (spreadBps <= 400) { return Math.min(80, Math.max(5, Math.round(spreadBps / 5))); } var base = 80; var excess = spreadBps - 400; var bonus = 20 * (1 - Math.exp(-excess / 400)); return Math.min(100, Math.round(base + bonus)); }

function _checkKillCriteria(p, cat) { var reasons = []; if (p.worstOf && p.underlyings.length > GRADING_CONFIG.killCriteria.maxWorstOfUnderlyings) reasons.push('Worst-of ' + p.underlyings.length + ' sous-jacents (max ' + GRADING_CONFIG.killCriteria.maxWorstOfUnderlyings + ')'); return { killed: reasons.length > 0, reasons: reasons }; }

function _isInPortfolio(id){return(app.state.portfolio||[]).some(function(p){return p.id===id})}
async function _collectContext(product){var n=_graderNormalize(product);var ctx={product:n,market:{available:false},portfolio:{available:false},cat:{bestRate:2.5,source:'fallback-2026'},isInPortfolio:_isInPortfolio(product.id)};try{var mkt=await _loadAllMarketData();if(mkt)ctx.market=_extractStockData(n,mkt)}catch(e){}if(!ctx.isInPortfolio){try{var pf=app.state.portfolio||[];if(pf.length>0){var eu={};pf.forEach(function(p){_normalizeUnderlyings(p.underlyings||(p.aiParsed&&p.aiParsed.underlyings)||[]).forEach(function(u){eu[u.toUpperCase()]=1})});ctx.portfolio={available:true,totalProducts:pf.length,existingUnderlyings:Object.keys(eu),overlappingUnderlyings:n.underlyings.map(function(u){return u.toUpperCase()}).filter(function(u){return eu[u]})}}}catch(e){}}try{ctx.cat=await _loadCatBenchmark()}catch(e){}return ctx}

// ═══ CLAUDE PROMPT ═══
function _buildSystemPrompt(isInPf, productType) {
    var base = "Tu es un analyste de produits structurés expert.\n\nUn scoring de base a été calculé. Tu dois :\n1. AJUSTER chaque pilier de -15 à +15 points selon le CONTEXTE MARCHÉ\n2. JUSTIFIER chaque ajustement en 1 phrase\n3. VERDICT de 3-4 phrases avec données concrètes\n4. 2-3 RISQUES CLÉS\n5. SCÉNARIOS chiffrés en €\n\nSCÉNARIOS — GUIDE :\n- Optimiste : autocall rapide / coupon max / sortie favorable (proba 20-30%)\n- Base : scénario le plus probable, durée moyenne, coupons partiels (proba 30-40%)\n- Stress : marché en baisse, pas d'autocall, coupons suspendus mais capital OK (proba 20-30%)\n- Worst : crash, barrière franchie, perte en capital significative (proba 5-15%)\n\nRÈGLES D'AJUSTEMENT :\n- P1 (Rendement) : probabilité RÉELLE du coupon (distance barrière × vol)\n- P2 (Qualité) : contexte macro, fondamentaux, secteur\n- P4 (Prime) : ajuste si spread trompeur\n";
    if (productType === 'fixed-rate-callable') { base += "\n⚠ PRODUIT TAUX FIXE CALLABLE :\n- Pas de sous-jacent action — OBLIGATION callable\n- Risque = CRÉDIT ÉMETTEUR + RÉINVESTISSEMENT\n- Si rappelé tôt : bonus (5%/an) mais risque réinvestissement\n- Si maturité : 4%/an garanti\n- Scénarios : optimiste=rappelé an 1-3, base=rappelé an 4-6, stress=maturité (4%/an), worst=défaut\n"; }
    base += (isInPf ? "\n- Ce produit est DÉJÀ en portefeuille. Mérites propres uniquement.\n" : "\n- P3 (Fit) : pertinence des sous-jacents pour le portefeuille\n");
    base += "\n⚠ RÈGLE ANTI-MOMENTUM : NE PAS utiliser perf YTD/1Y comme justification POSITIVE pour P2.\nCOUPON : le champ 'coupon' est DÉJÀ ANNUALISÉ.\n\nJSON UNIQUEMENT :\n{\"adjustments\":{\"p1\":{\"delta\":5,\"reason\":\"...\"},\"p2\":{\"delta\":-10,\"reason\":\"...\"},\"p3\":{\"delta\":0,\"reason\":\"...\"},\"p4\":{\"delta\":-5,\"reason\":\"...\"}},\"verdict\":\"3-4 phrases...\",\"keyRisks\":[\"r1\",\"r2\"],\"negotiationPoints\":[],\"scenarios\":{\"optimistic\":{\"return_pct\":7,\"return_eur\":7000,\"probability\":0.25,\"duration_years\":1},\"base\":{\"return_pct\":5,\"return_eur\":15000,\"probability\":0.35,\"duration_years\":3},\"stress\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.25,\"duration_years\":6},\"worst\":{\"return_pct\":-5,\"return_eur\":-5000,\"probability\":0.15,\"duration_years\":6}}}";
    return base;
}

function _buildUserPrompt(ctx, base, productType) { var p = ctx.product, m = ctx.market; var nom = p.nominal > 0 ? p.nominal : 100000; var pr = '## PRODUIT (nominal: ' + formatNumber(nom) + '€)\n'; if (productType === 'fixed-rate-callable') pr += '⚠ TYPE: OBLIGATION TAUX FIXE CALLABLE\n'; pr += 'Nom: ' + p.name + '\nCoupon annualisé: ' + p.coupon + '%'; if (p.couponMultiplier > 1) pr += ' (' + p.couponRaw + '% × ' + p.couponMultiplier + ' ' + p.couponFrequency + ')'; pr += '\nBarrière: ' + (p.barrier || 'N/A') + '%' + (p.barrier > 0 ? ' (SJ peut baisser de ' + (100 - p.barrier) + '%)' : '') + ' | Capital: ' + (p.capitalProtection ? 'protégé' : 'non protégé');
    // Show expected maturity
    var matInfo = p._maturityInfo || _estimateExpectedMaturity(p);
    pr += '\nMaturité: ' + (p.maturityYears || '?') + 'a';
    if (matInfo.isEstimated) pr += ' (espérée: ~' + matInfo.expected + 'a, prob call/date: ' + matInfo.probCallPerDate + '%, prob maturité: ' + matInfo.probReachMaturity + '%)';
    pr += ' | Autocall: ' + (p.autocall ? 'oui' + (productType === 'fixed-rate-callable' ? ' (émetteur)' : ' seuil ' + p.autocallThreshold + '%') : 'non');
    pr += '\nSous-jacents: ' + (p.underlyings.length > 0 ? p.underlyings.join(', ') : 'AUCUN (taux)') + (p.worstOf ? ' (worst-of)' : '') + '\n\n'; if (m.available && m.stocks.length > 0) { pr += '## DONNÉES MARCHÉ\n'; m.stocks.forEach(function(s) { if (!s.found) { pr += '- ' + s.name + ': NON TROUVÉ\n'; return; } pr += '- ' + s.name + ' (' + s.ticker + ', ' + (s.sector || '?') + '): Buffett=' + s.buffett_score + ', Quality=' + s.quality_score + ', vol=' + s.volatility_3y + '%, DD=' + s.max_drawdown_3y + '%, beta=' + s.beta + '\n'; pr += '  ROE=' + s.roe + '%, marge=' + s.net_margin + '%, perf_1Y=' + s.perf_1y + '%, YTD=' + s.perf_ytd + '%\n'; }); if (m.worstMetrics) pr += 'Maillon faible: ' + m.worstMetrics.worst_name + '\n'; } if (m.marketContext && m.marketContext.market_regime) { var mc = m.marketContext; pr += '\n## MACRO: régime=' + mc.market_regime; if (mc.macro_tilts) { if (mc.macro_tilts.favored_sectors) pr += ', favorisés=' + mc.macro_tilts.favored_sectors.join(','); if (mc.macro_tilts.avoided_sectors) pr += ', évités=' + mc.macro_tilts.avoided_sectors.join(','); } pr += '\n'; } pr += '\n## SCORES DE BASE (v4.3)\nP1: ' + base.p1 + '/100 | P2: ' + base.p2 + '/100' + (productType === 'fixed-rate-callable' ? ' [crédit]' : '') + ' | P3: ' + base.p3 + '/100 | P4: ' + base.p4 + '/100\n'; pr += 'Score base: ' + base.total + '/100 → ' + base.grade + '\nAJUSTE ±15 pts/pilier. Nominal: ' + formatNumber(nom) + '€\n'; return pr; }

async function _callClaude(ctx, base, productType) { var resp = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: _buildSystemPrompt(ctx.isInPortfolio, productType), messages: [{ role: 'user', content: _buildUserPrompt(ctx, base, productType) }] }) }); if (!resp.ok) throw new Error('Claude API ' + resp.status); var data = await resp.json(); var text = (data.content || []).filter(function(c) { return c.type === 'text'; }).map(function(c) { return c.text; }).join(''); return _parseJSON(text); }
function _parseJSON(t) { var c = t.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim(); try { return JSON.parse(c); } catch(e) {} var f = c.indexOf('{'), l = c.lastIndexOf('}'); if (f !== -1 && l > f) c = c.slice(f, l + 1); c = c.replace(/,\s*([}\]])/g, '$1'); return JSON.parse(c); }
function _applyAdjustments(base, adj, weights) { var max = GRADING_CONFIG.maxAdjustment; var clamp = function(d) { return Math.max(-max, Math.min(max, d || 0)); }; var cap = function(v) { return Math.max(0, Math.min(100, Math.round(v))); }; var p1 = cap(base.p1 + clamp(adj.p1 && adj.p1.delta)); var p2 = cap(base.p2 + clamp(adj.p2 && adj.p2.delta)); var p3 = cap(base.p3 + clamp(adj.p3 && adj.p3.delta)); var p4 = cap(base.p4 + clamp(adj.p4 && adj.p4.delta)); var total = Math.round(p1 * weights.adjustedReturn + p2 * weights.underlyingQuality + p3 * weights.portfolioFit + p4 * weights.riskPremium); var grade = total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 25 ? 'D' : 'F'; return { p1: p1, p2: p2, p3: p3, p4: p4, total: total, grade: grade, deltas: { p1: clamp(adj.p1 && adj.p1.delta), p2: clamp(adj.p2 && adj.p2.delta), p3: clamp(adj.p3 && adj.p3.delta), p4: clamp(adj.p4 && adj.p4.delta) }, reasons: { p1: adj.p1 && adj.p1.reason || '', p2: adj.p2 && adj.p2.reason || '', p3: adj.p3 && adj.p3.reason || '', p4: adj.p4 && adj.p4.reason || '' } }; }

// ═══ MAIN ORCHESTRATOR ═══
async function gradeProposal(product) {
    var t0 = Date.now(); var ctx = await _collectContext(product); var p = ctx.product;
    if (_isLiquidityProduct(p)) { var lr = { grade: '-', score: null, killCriteria: { triggered: false, reasons: [] }, pillars: { adjustedReturn: { score: null }, underlyingQuality: { score: null }, portfolioFit: { score: null }, riskPremium: { score: null } }, verdict: 'Produit de liquidit\u00e9 / parking cash.', keyRisks: ['Rendement tr\u00e8s faible', 'Alternative : CAT ou livret'], scenarios: null, metadata: { gradedAt: new Date().toISOString(), durationMs: Date.now() - t0, aiUsed: false, version: '4.3', productType: 'liquidity', isInPortfolio: ctx.isInPortfolio } }; product.grading = lr; return lr; }
    var productType = _isFixedRateCallable(p) ? 'fixed-rate-callable' : 'standard';
    var weights = ctx.isInPortfolio ? GRADING_CONFIG.weightsPortfolio : GRADING_CONFIG.weightsProposal;
    var kill = _checkKillCriteria(p, ctx.cat);
    if (kill.killed) { var r = { grade: 'F', score: 0, killCriteria: { triggered: true, reasons: kill.reasons }, pillars: { adjustedReturn: { score: null }, underlyingQuality: { score: null }, portfolioFit: { score: null }, riskPremium: { score: null } }, verdict: 'Rejet: ' + kill.reasons[0], keyRisks: kill.reasons, scenarios: null, metadata: { gradedAt: new Date().toISOString(), durationMs: Date.now() - t0, aiUsed: false, version: '4.3', productType: productType } }; product.grading = r; return r; }
    var base = { p1: _computeP1(p), p2: _computeP2(p, ctx.market, productType), p3: _computeP3(p, ctx.portfolio, ctx.isInPortfolio), p4: _computeP4(p, ctx.cat.bestRate) };
    base.total = Math.round(base.p1 * weights.adjustedReturn + base.p2 * weights.underlyingQuality + base.p3 * weights.portfolioFit + base.p4 * weights.riskPremium);
    base.grade = base.total >= 75 ? 'A' : base.total >= 60 ? 'B' : base.total >= 45 ? 'C' : base.total >= 25 ? 'D' : 'F';
    var claudeResult = null, final = base, aiUsed = false;
    try { claudeResult = await _callClaude(ctx, base, productType); if (claudeResult && claudeResult.adjustments) { final = _applyAdjustments(base, claudeResult.adjustments, weights); aiUsed = true; } } catch(e) { console.warn('[Grader] Claude:', e.message); }
    function _reason(key, name) { var s = name + ': base ' + base[key]; if (aiUsed && final.deltas[key] !== 0) { s += ' \u2192 ' + (final.deltas[key] > 0 ? '+' : '') + final.deltas[key] + ' = ' + final[key]; if (final.reasons[key]) s += ' (' + final.reasons[key] + ')'; } return s; }

    // Maturity info for display
    var matInfo = p._maturityInfo || _estimateExpectedMaturity(p);
    var matNote = '';
    if (matInfo.isEstimated) matNote = ' | Mat esp\u00e9r\u00e9e: ~' + matInfo.expected + 'a (max ' + matInfo.max + 'a, prob mat: ' + matInfo.probReachMaturity + '%)';

    var result = { grade: final.grade, score: final.total, killCriteria: { triggered: false, reasons: [] },
        pillars: {
            adjustedReturn: { score: final.p1, base: base.p1, delta: final.deltas ? final.deltas.p1 : 0, reasoning: _reason('p1', 'Rendement') + ' | Coupon ' + p.coupon + '%' + (p.couponMultiplier > 1 ? ' (' + p.couponRaw + '\u00d7' + p.couponMultiplier + ')' : '') + (p.capitalProtection ? ', prot\u00e9g\u00e9' : p.barrier > 0 ? ', barri\u00e8re ' + p.barrier + '%' : '') + matNote },
            underlyingQuality: { score: final.p2, base: base.p2, delta: final.deltas ? final.deltas.p2 : 0, reasoning: _reason('p2', 'Qualit\u00e9') + (productType === 'fixed-rate-callable' ? ' [cr\u00e9dit]' : (!p.capitalProtection && p.barrier > 0 ? ' [vol/DD 30%]' : ' [B/Q 35%]')) + (ctx.market.worstMetrics ? ' | Worst: ' + ctx.market.worstMetrics.worst_name + ' B:' + ctx.market.worstMetrics.worst_buffett : '') },
            portfolioFit: { score: final.p3, base: base.p3, delta: final.deltas ? final.deltas.p3 : 0, reasoning: ctx.isInPortfolio ? 'En portefeuille \u2014 neutre' : _reason('p3', 'Fit') },
            riskPremium: { score: final.p4, base: base.p4, delta: final.deltas ? final.deltas.p4 : 0, reasoning: _reason('p4', 'Prime') + ' | ' + p.coupon + '% vs CAT ' + ctx.cat.bestRate + '% (spread ' + (p.coupon - ctx.cat.bestRate).toFixed(1) + '%)' }
        },
        verdict: claudeResult && claudeResult.verdict ? claudeResult.verdict : 'Score ' + final.total + '/100 (base ' + base.total + ').',
        keyRisks: claudeResult && claudeResult.keyRisks ? claudeResult.keyRisks : [],
        negotiationPoints: claudeResult && claudeResult.negotiationPoints ? claudeResult.negotiationPoints : [],
        scenarios: claudeResult && claudeResult.scenarios ? claudeResult.scenarios : null,
        metadata: { gradedAt: new Date().toISOString(), durationMs: Date.now() - t0, aiUsed: aiUsed, version: '4.3', productType: productType, marketDataAvailable: ctx.market.available, catBenchmark: ctx.cat.bestRate, catSource: ctx.cat.source, couponAnnualized: p.coupon, couponRaw: p.couponRaw, couponMultiplier: p.couponMultiplier, couponFrequency: p.couponFrequency, isInPortfolio: ctx.isInPortfolio, hasBarrier: !p.capitalProtection && p.barrier > 0, barrierPct: p.barrier, expectedMaturity: matInfo.expected, maxMaturity: matInfo.max, probReachMaturity: matInfo.probReachMaturity, baseScore: base.total, baseGrade: base.grade, adjustments: aiUsed ? final.deltas : null }
    };
    product.grading = result; return result;
}

async function gradeProposalsBatch(proposals, onProgress) { var results = [], total = proposals.length; for (var i = 0; i < total; i++) { try { var r = await gradeProposal(proposals[i]); results.push({ proposal: proposals[i], grading: r }); } catch(e) { results.push({ proposal: proposals[i], grading: { grade: '?', score: null, verdict: 'Erreur: ' + e.message } }); } if (onProgress) onProgress(i + 1, total, results[results.length - 1]); if (i < total - 1) await new Promise(function(r) { setTimeout(r, 1500); }); } results.sort(function(a, b) { var o = { A:0, B:1, C:2, D:3, F:4, '-':5, '?':6 }; return (o[a.grading.grade] || 6) - (o[b.grading.grade] || 6); }); return results; }

// ═══ UI ═══
function renderGradeBadge(g, s, size) { if (g === '-') return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + (size === 'large' ? '80px;height:80px;border-radius:50%;font-size:24px' : '28px;height:28px;border-radius:6px;font-size:12px') + ';background:#94A3B822;color:#94A3B8;font-weight:700">$</span>'; var cfg = GRADING_CONFIG.grades[g] || GRADING_CONFIG.grades.F, c = cfg.color; if (size === 'large') return '<div style="width:80px;height:80px;border-radius:50%;background:' + c + '22;border:3px solid ' + c + ';display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:32px;font-weight:700;color:' + c + '">' + g + '</span><span style="font-size:11px;color:' + c + ';opacity:0.8">' + (s !== null ? s + '/100' : '\u2014') + '</span></div>'; return '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:' + c + '22;color:' + c + ';font-weight:700;font-size:14px">' + g + '</span>'; }

function renderGradingSection(grading) {
    if (!grading) return '<div class="grading-section" style="padding:20px;text-align:center"><button onclick="triggerGrading(this)" class="btn primary" style="padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer">\ud83c\udfaf Lancer le grading</button></div>';
    var g = grading;
    if (g.grade === '-') return '<div class="grading-section" style="padding:16px"><div style="display:flex;align-items:center;gap:16px"><div style="width:64px;height:64px;border-radius:50%;background:#94A3B822;display:flex;align-items:center;justify-content:center"><span style="font-size:28px;color:#94A3B8">$</span></div><div><div style="font-size:16px;font-weight:600;color:#94A3B8">Liquidit\u00e9 / Parking Cash</div><div style="font-size:13px;color:var(--text-muted);margin-top:4px">' + (g.verdict || '') + '</div></div></div></div>';
    var cfg = GRADING_CONFIG.grades[g.grade] || GRADING_CONFIG.grades.F;
    var isPortfolio = g.metadata && g.metadata.isInPortfolio;
    var isCallable = g.metadata && g.metadata.productType === 'fixed-rate-callable';
    var h = '<div class="grading-section"><div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">' + renderGradeBadge(g.grade, g.score, 'large') + '<div style="flex:1"><div style="font-size:18px;font-weight:600;color:' + cfg.color + '">Grade ' + g.grade + ' \u2014 ' + cfg.label + '</div><div style="font-size:13px;color:var(--text-muted);margin-top:4px">' + (g.verdict || '') + '</div></div></div>';
    if (g.killCriteria && g.killCriteria.triggered) h += '<div style="background:rgba(239,35,60,0.08);border:1px solid rgba(239,35,60,0.25);border-radius:8px;padding:12px;margin-bottom:16px"><div style="font-weight:600;color:#EF233C;margin-bottom:6px">\u26d4 Kill criteria</div>' + g.killCriteria.reasons.map(function(r) { return '<div style="font-size:12px;color:#EF233C;padding:2px 0">\u2022 ' + r + '</div>'; }).join('') + '</div>';
    if (g.metadata && g.metadata.couponMultiplier > 1) h += '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px"><strong style="color:var(--accent)">\u2139 Coupon</strong> : ' + g.metadata.couponRaw + '% \u00d7 ' + g.metadata.couponMultiplier + ' (' + g.metadata.couponFrequency + ') = <strong>' + g.metadata.couponAnnualized + '% annuel</strong></div>';
    if (isCallable) h += '<div style="background:rgba(78,205,196,0.08);border:1px solid rgba(78,205,196,0.2);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px"><strong style="color:#4ECDC4">\u2139 Taux Fixe Callable</strong> : L\'\u00e9metteur peut rappeler le produit chaque ann\u00e9e. Si rappel\u00e9 : bonus 5%/an. Sinon : 4%/an garanti \u00e0 maturit\u00e9.</div>';
    // Expected maturity info box
    if (g.metadata && g.metadata.expectedMaturity && g.metadata.maxMaturity && g.metadata.expectedMaturity < g.metadata.maxMaturity * 0.8) {
        h += '<div style="background:rgba(147,130,246,0.08);border:1px solid rgba(147,130,246,0.2);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px"><strong style="color:#9382F6">\u23f1 Maturit\u00e9 esp\u00e9r\u00e9e</strong> : ~' + g.metadata.expectedMaturity + ' ans (max ' + g.metadata.maxMaturity + ' ans). Probabilit\u00e9 d\'aller \u00e0 maturit\u00e9 : ' + (g.metadata.probReachMaturity || '?') + '%</div>';
    }
    if (g.metadata && g.metadata.aiUsed && g.metadata.baseScore !== undefined) h += '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px">Base: ' + g.metadata.baseScore + '/100 (' + g.metadata.baseGrade + ') \u2192 IA: <strong>' + g.score + '/100 (' + g.grade + ')</strong></div>';
    var pn = { adjustedReturn: 'Rendement ajust\u00e9', underlyingQuality: isCallable ? 'Qualit\u00e9 cr\u00e9dit' : 'Qualit\u00e9 sous-jacent', riskPremium: 'Prime vs CAT' };
    if (!isPortfolio) pn.portfolioFit = 'Fit portefeuille';
    var weights = isPortfolio ? GRADING_CONFIG.weightsPortfolio : GRADING_CONFIG.weightsProposal;
    if (g.pillars) { h += '<div style="margin-bottom:16px">'; ['adjustedReturn', 'underlyingQuality', 'portfolioFit', 'riskPremium'].forEach(function(k) { if (!pn[k]) return; var pl = g.pillars[k] || {}, sc = pl.score; if (sc === null || sc === undefined) return; var w = weights[k]; var bc = sc >= 70 ? '#06D6A0' : sc >= 45 ? '#FFB627' : '#EF233C'; var deltaStr = pl.delta && pl.delta !== 0 ? ' <span style="color:' + (pl.delta > 0 ? '#06D6A0' : '#EF233C') + ';font-size:10px">(' + (pl.delta > 0 ? '+' : '') + pl.delta + ' IA)</span>' : ''; h += '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--text-muted)">' + pn[k] + ' (' + Math.round(w * 100) + '%)</span><span style="font-weight:600">' + sc + '/100' + deltaStr + '</span></div><div style="height:6px;background:var(--bg-card,var(--surface));border-radius:3px;overflow:hidden"><div style="height:100%;width:' + sc + '%;background:' + bc + ';border-radius:3px"></div></div>' + (pl.reasoning ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + pl.reasoning + '</div>' : '') + '</div>'; }); h += '</div>'; }
    if (g.scenarios) { h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">'; [['optimistic', 'Optimiste', '#06D6A0'], ['base', 'Base', '#4ECDC4'], ['stress', 'Stress', '#FFB627'], ['worst', 'Worst', '#EF233C']].forEach(function(x) { var s = g.scenarios[x[0]]; if (!s) return; h += '<div style="text-align:center;padding:8px;border-radius:8px;background:' + x[2] + '15;border:1px solid ' + x[2] + '30"><div style="font-size:10px;color:var(--text-muted)">' + x[1] + '</div><div style="font-size:16px;font-weight:600;color:' + x[2] + '">' + ((s.return_eur || 0) >= 0 ? '+' : '') + (s.return_eur || 0).toLocaleString('fr-FR') + '\u20ac</div><div style="font-size:10px;color:var(--text-muted)">' + ((s.return_pct || 0) >= 0 ? '+' : '') + (s.return_pct || 0) + '% \u00b7 ' + Math.round((s.probability || 0) * 100) + '%</div></div>'; }); h += '</div>'; }
    if (g.keyRisks && g.keyRisks.length > 0) h += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><strong>Risques :</strong> ' + g.keyRisks.join(' \u00b7 ') + '</div>';
    if (g.grade === 'C' && g.negotiationPoints && g.negotiationPoints.length > 0) h += '<div style="font-size:12px;color:#FFB627;margin-bottom:8px"><strong>\u00c0 n\u00e9gocier :</strong> ' + g.negotiationPoints.join(' \u00b7 ') + '</div>';
    h += '<div style="font-size:10px;color:var(--text-muted);opacity:0.5;margin-top:8px">v4.3' + (g.metadata.aiUsed ? ' Hybride' : ' Local') + ' \u00b7 ' + new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR') + ' \u00b7 ' + g.metadata.durationMs + 'ms \u00b7 CAT ' + (g.metadata.catBenchmark || '?') + '% (' + (g.metadata.catSource || '?') + ')' + (isPortfolio ? ' \u00b7 Portefeuille' : '') + (isCallable ? ' \u00b7 Callable' : '') + (g.metadata.hasBarrier ? ' \u00b7 P2 vol/DD 30%' : '') + '</div>';
    h += '</div>'; return h;
}

window.ProposalGrader = { grade: gradeProposal, gradeBatch: gradeProposalsBatch, renderBadge: renderGradeBadge, renderSection: renderGradingSection, checkKillCriteria: _checkKillCriteria, normalize: _graderNormalize, config: GRADING_CONFIG, isLiquidity: _isLiquidityProduct, isFixedRateCallable: _isFixedRateCallable, estimateExpectedMaturity: _estimateExpectedMaturity, version: '4.3' };
console.log('[StructBoard] ProposalGrader v4.3 \u2014 expected maturity for autocall');

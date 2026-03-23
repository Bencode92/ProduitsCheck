// STRUCTBOARD — Proposal Grader v2.1 — Smart coupon annualization
// Loads: stocks_europe.json, stocks_us.json, sectors.json, markets.json, market_context.json

const GRADING_CONFIG = {
    weights: { adjustedReturn: 0.30, underlyingQuality: 0.25, portfolioFit: 0.25, riskPremium: 0.20 },
    grades: {
        A: { min: 75, label: 'Intégrer', color: '#06D6A0' },
        B: { min: 60, label: 'Intégrer', color: '#4ECDC4' },
        C: { min: 45, label: 'Négocier', color: '#FFB627' },
        D: { min: 25, label: 'Rejeter',  color: '#E85D04' },
        F: { min: 0,  label: 'Rejeter',  color: '#EF233C' }
    },
    killCriteria: { maxWorstOfUnderlyings: 5, minBarrierWithoutProtection: -50, minRiskPremiumVsCat: 0, maxSameUnderlying: 1 }
};

// ═══════════════════════════════════════════════════════════════
// SMART COUPON ANNUALIZATION
// ═══════════════════════════════════════════════════════════════
// Detects frequency from: coupon.frequency, product name, rate value
// Multipliers: trimestriel=4, semestriel=2, mensuel=12, annuel=1

var FREQUENCY_MULTIPLIERS = {
    'trimestriel': 4, 'trimestrielle': 4, 'trimestre': 4, 'quarterly': 4, 'q': 4, '3m': 4, '3 mois': 4,
    'semestriel': 2, 'semestrielle': 2, 'semestre': 2, 'semi-annual': 2, 'semi-annuel': 2, '6m': 2, '6 mois': 2,
    'mensuel': 12, 'mensuelle': 12, 'monthly': 12, '1m': 12, 'mois': 12,
    'annuel': 1, 'annuelle': 1, 'annual': 1, 'yearly': 1, 'an': 1, '12m': 1, '12 mois': 1
};

function _detectCouponFrequency(couponObj, productName) {
    // 1. Explicit frequency field
    var freq = (couponObj.frequency || couponObj.frequence || '').toLowerCase().trim();
    if (freq && FREQUENCY_MULTIPLIERS[freq]) return { freq: freq, mult: FREQUENCY_MULTIPLIERS[freq], source: 'explicit' };

    // 2. Search in product name
    var name = (productName || '').toLowerCase();
    var nameKeywords = [
        { pattern: /trimestriel/i, freq: 'trimestriel', mult: 4 },
        { pattern: /semestriel/i, freq: 'semestriel', mult: 2 },
        { pattern: /mensuel/i, freq: 'mensuel', mult: 12 },
        { pattern: /quarterly/i, freq: 'quarterly', mult: 4 },
        { pattern: /semi.?annu/i, freq: 'semestriel', mult: 2 },
        { pattern: /monthly/i, freq: 'monthly', mult: 12 }
    ];
    for (var i = 0; i < nameKeywords.length; i++) {
        if (nameKeywords[i].pattern.test(name)) return { freq: nameKeywords[i].freq, mult: nameKeywords[i].mult, source: 'name' };
    }

    // 3. Heuristic: if rate is suspiciously low (<3%) and not a rate product, likely sub-annual
    // BNP typical: 1.875% quarterly = 7.5% annual
    // Don't auto-detect if could be a real low annual coupon (e.g., bonds at 2%)

    return { freq: 'annuel', mult: 1, source: 'default' };
}

function _annualizeCoupon(rawRate, couponObj, productName) {
    if (!rawRate || rawRate <= 0) return { annual: 0, raw: 0, mult: 1, freq: 'annuel', source: 'zero' };

    var detection = _detectCouponFrequency(couponObj, productName);

    // If already explicitly marked as annual or annualized field exists, use as-is
    if (couponObj.annualized || couponObj.annualise) {
        return { annual: rawRate, raw: rawRate, mult: 1, freq: 'annuel', source: 'pre-annualized' };
    }

    var annual = rawRate * detection.mult;

    // Sanity check: if annualized > 30%, probably already annual
    if (detection.mult > 1 && annual > 30) {
        return { annual: rawRate, raw: rawRate, mult: 1, freq: 'annuel', source: 'sanity-cap' };
    }

    return { annual: Math.round(annual * 1000) / 1000, raw: rawRate, mult: detection.mult, freq: detection.freq, source: detection.source };
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZE PRODUCT — with smart coupon
// ═══════════════════════════════════════════════════════════════

function _graderNormalize(product) {
    var p = product || {}, ai = p.aiParsed || {};
    var couponObj = p.coupon || ai.coupon || {};
    var rawRate = typeof couponObj === 'number' ? couponObj : parseFloat(couponObj.rate || couponObj.annualized || couponObj.taux) || 0;

    // Smart annualization
    var couponInfo = _annualizeCoupon(rawRate, typeof couponObj === 'object' ? couponObj : {}, p.name || ai.name || '');
    var couponRate = couponInfo.annual;

    var protObj = p.capitalProtection || ai.capitalProtection || {};
    var barrier = parseFloat(protObj.barrier || protObj.barriere || p.barrier) || 0;
    var autoObj = p.earlyRedemption || ai.earlyRedemption || {};
    var underlyings = _normalizeUnderlyings(p.underlyings || ai.underlyings || []);
    var bankId = p.bankId || '';
    var bankConfig = (typeof BANKS !== 'undefined') ? BANKS.find(function(b){return b.id===bankId}) : null;
    return {
        name: p.name||ai.name||'Inconnu',
        issuer: bankConfig?bankConfig.name:(p.issuer||p.emetteur||bankId),
        bankId: bankId,
        type: p.type||ai.type||'',
        coupon: couponRate,
        couponRaw: couponInfo.raw,
        couponMultiplier: couponInfo.mult,
        couponFrequency: couponInfo.freq,
        couponFrequencySource: couponInfo.source,
        couponType: (typeof couponObj === 'object' ? couponObj.type : '') || 'conditionnel',
        hasMemory: !!(typeof couponObj === 'object' && (couponObj.memory||couponObj.memoire)),
        barrier: barrier,
        barrierType: protObj.type||'européenne',
        capitalProtection: !!(protObj.guaranteed||protObj.garanti||protObj.full||protObj.protected===true||protObj.protected==='true'),
        maturity: p.maturity||ai.maturity||'',
        maturityYears: parseFloat(p.maturityYears||ai.maturityYears)||0,
        autocall: !!(autoObj.enabled||autoObj.hasAutocall||autoObj.possible===true||autoObj.possible==='true'),
        autocallThreshold: parseFloat(autoObj.threshold||autoObj.trigger||autoObj.seuil)||100,
        underlyings: underlyings,
        worstOf: underlyings.length>1,
        nominal: parseFloat(p.investedAmount||p.nominal||p.montant)||0
    };
}
function _normalizeUnderlyings(u) { if(typeof u==='string')return u.split(/[,;\/]/).map(function(s){return s.trim()}).filter(Boolean); if(Array.isArray(u))return u.map(function(x){return typeof x==='string'?x.trim():(x.name||x.ticker||x.isin||'')}).filter(Boolean); return []; }

var _mktCache=null,_mktCacheTs=0;
async function _loadAllMarketData(){
    if(_mktCache&&_mktCacheTs>Date.now()-3600000)return _mktCache;
    var r=await Promise.all([github.readFile('data/market/stocks_europe.json').catch(function(){return null}),github.readFile('data/market/stocks_us.json').catch(function(){return null}),github.readFile('data/market/sectors.json').catch(function(){return null}),github.readFile('data/market/markets.json').catch(function(){return null}),github.readFile('data/market/market_context.json').catch(function(){return null})]);
    _mktCache={stocksEurope:(r[0]&&r[0].stocks)?r[0].stocks:[],stocksUS:(r[1]&&r[1].stocks)?r[1].stocks:[],sectors:(r[2]&&r[2].sectors)?r[2].sectors:{},indices:(r[3]&&r[3].indices)?r[3].indices:{},context:r[4]||{}};
    _mktCacheTs=Date.now();
    console.log('[Grader] Market:',_mktCache.stocksEurope.length,'EU,',_mktCache.stocksUS.length,'US stocks');
    return _mktCache;
}

var STOCK_ALIASES={'DANONE':'BN','ENI':'ENI','TOTALENERGIES':'TTE','TOTAL':'TTE','LVMH':'MC','SCHNEIDER':'SU','ASML':'ASML','TESLA':'TSLA','ESTEE LAUDER':'EL','PHILIP MORRIS':'MO','FASTENAL':'FAST','PERNOD RICARD':'RI','BNP':'BNP','SOCIETE GENERALE':'GLE','AXA':'CS','SANOFI':'SAN','AIR LIQUIDE':'AI'};
function _resolveAlias(name){var u=name.toUpperCase().trim();if(typeof BANK_ALIASES!=='undefined'&&BANK_ALIASES[u])return BANK_ALIASES[u];return STOCK_ALIASES[u]||u;}

function _extractStockData(product,mkt){
    var all=[].concat(mkt.stocksEurope,mkt.stocksUS);
    var result={available:false,stocks:[],worstMetrics:null,sectorData:null,marketContext:null,indicesContext:null};
    product.underlyings.forEach(function(und){
        var ticker=_resolveAlias(und);
        var s=all.find(function(x){return x.ticker===ticker||x.ticker===und.toUpperCase()||(x.name&&x.name.toUpperCase().indexOf(und.toUpperCase())>=0)||(x.name_api&&x.name_api.toUpperCase().indexOf(und.toUpperCase())>=0)});
        if(s){result.available=true;result.stocks.push({name:und,ticker:s.ticker,found:true,price:s.price,change_pct:s.change_percent,perf_ytd:s.perf_ytd,perf_1y:s.perf_1y,perf_3y:s.perf_3y,beta:s.beta,volatility_3y:s.volatility_3y,max_drawdown_3y:s.max_drawdown_3y,distance_52w_high:s.distance_52w_high,pe_ratio:s.pe_ratio,roe:s.roe,de_ratio:s.de_ratio,net_margin:s.net_margin,fcf_yield:s.fcf_yield,dividend_yield:s.dividend_yield,buffett_score:s.buffett_score,buffett_grade:s.buffett_grade,quality_score:s.quality_score,quality_subscores:s.quality_subscores,sector:s.sector,sector_api:s.sector_api,industry:s.industry,country:s.country,region:s.region})}
        else{result.stocks.push({name:und,ticker:ticker,found:false})}
    });
    var found=result.stocks.filter(function(s){return s.found});
    if(found.length>0){result.worstMetrics={worst_buffett:Math.min.apply(null,found.map(function(s){return s.buffett_score!=null?s.buffett_score:100})),worst_quality:Math.min.apply(null,found.map(function(s){return s.quality_score!=null?s.quality_score:100})),worst_perf_1y:Math.min.apply(null,found.map(function(s){return s.perf_1y!=null?s.perf_1y:0})),max_volatility:Math.max.apply(null,found.map(function(s){return s.volatility_3y||0})),max_drawdown:Math.max.apply(null,found.map(function(s){return Math.abs(s.max_drawdown_3y||0)})),max_beta:Math.max.apply(null,found.map(function(s){return s.beta||1})),worst_name:found.reduce(function(w,s){return(s.buffett_score!=null?s.buffett_score:100)<(w.buffett_score!=null?w.buffett_score:100)?s:w}).name}}
    if(found.length>0&&mkt.sectors){var seen={},info=[];found.forEach(function(s){var sk=(s.sector_api||'').toLowerCase();if(!sk||seen[sk])return;seen[sk]=1;Object.keys(mkt.sectors).forEach(function(key){if(info.some(function(i){return i.sector===s.sector}))return;var etfs=mkt.sectors[key];var match=etfs.find(function(e){return(e.sector_en||'').toLowerCase().replace(/[^a-z]/g,'').indexOf(sk.replace(/[^a-z]/g,''))>=0});if(match)info.push({sector:s.sector||key,ytd:match.ytd_num,m3:match.m3_num,m6:match.m6_num,w52:match.w52_num,trend:match.trend})})});result.sectorData=info}
    result.marketContext=mkt.context||null;
    var euIdx=mkt.indices.europe||[];
    result.indicesContext={eurozone:euIdx.find(function(i){return i.symbol==='FEZ'}),france:euIdx.find(function(i){return i.symbol==='EWQ'}),netherlands:euIdx.find(function(i){return i.symbol==='EWN'})};
    return result;
}

function _analyzePortfolioContext(product,portfolio){
    var products=portfolio||[];var totalAmount=products.reduce(function(s,p){return s+(parseFloat(p.investedAmount||p.nominal)||0)},0);
    var issuerAmounts={};products.forEach(function(p){var k=(p.bankId||'?').toUpperCase();issuerAmounts[k]=(issuerAmounts[k]||0)+(parseFloat(p.investedAmount||p.nominal)||0)});
    var issuerConc={};Object.keys(issuerAmounts).forEach(function(k){issuerConc[k]=totalAmount>0?issuerAmounts[k]/totalAmount:0});
    var typeCounts={};products.forEach(function(p){var t=(p.type||'autre').toUpperCase();typeCounts[t]=(typeCounts[t]||0)+1});
    var existingUnds={};products.forEach(function(p){_normalizeUnderlyings(p.underlyings||(p.aiParsed&&p.aiParsed.underlyings)||[]).forEach(function(u){existingUnds[u.toUpperCase()]=1})});
    var coupons=products.map(function(p){var c=p.coupon;return typeof c==='number'?c:parseFloat(c&&c.rate||0)}).filter(function(c){return c>0});
    var avgCoupon=coupons.length>0?Math.round((coupons.reduce(function(a,b){return a+b},0)/coupons.length)*100)/100:0;
    var overlap=product.underlyings.map(function(u){return u.toUpperCase()}).filter(function(u){return existingUnds[u]});
    return{available:true,totalProducts:products.length,totalAmount:totalAmount,issuerConcentration:issuerConc,currentIssuerPct:issuerConc[(product.bankId||'').toUpperCase()]||0,typeCounts:typeCounts,existingUnderlyings:Object.keys(existingUnds),overlappingUnderlyings:overlap,avgCoupon:avgCoupon};
}

async function _loadCatBenchmark(){try{var rates=await github.readFile('data/cat-market-rates.json');if(rates){var list=Array.isArray(rates.rates||rates)?(rates.rates||rates):[];var best=list.reduce(function(b,r){var v=parseFloat(r.rate||r.taux)||0;return v>b.rate?{rate:v,bank:r.bank||r.banque}:b},{rate:0});if(best.rate>0)return{bestRate:best.rate,bestBank:best.bank,source:'market-rates'}}}catch(e){}try{var deps=await github.readFile('data/cat-deposits.json');if(deps){var dl=Array.isArray(deps.deposits||deps)?(deps.deposits||deps):[];var rs=dl.map(function(d){return parseFloat(d.rate||d.taux)||0}).filter(function(r){return r>0});if(rs.length>0)return{bestRate:Math.max.apply(null,rs),source:'portfolio-cat'}}}catch(e){}return{bestRate:3.0,source:'fallback'}}

function _checkKillCriteria(product,pfCtx,catBench){var kc=GRADING_CONFIG.killCriteria,reasons=[];if(product.worstOf&&product.underlyings.length>kc.maxWorstOfUnderlyings)reasons.push('Worst-of sur '+product.underlyings.length+' sous-jacents (max: '+kc.maxWorstOfUnderlyings+')');if(!product.capitalProtection&&product.barrier!==0&&product.barrier>kc.minBarrierWithoutProtection)reasons.push('Barrière '+product.barrier+'% sans protection capital');var bestCat=catBench.bestRate||3.0;if(product.coupon>0&&(product.coupon-bestCat)<kc.minRiskPremiumVsCat)reasons.push('Prime vs CAT négative: coupon '+product.coupon+'% vs CAT '+bestCat+'%');if(pfCtx.available&&pfCtx.overlappingUnderlyings&&pfCtx.overlappingUnderlyings.length>kc.maxSameUnderlying)reasons.push(pfCtx.overlappingUnderlyings.length+' sous-jacents déjà en portefeuille');return{killed:reasons.length>0,reasons:reasons}}

async function _collectGradingContext(product){var ctx={product:_graderNormalize(product),market:{available:false},portfolio:{available:false,totalProducts:0,totalAmount:0},cat:{bestRate:3.0,source:'fallback'}};try{var mkt=await _loadAllMarketData();if(mkt)ctx.market=_extractStockData(ctx.product,mkt)}catch(e){console.warn('[Grader] Market:',e.message)}try{var pf=app.state.portfolio||[];if(pf.length>0)ctx.portfolio=_analyzePortfolioContext(ctx.product,pf)}catch(e){}try{ctx.cat=await _loadCatBenchmark()}catch(e){}return ctx}

function _buildSystemPrompt(){return"Tu es un analyste de produits structurés pour une trésorerie d'entreprise.\nNote un produit structuré sur 4 piliers puis attribue un grade A/B/C/D/F.\n\n## DISTINCTION CRITIQUE : ÉMETTEUR ≠ SOUS-JACENT\nL'ÉMETTEUR = risque CRÉDIT (contrepartie). Les SOUS-JACENTS = risque MARCHÉ.\nNe confonds JAMAIS les deux.\n\n## COUPON : UTILISE LE TAUX ANNUALISÉ\nLe champ 'coupon' fourni est DÉJÀ ANNUALISÉ. Si couponMultiplier > 1, le coupon brut par période est 'couponRaw'.\nExemple : couponRaw=1.875% × 4 (trimestriel) = coupon=7.5% annuel. UTILISE 7.5% pour l'analyse.\n\n## Pilier 1 — Rendement ajusté (30%)\nScore /100. Coupon ANNUALISÉ × probabilité de versement. -15 non protégé. -5/und worst-of >2. +5 mémoire, +15 garanti.\nMaturité: +5 si ≤3a, 0 si 3-6a, -5 si 6-10a, -10 si >10a.\n\n## Pilier 2 — Qualité sous-jacent (25%)\nBuffett + Quality score. Vol, Max DD, Beta. Worst-of = PIRE. Corrélation penalty si même secteur.\n\n## Pilier 3 — Fit portefeuille (25%)\nConcentration émetteur -20 si >30%. Type -15 si >60%. Overlap -10/doublon. +15 nouveau secteur.\n\n## Pilier 4 — Prime vs CAT (20%)\nCompare RENDEMENT AJUSTÉ ANNUALISÉ (pas facial) au CAT. >4%→90-100. 2.5-4%→70-89. 1.5-2.5%→40-69. 0-1.5%→10-39. <0→0.\n\nScore = P1×0.30 + P2×0.25 + P3×0.25 + P4×0.20. A ≥ 75, B 60-74, C 45-59, D 25-44, F < 25.\n\nIMPORTANT: Utilise le MONTANT NOMINAL pour les scénarios (return_eur).\nIMPORTANT: Le verdict doit mentionner le coupon ANNUALISÉ et sa fréquence.\n\nJSON valide UNIQUEMENT:\n{\"grade\":\"C\",\"score\":48,\"pillars\":{\"adjustedReturn\":{\"score\":55,\"couponEffective\":4.2,\"couponProbability\":0.60,\"reasoning\":\"...\"},\"underlyingQuality\":{\"score\":65,\"worstStock\":\"EL\",\"keyRisk\":\"...\",\"reasoning\":\"...\"},\"portfolioFit\":{\"score\":30,\"issuerOverlap\":true,\"diversificationBenefit\":false,\"reasoning\":\"...\"},\"riskPremium\":{\"score\":40,\"spreadVsCat\":1.2,\"catBenchmark\":3.0,\"reasoning\":\"...\"}},\"verdict\":\"...\",\"keyRisks\":[\"r1\"],\"negotiationPoints\":[\"p1\"],\"scenarios\":{\"optimistic\":{\"return_pct\":7,\"return_eur\":4200,\"probability\":0.20,\"duration_years\":1},\"base\":{\"return_pct\":5,\"return_eur\":6000,\"probability\":0.30,\"duration_years\":3},\"stress\":{\"return_pct\":0,\"return_eur\":0,\"probability\":0.30,\"duration_years\":6},\"worst\":{\"return_pct\":-8,\"return_eur\":-12000,\"probability\":0.20,\"duration_years\":6}}}"}

function _buildUserPrompt(context){
    var product=context.product,market=context.market,portfolio=context.portfolio,cat=context.cat;
    var simNominal=product.nominal>0?product.nominal:Math.round((portfolio.totalAmount||300000)*0.10);

    // Coupon info with annualization details
    var couponNote = '';
    if (product.couponMultiplier > 1) {
        couponNote = '\n⚠ COUPON ANNUALISÉ: ' + product.couponRaw + '% × ' + product.couponMultiplier + ' (' + product.couponFrequency + ') = ' + product.coupon + '% annuel (détecté via: ' + product.couponFrequencySource + ')';
    }

    var p='## PRODUIT (nominal: '+formatNumber(simNominal)+'€)'+couponNote+'\n'+JSON.stringify(product,null,2)+'\n\n';
    if(market.available&&market.stocks.length>0){p+='## DONNÉES SOUS-JACENTS\n';market.stocks.forEach(function(s){if(!s.found){p+='- '+s.name+' ('+s.ticker+') : NON TROUVÉ\n';return}p+='- '+s.name+' ('+s.ticker+', '+s.country+', '+s.sector+')\n';p+='  Fondamentaux: ROE='+s.roe+'%, DE='+s.de_ratio+', marge='+s.net_margin+'%, FCF='+s.fcf_yield+'%, PE='+s.pe_ratio+'\n';p+='  Scores: Buffett='+s.buffett_score+'/100 ('+s.buffett_grade+'), Quality='+s.quality_score+'/100';if(s.quality_subscores)p+=' [Q:'+s.quality_subscores.quality+' S:'+s.quality_subscores.safety+' V:'+s.quality_subscores.value+' G:'+s.quality_subscores.growth+']';p+='\n  Risque: beta='+s.beta+', vol_3Y='+s.volatility_3y+'%, max_dd_3Y='+s.max_drawdown_3y+'%, dist_52w='+s.distance_52w_high+'%\n';p+='  Perf: YTD='+s.perf_ytd+'%, 1Y='+s.perf_1y+'%, 3Y='+s.perf_3y+'%\n'});if(market.worstMetrics){var wm=market.worstMetrics;p+='\nWORST-OF (maillon faible='+wm.worst_name+'): buffett='+wm.worst_buffett+', quality='+wm.worst_quality+', vol='+wm.max_volatility+'%, dd='+wm.max_drawdown+'%, beta='+wm.max_beta+'\n'}}else{p+='## DONNÉES MARCHÉ NON DISPONIBLES\n'}
    if(market.sectorData&&market.sectorData.length>0){p+='\n## SECTEURS\n';market.sectorData.forEach(function(s){p+='- '+s.sector+': YTD='+s.ytd+'%, 3M='+s.m3+'%, trend='+s.trend+'\n'})}
    if(market.marketContext&&market.marketContext.market_regime){var mc=market.marketContext;p+='\n## MACRO: régime='+mc.market_regime;if(mc.macro_tilts){if(mc.macro_tilts.favored_sectors)p+=', favorisés='+mc.macro_tilts.favored_sectors.join(',');if(mc.macro_tilts.avoided_sectors)p+=', évités='+mc.macro_tilts.avoided_sectors.join(',')}p+='\n';if(mc.risks)p+='Risques: '+mc.risks.slice(0,2).join(' | ')+'\n'}
    if(market.indicesContext){p+='\n## INDICES\n';if(market.indicesContext.eurozone)p+='- Zone Euro: YTD='+market.indicesContext.eurozone.ytd_num+'%\n';if(market.indicesContext.netherlands)p+='- Pays-Bas: YTD='+market.indicesContext.netherlands.ytd_num+'%\n'}
    if(portfolio.available){p+='\n## PORTEFEUILLE ('+portfolio.totalProducts+' produits, '+formatNumber(portfolio.totalAmount)+'€)\n';p+='- Coupon moyen: '+portfolio.avgCoupon+'%\n';p+='- Concentration '+product.issuer+': '+Math.round((portfolio.currentIssuerPct||0)*100)+'%\n';p+='- Types: '+JSON.stringify(portfolio.typeCounts)+'\n';p+='- Overlap: '+(portfolio.overlappingUnderlyings.length>0?portfolio.overlappingUnderlyings.join(', '):'aucun')+'\n'}
    p+='\n## CAT: '+cat.bestRate+'%'+(cat.bestBank?' ('+cat.bestBank+')':'')+'\nMONTANT SIMULATION: '+formatNumber(simNominal)+'€\n';
    return p;
}

async function _callClaude(context){var resp=await fetch(CONFIG.AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:2500,system:_buildSystemPrompt(),messages:[{role:'user',content:_buildUserPrompt(context)}]})});if(!resp.ok)throw new Error('Claude API '+resp.status);var data=await resp.json();var text=(data.content||[]).filter(function(c){return c.type==='text'}).map(function(c){return c.text}).join('');return _parseJSON(text)}
function _parseJSON(text){var c=text.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();try{return JSON.parse(c)}catch(e){}var f=c.indexOf('{'),l=c.lastIndexOf('}');if(f!==-1&&l>f)c=c.slice(f,l+1);c=c.replace(/,\s*([}\]])/g,'$1');return JSON.parse(c)}

function _localFallback(ctx){var p=ctx.product,cat=ctx.cat,pf=ctx.portfolio;var p1=Math.min(100,(p.coupon/10)*100);if(!p.capitalProtection)p1-=15;if(p.worstOf)p1-=Math.max(0,(p.underlyings.length-2)*5);if(p.hasMemory)p1+=5;p1=Math.max(0,Math.min(100,p1));var p2=50;if(ctx.market.available&&ctx.market.worstMetrics){var wm=ctx.market.worstMetrics;p2=Math.min(100,Math.max(0,(wm.worst_buffett||50)*0.4+(wm.worst_quality||50)*0.3+Math.max(0,100-(wm.max_volatility||30))*0.3))}var p3=70;if(pf.available){if(pf.currentIssuerPct>0.3)p3-=20;p3-=(pf.overlappingUnderlyings?pf.overlappingUnderlyings.length:0)*10}p3=Math.max(0,Math.min(100,p3));var spread=p.coupon-(cat.bestRate||3.0);var p4=spread>=4?95:spread>=2.5?75:spread>=1.5?50:spread>=0?25:5;var score=Math.round(p1*0.30+p2*0.25+p3*0.25+p4*0.20);var grade=score>=75?'A':score>=60?'B':score>=45?'C':score>=25?'D':'F';return{grade:grade,score:score,killCriteria:{triggered:false,reasons:[]},pillars:{adjustedReturn:{score:Math.round(p1),reasoning:'Coupon annualisé '+p.coupon+'%'+(p.couponMultiplier>1?' ('+p.couponRaw+'%×'+p.couponMultiplier+')':'')},underlyingQuality:{score:Math.round(p2),reasoning:'Local'},portfolioFit:{score:Math.round(p3),reasoning:'Local'},riskPremium:{score:Math.round(p4),spreadVsCat:Math.round(spread*100)/100,reasoning:'Local'}},verdict:'Score local '+score+'/100.'+(p.couponMultiplier>1?' Coupon '+p.couponRaw+'% '+p.couponFrequency+' = '+p.coupon+'% annuel.':''),keyRisks:[],negotiationPoints:[],scenarios:null}}

function _normalizeResult(raw){var r=Object.assign({},raw);r.score=Math.max(0,Math.min(100,parseInt(r.score)||0));r.grade=r.score>=75?'A':r.score>=60?'B':r.score>=45?'C':r.score>=25?'D':'F';if(r.killCriteria&&r.killCriteria.triggered){r.grade='F';r.score=0}if(r.pillars)Object.keys(r.pillars).forEach(function(k){var p=r.pillars[k];if(p&&typeof p.score==='number')p.score=Math.max(0,Math.min(100,p.score))});return r}

async function gradeProposal(product){var t0=Date.now();var ctx=await _collectGradingContext(product);var kill=_checkKillCriteria(ctx.product,ctx.portfolio,ctx.cat);if(kill.killed){var r={grade:'F',score:0,killCriteria:{triggered:true,reasons:kill.reasons},pillars:{adjustedReturn:{score:null},underlyingQuality:{score:null},portfolioFit:{score:null},riskPremium:{score:null}},verdict:'Rejet automatique: '+kill.reasons[0],keyRisks:kill.reasons,scenarios:null,metadata:{gradedAt:new Date().toISOString(),durationMs:Date.now()-t0,aiUsed:false,version:'2.1',marketDataAvailable:ctx.market.available}};product.grading=r;return r}var ai;try{ai=await _callClaude(ctx)}catch(e){console.error('[Grader] Claude:',e);ai=_localFallback(ctx)}var result=_normalizeResult(ai);result.killCriteria=result.killCriteria||{triggered:false,reasons:[]};result.metadata={gradedAt:new Date().toISOString(),durationMs:Date.now()-t0,aiUsed:true,version:'2.1',marketDataAvailable:ctx.market.available,catBenchmark:ctx.cat.bestRate,couponAnnualized:ctx.product.coupon,couponRaw:ctx.product.couponRaw,couponMultiplier:ctx.product.couponMultiplier,couponFrequency:ctx.product.couponFrequency};product.grading=result;return result}

async function gradeProposalsBatch(proposals,onProgress){var results=[],total=proposals.length;for(var i=0;i<total;i++){try{var r=await gradeProposal(proposals[i]);results.push({proposal:proposals[i],grading:r})}catch(e){results.push({proposal:proposals[i],grading:{grade:'?',score:null,verdict:'Erreur: '+e.message}})}if(onProgress)onProgress(i+1,total,results[results.length-1]);if(i<total-1)await new Promise(function(r){setTimeout(r,1500)})}var order={A:0,B:1,C:2,D:3,F:4,'?':5};results.sort(function(a,b){return(order[a.grading.grade]||5)-(order[b.grading.grade]||5)||(b.grading.score||0)-(a.grading.score||0)});return results}

function renderGradeBadge(grade,score,size){var cfg=GRADING_CONFIG.grades[grade]||GRADING_CONFIG.grades.F,c=cfg.color;if(size==='large')return'<div style="width:80px;height:80px;border-radius:50%;background:'+c+'22;border:3px solid '+c+';display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:32px;font-weight:700;color:'+c+'">'+grade+'</span><span style="font-size:11px;color:'+c+';opacity:0.8">'+(score!==null?score+'/100':'\u2014')+'</span></div>';return'<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:'+c+'22;color:'+c+';font-weight:700;font-size:14px">'+grade+'</span>'}

function renderGradingSection(grading){
    if(!grading)return'<div class="grading-section" style="padding:20px;text-align:center"><button onclick="triggerGrading(this)" class="btn primary" style="padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer">\ud83c\udfaf Lancer le grading unifi\u00e9</button></div>';
    var g=grading,cfg=GRADING_CONFIG.grades[g.grade]||GRADING_CONFIG.grades.F;
    var h='<div class="grading-section"><div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">'+renderGradeBadge(g.grade,g.score,'large')+'<div style="flex:1"><div style="font-size:18px;font-weight:600;color:'+cfg.color+'">Grade '+g.grade+' \u2014 '+cfg.label+'</div><div style="font-size:13px;color:var(--text-muted);margin-top:4px">'+(g.verdict||'')+'</div></div></div>';
    if(g.killCriteria&&g.killCriteria.triggered)h+='<div style="background:rgba(239,35,60,0.08);border:1px solid rgba(239,35,60,0.25);border-radius:8px;padding:12px;margin-bottom:16px"><div style="font-weight:600;color:#EF233C;margin-bottom:6px">\u26d4 Kill criteria</div>'+g.killCriteria.reasons.map(function(r){return'<div style="font-size:12px;color:#EF233C;padding:2px 0">\u2022 '+r+'</div>'}).join('')+'</div>';
    // Show coupon annualization info if applicable
    if(g.metadata&&g.metadata.couponMultiplier>1)h+='<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px"><strong style="color:var(--accent)">\u2139 Coupon annualis\u00e9</strong> : '+g.metadata.couponRaw+'% \u00d7 '+g.metadata.couponMultiplier+' ('+g.metadata.couponFrequency+') = <strong>'+g.metadata.couponAnnualized+'% annuel</strong></div>';
    var pn={adjustedReturn:'Rendement ajust\u00e9',underlyingQuality:'Qualit\u00e9 sous-jacent',portfolioFit:'Fit portefeuille',riskPremium:'Prime vs CAT'};
    if(g.pillars){h+='<div style="margin-bottom:16px">';Object.keys(pn).forEach(function(k){var pl=g.pillars[k]||{},sc=pl.score;if(sc===null||sc===undefined)return;var w=GRADING_CONFIG.weights[k],bc=sc>=70?'#06D6A0':sc>=45?'#FFB627':'#EF233C';h+='<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--text-muted)">'+pn[k]+' ('+Math.round(w*100)+'%)</span><span style="font-weight:600">'+sc+'/100</span></div><div style="height:6px;background:var(--bg-card,var(--surface));border-radius:3px;overflow:hidden"><div style="height:100%;width:'+sc+'%;background:'+bc+';border-radius:3px"></div></div>'+(pl.reasoning?'<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'+pl.reasoning+'</div>':'')+'</div>'});h+='</div>'}
    if(g.scenarios){h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">';[['optimistic','Optimiste','#06D6A0'],['base','Base','#4ECDC4'],['stress','Stress','#FFB627'],['worst','Worst','#EF233C']].forEach(function(x){var s=g.scenarios[x[0]];if(!s)return;h+='<div style="text-align:center;padding:8px;border-radius:8px;background:'+x[2]+'15;border:1px solid '+x[2]+'30"><div style="font-size:10px;color:var(--text-muted)">'+x[1]+'</div><div style="font-size:16px;font-weight:600;color:'+x[2]+'">'+((s.return_eur||0)>=0?'+':'')+(s.return_eur||0).toLocaleString('fr-FR')+'\u20ac</div><div style="font-size:10px;color:var(--text-muted)">'+((s.return_pct||0)>=0?'+':'')+(s.return_pct||0)+'% \u00b7 '+Math.round((s.probability||0)*100)+'%</div></div>'});h+='</div>'}
    if(g.keyRisks&&g.keyRisks.length>0)h+='<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><strong>Risques :</strong> '+g.keyRisks.join(' \u00b7 ')+'</div>';
    if(g.grade==='C'&&g.negotiationPoints&&g.negotiationPoints.length>0)h+='<div style="font-size:12px;color:#FFB627;margin-bottom:8px"><strong>\u00c0 n\u00e9gocier :</strong> '+g.negotiationPoints.join(' \u00b7 ')+'</div>';
    if(g.metadata)h+='<div style="font-size:10px;color:var(--text-muted);opacity:0.5;margin-top:8px">Grad\u00e9 le '+new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR')+' '+(g.metadata.aiUsed?'\u00b7 Claude IA':'\u00b7 Local')+' \u00b7 '+g.metadata.durationMs+'ms '+(g.metadata.marketDataAvailable?'\u00b7 Donn\u00e9es march\u00e9 \u2713':'')+'</div>';
    h+='</div>';return h;
}

window.ProposalGrader={grade:gradeProposal,gradeBatch:gradeProposalsBatch,renderBadge:renderGradeBadge,renderSection:renderGradingSection,checkKillCriteria:_checkKillCriteria,normalize:_graderNormalize,config:GRADING_CONFIG,annualizeCoupon:_annualizeCoupon,detectFrequency:_detectCouponFrequency,version:'2.1'};
console.log('[StructBoard] ProposalGrader v2.1 \u2014 smart coupon annualization');

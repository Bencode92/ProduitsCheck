// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v2.3 Patch
// v2.3: MARKET INTELLIGENCE INTEGRATION
//   1. Dynamic cash reserve (regime → more cash in stagflation)
//   2. Regime dampener (reduce allocation aggressiveness)
//   3. Sector filter (avoided sectors → penalty)
//   4. MI context in Claude prompt
//   All MI helpers exported on window for v3 to reuse
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var LIMITS = { MAX_PER_PRODUCT: 0.30, MAX_PER_UNDERLYING: 0.50, MIN_CASH_RATIO: 0.10 };

    // ═══ MI LOADER ═══
    var _miCache = null;
    window._loadOptimizerMI = async function() {
        if (_miCache) return _miCache;
        try {
            var idx = await github.readFile('data/market/index.json');
            if (idx && idx.market_intelligence) { _miCache = idx.market_intelligence; return _miCache; }
        } catch(e) {}
        try {
            var mi = await github.readFile('data/market/market_intelligence.json');
            if (mi && mi.ai_response) {
                _miCache = {
                    regime: mi.ai_response.regime, regime_confidence: mi.ai_response.regime_confidence,
                    warnings: mi.ai_response.warnings || [], cash_allocation: mi.ai_response.cash_allocation || {},
                    bond_strategy: mi.ai_response.bond_strategy || {},
                    avoided_sectors: (mi.market_data_input || {}).avoided_sectors || '',
                    favored_sectors: (mi.market_data_input || {}).favored_sectors || '',
                    stress_flags: (mi.market_data_input || {})._stress_flags || [],
                    vix: (mi.market_data_input || {}).vix, brent: (mi.market_data_input || {}).brent_usd,
                    regime_rationale: mi.ai_response.regime_rationale || ''
                };
                return _miCache;
            }
        } catch(e) {}
        return null;
    };
    window._getOptimizerMI = function() { return _miCache; };

    // ═══ MI: DYNAMIC CASH RESERVE (exported) ═══
    window._miComputeCashReserve = function(mi) {
        var base = LIMITS.MIN_CASH_RATIO;
        if (!mi) return { ratio: base, reason: 'Base 10%' };
        var regime = (mi.regime || '').toLowerCase(), conf = mi.regime_confidence || 3;
        var reasons = ['Base 10%'], regimeAdd = 0;
        if (regime === 'stagflation') regimeAdd = 0.08;
        else if (regime === 'recession') regimeAdd = 0.12;
        else if (regime === 'neutral') regimeAdd = 0.02;
        regimeAdd *= Math.min(1, conf / 4);
        if (regimeAdd > 0) reasons.push(regime + ' +' + Math.round(regimeAdd * 100) + '%');
        var tacticalCash = (mi.cash_allocation ? (mi.cash_allocation['Mod\u00e9r\u00e9'] || mi.cash_allocation['Stable'] || 0) : 0) / 100;
        if (tacticalCash > 0) reasons.push('MI tactique +' + Math.round(tacticalCash * 100) + '%');
        var vixAdd = 0, vix = mi.vix || 0;
        if (vix > 30) { vixAdd = 0.05; reasons.push('VIX ' + vix + ' +5%'); }
        else if (vix > 25) { vixAdd = 0.03; reasons.push('VIX ' + vix + ' +3%'); }
        return { ratio: Math.min(0.35, base + regimeAdd + tacticalCash + vixAdd), reason: reasons.join(' | ') };
    };

    // ═══ MI: REGIME DAMPENER (exported) ═══
    window._miRegimeDampener = function(mi) {
        if (!mi) return 1.0;
        var regime = (mi.regime || '').toLowerCase(), conf = mi.regime_confidence || 3;
        var d = 1.0;
        if (regime === 'stagflation') d = 0.85;
        else if (regime === 'recession') d = 0.75;
        else if (regime === 'expansion') d = 1.10;
        return 1.0 + (d - 1.0) * Math.min(1, conf / 4);
    };

    // ═══ MI: SECTOR PENALTY (exported) ═══
    window._miSectorPenalty = function(product, mi) {
        if (!mi || !mi.avoided_sectors) return { multiplier: 1.0, reason: null };
        var avoided = mi.avoided_sectors.toLowerCase().split(',').map(function(s) { return s.trim(); });
        var favored = (mi.favored_sectors || '').toLowerCase().split(',').map(function(s) { return s.trim(); });
        var sector = '';
        if (product.grading && product.grading.pillars && product.grading.pillars.underlyingQuality) {
            var reasoning = (product.grading.pillars.underlyingQuality.reasoning || '').toLowerCase();
            avoided.forEach(function(s) { if (reasoning.indexOf(s) >= 0) sector = s; });
            if (!sector) favored.forEach(function(s) { if (reasoning.indexOf(s) >= 0) sector = s; });
        }
        if (!sector) {
            var text = ((product.name || '') + ' ' + ((product.underlyings || []).join ? (product.underlyings || []).join(' ') : '')).toLowerCase();
            if (text.indexOf('bank') >= 0 || text.indexOf('financ') >= 0) sector = 'financials';
            if (text.indexOf('energy') >= 0 || text.indexOf('oil') >= 0 || text.indexOf('brent') >= 0) sector = 'energy';
            if (text.indexOf('tech') >= 0 || text.indexOf('nasdaq') >= 0) sector = 'information-technology';
            if (text.indexOf('gold') >= 0 || text.indexOf('miner') >= 0) sector = 'materials';
            if (text.indexOf('consumer') >= 0 || text.indexOf('lvmh') >= 0 || text.indexOf('luxury') >= 0) sector = 'consumer-discretionary';
        }
        if (!sector) return { multiplier: 1.0, reason: null };
        var isAvoided = avoided.some(function(a) { return sector.indexOf(a) >= 0 || a.indexOf(sector) >= 0; });
        if (isAvoided) return { multiplier: 0.70, reason: '\u26a0 Secteur \u00e9vit\u00e9: ' + sector + ' (\u00d70.70)' };
        var isFavored = favored.some(function(f) { return sector.indexOf(f) >= 0 || f.indexOf(sector) >= 0; });
        if (isFavored) return { multiplier: 1.10, reason: '\u2705 Secteur favoris\u00e9: ' + sector + ' (\u00d71.10)' };
        return { multiplier: 1.0, reason: null };
    };

    // ═══ SHARED ANNUALIZATION ═══
    window._annualizeCouponShared = function(product) {
        var p = product, rate = 0;
        if (p.coupon && typeof p.coupon === 'object') rate = parseFloat(p.coupon.rate) || parseFloat(p.coupon.annualized) || parseFloat(p.coupon.taux) || 0;
        else rate = parseFloat(p.coupon) || 0;
        if (rate <= 0) return 0;
        var freq = '';
        if (p.coupon && typeof p.coupon === 'object') freq = (p.coupon.frequency || p.coupon.frequence || '').toLowerCase();
        if (!freq) { var st = ((p.name||'') + ' ' + (p.type||'')).toLowerCase(); if (p.coupon && typeof p.coupon === 'object') st += ' ' + (p.coupon.triggerDetail||'') + ' ' + (p.coupon.type||''); if (st.indexOf('trimestr')>=0) freq='trimestriel'; else if (st.indexOf('semestr')>=0) freq='semestriel'; else if (st.indexOf('mensuel')>=0) freq='mensuel'; }
        if (freq.indexOf('trimestr')>=0) rate*=4; else if (freq.indexOf('semestr')>=0) rate*=2; else if (freq.indexOf('mensuel')>=0) rate*=12;
        if (rate > 30) { var raw = parseFloat((p.coupon && typeof p.coupon === 'object') ? p.coupon.rate : p.coupon) || 0; if (raw > 0 && raw < 30) rate = raw; }
        return rate;
    };

    // ═══ ISSUER DEFAULT ═══
    function _issuerDefaultProb(product) {
        var bankId = (product.bankId || product.bankName || '').toLowerCase();
        if (typeof ISSUER_RATINGS !== 'undefined') { for (var key in ISSUER_RATINGS) { if (bankId.indexOf(key) >= 0) { return Math.min(0.15, Math.max(0.01, (ISSUER_RATINGS[key].cds_proxy || 80) / 10000 / 0.6)); } } }
        return 0.05;
    }

    // ═══ UNDERLYING GROUP ═══
    function _getUnderlyingGroup(product) {
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var ujs = norm.underlyings || []; if (ujs.length === 0) return 'rates';
        var allText = ujs.join(' ').toLowerCase();
        if (allText.indexOf('eurostoxx')>=0||allText.indexOf('cac')>=0||allText.indexOf('dax')>=0) return 'eu-equity';
        if (allText.indexOf('s&p')>=0||allText.indexOf('nasdaq')>=0) return 'us-equity';
        if (allText.indexOf('gold')>=0||allText.indexOf('miner')>=0) return 'gold';
        if (allText.indexOf('nikkei')>=0) return 'asia-equity';
        if (allText.indexOf('bank')>=0) return 'eu-financials';
        return 'single';
    }

    // ═══ COUPON PROBABILITY ═══
    window._estimateCouponProbability = function(product) {
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(product) : product;
        var couponType = (norm.couponType || '').toLowerCase();
        var defaultProb = _issuerDefaultProb(product);
        if (couponType === 'garanti' || couponType === 'fixe') return Math.round((1 - defaultProb) * 100) / 100;
        if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(norm)) return Math.round((1 - defaultProb) * 100) / 100;
        if (norm.capitalProtection) return Math.round((0.90 - defaultProb) * 100) / 100;
        var barrier = norm.barrier || 60, hasMemory = norm.hasMemory || false, nUnd = (norm.underlyings || []).length;
        var sigma = null;
        if (product.grading && product.grading.barrierSigma) sigma = product.grading.barrierSigma;
        else if (typeof _computeBarrierSigma === 'function') { try { sigma = _computeBarrierSigma(norm); } catch(e) {} }
        var prob; if (sigma != null && sigma > 0) prob = Math.max(0.20, Math.min(0.99, 0.5 + 0.5 * (1 - Math.exp(-sigma * 0.8)))); else prob = Math.max(0.30, Math.min(0.95, 1.0 - (barrier - 40) * 0.015));
        if (hasMemory) prob = Math.min(0.95, prob + 0.10);
        if (nUnd > 2) prob *= Math.max(0.5, 1.0 - (nUnd - 2) * 0.08);
        prob *= (1 - defaultProb);
        return Math.round(prob * 100) / 100;
    };

    // ═══ ALLOCATION ENGINE WITH MI ═══
    window._allocateWithConstraints = function(analysis, sortedProposals, mi) {
        var totalLiquidity = analysis.totalLiquidity;
        if (totalLiquidity <= 0) return analysis;
        var cashInfo = _miComputeCashReserve(mi), cashRatio = cashInfo.ratio, dampener = _miRegimeDampener(mi);
        var totalAssets = analysis.totalPortfolioInvested + totalLiquidity;
        var maxPerProduct = totalAssets * LIMITS.MAX_PER_PRODUCT;
        var allocatable = totalLiquidity * (1 - cashRatio);
        var allocByUnderlying = {};
        (app.state.portfolio || []).forEach(function(p) { var g = _getUnderlyingGroup(p); allocByUnderlying[g] = (allocByUnderlying[g] || 0) + (parseFloat(p.investedAmount) || 0); });
        var remaining = allocatable, constraintWarnings = [], miNotes = [];
        if (mi) {
            miNotes.push('\ud83c\udf0d R\u00e9gime: ' + (mi.regime || '?').toUpperCase() + ' (conf. ' + (mi.regime_confidence || '?') + '/5)');
            miNotes.push('\ud83d\udcb0 Cash: ' + Math.round(cashRatio * 100) + '% (' + cashInfo.reason + ')');
            miNotes.push('\ud83d\udcc9 Dampener: \u00d7' + dampener.toFixed(2));
            if (mi.avoided_sectors) miNotes.push('\u26a0 \u00c9vit\u00e9s: ' + mi.avoided_sectors);
            if (mi.warnings && mi.warnings.length > 0) miNotes.push('\u26a0 ' + mi.warnings[0]);
        }
        var newPlan = sortedProposals.map(function(p) {
            if (p.recommendation !== 'SOUSCRIRE' && p.recommendation !== 'ENVISAGER') { p.allocatedAmount=0;p.annualReturn=0;p.expectedReturn=0;p.catReturn=0;p.excessVsCat=0; return p; }
            if (remaining <= 0) { p.allocatedAmount=0;p.annualReturn=0;p.expectedReturn=0;p.catReturn=0;p.excessVsCat=0;p.reason='Liquidit\u00e9 \u00e9puis\u00e9e'; return p; }
            var targetAmount = p.nominal > 0 ? p.nominal : Math.min(remaining, 50000);
            var gradeMultiplier = Math.max(0.6, Math.min(1.3, (p.score || 50) / 75));
            gradeMultiplier *= dampener;
            var sectorInfo = _miSectorPenalty(p, mi); gradeMultiplier *= sectorInfo.multiplier;
            if (sectorInfo.reason) constraintWarnings.push(sectorInfo.reason);
            gradeMultiplier = Math.max(0.4, Math.min(1.3, gradeMultiplier));
            targetAmount = Math.round(targetAmount * gradeMultiplier);
            targetAmount = Math.min(targetAmount, maxPerProduct);
            var ujGroup = _getUnderlyingGroup(p), currentUj = allocByUnderlying[ujGroup] || 0;
            var ujRoom = Math.max(0, totalAssets * LIMITS.MAX_PER_UNDERLYING - currentUj);
            if (targetAmount > ujRoom) { constraintWarnings.push(p.name.substring(0,25) + ': SJ ' + ujGroup); targetAmount = ujRoom; }
            var alloc = Math.max(0, Math.min(targetAmount, remaining));
            if (alloc < 5000) { p.allocatedAmount=0;p.annualReturn=0;p.expectedReturn=0;p.catReturn=0;p.excessVsCat=0; return p; }
            remaining -= alloc; allocByUnderlying[ujGroup] = (allocByUnderlying[ujGroup]||0) + alloc;
            var prob = _estimateCouponProbability(p), annual = Math.round(alloc * p.coupon / 100), expected = Math.round(annual * prob), cat = Math.round(alloc * analysis.catBenchmark / 100);
            p.allocatedAmount=alloc;p.annualReturn=annual;p.expectedReturn=expected;p.probCoupon=prob;p.catReturn=cat;p.excessVsCat=expected-cat;p._gradeMultiplier=gradeMultiplier;p._ujGroup=ujGroup;p._sectorPenalty=sectorInfo.reason;
            if (p.recommendation === 'SOUSCRIRE') { p.reason = 'Grade ' + p.grade + ' (' + p.score + '/100) \u00d7' + gradeMultiplier.toFixed(2) + ' \u2014 ' + formatNumber(alloc) + '\u20ac \u2192 +' + formatNumber(expected) + '\u20ac/an' + (p.excessVsCat > 0 ? ' +' + formatNumber(p.excessVsCat) + '\u20ac vs CAT' : ''); }
            return p;
        });
        var deployed = newPlan.reduce(function(s,a){return s+a.allocatedAmount;},0);
        analysis.allocationPlan=newPlan; analysis.deployedAmount=deployed;
        analysis.deployedReturn=newPlan.reduce(function(s,a){return s+(a.expectedReturn||0);},0);
        analysis.deployedCatReturn=Math.round(deployed*analysis.catBenchmark/100);
        analysis.deployedExcess=analysis.deployedReturn-analysis.deployedCatReturn;
        analysis.remainingCash=totalLiquidity-deployed; analysis.constraintWarnings=constraintWarnings;
        analysis._miNotes=miNotes; analysis._miRegime=mi?mi.regime:null; analysis._miCashReserve=cashRatio; analysis._miDampener=dampener;
        analysis._version='2.3'; analysis._limits=LIMITS;
        console.log('[Optimizer v2.3] MI=' + (mi?mi.regime:'none') + ' cash=' + Math.round(cashRatio*100) + '% damp=' + dampener.toFixed(2) + ' deployed=' + formatNumber(deployed) + '\u20ac (' + Math.round(deployed/totalLiquidity*100) + '%)');
        return analysis;
    };

    // ═══ OVERRIDE ═══
    var _optV2Interval = setInterval(function() {
        if (typeof buildStructuredOptimization !== 'function') return;
        clearInterval(_optV2Interval);
        var _origBuildOpt = buildStructuredOptimization;
        buildStructuredOptimization = function() {
            var analysis = _origBuildOpt(); if (analysis.totalLiquidity <= 0) return analysis;
            var proposals = analysis.allocationPlan.slice();
            proposals.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
            return _allocateWithConstraints(analysis, proposals, _miCache);
        };
        _loadOptimizerMI().then(function(mi) { if (mi) console.log('[Optimizer v2.3] MI: regime=' + mi.regime + ' conf=' + mi.regime_confidence); });
        if (typeof getStructOptimizerAISummary === 'function') {
            var _origAI = getStructOptimizerAISummary;
            getStructOptimizerAISummary = async function(analysis) {
                await _loadOptimizerMI();
                var result = await _origAI(analysis);
                if (analysis._miNotes && analysis._miNotes.length > 0) { result += '\n\n**\ud83c\udf0d Market Intelligence:**\n'; analysis._miNotes.forEach(function(n) { result += '- ' + n + '\n'; }); }
                if (analysis.constraintWarnings && analysis.constraintWarnings.length > 0) { result += '\n**\u26a0 Contraintes:**\n'; analysis.constraintWarnings.forEach(function(w) { result += '- ' + w + '\n'; }); }
                return result;
            };
        }
        console.log('[StructBoard] Optimizer v2.3 \u2014 MI: cash + dampener + sector filter (exported)');
    }, 250);
    setTimeout(function() { clearInterval(_optV2Interval); }, 10000);
})();

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Proposal Grader v7.0 — Consolidated Pipeline
// ALL patches merged into a single sequential function. No setInterval, no wrapping.
// Pipeline: NORMALIZE → CONTEXT → TYPE → SCORE → BS_P1 → CALIBRATE → FINALIZE
//
// Merges: proposal-grader-v5.js, grader-rates-patch, grader-freq-fix, sprint1,
//   sprint2, grader-mi-patch, grader-p1p2-structure-override, grader-dispersion-patch,
//   grader-basket-fix, basket-detection-v2, grader-annualize-patch,
//   grader-decrement-patch, grader-trigger-penalty-patch, grader-dispersion-boost-patch,
//   grader-p1-expected-return-patch, grader-v6-calibration-patch, grader-v6-weights-enforce
// ═══════════════════════════════════════════════════════════════════════════════

// This file is meant to REPLACE all 17 patch files in index.html.
// It reuses the base proposal-grader-v5.js which defines ProposalGrader,
// then overrides grade() and gradeBatch() with the consolidated pipeline.
//
// Load order in index.html:
//   proposal-grader-v5.js   ← base (defines ProposalGrader, helpers, UI)
//   proposal-grader-v7.js   ← THIS FILE (overrides grade + gradeBatch)

(function() {
  'use strict';

  // ═══ CONSTANTS ═══
  var V7_WEIGHTS = { p1: 0.30, p2: 0.20, p3: 0.15, p4: 0.30 };
  var MAX_IA_DELTA = 20;

  // ═══ SECTION 1: MATH HELPERS ═══
  function _normcdf(x) {
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;
    var t = 1.0 / (1.0 + p * x);
    var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
  }

  function _probAbove(trigger, volPct, T, rPct) {
    var sigma = volPct / 100, r = (rPct || 0) / 100;
    T = Math.max(0.25, T);
    var d2 = (Math.log(100 / trigger) + (r - sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    return _normcdf(d2);
  }

  function _probBreach(barrierPct, volPct, T, rPct) {
    if (!barrierPct || barrierPct <= 0 || barrierPct >= 100) return 0;
    var sigma = volPct / 100, r = (rPct || 0) / 100;
    T = Math.max(0.25, T);
    var mu = r - sigma * sigma / 2, sqrtT = Math.sqrt(T);
    var logSB = Math.log(100 / barrierPct);
    var d1 = (logSB + mu * T) / (sigma * sqrtT);
    var d2 = (-logSB + mu * T) / (sigma * sqrtT);
    var ratio = Math.pow(barrierPct / 100, 2 * mu / (sigma * sigma));
    return Math.min(0.95, _normcdf(-d1) + ratio * _normcdf(d2));
  }

  function _basketVol(vols, corr) {
    corr = corr || 0.4;
    var n = vols.length;
    if (n <= 1) return vols[0] || 22;
    var sumVar = 0, sumCov = 0;
    for (var i = 0; i < n; i++) {
      var vi = vols[i] / 100;
      sumVar += vi * vi / (n * n);
      for (var j = i + 1; j < n; j++) {
        sumCov += 2 * corr * (vi) * (vols[j] / 100) / (n * n);
      }
    }
    return Math.sqrt(sumVar + sumCov) * 100;
  }

  // ═══ SECTION 2: VOL DATA ═══
  var _volData = null;
  var DEFAULT_VOLS = {
    'single-index': 20, 'single_index': 20, 'index': 20,
    'single-stock': 28, 'single_stock': 28, 'stock': 28,
    'worst-of': 30, 'worst_of': 30, 'basket': 22,
    'pairs': 25, 'dispersion': 25, 'rates': 8, 'credit': 10
  };

  function _loadVolData() {
    if (_volData) return Promise.resolve(_volData);
    _volData = { stocks: {}, indices: {}, proxies: {} };
    var p1 = fetch('data/market/stocks_europe.json').then(function(r) { return r.json(); })
      .then(function(d) {
        var list = Array.isArray(d) ? d : (d.stocks || []);
        list.forEach(function(s) {
          if (s.ticker && s.volatility_3y) {
            _volData.stocks[s.ticker.toUpperCase()] = s.volatility_3y;
            if (s.name) _volData.stocks[s.name.toUpperCase()] = s.volatility_3y;
          }
        });
      }).catch(function() {});
    var p2 = fetch('data/market/underlyings_extra.json').then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.tickers) { Object.keys(d.tickers).forEach(function(k) {
          if (d.tickers[k].vol_3y) _volData.proxies[k.toUpperCase()] = d.tickers[k].vol_3y;
        }); }
      }).catch(function() {});
    var p3 = fetch('data/underlying-map.json').then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.indices) { Object.keys(d.indices).forEach(function(name) {
          var info = d.indices[name];
          _volData.indices[name.toUpperCase()] = { proxy: (info.proxy || '').toUpperCase(), defaultVol: info.default_vol || 20 };
        }); }
      }).catch(function() {});
    return Promise.all([p1, p2, p3]).then(function() {
      Object.keys(_volData.indices).forEach(function(name) {
        var info = _volData.indices[name];
        if (info.proxy && _volData.proxies[info.proxy]) info.realVol = _volData.proxies[info.proxy];
      });
      return _volData;
    });
  }

  function _resolveVol(name) {
    if (!_volData || !name) return null;
    var n = name.toUpperCase().trim();
    if (_volData.stocks[n]) return _volData.stocks[n];
    if (_volData.proxies[n]) return _volData.proxies[n];
    if (_volData.indices[n]) return _volData.indices[n].realVol || _volData.indices[n].defaultVol;
    // Keyword extraction
    var tokens = n.split(/[\s,.:;()%\-\/]+/).filter(function(t) { return t.length >= 2; });
    for (var t = 0; t < tokens.length; t++) {
      if (_volData.stocks[tokens[t]]) return _volData.stocks[tokens[t]];
      if (_volData.proxies[tokens[t]]) return _volData.proxies[tokens[t]];
      if (_volData.indices[tokens[t]]) return _volData.indices[tokens[t]].realVol || _volData.indices[tokens[t]].defaultVol;
    }
    // Partial match
    var keys = Object.keys(_volData.indices);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(n) >= 0 || n.indexOf(keys[i]) >= 0) return _volData.indices[keys[i]].realVol || _volData.indices[keys[i]].defaultVol;
    }
    keys = Object.keys(_volData.stocks);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].length >= 3 && (keys[i].indexOf(n) >= 0 || n.indexOf(keys[i]) >= 0)) return _volData.stocks[keys[i]];
    }
    return null;
  }

  function _resolveVols(unds, undType) {
    var vols = [], defaultVol = DEFAULT_VOLS[undType] || 25;
    if (unds.length > 0) {
      unds.forEach(function(u) { vols.push(_resolveVol(u) || defaultVol); });
    } else { vols.push(defaultVol); }
    return vols;
  }

  // ═══ SECTION 3: STRUCTURE DETECTION ═══
  function _isBasketProduct(product) {
    var ut = (product.underlyingType || '').toLowerCase();
    var st = (product.structureType || '').toLowerCase();
    if (ut === 'basket' || st === 'basket') return true;
    var mech = ((product.mechanism || '') + ' ' + (product.name || '')).toLowerCase();
    return /panier\s*[eé]qui|niveau\s*du\s*panier|basket|equi.?pond/i.test(mech);
  }

  function _isGuaranteedRateProduct(product) {
    if (product._isGuaranteedRate) return true;
    var st = (product.structureType || '').toLowerCase();
    var ct = (product.couponType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    if (st === 'taux_fixe' || st === 'callable') return true;
    if ((ct === 'fixe' || ct === 'garanti') && (ut === 'none' || ut === '' || ut === 'rates' || ut === 'credit')) return true;
    return false;
  }

  // ═══ SECTION 4: NORMALIZE OVERRIDE ═══
  // Applied BEFORE any scoring — fixes data for special structures
  function _normalizeOverride(norm, product) {
    var st = product.structureType || '';
    if (!st && typeof _autoDetectStructureType === 'function') st = _autoDetectStructureType(product);
    if (!st) return norm;

    if (st === 'dispersion') {
      norm.worstOf = false;
      norm.capitalProtection = true;
      norm.barrier = 0;
      norm.couponType = 'garanti';
      var histSim = product.historicalSimulations || (product.aiParsed ? product.aiParsed.historicalSimulations : null);
      var matY = norm.maturityYears || 3;
      if (histSim && histSim.median) {
        norm.coupon = histSim.median / matY;
        norm._dispersionMedian = histSim.median;
      } else {
        var participation = product.participationRate || norm.coupon || 7;
        norm.coupon = (participation * 1.3) / matY;
        norm._dispersionMedian = participation * 1.3;
      }
      norm.autocall = false;
      norm._structureType = 'dispersion';
      norm._originalCoupon = (product.coupon && product.coupon.rate) || product.participationRate || 7;
    } else if (st === 'capital_garanti') {
      norm.capitalProtection = true;
      norm.barrier = 0;
      if (norm.couponType !== 'fixe') norm.couponType = 'garanti';
      norm._structureType = 'capital_garanti';
    } else if (st === 'taux_fixe') {
      norm.capitalProtection = true;
      norm.barrier = 0;
      norm.couponType = 'fixe';
      norm.worstOf = false;
      norm._structureType = 'taux_fixe';
    }
    return norm;
  }

  // ═══ SECTION 5: BS P1 CALCULATION ═══
  function _computeBSP1(product, norm, rfRate) {
    var coupon = product.coupon || {};
    var cp = product.capitalProtection || {};
    var er = product.earlyRedemption || {};
    var undType = (product.underlyingType || '').toLowerCase();
    var st = (product.structureType || '').toLowerCase();

    var annRate = norm.coupon || 0;
    var triggerCoupon = 0;
    var isAutocall = er.type === 'autocall' || (er.possible && er.trigger > 0);
    triggerCoupon = isAutocall ? (parseFloat(er.trigger) || parseFloat(cp.barrierCoupon) || parseFloat(coupon.trigger) || 100)
      : (parseFloat(cp.barrierCoupon) || parseFloat(coupon.trigger) || 100);

    var barrierCapital = parseFloat(cp.barrier) || 0;
    var isProtected = cp.protected || false;
    var matMax = parseFloat(product.maturityYears) || 5;
    var matEsperee = matMax;
    if (product.grading && product.grading.metadata && product.grading.metadata.expectedMaturity) {
      matEsperee = product.grading.metadata.expectedMaturity;
    } else if (isAutocall || product.autocall) {
      matEsperee = Math.min(matMax, Math.max(1, matMax * 0.35));
    }

    var dec = parseFloat(product.decrementPct) || 0;
    var div = parseFloat(product.actualDividendYield) || 0;
    var drag = Math.max(0, dec - div);

    var unds = (product.underlyings || []).map(function(u) { return typeof u === 'string' ? u : (u.name || u.ticker || ''); }).filter(Boolean);
    var isDispersion = st === 'dispersion' || undType === 'pairs';
    var isRate = st === 'taux_fixe' || undType === 'rates' || undType === 'credit';
    var isWorstOf = undType === 'worst-of' || undType === 'worst_of';
    var isBasket = _isBasketProduct(product);
    if (isBasket && isWorstOf) isWorstOf = false;
    var hasMemory = (coupon.memory === true) || st === 'phoenix_memoire';

    if (isRate) return null; // rates use heuristic P1, not BS

    var vols = _resolveVols(unds, undType);
    var r = rfRate || 2.5;
    var probCoupon, couponEffectif, perteEsperee;

    if (isDispersion) {
      probCoupon = 0.95;
      couponEffectif = norm._dispersionMedian ? (norm._dispersionMedian / matMax) : 11 / matMax;
      // Use total median as rendement
      couponEffectif = 11; // default dispersion median return
    } else if (isBasket && vols.length > 1) {
      var bVol = _basketVol(vols, 0.4);
      probCoupon = _probAbove(triggerCoupon, bVol, matEsperee, r);
      couponEffectif = annRate;
    } else if (isWorstOf && vols.length > 1) {
      var probs = vols.map(function(v) { return _probAbove(triggerCoupon, v, matEsperee, r); });
      probCoupon = probs.reduce(function(a, b) { return a * b; }, 1);
      var corrAdj = 1 + 0.15 * (vols.length - 1);
      probCoupon = Math.min(probCoupon * corrAdj, Math.min.apply(null, probs));
      couponEffectif = annRate;
    } else {
      var vol = vols.length > 0 ? Math.max.apply(null, vols) : 25;
      probCoupon = _probAbove(triggerCoupon, vol, matEsperee, r);
      couponEffectif = annRate;
    }

    if (hasMemory && !isDispersion) probCoupon = Math.min(0.99, probCoupon * 1.08);
    probCoupon = Math.max(0.01, Math.min(0.99, probCoupon));

    var rendementEspere = couponEffectif * probCoupon;
    perteEsperee = 0;
    if (!isProtected && barrierCapital > 0 && barrierCapital < 100) {
      var volForBreach = (isBasket && vols.length > 1) ? _basketVol(vols, 0.4) : (vols.length > 0 ? Math.max.apply(null, vols) : 25);
      var probB = _probBreach(barrierCapital, volForBreach, matEsperee, r);
      perteEsperee = (1 - barrierCapital / 100) * 100 * 1.3 * probB / Math.max(1, matEsperee);
    }

    var rendementNet = rendementEspere - perteEsperee - drag;
    var score = Math.round(35 + rendementNet * 6);
    score = Math.max(5, Math.min(95, score));

    return {
      score: score, probCoupon: Math.round(probCoupon * 1000) / 10,
      rendementNet: Math.round(rendementNet * 100) / 100,
      perteEsperee: Math.round(perteEsperee * 100) / 100,
      couponEffectif: Math.round(couponEffectif * 100) / 100,
      vols: vols, matEsperee: matEsperee, isBasket: isBasket
    };
  }

  // ═══ SECTION 6: POST-PROCESSING ═══

  // P3 recalibration: base 50 with structure adjustments
  function _recalibrateP3(oldP3, product) {
    var base = 50;
    var st = (product.structureType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    var n = (product.underlyings || []).length;
    if (st === 'dispersion' || ut === 'pairs') base += 15;
    else if (st === 'capital_garanti' || (product.capitalProtection && product.capitalProtection.protected)) base += 10;
    else if (ut === 'basket') base += 12;
    else if (ut === 'single-index') base += 8;
    else if (ut === 'worst-of' || ut === 'worst_of') { if (n <= 2) base += 0; else if (n <= 3) base -= 5; else base -= 10; }
    else if (ut === 'single-stock') base -= 10;
    else if (ut === 'none' || st === 'taux_fixe') base += 5;
    var my = parseFloat(product.maturityYears) || 5;
    if (my <= 2) base += 5; else if (my > 7) base -= 5;
    var overlapDelta = oldP3 - 70;
    if (overlapDelta < 0) base += Math.max(-20, overlapDelta);
    return Math.max(5, Math.min(95, Math.round(base)));
  }

  // P1 adjustments: memory bonus, single-stock penalty
  function _adjustP1(oldP1, product) {
    var adj = 0;
    var ut = (product.underlyingType || '').toLowerCase();
    var hasMemory = (product.coupon && product.coupon.memory === true) || (product.structureType || '').toLowerCase() === 'phoenix_memoire';
    if (hasMemory) adj += 5;
    if (ut === 'single-stock') adj -= 5;
    if (ut === 'single-stock' && product.capitalProtection && parseFloat(product.capitalProtection.barrier) > 0 && parseFloat(product.capitalProtection.barrier) < 65) adj -= 3;
    return Math.max(5, Math.min(95, oldP1 + adj));
  }

  // P4 BS correction (exempt guaranteed rates)
  function _adjustP4WithBS(oldP4, product, catRate) {
    if (_isGuaranteedRateProduct(product)) return oldP4;
    var bsRn = product._bsRendementNet;
    if (bsRn === undefined || bsRn === null) return oldP4;
    var coupon = product.coupon || {};
    var facialRate = parseFloat(coupon.rate || coupon) || 0;
    if (!facialRate) return oldP4;
    var facialSpread = facialRate - catRate;
    var bsSpread = bsRn - catRate;
    if (facialSpread <= 0 || bsSpread >= facialSpread * 0.7) return oldP4;
    var ratio = Math.max(0.25, bsSpread / Math.max(0.1, facialSpread));
    var newP4;
    if (bsSpread <= 0) newP4 = Math.min(oldP4, 35);
    else if (bsSpread < 2) newP4 = Math.min(oldP4, Math.max(35, Math.round(oldP4 * ratio)));
    else newP4 = Math.max(30, Math.round(oldP4 * ratio));
    return Math.max(10, Math.min(95, newP4));
  }

  // Illiquidity penalty (sprint2 FIX 6)
  function _applyIlliquidityPenalty(result) {
    if (!result || !result.pillars || !result.pillars.riskPremium || !result.metadata) return;
    var type = result.metadata.productType || '';
    if (type === 'liquidity' || type === 'taux_fixe') return;
    if (result.metadata.barrierPct === 0 && type === 'capital_garanti') return;
    var T = result.metadata.maxMaturity || result.metadata.expectedMaturity || 5;
    if (T <= 1) return;
    var oldPremium = 0.5 + 0.10 * Math.max(0, T - 2);
    var newPremium = 1.5 + 0.20 * Math.max(0, T - 2);
    var scoreDelta = Math.min(Math.round((newPremium - oldPremium) * 5), 10);
    result.pillars.riskPremium.score = Math.max(0, result.pillars.riskPremium.score - scoreDelta);
  }

  // Decrement drag penalty
  function _applyDecrementPenalty(result, product) {
    var dec = parseFloat(product.decrementPct) || 0;
    var div = parseFloat(product.actualDividendYield) || 0;
    if (!dec && product.aiParsed) { dec = parseFloat(product.aiParsed.decrementPct) || 0; div = parseFloat(product.aiParsed.actualDividendYield) || 0; }
    var drag = Math.max(0, dec - div);
    if (drag <= 0) return;
    var p1 = result.pillars.adjustedReturn;
    var p4 = result.pillars.riskPremium;
    p1.score = Math.max(5, p1.score - Math.min(Math.round(drag * 4), 25));
    p4.score = Math.max(5, p4.score - Math.min(Math.round(drag * 5), 30));
    result.metadata.hasDecrement = true;
    result.metadata.decrementDrag = drag;
  }

  // Trigger penalty (high trigger + long maturity)
  function _applyTriggerPenalty(result, product) {
    var bc = parseFloat((product.capitalProtection || {}).barrierCoupon) || 0;
    var ct = parseFloat((product.coupon || {}).trigger) || 0;
    var trigger = bc || ct || 0;
    if (trigger <= 0) return;
    var penalty = 0;
    var isWO = (product.underlyingType || '').toLowerCase().indexOf('worst') >= 0;
    var isCG = !!(product.capitalProtection && product.capitalProtection.protected);
    if (trigger >= 100) penalty = isWO ? 18 : 10;
    else if (trigger >= 95) penalty = isWO ? 7 : 4;
    var my = parseFloat(product.maturityYears) || 5;
    if (my >= 8) { var mp = Math.min(Math.round((my - 7) * 2), 10); if (isCG) mp = Math.round(mp * 0.5); penalty += mp; }
    if (isCG && trigger >= 100) penalty += 5;
    if (penalty > 0) {
      result.pillars.adjustedReturn.score = Math.max(10, result.pillars.adjustedReturn.score - penalty);
    }
  }

  // Dispersion boost (P1 + P4)
  function _applyDispersionBoost(result, product) {
    var st = (product.structureType || '').toLowerCase();
    if (st !== 'dispersion') return;
    var isCG = !!(product.capitalProtection && product.capitalProtection.protected);
    var p4boost = 15 + (isCG ? 10 : 0);
    result.pillars.riskPremium.score = Math.min(90, result.pillars.riskPremium.score + p4boost);
    if (isCG) result.pillars.adjustedReturn.score = Math.min(85, result.pillars.adjustedReturn.score + 10);
  }

  // ═══ SECTION 7: CONSOLIDATED GRADE FUNCTION ═══
  function _waitForBase() {
    return new Promise(function(resolve) {
      if (typeof ProposalGrader !== 'undefined' && ProposalGrader.grade) { resolve(); return; }
      var iv = setInterval(function() {
        if (typeof ProposalGrader !== 'undefined' && ProposalGrader.grade) { clearInterval(iv); resolve(); }
      }, 50);
      setTimeout(function() { clearInterval(iv); resolve(); }, 5000);
    });
  }

  _waitForBase().then(function() {
    // Load vol data at startup
    _loadVolData().then(function() {
      console.log('[Grader v7] Vol data: ' + Object.keys(_volData.stocks).length + ' stocks, ' + Object.keys(_volData.indices).length + ' indices');
    });

    // Save reference to base grade (v5.2)
    var _baseGrade = ProposalGrader.grade;

    // Override with consolidated pipeline
    ProposalGrader.grade = async function(product) {
      // Step 1: Call base grader (normalize, collect context, P1-P4 heuristic, Claude IA)
      var result = await _baseGrade.call(ProposalGrader, product);
      if (!result || !result.pillars || result.grade === '-') return result;

      // Step 2: Apply post-processing patches (in the correct order)

      // 2a. Illiquidity penalty (sprint2)
      _applyIlliquidityPenalty(result);

      // 2b. Decrement drag penalty
      _applyDecrementPenalty(result, product);

      // 2c. Trigger penalty (high trigger + long maturity)
      _applyTriggerPenalty(result, product);

      // 2d. Dispersion boost
      _applyDispersionBoost(result, product);

      // Step 3: BS P1 override (replaces heuristic P1)
      await _loadVolData();
      var catRate = (result.metadata && result.metadata.catBenchmark) || 2.5;
      var norm = ProposalGrader.normalize(product);
      norm = _normalizeOverride(norm, product);
      var bs = _computeBSP1(product, norm, catRate);
      if (bs) {
        result.pillars.adjustedReturn.score = bs.score;
        result.pillars.adjustedReturn.delta = 0; // BS is a replacement, not IA adjustment
        result.pillars.adjustedReturn._bsDelta = bs.score - (result.pillars.adjustedReturn.base || 0);
        result.pillars.adjustedReturn._bs = bs;
        product._couponProbability = bs.probCoupon;
        product._bsRendementNet = bs.rendementNet;
        if (result.metadata) {
          result.metadata.bsRendementNet = bs.rendementNet;
          result.metadata.bsProbCoupon = bs.probCoupon;
          result.metadata.bsPerteEsperee = bs.perteEsperee;
          result.metadata.bsVols = bs.vols;
          result.metadata.bsMatEsperee = bs.matEsperee;
          result.metadata.couponProbability = bs.probCoupon;
          result.metadata.isBasket = bs.isBasket;
        }
      }

      // Step 4: v6 calibration
      // 4a. Cap IA deltas to ±20 (skip adjustedReturn since BS set delta=0)
      ['underlyingQuality', 'portfolioFit', 'riskPremium'].forEach(function(key) {
        var pillar = result.pillars[key];
        if (pillar && pillar.delta !== undefined && Math.abs(pillar.delta) > MAX_IA_DELTA) {
          var capped = Math.max(-MAX_IA_DELTA, Math.min(MAX_IA_DELTA, pillar.delta));
          var diff = pillar.delta - capped;
          pillar.score = Math.max(0, Math.min(100, pillar.score - diff));
          pillar.delta = capped;
        }
      });

      // 4b. Recalibrate P3
      var newP3 = _recalibrateP3(result.pillars.portfolioFit.score, product);
      result.pillars.portfolioFit.score = newP3;

      // 4c. Adjust P1 (memory +5, single-stock -5)
      result.pillars.adjustedReturn.score = _adjustP1(result.pillars.adjustedReturn.score, product);

      // 4d. P4 BS correction (exempt guaranteed rates)
      result.pillars.riskPremium.score = _adjustP4WithBS(result.pillars.riskPremium.score, product, catRate);

      // Step 5: Final total with v7 weights (30/20/15/30)
      var p1 = result.pillars.adjustedReturn.score;
      var p2 = result.pillars.underlyingQuality.score;
      var p3 = result.pillars.portfolioFit.score;
      var p4 = result.pillars.riskPremium.score;
      var total = Math.round(p1 * V7_WEIGHTS.p1 + p2 * V7_WEIGHTS.p2 + p3 * V7_WEIGHTS.p3 + p4 * V7_WEIGHTS.p4);
      result.score = total;
      result.grade = total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 25 ? 'D' : 'F';

      if (result.metadata) {
        result.metadata.v6Weights = V7_WEIGHTS;
        result.metadata.version = '7.0';
      }

      return result;
    };

    // Override gradeBatch to use the consolidated grade
    ProposalGrader.gradeBatch = async function(proposals, onProgress) {
      var results = [], total = proposals.length;
      for (var i = 0; i < total; i++) {
        try {
          var r = await ProposalGrader.grade(proposals[i]);
          results.push({ proposal: proposals[i], grading: r });
        } catch(e) {
          results.push({ proposal: proposals[i], grading: { grade: '?', score: null, verdict: 'Erreur: ' + e.message } });
        }
        if (onProgress) onProgress(i + 1, total, results[results.length - 1]);
        if (i < total - 1) await new Promise(function(r) { setTimeout(r, 1500); });
      }
      results.sort(function(a, b) {
        var o = { A:0, B:1, C:2, D:3, F:4, '-':5, '?':6 };
        return (o[a.grading.grade] || 6) - (o[b.grading.grade] || 6);
      });
      return results;
    };

    ProposalGrader.version = '7.0';
    console.log('[StructBoard] ProposalGrader v7.0 — consolidated pipeline (BS P1, v6 cal, weights 30/20/15/30)');
  });
})();

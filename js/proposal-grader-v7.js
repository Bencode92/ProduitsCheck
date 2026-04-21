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
  var V7_WEIGHTS = { p1: 0.25, p2: 0.20, p3: 0.25, p4: 0.30 };
  var V7_WEIGHTS_SL = { p1: 0.35, p2: 0.25, p3: 0.15, p4: 0.25 }; // Swiss Life: more weight on return
  var MAX_IA_DELTA = 20;
  var RISK_FREE_RATE = 2.05; // €STR proxy — used for BS diffusion only, NOT for P4 spread

  function _isSwissLifeEnvelope(product) {
    var env = (product.envelope || '').toLowerCase();
    if (env === 'swiss-life' || env === 'swisslife' || env === 'sl') return true;
    // Also auto-detect from emitter/name if envelope not explicitly set
    if ((product.emitter || '').toLowerCase().indexOf('swiss life') >= 0) return true;
    if ((product.name || '').toLowerCase().indexOf('sl -') === 0) return true;
    if ((product.name || '').toLowerCase().indexOf('sl –') === 0) return true;
    return false;
  }

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

  // Gaussian copula for worst-of: P(all underlyings above trigger)
  // Uses Monte Carlo with Cholesky decomposition (fast for n≤8)
  function _worstOfCopula(marginalProbs, rho, nSim) {
    nSim = nSim || 5000;
    var n = marginalProbs.length;
    if (n <= 1) return marginalProbs[0] || 0.5;

    // Convert marginal probs to Gaussian thresholds via inverse CDF
    var zThresholds = marginalProbs.map(function(p) { return _norminv(p); });

    // Build correlation matrix and Cholesky decompose
    // For uniform rho, Cholesky is: L[i][j] = rho for j<i (first col), sqrt(1-rho^2) diagonal
    var sqrtRho = Math.sqrt(Math.max(0, rho));
    var sqrtOneMinusRho = Math.sqrt(Math.max(0.001, 1 - rho));

    // Monte Carlo: count how often ALL Z_i > -zThreshold_i
    var count = 0;
    // Use deterministic seed-like approach with quasi-random for speed
    for (var s = 0; s < nSim; s++) {
      var common = _boxMuller(s * 2);
      var allAbove = true;
      for (var j = 0; j < n; j++) {
        var idio = _boxMuller(s * 2 + j * nSim + 1);
        var z = sqrtRho * common + sqrtOneMinusRho * idio;
        if (z < -zThresholds[j]) { allAbove = false; break; }
      }
      if (allAbove) count++;
    }
    return Math.max(0.01, Math.min(0.99, count / nSim));
  }

  // Approximate inverse normal CDF (Beasley-Springer-Moro)
  function _norminv(p) {
    if (p <= 0.001) return -3.09;
    if (p >= 0.999) return 3.09;
    if (p === 0.5) return 0;
    // Rational approximation
    var t = p < 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
    var c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
    var d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
    var result = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
    return p < 0.5 ? -result : result;
  }

  // Deterministic pseudo-random normal (Box-Muller with hash)
  function _boxMuller(seed) {
    // Simple hash for reproducibility
    var x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    var u1 = x - Math.floor(x);
    x = Math.sin((seed + 1) * 12.9898 + 78.233) * 43758.5453;
    var u2 = x - Math.floor(x);
    u1 = Math.max(0.0001, u1);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
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
    if (st === 'taux_fixe' || st === 'taux_fixe_in_fine' || st === 'callable' || st === 'range_accrual') return true;
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
        var participation = product.participationRate || (product.aiParsed && product.aiParsed.participationRate) || norm.coupon || 7;
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
    } else if (st === 'taux_fixe' || st === 'taux_fixe_in_fine') {
      norm.capitalProtection = true;
      norm.barrier = 0;
      norm.couponType = 'fixe';
      norm.worstOf = false;
      norm._structureType = st === 'taux_fixe_in_fine' ? 'taux_fixe_in_fine' : 'taux_fixe';
      // In-fine: coupon is capitalized, use annualized rate for scoring
      if (st === 'taux_fixe_in_fine') {
        var annRate = (product.coupon && product.coupon.annualizedRate) || norm.coupon;
        norm.coupon = annRate;
        norm._inFine = true;
      }
    } else if (st === 'range_accrual') {
      norm.capitalProtection = true;
      norm.barrier = 0;
      norm.couponType = 'conditionnel';
      norm.worstOf = false;
      norm.autocall = false;
      norm._structureType = 'range_accrual';
    }
    return norm;
  }

  // ═══ SECTION 4b: CORRELATION DATA (from stock-analysis-platform) ═══
  var _corrData = null;
  function _loadCorrData() {
    if (_corrData !== null) return Promise.resolve(_corrData);
    return fetch('data/market/corr_dispersion_tech.json').then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(d) {
      _corrData = d || false;
      if (d && d.correlation_1y) {
        console.log('[Grader v7] Correlation data loaded: avg=' + d.correlation_1y.avg.toFixed(3) + ' (' + (d._meta.tickers || []).join(',') + ')');
      }
      return _corrData;
    }).catch(function() { _corrData = false; return false; });
  }

  function _getRealCorrelation(unds) {
    if (!_corrData || !_corrData.correlation_1y || !_corrData._meta) return null;
    // Check if the product underlyings match the correlation data tickers
    var corrTickers = (_corrData._meta.tickers || []).map(function(t) { return t.toUpperCase(); });
    var matched = 0;
    (unds || []).forEach(function(u) {
      var upper = u.toUpperCase();
      if (corrTickers.some(function(t) { return upper.indexOf(t) >= 0 || t.indexOf(upper) >= 0; })) matched++;
    });
    // If at least 50% of underlyings match, use the real correlation
    if (matched >= unds.length * 0.5) return _corrData.correlation_1y.avg;
    return null;
  }

  // ═══ SECTION 5a: RATE P1 — Historical probability from rates.json ═══
  // Uses 20-year historical data to compute real probabilities for rate products
  // (TARN, Range Accrual, Digital, Callable, Hybride taux)

  var _ratesCache = null;
  function _loadRatesForGrading() {
    if (_ratesCache) return _ratesCache;
    try {
      // Synchronous read from cache if MarketAnalyzer loaded the data
      if (window._mktRateDataCache) { _ratesCache = window._mktRateDataCache; return _ratesCache; }
      // Try fetch (will be async on first call, cached after)
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'data/market/rates.json', false); // sync for grading
      xhr.send();
      if (xhr.status === 200) { _ratesCache = JSON.parse(xhr.responseText); return _ratesCache; }
    } catch(e) { /* silent */ }
    return null;
  }

  function _computeRateP1Historical(product, norm, annRate, triggerCoupon, matMax, hasMemory, isProtected) {
    var rates = _loadRatesForGrading();
    if (!rates || !rates.yields) return null;

    var st = (product.structureType || product.type || '').toLowerCase();
    var coupon = product.coupon || {};
    var trigger = parseFloat(coupon.trigger) || parseFloat((product.capitalProtection || {}).barrierCoupon) || 0;
    if (!trigger || trigger <= 0) return null; // can't compute without trigger

    // Guess which rate this product tracks
    var rateAlias = null;
    var productText = [product.name, (coupon.triggerDetail || ''), (product.mechanism || '')].join(' ').toLowerCase();
    if (/tec\s*10/i.test(productText)) rateAlias = 'tec10_fr'; // French TEC10 (BdF), NOT OAT AAA
    else if (/oat\s*10/i.test(productText)) rateAlias = 'tec10_fr'; // OAT 10Y France = TEC10
    else if (/euribor\s*12/i.test(productText)) rateAlias = 'euribor_12m';
    else if (/euribor\s*3/i.test(productText)) rateAlias = 'euribor_3m';
    else if (/euribor\s*6/i.test(productText)) rateAlias = 'euribor_6m';
    else if (/tec\s*7/i.test(productText)) rateAlias = 'tec7_fr';
    else if (/tec\s*5/i.test(productText)) rateAlias = 'tec5_fr';
    else if (/tec\s*2/i.test(productText)) rateAlias = 'tec2_fr';
    else if (/cms\s*10/i.test(productText)) rateAlias = 'oat_fr_10y'; // CMS 10Y ≈ OAT AAA (proxy)
    else if (/oat\s*5/i.test(productText)) rateAlias = 'tec5_fr';
    else if (/oat\s*2/i.test(productText)) rateAlias = 'tec2_fr';
    else if (st.indexOf('taux') >= 0 || st === 'capital_garanti' || st === 'digitale_memoire') rateAlias = 'tec10_fr'; // default to TEC10

    var rateData = rates.yields[rateAlias];
    if (!rateData || !rateData.history || rateData.history.length < 10) return null;

    var history = rateData.history;
    var current = rateData.current || 0;

    // ─── Compute probCoupon from historical data ──────
    var probCoupon = 0;
    var isRange = st === 'range_accrual' || st === 'range-accrual';
    var ra = product.rangeAccrual || {};

    // Exponential weighting: half-life 5 years — recent data matters more
    var HALF_LIFE_YEARS = 5;
    var lastDate = new Date(history[history.length - 1].date);
    var weights = history.map(function(h) {
      var ageMs = lastDate - new Date(h.date);
      var ageYears = ageMs / (365.25 * 24 * 3600 * 1000);
      return Math.exp(-Math.LN2 * ageYears / HALF_LIFE_YEARS);
    });
    var totalWeight = weights.reduce(function(s, w) { return s + w; }, 0);

    if (isRange && ra.lowerBound && ra.upperBound) {
      // Range Accrual: weighted % time in corridor
      var inCorridorW = 0;
      history.forEach(function(h, i) {
        if (h.value >= ra.lowerBound && h.value <= ra.upperBound) inCorridorW += weights[i];
      });
      probCoupon = inCorridorW / totalWeight;
    } else if (trigger > 0 && trigger < 10) {
      // TARN / Digital: trigger is a rate level (e.g., 4.40%)
      // "coupon paid if rate ≤ trigger" — weighted by recency
      var belowW = 0;
      history.forEach(function(h, i) {
        if (h.value <= trigger) belowW += weights[i];
      });
      probCoupon = belowW / totalWeight;
    } else {
      // Trigger > 10 means it's a percentage trigger for actions (100%, 77%)
      // Not applicable for rate historical — skip
      return null;
    }

    // Regime adjustment using z-score of current rate vs weighted history
    var wAvg = 0, wVar = 0;
    history.forEach(function(h, i) { wAvg += h.value * weights[i]; });
    wAvg /= totalWeight;
    history.forEach(function(h, i) { wVar += weights[i] * Math.pow(h.value - wAvg, 2); });
    var wStd = Math.sqrt(wVar / totalWeight);
    var zScore = wStd > 0 ? (current - wAvg) / wStd : 0;

    if (zScore > 1.5) {
      // Current rate well above weighted mean → reduce P(coupon) for below-trigger products
      probCoupon = probCoupon * 0.85;
    } else if (zScore > 0.5) {
      probCoupon = probCoupon * 0.93;
    } else if (zScore < -1.5) {
      // Current rate well below weighted mean → coupon very likely
      probCoupon = Math.min(0.99, probCoupon * 1.05);
    }

    // Memory boost: if coupon is missed one year, it can be recovered later
    // The effective probability is higher because missed coupons accumulate
    // Model: over N years, prob of getting ALL coupons eventually ≈ 1 - (1-p)^N
    // Simplified: boost proportional to maturity and base probability
    if (hasMemory) {
      var missProb = 1 - probCoupon;
      // Probability of catching up over remaining years
      var catchupBoost = 1 - Math.pow(missProb, Math.min(matMax, 5));
      probCoupon = Math.min(0.99, probCoupon + (1 - probCoupon) * catchupBoost * 0.5);
    }
    probCoupon = Math.max(0.01, Math.min(0.99, probCoupon));

    // ─── Compute probExit + matEsperee ──────
    var er = product.earlyRedemption || {};
    var probExit = 0;
    var guaranteedYears = product.guaranteedYears || 0;
    var matEsperee = matMax;

    if (er.possible && (er.type === 'autocall' || er.type === 'tarn') && (er.trigger || product.autocallCumulTarget)) {
      // TARN autocall: cumulative coupon target
      // Use autocallCumulTarget if available (more precise), fallback to er.trigger
      var targetCumul = parseFloat(product.autocallCumulTarget) || parseFloat(er.trigger) || 24;
      var couponPerYear = annRate || 0;
      if (couponPerYear > 0 && targetCumul > 0) {
        var yearsToTarget = targetCumul / couponPerYear;
        // Adjust for probability of receiving coupon each year
        var adjustedYears = yearsToTarget / probCoupon;
        // matEsperee = adjusted years to reach target (capped at matMax)
        matEsperee = Math.min(matMax, Math.max(guaranteedYears || 1, Math.ceil(adjustedYears)));
        probExit = Math.min(0.95, adjustedYears <= matMax ? (matMax - adjustedYears) / matMax : 0.05);
      }
    } else if (er.possible && er.type === 'callable') {
      // Callable: emitter decides, typically calls when rates drop
      // Higher current rate vs historical → less likely to be called
      if (current > fullAvg) probExit = 0.3; // rates above average → low call probability
      else probExit = 0.6; // rates below average → higher call probability
    }

    // ─── Score ──────
    var couponEffectif = annRate * probCoupon;
    // Deduct annualized commissions from net return
    var commAnnual = (parseFloat(product.commissions) || 0) / matMax;
    var rendementNet = couponEffectif - commAnnual;
    var score = Math.round(35 + rendementNet * 6);
    score = Math.max(5, Math.min(95, score));

    // Boost for guaranteed years
    if (guaranteedYears >= 2) score = Math.min(95, score + 5);
    else if (guaranteedYears >= 1) score = Math.min(95, score + 3);

    // Boost for capital guaranteed
    if (isProtected) score = Math.min(95, score + 5);

    return {
      score: score,
      probCoupon: Math.round(probCoupon * 1000) / 10,
      probExit: Math.round(probExit * 100),
      rendementNet: Math.round(rendementNet * 100) / 100,
      couponEffectif: Math.round(couponEffectif * 100) / 100,
      perteEsperee: 0,
      vols: [],
      matEsperee: matEsperee,
      isRate: true,
      historicalBasis: history.length + ' obs (' + history[0].date + '→' + history[history.length-1].date + ')',
      rateAlias: rateAlias,
      currentRate: current,
      trigger: trigger
    };
  }

  // ═══ SECTION 5: BS P1 CALCULATION ═══
  function _computeBSP1(product, norm, rfRate) {
    var coupon = product.coupon || {};
    var cp = product.capitalProtection || {};
    var er = product.earlyRedemption || {};
    var undType = (product.underlyingType || '').toLowerCase();
    var st = (product.structureType || '').toLowerCase();

    var annRate = norm.coupon || 0;
    var isAutocall = er.type === 'autocall' || (er.possible && er.trigger > 0);

    // IMPORTANT: separate coupon trigger from autocall trigger
    // Phoenix: coupon trigger = 60% (barrierCoupon), autocall trigger = 100% (er.trigger)
    var triggerCoupon = parseFloat(cp.barrierCoupon) || parseFloat(coupon.trigger) || 100;
    var triggerAutocall = isAutocall ? (parseFloat(er.trigger) || 100) : 100;

    // For probCoupon calculation, use the COUPON trigger (lower = easier)
    // For autocall timing, use the AUTOCALL trigger

    var barrierCapital = parseFloat(cp.barrier) || 0;
    var isProtected = cp.protected || false;
    var matMax = parseFloat(product.maturityYears) || 5;
    var matEsperee = matMax;

    // Step-down reduces effective autocall trigger over time → shorter expected maturity
    var hasStepDown = er.stepDown && er.stepDownPct;
    if (product.grading && product.grading.metadata && product.grading.metadata.expectedMaturity) {
      matEsperee = product.grading.metadata.expectedMaturity;
    } else if (isAutocall || product.autocall) {
      if (hasStepDown) {
        // Step-down: trigger drops each period → autocall becomes easier → shorter maturity
        // E.g., 100% → 95% → 90% → 85% → 80% over 5 semesters
        // Rough estimate: maturity ~40% of max for strong step-down
        matEsperee = Math.min(matMax, Math.max(1, matMax * 0.30));
      } else {
        matEsperee = Math.min(matMax, Math.max(1, matMax * 0.35));
      }
    }

    var dec = parseFloat(product.decrementPct) || 0;
    var div = parseFloat(product.actualDividendYield) || 0;
    var drag = Math.max(0, dec - div);

    var unds = (product.underlyings || []).map(function(u) { return typeof u === 'string' ? u : (u.name || u.ticker || ''); }).filter(Boolean);
    var isDispersion = st === 'dispersion' || undType === 'pairs';
    var isRate = st === 'taux_fixe' || st === 'taux_fixe_in_fine' || st === 'digitale_memoire' || undType === 'rates' || undType === 'credit';
    var isWorstOf = undType === 'worst-of' || undType === 'worst_of';
    var isBasket = _isBasketProduct(product);
    if (isBasket && isWorstOf) isWorstOf = false;
    var hasMemory = (coupon.memory === true) || st === 'phoenix_memoire';

    // ─── RATE PRODUCTS: use historical data instead of BS ──────
    if (isRate) {
      var rateResult = _computeRateP1Historical(product, norm, annRate, triggerCoupon, matMax, hasMemory, isProtected);
      if (rateResult) return rateResult;
      return null; // fallback to heuristic if no historical data
    }

    var vols = _resolveVols(unds, undType);
    var r = RISK_FREE_RATE; // €STR for BS diffusion, not CAT benchmark
    var probCoupon, couponEffectif, perteEsperee;

    // Get real correlation if available (from stock-analysis-platform data)
    var realCorr = _getRealCorrelation(unds);
    var corrUsed = realCorr || 0.4; // fallback to 0.4

    if (isDispersion) {
      probCoupon = 0.95;
      // Adjust dispersion return based on real correlation
      // Higher correlation → less dispersion → lower return
      // Base: 11% at corr 0.30, scales inversely
      var dispBase = 11;
      if (realCorr != null) {
        // corr 0.30 → 12%, corr 0.43 → 9%, corr 0.60 → 6%, corr 0.90 → 1%
        dispBase = Math.max(0.5, Math.round((1 - realCorr) * 16 * 10) / 10);
      }
      couponEffectif = dispBase;
    } else if (isBasket && vols.length > 1) {
      var bVol = _basketVol(vols, corrUsed);
      probCoupon = _probAbove(triggerCoupon, bVol, matEsperee, r);
      couponEffectif = annRate;
    } else if (isWorstOf && vols.length > 1) {
      // Gaussian copula approximation for worst-of
      var probs = vols.map(function(v) { return _probAbove(triggerCoupon, v, matEsperee, r); });
      var rho = realCorr || 0.40;
      probCoupon = _worstOfCopula(probs, rho);
      // Stress scenario: also compute at rho=0.85 for crash correlation
      var probStress = _worstOfCopula(probs, 0.85);
      couponEffectif = annRate;
    } else {
      var vol = vols.length > 0 ? Math.max.apply(null, vols) : 25;
      probCoupon = _probAbove(triggerCoupon, vol, matEsperee, r);
      couponEffectif = annRate;
    }

    var isSL = _isSwissLifeEnvelope(product);
    var memBoost = isSL ? 1.15 : 1.08;
    if (hasMemory && !isDispersion) probCoupon = Math.min(0.99, probCoupon * memBoost);
    // Swiss Life + step-down + memory = very likely to pay out → extra boost
    if (isSL && hasMemory && hasStepDown) probCoupon = Math.min(0.99, probCoupon * 1.05);
    probCoupon = Math.max(0.01, Math.min(0.99, probCoupon));

    var rendementEspere = couponEffectif * probCoupon;
    perteEsperee = 0;
    if (!isProtected && barrierCapital > 0 && barrierCapital < 100) {
      var volForBreach = (isBasket && vols.length > 1) ? _basketVol(vols, 0.4) : (vols.length > 0 ? Math.max.apply(null, vols) : 25);
      var probB = _probBreach(barrierCapital, volForBreach, matEsperee, r);
      // Swiss Life: lower loss multiplier (long-term envelope, risk accepted)
      var lossMult = _isSwissLifeEnvelope(product) ? 0.8 : 1.3;
      perteEsperee = (1 - barrierCapital / 100) * 100 * lossMult * probB / Math.max(1, matEsperee);
    }

    // Deduct annualized commissions
    var bsCommAnnual = (parseFloat(product.commissions) || 0) / Math.max(1, matMax);
    var rendementNet = rendementEspere - perteEsperee - drag - bsCommAnnual;
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
  // v7.1: basket bonus conditioned on P2 quality (OpenAI feedback)
  function _recalibrateP3(oldP3, product, p2Score) {
    var base = 50;
    var st = (product.structureType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    var n = (product.underlyings || []).length;
    if (st === 'dispersion' || ut === 'pairs') base += 15;
    else if (st === 'capital_garanti' || (product.capitalProtection && product.capitalProtection.protected)) base += 10;
    else if (ut === 'basket') {
      // v7.1: basket bonus reduced if P2 is low (bad underlyings)
      // Full +12 if P2 >= 60, reduced proportionally if lower
      var basketBonus = p2Score >= 60 ? 12 : Math.round(12 * Math.max(0.25, p2Score / 60));
      base += basketBonus;
    }
    else if (ut === 'single-index') base += 8;
    else if (ut === 'worst-of' || ut === 'worst_of') { if (n <= 2) base += 0; else if (n <= 3) base -= 5; else base -= 10; }
    else if (ut === 'single-stock') base -= 10;
    else if (ut === 'none' || st === 'taux_fixe' || st === 'taux_fixe_in_fine') base += 5;
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
    // Guaranteed years reduce uncertainty
    var guaranteedYears = product.guaranteedYears || (product.aiParsed && product.aiParsed.guaranteedYears) || 0;
    if (guaranteedYears >= 2) adj += 5;
    else if (guaranteedYears >= 1) adj += 3;
    var slMode = _isSwissLifeEnvelope(product);
    if (ut === 'single-stock') adj -= slMode ? 2 : 5;
    if (ut === 'single-stock' && product.capitalProtection && parseFloat(product.capitalProtection.barrier) > 0 && parseFloat(product.capitalProtection.barrier) < 65) adj -= slMode ? 1 : 3;
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
    if (type === 'liquidity' || type === 'taux_fixe' || type === 'taux_fixe_in_fine') return;
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

  // ═══ SECTION 6a2: DISPERSION BACKTEST 1Y ═══
  function _computeDispersionBacktest(product, stockData) {
    var st = (product.structureType || '').toLowerCase();
    if (st !== 'dispersion') return null;

    var unds = product.underlyings || [];
    if (unds.length < 2) return null;

    // Use stockData from grading context (has perf_1y for each underlying)
    var sd = stockData || (product.grading && product.grading.metadata && product.grading.metadata.stockData) || [];

    var perfs = [];
    unds.forEach(function(u) {
      var name = typeof u === 'string' ? u : (u.name || '');
      var perf = null;
      // Match with stockData
      var match = sd.find(function(s) {
        return s && (
          (s.name || '').toUpperCase().indexOf(name.toUpperCase()) >= 0 ||
          name.toUpperCase().indexOf((s.name || '').toUpperCase()) >= 0 ||
          (s.ticker || '').toUpperCase() === name.toUpperCase()
        );
      });
      if (match && match.perf_1y != null) perf = parseFloat(match.perf_1y);
      perfs.push({ name: name.substring(0, 20), perf: perf });
    });

    var validPerfs = perfs.filter(function(p) { return p.perf !== null; });
    if (validPerfs.length < 2) return null;

    // Compute all pairs dispersion
    var pairResults = [];
    for (var i = 0; i < validPerfs.length; i++) {
      for (var j = i + 1; j < validPerfs.length; j++) {
        var dispersion = Math.abs(validPerfs[i].perf - validPerfs[j].perf);
        pairResults.push({
          stock1: validPerfs[i].name,
          stock2: validPerfs[j].name,
          perf1: validPerfs[i].perf,
          perf2: validPerfs[j].perf,
          dispersion: dispersion
        });
      }
    }

    var avgDispersion = pairResults.reduce(function(s, p) { return s + p.dispersion; }, 0) / pairResults.length;
    var participation = parseFloat(product.participationRate) || parseFloat(product.coupon && product.coupon.rate) || 7;
    var returnPct = Math.round(participation * avgDispersion) / 100;
    var nominal = parseFloat(product.investedAmount) || 100000;
    var returnEur = Math.round(nominal * returnPct / 100);

    // Sort pairs by dispersion (most dispersed first)
    pairResults.sort(function(a, b) { return b.dispersion - a.dispersion; });

    return {
      pairs: pairResults,
      avgDispersion: Math.round(avgDispersion * 100) / 100,
      participation: participation,
      returnPct: Math.round(returnPct * 100) / 100,
      returnEur: returnEur,
      nbPairs: pairResults.length,
      nbStocks: validPerfs.length,
      topPair: pairResults[0],
      worstPair: pairResults[pairResults.length - 1],
      perfs: validPerfs
    };
  }

  // ═══ SECTION 6b: REGIME SCENARIOS ═══
  // Simple 3-scenario analysis: current regime, bull, crash
  // Not a Monte Carlo — just "what would change if regime shifts"
  function _computeRegimeScenarios(result, product, bs, catRate, issuer) {
    if (!result || !result.pillars) return null;

    var p1 = result.pillars.adjustedReturn.score;
    var p2 = result.pillars.underlyingQuality.score;
    var p3 = result.pillars.portfolioFit.score;
    var p4 = result.pillars.riskPremium.score;
    var currentTotal = result.score;

    // Bull scenario: sectors no longer avoided, vol down, prob coupon up
    var bullP2 = Math.min(95, p2 + 10); // sectors no longer penalized
    var bullP1 = bs ? Math.min(95, p1 + 8) : Math.min(95, p1 + 5); // higher prob coupon
    var bullP4 = Math.min(95, p4 + 5); // lower illiquidity aversion
    var bullTotal = Math.round(bullP1 * V7_WEIGHTS.p1 + bullP2 * V7_WEIGHTS.p2 + p3 * V7_WEIGHTS.p3 + bullP4 * V7_WEIGHTS.p4);

    // Crash scenario: vol spikes, correlation → 1, prob coupon drops
    var crashP2 = Math.max(5, p2 - 15); // quality degrades
    var crashP1 = bs ? Math.max(5, p1 - 15) : Math.max(5, p1 - 10); // prob coupon drops
    var crashP4 = Math.max(5, p4 - 8); // spread worse
    // Capital garanti: P1 doesn't drop as much (still get capital back)
    var isCG = product.capitalProtection && product.capitalProtection.protected;
    if (isCG) { crashP1 = Math.max(10, p1 - 8); crashP4 = Math.max(10, p4 - 3); }
    var crashTotal = Math.round(crashP1 * V7_WEIGHTS.p1 + crashP2 * V7_WEIGHTS.p2 + p3 * V7_WEIGHTS.p3 + crashP4 * V7_WEIGHTS.p4);

    var _g = function(s) { return s >= 75 ? 'A' : s >= 60 ? 'B' : s >= 45 ? 'C' : s >= 25 ? 'D' : 'F'; };

    // Generate context-aware descriptions based on product type
    var st = (product.structureType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    var isRates = ut === 'rates' || st === 'taux_fixe' || st === 'taux_fixe_in_fine' || st === 'range_accrual' || st === 'callable';
    var currentDesc, bullDesc, crashDesc;

    if (isRates) {
      currentDesc = 'Taux élevés, BCE hawkish → coupon sous pression';
      bullDesc = 'Taux baissent → coupon plus probable, call risk monte';
      crashDesc = 'Taux spike puis chutent → volatilité, incertitude coupon';
      if (st === 'range_accrual') {
        currentDesc = 'Euribor dans le corridor mais BCE menaçante';
        bullDesc = 'Taux baissent → Euribor reste dans le corridor';
        crashDesc = 'Taux volatils → Euribor sort du corridor régulièrement';
      } else if (st === 'taux_fixe' || st === 'taux_fixe_in_fine' || st === 'callable') {
        currentDesc = 'Call unlikely (20%) → coupon garanti sur la durée';
        bullDesc = 'Taux baissent → call probable → réinvestissement à taux bas';
        crashDesc = 'Taux montent → pas de call, coupon garanti = atout';
        if (st === 'taux_fixe_in_fine') {
          currentDesc = 'In fine: pas de cash-flow intermédiaire, TRI ~3.9% si go-to-maturity';
          bullDesc = 'Taux baissent → call probable → coupon capitalisé versé en une fois';
          crashDesc = 'Taux montent → pas de call, intérêts simples sur 10 ans = rendement moindre';
        }
      } else if (product.coupon && product.coupon.memory) {
        currentDesc = 'Seuil menacé mais mémoire rattrape les coupons';
        bullDesc = 'Taux baissent sous le seuil → coupons + rattrapage';
        crashDesc = 'Taux au-dessus du seuil → 0% coupon (mémoire active)';
      }
    } else if (st === 'dispersion') {
      currentDesc = 'Corrélation 0.43 → dispersion favorable';
      bullDesc = 'Marchés calmes → corrélation baisse → coupon monte';
      crashDesc = 'Panique → corrélation spike → coupon baisse (cap garanti)';
    } else {
      currentDesc = 'Régime actuel → volatilité modérée';
      bullDesc = 'Marchés haussiers → prob coupon monte, barrière safe';
      crashDesc = 'Marchés baissiers → barrière menacée, vol en hausse';
    }

    return {
      current: { score: currentTotal, grade: _g(currentTotal), label: 'Actuel (' + (_getRegime() || 'neutral') + ')', desc: currentDesc },
      bull: { score: bullTotal, grade: _g(bullTotal), label: 'Bull / Risk-on', delta: bullTotal - currentTotal, desc: bullDesc },
      crash: { score: crashTotal, grade: _g(crashTotal), label: 'Crash / Récession', delta: crashTotal - currentTotal, desc: crashDesc }
    };
  }

  function _getRegime() {
    try {
      if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._mi && _mktCache._mi.regime) return _mktCache._mi.regime.toLowerCase();
    } catch(e) {}
    return 'neutral';
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
    // Load vol data + correlation data at startup
    Promise.all([
      _loadVolData(),
      _loadCorrData()
    ]).then(function() {
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
          result.metadata.expectedMaturity = bs.matEsperee;
          result.metadata.couponProbability = bs.probCoupon;
          result.metadata.isBasket = bs.isBasket;
          // Rate product historical data
          if (bs.isRate) {
            result.metadata.isRateHistorical = true;
            result.metadata.historicalBasis = bs.historicalBasis;
            result.metadata.rateAlias = bs.rateAlias;
            result.metadata.currentRate = bs.currentRate;
            result.metadata.rateTrigger = bs.trigger;
            result.metadata.probExit = bs.probExit;
          }
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

      // 4b. Recalibrate P3 (v7.1: basket bonus conditioned on P2)
      var p2Score = result.pillars.underlyingQuality.score;
      var newP3 = _recalibrateP3(result.pillars.portfolioFit.score, product, p2Score);
      result.pillars.portfolioFit.score = newP3;

      // 4c. Adjust P1 (memory +5, single-stock -5)
      result.pillars.adjustedReturn.score = _adjustP1(result.pillars.adjustedReturn.score, product);

      // 4d. P4 BS correction (exempt guaranteed rates)
      result.pillars.riskPremium.score = _adjustP4WithBS(result.pillars.riskPremium.score, product, catRate);

      // 4e. Issuer credit risk penalty on P4 (v7.1)
      var issuer = (typeof ISSUER_RATINGS !== 'undefined') ? ISSUER_RATINGS[product.bankId || ''] : null;
      if (issuer && issuer.cds_proxy && product.maturityYears) {
        var matY = parseFloat(product.maturityYears) || 5;
        // CDS proxy in bps. Annualized default prob ≈ cds / 10000 / 0.6
        // P4 penalty = creditCost × maturity scaling (longer = more exposure)
        var creditCostAnnual = issuer.cds_proxy / 100; // bps to % (e.g., 70bps = 0.70%)
        var matScale = Math.min(2.0, Math.max(0.5, matY / 5)); // 1.0 at 5Y, 2.0 at 10Y+
        var creditPenalty = Math.round(creditCostAnnual * matScale);
        creditPenalty = Math.min(creditPenalty, 8); // cap at -8 pts

        if (creditPenalty > 0) {
          result.pillars.riskPremium.score = Math.max(5, result.pillars.riskPremium.score - creditPenalty);
          if (result.metadata) {
            result.metadata.issuerCreditPenalty = creditPenalty;
            result.metadata.issuerCDS = issuer.cds_proxy;
          }
        }
      }

      // Step 5: Final total with v7 weights (30/20/15/30)
      var p1 = result.pillars.adjustedReturn.score;
      var p2 = result.pillars.underlyingQuality.score;
      var p3 = result.pillars.portfolioFit.score;
      var p4 = result.pillars.riskPremium.score;
      var _w = _isSwissLifeEnvelope(product) ? V7_WEIGHTS_SL : V7_WEIGHTS;
      var total = Math.round(p1 * _w.p1 + p2 * _w.p2 + p3 * _w.p3 + p4 * _w.p4);
      result.score = total;
      result.grade = total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 25 ? 'D' : 'F';

      // Step 6: Mini-scenarios (v7.1 — stagflation/bull/crash)
      result.regimeScenarios = _computeRegimeScenarios(result, product, bs, catRate, issuer);

      // Step 6b: Dispersion backtest 1Y
      var backtest = _computeDispersionBacktest(product);
      if (backtest) {
        result.dispersionBacktest = backtest;
        product._dispersionBacktest = backtest;
      }

      if (result.metadata) {
        result.metadata.v6Weights = V7_WEIGHTS;
        result.metadata.version = '7.1';
        if (_isSwissLifeEnvelope(product)) {
          result.metadata.envelopeMode = 'swiss-life';
          result.metadata.v6Weights = _w;
        }
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

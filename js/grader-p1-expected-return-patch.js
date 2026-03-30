// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader P1 Expected Return Patch v1.0
//
// Remplace le P1 heuristique par un calcul Black-Scholes:
//   rendement_net = prob_coupon × coupon - perte_espérée - drag
//   score = f(rendement_net)
//
// Utilise les vol 3Y réelles du market data StructBoard.
// Chargé en DERNIER (outermost) → écrase les P1 des autres patches.
// Les ajustements P2/P3/P4 des autres patches sont conservés.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Normal CDF (Abramowitz & Stegun, précision ~1e-7) ───
  function _normcdf(x) {
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;
    var t = 1.0 / (1.0 + p * x);
    var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
  }

  // P(S_T > K) = N(d2)
  function _probAbove(trigger, volPct, T, rPct) {
    var sigma = volPct / 100;
    var r = rPct / 100;
    T = Math.max(0.25, T);
    var d2 = (Math.log(100 / trigger) + (r - sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    return _normcdf(d2);
  }

  // P(min S_t < B sur [0,T]) — barrière continue
  function _probBreach(barrierPct, volPct, T, rPct) {
    if (!barrierPct || barrierPct <= 0 || barrierPct >= 100) return 0;
    var sigma = volPct / 100;
    var r = rPct / 100;
    T = Math.max(0.25, T);
    var mu = r - sigma * sigma / 2;
    var sqrtT = Math.sqrt(T);
    var logSB = Math.log(100 / barrierPct);
    var d1 = (logSB + mu * T) / (sigma * sqrtT);
    var d2 = (-logSB + mu * T) / (sigma * sqrtT);
    var ratio = Math.pow(barrierPct / 100, 2 * mu / (sigma * sigma));
    return Math.min(0.95, _normcdf(-d1) + ratio * _normcdf(d2));
  }

  // ─── Vol Data Cache ───
  var _volData = null;

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
        if (d && d.tickers) {
          Object.keys(d.tickers).forEach(function(k) {
            if (d.tickers[k].vol_3y) {
              _volData.proxies[k.toUpperCase()] = d.tickers[k].vol_3y;
            }
          });
        }
      }).catch(function() {});

    var p3 = fetch('data/underlying-map.json').then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.indices) {
          Object.keys(d.indices).forEach(function(name) {
            var info = d.indices[name];
            _volData.indices[name.toUpperCase()] = {
              proxy: (info.proxy || '').toUpperCase(),
              defaultVol: info.default_vol || 20
            };
          });
        }
      }).catch(function() {});

    return Promise.all([p1, p2, p3]).then(function() {
      // Link index names to proxy ETF vols
      Object.keys(_volData.indices).forEach(function(name) {
        var info = _volData.indices[name];
        if (info.proxy && _volData.proxies[info.proxy]) {
          info.realVol = _volData.proxies[info.proxy];
        }
      });
      console.log('[p1-bs] Vol data loaded: ' +
        Object.keys(_volData.stocks).length + ' stocks, ' +
        Object.keys(_volData.indices).length + ' indices');
      return _volData;
    });
  }

  // ─── Resolve vol for a given underlying name ───
  function _resolveVol(name) {
    if (!_volData || !name) return null;
    var n = name.toUpperCase().trim();

    // 1. Direct stock match (ticker or name)
    if (_volData.stocks[n]) return _volData.stocks[n];

    // 2. Index match
    if (_volData.indices[n]) {
      return _volData.indices[n].realVol || _volData.indices[n].defaultVol;
    }

    // 3. Partial match on stock names
    var keys = Object.keys(_volData.stocks);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(n) >= 0 || n.indexOf(keys[i]) >= 0) {
        return _volData.stocks[keys[i]];
      }
    }

    // 4. Partial match on index names
    keys = Object.keys(_volData.indices);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(n) >= 0 || n.indexOf(keys[i]) >= 0) {
        var info = _volData.indices[keys[i]];
        return info.realVol || info.defaultVol;
      }
    }

    return null;
  }

  // ─── Default vol by underlying type ───
  var DEFAULT_VOLS = {
    'single-index': 20, 'single_index': 20, 'index': 20,
    'single-stock': 28, 'single_stock': 28, 'stock': 28,
    'worst-of': 30, 'worst_of': 30,
    'basket': 22,
    'pairs': 25, 'dispersion': 25,
    'rates': 8, 'credit': 10
  };

  // ─── Extract product info for BS calc ───
  function _extractBSInputs(product) {
    var coupon = product.coupon || {};
    var cp = product.capitalProtection || {};
    var er = product.earlyRedemption || {};
    var undType = (product.underlyingType || '').toLowerCase();
    var st = (product.structureType || '').toLowerCase();

    // Annualized rate
    var annRate = (typeof window.getAnnualizedRate === 'function')
      ? window.getAnnualizedRate(product)
      : (parseFloat(coupon.rate || coupon) || 0);

    // Trigger coupon
    var triggerCoupon = parseFloat(cp.barrierCoupon) || 0;
    if (!triggerCoupon && coupon.trigger) triggerCoupon = parseFloat(coupon.trigger);
    // If no explicit coupon trigger, use autocall trigger as proxy
    if (!triggerCoupon && er.trigger) triggerCoupon = parseFloat(er.trigger);
    if (!triggerCoupon) triggerCoupon = 100; // default ATM

    // Barrier capital
    var barrierCapital = parseFloat(cp.barrier) || 0;
    var isProtected = cp.protected || false;

    // Maturité espérée (from grader metadata if available)
    var matMax = parseFloat(product.maturityYears) || 5;
    var matEsperee = matMax;
    // Use grader's estimation if available
    if (product.grading && product.grading.metadata && product.grading.metadata.expectedMaturity) {
      matEsperee = product.grading.metadata.expectedMaturity;
    } else if (er.type === 'autocall' || product.autocall) {
      // Simple heuristic for expected maturity with autocall
      matEsperee = Math.min(matMax, Math.max(1, matMax * 0.35));
    }

    // Drag décrément
    var dec = parseFloat(product.decrementPct) || 0;
    var div = parseFloat(product.actualDividendYield) || 0;
    if (!dec && product.aiParsed) {
      dec = parseFloat(product.aiParsed.decrementPct) || 0;
      div = parseFloat(product.aiParsed.actualDividendYield) || 0;
    }
    var drag = Math.max(0, dec - div);

    // Underlyings
    var unds = product.underlyings || [];
    if ((!unds || unds.length === 0) && product.aiParsed) {
      unds = product.aiParsed.underlyings || [];
    }
    unds = unds.map(function(u) {
      return typeof u === 'string' ? u : (u.name || u.ticker || '');
    }).filter(Boolean);

    // Is dispersion?
    var isDispersion = st === 'dispersion' || undType === 'pairs';
    var isRate = st === 'taux_fixe' || undType === 'rates' || undType === 'credit';
    var isWorstOf = undType === 'worst-of' || undType === 'worst_of';
    var hasMemory = (coupon.memory === true) || st === 'phoenix_memoire';

    // Dispersion historical return
    var dispMedianReturn = 11; // conservative median for 3Y dispersion

    return {
      annRate: annRate,
      triggerCoupon: triggerCoupon,
      barrierCapital: barrierCapital,
      isProtected: isProtected,
      matMax: matMax,
      matEsperee: matEsperee,
      drag: drag,
      underlyings: unds,
      undType: undType,
      isDispersion: isDispersion,
      isRate: isRate,
      isWorstOf: isWorstOf,
      hasMemory: hasMemory,
      dispMedianReturn: dispMedianReturn
    };
  }

  // ─── Resolve vols for all underlyings ───
  function _resolveVols(inputs) {
    var vols = [];
    var defaultVol = DEFAULT_VOLS[inputs.undType] || 25;

    if (inputs.underlyings.length > 0) {
      inputs.underlyings.forEach(function(u) {
        var v = _resolveVol(u);
        vols.push(v || defaultVol);
      });
    } else {
      vols.push(defaultVol);
    }

    return vols;
  }

  // ─── Compute BS-based P1 ───
  function _computeBSP1(inputs, riskFreeRate) {
    var r = riskFreeRate || 2.5;
    var vols = _resolveVols(inputs);
    var log = [];
    var probCoupon, couponEffectif, perteEsperee;

    // ─── Probabilité coupon ───
    if (inputs.isDispersion) {
      probCoupon = 0.95;
      couponEffectif = inputs.dispMedianReturn;
      log.push('Dispersion: prob=95% (mecanique), rdt median hist=' + couponEffectif + '%');
    } else if (inputs.isRate) {
      probCoupon = 0.95;
      couponEffectif = inputs.annRate;
      log.push('Taux fixe: prob=95%, coupon=' + couponEffectif + '%');
    } else if (inputs.isWorstOf && vols.length > 1) {
      var probs = vols.map(function(v) {
        return _probAbove(inputs.triggerCoupon, v, inputs.matEsperee, r);
      });
      probCoupon = probs.reduce(function(a, b) { return a * b; }, 1);

      var corrAdj = 1 + 0.15 * (vols.length - 1);
      var maxProb = Math.min.apply(null, probs);
      probCoupon = Math.min(probCoupon * corrAdj, maxProb);

      couponEffectif = inputs.annRate;
      log.push('WO probs: ' + probs.map(function(p) { return (p * 100).toFixed(0) + '%'; }).join(' x ') +
        ' = ' + (probCoupon * 100).toFixed(1) + '% (corr adj)');
    } else {
      var vol = vols.length > 0 ? Math.max.apply(null, vols) : 25;
      probCoupon = _probAbove(inputs.triggerCoupon, vol, inputs.matEsperee, r);
      couponEffectif = inputs.annRate;
      log.push('P(SJ>' + inputs.triggerCoupon + '% | vol=' + vol.toFixed(0) + '% T=' +
        inputs.matEsperee.toFixed(1) + 'a) = ' + (probCoupon * 100).toFixed(1) + '%');
    }

    // Ajustement mémoire (phoenix)
    if (inputs.hasMemory && !inputs.isDispersion) {
      probCoupon = Math.min(0.99, probCoupon * 1.08);
      log.push('Memoire: prob x 1.08 = ' + (probCoupon * 100).toFixed(1) + '%');
    }

    probCoupon = Math.max(0.01, Math.min(0.99, probCoupon));

    // ─── Rendement espéré ───
    var rendementEspere = couponEffectif * probCoupon;

    // ─── Perte espérée ───
    perteEsperee = 0;
    if (!inputs.isProtected && inputs.barrierCapital > 0 && inputs.barrierCapital < 100) {
      var vol = vols.length > 0 ? Math.max.apply(null, vols) : 25;
      var probB = _probBreach(inputs.barrierCapital, vol, inputs.matEsperee, r);
      var lossSiBreach = (1 - inputs.barrierCapital / 100) * 100 * 1.3;
      perteEsperee = lossSiBreach * probB / Math.max(1, inputs.matEsperee);
      if (perteEsperee > 0.1) {
        log.push('Breach ' + inputs.barrierCapital + '%: P=' + (probB * 100).toFixed(1) +
          '% -> perte esperee ' + perteEsperee.toFixed(1) + '%/an');
      }
    }

    // ─── Rendement net ───
    var rendementNet = rendementEspere - perteEsperee - inputs.drag;
    if (inputs.drag > 0) {
      log.push('Drag decrement: -' + inputs.drag.toFixed(2) + '%/an');
    }
    log.push('Rdt net: ' + rendementEspere.toFixed(1) + '% - ' +
      perteEsperee.toFixed(1) + '%' +
      (inputs.drag > 0 ? ' - ' + inputs.drag.toFixed(1) + '%' : '') +
      ' = ' + rendementNet.toFixed(1) + '%/an');

    // ─── Score mapping ───
    // score = 35 + rendementNet × 6, clamp [5, 95]
    var score = Math.round(35 + rendementNet * 6);
    score = Math.max(5, Math.min(95, score));

    return {
      score: score,
      probCoupon: Math.round(probCoupon * 1000) / 10,
      couponEffectif: Math.round(couponEffectif * 100) / 100,
      rendementEspere: Math.round(rendementEspere * 100) / 100,
      perteEsperee: Math.round(perteEsperee * 100) / 100,
      rendementNet: Math.round(rendementNet * 100) / 100,
      drag: inputs.drag,
      vols: vols,
      matEsperee: inputs.matEsperee,
      reasoning: log.join(' | '),
      method: 'BS-simplifie-v1'
    };
  }

  // ─── Main patch ───
  function _patchGrade() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

    var _prevGrade = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      // Load vol data (cached after first call)
      return _loadVolData().then(function() {
        return _prevGrade.call(ProposalGrader, product);
      }).then(function(result) {
        if (!result || !result.pillars || !product) return result;

        // Skip liquidity and rate products (P1 rate calc is fine as-is)
        var st = (product.structureType || '').toLowerCase();
        var ut = (product.underlyingType || '').toLowerCase();
        if (st === 'taux_fixe' || ut === 'rates' || ut === 'credit') return result;
        if (result.grade === '-') return result;

        // Extract inputs
        var inputs = _extractBSInputs(product);

        // Get risk-free rate from result metadata
        var rfRate = (result.metadata && result.metadata.catBenchmark) || 2.5;

        // Compute BS P1
        var bs = _computeBSP1(inputs, rfRate);

        // Replace P1
        var oldP1 = result.pillars.adjustedReturn.score;
        result.pillars.adjustedReturn.score = bs.score;
        result.pillars.adjustedReturn.reasoning =
          'BS: ' + bs.reasoning +
          ' | Spread vs CAT: ' + (bs.rendementNet - rfRate).toFixed(1) + '%';
        result.pillars.adjustedReturn.base = oldP1;
        result.pillars.adjustedReturn.delta = bs.score - oldP1;

        // Store BS data
        result.pillars.adjustedReturn._bs = bs;

        console.log('[p1-bs] P1: ' + oldP1 + ' -> ' + bs.score +
          ' | prob=' + bs.probCoupon + '% | rdtNet=' + bs.rendementNet + '%/an');

        // Enrich metadata
        if (result.metadata) {
          result.metadata.bsMethod = bs.method;
          result.metadata.bsProbCoupon = bs.probCoupon;
          result.metadata.bsRendementNet = bs.rendementNet;
          result.metadata.bsPerteEsperee = bs.perteEsperee;
          result.metadata.bsCouponEffectif = bs.couponEffectif;
          result.metadata.bsVols = bs.vols;
          result.metadata.bsMatEsperee = bs.matEsperee;
          result.metadata.couponProbability = bs.probCoupon;
        }

        // Also store on product for display
        product._couponProbability = bs.probCoupon;
        product._bsRendementNet = bs.rendementNet;

        // ─── Recalculate total ───
        var p1s = result.pillars.adjustedReturn.score;
        var p2s = result.pillars.underlyingQuality ? result.pillars.underlyingQuality.score : 0;
        var p3s = result.pillars.portfolioFit ? result.pillars.portfolioFit.score : 0;
        var p4s = result.pillars.riskPremium ? result.pillars.riskPremium.score : 0;
        var w = { p1: 0.30, p2: 0.25, p3: 0.20, p4: 0.25 };
        var newTotal = Math.round(p1s * w.p1 + p2s * w.p2 + p3s * w.p3 + p4s * w.p4);

        if (newTotal !== result.score) {
          console.log('[p1-bs] Total: ' + result.score + ' -> ' + newTotal);
          result.score = newTotal;
          if (newTotal >= 75) result.grade = 'A';
          else if (newTotal >= 60) result.grade = 'B';
          else if (newTotal >= 45) result.grade = 'C';
          else if (newTotal >= 25) result.grade = 'D';
          else result.grade = 'F';
        }

        return result;
      });
    };

    console.log('[p1-bs v1.0] Black-Scholes P1 (expected return) active — outermost');
    return true;
  }

  if (!_patchGrade()) {
    var attempts = 0;
    var iv = setInterval(function() {
      attempts++;
      if (_patchGrade() || attempts > 60) clearInterval(iv);
    }, 100);
  }
})();

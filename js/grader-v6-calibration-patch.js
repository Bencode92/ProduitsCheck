// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader v6 Calibration Patch v1.2
//
// Loaded AFTER grader-p1-expected-return-patch.js (outermost)
// 1. Recalibrate P3 from base 70→50 with discriminating adjustments
// 2. Apply v6 weights: P1=30%, P2=15%, P3=25%, P4=30%
// 3. Phoenix memory bonus +5pts on P1
// 4. Single-stock penalty -5pts on P1
// 5. Cap IA delta to ±20pts
// 6. [v1.1] P4 BS correction: use BS net spread instead of facial
// 7. [v1.2] EXEMPT guaranteed rate products from P4 BS correction
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var V6_WEIGHTS = { p1: 0.30, p2: 0.20, p3: 0.15, p4: 0.30 };

  // ─── Recalibrate P3: base 50 with structure-based adjustments ───
  function _recalibrateP3(oldP3, product) {
    var base = 50;
    var st = (product.structureType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    var unds = product.underlyings || [];
    var n = unds.length;
    var isCapGaranti = product.capitalProtection &&
      ((product.capitalProtection.protected === true) || st === 'capital_garanti');

    if (st === 'dispersion' || ut === 'pairs') {
      base += 15;
    } else if (st === 'capital_garanti' || isCapGaranti) {
      base += 10;
    } else if (ut === 'basket') {
      base += 12;
    } else if (ut === 'single-index') {
      base += 8;
    } else if (ut === 'worst-of' || ut === 'worst_of') {
      if (n <= 2) base += 0;
      else if (n <= 3) base -= 5;
      else base -= 10;
    } else if (ut === 'single-stock') {
      base -= 10;
    } else if (st === 'range_accrual') {
      base += 5; // rates diversifier, but conditional coupon (less than taux_fixe)
    } else if (ut === 'none' || st === 'taux_fixe') {
      base += 5;
    }

    var my = parseFloat(product.maturityYears) || 5;
    if (my <= 2) base += 5;
    else if (my > 7) base -= 5;

    var overlapDelta = oldP3 - 70;
    if (overlapDelta < 0) {
      base += Math.max(-20, overlapDelta);
    }

    return Math.max(5, Math.min(95, Math.round(base)));
  }

  // ─── P1 adjustments: Phoenix memory + single-stock penalty ───
  function _adjustP1(oldP1, product) {
    var adj = 0;
    var ut = (product.underlyingType || '').toLowerCase();
    var coupon = product.coupon || {};
    var hasMemory = (typeof coupon === 'object' && (coupon.memory === true));
    var st = (product.structureType || '').toLowerCase();
    if (st === 'phoenix_memoire') hasMemory = true;

    if (hasMemory) adj += 5;
    if (ut === 'single-stock') adj -= 5;

    var cp = product.capitalProtection || {};
    var barrier = parseFloat(cp.barrier) || 0;
    if (ut === 'single-stock' && barrier > 0 && barrier < 65) adj -= 3;

    return Math.max(5, Math.min(95, oldP1 + adj));
  }

  // ─── [v1.2] Check if product is guaranteed rate (exempt from P4 BS) ───
  function _isGuaranteedRateProduct(product) {
    // Flag set by rates-patch v1.2
    if (product._isGuaranteedRate) return true;
    // Fallback detection
    var st = (product.structureType || '').toLowerCase();
    var ct = (product.couponType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    if (st === 'taux_fixe' || st === 'callable' || st === 'range_accrual') return true;
    if ((ct === 'fixe' || ct === 'garanti') && (ut === 'none' || ut === '' || ut === 'rates' || ut === 'credit')) return true;
    return false;
  }

  // ─── [v1.1] P4 BS correction (v1.2: exempt guaranteed rate products) ───
  function _adjustP4WithBS(oldP4, product, catRate) {
    // v1.2: Do NOT correct P4 for guaranteed rate products
    // Their coupon is contractually guaranteed, not conditional on market
    if (_isGuaranteedRateProduct(product)) {
      console.log('[v6-cal] P4 BS: EXEMPT (guaranteed rate product)');
      return oldP4;
    }

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

    if (bsSpread <= 0) {
      newP4 = Math.min(oldP4, 35);
    } else if (bsSpread < 2) {
      newP4 = Math.min(oldP4, Math.max(35, Math.round(oldP4 * ratio)));
    } else {
      newP4 = Math.max(30, Math.round(oldP4 * ratio));
    }

    return Math.max(10, Math.min(95, newP4));
  }

  // ─── Cap IA deltas to ±20 ───
  function _capIADelta(pillar) {
    if (!pillar || pillar.delta === undefined) return;
    var MAX_IA = 20;
    if (Math.abs(pillar.delta) > MAX_IA) {
      var capped = Math.max(-MAX_IA, Math.min(MAX_IA, pillar.delta));
      var diff = pillar.delta - capped;
      pillar.score = Math.max(0, Math.min(100, pillar.score - diff));
      pillar.delta = capped;
      pillar.reasoning = (pillar.reasoning || '') + ' [IA capped ±' + MAX_IA + ']';
    }
  }

  // ─── Main patch ───
  function _patchGrade() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

    var _prevGrade = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      return _prevGrade.call(ProposalGrader, product).then(function(result) {
        if (!result || !result.pillars || !product) return result;
        if (result.grade === '-') return result;

        // 1. Cap IA deltas
        _capIADelta(result.pillars.adjustedReturn);
        _capIADelta(result.pillars.underlyingQuality);
        _capIADelta(result.pillars.portfolioFit);
        _capIADelta(result.pillars.riskPremium);

        // 2. Recalibrate P3
        var oldP3 = result.pillars.portfolioFit.score;
        var newP3 = _recalibrateP3(oldP3, product);
        if (newP3 !== oldP3) {
          result.pillars.portfolioFit.reasoning =
            'Fit: base 50 \u2192 ' + newP3 +
            ' (' + (product.underlyingType || '?') + ', ' +
            (product.structureType || '?') + ')' +
            (result.pillars.portfolioFit.reasoning ?
              ' | ' + result.pillars.portfolioFit.reasoning : '');
          result.pillars.portfolioFit.score = newP3;
        }

        // 3. Adjust P1: Phoenix memory + single-stock
        var oldP1 = result.pillars.adjustedReturn.score;
        var newP1 = _adjustP1(oldP1, product);
        if (newP1 !== oldP1) {
          var delta = newP1 - oldP1;
          result.pillars.adjustedReturn.score = newP1;
          result.pillars.adjustedReturn.reasoning =
            (result.pillars.adjustedReturn.reasoning || '') +
            ' | v6: ' + (delta > 0 ? '+' : '') + delta +
            'pts (' +
            ((product.coupon && product.coupon.memory) ? 'm\u00e9moire+5' : '') +
            ((product.underlyingType || '').toLowerCase() === 'single-stock' ? ' SS-5' : '') +
            ')';
        }

        // 3b. [v1.1/v1.2] Adjust P4 with BS data (exempt guaranteed rates)
        var catRate = (result.metadata && result.metadata.catBenchmark) || (typeof window._getCATBenchmark === 'function' ? window._getCATBenchmark() : 2.5);
        var oldP4 = result.pillars.riskPremium.score;
        var newP4 = _adjustP4WithBS(oldP4, product, catRate);
        if (newP4 !== oldP4) {
          var bsRn = product._bsRendementNet || 0;
          console.log('[v6-cal] P4 BS correction: ' + oldP4 + ' \u2192 ' + newP4 +
            ' (facial spread vs BS net ' + bsRn.toFixed(1) + '%)');
          result.pillars.riskPremium.score = newP4;
          result.pillars.riskPremium.reasoning =
            (result.pillars.riskPremium.reasoning || '') +
            ' | v6-BS: P4 ' + oldP4 + '\u2192' + newP4 +
            ' (rdtNet BS=' + bsRn.toFixed(1) + '% vs CAT ' + catRate.toFixed(1) + '%)';
        }

        // 4. Recalculate total with v6 weights
        var p1s = result.pillars.adjustedReturn.score;
        var p2s = result.pillars.underlyingQuality.score;
        var p3s = result.pillars.portfolioFit.score;
        var p4s = result.pillars.riskPremium.score;

        var newTotal = Math.round(
          p1s * V6_WEIGHTS.p1 +
          p2s * V6_WEIGHTS.p2 +
          p3s * V6_WEIGHTS.p3 +
          p4s * V6_WEIGHTS.p4
        );

        if (newTotal !== result.score) {
          console.log('[v6-cal] Total: ' + result.score + ' \u2192 ' + newTotal +
            ' | P1=' + p1s + ' P2=' + p2s + ' P3=' + p3s + ' P4=' + p4s +
            ' | W: 30/15/25/30');
          result.score = newTotal;
          result.grade = newTotal >= 75 ? 'A' : newTotal >= 60 ? 'B' : newTotal >= 45 ? 'C' : newTotal >= 25 ? 'D' : 'F';
        }

        if (result.metadata) {
          result.metadata.v6Weights = V6_WEIGHTS;
          result.metadata.p3Recalibrated = true;
          result.metadata.p4BsCorrected = (newP4 !== oldP4);
          result.metadata.isGuaranteedRate = _isGuaranteedRateProduct(product);
          result.metadata.version = '6.2';
        }

        return result;
      });
    };

    if (typeof GRADING_CONFIG !== 'undefined') {
      GRADING_CONFIG.weightsProposal = {
        adjustedReturn: V6_WEIGHTS.p1,
        underlyingQuality: V6_WEIGHTS.p2,
        portfolioFit: V6_WEIGHTS.p3,
        riskPremium: V6_WEIGHTS.p4
      };
    }

    console.log('[v6-cal v1.3] Active: P3 base 50, W 30/20/15/30, Phoenix +5, SS -5, P4 BS (exempt guaranteed rates)');
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

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader v6 Calibration Patch
//
// Loaded AFTER grader-p1-expected-return-patch.js (outermost)
// 1. Recalibrate P3 from base 70→50 with discriminating adjustments
// 2. Apply v6 weights: P1=30%, P2=15%, P3=25%, P4=30%
// 3. Phoenix memory bonus +5pts on P1
// 4. Single-stock penalty -5pts on P1
// 5. Cap IA delta to ±20pts (was ±15)
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var V6_WEIGHTS = { p1: 0.30, p2: 0.15, p3: 0.25, p4: 0.30 };

  // ─── Recalibrate P3: base 50 with structure-based adjustments ───
  function _recalibrateP3(oldP3, product) {
    // Start from 50 instead of 70
    var base = 50;
    var st = (product.structureType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    var unds = product.underlyings || [];
    var n = unds.length;
    var isCapGaranti = product.capitalProtection &&
      ((product.capitalProtection.protected === true) || st === 'capital_garanti');

    // Structure-based adjustments
    if (st === 'dispersion' || ut === 'pairs') {
      base += 15; // Non-directional, inherent diversification
    } else if (st === 'capital_garanti' || isCapGaranti) {
      base += 10; // Capital protection = portfolio stabilizer
    } else if (ut === 'basket') {
      base += 12; // Diversified basket
    } else if (ut === 'single-index') {
      base += 8;  // Broad index = decent diversification
    } else if (ut === 'worst-of' || ut === 'worst_of') {
      if (n <= 2) base += 0;      // WO 2 = neutral
      else if (n <= 3) base -= 5;  // WO 3 = mild concentration
      else base -= 10;             // WO 4+ = high concentration
    } else if (ut === 'single-stock') {
      base -= 10; // Single stock = high concentration
    } else if (ut === 'none' || st === 'taux_fixe') {
      base += 5;  // No equity risk = diversifier
    }

    // Maturity adjustment
    var my = parseFloat(product.maturityYears) || 5;
    if (my <= 2) base += 5;       // Short = liquid
    else if (my > 7) base -= 5;   // Long = illiquid

    // Transfer old portfolio overlap penalties (from v5 P3)
    // The old P3 had overlap penalties baked in, preserve them
    var overlapDelta = oldP3 - 70; // v5 base was 70
    if (overlapDelta < 0) {
      // Overlap penalties: keep them but scale to new base
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

    // Phoenix memory bonus: +5pts (BS only gives +8% prob, this adds value
    // for the coupon catch-up mechanism over multiple periods)
    if (hasMemory) adj += 5;

    // Single-stock penalty: -5pts (idiosyncratic risk, fat tails)
    if (ut === 'single-stock') adj -= 5;

    // Single-stock with barrier < 65%: additional -3pts
    var cp = product.capitalProtection || {};
    var barrier = parseFloat(cp.barrier) || 0;
    if (ut === 'single-stock' && barrier > 0 && barrier < 65) adj -= 3;

    return Math.max(5, Math.min(95, oldP1 + adj));
  }

  // ─── Cap IA deltas to ±20 (was ±15 in v5) ───
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
            'Fit: base 50 → ' + newP3 +
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
            ((product.coupon && product.coupon.memory) ? 'mémoire+5' : '') +
            ((product.underlyingType || '').toLowerCase() === 'single-stock' ? ' SS-5' : '') +
            ')';
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
          console.log('[v6-cal] Total: ' + result.score + ' → ' + newTotal +
            ' | P1=' + p1s + ' P2=' + p2s + ' P3=' + p3s + ' P4=' + p4s +
            ' | W: 30/15/25/30');
          result.score = newTotal;
          if (newTotal >= 75) result.grade = 'A';
          else if (newTotal >= 60) result.grade = 'B';
          else if (newTotal >= 45) result.grade = 'C';
          else if (newTotal >= 25) result.grade = 'D';
          else result.grade = 'F';
        }

        // Update metadata
        if (result.metadata) {
          result.metadata.v6Weights = V6_WEIGHTS;
          result.metadata.p3Recalibrated = true;
          result.metadata.version = '6.0';
        }

        return result;
      });
    };

    // Also update the config for UI display
    if (typeof GRADING_CONFIG !== 'undefined') {
      GRADING_CONFIG.weightsProposal = {
        adjustedReturn: V6_WEIGHTS.p1,
        underlyingQuality: V6_WEIGHTS.p2,
        portfolioFit: V6_WEIGHTS.p3,
        riskPremium: V6_WEIGHTS.p4
      };
    }

    console.log('[v6-cal] Calibration active: P3 base 50, weights 30/15/25/30, Phoenix +5, SS -5');
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

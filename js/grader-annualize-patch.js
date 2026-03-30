// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Annualize Patch v1.0
// Fix: 4.5% semestriel = 9% annuel dans le grading P1/P4
// Runs AFTER all grader patches (post-grade adjustment)
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var FREQ_MULT = {
    'trimestriel': 4, 'trimestrielle': 4, 'quarterly': 4,
    'semestriel': 2, 'semestrielle': 2, 'semi-annual': 2, 'semi-annuel': 2,
    'mensuel': 12, 'mensuelle': 12, 'monthly': 12,
    'annuel': 1, 'annuelle': 1, 'annual': 1,
    'à maturité': 1, 'maturity': 1
  };

  // ─── Global helper: get annualized rate from any product ───
  window.getAnnualizedRate = function(product) {
    if (!product) return 0;
    var coupon = product.coupon;
    var rate = 0;

    if (typeof coupon === 'number') {
      rate = coupon;
    } else if (typeof coupon === 'object' && coupon !== null) {
      rate = parseFloat(coupon.rate || coupon.taux || 0) || 0;

      // If already annualized by freq-fix, return directly
      if (coupon.annualized === true) return rate;

      // Get frequency
      var freq = (coupon.frequency || coupon.frequence || '').toLowerCase().trim();
      var mult = FREQ_MULT[freq] || 1;

      if (mult > 1 && rate > 0 && rate * mult <= 25) {
        return Math.round(rate * mult * 1000) / 1000;
      }
    }

    // Fallback: check aiParsed
    if (rate > 0 && product.aiParsed && product.aiParsed.coupon) {
      var aiFreq = (product.aiParsed.coupon.frequency || '').toLowerCase().trim();
      var aiMult = FREQ_MULT[aiFreq] || 1;
      if (aiMult > 1 && rate * aiMult <= 25) {
        return Math.round(rate * aiMult * 1000) / 1000;
      }
    }

    return rate;
  };

  // ─── Get frequency multiplier ───
  window.getFrequencyMultiplier = function(product) {
    if (!product) return 1;
    var coupon = (typeof product.coupon === 'object') ? product.coupon : {};
    var freq = (coupon.frequency || coupon.frequence || '').toLowerCase().trim();
    return FREQ_MULT[freq] || 1;
  };

  // ─── Post-grade P1 adjustment ───
  // The freq-fix v7.1 tries to pre-annualize but sometimes fails due to wrapping chain.
  // This patch runs AFTER grading and fixes P1 if the coupon was infra-annual.
  function _patchGradeForAnnualization() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) {
      return false;
    }

    var _prevGrade = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      var resultPromise = _prevGrade.call(this, product);

      function _adjustResult(result) {
        if (!result || !result.pillars || !product) return result;

        // Check if coupon is infra-annual and P1 used the per-period rate
        var coupon = product.coupon || {};
        var rawRate = parseFloat(coupon.rate || coupon.taux || 0) || 0;
        var annualRate = window.getAnnualizedRate(product);
        var mult = window.getFrequencyMultiplier(product);

        if (mult <= 1 || rawRate <= 0 || annualRate <= rawRate) return result;

        // The grader used rawRate but should have used annualRate
        var p1 = result.pillars.adjustedReturn;
        if (!p1) return result;

        // Check if P1 reasoning mentions the per-period rate (not annualized)
        var reasoning = p1.reasoning || '';
        var usedPerPeriod = reasoning.indexOf('Coupon ' + rawRate + '%') >= 0 ||
                           reasoning.indexOf(rawRate + '%') >= 0;

        if (usedPerPeriod || !coupon.annualized) {
          // Calculate P1 boost from annualization
          // The coupon appears X times lower than it should
          // Boost proportional to the missed return
          var missedReturn = annualRate - rawRate;
          var boost = Math.min(Math.round(missedReturn * 3), 20); // ~3pts per % missed, cap 20

          if (boost > 0) {
            var oldScore = p1.score;
            p1.score = Math.min(p1.score + boost, 85);

            // Fix reasoning
            var freqLabel = (coupon.frequency || '?');
            p1.reasoning = (p1.reasoning || '').replace(
              'Coupon ' + rawRate + '%',
              'Coupon ' + rawRate + '% × ' + mult + ' (' + freqLabel + ') = ' + annualRate + '%/an'
            );

            // Also add note if not already present
            if (p1.reasoning.indexOf('annualis') < 0 && p1.reasoning.indexOf('× ' + mult) < 0) {
              p1.reasoning += ' | ⚠ Coupon annualisé: ' + rawRate + '% × ' + mult + ' = ' + annualRate + '%/an';
            }

            console.log('[annualize-patch] P1 boost: ' + oldScore + ' → ' + p1.score +
              ' (coupon ' + rawRate + '% ' + freqLabel + ' = ' + annualRate + '%/an, +' + boost + 'pts)');
          }
        }

        // Also fix P4 (Prime vs CAT) — annualized spread matters
        var p4 = result.pillars.riskPremium;
        if (p4 && mult > 1) {
          var p4reasoning = p4.reasoning || '';
          if (p4reasoning.indexOf(rawRate + '%') >= 0 && p4reasoning.indexOf(annualRate + '%') < 0) {
            // P4 used per-period rate for spread calculation
            var spreadBoost = Math.min(Math.round(missedReturn * 2), 12);
            if (spreadBoost > 0) {
              var oldP4 = p4.score;
              p4.score = Math.min(p4.score + spreadBoost, 80);
              p4.reasoning = p4reasoning.replace(
                rawRate + '% vs CAT',
                annualRate + '% (' + rawRate + '% × ' + mult + ') vs CAT'
              ).replace(
                'spread ' + rawRate,
                'spread ' + annualRate
              );
              console.log('[annualize-patch] P4 boost: ' + oldP4 + ' → ' + p4.score + ' (+' + spreadBoost + 'pts)');
            }
          }
        }

        // Recalculate total score
        if (result.pillars.adjustedReturn && result.pillars.underlyingQuality &&
            result.pillars.portfolioFit && result.pillars.riskPremium) {
          var newTotal = Math.round(
            result.pillars.adjustedReturn.score * 0.30 +
            result.pillars.underlyingQuality.score * 0.25 +
            result.pillars.portfolioFit.score * 0.20 +
            result.pillars.riskPremium.score * 0.25
          );
          if (newTotal !== result.score) {
            console.log('[annualize-patch] Total: ' + result.score + ' → ' + newTotal);
            result.score = newTotal;
            // Update grade letter
            if (newTotal >= 75) result.grade = 'A';
            else if (newTotal >= 60) result.grade = 'B';
            else if (newTotal >= 45) result.grade = 'C';
            else if (newTotal >= 25) result.grade = 'D';
            else result.grade = 'F';
          }
        }

        // Store annualized info in metadata
        if (result.metadata) {
          result.metadata.couponAnnualized = annualRate;
          result.metadata.couponPerPeriod = rawRate;
          result.metadata.couponFrequency = coupon.frequency;
          result.metadata.couponMultiplier = mult;
        }

        return result;
      }

      if (resultPromise && typeof resultPromise.then === 'function') {
        return resultPromise.then(_adjustResult);
      }
      return _adjustResult(resultPromise);
    };

    console.log('[annualize-patch v1.0] Post-grade P1/P4 annualization fix active');
    return true;
  }

  // Retry patching until ProposalGrader is available
  if (!_patchGradeForAnnualization()) {
    var attempts = 0;
    var iv = setInterval(function() {
      attempts++;
      if (_patchGradeForAnnualization() || attempts > 60) clearInterval(iv);
    }, 100);
  }
})();

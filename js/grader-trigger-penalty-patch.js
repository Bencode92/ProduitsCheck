// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Trigger Penalty Patch v1.0
//
// Problème: P1 ne pénalise pas les triggers coupon élevés (≥95%)
// Un coupon à trigger 100% worst-of a une probabilité très faible
// de versement, mais le grader le traite comme un coupon normal.
//
// Fix: Pénaliser P1 proportionnellement au trigger et au type de SJ
// - trigger 100% worst-of: forte pénalité (-15 à -20pts)
// - trigger 100% single: pénalité modérée (-8 à -12pts)
// - trigger 95%: légère pénalité (-3 à -5pts)
// - trigger ≤80%: pas de pénalité (facile à atteindre)
//
// Aussi: Pénalité P1 pour maturité longue (≥10 ans) sans capital garanti
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  function _patchGrade() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

    var _prevGrade = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      var resultPromise = _prevGrade.call(this, product);

      function _applyTriggerPenalty(result) {
        if (!result || !result.pillars || !product) return result;

        var p1 = result.pillars.adjustedReturn;
        if (!p1) return result;

        var cp = product.capitalProtection || {};
        var coupon = (typeof product.coupon === 'object') ? product.coupon : {};
        var er = product.earlyRedemption || {};
        var undType = (product.underlyingType || '').toLowerCase();
        var matYears = product.maturityYears || 5;

        // Get the effective coupon trigger (barrierCoupon or coupon.trigger)
        var triggerCoupon = cp.barrierCoupon || coupon.trigger || 0;
        var triggerAutocall = er.trigger || 0;
        var effectiveTrigger = Math.max(triggerCoupon, triggerAutocall);

        var totalPenalty = 0;
        var reasons = [];

        // ─── Rule 1: High trigger coupon penalty ───
        if (triggerCoupon >= 95) {
          // Base penalty by trigger level
          var triggerPenalty = 0;
          if (triggerCoupon >= 100) triggerPenalty = 10;
          else if (triggerCoupon >= 95) triggerPenalty = 4;

          // Worst-of multiplier: all SJ must be above trigger = much harder
          if (undType === 'worst-of') {
            triggerPenalty = Math.round(triggerPenalty * 1.8);
            reasons.push('Trigger coupon ' + triggerCoupon + '% worst-of = prob coupon tr\u00e8s faible (-' + triggerPenalty + 'pts)');
          } else {
            reasons.push('Trigger coupon ' + triggerCoupon + '% = prob coupon r\u00e9duite (-' + triggerPenalty + 'pts)');
          }

          totalPenalty += triggerPenalty;
        }

        // ─── Rule 2: Long maturity penalty (>8 ans) ───
        // Plus la maturité est longue, plus l'incertitude est grande
        // Capital garanti atténue la pénalité
        if (matYears >= 8) {
          var matPenalty = Math.round((matYears - 7) * 2); // 2pts par année au-delà de 7
          if (cp.protected) matPenalty = Math.round(matPenalty * 0.5); // cap garanti = moitié
          matPenalty = Math.min(matPenalty, 10); // cap 10pts

          if (matPenalty > 0) {
            totalPenalty += matPenalty;
            reasons.push('Maturit\u00e9 ' + matYears + 'a = incertitude accrue (-' + matPenalty + 'pts)');
          }
        }

        // ─── Rule 3: Capital garanti + high trigger = rendement probable nul ───
        // Si capital garanti mais trigger coupon >= 100%, le rendement sera probablement 0%
        if (cp.protected && triggerCoupon >= 100) {
          var nullReturnPenalty = 5;
          totalPenalty += nullReturnPenalty;
          reasons.push('Cap garanti + trigger ' + triggerCoupon + '% = rendement probable 0% (-' + nullReturnPenalty + 'pts)');
        }

        // Apply penalty
        if (totalPenalty > 0) {
          var oldP1 = p1.score;
          p1.score = Math.max(p1.score - totalPenalty, 10);
          p1.reasoning = (p1.reasoning || '') + ' | \u26a0 ' + reasons.join('. ');
          console.log('[trigger-penalty] P1: ' + oldP1 + ' \u2192 ' + p1.score + ' (-' + totalPenalty + ')');
        }

        // ─── Recalculate total ───
        if (totalPenalty > 0) {
          var p1s = result.pillars.adjustedReturn?.score || 0;
          var p2s = result.pillars.underlyingQuality?.score || 0;
          var p3s = result.pillars.portfolioFit?.score || 0;
          var p4s = result.pillars.riskPremium?.score || 0;
          var newTotal = Math.round(p1s * 0.30 + p2s * 0.25 + p3s * 0.20 + p4s * 0.25);

          if (newTotal !== result.score) {
            console.log('[trigger-penalty] Total: ' + result.score + ' \u2192 ' + newTotal);
            result.score = newTotal;
            if (newTotal >= 75) result.grade = 'A';
            else if (newTotal >= 60) result.grade = 'B';
            else if (newTotal >= 45) result.grade = 'C';
            else if (newTotal >= 25) result.grade = 'D';
            else result.grade = 'F';
          }
        }

        return result;
      }

      if (resultPromise && typeof resultPromise.then === 'function') {
        return resultPromise.then(_applyTriggerPenalty);
      }
      return _applyTriggerPenalty(resultPromise);
    };

    console.log('[trigger-penalty v1.0] P1 high-trigger + long-maturity penalty active');
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

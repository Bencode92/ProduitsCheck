// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Dispersion Boost Patch v1.0
//
// Problème: P4 (Prime vs CAT) ne valorise pas les dispersions.
// Pour une dispersion, la volatilité est le MOTEUR du rendement.
// Plus les actions divergent, plus le rendement est élevé.
// Le P4 compare le coupon nominal (faible) au CAT, mais ignore
// que le rendement historique médian est souvent ~11-13%.
//
// Fix: Boost P4 pour les dispersions avec capital garanti
// + Boost P1 car rendement quasi-certain via mécanique de dispersion
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  function _isDispersion(product) {
    if (!product) return false;
    var st = (product.structureType || '').toLowerCase();
    var ut = (product.underlyingType || '').toLowerCase();
    return st === 'dispersion' || ut === 'pairs';
  }

  function _patchGrade() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

    var _prevGrade = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      var resultPromise = _prevGrade.call(this, product);

      function _applyDispersionBoost(result) {
        if (!result || !result.pillars || !product) return result;
        if (!_isDispersion(product)) return result;

        var cp = product.capitalProtection || {};
        var isCapGaranti = cp.protected && cp.level >= 100;

        console.log('[dispersion-boost] Dispersion d\u00e9tect\u00e9e, capital garanti=' + isCapGaranti);

        // ─── P4 Boost: Vol = moteur de rendement ───
        // Pour une dispersion, la volatilité est POSITIVE (contrairement aux autocalls)
        // Le spread réel est bien meilleur que le coupon nominal
        var p4 = result.pillars.riskPremium;
        if (p4) {
          var p4Boost = 15; // Base: +15pts pour dispersion
          if (isCapGaranti) p4Boost += 10; // +10 si capital garanti en plus

          var oldP4 = p4.score;
          p4.score = Math.min(p4.score + p4Boost, 90);
          p4.reasoning = (p4.reasoning || '') +
            ' | \u2705 Dispersion: vol = moteur de rendement (+' + p4Boost + 'pts)' +
            (isCapGaranti ? ' + capital garanti' : '');
          console.log('[dispersion-boost] P4: ' + oldP4 + ' \u2192 ' + p4.score + ' (+' + p4Boost + ')');
        }

        // ─── P1 Boost: Rendement quasi-certain via mécanique ───
        // La dispersion est positive par construction (|perf1 - perf2| ≥ 0)
        // Le rendement historique médian est généralement 10-13% sur 3 ans
        var p1 = result.pillars.adjustedReturn;
        if (p1 && isCapGaranti) {
          var p1Boost = 10; // +10pts: rendement mécaniquement positif + cap garanti
          var oldP1 = p1.score;
          p1.score = Math.min(p1.score + p1Boost, 85);
          p1.reasoning = (p1.reasoning || '') +
            ' | \u2705 Dispersion cap garanti: rendement quasi-certain (+' + p1Boost + 'pts)';
          console.log('[dispersion-boost] P1: ' + oldP1 + ' \u2192 ' + p1.score + ' (+' + p1Boost + ')');
        }

        // ─── Recalculate total ───
        var p1s = result.pillars.adjustedReturn?.score || 0;
        var p2s = result.pillars.underlyingQuality?.score || 0;
        var p3s = result.pillars.portfolioFit?.score || 0;
        var p4s = result.pillars.riskPremium?.score || 0;
        var newTotal = Math.round(p1s * 0.30 + p2s * 0.25 + p3s * 0.20 + p4s * 0.25);

        if (newTotal !== result.score) {
          console.log('[dispersion-boost] Total: ' + result.score + ' \u2192 ' + newTotal);
          result.score = newTotal;
          if (newTotal >= 75) result.grade = 'A';
          else if (newTotal >= 60) result.grade = 'B';
          else if (newTotal >= 45) result.grade = 'C';
          else if (newTotal >= 25) result.grade = 'D';
          else result.grade = 'F';
        }

        return result;
      }

      if (resultPromise && typeof resultPromise.then === 'function') {
        return resultPromise.then(_applyDispersionBoost);
      }
      return _applyDispersionBoost(resultPromise);
    };

    console.log('[dispersion-boost v1.0] P1/P4 dispersion boost active');
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

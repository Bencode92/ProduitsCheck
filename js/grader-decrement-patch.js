// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Decrement Patch v1.0
// Pénalise P1 et P4 quand un décrément existe
//
// Logique :
//   drag = decrementPct - actualDividendYield
//   Le drag érode le rendement réel et le spread vs CAT
//   Ex: Gold Miners 5% décrément, 0.97% div réel = 4.03% drag
//   Spread réel = 9% coupon - 4.03% drag - 2.5% CAT = 2.47%
//   (pas 9% - 2.5% = 6.5% comme le grader calcule actuellement)
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  function _getDrag(product) {
    if (!product) return null;
    var dec = parseFloat(product.decrementPct) || 0;
    if (dec <= 0) return null;

    // Check aiParsed too
    if (!dec && product.aiParsed) {
      dec = parseFloat(product.aiParsed.decrementPct) || 0;
    }
    if (dec <= 0) return null;

    var div = parseFloat(product.actualDividendYield) || 0;
    if (!div && product.aiParsed) {
      div = parseFloat(product.aiParsed.actualDividendYield) || 0;
    }

    var drag = dec - div;
    if (drag <= 0) return null; // Div covers decrement, no drag

    return {
      decrementPct: dec,
      dividendYield: div,
      drag: Math.round(drag * 100) / 100
    };
  }

  function _patchGrade() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

    var _prevGrade = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      var resultPromise = _prevGrade.call(this, product);

      function _applyDecrementPenalty(result) {
        if (!result || !result.pillars) return result;

        var dragInfo = _getDrag(product);
        if (!dragInfo) return result;

        var drag = dragInfo.drag;
        console.log('[decrement-patch] Décrément détecté: ' + dragInfo.decrementPct +
          '% - div ' + dragInfo.dividendYield + '% = drag ' + drag + '%/an');

        // ─── P1: Rendement ajusté ───
        // Le drag érode le rendement effectif
        // Pénalité: ~4pts par % de drag, cap 25
        var p1 = result.pillars.adjustedReturn;
        if (p1) {
          var p1Penalty = Math.min(Math.round(drag * 4), 25);
          var oldP1 = p1.score;
          p1.score = Math.max(p1.score - p1Penalty, 5);

          // Add drag info to reasoning
          p1.reasoning = (p1.reasoning || '') +
            ' | \u26a0 D\u00e9cr\u00e9ment ' + dragInfo.decrementPct + '% vs div r\u00e9el ' +
            dragInfo.dividendYield + '% = drag ' + drag + '%/an (-' + p1Penalty + 'pts)';

          console.log('[decrement-patch] P1: ' + oldP1 + ' \u2192 ' + p1.score + ' (-' + p1Penalty + ')');
        }

        // ─── P4: Prime vs CAT ───
        // Le spread réel = coupon annualisé - drag - CAT
        // Pas coupon annualisé - CAT
        // Pénalité: ~5pts par % de drag, cap 30
        var p4 = result.pillars.riskPremium;
        if (p4) {
          var p4Penalty = Math.min(Math.round(drag * 5), 30);
          var oldP4 = p4.score;
          p4.score = Math.max(p4.score - p4Penalty, 5);

          // Get annualized rate for display
          var annRate = (typeof window.getAnnualizedRate === 'function')
            ? window.getAnnualizedRate(product)
            : (parseFloat(product.coupon?.rate) || 0);
          var realSpread = Math.round((annRate - drag - 2.5) * 100) / 100;

          p4.reasoning = (p4.reasoning || '') +
            ' | \u26a0 Spread r\u00e9el apr\u00e8s drag: ' + annRate + '% - ' + drag +
            '% drag - 2.5% CAT = ' + realSpread + '% (-' + p4Penalty + 'pts)';

          console.log('[decrement-patch] P4: ' + oldP4 + ' \u2192 ' + p4.score + ' (-' + p4Penalty + ')');
        }

        // ─── Recalculate total ───
        var p1s = result.pillars.adjustedReturn?.score || 0;
        var p2s = result.pillars.underlyingQuality?.score || 0;
        var p3s = result.pillars.portfolioFit?.score || 0;
        var p4s = result.pillars.riskPremium?.score || 0;

        var newTotal = Math.round(p1s * 0.30 + p2s * 0.25 + p3s * 0.20 + p4s * 0.25);

        if (newTotal !== result.score) {
          console.log('[decrement-patch] Total: ' + result.score + ' \u2192 ' + newTotal);
          result.score = newTotal;

          // Update grade letter
          if (newTotal >= 75) result.grade = 'A';
          else if (newTotal >= 60) result.grade = 'B';
          else if (newTotal >= 45) result.grade = 'C';
          else if (newTotal >= 25) result.grade = 'D';
          else result.grade = 'F';
        }

        // Store in metadata
        if (result.metadata) {
          result.metadata.decrementPct = dragInfo.decrementPct;
          result.metadata.dividendYield = dragInfo.dividendYield;
          result.metadata.decrementDrag = drag;
        }

        // Add to verdict
        if (result.verdict) {
          result.verdict += ' D\u00e9cr\u00e9ment de ' + dragInfo.decrementPct +
            '% avec div r\u00e9el de seulement ' + dragInfo.dividendYield +
            '% cr\u00e9e un drag invisible de ' + drag + '%/an sur la performance.';
        }

        return result;
      }

      if (resultPromise && typeof resultPromise.then === 'function') {
        return resultPromise.then(_applyDecrementPenalty);
      }
      return _applyDecrementPenalty(resultPromise);
    };

    console.log('[decrement-patch v1.0] Post-grade d\u00e9cr\u00e9ment penalty active');
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

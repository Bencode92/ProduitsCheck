// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — v6 Weights Enforcement (TRUE outermost)
//
// BUG: sprint2 delays its grade wrapping via setInterval (waiting for
// buildStructuredOptimization), so it patches AFTER v6-cal and becomes
// the actual outermost. Its _applyIlliquidityPenalty recalculates the
// total with v5 weights (30/25/20/25), overwriting v6-cal's total.
//
// FIX: This tiny patch wraps AFTER sprint2 has patched (detects
// _sprint2Patched flag) and recalculates the total with v6 weights.
// This is the LAST word on the total score.
//
// Loaded AFTER grader-v6-calibration-patch.js in index.html.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var V6 = { p1: 0.30, p2: 0.20, p3: 0.15, p4: 0.30 };

  function _patch() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;
    // Wait for sprint2 to have patched (it sets this flag)
    if (!ProposalGrader.grade._sprint2Patched) return false;

    var _prev = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      return _prev.call(ProposalGrader, product).then(function(result) {
        if (!result || !result.pillars || result.grade === '-') return result;

        var p1 = result.pillars.adjustedReturn ? result.pillars.adjustedReturn.score : 0;
        var p2 = result.pillars.underlyingQuality ? result.pillars.underlyingQuality.score : 0;
        var p3 = result.pillars.portfolioFit ? result.pillars.portfolioFit.score : 0;
        var p4 = result.pillars.riskPremium ? result.pillars.riskPremium.score : 0;

        var correct = Math.round(p1 * V6.p1 + p2 * V6.p2 + p3 * V6.p3 + p4 * V6.p4);

        if (correct !== result.score) {
          console.log('[v6-enforce] ' + result.score + ' \u2192 ' + correct +
            ' | P1=' + p1 + ' P2=' + p2 + ' P3=' + p3 + ' P4=' + p4 +
            ' | W: 30/20/15/30');
          result.score = correct;
          result.grade = correct >= 75 ? 'A' : correct >= 60 ? 'B' : correct >= 45 ? 'C' : correct >= 25 ? 'D' : 'F';
        }

        return result;
      });
    };

    // Carry over the flag so future wraps know sprint2 already ran
    ProposalGrader.grade._sprint2Patched = true;

    console.log('[v6-enforce] v6 weights enforcement active (true outermost)');
    return true;
  }

  // Sprint2 patches via setInterval at 200ms. We run at 300ms to ensure
  // we always wrap AFTER sprint2.
  var att = 0;
  var iv = setInterval(function() {
    att++;
    if (_patch()) { clearInterval(iv); }
    else if (att > 200) {
      // Sprint2 never patched. Just enforce v6 weights directly.
      if (typeof ProposalGrader !== 'undefined' && ProposalGrader.grade) {
        var _prev = ProposalGrader.grade;
        ProposalGrader.grade = function(product) {
          return _prev.call(ProposalGrader, product).then(function(result) {
            if (!result || !result.pillars || result.grade === '-') return result;
            var p1 = result.pillars.adjustedReturn ? result.pillars.adjustedReturn.score : 0;
            var p2 = result.pillars.underlyingQuality ? result.pillars.underlyingQuality.score : 0;
            var p3 = result.pillars.portfolioFit ? result.pillars.portfolioFit.score : 0;
            var p4 = result.pillars.riskPremium ? result.pillars.riskPremium.score : 0;
            var correct = Math.round(p1 * V6.p1 + p2 * V6.p2 + p3 * V6.p3 + p4 * V6.p4);
            if (correct !== result.score) {
              console.log('[v6-enforce] ' + result.score + ' \u2192 ' + correct + ' (no sprint2)');
              result.score = correct;
              result.grade = correct >= 75 ? 'A' : correct >= 60 ? 'B' : correct >= 45 ? 'C' : correct >= 25 ? 'D' : 'F';
            }
            return result;
          });
        };
        console.log('[v6-enforce] v6 weights enforcement active (no sprint2)');
      }
      clearInterval(iv);
    }
  }, 300);
})();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Annualize Patch v2.0
// FORCE annualize coupon BEFORE grading, no flags, no guards
// 4.5% semestriel → grade with 9%, then restore original after
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

  // ─── Global helpers ───
  window.getAnnualizedRate = function(product) {
    if (!product) return 0;
    var coupon = product.coupon;
    var rate = 0;
    var freq = 'annuel';

    if (typeof coupon === 'number') {
      rate = coupon;
    } else if (typeof coupon === 'object' && coupon !== null) {
      rate = parseFloat(coupon.rate || 0) || 0;
      freq = (coupon.frequency || coupon.frequence || 'annuel').toLowerCase().trim();
    }

    // Also check aiParsed for frequency
    if (product.aiParsed && product.aiParsed.coupon) {
      var aiFreq = (product.aiParsed.coupon.frequency || '').toLowerCase().trim();
      if (aiFreq && FREQ_MULT[aiFreq] && FREQ_MULT[aiFreq] > 1) freq = aiFreq;
    }

    var mult = FREQ_MULT[freq] || 1;
    if (mult > 1 && rate > 0 && rate * mult <= 25) {
      return Math.round(rate * mult * 1000) / 1000;
    }
    return rate;
  };

  window.getFrequencyMultiplier = function(product) {
    if (!product) return 1;
    var coupon = (typeof product.coupon === 'object') ? product.coupon : {};
    var freq = (coupon.frequency || coupon.frequence || '').toLowerCase().trim();
    if (!freq && product.aiParsed && product.aiParsed.coupon) {
      freq = (product.aiParsed.coupon.frequency || '').toLowerCase().trim();
    }
    return FREQ_MULT[freq] || 1;
  };

  // ─── Detect infra-annual frequency ───
  function _getFreqInfo(product) {
    if (!product) return null;
    var coupon = (typeof product.coupon === 'object') ? product.coupon : {};
    var rate = parseFloat(coupon.rate || 0) || 0;
    if (rate <= 0) return null;

    // Check frequency from multiple sources
    var freq = (coupon.frequency || '').toLowerCase().trim();
    
    // Fallback to aiParsed
    if ((!freq || !FREQ_MULT[freq] || FREQ_MULT[freq] <= 1) && product.aiParsed) {
      var ai = product.aiParsed;
      if (ai.coupon && ai.coupon.frequency) {
        freq = ai.coupon.frequency.toLowerCase().trim();
      }
      if ((!freq || FREQ_MULT[freq] <= 1) && ai.earlyRedemption && ai.earlyRedemption.frequency) {
        freq = ai.earlyRedemption.frequency.toLowerCase().trim();
      }
    }

    // Fallback to product name
    if (!freq || !FREQ_MULT[freq] || FREQ_MULT[freq] <= 1) {
      var name = (product.name || '').toLowerCase();
      if (/semestriel/.test(name)) freq = 'semestriel';
      else if (/trimestriel/.test(name)) freq = 'trimestriel';
    }

    var mult = FREQ_MULT[freq];
    if (!mult || mult <= 1) return null;

    var annual = Math.round(rate * mult * 1000) / 1000;
    if (annual > 25) return null; // Already annual

    return { rate: rate, freq: freq, mult: mult, annual: annual };
  }

  // ─── Main patch: FORCE annualize before grade, restore after ───
  function _patchGrade() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

    var _prevGrade = ProposalGrader.grade;

    ProposalGrader.grade = function(product) {
      var freqInfo = _getFreqInfo(product);

      if (freqInfo) {
        // SAVE original values
        var origRate = product.coupon.rate;
        var origFreq = product.coupon.frequency;
        var origFlag = product._freqFixApplied;
        var origAnn = product.coupon.annualized;

        // FORCE annualize BEFORE grading
        product.coupon.rate = freqInfo.annual;
        product.coupon.frequency = 'annuel';
        product.coupon.annualized = true;
        product.coupon._origRate = freqInfo.rate;
        product.coupon._origFreq = freqInfo.freq;
        product.coupon._mult = freqInfo.mult;
        product._freqFixApplied = true;

        console.log('[annualize-v2] PRE-GRADE: ' + freqInfo.rate + '% ' + freqInfo.freq + ' → ' + freqInfo.annual + '%/an');

        var resultPromise = _prevGrade.call(this, product);

        function _postProcess(result) {
          // RESTORE original values so the form still shows per-period
          product.coupon.rate = origRate;
          product.coupon.frequency = origFreq;
          product.coupon.annualized = origAnn;
          product._freqFixApplied = origFlag;

          // Enrich result metadata
          if (result && result.metadata) {
            result.metadata.couponPerPeriod = freqInfo.rate;
            result.metadata.couponAnnualized = freqInfo.annual;
            result.metadata.couponFrequency = freqInfo.freq;
            result.metadata.couponMultiplier = freqInfo.mult;
          }

          // Fix reasoning to show the calculation
          if (result && result.pillars) {
            var p1 = result.pillars.adjustedReturn;
            if (p1 && p1.reasoning) {
              // Replace any mention of the annual rate without context
              if (p1.reasoning.indexOf('Coupon ' + freqInfo.annual + '%') >= 0 && 
                  p1.reasoning.indexOf('×') < 0) {
                p1.reasoning = p1.reasoning.replace(
                  'Coupon ' + freqInfo.annual + '%',
                  'Coupon ' + freqInfo.rate + '% × ' + freqInfo.mult + ' (' + freqInfo.freq + ') = ' + freqInfo.annual + '%/an'
                );
              }
            }
            var p4 = result.pillars.riskPremium;
            if (p4 && p4.reasoning) {
              if (p4.reasoning.indexOf('spread ' + freqInfo.annual) >= 0 &&
                  p4.reasoning.indexOf('×') < 0) {
                p4.reasoning = p4.reasoning.replace(
                  'spread ' + freqInfo.annual,
                  'spread ' + freqInfo.rate + '×' + freqInfo.mult + '=' + freqInfo.annual
                );
              }
            }
          }

          console.log('[annualize-v2] POST-GRADE: restored rate=' + origRate + '% ' + origFreq + 
            ' | grade=' + (result ? result.grade + ' ' + result.score : '?'));

          return result;
        }

        if (resultPromise && typeof resultPromise.then === 'function') {
          return resultPromise.then(_postProcess);
        }
        return _postProcess(resultPromise);
      }

      // No frequency fix needed
      return _prevGrade.call(this, product);
    };

    console.log('[annualize-v2.0] FORCE pre-grade annualization active — wraps outermost grade()');
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

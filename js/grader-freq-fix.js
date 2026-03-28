// ═══════════════════════════════════════════════════════════════════════════════
// grader-freq-fix v5 — Fix coupon annualization for infra-annual frequencies
// 
// ROOT CAUSE: In _graderNormalize(), `var co = p.coupon || ai.coupon || {}`
// short-circuits when p.coupon is a truthy number (e.g. 4.85), losing
// ai.coupon.frequency ("semestriel"). Result: coupon not annualized.
//
// WHY v4 FAILED: v4 wrapped global `gradeProposal` but UI calls
// `ProposalGrader.grade` which holds a direct closure reference.
// The wrapper was never invoked.
//
// FIX: Wrap ProposalGrader.grade to merge ai.coupon.frequency into
// product.coupon BEFORE the pipeline runs.
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var FREQ_MULT = {
        'trimestriel':4,'trimestrielle':4,'quarterly':4,
        'semestriel':2,'semestrielle':2,'semi-annual':2,'semi-annuel':2,
        'mensuel':12,'mensuelle':12,'monthly':12,
        'annuel':1,'annuelle':1,'annual':1
    };

    function _fixCouponFrequency(product) {
        if (!product) return;
        var ai = product.aiParsed || {};
        var aiCoupon = (typeof ai.coupon === 'object' && ai.coupon !== null) ? ai.coupon : null;
        var pCoupon = product.coupon;

        // Only fix when p.coupon is a primitive AND ai.coupon has frequency info
        if ((typeof pCoupon === 'number' || typeof pCoupon === 'string') && aiCoupon) {
            var rate = parseFloat(pCoupon) || 0;
            var freq = (aiCoupon.frequency || aiCoupon.frequence || '').toLowerCase().trim();

            // If ai.coupon doesn't have frequency, try earlyRedemption
            if (!freq || !FREQ_MULT[freq]) {
                var ar = product.earlyRedemption || ai.earlyRedemption || {};
                freq = (ar.frequency || ar.frequence || '').toLowerCase().trim();
            }

            // If still no frequency, try product name
            if (!freq || !FREQ_MULT[freq]) {
                var nm = (product.name || ai.name || '').toLowerCase();
                if (/semestriel/i.test(nm)) freq = 'semestriel';
                else if (/trimestriel/i.test(nm)) freq = 'trimestriel';
                else if (/mensuel/i.test(nm)) freq = 'mensuel';
            }

            // Only convert if we found a non-annual frequency
            if (freq && FREQ_MULT[freq] && FREQ_MULT[freq] > 1) {
                product.coupon = {
                    rate: rate,
                    frequency: freq,
                    type: aiCoupon.type || '',
                    memory: !!(aiCoupon.memory || aiCoupon.memoire),
                    paymentTiming: aiCoupon.paymentTiming || ''
                };
                // Preserve annualized/annualise flags
                if (aiCoupon.annualized) product.coupon.annualized = aiCoupon.annualized;
                if (aiCoupon.annualise) product.coupon.annualise = aiCoupon.annualise;

                var mult = FREQ_MULT[freq];
                var annual = Math.round(rate * mult * 1000) / 1000;
                console.log('[freq-fix v5] ' + rate + '% x' + mult + ' (' + freq + ') = ' + annual + '% annuel');
            }
        }
        // Also handle case where p.coupon is already an object but missing frequency
        else if (typeof pCoupon === 'object' && pCoupon !== null && !pCoupon.frequency && !pCoupon.frequence) {
            if (aiCoupon) {
                var f2 = (aiCoupon.frequency || aiCoupon.frequence || '').toLowerCase().trim();
                if (f2 && FREQ_MULT[f2]) {
                    pCoupon.frequency = f2;
                    console.log('[freq-fix v5] Added missing freq to coupon obj: ' + f2);
                }
            }
        }
    }

    // Wait for ProposalGrader to be defined
    function _patch() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) {
            return false;
        }

        // Wrap ProposalGrader.grade (the ACTUAL entry point used by UI)
        var _origGrade = ProposalGrader.grade;
        ProposalGrader.grade = function(product) {
            _fixCouponFrequency(product);
            return _origGrade.call(this, product);
        };

        // Also wrap ProposalGrader.normalize for console testing
        var _origNorm = ProposalGrader.normalize;
        ProposalGrader.normalize = function(product) {
            _fixCouponFrequency(product);
            return _origNorm.call(this, product);
        };

        // Also wrap gradeBatch
        if (ProposalGrader.gradeBatch) {
            var _origBatch = ProposalGrader.gradeBatch;
            ProposalGrader.gradeBatch = function(proposals, onProgress) {
                proposals.forEach(function(p) { _fixCouponFrequency(p); });
                return _origBatch.call(this, proposals, onProgress);
            };
        }

        console.log('[freq-fix v5] Patched ProposalGrader.grade + normalize + gradeBatch');
        return true;
    }

    // Apply immediately if ready, otherwise poll briefly
    if (!_patch()) {
        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            if (_patch() || attempts > 50) clearInterval(iv);
        }, 100);
    }
})();

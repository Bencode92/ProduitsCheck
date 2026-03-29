// ═══════════════════════════════════════════════════════════════════════════════
// grader-freq-fix v6 — Fix coupon annualization for infra-annual frequencies
//
// ROOT CAUSE: In _graderNormalize(), `var co = p.coupon || ai.coupon || {}`
// short-circuits when p.coupon is a truthy number (e.g. 4.85), losing
// ai.coupon.frequency ("semestriel"). Result: coupon not annualized.
//
// WHY v5 FAILED: v5 required aiParsed.coupon to be an object with frequency.
// But when product is saved to JSON, aiParsed.coupon may also be a number.
// So aiCoupon was null → entire fix skipped.
//
// FIX v6: Detect frequency from ALL sources independently:
// 1. aiParsed.coupon.frequency (if object)
// 2. aiParsed.earlyRedemption.frequency
// 3. product.earlyRedemption.frequency
// 4. product name regex (semestriel/trimestriel/mensuel)
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var FREQ_MULT = {
        'trimestriel':4,'trimestrielle':4,'quarterly':4,
        'semestriel':2,'semestrielle':2,'semi-annual':2,'semi-annuel':2,
        'mensuel':12,'mensuelle':12,'monthly':12,
        'annuel':1,'annuelle':1,'annual':1
    };

    // Detect frequency from all available sources
    function _detectFreq(product) {
        var ai = product.aiParsed || {};
        var freq = '';

        // Source 1: aiParsed.coupon.frequency (if coupon is an object)
        if (typeof ai.coupon === 'object' && ai.coupon !== null) {
            freq = (ai.coupon.frequency || ai.coupon.frequence || '').toLowerCase().trim();
            if (freq && FREQ_MULT[freq]) return { freq: freq, src: 'ai.coupon' };
        }

        // Source 2: aiParsed.earlyRedemption.frequency
        var aiAr = ai.earlyRedemption || {};
        freq = (aiAr.frequency || aiAr.frequence || '').toLowerCase().trim();
        if (freq && FREQ_MULT[freq]) return { freq: freq, src: 'ai.earlyRedemption' };

        // Source 3: product.earlyRedemption.frequency
        var pAr = product.earlyRedemption || {};
        freq = (pAr.frequency || pAr.frequence || '').toLowerCase().trim();
        if (freq && FREQ_MULT[freq]) return { freq: freq, src: 'product.earlyRedemption' };

        // Source 4: product name regex
        var nm = (product.name || ai.name || '').toLowerCase();
        if (/semestriel/i.test(nm)) return { freq: 'semestriel', src: 'name' };
        if (/trimestriel/i.test(nm)) return { freq: 'trimestriel', src: 'name' };
        if (/mensuel/i.test(nm)) return { freq: 'mensuel', src: 'name' };

        // Source 5: product rawText or description
        var raw = (product.rawText || product.description || '').toLowerCase();
        if (/semestriel/i.test(raw)) return { freq: 'semestriel', src: 'rawText' };
        if (/trimestriel/i.test(raw)) return { freq: 'trimestriel', src: 'rawText' };
        if (/mensuel/i.test(raw)) return { freq: 'mensuel', src: 'rawText' };

        return null; // No infra-annual frequency found
    }

    function _fixCouponFrequency(product) {
        if (!product) return;
        var pCoupon = product.coupon;
        var ai = product.aiParsed || {};
        var aiCoupon = (typeof ai.coupon === 'object' && ai.coupon !== null) ? ai.coupon : null;

        // Case 1: p.coupon is a primitive number/string — need to convert to object with frequency
        if (typeof pCoupon === 'number' || typeof pCoupon === 'string') {
            var rate = parseFloat(pCoupon) || 0;
            if (rate <= 0) return;

            var detected = _detectFreq(product);
            if (!detected) return; // No infra-annual frequency found, leave as-is

            var freq = detected.freq;
            var mult = FREQ_MULT[freq];
            if (!mult || mult <= 1) return; // Annual or unknown, no change needed

            // Build coupon object
            product.coupon = {
                rate: rate,
                frequency: freq
            };
            // Copy extra fields from aiCoupon if available
            if (aiCoupon) {
                if (aiCoupon.type) product.coupon.type = aiCoupon.type;
                if (aiCoupon.memory || aiCoupon.memoire) product.coupon.memory = true;
                if (aiCoupon.paymentTiming) product.coupon.paymentTiming = aiCoupon.paymentTiming;
                if (aiCoupon.annualized) product.coupon.annualized = aiCoupon.annualized;
                if (aiCoupon.annualise) product.coupon.annualise = aiCoupon.annualise;
            }

            var annual = Math.round(rate * mult * 1000) / 1000;
            console.log('[freq-fix v6] ' + rate + '% x' + mult + ' (' + freq + ' via ' + detected.src + ') = ' + annual + '% annuel');
        }
        // Case 2: p.coupon is already an object but missing frequency
        else if (typeof pCoupon === 'object' && pCoupon !== null && !pCoupon.frequency && !pCoupon.frequence) {
            var detected2 = _detectFreq(product);
            if (detected2 && FREQ_MULT[detected2.freq] > 1) {
                pCoupon.frequency = detected2.freq;
                console.log('[freq-fix v6] Added freq to coupon obj: ' + detected2.freq + ' (via ' + detected2.src + ')');
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

        console.log('[freq-fix v6] Patched ProposalGrader.grade + normalize + gradeBatch');
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

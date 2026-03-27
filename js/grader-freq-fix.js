// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Frequency Fix (hotfix)
// Patches _graderNormalize to inherit coupon frequency from earlyRedemption
// This fixes the annualization bug where 4.85% semestriel stays at 4.85% instead of 9.70%
// ═══════════════════════════════════════════════════════════════

(function() {
    var _originalNormalize = window.ProposalGrader ? null : undefined;

    // Wait for grader to load, then patch
    var _patchInterval = setInterval(function() {
        if (typeof _graderNormalize !== 'function') return;
        if (window._freqFixApplied) return;
        window._freqFixApplied = true;
        clearInterval(_patchInterval);

        var _origNormalize = _graderNormalize;

        // Override _graderNormalize to fix frequency inheritance
        _graderNormalize = function(product) {
            var p = product || {};
            var co = p.coupon || (p.aiParsed && p.aiParsed.coupon) || {};
            var ar = p.earlyRedemption || (p.aiParsed && p.aiParsed.earlyRedemption) || {};

            // Fix 1: Ensure coupon is an object
            if (typeof co === 'number') {
                p.coupon = { rate: co };
                co = p.coupon;
            }

            // Fix 2: Inherit frequency from earlyRedemption if coupon has none
            if (typeof co === 'object' && !co.frequency && !co.frequence) {
                var arFreq = (ar.frequency || ar.frequence || '').toLowerCase().trim();
                if (arFreq && FREQUENCY_MULTIPLIERS && FREQUENCY_MULTIPLIERS[arFreq]) {
                    co.frequency = arFreq;
                    p.coupon = co;
                    console.log('[grader-freq-fix] Coupon freq inherited from earlyRedemption: ' + arFreq);
                }
            }

            // Call original normalize
            return _origNormalize(product);
        };

        // Also patch the export
        if (window.ProposalGrader) {
            window.ProposalGrader.normalize = _graderNormalize;
        }

        console.log('[StructBoard] grader-freq-fix applied — coupon frequency inheritance from earlyRedemption');
    }, 200);
})();

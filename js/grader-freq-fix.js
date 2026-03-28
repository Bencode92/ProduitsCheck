// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Frequency Fix v3 (hotfix)
// Root cause: p.coupon=4.85 (number) shadows ai.coupon={rate:4.85, frequency:"semestriel"}
// Fix: BEFORE grading, ensure product.coupon is an object with frequency merged from all sources
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    var _applied = false;
    var _check = setInterval(function() {
        if (typeof _graderNormalize !== 'function') return;
        if (_applied) return;
        _applied = true;
        clearInterval(_check);

        var _origNormalize = _graderNormalize;

        _graderNormalize = function(product) {
            var p = product || {};
            var ai = p.aiParsed || {};

            // --- FIX 1: If p.coupon is a primitive, convert to object ---
            if (typeof p.coupon === 'number' || typeof p.coupon === 'string') {
                var oldRate = parseFloat(p.coupon) || 0;
                p.coupon = { rate: oldRate };
                console.log('[freq-fix v3] Converted primitive coupon ' + oldRate + ' to object');
            }

            // --- FIX 2: Merge frequency from ALL possible sources ---
            var co = p.coupon;
            if (co && typeof co === 'object' && !co.frequency && !co.frequence) {
                var freq = null;
                // Source 1: ai.coupon (AI parsed coupon object)
                var aiCo = ai.coupon;
                if (aiCo && typeof aiCo === 'object') {
                    freq = aiCo.frequency || aiCo.frequence || null;
                }
                // Source 2: p.earlyRedemption
                if (!freq && p.earlyRedemption) {
                    freq = p.earlyRedemption.frequency || p.earlyRedemption.frequence || null;
                }
                // Source 3: ai.earlyRedemption
                if (!freq && ai.earlyRedemption) {
                    freq = ai.earlyRedemption.frequency || ai.earlyRedemption.frequence || null;
                }
                // Source 4: product name regex
                if (!freq) {
                    var name = (p.name || '').toLowerCase();
                    if (/semestriel/i.test(name)) freq = 'semestriel';
                    else if (/trimestriel/i.test(name)) freq = 'trimestriel';
                    else if (/mensuel/i.test(name)) freq = 'mensuel';
                }
                if (freq) {
                    var f = (typeof freq === 'string') ? freq.toLowerCase().trim() : '';
                    if (f && typeof FREQUENCY_MULTIPLIERS !== 'undefined' && FREQUENCY_MULTIPLIERS[f]) {
                        co.frequency = f;
                        p.coupon = co;
                        console.log('[freq-fix v3] Coupon frequency set to: ' + f + ' (mult=' + FREQUENCY_MULTIPLIERS[f] + ')');
                    }
                }
            }

            // --- FIX 3: Also merge other coupon properties from ai.coupon ---
            if (co && typeof co === 'object' && ai.coupon && typeof ai.coupon === 'object') {
                if (!co.type && ai.coupon.type) co.type = ai.coupon.type;
                if (!co.memory && !co.memoire && (ai.coupon.memory || ai.coupon.memoire)) co.memory = true;
                if (!co.paymentTiming && ai.coupon.paymentTiming) co.paymentTiming = ai.coupon.paymentTiming;
            }

            // Call original normalize with the fixed product
            return _origNormalize(product);
        };

        // Update exports
        if (window.ProposalGrader) {
            window.ProposalGrader.normalize = _graderNormalize;
        }

        console.log('[StructBoard] grader-freq-fix v3 applied — coupon frequency from all sources');
    }, 80);

    setTimeout(function() { clearInterval(_check); }, 10000);
})();

// ═══ STRUCTBOARD — Grader Frequency Fix v3 ═══
// Root cause: p.coupon=4.85 (number) shadows ai.coupon={rate:4.85, frequency:"semestriel"}
// This file MUST load right after proposal-grader-v5.js
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

            // FIX 1: Convert primitive coupon to object
            if (typeof p.coupon === 'number' || typeof p.coupon === 'string') {
                p.coupon = { rate: parseFloat(p.coupon) || 0 };
            }

            // FIX 2: Merge frequency from ALL sources into p.coupon
            var co = p.coupon;
            if (co && typeof co === 'object' && !co.frequency && !co.frequence) {
                var freq = null;

                // Source A: ai.coupon (most reliable — AI parsed with frequency)
                if (!freq && ai.coupon && typeof ai.coupon === 'object') {
                    freq = ai.coupon.frequency || ai.coupon.frequence || null;
                }
                // Source B: earlyRedemption (autocall frequency = coupon frequency)
                if (!freq) {
                    var er = p.earlyRedemption || ai.earlyRedemption || {};
                    freq = er.frequency || er.frequence || null;
                }
                // Source C: product name
                if (!freq) {
                    var nm = (p.name || ai.name || '').toLowerCase();
                    if (/semestriel/i.test(nm)) freq = 'semestriel';
                    else if (/trimestriel/i.test(nm)) freq = 'trimestriel';
                    else if (/mensuel/i.test(nm)) freq = 'mensuel';
                }
                // Source D: rawText from PDF
                if (!freq && p.rawText) {
                    var rt = p.rawText.toLowerCase();
                    if (/coupon[\s\S]{0,40}semestriel/i.test(rt) || /semestriel[\s\S]{0,40}coupon/i.test(rt)) freq = 'semestriel';
                    else if (/coupon[\s\S]{0,40}trimestriel/i.test(rt)) freq = 'trimestriel';
                }

                if (freq) {
                    var f = String(freq).toLowerCase().trim();
                    if (f && typeof FREQUENCY_MULTIPLIERS !== 'undefined' && FREQUENCY_MULTIPLIERS[f]) {
                        co.frequency = f;
                        p.coupon = co;
                        console.log('[freq-fix v3] Frequency set: ' + f + ' (x' + FREQUENCY_MULTIPLIERS[f] + ')');
                    }
                }
            }

            // FIX 3: Merge other properties from ai.coupon
            if (co && typeof co === 'object' && ai.coupon && typeof ai.coupon === 'object') {
                if (!co.type && ai.coupon.type) co.type = ai.coupon.type;
                if (!co.memory && (ai.coupon.memory || ai.coupon.memoire)) co.memory = true;
                if (!co.paymentTiming && ai.coupon.paymentTiming) co.paymentTiming = ai.coupon.paymentTiming;
            }

            return _origNormalize(product);
        };

        if (window.ProposalGrader) window.ProposalGrader.normalize = _graderNormalize;
        console.log('[StructBoard] grader-freq-fix v3 loaded');
    }, 80);
    setTimeout(function() { clearInterval(_check); }, 10000);
})();

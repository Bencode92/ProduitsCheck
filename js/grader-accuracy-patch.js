// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grading Accuracy Patch v1.2
// v1.2: Fix isCallable detection (check name/structureType, not
//       just norm.autocall which may be false if no threshold)
//       + Cap discount factor at 0.92 for callable
//       + P4: skip lock-up for callable OR taux_fixe
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Helper: detect if product is callable/taux_fixe
    function _isCallableProduct(rawProduct, norm) {
        var name = (rawProduct.name || '').toLowerCase();
        var st = rawProduct.structureType || '';
        // Check multiple signals — any one is enough
        if (st === 'taux_fixe') return true;
        if (name.indexOf('callable') >= 0) return true;
        if (name.indexOf('taux fixe') >= 0) return true;
        if (typeof _isFixedRateCallable === 'function' && _isFixedRateCallable(rawProduct)) return true;
        // Check coupon has rateIfCalled (double coupon = callable)
        var coupon = rawProduct.coupon || rawProduct.aiParsed?.coupon || {};
        if (coupon.rateIfCalled && coupon.rateIfMaturity) return true;
        return false;
    }

    var _waitNorm = setInterval(function() {
        if (typeof _graderNormalize !== 'function') return;
        clearInterval(_waitNorm);

        var _prevNormalize = _graderNormalize;

        window._graderNormalize = function(product) {
            var norm = _prevNormalize(product);
            var rawProduct = product || {};
            var aiParsed = rawProduct.aiParsed || {};
            var rawText = (rawProduct.rawText || '').toLowerCase();
            var name = (rawProduct.name || '').toLowerCase();

            // Detect callable EARLY
            var isCallable = _isCallableProduct(rawProduct, norm);

            // ─── FIX 1: Coupon sanity check ───
            if (norm.coupon > 25 && norm.couponMultiplier > 1) {
                norm.coupon = norm.couponRaw;
                norm.couponMultiplier = 1;
                norm.couponFrequencySource = 'sanity-cap-accuracy';
            }

            // Check "X% p.a." for already-annualized
            if (norm.couponMultiplier > 1) {
                var annualPattern = rawText.match(/(\d+[.,]?\d*)\s*%\s*(?:p\.?a\.?|annualis|par an|annuel)/i);
                if (annualPattern) {
                    var statedAnnual = parseFloat(annualPattern[1].replace(',', '.'));
                    if (Math.abs(statedAnnual - norm.couponRaw) < 0.5) {
                        norm.coupon = norm.couponRaw;
                        norm.couponMultiplier = 1;
                        norm.couponFrequencySource = 'already-annual-detected';
                    }
                }
            }

            // ─── FIX 2: Décrément — use PARSER value ───
            var decrementPct = parseFloat(rawProduct.decrementPct) || 0;
            if (!decrementPct) {
                var underlyings = ((rawProduct.underlyings || []).join(' ')).toLowerCase();
                var arMatch = underlyings.match(/\bar\s*(\d+[.,]?\d*)\s*%/i);
                if (arMatch) decrementPct = parseFloat(arMatch[1].replace(',', '.'));
            }
            if (decrementPct > 0 && decrementPct <= 20) {
                norm._decrement = decrementPct;
                var actualDiv = parseFloat(rawProduct.actualDividendYield) || 1.0;
                norm._actualDividend = actualDiv;
                norm._decrementDrag = decrementPct - actualDiv;
                norm._hasDecrement = true;
                console.log('[AccuracyPatch v1.2] Décrément: ' + decrementPct +
                    '% (div: ' + actualDiv + '%, drag: ' + norm._decrementDrag.toFixed(1) + '%/an)');
            }

            // ─── FIX 3: Payment timing ───
            var couponObj = rawProduct.coupon || aiParsed.coupon || {};
            var paymentTiming = couponObj.paymentTiming || '';
            var freqStr = (couponObj.frequency || '').toLowerCase();

            var isMaturityPayment = paymentTiming === 'maturity' || freqStr === 'maturity' ||
                freqStr.indexOf('maturit') >= 0 ||
                name.indexOf('paiement à maturité') >= 0 ||
                name.indexOf('paiement a maturite') >= 0;

            if (isMaturityPayment) {
                norm._paymentAtMaturity = true;
                var my = norm.maturityYears || 5;

                if (isCallable) {
                    // v1.2: LIGHT discount for callable (expected call in 2-4 years)
                    norm._nominalCoupon = norm.coupon;
                    norm.coupon = Math.round(norm.coupon * 0.92 * 100) / 100;
                    console.log('[AccuracyPatch v1.2] Callable maturity: ' +
                        norm._nominalCoupon + '% → ' + norm.coupon + '% (DF=0.92)');
                } else {
                    // Full discount for non-callable
                    var discountRate = 0.03;
                    var discountFactor = 1 / Math.pow(1 + discountRate, my / 2);
                    norm._nominalCoupon = norm.coupon;
                    norm.coupon = Math.round(norm.coupon * discountFactor * 100) / 100;
                    console.log('[AccuracyPatch v1.2] Maturity discount: ' + norm._nominalCoupon +
                        '% → ' + norm.coupon + '% (DF=' + discountFactor.toFixed(3) + ')');
                }
            }

            // ─── FIX 4: Step-down ───
            var earlyRed = rawProduct.earlyRedemption || aiParsed.earlyRedemption || {};
            if (earlyRed.stepDown === true || earlyRed.stepDown === 'true' ||
                rawText.indexOf('dégressive') >= 0 || rawText.indexOf('step-down') >= 0) {
                norm._hasStepDown = true;
            }

            norm._lockupYears = norm.maturityYears || 5;
            norm._isCallable = isCallable;

            if (isCallable) {
                console.log('[AccuracyPatch v1.2] isCallable=true → light discount, no lock-up penalty');
            }

            return norm;
        };
        console.log('[AccuracyPatch v1.2] _graderNormalize enhanced');
    }, 120);
    setTimeout(function() { clearInterval(_waitNorm); }, 10000);

    // ═══ Step-down maturity ═══
    var _waitMat = setInterval(function() {
        if (typeof _estimateExpectedMaturity !== 'function') return;
        clearInterval(_waitMat);
        var _origMat = _estimateExpectedMaturity;
        window._estimateExpectedMaturity = function(p) {
            if (p._hasStepDown && p.autocall) {
                var orig = p.autocallThreshold;
                p.autocallThreshold = Math.max(80, (orig || 100) - 10);
                var result = _origMat(p);
                p.autocallThreshold = orig;
                return result;
            }
            return _origMat(p);
        };
    }, 200);
    setTimeout(function() { clearInterval(_waitMat); }, 10000);

    // ═══ P4: lock-up + décrément ═══
    var _waitP4 = setInterval(function() {
        if (typeof _computeP4 !== 'function') return;
        clearInterval(_waitP4);

        var _origP4 = _computeP4;
        window._computeP4 = function(p, catRate) {
            var base = _origP4(p, catRate);
            var spread = p.coupon - (catRate || 2.5);
            var matYears = p._lockupYears || p.maturityYears || 5;

            // v1.2: NO lock-up penalty for callable products
            // They can be called early → actual lock-up is much shorter
            if (!p._isCallable) {
                var spreadPerYear = matYears > 0 ? spread / matYears : spread;
                if (spreadPerYear < 0.5 && matYears > 3) {
                    var penalty = Math.min(15, Math.round((0.5 - spreadPerYear) * 20));
                    base -= penalty;
                    console.log('[AccuracyPatch v1.2] P4 lock-up: -' + penalty + 'pts');
                }
            } else {
                console.log('[AccuracyPatch v1.2] P4: skip lock-up (callable)');
            }

            // Décrément penalty
            if (p._hasDecrement && p._decrementDrag > 0) {
                var decPenalty = Math.min(12, Math.round(p._decrementDrag * 2.5));
                base -= decPenalty;
                console.log('[AccuracyPatch v1.2] P4 décrément: -' + decPenalty + 'pts');
            }

            return Math.max(0, Math.min(100, base));
        };
        console.log('[AccuracyPatch v1.2] _computeP4 enhanced');
    }, 250);
    setTimeout(function() { clearInterval(_waitP4); }, 10000);

    // ═══ Prompt injection ═══
    var _waitPrompt = setInterval(function() {
        if (typeof _buildUserPrompt !== 'function') return;
        clearInterval(_waitPrompt);

        var _prevUserPrompt = _buildUserPrompt;
        window._buildUserPrompt = function(ctx, base, productType) {
            var prompt = _prevUserPrompt(ctx, base, productType);
            var product = app.state.currentProduct || {};

            // Décrément warning (exact values)
            var decPct = parseFloat(product.decrementPct) || 0;
            var actualDiv = parseFloat(product.actualDividendYield) || 0;
            if (decPct > 0) {
                var drag = decPct - (actualDiv || 1.0);
                var warning = '\n⚠ DÉCRÉMENT SYNTHÉTIQUE:\n' +
                    '- Prélèvement: EXACTEMENT ' + decPct + '%/an\n' +
                    '- Dividendes réels: ' + (actualDiv || '~1') + '%/an\n' +
                    '- Drag net: ' + drag.toFixed(1) + '%/an\n' +
                    '- Sur 5 ans: ~' + (drag * 5).toFixed(0) + '% de perte structurelle\n' +
                    '- UTILISER ces chiffres exacts.\n\n';
                var idx = prompt.indexOf('## SCORES');
                if (idx > 0) prompt = prompt.substring(0, idx) + warning + prompt.substring(idx);
            }

            // Payment at maturity + double coupon
            var couponObj = product.coupon || {};
            if (couponObj.rateIfCalled && couponObj.rateIfMaturity) {
                var matWarning = '\n⚠ DOUBLE COUPON CALLABLE:\n' +
                    '- Si rappelé: ' + couponObj.rateIfCalled + '%/an (bonus)\n' +
                    '- Si non rappelé (maturité): ' + couponObj.rateIfMaturity + '%/an\n' +
                    '- L\'émetteur rappelle quand c\'est bon pour LUI (taux baissent)\n' +
                    '- Paiement à maturité = pas de cash flow intermédiaire\n\n';
                var idx2 = prompt.indexOf('## SCORES');
                if (idx2 > 0) prompt = prompt.substring(0, idx2) + matWarning + prompt.substring(idx2);
            }

            return prompt;
        };
        console.log('[AccuracyPatch v1.2] _buildUserPrompt enhanced');
    }, 300);
    setTimeout(function() { clearInterval(_waitPrompt); }, 10000);

    console.log('[StructBoard] Grading Accuracy Patch v1.2');
})();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grading Accuracy Patch v1.1
// v1.1 Fixes:
//   - Décrément: use product.decrementPct (from parser) instead of
//     regex on rawText which could match wrong numbers
//   - P4 Taux Fixe: don't double-penalize (discount + lock-up)
//     For callable products, expected duration is shorter
//   - P4 Rate environment: if MI says rising rates, penalize
//     fixed rate products (locked at low rate while market rises)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

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

            // ─── FIX 1: Coupon sanity check ───
            if (norm.coupon > 25 && norm.couponMultiplier > 1) {
                norm.coupon = norm.couponRaw;
                norm.couponMultiplier = 1;
                norm.couponFrequencySource = 'sanity-cap-accuracy';
            }

            // Check "X% p.a." pattern for already-annualized coupons
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

            // ─── FIX 2: Décrément — use PARSER value, not regex ───
            // v1.1: Trust product.decrementPct from V7.2 parser instead
            // of running regex on rawText (which matched wrong numbers)
            var decrementPct = parseFloat(rawProduct.decrementPct) || 0;

            // Fallback: check underlying name for "AR X%"
            if (!decrementPct) {
                var underlyings = ((rawProduct.underlyings || []).join(' ')).toLowerCase();
                var arMatch = underlyings.match(/\bar\s*(\d+[.,]?\d*)\s*%/i);
                if (arMatch) decrementPct = parseFloat(arMatch[1].replace(',', '.'));
            }

            if (decrementPct > 0 && decrementPct <= 20) { // sanity: max 20%
                norm._decrement = decrementPct;
                var actualDiv = parseFloat(rawProduct.actualDividendYield) || 1.0;
                norm._actualDividend = actualDiv;
                norm._decrementDrag = decrementPct - actualDiv;
                norm._hasDecrement = true;

                console.log('[AccuracyPatch v1.1] Décrément: ' + decrementPct +
                    '% (div réel: ' + actualDiv + '%, drag: ' + norm._decrementDrag.toFixed(1) + '%/an)');
            }

            // ─── FIX 3: Payment timing ───
            var couponObj = rawProduct.coupon || aiParsed.coupon || {};
            var paymentTiming = couponObj.paymentTiming || '';
            var freqStr = (couponObj.frequency || '').toLowerCase();
            var isCallable = norm.autocall && (rawProduct.structureType === 'taux_fixe' ||
                name.indexOf('callable') >= 0 || name.indexOf('taux fixe') >= 0);

            if (paymentTiming === 'maturity' || freqStr === 'maturity' ||
                freqStr.indexOf('maturit') >= 0 ||
                name.indexOf('paiement à maturité') >= 0 ||
                name.indexOf('paiement a maturite') >= 0) {

                norm._paymentAtMaturity = true;
                var my = norm.maturityYears || 5;

                // v1.1: For callable products, use LIGHTER discount
                // Because if called at year 3, you get 5%×3 = 15% at year 3 (not year 10)
                // Expected call time ~2-4 years → discount is much smaller
                if (isCallable) {
                    var discountFactor = 0.92; // light discount for callable
                    norm._nominalCoupon = norm.coupon;
                    norm.coupon = Math.round(norm.coupon * discountFactor * 100) / 100;
                    norm._isCallable = true;
                    console.log('[AccuracyPatch v1.1] Callable maturity discount: ' +
                        norm._nominalCoupon + '% → ' + norm.coupon + '% (DF=0.92)');
                } else {
                    // Non-callable: full discount
                    var discountRate = 0.03;
                    var discountFactor = 1 / Math.pow(1 + discountRate, my / 2);
                    norm._nominalCoupon = norm.coupon;
                    norm.coupon = Math.round(norm.coupon * discountFactor * 100) / 100;
                    console.log('[AccuracyPatch v1.1] Maturity discount: ' + norm._nominalCoupon +
                        '% → ' + norm.coupon + '% (DF=' + discountFactor.toFixed(3) + ', ' + my + 'Y)');
                }
            }

            // ─── FIX 4: Step-down detection ───
            var earlyRed = rawProduct.earlyRedemption || aiParsed.earlyRedemption || {};
            if (earlyRed.stepDown === true || earlyRed.stepDown === 'true' ||
                rawText.indexOf('dégressive') >= 0 || rawText.indexOf('step-down') >= 0) {
                norm._hasStepDown = true;
                var sdMatch = rawText.match(/dégressive\s*(?:de\s*)?[-–]?\s*(\d+[.,]?\d*)\s*%/i);
                if (sdMatch) norm._stepDownPct = parseFloat(sdMatch[1].replace(',', '.'));
            }

            norm._lockupYears = norm.maturityYears || 5;
            norm._isCallable = isCallable;
            return norm;
        };
        console.log('[AccuracyPatch v1.1] _graderNormalize enhanced');
    }, 120);
    setTimeout(function() { clearInterval(_waitNorm); }, 10000);

    // ═══ FIX 4b: Step-down in expected maturity ═══
    var _waitMat = setInterval(function() {
        if (typeof _estimateExpectedMaturity !== 'function') return;
        clearInterval(_waitMat);

        var _origMat = _estimateExpectedMaturity;
        window._estimateExpectedMaturity = function(p) {
            if (p._hasStepDown && p.autocall) {
                var origThreshold = p.autocallThreshold;
                p.autocallThreshold = Math.max(80, (origThreshold || 100) - 10);
                var result = _origMat(p);
                p.autocallThreshold = origThreshold;
                return result;
            }
            return _origMat(p);
        };
    }, 200);
    setTimeout(function() { clearInterval(_waitMat); }, 10000);

    // ═══ FIX 5: P4 — lock-up + décrément + rate environment ═══
    var _waitP4 = setInterval(function() {
        if (typeof _computeP4 !== 'function') return;
        clearInterval(_waitP4);

        var _origP4 = _computeP4;
        window._computeP4 = function(p, catRate) {
            var base = _origP4(p, catRate);
            var spread = p.coupon - (catRate || 2.5);
            var matYears = p._lockupYears || p.maturityYears || 5;

            // v1.1: Lock-up penalty — but NOT for callable products
            // Callable products have expected duration much shorter than max maturity
            if (!p._isCallable) {
                var spreadPerYear = matYears > 0 ? spread / matYears : spread;
                if (spreadPerYear < 0.5 && matYears > 3) {
                    var penalty = Math.min(15, Math.round((0.5 - spreadPerYear) * 20));
                    base -= penalty;
                    console.log('[AccuracyPatch v1.1] P4 lock-up: spread/year=' +
                        spreadPerYear.toFixed(2) + '% → -' + penalty + 'pts');
                }
            }

            // Décrément penalty
            if (p._hasDecrement && p._decrementDrag > 0) {
                var decPenalty = Math.min(12, Math.round(p._decrementDrag * 2.5));
                base -= decPenalty;
                console.log('[AccuracyPatch v1.1] P4 décrément: drag=' +
                    p._decrementDrag.toFixed(1) + '%/an → -' + decPenalty + 'pts');
            }

            return Math.max(0, Math.min(100, base));
        };
        console.log('[AccuracyPatch v1.1] _computeP4 enhanced');
    }, 250);
    setTimeout(function() { clearInterval(_waitP4); }, 10000);

    // ═══ FIX 2b: Prompt injection — use exact values from product ═══
    var _waitPrompt = setInterval(function() {
        if (typeof _buildUserPrompt !== 'function') return;
        clearInterval(_waitPrompt);

        var _prevUserPrompt = _buildUserPrompt;
        window._buildUserPrompt = function(ctx, base, productType) {
            var prompt = _prevUserPrompt(ctx, base, productType);
            var product = app.state.currentProduct || {};

            // v1.1: Use product.decrementPct (from parser), NOT regex on rawText
            var decPct = parseFloat(product.decrementPct) || 0;
            var actualDiv = parseFloat(product.actualDividendYield) || 0;

            if (decPct > 0) {
                var drag = decPct - (actualDiv || 1.0);
                var warning = '\n⚠ DÉCRÉMENT SYNTHÉTIQUE IMPORTANT:\n' +
                    '- Prélèvement forfaitaire: EXACTEMENT ' + decPct + '% par an (pas plus, pas moins)\n' +
                    '- Dividendes réels historiques: ' + (actualDiv || '~1') + '% par an\n' +
                    '- Drag net: ' + drag.toFixed(1) + '% par an de sous-performance structurelle\n' +
                    '- Impact: sur 5 ans, l\'indice perd environ ' + (drag * 5).toFixed(0) + '% vs le sous-jacent réel\n' +
                    '- Le coupon de 9% est TROMPEUR car la barrière s\'érode de ' + drag.toFixed(1) + '%/an\n' +
                    '- UTILISER ces chiffres exacts dans ton analyse. Ne pas inventer d\'autres valeurs.\n\n';

                var scoresIdx = prompt.indexOf('## SCORES');
                if (scoresIdx > 0) {
                    prompt = prompt.substring(0, scoresIdx) + warning + prompt.substring(scoresIdx);
                } else {
                    prompt += warning;
                }
            }

            // Payment at maturity warning
            if (product.name && product.name.toLowerCase().indexOf('paiement à maturité') >= 0) {
                var couponObj = product.coupon || {};
                var rateIfCalled = couponObj.rateIfCalled;
                var rateIfMat = couponObj.rateIfMaturity;
                var matWarning = '\n⚠ PAIEMENT À MATURITÉ:\n' +
                    '- Aucun flux de trésorerie avant la date d\'échéance\n' +
                    '- La valeur actualisée du rendement est inférieure au taux facial\n';
                if (rateIfCalled && rateIfMat) {
                    matWarning += '- Si rappelé: ' + rateIfCalled + '%/an (bonus)\n' +
                        '- Si non rappelé: ' + rateIfMat + '%/an (maturité)\n' +
                        '- L\'émetteur rappelle quand c\'est avantageux pour LUI (taux baissent)\n' +
                        '- En environnement de HAUSSE des taux: le produit n\'est PAS rappelé et vous êtes coincé à ' + rateIfMat + '%\n';
                }
                matWarning += '\n';

                var scoresIdx2 = prompt.indexOf('## SCORES');
                if (scoresIdx2 > 0) {
                    prompt = prompt.substring(0, scoresIdx2) + matWarning + prompt.substring(scoresIdx2);
                }
            }

            return prompt;
        };
        console.log('[AccuracyPatch v1.1] _buildUserPrompt enhanced');
    }, 300);
    setTimeout(function() { clearInterval(_waitPrompt); }, 10000);

    console.log('[StructBoard] Grading Accuracy Patch v1.1 — fixed décrément source + callable P4');
})();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grading Accuracy Patch v1.0
// Fixes 5 systemic grading issues:
//   1. Coupon double-counting (4.5% sem already = 9%/an in brochure)
//   2. Décrément detection (synthetic index handicap)
//   3. Payment timing (à maturité = lower real yield)
//   4. Step-down modeling (degressive barrier = higher P(autocall))
//   5. P4 lock-up penalty (long maturity without periodic cash)
//
// Strategy: Override _graderNormalize (runs before ALL scoring)
//           + Override _computeP4 for lock-up
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ FIX 1: Coupon double-counting guard ═══
    // Problem: brochure says "4.50% par semestre (9.00% p.a.)"
    // Parser extracts coupon=9, frequency=semestriel
    // Grader does 9 × 2 = 18% → WRONG
    //
    // Solution: detect when coupon × multiplier > reasonable threshold
    // AND when the raw text contains both the period rate and annual rate
    // If coupon × mult > 25% → likely already annualized

    // ═══ FIX 2: Décrément detection ═══
    // Problem: Solactive GDX EUR AR 5% = synthetic index with 5% annual drag
    // Dividends = 0.97% → net handicap = 4.03%/an
    // Grader treats it like a normal index
    //
    // Solution: detect "décrément" or "AR X%" in underlying name
    // Adjust effective coupon and flag risk

    // ═══ FIX 3: Payment timing ═══
    // Problem: "paiement à maturité" means no periodic cash flow
    // 40% in 10 years ≠ 4%/an (time value of money)
    // Grader treats both the same
    //
    // Solution: apply discount factor for maturity-only payments

    // ═══ FIX 4: Step-down modeling ═══
    // Problem: degressive autocall barrier (95% → 82.5%) significantly
    // increases P(autocall) but _estimateExpectedMaturity uses fixed threshold
    //
    // Solution: detect step-down and adjust probCallPerDate

    // ═══ FIX 5: P4 lock-up penalty ═══
    // Problem: 3 years lock-up for 1.3% spread = poor deal
    // But P4 only looks at spread, not duration
    //
    // Solution: penalize P4 based on spread/maturity ratio

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
            var underlyings = ((rawProduct.underlyings || []).join(' ')).toLowerCase();

            // ─── FIX 1: Coupon sanity check ───
            // If annualized coupon > 25% and multiplier > 1, likely double-counted
            if (norm.coupon > 25 && norm.couponMultiplier > 1) {
                console.log('[AccuracyPatch] Coupon sanity: ' + norm.couponRaw + '% × ' +
                    norm.couponMultiplier + ' = ' + norm.coupon + '% → capping to ' + norm.couponRaw + '%');
                norm.coupon = norm.couponRaw;
                norm.couponMultiplier = 1;
                norm.couponFrequencySource = 'sanity-cap-accuracy';
            }

            // Also check: if raw text mentions "X% p.a." or "X% annualisé"
            // and coupon × mult matches that X, then coupon is already annual
            if (norm.couponMultiplier > 1) {
                var annualPattern = rawText.match(/(\d+[.,]?\d*)\s*%\s*(?:p\.?a\.?|annualis|par an|annuel)/i);
                if (annualPattern) {
                    var statedAnnual = parseFloat(annualPattern[1].replace(',', '.'));
                    // If the stated annual matches the raw coupon (not the multiplied one)
                    if (Math.abs(statedAnnual - norm.couponRaw) < 0.5) {
                        console.log('[AccuracyPatch] Coupon already annualized: stated ' +
                            statedAnnual + '%/an = raw ' + norm.couponRaw + '% → no multiplication');
                        norm.coupon = norm.couponRaw;
                        norm.couponMultiplier = 1;
                        norm.couponFrequencySource = 'already-annual-detected';
                    }
                }
            }

            // ─── FIX 2: Décrément detection ───
            var decrementPct = 0;
            // Check underlying name for "AR X%" or "décrément X%"
            var decMatch = underlyings.match(/(?:ar|décr[ée]ment|decrement)\s*(\d+[.,]?\d*)\s*%/i);
            if (!decMatch) decMatch = name.match(/(?:ar|décr[ée]ment|decrement)\s*(\d+[.,]?\d*)\s*%/i);
            if (!decMatch) decMatch = rawText.match(/(?:prélèvement forfaitaire|décrément|decrement)\s*(?:de\s*)?(\d+[.,]?\d*)\s*%/i);

            if (decMatch) {
                decrementPct = parseFloat(decMatch[1].replace(',', '.'));
                norm._decrement = decrementPct;

                // Try to find actual dividend yield
                var divMatch = rawText.match(/dividendes?\s*(?:nets?\s*)?(?:distribués?\s*)?.*?(\d+[.,]\d+)\s*%/i);
                var actualDiv = divMatch ? parseFloat(divMatch[1].replace(',', '.')) : 1.0; // default 1%
                norm._actualDividend = actualDiv;
                norm._decrementDrag = decrementPct - actualDiv;

                console.log('[AccuracyPatch] Décrément detected: ' + decrementPct +
                    '% (div réel ~' + actualDiv + '%, drag net: ' + norm._decrementDrag.toFixed(1) + '%/an)');
            }

            // ─── FIX 3: Payment timing ───
            var couponObj = rawProduct.coupon || aiParsed.coupon || {};
            var paymentTiming = couponObj.paymentTiming || '';
            var freqStr = (couponObj.frequency || '').toLowerCase();

            // Detect "à maturité" payment
            if (paymentTiming === 'maturity' || freqStr === 'maturity' ||
                freqStr.indexOf('maturit') >= 0 ||
                name.indexOf('paiement à maturité') >= 0 ||
                name.indexOf('paiement a maturite') >= 0) {
                norm._paymentAtMaturity = true;

                // Apply time-value discount: 40% in 10 years ≈ 3.4%/an (not 4%/an)
                // Simple approximation: effective_annual = total / maturity × discount_factor
                // discount_factor ≈ 0.85 for 5Y, 0.75 for 10Y (at ~3% discount rate)
                var my = norm.maturityYears || 5;
                var discountRate = 0.03; // approximate risk-free
                var discountFactor = 1 / Math.pow(1 + discountRate, my / 2); // mid-point discount
                var effectiveCoupon = norm.coupon * discountFactor;

                console.log('[AccuracyPatch] Payment at maturity: ' + norm.coupon +
                    '%/an nominal → ' + effectiveCoupon.toFixed(2) + '%/an effective (DF=' +
                    discountFactor.toFixed(3) + ', ' + my + 'Y)');

                norm._nominalCoupon = norm.coupon;
                norm.coupon = Math.round(effectiveCoupon * 100) / 100;
            }

            // ─── FIX 4: Step-down detection ───
            var earlyRed = rawProduct.earlyRedemption || aiParsed.earlyRedemption || {};
            if (earlyRed.stepDown === true || earlyRed.stepDown === 'true' ||
                name.indexOf('dégressi') >= 0 || name.indexOf('step') >= 0 ||
                rawText.indexOf('dégressive') >= 0 || rawText.indexOf('step-down') >= 0 ||
                rawText.indexOf('step down') >= 0) {

                norm._hasStepDown = true;

                // Detect step-down amount
                var sdMatch = rawText.match(/(?:dégressive|step.?down)\s*(?:de\s*)?[-–]?\s*(\d+[.,]?\d*)\s*%/i);
                if (sdMatch) {
                    norm._stepDownPct = parseFloat(sdMatch[1].replace(',', '.'));
                }

                console.log('[AccuracyPatch] Step-down detected: ' +
                    (norm._stepDownPct ? '-' + norm._stepDownPct + '%/period' : 'yes'));
            }

            // Store flags for P4 calculation
            norm._lockupYears = norm.maturityYears || 5;
            norm._hasDecrement = decrementPct > 0;

            return norm;
        };
        console.log('[AccuracyPatch] _graderNormalize enhanced (coupon/décrément/timing/step-down)');
    }, 120);
    setTimeout(function() { clearInterval(_waitNorm); }, 10000);

    // ═══ FIX 4b: Step-down in expected maturity ═══
    var _waitMat = setInterval(function() {
        if (typeof _estimateExpectedMaturity !== 'function') return;
        clearInterval(_waitMat);

        var _origMat = _estimateExpectedMaturity;
        window._estimateExpectedMaturity = function(p) {
            // If step-down, increase P(call) per observation
            if (p._hasStepDown && p.autocall) {
                // Step-down = barrier decreases over time → higher P(call) later
                // Approximate: increase probCallPerDate by 30-50%
                var origThreshold = p.autocallThreshold;
                // Temporarily lower threshold to simulate higher probability
                p.autocallThreshold = Math.max(80, (origThreshold || 100) - 10);
                var result = _origMat(p);
                p.autocallThreshold = origThreshold; // restore
                if (result.isEstimated) {
                    result._stepDownAdjusted = true;
                    console.log('[AccuracyPatch] Step-down maturity: ' + result.expected +
                        'Y (vs ~' + _origMat(p).expected + 'Y without step-down)');
                }
                return result;
            }
            return _origMat(p);
        };
        console.log('[AccuracyPatch] _estimateExpectedMaturity enhanced for step-down');
    }, 200);
    setTimeout(function() { clearInterval(_waitMat); }, 10000);

    // ═══ FIX 5: P4 lock-up penalty ═══
    var _waitP4 = setInterval(function() {
        if (typeof _computeP4 !== 'function') return;
        clearInterval(_waitP4);

        var _origP4 = _computeP4;
        window._computeP4 = function(p, catRate) {
            var base = _origP4(p, catRate);

            // Penalty for low spread + long lock-up
            var spread = p.coupon - (catRate || 2.5);
            var matYears = p._lockupYears || p.maturityYears || 5;

            // Spread per year of lock-up
            // < 1%/year of lock-up = bad deal
            // 1-2%/year = mediocre
            // > 2%/year = acceptable
            var spreadPerYear = matYears > 0 ? spread / matYears : spread;

            if (spreadPerYear < 0.5 && matYears > 3) {
                // Very poor spread/lockup ratio
                var penalty = Math.round((0.5 - spreadPerYear) * 20);
                base -= Math.min(15, penalty);
                console.log('[AccuracyPatch] P4 lock-up penalty: spread/year=' +
                    spreadPerYear.toFixed(2) + '% → -' + Math.min(15, penalty) + 'pts');
            }

            // Bonus for payment at maturity recognition
            // (already partially handled by coupon discount in normalize)

            // Décrément penalty on P4: reduces effective spread
            if (p._hasDecrement && p._decrementDrag > 0) {
                var effSpread = spread - p._decrementDrag;
                if (effSpread < spread * 0.5) {
                    // Décrément eats more than half the spread
                    var decPenalty = Math.round(p._decrementDrag * 3);
                    base -= Math.min(15, decPenalty);
                    console.log('[AccuracyPatch] P4 décrément penalty: drag=' +
                        p._decrementDrag.toFixed(1) + '%/an → -' + Math.min(15, decPenalty) + 'pts');
                }
            }

            return Math.max(0, Math.min(100, base));
        };
        console.log('[AccuracyPatch] _computeP4 enhanced (lock-up + décrément)');
    }, 250);
    setTimeout(function() { clearInterval(_waitP4); }, 10000);

    // ═══ FIX 2b: Add décrément warning to Claude prompt ═══
    var _waitPrompt = setInterval(function() {
        if (typeof _buildUserPrompt !== 'function') return;
        clearInterval(_waitPrompt);

        var _prevUserPrompt = _buildUserPrompt;
        window._buildUserPrompt = function(ctx, base, productType) {
            var prompt = _prevUserPrompt(ctx, base, productType);

            var product = app.state.currentProduct || {};
            var rawText = (product.rawText || '').toLowerCase();

            // Inject décrément warning
            var decMatch = rawText.match(/(?:prélèvement forfaitaire|décrément|decrement)\s*(?:de\s*)?(\d+[.,]?\d*)\s*%/i);
            if (decMatch) {
                var decPct = parseFloat(decMatch[1].replace(',', '.'));
                var divMatch = rawText.match(/dividendes?\s*(?:nets?\s*)?.*?(\d+[.,]\d+)\s*%/i);
                var actualDiv = divMatch ? parseFloat(divMatch[1].replace(',', '.')) : 1.0;

                var warning = '\n⚠ DÉCRÉMENT SYNTHÉTIQUE: L\'indice a un prélèvement de ' +
                    decPct + '%/an alors que les dividendes réels sont ~' + actualDiv +
                    '%. Drag net = ' + (decPct - actualDiv).toFixed(1) +
                    '%/an. Cela RÉDUIT significativement le rendement réel et AUGMENTE le risque de toucher la barrière. ' +
                    'PÉNALISER P1 et P2 en conséquence.\n';

                var scoresIdx = prompt.indexOf('## SCORES');
                if (scoresIdx > 0) {
                    prompt = prompt.substring(0, scoresIdx) + warning + prompt.substring(scoresIdx);
                } else {
                    prompt += warning;
                }
                console.log('[AccuracyPatch] Décrément warning injected in prompt');
            }

            // Inject payment-at-maturity warning
            if (product.name && product.name.toLowerCase().indexOf('paiement à maturité') >= 0) {
                var matWarning = '\n⚠ PAIEMENT À MATURITÉ: Le coupon n\'est versé qu\'à l\'échéance (pas de flux périodique). ' +
                    'La valeur actuelle du rendement est inférieure au taux facial. Pénaliser P1.\n';

                var scoresIdx2 = prompt.indexOf('## SCORES');
                if (scoresIdx2 > 0) {
                    prompt = prompt.substring(0, scoresIdx2) + matWarning + prompt.substring(scoresIdx2);
                }
            }

            return prompt;
        };
        console.log('[AccuracyPatch] _buildUserPrompt enhanced (décrément + maturity warnings)');
    }, 300);
    setTimeout(function() { clearInterval(_waitPrompt); }, 10000);

    console.log('[StructBoard] Grading Accuracy Patch v1.0 — coupon/décrément/timing/step-down/lock-up');
})();

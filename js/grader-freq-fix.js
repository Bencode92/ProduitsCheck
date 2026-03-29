// ═══════════════════════════════════════════════════════════════════════════════
// grader-freq-fix v7 — Fix coupon annualization for infra-annual frequencies
//
// BUG CHAIN (3 issues compound):
// 1. `var co = p.coupon || ai.coupon` short-circuits when p.coupon is truthy
// 2. Even when coupon object has frequency, _annualizeCoupon correctly returns
//    mult=2, BUT then a "safeguard" at the END of _graderNormalize reverts it:
//    if rawText contains "4.85%...annuel" (regex match), it sets mult back to 1
// 3. This safeguard was intended for rates already stated as annual, but
//    falsely triggers when per-period rate appears near "annuel" in PDF text
//
// FIX v7 STRATEGY: Pre-annualize the coupon to its yearly equivalent and
// mark annualized=true so _annualizeCoupon returns mult=1 (no further mult).
// The rawText safeguard then never triggers (it only runs when mult>1).
// After grading, patch the result metadata for the UI blue banner.
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

        // Source 1: product.coupon.frequency (if coupon is an object)
        if (typeof product.coupon === 'object' && product.coupon !== null) {
            var pcf = (product.coupon.frequency || product.coupon.frequence || '').toLowerCase().trim();
            if (pcf && FREQ_MULT[pcf] && FREQ_MULT[pcf] > 1) return { freq: pcf, src: 'product.coupon' };
        }

        // Source 2: aiParsed.coupon.frequency
        if (typeof ai.coupon === 'object' && ai.coupon !== null) {
            var acf = (ai.coupon.frequency || ai.coupon.frequence || '').toLowerCase().trim();
            if (acf && FREQ_MULT[acf] && FREQ_MULT[acf] > 1) return { freq: acf, src: 'ai.coupon' };
        }

        // Source 3: aiParsed.earlyRedemption.frequency
        var aiAr = ai.earlyRedemption || {};
        var aef = (aiAr.frequency || aiAr.frequence || '').toLowerCase().trim();
        if (aef && FREQ_MULT[aef] && FREQ_MULT[aef] > 1) return { freq: aef, src: 'ai.earlyRedemption' };

        // Source 4: product.earlyRedemption.frequency
        var pAr = product.earlyRedemption || {};
        var pef = (pAr.frequency || pAr.frequence || '').toLowerCase().trim();
        if (pef && FREQ_MULT[pef] && FREQ_MULT[pef] > 1) return { freq: pef, src: 'product.earlyRedemption' };

        // Source 5: product name regex
        var nm = (product.name || ai.name || '').toLowerCase();
        if (/semestriel/i.test(nm)) return { freq: 'semestriel', src: 'name' };
        if (/trimestriel/i.test(nm)) return { freq: 'trimestriel', src: 'name' };
        if (/mensuel/i.test(nm)) return { freq: 'mensuel', src: 'name' };

        return null;
    }

    // Get per-period rate from coupon (number or object)
    function _getRate(coupon) {
        if (typeof coupon === 'number') return coupon;
        if (typeof coupon === 'string') return parseFloat(coupon) || 0;
        if (typeof coupon === 'object' && coupon !== null) return parseFloat(coupon.rate || coupon.taux) || 0;
        return 0;
    }

    // Pre-fix: convert coupon to pre-annualized value
    // Returns fix info object if applied, null otherwise
    function _fixCouponFrequency(product) {
        if (!product) return null;

        var detected = _detectFreq(product);
        if (!detected) return null;

        var mult = FREQ_MULT[detected.freq];
        if (!mult || mult <= 1) return null;

        var rawRate = _getRate(product.coupon);
        if (rawRate <= 0) return null;

        var annual = Math.round(rawRate * mult * 1000) / 1000;

        // Sanity: if annualized > 25%, probably already annual
        if (annual > 25) return null;

        // SET coupon to pre-annualized value with annualized=true
        // This makes _annualizeCoupon return mult=1, bypassing the rawText safeguard
        var oldCoupon = product.coupon;
        product.coupon = {
            rate: annual,
            frequency: 'annuel',
            annualized: true
        };
        // Copy metadata from original coupon object
        if (typeof oldCoupon === 'object' && oldCoupon !== null) {
            if (oldCoupon.type) product.coupon.type = oldCoupon.type;
            if (oldCoupon.memory || oldCoupon.memoire) product.coupon.memory = oldCoupon.memory || oldCoupon.memoire;
            if (oldCoupon.paymentTiming) product.coupon.paymentTiming = oldCoupon.paymentTiming;
            if (oldCoupon.trigger) product.coupon.trigger = oldCoupon.trigger;
        }

        console.log('[freq-fix v7] PRE-ANNUALIZED: ' + rawRate + '% x' + mult + ' (' + detected.freq + ' via ' + detected.src + ') = ' + annual + '%');

        return {
            applied: true,
            rawRate: rawRate,
            freq: detected.freq,
            mult: mult,
            annual: annual,
            src: detected.src
        };
    }

    // Post-fix: patch grading result metadata for UI display (blue banner)
    function _patchResult(result, fixInfo) {
        if (!result || !fixInfo || !fixInfo.applied) return;

        // Patch metadata
        if (result.metadata) {
            result.metadata.couponRaw = fixInfo.rawRate;
            result.metadata.couponMultiplier = fixInfo.mult;
            result.metadata.couponFrequency = fixInfo.freq;
            result.metadata.couponAnnualized = fixInfo.annual;
        }

        // Patch pillar reasoning to show correct info
        if (result.pillars) {
            var p1 = result.pillars.adjustedReturn;
            if (p1 && p1.reasoning) {
                p1.reasoning = p1.reasoning.replace(
                    'Coupon ' + fixInfo.annual + '%',
                    'Coupon ' + fixInfo.rawRate + '% × ' + fixInfo.mult + ' (' + fixInfo.freq + ') = ' + fixInfo.annual + '%'
                );
            }
            var p4 = result.pillars.riskPremium;
            if (p4 && p4.reasoning) {
                p4.reasoning = p4.reasoning.replace(
                    fixInfo.annual + '% vs CAT',
                    fixInfo.rawRate + '% × ' + fixInfo.mult + ' = ' + fixInfo.annual + '% vs CAT'
                );
            }
        }
    }

    function _patch() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) {
            return false;
        }

        // Wrap ProposalGrader.grade
        var _origGrade = ProposalGrader.grade;
        ProposalGrader.grade = function(product) {
            var fixInfo = _fixCouponFrequency(product);
            var resultPromise = _origGrade.call(this, product);

            // gradeProposal returns a Promise (async function)
            if (resultPromise && typeof resultPromise.then === 'function') {
                return resultPromise.then(function(result) {
                    _patchResult(result, fixInfo);
                    return result;
                });
            }
            // Fallback for sync
            _patchResult(resultPromise, fixInfo);
            return resultPromise;
        };

        // Wrap normalize for console testing
        var _origNorm = ProposalGrader.normalize;
        ProposalGrader.normalize = function(product) {
            _fixCouponFrequency(product);
            return _origNorm.call(this, product);
        };

        // Wrap gradeBatch
        if (ProposalGrader.gradeBatch) {
            var _origBatch = ProposalGrader.gradeBatch;
            ProposalGrader.gradeBatch = function(proposals, onProgress) {
                var fixInfos = proposals.map(function(p) { return _fixCouponFrequency(p); });
                return _origBatch.call(this, proposals, function(idx, total, lastResult) {
                    if (lastResult && lastResult.grading && fixInfos[idx - 1]) {
                        _patchResult(lastResult.grading, fixInfos[idx - 1]);
                    }
                    if (onProgress) onProgress(idx, total, lastResult);
                });
            };
        }

        console.log('[freq-fix v7] Patched ProposalGrader.grade + normalize + gradeBatch (pre-annualize strategy)');
        return true;
    }

    if (!_patch()) {
        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            if (_patch() || attempts > 50) clearInterval(iv);
        }, 100);
    }
})();

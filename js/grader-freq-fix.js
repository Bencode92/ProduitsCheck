// ═══════════════════════════════════════════════════════════════════════════════
// grader-freq-fix v7.1 — Fix coupon annualization for infra-annual frequencies
//
// v7.1: Add guard against double-application (normalize + grade both call fix)
// v7: Pre-annualize strategy to bypass rawText safeguard
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var FREQ_MULT = {
        'trimestriel':4,'trimestrielle':4,'quarterly':4,
        'semestriel':2,'semestrielle':2,'semi-annual':2,'semi-annuel':2,
        'mensuel':12,'mensuelle':12,'monthly':12,
        'annuel':1,'annuelle':1,'annual':1
    };

    function _detectFreq(product) {
        var ai = product.aiParsed || {};

        if (typeof product.coupon === 'object' && product.coupon !== null) {
            var pcf = (product.coupon.frequency || product.coupon.frequence || '').toLowerCase().trim();
            if (pcf && FREQ_MULT[pcf] && FREQ_MULT[pcf] > 1) return { freq: pcf, src: 'product.coupon' };
        }

        if (typeof ai.coupon === 'object' && ai.coupon !== null) {
            var acf = (ai.coupon.frequency || ai.coupon.frequence || '').toLowerCase().trim();
            if (acf && FREQ_MULT[acf] && FREQ_MULT[acf] > 1) return { freq: acf, src: 'ai.coupon' };
        }

        var aiAr = ai.earlyRedemption || {};
        var aef = (aiAr.frequency || aiAr.frequence || '').toLowerCase().trim();
        if (aef && FREQ_MULT[aef] && FREQ_MULT[aef] > 1) return { freq: aef, src: 'ai.earlyRedemption' };

        var pAr = product.earlyRedemption || {};
        var pef = (pAr.frequency || pAr.frequence || '').toLowerCase().trim();
        if (pef && FREQ_MULT[pef] && FREQ_MULT[pef] > 1) return { freq: pef, src: 'product.earlyRedemption' };

        var nm = (product.name || ai.name || '').toLowerCase();
        if (/semestriel/i.test(nm)) return { freq: 'semestriel', src: 'name' };
        if (/trimestriel/i.test(nm)) return { freq: 'trimestriel', src: 'name' };
        if (/mensuel/i.test(nm)) return { freq: 'mensuel', src: 'name' };

        return null;
    }

    function _getRate(coupon) {
        if (typeof coupon === 'number') return coupon;
        if (typeof coupon === 'string') return parseFloat(coupon) || 0;
        if (typeof coupon === 'object' && coupon !== null) return parseFloat(coupon.rate || coupon.taux) || 0;
        return 0;
    }

    function _fixCouponFrequency(product) {
        if (!product) return null;

        // v7.1 GUARD: Skip if already pre-annualized (prevents double-application)
        if (typeof product.coupon === 'object' && product.coupon !== null && product.coupon.annualized === true) {
            return null;
        }
        // v7.1 GUARD: Also check _freqFixApplied flag
        if (product._freqFixApplied) {
            return null;
        }

        var detected = _detectFreq(product);
        if (!detected) return null;

        var mult = FREQ_MULT[detected.freq];
        if (!mult || mult <= 1) return null;

        var rawRate = _getRate(product.coupon);
        if (rawRate <= 0) return null;

        var annual = Math.round(rawRate * mult * 1000) / 1000;

        // Sanity: if annualized > 25%, probably already annual
        if (annual > 25) return null;

        var oldCoupon = product.coupon;
        product.coupon = {
            rate: annual,
            frequency: 'annuel',
            annualized: true
        };
        if (typeof oldCoupon === 'object' && oldCoupon !== null) {
            if (oldCoupon.type) product.coupon.type = oldCoupon.type;
            if (oldCoupon.memory || oldCoupon.memoire) product.coupon.memory = oldCoupon.memory || oldCoupon.memoire;
            if (oldCoupon.paymentTiming) product.coupon.paymentTiming = oldCoupon.paymentTiming;
            if (oldCoupon.trigger) product.coupon.trigger = oldCoupon.trigger;
        }

        // v7.1: Mark product so we don't apply again
        product._freqFixApplied = true;

        console.log('[freq-fix v7.1] PRE-ANNUALIZED: ' + rawRate + '% x' + mult + ' (' + detected.freq + ' via ' + detected.src + ') = ' + annual + '%');

        return {
            applied: true,
            rawRate: rawRate,
            freq: detected.freq,
            mult: mult,
            annual: annual,
            src: detected.src
        };
    }

    function _patchResult(result, fixInfo) {
        if (!result || !fixInfo || !fixInfo.applied) return;

        if (result.metadata) {
            result.metadata.couponRaw = fixInfo.rawRate;
            result.metadata.couponMultiplier = fixInfo.mult;
            result.metadata.couponFrequency = fixInfo.freq;
            result.metadata.couponAnnualized = fixInfo.annual;
        }

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

        var _origGrade = ProposalGrader.grade;
        ProposalGrader.grade = function(product) {
            var fixInfo = _fixCouponFrequency(product);
            var resultPromise = _origGrade.call(this, product);

            if (resultPromise && typeof resultPromise.then === 'function') {
                return resultPromise.then(function(result) {
                    _patchResult(result, fixInfo);
                    return result;
                });
            }
            _patchResult(resultPromise, fixInfo);
            return resultPromise;
        };

        var _origNorm = ProposalGrader.normalize;
        ProposalGrader.normalize = function(product) {
            _fixCouponFrequency(product);
            return _origNorm.call(this, product);
        };

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

        console.log('[freq-fix v7.1] Patched ProposalGrader.grade + normalize + gradeBatch (anti-doublon guard)');
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

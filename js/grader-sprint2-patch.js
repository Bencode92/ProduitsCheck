// ═══════════════════════════════════════════════════════════════════════════════
// SPRINT 2 — P1 Important Fixes (Audit Expert)
//
// Fix 5: Step-down dynamic autocall probability (BS-based per threshold)
// Fix 6: Illiquidity premium ×2 (1.5% + 0.20%/an)
// Fix 7: Sizing proportionnel in optimizer (score-based allocation)
// Fix 8: Grading itératif (re-compute diversification after each alloc)
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    // Normal CDF (reuse from sprint1 if available, else define)
    var _ncdf = (typeof _normalCDF === 'function') ? _normalCDF : function(x) {
        var a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
        var sign=x<0?-1:1; var ax=Math.abs(x)/Math.sqrt(2);
        var t=1.0/(1.0+p*ax); var y=1.0-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-ax*ax);
        return 0.5*(1.0+sign*y);
    };

    function _patch() {
        // ========================================
        // FIX 5: Step-down dynamic autocall probability
        // Override _estimateExpectedMaturity to use BS-based
        // probability per observation date, adjusting for step-down
        // ========================================
        if (typeof _estimateExpectedMaturity === 'function') {
            var _origEstMat = _estimateExpectedMaturity;
            window._estimateExpectedMaturity = function(p) {
                var mm = p.maturityYears || 0;
                if (mm <= 0) return { expected: 0, max: 0, isEstimated: false };
                if (!p.autocall) return { expected: mm, max: mm, isEstimated: false };

                var th = p.autocallThreshold || 100;
                var obs = p.autocallObsPerYear || 1;
                var tot = Math.floor(mm * obs);
                if (tot <= 0) return { expected: mm, max: mm, isEstimated: false };

                // Get vol for BS calc
                var vol = 25; // default
                try {
                    if (typeof _mktCache !== 'undefined' && _mktCache && p.underlyings) {
                        var allStocks = [].concat(_mktCache.stocksEurope || [], _mktCache.stocksUS || [], _mktCache.stocksAsia || []);
                        p.underlyings.forEach(function(u) {
                            var tk = typeof _resolveAlias === 'function' ? _resolveAlias(u) : u.toUpperCase();
                            var s = allStocks.find(function(x) { return x.ticker === tk; });
                            if (s && s.volatility_3y && s.volatility_3y > vol) vol = s.volatility_3y;
                        });
                    }
                } catch(e) {}

                var sigma = vol / 100;
                var hasStepDown = p._hasStepDown || false;
                var stepDownPct = p._stepDownPct || 5; // default 5% step-down per period

                // First observation offset
                var fy = 1.0 / obs;
                if (fy < 0.5) fy = 1;
                if (p.startSemester > 1 && obs >= 2) fy = p.startSemester / obs;

                var em = 0, ps = 1.0;
                for (var i = 0; i < tot; i++) {
                    var dy = fy + (i / obs); // time to this observation
                    if (dy > mm) break;
                    if (dy <= 0) continue;

                    // Dynamic threshold for step-down
                    var currentThreshold = th;
                    if (hasStepDown && i > 0) {
                        // Step-down: threshold decreases over time
                        currentThreshold = Math.max(70, th - stepDownPct * Math.floor(i / obs));
                    }

                    // BS probability: P(S_t >= K) = N(d2)
                    // d2 = [ln(S/K) + (-sigma^2/2)*t] / (sigma*sqrt(t))
                    // S=100, K=currentThreshold -> ln(100/K)
                    var K = currentThreshold / 100;
                    var sqrtT = Math.sqrt(dy);
                    var d2 = (Math.log(1.0 / K) + (-sigma * sigma / 2) * dy) / (sigma * sqrtT);
                    var pc = _ncdf(d2);

                    // Worst-of adjustment
                    if (p.worstOf && p.underlyings && p.underlyings.length > 1) {
                        var n = p.underlyings.length;
                        // Approximate: P(all above K) = P(one above K)^sqrt(n) for correlated assets
                        pc = Math.pow(pc, Math.sqrt(n));
                    }

                    // Cap between 5% and 80%
                    pc = Math.max(0.05, Math.min(0.80, pc));

                    var ph = ps * pc;
                    em += ph * dy;
                    ps *= (1 - pc);
                }
                em += ps * mm; // remaining probability goes to full maturity
                em = Math.round(em * 10) / 10;

                return {
                    expected: em,
                    max: mm,
                    isEstimated: true,
                    probCallPerDate: Math.round(pc * 100), // last pc
                    probReachMaturity: Math.round(ps * 100),
                    totalObsDates: tot,
                    _method: 'bs-stepdown'
                };
            };
            // Also update the export
            if (typeof ProposalGrader !== 'undefined') {
                ProposalGrader.estimateExpectedMaturity = window._estimateExpectedMaturity;
            }
            console.log('[sprint2] FIX 5: Step-down dynamic autocall probability (BS-based)');
        }

        // ========================================
        // FIX 6: Illiquidity premium ×2
        // Override _computeP4 to use higher illiquidity premium
        // Old: 0.5 + 0.10*(T-2) -> for 5Y = 0.8%
        // New: 1.5 + 0.20*(T-2) -> for 5Y = 2.1%
        // Approach: Patch _computeP4 indirectly via P4 score adjustment
        // ========================================
        // We patch the optimizer and grading indirectly since _computeP4 is closured.
        // Add a post-processing step in gradeProposal result
        if (typeof ProposalGrader !== 'undefined' && ProposalGrader.grade) {
            var _origGrade = ProposalGrader.grade;
            if (!_origGrade._sprint2Patched) {
                ProposalGrader.grade = function(product) {
                    var resultPromise = _origGrade.call(this, product);
                    if (resultPromise && typeof resultPromise.then === 'function') {
                        return resultPromise.then(function(result) {
                            _applyIlliquidityPenalty(result, product);
                            return result;
                        });
                    }
                    _applyIlliquidityPenalty(resultPromise, product);
                    return resultPromise;
                };
                ProposalGrader.grade._sprint2Patched = true;
                console.log('[sprint2] FIX 6: Illiquidity premium x2 (post-process P4)');
            }
        }

        // FIX 7+8 REMOVED: sprint2's _proportionalAllocation used score^1.3 sizing
        // that ignored vol and BS rendement. Optimizer v5 handles sizing properly
        // with inverse-vol weighting and BS gate.

        console.log('[sprint2] FIX 5+6 applied (maturity BS + illiquidity)');
        return true;
    }

    // ========================================
    // FIX 6 HELPER: Apply illiquidity penalty to P4
    // Old premium: 0.5 + 0.10*(T-2) = 0.8% for 5Y
    // New premium: 1.5 + 0.20*(T-2) = 2.1% for 5Y
    // Delta: 1.3% for 5Y -> ~6-10 P4 points reduction
    // ========================================
    function _applyIlliquidityPenalty(result, product) {
        if (!result || !result.pillars || !result.pillars.riskPremium) return;
        if (!result.metadata) return;

        var type = result.metadata.productType || '';
        // Don't apply to liquidity products or taux fixe (already short duration)
        if (type === 'liquidity' || type === 'taux_fixe') return;
        // Don't apply to capital garanti (lower lockup risk)
        if (result.metadata.barrierPct === 0 && type === 'capital_garanti') return;

        // Swiss Life mode: reduced illiquidity penalty (long-term envelope)
        var isSL = result.metadata.envelopeMode === 'swiss-life';

        var T = result.metadata.maxMaturity || result.metadata.expectedMaturity || 5;
        if (T <= 1) return; // no penalty for very short products

        // Old illiquidity premium was: 0.5 + 0.10 * max(0, T-2)
        var oldPremium = 0.5 + 0.10 * Math.max(0, T - 2);
        // New illiquidity premium: 1.5 + 0.20 * max(0, T-2)
        var newPremium = 1.5 + 0.20 * Math.max(0, T - 2);
        var deltaPremium = newPremium - oldPremium;

        // Swiss Life: halve the illiquidity penalty (long-term = lower liquidity need)
        if (isSL) deltaPremium *= 0.5;

        // Convert premium delta to score delta (~5 pts per 1% premium)
        var scoreDelta = Math.round(deltaPremium * 5);
        scoreDelta = Math.min(scoreDelta, isSL ? 5 : 10);

        // Apply to P4
        var p4 = result.pillars.riskPremium;
        var oldP4 = p4.score;
        p4.score = Math.max(0, p4.score - scoreDelta);
        result.metadata._illiqApplied = true; // idempotence : v7 ne ré-appliquera pas l'illiquidité (fini le double compte ; version SL-réduite conservée)

        if (scoreDelta > 0 && p4.reasoning) {
            p4.reasoning += ' | Illiq. premium +' + deltaPremium.toFixed(1) + '% (-' + scoreDelta + 'pts)' + (isSL ? ' [SL réduit]' : '');
        }

        // Use v7 weights if available (respect Swiss Life weights)
        var w = (result.metadata.v6Weights) ? {
            adjustedReturn: result.metadata.v6Weights.p1,
            underlyingQuality: result.metadata.v6Weights.p2,
            portfolioFit: result.metadata.v6Weights.p3,
            riskPremium: result.metadata.v6Weights.p4
        } : (result.metadata.isInPortfolio ?
            { adjustedReturn: 0.35, underlyingQuality: 0.35, portfolioFit: 0, riskPremium: 0.30 } :
            { adjustedReturn: 0.25, underlyingQuality: 0.20, portfolioFit: 0.25, riskPremium: 0.30 });

        var newTotal = Math.round(
            (result.pillars.adjustedReturn.score || 0) * w.adjustedReturn +
            (result.pillars.underlyingQuality.score || 0) * w.underlyingQuality +
            (result.pillars.portfolioFit.score || 0) * w.portfolioFit +
            p4.score * w.riskPremium
        );

        var oldTotal = result.score;
        result.score = newTotal;
        result.grade = newTotal >= 75 ? 'A' : newTotal >= 60 ? 'B' : newTotal >= 45 ? 'C' : newTotal >= 25 ? 'D' : 'F';

        if (oldTotal !== newTotal) {
            console.log('[sprint2] Illiquidity: P4 ' + oldP4 + '→' + p4.score + ' (-' + scoreDelta + '), total ' + oldTotal + '→' + newTotal);
        }
    }

    // Apply patches when ready
    function _tryPatch() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;
        return _patch();
    }

    if (!_tryPatch()) {
        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            if (_tryPatch() || attempts > 100) clearInterval(iv);
        }, 200);
    }
})();

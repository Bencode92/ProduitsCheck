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
                        var allStocks = [].concat(_mktCache.stocksEurope || [], _mktCache.stocksUS || []);
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

        // ========================================
        // FIX 7+8: Sizing proportionnel + grading itératif
        // Override buildStructuredOptimization
        // ========================================
        if (typeof buildStructuredOptimization === 'function') {
            var _origBuild = window.buildStructuredOptimization;
            // Check if sprint1 already wrapped it
            var _baseBuild = _origBuild;

            window.buildStructuredOptimization = function() {
                // Run the base (which may include sprint1 expected return fix)
                var result = _baseBuild();

                // Re-process allocation with proportional sizing + iterative diversification
                if (result.allocationPlan && result.allocationPlan.length > 0 && result.totalLiquidity > 0) {
                    var newPlan = _proportionalAllocation(result.allocationPlan, result.totalLiquidity, result.catBenchmark || 2.5);
                    result.allocationPlan = newPlan;

                    // Recalculate deployed totals
                    result.deployedAmount = newPlan.reduce(function(s, a) { return s + a.allocatedAmount; }, 0);
                    result.deployedReturn = newPlan.reduce(function(s, a) { return s + a.annualReturn; }, 0);
                    result.deployedCatReturn = Math.round(result.deployedAmount * (result.catBenchmark || 2.5) / 100);
                    result.deployedExcess = result.deployedReturn - result.deployedCatReturn;
                    result.remainingCash = result.totalLiquidity - result.deployedAmount;
                }

                return result;
            };
            console.log('[sprint2] FIX 7+8: Proportional sizing + iterative diversification');
        }

        console.log('[sprint2] All 4 P1 fixes applied');
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

        var T = result.metadata.maxMaturity || result.metadata.expectedMaturity || 5;
        if (T <= 1) return; // no penalty for very short products

        // Old illiquidity premium was: 0.5 + 0.10 * max(0, T-2)
        var oldPremium = 0.5 + 0.10 * Math.max(0, T - 2);
        // New illiquidity premium: 1.5 + 0.20 * max(0, T-2)
        var newPremium = 1.5 + 0.20 * Math.max(0, T - 2);
        var deltaPremium = newPremium - oldPremium; // ~1.0-1.3% for typical products

        // Convert premium delta to score delta (~5 pts per 1% premium)
        var scoreDelta = Math.round(deltaPremium * 5);
        scoreDelta = Math.min(scoreDelta, 10); // cap at -10

        // Apply to P4
        var p4 = result.pillars.riskPremium;
        var oldP4 = p4.score;
        p4.score = Math.max(0, p4.score - scoreDelta);

        if (scoreDelta > 0 && p4.reasoning) {
            p4.reasoning += ' | Illiq. premium +' + deltaPremium.toFixed(1) + '% (-' + scoreDelta + 'pts)';
        }

        // Recalculate total score
        var w = result.metadata.isInPortfolio ?
            { adjustedReturn: 0.35, underlyingQuality: 0.35, portfolioFit: 0, riskPremium: 0.30 } :
            { adjustedReturn: 0.30, underlyingQuality: 0.25, portfolioFit: 0.20, riskPremium: 0.25 };

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

    // ========================================
    // FIX 7+8: Proportional allocation + iterative diversification
    // ========================================
    function _proportionalAllocation(originalPlan, totalLiquidity, catRate) {
        // Step 1: Filter eligible products (score >= 45)
        var eligible = originalPlan.filter(function(a) { return a.score >= 45; });
        var rejected = originalPlan.filter(function(a) { return a.score < 45; });

        // Step 2: Calculate allocation weights based on score
        // weight = ((score - 45) / 55)^1.3  -> 0 at 45, ~1.0 at 100
        eligible.forEach(function(a) {
            a._allocWeight = Math.pow(Math.max(0, (a.score - 45) / 55), 1.3);
        });

        // Step 3: Iterative allocation with diversification check
        var remaining = totalLiquidity;
        var maxPerProduct = totalLiquidity * 0.35; // cap: 35% of liquidity per product
        var minCash = totalLiquidity * 0.10; // keep 10% as cash reserve
        var deployable = totalLiquidity - minCash;
        var allocatedUnderlyings = []; // track for diversification

        // Sort by score descending
        eligible.sort(function(a, b) { return b.score - a.score; });

        eligible.forEach(function(a) {
            if (deployable <= 0) {
                a.allocatedAmount = 0;
                a.recommendation = 'ATTENDRE';
                a.reason = 'Liquidité épuisée';
                return;
            }

            // FIX 8: Diversification score
            var divPenalty = _calcDivPenalty(a, allocatedUnderlyings);
            var adjustedWeight = a._allocWeight * (1 - divPenalty * 0.5); // reduce weight by overlap

            // Proportional amount
            var totalWeight = eligible.reduce(function(s, x) { return s + (x._allocWeight || 0); }, 0);
            var shareOfPool = totalWeight > 0 ? (adjustedWeight / totalWeight) : 0;
            var targetAmount = Math.round(deployable * shareOfPool);

            // Apply caps
            targetAmount = Math.min(targetAmount, maxPerProduct);
            targetAmount = Math.min(targetAmount, deployable);

            // Use product nominal as hint if available
            if (a.nominal > 0 && a.nominal < targetAmount) {
                targetAmount = a.nominal;
            }

            // Round to nearest 1000
            targetAmount = Math.round(targetAmount / 1000) * 1000;
            if (targetAmount < 5000) targetAmount = 0; // minimum 5K

            a.allocatedAmount = targetAmount;
            deployable -= targetAmount;

            // Determine recommendation
            if (targetAmount > 0 && a.score >= 60) {
                a.recommendation = 'SOUSCRIRE';
            } else if (targetAmount > 0 && a.score >= 50) {
                a.recommendation = 'ENVISAGER';
            } else if (a.score >= 45) {
                a.recommendation = 'ATTENDRE';
            } else {
                a.recommendation = 'REJETER';
            }

            // Recalculate returns (use expected returns from sprint1 if available)
            var probCoupon = 0.70;
            try {
                var allProposals = [];
                Object.values(app.state.proposals || {}).forEach(function(arr) {
                    arr.forEach(function(p) { allProposals.push(p); });
                });
                var prop = allProposals.find(function(x) { return x.id === a.id; });
                if (prop && typeof ProposalGrader !== 'undefined') {
                    var norm = ProposalGrader.normalize(prop);
                    if (norm && typeof _estimateCouponProb === 'function') {
                        probCoupon = _estimateCouponProb(norm);
                    }
                }
            } catch(e) {}

            a.annualReturn = Math.round(targetAmount * a.coupon / 100 * probCoupon);
            a.catReturn = Math.round(targetAmount * catRate / 100);
            a.excessVsCat = a.annualReturn - a.catReturn;

            // Build reason string
            if (a.recommendation === 'SOUSCRIRE') {
                var exSign = a.excessVsCat >= 0 ? '+' : '';
                a.reason = 'Grade ' + a.grade + ' (' + a.score + ') | ' +
                    (typeof formatNumber === 'function' ? formatNumber(targetAmount) : targetAmount) + '€' +
                    ' | E[ret] ' + (typeof formatNumber === 'function' ? formatNumber(a.annualReturn) : a.annualReturn) + '€/an' +
                    ' (prob ' + Math.round(probCoupon * 100) + '%)' +
                    (divPenalty > 0 ? ' | ⚠ overlap -' + Math.round(divPenalty * 100) + '%' : '');
            } else if (a.recommendation === 'ENVISAGER') {
                a.reason = 'Grade ' + a.grade + ' (' + a.score + ') — négocier ou attendre meilleure offre';
            } else if (a.recommendation === 'ATTENDRE') {
                a.reason = 'Grade ' + a.grade + ' (' + a.score + ') — rendement ajusté insuffisant';
            } else {
                a.reason = 'Grade ' + a.grade + ' — garder en CAT';
            }

            // FIX 8: Track allocated underlyings for next iteration
            if (targetAmount > 0) {
                var und = _getUnderlyings(a);
                und.forEach(function(u) {
                    if (allocatedUnderlyings.indexOf(u) < 0) allocatedUnderlyings.push(u);
                });
            }
        });

        // Mark rejected products
        rejected.forEach(function(a) {
            a.allocatedAmount = 0;
            a.annualReturn = 0;
            a.catReturn = 0;
            a.excessVsCat = 0;
            a.recommendation = a.score >= 25 ? 'ATTENDRE' : 'REJETER';
            a.reason = 'Grade ' + a.grade + ' (' + a.score + ') — ' +
                (a.score < 25 ? 'risque trop élevé' : 'rendement insuffisant pour le risque');
        });

        // Combine and sort: SOUSCRIRE first, then ENVISAGER, ATTENDRE, REJETER
        var all = eligible.concat(rejected);
        var order = { 'SOUSCRIRE': 0, 'ENVISAGER': 1, 'ATTENDRE': 2, 'REJETER': 3 };
        all.sort(function(a, b) {
            var oa = order[a.recommendation] || 3, ob = order[b.recommendation] || 3;
            if (oa !== ob) return oa - ob;
            return b.score - a.score;
        });

        return all;
    }

    // Get underlyings from an allocation item
    function _getUnderlyings(a) {
        try {
            var allProposals = [];
            Object.values(app.state.proposals || {}).forEach(function(arr) {
                arr.forEach(function(p) { allProposals.push(p); });
            });
            var prop = allProposals.find(function(x) { return x.id === a.id; });
            if (prop) {
                var und = prop.underlyings || (prop.aiParsed && prop.aiParsed.underlyings) || [];
                if (typeof und === 'string') return [und];
                if (Array.isArray(und)) return und.map(function(u) { return (typeof u === 'string' ? u : u.name || u.ticker || '').toUpperCase(); }).filter(Boolean);
            }
        } catch(e) {}
        return [];
    }

    // FIX 8: Calculate diversification penalty (0 = no overlap, 1 = full overlap)
    function _calcDivPenalty(alloc, allocatedUnderlyings) {
        if (allocatedUnderlyings.length === 0) return 0;
        var und = _getUnderlyings(alloc);
        if (und.length === 0) return 0;

        var overlapCount = 0;
        und.forEach(function(u) {
            // Check direct match
            if (allocatedUnderlyings.indexOf(u) >= 0) {
                overlapCount++;
                return;
            }
            // Check group correlation
            if (typeof _getUndGroup === 'function') {
                var g1 = _getUndGroup(u);
                var maxCorr = 0;
                allocatedUnderlyings.forEach(function(au) {
                    var g2 = _getUndGroup(au);
                    var corr = (typeof _getGrpCorr === 'function') ? _getGrpCorr(g1, g2) : 0.50;
                    if (corr > maxCorr) maxCorr = corr;
                });
                if (maxCorr >= 0.85) overlapCount += 0.8; // high correlation = near-overlap
                else if (maxCorr >= 0.70) overlapCount += 0.4;
            }
        });

        return Math.min(1.0, overlapCount / Math.max(1, und.length));
    }

    // Apply patches when ready
    function _tryPatch() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;
        if (typeof buildStructuredOptimization !== 'function') return false;
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

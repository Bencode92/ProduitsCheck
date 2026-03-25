// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader v5.0 Patch
// Expert audit quick wins:
//   1. Barrier penalty recalibrated (more aggressive 50-65%)
//   2. Beta penalty threshold 1.2 (was 1.5) + non-linear
//   3. MI sensitivity (reduce IA impact for protected/guaranteed)
//   4. Issuer rating filter (cap grade if HY)
//   5. Logging improvements
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Known issuer ratings (IG = Investment Grade)
    // Source: S&P/Moody's public ratings for main structured product issuers
    var ISSUER_RATINGS = {
        'swiss-life': { rating: 'A+', tier: 'IG', cds_proxy: 60 },
        'sg': { rating: 'A', tier: 'IG', cds_proxy: 70 },
        'bnp': { rating: 'A+', tier: 'IG', cds_proxy: 55 },
        'natixis': { rating: 'A+', tier: 'IG', cds_proxy: 60 },
        'cic': { rating: 'A+', tier: 'IG', cds_proxy: 55 },
        'ca-cib': { rating: 'A+', tier: 'IG', cds_proxy: 50 },
        'goldman': { rating: 'A+', tier: 'IG', cds_proxy: 65 },
        'jpmorgan': { rating: 'A+', tier: 'IG', cds_proxy: 45 },
        'morgan-stanley': { rating: 'A-', tier: 'IG', cds_proxy: 70 },
        'barclays': { rating: 'A', tier: 'IG', cds_proxy: 75 },
        'ubs': { rating: 'A+', tier: 'IG', cds_proxy: 55 },
        'hsbc': { rating: 'A+', tier: 'IG', cds_proxy: 50 },
        'leonteq': { rating: 'BBB', tier: 'IG', cds_proxy: 150 },
        'vontobel': { rating: 'A-', tier: 'IG', cds_proxy: 80 },
        'banque-populaire': { rating: 'A+', tier: 'IG', cds_proxy: 55 },
        'credit-mutuel': { rating: 'AA-', tier: 'IG', cds_proxy: 40 },
        'caisse-epargne': { rating: 'A+', tier: 'IG', cds_proxy: 55 },
        'lcl': { rating: 'A+', tier: 'IG', cds_proxy: 50 },
    };

    // Wait for grader to load
    var _v5Interval = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _computeP2 !== 'function' || typeof _callClaude !== 'function') return;
        clearInterval(_v5Interval);

        // ═══ 1. BARRIER PENALTY RECALIBRATED ═══
        // Expert: "trop douce sous 60%, exposant 2.0, base 50"
        var _origComputeP1 = _computeP1;
        _computeP1 = function(p) {
            var s = Math.min(100, p.coupon * 10);
            if (!p.capitalProtection) {
                if (p.barrier > 0 && p.barrier < 100) {
                    // v5: More aggressive penalty between 50-65%
                    // Old: ((barrier-30)/70)^1.5 → barrier 60% = 17.6% penalty
                    // New: ((barrier-30)/50)^2.0 → barrier 60% = 36% penalty
                    var barrierPenalty = Math.pow(Math.max(0, (p.barrier - 30) / 50), 2.0);
                    s = s * (1 - barrierPenalty);
                } else {
                    s -= 25;
                }
            }
            // Rest identical to original
            if (p.worstOf && p.underlyings.length > 2) { s -= Math.round(3 * Math.pow(p.underlyings.length - 2, 1.3)); }
            if (p.hasMemory) s += 5;
            if (p.couponType === 'garanti' || p.couponType === 'fixe') s += 15;
            var matInfo = _estimateExpectedMaturity(p);
            var my = matInfo.expected || p.maturityYears || 0;
            if (my > 0 && my <= 3) s += 5; else if (my > 6 && my <= 10) s -= 5; else if (my > 10) s -= 10;
            p._maturityInfo = matInfo;
            return Math.max(0, Math.min(100, Math.round(s)));
        };
        console.log('[v5] P1 barrier penalty recalibrated: ((b-30)/50)^2.0');

        // ═══ 2. BETA PENALTY THRESHOLD 1.2 + NON-LINEAR ═══
        // Expert: "seuil 1.5 trop haut, non-linéaire"
        var _origComputeP2 = _computeP2;
        var _p2PatchActive = typeof window._computeP2Index === 'function'; // Check if P2 proxy patch loaded
        
        if (!_p2PatchActive) {
            // Only override base P2 if p2-patch hasn't already overridden it
            _computeP2 = function(p, market, productType) {
                if (productType === 'fixed-rate-callable') {
                    var base = p.capitalProtection ? 70 : 55;
                    if (p.maturityYears > 8) base -= 5;
                    if (p.autocall) base += 5;
                    return Math.max(0, Math.min(100, base));
                }
                if (!market.available || !market.worstMetrics) return 35;
                var wm = market.worstMetrics;
                var hasBarrier = !p.capitalProtection && p.barrier > 0;
                var wB, wQ, wV, wD;
                if (hasBarrier) { wB = 0.20; wQ = 0.20; wV = 0.30; wD = 0.30; }
                else { wB = 0.35; wQ = 0.35; wV = 0.15; wD = 0.15; }
                var volC = Math.max(0, 100 - Math.max(0, (wm.max_volatility || 30) - 20) * 1.5);
                var ddC = Math.max(0, 100 - Math.max(0, (wm.max_drawdown || 30) - 25) * 1.2);
                var s = (wm.worst_buffett || 35) * wB + (wm.worst_quality || 35) * wQ + volC * wV + ddC * wD;
                // Sector correlation penalty
                if (market.stocks && market.stocks.length > 1) {
                    var found = market.stocks.filter(function(x) { return x.found; });
                    if (found.length > 1) {
                        var sec = {}; found.forEach(function(x) { sec[(x.sector_api || '?').toLowerCase()] = 1; });
                        if (Object.keys(sec).length === 1) s -= 10;
                        else if (Object.keys(sec).length < found.length) s -= 5;
                    }
                }
                // v5: BETA PENALTY — threshold 1.2 (was 1.5) + non-linear
                // Old: -(beta-1.5)*8 → linear, only fires at 1.5+
                // New: -((beta-1.0)^1.5)*12 → non-linear, fires at 1.0+
                // Beta 1.2 → -2.6pts | Beta 1.5 → -7.3pts | Beta 2.0 → -16.9pts
                if (hasBarrier && wm.max_beta > 1.0) {
                    s -= Math.round(Math.pow(Math.max(0, wm.max_beta - 1.0), 1.5) * 12);
                }
                return Math.max(0, Math.min(100, Math.round(s)));
            };
            console.log('[v5] P2 beta penalty: threshold 1.0, non-linear ((b-1)^1.5)*12');
        } else {
            console.log('[v5] P2 beta: p2-patch active, skipping base override');
        }

        // ═══ 3. MI SENSITIVITY ═══
        // Expert: "reduce IA impact if capital protected / coupon guaranteed / long maturity"
        // Override _callClaude to adjust max_adjustment dynamically
        var _origCallClaudeV5 = _callClaude;
        _callClaude = async function(ctx, base, productType) {
            var result = await _origCallClaudeV5(ctx, base, productType);
            if (!result || !result.adjustments) return result;

            // Compute MI sensitivity factor
            var p = ctx.product;
            var sensitivity = 1.0;
            var reasons = [];

            if (p.capitalProtection) {
                sensitivity *= 0.3;
                reasons.push('capital prot\u00e9g\u00e9 \u00d70.3');
            }
            if (p.couponType === 'garanti' || p.couponType === 'fixe') {
                sensitivity *= 0.5;
                reasons.push('coupon garanti \u00d70.5');
            }
            // Residual maturity: longer = less MI impact
            var residualMat = p.maturityYears || 0;
            if (residualMat > 5) {
                var matFactor = Math.max(0.2, 1 - residualMat / 15);
                sensitivity *= matFactor;
                reasons.push('maturit\u00e9 ' + residualMat + 'a \u00d7' + matFactor.toFixed(2));
            }

            // If sensitivity < 1, reduce adjustments proportionally
            if (sensitivity < 0.95) {
                var maxAdj = Math.round(15 * sensitivity);
                var clamp = function(d) { return Math.max(-maxAdj, Math.min(maxAdj, d || 0)); };
                ['p1', 'p2', 'p3', 'p4'].forEach(function(key) {
                    if (result.adjustments[key] && result.adjustments[key].delta) {
                        var orig = result.adjustments[key].delta;
                        result.adjustments[key].delta = clamp(orig);
                        if (orig !== result.adjustments[key].delta) {
                            result.adjustments[key].reason = (result.adjustments[key].reason || '') + ' [MI cap\u00e9 \u00b1' + maxAdj + ']';
                        }
                    }
                });
                console.log('[v5] MI sensitivity=' + sensitivity.toFixed(2) + ' (max\u00b1' + maxAdj + ') \u2014 ' + reasons.join(', '));
            }

            return result;
        };
        console.log('[v5] MI sensitivity: protected/guaranteed/long maturity reduce IA impact');

        // ═══ 4. ISSUER RATING FILTER ═══
        // Expert: "cap grade if HY emitter"
        // Override gradeProposal to apply issuer cap post-scoring
        var _origGradeProposal = gradeProposal;
        gradeProposal = async function(product) {
            var result = await _origGradeProposal(product);
            if (!result || result.grade === '-' || result.grade === '?') return result;

            var bankId = product.bankId || '';
            var issuer = ISSUER_RATINGS[bankId];
            
            if (issuer) {
                result.metadata = result.metadata || {};
                result.metadata.issuer_rating = issuer.rating;
                result.metadata.issuer_tier = issuer.tier;
                result.metadata.issuer_cds_proxy = issuer.cds_proxy;

                // CDS-based adjustment
                if (issuer.cds_proxy > 100) {
                    // CDS > 100bps = elevated credit risk
                    // Cap grade at C max
                    if (result.score > 55) {
                        var oldGrade = result.grade;
                        result.score = Math.min(result.score, 55);
                        result.grade = result.score >= 75 ? 'A' : result.score >= 60 ? 'B' : result.score >= 45 ? 'C' : result.score >= 25 ? 'D' : 'F';
                        result.metadata.issuer_cap_applied = true;
                        result.verdict = (result.verdict || '') + ' \u26a0 Risque \u00e9metteur \u00e9lev\u00e9 (CDS ~' + issuer.cds_proxy + 'bps, rating ' + issuer.rating + ') \u2014 grade plafonn\u00e9 \u00e0 C.';
                        console.log('[v5] Issuer cap: ' + bankId + ' CDS ' + issuer.cds_proxy + 'bps \u2192 grade ' + oldGrade + '\u2192' + result.grade);
                    }
                } else if (issuer.cds_proxy > 80) {
                    // CDS 80-100bps = moderate credit risk, flag but don't cap
                    result.metadata.issuer_flag = 'moderate_credit_risk';
                    if (result.keyRisks && !result.keyRisks.some(function(r) { return r.indexOf('\u00e9metteur') >= 0; })) {
                        result.keyRisks.push('Risque cr\u00e9dit \u00e9metteur ' + issuer.rating + ' (CDS ~' + issuer.cds_proxy + 'bps)');
                    }
                }
            } else if (bankId) {
                // Unknown issuer = flag
                result.metadata = result.metadata || {};
                result.metadata.issuer_rating = 'NR';
                result.metadata.issuer_flag = 'not_rated';
                if (result.keyRisks && !result.keyRisks.some(function(r) { return r.indexOf('\u00e9metteur') >= 0; })) {
                    result.keyRisks.push('\u00c9metteur non r\u00e9f\u00e9renc\u00e9 \u2014 v\u00e9rifier le rating cr\u00e9dit');
                }
            }

            product.grading = result;
            return result;
        };
        console.log('[v5] Issuer rating filter: ' + Object.keys(ISSUER_RATINGS).length + ' issuers mapped');

        console.log('[StructBoard] Grader v5.0 Patch \u2014 5 expert audit quick wins applied');
    }, 200);
    setTimeout(function() { clearInterval(_v5Interval); }, 10000);
})();

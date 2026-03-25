// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader v5.0b Patch
// Expert audit items #6, #7, #8:
//   6. Confidence interval: "B [58-72]" instead of "B 65"
//   7. Correlation SJ in P3: Eurostoxx + CAC40 = overlap
//   8. Vol implicite light: VIX vs realized vol penalty
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ 7. CORRELATION MATRIX FOR P3 ═══
    // Maps underlying names to correlation groups
    // Same group = high correlation = NOT diversification
    var UNDERLYING_CORR_GROUPS = {
        // European equity indices (correlation ~0.90-0.98)
        'eurostoxx 50': 'eu-equity-core',
        'euro stoxx 50': 'eu-equity-core',
        'stoxx 50': 'eu-equity-core',
        'sx5e': 'eu-equity-core',
        'cac 40': 'eu-equity-core',
        'cac40': 'eu-equity-core',
        'dax': 'eu-equity-core',
        'dax 40': 'eu-equity-core',
        'stoxx europe 600': 'eu-equity-core',
        'msci europe': 'eu-equity-core',
        'ftse mib': 'eu-equity-periphery',
        'ibex 35': 'eu-equity-periphery',
        // UK (correlated but not identical to EU)
        'ftse 100': 'uk-equity',
        'ftse100': 'uk-equity',
        // US equity (high intra-correlation)
        's&p 500': 'us-equity',
        's&p500': 'us-equity',
        'sp500': 'us-equity',
        'nasdaq 100': 'us-equity-tech',
        'nasdaq100': 'us-equity-tech',
        'nasdaq': 'us-equity-tech',
        'dow jones': 'us-equity',
        'russell 2000': 'us-equity-small',
        // Asia
        'nikkei 225': 'japan-equity',
        'nikkei': 'japan-equity',
        'hang seng': 'china-equity',
        'kospi': 'korea-equity',
        'taiex': 'taiwan-equity',
        'sensex': 'india-equity',
        'nifty 50': 'india-equity',
        // Commodities (decorrelated)
        'or': 'gold',
        'gold': 'gold',
        'xau': 'gold',
        'argent': 'silver',
        'silver': 'silver',
        'p\u00e9trole': 'oil',
        'brent': 'oil',
        'wti': 'oil',
    };

    // Cross-group correlation (0-1, higher = less diversification)
    var GROUP_CORRELATIONS = {
        'eu-equity-core|eu-equity-core': 0.95,
        'eu-equity-core|eu-equity-periphery': 0.85,
        'eu-equity-core|uk-equity': 0.80,
        'eu-equity-core|us-equity': 0.75,
        'eu-equity-core|us-equity-tech': 0.70,
        'eu-equity-core|us-equity-small': 0.65,
        'eu-equity-core|japan-equity': 0.55,
        'eu-equity-core|china-equity': 0.40,
        'eu-equity-core|gold': 0.05,
        'eu-equity-core|oil': 0.30,
        'eu-equity-periphery|eu-equity-periphery': 0.90,
        'us-equity|us-equity': 0.95,
        'us-equity|us-equity-tech': 0.90,
        'us-equity|us-equity-small': 0.85,
        'us-equity|japan-equity': 0.55,
        'us-equity|gold': 0.05,
        'us-equity|oil': 0.25,
        'us-equity-tech|us-equity-tech': 0.95,
        'japan-equity|korea-equity': 0.65,
        'japan-equity|taiwan-equity': 0.60,
        'gold|gold': 1.0,
        'gold|silver': 0.80,
        'gold|oil': 0.20,
        'oil|oil': 1.0,
    };

    function _getGroupCorrelation(g1, g2) {
        if (g1 === g2) return 1.0;
        var key1 = g1 + '|' + g2;
        var key2 = g2 + '|' + g1;
        return GROUP_CORRELATIONS[key1] || GROUP_CORRELATIONS[key2] || 0.50;
    }

    function _getUnderlyingGroup(name) {
        var norm = (name || '').toLowerCase().replace(/[\u00e9\u00e8\u00ea]/g, 'e').trim();
        if (UNDERLYING_CORR_GROUPS[norm]) return UNDERLYING_CORR_GROUPS[norm];
        // Fuzzy match
        for (var key in UNDERLYING_CORR_GROUPS) {
            if (norm.indexOf(key) >= 0 || key.indexOf(norm) >= 0) return UNDERLYING_CORR_GROUPS[key];
        }
        // For individual stocks, use sector from market data
        return 'unknown-' + norm.substring(0, 10);
    }

    // ═══ 6. CONFIDENCE INTERVAL CALCULATION ═══
    function _computeConfidenceInterval(result, ctx) {
        var score = result.score;
        if (score === null || score === undefined) return null;

        // Base uncertainty: ±5 points
        var halfWidth = 5;

        // IA used: adds uncertainty (±3 extra)
        if (result.metadata && result.metadata.aiUsed) {
            halfWidth += 3;
        }

        // Proxy data (not direct stock data): adds uncertainty (±2 extra)
        if (ctx && ctx.market && ctx.market.stocks) {
            var hasProxy = ctx.market.stocks.some(function(s) { return s._proxyType; });
            if (hasProxy) halfWidth += 2;
        }

        // No market data at all: wider interval (±4 extra)
        if (!ctx || !ctx.market || !ctx.market.available) {
            halfWidth += 4;
        }

        // Worst-of multi-underlying: more uncertainty (±1 per extra SJ)
        var p = ctx ? ctx.product : null;
        if (p && p.worstOf && p.underlyings && p.underlyings.length > 1) {
            halfWidth += Math.min(4, p.underlyings.length - 1);
        }

        // MI sensitivity reduced (v5 patch): narrower interval for safe products
        if (p && p.capitalProtection) halfWidth = Math.round(halfWidth * 0.7);
        if (p && (p.couponType === 'garanti' || p.couponType === 'fixe')) halfWidth = Math.round(halfWidth * 0.8);

        var low = Math.max(0, score - halfWidth);
        var high = Math.min(100, score + halfWidth);

        // Determine grade range
        var gradeLow = high >= 75 ? 'A' : high >= 60 ? 'B' : high >= 45 ? 'C' : high >= 25 ? 'D' : 'F';
        var gradeHigh = low >= 75 ? 'A' : low >= 60 ? 'B' : low >= 45 ? 'C' : low >= 25 ? 'D' : 'F';
        var gradeStable = (gradeLow === gradeHigh);

        return {
            low: low,
            high: high,
            halfWidth: halfWidth,
            gradeStable: gradeStable,
            gradeRange: gradeStable ? result.grade : gradeHigh + '-' + gradeLow,
            label: result.grade + ' [' + low + '-' + high + ']',
        };
    }

    // Wait for grader to load
    var _v5bInterval = setInterval(function() {
        if (typeof _computeP3 !== 'function' || typeof gradeProposal !== 'function' || typeof renderGradingSection !== 'function') return;
        clearInterval(_v5bInterval);

        // ═══ 7. OVERRIDE P3 WITH CORRELATION AWARENESS ═══
        var _origComputeP3 = _computeP3;
        _computeP3 = function(p, portfolio, isInPf) {
            if (isInPf) return 70;
            if (!portfolio || !portfolio.available) return 70;
            var s = 70;

            // Get correlation groups of new product's underlyings
            var newGroups = (p.underlyings || []).map(function(u) { return _getUnderlyingGroup(u); });

            // Get existing underlyings and their groups
            var existingUnderlyings = portfolio.existingUnderlyings || [];
            var existingGroups = existingUnderlyings.map(function(u) { return _getUnderlyingGroup(u); });

            // Check for EXACT overlap (same underlying)
            var exactOverlap = (portfolio.overlappingUnderlyings || []);
            for (var i = 0; i < exactOverlap.length; i++) {
                s -= 10 + (i * 5);
            }

            // Check for CORRELATED overlap (e.g., Eurostoxx + CAC40)
            // Only penalize if not already counted as exact overlap
            var correlatedPenalty = 0;
            newGroups.forEach(function(newGrp) {
                existingGroups.forEach(function(existGrp) {
                    // Skip if this was already an exact overlap
                    var isExact = exactOverlap.some(function(o) {
                        return _getUnderlyingGroup(o) === newGrp;
                    });
                    if (isExact) return;

                    var corr = _getGroupCorrelation(newGrp, existGrp);
                    if (corr >= 0.85) {
                        // Quasi-identical (e.g., CAC40 + Eurostoxx)
                        correlatedPenalty += 8;
                        console.log('[v5b] P3 correlation: ' + newGrp + ' \u2194 ' + existGrp + ' corr=' + corr + ' \u2192 -8pts');
                    } else if (corr >= 0.70) {
                        // High correlation (e.g., Eurostoxx + S&P)
                        correlatedPenalty += 4;
                    }
                });
            });
            s -= Math.min(20, correlatedPenalty); // Cap at -20

            // Bonus for new (decorrelated) underlying
            var newU = (p.underlyings || []).filter(function(u) {
                var grp = _getUnderlyingGroup(u);
                return !existingGroups.some(function(eg) {
                    return _getGroupCorrelation(grp, eg) >= 0.70;
                });
            });
            if (newU.length > 0) s += 10;

            return Math.max(0, Math.min(100, Math.round(s)));
        };
        console.log('[v5b] P3 correlation-aware: ' + Object.keys(UNDERLYING_CORR_GROUPS).length + ' underlyings mapped');

        // ═══ 8. VOL IMPLICITE LIGHT (VIX vs realized) ═══
        // Override _computeP2Index from p2-patch to add VIX vs realized check
        if (typeof _computeP2Index === 'function') {
            var _origComputeP2Index = _computeP2Index;
            _computeP2Index = function(proxyInfo, hasBarrier) {
                var s = _origComputeP2Index(proxyInfo, hasBarrier);

                // Get VIX from market intelligence (already loaded by MI patch)
                var vix = null;
                if (typeof _macroData !== 'undefined' && _macroData) {
                    vix = _macroData.vix;
                }
                if (!vix && typeof _mktCache !== 'undefined' && _mktCache && _mktCache._mi) {
                    vix = _mktCache._mi.vix;
                }

                if (vix && proxyInfo.default_vol) {
                    // VIX = implied vol of S&P 500 (annualized %)
                    // For EU indices, VSTOXX is typically VIX + 3-5%
                    var impliedVol = vix;
                    var isEU = proxyInfo.proxy && /^(FEZ|EWQ|EWG|EWI|EWP|EWL|EWD|EWN|VGK)$/.test(proxyInfo.proxy);
                    if (isEU) impliedVol = vix + 3; // VSTOXX proxy

                    var realizedVol = proxyInfo.default_vol;
                    var volRatio = impliedVol / realizedVol;

                    // If market prices significantly more risk than history shows
                    if (volRatio > 1.3) {
                        var penalty = Math.round((volRatio - 1.3) * 15);
                        s -= penalty;
                        console.log('[v5b] Vol implicite: impl=' + impliedVol.toFixed(1) + '% vs real=' + realizedVol + '% (ratio ' + volRatio.toFixed(2) + ') \u2192 -' + penalty + 'pts');
                    } else if (volRatio < 0.8) {
                        // Market calm vs history: slight bonus
                        s += 3;
                    }
                }

                return Math.max(0, Math.min(100, Math.round(s)));
            };
            console.log('[v5b] P2 vol implicite light: VIX vs realized vol ratio');
        }

        // ═══ 6. OVERRIDE gradeProposal TO ADD CONFIDENCE INTERVAL ═══
        var _origGradeProposalV5b = gradeProposal;
        gradeProposal = async function(product) {
            // Store context for CI calculation
            var _savedCtx = null;
            var _origCollectCtxV5b = _collectContext;
            _collectContext = async function(p) {
                _savedCtx = await _origCollectCtxV5b(p);
                return _savedCtx;
            };

            var result = await _origGradeProposalV5b(product);

            // Restore original
            _collectContext = _origCollectCtxV5b;

            // Add confidence interval
            if (result && result.grade !== '-' && result.grade !== '?' && result.score !== null) {
                var ci = _computeConfidenceInterval(result, _savedCtx);
                if (ci) {
                    result.confidenceInterval = ci;
                    result.metadata = result.metadata || {};
                    result.metadata.ci_low = ci.low;
                    result.metadata.ci_high = ci.high;
                    result.metadata.ci_label = ci.label;
                    result.metadata.ci_grade_stable = ci.gradeStable;
                }
            }

            product.grading = result;
            return result;
        };
        console.log('[v5b] Confidence interval added to gradeProposal');

        // ═══ 6b. OVERRIDE renderGradingSection TO SHOW CI ═══
        var _origRenderGrading = renderGradingSection;
        renderGradingSection = function(grading) {
            var html = _origRenderGrading(grading);
            if (!grading || !grading.confidenceInterval) return html;

            var ci = grading.confidenceInterval;
            var cfg = GRADING_CONFIG.grades[grading.grade] || GRADING_CONFIG.grades.F;

            // Find the grade badge and add CI below it
            var ciHtml = '<div style="font-size:11px;margin-top:4px;text-align:center">';
            ciHtml += '<span style="color:var(--text-dim);font-family:var(--mono)">';
            ciHtml += '[' + ci.low + ' \u2014 ' + ci.high + ']';
            ciHtml += '</span>';
            if (!ci.gradeStable) {
                ciHtml += ' <span style="color:var(--orange);font-size:9px" title="Le grade pourrait varier entre ' + ci.gradeRange + '">\u26a0 ' + ci.gradeRange + '</span>';
            }
            ciHtml += '</div>';

            // Insert CI after the score line "Score X/100"
            var scoreIdx = html.indexOf('</span></div></div>');
            if (scoreIdx > 0) {
                // Find the grade badge container end
                var badgeEnd = html.indexOf('</div>', html.indexOf('Grade '));
                if (badgeEnd > 0) {
                    html = html.substring(0, badgeEnd) + ciHtml + html.substring(badgeEnd);
                }
            }

            // Also add CI info in the metadata footer
            var footerIdx = html.lastIndexOf('v4.3');
            if (footerIdx < 0) footerIdx = html.lastIndexOf('v5');
            if (footerIdx > 0) {
                html = html.substring(0, footerIdx) + 'v5.0b' + html.substring(footerIdx + 4);
            }

            // Add issuer rating to footer if available
            if (grading.metadata && grading.metadata.issuer_rating && grading.metadata.issuer_rating !== 'NR') {
                var issuerBadge = ' \u00b7 \u00c9metteur ' + grading.metadata.issuer_rating;
                var lastDiv = html.lastIndexOf('</div></div>');
                if (lastDiv > 0) {
                    html = html.substring(0, lastDiv) + issuerBadge + html.substring(lastDiv);
                }
            }

            return html;
        };
        console.log('[v5b] renderGradingSection patched with CI display');

        console.log('[StructBoard] Grader v5.0b Patch \u2014 CI + correlation P3 + vol implicite');
    }, 250);
    setTimeout(function() { clearInterval(_v5bInterval); }, 12000);
})();

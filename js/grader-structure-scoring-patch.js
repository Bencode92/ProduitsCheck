// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Structure Scoring Patch v1.0
// Fixes deterministic P1/P2 scoring for non-autocall structures:
//   - Dispersion: no worst-of penalty, vol=bonus, high base P1
//   - Capital garanti: no barrier penalty
//   - Taux fixe: credit-only scoring
// Overrides _computeP1, _computeP2, _graderNormalize, _checkKillCriteria
// Must load AFTER proposal-grader.js AND grader-structure-patch.js
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Wait for grader functions to exist
    var _wait = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _computeP2 !== 'function') return;
        clearInterval(_wait);

        // ═══ OVERRIDE _graderNormalize ═══
        // For dispersion: worstOf = false (it's NOT a worst-of product)
        var _origNormalize = _graderNormalize;
        window._graderNormalize = function(product) {
            var p = _origNormalize(product);
            var structType = product.structureType;
            if (!structType && typeof _autoDetectStructureType === 'function') {
                structType = _autoDetectStructureType(product);
            }

            if (structType === 'dispersion') {
                p.worstOf = false; // NOT a worst-of
                p.capitalProtection = true; // Capital IS guaranteed
                p.barrier = 0; // No barrier
                p._structureType = 'dispersion';
                p._isDispersion = true;
            } else if (structType === 'capital_garanti') {
                p.capitalProtection = true;
                p.barrier = 0;
                p._structureType = 'capital_garanti';
            } else if (structType === 'taux_fixe') {
                p._structureType = 'taux_fixe';
            }

            // Pass through
            p._structureType = p._structureType || structType || '';
            return p;
        };
        if (typeof ProposalGrader !== 'undefined') ProposalGrader.normalize = _graderNormalize;

        // ═══ OVERRIDE _computeP1 ═══
        var _origP1 = _computeP1;
        window._computeP1 = function(p) {
            // DISPERSION: completely different scoring logic
            if (p._structureType === 'dispersion' || p._isDispersion) {
                // Capital guaranteed + coupon always >= 0
                // Score based on expected median return vs alternatives
                var coupon = p.coupon || 7; // participation rate
                var hist = null;
                // Try to get historical simulations from the product
                var currentProd = app.state.currentProduct;
                if (currentProd) hist = currentProd.historicalSimulations || (currentProd.aiParsed && currentProd.aiParsed.historicalSimulations);

                var medianReturn = hist ? hist.median : (coupon * 1.5); // Fallback: rough estimate
                var annualizedReturn = medianReturn / (p.maturityYears || 3);

                // Score: 10pts per % annualized return, capped
                var s = Math.min(100, annualizedReturn * 15);

                // Bonus: capital guaranteed = +15
                s += 15;

                // No worst-of penalty (it's NOT worst-of)
                // No barrier penalty (there IS no barrier)

                // Maturity timing
                var matInfo = _estimateExpectedMaturity(p);
                p._maturityInfo = matInfo;
                var my = p.maturityYears || 3;
                if (my <= 3) s += 5;
                else if (my > 6) s -= 5;

                s = Math.max(0, Math.min(100, Math.round(s)));
                console.log('[StructScoring] P1 dispersion: coupon=' + coupon + '%, median=' + medianReturn + '%, annualized=' + annualizedReturn.toFixed(1) + '%/an, score=' + s);
                return s;
            }

            // CAPITAL GARANTI: gentler scoring
            if (p._structureType === 'capital_garanti') {
                var s2 = Math.min(100, (p.coupon || 0) * 10);
                s2 += 15; // Capital guaranteed bonus
                if (p.couponType === 'garanti' || p.couponType === 'fixe') s2 += 10;
                var matInfo2 = _estimateExpectedMaturity(p);
                p._maturityInfo = matInfo2;
                return Math.max(0, Math.min(100, Math.round(s2)));
            }

            // All other types: original logic
            return _origP1(p);
        };

        // ═══ OVERRIDE _computeP2 ═══
        var _origP2 = _computeP2;
        window._computeP2 = function(p, market, productType) {
            // DISPERSION: vol is an ASSET, not a risk
            if (p._structureType === 'dispersion' || p._isDispersion) {
                if (!market.available || !market.worstMetrics) return 55; // neutral default

                var wm = market.worstMetrics;
                var found = (market.stocks || []).filter(function(s) { return s.found; });

                // For dispersion: we want HIGH volatility (more dispersion)
                // and LOW correlation (more differentiated returns)
                var avgVol = found.length > 0 ? found.reduce(function(s, x) { return s + (x.volatility_3y || 25); }, 0) / found.length : 25;
                var avgBuffett = found.length > 0 ? found.reduce(function(s, x) { return s + (x.buffett_score || 50); }, 0) / found.length : 50;
                var avgQuality = found.length > 0 ? found.reduce(function(s, x) { return s + (x.quality_score || 50); }, 0) / found.length : 50;

                // Volatility BONUS (more vol = more dispersion = more return)
                var volBonus = Math.min(20, Math.max(0, (avgVol - 15) * 0.8));

                // Quality matters for issuer risk only
                var qualityScore = (avgBuffett * 0.5 + avgQuality * 0.5);

                // Sector diversity bonus (different sectors = less correlation = more dispersion)
                var sectors = {};
                found.forEach(function(s) { sectors[(s.sector_api || s.sector || 'unknown').toLowerCase()] = 1; });
                var sectorDiversity = Object.keys(sectors).length;
                var diversityBonus = sectorDiversity > 1 ? Math.min(10, sectorDiversity * 3) : -5;

                var s = qualityScore * 0.5 + volBonus + diversityBonus + 20; // 20 = capital guaranteed base
                s = Math.max(0, Math.min(100, Math.round(s)));

                console.log('[StructScoring] P2 dispersion: avgVol=' + avgVol.toFixed(1) + '%, volBonus=+' + volBonus.toFixed(0) + ', sectors=' + sectorDiversity + ', score=' + s);
                return s;
            }

            // CAPITAL GARANTI: no vol/DD focus
            if (p._structureType === 'capital_garanti') {
                // Mainly issuer credit quality
                if (!market.available || !market.worstMetrics) return 60;
                var wm2 = market.worstMetrics;
                var s2 = (wm2.worst_buffett || 50) * 0.4 + (wm2.worst_quality || 50) * 0.4 + 15; // +15 guaranteed capital
                return Math.max(0, Math.min(100, Math.round(s2)));
            }

            // All other types: original logic
            return _origP2(p, market, productType);
        };

        // ═══ OVERRIDE _checkKillCriteria ═══
        var _origKill = _checkKillCriteria;
        window._checkKillCriteria = function(p, cat) {
            // Dispersion: NEVER kill for too many underlyings
            // (more underlyings = more pairs = more diversification)
            if (p._structureType === 'dispersion' || p._isDispersion) {
                return { killed: false, reasons: [] };
            }

            // Capital garanti: never kill (capital is safe)
            if (p._structureType === 'capital_garanti') {
                return { killed: false, reasons: [] };
            }

            return _origKill(p, cat);
        };
        if (typeof ProposalGrader !== 'undefined') ProposalGrader.checkKillCriteria = _checkKillCriteria;

        console.log('[StructBoard] Grader Structure Scoring Patch v1.0 — P1/P2 adapted for dispersion/capital_garanti');
    }, 300);
    setTimeout(function() { clearInterval(_wait); }, 12000);
})();

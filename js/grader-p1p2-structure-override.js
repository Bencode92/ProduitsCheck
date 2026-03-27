// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader P1/P2 Structure Override v1.0
// Overrides _computeP1 and _computeP2 to handle non-standard
// structures (dispersion, taux_fixe, capital_garanti) BEFORE
// the deterministic scoring runs.
//
// Key fixes:
//   P1: Remove worst-of penalty for dispersion products
//       Use historical median as coupon estimate, not 7%
//   P2: Invert vol from penalty to bonus for dispersion
//       Remove beta penalty for capital-guaranteed products
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Wait for both functions to exist
    var _waitP1P2 = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _computeP2 !== 'function') return;
        clearInterval(_waitP1P2);

        var _origP1 = _computeP1;
        var _origP2 = _computeP2;

        // ═══ P1 OVERRIDE ═══
        window._computeP1 = function(p) {
            var structType = '';
            // Try to get structureType from the original product (not normalized)
            if (app.state.currentProduct) structType = app.state.currentProduct.structureType || '';
            if (!structType && typeof _autoDetectStructureType === 'function') {
                structType = _autoDetectStructureType(app.state.currentProduct || p);
            }

            // ─── DISPERSION: completely different P1 logic ───
            if (structType === 'dispersion') {
                var product = app.state.currentProduct || {};
                var histSim = product.historicalSimulations || (product.aiParsed ? product.aiParsed.historicalSimulations : null);
                var participation = product.participationRate || p.coupon || 7;

                // Use historical median if available, else estimate
                var expectedReturn;
                if (histSim && histSim.median) {
                    expectedReturn = histSim.median; // e.g., 11.47% over 3 years
                } else {
                    // Tech stocks average dispersion ~120-160% over 3 years
                    // With 7% participation → 8.4-11.2%
                    expectedReturn = participation * 1.5; // conservative estimate
                }

                // Annualize for comparison
                var matYears = p.maturityYears || 3;
                var annualReturn = expectedReturn / matYears;

                // Score based on annualized expected return
                // 3.5%/an → 55, 4%/an → 60, 5%/an → 70, 7%/an → 85
                var s = Math.min(95, annualReturn * 15);

                // Capital guaranteed bonus
                if (p.capitalProtection) s += 10;

                // Participation rate evaluation
                // 7% is typical, 10%+ would be generous
                if (participation >= 10) s += 5;
                else if (participation <= 5) s -= 5;

                // NO worst-of penalty (it's NOT a worst-of)
                // NO barrier penalty (there IS no barrier)

                // Maturity adjustment (same as standard)
                if (matYears <= 3) s += 5;
                else if (matYears > 6) s -= 5;

                // Expected maturity (no autocall for dispersion)
                p._maturityInfo = { expected: matYears, max: matYears, isEstimated: false };

                var result = Math.max(0, Math.min(100, Math.round(s)));
                console.log('[P1 Override] Dispersion: expectedReturn=' + expectedReturn +
                    '% annualized=' + annualReturn.toFixed(1) + '%/an → P1=' + result +
                    ' (vs standard P1=' + _origP1(p) + ')');
                return result;
            }

            // ─── CAPITAL GARANTI: boost if coupon is decent ───
            if (structType === 'capital_garanti') {
                var s = _origP1(p);
                // Remove worst-of penalty if it was applied
                if (p.worstOf && p.underlyings.length > 2) {
                    var removedPenalty = Math.round(3 * Math.pow(p.underlyings.length - 2, 1.3));
                    s += removedPenalty;
                    console.log('[P1 Override] Capital garanti: removed worst-of penalty +' + removedPenalty);
                }
                return Math.max(0, Math.min(100, Math.round(s)));
            }

            // ─── TAUX FIXE: already handled correctly by original ───
            // ─── ALL OTHER TYPES: use original ───
            return _origP1(p);
        };

        // ═══ P2 OVERRIDE ═══
        window._computeP2 = function(p, market, productType) {
            var structType = '';
            if (app.state.currentProduct) structType = app.state.currentProduct.structureType || '';
            if (!structType && typeof _autoDetectStructureType === 'function') {
                structType = _autoDetectStructureType(app.state.currentProduct || p);
            }

            // ─── DISPERSION: vol is a POSITIVE factor ───
            if (structType === 'dispersion') {
                if (!market.available || !market.worstMetrics) return 55; // neutral default

                var wm = market.worstMetrics;

                // For dispersion: high vol = MORE dispersion = HIGHER return
                // We INVERT the vol component
                var volBonus = Math.min(25, Math.max(0, (wm.max_volatility || 20) - 15) * 0.8);
                // vol 20% → +4, vol 35% → +16, vol 57% (Tesla) → +25 (capped)

                // Quality still matters (issuer default risk)
                var qualityScore = ((wm.worst_buffett || 50) + (wm.worst_quality || 50)) / 2;

                // Diversity of performance histories = good for dispersion
                // More stocks with different trajectories = more dispersion
                var found = market.stocks ? market.stocks.filter(function(x) { return x.found; }) : [];
                var diversityBonus = 0;
                if (found.length >= 6) diversityBonus = 10;
                else if (found.length >= 4) diversityBonus = 5;

                // Sector concentration: for dispersion, same sector CAN be OK
                // (tech stocks still have very different trajectories: NVDA vs AAPL vs TSLA)
                // Light penalty only if ALL stocks in exact same sub-sector
                var sectorPenalty = 0;
                if (found.length > 1) {
                    var sectors = {};
                    found.forEach(function(x) { sectors[(x.sector_api || '?').toLowerCase()] = 1; });
                    if (Object.keys(sectors).length === 1) sectorPenalty = 5; // mild, not 10
                }

                // NO beta penalty (capital is guaranteed, beta doesn't matter)
                // NO drawdown penalty (dispersion benefits from divergent movements)

                var s = qualityScore * 0.4 + volBonus * 1.0 + 30 + diversityBonus - sectorPenalty;

                var result = Math.max(0, Math.min(100, Math.round(s)));
                console.log('[P2 Override] Dispersion: quality=' + qualityScore.toFixed(0) +
                    ' volBonus=+' + volBonus.toFixed(0) +
                    ' diversity=+' + diversityBonus +
                    ' sectorPenalty=-' + sectorPenalty +
                    ' → P2=' + result + ' (vs standard P2=' + _origP2(p, market, productType) + ')');
                return result;
            }

            // ─── CAPITAL GARANTI: remove beta penalty ───
            if (structType === 'capital_garanti') {
                // Use original but override hasBarrier to false
                var origBarrier = p.barrier;
                var origProtection = p.capitalProtection;
                p.capitalProtection = true; // force capital protected
                var s = _origP2(p, market, productType);
                p.barrier = origBarrier;
                p.capitalProtection = origProtection;
                return s;
            }

            // ─── ALL OTHER TYPES: use original ───
            return _origP2(p, market, productType);
        };

        console.log('[StructBoard] P1/P2 Structure Override v1.0 — dispersion + capital_garanti');
    }, 250);
    setTimeout(function() { clearInterval(_waitP1P2); }, 12000);

    // ═══ Also override kill criteria for dispersion ═══
    var _waitKill = setInterval(function() {
        if (typeof _checkKillCriteria !== 'function') return;
        clearInterval(_waitKill);

        var _origKill = _checkKillCriteria;
        window._checkKillCriteria = function(p, cat) {
            var structType = '';
            if (app.state.currentProduct) structType = app.state.currentProduct.structureType || '';
            if (!structType && typeof _autoDetectStructureType === 'function') {
                structType = _autoDetectStructureType(app.state.currentProduct || p);
            }

            // Dispersion: do NOT apply worst-of kill criteria
            // 16 pairs / 8 stocks is the normal structure, not a risk
            if (structType === 'dispersion') {
                return { killed: false, reasons: [] };
            }

            // Capital garanti: also skip worst-of kill
            if (structType === 'capital_garanti') {
                return { killed: false, reasons: [] };
            }

            return _origKill(p, cat);
        };
        console.log('[StructBoard] Kill criteria override for dispersion/capital_garanti');
    }, 300);
    setTimeout(function() { clearInterval(_waitKill); }, 12000);

    console.log('[StructBoard] Grader P1/P2 Structure Override v1.0 loaded');
})();

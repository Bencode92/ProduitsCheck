// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Dispersion Patch v1.0
// Fixes deterministic scoring (_computeP1, _computeP2) for
// non-standard structures (dispersion, taux_fixe, capital_garanti)
// This patches the BASE score, not just the Claude adjustment.
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Wait for grader + auto-detect to be loaded
    var _wait = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _computeP2 !== 'function') return;
        if (typeof _autoDetectStructureType !== 'function') return;
        clearInterval(_wait);

        // ═══ OVERRIDE _computeP1 ═══
        var _origP1 = _computeP1;
        _computeP1 = function(p) {
            // Get the original product (before normalize) to check structureType
            var product = app.state.currentProduct || {};
            var structType = product.structureType || _autoDetectStructureType(product);

            // DISPERSION: completely different P1 logic
            if (structType === 'dispersion') {
                // Coupon is a participation rate, not a traditional coupon
                // Median historical return ~11% on 3 years = ~3.7%/an
                var participation = product.participationRate || p.coupon || 7;
                var histSim = product.historicalSimulations || (product.aiParsed && product.aiParsed.historicalSimulations);
                var medianReturn = histSim && histSim.median ? histSim.median : 11;
                var annualizedReturn = medianReturn / (p.maturityYears || 3);

                // Score based on expected annualized return
                // 0%/an = 0, 2%/an = 40, 4%/an = 60, 6%/an = 75, 10%/an = 90
                var s = Math.min(90, Math.round(annualizedReturn * 15));

                // Bonus: capital guaranteed
                if (p.capitalProtection) s += 10;

                // Bonus: short maturity (3 years)
                if (p.maturityYears <= 3) s += 5;
                else if (p.maturityYears >= 6) s -= 5;

                // No worst-of penalty (dispersion is NOT worst-of)
                // No barrier penalty (there is no barrier)

                s = Math.max(0, Math.min(100, s));
                console.log('[DispersionPatch] P1: ' + s + ' (annualized ~' + annualizedReturn.toFixed(1) + '%/an, median ' + medianReturn + '% on ' + (p.maturityYears || 3) + 'Y)');
                return s;
            }

            // CAPITAL GARANTI (without barrier): slightly modified P1
            if (structType === 'capital_garanti') {
                var base = _origP1(p);
                // Remove worst-of penalty since capital is guaranteed
                if (p.worstOf && p.underlyings.length > 2) {
                    var removedPenalty = Math.round(3 * Math.pow(p.underlyings.length - 2, 1.3));
                    base += removedPenalty;
                    console.log('[DispersionPatch] P1 capital_garanti: removed worst-of penalty +' + removedPenalty);
                }
                return Math.max(0, Math.min(100, base));
            }

            return _origP1(p);
        };

        // ═══ OVERRIDE _computeP2 ═══
        var _origP2 = _computeP2;
        _computeP2 = function(p, market, productType) {
            var product = app.state.currentProduct || {};
            var structType = product.structureType || _autoDetectStructureType(product);

            // DISPERSION: vol is an ASSET, not a risk
            if (structType === 'dispersion') {
                if (!market.available || !market.worstMetrics) return 55; // neutral default

                var wm = market.worstMetrics;
                var found = (market.stocks || []).filter(function(s) { return s.found; });

                // For dispersion: quality of stocks still matters (they're real companies)
                // But vol is POSITIVE (more dispersion potential)
                // And DD doesn't matter (capital is guaranteed)
                var qualityScore = (wm.worst_buffett || 35) * 0.30 + (wm.worst_quality || 35) * 0.30;

                // Vol BONUS: higher vol = more dispersion = higher expected return
                // vol 20% = neutral, vol 40% = +15 bonus, vol 60% = +25 bonus
                var avgVol = found.length > 0
                    ? found.reduce(function(s, x) { return s + (x.volatility_3y || 25); }, 0) / found.length
                    : 25;
                var volBonus = Math.min(25, Math.max(0, (avgVol - 20) * 0.6));

                // Low correlation between stocks = MORE dispersion = GOOD
                // Proxy: number of different sectors
                var sectors = {};
                found.forEach(function(x) { sectors[(x.sector_api || '?').toLowerCase()] = 1; });
                var sectorDiversity = Object.keys(sectors).length;
                var diversityBonus = Math.min(10, sectorDiversity * 3);

                var s = qualityScore + volBonus + diversityBonus;
                s = Math.max(0, Math.min(100, Math.round(s)));

                console.log('[DispersionPatch] P2: ' + s + ' (quality=' + Math.round(qualityScore) + ', volBonus=+' + Math.round(volBonus) + ' [avg vol ' + Math.round(avgVol) + '%], diversityBonus=+' + diversityBonus + ' [' + sectorDiversity + ' sectors])');
                return s;
            }

            return _origP2(p, market, productType);
        };

        // ═══ OVERRIDE _checkKillCriteria ═══
        var _origKill = _checkKillCriteria;
        _checkKillCriteria = function(p, cat) {
            var product = app.state.currentProduct || {};
            var structType = product.structureType || _autoDetectStructureType(product);

            // Dispersion products are NOT worst-of — never kill for number of underlyings
            if (structType === 'dispersion' || structType === 'capital_garanti' || structType === 'taux_fixe') {
                return { killed: false, reasons: [] };
            }

            return _origKill(p, cat);
        };

        // ═══ OVERRIDE _buildUserPrompt to fix "worst-of" label ═══
        if (typeof _buildUserPrompt === 'function') {
            var _origPrompt = _buildUserPrompt;
            _buildUserPrompt = function(ctx, base, productType) {
                var product = app.state.currentProduct || {};
                var structType = product.structureType || _autoDetectStructureType(product);

                var result = _origPrompt(ctx, base, productType);

                if (structType === 'dispersion') {
                    // Replace misleading "worst-of" label
                    result = result.replace('(worst-of)', '(DISPERSION — performance relative entre paires)');
                    // Add dispersion-specific context
                    var histSim = product.historicalSimulations || (product.aiParsed && product.aiParsed.historicalSimulations);
                    if (histSim) {
                        result += '\nSIMULATIONS HISTORIQUES: min=' + (histSim.min || '?') + '%, median=' + (histSim.median || '?') + '%, mean=' + (histSim.mean || '?') + '%, max=' + (histSim.max || '?') + '%\n';
                    }
                    if (product.participationRate) {
                        result += 'PARTICIPATION: ' + product.participationRate + '% de la dispersion moyenne\n';
                    }
                }

                return result;
            };
        }

        console.log('[StructBoard] Grader Dispersion Patch v1.0 — P1/P2/kill/prompt fixed for dispersion');
    }, 500);
    setTimeout(function() { clearInterval(_wait); }, 15000);
})();

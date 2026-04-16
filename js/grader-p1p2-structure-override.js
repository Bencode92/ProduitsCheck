// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader P1/P2 Structure Override v1.1
// Strategy: Override _graderNormalize to FIX the normalized data
// BEFORE any scoring happens. This way ALL P1/P2 patches
// receive correct data (no worst-of for dispersion, etc.)
//
// Also overrides _checkKillCriteria for non-standard structures.
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ CORE FIX: Override _graderNormalize ═══
    // This runs BEFORE _computeP1/_computeP2 and ALL their patches
    var _waitNorm = setInterval(function() {
        if (typeof _graderNormalize !== 'function') return;
        clearInterval(_waitNorm);

        var _origNormalize = _graderNormalize;

        window._graderNormalize = function(product) {
            var norm = _origNormalize(product);

            // Detect structure type
            var structType = product.structureType || '';
            if (!structType && typeof _autoDetectStructureType === 'function') {
                structType = _autoDetectStructureType(product);
            }

            if (!structType) return norm;

            // ─── DISPERSION: fix normalized data ───
            if (structType === 'dispersion') {
                // 1. NOT a worst-of — remove the flag entirely
                norm.worstOf = false;

                // 2. Capital IS protected (guaranteed 100%)
                norm.capitalProtection = true;

                // 3. NO barrier (there is none)
                norm.barrier = 0;

                // 4. Coupon type is guaranteed (always >= 0%)
                norm.couponType = 'garanti';

                // 5. Adjust coupon to expected annualized return
                //    If historical median available, use it
                var histSim = product.historicalSimulations ||
                    (product.aiParsed ? product.aiParsed.historicalSimulations : null);
                var matYears = norm.maturityYears || 3;

                if (histSim && histSim.median) {
                    // Median 11.47% over 3 years → ~3.82%/an
                    norm.coupon = histSim.median / matYears;
                    norm._dispersionMedian = histSim.median;
                } else {
                    // Use participation × estimated dispersion
                    var participation = product.participationRate || (product.aiParsed && product.aiParsed.participationRate) || norm.coupon || 7;
                    // Conservative dispersion estimate: 130% for tech pairs over 3Y
                    norm.coupon = (participation * 1.3) / matYears;
                    norm._dispersionMedian = participation * 1.3;
                }

                // 6. No autocall for dispersion
                norm.autocall = false;

                // 7. Tag it
                norm._structureType = 'dispersion';
                norm._originalCoupon = product.coupon?.rate || product.participationRate || 7;

                console.log('[NormOverride] Dispersion: worstOf=false, barrier=0, coupon=' +
                    norm.coupon.toFixed(2) + '%/an (median ' + (norm._dispersionMedian || '?') +
                    '% over ' + matYears + 'Y)');
            }

            // ─── CAPITAL GARANTI: remove worst-of if present ───
            else if (structType === 'capital_garanti') {
                norm.capitalProtection = true;
                norm.barrier = 0;
                if (norm.couponType !== 'fixe') norm.couponType = 'garanti';
                norm._structureType = 'capital_garanti';
                // Keep worstOf as-is for other capital_garanti products
                // (some do have conditional coupons)
                console.log('[NormOverride] Capital garanti: barrier=0, protection=true');
            }

            // ─── TAUX FIXE: ensure correct treatment ───
            else if (structType === 'taux_fixe') {
                norm.capitalProtection = true;
                norm.barrier = 0;
                norm.couponType = 'fixe';
                norm.worstOf = false;
                norm._structureType = 'taux_fixe';
                console.log('[NormOverride] Taux fixe: barrier=0, couponType=fixe');
            }

            return norm;
        };

        console.log('[StructBoard] _graderNormalize overridden for structure types');
    }, 150); // Fire early, before other patches
    setTimeout(function() { clearInterval(_waitNorm); }, 10000);

    // ═══ FIX KILL CRITERIA ═══
    var _waitKill = setInterval(function() {
        if (typeof _checkKillCriteria !== 'function') return;
        clearInterval(_waitKill);

        var _origKill = _checkKillCriteria;
        window._checkKillCriteria = function(p, cat) {
            // If structure type is set, skip worst-of kill
            var structType = p._structureType || '';
            if (!structType) {
                var product = app.state.currentProduct;
                if (product) {
                    structType = product.structureType || '';
                    if (!structType && typeof _autoDetectStructureType === 'function') {
                        structType = _autoDetectStructureType(product);
                    }
                }
            }

            if (structType === 'dispersion' || structType === 'capital_garanti' || structType === 'taux_fixe') {
                return { killed: false, reasons: [] };
            }

            return _origKill(p, cat);
        };
        console.log('[StructBoard] Kill criteria overridden for non-standard structures');
    }, 200);
    setTimeout(function() { clearInterval(_waitKill); }, 10000);

    // ═══ FIX P2: Override AFTER all other patches ═══
    // Use a late timeout to ensure we override LAST
    setTimeout(function() {
        if (typeof _computeP2 !== 'function') return;

        var _lastP2 = _computeP2;
        window._computeP2 = function(p, market, productType) {
            // Check if this is a dispersion product (tagged by normalize)
            if (p._structureType === 'dispersion') {
                if (!market || !market.available || !market.worstMetrics) return 60;
                var wm = market.worstMetrics;

                // Vol is POSITIVE for dispersion
                var volBonus = Math.min(20, Math.max(0, (wm.max_volatility || 20) - 15) * 0.7);

                // Quality still matters
                var qualityAvg = ((wm.worst_buffett || 50) + (wm.worst_quality || 50)) / 2;

                // Diversity bonus
                var found = market.stocks ? market.stocks.filter(function(x) { return x.found; }) : [];
                var diversityBonus = found.length >= 6 ? 10 : found.length >= 4 ? 5 : 0;

                var s = qualityAvg * 0.4 + volBonus + 30 + diversityBonus;
                s = Math.max(0, Math.min(100, Math.round(s)));

                console.log('[P2 Late Override] Dispersion: quality=' + qualityAvg.toFixed(0) +
                    ' volBonus=+' + volBonus.toFixed(0) + ' diversity=+' + diversityBonus +
                    ' → P2=' + s + ' (standard would be ' + _lastP2(p, market, productType) + ')');
                return s;
            }

            return _lastP2(p, market, productType);
        };
        console.log('[StructBoard] P2 late override installed for dispersion');
    }, 3000); // 3 seconds = after ALL setInterval patches have fired

    console.log('[StructBoard] Grader P1/P2 Structure Override v1.1 — normalize strategy');
})();

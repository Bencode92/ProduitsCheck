// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Rates Patch v1.0
// Enhanced scoring for callable bonds, fixed-rate, and rate-linked products
// Uses rates.json (ECB yields, policy rates, yield curve)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var _ratesData = null;

    // Load rates.json
    async function _loadRatesData() {
        if (_ratesData) return _ratesData;
        try {
            _ratesData = await github.readFile('data/market/rates.json');
            var nYields = Object.keys(_ratesData.yields || {}).length;
            var nRates = Object.keys(_ratesData.policy_rates || {}).length;
            console.log('[Rates-Patch] Loaded: ' + nYields + ' yields, ' + nRates + ' policy rates');
            if (_ratesData.yield_curve && _ratesData.yield_curve.shape) {
                console.log('[Rates-Patch] Curve: ' + _ratesData.yield_curve.shape + ' (2-10 spread: ' + (_ratesData.yield_curve.spread_2_10 || '?') + '%)');
            }
        } catch(e) {
            console.warn('[Rates-Patch] rates.json not found');
            _ratesData = { yields: {}, policy_rates: {}, yield_curve: {} };
        }
        return _ratesData;
    }

    // Get interpolated yield for a given maturity
    function _getYieldForMaturity(maturityYears) {
        if (!_ratesData || !_ratesData.yield_curve || !_ratesData.yield_curve.points) return null;
        var pts = _ratesData.yield_curve.points;
        if (pts.length === 0) return null;

        // Exact match
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].maturity === maturityYears) return pts[i].yield;
        }

        // Linear interpolation
        pts.sort(function(a, b) { return a.maturity - b.maturity; });
        if (maturityYears <= pts[0].maturity) return pts[0].yield;
        if (maturityYears >= pts[pts.length - 1].maturity) return pts[pts.length - 1].yield;

        for (var j = 0; j < pts.length - 1; j++) {
            if (maturityYears >= pts[j].maturity && maturityYears <= pts[j + 1].maturity) {
                var frac = (maturityYears - pts[j].maturity) / (pts[j + 1].maturity - pts[j].maturity);
                return pts[j].yield + frac * (pts[j + 1].yield - pts[j].yield);
            }
        }
        return null;
    }

    // Get ECB deposit rate (floor for risk-free)
    function _getECBDepositRate() {
        if (!_ratesData || !_ratesData.policy_rates) return 2.0; // fallback
        var dep = _ratesData.policy_rates.ecb_deposit_rate;
        return dep ? dep.current : 2.0;
    }

    // Get rate direction for a maturity bucket
    function _getRateDirection(maturityYears) {
        if (!_ratesData || !_ratesData.yields) return 'unknown';
        if (maturityYears <= 3) return (_ratesData.yields.oat_fr_2y || {}).direction || 'unknown';
        if (maturityYears <= 7) return (_ratesData.yields.oat_fr_5y || {}).direction || 'unknown';
        return (_ratesData.yields.oat_fr_10y || {}).direction || 'unknown';
    }

    // Get rate volatility for a maturity bucket
    function _getRateVol(maturityYears) {
        if (!_ratesData || !_ratesData.yields) return 0;
        if (maturityYears <= 3) return (_ratesData.yields.oat_fr_2y || {}).vol_annualized_bps || 0;
        if (maturityYears <= 7) return (_ratesData.yields.oat_fr_5y || {}).vol_annualized_bps || 0;
        return (_ratesData.yields.oat_fr_10y || {}).vol_annualized_bps || 0;
    }

    // ═══ ENHANCED P1 FOR RATE PRODUCTS ═══
    // Coupon vs equivalent risk-free yield (not just CAT)
    function _computeP1Rate(p) {
        var coupon = p.coupon || 0;
        var mat = p.maturityYears || 5;

        // Base: coupon attractiveness
        var s = Math.min(100, coupon * 10);

        // Coupon vs risk-free yield for same maturity
        var rfYield = _getYieldForMaturity(mat);
        if (rfYield != null) {
            var spreadVsRF = coupon - rfYield;
            // Spread > 2% vs risk-free = good
            if (spreadVsRF > 3) s += 10;
            else if (spreadVsRF > 2) s += 5;
            else if (spreadVsRF > 1) s += 0;
            else if (spreadVsRF > 0) s -= 5;
            else s -= 15; // Coupon below risk-free = terrible
            console.log('[Rates-Patch] P1: coupon ' + coupon + '% vs RF ' + rfYield.toFixed(2) + '% (' + mat + 'Y) = spread ' + spreadVsRF.toFixed(2) + '%');
        }

        // Callable risk: issuer will call if rates drop
        if (p.autocall || p.callable) {
            var direction = _getRateDirection(mat);
            if (direction === 'falling') {
                // Rates falling → high probability of early call → reinvestment risk
                s -= 8;
                console.log('[Rates-Patch] P1: rates falling (' + mat + 'Y) → callable reinvestment risk -8');
            } else if (direction === 'rising') {
                // Rates rising → low call probability → you keep the high coupon longer
                s += 5;
                console.log('[Rates-Patch] P1: rates rising → low call probability +5');
            }
        }

        // Fixed coupon guaranteed: bonus
        if (p.couponType === 'garanti' || p.couponType === 'fixe') s += 15;

        // Maturity adjustment (non-linear)
        if (mat <= 2) s += 8;
        else if (mat <= 3) s += 5;
        else if (mat > 5 && mat <= 8) s -= 5;
        else if (mat > 8) s -= Math.round(5 * Math.log(mat / 5));

        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // ═══ ENHANCED P2 FOR RATE PRODUCTS ═══
    // Credit risk + rate environment + duration risk
    function _computeP2Rate(p) {
        var mat = p.maturityYears || 5;
        var base = p.capitalProtection ? 70 : 55;

        // Duration risk: longer maturity = more sensitivity to rate moves
        // DV01 proxy: each year of maturity adds ~1% sensitivity per 100bps move
        var durationPenalty = 0;
        if (mat > 3) {
            durationPenalty = Math.round(Math.min(15, (mat - 3) * 2.5));
        }
        base -= durationPenalty;

        // Rate volatility penalty
        var rateVol = _getRateVol(mat);
        if (rateVol > 25) base -= 8;
        else if (rateVol > 15) base -= 4;

        // Yield curve shape impact
        if (_ratesData && _ratesData.yield_curve) {
            var curve = _ratesData.yield_curve;
            if (curve.shape === 'inverted') {
                // Inverted curve = recession signal = higher credit risk
                base -= 10;
                console.log('[Rates-Patch] P2: inverted yield curve → -10');
            } else if (curve.shape === 'normal' && curve.spread_2_10 > 0.5) {
                // Steep normal curve = healthy economy for rate products
                base += 5;
            }
        }

        // Rate direction impact on bond value
        var direction = _getRateDirection(mat);
        if (direction === 'rising') {
            // Rising rates = bond value drops (mark-to-market loss)
            base -= 5;
        } else if (direction === 'falling') {
            // Falling rates = bond value rises
            base += 3;
        }

        // Callable bonus: shorter effective duration
        if (p.autocall || p.callable) base += 5;

        // Issuer credit (from v5 patch ISSUER_RATINGS if available)
        // This is handled by grader-v5-patch.js post-scoring

        console.log('[Rates-Patch] P2 rate: base=' + (p.capitalProtection ? 70 : 55) + ' duration=-' + durationPenalty + ' vol=' + rateVol + 'bps dir=' + direction + ' → P2=' + base);
        return Math.max(0, Math.min(100, Math.round(base)));
    }

    // ═══ ENHANCED P4 FOR RATE PRODUCTS ═══
    // Spread vs risk-free yield (not just CAT)
    function _computeP4Rate(p, catRate) {
        var coupon = p.coupon || 0;
        var mat = p.maturityYears || 5;
        var rfYield = _getYieldForMaturity(mat);
        var ecbDepo = _getECBDepositRate();

        // Use the highest of: CAT rate, risk-free yield, ECB deposit
        var benchmark = Math.max(catRate || 2.5, rfYield || 0, ecbDepo);
        var spread = coupon - benchmark;

        // Illiquidity premium: structured products are illiquid
        var illiquidityPremium = 0.5 + 0.15 * Math.max(0, mat - 2);
        var effectiveSpread = spread - illiquidityPremium;

        var s;
        if (effectiveSpread <= 0) {
            s = Math.max(5, 30 + Math.round(effectiveSpread * 15));
        } else if (effectiveSpread <= 4) {
            s = Math.min(80, Math.round(30 + effectiveSpread * 12.5));
        } else {
            s = Math.round(80 + 20 * (1 - Math.exp(-(effectiveSpread - 4) / 4)));
        }

        console.log('[Rates-Patch] P4: coupon ' + coupon + '% vs benchmark ' + benchmark.toFixed(2) + '% (CAT=' + (catRate || 2.5) + ' RF=' + (rfYield ? rfYield.toFixed(2) : '?') + ' ECB=' + ecbDepo + ') illiq=' + illiquidityPremium.toFixed(2) + '% → eff.spread=' + effectiveSpread.toFixed(2) + '% → P4=' + s);
        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // ═══ BUILD RATE CONTEXT FOR CLAUDE PROMPT ═══
    function _buildRateContext() {
        if (!_ratesData) return '';
        var lines = [];
        lines.push('=== RATE ENVIRONMENT ===');

        if (_ratesData.policy_rates) {
            var ecb = _ratesData.policy_rates.ecb_main_rate;
            var depo = _ratesData.policy_rates.ecb_deposit_rate;
            if (ecb) lines.push('BCE taux directeur: ' + ecb.current + '% (' + ecb.date + ')');
            if (depo) lines.push('BCE taux de d\u00e9p\u00f4t: ' + depo.current + '%');
        }

        if (_ratesData.yields) {
            var y2 = _ratesData.yields.oat_fr_2y;
            var y5 = _ratesData.yields.oat_fr_5y;
            var y10 = _ratesData.yields.oat_fr_10y;
            if (y2) lines.push('Euro AAA 2Y: ' + y2.current + '% (dir: ' + y2.direction + ', vol: ' + y2.vol_annualized_bps + 'bps)');
            if (y5) lines.push('Euro AAA 5Y: ' + y5.current + '% (dir: ' + y5.direction + ', vol: ' + y5.vol_annualized_bps + 'bps)');
            if (y10) lines.push('Euro AAA 10Y: ' + y10.current + '% (dir: ' + y10.direction + ', vol: ' + y10.vol_annualized_bps + 'bps, \u2248 TEC 10)');
        }

        if (_ratesData.yield_curve) {
            var yc = _ratesData.yield_curve;
            lines.push('Courbe: ' + yc.shape + ' (spread 2-10Y: ' + (yc.spread_2_10 || '?') + '%)');
        }

        return lines.join('\n');
    }

    // Wait for grader to load
    var _ratesPatchInterval = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _computeP2 !== 'function' || typeof _computeP4 !== 'function' || typeof _callClaude !== 'function') return;
        clearInterval(_ratesPatchInterval);

        // ═══ OVERRIDE P1 for rate products ═══
        var _origComputeP1Rates = _computeP1;
        _computeP1 = function(p) {
            if (_isFixedRateProduct(p) && _ratesData && Object.keys(_ratesData.yields || {}).length > 0) {
                return _computeP1Rate(p);
            }
            return _origComputeP1Rates(p);
        };

        // ═══ OVERRIDE P2 for rate products ═══
        var _origComputeP2Rates = _computeP2;
        _computeP2 = function(p, market, productType) {
            if ((productType === 'fixed-rate-callable' || _isFixedRateProduct(p)) && _ratesData && Object.keys(_ratesData.yields || {}).length > 0) {
                return _computeP2Rate(p);
            }
            return _origComputeP2Rates(p, market, productType);
        };

        // ═══ OVERRIDE P4 for rate products ═══
        var _origComputeP4Rates = _computeP4;
        _computeP4 = function(p, catRate) {
            if (_isFixedRateProduct(p) && _ratesData && Object.keys(_ratesData.yields || {}).length > 0) {
                return _computeP4Rate(p, catRate);
            }
            return _origComputeP4Rates(p, catRate);
        };

        // ═══ INJECT RATE CONTEXT INTO CLAUDE PROMPT ═══
        var _origCallClaudeRates = _callClaude;
        _callClaude = async function(ctx, base, productType) {
            // Inject rate environment into context for rate products
            if (_isFixedRateProduct(ctx.product) && _ratesData) {
                ctx._rateContext = _buildRateContext();
                ctx._ratesData = _ratesData;

                // Enrich the system prompt addition
                if (!ctx._extraSystemPrompt) ctx._extraSystemPrompt = '';
                ctx._extraSystemPrompt += '\n\n' + _buildRateContext();
                ctx._extraSystemPrompt += '\n\nPRODUIT TAUX FIXE/CALLABLE: Risques sp\u00e9cifiques \u00e0 analyser:';
                ctx._extraSystemPrompt += '\n1. RISQUE CR\u00c9DIT \u00c9METTEUR: Sans sous-jacent action, le risque principal est le d\u00e9faut de l\'\u00e9metteur.';
                ctx._extraSystemPrompt += '\n2. RISQUE DE R\u00c9INVESTISSEMENT: Si callable et taux en baisse, l\'\u00e9metteur rappellera et le tr\u00e9sorier devra r\u00e9investir \u00e0 des taux inf\u00e9rieurs.';
                ctx._extraSystemPrompt += '\n3. RISQUE DE DUR\u00c9E: Sensibilit\u00e9 du prix \u00e0 la hausse des taux (DV01 ~ ' + (ctx.product.maturityYears || 5) + 'bps per 1% move).';
                ctx._extraSystemPrompt += '\n4. CO\u00dbT D\'OPPORTUNIT\u00c9: Comparer le coupon au taux sans risque \u00e9quivalent maturity (' + (_getYieldForMaturity(ctx.product.maturityYears || 5) || '?').toFixed ? _getYieldForMaturity(ctx.product.maturityYears || 5).toFixed(2) + '%' : '?' + ').';
                ctx._extraSystemPrompt += '\n5. SC\u00c9NARIOS: (a) Call\u00e9 an 1-3: rendement r\u00e9el + risque r\u00e9invest. (b) Tenu \u00e0 maturit\u00e9: rendement garanti mais immobilis\u00e9. (c) Stress: d\u00e9faut \u00e9metteur.';
            }
            return _origCallClaudeRates(ctx, base, productType);
        };

        // ═══ PRELOAD RATES IN _collectContext ═══
        var _origCollectContextRates = _collectContext;
        _collectContext = async function(product) {
            await _loadRatesData();
            return _origCollectContextRates(product);
        };

        console.log('[StructBoard] Grader Rates Patch v1.0 — callable bonds + rate products enhanced');
    }, 300);
    setTimeout(function() { clearInterval(_ratesPatchInterval); }, 12000);

    // Detect fixed-rate / callable bond products
    function _isFixedRateProduct(p) {
        if (!p) return false;
        var name = (p.name || '').toLowerCase();
        var type = (p.type || '').toLowerCase();
        // Direct indicators
        if (type.indexOf('taux fixe') >= 0 || type.indexOf('callable') >= 0 || type.indexOf('obligation') >= 0) return true;
        if (name.indexOf('taux fixe') >= 0 || name.indexOf('callable') >= 0 || name.indexOf('fixed rate') >= 0) return true;
        if (name.indexOf('obligation') >= 0 || name.indexOf('bond') >= 0 || name.indexOf('cln') >= 0) return true;
        // No equity underlying = likely rate product
        if (p.underlyings && p.underlyings.length === 0 && p.coupon > 0) return true;
        if (!p.underlyings || p.underlyings.length === 0) {
            if (p.couponType === 'fixe' || p.couponType === 'garanti') return true;
        }
        return false;
    }
})();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Rates Patch v1.1
// Enhanced scoring for callable bonds, fixed-rate, and rate-linked products
// Uses rates.json (ECB yields, policy rates, yield curve)
// v1.1: Fix prompt injection — use _buildUserPrompt override instead of ctx._extraSystemPrompt
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var _ratesData = null;

    async function _loadRatesData() {
        if (_ratesData) return _ratesData;
        try {
            _ratesData = await github.readFile('data/market/rates.json');
            var nYields = Object.keys(_ratesData.yields || {}).length;
            var nRates = Object.keys(_ratesData.policy_rates || {}).length;
            console.log('[Rates-Patch] Loaded: ' + nYields + ' yields, ' + nRates + ' policy rates');
        } catch(e) {
            console.warn('[Rates-Patch] rates.json not found');
            _ratesData = { yields: {}, policy_rates: {}, yield_curve: {} };
        }
        return _ratesData;
    }

    function _getYieldForMaturity(maturityYears) {
        if (!_ratesData || !_ratesData.yield_curve || !_ratesData.yield_curve.points) return null;
        var pts = _ratesData.yield_curve.points;
        if (pts.length === 0) return null;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].maturity === maturityYears) return pts[i].yield;
        }
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

    function _getECBDepositRate() {
        if (!_ratesData || !_ratesData.policy_rates) return 2.0;
        var dep = _ratesData.policy_rates.ecb_deposit_rate;
        return dep ? dep.current : 2.0;
    }

    function _getRateDirection(maturityYears) {
        if (!_ratesData || !_ratesData.yields) return 'unknown';
        if (maturityYears <= 3) return (_ratesData.yields.oat_fr_2y || {}).direction || 'unknown';
        if (maturityYears <= 7) return (_ratesData.yields.oat_fr_5y || {}).direction || 'unknown';
        return (_ratesData.yields.oat_fr_10y || {}).direction || 'unknown';
    }

    function _getRateVol(maturityYears) {
        if (!_ratesData || !_ratesData.yields) return 0;
        if (maturityYears <= 3) return (_ratesData.yields.oat_fr_2y || {}).vol_annualized_bps || 0;
        if (maturityYears <= 7) return (_ratesData.yields.oat_fr_5y || {}).vol_annualized_bps || 0;
        return (_ratesData.yields.oat_fr_10y || {}).vol_annualized_bps || 0;
    }

    // ═══ ENHANCED P1 FOR RATE PRODUCTS ═══
    function _computeP1Rate(p) {
        var coupon = p.coupon || 0;
        var mat = p.maturityYears || 5;
        var s = Math.min(100, coupon * 10);

        var rfYield = _getYieldForMaturity(mat);
        if (rfYield != null) {
            var spreadVsRF = coupon - rfYield;
            if (spreadVsRF > 3) s += 10;
            else if (spreadVsRF > 2) s += 5;
            else if (spreadVsRF > 1) s += 0;
            else if (spreadVsRF > 0) s -= 5;
            else s -= 15;
            console.log('[Rates-Patch] P1: coupon ' + coupon + '% vs RF ' + rfYield.toFixed(2) + '% (' + mat + 'Y) = spread ' + spreadVsRF.toFixed(2) + '%');
        }

        if (p.autocall || p.callable) {
            var direction = _getRateDirection(mat);
            if (direction === 'falling') { s -= 8; }
            else if (direction === 'rising') { s += 5; }
        }

        if (p.couponType === 'garanti' || p.couponType === 'fixe') s += 15;

        if (mat <= 2) s += 8;
        else if (mat <= 3) s += 5;
        else if (mat > 5 && mat <= 8) s -= 5;
        else if (mat > 8) s -= Math.round(5 * Math.log(mat / 5));

        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // ═══ ENHANCED P2 FOR RATE PRODUCTS ═══
    function _computeP2Rate(p) {
        var mat = p.maturityYears || 5;
        var base = p.capitalProtection ? 70 : 55;

        var durationPenalty = 0;
        if (mat > 3) {
            durationPenalty = Math.round(Math.min(15, (mat - 3) * 2.5));
        }
        base -= durationPenalty;

        var rateVol = _getRateVol(mat);
        if (rateVol > 25) base -= 8;
        else if (rateVol > 15) base -= 4;

        if (_ratesData && _ratesData.yield_curve) {
            var curve = _ratesData.yield_curve;
            if (curve.shape === 'inverted') {
                base -= 10;
            } else if (curve.shape === 'normal' && curve.spread_2_10 > 0.5) {
                base += 5;
            }
        }

        var direction = _getRateDirection(mat);
        if (direction === 'rising') base -= 5;
        else if (direction === 'falling') base += 3;

        if (p.autocall || p.callable) base += 5;

        console.log('[Rates-Patch] P2 rate: duration=-' + durationPenalty + ' vol=' + rateVol + 'bps dir=' + direction + ' curve=' + ((_ratesData || {}).yield_curve || {}).shape + ' → P2=' + base);
        return Math.max(0, Math.min(100, Math.round(base)));
    }

    // ═══ ENHANCED P4 FOR RATE PRODUCTS ═══
    function _computeP4Rate(p, catRate) {
        var coupon = p.coupon || 0;
        var mat = p.maturityYears || 5;
        var rfYield = _getYieldForMaturity(mat);
        var ecbDepo = _getECBDepositRate();

        var benchmark = Math.max(catRate || 2.5, rfYield || 0, ecbDepo);
        var illiquidityPremium = 0.5 + 0.15 * Math.max(0, mat - 2);
        var effectiveSpread = coupon - benchmark - illiquidityPremium;

        var s;
        if (effectiveSpread <= 0) {
            s = Math.max(5, 30 + Math.round(effectiveSpread * 15));
        } else if (effectiveSpread <= 4) {
            s = Math.min(80, Math.round(30 + effectiveSpread * 12.5));
        } else {
            s = Math.round(80 + 20 * (1 - Math.exp(-(effectiveSpread - 4) / 4)));
        }

        console.log('[Rates-Patch] P4: coupon ' + coupon + '% vs benchmark ' + benchmark.toFixed(2) + '% illiq=' + illiquidityPremium.toFixed(2) + '% → eff.spread=' + effectiveSpread.toFixed(2) + '% → P4=' + s);
        return Math.max(0, Math.min(100, Math.round(s)));
    }

    // ═══ BUILD RATE CONTEXT STRING ═══
    function _buildRateContext() {
        if (!_ratesData) return '';
        var lines = [];
        lines.push('## ENVIRONNEMENT TAUX (données ECB réelles)');
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
            lines.push('Courbe des taux: ' + yc.shape + ' (spread 2-10Y: ' + (yc.spread_2_10 || '?') + '%)');
        }
        return lines.join('\n');
    }

    // Wait for grader to load
    var _ratesPatchInterval = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _computeP2 !== 'function' || typeof _computeP4 !== 'function' || typeof _buildUserPrompt !== 'function' || typeof _buildSystemPrompt !== 'function') return;
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

        // ═══ v1.1 FIX: INJECT RATE CONTEXT VIA _buildUserPrompt ═══
        // This is the correct way — MI patch reads _buildUserPrompt output
        var _origBuildUserPromptRates = _buildUserPrompt;
        _buildUserPrompt = function(ctx, base, productType) {
            var prompt = _origBuildUserPromptRates(ctx, base, productType);

            // Add rate environment for rate products
            if (_isFixedRateProduct(ctx.product) && _ratesData && Object.keys(_ratesData.yields || {}).length > 0) {
                var rateBlock = '\n' + _buildRateContext();
                var mat = ctx.product.maturityYears || 5;
                var rfYield = _getYieldForMaturity(mat);

                rateBlock += '\n\n## ANALYSE PRODUIT TAUX FIXE/CALLABLE';
                rateBlock += '\nRisques sp\u00e9cifiques \u00e0 int\u00e9grer dans ton analyse:';
                rateBlock += '\n1. RISQUE CR\u00c9DIT \u00c9METTEUR: Sans sous-jacent action, le risque principal est le d\u00e9faut de l\'\u00e9metteur.';
                rateBlock += '\n2. RISQUE DE R\u00c9INVESTISSEMENT: Si callable et taux en baisse, l\'\u00e9metteur rappellera → r\u00e9investissement \u00e0 des taux inf\u00e9rieurs.';
                rateBlock += '\n3. RISQUE DE DUR\u00c9E: Sensibilit\u00e9 du prix \u00e0 la hausse des taux. Maturit\u00e9 ' + mat + ' ans → DV01 ~ ' + mat + 'bps par 1% de hausse.';
                if (rfYield != null) {
                    rateBlock += '\n4. CO\u00dbT D\'OPPORTUNIT\u00c9: Coupon ' + (ctx.product.coupon || '?') + '% vs taux sans risque ' + mat + 'Y = ' + rfYield.toFixed(2) + '%. Spread = ' + ((ctx.product.coupon || 0) - rfYield).toFixed(2) + '%.';
                }
                rateBlock += '\n5. SC\u00c9NARIOS obligatoires: (a) Call\u00e9 an 1-3: rendement r\u00e9el + risque r\u00e9invest. (b) Tenu \u00e0 maturit\u00e9: rendement garanti mais immobilis\u00e9. (c) Stress: d\u00e9faut \u00e9metteur.';
                rateBlock += '\n6. INTÈGRE la stratégie obligataire du Market Intelligence si disponible (prefer TIPS? avoid HY? avoid EM bonds?)';
                rateBlock += '\n';

                // Insert before SCORES section
                var scoresIdx = prompt.indexOf('## SCORES DE BASE');
                if (scoresIdx > 0) {
                    prompt = prompt.substring(0, scoresIdx) + rateBlock + '\n' + prompt.substring(scoresIdx);
                } else {
                    prompt += rateBlock;
                }
            }
            return prompt;
        };
        console.log('[Rates-Patch] _buildUserPrompt overridden for rate products (injects ECB yields + bond risks)');

        // ═══ v1.1 FIX: ALSO OVERRIDE _buildSystemPrompt for rate-specific instructions ═══
        var _origBuildSystemPromptRates = _buildSystemPrompt;
        _buildSystemPrompt = function(isInPf, productType) {
            var base = _origBuildSystemPromptRates(isInPf, productType);
            if (productType === 'fixed-rate-callable') {
                base += '\n\nPRODUIT TAUX FIXE/CALLABLE:';
                base += '\nCe produit N\'A PAS de sous-jacent action. Le scoring repose sur:';
                base += '\n- P1: Coupon vs taux sans risque \u00e9quivalent maturit\u00e9 (ECB yield curve)';
                base += '\n- P2: Risque de dur\u00e9e + volatilit\u00e9 des taux + forme de la courbe + direction';
                base += '\n- P4: Spread effectif apr\u00e8s prime d\'illiquidit\u00e9';
                base += '\nFOCUS sur: risque cr\u00e9dit \u00e9metteur, risque de r\u00e9investissement (callable), co\u00fbt d\'opportunit\u00e9 vs CAT.';
                base += '\nUtilise l\'ENVIRONNEMENT TAUX fourni pour tes sc\u00e9narios chiffr\u00e9s.';
                base += '\nUtilise la STRAT\u00c9GIE OBLIGATAIRE du Market Intelligence si pr\u00e9sente.';
            }
            return base;
        };

        // ═══ PRELOAD RATES IN _collectContext ═══
        var _origCollectContextRates = _collectContext;
        _collectContext = async function(product) {
            await _loadRatesData();
            return _origCollectContextRates(product);
        };

        console.log('[StructBoard] Grader Rates Patch v1.1 — callable bonds + MI bond_strategy integrated');
    }, 300);
    setTimeout(function() { clearInterval(_ratesPatchInterval); }, 12000);

    function _isFixedRateProduct(p) {
        if (!p) return false;
        var name = (p.name || '').toLowerCase();
        var type = (p.type || '').toLowerCase();
        if (type.indexOf('taux fixe') >= 0 || type.indexOf('callable') >= 0 || type.indexOf('obligation') >= 0) return true;
        if (name.indexOf('taux fixe') >= 0 || name.indexOf('callable') >= 0 || name.indexOf('fixed rate') >= 0) return true;
        if (name.indexOf('obligation') >= 0 || name.indexOf('bond') >= 0 || name.indexOf('cln') >= 0) return true;
        if (p.underlyings && p.underlyings.length === 0 && p.coupon > 0) return true;
        if (!p.underlyings || p.underlyings.length === 0) {
            if (p.couponType === 'fixe' || p.couponType === 'garanti') return true;
        }
        return false;
    }
})();

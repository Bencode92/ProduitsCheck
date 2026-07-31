// ═══════════════════════════════════════════════════════════════════════════════
// GRADER — P4 (Prime vs CAT) réconcilié avec le panneau « Frais & Rendement net »
//
// Problème : le P4 de base note le COUPON BRUT vs CAT (« 8% vs CAT 2,9% → spread +5,1% »),
// sans pondérer par la proba de coupon ni tenir compte de la marge embarquée. Résultat :
// contradiction directe avec le panneau Frais (qui montre un espéré < CAT). Le grade ne
// tenait que grâce au coup de rabot de l'IA.
//
// Ce patch recalcule P4 sur la MÊME base que le panneau :
//   coupon espéré = coupon × proba ;  moins la marge embarquée annualisée ;  vs CAT.
// Il ne peut que BAISSER P4 (delta ≤ 0, garde-fou), réécrit le raisonnement, et recale le
// score total par delta. Il IGNORE les callable au gré de l'émetteur (déjà traités ailleurs).
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    function _lg(s) { return s >= 75 ? 'A' : s >= 60 ? 'B' : s >= 45 ? 'C' : s >= 25 ? 'D' : 'F'; }
    function _f2(v) { return v.toFixed(2).replace('.', ','); }
    function _f1(v) { return v.toFixed(1).replace('.', ','); }

    function _postProcess(result, product) {
        try {
            if (!result || !result.pillars || !result.pillars.riskPremium) return result;
            if (result.grade === '-' || result.grade === '?') return result;
            // Déjà géré par grader-callable-issuer → ne pas empiler
            if (typeof window._isIssuerCallable === 'function' && window._isIssuerCallable(product)) return result;

            var md = result.metadata || {};
            var cprob = (md.couponProbability != null) ? md.couponProbability / 100 : null;
            // Fallback : si la proba de coupon n'est pas dans les metadata, on l'estime (même
            // source que le grader/panneau) pour ne pas sortir en silence.
            if (cprob == null && typeof window._estimateCouponProb === 'function') {
                try {
                    var est = window._estimateCouponProb(product);
                    if (typeof est === 'number' && isFinite(est) && est > 0) cprob = est > 1 ? est / 100 : est;
                } catch (e) {}
            }
            if (cprob == null || cprob <= 0) return result;   // pas de proba → on ne touche pas

            // Coupon ANNUALISÉ (3,5% semestriel = 7%/an) — sinon la prime vs CAT est calculée
            // sur la moitié/le quart du vrai rendement et P4 s'effondre à tort.
            var coupon = (typeof scoring !== 'undefined' && scoring.annualizedCoupon)
                ? scoring.annualizedCoupon(product)
                : parseFloat(product.coupon && product.coupon.rate);
            if (isNaN(coupon) || coupon <= 0) return result;

            // Marge embarquée annualisée (surcoût que l'investisseur supporte réellement)
            var marginAnnual = 0;
            try {
                if (typeof scoring !== 'undefined' && scoring.getFeeDrag) {
                    var fd = scoring.getFeeDrag(product);
                    marginAnnual = (fd && fd.marginAnnualized) || 0;
                }
            } catch (e) {}

            var cat = parseFloat(md.catRate) ||
                (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._catRate) || 2.8;

            // Coupon ESPÉRÉ (brut, pour comparer à CAT brut) − marge embarquée annualisée
            var couponEspere = coupon * cprob;
            var expectedGross = couponEspere - marginAnnual;
            var spread = expectedGross - cat;

            // Mapping spread → score P4 (ancre : 50 à spread 0, ±5 pts par point de spread)
            var p4honest = Math.max(6, Math.min(90, Math.round(50 + spread * 5)));
            var oldP4 = (typeof result.pillars.riskPremium.score === 'number') ? result.pillars.riskPremium.score : 50;
            // P4 = LA prime vs CAT (net de frais, proba Black-Scholes) → on FIXE la note sur ce calcul
            // honnête (le score colle enfin au texte). Le risque en capital est déjà pesé dans P1 +
            // les scénarios ; le remettre ici le compterait deux fois. Fini le garde-fou "min" qui
            // empêchait la prime réelle (positive) de remonter un P4 de base sous-estimé.
            var newP4 = p4honest;

            // ── vs ACHAT DIRECT : coût d'opportunité des dividendes abandonnés ──────────────
            // En détenant les actions du panier en DIRECT, l'investisseur toucherait leurs
            // dividendes (~div%/an) sans barrière. Le structuré les fait ABANDONNER. La prime du
            // structuré n'est donc réelle que si le coupon net dépasse nettement ce dividende.
            // Facteur BORNÉ et asymétrique (surtout malus) → ne double-compte pas le "vs CAT".
            var basketDiv = parseFloat(md.basketDividend) || parseFloat(product.actualDividendYield) || 0;
            var basketVol = parseFloat(md.basketVol) || 0;
            var vsDirectAdj = 0, gapDirect = null, divAdj = null, volFactor = 1;
            if (basketDiv > 0.3) {                     // seulement les produits sur actions à dividende
                // Détenir l'action en direct = toucher le dividende MAIS encaisser toute sa volatilité.
                // Un gros dividende sur un titre très volatil est un revenu RISQUÉ → on l'escompte par
                // la vol (réf 30%). Haute vol → dividende compte moins car la protection barrière du
                // structuré compense l'abandon de ce dividende risqué. Le structuré se juge donc contre
                // « détenir-l'action-avec-sa-volatilité », pas contre un dividende sans risque.
                volFactor = basketVol > 0 ? Math.max(0.6, Math.min(2.2, basketVol / 30)) : 1;
                divAdj = basketDiv / volFactor;         // dividende risque-ajusté
                gapDirect = expectedGross - divAdj;     // coupon net (protégé) vs dividende risqué
                vsDirectAdj = Math.max(-6, Math.min(3, Math.round((gapDirect - 2.5) * 1.4))); // neutre à +2,5 pts
                newP4 = Math.max(6, Math.min(90, newP4 + vsDirectAdj));
                md.vsDirectGap = Math.round(gapDirect * 10) / 10;
                md.vsDirectAdj = vsDirectAdj;
                md.vsDirectDivAdj = Math.round(divAdj * 10) / 10;
                md.vsDirectVolFactor = Math.round(volFactor * 100) / 100;
            }

            var delta = (newP4 - oldP4) * 0.30;       // poids P4 = 30% (doctrine)
            result.pillars.riskPremium.score = newP4;
            result.pillars.riskPremium.reasoning =
                'Prime vs CAT (net de frais, cohérent avec le panneau) : coupon espéré ' + _f1(couponEspere) +
                '% (' + _f1(coupon) + '% × proba ' + Math.round(cprob * 100) + '%)' +
                (marginAnnual > 0.05 ? ' − marge embarquée ' + _f2(marginAnnual) + '%/an' : '') +
                ' = ' + _f1(expectedGross) + '% vs CAT ' + _f1(cat) + '% → spread ' + (spread >= 0 ? '+' : '') + _f2(spread) + '%.' +
                (gapDirect !== null ? ' | vs achat direct : coupon net ' + _f1(expectedGross) + '% vs dividende panier ' + _f1(basketDiv) + '%' + (volFactor !== 1 ? ' risque-ajusté (vol ' + Math.round(basketVol) + '% → ' + _f1(divAdj) + '%)' : '') + ' = ' + (gapDirect >= 0 ? '+' : '') + _f1(gapDirect) + '% → ' + (vsDirectAdj >= 0 ? '+' : '') + vsDirectAdj + ' pt' + (Math.abs(vsDirectAdj) > 1 ? 's' : '') + '.' : '');

            if (typeof result.score === 'number') {
                result.score = Math.round(result.score + delta);
                result.grade = _lg(result.score);
            }
            if (typeof result.baseScore === 'number') {
                result.baseScore = Math.round(result.baseScore + delta);
            }
            md.p4NetFeesApplied = true;

            // ═══ PLAFOND DE RISQUE — DERNIÈRE OPÉRATION DU PIPELINE ═══
            // p4-netfees est le dernier patch : c'est ICI, après tous les ajustements, qu'on
            // peut garantir qu'un produit à capital NON protégé + barrière en zone "Danger" ne
            // soit jamais noté "Bon" (B). La prime, le fit et l'IA ne maquillent plus le risque
            // de perte en capital. (Le même plafond en v7 était défait par ce patch → ici il tient.)
            try {
                if (typeof result.score === 'number') {
                    var _cp = product.capitalProtection;
                    var _capRisk = !!md.hasBarrier || (!(_cp === true || (_cp && _cp.protected)) && (parseFloat(product.barrier) > 0 || parseFloat((_cp || {}).barrier) > 0));
                    var _danger = !!md.barrier_sigma_danger || (md.barrier_sigma != null && parseFloat(md.barrier_sigma) < 1.0);
                    if (_capRisk && _danger && result.score > 55) {
                        result.score = 55;
                        result.grade = _lg(55);
                        md.riskCapped = true;
                        if (result.keyRisks && result.keyRisks.push && !result.keyRisks.some(function (k) { return ('' + k).indexOf('plafonnée') >= 0; })) {
                            result.keyRisks.push('Note plafonnée (C) : capital non protégé + barrière en zone danger — perte en capital possible.');
                        }
                    }
                }
            } catch (e) { console.warn('[p4-netfees] risk cap error:', e && e.message); }

            // ═══ SCÉNARIOS DÉTERMINISTES — les 3 zones RÉELLES du produit à barrière ═══
            // Le payoff est discret : coupon (≥ barrière coupon) / capital seul (barrière
            // capital → barrière coupon) / perte (< barrière capital). On remplace les 4 cartes
            // "à l'humeur de l'IA" par ces 3 zones, avec les VRAIES probabilités BS du modèle
            // (P(≥barrière) lognormale, drift r−q), pas des % inventés.
            try {
                var _cp2 = product.capitalProtection || {};
                var _isProt2 = _cp2 === true || _cp2.protected === true;
                var _barCap = parseFloat(_cp2.barrier) || parseFloat(product.barrier) || 0;
                var _barCoup = parseFloat(_cp2.barrierCoupon) || parseFloat((product.coupon || {}).trigger) || 70;
                var _vol2 = parseFloat(md.basketVol) || 0;
                var _T2 = parseFloat(md.expectedMaturity) || parseFloat(product.maturityYears) || 5;
                var _divS = parseFloat(md.basketDividend) || 0;
                if (!_isProt2 && _barCap > 0 && _barCap < 100 && _barCoup > _barCap && _vol2 > 0 && _T2 > 0 && coupon > 0) {
                    var _drift = 2.0 - _divS;   // r − q (approx cohérent avec le grade)
                    var _ncdf2 = function (x) { var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, pp = 0.3275911; var s = x < 0 ? -1 : 1; x = Math.abs(x) / Math.SQRT2; var t = 1 / (1 + pp * x); var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x); return 0.5 * (1 + s * y); };
                    var _pAb = function (Kpct) { var K = Kpct / 100, sig = _vol2 / 100, mu = (_drift / 100) - sig * sig / 2; return _ncdf2((Math.log(1 / K) + mu * _T2) / (sig * Math.sqrt(_T2))); };
                    // pWin = proba coupon DÉJÀ affichée dans le panneau (cohérence) ; sinon BS
                    var pWin = (md.couponProbability != null && md.couponProbability > 0)
                        ? Math.max(0.02, Math.min(0.96, md.couponProbability / 100))
                        : Math.max(0.02, Math.min(0.96, _pAb(_barCoup)));
                    var pLoss = Math.max(0.01, Math.min(0.94, 1 - _pAb(_barCap)));
                    var pMid = Math.max(0.01, 1 - pWin - pLoss);
                    var _sum = pWin + pMid + pLoss; pWin /= _sum; pMid /= _sum; pLoss /= _sum;
                    var _nom = parseFloat(product.nominal) > 0 ? parseFloat(product.nominal) : 100000;
                    var winPct = Math.round(coupon * Math.min(_T2, parseFloat(product.maturityYears) || _T2)); // coupons cumulés sur maturité espérée
                    var lossPct = -(100 - Math.round(_barCap * 0.6)); // niveau représentatif sous barrière (~0,6×barrière)
                    result.scenarios = {
                        optimistic: { label: 'Coupon (≥' + Math.round(_barCoup) + '%)', desc: 'capital + coupons', return_pct: winPct, return_eur: Math.round(_nom * winPct / 100), probability: Math.round(pWin * 100) / 100 },
                        stress: { label: 'Capital seul (' + Math.round(_barCap) + '–' + Math.round(_barCoup) + '%)', desc: 'capital rendu, 0 coupon', return_pct: 0, return_eur: 0, probability: Math.round(pMid * 100) / 100 },
                        worst: { label: 'Perte (<' + Math.round(_barCap) + '%)', desc: 'barrière cassée', return_pct: lossPct, return_eur: Math.round(_nom * lossPct / 100), probability: Math.round(pLoss * 100) / 100 }
                    };
                    md.scenariosDeterministic = true;
                }
            } catch (e) { console.warn('[p4-netfees] scenarios error:', e && e.message); }
        } catch (e) {
            console.warn('[p4-netfees] post-process error:', e && e.message);
        }
        return result;
    }

    function _patch() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;
        if (ProposalGrader.grade._p4NetFeesPatched) return true;
        var orig = ProposalGrader.grade;
        ProposalGrader.grade = function (product) {
            var r = orig.call(this, product);
            if (r && typeof r.then === 'function') return r.then(function (res) { return _postProcess(res, product); });
            return _postProcess(r, product);
        };
        ProposalGrader.grade._p4NetFeesPatched = true;
        console.log('[p4-netfees] P4 reconciled with net-of-fees panel');
        return true;
    }

    if (!_patch()) {
        var n = 0;
        var iv = setInterval(function () { if (_patch() || ++n > 60) clearInterval(iv); }, 100);
    }
})();

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
            var newP4 = Math.min(oldP4, p4honest);   // garde-fou : ne peut que baisser

            var delta = (newP4 - oldP4) * 0.30;       // poids P4 = 30% (doctrine)
            result.pillars.riskPremium.score = newP4;
            result.pillars.riskPremium.reasoning =
                'Prime vs CAT (net de frais, cohérent avec le panneau) : coupon espéré ' + _f1(couponEspere) +
                '% (' + _f1(coupon) + '% × proba ' + Math.round(cprob * 100) + '%)' +
                (marginAnnual > 0.05 ? ' − marge embarquée ' + _f2(marginAnnual) + '%/an' : '') +
                ' = ' + _f1(expectedGross) + '% vs CAT ' + _f1(cat) + '% → spread ' + (spread >= 0 ? '+' : '') + _f2(spread) + '%.';

            if (typeof result.score === 'number') {
                result.score = Math.round(result.score + delta);
                result.grade = _lg(result.score);
            }
            if (typeof result.baseScore === 'number') {
                result.baseScore = Math.round(result.baseScore + delta);
            }
            md.p4NetFeesApplied = true;
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

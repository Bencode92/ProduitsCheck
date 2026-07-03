// ═══════════════════════════════════════════════════════════════════════════════
// GRADER — Classe « callable au gré de l'émetteur » (issuer-discretion callable)
//
// Problème : un produit callable À LA DISCRÉTION DE L'ÉMETTEUR (ex. SG « EUROSTOXX
// PERFORMANCE ») n'est PAS un autocall. Le grader v5 le shoehorne dans le template
// autocall → « seuil 100% », « prob maturité 2% », « maturité espérée 2,3a », et compte
// la prime de rappel comme un coupon fiable. FAUX : la banque rappelle quand ÇA L'ARRANGE
// (plafonne ta hausse, ou en cas de baisse de taux). Toute l'optionalité est côté banque.
//
// Ce patch post-traite le résultat final (dernier maillon de la chaîne de grade) :
//   1. Maturité = pleine (pas de rappel favorable supposé) → tue le narratif autocall.
//   2. Prime de rappel = NON fiable → P4/P1 calés sur le cas échéance (rendement fiable ≈ 0).
//   3. Garde-fou : un produit dont le call est 100% côté banque ne peut pas être « Bon » → grade ≤ C.
//   4. Narratif honnête + caveat visible.
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    function _lg(s) { return s >= 75 ? 'A' : s >= 60 ? 'B' : s >= 45 ? 'C' : s >= 25 ? 'D' : 'F'; }

    function _er(p) { return (p && p.earlyRedemption) || (p && p.aiParsed && p.aiParsed.earlyRedemption) || {}; }
    function _txt(p) {
        return (((p && p.mechanism) || '') + ' ' + ((p && p.summary) || '') + ' ' +
            ((p && p.aiParsed && p.aiParsed.mechanism) || '') + ' ' + ((p && p.aiParsed && p.aiParsed.summary) || '')).toLowerCase();
    }

    function _isIssuerCallable(p) {
        if (!p) return false;
        var er = _er(p);
        if (er.atIssuerDiscretion === true) return true;
        var sub = ((p.subType || (p.aiParsed && p.aiParsed.subType)) || '').toLowerCase();
        if (sub.indexOf('issuer_discretion') >= 0 || sub.indexOf('issuer-discretion') >= 0) return true;
        if (p._callableIssuerDiscretion === true || (p.aiParsed && p.aiParsed._callableIssuerDiscretion === true)) return true;
        // Détection texte : « au gré de l'émetteur » + callable
        var isCallable = String(er.type || '').toLowerCase() === 'callable';
        var t = _txt(p);
        var discretion = /gr[eé] de l['’ ]?[eé]metteur|discr[eé]tion de l['’ ]?[eé]metteur|option of the issuer|issuer['’]?s?\s+(sole\s+)?discretion/.test(t);
        return isCallable && discretion;
    }

    function _maxMat(p, result) {
        var md = (result && result.metadata) || {};
        return parseFloat(md.maxMaturity) || parseFloat(p.maturityYears) || (p.aiParsed && parseFloat(p.aiParsed.maturityYears)) || parseFloat(md.expectedMaturity) || 8;
    }

    // Prime de rappel annualisée (pour l'afficher), sans jamais la traiter comme fiable
    function _callPremiumAnnual(p) {
        var c = (p.coupon) || (p.aiParsed && p.aiParsed.coupon) || {};
        if (typeof c === 'number') c = { rate: c };
        var v = parseFloat(c.traabGrossMax);
        if (!isNaN(v) && v > 0) return v;
        var m = parseFloat(c.couponMonthlyAccrual);
        if (!isNaN(m) && m > 0) return Math.round(m * 12 * 100) / 100;
        var freq = String(c.frequency || '').toLowerCase();
        var r = parseFloat(c.rate) || 0;
        if (freq.indexOf('mensuel') >= 0 || freq.indexOf('month') >= 0) return Math.round(r * 12 * 100) / 100;
        return r;
    }

    function _fmt(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }

    function _postProcess(result, product) {
        try {
            if (!result || !result.pillars || result.grade === '-' || result.grade === '?') return result;
            if (!_isIssuerCallable(product)) return result;

            var md = result.metadata = result.metadata || {};
            var maxM = _maxMat(product, result);
            var prem = _callPremiumAnnual(product);
            var cat = parseFloat(md.catRate) ||
                (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._catRate) || 2.8;

            // ── 1. Maturité : pas de rappel favorable supposé → maturité pleine ──
            md.expectedMaturity = maxM;
            md.probReachMaturity = 100;
            md.productClass = 'callable_issuer_discretion';
            md.callableIssuerDiscretion = true;
            md.callPremiumAnnual = prem;

            // ── 2. Nettoyer le narratif autocall dans TOUS les piliers ──
            Object.keys(result.pillars).forEach(function (k) {
                var pl = result.pillars[k];
                if (!pl || !pl.reasoning) return;
                pl.reasoning = pl.reasoning
                    .replace(/Mat(?:urité)?\s*esp[ée]r[ée]e?\s*:?\s*~?-?[\d.,]+\s*a(ns)?\s*\(prob(?:abilité)?\s*mat[^)]*\)/gi, 'Maturité pleine ~' + _fmt(maxM) + 'a (rappel au gré de SG — non fiable)')
                    .replace(/\(prob(?:abilité)?\s*mat[^)]*\)/gi, '(rappel au gré de SG)')
                    .replace(/autocall\s*(?:exigeant[^,.]*|seuil\s*\d+%)/gi, 'callable au gré de l’émetteur (sans seuil de marché)')
                    .replace(/autocall/gi, 'call émetteur');
            });

            // On applique des DELTAS sur le score du moteur (jamais un recalcul complet : le total
            // du moteur mêle base + ajustement IA par pilier, non reproductible ici). Nos plafonds
            // ne peuvent donc que BAISSER le score, jamais le gonfler.
            var W = { adjustedReturn: 0.30, riskPremium: 0.25 };
            var scoreDelta = 0;

            // ── 3. P4 (Prime vs CAT) : rendement FIABLE ≈ 0 (cas échéance), prime de rappel non fiable ──
            var illiq = 1.5 + 0.20 * Math.max(0, maxM - 2);
            var p4spread = 0 - cat - illiq;                 // rendement fiable 0% − CAT − illiquidité
            var p4 = Math.max(6, Math.round(50 + p4spread * 4));
            if (result.pillars.riskPremium) {
                var oldP4 = (typeof result.pillars.riskPremium.score === 'number') ? result.pillars.riskPremium.score : 50;
                var newP4 = Math.min(oldP4, p4);
                scoreDelta += (newP4 - oldP4) * W.riskPremium;
                result.pillars.riskPremium.score = newP4;
                result.pillars.riskPremium.reasoning = 'Prime vs CAT : prime de rappel ~' + _fmt(prem) +
                    '%/an mais AU GRÉ DE SG (non fiable) → rendement fiable ≈ 0% (cas échéance) vs CAT ' + _fmt(cat) +
                    '% − illiq ' + _fmt(illiq) + '% = ' + _fmt(p4spread) + '%. SG rappelle quand ça L’arrange.';
            }

            // ── 4. P1 (Rendement) : capital protégé mais rendement fiable ~0, immobilisation longue ──
            if (result.pillars.adjustedReturn) {
                var p1cap = 38;
                var oldP1 = (typeof result.pillars.adjustedReturn.score === 'number') ? result.pillars.adjustedReturn.score : p1cap;
                var newP1 = Math.min(oldP1, p1cap);
                scoreDelta += (newP1 - oldP1) * W.adjustedReturn;
                result.pillars.adjustedReturn.score = newP1;
                result.pillars.adjustedReturn.reasoning = 'Rendement : le « coupon » est une prime de rappel au gré de l’émetteur (non fiable). ' +
                    'À l’échéance sans rappel : capital + participation plafonnée (min 0%) → net de frais souvent NÉGATIF. ' +
                    (result.pillars.adjustedReturn.reasoning || '');
            }

            // ── 5. Appliquer le delta + garde-fou grade ≤ C (call 100% côté banque ≠ « Bon/Excellent ») ──
            if (typeof result.score === 'number') {
                result.score = Math.min(Math.round(result.score + scoreDelta), 59);
                result.grade = _lg(result.score);
            }
            if (typeof result.baseScore === 'number') {
                result.baseScore = Math.min(Math.round(result.baseScore + scoreDelta), result.score);
            }

            // ── 6. Caveat visible ──
            md.gradeCaveat = '⚠️ Callable AU GRÉ DE L’ÉMETTEUR : grade indicatif (hors modèle autocall). ' +
                'Le vrai rendement = scénarios NETS : négatif dans les cas réalistes, positif seulement si SG rappelle tôt.';
        } catch (e) {
            console.warn('[callable-issuer] post-process error:', e && e.message);
        }
        return result;
    }

    function _patch() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;
        if (ProposalGrader.grade._issuerCallablePatched) return true;
        var orig = ProposalGrader.grade;
        ProposalGrader.grade = function (product) {
            var r = orig.call(this, product);
            if (r && typeof r.then === 'function') return r.then(function (res) { return _postProcess(res, product); });
            return _postProcess(r, product);
        };
        ProposalGrader.grade._issuerCallablePatched = true;
        window._isIssuerCallable = _isIssuerCallable;
        console.log('[callable-issuer] issuer-discretion callable class patched (post-process)');
        return true;
    }

    if (!_patch()) {
        var n = 0;
        var iv = setInterval(function () { if (_patch() || ++n > 60) clearInterval(iv); }, 100);
    }
})();

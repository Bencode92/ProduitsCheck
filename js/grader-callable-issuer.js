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
        if (er.atIssuerDiscretion === true || er.discretionary === true) return true;
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


    // ── Famille « coupon ACQUIS dans tous les cas » (callable in fine à gain fixe par année) ──
    // Ex. Natixis « 4,30 % par année écoulée », CIC « Callable In Fine 4,66 % » : le gain est dû
    // au rappel ET à l'échéance. Le rendement fiable n'est pas 0 mais le PIRE CAS actuariel
    // (généralement l'échéance, car l'intérêt est simple : 4,30 % × 10 = 43 % → 3,64 %/an).
    function _guaranteedYield(p, maxM) {
        var c = (p.coupon) || (p.aiParsed && p.aiParsed.coupon) || {};
        var er = _er(p);
        var rate = parseFloat(c.rate) || 0;
        var rim = parseFloat(c.rateIfMaturity);
        var fixedType = /fixe/.test(String(c.type || '').toLowerCase());
        var sched = Array.isArray(er.callSchedule) ? er.callSchedule : (Array.isArray(p.callSchedule) ? p.callSchedule : []);
        var levels = sched.map(function (x) { return parseFloat(x.amount != null ? x.amount : x.redemptionLevel); }).filter(function (v) { return v > 100; });
        var matLevel = parseFloat(er.maturityRedemptionLevel);
        if (!(matLevel > 100) && rim > 0) matLevel = 100 + (rim <= 15 ? rim * maxM : rim); // rateIfMaturity annuel ou total
        if (!(matLevel > 100) && fixedType && c.guaranteed !== false && rate > 0 && levels.length) matLevel = 100 + rate * maxM;
        if (!(matLevel > 100)) return null; // gain à l'échéance inconnu → famille « prime seulement si rappel »
        var strike = p.strikeDate ? new Date(p.strikeDate) : null;
        var yields = [];
        sched.forEach(function (x, i) {
            var lvl = parseFloat(x.amount != null ? x.amount : x.redemptionLevel); if (!(lvl > 100)) return;
            var d = x.date || x.redemptionDate; var yrs = null;
            if (d && strike) yrs = Math.round((new Date(d) - strike) / 864e5 / 365);
            if (!(yrs > 0)) yrs = (er.startSemester ? Math.round(er.startSemester / 2) : 1) + i;
            yields.push({ year: yrs, level: lvl, y: (Math.pow(lvl / 100, 1 / yrs) - 1) * 100 });
        });
        yields.push({ year: maxM, level: matLevel, y: (Math.pow(matLevel / 100, 1 / maxM) - 1) * 100, maturity: true });
        var worst = yields.reduce(function (a, b) { return b.y < a.y ? b : a; });
        var best = yields.reduce(function (a, b) { return b.y > a.y ? b : a; });
        return { worst: worst, best: best, matLevel: matLevel, simpleRate: rate, points: yields };
    }
    function _issuerName(p) { return (p && (p.emitter || p.guarantor || (p.aiParsed && p.aiParsed.emitter))) || 'l’émetteur'; }

    function _fmt(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }

    function _postProcess(result, product) {
        try {
            if (!result || !result.pillars || result.grade === '-' || result.grade === '?') return result;
            if (!_isIssuerCallable(product)) return result;

            var md = result.metadata = result.metadata || {};
            var maxM = _maxMat(product, result);
            var prem = _callPremiumAnnual(product);
            var cat = parseFloat(md.catRate) ||
                (typeof window._getCATBenchmark === 'function' && parseFloat(window._getCATBenchmark())) ||
                (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._catRate) || 2.8;
            md.catRate = cat;

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
                    .replace(/Mat(?:urité)?\s*esp[ée]r[ée]e?\s*:?\s*~?-?[\d.,]+\s*a(ns)?\s*\(prob(?:abilité)?\s*mat[^)]*\)/gi, 'Maturité pleine ~' + _fmt(maxM) + 'a (rappel au gré de ' + _issuerName(product) + ')')
                    .replace(/\(prob(?:abilité)?\s*mat[^)]*\)/gi, '(rappel au gré de ' + _issuerName(product) + ')')
                    .replace(/autocall\s*(?:exigeant[^,.]*|seuil\s*\d+%)/gi, 'callable au gré de l’émetteur (sans seuil de marché)')
                    .replace(/autocall/gi, 'call émetteur');
            });

            // On applique des DELTAS sur le score du moteur (jamais un recalcul complet : le total
            // du moteur mêle base + ajustement IA par pilier, non reproductible ici). Nos plafonds
            // ne peuvent donc que BAISSER le score, jamais le gonfler.
            var W = { adjustedReturn: 0.30, riskPremium: 0.30 }; // doctrine : P1=P4=0.30
            var scoreDelta = 0;

            var issuer = _issuerName(product);
            var gy = _guaranteedYield(product, maxM);
            var illiq = 1.5 + 0.20 * Math.max(0, maxM - 2);

            if (gy) {
                // ══ Famille B : gain acquis quel que soit le rappel → rendement fiable = pire cas actuariel ══
                var worst = gy.worst.y, best = gy.best.y;
                var fees = parseFloat((product.aiParsed && product.aiParsed.commissions) || (product.fees && product.fees.structuring)) || 0;
                var worstNetFees = worst - fees / maxM;
                md.guaranteedYieldWorst = Math.round(worst * 100) / 100;
                md.guaranteedYieldBest = Math.round(best * 100) / 100;
                md.guaranteedYieldBestYear = gy.best.year;
                md.guaranteedMaturityLevel = gy.matLevel;
                md.couponAnnualized = Math.round(worst * 100) / 100; // le rendement fiable devient le coupon de référence
                md.callableGuaranteedGain = true;
                // P4 : pire cas − CAT − illiquidité
                var p4spreadB = worstNetFees - cat - illiq;
                var p4B = Math.max(6, Math.min(95, Math.round(50 + p4spreadB * 4)));
                if (result.pillars.riskPremium) {
                    var oP4 = (typeof result.pillars.riskPremium.score === 'number') ? result.pillars.riskPremium.score : 50;
                    scoreDelta += (p4B - oP4) * W.riskPremium;
                    result.pillars.riskPremium.score = p4B;
                    result.pillars.riskPremium.reasoning = 'Prime vs CAT (gain acquis dans tous les cas) : pire cas ' + _fmt(worst) + '%/an actuariel' +
                        (gy.worst.maturity ? ' (échéance ' + maxM + ' a, ' + _fmt(gy.matLevel) + '% du nominal)' : ' (rappel an ' + gy.worst.year + ')') +
                        (fees ? ' − commission ' + _fmt(fees) + '% (' + _fmt(fees / maxM) + '%/an)' : '') +
                        ' vs CAT ' + _fmt(cat) + '% − illiquidité ' + _fmt(illiq) + '% = ' + _fmt(p4spreadB) + '%. Meilleur cas ' + _fmt(best) + '%/an si ' + issuer + ' rappelle an ' + gy.best.year +
                        ' — ce qui n’arrive que si les taux BAISSENT.';
                }
                // P1 : plafond modéré (rendement connu, mais immobilisation et pire cas quand les taux montent)
                if (result.pillars.adjustedReturn) {
                    var p1capB = worst >= cat + 1 ? 62 : worst >= cat ? 55 : 45;
                    var oP1 = (typeof result.pillars.adjustedReturn.score === 'number') ? result.pillars.adjustedReturn.score : p1capB;
                    var nP1 = Math.min(oP1, p1capB);
                    scoreDelta += (nP1 - oP1) * W.adjustedReturn;
                    result.pillars.adjustedReturn.score = nP1;
                    result.pillars.adjustedReturn.reasoning = 'Rendement acquis quel que soit le rappel : ' + _fmt(gy.simpleRate) + '%/an d’intérêt simple → ' +
                        _fmt(worst) + '%/an actuariel au pire cas (' + (gy.worst.maturity ? 'échéance ' + maxM + ' a' : 'rappel an ' + gy.worst.year) + '), ' + _fmt(best) + '%/an au mieux (rappel an ' + gy.best.year + '). ' +
                        'Plus tu restes longtemps, moins ça rapporte — et tu restes longtemps précisément quand les taux montent. | Coupon fiable ' + _fmt(worst) + '%, protégé | Maturité pleine ~' + _fmt(maxM) + 'a (rappel au gré de ' + issuer + ')';
                }
                // Scénarios déterministes (plus d’IA) : rappel au meilleur cas / échéance / revente / défaut
                var nom = parseFloat(product.nominal) > 0 ? parseFloat(product.nominal) : 100000;
                var firstCall = gy.points.filter(function (x) { return !x.maturity; }).sort(function (a, b) { return a.year - b.year; })[0];
                var early = firstCall || gy.best;
                result.scenarios = {
                    optimistic: { label: 'Rappelé an ' + early.year + ' (taux en baisse)', desc: 'capital + gain acquis, replacé plus bas', return_pct: Math.round((early.level - 100) * 10) / 10, return_eur: Math.round(nom * (early.level - 100) / 100), probability: 0.3 },
                    base: { label: 'Échéance ' + maxM + ' a (taux stables/hausse)', desc: _fmt(gy.matLevel) + '% du nominal, ' + _fmt(gy.worst.y) + '%/an actuariel, coincé jusqu’au bout', return_pct: Math.round((gy.matLevel - 100) * 10) / 10, return_eur: Math.round(nom * (gy.matLevel - 100) / 100), probability: 0.65 },
                    stress: { label: 'Revente en cours de vie', desc: 'prix de marché : perte non mesurable (≈ −3 % à −10 % si les taux montent)', return_pct: -5, return_eur: -Math.round(nom * 0.05), probability: 0.03 },
                    worst: { label: 'Défaut / résolution ' + issuer, desc: 'bail-in : perte partielle ou totale', return_pct: -60, return_eur: -Math.round(nom * 0.6), probability: 0.02 }
                };
                md.scenariosDeterministic = true;
                // Scénarios régime (calculés par v7 avant ce post-process) : TRI réel du pire cas
                try { if (result.regimeScenarios && result.regimeScenarios.current) result.regimeScenarios.current.desc = 'In fine : pas de cash-flow intermédiaire, ' + _fmt(worst) + '%/an actuariel si tu vas à l’échéance, ' + _fmt(best) + '% si rappel an ' + gy.best.year; } catch (e) {}
                // Delta + plafond ≤ C (option vendue à la banque + 10 ans d’illiquidité ≠ « Bon »)
                if (typeof result.score === 'number') { result.score = Math.min(Math.round(result.score + scoreDelta), 59); result.grade = _lg(result.score); }
                if (typeof result.baseScore === 'number') result.baseScore = Math.min(Math.round(result.baseScore + scoreDelta), result.score);
                md.gradeCaveat = '⚠️ Callable au gré de ' + issuer + ' : gain ' + _fmt(gy.simpleRate) + '%/an acquis dans tous les cas, mais c’est ' + issuer + ' qui choisit la durée : ' +
                    _fmt(best) + '%/an si rappel rapide (taux en baisse), ' + _fmt(worst) + '%/an si tu vas au bout (taux en hausse). Illiquide avant le remboursement.';
                return result;
            }

            // ══ Famille A : prime SEULEMENT si rappel (participation à l’échéance) → rendement fiable ≈ 0 ══
            // ── 3. P4 (Prime vs CAT) ──
            var p4spread = 0 - cat - illiq;                 // rendement fiable 0% − CAT − illiquidité
            var p4 = Math.max(6, Math.round(50 + p4spread * 4));
            if (result.pillars.riskPremium) {
                var oldP4 = (typeof result.pillars.riskPremium.score === 'number') ? result.pillars.riskPremium.score : 50;
                var newP4 = Math.min(oldP4, p4);
                scoreDelta += (newP4 - oldP4) * W.riskPremium;
                result.pillars.riskPremium.score = newP4;
                result.pillars.riskPremium.reasoning = 'Prime vs CAT : prime de rappel ~' + _fmt(prem) +
                    '%/an mais AU GRÉ DE ' + issuer + ' (non fiable) → rendement fiable ≈ 0% (cas échéance) vs CAT ' + _fmt(cat) +
                    '% − illiq ' + _fmt(illiq) + '% = ' + _fmt(p4spread) + '%. ' + issuer + ' rappelle quand ça L’arrange.';
            }
            // ── 4. P1 (Rendement) ──
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
            // ── 5. Delta + garde-fou grade ≤ C ──
            if (typeof result.score === 'number') { result.score = Math.min(Math.round(result.score + scoreDelta), 59); result.grade = _lg(result.score); }
            if (typeof result.baseScore === 'number') result.baseScore = Math.min(Math.round(result.baseScore + scoreDelta), result.score);
            // ── 6. Caveat ──
            md.gradeCaveat = '⚠️ Callable AU GRÉ DE L’ÉMETTEUR : grade indicatif (hors modèle autocall). ' +
                'Le vrai rendement = scénarios NETS : négatif dans les cas réalistes, positif seulement si ' + issuer + ' rappelle tôt.';
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

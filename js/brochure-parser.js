// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Brochure Parser v1.5
// v1.5: Callable rate priority (rateIfCalled) + force fixe + underlyingType none
// v1.4: Infer barrierCoupon from trigger + fix paymentTiming for autocalls
// v1.3: Fix capital_garanti detection + conditionnel coupon type
// v1.2: fix underlyings [object Object]
// v1.1: underlyingType normalization
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var PARSER_PROMPT = [
    'Tu es un parseur expert en produits structurés financiers.',
    'Tu reçois une brochure PDF. Extrais TOUTES les données en JSON strict.',
    '',
    'RÈGLES CRITIQUES :',
    '',
    'STRUCTURE TYPE:',
    '- "remboursement anticipé automatique si sous-jacent ≥ X%" = structureType "autocall"',
    '- "rappelé à la discrétion de l\'émetteur" = structureType "taux_fixe", earlyRedemption.type="callable"',
    '- "performance relative" / "dispersion" / "paire d\'actions" = structureType "dispersion"',
    '- "panier équipondéré" / "niveau du panier" = structureType "basket"',
    '- "taux fixe" sans sous-jacent actions = structureType "taux_fixe"',
    '- "TARN" ou "Target Accrual" ou "somme des coupons cumulés" = structureType "capital_garanti" (PAS range_accrual)',
    '- CAPITAL GARANTI + PAS de remboursement anticipé automatique = structureType "capital_garanti"',
    '  NE PAS confondre observations annuelles de coupon avec autocall.',
    '',
    'COUPON TYPE:',
    '- type="fixe" si coupon versé SANS AUCUNE CONDITION (garanti)',
    '- type="fixe_capitalise" si coupon GARANTI mais versé IN FINE (pas annuellement) — ex: "Callable In Fine"',
    '- type="conditionnel" si coupon dépend d\'une condition (trigger/barrière)',
    '- type="participation" si rendement = participation à la performance',
    '',
    'CALLABLE IN FINE (règle critique):',
    '- "Callable In Fine" ou "coupon de X% par année écoulée" versé au rappel/échéance = structureType "taux_fixe_in_fine"',
    '- Le coupon est GARANTI et FIXE — type="fixe_capitalise", PAS "conditionnel"',
    '- frequency="in_fine" (tout versé d\'un bloc au call ou à maturité, pas annuellement)',
    '- paymentTiming="at_redemption" (versement au rappel ou à échéance seulement)',
    '- guaranteedYears = maturité totale (ex: 10 si 10 ans) car TOUTES les années sont garanties',
    '- "remboursement à 118,64%" = capital 100% + coupon 18,64% = 4 années × 4,66%',
    '- earlyRedemption.type="callable" (pas "autocall" — c\'est l\'émetteur qui décide, pas le marché)',
    '- Lister le callSchedule avec les montants de remboursement par date',
    '',
    'COUPON:',
    '- "coupon de X% par semestre écoulé" → rate=X, frequency="semestriel". Ne JAMAIS multiplier.',
    '- Si rappelé = Z%/an et maturité = W%/an (Z≠W) → rateIfCalled=Z, rateIfMaturity=W',
    '- "participation de X%" = participationRate. type="participation"',
    '- DISPERSION: participationRate = le coefficient appliqué à la dispersion.',
    '  Le rendement = participationRate × dispersion moyenne des paires.',
    '  coupon.rate DOIT être = participationRate (pas 0). type="participation".',
    '  Exemple: "participation de 7%" → coupon.rate=7, participationRate=7, type="participation"',
    '',
    'PAYMENT TIMING:',
    '- paymentTiming="periodic" si le coupon est versé à chaque rappel anticipé ou à chaque période',
    '- paymentTiming="maturity" UNIQUEMENT si le coupon est versé SEULEMENT à maturité (pas à chaque rappel)',
    '- Pour un autocall classique avec coupon versé à chaque rappel → paymentTiming="periodic"',
    '',
    'BARRIÈRE COUPON (capitalProtection.barrierCoupon) — CRITIQUE, NE JAMAIS LAISSER NULL SI COUPON CONDITIONNEL:',
    '- barrierCoupon = seuil pour RECEVOIR le coupon (DIFFÉRENT de barrier qui est le seuil de perte capital)',
    '- AUTOCALL/PHOENIX: "coupon si SJ ≥ 77%" → barrierCoupon=77 ET coupon.trigger=77',
    '- TARN (taux): "coupon si TEC10 ≤ 4.40%" → barrierCoupon=4.40 ET coupon.trigger=4.40',
    '- DIGITALE: "coupon si indice ≤ X%" → barrierCoupon=X ET coupon.trigger=X',
    '- RANGE ACCRUAL: barrierCoupon = borne haute du corridor',
    '- RÈGLE: Si coupon.trigger est rempli, barrierCoupon DOIT aussi être rempli (même valeur)',
    '- "gain versé si baisse ≤ 20%" → barrierCoupon = 80 (= 100 - 20)',
    '',
    'ANNÉES GARANTIES (guaranteedYears):',
    '- Nombre d\'années où le coupon est versé SANS CONDITION (0 si tous conditionnels)',
    '- "coupon garanti les 2 premières années" ou "An 1-2 garantis" → guaranteedYears=2',
    '- "An 1 garanti" ou "première année inconditionnelle" → guaranteedYears=1',
    '- Si aucune mention de coupon garanti → guaranteedYears=0',
    '',
    'CAPITAL:',
    '- "Protection du capital : Non" → protected=false',
    '- "capital garanti" / "garantie en capital à l\'échéance" / "remboursement intégral du capital à l\'échéance" → protected=true, level=100',
    '- Barrière capital = seuil de PERTE (ex: 60% → perte si SJ < 60%)',
    '- "baisse de plus de X%" → barrière = 100-X',
    '- capitalProtection.guaranteeType : "garantie" si VRAIE garantie externe ; "formule" si capital protégé/remboursé à l\'échéance MAIS soumis au risque de crédit émetteur (cas EMTN — la ligne "Garantie en capital" dit souvent "Pas de garantie") ; "barriere" si capital à risque sous une barrière. Indice : un EMTN avec "protection à l\'échéance" + risque émetteur = "formule", PAS "garantie".',
    '- maturityDate : date d\'échéance au format AAAA-MM-JJ si trouvée. strikeDate : Date de Constatation Initiale (AAAA-MM-JJ).',
    '- guarantorRating.fitch : note Fitch si présente (en plus de moodys/sp).',
    '',
    'AUTOCALL:',
    '- "95% dès le semestre 4 puis -2.50%" → trigger=95, startSemester=4, stepDown=true, stepDownPct=2.5',
    '- "au gré de l\'émetteur" → type="callable", trigger=null',
    '',
    'DÉCRÉMENT:',
    '- "prélèvement forfaitaire X%" → decrementPct=X',
    '- "dividendes nets moyens Y%" → actualDividendYield=Y',
    '',
    'MONTANT MINIMUM:',
    '- "valeur nominale unitaire 100 000€" ou "coupure 100 000€" → minInvestment=100000',
    '- "montant minimum de souscription : 1 000€" → minInvestment=1000',
    '- Si non mentionné → minInvestment=null',
    '',
    'UNDERLYING TYPE: "single-index", "single-stock", "worst-of", "basket", "pairs", "none"',
    'UNDERLYINGS: tableau de STRINGS simples uniquement.',
    '',
    '',
    'CHAMPS SPÉCIFIQUES PAR TYPE:',
    '- TARN: guaranteedYears (nb années coupon garanti), autocallCumulTarget (% cumul pour autocall), commissions (%)',
    '- CALLABLE: commissions, earlyRedemption.firstCallDate',
    '- RANGE ACCRUAL: rangeAccrual.lowerBound, rangeAccrual.upperBound, rangeAccrual.reference',
    '- DISPERSION: participationRate, nombre de paires',
    '- TOUS: isin (code ISIN si trouvé), commissions (% TTC si mentionné)',
    'COMMISSIONS — IMPORTANT : si la commission de distribution est exprimée « X% ANNUEL ... sur la durée de vie maximale » (ou « par an sur la durée »), mets commissions=X ET commissionAnnualOverLife=true (le total upfront = X × maturité sera calculé ensuite). Si une commission RÉCURRENTE séparée « Y% annuel » existe en plus, mets commissionRecurringAnnual=Y. Ne confonds pas « X% annuel sur N ans » (= N×X au total) avec « X% une seule fois ».',
    '',
    'SI LE DOCUMENT EST UN KID / DIC PRIIPs (titres "Informations clés", "Indicateur de risque",',
    '"Scénarios de performance", "Quels sont les coûts ?", "Réduction du rendement / RIY") :',
    '- sri : indicateur de risque synthétique, entier 1 à 7',
    '- costEntry : coûts d\'entrée en % (one-off)',
    '- costExit : coûts de sortie en %',
    '- costOngoing : coûts récurrents/de gestion en %/an',
    '- riy : Réduction du Rendement (Reduction in Yield) en %/an à la période de détention recommandée',
    '- scenarios : rendements en % à la période recommandée → {stress, defavorable, median (=intermédiaire/modéré), favorable}',
    '',
    'Réponds UNIQUEMENT avec le JSON. AUCUN texte. AUCUN markdown.',
    '',
    '{"name":"","isin":"","structureType":"","emitter":"","guarantor":"","guarantorRating":{"moodys":"","sp":"","fitch":""},',
    '"underlyings":[],"underlyingType":"","currency":"EUR","maturity":"","maturityYears":0,"maturityDate":null,"strikeDate":null,',
    '"coupon":{"rate":0,"rateIfCalled":null,"rateIfMaturity":null,"type":"","frequency":"","trigger":null,"memory":false,"paymentTiming":""},',
    '"participationRate":null,"guaranteedYears":0,"autocallCumulTarget":null,"commissions":null,"commissionAnnualOverLife":false,"commissionRecurringAnnual":null,',
    '"capitalProtection":{"protected":false,"level":null,"barrier":null,"barrierCoupon":null,"barrierType":"europeenne","guaranteeType":null},',
    '"earlyRedemption":{"possible":false,"type":"","trigger":null,"frequency":"","startSemester":null,"stepDown":false,"stepDownPct":null,"firstCallDate":null,"callSchedule":[]},',
    '"decrementPct":null,"actualDividendYield":null,"minInvestment":null,',
    '"sri":null,"riy":null,"costEntry":null,"costExit":null,"costOngoing":null,"scenarios":{"stress":null,"defavorable":null,"median":null,"favorable":null},',
    '"mechanism":"","risks":[],"summary":""}'
  ].join('\n');

  var STRUCT_OPTS = [
    { v: 'autocall', l: 'Autocall / Phoenix' },
    { v: 'taux_fixe', l: 'Taux fixe / Callable' },
    { v: 'taux_fixe_in_fine', l: 'Callable In Fine' },
    { v: 'range_accrual', l: '📊 Range Accrual' },
    { v: 'capital_garanti', l: 'Capital garanti / TARN' },
    { v: 'digitale_memoire', l: 'Digitale Mémoire' },
    { v: 'dispersion', l: 'Dispersion' },
    { v: 'basket', l: 'Panier équipondéré' },
    { v: 'reverse', l: 'Reverse convertible' },
    { v: 'phoenix_memoire', l: 'Phoenix à mémoire' },
    { v: 'fonds_obligataire', l: 'Fonds obligataire / OPCVM' },
    { v: 'etf', l: 'ETF / Tracker' }
  ];

  var UND_TYPES = ['single-stock', 'single-index', 'worst-of', 'basket', 'pairs', 'rates', 'none'];
  var FREQ_OPTS = [
    { v: 'annuel', l: 'Annuel' },
    { v: 'semestriel', l: 'Semestriel' },
    { v: 'trimestriel', l: 'Trimestriel' },
    { v: 'in_fine', l: 'In Fine (à maturité)' },
    { v: 'à maturité', l: 'À maturité' }
  ];
  var COUPON_TYPES = [
    { v: 'conditionnel', l: 'Conditionnel' },
    { v: 'fixe', l: 'Fixe' },
    { v: 'fixe_capitalise', l: 'Fixe capitalisé (In Fine)' },
    { v: 'participation', l: 'Participation' }
  ];
  var ER_TYPES = [
    { v: 'autocall', l: 'Autocall' },
    { v: 'callable', l: 'Callable (émetteur)' },
    { v: 'tarn', l: 'TARN (cumul coupons)' },
    { v: 'none', l: 'Aucun' }
  ];

  var _phase = 'upload', _data = null, _fileName = '', _error = '', _selectedBank = '', _investedAmount = '', _pdfBase64 = null, _preCategory = '';

  var PRE_CATEGORIES = [
    { v: '', l: '🔍 Auto-détection (Claude devine)' },
    { v: 'taux_fixe', l: '📌 Callable — coupon fixe annuel' },
    { v: 'taux_fixe_in_fine', l: '📅 Callable In Fine — coupon capitalisé' },
    { v: 'capital_garanti', l: '🛡️ TARN / Capital garanti' },
    { v: 'digitale_memoire', l: '🧠 Digitale Mémoire — coupon conditionnel + rattrapage' },
    { v: 'autocall', l: '⚡ Autocall / Phoenix' },
    { v: 'phoenix_memoire', l: '🦅 Phoenix à mémoire' },
    { v: 'range_accrual', l: '📊 Range Accrual' },
    { v: 'basket', l: '🧺 Panier équipondéré' },
    { v: 'dispersion', l: '🔀 Dispersion / Perf. relative' },
    { v: 'reverse', l: '🔄 Reverse convertible' },
    { v: 'fonds_obligataire', l: '💶 Fonds obligataire / OPCVM' },
    { v: 'etf', l: '📈 ETF / Tracker' }
  ];

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function _sel(id, val, opts) {
    var html = '<select id="' + id + '" class="bp-select">';
    opts.forEach(function(o) { var v = typeof o === 'string' ? o : o.v; var l = typeof o === 'string' ? o : o.l;
      html += '<option value="' + esc(v) + '"' + (val === v ? ' selected' : '') + '>' + esc(l) + '</option>'; });
    return html + '</select>';
  }
  function _inp(id, val, type, ph) { type = type || 'text';
    return '<input id="' + id + '" type="' + type + '" value="' + esc(val != null ? String(val) : '') + '"' +
      (ph ? ' placeholder="' + esc(ph) + '"' : '') + (type === 'number' ? ' step="0.01"' : '') + ' class="bp-input">'; }
  function _tog(id, val, label) {
    return '<label class="bp-toggle"><input type="checkbox" id="' + id + '"' + (val ? ' checked' : '') + '>' +
      '<span class="bp-toggle-track"><span class="bp-toggle-thumb"></span></span><span>' + esc(label) + '</span></label>'; }
  function _field(label, content, hint) {
    return '<div class="bp-field"><div class="bp-label">' + esc(label) + '</div>' + content +
      (hint ? '<div class="bp-hint">' + esc(hint) + '</div>' : '') + '</div>'; }
  function _section(title, icon, color, content) {
    return '<div class="bp-section"><div class="bp-section-header" style="border-color:' + color + '">' +
      '<span>' + icon + '</span><span style="color:' + color + '">' + esc(title) + '</span></div>' +
      '<div class="bp-section-grid">' + content + '</div></div>'; }
  function _badge(text, color) {
    return '<span class="bp-badge" style="color:' + color + ';background:' + color + '18;border-color:' + color + '33">' + esc(text) + '</span>'; }
  function _gv(id) { var el = document.getElementById(id); if (!el) return null;
    if (el.type === 'checkbox') return el.checked; if (el.type === 'number') return el.value === '' ? null : parseFloat(el.value); return el.value; }

  function _normalizeStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function(item) { if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.name || item.ticker || item.label || JSON.stringify(item);
      return String(item); }).filter(Boolean);
  }

  // ─── Post-processing (v1.5 — 32 rules) ───
  function _postProcess(data) {
    if (!data) return data;
    var c = data.coupon || {};
    var cp = data.capitalProtection || {};
    var er = data.earlyRedemption || {};

    // ── Mapping KID PRIIPs : coûts standardisés → commissions/fees (champ 🔴 résolu) ──
    var _num = function(x) { var n = parseFloat(x); return isNaN(n) ? null : n; };
    var _ce = _num(data.costEntry), _cx = _num(data.costExit), _co = _num(data.costOngoing);
    if (_ce != null || _cx != null || _co != null) {
      data.fees = data.fees || {};
      if (_ce != null) data.fees.structuring = _ce;
      if (_cx != null) data.fees.exit = _cx;
      if (_co != null) data.fees.custodyAnnual = _co;
      // commissions (marge upfront utilisée par le scoring) ← coût d'entrée KID si non déjà saisi
      if ((data.commissions == null || data.commissions === '') && _ce != null) data.commissions = _ce;
    }

    // Commission « X% ANNUEL sur la durée de vie maximale » → coût UPFRONT total = X × maturité.
    // (ex. Natixis/Swiss Life : 1,00%/an × 8 ans = 8% upfront, pas 1%). + récurrente → droits de garde.
    if (data.commissionAnnualOverLife === true && data.commissions != null && parseFloat(data.maturityYears) > 0) {
      data.commissions = Math.round(parseFloat(data.commissions) * parseFloat(data.maturityYears) * 100) / 100;
    }
    if (data.commissionRecurringAnnual != null && data.commissionRecurringAnnual !== '') {
      data.fees = data.fees || {};
      if (data.fees.custodyAnnual == null) data.fees.custodyAnnual = parseFloat(data.commissionRecurringAnnual);
    }
    // La commission (marge upfront) alimente fees.structuring pour le calcul du net.
    if (data.commissions != null && data.commissions !== '') {
      data.fees = data.fees || {};
      if (data.fees.structuring == null) data.fees.structuring = parseFloat(data.commissions);
    }

    // Type de protection : ne pas survendre « garanti ». Par défaut, un capital protégé à
    // l'échéance reste soumis au risque de crédit émetteur (EMTN) → 'formule', pas 'garantie'.
    if (!cp.guaranteeType) {
      var bar = parseFloat(cp.barrier);
      if (cp.protected === true || parseFloat(cp.level) >= 100) cp.guaranteeType = 'formule';
      else if (!isNaN(bar) && bar > 0) cp.guaranteeType = 'barriere';
      else cp.guaranteeType = 'aucune';
      data.capitalProtection = cp;
    }

    // Autocall : normaliser startSemester en INDEX D'OBSERVATION (le grader compare obs < startSemester).
    // Un autocall ANNUEL rappelable dès l'an 1 doit avoir startSemester = 1, pas 2 (confusion semestre/année).
    if (er.possible) {
      try {
        var _freq = ((data.coupon && data.coupon.frequency) || er.frequency || 'annuel').toLowerCase();
        var _opy = _freq.indexOf('trimestr') >= 0 ? 4 : _freq.indexOf('semestr') >= 0 ? 2 : 1;
        // 1) Source la plus fiable : la date du 1er rappel (firstCallDate ou 1ère ligne du callSchedule)
        var _fcd = er.firstCallDate || (Array.isArray(er.callSchedule) && er.callSchedule[0] && er.callSchedule[0].date) || null;
        if (_fcd && data.strikeDate) {
          var _yrs = (new Date(_fcd) - new Date(data.strikeDate)) / (365.25 * 24 * 3600 * 1000);
          if (_yrs > 0.1) {
            var _idx = Math.max(1, Math.round(_yrs * _opy));
            if (_idx <= (data.maturityYears || 10) * _opy) er.startSemester = _idx;
          }
        } else if (_opy === 1) {
          // 2) Pas de date : autocall ANNUEL → rappelable dès l'an 1 par défaut (cas dominant).
          // Évite que la confusion semestre/année fasse sauter l'autocall de l'an 1.
          er.startSemester = 1;
          data._startCallAssumedYr1 = true; // pour une alerte de vérif ajoutée plus bas
        }
        data.earlyRedemption = er;
      } catch (e) {}
    }

    // Callable AU GRÉ DE L'ÉMETTEUR : classe à part. Le rappel n'est PAS un autocall à seuil ;
    // c'est une option de la BANQUE (elle rappelle quand ça l'arrange → plafonne ta hausse, ou
    // en cas de baisse de taux). Le grader ne doit pas le noter comme un bonus autocall.
    try {
      var _mechTxt = ((data.mechanism || '') + ' ' + (data.summary || '')).toLowerCase();
      var _discretion = /gr[eé] de l['’ ]?[eé]metteur|discr[eé]tion de l['’ ]?[eé]metteur|option of the issuer|issuer['’]?s?\s+(sole\s+)?discretion/.test(_mechTxt);
      if (er.possible && String(er.type).toLowerCase() === 'callable' && (_discretion || er.atIssuerDiscretion === true)) {
        er.atIssuerDiscretion = true;
        er.investorFavorable = false;
        data.earlyRedemption = er;
        data.subType = data.subType || 'callable_issuer_discretion';
        data._callableIssuerDiscretion = true;
      }
    } catch (e) {}

    data.underlyings = _normalizeStringArray(data.underlyings);
    data.risks = _normalizeStringArray(data.risks);

    var ut = (data.underlyingType || '').toLowerCase().trim();
    var UND_MAP = {
      'indice': 'single-index', 'index': 'single-index', 'single index': 'single-index',
      'action': 'single-stock', 'stock': 'single-stock', 'equity': 'single-stock',
      'worst of': 'worst-of', 'worstof': 'worst-of', 'multi': 'worst-of',
      'panier': 'basket', 'equiweight': 'basket',
      'pair': 'pairs', 'paire': 'pairs', 'dispersion': 'pairs',
      'aucun': 'none', 'n/a': 'none', '': 'none'
    };
    if (UND_MAP[ut]) { data.underlyingType = UND_MAP[ut]; }
    else if (UND_TYPES.indexOf(ut) === -1) {
      var n = (data.underlyings || []).length;
      if (n === 0) data.underlyingType = 'none';
      else if (n === 1) { var nm = (data.underlyings[0] || '').toLowerCase();
        if (/tec\s*\d|euribor|cms\s*\d|ester|eonia|libor|swap\s*\d|ois|€str/i.test(nm)) data.underlyingType = 'rates';
        else if (/indice|index|euro|cac|s&p|solactive|stoxx/.test(nm)) data.underlyingType = 'single-index';
        else data.underlyingType = 'single-stock';
      } else data.underlyingType = 'worst-of';
    }
    // Also check mechanism/name for rate references if underlyingType still wrong
    if (data.underlyingType === 'single-stock') {
      var allNames = ((data.underlyings || []).join(' ') + ' ' + (data.mechanism || '') + ' ' + (data.name || '')).toLowerCase();
      if (/tec\s*\d|euribor|cms\s*\d|ester|eonia|libor|€str|taux.*r[eé]f[eé]rence/i.test(allNames)) {
        data.underlyingType = 'rates';
        console.log('[Parser v2] Corrected underlyingType to "rates" (detected rate reference in text)');
      }
    }

    if (cp.protected && cp.level >= 100 && !er.possible) {
      if (data.structureType === 'autocall' || !data.structureType) {
        data.structureType = 'capital_garanti';
      }
    }

    if (c.trigger && c.trigger > 0 && c.type === 'fixe') {
      c.type = 'conditionnel';
    }

    if (!cp.barrierCoupon && er.possible && er.type === 'autocall') {
      var inferredBarrier = c.trigger || er.trigger;
      if (inferredBarrier && inferredBarrier > 0) {
        cp.barrierCoupon = inferredBarrier;
        console.log('[BrochureParser] Inferred barrierCoupon=' + inferredBarrier + '% from ' +
          (c.trigger ? 'coupon.trigger' : 'earlyRedemption.trigger'));
      }
    }

    // Broader barrierCoupon inference for non-autocall products (Phoenix, TARN, Digitale)
    if (!cp.barrierCoupon && c.trigger && c.trigger > 0) {
      cp.barrierCoupon = c.trigger;
      console.log('[BrochureParser] Inferred barrierCoupon=' + c.trigger + ' from coupon.trigger (non-autocall)');
    }

    // Infer guaranteedYears from mechanism/scenarios text
    if (!data.guaranteedYears || data.guaranteedYears === 0) {
      var mechLower = (data.mechanism || '').toLowerCase();
      var scenText = ((data.scenarios && typeof data.scenarios === 'object' && data.scenarios.favorable) || '').toLowerCase();
      var allGuarText = mechLower + ' ' + scenText + ' ' + (data.summary || '').toLowerCase();
      var guarMatch = allGuarText.match(/garanti(?:s|es?)?\s*(?:les\s*)?(\d+)\s*(?:premi[eè]res?)?\s*ann/i) ||
        allGuarText.match(/ann[ée]es?\s*(\d+)\s*(?:à|a)\s*(\d+).*garanti/i) ||
        allGuarText.match(/an\s*1\s*(?:et|[-–]|à)\s*(\d+).*garanti/i);
      if (guarMatch) {
        data.guaranteedYears = parseInt(guarMatch[2] || guarMatch[1]) || 1;
        console.log('[BrochureParser] Inferred guaranteedYears=' + data.guaranteedYears);
      } else if (/an\s*1.*garanti|premi[eè]re\s*ann[ée]e.*garanti|coupon.*garanti.*an\s*1/i.test(allGuarText)) {
        data.guaranteedYears = 1;
        console.log('[BrochureParser] Inferred guaranteedYears=1 (An 1 garanti)');
      } else if (/ann[ée]es?\s*1\s*(?:et|[-–]|à)\s*2.*garanti|garanti.*ann[ée]es?\s*1.*2/i.test(allGuarText)) {
        data.guaranteedYears = 2;
        console.log('[BrochureParser] Inferred guaranteedYears=2 (An 1-2 garantis)');
      }
    }

    if (er.possible && er.type === 'autocall' && c.paymentTiming === 'maturity') {
      c.paymentTiming = 'periodic';
      console.log('[BrochureParser] Autocall -> paymentTiming forced to "periodic"');
    }

    // Callable In Fine auto-correction
    // Detect: callable + (paymentTiming maturity/at_redemption OR "In Fine" in name OR rateIfMaturity > 10)
    var stLower = (data.structureType || '').toLowerCase();
    var nameHasInFine = (data.name || '').toLowerCase().indexOf('in fine') >= 0;
    var hasCallableInFine = (er.type === 'callable' && (c.paymentTiming === 'maturity' || c.paymentTiming === 'at_redemption'));
    var hasHighMaturityRate = c.rateIfMaturity && c.rateIfMaturity > 10; // 46.6% = coupon total capitalise
    if (stLower === 'taux_fixe_in_fine' || nameHasInFine || (hasCallableInFine && hasHighMaturityRate)) {
      data.structureType = 'taux_fixe_in_fine';
      data.type = 'taux_fixe_in_fine';
      if (c.type === 'conditionnel') c.type = 'fixe_capitalise';
      if (c.type === 'fixe') c.type = 'fixe_capitalise';
      c.frequency = 'in_fine';
      c.paymentTiming = 'at_redemption';
      if (!data.guaranteedYears) { data.guaranteedYears = data.maturityYears || 10; }
      // Compute annualized rate from maturity rate if needed
      if (c.rateIfMaturity > 10 && c.rate < 10) {
        c.annualizedRate = c.rate; // 4.66% is already annualized
      }
      console.log('[BrochureParser] Callable In Fine detected and corrected: ' + data.name);
    }

    // Digitale Mémoire auto-detection
    // Detect: conditional coupon + memory + capital guaranteed + no autocall
    var isDigitaleMem = c.memory && c.type === 'conditionnel' && cp.protected && !er.possible;
    var nameHasDigitale = (data.name || '').toLowerCase().indexOf('digitale') >= 0 || (data.name || '').toLowerCase().indexOf('digital') >= 0;
    if (isDigitaleMem || (nameHasDigitale && c.memory)) {
      if (data.structureType !== 'digitale_memoire') {
        data.structureType = 'digitale_memoire';
        data.type = 'digitale_memoire';
        console.log('[BrochureParser] Digitale Mémoire detected: ' + data.name);
      }
    }

    if (c.rate && c.rate > 12) {
      if (c.frequency === 'semestriel' && c.rate > 15) {
        var p = c.rate / 2; if (p >= 2 && p <= 12) c.rate = p;
      } else if (c.frequency === 'annuel' && c.rate > 15) {
        var y = data.maturityYears || 5, pa = c.rate / y; if (pa >= 2 && pa <= 12) c.rate = pa;
      }
    }

    // v1.5: Rate fallback — callable: prefer rateIfCalled (probable scenario)
    if (!c.rate && (c.rateIfCalled || c.rateIfMaturity)) {
      c.rate = (er.type === 'callable') ? (c.rateIfCalled || c.rateIfMaturity) : (c.rateIfMaturity || c.rateIfCalled);
    }

    // v1.5: Callable: coupon type should be "fixe" (no market condition)
    if (er.type === 'callable' && (!c.type || c.type === 'conditionnel')) {
      c.type = 'fixe';
    }

    // v1.5: Callable with no underlyings -> underlyingType = "none"
    if (er.type === 'callable' && (!data.underlyings || data.underlyings.length === 0)) {
      data.underlyingType = 'none';
    }

    if (cp.protected && cp.barrier && cp.barrier < 100) { cp.protected = false; cp.level = null; }

    if (er.type === 'callable' && data.structureType === 'autocall') data.structureType = 'taux_fixe';

    // v1.6: Dispersion fix — ensure coupon.rate = participationRate
    if (data.structureType === 'dispersion') {
      var pr = parseFloat(data.participationRate) || 0;
      if (pr > 0 && (!c.rate || c.rate === 0)) {
        c.rate = pr;
        console.log('[Parser v1.6] Dispersion: coupon.rate set to participationRate ' + pr + '%');
      }
      if (!c.rate && !pr) {
        // Neither parsed — default 7% (typical dispersion participation)
        c.rate = 7;
        data.participationRate = 7;
        console.log('[Parser v1.6] Dispersion: default participationRate 7%');
      }
      c.type = 'participation';
      // Capital always guaranteed for dispersion
      cp.protected = true;
      cp.level = 100;
      cp.barrier = null;
    }

    // v2: Range Accrual detection — check rawText, mechanism, name, AND aiParsed
    var rawText = (data.rawText || '').toLowerCase();
    var mechText = (data.mechanism || '').toLowerCase();
    var nameText = (data.name || '').toLowerCase();
    var allText = rawText + ' ' + mechText + ' ' + nameText;
    // Also check if aiParsed already detected it
    var aiParsedRA = (data.aiParsed && data.aiParsed.structureType === 'range_accrual') ||
      (data.aiParsed && data.aiParsed.rangeAccrual);

    var isRangeAccrual = data.structureType === 'range_accrual' || aiParsedRA ||
      /range\s*accrual/i.test(allText) ||
      /prorata\s*(du|des)\s*nombre\s*de\s*jours/i.test(allText) ||
      /nombre\s*de\s*jours.*cl[oô]ture\s*(entre|dans)/i.test(allText) ||
      /borne\s*basse.*borne\s*haute/i.test(allText);

    if (isRangeAccrual) {
      data.structureType = 'range_accrual';
      data.type = 'range-accrual';
      data.underlyingType = 'rates';
      c.type = 'conditionnel';
      cp.protected = true;
      cp.level = 100;
      cp.barrier = null;
      er.possible = false;

      // Merge rangeAccrual from aiParsed if available
      var aiRA = (data.aiParsed && data.aiParsed.rangeAccrual) || {};
      if (!data.rangeAccrual) data.rangeAccrual = {};
      if (aiRA.observation) data.rangeAccrual.observation = aiRA.observation;
      if (aiRA.lowerBound) data.rangeAccrual.lowerBound = aiRA.lowerBound;
      if (aiRA.upperBound) data.rangeAccrual.upperBound = aiRA.upperBound;
      if (aiRA.reference) data.rangeAccrual.reference = aiRA.reference;

      // Extract corridor bounds from mechanism/rawText
      var boundsMatch = allText.match(/entre\s*(\d+[.,]\d+)\s*%\s*et\s*(\d+[.,]\d+)\s*%/i);
      if (boundsMatch && !data.rangeAccrual.lowerBound) {
        data.rangeAccrual.lowerBound = parseFloat(boundsMatch[1].replace(',', '.'));
        data.rangeAccrual.upperBound = parseFloat(boundsMatch[2].replace(',', '.'));
      }
      var lowerMatch = allText.match(/borne?\s*basse[^0-9]*(\d+[.,]\d+)\s*%/i) || allText.match(/barri[eè]re\s*basse[^0-9]*(\d+[.,]\d+)\s*%/i);
      var upperMatch = allText.match(/borne?\s*haute[^0-9]*(\d+[.,]\d+)\s*%/i) || allText.match(/barri[eè]re\s*haute[^0-9]*(\d+[.,]\d+)\s*%/i);
      if (lowerMatch && !data.rangeAccrual.lowerBound) data.rangeAccrual.lowerBound = parseFloat(lowerMatch[1].replace(',', '.'));
      if (upperMatch && !data.rangeAccrual.upperBound) data.rangeAccrual.upperBound = parseFloat(upperMatch[1].replace(',', '.'));

      // Extract reference rate
      var euriborMatch = allText.match(/euribor\s*(\d+)\s*m/i);
      var cmsMatch = allText.match(/cms\s*(\d+)\s*(ans?|y)/i);
      var tecMatch = allText.match(/tec\s*(\d+)/i);
      if (!data.rangeAccrual.reference) {
        if (euriborMatch) data.rangeAccrual.reference = 'Euribor ' + euriborMatch[1] + ' mois';
        else if (cmsMatch) data.rangeAccrual.reference = 'CMS ' + cmsMatch[1] + ' ans';
        else if (tecMatch) data.rangeAccrual.reference = 'TEC ' + tecMatch[1];
      }
      // Fallback: check underlyings for Euribor
      if (!data.rangeAccrual.reference && data.underlyings) {
        data.underlyings.forEach(function(u) {
          if (/euribor/i.test(u)) {
            var m = u.match(/(\d+)/);
            data.rangeAccrual.reference = 'Euribor ' + (m ? m[1] : '3') + ' mois';
          }
        });
      }

      // Observation type
      if (!data.rangeAccrual.observation) {
        if (/journali[eè]r|daily|chaque\s*jour/i.test(allText)) data.rangeAccrual.observation = 'daily';
        else if (/hebdomadaire|weekly/i.test(allText)) data.rangeAccrual.observation = 'weekly';
        else if (/mensuel|monthly/i.test(allText)) data.rangeAccrual.observation = 'monthly';
        else data.rangeAccrual.observation = 'daily';
      }

      console.log('[Parser v2] Range Accrual detected:', JSON.stringify(data.rangeAccrual));
    }

    // ─── Validation post-parsing: alertes pour champs manquants ──────
    var alerts = [];
    var st = (data.structureType || '').toLowerCase();

    // Validation commune
    if (!data.name) alerts.push('Nom du produit non détecté');
    if (!data.emitter) alerts.push('Émetteur non détecté');
    if (!c.rate && c.rate !== 0) alerts.push('Coupon non détecté');
    if (!data.maturityYears) alerts.push('Maturité non détectée');

    // Validation par type
    if (st === 'capital_garanti' || st === 'tarn') {
      // Les alertes TARN ne valent que pour un VRAI TARN (cumul de coupons) — pas pour un
      // capital protégé à participation ni un callable au gré de l'émetteur (faux positifs).
      var _looksTarn = /tarn|target accrual|cumul/i.test((data.name || '') + ' ' + (data.mechanism || '') + ' ' + (data.summary || '')) || data.autocallCumulTarget != null || (data.guaranteedYears || 0) > 0;
      var _notTarn = (parseFloat(data.participationRate) > 0) || er.atIssuerDiscretion === true || data._callableIssuerDiscretion === true;
      if (_looksTarn && !_notTarn) {
        if (!data.guaranteedYears) alerts.push('⚠️ TARN : Années garanties non détectées (combien d\'années sans condition ?)');
        if (!data.autocallCumulTarget && er.possible) alerts.push('⚠️ TARN : Autocall cumul target non détecté (seuil de cumul pour remboursement)');
      }
      if (!cp.barrierCoupon && c.type === 'conditionnel') alerts.push('⚠️ Barrière coupon non détectée (seuil pour recevoir le coupon)');
      if (data._callableIssuerDiscretion) alerts.push('⚠️ Rappel au gré de l\'ÉMETTEUR (pas un autocall) : l\'optionalité du rappel est côté banque — plafonne ta hausse / risque de réinvestissement. Rendement de rappel NON fiable.');
    }
    if (st === 'autocall' || st === 'phoenix_memoire') {
      if (!cp.barrier && !cp.protected) alerts.push('⚠️ Barrière capital non détectée');
      if (!cp.barrierCoupon && !c.trigger) alerts.push('⚠️ Trigger coupon non détecté');
    }
    if (st === 'taux_fixe_in_fine') {
      if (c.type === 'conditionnel') alerts.push('⚠️ Callable In Fine : le coupon devrait être "fixe" ou "fixe_capitalise", pas "conditionnel"');
      if (c.frequency !== 'in_fine' && c.paymentTiming !== 'at_redemption') alerts.push('⚠️ Callable In Fine : fréquence devrait être "in_fine" (pas annuel)');
      if (!er.callSchedule || !er.callSchedule.length) alerts.push('⚠️ Callable In Fine : callSchedule non détecté (tableau des montants de remboursement par date)');
      if (!c.rateIfMaturity) alerts.push('⚠️ Callable In Fine : rateIfMaturity non détecté (coupon total si pas de call)');
    }
    if (st === 'range_accrual') {
      if (!data.rangeAccrual || !data.rangeAccrual.lowerBound) alerts.push('⚠️ Range Accrual : borne basse non détectée');
      if (!data.rangeAccrual || !data.rangeAccrual.upperBound) alerts.push('⚠️ Range Accrual : borne haute non détectée');
    }
    if (st === 'dispersion') {
      if (!data.participationRate) alerts.push('⚠️ Dispersion : taux de participation non détecté');
    }
    if (!data.commissions) alerts.push('Commissions non détectées (vérifier dans la brochure)');
    if (!data.isin) alerts.push('Code ISIN non détecté');
    if (data._startCallAssumedYr1) alerts.push('ℹ️ Autocall : 1er rappel supposé à l’an 1 (date non extraite) — vérifie s’il y a une période de non-call.');
    if (data.commissionAnnualOverLife) alerts.push('💸 Commission « ' + (parseFloat(data.commissions) / (data.maturityYears || 1)).toFixed(2).replace('.', ',') + '%/an × ' + data.maturityYears + ' ans » = ' + data.commissions + '% upfront (estimation). Le chiffre exact = RIY du KID.');

    // Clarification capital : ne pas confondre « protégé à l'échéance » et « garanti »
    if (cp.protected === true || parseFloat(cp.level) >= 100) {
      if (cp.guaranteeType === 'garantie') alerts.push('✅ Capital garanti (garantie externe)');
      else alerts.push('🛡️ Capital protégé à l’échéance par la formule — NON garanti : risque de crédit émetteur (EMTN, bail-in). Le seul risque sur le capital = l’émetteur. Vérifier la ligne « Garantie en capital » du KID.');
    }

    // Type inconnu
    if (!st || st === 'other' || st === 'autre') {
      alerts.push('🔴 TYPE DE PRODUIT NON RECONNU — vérifiez manuellement le type de structure');
    }

    data._parsingAlerts = alerts;
    if (alerts.length > 0) {
      console.warn('[Parser] Alertes de validation (' + alerts.length + '):', alerts);
    }

    return data;
  }

  function _buildProduct() {
    if (!_data) return null;
    // Use aiParsed structureType as primary if the form still has the default/wrong value
    var formSt = _gv('bp-struct');
    var aiSt = (_data.structureType || '').toLowerCase();
    var st = formSt || aiSt || 'autocall';
    // If form has generic 'autocall' but aiParsed has a more specific type, prefer aiParsed
    if (formSt === 'autocall' && aiSt && aiSt !== 'autocall') st = aiSt;
    var typeMap = { taux_fixe: 'taux-fixe', range_accrual: 'range-accrual', taux_fixe_in_fine: 'taux_fixe_in_fine' };
    // Helper: form value with fallback to aiParsed data
    var dc = _data.coupon || {}, dcp = _data.capitalProtection || {}, der = _data.earlyRedemption || {};
    function _fv(id, fallback) { var v = _gv(id); return (v !== null && v !== undefined && v !== '') ? v : fallback; }

    var years = _fv('bp-years', _data.maturityYears || 10);
    var capProtected = _fv('bp-capprotected', dcp.protected || false);

    var product = {
      name: _fv('bp-name', _data.name || ''),
      type: typeMap[st] || st,
      structureType: st,
      emitter: _fv('bp-emitter', _data.emitter || ''),
      guarantor: _data.guarantor || '', guarantorRating: _data.guarantorRating || null,
      underlyings: (_fv('bp-underlyings', (_data.underlyings || []).join(', ')) || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
      underlyingType: _fv('bp-undtype', _data.underlyingType || 'single-index'),
      currency: _fv('bp-currency', _data.currency || 'EUR'),
      maturity: years + ' ans', maturityYears: years,
      maturityDate: _data.maturityDate || null, strikeDate: _data.strikeDate || null,
      coupon: {
        rate: _fv('bp-rate', dc.rate),
        rateIfCalled: _fv('bp-rateIfCalled', dc.rateIfCalled),
        rateIfMaturity: _fv('bp-rateIfMaturity', dc.rateIfMaturity),
        type: _fv('bp-coupontype', dc.type || 'conditionnel'),
        frequency: _fv('bp-freq', dc.frequency || 'annuel'),
        trigger: _fv('bp-coupontrigger', dc.trigger) || _fv('bp-barriercoupon', dcp.barrierCoupon),
        memory: _fv('bp-memory', dc.memory || false),
        paymentTiming: _fv('bp-timing', dc.paymentTiming || 'periodic')
      },
      participationRate: _fv('bp-participation', _data.participationRate),
      guaranteedYears: _fv('bp-guaranteedyears', _data.guaranteedYears || 0),
      autocallCumulTarget: _fv('bp-autocallcumul', _data.autocallCumulTarget),
      commissions: _fv('bp-commissions', _data.commissions),
      fees: _data.fees || null,
      sri: _data.sri != null ? _data.sri : null,
      riy: _data.riy != null ? _data.riy : null,
      isin: _fv('bp-isin', _data.isin || ''),
      minInvestment: _fv('bp-mininvest', _data.minInvestment),
      capitalProtection: {
        protected: capProtected,
        level: capProtected ? (_fv('bp-caplevel', dcp.level || 100)) : null,
        barrier: _fv('bp-barrier', dcp.barrier),
        barrierCoupon: _fv('bp-barriercoupon', dcp.barrierCoupon),
        barrierType: dcp.barrierType || 'europeenne',
        guaranteeType: dcp.guaranteeType || null
      },
      earlyRedemption: {
        possible: _fv('bp-erpossible', der.possible || false),
        type: _fv('bp-ertype', der.type || 'none'),
        trigger: _fv('bp-ertrigger', der.trigger),
        frequency: _fv('bp-erfreq', der.frequency || 'annuel'),
        startSemester: _fv('bp-erstart', der.startSemester),
        stepDown: _fv('bp-stepdown', der.stepDown || false),
        stepDownPct: _fv('bp-stepdownpct', der.stepDownPct)
      },
      decrementPct: _fv('bp-decrement', _data.decrementPct),
      actualDividendYield: _fv('bp-divyield', _data.actualDividendYield),
      mechanism: _fv('bp-mechanism', _data.mechanism || ''),
      risks: (_fv('bp-risks', (_data.risks || []).join(' · ')) || '').split('·').map(function(s) { return s.trim(); }).filter(Boolean),
      summary: _data.summary || '', scenarios: _data.scenarios || null, aiParsed: _data, sourceFile: _fileName,
      rangeAccrual: st === 'range_accrual' ? {
        lowerBound: parseFloat(String(_gv('bp-ra-lower')).replace(',', '.')) || (_data.rangeAccrual && _data.rangeAccrual.lowerBound) || null,
        upperBound: parseFloat(String(_gv('bp-ra-upper')).replace(',', '.')) || (_data.rangeAccrual && _data.rangeAccrual.upperBound) || null,
        reference: _gv('bp-ra-ref') || (_data.rangeAccrual && _data.rangeAccrual.reference) || 'Euribor 3 mois',
        observation: _gv('bp-ra-obs') || (_data.rangeAccrual && _data.rangeAccrual.observation) || 'daily'
      } : undefined
    };

    // ─── Post-build correction for Callable In Fine ──────
    if (product.structureType === 'taux_fixe_in_fine' || (product.name || '').toLowerCase().indexOf('in fine') >= 0) {
      product.structureType = 'taux_fixe_in_fine';
      product.type = 'taux_fixe_in_fine';
      if (product.coupon) {
        product.coupon.type = 'fixe_capitalise';
        product.coupon.frequency = 'in_fine';
        product.coupon.paymentTiming = 'at_redemption';
      }
      if (!product.guaranteedYears) product.guaranteedYears = product.maturityYears || 10;
      // Copy callSchedule from aiParsed if available
      var cs = (_data.callSchedule) || (_data.earlyRedemption && _data.earlyRedemption.callSchedule) || [];
      if (cs.length && product.earlyRedemption) {
        product.callSchedule = cs;
        product.earlyRedemption.callSchedule = cs;
        product.earlyRedemption.type = 'callable';
        product.earlyRedemption.possible = true;
        product.earlyRedemption.firstCallDate = _data.earlyRedemption && _data.earlyRedemption.firstCallDate || cs[0].date;
      }
      console.log('[BrochureParser] Post-build: Callable In Fine corrected');
    }

    // ─── Propagate callSchedule + firstCallDate for all callable products ──────
    if (product.earlyRedemption && product.earlyRedemption.type === 'callable' && !product.callSchedule) {
      var csAll = (_data.callSchedule) || (_data.earlyRedemption && _data.earlyRedemption.callSchedule) || [];
      if (csAll.length) {
        product.callSchedule = csAll;
        product.earlyRedemption.callSchedule = csAll;
      }
      if (!product.earlyRedemption.firstCallDate) {
        product.earlyRedemption.firstCallDate = (_data.earlyRedemption && _data.earlyRedemption.firstCallDate) || (csAll.length && csAll[0].date) || null;
      }
      // Derive startSemester from firstCallDate if missing
      if (!product.earlyRedemption.startSemester && product.earlyRedemption.firstCallDate) {
        var fcMatch = product.earlyRedemption.firstCallDate.match(/(\d{4})/);
        if (fcMatch) {
          var startYear = parseInt(fcMatch[1]) - 2026;
          if (startYear > 0) product.earlyRedemption.startSemester = startYear * 2;
        }
      }
    }

    return product;
  }

  async function _analyzePDF(file) {
    _fileName = file.name; _error = ''; _phase = 'loading'; _render();
    try {
      var base64 = await new Promise(function(res, rej) { var r = new FileReader();
        r.onload = function() { res(r.result.split(',')[1]); }; r.onerror = function() { rej(new Error('Lecture échouée')); }; r.readAsDataURL(file); });
      _pdfBase64 = base64;
      var resp = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 3000, system: PARSER_PROMPT,
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: _preCategory
              ? 'Analyse cette brochure. Le type de produit est : ' + _preCategory + '. Extrais les données dans le format JSON demandé en utilisant ce type comme structureType.'
              : 'Analyse cette brochure et extrais les données dans le format JSON demandé.' } ]}] }) });
      var result = await resp.json();
      if (result.error) throw new Error(result.error.message || 'Erreur API');
      var text = (result.content || []).map(function(b) { return b.text || ''; }).join('');
      var clean = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      var parsed = JSON.parse(clean);
      if (!parsed.coupon) parsed.coupon = {};
      if (!parsed.capitalProtection) parsed.capitalProtection = {};
      if (!parsed.earlyRedemption) parsed.earlyRedemption = {};
      if (!parsed.underlyings) parsed.underlyings = [];
      if (!parsed.risks) parsed.risks = [];
      if (typeof parsed.coupon === 'number') parsed.coupon = { rate: parsed.coupon };
      // Force structureType from pre-category if user selected one
      if (_preCategory) {
        parsed.structureType = _preCategory;
        console.log('[BrochureParser] Pre-category applied: ' + _preCategory);
      }
      _data = _postProcess(parsed);
      _phase = 'review'; _render();
    } catch(e) { console.error('[BrochureParser] Error:', e); _error = e.message; _phase = 'upload'; _render(); }
  }

  async function _addToStructBoard() {
    if (!_selectedBank) { showToast('Sélectionne une banque', 'error'); return; }
    var product = _buildProduct(); if (!product) return;
    product.investedAmount = parseFloat(_investedAmount) || 0;
    try { var saved = await app.addProposal(_selectedBank, product);
      // Stockage PDF : localStorage (rapide) + GitHub (durable, multi-appareils)
      if (_pdfBase64 && saved && saved.id) {
        try { localStorage.setItem('pdf_' + saved.id, _pdfBase64); } catch(e) { console.warn('[BrochureParser] localStorage PDF KO (quota?):', e.message); }
        try {
          var pdfOk = await app.savePdf(saved.bankId || _selectedBank, saved.id, _pdfBase64, _fileName);
          if (pdfOk) { saved.pdfStored = true; saved.pdfPath = CONFIG.DATA_PATH + '/banks/' + (saved.bankId || _selectedBank) + '/pdfs/' + saved.id + '.json'; await app._saveProductFile(saved.bankId || _selectedBank, saved); }
        } catch(e) { console.warn('[BrochureParser] PDF durable KO:', e.message); }
      }
      showToast('✅ ' + (product.name || 'Produit') + ' ajouté !', 'success');
      if (typeof analyzeProposal === 'function') analyzeProposal(saved).catch(function() {});
      app.openProduct(saved);
      _phase = 'upload'; _data = null; _fileName = ''; _selectedBank = ''; _investedAmount = ''; _pdfBase64 = null; _preCategory = '';
    } catch(e) { showToast('Erreur: ' + e.message, 'error'); } }

  function _copyJSON() { var product = _buildProduct();
    navigator.clipboard.writeText(JSON.stringify(product, null, 2)).then(function() { showToast('✅ JSON copié', 'success'); }); }

  function _render() { var container = document.getElementById('brochure-parser-root'); if (!container) return;
    if (_phase === 'upload') { container.innerHTML = _renderUpload(); _bindUploadEvents(); }
    else if (_phase === 'loading') { container.innerHTML = _renderLoading(); }
    else if (_phase === 'review') { container.innerHTML = _renderReview(); _bindReviewEvents(); }
    else if (_phase === 'bank-select') { container.innerHTML = _renderBankSelect(); _bindBankSelectEvents(); } }

  function _renderUpload() {
    var catOpts = PRE_CATEGORIES.map(function(c) {
      return '<option value="' + esc(c.v) + '"' + (_preCategory === c.v ? ' selected' : '') + '>' + c.l + '</option>';
    }).join('');
    return '<div class="bp-center"><div class="bp-upload-header">' +
      '<div class="bp-upload-title">Analyseur de <span style="color:var(--accent)">Brochure PDF</span></div>' +
      '<div class="bp-upload-sub">Upload → Claude analyse → Tu valides → Ajout direct</div></div>' +
      '<div style="margin-bottom:16px"><div class="bp-label" style="margin-bottom:6px;font-size:11px">TYPE DE PRODUIT (optionnel — accélère le parsing)</div>' +
      '<select id="bp-pre-category" class="bp-select" style="max-width:400px;font-size:13px;padding:10px 12px">' + catOpts + '</select></div>' +
      '<div class="bp-dropzone" id="bp-dropzone"><div style="font-size:36px;margin-bottom:10px;opacity:.5">📄</div>' +
      '<div class="upload-text">Glisse un PDF ici ou clique</div><div class="upload-sub">SocGen, Swiss Life, CIC, Natixis...</div>' +
      '<input type="file" accept=".pdf" id="bp-file-input" style="display:none"></div>' +
      (_error ? '<div class="bp-error">❌ ' + esc(_error) + '</div>' : '') +
      '<div class="bp-steps-row"><div class="bp-step"><div class="bp-step-icon">🔍</div><div class="bp-step-title">Analyse IA</div><div class="bp-step-desc">Claude lit le PDF</div></div>' +
      '<div class="bp-step"><div class="bp-step-icon">✏️</div><div class="bp-step-title">Validation</div><div class="bp-step-desc">Tu vérifies le formulaire</div></div>' +
      '<div class="bp-step"><div class="bp-step-icon">🚀</div><div class="bp-step-title">Ajout direct</div><div class="bp-step-desc">Ajouté à StructBoard</div></div></div></div>'; }

  function _bindUploadEvents() { var dz = document.getElementById('bp-dropzone'), fi = document.getElementById('bp-file-input'), catSel = document.getElementById('bp-pre-category'); if (!dz||!fi) return;
    if (catSel) catSel.addEventListener('change', function() { _preCategory = catSel.value; });
    dz.addEventListener('click', function() { fi.click(); });
    dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', function() { dz.classList.remove('dragover'); });
    dz.addEventListener('drop', function(e) { e.preventDefault(); dz.classList.remove('dragover');
      if (catSel) _preCategory = catSel.value;
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.name.toLowerCase().endsWith('.pdf')) _analyzePDF(f); else { _error = 'Fichier PDF requis'; _render(); } });
    fi.addEventListener('change', function(e) { if (catSel) _preCategory = catSel.value; var f = e.target.files && e.target.files[0]; if (f) _analyzePDF(f); }); }

  function _renderLoading() {
    return '<div class="bp-center" style="min-height:400px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px">' +
      '<div class="spinner" style="width:36px;height:36px;border-width:3px"></div>' +
      '<div style="font-size:14px;font-weight:600;color:var(--accent)">Analyse de ' + esc(_fileName) + '...</div>' +
      '<div style="font-size:11px;color:var(--text-muted)">Claude lit la brochure (10-30s)</div></div>'; }

  function _renderReview() {
    if (!_data) return '';
    var d = _data, c = d.coupon || {}, cp = d.capitalProtection || {}, er = d.earlyRedemption || {};
    var badges = '', sOpt = STRUCT_OPTS.find(function(o) { return o.v === d.structureType; });
    if (sOpt) badges += _badge(sOpt.l, 'var(--accent)');
    if (cp.protected) badges += _badge('Capital garanti', 'var(--green)');
    if (d.decrementPct) badges += _badge('Décrément ' + d.decrementPct + '%', 'var(--red)');
    if (er.stepDown) badges += _badge('Step-down', 'var(--orange)');
    if (er.type === 'callable') badges += _badge('Callable', 'var(--purple)');
    if (d.structureType === 'taux_fixe_in_fine') badges += _badge('Callable In Fine', '#7C3AED');
    if (c.memory) badges += _badge('Mémoire', 'var(--cyan)');
    if (cp.barrierCoupon) badges += _badge('Digitale ' + cp.barrierCoupon + '%', 'var(--orange)');

    // Alertes de validation
    var alerts = d._parsingAlerts || [];
    if (alerts.length > 0) {
      badges += '<div style="width:100%;margin-top:8px">';
      alerts.forEach(function(a) {
        var isError = a.indexOf('🔴') >= 0;
        var isWarn = a.indexOf('⚠️') >= 0;
        var bg = isError ? '#FEF2F2' : isWarn ? '#FEF3C7' : '#EFF6FF';
        var border = isError ? '#FCA5A5' : isWarn ? '#F59E0B' : '#93C5FD';
        var color = isError ? '#DC2626' : isWarn ? '#92400E' : '#1E40AF';
        badges += '<div style="padding:6px 10px;background:' + bg + ';border:1px solid ' + border + ';border-radius:4px;margin-bottom:4px;font-size:11px;color:' + color + '">' + a + '</div>';
      });
      badges += '</div>';
    }

    var html = '<div class="bp-review"><div class="bp-review-header">' +
      '<div style="flex:1;min-width:0"><div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">' + esc(_fileName) + '</div>' +
      '<div class="bp-review-name">' + _inp('bp-name', d.name, 'text', 'Nom du produit') + '</div>' +
      '<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">' + badges + '</div></div>' +
      '<div class="bp-review-actions"><button class="btn" id="bp-btn-reset">↻ Nouveau</button>' +
      '<button class="btn" id="bp-btn-copy" style="font-size:11px">📋 JSON</button>' +
      '<button class="btn primary" id="bp-btn-add">🚀 Ajouter</button></div></div>';

    html += _section('IDENTITÉ', '🏷️', 'var(--accent)',
      _field('Type structure', _sel('bp-struct', d.structureType, STRUCT_OPTS)) +
      _field('Émetteur', _inp('bp-emitter', d.emitter)) + _field('Garant', _inp('bp-guarantor', d.guarantor || '')));
    html += _section('SOUS-JACENTS', '📊', 'var(--purple)',
      '<div class="bp-field bp-span2"><div class="bp-label">Sous-jacents</div>' +
      _inp('bp-underlyings', (d.underlyings || []).join(', '), 'text', 'Virgule') + '</div>' +
      _field('Type', _sel('bp-undtype', d.underlyingType, UND_TYPES)) +
      _field('Devise', _inp('bp-currency', d.currency || 'EUR')) +
      _field('Maturité (ans)', _inp('bp-years', d.maturityYears, 'number')) +
      _field('Décrément (%)', _inp('bp-decrement', d.decrementPct, 'number', '—')));
    html += _section('COUPON', '💰', 'var(--green)',
      _field('Taux (%)', _inp('bp-rate', c.rate, 'number'), 'PAR PÉRIODE') +
      _field('Type', _sel('bp-coupontype', c.type || 'conditionnel', COUPON_TYPES)) +
      _field('Fréquence', _sel('bp-freq', c.frequency || 'annuel', FREQ_OPTS)) +
      _field('Paiement', _sel('bp-timing', c.paymentTiming || 'periodic', [
        { v: 'periodic', l: 'Périodique' },
        { v: 'at_redemption', l: 'Au remboursement (In Fine)' },
        { v: 'maturity', l: 'À maturité' }
      ])) +
      _field('Si rappelé (%)', _inp('bp-rateIfCalled', c.rateIfCalled, 'number', '—')) +
      _field('Si maturité (%)', _inp('bp-rateIfMaturity', c.rateIfMaturity, 'number', '—')) +
      _field('Participation (%)', _inp('bp-participation', d.participationRate, 'number', '—')) +
      _field('Montant min (€)', _inp('bp-mininvest', d.minInvestment, 'number', '—')) +
      _field('Trigger coupon (%)', _inp('bp-coupontrigger', c.trigger, 'number', '—')) +
      '<div class="bp-field">' + _tog('bp-memory', c.memory, 'Coupon à mémoire') + '</div>' +
      _field('Années garanties', _inp('bp-guaranteedyears', d.guaranteedYears, 'number', '0')) +
      _field('Commissions (%)', _inp('bp-commissions', d.commissions, 'number', '—')) +
      _field('ISIN', _inp('bp-isin', d.isin || (d.aiParsed && d.aiParsed.isin) || '', 'text', 'XS...')) +
      _field('Cumul autocall (%)', _inp('bp-autocallcumul', d.autocallCumulTarget, 'number', '—'), 'TARN: seuil cumul coupons'));
    // Call schedule for Callable In Fine
    var callSched = d.callSchedule || (er && er.callSchedule) || [];
    if (d.structureType === 'taux_fixe_in_fine' && callSched.length) {
      var csHtml = '<div class="bp-field bp-span-full"><div class="bp-label">Dates de rappel</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;color:var(--text)">';
      callSched.forEach(function(cs) {
        csHtml += '<div style="padding:4px 8px;background:var(--bg-input);border-radius:4px;border:1px solid var(--border)">' +
          esc(cs.date) + ' → <b>' + cs.amount + '%</b></div>';
      });
      csHtml += '</div></div>';
      html += _section('CALL SCHEDULE', '📅', '#7C3AED', csHtml);
    }
    html += _section('PROTECTION', '🛡️', 'var(--orange)',
      '<div class="bp-field">' + _tog('bp-capprotected', cp.protected, cp.protected ? 'Capital garanti ✓' : 'Non protégé ✗') + '</div>' +
      _field('Niveau (%)', _inp('bp-caplevel', cp.level, 'number', '100')) +
      _field('Barrière capital (%)', _inp('bp-barrier', cp.barrier, 'number', '50')) +
      _field('Barrière coupon (%)', _inp('bp-barriercoupon', cp.barrierCoupon, 'number', '—'), 'Seuil versement gain à maturité'));
    // Range Accrual section (conditional)
    if (d.structureType === 'range_accrual') {
      var ra = d.rangeAccrual || {};
      var raRefOpts = ['Euribor 3 mois', 'Euribor 6 mois', 'Euribor 12 mois', 'CMS 10 ans', 'CMS 2 ans', 'TEC 10', 'Autre'];
      var raObsOpts = [{ v: 'daily', l: 'Journalière' }, { v: 'weekly', l: 'Hebdomadaire' }, { v: 'monthly', l: 'Mensuelle' }];
      html += _section('RANGE ACCRUAL', '📊', '#A855F7',
        _field('Borne basse (%)', _inp('bp-ra-lower', ra.lowerBound, 'number', '1.75')) +
        _field('Borne haute (%)', _inp('bp-ra-upper', ra.upperBound, 'number', '3.50')) +
        _field('Taux de référence', _sel('bp-ra-ref', ra.reference || 'Euribor 3 mois', raRefOpts)) +
        _field('Observation', _sel('bp-ra-obs', ra.observation || 'daily', raObsOpts)));
    }
    html += _section('RAPPEL ANTICIPÉ', '⏰', 'var(--red)',
      '<div class="bp-field">' + _tog('bp-erpossible', er.possible, 'Rappel possible') + '</div>' +
      _field('Type', _sel('bp-ertype', er.type || 'none', ER_TYPES)) +
      _field('Trigger (%)', _inp('bp-ertrigger', er.trigger, 'number', '95')) +
      _field('Fréquence', _sel('bp-erfreq', er.frequency || 'annuel', FREQ_OPTS)) +
      _field('Start (sem.)', _inp('bp-erstart', er.startSemester, 'number', '—')) +
      '<div class="bp-field">' + _tog('bp-stepdown', er.stepDown, 'Step-down') + '</div>' +
      _field('Step (%)', _inp('bp-stepdownpct', er.stepDownPct, 'number', '2.5')) +
      _field('Div réel (%)', _inp('bp-divyield', d.actualDividendYield, 'number', '—')));
    html += _section('MÉCANISME', '⚙️', 'var(--text-dim)',
      '<div class="bp-field bp-span-full"><div class="bp-label">Description</div>' +
      '<textarea id="bp-mechanism" class="bp-textarea">' + esc(d.mechanism || '') + '</textarea></div>' +
      '<div class="bp-field bp-span-full"><div class="bp-label">Risques</div>' +
      _inp('bp-risks', (d.risks || []).join(' · '), 'text', '·') + '</div>');
    return html + '</div>'; }

  function _bindReviewEvents() {
    var r = document.getElementById('bp-btn-reset'), c = document.getElementById('bp-btn-copy'), a = document.getElementById('bp-btn-add');
    if (r) r.addEventListener('click', function() { _phase='upload'; _data=null; _fileName=''; _error=''; _render(); });
    if (c) c.addEventListener('click', _copyJSON);
    if (a) a.addEventListener('click', function() { _phase='bank-select'; _render(); }); }

  function _renderBankSelect() {
    var pn = _data ? _data.name || _fileName : _fileName, em = _data ? _data.emitter || '' : '', ab = '';
    if (em) { var el = em.toLowerCase(); BANKS_LIST.forEach(function(b) { if (el.indexOf(b.name.toLowerCase())>=0||el.indexOf(b.id)>=0) ab=b.id; }); }
    if (ab && !_selectedBank) _selectedBank = ab;
    var html = '<div class="bp-center" style="max-width:560px"><div style="text-align:center;margin-bottom:24px">' +
      '<div style="font-size:16px;font-weight:700;color:var(--text-bright);margin-bottom:6px">Ajouter à StructBoard</div>' +
      '<div style="font-size:12px;color:var(--text-muted)">' + esc(pn) + '</div></div>' +
      '<div style="margin-bottom:20px"><div class="bp-label" style="margin-bottom:8px">Banque source</div><div class="bank-select-grid">';
    BANKS_LIST.forEach(function(b) { var s=_selectedBank===b.id;
      html+='<button class="bank-select-btn'+(s?' selected':'')+ '" data-bank="'+b.id+'" style="--bank-color:'+b.color+';'+(s?'border-color:'+b.color+';background:'+b.color+'12':'')+ '">' +
        '<span class="bank-select-dot" style="background:'+b.color+'"></span>'+esc(b.name)+'</button>'; });
    html+='</div></div><div class="bp-field" style="margin-bottom:24px"><div class="bp-label">Montant (€)</div>' +
      '<input type="number" id="bp-amount" class="bp-input" value="'+esc(_investedAmount)+'" placeholder="Ex: 10000"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="bp-bank-back">← Retour</button>' +
      '<button class="btn primary" id="bp-bank-confirm"'+(!_selectedBank?' disabled':'')+'>✅ Confirmer</button></div></div>';
    return html; }

  function _bindBankSelectEvents() {
    document.querySelectorAll('.bank-select-btn').forEach(function(b){b.addEventListener('click',function(){_selectedBank=b.dataset.bank;_render();});});
    var a=document.getElementById('bp-amount'); if(a) a.addEventListener('input',function(){_investedAmount=a.value;});
    var b=document.getElementById('bp-bank-back'); if(b) b.addEventListener('click',function(){_phase='review';_render();});
    var c=document.getElementById('bp-bank-confirm'); if(c) c.addEventListener('click',_addToStructBoard); }

  window.renderBrochureParser = function(container) { container.innerHTML = '<div class="main" id="brochure-parser-root"></div>'; _render(); };

  var style = document.createElement('style');
  style.textContent = '.bp-center{max-width:640px;margin:0 auto}.bp-upload-header{text-align:center;margin-bottom:32px}.bp-upload-title{font-size:24px;font-weight:800;color:var(--text-bright);line-height:1.3}.bp-upload-sub{font-size:12px;color:var(--text-muted);margin-top:8px}.bp-dropzone{border:2px dashed var(--border);border-radius:var(--radius-lg);padding:48px 24px;text-align:center;cursor:pointer;transition:all .2s;background:var(--bg-card)}.bp-dropzone:hover,.bp-dropzone.dragover{border-color:var(--accent);background:var(--accent-glow)}.bp-error{margin-top:12px;padding:10px 14px;background:var(--red-dim);border:1px solid rgba(248,113,113,.25);border-radius:var(--radius-sm);color:var(--red);font-size:12px}.bp-steps-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:32px}.bp-step{padding:14px;background:var(--bg-card);border-radius:var(--radius);border:1px solid var(--border)}.bp-step-icon{font-size:20px;margin-bottom:6px}.bp-step-title{font-size:11px;font-weight:700;color:var(--text-bright);margin-bottom:4px}.bp-step-desc{font-size:10px;color:var(--text-muted);line-height:1.4}.bp-review-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid var(--border);gap:12px;flex-wrap:wrap}.bp-review-name input{font-size:15px;font-weight:700;width:100%;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text-bright);padding:2px 0;font-family:var(--font);outline:none}.bp-review-name input:focus{border-color:var(--accent)}.bp-review-actions{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap}.bp-section{margin-bottom:18px}.bp-section-header{display:flex;align-items:center;gap:6px;margin-bottom:10px;border-bottom:2px solid;padding-bottom:5px;font-size:12px;font-weight:800;letter-spacing:.3px;text-transform:uppercase}.bp-section-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 14px}.bp-span2{grid-column:span 2}.bp-span-full{grid-column:1/-1}.bp-label{font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px}.bp-hint{font-size:9px;color:var(--text-dim);margin-top:2px}.bp-input,.bp-select{width:100%;padding:7px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:12px;font-family:var(--font);outline:none;box-sizing:border-box;transition:border-color .2s}.bp-input:focus,.bp-select:focus{border-color:var(--border-focus)}.bp-select{cursor:pointer}.bp-select option{background:var(--bg-card);color:var(--text)}.bp-textarea{width:100%;min-height:50px;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:11px;font-family:var(--font);resize:vertical;outline:none;box-sizing:border-box}.bp-textarea:focus{border-color:var(--border-focus)}.bp-toggle{display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:var(--text)}.bp-toggle input{display:none}.bp-toggle-track{width:32px;height:18px;border-radius:9px;background:var(--border);position:relative;transition:.2s;flex-shrink:0}.bp-toggle input:checked+.bp-toggle-track{background:var(--green)}.bp-toggle-thumb{width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:.2s}.bp-toggle input:checked+.bp-toggle-track .bp-toggle-thumb{left:16px}.bp-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;border:1px solid;margin-right:4px}.bank-select-btn.selected{font-weight:700}@media(max-width:768px){.bp-section-grid{grid-template-columns:1fr 1fr}.bp-steps-row{grid-template-columns:1fr}.bp-review-header{flex-direction:column}}';
  document.head.appendChild(style);
  console.log('[StructBoard] Brochure Parser v1.5 loaded');
})();

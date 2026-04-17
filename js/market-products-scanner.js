// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Market Products Scanner v1.0
// Scanne les brochures (data/banks/{bank}/products/*.json) pour extraire les
// produits de taux (taux_fixe, tarn, callable, range_accrual, hybride, cms)
// et leur associer automatiquement un sous-jacent de taux + un seuil.
//
// API (window.MarketProductsScanner) :
//   - scan(bankIds?) → Promise<Array<ProductRef>>
//   - enrich(productRef, ratesJson) → ProductRef + stats
//
// ProductRef = {
//   id, name, bankId, emitter, type, structureType,
//   couponRate, maturityYears, guarantor, rating,
//   rateAlias,        // tec10 | oat5y | euribor3m | ... (deviné)
//   threshold,        // seuil numérique ou null
//   thresholdMode,    // 'below' | 'above' | 'corridor' | null
//   corridorLow, corridorHigh,  // si mode=corridor
//   isRateProduct     // true si on a pu extraire quelque chose d'exploitable
// }
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // Banques connues — on essaie chacune, silencieux si absente
  var DEFAULT_BANKS = ['sg', 'cic', 'swiss-life'];

  // Types de produits considérés comme "produits de taux" pour la page Marché
  var RATE_STRUCTURE_TYPES = [
    'taux_fixe', 'taux-fixe',
    'tarn', 'TARN',
    'callable',
    'range_accrual', 'range-accrual', 'rangeaccrual',
    'hybride', 'hybrid',
    'cms',
    'digital_taux', 'digital-taux'
  ];

  function _isRateType(p) {
    var t = (p.structureType || p.type || '').toString().toLowerCase();
    return RATE_STRUCTURE_TYPES.some(function(rt) { return t === rt.toLowerCase() || t.indexOf(rt.toLowerCase()) >= 0; });
  }

  // ─── Détection du sous-jacent de taux d'après texte ────────────────────────
  //
  // On lit le nom du produit + le mechanism + les risks pour deviner le taux
  // de référence. Mapping prudent : on privilégie un match net.

  var RATE_PATTERNS = [
    { alias: 'tec10',     patterns: [/\bTEC\s*10\b/i, /\bTEC10\b/i, /OAT\s*10[\s-]?ans/i, /OAT\s*10Y/i] },
    { alias: 'oat5y',     patterns: [/OAT\s*5[\s-]?ans/i, /OAT\s*5Y/i, /\bTEC\s*5\b/i] },
    { alias: 'oat2y',     patterns: [/OAT\s*2[\s-]?ans/i, /OAT\s*2Y/i, /\bTEC\s*2\b/i] },
    { alias: 'euribor6m', patterns: [/Euribor\s*6[\s-]?M/i, /EUR6M/i] },
    { alias: 'euribor3m', patterns: [/Euribor\s*3[\s-]?M/i, /EUR3M/i, /Euribor(?!\s*6)/i] },
    { alias: 'cms10y',    patterns: [/CMS\s*10/i] },
    { alias: 'cms2y',     patterns: [/CMS\s*2/i] }
  ];

  function _guessRateAlias(p) {
    var texts = [p.name, p.mechanism, p.summary].concat(p.risks || []).filter(Boolean);
    var joined = texts.join(' | ');
    for (var i = 0; i < RATE_PATTERNS.length; i++) {
      var rp = RATE_PATTERNS[i];
      for (var j = 0; j < rp.patterns.length; j++) {
        if (rp.patterns[j].test(joined)) return rp.alias;
      }
    }
    // Fallback: produit taux_fixe sans sous-jacent → souvent corrélé au 10Y
    var st = (p.structureType || p.type || '').toLowerCase();
    if (st.indexOf('taux') >= 0 || st === 'callable') return 'tec10';
    return null;
  }

  // ─── Extraction du seuil et du mode ────────────────────────────────────────
  //
  // On cherche coupon.trigger en numérique d'abord. Si absent, on regex le
  // mechanism pour des patterns classiques : "si X ≤ 4,40%", "dans [1,50% - 3,80%]"

  function _extractThreshold(p) {
    var c = p.coupon || {};
    var trig = c.trigger;

    // Cas 1: trigger numérique déjà parsé
    if (typeof trig === 'number' && !isNaN(trig)) {
      return { threshold: trig, mode: 'below' }; // par défaut TARN : "si taux ≤ seuil"
    }

    // Cas 2: chaîne dans mechanism à parser
    var text = [p.mechanism, p.summary, p.name].filter(Boolean).join(' ');

    // Corridor : [X% - Y%] ou "entre X% et Y%"
    var mCorr = text.match(/\[\s*(\d+[.,]\d+)\s*%?\s*[-—–]\s*(\d+[.,]\d+)\s*%/i)
              || text.match(/entre\s+(\d+[.,]\d+)\s*%\s+et\s+(\d+[.,]\d+)\s*%/i);
    if (mCorr) {
      var lo = parseFloat(mCorr[1].replace(',', '.'));
      var hi = parseFloat(mCorr[2].replace(',', '.'));
      if (!isNaN(lo) && !isNaN(hi)) {
        return { mode: 'corridor', corridorLow: Math.min(lo,hi), corridorHigh: Math.max(lo,hi) };
      }
    }

    // Seuil simple : "≤ X,XX%" ou "inférieur à X,XX%" ou "ne dépasse pas X,XX%"
    var mBelow = text.match(/(?:≤|<=|inférieur\s+(?:ou\s+égal\s+)?à|ne\s+dépasse\s+pas|au[\s-]?dessous\s+de)\s*(\d+[.,]\d+)\s*%/i);
    if (mBelow) {
      var v = parseFloat(mBelow[1].replace(',', '.'));
      if (!isNaN(v)) return { threshold: v, mode: 'below' };
    }

    // Seuil simple : "≥ X,XX%" ou "supérieur à X,XX%"
    var mAbove = text.match(/(?:≥|>=|supérieur\s+(?:ou\s+égal\s+)?à|au[\s-]?dessus\s+de)\s*(\d+[.,]\d+)\s*%/i);
    if (mAbove) {
      var va = parseFloat(mAbove[1].replace(',', '.'));
      if (!isNaN(va)) return { threshold: va, mode: 'above' };
    }

    return { threshold: null, mode: null };
  }

  // ─── Normalise un produit brochure en ProductRef ──────────────────────────

  function _toProductRef(raw, bankId) {
    var p = raw.aiParsed || raw;
    var extracted = _extractThreshold(p);
    var rateAlias = _guessRateAlias(p);
    var rating = null;
    if (p.guarantorRating) {
      rating = p.guarantorRating.sp || p.guarantorRating.moodys || null;
    }
    return {
      id: raw.id,
      name: raw.name || p.name,
      bankId: bankId,
      emitter: p.emitter || raw.emitter || null,
      guarantor: p.guarantor || null,
      rating: rating,
      type: raw.type || p.type || null,
      structureType: p.structureType || raw.structureType || null,
      couponRate: (p.coupon && p.coupon.rate) || null,
      couponFreq: (p.coupon && p.coupon.frequency) || null,
      maturityYears: p.maturityYears || raw.maturityYears || null,
      capitalProtected: !!(p.capitalProtection && p.capitalProtection.protected),
      capitalProtectionLevel: (p.capitalProtection && p.capitalProtection.level) || null,
      rateAlias: rateAlias,
      threshold: extracted.threshold || null,
      thresholdMode: extracted.mode || null,
      corridorLow:  extracted.corridorLow || null,
      corridorHigh: extracted.corridorHigh || null,
      mechanism: p.mechanism || null,
      summary: p.summary || null,
      grade: (raw.grading && raw.grading.grade) || null,
      scoreGrade: (raw.grading && raw.grading.score) || null,
      isRateProduct: _isRateType(p) || _isRateType(raw),
      hasExploitableSeuil: !!(rateAlias && (extracted.threshold || extracted.mode === 'corridor'))
    };
  }

  // ─── Scan principal ────────────────────────────────────────────────────────

  async function _fetchJson(url) {
    try {
      var r = await fetch(url);
      if (!r.ok) return null;
      return await r.json();
    } catch(e) { return null; }
  }

  async function scan(bankIds) {
    bankIds = bankIds || DEFAULT_BANKS;
    var all = [];
    for (var i = 0; i < bankIds.length; i++) {
      var bk = bankIds[i];
      var idx = await _fetchJson('data/banks/' + bk + '/index.json');
      if (!idx || !Array.isArray(idx.products)) continue;
      for (var j = 0; j < idx.products.length; j++) {
        var entry = idx.products[j];
        var prod = await _fetchJson('data/banks/' + bk + '/products/' + entry.id + '.json');
        if (!prod) continue;
        var ref = _toProductRef(prod, bk);
        if (ref.isRateProduct) all.push(ref);
      }
    }
    return all;
  }

  // ─── Enrichit avec stats de franchissement (suppose MarketAnalyzer chargé) ──

  function enrich(productRef, ratesJson, periodLabel) {
    if (!productRef || !ratesJson || !window.MarketAnalyzer) return productRef;
    if (!productRef.rateAlias) return productRef;

    var rate = window.MarketAnalyzer.resolveRate(ratesJson, productRef.rateAlias);
    if (!rate || !rate.history || rate.history.length === 0) return productRef;

    var history = window.MarketAnalyzer.sliceByPeriod(rate.history, periodLabel || 'MAX');
    var stats = null;

    if (productRef.thresholdMode === 'corridor' && productRef.corridorLow != null && productRef.corridorHigh != null) {
      stats = window.MarketAnalyzer.analyzeCorridor(history, productRef.corridorLow, productRef.corridorHigh);
    } else if (productRef.threshold != null && productRef.thresholdMode) {
      stats = window.MarketAnalyzer.analyzeThreshold(history, productRef.threshold, productRef.thresholdMode);
    }

    return Object.assign({}, productRef, {
      rateLabel:   rate.label,
      rateCurrent: rate.current,
      rateVolBps:  rate.vol,
      stats:       stats,
      period:      periodLabel || 'MAX'
    });
  }

  window.MarketProductsScanner = {
    scan:   scan,
    enrich: enrich,
    RATE_STRUCTURE_TYPES: RATE_STRUCTURE_TYPES,
    RATE_PATTERNS: RATE_PATTERNS
  };

  console.log('[StructBoard] MarketProductsScanner v1.0 loaded');
})();

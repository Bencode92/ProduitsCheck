// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Market Threshold Analyzer v1.0
// Moteur pur (pas de DOM) — calculs réutilisables pour l'analyse de seuils/corridors
// sur une série historique de taux.
//
// API publique (exposée sur window.MarketAnalyzer) :
//   - analyzeThreshold(history, threshold, mode) → stats de franchissement
//   - analyzeCorridor(history, low, high)        → stats range accrual
//   - sliceByPeriod(history, periodLabel)        → découpe 12M/2A/5A/10A/MAX
//   - volatility(history)                         → vol annualisée (bp)
//   - hitProbability(stats, currentValue, volBps) → proba forward simple
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Utilitaires ────────────────────────────────────────────────────────────

  function _num(v) { return typeof v === 'number' && !isNaN(v) ? v : null; }

  function _lastValue(history) {
    if (!Array.isArray(history) || history.length === 0) return null;
    var last = history[history.length - 1];
    return _num(last && last.value);
  }

  // ─── Découpe par période (nombre d'observations selon échantillonnage rates.json) ──
  // NB: rates.json utilise ~120 obs/10ans pour l'historique échantillonné.
  //     Les derniers 6 mois sont quotidiens donc plus denses.
  //     On slice par "observation count" plutôt que par date réelle pour la simplicité.

  var PERIOD_OBS = {
    '12M': 12,
    '2A':  24,
    '5A':  60,
    '10A': 120,
    'MAX': 99999
  };

  function sliceByPeriod(history, periodLabel) {
    if (!Array.isArray(history)) return [];
    var n = PERIOD_OBS[periodLabel] || history.length;
    return history.slice(-Math.min(n, history.length));
  }

  // ─── Volatilité annualisée (bp) ────────────────────────────────────────────
  //
  // ATTENTION / limite connue : calculée sur les variations point-à-point de la
  // série. Si la série est mensuelle, c'est de la vol mensuelle annualisée √12.
  // Si elle est quotidienne, c'est √252. On ne peut pas deviner → on assume
  // mensuel (le cas historique échantillonné de rates.json).
  //
  // Pour du pricing de structurés rigoureux, il faut la vol implicite swaption,
  // pas celle calculée ici. Ce chiffre sert d'ordre de grandeur et pour la
  // proba forward simple (modèle random walk gaussien — approximation grossière).

  function volatility(history, assumeDaily) {
    if (!Array.isArray(history) || history.length < 2) return null;
    var changes = [];
    for (var i = 1; i < history.length; i++) {
      var v1 = _num(history[i].value);
      var v0 = _num(history[i-1].value);
      if (v1 !== null && v0 !== null) changes.push(v1 - v0);
    }
    if (changes.length < 2) return null;
    var mean = changes.reduce(function(a,b){return a+b;}, 0) / changes.length;
    var variance = changes.reduce(function(a,b){return a + (b-mean)*(b-mean);}, 0) / (changes.length - 1);
    var std = Math.sqrt(variance);
    var annualizer = assumeDaily ? Math.sqrt(252) : Math.sqrt(12);
    return Math.round(std * annualizer * 100 * 10) / 10; // bp, 1 décimale
  }

  // ─── Analyse d'un seuil simple ─────────────────────────────────────────────
  //
  // mode: 'above' (≥ seuil) ou 'below' (≤ seuil)
  // Retourne : { timeIn, timeOut, pctIn, pctOut, breaches, maxConsecIn, maxConsecOut,
  //              lastIn, lastOut, currentStatus, marginBps, total, firstDate, lastDate }

  function analyzeThreshold(history, threshold, mode) {
    if (!Array.isArray(history) || history.length === 0) return null;
    if (typeof threshold !== 'number' || isNaN(threshold)) return null;
    mode = mode || 'above';

    function isIn(v) { return mode === 'above' ? v >= threshold : v <= threshold; }

    var timeIn = 0, timeOut = 0, breaches = 0;
    var maxConsecIn = 0, maxConsecOut = 0;
    var curIn = 0, curOut = 0;
    var lastIn = null, lastOut = null, lastState = null;

    for (var i = 0; i < history.length; i++) {
      var v = _num(history[i].value);
      if (v === null) continue;
      var inside = isIn(v);
      if (inside) {
        timeIn++; lastIn = history[i].date;
        curIn++; curOut = 0;
        if (curIn > maxConsecIn) maxConsecIn = curIn;
      } else {
        timeOut++; lastOut = history[i].date;
        curOut++; curIn = 0;
        if (curOut > maxConsecOut) maxConsecOut = curOut;
      }
      if (lastState !== null && lastState !== inside) breaches++;
      lastState = inside;
    }

    var total = timeIn + timeOut;
    var current = _lastValue(history);
    var currentIn = current !== null ? isIn(current) : null;
    var marginBps = current !== null
      ? Math.round((mode === 'above' ? current - threshold : threshold - current) * 100)
      : null;

    return {
      mode: mode,
      threshold: threshold,
      timeIn: timeIn, timeOut: timeOut,
      pctIn: total > 0 ? Math.round(timeIn / total * 100) : 0,
      pctOut: total > 0 ? Math.round(timeOut / total * 100) : 0,
      breaches: breaches,
      maxConsecIn: maxConsecIn, maxConsecOut: maxConsecOut,
      lastIn: lastIn, lastOut: lastOut,
      current: current, currentIn: currentIn,
      marginBps: marginBps,
      total: total,
      firstDate: history[0] && history[0].date,
      lastDate: history[history.length-1] && history[history.length-1].date
    };
  }

  // ─── Analyse d'un corridor [low, high] (Range Accrual) ─────────────────────

  function analyzeCorridor(history, low, high) {
    if (!Array.isArray(history) || history.length === 0) return null;
    if (typeof low !== 'number' || typeof high !== 'number') return null;
    if (low > high) { var t = low; low = high; high = t; }

    function isIn(v) { return v >= low && v <= high; }

    var timeIn = 0, timeOut = 0, breaches = 0;
    var maxConsecIn = 0, maxConsecOut = 0;
    var curIn = 0, curOut = 0;
    var lastIn = null, lastOut = null, lastState = null;

    for (var i = 0; i < history.length; i++) {
      var v = _num(history[i].value);
      if (v === null) continue;
      var inside = isIn(v);
      if (inside) { timeIn++; lastIn = history[i].date; curIn++; curOut = 0; if (curIn > maxConsecIn) maxConsecIn = curIn; }
      else { timeOut++; lastOut = history[i].date; curOut++; curIn = 0; if (curOut > maxConsecOut) maxConsecOut = curOut; }
      if (lastState !== null && lastState !== inside) breaches++;
      lastState = inside;
    }

    var total = timeIn + timeOut;
    var current = _lastValue(history);
    var currentIn = current !== null ? isIn(current) : null;
    // Marge = distance à la borne la plus proche (positive si dans, négative si hors)
    var marginBps = null;
    if (current !== null) {
      if (currentIn) marginBps = Math.round(Math.min(current - low, high - current) * 100);
      else marginBps = Math.round(-Math.min(Math.abs(current - low), Math.abs(current - high)) * 100);
    }

    return {
      mode: 'corridor',
      low: low, high: high,
      timeIn: timeIn, timeOut: timeOut,
      pctIn: total > 0 ? Math.round(timeIn / total * 100) : 0,
      pctOut: total > 0 ? Math.round(timeOut / total * 100) : 0,
      breaches: breaches,
      maxConsecIn: maxConsecIn, maxConsecOut: maxConsecOut,
      lastIn: lastIn, lastOut: lastOut,
      current: current, currentIn: currentIn,
      marginBps: marginBps,
      total: total,
      firstDate: history[0] && history[0].date,
      lastDate: history[history.length-1] && history[history.length-1].date
    };
  }

  // ─── Proba forward très simple (gaussien, 1 an horizon) ────────────────────
  //
  // On estime P(S_T ≥ K) où S_T ~ Normal(S_0, σ²·T) — modèle random walk.
  // LIMITE IMPORTANTE : ignore le drift et mean-reversion. Pour les taux,
  // c'est discutable (les taux mean-revertent). À utiliser comme ordre de
  // grandeur, pas comme pricing. Vol doit être en bp absolus (ex: 17.9 bp/an).

  function normCdf(x) {
    // Approximation d'Abramowitz & Stegun
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var d = 0.3989423 * Math.exp(-x * x / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }

  function hitProbability(currentValue, threshold, volBps, horizonYears, mode) {
    if (typeof currentValue !== 'number' || typeof threshold !== 'number') return null;
    if (typeof volBps !== 'number' || volBps <= 0) return null;
    horizonYears = horizonYears || 1;
    mode = mode || 'above';
    // Convert bp vol to percent units (1% = 100bp)
    var sigma = (volBps / 100) * Math.sqrt(horizonYears);
    var d = (currentValue - threshold) / sigma;
    // P(S_T >= threshold) = 1 - Φ((threshold - S_0)/σ) = Φ(d)
    var pAbove = normCdf(d);
    return Math.round((mode === 'above' ? pAbove : 1 - pAbove) * 10000) / 100; // %
  }

  // ─── Helpers pour extraire l'historique d'un taux depuis rates.json ────────

  function extractHistory(ratesJson, rateKey) {
    if (!ratesJson) return null;
    var y = ratesJson.yields || {};
    var p = ratesJson.policy_rates || {};
    var obj = y[rateKey] || p[rateKey] || null;
    if (!obj) return null;
    return {
      current: obj.current,
      history: obj.history || [],
      date: obj.date,
      name: obj.name || rateKey,
      vol: obj.vol_annualized_bps
    };
  }

  // Map clé lisible → clé rates.json
  var RATE_MAP = {
    tec10:    { section: 'yields',       key: 'oat_fr_10y',  label: 'TEC10 (OAT 10Y)' },
    oat10y:   { section: 'yields',       key: 'oat_fr_10y',  label: 'OAT 10Y' },
    oat5y:    { section: 'yields',       key: 'oat_fr_5y',   label: 'OAT 5Y' },
    oat2y:    { section: 'yields',       key: 'oat_fr_2y',   label: 'OAT 2Y' },
    euribor3m:{ section: 'policy_rates', key: 'euribor_3m',  label: 'Euribor 3M' },
    euribor6m:{ section: 'policy_rates', key: 'euribor_6m',  label: 'Euribor 6M' },
    bce_depot:{ section: 'policy_rates', key: 'ecb_deposit_rate', label: 'BCE Dépôt' },
    bce_main: { section: 'policy_rates', key: 'ecb_main_rate',    label: 'BCE Main Refi' }
  };

  function resolveRate(ratesJson, alias) {
    if (!ratesJson || !alias) return null;
    var m = RATE_MAP[alias.toLowerCase()];
    if (!m) return null;
    var data = ratesJson[m.section] && ratesJson[m.section][m.key];
    if (!data) return null;
    return {
      alias: alias,
      key: m.key,
      label: m.label,
      section: m.section,
      current: data.current,
      history: data.history || [],
      date: data.date,
      vol: data.vol_annualized_bps
    };
  }

  // ─── Expose API ────────────────────────────────────────────────────────────

  window.MarketAnalyzer = {
    analyzeThreshold: analyzeThreshold,
    analyzeCorridor:  analyzeCorridor,
    sliceByPeriod:    sliceByPeriod,
    volatility:       volatility,
    hitProbability:   hitProbability,
    extractHistory:   extractHistory,
    resolveRate:      resolveRate,
    RATE_MAP:         RATE_MAP,
    PERIOD_OBS:       PERIOD_OBS
  };

  console.log('[StructBoard] MarketAnalyzer v1.0 loaded — API: window.MarketAnalyzer');
})();

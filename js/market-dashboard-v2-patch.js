// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Market Dashboard v2 Patch
// Remplace window.renderMarketDashboard par une version avec :
//   1. Header compact (KPI tiles taux + courbe mini)
//   2. Analyseur central "un banquier dit X%" TOUJOURS visible (pas caché)
//   3. Produits brochure de taux en section pliable (toggle)
//   4. Macro/régime/carry en bas, inchangés (réutilise le rendu existant)
//
// URL params supportés :
//   ?rate=tec10&threshold=4.10&mode=above
//   ?rate=euribor3m&low=1.50&high=3.80
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  if (typeof window.renderMarketDashboard !== 'function') {
    console.warn('[market-dashboard-v2-patch] renderMarketDashboard introuvable — patch ignoré');
    return;
  }

  // On préserve l'original pour les sections qu'on ne refait pas
  var _originalRender = window.renderMarketDashboard;

  var _state = {
    rates: null,
    mi: null,
    products: null,
    selectedRate: 'tec10',
    period: '10A',
    threshold: null,
    mode: 'above',
    corridorHigh: null,
    showProducts: true
  };

  // ─── Palette cohérente ─────────────────────────────────────────────────────
  var C = {
    bg: '#F8F9FB', card: '#FFFFFF', border: '#D1D9E6', muted: '#64748B',
    text: '#1A202C', dim: '#94A3B8', input: '#F1F3F7',
    primary: '#2563EB', success: '#059669', warn: '#D97706', danger: '#DC2626',
    purple: '#7C3AED', cyan: '#0891B2'
  };

  var RATE_COLORS = {
    tec10: C.cyan, oat5y: C.primary, oat2y: C.purple,
    euribor3m: C.warn, euribor6m: C.warn,
    bce_depot: C.success, bce_main: C.success
  };

  // ─── Fetch data ────────────────────────────────────────────────────────────
  async function _loadAll() {
    var [ratesR, miR] = await Promise.all([
      fetch('data/market/rates.json').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('data/market/market_intelligence.json').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
    ]);
    _state.rates = ratesR;
    _state.mi = miR;
    if (window.MarketProductsScanner) {
      try { _state.products = await window.MarketProductsScanner.scan(); } catch(e) { _state.products = []; }
    }
  }

  // ─── URL params parsing ────────────────────────────────────────────────────
  function _parseUrlParams() {
    try {
      var qs = window.location.hash.split('?')[1] || window.location.search.slice(1);
      if (!qs) return;
      var p = new URLSearchParams(qs);
      if (p.get('rate')) _state.selectedRate = p.get('rate');
      if (p.get('threshold')) _state.threshold = parseFloat(p.get('threshold'));
      if (p.get('mode')) _state.mode = p.get('mode');
      if (p.get('low') && p.get('high')) {
        _state.threshold = parseFloat(p.get('low'));
        _state.corridorHigh = parseFloat(p.get('high'));
        _state.mode = 'corridor';
      }
      if (p.get('period')) _state.period = p.get('period');
    } catch(e) {}
  }

  // ─── Chart SVG simple (réutilisable) ───────────────────────────────────────
  function _buildChart(history, threshold, mode, corridorHigh, currentVal, rateColor) {
    if (!history || history.length < 2) return '<div style="padding:20px;text-align:center;color:' + C.dim + '">Pas assez de données</div>';

    var W = 720, H = 210, padL = 46, padR = 80, padT = 12, padB = 28;
    var cW = W - padL - padR, cH = H - padT - padB;

    var vals = history.map(function(h){return h.value;});
    var extras = [];
    if (typeof threshold === 'number') extras.push(threshold);
    if (typeof corridorHigh === 'number') extras.push(corridorHigh);
    var yMin = Math.min.apply(null, vals.concat(extras)) - 0.15;
    var yMax = Math.max.apply(null, vals.concat(extras)) + 0.15;
    var yRange = yMax - yMin || 0.3;

    function x(i) { return padL + (i / (history.length - 1)) * cW; }
    function y(v) { return padT + cH - ((v - yMin) / yRange) * cH; }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;font-family:var(--mono,monospace)">';
    svg += '<rect x="' + padL + '" y="' + padT + '" width="' + cW + '" height="' + cH + '" fill="#FAFBFC" rx="4"/>';

    // Grille
    for (var gi = 0; gi <= 4; gi++) {
      var gV = yMin + (yRange * gi / 4), gY = y(gV);
      svg += '<line x1="' + padL + '" y1="' + gY + '" x2="' + (W - padR) + '" y2="' + gY + '" stroke="#E2E8F0" stroke-width="0.5"/>';
      svg += '<text x="' + (padL - 4) + '" y="' + (gY + 3) + '" text-anchor="end" fill="#94A3B8" font-size="9">' + gV.toFixed(2) + '%</text>';
    }

    // Zone corridor ou zone "au-dessus/en-dessous" du seuil
    if (mode === 'corridor' && typeof threshold === 'number' && typeof corridorHigh === 'number') {
      var lo = Math.min(threshold, corridorHigh), hi = Math.max(threshold, corridorHigh);
      var zY1 = y(hi), zY2 = y(lo);
      svg += '<rect x="' + padL + '" y="' + zY1 + '" width="' + cW + '" height="' + (zY2 - zY1) + '" fill="' + C.success + '" opacity="0.10"/>';
    } else if (typeof threshold === 'number') {
      // Zone favorable = là où le produit paie
      var tY = y(threshold);
      if (mode === 'below') {
        svg += '<rect x="' + padL + '" y="' + tY + '" width="' + cW + '" height="' + (padT + cH - tY) + '" fill="' + C.success + '" opacity="0.08"/>';
      } else {
        svg += '<rect x="' + padL + '" y="' + padT + '" width="' + cW + '" height="' + (tY - padT) + '" fill="' + C.success + '" opacity="0.08"/>';
      }
    }

    // Bouts de courbe colorés selon dans/hors zone
    for (var si = 1; si < history.length; si++) {
      var v0 = history[si-1].value, v1 = history[si].value;
      var inside = false;
      if (mode === 'corridor' && typeof threshold === 'number' && typeof corridorHigh === 'number') {
        var lo2 = Math.min(threshold, corridorHigh), hi2 = Math.max(threshold, corridorHigh);
        inside = v1 >= lo2 && v1 <= hi2;
      } else if (typeof threshold === 'number') {
        inside = mode === 'above' ? v1 >= threshold : v1 <= threshold;
      } else inside = true;
      var strokeCol = (typeof threshold === 'number') ? (inside ? C.success : C.danger) : C.primary;
      svg += '<line x1="' + x(si-1).toFixed(1) + '" y1="' + y(v0).toFixed(1) + '" x2="' + x(si).toFixed(1) + '" y2="' + y(v1).toFixed(1) + '" stroke="' + strokeCol + '" stroke-width="1.8" stroke-linecap="round"/>';
    }

    // Ligne de seuil principale
    if (typeof threshold === 'number') {
      var tY2 = y(threshold);
      svg += '<line x1="' + padL + '" y1="' + tY2 + '" x2="' + (W - padR) + '" y2="' + tY2 + '" stroke="' + C.danger + '" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.8"/>';
      // Label dans la marge droite (pas superposé sur la ligne)
      svg += '<text x="' + (W - padR + 4) + '" y="' + (tY2 + 3) + '" fill="' + C.danger + '" font-size="10" font-weight="700">' + threshold.toFixed(2) + '%</text>';
    }
    if (mode === 'corridor' && typeof corridorHigh === 'number') {
      var tY3 = y(corridorHigh);
      svg += '<line x1="' + padL + '" y1="' + tY3 + '" x2="' + (W - padR) + '" y2="' + tY3 + '" stroke="' + C.danger + '" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.8"/>';
      svg += '<text x="' + (W - padR + 4) + '" y="' + (tY3 + 3) + '" fill="' + C.danger + '" font-size="10" font-weight="700">' + corridorHigh.toFixed(2) + '%</text>';
    }

    // Point courant
    var lastI = history.length - 1;
    svg += '<circle cx="' + x(lastI).toFixed(1) + '" cy="' + y(currentVal).toFixed(1) + '" r="5" fill="' + rateColor + '" stroke="#fff" stroke-width="2"/>';
    svg += '<text x="' + (W - padR + 4) + '" y="' + (y(currentVal) + 3).toFixed(1) + '" fill="' + rateColor + '" font-size="11" font-weight="800">' + currentVal.toFixed(2) + '%</text>';

    // Dates
    var dateEvery = Math.max(1, Math.floor(history.length / 5));
    for (var di = 0; di < history.length; di += dateEvery) {
      var dShort = (history[di].date || '').substring(0, 7);
      svg += '<text x="' + x(di).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" fill="#94A3B8" font-size="9">' + dShort + '</text>';
    }

    svg += '</svg>';
    return svg;
  }

  // ─── KPI tile d'un taux ────────────────────────────────────────────────────
  function _renderRateTile(alias) {
    var rate = window.MarketAnalyzer.resolveRate(_state.rates, alias);
    if (!rate) return '';
    var col = RATE_COLORS[alias] || C.primary;
    var active = _state.selectedRate === alias;
    return '<div onclick="__mktV2SelectRate(\'' + alias + '\')" style="' +
      'padding:12px 14px;border-radius:8px;cursor:pointer;background:' + C.card + ';' +
      'border:1px solid ' + (active ? col : C.border) + ';' +
      'border-left:4px solid ' + col + ';' +
      'box-shadow:' + (active ? '0 2px 8px rgba(37,99,235,0.15)' : 'none') + ';' +
      'transition:all .15s">' +
      '<div style="font-size:9px;font-weight:700;color:' + C.dim + ';letter-spacing:.6px;text-transform:uppercase">' + rate.label + '</div>' +
      '<div style="font-family:var(--mono,monospace);font-size:22px;font-weight:800;color:' + col + ';margin:4px 0">' + (rate.current || 0).toFixed(2) + '%</div>' +
      '<div style="font-size:9px;color:' + C.muted + '">' + (rate.vol ? 'Vol ' + rate.vol + 'bp' : 'Pas de vol') + '</div>' +
    '</div>';
  }

  // ─── Panneau analyseur (cœur de la page) ───────────────────────────────────
  function _renderAnalyzerPanel() {
    var rate = window.MarketAnalyzer.resolveRate(_state.rates, _state.selectedRate);
    if (!rate || !rate.history) return '<div style="padding:16px;color:' + C.danger + '">Impossible de charger l\'historique du taux sélectionné.</div>';

    var col = RATE_COLORS[_state.selectedRate] || C.primary;
    var history = window.MarketAnalyzer.sliceByPeriod(rate.history, _state.period);

    // Stats
    var stats = null;
    if (_state.mode === 'corridor' && typeof _state.threshold === 'number' && typeof _state.corridorHigh === 'number') {
      stats = window.MarketAnalyzer.analyzeCorridor(history, _state.threshold, _state.corridorHigh);
    } else if (typeof _state.threshold === 'number') {
      stats = window.MarketAnalyzer.analyzeThreshold(history, _state.threshold, _state.mode);
    }

    var html = '<div style="background:' + C.card + ';border:1px solid ' + C.border + ';border-radius:10px;padding:16px;margin-bottom:16px">';

    // Titre
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">';
    html += '<div style="font-size:15px;font-weight:800;color:' + C.text + '">🎯 <span style="color:' + col + '">' + rate.label + '</span> — analyseur de seuil</div>';
    html += '<div style="display:flex;gap:4px">';
    ['12M','2A','5A','10A','MAX'].forEach(function(p) {
      var a = _state.period === p;
      html += '<button onclick="__mktV2SetPeriod(\'' + p + '\')" style="padding:5px 11px;border-radius:5px;border:1px solid ' + (a ? col : C.border) + ';background:' + (a ? col : '#fff') + ';color:' + (a ? '#fff' : C.muted) + ';font-size:10px;font-weight:700;cursor:pointer">' + p + '</button>';
    });
    html += '</div></div>';

    // Barre d'entrée seuil
    html += '<div style="display:flex;gap:8px;align-items:stretch;background:' + C.input + ';padding:10px;border-radius:8px;margin-bottom:12px;flex-wrap:wrap">';
    html += '<div style="font-size:11px;color:' + C.muted + ';align-self:center">Le banquier m\'a dit : </div>';
    html += '<select id="mkt-v2-mode" onchange="__mktV2ModeChange(this.value)" style="padding:6px 10px;border:1px solid ' + C.border + ';border-radius:5px;font-size:12px;background:#fff;color:' + C.text + '">';
    html += '<option value="above"' + (_state.mode==='above'?' selected':'') + '>Au-dessus ≥</option>';
    html += '<option value="below"' + (_state.mode==='below'?' selected':'') + '>En-dessous ≤</option>';
    html += '<option value="corridor"' + (_state.mode==='corridor'?' selected':'') + '>Dans le range [min — max]</option>';
    html += '</select>';
    html += '<input type="number" id="mkt-v2-t1" step="0.05" placeholder="Ex: 4,10" value="' + (_state.threshold != null ? _state.threshold : '') + '" style="width:100px;padding:6px 10px;border:1px solid ' + C.border + ';border-radius:5px;font-family:var(--mono,monospace);font-size:13px;font-weight:700;background:#fff;color:' + C.text + '">';
    html += '<span style="font-size:12px;color:' + C.muted + ';align-self:center">%</span>';
    html += '<input type="number" id="mkt-v2-t2" step="0.05" placeholder="Borne haute" value="' + (_state.corridorHigh != null ? _state.corridorHigh : '') + '" style="width:100px;padding:6px 10px;border:1px solid ' + C.border + ';border-radius:5px;font-family:var(--mono,monospace);font-size:13px;font-weight:700;background:#fff;color:' + C.text + ';display:' + (_state.mode==='corridor'?'':'none') + '">';
    html += '<span style="font-size:12px;color:' + C.muted + ';align-self:center;display:' + (_state.mode==='corridor'?'':'none') + '" id="mkt-v2-unit2">%</span>';
    html += '<button onclick="__mktV2Analyze()" style="padding:6px 18px;border-radius:5px;border:none;background:' + col + ';color:#fff;font-size:12px;font-weight:700;cursor:pointer">Analyser →</button>';
    if (stats) {
      html += '<button onclick="__mktV2Reset()" style="padding:6px 12px;border-radius:5px;border:1px solid ' + C.border + ';background:#fff;color:' + C.muted + ';font-size:11px;cursor:pointer">Effacer</button>';
    }
    html += '</div>';

    // Chart
    html += '<div style="background:#FAFBFC;border:1px solid #E2E8F0;border-radius:8px;padding:8px;margin-bottom:12px">';
    html += _buildChart(history, _state.threshold, _state.mode, _state.corridorHigh, rate.current || 0, col);
    html += '</div>';

    // Stats
    html += _renderStatsBar(stats, rate, history);

    html += '</div>';
    return html;
  }

  // ─── Barre de stats (6 KPI compacts) ───────────────────────────────────────
  function _renderStatsBar(stats, rate, history) {
    if (!stats) {
      // Pas de seuil → stats basiques de la période
      if (!history || history.length < 2) return '';
      var vs = history.map(function(h){return h.value;});
      var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
      var avg = vs.reduce(function(a,b){return a+b;},0) / vs.length;
      return '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' +
        '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
          '<div style="font-size:9px;color:' + C.muted + '">ACTUEL</div>' +
          '<div style="font-family:var(--mono,monospace);font-size:18px;font-weight:800;color:' + C.primary + '">' + (rate.current || 0).toFixed(2) + '%</div></div>' +
        '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
          '<div style="font-size:9px;color:' + C.muted + '">MIN PÉRIODE</div>' +
          '<div style="font-family:var(--mono,monospace);font-size:18px;font-weight:800;color:' + C.success + '">' + mn.toFixed(3) + '%</div></div>' +
        '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
          '<div style="font-size:9px;color:' + C.muted + '">MAX PÉRIODE</div>' +
          '<div style="font-family:var(--mono,monospace);font-size:18px;font-weight:800;color:' + C.danger + '">' + mx.toFixed(3) + '%</div></div>' +
        '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
          '<div style="font-size:9px;color:' + C.muted + '">MOYENNE</div>' +
          '<div style="font-family:var(--mono,monospace);font-size:18px;font-weight:800;color:' + C.purple + '">' + avg.toFixed(3) + '%</div></div>' +
      '</div>' +
      '<div style="margin-top:6px;font-size:10px;color:' + C.muted + ';text-align:center">' +
      history.length + ' obs · ' + history[0].date + ' → ' + history[history.length-1].date + ' — ' +
      '<span style="color:' + C.primary + ';font-weight:600">Entrez un seuil pour voir le % de temps au-dessus/en-dessous</span></div>';
    }

    // Stats avec seuil
    var thresholdDesc = stats.mode === 'corridor'
      ? 'dans [' + stats.low.toFixed(2) + '% — ' + stats.high.toFixed(2) + '%]'
      : (stats.mode === 'above' ? '≥ ' : '≤ ') + stats.threshold.toFixed(2) + '%';

    var condMet = stats.currentIn;
    var pctGood = stats.pctIn;
    var goodColor = pctGood >= 80 ? C.success : pctGood >= 50 ? C.warn : C.danger;

    var html = '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">';

    // 1. Statut actuel
    html += '<div style="padding:10px;background:' + (condMet ? '#ECFDF5' : '#FEF2F2') + ';border:1px solid ' + (condMet ? C.success : C.danger) + ';border-radius:6px;text-align:center">' +
      '<div style="font-size:9px;color:' + C.muted + '">AUJOURD\'HUI</div>' +
      '<div style="font-family:var(--mono,monospace);font-size:16px;font-weight:800;color:' + (condMet ? C.success : C.danger) + '">' + (condMet ? '✅ DANS' : '❌ HORS') + '</div>' +
      '<div style="font-size:9px;color:' + C.muted + '">' + (stats.current != null ? stats.current.toFixed(2) + '%' : '?') + '</div></div>';

    // 2. % temps dans
    html += '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
      '<div style="font-size:9px;color:' + C.muted + '">% TEMPS ' + thresholdDesc.toUpperCase() + '</div>' +
      '<div style="font-family:var(--mono,monospace);font-size:20px;font-weight:800;color:' + goodColor + '">' + pctGood + '%</div>' +
      '<div style="font-size:9px;color:' + C.muted + '">' + stats.timeIn + '/' + stats.total + ' obs</div></div>';

    // 3. % temps hors
    html += '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
      '<div style="font-size:9px;color:' + C.muted + '">% TEMPS HORS</div>' +
      '<div style="font-family:var(--mono,monospace);font-size:20px;font-weight:800;color:' + (stats.pctOut > 20 ? C.danger : C.muted) + '">' + stats.pctOut + '%</div>' +
      '<div style="font-size:9px;color:' + C.muted + '">' + stats.timeOut + '/' + stats.total + ' obs</div></div>';

    // 4. Franchissements
    html += '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
      '<div style="font-size:9px;color:' + C.muted + '">FRANCHISSEMENTS</div>' +
      '<div style="font-family:var(--mono,monospace);font-size:20px;font-weight:800;color:' + C.purple + '">' + stats.breaches + '</div>' +
      '<div style="font-size:9px;color:' + C.muted + '">croisements</div></div>';

    // 5. Max consécutif hors
    html += '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
      '<div style="font-size:9px;color:' + C.muted + '">PIRE ÉPISODE HORS</div>' +
      '<div style="font-family:var(--mono,monospace);font-size:20px;font-weight:800;color:' + C.danger + '">' + stats.maxConsecOut + '</div>' +
      '<div style="font-size:9px;color:' + C.muted + '">obs consécutives</div></div>';

    // 6. Marge actuelle
    html += '<div style="padding:10px;background:' + C.input + ';border-radius:6px;text-align:center">' +
      '<div style="font-size:9px;color:' + C.muted + '">MARGE ACTUELLE</div>' +
      '<div style="font-family:var(--mono,monospace);font-size:20px;font-weight:800;color:' + ((stats.marginBps || 0) >= 0 ? C.success : C.danger) + '">' + ((stats.marginBps || 0) >= 0 ? '+' : '') + (stats.marginBps != null ? stats.marginBps : '?') + 'bp</div>' +
      '<div style="font-size:9px;color:' + C.muted + '">vs borne</div></div>';

    html += '</div>';

    // Ligne contextuelle
    var lastBreachDate = stats.mode === 'corridor' ? stats.lastOut : (stats.mode === 'above' ? stats.lastIn : stats.lastIn);
    var neverBreached = stats.timeIn === 0 || (stats.mode === 'below' && stats.timeOut === 0) || (stats.mode === 'above' && stats.timeIn === 0);
    html += '<div style="margin-top:8px;padding:8px 12px;background:#F8FAFC;border-left:3px solid ' + goodColor + ';border-radius:4px;font-size:11px;color:' + C.text + '">';
    html += '📅 Période analysée : <strong>' + stats.firstDate + ' → ' + stats.lastDate + '</strong> (' + stats.total + ' observations, ' + _state.period + ').';
    if (stats.mode !== 'corridor') {
      if (stats.mode === 'below' && stats.timeOut === 0) {
        html += ' Le taux n\'a <strong>jamais</strong> dépassé ' + stats.threshold.toFixed(2) + '% sur cette période.';
      } else if (stats.mode === 'above' && stats.timeIn === 0) {
        html += ' Le taux n\'a <strong>jamais</strong> atteint ' + stats.threshold.toFixed(2) + '% sur cette période.';
      }
    }
    html += '</div>';

    // Avertissement si période courte
    if (stats.total < 24) {
      html += '<div style="margin-top:6px;padding:6px 10px;background:#FEF3C7;border-radius:4px;font-size:10px;color:#92400E">⚠️ Attention : seulement ' + stats.total + ' observations — stabilité statistique limitée. Élargir la période pour plus de robustesse.</div>';
    }

    return html;
  }

  // ─── Section produits brochure ─────────────────────────────────────────────
  function _renderProductsSection() {
    if (!_state.products || _state.products.length === 0) return '';

    var toggleIcon = _state.showProducts ? '▼' : '▶';
    var html = '<div style="background:' + C.card + ';border:1px solid ' + C.border + ';border-radius:10px;margin-bottom:16px">';
    html += '<div onclick="__mktV2ToggleProducts()" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:' + (_state.showProducts?'1px solid '+C.border:'none') + '">';
    html += '<div style="font-size:14px;font-weight:800;color:' + C.text + '">📂 Produits de taux en brochure (' + _state.products.length + ')';
    html += '<span style="font-size:11px;color:' + C.muted + ';font-weight:500;margin-left:8px">— TARN, Callable, Range Accrual auto-détectés</span></div>';
    html += '<span style="color:' + C.muted + ';font-size:12px">' + toggleIcon + '</span>';
    html += '</div>';

    if (!_state.showProducts) { html += '</div>'; return html; }

    // Enrichir chaque produit avec stats sur période courante
    var enriched = _state.products.map(function(p) {
      return window.MarketProductsScanner.enrich(p, _state.rates, _state.period);
    });

    // Trier : ceux avec seuil et % de sécurité élevé d\'abord
    enriched.sort(function(a, b) {
      var as = a.stats ? a.stats.pctIn : -1;
      var bs = b.stats ? b.stats.pctIn : -1;
      return bs - as;
    });

    html += '<div style="padding:12px 16px">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="border-bottom:2px solid ' + C.border + ';color:' + C.muted + ';font-size:9px;letter-spacing:.5px">';
    html += '<th style="padding:8px 6px;text-align:left">PRODUIT</th>';
    html += '<th style="padding:8px 6px;text-align:left">ÉMETTEUR</th>';
    html += '<th style="padding:8px 6px;text-align:left">SOUS-JACENT</th>';
    html += '<th style="padding:8px 6px;text-align:center">SEUIL</th>';
    html += '<th style="padding:8px 6px;text-align:right">COUPON</th>';
    html += '<th style="padding:8px 6px;text-align:right">MAT.</th>';
    html += '<th style="padding:8px 6px;text-align:center">STATUT</th>';
    html += '<th style="padding:8px 6px;text-align:right">% TEMPS OK</th>';
    html += '<th style="padding:8px 6px;text-align:right">MARGE</th>';
    html += '<th style="padding:8px 6px;text-align:center">ACTION</th>';
    html += '</tr></thead><tbody>';

    enriched.forEach(function(p, i) {
      var bg = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      html += '<tr style="background:' + bg + ';border-bottom:1px solid #EEF2F6">';

      // Produit
      var typeTag = p.structureType || p.type || '?';
      html += '<td style="padding:8px 6px"><div style="font-weight:700;color:' + C.text + '">' + (p.name || '—') + '</div>';
      html += '<div style="font-size:9px;color:' + C.dim + ';text-transform:uppercase;letter-spacing:.4px">' + typeTag + '</div></td>';

      // Émetteur
      html += '<td style="padding:8px 6px;color:' + C.text + '">' + (p.emitter || p.guarantor || '—');
      if (p.rating) html += ' <span style="font-size:9px;color:' + C.muted + '">· ' + p.rating + '</span>';
      html += '</td>';

      // Sous-jacent
      html += '<td style="padding:8px 6px">';
      if (p.rateLabel) html += '<span style="padding:2px 7px;background:#EFF6FF;color:' + C.primary + ';border-radius:4px;font-size:10px;font-weight:600">' + p.rateLabel + '</span>';
      else if (p.rateAlias) html += '<span style="color:' + C.muted + ';font-size:10px">' + p.rateAlias + ' (?)</span>';
      else html += '<span style="color:' + C.dim + ';font-size:10px">—</span>';
      html += '</td>';

      // Seuil
      html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono,monospace);font-size:11px">';
      if (p.thresholdMode === 'corridor' && p.corridorLow != null && p.corridorHigh != null) {
        html += '<span style="color:' + C.text + '">[' + p.corridorLow.toFixed(2) + '-' + p.corridorHigh.toFixed(2) + ']</span>';
      } else if (p.threshold != null && p.thresholdMode) {
        var sym = p.thresholdMode === 'below' ? '≤' : '≥';
        html += '<span style="color:' + C.text + '">' + sym + ' ' + p.threshold.toFixed(2) + '%</span>';
      } else {
        html += '<span style="color:' + C.dim + '">—</span>';
      }
      html += '</td>';

      // Coupon
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono,monospace);color:' + C.success + ';font-weight:700">' + (p.couponRate != null ? p.couponRate.toFixed(2) + '%' : '—') + '</td>';

      // Maturité
      html += '<td style="padding:8px 6px;text-align:right;color:' + C.muted + '">' + (p.maturityYears ? p.maturityYears + 'a' : '—') + '</td>';

      // Statut
      var st = p.stats;
      html += '<td style="padding:8px 6px;text-align:center">';
      if (st && st.currentIn != null) {
        html += st.currentIn
          ? '<span style="padding:2px 8px;background:#ECFDF5;color:' + C.success + ';border-radius:4px;font-weight:700;font-size:10px">✅ OK</span>'
          : '<span style="padding:2px 8px;background:#FEF2F2;color:' + C.danger + ';border-radius:4px;font-weight:700;font-size:10px">❌ KO</span>';
      } else html += '<span style="color:' + C.dim + ';font-size:10px">N/A</span>';
      html += '</td>';

      // % temps OK
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono,monospace);font-weight:700">';
      if (st) {
        var pc = st.pctIn;
        var pcCol = pc >= 80 ? C.success : pc >= 50 ? C.warn : C.danger;
        html += '<span style="color:' + pcCol + '">' + pc + '%</span>';
      } else html += '<span style="color:' + C.dim + '">—</span>';
      html += '</td>';

      // Marge
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono,monospace);font-weight:700">';
      if (st && st.marginBps != null) {
        var mc = st.marginBps >= 0 ? C.success : C.danger;
        html += '<span style="color:' + mc + '">' + (st.marginBps >= 0 ? '+' : '') + st.marginBps + 'bp</span>';
      } else html += '<span style="color:' + C.dim + '">—</span>';
      html += '</td>';

      // Action
      html += '<td style="padding:8px 6px;text-align:center">';
      if (p.rateAlias && (p.threshold != null || p.thresholdMode === 'corridor')) {
        html += '<button onclick="__mktV2LoadProduct(\'' + p.id + '\')" style="padding:3px 10px;border-radius:4px;border:1px solid ' + C.primary + ';background:#fff;color:' + C.primary + ';font-size:10px;font-weight:700;cursor:pointer">Analyser</button>';
      }
      html += '</td>';

      html += '</tr>';
    });
    html += '</tbody></table>';

    // Note sur la détection
    var nbWithSeuil = enriched.filter(function(p){return p.hasExploitableSeuil;}).length;
    var nbWithout = enriched.length - nbWithSeuil;
    if (nbWithout > 0) {
      html += '<div style="margin-top:10px;padding:8px 12px;background:#FFFBEB;border-radius:4px;font-size:10px;color:#92400E">ℹ️ ' + nbWithSeuil + '/' + enriched.length + ' produits ont un seuil exploitable détecté automatiquement. Les ' + nbWithout + ' autres (sans sous-jacent de taux reconnu ou sans trigger numérique) ne sont pas analysables ici — leur brochure ne contient pas les informations nécessaires sous un format exploitable.</div>';
    }

    html += '</div></div>';
    return html;
  }

  // ─── Handlers globaux ──────────────────────────────────────────────────────
  window.__mktV2SelectRate = function(alias) {
    _state.selectedRate = alias;
    _rerender();
  };
  window.__mktV2SetPeriod = function(p) {
    _state.period = p;
    _rerender();
  };
  window.__mktV2ModeChange = function(m) {
    _state.mode = m;
    var t2 = document.getElementById('mkt-v2-t2');
    var u2 = document.getElementById('mkt-v2-unit2');
    if (t2) t2.style.display = (m === 'corridor') ? '' : 'none';
    if (u2) u2.style.display = (m === 'corridor') ? '' : 'none';
  };
  window.__mktV2Analyze = function() {
    var t1 = parseFloat(document.getElementById('mkt-v2-t1').value);
    var t2 = parseFloat(document.getElementById('mkt-v2-t2').value);
    var m = document.getElementById('mkt-v2-mode').value;
    if (isNaN(t1)) return;
    _state.threshold = t1;
    _state.mode = m;
    _state.corridorHigh = (m === 'corridor' && !isNaN(t2)) ? t2 : null;
    if (m === 'corridor' && isNaN(t2)) return;
    _rerender();
  };
  window.__mktV2Reset = function() {
    _state.threshold = null;
    _state.corridorHigh = null;
    _state.mode = 'above';
    _rerender();
  };
  window.__mktV2ToggleProducts = function() {
    _state.showProducts = !_state.showProducts;
    _rerender();
  };
  window.__mktV2LoadProduct = function(productId) {
    if (!_state.products) return;
    var p = _state.products.find(function(x){return x.id === productId;});
    if (!p) return;
    _state.selectedRate = p.rateAlias;
    _state.mode = p.thresholdMode;
    _state.threshold = p.thresholdMode === 'corridor' ? p.corridorLow : p.threshold;
    _state.corridorHigh = p.thresholdMode === 'corridor' ? p.corridorHigh : null;
    _rerender();
    setTimeout(function() {
      var el = document.querySelector('[data-mkt-v2-anchor="analyzer"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // ─── Assembleur principal ──────────────────────────────────────────────────
  function _buildHeader() {
    var fetchDate = _state.rates && _state.rates.fetched_at
      ? new Date(_state.rates.fetched_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid ' + C.border + '">';
    html += '<div style="font-size:18px;font-weight:800;color:' + C.text + '">📈 Marché des taux EUR</div>';
    html += '<div style="font-size:10px;color:' + C.muted + ';padding:4px 10px;background:#F1F3F7;border-radius:4px">MAJ : ' + fetchDate + ' · ECB</div>';
    html += '</div>';
    return html;
  }

  function _buildRatesRow() {
    var aliases = ['tec10', 'oat5y', 'oat2y', 'euribor3m', 'euribor6m', 'bce_depot'];
    var html = '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px">';
    aliases.forEach(function(a) { html += _renderRateTile(a); });
    html += '</div>';
    return html;
  }

  function _buildCurveInfo() {
    var curve = _state.rates && _state.rates.yield_curve || {};
    var shapeOk = curve.shape === 'normal';
    var spread = Math.round((curve.spread_2_10 || 0.59) * 100);
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:' + C.card + ';border:1px solid ' + C.border + ';border-radius:8px;margin-bottom:16px">' +
      '<div><span style="font-size:12px;font-weight:700;color:' + C.text + '">Courbe des taux : </span>' +
      '<span style="font-family:var(--mono,monospace);font-size:14px;font-weight:800;color:' + (shapeOk ? C.success : C.danger) + '">' + (shapeOk ? 'Normale ↗' : 'Inversée ↘') + '</span></div>' +
      '<div style="font-size:11px;color:' + C.muted + '">Spread 2s10s : <strong style="color:' + (spread > 0 ? C.success : C.danger) + '">' + (spread>0?'+':'') + spread + 'bp</strong> · ' + (shapeOk ? 'Favorable aux structurés' : 'Défavorable') + '</div></div>';
  }

  // Sections conservées de la v1 (macro, régime, carry) — rendu minimal ici
  function _buildMacroSection() {
    var md = (_state.mi && _state.mi.market_data_input) || {};
    var ai = (_state.mi && _state.mi.ai_response) || {};
    var regime = ai.regime || 'unknown';
    var regCol = regime === 'stagflation' ? C.danger : regime === 'growth' ? C.success : C.warn;

    var html = '<div style="background:' + C.card + ';border:1px solid ' + C.border + ';border-radius:10px;padding:16px;margin-bottom:16px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html += '<div style="font-size:13px;font-weight:800;color:' + C.text + '">🌍 Contexte macro</div>';
    html += '<div style="padding:3px 10px;background:' + regCol + '22;color:' + regCol + ';border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase">Régime : ' + regime + ' · confiance ' + (ai.regime_confidence || '?') + '/5</div>';
    html += '</div>';

    // KPI compacts
    var kpis = [
      ['Brent', '$' + (md.brent_usd || 0).toFixed(1), md.brent_usd > 100 ? C.danger : C.success],
      ['Or',    '$' + Math.round(md.gold_usd || 0).toLocaleString('fr-FR'), C.warn],
      ['VIX',   (md.vix || 0).toFixed(1), (md.vix || 0) > 25 ? C.danger : C.success],
      ['CPI YoY', (md.cpi_yoy_pct || 0).toFixed(1) + '%', (md.cpi_yoy_pct || 0) > 2.5 ? C.danger : C.success],
      ['PCE YoY', (md.pce_yoy_pct || 0).toFixed(1) + '%', (md.pce_yoy_pct || 0) > 2.5 ? C.danger : C.success],
      ['Fed Funds', (md.fed_funds_rate || 0).toFixed(2) + '%', C.purple],
      ['EUR/USD', (md.eurusd || 0).toFixed(4), C.primary],
      ['IG Spread', (md.ig_spread_bps || 0) + 'bp', C.primary],
      ['HY Spread', (md.hy_spread_bps || 0) + 'bp', (md.hy_spread_bps || 0) > 400 ? C.danger : C.warn],
      ['S&P 500', Math.round(md.sp500_level || 0).toLocaleString('fr-FR'), (md.sp500_change_1d_pct || 0) > 0 ? C.success : C.danger],
      ['Breakeven 5Y', (md.breakeven_5y || 0).toFixed(2) + '%', C.warn]
    ];
    html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">';
    kpis.forEach(function(k) {
      html += '<div style="padding:8px 10px;background:' + C.input + ';border-radius:6px;border-left:3px solid ' + k[2] + '">';
      html += '<div style="font-size:8px;color:' + C.muted + ';font-weight:700;letter-spacing:.4px;text-transform:uppercase">' + k[0] + '</div>';
      html += '<div style="font-family:var(--mono,monospace);font-size:14px;font-weight:800;color:' + k[2] + '">' + k[1] + '</div>';
      html += '</div>';
    });
    html += '</div>';

    if (ai.regime_rationale) {
      html += '<div style="margin-top:10px;padding:10px 12px;background:#F8FAFC;border-left:3px solid ' + regCol + ';border-radius:4px;font-size:11px;line-height:1.5;color:' + C.text + '">' + ai.regime_rationale + '</div>';
    }
    html += '</div>';
    return html;
  }

  function _buildCarryImpact() {
    var tec10 = window.MarketAnalyzer.resolveRate(_state.rates, 'tec10');
    var eur3m = window.MarketAnalyzer.resolveRate(_state.rates, 'euribor3m');
    if (!tec10 || !eur3m) return '';
    var tec = tec10.current || 0, eu = eur3m.current || 0;
    var spreadBp = Math.round((tec - 3.10) * 100);
    var marginTARN = Math.round((4.40 - tec) * 100);
    var inCorridor = eu >= 1.50 && eu <= 3.80;

    var html = '<div style="background:#ECFDF5;border:2px solid ' + C.success + ';border-radius:10px;padding:14px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:800;color:' + C.success + ';margin-bottom:10px">💡 Impact carry trade (rappel)</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center"><div style="font-size:9px;color:' + C.muted + '">Spread TEC10 vs emprunt 3.10%</div><div style="font-family:var(--mono,monospace);font-size:22px;font-weight:800;color:' + (spreadBp > 0 ? C.success : C.danger) + '">' + (spreadBp>0?'+':'') + spreadBp + 'bp</div></div>';
    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center"><div style="font-size:9px;color:' + C.muted + '">Marge TARN (trigger 4.40%)</div><div style="font-family:var(--mono,monospace);font-size:22px;font-weight:800;color:' + C.cyan + '">+' + marginTARN + 'bp</div></div>';
    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center"><div style="font-size:9px;color:' + C.muted + '">Euribor dans corridor [1.50-3.80%]</div><div style="font-family:var(--mono,monospace);font-size:22px;font-weight:800;color:' + (inCorridor?C.success:C.danger) + '">' + (inCorridor ? '✅ OUI' : '❌ NON') + '</div></div>';
    html += '</div></div>';
    return html;
  }

  // ─── Rendu final ───────────────────────────────────────────────────────────
  function _rerender() {
    var container = document.getElementById('main-content');
    if (!container) return;
    var html = '<div style="background:' + C.bg + ';border-radius:12px;padding:20px;color:' + C.text + ';font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">';
    html += _buildHeader();
    html += _buildRatesRow();
    html += _buildCurveInfo();
    html += '<div data-mkt-v2-anchor="analyzer"></div>';
    html += _renderAnalyzerPanel();
    html += _renderProductsSection();
    html += _buildMacroSection();
    html += _buildCarryImpact();
    html += '</div>';
    container.innerHTML = html;
  }

  // ─── Override renderMarketDashboard ───────────────────────────────────────
  window.renderMarketDashboard = async function(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:' + C.muted + ';font-family:sans-serif">Chargement des données marché...</div>';
    if (!window.MarketAnalyzer || !window.MarketProductsScanner) {
      console.error('[market-dashboard-v2] MarketAnalyzer ou Scanner manquant — fallback v1');
      return _originalRender(container);
    }
    try {
      await _loadAll();
      _parseUrlParams();
      if (!_state.rates) {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:' + C.danger + '">Impossible de charger data/market/rates.json</div>';
        return;
      }
      _rerender();
    } catch(e) {
      console.error('[market-dashboard-v2] erreur', e);
      container.innerHTML = '<div style="padding:40px;text-align:center;color:' + C.danger + '">Erreur : ' + e.message + ' — consulter la console</div>';
    }
  };

  console.log('[StructBoard] Market Dashboard v2 patch loaded — override actif');
})();

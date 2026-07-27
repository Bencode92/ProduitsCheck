// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Comparateur PRO v2.0
//
// Compare des produits de maturités/structures DIFFÉRENTES sur une base
// COMMUNE : tout est ramené à l'année (net reçu/an, net éco/an), + marge
// embarquée, barrière, capital, décrément, émetteur. Surlignage best/worst
// par colonne, tri par colonne, export CSV. Le bouton est posé proprement
// dans le header (ui.js) — plus d'injection fragile.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function _gc(g) { return { A: '#06D6A0', B: '#4ECDC4', C: '#FFB627', D: '#E85D04', F: '#EF233C' }[g] || '#888'; }
  function _pct(v, dec) { return v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(dec == null ? 2 : dec).replace('.', ',') + '%'; }
  function _num(v, dec) { return v == null || isNaN(v) ? '—' : v.toFixed(dec == null ? 1 : dec).replace('.', ','); }

  // Ordre de tri courant (état module)
  var _sort = { key: 'netEco', dir: -1 }; // net éco décroissant par défaut = "meilleure affaire" en haut

  function _collect() {
    var all = [];
    (app.state.portfolio || []).forEach(function (p) {
      if (p.grading && p.grading.grade && p.grading.grade !== '-' && p.grading.grade !== '?') all.push({ source: 'portfolio', product: p });
    });
    Object.values(app.state.proposals || {}).forEach(function (arr) {
      (arr || []).forEach(function (p) {
        if (p.grading && p.grading.grade && p.grading.grade !== '-' && p.grading.grade !== '?' && p.status !== 'rejected') all.push({ source: 'proposal', product: p });
      });
    });
    return all.map(_metrics);
  }

  function _metrics(item) {
    var p = item.product, g = p.grading || {}, md = g.metadata || {}, cp = p.capitalProtection || {};
    var ny = (typeof scoring !== 'undefined' && scoring.getNetYield) ? scoring.getNetYield(p) : {};
    var capRank = cp.guaranteeType === 'garantie' ? 0 : (cp.protected === true || cp.protected === 'true' || cp.guaranteeType === 'formule' ? 1 : 2);
    var capital = ['Garanti', 'Protégé éch.', 'Non protégé'][capRank];
    var dec = parseFloat(p.decrementPct != null ? p.decrementPct : (p.aiParsed && p.aiParsed.decrementPct)) || 0;
    var issuer = (p.guarantorRating && (p.guarantorRating.sp || p.guarantorRating.moodys)) || md.issuerRating || '';
    var isIC = (typeof window._isIssuerCallable === 'function' && window._isIssuerCallable(p)) || !!(p.earlyRedemption && p.earlyRedemption.atIssuerDiscretion);
    return {
      p: p, source: item.source, name: p.name || 'Produit', bank: p.bankId || '',
      grade: g.grade || '?', gradeRank: { A: 0, B: 1, C: 2, D: 3, F: 4 }[g.grade] != null ? { A: 0, B: 1, C: 2, D: 3, F: 4 }[g.grade] : 9,
      score: g.score || 0,
      coupon: (typeof scoring !== 'undefined' && scoring.annualizedCoupon) ? scoring.annualizedCoupon(p) : (parseFloat(p.coupon && p.coupon.rate) || 0),
      netRecu: (ny.netAfterFees != null) ? ny.netAfterFees : null,
      netEco: (ny.netEconomic != null) ? ny.netEconomic : null,
      margin: ny.embeddedMargin || 0,
      barrier: parseFloat(cp.barrier) || null,
      capital: capital, capRank: capRank,
      maturity: parseFloat(p.maturityYears) || null,
      decrement: dec, isIC: isIC,
      type: (p.structureType || p.type || '').replace(/_/g, ' '),
      issuer: issuer
    };
  }

  // Colonnes : key, label, accessor, format, higherBetter (pour best/worst), align
  var COLS = [
    { key: 'grade', label: 'Grade', get: function (m) { return m.gradeRank; }, better: 'low' },
    { key: 'coupon', label: 'Coupon/an', get: function (m) { return m.coupon; }, fmt: function (m) { return m.coupon ? _num(m.coupon) + '%' : '—'; }, better: 'high' },
    { key: 'netRecu', label: 'Net reçu/an', get: function (m) { return m.netRecu; }, fmt: function (m) { return _pct(m.netRecu); }, better: 'high', hl: true },
    { key: 'netEco', label: 'Net ÉCO/an', get: function (m) { return m.netEco; }, fmt: function (m) { return _pct(m.netEco); }, better: 'high', hl: true, strong: true },
    { key: 'margin', label: 'Marge emb.', get: function (m) { return m.margin; }, fmt: function (m) { return m.margin ? _num(m.margin) + '%' : '—'; }, better: 'low', hl: true },
    { key: 'capRank', label: 'Capital', get: function (m) { return m.capRank; }, fmt: function (m) { return m.capital; }, better: 'low' },
    { key: 'barrier', label: 'Barrière', get: function (m) { return m.barrier == null ? 999 : m.barrier; }, fmt: function (m) { return m.barrier ? m.barrier + '%' : '—'; }, better: 'low' },
    { key: 'maturity', label: 'Maturité', get: function (m) { return m.maturity == null ? 999 : m.maturity; }, fmt: function (m) { return m.maturity ? _num(m.maturity) + 'a' : '—'; }, better: 'low' },
    { key: 'decrement', label: 'Décrém.', get: function (m) { return m.decrement; }, fmt: function (m) { return m.decrement ? '📉 ' + _num(m.decrement) + '%' : '—'; }, better: 'low' },
    { key: 'type', label: 'Type', get: function (m) { return m.type; }, fmt: function (m) { return (m.isIC ? '⚖ ' : '') + (m.type || '—'); }, better: null }
  ];

  function _bestWorst(rows, col) {
    if (!col.hl) return {};
    var vals = rows.map(function (m) { return col.get(m); }).filter(function (v) { return v != null && !isNaN(v); });
    if (vals.length < 2) return {};
    var best = col.better === 'high' ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
    var worst = col.better === 'high' ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    return { best: best, worst: worst };
  }

  function _renderTable() {
    var rows = _collect();
    if (!rows.length) return '<div style="padding:24px;text-align:center;color:var(--text-muted)">Aucun produit gradé à comparer.</div>';
    rows.sort(function (a, b) {
      var col = COLS.filter(function (c) { return c.key === _sort.key; })[0] || COLS[3];
      var va = col.get(a), vb = col.get(b);
      if (typeof va === 'string') return _sort.dir * String(va).localeCompare(String(vb));
      va = (va == null || isNaN(va)) ? (_sort.dir < 0 ? -Infinity : Infinity) : va;
      vb = (vb == null || isNaN(vb)) ? (_sort.dir < 0 ? -Infinity : Infinity) : vb;
      return _sort.dir * (va - vb);
    });

    var hw = {};
    COLS.forEach(function (c) { hw[c.key] = _bestWorst(rows, c); });

    var h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;white-space:nowrap">';
    // header
    h += '<thead><tr style="border-bottom:2px solid var(--border)">';
    h += '<th style="padding:8px 6px;text-align:left;position:sticky;left:0;background:var(--bg-card,var(--bg));z-index:2;min-width:150px;font-weight:600;color:var(--text-muted)">Produit</th>';
    COLS.forEach(function (c) {
      var active = _sort.key === c.key;
      var arrow = active ? (_sort.dir < 0 ? ' ▾' : ' ▴') : '';
      h += '<th onclick="_cmpSort(\'' + c.key + '\')" style="padding:8px 6px;text-align:center;cursor:pointer;font-weight:' + (c.strong ? '800' : '600') + ';color:' + (active ? 'var(--accent)' : (c.strong ? 'var(--text-bright)' : 'var(--text-muted)')) + ';user-select:none">' + c.label + arrow + '</th>';
    });
    h += '</tr></thead><tbody>';

    rows.forEach(function (m, i) {
      var bg = i % 2 ? 'var(--bg-elevated)' : 'transparent';
      h += '<tr style="border-bottom:1px solid var(--border);background:' + bg + '">';
      // name sticky
      h += '<td style="padding:7px 6px;position:sticky;left:0;background:' + (i % 2 ? 'var(--bg-elevated)' : 'var(--bg-card,var(--bg))') + ';z-index:1">'
        + '<div style="font-weight:700;color:var(--text-bright);max-width:150px;overflow:hidden;text-overflow:ellipsis">' + m.name + '</div>'
        + '<div style="font-size:9px;color:var(--text-dim)">' + (m.source === 'portfolio' ? '🔒' : '📨') + ' ' + m.bank + '</div></td>';
      COLS.forEach(function (c) {
        var v = c.get(m), txt = c.fmt ? c.fmt(m) : v;
        var color = 'var(--text)', weight = '600';
        if (c.key === 'grade') { return void (h += '<td style="padding:7px 6px;text-align:center"><span style="display:inline-block;min-width:22px;padding:1px 5px;border-radius:5px;background:' + _gc(m.grade) + '22;color:' + _gc(m.grade) + ';font-weight:800">' + m.grade + '</span></td>'); }
        if (c.hl && hw[c.key] && v != null && !isNaN(v)) {
          if (v === hw[c.key].best) { color = 'var(--green)'; weight = '800'; }
          else if (v === hw[c.key].worst) { color = 'var(--red)'; weight = '700'; }
        }
        if (c.key === 'decrement' && m.decrement > 0) color = 'var(--red)';
        if (c.key === 'barrier' && m.barrier != null) color = m.barrier >= 65 ? 'var(--red)' : m.barrier <= 55 ? 'var(--green)' : 'var(--orange)';
        if (c.key === 'capRank') color = m.capRank === 0 ? 'var(--green)' : m.capRank === 1 ? 'var(--orange)' : 'var(--red)';
        h += '<td style="padding:7px 6px;text-align:center;font-family:' + (c.key === 'type' ? 'var(--font)' : 'var(--mono)') + ';color:' + color + ';font-weight:' + weight + '">' + txt + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  window._cmpSort = function (key) {
    if (_sort.key === key) _sort.dir *= -1;
    else { _sort.key = key; _sort.dir = (key === 'type' || key === 'grade' || key === 'margin' || key === 'barrier' || key === 'maturity' || key === 'decrement' || key === 'capRank') ? 1 : -1; }
    var el = document.getElementById('comparison-table');
    if (el) el.innerHTML = _renderTable();
  };

  window._cmpExportCSV = function () {
    var rows = _collect();
    var head = ['Produit', 'Banque', 'Source', 'Grade', 'Score', 'Coupon %', 'Net recu /an %', 'Net eco /an %', 'Marge emb. %', 'Capital', 'Barriere %', 'Maturite (a)', 'Decrement %', 'Type'];
    var lines = [head.join(';')];
    rows.forEach(function (m) {
      lines.push([m.name, m.bank, m.source, m.grade, m.score, m.coupon, m.netRecu == null ? '' : m.netRecu.toFixed(2), m.netEco == null ? '' : m.netEco.toFixed(2), m.margin.toFixed(2), m.capital, m.barrier || '', m.maturity || '', m.decrement || '', m.type].map(function (x) { return ('' + x).replace(/;/g, ','); }).join(';'));
    });
    var csv = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csv).then(function () { if (typeof showToast === 'function') showToast('✅ Comparatif copié (CSV) — colle dans Excel', 'success'); });
    } else {
      if (typeof showToast === 'function') showToast('Copie non supportée par le navigateur', 'error');
    }
  };

  window.showProductComparison = function () {
    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto;max-width:96vw">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      + '<h2 class="modal-title" style="margin:0">📊 Comparateur Pro</h2>'
      + '<button class="btn sm" onclick="_cmpExportCSV()">📋 Copier (CSV)</button></div>'
      + '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">'
      + 'Base commune (tout ramené à l\'année) → produits de maturités différentes comparables. <strong>Net ÉCO/an</strong> = rendement attendu net de frais et de marge (le vrai « bonne affaire ? »). Vert = meilleur, rouge = pire. Clique un en-tête pour trier.</div>'
      + '<div id="comparison-table">' + _renderTable() + '</div>'
      + '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>'
      + '</div></div>';
    modal.classList.add('visible');
  };

  console.log('[comparison-view] v2.0 pro (CFO columns, sort, best/worst, CSV)');
})();

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Quality Lookup
// Recherche éclair de la qualité d'un sous-jacent (Buffett / Quality) sans brochure.
// Saisir un ou plusieurs titres (ticker ou nom, séparés par virgule ou retour ligne)
// → score Buffett + Quality + verdict, avec mise en avant du "worst-of" pour un panier.
// Source : data/market/stocks_europe.json + stocks_us.json (mêmes données que le grader).
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  var _stocks = null;   // cache plat EU+US
  var _loading = null;
  var _debounce = null;

  // ── Chargement des données (réutilise les fichiers déjà servis à l'app) ──────────
  function loadStocks() {
    if (_stocks) return Promise.resolve(_stocks);
    if (_loading) return _loading;
    _loading = Promise.all([
      fetch('data/market/stocks_europe.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('data/market/stocks_us.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var eu = (res[0] && res[0].stocks) ? res[0].stocks : [];
      var us = (res[1] && res[1].stocks) ? res[1].stocks : [];
      eu.forEach(function (s) { s._qlRegion = 'EU'; });
      us.forEach(function (s) { s._qlRegion = 'US'; });
      _stocks = eu.concat(us);
      return _stocks;
    });
    return _loading;
  }

  // ── Utilitaires ─────────────────────────────────────────────────────────────────
  function strip(s) {
    if (typeof _stripAccents === 'function') return _stripAccents(s);
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function bestScore(s) {
    if (typeof _bestBuffett === 'function') return _bestBuffett(s);
    if (s.buffett_score != null) return s.buffett_score;
    if (s.quality_score != null) return s.quality_score;
    return null;
  }

  // Matching tolérant : ticker exact → alias → nom exact → contient → 1er mot.
  function match(query, all) {
    var q = (query || '').trim();
    if (!q) return null;
    var qa = strip(q.toUpperCase());
    var qaBare = qa.replace(/\.[A-Z]{1,3}$/, ''); // retire le suffixe d'échange : MC.PA → MC, ASML.AS → ASML
    var alias = (typeof _resolveAlias === 'function') ? (_resolveAlias(q) || '').toUpperCase() : '';

    var byTicker = all.find(function (x) {
      var t = (x.ticker || '').toUpperCase();
      return t === qa || t === qaBare || (alias && t === alias);
    });
    if (byTicker) return byTicker;

    var exact = all.find(function (x) {
      return strip((x.name || '').toUpperCase()) === qa || strip((x.name_api || '').toUpperCase()) === qa;
    });
    if (exact) return exact;

    var contains = all.filter(function (x) {
      var n = strip((x.name || '').toUpperCase());
      var na = strip((x.name_api || '').toUpperCase());
      return n.indexOf(qa) >= 0 || na.indexOf(qa) >= 0;
    });
    if (contains.length) {
      contains.sort(function (a, b) {
        return strip((a.name || '').toUpperCase()).indexOf(qa) - strip((b.name || '').toUpperCase()).indexOf(qa);
      });
      return contains[0];
    }

    var fw = qa.split(/\s+/)[0];
    if (fw.length >= 4) {
      var f = all.find(function (x) {
        return strip((x.name || '').toUpperCase()).indexOf(fw) >= 0
          || strip((x.name_api || '').toUpperCase()).indexOf(fw) >= 0;
      });
      if (f) return f;
    }
    return null;
  }

  // ── Échelle couleur / verdict ─────────────────────────────────────────────────────
  function scoreColor(v) {
    if (v == null) return '#94A3B8';
    if (v >= 70) return 'var(--green)';
    if (v >= 55) return 'var(--cyan)';
    if (v >= 40) return 'var(--orange)';
    return 'var(--red)';
  }
  function verdict(s) {
    var b = bestScore(s);
    if (b == null) return { label: 'N/A', color: '#94A3B8', bg: 'rgba(148,163,184,0.10)' };
    if (b >= 65) return { label: 'QUALITÉ ✓', color: 'var(--green)', bg: 'var(--green-dim)' };
    if (b >= 50) return { label: 'CORRECT', color: 'var(--cyan)', bg: 'var(--cyan-dim)' };
    if (b >= 35) return { label: 'MOYEN', color: 'var(--orange)', bg: 'var(--orange-dim)' };
    return { label: 'FRAGILE', color: 'var(--red)', bg: 'var(--red-dim)' };
  }
  function pctColor(v) {
    if (v == null) return '#94A3B8';
    return v >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // ── Rendu d'un chip métrique ──────────────────────────────────────────────────────
  function metric(label, value, opts) {
    opts = opts || {};
    var disp, color = 'var(--text-bright)';
    if (value == null || (typeof value === 'number' && isNaN(value))) { disp = '—'; color = '#94A3B8'; }
    else if (opts.pct) { disp = (value >= 0 ? '+' : '') + value.toFixed(1) + '%'; color = pctColor(value); }
    else if (opts.suffix) { disp = value + opts.suffix; }
    else { disp = value; }
    return '<div style="display:flex;flex-direction:column;gap:1px">'
      + '<span style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);font-weight:600">' + label + '</span>'
      + '<span style="font-family:var(--mono);font-size:12px;font-weight:600;color:' + color + '">' + disp + '</span>'
      + '</div>';
  }

  // ── Carte d'une action ────────────────────────────────────────────────────────────
  function scoreBadge(label, score, grade) {
    var c = scoreColor(score);
    return '<div style="text-align:center;min-width:62px">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);font-weight:700;margin-bottom:2px">' + label + '</div>'
      + '<div style="font-family:var(--mono);font-size:26px;font-weight:700;line-height:1;color:' + c + '">' + (score != null ? score : '—') + '</div>'
      + '<div style="font-size:10px;color:' + c + ';font-weight:700">' + (grade || '') + '</div>'
      + '</div>';
  }

  function criteriaLine(s) {
    if (!Array.isArray(s.buffett_criteria) || !s.buffett_criteria.length) return '';
    var passed = s.buffett_criteria.filter(function (c) { return c.passed; }).length;
    var total = s.buffett_criteria.length;
    var dots = s.buffett_criteria.map(function (c) {
      var col = c.passed ? 'var(--green)' : 'var(--red)';
      var nm = (c.name || '').replace(/_/g, ' ');
      return '<span title="' + nm + (c.detail ? ' — ' + c.detail : '') + '" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + col + ';margin-right:3px;cursor:help"></span>';
    }).join('');
    return '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:10px;color:var(--text-muted);font-weight:600">Critères Buffett ' + passed + '/' + total + '</span>'
      + '<span>' + dots + '</span></div>';
  }

  function card(query, s, isWorst) {
    if (!s) {
      return '<div class="ql-card" style="border:1px solid var(--red);background:var(--red-dim);border-radius:var(--radius);padding:14px 16px">'
        + '<div style="font-weight:600;color:var(--red);font-size:13px">« ' + query +' » introuvable</div>'
        + '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Essayez le ticker exact (ex. <span style="font-family:var(--mono)">MC.PA</span>, <span style="font-family:var(--mono)">ASML</span>) ou le nom complet.</div>'
        + '</div>';
    }
    var v = verdict(s);
    var border = isWorst ? '2px solid var(--orange)' : '1px solid var(--border)';
    var flag = s._qlRegion === 'US' ? '🇺🇸' : '🇪🇺';
    return '<div class="ql-card" style="border:' + border + ';background:var(--bg-card);border-radius:var(--radius);padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">'
      + (isWorst ? '<div style="font-size:9px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">⚠ Worst-of (contraignant)</div>' : '')
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
      +   '<div style="min-width:0">'
      +     '<div style="font-weight:700;font-size:14px;color:var(--text-bright);line-height:1.2">' + flag + ' ' + (s.name || s.ticker) + '</div>'
      +     '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'
      +       '<span style="font-family:var(--mono)">' + (s.ticker || '') + '</span>'
      +       (s.sector ? ' · ' + s.sector : '') + (s.country ? ' · ' + s.country : '') + '</div>'
      +   '</div>'
      +   '<div style="display:flex;gap:14px;align-items:flex-start;flex-shrink:0">'
      +     scoreBadge('Buffett', s.buffett_score, s.buffett_grade)
      +     scoreBadge('Quality', s.quality_score, s.quality_grade)
      +     '<div style="align-self:center"><span style="display:inline-block;font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;color:' + v.color + ';background:' + v.bg + ';border:1px solid ' + v.color + '">' + v.label + '</span></div>'
      +   '</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:10px;margin-top:14px">'
      +   metric('ROE', s.roe, { suffix: '%' })
      +   metric('ROIC', s.roic, { suffix: '%' })
      +   metric('D/E', s.de_ratio)
      +   metric('Marge nette', s.net_margin, { suffix: '%' })
      +   metric('Vol 3A', s.volatility_3y, { suffix: '%' })
      +   metric('Max DD 3A', s.max_drawdown_3y != null ? -Math.abs(s.max_drawdown_3y) : null, { suffix: '%' })
      +   metric('Beta', s.beta)
      +   metric('PER', s.pe_ratio)
      +   metric('Perf YTD', s.perf_ytd, { pct: true })
      +   metric('Perf 1A', s.perf_1y, { pct: true })
      +   metric('FCF yield', s.fcf_yield, { suffix: '%' })
      +   metric('Div yield', s.dividend_yield, { suffix: '%' })
      + '</div>'
      + criteriaLine(s)
      + '</div>';
  }

  // ── Rendu de la liste de résultats ────────────────────────────────────────────────
  function renderResults() {
    var input = document.getElementById('ql-input');
    var out = document.getElementById('ql-results');
    if (!input || !out) return;
    var tokens = input.value.split(/[,\n;]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    if (!tokens.length) {
      out.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:40px 0">Saisissez un ou plusieurs titres ci-dessus pour voir leur qualité.</div>';
      return;
    }
    loadStocks().then(function (all) {
      var resolved = tokens.map(function (q) { return { q: q, s: match(q, all) }; });
      var found = resolved.filter(function (r) { return r.s; });
      var worst = null;
      if (found.length > 1) {
        worst = found.reduce(function (w, r) {
          var bs = bestScore(r.s), bw = bestScore(w.s);
          if (bw == null) return r;
          if (bs == null) return w;
          return bs < bw ? r : w;
        });
      }

      var html = '';
      // Bandeau synthèse panier
      if (found.length > 1) {
        var scores = found.map(function (r) { return bestScore(r.s); }).filter(function (x) { return x != null; });
        var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
        var wv = verdict(worst.s);
        html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">'
          + '<div class="stat-card" style="flex:1;min-width:150px;padding:12px 16px"><div class="stat-label">Worst-of</div>'
          +   '<div class="stat-value" style="color:' + scoreColor(bestScore(worst.s)) + '">' + bestScore(worst.s) + '</div>'
          +   '<div class="stat-sub">' + (worst.s.name || worst.s.ticker) + ' · ' + wv.label + '</div></div>'
          + '<div class="stat-card" style="flex:1;min-width:150px;padding:12px 16px"><div class="stat-label">Moyenne panier</div>'
          +   '<div class="stat-value" style="color:' + scoreColor(avg) + '">' + (avg != null ? avg : '—') + '</div>'
          +   '<div class="stat-sub">' + found.length + '/' + tokens.length + ' titres reconnus</div></div>'
          + '</div>'
          + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">💡 Pour un produit <strong>worst-of</strong>, c\'est le titre le plus faible qui détermine le risque réel.</div>';
      }

      html += '<div style="display:flex;flex-direction:column;gap:12px">'
        + resolved.map(function (r) { return card(r.q, r.s, worst && r === worst); }).join('')
        + '</div>';
      out.innerHTML = html;
    });
  }

  function onInput() {
    clearTimeout(_debounce);
    _debounce = setTimeout(renderResults, 220);
  }

  // ── Vue principale ────────────────────────────────────────────────────────────────
  function renderQualityLookup(container) {
    container.innerHTML =
      '<div style="max-width:980px;margin:0 auto">'
      + '<div class="section" style="margin-bottom:20px">'
      +   '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>🔎 Quality — qualité d\'un sous-jacent</div></div>'
      +   '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Saisissez un ou plusieurs titres (ticker ou nom, séparés par virgule ou retour à la ligne). Score <strong>Buffett</strong> et <strong>Quality</strong> instantanés — sans ouvrir de brochure.</div>'
      +   '<textarea id="ql-input" rows="2" placeholder="ex. ASML, MC.PA, TotalEnergies, Nvidia" '
      +     'style="width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-family:var(--mono);font-size:13px;color:var(--text);resize:vertical;outline:none"></textarea>'
      + '</div>'
      + '<div id="ql-results"></div>'
      + '</div>';

    var input = document.getElementById('ql-input');
    input.addEventListener('input', onInput);
    input.focus();
    // Précharge les données pour une première saisie instantanée
    loadStocks();
    renderResults();
  }

  window.renderQualityLookup = renderQualityLookup;
})();

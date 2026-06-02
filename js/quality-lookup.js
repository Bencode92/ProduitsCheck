// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Quality Lookup
// Recherche éclair de la qualité d'un sous-jacent sans ouvrir de brochure.
//   • Actions  → score Buffett + Quality + métriques colorées (vert/orange/rouge).
//   • ETF / indices sectoriels (ex. « Eurostoxx Banks ») → analyse perf + risque,
//     sans Buffett (pas pertinent pour un panier sectoriel).
// Sources locales (mêmes données que le grader) :
//   data/market/stocks_europe.json · stocks_us.json · sectors.json · markets.json
//   data/underlying-map.json (indices larges)
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  var _stocks = null, _etfs = null, _indexMap = null;
  var _loading = null, _debounce = null;

  // ── Chargement ────────────────────────────────────────────────────────────────
  function getJSON(url) { return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }

  function loadData() {
    if (_stocks) return Promise.resolve();
    if (_loading) return _loading;
    _loading = Promise.all([
      getJSON('data/market/stocks_europe.json'),
      getJSON('data/market/stocks_us.json'),
      getJSON('data/market/sectors.json'),
      getJSON('data/market/markets.json'),
      getJSON('data/underlying-map.json')
    ]).then(function (res) {
      var eu = (res[0] && res[0].stocks) ? res[0].stocks : [];
      var us = (res[1] && res[1].stocks) ? res[1].stocks : [];
      eu.forEach(function (s) { s._region = 'EU'; });
      us.forEach(function (s) { s._region = 'US'; });
      _stocks = eu.concat(us);

      _etfs = [];
      var sec = (res[2] && res[2].sectors) ? res[2].sectors : {};
      Object.keys(sec).forEach(function (k) {
        (sec[k] || []).forEach(function (e) {
          var fam = e.indexFamily || '';
          // identité « secteur » : on retire le préfixe de famille (STOXX Europe 600, S&P 500…)
          // pour ne pas confondre « S&P 500 » (indice large) et un ETF sectoriel S&P 500.
          var secText = [e.sector_en, e.sector_fr, (e.indexName || '').split(fam).join(' ')].filter(Boolean).join(' ');
          _etfs.push({
            kind: 'etf', symbol: e.symbol, name: e.name, group: k,
            display: e.display_fr || e.indexName || e.name,
            indexName: e.indexName, family: fam, secText: secText,
            sector_fr: e.sector_fr, sector_en: e.sector_en, region: e.region,
            value: e.value_num, ytd: e.ytd_num, m3: e.m3_num, m6: e.m6_num, w52: e.w52_num,
            vol_3y: e.vol_3y, beta: e.beta, trend: e.trend
          });
        });
      });
      var idx = (res[3] && res[3].indices) ? res[3].indices : {};
      Object.keys(idx).forEach(function (region) {
        (idx[region] || []).forEach(function (e) {
          _etfs.push({
            kind: 'index', symbol: e.symbol, name: e.index_name,
            display: e.index_name, country: e.country, region: region,
            family: '', secText: [e.index_name, e.country].filter(Boolean).join(' '),
            value: e.value_num, ytd: e.ytd_num, m3: e.m3_num, m6: e.m6_num, w52: e.w52_num,
            trend: e.trend
          });
        });
      });
      _indexMap = (res[4] && res[4].indices) ? res[4].indices : {};
    });
    return _loading;
  }

  // ── Normalisation / synonymes ───────────────────────────────────────────────────
  function strip(s) {
    if (typeof _stripAccents === 'function') return _stripAccents(s);
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function norm(s) { return strip((s || '').toLowerCase()).replace(/[^a-z0-9&\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

  // Mappe un mot FR/indice vers le vocabulaire anglais des noms d'ETF
  var SYN = {
    eurostoxx: 'stoxx', estoxx: 'stoxx', euro: '', europe: '', european: '',
    banques: 'banks', banque: 'banks', bancaire: 'banks',
    assurances: 'insurance', assurance: 'insurance',
    telecoms: 'telecommunications', telecom: 'telecommunications', telecommunication: 'telecommunications',
    sante: 'health', pharma: 'pharmaceuticals', pharmaceutiques: 'pharmaceuticals', biotech: 'biotechnology',
    technologie: 'technology', techno: 'technology', tech: 'technology',
    semi: 'semiconductor', semiconducteurs: 'semiconductor', semiconducteur: 'semiconductor',
    immobilier: 'real', immo: 'real',
    petrole: 'oil', petroles: 'oil', energie: 'energy', energies: 'energy', gaz: 'gas',
    automobiles: 'auto', automobile: 'auto', autos: 'auto', voitures: 'auto',
    chimie: 'chemicals', chimiques: 'chemicals',
    industriels: 'industrials', industrie: 'industrials',
    distribution: 'retail', alimentation: 'food', boissons: 'beverages',
    services: 'financial', financiers: 'financial', financier: 'financial', financials: 'financial',
    utilities: 'utilities', 'publics': 'utilities',
    cybersecurite: 'cybersecurity', voyages: 'travel', loisirs: 'leisure'
  };
  function qWords(token) {
    return norm(token).split(' ').map(function (w) { return SYN.hasOwnProperty(w) ? SYN[w] : w; })
      .filter(function (w) { return w && w.length >= 3; });
  }

  // ── Matching ETF / indice (par recouvrement de mots) ─────────────────────────────
  function bestEtf(token) {
    var words = qWords(token);
    if (!words.length) return { score: 0 };
    var best = { score: 0 };
    _etfs.forEach(function (e) {
      var secBlob = norm(e.secText || '');
      var fullBlob = norm([e.symbol, e.family].join(' ')) + ' ' + secBlob;
      var hitFull = words.filter(function (w) { return fullBlob.indexOf(w) >= 0; }).length;
      var hitSec = words.filter(function (w) { return secBlob.indexOf(w) >= 0; }).length;
      // un match valable doit toucher l'identité « secteur », pas seulement le préfixe de famille
      if (hitSec === 0) return;
      var score = hitFull / words.length;
      // tie-break : on privilégie les ETF européens / familles STOXX (sous-jacents les plus fréquents)
      var bonus = (/^eu/i.test(e.region || '') || /stoxx/i.test(e.family || '') || /stoxx/i.test(e.indexName || '')) ? 0.05 : 0;
      var v = score + bonus;
      if (v > (best._rank || 0)) best = { score: score, _rank: v, item: e };
    });
    return best;
  }

  // ── Matching action (ticker / nom) ───────────────────────────────────────────────
  function matchStock(token) {
    var qa = strip(token.toUpperCase());
    var bare = qa.replace(/\.[A-Z]{1,3}$/, '');
    var byTicker = _stocks.find(function (x) { var t = (x.ticker || '').toUpperCase(); return t === qa || t === bare; });
    if (byTicker) return byTicker;
    var exact = _stocks.find(function (x) { return strip((x.name || '').toUpperCase()) === qa || strip((x.name_api || '').toUpperCase()) === qa; });
    if (exact) return exact;
    var contains = _stocks.filter(function (x) {
      var n = strip((x.name || '').toUpperCase()), na = strip((x.name_api || '').toUpperCase());
      return n.indexOf(qa) >= 0 || na.indexOf(qa) >= 0;
    });
    if (contains.length) { contains.sort(function (a, b) { return strip((a.name || '').toUpperCase()).indexOf(qa) - strip((b.name || '').toUpperCase()).indexOf(qa); }); return contains[0]; }
    var fw = qa.split(/\s+/)[0];
    if (fw.length >= 4) { var f = _stocks.find(function (x) { return strip((x.name || '').toUpperCase()).indexOf(fw) >= 0 || strip((x.name_api || '').toUpperCase()).indexOf(fw) >= 0; }); if (f) return f; }
    return null;
  }

  function matchIndexMap(token) {
    var nm = norm(token);
    if (!_indexMap || !nm) return null;
    var hit = _indexMap[nm];
    if (!hit) { var ks = Object.keys(_indexMap); for (var i = 0; i < ks.length; i++) { if (nm.indexOf(ks[i]) >= 0 || ks[i].indexOf(nm) >= 0) { hit = _indexMap[ks[i]]; break; } } }
    if (!hit) return null;
    var out = { kind: 'index', symbol: hit.proxy, name: hit.name, display: hit.name, vol_3y: hit.default_vol, beta: hit.default_beta, _estimated: true };
    // Enrichit avec la perf réelle de markets.json si le proxy y figure
    var live = _etfs.find(function (e) { return (e.symbol || '').toUpperCase() === (hit.proxy || '').toUpperCase(); });
    if (live) { out.ytd = live.ytd; out.m3 = live.m3; out.m6 = live.m6; out.w52 = live.w52; out.value = live.value; if (live.vol_3y != null) { out.vol_3y = live.vol_3y; out._estimated = false; } }
    return out;
  }

  // Résolution unifiée d'un token → action | ETF | indice | null
  function resolve(token) {
    var T = token.trim();
    var U = strip(T.toUpperCase());
    var bare = U.replace(/\.[A-Z]{1,3}$/, '');
    var symEtf = _etfs.find(function (e) { return (e.symbol || '').toUpperCase() === U || (e.symbol || '').toUpperCase() === bare; });
    if (symEtf) return { q: T, item: symEtf };
    var tickStock = _stocks.find(function (s) { var t = (s.ticker || '').toUpperCase(); return t === U || t === bare; });
    if (tickStock) return { q: T, item: tickStock };
    // ETF sectoriel STOXX 600 (Banks, Tech, Santé…) : données riches, prioritaire
    var e = bestEtf(T);
    if (e.score >= 0.6) return { q: T, item: e.item };
    // Indices larges curatés (Eurostoxx 50, CAC 40, S&P 500…)
    var im = matchIndexMap(T);
    if (im) return { q: T, item: im };
    var s = matchStock(T);
    if (s) return { q: T, item: s };
    if (e.score >= 0.4) return { q: T, item: e.item };
    return { q: T, item: null };
  }

  // ── Couleurs / verdict ───────────────────────────────────────────────────────────
  function scoreColor(v) { if (v == null) return '#94A3B8'; if (v >= 70) return '#059669'; if (v >= 55) return '#0891B2'; if (v >= 40) return '#D97706'; return '#DC2626'; }
  function bestScore(s) { if (typeof _bestBuffett === 'function') return _bestBuffett(s); if (s.buffett_score != null) return s.buffett_score; if (s.quality_score != null) return s.quality_score; return null; }
  function verdict(s) {
    var b = bestScore(s);
    if (b == null) return { label: 'N/A', c: '#94A3B8', bg: 'rgba(148,163,184,.10)' };
    if (b >= 65) return { label: 'QUALITÉ', c: '#059669', bg: 'rgba(5,150,105,.10)' };
    if (b >= 50) return { label: 'CORRECT', c: '#0891B2', bg: 'rgba(8,145,178,.10)' };
    if (b >= 35) return { label: 'MOYEN', c: '#D97706', bg: 'rgba(217,119,6,.10)' };
    return { label: 'FRAGILE', c: '#DC2626', bg: 'rgba(220,38,38,.08)' };
  }

  // Ton d'une métrique selon sa qualité → pastille colorée
  var TONE = {
    good: { bg: 'rgba(5,150,105,.08)', bd: 'rgba(5,150,105,.25)', fg: '#047857' },
    ok: { bg: '#F1F5F9', bd: '#E2E8F0', fg: '#334155' },
    warn: { bg: 'rgba(217,119,6,.08)', bd: 'rgba(217,119,6,.25)', fg: '#B45309' },
    bad: { bg: 'rgba(220,38,38,.07)', bd: 'rgba(220,38,38,.22)', fg: '#B91C1C' },
    pos: { bg: 'rgba(5,150,105,.08)', bd: 'rgba(5,150,105,.22)', fg: '#047857' },
    neg: { bg: 'rgba(220,38,38,.07)', bd: 'rgba(220,38,38,.20)', fg: '#B91C1C' },
    info: { bg: '#F1F5F9', bd: '#E2E8F0', fg: '#475569' }
  };
  function band(v, hiGood, t) { // t = [seuilBon, seuilMoyen], hiGood = plus c'est haut mieux c'est
    if (v == null || isNaN(v)) return 'info';
    if (hiGood) return v >= t[0] ? 'good' : v >= t[1] ? 'ok' : 'bad';
    return v <= t[0] ? 'good' : v <= t[1] ? 'ok' : 'warn';
  }

  // ── Pastille métrique ─────────────────────────────────────────────────────────────
  function pill(label, value, fmt, tone) {
    var disp;
    if (value == null || (typeof value === 'number' && isNaN(value))) { disp = '—'; tone = 'info'; }
    else if (fmt === 'pct') disp = (value >= 0 ? '+' : '') + (Math.round(value * 10) / 10) + '%';
    else if (fmt === '%') disp = (Math.round(value * 100) / 100) + '%';
    else if (fmt === 'x') disp = (Math.round(value * 100) / 100);
    else disp = value;
    var c = TONE[tone] || TONE.info;
    return '<div style="background:' + c.bg + ';border:1px solid ' + c.bd + ';border-radius:7px;padding:5px 9px;display:flex;flex-direction:column;gap:1px;min-width:62px">'
      + '<span style="font-size:8.5px;text-transform:uppercase;letter-spacing:.5px;color:#64748B;font-weight:700">' + label + '</span>'
      + '<span style="font-family:var(--mono);font-size:12.5px;font-weight:700;color:' + c.fg + '">' + disp + '</span></div>';
  }
  function group(title, pills) {
    return '<div style="margin-top:12px">'
      + '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#94A3B8;margin-bottom:6px">' + title + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:7px">' + pills.join('') + '</div></div>';
  }

  // ── Tuile de score (action) ────────────────────────────────────────────────────────
  function scoreTile(label, score, grade) {
    var c = scoreColor(score);
    return '<div style="text-align:center;min-width:58px;background:' + c + '14;border:1px solid ' + c + '33;border-radius:9px;padding:6px 4px">'
      + '<div style="font-size:8.5px;text-transform:uppercase;letter-spacing:.6px;color:#64748B;font-weight:700">' + label + '</div>'
      + '<div style="font-family:var(--mono);font-size:25px;font-weight:800;line-height:1.05;color:' + c + '">' + (score != null ? score : '—') + '</div>'
      + (grade ? '<div style="font-size:10px;color:' + c + ';font-weight:800">' + grade + '</div>' : '') + '</div>';
  }

  // ── Contexte secteur : situe l'action dans son secteur européen ─────────────────────
  var SECTOR_MAP = {
    'industrials': 'industrials', 'financial services': 'financials', 'finance': 'financials',
    'technology': 'information-technology', 'healthcare': 'healthcare',
    'consumer cyclical': 'consumer-discretionary', 'consumer defensive': 'consumer-staples',
    'utilities': 'utilities', 'basic materials': 'materials', 'real estate': 'real-estate',
    'communication services': 'communication-services', 'energy': 'energy'
  };
  function sectorTrend(groupKey, prefRegion) {
    var grp = _etfs.filter(function (e) { return e.group === groupKey; });
    var want = prefRegion === 'US' ? function (e) { return e.region === 'US'; } : function (e) { return e.region === 'Europe' || e.region === 'EU'; };
    var pref = grp.filter(want);
    var use = pref.length ? pref : grp;
    if (!use.length) return null;
    function avg(f) { var v = use.map(f).filter(function (x) { return x != null && !isNaN(x); }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
    return { ytd: avg(function (e) { return e.ytd; }), vol: avg(function (e) { return e.vol_3y; }), zone: (pref.length ? (prefRegion === 'US' ? 'US' : 'Europe') : 'monde') };
  }
  function sectorContext(s) {
    var gk = SECTOR_MAP[(s.sector_api || '').toLowerCase()];
    var t = gk ? sectorTrend(gk, s._region) : null;
    var bits = [s.sector, s.industry].filter(Boolean).map(function (x, i) {
      return '<span style="' + (i === 0 ? 'color:#334155;font-weight:600' : 'color:#64748B') + '">' + x + '</span>';
    }).join('<span style="color:#CBD5E1"> · </span>');
    var trendHtml = '';
    if (t && t.ytd != null) {
      var tc = t.ytd >= 0 ? '#047857' : '#B91C1C';
      var cmp = '';
      if (s.perf_ytd != null) {
        var d = Math.round((s.perf_ytd - t.ytd) * 10) / 10;
        cmp = Math.abs(d) < 1 ? ' — en ligne avec le secteur'
          : d > 0 ? ' — <span style="color:#047857;font-weight:600">surperforme de ' + d + ' pts</span>'
          : ' — <span style="color:#B91C1C;font-weight:600">sous-performe de ' + Math.abs(d) + ' pts</span>';
      }
      trendHtml = '<div style="margin-top:4px;color:#64748B">Tendance secteur ' + t.zone + ' : '
        + '<span style="color:' + tc + ';font-weight:700">' + (t.ytd >= 0 ? '+' : '') + (Math.round(t.ytd * 10) / 10) + '% YTD</span>'
        + (t.vol != null ? ' · vol ~' + Math.round(t.vol) + '%' : '') + cmp + '</div>';
    }
    return '<div style="margin-top:11px;background:#F8FAFF;border:1px solid #E2E8F0;border-radius:8px;padding:8px 11px;font-size:11px;line-height:1.5">'
      + '<span style="color:#94A3B8">🌐 </span>' + bits + trendHtml + '</div>';
  }

  function criteria(s) {
    if (!Array.isArray(s.buffett_criteria) || !s.buffett_criteria.length) return '';
    var passed = s.buffett_criteria.filter(function (c) { return c.passed; }).length;
    var dots = s.buffett_criteria.map(function (c) {
      var col = c.passed ? '#059669' : '#DC2626';
      return '<span title="' + (c.name || '').replace(/_/g, ' ') + (c.detail ? ' — ' + c.detail : '') + '" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + col + ';margin-right:3px;cursor:help"></span>';
    }).join('');
    return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:10px;color:#64748B;font-weight:600">Critères Buffett ' + passed + '/' + s.buffett_criteria.length + '</span>' + dots + '</div>';
  }

  // ── Carte ACTION ───────────────────────────────────────────────────────────────────
  function stockCard(q, s, worst) {
    var v = verdict(s);
    var flag = s._region === 'US' ? '🇺🇸' : '🇪🇺';
    var dd = s.max_drawdown_3y != null ? -Math.abs(s.max_drawdown_3y) : null;
    return cardShell(worst,
      header(flag + ' ' + (s.name || s.ticker), s.ticker, s.country || '',
        scoreTile('Buffett', s.buffett_score, s.buffett_grade)
        + scoreTile('Quality', s.quality_score, s.quality_grade)
        + verdictPill(v.label, v.c, v.bg))
      + sectorContext(s)
      + group('Rentabilité', [
          pill('ROE', s.roe, '%', band(s.roe, true, [15, 8])),
          pill('ROIC', s.roic, '%', band(s.roic, true, [12, 7])),
          pill('Marge nette', s.net_margin, '%', band(s.net_margin, true, [15, 7]))
        ])
      + group('Solidité / risque', [
          pill('D/E', s.de_ratio, 'x', band(s.de_ratio, false, [0.5, 1.5])),
          pill('Vol 3A', s.volatility_3y, '%', band(s.volatility_3y, false, [22, 32])),
          pill('Max DD 3A', dd, '%', band(dd != null ? Math.abs(dd) : null, false, [25, 40])),
          pill('Beta', s.beta, 'x', band(s.beta, false, [0.9, 1.2]))
        ])
      + group('Valorisation & performance', [
          pill('PER', (s.pe_ratio != null && s.pe_ratio > 0) ? s.pe_ratio : null, 'x', band((s.pe_ratio != null && s.pe_ratio > 0) ? s.pe_ratio : null, false, [18, 28])),
          pill('FCF yield', s.fcf_yield, '%', band(s.fcf_yield, true, [4, 2])),
          pill('Div yield', s.dividend_yield, '%', 'info'),
          pill('Perf YTD', s.perf_ytd, 'pct', s.perf_ytd == null ? 'info' : s.perf_ytd >= 0 ? 'pos' : 'neg'),
          pill('Perf 1A', s.perf_1y, 'pct', s.perf_1y == null ? 'info' : s.perf_1y >= 0 ? 'pos' : 'neg')
        ])
      + criteria(s));
  }

  // ── Carte ETF / INDICE ─────────────────────────────────────────────────────────────
  function etfCard(q, e, worst) {
    var typeLabel = e.kind === 'index' ? 'Indice' : 'ETF sectoriel';
    var sub = [e.indexName || e.name, e.country, e.region && e.region !== 'EU' && e.region !== e.country ? e.region : null].filter(Boolean).join(' · ');
    var perfPills = [
      pill('Perf YTD', e.ytd, 'pct', e.ytd == null ? 'info' : e.ytd >= 0 ? 'pos' : 'neg'),
      pill('3 mois', e.m3, 'pct', e.m3 == null ? 'info' : e.m3 >= 0 ? 'pos' : 'neg'),
      pill('6 mois', e.m6, 'pct', e.m6 == null ? 'info' : e.m6 >= 0 ? 'pos' : 'neg'),
      pill('52 sem.', e.w52, 'pct', e.w52 == null ? 'info' : e.w52 >= 0 ? 'pos' : 'neg')
    ];
    var riskPills = [
      pill('Vol 3A', e.vol_3y, '%', band(e.vol_3y, false, [18, 28])),
      pill('Beta', e.beta, 'x', band(e.beta, false, [0.9, 1.2])),
      pill('Niveau', e.value, 'x', 'info')
    ];
    var note = '<div style="margin-top:10px;font-size:11px;color:#64748B;line-height:1.5">'
      + '📊 <strong>' + typeLabel + '</strong> — pas de score Buffett (panier diversifié). '
      + 'Ce qui compte : <strong>volatilité</strong>' + (e.vol_3y != null ? ' (' + e.vol_3y + '% → ' + (e.vol_3y <= 20 ? 'modérée' : e.vol_3y <= 30 ? 'élevée' : 'très élevée') + ')' : '')
      + ' et <strong>momentum</strong>' + (e.ytd != null ? ' (' + (e.ytd >= 0 ? '+' : '') + (Math.round(e.ytd * 10) / 10) + '% YTD)' : '') + '.'
      + (e._estimated ? ' <em>(vol/beta estimés)</em>' : '') + '</div>';
    return cardShell(worst,
      header('📊 ' + (e.display || e.name), e.symbol, typeLabel + (sub ? ' · ' + sub : ''),
        analysePill())
      + group('Performance', perfPills)
      + group('Risque', riskPills)
      + note);
  }

  function notFoundCard(q) {
    return '<div style="border:1px solid #FCA5A5;background:rgba(220,38,38,.05);border-radius:var(--radius);padding:14px 16px">'
      + '<div style="font-weight:700;color:#DC2626;font-size:13px">« ' + q + ' » introuvable</div>'
      + '<div style="font-size:11px;color:#64748B;margin-top:4px">Essayez le ticker (<span style="font-family:var(--mono)">ASML</span>, <span style="font-family:var(--mono)">MC.PA</span>), le nom complet, ou un secteur (<span style="font-family:var(--mono)">Eurostoxx Banks</span>, <span style="font-family:var(--mono)">Tech</span>, <span style="font-family:var(--mono)">Santé</span>).</div></div>';
  }

  // ── Briques UI ─────────────────────────────────────────────────────────────────────
  function cardShell(worst, inner) {
    var bd = worst ? '2px solid #D97706' : '1px solid var(--border)';
    return '<div style="border:' + bd + ';background:#fff;border-radius:11px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.05)">'
      + (worst ? '<div style="font-size:9px;font-weight:800;color:#D97706;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">⚠ Worst-of — sous-jacent contraignant</div>' : '')
      + inner + '</div>';
  }
  function header(title, ticker, sub, right) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">'
      + '<div style="min-width:0;flex:1">'
      +   '<div style="font-weight:700;font-size:15px;color:#0F172A;line-height:1.2">' + title + '</div>'
      +   '<div style="font-size:11px;color:#64748B;margin-top:3px;display:flex;align-items:center;gap:7px;flex-wrap:wrap">'
      +     (ticker ? '<span style="font-family:var(--mono);background:#F1F5F9;border:1px solid #E2E8F0;border-radius:4px;padding:1px 6px;font-size:10px;color:#334155;font-weight:600">' + ticker + '</span>' : '')
      +     '<span>' + (sub || '') + '</span></div></div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' + right + '</div></div>';
  }
  function verdictPill(label, c, bg) {
    return '<span style="align-self:center;font-size:10px;font-weight:800;padding:5px 12px;border-radius:20px;color:' + c + ';background:' + bg + ';border:1px solid ' + c + '55;letter-spacing:.5px">' + label + '</span>';
  }
  function analysePill() {
    return '<span style="align-self:center;font-size:10px;font-weight:800;padding:5px 12px;border-radius:20px;color:#7C3AED;background:rgba(124,58,237,.08);border:1px solid #7C3AED55;letter-spacing:.5px">ANALYSE</span>';
  }

  // ── Synthèse + rendu liste ──────────────────────────────────────────────────────────
  function renderResults() {
    var input = document.getElementById('ql-input');
    var out = document.getElementById('ql-results');
    if (!input || !out) return;
    var tokens = input.value.split(/[,\n;]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    if (!tokens.length) {
      out.innerHTML = '<div style="text-align:center;color:#94A3B8;font-size:12px;padding:36px 0">Saisissez un ou plusieurs sous-jacents ci-dessus.</div>';
      return;
    }
    loadData().then(function () {
      var resolved = tokens.map(resolve);
      var stocks = resolved.filter(function (r) { return r.item && (r.item.buffett_score != null || r.item.quality_score != null); });
      var worst = null;
      if (stocks.length > 1) worst = stocks.reduce(function (w, r) { var a = bestScore(r.item), b = bestScore(w.item); if (b == null) return r; if (a == null) return w; return a < b ? r : w; });

      var html = '';
      if (stocks.length > 1) {
        var scs = stocks.map(function (r) { return bestScore(r.item); }).filter(function (x) { return x != null; });
        var avg = scs.length ? Math.round(scs.reduce(function (a, b) { return a + b; }, 0) / scs.length) : null;
        var nEtf = resolved.filter(function (r) { return r.item && r.item.kind; }).length;
        html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">'
          + statCard('Worst-of', bestScore(worst.item), (worst.item.name || worst.item.ticker) + ' · ' + verdict(worst.item).label)
          + statCard('Moyenne panier', avg, stocks.length + ' action' + (stocks.length > 1 ? 's' : '') + (nEtf ? ' + ' + nEtf + ' ETF/indice' : ''))
          + '</div>'
          + '<div style="font-size:11px;color:#64748B;margin-bottom:14px">💡 Sur un produit <strong>worst-of</strong>, le titre le plus faible porte le risque réel.</div>';
      }
      html += '<div style="display:flex;flex-direction:column;gap:12px">' + resolved.map(function (r) {
        if (!r.item) return notFoundCard(r.q);
        if (r.item.kind) return etfCard(r.q, r.item, false);
        return stockCard(r.q, r.item, worst && r === worst);
      }).join('') + '</div>';
      out.innerHTML = html;
    });
  }
  function statCard(label, value, sub) {
    var c = scoreColor(value);
    return '<div style="flex:1;min-width:160px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:13px 16px;box-shadow:0 1px 3px rgba(0,0,0,.04)">'
      + '<div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:#64748B;font-weight:700">' + label + '</div>'
      + '<div style="font-family:var(--mono);font-size:24px;font-weight:800;color:' + c + ';line-height:1.1;margin-top:2px">' + (value != null ? value : '—') + '</div>'
      + '<div style="font-size:11px;color:#475569;margin-top:2px">' + sub + '</div></div>';
  }

  // ── Autocomplétion (liste déroulante) ───────────────────────────────────────────────
  var _sug = [], _sugI = -1;
  function currentToken(ta) {
    var v = ta.value, pos = ta.selectionStart;
    var start = Math.max(v.lastIndexOf(',', pos - 1), v.lastIndexOf(';', pos - 1), v.lastIndexOf('\n', pos - 1)) + 1;
    var ends = [v.indexOf(',', pos), v.indexOf(';', pos), v.indexOf('\n', pos)].filter(function (i) { return i >= 0; });
    var end = ends.length ? Math.min.apply(null, ends) : v.length;
    return { start: start, end: end, text: v.slice(start, end).trim() };
  }
  function buildSuggestions(q) {
    var qa = strip((q || '').toUpperCase()).trim();
    if (qa.length < 1 || !_stocks) return [];
    var items = [];
    _stocks.forEach(function (s) {
      var t = (s.ticker || '').toUpperCase(), n = strip((s.name || '').toUpperCase());
      var r = -1;
      if (t === qa) r = 0; else if (t.indexOf(qa) === 0) r = 1; else if (n.indexOf(qa) === 0) r = 2; else if (n.indexOf(qa) >= 0) r = 3;
      if (r >= 0) items.push({ rank: r, kind: 'stock', label: s.name, ticker: s.ticker, sub: [s.sector_api, s.country].filter(Boolean).join(' · '), insert: s.ticker, score: bestScore(s), region: s._region });
    });
    var seen = {};
    _etfs.forEach(function (e) {
      if (seen[e.symbol]) return;
      var sym = (e.symbol || '').toUpperCase(), d = strip((e.display || e.name || '').toUpperCase()), sf = strip((e.sector_fr || '').toUpperCase()), se = strip((e.sector_en || '').toUpperCase());
      var r = -1;
      if (sym === qa) r = 0; else if (sym.indexOf(qa) === 0) r = 1; else if (sf.indexOf(qa) === 0 || se.indexOf(qa) === 0 || d.indexOf(qa) === 0) r = 2; else if (d.indexOf(qa) >= 0 || sf.indexOf(qa) >= 0 || se.indexOf(qa) >= 0) r = 3;
      if (r >= 0) { seen[e.symbol] = 1; items.push({ rank: r + 0.5, kind: e.kind, label: e.display || e.name, ticker: e.symbol, sub: e.kind === 'index' ? 'Indice' : 'ETF sectoriel', insert: e.symbol, region: e.region }); }
    });
    items.sort(function (a, b) { return a.rank - b.rank || a.label.length - b.label.length; });
    return items.slice(0, 8);
  }
  function renderSuggest(items) {
    var box = document.getElementById('ql-suggest');
    if (!box) return;
    _sug = items; _sugI = -1;
    if (!items.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = items.map(function (it, i) {
      var icon = it.kind === 'stock' ? (it.region === 'US' ? '🇺🇸' : '🇪🇺') : '📊';
      var right = it.kind === 'stock'
        ? (it.score != null ? '<span style="font-family:var(--mono);font-weight:700;font-size:11px;color:' + scoreColor(it.score) + '">' + it.score + '</span>' : '')
        : '<span style="font-size:9px;color:#7C3AED;font-weight:700">' + it.sub + '</span>';
      return '<div class="ql-sug" data-i="' + i + '" onmousedown="_qlPick(event,' + i + ')" '
        + 'style="display:flex;align-items:center;gap:8px;padding:7px 11px;cursor:pointer;border-bottom:1px solid #F1F5F9">'
        + '<span style="flex-shrink:0">' + icon + '</span>'
        + '<span style="font-family:var(--mono);font-size:10px;font-weight:700;color:#334155;background:#F1F5F9;border-radius:4px;padding:1px 5px;flex-shrink:0">' + it.ticker + '</span>'
        + '<span style="font-weight:600;font-size:12px;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">' + it.label + '</span>'
        + (it.kind === 'stock' ? '<span style="font-size:10px;color:#94A3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">' + it.sub + '</span>' : '')
        + right + '</div>';
    }).join('');
    box.style.display = 'block';
  }
  function highlight() {
    var box = document.getElementById('ql-suggest'); if (!box) return;
    Array.prototype.forEach.call(box.children, function (el, i) { el.style.background = i === _sugI ? '#EFF6FF' : '#fff'; });
  }
  function pick(i) {
    var it = _sug[i]; if (!it) return;
    var ta = document.getElementById('ql-input'); var tok = currentToken(ta);
    var before = ta.value.slice(0, tok.start), after = ta.value.slice(tok.end).replace(/^[\s,;]+/, '');
    ta.value = before + it.insert + ', ' + after;
    var caret = (before + it.insert + ', ').length;
    ta.focus(); ta.setSelectionRange(caret, caret);
    var box = document.getElementById('ql-suggest'); if (box) box.style.display = 'none';
    renderResults();
  }
  window._qlPick = function (ev, i) { if (ev) ev.preventDefault(); pick(i); };

  function onInput() {
    clearTimeout(_debounce); _debounce = setTimeout(renderResults, 200);
    var ta = document.getElementById('ql-input');
    loadData().then(function () { renderSuggest(buildSuggestions(currentToken(ta).text)); });
  }
  function onKeydown(ev) {
    var box = document.getElementById('ql-suggest');
    var open = box && box.style.display === 'block' && _sug.length;
    if (!open) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); _sugI = (_sugI + 1) % _sug.length; highlight(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); _sugI = (_sugI - 1 + _sug.length) % _sug.length; highlight(); }
    else if (ev.key === 'Enter') { if (_sugI >= 0) { ev.preventDefault(); pick(_sugI); } }
    else if (ev.key === 'Escape') { box.style.display = 'none'; }
  }
  function fillExample(txt) { var i = document.getElementById('ql-input'); if (i) { i.value = txt; i.focus(); renderResults(); } }
  window._qlFill = fillExample;

  // ── Vue ─────────────────────────────────────────────────────────────────────────────
  function renderQualityLookup(container) {
    var ex = ['ASML, LVMH, TotalEnergies', 'Eurostoxx Banks', 'Nvidia, Tech', 'CAC 40'];
    container.innerHTML =
      '<div style="max-width:920px;margin:0 auto">'
      + '<div class="section" style="margin-bottom:18px">'
      +   '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>🔎 Quality — qualité d\'un sous-jacent</div></div>'
      +   '<div style="font-size:12px;color:#64748B;margin-bottom:10px">Tapez un ou plusieurs sous-jacents (ticker, nom, ou secteur). Score <strong>Buffett</strong>/<strong>Quality</strong> pour les actions, analyse <strong>perf + risque</strong> pour les ETF/indices — sans brochure.</div>'
      +   '<div style="position:relative">'
      +     '<textarea id="ql-input" rows="2" autocomplete="off" placeholder="ex. ASML, MC.PA, Eurostoxx Banks, Nvidia" style="width:100%;background:#F1F5F9;border:1px solid var(--border);border-radius:7px;padding:10px 12px;font-family:var(--mono);font-size:13px;color:var(--text);resize:vertical;outline:none"></textarea>'
      +     '<div id="ql-suggest" style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:3px;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 28px rgba(15,23,42,.14);z-index:60;max-height:300px;overflow:auto"></div>'
      +   '</div>'
      +   '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">'
      +     ex.map(function (t) { return '<button onclick="_qlFill(\'' + t.replace(/'/g, "\\'") + '\')" style="font-size:10.5px;color:#475569;background:#F8FAFF;border:1px solid #E2E8F0;border-radius:14px;padding:4px 11px;cursor:pointer">' + t + '</button>'; }).join('')
      +   '</div>'
      + '</div>'
      + '<div id="ql-results"></div></div>';
    var input = document.getElementById('ql-input');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('blur', function () { setTimeout(function () { var b = document.getElementById('ql-suggest'); if (b) b.style.display = 'none'; }, 150); });
    input.focus();
    loadData();
    renderResults();
  }

  window.renderQualityLookup = renderQualityLookup;
})();

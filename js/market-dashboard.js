// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Market Dashboard v1.0
// Page dédiée aux données de marché temps réel pour le carry trade
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _data = { rates: null, mi: null, loaded: false };

  function _fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }
  function _pct(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  // Light theme (same as carry simulator)
  var BG = {
    wrap: '#F8F9FB', section: '#FFFFFF', input: '#F1F3F7',
    row0: '#FFFFFF', row1: '#F4F6F9', header: '#E8ECF2',
    border: '#D1D9E6', highlight: '#E8F0FE',
    text: '#1A202C', textMuted: '#64748B', textDim: '#475569'
  };

  async function _loadData() {
    try {
      var [ratesResp, miResp] = await Promise.all([
        fetch('data/market/rates.json'),
        fetch('data/market/market_intelligence.json')
      ]);
      _data.rates = await ratesResp.json();
      _data.mi = await miResp.json();
      _data.loaded = true;
    } catch(e) {
      console.error('[MarketDashboard] Erreur chargement:', e);
    }
    // Fraîcheur des données ACTIONS (contexte + corrélations) — chargées à part, non bloquantes.
    try { var c = await fetch('data/market/market_context.json'); if (c.ok) _data.ctx = await c.json(); } catch(e) {}
    // Taux sans source gratuite (swaps OIS/IRS, CMS, forwards Euribor) : saisis à la main.
    try { var sw = await fetch('data/market/swaps-manual.json'); if (sw.ok) _data.swaps = await sw.json(); } catch(e) {}
    // Courbe swap EUR officielle (EIOPA, mensuelle) — voir scripts/fetch-swaps-eiopa.py
    try { var sc = await fetch('data/market/swaps.json'); if (sc.ok) _data.swapCurve = await sc.json(); } catch(e) {}
    // Grille CAT des banques — pour mesurer ce qu'elle paie AU-DESSUS du marché.
    try { var cr = await fetch('data/cat/rates.json'); if (cr.ok) _data.catRates = await cr.json(); } catch(e) {}
    try { var k = await fetch('data/market/corr_dispersion_tech.json'); if (k.ok) _data.corr = await k.json(); } catch(e) {}
  }

  function _renderKPI(label, value, color, sub) {
    return '<div style="padding:14px;border:1px solid ' + BG.border + ';border-radius:8px;border-left:4px solid ' + color + ';background:' + BG.section + '">' +
      '<div style="font-size:11px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.8px;text-transform:uppercase">' + label + '</div>' +
      '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + color + ';margin:6px 0">' + value + '</div>' +
      '<div style="font-size:11px;color:' + BG.textDim + ';line-height:1.4">' + sub + '</div></div>';
  }

  // Meilleur CAT disponible = repère sans risque pour la trésorerie. Taux via la source
  // unique window._getCATBenchmark() (cohérente avec le grader) ; détail banque/durée lu
  // dans catManager (offre confirmée au meilleur taux).
  function _bestCAT() {
    var rate = 0, bank = '', dur = null;
    try { if (typeof window._getCATBenchmark === 'function') rate = parseFloat(window._getCATBenchmark()) || 0; } catch (e) {}
    try {
      if (typeof catManager !== 'undefined' && catManager.rates && Array.isArray(catManager.rates.rates)) {
        var best = null;
        catManager.rates.rates.forEach(function(r) {
          if (r.source === 'web scan') return;
          var v = parseFloat(r.rate) || 0; if (v <= 0) return;
          if (!best || v > best.v) best = { v: v, bank: r.bank || r.banque || '', dur: r.durationMonths || r.duration || null };
        });
        if (best) { if (!rate) rate = best.v; bank = best.bank; dur = best.dur; }
      }
    } catch (e) {}
    return { rate: rate, bank: bank, dur: dur };
  }

  // ═══ CONVENTIONS ═══════════════════════════════════════════════════════════
  // Vérifié numériquement le 24/09/2026 : la « spot rate » publiée par la BCE est en
  // COMPOSITION CONTINUE. Test — la moyenne des forwards instantanés sur [0,T] colle au
  // SR publié à 0,5-2 bp près (résidu d'intégration), alors qu'elle s'en écarte de 6,1 à
  // 6,8 bp de façon constante si l'on suppose le SR annuel. Comparer un taux de CAT
  // (actuariel) à ce SR sans conversion surévalue donc la prime d'environ 4 bp.
  function _actu(rCont) { return rCont == null ? null : (Math.exp(rCont / 100) - 1) * 100; }
  // L'€STR est un taux au jour le jour en ACT/360 : capitalisé sur un an il ne vaut pas
  // son niveau affiché (2,440 % → 2,505 %).
  function _estrActu(r) { return r == null ? null : (Math.pow(1 + r / 100 / 360, 365) - 1) * 100; }

  // ═══ RECALAGE DE LA COURBE SWAP ════════════════════════════════════════════
  // EIOPA est mensuel. Comparer un swap du 31/08 à un TEC du jour fait passer le
  // mouvement de marché de l'intervalle pour du spread. On décale donc chaque point de
  // la variation observée sur la courbe AAA quotidienne de même maturité, entre la date
  // EIOPA et aujourd'hui. Approximation assumée : le spread swap/AAA est supposé stable
  // sur l'intervalle — bien plus juste que de ne rien faire.
  function _swapAdj(months) {
    var sc = _data.swapCurve || {}, scv = sc.swap_eur || {};
    var yrs = months / 12, key = yrs + 'y';
    var base = scv[key] != null ? parseFloat(scv[key]) : null;
    if (base == null) return null;
    var SC = (_data.rates && _data.rates.short_curve) || {};
    var d = SC['curve_' + months + 'm'];
    if (!d || !d.history || !sc.as_of) return { v: base, shift: 0, dated: sc.as_of, adjusted: false };
    var then = null;
    for (var i = 0; i < d.history.length; i++) { if (d.history[i].date <= sc.as_of) then = d.history[i].value; else break; }
    if (then == null || d.current == null) return { v: base, shift: 0, dated: sc.as_of, adjusted: false };
    var shift = parseFloat(d.current) - parseFloat(then);
    return { v: base + shift, shift: shift * 100, dated: d.date, adjusted: true };
  }

  function _render(container) {
    var r = _data.rates || {};
    var mi = _data.mi || {};
    var md = mi.market_data_input || {};
    var ai = mi.ai_response || {};

    var yields = r.yields || {};
    var policy = r.policy_rates || {};
    var curve = r.yield_curve || {};

    // TEC10 : on préfère le TEC10 réel (Banque de France) ; à défaut, proxy OAT 10 ans AAA
    // (~70 bp d'écart possible) — la source est affichée explicitement pour ne pas les confondre.
    var tec10Real = !!(yields.tec10_fr && yields.tec10_fr.current != null);
    var tec10 = yields.tec10_fr || yields.oat_fr_10y || {};
    // Courbe FRANÇAISE réelle = séries TEC Banque de France (tec2/5/7/10). Les séries « oat_fr_* »
    // sont en fait la courbe zone euro AAA (allemande) : 58 à 92 bp plus basse. On affiche les deux,
    // sans les confondre — le repère d'un produit émis par une banque française est l'OAT, pas l'AAA.
    var oat5y = yields.tec5_fr || yields.oat_fr_5y || {};
    var oat2y = yields.tec2_fr || yields.oat_fr_2y || {};
    var aaa10 = yields.oat_fr_10y || {};
    var aaa5 = yields.oat_fr_5y || {};
    var bce = policy.ecb_deposit_rate || {};
    var bceMain = policy.ecb_main_rate || {};
    var eur3m = yields.euribor_3m || policy.euribor_3m || {};
    var eur6m = policy.euribor_6m || {};

    var html = '<div style="background:' + BG.wrap + ';border-radius:12px;padding:24px;color:' + BG.text + '">';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid ' + BG.border + '">';
    html += '<div style="font-size:18px;font-weight:800;color:' + BG.text + '">📈 Données de Marché</div>';
    var fetchDate = r.fetched_at ? new Date(r.fetched_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    html += '<div style="font-size:10px;color:' + BG.textDim + ';padding:4px 10px;background:' + BG.row1 + ';border-radius:4px">Dernière MAJ : ' + fetchDate + ' · Source : ECB + Twelve Data + IA</div>';
    html += '</div>';

    // ═══ ALERTE FRAÎCHEUR : les décisions ne doivent pas reposer sur des données périmées ═══
    (function() {
      var ts = r.fetched_at || (mi && mi.timestamp) || (md && md.timestamp);
      if (!ts) return;
      var ageDays = Math.floor((new Date() - new Date(ts)) / 864e5);
      if (isNaN(ageDays) || ageDays < 0) return;
      // Sync auto = 2×/jour en semaine. Au-delà de 4 jours (week-ends absorbés), la synchro est probablement interrompue.
      if (ageDays >= 4) {
        html += '<div style="background:#FEF2F2;border:1px solid #DC2626;border-left:5px solid #DC2626;border-radius:10px;padding:12px 15px;margin-bottom:18px;display:flex;align-items:center;gap:11px">';
        html += '<span style="font-size:19px">⚠️</span>';
        html += '<div style="font-size:12.5px;color:#7F1D1D;line-height:1.45"><strong>Données de marché périmées — ' + ageDays + ' jours.</strong> ';
        html += 'Dernière synchronisation le ' + new Date(ts).toLocaleDateString('fr-FR') + '. La mise à jour automatique semble interrompue : ';
        html += 'les taux et indicateurs ci-dessous <strong>peuvent ne plus refléter le marché</strong>. À vérifier avant toute décision d\'allocation.</div></div>';
      }
    })();

    // ═══ FRAÎCHEUR DONNÉES ACTIONS (alimentent la qualité P2 + les corrélations worst-of du grader) ═══
    (function() {
      var msgs = [];
      var ctxTs = _data.ctx && (_data.ctx.as_of || (_data.ctx._meta && _data.ctx._meta.as_of));
      if (ctxTs) { var a = Math.floor((new Date() - new Date(ctxTs)) / 864e5); if (a >= 7) msgs.push('actions/qualité du ' + new Date(ctxTs).toLocaleDateString('fr-FR') + ' (' + a + 'j)'); }
      var corrTs = _data.corr && _data.corr._meta && _data.corr._meta.generated;
      if (corrTs) { var b = Math.floor((new Date() - new Date(corrTs)) / 864e5); if (b >= 30) msgs.push('corrélations worst-of du ' + new Date(corrTs).toLocaleDateString('fr-FR') + ' (' + b + 'j, figées)'); }
      if (!msgs.length) return;
      html += '<div style="background:#FFFBEB;border:1px solid #D97706;border-left:5px solid #D97706;border-radius:10px;padding:11px 15px;margin-bottom:18px;display:flex;align-items:center;gap:11px">';
      html += '<span style="font-size:18px">⚠️</span>';
      html += '<div style="font-size:12px;color:#78350F;line-height:1.45"><strong>Données actions périmées</strong> — ' + msgs.join(' · ') + '. Elles alimentent la qualité (P2) et les corrélations worst-of du grader : certaines notes peuvent être décalées.</div></div>';
    })();

    // ═══ VERDICT DU JOUR : synthèse 5 secondes ═══
    (function() {
      // Pente lue sur la courbe FRANÇAISE (TEC 2 → TEC 10), cohérente avec les cartes affichées.
      // curve.spread_2_10 vient de la courbe zone euro AAA : trois fois plus plate, il ne faut pas la mélanger.
      var vSpread = (oat2y.current && tec10.current) ? Math.round((tec10.current - oat2y.current) * 100) : Math.round((curve.spread_2_10 || 0) * 100);
      var vTec = tec10.current || 3.10;
      var vHy = md.hy_spread_bps || 0;
      var vVix = md.vix || 0;
      var normal = curve.shape === 'normal';
      var light, title, color, bg;
      if (!normal || vSpread < 0) { light = '🔴'; title = 'Défavorable aux structurés de taux'; color = '#DC2626'; bg = '#FEF2F2'; }
      else if (vSpread < 30 || (vHy && vHy > 450) || (vVix && vVix > 25)) { light = '🟠'; title = 'Favorable sous conditions — vigilance'; color = '#D97706'; bg = '#FFFBEB'; }
      else { light = '🟢'; title = 'Favorable aux structurés de taux capital garanti'; color = '#059669'; bg = '#ECFDF5'; }
      var chips = [];
      chips.push((normal ? '🟢' : '🔴') + ' Courbe ' + (normal ? 'normale' : 'inversée') + ' (' + (vSpread >= 0 ? '+' : '') + vSpread + 'bp 2s10s)');
      chips.push((vTec >= 2.8 ? '🟢' : '🟠') + ' TEC10 ' + vTec.toFixed(2) + '% ' + (vTec >= 2.8 ? '(budget option correct)' : '(bas)'));
      if (vHy) chips.push((vHy > 450 ? '🟠' : '🟢') + ' HY spread ' + vHy + 'bp');
      if (vVix) chips.push((vVix > 25 ? '🟠' : '🟢') + ' VIX ' + vVix.toFixed(0));
      if (ai.regime && ai.regime !== 'unknown') chips.push('🌍 Régime ' + ai.regime);
      html += '<div style="background:' + bg + ';border:1px solid ' + color + '55;border-left:5px solid ' + color + ';border-radius:10px;padding:13px 16px;margin-bottom:20px">';
      html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
      html += '<span style="font-size:20px">' + light + '</span>';
      html += '<span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:' + color + '">Verdict du jour</span>';
      html += '<span style="font-size:14px;font-weight:700;color:#0F172A">' + title + '</span></div>';
      html += '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">';
      chips.forEach(function(c) { html += '<span style="font-size:10.5px;background:#FFFFFF;border:1px solid ' + color + '33;border-radius:14px;padding:3px 10px;color:#334155">' + c + '</span>'; });
      html += '</div>';
      // ── Pourquoi : les deux leviers de coupon (taux vs vol) ──
      var budget5 = Math.round((1 - 1 / Math.pow(1 + (oat5y.current || 2.70) / 100, 5)) * 1000) / 10;
      var budget10 = Math.round((1 - 1 / Math.pow(1 + vTec / 100, 10)) * 1000) / 10;
      html += '<div style="margin-top:10px;padding-top:9px;border-top:1px solid ' + color + '22;font-size:11px;color:#475569">';
      html += '💰 <span style="color:#64748B">Budget option (financé par les taux) :</span> <strong style="color:#0F172A">' + budget5.toFixed(1).replace('.', ',') + '% à 5 ans · ' + budget10.toFixed(1).replace('.', ',') + '% à 10 ans</strong> <span style="color:#64748B">du nominal → finance les coupons, capital garanti</span>';
      html += '</div>';
      html += '<div style="margin-top:7px;display:flex;gap:8px;flex-wrap:wrap;font-size:10.5px">';
      html += '<span style="background:#ECFDF5;border:1px solid #05966933;border-radius:12px;padding:3px 10px;color:#047857"><strong>Levier taux ↑</strong> → budget option ↑ <strong>sans risque capital</strong></span>';
      var volWarn = vVix > 25;
      html += '<span style="background:' + (volWarn ? '#FFFBEB' : '#F1F5F9') + ';border:1px solid ' + (volWarn ? '#D9770633' : '#CBD5E1') + ';border-radius:12px;padding:3px 10px;color:' + (volWarn ? '#B45309' : '#475569') + '"><strong>Levier vol</strong>' + (vVix ? ' (VIX ' + vVix.toFixed(0) + ')' : '') + ' → coupon actions ↑ <strong>en échange de risque</strong></span>';
      html += '</div></div>';
    })();

    // ═══ LECTURE DE LA SITUATION : ce que disent les taux, en clair ═══
    (function() {
      var y = yields || {}, pr = policy || {};
      var num = function (o) { return (o && o.current != null) ? parseFloat(o.current) : null; };
      var dep = num(pr.ecb_deposit_rate), refi = num(pr.ecb_main_rate), depDate = pr.ecb_deposit_rate && pr.ecb_deposit_rate.date;
      var e3 = num(y.euribor_3m), e6 = num(y.euribor_6m), e12 = num(y.euribor_12m);
      var e3Date = y.euribor_3m && y.euribor_3m.date, e3Chg = y.euribor_3m && y.euribor_3m.change_3m_bps;
      var t2 = num(y.tec2_fr) || num(y.oat_fr_2y), t5 = num(y.tec5_fr) || num(y.oat_fr_5y), t10 = num(y.tec10_fr);
      var a2 = num(y.oat_fr_2y), a10 = num(y.oat_fr_10y);
      if (dep == null || e12 == null || t10 == null) return;

      // Ce qui est déjà pricé : forward 6 mois dans 6 mois (segment Euribor pur, ACT/360)
      var fwd66 = (e6 != null && e12 != null) ? (e12 * 12 - e6 * 6) / 6 : null;
      var anticip = Math.round((e12 - dep) * 100);           // hausse intégrée à 1 an, en bp
      var hikes = (anticip / 25).toFixed(1);
      var penteFR = (t2 != null) ? Math.round((t10 - t2) * 100) : null;
      var penteAAA = (a2 != null && a10 != null) ? Math.round((a10 - a2) * 100) : null;
      var primeFR = (a10 != null) ? Math.round((t10 - a10) * 100) : null;
      // Inflation projetée : market intelligence si dispo, sinon hypothèse affichée
      var infl = null, inflSrc = '';
      try {
        var f = md || {};
        infl = parseFloat(f.hicp_yoy || f.euro_inflation || f.pce_yoy) || null;
        if (infl) inflSrc = 'données marché';
      } catch (e) {}
      if (!infl) { infl = 3.4; inflSrc = 'projection BCE S2 2026'; }
      var stale = e3Date && /^\d{4}-\d{2}$/.test(String(e3Date));

      var P = function (x) { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' %'; };
      var R = function (x) { var v = x - infl; return '<span style="font-family:var(--mono);color:' + (v >= 0.5 ? '#047857' : v >= 0 ? '#B45309' : '#B91C1C') + ';font-weight:700">' + (v >= 0 ? '+' : '−') + Math.abs(Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' %</span>'; };

      html += '<div style="background:' + BG.card + ';border:1px solid #BAE6FD;border-left:4px solid #0284C7;border-radius:10px;padding:14px 16px;margin-bottom:16px">';
      html += '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px"><span style="font-size:13px;font-weight:800;color:#075985">📡 Le taux réel — ce qui reste après inflation</span>';
      html += '<span style="font-size:10px;color:' + BG.textDim + '">BCE dépôt ' + P(dep) + (refi != null ? ' · refi ' + P(refi) : '') + (depDate ? ' au ' + depDate : '') + '</span></div>';

      // Ligne 3 — taux réels
      html += '<div style="font-size:11.5px;line-height:1.6;color:' + BG.text + ';margin-bottom:6px"><strong>Le chiffre qui décide : le taux réel</strong> <span style="font-size:10px;color:' + BG.textDim + '">(inflation retenue ' + P(infl) + ', ' + inflSrc + ')</span></div>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:8px">';
      var LR = [];
      try { var bc = (typeof window._getCATBenchmark === 'function') ? parseFloat(window._getCATBenchmark()) : null; if (bc) LR.push(['Meilleur CAT', bc]); } catch (e) {}
      if (t2 != null) LR.push(['OAT 2 ans', t2]);
      if (t5 != null) LR.push(['OAT 5 ans', t5]);
      LR.push(['OAT 10 ans', t10]);
      LR.forEach(function (r) {
        html += '<div style="padding:8px 10px;background:' + BG.bg + ';border-radius:6px"><div style="font-size:10px;color:' + BG.textDim + '">' + r[0] + '</div>' +
          '<div style="font-family:var(--mono);font-size:14px;font-weight:700;color:' + BG.text + '">' + P(r[1]) + '</div>' +
          '<div style="font-size:10px;color:' + BG.textDim + '">réel ' + R(r[1]) + '</div></div>';
      });
      html += '</div>';
      html += '<div style="font-size:11px;line-height:1.55;color:' + BG.textDim + ';padding:8px 10px;background:' + BG.bg + ';border-radius:6px">' +
        '<strong style="color:' + BG.text + '">Ce que ça implique.</strong> Le court terme ne couvre pas l\'inflation : rester court pour « voir venir » coûte du pouvoir d\'achat pendant l\'attente. Seule la partie longue paie un taux réel franchement positif — et c\'est celle que les banques ne proposent pas en direct.' +
        '</div>';
      if (stale) html += '<div style="font-size:10px;color:#B45309;margin-top:7px">⚠ Euribor issu de la <strong>moyenne mensuelle ' + e3Date + '</strong> (série BCE) : il ne reflète pas encore la dernière décision de politique monétaire. Le fixing du jour est typiquement 10 à 20 bp plus haut.</div>';
      html += '</div>';
    })();

    // ═══ L'ÉCHELLE DES TAUX : qui est qui, du plancher au produit ═══
    // Contrainte d'affichage : cinq explications de même poids visuel = mur de texte illisible.
    // La hiérarchie est donc : (1) l'empilement en une barre, lisible en trois secondes ;
    // (2) cinq lignes compactes avec le chiffre qui compte ; (3) la prose derrière un clic.
    (function () {
      var num = function (o) { return (o && o.current != null) ? parseFloat(o.current) : null; };
      var P = function (x) { return x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' %'; };
      var BPs = function (x) { return (x >= 0 ? '+' : '−') + Math.abs(Math.round(x)) + ' bp'; };
      var sw = _data.swaps || {};
      var dep = num(policy.ecb_deposit_rate), refi = num(policy.ecb_main_rate), estr = num(policy.estr);
      var e3 = num(yields.euribor_3m), e6 = num(yields.euribor_6m), e12 = num(yields.euribor_12m);
      var t2 = num(yields.tec2_fr), t5 = num(yields.tec5_fr), t10 = num(yields.tec10_fr);
      var a10 = num(yields.oat_fr_10y);

      var sc = _data.swapCurve || {}, scv = sc.swap_eur || {};
      var _sw = function (mat, manual) {
        if (manual != null) return { v: parseFloat(manual), src: 'manuel' };
        if (scv[mat] != null) return { v: parseFloat(scv[mat]), src: 'eiopa' };
        return { v: null, src: null };
      };
      // La courbe EIOPA est mensuelle : on la recale sur la courbe AAA quotidienne de même
      // maturité, sinon l'écart swap/OAT mesuré contiendrait le mouvement de marché de
      // l'intervalle. Une saisie manuelle, elle, est déjà à sa date et n'est pas touchée.
      var sAdj10 = _swapAdj(120), sAdj24 = _swapAdj(24);
      var _c10 = (sw.cms && sw.cms['10y'] != null) ? { v: parseFloat(sw.cms['10y']), src: 'manuel' } : (sAdj10 ? { v: sAdj10.v, src: 'eiopa' } : { v: null });
      var _c2 = (sw.cms && sw.cms['2y'] != null) ? { v: parseFloat(sw.cms['2y']), src: 'manuel' } : (sAdj24 ? { v: sAdj24.v, src: 'eiopa' } : { v: null });
      var cms10 = _c10.v, cms2 = _c2.v, ois10 = cms10, ois5 = (_swapAdj(60) || {}).v, ois2 = cms2;
      var swShift = (sAdj10 && sAdj10.adjusted) ? sAdj10.shift : null;
      var swAsOf = sw.as_of || (sAdj10 && sAdj10.adjusted ? sAdj10.dated : sc.as_of) || null;
      var swSrc = (_c10.src === 'manuel') ? 'saisie manuelle' : (sc.source ? (swShift != null ? 'EIOPA, recalé' : 'EIOPA') : null);
      var swMissing = (ois10 == null && cms10 == null);

      if (dep == null || t10 == null) return;

      // Produit indexé CMS : portefeuille ET propositions à l'étude.
      var cmsProd = null, cmsWhere = '';
      try {
        var lists = [
          [(window.app && app.state && app.state.portfolio) || [], 'en portefeuille'],
          [(window.app && app.state && app.state.products) || [], 'à l\'étude']
        ];
        for (var li = 0; li < lists.length && !cmsProd; li++) {
          var arr = lists[li][0];
          for (var i = 0; i < arr.length; i++) {
            var u = JSON.stringify(arr[i].underlying || arr[i].underlyings || '') + ' ' + (arr[i].name || '');
            if (/cms/i.test(u)) { cmsProd = arr[i].name || 'produit indexé CMS'; cmsWhere = lists[li][1]; break; }
          }
        }
      } catch (e) {}

      // Styles de l'accordéon — injectés une fois, portée limitée par le préfixe .rk-
      html += '<style>' +
        '.rk-d{border:1px solid ' + BG.border + ';border-radius:8px;background:' + BG.section + ';overflow:hidden}' +
        '.rk-d+.rk-d{margin-top:6px}' +
        '.rk-d>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:11px;padding:10px 13px;user-select:none}' +
        '.rk-d>summary::-webkit-details-marker{display:none}' +
        '.rk-d>summary:hover{background:' + BG.row1 + '}' +
        '.rk-d[open]>summary{border-bottom:1px solid ' + BG.border + ';background:' + BG.row1 + '}' +
        '.rk-n{flex:none;width:21px;height:21px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:#fff}' +
        '.rk-t{font-size:12.5px;font-weight:700;color:' + BG.text + '}' +
        '.rk-s{font-size:10.5px;color:' + BG.textMuted + '}' +
        '.rk-v{margin-left:auto;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;justify-content:flex-end}' +
        '.rk-v b{font-family:var(--mono,ui-monospace,monospace);font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;color:' + BG.text + '}' +
        '.rk-v i{font-style:normal;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums}' +
        '.rk-c{flex:none;font-size:11px;color:' + BG.textMuted + ';transition:transform .15s}' +
        '.rk-d[open] .rk-c{transform:rotate(90deg)}' +
        '.rk-b{padding:12px 13px 13px;font-size:11.5px;line-height:1.65;color:' + BG.textDim + '}' +
        '.rk-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:1px;background:' + BG.border + ';border:1px solid ' + BG.border + ';border-radius:6px;overflow:hidden;margin-bottom:11px}' +
        '.rk-f>div{background:' + BG.section + ';padding:9px 11px}' +
        '.rk-f span{display:block;font-size:9px;letter-spacing:.07em;text-transform:uppercase;font-weight:800;margin-bottom:3px}' +
        '.rk-f p{margin:0;font-size:11px;line-height:1.55;color:' + BG.textDim + '}' +
        '.rk-u{margin-top:10px;padding:9px 11px;border-radius:6px;background:' + BG.row1 + ';font-size:11px;line-height:1.6;color:' + BG.textDim + '}' +
        '.rk-u strong.h{display:block;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px}' +
        '@media(max-width:560px){.rk-d>summary{flex-wrap:wrap}.rk-v{margin-left:0;width:100%;justify-content:flex-start}}' +
        '</style>';

      html += '<div style="margin:22px 0 16px">';
      html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:3px">🪜 L\'échelle des taux — qui est qui</div>';
      html += '<div style="font-size:11px;color:' + BG.textDim + ';margin-bottom:12px">Les taux de cette page ne mesurent pas la même chose. Chaque étage ajoute une prime au précédent : c\'est cet écart qui se négocie. <span style="color:' + BG.textMuted + '">Cliquez un étage pour le détail.</span></div>';

      // ── HERO : l'empilement en une barre ────────────────────────────────────
      // Toutes les bornes sur la MÊME convention (actuarielle) et la MÊME date (aujourd'hui,
      // swap recalé) : enchaîner un €STR ACT/360, un Euribor mensuel et un swap du 31/08
      // faisait passer des écarts de convention et de date pour des primes de marché.
      var _SCr = (_data.rates && _data.rates.short_curve) || {};
      var _cur = function (k) { return (_SCr[k] && _SCr[k].current != null) ? _actu(parseFloat(_SCr[k].current)) : null; };
      var m12 = _cur('curve_12m'), m120 = _cur('curve_120m'), m24 = _cur('curve_24m');
      var anchors = [];
      var estrA0 = _estrActu(estr);
      if (estrA0 != null) anchors.push({ v: estrA0, lab: 'Base — €STR capitalisé sur 1 an', col: '#0891B2' });
      if (m12 != null) anchors.push({ v: m12, lab: 'anticipation BCE à 1 an', col: '#4338CA' });
      if (m120 != null) anchors.push({ v: m120, lab: 'terme, de 1 an à 10 ans', col: '#0F766E' });
      anchors.push({ v: t10, lab: 'risque France (spread OAT-AAA)', col: '#047857' });
      if (anchors.length >= 3) {
        var top = anchors[anchors.length - 1].v;
        html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:14px 15px;margin-bottom:11px">';
        html += '<div style="display:flex;height:26px;border-radius:5px;overflow:hidden;border:1px solid ' + BG.border + '">';
        anchors.forEach(function (a, i) {
          var span = (i === 0) ? a.v : (a.v - anchors[i - 1].v);
          var pct = Math.max(2, span / top * 100);
          html += '<div title="' + a.lab + '" style="width:' + pct + '%;background:' + a.col + ';opacity:' + (i === 0 ? '.85' : (0.5 + i * 0.16)) + '"></div>';
        });
        html += '</div>';
        html += '<div style="display:flex;justify-content:space-between;margin-top:5px;font-family:var(--mono,ui-monospace,monospace);font-size:10px;color:' + BG.textMuted + '"><span>0 %</span><span style="font-weight:700;color:' + BG.text + ';font-size:12px">' + P(top) + '</span></div>';
        html += '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">';
        anchors.forEach(function (a, i) {
          var span = (i === 0) ? a.v : (a.v - anchors[i - 1].v);
          html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 9px;background:' + BG.row1 + ';border-radius:5px">' +
            '<span style="width:9px;height:9px;border-radius:2px;background:' + a.col + ';flex:none"></span>' +
            '<span style="font-family:var(--mono,ui-monospace,monospace);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:' + a.col + '">' + (i === 0 ? P(span) : BPs(span * 100)) + '</span>' +
            '<span style="font-size:10.5px;color:' + BG.textDim + '">' + a.lab + '</span></div>';
        });
        html += '</div>';
        html += '<div style="margin-top:9px;font-size:11px;line-height:1.6;color:' + BG.textDim + '">Lecture : sur les <strong style="color:' + BG.text + '">' + P(top) + '</strong> que rapporte l\'OAT française à 10 ans, <strong>' + P(anchors[0].v) + '</strong> ne sont que le prix de l\'argent au jour le jour. <span style="color:' + BG.textMuted + '">Toutes les bornes viennent de la <strong>même courbe</strong> (zone euro AAA, BCE), à la même date et en convention actuarielle — sans quoi des écarts de base et de date passeraient pour des primes. Le swap, lui, se lit à l\'étage 4.</span> Le reste se gagne en acceptant successivement le risque de taux, la durée, puis le risque France — <strong>et chaque produit qu\'on te propose se juge à l\'étage où ton capital est réellement immobilisé, pas un étage plus bas.</strong></div>';
        html += '</div>';
      }

      // ── Les cinq étages, compacts et dépliables ─────────────────────────────
      var rung = function (o) {
        var h = '<details class="rk-d"' + (o.open ? ' open' : '') + '>';
        h += '<summary><span class="rk-n" style="background:' + o.color + '">' + o.n + '</span>';
        h += '<span><span class="rk-t">' + o.title + '</span><br><span class="rk-s">' + o.who + '</span></span>';
        h += '<span class="rk-v">' + o.chips + '</span><span class="rk-c">›</span></summary>';
        h += '<div class="rk-b">';
        if (o.facts && o.facts.length) {
          h += '<div class="rk-f">';
          o.facts.forEach(function (f) {
            h += '<div><span style="color:' + o.color + '">' + f[0] + '</span><p>' + f[1] + '</p></div>';
          });
          h += '</div>';
        }
        h += o.body;
        h += '<div class="rk-u" style="border-left:3px solid ' + o.color + '"><strong class="h" style="color:' + o.color + '">Pour lire un structuré</strong>' + o.use + '</div>';
        h += '</div></details>';
        return h;
      };
      var V = function (v, note, col) {
        return '<b>' + v + '</b>' + (note ? '<i style="color:' + (col || BG.textMuted) + '">' + note + '</i>' : '');
      };

      html += rung({
        facts: [
          ['Qui décide', 'Le Conseil des gouverneurs de la BCE, environ huit fois par an. Trois taux sont fixés d\'un coup ; la décision s\'applique quelques jours plus tard, à date annoncée.'],
          ['Sur quoi', 'Rien de mesuré : c\'est une <strong>décision</strong>. Le taux de dépôt est le prix auquel la BCE accepte le cash des banques pour la nuit, en quantité illimitée.'],
          ['Où tu le croises', 'Jamais en direct — mais c\'est le plancher sous chaque taux qu\'on te propose. Aucune banque ne te paiera durablement moins que ce qu\'elle obtient sans bouger de son bureau.']
        ],
        n: 1, color: '#7C3AED', title: 'Les taux directeurs', who: 'décidés par la BCE — le plancher',
        chips: V(P(dep), refi != null ? 'refi ' + P(refi) : ''),
        body: '<strong>Pourquoi regarder le dépôt et pas le refi.</strong> Le refi était « le » taux directeur tant que les banques venaient emprunter à la BCE. Depuis 2015 elles nagent dans les liquidités : elles ne lui empruntent plus, elles lui <em>déposent</em>. Le taux qui mord est donc devenu celui du dépôt — le refi n\'est plus qu\'un plafond théorique à ' + (refi != null && dep != null ? Math.round((refi - dep) * 100) + ' bp au-dessus' : 'quelques points au-dessus') + '.',
        use: 'c\'est ce qui finance le <strong>budget option</strong>. Sur un produit à capital garanti, l\'émetteur place ton capital au taux du marché et n\'a que les intérêts à dépenser en coupons. Taux courts hauts = coupons généreux <em>sans</em> risque sur le capital ; taux qui baissent = le même produit devient impossible à structurer. C\'est aussi le plancher du CAT : le structuré doit battre <strong>ça</strong>, pas zéro.'
      });

      html += rung({
        facts: [
          ['Qui le publie', 'La BCE, <strong>chaque matin vers 8 h</strong>, portant sur la journée de la veille. Il a remplacé l\'EONIA en 2022.'],
          ['Sur quoi', 'Des <strong>transactions réellement conclues</strong>, pas des déclarations : les emprunts en blanc au jour le jour des banques de la zone euro auprès de contreparties financières. Moyenne pondérée par les volumes, après élagage des extrêmes.'],
          ['Où tu le croises', 'Dans le <strong>prix de rachat</strong> de tes produits structurés. Quand une salle des marchés te cote une sortie anticipée, elle actualise les flux restants avec cette courbe-là.']
        ],
        n: 2, color: '#0891B2', title: 'Le jour le jour constaté — €STR', who: 'observé, pas décidé' + (policy.estr && policy.estr.date ? ' · ' + policy.estr.date : ''),
        chips: V(P(estr), (estr != null && dep != null) ? BPs((estr - dep) * 100) + ' vs BCE' : ''),
        body: '<strong>Décidé contre constaté.</strong> L\'étage 1 est un prix que la BCE annonce ; celui-ci est un prix que le marché paie vraiment. Les deux collent — ' + ((estr != null && dep != null) ? '<strong>' + Math.abs(Math.round((estr - dep) * 100)) + ' bp</strong> d\'écart aujourd\'hui' : 'à quelques points près') + ' — et c\'est normal : une banque qui peut déposer à la BCE ne prêtera pas beaucoup moins cher à une consœur. Quand cet écart se creuse, c\'est un signal de tension sur la liquidité bancaire.',
        use: 'c\'est le taux avec lequel on <strong>actualise</strong> les flux futurs du produit — donc ce qui fixe sa <strong>valeur de rachat en cours de vie</strong>, le prix auquel la banque te reprend si tu dois sortir avant l\'échéance. Quand l\'€STR monte, la valeur d\'un produit à taux fixe déjà émis baisse.'
      });

      var e3Stale = yields.euribor_3m && /^\d{4}-\d{2}$/.test(String(yields.euribor_3m.date || ''));
      html += rung({
        facts: [
          ['Qui le publie', 'L\'EMMI, à Bruxelles — un organisme privé, pas la BCE. Publication <strong>chaque jour ouvré à 11 h</strong>, pour les échéances 1 semaine, 1, 3, 6 et 12 mois.'],
          ['Sur quoi', 'Une vingtaine de grandes banques déclarent à quel taux elles se prêteraient. Depuis le scandale de manipulation, la méthode est <strong>hiérarchisée</strong> : les transactions réelles d\'abord, les données de marché voisines ensuite, le jugement d\'expert en dernier recours.'],
          ['Où tu le croises', 'Partout dans les contrats : <strong>crédits d\'entreprise indexés</strong> (« Euribor 3 mois + marge »), prêts à taux variable, découverts, et le coupon de toute obligation à taux variable. C\'est le taux de référence le plus utilisé d\'Europe.']
        ],
        n: 3, color: '#0284C7', title: 'L\'interbancaire à terme — Euribor', who: 'base ACT/360' + (e3Stale ? ' · ⚠ moyenne mensuelle ' + yields.euribor_3m.date : ''),
        chips: V(P(e12), (e12 != null && dep != null) ? BPs((e12 - dep) * 100) + ' vs BCE' : '') + '<i style="color:' + BG.textMuted + '">3 m ' + P(e3) + ' · 6 m ' + P(e6) + '</i>',
        body: '<strong>Ce que l\'Euribor ajoute à l\'€STR : le temps.</strong> Prêter une nuit ne demande aucune anticipation ; prêter douze mois oblige à parier sur toutes les décisions BCE de l\'année, et à se faire payer le risque de ne pas revoir son argent avant. D\'où l\'écart de <strong>' + (e12 != null && dep != null ? BPs((e12 - dep) * 100) : '—') + '</strong> entre l\'Euribor 12 mois et le taux de dépôt : <strong>c\'est la mesure directe des hausses que le marché a déjà payées.</strong>' + (e3Stale ? ' <span style="color:#B45309">⚠ Ici en moyenne mensuelle : la BCE ne publie pas le fixing quotidien, et la série quotidienne de la Banque de France s\'arrête en 2024. Le fixing du jour est typiquement un peu plus haut.</span>' : ''),
        use: 'sous-jacent direct des <strong>floaters</strong> et des <strong>range accrual Euribor</strong> — le coupon tombe si l\'Euribor reste dans un corridor. Et c\'est ton <strong>point mort</strong> : quand tu hésites entre placer maintenant ou attendre, cet écart dit ce que le marché price déjà, donc ce que l\'attente doit battre.'
      });

      var swChips = swMissing ? V('à saisir', '', '#B45309')
        : V(P(cms10), '2 ans ' + P(cms2)) + '<i style="color:' + BG.textMuted + '">' + (swSrc || '') + (swAsOf ? ' · ' + swAsOf : '') + '</i>';
      html += rung({
        facts: [
          ['Qui le fixe', '<strong>Personne d\'officiel</strong> : ce sont des prix de marché, cotés en continu par les salles des marchés. Des agrégateurs en publient un niveau de référence quotidien ; EIOPA en publie une version mensuelle, que nous utilisons ici.'],
          ['Sur quoi', 'Un contrat où deux parties <strong>échangent un taux fixe contre un taux variable</strong> pendant N années, sur un montant qui ne change jamais de mains. Le taux fixe qui équilibre l\'échange, c\'est le taux swap à N ans.'],
          ['Où tu le croises', 'Tu ne le vois jamais écrit — mais <strong>c\'est le taux avec lequel ta banque a fabriqué chaque produit qu\'elle te propose</strong>. Et un <strong>CMS 10 ans</strong>, c\'est simplement ce taux relevé à une date donnée : le sous-jacent de tes range accrual.']
        ],
        n: 4, color: swMissing ? '#B45309' : '#0F766E', title: 'Les swaps — OIS, IRS, CMS', who: swMissing ? '⚠ étage manquant' : 'la courbe qui price tes produits',
        chips: swChips,
        body: '<strong>Pourquoi c\'est la vraie courbe sans risque, et pas l\'OAT.</strong> Un swap ne prête aucun capital : seuls les intérêts s\'échangent, le nominal ne bouge jamais. Il n\'y a donc presque pas de risque de crédit dedans — alors qu\'acheter une OAT, c\'est prêter 100 € à l\'État français pendant dix ans. C\'est pour ça que le marché price avec le swap, et que l\'OAT se traite au-dessus.' +
              (swMissing ? ' <br><strong style="color:#B45309">Courbe absente</strong> — à saisir dans <code style="font-size:10px;background:' + BG.input + ';padding:1px 5px;border-radius:3px">data/market/swaps-manual.json</code> depuis l\'écran de ta conseillère.'
                         : ' <br>Source : <strong>EIOPA</strong>, qui publie chaque mois la courbe swap euro pour Solvabilité II — gratuite et officielle. La BCE et la Banque de France ne publient, elles, aucune courbe swap (vérifié).' +
                           (swShift != null ? ' Publiée au ' + (sc.as_of || '—') + ', elle est <strong>recalée de ' + BPs(swShift) + '</strong> sur la variation de la courbe AAA quotidienne de même maturité depuis cette date : sans ce recalage, l\'écart avec l\'OAT du jour contiendrait le mouvement de marché de l\'intervalle au lieu du seul spread.' : '') +
                           ' Une saisie manuelle plus fraîche prend le dessus.') +
              ((cms10 != null && t10 != null) ? ' <br><strong>L\'écart qui compte : swap 10 ans ' + P(cms10) + ' contre OAT France ' + P(t10) + ', soit ' + Math.round((t10 - cms10) * 100) + ' bp.</strong> Lire une barrière CMS sur le TEC te trompe donc de ' + Math.round((t10 - cms10) * 100) + ' bp — dans le sens qui fait conclure « coupon perdu » à tort.' : ''),
        use: 'c\'est l\'étage où se price le produit. Le coupon qu\'on te propose se compare à <em>ce</em> taux pour savoir ce que tu es payé en échange du risque et de l\'option que tu vends. Et toute barrière indexée CMS se lit ici, jamais sur le TEC.'
      });

      html += rung({
        facts: [
          ['Qui le publie', 'La <strong>Banque de France</strong>, chaque jour ouvré. L\'Agence France Trésor, elle, émet la dette.'],
          ['Sur quoi', 'Le TEC 10 n\'est pas une obligation existante : c\'est le rendement d\'une OAT <strong>fictive d\'exactement 10 ans</strong>, interpolé entre les deux OAT réelles qui encadrent cette maturité. D\'où son nom : Taux de l\'Échéance Constante.'],
          ['Où tu le croises', 'C\'est le <strong>sous-jacent direct de tes TARN</strong> — leur barrière se lit ici. Et c\'est le taux auquel l\'État français emprunte : le repère de ce que « sans risque en France » rapporte vraiment sur la durée.']
        ],
        n: 5, color: '#047857', title: 'Le souverain — TEC France', who: 'base ACT/ACT · zone euro AAA en regard',
        chips: V(P(t10), (t10 != null && a10 != null) ? BPs((t10 - a10) * 100) + ' vs AAA' : '', '#B45309') + '<i style="color:' + BG.textMuted + '">2 a ' + P(t2) + ' · 5 a ' + P(t5) + '</i>',
        body: '<strong>Ce que la France paie de plus.</strong> La courbe <strong>zone euro AAA</strong> affichée à côté ne retient que les États les mieux notés, essentiellement l\'Allemagne. L\'écart entre les deux' + (t10 != null && a10 != null ? ' — <strong>' + Math.round((t10 - a10) * 100) + ' bp à 10 ans</strong> —' : '') + ' <em>est</em> le spread OAT-Bund. Les deux séries sont affichées séparément pour ne jamais les confondre.',
        use: 'c\'est le <strong>test de l\'émetteur</strong>. Un EMTN de banque française qui paie <em>moins</em> que l\'OAT de même durée te fait prendre un risque bancaire, une illiquidité et souvent un aléa de rappel — pour un rendement inférieur à celui de l\'État. C\'est aussi le sous-jacent des <strong>TARN TEC 10</strong> : leur barrière se lit ici, et nulle part ailleurs.'
      });

      // ── Le constat CMS, visible sans clic ───────────────────────────────────
      if (cmsProd && cms10 != null) {
        var _bar = null;
        try {
          var _all = [].concat((window.app && app.state && app.state.portfolio) || [], (window.app && app.state && app.state.products) || []);
          for (var _j = 0; _j < _all.length; _j++) {
            if ((_all[_j].name || '') !== cmsProd) continue;
            var _cp = _all[_j].capitalProtection || {}, _co = _all[_j].coupon || {};
            _bar = parseFloat(_co.trigger != null ? _co.trigger : _cp.barrierCoupon);
            break;
          }
        } catch (e) {}
        var _gap = (_bar != null && !isNaN(_bar)) ? Math.round((cms10 - _bar) * 100) : null;
        var _tone = (_gap == null) ? '#0F766E' : (Math.abs(_gap) <= 15 ? '#B45309' : (_gap <= 0 ? '#047857' : '#B91C1C'));
        html += '<div style="margin-top:9px;background:' + BG.section + ';border:1px solid ' + _tone + ';border-left:5px solid ' + _tone + ';border-radius:8px;padding:11px 14px;font-size:11.5px;line-height:1.65;color:' + BG.text + '">';
        html += '<strong>📌 ' + cmsProd + '</strong> <span style="font-size:10px;color:' + BG.textMuted + '">(' + cmsWhere + ')</span><br>';
        if (_gap != null) {
          var _band = (swShift != null) ? ' <span style="font-size:10.5px;color:' + BG.textMuted + '">(± 5 bp : le recalage suppose stable le spread swap/AAA)</span>' : '';
          html += 'Barrière de coupon <strong>' + P(_bar) + '</strong> · CMS 10 ans <strong>' + P(cms10) + '</strong>' + _band + ' → ' +
            (Math.abs(_gap) <= 15
              ? '<strong style="color:' + _tone + '">' + Math.abs(_gap) + ' bp ' + (_gap > 0 ? 'au-dessus' : 'en dessous') + ', le produit est sur le fil.</strong>'
              : (_gap <= 0 ? '<strong style="color:' + _tone + '">' + Math.abs(_gap) + ' bp sous la barrière, condition remplie.</strong>' : '<strong style="color:' + _tone + '">' + _gap + ' bp au-dessus, pas de coupon aux niveaux actuels.</strong>')) + '<br>';
          html += '<span style="color:' + BG.textDim + ';font-size:11px">Jugé au TEC 10 (' + P(t10) + '), l\'écart aurait paru de ' + Math.round((t10 - _bar) * 100) + ' bp — une lecture fausse de ' + Math.round((t10 - cms10) * 100) + ' bp.</span>';
        } else {
          html += 'Indexé sur le CMS 10 ans, à <strong>' + P(cms10) + '</strong>. Barrière non renseignée dans la fiche — à compléter pour que le suivi fonctionne.';
        }
        html += '</div>';
      }

      // ── Ce que le marché price déjà : forwards instantanés BCE ──────────────
      (function () {
        var fw = (_data.rates && _data.rates.forwards) || {};
        var pts = ['fwd_1y', 'fwd_2y', 'fwd_3y', 'fwd_5y', 'fwd_10y'].map(function (k) { return fw[k]; }).filter(function (o) { return o && o.current != null; });
        if (pts.length < 3 || estr == null) return;
        var f1 = fw.fwd_1y ? parseFloat(fw.fwd_1y.current) : null;
        var f3 = fw.fwd_3y ? parseFloat(fw.fwd_3y.current) : null;
        html += '<div style="margin-top:9px;background:' + BG.section + ';border:1px solid ' + BG.border + ';border-left:5px solid #4338CA;border-radius:8px;padding:12px 14px">';
        html += '<div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:8px"><span style="font-size:12.5px;font-weight:700;color:' + BG.text + '">🔭 Ce que le marché price déjà</span><span style="font-size:10px;color:' + BG.textMuted + '">Forwards instantanés BCE' + (pts[0].date ? ' · ' + pts[0].date : '') + '</span></div>';
        html += '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">';
        html += '<div style="padding:7px 10px;background:' + BG.row1 + ';border-radius:5px;min-width:78px"><div style="font-size:9.5px;color:' + BG.textMuted + '">aujourd\'hui</div><div style="font-family:var(--mono,ui-monospace,monospace);font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;color:' + BG.text + '">' + P(estr) + '</div></div>';
        pts.forEach(function (o) {
          var v = parseFloat(o.current), d = Math.round((v - estr) * 100);
          html += '<div style="padding:7px 10px;background:' + BG.section + ';border:1px solid ' + BG.border + ';border-top:3px solid #4338CA;border-radius:5px;min-width:78px">' +
            '<div style="font-size:9.5px;color:' + BG.textMuted + '">dans ' + o.horizon_years + ' an' + (o.horizon_years > 1 ? 's' : '') + '</div>' +
            '<div style="font-family:var(--mono,ui-monospace,monospace);font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;color:' + BG.text + '">' + P(v) + '</div>' +
            '<div style="font-size:9.5px;font-weight:700;color:#4338CA">' + BPs(d) + '</div></div>';
        });
        html += '</div>';
        html += '<div style="font-size:11.5px;line-height:1.6;color:' + BG.textDim + '">Pas une prévision maison : ce qui est <strong>déjà payé</strong> dans les prix d\'aujourd\'hui. ';
        if (f1 != null) html += 'À un an, le marché price <strong>' + P(f1) + '</strong> contre ' + P(estr) + ' aujourd\'hui — <strong>' + Math.round((f1 - estr) * 100) + ' bp de hausse déjà intégrés</strong>. ';
        if (f1 != null && f3 != null && Math.abs(f3 - f1) < 0.25) {
          var f10 = fw.fwd_10y ? parseFloat(fw.fwd_10y.current) : null;
          html += 'Et elle est <strong>plate de 1 à 3 ans</strong> (' + P(f3) + ' à 3 ans) : le marché voit un <strong>pic de politique monétaire puis un plateau</strong>, pas un cycle qui continue. ';
          if (f10 != null) html += 'La remontée au-delà (' + P(f10) + ' à 10 ans) n\'est <em>pas</em> une anticipation de hausses supplémentaires : c\'est de la <strong>prime de terme</strong>, le supplément exigé pour immobiliser son argent longtemps. ';
        }
        html += '<strong>Attendre ne rapporte que si la hausse dépasse ce niveau.</strong></div>';
        html += '</div>';
      })();

      html += '</div>';
    })();

    // ═══ TON CAT PAIE-T-IL LE MARCHÉ ? ═══
    // La question qui revient tout le temps : « les taux vont monter, dois-je attendre ? »
    // Elle se tranche en décomposant le taux offert : €STR d'aujourd'hui + ce que le marché
    // price déjà de hausses sur la durée + la marge de la banque. Seule la marge peut encore
    // bouger : la hausse anticipée, elle, est déjà payée.
    (function () {
      var num = function (o) { return (o && o.current != null) ? parseFloat(o.current) : null; };
      var P = function (x) { return x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' %'; };
      var BP = function (x) { return (x >= 0 ? '+' : '−') + Math.abs(Math.round(x)) + ' bp'; };
      var estr = num(policy.estr);
      var scv = (_data.swapCurve && _data.swapCurve.swap_eur) || {};
      var e3 = num(yields.euribor_3m), e6 = num(yields.euribor_6m), e12 = num(yields.euribor_12m);
      if (estr == null || !scv['1y']) return;

      // UNE SEULE courbe de référence pour tout ce bloc : la courbe quotidienne BCE des
      // États zone euro notés AAA, aux maturités exactes d'une grille CAT. Mélanger deux
      // références (swap au 31/08 ici, AAA au 22/09 là) donnait deux « marché » différents
      // à 12 mois sur la même page — illisible. Le swap reste la référence du LONG, dans
      // le bloc structurés, où sa granularité mensuelle ne gêne pas.
      // Conventions alignées : un taux de CAT est annoncé en ACTUARIEL. La courbe BCE est
      // en composition continue et l'€STR en ACT/360 au jour le jour — comparer sans
      // convertir surévalue la prime d'environ 4 bp à 12 mois.
      var SCd = (_data.rates && _data.rates.short_curve) || {};
      var cv = { 0: _estrActu(estr) };
      [['curve_3m', 3], ['curve_6m', 6], ['curve_9m', 9], ['curve_12m', 12], ['curve_24m', 24],
       ['curve_60m', 60], ['curve_84m', 84], ['curve_120m', 120]].forEach(function (k) {
        if (SCd[k[0]] && SCd[k[0]].current != null) cv[k[1]] = _actu(parseFloat(SCd[k[0]].current));
      });
      if (cv[12] == null) return;   // sans la courbe quotidienne, pas d'analyse CAT
      var mkeys = Object.keys(cv).map(Number).sort(function (a, b) { return a - b; });
      var market = function (m) {
        if (m <= mkeys[0]) return cv[mkeys[0]];
        for (var i = 0; i < mkeys.length - 1; i++) {
          var a = mkeys[i], b = mkeys[i + 1];
          if (m >= a && m <= b) return cv[a] + (cv[b] - cv[a]) * (m - a) / (b - a);
        }
        return cv[mkeys[mkeys.length - 1]];
      };

      // Offres CAT récentes, taux fixe uniquement (le progressif se compare à horizon de sortie,
      // pas à maturité — il a sa propre grille d'équivalence).
      var raw = (_data.catRates && _data.catRates.rates) || [];
      var cutoff = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
      var offers = [];
      raw.forEach(function (o) {
        if ((o.date || '') < cutoff) return;
        if (o.rateType === 'progressif') return;
        var m = parseInt(o.durationMonths, 10), r = parseFloat(o.rate);
        if (!m || isNaN(r)) return;
        var mr = market(m);
        offers.push({ bank: o.bankName || o.bankId, prod: o.productName || '', m: m, r: r, mr: mr, sp: (r - mr) * 100, date: o.date || '' });
      });
      if (offers.length < 4) return;
      offers.sort(function (a, b) { return a.m - b.m || b.r - a.r; });

      // Meilleure offre à 12 mois : c'est elle qui sert de base au calcul « attendre ? »
      var best12 = null, best24 = null;
      offers.forEach(function (o) {
        if (o.m === 12 && (!best12 || o.r > best12.r)) best12 = o;
        if (o.m === 24 && (!best24 || o.r > best24.r)) best24 = o;
      });

      html += '<div style="margin:22px 0 16px">';
      html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:3px">💶 Ton CAT paie-t-il le marché ?</div>';
      html += '<div style="font-size:11px;color:' + BG.textDim + ';margin-bottom:12px">Un taux CAT n\'est pas « le taux d\'aujourd\'hui » : c\'est la moyenne des taux courts attendus sur toute la durée, plus la marge de la banque. Décomposer les deux répond à la seule vraie question — reste-t-il quelque chose à gagner en attendant ?</div>';

      // ── La décomposition, sur la meilleure offre 12 mois
      if (best12) {
        var estrA = _estrActu(estr);
        var antic = (best12.mr - estrA) * 100, marge = best12.sp;
        html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:13px 15px;margin-bottom:11px">';
        html += '<div style="font-size:11.5px;font-weight:700;color:' + BG.text + ';margin-bottom:9px">D\'où viennent les ' + P(best12.r) + ' de <span style="color:#0F766E">' + best12.bank + ' à ' + best12.m + ' mois</span></div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:stretch;margin-bottom:9px">';
        var parts = [
          ['€STR capitalisé 1 an', P(estrA), '#0891B2', '2,44 % au jour le jour, ACT/360, composé'],
          ['+ hausses déjà pricées', BP(antic), '#4338CA', 'l\'anticipation BCE sur ' + best12.m + ' mois, déjà payée'],
          ['+ prime de la banque', BP(marge), marge >= 20 ? '#047857' : marge >= 0 ? '#B45309' : '#B91C1C', 'ce qu\'elle te paie au-dessus du sans-risque']
        ];
        parts.forEach(function (pt) {
          html += '<div style="flex:1;min-width:145px;padding:10px 12px;background:' + BG.row1 + ';border:1px solid ' + BG.border + ';border-top:3px solid ' + pt[2] + ';border-radius:6px">';
          html += '<div style="font-size:9.5px;color:' + BG.textMuted + '">' + pt[0] + '</div>';
          html += '<div style="font-family:var(--mono,ui-monospace,monospace);font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;color:' + pt[2] + '">' + pt[1] + '</div>';
          html += '<div style="font-size:9.5px;color:' + BG.textMuted + ';line-height:1.4;margin-top:2px">' + pt[3] + '</div></div>';
        });
        html += '</div>';
        html += '<div style="font-size:11.5px;line-height:1.6;color:' + BG.textDim + '"><strong style="color:' + BG.text + '">Ce que ça veut dire.</strong> Sur les ' + Math.round((best12.r - estrA) * 100) + ' bp que ce CAT paie au-dessus du jour le jour, <strong>' + Math.round(antic) + ' bp sont l\'anticipation de hausse déjà intégrée</strong> et seulement <strong>' + Math.round(marge) + ' bp</strong> la prime propre à la banque — ce qu\'elle consent au-dessus du sans-risque pour capter ton dépôt, et non ce qu\'elle encaisse. Une hausse BCE conforme aux attentes ne fera donc <em>pas</em> monter ce taux : elle est déjà dedans. Seule une hausse <em>au-delà</em> du forward, ou un rattrapage de marge, peut le bouger.</div>';
        html += '</div>';
      }

      var gridDrift = null, gridDateUsed = null;   // renseignés par le bloc « retard » ci-dessous
      // ── Où sera la grille dans un an ? Le forward 1 an dans 1 an ───────────
      // Ni le forward instantané (niveau du jour le jour dans 1 an) ni la moyenne sur
      // 12 mois ne répondent à cette question. Le 1y1y, si : c'est le taux à 1 an tel que
      // le marché le price dans 1 an. Reconstruit depuis les spots continus 1 et 2 ans.
      var f1y1y = null;
      (function () {
        var SC2 = (_data.rates && _data.rates.short_curve) || {};
        var s1 = SC2.curve_12m && SC2.curve_12m.current, s2 = SC2.curve_24m && SC2.curve_24m.current;
        if (s1 == null || s2 == null) return;
        f1y1y = _actu(2 * parseFloat(s2) - parseFloat(s1));   // continus : additifs
      })();

      // ── Ta grille a-t-elle pris du retard ? ─────────────────────────────────
      // Une grille CAT est figée à sa date d'édition ; le marché, lui, bouge tous les
      // jours. Si le marché a monté depuis, la banque a mécaniquement gagné de la marge
      // et la prochaine grille « doit » monter d'autant. Si le marché n'a pas bougé
      // depuis, attendre ne capte rien. C'est mesurable, donc on le mesure.
      (function () {
        var SC = (_data.rates && _data.rates.short_curve) || {};
        var keys = ['curve_3m', 'curve_6m', 'curve_9m', 'curve_12m', 'curve_24m'];
        var series = keys.map(function (k) { return SC[k]; }).filter(function (o) { return o && o.history && o.history.length; });
        if (series.length < 3) return;

        // La courbe quotidienne oscille de ±5 bp d'un jour à l'autre (ex. 12 mois :
        // 3,026 le 14/09, 2,967 le 16/09, 3,023 le 18/09). Comparer deux jours isolés,
        // c'est lire du bruit. On prend donc la moyenne des 5 derniers jours cotés.
        var WIN = 5;
        var at = function (s, d) {
          var h = s.history, acc = [];
          for (var i = 0; i < h.length; i++) {
            if (h[i].date > d) break;
            acc.push(h[i].value);
            if (acc.length > WIN) acc.shift();
          }
          if (!acc.length) return null;
          return acc.reduce(function (a, b) { return a + b; }, 0) / acc.length;
        };
        // Date de grille la plus fréquente parmi les offres retenues.
        var counts = {};
        offers.forEach(function (o) { if (o.date) counts[o.date] = (counts[o.date] || 0) + 1; });
        var gridDate = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? 1 : -1); })[0];
        if (!gridDate) return;
        var today = series[0].date;

        var rows = series.map(function (s) {
          var then = at(s, gridDate), now = at(s, s.date);
          return { m: s.months, then: then, now: now, drift: (then != null) ? (now - then) * 100 : null };
        }).filter(function (r) { return r.drift != null; });
        if (!rows.length) return;

        var maxDrift = rows.reduce(function (a, r) { return Math.abs(r.drift) > Math.abs(a) ? r.drift : a; }, 0);
        gridDrift = maxDrift; gridDateUsed = gridDate;
        var stale = Math.abs(maxDrift) >= 12;
        var tone = stale ? '#B45309' : '#047857';

        html += '<div style="margin-top:11px;background:' + BG.section + ';border:1px solid ' + BG.border + ';border-left:5px solid ' + tone + ';border-radius:8px;padding:13px 15px">';
        html += '<div style="font-size:11.5px;font-weight:700;color:' + BG.text + ';margin-bottom:3px">📅 Ta grille a-t-elle pris du retard ?</div>';
        html += '<div style="font-size:10.5px;color:' + BG.textMuted + ';margin-bottom:10px">Une grille est figée à sa date d\'édition — ici le <strong>' + gridDate + '</strong> — pendant que le marché bouge chaque jour. S\'il a monté depuis, la banque a encaissé la différence et la prochaine grille la doit mécaniquement.</div>';

        html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
        html += '<thead><tr style="background:' + BG.header + '">' +
          ['Maturité', 'Marché au ' + gridDate.slice(8) + '/' + gridDate.slice(5, 7), 'Marché au ' + today.slice(8) + '/' + today.slice(5, 7), 'Dérive']  /* moyennes 5 jours */.map(function (h, i) {
            return '<th style="padding:6px 9px;text-align:' + (i ? 'right' : 'left') + ';font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:' + BG.textDim + ';white-space:nowrap">' + h + '</th>';
          }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r, i) {
          var c = Math.abs(r.drift) >= 12 ? '#B45309' : BG.textMuted;
          html += '<tr style="background:' + (i % 2 ? BG.row1 : BG.row0) + ';border-bottom:1px solid ' + BG.border + '">';
          html += '<td style="padding:5px 9px;color:' + BG.text + ';white-space:nowrap">' + r.m + ' mois</td>';
          html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:' + BG.textMuted + '">' + P(r.then) + '</td>';
          html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:' + BG.text + '">' + P(r.now) + '</td>';
          html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-weight:700;color:' + c + ';white-space:nowrap">' + BP(r.drift) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';

        // Un écart n'a de sens ni sans son signe ni sans son montant : une grille en retard
        // dans un marché qui BAISSE est une grille généreuse, donc un signal de souscrire,
        // pas de négocier. Et 12 bp ne se négocient pas sur 100 k€, mais sur 2 M€ oui.
        var NREF = 300000, r12 = rows.filter(function (r) { return r.m === 12; })[0] || rows[rows.length - 1];
        var euros = Math.abs(NREF * (r12.drift / 100) / 100 * (r12.m / 12));
        html += '<div style="margin-top:9px;font-size:11.5px;line-height:1.65;color:' + BG.textDim + '">';
        if (stale && maxDrift > 0) {
          html += '<strong style="color:' + BG.text + '">Retard dans un marché qui monte.</strong> Le marché a pris jusqu\'à <strong style="color:' + tone + '">' + BP(maxDrift) + '</strong> depuis l\'édition de la grille : la banque encaisse l\'écart tant qu\'elle ne la réédite pas. <strong>Demande l\'actualisation maintenant</strong>, chiffre en main — tu captes le rattrapage sans perdre un mois d\'intérêts.';
        } else if (stale) {
          html += '<strong style="color:' + BG.text + '">Retard dans un marché qui baisse.</strong> Le marché a reculé de <strong style="color:' + tone + '">' + BP(Math.abs(maxDrift)) + '</strong> depuis l\'édition de la grille : <strong>elle est devenue généreuse</strong>. Le geste n\'est pas de négocier mais de <strong>souscrire avant la réédition</strong>, qui la ramènera au marché.';
        } else {
          html += '<strong style="color:' + BG.text + '">Pas de retard.</strong> Le marché n\'a quasiment pas bougé depuis l\'édition de la grille (' + BP(maxDrift) + ' au plus) : elle est au prix du jour. <strong>Attendre la grille suivante ne capterait rien</strong>, et coûterait le mois d\'intérêts.';
        }
        html += ' <span style="color:' + BG.textMuted + '">À ' + r12.m + ' mois, l\'écart de ' + BP(r12.drift) + ' vaut <strong>' + _fmt(Math.round(euros)) + ' €</strong> sur ' + _fmt(NREF) + ' € — c\'est ce montant, pas le nombre de points de base, qui dit si une négociation vaut le coup de fil.</span>';
        html += '</div>';
        if (f1y1y != null && best12) {
          html += '<div style="margin-top:9px;padding:10px 12px;background:' + BG.row1 + ';border-radius:6px;font-size:11.5px;line-height:1.65;color:' + BG.textDim + '">';
          html += '<strong style="color:' + BG.text + '">Et dans un an, où sera la grille ?</strong> Ni la moyenne sur 12 mois ni le forward instantané ne répondent à ça. Le bon instrument est le <strong>forward 1 an dans 1 an</strong> : <strong>' + P(f1y1y) + '</strong>. Avec la même prime bancaire (' + BP(best12.sp) + '), la grille 12 mois de l\'an prochain devrait sortir autour de <strong>' + P(f1y1y + best12.sp / 100) + '</strong>, contre ' + P(best12.r) + ' aujourd\'hui.';
          html += ' <strong>Ce n\'est pas une raison d\'attendre</strong> : sur une courbe ascendante la fenêtre glisse toujours vers le haut, mais tu perds le portage entre-temps. En espérance, c\'est une opération blanche.</div>';
        }
        html += '<div style="margin-top:9px;padding:9px 11px;background:' + BG.row1 + ';border-radius:6px;font-size:11px;line-height:1.6;color:' + BG.textMuted + '"><strong style="color:' + BG.text + '">Ce qu\'il faut surveiller, et ce n\'est pas une date.</strong> Une hausse BCE conforme au pricing ne déplace pas la grille : la décision du 10 septembre a fait bouger le 12 mois de <strong>+11,8 bp en une séance</strong>, mais sa date d\'effet, le 16, l\'a laissé à <strong>−2,3 bp</strong>. Ce sont les <em>surprises</em> qui comptent — inflation flash, pétrole, discours du Conseil — pas le calendrier des réunions. D\'où un suivi déclenché par un mouvement de courbe au-delà du seuil, et non par une échéance.</div>';
        html += '<div style="margin-top:7px;font-size:10px;color:' + BG.textMuted + ';line-height:1.55">Référence : courbe zone euro AAA quotidienne (BCE), aux maturités exactes de la grille. L\'Euribor ne convient pas ici — la BCE ne le publie qu\'en <strong>moyennes mensuelles</strong>, donc il ne peut pas dater une dérive de trois semaines. <strong>Chaque valeur est une moyenne sur 5 jours cotés</strong> : la courbe oscille de ±5 bp d\'un jour à l\'autre, et comparer deux jours isolés reviendrait à lire du bruit. Un retard n\'est signalé qu\'au-delà de <strong>12 bp</strong>.</div>';
        html += '</div>';
      })();

      // ── Attendre le prochain CAT ? Le point mort, en euros
      if (best12) {
        var mont = 300000;
        try { var mm = (window.app && app.state && app.state.deposits) ? null : null; } catch (e) {}
        var H = best12.m + 1;                                      // durée de l'offre + le mois d'attente
        var gainNow = mont * best12.r / 100 * H / 12;              // placer tout de suite couvre H mois
        var beEmpty = gainNow / mont * 100;                        // cash dormant à 0 %
        var beRem = (gainNow - mont * 2.0 / 100 / 12) / mont * 100; // cash à 2 % pendant l'attente
        html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-left:5px solid #B45309;border-radius:8px;padding:13px 15px;margin-bottom:11px">';
        html += '<div style="font-size:11.5px;font-weight:700;color:' + BG.text + ';margin-bottom:8px">⏳ Attendre la grille du mois prochain ?</div>';
        html += '<div style="font-size:11.5px;line-height:1.65;color:' + BG.textDim + ';margin-bottom:9px">Attendre un mois, c\'est un mois sans intérêts. Pour que ce soit rentable, la grille suivante doit compenser ce mois perdu <em>en plus</em> d\'égaler le taux d\'aujourd\'hui. Sur ' + _fmt(mont) + ' € et un horizon commun de ' + H + ' mois :</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px">';
        [['Placer maintenant', P(best12.r) + ' sur ' + best12.m + ' m', _fmt(Math.round(gainNow)) + ' €', '#047857'],
         ['Attendre — cash à 0 %', 'il faudrait ' + P(beEmpty), BP((beEmpty - best12.r) * 100) + ' vs aujourd\'hui', '#B45309'],
         ['Attendre — cash à 2 %', 'il faudrait ' + P(beRem), BP((beRem - best12.r) * 100) + ' vs aujourd\'hui', '#B45309']
        ].forEach(function (c) {
          html += '<div style="flex:1;min-width:155px;padding:10px 12px;background:' + BG.row1 + ';border:1px solid ' + BG.border + ';border-top:3px solid ' + c[3] + ';border-radius:6px">';
          html += '<div style="font-size:9.5px;color:' + BG.textMuted + '">' + c[0] + '</div>';
          html += '<div style="font-family:var(--mono,ui-monospace,monospace);font-size:14px;font-weight:700;color:' + BG.text + '">' + c[1] + '</div>';
          html += '<div style="font-size:10px;font-weight:700;color:' + c[3] + '">' + c[2] + '</div></div>';
        });
        html += '</div>';
        var f1 = (_data.rates && _data.rates.forwards && _data.rates.forwards.fwd_1y) ? parseFloat(_data.rates.forwards.fwd_1y.current) : null;
        var f3 = (_data.rates && _data.rates.forwards && _data.rates.forwards.fwd_3y) ? parseFloat(_data.rates.forwards.fwd_3y.current) : null;
        html += '<div style="font-size:11.5px;line-height:1.65;color:' + BG.textDim + '"><strong style="color:' + BG.text + '">Le marché price-t-il ce rattrapage ?</strong> ';
        if (f1 != null && f3 != null) {
          html += 'Non. Le forward à 1 an est à <strong>' + P(f1) + '</strong> et celui à 3 ans à <strong>' + P(f3) + '</strong> : la courbe est <strong>plate de 1 à 3 ans</strong>. Le marché voit un pic de politique monétaire autour de ' + P(Math.max(f1, f3)) + ' puis un plateau — pas un cycle de hausses qui continue. ';
        }
        html += '</div>';
        var beNeed = (beEmpty - best12.r) * 100, beNeedRem = (beRem - best12.r) * 100;
        html += '<div style="margin-top:8px;padding:9px 11px;background:' + BG.row1 + ';border-radius:6px;font-size:11.5px;line-height:1.65;color:' + BG.textDim + '">';
        html += '<strong style="color:' + BG.text + '">Verdict.</strong> ';
        if (gridDrift != null && Math.abs(gridDrift) >= 12) {
          html += 'Ta grille traîne <strong>' + BP(gridDrift) + '</strong> de retard sur le marché, pour un point mort de <strong>' + BP(beNeed) + '</strong> (cash dormant) ou <strong>' + BP(beNeedRem) + '</strong> (cash rémunéré). ';
          html += (gridDrift >= beNeedRem)
            ? '<strong>Le rattrapage dû dépasse le coût de l\'attente si ton cash reste rémunéré</strong> — mais la bonne réponse n\'est pas d\'attendre : c\'est de <strong>demander l\'actualisation tout de suite</strong>, chiffre en main. Tu prends le rattrapage sans payer le mois.'
            : 'Le rattrapage dû ne couvre pas le coût de l\'attente. Place maintenant.';
        } else if (gridDrift != null) {
          html += 'La grille est au prix du jour (' + BP(gridDrift) + ' de dérive), et la courbe ne monte plus entre 1 et 3 ans. <strong>Rien à capter en attendant</strong> : le mois d\'intérêts serait perdu sec. Place maintenant.';
        } else {
          html += 'Attendre un mois pour capter une hausse déjà payée coûte le mois d\'intérêts, sans contrepartie.';
        }
        html += '</div>';
        html += '</div>';
      }

      // ── Le tableau : chaque offre face au marché de même durée
      html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:13px 15px">';
      html += '<div style="font-size:11.5px;font-weight:700;color:' + BG.text + ';margin-bottom:3px">Chaque offre face au marché de même durée</div>';
      html += '<div style="font-size:10.5px;color:' + BG.textMuted + ';margin-bottom:9px">L\'écart est la <strong>prime</strong> que la banque te consent au-dessus du sans-risque de même durée — pas sa marge : c\'est ce qu\'elle <em>paie</em>, en échange de ton risque de crédit sur elle et de la valeur réglementaire de ton dépôt. C\'est le seul chiffre qui se négocie.</div>';
      html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<thead><tr style="background:' + BG.header + '">' +
        ['Banque', 'Produit', 'Durée', 'Taux CAT', 'Sans risque', 'Prime'].map(function (h, i) {
          return '<th style="padding:6px 9px;text-align:' + (i < 3 ? 'left' : 'right') + ';font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:' + BG.textDim + ';white-space:nowrap">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
      offers.forEach(function (o, i) {
        var col = o.sp >= 25 ? '#047857' : o.sp >= 5 ? '#0F766E' : o.sp >= -5 ? '#B45309' : '#B91C1C';
        html += '<tr style="background:' + (i % 2 ? BG.row1 : BG.row0) + ';border-bottom:1px solid ' + BG.border + '">';
        html += '<td style="padding:5px 9px;color:' + BG.text + ';white-space:nowrap">' + o.bank + '</td>';
        html += '<td style="padding:5px 9px;color:' + BG.textMuted + ';font-size:10px">' + o.prod.slice(0, 30) + '</td>';
        html += '<td style="padding:5px 9px;color:' + BG.textDim + ';white-space:nowrap">' + o.m + ' m</td>';
        html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-weight:700;color:' + BG.text + '">' + P(o.r) + '</td>';
        html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:' + BG.textMuted + '">' + P(o.mr) + '</td>';
        html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-weight:700;color:' + col + ';white-space:nowrap">' + BP(o.sp) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      html += '<div style="margin-top:8px;font-size:10.5px;color:' + BG.textMuted + ';line-height:1.55">Référence : <strong>courbe quotidienne BCE des États zone euro notés AAA</strong> (série YC), aux maturités exactes de la grille, <strong>convertie de la composition continue vers l\'actuariel</strong> pour être comparable à un taux de CAT. En deçà de 6 mois la courbe est mal contrainte (le modèle n\'utilise que des titres de plus de 3 mois) : les primes y sont à prendre avec réserve. Le progressif est exclu — il se compare à horizon de sortie, via la grille d\'équivalence de l\'onglet CAT.</div>';

      // ── L'anomalie de pente, si elle existe
      if (best12 && best24) {
        var catStep = (best24.r - best12.r) * 100, mktStep = (best24.mr - best12.mr) * 100;
        if (catStep - mktStep >= 15) {
          html += '<div style="margin-top:11px;background:#ECFDF5;border:1px solid #059669;border-left:5px solid #059669;border-radius:8px;padding:11px 14px;font-size:11.5px;line-height:1.65;color:#064E3B">';
          html += '<strong>📈 Une anomalie de pente à exploiter.</strong> Passer de 12 à 24 mois te rapporte <strong>' + BP(catStep) + '</strong> chez ' + best24.bank + ' (' + P(best12.r) + ' → ' + P(best24.r) + '), alors que le marché ne valorise cette année supplémentaire que <strong>' + BP(mktStep) + '</strong>. La banque paie donc <strong>' + BP(catStep - mktStep) + ' de prime de terme au-delà du marché</strong>. ';
          // Le vrai comparatif n'est pas « 24 mois contre 12 mois » mais « 24 mois contre
          // 12 mois PUIS renouvellement au taux que le marché price déjà » (le 1y1y).
          if (f1y1y != null) {
            var roll = f1y1y + best12.sp / 100;
            var chain = (Math.sqrt((1 + best12.r / 100) * (1 + roll / 100)) - 1) * 100;
            html += '<br><br><strong>Le bon comparatif.</strong> Pas « 24 mois contre 12 mois » — mais 24 mois contre <em>12 mois puis renouvellement au taux que le marché price déjà</em>. Ce renouvellement ressort à ' + P(roll) + ' (forward 1 an dans 1 an, plus la même prime), soit une chaîne à <strong>' + P(chain) + '</strong> par an sur deux ans. Le 24 mois direct à ' + P(best24.r) + ' la bat de <strong>' + BP((best24.r - chain) * 100) + ' par an</strong> : l\'anomalie survit au test le plus exigeant.';
          }
          html += '<br><br><strong>À vérifier avant d\'allonger :</strong> que le taux affiché ne soit pas <em>progressif</em> (le facial serait la dernière marche) ; les conditions et pénalités de sortie anticipée ; le plafond FGDR de 100 k€ par déposant et par banque — une offre isolée peut rémunérer un risque de crédit ; et ton besoin réel de liquidité sur l\'horizon, seul argument qui devrait trancher.';
          html += '</div>';
        }
      }
      html += '</div></div>';
    })();

    // ═══ LANCER UN STRUCTURÉ MAINTENANT OU ATTENDRE ? ═══
    // Symétrique du bloc CAT, mais l'économie est différente : un CAT se nourrit du segment
    // 3-12 mois, un structuré du LONG (5-10 ans), parce que c'est le taux long qui finance
    // le budget option. La question « attendre ? » se tranche donc sur le forward du long,
    // pas sur celui du court — et la volatilité, elle, est le seul vrai levier de timing.
    (function () {
      var P = function (x) { return x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' %'; };
      var PT = function (x) { return (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' pt'; };
      var scv = (_data.swapCurve && _data.swapCurve.swap_eur) || {};
      if (!scv['10y'] || !scv['1y']) return;
      var t10 = (yields.tec10_fr && yields.tec10_fr.current != null) ? parseFloat(yields.tec10_fr.current) : null;

      var z = function (t) {
        var k = t + 'y';
        if (scv[k] != null) return parseFloat(scv[k]);
        var ks = Object.keys(scv).map(function (x) { return parseInt(x, 10); }).sort(function (a, b) { return a - b; });
        for (var i = 0; i < ks.length - 1; i++) {
          if (ks[i] < t && t < ks[i + 1]) {
            var a = parseFloat(scv[ks[i] + 'y']), b = parseFloat(scv[ks[i + 1] + 'y']);
            return a + (b - a) * (t - ks[i]) / (ks[i + 1] - ks[i]);
          }
        }
        return null;
      };
      // Taux à `len` ans, tel que le marché le price dans `start` ans.
      var fwd = function (start, len) {
        var a = z(start + len), b = z(start);
        if (a == null || b == null) return null;
        return (Math.pow(Math.pow(1 + a / 100, start + len) / Math.pow(1 + b / 100, start), 1 / len) - 1) * 100;
      };
      // Le budget option : ce qui reste à dépenser en coupons quand le capital est garanti.
      var budget = function (r, T) { return (1 - 1 / Math.pow(1 + r / 100, T)) * 100; };

      var rows = [5, 10].map(function (T) {
        var s = z(T), f = fwd(1, T);
        if (s == null || f == null) return null;
        return { T: T, spot: s, f1: f, bNow: budget(s, T), bF1: budget(f, T) };
      }).filter(Boolean);
      if (!rows.length) return;
      var r10 = rows[rows.length - 1];

      var vix = null;
      try { vix = parseFloat((md || {}).vix) || null; } catch (e) {}
      var vixTrend = (md || {}).vix_trend || '';

      html += '<div style="margin:22px 0 16px">';
      html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:3px">🏗️ Lancer un structuré maintenant ou attendre ?</div>';
      html += '<div style="font-size:11px;color:' + BG.textDim + ';margin-bottom:12px">Un CAT se nourrit du segment 3-12 mois ; un structuré, du <strong>long terme</strong> — c\'est le taux à 5 ou 10 ans qui finance les coupons. La question se tranche donc sur une autre partie de la courbe, et la réponse n\'est pas la même.</div>';

      // ── Le budget option, aujourd'hui vs dans un an
      html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:13px 15px;margin-bottom:11px">';
      html += '<div style="font-size:11.5px;font-weight:700;color:' + BG.text + ';margin-bottom:4px">Le budget option — ce qui finance tout produit à capital garanti</div>';
      html += '<div style="font-size:10.5px;color:' + BG.textMuted + ';margin-bottom:10px">Capital garanti = l\'émetteur met de côté de quoi te rendre 100 % à l\'échéance et ne dispose que du reste pour acheter les options qui paient tes coupons. Ce « reste » dépend directement du taux long.</div>';
      html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<thead><tr style="background:' + BG.header + '">' +
        ['Durée', 'Taux long aujourd\'hui', 'Tel que pricé dans 1 an', 'Budget aujourd\'hui', 'Budget dans 1 an', 'Gain à attendre'].map(function (h, i) {
          return '<th style="padding:6px 9px;text-align:' + (i ? 'right' : 'left') + ';font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:' + BG.textDim + ';white-space:nowrap">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (r, i) {
        var gain = r.bF1 - r.bNow;
        html += '<tr style="background:' + (i % 2 ? BG.row1 : BG.row0) + ';border-bottom:1px solid ' + BG.border + '">';
        html += '<td style="padding:5px 9px;color:' + BG.text + ';white-space:nowrap">' + r.T + ' ans</td>';
        ['spot', 'f1'].forEach(function (k) {
          html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:' + (k === 'spot' ? BG.text : BG.textMuted) + '">' + P(r[k]) + '</td>';
        });
        html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-weight:700;color:' + BG.text + '">' + r.bNow.toFixed(1).replace('.', ',') + ' %</td>';
        html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:' + BG.textMuted + '">' + r.bF1.toFixed(1).replace('.', ',') + ' %</td>';
        html += '<td style="padding:5px 9px;text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-weight:700;color:' + (gain >= 1 ? '#047857' : '#B45309') + ';white-space:nowrap">' + PT(gain) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';

      // ── Le même arbitrage, en euros
      // Attendre ne laisse pas l'argent oisif : il reste placé en CAT. Le coût de l'attente
      // n'est donc PAS une année au taux long, mais l'écart entre ce que rapporterait le
      // structuré et ce que rapporte le CAT pendant cette année. Mesurer autrement
      // surévaluait le coût d'un facteur ~3.
      var N = 100000, gain10 = (r10.bF1 - r10.bNow);
      var catAlt = null;
      try {
        var _cut = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
        var _cr = ((_data.catRates && _data.catRates.rates) || []).filter(function (o) {
          return parseInt(o.durationMonths, 10) === 12 && o.rateType !== 'progressif'
            && !isNaN(parseFloat(o.rate)) && (o.date || '') >= _cut;
        });
        if (_cr.length) catAlt = Math.max.apply(null, _cr.map(function (o) { return parseFloat(o.rate); }));
      } catch (e) {}
      var hyp = (catAlt != null) ? catAlt + 1.37 : r10.spot;   // structuré supposé battre le CAT de 137 bp
      var coutAnnee = (catAlt != null) ? (hyp - catAlt) : r10.spot;
      html += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">';
      [['Gain à attendre 1 an', _fmt(Math.round(N * gain10 / 100)) + ' €', PT(gain10) + ' de budget', '#B45309'],
       ['Coût de l\'année perdue', _fmt(Math.round(N * coutAnnee / 100)) + ' €', (catAlt != null ? 'écart au CAT ' + P(catAlt) + ', pas au taux long' : 'une année au taux long'), '#B91C1C']
      ].forEach(function (c) {
        html += '<div style="flex:1;min-width:170px;padding:10px 12px;background:' + BG.row1 + ';border:1px solid ' + BG.border + ';border-top:3px solid ' + c[3] + ';border-radius:6px">';
        html += '<div style="font-size:9.5px;color:' + BG.textMuted + '">' + c[0] + '</div>';
        html += '<div style="font-family:var(--mono,ui-monospace,monospace);font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;color:' + c[3] + '">' + c[1] + '</div>';
        html += '<div style="font-size:9.5px;color:' + BG.textMuted + '">' + c[2] + '</div></div>';
      });
      html += '</div>';
      html += '<div style="margin-top:9px;font-size:11.5px;line-height:1.65;color:' + BG.textDim + '"><strong style="color:' + BG.text + '">Verdict.</strong> Le marché price le taux à ' + r10.T + ' ans quasiment inchangé dans un an (' + P(r10.spot) + ' → ' + P(r10.f1) + ') : attendre n\'élargirait le budget option que de <strong>' + PT(gain10) + '</strong>, soit ' + _fmt(Math.round(N * gain10 / 100)) + ' € sur ' + _fmt(N) + ' €. ';
      if (catAlt != null) {
        html += 'En face, l\'attente ne coûte pas une année de taux long — ton argent reste placé en CAT à ' + P(catAlt) + '. Elle coûte <strong>l\'écart entre le structuré et ce CAT</strong> : ' + _fmt(Math.round(N * coutAnnee / 100)) + ' € pour un produit qui rendrait ' + P(hyp) + '. <strong>Attendre est alors perdant d\'environ ' + (coutAnnee / (gain10 || 0.01)).toFixed(1).replace('.', ',') + ' fois</strong>. Attention : ce ' + P(hyp) + ' est le <strong>plafond</strong> — un émetteur ne peut pas verser plus que son propre coût de financement, frais et option de rappel déduits. C\'est donc un majorant, atteint seulement par un produit parfaitement pricé et sans frais ; le facteur 2,7 est un « au mieux », pas un résultat général.</div>';
        html += '<div style="margin-top:8px;padding:9px 11px;background:' + BG.row1 + ';border-radius:6px;font-size:11px;line-height:1.6;color:' + BG.textDim + '"><strong style="color:' + BG.text + '">Le piège à éviter.</strong> Si l\'espérance du produit est <em>inférieure</em> à ' + P(catAlt) + ', le calcul n\'a plus de sens : la bonne réponse n\'est pas « attendre un an », c\'est <strong>ne pas l\'acheter du tout</strong>. Attendre suppose qu\'on achètera plus tard — à un prix que le forward annonce identique.</div>';
      } else {
        html += '<strong>Sur les taux, il n\'y a aucune raison d\'attendre.</strong></div>';
      }
      html += '</div>';

      // ── Le vrai levier de timing : la volatilité
      if (vix != null) {
        var vTone = vix >= 26 ? '#047857' : vix >= 20 ? '#B45309' : '#B91C1C';
        var vSay = vix >= 26 ? 'Volatilité élevée : les coupons actions sont <strong>chers à vendre</strong>, donc généreux. C\'est le moment où un Phoenix ou un autocall se négocie bien.'
                 : vix >= 20 ? 'Volatilité moyenne : coupons actions corrects, sans fenêtre exceptionnelle. Rien qui justifie de se presser ni d\'attendre.'
                 : 'Volatilité basse : les coupons actions sont <strong>pauvres</strong>. Sur un produit indexé actions, c\'est la seule vraie raison de patienter — mais on attend une secousse, pas une date.';
        html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-left:5px solid ' + vTone + ';border-radius:8px;padding:12px 14px;margin-bottom:11px">';
        html += '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:7px">';
        html += '<span style="font-size:12.5px;font-weight:700;color:' + BG.text + '">⚡ Le seul vrai levier de timing : la volatilité</span>';
        html += '<span style="font-family:var(--mono,ui-monospace,monospace);font-size:15px;font-weight:700;color:' + vTone + '">VIX ' + vix.toFixed(0) + '</span>';
        if (vixTrend) html += '<span style="font-size:10px;color:' + BG.textMuted + '">' + vixTrend + '</span></div>';
        html += '<div style="font-size:11.5px;line-height:1.65;color:' + BG.textDim + '">Un coupon de structuré a <strong>deux carburants</strong> : les taux (le budget option) et la volatilité (le prix auquel tu vends l\'option). Les taux sont stables et prévus stables — ils ne donnent aucun signal de timing. La volatilité, elle, bouge vite et ne se prévoit pas. ' + vSay + ' <strong>Sur un produit de taux pur, la volatilité actions ne joue pas — mais la <em>volatilité de taux</em>, si.</strong> Un callable, c\'est toi qui vends à l\'émetteur une option de remboursement anticipé ; un TARN et un range accrual vendent eux aussi de l\'optionalité sur les taux. Plus cette volatilité est chère, plus le coupon offert doit être élevé. Dans un régime où la trajectoire BCE est incertaine, <strong>c\'est un levier de timing réel — et nous ne le mesurons pas</strong> : il faudrait les volatilités de swaptions, que nous n\'avons pas.</div>';
        html += '</div>';
      }

      // ── La prime française : un budget élargi, à condition qu'il te soit reversé
      if (t10 != null && scv['10y'] != null) {
        var sw10 = parseFloat(scv['10y']), prime = (t10 - sw10) * 100;
        var bSwap = budget(sw10, 10), bFr = budget(t10, 10);
        if (prime >= 30) {
          html += '<div style="background:#ECFDF5;border:1px solid #059669;border-left:5px solid #059669;border-radius:8px;padding:12px 14px;font-size:11.5px;line-height:1.65;color:#064E3B">';
          html += '<strong>🇫🇷 La prime française élargit le budget — vérifie qu\'elle te revient.</strong> Un émetteur français se finance aujourd\'hui autour de ' + P(t10) + ' à 10 ans, contre ' + P(sw10) + ' pour la courbe swap : <strong>' + Math.round(prime) + ' bp de plus</strong>. Mécaniquement, son budget option à 10 ans passe de <strong>' + bSwap.toFixed(1).replace('.', ',') + ' %</strong> à <strong>' + bFr.toFixed(1).replace('.', ',') + ' %</strong> du nominal — près de ' + Math.round(bFr - bSwap) + ' points de plus à dépenser en coupons. ';
          html += 'C\'est une fenêtre réellement favorable pour émettre <em>maintenant</em>. Mais elle ne vaut que si l\'émetteur te la reverse : <strong>un produit qui paie moins que l\'OAT de même durée garde cette prime pour lui</strong>, et tu portes le risque bancaire en prime. C\'est le test à appliquer à chaque proposition.';
          html += '</div>';
        }
      }
      html += '</div>';
    })();

    // ═══ SECTION 1: TAUX SOUVERAINS (cliquables) ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:4px">🏛️ Taux souverains — France (séries TEC, Banque de France)</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + ';margin-bottom:10px">Cliquez sur un taux pour voir l\'analyse détaillée et l\'historique</div>';

    // Clickable rate cards
    var eur12m = yields.euribor_12m || {};

    var rateCards = [
      { id: tec10Real ? 'tec10_fr' : 'oat_fr_10y', label: tec10Real ? 'TEC10 (Banque de France)' : 'OAT 10 ans (proxy AAA)', data: tec10, color: '#0891B2',
        desc: tec10Real ? 'Taux d\'État français 10 ans (Banque de France). Référence pour les TARN et produits structurés taux longs.' : '⚠ TEC10 réel indisponible — proxy rendement souverain AAA zone euro (écart possible ~70 bp vs TEC10 BdF).',
        sub: 'Vol ' + (tec10.vol_annualized_bps || 18) + 'bp · ' + (tec10.direction || 'stable') + ' · Range ' + (tec10.low_1y || '?') + '-' + (tec10.high_1y || '?') },
      { id: yields.tec5_fr ? 'tec5_fr' : 'oat_fr_5y', label: yields.tec5_fr ? 'TEC 5 (OAT 5 ans)' : 'Zone euro AAA 5 ans', data: oat5y, color: '#2563EB',
        desc: 'Taux souverain à 5 ans. Sert au calcul du budget option des produits structurés 5 ans.',
        sub: 'Vol ' + (oat5y.vol_annualized_bps || 22) + 'bp · ' + (oat5y.direction || 'stable') + ' · Spread 5-10Y +' + Math.round(((tec10.current||3.10) - (oat5y.current||2.70)) * 100) + 'bp' },
      { id: yields.tec2_fr ? 'tec2_fr' : 'oat_fr_2y', label: yields.tec2_fr ? 'TEC 2 (OAT 2 ans)' : 'Zone euro AAA 2 ans', data: oat2y, color: '#7C3AED',
        desc: 'Taux souverain à 2 ans. Reflète les anticipations de politique monétaire BCE à court terme.',
        sub: 'Vol ' + (oat2y.vol_annualized_bps || 26) + 'bp · ' + (oat2y.direction || 'stable') + ' · Spread 2-10Y +' + Math.round(((tec10.current||3.10) - (oat2y.current||2.53)) * 100) + 'bp' },
      { id: 'euribor_3m', label: 'Euribor 3M', data: eur3m, color: '#D97706',
        desc: 'Taux interbancaire euro à 3 mois. Piloté par la BCE. Référence pour les Range Accrual.',
        sub: 'Réf Range Accrual · piloté par BCE' },
      { id: 'euribor_12m', label: 'Euribor 12M', data: eur12m, color: '#EA580C',
        desc: 'Taux interbancaire euro à 12 mois. Reflète les anticipations de taux BCE à 1 an. Utilisé pour les prêts immobiliers et certains structurés.',
        sub: 'Anticipe la politique BCE à 1 an' }
    ];

    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:8px">';
    rateCards.forEach(function(rc) {
      var val = rc.data.current || 0;
      html += '<div onclick="_mktOpenRate(\'' + rc.id + '\')" style="padding:14px;border:1px solid ' + BG.border + ';border-radius:8px;border-left:4px solid ' + rc.color + ';background:' + BG.section + ';cursor:pointer;transition:all 0.2s" onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.1)\'" onmouseout="this.style.boxShadow=\'none\'">';
      html += '<div style="font-size:11px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.8px;text-transform:uppercase">' + rc.label + ' <span style="color:' + rc.color + '">▼ clic</span></div>';
      html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + rc.color + ';margin:4px 0">' + val.toFixed(2) + '%</div>';
      if (rc.desc) html += '<div style="font-size:11px;color:' + BG.text + ';line-height:1.3;margin-bottom:3px">' + rc.desc + '</div>';
      html += '<div style="font-size:11px;color:' + BG.textDim + ';line-height:1.3">' + rc.sub + '</div>';
      html += '</div>';
    });
    html += '</div>';

    // Rate detail panel (hidden by default)
    html += '<div id="mkt-rate-detail" style="margin-bottom:20px"></div>';

    // Courbe shape card
    html += '<div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:20px">';
    html += '<div style="padding:10px 14px;border:1px solid ' + BG.border + ';border-radius:8px;background:' + BG.section + ';display:flex;justify-content:space-between;align-items:center">';
    html += '<div><span style="font-size:12px;font-weight:700;color:' + BG.text + '">Courbe des taux : </span>';
    html += '<span style="font-family:var(--mono);font-size:14px;font-weight:800;color:' + (curve.shape === 'normal' ? '#059669' : '#DC2626') + '">' + (curve.shape === 'normal' ? 'Normale ↗' : 'Inversée ↘') + '</span></div>';
    html += '<div style="font-size:10px;color:' + BG.textDim + '">Spread 2s10s France : +' + ((oat2y.current && tec10.current) ? Math.round((tec10.current - oat2y.current) * 100) : Math.round((curve.spread_2_10 || 0.57) * 100)) + 'bp · zone euro AAA +' + Math.round((curve.spread_2_10 || 0) * 100) + 'bp · ' + (curve.shape === 'normal' ? 'Favorable aux structurés' : 'Défavorable') + '</div>';
    html += '</div></div>';

    // ═══ REPÈRE TRÉSORERIE : le meilleur CAT (sans risque) — le taux à battre ═══
    (function() {
      var cat = _bestCAT();
      if (!cat.rate) return;
      var tecv = tec10.current || 0;
      var vsTec = tecv ? (cat.rate - tecv) : null;
      var detail = [];
      if (cat.bank) detail.push(cat.bank);
      if (cat.dur) detail.push(cat.dur % 12 === 0 ? (cat.dur / 12) + ' ans' : cat.dur + ' mois');
      var catStr = cat.rate.toFixed(2).replace('.', ',');
      html += '<div style="background:#ECFDF5;border:1px solid #05966955;border-left:5px solid #059669;border-radius:10px;padding:13px 16px;margin-bottom:20px">';
      html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
      html += '<span style="font-size:18px">🎯</span>';
      html += '<div><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#047857">Repère trésorerie — taux sans risque à battre</div>';
      html += '<div style="font-size:13px;color:#0F172A;margin-top:2px">Meilleur CAT : <strong style="font-family:var(--mono);font-size:16px;color:#059669">' + catStr + '%</strong>' + (detail.length ? ' <span style="color:#64748B;font-size:11px">(' + detail.join(' · ') + ')</span>' : '') + ' · garanti FGDR ≤ 100k€/banque</div></div>';
      if (vsTec !== null) {
        html += '<span style="margin-left:auto;font-size:11px;background:#FFFFFF;border:1px solid #05966933;border-radius:14px;padding:4px 11px;color:#334155">CAT vs TEC10 ' + tecv.toFixed(2) + '% : <strong style="color:' + (vsTec >= 0 ? '#059669' : '#DC2626') + '">' + (vsTec >= 0 ? '+' : '') + Math.round(vsTec * 100) + ' pb</strong></span>';
      }
      html += '</div>';
      html += '<div style="margin-top:8px;font-size:11px;color:#475569">Tout structuré doit offrir une <strong>prime suffisante au-dessus de ' + catStr + '%</strong> pour rémunérer son risque en capital et son illiquidité. En-dessous, le CAT gagne.</div>';
      html += '</div>';
    })();

    // ═══ SECTION 2: TAUX DIRECTEURS + MONÉTAIRE ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:12px">🏦 Taux directeurs BCE & marché monétaire</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">';
    html += _renderKPI('BCE Dépôt', (bce.current || 2.00).toFixed(2) + '%', '#059669', 'Taux plancher du marché monétaire');
    html += _renderKPI('BCE Main Refi', (bceMain.current || 2.15).toFixed(2) + '%', '#059669', 'Taux directeur principal');
    html += _renderKPI('Euribor 3M', (eur3m.current || 2.50).toFixed(2) + '%', '#D97706', 'Réf. Range Accrual · Date : ' + (eur3m.date || '—'));
    html += _renderKPI('Euribor 6M', (eur6m.current || 2.80).toFixed(2) + '%', '#D97706', 'Taux interbancaire 6 mois');
    html += '</div>';

    // ═══ SECTION 3: COURBE DES TAUX VISUELLE ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:16px;margin-bottom:20px">';
    html += '<div style="font-size:13px;font-weight:700;color:' + BG.text + ';margin-bottom:12px">Courbe des taux EUR — Impact sur le budget option structuré</div>';
    html += '<div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-bottom:8px">';
    var barData = [
      ['BCE\ndépôt', bce.current || 2.00, '#059669'],
      ['Euribor\n3M', eur3m.current || 2.50, '#D97706'],
      ['OAT\n2 ans', oat2y.current || 2.53, '#7C3AED'],
      ['OAT\n5 ans', oat5y.current || 2.70, '#2563EB'],
      ['Emprunt\nSG', 3.10, '#DC2626'],
      ['TEC10\n10 ans', tec10.current || 3.10, '#0891B2']
    ];
    barData.forEach(function(b) {
      var h = Math.round((b[1] / 4.0) * 100);
      html += '<div style="flex:1;text-align:center">';
      html += '<div style="background:' + b[2] + ';height:' + h + 'px;border-radius:6px 6px 0 0;margin:0 3px;display:flex;align-items:flex-start;justify-content:center;padding-top:6px;min-height:30px">';
      html += '<span style="font-family:var(--mono);font-size:13px;font-weight:800;color:#fff">' + b[1].toFixed(2) + '%</span></div>';
      html += '<div style="font-size:11px;color:' + BG.textMuted + ';margin-top:4px;white-space:pre-line;line-height:1.2">' + b[0] + '</div></div>';
    });
    html += '</div>';
    // Budget explanation
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">';
    var budget5y = Math.round((1 - 1 / Math.pow(1 + (oat5y.current || 2.70) / 100, 5)) * 10000) / 100;
    var budget10y = Math.round((1 - 1 / Math.pow(1 + (tec10.current || 3.10) / 100, 10)) * 10000) / 100;
    html += '<div style="padding:8px 12px;background:#E0F7FA;border-radius:6px;font-size:11px;color:#0891B2">';
    html += '<strong>Budget option 5 ans</strong> = ' + budget5y.toFixed(1) + '% du nominal<br>';
    html += 'Sur 500K€ = <strong>' + _fmt(Math.round(500000 * budget5y / 100)) + '€</strong> pour financer les coupons</div>';
    html += '<div style="padding:8px 12px;background:#DBEAFE;border-radius:6px;font-size:11px;color:#1E40AF">';
    html += '<strong>Budget option 10 ans</strong> = ' + budget10y.toFixed(1) + '% du nominal<br>';
    html += 'Sur 500K€ = <strong>' + _fmt(Math.round(500000 * budget10y / 100)) + '€</strong> pour financer les coupons</div>';
    html += '</div></div>';

    // ═══ SECTION 4: JAUGES PRODUITS (collapsible, connectées au portfolio) ═══
    var tec10Val = tec10.current || 3.10;
    var eur3mVal = eur3m.current || 2.50;

    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-gauges-body\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶ Afficher\':\'▼ Masquer\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#2563EB">🎯 Jauges produits — Position vs triggers du portefeuille</div>';
    html += '<span style="font-size:10px;color:#64748B">▼ Masquer</span></div>';
    html += '<div id="mkt-gauges-body" style="display:block;padding:0 16px 16px">';

    // Helper: render a gauge bar
    function _gauge(label, currentVal, min, max, zones, unit) {
      unit = unit || '%';
      var totalRange = max - min;
      var currentPct = Math.max(0, Math.min(100, ((currentVal - min) / totalRange) * 100));
      var g = '<div style="margin-bottom:16px">';
      g += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      g += '<div style="font-size:12px;font-weight:700;color:' + BG.text + '">' + label + '</div>';
      g += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:#2563EB">Actuel : ' + currentVal.toFixed(2) + unit + '</div>';
      g += '</div>';
      // Gauge bar
      g += '<div style="position:relative;height:32px;background:' + BG.input + ';border-radius:6px;overflow:hidden;border:1px solid ' + BG.border + '">';
      // Render zones
      zones.forEach(function(z) {
        var leftPct = Math.max(0, ((z.from - min) / totalRange) * 100);
        var widthPct = Math.min(100 - leftPct, ((z.to - z.from) / totalRange) * 100);
        g += '<div style="position:absolute;left:' + leftPct + '%;width:' + widthPct + '%;height:100%;background:' + z.color + ';opacity:0.25" title="' + z.label + '"></div>';
        // Zone label
        g += '<div style="position:absolute;left:' + leftPct + '%;width:' + widthPct + '%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:' + z.color + ';pointer-events:none">' + z.label + '</div>';
      });
      // Current position marker
      g += '<div style="position:absolute;left:' + currentPct + '%;top:0;width:3px;height:100%;background:#2563EB;border-radius:2px;z-index:2"></div>';
      g += '<div style="position:absolute;left:' + Math.max(0, currentPct - 3) + '%;top:-2px;z-index:3">';
      g += '<div style="background:#2563EB;color:#fff;padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:11px;font-weight:700">' + currentVal.toFixed(2) + '</div></div>';
      g += '</div>';
      // Scale labels
      g += '<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:11px;color:' + BG.textDim + '">';
      g += '<span>' + min.toFixed(1) + unit + '</span>';
      zones.forEach(function(z) {
        if (z.from > min && z.from < max) g += '<span style="color:' + z.color + '">│ ' + z.from.toFixed(2) + '</span>';
      });
      g += '<span>' + max.toFixed(1) + unit + '</span>';
      g += '</div>';
      // Distance info
      zones.forEach(function(z) {
        if (z.trigger !== undefined) {
          var dist = z.trigger - currentVal;
          var distBp = Math.round(Math.abs(dist) * 100);
          var safe = z.direction === 'below' ? (currentVal < z.trigger) : (currentVal > z.trigger);
          g += '<div style="display:inline-block;margin-right:12px;margin-top:4px;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;' +
            'background:' + (safe ? '#ECFDF5' : '#FEF2F2') + ';color:' + (safe ? '#059669' : '#DC2626') + '">';
          g += (safe ? '✅' : '⚠️') + ' ' + z.triggerLabel + ' : ' + (safe ? distBp + 'bp de marge' : 'DÉPASSÉ de ' + distBp + 'bp') + '</div>';
        }
      });
      g += '</div>';
      return g;
    }

    // ── Jauges pilotées par le PORTEFEUILLE RÉEL ──────────────────────────────────────
    var _pf = (window.app && app.state && app.state.portfolio) ? app.state.portfolio : [];
    function _rateRef(p) {
      var t = ((p.name || '') + ' ' + (((p.coupon || {}).triggerDetail) || '')).toLowerCase();
      if (/euribor/.test(t)) return { val: eur3mVal, label: 'Euribor 3M' };
      // CMS = taux de SWAP à maturité constante. Ce n'est PAS un rendement d'État :
      // avec la prime de risque France, l'OAT se traite au-dessus du swap. Substituer le TEC
      // fausserait la lecture de la barrière (« coupon perdu » à tort). Sans donnée CMS saisie
      // dans data/market/swaps-manual.json, on refuse de jauger plutôt que de jauger faux.
      if (/cms/.test(t)) {
        var _k = /cms\s*2/.test(t) ? '2y' : '10y';
        var _man = (_data.swaps && _data.swaps.cms) || {};
        var _crv = (_data.swapCurve && _data.swapCurve.swap_eur) || {};
        var _m = (_man[_k] != null) ? _man[_k] : _crv[_k];
        if (_m == null) return { val: null, label: 'CMS', missing: true };
        return { val: parseFloat(_m), label: 'CMS ' + (_k === '2y' ? '2 ans' : '10 ans') };
      }
      if (/oat 5|5 ans/.test(t)) return { val: (oat5y.current || 2.70), label: 'TEC 5 (OAT 5 ans)' };
      return { val: tec10Val, label: 'TEC10' };
    }
    var _gHtml = '', _shown = 0, _noLevel = 0;
    _pf.forEach(function(p) {
      var name = (p.name || 'Produit structuré').slice(0, 50);
      var coupTxt = (p.coupon && p.coupon.rate) ? ' — coupon ' + p.coupon.rate + '%' : '';
      // Produit de TAUX : coupon si taux ≤ trigger
      if ((/rate|taux/i.test(p.underlyingType || '')) && p.coupon && p.coupon.trigger) {
        var ref = _rateRef(p);
        var trig = parseFloat(p.coupon.trigger);
        if (ref.missing || ref.val == null) {
          _gHtml += '<div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:8px;padding:11px 14px;margin-bottom:10px;font-size:11.5px;line-height:1.55;color:#78350F">' +
            '<strong>📌 ' + name + coupTxt + ' si ' + ref.label + ' ≤ ' + trig + '%</strong><br>' +
            '⚠ <strong>Donnée ' + ref.label + ' absente</strong> — aucune source gratuite ne publie la courbe swap. Ce produit ne peut pas être jaugé tant que le CMS n\'est pas saisi dans <code style="font-size:10px">data/market/swaps-manual.json</code>. Ne pas le lire au TEC : le CMS est un taux de swap, pas un rendement d\'État.' +
            '</div>';
          _shown++; return;
        }
        var maxR = Math.max(5.5, trig + 1, ref.val + 1);
        _gHtml += _gauge('📌 ' + name + coupTxt + ' si ' + ref.label + ' ≤ ' + trig + '%', ref.val, 0, maxR, [
          { from: 0, to: trig * 0.85, color: '#059669', label: 'CONFORT' },
          { from: trig * 0.85, to: trig, color: '#D97706', label: 'OK' },
          { from: trig, to: maxR, color: '#DC2626', label: 'HORS COUPON', trigger: trig, direction: 'below', triggerLabel: 'Trigger ' + trig + '%' }
        ]);
        _shown++; return;
      }
      // Produit EQUITY : barrière capital (+ barrière coupon)
      var bar = parseFloat(p.capitalProtection && p.capitalProtection.barrier);
      if (!isNaN(bar) && bar > 0) {
        var cBar = parseFloat(p.capitalProtection && p.capitalProtection.barrierCoupon);
        var coupTrig = (!isNaN(cBar) && cBar > 0) ? cBar : bar;
        var lvl = parseFloat(p.tracking && p.tracking.level);
        var hasLvl = !isNaN(lvl); if (!hasLvl) { lvl = 100; _noLevel++; }
        var lo = Math.min(40, bar - 10);
        var zones = [{ from: lo, to: bar, color: '#DC2626', label: 'PERTE CAPITAL', trigger: bar, direction: 'above', triggerLabel: 'Barrière ' + bar + '%' }];
        if (coupTrig > bar) zones.push({ from: bar, to: coupTrig, color: '#F59E0B', label: 'PAS DE COUPON' });
        zones.push({ from: coupTrig, to: 100, color: '#059669', label: 'COUPON', trigger: coupTrig, direction: 'above', triggerLabel: 'Coupon ≥ ' + coupTrig + '%' });
        zones.push({ from: 100, to: 120, color: '#0891B2', label: 'AUTOCALL' });
        _gHtml += _gauge('📌 ' + name + coupTxt + (hasLvl ? '' : ' — ⚠ niveau non saisi'), lvl, lo, 120, zones, '%');
        _shown++; return;
      }
    });
    if (_shown === 0) {
      _gHtml = '<div style="padding:20px;text-align:center;color:#64748B;font-size:12px">Aucun produit avec trigger exploitable.<br>Renseigne la barrière (equity) ou le seuil de coupon (taux) via l\'édition produit.</div>';
    }
    html += '<div style="font-size:10px;color:#64748B;margin-bottom:10px">' + _shown + ' produit(s) de votre portefeuille · position actuelle vs triggers' + (_noLevel > 0 ? ' · ⚠ ' + _noLevel + ' sans niveau saisi (affiché à 100%)' : '') + '</div>';
    html += _gHtml;
    html += '</div></div>';

    // ═══ SECTION 4b: PRODUITS TAUX BROCHURE (scan auto) ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-brochure-body\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶ Afficher\':\'▼ Masquer\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#7C3AED">📄 Produits taux en brochure — détection auto des seuils</div>';
    html += '<span style="font-size:10px;color:#64748B">▶ Afficher</span></div>';
    html += '<div id="mkt-brochure-body" style="display:none;padding:0 16px 16px">';
    html += '<div id="mkt-brochure-content" style="text-align:center;padding:12px;color:#475569;font-size:11px">Chargement des brochures...</div>';
    html += '</div></div>';

    // ═══ SECTION 5: MACRO & RÉGIME ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:12px">🌍 Contexte macro & régime de marché</div>';
    var regime = ai.regime || 'unknown';
    var regimeColor = regime === 'stagflation' ? '#DC2626' : regime === 'growth' ? '#059669' : '#D97706';
    // 4 signaux clés pour la décision structurée (toujours visibles)
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">';
    html += _renderKPI('Régime', (regime.charAt(0).toUpperCase() + regime.slice(1)), regimeColor, 'Confiance ' + (ai.regime_confidence || '?') + '/5');
    html += _renderKPI('HY Spread', (md.hy_spread_bps || 0) + 'bp', md.hy_spread_bps > 400 ? '#DC2626' : '#059669', 'Crédit HY · ' + (md.hy_spread_trend || '?'));
    html += _renderKPI('VIX', (md.vix || 0).toFixed(1), md.vix > 25 ? '#DC2626' : '#059669', 'Budget option · ' + (md.vix_trend || '?'));
    html += _renderKPI('CPI (YoY)', (md.cpi_yoy_pct || 0).toFixed(1) + '%', md.cpi_yoy_pct > 2.5 ? '#DC2626' : '#059669', 'Inflation → direction taux');
    html += '</div>';

    // Détail macro (8 indicateurs) — repliable
    html += '<div onclick="var c=document.getElementById(\'mkt-macro-detail\');var o=c.style.display===\'none\';c.style.display=o?\'\':\'none\';this.querySelector(\'span\').textContent=o?\'▼\':\'▶\'" style="cursor:pointer;font-size:11px;font-weight:600;color:#64748B;margin-bottom:8px;user-select:none"><span>▶</span> Détail macro — Brent, Or, Fed, PCE, EUR/USD, IG, S&P, Breakeven</div>';
    html += '<div id="mkt-macro-detail" style="display:none">';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">';
    html += _renderKPI('Brent (USD)', '$' + (md.brent_usd || 0).toFixed(1), md.brent_usd > 100 ? '#DC2626' : '#059669', 'Moy 5j : $' + (md.brent_usd_avg5d || 0).toFixed(1));
    html += _renderKPI('Or (USD)', '$' + _fmt(md.gold_usd || 0), '#D97706', 'Drawdown ATH : -' + (md.gold_drawdown_from_ath_pct || 0).toFixed(1) + '%');
    html += _renderKPI('Fed Funds', (md.fed_funds_rate || 0).toFixed(2) + '%', '#7C3AED', 'Delta 6M : ' + (md.fed_funds_rate_delta_6m || 0) + '%');
    html += _renderKPI('PCE (YoY)', (md.pce_yoy_pct || 0).toFixed(1) + '%', md.pce_yoy_pct > 2.5 ? '#DC2626' : '#059669', 'Target BCE : 2.0%');
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">';
    html += _renderKPI('EUR/USD', (md.eurusd || 0).toFixed(4), '#2563EB', 'USD Index : ' + (md.trade_weighted_usd || 0).toFixed(1));
    html += _renderKPI('IG Spread', (md.ig_spread_bps || 0) + 'bp', '#2563EB', 'Investment Grade crédit');
    html += _renderKPI('S&P 500', _fmt(md.sp500_level || 0), md.sp500_change_1d_pct > 0 ? '#059669' : '#DC2626', (md.sp500_change_1d_pct > 0 ? '+' : '') + (md.sp500_change_1d_pct || 0).toFixed(2) + '% 1j');
    html += _renderKPI('Breakeven 5Y', (md.breakeven_5y || 0).toFixed(2) + '%', '#D97706', 'Anticipation inflation marché');
    html += '</div>';
    html += '</div>';

    // ═══ SECTION 6: ANALYSE IA DU RÉGIME ═══
    if (ai.regime_rationale) {
      html += '<div style="background:' + BG.section + ';border:1px solid ' + regimeColor + '44;border-radius:8px;padding:16px;margin-bottom:20px">';
      html += '<div style="font-size:13px;font-weight:700;color:' + regimeColor + ';margin-bottom:8px">🤖 Analyse IA — Régime ' + regime + '</div>';
      html += '<div style="font-size:12px;color:' + BG.text + ';line-height:1.6">' + ai.regime_rationale + '</div>';
      if (ai.adjustments && ai.adjustments.length > 0) {
        html += '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px">';
        ai.adjustments.forEach(function(adj) {
          var adjColor = (adj.params && adj.params.delta_pct > 0) ? '#059669' : '#DC2626';
          html += '<div style="padding:8px 10px;background:' + BG.row1 + ';border-radius:6px;border-left:3px solid ' + adjColor + ';font-size:10px">';
          html += '<strong style="color:' + adjColor + '">' + adj.action + '</strong>';
          html += '<div style="color:' + BG.textDim + ';margin-top:2px">Conviction ' + (adj.conviction || '?') + '/5 · ' + (adj.rationale || '').substring(0, 100) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }

    // ═══ SECTION 7: IMPACT CARRY TRADE ═══
    html += '<div style="background:#ECFDF5;border:2px solid #059669;border-radius:8px;padding:16px;margin-bottom:20px">';
    // ═══ SYNTHÈSE SWISS LIFE GESTION PRIVÉE (avril 2026) ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-swisslife\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶\':\'▼\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#1E40AF">📄 Synthèse Swiss Life Gestion Privée — Forces Spéciales Op. n°5 (Avril 2026)</div>';
    html += '<span style="font-size:10px;color:#64748B">▶</span></div>';
    html += '<div id="mkt-swisslife" style="display:none;padding:0 16px 16px">';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';

    // Vision macro
    html += '<div style="padding:12px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:6px">';
    html += '<div style="font-size:11px;font-weight:700;color:#DC2626;margin-bottom:6px">⚠️ Contexte macro — Choc géopolitique</div>';
    html += '<div style="font-size:11px;color:#1A202C;line-height:1.6">';
    html += '• Conflit Iran / Moyen-Orient → cessez-le-feu temporaire (15j)<br>';
    html += '• Hausse prix énergie → <strong>inflation au cœur des préoccupations</strong><br>';
    html += '• BCE + Fed : <strong>marges de manœuvre limitées</strong>, baisses de taux repoussées<br>';
    html += '• <strong>Remontée des taux longs</strong> depuis le début du conflit<br>';
    html += '• Détroit d\'Ormuz = canal de transmission clé aux marchés</div></div>';

    // Impact taux
    html += '<div style="padding:12px;background:#DBEAFE;border:1px solid #93C5FD;border-radius:6px">';
    html += '<div style="font-size:11px;font-weight:700;color:#1E40AF;margin-bottom:6px">📈 Impact sur les taux (carry trade)</div>';
    html += '<div style="font-size:11px;color:#1A202C;line-height:1.6">';
    html += '• Taux longs en <strong>hausse</strong> → budget option structurés <strong>en augmentation</strong> (favorable)<br>';
    html += '• BCE en pause → Euribor <strong>stable</strong> autour de 2% (favorable Range Accrual)<br>';
    html += '• Baisses de taux <strong>repoussées</strong> → les produits taux gardent leur attractivité<br>';
    html += '• Spreads crédit élargis → <strong>prudence sur le risque émetteur</strong><br>';
    html += '• Positionnement SLGP : <strong>attente de réexposition progressive sur taux longs</strong></div></div>';
    html += '</div>';

    // Stratégie SLGP
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">';

    html += '<div style="padding:10px;background:#ECFDF5;border-radius:6px;border-left:3px solid #059669">';
    html += '<div style="font-size:10px;font-weight:700;color:#059669">CE QU\'ILS PRIVILÉGIENT</div>';
    html += '<div style="font-size:10px;color:#1A202C;margin-top:4px;line-height:1.5">';
    html += '• Actifs "anti-fragiles" (mines d\'or)<br>• Crédit HY européen (spreads attractifs)<br>• Actions émergentes + défense EU</div></div>';

    html += '<div style="padding:10px;background:#FEF3C7;border-radius:6px;border-left:3px solid #D97706">';
    html += '<div style="font-size:10px;font-weight:700;color:#D97706">CE QU\'ILS SURVEILLENT</div>';
    html += '<div style="font-size:10px;color:#1A202C;margin-top:4px;line-height:1.5">';
    html += '• Durée du conflit Iran<br>• Prix pétrole → inflation<br>• Opportunités de réexposition taux</div></div>';

    html += '<div style="padding:10px;background:#FEF2F2;border-radius:6px;border-left:3px solid #DC2626">';
    html += '<div style="font-size:10px;font-weight:700;color:#DC2626">RISQUES IDENTIFIÉS</div>';
    html += '<div style="font-size:10px;color:#1A202C;margin-top:4px;line-height:1.5">';
    html += '• Pétrole comprime les marges<br>• Visibilité court terme réduite<br>• Valeurs refuges classiques moins fiables</div></div>';

    html += '</div>';

    html += '<div style="padding:8px 10px;background:#F1F3F7;border-radius:4px;font-size:10px;color:#64748B">';
    html += 'Source : Swiss Life Gestion Privée, Forces Spéciales Opération n°5, données au 13/04/2026. Performances Forces : -1.2% (F4) à -1.7% (F6) sur le trimestre, surperformant les catégories Morningstar de +0.2 à +0.8%.';
    html += '</div></div></div>';

    // ═══ GUIDE PRODUITS STRUCTURÉS ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-guide\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶\':\'▼\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#7C3AED">📚 Guide des produits structurés — Tous les types expliqués</div>';
    html += '<span style="font-size:10px;color:#64748B">▶</span></div>';
    html += '<div id="mkt-guide" style="display:none;padding:0 16px 16px">';

    function _guideCard(emoji, name, coupon, capital, mecanism, forWho, risk, riskColor) {
      return '<div style="padding:12px;border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:8px;border-left:4px solid ' + riskColor + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<div style="font-size:13px;font-weight:700;color:' + BG.text + '">' + emoji + ' ' + name + '</div>' +
        '<div style="display:flex;gap:6px">' +
        '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#ECFDF5;color:#059669">' + coupon + '</span>' +
        '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:' + (capital === 'Garanti' ? '#ECFDF5' : '#FEF2F2') + ';color:' + (capital === 'Garanti' ? '#059669' : '#DC2626') + '">Capital ' + capital + '</span>' +
        '</div></div>' +
        '<div style="font-size:11px;color:' + BG.text + ';line-height:1.6;margin-bottom:6px">' + mecanism + '</div>' +
        '<div style="display:flex;gap:12px;font-size:10px">' +
        '<span style="color:#2563EB"><strong>Pour :</strong> ' + forWho + '</span>' +
        '<span style="color:' + riskColor + '"><strong>Risque :</strong> ' + risk + '</span>' +
        '</div></div>';
    }

    // TAUX (carry trade)
    html += '<div style="font-size:12px;font-weight:700;color:#059669;margin:12px 0 8px;padding:6px 10px;background:#ECFDF5;border-radius:4px">🛡️ PRODUITS TAUX — Capital garanti (pour le carry trade)</div>';

    html += _guideCard('🎯', 'TARN (Target Accrual)', 'Coupon 6-7%', 'Garanti',
      'Coupon élevé conditionnel (ex: si TEC10 ≤ 4.60%). An 1-2 garantis. Autocall quand cumul coupons atteint la cible (~27%). Le produit s\'arrête, tu récupères le capital.',
      'Max rendement carry trade', 'Faible — 0% coupon si taux montent', '#D97706');

    html += _guideCard('🔒', 'Taux Fixe Callable', 'Coupon 4-4.5% garanti', 'Garanti',
      'Coupon fixe GARANTI chaque année. La banque peut rappeler (si taux baissent). NC3 = pas de rappel avant An 3. Tu vends une option de rappel → la banque te paye un surcoupon.',
      'Zéro risque, carry sûr', 'Zéro', '#059669');

    html += _guideCard('💰', 'Callable In Fine', 'Coupon 4.6-5% capitalisé', 'Garanti',
      'Aucun flux annuel. Tout capitalisé et versé d\'un coup au call/échéance. Ex CIC: 4.66%, si call An 5 → remboursement 123% du nominal. Surcoupon vs Callable classique car pas de gestion de flux.',
      'Investisseur patient, pas besoin de flux', 'Zéro', '#059669');

    html += _guideCard('📊', 'Range Accrual', 'Coupon 5-6.5% proportionnel', 'Garanti',
      'Coupon proportionnel au nombre de jours où le taux (TEC10 ou Euribor) reste dans un corridor [min — max]. Pas binaire : si le taux sort 30 jours → tu perds 30/365 du coupon, pas tout.',
      'Investisseur qui veut du progressif (pas binaire)', 'Faible — coupon réduit si hors corridor', '#D97706');

    html += _guideCard('📈', 'Step-Up Callable', 'Coupon 3.5→6% croissant', 'Garanti',
      'Coupon garanti qui AUGMENTE chaque année (ex: 3.50% → 4.00% → 4.50% → 5.00%). La banque rappelle quand ça coûte trop cher. Le spread vs emprunt s\'élargit avec le temps.',
      'Carry trade patient, coupon garanti croissant', 'Zéro', '#059669');

    html += _guideCard('🔄', 'Fixed-to-Floater', 'Coupon 4% fixe puis variable', 'Garanti',
      'Phase fixe (An 1-3) : coupon garanti ~4%. Phase variable (An 4+) : indexé Euribor + spread, avec floor et cap. S\'adapte au marché.',
      'Investisseur qui veut sécuriser le début', 'Faible — phase variable peut être basse', '#D97706');

    html += _guideCard('🛟', 'Floater avec Plancher', 'Coupon 3-4.5% variable', 'Garanti',
      'Coupon = max(plancher 3%, TEC10 - spread). Plancher 3% = pire cas −0,10pt/an vs emprunt 3,10%. Si taux montent → coupon monte. Si taux baissent → plancher limite la perte.',
      'Carry trade qui veut profiter de la hausse des taux', 'Très faible — plancher garanti', '#0891B2');

    html += _guideCard('🧠', 'Digital Mémoire Taux', 'Coupon 4.6-7% conditionnel', 'Garanti',
      'Coupon conditionnel (ex: si TEC10 ≤ 4.40%). Si condition non remplie → coupon stocké en mémoire et versé quand condition revient. Filet de sécurité vs TARN sans mémoire.',
      'Carry trade avec filet de sécurité', 'Faible — mémoire rattrape', '#0891B2');

    html += _guideCard('📐', 'CMS Steepener', 'Coupon = N × pente courbe', 'Garanti',
      'Coupon = multiplicateur × (taux 10Y - taux 2Y). Aujourd\'hui: 5 × 0.59% = 2.95%. Gagne si courbe pentue. Avec le spread actuel de 59bp, le coupon est modeste.',
      'Investisseur qui parie sur la pente de courbe', 'Modéré — 0% si courbe inversée', '#D97706');

    // ACTIONS
    html += '<div style="font-size:12px;font-weight:700;color:#DC2626;margin:16px 0 8px;padding:6px 10px;background:#FEF2F2;border-radius:4px">⚠️ PRODUITS ACTIONS — Risque en capital (PAS pour le carry trade)</div>';

    html += _guideCard('⚡', 'Autocall / Athena', 'Coupon 5-10% conditionnel', 'Risque',
      'Rappel automatique si action ≥ 100% du strike à une date d\'observation. Coupon × nb années écoulées. Si pas de rappel et action < barrière à échéance → PERTE EN CAPITAL. Version "Privilège" = capital garanti.',
      'Investisseur qui pense que l\'action remonte', 'Élevé — perte si action < barrière', '#DC2626');

    html += _guideCard('🔥', 'Phoenix / Phoenix Mémoire', 'Coupon 7-9% trimestriel', 'Risque',
      'Coupons versés chaque trimestre si action ≥ trigger coupon (ex: 77%). Effet mémoire : coupons manqués sont stockés et rattrapés. Autocall si action ≥ 100%. Barrière capital à 60%.',
      'Investisseur qui veut des revenus réguliers', 'Élevé — perte si action < barrière', '#DC2626');

    html += _guideCard('🎲', 'Worst-of Basket', 'Coupon 7-12% conditionnel', 'Risque',
      'Comme Autocall/Phoenix mais sur un PANIER d\'actions. Le résultat dépend de la PIRE action. Coupon élevé car risque élevé — il suffit d\'une action qui plonge pour tout perdre.',
      'Investisseur convaincu sur TOUTES les actions du panier', 'Très élevé', '#DC2626');

    html += _guideCard('🎯', 'Dispersion / Paires', 'Rendement 5-15% variable', 'Garanti',
      'Parie sur l\'ÉCART entre actions (pas la direction). 16 paires de tech US. Gagne quand les actions divergent. Capital garanti 100%. Le seul produit action à capital garanti.',
      'Investisseur qui pense que les techs vont diverger', 'Faible (capital garanti)', '#0891B2');

    html += _guideCard('💎', 'Reverse Convertible', 'Coupon 8-12% GARANTI', 'Risque',
      'Coupon élevé GARANTI. MAIS à échéance si action < barrière → tu reçois les ACTIONS (pas le cash). Tu deviens actionnaire à perte. Coupon garanti = le prix du risque que tu portes.',
      'Investisseur qui accepte de devenir actionnaire', 'Élevé — conversion en actions', '#DC2626');

    // Résumé
    html += '<div style="margin-top:12px;padding:10px;background:#DBEAFE;border-radius:6px;font-size:11px;color:#1E40AF;line-height:1.6">';
    html += '<strong>Pour le carry trade (emprunt 3.10%, capital garanti obligatoire) :</strong><br>';
    html += '✅ TARN · Fixe Callable · Callable In Fine · Range Accrual · Step-Up · Floater · Digital Mémoire<br>';
    html += '❌ Autocall · Phoenix · Worst-of · Reverse Convertible (risque capital = incompatible avec carry trade adossé à un emprunt)';
    html += '</div>';

    html += '</div></div>';

    html += '<div style="font-size:14px;font-weight:700;color:#059669;margin-bottom:10px">💡 Impact sur le carry trade</div>';
    var tec10Val = tec10.current || 3.10;
    var spreadVsEmprunt = tec10Val - 3.10;
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">Spread TEC10 vs emprunt</div>';
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + (spreadVsEmprunt > 0 ? '#059669' : '#DC2626') + '">+' + (spreadVsEmprunt * 100).toFixed(0) + 'bp</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">' + tec10Val.toFixed(2) + '% - 3.10%</div></div>';

    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">Marge TARN (trigger 4.40%)</div>';
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:#0891B2">+' + ((4.40 - tec10Val) * 100).toFixed(0) + 'bp</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">4.40% - ' + tec10Val.toFixed(2) + '% de marge</div></div>';

    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">Euribor dans corridor Range Accrual</div>';
    var eur3mVal = eur3m.current || 2.50;
    var inCorridor = eur3mVal >= 1.50 && eur3mVal <= 3.80;
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + (inCorridor ? '#059669' : '#DC2626') + '">' + (inCorridor ? '✅ OUI' : '❌ NON') + '</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">' + eur3mVal.toFixed(2) + '% dans [1.50%-3.80%]</div></div>';
    html += '</div></div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ SVG Chart builder ═══
  function _buildSVGChart(history, thresholds, current, maxObs) {
    var data = history.slice(-Math.min(maxObs, history.length));
    if (data.length < 2) return '<div style="padding:20px;text-align:center;color:#475569">Pas assez de données</div>';

    var W = 700, H = 180, padL = 50, padR = 10, padT = 10, padB = 24;
    var cW = W - padL - padR, cH = H - padT - padB;
    var vals = data.map(function(d) { return d.value; });
    var allValsForRange = vals.concat(thresholds.map(function(t) { return t.val; }));
    var yMin = Math.min.apply(null, allValsForRange) - 0.15;
    var yMax = Math.max.apply(null, allValsForRange) + 0.15;
    var yRange = yMax - yMin || 0.3;

    function x(i) { return padL + (i / (data.length - 1)) * cW; }
    function y(v) { return padT + cH - ((v - yMin) / yRange) * cH; }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;font-family:var(--mono)">';

    // Background
    svg += '<rect x="' + padL + '" y="' + padT + '" width="' + cW + '" height="' + cH + '" fill="#FAFBFC" rx="4"/>';

    // Grid lines (horizontal)
    var nGrid = 5;
    for (var gi = 0; gi <= nGrid; gi++) {
      var gVal = yMin + (yRange * gi / nGrid);
      var gY = y(gVal);
      svg += '<line x1="' + padL + '" y1="' + gY + '" x2="' + (W - padR) + '" y2="' + gY + '" stroke="#E2E8F0" stroke-width="0.5"/>';
      svg += '<text x="' + (padL - 4) + '" y="' + (gY + 3) + '" text-anchor="end" fill="#475569" font-size="8">' + gVal.toFixed(2) + '%</text>';
    }

    // Min-max band (rolling 3-period)
    if (data.length > 3) {
      var bandPath = 'M';
      var bandPathBottom = '';
      for (var bi = 1; bi < data.length - 1; bi++) {
        var bMin = Math.min(vals[bi-1], vals[bi], vals[bi+1]);
        var bMax = Math.max(vals[bi-1], vals[bi], vals[bi+1]);
        bandPath += (bi === 1 ? '' : 'L') + x(bi).toFixed(1) + ',' + y(bMax).toFixed(1);
        bandPathBottom = x(bi).toFixed(1) + ',' + y(bMin).toFixed(1) + (bandPathBottom ? 'L' : '') + bandPathBottom;
      }
      svg += '<path d="' + bandPath + 'L' + bandPathBottom + 'Z" fill="#93C5FD" opacity="0.15"/>';
    }

    // Threshold lines
    thresholds.forEach(function(t) {
      if (t.val >= yMin && t.val <= yMax) {
        var tY = y(t.val);
        svg += '<line x1="' + padL + '" y1="' + tY + '" x2="' + (W - padR) + '" y2="' + tY + '" stroke="' + t.color + '" stroke-width="1.5" stroke-dasharray="' + (t.dash || '6,3') + '" opacity="0.7"/>';
        svg += '<rect x="' + (W - padR - 4) + '" y="' + (tY - 8) + '" width="' + (t.label.length * 5.5 + 8) + '" height="14" rx="3" fill="' + t.color + '" opacity="0.9" transform="translate(-' + (t.label.length * 5.5 + 4) + ',0)"/>';
        svg += '<text x="' + (W - padR - 8) + '" y="' + (tY + 2) + '" text-anchor="end" fill="#fff" font-size="7.5" font-weight="700">' + t.label + '</text>';
      }
    });

    // Main line
    var linePath = '';
    data.forEach(function(d, i) {
      linePath += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(d.value).toFixed(1);
    });
    // Area fill
    var areaPath = linePath + 'L' + x(data.length - 1).toFixed(1) + ',' + y(yMin).toFixed(1) + 'L' + x(0).toFixed(1) + ',' + y(yMin).toFixed(1) + 'Z';
    svg += '<path d="' + areaPath + '" fill="#3B82F6" opacity="0.08"/>';
    svg += '<path d="' + linePath + '" fill="none" stroke="#2563EB" stroke-width="2" stroke-linejoin="round"/>';

    // Data points (show every N)
    var showEvery = Math.max(1, Math.floor(data.length / 20));
    data.forEach(function(d, i) {
      if (i % showEvery === 0 || i === data.length - 1) {
        svg += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d.value).toFixed(1) + '" r="2.5" fill="#2563EB" stroke="#fff" stroke-width="1"/>';
      }
    });

    // Current value marker (last point, bigger)
    var lastI = data.length - 1;
    svg += '<circle cx="' + x(lastI).toFixed(1) + '" cy="' + y(current).toFixed(1) + '" r="5" fill="#2563EB" stroke="#fff" stroke-width="2"/>';
    svg += '<text x="' + (x(lastI) - 2).toFixed(1) + '" y="' + (y(current) - 10).toFixed(1) + '" text-anchor="end" fill="#2563EB" font-size="10" font-weight="700">' + current.toFixed(2) + '%</text>';

    // X-axis dates
    var dateEvery = Math.max(1, Math.floor(data.length / 6));
    data.forEach(function(d, i) {
      if (i % dateEvery === 0 || i === lastI) {
        var dateShort = d.date.substring(0, 7); // YYYY-MM
        svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle" fill="#475569" font-size="7">' + dateShort + '</text>';
      }
    });

    svg += '</svg>';
    return svg;
  }

  // Period selector for chart
  window._mktChartPeriod = function(rateId, nObs) {
    var yields = _data.rates.yields || {};
    var rateObj = yields[rateId];
    // Euribor: check yields first (with history), then policy_rates fallback
    if (rateId === 'euribor_3m') {
      if (yields.euribor_3m) rateObj = yields.euribor_3m;
      else if (policy.euribor_3m) rateObj = policy.euribor_3m;
    }
    if (!rateObj || !rateObj.history) return;

    var container = document.getElementById('mkt-chart-container');
    if (!container) return;

    var thresholds = []; // chart vierge, seuils ajoutés seulement via Analyser

    var history = rateObj.history;
    var sliced = nObs >= 999 ? history : history.slice(-nObs);
    container.innerHTML = _buildSVGChart(sliced, thresholds, rateObj.current, nObs);

    // Update period buttons
    var btns = document.getElementById('mkt-period-btns');
    if (btns) {
      btns.querySelectorAll('button').forEach(function(btn) {
        var isActive = btn.textContent === (nObs === 12 ? '12M' : nObs === 24 ? '2A' : nObs === 60 ? '5A' : 'MAX');
        btn.style.background = isActive ? '#2563EB' : '#fff';
        btn.style.color = isActive ? '#fff' : '#64748B';
        btn.style.borderColor = isActive ? '#2563EB' : '#D1D9E6';
      });
    }
  };

  // ═══ Unified chart + stats update ═══
  var _currentPeriod = 9999;
  window._mktUpdateChart = function(periodObs) {
    var rd = window._mktRateData;
    if (!rd) return;
    var chartEl = document.getElementById('mkt-chart-container');
    var statsEl = document.getElementById('mkt-stats-container');
    if (!chartEl) return;

    // Period — keep current if not specified
    if (periodObs !== undefined) _currentPeriod = periodObs;
    var obs = _currentPeriod;
    var data = obs >= 9999 ? rd.history : rd.history.slice(-obs);

    // Update period button styles
    var btns = document.getElementById('mkt-period-btns');
    if (btns) btns.querySelectorAll('button').forEach(function(b) {
      var bObs = b.textContent === '12M' ? 12 : b.textContent === '2A' ? 24 : b.textContent === '5A' ? 60 : b.textContent === '10A' ? 120 : 9999;
      var active = bObs === obs;
      b.style.background = active ? '#2563EB' : '#fff';
      b.style.color = active ? '#fff' : '#64748B';
      b.style.borderColor = active ? '#2563EB' : '#D1D9E6';
    });

    // Build thresholds from custom input + defaults
    var thresholds = [];
    var customVal = parseFloat(document.getElementById('mkt-custom-threshold')?.value);
    var customMode = document.getElementById('mkt-custom-mode')?.value || 'above';
    var customRange2 = parseFloat(document.getElementById('mkt-custom-range2')?.value);

    if (customVal && !isNaN(customVal)) {
      if (customMode === 'range' && customRange2 && !isNaN(customRange2)) {
        var lo = Math.min(customVal, customRange2), hi = Math.max(customVal, customRange2);
        thresholds.push({ val: lo, label: 'Borne basse ' + lo.toFixed(2) + '%', color: '#DC2626', dash: '6,3' });
        thresholds.push({ val: hi, label: 'Borne haute ' + hi.toFixed(2) + '%', color: '#DC2626', dash: '6,3' });
      } else {
        thresholds.push({ val: customVal, label: (customMode === 'above' ? 'Seuil ≥ ' : 'Seuil ≤ ') + customVal.toFixed(2) + '%', color: '#DC2626', dash: '6,3' });
      }
    }

    // Pas de seuils par défaut — seulement les seuils custom de l'utilisateur

    // Render chart
    chartEl.innerHTML = _buildSVGChart(data, thresholds, rd.current, data.length);

    // Compute stats
    if (!statsEl) return;
    if (!customVal || isNaN(customVal)) {
      // Default stats — basic info
      var vals = data.map(function(d) { return d.value; });
      statsEl.innerHTML = '<div style="padding:8px 12px;background:#F1F3F7;border-radius:6px;font-size:10px;color:#64748B">' +
        'Période : ' + data[0].date + ' → ' + data[data.length-1].date + ' · ' + data.length + ' obs · ' +
        'Min <strong style="color:#059669">' + Math.min.apply(null,vals).toFixed(3) + '%</strong> · ' +
        'Max <strong style="color:#DC2626">' + Math.max.apply(null,vals).toFixed(3) + '%</strong> · ' +
        'Moy <strong style="color:#7C3AED">' + (vals.reduce(function(a,b){return a+b;},0)/vals.length).toFixed(3) + '%</strong>' +
        ' — Entrez un seuil et cliquez Analyser pour voir les stats de franchissement</div>';
      return;
    }

    // Custom threshold stats
    var shtml = '';
    if (customMode === 'range' && customRange2 && !isNaN(customRange2)) {
      var lo = Math.min(customVal, customRange2), hi = Math.max(customVal, customRange2);
      var inside = 0, outside = 0, breaches = 0, prevIn = null, lastOut = null, maxConsecOut = 0, consecOut = 0;
      data.forEach(function(h) {
        var isIn = h.value >= lo && h.value <= hi;
        if (isIn) { inside++; consecOut = 0; } else { outside++; lastOut = h.date; consecOut++; maxConsecOut = Math.max(maxConsecOut, consecOut); }
        if (prevIn !== null && prevIn !== isIn) breaches++;
        prevIn = isIn;
      });
      var pctIn = Math.round(inside / data.length * 100);
      shtml += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">';
      shtml += '<div style="padding:10px;background:' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '#ECFDF5' : '#FEF2F2') + ';border-radius:6px;text-align:center;border:2px solid ' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '#059669' : '#DC2626') + '">';
      shtml += '<div style="font-size:11px;color:#64748B">ACTUEL</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '#059669' : '#DC2626') + '">' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '✅ DANS' : '❌ HORS') + '</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">TEMPS DANS [' + lo.toFixed(2) + '-' + hi.toFixed(2) + ']</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:' + (pctIn >= 80 ? '#059669' : pctIn >= 50 ? '#D97706' : '#DC2626') + '">' + pctIn + '%</div>';
      shtml += '<div style="font-size:11px;color:#64748B">' + inside + '/' + data.length + ' obs</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">FRANCHISSEMENTS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#7C3AED">' + breaches + '</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">MAX CONSEC. HORS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#DC2626">' + maxConsecOut + ' obs</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">DERNIÈRE SORTIE</div>';
      shtml += '<div style="font-family:var(--mono);font-size:11px;font-weight:700;color:#DC2626">' + (lastOut || 'Jamais') + '</div></div>';
      shtml += '</div>';
    } else {
      // Single threshold
      var above = 0, below = 0, breaches = 0, prevAbove = null, lastAbove = null, lastBelow = null;
      var maxConsecAbove = 0, consecAbove = 0, maxConsecBelow = 0, consecBelow = 0;
      data.forEach(function(h) {
        var isAbove = h.value >= customVal;
        if (isAbove) { above++; lastAbove = h.date; consecAbove++; maxConsecAbove = Math.max(maxConsecAbove, consecAbove); consecBelow = 0; }
        else { below++; lastBelow = h.date; consecBelow++; maxConsecBelow = Math.max(maxConsecBelow, consecBelow); consecAbove = 0; }
        if (prevAbove !== null && prevAbove !== isAbove) breaches++;
        prevAbove = isAbove;
      });
      var pctAbove = Math.round(above / data.length * 100);
      var isCurrentAbove = rd.current >= customVal;
      var relevant = customMode === 'above' ? above : below;
      var relevantPct = customMode === 'above' ? pctAbove : (100 - pctAbove);
      var relevantColor = relevantPct >= 80 ? '#059669' : relevantPct >= 50 ? '#D97706' : '#DC2626';
      var conditionMet = customMode === 'above' ? isCurrentAbove : !isCurrentAbove;

      shtml += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">';
      shtml += '<div style="padding:10px;background:' + (conditionMet ? '#ECFDF5' : '#FEF2F2') + ';border-radius:6px;text-align:center;border:2px solid ' + (conditionMet ? '#059669' : '#DC2626') + '">';
      shtml += '<div style="font-size:11px;color:#64748B">ACTUEL vs ' + customVal.toFixed(2) + '%</div>';
      shtml += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:' + (conditionMet ? '#059669' : '#DC2626') + '">' + (conditionMet ? '✅ OUI' : '❌ NON') + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">TEMPS AU-DESSUS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#DC2626">' + pctAbove + '%</div>';
      shtml += '<div style="font-size:11px;color:#64748B">' + above + '/' + data.length + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">TEMPS EN-DESSOUS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#059669">' + (100-pctAbove) + '%</div>';
      shtml += '<div style="font-size:11px;color:#64748B">' + below + '/' + data.length + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">FRANCHISSEMENTS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#7C3AED">' + breaches + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">DERNIER AU-DESSUS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:10px;font-weight:700;color:#DC2626">' + (lastAbove || 'Jamais') + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">MAX CONSEC. ≥</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#DC2626">' + maxConsecAbove + ' obs</div></div>';
      shtml += '</div>';
    }
    statsEl.innerHTML = shtml;
  };

  // ═══ INTERACTIVE: Rate detail panel (click on a card) ═══

  window._mktOpenRate = function(rateId) {
    var panel = document.getElementById('mkt-rate-detail');
    if (!panel || !_data.rates) return;

    var yields = _data.rates.yields || {};
    var policy = _data.rates.policy_rates || {};
    var rateObj = yields[rateId] || policy[rateId.replace('_', '')] || null;

    // Euribor special case
    if (rateId === 'euribor_3m') {
      if (yields.euribor_3m) rateObj = yields.euribor_3m;
      else if (policy.euribor_3m) rateObj = policy.euribor_3m;
    }

    if (!rateObj) { panel.innerHTML = '<div style="padding:12px;color:#DC2626;font-size:12px">Pas de données pour ce taux</div>'; return; }

    var history = rateObj.history || [];
    var current = rateObj.current || 0;
    var label = rateObj.name || rateId;

    var html = '<div style="background:#FFFFFF;border:2px solid #2563EB;border-radius:8px;padding:16px;animation:fadeIn 0.2s">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html += '<div style="font-size:14px;font-weight:700;color:#2563EB">📊 ' + label + ' — Analyse détaillée</div>';
    html += '<button onclick="document.getElementById(\'mkt-rate-detail\').innerHTML=\'\'" style="background:none;border:1px solid #D1D9E6;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:11px;color:#64748B">✕ Fermer</button>';
    html += '</div>';

    if (history.length < 2) {
      // Taux sans historique (Euribor, BCE) — affichage simple
      html += '<div style="padding:16px;text-align:center">';
      html += '<div style="font-family:var(--mono);font-size:32px;font-weight:800;color:#2563EB">' + current.toFixed(2) + '%</div>';
      html += '<div style="font-size:11px;color:#64748B;margin-top:4px">' + (rateObj.description || '') + '</div>';
      html += '<div style="font-size:10px;color:#475569;margin-top:4px">Date : ' + (rateObj.date || '—') + ' · Historique détaillé non disponible (taux quotidien sans série)</div>';
      html += '</div>';

      // Thresholds
      html += '<div style="margin-top:12px;font-size:11px;color:#1A202C">';
      html += '<strong>Seuils produits liés :</strong>';
      if (rateId === 'euribor_3m') {
        html += '<div style="margin-top:6px">Range Accrual corridor [1.50% — 3.80%] : ';
        var dist1 = Math.round((current - 1.50) * 100);
        var dist2 = Math.round((3.80 - current) * 100);
        html += '<span style="color:#059669;font-weight:700">+' + dist1 + 'bp</span> au-dessus de la borne basse · ';
        html += '<span style="color:#059669;font-weight:700">+' + dist2 + 'bp</span> en dessous de la borne haute</div>';
      }
      html += '</div>';
      html += '</div>';
      panel.innerHTML = html;
      return;
    }

    var allVals = history.map(function(h) { return h.value; });
    var minAll = Math.min.apply(null, allVals);
    var maxAll = Math.max.apply(null, allVals);
    var avgAll = allVals.reduce(function(a,b){return a+b;}, 0) / allVals.length;
    var nbObs = history.length;

    // Compute stats by period
    function _periodStats(hist, label, nObs) {
      var slice = hist.slice(-nObs);
      if (slice.length < 2) return null;
      var vals = slice.map(function(h){return h.value;});
      return {
        label: label, count: vals.length,
        min: Math.min.apply(null, vals), max: Math.max.apply(null, vals),
        avg: vals.reduce(function(a,b){return a+b;},0) / vals.length,
        first: vals[0], last: vals[vals.length-1],
        change: vals[vals.length-1] - vals[0],
        startDate: slice[0].date, endDate: slice[slice.length-1].date
      };
    }

    var periods = [
      _periodStats(history, '12 mois', 12),
      _periodStats(history, '2 ans', 24),
      _periodStats(history, '5 ans', 60),
      _periodStats(history, '10 ans', 120),
      _periodStats(history, '20 ans', 250)
    ].filter(Boolean);

    // KPI cards
    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px">';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">ACTUEL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#2563EB">' + current.toFixed(2) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">MIN (' + nbObs + ' obs)</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + minAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">MAX</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#DC2626">' + maxAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">MOYENNE</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#7C3AED">' + avgAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">OBSERVATIONS</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#1A202C">' + nbObs + '</div></div>';
    html += '</div>';

    // Period stats table
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px">';
    html += '<thead><tr style="border-bottom:2px solid #D1D9E6">';
    html += '<th style="padding:6px;text-align:left;color:#64748B;font-size:11px">PÉRIODE</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">MIN</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">MAX</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">MOYENNE</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">VARIATION</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">OBS</th>';
    html += '</tr></thead><tbody>';
    periods.forEach(function(p, i) {
      var bg = i % 2 === 0 ? '#FFFFFF' : '#F4F6F9';
      var chgColor = p.change >= 0 ? '#DC2626' : '#059669';
      html += '<tr style="background:' + bg + ';border-bottom:1px solid #D1D9E6">';
      html += '<td style="padding:6px;font-weight:700">' + p.label + ' <span style="font-size:11px;color:#475569">(' + p.startDate + '→' + p.endDate + ')</span></td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#059669">' + p.min.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#DC2626">' + p.max.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#7C3AED">' + p.avg.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + chgColor + '">' + (p.change >= 0 ? '+' : '') + (p.change * 100).toFixed(0) + 'bp</td>';
      html += '<td style="padding:6px;text-align:right;color:#475569">' + p.count + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    // Store data globally for interactive updates
    window._mktRateData = { id: rateId, history: history, current: current, label: label };

    // ═══ TOOLBAR: Period + Custom threshold ═══
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">';
    // Period buttons
    html += '<div style="display:flex;gap:4px" id="mkt-period-btns">';
    [['12M',12],['2A',24],['5A',60],['10A',120],['20A',250],['MAX',9999]].forEach(function(p) {
      html += '<button onclick="_mktUpdateChart(' + p[1] + ')" style="padding:4px 12px;border-radius:4px;border:1px solid #D1D9E6;background:#fff;color:#64748B;font-size:10px;font-weight:600;cursor:pointer">' + p[0] + '</button>';
    });
    html += '</div>';
    // Custom threshold input
    html += '<div style="display:flex;gap:6px;align-items:center">';
    html += '<input type="number" id="mkt-custom-threshold" placeholder="Ex: 4.60" step="0.05" style="width:80px;padding:5px 8px;border:1px solid #D1D9E6;border-radius:4px;font-family:var(--mono);font-size:11px;color:#1A202C;background:#fff">';
    html += '<select id="mkt-custom-mode" onchange="document.getElementById(\'mkt-custom-range2\').style.display=this.value===\'range\'?\'\':\'none\'" style="padding:5px;border:1px solid #D1D9E6;border-radius:4px;font-size:10px;color:#1A202C;background:#fff">';
    html += '<option value="above">Au-dessus ≥</option><option value="below">En-dessous ≤</option><option value="range">Range [min — max]</option></select>';
    html += '<input type="number" id="mkt-custom-range2" placeholder="Borne haute" step="0.05" style="width:80px;padding:5px 8px;border:1px solid #D1D9E6;border-radius:4px;font-family:var(--mono);font-size:11px;color:#1A202C;background:#fff;display:none">';
    html += '<button onclick="_mktUpdateChart()" style="padding:5px 12px;border-radius:4px;border:none;background:#7C3AED;color:#fff;font-size:10px;font-weight:700;cursor:pointer">Analyser</button>';
    html += '</div></div>';

    // Chart + stats container
    html += '<div id="mkt-chart-container" style="background:#FAFBFC;border:1px solid #E2E8F0;border-radius:8px;padding:8px"></div>';
    html += '<div id="mkt-stats-container" style="margin-top:8px"></div>';

    html += '</div>';
    panel.innerHTML = html;

    // Initial render
    _mktUpdateChart(9999);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ═══ INTERACTIVE: Custom threshold analyzer ═══

  window._mktSimModeChange = function() {
    var mode = document.getElementById('mkt-sim-mode').value;
    var wrap2 = document.getElementById('mkt-sim-val2-wrap');
    var label1 = document.getElementById('mkt-sim-label1');
    if (mode === 'corridor') {
      wrap2.style.display = '';
      label1.textContent = 'BORNE BASSE (%)';
    } else {
      wrap2.style.display = 'none';
      label1.textContent = 'SEUIL (%)';
    }
  };

  window._mktSimAnalyze = function() {
    var rateSel = document.getElementById('mkt-sim-rate').value;
    var mode = document.getElementById('mkt-sim-mode').value;
    var val1 = parseFloat(document.getElementById('mkt-sim-val1').value);
    var val2 = parseFloat(document.getElementById('mkt-sim-val2').value);
    var resultDiv = document.getElementById('mkt-sim-result');
    if (!_data.rates || !resultDiv) return;

    // Get history
    var rateMap = {
      tec10: { key: 'tec10_fr', label: 'TEC10', section: 'yields', fallback: 'oat_fr_10y' },
      oat5y: { key: 'tec5_fr', label: 'TEC 5 (OAT 5Y)', section: 'yields', fallback: 'oat_fr_5y' },
      oat2y: { key: 'tec2_fr', label: 'TEC 2 (OAT 2Y)', section: 'yields', fallback: 'oat_fr_2y' },
      euribor3m: { key: 'euribor_3m', label: 'Euribor 3M', section: 'yields' },
      euribor12m: { key: 'euribor_12m', label: 'Euribor 12M', section: 'yields' }
    };
    var rm = rateMap[rateSel];
    var history = [];
    var current = 0;
    var yieldKey = rm.key;
    if (rm.section === 'yields' && _data.rates.yields && !_data.rates.yields[yieldKey] && rm.fallback) yieldKey = rm.fallback;
    if (rm.section === 'yields' && _data.rates.yields && _data.rates.yields[yieldKey]) {
      history = _data.rates.yields[yieldKey].history || [];
      current = _data.rates.yields[yieldKey].current || 0;
    } else if (rm.section === 'policy_rates' && _data.rates.policy_rates && _data.rates.policy_rates[rm.key]) {
      current = _data.rates.policy_rates[rm.key].current || 0;
      // Policy rates don't have history array, use single point
      history = [{ date: _data.rates.policy_rates[rm.key].date, value: current }];
    }

    if (history.length === 0) {
      resultDiv.innerHTML = '<div style="padding:12px;color:#DC2626;font-size:12px">Pas de données historiques pour ' + rm.label + '</div>';
      return;
    }

    // Analyze
    var inZone = 0, outZone = 0, breaches = [];
    var lastState = null;
    history.forEach(function(h) {
      var v = h.value;
      var isIn = false;
      if (mode === 'below') isIn = v <= val1;
      else if (mode === 'above') isIn = v >= val1;
      else isIn = v >= val1 && v <= val2;

      if (isIn) inZone++; else outZone++;
      if (lastState !== null && lastState !== isIn) {
        breaches.push({ date: h.date, value: v, entered: isIn });
      }
      lastState = isIn;
    });

    var total = inZone + outZone;
    var pctIn = total > 0 ? Math.round(inZone / total * 100) : 0;
    var currentIn = false;
    if (mode === 'below') currentIn = current <= val1;
    else if (mode === 'above') currentIn = current >= val1;
    else currentIn = current >= val1 && current <= val2;

    // Build result HTML
    var html = '';

    // KPI row
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">';
    html += '<div style="padding:10px;background:' + (currentIn ? '#ECFDF5' : '#FEF2F2') + ';border-radius:6px;text-align:center;border:1px solid ' + (currentIn ? '#059669' : '#DC2626') + '">';
    html += '<div style="font-size:11px;color:#64748B">STATUT ACTUEL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (currentIn ? '#059669' : '#DC2626') + '">' + (currentIn ? '✅ DANS' : '❌ HORS') + '</div>';
    html += '<div style="font-size:11px;color:#64748B">' + rm.label + ' = ' + current.toFixed(2) + '%</div></div>';

    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#64748B">TEMPS DANS LA ZONE</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (pctIn >= 80 ? '#059669' : pctIn >= 50 ? '#D97706' : '#DC2626') + '">' + pctIn + '%</div>';
    html += '<div style="font-size:11px;color:#64748B">' + inZone + '/' + total + ' observations</div></div>';

    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#64748B">FRANCHISSEMENTS</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#7C3AED">' + breaches.length + '</div>';
    html += '<div style="font-size:11px;color:#64748B">croisements de seuil</div></div>';

    var distBp = 0;
    if (mode === 'below') distBp = Math.round((val1 - current) * 100);
    else if (mode === 'above') distBp = Math.round((current - val1) * 100);
    else distBp = Math.round(Math.min(current - val1, val2 - current) * 100);
    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#64748B">MARGE AU SEUIL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (distBp > 0 ? '#059669' : '#DC2626') + '">' + (distBp > 0 ? '+' : '') + distBp + 'bp</div>';
    html += '<div style="font-size:11px;color:#64748B">distance au plus proche</div></div>';
    html += '</div>';

    // Visual chart with zone overlay
    html += '<div style="position:relative;background:#F8F9FB;border:1px solid #D1D9E6;border-radius:6px;padding:12px;margin-bottom:8px">';
    html += '<div style="font-size:10px;font-weight:700;color:#1A202C;margin-bottom:8px">' + rm.label + ' — Historique vs ';
    if (mode === 'corridor') html += 'corridor [' + val1.toFixed(2) + '% — ' + val2.toFixed(2) + '%]';
    else html += 'seuil ' + (mode === 'below' ? '≤' : '≥') + ' ' + val1.toFixed(2) + '%';
    html += '</div>';

    // Compute chart bounds
    var allVals = history.map(function(h) { return h.value; });
    var chartMin = Math.min.apply(null, allVals.concat([val1, mode === 'corridor' ? val2 : val1])) - 0.15;
    var chartMax = Math.max.apply(null, allVals.concat([val1, mode === 'corridor' ? val2 : val1])) + 0.15;
    var chartRange = chartMax - chartMin || 0.3;
    var chartH = 100;

    html += '<div style="position:relative;height:' + chartH + 'px">';
    // Zone overlay
    if (mode === 'corridor') {
      var zoneBottom = ((val1 - chartMin) / chartRange) * chartH;
      var zoneTop = ((val2 - chartMin) / chartRange) * chartH;
      html += '<div style="position:absolute;left:0;right:0;bottom:' + zoneBottom + 'px;height:' + (zoneTop - zoneBottom) + 'px;background:#059669;opacity:0.12;border-radius:3px"></div>';
      // Lines for corridor
      html += '<div style="position:absolute;left:0;right:0;bottom:' + zoneBottom + 'px;height:1px;background:#059669;opacity:0.6"></div>';
      html += '<div style="position:absolute;left:0;right:0;bottom:' + zoneTop + 'px;height:1px;background:#059669;opacity:0.6"></div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (zoneBottom + 2) + 'px;font-size:11px;color:#059669;font-weight:700">' + val1.toFixed(2) + '%</div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (zoneTop + 2) + 'px;font-size:11px;color:#059669;font-weight:700">' + val2.toFixed(2) + '%</div>';
    } else {
      var lineY = ((val1 - chartMin) / chartRange) * chartH;
      html += '<div style="position:absolute;left:0;right:0;bottom:' + lineY + 'px;height:2px;background:#DC2626;opacity:0.6"></div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (lineY + 3) + 'px;font-size:11px;color:#DC2626;font-weight:700">Seuil ' + val1.toFixed(2) + '%</div>';
      // Zone overlay
      if (mode === 'below') {
        html += '<div style="position:absolute;left:0;right:0;bottom:0;height:' + lineY + 'px;background:#059669;opacity:0.08"></div>';
      } else {
        html += '<div style="position:absolute;left:0;right:0;bottom:' + lineY + 'px;top:0;background:#059669;opacity:0.08"></div>';
      }
    }

    // Data bars
    var barW = Math.max(4, Math.floor(100 / history.length) - 1);
    html += '<div style="display:flex;align-items:flex-end;height:100%;gap:1px">';
    history.forEach(function(h) {
      var barBottom = ((h.value - chartMin) / chartRange) * chartH;
      var isIn = false;
      if (mode === 'below') isIn = h.value <= val1;
      else if (mode === 'above') isIn = h.value >= val1;
      else isIn = h.value >= val1 && h.value <= val2;
      var color = isIn ? '#059669' : '#DC2626';
      html += '<div style="flex:1;position:relative;height:100%">';
      html += '<div style="position:absolute;bottom:0;left:0;right:0;height:' + barBottom + 'px;background:' + color + ';opacity:0.7;border-radius:2px 2px 0 0" title="' + h.date + ' : ' + h.value + '% — ' + (isIn ? 'DANS' : 'HORS') + '"></div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    // Date labels
    html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#475569;margin-top:3px">';
    html += '<span>' + history[0].date + '</span>';
    html += '<span style="color:#059669">■ Dans la zone</span><span style="color:#DC2626">■ Hors zone</span>';
    html += '<span>' + history[history.length - 1].date + '</span>';
    html += '</div>';
    html += '</div>';

    // Breach list
    if (breaches.length > 0) {
      html += '<div style="font-size:10px;font-weight:700;color:#1A202C;margin-bottom:4px">Franchissements :</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
      breaches.forEach(function(b) {
        html += '<span style="padding:2px 8px;border-radius:3px;font-size:11px;font-family:var(--mono);background:' + (b.entered ? '#ECFDF5' : '#FEF2F2') + ';color:' + (b.entered ? '#059669' : '#DC2626') + '">';
        html += b.date + ' ' + b.value.toFixed(3) + '% ' + (b.entered ? '→ ENTRE' : '→ SORTI') + '</span>';
      });
      html += '</div>';
    }

    resultDiv.innerHTML = html;
  };

  // ═══ Brochure products loading (uses MarketProductsScanner if available) ═══
  async function _loadBrochureProducts() {
    var contentEl = document.getElementById('mkt-brochure-content');
    if (!contentEl) return;
    if (!window.MarketProductsScanner) {
      contentEl.innerHTML = '<div style="color:#475569;font-size:10px">Module MarketProductsScanner non chargé</div>';
      return;
    }

    try {
      var products = await window.MarketProductsScanner.scan();
      if (!products || products.length === 0) {
        contentEl.innerHTML = '<div style="color:#475569;font-size:10px">Aucun produit taux détecté dans les brochures</div>';
        return;
      }

      // Enrich with rate stats
      if (_data.rates && window.MarketAnalyzer) {
        products = products.map(function(p) {
          return window.MarketProductsScanner.enrich(p, _data.rates, 'MAX');
        });
      }

      // Sort: exploitable first, then by coupon desc
      products.sort(function(a, b) {
        if (a.hasExploitableSeuil && !b.hasExploitableSeuil) return -1;
        if (!a.hasExploitableSeuil && b.hasExploitableSeuil) return 1;
        return (b.couponRate || 0) - (a.couponRate || 0);
      });

      // Render table
      var html = '<div style="font-size:10px;color:#64748B;margin-bottom:8px">' + products.length + ' produits taux détectés dans les brochures. Clic sur "Analyser" pour charger le seuil dans le chart.</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
      html += '<thead><tr style="border-bottom:2px solid #D1D9E6">';
      html += '<th style="padding:6px;text-align:left;color:#64748B">Produit</th>';
      html += '<th style="padding:6px;text-align:left;color:#64748B">Émetteur</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Sous-jacent</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Seuil</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Coupon</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Maturité</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Statut</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">% OK</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Marge</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B"></th>';
      html += '</tr></thead><tbody>';

      products.forEach(function(p, idx) {
        var bg = idx % 2 === 0 ? '#FFFFFF' : '#F4F6F9';
        var hasStats = p.stats && p.hasExploitableSeuil;
        var pctOK = hasStats ? (p.stats.pctInZone != null ? p.stats.pctInZone : p.stats.pctBelow != null ? p.stats.pctBelow : '—') : '—';
        var marge = hasStats && p.stats.marginBps != null ? (p.stats.marginBps >= 0 ? '+' : '') + p.stats.marginBps + 'bp' : '—';
        var statusOK = hasStats ? (p.stats.currentInZone || p.stats.currentBelow) : null;
        var seuilLabel = p.threshold ? (p.thresholdMode === 'below' ? '≤' : '≥') + ' ' + p.threshold + '%' :
                         p.corridorLow ? '[' + p.corridorLow + '-' + p.corridorHigh + '%]' : '—';

        html += '<tr style="background:' + bg + ';border-bottom:1px solid #E2E8F0">';
        html += '<td style="padding:6px;font-weight:600;color:#1A202C;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (p.name || '') + '">' + (p.name || '?').substring(0, 35) + '</td>';
        html += '<td style="padding:6px;color:#64748B">' + (p.emitter || '?').substring(0, 20) + '</td>';
        html += '<td style="padding:6px;text-align:center"><span style="padding:2px 6px;border-radius:3px;background:#E0F7FA;color:#0891B2;font-size:11px;font-weight:600">' + (p.rateAlias || '—') + '</span></td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-weight:700;color:#7C3AED">' + seuilLabel + '</td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-weight:700;color:#059669">' + (p.couponRate ? p.couponRate + '%' : '—') + '</td>';
        html += '<td style="padding:6px;text-align:center;color:#64748B">' + (p.maturityYears ? p.maturityYears + 'Y' : '—') + '</td>';
        html += '<td style="padding:6px;text-align:center">' + (statusOK === true ? '<span style="color:#059669;font-weight:700">✅</span>' : statusOK === false ? '<span style="color:#DC2626;font-weight:700">❌</span>' : '—') + '</td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (typeof pctOK === 'number' && pctOK >= 80 ? '#059669' : '#D97706') + '">' + (typeof pctOK === 'number' ? pctOK + '%' : pctOK) + '</td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-size:11px;color:' + (typeof marge === 'string' && marge.indexOf('+') === 0 ? '#059669' : '#DC2626') + '">' + marge + '</td>';
        // Analyser button — loads threshold into the chart above
        if (p.hasExploitableSeuil && p.rateAlias) {
          var clickAction = '_mktOpenRate(\'' + (p.rateAlias === 'tec10' ? 'tec10_fr' : p.rateAlias === 'oat5y' ? 'tec5_fr' : p.rateAlias === 'oat2y' ? 'tec2_fr' : 'euribor_3m') + '\')';
          html += '<td style="padding:6px;text-align:center"><button onclick="' + clickAction + ';setTimeout(function(){var e=document.getElementById(\'mkt-custom-threshold\');if(e){e.value=\'' + (p.threshold || p.corridorLow || '') + '\';var m=document.getElementById(\'mkt-custom-mode\');if(m)m.value=\'' + (p.thresholdMode || 'below') + '\';_mktUpdateChart()}},200)" style="padding:3px 8px;border-radius:3px;border:1px solid #7C3AED;background:#F5F3FF;color:#7C3AED;font-size:11px;font-weight:600;cursor:pointer">Analyser</button></td>';
        } else {
          html += '<td style="padding:6px;text-align:center;color:#475569;font-size:11px">—</td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table>';
      contentEl.innerHTML = html;
    } catch(e) {
      console.error('[MarketDashboard] Erreur scan brochures:', e);
      contentEl.innerHTML = '<div style="color:#DC2626;font-size:10px">Erreur: ' + e.message + '</div>';
    }
  }

  window.renderMarketDashboard = async function(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B">Chargement des données marché...</div>';
    if (!_data.loaded) await _loadData();
    _render(container);
    // Load brochure products in background
    setTimeout(_loadBrochureProducts, 100);
  };

  console.log('[StructBoard] Market Dashboard v1.0 loaded');
})();

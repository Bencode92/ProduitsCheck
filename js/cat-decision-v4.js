// ═══════════════════════════════════════════════════════════════════
// CAT — Décision v4 : une seule vue taux (courbe → forwards + spread CAT)
// consommée par trois décisions :
//   1. placements existants : garder / sortir maintenant / sortir à l'échéance libre
//   2. nouveau cash : progressif vs fixe vs enchaînement (2e jambe au forward)
//   3. callable / TARN saisi à la main vs meilleur CAT
// Tout en MONTANT FINAL à un horizon commun (12 / 24 / 36 mois), actuariel brut,
// sous 3 scénarios de taux (forward = marché, ±50 bp) + scénario libre en bp.
// Chargé après cat-horizon-grid.js, cat-exit-terms-patch.js, cat-optimizer*.js.
// ═══════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  const VIEWS = [{ k: 'down', label: 'Baisse', bp: -50 }, { k: 'fwd', label: 'Marché (forward)', bp: 0 }, { k: 'up25', label: 'Hausse modérée', bp: 25 }, { k: 'up50', label: 'Hausse forte', bp: 50 }];
  const S = window._catV4State = window._catV4State || { horizon: 12, view: 'fwd', shift: 0, cash: 300000, callable: { coupon: 4.0, guaranteed: 2, maturity: 10, spread: 0.6, barrier: '', fees: 0, enabled: false }, selected: [], rates: null };
  const fmtE = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';
  const fmtP = (x) => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' %';
  const DAY = 864e5;

  // ── 1. Vue taux ──────────────────────────────────────────────────
  function _curve() {
    const y = (S.rates && S.rates.yields) || {};
    const g = (k) => (y[k] && parseFloat(y[k].current)) || null;
    const nodes = [[3, g('euribor_3m')], [6, g('euribor_6m')], [12, g('euribor_12m')], [24, g('oat_fr_2y')], [60, g('oat_fr_5y')], [120, g('oat_fr_10y')]].filter(n => n[1] != null);
    return { nodes, tec10: g('tec10_fr'), date: S.rates && S.rates.fetched_at ? S.rates.fetched_at.split('T')[0] : null };
  }
  function spot(m) {
    const n = _curve().nodes; if (!n.length) return 3;
    if (m <= n[0][0]) return n[0][1]; if (m >= n[n.length - 1][0]) return n[n.length - 1][1];
    for (let i = 0; i < n.length - 1; i++) if (m >= n[i][0] && m <= n[i + 1][0]) { const t = (m - n[i][0]) / (n[i + 1][0] - n[i][0]); return n[i][1] + t * (n[i + 1][1] - n[i][1]); }
    return n[n.length - 1][1];
  }
  // taux implicite (annualisé) dans `start` mois pour `len` mois
  function forward(start, len) {
    if (start <= 0) return spot(len);
    const a = Math.pow(1 + spot(start + len) / 100, (start + len) / 12), b = Math.pow(1 + spot(start) / 100, start / 12);
    return (Math.pow(a / b, 12 / len) - 1) * 100;
  }
  function _offers() {
    return (catManager.rates?.rates || []).filter(r => r.source !== 'web scan' && r.productType !== 'parts-sociales' && (parseFloat(r.rate) || 0) > 0 && !(typeof _isRateExpired === 'function' && _isRateExpired(r)) && !/transition/i.test(r.productName || '') && String(r.category || '').toLowerCase() !== 'transition');
  }
  // meilleur taux d'offre (sortie libre) à la durée d, et spread CAT vs courbe
  function bestOffer(d) {
    let best = null;
    _offers().forEach(r => { if (typeof window._catEffectiveRate !== 'function') return; const x = window._catEffectiveRate(r, d); if (x.rate == null || x.kind !== 'free') return; if (!best || x.rate > best.rate) best = { rate: x.rate, r }; });
    return best;
  }
  function catSpread(d) {
    const pts = [3, 6, 12, 18, 24, 36].map(m => { const b = bestOffer(m); return b ? [m, b.rate - spot(m)] : null; }).filter(Boolean);
    if (!pts.length) return 0;
    // moyenne sur les durées disponibles (lisse les offres promotionnelles ponctuelles)
    return pts.reduce((s, p) => s + p[1], 0) / pts.length;
  }
  // CAT attendu si l'on place dans `start` mois pour `len` mois, sous le scénario (shift bp sur les taux futurs)
  function expectedCAT(start, len, shiftBp) { return forward(start, len) + catSpread(len) + (shiftBp || 0) / 100; }
  // meilleur taux disponible AUJOURD'HUI pour `len` mois (offre réelle), repli forward+spread
  function todayRate(len) { const b = bestOffer(len); return b ? { rate: b.rate, label: (b.r.bankName || '') + ' ' + (b.r.productName || '').replace(/^CAT\s+/i, '') } : { rate: expectedCAT(0, len, 0), label: 'estimation (courbe + spread)' }; }

  // ── 2. Placements existants ──────────────────────────────────────
  function _growthSchedule(d, from, to, penaltyOnCurrent) {
    // croissance actuarielle du placement entre deux dates, selon ses paliers datés (ou taux fixe)
    let g = 1;
    const sched = (d.rateSchedule && d.rateSchedule.length && d.rateSchedule[0].from) ? d.rateSchedule : null;
    if (!sched) { const days = Math.max(0, (to - from) / DAY); return Math.pow(1 + (parseFloat(d.rate) || 0) / 100, days / 365); }
    const now = new Date();
    sched.forEach(st => {
      const f = new Date(st.from), t = new Date(new Date(st.to).getTime() + DAY);
      const a = Math.max(f, from), b = Math.min(t, to); if (b <= a) return;
      const isCurrent = f <= now && t > now;
      let rate = parseFloat(st.rate) || 0;
      if (penaltyOnCurrent && isCurrent) rate = st.earlyRate != null ? parseFloat(st.earlyRate) : rate * 0.5;
      g *= Math.pow(1 + rate / 100, ((b - a) / DAY) / 365);
    });
    return g;
  }
  function _fixedExitFactor(d) {
    // fixes avec barème servedPct : fraction des intérêts courus servie si sortie maintenant
    if (!d.startDate) return 1;
    const m = Math.max(1, Math.ceil(((new Date() - new Date(d.startDate)) / DAY) / 30.44));
    const s = typeof window._depositServedPct === 'function' ? window._depositServedPct(d, m) : null;
    return s == null ? 1 : s / 100;
  }
  function depositOptions(d, H, shiftBp) {
    const now = new Date(), start = d.startDate ? new Date(d.startDate) : now, mat = d.maturityDate ? new Date(d.maturityDate) : null;
    const hEnd = new Date(now.getTime() + H * 30.44 * DAY);
    const amt = parseFloat(d.amount) || 0;
    const past = _growthSchedule(d, start, now, false); // intérêts déjà acquis (mêmes pour toutes les options, sauf pénalité)
    const out = {};
    // GARDER : jusqu'à min(maturité, H), puis CAT attendu à la maturité
    { const end = mat && mat < hEnd ? mat : hEnd; let g = past * _growthSchedule(d, now, end, false);
      if (mat && mat < hEnd) { const s = Math.round((mat - now) / DAY / 30.44), rest = H - s; if (rest > 0) g *= Math.pow(1 + expectedCAT(s, rest, shiftBp) / 100, rest / 12); }
      out.keep = { value: amt * g, label: mat && mat < hEnd ? 'garder → échéance ' + formatDate(d.maturityDate) + ' → CAT attendu ' + fmtP(expectedCAT(Math.round((mat - now) / DAY / 30.44), Math.max(1, H - Math.round((mat - now) / DAY / 30.44)), shiftBp)) : 'garder (taux des paliers)' }; }
    // SORTIR MAINTENANT : pénalité sur la période courante (progressif) ou barème (fixe), préavis à 0 %, puis meilleure offre du jour
    { const notice = typeof window._depositNoticeDays === 'function' ? window._depositNoticeDays(d) : 32;
      let g;
      if (d.rateSchedule && d.rateSchedule.length) g = _growthSchedule(d, start, now, true);
      else { const f = _fixedExitFactor(d); g = 1 + (past - 1) * f; }
      const restM = Math.max(1, H - Math.round(notice / 30.44));
      const tr = todayRate(restM);
      g *= Math.pow(1 + tr.rate / 100, restM / 12);
      out.exitNow = { value: amt * g, label: 'sortir (préavis ' + notice + ' j, pénalité appliquée) → ' + tr.label + ' ' + fmtP(tr.rate) + ' sur ' + restM + ' m' }; }
    // SORTIR À L'ÉCHÉANCE LIBRE : fin du palier en cours, sans frais, puis CAT attendu à cette date
    if (d.exitFreeAtPeriodEnd && d.rateSchedule && d.rateSchedule.length && d.rateSchedule[0].from) {
      const cur = d.rateSchedule.find(st => new Date(st.from) <= now && new Date(st.to) >= now);
      if (cur) { const free = new Date(new Date(cur.to).getTime() + DAY);
        if (free < hEnd) { const s = Math.round((free - now) / DAY / 30.44), rest = Math.max(1, H - s);
          const g = past * _growthSchedule(d, now, free, false) * Math.pow(1 + expectedCAT(s, rest, shiftBp) / 100, rest / 12);
          out.exitFree = { value: amt * g, date: free, label: 'sortir sans frais le ' + formatDate(free) + ' → CAT attendu ' + fmtP(expectedCAT(s, rest, shiftBp)) + ' sur ' + rest + ' m' }; } }
    }
    return out;
  }

  // ── 3. Nouveau cash (réutilise la grille horizon : offres réelles en 1re jambe) ──
  function cashStrategies(A, H, shiftBp) {
    const list = _offers(); const eff = window._catEffectiveRate; if (typeof eff !== 'function') return [];
    const name = (r) => (r.bankName || r.bankId) + ' ' + (r.productName || (r.durationMonths + 'm')).replace(/^CAT\s+/i, '');
    const out = [];
    list.forEach(r => { const x = eff(r, H); if (x.rate == null) return; out.push({ label: name(r) + (x.kind === 'penalty' ? ' ⚠ sortie anticipée' : ''), final: A * Math.pow(1 + x.rate / 100, H / 12), type: r.rateType === 'progressif' ? 'progressif' : 'fixe', single: true }); });
    list.forEach(a => { for (let d1 = 1; d1 < H; d1++) { const xa = eff(a, d1); if (xa.rate == null || xa.kind !== 'free') continue; const rest = H - d1; const fw = expectedCAT(d1, rest, shiftBp);
      out.push({ label: name(a) + ' (' + d1 + ' m) → CAT attendu ' + fmtP(fw) + ' (' + rest + ' m)', final: A * Math.pow(1 + xa.rate / 100, d1 / 12) * Math.pow(1 + fw / 100, rest / 12), type: 'enchaînement', single: false }); } });
    const seen = new Set();
    return out.filter(s => !seen.has(s.label) && seen.add(s.label)).sort((x, y) => y.final - x.final);
  }

  // ── 4bis. Produits de taux réels (fiches StructBoard) ─────────────
  function _rateProducts() {
    const seen = new Set(), out = [];
    const push = (p) => { if (!p || !p.id || seen.has(p.id)) return; seen.add(p.id); out.push(p); };
    const _app = (typeof app !== 'undefined' && app && app.state) ? app : null;
    try { Object.values((_app && _app.state.proposals) || {}).forEach(arr => (arr || []).forEach(push)); } catch (e) {}
    try { ((_app && _app.state.portfolio) || []).forEach(push); } catch (e) {}
    return out.filter(p => {
      const cp = p.capitalProtection || {}; const c = p.coupon || {}; const er = p.earlyRedemption || {};
      const rateLike = /TEC|EURIBOR|CMS|€STR|ESTR|OAT/i.test(String(c.barrierCouponType || '') + ' ' + String((p.underlyings || []).join(' '))) || c.type === 'fixe' || c.type === 'fixe_capitalise' || er.type === 'callable' || er.type === 'tarn';
      return (cp.protected === true || cp.protected === 'true' || /capital_garanti|taux_fixe|taux-fixe|capital-protege/.test(String(p.structureType || p.type || ''))) && rateLike;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  function _productTerms(p) {
    const c = p.coupon || {}, er = p.earlyRedemption || {};
    const coupon = parseFloat(c.annualizedRate != null ? c.annualizedRate : c.rate) || 0;
    const maturity = parseFloat(p.maturityYears) || 10;
    const inFine = /in_fine|maturit/i.test(String(c.frequency || '')) || c.paymentTiming === 'at_redemption';
    const isCallable = er.type === 'callable' || er.discretionary === true;
    const isTarn = er.type === 'tarn' || (er.targetCouponLevel != null && er.targetCouponLevel > 0);
    // 1re année de rappel possible : firstCallDate vs strike, sinon startSemester/2, sinon années garanties
    let firstCall = null;
    if (isCallable) {
      if (er.firstCallDate && p.strikeDate) firstCall = Math.max(1, Math.round((new Date(er.firstCallDate) - new Date(p.strikeDate)) / DAY / 365));
      else if (er.firstCallDate && /^\d{4}-/.test(er.firstCallDate)) firstCall = Math.max(1, new Date(er.firstCallDate).getFullYear() - new Date().getFullYear());
      else if (er.startSemester) firstCall = Math.max(1, Math.round(er.startSemester / 2));
      else firstCall = 1;
    }
    const barrier = (c.type === 'conditionnel' && c.trigger != null && c.trigger > 0 && c.trigger < 20) ? parseFloat(c.trigger) : null; // seuil de taux (≤)
    const fees = parseFloat((p.aiParsed && p.aiParsed.commissions) || (p.fees && p.fees.structuring)) || 0; // one-shot, en % du nominal
    return { coupon, maturity, inFine, isCallable, isTarn, firstCall, guaranteed: parseInt(c.guaranteedYears, 10) || 0, target: parseFloat(er.targetCouponLevel || er.trigger) || null, barrier, memory: !!c.memory, fees, spread: 0.6, name: p.name };
  }
  function productValue(t, A, H, shiftBp) {
    const years = Math.floor(H / 12), tec = _curve().tec10; const notes = [];
    let coupons = 0, cum = 0, redeemedYear = null, lost = 0, memoryBank = 0;
    for (let y = 1; y <= Math.min(years, Math.ceil(t.maturity)); y++) {
      let paid = true;
      if (t.barrier != null && y > t.guaranteed && tec != null) {
        const tecY = tec + (forward((y - 1) * 12, 120) - spot(120)) + (shiftBp || 0) / 100;
        paid = tecY <= t.barrier;
      }
      if (paid) { const cpn = A * t.coupon / 100 * (1 + (t.memory ? memoryBank : 0)); coupons += cpn; cum += t.coupon * (1 + (t.memory ? memoryBank : 0)); memoryBank = 0; }
      else { lost++; if (t.memory) memoryBank++; }
      if (t.isTarn && t.target && cum >= t.target - 1e-9) { redeemedYear = y; notes.push('cible ' + fmtP(t.target) + ' atteinte → remboursé fin année ' + y); break; }
      if (t.isCallable && t.firstCall != null && y >= t.firstCall && y < t.maturity) {
        const mkt = forward(y * 12, (t.maturity - y) * 12) + (shiftBp || 0) / 100 + t.spread;
        if (t.coupon - mkt > 0.15) { redeemedYear = y; notes.push('rappelé par l\'émetteur fin année ' + y + ' (coupon ' + fmtP(t.coupon) + ' > marché ' + fmtP(mkt) + ')'); break; }
      }
    }
    let value = A * (1 - t.fees / 100) + coupons, liquid = true;
    if (redeemedYear != null && redeemedYear * 12 < H) { const rest = H - redeemedYear * 12; value = A * (1 - t.fees / 100) * Math.pow(1 + expectedCAT(redeemedYear * 12, rest, shiftBp) / 100, rest / 12) + coupons; notes.push('capital replacé au CAT attendu ' + fmtP(expectedCAT(redeemedYear * 12, rest, shiftBp)) + ' sur ' + rest + ' m'); }
    else if (t.maturity * 12 > H && redeemedYear == null) { liquid = false; notes.push(H <= (t.isCallable ? (t.firstCall || 1) : t.guaranteed) * 12 ? 'période garantie / non rappelable — juge aussi à ' + Math.min(60, Math.round(t.maturity * 12)) + ' m' : (t.isTarn ? 'cible non atteinte : coupons conditionnels, capital immobilisé jusqu\'à ' + t.maturity + ' ans' : t.isCallable ? 'non rappelé : coincé au coupon ' + fmtP(t.coupon) + ' jusqu\'à ' + t.maturity + ' ans' : 'capital immobilisé jusqu\'à l\'échéance (' + t.maturity + ' ans)')); }
    if (lost) notes.push(lost + ' coupon(s) perdu(s) (taux scénario > barrière ' + fmtP(t.barrier) + ')' + (t.memory ? ' — mémoire' : ''));
    if (t.inFine && !redeemedYear && years > 0) notes.push('coupons capitalisés, versés seulement au remboursement');
    if (t.fees) notes.push('commission ' + fmtP(t.fees) + ' déduite');
    return { value, liquid, notes, coupons, redeemedYear };
  }

  // ── Rendu ────────────────────────────────────────────────────────
  const SCEN = [{ k: 'down', label: 'Baisse −50 bp', bp: -50 }, { k: 'fwd', label: 'Marché (forward)', bp: 0 }, { k: 'up', label: 'Hausse +50 bp', bp: 50 }];

  function render() {
    const host = document.getElementById('cat-v4-host'); if (!host) return;
    if (!S.rates) { host.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">Chargement de la courbe des taux…</div>'; return; }
    const H = S.horizon, cv = _curve();
    const view = VIEWS.find(v => v.k === S.view) || VIEWS[1];
    const scen = SCEN.slice(); // colonnes fixes : Baisse / Marché / Hausse +50
    const viewIdx = view.bp <= -25 ? 0 : view.bp >= 50 ? 2 : view.bp > 0 ? -1 : 1; // -1 = vue intermédiaire (+25) : calculée à part
    let h = `<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#0EA5E9"></span>🧭 Décision v4 — courbe, pénalités, scénarios</div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:11px">
        <label>Horizon <select id="v4-h" onchange="window._catV4Set('horizon',this.value)">${[6, 12, 18, 24, 36, 60].map(m => `<option value="${m}" ${m === H ? 'selected' : ''}>${m} mois</option>`).join('')}</select></label>
        <span>Ma vue sur les taux : ${VIEWS.map(v => `<button class="btn sm" style="margin-left:4px;${v.k === view.k ? 'background:#0EA5E9;color:#fff;border-color:#0EA5E9' : ''}" onclick="window._catV4Set('view','${v.k}')" title="${v.bp === 0 ? 'ce que la courbe anticipe déjà' : (v.bp > 0 ? '+' : '') + v.bp + ' bp au-delà du forward'}">${v.label}</button>`).join('')}</span>
      </div></div>
      <div style="font-size:10px;color:var(--text-muted);margin:-4px 0 10px">La reco suit <strong>ta vue</strong> (${view.label}${view.bp ? ', ' + (view.bp > 0 ? '+' : '') + view.bp + ' bp vs forward' : ''}) ; les 3 colonnes montrent ce que tu gagnes ou perds si le marché fait autre chose. « Marché » = la courbe telle quelle : une hausse est déjà dedans (forward 6 m dans 6 m ${fmtP(forward(6, 6))} vs ${fmtP(spot(6))} aujourd'hui) — choisir « Hausse » = parier sur PLUS que ça.</div>`;

    // 1. vue taux
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">`;
    cv.nodes.forEach(n => { h += `<div style="padding:8px 10px;background:var(--bg-elevated);border-radius:6px"><div style="font-size:9px;color:var(--text-dim)">Courbe ${n[0]} m</div><div style="font-family:var(--mono);font-weight:700">${fmtP(n[1])}</div></div>`; });
    [[6, 6], [6, 12], [12, 12], [24, 12]].forEach(([s, l]) => { h += `<div style="padding:8px 10px;background:rgba(14,165,233,0.08);border-radius:6px"><div style="font-size:9px;color:var(--text-dim)">Forward ${l} m dans ${s} m</div><div style="font-family:var(--mono);font-weight:700;color:#0EA5E9">${fmtP(forward(s, l))}</div><div style="font-size:9px;color:var(--text-dim)">CAT attendu ${fmtP(expectedCAT(s, l, 0))}</div></div>`; });
    h += `</div><div style="font-size:10px;color:var(--text-muted);margin-bottom:14px">Courbe du ${cv.date || '?'} (Euribor + AAA). <strong>Forward</strong> = taux futur déjà anticipé par le marché ; « CAT attendu » = forward + spread moyen des offres CAT sur la courbe (${fmtP(catSpread(12))} à 12 m). Attendre ne gagne que si les taux montent <em>plus</em> que le forward. TEC10 ${cv.tec10 != null ? fmtP(cv.tec10) : '—'}.</div>`;

    // 2. placements existants
    const active = catManager.deposits.filter(d => d.status === 'active');
    h += `<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px">1 · Mes placements — montant à ${H} mois, brut, par scénario</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:760px"><thead><tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Placement</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Option</th>${scen.map(s => `<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">${s.label}</th>`).join('')}<th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Reco</th></tr></thead><tbody>`;
    active.forEach(d => {
      const per = scen.map(s => depositOptions(d, H, s.bp));
      const keys = Object.keys(per[1]);
      // reco = meilleure option dans TA vue ; robuste si c'est aussi la meilleure dans les 3 scénarios
      const perView = viewIdx >= 0 ? per[viewIdx] : depositOptions(d, H, view.bp);
      const bestKey = keys.reduce((b, k) => (!b || perView[k].value > perView[b].value) ? k : b, null);
      const robust = scen.every((s, i) => keys.reduce((b, k) => (!b || per[i][k].value > per[i][b].value) ? k : b, null) === bestKey);
      const labels = { keep: '✅ Garder', exitNow: '🔄 Sortir maintenant', exitFree: '⏳ Sortir à l\'échéance libre' };
      keys.forEach((k, j) => {
        h += `<tr style="border-bottom:1px solid var(--border);${k === bestKey ? 'background:rgba(6,214,160,0.06)' : ''}">`;
        if (j === 0) h += `<td rowspan="${keys.length}" style="padding:5px 6px;vertical-align:top"><strong>${d.productName || 'CAT'}</strong><div style="font-size:9px;color:var(--text-dim)">${d.bankName || ''} · ${d.entityName || ''} · ${fmtE(parseFloat(d.amount) || 0)}${d.maturityDate ? ' · éch. ' + formatDate(d.maturityDate) : ''}</div></td>`;
        h += `<td style="padding:5px 6px;${k === bestKey ? 'font-weight:700' : ''}" title="${per[1][k].label.replace(/"/g, '&quot;')}">${labels[k]}<div style="font-size:9px;color:var(--text-dim);font-weight:400">${per[1][k].label}</div></td>`;
        scen.forEach((s, i) => { const v = per[i][k].value, ref = per[i].keep.value; h += `<td style="padding:5px 6px;text-align:right;font-family:var(--mono);white-space:nowrap">${fmtE(v)}<div style="font-size:9px;color:${v - ref > 1 ? 'var(--green)' : v - ref < -1 ? 'var(--orange)' : 'var(--text-dim)'}">${k === 'keep' ? 'réf.' : (v - ref >= 0 ? '+' : '−') + fmtE(Math.abs(v - ref))}</div></td>`; });
        if (j === 0) h += `<td rowspan="${keys.length}" style="padding:5px 6px;vertical-align:top;font-size:11px">${labels[bestKey]}<div style="font-size:9px;color:${robust ? 'var(--green)' : 'var(--orange)'}">${robust ? 'robuste (gagne dans les 3 scénarios)' : 'selon ta vue « ' + view.label + ' » — change si le marché fait autrement'}</div></td>`;
        h += `</tr>`;
      });
    });
    // Structurés de taux détenus (investedAmount > 0) : ce qu'ils rapportent selon le scénario (coupons conditionnels, rappel/cible)
    const held = _rateProducts().filter(p => (parseFloat(p.investedAmount) || 0) > 0);
    held.forEach(p => {
      const t = _productTerms(p), A = parseFloat(p.investedAmount) || 0;
      const per = scen.map(s => productValue(t, A, H, s.bp));
      const pv = viewIdx >= 0 ? per[viewIdx] : productValue(t, A, H, view.bp);
      h += `<tr style="border-bottom:1px solid var(--border);background:rgba(14,165,233,0.04)"><td style="padding:5px 6px"><strong>${p.name || '?'}</strong><div style="font-size:9px;color:var(--text-dim)">structuré de taux détenu · ${fmtE(A)}${t.barrier != null ? ' · coupon si TEC10 ≤ ' + fmtP(t.barrier) : ''}${t.isTarn ? ' · TARN' : t.isCallable ? ' · callable' : ''}</div></td>
        <td style="padding:5px 6px">✅ Garder<div style="font-size:9px;color:var(--text-dim)">pas de sortie chiffrable (marché secondaire) — coupons + capital selon scénario</div></td>`;
      per.forEach(v => { h += `<td style="padding:5px 6px;text-align:right;font-family:var(--mono);white-space:nowrap">${fmtE(v.value)}${v.liquid ? '' : ' 🔒'}<div style="font-size:9px;color:${v.notes.some(n => /perdu/.test(n)) ? 'var(--orange)' : 'var(--text-dim)'}">${v.notes.filter(n => /perdu|rembours|rappel|cible/.test(n)).join(' · ').slice(0, 70) || 'coupons versés'}</div></td>`; });
      h += `<td style="padding:5px 6px;font-size:10px;color:var(--text-muted)">${pv.notes.some(n => /perdu/.test(n)) ? '⚠ coupons à risque dans ta vue' : '✓ coupons dans ta vue'}</td></tr>`;
    });
    h += `</tbody></table></div><div style="font-size:10px;color:var(--text-dim);margin:6px 0 16px">Pénalités = colonne « Sortie » des paliers (progressifs) ou barème % servi (fixes), préavis à 0 % ; « sortir maintenant » replace sur la meilleure offre du jour à la durée restante ; « garder » et « échéance libre » replacent au CAT attendu (forward + spread) du scénario. Écarts en € vs « garder ».</div>`;

    // 3. nouveau cash
    const strat = scen.map(s => cashStrategies(S.cash, H, s.bp));
    const stratView = viewIdx >= 0 ? strat[viewIdx] : cashStrategies(S.cash, H, view.bp);
    h += `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px"><div style="font-size:12px;font-weight:700;color:var(--text-bright)">2 · Nouveau cash — progressif, fixe ou enchaînement ?</div><label style="font-size:11px">Montant <input type="number" value="${S.cash}" style="width:110px" onchange="window._catV4Set('cash',this.value)"></label></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:640px"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Scénario</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Meilleure stratégie à ${H} mois</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Montant final</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Meilleur produit unique</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Montant final</th></tr></thead><tbody>`;
    const rowsCash = scen.map((s, i) => ({ label: s.label, list: strat[i] }));
    if (viewIdx < 0) rowsCash.push({ label: '★ Ta vue (' + view.label + ' +' + view.bp + ' bp)', list: stratView, hi: true });
    rowsCash.forEach((s) => { const b = s.list[0], bs = s.list.find(x => x.single && !/⚠/.test(x.label)); if (!b) return;
      h += `<tr style="border-bottom:1px solid var(--border);${s.hi ? 'background:rgba(14,165,233,0.08);font-weight:600' : ''}"><td style="padding:5px 6px">${s.label}</td><td style="padding:5px 6px">${b.label}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">${fmtE(b.final)}</td><td style="padding:5px 6px">${bs ? bs.label : '—'}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${bs ? fmtE(bs.final) + ' <span style="font-size:9px;color:var(--text-dim)">(' + (bs.final - b.final >= 0 ? '+' : '−') + fmtE(Math.abs(bs.final - b.final)) + ')</span>' : ''}</td></tr>`; });
    h += `</tbody></table></div><div style="font-size:10px;color:var(--text-dim);margin:6px 0 16px">Si la meilleure stratégie est un enchaînement dont la 2e jambe ne bat le produit unique <em>que</em> dans le scénario « Hausse », c'est un pari sur une hausse au-delà du forward. Un progressif sorti à une échéance libre compte comme 1re jambe.</div>`;

    // 4. produits de taux : sélection dans la liste + produit libre
    const prods = _rateProducts();
    S.selected = S.selected || [];
    const selected = prods.filter(p => S.selected.includes(p.id));
    const c = S.callable;
    h += `<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px">3 · Structurés de taux vs meilleur CAT — coche 1 à 3 produits de ta liste (ou saisis un produit libre)</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${prods.map(p => { const t = _productTerms(p); const on = S.selected.includes(p.id); return `<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid ${on ? 'var(--green)' : 'var(--border)'};border-radius:6px;font-size:10px;cursor:pointer;background:${on ? 'rgba(6,214,160,0.08)' : 'var(--bg-elevated)'}"><input type="checkbox" ${on ? 'checked' : ''} onchange="window._catV4Toggle('${p.id}')"> ${(p.name || '?').substring(0, 34)}<span style="color:var(--text-dim)"> · ${fmtP(t.coupon)}${t.barrier != null ? ' si TEC10 ≤ ' + fmtP(t.barrier) : ''}${t.guaranteed ? ' · ' + t.guaranteed + ' a garantis' : ''}${t.isCallable ? ' · callable dès an ' + t.firstCall : t.isTarn ? ' · TARN cible ' + fmtP(t.target) : ''} · ${t.maturity} a${p.status === 'active' ? ' · détenu' : ''}</span></label>`; }).join('') || '<span style="font-size:10px;color:var(--text-dim)">aucun produit de taux à capital garanti dans la liste</span>'}</div>
      <details style="margin-bottom:8px"><summary style="font-size:10px;color:var(--text-muted);cursor:pointer">Produit libre (termes saisis à la main)</summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0;font-size:11px">
        <label>Coupon %/an <input type="number" step="0.05" value="${c.coupon}" onchange="window._catV4Set('callable.coupon',this.value)" style="width:100%"></label>
        <label>Années garanties / 1er call <input type="number" step="1" value="${c.guaranteed}" onchange="window._catV4Set('callable.guaranteed',this.value)" style="width:100%"></label>
        <label>Échéance (ans) <input type="number" step="1" value="${c.maturity}" onchange="window._catV4Set('callable.maturity',this.value)" style="width:100%"></label>
        <label title="Coupon payé seulement si TEC10 ≤ barrière. Vide = coupon fixe">Barrière TEC10 ≤ % <input type="number" step="0.05" value="${c.barrier}" placeholder="fixe" onchange="window._catV4Set('callable.barrier',this.value)" style="width:100%"></label>
        <label>Spread émetteur % <input type="number" step="0.1" value="${c.spread}" onchange="window._catV4Set('callable.spread',this.value)" style="width:100%"></label>
        <label>Commission % <input type="number" step="0.05" value="${c.fees}" onchange="window._catV4Set('callable.fees',this.value)" style="width:100%"></label>
        <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" ${c.enabled ? 'checked' : ''} onchange="window._catV4Set('callable.enabled',this.checked)"> inclure</label>
      </div></details>`;
    const cols = selected.map(p => ({ label: p.name, terms: _productTerms(p) }));
    if (c.enabled) cols.push({ label: 'Produit libre', terms: { coupon: parseFloat(c.coupon) || 0, maturity: parseInt(c.maturity, 10) || 1, inFine: false, isCallable: true, isTarn: false, firstCall: parseInt(c.guaranteed, 10) || 1, guaranteed: parseInt(c.guaranteed, 10) || 0, target: null, barrier: c.barrier === '' || c.barrier == null ? null : parseFloat(c.barrier), memory: false, fees: parseFloat(c.fees) || 0, spread: parseFloat(c.spread) || 0.6 } });
    if (cols.length) {
      h += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:640px"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Scénario</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Meilleur CAT à ${H} m</th>${cols.map(k => `<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">${(k.label || '').substring(0, 30)}</th>`).join('')}</tr></thead><tbody>`;
      const rowsP = scen.map((s, i) => ({ label: s.label, bp: s.bp, list: strat[i] }));
      if (viewIdx < 0) rowsP.push({ label: '★ Ta vue (' + view.label + ')', bp: view.bp, list: stratView, hi: true });
      rowsP.forEach((s) => { const b = s.list[0];
        h += `<tr style="border-bottom:1px solid var(--border);${s.hi ? 'background:rgba(14,165,233,0.08);font-weight:600' : ''}"><td style="padding:5px 6px">${s.label}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${b ? fmtE(b.final) : '—'}<div style="font-size:9px;color:var(--text-dim)">${b ? b.label.substring(0, 40) : ''}</div></td>`;
        cols.forEach(k => { const v = productValue(k.terms, S.cash, H, s.bp); const gap = b ? v.value - b.final : 0;
          h += `<td style="padding:5px 6px;text-align:right;font-family:var(--mono);vertical-align:top"><span style="font-weight:700;color:${gap >= 0 ? 'var(--green)' : 'var(--orange)'}">${fmtE(v.value)}</span>${v.liquid ? '' : ' <span title="capital non disponible à cet horizon" style="color:var(--orange)">🔒</span>'}<div style="font-size:9px;color:${gap >= 0 ? 'var(--green)' : 'var(--orange)'}">${(gap >= 0 ? '+' : '−') + fmtE(Math.abs(gap))} vs CAT</div><div style="font-size:9px;color:var(--text-dim);text-align:left;max-width:220px;white-space:normal">${v.notes.join(' · ')}</div></td>`; });
        h += `</tr>`; });
      h += `</tbody></table></div>`;
    }
    h += `<div style="font-size:10px;color:var(--text-dim);margin-top:6px">Lecture par mécanique : <strong>TARN</strong> — coupons garantis N ans puis payés si TEC10 ≤ barrière ; remboursé dès que le cumul atteint la cible → il se rembourse vite quand les taux <em>baissent</em>, et te laisse coincé (coupons perdus + capital immobilisé) quand ils <em>montent</em>. <strong>Callable</strong> — l'émetteur rappelle quand il peut se refinancer moins cher (coupon > forward + spread), donc en baisse ; sinon tu restes au coupon jusqu'à l'échéance. TEC10 projeté = TEC10 actuel (${cv.tec10 != null ? fmtP(cv.tec10) : '—'}) + dérive implicite du 10 ans + scénario. Coupons non réinvestis, commission déduite du nominal. 🔒 = capital non disponible à l'horizon : compare aussi à 36 et 60 mois.</div>`;
    h += `</div>`;
    host.innerHTML = h;
  }

  window._catV4Toggle = function(id) { S.selected = S.selected || []; const i = S.selected.indexOf(id); if (i >= 0) S.selected.splice(i, 1); else { if (S.selected.length >= 3) S.selected.shift(); S.selected.push(id); } render(); };
  window._catV4Set = function(key, val) {
    if (key.startsWith('callable.')) S.callable[key.split('.')[1]] = val === '' ? '' : val;
    else if (key === 'horizon') S.horizon = parseInt(val, 10) || 12;
    else if (key === 'view') S.view = val;
    else if (key === 'shift') S.shift = parseFloat(val) || 0;
    else if (key === 'cash') S.cash = parseFloat(val) || S.cash;
    render();
  };

  // ── Insertion : après la section Optimisation de la page CAT ─────
  if (typeof renderCAT === 'function') {
    const _o = renderCAT;
    renderCAT = function(container) {
      _o(container);
      try {
        if (document.getElementById('cat-v4-host')) return;
        const host = document.createElement('div'); host.id = 'cat-v4-host';
        let anchor = null;
        container.querySelectorAll('.section').forEach(sec => { const t = sec.querySelector('.section-title'); if (t && /Optimisa/i.test(t.textContent)) anchor = sec; });
        if (anchor) anchor.after(host); else container.appendChild(host);
        if (S.rates) render(); else { render(); github.readFile('data/market/rates.json').then(r => { S.rates = r; render(); }).catch(() => {}); }
      } catch (e) { console.error('[CAT v4]', e); }
    };
  }
})();

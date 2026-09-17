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

  const S = window._catV4State = window._catV4State || { horizon: 12, shift: 0, cash: 300000, callable: { coupon: 4.0, guaranteed: 2, maturity: 10, spread: 0.6, barrier: '', fees: 0 }, rates: null };
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

  // ── 4. Callable / TARN saisi ─────────────────────────────────────
  function callableValue(c, A, H, shiftBp) {
    // c: {coupon %/an, guaranteed (ans), maturity (ans), spread émetteur %, barrier TEC10 (≤) ou '', fees %/an}
    const years = Math.ceil(H / 12); const tec = _curve().tec10;
    let capital = A, coupons = 0, called = null, lostCoupons = 0, notes = [];
    for (let y = 1; y <= Math.min(years, c.maturity); y++) {
      // coupon de l'année y
      let paid = true;
      if (c.barrier !== '' && c.barrier != null && tec != null) {
        const drift = forward((y - 1) * 12, 120) - spot(120); // dérive du 10 ans implicite
        const tecY = tec + drift + (shiftBp || 0) / 100;
        paid = tecY <= parseFloat(c.barrier);
        if (!paid) lostCoupons++;
      }
      if (paid) coupons += A * (c.coupon - (c.fees || 0)) / 100;
      // rappel possible à partir de la fin des années garanties
      if (y >= c.guaranteed && y < c.maturity) {
        const mkt = forward(y * 12, (c.maturity - y) * 12) + (shiftBp || 0) / 100 + (c.spread || 0);
        if (c.coupon - mkt > 0.15) { called = y; break; } // l'émetteur se refinance moins cher → il rappelle
      }
    }
    let value = capital + coupons;
    let liquid = true;
    if (called != null && called * 12 < H) { const rest = H - called * 12; value = capital * Math.pow(1 + expectedCAT(called * 12, rest, shiftBp) / 100, rest / 12) + coupons; notes.push('rappelé fin année ' + called + ' → capital replacé au CAT attendu ' + fmtP(expectedCAT(called * 12, rest, shiftBp))); }
    else if (c.maturity * 12 > H) { liquid = false; notes.push(H <= c.guaranteed * 12 ? 'période garantie (rappel impossible avant l\'année ' + c.guaranteed + ') — compare aussi à ' + (c.guaranteed * 12 + 12) + ' et 60 mois' : 'non rappelé dans ce scénario : capital immobilisé jusqu\'à l\'échéance (' + c.maturity + ' ans) au coupon ' + fmtP(c.coupon)); }
    if (lostCoupons) notes.push(lostCoupons + ' coupon(s) perdu(s) : TEC10 scénario > barrière ' + c.barrier + ' %');
    return { value, called, liquid, notes, coupons };
  }

  // ── Rendu ────────────────────────────────────────────────────────
  const SCEN = [{ k: 'down', label: 'Baisse −50 bp', bp: -50 }, { k: 'fwd', label: 'Marché (forward)', bp: 0 }, { k: 'up', label: 'Hausse +50 bp', bp: 50 }];

  function render() {
    const host = document.getElementById('cat-v4-host'); if (!host) return;
    if (!S.rates) { host.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">Chargement de la courbe des taux…</div>'; return; }
    const H = S.horizon, cv = _curve();
    const shiftCustom = parseFloat(S.shift) || 0;
    const scen = SCEN.map(s => ({ ...s, bp: s.bp + shiftCustom }));
    let h = `<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#0EA5E9"></span>🧭 Décision v4 — courbe, pénalités, scénarios</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:11px">
        <label>Horizon <select id="v4-h" onchange="window._catV4Set('horizon',this.value)">${[6, 12, 18, 24, 36].map(m => `<option value="${m}" ${m === H ? 'selected' : ''}>${m} mois</option>`).join('')}</select></label>
        <label title="Décalage appliqué aux taux FUTURS dans tous les scénarios (ex. +25 si tu crois que la BCE ira plus loin que ce que la courbe anticipe)">Ma vue vs marché <input id="v4-shift" type="number" step="5" value="${shiftCustom}" style="width:60px" onchange="window._catV4Set('shift',this.value)"> bp</label>
      </div></div>`;

    // 1. vue taux
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">`;
    cv.nodes.forEach(n => { h += `<div style="padding:8px 10px;background:var(--bg-elevated);border-radius:6px"><div style="font-size:9px;color:var(--text-dim)">Courbe ${n[0]} m</div><div style="font-family:var(--mono);font-weight:700">${fmtP(n[1])}</div></div>`; });
    [[6, 6], [6, 12], [12, 12], [24, 12]].forEach(([s, l]) => { h += `<div style="padding:8px 10px;background:rgba(14,165,233,0.08);border-radius:6px"><div style="font-size:9px;color:var(--text-dim)">Forward ${l} m dans ${s} m</div><div style="font-family:var(--mono);font-weight:700;color:#0EA5E9">${fmtP(forward(s, l))}</div><div style="font-size:9px;color:var(--text-dim)">CAT attendu ${fmtP(expectedCAT(s, l, 0))}</div></div>`; });
    h += `</div><div style="font-size:10px;color:var(--text-muted);margin-bottom:14px">Courbe du ${cv.date || '?'} (Euribor + AAA). <strong>Forward</strong> = taux futur déjà anticipé par le marché ; « CAT attendu » = forward + spread moyen des offres CAT sur la courbe (${fmtP(catSpread(12))} à 12 m). Attendre ne gagne que si les taux montent <em>plus</em> que le forward. TEC10 ${cv.tec10 != null ? fmtP(cv.tec10) : '—'}.</div>`;

    // 2. placements existants
    const active = catManager.deposits.filter(d => d.status === 'active');
    h += `<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px">1 · Mes placements — montant à ${H} mois, brut, par scénario</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:760px"><thead><tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Placement</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Option</th>${scen.map(s => `<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">${s.label}${shiftCustom ? ' ' + (shiftCustom > 0 ? '+' : '') + shiftCustom : ''}</th>`).join('')}<th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Reco</th></tr></thead><tbody>`;
    active.forEach(d => {
      const per = scen.map(s => depositOptions(d, H, s.bp));
      const keys = Object.keys(per[1]);
      // reco = meilleure option dans le scénario marché ; robuste si meilleure dans les 3
      const bestKey = keys.reduce((b, k) => (!b || per[1][k].value > per[1][b].value) ? k : b, null);
      const robust = scen.every((s, i) => keys.reduce((b, k) => (!b || per[i][k].value > per[i][b].value) ? k : b, null) === bestKey);
      const labels = { keep: '✅ Garder', exitNow: '🔄 Sortir maintenant', exitFree: '⏳ Sortir à l\'échéance libre' };
      keys.forEach((k, j) => {
        h += `<tr style="border-bottom:1px solid var(--border);${k === bestKey ? 'background:rgba(6,214,160,0.06)' : ''}">`;
        if (j === 0) h += `<td rowspan="${keys.length}" style="padding:5px 6px;vertical-align:top"><strong>${d.productName || 'CAT'}</strong><div style="font-size:9px;color:var(--text-dim)">${d.bankName || ''} · ${d.entityName || ''} · ${fmtE(parseFloat(d.amount) || 0)}${d.maturityDate ? ' · éch. ' + formatDate(d.maturityDate) : ''}</div></td>`;
        h += `<td style="padding:5px 6px;${k === bestKey ? 'font-weight:700' : ''}" title="${per[1][k].label.replace(/"/g, '&quot;')}">${labels[k]}<div style="font-size:9px;color:var(--text-dim);font-weight:400">${per[1][k].label}</div></td>`;
        scen.forEach((s, i) => { const v = per[i][k].value, ref = per[i].keep.value; h += `<td style="padding:5px 6px;text-align:right;font-family:var(--mono);white-space:nowrap">${fmtE(v)}<div style="font-size:9px;color:${v - ref > 1 ? 'var(--green)' : v - ref < -1 ? 'var(--orange)' : 'var(--text-dim)'}">${k === 'keep' ? 'réf.' : (v - ref >= 0 ? '+' : '−') + fmtE(Math.abs(v - ref))}</div></td>`; });
        if (j === 0) h += `<td rowspan="${keys.length}" style="padding:5px 6px;vertical-align:top;font-size:11px">${labels[bestKey]}<div style="font-size:9px;color:${robust ? 'var(--green)' : 'var(--orange)'}">${robust ? 'robuste (gagne dans les 3 scénarios)' : 'dépend du scénario de taux'}</div></td>`;
        h += `</tr>`;
      });
    });
    h += `</tbody></table></div><div style="font-size:10px;color:var(--text-dim);margin:6px 0 16px">Pénalités = colonne « Sortie » des paliers (progressifs) ou barème % servi (fixes), préavis à 0 % ; « sortir maintenant » replace sur la meilleure offre du jour à la durée restante ; « garder » et « échéance libre » replacent au CAT attendu (forward + spread) du scénario. Écarts en € vs « garder ».</div>`;

    // 3. nouveau cash
    const strat = scen.map(s => cashStrategies(S.cash, H, s.bp));
    h += `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px"><div style="font-size:12px;font-weight:700;color:var(--text-bright)">2 · Nouveau cash — progressif, fixe ou enchaînement ?</div><label style="font-size:11px">Montant <input type="number" value="${S.cash}" style="width:110px" onchange="window._catV4Set('cash',this.value)"></label></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:640px"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Scénario</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Meilleure stratégie à ${H} mois</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Montant final</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Meilleur produit unique</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Montant final</th></tr></thead><tbody>`;
    scen.forEach((s, i) => { const b = strat[i][0], bs = strat[i].find(x => x.single && !/⚠/.test(x.label)); if (!b) return;
      h += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px 6px">${s.label}</td><td style="padding:5px 6px">${b.label}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">${fmtE(b.final)}</td><td style="padding:5px 6px">${bs ? bs.label : '—'}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${bs ? fmtE(bs.final) + ' <span style="font-size:9px;color:var(--text-dim)">(' + (bs.final - b.final >= 0 ? '+' : '−') + fmtE(Math.abs(bs.final - b.final)) + ')</span>' : ''}</td></tr>`; });
    h += `</tbody></table></div><div style="font-size:10px;color:var(--text-dim);margin:6px 0 16px">Si la meilleure stratégie est un enchaînement dont la 2e jambe ne bat le produit unique <em>que</em> dans le scénario « Hausse », c'est un pari sur une hausse au-delà du forward. Un progressif sorti à une échéance libre compte comme 1re jambe.</div>`;

    // 4. callable
    const c = S.callable;
    h += `<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px">3 · Callable / TARN à comparer (saisis les termes de l'offre)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:8px;font-size:11px">
        <label>Coupon %/an <input type="number" step="0.05" value="${c.coupon}" onchange="window._catV4Set('callable.coupon',this.value)" style="width:100%"></label>
        <label>Années garanties <input type="number" step="1" value="${c.guaranteed}" onchange="window._catV4Set('callable.guaranteed',this.value)" style="width:100%"></label>
        <label>Échéance (ans) <input type="number" step="1" value="${c.maturity}" onchange="window._catV4Set('callable.maturity',this.value)" style="width:100%"></label>
        <label title="Coupon payé seulement si TEC10 ≤ barrière (TARN). Vide = coupon fixe">Barrière TEC10 ≤ % <input type="number" step="0.05" value="${c.barrier}" placeholder="fixe" onchange="window._catV4Set('callable.barrier',this.value)" style="width:100%"></label>
        <label title="Spread de refinancement de l'émetteur au-dessus de la courbe : il rappelle si coupon > forward + spread">Spread émetteur % <input type="number" step="0.1" value="${c.spread}" onchange="window._catV4Set('callable.spread',this.value)" style="width:100%"></label>
        <label>Frais %/an <input type="number" step="0.05" value="${c.fees}" onchange="window._catV4Set('callable.fees',this.value)" style="width:100%"></label>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:640px"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Scénario</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Callable à ${H} m</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Meilleur CAT à ${H} m</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Écart</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Ce qui se passe</th></tr></thead><tbody>`;
    scen.forEach((s, i) => { const cv4 = callableValue({ ...c, coupon: parseFloat(c.coupon) || 0, guaranteed: parseInt(c.guaranteed, 10) || 0, maturity: parseInt(c.maturity, 10) || 1, spread: parseFloat(c.spread) || 0, fees: parseFloat(c.fees) || 0 }, S.cash, H, s.bp); const b = strat[i][0]; const gap = b ? cv4.value - b.final : 0;
      h += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px 6px">${s.label}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700">${fmtE(cv4.value)}${cv4.liquid ? '' : ' <span title="capital non disponible à cet horizon" style="color:var(--orange)">🔒</span>'}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${b ? fmtE(b.final) : '—'}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${gap >= 0 ? 'var(--green)' : 'var(--orange)'}">${(gap >= 0 ? '+' : '−') + fmtE(Math.abs(gap))}</td><td style="padding:5px 6px;font-size:10px;color:var(--text-muted)">${cv4.notes.join(' · ') || 'coupons ' + fmtE(cv4.coupons) + ' · non rappelé'}</td></tr>`; });
    h += `</tbody></table></div><div style="font-size:10px;color:var(--text-dim);margin-top:6px">Le callable est rappelé quand l'émetteur peut se refinancer moins cher (coupon > forward de la durée restante + spread émetteur) — donc surtout dans le scénario « Baisse » ; dans les scénarios « Marché » et « Hausse » tu restes coincé au coupon jusqu'à l'échéance (🔒). Coupons non réinvestis. Une barrière TEC10 teste le TEC10 projeté (TEC10 actuel + dérive implicite du 10 ans + scénario) chaque année. Un callable ne se compare pas à un CAT de 2 ans mais à ce que tu subis s'il n'est pas rappelé.</div>`;
    h += `</div>`;
    host.innerHTML = h;
  }

  window._catV4Set = function(key, val) {
    if (key.startsWith('callable.')) S.callable[key.split('.')[1]] = val === '' ? '' : val;
    else if (key === 'horizon') S.horizon = parseInt(val, 10) || 12;
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

// ═══════════════════════════════════════════════════════════════════
// CAT — Grille d'équivalence par horizon de sortie
// Compare fixes et progressifs à horizon de sortie ÉGAL : pour chaque
// produit, taux annualisé effectif si on sort au mois h (échéance = sortie
// libre ; en cours de période = conditions de retrait anticipé du produit).
// S'insère dans la section « Taux du Marché » (après cat-patches.js).
// ═══════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  const HORIZONS = [2, 3, 6, 9, 12, 18, 24, 36];

  // ── Parsing des conditions de retrait anticipé (fixes) ────────────
  // earlyExitSchedule: [{period:'Mois 1-3', penalty:'Pas de rémunération'}, ...]
  // Retourne la fraction du taux nominal servie si sortie au mois h (0..1), ou null si inconnu.
  function _fixedEarlyFactor(r, h) {
    const sched = Array.isArray(r.earlyExitSchedule) ? r.earlyExitSchedule : [];
    const parsePenalty = (txt) => {
      const t = String(txt || '').toLowerCase();
      if (/pas de p[ée]nalit/.test(t) || /sans p[ée]nalit/.test(t)) return 1;
      if (/pas de r[ée]mun|aucune r[ée]mun|sans r[ée]mun/.test(t)) return 0;
      const m = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (m) {
        const pct = parseFloat(m[1].replace(',', '.')) / 100;
        // « intérêts minorés de 90 % » / « pénalité de 30 % » = réduction → on sert 1 − x ;
        // « 50 % du taux de souscription » = fraction servie → x
        return /minor|r[ée]duc|p[ée]nalit[ée]s?\s+de|abattement|retenue/.test(t) ? Math.max(0, 1 - pct) : pct;
      }
      return null;
    };
    const hasMonths = (p) => /\d/.test(p);
    for (const s of sched) {
      const p = String(s.period || '');
      const rng = p.match(/(\d+)\s*[-–à]\s*(\d+)/);
      const single = !rng && p.match(/(\d+)/);
      const a = rng ? parseInt(rng[1], 10) : single ? parseInt(single[1], 10) : null;
      const b = rng ? parseInt(rng[2], 10) : a;
      if (a != null && h >= a && h <= b) return parsePenalty(s.penalty);
    }
    if (sched.some(s => hasMonths(String(s.period || '')))) return null; // plages explicites, h hors plages → inconnu
    // Condition générique (« Sortie anticipée ») → s'applique à tout h < durée
    const generic = sched.find(s => !hasMonths(String(s.period || '')));
    if (generic) return parsePenalty(generic.penalty);
    // Repli sur le texte libre
    if (r.withdrawalConditions) return parsePenalty(r.withdrawalConditions);
    return null;
  }

  // ── Taux effectif annualisé si sortie au mois h ───────────────────
  // Retourne { rate, kind } avec kind ∈ 'free' (échéance, sans frais), 'penalty'
  // (retrait anticipé), 'roll' (au-delà de la durée : hypothèse renouvellement
  // au même taux), 'na' (inconnu).
  function _effectiveRate(r, h) {
    const D = parseInt(r.durationMonths, 10) || 0;
    const nominal = parseFloat(r.rate) || 0;
    const sched = Array.isArray(r.rateSchedule) ? r.rateSchedule : [];
    const isProg = r.rateType === 'progressif' && sched.length > 0;

    if (!isProg) {
      if (h === D) return { rate: nominal, kind: 'free' };
      if (h > D) return { rate: null, kind: 'na' };
      const f = _fixedEarlyFactor(r, h);
      if (f == null) return { rate: null, kind: 'na' };
      return { rate: nominal * f, kind: 'penalty' };
    }

    // Progressif : somme des intérêts mois par mois jusqu'à h
    if (h > D) return { rate: null, kind: 'na' }; // au-delà de la durée : pas d'hypothèse de renouvellement
    let growth = 1, kind = 'penalty', periodRate = null, nextRate = null;
    for (let i = 0; i < sched.length; i++) {
      const s = sched[i];
      const from = parseInt(s.fromMonth, 10), to = parseInt(s.toMonth, 10);
      const rate = parseFloat(s.rate) || 0;
      if (h >= to) { growth *= Math.pow(1 + rate / 100, (to - from + 1) / 12); if (h === to) { kind = 'free'; periodRate = rate; nextRate = sched[i + 1] ? parseFloat(sched[i + 1].rate) || null : null; } continue; }
      if (h >= from) {
        // Sortie en cours de période → earlyRate si connu, sinon 50 % du taux
        const early = s.earlyRate != null ? parseFloat(s.earlyRate) : rate * 0.5;
        growth *= Math.pow(1 + early / 100, (h - from + 1) / 12);
        periodRate = rate; nextRate = sched[i + 1] ? parseFloat(sched[i + 1].rate) || null : null;
        break;
      }
    }
    // Taux actuariel annualisé (capitalisation à chaque palier) = convention « taux actuariel moyen » des banques
    return { rate: (Math.pow(growth, 12 / h) - 1) * 100, kind, periodRate, nextRate };
  }

  window._catFixedEarlyFactor = _fixedEarlyFactor;

  function _fmt(x) { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + '%'; }

  function _shortName(r, multiBank) {
    const n = (r.productName || (r.durationMonths + 'm')).replace(/^CAT\s+/i, '');
    return (multiBank ? (r.bankName || r.bankId) + ' · ' : '') + n;
  }

  // ── Rendu ─────────────────────────────────────────────────────────
  window._renderCATHorizonGrid = function(rates) {
    const list = (rates || []).filter(r => r.productType !== 'parts-sociales' && (parseFloat(r.rate) || 0) > 0);
    if (list.length < 2) return '';
    const banks = new Set(list.map(r => r.bankId));
    const multiBank = banks.size > 1;
    // Colonnes : par durée croissante, fixes avant progressifs à durée égale
    let cols = [...list].sort((a, b) => (a.durationMonths - b.durationMonths) || ((a.rateType === 'progressif') - (b.rateType === 'progressif')));
    // Banque à grille fine (ex. SG : 24 maturités) → ne garder que les durées repères, sinon illisible
    if (cols.length > 8) cols = cols.filter(c => HORIZONS.includes(parseInt(c.durationMonths, 10)) || c.rateType === 'progressif');
    const maxD = Math.max(...cols.map(c => parseInt(c.durationMonths, 10) || 0));
    const rows = HORIZONS.filter(h => h <= maxD);
    // Ajouter les bornes de périodes des progressifs (échéances de sortie libre)
    cols.forEach(c => (c.rateSchedule || []).forEach(s => { const t = parseInt(s.toMonth, 10); if (t && t <= maxD && !rows.includes(t)) rows.push(t); }));
    rows.sort((a, b) => a - b);

    let html = `<div style="margin-top:16px;padding-top:14px;border-top:1px dashed var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright)">⚖️ Équivalence par horizon de sortie</div>
        <div style="font-size:10px;color:var(--text-dim)">Taux annualisé brut si tu sors au mois indiqué · <strong style="color:var(--green)">vert</strong> = meilleur · gras = échéance (sortie libre) · <span style="color:var(--orange)">orange</span> = retrait anticipé (pénalité du produit) · — = au-delà de la durée du produit · progressifs : taux = <em>actuariel moyen depuis le départ</em>, « palier » = taux de la période en cours → suivant · sous chaque taux : <strong>intérêts bruts gagnés sur 100 k€</strong> pendant la période</div>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:${Math.max(420, 110 + cols.length * 92)}px">
      <thead><tr><th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);white-space:nowrap">Sortie au mois</th>`;
    cols.forEach(c => {
      const prog = c.rateType === 'progressif' && (c.rateSchedule || []).length > 0;
      html += `<th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);white-space:nowrap" title="${(c.withdrawalConditions || '').replace(/"/g, '&quot;')}">${_shortName(c, multiBank)}${prog ? ' <span style="font-size:9px">📈</span>' : ''}<div style="font-size:9px;color:var(--text-dim);font-weight:400">${c.durationMonths}m · ${_fmt(parseFloat(c.rate))}${prog ? ' moy.' : ''}</div></th>`;
    });
    html += `</tr></thead><tbody>`;

    rows.forEach(h => {
      const cells = cols.map(c => _effectiveRate(c, h));
      // Meilleur = parmi les cellules « réelles » (échéance ou pénalité), pas les renouvellements hypothétiques
      let best = -Infinity;
      cells.forEach(x => { if (x.rate != null && x.kind !== 'roll' && x.rate > best) best = x.rate; });
      html += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 8px;font-weight:600;color:var(--text-bright);white-space:nowrap">${h} mois</td>`;
      cells.forEach(x => {
        let style = 'text-align:right;padding:6px 8px;font-family:var(--mono);white-space:nowrap;', txt = '—', title = '';
        if (x.rate == null) { style += 'color:var(--text-dim);'; title = 'conditions de sortie inconnues'; }
        else {
          txt = _fmt(x.rate);
          const isBest = x.kind !== 'roll' && Math.abs(x.rate - best) < 1e-9;
          if (x.kind === 'free') { style += 'font-weight:700;'; title = 'échéance : sortie sans frais ni préavis'; }
          else if (x.kind === 'penalty') { style += 'color:var(--orange);'; title = 'retrait anticipé : conditions du produit appliquées'; }
          else if (x.kind === 'roll') { style += 'opacity:.55;'; txt = '↻ ' + txt; title = 'au-delà de la durée : hypothèse renouvellement au même taux'; }
          if (isBest) style += 'color:var(--green);background:rgba(6,214,160,0.08);';
          const eur = Math.round(100000 * (Math.pow(1 + x.rate / 100, h / 12) - 1));
          txt += `<div style="font-size:9px;font-weight:400;opacity:.7">+${eur.toLocaleString('fr-FR')} €</div>`;
          if (x.periodRate != null) txt += `<div style="font-size:9px;font-weight:400;color:var(--text-dim)">palier ${_fmt(x.periodRate)}${x.nextRate != null ? ' → ' + _fmt(x.nextRate) + ' ensuite' : ''}</div>`;
        }
        html += `<td style="${style}" title="${title}">${txt}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:6px">Lecture : à 6 mois, un progressif 18 m sorti à la fin du semestre 1 rapporte le taux du S1 (sortie libre) — à comparer directement au fixe 6 m. En cours de période, les progressifs servent le taux de retrait anticipé (50 % du taux en S1/A1, taux de la période précédente ensuite) et exigent un préavis de 32 jours (non déduit ici). Taux actuariels, base 30/360 approximée en mois entiers. Les € indiqués = intérêts bruts sur 100 k€ jusqu'au mois de sortie, en convention actuarielle (capitalisation : 100 k€ × ((1 + taux)^(mois/12) − 1)) ; les paliers des progressifs se capitalisent entre eux.</div>
    </div>`;
    return html;
  };

  // ── Grille comparative toutes banques ─────────────────────────────
  // Par horizon de sortie : le meilleur produit de CHAQUE banque, et le gagnant.
  window._renderCATBankCompare = function(byBank) {
    const banks = Object.entries(byBank).filter(([, list]) => list.length > 0);
    if (banks.length < 2) return '';
    const maxD = Math.max(...banks.flatMap(([, l]) => l.map(r => parseInt(r.durationMonths, 10) || 0)));
    const rows = HORIZONS.filter(h => h <= maxD);
    let html = `<div style="margin-bottom:18px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright)">🏆 Comparatif banques par horizon de sortie</div>
        <div style="font-size:10px;color:var(--text-dim)">Meilleur produit de chaque banque si tu sors au mois indiqué · taux annualisé brut + intérêts sur 100 k€ · gras = échéance (sortie libre) · <span style="color:var(--orange)">orange</span> = retrait anticipé · hors produits Transition</div>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:${Math.max(420, 200 + banks.length * 150)}px">
      <thead><tr><th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">Sortie au mois</th>`;
    banks.forEach(([, list]) => { html += `<th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);white-space:nowrap">${list[0].bankName || list[0].bankId}</th>`; });
    html += `<th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);white-space:nowrap">Gagnant</th></tr></thead><tbody>`;
    rows.forEach(h => {
      const bests = banks.map(([, list]) => {
        let best = null;
        list.forEach(r => { const x = _effectiveRate(r, h); if (x.rate == null) return; if (!best || x.rate > best.rate || (x.rate === best.rate && x.kind === 'free' && best.kind !== 'free')) best = { rate: x.rate, kind: x.kind, r, periodRate: x.periodRate, nextRate: x.nextRate }; });
        return best;
      });
      const top = bests.reduce((m, b) => (b && (!m || b.rate > m.rate)) ? b : m, null);
      html += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 8px;font-weight:600;color:var(--text-bright);white-space:nowrap">${h} mois</td>`;
      bests.forEach(b => {
        if (!b) { html += `<td style="text-align:right;padding:7px 8px;color:var(--text-dim)">—</td>`; return; }
        const isTop = top && b === top;
        const eur = Math.round(100000 * (Math.pow(1 + b.rate / 100, h / 12) - 1));
        const color = b.kind === 'penalty' ? 'var(--orange)' : 'var(--text-bright)';
        html += `<td style="text-align:right;padding:7px 8px;white-space:nowrap;${isTop ? 'background:rgba(6,214,160,0.08);' : ''}" title="${(b.r.withdrawalConditions || '').replace(/"/g, '&quot;')}">
          <div style="font-family:var(--mono);font-weight:${b.kind === 'free' ? 700 : 400};color:${isTop ? 'var(--green)' : color}">${_fmt(b.rate)} <span style="font-size:9px;font-weight:400;opacity:.7">+${eur.toLocaleString('fr-FR')} €</span></div>
          <div style="font-size:9px;color:var(--text-dim)">${_shortName(b.r, false)}${b.kind === 'penalty' ? ' · anticipé' : ''}${b.periodRate != null ? ' · palier ' + _fmt(b.periodRate) + (b.nextRate != null ? ' → ' + _fmt(b.nextRate) : '') : ''}</div></td>`;
      });
      html += `<td style="padding:7px 8px;font-size:11px;white-space:nowrap">${top ? '<strong style="color:var(--green)">' + (top.r.bankName || top.r.bankId) + '</strong> <span style="color:var(--text-dim)">' + _shortName(top.r, false) + '</span>' : '—'}</td></tr>`;
    });
    html += `</tbody></table></div></div>`;
    return html;
  };


  // ── Simulateur « combien j'aurai après X mois » ───────────────────
  // Compare le MONTANT FINAL de toutes les stratégies sur un horizon donné :
  //   • un produit unique tenu jusqu'à l'horizon (échéance ou sortie anticipée, signalée)
  //   • un enchaînement A → B (toutes banques) : A sorti à une échéance libre, puis B
  //     sur la durée restante — au taux d'aujourd'hui, ou au taux de réinvestissement saisi
  window._catSimState = window._catSimState || { amount: 300000, horizon: 12, reinvest: '' };

  function _finalAmount(amount, rate, months) { return amount * Math.pow(1 + rate / 100, months / 12); }

  window._renderCATHorizonSim = function(rates) {
    const st = window._catSimState;
    const list = (rates || []).filter(r => r.productType !== 'parts-sociales' && (parseFloat(r.rate) || 0) > 0);
    if (!list.length) return '';
    const H = parseInt(st.horizon, 10) || 12, A = parseFloat(st.amount) || 0;
    const reinvest = st.reinvest === '' || st.reinvest == null ? null : parseFloat(st.reinvest);
    const name = (r) => (r.bankName || r.bankId) + ' ' + (r.productName || (r.durationMonths + 'm')).replace(/^CAT\s+/i, '');
    const strategies = [];

    // 1) produit unique jusqu'à H
    list.forEach(r => {
      const x = _effectiveRate(r, H);
      if (x.rate == null) return;
      strategies.push({ label: name(r), legs: [{ r, months: H, kind: x.kind, rate: x.rate }], final: _finalAmount(A, x.rate, H), flags: x.kind === 'penalty' ? ['sortie anticipée ' + name(r)] : [] });
    });
    // 2) enchaînement A (échéance libre à d1 < H) → B (H − d1)
    list.forEach(a => {
      for (let d1 = 1; d1 < H; d1++) {
        const xa = _effectiveRate(a, d1);
        if (xa.rate == null || xa.kind !== 'free') continue;
        const rest = H - d1;
        const mid = _finalAmount(A, xa.rate, d1);
        if (reinvest != null) {
          strategies.push({ label: name(a) + ' (' + d1 + ' m) → réinvesti à ' + _fmt(reinvest) + ' (' + rest + ' m)', legs: [{ r: a, months: d1, kind: 'free', rate: xa.rate }, { months: rest, rate: reinvest, manual: true }], final: _finalAmount(mid, reinvest, rest), flags: ['2e jambe au taux saisi'] });
        }
        list.forEach(b => {
          const xb = _effectiveRate(b, rest);
          if (xb.rate == null) return;
          const flags = ['2e jambe au taux d\'aujourd\'hui (hypothèse)'];
          if (xb.kind === 'penalty') flags.push('sortie anticipée ' + name(b));
          strategies.push({ label: name(a) + ' (' + d1 + ' m) → ' + name(b) + ' (' + rest + ' m)', legs: [{ r: a, months: d1, kind: 'free', rate: xa.rate }, { r: b, months: rest, kind: xb.kind, rate: xb.rate }], final: _finalAmount(mid, xb.rate, rest), flags });
        });
      }
    });
    // dédoublonner (même chemin), trier, garder les meilleures
    const seen = new Set();
    const ranked = strategies.filter(s => { if (seen.has(s.label)) return false; seen.add(s.label); return true; }).sort((x, y) => y.final - x.final);
    const top = ranked.slice(0, 12);
    const best = top[0];
    const bestSingle = ranked.find(s => s.legs.length === 1 && s.legs[0].kind === 'free');

    let html = `<div style="margin-bottom:18px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright)">🎯 Combien j'aurai après X mois</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px">
          <label>Montant <input id="cs-amount" type="number" value="${A}" style="width:110px" onchange="window._catSimUpdate()"></label>
          <label>Horizon <select id="cs-horizon" onchange="window._catSimUpdate()">${[3, 6, 9, 12, 18, 24, 36].map(m => `<option value="${m}" ${m === H ? 'selected' : ''}>${m} mois</option>`).join('')}</select></label>
          <label title="Taux annualisé appliqué à la 2e jambe si tu anticipes une hausse (ex. 3,4). Vide = offres d'aujourd'hui">Réinvest. 2e jambe % <input id="cs-reinvest" type="number" step="0.05" value="${st.reinvest ?? ''}" placeholder="auto" style="width:70px" onchange="window._catSimUpdate()"></label>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px">Montant final brut (actuariel) pour ${_fmtEur(A)} sur ${H} mois. Produit unique, ou enchaînement A → B toutes banques (A sorti à une échéance libre). ⚠ = sortie anticipée avec la pénalité du produit. La 2e jambe suppose les offres d'aujourd'hui, sauf si tu saisis un taux de réinvestissement.</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:560px"><thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:5px 6px;color:var(--text-muted);font-weight:600">#</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted);font-weight:600">Stratégie</th>
        <th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:600">Montant final</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:600">Intérêts bruts</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:600">Net IS 25 %</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:600">Taux annualisé</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:600">vs meilleur</th></tr></thead><tbody>`;
    top.forEach((s, i) => {
      const int = s.final - A, ann = (Math.pow(s.final / A, 12 / H) - 1) * 100, gap = s.final - best.final;
      const warn = s.flags.some(f => /anticipée/.test(f));
      html += `<tr style="border-bottom:1px solid var(--border);${i === 0 ? 'background:rgba(6,214,160,0.08);' : ''}" title="${s.flags.join(' · ').replace(/"/g, '&quot;')}">
        <td style="padding:5px 6px;color:var(--text-dim)">${i + 1}</td>
        <td style="padding:5px 6px">${s.label}${warn ? ' <span style="color:var(--orange)">⚠</span>' : ''}${s.legs.length > 1 && !s.legs[1].manual ? ' <span style="font-size:9px;color:var(--text-dim)">(2e jambe : taux du jour)</span>' : ''}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:${i === 0 ? 'var(--green)' : 'var(--text-bright)'}">${_fmtEur(s.final)}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono)">+${_fmtEur(int)}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#06D6A0">+${_fmtEur(int * 0.75)}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${_fmt(ann)}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:${gap < 0 ? 'var(--orange)' : 'var(--green)'}">${gap < 0 ? '−' + _fmtEur(-gap) : '—'}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    if (best && bestSingle && best !== bestSingle) html += `<div style="font-size:10px;color:var(--text-muted);margin-top:6px">Meilleur produit unique sans pénalité : <strong>${bestSingle.label}</strong> → ${_fmtEur(bestSingle.final)} (−${_fmtEur(best.final - bestSingle.final)} vs l'enchaînement n°1, qui dépend du taux de la 2e jambe).</div>`;
    html += `</div>`;
    return html;
  };
  function _fmtEur(n) { return Math.round(n).toLocaleString('fr-FR') + ' €'; }
  window._catSimUpdate = function() {
    const st = window._catSimState;
    st.amount = parseFloat(document.getElementById('cs-amount')?.value) || st.amount;
    st.horizon = parseInt(document.getElementById('cs-horizon')?.value, 10) || st.horizon;
    const rv = document.getElementById('cs-reinvest')?.value; st.reinvest = rv === '' || rv == null ? '' : parseFloat(rv);
    const host = document.getElementById('cat-sim-host'); if (!host) return;
    const rates = (catManager.rates?.rates || []).filter(r => r.source !== 'web scan' && !(typeof _isRateExpired === 'function' && _isRateExpired(r)) && !_isTransition(r));
    host.innerHTML = window._renderCATHorizonSim(rates);
  };

  // ── Insertion dans le bloc dépliant de chaque banque ─────────────
  // Une grille par banque, à l'intérieur de #bank-rates-confirmed-<bankId>,
  // hors produits « Transition » (offre fléchée RSE, comparée à part).
  function _isTransition(r) {
    return String(r.category || '').toLowerCase() === 'transition' || /transition/i.test(String(r.productName || ''));
  }

  if (typeof renderCAT === 'function') {
    const _prevRenderCAT = renderCAT;
    renderCAT = function(container) {
      _prevRenderCAT(container);
      try {
        const confirmed = (catManager.rates?.rates || []).filter(r => r.source !== 'web scan' && !(typeof _isRateExpired === 'function' && _isRateExpired(r)) && !_isTransition(r));
        const byBank = {};
        confirmed.forEach(r => { const k = r.bankId || 'autre'; (byBank[k] = byBank[k] || []).push(r); });
        // Comparatif toutes banques, juste sous l'en-tête de la section « Taux du Marché »
        let target = null;
        container.querySelectorAll('.section').forEach(sec => { const t = sec.querySelector('.section-title'); if (t && t.textContent.includes('Taux du Marché')) target = sec; });
        const cmp = target ? window._renderCATBankCompare(byBank) : '';
        if (cmp) { const hdr = target.querySelector('.section-header'); if (hdr) hdr.insertAdjacentHTML('afterend', cmp + '<div id="cat-sim-host">' + window._renderCATHorizonSim(confirmed) + '</div>'); }
        Object.entries(byBank).forEach(([bankId, list]) => {
          if (list.length < 2) return;
          const host = container.querySelector('#bank-rates-confirmed-' + bankId);
          if (!host) return;
          const html = window._renderCATHorizonGrid(list);
          if (html) host.insertAdjacentHTML('beforeend', '<div style="padding:0 14px 14px">' + html + '</div>');
        });
      } catch (e) { console.error('[CATHorizonGrid]', e); }
    };
  }
})();

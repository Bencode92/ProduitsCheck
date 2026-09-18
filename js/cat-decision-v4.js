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


  // ── Concentration par GROUPE bancaire (expert 17/09 : plafond 30-35 % de la trésorerie liquide par groupe,
  //    aucun flux nouveau vers un groupe au-dessus du plafond ; BPCE = Banque Populaire + Natixis + Caisse d'Épargne)
  const GROUPS = { 'banque-populaire': 'BPCE', 'natixis': 'BPCE', 'caisse-epargne': 'BPCE', 'bpce': 'BPCE', 'cic': 'Crédit Mutuel Alliance Fédérale', 'credit-mutuel': 'Crédit Mutuel Alliance Fédérale', 'sg': 'Société Générale', 'societe-generale': 'Société Générale', 'bnp': 'BNP Paribas', 'bnpp': 'BNP Paribas', 'ca': 'Crédit Agricole', 'ca-cib': 'Crédit Agricole', 'lcl': 'Crédit Agricole', 'lbp': 'La Banque Postale', 'hsbc': 'HSBC', 'swiss-life': 'Swiss Life' };
  const GROUP_CAP = 0.35;
  function _groupOf(x) {
    const k = String(x || '').toLowerCase();
    if (GROUPS[k]) return GROUPS[k];
    if (/populaire|natixis|epargne|bpce/.test(k)) return 'BPCE';
    if (/cic|cr[ée]dit industriel|mutuel/.test(k)) return 'Crédit Mutuel Alliance Fédérale';
    if (/soci[ée]t[ée] g[ée]n[ée]rale|\bsg\b/.test(k)) return 'Société Générale';
    if (/bnp/.test(k)) return 'BNP Paribas';
    if (/agricole|lcl/.test(k)) return 'Crédit Agricole';
    return x || '—';
  }
  function groupExposure() {
    const by = {}; let total = 0;
    catManager.deposits.filter(d => d.status === 'active').forEach(d => { const g = _groupOf(d.bankId || d.bankName), a = parseFloat(d.amount) || 0; by[g] = (by[g] || 0) + a; total += a; });
    _rateProducts().filter(p => (parseFloat(p.investedAmount) || 0) > 0).forEach(p => { const g = _groupOf(p.emitter || p.bankId), a = parseFloat(p.investedAmount) || 0; by[g] = (by[g] || 0) + a; total += a; });
    return { by, total };
  }

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
    let coupons = 0, cum = 0, redeemedYear = null, lost = 0, memoryBank = 0, cash = 0, accrued = 0;
    for (let y = 1; y <= Math.min(years, Math.ceil(t.maturity)); y++) {
      let paid = true;
      if (t.barrier != null && y > t.guaranteed && tec != null) {
        const tecY = tec + (forward((y - 1) * 12, 120) - spot(120)) + (shiftBp || 0) / 100;
        paid = tecY <= t.barrier;
      }
      if (paid) {
        const cpn = A * t.coupon / 100 * (1 + (t.memory ? memoryBank : 0)); cum += t.coupon * (1 + (t.memory ? memoryBank : 0)); memoryBank = 0;
        if (t.inFine) { accrued += cpn; coupons += cpn; }
        else {
          // coupon ENCAISSÉ fin d'année y → replacé au CAT attendu du scénario jusqu'à l'horizon
          const rest = Math.max(0, H - y * 12);
          const grown = rest > 0 ? cpn * Math.pow(1 + expectedCAT(y * 12, rest, shiftBp) / 100, rest / 12) : cpn;
          cash += cpn; coupons += grown;
        }
      }
      else { lost++; if (t.memory) memoryBank++; }
      if (t.isTarn && t.target && cum >= t.target - 1e-9) { redeemedYear = y; notes.push('cible ' + fmtP(t.target) + ' atteinte → remboursé fin année ' + y); break; }
      if (t.isCallable && t.firstCall != null && y >= t.firstCall && y < t.maturity) {
        const mkt = forward(y * 12, (t.maturity - y) * 12) + (shiftBp || 0) / 100 + t.spread;
        if (t.coupon - mkt > 0.15) { redeemedYear = y; notes.push('rappelé par l\'émetteur fin année ' + y + ' (coupon ' + fmtP(t.coupon) + ' > marché ' + fmtP(mkt) + ')'); break; }
      }
    }
    let value = A * (1 - t.fees / 100) + coupons, liquid = true, mtm = null;
    if (redeemedYear == null && t.maturity * 12 > H) {
      // Valeur de marché estimée à l'horizon : flux restants (coupons attendus + capital) actualisés au taux
      // sans risque de la durée restante + spread émetteur + scénario (réserve n°1 de l'expert : c'est le seul
      // chiffre qui compte si le scénario tourne mal et qu'il faut sortir)
      const restY = Math.max(0.25, t.maturity - years); const disc = (spot(Math.round(restY * 12)) + (shiftBp || 0) / 100 + t.spread) / 100;
      let pv;
      if (t.inFine) pv = (A * (1 + t.coupon / 100 * t.maturity)) * Math.pow(1 + disc, -restY); // in fine : nominal + gain total à l'échéance
      else { pv = A * Math.pow(1 + disc, -restY); for (let k = 1; k <= Math.ceil(restY); k++) { const yy = years + k; let paidK = true; if (t.barrier != null && yy > t.guaranteed && tec != null) paidK = (tec + (forward((yy - 1) * 12, 120) - spot(120)) + (shiftBp || 0) / 100) <= t.barrier; if (paidK) pv += A * t.coupon / 100 * Math.pow(1 + disc, -Math.min(k, restY)); } }
      mtm = Math.round(pv * 0.99); // fourchette de reprise ~1 %
    }
    if (redeemedYear != null && redeemedYear * 12 < H) { const rest = H - redeemedYear * 12; value = A * (1 - t.fees / 100) * Math.pow(1 + expectedCAT(redeemedYear * 12, rest, shiftBp) / 100, rest / 12) + coupons; notes.push('capital replacé au CAT attendu ' + fmtP(expectedCAT(redeemedYear * 12, rest, shiftBp)) + ' sur ' + rest + ' m'); }
    else if (t.maturity * 12 > H && redeemedYear == null) { liquid = false; notes.push(H <= (t.isCallable ? (t.firstCall || 1) : t.guaranteed) * 12 ? 'période garantie / non rappelable — juge aussi à ' + Math.min(60, Math.round(t.maturity * 12)) + ' m' : (t.isTarn ? 'cible non atteinte : coupons conditionnels, capital immobilisé jusqu\'à ' + t.maturity + ' ans' : t.isCallable ? 'non rappelé : coincé au coupon ' + fmtP(t.coupon) + ' jusqu\'à ' + t.maturity + ' ans' : 'capital immobilisé jusqu\'à l\'échéance (' + t.maturity + ' ans)')); }
    if (lost) notes.push(lost + ' coupon(s) perdu(s) (taux scénario > barrière ' + fmtP(t.barrier) + ')' + (t.memory ? ' — mémoire' : ''));
    if (t.inFine && !redeemedYear && accrued > 0) notes.push('0 € encaissé : ' + fmtE(accrued) + ' acquis mais versés seulement au remboursement');
    else if (!t.inFine && cash > 0) notes.push(fmtE(cash) + ' encaissés en coupons, replacés au CAT attendu');
    if (t.fees) notes.push('commission ' + fmtP(t.fees) + ' déduite');
    if (mtm != null) notes.push('valeur de marché estimée si sortie à ' + H + ' m ≈ ' + fmtE(mtm) + (mtm < A ? ' (−' + fmtE(A - mtm) + ' vs nominal)' : ''));
    return { value, liquid, notes, coupons, redeemedYear, mtm, cash: t.inFine && !redeemedYear ? 0 : cash + (redeemedYear ? accrued : 0), accrued };
  }

  // ── Rendu ────────────────────────────────────────────────────────
  const SCEN = [{ k: 'down', label: 'Baisse −50 bp', bp: -50 }, { k: 'fwd', label: 'Marché (forward)', bp: 0 }, { k: 'up', label: 'Hausse +50 bp', bp: 50 }];

  // ── Rendu : un FLUX de décision ─────────────────────────────────
  //   entrées (montant · échéance visée · ma vue · structurés à comparer)
  //   → A. où placer ce montant (CAT et structurés dans UN classement, avis IA)
  //   → B. quel CAT existant mérite d'être arbitré (une ligne par contrat)
  //   → détails repliés (scénarios complets, courbe)
  const labelsOpt = { keep: '✅ Garder', exitNow: '🔄 Sortir maintenant', exitFree: '⏳ Sortir à l\'échéance libre' };

  function render() {
    const host = document.getElementById('cat-v4-host'); if (!host) return;
    if (!S.rates) { host.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">Chargement de la courbe des taux…</div>'; return; }
    const H = S.horizon, cv = _curve(); let A = S.cash;
    const view = VIEWS.find(v => v.k === S.view) || VIEWS[1];
    const scen = SCEN.slice();
    const viewIdx = view.bp <= -25 ? 0 : view.bp >= 50 ? 2 : view.bp > 0 ? -1 : 1;
    const prods = _rateProducts(); S.selected = S.selected || [];
    const selected = prods.filter(p => S.selected.includes(p.id));

    // ── Échéances à replacer : l'outil pointe ce qui tombe (échu ou < 90 j), tu le prends, il arbitre CE montant ──
    const now = new Date(), soon = new Date(now.getTime() + 90 * DAY);
    const maturing = catManager.deposits.filter(d => d.status === 'active' && d.maturityDate && new Date(d.maturityDate) <= soon).sort((a, b) => new Date(a.maturityDate) - new Date(b.maturityDate));
    S.sourceIds = (S.sourceIds || []).filter(id => maturing.some(d => d.id === id));
    const srcDeps = maturing.filter(d => S.sourceIds.includes(d.id));
    const srcAmount = srcDeps.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
    if (srcDeps.length) S.cash = srcAmount;
    A = S.cash; const A0 = A;
    let h = `<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#0EA5E9"></span>🧭 Replacer une échéance, et quel CAT arbitrer</div><span style="font-size:10px;color:var(--text-dim)">courbe du ${cv.date || '?'} · TEC10 ${cv.tec10 != null ? fmtP(cv.tec10) : '—'} · meilleur CAT ${fmtP(todayRate(12).rate)} (12 m)</span></div>`;
    if (maturing.length) {
      h += `<div style="padding:10px 12px;border:1px solid rgba(232,93,4,0.35);border-radius:8px;background:rgba(232,93,4,0.05);margin-bottom:10px"><div style="font-size:11px;font-weight:700;color:var(--orange);margin-bottom:6px">📅 Échéances à replacer (échues ou sous 90 jours) — coche celles que tu replaces, le montant suit</div><div style="display:flex;flex-wrap:wrap;gap:6px">`;
      maturing.forEach(d => { const days = Math.round((new Date(d.maturityDate) - now) / DAY), on = S.sourceIds.includes(d.id);
        h += `<label style="display:flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid ${on ? 'var(--orange)' : 'var(--border)'};border-radius:6px;font-size:11px;cursor:pointer;background:${on ? 'rgba(232,93,4,0.10)' : 'var(--bg-elevated)'}"><input type="checkbox" ${on ? 'checked' : ''} onchange="window._catV4Source('${d.id}')"><strong>${d.productName || 'CAT'}</strong> · ${fmtE(parseFloat(d.amount) || 0)} · ${d.entityName || ''} · <span style="color:${days <= 0 ? 'var(--orange)' : 'var(--text-dim)'}">${days <= 0 ? 'échu le ' + formatDate(d.maturityDate) : 'J-' + days + ' (' + formatDate(d.maturityDate) + ')'}</span></label>`; });
      h += `</div>${srcDeps.length ? '<div style="font-size:11px;margin-top:8px"><strong>' + fmtE(srcAmount) + '</strong> à replacer (' + srcDeps.map(d => d.productName).join(' + ') + ' · ' + (srcDeps[0].entityName || '') + ')</div>' : '<div style="font-size:10px;color:var(--text-dim);margin-top:6px">Aucune échéance cochée : le classement porte sur le montant libre ci-dessous (pour une allocation globale par entité, utilise l\'onglet Allocateur).</div>'}</div>`;
    }
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:10px 12px;background:var(--bg-elevated);border-radius:8px;margin-bottom:10px;font-size:11px;align-items:end">
        <label>${srcDeps.length ? 'Montant (= échéances cochées)' : 'Montant libre (€)'}<br><input type="number" value="${A0}" ${srcDeps.length ? 'disabled' : ''} style="width:100%;font-size:14px;font-weight:700" onchange="window._catV4Set('cash',this.value)"></label>
        <label>Échéance visée<br><select onchange="window._catV4Set('horizon',this.value)" style="width:100%;font-size:14px;font-weight:700">${[6, 12, 18, 24, 36, 60].map(m => `<option value="${m}" ${m === H ? 'selected' : ''}>${m} mois</option>`).join('')}</select></label>
        <div>Ma vue sur les taux<br><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${VIEWS.map(v => `<button class="btn sm" style="${v.k === view.k ? 'background:#0EA5E9;color:#fff;border-color:#0EA5E9' : ''}" onclick="window._catV4Set('view','${v.k}')" title="${v.bp === 0 ? 'ce que la courbe anticipe déjà' : (v.bp > 0 ? '+' : '') + v.bp + ' bp au-delà du forward'}">${v.label}</button>`).join('')}</div></div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">Structurés de taux à comparer (coche jusqu'à 3) — les <strong>détenus</strong> sont évalués plus bas avec tes CAT :</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px">${prods.map(p => { const t = _productTerms(p); const on = S.selected.includes(p.id); const held = (parseFloat(p.investedAmount) || 0) > 0; return `<label style="display:flex;align-items:center;gap:5px;padding:3px 7px;border:1px solid ${on ? '#0EA5E9' : 'var(--border)'};border-radius:6px;font-size:10px;cursor:pointer;background:${on ? 'rgba(14,165,233,0.10)' : 'var(--bg-elevated)'}"><input type="checkbox" ${on ? 'checked' : ''} onchange="window._catV4Toggle('${p.id}')"> ${(p.name || '?').substring(0, 30)}<span style="color:var(--text-dim)"> · ${fmtP(t.coupon)}${t.barrier != null ? ' si TEC10 ≤ ' + fmtP(t.barrier) : ''}${t.isCallable ? ' · call an ' + t.firstCall : t.isTarn ? ' · TARN' : ''}${t.inFine ? ' · in fine' : ''}${held ? ' · détenu' : ''}</span></label>`; }).join('') || '<span style="font-size:10px;color:var(--text-dim)">aucun produit de taux à capital garanti dans la liste</span>'}</div>`;

    // ── Concentration par groupe bancaire ──
    const gx = groupExposure();
    const over = Object.entries(gx.by).filter(([, a]) => gx.total > 0 && a / gx.total > GROUP_CAP).sort((a, b) => b[1] - a[1]);
    if (gx.total > 0) h += `<div style="padding:8px 12px;border:1px solid ${over.length ? 'rgba(232,93,4,0.4)' : 'var(--border)'};border-radius:6px;font-size:11px;margin-bottom:12px;background:${over.length ? 'rgba(232,93,4,0.05)' : 'var(--bg-elevated)'}"><strong>Concentration par groupe bancaire</strong> (CAT + structurés détenus, ${fmtE(gx.total)}) : ${Object.entries(gx.by).sort((a, b) => b[1] - a[1]).map(([g, a]) => `${g} <span style="font-family:var(--mono);${a / gx.total > GROUP_CAP ? 'color:var(--orange);font-weight:700' : ''}">${Math.round(a / gx.total * 100)} %</span>`).join(' · ')} — plafond ${Math.round(GROUP_CAP * 100)} % par groupe.${over.length ? ' <span style="color:var(--orange)">⚠ ' + over.map(([g]) => g).join(', ') + ' au-dessus du plafond : aucun flux nouveau vers ce groupe tant qu\'il n\'est pas revenu dessous (🚫 ci-dessous = groupe déjà au-dessus, ou qui le dépasserait en recevant ce montant).</span>' : ''}</div>`;
    // 🚫 si le groupe est déjà au-dessus du plafond, OU s'il le dépasserait en recevant ce montant
    const overGroups = new Set(Object.entries(gx.by).filter(([, a]) => gx.total + A > 0 && (a + A) / (gx.total + A) > GROUP_CAP).map(([g]) => g));
    // ── A. Où placer ce montant : UN classement CAT + structurés, dans ta vue ──
    const strat = scen.map(s => cashStrategies(A, H, s.bp));
    const stratView = viewIdx >= 0 ? strat[viewIdx] : cashStrategies(A, H, view.bp);
    const options = [];
    // CAT : les 3 meilleurs produits uniques (banque·produit distincts) + le meilleur enchaînement — pas 6 variantes du même
    const singles = stratView.filter(x => x.single).slice(0, 3), seq = stratView.filter(x => !x.single).slice(0, 1);
    singles.concat(seq).forEach(st => {
      const lo = strat[0].find(x => x.label === st.label), hi = strat[2].find(x => x.label === st.label);
      const g = _groupOf((st.label.split(' ')[0] === 'Banque' ? 'banque-populaire' : st.label.split(' ')[0]));
      options.push({ kind: 'CAT', label: st.label, value: st.final, cash: st.final - A, lo: lo ? lo.final : null, hi: hi ? hi.final : null, liquid: true, group: g, note: (st.single ? (st.type === 'progressif' ? 'progressif, sortie libre à l\'échéance du palier' : 'fixe, capital garanti FGDR') : '2e jambe au CAT attendu du scénario'), flag: /⚠/.test(st.label) });
    });
    selected.forEach(p => {
      const t = _productTerms(p);
      const v = viewIdx >= 0 ? productValue(t, A, H, scen[viewIdx].bp) : productValue(t, A, H, view.bp);
      const lo = productValue(t, A, H, scen[0].bp), hi = productValue(t, A, H, scen[2].bp);
      options.push({ kind: 'STRUCT', label: p.name, value: v.value, cash: v.cash, lo: lo.value, hi: hi.value, liquid: v.liquid, group: _groupOf(p.emitter || p.bankId), note: v.notes.join(' · '), flag: !v.liquid });
    });
    options.sort((a, b) => b.value - a.value);
    const blocked = options.filter(o => overGroups.has(o.group));
    const ranked = options.filter(o => !overGroups.has(o.group));
    const best = ranked[0];
    h += `<div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:4px">A · Où placer ${fmtE(A)} pour ${H} mois — vue « ${view.label} »</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:720px"><thead><tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:5px 6px;color:var(--text-muted)">#</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Option</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Montant à ${H} m</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">vs n°1</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Si baisse / si hausse</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Encaissé</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Remarque</th></tr></thead><tbody>`;
    ranked.forEach((o, i) => {
      h += `<tr style="border-bottom:1px solid var(--border);${i === 0 ? 'background:rgba(6,214,160,0.08)' : ''}">
        <td style="padding:5px 6px;color:var(--text-dim)">${i + 1}</td>
        <td style="padding:5px 6px"><span style="font-size:9px;padding:1px 5px;border-radius:4px;background:${o.kind === 'CAT' ? 'rgba(6,214,160,0.15)' : 'rgba(14,165,233,0.15)'};color:${o.kind === 'CAT' ? '#047857' : '#0369A1'}">${o.kind === 'CAT' ? 'CAT' : 'STRUCTURÉ'}</span> ${o.label}${o.liquid ? '' : ' <span title="capital non disponible à cette échéance" style="color:var(--orange)">🔒</span>'}${overGroups.has(o.group) ? ' <span title="groupe bancaire déjà au-dessus du plafond de concentration" style="color:var(--orange)">🚫 ' + o.group + '</span>' : ''}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:${i === 0 ? 'var(--green)' : 'var(--text-bright)'}">${fmtE(o.value)}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:var(--orange)">${i === 0 ? '—' : '−' + fmtE(best.value - o.value)}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-muted)">${o.lo != null ? fmtE(o.lo) : '—'} / ${o.hi != null ? fmtE(o.hi) : '—'}</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-size:10px;color:${o.cash > 0 ? 'var(--text-bright)' : 'var(--orange)'}">${o.kind === 'CAT' ? fmtE(o.cash) + ' à l\'échéance' : fmtE(o.cash)}</td>
        <td style="padding:5px 6px;font-size:10px;color:var(--text-muted);max-width:280px">${o.note}</td></tr>`;
    });
    blocked.forEach(o => {
      h += `<tr style="border-bottom:1px solid var(--border);opacity:.55"><td style="padding:5px 6px;color:var(--text-dim)">🚫</td><td style="padding:5px 6px"><span style="font-size:9px;padding:1px 5px;border-radius:4px;background:var(--bg-elevated);color:var(--text-dim)">${o.kind === 'CAT' ? 'CAT' : 'STRUCTURÉ'}</span> ${o.label} <span style="color:var(--orange);font-size:10px">hors plafond ${o.group}</span></td><td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${fmtE(o.value)}</td><td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:var(--text-dim)">${best ? (o.value >= best.value ? '+' : '−') + fmtE(Math.abs(o.value - best.value)) : ''}</td><td colspan="3" style="padding:5px 6px;font-size:10px;color:var(--text-dim)">écarté par la règle de concentration — ne compte pas dans la reco</td></tr>`;
    });
    h += `</tbody></table></div>`;
    // « Patienter » : à horizon court, chiffrer ce que coûte / rapporte le fait de revoir dans H mois plutôt que de bloquer 12 mois
    if (H < 12 && best) {
      const s12 = cashStrategies(A, 12, view.bp).filter(x => x.single && !/⚠/.test(x.label) && !overGroups.has(_groupOf((x.label.split(' ')[0] === 'Banque' ? 'banque-populaire' : x.label.split(' ')[0]))))[0];
      if (s12) {
        const rH = Math.pow(best.value / A, 12 / H) - 1, r12 = Math.pow(s12.final / A, 1) - 1;
        const be = (Math.pow((1 + r12) / Math.pow(1 + rH, H / 12), 12 / (12 - H)) - 1) * 100;
        const exp = expectedCAT(H, 12 - H, view.bp);
        const vWait = best.value * Math.pow(1 + exp / 100, (12 - H) / 12), diff = vWait - s12.final;
        h += `<div style="margin:8px 0 4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elevated);font-size:11px"><strong>⏳ Patienter ${H} mois puis revoir, ou bloquer 12 mois ?</strong> ${best.label} (${H} m) puis replacement : il faut que le CAT de ${12 - H} mois dans ${H} mois dépasse <strong>${fmtP(be)}</strong> pour battre ${s12.label} 12 m (${fmtE(s12.final)}). Dans ta vue, le marché attend <strong>${fmtP(exp)}</strong> → patienter ${diff >= 0 ? 'rapporte' : 'coûte'} ≈ <strong style="color:${diff >= 0 ? 'var(--green)' : 'var(--orange)'}">${fmtE(Math.abs(diff))}</strong> sur 12 mois${Math.abs(diff) < A * 0.002 ? ' — quasi neutre : tu achètes de l\'optionnalité gratuitement' : ''}.</div>`;
      }
    }
    if (best && srcDeps.length) h += `<div style="margin:8px 0 4px;padding:8px 10px;border:1px solid rgba(6,214,160,0.4);border-radius:6px;background:rgba(6,214,160,0.06);font-size:11px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><span>Reco pour ${fmtE(A)} : <strong>${best.label}</strong> → ${fmtE(best.value)} à ${H} mois.</span>${best.kind === 'CAT' ? '<button class="btn sm primary" onclick="showRenewFromOfferModal(\'' + srcDeps[0].id + '\')">↻ Créer le placement (archive l\'ancien)</button>' : '<span style="font-size:10px;color:var(--text-dim)">structuré : à souscrire via la fiche produit</span>'}</div>`;
    h += `<div style="margin:8px 0 6px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end"><label style="font-size:10px;color:var(--text-muted)">Consigne pour l'analyse (optionnel) — ex. « je peux immobiliser 100 k€ à 5 ans », « pas de CIC », « priorité liquidité mars 2027 »<br><input type="text" value="${(S.aiBrief || '').replace(/"/g, '&quot;')}" placeholder="liquidité hors BFR, à but d'investissement, horizon flexible…" style="width:100%;font-size:11px" onchange="window._catV4Brief(this.value)"></label><button class="btn sm ai-glow" onclick="window._catV4AskAI()">🤖 Analyse d'investissement (IA)</button></div>
      <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px">L'IA reçoit le marché, ta vue, la concentration, les classements à 6 / 12 / 24 / 60 mois (options écartées comprises), tes CAT et structurés — et propose une stratégie : répartition, séquencement, négociations, ce qui ferait changer d'avis. Elle ne recalcule aucun chiffre.</div>
      <div id="cat-v4-ai" style="margin-bottom:14px"></div>`;

    // ── B. Quel CAT existant mérite d'être arbitré ──
    const active = catManager.deposits.filter(d => d.status === 'active' && d.productType !== 'parts-sociales');
    const arbs = [];
    active.forEach(d => {
      const per = scen.map(s => depositOptions(d, H, s.bp));
      const pv = viewIdx >= 0 ? per[viewIdx] : depositOptions(d, H, view.bp);
      const keys = Object.keys(pv);
      const bestKey = keys.reduce((b, k) => (!b || pv[k].value > pv[b].value) ? k : b, null);
      const robust = scen.every((s, i) => keys.reduce((b, k) => (!b || per[i][k].value > per[i][b].value) ? k : b, null) === bestKey);
      arbs.push({ d, per, pv, keys, bestKey, robust, gain: pv[bestKey].value - pv.keep.value, gainLo: per[0][bestKey].value - per[0].keep.value, gainHi: per[2][bestKey].value - per[2].keep.value });
    });
    arbs.sort((a, b) => b.gain - a.gain);
    const toDo = arbs.filter(a => a.bestKey !== 'keep' && a.gain > 50);
    const held = _rateProducts().filter(p => (parseFloat(p.investedAmount) || 0) > 0);
    h += `<div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:4px">B · Mes CAT : lesquels arbitrer (à ${H} mois, vue « ${view.label} »)</div>`;
    if (!toDo.length) h += `<div style="font-size:11px;color:var(--green);margin-bottom:8px">✅ Aucun arbitrage payant dans ta vue : tous tes CAT sont à garder.</div>`;
    else {
      h += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:720px"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Contrat</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">À faire</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Gain vs garder</th><th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Si baisse / si hausse</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Fiabilité</th></tr></thead><tbody>`;
      toDo.forEach(a => {
        h += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px 6px"><strong>${a.d.productName || 'CAT'}</strong><div style="font-size:9px;color:var(--text-dim)">${a.d.bankName || ''} · ${a.d.entityName || ''} · ${fmtE(parseFloat(a.d.amount) || 0)}${a.d.maturityDate ? ' · éch. ' + formatDate(a.d.maturityDate) : ''}</div></td>
          <td style="padding:5px 6px">${labelsOpt[a.bestKey]}<div style="font-size:9px;color:var(--text-dim)">${a.pv[a.bestKey].label}</div></td>
          <td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">+${fmtE(a.gain)}</td>
          <td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-muted)">${(a.gainLo >= 0 ? '+' : '−') + fmtE(Math.abs(a.gainLo))} / ${(a.gainHi >= 0 ? '+' : '−') + fmtE(Math.abs(a.gainHi))}</td>
          <td style="padding:5px 6px;font-size:10px;color:${a.robust ? 'var(--green)' : 'var(--orange)'}">${a.robust ? 'robuste — gagne quel que soit le scénario' : 'dépend des taux'}</td></tr>`;
      });
      h += `</tbody></table></div>`;
    }
    // structurés détenus à coupons à risque
    const risky = held.map(p => { const t = _productTerms(p), Ai = parseFloat(p.investedAmount) || 0; const v = viewIdx >= 0 ? productValue(t, Ai, H, scen[viewIdx].bp) : productValue(t, Ai, H, view.bp); return { p, t, v, Ai }; }).filter(x => x.v.notes.some(n => /perdu/.test(n)));
    if (risky.length) h += `<div style="margin-top:8px;padding:8px 10px;border:1px solid rgba(232,93,4,0.35);border-radius:6px;font-size:11px;background:rgba(232,93,4,0.05)"><strong style="color:var(--orange)">⚠ Structurés détenus à coupons menacés dans ta vue :</strong> ${risky.map(x => x.p.name + ' (' + fmtE(x.Ai) + ') — ' + x.v.notes.filter(n => /perdu/.test(n)).join(', ')).join(' · ')}. Pas de sortie chiffrable (marché secondaire) : à surveiller, et à ne pas renforcer.</div>`;

    // ── Détails repliés ──
    h += `<details style="margin-top:14px"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted)">Détail par contrat — garder / sortir maintenant / échéance libre, 3 scénarios</summary><div style="overflow-x:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:760px"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Placement</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Option</th>${scen.map(s => `<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">${s.label}</th>`).join('')}</tr></thead><tbody>`;
    arbs.forEach(a => {
      a.keys.forEach((k, j) => {
        h += `<tr style="border-bottom:1px solid var(--border);${k === a.bestKey ? 'background:rgba(6,214,160,0.06)' : ''}">`;
        if (j === 0) h += `<td rowspan="${a.keys.length}" style="padding:5px 6px;vertical-align:top"><strong>${a.d.productName || 'CAT'}</strong><div style="font-size:9px;color:var(--text-dim)">${a.d.bankName || ''} · ${fmtE(parseFloat(a.d.amount) || 0)}</div></td>`;
        h += `<td style="padding:5px 6px;${k === a.bestKey ? 'font-weight:700' : ''}">${labelsOpt[k]}<div style="font-size:9px;color:var(--text-dim);font-weight:400">${a.per[1][k].label}</div></td>`;
        scen.forEach((s, i) => { const v = a.per[i][k].value, ref = a.per[i].keep.value; h += `<td style="padding:5px 6px;text-align:right;font-family:var(--mono);white-space:nowrap">${fmtE(v)}<div style="font-size:9px;color:${v - ref > 1 ? 'var(--green)' : v - ref < -1 ? 'var(--orange)' : 'var(--text-dim)'}">${k === 'keep' ? 'réf.' : (v - ref >= 0 ? '+' : '−') + fmtE(Math.abs(v - ref))}</div></td>`; });
        h += `</tr>`;
      });
    });
    held.forEach(p => { const t = _productTerms(p), Ai = parseFloat(p.investedAmount) || 0; const per = scen.map(s => productValue(t, Ai, H, s.bp));
      h += `<tr style="border-bottom:1px solid var(--border);background:rgba(14,165,233,0.04)"><td style="padding:5px 6px"><strong>${p.name}</strong><div style="font-size:9px;color:var(--text-dim)">structuré détenu · ${fmtE(Ai)}</div></td><td style="padding:5px 6px">✅ Garder<div style="font-size:9px;color:var(--text-dim)">coupons + capital selon scénario</div></td>${per.map(v => `<td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${fmtE(v.value)}${v.liquid ? '' : ' 🔒'}<div style="font-size:9px;color:${v.notes.some(n => /perdu/.test(n)) ? 'var(--orange)' : 'var(--text-dim)'}">${v.notes.filter(n => /perdu|rembours|rappel|cible/.test(n)).join(' · ').slice(0, 60) || 'coupons versés'}</div></td>`).join('')}</tr>`; });
    h += `</tbody></table></div><div style="font-size:10px;color:var(--text-dim);margin-top:6px">Pénalités = colonne « Sortie » des paliers ou barème % servi ; préavis à 0 % ; « sortir maintenant » replace sur la meilleure offre du jour ; « garder » et « échéance libre » replacent au CAT attendu (forward + spread) du scénario.</div></details>`;
    h += `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted)">Courbe & forwards (ce que le marché anticipe)</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:8px">`;
    cv.nodes.forEach(n => { h += `<div style="padding:8px 10px;background:var(--bg-elevated);border-radius:6px"><div style="font-size:9px;color:var(--text-dim)">Courbe ${n[0]} m</div><div style="font-family:var(--mono);font-weight:700">${fmtP(n[1])}</div></div>`; });
    [[6, 6], [6, 12], [12, 12], [24, 12]].forEach(([s, l]) => { h += `<div style="padding:8px 10px;background:rgba(14,165,233,0.08);border-radius:6px"><div style="font-size:9px;color:var(--text-dim)">Forward ${l} m dans ${s} m</div><div style="font-family:var(--mono);font-weight:700;color:#0EA5E9">${fmtP(forward(s, l))}</div><div style="font-size:9px;color:var(--text-dim)">CAT attendu ${fmtP(expectedCAT(s, l, 0))}</div></div>`; });
    h += `</div><div style="font-size:10px;color:var(--text-muted);margin-top:6px">« Marché » = la courbe telle quelle : une hausse y est déjà (6 m dans 6 m ${fmtP(forward(6, 6))} vs ${fmtP(spot(6))} aujourd'hui). « Hausse » = parier sur PLUS que ça. Coupons périodiques replacés au CAT attendu ; in fine = rien d'encaissé avant remboursement ; TEC10 projeté = actuel + dérive implicite + scénario ; callable rappelé si coupon > forward + spread émetteur (donc en baisse).</div></details>`;
    h += `</div>`;
    host.innerHTML = h;
    // conserver l'avis IA déjà rendu pour ces mêmes entrées
    if (S.aiHtml && S.aiKey === _aiKey()) { const el = document.getElementById('cat-v4-ai'); if (el) el.innerHTML = S.aiHtml; }
    S.lastOptions = ranked; S.lastArbs = toDo.map(a => ({ name: a.d.productName, amount: a.d.amount, action: labelsOpt[a.bestKey], detail: a.pv[a.bestKey].label, gain: Math.round(a.gain), robust: a.robust })); S.lastRisky = risky.map(x => x.p.name + ' : ' + x.v.notes.filter(n => /perdu/.test(n)).join(', '));
  }
  function _aiKey() { return [S.cash, S.horizon, S.view, (S.selected || []).join(','), S.aiBrief || ''].join('|'); }

  // ── Analyse IA : stratégie d'investissement sur les chiffres calculés (multi-horizons, ne recalcule rien) ──
  function _rankFor(H, bp, A, selected, overGroups) {
    const strat = cashStrategies(A, H, bp);
    const singles = strat.filter(x => x.single && !/⚠/.test(x.label)).slice(0, 4), seq = strat.filter(x => !x.single).slice(0, 1);
    const out = singles.concat(seq).map(st => ({ kind: 'CAT', label: st.label, value: st.final, cash: st.final - A, liquid: true, group: _groupOf((st.label.split(' ')[0] === 'Banque' ? 'banque-populaire' : st.label.split(' ')[0])), note: st.single ? (st.type === 'progressif' ? 'progressif, sortie libre à chaque palier' : 'fixe') : '2e jambe au CAT attendu' }));
    selected.forEach(p => { const t = _productTerms(p), v = productValue(t, A, H, bp); out.push({ kind: 'STRUCTURÉ', label: p.name, value: v.value, cash: v.cash, liquid: v.liquid, group: _groupOf(p.emitter || p.bankId), note: v.notes.join(' · ') }); });
    out.sort((a, b) => b.value - a.value);
    return out.map((o, i) => (i + 1) + '. [' + o.kind + '] ' + o.label + ' → ' + fmtE(o.value) + ' (encaissé ' + fmtE(o.cash) + (o.liquid ? '' : ', capital immobilisé à cet horizon') + ')' + (overGroups.has(o.group) ? ' [ÉCARTÉ : groupe ' + o.group + ' au-dessus du plafond de concentration]' : '') + (o.note ? ' — ' + o.note : '')).join('\n');
  }
  window._catV4AskAI = async function() {
    const el = document.getElementById('cat-v4-ai'); if (!el) return;
    const cv = _curve(), view = VIEWS.find(v => v.k === S.view) || VIEWS[1], A = S.cash;
    const prods = _rateProducts(), selected = prods.filter(p => (S.selected || []).includes(p.id));
    const gx = groupExposure(); const overGroups = new Set(Object.entries(gx.by).filter(([, a]) => gx.total + A > 0 && (a + A) / (gx.total + A) > GROUP_CAP).map(([g]) => g));
    el.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">🤖 Analyse en cours (Opus, 20-40 s)…</div>';
    const byH = [6, 12, 24, 60].map(H => '— À ' + H + ' mois :\n' + _rankFor(H, view.bp, A, selected, overGroups)).join('\n\n');
    const held = prods.filter(p => (parseFloat(p.investedAmount) || 0) > 0).map(p => { const t = _productTerms(p), Ai = parseFloat(p.investedAmount) || 0, v = productValue(t, Ai, 12, view.bp); return p.name + ' (' + fmtE(Ai) + ', ' + fmtP(t.coupon) + (t.barrier != null ? ' si TEC10 ≤ ' + fmtP(t.barrier) : '') + ') : ' + (v.notes.filter(n => /perdu|rembours|rappel|cible/.test(n)).join(', ') || 'coupons versés'); }).join('\n') || 'aucun';
    const arbs = (S.lastArbs || []).map(a => a.name + ' (' + fmtE(parseFloat(a.amount) || 0) + ') : ' + a.action + ' — ' + a.detail + ' → +' + fmtE(a.gain) + (a.robust ? ' (robuste)' : ' (dépend des taux)')).join('\n') || 'aucun arbitrage payant';
    const deps = catManager.deposits.filter(d => d.status === 'active').map(d => (d.productName || 'CAT') + ' · ' + (d.bankName || '') + ' · ' + (d.entityName || '') + ' · ' + fmtE(parseFloat(d.amount) || 0) + ' · ' + fmtP(parseFloat(d.rate) || 0) + (d.maturityDate ? ' · éch. ' + formatDate(d.maturityDate) : '') + (d.reviewDate ? ' · point de décision ' + formatDate(d.reviewDate) + (d.reviewNote ? ' (' + d.reviewNote + ')' : '') : '')).join('\n');
    const conc = Object.entries(gx.by).sort((a, b) => b[1] - a[1]).map(([g, a]) => g + ' ' + Math.round(a / gx.total * 100) + ' %').join(', ');
    const sys = 'Tu es un directeur financier expérimenté de PME française qui conseille un dirigeant sur sa TRÉSORERIE EXCÉDENTAIRE (hors BFR, à but d\'investissement, IS 25 %). Deux entités : Caméléons (prudente : capital garanti, majorité comptes à terme) et ByCam (tolère le risque). Tu écris une ANALYSE D\'INVESTISSEMENT, pas un choix de ligne : tu peux proposer de répartir le montant entre plusieurs supports et durées, de séquencer (agir maintenant / attendre une nouvelle grille bancaire / point de décision daté), de négocier avec les banques, et tu dis ce qui te ferait changer d\'avis. RÈGLES : n\'invente aucun chiffre, utilise uniquement ceux fournis (montants finaux, forwards, plafonds) ; zone euro uniquement ; respecte la règle de concentration (aucun flux vers un groupe marqué ÉCARTÉ, sauf pour dire explicitement que tu recommandes d\'assouplir la règle et pourquoi) ; un capital « immobilisé » n\'est pas disponible à cet horizon ; réponds en français, 350 à 500 mots, structure : 1) Lecture du marché et de ta vue, 2) Stratégie proposée (répartition chiffrée par support et durée, avec les montants finaux correspondants), 3) Séquencement et négociations (dates, leviers), 4) Ce qu\'il faut éviter et pourquoi, 5) Ce qui ferait changer la décision. Markdown léger (titres ##, listes -, gras **).';
    const usr = 'CONTEXTE\nMontant : ' + fmtE(A) + (S.sourceIds && S.sourceIds.length ? ' (échéances Optiplus Conquête BP échues le 18/09/2026, entité Caméléons)' : '') + ' · liquidité hors BFR, objectif investissement, horizon flexible · échéance regardée en priorité : ' + S.horizon + ' mois · vue de taux du dirigeant : ' + view.label + (view.bp ? ' (' + (view.bp > 0 ? '+' : '') + view.bp + ' bp vs forward)' : ' (la courbe telle quelle)') + '.' + (S.aiBrief ? '\nConsigne du dirigeant : ' + S.aiBrief : '') +
      '\n\nMARCHÉ (courbe du ' + (cv.date || '?') + ') : ' + cv.nodes.map(n => n[0] + ' m ' + fmtP(n[1])).join(', ') + ' · TEC10 ' + (cv.tec10 != null ? fmtP(cv.tec10) : '?') + ' · forwards : 6 m dans 6 m ' + fmtP(forward(6, 6)) + ', 12 m dans 12 m ' + fmtP(forward(12, 12)) + ', 12 m dans 24 m ' + fmtP(forward(24, 12)) + ' · spread CAT moyen ' + fmtP(catSpread(12)) + '.' +
      '\n\nCONCENTRATION par groupe bancaire (CAT + structurés détenus, ' + fmtE(gx.total) + ') : ' + conc + ' · plafond ' + Math.round(GROUP_CAP * 100) + ' % (règle validée par un expert le 17/09/2026 : aucun flux nouveau vers un groupe au-dessus).' +
      '\n\nOPTIONS POUR CE MONTANT — montant final brut par horizon, dans la vue du dirigeant (les structurés cochés sont évalués sur leur mécanique réelle) :\n' + byH +
      '\n\nCAT EXISTANTS :\n' + deps + '\n\nARBITRAGES PROPOSÉS PAR L\'OUTIL :\n' + arbs + '\n\nSTRUCTURÉS DE TAUX DÉTENUS (à 12 mois) :\n' + held +
      '\n\nDOCTRINE EXPERT (17/09) : un callable émetteur n\'est acceptable qu\'à partir d\'environ 4,6-4,8 % de coupon (fixe non rappelable + valeur de l\'option vendue) ; un zéro-coupon en intérêt simple est à écarter (IS annuel sur intérêts courus, rien d\'encaissé) ; le CATIP CIC doit d\'abord être renégocié sur la grille en cours avant toute sortie ; les TARN à barrière franchie sont à ne pas renforcer.';
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null; const timer = ctrl ? setTimeout(() => ctrl.abort(), 70000) : null;
      const resp = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1500, system: sys, messages: [{ role: 'user', content: usr }] }), signal: ctrl ? ctrl.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
      const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/^## (.*)$/gm, '<div style="font-weight:700;color:#0369A1;margin:10px 0 4px">$1</div>').replace(/^# (.*)$/gm, '<div style="font-weight:700;margin:10px 0 4px">$1</div>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^- (.*)$/gm, '<div style="padding-left:14px;text-indent:-10px">• $1</div>').replace(/\n{2,}/g, '<div style="height:6px"></div>').replace(/\n/g, '<br>');
      S.aiHtml = '<div style="padding:12px 14px;border:1px solid rgba(14,165,233,0.35);border-radius:8px;background:rgba(14,165,233,0.05);font-size:11.5px;line-height:1.55;color:var(--text)"><strong style="color:#0369A1">🤖 Analyse d\'investissement</strong> <span style="font-size:9px;color:var(--text-dim)">(Opus · sur les chiffres de l\'outil, vue « ' + view.label + ' », ' + fmtE(A) + ')</span><div style="margin-top:6px">' + html + '</div></div>';
      S.aiKey = _aiKey(); el.innerHTML = S.aiHtml;
    } catch (e) { el.innerHTML = '<div style="font-size:11px;color:var(--orange)">IA indisponible (' + (e && e.message) + ') — le classement ci-dessus reste valable.</div>'; }
  };
  window._catV4Brief = function(v) { S.aiBrief = v; };

  window._catV4Source = function(id) { S.sourceIds = S.sourceIds || []; const i = S.sourceIds.indexOf(id); if (i >= 0) S.sourceIds.splice(i, 1); else S.sourceIds.push(id); render(); };
  window._catV4Toggle = function(id) { S.selected = S.selected || []; const i = S.selected.indexOf(id); if (i >= 0) S.selected.splice(i, 1); else { if (S.selected.length >= 3) S.selected.shift(); S.selected.push(id); } render(); };
  window._catV4Set = function(key, val) {
    if (key.startsWith('callable.')) S.callable[key.split('.')[1]] = val === '' ? '' : val;
    else if (key === 'horizon') S.horizon = parseInt(val, 10) || 12;
    else if (key === 'view') S.view = val;
    else if (key === 'shift') S.shift = parseFloat(val) || 0;
    else if (key === 'cash') { S.cash = parseFloat(val) || S.cash; S.sourceIds = []; }
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

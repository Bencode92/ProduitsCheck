// ═══════════════════════════════════════════════════════════════════
// CAT — Conditions de sortie structurées sur les PLACEMENTS
//   • noticeDays        : préavis en jours (remplace le 32 codé en dur de l'optimiseur)
//   • earlyExitSchedule : barème de pénalités [{fromMonth,toMonth,servedPct}] — % du taux
//                         nominal servi si retrait pendant la plage (fixes ; pour les
//                         progressifs, la colonne « Sortie » des paliers prévaut)
//   • feesAnnualPct     : frais annuels (%/an) déduits du taux dans l'arbitrage
// Chargé après cat-patches.js / cat-objectives-patch.js / cat-optimizer.js.
// ═══════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  // ── Éditeur ─────────────────────────────────────────────────────
  function _row(r) {
    r = r || {};
    return `<div class="ex-row" style="display:grid;grid-template-columns:1fr 1fr 1.4fr auto;gap:6px;align-items:end;margin-bottom:6px">
      <div class="form-field" style="margin:0"><label style="font-size:9px">Mois de</label><input type="number" min="1" class="ex-from" value="${r.fromMonth ?? ''}" placeholder="1"></div>
      <div class="form-field" style="margin:0"><label style="font-size:9px">à</label><input type="number" min="1" class="ex-to" value="${r.toMonth ?? ''}" placeholder="3"></div>
      <div class="form-field" style="margin:0"><label style="font-size:9px">% du taux servi</label><input type="number" min="0" max="100" step="1" class="ex-pct" value="${r.servedPct ?? ''}" placeholder="0 = aucun intérêt · 50 · 100"></div>
      <button type="button" class="btn ghost sm" style="color:var(--red)" onclick="this.closest('.ex-row').remove()">✕</button>
    </div>`;
  }

  function _injectExitTerms(deposit) {
    const grid = document.querySelector('.modal-content .form-grid');
    if (!grid || document.getElementById('ex-section')) return;
    const d = deposit || {};
    const isNotice = (document.getElementById('pl-exit')?.value || d.exitCondition) === 'notice';
    const sched = Array.isArray(d.earlyExitSchedule) ? d.earlyExitSchedule : [];
    const sec = document.createElement('div');
    sec.className = 'form-field full'; sec.id = 'ex-section'; sec.style.cssText = 'margin-top:12px';
    sec.innerHTML = `<label style="display:flex;justify-content:space-between;align-items:center"><span>🚪 Conditions de sortie &amp; frais</span><span style="font-size:10px;color:var(--text-dim)">chiffrées → utilisées par l'optimiseur</span></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
        <div class="form-field" style="margin:0"><label>Préavis (jours)</label><input id="pl-notice-days" type="number" min="0" value="${d.noticeDays ?? (isNotice ? 32 : '')}" placeholder="32"></div>
        <div class="form-field" style="margin:0"><label>Frais annuels (%/an)</label><input id="pl-fees-pct" type="number" min="0" step="0.01" value="${d.feesAnnualPct ?? ''}" placeholder="0"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--text-bright);cursor:pointer"><input type="checkbox" id="pl-exit-free-period" ${d.exitFreeAtPeriodEnd ? 'checked' : ''}> Sortie libre (sans frais ni préavis) à chaque fin de palier / échéance annuelle — l'optimiseur teste alors « attendre l'échéance puis replacer »</label>
      <div style="margin-top:10px;font-size:10px;color:var(--text-muted);margin-bottom:6px">Barème de pénalité en cas de retrait anticipé — <em>% du taux nominal servi</em> selon le mois de sortie (ex. SG : mois 1-3 → 10, mois 4-7 → 40, mois 8-11 → 70 ; CIC fixe 12 m : mois 1-3 → 0, mois 4-12 → 50). Pour un progressif, la colonne « Sortie » des paliers prévaut.</div>
      <div id="ex-rows">${sched.map(_row).join('')}</div>
      <button class="btn ghost sm" style="width:100%;margin-top:2px" type="button" onclick="document.getElementById('ex-rows').insertAdjacentHTML('beforeend', window._exitTermsRow())">+ Ajouter une plage</button>`;
    // Après le barème progressif s'il est déjà injecté, sinon après la grille
    const rs = document.getElementById('rs-container');
    (rs ? rs.closest('.form-field') : grid).after(sec);
    // Préavis par défaut quand on choisit « Avec préavis »
    const ex = document.getElementById('pl-exit');
    if (ex) ex.addEventListener('change', () => { const n = document.getElementById('pl-notice-days'); if (n && ex.value === 'notice' && !n.value) n.value = 32; });
  }
  window._exitTermsRow = () => _row();

  function _readExitTerms() {
    const rows = Array.from(document.querySelectorAll('#ex-rows .ex-row')).map(r => ({
      fromMonth: parseInt(r.querySelector('.ex-from')?.value, 10),
      toMonth: parseInt(r.querySelector('.ex-to')?.value, 10),
      servedPct: parseFloat(r.querySelector('.ex-pct')?.value)
    })).filter(x => x.fromMonth >= 1 && x.toMonth >= x.fromMonth && !isNaN(x.servedPct));
    const nd = document.getElementById('pl-notice-days')?.value;
    const fp = document.getElementById('pl-fees-pct')?.value;
    const free = !!document.getElementById('pl-exit-free-period')?.checked;
    return { exitFreeAtPeriodEnd: free, earlyExitSchedule: rows, noticeDays: nd === '' || nd == null ? null : parseInt(nd, 10), feesAnnualPct: fp === '' || fp == null ? null : parseFloat(fp) };
  }

  // ── Hooks modales (add + edit) ───────────────────────────────────
  if (typeof showManualPlacementModal === 'function') {
    const _o = showManualPlacementModal;
    showManualPlacementModal = function(productType, prefill, rawText, sourceFile) { _o(productType, prefill, rawText, sourceFile); setTimeout(() => _injectExitTerms(prefill || {}), 0); };
  }
  if (typeof showEditPlacementModal === 'function') {
    const _o = showEditPlacementModal;
    showEditPlacementModal = function(id) { _o(id); const d = catManager.deposits.find(x => x.id === id); setTimeout(() => _injectExitTerms(d || {}), 0); };
  }
  if (typeof savePlacement === 'function') {
    const _o = savePlacement;
    savePlacement = async function(editId) {
      const terms = _readExitTerms();
      await _o(editId);
      const t = editId ? catManager.deposits.find(d => d.id === editId) : catManager.deposits[catManager.deposits.length - 1];
      if (!t) return;
      t.earlyExitSchedule = terms.earlyExitSchedule;
      t.exitFreeAtPeriodEnd = terms.exitFreeAtPeriodEnd;
      if (terms.noticeDays != null) t.noticeDays = terms.noticeDays; else delete t.noticeDays;
      if (terms.feesAnnualPct != null) t.feesAnnualPct = terms.feesAnnualPct; else delete t.feesAnnualPct;
      await catManager.saveDeposits();
    };
  }

  // ── Helpers partagés ─────────────────────────────────────────────
  window._depositNoticeDays = function(d) {
    if (d.noticeDays != null && !isNaN(d.noticeDays)) return d.noticeDays;
    return d.exitCondition === 'notice' ? 32 : 0;
  };
  // % du taux servi si sortie au mois m (fixes avec barème) ; null si non renseigné
  window._depositServedPct = function(d, m) {
    const s = Array.isArray(d.earlyExitSchedule) ? d.earlyExitSchedule : [];
    const hit = s.find(x => m >= x.fromMonth && m <= x.toMonth);
    return hit ? hit.servedPct : null;
  };

  // ── Optimiseur : préavis réel, pénalité des fixes, frais ─────────
  if (typeof _calcNoticeOpportunityCost === 'function') {
    _calcNoticeOpportunityCost = function(dep, targetRate) {
      const days = window._depositNoticeDays(dep);
      return Math.round((parseFloat(dep.amount) || 0) * targetRate / 100 * days / 365 * 100) / 100;
    };
  }
  if (typeof _calcSwitchScenario12m === 'function') {
    _calcSwitchScenario12m = function(deposit, altRate, exitCosts) {
      const amount = parseFloat(deposit.amount) || 0;
      const noticeDays = window._depositNoticeDays(deposit);
      const horizonDays = (typeof HORIZON_DAYS !== 'undefined') ? HORIZON_DAYS : 365;
      const investDays = Math.max(0, horizonDays - noticeDays);
      return Math.round((amount * (altRate / 100) * (investDays / 365) - exitCosts) * 100) / 100;
    };
  }
  if (typeof _calcExitPenaltyCost === 'function') {
    const _oPen = _calcExitPenaltyCost;
    _calcExitPenaltyCost = function(deposit) {
      // Progressifs : logique existante (earlyRate des paliers)
      if (deposit.rateSchedule && deposit.rateSchedule.length) return _oPen(deposit);
      // Fixes avec barème : intérêts courus perdus = courus × (1 − % servi)
      const a = parseFloat(deposit.amount) || 0, rate = parseFloat(deposit.rate) || 0;
      if (!a || !deposit.startDate) return 0;
      const elapsedDays = Math.max(0, (new Date() - new Date(deposit.startDate)) / 864e5);
      const m = Math.max(1, Math.ceil(elapsedDays / 30.44));
      const served = window._depositServedPct(deposit, m);
      if (served == null) return 0;
      const accrued = a * rate / 100 * elapsedDays / 365;
      return Math.max(0, Math.round(accrued * (1 - served / 100) * 100) / 100);
    };
  }
  if (typeof _calcRemainingEffectiveRate === 'function') {
    const _oRem = _calcRemainingEffectiveRate;
    _calcRemainingEffectiveRate = function(deposit) {
      const r = _oRem(deposit);
      const f = parseFloat(deposit.feesAnnualPct) || 0;
      return f > 0 ? Math.round((r - f) * 10000) / 10000 : r;
    };
  }

  // ── Carte placement : rappel des conditions ──────────────────────
  if (typeof renderPlacementCard === 'function') {
    const _oCard = renderPlacementCard;
    renderPlacementCard = function(d) {
      let html = _oCard(d);
      const bits = [];
      const nd = window._depositNoticeDays(d);
      if (nd) bits.push('préavis ' + nd + ' j');
      const s = Array.isArray(d.earlyExitSchedule) ? d.earlyExitSchedule : [];
      if (s.length) bits.push('sortie : ' + s.map(x => 'M' + x.fromMonth + (x.toMonth !== x.fromMonth ? '-' + x.toMonth : '') + ' → ' + x.servedPct + '%').join(' · '));
      if (d.exitFreeAtPeriodEnd) bits.push('sortie libre à chaque échéance');
      if (d.reviewDate) bits.push('<strong style="color:var(--orange)">📌 point de décision ' + formatDate(d.reviewDate) + '</strong>' + (d.reviewNote ? ' — ' + d.reviewNote : ''));
      if (parseFloat(d.feesAnnualPct) > 0) bits.push('frais ' + d.feesAnnualPct + '%/an');
      if (!bits.length) return html;
      const extra = `<div style="font-size:9px;color:var(--text-dim);margin-top:4px">🚪 ${bits.join(' · ')}</div>`;
      return html.replace(/<\/div><\/div>\s*$/, extra + '</div></div>');
    };
  }
})();

// ═══ Optimiseur : scénario « sortir à la prochaine échéance libre » ══════════
// Un CAT progressif à préavis se sort SANS frais ni préavis à chaque fin de
// palier (exitFreeAtPeriodEnd). L'arbitrage « maintenant vs garder » ignorait
// cette 3e voie : garder jusqu'à l'échéance du palier, puis replacer au meilleur
// taux sans pénalité. On l'ajoute et on la retient si elle domine sur 12 mois.
(function() {
  'use strict';
  function _wrap() {
    if (typeof buildOptimizationAnalysis !== 'function' || buildOptimizationAnalysis.__exitTerms) return;
    var _orig = buildOptimizationAnalysis;
    var w = function() {
      var analysis = _orig();
      try {
        var horizonDays = (typeof HORIZON_DAYS !== 'undefined') ? HORIZON_DAYS : 365;
        var isRate = (typeof _IS_TAX_RATE !== 'undefined') ? _IS_TAX_RATE : 0.25;
        var now = new Date();
        (analysis.depositAnalysis || []).forEach(function(a) {
          var d = catManager.deposits.find(function(x) { return x.id === a.id; });
          if (!d || !d.exitFreeAtPeriodEnd || !d.rateSchedule || !d.rateSchedule.length || !a.bestAlt) return;
          var cur = d.rateSchedule.find(function(s) { return new Date(s.from) <= now && new Date(s.to) >= now; });
          if (!cur) return;
          var freeDate = new Date(new Date(cur.to).getTime() + 864e5); // lendemain de la fin du palier
          var daysToFree = Math.round((freeDate - now) / 864e5);
          if (daysToFree <= 0 || daysToFree >= horizonDays) return;
          var amt = parseFloat(d.amount) || 0;
          var keepPart = amt * (parseFloat(cur.rate) || 0) / 100 * daysToFree / 365;
          var reinvest = amt * (a.bestAlt.rate / 100) * (horizonDays - daysToFree) / 365;
          var freeExit12m = Math.round((keepPart + reinvest) * 100) / 100;
          a.freeExitDate = freeDate.toISOString().split('T')[0];
          a.freeExit12m = freeExit12m;
          var best = Math.max(a.keep12m || 0, a.switch12m || 0);
          if (freeExit12m > best) {
            var gain = Math.round((freeExit12m - (a.keep12m || 0)) * (1 - isRate));
            a.recommendation = 'ATTENDRE ÉCHÉANCE';
            a.reason = 'Sortir sans frais ni préavis le ' + formatDate(a.freeExitDate) + ' (fin de palier ' + cur.rate + '%) puis replacer à ' + a.bestAlt.rate + '% (' + a.bestAlt.name + ') : ' + formatNumber(freeExit12m) + '€/12m vs garder ' + formatNumber(a.keep12m) + '€ · arbitrer maintenant ' + formatNumber(a.switch12m) + '€ → +' + formatNumber(gain) + '€ net IS';
          } else if (a.recommendation === 'ARBITRER') {
            a.reason += ' · (sortie libre le ' + formatDate(a.freeExitDate) + ' : ' + formatNumber(freeExit12m) + '€/12m, moins bien)';
          }
        });
      } catch (e) { console.error('[ExitTerms optimizer]', e); }
      return analysis;
    };
    w.__exitTerms = true;
    window.buildOptimizationAnalysis = w;
  }
  _wrap();
  var _t = setInterval(function() { if (typeof buildOptimizationAnalysis === 'function') { clearInterval(_t); _wrap(); } }, 200);
})();

// ═══════════════════════════════════════════════════════════════════
// CAT — Flux « Replacer à l'échéance »
// Échéancier / fiche placement → choisir une OFFRE importée (Taux du Marché)
// → nouveau placement pré-rempli avec TOUTES ses conditions (taux, paliers,
// sortie anticipée, préavis, sortie libre aux échéances) → ancien archivé.
// Chargé après cat-horizon-grid.js et cat-exit-terms-patch.js.
// ═══════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  const _fmt = (n) => (typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)));

  function _offers() {
    return (catManager.rates?.rates || []).filter(r =>
      r.source !== 'web scan' && r.productType !== 'parts-sociales' && (parseFloat(r.rate) || 0) > 0 &&
      !(typeof _isRateExpired === 'function' && _isRateExpired(r)) && !/transition/i.test(r.productName || '') && String(r.category || '').toLowerCase() !== 'transition');
  }

  // Offre marché → conditions de sortie au format placement
  function _offerToExitTerms(o) {
    const txt = String(o.withdrawalConditions || '') + ' ' + (o.earlyExitSchedule || []).map(s => (s.period || '') + ' ' + (s.penalty || '')).join(' ');
    const notice = o.notice != null && !isNaN(parseInt(o.notice, 10)) ? parseInt(o.notice, 10) : (/pr[ée]avis/i.test(txt) ? 32 : null);
    const isProg = o.rateType === 'progressif' && (o.rateSchedule || []).length > 0;
    // Progressif « à préavis » (CIC…) : sortie libre à chaque fin de palier — modifiable dans la fiche
    const freeAtEnd = isProg && (/chaque [ée]ch[ée]ance|sans frais, ni p[ée]nalit|pr[ée]avis/i.test(txt) || (o.rateSchedule || []).some(t => t.earlyRate != null));
    const sched = [];
    if (!isProg && typeof window._catFixedEarlyFactor === 'function') {
      (o.earlyExitSchedule || []).forEach(s => {
        const p = String(s.period || ''); const rng = p.match(/(\d+)\s*[-–à]\s*(\d+)/); const single = !rng && p.match(/(\d+)/);
        if (!rng && !single) return;
        const a = rng ? parseInt(rng[1], 10) : parseInt(single[1], 10), b = rng ? parseInt(rng[2], 10) : a;
        const f = window._catFixedEarlyFactor(o, a);
        if (f != null) sched.push({ fromMonth: a, toMonth: b, servedPct: Math.round(f * 100) });
      });
    }
    return { noticeDays: notice, exitFreeAtPeriodEnd: freeAtEnd, earlyExitSchedule: sched, exitCondition: notice ? 'notice' : 'maturity' };
  }

  // ── Modale de choix d'offre ──────────────────────────────────────
  window.showRenewFromOfferModal = function(depositId) {
    const old = depositId ? catManager.deposits.find(d => d.id === depositId) : null;
    const offers = _offers().sort((a, b) => (a.bankName || '').localeCompare(b.bankName || '') || a.durationMonths - b.durationMonths);
    if (!offers.length) { if (typeof showToast === 'function') showToast('Aucune offre confirmée non périmée — importe d\'abord les taux (Gérer)', 'error'); return; }
    const modal = document.getElementById('modal');
    const amount = old ? (parseFloat(old.amount) || 0) : 0;
    const start = old && old.maturityDate ? old.maturityDate : new Date().toISOString().split('T')[0];
    const oldDur = old ? parseInt(old.durationMonths, 10) : null;
    let rows = '';
    let lastBank = '';
    offers.forEach((o, i) => {
      if (o.bankName !== lastBank) { rows += `<tr><td colspan="5" style="padding:8px 6px 3px;font-weight:700;color:var(--text-bright);font-size:11px">${o.bankName || o.bankId}</td></tr>`; lastBank = o.bankName; }
      const prog = o.rateType === 'progressif' && (o.rateSchedule || []).length > 0;
      const sched = prog ? o.rateSchedule.map(s => (s.label || 'M' + s.fromMonth + '-' + s.toMonth) + ' ' + s.rate + '%').join(' → ') : '';
      const same = oldDur && parseInt(o.durationMonths, 10) === oldDur;
      rows += `<tr style="border-bottom:1px solid var(--border);${same ? 'background:rgba(6,214,160,0.06)' : ''}">
        <td style="padding:5px 6px"><input type="radio" name="rn-offer" value="${i}" ${same && !rows.includes('checked') ? 'checked' : ''}></td>
        <td style="padding:5px 6px">${(o.productName || 'CAT').replace(/^CAT\s+/i, '')}${prog ? ' 📈' : ''}${same ? ' <span style="font-size:9px;color:var(--green)">même durée</span>' : ''}<div style="font-size:9px;color:var(--text-dim)">${sched}</div></td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${o.durationMonths} m</td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:var(--green);font-weight:700">${o.rate}%</td>
        <td style="padding:5px 6px;font-size:9px;color:var(--orange)">${o.withdrawalConditions || '<span style="color:var(--text-dim)">conditions non renseignées</span>'}</td></tr>`;
    });
    modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
      <h2 class="modal-title">↻ Replacer ${old ? '« ' + (old.productName || 'CAT') + ' » (' + _fmt(amount) + '€)' : 'du cash'} sur une offre</h2>
      <div class="form-grid">
        <div class="form-field"><label>Montant à replacer (€)</label><input id="rn-amount" type="number" value="${amount || ''}"></div>
        <div class="form-field"><label>Date de départ</label><input id="rn-start" type="date" value="${start}"></div>
        <div class="form-field"><label>🏢 Entreprise</label><select id="rn-entity"><option value="">—</option>${MY_ENTITIES.map(e => `<option value="${e.id}" ${old && (old.entity === e.id) ? 'selected' : ''}>${e.icon} ${e.name}</option>`).join('')}</select></div>
        ${old ? `<div class="form-field"><label>Ancien placement</label><label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:8px;cursor:pointer"><input type="checkbox" id="rn-archive" checked> Archiver à l'échéance (📅 Maturité)</label></div>` : ''}
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">Offres confirmées non périmées (hors Transition). Les conditions de l'offre — paliers, retrait anticipé, préavis, sortie libre aux échéances — sont recopiées dans le placement.</div>
      <div style="max-height:360px;overflow:auto;margin-top:8px;border:1px solid var(--border);border-radius:var(--radius-sm)"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="border-bottom:1px solid var(--border)"><th></th><th style="text-align:left;padding:5px 6px;color:var(--text-dim);font-size:10px">Produit</th><th style="text-align:right;padding:5px 6px;color:var(--text-dim);font-size:10px">Durée</th><th style="text-align:right;padding:5px 6px;color:var(--text-dim);font-size:10px">Taux</th><th style="text-align:left;padding:5px 6px;color:var(--text-dim);font-size:10px">Conditions</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="window._renewCreateFromOffer('${depositId || ''}')">Créer le placement →</button></div>
    </div></div>`;
    modal.classList.add('visible');
    window._renewOffers = offers;
  };

  window._renewCreateFromOffer = function(depositId) {
    const sel = document.querySelector('input[name="rn-offer"]:checked');
    if (!sel) { if (typeof showToast === 'function') showToast('Choisis une offre', 'error'); return; }
    const o = window._renewOffers[parseInt(sel.value, 10)];
    const amount = parseFloat(document.getElementById('rn-amount')?.value) || 0;
    const start = document.getElementById('rn-start')?.value || new Date().toISOString().split('T')[0];
    const entity = document.getElementById('rn-entity')?.value || '';
    const archive = !!document.getElementById('rn-archive')?.checked;
    const terms = _offerToExitTerms(o);
    const prefill = {
      productType: 'cat', productName: o.productName || (o.bankName + ' ' + o.durationMonths + ' mois'),
      amount, rate: parseFloat(o.rate) || 0, rateType: o.rateType === 'progressif' ? 'progressif' : 'fixe',
      durationMonths: parseInt(o.durationMonths, 10) || 0, startDate: start, interestPayment: 'maturity',
      exitCondition: terms.exitCondition, exitPenalty: o.withdrawalConditions || '',
      rateSchedule: o.rateType === 'progressif' ? (o.rateSchedule || []).map(s => ({ fromMonth: s.fromMonth, toMonth: s.toMonth, rate: s.rate, earlyRate: s.earlyRate, label: s.label })) : [],
      noticeDays: terms.noticeDays, exitFreeAtPeriodEnd: terms.exitFreeAtPeriodEnd, earlyExitSchedule: terms.earlyExitSchedule,
      summary: 'Replacement depuis l\'offre « ' + (o.productName || '') + ' » (' + o.bankName + ', conditions du ' + (o.date || '?') + ')'
    };
    window._renewPending = { oldId: depositId || null, archive: archive && !!depositId, bankId: o.bankId, entity };
    closeModal();
    showManualPlacementModal('cat', prefill, null, null);
    // Banque + entité : posées après l'ouverture (le sélecteur banque du formulaire matche par nom d'émetteur)
    setTimeout(() => {
      const b = document.getElementById('pl-bank'); if (b) b.value = o.bankId;
      const e = document.getElementById('pl-entity'); if (e && entity) e.value = entity;
      const ex = document.getElementById('pl-exit'); if (ex) ex.value = terms.exitCondition;
    }, 30);
  };

  // ── Après enregistrement : archiver l'ancien ─────────────────────
  if (typeof savePlacement === 'function') {
    const _o = savePlacement;
    savePlacement = async function(editId) {
      const pend = (!editId && window._renewPending) ? window._renewPending : null;
      await _o(editId);
      if (!pend) return;
      window._renewPending = null;
      if (pend.archive && pend.oldId) {
        const old = catManager.deposits.find(d => d.id === pend.oldId);
        if (old && old.status === 'active') {
          old.status = 'archived';
          old.archived = { date: old.maturityDate || new Date().toISOString().split('T')[0], reason: 'maturite', reasonLabel: 'Maturité', interestReceived: parseFloat(old.estimatedInterest) || 0, capitalReturned: parseFloat(old.amount) || 0, renewedInto: (catManager.deposits[catManager.deposits.length - 1] || {}).id || null };
          await catManager.saveDeposits();
          if (typeof showToast === 'function') showToast('Ancien placement archivé (maturité)', 'success');
          if (typeof renderCAT === 'function') renderCAT(document.getElementById('main-content'));
        }
      }
    };
  }

  // ── Points d'entrée : fiche placement + échéancier ───────────────
  if (typeof showEditPlacementModal === 'function') {
    const _o = showEditPlacementModal;
    showEditPlacementModal = function(id) {
      _o(id);
      setTimeout(() => {
        const acts = document.querySelector('.modal-content .modal-actions');
        if (acts && !document.getElementById('rn-btn')) { const b = document.createElement('button'); b.id = 'rn-btn'; b.className = 'btn'; b.textContent = '↻ Replacer à l\'échéance'; b.onclick = () => showRenewFromOfferModal(id); acts.insertBefore(b, acts.firstChild.nextSibling); }
      }, 0);
    };
  }
  if (typeof _renderTimelineDetail === 'function') {
    const _o = _renderTimelineDetail;
    _renderTimelineDetail = function(m) {
      let html = _o(m), cursor = 0;
      // un bouton par placement, après son nom (curseur mobile : deux placements peuvent porter le même nom)
      m.deposits.forEach(d => {
        const btn = ` <button class="btn sm" style="margin-left:6px;font-size:10px;padding:2px 8px" onclick="event.stopPropagation();showRenewFromOfferModal('${d.id}')">↻ Replacer</button>`;
        const marker = `<strong style="color:var(--text-bright)">${d.productName || 'CAT'}</strong>`;
        const idx = html.indexOf(marker, cursor);
        if (idx >= 0) { html = html.slice(0, idx + marker.length) + btn + html.slice(idx + marker.length); cursor = idx + marker.length + btn.length; }
      });
      return html;
    };
  }
})();

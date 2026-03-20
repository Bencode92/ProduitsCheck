// ═══ CAT PATCHES V2b — Fix saisie détaillée bug + Duplicate ═══

let _extractedBrochure = null;

// ─── 1. ENTITY on placement cards ────────────────────────
const _origRenderPlacementCard = renderPlacementCard;
renderPlacementCard = function(d) {
  let html = _origRenderPlacementCard(d);
  if (d.entity) {
    const ei = MY_ENTITIES.find(e => e.id === d.entity);
    if (ei) {
      const badge = `<div class="product-card-bank" style="color:${ei.color};border-color:${ei.color}33;background:${ei.color}12;margin-left:4px">${ei.icon} ${ei.name}</div>`;
      const he = html.indexOf('</div></div>');
      if (he >= 0) html = html.substring(0, he) + badge + html.substring(he);
    }
  }
  if (d.status === 'archived' && d.archived) {
    const archBadge = `<div style="margin-top:4px;padding:3px 8px;background:rgba(148,163,184,0.15);border-radius:4px;font-size:10px;color:#94A3B8">📦 Archivé — ${d.archived.reasonLabel || 'Terminé'}${d.archived.interestReceived ? ' — Intérêts: +' + formatNumber(d.archived.interestReceived) + '€' : ''}</div>`;
    html = _injectBeforeLastDiv(html, archBadge);
  }
  return html;
};

// ─── 2. Override PDF processing → multi-contract modal ───
const _origProcessPlacementPDF = processPlacementPDF;
processPlacementPDF = async function(file, productType) {
  const progress = document.getElementById('placement-progress');
  const status = document.getElementById('placement-status');
  if (progress) progress.classList.remove('hidden');
  try {
    if (status) status.textContent = 'Extraction du PDF...';
    const { parsed, rawText } = await catManager.parsePDFConditions(file);
    if (status) status.textContent = 'Extraction OK!';
    _extractedBrochure = { parsed, rawText, sourceFile: file.name, productType };
    const m = document.getElementById('modal'); m.classList.remove('visible'); m.innerHTML = '';
    setTimeout(() => showBrochureContractsModal(), 350);
  } catch (e) {
    if (status) status.textContent = 'Erreur: ' + e.message;
    if (progress) progress.classList.add('error');
  }
};

// ─── 3. Multi-contract modal from brochure ───────────────
function showBrochureContractsModal() {
  const b = _extractedBrochure;
  if (!b) return;
  const p = b.parsed || {};
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">🤖 Brochure extraite — Créer les contrats</h2>
    ${p.summary ? `<div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px;line-height:1.5">
      <strong style="color:var(--accent)">📄 ${p.productName || b.sourceFile || 'Brochure'}</strong><br>${p.summary}<br>
      ${p.rate ? '<strong>Taux:</strong> ' + p.rate + '% ' + (p.rateType || '') : ''}${p.durationMonths ? ' · <strong>Durée:</strong> ' + p.durationMonths + ' mois' : ''}${p.exitPenalty ? ' · <strong>Pénalité sortie:</strong> ' + p.exitPenalty : ''}${p.interestPayment ? ' · <strong>Intérêts:</strong> ' + p.interestPayment : ''}
    </div>` : ''}
    <div class="form-grid">
      <div class="form-field"><label>🏦 Banque / Émetteur</label><select id="bc-bank"><option value="">Sélectionner...</option>${BANKS.map(bk => `<option value="${bk.id}" ${p.emitter && bk.name.toLowerCase().includes((p.emitter||'').toLowerCase().substring(0,4)) ? 'selected' : ''}>${bk.name}</option>`).join('')}<option value="autre">Autre</option></select></div>
      <div class="form-field"><label>Type de placement</label><select id="bc-type">${PLACEMENT_TYPES.map(t => `<option value="${t.id}" ${(p.productType || b.productType) === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Taux annuel (%)</label><input id="bc-rate" type="number" step="0.01" value="${p.rate || ''}"></div>
      <div class="form-field"><label>Durée (mois, 0 si indéterminée)</label><input id="bc-duration" type="number" value="${p.durationMonths || ''}"></div>
    </div>
    <div style="margin:20px 0 12px;font-size:13px;font-weight:600;color:var(--text-bright)">📋 Contrats à créer depuis cette brochure</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">Ajoutez un contrat par entité/montant. Même brochure = mêmes conditions, mais contrats séparés.</div>
    <div id="bc-contracts">
      <div class="bc-contract-row" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end">
        <div class="form-field" style="margin:0"><label style="font-size:10px">🏢 Entreprise</label><select class="bc-entity"><option value="">Sélectionner...</option>${MY_ENTITIES.map(e => `<option value="${e.id}">${e.icon} ${e.name}</option>`).join('')}</select></div>
        <div class="form-field" style="margin:0"><label style="font-size:10px">Montant (€)</label><input class="bc-amount" type="number" placeholder="50000"></div>
        <div class="form-field" style="margin:0"><label style="font-size:10px">Date de souscription</label><input class="bc-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
        <button class="btn sm danger" onclick="this.closest('.bc-contract-row').remove()" style="margin-bottom:2px">✕</button>
      </div>
    </div>
    <button class="btn ghost" style="width:100%;margin-bottom:16px" onclick="addContractRow()">+ Ajouter un contrat</button>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal();_extractedBrochure=null;">Annuler</button>
      <button class="btn ghost" onclick="handleSwitchToDetailed()">✏️ Saisie détaillée</button>
      <button class="btn primary" onclick="handleSaveBrochureContracts()">✅ Créer les contrats</button>
    </div>
  </div></div>`;
  modal.classList.add('visible');
}

function handleSwitchToDetailed() {
  const b = _extractedBrochure; if (!b) { closeModal(); return; }
  const parsed = b.parsed, rawText = b.rawText, sourceFile = b.sourceFile, productType = b.productType;
  const m = document.getElementById('modal'); m.classList.remove('visible'); m.innerHTML = '';
  setTimeout(() => showManualPlacementModal(productType, parsed, rawText, sourceFile), 350);
}

function addContractRow() {
  const container = document.getElementById('bc-contracts'); if (!container) return;
  const row = document.createElement('div'); row.className = 'bc-contract-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end';
  row.innerHTML = `<div class="form-field" style="margin:0"><label style="font-size:10px">🏢 Entreprise</label><select class="bc-entity"><option value="">Sélectionner...</option>${MY_ENTITIES.map(e => `<option value="${e.id}">${e.icon} ${e.name}</option>`).join('')}</select></div>
    <div class="form-field" style="margin:0"><label style="font-size:10px">Montant (€)</label><input class="bc-amount" type="number" placeholder="50000"></div>
    <div class="form-field" style="margin:0"><label style="font-size:10px">Date de souscription</label><input class="bc-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
    <button class="btn sm danger" onclick="this.closest('.bc-contract-row').remove()" style="margin-bottom:2px">✕</button>`;
  container.appendChild(row);
}

async function handleSaveBrochureContracts() {
  const b = _extractedBrochure; if (!b) return;
  const bankId = document.getElementById('bc-bank')?.value;
  const bank = BANKS.find(bk => bk.id === bankId);
  const productType = document.getElementById('bc-type')?.value || b.productType;
  const rate = parseFloat(document.getElementById('bc-rate')?.value) || 0;
  const durationMonths = parseInt(document.getElementById('bc-duration')?.value) || 0;
  if (!bankId) { showToast('Banque requise', 'error'); return; }
  const rows = document.querySelectorAll('.bc-contract-row'); const contracts = [];
  rows.forEach(row => { const entity = row.querySelector('.bc-entity')?.value || ''; const amount = parseFloat(row.querySelector('.bc-amount')?.value) || 0; const startDate = row.querySelector('.bc-date')?.value || ''; if (amount > 0) contracts.push({ entity, amount, startDate }); });
  if (contracts.length === 0) { showToast('Au moins un contrat avec montant requis', 'error'); return; }
  closeModal();
  for (const c of contracts) {
    catManager.addDeposit({ productType, bankId, bankName: bank?.name || bankId, productName: b.parsed?.productName || 'CAT ' + (durationMonths || '') + 'm', amount: c.amount, rate, rateType: b.parsed?.rateType || 'fixe', durationMonths, startDate: c.startDate, interestPayment: b.parsed?.interestPayment || 'maturity', exitCondition: b.parsed?.exitCondition || 'maturity', exitPenalty: b.parsed?.exitPenalty || '', autoRenew: b.parsed?.autoRenew === true || b.parsed?.autoRenew === 'true', status: 'active', entity: c.entity, entityName: c.entity ? (MY_ENTITIES.find(e => e.id === c.entity)?.name || c.entity) : '', sourceFile: b.sourceFile || '', aiSummary: b.parsed?.summary || '' });
  }
  await catManager.saveDeposits(); _extractedBrochure = null;
  showToast(`${contracts.length} contrat${contracts.length > 1 ? 's' : ''} créé${contracts.length > 1 ? 's' : ''}`, 'success');
  renderCAT(document.getElementById('main-content'));
}

// ─── 4. Entity in manual modal ───────────────────────────
const _origShowManualPlacementModal = showManualPlacementModal;
showManualPlacementModal = function(productType, prefill, rawText, sourceFile) {
  _origShowManualPlacementModal(productType, prefill, rawText, sourceFile);
  const bankField = document.getElementById('pl-bank')?.closest('.form-field');
  if (bankField) { const ef = document.createElement('div'); ef.className = 'form-field'; ef.innerHTML = `<label>🏢 Entreprise</label><select id="pl-entity"><option value="">Sélectionner...</option>${MY_ENTITIES.map(e => `<option value="${e.id}">${e.icon} ${e.name}</option>`).join('')}</select>`; bankField.after(ef); }
};

const _origShowEditPlacementModal = showEditPlacementModal;
showEditPlacementModal = function(id) {
  _origShowEditPlacementModal(id);
  const d = catManager.deposits.find(x => x.id === id); if (!d) return;
  // Entity dropdown
  const bankField = document.getElementById('pl-bank')?.closest('.form-field');
  if (bankField) { const ef = document.createElement('div'); ef.className = 'form-field'; ef.innerHTML = `<label>🏢 Entreprise</label><select id="pl-entity"><option value="">Sélectionner...</option>${MY_ENTITIES.map(e => `<option value="${e.id}" ${d.entity === e.id ? 'selected' : ''}>${e.icon} ${e.name}</option>`).join('')}</select>`; bankField.after(ef); }
  // Extra buttons
  const actions = document.querySelector('.modal-actions');
  if (actions) {
    // Duplicate button
    const dupBtn = document.createElement('button'); dupBtn.className = 'btn'; dupBtn.style.cssText = 'color:var(--accent);border-color:var(--accent)';
    dupBtn.innerHTML = '📋 Dupliquer';
    dupBtn.onclick = () => handleDuplicatePlacement(id);
    actions.insertBefore(dupBtn, actions.querySelector('.btn.danger') || actions.querySelector('.btn.primary'));
    // Archive button (only if active)
    if (d.status === 'active') {
      const archBtn = document.createElement('button'); archBtn.className = 'btn'; archBtn.style.cssText = 'color:#94A3B8;border-color:#94A3B8';
      archBtn.innerHTML = '📦 Archiver';
      archBtn.onclick = () => { const m = document.getElementById('modal'); m.classList.remove('visible'); m.innerHTML = ''; setTimeout(() => showCATArchiveModal(id), 350); };
      actions.insertBefore(archBtn, actions.querySelector('.btn.danger') || actions.querySelector('.btn.primary'));
    }
  }
};

// ─── DUPLICATE PLACEMENT ─────────────────────────────────
async function handleDuplicatePlacement(id) {
  const d = catManager.deposits.find(x => x.id === id);
  if (!d) return;
  // Create a copy with new ID, same data
  const copy = JSON.parse(JSON.stringify(d));
  delete copy.id;
  copy.productName = (copy.productName || '') + ' (copie)';
  copy.status = 'active';
  delete copy.archived;
  catManager.addDeposit(copy);
  await catManager.saveDeposits();
  closeModal();
  showToast(`📋 "${d.productName || 'Placement'}" dupliqué — cliquez pour modifier`, 'success');
  renderCAT(document.getElementById('main-content'));
}

// ─── 5. Save entity (manual flow) ────────────────────────
const _origSavePlacement = savePlacement;
savePlacement = async function(editId) {
  const entityVal = document.getElementById('pl-entity')?.value || '';
  await _origSavePlacement(editId);
  const target = editId ? catManager.deposits.find(d => d.id === editId) : catManager.deposits[catManager.deposits.length - 1];
  if (target && entityVal) { target.entity = entityVal; target.entityName = MY_ENTITIES.find(e => e.id === entityVal)?.name || entityVal; await catManager.saveDeposits(); }
};

// ─── 6. CAT ARCHIVE ──────────────────────────────────────
const CAT_ARCHIVE_REASONS = [
  { id: 'maturite', label: 'Maturité atteinte', icon: '📅' },
  { id: 'retrait', label: 'Retrait anticipé', icon: '💸' },
  { id: 'non-renouvele', label: 'Non renouvelé', icon: '❌' },
  { id: 'transfert', label: 'Transféré ailleurs', icon: '➡️' },
  { id: 'autre', label: 'Autre', icon: '📝' },
];

function showCATArchiveModal(id) {
  const d = catManager.deposits.find(x => x.id === id); if (!d) return;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">📦 Archiver ce placement</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${d.productName || 'Placement'} — ${formatNumber(d.amount)}€ à ${d.rate}%</div>
    <div class="form-grid">
      <div class="form-field"><label>Raison</label><select id="cat-arch-reason">${CAT_ARCHIVE_REASONS.map(r => `<option value="${r.id}">${r.icon} ${r.label}</option>`).join('')}</select></div>
      <div class="form-field"><label>Date de clôture</label><input id="cat-arch-date" type="date" value="${d.maturityDate || new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Intérêts reçus (€)</label><input id="cat-arch-interest" type="number" value="${d.estimatedInterest || 0}"><div style="font-size:10px;color:var(--text-dim);margin-top:2px">Estimé: ${formatNumber(d.estimatedInterest)}€</div></div>
      <div class="form-field"><label>Capital récupéré (€)</label><input id="cat-arch-capital" type="number" value="${d.amount}"></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleCATArchive('${id}')">📦 Archiver</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function handleCATArchive(id) {
  const d = catManager.deposits.find(x => x.id === id); if (!d) return;
  const reason = document.getElementById('cat-arch-reason')?.value || 'autre';
  d.status = 'archived';
  d.archived = { date: document.getElementById('cat-arch-date')?.value, reason, reasonLabel: (CAT_ARCHIVE_REASONS.find(r => r.id === reason)?.label || reason), interestReceived: parseFloat(document.getElementById('cat-arch-interest')?.value) || 0, capitalReturned: parseFloat(document.getElementById('cat-arch-capital')?.value) || 0, gainTotal: (parseFloat(document.getElementById('cat-arch-interest')?.value) || 0) + ((parseFloat(document.getElementById('cat-arch-capital')?.value) || 0) - (parseFloat(d.amount) || 0)) };
  closeModal(); await catManager.saveDeposits();
  showToast(`${d.productName || 'Placement'} archivé`, 'success');
  renderCAT(document.getElementById('main-content'));
}

// ─── 7. renderCAT — archived + entity stats ──────────────
const _origRenderCAT = renderCAT;
renderCAT = function(container) {
  _origRenderCAT(container);
  const statsRow = container.querySelector('.stats-row');
  if (statsRow) {
    const active = catManager.deposits.filter(d => d.status === 'active');
    const entityMap = {};
    active.forEach(d => { const n = d.entity ? (MY_ENTITIES.find(e => e.id === d.entity)?.name || d.entity) : 'Non assigné'; entityMap[n] = (entityMap[n] || 0) + (parseFloat(d.amount) || 0); });
    const sub = Object.entries(entityMap).map(([n, v]) => `${n}: ${formatNumber(v)}€`).join(' · ');
    if (sub) { const ec = document.createElement('div'); ec.className = 'stat-card blue'; ec.innerHTML = `<div class="stat-label">Par Entreprise</div><div class="stat-value">${Object.keys(entityMap).length}</div><div class="stat-sub">${sub}</div>`; statsRow.appendChild(ec); }
  }
  const archived = catManager.deposits.filter(d => d.status === 'archived');
  if (archived.length > 0) {
    const ti = archived.reduce((s, d) => s + (d.archived?.interestReceived || 0), 0);
    const as = document.createElement('div'); as.className = 'section'; as.style.opacity = '0.75';
    as.innerHTML = `<div class="section-header"><div class="section-title"><span class="dot" style="background:#94A3B8"></span>📦 Archives (${archived.length})</div><div style="font-size:12px;color:var(--text-muted)">Intérêts perçus: <strong style="color:var(--green)">${formatNumber(ti)}€</strong></div></div><div class="portfolio-grid">${archived.map(d => renderPlacementCard(d)).join('')}</div>`;
    container.appendChild(as);
  }
};

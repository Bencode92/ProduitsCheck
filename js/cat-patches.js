// ═══ CAT PATCHES — Entity + Archive + Analytics ═════════════════════

// ─── 1. ENTITY on placement cards ────────────────────────
const _origRenderPlacementCard = renderPlacementCard;
renderPlacementCard = function(d) {
  let html = _origRenderPlacementCard(d);
  // Inject entity badge after rate badge in header
  if (d.entity) {
    const ei = MY_ENTITIES.find(e => e.id === d.entity);
    if (ei) {
      const badge = `<div class="product-card-bank" style="color:${ei.color};border-color:${ei.color}33;background:${ei.color}12;margin-left:4px">${ei.icon} ${ei.name}</div>`;
      const he = html.indexOf('</div></div>');
      if (he >= 0) html = html.substring(0, he) + badge + html.substring(he);
    }
  }
  // Inject archive badge if archived
  if (d.status === 'archived' && d.archived) {
    const archBadge = `<div style="margin-top:4px;padding:3px 8px;background:rgba(148,163,184,0.15);border-radius:4px;font-size:10px;color:#94A3B8">📦 Archiv\u00e9 \u2014 ${d.archived.reasonLabel || 'Termin\u00e9'}${d.archived.interestReceived ? ' \u2014 Int\u00e9r\u00eats: +' + formatNumber(d.archived.interestReceived) + '\u20ac' : ''}</div>`;
    html = _injectBeforeLastDiv(html, archBadge);
  }
  return html;
};

// ─── 2. ENTITY field in add/edit modals ──────────────────
const _origShowManualPlacementModal = showManualPlacementModal;
showManualPlacementModal = function(productType, prefill, rawText, sourceFile) {
  _origShowManualPlacementModal(productType, prefill, rawText, sourceFile);
  // Inject entity dropdown after bank field
  const bankField = document.getElementById('pl-bank')?.closest('.form-field');
  if (bankField) {
    const entityField = document.createElement('div');
    entityField.className = 'form-field';
    entityField.innerHTML = `<label>\ud83c\udfe2 Entreprise</label><select id="pl-entity">
      <option value="">S\u00e9lectionner...</option>
      ${MY_ENTITIES.map(e => `<option value="${e.id}">${e.icon} ${e.name}</option>`).join('')}
    </select>`;
    bankField.after(entityField);
  }
};

const _origShowEditPlacementModal = showEditPlacementModal;
showEditPlacementModal = function(id) {
  _origShowEditPlacementModal(id);
  const d = catManager.deposits.find(x => x.id === id);
  if (!d) return;
  // Inject entity dropdown
  const bankField = document.getElementById('pl-bank')?.closest('.form-field');
  if (bankField) {
    const entityField = document.createElement('div');
    entityField.className = 'form-field';
    entityField.innerHTML = `<label>\ud83c\udfe2 Entreprise</label><select id="pl-entity">
      <option value="">S\u00e9lectionner...</option>
      ${MY_ENTITIES.map(e => `<option value="${e.id}" ${d.entity === e.id ? 'selected' : ''}>${e.icon} ${e.name}</option>`).join('')}
    </select>`;
    bankField.after(entityField);
  }
  // Add archive button if active
  if (d.status === 'active') {
    const actions = document.querySelector('.modal-actions');
    if (actions) {
      const archBtn = document.createElement('button');
      archBtn.className = 'btn';
      archBtn.style.cssText = 'color:#94A3B8;border-color:#94A3B8';
      archBtn.innerHTML = '\ud83d\udce6 Archiver';
      archBtn.onclick = () => { closeModal(); setTimeout(() => showCATArchiveModal(id), 350); };
      actions.insertBefore(archBtn, actions.querySelector('.btn.danger'));
    }
  }
};

// ─── 3. Save entity with placement ──────────────────────
const _origSavePlacement = savePlacement;
savePlacement = async function(editId) {
  // Read entity before save
  const entityVal = document.getElementById('pl-entity')?.value || '';
  await _origSavePlacement(editId);
  // Patch entity onto the deposit
  const deposits = catManager.deposits;
  const target = editId ? deposits.find(d => d.id === editId) : deposits[deposits.length - 1];
  if (target && entityVal) {
    target.entity = entityVal;
    target.entityName = MY_ENTITIES.find(e => e.id === entityVal)?.name || entityVal;
    await catManager.saveDeposits();
  }
};

// ─── 4. CAT ARCHIVE MODAL ────────────────────────────
const CAT_ARCHIVE_REASONS = [
  { id: 'maturite', label: 'Maturit\u00e9 atteinte', icon: '\ud83d\udcc5' },
  { id: 'retrait', label: 'Retrait anticip\u00e9', icon: '\ud83d\udcb8' },
  { id: 'non-renouvele', label: 'Non renouvel\u00e9', icon: '\u274c' },
  { id: 'transfert', label: 'Transf\u00e9r\u00e9 ailleurs', icon: '\u27a1\ufe0f' },
  { id: 'autre', label: 'Autre', icon: '\ud83d\udcdd' },
];

function showCATArchiveModal(id) {
  const d = catManager.deposits.find(x => x.id === id);
  if (!d) return;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">\ud83d\udce6 Archiver ce placement</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${d.productName || 'Placement'} \u2014 ${formatNumber(d.amount)}\u20ac \u00e0 ${d.rate}%</div>
    <div class="form-grid">
      <div class="form-field"><label>Raison</label><select id="cat-arch-reason">
        ${CAT_ARCHIVE_REASONS.map(r => `<option value="${r.id}">${r.icon} ${r.label}</option>`).join('')}
      </select></div>
      <div class="form-field"><label>Date de cl\u00f4ture</label><input id="cat-arch-date" type="date" value="${d.maturityDate || new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Int\u00e9r\u00eats effectivement re\u00e7us (\u20ac)</label>
        <input id="cat-arch-interest" type="number" value="${d.estimatedInterest || 0}">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Estim\u00e9: ${formatNumber(d.estimatedInterest)}\u20ac</div>
      </div>
      <div class="form-field"><label>Capital r\u00e9cup\u00e9r\u00e9 (\u20ac)</label>
        <input id="cat-arch-capital" type="number" value="${d.amount}">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="handleCATArchive('${id}')">\ud83d\udce6 Archiver</button>
    </div>
  </div></div>`;
  modal.classList.add('visible');
}

async function handleCATArchive(id) {
  const d = catManager.deposits.find(x => x.id === id);
  if (!d) return;
  const reason = document.getElementById('cat-arch-reason')?.value || 'autre';
  const reasonInfo = CAT_ARCHIVE_REASONS.find(r => r.id === reason);
  const interestReceived = parseFloat(document.getElementById('cat-arch-interest')?.value) || 0;
  const capitalReturned = parseFloat(document.getElementById('cat-arch-capital')?.value) || 0;
  const date = document.getElementById('cat-arch-date')?.value;

  d.status = 'archived';
  d.archived = {
    date,
    reason,
    reasonLabel: reasonInfo?.label || reason,
    interestReceived,
    capitalReturned,
    gainTotal: interestReceived + (capitalReturned - (parseFloat(d.amount) || 0))
  };

  closeModal();
  await catManager.saveDeposits();
  showToast(`${d.productName || 'Placement'} archiv\u00e9 \u2014 Int\u00e9r\u00eats: +${formatNumber(interestReceived)}\u20ac`, 'success');
  renderCAT(document.getElementById('main-content'));
}

// ─── 5. Override renderCAT to add archived section + entity stats ───
const _origRenderCAT = renderCAT;
renderCAT = function(container) {
  _origRenderCAT(container);

  // Add entity breakdown in stats row
  const statsRow = container.querySelector('.stats-row');
  if (statsRow) {
    const active = catManager.deposits.filter(d => d.status === 'active');
    const entityMap = {};
    active.forEach(d => {
      const eName = d.entity ? (MY_ENTITIES.find(e => e.id === d.entity)?.name || d.entity) : 'Non assign\u00e9';
      entityMap[eName] = (entityMap[eName] || 0) + (parseFloat(d.amount) || 0);
    });
    const entitySub = Object.entries(entityMap).map(([n, v]) => `${n}: ${formatNumber(v)}\u20ac`).join(' \u00b7 ');
    if (entitySub) {
      const ec = document.createElement('div');
      ec.className = 'stat-card blue';
      ec.innerHTML = `<div class="stat-label">Par Entreprise</div><div class="stat-value">${Object.keys(entityMap).length}</div><div class="stat-sub">${entitySub}</div>`;
      statsRow.appendChild(ec);
    }
  }

  // Add archived section at bottom
  const archived = catManager.deposits.filter(d => d.status === 'archived');
  if (archived.length > 0) {
    const totalGain = archived.reduce((s, d) => s + (d.archived?.gainTotal || 0), 0);
    const totalInterest = archived.reduce((s, d) => s + (d.archived?.interestReceived || 0), 0);
    const archSection = document.createElement('div');
    archSection.className = 'section';
    archSection.style.opacity = '0.75';
    archSection.innerHTML = `
      <div class="section-header">
        <div class="section-title"><span class="dot" style="background:#94A3B8"></span>\ud83d\udce6 Archives (${archived.length})</div>
        <div style="font-size:12px;color:var(--text-muted)">Int\u00e9r\u00eats per\u00e7us: <strong style="color:var(--green)">${formatNumber(totalInterest)}\u20ac</strong></div>
      </div>
      <div class="portfolio-grid">${archived.map(d => renderPlacementCard(d)).join('')}</div>`;
    container.appendChild(archSection);
  }
};

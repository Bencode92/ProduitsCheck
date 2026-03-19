// ═══ PATCHES V10 — Entity visible on cards ═══

let _pendingProduct = null;

function entityOptionsHTML(selected) {
  return `<option value="">Sélectionner...</option>${MY_ENTITIES.map(e => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${e.icon} ${e.name}</option>`).join('')}`;
}
function bankOnlyOptionsHTML(selected) {
  return `<option value="">Sélectionner...</option>${BANKS_LIST.map(b => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${b.name}</option>`).join('')}<option value="autre">Autre</option>`;
}
function metadataFieldsHTML(p) {
  const entity = p?.entity || '', bank = p?.bankId || '', amount = p?.investedAmount || '';
  const date = p?.subscriptionDate || new Date().toISOString().split('T')[0], notes = p?.integrationNotes || '';
  return `<div class="form-field"><label>🏢 Entreprise</label><select id="f-meta-entity">${entityOptionsHTML(entity)}</select></div>
    <div class="form-field"><label>🏦 Banque source</label><select id="f-meta-bank">${bankOnlyOptionsHTML(bank)}</select></div>
    <div class="form-field"><label>Montant investi (€)</label><input id="f-meta-amount" type="number" value="${amount}" placeholder="50000"></div>
    <div class="form-field"><label>Date de souscription</label><input id="f-meta-date" type="date" value="${date}"></div>
    <div class="form-field full"><label>Notes</label><input id="f-meta-notes" value="${notes}" placeholder="Ex: Via AV SwissLife..."></div>`;
}
function readMetadataForm() {
  return { entity: document.getElementById('f-meta-entity')?.value || '', bankId: document.getElementById('f-meta-bank')?.value || '',
    amount: document.getElementById('f-meta-amount')?.value || '', date: document.getElementById('f-meta-date')?.value || '', notes: document.getElementById('f-meta-notes')?.value || '' };
}
function applyMetadata(product, meta) {
  if (meta.entity) { product.entity = meta.entity; product.entityName = MY_ENTITIES.find(e => e.id === meta.entity)?.name || meta.entity; }
  if (meta.bankId && meta.bankId !== 'autre') { product.bankId = meta.bankId; product.bankName = BANKS_LIST.find(b => b.id === meta.bankId)?.name || meta.bankId; }
  if (meta.amount) product.investedAmount = parseFloat(meta.amount);
  if (meta.date) product.subscriptionDate = meta.date;
  product.integrationNotes = meta.notes || '';
}

// ─── Override processUploadedFile ────────────────────────────
const _origProcessUploadedFile = processUploadedFile;
processUploadedFile = async function(file, context, bankId) {
  const progress = document.getElementById('upload-progress'), status = document.getElementById('upload-status');
  if (progress) progress.classList.remove('hidden');
  try {
    if (status) status.textContent = 'Extraction du texte PDF...';
    const product = await app.handlePDFUpload(file, bankId);
    if (status) status.textContent = 'Analyse terminée !';
    if (context === 'portfolio') {
      _pendingProduct = product;
      const modal = document.getElementById('modal'); modal.classList.remove('visible'); modal.innerHTML = '';
      setTimeout(() => showDirectAddModal(product, bankId), 350);
    } else { closeModal(); await app.addProposal(bankId, product); app.render(); }
  } catch (e) { if (status) status.textContent = 'Erreur: ' + e.message; if (progress) progress.classList.add('error'); }
};

const _origHandleManualSave = handleManualSave;
handleManualSave = function(context, bankId) {
  const product = { id: app._uid(), name: document.getElementById('f-name')?.value || '', bankId: bankId || document.getElementById('f-bank')?.value || '',
    type: document.getElementById('f-type')?.value || 'autre', underlyingType: document.getElementById('f-underlying')?.value || 'autre', underlyings: [],
    maturity: document.getElementById('f-maturity')?.value || '',
    coupon: { rate: document.getElementById('f-coupon')?.value || null, type: document.getElementById('f-coupon-type')?.value || 'conditionnel' },
    capitalProtection: { barrier: document.getElementById('f-barrier')?.value || null, level: document.getElementById('f-protection')?.value || null, protected: !!(document.getElementById('f-protection')?.value) },
    earlyRedemption: { possible: document.getElementById('f-autocall')?.value === 'true', type: document.getElementById('f-autocall')?.value === 'true' ? 'autocall' : 'none' },
    notes: document.getElementById('f-notes')?.value || '' };
  if (context === 'portfolio') {
    _pendingProduct = product; const modal = document.getElementById('modal'); modal.classList.remove('visible'); modal.innerHTML = '';
    setTimeout(() => showDirectAddModal(product, bankId), 350);
  } else { closeModal(); app.addProposal(bankId, product); }
};

function showDirectAddModal(product, bankId) {
  const detectedBank = product?.aiParsed?.distributor || product?.aiParsed?.emitter || '';
  product.bankId = product.bankId || bankId || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Ajouter au portefeuille</h2>
    <div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px;color:var(--text)">
      <strong style="color:var(--accent)">Produit:</strong> ${product.name || 'Sans nom'}
      ${detectedBank ? '<br><strong>Distributeur:</strong> ' + detectedBank : ''}</div>
    <div class="form-grid">${metadataFieldsHTML(product)}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal(); _pendingProduct=null;">Annuler</button>
      <button class="btn success" onclick="handleDirectAdd()">✅ Ajouter</button></div></div></div>`;
  modal.classList.add('visible');
}
async function handleDirectAdd() {
  if (!_pendingProduct) { showToast('Aucun produit en attente', 'error'); return; }
  const meta = readMetadataForm(); if (!meta.amount) { showToast('Montant requis', 'error'); return; }
  applyMetadata(_pendingProduct, meta); closeModal();
  await app.addToPortfolio(_pendingProduct, meta.amount); _pendingProduct = null; app.render();
}

const _origShowIntegrateModal = showIntegrateModal;
showIntegrateModal = function(productId, bankId) {
  const product = app._findProduct(productId, bankId); if (!product) return;
  product.bankId = product.bankId || bankId || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Intégrer au portefeuille</h2>
    <div class="form-grid">${metadataFieldsHTML(product)}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrate('${productId}','${bankId}')">✅ Confirmer</button></div></div></div>`;
  modal.classList.add('visible');
};
const _origHandleIntegrate = handleIntegrate;
handleIntegrate = async function(productId, bankId) {
  const meta = readMetadataForm(); if (!meta.amount) { showToast('Montant requis', 'error'); return; }
  const product = app._findProduct(productId, bankId); if (!product) { showToast('Produit introuvable', 'error'); return; }
  applyMetadata(product, meta); closeModal();
  const resolvedBankId = _resolveBankId(productId, bankId);
  if (resolvedBankId) await app.updateProposalStatus(resolvedBankId, productId, 'subscribed');
  await app.addToPortfolio({ ...product }, meta.amount); app.goToDashboard();
};

// ═══ EDIT METADATA MODAL ═══
function showEditMetadataModal() {
  const p = app.state.currentProduct; if (!p) return;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">✏️ Modifier les informations</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${p.name || 'Produit'}</div>
    <div class="form-grid">${metadataFieldsHTML(p)}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="handleEditMetadata()">💾 Enregistrer</button></div></div></div>`;
  modal.classList.add('visible');
}
async function handleEditMetadata() {
  const p = app.state.currentProduct; if (!p) return;
  const meta = readMetadataForm(); applyMetadata(p, meta);
  if (!meta.entity) { p.entity = ''; p.entityName = ''; }
  if (!meta.bankId) { p.bankId = ''; p.bankName = ''; }
  closeModal();
  const inPortfolio = app.state.portfolio.find(x => x.id === p.id);
  if (inPortfolio) {
    Object.assign(inPortfolio, { entity: p.entity, entityName: p.entityName, bankId: p.bankId, bankName: p.bankName, investedAmount: p.investedAmount, subscriptionDate: p.subscriptionDate, integrationNotes: p.integrationNotes });
    await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, app.state.portfolio, `[StructBoard] Update: ${p.name || p.id}`);
  }
  if (p.bankId) await app._saveProductFile(p.bankId, p);
  showToast('Informations mises à jour', 'success'); app.openProduct(p);
}

// ═══════════════════════════════════════════════════════════════
// FIX renderProductCard — show ENTITY badge on cards
// ═══════════════════════════════════════════════════════════════
const _origRenderProductCard = renderProductCard;
renderProductCard = function(product, context) {
  if (!product.bankId || product.bankId === 'undefined' || product.bankId === 'null') product.bankId = '';
  let html = _origRenderProductCard(product, context);
  if (product.entity) {
    const entityInfo = MY_ENTITIES.find(e => e.id === product.entity);
    if (entityInfo) {
      const entityBadge = `<div class="product-card-bank" style="color:${entityInfo.color};border-color:${entityInfo.color}33;background:${entityInfo.color}12;margin-left:4px">${entityInfo.icon} ${entityInfo.name}</div>`;
      html = html.replace('</div></div>\n    <div class="product-card-type">', `${entityBadge}</div></div>\n    <div class="product-card-type">`);
    }
  }
  return html;
};

// ═══════════════════════════════════════════════════════════════
// FIX renderDashboard — add annual yield stat card
// ═══════════════════════════════════════════════════════════════
const _origRenderDashboard = renderDashboard;
renderDashboard = function(container, state) {
  _origRenderDashboard(container, state);

  // Calculate annual yield
  const portfolio = state.portfolio || [];
  let annualYield = 0;
  portfolio.forEach(p => {
    const amount = parseFloat(p.investedAmount) || 0;
    const coupon = parseFloat(p.coupon?.rate) || 0;
    annualYield += Math.round(amount * coupon / 100);
  });
  const totalInvested = portfolio.reduce((s, p) => s + (parseFloat(p.investedAmount) || 0), 0);
  const avgYieldPct = totalInvested > 0 ? (annualYield / totalInvested * 100).toFixed(2).replace('.', ',') : '0';

  // Inject into stats row
  const statsRow = container.querySelector('.stats-row');
  if (statsRow) {
    const yieldCard = document.createElement('div');
    yieldCard.className = 'stat-card green';
    yieldCard.innerHTML = `<div class="stat-label">Rendement Annuel</div><div class="stat-value">${formatNumber(annualYield)}€</div><div class="stat-sub">${avgYieldPct}% moyen pondéré</div>`;
    statsRow.appendChild(yieldCard);
  }
};

// ═══════════════════════════════════════════════════════════════
// FIX renderProductSheet — entity tag + subscription info
// ═══════════════════════════════════════════════════════════════
const _origRenderProductSheet = renderProductSheet;
renderProductSheet = function(container, state) {
  const p = state.currentProduct;
  if (p && (!p.bankId || p.bankId === 'undefined' || p.bankId === 'null')) p.bankId = '';
  _origRenderProductSheet(container, state);

  const subtitleEl = container.querySelector('.fiche-subtitle');
  if (subtitleEl) {
    subtitleEl.querySelectorAll('.fiche-tag.bank').forEach(tag => {
      const txt = tag.textContent.trim();
      if (txt === '\u2014' || txt.toUpperCase() === 'UNDEFINED' || txt === '') {
        tag.textContent = '\u270f\ufe0f Assigner';
        tag.style.color = 'var(--accent)'; tag.style.borderColor = 'var(--accent)';
      }
      tag.style.cursor = 'pointer';
      tag.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
    });
    if (p.entity) {
      const entityInfo = MY_ENTITIES.find(e => e.id === p.entity);
      if (entityInfo) {
        const entityTag = document.createElement('span');
        entityTag.className = 'fiche-tag bank';
        entityTag.style.cssText = `color:${entityInfo.color};border-color:${entityInfo.color};cursor:pointer`;
        entityTag.textContent = `${entityInfo.icon} ${entityInfo.name}`;
        entityTag.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
        subtitleEl.insertBefore(entityTag, subtitleEl.firstChild);
      }
    }
    if (p.subscriptionDate) {
      const d = document.createElement('span');
      d.style.cssText = 'color:var(--text-muted);font-size:11px;cursor:pointer';
      d.textContent = `\ud83d\udcc5 Souscrit le ${new Date(p.subscriptionDate).toLocaleDateString('fr-FR')}`;
      d.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
      subtitleEl.appendChild(d);
    }
    if (p.integrationNotes) {
      const n = document.createElement('span');
      n.style.cssText = 'color:var(--text-dim);font-size:11px;cursor:pointer';
      n.textContent = `\ud83d\udcac ${p.integrationNotes}`;
      n.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
      subtitleEl.appendChild(n);
    }
    if (!p.entity && !p.subscriptionDate) {
      const editSpan = document.createElement('span');
      editSpan.style.cssText = 'color:var(--accent);font-size:11px;cursor:pointer;text-decoration:underline';
      editSpan.textContent = '\u270f\ufe0f Compléter';
      editSpan.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
      subtitleEl.appendChild(editSpan);
    }
  }
  const sidebar = container.querySelector('.sheet-sidebar .action-buttons');
  if (sidebar) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn lg'; editBtn.style.cssText = 'width:100%';
    editBtn.innerHTML = '\u270f\ufe0f Modifier infos';
    editBtn.onclick = () => showEditMetadataModal();
    sidebar.insertBefore(editBtn, sidebar.firstChild);
  }
  if (p.status === 'subscribed') {
    const notice = container.querySelector('.integrated-notice');
    if (notice) {
      const rd = p.subscriptionDate ? new Date(p.subscriptionDate).toLocaleDateString('fr-FR') : formatDate(p.addedDate);
      const entityLabel = p.entity ? (MY_ENTITIES.find(e => e.id === p.entity)?.name || '') : '';
      const bankLabel = p.bankId ? (BANKS_LIST.find(b => b.id === p.bankId)?.name || p.bankId) : '';
      notice.innerHTML = `\u2705 Intégré le ${rd}${entityLabel ? '<br>\ud83c\udfe2 ' + entityLabel : ''}${bankLabel ? '<br>\ud83c\udfe6 ' + bankLabel : ''}<br>Montant: ${formatNumber(p.investedAmount)}\u20ac${p.integrationNotes ? '<br><span style="color:var(--text-dim);font-size:11px">' + p.integrationNotes + '</span>' : ''}`;
    }
  }
};

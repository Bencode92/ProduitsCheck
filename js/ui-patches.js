// ═══ PATCHES V6 — Edit metadata from sheet + all add flows ═══

let _pendingProduct = null;

// ─── Override processUploadedFile ────────────────────────────
const _origProcessUploadedFile = processUploadedFile;
processUploadedFile = async function(file, context, bankId) {
  const progress = document.getElementById('upload-progress');
  const status = document.getElementById('upload-status');
  if (progress) progress.classList.remove('hidden');
  try {
    if (status) status.textContent = 'Extraction du texte PDF...';
    const product = await app.handlePDFUpload(file, bankId);
    if (status) status.textContent = 'Analyse terminée !';
    closeModal();
    if (context === 'portfolio') {
      _pendingProduct = product;
      showDirectAddModal(product, bankId);
    } else {
      await app.addProposal(bankId, product);
      app.render();
    }
  } catch (e) {
    if (status) status.textContent = 'Erreur: ' + e.message;
    if (progress) progress.classList.add('error');
  }
};

// ─── Override handleManualSave ───────────────────────────────
const _origHandleManualSave = handleManualSave;
handleManualSave = function(context, bankId) {
  const product = {
    id: app._uid(), name: document.getElementById('f-name')?.value || '',
    bankId: bankId || document.getElementById('f-bank')?.value || '',
    type: document.getElementById('f-type')?.value || 'autre',
    underlyingType: document.getElementById('f-underlying')?.value || 'autre', underlyings: [],
    maturity: document.getElementById('f-maturity')?.value || '',
    coupon: { rate: document.getElementById('f-coupon')?.value || null, type: document.getElementById('f-coupon-type')?.value || 'conditionnel' },
    capitalProtection: { barrier: document.getElementById('f-barrier')?.value || null, level: document.getElementById('f-protection')?.value || null, protected: !!(document.getElementById('f-protection')?.value) },
    earlyRedemption: { possible: document.getElementById('f-autocall')?.value === 'true', type: document.getElementById('f-autocall')?.value === 'true' ? 'autocall' : 'none' },
    notes: document.getElementById('f-notes')?.value || '',
  };
  closeModal();
  if (context === 'portfolio') { _pendingProduct = product; showDirectAddModal(product, bankId); }
  else { app.addProposal(bankId, product); }
};

// ─── Modal for direct add to portfolio ──────────────────────
function showDirectAddModal(product, bankId) {
  const currentBank = product?.bankId || bankId || '';
  const detectedBank = product?.aiParsed?.distributor || product?.aiParsed?.emitter || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Ajouter au portefeuille</h2>
    <div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px;color:var(--text)">
      <strong style="color:var(--accent)">Produit:</strong> ${product.name || 'Sans nom'}
      ${detectedBank ? '<br><strong>Émetteur/Distributeur:</strong> ' + detectedBank : ''}
    </div>
    <div class="form-grid">
      <div class="form-field"><label>Banque qui te l'a proposé</label><select id="f-direct-bank">
        <option value="">Sélectionner...</option>
        ${BANKS.map(b=>`<option value="${b.id}" ${b.id===currentBank || (detectedBank && b.name.toLowerCase().includes(detectedBank.toLowerCase().substring(0,4))) ? 'selected' : ''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field"><label>Montant investi (€)</label><input id="f-direct-amount" type="number" placeholder="50000" autofocus></div>
      <div class="form-field"><label>Date de souscription réelle</label><input id="f-direct-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Notes</label><input id="f-direct-notes" placeholder="Ex: Via AV SwissLife..."></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal(); _pendingProduct=null;">Annuler</button>
      <button class="btn success" onclick="handleDirectAdd()">✅ Ajouter</button>
    </div>
  </div></div>`;
  modal.classList.add('visible');
}

async function handleDirectAdd() {
  if (!_pendingProduct) { showToast('Aucun produit en attente', 'error'); return; }
  const amount = document.getElementById('f-direct-amount')?.value;
  if (!amount) { showToast('Montant requis', 'error'); return; }
  const selectedBank = document.getElementById('f-direct-bank')?.value;
  const realDate = document.getElementById('f-direct-date')?.value;
  const notes = document.getElementById('f-direct-notes')?.value;
  if (selectedBank && selectedBank !== 'autre') {
    _pendingProduct.bankId = selectedBank;
    _pendingProduct.bankName = BANKS.find(b => b.id === selectedBank)?.name || selectedBank;
  }
  if (realDate) _pendingProduct.subscriptionDate = realDate;
  if (notes) _pendingProduct.integrationNotes = notes;
  closeModal();
  await app.addToPortfolio(_pendingProduct, amount);
  _pendingProduct = null;
  app.render();
}

// ─── Override showIntegrateModal ─────────────────────────────
const _origShowIntegrateModal = showIntegrateModal;
showIntegrateModal = function(productId, bankId) {
  const product = app._findProduct(productId, bankId);
  const currentBank = product?.bankId || bankId || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Intégrer au portefeuille</h2>
    <div class="form-grid">
      <div class="form-field"><label>Banque / Source</label><select id="f-integrate-bank">
        <option value="">Sélectionner...</option>
        ${BANKS.map(b=>`<option value="${b.id}" ${b.id===currentBank?'selected':''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field"><label>Montant investi (€)</label><input id="f-integrate-amount" type="number" placeholder="50000"></div>
      <div class="form-field"><label>Date de souscription</label><input id="f-integrate-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Notes</label><input id="f-integrate-notes" placeholder="Ex: Via AV SwissLife..."></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrate('${productId}','${bankId}')">✅ Confirmer</button></div></div></div>`;
  modal.classList.add('visible');
};

const _origHandleIntegrate = handleIntegrate;
handleIntegrate = async function(productId, bankId) {
  const amount = document.getElementById('f-integrate-amount')?.value;
  if (!amount) { showToast('Montant requis', 'error'); return; }
  const selectedBank = document.getElementById('f-integrate-bank')?.value;
  const realDate = document.getElementById('f-integrate-date')?.value;
  const notes = document.getElementById('f-integrate-notes')?.value;
  const product = app._findProduct(productId, bankId);
  if (!product) { showToast('Produit introuvable', 'error'); return; }
  if (selectedBank && selectedBank !== 'autre') { product.bankId = selectedBank; product.bankName = BANKS.find(b => b.id === selectedBank)?.name || selectedBank; }
  if (realDate) product.subscriptionDate = realDate;
  if (notes) product.integrationNotes = notes;
  closeModal();
  const resolvedBankId = _resolveBankId(productId, bankId);
  if (resolvedBankId) await app.updateProposalStatus(resolvedBankId, productId, 'subscribed');
  await app.addToPortfolio({ ...product }, amount);
  app.goToDashboard();
};

// ═══════════════════════════════════════════════════════════════
// EDIT METADATA MODAL — Accessible from the product sheet
// Change bank, date, amount, notes at any time
// ═══════════════════════════════════════════════════════════════

function showEditMetadataModal() {
  const p = app.state.currentProduct;
  if (!p) return;
  const currentBank = p.bankId || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">✏️ Modifier les informations</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${p.name || 'Produit'}</div>
    <div class="form-grid">
      <div class="form-field"><label>Banque / Source</label><select id="f-edit-bank">
        <option value="">Non assigné</option>
        ${BANKS.map(b=>`<option value="${b.id}" ${b.id===currentBank?'selected':''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field"><label>Montant investi (€)</label><input id="f-edit-amount" type="number" value="${p.investedAmount || ''}" placeholder="50000"></div>
      <div class="form-field"><label>Date de souscription</label><input id="f-edit-date" type="date" value="${p.subscriptionDate || p.addedDate || ''}"></div>
      <div class="form-field"><label>Notes</label><input id="f-edit-notes" value="${p.integrationNotes || ''}" placeholder="Ex: Via AV SwissLife..."></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="handleEditMetadata()">💾 Enregistrer</button>
    </div>
  </div></div>`;
  modal.classList.add('visible');
}

async function handleEditMetadata() {
  const p = app.state.currentProduct;
  if (!p) return;

  const selectedBank = document.getElementById('f-edit-bank')?.value;
  const amount = document.getElementById('f-edit-amount')?.value;
  const realDate = document.getElementById('f-edit-date')?.value;
  const notes = document.getElementById('f-edit-notes')?.value;

  // Update bank
  if (selectedBank && selectedBank !== 'autre') {
    p.bankId = selectedBank;
    p.bankName = BANKS.find(b => b.id === selectedBank)?.name || selectedBank;
  } else if (!selectedBank) {
    p.bankId = '';
    p.bankName = '';
  }

  // Update metadata
  if (amount) p.investedAmount = parseFloat(amount);
  if (realDate) p.subscriptionDate = realDate;
  p.integrationNotes = notes || '';

  closeModal();

  // Save to GitHub — update both portfolio and product file
  const inPortfolio = app.state.portfolio.find(x => x.id === p.id);
  if (inPortfolio) {
    Object.assign(inPortfolio, { bankId: p.bankId, bankName: p.bankName, investedAmount: p.investedAmount, subscriptionDate: p.subscriptionDate, integrationNotes: p.integrationNotes });
    await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, app.state.portfolio, `[StructBoard] Update metadata: ${p.name || p.id}`);
  }

  // Save product file if it has a bankId
  const resolvedBankId = p.bankId || _resolveBankId(p.id, p.bankId);
  if (resolvedBankId) {
    await app._saveProductFile(resolvedBankId, p);
  }

  showToast('Informations mises à jour', 'success');
  // Re-render the sheet
  app.openProduct(p);
}

// ─── Fix renderProductCard — no UNDEFINED ────────────────────
const _origRenderProductCard = renderProductCard;
renderProductCard = function(product, context) {
  if (!product.bankId || product.bankId === 'undefined' || product.bankId === 'null') product.bankId = '';
  return _origRenderProductCard(product, context);
};

// ─── Fix renderProductSheet — add edit button + fix tags ─────
const _origRenderProductSheet = renderProductSheet;
renderProductSheet = function(container, state) {
  const p = state.currentProduct;
  if (p && (!p.bankId || p.bankId === 'undefined' || p.bankId === 'null')) p.bankId = '';
  _origRenderProductSheet(container, state);

  // Fix subtitle tags
  const subtitleEl = container.querySelector('.fiche-subtitle');
  if (subtitleEl) {
    // Make bank tag clickable to edit
    subtitleEl.querySelectorAll('.fiche-tag.bank').forEach(tag => {
      const txt = tag.textContent.trim();
      if (txt === '\u2014' || txt.toUpperCase() === 'UNDEFINED' || txt === '') {
        tag.textContent = '✏️ Assigner une banque';
        tag.style.color = 'var(--accent)';
        tag.style.borderColor = 'var(--accent)';
        tag.style.cursor = 'pointer';
      } else {
        // Even existing bank tag is clickable to change
        tag.style.cursor = 'pointer';
        tag.title = 'Cliquer pour modifier';
      }
      tag.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
    });

    // Show subscription date
    if (p.subscriptionDate) {
      const d = document.createElement('span');
      d.style.cssText = 'color:var(--text-muted);font-size:11px;cursor:pointer';
      d.title = 'Cliquer pour modifier';
      d.textContent = `\ud83d\udcc5 Souscrit le ${new Date(p.subscriptionDate).toLocaleDateString('fr-FR')}`;
      d.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
      subtitleEl.appendChild(d);
    }
    if (p.integrationNotes) {
      const n = document.createElement('span');
      n.style.cssText = 'color:var(--text-dim);font-size:11px;cursor:pointer';
      n.title = 'Cliquer pour modifier';
      n.textContent = `\ud83d\udcac ${p.integrationNotes}`;
      n.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
      subtitleEl.appendChild(n);
    }

    // Add edit button if no date/notes visible
    if (!p.subscriptionDate && !p.integrationNotes) {
      const editSpan = document.createElement('span');
      editSpan.style.cssText = 'color:var(--accent);font-size:11px;cursor:pointer;text-decoration:underline';
      editSpan.textContent = '✏️ Ajouter banque / date / notes';
      editSpan.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
      subtitleEl.appendChild(editSpan);
    }
  }

  // Add edit button in sidebar
  const sidebar = container.querySelector('.sheet-sidebar .action-buttons');
  if (sidebar) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn lg';
    editBtn.style.cssText = 'width:100%';
    editBtn.innerHTML = '✏️ Modifier banque / date / notes';
    editBtn.onclick = () => showEditMetadataModal();
    // Insert at the top of actions
    sidebar.insertBefore(editBtn, sidebar.firstChild);
  }

  // Fix integrated notice
  if (p.status === 'subscribed') {
    const notice = container.querySelector('.integrated-notice');
    if (notice) {
      const rd = p.subscriptionDate ? new Date(p.subscriptionDate).toLocaleDateString('fr-FR') : formatDate(p.addedDate);
      const bi = p.bankId ? (BANKS.find(b => b.id === p.bankId)?.name || p.bankId) : '';
      notice.innerHTML = `\u2705 Intégré le ${rd}${bi ? '<br>Source: ' + bi : ''}<br>Montant: ${formatNumber(p.investedAmount)}\u20ac${p.integrationNotes ? '<br><span style="color:var(--text-dim);font-size:11px">' + p.integrationNotes + '</span>' : ''}`;
    }
  }
};

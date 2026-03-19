// ═══ PATCHES V5 — Bank source, real date, fix UNDEFINED, fix direct add ═══

// ─── Temporary storage for product being added ──────────────
let _pendingProduct = null;

// ─── Override processUploadedFile — use modal instead of prompt() ──
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
      // Store product and show the full integrate modal
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

// ─── Override handleManualSave — same treatment for manual entry ──
const _origHandleManualSave = handleManualSave;
handleManualSave = function(context, bankId) {
  const product = {
    id: app._uid(),
    name: document.getElementById('f-name')?.value || '',
    bankId: bankId || document.getElementById('f-bank')?.value || '',
    type: document.getElementById('f-type')?.value || 'autre',
    underlyingType: document.getElementById('f-underlying')?.value || 'autre',
    underlyings: [],
    maturity: document.getElementById('f-maturity')?.value || '',
    coupon: { rate: document.getElementById('f-coupon')?.value || null, type: document.getElementById('f-coupon-type')?.value || 'conditionnel' },
    capitalProtection: { barrier: document.getElementById('f-barrier')?.value || null, level: document.getElementById('f-protection')?.value || null, protected: !!(document.getElementById('f-protection')?.value) },
    earlyRedemption: { possible: document.getElementById('f-autocall')?.value === 'true', type: document.getElementById('f-autocall')?.value === 'true' ? 'autocall' : 'none' },
    notes: document.getElementById('f-notes')?.value || '',
  };
  closeModal();
  if (context === 'portfolio') {
    _pendingProduct = product;
    showDirectAddModal(product, bankId);
  } else {
    app.addProposal(bankId, product);
  }
};

// ─── Modal for direct add to portfolio (with bank + date + amount) ──
function showDirectAddModal(product, bankId) {
  const currentBank = product?.bankId || bankId || '';
  const detectedBank = product?.aiParsed?.distributor || product?.aiParsed?.emitter || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Ajouter au portefeuille</h2>
    <div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px;color:var(--text)">
      <strong style="color:var(--accent)">Produit détecté:</strong> ${product.name || 'Sans nom'}
      ${detectedBank ? '<br><strong>Émetteur/Distributeur:</strong> ' + detectedBank : ''}
    </div>
    <div class="form-grid">
      <div class="form-field"><label>Banque qui te l'a proposé</label><select id="f-direct-bank">
        <option value="">Sélectionner la banque...</option>
        ${BANKS.map(b=>`<option value="${b.id}" ${b.id===currentBank || (detectedBank && b.name.toLowerCase().includes(detectedBank.toLowerCase().substring(0,4))) ? 'selected' : ''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field"><label>Montant investi (€)</label><input id="f-direct-amount" type="number" placeholder="50000" autofocus></div>
      <div class="form-field"><label>Date de souscription réelle</label><input id="f-direct-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Notes (optionnel)</label><input id="f-direct-notes" placeholder="Ex: Via AV SwissLife, Compte-titres CIC..."></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal(); _pendingProduct=null;">Annuler</button>
      <button class="btn success" onclick="handleDirectAdd()">✅ Ajouter au portefeuille</button>
    </div>
  </div></div>`;
  modal.classList.add('visible');
}

// ─── Handle direct add confirmation ─────────────────────────
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

// ─── Override showIntegrateModal — add bank source + date + notes ──
const _origShowIntegrateModal = showIntegrateModal;
showIntegrateModal = function(productId, bankId) {
  const product = app._findProduct(productId, bankId);
  const currentBank = product?.bankId || bankId || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Intégrer au portefeuille</h2>
    <div class="form-grid">
      <div class="form-field"><label>Banque / Source du produit</label><select id="f-integrate-bank">
        <option value="">Sélectionner la banque...</option>
        ${BANKS.map(b=>`<option value="${b.id}" ${b.id===currentBank?'selected':''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field"><label>Montant investi (€)</label><input id="f-integrate-amount" type="number" placeholder="50000"></div>
      <div class="form-field"><label>Date de souscription réelle</label><input id="f-integrate-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Notes (optionnel)</label><input id="f-integrate-notes" placeholder="Ex: Via AV SwissLife, conseiller M. Dupont"></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrate('${productId}','${bankId}')">✅ Confirmer</button></div></div></div>`;
  modal.classList.add('visible');
};

// ─── Override handleIntegrate — save bank + real date + notes ──
const _origHandleIntegrate = handleIntegrate;
handleIntegrate = async function(productId, bankId) {
  const amount = document.getElementById('f-integrate-amount')?.value;
  if (!amount) { showToast('Montant requis', 'error'); return; }
  const selectedBank = document.getElementById('f-integrate-bank')?.value;
  const realDate = document.getElementById('f-integrate-date')?.value;
  const notes = document.getElementById('f-integrate-notes')?.value;
  const product = app._findProduct(productId, bankId);
  if (!product) { showToast('Produit introuvable', 'error'); return; }
  if (selectedBank && selectedBank !== 'autre') {
    product.bankId = selectedBank;
    product.bankName = BANKS.find(b => b.id === selectedBank)?.name || selectedBank;
  }
  if (realDate) product.subscriptionDate = realDate;
  if (notes) product.integrationNotes = notes;
  closeModal();
  const resolvedBankId = _resolveBankId(productId, bankId);
  if (resolvedBankId) await app.updateProposalStatus(resolvedBankId, productId, 'subscribed');
  await app.addToPortfolio({ ...product }, amount);
  app.goToDashboard();
};

// ─── Fix renderProductCard — no more UNDEFINED bank ─────────
const _origRenderProductCard = renderProductCard;
renderProductCard = function(product, context) {
  if (!product.bankId || product.bankId === 'undefined' || product.bankId === 'null') product.bankId = '';
  return _origRenderProductCard(product, context);
};

// ─── Fix renderProductSheet — no UNDEFINED + show subscription info ──
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
        tag.textContent = 'Non assign\u00e9';
        tag.style.color = 'var(--text-dim)';
        tag.style.borderColor = 'var(--border)';
      }
    });
    if (p.subscriptionDate) {
      const d = document.createElement('span');
      d.style.cssText = 'color:var(--text-muted);font-size:11px';
      d.textContent = `\ud83d\udcc5 Souscrit le ${new Date(p.subscriptionDate).toLocaleDateString('fr-FR')}`;
      subtitleEl.appendChild(d);
    }
    if (p.integrationNotes) {
      const n = document.createElement('span');
      n.style.cssText = 'color:var(--text-dim);font-size:11px';
      n.textContent = `\ud83d\udcac ${p.integrationNotes}`;
      subtitleEl.appendChild(n);
    }
  }
  if (p.status === 'subscribed') {
    const notice = container.querySelector('.integrated-notice');
    if (notice) {
      const rd = p.subscriptionDate ? new Date(p.subscriptionDate).toLocaleDateString('fr-FR') : formatDate(p.addedDate);
      const bi = p.bankId ? (BANKS.find(b => b.id === p.bankId)?.name || p.bankId) : '';
      notice.innerHTML = `\u2705 Int\u00e9gr\u00e9 le ${rd}${bi ? '<br>Source: ' + bi : ''}<br>Montant: ${formatNumber(p.investedAmount)}\u20ac${p.integrationNotes ? '<br><span style="color:var(--text-dim);font-size:11px">' + p.integrationNotes + '</span>' : ''}`;
    }
  }
};

// ═══ PATCHES V4 — Bank source, real date, fix UNDEFINED ═══

// Override showIntegrateModal — add bank source + date + notes
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
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrate('${productId}','${bankId}')">\u2705 Confirmer</button></div></div></div>`;
  modal.classList.add('visible');
};

// Override handleIntegrate — save bank + real date + notes
const _origHandleIntegrate = handleIntegrate;
handleIntegrate = async function(productId, bankId) {
  const amount = document.getElementById('f-integrate-amount')?.value;
  if (!amount) { showToast('Montant requis','error'); return; }
  const selectedBank = document.getElementById('f-integrate-bank')?.value;
  const realDate = document.getElementById('f-integrate-date')?.value;
  const notes = document.getElementById('f-integrate-notes')?.value;
  const product = app._findProduct(productId, bankId);
  if (!product) { showToast('Produit introuvable','error'); return; }
  if (selectedBank && selectedBank !== 'autre') {
    product.bankId = selectedBank;
    product.bankName = BANKS.find(b=>b.id===selectedBank)?.name || selectedBank;
  }
  if (realDate) product.subscriptionDate = realDate;
  if (notes) product.integrationNotes = notes;
  closeModal();
  const resolvedBankId = _resolveBankId(productId, bankId);
  if (resolvedBankId) await app.updateProposalStatus(resolvedBankId, productId, 'subscribed');
  await app.addToPortfolio({...product}, amount);
  app.goToDashboard();
};

// Fix renderProductCard — no more UNDEFINED bank
const _origRenderProductCard = renderProductCard;
renderProductCard = function(product, context) {
  if (!product.bankId || product.bankId === 'undefined' || product.bankId === 'null') product.bankId = '';
  return _origRenderProductCard(product, context);
};

// Fix renderProductSheet — no UNDEFINED tag + show subscription info
const _origRenderProductSheet = renderProductSheet;
renderProductSheet = function(container, state) {
  const p = state.currentProduct;
  if (p && (!p.bankId || p.bankId === 'undefined' || p.bankId === 'null')) p.bankId = '';
  _origRenderProductSheet(container, state);

  // Fix UNDEFINED tags after render
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
    // Show real subscription date
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
  // Fix sidebar integrated notice
  if (p.status === 'subscribed') {
    const notice = container.querySelector('.integrated-notice');
    if (notice) {
      const rd = p.subscriptionDate ? new Date(p.subscriptionDate).toLocaleDateString('fr-FR') : formatDate(p.addedDate);
      const bi = p.bankId ? (BANKS.find(b=>b.id===p.bankId)?.name || p.bankId) : '';
      notice.innerHTML = `\u2705 Int\u00e9gr\u00e9 le ${rd}${bi ? '<br>Source: '+bi : ''}<br>Montant: ${formatNumber(p.investedAmount)}\u20ac${p.integrationNotes ? '<br><span style="color:var(--text-dim);font-size:11px">'+p.integrationNotes+'</span>' : ''}`;
    }
  }
};

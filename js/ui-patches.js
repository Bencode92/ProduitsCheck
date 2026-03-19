// ═══ PATCHES V11 — Tracking integration (gauges, alerts, sheet section) ═══

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
// renderProductCard — entity badge + annualized coupon + TRACKING GAUGE
// ═══════════════════════════════════════════════════════════════
const _origRenderProductCard = renderProductCard;
renderProductCard = function(product, context) {
  if (!product.bankId || product.bankId === 'undefined' || product.bankId === 'null') product.bankId = '';
  // Swap coupon to annualized
  const origRate = product.coupon?.rate;
  if (product.coupon && typeof getAnnualizedRate === 'function') {
    const ann = getAnnualizedRate(product);
    if (ann !== origRate && ann > 0) { product.coupon._origRate = origRate; product.coupon.rate = ann; }
  }
  let html = _origRenderProductCard(product, context);
  // Restore
  if (product.coupon?._origRate !== undefined) { product.coupon.rate = product.coupon._origRate; delete product.coupon._origRate; }

  // Inject entity badge
  if (product.entity) {
    const ei = MY_ENTITIES.find(e => e.id === product.entity);
    if (ei) {
      const badge = `<div class="product-card-bank" style="color:${ei.color};border-color:${ei.color}33;background:${ei.color}12;margin-left:4px">${ei.icon} ${ei.name}</div>`;
      html = html.replace('</div></div>\n    <div class="product-card-type">', `${badge}</div></div>\n    <div class="product-card-type">`);
    }
  }

  // Inject tracking gauge before closing </div> of the card
  if (product.tracking?.level != null && typeof renderTrackingGauge === 'function') {
    const gauge = renderTrackingGauge(product);
    html = html.replace(/<\/div>$/, gauge + '</div>');
  }

  return html;
};

// ═══════════════════════════════════════════════════════════════
// renderDashboard — yield card + coupon fix + TRACKING ALERTS
// ═══════════════════════════════════════════════════════════════
const _origRenderDashboard = renderDashboard;
renderDashboard = function(container, state) {
  _origRenderDashboard(container, state);

  const portfolio = state.portfolio || [];
  let annualYield = 0, totalWeightedRate = 0, totalInvested = 0;
  portfolio.forEach(p => {
    const amount = parseFloat(p.investedAmount) || 0;
    totalInvested += amount;
    const annRate = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
    totalWeightedRate += amount * annRate;
    annualYield += Math.round(amount * annRate / 100);
  });
  const avgYieldPct = totalInvested > 0 ? (totalWeightedRate / totalInvested) : 0;

  // Fix Coupon Moyen card
  container.querySelectorAll('.stat-card.orange').forEach(card => {
    const label = card.querySelector('.stat-label');
    if (label && label.textContent.includes('Coupon')) {
      const v = card.querySelector('.stat-value'), s = card.querySelector('.stat-sub');
      if (v) v.textContent = avgYieldPct.toFixed(2).replace('.', ',') + '%';
      if (s) s.textContent = 'annualisé pondéré';
    }
  });

  // Add Rendement Annuel card
  const statsRow = container.querySelector('.stats-row');
  if (statsRow) {
    const yc = document.createElement('div'); yc.className = 'stat-card green';
    yc.innerHTML = `<div class="stat-label">Rendement Annuel</div><div class="stat-value">${formatNumber(annualYield)}€</div><div class="stat-sub">${avgYieldPct.toFixed(2).replace('.',',')}% moyen pondéré</div>`;
    statsRow.appendChild(yc);
  }

  // ─── TRACKING ALERTS ──────────────────────────────────────
  if (typeof getPortfolioAlerts === 'function') {
    const alerts = getPortfolioAlerts(portfolio);
    if (alerts.length > 0) {
      const alertColors = { danger: 'rgba(229,57,53,0.15)', warn: 'rgba(255,183,77,0.15)', success: 'rgba(76,175,80,0.15)', info: 'rgba(100,181,246,0.15)' };
      const alertBorders = { danger: '#E53935', warn: '#FFB74D', success: '#4CAF50', info: '#64B5F6' };
      const alertsHTML = alerts.map(a => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${alertColors[a.type]};border-left:3px solid ${alertBorders[a.type]};border-radius:0 var(--radius-sm) var(--radius-sm) 0;cursor:pointer" onclick="app.openProduct(app._findProduct('${a.productId}','${a.bankId||''}'))">
        <span>${a.icon}</span><span style="font-size:12px;color:var(--text)">${a.text}</span></div>`).join('');

      // Insert after concentrations alert or after stats row
      const existingAlert = container.querySelector('.alert-bar');
      const trackingAlerts = document.createElement('div');
      trackingAlerts.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:16px';
      trackingAlerts.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:4px">📍 SUIVI POSITIONS</div>${alertsHTML}`;
      if (existingAlert) { existingAlert.after(trackingAlerts); }
      else { statsRow?.after(trackingAlerts); }
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// renderProductSheet — entity + subscription + annualized + TRACKING
// ═══════════════════════════════════════════════════════════════
const _origRenderProductSheet = renderProductSheet;
renderProductSheet = function(container, state) {
  const p = state.currentProduct;
  if (p && (!p.bankId || p.bankId === 'undefined' || p.bankId === 'null')) p.bankId = '';
  _origRenderProductSheet(container, state);

  // Fix coupon to annualized
  if (typeof getAnnualizedRate === 'function' && p.coupon?.rate) {
    const ann = getAnnualizedRate(p), raw = parseFloat(p.coupon.rate) || 0;
    if (ann !== raw && ann > 0) {
      const cm = container.querySelector('.fiche-metric.green .fiche-metric-value');
      if (cm) cm.innerHTML = formatPct(ann) + ' <span style="font-size:10px;color:var(--text-dim)">(' + formatPct(raw) + '/' + (p.coupon.frequency || 'période') + ')</span>';
    }
  }

  // ─── Inject TRACKING SECTION into sheet-main ──────────────
  if (typeof renderTrackingSection === 'function') {
    const sheetMain = container.querySelector('.sheet-main');
    if (sheetMain) {
      const trackDiv = document.createElement('div');
      trackDiv.innerHTML = renderTrackingSection(p);
      // Insert after métriques, before résumé IA
      const firstSection = sheetMain.querySelector('.fiche-section');
      if (firstSection) { sheetMain.insertBefore(trackDiv.firstElementChild, firstSection); }
      else { sheetMain.appendChild(trackDiv.firstElementChild); }
    }
  }

  // ─── Subtitle tags (entity, bank, dates) ──────────────────
  const subtitleEl = container.querySelector('.fiche-subtitle');
  if (subtitleEl) {
    subtitleEl.querySelectorAll('.fiche-tag.bank').forEach(tag => {
      const txt = tag.textContent.trim();
      if (txt === '\u2014' || txt.toUpperCase() === 'UNDEFINED' || txt === '') {
        tag.textContent = '\u270f\ufe0f Assigner'; tag.style.color = 'var(--accent)'; tag.style.borderColor = 'var(--accent)';
      }
      tag.style.cursor = 'pointer';
      tag.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
    });
    if (p.entity) {
      const ei = MY_ENTITIES.find(e => e.id === p.entity);
      if (ei) {
        const et = document.createElement('span'); et.className = 'fiche-tag bank';
        et.style.cssText = `color:${ei.color};border-color:${ei.color};cursor:pointer`;
        et.textContent = `${ei.icon} ${ei.name}`;
        et.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); };
        subtitleEl.insertBefore(et, subtitleEl.firstChild);
      }
    }
    if (p.subscriptionDate) {
      const d = document.createElement('span'); d.style.cssText = 'color:var(--text-muted);font-size:11px;cursor:pointer';
      d.textContent = `\ud83d\udcc5 Souscrit le ${new Date(p.subscriptionDate).toLocaleDateString('fr-FR')}`;
      d.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; subtitleEl.appendChild(d);
    }
    if (p.integrationNotes) {
      const n = document.createElement('span'); n.style.cssText = 'color:var(--text-dim);font-size:11px;cursor:pointer';
      n.textContent = `\ud83d\udcac ${p.integrationNotes}`;
      n.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; subtitleEl.appendChild(n);
    }
    if (!p.entity && !p.subscriptionDate) {
      const es = document.createElement('span'); es.style.cssText = 'color:var(--accent);font-size:11px;cursor:pointer;text-decoration:underline';
      es.textContent = '\u270f\ufe0f Compléter'; es.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; subtitleEl.appendChild(es);
    }
  }

  // ─── Sidebar buttons ──────────────────────────────────────
  const sidebar = container.querySelector('.sheet-sidebar .action-buttons');
  if (sidebar) {
    // Edit button
    const editBtn = document.createElement('button'); editBtn.className = 'btn lg'; editBtn.style.cssText = 'width:100%';
    editBtn.innerHTML = '\u270f\ufe0f Modifier infos'; editBtn.onclick = () => showEditMetadataModal();
    sidebar.insertBefore(editBtn, sidebar.firstChild);
    // Tracking button
    if (typeof showTrackingModal === 'function') {
      const trackBtn = document.createElement('button'); trackBtn.className = 'btn lg'; trackBtn.style.cssText = 'width:100%;background:var(--surface);border:1px solid var(--border)';
      trackBtn.innerHTML = '\ud83d\udccd Valorisation sous-jacent'; trackBtn.onclick = () => showTrackingModal();
      sidebar.insertBefore(trackBtn, sidebar.children[1] || null);
    }
  }

  // Fix integrated notice
  if (p.status === 'subscribed') {
    const notice = container.querySelector('.integrated-notice');
    if (notice) {
      const rd = p.subscriptionDate ? new Date(p.subscriptionDate).toLocaleDateString('fr-FR') : formatDate(p.addedDate);
      const el = p.entity ? (MY_ENTITIES.find(e => e.id === p.entity)?.name || '') : '';
      const bl = p.bankId ? (BANKS_LIST.find(b => b.id === p.bankId)?.name || p.bankId) : '';
      notice.innerHTML = `\u2705 Intégré le ${rd}${el ? '<br>\ud83c\udfe2 ' + el : ''}${bl ? '<br>\ud83c\udfe6 ' + bl : ''}<br>Montant: ${formatNumber(p.investedAmount)}\u20ac${p.integrationNotes ? '<br><span style="color:var(--text-dim);font-size:11px">' + p.integrationNotes + '</span>' : ''}`;
    }
  }
};

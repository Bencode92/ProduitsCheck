// ═══ PATCHES V12c — AI Portfolio Summary button ═══

let _pendingProduct = null;

function entityOptionsHTML(selected) { return `<option value="">Sélectionner...</option>${MY_ENTITIES.map(e => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${e.icon} ${e.name}</option>`).join('')}`; }
function bankOnlyOptionsHTML(selected) { return `<option value="">Sélectionner...</option>${BANKS_LIST.map(b => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${b.name}</option>`).join('')}<option value="autre">Autre</option>`; }
function metadataFieldsHTML(p) {
  const entity = p?.entity || '', bank = p?.bankId || '', amount = p?.investedAmount || '';
  const date = p?.subscriptionDate || new Date().toISOString().split('T')[0], notes = p?.integrationNotes || '';
  return `<div class="form-field"><label>🏢 Entreprise</label><select id="f-meta-entity">${entityOptionsHTML(entity)}</select></div>
    <div class="form-field"><label>🏦 Banque source</label><select id="f-meta-bank">${bankOnlyOptionsHTML(bank)}</select></div>
    <div class="form-field"><label>Montant investi (€)</label><input id="f-meta-amount" type="number" value="${amount}" placeholder="50000"></div>
    <div class="form-field"><label>Date de souscription</label><input id="f-meta-date" type="date" value="${date}"></div>
    <div class="form-field full"><label>Notes</label><input id="f-meta-notes" value="${notes}" placeholder="Ex: Via AV SwissLife..."></div>`;
}
function readMetadataForm() { return { entity: document.getElementById('f-meta-entity')?.value||'', bankId: document.getElementById('f-meta-bank')?.value||'', amount: document.getElementById('f-meta-amount')?.value||'', date: document.getElementById('f-meta-date')?.value||'', notes: document.getElementById('f-meta-notes')?.value||'' }; }
function applyMetadata(product, meta) {
  if (meta.entity) { product.entity = meta.entity; product.entityName = MY_ENTITIES.find(e => e.id === meta.entity)?.name || meta.entity; }
  if (meta.bankId && meta.bankId !== 'autre') { product.bankId = meta.bankId; product.bankName = BANKS_LIST.find(b => b.id === meta.bankId)?.name || meta.bankId; }
  if (meta.amount) product.investedAmount = parseFloat(meta.amount);
  if (meta.date) product.subscriptionDate = meta.date;
  product.integrationNotes = meta.notes || '';
}
function _isInPortfolio(p) { return !!(app.state.portfolio || []).find(x => x.id === p.id); }
function _injectBeforeLastDiv(html, content) { const idx = html.lastIndexOf('</div>'); if (idx < 0) return html + content; return html.substring(0, idx) + content + html.substring(idx); }

const _origProcessUploadedFile = processUploadedFile;
processUploadedFile = async function(file, context, bankId) {
  const progress = document.getElementById('upload-progress'), status = document.getElementById('upload-status');
  if (progress) progress.classList.remove('hidden');
  try { if (status) status.textContent = 'Extraction...';
    const product = await app.handlePDFUpload(file, bankId); if (status) status.textContent = 'OK!';
    if (context === 'portfolio') { _pendingProduct = product; const m = document.getElementById('modal'); m.classList.remove('visible'); m.innerHTML = ''; setTimeout(() => showDirectAddModal(product, bankId), 350); }
    else { closeModal(); await app.addProposal(bankId, product); app.render(); }
  } catch (e) { if (status) status.textContent = 'Erreur: ' + e.message; }
};
const _origHandleManualSave = handleManualSave;
handleManualSave = function(context, bankId) {
  const product = { id: app._uid(), name: document.getElementById('f-name')?.value||'', bankId: bankId||document.getElementById('f-bank')?.value||'', type: document.getElementById('f-type')?.value||'autre', underlyingType: document.getElementById('f-underlying')?.value||'autre', underlyings: [], maturity: document.getElementById('f-maturity')?.value||'', coupon: { rate: document.getElementById('f-coupon')?.value||null, type: document.getElementById('f-coupon-type')?.value||'conditionnel' }, capitalProtection: { barrier: document.getElementById('f-barrier')?.value||null, level: document.getElementById('f-protection')?.value||null, protected: !!(document.getElementById('f-protection')?.value) }, earlyRedemption: { possible: document.getElementById('f-autocall')?.value==='true', type: document.getElementById('f-autocall')?.value==='true'?'autocall':'none' }, notes: document.getElementById('f-notes')?.value||'' };
  if (context === 'portfolio') { _pendingProduct = product; const m = document.getElementById('modal'); m.classList.remove('visible'); m.innerHTML = ''; setTimeout(() => showDirectAddModal(product, bankId), 350); }
  else { closeModal(); app.addProposal(bankId, product); }
};
function showDirectAddModal(product, bankId) {
  const det = product?.aiParsed?.distributor||product?.aiParsed?.emitter||''; product.bankId = product.bankId||bankId||'';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()"><h2 class="modal-title">Ajouter au portefeuille</h2><div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px"><strong style="color:var(--accent)">Produit:</strong> ${product.name||'Sans nom'}${det ? '<br><strong>Distributeur:</strong> ' + det : ''}</div><div class="form-grid">${metadataFieldsHTML(product)}</div><div class="modal-actions"><button class="btn" onclick="closeModal();_pendingProduct=null;">Annuler</button><button class="btn success" onclick="handleDirectAdd()">✅ Ajouter</button></div></div></div>`;
  modal.classList.add('visible');
}
async function handleDirectAdd() { if (!_pendingProduct) return; const meta = readMetadataForm(); if (!meta.amount) { showToast('Montant requis','error'); return; } applyMetadata(_pendingProduct, meta); closeModal(); await app.addToPortfolio(_pendingProduct, meta.amount); _pendingProduct = null; app.render(); }
const _origShowIntegrateModal = showIntegrateModal;
showIntegrateModal = function(pid, bid) { const p = app._findProduct(pid, bid); if (!p) return; p.bankId = p.bankId||bid||''; const modal = document.getElementById('modal'); modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()"><h2 class="modal-title">Intégrer</h2><div class="form-grid">${metadataFieldsHTML(p)}</div><div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrate('${pid}','${bid}')">✅ Confirmer</button></div></div></div>`; modal.classList.add('visible'); };
const _origHandleIntegrate = handleIntegrate;
handleIntegrate = async function(pid, bid) { const meta = readMetadataForm(); if (!meta.amount) { showToast('Montant requis','error'); return; } const p = app._findProduct(pid, bid); if (!p) return; applyMetadata(p, meta); closeModal(); const rb = _resolveBankId(pid, bid); if (rb) await app.updateProposalStatus(rb, pid, 'subscribed'); await app.addToPortfolio({...p}, meta.amount); app.goToDashboard(); };

function showEditMetadataModal() { const p = app.state.currentProduct; if (!p) return; const modal = document.getElementById('modal'); modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()"><h2 class="modal-title">✏️ Modifier</h2><div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${p.name||''}</div><div class="form-grid">${metadataFieldsHTML(p)}</div><div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleEditMetadata()">💾 Enregistrer</button></div></div></div>`; modal.classList.add('visible'); }
async function handleEditMetadata() { const p = app.state.currentProduct; if (!p) return; const meta = readMetadataForm(); applyMetadata(p, meta); if (!meta.entity) { p.entity=''; p.entityName=''; } if (!meta.bankId) { p.bankId=''; p.bankName=''; } closeModal(); const ip = app.state.portfolio.find(x => x.id === p.id); if (ip) { Object.assign(ip, {entity:p.entity,entityName:p.entityName,bankId:p.bankId,bankName:p.bankName,investedAmount:p.investedAmount,subscriptionDate:p.subscriptionDate,integrationNotes:p.integrationNotes}); await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, app.state.portfolio, `[StructBoard] Update: ${p.name||p.id}`); } if (p.bankId) await app._saveProductFile(p.bankId, p); showToast('OK','success'); app.openProduct(p); }

// ═══════════════════════════════════════════════════════════════
// AI PORTFOLIO SUMMARY
// ═══════════════════════════════════════════════════════════════
async function generatePortfolioSummary() {
  const btn = document.getElementById('ai-summary-btn');
  const box = document.getElementById('ai-summary-box');
  if (!btn || !box) return;
  btn.disabled = true; btn.innerHTML = '⏳ Analyse en cours...';
  box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 8px"></div>Claude analyse votre portefeuille...</div>';
  box.style.display = 'block';

  const portfolio = (app.state.portfolio || []).filter(p => !p.archived);
  const archived = (app.state.portfolio || []).filter(p => p.archived);

  // Build compact portfolio data for the prompt
  const productsData = portfolio.map(p => {
    const annRate = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
    const s = typeof getTrackingStatus === 'function' ? getTrackingStatus(p) : null;
    return {
      nom: (p.name || '').substring(0, 50),
      montant: parseFloat(p.investedAmount) || 0,
      coupon_annualise: annRate + '%',
      rendement_annuel: Math.round((parseFloat(p.investedAmount) || 0) * annRate / 100) + '€',
      barriere: p.capitalProtection?.barrier ? p.capitalProtection.barrier + '%' : 'N/A',
      maturite: p.maturity || 'N/A',
      autocall: p.earlyRedemption?.possible ? 'oui' : 'non',
      memoire: p.coupon?.memory ? 'oui' : 'non',
      entite: p.entity ? (MY_ENTITIES.find(e => e.id === p.entity)?.name || '') : '',
      banque: BANKS_LIST.find(b => b.id === p.bankId)?.name || '',
      tracking: s ? {
        variation: (s.variation >= 0 ? '+' : '') + s.variation.toFixed(1) + '%',
        coupon_ok: s.couponOK,
        marge_barriere: s.margeRestante ? s.margeRestante.toFixed(1) + '%' : 'N/A',
        date: s.date
      } : null
    };
  });

  const totalInvested = portfolio.reduce((s, p) => s + (parseFloat(p.investedAmount) || 0), 0);
  const totalYield = portfolio.reduce((s, p) => {
    const annRate = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
    return s + Math.round((parseFloat(p.investedAmount) || 0) * annRate / 100);
  }, 0);

  const prompt = `Tu es un conseiller financier spécialisé en produits structurés. Analyse ce portefeuille et donne un résumé clair et actionnable en français.

PORTEFEUILLE ACTIF (${portfolio.length} produits, ${formatNumber(totalInvested)}€ investis, rendement estimé ${formatNumber(totalYield)}€/an):

${JSON.stringify(productsData, null, 1)}

${archived.length > 0 ? `PRODUITS ARCHIVÉS: ${archived.length} produits, gain total: ${formatNumber(archived.reduce((s,p) => s + (p.archived?.gainTotal||0), 0))}€` : ''}

Réponds en 3 sections courtes:
1. **SITUATION GLOBALE** (2-3 phrases max): résumé chiffré de la situation actuelle
2. **POINTS D'ATTENTION** (liste courte): risques, coupons perdus, produits proches des barrières, concentrations
3. **RECOMMANDATIONS** (2-3 max): actions concrètes à prendre maintenant

Sois direct, pas de jargon inutile. Utilise les chiffres du portefeuille. Si un coupon est perdu ou une barrière proche, dis-le clairement avec le montant impacté.`;

  try {
    const resp = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || data.error?.message || 'Erreur';
    // Format markdown-like text to HTML
    let html = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^### (.+)$/gm, '<h3 style="color:var(--accent);margin:12px 0 6px;font-size:14px">$1</h3>')
      .replace(/^## (.+)$/gm, '<h3 style="color:var(--accent);margin:12px 0 6px;font-size:14px">$1</h3>')
      .replace(/^\d+\.\s*\*\*(.+?)\*\*/gm, '<h3 style="color:var(--accent);margin:12px 0 6px;font-size:14px">$1</h3>')
      .replace(/^- (.+)$/gm, '<div style="display:flex;gap:6px;margin:4px 0"><span>▸</span><span>$1</span></div>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    box.innerHTML = `<div style="font-size:13px;line-height:1.6;color:var(--text)">${html}</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:12px;text-align:right">Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</div>`;
  } catch (e) {
    box.innerHTML = `<div style="color:var(--red);padding:12px">Erreur: ${e.message}</div>`;
  }
  btn.disabled = false; btn.innerHTML = '🤖 Résumé IA du portefeuille';
}

// ═══ renderProductCard ═══
const _origRenderProductCard = renderProductCard;
renderProductCard = function(product, context) {
  if (!product.bankId || product.bankId === 'undefined' || product.bankId === 'null') product.bankId = '';
  const origRate = product.coupon?.rate;
  if (product.coupon && typeof getAnnualizedRate === 'function') { const ann = getAnnualizedRate(product); if (ann !== origRate && ann > 0) { product.coupon._origRate = origRate; product.coupon.rate = ann; } }
  let html = _origRenderProductCard(product, context);
  if (product.coupon?._origRate !== undefined) { product.coupon.rate = product.coupon._origRate; delete product.coupon._origRate; }
  if (product.entity) {
    const ei = MY_ENTITIES.find(e => e.id === product.entity);
    if (ei) { const badge = `<div class="product-card-bank" style="color:${ei.color};border-color:${ei.color}33;background:${ei.color}12;margin-left:4px">${ei.icon} ${ei.name}</div>`; const headerEnd = html.indexOf('</div></div>'); if (headerEnd >= 0) html = html.substring(0, headerEnd) + badge + html.substring(headerEnd); }
  }
  let extra = '';
  if (product.archived && typeof renderArchiveBadge === 'function') extra = renderArchiveBadge(product);
  else if (product.tracking?.level != null && typeof renderTrackingGauge === 'function') extra = renderTrackingGauge(product);
  if (extra) html = _injectBeforeLastDiv(html, extra);
  return html;
};

// ═══ renderDashboard — with AI SUMMARY button ═══
const _origRenderDashboard = renderDashboard;
renderDashboard = function(container, state) {
  _origRenderDashboard(container, state);
  const allPortfolio = state.portfolio || [];
  const active = allPortfolio.filter(p => !p.archived);
  const archived = allPortfolio.filter(p => p.archived);
  let annualYield = 0, totalWeightedRate = 0, totalInvested = 0;
  active.forEach(p => { const amount = parseFloat(p.investedAmount)||0; totalInvested += amount; const annRate = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate)||0); totalWeightedRate += amount * annRate; annualYield += Math.round(amount * annRate / 100); });
  const avgYieldPct = totalInvested > 0 ? (totalWeightedRate / totalInvested) : 0;
  container.querySelectorAll('.stat-card.orange').forEach(card => { const label = card.querySelector('.stat-label'); if (label && label.textContent.includes('Coupon')) { const v = card.querySelector('.stat-value'), s = card.querySelector('.stat-sub'); if (v) v.textContent = avgYieldPct.toFixed(2).replace('.',',')+'%'; if (s) s.textContent = 'annualisé pondéré'; } });
  const statsRow = container.querySelector('.stats-row');
  if (statsRow) { const yc = document.createElement('div'); yc.className = 'stat-card green'; yc.innerHTML = `<div class="stat-label">Rendement Annuel</div><div class="stat-value">${formatNumber(annualYield)}€</div><div class="stat-sub">${avgYieldPct.toFixed(2).replace('.',',')}% pondéré</div>`; statsRow.appendChild(yc); }

  // ─── AI SUMMARY BUTTON + BOX (after stats) ────────────────
  if (active.length > 0) {
    const aiDiv = document.createElement('div');
    aiDiv.style.cssText = 'margin-bottom:16px';
    aiDiv.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <button id="ai-summary-btn" class="btn ai-glow" onclick="generatePortfolioSummary()" style="white-space:nowrap">🤖 Résumé IA du portefeuille</button>
      <span style="font-size:11px;color:var(--text-dim)">Analyse complète de vos positions par Claude</span>
    </div>
    <div id="ai-summary-box" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px"></div>`;
    const alertBar = container.querySelector('.alert-bar');
    if (alertBar) alertBar.after(aiDiv);
    else if (statsRow) statsRow.after(aiDiv);
  }

  // Tracking alerts
  if (typeof getPortfolioAlerts === 'function') {
    const alerts = getPortfolioAlerts(active);
    if (alerts.length > 0) {
      const ac = { danger:'rgba(229,57,53,0.15)', warn:'rgba(255,183,77,0.15)', success:'rgba(76,175,80,0.15)', info:'rgba(100,181,246,0.15)' };
      const ab = { danger:'#E53935', warn:'#FFB74D', success:'#4CAF50', info:'#64B5F6' };
      const ah = alerts.map(a => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${ac[a.type]};border-left:3px solid ${ab[a.type]};border-radius:0 var(--radius-sm) var(--radius-sm) 0;cursor:pointer" onclick="app.openProduct(app._findProduct('${a.productId}','${a.bankId||''}'))"><span>${a.icon}</span><span style="font-size:12px">${a.text}</span></div>`).join('');
      const aiBox = document.getElementById('ai-summary-box');
      const insertAfter = aiBox?.parentElement || container.querySelector('.alert-bar') || statsRow;
      const ta = document.createElement('div'); ta.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:16px';
      ta.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:4px">📍 SUIVI POSITIONS</div>${ah}`;
      if (insertAfter) insertAfter.after(ta);
    }
  }
  if (archived.length > 0 && typeof renderArchivedSection === 'function') {
    const archHTML = renderArchivedSection(state);
    if (archHTML) { const archDiv = document.createElement('div'); archDiv.innerHTML = archHTML; container.appendChild(archDiv); }
  }
};

// ═══ renderProductSheet ═══
const _origRenderProductSheet = renderProductSheet;
renderProductSheet = function(container, state) {
  const p = state.currentProduct;
  if (p && (!p.bankId || p.bankId === 'undefined' || p.bankId === 'null')) p.bankId = '';
  _origRenderProductSheet(container, state);
  if (typeof getAnnualizedRate === 'function' && p.coupon?.rate) {
    const ann = getAnnualizedRate(p), raw = parseFloat(p.coupon.rate)||0;
    if (ann !== raw && ann > 0) { const cm = container.querySelector('.fiche-metric.green .fiche-metric-value'); if (cm) cm.innerHTML = formatPct(ann) + ' <span style="font-size:10px;color:var(--text-dim)">(' + formatPct(raw) + '/' + (p.coupon.frequency||'période') + ')</span>'; }
  }
  if (p.archived && typeof renderArchiveSection === 'function') { const sm = container.querySelector('.sheet-main'); if (sm) { const ad = document.createElement('div'); ad.innerHTML = renderArchiveSection(p); sm.insertBefore(ad.firstElementChild, sm.firstChild); } }
  if (typeof renderTrackingSection === 'function' && !p.archived) { const sm = container.querySelector('.sheet-main'); if (sm) { const td = document.createElement('div'); td.innerHTML = renderTrackingSection(p); const fs = sm.querySelector('.fiche-section'); if (fs) sm.insertBefore(td.firstElementChild, fs); else sm.appendChild(td.firstElementChild); } }
  const subtitleEl = container.querySelector('.fiche-subtitle');
  if (subtitleEl) {
    subtitleEl.querySelectorAll('.fiche-tag.bank').forEach(tag => { const txt = tag.textContent.trim(); if (txt === '\u2014' || txt.toUpperCase() === 'UNDEFINED' || txt === '') { tag.textContent = '\u270f\ufe0f Assigner'; tag.style.color = 'var(--accent)'; tag.style.borderColor = 'var(--accent)'; } tag.style.cursor = 'pointer'; tag.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; });
    if (p.entity) { const ei = MY_ENTITIES.find(e => e.id === p.entity); if (ei) { const et = document.createElement('span'); et.className = 'fiche-tag bank'; et.style.cssText = `color:${ei.color};border-color:${ei.color};cursor:pointer`; et.textContent = `${ei.icon} ${ei.name}`; et.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; subtitleEl.insertBefore(et, subtitleEl.firstChild); } }
    if (p.archived) { const ab = document.createElement('span'); ab.className = 'fiche-tag'; ab.style.cssText = 'color:#94A3B8;border-color:#94A3B8;background:rgba(148,163,184,0.1)'; ab.textContent = '\ud83d\udce6 Archivé'; subtitleEl.appendChild(ab); }
    if (p.subscriptionDate) { const d = document.createElement('span'); d.style.cssText = 'color:var(--text-muted);font-size:11px;cursor:pointer'; d.textContent = `\ud83d\udcc5 Souscrit le ${new Date(p.subscriptionDate).toLocaleDateString('fr-FR')}`; d.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; subtitleEl.appendChild(d); }
    if (p.integrationNotes) { const n = document.createElement('span'); n.style.cssText = 'color:var(--text-dim);font-size:11px;cursor:pointer'; n.textContent = `\ud83d\udcac ${p.integrationNotes}`; n.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; subtitleEl.appendChild(n); }
    if (!p.entity && !p.subscriptionDate && !p.archived) { const es = document.createElement('span'); es.style.cssText = 'color:var(--accent);font-size:11px;cursor:pointer;text-decoration:underline'; es.textContent = '\u270f\ufe0f Compléter'; es.onclick = (e) => { e.stopPropagation(); showEditMetadataModal(); }; subtitleEl.appendChild(es); }
  }
  const sidebar = container.querySelector('.sheet-sidebar .action-buttons');
  if (sidebar) {
    const editBtn = document.createElement('button'); editBtn.className = 'btn lg'; editBtn.style.cssText = 'width:100%';
    editBtn.innerHTML = '\u270f\ufe0f Modifier infos'; editBtn.onclick = () => showEditMetadataModal();
    sidebar.insertBefore(editBtn, sidebar.firstChild);
    if (!p.archived) {
      if (typeof showTrackingModal === 'function') { const tb = document.createElement('button'); tb.className = 'btn lg'; tb.style.cssText = 'width:100%;background:var(--surface);border:1px solid var(--border)'; tb.innerHTML = '\ud83d\udccd Valorisation'; tb.onclick = () => showTrackingModal(); sidebar.insertBefore(tb, sidebar.children[1]||null); }
      if (_isInPortfolio(p) && typeof showArchiveModal === 'function') {
        const archBtn = document.createElement('button'); archBtn.className = 'btn lg';
        archBtn.style.cssText = 'width:100%;background:rgba(148,163,184,0.1);border:1px solid #94A3B8;color:#94A3B8';
        archBtn.innerHTML = '\ud83d\udce6 Archiver (produit terminé)';
        archBtn.onclick = () => showArchiveModal();
        sidebar.appendChild(archBtn);
      }
    }
  }
  if (_isInPortfolio(p) && !p.archived) {
    const notice = container.querySelector('.integrated-notice');
    if (notice) {
      const rd = p.subscriptionDate ? new Date(p.subscriptionDate).toLocaleDateString('fr-FR') : formatDate(p.addedDate);
      const el = p.entity ? (MY_ENTITIES.find(e => e.id === p.entity)?.name||'') : '';
      const bl = p.bankId ? (BANKS_LIST.find(b => b.id === p.bankId)?.name||p.bankId) : '';
      notice.innerHTML = `\u2705 Intégré le ${rd}${el ? '<br>\ud83c\udfe2 '+el : ''}${bl ? '<br>\ud83c\udfe6 '+bl : ''}<br>Montant: ${formatNumber(p.investedAmount)}\u20ac${p.integrationNotes ? '<br><span style="color:var(--text-dim);font-size:11px">'+p.integrationNotes+'</span>' : ''}`;
    }
  }
};

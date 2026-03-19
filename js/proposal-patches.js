// ═══ Proposal AI Integration (loaded last) ═════════════════════
// 1. Auto-analyze proposals after PDF upload
// 2. Category + opinion badges on proposal cards
// 3. Compare button in proposals section
// ═══════════════════════════════════════════════════════════════

// ─── 1. Override processUploadedFile to add AI analysis for proposals ───
const _patchProcessUploadedFile = processUploadedFile;
processUploadedFile = async function(file, ctx, bid) {
  const pr = document.getElementById('upload-progress');
  const st = document.getElementById('upload-status');
  if (pr) pr.classList.remove('hidden');
  try {
    if (st) st.textContent = 'Extraction du PDF...';
    const product = await app.handlePDFUpload(file, bid);
    if (st) st.textContent = 'Extraction OK!';

    if (ctx === 'portfolio') {
      // Portfolio flow: direct add modal (unchanged)
      _pendingProduct = product;
      const m = document.getElementById('modal');
      m.classList.remove('visible'); m.innerHTML = '';
      setTimeout(() => showDirectAddModal(product, bid), 350);
    } else {
      // PROPOSAL flow: save + auto AI analysis
      if (st) st.textContent = '\ud83e\udd16 Analyse IA en cours...';

      // Run AI categorization in parallel
      if (typeof analyzeProposal === 'function') {
        try {
          await analyzeProposal(product);
          if (st) st.textContent = '\u2705 Analyse termin\u00e9e!';
        } catch (e) {
          console.warn('AI analysis failed:', e);
          if (st) st.textContent = 'Analyse IA \u00e9chou\u00e9e, sauvegarde...';
        }
      }

      closeModal();
      await app.addProposal(bid, product);
      app.render();

      if (product.aiOpinion) {
        showToast(`${product.aiCategoryLabel || 'Produit'}: ${product.aiOpinion.substring(0, 80)}...`, 'success');
      } else {
        showToast('Proposition ajout\u00e9e', 'success');
      }
    }
  } catch (e) {
    if (st) st.textContent = 'Erreur: ' + e.message;
    if (pr) pr.classList.add('error');
  }
};

// ─── 2. Override renderProductCard to add category + opinion badges ───
const _patchRenderProductCard = renderProductCard;
renderProductCard = function(product, context) {
  let html = _patchRenderProductCard(product, context);

  // Add category badge + AI opinion for proposals
  if (product.aiCategoryLabel && typeof renderCategoryBadge === 'function') {
    html = _injectBeforeLastDiv(html, renderCategoryBadge(product));
  }
  if (product.aiOpinion && typeof renderAIOpinionBadge === 'function') {
    html = _injectBeforeLastDiv(html, renderAIOpinionBadge(product));
  }

  return html;
};

// ─── 3. Override renderDashboard to add Compare button in proposals section ───
const _patchRenderDashboard = renderDashboard;
renderDashboard = function(container, state) {
  _patchRenderDashboard(container, state);

  // Find proposals section (second .section)
  const allSections = container.querySelectorAll('.section');
  const proposalsSection = allSections[1];
  if (!proposalsSection || typeof compareProposals !== 'function') return;

  // Count pending proposals
  const pendingCount = Object.values(state.proposals || {}).reduce((s, arr) =>
    s + arr.filter(p => !['rejected', 'subscribed'].includes(p.status)).length, 0);

  if (pendingCount === 0) return;

  // Add Compare button in section header
  const propHeader = proposalsSection.querySelector('.section-header');
  if (propHeader) {
    const compareBtn = document.createElement('button');
    compareBtn.id = 'compare-proposals-btn';
    compareBtn.className = 'btn ai-glow';
    compareBtn.style.cssText = 'white-space:nowrap;margin-right:8px';
    compareBtn.innerHTML = `\ud83e\udd16 Comparer (${pendingCount})`;
    compareBtn.onclick = compareProposals;
    propHeader.insertBefore(compareBtn, propHeader.querySelector('.btn'));
  }

  // Compare results box (hidden until clicked)
  const compareBox = document.createElement('div');
  compareBox.id = 'compare-proposals-box';
  compareBox.style.cssText = 'display:none;margin-bottom:16px';
  const propContent = proposalsSection.querySelector('.banks-container') || proposalsSection.querySelector('.empty-state');
  if (propContent) propContent.before(compareBox);
};

// ─── 4. Override renderProductSheet to show AI analysis on fiche ───
const _patchRenderProductSheet = renderProductSheet;
renderProductSheet = function(container, state) {
  _patchRenderProductSheet(container, state);
  const p = state.currentProduct;
  if (!p || !p.aiOpinion) return;

  // Add AI analysis section on fiche
  const sheetMain = container.querySelector('.sheet-main');
  if (!sheetMain) return;

  const aiSection = document.createElement('div');
  aiSection.innerHTML = `<div class="fiche-section">
    <div class="fiche-section-header"><span class="fiche-section-icon">\ud83e\udd16</span><span class="fiche-section-title">Analyse IA</span></div>
    <div class="fiche-section-body">
      ${p.aiCategoryLabel ? `<div style="margin-bottom:8px"><span style="display:inline-block;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:600;background:${p.aiCategoryColor || '#94A3B8'}22;color:${p.aiCategoryColor || '#94A3B8'}">${p.aiCategoryLabel}</span></div>` : ''}
      <div style="font-size:13px;line-height:1.5;color:var(--text)">${p.aiOpinion}</div>
      ${p.score ? `<div style="margin-top:8px;font-size:11px;color:var(--text-dim)">Score compatibilit\u00e9 portefeuille: <strong style="color:${p.score.score >= 65 ? 'var(--green)' : p.score.score >= 40 ? 'var(--orange)' : 'var(--red)'}">${p.score.score}/100</strong></div>` : ''}
    </div>
  </div>`;

  // Insert before the AI Summary section (R\u00e9sum\u00e9 IA)
  const firstSection = sheetMain.querySelector('.fiche-section');
  if (firstSection) sheetMain.insertBefore(aiSection.firstElementChild, firstSection);
  else sheetMain.appendChild(aiSection.firstElementChild);
};

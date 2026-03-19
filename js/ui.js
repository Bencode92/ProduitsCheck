// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — UI Rendering (V2 — StudyForge-style fiche)
// ═══════════════════════════════════════════════════════════════

function renderApp(state) { const main = document.getElementById('main-content'); if (!main) return; switch(state.view) { case 'dashboard': renderDashboard(main,state); break; case 'product-sheet': renderProductSheet(main,state); break; case 'chat': renderChat(main,state); break; } }

// ═══ DASHBOARD ═══
function renderDashboard(container, state) {
  const stats = scoring.getPortfolioStats(state.portfolio);
  const allProposalsCount = Object.values(state.proposals).reduce((s, arr) => s + arr.length, 0);
  const pendingCount = Object.values(state.proposals).reduce((s, arr) => s + arr.filter(p => !['rejected','subscribed'].includes(p.status)).length, 0);
  container.innerHTML = `
    <div class="stats-row">
      <div class="stat-card blue"><div class="stat-label">Portefeuille</div><div class="stat-value">${stats.total}</div><div class="stat-sub">produits actifs</div></div>
      <div class="stat-card green"><div class="stat-label">Nominal Total</div><div class="stat-value">${formatNumber(stats.nominal)}€</div><div class="stat-sub">${stats.banks} contreparties</div></div>
      <div class="stat-card orange"><div class="stat-label">Coupon Moyen</div><div class="stat-value">${stats.avgCoupon ? formatPct(stats.avgCoupon) : '—'}</div><div class="stat-sub">pondération égale</div></div>
      <div class="stat-card purple"><div class="stat-label">Propositions</div><div class="stat-value">${pendingCount}</div><div class="stat-sub">${allProposalsCount} total reçues</div></div>
      <div class="stat-card cyan"><div class="stat-label">Sous-jacents</div><div class="stat-value">${stats.underlyings}</div><div class="stat-sub">${stats.types} types de structure</div></div>
    </div>
    ${stats.concentrations.length > 0 ? `<div class="alert-bar"><span>⚠️</span><span>Concentrations: ${stats.concentrations.map(c=>`<strong>${c.name}</strong> (${c.pct}%)`).join(', ')}</span></div>` : ''}
    <div class="section">
      <div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>Mon Portefeuille</div><button class="btn primary" onclick="showAddPortfolioModal()">+ Ajouter un produit</button></div>
      ${state.portfolio.length === 0 ? `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">Aucun produit en portefeuille</div><div class="empty-sub">Ajoutez votre premier produit structuré</div></div>` : `<div class="portfolio-grid">${state.portfolio.map(p => renderProductCard(p,'portfolio')).join('')}</div>`}
    </div>
    <div class="section">
      <div class="section-header"><div class="section-title"><span class="dot" style="background:var(--orange)"></span>Propositions par Banque</div><button class="btn primary" onclick="showAddProposalModal()">+ Nouvelle proposition</button></div>
      <div class="banks-container">${renderBankSections(state)}</div>
      ${Object.keys(state.proposals).length === 0 ? `<div class="empty-state"><div class="empty-icon">📨</div><div class="empty-text">Aucune proposition</div><div class="empty-sub">Ajoutez les offres des banques</div></div>` : ''}
    </div>`;
}

function renderProductCard(product, context) {
  const bank = BANKS.find(b => b.id === product.bankId); const bankName = bank?.name || product.bankId || '—'; const bankColor = bank?.color || 'var(--text-muted)';
  const typeName = PRODUCT_TYPES.find(t => t.id === product.type)?.name || product.type || '—';
  const scoreHTML = product.score ? `<div class="card-score ${product.score.score >= 65 ? 'good' : product.score.score >= 40 ? 'medium' : 'low'}">${product.score.score}</div>` : '';
  const statusBadge = product.status && PROPOSAL_STATUS[product.status] ? `<span class="status-badge" style="--badge-color:${PROPOSAL_STATUS[product.status].color}">${PROPOSAL_STATUS[product.status].icon} ${PROPOSAL_STATUS[product.status].label}</span>` : '';
  return `<div class="product-card" onclick="app.openProduct(app._findProduct('${product.id}','${product.bankId||''}'))">
    <div class="product-card-header"><div class="product-card-name">${product.name||typeName}</div><div class="product-card-bank" style="color:${bankColor};border-color:${bankColor}33;background:${bankColor}12">${bankName}</div></div>
    <div class="product-card-type">${typeName}</div>
    <div class="product-card-grid">
      <div class="product-card-field"><span class="label">Nominal</span><span class="value">${product.investedAmount ? formatNumber(product.investedAmount)+'€' : '—'}</span></div>
      <div class="product-card-field"><span class="label">Coupon</span><span class="value green">${product.coupon?.rate ? formatPct(product.coupon.rate) : '—'}</span></div>
      <div class="product-card-field"><span class="label">Barrière</span><span class="value ${product.capitalProtection?.barrier&&product.capitalProtection.barrier<70?'red':''}">${product.capitalProtection?.barrier ? product.capitalProtection.barrier+'%' : '—'}</span></div>
      <div class="product-card-field"><span class="label">Maturité</span><span class="value">${product.maturity||'—'}</span></div>
    </div>
    <div class="product-card-footer">${scoreHTML}${statusBadge}</div></div>`;
}

function renderBankSections(state) {
  const bankIds = Object.keys(state.proposals); if (bankIds.length === 0) return '';
  return bankIds.map(bankId => {
    const bank = BANKS.find(b => b.id === bankId); const proposals = state.proposals[bankId]||[];
    const expanded = state.bankSections[bankId] !== false; const pending = proposals.filter(p => !['rejected','subscribed'].includes(p.status)).length;
    return `<div class="bank-section ${expanded?'expanded':''}">
      <div class="bank-header" onclick="toggleBankSection('${bankId}')"><div class="bank-header-left">
        <span class="bank-dot" style="background:${bank?.color||'var(--text-muted)'}"></span><span class="bank-name">${bank?.name||bankId}</span>
        <span class="bank-count">${proposals.length} produit${proposals.length>1?'s':''}</span>${pending>0?`<span class="bank-pending">${pending} en attente</span>`:''}</div>
        <span class="bank-chevron">${expanded?'▾':'▸'}</span></div>
      ${expanded?`<div class="bank-products">${proposals.map(p=>renderProductCard(p,'proposal')).join('')}</div>`:''}</div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// FICHE PRODUIT — Style StudyForge
// ═══════════════════════════════════════════════════════════════
function renderProductSheet(container, state) {
  const p = state.currentProduct; if (!p) return;
  const bank = BANKS.find(b => b.id === p.bankId);
  const bankName = bank?.name || p.bankId || '—';
  const bankColor = bank?.color || 'var(--text-muted)';
  const typeName = PRODUCT_TYPES.find(t => t.id === p.type)?.name || p.type || '—';
  const couponRate = p.coupon?.rate;
  const barrier = p.capitalProtection?.barrier;
  const isProtected = p.capitalProtection?.protected === true || p.capitalProtection?.protected === 'true';
  const hasAutocall = p.earlyRedemption?.possible === true || p.earlyRedemption?.possible === 'true';
  const hasMem = p.coupon?.memory === true || p.coupon?.memory === 'true';

  container.innerHTML = `
    <!-- Navigation -->
    <div class="sheet-nav">
      <button class="btn ghost" onclick="app.goToDashboard()">← Retour</button>
      <div class="sheet-nav-actions">
        <button class="btn ai-glow" onclick="app.openChat(app.state.currentProduct)">💬 Discuter avec Claude</button>
        ${p.status !== 'subscribed' ? `
          <button class="btn success" onclick="showIntegrateModal('${p.id}','${p.bankId}')">✅ Intégrer</button>
          <button class="btn danger" onclick="handleReject('${p.id}','${p.bankId}')">❌ Rejeter</button>
        ` : ''}
      </div>
    </div>

    <!-- Header -->
    <div class="fiche-header">
      <div class="fiche-title-block">
        <h1 class="fiche-title">${p.name || 'Produit sans nom'}</h1>
        <div class="fiche-subtitle">
          <span class="fiche-tag bank" style="color:${bankColor};border-color:${bankColor}">${bankName}</span>
          <span class="fiche-tag type">${typeName}</span>
          ${p.status ? `<span class="fiche-tag status" style="color:${PROPOSAL_STATUS[p.status]?.color};background:${PROPOSAL_STATUS[p.status]?.color}18;border:1px solid ${PROPOSAL_STATUS[p.status]?.color}33">${PROPOSAL_STATUS[p.status]?.label}</span>` : ''}
          ${p.sourceFile ? `<span style="color:var(--text-dim);font-size:11px">📄 ${p.sourceFile}</span>` : ''}
        </div>
      </div>
      ${p.score ? renderScoreWidget(p.score) : ''}
    </div>

    <!-- Métriques clés -->
    <div class="fiche-metrics">
      <div class="fiche-metric green"><div class="fiche-metric-label">Coupon</div><div class="fiche-metric-value">${couponRate ? formatPct(couponRate) : '—'}</div><div class="fiche-metric-sub">${p.coupon?.type || 'conditionnel'}${hasMem ? ' · mémoire' : ''}</div></div>
      <div class="fiche-metric ${barrier && barrier < 65 ? 'red' : 'orange'}"><div class="fiche-metric-label">Barrière Capital</div><div class="fiche-metric-value">${barrier ? barrier + '%' : '—'}</div><div class="fiche-metric-sub">${p.capitalProtection?.barrierType || '—'}</div></div>
      <div class="fiche-metric blue"><div class="fiche-metric-label">Maturité</div><div class="fiche-metric-value">${p.maturity || '—'}</div><div class="fiche-metric-sub">${p.maturityDate ? formatDate(p.maturityDate) : ''}</div></div>
      <div class="fiche-metric ${isProtected ? 'green' : 'red'}"><div class="fiche-metric-label">Capital</div><div class="fiche-metric-value">${isProtected ? '✓ Protégé' : '✕ Non protégé'}</div><div class="fiche-metric-sub">${p.capitalProtection?.level ? p.capitalProtection.level + '%' : '—'}</div></div>
      <div class="fiche-metric ${hasAutocall ? 'purple' : 'blue'}"><div class="fiche-metric-label">Autocall</div><div class="fiche-metric-value">${hasAutocall ? '✓ Oui' : '✕ Non'}</div><div class="fiche-metric-sub">${p.earlyRedemption?.trigger ? 'Seuil ' + p.earlyRedemption.trigger + '%' : '—'}</div></div>
      ${p.investedAmount ? `<div class="fiche-metric blue"><div class="fiche-metric-label">Montant Investi</div><div class="fiche-metric-value">${formatNumber(p.investedAmount)}€</div></div>` : ''}
    </div>

    <div class="sheet-layout">
      <div class="sheet-main">

        <!-- Résumé IA -->
        ${p.aiSummary ? `
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">🤖</span><span class="fiche-section-title">Résumé IA</span></div>
          <div class="fiche-section-body"><div class="fiche-ai-summary">${formatAISummary(p.aiSummary)}</div></div>
        </div>` : ''}

        <!-- Mécanisme des Coupons -->
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">💰</span><span class="fiche-section-title">Mécanisme des Coupons</span></div>
          <div class="fiche-section-body">
            <div class="fiche-info-box ${couponRate && couponRate >= 5 ? 'green' : 'blue'}">
              <div class="fiche-info-box-title">Coupon ${p.coupon?.type || ''} — ${couponRate ? formatPct(couponRate) : 'N/A'}</div>
              <div class="fiche-info-box-text">
                ${p.coupon?.frequency ? `<strong>Fréquence:</strong> ${p.coupon.frequency}` : ''}
                ${p.coupon?.trigger ? ` · <strong>Seuil:</strong> ${p.coupon.trigger}% du niveau initial` : ''}
                ${hasMem ? ' · <strong>Effet mémoire:</strong> Oui — les coupons non versés sont reportés' : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- Protection du Capital -->
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">🛡️</span><span class="fiche-section-title">Protection du Capital</span></div>
          <div class="fiche-section-body">
            <div class="fiche-info-box ${isProtected ? 'green' : 'orange'}">
              <div class="fiche-info-box-title">${isProtected ? '✓ Capital protégé' : '⚠️ Capital non protégé'} ${p.capitalProtection?.level ? '— ' + p.capitalProtection.level + '%' : ''}</div>
              <div class="fiche-info-box-text">
                ${p.capitalProtection?.type ? `<strong>Type:</strong> ${p.capitalProtection.type}` : ''}
                ${barrier ? ` · <strong>Barrière:</strong> ${barrier}% (${p.capitalProtection?.barrierType || 'européenne'})` : ''}
                ${p.capitalProtection?.barrierObservation ? `<br><strong>Observation:</strong> ${p.capitalProtection.barrierObservation}` : ''}
              </div>
            </div>
            ${barrier && barrier < 70 ? `<div class="fiche-alert warn">⚠️ Barrière basse (${barrier}%) — risque de perte en capital significatif si le sous-jacent chute de plus de ${100-barrier}%</div>` : ''}
          </div>
        </div>

        <!-- Remboursement Anticipé -->
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">⏩</span><span class="fiche-section-title">Remboursement Anticipé</span></div>
          <div class="fiche-section-body">
            <div class="fiche-info-box ${hasAutocall ? 'purple' : 'neutral'}">
              <div class="fiche-info-box-title">${hasAutocall ? '✓ Rappel anticipé possible' : '✕ Pas de remboursement anticipé'}</div>
              <div class="fiche-info-box-text">
                ${p.earlyRedemption?.type ? `<strong>Type:</strong> ${p.earlyRedemption.type}` : ''}
                ${p.earlyRedemption?.trigger ? ` · <strong>Seuil:</strong> ${p.earlyRedemption.trigger}%` : ''}
                ${p.earlyRedemption?.frequency ? ` · <strong>Fréquence:</strong> ${p.earlyRedemption.frequency}` : ''}
                ${p.earlyRedemption?.stepDown === true || p.earlyRedemption?.stepDown === 'true' ? `<br><strong>Step-down:</strong> Oui — ${p.earlyRedemption.stepDownDetail || 'seuil dégressif'}` : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- Caractéristiques -->
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">📊</span><span class="fiche-section-title">Caractéristiques</span></div>
          <div class="fiche-section-body">
            <div class="fiche-kv-grid">
              <div class="fiche-kv"><span class="fiche-kv-label">Sous-jacent(s)</span><span class="fiche-kv-value">${(p.underlyings||[]).join(', ') || '—'}</span></div>
              <div class="fiche-kv"><span class="fiche-kv-label">Type</span><span class="fiche-kv-value">${typeName}</span></div>
              <div class="fiche-kv"><span class="fiche-kv-label">Maturité</span><span class="fiche-kv-value">${p.maturity || '—'}</span></div>
              <div class="fiche-kv"><span class="fiche-kv-label">Devise</span><span class="fiche-kv-value">${p.currency || 'EUR'}</span></div>
              <div class="fiche-kv"><span class="fiche-kv-label">Date de strike</span><span class="fiche-kv-value">${formatDate(p.strikeDate)}</span></div>
              <div class="fiche-kv"><span class="fiche-kv-label">Date maturité</span><span class="fiche-kv-value">${formatDate(p.maturityDate)}</span></div>
            </div>
          </div>
        </div>

        <!-- Scénarios -->
        ${p.scenarios && (p.scenarios.favorable || p.scenarios.median || p.scenarios.defavorable) ? `
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">🎯</span><span class="fiche-section-title">Scénarios de Performance</span></div>
          <div class="fiche-section-body">
            <div class="fiche-scenarios">
              ${p.scenarios.favorable ? `<div class="fiche-scenario good"><div class="fiche-scenario-label">✅ Scénario Favorable</div><div class="fiche-scenario-text">${p.scenarios.favorable}</div></div>` : ''}
              ${p.scenarios.median ? `<div class="fiche-scenario mid"><div class="fiche-scenario-label">⚖️ Scénario Médian</div><div class="fiche-scenario-text">${p.scenarios.median}</div></div>` : ''}
              ${p.scenarios.defavorable ? `<div class="fiche-scenario bad"><div class="fiche-scenario-label">❌ Scénario Défavorable</div><div class="fiche-scenario-text">${p.scenarios.defavorable}</div></div>` : ''}
            </div>
          </div>
        </div>` : ''}

        <!-- Risques -->
        ${p.risks && p.risks.length > 0 ? `
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">⚠️</span><span class="fiche-section-title">Points d'Attention</span></div>
          <div class="fiche-section-body">
            <div class="fiche-risks">
              ${p.risks.map(r => `<div class="fiche-risk"><span class="fiche-risk-icon">▸</span><span>${r}</span></div>`).join('')}
            </div>
          </div>
        </div>` : ''}

        <!-- Résumé discussion -->
        ${p.conversationSummary ? `
        <div class="fiche-section">
          <div class="fiche-section-header"><span class="fiche-section-icon">📝</span><span class="fiche-section-title">Résumé Discussion & Décision</span></div>
          <div class="fiche-section-body">
            <div class="fiche-ai-summary">${formatAISummary(p.conversationSummary)}</div>
            ${p.decision ? `<div class="fiche-alert ${p.decision === 'subscribed' ? 'success' : 'warn'}">Décision: <strong>${PROPOSAL_STATUS[p.decision]?.label || p.decision}</strong></div>` : ''}
          </div>
        </div>` : ''}
      </div>

      <!-- Sidebar -->
      <div class="sheet-sidebar">
        ${p.score ? renderScorePanel(p.score) : ''}
        <div class="sheet-card">
          <h3 class="sheet-card-title">Actions</h3>
          <div class="action-buttons">
            <button class="btn ai-glow lg" style="width:100%" onclick="app.openChat(app.state.currentProduct)">💬 Discuter avec Claude</button>
            ${p.status !== 'subscribed' ? `
              <button class="btn success lg" style="width:100%" onclick="showIntegrateModal('${p.id}','${p.bankId}')">✅ Intégrer au portefeuille</button>
              <button class="btn danger lg" style="width:100%" onclick="handleReject('${p.id}','${p.bankId}')">❌ Rejeter</button>
            ` : `<div class="integrated-notice">✅ Intégré le ${formatDate(p.addedDate)}<br>Montant: ${formatNumber(p.investedAmount)}€</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── Format AI Summary (StudyForge-style) ───────────────────
function formatAISummary(text) {
  if (!text) return '';
  let html = escapeHTML(text);
  // Headings: ## or numbered sections like "1." or "# "
  html = html.replace(/^##\s*(\d+)\.\s*(.+)$/gm, '<h2>$1. $2</h2>');
  html = html.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s*(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^(\d+)\.\s*\*\*(.+?)\*\*\s*[—–-]\s*/gm, '<h2>$1. $2</h2>');
  html = html.replace(/^(\d+)\.\s*\*\*(.+?)\*\*/gm, '<h2>$1. $2</h2>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  // Wrap in paragraphs
  if (!html.startsWith('<h2>') && !html.startsWith('<p>')) html = '<p>' + html + '</p>';
  return html;
}

// ─── Score Widgets ──────────────────────────────────────────
function renderScoreWidget(score) {
  const color = score.score>=65?'var(--green)':score.score>=40?'var(--orange)':'var(--red)';
  return `<div class="score-widget"><svg viewBox="0 0 80 80" class="score-ring"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" stroke-width="4"/>
    <circle cx="40" cy="40" r="34" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${2*Math.PI*34}" stroke-dashoffset="${2*Math.PI*34*(1-score.score/100)}" stroke-linecap="round" transform="rotate(-90 40 40)"/></svg>
    <div class="score-number" style="color:${color}">${score.score}</div></div>`;
}

function renderScorePanel(score) {
  return `<div class="sheet-card score-panel"><h3 class="sheet-card-title">Score de Compatibilité</h3><div class="score-big">${renderScoreWidget(score)}</div>
    <div class="score-verdict">${score.verdict}</div><div class="score-details">${score.details.map(d=>`<div class="score-detail ${d.type}"><span class="score-detail-icon">${d.icon}</span><span class="score-detail-text">${d.text}</span></div>`).join('')}</div></div>`;
}

// ═══ CHAT ═══
function renderChat(container, state) {
  const p = state.currentProduct; if (!p) return; const messages = p.conversation||[]; const bank = BANKS.find(b => b.id === p.bankId);
  container.innerHTML = `<div class="chat-layout">
    <div class="chat-header"><button class="btn ghost" onclick="app.openProduct(app.state.currentProduct)">← Fiche</button>
      <div class="chat-header-info"><div class="chat-header-name">${p.name||'Produit'}</div><div class="chat-header-bank">${bank?.name||''}</div></div>
      <div class="chat-header-actions"><button class="btn sm success" onclick="handleSummarizeAndDecide('subscribed')">✅ Résumer & Intégrer</button>
        <button class="btn sm danger" onclick="handleSummarizeAndDecide('rejected')">❌ Résumer & Rejeter</button></div></div>
    <div class="chat-messages" id="chat-messages">
      <div class="chat-msg system"><div class="chat-msg-content">💡 Discussion sur <strong>${p.name||'ce produit'}</strong>. Claude a accès à la fiche et à votre portefeuille.</div></div>
      ${messages.map(m=>`<div class="chat-msg ${m.role}"><div class="chat-msg-avatar">${m.role==='user'?'👤':'🤖'}</div><div class="chat-msg-content">${m.role==='assistant'?formatAIText(m.content):escapeHTML(m.content)}</div></div>`).join('')}</div>
    <div class="chat-input-area"><textarea id="chat-input" class="chat-input" placeholder="Posez une question sur ce produit..." onkeydown="handleChatKeydown(event)"></textarea>
      <button class="btn primary" onclick="handleSendChat()" id="chat-send-btn">Envoyer</button></div></div>`;
  const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight;
}

// ═══ MODALS ═══
function showAddPortfolioModal() { showUploadModal('portfolio', null); }

function showAddProposalModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Nouvelle proposition — Choisir la banque</h2>
    <div class="bank-select-grid">${BANKS.map(b=>`<button class="bank-select-btn" style="--bank-color:${b.color}" onclick="showUploadModal('proposal','${b.id}')"><span class="bank-select-dot" style="background:${b.color}"></span>${b.name}</button>`).join('')}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button></div></div></div>`;
  modal.classList.add('visible');
}

function showUploadModal(context, bankId) {
  const modal = document.getElementById('modal'); const bank = BANKS.find(b => b.id === bankId);
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">${context==='portfolio'?'Ajouter au portefeuille':`Proposition — ${bank?.name||''}`}</h2>
    <div class="upload-zone" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handleFileDrop(event,'${context}','${bankId}')">
      <div class="upload-icon">📄</div><div class="upload-text">Glisser le PDF ici</div><div class="upload-sub">ou cliquer pour sélectionner</div>
      <input type="file" accept=".pdf" id="file-input" style="display:none" onchange="handleFileSelect(event,'${context}','${bankId}')"></div>
    <button class="btn" style="width:100%;margin-top:12px" onclick="document.getElementById('file-input').click()">Choisir un fichier PDF</button>
    <div class="upload-divider"><span>ou</span></div>
    <button class="btn ghost" style="width:100%" onclick="showManualEntryModal('${context}','${bankId}')">✏️ Saisie manuelle</button>
    <div id="upload-progress" class="upload-progress hidden"><div class="spinner"></div><span id="upload-status">Extraction...</span></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button></div></div></div>`;
  modal.classList.add('visible');
}

function showManualEntryModal(context, bankId) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">Saisie manuelle</h2><div class="form-grid">
      <div class="form-field full"><label>Nom du produit</label><input id="f-name" placeholder="Ex: Phoenix Autocall Eurostoxx Q1-2025"></div>
      ${context==='portfolio'?`<div class="form-field"><label>Banque</label><select id="f-bank"><option value="">Sélectionner...</option>${BANKS.map(b=>`<option value="${b.id}" ${b.id===bankId?'selected':''}>${b.name}</option>`).join('')}</select></div>`:''}
      <div class="form-field"><label>Type</label><select id="f-type"><option value="">Sélectionner...</option>${PRODUCT_TYPES.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Sous-jacent</label><select id="f-underlying"><option value="">Sélectionner...</option>${UNDERLYINGS.map(u=>`<option value="${u.id}">${u.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Maturité</label><input id="f-maturity" placeholder="Ex: 5 ans"></div>
      <div class="form-field"><label>Coupon (%)</label><input id="f-coupon" type="number" step="0.01" placeholder="8.5"></div>
      <div class="form-field"><label>Type coupon</label><select id="f-coupon-type"><option value="conditionnel">Conditionnel</option><option value="fixe">Fixe</option><option value="memoire">Mémoire</option></select></div>
      <div class="form-field"><label>Barrière (%)</label><input id="f-barrier" type="number" step="0.1" placeholder="60"></div>
      <div class="form-field"><label>Protection (%)</label><input id="f-protection" type="number" step="0.1" placeholder="100"></div>
      <div class="form-field"><label>Autocall</label><select id="f-autocall"><option value="true">Oui</option><option value="false">Non</option></select></div>
      ${context==='portfolio'?`<div class="form-field"><label>Montant investi (€)</label><input id="f-invested" type="number" placeholder="50000"></div>`:''}
      <div class="form-field full"><label>Notes</label><textarea id="f-notes" placeholder="Détails..."></textarea></div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleManualSave('${context}','${bankId}')">Enregistrer</button></div></div></div>`;
}

function showIntegrateModal(productId, bankId) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Intégrer au portefeuille</h2>
    <div class="form-field"><label>Montant investi (€)</label><input id="f-integrate-amount" type="number" placeholder="50000" autofocus></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrate('${productId}','${bankId}')">✅ Confirmer</button></div></div></div>`;
  modal.classList.add('visible');
}

function closeModal() { const m = document.getElementById('modal'); m.classList.remove('visible'); setTimeout(()=>{m.innerHTML='';},300); }

// ═══ EVENT HANDLERS ═══
function toggleBankSection(bankId) { app.state.bankSections[bankId] = app.state.bankSections[bankId]===false; app.render(); }

async function handleFileDrop(event, context, bankId) { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && file.type === 'application/pdf') await processUploadedFile(file, context, bankId); }
async function handleFileSelect(event, context, bankId) { const file = event.target.files[0]; if (file) await processUploadedFile(file, context, bankId); }

async function processUploadedFile(file, context, bankId) {
  const progress = document.getElementById('upload-progress'); const status = document.getElementById('upload-status');
  if (progress) progress.classList.remove('hidden');
  try {
    if (status) status.textContent = 'Extraction du texte PDF...';
    const product = await app.handlePDFUpload(file, bankId);
    if (status) status.textContent = 'Analyse terminée !'; closeModal();
    if (context === 'portfolio') { const amount = prompt('Montant investi (€) :'); if (amount) { product.bankId = bankId || product.bankId; await app.addToPortfolio(product, amount); } }
    else { await app.addProposal(bankId, product); }
    app.render();
  } catch (e) { if (status) status.textContent = 'Erreur: ' + e.message; if (progress) progress.classList.add('error'); }
}

function handleManualSave(context, bankId) {
  const product = { id: app._uid(), name: document.getElementById('f-name')?.value||'', bankId: bankId||document.getElementById('f-bank')?.value||'',
    type: document.getElementById('f-type')?.value||'autre', underlyingType: document.getElementById('f-underlying')?.value||'autre', underlyings: [],
    maturity: document.getElementById('f-maturity')?.value||'',
    coupon: { rate: document.getElementById('f-coupon')?.value||null, type: document.getElementById('f-coupon-type')?.value||'conditionnel' },
    capitalProtection: { barrier: document.getElementById('f-barrier')?.value||null, level: document.getElementById('f-protection')?.value||null, protected: !!(document.getElementById('f-protection')?.value) },
    earlyRedemption: { possible: document.getElementById('f-autocall')?.value==='true', type: document.getElementById('f-autocall')?.value==='true'?'autocall':'none' },
    notes: document.getElementById('f-notes')?.value||'' };
  closeModal();
  if (context === 'portfolio') { app.addToPortfolio(product, document.getElementById('f-invested')?.value||0); }
  else { app.addProposal(bankId, product); }
}

async function handleIntegrate(productId, bankId) {
  const amount = document.getElementById('f-integrate-amount')?.value; if (!amount) { showToast('Montant requis','error'); return; }
  const product = app._findProduct(productId, bankId); if (!product) return; closeModal();
  await app.updateProposalStatus(bankId, productId, 'subscribed'); await app.addToPortfolio({...product}, amount); app.goToDashboard();
}

async function handleReject(productId, bankId) {
  if (!confirm('Rejeter cette proposition ?')) return;
  const product = app._findProduct(productId, bankId);
  if (product?.conversation?.length > 0) { showToast('Résumé en cours...','info'); await app.summarizeAndDecide(productId, bankId, 'rejected'); }
  await app.updateProposalStatus(bankId, productId, 'rejected', 'Rejeté manuellement'); app.goToDashboard();
}

async function handleSendChat() {
  const input = document.getElementById('chat-input'); const btn = document.getElementById('chat-send-btn');
  if (!input||!input.value.trim()) return; const message = input.value.trim(); input.value = ''; btn.disabled = true; btn.textContent = '...';
  try { const p = app.state.currentProduct; await app.sendChatMessage(p.id, p.bankId, message); renderChat(document.getElementById('main-content'), app.state); }
  catch (e) { showToast('Erreur: '+e.message,'error'); } btn.disabled = false; btn.textContent = 'Envoyer';
}

function handleChatKeydown(event) { if (event.key==='Enter'&&!event.shiftKey) { event.preventDefault(); handleSendChat(); } }

async function handleSummarizeAndDecide(decision) {
  const label = decision==='subscribed'?'intégrer':'rejeter'; if (!confirm(`Résumer et ${label} ?`)) return;
  const p = app.state.currentProduct; showToast('Résumé en cours...','info');
  try { await app.summarizeAndDecide(p.id,p.bankId,decision);
    if (decision==='subscribed') { const amount = prompt('Montant investi (€):'); if (amount) await app.addToPortfolio({...p},amount); }
    await app.updateProposalStatus(p.bankId,p.id,decision);
    showToast(decision==='subscribed'?'Produit intégré!':'Produit rejeté','success'); app.goToDashboard();
  } catch(e) { showToast('Erreur: '+e.message,'error'); }
}

// ─── Helpers ────────────────────────────────────────────────
function renderSpec(label, value) { return `<div class="spec-item"><span class="spec-label">${label}</span><span class="spec-value">${value}</span></div>`; }
function formatAIText(text) { if (!text) return ''; return escapeHTML(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'); }
function escapeHTML(str) { const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

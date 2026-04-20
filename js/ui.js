// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — UI Rendering (V3.1 — JSON paste in upload modal)
// V3.1: Added "📋 Coller JSON" option in upload modal
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
  const safeBankId = product.bankId || '';
  return `<div class="product-card" onclick="app.openProduct(app._findProduct('${product.id}','${safeBankId}'))">
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

// ═══ Call Schedule Table (for callable in fine / callable with redemption levels) ═══
function _renderCallSchedule(p) {
  const schedule = p.earlyRedemption?.callSchedule || p.callSchedule;
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return '';
  const matLevel = p.earlyRedemption?.maturityRedemptionLevel;
  return `<div class="fiche-call-schedule" style="margin-top:12px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:2px solid var(--border);text-align:left">
        <th style="padding:6px 8px">Année</th>
        <th style="padding:6px 8px">Date de rappel</th>
        <th style="padding:6px 8px;text-align:right">Niveau remb.</th>
      </tr></thead>
      <tbody>
        ${schedule.map((s, i) => {
          const dt = s.date || s.redemptionDate || '';
          const level = s.amount || s.redemptionLevel || 100;
          const startYr = p.earlyRedemption?.startSemester ? Math.ceil(p.earlyRedemption.startSemester / 2) : 3;
          return `<tr style="border-bottom:1px solid var(--border-dim)">
          <td style="padding:5px 8px;font-weight:600">An ${startYr + i}</td>
          <td style="padding:5px 8px">${dt || '—'}</td>
          <td style="padding:5px 8px;text-align:right;font-weight:600;color:var(--green)">${level}%</td>
        </tr>`;
        }).join('')}
        ${matLevel ? `<tr style="border-top:2px solid var(--accent)">
          <td colspan="2" style="padding:5px 8px;font-weight:600">Remboursement final</td>
          <td style="padding:5px 8px;text-align:right;font-weight:700;color:var(--accent)">${matLevel}%</td>
        </tr>` : ''}
      </tbody>
    </table>
  </div>`;
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
  const safeBankId = p.bankId || '';

  container.innerHTML = `
    <div class="sheet-nav">
      <button class="btn ghost" onclick="app.goToDashboard()">← Retour</button>
      <div class="sheet-nav-actions">
        <button class="btn ai-glow" onclick="app.openChat(app.state.currentProduct)">💬 Discuter avec Claude</button>
        ${p.status !== 'subscribed' ? `
          <button class="btn success" onclick="showIntegrateModal('${p.id}','${safeBankId}')">✅ Intégrer</button>
          <button class="btn danger" onclick="handleReject('${p.id}','${safeBankId}')">❌ Rejeter</button>
          <button class="btn ghost" style="color:var(--red)" onclick="handleDelete('${p.id}','${safeBankId}')">🗑 Supprimer</button>
        ` : ''}
      </div>
    </div>

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

    <div class="fiche-metrics">
      <div class="fiche-metric green"><div class="fiche-metric-label">Coupon</div><div class="fiche-metric-value">${couponRate ? formatPct(couponRate) : '—'}${p.coupon?.frequency === 'in_fine' ? '/an cap.' : ''}</div><div class="fiche-metric-sub">${p.coupon?.type || 'conditionnel'}${p.coupon?.frequency === 'in_fine' ? ' · in fine' : ''}${hasMem ? ' · mémoire' : ''}</div></div>
      <div class="fiche-metric ${barrier && barrier < 65 ? 'red' : 'orange'}"><div class="fiche-metric-label">Barrière Capital</div><div class="fiche-metric-value">${barrier ? barrier + '%' : '—'}</div><div class="fiche-metric-sub">${p.capitalProtection?.barrierType || '—'}</div></div>
      <div class="fiche-metric blue"><div class="fiche-metric-label">Maturité</div><div class="fiche-metric-value">${p.maturity || '—'}</div><div class="fiche-metric-sub">${p.maturityDate ? formatDate(p.maturityDate) : ''}</div></div>
      <div class="fiche-metric ${isProtected ? 'green' : 'red'}"><div class="fiche-metric-label">Capital</div><div class="fiche-metric-value">${isProtected ? '✓ Protégé' : '✕ Non protégé'}</div><div class="fiche-metric-sub">${p.capitalProtection?.level ? p.capitalProtection.level + '%' : '—'}</div></div>
      <div class="fiche-metric ${hasAutocall ? 'purple' : 'blue'}"><div class="fiche-metric-label">${p.earlyRedemption?.type === 'callable' ? 'Callable' : 'Autocall'}</div><div class="fiche-metric-value">${hasAutocall ? '✓ Oui' : '✕ Non'}</div><div class="fiche-metric-sub">${p.earlyRedemption?.type === 'callable' ? (p.earlyRedemption?.firstCallDate ? formatDate(p.earlyRedemption.firstCallDate) : 'Au gre emetteur') : (p.earlyRedemption?.trigger ? 'Seuil ' + p.earlyRedemption.trigger + '%' : '—')}</div></div>
      ${p.investedAmount ? `<div class="fiche-metric blue"><div class="fiche-metric-label">Montant Investi</div><div class="fiche-metric-value">${formatNumber(p.investedAmount)}€</div></div>` : ''}
    </div>

    <div class="sheet-layout">
      <div class="sheet-main">
        ${p.aiSummary ? `<div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🤖</span><span class="fiche-section-title">Résumé IA</span></div><div class="fiche-section-body"><div class="fiche-ai-summary">${formatAISummary(p.aiSummary)}</div></div></div>` : ''}
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">💰</span><span class="fiche-section-title">Mécanisme des Coupons</span></div><div class="fiche-section-body">
          <div class="fiche-info-box ${couponRate && couponRate >= 5 ? 'green' : 'blue'}"><div class="fiche-info-box-title">Coupon ${p.coupon?.type || ''} — ${couponRate ? formatPct(couponRate) : 'N/A'}</div><div class="fiche-info-box-text">${p.coupon?.frequency ? `<strong>Fréquence:</strong> ${p.coupon.frequency}` : ''}${p.coupon?.trigger ? ` · <strong>Seuil:</strong> ${p.coupon.trigger}% du niveau initial` : ''}${hasMem ? ' · <strong>Effet mémoire:</strong> Oui' : ''}</div></div></div></div>
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🛡️</span><span class="fiche-section-title">Protection du Capital</span></div><div class="fiche-section-body">
          <div class="fiche-info-box ${isProtected ? 'green' : 'orange'}"><div class="fiche-info-box-title">${isProtected ? '✓ Capital protégé' : '⚠️ Capital non protégé'} ${p.capitalProtection?.level ? '— ' + p.capitalProtection.level + '%' : ''}</div><div class="fiche-info-box-text">${p.capitalProtection?.type ? `<strong>Type:</strong> ${p.capitalProtection.type}` : ''}${barrier ? ` · <strong>Barrière:</strong> ${barrier}% (${p.capitalProtection?.barrierType || 'européenne'})` : ''}${p.capitalProtection?.barrierObservation ? `<br><strong>Observation:</strong> ${p.capitalProtection.barrierObservation}` : ''}</div></div>
          ${barrier && barrier < 70 ? `<div class="fiche-alert warn">⚠️ Barrière basse (${barrier}%)</div>` : ''}</div></div>
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">⏩</span><span class="fiche-section-title">Remboursement Anticipé</span></div><div class="fiche-section-body">
          <div class="fiche-info-box ${hasAutocall ? 'purple' : 'neutral'}"><div class="fiche-info-box-title">${hasAutocall ? '✓ Rappel anticipé possible' : '✕ Pas de remboursement anticipé'}</div><div class="fiche-info-box-text">${p.earlyRedemption?.type ? `<strong>Type:</strong> ${p.earlyRedemption.type}` : ''}${p.earlyRedemption?.trigger ? ` · <strong>Seuil:</strong> ${p.earlyRedemption.trigger}%` : ''}${p.earlyRedemption?.frequency ? ` · <strong>Fréquence:</strong> ${p.earlyRedemption.frequency}` : ''}${p.earlyRedemption?.stepDown === true || p.earlyRedemption?.stepDown === 'true' ? `<br><strong>Step-down:</strong> Oui — ${p.earlyRedemption.stepDownDetail || 'seuil dégressif'}` : ''}</div></div>${_renderCallSchedule(p)}</div></div>
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📈</span><span class="fiche-section-title">Métriques Investisseur</span></div><div class="fiche-section-body">
          ${_renderInvestorMetrics(p)}
        </div></div>
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📊</span><span class="fiche-section-title">Caractéristiques</span></div><div class="fiche-section-body"><div class="fiche-kv-grid">
          <div class="fiche-kv"><span class="fiche-kv-label">Sous-jacent(s)</span><span class="fiche-kv-value">${(p.underlyings||[]).join(', ') || '—'}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Type</span><span class="fiche-kv-value">${typeName}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Maturité</span><span class="fiche-kv-value">${p.maturity || '—'}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Devise</span><span class="fiche-kv-value">${p.currency || 'EUR'}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Date de strike</span><span class="fiche-kv-value">${formatDate(p.strikeDate)}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Date maturité</span><span class="fiche-kv-value">${formatDate(p.maturityDate)}</span></div>
        </div></div></div>
        ${p.scenarios && (p.scenarios.favorable || p.scenarios.median || p.scenarios.defavorable) ? `
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🎯</span><span class="fiche-section-title">Scénarios</span></div><div class="fiche-section-body"><div class="fiche-scenarios">
          ${p.scenarios.favorable ? `<div class="fiche-scenario good"><div class="fiche-scenario-label">✅ Favorable</div><div class="fiche-scenario-text">${p.scenarios.favorable}</div></div>` : ''}
          ${p.scenarios.median ? `<div class="fiche-scenario mid"><div class="fiche-scenario-label">⚖️ Médian</div><div class="fiche-scenario-text">${p.scenarios.median}</div></div>` : ''}
          ${p.scenarios.defavorable ? `<div class="fiche-scenario bad"><div class="fiche-scenario-label">❌ Défavorable</div><div class="fiche-scenario-text">${p.scenarios.defavorable}</div></div>` : ''}
        </div></div></div>` : ''}
        ${p.risks && p.risks.length > 0 ? `
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">⚠️</span><span class="fiche-section-title">Points d'Attention</span></div><div class="fiche-section-body"><div class="fiche-risks">
          ${p.risks.map(r => `<div class="fiche-risk"><span class="fiche-risk-icon">▸</span><span>${r}</span></div>`).join('')}
        </div></div></div>` : ''}
        ${p.conversationSummary ? `<div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📝</span><span class="fiche-section-title">Résumé Discussion</span></div><div class="fiche-section-body"><div class="fiche-ai-summary">${formatAISummary(p.conversationSummary)}</div>${p.decision ? `<div class="fiche-alert ${p.decision === 'subscribed' ? 'success' : 'warn'}">Décision: <strong>${PROPOSAL_STATUS[p.decision]?.label || p.decision}</strong></div>` : ''}</div></div>` : ''}
      </div>
      <div class="sheet-sidebar">
        ${p.score ? renderScorePanel(p.score) : ''}
        <div class="sheet-card"><h3 class="sheet-card-title">Actions</h3><div class="action-buttons">
          <button class="btn ai-glow lg" style="width:100%" onclick="app.openChat(app.state.currentProduct)">💬 Discuter avec Claude</button>
          ${p.status !== 'subscribed' ? `
            <button class="btn success lg" style="width:100%" onclick="showIntegrateModal('${p.id}','${safeBankId}')">✅ Intégrer</button>
            <button class="btn danger lg" style="width:100%" onclick="handleReject('${p.id}','${safeBankId}')">❌ Rejeter</button>
            <button class="btn ghost lg" style="width:100%;color:var(--red)" onclick="handleDelete('${p.id}','${safeBankId}')">🗑 Supprimer définitivement</button>
          ` : `<div class="integrated-notice">✅ Intégré le ${formatDate(p.addedDate)}<br>Montant: ${formatNumber(p.investedAmount)}€</div>`}
        </div></div>
      </div>
    </div>`;
}

// ─── Format helpers ─────────────────────────────────────────
function formatAISummary(text) {
  if (!text) return '';
  let html = escapeHTML(text);
  html = html.replace(/^##\s*(\d+)\.\s*(.+)$/gm, '<h2>$1. $2</h2>');
  html = html.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s*(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^(\d+)\.\s*\*\*(.+?)\*\*\s*[—–-]\s*/gm, '<h2>$1. $2</h2>');
  html = html.replace(/^(\d+)\.\s*\*\*(.+?)\*\*/gm, '<h2>$1. $2</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<h2>') && !html.startsWith('<p>')) html = '<p>' + html + '</p>';
  return html;
}

function renderScoreWidget(score) {
  const color = score.score>=65?'var(--green)':score.score>=40?'var(--orange)':'var(--red)';
  return `<div class="score-widget"><svg viewBox="0 0 80 80" class="score-ring"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" stroke-width="4"/><circle cx="40" cy="40" r="34" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${2*Math.PI*34}" stroke-dashoffset="${2*Math.PI*34*(1-score.score/100)}" stroke-linecap="round" transform="rotate(-90 40 40)"/></svg><div class="score-number" style="color:${color}">${score.score}</div></div>`;
}

// ─── Investor Metrics: MtM, P(loss), spread vs OAT, proba coupon ──────
function _renderInvestorMetrics(p) {
  var coupon = p.coupon || {};
  var cp = p.capitalProtection || {};
  var couponRate = (typeof coupon === 'object' ? coupon.rate : coupon) || 0;
  var barrier = cp.barrier || 0;
  var isProtected = cp.protected || false;
  var matYears = parseFloat(p.maturityYears) || 5;
  var trigger = parseFloat(coupon.trigger) || 0;
  var st = (p.structureType || p.type || '').toLowerCase();
  var undType = (p.underlyingType || '').toLowerCase();
  var isRate = st.indexOf('taux') >= 0 || st === 'capital_garanti' || undType === 'rates';

  var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">';

  // ─── A. Mark-to-Market estimé ──────
  var mtmEstimate = 0;
  if (isProtected && !barrier) {
    mtmEstimate = 97; // capital garanti = ~97% en secondaire
  } else if (barrier) {
    mtmEstimate = Math.max(85, Math.min(97, 100 - (100 - barrier) * 0.15));
  } else {
    mtmEstimate = 93; // estimation générique
  }
  html += '<div style="padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;border-left:3px solid #2563EB">';
  html += '<div style="font-size:11px;font-weight:700;color:#475569">VALEUR SECONDAIRE ESTIMÉE</div>';
  html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:#2563EB;margin:4px 0">' + mtmEstimate + '%</div>';
  html += '<div style="font-size:11px;color:#475569">Si revente jour 1 → ~' + mtmEstimate + '% du nominal<br>Coût de liquidité : ~' + (100 - mtmEstimate) + '%</div>';
  html += '</div>';

  // ─── B. P(perte capital) + perte attendue ──────
  var pLoss = 0;
  var lossGivenLoss = 0;
  var expectedLoss = 0;
  if (isProtected && !barrier) {
    pLoss = 0;
    lossGivenLoss = 0;
  } else if (barrier) {
    // BS approximation de P(breach)
    var vol = 25; // default stock vol
    var bSigma = Math.log(100 / barrier) / (vol / 100 * Math.sqrt(matYears));
    pLoss = Math.round((1 - _normcdfApprox(bSigma)) * 1000) / 10;
    lossGivenLoss = Math.round((100 - barrier) * 1.3); // severity
    expectedLoss = Math.round(pLoss * lossGivenLoss / 100 * 10) / 10;
  }
  var pLossColor = pLoss === 0 ? '#059669' : pLoss < 10 ? '#D97706' : '#DC2626';
  html += '<div style="padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;border-left:3px solid ' + pLossColor + '">';
  html += '<div style="font-size:11px;font-weight:700;color:#475569">RISQUE EN CAPITAL</div>';
  if (pLoss === 0) {
    html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:#059669;margin:4px 0">0%</div>';
    html += '<div style="font-size:11px;color:#059669">Capital garanti 100% à échéance</div>';
  } else {
    html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + pLossColor + ';margin:4px 0">' + pLoss + '%</div>';
    html += '<div style="font-size:11px;color:#475569">Probabilité de perte en capital<br>Perte moyenne si perte : -' + lossGivenLoss + '% · Perte attendue : -' + expectedLoss + '%</div>';
  }
  html += '</div>';

  // ─── C. Spread vs alternative simple ──────
  var oatRate = 3.08; // OAT 10Y actuel (ou lire depuis MARKET_RATES)
  if (typeof MARKET_RATES !== 'undefined' && MARKET_RATES.tec10) oatRate = MARKET_RATES.tec10;
  var spread = Math.round((couponRate - oatRate) * 100) / 100;
  var spreadColor = spread > 2 ? '#059669' : spread > 0 ? '#D97706' : '#DC2626';
  html += '<div style="padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;border-left:3px solid ' + spreadColor + '">';
  html += '<div style="font-size:11px;font-weight:700;color:#475569">PRIME DE COMPLEXITÉ</div>';
  html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + spreadColor + ';margin:4px 0">' + (spread >= 0 ? '+' : '') + spread.toFixed(2) + '%</div>';
  html += '<div style="font-size:11px;color:#475569">Coupon ' + couponRate + '% vs OAT ' + matYears + 'Y ' + oatRate.toFixed(2) + '%<br>Ce que vous gagnez de plus vs un placement sans risque</div>';
  html += '</div>';

  html += '</div>';

  // ─── Proba historique de coupon (pour produits taux) — avec données réelles ──────
  if (isRate && trigger && trigger < 10) {
    // Charger les données depuis le cache global si disponible
    var ratesData = window._ficheRatesCache;
    if (!ratesData && typeof fetch !== 'undefined') {
      // Fetch synchrone via XMLHttpRequest pour la fiche
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'data/market/rates.json', false);
        xhr.send();
        if (xhr.status === 200) {
          ratesData = JSON.parse(xhr.responseText);
          window._ficheRatesCache = ratesData;
        }
      } catch(e) { /* silent */ }
    }

    // Deviner quel taux ce produit suit
    var productText = ((p.name || '') + ' ' + (p.mechanism || '') + ' ' + ((p.coupon || {}).triggerDetail || '')).toLowerCase();
    var rateKey = /euribor/i.test(productText) ? 'euribor_3m' : 'oat_fr_10y';
    var rateLabel = rateKey === 'euribor_3m' ? 'Euribor 3M' : 'TEC10';

    var history = (ratesData && ratesData.yields && ratesData.yields[rateKey] && ratesData.yields[rateKey].history) || [];
    var totalObs = history.length;

    // Calculer les stats si on a les données
    if (totalObs > 10) {
      var below = 0, above = 0, lastAbove = null, maxConsecAbove = 0, consecAbove = 0;
      var below5y = 0, total5y = 0;
      var fiveYearsAgo = new Date(); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
      var fiveYStr = fiveYearsAgo.toISOString().substring(0, 10);

      history.forEach(function(h) {
        if (h.value <= trigger) { below++; consecAbove = 0; }
        else { above++; lastAbove = h.date; consecAbove++; maxConsecAbove = Math.max(maxConsecAbove, consecAbove); }
        if (h.date >= fiveYStr) { total5y++; if (h.value <= trigger) below5y++; }
      });

      var pctBelow20y = Math.round(below / totalObs * 1000) / 10;
      var pctBelow5y = total5y > 0 ? Math.round(below5y / total5y * 1000) / 10 : 0;

      html += '<div style="padding:14px;background:#EFF6FF;border:1px solid #93C5FD;border-radius:8px;margin-bottom:8px">';
      html += '<div style="font-size:12px;font-weight:700;color:#1E40AF;margin-bottom:8px">📊 Probabilité historique de coupon (' + rateLabel + ' ≤ ' + trigger + '%)</div>';

      // 5 KPIs en ligne
      html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:8px">';

      // 20 ans
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">20 ans</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + pctBelow20y + '%</div>';
      html += '<div style="font-size:11px;color:#475569">' + below + '/' + totalObs + ' obs</div>';
      html += '</div>';

      // 5 ans
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">5 ans</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + pctBelow5y + '%</div>';
      html += '<div style="font-size:11px;color:#475569">' + below5y + '/' + total5y + ' obs</div>';
      html += '</div>';

      // Nb jours au-dessus
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">Nb obs au-dessus</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (above === 0 ? '#059669' : '#DC2626') + '">' + above + '</div>';
      html += '<div style="font-size:11px;color:#475569">sur ' + totalObs + ' total</div>';
      html += '</div>';

      // Dernière fois au-dessus
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">Dernier dépassement</div>';
      html += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:' + (lastAbove ? '#DC2626' : '#059669') + '">' + (lastAbove || 'Jamais') + '</div>';
      html += '<div style="font-size:11px;color:#475569">' + (lastAbove ? 'il y a ' + Math.round((Date.now() - new Date(lastAbove).getTime()) / 86400000 / 365) + ' ans' : 'sur 20 ans') + '</div>';
      html += '</div>';

      // Max consécutif au-dessus
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">Max consécutif ≥</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (maxConsecAbove <= 2 ? '#059669' : '#DC2626') + '">' + maxConsecAbove + ' obs</div>';
      html += '<div style="font-size:11px;color:#475569">pire épisode continu</div>';
      html += '</div>';

      html += '</div>';

      // Forward estimée
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      html += '<div style="padding:8px 12px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;font-size:11px;color:#065F46">';
      html += '<strong>Forward estimée : 85-92%</strong> — en régime de taux normalisés (post-ZIRP), avec haircut stagflation.</div>';
      html += '<div style="padding:8px 12px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;font-size:11px;color:#92400E">';
      html += '⚠️ L\'historique 20 ans inclut 10 ans de taux zéro/négatifs (2012-2022) qui gonflent la probabilité. La forward est plus conservatrice.</div>';
      html += '</div>';

      html += '</div>';
    }
  }

  // ─── Stress test 3 scénarios (pour produits actions) ──────
  if (!isRate && barrier) {
    html += '<div style="padding:12px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;margin-bottom:8px">';
    html += '<div style="font-size:12px;font-weight:700;color:#DC2626;margin-bottom:6px">🔥 Stress Test — Votre capital dans 3 crises historiques</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">';

    var stresses = [
      { name: '2008 Financière', drop: -55, color: '#DC2626' },
      { name: '2020 COVID', drop: -35, color: '#D97706' },
      { name: '2022 Inflation', drop: -22, color: '#D97706' }
    ];
    stresses.forEach(function(s) {
      var finalLevel = 100 + s.drop;
      var breached = finalLevel < barrier;
      var capitalLoss = breached ? Math.round((1 - finalLevel / 100) * 100) : 0;
      html += '<div style="padding:8px;background:white;border-radius:6px;text-align:center;border-left:3px solid ' + s.color + '">';
      html += '<div style="font-size:11px;font-weight:700;color:' + s.color + '">' + s.name + '</div>';
      html += '<div style="font-size:11px;color:#475569">Sous-jacent : ' + s.drop + '%</div>';
      if (breached) {
        html += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:#DC2626">-' + capitalLoss + '% capital</div>';
      } else {
        html += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:#059669">Capital protégé ✅</div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
  }

  return html;
}

// Simple normal CDF approximation for investor metrics
function _normcdfApprox(x) {
  var t = 1 / (1 + 0.2316419 * Math.abs(x));
  var d = 0.3989422804 * Math.exp(-x * x / 2);
  var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}

function renderScorePanel(score) {
  return `<div class="sheet-card score-panel"><h3 class="sheet-card-title">Score de Compatibilité</h3><div class="score-big">${renderScoreWidget(score)}</div><div class="score-verdict">${score.verdict}</div><div class="score-details">${score.details.map(d=>`<div class="score-detail ${d.type}"><span class="score-detail-icon">${d.icon}</span><span class="score-detail-text">${d.text}</span></div>`).join('')}</div></div>`;
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
      <div class="chat-msg system"><div class="chat-msg-content">💡 Discussion sur <strong>${p.name||'ce produit'}</strong>.</div></div>
      ${messages.map(m=>`<div class="chat-msg ${m.role}"><div class="chat-msg-avatar">${m.role==='user'?'👤':'🤖'}</div><div class="chat-msg-content">${m.role==='assistant'?formatAIText(m.content):escapeHTML(m.content)}</div></div>`).join('')}</div>
    <div class="chat-input-area"><textarea id="chat-input" class="chat-input" placeholder="Posez une question..." onkeydown="handleChatKeydown(event)"></textarea>
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
    <div class="upload-zone" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handleFileDrop(event,'${context}','${bankId||''}')">
      <div class="upload-icon">📄</div><div class="upload-text">Glisser le PDF ici</div><div class="upload-sub">ou cliquer pour sélectionner</div>
      <input type="file" accept=".pdf" id="file-input" style="display:none" onchange="handleFileSelect(event,'${context}','${bankId||''}')"></div>
    <button class="btn" style="width:100%;margin-top:12px" onclick="document.getElementById('file-input').click()">Choisir un fichier PDF</button>
    <div class="upload-divider"><span>ou</span></div>
    <button class="btn" style="width:100%;background:rgba(59,130,246,0.08);border-color:rgba(59,130,246,0.25);color:var(--accent)" onclick="toggleJSONPasteZone('${context}','${bankId||''}')">📋 Coller JSON (depuis l'analyseur)</button>
    <div id="json-paste-zone" style="display:none;margin-top:12px">
      <textarea id="json-paste-input" placeholder="Colle ici le JSON généré par l'analyseur de brochure..." style="width:100%;height:120px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:11px;padding:10px;resize:vertical;box-sizing:border-box;outline:none"></textarea>
      <button class="btn primary" style="width:100%;margin-top:8px" onclick="handleJSONPasteImport('${context}','${bankId||''}')">✅ Importer le produit</button>
    </div>
    <div style="margin-top:8px">
      <button class="btn ghost" style="width:100%" onclick="showManualEntryModal('${context}','${bankId||''}')">✏️ Saisie manuelle</button>
    </div>
    <div id="upload-progress" class="upload-progress hidden"><div class="spinner"></div><span id="upload-status">Extraction...</span></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button></div></div></div>`;
  modal.classList.add('visible');
}

// V3.1: Toggle JSON paste zone
window.toggleJSONPasteZone = function(context, bankId) {
  var zone = document.getElementById('json-paste-zone');
  if (zone) {
    zone.style.display = zone.style.display === 'none' ? 'block' : 'none';
    if (zone.style.display !== 'none') {
      var input = document.getElementById('json-paste-input');
      if (input) input.focus();
    }
  }
};

// V3.1: Import product from pasted JSON
window.handleJSONPasteImport = async function(context, bankId) {
  var input = document.getElementById('json-paste-input');
  if (!input || !input.value.trim()) {
    showToast('Colle un JSON valide', 'error');
    return;
  }

  try {
    var json = JSON.parse(input.value.trim());
    console.log('[UI V3.1] JSON paste import:', json.name || 'unnamed');

    // Build product from JSON
    var product = {
      id: app._uid(),
      name: json.name || 'Produit importé',
      type: json.type || json.structureType || 'autre',
      structureType: json.structureType || '',
      emitter: json.emitter || '',
      guarantor: json.guarantor || '',
      guarantorRating: json.guarantorRating || null,
      underlyings: json.underlyings || [],
      underlyingType: json.underlyingType || 'autre',
      currency: json.currency || 'EUR',
      maturity: json.maturity || '',
      maturityYears: json.maturityYears || null,
      coupon: json.coupon || {},
      participationRate: json.participationRate || null,
      capitalProtection: json.capitalProtection || {},
      earlyRedemption: json.earlyRedemption || {},
      decrementPct: json.decrementPct || null,
      actualDividendYield: json.actualDividendYield || null,
      mechanism: json.mechanism || '',
      risks: json.risks || [],
      summary: json.summary || '',
      aiParsed: json,
      sourceFile: 'JSON import'
    };

    // Coupon normalization
    if (typeof product.coupon === 'number') {
      product.coupon = { rate: product.coupon };
    }

    closeModal();

    if (context === 'portfolio') {
      var amount = prompt('Montant investi (€) :');
      if (amount) {
        product.bankId = bankId || '';
        await app.addToPortfolio(product, amount);
      }
    } else {
      var saved = await app.addProposal(bankId, product);
      // Auto-analyze
      if (typeof analyzeProposal === 'function') {
        analyzeProposal(saved).catch(function() {});
      }
      showToast('✅ ' + product.name + ' importé !', 'success');
      app.openProduct(saved);
      return;
    }
    app.render();
  } catch(e) {
    console.error('[UI V3.1] JSON parse error:', e);
    showToast('JSON invalide: ' + e.message, 'error');
  }
};

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
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleManualSave('${context}','${bankId||''}')">Enregistrer</button></div></div></div>`;
}
function showIntegrateModal(productId, bankId) {
  const modal = document.getElementById('modal');
  const product = app._findProduct(productId, bankId);
  const pName = product ? (product.name || 'Produit').substring(0, 40) : 'Produit';
  const entOpts = (typeof MY_ENTITIES !== 'undefined' ? MY_ENTITIES : []).map(e =>
    `<option value="${e.id}">${e.icon || ''} ${e.name}</option>`
  ).join('');

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:560px">
    <h2 class="modal-title">Intégrer au portefeuille</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${escapeHTML(pName)}</div>

    <div id="integrate-contracts">
      <div class="integrate-row" style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:10px">
        <div class="form-field" style="margin:0"><label>Entreprise</label><select class="int-entity">${entOpts}</select></div>
        <div class="form-field" style="margin:0"><label>Montant (€)</label><input class="int-amount" type="number" placeholder="100000" autofocus></div>
        <button class="btn sm" onclick="this.closest('.integrate-row').remove()" style="color:var(--red);margin-bottom:2px" title="Retirer">✕</button>
      </div>
    </div>

    <button class="btn sm" onclick="_addIntegrateRow()" style="margin-bottom:16px;color:var(--accent);border-color:var(--accent)">+ Ajouter un contrat</button>

    <div id="integrate-summary" style="padding:10px;background:rgba(6,214,160,0.05);border-radius:8px;margin-bottom:16px;font-size:12px;color:var(--text-muted)">
      Total : <strong id="integrate-total">0€</strong>
    </div>

    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrateMulti('${productId}','${bankId}')">✅ Intégrer</button></div></div></div>`;
  modal.classList.add('visible');

  // Live total update
  modal.addEventListener('input', _updateIntegrateTotal);
  _updateIntegrateTotal();
}

function _addIntegrateRow() {
  const container = document.getElementById('integrate-contracts');
  if (!container) return;
  const entOpts = (typeof MY_ENTITIES !== 'undefined' ? MY_ENTITIES : []).map(e =>
    `<option value="${e.id}">${e.icon || ''} ${e.name}</option>`
  ).join('');
  const row = document.createElement('div');
  row.className = 'integrate-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:10px';
  row.innerHTML = `
    <div class="form-field" style="margin:0"><label>Entreprise</label><select class="int-entity">${entOpts}</select></div>
    <div class="form-field" style="margin:0"><label>Montant (€)</label><input class="int-amount" type="number" placeholder="100000"></div>
    <button class="btn sm" onclick="this.closest('.integrate-row').remove();_updateIntegrateTotal()" style="color:var(--red);margin-bottom:2px" title="Retirer">✕</button>`;
  container.appendChild(row);
  row.querySelector('.int-amount')?.focus();
}

function _updateIntegrateTotal() {
  const amounts = document.querySelectorAll('.int-amount');
  let total = 0;
  amounts.forEach(a => { total += parseFloat(a.value) || 0; });
  const el = document.getElementById('integrate-total');
  if (el) el.textContent = (typeof formatNumber === 'function' ? formatNumber(total) : total) + '€';
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

async function handleIntegrateMulti(productId, bankId) {
  const rows = document.querySelectorAll('.integrate-row');
  if (rows.length === 0) { showToast('Ajoutez au moins un contrat', 'error'); return; }

  const contracts = [];
  rows.forEach(row => {
    const entity = row.querySelector('.int-entity')?.value || '';
    const amount = parseFloat(row.querySelector('.int-amount')?.value) || 0;
    if (amount > 0) contracts.push({ entity, amount });
  });

  if (contracts.length === 0) { showToast('Montant requis', 'error'); return; }

  const product = app._findProduct(productId, bankId);
  if (!product) return;
  closeModal();

  // Mark proposal as subscribed
  await app.updateProposalStatus(bankId, productId, 'subscribed');

  // Add each contract as a separate portfolio entry
  for (let i = 0; i < contracts.length; i++) {
    const c = contracts[i];
    const copy = JSON.parse(JSON.stringify(product));
    copy.id = app._uid(); // unique ID for each contract
    copy.envelope = c.entity;
    copy.entity = c.entity;
    if (contracts.length > 1) {
      const entName = (typeof MY_ENTITIES !== 'undefined' ? MY_ENTITIES.find(e => e.id === c.entity)?.name : c.entity) || c.entity;
      copy.name = (product.name || 'Produit') + ' (' + entName + ')';
    }
    await app.addToPortfolio(copy, c.amount);
  }

  showToast(contracts.length + ' contrat' + (contracts.length > 1 ? 's' : '') + ' intégré' + (contracts.length > 1 ? 's' : ''), 'success');
  app.goToDashboard();
}

// ─── REJETER: change le statut mais garde le produit ────────
async function handleReject(productId, bankId) {
  if (!confirm('Rejeter cette proposition ?')) return;
  try {
    const resolvedBankId = _resolveBankId(productId, bankId);
    if (!resolvedBankId) { showToast('Erreur: banque introuvable pour ce produit', 'error'); return; }

    const product = app._findProduct(productId, resolvedBankId);
    if (product?.conversation?.length > 0) {
      showToast('Résumé en cours...','info');
      await app.summarizeAndDecide(productId, resolvedBankId, 'rejected');
    }
    await app.updateProposalStatus(resolvedBankId, productId, 'rejected', 'Rejeté manuellement');
    showToast('Proposition rejetée', 'success');
    app.goToDashboard();
  } catch (e) { showToast('Erreur: ' + e.message, 'error'); console.error(e); }
}

// ─── SUPPRIMER: retire complètement le produit ──────────────
async function handleDelete(productId, bankId) {
  if (!confirm('Supprimer définitivement cette proposition ? Cette action est irréversible.')) return;
  try {
    const resolvedBankId = _resolveBankId(productId, bankId);
    if (resolvedBankId) {
      await app.removeProposal(resolvedBankId, productId);
    }
    const inPortfolio = app.state.portfolio.find(p => p.id === productId);
    if (inPortfolio) {
      await app.removeFromPortfolio(productId);
    }
    showToast('Produit supprimé', 'success');
    app.goToDashboard();
  } catch (e) { showToast('Erreur: ' + e.message, 'error'); console.error(e); }
}

// ─── Résoudre le bankId même s'il est vide/undefined ────────
function _resolveBankId(productId, bankId) {
  if (bankId && bankId !== 'undefined' && bankId !== 'null' && app.state.proposals[bankId]) {
    const found = app.state.proposals[bankId].find(p => p.id === productId);
    if (found) return bankId;
  }
  for (const [bId, proposals] of Object.entries(app.state.proposals)) {
    if (proposals.find(p => p.id === productId)) return bId;
  }
  return null;
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

function renderSpec(label, value) { return `<div class="spec-item"><span class="spec-label">${label}</span><span class="spec-value">${value}</span></div>`; }
function formatAIText(text) { if (!text) return ''; return escapeHTML(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'); }
function escapeHTML(str) { const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

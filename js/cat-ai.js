// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — CAT/PS Analyse IA + Chat + Import Taux Intelligent
// V3: Fix rate display + duplicate durations + robust render
// ═══════════════════════════════════════════════════════════════

let catAIConversation = [];
let catAIAnalysis = null;

// ─── Robust JSON repair ─────────────────────────────────────
function repairJSON(text) {
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(text); } catch(e) {}
  let fixed = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}
  let open = 0, inStr = false, lastChar = '';
  for (let i = 0; i < fixed.length; i++) { const c = fixed[i]; if (c === '"' && lastChar !== '\\') inStr = !inStr; if (!inStr) { if (c === '{' || c === '[') open++; if (c === '}' || c === ']') open--; } lastChar = c; }
  if (inStr) fixed += '"';
  while (open > 0) { const lastOpen = []; let s = false, lc = ''; for (let i = 0; i < fixed.length; i++) { const c = fixed[i]; if (c === '"' && lc !== '\\') s = !s; if (!s) { if (c === '{') lastOpen.push('}'); if (c === '[') lastOpen.push(']'); if (c === '}' || c === ']') lastOpen.pop(); } lc = c; } fixed += lastOpen.length > 0 ? lastOpen.pop() : '}'; open--; }
  fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}
  throw new Error('JSON invalide après réparation');
}

// ─── Wrap renderCAT pour injecter le bouton Analyse IA ──────
const _originalRenderCAT = renderCAT;
renderCAT = function(container) {
  _originalRenderCAT(container);
  const btnBar = container.querySelector('.section-header div[style*="display:flex"]');
  if (btnBar) { const aiBtn = document.createElement('button'); aiBtn.className = 'btn ai-glow'; aiBtn.innerHTML = '🤖 Analyse IA'; aiBtn.onclick = () => showCATAnalysis(); const optimBtn = btnBar.querySelector('.ai-glow'); if (optimBtn) btnBar.insertBefore(aiBtn, optimBtn); else btnBar.appendChild(aiBtn); }
};

// ─── Override showCATRatesModal ─────────────────────────────
const _originalShowCATRatesModal = showCATRatesModal;
showCATRatesModal = function() {
  const modal = document.getElementById('modal');
  const durations = [1, 2, 3, 6, 12, 18, 24, 36, 48, 60];
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">📊 Taux du Marché</h2>
    <div style="background:linear-gradient(135deg,rgba(59,130,246,0.08),rgba(139,92,246,0.08));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);padding:16px;margin-bottom:20px">
      <h3 style="font-size:13px;font-weight:600;color:var(--text-bright);margin-bottom:8px">🤖 Import intelligent — Collez un email</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Collez le texte d'un email avec les taux. Claude extraira tous les taux, durées et conditions.</p>
      <div class="form-grid">
        <div class="form-field"><label>Banque</label><select id="import-bank">${BANKS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
        <div class="form-field"><label>Date de validité</label><input id="import-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
      <div class="form-field" style="margin-top:8px"><label>Texte de l'email / grille de taux</label>
        <textarea id="import-text" style="min-height:120px;font-size:12px" placeholder="Collez ici le texte de l'email avec les taux..."></textarea></div>
      <button class="btn ai-glow" style="width:100%;margin-top:10px" onclick="importRatesFromText()">🚀 Extraire les taux avec Claude</button>
      <div id="import-progress" class="upload-progress hidden"><div class="spinner"></div><span id="import-status">Analyse en cours...</span></div>
      <div id="import-results"></div>
    </div>
    <div class="upload-divider"><span>ou saisie manuelle</span></div>
    <div class="form-grid">
      <div class="form-field"><label>Banque</label><select id="rate-bank">${BANKS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
      <div class="form-field"><label>Type</label><select id="rate-type">${PLACEMENT_TYPES.map(t => '<option value="' + t.id + '">' + t.name + '</option>').join('')}</select></div>
      <div class="form-field"><label>Durée</label><select id="rate-duration">${durations.map(d => '<option value="' + d + '">' + d + ' mois</option>').join('')}</select></div>
      <div class="form-field"><label>Taux (%)</label><input id="rate-value" type="number" step="0.01" placeholder="3.50"></div>
    </div>
    <button class="btn primary" style="width:100%;margin-top:12px" onclick="addMarketRate()">Ajouter ce taux</button>
    <div id="rates-section" style="margin-top:16px"><h3 id="rates-header" style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Taux enregistrés (${catManager.rates.rates.length})</h3>
      <div id="rates-list">${renderRatesList()}</div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

// ─── Import IA des taux ─────────────────────────────────────
async function importRatesFromText() {
  const text = document.getElementById('import-text')?.value;
  const bankId = document.getElementById('import-bank')?.value;
  const date = document.getElementById('import-date')?.value;
  if (!text || text.trim().length < 20) { showToast('Collez le texte de l\'email', 'error'); return; }

  const bank = BANKS.find(b => b.id === bankId);
  const progress = document.getElementById('import-progress');
  const status = document.getElementById('import-status');
  const results = document.getElementById('import-results');
  if (progress) progress.classList.remove('hidden');
  if (status) status.textContent = 'Claude analyse la grille de taux...';

  const prompt = `Extrais TOUTES les offres de taux de ce texte (email/grille tarifaire banque).

TEXTE:
---
${text.substring(0, 5000)}
---

JSON valide uniquement (pas de markdown). Sois CONCIS.
{"products":[{"name":"CAT Fixe 12m","type":"cat","rateType":"fixe","durationMonths":12,"averageRate":2.40,"rateSchedule":[{"period":"Mois 1-12","rate":2.40}],"withdrawalConditions":"max 80 car","notice":"32 jours"}]}

RÈGLES:
- Chaque durée/taux = un produit séparé (même si même durée, produits différents)
- Pour les progressifs: rateSchedule par période
- averageRate = taux actuariel moyen annuel brut
- Inclure les produits "Transition" séparément
- withdrawalConditions: max 80 caractères`;

  try {
    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('Erreur IA: ' + res.status);
    const data = await res.json();
    let responseText = data.content?.map(b => b.text || '').join('') || '';
    const parsed = repairJSON(responseText);

    if (progress) progress.classList.add('hidden');
    if (!parsed.products || parsed.products.length === 0) { if (results) results.innerHTML = '<div style="color:var(--orange);padding:10px;font-size:12px">⚠️ Aucun taux trouvé.</div>'; return; }

    let html = `<div style="margin-top:12px"><h3 style="font-size:12px;color:var(--green);margin-bottom:8px">✅ ${parsed.products.length} produit(s) trouvé(s)</h3>`;
    parsed.products.forEach(p => {
      const rateDisplay = p.rateType === 'progressif' && p.rateSchedule
        ? p.rateSchedule.map(s => (s.period || '?') + ': ' + s.rate + '%').join(' → ')
        : p.averageRate + '%';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px">
        <div style="flex:1"><strong style="color:var(--text-bright)">${p.name || 'CAT ' + p.durationMonths + 'm'}</strong>
          <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${p.rateType === 'progressif' ? '📈 ' + rateDisplay : '📊 ' + rateDisplay}</div>
          ${p.withdrawalConditions ? '<div style="color:var(--orange);font-size:10px;margin-top:2px">⚠️ ' + p.withdrawalConditions + '</div>' : ''}</div>
        <div style="display:flex;align-items:center;gap:6px"><span style="font-family:var(--mono);color:var(--green);font-size:14px;font-weight:600">${p.averageRate}%</span><span style="color:var(--text-dim);font-size:11px">${p.durationMonths}m</span></div></div>`;
    });
    html += `<button class="btn success lg" style="width:100%;margin-top:12px" onclick="confirmImportRates()">✅ Importer tous ces taux</button></div>`;
    if (results) results.innerHTML = html;
    window._pendingRatesImport = { parsed, bankId, bankName: bank?.name || bankId, date };
  } catch (e) {
    if (progress) progress.classList.add('hidden');
    if (results) results.innerHTML = `<div style="color:var(--red);padding:10px;font-size:12px">❌ Erreur: ${e.message}</div>`;
  }
}

async function confirmImportRates() {
  const { parsed, bankId, bankName, date } = window._pendingRatesImport || {};
  if (!parsed || !parsed.products) return;

  let imported = 0;
  for (const p of parsed.products) {
    const duration = parseInt(p.durationMonths) || 0;
    const rate = parseFloat(p.averageRate) || 0;
    if (duration <= 0 || rate <= 0) continue;

    // FIX: Use product name as part of key to avoid overwriting different products with same duration
    const productKey = (p.name || '').toLowerCase().replace(/\s+/g, '-').substring(0, 30);
    
    // Remove existing with SAME bank + duration + type + similar name
    catManager.rates.rates = catManager.rates.rates.filter(r => 
      !(r.bankId === bankId && r.durationMonths === duration && r.productType === (p.type || 'cat') && (r.productName || '').toLowerCase().replace(/\s+/g, '-').substring(0, 30) === productKey)
    );

    // Add the new rate
    catManager.rates.rates.push({
      bankId, bankName, durationMonths: duration,
      rate: rate, productType: p.type || 'cat',
      date: date || new Date().toISOString().split('T')[0],
      rateType: p.rateType || 'fixe',
      rateSchedule: p.rateSchedule || null,
      withdrawalConditions: p.withdrawalConditions || null,
      notice: p.notice || null,
      productName: p.name || null,
      calculationBase: p.calculationBase || null,
    });
    catManager.rates.lastUpdated = new Date().toISOString();
    imported++;
  }

  await catManager.saveRates();

  // FIX: Force refresh the rates list with error handling
  try {
    const ratesList = document.getElementById('rates-list');
    if (ratesList) ratesList.innerHTML = renderRatesList();
    const ratesHeader = document.getElementById('rates-header');
    if (ratesHeader) ratesHeader.textContent = `Taux enregistrés (${catManager.rates.rates.length})`;
    // Scroll to rates section
    const ratesSection = document.getElementById('rates-section');
    if (ratesSection) ratesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) { console.error('Erreur rendu taux:', e); }

  const results = document.getElementById('import-results');
  if (results) results.innerHTML = `<div style="color:var(--green);padding:10px;font-size:12px">✅ ${imported} taux importés pour ${bankName} !</div>`;
  const importText = document.getElementById('import-text');
  if (importText) importText.value = '';

  showToast(`${imported} taux importés pour ${bankName}`, 'success');
  window._pendingRatesImport = null;
}

// ─── Override renderRatesList — robust with try-catch ────────
const _originalRenderRatesList = renderRatesList;
renderRatesList = function() {
  try {
    const rates = catManager.rates.rates;
    if (!rates || rates.length === 0) return '<div style="color:var(--text-dim);font-size:12px">Aucun taux enregistré</div>';
    
    return [...rates].sort((a, b) => (a.bankId || '').localeCompare(b.bankId || '') || a.durationMonths - b.durationMonths).map(r => {
      const typeIcon = r.productType === 'parts-sociales' ? '🤝' : '🏦';
      const name = r.productName || (r.bankName + ' ' + r.durationMonths + 'm');
      const rateTypeTag = r.rateType === 'progressif' ? ' <span style="color:var(--purple);font-size:10px">📈</span>' : '';
      
      let scheduleDetail = '';
      if (r.rateSchedule && Array.isArray(r.rateSchedule) && r.rateSchedule.length > 0) {
        try {
          scheduleDetail = '<div style="font-size:10px;color:var(--text-dim);padding-left:16px">' + 
            r.rateSchedule.map(s => (s.period || s.label || '?') + ': ' + s.rate + '%').join(' → ') + '</div>';
        } catch(e) { scheduleDetail = ''; }
      }
      
      const conditions = r.withdrawalConditions ? '<div style="font-size:10px;color:var(--orange);padding-left:16px">⚠️ ' + r.withdrawalConditions + '</div>' : '';
      
      return `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>${typeIcon} <strong>${name}</strong>${rateTypeTag}</span>
          <span style="color:var(--green);font-family:var(--mono);font-weight:600">${r.rate}%</span>
        </div>${scheduleDetail}${conditions}</div>`;
    }).join('');
  } catch(e) {
    console.error('renderRatesList error:', e);
    return '<div style="color:var(--red);font-size:12px">Erreur d\'affichage des taux</div>';
  }
};

// ═══ ANALYSE IA + CHAT ═══════════════════════════════════════

function buildCATPortfolioContext() {
  const stats = catManager.getStats();
  const active = catManager.deposits.filter(d => d.status === 'active');
  const depositsDetail = active.map(d => {
    const type = d.productType === 'parts-sociales' ? 'PS' : 'CAT';
    const exit = EXIT_CONDITIONS.find(e => e.id === d.exitCondition)?.name || d.exitCondition;
    return `- ${type} | ${d.bankName} | "${d.productName || '?'}" | ${d.amount}€ | ${d.rate}% ${d.rateType || 'fixe'} | ${d.durationMonths || '?'}m | Éch: ${d.maturityDate || 'N/A'} | ${exit}`;
  }).join('\n');
  const ratesDetail = catManager.rates.rates.length > 0
    ? catManager.rates.rates.map(r => `- ${r.bankName} | ${r.durationMonths}m | ${r.rate}% ${r.rateType || 'fixe'}${r.productName ? ' (' + r.productName + ')' : ''}${r.withdrawalConditions ? ' | ' + r.withdrawalConditions : ''}`).join('\n')
    : 'Aucun taux renseigné';
  const bankConc = Object.entries(stats.byBank).map(([, v]) => `- ${v.name}: ${v.total}€ (${v.count})`).join('\n');
  return `PORTEFEUILLE: ${stats.totalInvested}€ | ${stats.totalDeposits} placements | Taux: ${stats.weightedRate.toFixed(2)}% | Intérêts: ${stats.totalInterest}€\nObjectifs: réserve ${catManager.objectives.liquidityReserve}€ | FGDR ${catManager.objectives.maxPerBank}€\n\nPLACEMENTS:\n${depositsDetail || 'Aucun'}\n\nBANQUES:\n${bankConc || 'N/A'}\n\nTAUX MARCHÉ:\n${ratesDetail}\n\nFGDR: ${stats.fgdrAlerts.length > 0 ? stats.fgdrAlerts.map(([,v]) => v.name + ' (' + v.total + '€)').join(', ') : 'OK'}`;
}

async function runCATAIAnalysis() {
  const context = buildCATPortfolioContext();
  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: `Conseiller patrimoine. Analyse ce portefeuille CAT/PS.\n\n${context}\n\n1. DIAGNOSTIC 2. CONCENTRATIONS FGDR 3. RENDEMENT vs marché 4. ARBITRAGES 5. OPTIMISATION 6. RISQUES 7. POINTS D'ATTENTION\nDirect, quantitatif, contrarian.` }] }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || 'Pas de réponse.';
}

async function sendCATChatMessage(userMessage) {
  const context = buildCATPortfolioContext();
  catAIConversation.push({ role: 'user', content: userMessage, timestamp: Date.now() });
  const messages = catAIConversation.map(m => ({ role: m.role, content: m.content }));
  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: `Conseiller patrimoine expert épargne.\n\nPortefeuille:\n${context}\n\n${catAIAnalysis ? 'ANALYSE:\n' + catAIAnalysis : ''}\n\nDirect, quantitatif, contrarian.`, messages }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  const response = data.content?.map(b => b.text || '').join('\n') || '';
  catAIConversation.push({ role: 'assistant', content: response, timestamp: Date.now() });
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: catAIAnalysis, conversation: catAIConversation }, '[StructBoard] CAT AI chat');
  return response;
}

async function loadCATAIConversation() { try { const data = await github.readFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`); if (data) { catAIConversation = data.conversation || []; catAIAnalysis = data.analysis || null; } } catch (e) {} }

async function resetCATChat() {
  if (catAIConversation.length > 0 && !confirm('Effacer la conversation?')) return;
  catAIConversation = []; catAIAnalysis = null;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: null, conversation: [] }, '[StructBoard] Reset CAT AI');
  showToast('Conversation réinitialisée', 'success'); showCATAnalysis();
}

// ═══ UI: Vue Analyse IA ═══
function showCATAnalysis() {
  const container = document.getElementById('main-content');
  container.innerHTML = `
    <div class="sheet-nav"><button class="btn ghost" onclick="switchMainView('cat')">← Retour</button><div class="sheet-nav-title">Analyse IA du Portefeuille</div><div class="sheet-nav-actions"><button class="btn" onclick="resetCATChat()">Nouvelle conversation</button></div></div>
    <div class="sheet-layout"><div class="sheet-main">
        <div class="sheet-card"><h3 class="sheet-card-title"><span class="card-icon">🧠</span> Analyse</h3>
          <div id="cat-ai-analysis-content">${catAIAnalysis ? `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>` : `<div style="text-align:center;padding:30px"><p style="color:var(--text-muted);margin-bottom:16px">Claude analyse: concentrations, rendement, risques, arbitrages.</p><button class="btn ai-glow lg" onclick="launchCATAnalysis()">🚀 Lancer l'analyse</button></div>`}</div></div>
        <div class="sheet-card" style="min-height:400px;display:flex;flex-direction:column"><h3 class="sheet-card-title"><span class="card-icon">💬</span> Discussion</h3>
          <div id="cat-chat-messages" style="flex:1;overflow-y:auto;max-height:400px;margin-bottom:12px"><div class="chat-msg system"><div class="chat-msg-content">💡 Posez vos questions sur vos placements.</div></div>${catAIConversation.map(m => `<div class="chat-msg ${m.role}"><div class="chat-msg-avatar">${m.role==='user'?'👤':'🤖'}</div><div class="chat-msg-content">${m.role==='assistant'?formatAIText(m.content):escapeHTML(m.content)}</div></div>`).join('')}</div>
          <div class="chat-input-area"><textarea id="cat-chat-input" class="chat-input" placeholder="Ex: Ce CAT vaut-il le coup?" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCATChat()}"></textarea><button class="btn primary" onclick="sendCATChat()" id="cat-chat-send">Envoyer</button></div></div>
      </div><div class="sheet-sidebar">
        <div class="sheet-card"><h3 class="sheet-card-title">Portefeuille</h3>${renderCATSidebarStats()}</div>
        <div class="sheet-card"><h3 class="sheet-card-title">Questions rapides</h3><div class="action-buttons">
            <button class="btn ai-glow" style="width:100%" onclick="launchCATAnalysis()">🚀 Re-analyser</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels placements sous-performent?')">Sous-performances?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels arbitrages?')">Arbitrages?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Diversification OK?')">Diversification?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels risques?')">Risques?</button>
          </div></div>
      </div></div>`;
  const c = document.getElementById('cat-chat-messages'); if (c) c.scrollTop = c.scrollHeight;
}

function renderCATSidebarStats() {
  const s = catManager.getStats();
  return `<div style="font-size:12px;line-height:1.8">
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Total</span><span style="font-family:var(--mono);color:var(--text-bright)">${formatNumber(s.totalInvested)}€</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Taux</span><span style="font-family:var(--mono);color:var(--green)">${formatPct(s.weightedRate)}</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Intérêts</span><span style="font-family:var(--mono);color:var(--green)">+${formatNumber(s.totalInterest)}€</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">CAT</span><span>${s.catCount} · ${formatNumber(s.catTotal)}€</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">PS</span><span>${s.psCount} · ${formatNumber(s.psTotal)}€</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Banques</span><span>${Object.keys(s.byBank).length}</span></div>
    ${s.fgdrAlerts.length > 0 ? `<div style="color:var(--red);margin-top:8px">⚠️ ${s.fgdrAlerts.length} alerte(s) FGDR</div>` : ''}</div>`;
}

async function launchCATAnalysis() {
  const c = document.getElementById('cat-ai-analysis-content');
  c.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse en cours...</div>';
  try { catAIAnalysis = await runCATAIAnalysis(); c.innerHTML = `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>`; await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: catAIAnalysis, conversation: catAIConversation }, '[StructBoard] CAT AI analysis'); showToast('Analyse terminée', 'success'); }
  catch (e) { c.innerHTML = `<div style="color:var(--red);padding:20px">Erreur: ${e.message}</div>`; }
}

async function sendCATChat() {
  const input = document.getElementById('cat-chat-input'); const btn = document.getElementById('cat-chat-send');
  if (!input || !input.value.trim()) return;
  const msg = input.value.trim(); input.value = ''; btn.disabled = true; btn.textContent = '...';
  const el = document.getElementById('cat-chat-messages');
  el.innerHTML += `<div class="chat-msg user"><div class="chat-msg-avatar">👤</div><div class="chat-msg-content">${escapeHTML(msg)}</div></div>`;
  el.innerHTML += `<div class="chat-msg assistant" id="cat-typing"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content"><div class="spinner" style="display:inline-block"></div> Réflexion...</div></div>`;
  el.scrollTop = el.scrollHeight;
  try { const r = await sendCATChatMessage(msg); const t = document.getElementById('cat-typing'); if (t) t.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content">${formatAIText(r)}</div></div>`; el.scrollTop = el.scrollHeight; }
  catch (e) { const t = document.getElementById('cat-typing'); if (t) t.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content" style="color:var(--red)">Erreur: ${e.message}</div></div>`; }
  btn.disabled = false; btn.textContent = 'Envoyer';
}

function askCATQuestion(q) { const i = document.getElementById('cat-chat-input'); if (i) { i.value = q; sendCATChat(); } }

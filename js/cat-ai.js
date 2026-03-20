// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — CAT/PS Analyse IA + Chat + Import Taux Intelligent
// V2: Fix JSON truncation (max_tokens 4000 + robust repair)
// ═══════════════════════════════════════════════════════════════

let catAIConversation = [];
let catAIAnalysis = null;

// ─── Robust JSON repair ─────────────────────────────────────
function repairJSON(text) {
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(text); } catch(e) {}
  // Fix trailing commas
  let fixed = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}
  // Try to close unclosed strings/arrays/objects
  let open = 0, inStr = false, lastChar = '';
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (c === '"' && lastChar !== '\\') inStr = !inStr;
    if (!inStr) { if (c === '{' || c === '[') open++; if (c === '}' || c === ']') open--; }
    lastChar = c;
  }
  if (inStr) fixed += '"';
  // Close open brackets
  while (open > 0) {
    // Check if we need ] or }
    const lastOpen = [];
    let s = false, lc = '';
    for (let i = 0; i < fixed.length; i++) {
      const c = fixed[i];
      if (c === '"' && lc !== '\\') s = !s;
      if (!s) { if (c === '{') lastOpen.push('}'); if (c === '[') lastOpen.push(']'); if (c === '}' || c === ']') lastOpen.pop(); }
      lc = c;
    }
    fixed += lastOpen.length > 0 ? lastOpen.pop() : '}';
    open--;
  }
  fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}
  throw new Error('JSON invalide après réparation');
}

// ─── Wrap renderCAT pour injecter le bouton Analyse IA ──────
const _originalRenderCAT = renderCAT;
renderCAT = function(container) {
  _originalRenderCAT(container);
  const btnBar = container.querySelector('.section-header div[style*="display:flex"]');
  if (btnBar) {
    const aiBtn = document.createElement('button');
    aiBtn.className = 'btn ai-glow';
    aiBtn.innerHTML = '🤖 Analyse IA';
    aiBtn.onclick = () => showCATAnalysis();
    const optimBtn = btnBar.querySelector('.ai-glow');
    if (optimBtn) btnBar.insertBefore(aiBtn, optimBtn);
    else btnBar.appendChild(aiBtn);
  }
};

// ─── Override showCATRatesModal pour ajouter l'import IA ────
const _originalShowCATRatesModal = showCATRatesModal;
showCATRatesModal = function() {
  const modal = document.getElementById('modal');
  const durations = [1, 2, 3, 6, 12, 18, 24, 36, 48, 60];
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">📊 Taux du Marché</h2>

    <!-- IMPORT INTELLIGENT -->
    <div style="background:linear-gradient(135deg,rgba(59,130,246,0.08),rgba(139,92,246,0.08));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);padding:16px;margin-bottom:20px">
      <h3 style="font-size:13px;font-weight:600;color:var(--text-bright);margin-bottom:8px">🤖 Import intelligent — Collez un email</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Collez le texte d'un email avec les taux d'une banque. Claude extraira automatiquement tous les taux, durées et conditions.</p>
      <div class="form-grid">
        <div class="form-field"><label>Banque</label><select id="import-bank">
          ${BANKS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
        <div class="form-field"><label>Date de validité</label><input id="import-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
      <div class="form-field" style="margin-top:8px"><label>Texte de l'email / grille de taux</label>
        <textarea id="import-text" style="min-height:120px;font-size:12px" placeholder="Collez ici le texte de l'email avec les taux...&#10;&#10;Ex: CAT 12 mois: 2.40%&#10;CAT 36 mois progressif: Année 1: 2.30%, Année 2: 2.80%..."></textarea></div>
      <button class="btn ai-glow" style="width:100%;margin-top:10px" onclick="importRatesFromText()">🚀 Extraire les taux avec Claude</button>
      <div id="import-progress" class="upload-progress hidden"><div class="spinner"></div><span id="import-status">Analyse en cours...</span></div>
      <div id="import-results"></div>
    </div>

    <div class="upload-divider"><span>ou saisie manuelle</span></div>

    <!-- SAISIE MANUELLE -->
    <div class="form-grid">
      <div class="form-field"><label>Banque</label><select id="rate-bank">
        ${BANKS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
      <div class="form-field"><label>Type</label><select id="rate-type">
        ${PLACEMENT_TYPES.map(t => '<option value="' + t.id + '">' + t.name + '</option>').join('')}</select></div>
      <div class="form-field"><label>Durée</label><select id="rate-duration">
        ${durations.map(d => '<option value="' + d + '">' + d + ' mois</option>').join('')}</select></div>
      <div class="form-field"><label>Taux (%)</label><input id="rate-value" type="number" step="0.01" placeholder="3.50"></div>
    </div>
    <button class="btn primary" style="width:100%;margin-top:12px" onclick="addMarketRate()">Ajouter ce taux</button>

    <div style="margin-top:16px"><h3 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Taux enregistrés (${catManager.rates.rates.length})</h3>
      <div id="rates-list">${renderRatesList()}</div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

// ─── Import IA des taux depuis texte email ──────────────────
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

  const prompt = `Tu es un analyste financier. Extrais TOUTES les offres de taux de ce texte (email/grille tarifaire d'une banque).

TEXTE:
---
${text.substring(0, 5000)}
---

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks). Sois CONCIS dans les champs texte.
{
  "bankName": "Nom banque",
  "validityDate": "Période",
  "products": [
    {
      "name": "CAT Fixe 12 mois",
      "type": "cat",
      "rateType": "fixe",
      "durationMonths": 12,
      "averageRate": 2.40,
      "rateSchedule": [{"period": "Mois 1-12", "rate": 2.40}],
      "withdrawalConditions": "Conditions retrait",
      "notice": "32 jours"
    }
  ]
}

RÈGLES:
- Chaque durée/taux = un produit séparé
- Pour les progressifs: détaille rateSchedule par période
- withdrawalConditions: court (max 80 car)
- averageRate = taux actuariel moyen annuel brut`;

  try {
    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('Erreur IA: ' + res.status);
    const data = await res.json();
    let responseText = data.content?.map(b => b.text || '').join('') || '';
    const parsed = repairJSON(responseText);

    if (progress) progress.classList.add('hidden');

    if (!parsed.products || parsed.products.length === 0) {
      if (results) results.innerHTML = '<div style="color:var(--orange);padding:10px;font-size:12px">⚠️ Aucun taux trouvé dans ce texte.</div>';
      return;
    }

    let html = `<div style="margin-top:12px">
      <h3 style="font-size:12px;color:var(--green);margin-bottom:8px">✅ ${parsed.products.length} produit(s) trouvé(s)</h3>`;

    parsed.products.forEach((p, i) => {
      const rateDisplay = p.rateType === 'progressif'
        ? p.rateSchedule?.map(s => s.period + ': ' + s.rate + '%').join(' → ') || p.averageRate + '%'
        : p.averageRate + '%';

      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px">
        <div style="flex:1">
          <strong style="color:var(--text-bright)">${p.name || p.type + ' ' + p.durationMonths + ' mois'}</strong>
          <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${p.rateType === 'progressif' ? '📈 Progressif: ' + rateDisplay : '📊 Fixe: ' + rateDisplay}</div>
          ${p.withdrawalConditions ? '<div style="color:var(--orange);font-size:10px;margin-top:2px">⚠️ ' + p.withdrawalConditions + '</div>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-family:var(--mono);color:var(--green);font-size:14px;font-weight:600">${p.averageRate}%</span>
          <span style="color:var(--text-dim);font-size:11px">${p.durationMonths}m</span>
        </div>
      </div>`;
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
    if (duration > 0 && rate > 0) {
      catManager.addRate(bankId, bankName, duration, rate, p.type || 'cat', date);
      const existing = catManager.rates.rates.find(r => r.bankId === bankId && r.durationMonths === duration && r.productType === (p.type || 'cat'));
      if (existing) {
        existing.rateType = p.rateType || 'fixe';
        existing.rateSchedule = p.rateSchedule || null;
        existing.withdrawalConditions = p.withdrawalConditions || null;
        existing.notice = p.notice || null;
        existing.productName = p.name || null;
        existing.calculationBase = p.calculationBase || null;
      }
      imported++;
    }
  }

  if (parsed.generalConditions) {
    catManager.rates.generalConditions = catManager.rates.generalConditions || {};
    catManager.rates.generalConditions[bankId] = { text: parsed.generalConditions, date, rawImportText: document.getElementById('import-text')?.value?.substring(0, 2000) || '' };
  }

  await catManager.saveRates();
  showToast(`${imported} taux importés pour ${bankName}`, 'success');
  const ratesList = document.getElementById('rates-list');
  if (ratesList) ratesList.innerHTML = renderRatesList();
  const results = document.getElementById('import-results');
  if (results) results.innerHTML = '<div style="color:var(--green);padding:10px;font-size:12px">✅ Import terminé !</div>';
  document.getElementById('import-text').value = '';
  window._pendingRatesImport = null;
}

// ─── Override renderRatesList pour afficher les détails ──────
const _originalRenderRatesList = renderRatesList;
renderRatesList = function() {
  if (catManager.rates.rates.length === 0) return '<div style="color:var(--text-dim);font-size:12px">Aucun taux</div>';
  return [...catManager.rates.rates].sort((a, b) => (a.bankId || '').localeCompare(b.bankId || '') || a.durationMonths - b.durationMonths).map(r => {
    const typeIcon = r.productType === 'parts-sociales' ? '🤝' : '🏦';
    const rateTypeTag = r.rateType === 'progressif' ? '<span style="color:var(--purple);font-size:10px;margin-left:4px">📈 progressif</span>' : '';
    const scheduleDetail = r.rateSchedule ? '<div style="font-size:10px;color:var(--text-dim);padding-left:16px">' + r.rateSchedule.map(s => s.period + ': ' + s.rate + '%').join(' → ') + '</div>' : '';
    const conditions = r.withdrawalConditions ? '<div style="font-size:10px;color:var(--orange);padding-left:16px">⚠️ ' + r.withdrawalConditions + '</div>' : '';
    return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <div style="display:flex;justify-content:space-between">
        <span>${typeIcon} ${r.bankName} · ${r.durationMonths} mois${rateTypeTag}</span>
        <span style="color:var(--green);font-family:var(--mono)">${r.rate}%</span>
      </div>${scheduleDetail}${conditions}</div>`;
  }).join('');
};

// ═══════════════════════════════════════════════════════════════
// ANALYSE IA + CHAT
// ═══════════════════════════════════════════════════════════════

function buildCATPortfolioContext() {
  const stats = catManager.getStats();
  const active = catManager.deposits.filter(d => d.status === 'active');
  const depositsDetail = active.map(d => {
    const type = d.productType === 'parts-sociales' ? 'Parts Sociales' : 'CAT';
    const exit = EXIT_CONDITIONS.find(e => e.id === d.exitCondition)?.name || d.exitCondition;
    return `- ${type} | ${d.bankName} | "${d.productName || 'Sans nom'}" | ${d.amount}€ | ${d.rate}% ${d.rateType || 'fixe'} | ${d.durationMonths ? d.durationMonths + ' mois' : 'Indéterminée'} | Échéance: ${d.maturityDate || 'N/A'} | Sortie: ${exit} | Pénalité: ${d.exitPenalty || 'Aucune'}`;
  }).join('\n');
  const ratesDetail = catManager.rates.rates.length > 0
    ? catManager.rates.rates.map(r => `- ${r.bankName} | ${r.productType} | ${r.durationMonths}m | ${r.rate}% ${r.rateType || 'fixe'}${r.withdrawalConditions ? ' | Retrait: ' + r.withdrawalConditions : ''}`).join('\n')
    : 'Aucun taux renseigné';
  const bankConcentration = Object.entries(stats.byBank).map(([id, v]) => `- ${v.name}: ${v.total}€ (${v.count} placements)`).join('\n');
  return `PORTEFEUILLE ÉPARGNE (CAT + PARTS SOCIALES)
Total placé: ${stats.totalInvested}€ | ${stats.totalDeposits} placements (${stats.catCount} CAT, ${stats.psCount} PS) | Taux pondéré: ${stats.weightedRate.toFixed(2)}% | Intérêts: ${stats.totalInterest}€
Objectifs: mensuel ${catManager.objectives.monthlyNeed}€ | réserve ${catManager.objectives.liquidityReserve}€ | plafond FGDR ${catManager.objectives.maxPerBank}€

PLACEMENTS:\n${depositsDetail || 'Aucun'}

BANQUES:\n${bankConcentration || 'N/A'}

TAUX MARCHÉ:\n${ratesDetail}

ALERTES FGDR: ${stats.fgdrAlerts.length > 0 ? stats.fgdrAlerts.map(([,v]) => v.name + ' (' + v.total + '€)').join(', ') : 'Aucune'}`;
}

async function runCATAIAnalysis() {
  const context = buildCATPortfolioContext();
  const prompt = `Tu es un conseiller en gestion de patrimoine. Analyse ce portefeuille de CAT et Parts Sociales.\n\n${context}\n\nAnalyse COMPLÈTE et DIRECTE:\n1. **DIAGNOSTIC** — Diversification, rendement, liquidité, risques\n2. **CONCENTRATIONS** — FGDR, durée, type\n3. **RENDEMENT** — Taux pondéré vs marché? Sous-performances?\n4. **ARBITRAGES** — Quoi arrêter/renouveler/augmenter?\n5. **OPTIMISATION** — Ré-allocation idéale\n6. **RISQUES** — Taux, liquidité, contrepartie\n7. **POINTS D'ATTENTION** — Pénalités, renew auto, échéances\n\nDirect, quantitatif, contrarian. Pas de langue de bois.`;

  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || 'Pas de réponse.';
}

async function sendCATChatMessage(userMessage) {
  const context = buildCATPortfolioContext();
  catAIConversation.push({ role: 'user', content: userMessage, timestamp: Date.now() });
  const systemPrompt = `Tu es un conseiller en gestion de patrimoine expert en épargne.\n\nPortefeuille:\n${context}\n\n${catAIAnalysis ? 'ANALYSE:\n' + catAIAnalysis : ''}\n\nSois direct, quantitatif, challenge si nécessaire. Compare avec les taux du marché. Propose des alternatives concrètes.`;
  const messages = catAIConversation.map(m => ({ role: m.role, content: m.content }));
  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: systemPrompt, messages }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  const response = data.content?.map(b => b.text || '').join('\n') || '';
  catAIConversation.push({ role: 'assistant', content: response, timestamp: Date.now() });
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: catAIAnalysis, conversation: catAIConversation }, '[StructBoard] CAT AI chat');
  return response;
}

async function loadCATAIConversation() {
  try { const data = await github.readFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`); if (data) { catAIConversation = data.conversation || []; catAIAnalysis = data.analysis || null; } } catch (e) { console.log('Pas de conversation IA existante'); }
}

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
    <div class="sheet-nav">
      <button class="btn ghost" onclick="switchMainView('cat')">← Retour</button>
      <div class="sheet-nav-title">Analyse IA du Portefeuille</div>
      <div class="sheet-nav-actions"><button class="btn" onclick="resetCATChat()">Nouvelle conversation</button></div>
    </div>
    <div class="sheet-layout">
      <div class="sheet-main">
        <div class="sheet-card">
          <h3 class="sheet-card-title"><span class="card-icon">🧠</span> Analyse</h3>
          <div id="cat-ai-analysis-content">
            ${catAIAnalysis ? `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>` : `<div style="text-align:center;padding:30px"><p style="color:var(--text-muted);margin-bottom:16px">Claude analyse: concentrations, rendement, risques, arbitrages.</p><button class="btn ai-glow lg" onclick="launchCATAnalysis()">🚀 Lancer l'analyse</button></div>`}
          </div>
        </div>
        <div class="sheet-card" style="min-height:400px;display:flex;flex-direction:column">
          <h3 class="sheet-card-title"><span class="card-icon">💬</span> Discussion</h3>
          <div id="cat-chat-messages" style="flex:1;overflow-y:auto;max-height:400px;margin-bottom:12px">
            <div class="chat-msg system"><div class="chat-msg-content">💡 Posez vos questions. Claude connaît vos placements, taux du marché et objectifs.</div></div>
            ${catAIConversation.map(m => `<div class="chat-msg ${m.role}"><div class="chat-msg-avatar">${m.role==='user'?'👤':'🤖'}</div><div class="chat-msg-content">${m.role==='assistant'?formatAIText(m.content):escapeHTML(m.content)}</div></div>`).join('')}
          </div>
          <div class="chat-input-area">
            <textarea id="cat-chat-input" class="chat-input" placeholder="Ex: Ce CAT SG à 2.4% vaut-il le coup vs les autres banques?" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCATChat()}"></textarea>
            <button class="btn primary" onclick="sendCATChat()" id="cat-chat-send">Envoyer</button>
          </div>
        </div>
      </div>
      <div class="sheet-sidebar">
        <div class="sheet-card"><h3 class="sheet-card-title">Portefeuille</h3>${renderCATSidebarStats()}</div>
        <div class="sheet-card"><h3 class="sheet-card-title">Questions rapides</h3>
          <div class="action-buttons">
            <button class="btn ai-glow" style="width:100%" onclick="launchCATAnalysis()">🚀 Re-analyser</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels placements sous-performent vs les taux du marché?')">Sous-performances?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels arbitrages concrets recommandes-tu?')">Arbitrages?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Diversification OK?')">Diversification?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels risques?')">Risques?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Impact si les taux baissent de 1%?')">Impact taux?</button>
          </div>
        </div>
      </div>
    </div>`;
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
  try {
    catAIAnalysis = await runCATAIAnalysis();
    c.innerHTML = `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>`;
    await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: catAIAnalysis, conversation: catAIConversation }, '[StructBoard] CAT AI analysis');
    showToast('Analyse terminée', 'success');
  } catch (e) { c.innerHTML = `<div style="color:var(--red);padding:20px">Erreur: ${e.message}</div>`; }
}

async function sendCATChat() {
  const input = document.getElementById('cat-chat-input'); const btn = document.getElementById('cat-chat-send');
  if (!input || !input.value.trim()) return;
  const msg = input.value.trim(); input.value = ''; btn.disabled = true; btn.textContent = '...';
  const el = document.getElementById('cat-chat-messages');
  el.innerHTML += `<div class="chat-msg user"><div class="chat-msg-avatar">👤</div><div class="chat-msg-content">${escapeHTML(msg)}</div></div>`;
  el.innerHTML += `<div class="chat-msg assistant" id="cat-typing"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content"><div class="spinner" style="display:inline-block"></div> Réflexion...</div></div>`;
  el.scrollTop = el.scrollHeight;
  try {
    const r = await sendCATChatMessage(msg);
    const t = document.getElementById('cat-typing');
    if (t) t.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content">${formatAIText(r)}</div></div>`;
    el.scrollTop = el.scrollHeight;
  } catch (e) {
    const t = document.getElementById('cat-typing');
    if (t) t.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content" style="color:var(--red)">Erreur: ${e.message}</div></div>`;
  }
  btn.disabled = false; btn.textContent = 'Envoyer';
}

function askCATQuestion(q) { const i = document.getElementById('cat-chat-input'); if (i) { i.value = q; sendCATChat(); } }

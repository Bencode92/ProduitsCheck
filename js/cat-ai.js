// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — CAT AI V3b: Add PDF rate sheet import
// ═══════════════════════════════════════════════════════════════

let catAIConversation = [];
let catAIAnalysis = null;

// ─── Robust JSON repair (local to cat-ai) ───────────────────
function repairJSON(text) {
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(text); } catch(e) {}
  let fixed = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}
  // Stack-based bracket closing
  const stack = []; let inStr = false, lc = '';
  for (let i = 0; i < fixed.length; i++) { const c = fixed[i]; if (c === '"' && lc !== '\\') inStr = !inStr; if (!inStr) { if (c === '{') stack.push('}'); if (c === '[') stack.push(']'); if (c === '}' || c === ']') stack.pop(); } lc = c; }
  if (inStr) fixed += '"';
  fixed = fixed.replace(/,\s*$/, '');
  while (stack.length > 0) fixed += stack.pop();
  fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}
  // Extract JSON from text
  const m = fixed.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch(e) {} }
  throw new Error('JSON invalide après réparation');
}

// ─── Wrap renderCAT pour injecter le bouton Analyse IA ──────
const _originalRenderCAT = renderCAT;
renderCAT = function(container) {
  _originalRenderCAT(container);
  const btnBar = container.querySelector('.section-header div[style*="display:flex"]');
  if (btnBar) { const aiBtn = document.createElement('button'); aiBtn.className = 'btn ai-glow'; aiBtn.innerHTML = '🤖 Analyse IA'; aiBtn.onclick = () => showCATAnalysis(); const optimBtn = btnBar.querySelector('.ai-glow'); if (optimBtn) btnBar.insertBefore(aiBtn, optimBtn); else btnBar.appendChild(aiBtn); }
};

// ─── Override showCATRatesModal — with PDF upload ───────────
const _originalShowCATRatesModal = showCATRatesModal;
showCATRatesModal = function() {
  const modal = document.getElementById('modal');
  const durations = [1, 2, 3, 6, 12, 18, 24, 36, 48, 60];
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">📊 Taux du Marché</h2>

    <!-- METHOD 1: PDF Upload for rate sheets -->
    <div style="background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(59,130,246,0.08));border:1px solid rgba(139,92,246,0.2);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <h3 style="font-size:13px;font-weight:600;color:var(--purple);margin-bottom:8px">📄 Importer une grille de taux (PDF)</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Uploadez une brochure de taux CAT (type Optiplus, grille tarifaire). Claude extraira tous les taux automatiquement.</p>
      <div class="form-grid">
        <div class="form-field"><label>Banque</label><select id="pdf-rate-bank">${BANKS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
        <div class="form-field"><label>Date de validité</label><input id="pdf-rate-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
      <div style="margin-top:8px">
        <label style="display:block;padding:16px;border:2px dashed var(--border);border-radius:var(--radius-sm);text-align:center;cursor:pointer;transition:border-color 0.2s" onmouseover="this.style.borderColor='var(--purple)'" onmouseout="this.style.borderColor='var(--border)'">
          <input type="file" accept=".pdf" style="display:none" onchange="handleRateSheetPDF(this.files[0])">
          <div style="font-size:12px;color:var(--text-bright)">📄 Cliquer pour choisir un PDF</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px">Grille tarifaire, brochure Optiplus, etc.</div>
        </label>
      </div>
      <div id="pdf-rate-progress" class="upload-progress hidden"><div class="spinner"></div><span id="pdf-rate-status">Extraction...</span></div>
      <div id="pdf-rate-results"></div>
    </div>

    <!-- METHOD 2: Email/text paste -->
    <div style="background:linear-gradient(135deg,rgba(59,130,246,0.08),rgba(139,92,246,0.08));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <h3 style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:8px">🤖 Coller un email / texte</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Collez le texte d'un email avec les taux.</p>
      <div class="form-grid">
        <div class="form-field"><label>Banque</label><select id="import-bank">${BANKS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
        <div class="form-field"><label>Date de validité</label><input id="import-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
      <div class="form-field" style="margin-top:8px"><textarea id="import-text" style="min-height:100px;font-size:12px" placeholder="Collez ici le texte de l'email avec les taux..."></textarea></div>
      <button class="btn ai-glow" style="width:100%;margin-top:8px" onclick="importRatesFromText()">🚀 Extraire avec Claude</button>
      <div id="import-progress" class="upload-progress hidden"><div class="spinner"></div><span id="import-status">Analyse...</span></div>
      <div id="import-results"></div>
    </div>

    <!-- METHOD 3: Manual -->
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <h3 style="font-size:13px;font-weight:600;color:var(--text-bright);margin-bottom:8px">✏️ Saisie manuelle</h3>
      <div class="form-grid">
        <div class="form-field"><label>Banque</label><select id="rate-bank">${BANKS.map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
        <div class="form-field"><label>Type</label><select id="rate-type">${PLACEMENT_TYPES.map(t => '<option value="' + t.id + '">' + t.name + '</option>').join('')}</select></div>
        <div class="form-field"><label>Durée</label><select id="rate-duration">${durations.map(d => '<option value="' + d + '">' + d + ' mois</option>').join('')}</select></div>
        <div class="form-field"><label>Taux (%)</label><input id="rate-value" type="number" step="0.01" placeholder="3.50"></div>
      </div>
      <button class="btn primary" style="width:100%;margin-top:8px" onclick="addMarketRate()">Ajouter</button>
    </div>

    <div id="rates-section"><h3 id="rates-header" style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Taux enregistrés (${catManager.rates.rates.length})</h3>
      <div id="rates-list">${renderRatesList()}</div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

// ─── PDF Rate Sheet Upload ──────────────────────────────────
async function handleRateSheetPDF(file) {
  if (!file) return;
  const bankId = document.getElementById('pdf-rate-bank')?.value;
  const date = document.getElementById('pdf-rate-date')?.value;
  const bank = BANKS.find(b => b.id === bankId);
  const progress = document.getElementById('pdf-rate-progress');
  const status = document.getElementById('pdf-rate-status');
  const results = document.getElementById('pdf-rate-results');

  if (progress) progress.classList.remove('hidden');
  if (status) status.textContent = 'Extraction du texte PDF...';

  try {
    // Step 1: Extract text from PDF
    const rawText = await pdfExtractor.extractText(file);
    if (!rawText || rawText.trim().length < 50) throw new Error('PDF vide ou illisible');
    console.log('[rateSheetPDF] Extracted text length:', rawText.length);

    if (status) status.textContent = 'Claude analyse la grille de taux...';

    // Step 2: Send to Claude for rate extraction
    const prompt = `Extrais TOUTES les offres de comptes à terme de cette brochure/grille de taux bancaire.

TEXTE BROCHURE:
${rawText.substring(0, 8000)}

Nom du fichier: ${file.name}

Extrais CHAQUE durée/taux comme un produit séparé.
JSON valide uniquement (pas de backticks, pas de texte):
{"products":[{"name":"Optiplus 3m","type":"cat","rateType":"fixe","durationMonths":3,"averageRate":1.75,"withdrawalConditions":"max 80 car","notice":"32 jours"}]}

RÈGLES:
- Chaque ligne du barème = un produit avec sa durée et son taux
- averageRate = TRAAB ou taux annuel brut
- Si taux progressif: rateType="progressif" et rateSchedule
- withdrawalConditions: conditions de retrait anticipé (max 80 car)
- notice: préavis si mentionné`;

    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('Erreur IA: ' + res.status);
    const data = await res.json();
    const responseText = data.content?.map(b => b.text || '').join('') || '';
    console.log('[rateSheetPDF] AI response length:', responseText.length);
    const parsed = repairJSON(responseText);

    if (progress) progress.classList.add('hidden');
    if (!parsed.products || parsed.products.length === 0) {
      if (results) results.innerHTML = '<div style="color:var(--orange);padding:10px;font-size:12px">⚠️ Aucun taux trouvé dans ce PDF.</div>';
      return;
    }

    // Step 3: Show results for confirmation
    let html = `<div style="margin-top:12px"><h3 style="font-size:12px;color:var(--green);margin-bottom:8px">✅ ${parsed.products.length} taux trouvés dans ${file.name}</h3>`;
    parsed.products.forEach(p => {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px">
        <div style="flex:1"><strong style="color:var(--text-bright)">${p.name || 'CAT ' + p.durationMonths + 'm'}</strong>
          <span style="color:var(--text-dim);font-size:10px;margin-left:6px">${p.durationMonths}m · ${p.rateType || 'fixe'}</span>
          ${p.withdrawalConditions ? '<div style="color:var(--orange);font-size:9px;margin-top:2px">⚠️ ' + p.withdrawalConditions + '</div>' : ''}</div>
        <span style="font-family:var(--mono);color:var(--green);font-size:14px;font-weight:700">${p.averageRate}%</span></div>`;
    });
    html += `<button class="btn success lg" style="width:100%;margin-top:12px" onclick="confirmImportRates()">✅ Importer ${parsed.products.length} taux</button></div>`;
    if (results) results.innerHTML = html;

    window._pendingRatesImport = { parsed, bankId, bankName: bank?.name || bankId, date: date || new Date().toISOString().split('T')[0] };

  } catch(e) {
    console.error('[rateSheetPDF] Error:', e);
    if (progress) progress.classList.add('hidden');
    if (results) results.innerHTML = `<div style="color:var(--red);padding:10px;font-size:12px">❌ ${e.message}</div>`;
  }
}

// ─── Import IA des taux (from email text) ───────────────────
async function importRatesFromText() {
  const text = document.getElementById('import-text')?.value;
  const bankId = document.getElementById('import-bank')?.value;
  const date = document.getElementById('import-date')?.value;
  if (!text || text.trim().length < 20) { showToast('Collez le texte', 'error'); return; }

  const bank = BANKS.find(b => b.id === bankId);
  const progress = document.getElementById('import-progress');
  const status = document.getElementById('import-status');
  const results = document.getElementById('import-results');
  if (progress) progress.classList.remove('hidden');
  if (status) status.textContent = 'Claude analyse...';

  const prompt = `Extrais TOUTES les offres de taux de ce texte.

TEXTE:
---
${text.substring(0, 5000)}
---

JSON valide uniquement:
{"products":[{"name":"CAT Fixe 12m","type":"cat","rateType":"fixe","durationMonths":12,"averageRate":2.40,"rateSchedule":[{"period":"Mois 1-12","rate":2.40}],"withdrawalConditions":"max 80 car","notice":"32 jours"}]}

RÈGLES:
- Chaque durée/taux = un produit séparé
- Pour les progressifs: rateSchedule par période
- averageRate = taux actuariel moyen annuel brut
- withdrawalConditions: max 80 caractères`;

  try {
    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('Erreur IA: ' + res.status);
    const data = await res.json();
    const responseText = data.content?.map(b => b.text || '').join('') || '';
    const parsed = repairJSON(responseText);

    if (progress) progress.classList.add('hidden');
    if (!parsed.products || parsed.products.length === 0) { if (results) results.innerHTML = '<div style="color:var(--orange);padding:10px;font-size:12px">⚠️ Aucun taux trouvé.</div>'; return; }

    let html = `<div style="margin-top:12px"><h3 style="font-size:12px;color:var(--green);margin-bottom:8px">✅ ${parsed.products.length} produit(s)</h3>`;
    parsed.products.forEach(p => {
      const rateDisplay = p.rateType === 'progressif' && p.rateSchedule
        ? p.rateSchedule.map(s => (s.period || '?') + ': ' + s.rate + '%').join(' → ')
        : p.averageRate + '%';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px">
        <div style="flex:1"><strong style="color:var(--text-bright)">${p.name || 'CAT ' + p.durationMonths + 'm'}</strong>
          <div style="color:var(--text-muted);font-size:10px">${p.rateType === 'progressif' ? '📈 ' : '📊 '}${rateDisplay}</div>
          ${p.withdrawalConditions ? '<div style="color:var(--orange);font-size:9px">⚠️ ' + p.withdrawalConditions + '</div>' : ''}</div>
        <div><span style="font-family:var(--mono);color:var(--green);font-size:14px;font-weight:600">${p.averageRate}%</span><span style="color:var(--text-dim);font-size:10px;margin-left:4px">${p.durationMonths}m</span></div></div>`;
    });
    html += `<button class="btn success lg" style="width:100%;margin-top:12px" onclick="confirmImportRates()">✅ Importer</button></div>`;
    if (results) results.innerHTML = html;
    window._pendingRatesImport = { parsed, bankId, bankName: bank?.name || bankId, date };
  } catch (e) {
    if (progress) progress.classList.add('hidden');
    if (results) results.innerHTML = `<div style="color:var(--red);padding:10px;font-size:12px">❌ ${e.message}</div>`;
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

    const productKey = (p.name || '').toLowerCase().replace(/\s+/g, '-').substring(0, 30);
    catManager.rates.rates = catManager.rates.rates.filter(r =>
      !(r.bankId === bankId && r.durationMonths === duration && r.productType === (p.type || 'cat') && (r.productName || '').toLowerCase().replace(/\s+/g, '-').substring(0, 30) === productKey)
    );

    catManager.rates.rates.push({
      bankId, bankName, durationMonths: duration,
      rate, productType: p.type || 'cat',
      date: date || new Date().toISOString().split('T')[0],
      rateType: p.rateType || 'fixe',
      rateSchedule: p.rateSchedule || null,
      withdrawalConditions: p.withdrawalConditions || null,
      notice: p.notice || null,
      productName: p.name || null,
    });
    imported++;
  }
  catManager.rates.lastUpdated = new Date().toISOString();
  await catManager.saveRates();

  try {
    const ratesList = document.getElementById('rates-list');
    if (ratesList) ratesList.innerHTML = renderRatesList();
    const ratesHeader = document.getElementById('rates-header');
    if (ratesHeader) ratesHeader.textContent = `Taux enregistrés (${catManager.rates.rates.length})`;
  } catch(e) {}

  // Clear all result areas
  ['import-results', 'pdf-rate-results'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div style="color:var(--green);padding:10px;font-size:12px">✅ ${imported} taux importés pour ${bankName}</div>`;
  });
  showToast(`${imported} taux importés pour ${bankName}`, 'success');
  window._pendingRatesImport = null;
}

// ─── Override renderRatesList — robust ──────────────────────
const _originalRenderRatesList = renderRatesList;
renderRatesList = function() {
  try {
    const rates = catManager.rates.rates;
    if (!rates || rates.length === 0) return '<div style="color:var(--text-dim);font-size:12px">Aucun taux</div>';
    return [...rates].sort((a, b) => (a.bankId || '').localeCompare(b.bankId || '') || a.durationMonths - b.durationMonths).map(r => {
      const name = r.productName || (r.bankName + ' ' + r.durationMonths + 'm');
      const isScanned = r.source === 'web scan';
      let scheduleDetail = '';
      if (r.rateSchedule && Array.isArray(r.rateSchedule) && r.rateSchedule.length > 0) {
        try { scheduleDetail = '<div style="font-size:10px;color:var(--text-dim);padding-left:16px">' + r.rateSchedule.map(s => (s.period || s.label || '?') + ': ' + s.rate + '%').join(' → ') + '</div>'; } catch(e) {}
      }
      return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>🏦 <strong>${name}</strong>${r.rateType === 'progressif' ? ' <span style="color:var(--purple);font-size:10px">📈</span>' : ''}${isScanned ? ' <span style="font-size:8px;color:var(--purple);background:rgba(139,92,246,0.15);padding:1px 5px;border-radius:8px">web</span>' : ''}</span>
          <span style="color:var(--green);font-family:var(--mono);font-weight:600">${r.rate}%</span>
        </div>${scheduleDetail}${r.withdrawalConditions ? '<div style="font-size:10px;color:var(--orange);padding-left:16px">⚠️ ' + r.withdrawalConditions + '</div>' : ''}</div>`;
    }).join('');
  } catch(e) { return '<div style="color:var(--red);font-size:12px">Erreur affichage</div>'; }
};

// ═══ ANALYSE IA + CHAT (unchanged) ══════════════════════════

function buildCATPortfolioContext() {
  const stats = catManager.getStats();
  const active = catManager.deposits.filter(d => d.status === 'active');
  const depositsDetail = active.map(d => `- ${d.productType === 'parts-sociales' ? 'PS' : 'CAT'} | ${d.bankName} | "${d.productName || '?'}" | ${d.amount}€ | ${d.rate}% ${d.rateType || 'fixe'} | ${d.durationMonths || '?'}m | Éch: ${d.maturityDate || 'N/A'}`).join('\n');
  const ratesDetail = catManager.rates.rates.length > 0
    ? catManager.rates.rates.map(r => `- ${r.bankName} | ${r.durationMonths}m | ${r.rate}% ${r.rateType || 'fixe'}${r.productName ? ' (' + r.productName + ')' : ''}`).join('\n')
    : 'Aucun';
  const bankConc = Object.entries(stats.byBank).map(([, v]) => `- ${v.name}: ${v.total}€ (${v.count})`).join('\n');
  return `PORTEFEUILLE: ${stats.totalInvested}€ | ${stats.totalDeposits} plac. | Taux: ${stats.weightedRate.toFixed(2)}% | Intérêts: ${stats.totalInterest}€\nObjectifs: réserve ${catManager.objectives.liquidityReserve}€ | FGDR ${catManager.objectives.maxPerBank}€\n\nPLACEMENTS:\n${depositsDetail || 'Aucun'}\n\nBANQUES:\n${bankConc || 'N/A'}\n\nTAUX MARCHÉ:\n${ratesDetail}`;
}

async function runCATAIAnalysis() {
  const ctx = buildCATPortfolioContext();
  const res = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: `Conseiller patrimoine. Analyse ce portefeuille CAT/PS.\n\n${ctx}\n\n1. DIAGNOSTIC 2. CONCENTRATIONS FGDR 3. RENDEMENT vs marché 4. ARBITRAGES 5. OPTIMISATION 6. RISQUES\nDirect, quantitatif.` }] }) });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || '';
}

async function sendCATChatMessage(userMessage) {
  const ctx = buildCATPortfolioContext();
  catAIConversation.push({ role: 'user', content: userMessage, timestamp: Date.now() });
  const messages = catAIConversation.map(m => ({ role: m.role, content: m.content }));
  const res = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: `Conseiller patrimoine.\n\n${ctx}\n\n${catAIAnalysis ? 'ANALYSE:\n' + catAIAnalysis : ''}\n\nDirect, quantitatif.`, messages }) });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  const response = data.content?.map(b => b.text || '').join('\n') || '';
  catAIConversation.push({ role: 'assistant', content: response, timestamp: Date.now() });
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: catAIAnalysis, conversation: catAIConversation }, '[StructBoard] CAT AI chat');
  return response;
}

async function loadCATAIConversation() { try { const data = await github.readFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`); if (data) { catAIConversation = data.conversation || []; catAIAnalysis = data.analysis || null; } } catch(e) {} }

async function resetCATChat() {
  if (catAIConversation.length > 0 && !confirm('Effacer?')) return;
  catAIConversation = []; catAIAnalysis = null;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: null, conversation: [] }, '[StructBoard] Reset');
  showToast('Réinitialisée', 'success'); showCATAnalysis();
}

function showCATAnalysis() {
  const container = document.getElementById('main-content');
  container.innerHTML = `
    <div class="sheet-nav"><button class="btn ghost" onclick="switchMainView('cat')">← Retour</button><div class="sheet-nav-title">Analyse IA</div><div class="sheet-nav-actions"><button class="btn" onclick="resetCATChat()">Nouvelle</button></div></div>
    <div class="sheet-layout"><div class="sheet-main">
        <div class="sheet-card"><h3 class="sheet-card-title"><span class="card-icon">🧠</span> Analyse</h3>
          <div id="cat-ai-analysis-content">${catAIAnalysis ? `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>` : `<div style="text-align:center;padding:30px"><p style="color:var(--text-muted);margin-bottom:16px">Claude analyse votre portefeuille.</p><button class="btn ai-glow lg" onclick="launchCATAnalysis()">🚀 Lancer</button></div>`}</div></div>
        <div class="sheet-card" style="min-height:400px;display:flex;flex-direction:column"><h3 class="sheet-card-title"><span class="card-icon">💬</span> Discussion</h3>
          <div id="cat-chat-messages" style="flex:1;overflow-y:auto;max-height:400px;margin-bottom:12px"><div class="chat-msg system"><div class="chat-msg-content">💡 Posez vos questions.</div></div>${catAIConversation.map(m => `<div class="chat-msg ${m.role}"><div class="chat-msg-avatar">${m.role==='user'?'👤':'🤖'}</div><div class="chat-msg-content">${m.role==='assistant'?formatAIText(m.content):escapeHTML(m.content)}</div></div>`).join('')}</div>
          <div class="chat-input-area"><textarea id="cat-chat-input" class="chat-input" placeholder="Ex: Ce CAT vaut-il le coup?" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCATChat()}"></textarea><button class="btn primary" onclick="sendCATChat()" id="cat-chat-send">Envoyer</button></div></div>
      </div><div class="sheet-sidebar">
        <div class="sheet-card"><h3 class="sheet-card-title">Portefeuille</h3>${renderCATSidebarStats()}</div>
        <div class="sheet-card"><h3 class="sheet-card-title">Questions rapides</h3><div class="action-buttons">
            <button class="btn ai-glow" style="width:100%" onclick="launchCATAnalysis()">🚀 Re-analyser</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels placements sous-performent?')">Sous-performances?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels arbitrages?')">Arbitrages?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Risques?')">Risques?</button>
          </div></div></div></div>`;
  const c = document.getElementById('cat-chat-messages'); if (c) c.scrollTop = c.scrollHeight;
}

function renderCATSidebarStats() {
  const s = catManager.getStats();
  return `<div style="font-size:12px;line-height:1.8">
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Total</span><span style="font-family:var(--mono);color:var(--text-bright)">${formatNumber(s.totalInvested)}€</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Taux</span><span style="font-family:var(--mono);color:var(--green)">${formatPct(s.weightedRate)}</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Intérêts</span><span style="font-family:var(--mono);color:var(--green)">+${formatNumber(s.totalInterest)}€</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Banques</span><span>${Object.keys(s.byBank).length}</span></div>
    ${s.fgdrAlerts.length > 0 ? `<div style="color:var(--red);margin-top:8px">⚠️ ${s.fgdrAlerts.length} alerte(s) FGDR</div>` : ''}</div>`;
}

async function launchCATAnalysis() {
  const c = document.getElementById('cat-ai-analysis-content');
  c.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse...</div>';
  try { catAIAnalysis = await runCATAIAnalysis(); c.innerHTML = `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>`; await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: catAIAnalysis, conversation: catAIConversation }, '[StructBoard] CAT AI'); showToast('OK', 'success'); }
  catch (e) { c.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`; }
}

async function sendCATChat() {
  const input = document.getElementById('cat-chat-input'); const btn = document.getElementById('cat-chat-send');
  if (!input || !input.value.trim()) return;
  const msg = input.value.trim(); input.value = ''; btn.disabled = true; btn.textContent = '...';
  const el = document.getElementById('cat-chat-messages');
  el.innerHTML += `<div class="chat-msg user"><div class="chat-msg-avatar">👤</div><div class="chat-msg-content">${escapeHTML(msg)}</div></div>`;
  el.innerHTML += `<div class="chat-msg assistant" id="cat-typing"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content"><div class="spinner" style="display:inline-block"></div></div></div>`;
  el.scrollTop = el.scrollHeight;
  try { const r = await sendCATChatMessage(msg); const t = document.getElementById('cat-typing'); if (t) t.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content">${formatAIText(r)}</div></div>`; el.scrollTop = el.scrollHeight; }
  catch (e) { const t = document.getElementById('cat-typing'); if (t) t.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content" style="color:var(--red)">${e.message}</div></div>`; }
  btn.disabled = false; btn.textContent = 'Envoyer';
}
function askCATQuestion(q) { const i = document.getElementById('cat-chat-input'); if (i) { i.value = q; sendCATChat(); } }

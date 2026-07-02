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

    <div id="rates-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 id="rates-header" style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:0">Taux enregistrés (${catManager.rates.rates.length})</h3>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="rates-bulk-bank" style="font-size:10px;padding:4px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text)">
            <option value="">Par banque...</option>
            ${[...new Set(catManager.rates.rates.map(r=>r.bankId))].map(bid=>{const b=BANKS.find(x=>x.id===bid);return '<option value="'+bid+'">'+(b?b.name:bid)+' ('+catManager.rates.rates.filter(r=>r.bankId===bid).length+')</option>';}).join('')}
          </select>
          <button class="btn sm" onclick="deleteRatesByBank()" style="font-size:10px;padding:4px 10px;color:var(--orange);border-color:rgba(251,191,36,0.3)">Suppr. banque</button>
          <button class="btn sm" onclick="deleteAllRates()" style="font-size:10px;padding:4px 10px;color:var(--red);border-color:rgba(248,113,113,0.3)">Tout vider</button>
        </div>
      </div>
      <div id="rates-list">${renderRatesList()}</div>
    </div>
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
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
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

// ─── Auto-detect bank from email text ───────────────────────
function _detectBankFromText(text) {
  const lower = text.toLowerCase();
  for (const b of BANKS) {
    const names = [b.name.toLowerCase()];
    if (b.id === 'cic') names.push('cic', 'crédit industriel');
    if (b.id === 'sg') names.push('société générale', 'socgen');
    if (b.id === 'bnp') names.push('bnp paribas', 'bnp');
    if (b.id === 'banque-populaire') names.push('banque populaire', 'optiplus', 'catvair');
    if (b.id === 'lcl') names.push('lcl', 'crédit lyonnais');
    if (b.id === 'credit-mutuel') names.push('crédit mutuel', 'credit mutuel');
    if (b.id === 'ca') names.push('crédit agricole', 'credit agricole');
    if (b.id === 'hsbc') names.push('hsbc');
    if (b.id === 'bred') names.push('bred');
    if (b.id === 'bpce') names.push('bpce');
    if (names.some(n => lower.includes(n))) return b.id;
  }
  return null;
}

// ─── Auto-detect validity date from email text ──────────────
function _detectDateFromText(text) {
  const months = { janvier:'01',février:'02',mars:'03',avril:'04',mai:'05',juin:'06',
    juillet:'07',août:'08',septembre:'09',octobre:'10',novembre:'11',décembre:'12',
    janv:'01',fév:'02',fev:'02',avr:'04',juil:'07',sept:'09',oct:'10',nov:'11',déc:'12',dec:'12' };
  // "mois de Mars 2026", "valable en mars 2026", "conditions mars 2026"
  const moisMatch = text.match(/(?:mois\s+d[e'u]\s*|valable[s]?\s+(?:pour\s+|en\s+)?|conditions?\s+(?:de\s+|du\s+)?|à\s+compter\s+du?\s+)(\w+)\s+(\d{4})/i);
  if (moisMatch) {
    const m = months[moisMatch[1].toLowerCase()];
    if (m) {
      // Use last day of month (rates valid for the whole month)
      const y = parseInt(moisMatch[2]), mi = parseInt(m);
      const lastDay = new Date(y, mi, 0).getDate();
      return `${moisMatch[2]}-${m}-${String(lastDay).padStart(2,'0')}`;
    }
  }
  // "01/03/2026" or "01.03.2026"
  const dateMatch = text.match(/(\d{2})[/.](\d{2})[/.](\d{4})/);
  if (dateMatch) return `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  return null;
}

// ─── Validate parsed rates (sanity checks) ──────────────────
function _validateParsedRates(products) {
  const warnings = [];
  const valid = products.filter(p => {
    const rate = parseFloat(p.averageRate) || 0;
    const dur = parseInt(p.durationMonths) || 0;
    if (dur <= 0) { warnings.push(`"${p.name}": durée invalide`); return false; }
    if (rate <= 0) { warnings.push(`"${p.name}": taux invalide`); return false; }
    if (rate > 10) { warnings.push(`"${p.name}": taux ${rate}% suspect (>10%)`); return false; }
    if (p.rateSchedule && p.rateSchedule.length > 0) {
      for (const s of p.rateSchedule) {
        if (parseFloat(s.rate) > 10) { warnings.push(`"${p.name}": palier ${s.rate}% suspect`); return false; }
      }
    }
    return true;
  });
  return { valid, warnings };
}

// ─── Import IA des taux (from email text) ───────────────────
async function importRatesFromText() {
  const text = document.getElementById('import-text')?.value;
  let bankId = document.getElementById('import-bank')?.value;
  let date = document.getElementById('import-date')?.value;
  if (!text || text.trim().length < 20) { showToast('Collez le texte', 'error'); return; }

  // Auto-detect bank if user left default
  const detectedBank = _detectBankFromText(text);
  if (detectedBank && detectedBank !== bankId) {
    bankId = detectedBank;
    const sel = document.getElementById('import-bank');
    if (sel) sel.value = detectedBank;
  }

  // Auto-detect date from email text
  const detectedDate = _detectDateFromText(text);
  if (detectedDate) {
    date = detectedDate;
    const dateInput = document.getElementById('import-date');
    if (dateInput) dateInput.value = detectedDate;
  }

  const bank = BANKS.find(b => b.id === bankId);
  const progress = document.getElementById('import-progress');
  const status = document.getElementById('import-status');
  const results = document.getElementById('import-results');
  if (progress) progress.classList.remove('hidden');
  if (status) status.textContent = `Claude analyse${detectedBank ? ' (banque détectée: ' + (bank?.name || bankId) + ')' : ''}...`;

  const prompt = `Tu es un analyste financier expert en comptes à terme. Extrais TOUS les produits CAT de cet email bancaire.

EMAIL:
---
${text.substring(0, 8000)}
---

RÉPONDS UNIQUEMENT en JSON valide (pas de backticks, pas de texte autour):
{
  "detectedBank": "Nom de la banque si détectable dans le texte, sinon null",
  "validityDate": "YYYY-MM-DD si mentionnée (ex: 'mars 2026' → '2026-03-01'), sinon null",
  "products": [
    {
      "name": "CAT Fixe 12m",
      "type": "cat",
      "rateType": "fixe",
      "durationMonths": 12,
      "averageRate": 2.40,
      "rateSchedule": [],
      "earlyExitSchedule": [
        {"period": "Mois 1", "penalty": "Aucune rémunération"},
        {"period": "Mois 2-12", "penalty": "50% de la rémunération"}
      ],
      "withdrawalConditions": "Pas de rémun. 1er mois, 50% ensuite",
      "notice": "32 jours",
      "calculationBase": "exact/365",
      "minAmount": null,
      "maxAmount": null,
      "category": null
    }
  ]
}

RÈGLES CRITIQUES:
1. Chaque durée/taux = un produit SÉPARÉ (un CAT fixe 2m et un CAT fixe 12m = 2 produits)
2. Pour les PROGRESSIFS:
   - rateType = "progressif"
   - averageRate = TRAAB ou taux actuariel moyen annuel brut (souvent indiqué dans le titre)
   - rateSchedule = tableau de paliers avec OBLIGATOIREMENT fromMonth/toMonth:
     [{"fromMonth":1,"toMonth":6,"rate":2.30,"label":"Semestre 1"},{"fromMonth":7,"toMonth":12,"rate":2.50,"label":"Semestre 2"}]
   - "semestre 1" = fromMonth 1, toMonth 6
   - "semestre 2" = fromMonth 7, toMonth 12
   - "année 1" = fromMonth 1, toMonth 12
   - "année 2" = fromMonth 13, toMonth 24
3. Pour les FIXES: rateType = "fixe", rateSchedule = []
4. withdrawalConditions: résumé max 80 car des pénalités de sortie anticipée
5. earlyExitSchedule: détail structuré des pénalités par période
6. Si "retrait période 1 = 50% du taux" → earlyRate dans rateSchedule:
   [{"fromMonth":1,"toMonth":6,"rate":2.30,"earlyRate":1.15,"label":"Semestre 1"}]
7. notice: "32 jours" si préavis mentionné
8. calculationBase: "exact/365" ou "30/360" si mentionné
9. minAmount/maxAmount: montants min/max si mentionnés (ex: "minimum 1500€")
10. category: tag si produit spécial (ex: "transition", "ESG", "vert")
11. NE PAS inventer de taux — n'extraire que ce qui est explicitement écrit
12. Si un même produit est décrit 2 fois (ex: taux fixe puis détail progressif pour même durée), prendre la version la plus détaillée`;

  try {
    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('Erreur IA: ' + res.status);
    const data = await res.json();
    const responseText = data.content?.map(b => b.text || '').join('') || '';
    const parsed = repairJSON(responseText);

    if (progress) progress.classList.add('hidden');
    if (!parsed.products || parsed.products.length === 0) { if (results) results.innerHTML = '<div style="color:var(--orange);padding:10px;font-size:12px">⚠️ Aucun taux trouvé.</div>'; return; }

    // Use AI-detected bank if local detection missed it
    if (parsed.detectedBank && !detectedBank) {
      const aiBank = BANKS.find(b => b.name.toLowerCase().includes(parsed.detectedBank.toLowerCase().substring(0, 4)));
      if (aiBank) { bankId = aiBank.id; const sel = document.getElementById('import-bank'); if (sel) sel.value = aiBank.id; }
    }
    // Use AI-detected date if local detection missed it
    if (parsed.validityDate && !detectedDate) {
      date = parsed.validityDate;
      const dateInput = document.getElementById('import-date');
      if (dateInput) dateInput.value = parsed.validityDate;
    }

    // Validate rates
    const { valid: validProducts, warnings } = _validateParsedRates(parsed.products);
    parsed.products = validProducts;

    const bankObj = BANKS.find(b => b.id === bankId);
    let html = `<div style="margin-top:12px">`;

    // Header bar with detected info
    html += `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(135deg,rgba(6,214,160,0.06),rgba(59,130,246,0.06));border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);margin-bottom:12px">`;
    html += `<div style="font-size:18px">✅</div>`;
    html += `<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--text-bright)">${parsed.products.length} produits extraits</div>`;
    const meta = [];
    if (detectedBank || parsed.detectedBank) meta.push(`🏦 ${bankObj?.name || bankId}`);
    if (detectedDate || parsed.validityDate) meta.push(`📅 ${date}`);
    meta.push('🔒 source confirmée');
    html += `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${meta.join(' · ')}</div>`;
    html += `</div></div>`;

    if (warnings.length > 0) {
      html += `<div style="font-size:10px;color:var(--orange);padding:6px 10px;background:rgba(251,191,36,0.05);border-radius:var(--radius-sm);margin-bottom:8px">⚠️ Exclus: ${warnings.join(', ')}</div>`;
    }

    // Group products by type for clear visual hierarchy
    const fixe = parsed.products.filter(p => p.rateType !== 'progressif');
    const progressif = parsed.products.filter(p => p.rateType === 'progressif' && !p.category);
    const special = parsed.products.filter(p => p.category);
    const groups = [];
    if (fixe.length > 0) groups.push({ label: 'Taux Fixe', icon: '📊', color: 'var(--green)', items: fixe });
    if (progressif.length > 0) groups.push({ label: 'Taux Progressif', icon: '📈', color: 'var(--purple)', items: progressif });
    if (special.length > 0) groups.push({ label: special[0].category ? special[0].category.charAt(0).toUpperCase() + special[0].category.slice(1) : 'Spécial', icon: '🌱', color: 'var(--cyan)', items: special });

    groups.forEach(g => {
      // Find best rate in this group
      const bestRate = Math.max(...g.items.map(p => parseFloat(p.averageRate) || 0));
      html += `<div style="margin-bottom:10px">`;
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="font-size:12px">${g.icon}</span><span style="font-size:11px;font-weight:700;color:${g.color};text-transform:uppercase;letter-spacing:0.5px">${g.label}</span><span style="font-size:10px;color:var(--text-dim)">${g.items.length} produit${g.items.length>1?'s':''}</span></div>`;

      g.items.forEach(p => {
        const isBest = parseFloat(p.averageRate) === bestRate && g.items.length > 1;
        const rateDisplay = p.rateType === 'progressif' && p.rateSchedule && p.rateSchedule.length > 0
          ? p.rateSchedule.map(s => (s.label || s.period || 'M' + s.fromMonth + '-' + s.toMonth) + ': ' + s.rate + '%').join(' → ')
          : '';
        const baseLabel = p.calculationBase ? `<span style="color:var(--text-dim);margin-left:6px">${p.calculationBase}</span>` : '';
        const amountLabel = p.minAmount ? `<span style="color:var(--text-dim);margin-left:6px">min ${p.minAmount}€</span>` : '';

        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:3px;font-size:12px;border-left:3px solid ${isBest ? g.color : 'transparent'}">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px">
              <strong style="color:var(--text-bright)">${p.name || 'CAT ' + p.durationMonths + 'm'}</strong>
              ${isBest ? '<span style="font-size:8px;color:var(--green);background:rgba(52,211,153,0.12);padding:1px 6px;border-radius:6px;font-weight:600">BEST</span>' : ''}
              ${p.category ? '<span style="font-size:8px;color:var(--cyan);background:rgba(34,211,238,0.1);padding:1px 6px;border-radius:6px">' + p.category + '</span>' : ''}
              ${amountLabel}${baseLabel}
            </div>
            ${rateDisplay ? '<div style="color:var(--text-muted);font-size:10px;margin-top:2px">' + rateDisplay + '</div>' : ''}
            ${p.withdrawalConditions ? '<div style="color:var(--orange);font-size:9px;margin-top:2px">⚠️ ' + p.withdrawalConditions + '</div>' : ''}
          </div>
          <div style="text-align:right;min-width:70px">
            <div style="font-family:var(--mono);color:var(--green);font-size:15px;font-weight:700">${p.averageRate}%</div>
            <div style="color:var(--text-dim);font-size:10px">${p.durationMonths}m · ${p.rateType}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    });

    html += `<button class="btn success lg" style="width:100%;margin-top:8px;padding:12px;font-size:13px;font-weight:700" onclick="confirmImportRates()">✅ Importer ${parsed.products.length} taux dans la base</button></div>`;
    if (results) results.innerHTML = html;
    window._pendingRatesImport = { parsed, bankId, bankName: bankObj?.name || bankId, date };
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

    // Dedup: remove existing rate for same bank + duration + product name
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
      earlyExitSchedule: p.earlyExitSchedule || null,
      withdrawalConditions: p.withdrawalConditions || null,
      notice: p.notice || null,
      productName: p.name || null,
      calculationBase: p.calculationBase || null,
      minAmount: p.minAmount ? parseFloat(p.minAmount) : null,
      maxAmount: p.maxAmount ? parseFloat(p.maxAmount) : null,
      category: p.category || null,
      source: 'confirmed',
      confidence: 'high',
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

// ─── Bulk delete rates ──────────────────────────────────────

function showDeleteRatesModal() {
  const rates = catManager.rates.rates;
  if (!rates.length) { showToast('Aucun taux', 'error'); return; }

  // Group by bank
  const byBank = {};
  rates.forEach(r => {
    const key = r.bankId || 'autre';
    if (!byBank[key]) byBank[key] = { name: r.bankName || key, count: 0, confirmed: 0, web: 0 };
    byBank[key].count++;
    if (r.source === 'web scan') byBank[key].web++; else byBank[key].confirmed++;
  });

  const modal = document.getElementById('modal');
  let bankRows = Object.entries(byBank).map(([bankId, g]) => {
    const bankColor = BANKS.find(b => b.id === bankId)?.color || 'var(--accent)';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:8px;height:8px;border-radius:50%;background:${bankColor}"></span>
        <div>
          <strong style="color:var(--text-bright);font-size:12px">${g.name}</strong>
          <div style="font-size:10px;color:var(--text-dim)">${g.confirmed} confirmé${g.confirmed>1?'s':''} · ${g.web} web</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-family:var(--mono);font-size:13px;color:var(--text-bright);min-width:30px;text-align:right">${g.count}</span>
        <button class="btn sm" onclick="deleteRatesByBankId('${bankId}','${g.name.replace(/'/g,"\\'")}',${g.count})" style="color:var(--red);border-color:rgba(248,113,113,0.25);font-size:10px;padding:4px 10px">Supprimer</button>
      </div>
    </div>`;
  }).join('');

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:480px">
    <h2 class="modal-title">🗑 Supprimer des taux</h2>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${rates.length} taux au total. Supprimez par banque ou tout d'un coup.</p>

    <div id="delete-rates-list">${bankRows}</div>

    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn" style="width:100%;color:var(--red);border-color:rgba(248,113,113,0.3);font-weight:600" onclick="deleteAllRatesConfirm(${rates.length})">🗑 Tout supprimer (${rates.length} taux)</button>
    </div>

    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function deleteRatesByBankId(bankId, bankName, count) {
  if (!confirm('Supprimer les ' + count + ' taux de ' + bankName + ' ?')) return;
  catManager.rates.rates = catManager.rates.rates.filter(r => r.bankId !== bankId);
  catManager.rates.lastUpdated = new Date().toISOString();
  await catManager.saveRates();
  showToast(count + ' taux supprimés (' + bankName + ')', 'success');
  // Always close modal and refresh full dashboard so rates section updates
  closeModal();
  renderCAT(document.getElementById('main-content'));
}

async function deleteAllRatesConfirm(count) {
  if (!confirm('Supprimer TOUS les ' + count + ' taux ? Irréversible.')) return;
  catManager.rates.rates = [];
  catManager.rates.lastUpdated = new Date().toISOString();
  await catManager.saveRates();
  showToast(count + ' taux supprimés', 'success');
  closeModal();
  renderCAT(document.getElementById('main-content'));
}

function _refreshRatesUI() {
  try {
    const ratesList = document.getElementById('rates-list');
    if (ratesList) ratesList.innerHTML = renderRatesList();
    const ratesHeader = document.getElementById('rates-header');
    if (ratesHeader) ratesHeader.textContent = `Taux enregistrés (${catManager.rates.rates.length})`;
    // Refresh bank select options
    const sel = document.getElementById('rates-bulk-bank');
    if (sel) {
      const bankIds = [...new Set(catManager.rates.rates.map(r => r.bankId))];
      sel.innerHTML = '<option value="">Par banque...</option>' + bankIds.map(bid => {
        const b = BANKS.find(x => x.id === bid);
        return '<option value="' + bid + '">' + (b ? b.name : bid) + ' (' + catManager.rates.rates.filter(r => r.bankId === bid).length + ')</option>';
      }).join('');
    }
  } catch(e) {}
}

async function deleteRatesByBank() {
  const sel = document.getElementById('rates-bulk-bank');
  const bankId = sel?.value;
  if (!bankId) { showToast('Sélectionnez une banque', 'error'); return; }
  const bankName = BANKS.find(b => b.id === bankId)?.name || bankId;
  const count = catManager.rates.rates.filter(r => r.bankId === bankId).length;
  if (!confirm(`Supprimer les ${count} taux de ${bankName} ?`)) return;
  catManager.rates.rates = catManager.rates.rates.filter(r => r.bankId !== bankId);
  catManager.rates.lastUpdated = new Date().toISOString();
  await catManager.saveRates();
  _refreshRatesUI();
  showToast(`${count} taux supprimés (${bankName})`, 'success');
}

async function deleteAllRates() {
  const count = catManager.rates.rates.length;
  if (!count) { showToast('Aucun taux à supprimer', 'error'); return; }
  if (!confirm(`Supprimer TOUS les ${count} taux ? Cette action est irréversible.`)) return;
  catManager.rates.rates = [];
  catManager.rates.lastUpdated = new Date().toISOString();
  await catManager.saveRates();
  _refreshRatesUI();
  showToast(`${count} taux supprimés`, 'success');
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
      const isConfirmed = r.source === 'confirmed';
      let scheduleDetail = '';
      if (r.rateSchedule && Array.isArray(r.rateSchedule) && r.rateSchedule.length > 0) {
        try { scheduleDetail = '<div style="font-size:10px;color:var(--text-dim);padding-left:16px">' + r.rateSchedule.map(s => (s.period || s.label || '?') + ': ' + s.rate + '%').join(' → ') + '</div>'; } catch(e) {}
      }
      const sourceBadge = isScanned
        ? ' <span style="font-size:8px;color:var(--purple);background:rgba(139,92,246,0.15);padding:1px 5px;border-radius:8px">web</span>'
        : isConfirmed
        ? ' <span style="font-size:8px;color:var(--green);background:rgba(6,214,160,0.15);padding:1px 5px;border-radius:8px">email</span>'
        : '';
      const categoryBadge = r.category ? ' <span style="font-size:8px;color:var(--cyan);background:rgba(59,130,246,0.12);padding:1px 5px;border-radius:8px">' + r.category + '</span>' : '';
      const baseInfo = r.calculationBase ? '<span style="font-size:9px;color:var(--text-dim);margin-left:8px">' + r.calculationBase + '</span>' : '';
      return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>🏦 <strong>${name}</strong>${r.rateType === 'progressif' ? ' <span style="color:var(--purple);font-size:10px">📈</span>' : ''}${sourceBadge}${categoryBadge}${baseInfo}</span>
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
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 2500, messages: [{ role: 'user', content: `Conseiller patrimoine. Analyse ce portefeuille CAT/PS.\n\n${ctx}\n\n1. DIAGNOSTIC 2. CONCENTRATIONS FGDR 3. RENDEMENT vs marché 4. ARBITRAGES 5. OPTIMISATION 6. RISQUES\nDirect, quantitatif.` }] }) });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || '';
}

async function sendCATChatMessage(userMessage) {
  const ctx = buildCATPortfolioContext();
  catAIConversation.push({ role: 'user', content: userMessage, timestamp: Date.now() });
  const messages = catAIConversation.map(m => ({ role: m.role, content: m.content }));
  const res = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1500, system: `Conseiller patrimoine.\n\n${ctx}\n\n${catAIAnalysis ? 'ANALYSE:\n' + catAIAnalysis : ''}\n\nDirect, quantitatif.`, messages }) });
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

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Module Épargne (CAT + Parts Sociales)
// V2: Enhanced PDF extraction with rate schedule
// ═══════════════════════════════════════════════════════════════

const PLACEMENT_TYPES = [
  { id: 'cat', name: 'Compte à Terme', icon: '🏦', color: 'var(--green)' },
  { id: 'parts-sociales', name: 'Parts Sociales', icon: '🤝', color: 'var(--purple)' },
];

const EXIT_CONDITIONS = [
  { id: 'maturity', name: 'À maturité' },
  { id: 'monthly', name: 'Sortie mensuelle' },
  { id: 'quarterly', name: 'Sortie trimestrielle' },
  { id: 'annual', name: 'Sortie annuelle' },
  { id: 'anytime', name: 'Libre à tout moment' },
  { id: 'notice', name: 'Avec préavis' },
];

const INTEREST_PAYMENTS = [
  { id: 'maturity', name: 'À maturité' },
  { id: 'monthly', name: 'Mensuel' },
  { id: 'quarterly', name: 'Trimestriel' },
  { id: 'annual', name: 'Annuel' },
];

class CATManager {
  constructor() {
    this.deposits = [];
    this.rates = { lastUpdated: null, rates: [] };
    this.objectives = { monthlyNeed: 0, liquidityReserve: 0, maxPerBank: 100000, horizon: 'mixed', notes: '' };
  }

  async load() {
    const [deposits, rates, objectives] = await Promise.all([
      github.readFile(`${CONFIG.DATA_PATH}/cat/deposits.json`),
      github.readFile(`${CONFIG.DATA_PATH}/cat/rates.json`),
      github.readFile(`${CONFIG.DATA_PATH}/cat/objectives.json`),
    ]);
    this.deposits = deposits || [];
    if (rates) this.rates = rates;
    if (objectives) this.objectives = objectives;
  }

  async saveDeposits() { await github.writeFile(`${CONFIG.DATA_PATH}/cat/deposits.json`, this.deposits, '[StructBoard] Update placements'); }
  async saveRates() { await github.writeFile(`${CONFIG.DATA_PATH}/cat/rates.json`, this.rates, '[StructBoard] Update taux'); }
  async saveObjectives() { await github.writeFile(`${CONFIG.DATA_PATH}/cat/objectives.json`, this.objectives, '[StructBoard] Update objectifs'); }

  addDeposit(deposit) {
    deposit.id = deposit.id || 'pl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
    deposit.createdDate = new Date().toISOString().split('T')[0];
    if (!deposit.maturityDate && deposit.startDate && deposit.durationMonths && deposit.durationMonths > 0) {
      const start = new Date(deposit.startDate);
      start.setMonth(start.getMonth() + parseInt(deposit.durationMonths));
      deposit.maturityDate = start.toISOString().split('T')[0];
    }
    deposit.estimatedInterest = this._calcInterest(deposit);
    this.deposits.push(deposit);
    return deposit;
  }

  updateDeposit(id, updates) {
    const idx = this.deposits.findIndex(d => d.id === id);
    if (idx === -1) return null;
    Object.assign(this.deposits[idx], updates);
    this.deposits[idx].estimatedInterest = this._calcInterest(this.deposits[idx]);
    return this.deposits[idx];
  }

  removeDeposit(id) { this.deposits = this.deposits.filter(d => d.id !== id); }

  _calcInterest(deposit) {
    // Use rate schedule if available for more accurate calculation
    if (deposit.rateSchedule && deposit.rateSchedule.length > 0 && deposit.maturityDate) {
      const amount = parseFloat(deposit.amount) || 0;
      let total = 0;
      for (const step of deposit.rateSchedule) {
        const from = new Date(step.from), to = new Date(step.to);
        const days = Math.max(0, (to - from) / (1000 * 60 * 60 * 24));
        total += amount * (step.rate / 100) * (days / 365);
      }
      return Math.round(total * 100) / 100;
    }
    const amount = parseFloat(deposit.amount) || 0;
    const rate = parseFloat(deposit.rate) || 0;
    const months = parseInt(deposit.durationMonths) || 12;
    return Math.round(amount * (rate / 100) * (months / 12) * 100) / 100;
  }

  // ─── PDF Parsing — V2: extracts rate schedule ─────────────
  async parsePDFConditions(file) {
    const rawText = await pdfExtractor.extractText(file);
    if (!rawText || rawText.trim().length < 30) throw new Error('PDF vide ou illisible');

    const prompt = `Tu es un analyste financier. Extrais TOUTES les informations d'un document de conditions pour un Compte à Terme ou Parts Sociales. Ce peut être une brochure commerciale, une lettre de blocage, ou une fiche produit.

TEXTE DU DOCUMENT:
---
${rawText.substring(0, 8000)}
---

Réponds UNIQUEMENT en JSON valide (pas de markdown):
{
  "productType": "cat ou parts-sociales",
  "productName": "Nom du produit (ex: CAT CROISSANCE +3A)",
  "emitter": "Banque ou organisme émetteur",
  "rate": "Taux actuariel moyen annuel brut en % (nombre). Si progressif, c'est le TRAAB ou la moyenne pondérée",
  "rateType": "fixe/variable/progressif",
  "rateSchedule": [
    {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "rate": 2.00, "earlyRate": 1.60, "label": "1er semestre"},
    {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "rate": 2.50, "earlyRate": 2.13, "label": "2ème semestre"}
  ],
  "rateDetails": "Description textuelle du barème si pas de dates exactes",
  "amount": "Montant du contrat si mentionné (nombre ou null)",
  "minAmount": "Montant minimum (nombre ou null)",
  "maxAmount": "Montant maximum (nombre ou null)",
  "durationMonths": "Durée en mois (nombre ou null)",
  "startDate": "Date de souscription/blocage si mentionnée (YYYY-MM-DD ou null)",
  "maturityDate": "Date d'échéance si mentionnée (YYYY-MM-DD ou null)",
  "entryCondition": "monthly/quarterly/annual/anytime/specific",
  "exitCondition": "maturity/monthly/quarterly/annual/anytime/notice",
  "exitNotice": "Délai de préavis (ex: 32 jours) si applicable",
  "exitPenalty": "Pénalité de sortie anticipée (ex: taux minoré selon barème)",
  "interestPayment": "maturity/monthly/quarterly/annual",
  "interestCapitalized": "true si les intérêts sont réinvestis/capitalisés, false sinon",
  "autoRenew": "true/false",
  "capitalGuarantee": "true/false",
  "fiscality": "Description fiscalité si mentionnée",
  "conditions": ["Liste des conditions particulières"],
  "summary": "Résumé en 2-3 phrases avec les chiffres clés"
}

IMPORTANT pour rateSchedule:
- Si le document contient un barème/tableau de taux par période, extrais CHAQUE palier avec dates exactes
- "rate" = taux normal si on garde jusqu'au bout
- "earlyRate" = taux appliqué si sortie anticipée pendant cette période (null si pas mentionné)
- Si pas de barème progressif, laisse rateSchedule comme tableau vide []
- Les dates doivent être au format YYYY-MM-DD`;

    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('Erreur IA: ' + res.status);
    const data = await res.json();
    let text = data.content?.map(b => b.text || '').join('') || '';
    text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    return { parsed: JSON.parse(text), rawText: rawText.substring(0, 3000) };
  }

  // ─── Taux du marché ───────────────────────────────────────
  addRate(bankId, bankName, durationMonths, rate, productType, date) {
    this.rates.rates = this.rates.rates.filter(r => !(r.bankId === bankId && r.durationMonths === durationMonths && r.productType === productType));
    this.rates.rates.push({ bankId, bankName, durationMonths, rate: parseFloat(rate), productType: productType || 'cat', date: date || new Date().toISOString().split('T')[0] });
    this.rates.lastUpdated = new Date().toISOString();
  }

  getBestRates(durationMonths, productType) {
    return this.rates.rates
      .filter(r => r.durationMonths === durationMonths && (!productType || r.productType === productType))
      .sort((a, b) => b.rate - a.rate);
  }

  // ─── Statistiques ─────────────────────────────────────────
  getStats() {
    const active = this.deposits.filter(d => d.status === 'active');
    const cats = active.filter(d => d.productType === 'cat');
    const ps = active.filter(d => d.productType === 'parts-sociales');
    const totalInvested = active.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
    const totalInterest = active.reduce((s, d) => s + (d.estimatedInterest || 0), 0);
    const weightedRate = totalInvested > 0 ? active.reduce((s, d) => s + (parseFloat(d.rate) || 0) * (parseFloat(d.amount) || 0), 0) / totalInvested : 0;

    const byBank = {};
    active.forEach(d => {
      if (!byBank[d.bankId]) byBank[d.bankId] = { name: d.bankName || d.bankId, total: 0, count: 0, cats: 0, ps: 0 };
      byBank[d.bankId].total += parseFloat(d.amount) || 0;
      byBank[d.bankId].count++;
      if (d.productType === 'parts-sociales') byBank[d.bankId].ps++; else byBank[d.bankId].cats++;
    });

    const now = new Date();
    const in12m = new Date(); in12m.setMonth(in12m.getMonth() + 12);
    const upcoming = active.filter(d => d.maturityDate && new Date(d.maturityDate) >= now && new Date(d.maturityDate) <= in12m)
      .sort((a, b) => new Date(a.maturityDate) - new Date(b.maturityDate));
    const fgdrAlerts = Object.entries(byBank).filter(([, v]) => v.total > this.objectives.maxPerBank);

    return { totalDeposits: active.length, catCount: cats.length, psCount: ps.length, totalInvested, totalInterest, weightedRate, byBank, upcoming, fgdrAlerts,
      catTotal: cats.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0),
      psTotal: ps.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0) };
  }

  getMaturityTimeline() {
    const active = this.deposits.filter(d => d.status === 'active' && d.maturityDate);
    const months = {};
    active.forEach(d => {
      const key = d.maturityDate.substring(0, 7);
      if (!months[key]) months[key] = { month: key, total: 0, deposits: [] };
      months[key].total += parseFloat(d.amount) || 0;
      months[key].deposits.push(d);
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }

  // ─── Simulateur ───────────────────────────────────────────
  simulate(totalAmount, options = {}) {
    const reserve = options.liquidityReserve || this.objectives.liquidityReserve || 0;
    const maxPerBank = options.maxPerBank || this.objectives.maxPerBank || 100000;
    const horizonMonths = options.horizonMonths || 36;
    let available = totalAmount - reserve;
    if (available <= 0) return { error: 'Montant insuffisant après réserve.', totalAmount, reserve, allocations: [], totalInterest: 0, weightedRate: 0 };

    const durations = [1, 3, 6, 12, 18, 24, 36].filter(d => d <= horizonMonths);
    const ratesByDuration = {};
    durations.forEach(d => {
      const best = this.getBestRates(d);
      ratesByDuration[d] = best.length > 0 ? best : [{ bankId: 'generic', bankName: 'Taux estimé', rate: this._estimateRate(d), durationMonths: d }];
    });

    const allocations = [];
    const sortedDurations = [...durations].reverse();
    for (const dur of sortedDurations) {
      if (available <= 0) break;
      const rates = ratesByDuration[dur] || [];
      for (const rateInfo of rates) {
        if (available <= 0) break;
        const bankAlloc = allocations.filter(a => a.bankId === rateInfo.bankId).reduce((s, a) => s + a.amount, 0);
        const maxForBank = Math.max(0, maxPerBank - bankAlloc);
        const amount = Math.min(available, maxForBank);
        if (amount > 1000) {
          allocations.push({
            amount: Math.round(amount), durationMonths: dur, bankId: rateInfo.bankId, bankName: rateInfo.bankName,
            rate: rateInfo.rate, interest: Math.round(amount * (rateInfo.rate / 100) * (dur / 12) * 100) / 100,
          });
          available -= amount;
        }
      }
    }

    const totalInterest = allocations.reduce((s, a) => s + (a.interest || 0), 0);
    const allocated = allocations.reduce((s, a) => s + a.amount, 0);
    const weightedRate = allocated > 0 ? allocations.reduce((s, a) => s + a.rate * a.amount, 0) / allocated : 0;
    return { totalAmount, reserve, allocated, remaining: Math.round(available), allocations, totalInterest: Math.round(totalInterest), weightedRate: Math.round(weightedRate * 100) / 100, horizonMonths };
  }

  _estimateRate(m) { if (m<=1) return 2.5; if (m<=3) return 2.8; if (m<=6) return 3.0; if (m<=12) return 3.2; if (m<=24) return 3.0; return 2.8; }
}

const catManager = new CATManager();

// ═══════════════════════════════════════════════════════════════
// UI RENDERING — CAT + Parts Sociales
// ═══════════════════════════════════════════════════════════════

function renderCAT(container) {
  const stats = catManager.getStats();
  const timeline = catManager.getMaturityTimeline();

  container.innerHTML = `
    <div class="stats-row">
      <div class="stat-card blue"><div class="stat-label">Total Placements</div><div class="stat-value">${stats.totalDeposits}</div><div class="stat-sub">${stats.catCount} CAT · ${stats.psCount} Parts Sociales</div></div>
      <div class="stat-card green"><div class="stat-label">Total Placé</div><div class="stat-value">${formatNumber(stats.totalInvested)}€</div><div class="stat-sub">Intérêts: +${formatNumber(stats.totalInterest)}€</div></div>
      <div class="stat-card orange"><div class="stat-label">Taux Pondéré</div><div class="stat-value">${stats.weightedRate ? formatPct(stats.weightedRate) : '—'}</div><div class="stat-sub">Sur ${Object.keys(stats.byBank).length} banques</div></div>
      <div class="stat-card purple"><div class="stat-label">Parts Sociales</div><div class="stat-value">${formatNumber(stats.psTotal)}€</div><div class="stat-sub">${stats.psCount} placement${stats.psCount > 1 ? 's' : ''}</div></div>
      <div class="stat-card cyan"><div class="stat-label">Prochaine Échéance</div><div class="stat-value">${stats.upcoming.length > 0 ? formatDate(stats.upcoming[0].maturityDate) : '—'}</div>
        <div class="stat-sub">${stats.upcoming.length > 0 ? formatNumber(stats.upcoming[0].amount) + '€' : 'Aucune'}</div></div>
    </div>

    ${stats.fgdrAlerts.length > 0 ? `<div class="alert-bar"><span>⚠️</span><span>Alerte FGDR: ${stats.fgdrAlerts.map(([, v]) => `<strong>${v.name}</strong> (${formatNumber(v.total)}€)`).join(', ')}</span></div>` : ''}

    <div class="section">
      <div class="section-header">
        <div class="section-title"><span class="dot" style="background:var(--green)"></span>Mes Placements</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" onclick="showCATObjectivesModal()">🎯 Objectifs</button>
          <button class="btn" onclick="showCATRatesModal()">📊 Taux marché</button>
          <button class="btn ai-glow" onclick="showCATSimulator()">⚡ Optimiser</button>
          <button class="btn primary" onclick="showAddPlacementModal()">+ Nouveau placement</button>
        </div>
      </div>

      ${catManager.deposits.filter(d => d.status === 'active').length === 0 ? `
        <div class="empty-state"><div class="empty-icon">🏦</div><div class="empty-text">Aucun placement enregistré</div>
          <div class="empty-sub">Ajoutez vos CAT et Parts Sociales — par upload PDF ou saisie manuelle</div></div>
      ` : renderPlacementsByBank(stats)}
    </div>

    ${timeline.length > 0 ? `
    <div class="section">
      <div class="section-header"><div class="section-title"><span class="dot" style="background:var(--orange)"></span>Échéancier</div></div>
      <div class="cat-timeline">${timeline.map(m => `
        <div class="cat-timeline-item">
          <div class="cat-timeline-month">${m.month}</div>
          <div class="cat-timeline-bar" style="width:${Math.min(100, (m.total / Math.max(stats.totalInvested, 1)) * 100 * 3)}%">
            <span class="cat-timeline-amount">${formatNumber(m.total)}€</span></div>
          <div class="cat-timeline-count">${m.deposits.length} placement${m.deposits.length > 1 ? 's' : ''}</div>
        </div>`).join('')}</div>
    </div>` : ''}
  `;
}

function renderPlacementsByBank(stats) {
  const groups = {};
  catManager.deposits.filter(d => d.status === 'active').forEach(d => {
    const key = d.bankId || 'autre';
    if (!groups[key]) groups[key] = { name: d.bankName || key, deposits: [] };
    groups[key].deposits.push(d);
  });

  return Object.entries(groups).map(([bankId, group]) => {
    const bankColor = BANKS.find(b => b.id === bankId)?.color || 'var(--accent)';
    const total = group.deposits.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
    return `
    <div class="bank-section expanded">
      <div class="bank-header" style="cursor:default">
        <div class="bank-header-left">
          <span class="bank-dot" style="background:${bankColor}"></span>
          <span class="bank-name">${group.name}</span>
          <span class="bank-count">${group.deposits.length} placement${group.deposits.length > 1 ? 's' : ''} — ${formatNumber(total)}€</span>
        </div>
      </div>
      <div class="bank-products">${group.deposits.map(d => renderPlacementCard(d)).join('')}</div>
    </div>`;
  }).join('');
}

function renderPlacementCard(d) {
  const typeInfo = PLACEMENT_TYPES.find(t => t.id === d.productType) || PLACEMENT_TYPES[0];
  const exitInfo = EXIT_CONDITIONS.find(e => e.id === d.exitCondition);
  return `
    <div class="product-card" onclick="showEditPlacementModal('${d.id}')">
      <div class="product-card-header">
        <div class="product-card-name">${d.productName || typeInfo.name}</div>
        <div class="product-card-bank" style="color:${typeInfo.color};border-color:${typeInfo.color}44;background:${typeInfo.color}11">${d.rate}%</div>
      </div>
      <div class="product-card-type">${typeInfo.icon} ${typeInfo.name}${exitInfo ? ' · ' + exitInfo.name : ''}</div>
      <div class="product-card-grid">
        <div class="product-card-field"><span class="label">Montant</span><span class="value">${formatNumber(d.amount)}€</span></div>
        <div class="product-card-field"><span class="label">Durée</span><span class="value">${d.durationMonths ? d.durationMonths + ' mois' : 'Indéterminée'}</span></div>
        <div class="product-card-field"><span class="label">Échéance</span><span class="value">${d.maturityDate ? formatDate(d.maturityDate) : '—'}</span></div>
        <div class="product-card-field"><span class="label">Intérêts</span><span class="value green">+${formatNumber(d.estimatedInterest)}€</span></div>
      </div>
      <div class="product-card-footer">
        <span class="status-badge" style="--badge-color:${typeInfo.color}">${typeInfo.icon} ${typeInfo.name}</span>
        ${d.autoRenew ? '<span class="status-badge" style="--badge-color:var(--cyan)">↻ Auto</span>' : ''}
        ${d.aiSummary ? '<span class="status-badge" style="--badge-color:var(--accent)">🤖 IA</span>' : ''}
      </div>
    </div>`;
}

// ═══ MODALS ═══

function showAddPlacementModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Nouveau Placement</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Choisissez le type de placement puis uploadez le PDF des conditions ou saisissez manuellement.</p>
    <div style="display:flex;gap:10px;margin-bottom:20px">
      ${PLACEMENT_TYPES.map(t => `<button class="btn lg" style="flex:1;justify-content:center;gap:8px" onclick="showPlacementUpload('${t.id}')">
        <span style="font-size:20px">${t.icon}</span>${t.name}</button>`).join('')}
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

function showPlacementUpload(productType) {
  const typeInfo = PLACEMENT_TYPES.find(t => t.id === productType);
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">${typeInfo.icon} ${typeInfo.name}</h2>
    <div class="upload-zone" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handlePlacementDrop(event,'${productType}')">
      <div class="upload-icon">📄</div><div class="upload-text">Glisser le PDF ici</div>
      <div class="upload-sub">Brochure, lettre de blocage, fiche produit — Claude extraira tout</div>
      <input type="file" accept=".pdf" id="placement-file" style="display:none" onchange="handlePlacementFile(event,'${productType}')">
    </div>
    <button class="btn" style="width:100%;margin-top:12px" onclick="document.getElementById('placement-file').click()">Choisir un PDF</button>
    <div class="upload-divider"><span>ou</span></div>
    <button class="btn ghost" style="width:100%" onclick="showManualPlacementModal('${productType}')">✏️ Saisie manuelle</button>
    <div id="placement-progress" class="upload-progress hidden"><div class="spinner"></div><span id="placement-status">Extraction...</span></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function handlePlacementDrop(e, productType) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) await processPlacementPDF(f, productType); }
async function handlePlacementFile(e, productType) { const f = e.target.files[0]; if (f) await processPlacementPDF(f, productType); }

async function processPlacementPDF(file, productType) {
  const progress = document.getElementById('placement-progress');
  const status = document.getElementById('placement-status');
  if (progress) progress.classList.remove('hidden');
  try {
    if (status) status.textContent = 'Extraction du texte...';
    const { parsed, rawText } = await catManager.parsePDFConditions(file);
    if (status) status.textContent = 'Analyse terminée !';
    closeModal();
    showManualPlacementModal(productType, parsed, rawText, file.name);
  } catch (e) {
    if (status) status.textContent = 'Erreur: ' + e.message;
    if (progress) progress.classList.add('error');
  }
}

function showManualPlacementModal(productType, prefill, rawText, sourceFile) {
  const p = prefill || {};
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">${p.productName ? '🤖 Données extraites — Vérifiez et validez' : 'Saisie manuelle'}</h2>
    ${p.summary ? `<div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px;color:var(--text);line-height:1.5"><strong style="color:var(--accent)">🤖 Résumé IA:</strong> ${p.summary}</div>` : ''}
    <div class="form-grid">
      <div class="form-field"><label>Type</label><select id="pl-type">
        ${PLACEMENT_TYPES.map(t => `<option value="${t.id}" ${(p.productType || productType) === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Banque</label><select id="pl-bank">
        <option value="">Sélectionner...</option>
        ${BANKS.map(b => `<option value="${b.id}" ${p.emitter && b.name.toLowerCase().includes((p.emitter||'').toLowerCase().substring(0,4)) ? 'selected' : ''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field full"><label>Nom du produit</label><input id="pl-name" value="${p.productName || ''}" placeholder="Ex: CAT 24 mois Promo"></div>
      <div class="form-field"><label>Montant (€)</label><input id="pl-amount" type="number" value="${p.amount || p.minAmount || ''}" placeholder="50000"></div>
      <div class="form-field"><label>Taux moyen annuel (%)</label><input id="pl-rate" type="number" step="0.01" value="${p.rate || ''}" placeholder="3.50"></div>
      <div class="form-field"><label>Type de taux</label><select id="pl-rate-type">
        <option value="fixe" ${p.rateType === 'fixe' ? 'selected' : ''}>Fixe</option>
        <option value="variable" ${p.rateType === 'variable' ? 'selected' : ''}>Variable</option>
        <option value="progressif" ${p.rateType === 'progressif' ? 'selected' : ''}>Progressif</option></select></div>
      <div class="form-field"><label>Durée (mois)</label><input id="pl-duration" type="number" value="${p.durationMonths || ''}" placeholder="24"></div>
      <div class="form-field"><label>Date de souscription</label><input id="pl-start" type="date" value="${p.startDate || new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Versement intérêts</label><select id="pl-interest">
        ${INTEREST_PAYMENTS.map(i => `<option value="${i.id}" ${p.interestPayment === i.id ? 'selected' : ''}>${i.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Condition de sortie</label><select id="pl-exit">
        ${EXIT_CONDITIONS.map(e => `<option value="${e.id}" ${p.exitCondition === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Pénalité sortie</label><input id="pl-penalty" value="${p.exitPenalty || ''}" placeholder="Ex: 32j préavis, taux minoré"></div>
      <div class="form-field"><label>Renouvellement auto</label><select id="pl-renew">
        <option value="false" ${!p.autoRenew ? 'selected' : ''}>Non</option>
        <option value="true" ${p.autoRenew === true || p.autoRenew === 'true' ? 'selected' : ''}>Oui</option></select></div>
    </div>
    <input type="hidden" id="pl-raw-text" value="${rawText ? encodeURIComponent(rawText) : ''}">
    <input type="hidden" id="pl-source-file" value="${sourceFile || ''}">
    <input type="hidden" id="pl-ai-summary" value="${p.summary ? encodeURIComponent(p.summary) : ''}">
    <input type="hidden" id="pl-ai-schedule" value="${p.rateSchedule && p.rateSchedule.length > 0 ? encodeURIComponent(JSON.stringify(p.rateSchedule)) : ''}">
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="savePlacement()">Enregistrer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

function showEditPlacementModal(id) {
  const d = catManager.deposits.find(x => x.id === id);
  if (!d) return;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">Modifier le placement</h2>
    ${d.aiSummary ? `<div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px;color:var(--text);line-height:1.5"><strong style="color:var(--accent)">🤖 Résumé:</strong> ${d.aiSummary}</div>` : ''}
    <div class="form-grid">
      <div class="form-field"><label>Type</label><select id="pl-type">
        ${PLACEMENT_TYPES.map(t => `<option value="${t.id}" ${d.productType === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Banque</label><select id="pl-bank">
        ${BANKS.map(b => `<option value="${b.id}" ${d.bankId === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field full"><label>Nom</label><input id="pl-name" value="${d.productName || ''}"></div>
      <div class="form-field"><label>Montant (€)</label><input id="pl-amount" type="number" value="${d.amount || ''}"></div>
      <div class="form-field"><label>Taux (%)</label><input id="pl-rate" type="number" step="0.01" value="${d.rate || ''}"></div>
      <div class="form-field"><label>Type de taux</label><select id="pl-rate-type">
        <option value="fixe" ${d.rateType === 'fixe' ? 'selected' : ''}>Fixe</option>
        <option value="variable" ${d.rateType === 'variable' ? 'selected' : ''}>Variable</option>
        <option value="progressif" ${d.rateType === 'progressif' ? 'selected' : ''}>Progressif</option></select></div>
      <div class="form-field"><label>Durée (mois)</label><input id="pl-duration" type="number" value="${d.durationMonths || ''}"></div>
      <div class="form-field"><label>Date souscription</label><input id="pl-start" type="date" value="${d.startDate || ''}"></div>
      <div class="form-field"><label>Versement intérêts</label><select id="pl-interest">
        ${INTEREST_PAYMENTS.map(i => `<option value="${i.id}" ${d.interestPayment === i.id ? 'selected' : ''}>${i.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Condition de sortie</label><select id="pl-exit">
        ${EXIT_CONDITIONS.map(e => `<option value="${e.id}" ${d.exitCondition === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Pénalité sortie</label><input id="pl-penalty" value="${d.exitPenalty || ''}"></div>
      <div class="form-field"><label>Renouvellement auto</label><select id="pl-renew">
        <option value="false" ${!d.autoRenew ? 'selected' : ''}>Non</option>
        <option value="true" ${d.autoRenew ? 'selected' : ''}>Oui</option></select></div>
    </div>
    <input type="hidden" id="pl-edit-id" value="${d.id}">
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn danger" onclick="deletePlacement('${d.id}')">Supprimer</button>
      <button class="btn primary" onclick="savePlacement('${d.id}')">Enregistrer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function savePlacement(editId) {
  const bankId = document.getElementById('pl-bank').value;
  const bank = BANKS.find(b => b.id === bankId);
  const deposit = {
    productType: document.getElementById('pl-type').value,
    bankId, bankName: bank?.name || bankId,
    productName: document.getElementById('pl-name').value,
    amount: parseFloat(document.getElementById('pl-amount').value) || 0,
    rate: parseFloat(document.getElementById('pl-rate').value) || 0,
    rateType: document.getElementById('pl-rate-type').value,
    durationMonths: parseInt(document.getElementById('pl-duration').value) || 0,
    startDate: document.getElementById('pl-start').value,
    interestPayment: document.getElementById('pl-interest').value,
    exitCondition: document.getElementById('pl-exit').value,
    exitPenalty: document.getElementById('pl-penalty')?.value || '',
    autoRenew: document.getElementById('pl-renew').value === 'true',
    status: 'active',
  };
  const rawEl = document.getElementById('pl-raw-text');
  const summaryEl = document.getElementById('pl-ai-summary');
  const sourceEl = document.getElementById('pl-source-file');
  const scheduleEl = document.getElementById('pl-ai-schedule');
  if (rawEl?.value) deposit.rawText = decodeURIComponent(rawEl.value);
  if (summaryEl?.value) deposit.aiSummary = decodeURIComponent(summaryEl.value);
  if (sourceEl?.value) deposit.sourceFile = sourceEl.value;
  // Auto-load rate schedule from AI extraction
  if (scheduleEl?.value) {
    try { deposit.rateSchedule = JSON.parse(decodeURIComponent(scheduleEl.value)); deposit.rateType = 'progressif'; } catch(e) {}
  }

  if (editId) catManager.updateDeposit(editId, deposit);
  else catManager.addDeposit(deposit);

  closeModal(); await catManager.saveDeposits();
  showToast(editId ? 'Placement modifié' : 'Placement ajouté', 'success');
  app.setState({ view: 'cat' }); renderCAT(document.getElementById('main-content'));
}

async function deletePlacement(id) {
  if (!confirm('Supprimer ce placement ?')) return;
  catManager.removeDeposit(id); closeModal();
  await catManager.saveDeposits(); showToast('Supprimé', 'success');
  app.setState({ view: 'cat' }); renderCAT(document.getElementById('main-content'));
}

// ─── Objectifs ──────────────────────────────────────────────
function showCATObjectivesModal() {
  const obj = catManager.objectives;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">🎯 Objectifs</h2>
    <div class="form-grid">
      <div class="form-field"><label>Besoin mensuel (€)</label><input id="obj-monthly" type="number" value="${obj.monthlyNeed}" placeholder="0"></div>
      <div class="form-field"><label>Réserve liquidité (€)</label><input id="obj-reserve" type="number" value="${obj.liquidityReserve}" placeholder="0"></div>
      <div class="form-field"><label>Plafond FGDR par banque (€)</label><input id="obj-maxbank" type="number" value="${obj.maxPerBank}" placeholder="100000"></div>
      <div class="form-field full"><label>Notes</label><textarea id="obj-notes">${obj.notes || ''}</textarea></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="saveCATObjectives()">Enregistrer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function saveCATObjectives() {
  catManager.objectives = { monthlyNeed: parseFloat(document.getElementById('obj-monthly').value) || 0, liquidityReserve: parseFloat(document.getElementById('obj-reserve').value) || 0, maxPerBank: parseFloat(document.getElementById('obj-maxbank').value) || 100000, notes: document.getElementById('obj-notes').value };
  closeModal(); await catManager.saveObjectives();
  showToast('Objectifs sauvegardés', 'success');
  app.setState({ view: 'cat' }); renderCAT(document.getElementById('main-content'));
}

// ─── Taux marché ────────────────────────────────────────────
function showCATRatesModal() {
  const modal = document.getElementById('modal');
  const durations = [1, 3, 6, 12, 18, 24, 36, 48, 60];
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">📊 Taux du Marché</h2>
    <div class="form-grid">
      <div class="form-field"><label>Banque</label><select id="rate-bank">${BANKS.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Type</label><select id="rate-type">${PLACEMENT_TYPES.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Durée</label><select id="rate-duration">${durations.map(d => `<option value="${d}">${d} mois</option>`).join('')}</select></div>
      <div class="form-field"><label>Taux (%)</label><input id="rate-value" type="number" step="0.01" placeholder="3.50"></div>
    </div>
    <button class="btn primary" style="width:100%;margin-top:12px" onclick="addMarketRate()">Ajouter ce taux</button>
    <div style="margin-top:16px"><h3 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Taux enregistrés</h3>
      <div id="rates-list">${renderRatesList()}</div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

function renderRatesList() {
  if (catManager.rates.rates.length === 0) return '<div style="color:var(--text-dim);font-size:12px">Aucun taux</div>';
  return [...catManager.rates.rates].sort((a, b) => a.durationMonths - b.durationMonths || b.rate - a.rate).map(r => {
    const typeIcon = r.productType === 'parts-sociales' ? '🤝' : '🏦';
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span>${typeIcon} ${r.bankName} · ${r.durationMonths} mois</span><span style="color:var(--green);font-family:var(--mono)">${r.rate}%</span></div>`;
  }).join('');
}

async function addMarketRate() {
  const bankId = document.getElementById('rate-bank').value;
  const bank = BANKS.find(b => b.id === bankId);
  const rate = document.getElementById('rate-value').value;
  if (!rate) { showToast('Taux requis', 'error'); return; }
  catManager.addRate(bankId, bank?.name || bankId, parseInt(document.getElementById('rate-duration').value), rate, document.getElementById('rate-type').value);
  await catManager.saveRates();
  document.getElementById('rates-list').innerHTML = renderRatesList();
  document.getElementById('rate-value').value = '';
  showToast('Taux ajouté', 'success');
}

// ─── Simulateur ─────────────────────────────────────────────
function showCATSimulator() {
  const modal = document.getElementById('modal');
  const currentTotal = catManager.deposits.filter(d => d.status === 'active').reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">⚡ Optimiseur de Rendement</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Simule la meilleure répartition selon les taux du marché, en respectant le plafond FGDR par banque.</p>
    <div class="form-grid">
      <div class="form-field"><label>Montant à placer (€)</label><input id="sim-amount" type="number" value="${currentTotal || ''}" placeholder="200000"></div>
      <div class="form-field"><label>Réserve liquidité (€)</label><input id="sim-reserve" type="number" value="${catManager.objectives.liquidityReserve}" placeholder="0"></div>
      <div class="form-field"><label>Plafond FGDR/banque (€)</label><input id="sim-max" type="number" value="${catManager.objectives.maxPerBank}" placeholder="100000"></div>
      <div class="form-field"><label>Horizon max</label><select id="sim-horizon">
        <option value="12">12 mois</option><option value="24">24 mois</option><option value="36" selected>36 mois</option><option value="60">60 mois</option></select></div>
    </div>
    <button class="btn ai-glow lg" style="width:100%;margin-top:16px" onclick="runSimulation()">🚀 Optimiser</button>
    <div id="sim-results" style="margin-top:20px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

function runSimulation() {
  const result = catManager.simulate(parseFloat(document.getElementById('sim-amount').value) || 0, {
    liquidityReserve: parseFloat(document.getElementById('sim-reserve').value) || 0,
    maxPerBank: parseFloat(document.getElementById('sim-max').value) || 100000,
    horizonMonths: parseInt(document.getElementById('sim-horizon').value) || 36,
  });
  const c = document.getElementById('sim-results');
  if (result.error) { c.innerHTML = `<div class="alert-bar"><span>⚠️</span>${result.error}</div>`; return; }
  c.innerHTML = `
    <div class="stats-row" style="margin-bottom:16px">
      <div class="stat-card green"><div class="stat-label">Rendement</div><div class="stat-value">+${formatNumber(result.totalInterest)}€</div></div>
      <div class="stat-card blue"><div class="stat-label">Taux Pondéré</div><div class="stat-value">${formatPct(result.weightedRate)}</div></div>
      <div class="stat-card orange"><div class="stat-label">Placé</div><div class="stat-value">${formatNumber(result.allocated)}€</div></div>
    </div>
    ${result.allocations.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px">
        <div><strong style="color:var(--text-bright)">${a.bankName}</strong> · ${a.durationMonths} mois</div>
        <div style="display:flex;gap:14px"><span style="font-family:var(--mono)">${formatNumber(a.amount)}€</span>
          <span style="color:var(--green);font-family:var(--mono)">${a.rate}%</span>
          <span style="color:var(--text-muted)">→ +${formatNumber(a.interest)}€</span></div>
      </div>`).join('')}`;
}

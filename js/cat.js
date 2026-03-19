// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Module Comptes à Terme (CAT)
// Gestion, suivi, simulation et optimisation de placement
// ═══════════════════════════════════════════════════════════════

class CATManager {
  constructor() {
    this.deposits = [];
    this.rates = { lastUpdated: null, rates: [] };
    this.objectives = { monthlyNeed: 0, liquidityReserve: 0, maxPerBank: 100000, horizon: 'mixed', notes: '' };
  }

  // ─── Chargement depuis GitHub ─────────────────────────────
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

  // ─── Sauvegardes ──────────────────────────────────────────
  async saveDeposits() {
    await github.writeFile(`${CONFIG.DATA_PATH}/cat/deposits.json`, this.deposits, '[StructBoard] Update CAT deposits');
  }
  async saveRates() {
    await github.writeFile(`${CONFIG.DATA_PATH}/cat/rates.json`, this.rates, '[StructBoard] Update CAT rates');
  }
  async saveObjectives() {
    await github.writeFile(`${CONFIG.DATA_PATH}/cat/objectives.json`, this.objectives, '[StructBoard] Update CAT objectives');
  }

  // ─── CRUD Dépôts ─────────────────────────────────────────
  addDeposit(deposit) {
    deposit.id = deposit.id || 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
    deposit.createdDate = new Date().toISOString().split('T')[0];
    // Calculer la date de maturité si pas fournie
    if (!deposit.maturityDate && deposit.startDate && deposit.durationMonths) {
      const start = new Date(deposit.startDate);
      start.setMonth(start.getMonth() + parseInt(deposit.durationMonths));
      deposit.maturityDate = start.toISOString().split('T')[0];
    }
    // Calculer les intérêts estimés
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

  removeDeposit(id) {
    this.deposits = this.deposits.filter(d => d.id !== id);
  }

  // ─── Calcul intérêts ─────────────────────────────────────
  _calcInterest(deposit) {
    const amount = parseFloat(deposit.amount) || 0;
    const rate = parseFloat(deposit.rate) || 0;
    const months = parseInt(deposit.durationMonths) || 12;
    return Math.round(amount * (rate / 100) * (months / 12) * 100) / 100;
  }

  // ─── Taux du marché ───────────────────────────────────────
  addRate(bankId, bankName, durationMonths, rate, date) {
    // Retirer l'ancien taux pour cette banque/durée
    this.rates.rates = this.rates.rates.filter(r => !(r.bankId === bankId && r.durationMonths === durationMonths));
    this.rates.rates.push({ bankId, bankName, durationMonths, rate: parseFloat(rate), date: date || new Date().toISOString().split('T')[0] });
    this.rates.lastUpdated = new Date().toISOString();
  }

  getBestRates(durationMonths) {
    return this.rates.rates
      .filter(r => r.durationMonths === durationMonths)
      .sort((a, b) => b.rate - a.rate);
  }

  // ─── Statistiques ─────────────────────────────────────────
  getStats() {
    const active = this.deposits.filter(d => d.status === 'active');
    const totalInvested = active.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
    const totalInterest = active.reduce((s, d) => s + (d.estimatedInterest || 0), 0);
    const avgRate = active.length > 0
      ? active.reduce((s, d) => s + (parseFloat(d.rate) || 0), 0) / active.length : 0;
    const weightedRate = totalInvested > 0
      ? active.reduce((s, d) => s + (parseFloat(d.rate) || 0) * (parseFloat(d.amount) || 0), 0) / totalInvested : 0;

    // Par banque
    const byBank = {};
    active.forEach(d => {
      if (!byBank[d.bankId]) byBank[d.bankId] = { name: d.bankName || d.bankId, total: 0, count: 0 };
      byBank[d.bankId].total += parseFloat(d.amount) || 0;
      byBank[d.bankId].count++;
    });

    // Maturités à venir (prochains 12 mois)
    const now = new Date();
    const in12m = new Date(); in12m.setMonth(in12m.getMonth() + 12);
    const upcoming = active
      .filter(d => d.maturityDate && new Date(d.maturityDate) >= now && new Date(d.maturityDate) <= in12m)
      .sort((a, b) => new Date(a.maturityDate) - new Date(b.maturityDate));

    // Alerte FGDR (>100k€ par banque)
    const fgdrAlerts = Object.entries(byBank).filter(([, v]) => v.total > this.objectives.maxPerBank);

    return {
      totalDeposits: active.length,
      totalInvested,
      totalInterest,
      avgRate,
      weightedRate,
      byBank,
      upcoming,
      fgdrAlerts,
      maturedCount: this.deposits.filter(d => d.status === 'matured').length,
    };
  }

  // ─── Timeline des maturités ───────────────────────────────
  getMaturityTimeline() {
    const active = this.deposits.filter(d => d.status === 'active' && d.maturityDate);
    const months = {};
    active.forEach(d => {
      const key = d.maturityDate.substring(0, 7); // YYYY-MM
      if (!months[key]) months[key] = { month: key, total: 0, deposits: [] };
      months[key].total += parseFloat(d.amount) || 0;
      months[key].deposits.push(d);
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }

  // ═══════════════════════════════════════════════════════════
  // SIMULATEUR / OPTIMISEUR
  // ═══════════════════════════════════════════════════════════

  // Optimise la répartition d'un montant total selon :
  // - Besoin mensuel (monthlyNeed)
  // - Réserve de liquidité
  // - Taux disponibles
  // - Plafond FGDR par banque
  // Stratégie: échelle de maturités (ladder) + maximisation du rendement
  simulate(totalAmount, options = {}) {
    const monthlyNeed = options.monthlyNeed || this.objectives.monthlyNeed || 0;
    const reserve = options.liquidityReserve || this.objectives.liquidityReserve || 0;
    const maxPerBank = options.maxPerBank || this.objectives.maxPerBank || 100000;
    const horizonMonths = options.horizonMonths || 36;

    let available = totalAmount - reserve;
    if (available <= 0) {
      return {
        error: 'Le montant disponible après réserve de liquidité est insuffisant.',
        totalAmount, reserve, available: 0, allocations: [], monthlyIncome: 0, totalInterest: 0, avgRate: 0,
      };
    }

    // Récupérer les meilleurs taux par durée
    const durations = [1, 3, 6, 12, 18, 24, 36].filter(d => d <= horizonMonths);
    const ratesByDuration = {};
    durations.forEach(d => {
      const best = this.getBestRates(d);
      ratesByDuration[d] = best.length > 0 ? best : [{ bankId: 'generic', bankName: 'Taux estimé', rate: this._estimateRate(d), durationMonths: d }];
    });

    const allocations = [];

    // 1. Couverture du besoin mensuel: placer en échelons courts (1-12 mois)
    if (monthlyNeed > 0) {
      const monthsToCover = Math.min(12, horizonMonths);
      for (let m = 1; m <= monthsToCover && available > 0; m++) {
        const amount = Math.min(monthlyNeed, available);
        const duration = m;
        const closestDuration = durations.reduce((prev, curr) => Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev);
        const bestRate = ratesByDuration[closestDuration]?.[0];

        if (bestRate && amount > 0) {
          // Vérifier le plafond FGDR
          const bankAlloc = allocations.filter(a => a.bankId === bestRate.bankId).reduce((s, a) => s + a.amount, 0);
          let allocBank = bestRate;
          if (bankAlloc + amount > maxPerBank && ratesByDuration[closestDuration]?.length > 1) {
            allocBank = ratesByDuration[closestDuration][1]; // fallback sur la 2ème banque
          }

          allocations.push({
            purpose: 'mensuel',
            month: m,
            amount: Math.round(amount),
            durationMonths: closestDuration,
            bankId: allocBank.bankId,
            bankName: allocBank.bankName,
            rate: allocBank.rate,
            maturityMonth: m,
            interest: Math.round(amount * (allocBank.rate / 100) * (closestDuration / 12) * 100) / 100,
          });
          available -= amount;
        }
      }
    }

    // 2. Le reste: maximiser le rendement en long terme
    if (available > 0) {
      const longDurations = durations.filter(d => d >= 12).reverse(); // du plus long au plus court
      if (longDurations.length === 0) longDurations.push(durations[durations.length - 1]);

      for (const dur of longDurations) {
        if (available <= 0) break;
        const rates = ratesByDuration[dur] || [];
        for (const rateInfo of rates) {
          if (available <= 0) break;
          const bankAlloc = allocations.filter(a => a.bankId === rateInfo.bankId).reduce((s, a) => s + a.amount, 0);
          const maxForBank = Math.max(0, maxPerBank - bankAlloc);
          const amount = Math.min(available, maxForBank);
          if (amount > 0) {
            allocations.push({
              purpose: 'rendement',
              amount: Math.round(amount),
              durationMonths: dur,
              bankId: rateInfo.bankId,
              bankName: rateInfo.bankName,
              rate: rateInfo.rate,
              interest: Math.round(amount * (rateInfo.rate / 100) * (dur / 12) * 100) / 100,
            });
            available -= amount;
          }
        }
      }
    }

    // Résultats
    const totalInterest = allocations.reduce((s, a) => s + (a.interest || 0), 0);
    const monthlyIncome = monthlyNeed > 0 ? allocations.filter(a => a.purpose === 'mensuel').reduce((s, a) => s + a.amount, 0) / 12 : 0;
    const weightedRate = totalAmount > 0
      ? allocations.reduce((s, a) => s + a.rate * a.amount, 0) / allocations.reduce((s, a) => s + a.amount, 0) : 0;

    return {
      totalAmount,
      reserve,
      allocated: allocations.reduce((s, a) => s + a.amount, 0),
      remaining: Math.round(available),
      allocations,
      totalInterest: Math.round(totalInterest),
      monthlyIncome: Math.round(monthlyIncome),
      weightedRate: Math.round(weightedRate * 100) / 100,
      horizonMonths,
    };
  }

  _estimateRate(months) {
    // Estimation grossière si pas de taux renseigné
    if (months <= 1) return 2.5;
    if (months <= 3) return 2.8;
    if (months <= 6) return 3.0;
    if (months <= 12) return 3.2;
    if (months <= 24) return 3.0;
    return 2.8;
  }
}

const catManager = new CATManager();

// ═══════════════════════════════════════════════════════════════
// CAT UI Rendering
// ═══════════════════════════════════════════════════════════════

function renderCAT(container) {
  const stats = catManager.getStats();
  const timeline = catManager.getMaturityTimeline();

  container.innerHTML = `
    <!-- CAT Stats -->
    <div class="stats-row">
      <div class="stat-card blue"><div class="stat-label">CAT Actifs</div><div class="stat-value">${stats.totalDeposits}</div><div class="stat-sub">${Object.keys(stats.byBank).length} banques</div></div>
      <div class="stat-card green"><div class="stat-label">Total Placé</div><div class="stat-value">${formatNumber(stats.totalInvested)}€</div><div class="stat-sub">Intérêts: ${formatNumber(stats.totalInterest)}€</div></div>
      <div class="stat-card orange"><div class="stat-label">Taux Moyen Pondéré</div><div class="stat-value">${stats.weightedRate ? formatPct(stats.weightedRate) : '—'}</div><div class="stat-sub">Simple: ${stats.avgRate ? formatPct(stats.avgRate) : '—'}</div></div>
      <div class="stat-card purple"><div class="stat-label">Prochaine Échéance</div><div class="stat-value">${stats.upcoming.length > 0 ? formatDate(stats.upcoming[0].maturityDate) : '—'}</div>
        <div class="stat-sub">${stats.upcoming.length > 0 ? formatNumber(stats.upcoming[0].amount)+'€' : 'Aucune'}</div></div>
      <div class="stat-card cyan"><div class="stat-label">Objectif Mensuel</div><div class="stat-value">${catManager.objectives.monthlyNeed ? formatNumber(catManager.objectives.monthlyNeed)+'€' : '—'}</div><div class="stat-sub">Réserve: ${formatNumber(catManager.objectives.liquidityReserve)}€</div></div>
    </div>

    ${stats.fgdrAlerts.length > 0 ? `<div class="alert-bar"><span>⚠️</span><span>Alerte FGDR: ${stats.fgdrAlerts.map(([,v])=>`<strong>${v.name}</strong> (${formatNumber(v.total)}€ > ${formatNumber(catManager.objectives.maxPerBank)}€)`).join(', ')}</span></div>` : ''}

    <!-- Boutons d'action -->
    <div class="section">
      <div class="section-header">
        <div class="section-title"><span class="dot" style="background:var(--green)"></span>Mes Comptes à Terme</div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="showCATObjectivesModal()">🎯 Objectifs</button>
          <button class="btn" onclick="showCATRatesModal()">📊 Taux marché</button>
          <button class="btn ai-glow" onclick="showCATSimulator()">⚡ Simulateur</button>
          <button class="btn primary" onclick="showAddCATModal()">+ Nouveau CAT</button>
        </div>
      </div>

      ${catManager.deposits.length === 0 ? `
        <div class="empty-state"><div class="empty-icon">🏦</div><div class="empty-text">Aucun compte à terme enregistré</div>
          <div class="empty-sub">Ajoutez vos CAT pour suivre vos placements et optimiser vos rendements</div></div>
      ` : `
        <!-- Par banque -->
        ${renderCATByBank(stats)}
      `}
    </div>

    <!-- Timeline des maturités -->
    ${timeline.length > 0 ? `
    <div class="section">
      <div class="section-header"><div class="section-title"><span class="dot" style="background:var(--orange)"></span>Échéancier des Maturités</div></div>
      <div class="cat-timeline">${timeline.map(m => `
        <div class="cat-timeline-item">
          <div class="cat-timeline-month">${m.month}</div>
          <div class="cat-timeline-bar" style="width:${Math.min(100, (m.total / stats.totalInvested) * 100 * 3)}%">
            <span class="cat-timeline-amount">${formatNumber(m.total)}€</span>
          </div>
          <div class="cat-timeline-count">${m.deposits.length} CAT</div>
        </div>`).join('')}
      </div>
    </div>` : ''}
  `;
}

function renderCATByBank(stats) {
  const bankGroups = {};
  catManager.deposits.filter(d => d.status === 'active').forEach(d => {
    const key = d.bankId || 'autre';
    if (!bankGroups[key]) bankGroups[key] = { name: d.bankName || key, deposits: [] };
    bankGroups[key].deposits.push(d);
  });

  return Object.entries(bankGroups).map(([bankId, group]) => `
    <div class="bank-section expanded">
      <div class="bank-header" style="cursor:default">
        <div class="bank-header-left">
          <span class="bank-dot" style="background:${BANKS.find(b=>b.id===bankId)?.color || 'var(--accent)'}"></span>
          <span class="bank-name">${group.name}</span>
          <span class="bank-count">${group.deposits.length} CAT — ${formatNumber(group.deposits.reduce((s,d)=>s+(parseFloat(d.amount)||0),0))}€</span>
        </div>
      </div>
      <div class="bank-products">
        ${group.deposits.map(d => `
          <div class="product-card" onclick="showCATDetail('${d.id}')">
            <div class="product-card-header">
              <div class="product-card-name">${d.productName || 'CAT ' + d.durationMonths + ' mois'}</div>
              <div class="product-card-bank" style="color:var(--green);border-color:rgba(52,211,153,0.3);background:rgba(52,211,153,0.08)">${d.rate}%</div>
            </div>
            <div class="product-card-grid">
              <div class="product-card-field"><span class="label">Montant</span><span class="value">${formatNumber(d.amount)}€</span></div>
              <div class="product-card-field"><span class="label">Durée</span><span class="value">${d.durationMonths} mois</span></div>
              <div class="product-card-field"><span class="label">Échéance</span><span class="value">${formatDate(d.maturityDate)}</span></div>
              <div class="product-card-field"><span class="label">Intérêts</span><span class="value green">${formatNumber(d.estimatedInterest)}€</span></div>
            </div>
            <div class="product-card-footer">
              <span class="status-badge" style="--badge-color:var(--green)">Actif</span>
              ${d.autoRenew ? '<span class="status-badge" style="--badge-color:var(--cyan)">↻ Auto</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ─── Modals CAT ─────────────────────────────────────────────
function showAddCATModal(editId) {
  const existing = editId ? catManager.deposits.find(d => d.id === editId) : null;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">${existing ? 'Modifier le CAT' : 'Nouveau Compte à Terme'}</h2>
    <div class="form-grid">
      <div class="form-field"><label>Banque</label><select id="cat-bank">
        <option value="">Sélectionner...</option>
        ${BANKS.map(b=>`<option value="${b.id}" ${existing?.bankId===b.id?'selected':''}>${b.name}</option>`).join('')}
        <option value="autre">Autre</option></select></div>
      <div class="form-field"><label>Nom du produit</label><input id="cat-name" value="${existing?.productName||''}" placeholder="Ex: CAT 12 mois Promo"></div>
      <div class="form-field"><label>Montant (€)</label><input id="cat-amount" type="number" value="${existing?.amount||''}" placeholder="50000"></div>
      <div class="form-field"><label>Taux annuel (%)</label><input id="cat-rate" type="number" step="0.01" value="${existing?.rate||''}" placeholder="3.50"></div>
      <div class="form-field"><label>Durée (mois)</label><select id="cat-duration">
        ${[1,3,6,9,12,18,24,36,48,60].map(d=>`<option value="${d}" ${existing?.durationMonths==d?'selected':''}>${d} mois${d>=12?' ('+(d/12)+' an'+(d>12?'s':'')+')':''}</option>`).join('')}</select></div>
      <div class="form-field"><label>Date de souscription</label><input id="cat-start" type="date" value="${existing?.startDate||new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label>Versement intérêts</label><select id="cat-interest">
        <option value="maturity" ${existing?.interestPayment==='maturity'?'selected':''}>À maturité</option>
        <option value="monthly" ${existing?.interestPayment==='monthly'?'selected':''}>Mensuel</option>
        <option value="quarterly" ${existing?.interestPayment==='quarterly'?'selected':''}>Trimestriel</option>
        <option value="annual" ${existing?.interestPayment==='annual'?'selected':''}>Annuel</option></select></div>
      <div class="form-field"><label>Renouvellement auto</label><select id="cat-renew">
        <option value="false" ${!existing?.autoRenew?'selected':''}>Non</option>
        <option value="true" ${existing?.autoRenew?'selected':''}>Oui</option></select></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      ${existing?`<button class="btn danger" onclick="deleteCATDeposit('${editId}')">Supprimer</button>`:''}
      <button class="btn primary" onclick="saveCATDeposit('${editId||''}')">${existing?'Modifier':'Ajouter'}</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function saveCATDeposit(editId) {
  const bankId = document.getElementById('cat-bank').value;
  const bank = BANKS.find(b => b.id === bankId);
  const deposit = {
    bankId, bankName: bank?.name || bankId,
    productName: document.getElementById('cat-name').value,
    amount: parseFloat(document.getElementById('cat-amount').value) || 0,
    rate: parseFloat(document.getElementById('cat-rate').value) || 0,
    durationMonths: parseInt(document.getElementById('cat-duration').value) || 12,
    startDate: document.getElementById('cat-start').value,
    interestPayment: document.getElementById('cat-interest').value,
    autoRenew: document.getElementById('cat-renew').value === 'true',
    status: 'active',
  };
  if (editId) { catManager.updateDeposit(editId, deposit); }
  else { catManager.addDeposit(deposit); }
  closeModal(); await catManager.saveDeposits();
  showToast(editId ? 'CAT modifié' : 'CAT ajouté', 'success');
  app.render();
}

async function deleteCATDeposit(id) {
  if (!confirm('Supprimer ce CAT ?')) return;
  catManager.removeDeposit(id); closeModal();
  await catManager.saveDeposits(); showToast('CAT supprimé', 'success'); app.render();
}

function showCATDetail(id) { showAddCATModal(id); }

// ─── Objectifs ──────────────────────────────────────────────
function showCATObjectivesModal() {
  const obj = catManager.objectives;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">🎯 Mes Objectifs de Placement</h2>
    <div class="form-grid">
      <div class="form-field"><label>Besoin mensuel (€)</label><input id="obj-monthly" type="number" value="${obj.monthlyNeed}" placeholder="5000"></div>
      <div class="form-field"><label>Réserve liquidité (€)</label><input id="obj-reserve" type="number" value="${obj.liquidityReserve}" placeholder="20000"></div>
      <div class="form-field"><label>Plafond par banque (€)</label><input id="obj-maxbank" type="number" value="${obj.maxPerBank}" placeholder="100000"></div>
      <div class="form-field full"><label>Notes</label><textarea id="obj-notes" placeholder="Objectifs, contraintes...">${obj.notes||''}</textarea></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="saveCATObjectives()">Enregistrer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function saveCATObjectives() {
  catManager.objectives.monthlyNeed = parseFloat(document.getElementById('obj-monthly').value) || 0;
  catManager.objectives.liquidityReserve = parseFloat(document.getElementById('obj-reserve').value) || 0;
  catManager.objectives.maxPerBank = parseFloat(document.getElementById('obj-maxbank').value) || 100000;
  catManager.objectives.notes = document.getElementById('obj-notes').value;
  closeModal(); await catManager.saveObjectives();
  showToast('Objectifs enregistrés', 'success'); app.render();
}

// ─── Taux du marché ─────────────────────────────────────────
function showCATRatesModal() {
  const modal = document.getElementById('modal');
  const durations = [1, 3, 6, 12, 18, 24, 36];
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">📊 Taux du Marché</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Renseignez les taux proposés par chaque banque pour comparer et optimiser.</p>
    <div id="rates-form">
      <div class="form-grid">
        <div class="form-field"><label>Banque</label><select id="rate-bank">
          ${BANKS.map(b=>`<option value="${b.id}">${b.name}</option>`).join('')}</select></div>
        <div class="form-field"><label>Durée</label><select id="rate-duration">
          ${durations.map(d=>`<option value="${d}">${d} mois</option>`).join('')}</select></div>
        <div class="form-field"><label>Taux (%)</label><input id="rate-value" type="number" step="0.01" placeholder="3.50"></div>
        <div class="form-field" style="align-self:end"><button class="btn primary" onclick="addMarketRate()">Ajouter</button></div>
      </div>
    </div>
    <div style="margin-top:16px">
      <h3 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Taux enregistrés</h3>
      <div id="rates-list">${renderRatesList()}</div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

function renderRatesList() {
  if (catManager.rates.rates.length === 0) return '<div style="color:var(--text-dim);font-size:12px">Aucun taux enregistré</div>';
  const sorted = [...catManager.rates.rates].sort((a,b) => a.durationMonths - b.durationMonths || b.rate - a.rate);
  return sorted.map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
    <span>${r.bankName} — ${r.durationMonths} mois</span><span style="color:var(--green);font-family:var(--mono)">${r.rate}%</span></div>`).join('');
}

async function addMarketRate() {
  const bankId = document.getElementById('rate-bank').value;
  const bank = BANKS.find(b => b.id === bankId);
  const duration = parseInt(document.getElementById('rate-duration').value);
  const rate = document.getElementById('rate-value').value;
  if (!rate) { showToast('Taux requis', 'error'); return; }
  catManager.addRate(bankId, bank?.name || bankId, duration, rate);
  await catManager.saveRates();
  document.getElementById('rates-list').innerHTML = renderRatesList();
  document.getElementById('rate-value').value = '';
  showToast('Taux ajouté', 'success');
}

// ─── Simulateur ─────────────────────────────────────────────
function showCATSimulator() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">⚡ Simulateur d'Optimisation</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Entrez le montant total à placer. Le simulateur optimise la répartition selon vos objectifs (besoin mensuel, réserve, plafond FGDR) et les meilleurs taux disponibles.</p>
    <div class="form-grid">
      <div class="form-field"><label>Montant total à placer (€)</label><input id="sim-amount" type="number" placeholder="200000"></div>
      <div class="form-field"><label>Besoin mensuel (€)</label><input id="sim-monthly" type="number" value="${catManager.objectives.monthlyNeed}" placeholder="5000"></div>
      <div class="form-field"><label>Réserve liquidité (€)</label><input id="sim-reserve" type="number" value="${catManager.objectives.liquidityReserve}" placeholder="20000"></div>
      <div class="form-field"><label>Horizon max (mois)</label><select id="sim-horizon">
        <option value="12">12 mois</option><option value="24">24 mois</option><option value="36" selected>36 mois</option><option value="60">60 mois</option></select></div>
    </div>
    <button class="btn ai-glow lg" style="width:100%;margin-top:16px" onclick="runSimulation()">🚀 Lancer la simulation</button>
    <div id="sim-results" style="margin-top:20px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

function runSimulation() {
  const result = catManager.simulate(
    parseFloat(document.getElementById('sim-amount').value) || 0,
    {
      monthlyNeed: parseFloat(document.getElementById('sim-monthly').value) || 0,
      liquidityReserve: parseFloat(document.getElementById('sim-reserve').value) || 0,
      horizonMonths: parseInt(document.getElementById('sim-horizon').value) || 36,
    }
  );

  const container = document.getElementById('sim-results');
  if (result.error) { container.innerHTML = `<div class="alert-bar"><span>⚠️</span>${result.error}</div>`; return; }

  container.innerHTML = `
    <div class="stats-row" style="margin-bottom:16px">
      <div class="stat-card green"><div class="stat-label">Rendement Total</div><div class="stat-value">${formatNumber(result.totalInterest)}€</div></div>
      <div class="stat-card blue"><div class="stat-label">Taux Moyen Pondéré</div><div class="stat-value">${formatPct(result.weightedRate)}</div></div>
      <div class="stat-card orange"><div class="stat-label">Placé</div><div class="stat-value">${formatNumber(result.allocated)}€</div></div>
      <div class="stat-card purple"><div class="stat-label">Réserve</div><div class="stat-value">${formatNumber(result.reserve)}€</div></div>
    </div>
    <h3 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Répartition optimisée</h3>
    ${result.allocations.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="color:${a.purpose==='mensuel'?'var(--orange)':'var(--green)'}">${a.purpose==='mensuel'?'📅 Mensuel':'📈 Rendement'}</span>
          <strong style="color:var(--text-bright)">${a.bankName}</strong>
          <span>${a.durationMonths} mois</span>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <span style="font-family:var(--mono)">${formatNumber(a.amount)}€</span>
          <span style="color:var(--green);font-family:var(--mono)">${a.rate}%</span>
          <span style="color:var(--text-muted)">→ ${formatNumber(a.interest)}€</span>
        </div>
      </div>
    `).join('')}
  `;
}

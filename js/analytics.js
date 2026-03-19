// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Analytique & Simulations (V2 — smart annualization)
// ═══════════════════════════════════════════════════════════════

const CHART_COLORS = ['#3B82F6','#06D6A0','#FF006E','#FFBE0B','#8338EC','#E07A5F','#00B4D8','#D62828','#7209B7','#4361EE','#F77F00','#2EC4B6'];

function getPortfolioData() {
  const products = app.state.portfolio || [];
  const catDeposits = catManager?.deposits?.filter(d => d.status === 'active') || [];
  return { products, catDeposits };
}

// ─── SMART: Annualiser le coupon selon la fréquence ─────────
// Si coupon = 1.88% trimestriel → annualisé = 1.88 × 4 = 7.52%
// Si coupon = 3.5% semestriel → annualisé = 3.5 × 2 = 7%
// Si coupon = 0.5% mensuel → annualisé = 0.5 × 12 = 6%
// Si coupon = 7% annuel → reste 7%
function getAnnualizedRate(p) {
  const rate = parseFloat(p.coupon?.rate) || 0;
  if (rate === 0) return 0;
  const freq = (p.coupon?.frequency || '').toLowerCase().trim();

  // Detect multiplier from frequency
  if (freq.includes('trimestr') || freq.includes('quarter') || freq === 'trimestriel') {
    return rate * 4;
  }
  if (freq.includes('semestr') || freq.includes('semi')) {
    return rate * 2;
  }
  if (freq.includes('mensuel') || freq.includes('month')) {
    return rate * 12;
  }

  // Heuristic: if rate is very low (< 3%) and frequency mentions "trim" or type includes "memoire"
  // it's likely a per-period rate, not annual
  if (rate <= 3 && (p.coupon?.type || '').toLowerCase().includes('memoire')) {
    // Check if "trimestriel" appears anywhere in the product data
    const productText = JSON.stringify(p).toLowerCase();
    if (productText.includes('trimestr')) return rate * 4;
    if (productText.includes('semestr')) return rate * 2;
  }

  // Default: assume annual
  return rate;
}

function calcProductAnnualYield(p) {
  const amount = parseFloat(p.investedAmount) || 0;
  const annualRate = getAnnualizedRate(p);
  return Math.round(amount * annualRate / 100);
}

// ─── Projection flux de trésorerie sur N années ───────────
function projectCashflows(years) {
  const { products, catDeposits } = getPortfolioData();
  const now = new Date();
  const flows = [];
  for (let y = 0; y < years; y++) {
    const year = now.getFullYear() + y;
    let structured = 0, cat = 0;
    products.forEach(p => {
      const maturityYear = p.maturityDate ? new Date(p.maturityDate).getFullYear() : (now.getFullYear() + 20);
      if (year <= maturityYear) structured += calcProductAnnualYield(p);
    });
    catDeposits.forEach(d => {
      const matYear = d.maturityDate ? new Date(d.maturityDate).getFullYear() : (now.getFullYear() + 5);
      if (year <= matYear) cat += Math.round((parseFloat(d.amount)||0) * (parseFloat(d.rate)||0) / 100);
    });
    flows.push({ year, structured, cat, total: structured + cat });
  }
  return flows;
}

function getDistributionByBank() {
  const { products, catDeposits } = getPortfolioData();
  const map = {};
  products.forEach(p => { const bank = BANKS.find(b => b.id === p.bankId)?.name || p.bankId || 'Non assigné'; map[bank] = (map[bank]||0) + (parseFloat(p.investedAmount)||0); });
  catDeposits.forEach(d => { const bank = d.bankName || d.bankId || 'Non assigné'; map[bank] = (map[bank]||0) + (parseFloat(d.amount)||0); });
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
}
function getDistributionByEntity() {
  const { products } = getPortfolioData();
  const map = {};
  products.forEach(p => { const entity = p.entity ? (MY_ENTITIES.find(e => e.id === p.entity)?.name || p.entity) : 'Non assigné'; map[entity] = (map[entity]||0) + (parseFloat(p.investedAmount)||0); });
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
}
function getDistributionByType() {
  const { products, catDeposits } = getPortfolioData();
  const map = {};
  products.forEach(p => { const type = PRODUCT_TYPES.find(t => t.id === p.type)?.name || p.type || 'Autre'; map[type] = (map[type]||0) + (parseFloat(p.investedAmount)||0); });
  if (catDeposits.length > 0) { map['CAT + Parts Sociales'] = (map['CAT + Parts Sociales']||0) + catDeposits.reduce((s,d) => s + (parseFloat(d.amount)||0), 0); }
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
}
function getMaturityProfile() {
  const { products, catDeposits } = getPortfolioData();
  const map = {};
  products.forEach(p => { if (p.maturityDate) { const y = new Date(p.maturityDate).getFullYear(); if (!map[y]) map[y] = {structured:0,cat:0}; map[y].structured += parseFloat(p.investedAmount)||0; } });
  catDeposits.forEach(d => { if (d.maturityDate) { const y = new Date(d.maturityDate).getFullYear(); if (!map[y]) map[y] = {structured:0,cat:0}; map[y].cat += parseFloat(d.amount)||0; } });
  return Object.entries(map).map(([year, v]) => ({ year: parseInt(year), ...v, total: v.structured + v.cat })).sort((a,b) => a.year - b.year);
}

// ═══ RENDER ANALYTICS VIEW ══════════════════════════════════

function renderAnalytics(container) {
  const { products, catDeposits } = getPortfolioData();
  const totalStructured = products.reduce((s,p) => s + (parseFloat(p.investedAmount)||0), 0);
  const totalCAT = catDeposits.reduce((s,d) => s + (parseFloat(d.amount)||0), 0);
  const totalAll = totalStructured + totalCAT;
  const annualYieldStructured = products.reduce((s,p) => s + calcProductAnnualYield(p), 0);
  const catStats = catManager?.getStats() || {};
  const annualYieldCAT = catStats.totalInterest || 0;
  const annualYieldTotal = annualYieldStructured + annualYieldCAT;
  const avgYield = totalAll > 0 ? (annualYieldTotal / totalAll * 100) : 0;

  container.innerHTML = `
    <div class="stats-row">
      <div class="stat-card blue"><div class="stat-label">Total Investi</div><div class="stat-value">${formatNumber(totalAll)}€</div><div class="stat-sub">Structurés: ${formatNumber(totalStructured)}€ · CAT: ${formatNumber(totalCAT)}€</div></div>
      <div class="stat-card green"><div class="stat-label">Rendement Annuel Estimé</div><div class="stat-value">${formatNumber(annualYieldTotal)}€</div><div class="stat-sub">Structurés: ${formatNumber(annualYieldStructured)}€ · CAT: ${formatNumber(annualYieldCAT)}€</div></div>
      <div class="stat-card orange"><div class="stat-label">Rendement Moyen</div><div class="stat-value">${avgYield.toFixed(2).replace('.',',')}%</div><div class="stat-sub">Pondéré par montant</div></div>
      <div class="stat-card purple"><div class="stat-label">Nombre de Placements</div><div class="stat-value">${products.length + catDeposits.length}</div><div class="stat-sub">${products.length} structurés · ${catDeposits.length} CAT/PS</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📊</span><span class="fiche-section-title">Rendement Annuel par Produit</span></div><div class="fiche-section-body"><canvas id="chart-yield" height="280"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📈</span><span class="fiche-section-title">Projection Flux de Trésorerie (10 ans)</span></div><div class="fiche-section-body"><canvas id="chart-cashflow" height="280"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🏦</span><span class="fiche-section-title">Répartition par Banque</span></div><div class="fiche-section-body"><canvas id="chart-bank" height="280"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🎯</span><span class="fiche-section-title">Répartition par Type</span></div><div class="fiche-section-body"><canvas id="chart-type" height="280"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🏢</span><span class="fiche-section-title">Répartition par Entreprise</span></div><div class="fiche-section-body"><canvas id="chart-entity" height="280"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">⏳</span><span class="fiche-section-title">Profil de Maturité</span></div><div class="fiche-section-body"><canvas id="chart-maturity" height="280"></canvas></div></div>
    </div>
    <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">💰</span><span class="fiche-section-title">Détail Rendement par Produit</span></div>
      <div class="fiche-section-body">
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid var(--border);text-align:left">
            <th style="padding:8px 6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Produit</th>
            <th style="padding:8px 6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Entreprise</th>
            <th style="padding:8px 6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Montant</th>
            <th style="padding:8px 6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Coupon brut</th>
            <th style="padding:8px 6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Taux annualisé</th>
            <th style="padding:8px 6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Rendement/an</th>
            <th style="padding:8px 6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Maturité</th>
          </tr></thead>
          <tbody>
            ${products.map(p => {
              const entityInfo = MY_ENTITIES.find(e => e.id === p.entity);
              const annualRate = getAnnualizedRate(p);
              const rawRate = parseFloat(p.coupon?.rate) || 0;
              const freq = p.coupon?.frequency || '';
              const isAnnualized = annualRate !== rawRate;
              return `<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:8px 6px;color:var(--text-bright);font-weight:500">${p.name || '—'}</td>
                <td style="padding:8px 6px">${entityInfo ? `<span style="color:${entityInfo.color}">${entityInfo.icon} ${entityInfo.name}</span>` : '—'}</td>
                <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(p.investedAmount)}€</td>
                <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--text-muted)">${rawRate ? rawRate.toFixed(2).replace('.',',') + '% ' + (freq ? '<span style="font-size:10px;color:var(--text-dim)">/' + freq + '</span>' : '') : '—'}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--green);font-family:var(--mono);font-weight:600">${annualRate ? annualRate.toFixed(2).replace('.',',') + '%' : '—'}${isAnnualized ? ' <span style="font-size:9px;color:var(--orange)">×' + Math.round(annualRate/rawRate) + '</span>' : ''}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--green);font-family:var(--mono);font-weight:700">${formatNumber(calcProductAnnualYield(p))}€</td>
                <td style="padding:8px 6px;color:var(--text-muted)">${p.maturity || '—'}</td>
              </tr>`;
            }).join('')}
            ${catDeposits.map(d => {
              const interest = Math.round((parseFloat(d.amount)||0)*(parseFloat(d.rate)||0)/100);
              return `<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:8px 6px;color:var(--text-bright);font-weight:500">${d.productName || 'CAT ' + (d.durationMonths||'') + 'm'}</td>
                <td style="padding:8px 6px">—</td>
                <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td>
                <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--text-muted)">${d.rate ? formatPct(d.rate) : '—'}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--green);font-family:var(--mono);font-weight:600">${d.rate ? formatPct(d.rate) : '—'}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--green);font-family:var(--mono);font-weight:700">${formatNumber(interest)}€</td>
                <td style="padding:8px 6px;color:var(--text-muted)">${d.durationMonths ? d.durationMonths + ' mois' : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr style="border-top:2px solid var(--border);font-weight:700">
            <td style="padding:10px 6px;color:var(--text-bright)" colspan="2">TOTAL</td>
            <td style="padding:10px 6px;text-align:right;font-family:var(--mono);color:var(--text-bright)">${formatNumber(totalAll)}€</td>
            <td></td>
            <td style="padding:10px 6px;text-align:right;color:var(--green);font-family:var(--mono)">${avgYield.toFixed(2).replace('.',',')}%</td>
            <td style="padding:10px 6px;text-align:right;color:var(--green);font-family:var(--mono);font-weight:700">${formatNumber(annualYieldTotal)}€/an</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;
  setTimeout(() => renderAllCharts(), 50);
}

// ═══ CHART RENDERING ════════════════════════════════════════

const chartDefaults = { color: '#94A3B8', borderColor: 'rgba(148,163,184,0.1)', font: { family: 'Inter, system-ui, sans-serif', size: 11 } };

function renderAllCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = chartDefaults.color;
  Chart.defaults.font.family = chartDefaults.font.family;
  Chart.defaults.font.size = chartDefaults.font.size;
  renderYieldChart(); renderCashflowChart(); renderBankPieChart(); renderTypePieChart(); renderEntityPieChart(); renderMaturityChart();
}

function renderYieldChart() {
  const ctx = document.getElementById('chart-yield'); if (!ctx) return;
  const { products, catDeposits } = getPortfolioData();
  const items = [
    ...products.map(p => ({ name: (p.name||'Produit').substring(0,20), yield: calcProductAnnualYield(p) })),
    ...catDeposits.map(d => ({ name: (d.productName||'CAT').substring(0,20), yield: Math.round((parseFloat(d.amount)||0)*(parseFloat(d.rate)||0)/100) })),
  ].filter(i => i.yield > 0);
  new Chart(ctx, { type: 'bar', data: { labels: items.map(i => i.name), datasets: [{ label: 'Rendement annuel (€)', data: items.map(i => i.yield), backgroundColor: items.map((_,i) => CHART_COLORS[i%CHART_COLORS.length]+'CC'), borderRadius: 6, borderSkipped: false }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatNumber(c.raw)+'€/an' } } }, scales: { y: { grid: { color: chartDefaults.borderColor }, ticks: { callback: v => formatNumber(v)+'€' } }, x: { grid: { display: false } } } } });
}
function renderCashflowChart() {
  const ctx = document.getElementById('chart-cashflow'); if (!ctx) return;
  const flows = projectCashflows(10); let cumul = 0;
  const cumulData = flows.map(f => { cumul += f.total; return cumul; });
  new Chart(ctx, { type: 'bar', data: { labels: flows.map(f => f.year.toString()), datasets: [
    { label: 'Structurés', data: flows.map(f => f.structured), backgroundColor: '#3B82F6CC', borderRadius: 4, stack: 'stack' },
    { label: 'CAT/PS', data: flows.map(f => f.cat), backgroundColor: '#06D6A0CC', borderRadius: 4, stack: 'stack' },
    { label: 'Cumulé', data: cumulData, type: 'line', borderColor: '#FFBE0B', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#FFBE0B', yAxisID: 'y1' }
  ] }, options: { responsive: true, plugins: { tooltip: { callbacks: { label: c => c.dataset.label+': '+formatNumber(c.raw)+'€' } } },
    scales: { y: { stacked: true, grid: { color: chartDefaults.borderColor }, ticks: { callback: v => formatNumber(v)+'€' } }, y1: { position: 'right', grid: { display: false }, ticks: { callback: v => formatNumber(v)+'€' } }, x: { stacked: true, grid: { display: false } } } } });
}
function renderBankPieChart() {
  const ctx = document.getElementById('chart-bank'); if (!ctx) return; const data = getDistributionByBank();
  new Chart(ctx, { type: 'doughnut', data: { labels: data.map(d => d.name), datasets: [{ data: data.map(d => d.value), backgroundColor: data.map((_,i) => CHART_COLORS[i%CHART_COLORS.length]), borderWidth: 0 }] },
    options: { responsive: true, cutout: '55%', plugins: { tooltip: { callbacks: { label: c => c.label+': '+formatNumber(c.raw)+'€' } }, legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } } } } });
}
function renderTypePieChart() {
  const ctx = document.getElementById('chart-type'); if (!ctx) return; const data = getDistributionByType();
  new Chart(ctx, { type: 'doughnut', data: { labels: data.map(d => d.name), datasets: [{ data: data.map(d => d.value), backgroundColor: data.map((_,i) => CHART_COLORS[(i+3)%CHART_COLORS.length]), borderWidth: 0 }] },
    options: { responsive: true, cutout: '55%', plugins: { tooltip: { callbacks: { label: c => c.label+': '+formatNumber(c.raw)+'€' } }, legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } } } } });
}
function renderEntityPieChart() {
  const ctx = document.getElementById('chart-entity'); if (!ctx) return; const data = getDistributionByEntity();
  const colors = data.map(d => { const ent = MY_ENTITIES.find(e => e.name === d.name); return ent?.color || '#64748B'; });
  new Chart(ctx, { type: 'doughnut', data: { labels: data.map(d => d.name), datasets: [{ data: data.map(d => d.value), backgroundColor: colors, borderWidth: 0 }] },
    options: { responsive: true, cutout: '55%', plugins: { tooltip: { callbacks: { label: c => c.label+': '+formatNumber(c.raw)+'€' } }, legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } } } } });
}
function renderMaturityChart() {
  const ctx = document.getElementById('chart-maturity'); if (!ctx) return; const data = getMaturityProfile();
  new Chart(ctx, { type: 'bar', data: { labels: data.map(d => d.year.toString()), datasets: [
    { label: 'Structurés', data: data.map(d => d.structured), backgroundColor: '#3B82F6CC', borderRadius: 4, stack: 's' },
    { label: 'CAT/PS', data: data.map(d => d.cat), backgroundColor: '#06D6A0CC', borderRadius: 4, stack: 's' }
  ] }, options: { responsive: true, plugins: { tooltip: { callbacks: { label: c => c.dataset.label+': '+formatNumber(c.raw)+'€' } } },
    scales: { y: { stacked: true, grid: { color: chartDefaults.borderColor }, ticks: { callback: v => formatNumber(v)+'€' } }, x: { stacked: true, grid: { display: false } } } } });
}

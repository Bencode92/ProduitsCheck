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
  const { products, catDeposits } = getPortfolioData();
  const map = {};
  products.forEach(p => { const entity = p.entity ? (MY_ENTITIES.find(e => e.id === p.entity)?.name || p.entity) : 'Non assigné'; map[entity] = (map[entity]||0) + (parseFloat(p.investedAmount)||0); });
  catDeposits.forEach(d => { const entId = d.entity || (d.entityName === 'Caméleons' ? 'cameleons' : d.entityName === 'ByCam' ? 'bycam' : null); const entity = entId ? (MY_ENTITIES.find(e => e.id === entId)?.name || entId) : 'Non assigné'; map[entity] = (map[entity]||0) + (parseFloat(d.amount)||0); });
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

async function renderAnalytics(container) {
  // Ensure catManager is loaded before rendering
  try {
    if (typeof catManager !== 'undefined' && typeof catManager.load === 'function' && !catManager.deposits) {
      await catManager.load();
    }
  } catch(e) {}
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
    ${_renderMaturityTimeline(products, catDeposits)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📊</span><span class="fiche-section-title">Rendement Annuel par Produit</span></div><div class="fiche-section-body"><canvas id="chart-yield" height="160"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📈</span><span class="fiche-section-title">Projection Flux de Trésorerie (10 ans)</span></div><div class="fiche-section-body"><canvas id="chart-cashflow" height="160"></canvas></div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🏦</span><span class="fiche-section-title">Par Banque</span></div><div class="fiche-section-body"><canvas id="chart-bank" height="150"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🎯</span><span class="fiche-section-title">Par Type</span></div><div class="fiche-section-body"><canvas id="chart-type" height="150"></canvas></div></div>
      <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🏢</span><span class="fiche-section-title">Par Entreprise</span></div><div class="fiche-section-body"><canvas id="chart-entity" height="150"></canvas></div></div>
    </div>
    `;
  setTimeout(() => renderAllCharts(), 50);
}

// ═══ MATURITY TIMELINE TABLE ═══════════════════════════════
function _renderMaturityTimeline(products, catDeposits) {
  // Collect all assets with maturity dates
  var assets = [];
  catDeposits.forEach(function(d) {
    if (d.status !== 'active' || !d.maturityDate) return;
    var mat = new Date(d.maturityDate);
    var amount = parseFloat(d.amount) || 0;
    var rate = parseFloat(d.rate) || 0;
    var annualReturn = Math.round(amount * rate / 100);
    assets.push({
      name: d.productName || 'CAT',
      type: 'CAT',
      typeColor: 'var(--orange)',
      entity: d.entity || (d.entityName === 'Caméleons' ? 'cameleons' : d.entityName === 'ByCam' ? 'bycam' : d.entityName) || '?',
      bank: d.bankName || '?',
      amount: amount,
      rate: rate,
      annualReturn: annualReturn,
      maturityDate: mat,
      maturityYear: mat.getFullYear(),
      maturityLabel: mat.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
    });
  });
  products.forEach(function(p) {
    var amount = parseFloat(p.investedAmount) || 0;
    if (amount <= 0) return;
    var isLiquidity = p.grading && p.grading.grade === '-';
    var matDate = p.maturityDate ? new Date(p.maturityDate) : null;
    if (!matDate && p.maturity) {
      var yMatch = (p.maturity + '').match(/(\d+)/);
      if (yMatch) {
        matDate = new Date();
        matDate.setFullYear(matDate.getFullYear() + parseInt(yMatch[1]));
      }
    }
    // Liquidity products (Bond 12M etc.) — include with no maturity, rate 0%
    if (!matDate && !isLiquidity) return;
    var rate = isLiquidity ? 0 : getAnnualizedRate(p);
    var annualReturn = Math.round(amount * rate / 100);
    var grade = (p.grading && p.grading.grade) || '?';
    assets.push({
      name: (p.name || 'Structuré').substring(0, 40),
      type: isLiquidity ? 'Liquidité' : 'Structuré',
      typeColor: isLiquidity ? '#94A3B8' : 'var(--cyan)',
      grade: isLiquidity ? '$' : grade,
      entity: p.entity || '?',
      bank: p.bankId || '?',
      amount: amount,
      rate: rate,
      annualReturn: annualReturn,
      maturityDate: matDate || new Date('2099-12-31'),
      maturityYear: matDate ? matDate.getFullYear() : null,
      maturityLabel: matDate ? matDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : 'Permanent',
      isLiquidity: isLiquidity
    });
  });

  if (assets.length === 0) return '';

  // Sort by maturity date
  assets.sort(function(a, b) { return a.maturityDate - b.maturityDate; });

  // Group by year for summary
  var byYear = {};
  assets.forEach(function(a) {
    if (a.isLiquidity || !a.maturityYear) return; // exclude liquidity from year groups
    var yr = a.maturityYear;
    if (!byYear[yr]) byYear[yr] = { amount: 0, return: 0, count: 0 };
    byYear[yr].amount += a.amount;
    byYear[yr].return += a.annualReturn;
    byYear[yr].count++;
  });

  var now = new Date();
  var fmt = typeof formatNumber === 'function' ? formatNumber : function(n) { return String(Math.round(n)); };

  // Build HTML
  var h = '<div class="fiche-section" style="margin-top:16px"><div class="fiche-section-header"><span class="fiche-section-icon">📅</span><span class="fiche-section-title">Échéancier des Maturités (ALM)</span></div>';
  h += '<div class="fiche-section-body">';

  // Summary by year
  var years = Object.keys(byYear).sort();
  h += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
  years.forEach(function(yr) {
    var y = byYear[yr];
    var isNear = parseInt(yr) <= now.getFullYear() + 1;
    var isEmpty = y.count === 0;
    h += '<div style="flex:1;min-width:100px;padding:10px;border-radius:8px;border:1px solid ' + (isNear ? 'rgba(255,182,39,0.3)' : 'var(--border)') + ';background:' + (isNear ? 'rgba(255,182,39,0.04)' : 'var(--bg-card)') + ';text-align:center">';
    h += '<div style="font-size:16px;font-weight:700;color:var(--text-bright)">' + yr + '</div>';
    h += '<div style="font-size:12px;font-family:var(--mono);color:var(--cyan);font-weight:600">' + fmt(y.amount) + '€</div>';
    h += '<div style="font-size:10px;color:var(--green)">+' + fmt(y.return) + '€/an</div>';
    h += '<div style="font-size:9px;color:var(--text-dim)">' + y.count + ' placement' + (y.count > 1 ? 's' : '') + '</div>';
    h += '</div>';
  });
  // Check for "gap years"
  var minYear = parseInt(years[0]), maxYear = parseInt(years[years.length - 1]);
  for (var yr = minYear; yr <= maxYear; yr++) {
    if (!byYear[yr]) {
      h += '<div style="flex:1;min-width:100px;padding:10px;border-radius:8px;border:1px dashed var(--red);background:rgba(239,35,60,0.04);text-align:center">';
      h += '<div style="font-size:16px;font-weight:700;color:var(--red)">' + yr + '</div>';
      h += '<div style="font-size:11px;color:var(--red)">Aucune échéance</div>';
      h += '<div style="font-size:9px;color:var(--text-dim)">Trou de maturité</div>';
      h += '</div>';
    }
  }
  h += '</div>';

  // Detailed table
  h += '<table style="width:100%;font-size:11px;border-collapse:collapse">';
  h += '<thead><tr style="border-bottom:2px solid var(--border);text-align:left">';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Produit</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Type</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Entité</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Banque</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Montant</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Taux</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Rdt/an</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase">Échéance</th>';
  h += '<th style="padding:6px;color:var(--text-dim);font-size:10px;text-transform:uppercase;text-align:right">Restant</th>';
  h += '</tr></thead><tbody>';

  var totalAmount = 0, totalReturn = 0;
  assets.forEach(function(a, i) {
    var bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
    var monthsLeft = Math.max(0, Math.round((a.maturityDate - now) / (1000 * 60 * 60 * 24 * 30)));
    var urgencyColor = monthsLeft <= 6 ? 'var(--red)' : monthsLeft <= 12 ? 'var(--orange)' : 'var(--text-muted)';
    var gradeHtml = a.grade ? ' <span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:3px;background:' + ({A:'#06D6A022',B:'#4ECDC422',C:'#FFB62722',D:'#E85D0422',F:'#EF233C22'}[a.grade]||'#88888822') + ';color:' + ({A:'#06D6A0',B:'#4ECDC4',C:'#FFB627',D:'#E85D04',F:'#EF233C'}[a.grade]||'#888') + ';font-weight:700;font-size:9px">' + a.grade + '</span>' : '';
    h += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)">';
    h += '<td style="padding:6px;color:var(--text-bright);font-weight:500">' + a.name + gradeHtml + '</td>';
    h += '<td style="padding:6px"><span style="color:' + a.typeColor + ';font-weight:600;font-size:10px">' + a.type + '</span></td>';
    h += '<td style="padding:6px;font-size:10px;color:' + (a.entity === 'bycam' || a.entity === 'ByCam' ? 'var(--cyan)' : '#A855F7') + '">' + (a.entity === 'bycam' ? '🏢 ByCam' : a.entity === 'cameleons' ? '🦎 Cam.' : (a.entity || '?')) + '</td>';
    h += '<td style="padding:6px;color:var(--text-muted)">' + a.bank + '</td>';
    h += '<td style="padding:6px;text-align:right;font-family:var(--mono)">' + fmt(a.amount) + '€</td>';
    h += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:var(--green)">' + a.rate.toFixed(2) + '%</td>';
    h += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:var(--green);font-weight:600">+' + fmt(a.annualReturn) + '€</td>';
    h += '<td style="padding:6px;color:' + urgencyColor + ';font-weight:600">' + a.maturityLabel + '</td>';
    h += '<td style="padding:6px;text-align:right;color:' + urgencyColor + ';font-size:10px">' + monthsLeft + ' mois</td>';
    h += '</tr>';
    totalAmount += a.amount;
    totalReturn += a.annualReturn;
  });

  h += '</tbody><tfoot><tr style="border-top:2px solid var(--border);font-weight:700">';
  h += '<td style="padding:8px 6px;color:var(--text-bright)" colspan="4">TOTAL</td>';
  h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--text-bright)">' + fmt(totalAmount) + '€</td>';
  h += '<td></td>';
  h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green);font-weight:700">+' + fmt(totalReturn) + '€/an</td>';
  h += '<td colspan="2"></td>';
  h += '</tr></tfoot></table>';
  h += '</div></div>';
  return h;
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

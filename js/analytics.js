// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Analytique & Simulations (V2 — smart annualization)
// ═══════════════════════════════════════════════════════════════

const CHART_COLORS = ['#3B82F6','#06D6A0','#FF006E','#FFBE0B','#8338EC','#E07A5F','#00B4D8','#D62828','#7209B7','#4361EE','#F77F00','#2EC4B6'];

function getPortfolioData() {
  const products = app.state.portfolio || [];
  const catDeposits = catManager?.deposits?.filter(d => d.status === 'active') || [];
  return { products, catDeposits };
}

// ─── Get current applicable rate for a CAT deposit (progressive schedule) ───
function _getCurrentCATRate(deposit) {
  var rate = parseFloat(deposit.rate) || 0;
  var schedule = deposit.rateSchedule;
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return rate;

  var now = new Date();
  // Find current period in schedule
  for (var i = 0; i < schedule.length; i++) {
    var s = schedule[i];
    var from = s.from ? new Date(s.from) : null;
    var to = s.to ? new Date(s.to) : null;
    if (from && to && now >= from && now <= to) {
      return parseFloat(s.rate) || rate;
    }
    // Match by fromMonth if no date match
    if (!from && s.fromMonth !== undefined && deposit.startDate) {
      var start = new Date(deposit.startDate);
      var monthsElapsed = Math.round((now - start) / (30.44 * 24 * 60 * 60 * 1000));
      if (monthsElapsed >= (s.fromMonth - 1) && monthsElapsed < (s.toMonth || 999)) {
        return parseFloat(s.rate) || rate;
      }
    }
  }

  // If past all periods, use last period rate
  var lastPeriod = schedule[schedule.length - 1];
  if (lastPeriod && lastPeriod.to && now > new Date(lastPeriod.to)) {
    return parseFloat(lastPeriod.rate) || rate;
  }

  // If before all periods, use first period rate
  var firstPeriod = schedule[0];
  if (firstPeriod && firstPeriod.from && now < new Date(firstPeriod.from)) {
    return parseFloat(firstPeriod.rate) || rate;
  }

  return rate;
}

// ─── SMART: Annualiser le coupon selon la fréquence ─────────
// Si coupon = 1.88% trimestriel → annualisé = 1.88 × 4 = 7.52%
// Si coupon = 3.5% semestriel → annualisé = 3.5 × 2 = 7%
// Si coupon = 0.5% mensuel → annualisé = 0.5 × 12 = 6%
// Si coupon = 7% annuel → reste 7%
// Délègue à la SOURCE UNIQUE (scoring.annualizedCoupon) pour que l'Analytique et le
// Cockpit/comparateur affichent rigoureusement le même rendement. Fallback local si
// le moteur scoring n'est pas encore chargé.
function getAnnualizedRate(p) {
  if (typeof scoring !== 'undefined' && scoring.annualizedCoupon) {
    return scoring.annualizedCoupon(p);
  }
  const rate = parseFloat(p.coupon?.rate) || 0;
  if (rate === 0) return 0;
  const freq = (p.coupon?.frequency || '').toLowerCase().trim();
  if (freq.includes('trimestr') || freq.includes('quarter')) return rate * 4;
  if (freq.includes('semestr') || freq.includes('semi')) return rate * 2;
  if (freq.includes('mensuel') || freq.includes('month')) return rate * 12;
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
      if (year <= matYear) cat += Math.round((parseFloat(d.amount)||0) * _getCurrentCATRate(d) / 100);
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
  // Compute CAT annual yield using CURRENT progressive rate (not average)
  const annualYieldCAT = catDeposits.reduce((s,d) => s + Math.round((parseFloat(d.amount)||0) * _getCurrentCATRate(d) / 100), 0);
  const annualYieldTotal = annualYieldStructured + annualYieldCAT;
  const avgYield = totalAll > 0 ? (annualYieldTotal / totalAll * 100) : 0;

  // ─── Compute per-entity breakdown ───
  const IS_RATE = 0.25;
  const netYieldTotal = Math.round(annualYieldTotal * (1 - IS_RATE));
  // Drag de frais = droits de garde + marge embarquée amortie (vue ÉCONOMIQUE, identique
  // au Cockpit → les deux chiffres de rendement net concordent enfin).
  let feeDragTotal = 0, feesDocAmt = 0;
  products.forEach(p => {
    const a = parseFloat(p.investedAmount) || 0;
    if (typeof scoring !== 'undefined' && scoring.getFeeDrag) {
      const d = scoring.getFeeDrag(p);
      feeDragTotal += a * d.economicDragPct / 100;
      if (d.documented) feesDocAmt += a;
    }
  });
  const netAfterFeesTotal = Math.round(netYieldTotal - feeDragTotal);
  const feesDocPct = totalStructured > 0 ? feesDocAmt / totalStructured * 100 : 0;
  const netAfterFeesPct = totalAll > 0 ? (netAfterFeesTotal / totalAll * 100) : 0;
  const entities = _computeEntityBreakdown(products, catDeposits);
  const fgdr = _computeFGDRExposure(products, catDeposits);
  const events = _computeNextEvents(products, catDeposits);
  const sensitivity = _computeRateSensitivity(products);

  // ─── Duration moyenne pondérée ───
  let durNum = 0, durDen = 0;
  products.forEach(p => { const a = parseFloat(p.investedAmount)||0; const y = parseFloat(p.maturityYears)||0; if(a>0&&y>0){durNum+=a*y;durDen+=a;} });
  catDeposits.forEach(d => { const a = parseFloat(d.amount)||0; const mat = d.maturityDate ? Math.max(0,(new Date(d.maturityDate)-new Date())/(365.25*24*3600*1000)) : 2; if(a>0){durNum+=a*mat;durDen+=a;} });
  const avgDuration = durDen > 0 ? durNum / durDen : 0;

  container.innerHTML = `
    ${typeof renderExecCockpit === 'function' ? renderExecCockpit() : ''}
    <div class="stats-row" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
      <div class="stat-card blue"><div class="stat-label">Total Investi</div><div class="stat-value">${formatNumber(totalAll)}€</div><div class="stat-sub">Structurés: ${formatNumber(totalStructured)}€ · CAT: ${formatNumber(totalCAT)}€</div></div>
      <div class="stat-card green"><div class="stat-label">Rendement Annuel Brut</div><div class="stat-value">${formatNumber(annualYieldTotal)}€</div><div class="stat-sub">Coupon annualisé, si tous coupons versés · Struct.: ${formatNumber(annualYieldStructured)}€ · CAT: ${formatNumber(annualYieldCAT)}€</div></div>
      <div class="stat-card" style="border-left:3px solid #06D6A0"><div class="stat-label">Rendement Net (IS + garde + marge)</div><div class="stat-value" style="color:#06D6A0">${formatNumber(netAfterFeesTotal)}€</div><div class="stat-sub">${netAfterFeesPct.toFixed(2).replace('.',',')}% net · ${formatNumber(netYieldTotal)}€ hors frais${feesDocPct < 80 ? ` · <span style="color:#D97706;font-weight:600">⚠ frais ${Math.round(feesDocPct)}%</span>` : ''}</div></div>
      <div class="stat-card" style="border-left:3px solid #8338EC"><div class="stat-label">Duration Moyenne</div><div class="stat-value">${avgDuration.toFixed(1)} ans</div><div class="stat-sub">${products.length + catDeposits.length} placements</div></div>
      <div class="stat-card" style="border-left:3px solid ${fgdr.alert ? '#EF233C' : '#06D6A0'}"><div class="stat-label">Couverture FGDR</div><div class="stat-value">${fgdr.coveredPct}%</div><div class="stat-sub">${fgdr.alert ? '⚠ ' + fgdr.alertCount + ' dépassement(s)' : '✓ Couvert'}</div></div>
    </div>

    ${_renderEntityTables(entities, IS_RATE)}
    ${_renderFGDRSection(fgdr)}
    ${_renderNextEvents(events)}
    ${_renderRateSensitivity(sensitivity)}
    ${_renderMaturityTimeline(products, catDeposits)}
    ${_renderStressTest(products, catDeposits)}
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

// ═══ ENTITY BREAKDOWN ═══════════════════════════════════════
function _computeEntityBreakdown(products, catDeposits) {
  var entities = {};
  products.forEach(function(p) {
    var ent = p.envelope || p.entity || 'non_assigne';
    if (!entities[ent]) entities[ent] = { products: [], catDeposits: [], totalInvested: 0, totalYield: 0 };
    entities[ent].products.push(p);
    entities[ent].totalInvested += parseFloat(p.investedAmount) || 0;
    entities[ent].totalYield += calcProductAnnualYield(p);
  });
  catDeposits.forEach(function(d) {
    var ent = d.entity || (d.entityName === 'Caméleons' ? 'cameleons' : d.entityName === 'ByCam' ? 'bycam' : 'non_assigne');
    if (!entities[ent]) entities[ent] = { products: [], catDeposits: [], totalInvested: 0, totalYield: 0 };
    entities[ent].catDeposits.push(d);
    var amt = parseFloat(d.amount) || 0;
    entities[ent].totalInvested += amt;
    entities[ent].totalYield += Math.round(amt * _getCurrentCATRate(d) / 100);
  });
  return entities;
}

function _renderEntityTables(entities, isRate) {
  var fmt = typeof formatNumber === 'function' ? formatNumber : function(n) { return String(Math.round(n)); };
  var entNames = { bycam: '🏢 ByCam', cameleons: '🦎 Caméléons Com Mark', non_assigne: '❓ Non assigné' };
  var entColors = { bycam: '#3B82F6', cameleons: '#A855F7', non_assigne: '#94A3B8' };
  var h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';

  Object.keys(entities).forEach(function(ent) {
    var e = entities[ent];
    var name = entNames[ent] || ent;
    var color = entColors[ent] || '#64748B';
    var netYield = Math.round(e.totalYield * (1 - isRate));
    var avgRate = e.totalInvested > 0 ? (e.totalYield / e.totalInvested * 100) : 0;

    h += '<div class="fiche-section"><div class="fiche-section-header" style="border-color:' + color + '"><span style="color:' + color + ';font-weight:700">' + name + '</span>';
    h += '<span style="font-size:11px;color:var(--text-muted);margin-left:auto">' + fmt(e.totalInvested) + '€ investi</span></div>';
    h += '<div class="fiche-section-body">';

    // Summary row
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">';
    h += '<div style="text-align:center;padding:8px;background:rgba(59,130,246,0.05);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Rendement brut</div><div style="font-size:16px;font-weight:700;color:var(--green)">+' + fmt(e.totalYield) + '€/an</div></div>';
    h += '<div style="text-align:center;padding:8px;background:rgba(6,214,160,0.05);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Net IS (25%)</div><div style="font-size:16px;font-weight:700;color:#06D6A0">+' + fmt(netYield) + '€/an</div></div>';
    h += '<div style="text-align:center;padding:8px;background:rgba(131,56,236,0.05);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Taux moyen</div><div style="font-size:16px;font-weight:700;color:' + color + '">' + avgRate.toFixed(2) + '%</div></div>';
    h += '</div>';

    // Product list
    h += '<table style="width:100%;font-size:11px;border-collapse:collapse"><thead><tr style="border-bottom:1px solid var(--border)">';
    h += '<th style="padding:4px 6px;text-align:left;color:var(--text-dim);font-size:10px">Produit</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim);font-size:10px">Montant</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim);font-size:10px">Taux</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim);font-size:10px">Rdt brut/an</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim);font-size:10px">Net IS/an</th>';
    h += '</tr></thead><tbody>';

    e.products.forEach(function(p) {
      var amt = parseFloat(p.investedAmount) || 0;
      var rate = getAnnualizedRate(p);
      var yld = calcProductAnnualYield(p);
      var grade = p.grading ? p.grading.grade : '';
      var gradeColor = {A:'#06D6A0',B:'#4ECDC4',C:'#FFB627',D:'#E85D04',F:'#EF233C'}[grade] || '#888';
      h += '<tr style="border-bottom:1px solid var(--border)">';
      h += '<td style="padding:4px 6px">' + (p.name || '?').substring(0, 30) + (grade ? ' <span style="color:' + gradeColor + ';font-weight:700;font-size:10px">' + grade + '</span>' : '') + '</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono)">' + fmt(amt) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;color:var(--green)">' + rate.toFixed(2) + '%</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+' + fmt(yld) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:#06D6A0">+' + fmt(Math.round(yld * (1 - isRate))) + '€</td>';
      h += '</tr>';
    });
    e.catDeposits.forEach(function(d) {
      var amt = parseFloat(d.amount) || 0;
      var rate = _getCurrentCATRate(d);
      var yld = Math.round(amt * rate / 100);
      h += '<tr style="border-bottom:1px solid var(--border)">';
      h += '<td style="padding:4px 6px">🏦 ' + (d.productName || 'CAT').substring(0, 30) + '</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono)">' + fmt(amt) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;color:var(--orange)">' + rate.toFixed(2) + '%</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+' + fmt(yld) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:#06D6A0">+' + fmt(Math.round(yld * (1 - isRate))) + '€</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div></div>';
  });

  h += '</div>';
  return h;
}

// ═══ FGDR EXPOSURE ══════════════════════════════════════════
function _computeFGDRExposure(products, catDeposits) {
  var FGDR_LIMIT = 100000;
  var banks = {};
  // Only CAT and deposits are covered by FGDR, not structured products (which are debt securities)
  catDeposits.forEach(function(d) {
    var bank = d.bankName || d.bankId || '?';
    var ent = d.entity || (d.entityName === 'Caméleons' ? 'cameleons' : 'bycam');
    var key = bank + '|' + ent;
    if (!banks[key]) banks[key] = { bank: bank, entity: ent, amount: 0 };
    banks[key].amount += parseFloat(d.amount) || 0;
  });
  var entries = Object.values(banks);
  var totalCovered = 0, totalExposed = 0, alertCount = 0;
  entries.forEach(function(e) {
    e.covered = Math.min(e.amount, FGDR_LIMIT);
    e.excess = Math.max(0, e.amount - FGDR_LIMIT);
    e.ratio = e.amount / FGDR_LIMIT;
    totalCovered += e.covered;
    totalExposed += e.amount;
    if (e.excess > 0) alertCount++;
  });
  // Also track structured products (issuer risk, not FGDR but important)
  var issuerExposure = {};
  products.forEach(function(p) {
    var emitter = p.emitter || BANKS.find(function(b) { return b.id === p.bankId; })?.name || p.bankId || '?';
    if (!issuerExposure[emitter]) issuerExposure[emitter] = 0;
    issuerExposure[emitter] += parseFloat(p.investedAmount) || 0;
  });
  return {
    entries: entries,
    issuerExposure: issuerExposure,
    coveredPct: totalExposed > 0 ? Math.round(totalCovered / totalExposed * 100) : 100,
    alert: alertCount > 0,
    alertCount: alertCount,
    totalExposed: totalExposed
  };
}

function _renderFGDRSection(fgdr) {
  var fmt = typeof formatNumber === 'function' ? formatNumber : function(n) { return String(Math.round(n)); };
  var h = '<div class="fiche-section" style="margin-bottom:16px"><div class="fiche-section-header"><span class="fiche-section-icon">🏦</span><span class="fiche-section-title">Exposition FGDR & Concentration Émetteur</span></div>';
  h += '<div class="fiche-section-body">';

  if (fgdr.entries.length > 0) {
    h += '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Dépôts CAT — Garantie FGDR (100K€ / banque / entité)</div>';
    h += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:12px"><thead><tr style="border-bottom:2px solid var(--border)">';
    h += '<th style="padding:5px 6px;text-align:left;color:var(--text-dim);font-size:10px">Banque</th>';
    h += '<th style="padding:5px 6px;text-align:left;color:var(--text-dim);font-size:10px">Entité</th>';
    h += '<th style="padding:5px 6px;text-align:right;color:var(--text-dim);font-size:10px">Montant</th>';
    h += '<th style="padding:5px 6px;text-align:right;color:var(--text-dim);font-size:10px">Couvert</th>';
    h += '<th style="padding:5px 6px;text-align:right;color:var(--text-dim);font-size:10px">Excédent</th>';
    h += '<th style="padding:5px 6px;text-align:center;color:var(--text-dim);font-size:10px">Statut</th>';
    h += '</tr></thead><tbody>';
    fgdr.entries.sort(function(a, b) { return b.amount - a.amount; }).forEach(function(e) {
      var entLabel = e.entity === 'bycam' ? '🏢 ByCam' : e.entity === 'cameleons' ? '🦎 Cam.' : e.entity;
      var statusColor = e.excess > 0 ? 'var(--red)' : 'var(--green)';
      var statusIcon = e.excess > 0 ? '⚠ ' + e.ratio.toFixed(1) + '×' : '✅';
      h += '<tr style="border-bottom:1px solid var(--border)">';
      h += '<td style="padding:5px 6px;font-weight:500">' + e.bank + '</td>';
      h += '<td style="padding:5px 6px;font-size:10px">' + entLabel + '</td>';
      h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono)">' + fmt(e.amount) + '€</td>';
      h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:var(--green)">' + fmt(e.covered) + '€</td>';
      h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + (e.excess > 0 ? 'var(--red)' : 'var(--text-dim)') + '">' + (e.excess > 0 ? fmt(e.excess) + '€' : '—') + '</td>';
      h += '<td style="padding:5px 6px;text-align:center;color:' + statusColor + ';font-weight:600">' + statusIcon + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
  }

  // Issuer concentration for structured products
  var issuers = Object.entries(fgdr.issuerExposure).sort(function(a, b) { return b[1] - a[1]; });
  if (issuers.length > 0) {
    var totalStr = issuers.reduce(function(s, e) { return s + e[1]; }, 0);
    h += '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Structurés — Concentration émetteur (risque crédit)</div>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    issuers.forEach(function(e) {
      var pct = totalStr > 0 ? (e[1] / totalStr * 100) : 0;
      var color = pct > 40 ? 'var(--red)' : pct > 25 ? 'var(--orange)' : 'var(--green)';
      h += '<div style="padding:6px 10px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border);font-size:11px">';
      h += '<span style="font-weight:600">' + e[0].substring(0, 25) + '</span> ';
      h += '<span style="font-family:var(--mono)">' + fmt(e[1]) + '€</span> ';
      h += '<span style="color:' + color + ';font-weight:700">' + pct.toFixed(0) + '%</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  h += '</div></div>';
  return h;
}

// ═══ NEXT EVENTS ════════════════════════════════════════════
function _computeNextEvents(products, catDeposits) {
  var now = new Date();
  var events = [];
  var threeMonths = new Date(now.getTime() + 90 * 24 * 3600 * 1000);

  // CAT maturities
  catDeposits.forEach(function(d) {
    if (!d.maturityDate || d.status !== 'active') return;
    var mat = new Date(d.maturityDate);
    if (mat > now && mat <= threeMonths) {
      events.push({ date: mat, type: 'maturity_cat', icon: '🏦', color: 'var(--green)', label: (d.productName || 'CAT') + ' — échéance', detail: formatNumber(parseFloat(d.amount) || 0) + '€ disponible' });
    }
  });

  // Structured products: autocall dates, coupon observations
  products.forEach(function(p) {
    var cs = (p.earlyRedemption && p.earlyRedemption.callSchedule) || p.callSchedule || [];
    cs.forEach(function(c) {
      var dt = c.date ? _parseDate(c.date) : null;
      if (dt && dt > now && dt <= threeMonths) {
        var isAutocall = (p.earlyRedemption && p.earlyRedemption.type === 'autocall');
        events.push({ date: dt, type: isAutocall ? 'autocall' : 'callable', icon: isAutocall ? '⚡' : '📅', color: isAutocall ? 'var(--orange)' : 'var(--purple)', label: (p.name || 'Produit').substring(0, 35) + ' — ' + (isAutocall ? 'observation autocall' : 'date de rappel'), detail: (c.amount || 100) + '% si call' });
      }
    });
    // Coupon observation for rate products
    if (p.coupon && p.coupon.type === 'conditionnel' && p.coupon.trigger) {
      // Annual observation around subscription date
      var sub = p.receivedDate ? new Date(p.receivedDate) : null;
      if (sub) {
        var nextObs = new Date(sub);
        nextObs.setFullYear(now.getFullYear());
        if (nextObs < now) nextObs.setFullYear(now.getFullYear() + 1);
        if (nextObs <= threeMonths) {
          events.push({ date: nextObs, type: 'coupon_obs', icon: '💰', color: 'var(--cyan)', label: (p.name || 'Produit').substring(0, 35) + ' — observation coupon', detail: 'Coupon ' + p.coupon.rate + '% si trigger ≤ ' + p.coupon.trigger + '%' });
        }
      }
    }
  });

  events.sort(function(a, b) { return a.date - b.date; });
  return events;
}

function _parseDate(str) {
  if (!str) return null;
  // Handle dd/mm/yyyy
  var m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  // Handle yyyy-mm-dd or standard
  var d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function _renderNextEvents(events) {
  if (events.length === 0) return '';
  var h = '<div class="fiche-section" style="margin-bottom:16px"><div class="fiche-section-header"><span class="fiche-section-icon">📅</span><span class="fiche-section-title">Prochains Événements (90 jours)</span></div>';
  h += '<div class="fiche-section-body">';
  events.forEach(function(ev) {
    var dateStr = ev.date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    h += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">';
    h += '<div style="font-size:14px">' + ev.icon + '</div>';
    h += '<div style="min-width:50px;font-size:11px;font-weight:700;color:' + ev.color + '">' + dateStr + '</div>';
    h += '<div style="flex:1;font-size:12px;color:var(--text-bright)">' + ev.label + '</div>';
    h += '<div style="font-size:11px;color:var(--text-muted)">' + ev.detail + '</div>';
    h += '</div>';
  });
  h += '</div></div>';
  return h;
}

// ═══ RATE SENSITIVITY ═══════════════════════════════════════
function _computeRateSensitivity(products) {
  var rateProducts = products.filter(function(p) {
    return p.coupon && p.coupon.type === 'conditionnel' && p.coupon.trigger && p.coupon.trigger < 10;
  });
  if (rateProducts.length === 0) return null;

  // Compute impact at different TEC10 levels
  var levels = [3.5, 4.0, 4.4, 4.6, 5.0, 5.5];
  var results = levels.map(function(level) {
    var totalLost = 0;
    var affected = [];
    rateProducts.forEach(function(p) {
      var trigger = parseFloat(p.coupon.trigger) || 0;
      var rate = getAnnualizedRate(p);
      var amt = parseFloat(p.investedAmount) || 0;
      if (level > trigger) {
        var couponLost = Math.round(amt * rate / 100);
        totalLost += couponLost;
        affected.push({ name: (p.name || '?').substring(0, 25), trigger: trigger, lost: couponLost });
      }
    });
    return { level: level, totalLost: totalLost, affected: affected };
  });

  return { products: rateProducts, results: results };
}

function _renderRateSensitivity(sensitivity) {
  if (!sensitivity) return '';
  var fmt = typeof formatNumber === 'function' ? formatNumber : function(n) { return String(Math.round(n)); };
  var h = '<div class="fiche-section" style="margin-bottom:16px"><div class="fiche-section-header"><span class="fiche-section-icon">📉</span><span class="fiche-section-title">Sensibilité Taux — Impact sur les coupons conditionnels</span></div>';
  h += '<div class="fiche-section-body">';
  h += '<div style="display:grid;grid-template-columns:repeat(' + sensitivity.results.length + ',1fr);gap:6px;margin-bottom:10px">';
  sensitivity.results.forEach(function(r) {
    var color = r.totalLost === 0 ? 'var(--green)' : r.totalLost < 10000 ? 'var(--orange)' : 'var(--red)';
    var bg = r.totalLost === 0 ? 'rgba(6,214,160,0.05)' : r.totalLost < 10000 ? 'rgba(255,190,11,0.05)' : 'rgba(239,35,60,0.05)';
    h += '<div style="text-align:center;padding:8px;border-radius:6px;background:' + bg + ';border:1px solid ' + (r.totalLost === 0 ? 'rgba(6,214,160,0.2)' : r.totalLost < 10000 ? 'rgba(255,190,11,0.2)' : 'rgba(239,35,60,0.2)') + '">';
    h += '<div style="font-size:10px;color:var(--text-dim)">TEC10 =</div>';
    h += '<div style="font-size:14px;font-weight:700;color:var(--text-bright)">' + r.level.toFixed(1) + '%</div>';
    h += '<div style="font-size:12px;font-weight:600;color:' + color + '">' + (r.totalLost === 0 ? '✓ OK' : '-' + fmt(r.totalLost) + '€/an') + '</div>';
    if (r.affected.length > 0) {
      h += '<div style="font-size:9px;color:var(--text-dim);margin-top:2px">' + r.affected.length + ' produit(s)</div>';
    }
    h += '</div>';
  });
  h += '</div>';

  // Detail: which products are affected at each level
  var maxLost = sensitivity.results[sensitivity.results.length - 1];
  if (maxLost.affected.length > 0) {
    h += '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">';
    h += '<strong>Produits exposés :</strong> ';
    var seen = {};
    maxLost.affected.forEach(function(a) {
      if (seen[a.name]) return;
      seen[a.name] = true;
      h += a.name + ' (trigger ' + a.trigger + '%, coupon ' + fmt(a.lost) + '€/an) · ';
    });
    h += '</div>';
  }
  h += '</div></div>';
  return h;
}

// ═══ MATURITY TIMELINE TABLE ═══════════════════════════════
function _renderMaturityTimeline(products, catDeposits) {
  // Collect all assets with maturity dates
  var assets = [];
  catDeposits.forEach(function(d) {
    if (d.status !== 'active' || !d.maturityDate) return;
    var mat = new Date(d.maturityDate);
    var amount = parseFloat(d.amount) || 0;
    var rate = _getCurrentCATRate(d);
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

// ═══ STRESS TEST LIQUIDITÉ ═══════════════════════════════════
function _computeExitCost(deposit) {
  var now = new Date();
  var amount = parseFloat(deposit.amount) || 0;
  var rate = parseFloat(deposit.rate) || 0;
  var startDate = deposit.startDate ? new Date(deposit.startDate) : null;
  var matDate = deposit.maturityDate ? new Date(deposit.maturityDate) : null;
  var monthsToMaturity = matDate ? Math.max(0, Math.round((matDate - now) / (30.44 * 24 * 60 * 60 * 1000))) : 0;

  // Find current period earlyRate
  if (deposit.rateSchedule && deposit.rateSchedule.length > 0) {
    var currentPeriod = null;
    deposit.rateSchedule.forEach(function(s) {
      var from = s.from ? new Date(s.from) : null;
      var to = s.to ? new Date(s.to) : null;
      if (from && to && now >= from && now <= to) currentPeriod = s;
      // Also match by fromMonth if no date
      if (!currentPeriod && s.fromMonth && startDate) {
        var mElapsed = Math.round((now - startDate) / (30.44 * 24 * 60 * 60 * 1000));
        if (mElapsed >= (s.fromMonth - 1) && mElapsed < s.toMonth) currentPeriod = s;
      }
    });

    if (currentPeriod && currentPeriod.earlyRate != null) {
      var normalRate = currentPeriod.rate || rate;
      var earlyRate = currentPeriod.earlyRate;
      var lostRate = normalRate - earlyRate;
      var lostAmount = Math.round(amount * lostRate / 100 * (monthsToMaturity / 12));
      return {
        earlyRate: earlyRate,
        normalRate: normalRate,
        lostRate: lostRate,
        lostAmount: lostAmount,
        monthsToMaturity: monthsToMaturity,
        detail: 'Taux minoré ' + earlyRate.toFixed(2) + '% vs ' + normalRate.toFixed(2) + '% normal'
      };
    }
  }

  // No earlyRate data — estimate from exitPenalty text
  var penalty = (deposit.exitPenalty || '').toLowerCase();
  if (penalty.indexOf('aucun') >= 0 || penalty.indexOf('pas de p') >= 0) {
    // "Aucun intérêt si retrait dans le mois" or "pas de pénalité"
    // Cost = loss of current period interest only (~1 month)
    var monthlyInterest = Math.round(amount * rate / 100 / 12);
    return {
      earlyRate: rate,
      normalRate: rate,
      lostRate: 0,
      lostAmount: monthlyInterest,
      monthsToMaturity: monthsToMaturity,
      detail: 'Perte intérêts période en cours (~1 mois = ' + monthlyInterest + '€)'
    };
  }

  // Fallback: estimate 50% of remaining interest
  var remainingInterest = Math.round(amount * rate / 100 * (monthsToMaturity / 12));
  var estimatedLoss = Math.round(remainingInterest * 0.5);
  return {
    earlyRate: rate * 0.5,
    normalRate: rate,
    lostRate: rate * 0.5,
    lostAmount: estimatedLoss,
    monthsToMaturity: monthsToMaturity,
    detail: 'Estimation ~50% des intérêts restants'
  };
}

function _renderStressTest(products, catDeposits) {
  var now = new Date();
  var fmt = typeof formatNumber === 'function' ? formatNumber : function(n) { return String(Math.round(n)); };

  // Build list of all liquidatable assets, sorted by exit cost (cheapest first)
  var sources = [];

  // 1. Free cash ByCam
  try {
    if (typeof catManager !== 'undefined' && catManager.objectives) {
      var cashByCam = parseFloat(catManager.objectives.cashByCam) || 0;
      if (cashByCam > 0) {
        sources.push({ name: 'Cash libre ByCam', amount: cashByCam, exitCost: 0, delay: 'Immédiat', entity: 'bycam', type: 'cash', detail: 'Disponible immédiatement' });
      }
    }
  } catch(e) {}

  // 2. CAT deposits (sorted by exit cost ascending)
  catDeposits.forEach(function(d) {
    if (d.status !== 'active') return;
    var cost = _computeExitCost(d);
    sources.push({
      name: d.productName || 'CAT',
      amount: parseFloat(d.amount) || 0,
      exitCost: cost.lostAmount,
      delay: '32 jours',
      entity: d.entity || (d.entityName === 'Caméleons' ? 'cameleons' : 'bycam'),
      type: 'cat',
      detail: cost.detail,
      monthsToMaturity: cost.monthsToMaturity,
      bank: d.bankName || '?'
    });
  });

  // 3. Structured products (illiquid — high cost)
  products.forEach(function(p) {
    if (p.grading && p.grading.grade === '-') {
      // Liquidity product (Bond 12M)
      sources.push({ name: (p.name || 'Fonds').substring(0, 35), amount: parseFloat(p.investedAmount) || 0, exitCost: 0, delay: 'Variable', entity: p.entity || '?', type: 'fund', detail: 'Rachat OPCVM' });
    } else {
      var amount = parseFloat(p.investedAmount) || 0;
      var decote = Math.round(amount * 0.03); // 3% average bid-ask
      sources.push({ name: (p.name || 'Structuré').substring(0, 35), amount: amount, exitCost: decote, delay: 'Non garanti', entity: p.entity || '?', type: 'structured', detail: 'Décote estimée 3% (pas de marché secondaire)' });
    }
  });

  // Sort by cost ratio (cheapest exits first)
  sources.sort(function(a, b) { var ra = a.amount > 0 ? a.exitCost / a.amount : 999; var rb = b.amount > 0 ? b.exitCost / b.amount : 999; return ra - rb; });

  var totalAvailable = sources.reduce(function(s, src) { return s + src.amount; }, 0);

  // Run scenarios
  var scenarios = [100000, 300000, 500000, 1000000];
  var scenarioResults = scenarios.map(function(need) {
    var remaining = need;
    var totalCost = 0;
    var used = [];
    sources.forEach(function(src) {
      if (remaining <= 0) return;
      var take = Math.min(remaining, src.amount);
      var cost = src.amount > 0 ? Math.round(src.exitCost * (take / src.amount)) : 0;
      used.push({ name: src.name, amount: take, cost: cost, delay: src.delay, type: src.type, detail: src.detail });
      remaining -= take;
      totalCost += cost;
    });
    return { need: need, mobilized: need - remaining, shortfall: remaining, totalCost: totalCost, sources: used };
  });

  // Render
  var h = '<div class="fiche-section" style="margin-top:16px"><div class="fiche-section-header"><span class="fiche-section-icon">🔥</span><span class="fiche-section-title">Stress Test Liquidité</span></div>';
  h += '<div class="fiche-section-body">';

  // Scenario cards
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">';
  scenarioResults.forEach(function(sc) {
    var ok = sc.shortfall <= 0;
    var borderColor = ok ? 'rgba(6,214,160,0.3)' : 'rgba(239,35,60,0.3)';
    var bgColor = ok ? 'rgba(6,214,160,0.04)' : 'rgba(239,35,60,0.04)';
    h += '<div style="padding:10px;border-radius:8px;border:1px solid ' + borderColor + ';background:' + bgColor + ';text-align:center">';
    h += '<div style="font-size:10px;color:var(--text-dim)">Besoin</div>';
    h += '<div style="font-size:16px;font-weight:700;color:var(--text-bright)">' + fmt(sc.need) + '€</div>';
    h += '<div style="font-size:11px;font-weight:600;color:' + (ok ? 'var(--green)' : 'var(--red)') + '">' + (ok ? '✓ Couvert' : '✗ Manque ' + fmt(sc.shortfall) + '€') + '</div>';
    if (sc.totalCost > 0) {
      h += '<div style="font-size:10px;color:var(--orange);margin-top:2px">Coût sortie : -' + fmt(sc.totalCost) + '€</div>';
    }
    h += '</div>';
  });
  h += '</div>';

  // Detailed sources table
  h += '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Sources de liquidité (triées par coût croissant)</div>';
  h += '<table style="width:100%;font-size:11px;border-collapse:collapse">';
  h += '<thead><tr style="border-bottom:2px solid var(--border)">';
  h += '<th style="padding:5px 6px;color:var(--text-dim);font-size:10px;text-align:left">Source</th>';
  h += '<th style="padding:5px 6px;color:var(--text-dim);font-size:10px;text-align:left">Entité</th>';
  h += '<th style="padding:5px 6px;color:var(--text-dim);font-size:10px;text-align:right">Montant</th>';
  h += '<th style="padding:5px 6px;color:var(--text-dim);font-size:10px;text-align:right">Coût sortie</th>';
  h += '<th style="padding:5px 6px;color:var(--text-dim);font-size:10px;text-align:left">Délai</th>';
  h += '<th style="padding:5px 6px;color:var(--text-dim);font-size:10px;text-align:left">Détail</th>';
  h += '</tr></thead><tbody>';

  var cumul = 0;
  sources.forEach(function(src, i) {
    cumul += src.amount;
    var bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
    var typeIcon = src.type === 'cash' ? '💰' : src.type === 'cat' ? '🏦' : src.type === 'fund' ? '🔄' : '📦';
    var costColor = src.exitCost === 0 ? 'var(--green)' : 'var(--orange)';
    var entColor = src.entity === 'bycam' ? 'var(--cyan)' : '#A855F7';
    var entLabel = src.entity === 'bycam' ? '🏢 ByCam' : src.entity === 'cameleons' ? '🦎 Cam.' : src.entity;
    h += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)">';
    h += '<td style="padding:5px 6px;color:var(--text-bright)">' + typeIcon + ' ' + src.name + '</td>';
    h += '<td style="padding:5px 6px;color:' + entColor + ';font-size:10px">' + entLabel + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono)">' + fmt(src.amount) + '€</td>';
    h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + costColor + '">' + (src.exitCost > 0 ? '-' + fmt(src.exitCost) + '€' : '0€') + '</td>';
    h += '<td style="padding:5px 6px;color:var(--text-muted)">' + src.delay + '</td>';
    h += '<td style="padding:5px 6px;color:var(--text-dim);font-size:10px">' + src.detail + '</td>';
    h += '</tr>';
  });

  h += '</tbody><tfoot><tr style="border-top:2px solid var(--border);font-weight:700">';
  h += '<td style="padding:6px" colspan="2">TOTAL MOBILISABLE</td>';
  h += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:var(--text-bright)">' + fmt(totalAvailable) + '€</td>';
  h += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:var(--orange)">-' + fmt(sources.reduce(function(s, src) { return s + src.exitCost; }, 0)) + '€</td>';
  h += '<td colspan="2"></td>';
  h += '</tr></tfoot></table>';

  // LCR
  var lcr30 = totalAvailable > 0 ? Math.round((sources.filter(function(s) { return s.type === 'cash' || s.type === 'cat' || s.type === 'fund'; }).reduce(function(s, src) { return s + src.amount; }, 0)) / totalAvailable * 100) : 0;
  h += '<div style="margin-top:10px;padding:8px 12px;background:rgba(59,130,246,0.06);border-radius:6px;display:flex;align-items:center;justify-content:space-between">';
  h += '<span style="font-size:11px;color:var(--text-muted)">LCR simplifié (actifs mobilisables sous 30j / patrimoine)</span>';
  h += '<span style="font-size:14px;font-weight:700;color:' + (lcr30 >= 50 ? 'var(--green)' : lcr30 >= 30 ? 'var(--orange)' : 'var(--red)') + '">' + lcr30 + '%</span>';
  h += '</div>';

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
    ...catDeposits.map(d => ({ name: (d.productName||'CAT').substring(0,20), yield: Math.round((parseFloat(d.amount)||0)*_getCurrentCATRate(d)/100) })),
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

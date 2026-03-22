// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V5 — Algorithm v2 from expert
// Dynamic threshold + NET gain + FGDR score + composite scoring
// ═══════════════════════════════════════════════════════════════

let _lastOptimizerResult = null;
let _optimizerRateSource = 'confirmed';

async function loadOptimizerResult() { try { const d = await github.readFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`); if (d) _lastOptimizerResult = d; } catch(e) {} }

async function saveOptimizerResult(summary, analysis) {
  const result = { lastUpdated: new Date().toISOString(), summary, rateSource: _optimizerRateSource, algorithmVersion: 'v2',
    totalInvested: analysis.totalInvested, totalInterestPerYear: analysis.totalInterestPerYear,
    weightedRate: analysis.weightedRate, optimizedInterest: analysis.optimizedInterest,
    optimizedRate: analysis.optimizedRate, totalPotentialGain: analysis.totalNetGain,
    totalGrossGain: analysis.totalGrossGain, totalExitCost: analysis.totalExitCost, totalNoticeCost: analysis.totalNoticeCost,
    arbitrageCount: analysis.arbitrageCount, depositCount: analysis.depositAnalysis.length, rateCount: analysis._rateCount || 0,
    deposits: analysis.depositAnalysis.map(d => ({
      name: d.name, bankName: d.bankName, entity: d.entity, amount: d.amount,
      rate: d.rate, currentPeriodRate: d.currentPeriodRate, interestPerYear: d.interestPerYear,
      remainingMonths: d.remainingMonths, maturityDate: d.maturityDate,
      bestAlt: d.bestAlt, switchGainPerYear: d.netGainAnnual, grossGainPerYear: d.grossGainAnnual,
      exitPenaltyCost: d.exitPenaltyCost, noticeOpportunityCost: d.noticeOpportunityCost,
      dynamicThreshold: d.dynamicThreshold, compositeScore: d.compositeScore,
      recommendation: d.recommendation, reason: d.reason,
    })),
  };
  _lastOptimizerResult = result;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`, result, '[StructBoard] Optimizer v2');
}

// ═══ FORMATTING HELPERS ══════════════════════════════════
function _mdToHtmlTable(md) { return md.replace(/(\|[^\n]+\|\n)((?:\|[-:| ]+\|\n))(\|[^\n]+\|\n?)+/g, (match) => { const lines = match.trim().split('\n').filter(l => l.trim()); if (lines.length < 2) return match; const parseRow = (line) => line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim()); const headers = parseRow(lines[0]); const dataStart = /^\|[\s:-]+\|$/.test(lines[1].trim().replace(/\|/g, '|')) ? 2 : 1; let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin:12px 0"><thead><tr>'; headers.forEach(h => { html += `<th style="padding:8px 10px;text-align:left;color:var(--accent);font-weight:600;border-bottom:2px solid var(--border)">${h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</th>`; }); html += '</tr></thead><tbody>'; for (let i = dataStart; i < lines.length; i++) { const cells = parseRow(lines[i]); if (!cells.length) continue; html += '<tr style="border-bottom:1px solid var(--border)">'; cells.forEach((c, j) => { const style = j === 0 ? 'font-weight:600;color:var(--text-bright)' : c.includes('ARBITRER') ? 'color:var(--orange);font-weight:600' : c.includes('GARDER') ? 'color:var(--green);font-weight:600' : /^\+/.test(c) ? 'color:var(--green);font-family:var(--mono)' : ''; html += `<td style="padding:6px 10px;${style}">${c.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</td>`; }); html += '</tr>'; } html += '</tbody></table>'; return html; }); }
function _formatOptimizerAI(text) { return text ? formatAIText(_mdToHtmlTable(text)) : ''; }
function _renderAISummaryBlock(summary) {
  if (!summary) return '';
  return `<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden">
    <div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">🤖</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandations Claude (algorithme v2)</span></div>
    <div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">${_formatOptimizerAI(summary)}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
// V2 ALGORITHM — Dynamic threshold + NET gain + FGDR
// Ported from Python expert code
// ═══════════════════════════════════════════════════════════

// ─── Dynamic threshold: f(amount, months_remaining) ──────
function _dynamicThreshold(amount, monthsLeft) {
  const BASE = 0.30;
  const amountFactor = Math.sqrt(amount / 100000);
  const timeFactor = 12 / Math.max(monthsLeft, 3);
  const threshold = BASE / Math.max(amountFactor, 0.3) * Math.min(timeFactor, 3.0);
  return Math.max(0.05, Math.min(threshold, 1.00));
}

// ─── Exit penalty: interest lost due to earlyRate ────────
function _calcExitPenaltyCost(deposit) {
  if (!deposit.rateSchedule || deposit.rateSchedule.length === 0) return 0;
  const amount = parseFloat(deposit.amount) || 0;
  const now = new Date();
  let totalNominal = 0, totalEarly = 0;

  for (const step of deposit.rateSchedule) {
    const from = new Date(step.from), to = new Date(step.to);
    const periodStart = new Date(Math.max(from.getTime(), new Date(deposit.startDate).getTime()));
    const periodEnd = new Date(Math.min(to.getTime(), now.getTime()));
    if (periodEnd <= periodStart) continue;
    const days = (periodEnd - periodStart) / 86400000;
    const nomRate = parseFloat(step.rate) || 0;
    const earlyRate = step.earlyRate != null ? parseFloat(step.earlyRate) : nomRate;
    totalNominal += amount * nomRate / 100 * days / 365;
    totalEarly += amount * earlyRate / 100 * days / 365;
  }
  return Math.max(0, Math.round((totalNominal - totalEarly) * 100) / 100);
}

// ─── Notice opportunity cost: 32 days without yield ──────
function _calcNoticeOpportunityCost(deposit, targetRate) {
  const amount = parseFloat(deposit.amount) || 0;
  const noticeDays = 32;
  return Math.round(amount * targetRate / 100 * noticeDays / 365 * 100) / 100;
}

// ─── FGDR exposure score ─────────────────────────────────
function _calcFgdrScore(deposit, allDeposits, fgdrLimit) {
  const limit = fgdrLimit || 100000;
  let exposure = 0;
  for (const d of allDeposits) {
    if (d.status !== 'active') continue;
    if (d.bankName === deposit.bankName && (d.entityName || '') === (deposit.entityName || '')) {
      exposure += parseFloat(d.amount) || 0;
    }
  }
  if (exposure <= limit) return 0;
  return Math.min(1, (exposure - limit) / (10 * limit));
}

// ─── FGDR diversification bonus ──────────────────────────
function _calcFgdrBonus(deposit, targetBank, allDeposits, fgdrLimit) {
  const limit = fgdrLimit || 100000;
  let currentExposure = 0, targetExposure = 0;
  for (const d of allDeposits) {
    if (d.status !== 'active') continue;
    const entity = d.entityName || '';
    const depEntity = deposit.entityName || '';
    if (entity !== depEntity) continue;
    if (d.bankName === deposit.bankName) currentExposure += parseFloat(d.amount) || 0;
    if (d.bankName === targetBank) targetExposure += parseFloat(d.amount) || 0;
  }
  if (targetExposure < currentExposure && currentExposure > limit) {
    return (currentExposure - targetExposure) / currentExposure * 0.15;
  }
  return 0;
}

// ═══ MAIN ANALYSIS ENGINE — V2 ═══════════════════════════
function buildOptimizationAnalysis() {
  const now = new Date();
  const nowStr = now.toISOString().split('T')[0];
  const active = catManager.deposits.filter(d => d.status === 'active');
  const allRates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  const rates = _optimizerRateSource === 'confirmed' ? allRates.filter(r => r.source !== 'web scan') : allRates;
  const obj = catManager.objectives;
  const fgdrLimit = parseFloat(obj.maxPerBank) || 100000;
  const placable = Math.max(0, (parseFloat(obj.availableCash) || 0) - (parseFloat(obj.liquidityReserve) || 0));

  // Best rate by duration
  const bestByDuration = {};
  rates.forEach(r => { if (!bestByDuration[r.durationMonths] || r.rate > bestByDuration[r.durationMonths].rate) bestByDuration[r.durationMonths] = r; });
  const bestOverall = rates.reduce((best, r) => r.rate > (best?.rate || 0) ? r : best, null);

  const depositAnalysis = active.map(d => {
    const amount = parseFloat(d.amount) || 0, rate = parseFloat(d.rate) || 0;
    const durationMonths = parseInt(d.durationMonths) || 0;
    const elapsedMonths = Math.round(Math.max(0, (now - new Date(d.startDate)) / 86400000) / 30);
    const remainingMonths = Math.max(0, durationMonths - elapsedMonths);
    const interestPerYear = Math.round(amount * (rate / 100) * 100) / 100;

    // Current period rate
    let currentPeriodRate = rate;
    if (d.rateSchedule && d.rateSchedule.length > 0) { const cp = d.rateSchedule.find(s => s.from <= nowStr && s.to >= nowStr); if (cp) currentPeriodRate = cp.rate; }

    // Find best alternative (match within ±6 months of remaining duration)
    const compatible = Object.values(bestByDuration).filter(r => {
      if (r.rate <= rate) return false;
      if (remainingMonths > 6 && Math.abs(r.durationMonths - remainingMonths) > 6) return false;
      return true;
    }).sort((a, b) => b.rate - a.rate);
    const bestAlt = compatible[0] || null;

    // ═══ V2: Calculate costs and NET gain ═══
    const spread = bestAlt ? bestAlt.rate - rate : 0;
    const grossGainAnnual = bestAlt ? Math.round(amount * spread / 100 * 100) / 100 : 0;

    // Exit penalty (earlyRate cost)
    const exitPenaltyCost = _calcExitPenaltyCost(d);

    // Notice opportunity cost
    const noticeOpportunityCost = bestAlt ? _calcNoticeOpportunityCost(d, bestAlt.rate) : 0;

    // Net gain = gross - (one-time costs amortized over remaining years)
    const totalOneTimeCosts = exitPenaltyCost + noticeOpportunityCost;
    const yearsRemaining = Math.max(remainingMonths / 12, 0.25);
    const amortizedCostAnnual = totalOneTimeCosts / yearsRemaining;
    const netGainAnnual = Math.round((grossGainAnnual - amortizedCostAnnual) * 100) / 100;
    const netGainRemaining = Math.round(netGainAnnual * yearsRemaining * 100) / 100;

    // Dynamic threshold
    const dynThreshold = _dynamicThreshold(amount, remainingMonths);

    // FGDR scores
    const fgdrSc = _calcFgdrScore(d, active, fgdrLimit);
    const fgdrBonus = bestAlt ? _calcFgdrBonus(d, bestAlt.bankName, active, fgdrLimit) : 0;
    const adjustedSpread = spread + fgdrBonus;

    // Composite score (for sorting)
    const normNetGain = Math.min(1, Math.max(0, netGainAnnual / Math.max(amount * 0.01, 1)));
    const normSpread = Math.min(1, Math.max(0, adjustedSpread / 1.0));
    const normFgdr = fgdrBonus > 0 ? fgdrBonus / 0.15 : 0;
    const normTime = Math.min(1, remainingMonths / 60);
    const compositeScore = 0.50 * normNetGain + 0.25 * normSpread + 0.15 * normFgdr + 0.10 * normTime;

    // ═══ V2: Decision — double condition ═══
    const bestAltFull = bestAlt ? rates.find(r => r.rate === bestAlt.rate && r.durationMonths === bestAlt.durationMonths) : null;
    const altIsScanned = bestAltFull?.source === 'web scan';
    let recommendation = 'GARDER', reason = 'Leader marché';

    if (bestAlt && netGainAnnual > 0 && adjustedSpread >= dynThreshold) {
      recommendation = 'ARBITRER';
      reason = `NET +${formatNumber(netGainAnnual)}€/an → ${bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm'} (seuil: ${dynThreshold.toFixed(2)}%)`;
    } else if (bestAlt && spread > 0) {
      recommendation = 'SURVEILLER';
      if (netGainAnnual <= 0) {
        reason = `Gain brut +${formatNumber(grossGainAnnual)}€ mais NET ${formatNumber(netGainAnnual)}€ (coûts: -${formatNumber(totalOneTimeCosts)}€)`;
      } else {
        reason = `Écart ${spread.toFixed(2)}% < seuil ${dynThreshold.toFixed(2)}%`;
      }
    } else if (rate >= (bestOverall?.rate || 0)) {
      reason = 'Leader marché';
    } else {
      reason = 'Taux compétitif';
    }

    return {
      id: d.id, name: d.productName || 'CAT', bankName: d.bankName, entity: d.entityName || '',
      amount, rate, currentPeriodRate, durationMonths, elapsedMonths, remainingMonths, interestPerYear,
      bestAlt: bestAlt ? { name: bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm', rate: bestAlt.rate, duration: bestAlt.durationMonths, bankName: bestAlt.bankName, isScanned: altIsScanned } : null,
      // V2 fields
      grossGainAnnual, exitPenaltyCost, noticeOpportunityCost, netGainAnnual, netGainRemaining,
      switchGainPerYear: netGainAnnual, // backward compat (dashboard uses this)
      dynamicThreshold: dynThreshold, fgdrScore: fgdrSc, fgdrBonus, compositeScore,
      recommendation, reason, maturityDate: d.maturityDate,
      exitPenalty: d.exitPenalty || '', altWithdrawalConditions: bestAltFull?.withdrawalConditions || '',
    };
  });

  // Sort by composite score (highest first)
  depositAnalysis.sort((a, b) => b.compositeScore - a.compositeScore);

  // Cash opportunities
  const cashOpportunities = [];
  if (placable > 0) {
    [...rates].sort((a, b) => b.rate - a.rate).slice(0, 5).forEach(r => {
      cashOpportunities.push({ name: r.productName || r.bankName + ' ' + r.durationMonths + 'm', rate: r.rate, duration: r.durationMonths, bankName: r.bankName, interestPerYear: Math.round(placable * (r.rate / 100) * 100) / 100, amount: placable, withdrawalConditions: r.withdrawalConditions || '', isScanned: r.source === 'web scan' });
    });
  }

  // Totals
  const totalInvested = depositAnalysis.reduce((s, d) => s + d.amount, 0);
  const totalInterestPerYear = depositAnalysis.reduce((s, d) => s + d.interestPerYear, 0);
  const weightedRate = totalInvested > 0 ? totalInterestPerYear / totalInvested * 100 : 0;
  const arbitrages = depositAnalysis.filter(d => d.recommendation === 'ARBITRER');
  const totalGrossGain = arbitrages.reduce((s, d) => s + d.grossGainAnnual, 0);
  const totalNetGain = arbitrages.reduce((s, d) => s + d.netGainAnnual, 0);
  const totalExitCost = arbitrages.reduce((s, d) => s + d.exitPenaltyCost, 0);
  const totalNoticeCost = arbitrages.reduce((s, d) => s + d.noticeOpportunityCost, 0);
  const optimizedInterest = totalInterestPerYear + totalNetGain;
  const optimizedRate = totalInvested > 0 ? optimizedInterest / totalInvested * 100 : 0;

  return { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate,
    totalGrossGain: Math.round(totalGrossGain * 100) / 100, totalNetGain: Math.round(totalNetGain * 100) / 100,
    totalExitCost: Math.round(totalExitCost * 100) / 100, totalNoticeCost: Math.round(totalNoticeCost * 100) / 100,
    totalPotentialGain: Math.round(totalNetGain * 100) / 100, // backward compat
    arbitrageCount: arbitrages.length, bestByDuration, bestOverall, optimizedInterest: Math.round(optimizedInterest * 100) / 100, optimizedRate, _rateCount: rates.length };
}

// ═══ UI: LAUNCH + MODAL ══════════════════════════════════
const _origShowCATSimulator = showCATSimulator;
showCATSimulator = function() {
  const allRates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  const confirmedRates = allRates.filter(r => r.source !== 'web scan');
  const scannedRates = allRates.filter(r => r.source === 'web scan');
  if (allRates.length === 0) { showToast('Importez des taux d\'abord', 'error'); return; }
  const modal = document.getElementById('modal');
  const n = catManager.deposits.filter(d => d.status === 'active').length;
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">⚡ Optimiseur v2</h2>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-bright);margin-bottom:10px">📊 Comparer avec :</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label style="flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-card);border:2px solid var(--green);border-radius:var(--radius-sm);cursor:pointer" id="opt-src-confirmed" onclick="document.getElementById('opt-radio-confirmed').checked=true;document.getElementById('opt-src-confirmed').style.borderColor='var(--green)';document.getElementById('opt-src-all').style.borderColor='var(--border)'">
          <input type="radio" name="opt-source" id="opt-radio-confirmed" value="confirmed" checked style="accent-color:var(--green)">
          <div><div style="font-size:12px;font-weight:600;color:var(--green)">✅ Taux confirmés</div><div style="font-size:10px;color:var(--text-dim)">${confirmedRates.length} taux · 🔒 fiables</div></div>
        </label>
        <label style="flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-card);border:2px solid var(--border);border-radius:var(--radius-sm);cursor:pointer" id="opt-src-all" onclick="document.getElementById('opt-radio-all').checked=true;document.getElementById('opt-src-all').style.borderColor='var(--purple)';document.getElementById('opt-src-confirmed').style.borderColor='var(--border)'">
          <input type="radio" name="opt-source" id="opt-radio-all" value="all" style="accent-color:var(--purple)">
          <div><div style="font-size:12px;font-weight:600;color:var(--purple)">🔍 Tous (+ web)</div><div style="font-size:10px;color:var(--text-dim)">${allRates.length} taux · ⚠️ indicatifs inclus</div></div>
        </label>
      </div>
    </div>
    <div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:10px;color:var(--text-muted)">
      <strong style="color:var(--accent)">v2</strong> : seuil dynamique f(montant, durée), gain NET après pénalité earlyRate + coût préavis 32j, score FGDR, composite score.
    </div>
    <button class="btn ai-glow lg" style="width:100%" onclick="launchOptimizer()">⚡ Optimiser (${n} contrats)</button>
    <div id="optimizer-results" style="margin-top:16px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

function launchOptimizer() {
  _optimizerRateSource = document.querySelector('input[name="opt-source"]:checked')?.value || 'confirmed';
  const results = document.getElementById('optimizer-results');
  results.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse v2 en cours...</div>`;
  setTimeout(() => runSmartOptimizer(), 100);
}

async function runSmartOptimizer() {
  const results = document.getElementById('optimizer-results');
  if (!results) return;
  try {
    const analysis = buildOptimizationAnalysis();
    const srcBadge = _optimizerRateSource === 'confirmed'
      ? '<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--green);background:rgba(6,214,160,0.1);border:1px solid rgba(6,214,160,0.3);margin-bottom:12px">✅ vs taux confirmés · algo v2</span>'
      : '<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--purple);background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);margin-bottom:12px">🔍 vs tous les taux · algo v2</span>';
    let html = srcBadge + renderOptimizationTable(analysis);
    html += '<div id="ai-optimizer-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse (v2)...</div></div>';
    results.innerHTML = html;
    const aiSummary = await getAIOptimizerSummary(analysis);
    const aiDiv = document.getElementById('ai-optimizer-summary');
    if (aiDiv) aiDiv.innerHTML = _renderAISummaryBlock(aiSummary);
    await saveOptimizerResult(aiSummary, analysis);
    showToast('Optimisation v2 sauvegardée', 'success');
    const ma = document.querySelector('.modal-actions');
    if (ma) ma.innerHTML = `<button class="btn" onclick="closeModal()">Fermer</button><button class="btn primary" onclick="closeModal();renderCAT(document.getElementById('main-content'));">✅ Dashboard</button>`;
  } catch(e) { results.innerHTML = `<div style="color:var(--red);padding:16px">❌ ${e.message}</div>`; }
}

// ═══ OPTIMIZATION TABLE — V2 with NET gain + costs ═══════
function renderOptimizationTable(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalNetGain, totalGrossGain, totalExitCost, totalNoticeCost, arbitrageCount, optimizedInterest, optimizedRate, bestOverall } = analysis;

  let html = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:8px">
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestPerYear)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${weightedRate.toFixed(2)}%</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après optim.</div><div style="font-size:20px;font-weight:800;color:${totalNetGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono)">+${formatNumber(optimizedInterest)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${optimizedRate.toFixed(2)}%</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Gain NET</div><div style="font-size:20px;font-weight:800;color:${totalNetGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-family:var(--mono)">${totalNetGain > 0 ? '+' + formatNumber(totalNetGain) + '€' : '✅'}</div><div style="font-size:10px;color:var(--text-dim)">${totalNetGain > 0 ? 'brut ' + formatNumber(totalGrossGain) + '€ - coûts ' + formatNumber(totalExitCost + totalNoticeCost) + '€' : 'Optimisé'}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Meilleur</div><div style="font-size:20px;font-weight:800;color:var(--accent);font-family:var(--mono)">${bestOverall ? bestOverall.rate + '%' : '—'}</div><div style="font-size:10px;color:var(--text-dim)">${bestOverall ? (bestOverall.productName || bestOverall.bankName) : ''}</div></div>
  </div>`;

  // Cost breakdown if there are arbitrages
  if (totalExitCost > 0 || totalNoticeCost > 0) {
    html += `<div style="display:flex;gap:16px;margin-bottom:12px;padding:8px 12px;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15);border-radius:var(--radius-sm);font-size:10px">
      <span style="color:var(--text-muted)">Détail coûts :</span>
      <span style="color:var(--orange)">Pénalité earlyRate: <strong>-${formatNumber(totalExitCost)}€</strong></span>
      <span style="color:var(--orange)">Préavis 32j: <strong>-${formatNumber(totalNoticeCost)}€</strong></span>
      <span style="color:var(--green)">Gain brut: <strong>+${formatNumber(totalGrossGain)}€/an</strong></span>
    </div>`;
  }

  // Table
  html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden"><div style="max-height:400px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">
    <th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th>
    <th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur</th>
    <th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500" title="Gain NET = brut - earlyRate - préavis">Gain NET/an</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500" title="Seuil dynamique f(montant, durée)">Seuil</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th>
  </tr></thead><tbody>`;

  depositAnalysis.forEach(d => {
    const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
    const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
    const spread = d.bestAlt ? (d.bestAlt.rate - d.rate).toFixed(2) : '—';
    const altBadge = d.bestAlt?.isScanned ? '<span style="font-size:7px;color:var(--purple);background:rgba(139,92,246,0.15);padding:0 4px;border-radius:6px">web</span>' : '';

    html += `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''">
      <td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}${d.fgdrScore > 0.3 ? ' <span style="color:var(--orange)">⚠️FGDR</span>' : ''}</div></td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td>
      <td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;color:${d.bestAlt && d.bestAlt.rate > d.rate ? 'var(--orange)' : 'var(--green)'}">${d.rate}%</span>${d.currentPeriodRate !== d.rate ? '<div style="font-size:9px;color:var(--text-dim)">palier ' + d.currentPeriodRate + '%</div>' : ''}</td>
      <td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td>
      <td style="padding:8px 6px;text-align:center">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + d.bestAlt.rate + '%</span>' + altBadge + '<div style="font-size:9px;color:var(--text-dim)">' + d.bestAlt.name + '</div>' : '<span style="color:var(--green)">✨</span>'}</td>
      <td style="padding:8px 6px;text-align:right"><span style="font-family:var(--mono);font-weight:600;color:${d.netGainAnnual > 0 ? 'var(--green)' : d.netGainAnnual < 0 ? 'var(--red)' : 'var(--text-dim)'}">${d.netGainAnnual !== 0 ? (d.netGainAnnual > 0 ? '+' : '') + formatNumber(d.netGainAnnual) + '€' : '—'}</span>${d.exitPenaltyCost > 0 ? '<div style="font-size:8px;color:var(--orange)">coûts: -' + formatNumber(d.exitPenaltyCost + d.noticeOpportunityCost) + '€</div>' : ''}</td>
      <td style="padding:8px 6px;text-align:center;font-size:9px;color:var(--text-dim)">${d.dynamicThreshold.toFixed(2)}%<div style="font-size:8px">${spread}pp</div></td>
      <td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}12;border:1px solid ${recColor}30">${recIcon} ${d.recommendation}</span></td>
    </tr>`;
  });
  html += `</tbody></table></div></div>`;

  if (cashOpportunities.length > 0) {
    html += `<div style="margin-top:16px"><h3 style="font-size:12px;color:var(--cyan);margin-bottom:8px">💰 Placer ${formatNumber(placable)}€</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;
    cashOpportunities.forEach((c, i) => { html += `<div style="background:var(--bg-elevated);border:1px solid ${i === 0 ? 'var(--cyan)' : 'var(--border)'};border-radius:var(--radius-sm);padding:10px">${i === 0 ? '<div style="font-size:9px;color:var(--cyan);margin-bottom:4px">⭐ RECOMMANDÉ</div>' : ''}<div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:11px;color:var(--text-bright)">${c.name}</strong><span style="font-family:var(--mono);color:var(--green);font-weight:700">${c.rate}%</span></div><div style="font-size:10px;color:var(--text-muted);margin-top:4px">${c.duration}m · +${formatNumber(c.interestPerYear)}€/an${c.isScanned ? ' <span style="font-size:7px;color:var(--purple);background:rgba(139,92,246,0.15);padding:0 4px;border-radius:6px">web</span>' : ''}</div></div>`; });
    html += `</div></div>`;
  }
  return html;
}

// ═══ DASHBOARD (backward compatible) ═════════════════════
function renderOptimizerDashboard() {
  if (!_lastOptimizerResult) return '';
  const r = _lastOptimizerResult;
  const date = r.lastUpdated ? new Date(r.lastUpdated) : null;
  const dateStr = date ? date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}) : '';
  const deposits = r.deposits || [];
  const srcLabel = r.rateSource === 'all' ? '🔍 tous' : '✅ confirmés';
  const algoLabel = r.algorithmVersion === 'v2' ? 'v2' : 'v1';

  let html = `<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:var(--purple)"></span>⚡ Optimisation</div><div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--text-dim)">${dateStr} · ${srcLabel} · ${algoLabel}</span><button class="btn sm ai-glow" onclick="showCATSimulator()">🔄</button></div></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono);margin-top:4px">+${formatNumber(r.totalInterestPerYear)}€<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">${(r.weightedRate||0).toFixed(2)}%</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après</div><div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono);margin-top:4px">+${formatNumber(r.optimizedInterest)}€<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">${(r.optimizedRate||0).toFixed(2)}%</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Gain NET</div><div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-family:var(--mono);margin-top:4px">${r.totalPotentialGain > 0 ? '+' + formatNumber(r.totalPotentialGain) + '€' : '✅'}</div><div style="font-size:10px;color:var(--text-dim)">${r.totalPotentialGain > 0 ? 'après coûts' : 'Optimisé'}</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Périmètre</div><div style="font-size:20px;font-weight:800;color:var(--text-bright);margin-top:4px">${r.depositCount||0} <span style="font-size:11px;color:var(--text-dim)">vs ${r.rateCount||0}</span></div><div style="font-size:10px;color:var(--text-dim)">${r.arbitrageCount||0} arbitrage${(r.arbitrageCount||0) > 1 ? 's' : ''}</div></div>
    </div>`;

  if (deposits.length > 0) {
    html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px"><div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;font-weight:600;color:var(--text-bright)">📊 Contrats vs marché (gain NET)</span><span style="font-size:10px;color:var(--text-dim)">${deposits.length} contrats</span></div><div style="max-height:320px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)"><th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Gain NET/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th></tr></thead><tbody>`;
    deposits.forEach(d => {
      const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
      const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
      const gain = d.switchGainPerYear || 0;
      html += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div></td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td><td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;color:var(--green)">${d.rate}%</span></td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td><td style="padding:8px 6px;text-align:center">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + d.bestAlt.rate + '%</span>' : '✨'}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${gain > 0 ? 'var(--green)' : gain < 0 ? 'var(--red)' : 'var(--text-dim)'}">${gain !== 0 ? (gain > 0 ? '+' : '') + formatNumber(gain) + '€' : '—'}</td><td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}12;border:1px solid ${recColor}30">${recIcon} ${d.recommendation}</span></td></tr>`;
    });
    html += `</tbody></table></div></div>`;
  }
  if (r.summary) html += _renderAISummaryBlock(r.summary);
  html += `</div>`;
  return html;
}

// ═══ AI PROMPT — V2 with NET gain details ════════════════
async function getAIOptimizerSummary(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalNetGain, totalGrossGain, totalExitCost, totalNoticeCost, optimizedInterest, optimizedRate } = analysis;
  const src = _optimizerRateSource === 'confirmed' ? 'taux confirmés' : 'tous les taux';

  const depositsText = depositAnalysis.map(d => {
    let l = `• ${d.name} (${d.bankName}) | ${d.amount}€ à ${d.rate}%`;
    if (d.currentPeriodRate !== d.rate) l += ` (palier: ${d.currentPeriodRate}%)`;
    l += ` | ${d.remainingMonths}m restant`;
    if (d.bestAlt) {
      l += ` | Cible: ${d.bestAlt.rate}% (${d.bestAlt.name})${d.bestAlt.isScanned ? ' [web]' : ''}`;
      l += ` | Brut: +${d.grossGainAnnual}€/an`;
      if (d.exitPenaltyCost > 0) l += ` | Pénalité sortie: -${d.exitPenaltyCost}€`;
      if (d.noticeOpportunityCost > 0) l += ` | Préavis: -${d.noticeOpportunityCost}€`;
      l += ` | NET: ${d.netGainAnnual > 0 ? '+' : ''}${d.netGainAnnual}€/an`;
      l += ` | Seuil: ${d.dynamicThreshold.toFixed(2)}%`;
    }
    l += ` → ${d.recommendation}`;
    return l;
  }).join('\n');

  const cashText = placable > 0 && cashOpportunities.length > 0
    ? '\n\n💰 CASH: ' + formatNumber(placable) + '€\n' + cashOpportunities.slice(0, 3).map(c => `• ${c.name} à ${c.rate}% → +${c.interestPerYear}€/an`).join('\n') : '';

  const prompt = `Directeur financier. Optimisation v2 (seuil dynamique + gain NET). Source: ${src}.

**AVANT:** ${formatNumber(totalInvested)}€ à ${weightedRate.toFixed(2)}% = +${formatNumber(totalInterestPerYear)}€/an
**APRÈS (NET):** ${optimizedRate.toFixed(2)}% = +${formatNumber(optimizedInterest)}€/an
Gain brut: +${formatNumber(totalGrossGain)}€ | Coûts sortie: -${formatNumber(totalExitCost)}€ | Préavis: -${formatNumber(totalNoticeCost)}€ | **NET: ${totalNetGain > 0 ? '+' : ''}${formatNumber(totalNetGain)}€/an**

${depositAnalysis.length} CONTRATS:
${depositsText}${cashText}

FORMAT (pas de tableau markdown):
- **AVANT: X€/an → APRÈS: Y€/an (NET +Z€)**
- Chaque arbitrage: 🔄 **[Nom]** → **[cible]** = brut +X€ - coûts Y€ = **NET +Z€/an**
  ⚠️ [pénalité earlyRate si applicable]
- Si gain NET négatif: expliquer pourquoi SURVEILLER malgré écart positif
- ✅ **[N] contrats** leaders (gain NET ≤ 0 ou pas de meilleur taux)
- Max 180 mots. Concret, chiffré.`;

  const res = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || '';
}

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V3b — Beautiful Dashboard
// ═══════════════════════════════════════════════════════════════

let _lastOptimizerResult = null;

async function loadOptimizerResult() {
  try { const data = await github.readFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`); if (data) _lastOptimizerResult = data; } catch(e) {}
}

async function saveOptimizerResult(summary, analysis) {
  const result = {
    lastUpdated: new Date().toISOString(),
    summary,
    totalInvested: analysis.totalInvested,
    totalInterestPerYear: analysis.totalInterestPerYear,
    weightedRate: analysis.weightedRate,
    optimizedInterest: analysis.optimizedInterest,
    optimizedRate: analysis.optimizedRate,
    totalPotentialGain: analysis.totalPotentialGain,
    arbitrageCount: analysis.arbitrageCount,
    depositCount: analysis.depositAnalysis.length,
    rateCount: (catManager.rates?.rates || []).filter(r => !_isRateExpired(r)).length,
    // Save full deposit analysis for dashboard table
    deposits: analysis.depositAnalysis.map(d => ({
      name: d.name, bankName: d.bankName, entity: d.entity, amount: d.amount,
      rate: d.rate, currentPeriodRate: d.currentPeriodRate, interestPerYear: d.interestPerYear,
      remainingMonths: d.remainingMonths, maturityDate: d.maturityDate,
      bestAlt: d.bestAlt, switchGainPerYear: d.switchGainPerYear,
      recommendation: d.recommendation, reason: d.reason,
    })),
    actions: analysis.depositAnalysis.filter(d => d.recommendation !== 'GARDER').map(d => ({
      name: d.name, bankName: d.bankName, amount: d.amount, rate: d.rate,
      recommendation: d.recommendation, reason: d.reason,
      bestAlt: d.bestAlt, switchGainPerYear: d.switchGainPerYear,
    })),
  };
  _lastOptimizerResult = result;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`, result, '[StructBoard] Optimizer result');
}

// Direct launch — no form
const _origShowCATSimulator = showCATSimulator;
showCATSimulator = function() {
  const rates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  if (rates.length === 0) { showToast('Importez d\'abord les taux du marché (📊 Taux marché)', 'error'); return; }
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">⚡ Optimiseur de Trésorerie</h2>
    <div id="optimizer-results"><div style="display:flex;align-items:center;gap:10px;padding:30px;color:var(--text-muted);justify-content:center"><div class="spinner"></div>Analyse de vos ${catManager.deposits.filter(d=>d.status==='active').length} contrats vs ${rates.length} taux du marché...</div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
  setTimeout(() => runSmartOptimizer(), 100);
};

async function runSmartOptimizer() {
  const results = document.getElementById('optimizer-results');
  if (!results) return;
  try {
    const analysis = buildOptimizationAnalysis();
    let html = renderOptimizationTable(analysis);
    html += '<div id="ai-optimizer-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse les arbitrages...</div></div>';
    results.innerHTML = html;
    const aiSummary = await getAIOptimizerSummary(analysis);
    const aiDiv = document.getElementById('ai-optimizer-summary');
    if (aiDiv) aiDiv.innerHTML = _renderAISummaryBlock(aiSummary);
    await saveOptimizerResult(aiSummary, analysis);
    showToast('Optimisation sauvegardée', 'success');
  } catch(e) { results.innerHTML = `<div style="color:var(--red);padding:16px">❌ Erreur: ${e.message}</div>`; }
}

// ═══ BEAUTIFUL AI SUMMARY BLOCK ══════════════════════════
function _renderAISummaryBlock(summary) {
  if (!summary) return '';
  return `<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden">
    <div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px">
      <span style="font-size:16px">🤖</span>
      <span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandations Claude</span>
    </div>
    <div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary ai-formatted">${formatAIText(summary)}</div>
  </div>`;
}

// ═══ DASHBOARD SECTION — persistent, scrollable, beautiful ═══
function renderOptimizerDashboard() {
  if (!_lastOptimizerResult) return '';
  const r = _lastOptimizerResult;
  const date = r.lastUpdated ? new Date(r.lastUpdated) : null;
  const dateStr = date ? date.toLocaleDateString('fr-FR') + ' à ' + date.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}) : '';
  const deposits = r.deposits || [];

  let html = `<div class="section">
    <div class="section-header">
      <div class="section-title"><span class="dot" style="background:var(--purple)"></span>⚡ Optimisation</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:10px;color:var(--text-dim)">Mis à jour le ${dateStr}</span>
        <button class="btn sm ai-glow" onclick="showCATSimulator()">🔄 Re-optimiser</button>
      </div>
    </div>

    <!-- KPI ROW -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Rendement actuel</div>
        <div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono);margin-top:4px">+${formatNumber(r.totalInterestPerYear)}€<span style="font-size:11px;font-weight:400">/an</span></div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${(r.weightedRate||0).toFixed(2)}% moy.</div>
      </div>
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Après optimisation</div>
        <div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono);margin-top:4px">+${formatNumber(r.optimizedInterest)}€<span style="font-size:11px;font-weight:400">/an</span></div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${(r.optimizedRate||0).toFixed(2)}% moy.</div>
      </div>
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Gain potentiel</div>
        <div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-family:var(--mono);margin-top:4px">${r.totalPotentialGain > 0 ? '+' + formatNumber(r.totalPotentialGain) + '€' : '✅'}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${r.totalPotentialGain > 0 ? 'par an' : 'Déjà optimisé'}</div>
      </div>
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Périmètre</div>
        <div style="font-size:20px;font-weight:800;color:var(--text-bright);margin-top:4px">${r.depositCount || 0} <span style="font-size:11px;font-weight:400;color:var(--text-dim)">vs ${r.rateCount || 0}</span></div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">contrats vs taux marché</div>
      </div>
    </div>`;

  // SCROLLABLE TABLE — deposits vs market
  if (deposits.length > 0) {
    html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
      <div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:600;color:var(--text-bright)">📊 Comparaison contrats vs marché</span>
        <span style="font-size:10px;color:var(--text-dim)">${deposits.length} contrats analysés</span>
      </div>
      <div style="max-height:320px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">
            <th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th>
            <th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th>
            <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th>
            <th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Rdt/an</th>
            <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th>
            <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur dispo</th>
            <th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Gain/an</th>
            <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th>
          </tr></thead><tbody>`;

    deposits.forEach(d => {
      const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
      const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
      const rateWarn = d.bestAlt && d.bestAlt.rate > d.rate;
      html += `<tr style="border-bottom:1px solid var(--border);transition:background 0.15s" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background='transparent'">
        <td style="padding:8px 10px">
          <strong style="color:var(--text-bright);font-size:11px">${d.name}</strong>
          <div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div>
        </td>
        <td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-size:11px">${formatNumber(d.amount)}€</td>
        <td style="padding:8px 6px;text-align:center">
          <span style="font-family:var(--mono);font-weight:700;font-size:12px;color:${rateWarn ? 'var(--orange)' : 'var(--green)'}">${d.rate}%</span>
          ${d.currentPeriodRate && d.currentPeriodRate !== d.rate ? '<div style="font-size:9px;color:var(--text-dim)">palier ' + d.currentPeriodRate + '%</div>' : ''}
        </td>
        <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(d.interestPerYear)}€</td>
        <td style="padding:8px 6px;text-align:center;font-size:10px;color:var(--text-muted)">${d.remainingMonths}m</td>
        <td style="padding:8px 6px;text-align:center">
          ${d.bestAlt
            ? '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan);font-size:12px">' + d.bestAlt.rate + '%</span><div style="font-size:9px;color:var(--text-dim);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + d.bestAlt.name + '</div>'
            : '<span style="color:var(--green);font-size:10px">✨ Leader</span>'}
        </td>
        <td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${d.switchGainPerYear > 0 ? 'var(--green)' : 'var(--text-dim)'}">${d.switchGainPerYear > 0 ? '+' + formatNumber(d.switchGainPerYear) + '€' : '—'}</td>
        <td style="padding:8px 6px;text-align:center">
          <span style="display:inline-block;padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}12;border:1px solid ${recColor}30">${recIcon} ${d.recommendation}</span>
        </td>
      </tr>`;
    });

    // Total row
    const totalInv = deposits.reduce((s,d) => s + (d.amount||0), 0);
    const totalRdt = deposits.reduce((s,d) => s + (d.interestPerYear||0), 0);
    const totalGain = deposits.filter(d => d.switchGainPerYear > 0).reduce((s,d) => s + d.switchGainPerYear, 0);
    html += `<tr style="background:var(--bg-elevated);font-weight:600">
      <td style="padding:8px 10px;color:var(--text-bright)">TOTAL</td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(totalInv)}€</td>
      <td style="padding:8px 6px;text-align:center;font-family:var(--mono)">${totalInv > 0 ? (totalRdt/totalInv*100).toFixed(2) + '%' : '—'}</td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(totalRdt)}€</td>
      <td colspan="2" style="padding:8px 6px;text-align:center;font-size:10px;color:var(--text-muted)">→ ${(r.optimizedRate||0).toFixed(2)}%</td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:${totalGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-weight:700">${totalGain > 0 ? '+' + formatNumber(totalGain) + '€' : '✅'}</td>
      <td></td>
    </tr>`;

    html += `</tbody></table></div></div>`;
  }

  // AI SUMMARY — beautiful block
  if (r.summary) {
    html += _renderAISummaryBlock(r.summary);
  }

  html += `</div>`;
  return html;
}

// ═══ ANALYSIS ENGINE ═════════════════════════════════════

function buildOptimizationAnalysis() {
  const now = new Date();
  const active = catManager.deposits.filter(d => d.status === 'active');
  const rates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  const obj = catManager.objectives;
  const cash = parseFloat(obj.availableCash) || 0;
  const reserve = parseFloat(obj.liquidityReserve) || 0;
  const placable = Math.max(0, cash - reserve);

  const bestByDuration = {};
  rates.forEach(r => { const dur = r.durationMonths; if (!bestByDuration[dur] || r.rate > bestByDuration[dur].rate) bestByDuration[dur] = r; });
  const bestOverall = rates.reduce((best, r) => r.rate > (best?.rate || 0) ? r : best, null);

  const depositAnalysis = active.map(d => {
    const amount = parseFloat(d.amount) || 0, rate = parseFloat(d.rate) || 0;
    const durationMonths = parseInt(d.durationMonths) || 0;
    const elapsedDays = Math.max(0, (now - new Date(d.startDate)) / 86400000);
    const elapsedMonths = Math.round(elapsedDays / 30);
    const remainingMonths = Math.max(0, durationMonths - elapsedMonths);
    const earnedSoFar = typeof calcInterestAtExit === 'function' ? calcInterestAtExit(d, now.toISOString().split('T')[0]) : Math.round(amount * (rate / 100) * (elapsedDays / 365) * 100) / 100;
    const interestPerYear = Math.round(amount * (rate / 100) * 100) / 100;

    const allAlts = Object.values(bestByDuration).filter(r => r.rate > rate).sort((a, b) => b.rate - a.rate);
    const bestAlt = allAlts[0] || null;
    let switchGainPerYear = 0;
    if (bestAlt) switchGainPerYear = Math.round((amount * (bestAlt.rate / 100) - amount * (rate / 100)) * 100) / 100;

    let currentPeriodRate = rate;
    if (d.rateSchedule && d.rateSchedule.length > 0) { const nowStr = now.toISOString().split('T')[0]; const cp = d.rateSchedule.find(s => s.from <= nowStr && s.to >= nowStr); if (cp) currentPeriodRate = cp.rate; }

    let recommendation = 'GARDER', reason = 'Taux compétitif';
    if (bestAlt && bestAlt.rate > rate + 0.3) { recommendation = 'ARBITRER'; reason = `→ ${bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm'} à ${bestAlt.rate}%`; }
    else if (bestAlt && bestAlt.rate > rate) { recommendation = 'SURVEILLER'; reason = `+${(bestAlt.rate - rate).toFixed(2)}% dispo`; }
    else if (rate >= (bestOverall?.rate || 0)) { reason = 'Leader marché'; }

    return { id: d.id, name: d.productName || 'CAT', bankName: d.bankName, entity: d.entityName || '', amount, rate, currentPeriodRate, durationMonths, elapsedMonths, remainingMonths, earnedSoFar, interestPerYear, bestAlt: bestAlt ? { name: bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm', rate: bestAlt.rate, duration: bestAlt.durationMonths, bankName: bestAlt.bankName } : null, switchGainPerYear, recommendation, reason, maturityDate: d.maturityDate };
  });

  const cashOpportunities = [];
  if (placable > 0) { [...rates].sort((a, b) => b.rate - a.rate).slice(0, 5).forEach(r => { cashOpportunities.push({ name: r.productName || r.bankName + ' ' + r.durationMonths + 'm', rate: r.rate, duration: r.durationMonths, bankName: r.bankName, interest: Math.round(placable * (r.rate / 100) * (r.durationMonths / 12) * 100) / 100, interestPerYear: Math.round(placable * (r.rate / 100) * 100) / 100, amount: placable }); }); }

  const totalInvested = depositAnalysis.reduce((s, d) => s + d.amount, 0);
  const totalInterestPerYear = depositAnalysis.reduce((s, d) => s + d.interestPerYear, 0);
  const weightedRate = totalInvested > 0 ? totalInterestPerYear / totalInvested * 100 : 0;
  const totalPotentialGain = depositAnalysis.filter(d => d.switchGainPerYear > 0).reduce((s, d) => s + d.switchGainPerYear, 0);
  const arbitrageCount = depositAnalysis.filter(d => d.recommendation === 'ARBITRER').length;
  const optimizedInterest = depositAnalysis.reduce((s, d) => { if (d.recommendation === 'ARBITRER' && d.bestAlt) return s + Math.round(d.amount * (d.bestAlt.rate / 100) * 100) / 100; return s + d.interestPerYear; }, 0);
  const optimizedRate = totalInvested > 0 ? optimizedInterest / totalInvested * 100 : 0;

  return { depositAnalysis, cashOpportunities, placable, reserve, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, bestByDuration, bestOverall, optimizedInterest, optimizedRate };
}

// ═══ MODAL TABLE (reuses same style) ═════════════════════
function renderOptimizationTable(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, optimizedInterest, optimizedRate, bestOverall } = analysis;

  let html = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestPerYear)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${weightedRate.toFixed(2)}% sur ${formatNumber(totalInvested)}€</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après optimisation</div><div style="font-size:20px;font-weight:800;color:${totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono)">+${formatNumber(optimizedInterest)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${optimizedRate.toFixed(2)}%${totalPotentialGain > 0 ? ' (+' + formatNumber(totalPotentialGain) + '€)' : ''}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Arbitrages</div><div style="font-size:20px;font-weight:800;color:${arbitrageCount > 0 ? 'var(--orange)' : 'var(--green)'}">${arbitrageCount > 0 ? '🔄 ' + arbitrageCount : '✅'}</div><div style="font-size:10px;color:var(--text-dim)">${arbitrageCount > 0 ? arbitrageCount + ' à réallouer' : 'Optimisé'}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Meilleur marché</div><div style="font-size:20px;font-weight:800;color:var(--accent);font-family:var(--mono)">${bestOverall ? bestOverall.rate + '%' : '—'}</div><div style="font-size:10px;color:var(--text-dim)">${bestOverall ? (bestOverall.productName || bestOverall.bankName + ' ' + bestOverall.durationMonths + 'm') : ''}</div></div>
  </div>`;

  // Same table as dashboard but in modal
  html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden"><div style="max-height:400px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)"><th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Rdt/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur dispo</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Gain/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th></tr></thead><tbody>`;

  depositAnalysis.forEach(d => {
    const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
    const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
    html += `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''"><td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div></td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td><td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;color:${d.bestAlt && d.bestAlt.rate > d.rate ? 'var(--orange)' : 'var(--green)'}">${d.rate}%</span>${d.currentPeriodRate !== d.rate ? '<div style="font-size:9px;color:var(--text-dim)">palier ' + d.currentPeriodRate + '%</div>' : ''}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(d.interestPerYear)}€</td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td><td style="padding:8px 6px;text-align:center">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + d.bestAlt.rate + '%</span><div style="font-size:9px;color:var(--text-dim)">' + d.bestAlt.name + '</div>' : '<span style="color:var(--green)">✨ Leader</span>'}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${d.switchGainPerYear > 0 ? 'var(--green)' : 'var(--text-dim)'}">${d.switchGainPerYear > 0 ? '+' + formatNumber(d.switchGainPerYear) + '€' : '—'}</td><td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}12;border:1px solid ${recColor}30">${recIcon} ${d.recommendation}</span></td></tr>`;
  });

  html += `</tbody></table></div></div>`;

  if (cashOpportunities.length > 0) {
    html += `<div style="margin-top:16px"><h3 style="font-size:12px;color:var(--cyan);margin-bottom:8px">💰 Placer ${formatNumber(analysis.placable)}€</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;
    cashOpportunities.forEach((c, i) => { html += `<div style="background:var(--bg-elevated);border:1px solid ${i === 0 ? 'var(--cyan)' : 'var(--border)'};border-radius:var(--radius-sm);padding:10px">${i === 0 ? '<div style="font-size:9px;color:var(--cyan);margin-bottom:4px">⭐ RECOMMANDÉ</div>' : ''}<div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:11px;color:var(--text-bright)">${c.name}</strong><span style="font-family:var(--mono);color:var(--green);font-weight:700">${c.rate}%</span></div><div style="font-size:10px;color:var(--text-muted);margin-top:4px">${c.duration}m · <strong style="color:var(--green)">+${formatNumber(c.interestPerYear)}€/an</strong></div></div>`; });
    html += `</div></div>`;
  }
  return html;
}

// ═══ AI PROMPT ═══════════════════════════════════════════
async function getAIOptimizerSummary(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, optimizedInterest, optimizedRate } = analysis;
  const depositsText = depositAnalysis.map(d => `${d.name} (${d.bankName}) | ${d.amount}€ | ${d.rate}% | Rdt: ${d.interestPerYear}€/an | ${d.remainingMonths}m | Best: ${d.bestAlt ? d.bestAlt.rate + '% ' + d.bestAlt.name : 'Leader'} | ${d.recommendation}`).join('\n');
  const cashText = placable > 0 && cashOpportunities.length > 0 ? `\nCASH: ${placable}€\n` + cashOpportunities.slice(0, 3).map(c => `- ${c.name} ${c.rate}% → +${c.interestPerYear}€/an`).join('\n') : '';

  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: `Conseiller trésorerie. Recommandations CONCRÈTES et CHIFFRÉES.\n\nAVANT: ${formatNumber(totalInvested)}€ à ${weightedRate.toFixed(2)}% = **+${formatNumber(totalInterestPerYear)}€/an**\nAPRÈS: ${optimizedRate.toFixed(2)}% = **+${formatNumber(optimizedInterest)}€/an** (${totalPotentialGain > 0 ? '+' + formatNumber(totalPotentialGain) + '€' : 'déjà optimisé'})\n\nCONTRATS:\n${depositsText}${cashText}\n\nFORMAT STRICT:\n1. Commence par: **AVANT → APRÈS** en une ligne avec les montants\n2. Un TABLEAU markdown clair: Produit | Action | Détail | Impact/an  \n3. Max 3 BULLETS de résumé avec chiffres\n4. Si arbitrage: "Sortir de [X] → placer sur [Y] = +Z€/an"\n5. Mentionne contraintes (préavis 32j)\n6. Max 200 mots. Sois direct.` }] }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || 'Pas de réponse.';
}

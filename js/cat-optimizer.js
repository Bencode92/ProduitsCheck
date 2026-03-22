// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V4 — Rate source selector
// ═══════════════════════════════════════════════════════════════

let _lastOptimizerResult = null;
let _optimizerRateSource = 'confirmed'; // 'confirmed' | 'all'

async function loadOptimizerResult() {
  try { const data = await github.readFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`); if (data) _lastOptimizerResult = data; } catch(e) {}
}

async function saveOptimizerResult(summary, analysis) {
  const result = {
    lastUpdated: new Date().toISOString(), summary,
    rateSource: _optimizerRateSource,
    totalInvested: analysis.totalInvested, totalInterestPerYear: analysis.totalInterestPerYear,
    weightedRate: analysis.weightedRate, optimizedInterest: analysis.optimizedInterest,
    optimizedRate: analysis.optimizedRate, totalPotentialGain: analysis.totalPotentialGain,
    arbitrageCount: analysis.arbitrageCount,
    depositCount: analysis.depositAnalysis.length,
    rateCount: analysis._rateCount || 0,
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
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`, result, '[StructBoard] Optimizer');
}

// ═══ MD TABLE → HTML ═════════════════════════════════════
function _mdToHtmlTable(md) {
  return md.replace(/(\|[^\n]+\|\n)((?:\|[-:| ]+\|\n))(\|[^\n]+\|\n?)+/g, (match) => {
    const lines = match.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return match;
    const parseRow = (line) => line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
    const headers = parseRow(lines[0]);
    const dataStart = /^\|[\s:-]+\|$/.test(lines[1].trim().replace(/\|/g, '|')) ? 2 : 1;
    let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin:12px 0"><thead><tr>';
    headers.forEach(h => { html += `<th style="padding:8px 10px;text-align:left;color:var(--accent);font-weight:600;border-bottom:2px solid var(--border)">${h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</th>`; });
    html += '</tr></thead><tbody>';
    for (let i = dataStart; i < lines.length; i++) { const cells = parseRow(lines[i]); if (cells.length === 0) continue; html += '<tr style="border-bottom:1px solid var(--border)">'; cells.forEach((c, j) => { const style = j === 0 ? 'font-weight:600;color:var(--text-bright)' : c.includes('ARBITRER') ? 'color:var(--orange);font-weight:600' : c.includes('GARDER') ? 'color:var(--green);font-weight:600' : /^\+/.test(c) ? 'color:var(--green);font-family:var(--mono)' : ''; html += `<td style="padding:6px 10px;${style}">${c.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/→/g, '<span style="color:var(--accent)">→</span>')}</td>`; }); html += '</tr>'; }
    html += '</tbody></table>'; return html;
  });
}
function _formatOptimizerAI(text) { if (!text) return ''; return formatAIText(_mdToHtmlTable(text)); }
function _renderAISummaryBlock(summary) {
  if (!summary) return '';
  return `<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden">
    <div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">🤖</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandations Claude</span></div>
    <div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">${_formatOptimizerAI(summary)}</div>
  </div>`;
}

// ═══ DIRECT LAUNCH — with rate source selector ═══════════
const _origShowCATSimulator = showCATSimulator;
showCATSimulator = function() {
  const allRates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  const confirmedRates = allRates.filter(r => r.source !== 'web scan');
  const scannedRates = allRates.filter(r => r.source === 'web scan');

  if (allRates.length === 0) { showToast('Importez des taux du marché d\'abord', 'error'); return; }

  const modal = document.getElementById('modal');
  const activeCount = catManager.deposits.filter(d => d.status === 'active').length;

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">⚡ Optimiseur de Trésorerie</h2>

    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-bright);margin-bottom:10px">📊 Comparer mes contrats avec :</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label style="flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-card);border:2px solid var(--green);border-radius:var(--radius-sm);cursor:pointer;transition:all 0.2s" id="opt-src-confirmed" onclick="document.getElementById('opt-radio-confirmed').checked=true;document.getElementById('opt-src-confirmed').style.borderColor='var(--green)';document.getElementById('opt-src-all').style.borderColor='var(--border)'">
          <input type="radio" name="opt-source" id="opt-radio-confirmed" value="confirmed" checked style="accent-color:var(--green)">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--green)">✅ Taux confirmés uniquement</div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${confirmedRates.length} taux · CIC, SG, BP (import email/PDF)</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:2px">🔒 Fiable à 100% — taux réels négociés</div>
          </div>
        </label>
        <label style="flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-card);border:2px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:all 0.2s" id="opt-src-all" onclick="document.getElementById('opt-radio-all').checked=true;document.getElementById('opt-src-all').style.borderColor='var(--purple)';document.getElementById('opt-src-confirmed').style.borderColor='var(--border)'">
          <input type="radio" name="opt-source" id="opt-radio-all" value="all" style="accent-color:var(--purple)">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--purple)">🔍 Tous les taux (+ indicatifs web)</div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${allRates.length} taux · confirmés + ${scannedRates.length} scannés</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:2px">⚠️ Taux web = indicatifs, à vérifier</div>
          </div>
        </label>
      </div>
    </div>

    <button class="btn ai-glow lg" style="width:100%" onclick="launchOptimizer()">⚡ Lancer l'optimisation (${activeCount} contrats)</button>
    <div id="optimizer-results" style="margin-top:16px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

function launchOptimizer() {
  const srcRadio = document.querySelector('input[name="opt-source"]:checked');
  _optimizerRateSource = srcRadio?.value || 'confirmed';

  const results = document.getElementById('optimizer-results');
  const allRates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  const usedRates = _optimizerRateSource === 'confirmed'
    ? allRates.filter(r => r.source !== 'web scan')
    : allRates;

  results.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse ${catManager.deposits.filter(d=>d.status==='active').length} contrats vs ${usedRates.length} taux ${_optimizerRateSource === 'confirmed' ? 'confirmés' : '(confirmés + indicatifs)'}...</div>`;
  setTimeout(() => runSmartOptimizer(), 100);
}

async function runSmartOptimizer() {
  const results = document.getElementById('optimizer-results');
  if (!results) return;
  try {
    const analysis = buildOptimizationAnalysis();

    // Show source badge
    const srcBadge = _optimizerRateSource === 'confirmed'
      ? '<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--green);background:rgba(6,214,160,0.1);border:1px solid rgba(6,214,160,0.3);margin-bottom:12px">✅ Comparaison vs taux confirmés uniquement</span>'
      : '<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--purple);background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);margin-bottom:12px">🔍 Comparaison vs tous les taux (confirmés + indicatifs web)</span>';

    let html = srcBadge + renderOptimizationTable(analysis);
    html += '<div id="ai-optimizer-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse...</div></div>';
    results.innerHTML = html;

    const aiSummary = await getAIOptimizerSummary(analysis);
    const aiDiv = document.getElementById('ai-optimizer-summary');
    if (aiDiv) aiDiv.innerHTML = _renderAISummaryBlock(aiSummary);

    await saveOptimizerResult(aiSummary, analysis);
    showToast('Optimisation sauvegardée', 'success');

    const modalActions = document.querySelector('.modal-actions');
    if (modalActions) {
      modalActions.innerHTML = `<button class="btn" onclick="closeModal()">Fermer</button>
        <button class="btn primary" onclick="closeModal();renderCAT(document.getElementById('main-content'));">✅ Dashboard</button>`;
    }
  } catch(e) { results.innerHTML = `<div style="color:var(--red);padding:16px">❌ ${e.message}</div>`; }
}

// ═══ DASHBOARD SECTION ═══════════════════════════════════
function renderOptimizerDashboard() {
  if (!_lastOptimizerResult) return '';
  const r = _lastOptimizerResult;
  const date = r.lastUpdated ? new Date(r.lastUpdated) : null;
  const dateStr = date ? date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}) : '';
  const deposits = r.deposits || [];
  const srcLabel = r.rateSource === 'all' ? '🔍 confirmés + web' : '✅ confirmés';

  let html = `<div class="section">
    <div class="section-header">
      <div class="section-title"><span class="dot" style="background:var(--purple)"></span>⚡ Optimisation</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:10px;color:var(--text-dim)">${dateStr} · ${srcLabel}</span>
        <button class="btn sm ai-glow" onclick="showCATSimulator()">🔄 Re-optimiser</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono);margin-top:4px">+${formatNumber(r.totalInterestPerYear)}€<span style="font-size:11px;font-weight:400">/an</span></div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${(r.weightedRate||0).toFixed(2)}%</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après optimisation</div><div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono);margin-top:4px">+${formatNumber(r.optimizedInterest)}€<span style="font-size:11px;font-weight:400">/an</span></div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${(r.optimizedRate||0).toFixed(2)}%</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Gain potentiel</div><div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-family:var(--mono);margin-top:4px">${r.totalPotentialGain > 0 ? '+' + formatNumber(r.totalPotentialGain) + '€' : '✅'}</div><div style="font-size:10px;color:var(--text-dim)">${r.totalPotentialGain > 0 ? 'par an' : 'Optimisé'}</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Périmètre</div><div style="font-size:20px;font-weight:800;color:var(--text-bright);margin-top:4px">${r.depositCount || 0} <span style="font-size:11px;font-weight:400;color:var(--text-dim)">vs ${r.rateCount || 0}</span></div><div style="font-size:10px;color:var(--text-dim)">contrats vs taux</div></div>
    </div>`;

  if (deposits.length > 0) {
    html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
      <div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;font-weight:600;color:var(--text-bright)">📊 Contrats vs marché</span><span style="font-size:10px;color:var(--text-dim)">${deposits.length} contrats</span></div>
      <div style="max-height:320px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)"><th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Rdt/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Gain/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th></tr></thead><tbody>`;
    deposits.forEach(d => {
      const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
      const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
      html += `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''"><td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div></td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td><td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;color:${d.bestAlt && d.bestAlt.rate > d.rate ? 'var(--orange)' : 'var(--green)'}">${d.rate}%</span>${d.currentPeriodRate && d.currentPeriodRate !== d.rate ? '<div style="font-size:9px;color:var(--text-dim)">palier ' + d.currentPeriodRate + '%</div>' : ''}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(d.interestPerYear)}€</td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td><td style="padding:8px 6px;text-align:center">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + d.bestAlt.rate + '%</span><div style="font-size:9px;color:var(--text-dim)">' + d.bestAlt.name + '</div>' : '<span style="color:var(--green)">✨ Leader</span>'}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${d.switchGainPerYear > 0 ? 'var(--green)' : 'var(--text-dim)'}">${d.switchGainPerYear > 0 ? '+' + formatNumber(d.switchGainPerYear) + '€' : '—'}</td><td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}12;border:1px solid ${recColor}30">${recIcon} ${d.recommendation}</span></td></tr>`;
    });
    const totalInv = deposits.reduce((s,d) => s + (d.amount||0), 0);
    const totalRdt = deposits.reduce((s,d) => s + (d.interestPerYear||0), 0);
    const totalGain = deposits.filter(d => d.switchGainPerYear > 0).reduce((s,d) => s + d.switchGainPerYear, 0);
    html += `<tr style="background:var(--bg-elevated);font-weight:600"><td style="padding:8px 10px;color:var(--text-bright)">TOTAL</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(totalInv)}€</td><td style="padding:8px 6px;text-align:center;font-family:var(--mono)">${totalInv > 0 ? (totalRdt/totalInv*100).toFixed(2) + '%' : '—'}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(totalRdt)}€</td><td colspan="2" style="padding:8px 6px;text-align:center;font-size:10px;color:var(--text-muted)">→ ${(r.optimizedRate||0).toFixed(2)}%</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:${totalGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-weight:700">${totalGain > 0 ? '+' + formatNumber(totalGain) + '€' : '✅'}</td><td></td></tr>`;
    html += `</tbody></table></div></div>`;
  }

  if (r.summary) html += _renderAISummaryBlock(r.summary);
  html += `</div>`;
  return html;
}

// ═══ ANALYSIS ENGINE — filtered by rate source ═══════════
function buildOptimizationAnalysis() {
  const now = new Date();
  const nowStr = now.toISOString().split('T')[0];
  const active = catManager.deposits.filter(d => d.status === 'active');

  // FILTER rates based on selected source
  const allRates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  const rates = _optimizerRateSource === 'confirmed'
    ? allRates.filter(r => r.source !== 'web scan')
    : allRates;

  const obj = catManager.objectives;
  const placable = Math.max(0, (parseFloat(obj.availableCash) || 0) - (parseFloat(obj.liquidityReserve) || 0));

  const bestByDuration = {};
  rates.forEach(r => { if (!bestByDuration[r.durationMonths] || r.rate > bestByDuration[r.durationMonths].rate) bestByDuration[r.durationMonths] = r; });
  const bestOverall = rates.reduce((best, r) => r.rate > (best?.rate || 0) ? r : best, null);

  const depositAnalysis = active.map(d => {
    const amount = parseFloat(d.amount) || 0, rate = parseFloat(d.rate) || 0;
    const durationMonths = parseInt(d.durationMonths) || 0;
    const elapsedMonths = Math.round(Math.max(0, (now - new Date(d.startDate)) / 86400000) / 30);
    const remainingMonths = Math.max(0, durationMonths - elapsedMonths);
    const interestPerYear = Math.round(amount * (rate / 100) * 100) / 100;

    let currentPeriodRate = rate;
    if (d.rateSchedule && d.rateSchedule.length > 0) { const cp = d.rateSchedule.find(s => s.from <= nowStr && s.to >= nowStr); if (cp) currentPeriodRate = cp.rate; }

    const bestAlt = Object.values(bestByDuration).filter(r => r.rate > rate).sort((a, b) => b.rate - a.rate)[0] || null;
    const switchGainPerYear = bestAlt ? Math.round((amount * (bestAlt.rate / 100) - interestPerYear) * 100) / 100 : 0;

    const bestAltFull = bestAlt ? rates.find(r => r.rate === bestAlt.rate && r.durationMonths === bestAlt.durationMonths) : null;
    const altWithdrawalConditions = bestAltFull?.withdrawalConditions || '';
    const altIsScanned = bestAltFull?.source === 'web scan';
    const exitPenalty = d.exitPenalty || '';

    let recommendation = 'GARDER', reason = 'Taux compétitif';
    if (bestAlt && bestAlt.rate > rate + 0.3) { recommendation = 'ARBITRER'; reason = `→ ${bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm'} à ${bestAlt.rate}%`; }
    else if (bestAlt && bestAlt.rate > rate) { recommendation = 'SURVEILLER'; reason = `+${(bestAlt.rate - rate).toFixed(2)}% dispo`; }
    else if (rate >= (bestOverall?.rate || 0)) { reason = 'Leader marché'; }

    return {
      id: d.id, name: d.productName || 'CAT', bankName: d.bankName, entity: d.entityName || '',
      amount, rate, currentPeriodRate, durationMonths, elapsedMonths, remainingMonths, interestPerYear,
      bestAlt: bestAlt ? { name: bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm', rate: bestAlt.rate, duration: bestAlt.durationMonths, bankName: bestAlt.bankName, isScanned: altIsScanned } : null,
      switchGainPerYear, recommendation, reason, maturityDate: d.maturityDate,
      exitPenalty, altWithdrawalConditions,
    };
  });

  const cashOpportunities = [];
  if (placable > 0) {
    [...rates].sort((a, b) => b.rate - a.rate).slice(0, 5).forEach(r => {
      cashOpportunities.push({ name: r.productName || r.bankName + ' ' + r.durationMonths + 'm', rate: r.rate, duration: r.durationMonths, bankName: r.bankName, interestPerYear: Math.round(placable * (r.rate / 100) * 100) / 100, amount: placable, withdrawalConditions: r.withdrawalConditions || '', isScanned: r.source === 'web scan' });
    });
  }

  const totalInvested = depositAnalysis.reduce((s, d) => s + d.amount, 0);
  const totalInterestPerYear = depositAnalysis.reduce((s, d) => s + d.interestPerYear, 0);
  const weightedRate = totalInvested > 0 ? totalInterestPerYear / totalInvested * 100 : 0;
  const totalPotentialGain = depositAnalysis.filter(d => d.switchGainPerYear > 0).reduce((s, d) => s + d.switchGainPerYear, 0);
  const arbitrageCount = depositAnalysis.filter(d => d.recommendation === 'ARBITRER').length;
  const optimizedInterest = depositAnalysis.reduce((s, d) => d.recommendation === 'ARBITRER' && d.bestAlt ? s + Math.round(d.amount * (d.bestAlt.rate / 100) * 100) / 100 : s + d.interestPerYear, 0);
  const optimizedRate = totalInvested > 0 ? optimizedInterest / totalInvested * 100 : 0;

  return { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, bestByDuration, bestOverall, optimizedInterest, optimizedRate, _rateCount: rates.length };
}

// ═══ MODAL TABLE ═════════════════════════════════════════
function renderOptimizationTable(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, optimizedInterest, optimizedRate, bestOverall } = analysis;

  let html = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestPerYear)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${weightedRate.toFixed(2)}% sur ${formatNumber(totalInvested)}€</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après optimisation</div><div style="font-size:20px;font-weight:800;color:${totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono)">+${formatNumber(optimizedInterest)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${optimizedRate.toFixed(2)}%${totalPotentialGain > 0 ? ' (+' + formatNumber(totalPotentialGain) + '€)' : ''}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Arbitrages</div><div style="font-size:20px;font-weight:800;color:${arbitrageCount > 0 ? 'var(--orange)' : 'var(--green)'}">${arbitrageCount > 0 ? '🔄 ' + arbitrageCount : '✅'}</div><div style="font-size:10px;color:var(--text-dim)">${arbitrageCount > 0 ? arbitrageCount + ' opportunité' + (arbitrageCount > 1 ? 's' : '') : 'Optimisé'}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Meilleur marché</div><div style="font-size:20px;font-weight:800;color:var(--accent);font-family:var(--mono)">${bestOverall ? bestOverall.rate + '%' : '—'}</div><div style="font-size:10px;color:var(--text-dim)">${bestOverall ? (bestOverall.productName || bestOverall.bankName + ' ' + bestOverall.durationMonths + 'm') : ''}</div></div>
  </div>`;

  html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden"><div style="max-height:400px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)"><th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Rdt/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Gain/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th></tr></thead><tbody>`;
  depositAnalysis.forEach(d => {
    const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
    const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
    const altBadge = d.bestAlt?.isScanned ? '<span style="font-size:7px;color:var(--purple);background:rgba(139,92,246,0.15);padding:0 4px;border-radius:6px;margin-left:2px">web</span>' : '';
    html += `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''"><td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div></td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td><td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;color:${d.bestAlt && d.bestAlt.rate > d.rate ? 'var(--orange)' : 'var(--green)'}">${d.rate}%</span>${d.currentPeriodRate !== d.rate ? '<div style="font-size:9px;color:var(--text-dim)">palier ' + d.currentPeriodRate + '%</div>' : ''}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(d.interestPerYear)}€</td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td><td style="padding:8px 6px;text-align:center">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + d.bestAlt.rate + '%</span>' + altBadge + '<div style="font-size:9px;color:var(--text-dim)">' + d.bestAlt.name + '</div>' : '<span style="color:var(--green)">✨ Leader</span>'}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${d.switchGainPerYear > 0 ? 'var(--green)' : 'var(--text-dim)'}">${d.switchGainPerYear > 0 ? '+' + formatNumber(d.switchGainPerYear) + '€' : '—'}</td><td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}12;border:1px solid ${recColor}30">${recIcon} ${d.recommendation}</span></td></tr>`;
  });
  html += `</tbody></table></div></div>`;

  if (cashOpportunities.length > 0) {
    html += `<div style="margin-top:16px"><h3 style="font-size:12px;color:var(--cyan);margin-bottom:8px">💰 Placer ${formatNumber(placable)}€</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;
    cashOpportunities.forEach((c, i) => { html += `<div style="background:var(--bg-elevated);border:1px solid ${i === 0 ? 'var(--cyan)' : 'var(--border)'};border-radius:var(--radius-sm);padding:10px">${i === 0 ? '<div style="font-size:9px;color:var(--cyan);margin-bottom:4px">⭐ RECOMMANDÉ</div>' : ''}<div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:11px;color:var(--text-bright)">${c.name}</strong><span style="font-family:var(--mono);color:var(--green);font-weight:700">${c.rate}%</span></div><div style="font-size:10px;color:var(--text-muted);margin-top:4px">${c.duration}m · <strong style="color:var(--green)">+${formatNumber(c.interestPerYear)}€/an</strong>${c.isScanned ? ' <span style="font-size:7px;color:var(--purple);background:rgba(139,92,246,0.15);padding:0 4px;border-radius:6px">web</span>' : ''}</div></div>`; });
    html += `</div></div>`;
  }
  return html;
}

// ═══ AI PROMPT ═══════════════════════════════════════════
async function getAIOptimizerSummary(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, optimizedInterest, optimizedRate } = analysis;
  const sourceLabel = _optimizerRateSource === 'confirmed' ? 'taux confirmés (import email/PDF)' : 'tous les taux (confirmés + indicatifs web)';

  const depositsText = depositAnalysis.map(d => {
    let line = `• ${d.name} (${d.bankName}) | ${d.amount}€ à ${d.rate}%`;
    if (d.currentPeriodRate !== d.rate) line += ` (palier: ${d.currentPeriodRate}%)`;
    line += ` | +${d.interestPerYear}€/an | ${d.remainingMonths}m restant`;
    if (d.exitPenalty) line += ` | Sortie: ${d.exitPenalty}`;
    if (d.bestAlt) { line += ` | Mieux: ${d.bestAlt.rate}% (${d.bestAlt.name})${d.bestAlt.isScanned ? ' [indicatif web]' : ''}`; }
    if (d.switchGainPerYear > 0) line += ` | Gain: +${d.switchGainPerYear}€/an`;
    line += ` | → ${d.recommendation}`;
    return line;
  }).join('\n');

  const cashText = placable > 0 && cashOpportunities.length > 0
    ? '\n\n💰 CASH: ' + formatNumber(placable) + '€\n' + cashOpportunities.slice(0, 3).map(c => `• ${c.name} à ${c.rate}% → +${c.interestPerYear}€/an${c.isScanned ? ' [web]' : ''}`).join('\n') : '';

  const prompt = `Directeur financier. Optimisation basée sur ${sourceLabel}.

**AVANT:** ${formatNumber(totalInvested)}€ à ${weightedRate.toFixed(2)}% = +${formatNumber(totalInterestPerYear)}€/an
**APRÈS:** ${optimizedRate.toFixed(2)}% = +${formatNumber(optimizedInterest)}€/an (${totalPotentialGain > 0 ? '+' + formatNumber(totalPotentialGain) + '€/an' : 'déjà optimisé'})

${depositAnalysis.length} CONTRATS:
${depositsText}${cashText}

Préavis 32 jours sur tous les CAT.

FORMAT (pas de tableau markdown):
- **AVANT: X€/an → APRÈS: Y€/an (+Z€)**
- Pour chaque arbitrage: 🔄 **[Nom]** montant€ à taux% → **[produit]** à taux% = **+gain€/an** ⚠️ [conditions]
- ✅ **[N] contrats** leaders
- Si taux web: préciser "(indicatif, à confirmer)"
- Max 150 mots`;

  const res = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || '';
}

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V3 — Persistent + Dashboard
// ═══════════════════════════════════════════════════════════════

let _lastOptimizerResult = null;

// Load saved optimizer result on startup
async function loadOptimizerResult() {
  try {
    const data = await github.readFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`);
    if (data) _lastOptimizerResult = data;
  } catch(e) {}
}

// Save optimizer result to GitHub
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
    actions: analysis.depositAnalysis.filter(d => d.recommendation !== 'GARDER').map(d => ({
      name: d.name, bankName: d.bankName, amount: d.amount, rate: d.rate,
      recommendation: d.recommendation, reason: d.reason,
      bestAlt: d.bestAlt, switchGainPerYear: d.switchGainPerYear,
    })),
  };
  _lastOptimizerResult = result;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`, result, '[StructBoard] Optimizer result');
}

// Override the Optimiser button — direct launch
const _origShowCATSimulator = showCATSimulator;
showCATSimulator = function() {
  const rates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  if (rates.length === 0) {
    showToast('Importez d\'abord les taux du marché (📊 Taux marché)', 'error');
    return;
  }
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

    html += '<div id="ai-optimizer-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse les arbitrages possibles...</div></div>';
    results.innerHTML = html;

    const aiSummary = await getAIOptimizerSummary(analysis);
    const aiDiv = document.getElementById('ai-optimizer-summary');
    if (aiDiv) aiDiv.innerHTML = `<div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);padding:16px"><h3 style="font-size:13px;color:var(--accent);margin-bottom:10px">🤖 Recommandations Claude</h3><div class="ai-summary" style="font-size:12px;line-height:1.6">${formatAIText(aiSummary)}</div></div>`;

    // SAVE to GitHub
    await saveOptimizerResult(aiSummary, analysis);
    showToast('Optimisation sauvegardée', 'success');
  } catch(e) {
    results.innerHTML = `<div style="color:var(--red);padding:16px">❌ Erreur: ${e.message}</div>`;
  }
}

// ═══ RENDER OPTIMIZER SUMMARY ON DASHBOARD ═══════════════
// This is injected by the renderCAT override in cat-patches
function renderOptimizerDashboard() {
  if (!_lastOptimizerResult) return '';
  const r = _lastOptimizerResult;
  const date = r.lastUpdated ? new Date(r.lastUpdated) : null;
  const dateStr = date ? date.toLocaleDateString('fr-FR') + ' à ' + date.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}) : '';

  return `<div class="section">
    <div class="section-header">
      <div class="section-title"><span class="dot" style="background:var(--purple)"></span>⚡ Dernière Optimisation</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:10px;color:var(--text-dim)">${dateStr}</span>
        <button class="btn sm ai-glow" onclick="showCATSimulator()">🔄 Re-optimiser</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:12px">
      <div style="background:var(--bg-card);padding:10px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement actuel</div>
        <div style="font-size:18px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(r.totalInterestPerYear)}€/an</div>
        <div style="font-size:10px;color:var(--text-dim)">${(r.weightedRate||0).toFixed(2)}%</div>
      </div>
      <div style="background:var(--bg-card);padding:10px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après optimisation</div>
        <div style="font-size:18px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono)">+${formatNumber(r.optimizedInterest)}€/an</div>
        <div style="font-size:10px;color:var(--text-dim)">${(r.optimizedRate||0).toFixed(2)}%</div>
      </div>
      <div style="background:var(--bg-card);padding:10px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Gain potentiel</div>
        <div style="font-size:18px;font-weight:800;color:${r.totalPotentialGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-family:var(--mono)">${r.totalPotentialGain > 0 ? '+' + formatNumber(r.totalPotentialGain) + '€' : '✅ Optimisé'}</div>
        <div style="font-size:10px;color:var(--text-dim)">${r.arbitrageCount || 0} arbitrage${(r.arbitrageCount||0) > 1 ? 's' : ''}</div>
      </div>
      <div style="background:var(--bg-card);padding:10px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Périmètre</div>
        <div style="font-size:18px;font-weight:800;color:var(--text-bright)">${r.depositCount || 0}</div>
        <div style="font-size:10px;color:var(--text-dim)">contrats vs ${r.rateCount || 0} taux</div>
      </div>
    </div>
    ${r.actions && r.actions.length > 0 ? `<div style="margin-bottom:8px">${r.actions.map(a => {
      const color = a.recommendation === 'ARBITRER' ? 'var(--orange)' : 'var(--cyan)';
      const icon = a.recommendation === 'ARBITRER' ? '🔄' : '👀';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-elevated);border-left:3px solid ${color};border-radius:0 var(--radius-sm) var(--radius-sm) 0;margin-bottom:4px;font-size:11px">
        <div><strong style="color:var(--text-bright)">${icon} ${a.name}</strong> <span style="color:var(--text-dim)">${a.bankName} · ${formatNumber(a.amount)}€</span></div>
        <div style="text-align:right"><span style="color:${color};font-weight:600">${a.recommendation}</span>${a.bestAlt ? '<div style="font-size:10px;color:var(--text-dim)">→ ' + a.bestAlt.name + ' ' + a.bestAlt.rate + '%</div>' : ''}</div>
      </div>`;
    }).join('')}</div>` : ''}
    ${r.summary ? `<div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:12px;font-size:11px;line-height:1.5"><strong style="color:var(--accent)">🤖 Résumé IA:</strong><div class="ai-summary" style="margin-top:4px">${formatAIText(r.summary)}</div></div>` : ''}
  </div>`;
}

// ═══ ANALYSIS + AI (unchanged from V2) ═══════════════════

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
    const interestToMaturity = d.estimatedInterest || Math.round(amount * (rate / 100) * (durationMonths / 12) * 100) / 100;
    const interestPerYear = Math.round(amount * (rate / 100) * 100) / 100;

    const allAlts = Object.values(bestByDuration).filter(r => r.rate > rate).sort((a, b) => b.rate - a.rate);
    const bestAlt = allAlts[0] || null;
    let switchGainPerYear = 0;
    if (bestAlt) switchGainPerYear = Math.round((amount * (bestAlt.rate / 100) - amount * (rate / 100)) * 100) / 100;

    let currentPeriodRate = rate;
    if (d.rateSchedule && d.rateSchedule.length > 0) { const nowStr = now.toISOString().split('T')[0]; const cp = d.rateSchedule.find(s => s.from <= nowStr && s.to >= nowStr); if (cp) currentPeriodRate = cp.rate; }

    let recommendation = 'GARDER', reason = 'Taux compétitif';
    if (bestAlt && bestAlt.rate > rate + 0.3) { recommendation = 'ARBITRER'; reason = `Passer sur ${bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm'} à ${bestAlt.rate}% → +${formatNumber(switchGainPerYear)}€/an`; }
    else if (bestAlt && bestAlt.rate > rate) { recommendation = 'SURVEILLER'; reason = `+${(bestAlt.rate - rate).toFixed(2)}% dispo mais écart faible`; }
    else if (rate >= (bestOverall?.rate || 0)) { reason = 'Meilleur que le marché actuel'; }

    return { id: d.id, name: d.productName || 'CAT', bankName: d.bankName, entity: d.entityName || '', amount, rate, currentPeriodRate, durationMonths, elapsedMonths, remainingMonths, earnedSoFar, interestToMaturity, interestPerYear, bestAlt: bestAlt ? { name: bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm', rate: bestAlt.rate, duration: bestAlt.durationMonths, bankName: bestAlt.bankName } : null, switchGainPerYear, recommendation, reason, maturityDate: d.maturityDate };
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

function renderOptimizationTable(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, optimizedInterest, optimizedRate, bestOverall } = analysis;

  let html = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:12px">
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestPerYear)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${weightedRate.toFixed(2)}% sur ${formatNumber(totalInvested)}€</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après optimisation</div><div style="font-size:20px;font-weight:800;color:${totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono)">+${formatNumber(optimizedInterest)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${optimizedRate.toFixed(2)}%${totalPotentialGain > 0 ? ' (+' + formatNumber(totalPotentialGain) + '€)' : ''}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Arbitrages</div><div style="font-size:20px;font-weight:800;color:${arbitrageCount > 0 ? 'var(--orange)' : 'var(--green)'}">${arbitrageCount > 0 ? '🔄 ' + arbitrageCount : '✅'}</div><div style="font-size:10px;color:var(--text-dim)">${arbitrageCount > 0 ? arbitrageCount + ' à réallouer' : 'Optimisé'}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Meilleur marché</div><div style="font-size:20px;font-weight:800;color:var(--accent);font-family:var(--mono)">${bestOverall ? bestOverall.rate + '%' : '—'}</div><div style="font-size:10px;color:var(--text-dim)">${bestOverall ? (bestOverall.productName || bestOverall.bankName + ' ' + bestOverall.durationMonths + 'm') : ''}</div></div>
  </div>`;

  html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="border-bottom:2px solid var(--border);text-align:left"><th style="padding:8px 6px;color:var(--text-muted)">Produit</th><th style="padding:8px 6px;color:var(--text-muted);text-align:right">Montant</th><th style="padding:8px 6px;color:var(--text-muted);text-align:center">Taux</th><th style="padding:8px 6px;color:var(--text-muted);text-align:right">Rdt/an</th><th style="padding:8px 6px;color:var(--text-muted);text-align:center">Restant</th><th style="padding:8px 6px;color:var(--text-muted);text-align:center">Meilleur dispo</th><th style="padding:8px 6px;color:var(--text-muted);text-align:right">Gain/an</th><th style="padding:8px 6px;color:var(--text-muted);text-align:center">Action</th></tr></thead><tbody>`;

  depositAnalysis.forEach(d => {
    const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
    const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
    html += `<tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 6px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div></td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td><td style="padding:8px 6px;text-align:center;color:${d.bestAlt && d.bestAlt.rate > d.rate ? 'var(--orange)' : 'var(--green)'};font-family:var(--mono);font-weight:600">${d.rate}%${d.currentPeriodRate !== d.rate ? '<div style="font-size:9px;color:var(--text-dim)">Palier: ' + d.currentPeriodRate + '%</div>' : ''}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(d.interestPerYear)}€</td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + d.bestAlt.rate + '%</span><div style="font-size:9px;color:var(--text-dim)">' + d.bestAlt.name + '</div>' : '<span style="color:var(--green)">Leader ✨</span>'}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${d.switchGainPerYear > 0 ? 'var(--green)' : 'var(--text-dim)'}">${d.switchGainPerYear > 0 ? '+' + formatNumber(d.switchGainPerYear) + '€' : '—'}</td><td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}15;border:1px solid ${recColor}33">${recIcon} ${d.recommendation}</span></td></tr>`;
  });

  html += `<tr style="border-top:2px solid var(--border);font-weight:600"><td style="padding:8px 6px;color:var(--text-bright)">TOTAL</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(totalInvested)}€</td><td style="padding:8px 6px;text-align:center;font-family:var(--mono)">${weightedRate.toFixed(2)}%</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(totalInterestPerYear)}€</td><td colspan="2" style="padding:8px 6px;text-align:center;font-size:10px;color:var(--text-muted)">→ ${optimizedRate.toFixed(2)}%</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:${totalPotentialGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-weight:700">${totalPotentialGain > 0 ? '+' + formatNumber(totalPotentialGain) + '€' : '✅'}</td><td></td></tr></tbody></table></div>`;

  if (cashOpportunities.length > 0) {
    html += `<div style="margin-top:16px"><h3 style="font-size:12px;color:var(--cyan);margin-bottom:8px">💰 Placer ${formatNumber(analysis.placable)}€</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;
    cashOpportunities.forEach((c, i) => { html += `<div style="background:var(--bg-elevated);border:1px solid ${i === 0 ? 'var(--cyan)' : 'var(--border)'};border-radius:var(--radius-sm);padding:10px">${i === 0 ? '<div style="font-size:9px;color:var(--cyan);margin-bottom:4px">⭐ RECOMMANDÉ</div>' : ''}<div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:11px;color:var(--text-bright)">${c.name}</strong><span style="font-family:var(--mono);color:var(--green);font-weight:700">${c.rate}%</span></div><div style="font-size:10px;color:var(--text-muted);margin-top:4px">${c.duration}m · <strong style="color:var(--green)">+${formatNumber(c.interestPerYear)}€/an</strong></div></div>`; });
    html += `</div></div>`;
  }
  return html;
}

async function getAIOptimizerSummary(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, optimizedInterest, optimizedRate } = analysis;
  const depositsText = depositAnalysis.map(d => `${d.name} (${d.bankName}) | ${d.amount}€ | ${d.rate}% | Rdt: ${d.interestPerYear}€/an | ${d.remainingMonths}m | Best: ${d.bestAlt ? d.bestAlt.rate + '% ' + d.bestAlt.name : 'Leader'} | ${d.recommendation}`).join('\n');
  const cashText = placable > 0 && cashOpportunities.length > 0 ? `\nCASH: ${placable}€\n` + cashOpportunities.slice(0, 3).map(c => `- ${c.name} ${c.rate}% → +${c.interestPerYear}€/an`).join('\n') : '';

  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: `Conseiller trésorerie. Recommandations CONCRÈTES.\n\nSITUATION: ${formatNumber(totalInvested)}€ à ${weightedRate.toFixed(2)}% = +${formatNumber(totalInterestPerYear)}€/an\nOPTIMISÉ: ${optimizedRate.toFixed(2)}% = +${formatNumber(optimizedInterest)}€/an\n\nCONTRATS:\n${depositsText}${cashText}\n\nFORMAT: 1) Tableau markdown: Produit|Action|Détail|Impact/an 2) AVANT/APRÈS chiffré 3) Max 3 bullets 4) Contraintes (préavis 32j) 5) Max 200 mots` }] }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || 'Pas de réponse.';
}

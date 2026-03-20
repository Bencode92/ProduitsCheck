// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V2 — NO LIMIT, DIRECT LAUNCH
// ═══════════════════════════════════════════════════════════════

const _origShowCATSimulator = showCATSimulator;
showCATSimulator = function() {
  const rates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  if (rates.length === 0) {
    showToast('Importez d\'abord les taux du marché (📊 Taux marché)', 'error');
    return;
  }
  // Direct launch — no form, no questions
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">⚡ Optimiseur de Trésorerie</h2>
    <div id="optimizer-results"><div style="display:flex;align-items:center;gap:10px;padding:30px;color:var(--text-muted);justify-content:center"><div class="spinner"></div>Analyse de vos ${catManager.deposits.filter(d=>d.status==='active').length} contrats vs ${rates.length} taux du marché...</div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
  // Auto-launch immediately
  setTimeout(() => runSmartOptimizer(), 100);
};

async function runSmartOptimizer() {
  const results = document.getElementById('optimizer-results');
  if (!results) return;

  try {
    const analysis = buildOptimizationAnalysis();
    let html = renderOptimizationTable(analysis);

    // AI summary placeholder
    html += '<div id="ai-optimizer-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse les arbitrages possibles...</div></div>';
    results.innerHTML = html;

    const aiSummary = await getAIOptimizerSummary(analysis);
    const aiDiv = document.getElementById('ai-optimizer-summary');
    if (aiDiv) aiDiv.innerHTML = `<div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);padding:16px"><h3 style="font-size:13px;color:var(--accent);margin-bottom:10px">🤖 Recommandations Claude</h3><div class="ai-summary" style="font-size:12px;line-height:1.6">${formatAIText(aiSummary)}</div></div>`;
  } catch(e) {
    results.innerHTML = `<div style="color:var(--red);padding:16px">❌ Erreur: ${e.message}</div>`;
  }
}

function buildOptimizationAnalysis() {
  const now = new Date();
  const active = catManager.deposits.filter(d => d.status === 'active');
  const rates = (catManager.rates?.rates || []).filter(r => !_isRateExpired(r));
  const obj = catManager.objectives;
  const cash = parseFloat(obj.availableCash) || 0;
  const reserve = parseFloat(obj.liquidityReserve) || 0;
  const placable = Math.max(0, cash - reserve);

  // Best rate by duration (all durations)
  const bestByDuration = {};
  rates.forEach(r => {
    const dur = r.durationMonths;
    if (!bestByDuration[dur] || r.rate > bestByDuration[dur].rate) bestByDuration[dur] = r;
  });

  // Overall best rate
  const bestOverall = rates.reduce((best, r) => r.rate > (best?.rate || 0) ? r : best, null);

  // Analyze each deposit — NO LIMIT
  const depositAnalysis = active.map(d => {
    const amount = parseFloat(d.amount) || 0;
    const rate = parseFloat(d.rate) || 0;
    const startDate = new Date(d.startDate);
    const maturityDate = new Date(d.maturityDate);
    const durationMonths = parseInt(d.durationMonths) || 0;
    const elapsedDays = Math.max(0, (now - startDate) / 86400000);
    const elapsedMonths = Math.round(elapsedDays / 30);
    const remainingMonths = Math.max(0, durationMonths - elapsedMonths);

    // Interest earned so far
    const earnedSoFar = typeof calcInterestAtExit === 'function'
      ? calcInterestAtExit(d, now.toISOString().split('T')[0])
      : Math.round(amount * (rate / 100) * (elapsedDays / 365) * 100) / 100;

    // Interest if held to maturity
    const interestToMaturity = d.estimatedInterest || Math.round(amount * (rate / 100) * (durationMonths / 12) * 100) / 100;
    const remainingInterest = Math.max(0, Math.round((interestToMaturity - earnedSoFar) * 100) / 100);

    // Annual interest
    const interestPerYear = Math.round(amount * (rate / 100) * 100) / 100;

    // Find best market alternatives — compare ALL durations
    const allAlts = Object.values(bestByDuration)
      .filter(r => r.rate > rate)
      .sort((a, b) => b.rate - a.rate);
    const bestAlt = allAlts[0] || null;

    // Also find best for SAME duration
    const sameDurAlts = rates.filter(r => r.durationMonths === durationMonths && r.rate > rate).sort((a, b) => b.rate - a.rate);
    const sameDurBest = sameDurAlts[0] || null;

    // Calculate annual gain if switch to best
    let switchGainPerYear = 0;
    if (bestAlt) {
      const newInterestPerYear = Math.round(amount * (bestAlt.rate / 100) * 100) / 100;
      switchGainPerYear = Math.round((newInterestPerYear - interestPerYear) * 100) / 100;
    }

    // Determine current period rate (for progressive)
    let currentPeriodRate = rate;
    if (d.rateSchedule && d.rateSchedule.length > 0) {
      const nowStr = now.toISOString().split('T')[0];
      const currentPeriod = d.rateSchedule.find(s => s.from <= nowStr && s.to >= nowStr);
      if (currentPeriod) currentPeriodRate = currentPeriod.rate;
    }

    // Recommendation
    let recommendation = 'GARDER';
    let reason = 'Taux compétitif';
    if (bestAlt && bestAlt.rate > rate + 0.3) {
      recommendation = 'ARBITRER';
      reason = `Passer sur ${bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm'} à ${bestAlt.rate}% → +${formatNumber(switchGainPerYear)}€/an`;
    } else if (bestAlt && bestAlt.rate > rate) {
      recommendation = 'SURVEILLER';
      reason = `+${(bestAlt.rate - rate).toFixed(2)}% dispo mais écart faible`;
    } else if (rate >= (bestOverall?.rate || 0)) {
      recommendation = 'GARDER';
      reason = 'Meilleur que le marché actuel';
    }

    return {
      id: d.id, name: d.productName || 'CAT', bankName: d.bankName, entity: d.entityName || '',
      amount, rate, currentPeriodRate, durationMonths, elapsedMonths, remainingMonths,
      earnedSoFar, remainingInterest, interestToMaturity, interestPerYear,
      bestAlt: bestAlt ? { name: bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm', rate: bestAlt.rate, duration: bestAlt.durationMonths, bankName: bestAlt.bankName } : null,
      sameDurBest: sameDurBest ? { name: sameDurBest.productName || sameDurBest.bankName, rate: sameDurBest.rate } : null,
      switchGainPerYear, recommendation, reason, maturityDate: d.maturityDate,
    };
  });

  // Cash placement — top 5 best rates
  const cashOpportunities = [];
  if (placable > 0) {
    [...rates].sort((a, b) => b.rate - a.rate).slice(0, 5).forEach(r => {
      const interest = Math.round(placable * (r.rate / 100) * (r.durationMonths / 12) * 100) / 100;
      const interestPerYear = Math.round(placable * (r.rate / 100) * 100) / 100;
      cashOpportunities.push({ name: r.productName || r.bankName + ' ' + r.durationMonths + 'm', rate: r.rate, duration: r.durationMonths, bankName: r.bankName, interest, interestPerYear, amount: placable });
    });
  }

  const totalInvested = depositAnalysis.reduce((s, d) => s + d.amount, 0);
  const totalInterestPerYear = depositAnalysis.reduce((s, d) => s + d.interestPerYear, 0);
  const weightedRate = totalInvested > 0 ? totalInterestPerYear / totalInvested * 100 : 0;
  const totalPotentialGain = depositAnalysis.filter(d => d.switchGainPerYear > 0).reduce((s, d) => s + d.switchGainPerYear, 0);
  const arbitrageCount = depositAnalysis.filter(d => d.recommendation === 'ARBITRER').length;

  // Optimized rate if all arbitrages done
  const optimizedInterest = depositAnalysis.reduce((s, d) => {
    if (d.recommendation === 'ARBITRER' && d.bestAlt) return s + Math.round(d.amount * (d.bestAlt.rate / 100) * 100) / 100;
    return s + d.interestPerYear;
  }, 0);
  const optimizedRate = totalInvested > 0 ? optimizedInterest / totalInvested * 100 : 0;

  return { depositAnalysis, cashOpportunities, placable, reserve, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, bestByDuration, bestOverall, optimizedInterest, optimizedRate };
}

function renderOptimizationTable(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, optimizedInterest, optimizedRate, bestOverall } = analysis;

  let html = `<div style="margin-bottom:16px">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:12px">
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement actuel</div>
        <div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestPerYear)}€/an</div>
        <div style="font-size:10px;color:var(--text-dim)">${weightedRate.toFixed(2)}% moy. sur ${formatNumber(totalInvested)}€</div>
      </div>
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après optimisation</div>
        <div style="font-size:20px;font-weight:800;color:${totalPotentialGain > 0 ? 'var(--cyan)' : 'var(--green)'};font-family:var(--mono)">+${formatNumber(optimizedInterest)}€/an</div>
        <div style="font-size:10px;color:var(--text-dim)">${optimizedRate.toFixed(2)}% moy.${totalPotentialGain > 0 ? ' (+' + formatNumber(totalPotentialGain) + '€)' : ''}</div>
      </div>
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Arbitrages</div>
        <div style="font-size:20px;font-weight:800;color:${arbitrageCount > 0 ? 'var(--orange)' : 'var(--green)'}">${arbitrageCount > 0 ? '🔄 ' + arbitrageCount : '✅'}</div>
        <div style="font-size:10px;color:var(--text-dim)">${arbitrageCount > 0 ? arbitrageCount + ' à réallouer' : 'Portefeuille optimisé'}</div>
      </div>
      <div style="background:var(--bg-card);padding:12px;text-align:center">
        <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Meilleur marché</div>
        <div style="font-size:20px;font-weight:800;color:var(--accent);font-family:var(--mono)">${bestOverall ? bestOverall.rate + '%' : '—'}</div>
        <div style="font-size:10px;color:var(--text-dim)">${bestOverall ? (bestOverall.productName || bestOverall.bankName + ' ' + bestOverall.durationMonths + 'm') : ''}</div>
      </div>
    </div>
  </div>`;

  // Comparison table
  html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="border-bottom:2px solid var(--border);text-align:left">
      <th style="padding:8px 6px;color:var(--text-muted)">Produit</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:right">Montant</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Taux actuel</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:right">Rdt/an</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Restant</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Meilleur dispo</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:right">Gain/an</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Action</th>
    </tr></thead><tbody>`;

  depositAnalysis.forEach(d => {
    const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
    const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
    const rateColor = d.bestAlt && d.bestAlt.rate > d.rate ? 'var(--orange)' : 'var(--green)';
    html += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 6px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div></td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td>
      <td style="padding:8px 6px;text-align:center;color:${rateColor};font-family:var(--mono);font-weight:600">${d.rate}%${d.currentPeriodRate !== d.rate ? '<div style="font-size:9px;color:var(--text-dim)">Palier: ' + d.currentPeriodRate + '%</div>' : ''}</td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(d.interestPerYear)}€</td>
      <td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m<div style="font-size:9px;color:var(--text-dim)">${d.maturityDate ? formatDate(d.maturityDate) : ''}</div></td>
      <td style="padding:8px 6px;text-align:center;font-size:10px">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:700;color:' + (d.bestAlt.rate > d.rate ? 'var(--cyan)' : 'var(--text-dim)') + '">' + d.bestAlt.rate + '%</span><div style="font-size:9px;color:var(--text-dim)">' + d.bestAlt.name + '</div>' : '<span style="color:var(--green)">Leader ✨</span>'}</td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${d.switchGainPerYear > 0 ? 'var(--green)' : 'var(--text-dim)'}">${d.switchGainPerYear > 0 ? '+' + formatNumber(d.switchGainPerYear) + '€' : '—'}</td>
      <td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}15;border:1px solid ${recColor}33">${recIcon} ${d.recommendation}</span><div style="font-size:9px;color:var(--text-dim);margin-top:2px;max-width:120px">${d.reason}</div></td>
    </tr>`;
  });

  // Total row
  html += `<tr style="border-top:2px solid var(--border);font-weight:600">
    <td style="padding:8px 6px;color:var(--text-bright)">TOTAL</td>
    <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(totalInvested)}€</td>
    <td style="padding:8px 6px;text-align:center;font-family:var(--mono);color:var(--text-bright)">${weightedRate.toFixed(2)}%</td>
    <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(totalInterestPerYear)}€</td>
    <td colspan="2" style="padding:8px 6px;text-align:center;font-size:10px;color:var(--text-muted)">Optimisé: ${optimizedRate.toFixed(2)}%</td>
    <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:${totalPotentialGain > 0 ? 'var(--green)' : 'var(--text-dim)'};font-weight:700">${totalPotentialGain > 0 ? '+' + formatNumber(totalPotentialGain) + '€' : '✅'}</td>
    <td></td>
  </tr>`;
  html += `</tbody></table></div>`;

  // Cash opportunities
  if (cashOpportunities.length > 0) {
    html += `<div style="margin-top:16px"><h3 style="font-size:12px;color:var(--cyan);margin-bottom:8px">💰 Placer ${formatNumber(analysis.placable)}€ de liquidités disponibles</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;
    cashOpportunities.forEach((c, i) => {
      html += `<div style="background:var(--bg-elevated);border:1px solid ${i === 0 ? 'var(--cyan)' : 'var(--border)'};border-radius:var(--radius-sm);padding:10px${i === 0 ? ';box-shadow:0 0 8px rgba(34,211,238,0.1)' : ''}">
        ${i === 0 ? '<div style="font-size:9px;color:var(--cyan);margin-bottom:4px">⭐ RECOMMANDÉ</div>' : ''}
        <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:11px;color:var(--text-bright)">${c.name}</strong><span style="font-family:var(--mono);color:var(--green);font-weight:700">${c.rate}%</span></div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${c.duration}m · <strong style="color:var(--green)">+${formatNumber(c.interestPerYear)}€/an</strong></div>
      </div>`;
    });
    html += `</div></div>`;
  }

  return html;
}

async function getAIOptimizerSummary(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, weightedRate, totalPotentialGain, arbitrageCount, optimizedInterest, optimizedRate } = analysis;

  const depositsText = depositAnalysis.map(d =>
    `${d.name} (${d.bankName}${d.entity ? '/' + d.entity : ''}) | ${d.amount}€ | ${d.rate}% TRAAB | Palier actuel: ${d.currentPeriodRate}% | Rdt: ${d.interestPerYear}€/an | Restant: ${d.remainingMonths}m | Meilleur: ${d.bestAlt ? d.bestAlt.rate + '% (' + d.bestAlt.name + ')' : 'Leader'} | Gain: ${d.switchGainPerYear > 0 ? '+' + d.switchGainPerYear + '€/an' : '—'} | ${d.recommendation}`
  ).join('\n');

  const cashText = placable > 0 && cashOpportunities.length > 0
    ? `\nCASH DISPONIBLE: ${placable}€\nTop placements:\n` + cashOpportunities.slice(0, 3).map(c => `- ${c.name} ${c.rate}% (${c.duration}m) → +${c.interestPerYear}€/an`).join('\n')
    : '';

  const prompt = `Conseiller trésorerie d'entreprise. Analyse et recommandations CONCRÈTES.

SITUATION: ${formatNumber(totalInvested)}€ placés à ${weightedRate.toFixed(2)}% = +${formatNumber(totalInterestPerYear)}€/an
OPTIMISÉ: ${optimizedRate.toFixed(2)}% = +${formatNumber(optimizedInterest)}€/an (${totalPotentialGain > 0 ? '+' + formatNumber(totalPotentialGain) + '€/an' : 'déjà optimisé'})
ARBITRAGES: ${arbitrageCount}

CONTRATS:
${depositsText}
${cashText}

FORMAT STRICT:
1. Un TABLEAU markdown: Produit | Action | Détail | Impact/an
2. Ligne AVANT/APRÈS: "Rendement actuel: X€/an → Après optim: Y€/an (+Z€)"
3. Max 3 bullets de résumé
4. Si un contrat a un meilleur taux dispo: "Sortir de [X] à échéance/préavis → placer sur [Y] = +Z€/an"
5. Contraintes: préavis 32j, pénalités progressifs
6. Max 250 mots total`;

  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || 'Pas de réponse.';
}

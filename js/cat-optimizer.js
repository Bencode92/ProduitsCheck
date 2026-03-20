// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V1
// Compares current deposits vs market rates, proposes arbitrages
// ═══════════════════════════════════════════════════════════════

// Override the Optimiser button to use smart optimizer
const _origShowCATSimulator = showCATSimulator;
showCATSimulator = function() {
  const modal = document.getElementById('modal');
  const stats = catManager.getStats();
  const obj = catManager.objectives;
  const cash = parseFloat(obj.availableCash) || 0;
  const reserve = parseFloat(obj.liquidityReserve) || 0;
  const placable = Math.max(0, cash - reserve);
  const rates = catManager.rates?.rates || [];
  const activeRates = rates.filter(r => !_isRateExpired(r));

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">⚡ Optimiseur de Trésorerie</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Analyse vos contrats vs les taux du marché. Identifie les arbitrages rentables et optimise votre cash.</p>

    <div class="stats-row" style="margin-bottom:16px">
      <div class="stat-card green"><div class="stat-label">Placé</div><div class="stat-value">${formatNumber(stats.totalInvested)}€</div><div class="stat-sub">${stats.weightedRate ? formatPct(stats.weightedRate) + ' moy.' : '—'}</div></div>
      <div class="stat-card cyan"><div class="stat-label">Cash à placer</div><div class="stat-value">${formatNumber(placable)}€</div><div class="stat-sub">${cash > 0 ? 'Après réserve ' + formatNumber(reserve) + '€' : 'Saisir dans 🎯 Objectifs'}</div></div>
      <div class="stat-card orange"><div class="stat-label">Taux marché</div><div class="stat-value">${activeRates.length}</div><div class="stat-sub">${activeRates.length > 0 ? 'Meilleur: ' + Math.max(...activeRates.map(r=>r.rate)).toFixed(2) + '%' : 'Importez des taux'}</div></div>
    </div>

    ${activeRates.length === 0 ? '<div class="alert-bar"><span>⚠️</span><span>Importez d\'abord les taux du marché (📊 Taux marché) pour que l\'optimiseur puisse comparer.</span></div>' : ''}

    <button class="btn ai-glow lg" style="width:100%;margin:12px 0" onclick="runSmartOptimizer()" ${activeRates.length === 0 ? 'disabled style="width:100%;margin:12px 0;opacity:0.5"' : ''}>🚀 Lancer l'optimisation</button>

    <div id="optimizer-results"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

async function runSmartOptimizer() {
  const results = document.getElementById('optimizer-results');
  if (!results) return;
  results.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse en cours... Comparaison de vos contrats vs le marché</div>';

  try {
    // 1. Build comparison data
    const analysis = buildOptimizationAnalysis();

    // 2. Display raw comparison table
    let html = renderOptimizationTable(analysis);

    // 3. Send to Claude for smart summary
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

  // Best rate by duration
  const bestByDuration = {};
  rates.forEach(r => {
    const dur = r.durationMonths;
    if (!bestByDuration[dur] || r.rate > bestByDuration[dur].rate) bestByDuration[dur] = r;
  });

  // Analyze each deposit
  const depositAnalysis = active.map(d => {
    const amount = parseFloat(d.amount) || 0;
    const rate = parseFloat(d.rate) || 0;
    const startDate = new Date(d.startDate);
    const maturityDate = new Date(d.maturityDate);
    const durationMonths = parseInt(d.durationMonths) || 0;
    const elapsedDays = Math.max(0, (now - startDate) / 86400000);
    const elapsedMonths = Math.round(elapsedDays / 30);
    const remainingMonths = Math.max(0, durationMonths - elapsedMonths);
    const remainingDays = Math.max(0, (maturityDate - now) / 86400000);

    // Interest earned so far (using schedule if available)
    const earnedSoFar = typeof calcInterestAtExit === 'function'
      ? calcInterestAtExit(d, now.toISOString().split('T')[0])
      : Math.round(amount * (rate / 100) * (elapsedDays / 365) * 100) / 100;

    // Interest if held to maturity
    const interestToMaturity = d.estimatedInterest || Math.round(amount * (rate / 100) * (durationMonths / 12) * 100) / 100;
    const remainingInterest = Math.round((interestToMaturity - earnedSoFar) * 100) / 100;

    // Current effective annual rate for remaining period
    const currentEffectiveRate = rate; // simplified — could be more precise with schedule

    // Find best market alternative for remaining duration
    const closestDurations = Object.keys(bestByDuration).map(Number).sort((a, b) => Math.abs(a - remainingMonths) - Math.abs(b - remainingMonths));
    const bestAltDur = closestDurations[0];
    const bestAlt = bestAltDur ? bestByDuration[bestAltDur] : null;

    // Calculate gain if switch
    let switchGain = 0;
    let switchInterest = 0;
    if (bestAlt && bestAlt.rate > 0) {
      // Interest with new rate for remaining period
      switchInterest = Math.round(amount * (bestAlt.rate / 100) * (remainingMonths / 12) * 100) / 100;
      switchGain = Math.round((switchInterest - remainingInterest) * 100) / 100;
    }

    // Determine recommendation
    let recommendation = 'GARDER';
    let reason = 'Taux compétitif';
    if (bestAlt && bestAlt.rate > rate + 0.3) {
      recommendation = 'ARBITRER';
      reason = `+${(bestAlt.rate - rate).toFixed(2)}% avec ${bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm'}`;
    } else if (bestAlt && bestAlt.rate > rate) {
      recommendation = 'SURVEILLER';
      reason = `+${(bestAlt.rate - rate).toFixed(2)}% possible mais écart faible`;
    } else if (remainingMonths <= 3) {
      recommendation = 'GARDER';
      reason = 'Échéance proche (' + remainingMonths + ' mois)';
    }

    return {
      id: d.id,
      name: d.productName || 'CAT',
      bankName: d.bankName,
      entity: d.entityName || '',
      amount,
      rate,
      durationMonths,
      elapsedMonths,
      remainingMonths,
      earnedSoFar,
      remainingInterest,
      interestToMaturity,
      interestPerYear: Math.round(amount * (rate / 100) * 100) / 100,
      bestAlt: bestAlt ? { name: bestAlt.productName || bestAlt.bankName + ' ' + bestAlt.durationMonths + 'm', rate: bestAlt.rate, duration: bestAlt.durationMonths, bankName: bestAlt.bankName } : null,
      switchGain,
      switchInterest,
      recommendation,
      reason,
      maturityDate: d.maturityDate,
    };
  });

  // Cash placement opportunities
  const cashOpportunities = [];
  if (placable > 0) {
    const sortedRates = [...rates].sort((a, b) => b.rate - a.rate).slice(0, 5);
    sortedRates.forEach(r => {
      const interest = Math.round(placable * (r.rate / 100) * (r.durationMonths / 12) * 100) / 100;
      const interestPerYear = Math.round(placable * (r.rate / 100) * 100) / 100;
      cashOpportunities.push({ name: r.productName || r.bankName + ' ' + r.durationMonths + 'm', rate: r.rate, duration: r.durationMonths, bankName: r.bankName, interest, interestPerYear, amount: placable });
    });
  }

  // Totals
  const totalInvested = depositAnalysis.reduce((s, d) => s + d.amount, 0);
  const totalInterestPerYear = depositAnalysis.reduce((s, d) => s + d.interestPerYear, 0);
  const totalPotentialGain = depositAnalysis.filter(d => d.recommendation === 'ARBITRER').reduce((s, d) => s + d.switchGain, 0);
  const arbitrageCount = depositAnalysis.filter(d => d.recommendation === 'ARBITRER').length;

  return { depositAnalysis, cashOpportunities, placable, reserve, totalInvested, totalInterestPerYear, totalPotentialGain, arbitrageCount, bestByDuration };
}

function renderOptimizationTable(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, totalPotentialGain, arbitrageCount } = analysis;

  let html = `<div style="margin-bottom:16px">
    <div class="stats-row">
      <div class="stat-card blue"><div class="stat-label">Rendement annuel</div><div class="stat-value">+${formatNumber(totalInterestPerYear)}€</div><div class="stat-sub">${totalInvested > 0 ? (totalInterestPerYear / totalInvested * 100).toFixed(2) + '% sur ' + formatNumber(totalInvested) + '€' : '—'}</div></div>
      <div class="stat-card ${arbitrageCount > 0 ? 'orange' : 'green'}"><div class="stat-label">Arbitrages</div><div class="stat-value">${arbitrageCount > 0 ? arbitrageCount + ' opportunité' + (arbitrageCount > 1 ? 's' : '') : '✅ OK'}</div><div class="stat-sub">${totalPotentialGain > 0 ? '+' + formatNumber(totalPotentialGain) + '€ potentiel' : 'Portefeuille optimisé'}</div></div>
      ${placable > 0 ? `<div class="stat-card cyan"><div class="stat-label">Cash à placer</div><div class="stat-value">${formatNumber(placable)}€</div><div class="stat-sub">${cashOpportunities.length > 0 ? 'Meilleur: ' + cashOpportunities[0].rate + '% (' + cashOpportunities[0].name + ')' : ''}</div></div>` : ''}
    </div>
  </div>`;

  // Deposit comparison table
  html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="border-bottom:2px solid var(--border);text-align:left">
      <th style="padding:8px 6px;color:var(--text-muted)">Produit</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:right">Montant</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Taux</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:right">Rdt/an</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Restant</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Meilleur marché</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:right">Gain switch</th>
      <th style="padding:8px 6px;color:var(--text-muted);text-align:center">Action</th>
    </tr></thead><tbody>`;

  depositAnalysis.forEach(d => {
    const recColor = d.recommendation === 'ARBITRER' ? 'var(--orange)' : d.recommendation === 'SURVEILLER' ? 'var(--cyan)' : 'var(--green)';
    const recIcon = d.recommendation === 'ARBITRER' ? '🔄' : d.recommendation === 'SURVEILLER' ? '👀' : '✅';
    html += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 6px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity ? ' · ' + d.entity : ''}</div></td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td>
      <td style="padding:8px 6px;text-align:center;color:var(--green);font-family:var(--mono);font-weight:600">${d.rate}%</td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+${formatNumber(d.interestPerYear)}€</td>
      <td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td>
      <td style="padding:8px 6px;text-align:center;font-size:10px">${d.bestAlt ? '<span style="font-family:var(--mono);font-weight:600;color:' + (d.bestAlt.rate > d.rate ? 'var(--cyan)' : 'var(--text-dim)') + '">' + d.bestAlt.rate + '%</span><br>' + d.bestAlt.name : '—'}</td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:${d.switchGain > 0 ? 'var(--green)' : 'var(--text-dim)'}">${d.switchGain > 0 ? '+' + formatNumber(d.switchGain) + '€' : '—'}</td>
      <td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${recColor};background:${recColor}15;border:1px solid ${recColor}33">${recIcon} ${d.recommendation}</span></td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  // Cash opportunities
  if (cashOpportunities.length > 0) {
    html += `<div style="margin-top:16px"><h3 style="font-size:12px;color:var(--cyan);margin-bottom:8px">💰 Placer ${formatNumber(analysis.placable)}€ de liquidités</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;
    cashOpportunities.forEach(c => {
      html += `<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px">
        <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:11px;color:var(--text-bright)">${c.name}</strong><span style="font-family:var(--mono);color:var(--green);font-weight:700">${c.rate}%</span></div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${c.duration}m · +${formatNumber(c.interestPerYear)}€/an · Total: +${formatNumber(c.interest)}€</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  return html;
}

async function getAIOptimizerSummary(analysis) {
  const { depositAnalysis, cashOpportunities, placable, totalInvested, totalInterestPerYear, totalPotentialGain, arbitrageCount } = analysis;

  const depositsText = depositAnalysis.map(d =>
    `${d.name} (${d.bankName}) | ${d.amount}€ | ${d.rate}% | Rdt/an: ${d.interestPerYear}€ | Restant: ${d.remainingMonths}m | Meilleur marché: ${d.bestAlt ? d.bestAlt.rate + '% (' + d.bestAlt.name + ')' : 'N/A'} | Gain switch: ${d.switchGain > 0 ? '+' + d.switchGain + '€' : '—'} | ${d.recommendation}: ${d.reason}`
  ).join('\n');

  const cashText = placable > 0 && cashOpportunities.length > 0
    ? `\nCASH À PLACER: ${placable}€\nMeilleures opportunités:\n` + cashOpportunities.map(c => `- ${c.name} ${c.rate}% (${c.duration}m) → +${c.interestPerYear}€/an`).join('\n')
    : '';

  const prompt = `Tu es un conseiller en trésorerie d'entreprise. Analyse cette optimisation et donne des recommandations CONCRÈTES et CHIFFRÉES.

PORTEFEUILLE: ${totalInvested}€ placés | Rendement: ${totalInterestPerYear}€/an | ${arbitrageCount} arbitrage(s) possibles | Gain potentiel: +${totalPotentialGain}€

CONTRATS:
${depositsText}
${cashText}

RÈGLES:
- Sois TRÈS concis (max 200 mots)
- Un TABLEAU markdown des actions recommandées: Produit | Action | Montant | Nouveau placement | Gain annuel
- 3 BULLETS max de résumé avec les chiffres clés
- Si des contrats sont sous le marché, dis clairement: "Sortir de X et placer sur Y = +Z€/an"
- Compare le rendement annuel AVANT et APRÈS optimisation
- Mentionne les contraintes (préavis 32j, pénalités éventuelles)
- Si le portefeuille est bien optimisé, dis-le`;

  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || 'Pas de réponse.';
}

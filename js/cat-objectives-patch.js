// ═══ CAT Objectives Patch — Fixed annual interest + rate % + optimizer placement ═══

const _origShowCATObjectivesModal = showCATObjectivesModal;
showCATObjectivesModal = function() {
  const obj = catManager.objectives;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">🎯 Objectifs & Trésorerie</h2>
    <div class="form-grid">
      <div class="form-field" style="grid-column:span 2"><label style="color:var(--green)">💰 Cash disponible à placer (€)</label><input id="obj-cash" type="number" value="${obj.availableCash || 0}" placeholder="0" style="font-size:16px;font-weight:600">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Liquidités non investies, prêtes à être placées</div></div>
      <div class="form-field"><label>Réserve de sécurité (€)</label><input id="obj-reserve" type="number" value="${obj.liquidityReserve}" placeholder="0">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Montant à ne jamais placer (BFR)</div></div>
      <div class="form-field"><label>Besoin mensuel (€)</label><input id="obj-monthly" type="number" value="${obj.monthlyNeed}" placeholder="0">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Décaissements récurrents</div></div>
      <div class="form-field"><label>Plafond FGDR par banque (€)</label><input id="obj-maxbank" type="number" value="${obj.maxPerBank}" placeholder="100000"></div>
      <div class="form-field full"><label>Notes</label><textarea id="obj-notes" style="min-height:60px">${obj.notes || ''}</textarea></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="saveCATObjectivesV2()">Enregistrer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

async function saveCATObjectivesV2() {
  catManager.objectives = {
    monthlyNeed: parseFloat(document.getElementById('obj-monthly').value) || 0,
    liquidityReserve: parseFloat(document.getElementById('obj-reserve').value) || 0,
    availableCash: parseFloat(document.getElementById('obj-cash').value) || 0,
    maxPerBank: parseFloat(document.getElementById('obj-maxbank').value) || 100000,
    notes: document.getElementById('obj-notes').value,
  };
  closeModal();
  await catManager.saveObjectives();
  showToast('Objectifs sauvegardés', 'success');
  app.setState({ view: 'cat' });
  renderCAT(document.getElementById('main-content'));
}

// Override renderCAT — visual header with CORRECT annual interest
const _origRenderCATForHeader = renderCAT;
renderCAT = function(container) {
  _origRenderCATForHeader(container);

  const statsRow = container.querySelector('.stats-row');
  if (!statsRow) return;

  const stats = catManager.getStats();
  const obj = catManager.objectives;
  const cash = parseFloat(obj.availableCash) || 0;
  const reserve = parseFloat(obj.liquidityReserve) || 0;
  const totalTreasury = stats.totalInvested + cash;
  const placable = Math.max(0, cash - reserve);
  const nbBanks = Object.keys(stats.byBank).length;
  const fgdrCount = stats.fgdrAlerts.length;

  // FIX: Calculate TRUE annual interest = sum(amount * rate / 100) per deposit
  // NOT stats.totalInterest which is total over the entire duration
  const active = catManager.deposits.filter(d => d.status === 'active');
  const annualInterest = active.reduce((sum, d) => {
    const amount = parseFloat(d.amount) || 0;
    const rate = parseFloat(d.rate) || 0;
    return sum + Math.round(amount * (rate / 100) * 100) / 100;
  }, 0);
  const totalInterestAllTime = stats.totalInterest; // total over all durations

  // Weighted rate
  const weightedRate = stats.weightedRate || 0;

  // Best market rate comparison
  const bestRate = catManager.rates?.rates?.reduce((max, r) => r.rate > max ? r.rate : max, 0) || 0;
  const rateVsMarket = bestRate > 0 && weightedRate > 0
    ? (weightedRate >= bestRate ? '✅ Au-dessus du marché' : '⚠️ -' + (bestRate - weightedRate).toFixed(2) + '% vs meilleur')
    : '';

  // Calculate early exit value (what you'd get if you exited ALL now)
  const nowStr = new Date().toISOString().split('T')[0];
  let earlyExitInterest = 0;
  if (typeof calcInterestAtExit === 'function') {
    earlyExitInterest = active.reduce((sum, d) => sum + calcInterestAtExit(d, nowStr), 0);
  }

  const dashHTML = `
    <div style="background:linear-gradient(135deg,var(--bg-elevated),var(--bg-card));border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:15px;font-weight:700;color:var(--text-bright)">💰 TRÉSORERIE</div>
        <div style="display:flex;gap:8px">
          <button class="btn sm" onclick="showCATObjectivesModal()" style="font-size:11px">🎯 Objectifs</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden">
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Trésorerie totale</div>
          <div style="font-size:22px;font-weight:800;color:var(--text-bright);font-family:var(--mono)">${formatNumber(totalTreasury)}€</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${stats.totalDeposits} plac. · ${nbBanks} banque${nbBanks > 1 ? 's' : ''}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Placé</div>
          <div style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono)">${formatNumber(stats.totalInvested)}€</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${weightedRate ? formatPct(weightedRate) + ' moy. TRAAB' : '—'}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Liquidités</div>
          <div style="font-size:22px;font-weight:800;color:${cash > 0 ? 'var(--cyan)' : 'var(--text-dim)'};font-family:var(--mono)">${formatNumber(cash)}€</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${placable > 0 ? formatNumber(placable) + '€ à placer' : cash > 0 ? 'Réserve couverte' : 'Cliquez 🎯'}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Rendement / an</div>
          <div style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(annualInterest)}€</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${weightedRate ? formatPct(weightedRate) + '/an' : '—'} ${rateVsMarket ? '· ' + rateVsMarket : ''}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Risque FGDR</div>
          <div style="font-size:22px;font-weight:800;color:${fgdrCount > 0 ? 'var(--orange)' : 'var(--green)'}">${fgdrCount > 0 ? '⚠️ ' + fgdrCount : '✅'}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${fgdrCount > 0 ? fgdrCount + ' dépass.' : 'OK'}</div>
        </div>
      </div>
      <!-- Second row: more details -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-top:1px">
        <div style="background:var(--bg-card);padding:10px 16px;text-align:center">
          <div style="font-size:9px;text-transform:uppercase;color:var(--text-dim)">Intérêts totaux (sur durée)</div>
          <div style="font-size:14px;font-weight:700;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestAllTime)}€</div>
        </div>
        <div style="background:var(--bg-card);padding:10px 16px;text-align:center">
          <div style="font-size:9px;text-transform:uppercase;color:var(--text-dim)">Intérêts acquis (si sortie ajd)</div>
          <div style="font-size:14px;font-weight:700;color:${earlyExitInterest > 0 ? 'var(--orange)' : 'var(--text-dim)'};font-family:var(--mono)">${earlyExitInterest > 0 ? '+' + formatNumber(earlyExitInterest) + '€' : '—'}</div>
        </div>
        <div style="background:var(--bg-card);padding:10px 16px;text-align:center">
          <div style="font-size:9px;text-transform:uppercase;color:var(--text-dim)">Meilleur taux marché</div>
          <div style="font-size:14px;font-weight:700;color:var(--accent);font-family:var(--mono)">${bestRate > 0 ? bestRate.toFixed(2) + '%' : '—'}</div>
        </div>
      </div>
      ${cash > 0 || stats.totalInvested > 0 ? `<div style="margin-top:12px;display:flex;gap:4px;height:8px;border-radius:4px;overflow:hidden">
        <div style="flex:${stats.totalInvested};background:var(--green);border-radius:4px 0 0 4px" title="Placé: ${formatNumber(stats.totalInvested)}€"></div>
        ${reserve > 0 ? `<div style="flex:${reserve};background:var(--orange)" title="Réserve: ${formatNumber(reserve)}€"></div>` : ''}
        ${placable > 0 ? `<div style="flex:${placable};background:var(--cyan);border-radius:0 4px 4px 0" title="À placer: ${formatNumber(placable)}€"></div>` : ''}
      </div>
      <div style="display:flex;gap:12px;margin-top:6px;font-size:10px">
        <span style="color:var(--green)">■ Placé</span>
        ${reserve > 0 ? '<span style="color:var(--orange)">■ Réserve</span>' : ''}
        ${placable > 0 ? '<span style="color:var(--cyan)">■ À placer</span>' : ''}
      </div>` : ''}
    </div>`;

  statsRow.outerHTML = dashHTML;

  // ═══ INJECT OPTIMIZER ═══
  if (typeof renderOptimizerDashboard === 'function') {
    const optimizerHTML = renderOptimizerDashboard();
    if (optimizerHTML) {
      const allSections = container.querySelectorAll('.section');
      let marketRatesSection = null;
      allSections.forEach(s => { const t = s.querySelector('.section-title'); if (t && t.textContent.includes('Taux du Marché')) marketRatesSection = s; });
      if (marketRatesSection) marketRatesSection.insertAdjacentHTML('beforebegin', optimizerHTML);
      else { const last = allSections[allSections.length - 1]; if (last) last.insertAdjacentHTML('afterend', optimizerHTML); else container.insertAdjacentHTML('beforeend', optimizerHTML); }
    }
  }
};

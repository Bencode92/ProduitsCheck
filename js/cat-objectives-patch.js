// ═══ CAT Objectives Patch — Add availableCash + visual header ═══

// Override objectives modal to include availableCash
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
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Montant à ne jamais placer (BFR, trésorerie courante)</div></div>
      <div class="form-field"><label>Besoin mensuel (€)</label><input id="obj-monthly" type="number" value="${obj.monthlyNeed}" placeholder="0">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Décaissements mensuels récurrents</div></div>
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

// Override renderCAT header — visual dashboard like structured products
const _origRenderCATForHeader = renderCAT;
renderCAT = function(container) {
  _origRenderCATForHeader(container);

  // Replace the basic stats-row with visual dashboard
  const statsRow = container.querySelector('.stats-row');
  if (!statsRow) return;

  const stats = catManager.getStats();
  const obj = catManager.objectives;
  const cash = parseFloat(obj.availableCash) || 0;
  const reserve = parseFloat(obj.liquidityReserve) || 0;
  const totalTreasury = stats.totalInvested + cash;
  const placable = Math.max(0, cash - reserve);
  const annualInterest = stats.totalInterest; // already annualized in _calcInterest for non-progressive
  const nbBanks = Object.keys(stats.byBank).length;
  const fgdrCount = stats.fgdrAlerts.length;

  // Best market rate for comparison
  const bestRate = catManager.rates?.rates?.reduce((max, r) => r.rate > max ? r.rate : max, 0) || 0;
  const rateVsMarket = bestRate > 0 && stats.weightedRate > 0
    ? (stats.weightedRate >= bestRate ? '✅ Au-dessus du marché' : '⚠️ ' + (bestRate - stats.weightedRate).toFixed(2) + '% sous le meilleur')
    : '';

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
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${stats.totalDeposits} placements · ${nbBanks} banque${nbBanks > 1 ? 's' : ''}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Placé</div>
          <div style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono)">${formatNumber(stats.totalInvested)}€</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${stats.weightedRate ? formatPct(stats.weightedRate) + ' moy.' : '—'}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Liquidités</div>
          <div style="font-size:22px;font-weight:800;color:${cash > 0 ? 'var(--cyan)' : 'var(--text-dim)'};font-family:var(--mono)">${formatNumber(cash)}€</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${placable > 0 ? formatNumber(placable) + '€ à placer' : cash > 0 ? 'Réserve couverte' : 'Cliquez 🎯 pour saisir'}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Rendement / an</div>
          <div style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(annualInterest)}€</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${rateVsMarket || (stats.weightedRate ? formatPct(stats.weightedRate) + '/an' : '—')}</div>
        </div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Risque FGDR</div>
          <div style="font-size:22px;font-weight:800;color:${fgdrCount > 0 ? 'var(--orange)' : 'var(--green)'}">${fgdrCount > 0 ? '⚠️ ' + fgdrCount : '✅'}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${fgdrCount > 0 ? fgdrCount + ' dépassement' + (fgdrCount > 1 ? 's' : '') : 'Plafond respecté'}</div>
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

  // Replace the old stats row with the new dashboard
  statsRow.outerHTML = dashHTML;
};

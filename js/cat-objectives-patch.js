// ═══ CAT Objectives Patch V4c — Fix: don't override switchMainView, use 'dashboard' ═══
// switchMainView() is defined in index.html — DO NOT redefine here

const _origShowCATObjectivesModal = showCATObjectivesModal;
showCATObjectivesModal = function() {
  const obj = catManager.objectives;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">🎯 Objectifs & Trésorerie</h2>
    <div class="form-grid">
      <div class="form-field"><label style="color:#06D6A0">🏢 Cash ByCam (€)</label><input id="obj-cash-bycam" type="number" value="${obj.cashByCam || 0}" placeholder="0" style="font-size:16px;font-weight:600">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Liquidités ByCam à placer</div></div>
      <div class="form-field"><label style="color:#8338EC">🦎 Cash Caméleons (€)</label><input id="obj-cash-cameleons" type="number" value="${obj.cashCameleons || 0}" placeholder="0" style="font-size:16px;font-weight:600">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Liquidités Caméleons à placer</div></div>
      <div class="form-field"><label>Réserve de sécurité (€)</label><input id="obj-reserve" type="number" value="${obj.liquidityReserve}" placeholder="0">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Montant à ne jamais placer (BFR)</div></div>
      <div class="form-field"><label>Besoin mensuel (€)</label><input id="obj-monthly" type="number" value="${obj.monthlyNeed}" placeholder="0"></div>
      <div class="form-field"><label>Plafond FGDR / banque (€)</label><input id="obj-maxbank" type="number" value="${obj.maxPerBank}" placeholder="100000"></div>
      <div class="form-field"><label>Objectif rendement (%)</label><input id="obj-target-rate" type="number" step="0.01" value="${obj.targetRate || ''}" placeholder="3.00"></div>
      <div class="form-field full"><label>Notes</label><textarea id="obj-notes" style="min-height:60px">${obj.notes || ''}</textarea></div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="saveCATObjectivesV2()">Enregistrer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

async function saveCATObjectivesV2() {
  const cashByCam = parseFloat(document.getElementById('obj-cash-bycam').value) || 0;
  const cashCameleons = parseFloat(document.getElementById('obj-cash-cameleons').value) || 0;
  catManager.objectives = {
    monthlyNeed: parseFloat(document.getElementById('obj-monthly').value) || 0,
    liquidityReserve: parseFloat(document.getElementById('obj-reserve').value) || 0,
    availableCash: cashByCam + cashCameleons,
    cashByCam, cashCameleons,
    maxPerBank: parseFloat(document.getElementById('obj-maxbank').value) || 100000,
    targetRate: parseFloat(document.getElementById('obj-target-rate').value) || 0,
    notes: document.getElementById('obj-notes').value,
  };
  closeModal();
  await catManager.saveObjectives();
  showToast('Objectifs sauvegardés', 'success');
  app.setState({ view: 'cat' });
  renderCAT(document.getElementById('main-content'));
}

// ═══ Override renderCAT ═══
const _origRenderCATForHeader = renderCAT;
renderCAT = function(container) {
  _origRenderCATForHeader(container);
  const statsRow = container.querySelector('.stats-row');
  if (!statsRow) return;

  const stats = catManager.getStats();
  const obj = catManager.objectives;
  const cashBC = parseFloat(obj.cashByCam) || 0;
  const cashCam = parseFloat(obj.cashCameleons) || 0;
  const cash = cashBC + cashCam;
  const reserve = parseFloat(obj.liquidityReserve) || 0;
  const totalTreasury = stats.totalInvested + cash;
  const placable = Math.max(0, cash - reserve);
  const nbBanks = Object.keys(stats.byBank).length;
  const fgdrCount = stats.fgdrAlerts.length;

  const active = catManager.deposits.filter(d => d.status === 'active');
  // Use current progressive rate (not average) for annual interest
  const annualInterest = active.reduce((sum, d) => {
    var amt = parseFloat(d.amount) || 0;
    var rate = parseFloat(d.rate) || 0;
    // Check rateSchedule for current period rate
    if (d.rateSchedule && Array.isArray(d.rateSchedule) && d.rateSchedule.length > 0) {
      var now = new Date();
      for (var i = 0; i < d.rateSchedule.length; i++) {
        var s = d.rateSchedule[i];
        var from = s.from ? new Date(s.from) : null;
        var to = s.to ? new Date(s.to) : null;
        if (from && to && now >= from && now <= to) { rate = parseFloat(s.rate) || rate; break; }
      }
      // If past all periods, use last
      var last = d.rateSchedule[d.rateSchedule.length - 1];
      if (last && last.to && now > new Date(last.to)) rate = parseFloat(last.rate) || rate;
    }
    return sum + Math.round(amt * (rate / 100) * 100) / 100;
  }, 0);
  const totalInterestAllTime = stats.totalInterest;
  // Weighted rate using current progressive rates
  const weightedRate = stats.totalInvested > 0 ? annualInterest / stats.totalInvested * 100 : 0;
  const bestRate = catManager.rates?.rates?.reduce((max, r) => r.rate > max ? r.rate : max, 0) || 0;
  const rateVsMarket = bestRate > 0 && weightedRate > 0 ? (weightedRate >= bestRate ? '✅ Leader' : '⚠️ -' + (bestRate - weightedRate).toFixed(2) + '%') : '';
  const nowStr = new Date().toISOString().split('T')[0];
  let earlyExitInterest = 0;
  if (typeof calcInterestAtExit === 'function') earlyExitInterest = active.reduce((sum, d) => sum + calcInterestAtExit(d, nowStr), 0);

  const portfolio = (app.state?.portfolio || []).filter(p => !p.archived);
  const structuredNominal = portfolio.reduce((s, p) => s + (parseFloat(p.investedAmount) || 0), 0);

  let dashHTML = `
    <div style="background:linear-gradient(135deg,var(--bg-elevated),var(--bg-card));border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:15px;font-weight:700;color:var(--text-bright)">💰 TRÉSORERIE</div>
        <div style="display:flex;gap:8px"><button class="btn sm" onclick="showCATObjectivesModal()" style="font-size:11px">🎯 Objectifs</button></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden">
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Trésorerie totale</div><div style="font-size:22px;font-weight:800;color:var(--text-bright);font-family:var(--mono)">${formatNumber(totalTreasury)}€</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${stats.totalDeposits} plac. · ${nbBanks} banque${nbBanks > 1 ? 's' : ''}</div></div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Placé CAT</div><div style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono)">${formatNumber(stats.totalInvested)}€</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${weightedRate ? formatPct(weightedRate) + ' moy.' : '—'}</div></div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Liquidités</div><div style="font-size:22px;font-weight:800;color:${cash > 0 ? 'var(--cyan)' : 'var(--text-dim)'};font-family:var(--mono)">${formatNumber(cash)}€</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${cashBC > 0 ? '🏢 ' + formatNumber(cashBC) + '€' : ''}${cashBC > 0 && cashCam > 0 ? ' · ' : ''}${cashCam > 0 ? '🦎 ' + formatNumber(cashCam) + '€' : ''}${cash === 0 ? 'Cliquez 🎯' : ''}</div></div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Rendement / an</div><div style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(annualInterest)}€</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${weightedRate ? formatPct(weightedRate) + '/an' : '—'} ${rateVsMarket}</div></div>
        <div style="background:var(--bg-card);padding:14px 16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">FGDR</div><div style="font-size:22px;font-weight:800;color:${fgdrCount > 0 ? 'var(--orange)' : 'var(--green)'}">${fgdrCount > 0 ? '⚠️ ' + fgdrCount : '✅'}</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${fgdrCount > 0 ? fgdrCount + ' dépass.' : 'OK'}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-top:1px">
        <div style="background:var(--bg-card);padding:10px 16px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-dim)">Intérêts totaux (sur durée)</div><div style="font-size:14px;font-weight:700;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestAllTime)}€</div></div>
        <div style="background:var(--bg-card);padding:10px 16px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-dim)">Si sortie aujourd'hui</div><div style="font-size:14px;font-weight:700;color:${earlyExitInterest > 0 ? 'var(--orange)' : 'var(--text-dim)'};font-family:var(--mono)">${earlyExitInterest > 0 ? '+' + formatNumber(earlyExitInterest) + '€' : '—'}</div></div>
        <div style="background:var(--bg-card);padding:10px 16px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-dim)">Meilleur marché</div><div style="font-size:14px;font-weight:700;color:var(--accent);font-family:var(--mono)">${bestRate > 0 ? bestRate.toFixed(2) + '%' : '—'}</div></div>
      </div>
      ${cash > 0 || stats.totalInvested > 0 ? `<div style="margin-top:12px;display:flex;gap:4px;height:8px;border-radius:4px;overflow:hidden">
        <div style="flex:${stats.totalInvested};background:var(--green);border-radius:4px 0 0 4px" title="CAT"></div>
        ${structuredNominal > 0 ? '<div style="flex:' + structuredNominal + ';background:var(--purple)" title="Structurés"></div>' : ''}
        ${reserve > 0 ? '<div style="flex:' + reserve + ';background:var(--orange)" title="Réserve"></div>' : ''}
        ${placable > 0 ? '<div style="flex:' + placable + ';background:var(--cyan);border-radius:0 4px 4px 0" title="À placer"></div>' : ''}
      </div>
      <div style="display:flex;gap:12px;margin-top:6px;font-size:10px">
        <span style="color:var(--green)">■ CAT ${formatNumber(stats.totalInvested)}€</span>
        ${structuredNominal > 0 ? '<span style="color:var(--purple)">■ Structurés ' + formatNumber(structuredNominal) + '€</span>' : ''}
        ${reserve > 0 ? '<span style="color:var(--orange)">■ Réserve</span>' : ''}
        ${placable > 0 ? '<span style="color:var(--cyan)">■ À placer ' + formatNumber(placable) + '€</span>' : ''}
      </div>` : ''}
    </div>`;

  // ═══ Liquidity banner → uses switchMainView('dashboard') which is the Produits Structurés tab ═══
  if (placable > 0) {
    dashHTML += `<div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.25);border-left:4px solid var(--purple);border-radius:var(--radius);padding:14px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text-bright)">Liquidités disponibles pour produits structurés</div>
        <div style="display:flex;gap:16px;margin-top:6px;font-size:12px">
          ${cashBC > 0 ? '<span style="color:#06D6A0">🏢 ByCam : <strong>' + formatNumber(cashBC) + '€</strong></span>' : ''}
          ${cashCam > 0 ? '<span style="color:#8338EC">🦎 Caméleons : <strong>' + formatNumber(cashCam) + '€</strong></span>' : ''}
          <span style="color:var(--text-dim)">Total : <strong style="color:var(--cyan)">${formatNumber(placable)}€</strong></span>
        </div>
      </div>
      <button class="btn" onclick="switchMainView('dashboard')" style="border-color:var(--purple);color:var(--purple);white-space:nowrap">📊 Produits Structurés →</button>
    </div>`;
  }

  statsRow.outerHTML = dashHTML;

  // Inject optimizer
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

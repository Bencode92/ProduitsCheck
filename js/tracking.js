// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Suivi Performance V4 — Wording ultra-clair
// ═══════════════════════════════════════════════════════════════

function getTrackingStatus(p) {
  const t = p.tracking;
  if (!t || t.level == null) return null;
  const level = parseFloat(t.level);
  const variation = level - 100;
  const barrier = parseFloat(p.capitalProtection?.barrier) || 0;
  const autocallTrigger = parseFloat(p.earlyRedemption?.trigger) || 100;
  const couponTrigger = parseFloat(p.coupon?.trigger) || autocallTrigger;
  // Marge = combien le sous-jacent peut ENCORE baisser avant la barrière
  // Si position = -6.7% (93.3%) et barrière = 60% → marge initiale était 40%, consommée de 6.7% → reste 33.3%
  const margeInitiale = barrier > 0 ? (100 - barrier) : 0; // ex: 40%
  const margeRestante = barrier > 0 ? (level - barrier) : 999; // ex: 33.3%
  const margeConsommee = barrier > 0 ? Math.abs(Math.min(variation, 0)) : 0; // ex: 6.7%
  const couponOK = level >= couponTrigger;
  const autocallOK = level >= autocallTrigger;
  const annualYield = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
  const amount = parseFloat(p.investedAmount) || 0;
  const couponAmount = Math.round(amount * annualYield / 100);
  const daysAgo = t.date ? Math.floor((Date.now() - new Date(t.date).getTime()) / 86400000) : null;
  return { level, variation, barrier, autocallTrigger, couponTrigger, margeInitiale, margeRestante, margeConsommee, couponOK, autocallOK, annualYield, amount, couponAmount, date: t.date, daysAgo, note: t.note };
}

// ═══ CARD: simple one-line status ═══════════════════════════
function renderTrackingGauge(p) {
  const s = getTrackingStatus(p); if (!s) return '';
  const varStr = (s.variation >= 0 ? '+' : '') + s.variation.toFixed(1) + '%';
  let bgColor, textColor, message;
  if (s.barrier > 0 && s.margeRestante <= 10) {
    bgColor = 'rgba(229,57,53,0.15)'; textColor = '#E53935';
    message = `\ud83d\udd34 ${varStr} \u2014 DANGER, encore ${s.margeRestante.toFixed(0)}% de marge`;
  } else if (!s.couponOK) {
    bgColor = 'rgba(255,183,77,0.15)'; textColor = '#FFB74D';
    message = `\u26a0\ufe0f ${varStr} \u2014 Coupon perdu (manque ${(s.couponTrigger - s.level).toFixed(0)}%)`;
  } else if (s.autocallOK) {
    bgColor = 'rgba(76,175,80,0.15)'; textColor = '#4CAF50';
    message = `\u2705 ${varStr} \u2014 Autocall probable + coupon OK`;
  } else {
    bgColor = 'rgba(76,175,80,0.1)'; textColor = '#81C784';
    message = `\ud83d\udfe2 ${varStr} \u2014 Coupon OK${s.barrier > 0 ? ', marge ' + s.margeRestante.toFixed(0) + '%' : ''}`;
  }
  return `<div style="margin-top:6px;padding:5px 8px;background:${bgColor};border-radius:4px;font-size:10px;font-weight:600;color:${textColor}">${message}</div>`;
}

// ═══ FICHE: clear warning boxes + explicit marge ════════════
function renderTrackingSection(p) {
  const s = getTrackingStatus(p);
  const t = p.tracking || {};
  const couponTrigger = parseFloat(p.coupon?.trigger) || parseFloat(p.earlyRedemption?.trigger) || 100;
  const annualYield = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
  const amount = parseFloat(p.investedAmount) || 0;
  const couponPerYear = Math.round(amount * annualYield / 100);
  const lostCoupons = (t.history || []).filter(h => h.level < couponTrigger).length;
  const totalYears = (t.history || []).length;
  const totalLost = lostCoupons * couponPerYear;

  const historyHTML = (t.history || []).map(h => {
    const v = h.level - 100;
    const vStr = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    const gotCoupon = h.level >= couponTrigger;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px;font-weight:500">Ann\u00e9e ${h.year}</td>
      <td style="padding:6px 8px;color:var(--text-muted)">${new Date(h.date).toLocaleDateString('fr-FR')}</td>
      <td style="padding:6px 8px;font-weight:700;color:${v >= 0 ? 'var(--green)' : v > -20 ? 'var(--orange)' : 'var(--red)'}">${vStr}</td>
      <td style="padding:6px 8px">${gotCoupon ? '<span style="color:var(--green)">\u2705 Coupon vers\u00e9</span>' : '<span style="color:var(--red)">\u274c Coupon perdu</span>'}</td>
    </tr>`;
  }).join('');

  return `<div class="fiche-section">
    <div class="fiche-section-header"><span class="fiche-section-icon">\ud83d\udccd</span><span class="fiche-section-title">Suivi Performance</span></div>
    <div class="fiche-section-body">
      ${s ? `
        <!-- WARNING BOXES -->
        ${s.barrier > 0 && s.margeRestante <= 10 ? `
          <div class="fiche-info-box red" style="margin-bottom:12px">
            <div class="fiche-info-box-title">\ud83d\udd34 DANGER \u2014 Capital menac\u00e9</div>
            <div class="fiche-info-box-text">
              Le sous-jacent a baiss\u00e9 de <strong>${Math.abs(s.variation).toFixed(1)}%</strong> depuis le strike.<br>
              Marge de protection initiale: <strong>${s.margeInitiale}%</strong> \u2192 d\u00e9j\u00e0 consomm\u00e9e de <strong>${s.margeConsommee.toFixed(1)}%</strong> \u2192 <strong>reste ${s.margeRestante.toFixed(1)}%</strong> avant la barri\u00e8re.<br>
              \u26a0\ufe0f Si le sous-jacent baisse encore de ${s.margeRestante.toFixed(1)}%, <strong>perte en capital</strong>.
            </div>
          </div>
        ` : s.barrier > 0 && s.margeRestante <= 20 ? `
          <div class="fiche-info-box orange" style="margin-bottom:12px">
            <div class="fiche-info-box-title">\u26a0\ufe0f VIGILANCE \u2014 Barri\u00e8re en approche</div>
            <div class="fiche-info-box-text">
              Le sous-jacent est \u00e0 <strong>${s.variation >= 0 ? '+' : ''}${s.variation.toFixed(1)}%</strong>.<br>
              Protection initiale: ${s.margeInitiale}% \u2192 consomm\u00e9e: ${s.margeConsommee.toFixed(1)}% \u2192 <strong>reste ${s.margeRestante.toFixed(1)}%</strong> avant barri\u00e8re (${s.barrier}%).
            </div>
          </div>
        ` : ''}

        ${!s.couponOK ? `
          <div class="fiche-info-box orange" style="margin-bottom:12px">
            <div class="fiche-info-box-title">\u26a0\ufe0f Coupon NON vers\u00e9 cette ann\u00e9e</div>
            <div class="fiche-info-box-text">
              Le sous-jacent est \u00e0 <strong>${s.variation >= 0 ? '+' : ''}${s.variation.toFixed(1)}%</strong>, il faut <strong>${couponTrigger >= 100 ? '0%' : (couponTrigger - 100) + '%'}</strong> minimum pour le coupon.<br>
              Il manque <strong>${(s.couponTrigger - s.level).toFixed(1)}%</strong> de hausse. ${couponPerYear > 0 ? `Manque \u00e0 gagner: <strong>${formatNumber(couponPerYear)}\u20ac</strong>.` : ''}<br>
              ${p.coupon?.memory ? '\ud83d\udccc <strong>Effet m\u00e9moire</strong>: ce coupon sera rattrap\u00e9 si le seuil est atteint plus tard.' : '\u274c Pas d\'effet m\u00e9moire \u2014 coupon d\u00e9finitivement perdu.'}
            </div>
          </div>
        ` : s.autocallOK ? `
          <div class="fiche-info-box green" style="margin-bottom:12px">
            <div class="fiche-info-box-title">\u2705 Autocall probable + Coupon vers\u00e9</div>
            <div class="fiche-info-box-text">
              Le sous-jacent est \u00e0 <strong>${s.variation >= 0 ? '+' : ''}${s.variation.toFixed(1)}%</strong>, au-dessus du seuil d'autocall (${s.autocallTrigger}%).<br>
              Remboursement anticip\u00e9 attendu avec coupon de <strong>${couponPerYear > 0 ? formatNumber(couponPerYear) + '\u20ac' : ''}</strong>.
            </div>
          </div>
        ` : `
          <div class="fiche-info-box green" style="margin-bottom:12px">
            <div class="fiche-info-box-title">\ud83d\udfe2 Coupon vers\u00e9 \u2014 Situation normale</div>
            <div class="fiche-info-box-text">
              Le sous-jacent est \u00e0 <strong>${s.variation >= 0 ? '+' : ''}${s.variation.toFixed(1)}%</strong>, coupon de <strong>${couponPerYear > 0 ? formatNumber(couponPerYear) + '\u20ac' : ''}</strong> vers\u00e9.
              ${s.barrier > 0 ? `<br>Protection: marge initiale ${s.margeInitiale}% \u2192 consomm\u00e9e ${s.margeConsommee.toFixed(1)}% \u2192 <strong>reste ${s.margeRestante.toFixed(1)}%</strong> de marge.` : ''}
            </div>
          </div>
        `}

        <!-- 3 metrics -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px;text-align:center">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Sous-jacent</div>
            <div style="font-size:20px;font-weight:700;color:${s.variation >= 0 ? 'var(--green)' : 'var(--orange)'}">${s.variation >= 0 ? '+' : ''}${s.variation.toFixed(1)}%</div>
            <div style="font-size:9px;color:var(--text-dim)">depuis le strike</div>
          </div>
          <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px;text-align:center">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Coupon</div>
            <div style="font-size:20px;font-weight:700;color:${s.couponOK ? 'var(--green)' : 'var(--red)'}">${s.couponOK ? '\u2705 Oui' : '\u274c Non'}</div>
            <div style="font-size:9px;color:var(--text-dim)">${s.couponOK ? formatNumber(couponPerYear) + '\u20ac' : 'perdu'}</div>
          </div>
          <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px;text-align:center">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase">${s.barrier > 0 ? 'Marge restante' : 'Capital'}</div>
            <div style="font-size:20px;font-weight:700;color:${s.margeRestante > 20 ? 'var(--green)' : s.margeRestante > 10 ? 'var(--orange)' : 'var(--red)'}">${s.barrier > 0 ? s.margeRestante.toFixed(1) + '%' : '\u2705'}</div>
            <div style="font-size:9px;color:var(--text-dim)">${s.barrier > 0 ? 'sur ' + s.margeInitiale + '% initial' : 'prot\u00e9g\u00e9'}</div>
          </div>
        </div>

        ${lostCoupons > 0 ? `
          <div class="fiche-alert warn" style="margin-bottom:12px">
            \u26a0\ufe0f <strong>${lostCoupons} coupon${lostCoupons > 1 ? 's' : ''} perdu${lostCoupons > 1 ? 's' : ''}</strong> sur ${totalYears} ann\u00e9e${totalYears > 1 ? 's' : ''} \u2014 Manque \u00e0 gagner: <strong>${formatNumber(totalLost)}\u20ac</strong>
          </div>
        ` : ''}

        <div style="font-size:10px;color:var(--text-dim);margin-bottom:12px">
          \ud83d\udcc5 Valoris\u00e9 le ${new Date(s.date).toLocaleDateString('fr-FR')} ${s.daysAgo > 0 ? '(il y a ' + s.daysAgo + 'j)' : ''}
        </div>
      ` : `<div style="text-align:center;padding:16px;color:var(--text-dim)">Aucune valorisation enregistr\u00e9e.</div>`}

      <button class="btn primary" style="width:100%" onclick="showTrackingModal()">\ud83d\udccd ${s ? 'Mettre \u00e0 jour' : 'Enregistrer une valorisation'}</button>

      ${(t.history || []).length > 0 ? `
        <div style="margin-top:16px">
          <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px">Historique des coupons</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="border-bottom:2px solid var(--border)">
              <th style="padding:6px 8px;text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase">P\u00e9riode</th>
              <th style="padding:6px 8px;text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase">Date</th>
              <th style="padding:6px 8px;text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase">Variation</th>
              <th style="padding:6px 8px;text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase">Coupon</th>
            </tr></thead>
            <tbody>${historyHTML}</tbody>
          </table>
        </div>
      ` : ''}
    </div>
  </div>`;
}

// ═══ MODAL ═══════════════════════════════════════════════════
function showTrackingModal() {
  const p = app.state.currentProduct; if (!p) return;
  const t = p.tracking || {};
  const currentVariation = t.level != null ? (parseFloat(t.level) - 100) : '';
  const currentVarStr = currentVariation !== '' ? (currentVariation >= 0 ? '+' + currentVariation : currentVariation.toString()) : '';
  const barrier = parseFloat(p.capitalProtection?.barrier) || 0;
  const couponTrigger = parseFloat(p.coupon?.trigger) || parseFloat(p.earlyRedemption?.trigger) || 100;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">\ud83d\udccd Valorisation du sous-jacent</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${p.name || 'Produit'}</div>
    <div class="form-grid">
      <div class="form-field"><label>Hausse ou baisse depuis le strike (%)</label>
        <input id="f-track-var" type="number" step="0.1" value="${currentVarStr}" placeholder="Ex: -12 ou +5" autofocus oninput="updateTrackingPreview()">
        <div id="f-track-preview" style="font-size:11px;margin-top:6px;padding:8px;background:var(--surface);border-radius:var(--radius-sm)"></div>
      </div>
      <div class="form-field"><label>Date de valorisation</label>
        <input id="f-track-date" type="date" value="${t.date || new Date().toISOString().split('T')[0]}">
      </div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="handleSaveTracking()">\ud83d\udcbe Enregistrer</button></div>
  </div></div>`;
  modal.classList.add('visible');
  window.updateTrackingPreview = function() {
    const val = parseFloat(document.getElementById('f-track-var')?.value || 0);
    const level = 100 + val;
    const preview = document.getElementById('f-track-preview'); if (!preview) return;
    let html = '';
    if (level >= couponTrigger) { html += '<span style="color:var(--green)">\u2705 Coupon vers\u00e9</span>'; }
    else { html += '<span style="color:var(--red)">\u274c Coupon perdu \u2014 il manque ' + (couponTrigger - level).toFixed(1) + '%</span>'; }
    if (barrier > 0) {
      const marge = level - barrier;
      const init = 100 - barrier;
      const conso = Math.abs(Math.min(val, 0));
      html += `<br><span style="color:var(--text-dim)">\ud83d\udee1\ufe0f Protection: ${init}% initiale \u2192 ${conso.toFixed(1)}% consomm\u00e9e \u2192 <strong>${marge.toFixed(1)}%</strong> restante</span>`;
      if (marge <= 10) html += `<br><span style="color:var(--red)">\ud83d\udd34 DANGER: seulement ${marge.toFixed(1)}% de marge!</span>`;
    }
    preview.innerHTML = html;
  };
  window.updateTrackingPreview();
}

async function handleSaveTracking() {
  const p = app.state.currentProduct; if (!p) return;
  const variation = parseFloat(document.getElementById('f-track-var')?.value);
  const date = document.getElementById('f-track-date')?.value;
  if (isNaN(variation) || variation < -99 || variation > 200) { showToast('Variation invalide', 'error'); return; }
  if (!date) { showToast('Date requise', 'error'); return; }
  const level = 100 + variation;
  if (!p.tracking) p.tracking = { history: [] };
  if (!p.tracking.history) p.tracking.history = [];
  const subDate = p.subscriptionDate ? new Date(p.subscriptionDate) : new Date(p.addedDate || Date.now());
  const yearNum = Math.max(1, Math.ceil((new Date(date) - subDate) / (365.25 * 86400000)));
  const idx = p.tracking.history.findIndex(h => h.year === yearNum);
  const entry = { date, level, year: yearNum };
  if (idx >= 0) p.tracking.history[idx] = entry;
  else { p.tracking.history.push(entry); p.tracking.history.sort((a, b) => a.year - b.year); }
  p.tracking.level = level; p.tracking.date = date;
  closeModal();
  const inPortfolio = app.state.portfolio.find(x => x.id === p.id);
  if (inPortfolio) {
    inPortfolio.tracking = JSON.parse(JSON.stringify(p.tracking));
    await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, app.state.portfolio, `[StructBoard] ${p.name}: ${variation >= 0 ? '+' : ''}${variation}%`);
  }
  const bankId = p.bankId || _resolveBankId(p.id, p.bankId);
  if (bankId) await app._saveProductFile(bankId, p);
  showToast(`Enregistr\u00e9: ${variation >= 0 ? '+' : ''}${variation}%`, 'success');
  app.openProduct(p);
}

function getPortfolioAlerts(portfolio) {
  const alerts = [];
  (portfolio || []).forEach(p => {
    const s = getTrackingStatus(p); if (!s) return;
    const name = (p.name || 'Produit').substring(0, 30);
    const varStr = (s.variation >= 0 ? '+' : '') + s.variation.toFixed(0) + '%';
    if (s.barrier > 0 && s.margeRestante <= 10) {
      alerts.push({ type: 'danger', icon: '\ud83d\udd34', text: `${name}: ${varStr} \u2014 DANGER, ${s.margeRestante.toFixed(0)}% de marge restante sur ${s.margeInitiale}%`, productId: p.id, bankId: p.bankId });
    }
    if (!s.couponOK) {
      const loss = s.couponAmount > 0 ? ` (${formatNumber(s.couponAmount)}\u20ac perdu)` : '';
      alerts.push({ type: 'warn', icon: '\u26a0\ufe0f', text: `${name}: ${varStr} \u2014 Coupon perdu${loss}`, productId: p.id, bankId: p.bankId });
    }
    if (s.autocallOK) {
      alerts.push({ type: 'success', icon: '\u2705', text: `${name}: ${varStr} \u2014 Autocall probable, coupon OK`, productId: p.id, bankId: p.bankId });
    }
    if (s.daysAgo > 90) {
      alerts.push({ type: 'info', icon: '\u23f0', text: `${name}: valorisation obsol\u00e8te (${s.daysAgo}j)`, productId: p.id, bankId: p.bankId });
    }
  });
  return alerts;
}

function getAdjustedAnnualYield(p) {
  const s = getTrackingStatus(p);
  if (!s) return typeof calcProductAnnualYield === 'function' ? calcProductAnnualYield(p) : 0;
  if (!s.couponOK && !p.coupon?.memory) return 0;
  return s.couponAmount;
}

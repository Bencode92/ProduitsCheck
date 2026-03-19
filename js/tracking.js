// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Suivi Performance (Tracking)
// Niveau sous-jacent, distances barrières, jauges, alertes
// ═══════════════════════════════════════════════════════════════

/*
  Data model on product:
  product.tracking = {
    level: 88,             // % du niveau initial (100 = au strike)
    date: '2026-03-19',    // date de dernière valorisation
    note: '',              // note optionnelle
    history: [             // 1 par année (année de coupon)
      { date: '2025-12-15', level: 95, year: 1 },
      { date: '2026-12-10', level: 88, year: 2 },
    ]
  }
*/

// ─── Compute tracking status for a product ─────────────
function getTrackingStatus(p) {
  const t = p.tracking;
  if (!t || t.level == null) return null;

  const level = parseFloat(t.level);
  const barrier = parseFloat(p.capitalProtection?.barrier) || 0;
  const autocallTrigger = parseFloat(p.earlyRedemption?.trigger) || 100;
  const couponTrigger = parseFloat(p.coupon?.trigger) || autocallTrigger;

  const distAutocall = autocallTrigger - level;  // >0 means below autocall
  const distBarrier = level - barrier;            // >0 means above barrier (safe)
  const couponEligible = level >= couponTrigger;

  // Status color
  let status, color, icon;
  if (level >= autocallTrigger) {
    status = 'Autocall probable'; color = 'var(--green)'; icon = '✅';
  } else if (level >= couponTrigger) {
    status = 'Coupon éligible'; color = 'var(--green)'; icon = '🟢';
  } else if (barrier > 0 && distBarrier <= 10) {
    status = 'Proche barrière'; color = 'var(--red)'; icon = '🔴';
  } else if (barrier > 0 && distBarrier <= 20) {
    status = 'Sous surveillance'; color = 'var(--orange)'; icon = '🟠';
  } else if (level < 100) {
    status = 'Sous le strike'; color = 'var(--orange)'; icon = '🟡';
  } else {
    status = 'Au-dessus du strike'; color = 'var(--green)'; icon = '🟢';
  }

  const daysAgo = t.date ? Math.floor((Date.now() - new Date(t.date).getTime()) / 86400000) : null;

  return { level, barrier, autocallTrigger, couponTrigger, distAutocall, distBarrier, couponEligible, status, color, icon, date: t.date, daysAgo, note: t.note };
}

// ─── Mini gauge HTML for product cards (inline) ─────────
function renderTrackingGauge(p) {
  const s = getTrackingStatus(p);
  if (!s) return '';

  // Gauge: barrier...level...autocall mapped to 0-100% width
  const min = Math.min(s.barrier - 10, s.level - 10, 40);
  const max = Math.max(s.autocallTrigger + 10, s.level + 10, 120);
  const range = max - min;
  const levelPct = ((s.level - min) / range * 100).toFixed(1);
  const barrierPct = s.barrier > 0 ? ((s.barrier - min) / range * 100).toFixed(1) : 0;
  const autocallPct = ((s.autocallTrigger - min) / range * 100).toFixed(1);

  return `<div style="margin-top:6px;padding:4px 0" title="Niveau: ${s.level}% | Barri\u00e8re: ${s.barrier}% | Autocall: ${s.autocallTrigger}%">
    <div style="display:flex;align-items:center;gap:4px;font-size:10px;margin-bottom:2px">
      <span>${s.icon}</span>
      <span style="color:${s.color};font-weight:600">${s.level}%</span>
      <span style="color:var(--text-dim)">${s.status}</span>
    </div>
    <div style="position:relative;height:6px;background:var(--surface);border-radius:3px;overflow:visible">
      ${s.barrier > 0 ? `<div style="position:absolute;left:${barrierPct}%;top:-1px;bottom:-1px;width:2px;background:var(--red);border-radius:1px" title="Barri\u00e8re ${s.barrier}%"></div>` : ''}
      <div style="position:absolute;left:${autocallPct}%;top:-1px;bottom:-1px;width:2px;background:var(--green);border-radius:1px" title="Autocall ${s.autocallTrigger}%"></div>
      <div style="position:absolute;left:${levelPct}%;top:-2px;width:8px;height:10px;background:${s.color};border-radius:2px;transform:translateX(-4px)" title="Niveau actuel ${s.level}%"></div>
      <div style="position:absolute;left:0;top:0;width:${levelPct}%;height:100%;background:${s.color}22;border-radius:3px 0 0 3px"></div>
    </div>
  </div>`;
}

// ─── Tracking section for product sheet ───────────────
function renderTrackingSection(p) {
  const s = getTrackingStatus(p);
  const t = p.tracking || {};
  const historyHTML = (t.history || []).map(h => 
    `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:4px 6px;color:var(--text-muted);font-size:11px">Ann\u00e9e ${h.year}</td>
      <td style="padding:4px 6px;font-size:11px">${new Date(h.date).toLocaleDateString('fr-FR')}</td>
      <td style="padding:4px 6px;font-weight:600;color:${h.level >= 100 ? 'var(--green)' : h.level >= (parseFloat(p.capitalProtection?.barrier)||60) ? 'var(--orange)' : 'var(--red)'}">${h.level}%</td>
    </tr>`
  ).join('');

  return `<div class="fiche-section">
    <div class="fiche-section-header">
      <span class="fiche-section-icon">\ud83d\udccd</span>
      <span class="fiche-section-title">Suivi Performance</span>
    </div>
    <div class="fiche-section-body">
      ${s ? `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="background:var(--surface);border-radius:var(--radius-sm);padding:12px;text-align:center">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px">Niveau sous-jacent</div>
            <div style="font-size:24px;font-weight:700;color:${s.color}">${s.level}%</div>
            <div style="font-size:10px;color:var(--text-dim)">${s.icon} ${s.status}</div>
          </div>
          <div style="background:var(--surface);border-radius:var(--radius-sm);padding:12px;text-align:center">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px">Distance autocall</div>
            <div style="font-size:24px;font-weight:700;color:${s.distAutocall <= 0 ? 'var(--green)' : 'var(--text)'}">${s.distAutocall <= 0 ? '\u2705' : '+' + s.distAutocall.toFixed(0) + '%'}</div>
            <div style="font-size:10px;color:var(--text-dim)">Seuil ${s.autocallTrigger}%</div>
          </div>
          <div style="background:var(--surface);border-radius:var(--radius-sm);padding:12px;text-align:center">
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px">Marge barri\u00e8re</div>
            <div style="font-size:24px;font-weight:700;color:${s.distBarrier > 20 ? 'var(--green)' : s.distBarrier > 10 ? 'var(--orange)' : 'var(--red)'}">${s.barrier > 0 ? s.distBarrier.toFixed(0) + '%' : 'N/A'}</div>
            <div style="font-size:10px;color:var(--text-dim)">${s.barrier > 0 ? 'Barri\u00e8re ' + s.barrier + '%' : 'Pas de barri\u00e8re'}</div>
          </div>
        </div>
        <div style="position:relative;height:20px;background:var(--surface);border-radius:10px;margin-bottom:12px;overflow:visible">
          ${s.barrier > 0 ? `<div style="position:absolute;left:${((s.barrier - 40) / 80 * 100).toFixed(1)}%;top:0;bottom:0;width:3px;background:var(--red);border-radius:2px;z-index:2" title="Barri\u00e8re ${s.barrier}%"><span style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--red);white-space:nowrap">${s.barrier}%</span></div>` : ''}
          <div style="position:absolute;left:${((s.autocallTrigger - 40) / 80 * 100).toFixed(1)}%;top:0;bottom:0;width:3px;background:var(--green);border-radius:2px;z-index:2" title="Autocall ${s.autocallTrigger}%"><span style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--green);white-space:nowrap">${s.autocallTrigger}%</span></div>
          <div style="position:absolute;left:${((s.level - 40) / 80 * 100).toFixed(1)}%;top:50%;transform:translate(-50%,-50%);width:16px;height:16px;background:${s.color};border-radius:50%;border:2px solid var(--bg);z-index:3" title="Niveau ${s.level}%"></div>
          <div style="position:absolute;left:0;top:0;width:${((s.level - 40) / 80 * 100).toFixed(1)}%;height:100%;background:${s.color}33;border-radius:10px 0 0 10px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);margin-bottom:12px">
          <span>\ud83d\udcc5 Valorisation du ${new Date(s.date).toLocaleDateString('fr-FR')}</span>
          <span>${s.daysAgo != null ? 'il y a ' + s.daysAgo + ' jour' + (s.daysAgo > 1 ? 's' : '') : ''}</span>
          <span>${s.couponEligible ? '\u2705 Coupon \u00e9ligible' : '\u274c Coupon non \u00e9ligible'}</span>
        </div>
      ` : `<div style="text-align:center;padding:20px;color:var(--text-dim)">Aucune valorisation enregistr\u00e9e</div>`}

      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn primary" style="flex:1" onclick="showTrackingModal()">\ud83d\udccd Mettre \u00e0 jour le niveau</button>
      </div>

      ${(t.history || []).length > 0 ? `
        <div style="margin-top:8px">
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Historique annuel</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--border)">
              <th style="padding:4px 6px;text-align:left;color:var(--text-dim);font-size:10px">P\u00e9riode</th>
              <th style="padding:4px 6px;text-align:left;color:var(--text-dim);font-size:10px">Date</th>
              <th style="padding:4px 6px;text-align:left;color:var(--text-dim);font-size:10px">Niveau</th>
            </tr></thead>
            <tbody>${historyHTML}</tbody>
          </table>
        </div>
      ` : ''}
    </div>
  </div>`;
}

// ─── Modal: enter tracking level ─────────────────────
function showTrackingModal() {
  const p = app.state.currentProduct; if (!p) return;
  const t = p.tracking || {};
  const currentLevel = t.level || '';
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">\ud83d\udccd Valorisation du sous-jacent</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${p.name || 'Produit'}</div>
    <div class="form-grid">
      <div class="form-field"><label>Niveau en % du niveau initial</label>
        <input id="f-track-level" type="number" step="0.1" value="${currentLevel}" placeholder="Ex: 88 = baisse de 12%" autofocus>
        <div style="font-size:10px;color:var(--text-dim);margin-top:4px">100 = au strike | 90 = -10% | 110 = +10%</div>
      </div>
      <div class="form-field"><label>Date de valorisation</label>
        <input id="f-track-date" type="date" value="${t.date || new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-field full"><label>Note (optionnel)</label>
        <input id="f-track-note" value="${t.note || ''}" placeholder="Ex: Date de constatation trimestrielle">
      </div>
    </div>
    <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px;margin:12px 0;font-size:11px;color:var(--text-muted)">
      <strong>R\u00e9f\u00e9rences:</strong> Autocall \u00e0 ${p.earlyRedemption?.trigger || 100}% | Coupon \u00e0 ${p.coupon?.trigger || '?'}% | Barri\u00e8re \u00e0 ${p.capitalProtection?.barrier || 'N/A'}%
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="handleSaveTracking()">\ud83d\udcbe Enregistrer</button>
    </div>
  </div></div>`;
  modal.classList.add('visible');
}

// ─── Save tracking data ───────────────────────────
async function handleSaveTracking() {
  const p = app.state.currentProduct; if (!p) return;
  const level = parseFloat(document.getElementById('f-track-level')?.value);
  const date = document.getElementById('f-track-date')?.value;
  const note = document.getElementById('f-track-note')?.value || '';

  if (isNaN(level) || level <= 0 || level > 200) { showToast('Niveau invalide (entre 1 et 200)', 'error'); return; }
  if (!date) { showToast('Date requise', 'error'); return; }

  // Init tracking
  if (!p.tracking) p.tracking = { history: [] };
  if (!p.tracking.history) p.tracking.history = [];

  // Determine coupon year (years since subscription)
  const subDate = p.subscriptionDate ? new Date(p.subscriptionDate) : new Date(p.addedDate || Date.now());
  const obsDate = new Date(date);
  const yearNum = Math.max(1, Math.ceil((obsDate - subDate) / (365.25 * 86400000)));

  // Update or add to history (1 per year)
  const existingIdx = p.tracking.history.findIndex(h => h.year === yearNum);
  const entry = { date, level, year: yearNum };
  if (existingIdx >= 0) {
    p.tracking.history[existingIdx] = entry;
  } else {
    p.tracking.history.push(entry);
    p.tracking.history.sort((a, b) => a.year - b.year);
  }

  // Update current
  p.tracking.level = level;
  p.tracking.date = date;
  p.tracking.note = note;

  closeModal();

  // Save to portfolio
  const inPortfolio = app.state.portfolio.find(x => x.id === p.id);
  if (inPortfolio) {
    inPortfolio.tracking = { ...p.tracking };
    await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, app.state.portfolio, `[StructBoard] Tracking: ${p.name} = ${level}%`);
  }

  // Save product file
  const bankId = p.bankId || _resolveBankId(p.id, p.bankId);
  if (bankId) await app._saveProductFile(bankId, p);

  showToast(`Niveau enregistr\u00e9: ${level}%`, 'success');
  app.openProduct(p);
}

// ─── Get portfolio alerts for dashboard ────────────────
function getPortfolioAlerts(portfolio) {
  const alerts = [];
  (portfolio || []).forEach(p => {
    const s = getTrackingStatus(p);
    if (!s) return;
    const name = (p.name || 'Produit').substring(0, 30);
    if (s.barrier > 0 && s.distBarrier <= 10) {
      alerts.push({ type: 'danger', icon: '\ud83d\udd34', text: `${name}: sous-jacent \u00e0 ${s.level}% \u2014 \u00e0 ${s.distBarrier.toFixed(0)}% de la barri\u00e8re (${s.barrier}%)`, productId: p.id, bankId: p.bankId });
    } else if (s.barrier > 0 && s.distBarrier <= 20) {
      alerts.push({ type: 'warn', icon: '\ud83d\udfe0', text: `${name}: sous-jacent \u00e0 ${s.level}% \u2014 marge ${s.distBarrier.toFixed(0)}% avant barri\u00e8re`, productId: p.id, bankId: p.bankId });
    }
    if (s.level >= s.autocallTrigger) {
      alerts.push({ type: 'success', icon: '\u2705', text: `${name}: sous-jacent \u00e0 ${s.level}% \u2014 autocall probable (seuil ${s.autocallTrigger}%)`, productId: p.id, bankId: p.bankId });
    }
    // Stale data warning (>90 days)
    if (s.daysAgo > 90) {
      alerts.push({ type: 'info', icon: '\u23f0', text: `${name}: derni\u00e8re valorisation il y a ${s.daysAgo} jours \u2014 mise \u00e0 jour recommand\u00e9e`, productId: p.id, bankId: p.bankId });
    }
  });
  return alerts;
}

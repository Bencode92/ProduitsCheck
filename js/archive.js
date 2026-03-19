// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Archive Module
// Archiver un produit terminé (autocall, maturité, revente)
// Garde les gains accumulés pour le suivi annuel
// ═══════════════════════════════════════════════════════════════

/*
  Data model:
  product.archived = {
    date: '2026-03-19',          // date de clôture
    reason: 'autocall',          // autocall | maturite | revente | autre
    reasonLabel: 'Autocall déclenché',
    capitalReturned: 30000,      // capital récupéré
    lastCouponReceived: true,    // dernier coupon touché ?
    lastCouponAmount: 2250,      // montant du dernier coupon
    totalCouponsReceived: 4500,  // total des coupons reçus sur la durée
    gainTotal: 4500,             // gain total (coupons + plus-value)
    notes: 'Rappelé au bout de 2 ans'
  }
*/

const ARCHIVE_REASONS = [
  { id: 'autocall', label: 'Autocall déclenché', icon: '✅', desc: 'Remboursement anticipé automatique' },
  { id: 'maturite', label: 'Maturité atteinte', icon: '📅', desc: 'Le produit est arrivé à échéance' },
  { id: 'revente', label: 'Revente anticipée', icon: '💸', desc: 'Vendu avant l\'échéance' },
  { id: 'autre', label: 'Autre', icon: '📝', desc: '' },
];

function showArchiveModal() {
  const p = app.state.currentProduct; if (!p) return;
  const annualYield = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
  const amount = parseFloat(p.investedAmount) || 0;
  const couponPerYear = Math.round(amount * annualYield / 100);

  // Estimate years held
  const subDate = p.subscriptionDate ? new Date(p.subscriptionDate) : null;
  const yearsHeld = subDate ? Math.max(1, Math.round((Date.now() - subDate.getTime()) / (365.25 * 86400000))) : 1;
  const estimatedTotalCoupons = couponPerYear * yearsHeld;

  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">📦 Archiver ce produit</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${p.name || 'Produit'}</div>

    <div class="form-grid">
      <div class="form-field"><label>Raison de la clôture</label>
        <select id="f-arch-reason">
          ${ARCHIVE_REASONS.map(r => `<option value="${r.id}">${r.icon} ${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-field"><label>Date de clôture</label>
        <input id="f-arch-date" type="date" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-field"><label>Capital récupéré (€)</label>
        <input id="f-arch-capital" type="number" value="${amount}" placeholder="${amount}">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Montant investi: ${formatNumber(amount)}€</div>
      </div>
      <div class="form-field"><label>Dernier coupon touché ?</label>
        <select id="f-arch-coupon">
          <option value="oui">✅ Oui, coupon reçu</option>
          <option value="non">❌ Non, pas de coupon</option>
        </select>
      </div>
      <div class="form-field"><label>Total coupons reçus sur la durée (€)</label>
        <input id="f-arch-total-coupons" type="number" value="${estimatedTotalCoupons}" placeholder="${estimatedTotalCoupons}">
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Estimé: ${yearsHeld} an${yearsHeld > 1 ? 's' : ''} × ${formatNumber(couponPerYear)}€ = ${formatNumber(estimatedTotalCoupons)}€</div>
      </div>
      <div class="form-field full"><label>Notes</label>
        <input id="f-arch-notes" placeholder="Ex: Rappelé après 2 ans, tous coupons versés">
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Annuler</button>
      <button class="btn primary" onclick="handleArchive()">📦 Archiver</button>
    </div>
  </div></div>`;
  modal.classList.add('visible');
}

async function handleArchive() {
  const p = app.state.currentProduct; if (!p) return;

  const reason = document.getElementById('f-arch-reason')?.value || 'autre';
  const date = document.getElementById('f-arch-date')?.value;
  const capitalReturned = parseFloat(document.getElementById('f-arch-capital')?.value) || 0;
  const lastCoupon = document.getElementById('f-arch-coupon')?.value === 'oui';
  const totalCoupons = parseFloat(document.getElementById('f-arch-total-coupons')?.value) || 0;
  const notes = document.getElementById('f-arch-notes')?.value || '';

  const amount = parseFloat(p.investedAmount) || 0;
  const capitalGain = capitalReturned - amount;
  const gainTotal = totalCoupons + capitalGain;
  const reasonInfo = ARCHIVE_REASONS.find(r => r.id === reason);

  p.archived = {
    date,
    reason,
    reasonLabel: reasonInfo?.label || reason,
    capitalReturned,
    capitalGain,
    lastCouponReceived: lastCoupon,
    totalCouponsReceived: totalCoupons,
    gainTotal,
    notes,
  };
  p.status = 'archived';

  closeModal();

  // Save to portfolio
  const inPortfolio = app.state.portfolio.find(x => x.id === p.id);
  if (inPortfolio) {
    inPortfolio.archived = { ...p.archived };
    inPortfolio.status = 'archived';
    await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, app.state.portfolio, `[StructBoard] Archivé: ${p.name}`);
  }

  // Save product file
  const bankId = p.bankId || _resolveBankId(p.id, p.bankId);
  if (bankId) await app._saveProductFile(bankId, p);

  showToast(`${p.name} archivé — Gain total: ${formatNumber(gainTotal)}€`, 'success');
  app.goToDashboard();
}

// ─── Render archived badge on card ─────────────────────
function renderArchiveBadge(p) {
  if (!p.archived) return '';
  const r = ARCHIVE_REASONS.find(x => x.id === p.archived.reason);
  return `<div style="margin-top:6px;padding:5px 8px;background:rgba(148,163,184,0.15);border-radius:4px;font-size:10px;color:#94A3B8">
    📦 Archivé — ${r?.icon || ''} ${p.archived.reasonLabel || 'Terminé'}${p.archived.gainTotal ? ' — Gain: ' + formatNumber(p.archived.gainTotal) + '€' : ''}
  </div>`;
}

// ─── Archive section on product sheet ──────────────────
function renderArchiveSection(p) {
  if (!p.archived) return '';
  const a = p.archived;
  const amount = parseFloat(p.investedAmount) || 0;
  const r = ARCHIVE_REASONS.find(x => x.id === a.reason);
  const capitalColor = a.capitalGain >= 0 ? 'var(--green)' : 'var(--red)';

  return `<div class="fiche-section">
    <div class="fiche-section-header"><span class="fiche-section-icon">📦</span><span class="fiche-section-title">Produit Archivé</span></div>
    <div class="fiche-section-body">
      <div class="fiche-info-box neutral" style="margin-bottom:12px">
        <div class="fiche-info-box-title">${r?.icon || '📦'} ${a.reasonLabel || 'Terminé'} le ${new Date(a.date).toLocaleDateString('fr-FR')}</div>
        <div class="fiche-info-box-text">
          ${a.notes ? a.notes + '<br>' : ''}
          Capital investi: <strong>${formatNumber(amount)}€</strong> → Récupéré: <strong>${formatNumber(a.capitalReturned)}€</strong>
          ${a.capitalGain !== 0 ? ` (<span style="color:${capitalColor}">${a.capitalGain >= 0 ? '+' : ''}${formatNumber(a.capitalGain)}€</span>)` : ''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Coupons reçus</div>
          <div style="font-size:20px;font-weight:700;color:var(--green)">${formatNumber(a.totalCouponsReceived)}€</div>
        </div>
        <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Plus/Moins-value</div>
          <div style="font-size:20px;font-weight:700;color:${capitalColor}">${a.capitalGain >= 0 ? '+' : ''}${formatNumber(a.capitalGain)}€</div>
        </div>
        <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Gain total</div>
          <div style="font-size:20px;font-weight:700;color:${a.gainTotal >= 0 ? 'var(--green)' : 'var(--red)'}">${a.gainTotal >= 0 ? '+' : ''}${formatNumber(a.gainTotal)}€</div>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Render archived products section on dashboard ────────
function renderArchivedSection(state) {
  const archived = (state.portfolio || []).filter(p => p.status === 'archived' || p.archived);
  if (archived.length === 0) return '';

  const totalGain = archived.reduce((s, p) => s + (p.archived?.gainTotal || 0), 0);
  const totalCoupons = archived.reduce((s, p) => s + (p.archived?.totalCouponsReceived || 0), 0);

  return `<div class="section" style="opacity:0.75">
    <div class="section-header">
      <div class="section-title"><span class="dot" style="background:#94A3B8"></span>📦 Archives (${archived.length})</div>
      <div style="font-size:12px;color:var(--text-muted)">Gain total: <strong style="color:var(--green)">${formatNumber(totalGain)}€</strong> | Coupons: ${formatNumber(totalCoupons)}€</div>
    </div>
    <div class="portfolio-grid">${archived.map(p => renderProductCard(p, 'archived')).join('')}</div>
  </div>`;
}

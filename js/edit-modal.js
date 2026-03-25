// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Edit Modal v1.1 — with Envelope (ByCam/Caméléons)
// ═══════════════════════════════════════════════════════════════

var ENVELOPES = [
    { id: '', label: '— Aucune —', color: '#94A3B8', icon: '' },
    { id: 'bycam', label: 'ByCam', color: '#3B82F6', icon: '🏦' },
    { id: 'cameleons', label: 'Caméléons', color: '#A855F7', icon: '🦎' }
];

window.getEnvelopeInfo = function(id) {
    return ENVELOPES.find(function(e) { return e.id === id; }) || ENVELOPES[0];
};

window.showEditModal = function() {
    var p = app.state.currentProduct;
    if (!p) { showToast('Aucun produit', 'error'); return; }

    var couponRate = p.coupon?.rate || '';
    var couponType = p.coupon?.type || 'conditionnel';
    var barrier = p.capitalProtection?.barrier || '';
    var protection = p.capitalProtection?.level || (p.capitalProtection?.protected ? '100' : '');
    var autocall = (p.earlyRedemption?.possible === true || p.earlyRedemption?.possible === 'true') ? 'true' : 'false';
    var autocallTrigger = p.earlyRedemption?.trigger || '';
    var amount = p.investedAmount || '';
    var underlyings = (p.underlyings || []).join(', ');
    var currentEnvelope = p.envelope || '';

    var envelopeOptions = ENVELOPES.map(function(e) {
        return '<option value="' + e.id + '"' + (currentEnvelope === e.id ? ' selected' : '') + '>' + (e.icon ? e.icon + ' ' : '') + e.label + '</option>';
    }).join('');

    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">' +
        '<h2 class="modal-title">\u270e Modifier les informations</h2>' +
        '<div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">' + (p.name || 'Produit') + '</div>' +
        '<div class="form-grid">' +
        '<div class="form-field full"><label>Nom du produit</label><input id="fe-name" value="' + escapeAttr(p.name || '') + '"></div>' +
        '<div class="form-field"><label>Enveloppe</label><select id="fe-envelope">' + envelopeOptions + '</select></div>' +
        '<div class="form-field"><label>Montant investi (\u20ac)</label><input id="fe-invested" type="number" value="' + amount + '"></div>' +
        '<div class="form-field"><label>Coupon (%)</label><input id="fe-coupon" type="number" step="0.01" value="' + couponRate + '"></div>' +
        '<div class="form-field"><label>Type coupon</label><select id="fe-coupon-type"><option value="conditionnel"' + (couponType === 'conditionnel' ? ' selected' : '') + '>Conditionnel</option><option value="fixe"' + (couponType === 'fixe' ? ' selected' : '') + '>Fixe</option><option value="garanti"' + (couponType === 'garanti' ? ' selected' : '') + '>Garanti</option></select></div>' +
        '<div class="form-field"><label>Fr\u00e9quence coupon</label><select id="fe-coupon-freq"><option value="annuel"' + ((p.coupon?.frequency || '').indexOf('annuel') >= 0 ? ' selected' : '') + '>Annuel</option><option value="semestriel"' + ((p.coupon?.frequency || '').indexOf('semestr') >= 0 ? ' selected' : '') + '>Semestriel</option><option value="trimestriel"' + ((p.coupon?.frequency || '').indexOf('trimestr') >= 0 ? ' selected' : '') + '>Trimestriel</option></select></div>' +
        '<div class="form-field"><label>Barri\u00e8re capital (%)</label><input id="fe-barrier" type="number" step="0.1" value="' + barrier + '"></div>' +
        '<div class="form-field"><label>Protection capital (%)</label><input id="fe-protection" type="number" step="0.1" value="' + protection + '"></div>' +
        '<div class="form-field"><label>Maturit\u00e9</label><input id="fe-maturity" value="' + escapeAttr(p.maturity || '') + '"></div>' +
        '<div class="form-field"><label>Autocall</label><select id="fe-autocall"><option value="true"' + (autocall === 'true' ? ' selected' : '') + '>Oui</option><option value="false"' + (autocall === 'false' ? ' selected' : '') + '>Non</option></select></div>' +
        '<div class="form-field"><label>Seuil autocall (%)</label><input id="fe-autocall-trigger" type="number" step="1" value="' + autocallTrigger + '"></div>' +
        '<div class="form-field full"><label>Sous-jacents (s\u00e9par\u00e9s par virgule)</label><input id="fe-underlyings" value="' + escapeAttr(underlyings) + '"></div>' +
        '</div>' +
        '<div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleEditSave()">\ud83d\udcbe Enregistrer</button></div>' +
        '</div></div>';
    modal.classList.add('visible');
};

window.handleEditSave = async function() {
    var p = app.state.currentProduct;
    if (!p) return;

    var newName = document.getElementById('fe-name')?.value;
    if (newName) p.name = newName;

    // Envelope
    p.envelope = document.getElementById('fe-envelope')?.value || '';

    var newCoupon = document.getElementById('fe-coupon')?.value;
    if (!p.coupon) p.coupon = {};
    if (newCoupon !== '') p.coupon.rate = parseFloat(newCoupon);
    p.coupon.type = document.getElementById('fe-coupon-type')?.value || p.coupon.type;
    p.coupon.frequency = document.getElementById('fe-coupon-freq')?.value || p.coupon.frequency;

    var newBarrier = document.getElementById('fe-barrier')?.value;
    if (!p.capitalProtection) p.capitalProtection = {};
    if (newBarrier !== '') p.capitalProtection.barrier = parseFloat(newBarrier);

    var newProtection = document.getElementById('fe-protection')?.value;
    if (newProtection !== '') {
        p.capitalProtection.level = parseFloat(newProtection);
        p.capitalProtection.protected = parseFloat(newProtection) > 0;
    }

    var newMaturity = document.getElementById('fe-maturity')?.value;
    if (newMaturity) p.maturity = newMaturity;
    var yearsMatch = newMaturity?.match(/(\d+)/);
    if (yearsMatch) p.maturityYears = parseInt(yearsMatch[1]);

    var newAutocall = document.getElementById('fe-autocall')?.value;
    if (!p.earlyRedemption) p.earlyRedemption = {};
    p.earlyRedemption.possible = newAutocall === 'true';
    p.earlyRedemption.hasAutocall = newAutocall === 'true';
    p.earlyRedemption.enabled = newAutocall === 'true';

    var newTrigger = document.getElementById('fe-autocall-trigger')?.value;
    if (newTrigger !== '') p.earlyRedemption.trigger = parseFloat(newTrigger);

    var newAmount = document.getElementById('fe-invested')?.value;
    if (newAmount !== '') p.investedAmount = parseFloat(newAmount);

    var newUnderlyings = document.getElementById('fe-underlyings')?.value;
    if (newUnderlyings) {
        p.underlyings = newUnderlyings.split(/[,;]/).map(function(s) { return s.trim(); }).filter(Boolean);
    }

    closeModal();

    var bankId = p.bankId;
    if (bankId) { try { await app._saveProductFile(bankId, p); } catch(e) {} }
    var portfolio = app.state.portfolio || [];
    var pfProduct = portfolio.find(function(x) { return x.id === p.id; });
    if (pfProduct) {
        Object.assign(pfProduct, p);
        try { await github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', portfolio, '[StructBoard] Edit: ' + (p.name || p.id).substring(0, 40)); } catch(e) {}
    }

    showToast('Informations mises \u00e0 jour', 'success');
    app.openProduct(p);
};

function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

console.log('[StructBoard] Edit Modal v1.1 \u2014 with envelope ByCam/Cam\u00e9l\u00e9ons');

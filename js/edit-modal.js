// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Edit Modal v1.4 — Structure Type + Strike + Envelope
// v1.4: Added structureType dropdown
//   Types: autocall, phoenix, dispersion, taux_fixe, capital_garanti,
//          reverse, participation, other
// ═══════════════════════════════════════════════════════════════

var ENVELOPES = [
    { id: '', label: '\u2014 Aucune \u2014', color: '#94A3B8', icon: '', liquidity: 0 },
    { id: 'bycam', label: 'ByCam', color: '#3B82F6', icon: '\ud83c\udfe2', liquidity: 100000 },
    { id: 'cameleons', label: 'Cam\u00e9leons', color: '#A855F7', icon: '\ud83e\udd8e', liquidity: 100000 }
];

var STRUCTURE_TYPES = [
    { id: '', label: '\u2014 Auto-d\u00e9tection \u2014' },
    { id: 'autocall', label: 'Autocall / Phoenix' },
    { id: 'phoenix_memoire', label: 'Phoenix \u00e0 m\u00e9moire' },
    { id: 'dispersion', label: 'Dispersion / Perf. relative' },
    { id: 'taux_fixe', label: 'Taux fixe / Callable' },
    { id: 'capital_garanti', label: 'Capital garanti structur\u00e9' },
    { id: 'reverse', label: 'Reverse convertible' },
    { id: 'participation', label: 'Participation / Bonus' },
    { id: 'twin_win', label: 'Twin-Win' },
    { id: 'other', label: 'Autre' }
];

window.getEnvelopeInfo = function(id) {
    return ENVELOPES.find(function(e) { return e.id === id; }) || ENVELOPES[0];
};

window.getStructureTypeLabel = function(id) {
    var found = STRUCTURE_TYPES.find(function(t) { return t.id === id; });
    return found ? found.label : '';
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
    var strikePrice = p.strikePrice || '';
    var structureType = p.structureType || '';

    var envelopeOptions = ENVELOPES.map(function(e) {
        return '<option value="' + e.id + '"' + (currentEnvelope === e.id ? ' selected' : '') + '>' + (e.icon ? e.icon + ' ' : '') + e.label + '</option>';
    }).join('');

    var structTypeOptions = STRUCTURE_TYPES.map(function(t) {
        return '<option value="' + t.id + '"' + (structureType === t.id ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');

    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">' +
        '<h2 class="modal-title">\u270e Modifier les informations</h2>' +
        '<div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">' + (p.name || 'Produit') + '</div>' +
        '<div class="form-grid">' +
        '<div class="form-field full"><label>Nom du produit</label><input id="fe-name" value="' + escapeAttr(p.name || '') + '"></div>' +
        // v1.4: Structure type + Envelope on same row
        '<div class="form-field"><label>Type de structure</label><select id="fe-structure-type">' + structTypeOptions + '</select></div>' +
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
        '<div class="form-field"><label>Niveau initial (strike) <span style="font-size:9px;color:var(--text-dim)">\ud83d\udcca pts ou \u20ac</span></label><input id="fe-strike-price" type="number" step="0.01" value="' + strikePrice + '" placeholder="Ex: 4950"></div>' +
        '<div class="form-field full"><label>Sous-jacents (s\u00e9par\u00e9s par virgule)</label><input id="fe-underlyings" value="' + escapeAttr(underlyings) + '"></div>' +
        '</div>' +
        // Info boxes
        (structureType === 'dispersion' ? '<div style="background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--green)">\u2705 <strong>Dispersion</strong> : le grading tiendra compte du fait que la volatilit\u00e9 \u00e9lev\u00e9e augmente le rendement (pas le risque), et que le capital est garanti.</div>' : '') +
        (strikePrice ? '' : '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--text-muted)">\ud83d\udca1 <strong>Niveau initial (strike)</strong> : renseignez la valeur du sous-jacent \u00e0 la date de souscription pour am\u00e9liorer le calcul du risque barri\u00e8re (distance en \u03c3).</div>') +
        '<div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleEditSave()">\ud83d\udcbe Enregistrer</button></div>' +
        '</div></div>';
    modal.classList.add('visible');
};

window.handleEditSave = async function() {
    var p = app.state.currentProduct;
    if (!p) return;

    var newName = document.getElementById('fe-name')?.value;
    if (newName) p.name = newName;
    p.envelope = document.getElementById('fe-envelope')?.value || '';

    // v1.4: Structure type
    p.structureType = document.getElementById('fe-structure-type')?.value || '';

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

    var newStrike = document.getElementById('fe-strike-price')?.value;
    if (newStrike !== '' && newStrike !== null) p.strikePrice = parseFloat(newStrike);

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

console.log('[StructBoard] Edit Modal v1.4 \u2014 structureType + strike + envelope');

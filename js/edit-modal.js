// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Edit Modal v1.8 — add Panier équipondéré
// v1.8: Added "Panier équipondéré" structure type + info banner
// v1.7: Fix coupon saved as primitive number → frequency not persisted
// v1.6: Added "Barrière Coupon (%)" field for digitale products
// v1.5: Added "À maturité" freq + "Participation" coupon type
// ═══════════════════════════════════════════════════════════════

var ENVELOPES = [
    { id: '', label: '— Aucune —', color: '#94A3B8', icon: '', liquidity: 0 },
    { id: 'bycam', label: 'ByCam', color: '#3B82F6', icon: '🏢', liquidity: 100000 },
    { id: 'cameleons', label: 'Caméléons', color: '#A855F7', icon: '🦎', liquidity: 100000 }
];

var STRUCTURE_TYPES = [
    { id: '', label: '— Auto-détection —' },
    { id: 'autocall', label: 'Autocall / Phoenix' },
    { id: 'phoenix_memoire', label: 'Phoenix à mémoire' },
    { id: 'basket', label: 'Panier équipondéré' },
    { id: 'dispersion', label: 'Dispersion / Perf. relative' },
    { id: 'taux_fixe', label: 'Taux fixe / Callable' },
    { id: 'capital_garanti', label: 'Capital garanti structuré' },
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

    // v1.7: Ensure coupon is an object before reading fields
    var couponObj = (p.coupon && typeof p.coupon === 'object') ? p.coupon : {};
    if (typeof p.coupon === 'number') couponObj.rate = p.coupon;

    var couponRate = couponObj.rate || p.participationRate || '';
    var couponType = couponObj.type || 'conditionnel';
    var couponFreq = couponObj.frequency || couponObj.paymentTiming || 'annuel';
    var barrier = p.capitalProtection?.barrier || '';
    // Don't show 100 as barrier — 100 means no barrier
    if (barrier === 100 && p.capitalProtection?.level === 100) barrier = '';
    var barrierCoupon = p.capitalProtection?.barrierCoupon || '';
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

    var couponTypeOptions = [
        { id: 'conditionnel', label: 'Conditionnel' },
        { id: 'fixe', label: 'Fixe' },
        { id: 'garanti', label: 'Garanti' },
        { id: 'participation', label: 'Participation (%)' }
    ].map(function(t) {
        return '<option value="' + t.id + '"' + (couponType === t.id ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');

    var freqOptions = [
        { id: 'annuel', label: 'Annuel' },
        { id: 'semestriel', label: 'Semestriel' },
        { id: 'trimestriel', label: 'Trimestriel' },
        { id: 'mensuel', label: 'Mensuel' },
        { id: 'maturity', label: 'À maturité' }
    ].map(function(f) {
        var sel = couponFreq.indexOf(f.id) >= 0 || (f.id === 'maturity' && couponFreq === 'maturity');
        return '<option value="' + f.id + '"' + (sel ? ' selected' : '') + '>' + f.label + '</option>';
    }).join('');

    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">' +
        '<h2 class="modal-title">✎ Modifier les informations</h2>' +
        '<div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">' + (p.name || 'Produit') + '</div>' +
        '<div class="form-grid">' +
        '<div class="form-field full"><label>Nom du produit</label><input id="fe-name" value="' + escapeAttr(p.name || '') + '"></div>' +
        '<div class="form-field"><label>Type de structure</label><select id="fe-structure-type">' + structTypeOptions + '</select></div>' +
        '<div class="form-field"><label>Enveloppe</label><select id="fe-envelope">' + envelopeOptions + '</select></div>' +
        '<div class="form-field"><label>Montant investi (€)</label><input id="fe-invested" type="number" value="' + amount + '"></div>' +
        '<div class="form-field"><label>Coupon / Participation (%)</label><input id="fe-coupon" type="number" step="0.01" value="' + couponRate + '"></div>' +
        '<div class="form-field"><label>Type coupon</label><select id="fe-coupon-type">' + couponTypeOptions + '</select></div>' +
        '<div class="form-field"><label>Fréquence paiement</label><select id="fe-coupon-freq">' + freqOptions + '</select></div>' +
        '<div class="form-field"><label>Barrière capital (%)</label><input id="fe-barrier" type="number" step="0.1" value="' + barrier + '" placeholder="Ex: 60 (vide si aucune)"></div>' +
        '<div class="form-field"><label>Barrière coupon (%) <span style="font-size:9px;color:var(--text-dim)">digitale</span></label><input id="fe-barrier-coupon" type="number" step="0.1" value="' + barrierCoupon + '" placeholder="Ex: 100 (vide si aucune)"></div>' +
        '<div class="form-field"><label>Protection capital (%)</label><input id="fe-protection" type="number" step="0.1" value="' + protection + '"></div>' +
        '<div class="form-field"><label>Maturité</label><input id="fe-maturity" value="' + escapeAttr(p.maturity || '') + '"></div>' +
        '<div class="form-field"><label>Autocall</label><select id="fe-autocall"><option value="true"' + (autocall === 'true' ? ' selected' : '') + '>Oui</option><option value="false"' + (autocall === 'false' ? ' selected' : '') + '>Non</option></select></div>' +
        '<div class="form-field"><label>Seuil autocall (%)</label><input id="fe-autocall-trigger" type="number" step="1" value="' + autocallTrigger + '"></div>' +
        '<div class="form-field"><label>Niveau initial (strike) <span style="font-size:9px;color:var(--text-dim)">📊 pts ou €</span></label><input id="fe-strike-price" type="number" step="0.01" value="' + strikePrice + '" placeholder="Ex: 4950"></div>' +
        '<div class="form-field full"><label>Sous-jacents (séparés par virgule)</label><input id="fe-underlyings" value="' + escapeAttr(underlyings) + '"></div>' +
        '</div>' +
        (structureType === 'dispersion' ? '<div style="background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--green)">✅ <strong>Dispersion</strong> : le grading valorisera la volatilité (moteur de rendement) et considèrera le capital comme garanti.</div>' : '') +
        (structureType === 'basket' ? '<div style="background:rgba(78,205,196,0.08);border:1px solid rgba(78,205,196,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:#4ECDC4">🧺 <strong>Panier équipondéré</strong> : le grading utilisera la performance moyenne du panier (pas le worst-of). Risque réduit par la diversification.</div>' : '') +
        (structureType === 'taux_fixe' ? '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--accent)">🏛 <strong>Taux fixe</strong> : le grading comparera le coupon au taux sans risque BCE et évaluera le spread.</div>' : '') +
        (strikePrice ? '' : '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--text-muted)">💡 <strong>Strike</strong> : renseignez la valeur du SJ à la souscription pour améliorer le calcul barrière (σ).</div>') +
        (barrierCoupon ? '<div style="background:rgba(255,182,39,0.08);border:1px solid rgba(255,182,39,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--orange)">🎯 <strong>Digitale</strong> : barrière coupon à ' + barrierCoupon + '%. Le grading estimera la probabilité de toucher le coupon.</div>' : '') +
        '<div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleEditSave()">💾 Enregistrer</button></div>' +
        '</div></div>';
    modal.classList.add('visible');
};

window.handleEditSave = async function() {
    var p = app.state.currentProduct;
    if (!p) return;

    var newName = document.getElementById('fe-name')?.value;
    if (newName) p.name = newName;
    p.envelope = document.getElementById('fe-envelope')?.value || '';
    p.structureType = document.getElementById('fe-structure-type')?.value || '';

    var newCoupon = document.getElementById('fe-coupon')?.value;

    // v1.7 FIX: Force coupon to be an object (not a primitive number)
    if (!p.coupon || typeof p.coupon !== 'object') {
        var oldRate = typeof p.coupon === 'number' ? p.coupon : null;
        p.coupon = {};
        if (oldRate !== null) p.coupon.rate = oldRate;
    }

    if (newCoupon !== '') p.coupon.rate = parseFloat(newCoupon);
    p.coupon.type = document.getElementById('fe-coupon-type')?.value || p.coupon.type;
    p.coupon.frequency = document.getElementById('fe-coupon-freq')?.value || p.coupon.frequency;

    // If participation type, also save as participationRate
    if (p.coupon.type === 'participation' && newCoupon !== '') {
        p.participationRate = parseFloat(newCoupon);
    }

    var newBarrier = document.getElementById('fe-barrier')?.value;
    if (!p.capitalProtection) p.capitalProtection = {};
    if (newBarrier !== '' && newBarrier !== null) {
        p.capitalProtection.barrier = parseFloat(newBarrier);
    } else {
        delete p.capitalProtection.barrier;
    }

    // v1.6: Save barrierCoupon (distinct from capital barrier)
    var newBarrierCoupon = document.getElementById('fe-barrier-coupon')?.value;
    if (newBarrierCoupon !== '' && newBarrierCoupon !== null) {
        p.capitalProtection.barrierCoupon = parseFloat(newBarrierCoupon);
    } else {
        delete p.capitalProtection.barrierCoupon;
    }

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

    showToast('Informations mises à jour', 'success');
    app.openProduct(p);
};

function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

console.log('[StructBoard] Edit Modal v1.8 — Panier équipondéré support');

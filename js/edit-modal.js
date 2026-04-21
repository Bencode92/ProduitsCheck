// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Edit Modal v2.0 — Complete fields
// v2.0: Added décrément, div réel, step-down, start semester,
//       type remboursement, fréquence remboursement, coupon mémoire
// v1.9: JSON paste import
// ═══════════════════════════════════════════════════════════════

var ENVELOPES = [
    { id: '', label: '— Aucune —', color: '#94A3B8', icon: '', liquidity: 0 },
    { id: 'bycam', label: 'ByCam', color: '#3B82F6', icon: '🏢', liquidity: 100000 },
    { id: 'cameleons', label: 'Caméléons', color: '#A855F7', icon: '🦎', liquidity: 100000 },
    { id: 'swiss-life', label: 'Swiss Life (long terme)', color: '#E85D04', icon: '🛡️', liquidity: 0 }
];

var STRUCTURE_TYPES = [
    { id: '', label: '— Auto-détection —' },
    { id: 'autocall', label: 'Autocall / Phoenix' },
    { id: 'phoenix_memoire', label: 'Phoenix à mémoire' },
    { id: 'basket', label: 'Panier équipondéré' },
    { id: 'dispersion', label: 'Dispersion / Perf. relative' },
    { id: 'taux_fixe', label: 'Taux fixe / Callable' },
    { id: 'taux_fixe_in_fine', label: 'Taux fixe / Callable In Fine' },
    { id: 'range_accrual', label: '📊 Range Accrual' },
    { id: 'capital_garanti', label: 'Capital garanti / TARN' },
    { id: 'digitale_memoire', label: 'Digitale Mémoire' },
    { id: 'reverse', label: 'Reverse convertible' },
    { id: 'participation', label: 'Participation / Bonus' },
    { id: 'twin_win', label: 'Twin-Win' },
    { id: 'fonds_obligataire', label: 'Fonds obligataire / OPCVM' },
    { id: 'etf', label: 'ETF / Tracker' },
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

    var couponObj = (p.coupon && typeof p.coupon === 'object') ? p.coupon : {};
    if (typeof p.coupon === 'number') couponObj.rate = p.coupon;

    var couponRate = couponObj.rate || p.participationRate || '';
    var couponType = couponObj.type || 'conditionnel';
    var couponFreq = couponObj.frequency || couponObj.paymentTiming || 'annuel';
    var couponMemory = couponObj.memory === true;
    var barrier = p.capitalProtection?.barrier || '';
    if (barrier === 100 && p.capitalProtection?.level === 100) barrier = '';
    var barrierCoupon = p.capitalProtection?.barrierCoupon || '';
    var protection = p.capitalProtection?.level || (p.capitalProtection?.protected ? '100' : '');
    var autocall = (p.earlyRedemption?.possible === true || p.earlyRedemption?.possible === 'true') ? 'true' : 'false';
    var autocallTrigger = p.earlyRedemption?.trigger || '';
    var erType = p.earlyRedemption?.type || 'autocall';
    var erFreq = p.earlyRedemption?.frequency || 'annuel';
    var erStart = p.earlyRedemption?.startSemester || '';
    var erStepDown = p.earlyRedemption?.stepDown === true;
    var erStepDownPct = p.earlyRedemption?.stepDownPct || '';
    var amount = p.investedAmount || '';
    var underlyings = (p.underlyings || []).join(', ');
    var currentEnvelope = p.envelope || '';
    var strikePrice = p.strikePrice || '';
    var structureType = p.structureType || '';
    var decrementPct = p.decrementPct || '';
    var minInvestment = p.minInvestment || '';
    var divYield = p.actualDividendYield || '';

    var envelopeOptions = ENVELOPES.map(function(e) {
        return '<option value="' + e.id + '"' + (currentEnvelope === e.id ? ' selected' : '') + '>' + (e.icon ? e.icon + ' ' : '') + e.label + '</option>';
    }).join('');

    var structTypeOptions = STRUCTURE_TYPES.map(function(t) {
        return '<option value="' + t.id + '"' + (structureType === t.id ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');

    var couponTypeOptions = [
        { id: 'conditionnel', label: 'Conditionnel' },
        { id: 'fixe', label: 'Fixe' },
        { id: 'fixe_capitalise', label: 'Fixe capitalisé (In Fine)' },
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
        { id: 'in_fine', label: 'In Fine (capitalisé)' },
        { id: 'maturity', label: 'À maturité' }
    ].map(function(f) {
        var sel = couponFreq === f.id || (f.id === 'maturity' && couponFreq === 'maturity');
        return '<option value="' + f.id + '"' + (sel ? ' selected' : '') + '>' + f.label + '</option>';
    }).join('');

    var erTypeOptions = [
        { id: 'autocall', label: 'Autocall (marché)' },
        { id: 'callable', label: 'Callable (émetteur)' },
        { id: 'tarn', label: 'TARN (cumul coupons)' },
        { id: 'none', label: 'Aucun' }
    ].map(function(t) {
        return '<option value="' + t.id + '"' + (erType === t.id ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');

    var erFreqOptions = [
        { id: 'annuel', label: 'Annuel' },
        { id: 'semestriel', label: 'Semestriel' },
        { id: 'trimestriel', label: 'Trimestriel' }
    ].map(function(f) {
        return '<option value="' + f.id + '"' + (erFreq === f.id ? ' selected' : '') + '>' + f.label + '</option>';
    }).join('');

    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-width:780px">' +
        '<h2 class="modal-title">✎ Modifier les informations</h2>' +
        '<div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">' + (p.name || 'Produit') + '</div>' +

        // JSON paste zone
        '<div id="json-paste-zone" style="display:none;margin-bottom:16px">' +
        '<textarea id="fe-json-input" placeholder="Colle ici le JSON de l\'analyseur de brochure..." style="width:100%;height:120px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:monospace;font-size:11px;padding:8px;resize:vertical;box-sizing:border-box"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn primary" onclick="handleJSONImport()" style="font-size:11px;padding:6px 14px">✅ Appliquer le JSON</button>' +
        '<button class="btn" onclick="document.getElementById(\'json-paste-zone\').style.display=\'none\'" style="font-size:11px;padding:6px 14px">Annuler</button>' +
        '</div></div>' +

        '<div style="margin-bottom:12px">' +
        '<button class="btn" onclick="toggleJSONPaste()" style="font-size:11px;padding:5px 12px;background:rgba(88,166,255,0.1);border-color:rgba(88,166,255,0.3);color:var(--accent)">📋 Coller JSON (depuis l\'analyseur)</button>' +
        '</div>' +

        // ─── Section 1: Identité ───
        '<div style="font-size:10px;font-weight:700;color:var(--text-muted);margin:16px 0 8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);padding-bottom:4px">🏷️ Identité</div>' +
        '<div class="form-grid">' +
        '<div class="form-field full"><label>Nom du produit</label><input id="fe-name" value="' + escapeAttr(p.name || '') + '"></div>' +
        '<div class="form-field"><label>Type de structure</label><select id="fe-structure-type">' + structTypeOptions + '</select></div>' +
        '<div class="form-field"><label>Enveloppe</label><select id="fe-envelope">' + envelopeOptions + '</select></div>' +
        '<div class="form-field"><label>Montant investi (€)</label><input id="fe-invested" type="number" value="' + amount + '"></div>' +
        '<div class="form-field"><label>Nominal unitaire (€)</label><input id="fe-mininvest" type="number" value="' + minInvestment + '" placeholder="Ex: 100000"></div>' +
        '<div class="form-field"><label>Maturité</label><input id="fe-maturity" value="' + escapeAttr(p.maturity || '') + '"></div>' +
        '<div class="form-field"><label>Niveau initial (strike)</label><input id="fe-strike-price" type="number" step="0.01" value="' + strikePrice + '" placeholder="Ex: 4950"></div>' +
        '<div class="form-field full"><label>Sous-jacents (séparés par virgule)</label><input id="fe-underlyings" value="' + escapeAttr(underlyings) + '"></div>' +
        '</div>' +

        // ─── Section 2: Coupon ───
        '<div style="font-size:10px;font-weight:700;color:var(--green);margin:20px 0 8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);padding-bottom:4px">💰 Coupon</div>' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Coupon / Participation (%)</label><input id="fe-coupon" type="number" step="0.01" value="' + couponRate + '"></div>' +
        '<div class="form-field"><label>Type coupon</label><select id="fe-coupon-type">' + couponTypeOptions + '</select></div>' +
        '<div class="form-field"><label>Fréquence paiement</label><select id="fe-coupon-freq">' + freqOptions + '</select></div>' +
        '<div class="form-field"><label>Coupon mémoire</label><select id="fe-coupon-memory"><option value="false"' + (!couponMemory ? ' selected' : '') + '>Non</option><option value="true"' + (couponMemory ? ' selected' : '') + '>Oui — rattrapage</option></select></div>' +
        '<div class="form-field"><label>Années garanties</label><input id="fe-guaranteed-years" type="number" value="' + (p.guaranteedYears || 0) + '" placeholder="Ex: 2 (An 1-2 sans condition)"></div>' +
        '<div class="form-field"><label>Commissions (%)</label><input id="fe-commissions" type="number" step="0.01" value="' + ((p.commissions || '') + '') + '" placeholder="Ex: 1.30"></div>' +
        '</div>' +

        // ─── Section 3: Protection Capital ───
        '<div style="font-size:10px;font-weight:700;color:var(--orange);margin:20px 0 8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);padding-bottom:4px">🛡️ Protection Capital</div>' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Barrière capital (%)</label><input id="fe-barrier" type="number" step="0.1" value="' + barrier + '" placeholder="Ex: 60"></div>' +
        '<div class="form-field"><label>Barrière coupon (%) <span style="font-size:9px;color:var(--text-dim)">digitale</span></label><input id="fe-barrier-coupon" type="number" step="0.1" value="' + barrierCoupon + '" placeholder="Ex: 100"></div>' +
        '<div class="form-field"><label>Protection capital (%)</label><input id="fe-protection" type="number" step="0.1" value="' + protection + '"></div>' +
        '</div>' +

        // ─── Section 4: Remboursement anticipé (masqué pour les produits simples) ───
        '<div id="fe-section-autocall" style="font-size:10px;font-weight:700;color:var(--red);margin:20px 0 8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);padding-bottom:4px">⏰ Remboursement Anticipé</div>' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Rappel possible</label><select id="fe-autocall"><option value="true"' + (autocall === 'true' ? ' selected' : '') + '>Oui</option><option value="false"' + (autocall === 'false' ? ' selected' : '') + '>Non</option></select></div>' +
        '<div class="form-field"><label>Type</label><select id="fe-er-type">' + erTypeOptions + '</select></div>' +
        '<div class="form-field"><label>Seuil autocall (%) <span style="font-size:11px;color:var(--text-dim)">ou trigger action</span></label><input id="fe-autocall-trigger" type="number" step="1" value="' + autocallTrigger + '"></div>' +
        '<div class="form-field"><label>Autocall cumul target (%) <span style="font-size:11px;color:var(--text-dim)">TARN</span></label><input id="fe-autocall-cumul" type="number" step="0.1" value="' + (p.autocallCumulTarget || (p.earlyRedemption && p.earlyRedemption.trigger > 20 ? p.earlyRedemption.trigger : '') || '') + '" placeholder="Ex: 26.80"></div>' +
        '<div class="form-field"><label>Fréquence observation</label><select id="fe-er-freq">' + erFreqOptions + '</select></div>' +
        '<div class="form-field"><label>Début (semestre n°)</label><input id="fe-er-start" type="number" step="1" value="' + erStart + '" placeholder="Ex: 4"></div>' +
        '<div class="form-field"><label>Step-down</label><select id="fe-stepdown"><option value="false"' + (!erStepDown ? ' selected' : '') + '>Non</option><option value="true"' + (erStepDown ? ' selected' : '') + '>Oui — dégressif</option></select></div>' +
        '<div class="form-field"><label>Step-down (%/période)</label><input id="fe-stepdown-pct" type="number" step="0.1" value="' + erStepDownPct + '" placeholder="Ex: 2.5"></div>' +
        '</div>' +

        // ─── Section 5: Décrément (seulement pour produits actions avec décrément) ───
        (structureType === 'autocall' || structureType === 'phoenix_memoire' || structureType === 'basket' || decrementPct ? (
        '<div style="font-size:10px;font-weight:700;color:var(--purple);margin:20px 0 8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);padding-bottom:4px">📉 Décrément</div>' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Décrément (%/an)</label><input id="fe-decrement" type="number" step="0.01" value="' + decrementPct + '" placeholder="Ex: 5"></div>' +
        '<div class="form-field"><label>Dividende réel (%/an)</label><input id="fe-divyield" type="number" step="0.01" value="' + divYield + '" placeholder="Ex: 0.97"></div>' +
        (decrementPct && divYield ? '<div class="form-field"><label>Drag annuel</label><div style="padding:8px;background:var(--red-dim);border-radius:var(--radius-sm);color:var(--red);font-size:12px;font-weight:600">' + (decrementPct - divYield).toFixed(2) + '%/an invisible</div></div>' : '') +
        '</div>'
        ) : '') +

        // ─── Section 6: Range Accrual (conditional) ───
        (structureType === 'range_accrual' ? (
        '<div style="font-size:10px;font-weight:700;color:#A855F7;margin:20px 0 8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);padding-bottom:4px">📊 Range Accrual</div>' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>Borne basse (%)</label><input id="fe-ra-lower" type="number" step="0.01" value="' + escapeAttr(((p.rangeAccrual || {}).lowerBound) || '') + '" placeholder="Ex: 1.75"></div>' +
        '<div class="form-field"><label>Borne haute (%)</label><input id="fe-ra-upper" type="number" step="0.01" value="' + escapeAttr(((p.rangeAccrual || {}).upperBound) || '') + '" placeholder="Ex: 3.50"></div>' +
        '<div class="form-field"><label>Taux de référence</label><select id="fe-ra-reference">' +
          [{ id: 'Euribor 3 mois', label: 'Euribor 3 mois' }, { id: 'Euribor 6 mois', label: 'Euribor 6 mois' }, { id: 'Euribor 12 mois', label: 'Euribor 12 mois' }, { id: 'CMS 10 ans', label: 'CMS 10 ans' }, { id: 'CMS 2 ans', label: 'CMS 2 ans' }, { id: 'TEC 10', label: 'TEC 10' }, { id: 'Autre', label: 'Autre' }].map(function(r) {
            return '<option value="' + r.id + '"' + (((p.rangeAccrual || {}).reference || 'Euribor 3 mois') === r.id ? ' selected' : '') + '>' + r.label + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="form-field"><label>Observation</label><select id="fe-ra-observation">' +
          [{ id: 'daily', label: 'Journalière' }, { id: 'weekly', label: 'Hebdomadaire' }, { id: 'monthly', label: 'Mensuelle' }].map(function(o) {
            return '<option value="' + o.id + '"' + (((p.rangeAccrual || {}).observation || 'daily') === o.id ? ' selected' : '') + '>' + o.label + '</option>';
          }).join('') +
        '</select></div>' +
        '</div>'
        ) : '') +

        _getInfoBanners(structureType, barrierCoupon, strikePrice, decrementPct, divYield) +
        '<div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleEditSave()">💾 Enregistrer</button></div>' +
        '</div></div>';
    modal.classList.add('visible');
};

window.toggleJSONPaste = function() {
    var zone = document.getElementById('json-paste-zone');
    if (zone) {
        zone.style.display = zone.style.display === 'none' ? 'block' : 'none';
        if (zone.style.display !== 'none') {
            var input = document.getElementById('fe-json-input');
            if (input) input.focus();
        }
    }
};

window.handleJSONImport = function() {
    var input = document.getElementById('fe-json-input');
    if (!input || !input.value.trim()) {
        showToast('Colle un JSON valide', 'error');
        return;
    }

    try {
        var json = JSON.parse(input.value.trim());
        console.log('[EditModal V2.0] JSON import:', json);

        // Fill ALL form fields from JSON
        _setFieldValue('fe-name', json.name);
        _setFieldValue('fe-structure-type', json.structureType);
        _setFieldValue('fe-maturity', json.maturity);

        // Coupon
        if (json.coupon && typeof json.coupon === 'object') {
            _setFieldValue('fe-coupon', json.coupon.rate);
            _setFieldValue('fe-coupon-type', json.coupon.type);
            _setFieldValue('fe-coupon-freq', json.coupon.frequency);
            _setFieldValue('fe-coupon-memory', json.coupon.memory ? 'true' : 'false');
        } else if (json.participationRate) {
            _setFieldValue('fe-coupon', json.participationRate);
            _setFieldValue('fe-coupon-type', 'participation');
        }

        // Capital protection
        if (json.capitalProtection) {
            var cp = json.capitalProtection;
            _setFieldValue('fe-barrier', cp.barrier);
            _setFieldValue('fe-barrier-coupon', cp.barrierCoupon);
            _setFieldValue('fe-protection', cp.protected ? (cp.level || 100) : '');
        }

        // Early redemption — ALL fields now visible
        if (json.earlyRedemption) {
            var er = json.earlyRedemption;
            _setFieldValue('fe-autocall', er.possible ? 'true' : 'false');
            _setFieldValue('fe-autocall-trigger', er.trigger);
            _setFieldValue('fe-er-type', er.type);
            _setFieldValue('fe-er-freq', er.frequency);
            _setFieldValue('fe-er-start', er.startSemester);
            _setFieldValue('fe-stepdown', er.stepDown ? 'true' : 'false');
            _setFieldValue('fe-stepdown-pct', er.stepDownPct);
        }

        // Extra fields
        _setFieldValue('fe-guaranteed-years', json.guaranteedYears);
        _setFieldValue('fe-commissions', json.commissions);
        _setFieldValue('fe-autocall-cumul', json.autocallCumulTarget);
        _setFieldValue('fe-strike-price', json.strikePrice);

        // Décrément
        _setFieldValue('fe-decrement', json.decrementPct);
        _setFieldValue('fe-divyield', json.actualDividendYield);
        _setFieldValue('fe-mininvest', json.minInvestment);

        // Underlyings
        if (json.underlyings && Array.isArray(json.underlyings)) {
            // Normalize: handle objects like {name: "..."} 
            var strs = json.underlyings.map(function(u) {
                return typeof u === 'string' ? u : (u && u.name) || String(u);
            });
            _setFieldValue('fe-underlyings', strs.join(', '));
        }

        // Inject hidden fields into product
        var p = app.state.currentProduct;
        if (p) {
            if (json.guarantorRating) p.guarantorRating = json.guarantorRating;
            if (json.mechanism) p.mechanism = json.mechanism;
            if (json.risks) p.risks = Array.isArray(json.risks) ? json.risks.map(function(r) { return typeof r === 'string' ? r : r.name || String(r); }) : json.risks;
            if (json.underlyingType) p.underlyingType = json.underlyingType;
            if (json.summary) p.summary = json.summary;
            if (json.guarantor) p.guarantor = json.guarantor;
            if (json.emitter) p.emitter = json.emitter;
            if (json.coupon && json.coupon.rateIfCalled) { if (!p.coupon) p.coupon = {}; p.coupon.rateIfCalled = json.coupon.rateIfCalled; }
            if (json.coupon && json.coupon.rateIfMaturity) { if (!p.coupon) p.coupon = {}; p.coupon.rateIfMaturity = json.coupon.rateIfMaturity; }
            if (json.coupon && json.coupon.paymentTiming) { if (!p.coupon) p.coupon = {}; p.coupon.paymentTiming = json.coupon.paymentTiming; }
            if (json.coupon && json.coupon.trigger) { if (!p.coupon) p.coupon = {}; p.coupon.trigger = json.coupon.trigger; }
            if (json.isin) p.isin = json.isin;
            if (json.callSchedule) p.callSchedule = json.callSchedule;
            if (json.earlyRedemption && json.earlyRedemption.callSchedule) {
                if (!p.earlyRedemption) p.earlyRedemption = {};
                p.earlyRedemption.callSchedule = json.earlyRedemption.callSchedule;
                if (json.earlyRedemption.firstCallDate) p.earlyRedemption.firstCallDate = json.earlyRedemption.firstCallDate;
            }
            if (json.maturityYears) p.maturityYears = json.maturityYears;
            p.aiParsed = json;
            console.log('[EditModal V2.0] Product enriched with ALL JSON data');
        }

        document.getElementById('json-paste-zone').style.display = 'none';
        showToast('✅ JSON importé — vérifiez tous les champs puis Enregistrez', 'success');

    } catch(e) {
        console.error('[EditModal V2.0] JSON parse error:', e);
        showToast('JSON invalide: ' + e.message, 'error');
    }
};

function _setFieldValue(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    if (value === null || value === undefined) return;
    // Allow 0 and false as valid values
    var strVal = String(value);
    if (el.tagName === 'SELECT') {
        // For selects, check if option exists before setting
        var opts = el.options;
        for (var i = 0; i < opts.length; i++) {
            if (opts[i].value === strVal) { el.selectedIndex = i; return; }
        }
        // Try case-insensitive match
        for (var j = 0; j < opts.length; j++) {
            if (opts[j].value.toLowerCase() === strVal.toLowerCase()) { el.selectedIndex = j; return; }
        }
        console.warn('[EditModal] No matching option for #' + id + ' = "' + strVal + '"');
    } else {
        el.value = value;
    }
}

function _getInfoBanners(structureType, barrierCoupon, strikePrice, decrementPct, divYield) {
    var html = '';
    if (structureType === 'dispersion') {
        html += '<div style="background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--green)">✅ <strong>Dispersion</strong> : le grading valorisera la volatilité et considèrera le capital comme garanti.</div>';
    }
    if (structureType === 'basket') {
        html += '<div style="background:rgba(78,205,196,0.08);border:1px solid rgba(78,205,196,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:#4ECDC4">🧺 <strong>Panier</strong> : performance moyenne du panier (pas worst-of). Risque réduit.</div>';
    }
    if (structureType === 'taux_fixe') {
        html += '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--accent)">🏛 <strong>Taux fixe</strong> : comparaison au taux sans risque BCE.</div>';
    }
    if (structureType === 'taux_fixe_in_fine') {
        html += '<div style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:#7C3AED">📅 <strong>Callable In Fine</strong> : coupon capitalisé versé uniquement au rappel ou à maturité.</div>';
    }
    if (structureType === 'range_accrual') {
        html += '<div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:#A855F7">📊 <strong>Range Accrual</strong> : coupon = taux max × (jours dans le corridor / jours total). Capital garanti.</div>';
    }
    if (!strikePrice) {
        html += '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--text-muted)">💡 <strong>Strike</strong> : renseignez la valeur du SJ à la souscription.</div>';
    }
    if (barrierCoupon) {
        html += '<div style="background:rgba(255,182,39,0.08);border:1px solid rgba(255,182,39,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--orange)">🎯 <strong>Digitale</strong> : barrière coupon à ' + barrierCoupon + '%.</div>';
    }
    if (decrementPct && decrementPct > 0) {
        var drag = decrementPct - (divYield || 0);
        html += '<div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--red)">⚠️ <strong>Décrément</strong> : ' + decrementPct + '%/an prélevé vs ' + (divYield || '?') + '% div réel → drag de ' + drag.toFixed(2) + '%/an.</div>';
    }
    return html;
}

window.handleEditSave = async function() {
    var p = app.state.currentProduct;
    if (!p) return;

    // ─── Identité ───
    var newName = document.getElementById('fe-name')?.value;
    if (newName) p.name = newName;
    p.envelope = document.getElementById('fe-envelope')?.value || '';
    p.structureType = document.getElementById('fe-structure-type')?.value || '';

    // ─── Coupon ───
    var newCoupon = document.getElementById('fe-coupon')?.value;
    if (!p.coupon || typeof p.coupon !== 'object') {
        var oldRate = typeof p.coupon === 'number' ? p.coupon : null;
        p.coupon = {};
        if (oldRate !== null) p.coupon.rate = oldRate;
    }
    if (newCoupon !== '') p.coupon.rate = parseFloat(newCoupon);
    p.coupon.type = document.getElementById('fe-coupon-type')?.value || p.coupon.type;
    p.coupon.frequency = document.getElementById('fe-coupon-freq')?.value || p.coupon.frequency;
    p.coupon.memory = document.getElementById('fe-coupon-memory')?.value === 'true';

    // Guaranteed years + commissions
    var gYears = document.getElementById('fe-guaranteed-years')?.value;
    if (gYears !== '' && gYears !== null) p.guaranteedYears = parseInt(gYears);
    var commVal = document.getElementById('fe-commissions')?.value;
    if (commVal !== '' && commVal !== null) p.commissions = parseFloat(commVal);

    if (p.coupon.type === 'participation' && newCoupon !== '') {
        p.participationRate = parseFloat(newCoupon);
    }

    // ─── Capital Protection ───
    var newBarrier = document.getElementById('fe-barrier')?.value;
    if (!p.capitalProtection) p.capitalProtection = {};
    if (newBarrier !== '' && newBarrier !== null) {
        p.capitalProtection.barrier = parseFloat(newBarrier);
    } else {
        delete p.capitalProtection.barrier;
    }

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

    // ─── Maturité ───
    var newMaturity = document.getElementById('fe-maturity')?.value;
    if (newMaturity) p.maturity = newMaturity;
    var yearsMatch = newMaturity?.match(/(\d+)/);
    if (yearsMatch) p.maturityYears = parseInt(yearsMatch[1]);

    // ─── Early Redemption (COMPLETE) ───
    if (!p.earlyRedemption) p.earlyRedemption = {};
    var newAutocall = document.getElementById('fe-autocall')?.value;
    p.earlyRedemption.possible = newAutocall === 'true';
    p.earlyRedemption.hasAutocall = newAutocall === 'true';
    p.earlyRedemption.enabled = newAutocall === 'true';

    var newTrigger = document.getElementById('fe-autocall-trigger')?.value;
    if (newTrigger !== '') p.earlyRedemption.trigger = parseFloat(newTrigger);

    // Autocall cumul target (TARN)
    var cumulTarget = document.getElementById('fe-autocall-cumul')?.value;
    if (cumulTarget !== '' && cumulTarget !== null) p.autocallCumulTarget = parseFloat(cumulTarget);

    var newErType = document.getElementById('fe-er-type')?.value;
    if (newErType) p.earlyRedemption.type = newErType;

    var newErFreq = document.getElementById('fe-er-freq')?.value;
    if (newErFreq) p.earlyRedemption.frequency = newErFreq;

    var newErStart = document.getElementById('fe-er-start')?.value;
    if (newErStart !== '') p.earlyRedemption.startSemester = parseInt(newErStart);

    p.earlyRedemption.stepDown = document.getElementById('fe-stepdown')?.value === 'true';

    var newStepDownPct = document.getElementById('fe-stepdown-pct')?.value;
    if (newStepDownPct !== '') p.earlyRedemption.stepDownPct = parseFloat(newStepDownPct);

    // ─── Décrément ───
    var newDecrement = document.getElementById('fe-decrement')?.value;
    if (newDecrement !== '') p.decrementPct = parseFloat(newDecrement);
    else delete p.decrementPct;

    var newDivYield = document.getElementById('fe-divyield')?.value;
    if (newDivYield !== '') p.actualDividendYield = parseFloat(newDivYield);
    else delete p.actualDividendYield;

    // ─── Range Accrual ───
    if (p.structureType === 'range_accrual') {
      p.rangeAccrual = {
        lowerBound: parseFloat(document.getElementById('fe-ra-lower')?.value) || 0,
        upperBound: parseFloat(document.getElementById('fe-ra-upper')?.value) || 0,
        reference: document.getElementById('fe-ra-reference')?.value || 'Euribor 3 mois',
        observation: document.getElementById('fe-ra-observation')?.value || 'daily'
      };
      // Force correct types for range accrual
      p.underlyingType = 'rates';
      if (p.coupon) p.coupon.type = 'conditionnel';
      if (!p.capitalProtection) p.capitalProtection = {};
      p.capitalProtection.protected = true;
      p.capitalProtection.level = 100;
    }

    // ─── Montant minimum ───
    var newMinInvest = document.getElementById('fe-mininvest')?.value;
    if (newMinInvest !== '' && newMinInvest !== undefined) p.minInvestment = parseFloat(newMinInvest);
    else delete p.minInvestment;

    // ─── Other fields ───
    var newAmount = document.getElementById('fe-invested')?.value;
    if (newAmount !== '') p.investedAmount = parseFloat(newAmount);

    var newStrike = document.getElementById('fe-strike-price')?.value;
    if (newStrike !== '' && newStrike !== null) p.strikePrice = parseFloat(newStrike);

    var newUnderlyings = document.getElementById('fe-underlyings')?.value;
    if (newUnderlyings) {
        p.underlyings = newUnderlyings.split(/[,;]/).map(function(s) { return s.trim(); }).filter(Boolean);
        // Auto-detect rate underlyings → set underlyingType = 'rates'
        var undText = newUnderlyings.toLowerCase();
        if (/tec\s*\d|euribor|cms\s*\d|ester|eonia|libor|€str/i.test(undText)) {
          p.underlyingType = 'rates';
        }
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

console.log('[StructBoard] Edit Modal v2.0 — complete fields');

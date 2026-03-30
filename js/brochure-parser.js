// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Brochure Parser v1.0
// Intégré dans StructBoard (onglet Analyseur)
// Upload PDF → Claude analyse via proxy → Formulaire → Ajout direct
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── System prompt (aligned with pdf.js V7.9 — 25 rules) ───
  var PARSER_PROMPT = [
    'Tu es un parseur expert en produits structurés financiers.',
    'Tu reçois une brochure PDF. Extrais TOUTES les données en JSON strict.',
    '',
    'RÈGLES CRITIQUES :',
    '',
    'STRUCTURE:',
    '- "remboursement anticipé automatique si sous-jacent ≥ X%" = autocall',
    '- "rappelé à la discrétion de l\'émetteur" / "au gré de l\'émetteur" = callable (PAS autocall). structureType="taux_fixe", earlyRedemption.type="callable"',
    '- "performance relative" / "dispersion" = structureType "dispersion"',
    '- "panier équipondéré" / "niveau du panier" = structureType "basket"',
    '- "taux fixe" sans sous-jacent actions = structureType "taux_fixe"',
    '',
    'COUPON:',
    '- "coupon de X% par semestre écoulé" → rate=X, frequency="semestriel". Le "× nombre de semestres" est la formule de PAIEMENT TOTAL, PAS le taux. Ne JAMAIS multiplier.',
    '- "4,50% par semestre (9,00% p.a.)" → rate=4.5, frequency="semestriel".',
    '- Si rappelé = Z%/an et maturité = W%/an (Z≠W) → rateIfCalled=Z, rateIfMaturity=W',
    '- "participation de X%" = participationRate, PAS un coupon classique. type="participation"',
    '- Si paiement "à maturité" uniquement → paymentTiming="maturity"',
    '',
    'CAPITAL:',
    '- "Protection du capital : Non" ou "risque de perte en capital" → protected=false.',
    '  MÊME si "100% du Capital Initial" apparaît dans la description du paiement.',
    '- "Protection du capital : 100%" / "capital garanti" / "protection totale" → protected=true, level=100',
    '- Barrière capital = seuil de PERTE en capital (ex: 50% → perte si SJ < 50%)',
    '- Barrière coupon = seuil de VERSEMENT du coupon (ex: 60% → coupon si SJ ≥ 60%)',
    '- "baisse de plus de X%" → barrière = 100-X',
    '',
    'AUTOCALL / RAPPEL:',
    '- "95% dès le semestre 4 puis -2.50%" → trigger=95, startSemester=4, stepDown=true, stepDownPct=2.5',
    '- "dégressive" = stepDown=true',
    '- "au gré de l\'émetteur" → type="callable", trigger=null',
    '',
    'DÉCRÉMENT:',
    '- "prélèvement forfaitaire X%" / "décrément X%" → decrementPct=X',
    '- "dividendes nets moyens Y%" → actualDividendYield=Y',
    '',
    'Réponds UNIQUEMENT avec le JSON. AUCUN texte avant/après. AUCUN markdown.',
    '',
    '{',
    '  "name": "",',
    '  "structureType": "",',
    '  "emitter": "",',
    '  "guarantor": "",',
    '  "guarantorRating": {"moodys": "", "sp": ""},',
    '  "underlyings": [],',
    '  "underlyingType": "",',
    '  "currency": "EUR",',
    '  "maturity": "",',
    '  "maturityYears": 0,',
    '  "coupon": {',
    '    "rate": 0,',
    '    "rateIfCalled": null,',
    '    "rateIfMaturity": null,',
    '    "type": "",',
    '    "frequency": "",',
    '    "trigger": null,',
    '    "memory": false,',
    '    "paymentTiming": ""',
    '  },',
    '  "participationRate": null,',
    '  "capitalProtection": {',
    '    "protected": false,',
    '    "level": null,',
    '    "barrier": null,',
    '    "barrierCoupon": null,',
    '    "barrierType": "europeenne"',
    '  },',
    '  "earlyRedemption": {',
    '    "possible": false,',
    '    "type": "",',
    '    "trigger": null,',
    '    "frequency": "",',
    '    "startSemester": null,',
    '    "stepDown": false,',
    '    "stepDownPct": null',
    '  },',
    '  "decrementPct": null,',
    '  "actualDividendYield": null,',
    '  "mechanism": "",',
    '  "risks": [],',
    '  "summary": ""',
    '}'
  ].join('\n');

  // ─── Structure options ───
  var STRUCT_OPTS = [
    { v: 'autocall', l: 'Autocall / Phoenix' },
    { v: 'taux_fixe', l: 'Taux fixe / Callable' },
    { v: 'capital_garanti', l: 'Capital garanti' },
    { v: 'dispersion', l: 'Dispersion' },
    { v: 'basket', l: 'Panier équipondéré' },
    { v: 'reverse', l: 'Reverse convertible' },
    { v: 'phoenix_memoire', l: 'Phoenix à mémoire' }
  ];

  var UND_TYPES = ['single-stock', 'single-index', 'worst-of', 'basket', 'pairs', 'none'];
  var FREQ_OPTS = ['annuel', 'semestriel', 'trimestriel', 'à maturité'];
  var COUPON_TYPES = ['conditionnel', 'fixe', 'participation'];
  var ER_TYPES = ['autocall', 'callable', 'none'];

  // ─── State ───
  var _phase = 'upload';
  var _data = null;
  var _fileName = '';
  var _error = '';
  var _selectedBank = '';
  var _investedAmount = '';

  // ─── Helpers ───
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function _sel(id, val, opts) {
    var html = '<select id="' + id + '" class="bp-select">';
    opts.forEach(function(o) {
      var v = typeof o === 'string' ? o : o.v;
      var l = typeof o === 'string' ? o : o.l;
      html += '<option value="' + esc(v) + '"' + (val === v ? ' selected' : '') + '>' + esc(l) + '</option>';
    });
    return html + '</select>';
  }

  function _inp(id, val, type, ph) {
    type = type || 'text';
    return '<input id="' + id + '" type="' + type + '"' +
      ' value="' + esc(val != null ? String(val) : '') + '"' +
      (ph ? ' placeholder="' + esc(ph) + '"' : '') +
      (type === 'number' ? ' step="0.01"' : '') +
      ' class="bp-input">';
  }

  function _tog(id, val, label) {
    return '<label class="bp-toggle"><input type="checkbox" id="' + id + '"' + (val ? ' checked' : '') + '>' +
      '<span class="bp-toggle-track"><span class="bp-toggle-thumb"></span></span>' +
      '<span>' + esc(label) + '</span></label>';
  }

  function _field(label, content, hint) {
    return '<div class="bp-field">' +
      '<div class="bp-label">' + esc(label) + '</div>' +
      content +
      (hint ? '<div class="bp-hint">' + esc(hint) + '</div>' : '') +
      '</div>';
  }

  function _section(title, icon, color, content) {
    return '<div class="bp-section">' +
      '<div class="bp-section-header" style="border-color:' + color + '">' +
        '<span>' + icon + '</span>' +
        '<span style="color:' + color + '">' + esc(title) + '</span>' +
      '</div>' +
      '<div class="bp-section-grid">' + content + '</div>' +
    '</div>';
  }

  function _badge(text, color) {
    return '<span class="bp-badge" style="color:' + color + ';background:' + color + '18;border-color:' + color + '33">' + esc(text) + '</span>';
  }

  function _gv(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? null : parseFloat(el.value);
    return el.value;
  }

  // ─── Post-processing (V7.9 fixes) ───
  function _postProcess(data) {
    if (!data) return data;
    var c = data.coupon || {};

    // Cumulative coupon fix: rate > 12% is likely cumulative error
    if (c.rate && c.rate > 12) {
      console.log('[BrochureParser] Cumulative coupon suspect: ' + c.rate + '% — checking...');
      // Try to detect real per-period rate
      if (c.frequency === 'semestriel' && c.rate > 15) {
        var possible = c.rate / 2;
        if (possible >= 2 && possible <= 12) { c.rate = possible; console.log('[BrochureParser] Fixed cumulative → ' + possible + '%/sem'); }
      } else if (c.frequency === 'annuel' && c.rate > 15) {
        // Might be total over maturity
        var yrs = data.maturityYears || 5;
        var possibleAnn = c.rate / yrs;
        if (possibleAnn >= 2 && possibleAnn <= 12) { c.rate = possibleAnn; console.log('[BrochureParser] Fixed cumulative → ' + possibleAnn + '%/an'); }
      }
    }

    // Rate fallback: if no rate but rateIfCalled/rateIfMaturity exist
    if (!c.rate && (c.rateIfCalled || c.rateIfMaturity)) {
      c.rate = c.rateIfMaturity || c.rateIfCalled;
    }

    // Capital garanti false positive fix
    var cp = data.capitalProtection || {};
    if (cp.protected && cp.barrier && cp.barrier < 100) {
      // Has a barrier below 100% → NOT truly capital guaranteed
      cp.protected = false;
      cp.level = null;
      console.log('[BrochureParser] False positive cap garanti: barrier=' + cp.barrier + '%');
    }

    // Callable detection
    var er = data.earlyRedemption || {};
    if (er.type === 'callable' && data.structureType === 'autocall') {
      data.structureType = 'taux_fixe';
      console.log('[BrochureParser] Callable → forced structureType=taux_fixe');
    }

    return data;
  }

  // ─── Build final product object ───
  function _buildProduct() {
    if (!_data) return null;
    return {
      name: _gv('bp-name') || _data.name || '',
      type: _gv('bp-struct') === 'taux_fixe' ? 'taux-fixe' : _gv('bp-struct'),
      structureType: _gv('bp-struct') || 'autocall',
      emitter: _gv('bp-emitter') || '',
      guarantor: _data.guarantor || '',
      guarantorRating: _data.guarantorRating || null,
      underlyings: (_gv('bp-underlyings') || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean),
      underlyingType: _gv('bp-undtype') || 'single-index',
      currency: _gv('bp-currency') || 'EUR',
      maturity: (_gv('bp-years') || 5) + ' ans',
      maturityYears: _gv('bp-years') || 5,
      coupon: {
        rate: _gv('bp-rate'),
        rateIfCalled: _gv('bp-rateIfCalled'),
        rateIfMaturity: _gv('bp-rateIfMaturity'),
        type: _gv('bp-coupontype') || 'conditionnel',
        frequency: _gv('bp-freq') || 'annuel',
        trigger: _gv('bp-barriercoupon') || _gv('bp-coupontrigger'),
        memory: _gv('bp-memory') || false,
        paymentTiming: _gv('bp-timing') || 'periodic'
      },
      participationRate: _gv('bp-participation'),
      capitalProtection: {
        protected: _gv('bp-capprotected') || false,
        level: _gv('bp-capprotected') ? (_gv('bp-caplevel') || 100) : null,
        barrier: _gv('bp-barrier'),
        barrierCoupon: _gv('bp-barriercoupon'),
        barrierType: 'europeenne'
      },
      earlyRedemption: {
        possible: _gv('bp-erpossible') || false,
        type: _gv('bp-ertype') || 'none',
        trigger: _gv('bp-ertrigger'),
        frequency: _gv('bp-erfreq') || 'annuel',
        startSemester: _gv('bp-erstart'),
        stepDown: _gv('bp-stepdown') || false,
        stepDownPct: _gv('bp-stepdownpct')
      },
      decrementPct: _gv('bp-decrement'),
      actualDividendYield: _gv('bp-divyield'),
      mechanism: _gv('bp-mechanism') || '',
      risks: (_gv('bp-risks') || '').split('·').map(function(s) { return s.trim(); }).filter(Boolean),
      summary: _data.summary || '',
      aiParsed: _data,
      sourceFile: _fileName
    };
  }

  // ─── API call ───
  async function _analyzePDF(file) {
    _fileName = file.name;
    _error = '';
    _phase = 'loading';
    _render();

    try {
      // Read file as base64
      var base64 = await new Promise(function(res, rej) {
        var r = new FileReader();
        r.onload = function() { res(r.result.split(',')[1]); };
        r.onerror = function() { rej(new Error('Lecture échouée')); };
        r.readAsDataURL(file);
      });

      // Call Claude via proxy
      var resp = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 3000,
          system: PARSER_PROMPT,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: 'Analyse cette brochure et extrais les données dans le format JSON demandé.' }
            ]
          }]
        })
      });

      var result = await resp.json();
      if (result.error) throw new Error(result.error.message || 'Erreur API');

      var text = (result.content || []).map(function(b) { return b.text || ''; }).join('');
      var clean = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      var parsed = JSON.parse(clean);

      // Normalize
      if (!parsed.coupon) parsed.coupon = {};
      if (!parsed.capitalProtection) parsed.capitalProtection = {};
      if (!parsed.earlyRedemption) parsed.earlyRedemption = {};
      if (!parsed.underlyings) parsed.underlyings = [];
      if (!parsed.risks) parsed.risks = [];
      if (typeof parsed.coupon === 'number') parsed.coupon = { rate: parsed.coupon };

      // Post-process
      _data = _postProcess(parsed);
      _phase = 'review';
      _render();

    } catch(e) {
      console.error('[BrochureParser] Error:', e);
      _error = e.message;
      _phase = 'upload';
      _render();
    }
  }

  // ─── Add to StructBoard ───
  async function _addToStructBoard() {
    if (!_selectedBank) { showToast('Sélectionne une banque', 'error'); return; }
    var product = _buildProduct();
    if (!product) return;

    var amount = parseFloat(_investedAmount) || 0;
    product.investedAmount = amount;

    try {
      // Add as proposal
      var saved = await app.addProposal(_selectedBank, product);
      showToast('✅ ' + (product.name || 'Produit') + ' ajouté !', 'success');

      // Auto-analyze with AI categorization
      if (typeof analyzeProposal === 'function') {
        analyzeProposal(saved).catch(function() {});
      }

      // Open the product sheet
      app.openProduct(saved);

      // Reset parser
      _phase = 'upload';
      _data = null;
      _fileName = '';
      _selectedBank = '';
      _investedAmount = '';
    } catch(e) {
      showToast('Erreur: ' + e.message, 'error');
    }
  }

  // ─── Copy JSON (fallback) ───
  function _copyJSON() {
    var product = _buildProduct();
    var json = JSON.stringify(product, null, 2);
    navigator.clipboard.writeText(json).then(function() {
      showToast('✅ JSON copié — colle dans Modifier infos > Coller JSON', 'success');
    });
  }

  // ─── Render ───
  function _render() {
    var container = document.getElementById('brochure-parser-root');
    if (!container) return;

    if (_phase === 'upload') {
      container.innerHTML = _renderUpload();
      _bindUploadEvents();
    } else if (_phase === 'loading') {
      container.innerHTML = _renderLoading();
    } else if (_phase === 'review') {
      container.innerHTML = _renderReview();
      _bindReviewEvents();
    } else if (_phase === 'bank-select') {
      container.innerHTML = _renderBankSelect();
      _bindBankSelectEvents();
    }
  }

  // ─── Upload screen ───
  function _renderUpload() {
    return '<div class="bp-center">' +
      '<div class="bp-upload-header">' +
        '<div class="bp-upload-title">Analyseur de <span style="color:var(--accent)">Brochure PDF</span></div>' +
        '<div class="bp-upload-sub">Upload → Claude analyse → Tu valides → Ajout direct dans StructBoard</div>' +
      '</div>' +
      '<div class="bp-dropzone" id="bp-dropzone">' +
        '<div style="font-size:36px;margin-bottom:10px;opacity:.5">📄</div>' +
        '<div class="upload-text">Glisse un PDF ici ou clique pour sélectionner</div>' +
        '<div class="upload-sub">Brochure produit structuré (SocGen, Swiss Life, Natixis...)</div>' +
        '<input type="file" accept=".pdf" id="bp-file-input" style="display:none">' +
      '</div>' +
      (_error ? '<div class="bp-error">❌ ' + esc(_error) + '</div>' : '') +
      '<div class="bp-steps-row">' +
        '<div class="bp-step"><div class="bp-step-icon">🔍</div><div class="bp-step-title">Analyse IA</div><div class="bp-step-desc">Claude Sonnet lit le PDF et extrait les données</div></div>' +
        '<div class="bp-step"><div class="bp-step-icon">✏️</div><div class="bp-step-title">Validation</div><div class="bp-step-desc">Tu vérifies et corriges dans un formulaire</div></div>' +
        '<div class="bp-step"><div class="bp-step-icon">🚀</div><div class="bp-step-title">Ajout direct</div><div class="bp-step-desc">Le produit est ajouté à StructBoard en un clic</div></div>' +
      '</div>' +
    '</div>';
  }

  function _bindUploadEvents() {
    var dropzone = document.getElementById('bp-dropzone');
    var fileInput = document.getElementById('bp-file-input');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', function() { fileInput.click(); });
    dropzone.addEventListener('dragover', function(e) { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', function() { dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', function(e) {
      e.preventDefault(); dropzone.classList.remove('dragover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.pdf')) _analyzePDF(file);
      else { _error = 'Fichier PDF requis'; _render(); }
    });
    fileInput.addEventListener('change', function(e) {
      var file = e.target.files && e.target.files[0];
      if (file) _analyzePDF(file);
    });
  }

  // ─── Loading screen ───
  function _renderLoading() {
    return '<div class="bp-center" style="min-height:400px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px">' +
      '<div class="spinner" style="width:36px;height:36px;border-width:3px"></div>' +
      '<div style="font-size:14px;font-weight:600;color:var(--accent)">Analyse de ' + esc(_fileName) + '...</div>' +
      '<div style="font-size:11px;color:var(--text-muted)">Claude lit la brochure et extrait les données (10-20s)</div>' +
    '</div>';
  }

  // ─── Review screen ───
  function _renderReview() {
    if (!_data) return '';
    var d = _data;
    var c = d.coupon || {};
    var cp = d.capitalProtection || {};
    var er = d.earlyRedemption || {};

    // Badges
    var badges = '';
    var sOpt = STRUCT_OPTS.find(function(o) { return o.v === d.structureType; });
    if (sOpt) badges += _badge(sOpt.l, 'var(--accent)');
    if (cp.protected) badges += _badge('Capital garanti', 'var(--green)');
    if (d.decrementPct) badges += _badge('Décrément ' + d.decrementPct + '%', 'var(--red)');
    if (er.stepDown) badges += _badge('Step-down', 'var(--orange)');
    if (er.type === 'callable') badges += _badge('Callable', 'var(--purple)');
    if (c.memory) badges += _badge('Mémoire', 'var(--cyan)');

    var html = '<div class="bp-review">';

    // Header
    html += '<div class="bp-review-header">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">' + esc(_fileName) + '</div>' +
        '<div class="bp-review-name">' + _inp('bp-name', d.name, 'text', 'Nom du produit') + '</div>' +
        '<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">' + badges + '</div>' +
      '</div>' +
      '<div class="bp-review-actions">' +
        '<button class="btn" id="bp-btn-reset">↻ Nouveau</button>' +
        '<button class="btn" id="bp-btn-copy" style="font-size:11px">📋 JSON</button>' +
        '<button class="btn primary" id="bp-btn-add">🚀 Ajouter à StructBoard</button>' +
      '</div>' +
    '</div>';

    // ─ Identité ─
    html += _section('IDENTITÉ', '🏷️', 'var(--accent)',
      _field('Type structure', _sel('bp-struct', d.structureType, STRUCT_OPTS)) +
      _field('Émetteur', _inp('bp-emitter', d.emitter)) +
      _field('Garant', _inp('bp-guarantor', d.guarantor || ''))
    );

    // ─ Sous-jacents ─
    html += _section('SOUS-JACENTS', '📊', 'var(--purple)',
      '<div class="bp-field bp-span2">' +
        '<div class="bp-label">Sous-jacents</div>' +
        _inp('bp-underlyings', (d.underlyings || []).join(', '), 'text', 'Séparés par virgule') +
        '<div class="bp-hint">Séparés par virgule</div>' +
      '</div>' +
      _field('Type', _sel('bp-undtype', d.underlyingType, UND_TYPES)) +
      _field('Devise', _inp('bp-currency', d.currency || 'EUR')) +
      _field('Maturité (ans)', _inp('bp-years', d.maturityYears, 'number')) +
      _field('Décrément (%)', _inp('bp-decrement', d.decrementPct, 'number', '—'), 'Prélèvement forfaitaire')
    );

    // ─ Coupon ─
    html += _section('COUPON', '💰', 'var(--green)',
      _field('Taux (%)', _inp('bp-rate', c.rate, 'number'), 'PAR PÉRIODE — ne pas multiplier') +
      _field('Type', _sel('bp-coupontype', c.type || 'conditionnel', COUPON_TYPES)) +
      _field('Fréquence', _sel('bp-freq', c.frequency || 'annuel', FREQ_OPTS)) +
      _field('Paiement', _sel('bp-timing', c.paymentTiming || 'periodic', ['periodic', 'maturity'])) +
      _field('Si rappelé (%)', _inp('bp-rateIfCalled', c.rateIfCalled, 'number', '—'), 'Double coupon') +
      _field('Si maturité (%)', _inp('bp-rateIfMaturity', c.rateIfMaturity, 'number', '—'), 'Double coupon') +
      _field('Participation (%)', _inp('bp-participation', d.participationRate, 'number', '—')) +
      _field('Trigger coupon (%)', _inp('bp-coupontrigger', c.trigger, 'number', '—')) +
      '<div class="bp-field">' + _tog('bp-memory', c.memory, 'Coupon à mémoire') + '</div>'
    );

    // ─ Protection ─
    html += _section('PROTECTION CAPITAL', '🛡️', 'var(--orange)',
      '<div class="bp-field">' + _tog('bp-capprotected', cp.protected, cp.protected ? 'Capital garanti ✓' : 'Pas de protection ✗') + '</div>' +
      _field('Niveau protection (%)', _inp('bp-caplevel', cp.level, 'number', '100')) +
      _field('Barrière capital (%)', _inp('bp-barrier', cp.barrier, 'number', '50'), 'Seuil perte en capital') +
      _field('Barrière coupon (%)', _inp('bp-barriercoupon', cp.barrierCoupon, 'number', '60'), 'Seuil versement coupon')
    );

    // ─ Early redemption ─
    html += _section('REMBOURSEMENT ANTICIPÉ', '⏰', 'var(--red)',
      '<div class="bp-field">' + _tog('bp-erpossible', er.possible, 'Rappel possible') + '</div>' +
      _field('Type', _sel('bp-ertype', er.type || 'none', ER_TYPES)) +
      _field('Trigger (%)', _inp('bp-ertrigger', er.trigger, 'number', '95')) +
      _field('Fréquence', _sel('bp-erfreq', er.frequency || 'annuel', FREQ_OPTS)) +
      _field('Start (sem.)', _inp('bp-erstart', er.startSemester, 'number', '—'), 'Si pas S1') +
      '<div class="bp-field">' + _tog('bp-stepdown', er.stepDown, 'Step-down dégressif') + '</div>' +
      _field('Step-down (%)', _inp('bp-stepdownpct', er.stepDownPct, 'number', '2.5')) +
      _field('Div réel (%)', _inp('bp-divyield', d.actualDividendYield, 'number', '—'), 'Yield réel vs décrément')
    );

    // ─ Mechanism ─
    html += _section('MÉCANISME & RISQUES', '⚙️', 'var(--text-dim)',
      '<div class="bp-field bp-span-full">' +
        '<div class="bp-label">Description du mécanisme</div>' +
        '<textarea id="bp-mechanism" class="bp-textarea">' + esc(d.mechanism || '') + '</textarea>' +
      '</div>' +
      '<div class="bp-field bp-span-full">' +
        '<div class="bp-label">Risques</div>' +
        _inp('bp-risks', (d.risks || []).join(' · '), 'text', 'Séparés par ·') +
      '</div>'
    );

    html += '</div>';
    return html;
  }

  function _bindReviewEvents() {
    var btnReset = document.getElementById('bp-btn-reset');
    var btnCopy = document.getElementById('bp-btn-copy');
    var btnAdd = document.getElementById('bp-btn-add');

    if (btnReset) btnReset.addEventListener('click', function() {
      _phase = 'upload'; _data = null; _fileName = ''; _error = ''; _render();
    });
    if (btnCopy) btnCopy.addEventListener('click', _copyJSON);
    if (btnAdd) btnAdd.addEventListener('click', function() {
      _phase = 'bank-select'; _render();
    });
  }

  // ─── Bank selection screen ───
  function _renderBankSelect() {
    var productName = _data ? _data.name || _fileName : _fileName;
    var emitter = _data ? _data.emitter || '' : '';

    // Try to auto-detect bank from emitter
    var autoBank = '';
    if (emitter) {
      var emLower = emitter.toLowerCase();
      BANKS_LIST.forEach(function(b) {
        if (emLower.indexOf(b.name.toLowerCase()) >= 0 || emLower.indexOf(b.id) >= 0) autoBank = b.id;
      });
    }
    if (autoBank && !_selectedBank) _selectedBank = autoBank;

    var html = '<div class="bp-center" style="max-width:560px">';
    html += '<div style="text-align:center;margin-bottom:24px">' +
      '<div style="font-size:16px;font-weight:700;color:var(--text-bright);margin-bottom:6px">Ajouter à StructBoard</div>' +
      '<div style="font-size:12px;color:var(--text-muted)">' + esc(productName) + '</div>' +
    '</div>';

    // Bank grid
    html += '<div style="margin-bottom:20px">' +
      '<div class="bp-label" style="margin-bottom:8px">Banque source</div>' +
      '<div class="bank-select-grid">';

    BANKS_LIST.forEach(function(b) {
      var sel = _selectedBank === b.id;
      html += '<button class="bank-select-btn' + (sel ? ' selected' : '') + '" data-bank="' + b.id + '" ' +
        'style="--bank-color:' + b.color + ';' + (sel ? 'border-color:' + b.color + ';background:' + b.color + '12' : '') + '">' +
        '<span class="bank-select-dot" style="background:' + b.color + '"></span>' +
        esc(b.name) +
      '</button>';
    });

    html += '</div></div>';

    // Amount
    html += '<div class="bp-field" style="margin-bottom:24px">' +
      '<div class="bp-label">Montant investi (€) — optionnel</div>' +
      '<input type="number" id="bp-amount" class="bp-input" value="' + esc(_investedAmount) + '" placeholder="Ex: 10000">' +
    '</div>';

    // Actions
    html += '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn" id="bp-bank-back">← Retour</button>' +
      '<button class="btn primary" id="bp-bank-confirm"' + (!_selectedBank ? ' disabled' : '') + '>✅ Confirmer et ajouter</button>' +
    '</div>';

    html += '</div>';
    return html;
  }

  function _bindBankSelectEvents() {
    // Bank buttons
    document.querySelectorAll('.bank-select-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _selectedBank = btn.dataset.bank;
        _render();
      });
    });

    var amountInput = document.getElementById('bp-amount');
    if (amountInput) {
      amountInput.addEventListener('input', function() { _investedAmount = amountInput.value; });
    }

    var btnBack = document.getElementById('bp-bank-back');
    if (btnBack) btnBack.addEventListener('click', function() { _phase = 'review'; _render(); });

    var btnConfirm = document.getElementById('bp-bank-confirm');
    if (btnConfirm) btnConfirm.addEventListener('click', _addToStructBoard);
  }

  // ─── Global render function (called by switchMainView) ───
  window.renderBrochureParser = function(container) {
    container.innerHTML = '<div class="main" id="brochure-parser-root"></div>';
    _render();
  };

  // ─── CSS (injected once) ───
  var style = document.createElement('style');
  style.textContent = [
    '.bp-center { max-width: 640px; margin: 0 auto; }',
    '.bp-upload-header { text-align: center; margin-bottom: 32px; }',
    '.bp-upload-title { font-size: 24px; font-weight: 800; color: var(--text-bright); line-height: 1.3; }',
    '.bp-upload-sub { font-size: 12px; color: var(--text-muted); margin-top: 8px; }',
    '.bp-dropzone { border: 2px dashed var(--border); border-radius: var(--radius-lg); padding: 48px 24px; text-align: center; cursor: pointer; transition: all .2s; background: var(--bg-card); }',
    '.bp-dropzone:hover, .bp-dropzone.dragover { border-color: var(--accent); background: var(--accent-glow); }',
    '.bp-error { margin-top: 12px; padding: 10px 14px; background: var(--red-dim); border: 1px solid rgba(248,113,113,.25); border-radius: var(--radius-sm); color: var(--red); font-size: 12px; }',
    '.bp-steps-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 32px; }',
    '.bp-step { padding: 14px; background: var(--bg-card); border-radius: var(--radius); border: 1px solid var(--border); }',
    '.bp-step-icon { font-size: 20px; margin-bottom: 6px; }',
    '.bp-step-title { font-size: 11px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; }',
    '.bp-step-desc { font-size: 10px; color: var(--text-muted); line-height: 1.4; }',
    '',
    '.bp-review { }',
    '.bp-review-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border); gap: 12px; flex-wrap: wrap; }',
    '.bp-review-name input { font-size: 15px; font-weight: 700; width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--text-bright); padding: 2px 0; font-family: var(--font); outline: none; }',
    '.bp-review-name input:focus { border-color: var(--accent); }',
    '.bp-review-actions { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }',
    '',
    '.bp-section { margin-bottom: 18px; }',
    '.bp-section-header { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; border-bottom: 2px solid; padding-bottom: 5px; font-size: 12px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; }',
    '.bp-section-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; }',
    '.bp-span2 { grid-column: span 2; }',
    '.bp-span-full { grid-column: 1 / -1; }',
    '',
    '.bp-field { }',
    '.bp-label { font-size: 10px; font-weight: 700; color: var(--text-muted); margin-bottom: 3px; text-transform: uppercase; letter-spacing: .5px; }',
    '.bp-hint { font-size: 9px; color: var(--text-dim); margin-top: 2px; }',
    '',
    '.bp-input, .bp-select { width: 100%; padding: 7px 10px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); font-size: 12px; font-family: var(--font); outline: none; box-sizing: border-box; transition: border-color .2s; }',
    '.bp-input:focus, .bp-select:focus { border-color: var(--border-focus); }',
    '.bp-select { cursor: pointer; }',
    '.bp-select option { background: var(--bg-card); color: var(--text); }',
    '.bp-textarea { width: 100%; min-height: 50px; padding: 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); font-size: 11px; font-family: var(--font); resize: vertical; outline: none; box-sizing: border-box; }',
    '.bp-textarea:focus { border-color: var(--border-focus); }',
    '',
    '.bp-toggle { display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: 12px; color: var(--text); }',
    '.bp-toggle input { display: none; }',
    '.bp-toggle-track { width: 32px; height: 18px; border-radius: 9px; background: var(--border); position: relative; transition: .2s; flex-shrink: 0; }',
    '.bp-toggle input:checked + .bp-toggle-track { background: var(--green); }',
    '.bp-toggle-thumb { width: 14px; height: 14px; border-radius: 50%; background: #fff; position: absolute; top: 2px; left: 2px; transition: .2s; }',
    '.bp-toggle input:checked + .bp-toggle-track .bp-toggle-thumb { left: 16px; }',
    '',
    '.bp-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; border: 1px solid; margin-right: 4px; }',
    '',
    '.bank-select-btn.selected { font-weight: 700; }',
    '',
    '@media (max-width: 768px) {',
    '  .bp-section-grid { grid-template-columns: 1fr 1fr; }',
    '  .bp-steps-row { grid-template-columns: 1fr; }',
    '  .bp-review-header { flex-direction: column; }',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  console.log('[StructBoard] Brochure Parser v1.0 loaded');
})();

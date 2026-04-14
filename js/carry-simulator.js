// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Carry Trade Simulator v3.0
// Multi-produit, allocation split, scénarios comparés, P&L détaillé
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _state = {
    amount: 1000000,
    rate: 2.90,
    years: 5,
    taxRate: 25,
    loanType: 'both', // 'inFine', 'amortissable', 'both'
    loanFees: 1000,
    monthlyPayment: 17924.29, // SG real amortization schedule
    totalInterestAmort: 75457, // SG real total interest (amortissable)
    products: [],
    result: null
  };

  function _fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }
  function _pct(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  // ─── Catalogue produits (conditions marché avril 2026) ──────
  // TEC10 = 3.10% | OAT 5Y = 2.70% | BCE = 2.15% | Euribor 3M ~2.50%
  // Courbe 2s10s = +57bp (normale) | Vol TEC10 = 18bp/an
  var CATALOG = {
    conservative: [
      {
        id: 'cat_floater', name: 'Floater TEC10 Plancher 3%', type: 'hybride',
        coupon: 3.80, couponPlancher: 3.00, couponBonus: 0.80,
        duration: 5, capitalGaranti: true,
        condition: 'Coupon = 3% + max(0, TEC10 − 2.20%)', conditionProb: 0.95,
        color: '#0D9488',
        risk: 'Très faible — plancher 3% garanti, variable capte la hausse des taux',
        detail: 'Si TEC10 monte à 4% → coupon 4.80%. Si TEC10 baisse à 2% → coupon 3%. Aujourd\'hui TEC10=3.10% → coupon ~3.90%.',
        category: 'conservative', amount: 0
      },
      {
        id: 'cat_hybride', name: 'Hybride Plancher 3% + Digital TEC10', type: 'hybride',
        coupon: 6.50, couponPlancher: 3.00, couponBonus: 3.50,
        duration: 5, capitalGaranti: true,
        condition: 'Plancher 3% + bonus 3.50% si TEC10 ≤ 4.50%', conditionProb: 0.90,
        color: '#0891B2',
        risk: 'Faible — plancher couvre l\'emprunt, trigger large (TEC10 < 4.50% = 140bp de marge)',
        detail: 'Combinaison sécurité + rendement. Le plancher 3% couvre le 2.90% de l\'emprunt. Le bonus 3.50% se déclenche si TEC10 reste sous 4.50% (très probable sur 5 ans).',
        category: 'conservative', amount: 0
      },
      {
        id: 'cat_fixe', name: 'Taux Fixe Callable 5Y', type: 'fixe',
        coupon: 5.10, duration: 5, capitalGaranti: true,
        condition: null, conditionProb: 1.0,
        color: '#059669',
        risk: 'Aucun — coupon 100% garanti. Callable émetteur an 1',
        detail: 'Le coffre-fort. Coupon garanti chaque année. La banque peut rappeler le produit si les taux baissent (vous récupérez le capital + dernier coupon).',
        category: 'conservative', amount: 0
      }
    ],
    aggressive: [
      {
        id: 'cat_tarn', name: 'TARN TEC10 8%', type: 'conditionnel',
        coupon: 8.00, duration: 5, capitalGaranti: true,
        condition: 'TEC10 ≤ 4.40% (An 1 garanti)', conditionProb: 0.78,
        guaranteedYears: 1,
        color: '#D97706',
        risk: 'Modéré — coupon 0% si TEC10 > 4.40%. An 1 garanti. Autocall si cumul ≥ 24%',
        detail: 'Rendement max du catalogue. An 1 garanti = 8%. Ensuite conditionnel. Si TEC10 reste stable (~3.10%), vous touchez 8%/an. Risque : TEC10 dépasse 4.40% = 0%.',
        category: 'aggressive', amount: 0
      },
      {
        id: 'cat_range', name: 'Range Accrual Euribor 7.5%', type: 'conditionnel',
        coupon: 7.50, duration: 5, capitalGaranti: true,
        condition: 'Euribor 3M dans [1.50% – 3.80%]', conditionProb: 0.85,
        color: '#DC2626',
        risk: 'Modéré — coupon accrues par jour dans le corridor. Euribor actuel 2.50% = bien centré',
        detail: 'Coupon = 7.50% × (nb jours Euribor dans le corridor / nb jours total). Euribor à 2.50% = bien centré dans [1.50%-3.80%]. Risque si BCE monte fortement (>3.80%) ou baisse (<1.50%).',
        category: 'aggressive', amount: 0
      },
      {
        id: 'cat_digital', name: 'Digital Mémoire TEC10 7%', type: 'conditionnel',
        coupon: 7.00, duration: 5, capitalGaranti: true,
        condition: 'TEC10 ≤ 4.50% + effet mémoire', conditionProb: 0.88,
        guaranteedYears: 0,
        color: '#7C3AED',
        risk: 'Modéré-faible — mémoire rattrape les coupons manqués. Trigger 4.50% = large',
        detail: 'Si TEC10 ≤ 4.50% → coupon 7%. Si TEC10 > 4.50% un an → coupon stocké en mémoire et versé l\'année suivante si condition remplie. Filet de sécurité vs le TARN.',
        category: 'aggressive', amount: 0
      }
    ]
  };

  function _recommendedProducts() {
    return CATALOG.conservative.concat(CATALOG.aggressive);
  }

  // ─── Revenue calculations ──────────────────────────────────
  function _productRevenue(product, year, scenario) {
    // scenario: 'expected', 'worst', 'best'
    var catFallback = 2.80 / 100;
    var amt = product.amount;
    if (!amt || amt <= 0) return 0;

    if (product.duration && year > product.duration) {
      return Math.round(amt * catFallback);
    }

    if (product.type === 'fixe') {
      return Math.round(amt * product.coupon / 100);
    }

    if (product.type === 'hybride') {
      var floor = Math.round(amt * product.couponPlancher / 100);
      if (scenario === 'worst') return floor;
      if (scenario === 'best') return Math.round(amt * (product.couponPlancher + product.couponBonus) / 100);
      // expected
      var bonus = Math.round(amt * product.couponBonus / 100 * (product.conditionProb || 0.68));
      return floor + bonus;
    }

    // conditionnel (TARN etc.)
    var guaranteedYears = product.guaranteedYears || 0;
    if (scenario === 'worst') {
      if (year <= guaranteedYears) return Math.round(amt * product.coupon / 100);
      return 0;
    }
    if (scenario === 'best') {
      return Math.round(amt * product.coupon / 100);
    }
    // expected
    if (year <= guaranteedYears) return Math.round(amt * product.coupon / 100);
    return Math.round(amt * product.coupon / 100 * (product.conditionProb || 0.68));
  }

  // ─── Portfolio cash flow (combined) ────────────────────────
  function _computePortfolio(products, loanAmount, loanRate, years, taxRate, loanType, scenario) {
    var flows = [];
    var capitalRemaining = loanAmount;
    var annualRate = loanRate / 100;
    var totalRevenue = 0, totalInterest = 0, totalTax = 0;
    var cumulNet = 0;

    for (var yr = 1; yr <= years; yr++) {
      var interest = Math.round(capitalRemaining * annualRate);
      var capitalPayment = 0;
      if (loanType === 'amortissable') {
        var annuity = Math.round(loanAmount * annualRate / (1 - Math.pow(1 + annualRate, -years)));
        capitalPayment = annuity - interest;
        if (yr === years) capitalPayment = capitalRemaining;
      } else {
        if (yr === years) capitalPayment = loanAmount;
      }

      var revenueByProduct = [];
      var totalYearRevenue = 0;
      products.forEach(function(p) {
        var rev = _productRevenue(p, yr, scenario);
        if (loanType === 'amortissable' && capitalRemaining < loanAmount) {
          rev = Math.round(rev * (capitalRemaining / loanAmount));
        }
        revenueByProduct.push({ name: p.name, revenue: rev, color: p.color, amount: p.amount });
        totalYearRevenue += rev;
      });

      var netBeforeTax = totalYearRevenue - interest;
      var tax = netBeforeTax > 0 ? Math.round(netBeforeTax * taxRate / 100) : 0;
      var netAfterTax = netBeforeTax - tax;
      cumulNet += netAfterTax;
      capitalRemaining = Math.max(0, capitalRemaining - capitalPayment);

      flows.push({
        year: yr, revenueByProduct: revenueByProduct,
        totalRevenue: totalYearRevenue, interest: interest,
        netBeforeTax: netBeforeTax, tax: tax,
        netAfterTax: netAfterTax, cumulNet: cumulNet,
        capitalRemaining: capitalRemaining
      });
      totalRevenue += totalYearRevenue;
      totalInterest += interest;
      totalTax += tax;
    }

    return {
      flows: flows, totalRevenue: totalRevenue, totalInterest: totalInterest,
      totalNet: totalRevenue - totalInterest, totalTax: totalTax,
      totalNetAfterTax: totalRevenue - totalInterest - totalTax,
      avgPerYear: Math.round((totalRevenue - totalInterest - totalTax) / years)
    };
  }

  // ─── Generate allocation scenarios ─────────────────────────
  function _generateScenarios(products, loanAmount) {
    if (products.length === 0) return [];
    var scenarios = [];

    // User's current allocation
    scenarios.push({
      name: '⭐ Mon allocation actuelle',
      products: products.map(function(p) { return Object.assign({}, p); }),
      isUser: true
    });

    // 100% on each product
    products.forEach(function(p) {
      var prods = [Object.assign({}, p, { amount: loanAmount })];
      scenarios.push({ name: '100% ' + p.name, products: prods });
    });

    // Splits for 2 products
    if (products.length === 2) {
      var a = products[0], b = products[1];
      [[700000,300000,'70/30'],[600000,400000,'60/40'],[500000,500000,'50/50'],[400000,600000,'40/60'],[300000,700000,'30/70']].forEach(function(s) {
        scenarios.push({
          name: s[2] + ' ' + a.name.substring(0,20) + ' / ' + b.name.substring(0,20),
          products: [Object.assign({}, a, {amount:s[0]}), Object.assign({}, b, {amount:s[1]})]
        });
      });
    }

    // Splits for 3 products
    if (products.length === 3) {
      var pa = products[0], pb = products[1], pc = products[2];
      [[500000,500000,0],[500000,0,500000],[0,500000,500000],[400000,300000,300000],[300000,400000,300000],[300000,300000,400000],[500000,250000,250000],[250000,500000,250000],[250000,250000,500000]].forEach(function(s) {
        var label = (s[0]/10000) + '/' + (s[1]/10000) + '/' + (s[2]/10000);
        var prods = [];
        if (s[0] > 0) prods.push(Object.assign({}, pa, {amount:s[0]}));
        if (s[1] > 0) prods.push(Object.assign({}, pb, {amount:s[1]}));
        if (s[2] > 0) prods.push(Object.assign({}, pc, {amount:s[2]}));
        scenarios.push({ name: label, products: prods });
      });
    }

    return scenarios;
  }

  // ─── Parse JSON from banker ────────────────────────────────
  function _parseJSON(json) {
    try {
      var d = typeof json === 'string' ? JSON.parse(json) : json;
      var coupon = d.coupon ? (typeof d.coupon === 'object' ? parseFloat(d.coupon.rate) || 0 : parseFloat(d.coupon) || 0) : 0;
      var type = 'conditionnel';
      if (d.coupon && (d.coupon.type === 'fixe' || d.coupon.type === 'garanti')) type = 'fixe';
      if (d.structureType === 'taux_fixe') type = 'fixe';
      return {
        id: 'custom_' + Date.now(), name: d.name || 'Produit banquier', type: type,
        coupon: coupon, duration: parseFloat(d.maturityYears) || 5,
        capitalGaranti: d.capitalProtection && d.capitalProtection.protected,
        condition: d.coupon && d.coupon.triggerDetail || null,
        conditionProb: type === 'fixe' ? 1.0 : 0.68,
        color: '#3B82F6', risk: type === 'fixe' ? 'Coupon garanti' : 'Coupon conditionnel — prob ~68%',
        source: 'import JSON', amount: 0
      };
    } catch(e) { return null; }
  }

  // ─── Auto-equalize amounts ─────────────────────────────────
  function _equalizeAmounts() {
    var n = _state.products.length;
    if (n === 0) return;
    var each = Math.floor(_state.amount / n / 50000) * 50000; // round to 50K
    var remainder = _state.amount - each * n;
    _state.products.forEach(function(p, i) {
      p.amount = each + (i === 0 ? remainder : 0);
    });
  }

  function _totalAllocated() {
    return _state.products.reduce(function(s, p) { return s + (p.amount || 0); }, 0);
  }

  // ─── Theme: LIGHT mode for carry trade page ─────────
  var BG = {
    wrap: '#F8F9FB',       // wrapper — near white
    section: '#FFFFFF',    // section cards — pure white
    input: '#F1F3F7',      // input fields — light grey
    row0: '#FFFFFF',       // table even rows — white
    row1: '#F4F6F9',       // table odd rows — light grey
    header: '#E8ECF2',     // table headers — medium grey
    border: '#D1D9E6',     // borders — visible grey
    highlight: '#E8F0FE',  // highlighted rows — light blue
    text: '#1A202C',       // dark text
    textMuted: '#64748B',  // muted text
    textDim: '#94A3B8'     // dim text
  };

  // ─── Light wrapper style override ─────────
  var WRAP_STYLE = 'background:' + BG.wrap + ';border-radius:12px;padding:20px;color:' + BG.text + ';--text-bright:' + BG.text + ';--text:' + BG.text + ';--text-muted:' + BG.textMuted + ';--text-dim:' + BG.textDim + ';--border:' + BG.border + ';--bg:' + BG.input + ';--bg-elevated:' + BG.section + ';--bg-card:' + BG.section;

  // ═══ RENDER — FORM ═════════════════════════════════════════
  function _renderForm(container) {
    var html = '<div class="section" style="' + WRAP_STYLE + '">';
    html += '<div class="section-header" style="border-color:' + BG.border + '"><div class="section-title" style="color:' + BG.text + '"><span class="dot" style="background:#2563EB"></span>🏦 Simulateur Carry Trade — Prêt SG Equipéa</div></div>';

    // ─── Loan params ──────
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:#2563EB;margin-bottom:12px">💰 EMPRUNT DE TRÉSORERIE</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px">';
    html += '<div><label style="font-size:10px;color:' + BG.textMuted + ';display:block;margin-bottom:4px">Montant (€)</label>';
    html += '<input type="number" id="carry-amount" value="' + _state.amount + '" step="100000" style="width:100%;padding:10px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-family:var(--mono);font-size:15px"></div>';
    html += '<div><label style="font-size:10px;color:' + BG.textMuted + ';display:block;margin-bottom:4px">Taux fixe (%)</label>';
    html += '<input type="number" id="carry-rate" value="' + _state.rate + '" step="0.1" style="width:100%;padding:10px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-family:var(--mono);font-size:15px"></div>';
    html += '<div><label style="font-size:10px;color:' + BG.textMuted + ';display:block;margin-bottom:4px">Durée (ans)</label>';
    html += '<input type="number" id="carry-years" value="' + _state.years + '" min="1" max="30" style="width:100%;padding:10px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-family:var(--mono);font-size:15px"></div>';
    html += '<div><label style="font-size:10px;color:' + BG.textMuted + ';display:block;margin-bottom:4px">Type emprunt</label>';
    html += '<select id="carry-loantype" style="width:100%;padding:10px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-size:13px">';
    html += '<option value="both"' + (_state.loanType === 'both' ? ' selected' : '') + '>In Fine + Amort. (comparer)</option>';
    html += '<option value="inFine"' + (_state.loanType === 'inFine' ? ' selected' : '') + '>In Fine uniquement</option>';
    html += '<option value="amortissable"' + (_state.loanType === 'amortissable' ? ' selected' : '') + '>Amortissable uniquement</option>';
    html += '</select></div>';
    html += '</div>';
    var annualCostIF = Math.round(_state.amount * _state.rate / 100);
    var totalCostIF = annualCostIF * _state.years;
    var totalCostAmort = _state.totalInterestAmort;
    html += '<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    html += '<div style="padding:8px 12px;background:rgba(34,211,238,0.12);border:2px solid rgba(34,211,238,0.3);border-radius:6px;font-size:11px;color:#0891B2">';
    html += '✅ <strong>IN FINE (RECOMMANDÉ)</strong> : -' + _fmt(annualCostIF) + '€/an intérêts seuls · Total : <strong>-' + _fmt(totalCostIF) + '€</strong> · Capital 1M€ constant → carry max</div>';
    html += '<div style="padding:8px 12px;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:6px;font-size:11px;color:#A855F7">';
    html += 'AMORTISSABLE : -' + _fmt(_state.monthlyPayment) + '€/mois · Total intérêts : <strong>-' + _fmt(totalCostAmort) + '€</strong> · Capital décroissant → carry ÷2</div>';
    html += '</div>';
    html += '<div style="margin-top:6px;padding:8px 12px;background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:6px;font-size:10px;color:#059669">✅ Prêt Equipéa SG — <strong>In fine ou amortissable au choix</strong> · 2,90% fixe de 2 à 5 ans · Jusqu\'à 1M€ · Frais : ' + _fmt(_state.loanFees) + '€ · <strong>Aucune garantie</strong> (crédit en blanc) · Entité : Caméleons Com Mark · Valide jusqu\'au 14/05/2026</div>';
    html += '</div>';

    // ─── Costs breakdown ──────
    var costIF = Math.round(_state.amount * _state.rate / 100) * _state.years;
    var costAmort = _state.totalInterestAmort;
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:#DC2626;margin-bottom:10px">💰 COÛTS DE L\'OPÉRATION</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;color:' + BG.text + '">';
    html += '<thead><tr style="border-bottom:2px solid ' + BG.border + '">';
    html += '<th style="padding:8px;text-align:left;color:' + BG.textMuted + ';font-size:10px">Poste</th>';
    html += '<th style="padding:8px;text-align:right;color:#0891B2;font-size:10px">In Fine</th>';
    html += '<th style="padding:8px;text-align:right;color:#7C3AED;font-size:10px">Amortissable</th>';
    html += '</tr></thead><tbody>';
    // Rows
    [
      ['Intérêts totaux sur ' + _state.years + ' ans', '-' + _fmt(costIF) + '€', '-' + _fmt(costAmort) + '€'],
      ['Frais de dossier', '-' + _fmt(_state.loanFees) + '€', '-' + _fmt(_state.loanFees) + '€'],
      ['Échéance mensuelle', '-' + _fmt(Math.round(_state.amount * _state.rate / 100 / 12)) + '€ (intérêts)', '-' + _fmt(_state.monthlyPayment) + '€ (capital+intérêts)'],
      ['Capital investi moyen', _fmt(_state.amount) + '€ (constant)', '~' + _fmt(Math.round(_state.amount / 2)) + '€ (décroissant)'],
      ['Remboursement anticipé', 'Soulte swap (coûteuse)', 'Soulte swap ou 3% CRD après 30 mois'],
      ['Garanties', 'Aucune (crédit en blanc)', 'Aucune (crédit en blanc)']
    ].forEach(function(row, i) {
      var bg = i % 2 === 0 ? BG.row0 : BG.row1;
      html += '<tr style="background:' + bg + ';border-bottom:1px solid ' + BG.border + '">';
      html += '<td style="padding:6px 8px;font-weight:600;color:' + BG.text + '">' + row[0] + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#0891B2">' + row[1] + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#7C3AED">' + row[2] + '</td>';
      html += '</tr>';
    });
    // Total row
    html += '<tr style="border-top:2px solid ' + BG.border + ';background:' + BG.header + ';font-weight:700">';
    html += '<td style="padding:8px">COÛT TOTAL</td>';
    html += '<td style="padding:8px;text-align:right;font-family:var(--mono);color:#DC2626;font-size:13px">-' + _fmt(costIF + _state.loanFees) + '€</td>';
    html += '<td style="padding:8px;text-align:right;font-family:var(--mono);color:#DC2626;font-size:13px">-' + _fmt(costAmort + _state.loanFees) + '€</td>';
    html += '</tr>';
    html += '</tbody></table>';
    html += '<div style="margin-top:8px;padding:6px 10px;background:#DBEAFE;border-radius:4px;font-size:10px;color:#1E40AF">💡 <strong>In fine = intérêts ×2 mais capital investi constant → revenus ×2 → gain net supérieur.</strong> Économie d\'intérêts de l\'amortissable ne compense pas la perte de revenus.</div>';
    html += '</div>';

    // ─── Product catalog ──────
    function _renderCatalogSection(title, icon, borderColor, products) {
      html += '<div style="background:' + BG.section + ';border:1px solid ' + borderColor + ';border-radius:8px;padding:16px;margin-bottom:12px">';
      html += '<div style="font-size:12px;font-weight:700;color:' + BG.text + ';margin-bottom:10px">' + icon + ' ' + title + '</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
      products.forEach(function(p) {
        var exists = _state.products.some(function(ep) { return ep.id === p.id; });
        var typeLabel = p.type === 'fixe' ? '🛡️ Fixe garanti' : p.type === 'hybride' ? '⚖️ Plancher + variable' : '🎯 Conditionnel';
        var expectedRate = p.type === 'fixe' ? p.coupon : p.type === 'hybride' ? (p.couponPlancher + p.couponBonus * (p.conditionProb || 0.68)) : (p.coupon * (p.conditionProb || 0.68));
        var spread = expectedRate - _state.rate;
        html += '<button onclick="' + (exists ? '' : '_carryAddRecommended(\'' + p.id + '\')') + '" style="padding:14px;border-radius:8px;border:2px solid ' + (exists ? p.color : p.color + '44') + ';background:' + (exists ? p.color + '12' : BG.row1) + ';cursor:' + (exists ? 'default' : 'pointer') + ';text-align:left;transition:all 0.2s">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center">';
        html += '<div style="font-size:12px;font-weight:700;color:' + p.color + '">' + p.name + '</div>';
        html += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:' + p.color + '">' + p.coupon + '%</div>';
        html += '</div>';
        html += '<div style="font-size:10px;color:' + BG.textMuted + ';margin-top:4px">' + typeLabel + ' · ' + p.duration + ' ans · Capital garanti 100%</div>';
        if (p.type === 'hybride') html += '<div style="font-size:10px;color:#059669;margin-top:3px;font-weight:600">Plancher ' + p.couponPlancher + '% garanti + bonus ' + p.couponBonus + '%</div>';
        if (p.condition) html += '<div style="font-size:9px;color:#D97706;margin-top:3px">' + p.condition + '</div>';
        html += '<div style="font-size:9px;color:' + BG.textDim + ';margin-top:4px;line-height:1.4">' + (p.detail || p.risk) + '</div>';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid ' + BG.border + '">';
        html += '<span style="font-size:9px;color:' + BG.textDim + '">Spread net espéré</span>';
        html += '<span style="font-family:var(--mono);font-size:11px;font-weight:700;color:' + (spread > 0 ? '#059669' : '#DC2626') + '">+' + _pct(spread) + '%</span>';
        html += '</div>';
        if (exists) html += '<div style="font-size:10px;color:' + p.color + ';margin-top:4px;font-weight:600">✓ Ajouté au comparateur</div>';
        html += '</button>';
      });
      html += '</div></div>';
    }

    html += '<div style="font-size:13px;font-weight:700;color:' + BG.text + ';margin-bottom:8px">📦 CATALOGUE PRODUITS — Marché avril 2026</div>';
    html += '<div style="font-size:10px;color:' + BG.textMuted + ';margin-bottom:12px">TEC10 = 3.10% · OAT 5Y = 2.70% · BCE = 2.15% · Euribor 3M ≈ 2.50% · Courbe normale. Cliquez pour ajouter au comparateur.</div>';
    _renderCatalogSection('SÉCURISÉS — Plancher garanti, carry couvert', '🛡️', '#86EFAC', CATALOG.conservative);
    _renderCatalogSection('DYNAMIQUES — Rendement élevé, plus de volatilité', '🚀', '#FDE68A', CATALOG.aggressive);

    // ─── Import JSON ──────
    html += '<div style="background:' + BG.section + ';border:1px solid rgba(59,130,246,0.3);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:#2563EB;margin-bottom:8px">📋 IMPORTER UN PRODUIT (JSON)</div>';
    html += '<textarea id="carry-json" placeholder=\'{"name":"Hybride TEC10","coupon":{"rate":5.5,"type":"conditionnel"},"maturityYears":5,"capitalProtection":{"protected":true}}\' style="width:100%;height:60px;padding:8px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-family:monospace;font-size:11px;resize:vertical;box-sizing:border-box"></textarea>';
    html += '<button class="btn" onclick="_carryImportJSON()" style="margin-top:8px;font-size:11px;padding:6px 14px;background:rgba(59,130,246,0.1);border-color:rgba(59,130,246,0.3);color:#2563EB">📥 Importer</button>';
    html += '</div>';

    // ─── Manual add ──────
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:' + BG.textMuted + ';margin-bottom:8px">✏️ AJOUTER MANUELLEMENT</div>';
    html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">';
    html += '<div><label style="font-size:9px;color:' + BG.textDim + '">Nom</label><input id="carry-pname" placeholder="Ex: Hybride CIC" style="width:100%;padding:6px;border:1px solid ' + BG.border + ';border-radius:4px;background:' + BG.input + ';color:' + BG.text + ';font-size:11px"></div>';
    html += '<div><label style="font-size:9px;color:' + BG.textDim + '">Type</label><select id="carry-ptype" style="width:100%;padding:6px;border:1px solid ' + BG.border + ';border-radius:4px;background:' + BG.input + ';color:' + BG.text + ';font-size:11px"><option value="fixe">Fixe garanti</option><option value="conditionnel">Conditionnel</option><option value="hybride">Hybride</option></select></div>';
    html += '<div><label style="font-size:9px;color:' + BG.textDim + '">Coupon (%)</label><input id="carry-pcoupon" type="number" step="0.1" placeholder="5.0" style="width:100%;padding:6px;border:1px solid ' + BG.border + ';border-radius:4px;background:' + BG.input + ';color:' + BG.text + ';font-size:11px;font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:9px;color:' + BG.textDim + '">Durée (ans)</label><input id="carry-pduration" type="number" value="5" min="1" max="30" style="width:100%;padding:6px;border:1px solid ' + BG.border + ';border-radius:4px;background:' + BG.input + ';color:' + BG.text + ';font-size:11px;font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:9px;color:' + BG.textDim + '">Plancher (hybride)</label><input id="carry-pfloor" type="number" step="0.1" placeholder="3.0" style="width:100%;padding:6px;border:1px solid ' + BG.border + ';border-radius:4px;background:' + BG.input + ';color:' + BG.text + ';font-size:11px;font-family:var(--mono)"></div>';
    html += '</div>';
    html += '<button class="btn" onclick="_carryAddManual()" style="font-size:11px;padding:6px 14px;background:rgba(6,214,160,0.1);border-color:rgba(6,214,160,0.3);color:#059669">+ Ajouter</button>';
    html += '</div>';

    // ─── Products + Allocation ──────
    var allProducts = _state.products;
    var totalAlloc = _totalAllocated();
    var remaining = _state.amount - totalAlloc;
    var allocOK = Math.abs(remaining) < 1;

    html += '<div style="background:' + BG.section + ';border:1px solid ' + (allocOK ? '#059669' : '#D97706') + '44;border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html += '<div style="font-size:12px;font-weight:700;color:' + BG.text + '">📦 MES PRODUITS & ALLOCATION (' + allProducts.length + ')</div>';
    if (allProducts.length > 1) html += '<button class="btn sm" onclick="_carryEqualize()" style="font-size:10px;padding:4px 10px">⚖️ Répartir également</button>';
    html += '</div>';

    // Allocation bar
    if (allProducts.length > 0) {
      html += '<div style="margin-bottom:12px">';
      html += '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:' + BG.input + '">';
      allProducts.forEach(function(p) {
        var pct = _state.amount > 0 ? (p.amount / _state.amount * 100) : 0;
        if (pct > 0) html += '<div style="width:' + pct + '%;background:' + (p.color || '#888') + ';transition:width 0.3s" title="' + p.name + ': ' + _fmt(p.amount) + '€"></div>';
      });
      if (remaining > 0) html += '<div style="width:' + (remaining / _state.amount * 100) + '%;background:var(--border)" title="Non alloué: ' + _fmt(remaining) + '€"></div>';
      html += '</div>';
      html += '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px">';
      html += '<span style="color:' + BG.textDim + '">Alloué : <strong style="color:' + BG.text + '">' + _fmt(totalAlloc) + '€</strong> / ' + _fmt(_state.amount) + '€</span>';
      if (!allocOK) html += '<span style="color:#D97706">Restant : ' + _fmt(remaining) + '€</span>';
      else html += '<span style="color:#059669">✓ 100% alloué</span>';
      html += '</div></div>';
    }

    if (allProducts.length === 0) {
      html += '<div style="text-align:center;padding:20px;color:' + BG.textDim + ';font-size:11px">Aucun produit. Ajoutez des produits recommandés ci-dessus ou créez les vôtres.</div>';
    } else {
      allProducts.forEach(function(p, idx) {
        var typeLabel = p.type === 'fixe' ? '🛡️ Fixe' : p.type === 'hybride' ? '⚖️ Hybride' : '🎯 Conditionnel';
        var pctAlloc = _state.amount > 0 ? Math.round(p.amount / _state.amount * 100) : 0;
        html += '<div style="padding:12px;border-radius:8px;border:1px solid ' + (p.color || '#888') + '33;background:' + (p.color || '#888') + '06;margin-bottom:8px;position:relative">';
        html += '<button onclick="_carryRemoveProduct(' + idx + ')" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#DC2626;cursor:pointer;font-size:14px" title="Supprimer">✕</button>';
        html += '<div style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center">';

        // Left: product info
        html += '<div>';
        html += '<div style="font-size:13px;font-weight:700;color:' + (p.color || '#888') + '">' + p.name + '</div>';
        html += '<div style="font-size:10px;color:' + BG.textMuted + ';margin-top:2px">' + typeLabel + ' · ' + p.coupon + '% · ' + p.duration + ' ans';
        if (p.type === 'hybride') html += ' · plancher ' + p.couponPlancher + '% + bonus ' + p.couponBonus + '%';
        if (p.condition) html += ' · ' + p.condition;
        html += '</div>';

        // Spread info
        var expectedRate = p.type === 'fixe' ? p.coupon : p.type === 'hybride' ? (p.couponPlancher + p.couponBonus * (p.conditionProb || 0.68)) : (p.coupon * (p.conditionProb || 0.68));
        var spread = expectedRate - _state.rate;
        html += '<div style="font-size:10px;margin-top:4px;color:' + (spread >= 0 ? '#059669' : '#DC2626') + '">Spread espéré vs emprunt : <strong>' + (spread >= 0 ? '+' : '') + _pct(spread) + '%</strong></div>';
        html += '</div>';

        // Right: amount input
        html += '<div style="text-align:right">';
        html += '<label style="font-size:9px;color:' + BG.textDim + ';display:block;margin-bottom:2px">Montant alloué</label>';
        html += '<input type="number" value="' + p.amount + '" step="50000" min="0" max="' + _state.amount + '" onchange="_carrySetAmount(' + idx + ',this.value)" style="width:140px;padding:8px;border:1px solid ' + (p.color || '#888') + '44;border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-family:var(--mono);font-size:14px;text-align:right">';
        html += '<div style="font-size:10px;color:' + BG.textDim + ';margin-top:2px">' + pctAlloc + '% du total</div>';
        html += '</div>';

        html += '</div></div>';
      });
    }
    html += '</div>';

    // ─── Simulate button ──────
    if (allProducts.length > 0 && allocOK) {
      html += '<button class="btn primary ai-glow" style="width:100%;padding:14px;font-size:14px" onclick="_carrySimulate()">⚡ Simuler — ' + allProducts.length + ' produit' + (allProducts.length > 1 ? 's' : '') + ' · Scénarios & P&L détaillé</button>';
    } else if (allProducts.length > 0) {
      html += '<div style="width:100%;padding:14px;font-size:12px;text-align:center;color:#D97706;background:rgba(255,182,39,0.08);border:1px dashed #D97706;border-radius:var(--radius-sm)">⚠️ Ajustez les montants — allocation totale doit = ' + _fmt(_state.amount) + '€ (actuellement ' + _fmt(totalAlloc) + '€)</div>';
    } else {
      html += '<div style="width:100%;padding:14px;font-size:12px;text-align:center;color:' + BG.textDim + ';background:' + BG.section + ';border:1px dashed var(--border);border-radius:var(--radius-sm)">Ajoutez au moins 1 produit pour lancer la simulation</div>';
    }

    // ─── Mail template ──────
    html += '<div style="background:' + BG.section + ';border:1px solid rgba(168,85,247,0.3);border-radius:var(--radius-sm);padding:16px;margin-top:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:#A855F7;margin-bottom:8px">📧 MAIL TYPE POUR LE STRUCTUREUR</div>';
    var mailProducts = allProducts.length > 0 ? allProducts : _recommendedProducts();
    var mailLines = [
      'Objet : Demande de structuration - ' + _fmt(_state.amount) + ' EUR capital garanti',
      '',
      'Bonjour,',
      '',
      'Dans le cadre d\'un emprunt de trésorerie de ' + _fmt(_state.amount) + ' EUR à ' + _state.rate + '% fixe sur ' + _state.years + ' ans, nous souhaitons structurer ' + (mailProducts.length === 1 ? '1 produit' : mailProducts.length + ' produits') + ' capital garanti 100% à échéance.',
      '',
      'Contraintes :',
      '- Nominal total : ' + _fmt(_state.amount) + ' EUR',
      '- Minimum ' + _fmt(500000) + ' EUR par produit',
      '- Capital garanti 100% à échéance (inconditionnelle)',
      '- Coupon minimum > ' + _state.rate + '% pour assurer un carry positif',
      '- Pas de sous-jacent actions',
      '- Duree : ' + _state.years + ' ans max',
      ''
    ];
    mailProducts.forEach(function(p, i) {
      mailLines.push('Produit ' + (i+1) + ' : ' + p.name);
      if (p.amount > 0) mailLines.push('  Nominal : ' + _fmt(p.amount) + ' EUR');
      mailLines.push('  Type : ' + p.type + (p.type === 'hybride' ? ' (plancher garanti ' + p.couponPlancher + '% + bonus conditionnel)' : ''));
      mailLines.push('  Coupon cible : ' + p.coupon + '%');
      if (p.condition) mailLines.push('  Condition : ' + p.condition);
      mailLines.push('');
    });
    mailLines.push('Merci de nous transmettre les term sheets et pricing indicatif.');
    mailLines.push('');
    mailLines.push('Cordialement');
    html += '<textarea id="carry-mail" style="width:100%;height:220px;padding:10px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-size:11px;line-height:1.5;resize:vertical;box-sizing:border-box;white-space:pre-wrap">' + mailLines.join('\n') + '</textarea>';
    html += '<button class="btn" onclick="navigator.clipboard.writeText(document.getElementById(\'carry-mail\').value);this.textContent=\'✓ Copié\';setTimeout(()=>this.textContent=\'📋 Copier le mail\',2000)" style="margin-top:8px;font-size:11px;padding:6px 14px">📋 Copier le mail</button>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ RENDER — RESULTS ══════════════════════════════════════
  function _renderResult(container) {
    var r = _state.result;
    var html = '<div class="section" style="' + WRAP_STYLE + '">';
    html += '<div class="section-header" style="border-color:' + BG.border + '"><div class="section-title" style="color:' + BG.text + '"><span class="dot" style="background:#2563EB"></span>🏦 Carry Trade — P&L & Scénarios</div>';
    html += '<button class="btn sm" style="background:' + BG.section + ';border-color:' + BG.border + ';color:' + BG.text + '" onclick="_carryReset()">← Modifier</button></div>';

    // ─── Loan summary ──────
    var annIF = Math.round(_state.amount * _state.rate / 100);
    html += '<div style="background:' + BG.section + ';border:1px solid rgba(6,214,160,0.3);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<span style="font-size:13px;font-weight:700;color:#059669">✅ Prêt Equipéa SG — ' + _fmt(_state.amount) + '€ à ' + _state.rate + '% fixe sur ' + _state.years + ' ans</span>';
    html += '<span style="font-size:10px;color:' + BG.textDim + '">Caméleons Com Mark · Crédit en blanc · Frais ' + _fmt(_state.loanFees) + '€</span>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">';
    html += '<div style="padding:6px 10px;background:rgba(34,211,238,0.08);border-radius:4px;color:#0891B2">✅ In fine : <strong>-' + _fmt(annIF) + '€/an</strong> · total intérêts -' + _fmt(annIF * _state.years) + '€ · capital constant</div>';
    html += '<div style="padding:6px 10px;background:rgba(168,85,247,0.04);border-radius:4px;color:#A855F7">Amort. : -' + _fmt(_state.monthlyPayment) + '€/mois · total intérêts -' + _fmt(_state.totalInterestAmort) + '€ · capital décroissant</div>';
    html += '</div></div>';

    // ─── DAF KPI DASHBOARD ──────
    var loanTypes = _state.loanType === 'both' ? ['inFine', 'amortissable'] : [_state.loanType];
    var userSc = r.scenarios.find(function(s) { return s.isUser; });

    // Compute user scenario for KPI cards
    if (userSc) {
      var kpiLt = loanTypes[0];
      var kpiExp = _computePortfolio(userSc.products, _state.amount, _state.rate, _state.years, _state.taxRate, kpiLt, 'expected');
      var kpiWorst = _computePortfolio(userSc.products, _state.amount, _state.rate, _state.years, _state.taxRate, kpiLt, 'worst');
      var kpiBest = _computePortfolio(userSc.products, _state.amount, _state.rate, _state.years, _state.taxRate, kpiLt, 'best');

      var roiTotal = kpiExp.totalNetAfterTax / _state.amount * 100;
      var roiAnnual = roiTotal / _state.years;
      var roiWorst = kpiWorst.totalNetAfterTax / _state.amount * 100 / _state.years;
      var roiBest = kpiBest.totalNetAfterTax / _state.amount * 100 / _state.years;
      var spreadBrut = kpiExp.totalRevenue / _state.amount / _state.years * 100 - _state.rate;

      html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:20px">';
      [
        ['RENDEMENT NET/AN', _pct(roiAnnual) + '%', roiAnnual >= 0 ? '#059669' : '#DC2626', 'Après IS 25%'],
        ['ROI TOTAL ' + _state.years + 'A', _pct(roiTotal) + '%', roiTotal >= 0 ? '#059669' : '#DC2626', _fmt(kpiExp.totalNetAfterTax) + '€ net'],
        ['NET ESPÉRÉ/AN', _fmt(kpiExp.avgPerYear) + '€', kpiExp.avgPerYear >= 0 ? '#059669' : '#DC2626', 'Après intérêts + IS'],
        ['SPREAD NET', '+' + _pct(spreadBrut) + '%', '#0891B2', 'Coupon moyen - taux emprunt'],
        ['PIRE CAS/AN', _pct(roiWorst) + '%', roiWorst >= 0 ? '#059669' : '#DC2626', _fmt(kpiWorst.avgPerYear) + '€/an'],
        ['BEST CASE/AN', '+' + _pct(roiBest) + '%', '#0891B2', _fmt(kpiBest.avgPerYear) + '€/an']
      ].forEach(function(kpi) {
        html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:var(--radius-sm);padding:12px;text-align:center">';
        html += '<div style="font-size:9px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.8px;margin-bottom:6px">' + kpi[0] + '</div>';
        html += '<div style="font-family:var(--mono);font-size:18px;font-weight:700;color:' + kpi[2] + '">' + kpi[1] + '</div>';
        html += '<div style="font-size:9px;color:' + BG.textDim + ';margin-top:4px">' + kpi[3] + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // ─── SCENARIO COMPARISON TABLE ──────
    html += '<div style="font-size:13px;font-weight:700;color:' + BG.text + ';margin-bottom:10px">📊 COMPARAISON DES SCÉNARIOS — Quel split est optimal ?</div>';

    loanTypes.forEach(function(lt) {
      var ltLabel = lt === 'inFine' ? 'IN FINE' : 'AMORTISSABLE';
      var ltColor = lt === 'inFine' ? '#0891B2' : '#A855F7';

      html += '<div style="border:1px solid ' + ltColor + '33;border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
      html += '<div style="padding:8px 12px;background:' + ltColor + '0A;font-weight:700;color:' + ltColor + ';font-size:12px">' + ltLabel + '</div>';

      html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
      html += '<thead><tr style="border-bottom:2px solid var(--border)">';
      html += '<th style="padding:8px 6px;text-align:left;color:' + BG.textMuted + ';font-size:10px">Scénario</th>';
      html += '<th style="padding:8px 6px;text-align:right;color:' + BG.textMuted + ';font-size:10px">Allocation</th>';
      html += '<th style="padding:8px 6px;text-align:right;color:#059669;font-size:10px">Rdt net/an</th>';
      html += '<th style="padding:8px 6px;text-align:right;color:#059669;font-size:10px">ROI total</th>';
      html += '<th style="padding:8px 6px;text-align:right;color:#059669;font-size:10px">Net/an €</th>';
      html += '<th style="padding:8px 6px;text-align:right;color:#059669;font-size:10px">Total € net</th>';
      html += '<th style="padding:8px 6px;text-align:right;color:#D97706;font-size:10px">Pire cas %</th>';
      html += '<th style="padding:8px 6px;text-align:right;color:#0891B2;font-size:10px">Best case %</th>';
      html += '</tr></thead><tbody>';

      var scenarioResults = r.scenarios.map(function(sc) {
        var expected = _computePortfolio(sc.products, _state.amount, _state.rate, _state.years, _state.taxRate, lt, 'expected');
        var worst = _computePortfolio(sc.products, _state.amount, _state.rate, _state.years, _state.taxRate, lt, 'worst');
        var best = _computePortfolio(sc.products, _state.amount, _state.rate, _state.years, _state.taxRate, lt, 'best');
        return { scenario: sc, expected: expected, worst: worst, best: best };
      });
      scenarioResults.sort(function(a, b) { return b.expected.totalNetAfterTax - a.expected.totalNetAfterTax; });

      scenarioResults.forEach(function(sr, i) {
        var sc = sr.scenario;
        var isBest = i === 0;
        var isUser = sc.isUser;
        var bg = isUser ? BG.highlight : isBest ? '#1A2E2A' : (i % 2 === 0 ? BG.row0 : BG.row1);
        var allocDesc = sc.products.map(function(p) { return Math.round(p.amount/1000) + 'K'; }).join('+');

        var rdtAnnual = sr.expected.totalNetAfterTax / _state.amount * 100 / _state.years;
        var roiTot = sr.expected.totalNetAfterTax / _state.amount * 100;
        var worstPct = sr.worst.totalNetAfterTax / _state.amount * 100 / _state.years;
        var bestPct = sr.best.totalNetAfterTax / _state.amount * 100 / _state.years;

        html += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)">';
        html += '<td style="padding:8px 6px;font-weight:' + (isUser || isBest ? '700' : '400') + ';color:' + BG.text + ';max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + sc.name + (isBest ? ' 🏆' : '') + '</td>';
        html += '<td style="padding:8px 6px;text-align:right;font-size:10px;color:' + BG.textDim + '">' + allocDesc + '</td>';
        // Rdt net/an %
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700;font-size:12px;color:' + (rdtAnnual >= 0 ? '#059669' : '#DC2626') + '">' + (rdtAnnual >= 0 ? '+' : '') + _pct(rdtAnnual) + '%</td>';
        // ROI total %
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + (roiTot >= 0 ? '#059669' : '#DC2626') + '">' + (roiTot >= 0 ? '+' : '') + _pct(roiTot) + '%</td>';
        // Net/an €
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + (sr.expected.avgPerYear >= 0 ? '#059669' : '#DC2626') + '">' + (sr.expected.avgPerYear >= 0 ? '+' : '') + _fmt(sr.expected.avgPerYear) + '€</td>';
        // Total € net
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + (sr.expected.totalNetAfterTax >= 0 ? '#059669' : '#DC2626') + '">' + (sr.expected.totalNetAfterTax >= 0 ? '+' : '') + _fmt(sr.expected.totalNetAfterTax) + '€</td>';
        // Pire cas %
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + (worstPct >= 0 ? '#059669' : '#DC2626') + '">' + (worstPct >= 0 ? '+' : '') + _pct(worstPct) + '%</td>';
        // Best %
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:#0891B2">' + (bestPct >= 0 ? '+' : '') + _pct(bestPct) + '%</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    });

    // ─── DETAILED P&L — User allocation ──────
    html += '<div style="font-size:13px;font-weight:700;color:' + BG.text + ';margin:20px 0 10px">📋 P&L DÉTAILLÉ — Mon allocation</div>';

    loanTypes.forEach(function(lt) {
      var ltLabel = lt === 'inFine' ? 'IN FINE' : 'AMORTISSABLE';
      var ltColor = lt === 'inFine' ? '#0891B2' : '#A855F7';
      var userScenario = r.scenarios.find(function(s) { return s.isUser; });
      if (!userScenario) return;

      var expected = _computePortfolio(userScenario.products, _state.amount, _state.rate, _state.years, _state.taxRate, lt, 'expected');
      var worst = _computePortfolio(userScenario.products, _state.amount, _state.rate, _state.years, _state.taxRate, lt, 'worst');

      html += '<div style="border:1px solid ' + ltColor + '33;border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">';
      html += '<div style="padding:8px 12px;background:' + ltColor + '0A;display:flex;justify-content:space-between;align-items:center">';
      html += '<span style="font-weight:700;color:' + ltColor + ';font-size:12px">' + ltLabel + '</span>';
      html += '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:#059669">Net total : ' + (expected.totalNetAfterTax >= 0 ? '+' : '') + _fmt(expected.totalNetAfterTax) + '€ (' + (expected.avgPerYear >= 0 ? '+' : '') + _fmt(expected.avgPerYear) + '€/an)</span>';
      html += '</div>';

      // Summary cards with % metrics
      var pnlRoiAn = expected.totalNetAfterTax / _state.amount * 100 / _state.years;
      var pnlRoiTot = expected.totalNetAfterTax / _state.amount * 100;
      html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0;border-bottom:1px solid var(--border)">';
      [
        ['Revenus totaux', '+' + _fmt(expected.totalRevenue) + '€', '#059669', _pct(expected.totalRevenue / _state.amount * 100) + '% du capital'],
        ['Intérêts emprunt', '-' + _fmt(expected.totalInterest) + '€', '#DC2626', _pct(expected.totalInterest / _state.amount * 100) + '% du capital'],
        ['IS 25%', '-' + _fmt(expected.totalTax) + '€', '#D97706', ''],
        ['NET APRÈS IS', (expected.totalNetAfterTax >= 0 ? '+' : '') + _fmt(expected.totalNetAfterTax) + '€', expected.totalNetAfterTax >= 0 ? '#059669' : '#DC2626', ''],
        ['RDT NET/AN', (pnlRoiAn >= 0 ? '+' : '') + _pct(pnlRoiAn) + '%', pnlRoiAn >= 0 ? '#059669' : '#DC2626', _fmt(expected.avgPerYear) + '€/an'],
        ['ROI TOTAL', (pnlRoiTot >= 0 ? '+' : '') + _pct(pnlRoiTot) + '%', pnlRoiTot >= 0 ? '#059669' : '#DC2626', 'Sur ' + _state.years + ' ans']
      ].forEach(function(card) {
        html += '<div style="padding:10px 8px;border-right:1px solid var(--border);text-align:center">';
        html += '<div style="font-size:8px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.5px">' + card[0] + '</div>';
        html += '<div style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + card[2] + ';margin-top:3px">' + card[1] + '</div>';
        if (card[3]) html += '<div style="font-size:8px;color:' + BG.textDim + ';margin-top:2px">' + card[3] + '</div>';
        html += '</div>';
      });
      html += '</div>';

      // Year by year table
      html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
      html += '<thead><tr style="background:' + BG.header + ';border-bottom:1px solid var(--border)">';
      html += '<th style="padding:6px;text-align:left;color:' + BG.textDim + '">An</th>';
      userScenario.products.forEach(function(p) {
        html += '<th style="padding:6px;text-align:right;color:' + (p.color || 'var(--text-dim)') + '">' + p.name.substring(0, 18) + '</th>';
      });
      html += '<th style="padding:6px;text-align:right;color:#059669">Total Rev.</th>';
      html += '<th style="padding:6px;text-align:right;color:#DC2626">Intérêts</th>';
      html += '<th style="padding:6px;text-align:right;color:#D97706">IS</th>';
      html += '<th style="padding:6px;text-align:right;color:' + BG.text + ';font-weight:700">Net</th>';
      html += '<th style="padding:6px;text-align:right;color:#0891B2">Cumul €</th>';
      html += '<th style="padding:6px;text-align:right;color:#7C3AED">ROI cumul %</th>';
      html += '</tr></thead><tbody>';

      expected.flows.forEach(function(f, fi) {
        var bg = fi % 2 === 0 ? BG.row0 : BG.row1;
        var roiCumul = f.cumulNet / _state.amount * 100;
        html += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)">';
        html += '<td style="padding:5px 6px;font-weight:600">An ' + f.year + '</td>';
        f.revenueByProduct.forEach(function(rp) {
          html += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + (rp.color || '#059669') + '">+' + _fmt(rp.revenue) + '€</td>';
        });
        html += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#059669">+' + _fmt(f.totalRevenue) + '€</td>';
        html += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _fmt(f.interest) + '€</td>';
        html += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#D97706">-' + _fmt(f.tax) + '€</td>';
        var nc = f.netAfterTax >= 0 ? '#059669' : '#DC2626';
        html += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + nc + '">' + (f.netAfterTax >= 0 ? '+' : '') + _fmt(f.netAfterTax) + '€</td>';
        html += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#0891B2;font-weight:600">' + (f.cumulNet >= 0 ? '+' : '') + _fmt(f.cumulNet) + '€</td>';
        html += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:#7C3AED">' + (roiCumul >= 0 ? '+' : '') + _pct(roiCumul) + '%</td>';
        html += '</tr>';
      });

      // Total row
      html += '<tr style="border-top:2px solid var(--border);background:' + BG.header + ';font-weight:700">';
      html += '<td style="padding:8px 6px">TOTAL</td>';
      userScenario.products.forEach(function(p, pi) {
        var productTotal = expected.flows.reduce(function(s, f) { return s + f.revenueByProduct[pi].revenue; }, 0);
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + (p.color || '#059669') + '">+' + _fmt(productTotal) + '€</td>';
      });
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:#059669">+' + _fmt(expected.totalRevenue) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _fmt(expected.totalInterest) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:#D97706">-' + _fmt(expected.totalTax) + '€</td>';
      var totalRoiPct = expected.totalNetAfterTax / _state.amount * 100;
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + (expected.totalNetAfterTax >= 0 ? '#059669' : '#DC2626') + '">' + (expected.totalNetAfterTax >= 0 ? '+' : '') + _fmt(expected.totalNetAfterTax) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right"></td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:#7C3AED">' + (totalRoiPct >= 0 ? '+' : '') + _pct(totalRoiPct) + '%</td>';
      html += '</tr>';
      html += '</tbody></table>';

      // Worst case summary with %
      var worstRoiAn = worst.totalNetAfterTax / _state.amount * 100 / _state.years;
      html += '<div style="padding:10px 12px;background:rgba(239,68,68,0.06);border-top:1px solid var(--border);font-size:11px;display:flex;justify-content:space-between">';
      html += '<div><strong style="color:#DC2626">⚠️ Pire cas :</strong> ';
      html += '<span style="color:' + BG.textMuted + '">Net total = <strong style="color:' + (worst.totalNetAfterTax >= 0 ? '#059669' : '#DC2626') + '">' + (worst.totalNetAfterTax >= 0 ? '+' : '') + _fmt(worst.totalNetAfterTax) + '€</strong>';
      html += ' (' + (worst.avgPerYear >= 0 ? '+' : '') + _fmt(worst.avgPerYear) + '€/an)</span></div>';
      html += '<div style="font-family:var(--mono);font-weight:700;color:' + (worstRoiAn >= 0 ? '#059669' : '#DC2626') + '">' + (worstRoiAn >= 0 ? '+' : '') + _pct(worstRoiAn) + '%/an</div>';
      html += '</div>';

      html += '</div>';
    });

    // ─── Product details cards ──────
    html += '<div style="font-size:13px;font-weight:700;color:' + BG.text + ';margin:20px 0 10px">📦 DÉTAIL DES PRODUITS</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(' + Math.min(_state.products.length, 3) + ',1fr);gap:10px;margin-bottom:16px">';
    _state.products.forEach(function(p) {
      var expectedRate = p.type === 'fixe' ? p.coupon : p.type === 'hybride' ? (p.couponPlancher + p.couponBonus * (p.conditionProb || 0.68)) : (p.coupon * (p.conditionProb || 0.68));
      var spread = expectedRate - _state.rate;
      var annualNet = Math.round(p.amount * spread / 100 * (1 - _state.taxRate / 100));

      html += '<div style="border:1px solid ' + (p.color || '#888') + '33;border-radius:var(--radius-sm);padding:14px;background:' + (p.color || '#888') + '06">';
      html += '<div style="font-size:13px;font-weight:700;color:' + (p.color || '#888') + '">' + p.name + '</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:700;color:' + BG.text + ';margin:6px 0">' + _fmt(p.amount) + '€</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;color:' + BG.textMuted + '">';
      html += '<div>Coupon : <strong>' + p.coupon + '%</strong></div>';
      html += '<div>Durée : <strong>' + p.duration + ' ans</strong></div>';
      html += '<div>Type : <strong>' + p.type + '</strong></div>';
      html += '<div>Capital : <strong>' + (p.capitalGaranti ? '✓ Garanti' : '✗ Non') + '</strong></div>';
      html += '</div>';
      if (p.type === 'hybride') html += '<div style="font-size:10px;color:#059669;margin-top:6px">Plancher ' + p.couponPlancher + '% garanti + bonus ' + p.couponBonus + '%</div>';
      if (p.condition) html += '<div style="font-size:10px;color:#D97706;margin-top:4px">' + p.condition + '</div>';
      html += '<div style="margin-top:8px;padding:6px 8px;border-radius:4px;background:' + (spread >= 0 ? 'rgba(6,214,160,0.08)' : 'rgba(239,68,68,0.08)') + '">';
      html += '<div style="font-size:10px;color:' + BG.textDim + '">Contribution P&L espérée</div>';
      html += '<div style="font-family:var(--mono);font-size:13px;font-weight:700;color:' + (annualNet >= 0 ? '#059669' : '#DC2626') + '">' + (annualNet >= 0 ? '+' : '') + _fmt(annualNet) + '€/an</div>';
      html += '</div>';
      html += '<div style="font-size:9px;color:' + BG.textDim + ';margin-top:6px">Risque : ' + (p.risk || '?') + '</div>';
      html += '</div>';
    });
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ ACTIONS ═══════════════════════════════════════════════

  window._carryAddRecommended = function(id) {
    var recs = _recommendedProducts();
    var rec = recs.find(function(r) { return r.id === id; });
    if (!rec) return;
    var exists = _state.products.some(function(p) { return p.id === id; });
    if (exists) return;
    _state.products.push(Object.assign({}, rec, { amount: 0 }));
    _equalizeAmounts();
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window._carryRemoveProduct = function(idx) {
    _state.products.splice(idx, 1);
    if (_state.products.length > 0) _equalizeAmounts();
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window._carrySetAmount = function(idx, value) {
    _state.products[idx].amount = parseInt(value) || 0;
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window._carryEqualize = function() {
    _equalizeAmounts();
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window._carryImportJSON = function() {
    var textarea = document.getElementById('carry-json');
    if (!textarea || !textarea.value.trim()) return;
    var product = _parseJSON(textarea.value);
    if (product) {
      _state.products.push(product);
      _equalizeAmounts();
      textarea.value = '';
      renderCarrySimulator(document.getElementById('main-content'));
    } else { alert('JSON invalide'); }
  };

  window._carryAddManual = function() {
    var name = document.getElementById('carry-pname')?.value || 'Produit manuel';
    var type = document.getElementById('carry-ptype')?.value || 'conditionnel';
    var coupon = parseFloat(document.getElementById('carry-pcoupon')?.value) || 5;
    var duration = parseInt(document.getElementById('carry-pduration')?.value) || 5;
    var floor = parseFloat(document.getElementById('carry-pfloor')?.value) || 0;

    var product = {
      id: 'manual_' + Date.now(), name: name, type: type,
      coupon: coupon, duration: duration, capitalGaranti: true,
      conditionProb: type === 'fixe' ? 1.0 : 0.68,
      color: type === 'fixe' ? '#06D6A0' : type === 'hybride' ? '#4ECDC4' : '#FFB627',
      risk: type === 'fixe' ? 'Coupon garanti' : 'Coupon conditionnel',
      source: 'saisie manuelle', amount: 0
    };
    if (type === 'hybride' && floor > 0) {
      product.couponPlancher = floor;
      product.couponBonus = coupon - floor;
    }
    _state.products.push(product);
    _equalizeAmounts();
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window._carryGenerateAI = async function() {
    var btn = document.getElementById('carry-ai-btn');
    var status = document.getElementById('carry-ai-status');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Claude analyse le marché...'; }
    if (status) status.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:8px;color:' + BG.textMuted + ';font-size:11px"><div class="spinner" style="width:16px;height:16px;border-width:2px"></div>Génération en cours...</div>';

    var prompt = 'Tu es un structureur de produits financiers. Un client entreprise emprunte ' + _fmt(_state.amount) + ' EUR a ' + _state.rate + '% fixe sur ' + _state.years + ' ans (in fine). Il veut placer en produits structures capital garanti pour generer une marge.\n\n';
    prompt += 'Conditions marche actuelles :\n- TEC10 (OAT 10 ans) : 3.10%\n- BCE depot : 2.00%\n- BCE main : 2.15%\n- Regime : stagflation (Brent $103, PCE 2.8%)\n- Vol OAT 10Y : ~18 bps/an\n- Euribor 3M : ~2.50%\n\n';
    prompt += 'Genere 3 produits structures REALISTES (1 fixe, 1 hybride, 1 conditionnel). Chaque produit doit avoir coupon > ' + _state.rate + '%.\n\n';
    prompt += 'IMPORTANT: duree 5 ans, les coupons doivent etre ambitieux (fixe 5%+, hybride 7%+, conditionnel 7-8%). Sur 5 ans le risque est plus faible donc les banques peuvent offrir plus.\n\n';
    prompt += 'Reponds UNIQUEMENT en JSON :\n```json\n[\n  {"name":"...","type":"fixe"|"conditionnel"|"hybride","coupon":7.0,"couponPlancher":3.5,"couponBonus":3.5,"duration":5,"condition":"TEC10 <= 4.40%" ou null,"conditionProb":0.80,"guaranteedYears":0,"risk":"..."}\n]\n```';

    try {
      var resp = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: CONFIG.AI_MODEL || 'claude-sonnet-4-20250514', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
      });
      var data = await resp.json();
      var text = data.content ? data.content[0].text : (data.choices ? data.choices[0].message.content : '');
      var jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Pas de JSON');
      var products = JSON.parse(jsonMatch[0]);

      products.forEach(function(p) {
        _state.products.push({
          id: 'ai_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          name: p.name || 'Produit IA', type: p.type || 'conditionnel',
          coupon: parseFloat(p.coupon) || 5,
          couponPlancher: p.type === 'hybride' ? (parseFloat(p.couponPlancher) || 3) : undefined,
          couponBonus: p.type === 'hybride' ? (parseFloat(p.couponBonus) || 2) : undefined,
          duration: parseInt(p.duration) || 5, capitalGaranti: true,
          condition: p.condition || null,
          conditionProb: parseFloat(p.conditionProb) || (p.type === 'fixe' ? 1.0 : 0.68),
          guaranteedYears: parseInt(p.guaranteedYears) || 0,
          color: p.type === 'fixe' ? '#06D6A0' : p.type === 'hybride' ? '#4ECDC4' : '#FFB627',
          risk: p.risk || '?', source: 'Claude IA', amount: 0
        });
      });
      _equalizeAmounts();
      if (status) status.innerHTML = '<div style="padding:8px;color:#059669;font-size:11px">✅ ' + products.length + ' produits générés</div>';
      setTimeout(function() { renderCarrySimulator(document.getElementById('main-content')); }, 800);
    } catch(e) {
      console.error('[CarryAI]', e);
      if (status) status.innerHTML = '<div style="padding:8px;color:#DC2626;font-size:11px">❌ ' + e.message + '</div>';
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Réessayer'; }
    }
  };

  window._carrySimulate = function() {
    _state.amount = parseFloat(document.getElementById('carry-amount')?.value) || 1000000;
    _state.rate = parseFloat(document.getElementById('carry-rate')?.value) || 2.90;
    _state.years = parseInt(document.getElementById('carry-years')?.value) || 10;
    _state.loanType = document.getElementById('carry-loantype')?.value || 'both';

    var scenarios = _generateScenarios(_state.products, _state.amount);
    _state.result = { scenarios: scenarios };
    _renderResult(document.getElementById('main-content'));
  };

  window._carryReset = function() {
    _state.result = null;
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window.renderCarrySimulator = function(container) {
    if (_state.result) _renderResult(container);
    else _renderForm(container);
  };

  console.log('[StructBoard] Carry Trade Simulator v3.0 loaded — multi-produit & P&L');
})();

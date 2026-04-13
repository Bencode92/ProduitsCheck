// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Carry Trade Simulator v1.0
// Emprunter à X% pour placer en structurés capital garanti à Y%
// Compare in fine vs amortissable, 1 produit vs 2 produits
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _state = {
    amount: 1000000,
    rate: 2.90,
    years: 10,
    frequency: 'annuel', // fixé annuel pour lisibilité
    taxRate: 25, // IS
    result: null
  };

  // ─── Frequency helpers ──────────────────────────────
  function _periodsPerYear(freq) {
    if (freq === 'mensuel') return 12;
    if (freq === 'trimestriel') return 4;
    return 1;
  }
  function _freqLabel(freq) {
    if (freq === 'mensuel') return 'mois';
    if (freq === 'trimestriel') return 'trimestre';
    return 'an';
  }

  function _fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }

  // ─── Product templates based on current market ──────
  function _generateProducts(amount) {
    // Based on what we know: TEC10 at 3.10%, seuil 4.40%, ECB 2%
    return [
      {
        id: 'fixe_5y',
        name: 'Taux Fixe Garanti 5 ans',
        type: 'fixe',
        coupon: 4.20,
        duration: 5,
        capitalGaranti: true,
        condition: null,
        description: 'Coupon 100% garanti, capital garanti. Callable par l\'émetteur.',
        risk: 'low',
        riskLabel: 'Aucun (coupon + capital garantis)',
        color: '#06D6A0'
      },
      {
        id: 'fixe_10y',
        name: 'Taux Fixe Garanti 10 ans',
        type: 'fixe',
        coupon: 4.60,
        duration: 10,
        capitalGaranti: true,
        condition: null,
        description: 'Coupon garanti sur 10 ans. Lock-in du taux en stagflation.',
        risk: 'low',
        riskLabel: 'Aucun (coupon + capital garantis)',
        color: '#06D6A0'
      },
      {
        id: 'tarn_tec10',
        name: 'TARN TEC10 6%',
        type: 'conditionnel',
        coupon: 6.00,
        duration: 10,
        capitalGaranti: true,
        condition: 'TEC10 ≤ 4.40%',
        conditionProb: 0.68, // 68% — vol réaliste 80bps, mean-reverting, marge 130bps
        description: 'Coupon 6% si TEC10 reste sous 4.40%. Autocall si cumul ≥ 24%.',
        risk: 'medium',
        riskLabel: 'Coupon 0% si TEC10 > 4.40% (actuellement 3.10%, marge 130bps)',
        color: '#FFB627'
      },
      {
        id: 'digitale_tec10',
        name: 'Digitale Mémoire TEC10 4.6%',
        type: 'conditionnel',
        coupon: 4.60,
        duration: 5,
        capitalGaranti: true,
        condition: 'TEC10 ≤ 4.40% + mémoire',
        conditionProb: 0.75, // mémoire rattrape → prob effective plus haute que TARN
        description: 'Coupon 4.6% si TEC10 ≤ 4.40%. Mémoire: coupons rattrapés.',
        risk: 'medium',
        riskLabel: 'Coupon conditionnel mais mémoire rattrape les années manquées',
        color: '#FFB627'
      },
      {
        id: 'hybride_5y',
        name: 'Hybride Plancher 3% + Bonus TEC10',
        type: 'hybride',
        coupon: 5.50,
        couponPlancher: 3.00,
        couponBonus: 2.50,
        duration: 5,
        capitalGaranti: true,
        condition: 'Plancher 3% garanti + 2.5% si TEC10 ≤ 4.40%',
        conditionProb: 0.68, // même prob que TARN pour le bonus
        description: 'Plancher 3% garanti (couvre l\'emprunt). Bonus 2.5% conditionnel.',
        risk: 'very_low',
        riskLabel: 'Marge minimum garantie (plancher 3% > emprunt 2.9%)',
        color: '#4ECDC4'
      },
      {
        id: 'range_accrual',
        name: 'Range Accrual Euribor 5.2%',
        type: 'conditionnel',
        coupon: 5.20,
        duration: 5,
        capitalGaranti: true,
        condition: 'Euribor 3M dans [1.75%-3.50%]',
        conditionProb: 0.55, // vol Euribor élevée en stagflation
        description: 'Coupon proportionnel au nombre de jours dans le corridor.',
        risk: 'medium_high',
        riskLabel: 'Euribor volatile en stagflation, prob corridor ~65%',
        color: '#FFB627'
      }
    ];
  }

  // ─── Generate optimal configurations ────────────────
  function _generateConfigs(amount, loanRate, years) {
    var products = _generateProducts(amount);
    var configs = [];

    // Config 1: 100% Taux Fixe (safest)
    configs.push({
      name: '100% Taux Fixe Garanti',
      icon: '🛡️',
      risk: 'low',
      products: [{ product: products.find(function(p) { return p.id === 'fixe_10y'; }), amount: amount }]
    });

    // Config 2: 100% TARN (highest return)
    configs.push({
      name: '100% TARN TEC10 6%',
      icon: '🎯',
      risk: 'medium',
      products: [{ product: products.find(function(p) { return p.id === 'tarn_tec10'; }), amount: amount }]
    });

    // Config 3: 100% Hybride (best risk/return)
    configs.push({
      name: '100% Hybride Plancher + Bonus',
      icon: '⚖️',
      risk: 'very_low',
      products: [{ product: products.find(function(p) { return p.id === 'hybride_5y'; }), amount: amount }]
    });

    // Config 4: Split 50/50 Fixe + TARN
    configs.push({
      name: '50% Fixe + 50% TARN TEC10',
      icon: '📊',
      risk: 'low_medium',
      products: [
        { product: products.find(function(p) { return p.id === 'fixe_5y'; }), amount: Math.round(amount * 0.5) },
        { product: products.find(function(p) { return p.id === 'tarn_tec10'; }), amount: Math.round(amount * 0.5) }
      ]
    });

    // Config 5: Split Fixe + Digitale Mémoire
    configs.push({
      name: '50% Fixe + 50% Digitale Mémoire',
      icon: '🧠',
      risk: 'low',
      products: [
        { product: products.find(function(p) { return p.id === 'fixe_5y'; }), amount: Math.round(amount * 0.5) },
        { product: products.find(function(p) { return p.id === 'digitale_tec10'; }), amount: Math.round(amount * 0.5) }
      ]
    });

    // Config 6: Triple diversification
    configs.push({
      name: '40% TARN + 30% Fixe + 30% Hybride',
      icon: '🔀',
      risk: 'low_medium',
      products: [
        { product: products.find(function(p) { return p.id === 'tarn_tec10'; }), amount: Math.round(amount * 0.4) },
        { product: products.find(function(p) { return p.id === 'fixe_5y'; }), amount: Math.round(amount * 0.3) },
        { product: products.find(function(p) { return p.id === 'hybride_5y'; }), amount: Math.round(amount * 0.3) }
      ]
    });

    return configs;
  }

  // ─── Compute cash flows for a config ────────────────
  function _computeCashFlow(config, loanAmount, loanRate, years, taxRate, loanType, reinvest) {
    var ppY = _periodsPerYear(_state.frequency);
    var totalPeriods = years * ppY;
    var periodRate = loanRate / 100 / ppY;

    var flows = [];
    var capitalRemaining = loanAmount;
    var reinvestedCapital = 0; // cumul of reinvested net profits
    var totalRevenue = 0, totalInterest = 0, totalCapital = 0;

    for (var i = 1; i <= totalPeriods; i++) {
      var yearNum = Math.ceil(i / ppY);
      var interest = Math.round(capitalRemaining * periodRate);
      var capitalPayment = 0;

      if (loanType === 'amortissable') {
        var annuity = Math.round(loanAmount * periodRate / (1 - Math.pow(1 + periodRate, -totalPeriods)));
        capitalPayment = annuity - interest;
        if (i === totalPeriods) capitalPayment = capitalRemaining;
      } else {
        if (i === totalPeriods) capitalPayment = loanAmount;
      }

      // Revenue from structured products
      // Base = original allocation + reinvested profits (compound effect)
      var revenue = 0;
      var revenueDetail = [];
      var totalPlaced = 0;
      config.products.forEach(function(slot) {
        var p = slot.product;
        var basePlaced = loanType === 'amortissable'
          ? Math.round(slot.amount * (capitalRemaining / loanAmount))
          : slot.amount;
        // Add proportional share of reinvested capital
        var reinvestShare = reinvest && loanAmount > 0
          ? Math.round(reinvestedCapital * (slot.amount / loanAmount))
          : 0;
        var placedAmount = basePlaced + reinvestShare;

        var couponPeriod = 0;
        // Bug fix: no coupon after product maturity
        if (p.duration && yearNum > p.duration) {
          // Product has matured — capital returned, no more coupon
          // Assume reinvested in CAT at benchmark rate as fallback
          var catFallback = (typeof window._getCATBenchmark === 'function') ? window._getCATBenchmark() : 2.80;
          couponPeriod = Math.round(placedAmount * catFallback / 100 / ppY);
        } else if (p.type === 'fixe') {
          couponPeriod = Math.round(placedAmount * p.coupon / 100 / ppY);
        } else if (p.type === 'hybride') {
          couponPeriod = Math.round(placedAmount * p.couponPlancher / 100 / ppY);
          couponPeriod += Math.round(placedAmount * p.couponBonus / 100 / ppY * (p.conditionProb || 0.68));
        } else if (p.type === 'conditionnel') {
          couponPeriod = Math.round(placedAmount * p.coupon / 100 / ppY * (p.conditionProb || 0.68));
        }
        revenue += couponPeriod;
        totalPlaced += placedAmount;
        revenueDetail.push({ name: p.name, amount: couponPeriod, placed: placedAmount });
      });

      var netBeforeTax = revenue - interest;
      var tax = netBeforeTax > 0 ? Math.round(netBeforeTax * taxRate / 100) : 0;
      var netAfterTax = netBeforeTax - tax;

      // Reinvest net profits into the placed capital for next period
      if (reinvest && netAfterTax > 0) {
        reinvestedCapital += netAfterTax;
      }

      capitalRemaining = Math.max(0, capitalRemaining - capitalPayment);

      flows.push({
        period: i,
        year: yearNum,
        capitalRemaining: capitalRemaining + capitalPayment,
        interest: interest,
        capitalPayment: capitalPayment,
        payment: interest + capitalPayment,
        revenue: revenue,
        revenueDetail: revenueDetail,
        netBeforeTax: netBeforeTax,
        tax: tax,
        netAfterTax: netAfterTax,
        reinvestedCapital: reinvestedCapital,
        totalPlaced: totalPlaced
      });

      totalRevenue += revenue;
      totalInterest += interest;
      totalCapital += capitalPayment;
    }

    // Scenarios
    var optimistRevenue = 0, stressRevenue = 0;
    config.products.forEach(function(slot) {
      var p = slot.product;
      // Use min(product duration, loan years) for revenue projection
      var effectiveYears = p.duration ? Math.min(p.duration, years) : years;
      var remainingYears = years - effectiveYears;
      var catFb = 2.80; // fallback after product matures
      if (p.type === 'fixe') {
        optimistRevenue += slot.amount * p.coupon / 100 * effectiveYears;
        optimistRevenue += slot.amount * catFb / 100 * remainingYears;
        stressRevenue += slot.amount * p.coupon / 100 * effectiveYears; // garanti
        stressRevenue += slot.amount * catFb / 100 * remainingYears;
      } else if (p.type === 'hybride') {
        optimistRevenue += slot.amount * (p.couponPlancher + p.couponBonus) / 100 * effectiveYears;
        optimistRevenue += slot.amount * catFb / 100 * remainingYears;
        stressRevenue += slot.amount * p.couponPlancher / 100 * effectiveYears; // plancher garanti
        stressRevenue += slot.amount * catFb / 100 * remainingYears;
      } else {
        optimistRevenue += slot.amount * p.coupon / 100 * effectiveYears;
        optimistRevenue += slot.amount * catFb / 100 * remainingYears;
        stressRevenue += 0; // vrai pire cas = 0% coupon toute la durée
        stressRevenue += slot.amount * catFb / 100 * remainingYears;
      }
    });

    return {
      flows: flows,
      totalRevenue: totalRevenue,
      totalInterest: totalInterest,
      totalCapital: totalCapital,
      totalPayment: totalInterest + totalCapital,
      totalNet: totalRevenue - totalInterest,
      totalNetAfterTax: Math.round((totalRevenue - totalInterest) * (1 - taxRate / 100)),
      avgMarginPerYear: Math.round((totalRevenue - totalInterest) / years),
      optimistTotal: Math.round(optimistRevenue - totalInterest),
      stressTotal: Math.round(stressRevenue - totalInterest),
      loanType: loanType
    };
  }

  // ─── RENDER ════════════════════════════════════════════

  function _renderForm(container) {
    var html = '<div class="section">';
    html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>💰 Simulateur Carry Trade</div></div>';

    html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:12px">PARAMÈTRES EMPRUNT</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">';
    html += '<div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px">Montant (€)</label>';
    html += '<input type="number" id="carry-amount" value="' + _state.amount + '" step="100000" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-family:var(--mono);font-size:15px"></div>';
    html += '<div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px">Taux fixe (%)</label>';
    html += '<input type="number" id="carry-rate" value="' + _state.rate + '" step="0.1" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-family:var(--mono);font-size:15px"></div>';
    html += '<div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px">Durée (ans)</label>';
    html += '<input type="number" id="carry-years" value="' + _state.years + '" min="1" max="30" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-family:var(--mono);font-size:15px"></div>';
    html += '</div>';
    html += '<div style="font-size:10px;color:var(--text-dim);margin-top:8px">Le système compare automatiquement In Fine vs Amortissable et propose les meilleurs produits structurés.</div>';
    html += '</div>';

    html += '<button class="btn primary ai-glow" style="width:100%;padding:14px;font-size:14px" onclick="_carrySimulate()">⚡ Optimiser le carry trade</button>';
    html += '</div>';

    container.innerHTML = html;
  }

  function _renderResult(container) {
    var r = _state.result;
    var html = '<div class="section">';
    html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>💰 Carry Trade — Résultats</div>';
    html += '<button class="btn sm" onclick="_carryReset()">← Modifier</button></div>';

    // Loan summary
    html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center">';
    html += '<div><div style="font-size:12px;font-weight:700;color:var(--accent)">Emprunt ' + _fmt(_state.amount) + '€ à ' + _state.rate + '% sur ' + _state.years + ' ans</div>';
    html += '<div style="font-size:10px;color:var(--text-dim);margin-top:2px">Coût total intérêts : ' + _fmt(r.configs[0].inFine.totalInterest) + '€ (in fine) / ' + _fmt(r.configs[0].amortissable.totalInterest) + '€ (amortissable)</div></div>';
    html += '<div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--red)">-' + _fmt(Math.round(_state.amount * _state.rate / 100)) + '€/an</div>';
    html += '</div></div>';

    // Recommendation
    var best = r.configs[0];
    r.configs.forEach(function(c) { if (c.bestNet > best.bestNet) best = c; });
    html += '<div style="background:rgba(6,214,160,0.06);border:2px solid rgba(6,214,160,0.3);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:4px">⭐ RECOMMANDATION : ' + best.config.icon + ' ' + best.config.name + '</div>';
    html += '<div style="font-size:11px;color:var(--text-muted)">Marge nette ' + (best.bestType === 'inFine' ? 'in fine' : 'amortissable') + ' (composée) : <span style="color:var(--green);font-weight:700;font-family:var(--mono)">+' + _fmt(best.bestNet) + '€</span> sur ' + _state.years + ' ans soit <span style="font-weight:700">+' + _fmt(Math.round(best.bestNet / _state.years)) + '€/an</span>';
    if (best.compoundBonus > 0) html += ' · <span style="color:var(--cyan)">dont +' + _fmt(best.compoundBonus) + '€ d\'effet composé</span>';
    html += '</div>';
    html += '</div>';

    // Config comparison table
    html += '<div style="overflow-x:auto;margin-bottom:16px">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="border-bottom:2px solid var(--border)">';
    html += '<th style="padding:8px 6px;text-align:left;color:var(--text-muted);font-size:10px">Configuration</th>';
    html += '<th style="padding:8px 6px;text-align:left;color:var(--text-muted);font-size:10px">Produit(s)</th>';
    html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-size:10px">Risque</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--cyan);font-size:10px">In Fine /an</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--purple);font-size:10px">Amort. /an</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--green);font-size:10px">Net total (composé)</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--cyan);font-size:10px">Bonus composé</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--orange);font-size:10px">Pire cas /an</th>';
    html += '</tr></thead><tbody>';

    r.configs.forEach(function(c, i) {
      var isBest = c === best;
      var bg = isBest ? 'rgba(6,214,160,0.04)' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)');
      var riskColors = { low: '#06D6A0', very_low: '#06D6A0', low_medium: '#4ECDC4', medium: '#FFB627', medium_high: '#E85D04' };
      var riskLabels = { low: 'Faible', very_low: 'Très faible', low_medium: 'Modéré-', medium: 'Modéré', medium_high: 'Modéré+' };
      var rc = riskColors[c.config.risk] || '#888';
      var rl = riskLabels[c.config.risk] || '?';
      var prods = c.config.products.map(function(s) { return _fmt(s.amount) + '€ → ' + s.product.name + ' (' + s.product.coupon + '%)'; }).join('<br>');

      // Worst case per year
      var worstInFine = c.inFine.stressTotal / _state.years;
      var worstAmort = c.amortissable.stressTotal / _state.years;
      var worstPerYear = Math.min(worstInFine, worstAmort);

      html += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)' + (isBest ? ';border-left:3px solid var(--green)' : '') + '">';
      html += '<td style="padding:8px 6px;font-weight:600;color:var(--text-bright)">' + c.config.icon + ' ' + c.config.name + (isBest ? ' <span style="color:var(--green);font-size:9px">⭐ BEST</span>' : '') + '</td>';
      html += '<td style="padding:8px 6px;font-size:10px;color:var(--text-muted)">' + prods + '</td>';
      html += '<td style="padding:8px 6px;text-align:center"><span style="color:' + rc + ';font-weight:600;font-size:10px">' + rl + '</span></td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--cyan)">+' + _fmt(c.inFine.avgMarginPerYear) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--purple)">+' + _fmt(c.amortissable.avgMarginPerYear) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">+' + _fmt(c.bestNet) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--cyan)">' + (c.compoundBonus > 0 ? '+' + _fmt(c.compoundBonus) + '€' : '—') + '</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + (worstPerYear >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (worstPerYear >= 0 ? '+' : '') + _fmt(worstPerYear) + '€</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Detailed cash flow for best config
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px">📋 Cash Flow Détaillé — ' + best.config.icon + ' ' + best.config.name + '</div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';

    // In fine
    html += '<div style="border:1px solid var(--cyan)33;border-radius:var(--radius-sm);overflow:hidden">';
    html += '<div style="padding:10px;background:rgba(78,205,196,0.06);font-weight:700;color:var(--cyan);font-size:11px">IN FINE — Capital remboursé à la fin</div>';
    html += _renderFlowTable(best.inFineCompound, 'inFine');
    html += '</div>';

    // Amortissable
    html += '<div style="border:1px solid #A855F733;border-radius:var(--radius-sm);overflow:hidden">';
    html += '<div style="padding:10px;background:rgba(168,85,247,0.06);font-weight:700;color:#A855F7;font-size:11px">AMORTISSABLE — Capital remboursé progressivement</div>';
    html += _renderFlowTable(best.amortCompound, 'amort');
    html += '</div>';

    html += '</div>';

    // Products detail
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px">📦 Détail des produits structurés</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(' + best.config.products.length + ',1fr);gap:12px;margin-bottom:16px">';
    best.config.products.forEach(function(slot) {
      var p = slot.product;
      html += '<div style="border:1px solid ' + p.color + '33;border-radius:var(--radius-sm);padding:12px;background:' + p.color + '08">';
      html += '<div style="font-size:12px;font-weight:700;color:' + p.color + '">' + p.name + '</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--text-bright);margin:6px 0">' + _fmt(slot.amount) + '€</div>';
      html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Coupon : <strong>' + p.coupon + '%</strong> ' + p.type + '</div>';
      html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Durée : ' + p.duration + ' ans · Capital garanti : ' + (p.capitalGaranti ? '✓' : '✗') + '</div>';
      if (p.condition) html += '<div style="font-size:10px;color:var(--orange);margin-bottom:4px">Condition : ' + p.condition + '</div>';
      html += '<div style="font-size:10px;color:var(--text-dim)">' + p.description + '</div>';
      html += '<div style="margin-top:6px;font-size:10px;padding:4px 8px;border-radius:4px;background:' + p.color + '15;color:' + p.color + '">Risque : ' + p.riskLabel + '</div>';
      html += '</div>';
    });
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  function _renderFlowTable(cf, id) {
    var ppY = _periodsPerYear(_state.frequency);
    var h = '<table style="width:100%;border-collapse:collapse;font-size:10px">';
    h += '<thead><tr style="background:rgba(255,255,255,0.03)">';
    h += '<th style="padding:4px 6px;text-align:left;color:var(--text-dim)">Année</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Revenus</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Intérêts</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Marge brute</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Net IS</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Capital placé</th>';
    h += '</tr></thead><tbody>';

    // Aggregate by year
    var byYear = {};
    cf.flows.forEach(function(f) {
      if (!byYear[f.year]) byYear[f.year] = { revenue: 0, interest: 0, net: 0, netAfterTax: 0, totalPlaced: 0 };
      byYear[f.year].revenue += f.revenue;
      byYear[f.year].interest += f.interest;
      byYear[f.year].net += f.netBeforeTax;
      byYear[f.year].netAfterTax += f.netAfterTax;
      byYear[f.year].totalPlaced = f.totalPlaced; // last period of the year
    });

    Object.keys(byYear).forEach(function(yr, i) {
      var y = byYear[yr];
      var bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
      var nc = y.netAfterTax >= 0 ? 'var(--green)' : 'var(--red)';
      h += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)">';
      h += '<td style="padding:4px 6px;font-weight:600">An ' + yr + '</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+' + _fmt(y.revenue) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--red)">-' + _fmt(y.interest) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono)">' + (y.net >= 0 ? '+' : '') + _fmt(y.net) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + nc + '">' + (y.netAfterTax >= 0 ? '+' : '') + _fmt(y.netAfterTax) + '€</td>';
      h += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--cyan);font-size:10px">' + _fmt(y.totalPlaced) + '€</td>';
      h += '</tr>';
    });

    h += '<tr style="border-top:2px solid var(--border);font-weight:700">';
    h += '<td style="padding:6px">TOTAL</td>';
    h += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:var(--green)">+' + _fmt(cf.totalRevenue) + '€</td>';
    h += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:var(--red)">-' + _fmt(cf.totalInterest) + '€</td>';
    h += '<td style="padding:6px;text-align:right;font-family:var(--mono)">+' + _fmt(cf.totalNet) + '€</td>';
    h += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">+' + _fmt(cf.totalNetAfterTax) + '€</td>';
    h += '</tr></tbody></table>';
    return h;
  }

  // ─── ACTIONS ═══════════════════════════════════════════

  window._carrySimulate = function() {
    _state.amount = parseFloat(document.getElementById('carry-amount')?.value) || 1000000;
    _state.rate = parseFloat(document.getElementById('carry-rate')?.value) || 2.90;
    _state.years = parseInt(document.getElementById('carry-years')?.value) || 10;
    _state.frequency = 'annuel';

    var configs = _generateConfigs(_state.amount, _state.rate, _state.years);
    var results = [];

    configs.forEach(function(config) {
      var inFine = _computeCashFlow(config, _state.amount, _state.rate, _state.years, _state.taxRate, 'inFine', false);
      var amort = _computeCashFlow(config, _state.amount, _state.rate, _state.years, _state.taxRate, 'amortissable', false);
      var inFineCompound = _computeCashFlow(config, _state.amount, _state.rate, _state.years, _state.taxRate, 'inFine', true);
      var amortCompound = _computeCashFlow(config, _state.amount, _state.rate, _state.years, _state.taxRate, 'amortissable', true);
      var bestNet = Math.max(inFineCompound.totalNetAfterTax, amortCompound.totalNetAfterTax);
      var bestType = inFineCompound.totalNetAfterTax >= amortCompound.totalNetAfterTax ? 'inFine' : 'amortissable';
      var compoundBonus = bestNet - Math.max(inFine.totalNetAfterTax, amort.totalNetAfterTax);
      results.push({
        config: config,
        inFine: inFine, amortissable: amort,
        inFineCompound: inFineCompound, amortCompound: amortCompound,
        bestNet: bestNet, bestType: bestType, compoundBonus: compoundBonus
      });
    });

    // Sort by best net descending
    results.sort(function(a, b) { return b.bestNet - a.bestNet; });

    _state.result = { configs: results };
    _renderResult(document.getElementById('main-content'));
  };

  window._carryReset = function() {
    _state.result = null;
    renderCarrySimulator(document.getElementById('main-content'));
  };

  // ─── MAIN RENDER ═══════════════════════════════════════
  window.renderCarrySimulator = function(container) {
    if (_state.result) {
      _renderResult(container);
    } else {
      _renderForm(container);
    }
  };

  console.log('[StructBoard] Carry Trade Simulator v1.0 loaded');
})();

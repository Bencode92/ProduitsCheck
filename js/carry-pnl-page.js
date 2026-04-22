// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Carry Trade P&L Simulator — Page dédiée
// 3 scénarios (optimiste/normal/pessimiste) + réinvestissement coupons + capital
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var B = {
    card: '#FFFFFF', row0: '#FFFFFF', row1: '#F4F6F9', header: '#E8ECF2',
    border: '#D1D9E6', text: '#1A202C', muted: '#64748B', dim: '#475569',
    green: '#059669', red: '#DC2626', orange: '#D97706', purple: '#7C3AED'
  };

  function _f(n) { return typeof formatNumber === 'function' ? formatNumber(Math.round(n)) : String(Math.round(n)); }
  function _pct(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  // ─── LOAN PARAMS ──────
  var LOAN = { amount: 1000000, rate: 2.90, years: 5, taxRate: 25, type: 'in_fine' };
  var CAT_REINVEST = 3.0;   // taux réinvestissement coupons sur CAT
  var POST_CALL_RATE = 4.0;  // taux réinvestissement capital post-autocall

  // ─── SCENARIO ENGINE ──────
  function _simulate(product, scenario, overrides) {
    overrides = overrides || {};
    var years = LOAN.years;
    var amount = LOAN.amount;
    var coupon = product.coupon || 0; // FIXED — product coupon
    var guaranteed = product.guaranteedYears || 0;
    var autocallTarget = product.autocallTarget || 0;
    var prob = product.prob || 0.90;
    var catRate = overrides.catReinvest || CAT_REINVEST;
    var postCallRate = overrides.postCallRate || POST_CALL_RATE;

    // Scenario adjustments
    var scenProb;
    if (scenario === 'optimiste') scenProb = Math.min(0.99, prob * 1.08);
    else if (scenario === 'pessimiste') scenProb = 0; // only guaranteed
    else scenProb = prob; // normal

    var flows = [];
    var cumCoupons = 0;
    var cumulNet = 0;
    var catPool = 0; // coupons réinvestis en CAT
    var autocalled = false;
    var autocallYear = 0;

    // Amortizable loan: compute schedule
    var loanType = overrides.loanType || LOAN.type || 'in_fine';
    var remainingCapital = amount;
    var annuity = 0;
    if (loanType === 'amortissable') {
      // Constant annuity formula: A = P × r / (1 - (1+r)^-n)
      var r = LOAN.rate / 100;
      annuity = Math.round(amount * r / (1 - Math.pow(1 + r, -years)));
    }

    for (var yr = 1; yr <= years; yr++) {
      var interest, capitalRepaid = 0;
      if (loanType === 'amortissable') {
        interest = Math.round(remainingCapital * LOAN.rate / 100);
        capitalRepaid = annuity - interest;
        remainingCapital = Math.max(0, remainingCapital - capitalRepaid);
      } else {
        interest = Math.round(amount * LOAN.rate / 100);
      }
      var couponReceived = 0;
      var catInterest = Math.round(catPool * catRate / 100);
      var postCallRev = 0;

      if (autocalled) {
        // Post-autocall: TOUT le capital (1M) + coupons accumulés réinvestis à POST_CALL_RATE
        var totalPool = amount + catPool; // capital + coupons accumulés
        postCallRev = Math.round(totalPool * postCallRate / 100);
        var totalRev = postCallRev;
        // Net = revenue - interest only (capital repayment is not a cost, it reduces debt)
        var net = totalRev - interest;
        var tax = net > 0 ? Math.round(net * LOAN.taxRate / 100) : 0;
        var netAfterTax = net - tax;
        cumulNet += netAfterTax;

        var cashflow = totalRev - interest - capitalRepaid - tax;
        flows.push({
          year: yr, coupon: 0, catInterest: 0, postCallRev: postCallRev,
          totalRev: totalRev, interest: interest, capitalRepaid: capitalRepaid, tax: tax, net: netAfterTax, cashflow: cashflow,
          cumul: cumulNet, roi: cumulNet / amount * 100,
          status: 'Réinvesti ' + _f(totalPool) + '€ à ' + postCallRate + '%',
          color: '#475569'
        });
        continue;
      }

      // Coupon logic — TARN is binary: full coupon or nothing
      var couponPaid = false;
      if (yr <= guaranteed) {
        // Garanti — always paid
        couponReceived = Math.round(amount * coupon / 100);
        couponPaid = true;
      } else if (scenario === 'pessimiste') {
        // Pessimiste: no conditional coupon
        couponReceived = 0;
        couponPaid = false;
      } else if (scenario === 'optimiste') {
        // Optimiste: always paid
        couponReceived = Math.round(amount * coupon / 100);
        couponPaid = true;
      } else {
        // Normal: binary — coupon paid with prob, or not
        // Model: each year independently, coupon = full or 0
        // Use prob to determine expected value but show full coupon × prob as weighted
        // For display: show coupon as full but flag probability
        couponReceived = Math.round(amount * coupon / 100);
        couponPaid = true;
        // Adjust: multiply by prob for net calculation
        couponReceived = Math.round(amount * coupon * scenProb / 100);
      }

      if (couponPaid) cumCoupons += coupon;

      // Check autocall AFTER receiving this year's coupon
      var autocallThisYear = false;
      if (autocallTarget > 0 && cumCoupons >= autocallTarget && !autocalled) {
        autocalled = true;
        autocallYear = yr;
        autocallThisYear = true;
      }

      // Réinvestissement des coupons précédents en CAT
      var totalRev2 = couponReceived + catInterest;
      // Net = revenue - interest only (capital repayment reduces debt, not a P&L cost)
      var net2 = totalRev2 - interest;
      var tax2 = net2 > 0 ? Math.round(net2 * LOAN.taxRate / 100) : 0;
      var netAfterTax2 = net2 - tax2;
      cumulNet += netAfterTax2;

      var statusText = yr <= guaranteed ? 'Garanti (' + guaranteed + ' ans)' :
        (couponPaid ? 'Conditionnel versé' : 'Pas de coupon');
      if (autocallThisYear) statusText = 'Coupon + AUTOCALL → ' + _f(amount + catPool + couponReceived) + '€ réinvesti à ' + postCallRate + '%';
      var statusColor = yr <= guaranteed ? B.green :
        (autocallThisYear ? B.purple : (couponPaid ? '#4ECDC4' : B.red));

      var cashflow2 = totalRev2 - interest - capitalRepaid - tax2;
      flows.push({
        year: yr, coupon: couponReceived, catInterest: catInterest, postCallRev: 0, capitalRepaid: capitalRepaid, cashflow: cashflow2,
        totalRev: totalRev2, interest: interest, tax: tax2, net: netAfterTax2,
        cumul: cumulNet, roi: cumulNet / amount * 100,
        status: statusText,
        color: statusColor
      });

      // Ajouter le coupon au pool CAT pour réinvestissement
      if (couponReceived > 0) catPool += couponReceived;
    }

    var totalCoupons = flows.reduce(function(s, f) { return s + f.coupon; }, 0);
    var totalCatInterest = flows.reduce(function(s, f) { return s + f.catInterest; }, 0);
    var totalPostCall = flows.reduce(function(s, f) { return s + f.postCallRev; }, 0);
    var totalInterest = flows.reduce(function(s, f) { return s + f.interest; }, 0);
    var totalTax = flows.reduce(function(s, f) { return s + f.tax; }, 0);

    return {
      flows: flows,
      totalCoupons: totalCoupons,
      totalCatInterest: totalCatInterest,
      totalPostCall: totalPostCall,
      totalRevenue: totalCoupons + totalCatInterest + totalPostCall,
      totalInterest: totalInterest,
      totalTax: totalTax,
      netAfterTax: cumulNet,
      autocalled: autocalled,
      autocallYear: autocallYear,
      finalCatPool: catPool
    };
  }

  // ─── RENDER PAGE ──────
  var _currentCouponOverride = 0;
  var _currentPostCallOverride = 0;

  function _renderPnLPage(product, customCatRate, customPostCall, customLoanType) {
    var couponRate = product.coupon || 7;
    var catReinvest = customCatRate || CAT_REINVEST;
    var postCallRate = customPostCall || POST_CALL_RATE;
    var loanType = customLoanType || LOAN.type || 'in_fine';
    _currentCouponOverride = catReinvest;
    _currentPostCallOverride = postCallRate;

    var overrides = { catReinvest: catReinvest, postCallRate: postCallRate, loanType: loanType };
    var opti = _simulate(product, 'optimiste', overrides);
    var normal = _simulate(product, 'normal', overrides);
    var pessi = _simulate(product, 'pessimiste', overrides);

    var scenarios = [
      { name: 'Optimiste', key: 'optimiste', data: opti, color: '#059669', bg: '#ECFDF5', border: '#6EE7B7', desc: 'Tous les coupons versés, autocall au plus tôt' },
      { name: 'Normal', key: 'normal', data: normal, color: '#2563EB', bg: '#EFF6FF', border: '#93C5FD', desc: 'Coupon × probabilité historique (' + Math.round(product.prob * 100) + '%)' },
      { name: 'Pessimiste', key: 'pessimiste', data: pessi, color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', desc: 'Seuls les coupons garantis (' + (product.guaranteedYears || 0) + ' ans)' }
    ];

    var h = '';

    // Header
    h += '<div style="margin-bottom:20px">';
    h += '<button class="btn ghost" onclick="switchMainView(\'carry\')" style="margin-bottom:10px">← Retour Carry Trade</button>';
    h += '<h2 style="color:' + B.text + ';font-size:20px;font-weight:800;margin:0">📊 Analyse P&L — ' + product.name + '</h2>';
    var loanLabel = loanType === 'amortissable' ? 'Amortissable' : 'In Fine';
    h += '<div style="color:' + B.muted + ';font-size:12px;margin-top:4px">' + product.emetteur + ' · Coupon ' + couponRate + '% · Emprunt ' + _f(LOAN.amount) + '€ à ' + LOAN.rate + '% <strong style="color:' + (loanType === 'amortissable' ? B.orange : B.text) + '">' + loanLabel + '</strong> · ' + LOAN.years + ' ans · Post-autocall ' + postCallRate + '%</div>';
    h += '</div>';

    // ─── Controls: modulable reinvestment rates ───
    h += '<div style="background:' + B.card + ';border:2px solid ' + B.purple + ';border-radius:10px;padding:16px;margin-bottom:20px">';
    h += '<div style="font-size:13px;font-weight:700;color:' + B.purple + ';margin-bottom:4px">🎛️ Paramètres modulables</div>';
    h += '<div style="font-size:10px;color:' + B.muted + ';margin-bottom:10px">Le coupon du produit est fixe (' + product.coupon + '%). Ici vous modulez les taux de réinvestissement.</div>';
    h += '<div style="display:flex;gap:16px;align-items:end;flex-wrap:wrap">';
    h += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:4px">Type emprunt</label>';
    h += '<select id="pnl-loantype" style="padding:8px 12px;border:1px solid ' + B.border + ';border-radius:6px;font-size:13px;font-weight:700;color:' + B.red + '">';
    h += '<option value="in_fine"' + (loanType === 'in_fine' ? ' selected' : '') + '>In Fine</option>';
    h += '<option value="amortissable"' + (loanType === 'amortissable' ? ' selected' : '') + '>Amortissable</option>';
    h += '</select></div>';
    h += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:4px">Réinvest. coupons (CAT %)</label>';
    h += '<input id="pnl-cat" type="number" step="0.1" value="' + catReinvest + '" style="padding:8px 12px;border:1px solid ' + B.border + ';border-radius:6px;font-size:14px;font-family:var(--mono);width:100px;font-weight:700;color:#4ECDC4"></div>';
    h += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:4px">Réinvest. post-autocall (%)</label>';
    h += '<input id="pnl-postcall" type="number" step="0.1" value="' + postCallRate + '" style="padding:8px 12px;border:1px solid ' + B.border + ';border-radius:6px;font-size:14px;font-family:var(--mono);width:100px;font-weight:700;color:' + B.green + '"></div>';
    h += '<button onclick="__pnlRecalculate()" style="padding:8px 20px;background:' + B.purple + ';color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;height:38px">Recalculer</button>';
    h += '</div></div>';

    // ─── Sensitivity matrix: CAT reinvest rate × post-call rate ───
    var catRates = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
    var postCallRates = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 7.0];

    h += '<div style="background:' + B.card + ';border:1px solid ' + B.border + ';border-radius:10px;padding:16px;margin-bottom:20px">';
    h += '<div style="font-size:13px;font-weight:700;color:' + B.text + ';margin-bottom:4px">📐 Tableau de sensibilité — Net après IS sur ' + LOAN.years + ' ans (optimiste)</div>';
    h += '<div style="font-size:10px;color:' + B.muted + ';margin-bottom:10px">Coupon produit fixe à ' + couponRate + '%. On fait varier les taux de réinvestissement.</div>';
    h += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
    h += '<thead><tr><th style="padding:6px;background:' + B.header + ';color:' + B.muted + ';font-size:10px">CAT réinvest. ↓ \\ Post-autocall →</th>';
    postCallRates.forEach(function(pcr) {
      var isCurrent = Math.abs(pcr - postCallRate) < 0.05;
      h += '<th style="padding:6px;background:' + (isCurrent ? B.purple + '15' : B.header) + ';color:' + (isCurrent ? B.purple : B.muted) + ';font-weight:' + (isCurrent ? '800' : '600') + '">' + pcr.toFixed(1) + '%</th>';
    });
    h += '</tr></thead><tbody>';

    catRates.forEach(function(cr) {
      var isCurrentRow = Math.abs(cr - catReinvest) < 0.05;
      h += '<tr>';
      h += '<td style="padding:6px;font-weight:700;background:' + (isCurrentRow ? B.purple + '15' : B.row1) + ';color:' + (isCurrentRow ? B.purple : '#4ECDC4') + '">CAT ' + cr.toFixed(1) + '%</td>';
      postCallRates.forEach(function(pcr) {
        var sim = _simulate(product, 'optimiste', { catReinvest: cr, postCallRate: pcr });
        var net = sim.netAfterTax;
        var isCurrent = isCurrentRow && Math.abs(pcr - postCallRate) < 0.05;
        var color = net >= 100000 ? B.green : net >= 50000 ? '#4ECDC4' : net >= 0 ? B.orange : B.red;
        h += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:' + (isCurrent ? '800' : '600') + ';color:' + color + ';background:' + (isCurrent ? B.purple + '12' : 'transparent') + ';border:' + (isCurrent ? '2px solid ' + B.purple : '1px solid ' + B.border) + '">' + (net >= 0 ? '+' : '') + _f(net) + '€</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';

    // 3 scenario summary cards
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">';
    scenarios.forEach(function(sc) {
      var d = sc.data;
      h += '<div style="padding:16px;background:' + sc.bg + ';border:2px solid ' + sc.border + ';border-radius:10px">';
      h += '<div style="font-size:13px;font-weight:700;color:' + sc.color + ';margin-bottom:4px">' + sc.name + '</div>';
      h += '<div style="font-size:10px;color:' + B.muted + ';margin-bottom:10px">' + sc.desc + '</div>';
      var annualized = d.netAfterTax / LOAN.years;
      var annualizedPct = d.netAfterTax / LOAN.amount * 100 / LOAN.years;
      h += '<div style="font-size:28px;font-weight:800;color:' + sc.color + '">' + (d.netAfterTax >= 0 ? '+' : '') + _f(d.netAfterTax) + '€</div>';
      h += '<div style="font-size:14px;font-weight:700;color:' + sc.color + ';margin-top:2px">' + (annualized >= 0 ? '+' : '') + _f(annualized) + '€/an · ' + (annualizedPct >= 0 ? '+' : '') + _pct(annualizedPct) + '%/an</div>';
      h += '<div style="font-size:11px;color:' + B.dim + ';margin-top:4px">Net après IS 25% sur ' + LOAN.years + ' ans</div>';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;font-size:10px">';
      h += '<div>Coupons: <strong style="color:' + B.green + '">+' + _f(d.totalCoupons) + '€</strong></div>';
      h += '<div>Intérêts CAT: <strong style="color:#4ECDC4">+' + _f(d.totalCatInterest) + '€</strong></div>';
      if (d.totalPostCall > 0) h += '<div>Post-call: <strong style="color:' + B.orange + '">+' + _f(d.totalPostCall) + '€</strong></div>';
      h += '<div>Intérêts: <strong style="color:' + B.red + '">-' + _f(d.totalInterest) + '€</strong></div>';
      h += '</div>';
      if (loanType === 'amortissable') {
        var totalCapRepaid = d.flows.reduce(function(s, f) { return s + (f.capitalRepaid || 0); }, 0);
        var totalCashOut = d.flows.reduce(function(s, f) { return s + Math.max(0, (f.interest + (f.capitalRepaid || 0)) - f.totalRev); }, 0);
        h += '<div style="margin-top:8px;padding:6px 8px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:4px;font-size:10px">';
        h += '<div style="color:' + B.red + ';font-weight:700">💸 Impact trésorerie (amortissable)</div>';
        h += '<div style="color:#991B1B">Capital remboursé : -' + _f(totalCapRepaid) + '€</div>';
        h += '<div style="color:#991B1B;font-weight:700">Sortie nette tréso : -' + _f(totalCashOut) + '€ sur ' + LOAN.years + ' ans</div>';
        h += '</div>';
      } else {
        h += '<div style="margin-top:8px;padding:4px 8px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:4px;font-size:10px;color:#065F46">';
        h += '✅ <strong>In fine</strong> : 0€ de trésorerie sortie (intérêts couverts par coupons)';
        h += '</div>';
      }
      if (d.autocalled) h += '<div style="margin-top:4px;padding:4px 8px;background:' + sc.color + '15;border-radius:4px;font-size:10px;color:' + sc.color + '">Autocall An ' + d.autocallYear + ' → réinvesti à ' + postCallRate + '%</div>';
      h += '</div>';
    });
    h += '</div>';

    // Params box
    h += '<div style="padding:10px 14px;background:' + B.row1 + ';border-radius:6px;margin-bottom:16px;font-size:11px;color:' + B.muted + ';display:flex;gap:16px;flex-wrap:wrap">';
    h += '<span>Emprunt: <strong>' + _f(LOAN.amount) + '€</strong> à ' + LOAN.rate + '%</span>';
    h += '<span>Réinvestissement coupons: <strong>CAT ' + catReinvest + '%</strong></span>';
    h += '<span>Post-autocall: <strong>' + POST_CALL_RATE + '%</strong></span>';
    h += '<span>IS: <strong>' + LOAN.taxRate + '%</strong></span>';
    h += '<span>Trigger: <strong>' + (product.trigger || '—') + '%</strong></span>';
    h += '<span>Autocall cumul: <strong>' + (product.autocallTarget || '—') + '%</strong></span>';
    h += '</div>';

    // Detailed tables per scenario
    scenarios.forEach(function(sc) {
      var d = sc.data;
      h += '<div style="margin-bottom:20px">';
      h += '<div style="font-size:13px;font-weight:700;color:' + sc.color + ';margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid ' + sc.border + '">' + sc.name.toUpperCase() + ' — Détail année par année</div>';
      h += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
      h += '<thead><tr style="background:' + B.header + '">';
      h += '<th style="padding:6px;text-align:left">An</th>';
      h += '<th style="padding:6px;text-align:left">Statut</th>';
      h += '<th style="padding:6px;text-align:right;color:' + B.green + '">Coupons</th>';
      h += '<th style="padding:6px;text-align:right;color:#4ECDC4">Intérêts CAT</th>';
      if (d.totalPostCall > 0) h += '<th style="padding:6px;text-align:right;color:' + B.orange + '">Post-call</th>';
      h += '<th style="padding:6px;text-align:right;color:' + B.green + '">Total rev.</th>';
      h += '<th style="padding:6px;text-align:right;color:' + B.red + '">Intérêts</th>';
      if (loanType === 'amortissable') h += '<th style="padding:6px;text-align:right;color:' + B.red + '">Amort.</th>';
      h += '<th style="padding:6px;text-align:right;color:' + B.orange + '">IS</th>';
      h += '<th style="padding:6px;text-align:right;font-weight:700">Net</th>';
      h += '<th style="padding:6px;text-align:right;color:' + B.purple + '">Cumul</th>';
      h += '<th style="padding:6px;text-align:right">ROI</th>';
      h += '</tr></thead><tbody>';

      d.flows.forEach(function(f) {
        var bg = f.year % 2 === 0 ? B.row0 : B.row1;
        var netColor = f.net >= 0 ? B.green : B.red;
        h += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + '">';
        h += '<td style="padding:5px 6px;font-weight:700">An ' + f.year + '</td>';
        h += '<td style="padding:5px 6px;font-size:10px;color:' + f.color + '">' + f.status + '</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + B.green + '">' + (f.coupon > 0 ? '+' + _f(f.coupon) + '€' : '—') + '</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#4ECDC4">' + (f.catInterest > 0 ? '+' + _f(f.catInterest) + '€' : '—') + '</td>';
        if (d.totalPostCall > 0) h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + B.orange + '">' + (f.postCallRev > 0 ? '+' + _f(f.postCallRev) + '€' : '—') + '</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + B.green + ';font-weight:600">+' + _f(f.totalRev) + '€</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + B.red + '">-' + _f(f.interest) + '€</td>';
        if (loanType === 'amortissable') {
          h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + B.red + '">' + (f.capitalRepaid > 0 ? '-' + _f(f.capitalRepaid) + '€' : '—') + '</td>';
        }
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + B.orange + '">' + (f.tax > 0 ? '-' + _f(f.tax) + '€' : '—') + '</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + netColor + '">' + (f.net >= 0 ? '+' : '') + _f(f.net) + '€</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + B.purple + ';font-weight:600">' + (f.cumul >= 0 ? '+' : '') + _f(f.cumul) + '€</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-size:10px;color:' + (f.roi >= 0 ? B.green : B.red) + '">' + (f.roi >= 0 ? '+' : '') + _pct(f.roi) + '%</td>';
        h += '</tr>';
      });

      // Total row
      h += '<tr style="background:' + B.header + ';font-weight:700">';
      h += '<td style="padding:8px 6px" colspan="2">TOTAL 5 ANS</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + B.green + '">+' + _f(d.totalCoupons) + '€</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:#4ECDC4">+' + _f(d.totalCatInterest) + '€</td>';
      if (d.totalPostCall > 0) h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + B.orange + '">+' + _f(d.totalPostCall) + '€</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + B.green + '">+' + _f(d.totalRevenue) + '€</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + B.red + '">-' + _f(d.totalInterest) + '€</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + B.orange + '">-' + _f(d.totalTax) + '€</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-size:14px;color:' + (d.netAfterTax >= 0 ? B.green : B.red) + '">' + (d.netAfterTax >= 0 ? '+' : '') + _f(d.netAfterTax) + '€</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + B.purple + '">' + (d.netAfterTax >= 0 ? '+' : '') + _f(d.netAfterTax) + '€</td>';
      h += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono)">' + _pct(d.netAfterTax / LOAN.amount * 100) + '%</td>';
      h += '</tr>';
      h += '</tbody></table></div>';
    });

    // Synthesis
    h += '<div style="padding:16px;background:' + B.card + ';border:2px solid ' + B.border + ';border-radius:10px;margin-bottom:20px">';
    h += '<div style="font-size:14px;font-weight:700;color:' + B.text + ';margin-bottom:10px">📋 Synthèse</div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    h += '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;color:' + B.muted + '">Scénario</td><td style="padding:6px;text-align:right;color:#059669;font-weight:700">Optimiste</td><td style="padding:6px;text-align:right;color:#2563EB;font-weight:700">Normal</td><td style="padding:6px;text-align:right;color:#DC2626;font-weight:700">Pessimiste</td></tr>';
    h += '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px">Net après IS</td><td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(opti.netAfterTax) + '€</td><td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:700;color:#2563EB">+' + _f(normal.netAfterTax) + '€</td><td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:700;color:#DC2626">' + (pessi.netAfterTax >= 0 ? '+' : '') + _f(pessi.netAfterTax) + '€</td></tr>';
    h += '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px">ROI ' + LOAN.years + ' ans</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#059669">+' + _pct(opti.netAfterTax / LOAN.amount * 100) + '%</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#2563EB">+' + _pct(normal.netAfterTax / LOAN.amount * 100) + '%</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#DC2626">' + _pct(pessi.netAfterTax / LOAN.amount * 100) + '%</td></tr>';
    h += '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;font-weight:600">Rendement annualisé</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#059669;font-weight:700">+' + _pct(opti.netAfterTax / LOAN.amount * 100 / LOAN.years) + '%/an</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#2563EB;font-weight:700">+' + _pct(normal.netAfterTax / LOAN.amount * 100 / LOAN.years) + '%/an</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#DC2626;font-weight:700">' + _pct(pessi.netAfterTax / LOAN.amount * 100 / LOAN.years) + '%/an</td></tr>';
    h += '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px">Autocall</td><td style="padding:6px;text-align:right">' + (opti.autocalled ? 'An ' + opti.autocallYear : 'Non') + '</td><td style="padding:6px;text-align:right">' + (normal.autocalled ? 'An ' + normal.autocallYear : 'Non') + '</td><td style="padding:6px;text-align:right">' + (pessi.autocalled ? 'An ' + pessi.autocallYear : 'Non') + '</td></tr>';
    h += '<tr><td style="padding:6px">Intérêts CAT accumulés</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#4ECDC4">+' + _f(opti.totalCatInterest) + '€</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#4ECDC4">+' + _f(normal.totalCatInterest) + '€</td><td style="padding:6px;text-align:right;font-family:var(--mono);color:#4ECDC4">+' + _f(pessi.totalCatInterest) + '€</td></tr>';
    h += '</table>';

    // Espérance pondérée
    var esperance = Math.round(opti.netAfterTax * 0.25 + normal.netAfterTax * 0.50 + pessi.netAfterTax * 0.25);
    h += '<div style="margin-top:12px;padding:10px;background:rgba(37,99,235,0.06);border-radius:6px;font-size:12px;text-align:center">';
    h += '<strong style="color:#2563EB">Espérance pondérée</strong> (25% opti + 50% normal + 25% pessi) = ';
    h += '<strong style="font-size:16px;color:#2563EB">' + (esperance >= 0 ? '+' : '') + _f(esperance) + '€</strong>';
    h += '</div>';
    h += '</div>';

    return h;
  }

  // ─── PUBLIC API ──────
  window.renderCarryPnLPage = function(container, product, customCatRate, customPostCall, customLoanType) {
    container.innerHTML = '<div class="main">' + _renderPnLPage(product, customCatRate, customPostCall, customLoanType) + '</div>';
  };

  window.__pnlRecalculate = function() {
    var catRate = parseFloat(document.getElementById('pnl-cat')?.value) || 3;
    var postCall = parseFloat(document.getElementById('pnl-postcall')?.value) || 4;
    var loanTypeVal = document.getElementById('pnl-loantype')?.value || 'in_fine';
    var product = window._carryPnLProduct;
    if (!product) return;
    var main = document.getElementById('main-content');
    if (main) renderCarryPnLPage(main, product, catRate, postCall, loanTypeVal);
  };

  // Called from carry trade comparison
  window.__carryOpenPnL = function(idx) {
    var products = window._carryImportedForPnL || [];
    var p = products[idx];
    if (!p) { showToast('Produit introuvable', 'error'); return; }
    app.setState({ view: 'carry-pnl' });
    window._carryPnLProduct = p;
    var main = document.getElementById('main-content');
    if (main) renderCarryPnLPage(main, p);
  };

  console.log('[StructBoard] Carry P&L Page loaded');
})();

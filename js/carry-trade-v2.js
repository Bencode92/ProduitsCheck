// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Carry Trade v2 — 5 configurations comparées
// Génère les produits optimaux à partir des taux réels du marché
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Light theme ──────
  var B = {
    wrap: '#F8F9FB', card: '#FFFFFF', input: '#F1F3F7',
    row0: '#FFFFFF', row1: '#F4F6F9', header: '#E8ECF2',
    border: '#D1D9E6', hi: '#E8F0FE',
    text: '#1A202C', muted: '#64748B', dim: '#94A3B8'
  };
  function _f(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }
  function _p(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  // ─── Loan params (SG Equipéa) ──────
  var LOAN = { amount: 1000000, rate: 2.90, years: 5, fees: 1000, taxRate: 25, entity: 'Caméleons Com Mark' };

  // ─── Load market rates ──────
  var MR = { tec10: 3.09, oat5y: 2.66, oat2y: 2.50, bce: 2.00, euribor3m: 2.50, loaded: false };

  async function _loadRates() {
    try {
      var resp = await fetch('data/market/rates.json');
      var data = await resp.json();
      if (data.yields) {
        if (data.yields.oat_fr_10y) MR.tec10 = data.yields.oat_fr_10y.current;
        if (data.yields.oat_fr_5y) MR.oat5y = data.yields.oat_fr_5y.current;
        if (data.yields.oat_fr_2y) MR.oat2y = data.yields.oat_fr_2y.current;
        if (data.yields.euribor_3m) MR.euribor3m = data.yields.euribor_3m.current;
      }
      if (data.policy_rates && data.policy_rates.ecb_deposit_rate) MR.bce = data.policy_rates.ecb_deposit_rate.current;
      MR.loaded = true;
    } catch(e) { /* fallback values */ }
  }

  // ─── Product generator: compute optimal coupon from real rates ──────
  function _budgetOption(rate, years) {
    return 1 - 1 / Math.pow(1 + rate / 100, years);
  }

  function _generateProducts(amount, duration) {
    var rate = duration >= 8 ? MR.tec10 : MR.oat5y;
    var budget = _budgetOption(rate, duration);
    var margin = 0.15; // bank margin ~15% of budget

    // Fixe Callable: budget + swaption premium (~40% extra)
    var fixeBudget = budget * (1 - margin) + budget * 0.40 * (1 - margin);
    var fixeCoupon = Math.round((fixeBudget / duration * 100 + rate) * 100) / 100;
    fixeCoupon = Math.min(fixeCoupon, rate + 2.5); // cap realiste

    // TARN conditionnel: higher coupon because not always paid
    var probCoupon = 0.92; // consensus historique
    var tarnBudget = budget * (1 - margin);
    var tarnCoupon = Math.round((tarnBudget / (duration * probCoupon) * 100 + rate * 0.5) * 100) / 100;
    tarnCoupon = Math.min(tarnCoupon, 9.5); // cap realiste

    // Hybride: floor 3% + bonus conditionnel
    var floor = 3.00;
    var bonusBudget = budget * (1 - margin) - (floor / 100 * duration - budget * 0.5);
    var bonus = Math.max(1.0, Math.round(bonusBudget / duration * 100 * 100) / 100);
    bonus = Math.min(bonus, 4.0);

    // Floater: floor + variable TEC10
    var floaterSpread = Math.round((budget * (1 - margin) / duration * 100 - 0.3) * 100) / 100;
    floaterSpread = Math.max(0.10, Math.min(floaterSpread, 1.0));
    var floaterCurrent = Math.round((floor + Math.max(0, MR.tec10 - 2.20 + floaterSpread)) * 100) / 100;

    return {
      fixe: {
        name: 'Fixe Callable ' + duration + 'Y', type: 'fixe',
        coupon: fixeCoupon, prob: 1.00, duration: duration,
        risk: 'Zero', detail: 'Coupon garanti, capital garanti, callable emetteur',
        color: '#059669'
      },
      tarn: {
        name: 'TARN TEC10 ' + duration + 'Y' + (duration >= 8 ? ' + PUT 5Y' : ''),
        type: 'conditionnel', coupon: tarnCoupon, prob: probCoupon,
        duration: duration, guaranteedYears: duration >= 8 ? 2 : 1,
        risk: 'Faible', detail: 'TEC10 ≤ 4.40%, proba historique 97%, capital garanti',
        color: '#D97706'
      },
      hybride: {
        name: 'Hybride Plancher ' + floor + '% + Bonus ' + duration + 'Y',
        type: 'hybride', coupon: floor + bonus, couponPlancher: floor, couponBonus: bonus,
        prob: 0.93, duration: duration,
        risk: 'Tres faible', detail: 'Plancher ' + floor + '% couvre emprunt, bonus si TEC10 ≤ 4.00%',
        color: '#0891B2'
      },
      floater: {
        name: 'Floater TEC10 Plancher ' + floor + '% ' + duration + 'Y',
        type: 'hybride', coupon: floaterCurrent, couponPlancher: floor,
        couponBonus: floaterCurrent - floor, prob: 0.97, duration: duration,
        risk: 'Tres faible', detail: 'Plancher ' + floor + '% + variable TEC10, monte si taux montent',
        color: '#7C3AED'
      }
    };
  }

  // ─── P&L calculation ──────
  function _computePnL(products, loanAmount, loanRate, years, taxRate) {
    var totalRevenue = 0, totalInterest = 0;
    for (var yr = 1; yr <= years; yr++) {
      var interest = Math.round(loanAmount * loanRate / 100);
      var revenue = 0;
      products.forEach(function(p) {
        var couponEff = p.type === 'fixe' ? p.coupon :
          p.type === 'hybride' ? (p.couponPlancher + p.couponBonus * (p.prob || 0.9)) :
          p.coupon * (p.prob || 0.9);
        revenue += Math.round(p.amount * couponEff / 100);
      });
      totalRevenue += revenue;
      totalInterest += interest;
    }
    var net = totalRevenue - totalInterest;
    var tax = net > 0 ? Math.round(net * taxRate / 100) : 0;
    var netAfterTax = net - tax;

    // Worst case
    var worstRevenue = 0;
    for (var yr2 = 1; yr2 <= years; yr2++) {
      products.forEach(function(p) {
        var worst = p.type === 'fixe' ? p.coupon :
          p.type === 'hybride' ? p.couponPlancher :
          (yr2 <= (p.guaranteedYears || 0) ? p.coupon : 0);
        worstRevenue += Math.round(p.amount * worst / 100);
      });
    }
    var worstNet = worstRevenue - totalInterest;
    var worstTax = worstNet > 0 ? Math.round(worstNet * taxRate / 100) : 0;

    return {
      totalRevenue: totalRevenue, totalInterest: totalInterest,
      netAfterTax: netAfterTax, perYear: Math.round(netAfterTax / years),
      roiPct: Math.round(netAfterTax / loanAmount * 100 * 100) / 100,
      roiAnnual: Math.round(netAfterTax / loanAmount / years * 100 * 100) / 100,
      worstNet: worstNet - worstTax, worstPerYear: Math.round((worstNet - worstTax) / years)
    };
  }

  // ─── Build the 5 configurations ──────
  function _buildConfigs() {
    var p5 = _generateProducts(1000000, 5);
    var p10 = _generateProducts(1000000, 10);
    var L = LOAN;

    var configs = [
      {
        id: 'A', name: '1M × 10Y', emoji: '🏆',
        desc: '1 produit de 1M€ sur 10 ans — max coupon avec PUT sortie à 5 ans',
        products: [Object.assign({}, p10.tarn, { amount: L.amount })],
        highlight: true
      },
      {
        id: 'B', name: '1M × 5Y', emoji: '🛡️',
        desc: '1 produit de 1M€ sur 5 ans — matche l\'emprunt, coupon garanti ou hybride',
        products: [Object.assign({}, p5.fixe, { amount: L.amount })]
      },
      {
        id: 'C', name: '2 × 500K × 5Y', emoji: '⚖️',
        desc: '2 produits 500K sur 5 ans — 1 rendement + 1 sécurisé, diversification',
        products: [
          Object.assign({}, p5.hybride, { amount: 500000 }),
          Object.assign({}, p5.floater, { amount: 500000 })
        ]
      },
      {
        id: 'D', name: '2 × 500K × 10Y', emoji: '🚀',
        desc: '2 produits 500K sur 10 ans — max coupon ×2 avec PUT à 5 ans',
        products: [
          Object.assign({}, p10.tarn, { amount: 500000 }),
          Object.assign({}, p10.hybride, { amount: 500000 })
        ]
      },
      {
        id: 'E', name: '500K 5Y + 500K 10Y', emoji: '🎯',
        desc: 'Mix durées — 1 produit 5 ans sécurisé + 1 produit 10 ans rendement',
        products: [
          Object.assign({}, p5.fixe, { amount: 500000 }),
          Object.assign({}, p10.tarn, { amount: 500000 })
        ]
      }
    ];

    // Compute P&L for each
    configs.forEach(function(c) {
      c.pnl = _computePnL(c.products, L.amount, L.rate, L.years, L.taxRate);
    });

    // Sort by net P&L desc
    configs.sort(function(a, b) { return b.pnl.netAfterTax - a.pnl.netAfterTax; });
    return configs;
  }

  // ═══ RENDER ═══════════════════════════════════════════════════════════════════
  function _render(container) {
    var configs = _buildConfigs();
    var L = LOAN;
    var best = configs[0];

    var html = '<div style="background:' + B.wrap + ';border-radius:12px;padding:20px;color:' + B.text + '">';

    // ─── Header ──────
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid ' + B.border + '">';
    html += '<div style="font-size:16px;font-weight:800">🏦 Carry Trade — 5 Configurations</div>';
    html += '<div style="font-size:10px;color:' + B.dim + '">Taux du jour : TEC10 ' + _p(MR.tec10) + '% · OAT 5Y ' + _p(MR.oat5y) + '% · Euribor ' + _p(MR.euribor3m) + '%</div>';
    html += '</div>';

    // ─── Loan compact ──────
    html += '<div style="display:flex;gap:12px;margin-bottom:16px;font-size:11px">';
    html += '<div style="flex:1;padding:10px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px">✅ <strong>Prêt SG Equipéa</strong> : ' + _f(L.amount) + '€ à ' + L.rate + '% in fine ' + L.years + ' ans · Crédit en blanc · ' + L.entity + '</div>';
    html += '<div style="padding:10px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:6px">Coût : <strong>-' + _f(Math.round(L.amount * L.rate / 100 * L.years)) + '€</strong> intérêts · -' + _f(L.fees) + '€ frais</div>';
    html += '</div>';

    // ─── 5 configs comparison table ──────
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;background:' + B.card + ';border:1px solid ' + B.border + ';border-radius:8px;overflow:hidden">';
    html += '<thead><tr style="background:' + B.header + '">';
    html += '<th style="padding:10px 8px;text-align:left;color:' + B.muted + ';font-size:10px;width:35%">CONFIGURATION</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">RDT NET/AN</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">GAIN 5 ANS</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#D97706;font-size:10px">PIRE CAS 5A</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#7C3AED;font-size:10px">PROBA COUPON</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#0891B2;font-size:10px">RISQUE</th>';
    html += '</tr></thead><tbody>';

    configs.forEach(function(c, i) {
      var isBest = i === 0;
      var bg = isBest ? '#DCFCE7' : (i % 2 === 0 ? B.row0 : B.row1);
      var avgProb = c.products.reduce(function(s, p) { return s + (p.prob || 1); }, 0) / c.products.length;
      var maxRisk = c.products.reduce(function(r, p) { return p.type === 'fixe' ? r : p.risk; }, 'Zero');

      html += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + ';cursor:pointer" onclick="__carryV2Detail(\'' + c.id + '\')">';
      // Config name + products
      html += '<td style="padding:10px 8px">';
      html += '<div style="font-size:13px;font-weight:700;color:' + B.text + '">' + c.emoji + ' ' + c.name + (isBest ? ' <span style="background:#059669;color:#fff;padding:1px 6px;border-radius:3px;font-size:8px">BEST</span>' : '') + '</div>';
      html += '<div style="font-size:9px;color:' + B.dim + ';margin-top:2px">' + c.desc + '</div>';
      html += '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">';
      c.products.forEach(function(p) {
        html += '<span style="padding:2px 6px;border-radius:3px;font-size:8px;font-weight:600;background:' + p.color + '15;color:' + p.color + ';border:1px solid ' + p.color + '33">' + _f(p.amount / 1000) + 'K · ' + p.name.substring(0, 25) + ' · ' + p.coupon + '%</span>';
      });
      html += '</div></td>';
      // Rdt net/an
      html += '<td style="padding:10px 8px;text-align:center;font-family:var(--mono);font-weight:800;font-size:14px;color:' + (c.pnl.roiAnnual >= 0 ? '#059669' : '#DC2626') + '">+' + _p(c.pnl.roiAnnual) + '%</td>';
      // Gain 5 ans
      html += '<td style="padding:10px 8px;text-align:center;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(c.pnl.netAfterTax) + '€</td>';
      // Pire cas
      html += '<td style="padding:10px 8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (c.pnl.worstNet >= 0 ? '#059669' : '#DC2626') + '">' + (c.pnl.worstNet >= 0 ? '+' : '') + _f(c.pnl.worstNet) + '€</td>';
      // Proba coupon
      html += '<td style="padding:10px 8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (avgProb >= 0.9 ? '#059669' : '#D97706') + '">' + Math.round(avgProb * 100) + '%</td>';
      // Risque
      var riskColor = maxRisk === 'Zero' ? '#059669' : maxRisk === 'Tres faible' ? '#0891B2' : '#D97706';
      html += '<td style="padding:10px 8px;text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:9px;font-weight:600;background:' + riskColor + '15;color:' + riskColor + '">' + maxRisk + '</span></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    // ─── Detail panel (opens on click) ──────
    html += '<div id="carry-v2-detail"></div>';

    // ─── Products detail for each config ──────
    html += '<div style="font-size:13px;font-weight:700;color:' + B.text + ';margin:16px 0 10px">📦 Détail des produits générés</div>';
    configs.forEach(function(c) {
      html += '<div style="background:' + B.card + ';border:1px solid ' + B.border + ';border-radius:8px;padding:12px;margin-bottom:8px">';
      html += '<div style="font-size:12px;font-weight:700;color:' + B.text + ';margin-bottom:8px">' + c.emoji + ' ' + c.name + ' — Gain net : <span style="color:#059669">+' + _f(c.pnl.netAfterTax) + '€</span></div>';
      html += '<div style="display:grid;grid-template-columns:repeat(' + c.products.length + ',1fr);gap:8px">';
      c.products.forEach(function(p) {
        var espere = p.type === 'fixe' ? p.coupon : p.type === 'hybride' ? (p.couponPlancher + p.couponBonus * (p.prob || 0.9)) : p.coupon * (p.prob || 0.9);
        html += '<div style="padding:10px;border:1px solid ' + p.color + '33;border-radius:6px;border-left:3px solid ' + p.color + '">';
        html += '<div style="font-size:11px;font-weight:700;color:' + p.color + '">' + p.name + '</div>';
        html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + p.color + ';margin:4px 0">' + p.coupon + '%</div>';
        html += '<div style="font-size:9px;color:' + B.muted + '">' + _f(p.amount) + '€ · ' + p.duration + ' ans · proba ' + Math.round((p.prob || 1) * 100) + '%</div>';
        html += '<div style="font-size:9px;color:' + B.dim + ';margin-top:3px">' + (p.detail || '') + '</div>';
        html += '<div style="margin-top:6px;padding:4px 6px;background:' + B.row1 + ';border-radius:3px;font-size:9px">';
        html += 'Coupon espéré : <strong style="color:#059669">' + _p(espere) + '%</strong> · ';
        html += 'Spread vs emprunt : <strong style="color:' + (espere > LOAN.rate ? '#059669' : '#DC2626') + '">' + (espere > LOAN.rate ? '+' : '') + _p(espere - LOAN.rate) + '%</strong>';
        html += '</div></div>';
      });
      html += '</div></div>';
    });

    // ─── P&L year by year for best config ──────
    html += '<div style="background:' + B.card + ';border:2px solid #059669;border-radius:8px;padding:14px;margin-top:16px">';
    html += '<div style="font-size:13px;font-weight:700;color:#059669;margin-bottom:10px">📋 P&L année par année — ' + best.emoji + ' ' + best.name + ' (meilleur rendement)</div>';

    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:' + B.header + '">';
    html += '<th style="padding:8px;text-align:left;color:' + B.muted + '">AN</th>';
    best.products.forEach(function(p) {
      html += '<th style="padding:8px;text-align:right;color:' + p.color + '">' + p.name.substring(0, 20) + '</th>';
    });
    html += '<th style="padding:8px;text-align:right;color:#059669">TOTAL REV.</th>';
    html += '<th style="padding:8px;text-align:right;color:#DC2626">INTÉRÊTS</th>';
    html += '<th style="padding:8px;text-align:right;color:#D97706">IS 25%</th>';
    html += '<th style="padding:8px;text-align:right;color:' + B.text + ';font-weight:700">NET</th>';
    html += '<th style="padding:8px;text-align:right;color:#7C3AED">CUMUL</th>';
    html += '</tr></thead><tbody>';

    var cumul = 0;
    var annualInterest = Math.round(LOAN.amount * LOAN.rate / 100);
    for (var yr = 1; yr <= LOAN.years; yr++) {
      var bg = yr % 2 === 0 ? B.row0 : B.row1;
      var totalRev = 0;
      html += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + '">';
      html += '<td style="padding:6px 8px;font-weight:600">An ' + yr + '</td>';
      best.products.forEach(function(p) {
        var couponEff = p.type === 'fixe' ? p.coupon :
          p.type === 'hybride' ? (p.couponPlancher + p.couponBonus * (p.prob || 0.9)) :
          (yr <= (p.guaranteedYears || 0) ? p.coupon : p.coupon * (p.prob || 0.9));
        var rev = Math.round(p.amount * couponEff / 100);
        totalRev += rev;
        html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:' + p.color + '">+' + _f(rev) + '€</td>';
      });
      var netBefore = totalRev - annualInterest;
      var tax = netBefore > 0 ? Math.round(netBefore * LOAN.taxRate / 100) : 0;
      var net = netBefore - tax;
      cumul += net;
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#059669">+' + _f(totalRev) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _f(annualInterest) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#D97706">-' + _f(tax) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:' + (net >= 0 ? '#059669' : '#DC2626') + '">' + (net >= 0 ? '+' : '') + _f(net) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:#7C3AED">' + (cumul >= 0 ? '+' : '') + _f(cumul) + '€</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // Override the carry simulator render
  var _origRender = window.renderCarrySimulator;
  window.renderCarrySimulator = async function(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B">Calcul des configurations optimales...</div>';
    await _loadRates();
    _render(container);
  };

  console.log('[StructBoard] Carry Trade v2 loaded — 5 configurations');
})();

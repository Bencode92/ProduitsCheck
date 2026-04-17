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

  // ─── Product generator: realistic products from real market curves ──────
  function _budgetOption(rate, years) {
    return 1 - 1 / Math.pow(1 + rate / 100, years);
  }

  function _generateProducts(amount, duration) {
    var swapRate = duration >= 8 ? MR.tec10 : MR.oat5y;
    var budget = _budgetOption(swapRate, duration);
    var margin = 0.15;
    var net = budget * (1 - margin);

    // ─── TARN TEC10: le produit phare ──────
    // Coupon = swap + spread (3-4% sur les taux longs grace au budget option)
    // Realiste: CIC propose TARN a ~6-7% sur TEC10, confirme par les RDV banquiers
    var tarnCoupon = Math.round((swapRate + 3.5) * 10) / 10; // swap + 3.5% de prime
    tarnCoupon = Math.max(5.5, Math.min(tarnCoupon, 7.5));
    var tarnAutocall = Math.round(tarnCoupon * 4); // autocall en ~4 ans
    var tarnGuaranteed = 2; // 2 premieres annees garanties (standard CIC/SG)

    // ─── Fixe Callable: coupon garanti, callable emetteur ──────
    // Realiste: swap + 1-1.5% (swaption premium)
    var fixeCoupon = Math.round((swapRate + 1.3) * 10) / 10;
    fixeCoupon = Math.max(3.5, Math.min(fixeCoupon, 5.5));

    // ─── Hybride: plancher 3% + bonus digital si TEC10 ≤ 4.00% ──────
    var floor = 3.00;
    var bonusBudget = (net * 100 / duration) - (floor * 0.3);
    var bonus = Math.round(Math.max(1.5, Math.min(bonusBudget, 4.0)) * 10) / 10;

    // ─── Floater: plancher 3% + variable indexe TEC10 ──────
    var floaterCurrent = Math.round((floor + Math.max(0, MR.tec10 - 2.00)) * 100) / 100;

    return {
      tarn: {
        name: 'TARN TEC10 ' + tarnCoupon + '% ' + duration + 'Y' + (duration >= 8 ? ' + PUT 5Y' : ''),
        type: 'conditionnel', coupon: tarnCoupon, prob: 0.97,
        duration: duration, guaranteedYears: tarnGuaranteed,
        autocallTarget: tarnAutocall, autocallYears: Math.ceil(tarnAutocall / tarnCoupon),
        risk: 'Faible',
        detail: 'Coupon ' + tarnCoupon + '%/an · Garanti An 1-2 · Conditionnel si TEC10 ≤ 4.40% (proba 97% sur 20 ans) · Autocall si cumul ≥ ' + tarnAutocall + '% (~' + Math.ceil(tarnAutocall / tarnCoupon) + ' ans) · Capital garanti 100%' + (duration >= 8 ? ' · PUT sortie a 100% a 5 ans' : ''),
        color: '#D97706'
      },
      fixe: {
        name: 'Fixe Callable ' + fixeCoupon + '% ' + duration + 'Y',
        type: 'fixe', coupon: fixeCoupon, prob: 1.00,
        duration: duration, guaranteedYears: duration,
        risk: 'Zero',
        detail: 'Coupon ' + fixeCoupon + '% GARANTI chaque annee · Capital garanti 100% · Callable emetteur des An ' + (duration >= 8 ? 3 : 1) + ' (rappel si taux baissent)',
        color: '#059669'
      },
      hybride: {
        name: 'Hybride ' + floor + '% + ' + bonus + '% ' + duration + 'Y',
        type: 'hybride', coupon: floor + bonus, couponPlancher: floor, couponBonus: bonus,
        prob: 0.93, duration: duration, guaranteedYears: 0,
        risk: 'Tres faible',
        detail: 'Plancher ' + floor + '% GARANTI (couvre le 2.90% emprunt) + Bonus ' + bonus + '% si TEC10 ≤ 4.00% (proba ~93%) · Capital garanti 100%',
        color: '#0891B2'
      },
      floater: {
        name: 'Floater Plancher ' + floor + '% + TEC10 ' + duration + 'Y',
        type: 'hybride', coupon: floaterCurrent, couponPlancher: floor,
        couponBonus: Math.round((floaterCurrent - floor) * 100) / 100, prob: 0.97,
        duration: duration, guaranteedYears: 0,
        risk: 'Tres faible',
        detail: 'Plancher ' + floor + '% GARANTI + variable = max(' + floor + '%, TEC10 - 2.00%) · Auj ' + floaterCurrent + '% · Si TEC10 monte a 4% → ' + (floor + 2.0).toFixed(1) + '% · Capital garanti 100%',
        color: '#7C3AED'
      }
    };
  }

  // ─── P&L calculation with autocall + reinvestment ──────
  var CAT_REINVEST_RATE = 3.00; // taux de reinvestissement post-autocall (CAT ou nouveau produit)

  function _computePnL(products, loanAmount, loanRate, years, taxRate) {
    var totalRevenue = 0, totalInterest = 0;
    var flows = []; // year by year detail
    var autocalled = {}; // track which products have autocalled

    for (var yr = 1; yr <= years; yr++) {
      var interest = Math.round(loanAmount * loanRate / 100);
      var revenue = 0;
      var flowDetail = { year: yr, products: [], totalRev: 0, interest: interest };

      products.forEach(function(p, pi) {
        var key = pi;
        if (!autocalled[key]) autocalled[key] = { called: false, calledYear: 0, cumul: 0 };
        var ac = autocalled[key];

        if (ac.called) {
          // Post-autocall: reinvest at CAT rate
          var reinvRev = Math.round(p.amount * CAT_REINVEST_RATE / 100);
          revenue += reinvRev;
          flowDetail.products.push({ name: p.name + ' (réinvesti CAT ' + CAT_REINVEST_RATE + '%)', rev: reinvRev, color: '#94A3B8' });
          return;
        }

        var couponEff = 0;
        if (p.type === 'fixe') {
          couponEff = p.coupon;
        } else if (p.type === 'hybride') {
          couponEff = p.couponPlancher + p.couponBonus * (p.prob || 0.9);
        } else {
          // Conditionnel (TARN)
          if (yr <= (p.guaranteedYears || 0)) {
            couponEff = p.coupon; // garanti
          } else {
            couponEff = p.coupon * (p.prob || 0.9); // conditionnel × proba
          }
        }
        var rev = Math.round(p.amount * couponEff / 100);
        revenue += rev;
        flowDetail.products.push({ name: p.name, rev: rev, color: p.color });

        // Check autocall
        if (p.autocallTarget && p.type === 'conditionnel') {
          ac.cumul += couponEff;
          if (ac.cumul >= p.autocallTarget) {
            ac.called = true;
            ac.calledYear = yr;
          }
        }
      });

      flowDetail.totalRev = revenue;
      var netBefore = revenue - interest;
      var tax = netBefore > 0 ? Math.round(netBefore * taxRate / 100) : 0;
      flowDetail.tax = tax;
      flowDetail.net = netBefore - tax;
      totalRevenue += revenue;
      totalInterest += interest;
      flows.push(flowDetail);
    }

    var net = totalRevenue - totalInterest;
    var tax = net > 0 ? Math.round(net * taxRate / 100) : 0;
    var netAfterTax = net - tax;

    // Worst case: guaranteed coupons only, post-autocall at CAT rate
    var worstRevenue = 0;
    var worstAC = {};
    for (var yr2 = 1; yr2 <= years; yr2++) {
      products.forEach(function(p, pi) {
        if (!worstAC[pi]) worstAC[pi] = { called: false, cumul: 0 };
        var wac = worstAC[pi];
        if (wac.called) {
          worstRevenue += Math.round(p.amount * CAT_REINVEST_RATE / 100);
          return;
        }
        var worst = p.type === 'fixe' ? p.coupon :
          p.type === 'hybride' ? p.couponPlancher :
          (yr2 <= (p.guaranteedYears || 0) ? p.coupon : 0);
        worstRevenue += Math.round(p.amount * worst / 100);
        // Worst case autocall: only guaranteed coupons count
        if (p.autocallTarget && yr2 <= (p.guaranteedYears || 0)) {
          wac.cumul += p.coupon;
          if (wac.cumul >= p.autocallTarget) wac.called = true;
        }
      });
    }
    var worstNet = worstRevenue - totalInterest;
    var worstTax = worstNet > 0 ? Math.round(worstNet * taxRate / 100) : 0;

    return {
      totalRevenue: totalRevenue, totalInterest: totalInterest,
      netAfterTax: netAfterTax, perYear: Math.round(netAfterTax / years),
      roiPct: Math.round(netAfterTax / loanAmount * 100 * 100) / 100,
      roiAnnual: Math.round(netAfterTax / loanAmount / years * 100 * 100) / 100,
      worstNet: worstNet - worstTax, worstPerYear: Math.round((worstNet - worstTax) / years),
      flows: flows
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

  // ═══ RENDER — 3 blocs: PRODUITS → DISCUSSION → ANALYSER ═══
  var _configs = null;

  function _render(container) {
    _configs = _buildConfigs();
    var L = LOAN;

    var html = '<div style="background:' + B.wrap + ';border-radius:12px;padding:20px;color:' + B.text + '">';

    // ─── Header + Emprunt ──────
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html += '<div style="font-size:16px;font-weight:800">🏦 Carry Trade — Configurations & P&L</div>';
    html += '<div style="font-size:10px;color:' + B.dim + '">TEC10 ' + _p(MR.tec10) + '% · OAT5Y ' + _p(MR.oat5y) + '% · Euribor ' + _p(MR.euribor3m) + '%</div>';
    html += '</div>';
    html += '<div style="padding:8px 12px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;font-size:11px;margin-bottom:20px">';
    html += '✅ <strong>Prêt SG Equipéa</strong> ' + _f(L.amount) + '€ à ' + L.rate + '% in fine ' + L.years + ' ans · Coût total <strong style="color:#DC2626">-' + _f(Math.round(L.amount * L.rate / 100 * L.years + L.fees)) + '€</strong> · Crédit en blanc · ' + L.entity;
    html += '</div>';

    // ═══ BLOC 1 : PRODUITS — Tableau comparatif des 5 configs ═══
    html += '<div style="background:' + B.card + ';border:1px solid ' + B.border + ';border-radius:8px;padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:14px;font-weight:800;color:' + B.text + ';margin-bottom:12px">📦 PRODUITS — 5 configurations comparées</div>';

    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:' + B.header + ';border-bottom:2px solid ' + B.border + '">';
    html += '<th style="padding:10px 8px;text-align:left;color:' + B.muted + ';font-size:10px">CONFIG</th>';
    html += '<th style="padding:10px 8px;text-align:left;color:' + B.muted + ';font-size:10px">PRODUIT(S)</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">RDT/AN</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">GAIN 5A</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#D97706;font-size:10px">PIRE CAS</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#7C3AED;font-size:10px">PROBA</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:' + B.muted + ';font-size:10px"></th>';
    html += '</tr></thead><tbody>';

    _configs.forEach(function(c, i) {
      var isBest = i === 0;
      var bg = isBest ? '#DCFCE7' : (i % 2 === 0 ? B.row0 : B.row1);
      var avgProb = c.products.reduce(function(s, p) { return s + (p.prob || 1); }, 0) / c.products.length;

      html += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + '">';
      html += '<td style="padding:8px;font-weight:700;white-space:nowrap">' + c.emoji + ' ' + c.name + (isBest ? ' <span style="background:#059669;color:#fff;padding:1px 5px;border-radius:3px;font-size:7px">BEST</span>' : '') + '</td>';
      // Products column
      html += '<td style="padding:8px">';
      c.products.forEach(function(p) {
        html += '<div style="font-size:9px;margin-bottom:2px"><span style="color:' + p.color + ';font-weight:700">' + p.name.substring(0, 30) + '</span> <span style="color:' + B.dim + '">' + _f(p.amount / 1000) + 'K · ' + p.coupon + '%</span></div>';
      });
      html += '</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:800;font-size:13px;color:#059669">+' + _p(c.pnl.roiAnnual) + '%</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(c.pnl.netAfterTax) + '€</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (c.pnl.worstNet >= 0 ? '#059669' : '#DC2626') + '">' + (c.pnl.worstNet >= 0 ? '+' : '') + _f(c.pnl.worstNet) + '€</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (avgProb >= 0.9 ? '#059669' : '#D97706') + '">' + Math.round(avgProb * 100) + '%</td>';
      html += '<td style="padding:8px;text-align:center"><button onclick="__carryV2Select(\'' + c.id + '\')" style="padding:4px 10px;border:1px solid #2563EB;border-radius:4px;background:' + (isBest ? '#2563EB' : '#fff') + ';color:' + (isBest ? '#fff' : '#2563EB') + ';font-size:9px;font-weight:700;cursor:pointer">Analyser →</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';

    // ═══ BLOC 2 : DISCUSSION — Détail de la config sélectionnée ═══
    html += '<div id="carry-v2-discussion" style="background:' + B.card + ';border:1px solid ' + B.border + ';border-radius:8px;padding:16px;margin-bottom:16px">';
    html += '<div style="text-align:center;padding:20px;color:' + B.dim + ';font-size:12px">👆 Cliquez "Analyser" sur une configuration pour voir le détail des produits</div>';
    html += '</div>';

    // ═══ BLOC 3 : ANALYSER — P&L année par année ═══
    html += '<div id="carry-v2-pnl" style="background:' + B.card + ';border:1px solid ' + B.border + ';border-radius:8px;padding:16px">';
    html += '<div style="text-align:center;padding:20px;color:' + B.dim + ';font-size:12px">Le P&L détaillé s\'affiche quand vous sélectionnez une configuration</div>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;

    // Auto-select best config
    __carryV2Select(_configs[0].id);
  }

  // ─── Select a config: update Discussion + P&L ──────
  window.__carryV2Select = function(configId) {
    if (!_configs) return;
    var c = _configs.find(function(x) { return x.id === configId; });
    if (!c) return;

    // ─── DISCUSSION: product details ──────
    var disc = document.getElementById('carry-v2-discussion');
    if (disc) {
      var h = '<div style="font-size:14px;font-weight:800;color:' + B.text + ';margin-bottom:12px">💬 DISCUSSION — ' + c.emoji + ' ' + c.name + '</div>';
      h += '<div style="font-size:10px;color:' + B.dim + ';margin-bottom:12px">' + c.desc + '</div>';
      h += '<div style="display:grid;grid-template-columns:repeat(' + c.products.length + ',1fr);gap:10px">';
      c.products.forEach(function(p) {
        var espere = p.type === 'fixe' ? p.coupon : p.type === 'hybride' ? (p.couponPlancher + p.couponBonus * (p.prob || 0.9)) : p.coupon * (p.prob || 0.9);
        h += '<div style="padding:14px;border:2px solid ' + p.color + '33;border-radius:8px;border-top:4px solid ' + p.color + '">';
        h += '<div style="font-size:12px;font-weight:700;color:' + p.color + '">' + p.name + '</div>';
        h += '<div style="font-family:var(--mono);font-size:24px;font-weight:800;color:' + p.color + ';margin:6px 0">' + p.coupon + '%</div>';
        h += '<div style="font-size:10px;color:' + B.text + ';line-height:1.5">';
        h += '<strong>' + _f(p.amount) + '€</strong> · ' + p.duration + ' ans · Capital garanti 100%<br>';
        h += 'Proba coupon : <strong style="color:#059669">' + Math.round((p.prob || 1) * 100) + '%</strong> (historique 20 ans)<br>';
        if (p.guaranteedYears) h += 'Coupon garanti : <strong>An 1' + (p.guaranteedYears >= 2 ? '-' + p.guaranteedYears : '') + '</strong><br>';
        if (p.autocallTarget) h += 'Autocall : cumul ≥ ' + p.autocallTarget + '% (~' + p.autocallYears + ' ans) → réinvesti 3% CAT<br>';
        h += '</div>';
        h += '<div style="margin-top:8px;padding:6px 8px;background:' + B.row1 + ';border-radius:4px;font-size:10px">';
        h += 'Coupon espéré <strong style="color:#059669">' + _p(espere) + '%</strong> · Spread <strong style="color:' + (espere > LOAN.rate ? '#059669' : '#DC2626') + '">' + (espere > LOAN.rate ? '+' : '') + _p(espere - LOAN.rate) + '%</strong> vs emprunt';
        h += '</div>';
        h += '<div style="margin-top:6px;font-size:9px;color:' + B.dim + ';line-height:1.4">' + (p.detail || '') + '</div>';
        h += '</div>';
      });
      h += '</div>';

      // Summary KPIs
      h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">';
      [
        ['GAIN NET 5 ANS', '+' + _f(c.pnl.netAfterTax) + '€', '#059669'],
        ['RENDEMENT NET/AN', '+' + _p(c.pnl.roiAnnual) + '%', '#059669'],
        ['PIRE CAS 5 ANS', (c.pnl.worstNet >= 0 ? '+' : '') + _f(c.pnl.worstNet) + '€', c.pnl.worstNet >= 0 ? '#059669' : '#DC2626'],
        ['PIRE CAS/AN', (c.pnl.worstPerYear >= 0 ? '+' : '') + _f(c.pnl.worstPerYear) + '€', c.pnl.worstPerYear >= 0 ? '#059669' : '#DC2626']
      ].forEach(function(kpi) {
        h += '<div style="padding:10px;background:' + B.row1 + ';border-radius:6px;text-align:center">';
        h += '<div style="font-size:8px;font-weight:700;color:' + B.dim + ';letter-spacing:0.5px">' + kpi[0] + '</div>';
        h += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:' + kpi[2] + ';margin-top:4px">' + kpi[1] + '</div>';
        h += '</div>';
      });
      h += '</div>';
      disc.innerHTML = h;
    }

    // ─── P&L: year by year ──────
    var pnlEl = document.getElementById('carry-v2-pnl');
    if (pnlEl && c.pnl.flows) {
      var p = '<div style="font-size:14px;font-weight:800;color:#7C3AED;margin-bottom:12px">📋 ANALYSER — P&L ' + c.emoji + ' ' + c.name + '</div>';

      p += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
      p += '<thead><tr style="background:' + B.header + '">';
      p += '<th style="padding:8px;text-align:left;color:' + B.muted + '">AN</th>';
      p += '<th style="padding:8px;text-align:left;color:' + B.muted + '">DÉTAIL PRODUITS</th>';
      p += '<th style="padding:8px;text-align:right;color:#059669">REVENUS</th>';
      p += '<th style="padding:8px;text-align:right;color:#DC2626">INTÉRÊTS</th>';
      p += '<th style="padding:8px;text-align:right;color:#D97706">IS 25%</th>';
      p += '<th style="padding:8px;text-align:right;font-weight:700;color:' + B.text + '">NET</th>';
      p += '<th style="padding:8px;text-align:right;color:#7C3AED">CUMUL</th>';
      p += '<th style="padding:8px;text-align:right;color:#7C3AED">ROI</th>';
      p += '</tr></thead><tbody>';

      var cumul = 0;
      c.pnl.flows.forEach(function(f, fi) {
        cumul += f.net;
        var roiCumul = (cumul / LOAN.amount * 100);
        var bg = fi % 2 === 0 ? B.row0 : B.row1;
        p += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + '">';
        p += '<td style="padding:6px 8px;font-weight:700;font-size:12px">An ' + f.year + '</td>';
        p += '<td style="padding:6px 8px">';
        f.products.forEach(function(fp) {
          var isR = fp.color === '#94A3B8';
          p += '<div style="font-size:9px;color:' + (isR ? '#94A3B8' : fp.color) + ';' + (isR ? 'font-style:italic' : '') + '">' + fp.name.substring(0, 35) + ' → <strong>+' + _f(fp.rev) + '€</strong></div>';
        });
        p += '</td>';
        p += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(f.totalRev) + '€</td>';
        p += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _f(f.interest) + '€</td>';
        p += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#D97706">-' + _f(f.tax) + '€</td>';
        p += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:800;color:' + (f.net >= 0 ? '#059669' : '#DC2626') + '">' + (f.net >= 0 ? '+' : '') + _f(f.net) + '€</td>';
        p += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:#7C3AED">' + (cumul >= 0 ? '+' : '') + _f(cumul) + '€</td>';
        p += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:#7C3AED">' + (roiCumul >= 0 ? '+' : '') + _p(roiCumul) + '%</td>';
        p += '</tr>';
      });
      p += '</tbody></table>';
      pnlEl.innerHTML = p;
    }

    // Highlight selected button
    document.querySelectorAll('[onclick^="__carryV2Select"]').forEach(function(btn) {
      var isThis = btn.getAttribute('onclick').indexOf(configId) >= 0;
      btn.style.background = isThis ? '#2563EB' : '#fff';
      btn.style.color = isThis ? '#fff' : '#2563EB';
    });
  };


  // Override the carry simulator render
  var _origRender = window.renderCarrySimulator;
  window.renderCarrySimulator = async function(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B">Calcul des configurations optimales...</div>';
    await _loadRates();
    _render(container);
  };

  console.log('[StructBoard] Carry Trade v2 loaded — 5 configurations');
})();

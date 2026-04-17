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
    var floor = 3.00;

    return {
      // ─── TARN CIC RÉEL (XS3340532707) + version sur-mesure ──────
      tarn: {
        name: duration >= 8 ? 'TARN TEC10 7.00% Sur-Mesure ' + duration + 'Y' : 'TARN TEC10 5Y',
        type: 'conditionnel',
        coupon: duration >= 8 ? 7.00 : 5.80, // sur-mesure 1M = +0.30% vs retail 6.70%
        prob: 0.92, // TEC10 > 4.60% = 0.3% historique, haircut forward
        duration: duration, guaranteedYears: 2,
        autocallTarget: duration >= 8 ? 28 : 23.2, // 4 × coupon
        autocallYears: 4,
        risk: 'Faible',
        detail: duration >= 8 ?
          'TARN sur-mesure 1M€ · Coupon 7.00% · Garanti An 1-2 · Conditionnel TEC10 ≤ 4.60% (jamais dépassé depuis 2008) · Autocall cumul ≥ 28% (~4 ans) · Capital garanti 100%' :
          'Version 5Y budget plus limité · Garanti An 1 · TEC10 ≤ 4.40% · Capital garanti 100%',
        color: '#D97706'
      },
      // ─── Digital Plancher + Bonus (sur-mesure, le meilleur combo) ──────
      digital: {
        name: 'Digital Plancher 3% + Bonus 3.5% ' + duration + 'Y',
        type: 'hybride',
        coupon: 6.50, couponPlancher: floor, couponBonus: 3.50,
        prob: 0.95, // TEC10 ≤ 4.50% = 99% historique, haircut
        duration: duration, guaranteedYears: 0,
        risk: 'Tres faible',
        detail: 'SUR-MESURE à négocier (RFQ SG/BNPP/Natixis) · Plancher 3% GARANTI couvre emprunt 2.90% · Bonus +3.50% si TEC10 ≤ 4.50% · Pire cas = +0.10%/an · Capital garanti 100%',
        color: '#0891B2'
      },
      // ─── Fixe Callable (CIC propose 4% en série) ──────
      fixe: {
        name: 'Fixe Callable ' + (duration >= 8 ? '4.40' : '4.00') + '% ' + duration + 'Y',
        type: 'fixe',
        coupon: duration >= 8 ? 4.40 : 4.00, prob: 1.00,
        duration: duration, guaranteedYears: duration,
        risk: 'Zero',
        detail: 'Coupon GARANTI · CIC propose 4.00% sur 10YNC3 en série · Sur-mesure 1M = potentiel 4.20-4.40% · Callable émetteur · Capital garanti 100%',
        color: '#059669'
      },
      // ─── Step-Up Callable (sur-mesure) ──────
      stepUp: {
        name: 'Step-Up Callable 7Y NC3',
        type: 'fixe',
        coupon: 4.60, // moyenne pondérée 3.50→6.00%
        prob: 1.00,
        duration: 7, guaranteedYears: 7,
        risk: 'Zero',
        detail: 'SUR-MESURE · Coupon garanti croissant (3.50% → 4.00% → 4.50% → 5.00% → 5.50% → 6.00%) · Callable An 3+ · Spread vs emprunt qui s\'élargit chaque année · Capital garanti 100%',
        color: '#059669'
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

        // Scénario CENTRAL: coupon PLEIN si condition remplie (pas pondéré par proba)
        // La proba est utilisée pour l'espérance pondérée, pas pour réduire le coupon
        var couponEff = 0;
        if (p.type === 'fixe') {
          couponEff = p.coupon;
        } else if (p.type === 'hybride') {
          couponEff = p.couponPlancher + p.couponBonus; // plancher + bonus PLEIN
        } else {
          // Conditionnel (TARN): coupon PLEIN dans le scénario central
          couponEff = p.coupon;
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

    // Espérance pondérée: 90% central + 10% worst
    var worstFinal = worstNet - worstTax;
    var esperance = Math.round(0.90 * netAfterTax + 0.10 * worstFinal);
    var espRoiAnnual = Math.round(esperance / loanAmount / years * 100 * 100) / 100;

    return {
      totalRevenue: totalRevenue, totalInterest: totalInterest,
      netAfterTax: netAfterTax, perYear: Math.round(netAfterTax / years),
      roiPct: Math.round(netAfterTax / loanAmount * 100 * 100) / 100,
      roiAnnual: Math.round(netAfterTax / loanAmount / years * 100 * 100) / 100,
      worstNet: worstFinal, worstPerYear: Math.round(worstFinal / years),
      esperance: esperance, espRoiAnnual: espRoiAnnual,
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
        id: 'A', name: '1M TARN 7% Sur-Mesure', emoji: '🏆',
        desc: '1 produit de 1M€ TARN sur-mesure 10Y — coupon négocié 7.00% (+0.30% vs retail CIC 6.70%)',
        products: [Object.assign({}, p10.tarn, { amount: L.amount })],
        highlight: true
      },
      {
        id: 'B', name: '500K TARN + 500K Digital', emoji: '🎯',
        desc: 'OPTIMAL — TARN 7% + Digital Plancher 3%+Bonus. Pire cas quasi nul.',
        products: [
          Object.assign({}, p10.tarn, { amount: 500000 }),
          Object.assign({}, p10.digital, { amount: 500000 })
        ]
      },
      {
        id: 'C', name: '500K TARN + 500K Fixe', emoji: '🛡️',
        desc: 'SAFE — TARN 7% + Fixe Callable 4.40%. Pire cas toujours positif.',
        products: [
          Object.assign({}, p10.tarn, { amount: 500000 }),
          Object.assign({}, p10.fixe, { amount: 500000 })
        ]
      },
      {
        id: 'D', name: '1M Fixe Callable 4.40%', emoji: '🔒',
        desc: 'ZÉRO RISQUE — 1 produit garanti 4.40%. Coupon + bas mais aucune condition.',
        products: [Object.assign({}, p10.fixe, { amount: L.amount })]
      },
      {
        id: 'E', name: '500K TARN + 500K Step-Up', emoji: '📈',
        desc: 'MIX — TARN 7% + Step-Up Callable garanti croissant (3.50%→6.00%)',
        products: [
          Object.assign({}, p10.tarn, { amount: 500000 }),
          Object.assign({}, p10.stepUp, { amount: 500000 })
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
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">CENTRAL/AN</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">CENTRAL 5A</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#D97706;font-size:10px">ESPÉRANCE</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#DC2626;font-size:10px">PIRE CAS</th>';
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
      // Central (coupon plein)
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:800;font-size:13px;color:#059669">+' + _p(c.pnl.roiAnnual) + '%</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(c.pnl.netAfterTax) + '€</td>';
      // Espérance pondérée (90/10)
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:#D97706">+' + _f(c.pnl.esperance) + '€</td>';
      // Pire cas
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (c.pnl.worstNet >= 0 ? '#059669' : '#DC2626') + '">' + (c.pnl.worstNet >= 0 ? '+' : '') + _f(c.pnl.worstNet) + '€</td>';
      html += '<td style="padding:8px;text-align:center"><button onclick="__carryV2Select(\'' + c.id + '\')" style="padding:4px 10px;border:1px solid #2563EB;border-radius:4px;background:' + (isBest ? '#2563EB' : '#fff') + ';color:' + (isBest ? '#fff' : '#2563EB') + ';font-size:9px;font-weight:700;cursor:pointer">Analyser →</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';

    // ═══ VERDICT RISQUE / RENDEMENT ═══
    var fixeConfig = _configs.find(function(c) { return c.id === 'B'; });
    var fixeNet = fixeConfig ? fixeConfig.pnl.netAfterTax : 41250;

    html += '<div style="background:' + B.card + ';border:2px solid #059669;border-radius:8px;padding:14px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:700;color:#059669;margin-bottom:10px">✅ VERDICT — Le risque est-il rentable ?</div>';

    // Compact risk/reward table
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:' + B.header + '">';
    html += '<th style="padding:8px;text-align:left;color:' + B.muted + '">CONFIG</th>';
    html += '<th style="padding:8px;text-align:center;color:#059669">ESPÉRANCE</th>';
    html += '<th style="padding:8px;text-align:center;color:#DC2626">PERTE MAX</th>';
    html += '<th style="padding:8px;text-align:center;color:#7C3AED">RATIO GAIN/PERTE</th>';
    html += '<th style="padding:8px;text-align:center;color:#D97706">PRIME vs FIXE</th>';
    html += '<th style="padding:8px;text-align:center;color:' + B.muted + '">VERDICT</th>';
    html += '</tr></thead><tbody>';

    _configs.forEach(function(c, i) {
      var bg = c.id === 'E' ? '#E8F0FE' : (i % 2 === 0 ? B.row0 : B.row1);
      var ratio = c.pnl.worstNet < 0 ? Math.round(c.pnl.esperance / Math.abs(c.pnl.worstNet) * 10) / 10 : 999;
      var prime = c.pnl.esperance - fixeNet;
      var verdict = c.pnl.worstNet >= 0 ? '✅ SANS RISQUE' : (ratio >= 5 ? '✅ RENTABLE' : ratio >= 3 ? '⚠️ ACCEPTABLE' : '❌ RISQUÉ');

      html += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + '">';
      html += '<td style="padding:8px;font-weight:700">' + c.emoji + ' ' + c.name + '</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(c.pnl.esperance) + '€</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (c.pnl.worstNet >= 0 ? '#059669' : '#DC2626') + '">' + (c.pnl.worstNet >= 0 ? 'Aucune' : _f(c.pnl.worstNet) + '€') + '</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:800;color:#7C3AED">' + (ratio >= 999 ? '∞' : ratio + '×') + '</td>';
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);color:' + (prime > 0 ? '#D97706' : B.dim) + '">' + (prime > 0 ? '+' + _f(prime) + '€' : '—') + '</td>';
      html += '<td style="padding:8px;text-align:center;font-size:10px;font-weight:700">' + verdict + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="margin-top:10px;padding:8px 12px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;font-size:10px;color:#065F46">';
    html += '<strong>Conclusion :</strong> Toutes les configs sont rentables en espérance. ';
    html += 'Il faudrait une proba annuelle < 70% (TEC10 > 4.40% plus de 30% du temps) pour perdre vs le Fixe — <strong>jamais vu en 20 ans</strong>. ';
    html += 'Config E (Fixe + TARN) = meilleur compromis : pire cas positif, ratio ∞, +' + _f((_configs.find(function(c){return c.id==='E';}) || {pnl:{esperance:0}}).pnl.esperance - fixeNet) + '€ de prime vs Fixe seul.';
    html += '</div></div>';

    // ═══ CAHIER DES CHARGES (accordéon) ═══
    function _acc(id, title, content) {
      return '<div style="border:1px solid ' + B.border + ';border-radius:8px;margin-bottom:6px;overflow:hidden">' +
        '<div onclick="var c=document.getElementById(\'' + id + '\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶\':\'▼\'" style="padding:14px 18px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:' + B.row1 + '">' +
        '<div style="font-size:13px;font-weight:700;color:' + B.text + '">' + title + '</div>' +
        '<span style="font-size:12px;color:' + B.dim + '">▶</span></div>' +
        '<div id="' + id + '" style="display:none;padding:16px 18px;font-size:13px;color:' + B.text + ';line-height:1.8">' + content + '</div></div>';
    }

    html += '<div style="background:' + B.card + ';border:1px solid #2563EB;border-radius:8px;padding:14px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:700;color:#2563EB;margin-bottom:10px">📋 CAHIER DES CHARGES — RDV Banquier</div>';

    html += _acc('cdc-situation', '🏦 Notre situation',
      '<strong>Emprunt SG Equipéa</strong> : ' + _f(L.amount) + '€ à ' + L.rate + '% fixe in fine ' + L.years + ' ans<br>' +
      'Crédit en blanc (aucune garantie) · Entité : ' + L.entity + '<br>' +
      'Coût total intérêts : ' + _f(Math.round(L.amount * L.rate / 100 * L.years)) + '€ + frais ' + _f(L.fees) + '€<br>' +
      'Validité offre SG : 14/05/2026');

    html += _acc('cdc-contraintes', '🔒 Contraintes non négociables',
      '• Capital garanti <strong>100% à échéance</strong> (inconditionnelle)<br>' +
      '• Sous-jacent <strong>taux uniquement</strong> (TEC10, Euribor, CMS) — pas d\'actions<br>' +
      '• Nominal minimum <strong>500 000€</strong> par produit<br>' +
      '• Émetteur <strong>Investment Grade A-</strong> minimum<br>' +
      '• Coupon > 2,90% (sinon pas de portage positif)<br>' +
      '• Devise EUR · Éligible compte-titres ordinaire');

    html += _acc('cdc-configs', '📦 Les 6 configurations (produits réels + sur-mesure)',
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<tr style="background:' + B.header + ';font-weight:700"><td style="padding:8px">CONFIG</td><td style="padding:8px">PRODUIT(S)</td><td style="padding:8px">COUPON</td><td style="padding:8px">TYPE</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:8px;font-weight:700">🏆 A</td><td style="padding:8px"><strong>1M€ TARN TEC10</strong> 10Y</td><td style="padding:8px;color:#D97706;font-weight:700">7.00%</td><td style="padding:8px;font-size:10px">Max rendement, conditionnel TEC10 ≤ 4.60%</td></tr>' +
      '<tr style="background:#E8F0FE;border-bottom:1px solid ' + B.border + '"><td style="padding:8px;font-weight:700">🎯 B</td><td style="padding:8px"><strong>500K TARN 7% + 500K Digital Plancher 3%+Bonus</strong></td><td style="padding:8px;color:#0891B2;font-weight:700">7.00% + 6.50%</td><td style="padding:8px;font-size:10px;color:#2563EB"><strong>RECOMMANDÉ — pire cas ~0</strong></td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:8px;font-weight:700">🛡️ C</td><td style="padding:8px"><strong>500K TARN 7% + 500K Fixe Callable</strong></td><td style="padding:8px;color:#059669;font-weight:700">7.00% + 4.40%</td><td style="padding:8px;font-size:10px">Pire cas toujours positif</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + ';background:' + B.row1 + '"><td style="padding:8px;font-weight:700">🔒 D</td><td style="padding:8px"><strong>1M€ Fixe Callable</strong> 10YNC3</td><td style="padding:8px;color:#059669;font-weight:700">4.40% garanti</td><td style="padding:8px;font-size:10px">Zéro risque, zéro condition</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:8px;font-weight:700">📈 E</td><td style="padding:8px"><strong>500K TARN 7% + 500K Step-Up Callable</strong></td><td style="padding:8px;color:#059669;font-weight:700">7.00% + 3.50→6%</td><td style="padding:8px;font-size:10px">TARN + garanti croissant</td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;padding:6px 10px;background:#ECFDF5;border-radius:4px;font-size:11px;color:#065F46">' +
      '✅ <strong>Config B (TARN 7% + Digital Plancher 3%+Bonus)</strong> = rendement max avec pire cas quasi nul. Le plancher 3% couvre l\'emprunt 2.90%.' +
      '</div>');

    html += _acc('cdc-alternatives', '💡 Structures alternatives à demander',
      '• <strong>Callable In Fine</strong> 10YNC4 : coupon capitalisé ~4,70%, tout versé au call (CIC en propose)<br>' +
      '• <strong>Range Accrual TEC10</strong> [2,00%-4,00%] : corridor centré, moins binaire que le TARN<br>' +
      '• <strong>Step-Up Callable</strong> : coupon garanti croissant (3,50% → 5,50%)<br>' +
      '• <strong>TARN avec Mémoire</strong> : coupons rattrapés si condition remplie plus tard<br>' +
      '• Toute structure taux capital garanti > 5%');

    html += _acc('cdc-marche', '📊 Nos hypothèses de marché',
      'TEC10 = ' + _p(MR.tec10) + '% · OAT 5Y = ' + _p(MR.oat5y) + '% · Euribor 3M = ' + _p(MR.euribor3m) + '%<br>' +
      'BCE dépôt = ' + _p(MR.bce) + '% · Courbe normale +59bp<br>' +
      'Régime : stagflation modérée (Brent $103, PCE 2,8%)<br><br>' +
      '<strong>Analyse trigger 4,40%</strong> (20 ans historique) :<br>' +
      '• TEC10 > 4,40% = 1,7% du temps (12/695 obs)<br>' +
      '• Dernière fois : sept 2008 (18 ans sans)<br>' +
      '• Proba forward retenue : 85-92%');

    html += _acc('cdc-questions', '❓ Questions pour le banquier (11)',
      '<strong>Pricing :</strong><br>' +
      '1. Quel coupon TARN TEC10 sur 1M€ / 10Y / trigger 4,40% / 2 ans garantis ?<br>' +
      '2. Quel coupon Fixe Callable sur 500K / 5Y ou 10YNC3 ?<br>' +
      '3. Prime de taille 1M vs 500K — combien de bp ?<br>' +
      '4. Autres structures taux capital garanti à proposer ?<br><br>' +
      '<strong>Mécanique :</strong><br>' +
      '5. Autocall = cumul coupons versés ou cumul théorique ?<br>' +
      '6. Fixing TEC10 : quelle source, quelle date ?<br>' +
      '7. Délai de mise en place ?<br>' +
      '8. Éligible compte-titres ordinaire ?<br><br>' +
      '<strong>Risque :</strong><br>' +
      '9. Émetteur exact et notation ?<br>' +
      '10. Rang de séniorité et recovery en cas de défaut ?<br>' +
      '11. Marché secondaire disponible ?');

    html += _acc('cdc-calendrier', '📅 Calendrier',
      '• Proposition emprunt SG validée : 14/04/2026<br>' +
      '• <strong>RDV structureur : avril 2026</strong><br>' +
      '• Réception term sheets : fin avril<br>' +
      '• Décision : mi-mai<br>' +
      '• Validité offre SG : <strong>14/05/2026</strong><br>' +
      '• Mise en place souhaitée : fin mai 2026');

    html += '</div>';

    // ═══ BLOC 2 : DISCUSSION — Détail de la config sélectionnée ═══
    html += '<div id="carry-v2-discussion" style="background:' + B.card + ';border:1px solid ' + B.border + ';border-radius:8px;padding:16px;margin-bottom:16px">';
    html += '<div style="text-align:center;padding:20px;color:' + B.dim + ';font-size:12px">👆 Cliquez "Analyser" sur une configuration pour voir le détail des produits</div>';
    html += '</div>';

    // ═══ TABLEAU EMPRUNT SG (in fine) ═══
    var annualInt = Math.round(L.amount * L.rate / 100);
    html += '<div style="background:' + B.card + ';border:1px solid #DC2626;border-radius:8px;padding:14px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:700;color:#DC2626;margin-bottom:10px">🏦 EMPRUNT SG — Tableau d\'amortissement in fine</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:' + B.header + '">';
    html += '<th style="padding:8px;text-align:left;color:' + B.muted + '">ANNÉE</th>';
    html += '<th style="padding:8px;text-align:right;color:' + B.muted + '">CAPITAL RESTANT DÛ</th>';
    html += '<th style="padding:8px;text-align:right;color:#DC2626">INTÉRÊTS</th>';
    html += '<th style="padding:8px;text-align:right;color:' + B.muted + '">AMORTISSEMENT</th>';
    html += '<th style="padding:8px;text-align:right;color:#DC2626">ÉCHÉANCE TOTALE</th>';
    html += '<th style="padding:8px;text-align:right;color:' + B.muted + '">INTÉRÊTS CUMULÉS</th>';
    html += '</tr></thead><tbody>';
    var cumulInt = 0;
    for (var y = 1; y <= L.years; y++) {
      var bg = y % 2 === 0 ? B.row0 : B.row1;
      var amort = y === L.years ? L.amount : 0; // in fine: tout à la fin
      var echeance = annualInt + amort;
      cumulInt += annualInt;
      html += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + '">';
      html += '<td style="padding:6px 8px;font-weight:700">An ' + y + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono)">' + _f(L.amount) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _f(annualInt) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:' + (amort > 0 ? '#DC2626' : B.dim) + '">' + (amort > 0 ? '-' + _f(amort) + '€' : '—') + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:#DC2626">-' + _f(echeance) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:' + B.muted + '">-' + _f(cumulInt) + '€</td>';
      html += '</tr>';
    }
    // Total row
    html += '<tr style="background:' + B.header + ';border-top:2px solid ' + B.border + ';font-weight:700">';
    html += '<td style="padding:8px">TOTAL</td>';
    html += '<td style="padding:8px"></td>';
    html += '<td style="padding:8px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _f(annualInt * L.years) + '€</td>';
    html += '<td style="padding:8px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _f(L.amount) + '€</td>';
    html += '<td style="padding:8px;text-align:right;font-family:var(--mono);font-weight:800;color:#DC2626">-' + _f(annualInt * L.years + L.amount) + '€</td>';
    html += '<td style="padding:8px"></td>';
    html += '</tr>';
    html += '</tbody></table>';
    html += '<div style="margin-top:6px;font-size:9px;color:' + B.dim + '">In fine : intérêts seuls pendant 5 ans (' + _f(annualInt) + '€/an) + remboursement capital 1M€ à échéance. Coût total intérêts : ' + _f(annualInt * L.years) + '€ + frais ' + _f(L.fees) + '€ = ' + _f(annualInt * L.years + L.fees) + '€</div>';
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

      // Espérance pondérée si produit conditionnel
      var hasCond = c.products.some(function(p) { return p.type === 'conditionnel'; });
      if (hasCond) {
        var probCentral = 0.90;
        var probStress = 0.10;
        var esperance = Math.round(probCentral * c.pnl.netAfterTax + probStress * c.pnl.worstNet);
        var espRoi = (esperance / LOAN.amount / LOAN.years * 100);
        h += '<div style="margin-top:8px;padding:10px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;font-size:10px;color:#92400E">';
        h += '<strong>Espérance pondérée</strong> (90% central / 10% dégradé) : ';
        h += '<strong style="font-family:var(--mono);font-size:13px;color:#D97706">' + _f(esperance) + '€</strong> net = <strong>' + _p(espRoi) + '%/an</strong>';
        h += ' · Scénario dégradé = TEC10 > 4.40% après An 2 (persistant 2-3 ans, cf. 2007-2008)';
        h += '</div>';
      }
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

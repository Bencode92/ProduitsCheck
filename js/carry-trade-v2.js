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
    text: '#1A202C', muted: '#64748B', dim: '#475569'
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
      // ─── Digital Plancher + Bonus + AUTOCALL (sur-mesure) ──────
      digital: {
        name: 'Digital Plancher 3% + Bonus 3.2% ' + duration + 'Y',
        type: 'hybride',
        coupon: 6.20, couponPlancher: floor, couponBonus: 3.20,
        prob: 0.95,
        duration: duration, guaranteedYears: 0,
        autocallTarget: 25, autocallYears: 4, // ~4 ans à 6.20%
        risk: 'Tres faible',
        detail: 'SUR-MESURE à négocier · Plancher 3% GARANTI (couvre emprunt 2.90%) · Bonus +3.20% si TEC10 ≤ 4.50% · Autocall si cumul ≥ 25% (~4 ans) · Sortie An 4 = capital récupéré pour rembourser emprunt · Pire cas = 3%/an garanti · Capital garanti 100%',
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
          flowDetail.products.push({ name: p.name + ' (réinvesti CAT ' + CAT_REINVEST_RATE + '%)', rev: reinvRev, color: '#475569' });
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
        id: 'A', name: '500K TARN 7% + 500K Digital Plancher+Autocall', emoji: '🏆',
        desc: 'RECOMMANDÉ — Les 2 produits sortent en ~4 ans via autocall. Le plancher 3% du Digital couvre l\'emprunt 2.90%. Pire cas quasi nul. Rendement max.',
        products: [
          Object.assign({}, p10.tarn, { amount: 500000 }),
          Object.assign({}, p10.digital, { amount: 500000 })
        ],
        highlight: true
      },
      {
        id: 'B', name: '1M TARN 7% Sur-Mesure', emoji: '🎯',
        desc: 'MAX RENDEMENT — 1 seul produit, tout sur le TARN. Coupon 7% sur 1M€. Autocall ~4 ans. Risque : si TEC10 > 4.60% après An 2, coupon 0% (mais capital garanti).',
        products: [Object.assign({}, p10.tarn, { amount: L.amount })]
      },
      {
        id: 'C', name: '500K TARN 7% + 500K Fixe Callable 4.40%', emoji: '🛡️',
        desc: 'SAFE — Le Fixe 4.40% est garanti quoi qu\'il arrive. Le TARN booste le rendement. Pire cas toujours positif.',
        products: [
          Object.assign({}, p10.tarn, { amount: 500000 }),
          Object.assign({}, p10.fixe, { amount: 500000 })
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
    html += '<div style="font-size:14px;font-weight:800;color:' + B.text + ';margin-bottom:12px">📦 PRODUITS — 3 configurations</div>';

    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:' + B.header + ';border-bottom:2px solid ' + B.border + '">';
    html += '<th style="padding:10px 8px;text-align:left;color:' + B.muted + ';font-size:10px">CONFIG</th>';
    html += '<th style="padding:10px 8px;text-align:left;color:' + B.muted + ';font-size:10px">PRODUIT(S)</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">CENTRAL/AN</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#059669;font-size:10px">BEST CASE 5A</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#D97706;font-size:10px">ESPÉRANCE 5A</th>';
    html += '<th style="padding:10px 8px;text-align:center;color:#DC2626;font-size:10px">WORST CASE 5A</th>';
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
        html += '<div style="font-size:11px;margin-bottom:2px"><span style="color:' + p.color + ';font-weight:700">' + p.name.substring(0, 30) + '</span> <span style="color:' + B.dim + '">' + _f(p.amount / 1000) + 'K · ' + p.coupon + '%</span></div>';
      });
      html += '</td>';
      // Central/an
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:800;font-size:13px;color:#059669">+' + _p(c.pnl.roiAnnual) + '%</td>';
      // Best case = central (coupon plein, autocall An 4)
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(c.pnl.netAfterTax) + '€</td>';
      // Espérance pondérée
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:#D97706">+' + _f(c.pnl.esperance) + '€</td>';
      // Worst case
      html += '<td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (c.pnl.worstNet >= 0 ? '#059669' : '#DC2626') + '">' + (c.pnl.worstNet >= 0 ? '+' : '') + _f(c.pnl.worstNet) + '€</td>';
      html += '<td style="padding:8px;text-align:center"><button onclick="__carryV2Select(\'' + c.id + '\')" style="padding:4px 10px;border:1px solid #2563EB;border-radius:4px;background:' + (isBest ? '#2563EB' : '#fff') + ';color:' + (isBest ? '#fff' : '#2563EB') + ';font-size:11px;font-weight:700;cursor:pointer">Analyser →</button></td>';
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

    html += _acc('cdc-script', '🎤 Script de présentation — Ce qu\'on dit au banquier',
      '<div style="padding:14px;background:#F8F9FB;border:1px solid ' + B.border + ';border-radius:8px;font-size:13px;color:#1A202C;line-height:1.8;font-style:italic">' +
      '"Nous avons reçu une <strong>proposition d\'emprunt de trésorerie</strong> de la Société Générale : ' + _f(L.amount) + '€ à ' + L.rate + '% fixe, in fine sur ' + L.years + ' ans, crédit en blanc. L\'offre est validée et expire le 14 mai.<br><br>' +
      'On souhaite utiliser cet emprunt pour faire du <strong>carry trade</strong> : placer le million sur des produits structurés de taux, capital garanti, qui rapportent plus que le 2,90% de l\'emprunt. La différence c\'est notre gain.<br><br>' +
      'L\'avantage pour nous c\'est qu\'on <strong>investit sans toucher à notre trésorerie propre</strong>. Le capital est garanti à 100%, l\'emprunt est in fine (on ne paye que les intérêts de 29 000€/an pendant 5 ans), et les produits structurés génèrent des coupons de 6 à 7% sur le TEC10.<br><br>' +
      'On a déjà <strong>reçu des propositions de plusieurs banques</strong> — notamment un TARN TEC10 du CIC à 6,70% (ISIN XS3340532707). On cherche à faire mieux en sur-mesure sur 500K à 1M€.<br><br>' +
      'Concrètement, on a <strong>3 configurations</strong> en tête :"' +
      '</div>' +
      '<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
      '<div style="padding:10px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px">' +
      '<div style="font-size:11px;font-weight:700;color:#D97706">🏆 Option A — RECOMMANDÉE</div>' +
      '<div style="font-size:11px;color:#1A202C;margin-top:4px">500K TARN 7% + 500K Digital Plancher 3% avec autocall. Les 2 sortent en ~4 ans. Le plancher couvre l\'emprunt.</div></div>' +
      '<div style="padding:10px;background:#EFF6FF;border:1px solid #93C5FD;border-radius:6px">' +
      '<div style="font-size:11px;font-weight:700;color:#2563EB">🎯 Option B — MAX RENDEMENT</div>' +
      '<div style="font-size:11px;color:#1A202C;margin-top:4px">1M€ tout sur un TARN TEC10 7%. Autocall ~4 ans. Maximum de coupon.</div></div>' +
      '<div style="padding:10px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px">' +
      '<div style="font-size:11px;font-weight:700;color:#059669">🛡️ Option C — SAFE</div>' +
      '<div style="font-size:11px;color:#1A202C;margin-top:4px">500K TARN 7% + 500K Fixe Callable 4,40% garanti. Pire cas toujours positif.</div></div>' +
      '</div>' +
      '<div style="margin-top:10px;padding:12px;background:#F8F9FB;border:1px solid ' + B.border + ';border-radius:8px;font-size:12px;color:#1A202C;line-height:1.7;font-style:italic">' +
      '"On est ouverts sur le <strong>format</strong> — on veut voir ce qui est le plus compétitif :<br><br>' +
      '• <strong>2 produits de 500K€ sur 10 ans</strong> — pour diversifier et combiner rendement + sécurité<br>' +
      '• <strong>1 seul produit de 1M€ sur 10 ans</strong> — si le pricing est meilleur sur un gros nominal<br>' +
      '• <strong>2 produits de 500K€ sur 5 ans</strong> — si vous avez des structures 5 ans compétitives qui matchent l\'emprunt<br>' +
      '• <strong>1 produit 500K 5 ans + 1 produit 500K 10 ans</strong> — pour mixer sécurité court terme et rendement long terme<br><br>' +
      'On privilégie le <strong>10 ans</strong> pour le budget option plus important, avec <strong>autocall vers An 4</strong> pour récupérer le capital et rembourser l\'emprunt. Mais si vous avez mieux en 5 ans, on est preneurs.<br><br>' +
      'L\'essentiel c\'est : <strong>capital garanti 100%</strong>, sous-jacent taux, coupon au-dessus de notre emprunt à 2,90%."' +
      '</div>' +
      '<div style="margin-top:10px;padding:12px;background:#EFF6FF;border:1px solid #93C5FD;border-radius:8px;font-size:12px;color:#1E40AF;line-height:1.7;font-style:italic">' +
      '"On consulte <strong>plusieurs établissements</strong> en parallèle. Qu\'est-ce que vous pouvez nous proposer de compétitif ? Et est-ce que vous avez un <strong>PUT investisseur à 5 ans</strong> comme filet de sécurité sur le produit 10 ans ?"' +
      '</div>');

    html += _acc('cdc-contexte', '🏦 Contexte détaillé',
      '<strong>Emprunt SG Equipéa :</strong> ' + _f(L.amount) + '€ à ' + L.rate + '% fixe in fine ' + L.years + ' ans · Crédit en blanc · ' + L.entity + '<br>' +
      'Coût total intérêts : ' + _f(Math.round(L.amount * L.rate / 100 * L.years)) + '€ + frais ' + _f(L.fees) + '€ · Validité : 14/05/2026<br><br>' +
      '<strong>Pourquoi le carry trade :</strong><br>' +
      '• On emprunte à 2,90% fixe et on place à 6-7% sur des structurés taux → la différence est notre gain<br>' +
      '• In fine = le capital reste investi à 100% pendant 5 ans (pas d\'amortissement)<br>' +
      '• Capital garanti 100% = pas de risque de perte sur le nominal<br>' +
      '• La trésorerie propre n\'est pas mobilisée — c\'est l\'emprunt qui finance l\'investissement<br><br>' +
      '<strong>Contraintes non négociables :</strong><br>' +
      '• Capital garanti <strong>100% à échéance</strong> (inconditionnelle)<br>' +
      '• Sous-jacent <strong>taux uniquement</strong> (TEC10, Euribor, CMS) — pas d\'actions<br>' +
      '• Nominal minimum <strong>500 000€</strong> par produit<br>' +
      '• Émetteur <strong>Investment Grade A-</strong> minimum<br>' +
      '• Coupon > 2,90% (sinon pas de portage positif)<br>' +
      '• Devise EUR · Éligible compte-titres ordinaire');

    html += _acc('cdc-produit1', '🎯 PRODUIT 1 — TARN TEC10 sur-mesure (500K ou 1M€)',
      '<div style="padding:10px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;margin-bottom:10px;font-size:12px;color:#92400E">' +
      '<strong>Référence :</strong> CIC propose déjà un TARN TEC10 en série à 6,70% (XS3340532707). Sur un nominal de 500K-1M€ en sur-mesure, nous ciblons <strong>7,00%</strong> minimum.</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;color:#64748B;width:35%">Coupon cible</td><td style="padding:6px;font-weight:700;color:#D97706">≥ 7,00%/an</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + ';background:' + B.row1 + '"><td style="padding:6px;color:#64748B">Condition</td><td style="padding:6px">TEC10 ≤ <strong>4,60%</strong> à la date de constatation annuelle</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;color:#64748B">Coupons garantis</td><td style="padding:6px"><strong>An 1 + An 2</strong> (inconditionnels)</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + ';background:' + B.row1 + '"><td style="padding:6px;color:#64748B">Autocall</td><td style="padding:6px">Si cumul coupons versés ≥ <strong>28%</strong></td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;color:#64748B">Maturité</td><td style="padding:6px"><strong>10 ans</strong> (sortie probable ~4 ans via autocall)</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + ';background:' + B.row1 + '"><td style="padding:6px;color:#64748B">Capital</td><td style="padding:6px"><strong>Garanti 100%</strong> à l\'échéance (inconditionnelle)</td></tr>' +
      '<tr><td style="padding:6px;color:#64748B">Nominal</td><td style="padding:6px"><strong>500 000€ ou 1 000 000€</strong></td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;font-size:11px;color:#1A202C"><strong>Argument de négo :</strong> Le CIC affiche 6,70% en retail (100K unitaire). Sur 500K-1M en sur-mesure, la marge banque passe de ~20% à ~15% du budget option → au moins +0,30% de coupon redistribuable.</div>');

    html += _acc('cdc-produit2', '💎 PRODUIT 2 — Digital Plancher 3% + Bonus + Autocall (500K€, SUR-MESURE)',
      '<div style="padding:10px;background:#DBEAFE;border:1px solid #93C5FD;border-radius:6px;margin-bottom:10px;font-size:12px;color:#1E40AF">' +
      '<strong>Ce produit n\'existe pas en série — à structurer sur-mesure.</strong> On combine : plancher garanti (comme un Fixe) + bonus conditionnel (comme une Digitale) + autocall (comme un TARN) pour récupérer le capital et rembourser l\'emprunt.</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;color:#64748B;width:35%">Plancher garanti</td><td style="padding:6px;font-weight:700;color:#059669">3,00%/an INCONDITIONNEL (couvre emprunt 2,90%)</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + ';background:' + B.row1 + '"><td style="padding:6px;color:#64748B">Bonus conditionnel</td><td style="padding:6px;font-weight:700;color:#0891B2">+3,20% si TEC10 ≤ 4,50% (bonus réduit de 0,30% pour financer l\'autocall)</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;color:#64748B">Coupon total espéré</td><td style="padding:6px;font-weight:700;color:#D97706">6,20% (plancher 3% + bonus 3,2%)</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + ';background:' + B.row1 + '"><td style="padding:6px;color:#64748B">Autocall</td><td style="padding:6px;font-weight:700;color:#D97706">Si cumul coupons ≥ 25% (~4 ans à 6,20%) → capital récupéré pour rembourser emprunt SG</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:6px;color:#64748B">Pire cas</td><td style="padding:6px;font-weight:700;color:#059669">3,00% GARANTI → carry positif (+0,10% vs emprunt) même si bonus = 0%</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + ';background:' + B.row1 + '"><td style="padding:6px;color:#64748B">Maturité</td><td style="padding:6px"><strong>10 ans</strong> (sortie probable An 4 via autocall) · Capital garanti 100%</td></tr>' +
      '<tr><td style="padding:6px;color:#64748B">Nominal</td><td style="padding:6px"><strong>500 000€</strong></td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;font-size:11px;color:#1A202C"><strong>Pourquoi l\'autocall est essentiel :</strong> L\'emprunt SG dure 5 ans. Sans autocall, le capital du Digital est bloqué 10 ans → impossible de rembourser la SG. Avec autocall à ~25%, le capital est récupéré en An 4, pile à temps.</div>' +
      '<div style="margin-top:6px;font-size:11px;color:#1A202C"><strong>Argument de négo :</strong> Le plancher 3% + bonus 3,2% + autocall ≈ budget d\'une Digitale classique ~5% sans plancher. L\'autocall coûte ~0,30% de bonus en moins. Le plancher coûte ~1% de bonus. Total = le client accepte un coupon espéré de 6,20% au lieu de ~7,50% sans protection, en échange de la sécurité du plancher + la sortie autocall.</div>' +
      '<div style="margin-top:6px;font-size:11px;color:#64748B"><strong>À demander chez :</strong> SG (Pierre Meunier) · CIC · BNPP · Natixis (via BP)</div>');

    html += _acc('cdc-configs', '📦 Les 3 configurations',
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<tr style="background:' + B.header + ';font-weight:700"><td style="padding:8px">CONFIG</td><td style="padding:8px">PRODUIT(S)</td><td style="padding:8px">COUPON</td><td style="padding:8px">SORTIE</td></tr>' +
      '<tr style="background:#E8F0FE;border-bottom:1px solid ' + B.border + '"><td style="padding:8px;font-weight:700">🏆 A</td><td style="padding:8px"><strong>500K TARN 7% + 500K Digital Plancher 3%+Bonus+Autocall</strong></td><td style="padding:8px;font-weight:700;color:#2563EB">7,00% + 6,20%</td><td style="padding:8px;font-size:10px;color:#2563EB">RECOMMANDÉ — Les 2 autocall ~An 4. Plancher couvre emprunt.</td></tr>' +
      '<tr style="border-bottom:1px solid ' + B.border + '"><td style="padding:8px;font-weight:700">🎯 B</td><td style="padding:8px">1M€ TARN TEC10 10Y</td><td style="padding:8px;font-weight:700;color:#D97706">7,00%</td><td style="padding:8px;font-size:10px">Max rendement. Autocall ~An 4. Tout sur 1 produit.</td></tr>' +
      '<tr><td style="padding:8px;font-weight:700">🛡️ C</td><td style="padding:8px">500K TARN 7% + 500K Fixe Callable 4,40%</td><td style="padding:8px;font-weight:700;color:#059669">7,00% + 4,40%</td><td style="padding:8px;font-size:10px">Safe. Fixe garanti + TARN rendement. Pire cas positif.</td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;padding:6px 10px;background:#ECFDF5;border-radius:4px;font-size:11px;color:#065F46">' +
      '✅ <strong>Config A recommandée</strong> — TARN 7% (max coupon) + Digital Plancher 3%+Autocall (plancher couvre emprunt, autocall pour récupérer le capital). Les 2 sortent en ~4 ans.' +
      '</div>');

    html += _acc('cdc-nego', '💪 Points de négociation',
      '<strong>Ce qu\'on sait et qu\'on peut utiliser :</strong><br><br>' +
      '• Le CIC propose le TARN en série à <strong>6,70%</strong> (XS3340532707). On part de là comme plancher.<br>' +
      '• Le budget option 10Y = <strong>26,2% du nominal</strong> (~262K€ sur 1M€). La marge banque retail est ~20%. Sur sur-mesure on vise 12-15%.<br>' +
      '• On consulte <strong>plusieurs établissements</strong> (CIC + SG + BNPP + Natixis). Le dire au banquier.<br>' +
      '• Le nominal de <strong>500K-1M€</strong> justifie un pricing au-dessus du retail.<br>' +
      '• La Digitale Mémoire TEC10 CIC est à 4,60% avec trigger 4,40%. Si on ajoute un plancher 3%, le bonus devrait être ~3,50% au lieu de 4,60% → total 6,50%.<br><br>' +
      '<strong>Ce qu\'on demande :</strong><br><br>' +
      '1. TARN TEC10 sur-mesure 500K-1M€ : <strong>quel coupon au-dessus de 6,70% ?</strong><br>' +
      '2. Digital Plancher 3% + Bonus TEC10 ≤ 4,50% : <strong>quel bonus pouvez-vous donner ?</strong><br>' +
      '3. Êtes-vous compétitif vs CIC/SG sur ces 2 structures ?<br>' +
      '4. Délai de structuration et mise en place ?');

    html += _acc('cdc-marche', '📊 Données de marché (à jour)',
      'TEC10 = <strong>' + _p(MR.tec10) + '%</strong> · OAT 5Y = ' + _p(MR.oat5y) + '% · Euribor 3M = ' + _p(MR.euribor3m) + '%<br>' +
      'BCE dépôt = ' + _p(MR.bce) + '% · Courbe normale <strong>+59bp</strong> (favorable)<br>' +
      'Régime : stagflation modérée (Brent $103, PCE 2,8%)<br><br>' +
      '<strong>Historique TEC10 (20 ans, 695 observations) :</strong><br>' +
      '• TEC10 > 4,60% (trigger TARN) = <strong>0,3% du temps</strong> (2/695 obs) — quasi jamais<br>' +
      '• TEC10 > 4,40% = 1,7% du temps — dernière fois <strong>sept 2008</strong><br>' +
      '• Max historique = <strong>4,75%</strong> (juillet 2008)<br>' +
      '• Depuis 2009, le TEC10 n\'a <strong>jamais dépassé 4,00%</strong>');

    html += _acc('cdc-questions', '❓ Questions pour le banquier',
      '<strong>Sur le TARN :</strong><br>' +
      '1. Sur 500K-1M€ en sur-mesure, <strong>quel coupon au-dessus de 6,70%</strong> ?<br>' +
      '2. Trigger 4,60% ou possibilité de <strong>monter à 4,80%</strong> (plus safe, même coupon) ?<br>' +
      '3. Possibilité de <strong>3 ans garantis</strong> au lieu de 2 ?<br>' +
      '4. Autocall = cumul des coupons <strong>effectivement versés</strong> ?<br><br>' +
      '<strong>Sur le Digital Plancher :</strong><br>' +
      '5. Un <strong>plancher 3% garanti + bonus digital TEC10</strong> ≤ 4,50%, c\'est faisable ?<br>' +
      '6. Quel <strong>bonus</strong> avec un plancher 3% ? (on cible 3,50%)<br>' +
      '7. Avec ou sans <strong>mémoire</strong> sur le bonus ?<br>' +
      '8. Combien coûte un <strong>PUT investisseur An 5</strong> (sortie à 100%) comme filet de sécurité ? En bp de bonus.<br><br>' +
      '<strong>Général :</strong><br>' +
      '8. Émetteur et <strong>notation</strong> (on veut A- minimum) ?<br>' +
      '9. <strong>Délai</strong> de mise en place (on doit signer avant 14/05) ?<br>' +
      '10. <strong>Marché secondaire</strong> en cas de besoin de sortie anticipée ?');

    html += _acc('cdc-calendrier', '📅 Calendrier',
      '• Proposition emprunt SG validée : 14/04/2026<br>' +
      '• <strong>RDV structureur : avril 2026</strong><br>' +
      '• Réception term sheets : fin avril<br>' +
      '• Décision : mi-mai<br>' +
      '• Validité offre SG : <strong>14/05/2026</strong><br>' +
      '• Mise en place souhaitée : fin mai 2026');

    html += '</div>';

    // ═══ SELECT FROM STRUCTBOARD ═══
    var _inputStyle = 'width:100%;padding:8px;border:1px solid ' + B.border + ';border-radius:6px;background:' + B.input + ';color:' + B.text + ';font-size:12px';
    var allProposals = [];
    Object.keys(app.state.proposals || {}).forEach(function(bankId) {
      (app.state.proposals[bankId] || []).forEach(function(p) {
        var st = (p.structureType || p.type || '').toLowerCase();
        var ut = (p.underlyingType || '').toLowerCase();
        var isRate = st.indexOf('taux') >= 0 || st === 'capital_garanti' || st === 'digitale_memoire' || st === 'range_accrual' || ut === 'rates';
        var isProtected = p.capitalProtection && p.capitalProtection.protected;
        if (isRate || isProtected) {
          allProposals.push({ id: p.id, bankId: bankId, name: p.name || '?', coupon: (p.coupon && p.coupon.rate) || 0,
            trigger: (p.coupon && p.coupon.trigger) || (p.capitalProtection && p.capitalProtection.barrierCoupon) || null,
            type: st, maturity: p.maturityYears || 10, emitter: p.emitter || bankId,
            guaranteedYears: p.guaranteedYears || 0, autocallTarget: p.autocallCumulTarget || (p.earlyRedemption && p.earlyRedemption.trigger) || 0,
            grade: p.grading ? p.grading.grade : '?', score: p.grading ? p.grading.score : null,
            prob: p._couponProbability ? p._couponProbability / 100 : 0.90,
            memory: p.coupon && p.coupon.memory });
        }
      });
    });

    html += '<div style="background:' + B.card + ';border:2px solid #7C3AED;border-radius:8px;padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:700;color:#7C3AED;margin-bottom:10px">📋 SÉLECTIONNER DEPUIS STRUCTBOARD</div>';

    if (allProposals.length > 0) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;margin-bottom:12px">';
      allProposals.forEach(function(p, i) {
        var gradeColor = {A:'#06D6A0',B:'#4ECDC4',C:'#FFB627',D:'#E85D04',F:'#EF233C'}[p.grade] || '#94A3B8';
        html += '<label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid ' + B.border + ';border-radius:6px;cursor:pointer;background:' + B.row1 + '">';
        html += '<input type="checkbox" class="carry-sb-check" data-idx="' + i + '" style="width:16px;height:16px">';
        html += '<div style="flex:1;min-width:0">';
        html += '<div style="font-size:11px;font-weight:700;color:' + B.text + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + p.name.substring(0, 35) + '</div>';
        html += '<div style="font-size:10px;color:' + B.muted + '">' + p.emitter.substring(0, 20) + ' · ' + p.maturity + 'Y</div>';
        html += '</div>';
        html += '<div style="text-align:right">';
        html += '<div style="font-size:14px;font-weight:800;color:#D97706">' + p.coupon + '%</div>';
        html += '<div style="display:inline-block;padding:1px 6px;border-radius:4px;background:' + gradeColor + '22;color:' + gradeColor + ';font-size:10px;font-weight:700">' + p.grade + (p.score ? ' ' + p.score : '') + '</div>';
        html += '</div></label>';
      });
      html += '</div>';
      html += '<div style="display:flex;gap:8px;align-items:center">';
      html += '<div style="font-size:11px;color:' + B.muted + ';padding:8px;background:' + B.row1 + ';border-radius:6px">Emprunt : <strong style="color:' + B.text + '">' + _f(L.amount) + '€</strong> · 1 produit = ' + _f(L.amount) + '€</div>';
      html += '<button onclick="__carryAddFromSB()" style="padding:10px 20px;background:#7C3AED;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Ajouter les sélectionnés →</button>';
      html += '</div>';
    } else {
      html += '<div style="color:' + B.dim + ';font-size:12px;padding:12px">Aucun produit capital garanti / taux dans StructBoard. Importez des brochures d\'abord.</div>';
    }
    html += '</div>';

    // ═══ IMPORT MANUEL (accordion) ═══
    html += '<div style="background:' + B.card + ';border:1px dashed ' + B.border + ';border-radius:8px;margin-bottom:16px">';
    html += '<div onclick="var c=document.getElementById(\'carry-manual-form\');c.style.display=c.style.display===\'none\'?\'\':\'none\'" style="padding:12px 16px;cursor:pointer;font-size:12px;color:' + B.muted + '">✏️ Saisie manuelle (si pas dans StructBoard) ▼</div>';
    html += '<div id="carry-manual-form" style="display:none;padding:0 16px 16px">';

    // Formulaire structuré
    html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px">';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Nom du produit</label><input id="ci-name" placeholder="Ex: TARN TEC10 CIC" style="' + _inputStyle + '"></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Coupon (%)</label><input id="ci-coupon" type="number" step="0.1" placeholder="6.70" style="' + _inputStyle + ';font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Trigger (%)</label><input id="ci-trigger" type="number" step="0.1" placeholder="4.60" style="' + _inputStyle + ';font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Durée (ans)</label><input id="ci-duration" type="number" value="10" style="' + _inputStyle + ';font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Montant (€)</label><input id="ci-amount" type="number" value="500000" step="50000" style="' + _inputStyle + ';font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Émetteur</label><input id="ci-emetteur" placeholder="CIC, SG..." style="' + _inputStyle + '"></div>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:8px;align-items:end">';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Type</label><select id="ci-type" style="' + _inputStyle + '"><option value="conditionnel">Conditionnel (TARN)</option><option value="fixe">Fixe garanti</option><option value="hybride">Hybride plancher+bonus</option></select></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Années garanties</label><input id="ci-guaranteed" type="number" value="2" style="' + _inputStyle + ';font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Autocall cumul (%)</label><input id="ci-autocall" type="number" step="0.1" placeholder="26.80" style="' + _inputStyle + ';font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:11px;color:' + B.muted + ';display:block;margin-bottom:3px">Plancher (hybride)</label><input id="ci-plancher" type="number" step="0.1" placeholder="3.00" style="' + _inputStyle + ';font-family:var(--mono)"></div>';
    html += '<button onclick="__carryImportForm()" style="padding:10px 20px;background:#7C3AED;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;height:38px">Ajouter →</button>';
    html += '</div>';

    // Option JSON avancé (caché)
    html += '<div style="margin-top:8px"><span onclick="var j=document.getElementById(\'ci-json-wrap\');j.style.display=j.style.display===\'none\'?\'\':\'none\'" style="font-size:11px;color:#7C3AED;cursor:pointer;text-decoration:underline">JSON avancé ▼</span></div>';
    html += '<div id="ci-json-wrap" style="display:none;margin-top:6px">';
    html += '<textarea id="carry-import-json" placeholder=\'{"name":"...","coupon":6.70,...}\' style="width:100%;height:60px;padding:8px;border:1px solid ' + B.border + ';border-radius:6px;background:' + B.input + ';color:' + B.text + ';font-family:var(--mono);font-size:11px;resize:vertical"></textarea>';
    html += '<button onclick="__carryImport()" style="margin-top:4px;padding:6px 14px;background:' + B.input + ';color:#7C3AED;border:1px solid #7C3AED;border-radius:6px;font-size:11px;cursor:pointer">Importer JSON</button>';
    html += '</div>';

    html += '<div id="carry-import-result" style="margin-top:8px"></div>';
    html += '</div></div>';

    // ═══ PROPOSITIONS LIST (visible, outside accordion) ═══
    html += '<div id="carry-import-list" style="margin-bottom:16px"></div>';

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
    html += '<div style="margin-top:6px;font-size:11px;color:' + B.dim + '">In fine : intérêts seuls pendant 5 ans (' + _f(annualInt) + '€/an) + remboursement capital 1M€ à échéance. Coût total intérêts : ' + _f(annualInt * L.years) + '€ + frais ' + _f(L.fees) + '€ = ' + _f(annualInt * L.years + L.fees) + '€</div>';
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
        // Explication simple pour non-expert
        var explain = '';
        if (p.type === 'conditionnel' && p.autocallTarget) {
          explain = 'La banque vous verse ' + p.coupon + '% par an tant que le taux d\'État 10 ans (TEC10) reste en dessous de 4,60%. Les 2 premières années le coupon est garanti. Quand le total des coupons atteint ' + p.autocallTarget + '% (~' + p.autocallYears + ' ans), le produit s\'arrête et vous récupérez votre capital. Si le TEC10 dépasse 4,60%, le coupon n\'est pas versé cette année-là mais votre capital reste garanti.';
        } else if (p.type === 'fixe' && p.name.indexOf('Step') >= 0) {
          explain = 'La banque vous verse un coupon garanti qui augmente chaque année (de 3,50% à 6,00%). Aucune condition : vous touchez le coupon quoi qu\'il arrive. La banque peut rappeler le produit à partir de l\'année 3 si les taux baissent.';
        } else if (p.type === 'fixe') {
          explain = 'La banque vous verse ' + p.coupon + '% par an garanti, sans aucune condition. C\'est le placement le plus sûr : coupon fixe chaque année + capital remboursé à 100% à l\'échéance. La banque peut rappeler le produit si les taux baissent.';
        } else if (p.type === 'hybride' && p.couponPlancher) {
          explain = 'La banque vous verse au minimum ' + p.couponPlancher + '% par an garanti (ce qui couvre votre emprunt à 2,90%). En plus, vous recevez un bonus de ' + p.couponBonus + '% si le TEC10 reste en dessous de 4,50%. ' + (p.autocallTarget ? 'Quand le total des coupons atteint ' + p.autocallTarget + '% (~' + p.autocallYears + ' ans), le produit s\'arrête et vous récupérez votre capital pour rembourser l\'emprunt. ' : '') + 'Le minimum garanti protège votre carry trade : même dans le pire cas, vous ne perdez pas d\'argent.';
        }
        if (explain) {
          h += '<div style="margin:6px 0 8px;padding:8px 10px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;font-size:11px;color:#1E40AF;line-height:1.6">' + explain + '</div>';
        }
        h += '<div style="font-family:var(--mono);font-size:24px;font-weight:800;color:' + p.color + ';margin:4px 0">' + p.coupon + '%</div>';
        h += '<div style="font-size:10px;color:' + B.text + ';line-height:1.5">';
        h += '<strong>' + _f(p.amount) + '€</strong> · ' + p.duration + ' ans · Capital garanti 100%<br>';
        h += 'Proba coupon : <strong style="color:#059669">' + Math.round((p.prob || 1) * 100) + '%</strong> (historique 20 ans)<br>';
        if (p.guaranteedYears) h += 'Coupon garanti : <strong>An 1' + (p.guaranteedYears >= 2 ? '-' + p.guaranteedYears : '') + '</strong><br>';
        if (p.autocallTarget) h += 'Autocall : cumul ≥ ' + p.autocallTarget + '% (~' + p.autocallYears + ' ans) → réinvesti 3% CAT<br>';
        h += '</div>';
        h += '<div style="margin-top:8px;padding:6px 8px;background:' + B.row1 + ';border-radius:4px;font-size:10px">';
        h += 'Coupon espéré <strong style="color:#059669">' + _p(espere) + '%</strong> · Spread <strong style="color:' + (espere > LOAN.rate ? '#059669' : '#DC2626') + '">' + (espere > LOAN.rate ? '+' : '') + _p(espere - LOAN.rate) + '%</strong> vs emprunt';
        h += '</div>';
        h += '<div style="margin-top:6px;font-size:11px;color:' + B.dim + ';line-height:1.4">' + (p.detail || '') + '</div>';
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
        h += '<div style="font-size:11px;font-weight:700;color:' + B.dim + ';letter-spacing:0.5px">' + kpi[0] + '</div>';
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
          var isR = fp.color === '#475569';
          p += '<div style="font-size:11px;color:' + (isR ? '#475569' : fp.color) + ';' + (isR ? 'font-style:italic' : '') + '">' + fp.name.substring(0, 35) + ' → <strong>+' + _f(fp.rev) + '€</strong></div>';
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
    await _loadImportedProducts();
    _render(container);
    setTimeout(_refreshImportList, 100);
  };

  // ─── Import propositions banquiers (persisted to GitHub) ──────
  var _importedProducts = [];
  var _importedLoaded = false;

  async function _loadImportedProducts() {
    if (_importedLoaded) return;
    try {
      var data = await github.readFile(CONFIG.DATA_PATH + '/carry-trade/proposals.json');
      if (Array.isArray(data)) _importedProducts = data;
      _importedLoaded = true;
    } catch(e) { _importedLoaded = true; }
  }

  async function _saveImportedProducts() {
    try {
      await github.writeFile(CONFIG.DATA_PATH + '/carry-trade/proposals.json', _importedProducts, '[StructBoard] Update carry trade proposals');
    } catch(e) { console.warn('[CarryTrade] Save error:', e.message); }
  }

  window.__carryDeleteProposal = function(idx) {
    _importedProducts.splice(idx, 1);
    _saveImportedProducts();
    _refreshImportList();
  };

  window.__carrySimulateSelected = function() {
    var selected = [];
    document.querySelectorAll('.carry-prop-check:checked').forEach(function(cb) {
      var idx = parseInt(cb.dataset.idx);
      if (_importedProducts[idx]) selected.push(_importedProducts[idx]);
    });
    if (selected.length === 0) { showToast('Sélectionnez au moins une proposition', 'error'); return; }
    // Compute PnL for selected
    var pnl = _computePnL(selected, LOAN.amount, LOAN.rate, LOAN.years, LOAN.taxRate);
    var totalAmount = selected.reduce(function(s, p) { return s + (p.amount || 0); }, 0);
    // Render result in discussion zone
    var disc = document.getElementById('carry-v2-discussion');
    if (disc) {
      var h = '<div style="font-size:13px;font-weight:700;color:#7C3AED;margin-bottom:12px">📊 SIMULATION — ' + selected.length + ' proposition' + (selected.length > 1 ? 's' : '') + ' sélectionnée' + (selected.length > 1 ? 's' : '') + ' (' + _f(totalAmount) + '€)</div>';

      // Product cards
      h += '<div style="display:grid;grid-template-columns:repeat(' + Math.min(selected.length, 3) + ',1fr);gap:10px;margin-bottom:14px">';
      selected.forEach(function(p) {
        h += '<div style="padding:12px;border-radius:8px;border-left:4px solid ' + (p.color || '#7C3AED') + ';background:' + B.row1 + '">';
        h += '<div style="font-size:12px;font-weight:700;color:' + (p.color || '#7C3AED') + '">' + p.name + '</div>';
        h += '<div style="font-size:11px;color:' + B.muted + ';margin-top:4px">' + p.emetteur + ' · ' + _f(p.amount) + '€</div>';
        h += '<div style="font-size:18px;font-weight:800;color:#D97706;margin-top:6px">' + p.coupon + '%</div>';
        h += '<div style="font-size:10px;color:' + B.dim + '">' + (p.type === 'fixe' ? 'Fixe garanti' : p.type === 'hybride' ? 'Plancher ' + p.couponPlancher + '% + Bonus' : 'Conditionnel trigger ' + (p.trigger || '?') + '%') + '</div>';
        h += '</div>';
      });
      h += '</div>';

      // PnL table
      h += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px">';
      h += '<thead><tr style="background:' + B.header + '"><th style="padding:6px">Année</th>';
      selected.forEach(function(p) { h += '<th style="padding:6px;color:' + (p.color || '#7C3AED') + '">' + (p.name || '').substring(0, 20) + '</th>'; });
      h += '<th style="padding:6px;color:#059669">Total coupons</th><th style="padding:6px;color:#DC2626">Intérêts emprunt</th><th style="padding:6px;font-weight:700">Net</th></tr></thead><tbody>';
      pnl.flows.forEach(function(f) {
        var bg = f.year % 2 === 0 ? B.row0 : B.row1;
        h += '<tr style="background:' + bg + ';border-bottom:1px solid ' + B.border + '">';
        h += '<td style="padding:5px 6px;font-weight:700">An ' + f.year + '</td>';
        f.products.forEach(function(fp) { h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:' + (fp.color || '#059669') + '">+' + _f(fp.rev) + '€</td>'; });
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#059669;font-weight:600">+' + _f(f.totalRev) + '€</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:#DC2626">-' + _f(f.interest) + '€</td>';
        h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + (f.net >= 0 ? '#059669' : '#DC2626') + '">' + (f.net >= 0 ? '+' : '') + _f(f.net) + '€</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';

      // Summary
      h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">';
      h += '<div style="text-align:center;padding:10px;background:#ECFDF5;border-radius:6px;border:1px solid #6EE7B7"><div style="font-size:10px;color:#065F46">Coupons bruts 5A</div><div style="font-size:18px;font-weight:800;color:#059669">+' + _f(pnl.totalRevenue) + '€</div></div>';
      h += '<div style="text-align:center;padding:10px;background:#FEF2F2;border-radius:6px;border:1px solid #FCA5A5"><div style="font-size:10px;color:#991B1B">Intérêts emprunt 5A</div><div style="font-size:18px;font-weight:800;color:#DC2626">-' + _f(pnl.totalInterest) + '€</div></div>';
      h += '<div style="text-align:center;padding:10px;background:#FFF7ED;border-radius:6px;border:1px solid #FDBA74"><div style="font-size:10px;color:#92400E">IS 25%</div><div style="font-size:18px;font-weight:800;color:#D97706">-' + _f(pnl.tax) + '€</div></div>';
      h += '<div style="text-align:center;padding:10px;background:' + (pnl.netAfterTax >= 0 ? '#ECFDF5' : '#FEF2F2') + ';border-radius:6px;border:2px solid ' + (pnl.netAfterTax >= 0 ? '#059669' : '#DC2626') + '"><div style="font-size:10px;color:' + (pnl.netAfterTax >= 0 ? '#065F46' : '#991B1B') + '">NET APRÈS IS</div><div style="font-size:18px;font-weight:800;color:' + (pnl.netAfterTax >= 0 ? '#059669' : '#DC2626') + '">' + (pnl.netAfterTax >= 0 ? '+' : '') + _f(pnl.netAfterTax) + '€</div></div>';
      h += '</div>';

      // Worst case
      h += '<div style="margin-top:10px;padding:8px;background:#FFF7ED;border-radius:6px;font-size:11px;color:#92400E">';
      h += '<strong>Pire cas :</strong> +' + _f(pnl.worstNet) + '€ (coupons garantis uniquement)';
      h += ' · <strong>Espérance pondérée :</strong> +' + _f(pnl.esperance) + '€ (90% central + 10% pire)';
      h += '</div>';

      disc.innerHTML = h;
    }
  };

  function _refreshImportList() {
    var list = document.getElementById('carry-import-list');
    if (!list) return;
    if (_importedProducts.length === 0) { list.innerHTML = ''; return; }
    var h = '<div style="font-size:12px;font-weight:700;color:#7C3AED;margin:12px 0 8px">📋 Propositions reçues (' + _importedProducts.length + ')</div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    h += '<tr style="background:' + B.header + '"><th style="padding:6px;width:30px"></th><th style="padding:6px;text-align:left">Produit</th><th style="padding:6px">Émetteur</th><th style="padding:6px">Coupon</th><th style="padding:6px">Trigger</th><th style="padding:6px">Montant</th><th style="padding:6px">Net 5A</th><th style="padding:6px;width:30px"></th></tr>';
    _importedProducts.forEach(function(p, i) {
      var ppnl = _computePnL([p], LOAN.amount, LOAN.rate, LOAN.years, LOAN.taxRate);
      h += '<tr style="border-bottom:1px solid ' + B.border + '">';
      h += '<td style="padding:6px;text-align:center"><input type="checkbox" class="carry-prop-check" data-idx="' + i + '" checked></td>';
      h += '<td style="padding:6px;font-weight:600;color:' + (p.color || '#7C3AED') + '">' + p.name + '</td>';
      h += '<td style="padding:6px;color:' + B.muted + '">' + (p.emetteur || '—') + '</td>';
      h += '<td style="padding:6px;font-family:var(--mono);font-weight:700;color:#D97706">' + p.coupon + '%</td>';
      h += '<td style="padding:6px;font-family:var(--mono)">' + (p.trigger || '—') + '%</td>';
      h += '<td style="padding:6px;font-family:var(--mono)">' + _f(p.amount) + '€</td>';
      h += '<td style="padding:6px;font-family:var(--mono);font-weight:700;color:#059669">+' + _f(ppnl.esperance) + '€</td>';
      h += '<td style="padding:6px;text-align:center"><button onclick="__carryDeleteProposal(' + i + ')" style="background:none;border:none;color:#DC2626;cursor:pointer;font-size:12px" title="Supprimer">✕</button></td>';
      h += '</tr>';
    });
    h += '</table>';
    h += '<button onclick="__carrySimulateSelected()" style="margin-top:10px;padding:10px 24px;background:#7C3AED;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">📊 Simuler les sélectionnées</button>';
    list.innerHTML = h;
  }

  // ─── Add products from StructBoard selection ──────
  var _sbProposals = []; // populated during render

  window.__carryAddFromSB = function() {
    console.log('[CarryTrade] __carryAddFromSB called');
    try {
    // Read which checkboxes are checked
    var checked = document.querySelectorAll('.carry-sb-check:checked');
    console.log('[CarryTrade] Checked:', checked.length);
    if (checked.length === 0) { showToast('Sélectionnez au moins un produit', 'error'); return; }
    var amount = LOAN.amount; // 1M€ = montant de l'emprunt

    // Get the allProposals array from render scope — re-build it
    var allP = [];
    Object.keys(app.state.proposals || {}).forEach(function(bankId) {
      (app.state.proposals[bankId] || []).forEach(function(p) {
        var st = (p.structureType || p.type || '').toLowerCase();
        var ut = (p.underlyingType || '').toLowerCase();
        var isRate = st.indexOf('taux') >= 0 || st === 'capital_garanti' || st === 'digitale_memoire' || st === 'range_accrual' || ut === 'rates';
        var isProtected = p.capitalProtection && p.capitalProtection.protected;
        if (isRate || isProtected) allP.push(p);
      });
    });
    console.log('[CarryTrade] allP:', allP.length, 'products');

    var added = 0;
    checked.forEach(function(cb) {
      var idx = parseInt(cb.dataset.idx);
      var p = allP[idx];
      if (!p) return;

      var couponRate = (p.coupon && p.coupon.rate) || 0;
      var trigger = (p.coupon && p.coupon.trigger) || (p.capitalProtection && p.capitalProtection.barrierCoupon) || null;
      var st = (p.structureType || '').toLowerCase();
      var type = st.indexOf('fixe') >= 0 ? 'fixe' : 'conditionnel';
      var prob = p._couponProbability ? p._couponProbability / 100 : (type === 'fixe' ? 1.0 : 0.90);

      var product = {
        name: p.name || 'Produit StructBoard',
        type: type,
        coupon: couponRate,
        prob: prob,
        duration: p.maturityYears || 10,
        guaranteedYears: p.guaranteedYears || 0,
        autocallTarget: p.autocallCumulTarget || (p.earlyRedemption && p.earlyRedemption.trigger > 10 ? p.earlyRedemption.trigger : 0) || 0,
        autocallYears: 0,
        amount: amount,
        risk: (p.capitalProtection && p.capitalProtection.protected) ? 'Faible' : 'Modéré',
        detail: (p.emitter || '') + (trigger ? ' · Trigger ' + trigger + '%' : '') + ' · ' + ((p.capitalProtection && p.capitalProtection.protected) ? 'Capital garanti 100%' : ''),
        color: '#7C3AED',
        source: 'structboard',
        emetteur: p.emitter || '?',
        trigger: trigger,
        _productId: p.id,
        _bankId: p.bankId
      };
      if (product.autocallTarget && product.coupon > 0) {
        product.autocallYears = Math.ceil(product.autocallTarget / product.coupon);
      }

      // Check if already imported
      var exists = _importedProducts.some(function(ip) { return ip._productId === p.id; });
      if (!exists) {
        _importedProducts.push(product);
        added++;
      }
    });

    console.log('[CarryTrade] Added:', added, 'Total imported:', _importedProducts.length);
    if (added > 0) {
      _saveImportedProducts().catch(function(e) { console.warn('[CarryTrade] Save error (non-blocking):', e.message); });
      _refreshImportList();
      showToast(added + ' produit' + (added > 1 ? 's' : '') + ' ajouté' + (added > 1 ? 's' : '') + ' depuis StructBoard', 'success');
    } else {
      showToast('Produits déjà importés', 'info');
    }
    } catch(e) { console.error('[CarryTrade] Error in __carryAddFromSB:', e); showToast('Erreur: ' + e.message, 'error'); }
  };

  window.__carryImportForm = function() {
    var name = document.getElementById('ci-name')?.value || 'Proposition banquier';
    var coupon = parseFloat(document.getElementById('ci-coupon')?.value) || 0;
    var trigger = parseFloat(document.getElementById('ci-trigger')?.value) || 0;
    var duration = parseInt(document.getElementById('ci-duration')?.value) || 10;
    var amount = parseInt(document.getElementById('ci-amount')?.value) || 500000;
    var emetteur = document.getElementById('ci-emetteur')?.value || '?';
    var type = document.getElementById('ci-type')?.value || 'conditionnel';
    var guaranteed = parseInt(document.getElementById('ci-guaranteed')?.value) || 0;
    var autocall = parseFloat(document.getElementById('ci-autocall')?.value) || 0;
    var plancher = parseFloat(document.getElementById('ci-plancher')?.value) || 0;

    if (!coupon) { alert('Coupon obligatoire'); return; }

    var json = JSON.stringify({
      name: name, coupon: coupon, type: type, trigger: trigger,
      guaranteedYears: guaranteed, autocallTarget: autocall,
      duration: duration, amount: amount, emetteur: emetteur,
      capitalGaranti: true, couponPlancher: plancher || undefined
    });
    var ta = document.getElementById('carry-import-json');
    if (ta) ta.value = json;
    __carryImport();
    // Reset form
    ['ci-name','ci-coupon','ci-trigger','ci-emetteur','ci-autocall','ci-plancher'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
  };

  window.__carryImportExample = function() {
    var example = '{\n  "name": "TARN TEC10 CIC Avril 2036",\n  "coupon": 6.70,\n  "type": "conditionnel",\n  "trigger": 4.60,\n  "guaranteedYears": 2,\n  "autocallTarget": 26.80,\n  "duration": 10,\n  "amount": 500000,\n  "emetteur": "CIC (A+)",\n  "capitalGaranti": true\n}';
    var ta = document.getElementById('carry-import-json');
    if (ta) ta.value = example;
  };

  window.__carryImport = function() {
    var ta = document.getElementById('carry-import-json');
    var result = document.getElementById('carry-import-result');
    var list = document.getElementById('carry-import-list');
    if (!ta || !result) return;

    try {
      var d = JSON.parse(ta.value);
      var product = {
        name: d.name || 'Proposition banquier',
        type: d.type || 'conditionnel',
        coupon: parseFloat(d.coupon) || 0,
        prob: d.type === 'fixe' ? 1.0 : 0.92,
        duration: parseInt(d.duration) || 10,
        guaranteedYears: parseInt(d.guaranteedYears) || 0,
        autocallTarget: parseFloat(d.autocallTarget) || 0,
        autocallYears: d.autocallTarget ? Math.ceil(d.autocallTarget / (d.coupon || 6)) : 0,
        amount: parseInt(d.amount) || 500000,
        risk: d.capitalGaranti ? 'Faible' : 'Modéré',
        detail: (d.emetteur || '') + ' · Trigger ' + (d.trigger || '?') + '% · ' + (d.capitalGaranti ? 'Capital garanti 100%' : 'Capital non garanti'),
        color: '#7C3AED',
        source: 'import',
        emetteur: d.emetteur || '?',
        trigger: d.trigger || null
      };
      if (d.couponPlancher) {
        product.type = 'hybride';
        product.couponPlancher = parseFloat(d.couponPlancher);
        product.couponBonus = product.coupon - product.couponPlancher;
      }
      _importedProducts.push(product);
      _saveImportedProducts();

      // Compute PnL for this product alone
      var pnl = _computePnL([product], LOAN.amount, LOAN.rate, LOAN.years, LOAN.taxRate);

      result.innerHTML = '<div style="padding:8px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;font-size:11px;color:#065F46;margin-bottom:8px">✅ <strong>' + product.name + '</strong> sauvegardé — coupon ' + product.coupon + '% · Net espéré <strong>+' + _f(pnl.esperance) + '€</strong> sur 5 ans</div>';
      ta.value = '';
      _refreshImportList();
    } catch(e) {
      result.innerHTML = '<div style="padding:8px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:6px;font-size:11px;color:#DC2626">❌ JSON invalide : ' + e.message + '</div>';
    }
  };

  console.log('[StructBoard] Carry Trade v2 loaded — 3 configurations');
})();

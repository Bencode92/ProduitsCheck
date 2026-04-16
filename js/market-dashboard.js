// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Market Dashboard v1.0
// Page dédiée aux données de marché temps réel pour le carry trade
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _data = { rates: null, mi: null, loaded: false };

  function _fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }
  function _pct(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  // Light theme (same as carry simulator)
  var BG = {
    wrap: '#F8F9FB', section: '#FFFFFF', input: '#F1F3F7',
    row0: '#FFFFFF', row1: '#F4F6F9', header: '#E8ECF2',
    border: '#D1D9E6', highlight: '#E8F0FE',
    text: '#1A202C', textMuted: '#64748B', textDim: '#94A3B8'
  };

  async function _loadData() {
    try {
      var [ratesResp, miResp] = await Promise.all([
        fetch('data/market/rates.json'),
        fetch('data/market/market_intelligence.json')
      ]);
      _data.rates = await ratesResp.json();
      _data.mi = await miResp.json();
      _data.loaded = true;
    } catch(e) {
      console.error('[MarketDashboard] Erreur chargement:', e);
    }
  }

  function _renderKPI(label, value, color, sub) {
    return '<div style="padding:14px;border:1px solid ' + BG.border + ';border-radius:8px;border-left:4px solid ' + color + ';background:' + BG.section + '">' +
      '<div style="font-size:9px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.8px;text-transform:uppercase">' + label + '</div>' +
      '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + color + ';margin:6px 0">' + value + '</div>' +
      '<div style="font-size:9px;color:' + BG.textDim + ';line-height:1.4">' + sub + '</div></div>';
  }

  function _render(container) {
    var r = _data.rates || {};
    var mi = _data.mi || {};
    var md = mi.market_data_input || {};
    var ai = mi.ai_response || {};

    var yields = r.yields || {};
    var policy = r.policy_rates || {};
    var curve = r.yield_curve || {};

    var tec10 = yields.oat_fr_10y || {};
    var oat5y = yields.oat_fr_5y || {};
    var oat2y = yields.oat_fr_2y || {};
    var bce = policy.ecb_deposit_rate || {};
    var bceMain = policy.ecb_main_rate || {};
    var eur3m = policy.euribor_3m || {};
    var eur6m = policy.euribor_6m || {};

    var html = '<div style="background:' + BG.wrap + ';border-radius:12px;padding:24px;color:' + BG.text + '">';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid ' + BG.border + '">';
    html += '<div style="font-size:18px;font-weight:800;color:' + BG.text + '">📈 Données de Marché</div>';
    var fetchDate = r.fetched_at ? new Date(r.fetched_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    html += '<div style="font-size:10px;color:' + BG.textDim + ';padding:4px 10px;background:' + BG.row1 + ';border-radius:4px">Dernière MAJ : ' + fetchDate + ' · Source : ECB + Twelve Data + IA</div>';
    html += '</div>';

    // ═══ SECTION 1: TAUX SOUVERAINS (cliquables) ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:4px">🏛️ Taux souverains EUR (zone euro AAA)</div>';
    html += '<div style="font-size:9px;color:' + BG.textDim + ';margin-bottom:10px">Cliquez sur un taux pour voir l\'analyse détaillée et l\'historique</div>';

    // Clickable rate cards
    var rateCards = [
      { id: 'oat_fr_10y', label: 'TEC10 (OAT 10 ans)', data: tec10, color: '#0891B2', sub: 'Vol ' + (tec10.vol_annualized_bps || 18) + 'bp · ' + (tec10.direction || 'stable') + ' · Range ' + (tec10.low_1y || '?') + '-' + (tec10.high_1y || '?') },
      { id: 'oat_fr_5y', label: 'OAT 5 ans', data: oat5y, color: '#2563EB', sub: 'Vol ' + (oat5y.vol_annualized_bps || 22) + 'bp · ' + (oat5y.direction || 'stable') + ' · Spread 5-10Y +' + Math.round(((tec10.current||3.10) - (oat5y.current||2.70)) * 100) + 'bp' },
      { id: 'oat_fr_2y', label: 'OAT 2 ans', data: oat2y, color: '#7C3AED', sub: 'Vol ' + (oat2y.vol_annualized_bps || 26) + 'bp · ' + (oat2y.direction || 'stable') + ' · Spread 2-10Y +' + Math.round(((tec10.current||3.10) - (oat2y.current||2.53)) * 100) + 'bp' },
      { id: '_euribor3m', label: 'Euribor 3M', data: eur3m, color: '#D97706', sub: 'Réf Range Accrual · piloté par BCE' }
    ];

    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:8px">';
    rateCards.forEach(function(rc) {
      var val = rc.data.current || 0;
      html += '<div onclick="_mktOpenRate(\'' + rc.id + '\')" style="padding:14px;border:1px solid ' + BG.border + ';border-radius:8px;border-left:4px solid ' + rc.color + ';background:' + BG.section + ';cursor:pointer;transition:all 0.2s" onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.1)\'" onmouseout="this.style.boxShadow=\'none\'">';
      html += '<div style="font-size:9px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.8px;text-transform:uppercase">' + rc.label + ' <span style="color:' + rc.color + '">▼ clic</span></div>';
      html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + rc.color + ';margin:6px 0">' + val.toFixed(2) + '%</div>';
      html += '<div style="font-size:9px;color:' + BG.textDim + ';line-height:1.4">' + rc.sub + '</div>';
      html += '</div>';
    });
    html += '</div>';

    // Rate detail panel (hidden by default)
    html += '<div id="mkt-rate-detail" style="margin-bottom:20px"></div>';

    // Courbe shape card
    html += '<div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:20px">';
    html += '<div style="padding:10px 14px;border:1px solid ' + BG.border + ';border-radius:8px;background:' + BG.section + ';display:flex;justify-content:space-between;align-items:center">';
    html += '<div><span style="font-size:12px;font-weight:700;color:' + BG.text + '">Courbe des taux : </span>';
    html += '<span style="font-family:var(--mono);font-size:14px;font-weight:800;color:' + (curve.shape === 'normal' ? '#059669' : '#DC2626') + '">' + (curve.shape === 'normal' ? 'Normale ↗' : 'Inversée ↘') + '</span></div>';
    html += '<div style="font-size:10px;color:' + BG.textDim + '">Spread 2s10s : +' + Math.round((curve.spread_2_10 || 0.57) * 100) + 'bp · ' + (curve.shape === 'normal' ? 'Favorable aux structurés' : 'Défavorable') + '</div>';
    html += '</div></div>';

    // ═══ SECTION 2: TAUX DIRECTEURS + MONÉTAIRE ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:12px">🏦 Taux directeurs BCE & marché monétaire</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">';
    html += _renderKPI('BCE Dépôt', (bce.current || 2.00).toFixed(2) + '%', '#059669', 'Taux plancher du marché monétaire');
    html += _renderKPI('BCE Main Refi', (bceMain.current || 2.15).toFixed(2) + '%', '#059669', 'Taux directeur principal');
    html += _renderKPI('Euribor 3M', (eur3m.current || 2.50).toFixed(2) + '%', '#D97706', 'Réf. Range Accrual · Date : ' + (eur3m.date || '—'));
    html += _renderKPI('Euribor 6M', (eur6m.current || 2.80).toFixed(2) + '%', '#D97706', 'Taux interbancaire 6 mois');
    html += '</div>';

    // ═══ SECTION 3: COURBE DES TAUX VISUELLE ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:16px;margin-bottom:20px">';
    html += '<div style="font-size:13px;font-weight:700;color:' + BG.text + ';margin-bottom:12px">Courbe des taux EUR — Impact sur le budget option structuré</div>';
    html += '<div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-bottom:8px">';
    var barData = [
      ['BCE\ndépôt', bce.current || 2.00, '#059669'],
      ['Euribor\n3M', eur3m.current || 2.50, '#D97706'],
      ['OAT\n2 ans', oat2y.current || 2.53, '#7C3AED'],
      ['OAT\n5 ans', oat5y.current || 2.70, '#2563EB'],
      ['Emprunt\nSG', 2.90, '#DC2626'],
      ['TEC10\n10 ans', tec10.current || 3.10, '#0891B2']
    ];
    barData.forEach(function(b) {
      var h = Math.round((b[1] / 4.0) * 100);
      html += '<div style="flex:1;text-align:center">';
      html += '<div style="background:' + b[2] + ';height:' + h + 'px;border-radius:6px 6px 0 0;margin:0 3px;display:flex;align-items:flex-start;justify-content:center;padding-top:6px;min-height:30px">';
      html += '<span style="font-family:var(--mono);font-size:13px;font-weight:800;color:#fff">' + b[1].toFixed(2) + '%</span></div>';
      html += '<div style="font-size:9px;color:' + BG.textMuted + ';margin-top:4px;white-space:pre-line;line-height:1.2">' + b[0] + '</div></div>';
    });
    html += '</div>';
    // Budget explanation
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">';
    var budget5y = Math.round((1 - 1 / Math.pow(1 + (oat5y.current || 2.70) / 100, 5)) * 10000) / 100;
    var budget10y = Math.round((1 - 1 / Math.pow(1 + (tec10.current || 3.10) / 100, 10)) * 10000) / 100;
    html += '<div style="padding:8px 12px;background:#E0F7FA;border-radius:6px;font-size:11px;color:#0891B2">';
    html += '<strong>Budget option 5 ans</strong> = ' + budget5y.toFixed(1) + '% du nominal<br>';
    html += 'Sur 500K€ = <strong>' + _fmt(Math.round(500000 * budget5y / 100)) + '€</strong> pour financer les coupons</div>';
    html += '<div style="padding:8px 12px;background:#DBEAFE;border-radius:6px;font-size:11px;color:#1E40AF">';
    html += '<strong>Budget option 10 ans</strong> = ' + budget10y.toFixed(1) + '% du nominal<br>';
    html += 'Sur 500K€ = <strong>' + _fmt(Math.round(500000 * budget10y / 100)) + '€</strong> pour financer les coupons</div>';
    html += '</div></div>';

    // ═══ SECTION 4: SIMULATEUR SEUILS CUSTOM ═══
    html += '<div style="background:' + BG.section + ';border:2px solid #7C3AED;border-radius:8px;padding:16px;margin-bottom:20px">';
    html += '<div style="font-size:14px;font-weight:700;color:#7C3AED;margin-bottom:12px">🔧 SIMULATEUR DE SEUILS — Testez vos propres corridors & triggers</div>';
    html += '<div style="font-size:10px;color:' + BG.textDim + ';margin-bottom:12px">Entrez un seuil ou un corridor et visualisez sur l\'historique quand le taux l\'a franchi.</div>';

    // Controls
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:10px;align-items:end;margin-bottom:14px">';
    // Rate selector
    html += '<div><label style="font-size:9px;font-weight:700;color:' + BG.textDim + ';display:block;margin-bottom:4px">TAUX</label>';
    html += '<select id="mkt-sim-rate" style="width:100%;padding:8px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-size:12px">';
    html += '<option value="tec10" selected>TEC10 (OAT 10Y)</option>';
    html += '<option value="oat5y">OAT 5 ans</option>';
    html += '<option value="oat2y">OAT 2 ans</option>';
    html += '<option value="euribor3m">Euribor 3M</option>';
    html += '</select></div>';
    // Mode selector
    html += '<div><label style="font-size:9px;font-weight:700;color:' + BG.textDim + ';display:block;margin-bottom:4px">MODE</label>';
    html += '<select id="mkt-sim-mode" style="width:100%;padding:8px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-size:12px" onchange="_mktSimModeChange()">';
    html += '<option value="below">Seuil ≤ (coupon si en dessous)</option>';
    html += '<option value="above">Seuil ≥ (coupon si au dessus)</option>';
    html += '<option value="corridor">Corridor [min — max]</option>';
    html += '</select></div>';
    // Value 1
    html += '<div><label style="font-size:9px;font-weight:700;color:' + BG.textDim + ';display:block;margin-bottom:4px" id="mkt-sim-label1">SEUIL (%)</label>';
    html += '<input type="number" id="mkt-sim-val1" value="4.40" step="0.05" style="width:100%;padding:8px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-family:var(--mono);font-size:13px"></div>';
    // Value 2 (corridor only)
    html += '<div id="mkt-sim-val2-wrap"><label style="font-size:9px;font-weight:700;color:' + BG.textDim + ';display:block;margin-bottom:4px">BORNE HAUTE (%)</label>';
    html += '<input type="number" id="mkt-sim-val2" value="3.80" step="0.05" style="width:100%;padding:8px;border:1px solid ' + BG.border + ';border-radius:6px;background:' + BG.input + ';color:' + BG.text + ';font-family:var(--mono);font-size:13px"></div>';
    // Button
    html += '<div><button onclick="_mktSimAnalyze()" style="padding:8px 16px;background:#7C3AED;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">Analyser</button></div>';
    html += '</div>';
    // Results zone
    html += '<div id="mkt-sim-result" style="min-height:40px"></div>';
    html += '</div>';

    // ═══ SECTION 5: ZONES & TRIGGERS PRODUITS ═══
    var tec10Val = tec10.current || 3.10;
    var eur3mVal = eur3m.current || 2.50;

    html += '<div style="background:' + BG.section + ';border:2px solid #2563EB;border-radius:8px;padding:16px;margin-bottom:20px">';
    html += '<div style="font-size:14px;font-weight:700;color:#2563EB;margin-bottom:14px">🎯 ZONES & SEUILS — Position actuelle vs triggers produits</div>';

    // Helper: render a gauge bar
    function _gauge(label, currentVal, min, max, zones, unit) {
      unit = unit || '%';
      var totalRange = max - min;
      var currentPct = Math.max(0, Math.min(100, ((currentVal - min) / totalRange) * 100));
      var g = '<div style="margin-bottom:16px">';
      g += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      g += '<div style="font-size:12px;font-weight:700;color:' + BG.text + '">' + label + '</div>';
      g += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:#2563EB">Actuel : ' + currentVal.toFixed(2) + unit + '</div>';
      g += '</div>';
      // Gauge bar
      g += '<div style="position:relative;height:32px;background:' + BG.input + ';border-radius:6px;overflow:hidden;border:1px solid ' + BG.border + '">';
      // Render zones
      zones.forEach(function(z) {
        var leftPct = Math.max(0, ((z.from - min) / totalRange) * 100);
        var widthPct = Math.min(100 - leftPct, ((z.to - z.from) / totalRange) * 100);
        g += '<div style="position:absolute;left:' + leftPct + '%;width:' + widthPct + '%;height:100%;background:' + z.color + ';opacity:0.25" title="' + z.label + '"></div>';
        // Zone label
        g += '<div style="position:absolute;left:' + leftPct + '%;width:' + widthPct + '%;height:100%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:600;color:' + z.color + ';pointer-events:none">' + z.label + '</div>';
      });
      // Current position marker
      g += '<div style="position:absolute;left:' + currentPct + '%;top:0;width:3px;height:100%;background:#2563EB;border-radius:2px;z-index:2"></div>';
      g += '<div style="position:absolute;left:' + Math.max(0, currentPct - 3) + '%;top:-2px;z-index:3">';
      g += '<div style="background:#2563EB;color:#fff;padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:9px;font-weight:700">' + currentVal.toFixed(2) + '</div></div>';
      g += '</div>';
      // Scale labels
      g += '<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:8px;color:' + BG.textDim + '">';
      g += '<span>' + min.toFixed(1) + unit + '</span>';
      zones.forEach(function(z) {
        if (z.from > min && z.from < max) g += '<span style="color:' + z.color + '">│ ' + z.from.toFixed(2) + '</span>';
      });
      g += '<span>' + max.toFixed(1) + unit + '</span>';
      g += '</div>';
      // Distance info
      zones.forEach(function(z) {
        if (z.trigger !== undefined) {
          var dist = z.trigger - currentVal;
          var distBp = Math.round(Math.abs(dist) * 100);
          var safe = z.direction === 'below' ? (currentVal < z.trigger) : (currentVal > z.trigger);
          g += '<div style="display:inline-block;margin-right:12px;margin-top:4px;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;' +
            'background:' + (safe ? '#ECFDF5' : '#FEF2F2') + ';color:' + (safe ? '#059669' : '#DC2626') + '">';
          g += (safe ? '✅' : '⚠️') + ' ' + z.triggerLabel + ' : ' + (safe ? distBp + 'bp de marge' : 'DÉPASSÉ de ' + distBp + 'bp') + '</div>';
        }
      });
      g += '</div>';
      return g;
    }

    // TARN TEC10 — trigger 4.40%
    html += _gauge('TARN TEC10 — Seuil coupon ≤ 4.40%', tec10Val, 1.5, 5.5, [
      { from: 1.5, to: 3.50, color: '#059669', label: 'ZONE CONFORT' },
      { from: 3.50, to: 4.00, color: '#D97706', label: 'ZONE OK' },
      { from: 4.00, to: 4.40, color: '#F59E0B', label: 'ATTENTION' },
      { from: 4.40, to: 5.50, color: '#DC2626', label: 'HORS COUPON', trigger: 4.40, direction: 'below', triggerLabel: 'Trigger 4.40%' }
    ]);

    // Digital Mémoire TEC10 — trigger 4.50%
    html += _gauge('Digital Mémoire TEC10 — Seuil coupon ≤ 4.50%', tec10Val, 1.5, 5.5, [
      { from: 1.5, to: 3.50, color: '#059669', label: 'ZONE CONFORT' },
      { from: 3.50, to: 4.10, color: '#D97706', label: 'ZONE OK' },
      { from: 4.10, to: 4.50, color: '#F59E0B', label: 'ATTENTION' },
      { from: 4.50, to: 5.50, color: '#DC2626', label: 'HORS COUPON', trigger: 4.50, direction: 'below', triggerLabel: 'Trigger 4.50%' }
    ]);

    // Range Accrual Euribor — corridor [1.50% - 3.80%]
    html += _gauge('Range Accrual Euribor 3M — Corridor [1.50% - 3.80%]', eur3mVal, 0.0, 5.0, [
      { from: 0.0, to: 1.50, color: '#DC2626', label: 'HORS CORRIDOR BAS', trigger: 1.50, direction: 'above', triggerLabel: 'Borne basse 1.50%' },
      { from: 1.50, to: 2.00, color: '#F59E0B', label: 'PROCHE BORNE' },
      { from: 2.00, to: 3.30, color: '#059669', label: 'ZONE CONFORT' },
      { from: 3.30, to: 3.80, color: '#F59E0B', label: 'PROCHE BORNE' },
      { from: 3.80, to: 5.00, color: '#DC2626', label: 'HORS CORRIDOR HAUT', trigger: 3.80, direction: 'below', triggerLabel: 'Borne haute 3.80%' }
    ]);

    // Hybride Plancher — TEC10 vs seuil bonus 4.00%
    html += _gauge('Hybride Plancher + Digital — Bonus si TEC10 ≤ 4.00%', tec10Val, 1.5, 5.5, [
      { from: 1.5, to: 3.50, color: '#059669', label: 'ZONE CONFORT — Plancher + Bonus' },
      { from: 3.50, to: 4.00, color: '#D97706', label: 'ATTENTION' },
      { from: 4.00, to: 5.50, color: '#DC2626', label: 'PLANCHER SEUL (3%)', trigger: 4.00, direction: 'below', triggerLabel: 'Trigger bonus 4.00%' }
    ]);

    // CMS Steepener — spread 2s10s
    var spread2s10s = (curve.spread_2_10 || 0.57) * 100; // en bp
    html += _gauge('CMS Steepener — Spread 2Y-10Y (coupon = 5 × spread)', spread2s10s / 100, -0.50, 2.00, [
      { from: -0.50, to: 0.0, color: '#DC2626', label: 'INVERSÉE — coupon 0%', trigger: 0.0, direction: 'above', triggerLabel: 'Seuil > 0%' },
      { from: 0.0, to: 0.30, color: '#F59E0B', label: 'FAIBLE' },
      { from: 0.30, to: 0.80, color: '#059669', label: 'ZONE FAVORABLE' },
      { from: 0.80, to: 2.00, color: '#0891B2', label: 'TRÈS PENTUE' }
    ]);

    // Floater TEC10 — plancher à 2.80%, variable au-dessus de 2.20%
    html += _gauge('Floater TEC10 — Plancher 2.80% + variable au-dessus de 2.20%', tec10Val, 1.0, 5.0, [
      { from: 1.0, to: 2.20, color: '#D97706', label: 'PLANCHER SEUL (2.80%)', trigger: 2.20, direction: 'above', triggerLabel: 'Seuil variable 2.20%' },
      { from: 2.20, to: 3.50, color: '#059669', label: 'PLANCHER + VARIABLE ✅' },
      { from: 3.50, to: 5.00, color: '#0891B2', label: 'VARIABLE ÉLEVÉ ↑↑' }
    ]);

    html += '</div>';

    // ═══ SECTION 5: HISTORIQUE TEC10 ═══
    if (tec10.history && tec10.history.length > 0) {
      html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;padding:16px;margin-bottom:20px">';
      html += '<div style="font-size:13px;font-weight:700;color:' + BG.text + ';margin-bottom:10px">📉 Historique TEC10 — 12 derniers mois</div>';
      html += '<div style="display:flex;align-items:flex-end;gap:2px;height:80px;margin-bottom:6px">';
      var minR = Math.min.apply(null, tec10.history.map(function(h) { return h.value; }));
      var maxR = Math.max.apply(null, tec10.history.map(function(h) { return h.value; }));
      var range = maxR - minR || 0.1;
      tec10.history.forEach(function(h) {
        var pct = ((h.value - minR) / range);
        var barH = Math.round(20 + pct * 55);
        var color = h.value >= (tec10.current || 3.10) ? '#0891B2' : '#93C5FD';
        html += '<div style="flex:1;background:' + color + ';height:' + barH + 'px;border-radius:2px 2px 0 0" title="' + h.date + ' : ' + h.value + '%"></div>';
      });
      html += '</div>';
      html += '<div style="display:flex;justify-content:space-between;font-size:8px;color:' + BG.textDim + '">';
      html += '<span>' + tec10.history[0].date + '</span>';
      html += '<span>Min ' + minR.toFixed(3) + '% · Max ' + maxR.toFixed(3) + '% · Avg ' + (tec10.avg_1y || 0).toFixed(3) + '%</span>';
      html += '<span>' + tec10.history[tec10.history.length - 1].date + '</span>';
      html += '</div></div>';
    }

    // ═══ SECTION 5: MACRO & RÉGIME ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:12px">🌍 Contexte macro & régime de marché</div>';
    var regime = ai.regime || 'unknown';
    var regimeColor = regime === 'stagflation' ? '#DC2626' : regime === 'growth' ? '#059669' : '#D97706';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">';
    html += _renderKPI('Régime', (regime.charAt(0).toUpperCase() + regime.slice(1)), regimeColor,
      'Confiance ' + (ai.regime_confidence || '?') + '/5');
    html += _renderKPI('Brent (USD)', '$' + (md.brent_usd || 0).toFixed(1), md.brent_usd > 100 ? '#DC2626' : '#059669',
      'Moy 5j : $' + (md.brent_usd_avg5d || 0).toFixed(1));
    html += _renderKPI('Or (USD)', '$' + _fmt(md.gold_usd || 0), '#D97706',
      'Drawdown ATH : -' + (md.gold_drawdown_from_ath_pct || 0).toFixed(1) + '%');
    html += _renderKPI('VIX', (md.vix || 0).toFixed(1), md.vix > 25 ? '#DC2626' : '#059669',
      'Tendance : ' + (md.vix_trend || '?'));
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">';
    html += _renderKPI('Fed Funds', (md.fed_funds_rate || 0).toFixed(2) + '%', '#7C3AED', 'Delta 6M : ' + (md.fed_funds_rate_delta_6m || 0) + '%');
    html += _renderKPI('CPI (YoY)', (md.cpi_yoy_pct || 0).toFixed(1) + '%', md.cpi_yoy_pct > 2.5 ? '#DC2626' : '#059669', 'Core MoM : ' + (md.cpi_core_mom_pct || 0) + '%');
    html += _renderKPI('PCE (YoY)', (md.pce_yoy_pct || 0).toFixed(1) + '%', md.pce_yoy_pct > 2.5 ? '#DC2626' : '#059669', 'Target BCE : 2.0%');
    html += _renderKPI('EUR/USD', (md.eurusd || 0).toFixed(4), '#2563EB', 'USD Index : ' + (md.trade_weighted_usd || 0).toFixed(1));
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">';
    html += _renderKPI('IG Spread', (md.ig_spread_bps || 0) + 'bp', '#2563EB', 'Investment Grade crédit');
    html += _renderKPI('HY Spread', (md.hy_spread_bps || 0) + 'bp', md.hy_spread_bps > 400 ? '#DC2626' : '#D97706', 'Tendance : ' + (md.hy_spread_trend || '?'));
    html += _renderKPI('S&P 500', _fmt(md.sp500_level || 0), md.sp500_change_1d_pct > 0 ? '#059669' : '#DC2626', (md.sp500_change_1d_pct > 0 ? '+' : '') + (md.sp500_change_1d_pct || 0).toFixed(2) + '% 1j');
    html += _renderKPI('Breakeven 5Y', (md.breakeven_5y || 0).toFixed(2) + '%', '#D97706', 'Anticipation inflation marché');
    html += '</div>';

    // ═══ SECTION 6: ANALYSE IA DU RÉGIME ═══
    if (ai.regime_rationale) {
      html += '<div style="background:' + BG.section + ';border:1px solid ' + regimeColor + '44;border-radius:8px;padding:16px;margin-bottom:20px">';
      html += '<div style="font-size:13px;font-weight:700;color:' + regimeColor + ';margin-bottom:8px">🤖 Analyse IA — Régime ' + regime + '</div>';
      html += '<div style="font-size:12px;color:' + BG.text + ';line-height:1.6">' + ai.regime_rationale + '</div>';
      if (ai.adjustments && ai.adjustments.length > 0) {
        html += '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px">';
        ai.adjustments.forEach(function(adj) {
          var adjColor = (adj.params && adj.params.delta_pct > 0) ? '#059669' : '#DC2626';
          html += '<div style="padding:8px 10px;background:' + BG.row1 + ';border-radius:6px;border-left:3px solid ' + adjColor + ';font-size:10px">';
          html += '<strong style="color:' + adjColor + '">' + adj.action + '</strong>';
          html += '<div style="color:' + BG.textDim + ';margin-top:2px">Conviction ' + (adj.conviction || '?') + '/5 · ' + (adj.rationale || '').substring(0, 100) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }

    // ═══ SECTION 7: IMPACT CARRY TRADE ═══
    html += '<div style="background:#ECFDF5;border:2px solid #059669;border-radius:8px;padding:16px;margin-bottom:20px">';
    html += '<div style="font-size:14px;font-weight:700;color:#059669;margin-bottom:10px">💡 Impact sur le carry trade</div>';
    var tec10Val = tec10.current || 3.10;
    var spreadVsEmprunt = tec10Val - 2.90;
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:9px;color:' + BG.textDim + '">Spread TEC10 vs emprunt</div>';
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + (spreadVsEmprunt > 0 ? '#059669' : '#DC2626') + '">+' + (spreadVsEmprunt * 100).toFixed(0) + 'bp</div>';
    html += '<div style="font-size:9px;color:' + BG.textDim + '">' + tec10Val.toFixed(2) + '% - 2.90%</div></div>';

    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:9px;color:' + BG.textDim + '">Marge TARN (trigger 4.40%)</div>';
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:#0891B2">+' + ((4.40 - tec10Val) * 100).toFixed(0) + 'bp</div>';
    html += '<div style="font-size:9px;color:' + BG.textDim + '">4.40% - ' + tec10Val.toFixed(2) + '% de marge</div></div>';

    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:9px;color:' + BG.textDim + '">Euribor dans corridor Range Accrual</div>';
    var eur3mVal = eur3m.current || 2.50;
    var inCorridor = eur3mVal >= 1.50 && eur3mVal <= 3.80;
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + (inCorridor ? '#059669' : '#DC2626') + '">' + (inCorridor ? '✅ OUI' : '❌ NON') + '</div>';
    html += '<div style="font-size:9px;color:' + BG.textDim + '">' + eur3mVal.toFixed(2) + '% dans [1.50%-3.80%]</div></div>';
    html += '</div></div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ INTERACTIVE: Rate detail panel (click on a card) ═══

  window._mktOpenRate = function(rateId) {
    var panel = document.getElementById('mkt-rate-detail');
    if (!panel || !_data.rates) return;

    var yields = _data.rates.yields || {};
    var policy = _data.rates.policy_rates || {};
    var rateObj = yields[rateId] || policy[rateId.replace('_', '')] || null;

    // Euribor special case
    if (rateId === '_euribor3m' && policy.euribor_3m) rateObj = policy.euribor_3m;

    if (!rateObj) { panel.innerHTML = '<div style="padding:12px;color:#DC2626;font-size:12px">Pas de données pour ce taux</div>'; return; }

    var history = rateObj.history || [];
    var current = rateObj.current || 0;
    var label = rateObj.name || rateId;

    var html = '<div style="background:#FFFFFF;border:2px solid #2563EB;border-radius:8px;padding:16px;animation:fadeIn 0.2s">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html += '<div style="font-size:14px;font-weight:700;color:#2563EB">📊 ' + label + ' — Analyse détaillée</div>';
    html += '<button onclick="document.getElementById(\'mkt-rate-detail\').innerHTML=\'\'" style="background:none;border:1px solid #D1D9E6;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:11px;color:#64748B">✕ Fermer</button>';
    html += '</div>';

    if (history.length < 2) {
      // Taux sans historique (Euribor, BCE) — affichage simple
      html += '<div style="padding:16px;text-align:center">';
      html += '<div style="font-family:var(--mono);font-size:32px;font-weight:800;color:#2563EB">' + current.toFixed(2) + '%</div>';
      html += '<div style="font-size:11px;color:#64748B;margin-top:4px">' + (rateObj.description || '') + '</div>';
      html += '<div style="font-size:10px;color:#94A3B8;margin-top:4px">Date : ' + (rateObj.date || '—') + ' · Historique détaillé non disponible (taux quotidien sans série)</div>';
      html += '</div>';

      // Thresholds
      html += '<div style="margin-top:12px;font-size:11px;color:#1A202C">';
      html += '<strong>Seuils produits liés :</strong>';
      if (rateId === '_euribor3m') {
        html += '<div style="margin-top:6px">Range Accrual corridor [1.50% — 3.80%] : ';
        var dist1 = Math.round((current - 1.50) * 100);
        var dist2 = Math.round((3.80 - current) * 100);
        html += '<span style="color:#059669;font-weight:700">+' + dist1 + 'bp</span> au-dessus de la borne basse · ';
        html += '<span style="color:#059669;font-weight:700">+' + dist2 + 'bp</span> en dessous de la borne haute</div>';
      }
      html += '</div>';
      html += '</div>';
      panel.innerHTML = html;
      return;
    }

    var allVals = history.map(function(h) { return h.value; });
    var minAll = Math.min.apply(null, allVals);
    var maxAll = Math.max.apply(null, allVals);
    var avgAll = allVals.reduce(function(a,b){return a+b;}, 0) / allVals.length;
    var nbObs = history.length;

    // Compute stats by period
    function _periodStats(hist, label, nObs) {
      var slice = hist.slice(-nObs);
      if (slice.length < 2) return null;
      var vals = slice.map(function(h){return h.value;});
      return {
        label: label, count: vals.length,
        min: Math.min.apply(null, vals), max: Math.max.apply(null, vals),
        avg: vals.reduce(function(a,b){return a+b;},0) / vals.length,
        first: vals[0], last: vals[vals.length-1],
        change: vals[vals.length-1] - vals[0],
        startDate: slice[0].date, endDate: slice[slice.length-1].date
      };
    }

    var periods = [
      _periodStats(history, '12 mois', 12),
      _periodStats(history, '2 ans', 24),
      _periodStats(history, '5 ans', 60),
      _periodStats(history, '10 ans', 120)
    ].filter(Boolean);

    // KPI cards
    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px">';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:8px;color:#94A3B8">ACTUEL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#2563EB">' + current.toFixed(2) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:8px;color:#94A3B8">MIN (' + nbObs + ' obs)</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + minAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:8px;color:#94A3B8">MAX</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#DC2626">' + maxAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:8px;color:#94A3B8">MOYENNE</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#7C3AED">' + avgAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:8px;color:#94A3B8">OBSERVATIONS</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#1A202C">' + nbObs + '</div></div>';
    html += '</div>';

    // Period stats table
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px">';
    html += '<thead><tr style="border-bottom:2px solid #D1D9E6">';
    html += '<th style="padding:6px;text-align:left;color:#64748B;font-size:9px">PÉRIODE</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:9px">MIN</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:9px">MAX</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:9px">MOYENNE</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:9px">VARIATION</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:9px">OBS</th>';
    html += '</tr></thead><tbody>';
    periods.forEach(function(p, i) {
      var bg = i % 2 === 0 ? '#FFFFFF' : '#F4F6F9';
      var chgColor = p.change >= 0 ? '#DC2626' : '#059669';
      html += '<tr style="background:' + bg + ';border-bottom:1px solid #D1D9E6">';
      html += '<td style="padding:6px;font-weight:700">' + p.label + ' <span style="font-size:8px;color:#94A3B8">(' + p.startDate + '→' + p.endDate + ')</span></td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#059669">' + p.min.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#DC2626">' + p.max.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#7C3AED">' + p.avg.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + chgColor + '">' + (p.change >= 0 ? '+' : '') + (p.change * 100).toFixed(0) + 'bp</td>';
      html += '<td style="padding:6px;text-align:right;color:#94A3B8">' + p.count + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    // Full history chart
    var chartH = 120;
    var chartRange = maxAll - minAll || 0.1;
    var chartPad = chartRange * 0.1;
    var cMin = minAll - chartPad;
    var cMax = maxAll + chartPad;
    var cRange = cMax - cMin;

    html += '<div style="font-size:11px;font-weight:700;color:#1A202C;margin-bottom:6px">Historique complet (' + nbObs + ' observations mensuelles)</div>';
    html += '<div style="position:relative;height:' + chartH + 'px;background:#F8F9FB;border:1px solid #D1D9E6;border-radius:6px;padding:0 4px">';

    // Key threshold lines
    var thresholds = [];
    if (rateId === 'oat_fr_10y') {
      thresholds = [
        { val: 4.40, label: 'TARN trigger 4.40%', color: '#DC2626' },
        { val: 4.50, label: 'Digital trigger 4.50%', color: '#D97706' },
        { val: 4.00, label: 'Hybride bonus 4.00%', color: '#F59E0B' },
        { val: 2.90, label: 'Coût emprunt 2.90%', color: '#7C3AED' }
      ];
    } else if (rateId === 'oat_fr_5y') {
      thresholds = [{ val: 2.90, label: 'Coût emprunt 2.90%', color: '#7C3AED' }];
    } else if (rateId === '_euribor3m' || rateId === 'euribor_3m') {
      thresholds = [
        { val: 1.50, label: 'Borne basse corridor 1.50%', color: '#DC2626' },
        { val: 3.80, label: 'Borne haute corridor 3.80%', color: '#DC2626' }
      ];
    }
    thresholds.forEach(function(t) {
      if (t.val >= cMin && t.val <= cMax) {
        var y = ((t.val - cMin) / cRange) * chartH;
        html += '<div style="position:absolute;left:0;right:0;bottom:' + y + 'px;height:1px;background:' + t.color + ';opacity:0.5;z-index:1"></div>';
        html += '<div style="position:absolute;right:4px;bottom:' + (y + 2) + 'px;font-size:7px;color:' + t.color + ';font-weight:700;z-index:2">' + t.label + '</div>';
      }
    });

    // Bars
    html += '<div style="display:flex;align-items:flex-end;height:100%;gap:1px;position:relative;z-index:3">';
    history.forEach(function(h) {
      var barH = ((h.value - cMin) / cRange) * chartH;
      var isAboveThreshold = false;
      if (rateId === 'oat_fr_10y' && h.value > 4.40) isAboveThreshold = true;
      var color = isAboveThreshold ? '#DC2626' : '#93C5FD';
      if (h.date === history[history.length-1].date) color = '#2563EB';
      html += '<div style="flex:1;background:' + color + ';height:' + Math.max(2, barH) + 'px;border-radius:1px 1px 0 0;min-width:2px" title="' + h.date + ' : ' + h.value.toFixed(3) + '%"></div>';
    });
    html += '</div></div>';

    // Date labels
    html += '<div style="display:flex;justify-content:space-between;font-size:7px;color:#94A3B8;margin-top:2px">';
    html += '<span>' + history[0].date + '</span>';
    if (history.length > 24) html += '<span>' + history[Math.floor(history.length/2)].date + '</span>';
    html += '<span>' + history[history.length-1].date + '</span>';
    html += '</div>';

    // Threshold breach analysis
    if (thresholds.length > 0) {
      html += '<div style="margin-top:12px;font-size:11px;font-weight:700;color:#1A202C;margin-bottom:6px">Analyse de franchissement des seuils :</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(' + Math.min(thresholds.length, 3) + ',1fr);gap:8px">';
      thresholds.forEach(function(t) {
        var above = 0, below = 0, lastBreach = null, breachCount = 0, prevAbove = null;
        history.forEach(function(h) {
          var isAbove = h.value > t.val;
          if (isAbove) { above++; if (!lastBreach || !prevAbove) lastBreach = h.date; }
          else below++;
          if (prevAbove !== null && prevAbove !== isAbove) breachCount++;
          prevAbove = isAbove;
        });
        var pctAbove = Math.round(above / history.length * 100);
        var pctBelow = 100 - pctAbove;
        var currentAbove = current > t.val;

        html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;border-left:3px solid ' + t.color + '">';
        html += '<div style="font-size:9px;font-weight:700;color:' + t.color + '">' + t.label + '</div>';
        html += '<div style="margin-top:6px;font-size:10px;color:#1A202C">';
        html += 'Temps au-dessus : <strong>' + pctAbove + '%</strong> (' + above + '/' + history.length + ')<br>';
        html += 'Temps en dessous : <strong>' + pctBelow + '%</strong> (' + below + '/' + history.length + ')<br>';
        html += 'Franchissements : <strong>' + breachCount + '</strong><br>';
        if (lastBreach) html += 'Dernier au-dessus : <strong>' + lastBreach + '</strong><br>';
        else html += 'Jamais au-dessus sur la période<br>';
        html += 'Actuel : <strong style="color:' + (currentAbove ? '#DC2626' : '#059669') + '">' + (currentAbove ? 'AU-DESSUS ⚠️' : 'EN DESSOUS ✅') + '</strong>';
        html += '</div></div>';
      });
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ═══ INTERACTIVE: Custom threshold analyzer ═══

  window._mktSimModeChange = function() {
    var mode = document.getElementById('mkt-sim-mode').value;
    var wrap2 = document.getElementById('mkt-sim-val2-wrap');
    var label1 = document.getElementById('mkt-sim-label1');
    if (mode === 'corridor') {
      wrap2.style.display = '';
      label1.textContent = 'BORNE BASSE (%)';
    } else {
      wrap2.style.display = 'none';
      label1.textContent = 'SEUIL (%)';
    }
  };

  window._mktSimAnalyze = function() {
    var rateSel = document.getElementById('mkt-sim-rate').value;
    var mode = document.getElementById('mkt-sim-mode').value;
    var val1 = parseFloat(document.getElementById('mkt-sim-val1').value);
    var val2 = parseFloat(document.getElementById('mkt-sim-val2').value);
    var resultDiv = document.getElementById('mkt-sim-result');
    if (!_data.rates || !resultDiv) return;

    // Get history
    var rateMap = {
      tec10: { key: 'oat_fr_10y', label: 'TEC10', section: 'yields' },
      oat5y: { key: 'oat_fr_5y', label: 'OAT 5Y', section: 'yields' },
      oat2y: { key: 'oat_fr_2y', label: 'OAT 2Y', section: 'yields' },
      euribor3m: { key: 'euribor_3m', label: 'Euribor 3M', section: 'policy_rates' }
    };
    var rm = rateMap[rateSel];
    var history = [];
    var current = 0;
    if (rm.section === 'yields' && _data.rates.yields && _data.rates.yields[rm.key]) {
      history = _data.rates.yields[rm.key].history || [];
      current = _data.rates.yields[rm.key].current || 0;
    } else if (rm.section === 'policy_rates' && _data.rates.policy_rates && _data.rates.policy_rates[rm.key]) {
      current = _data.rates.policy_rates[rm.key].current || 0;
      // Policy rates don't have history array, use single point
      history = [{ date: _data.rates.policy_rates[rm.key].date, value: current }];
    }

    if (history.length === 0) {
      resultDiv.innerHTML = '<div style="padding:12px;color:#DC2626;font-size:12px">Pas de données historiques pour ' + rm.label + '</div>';
      return;
    }

    // Analyze
    var inZone = 0, outZone = 0, breaches = [];
    var lastState = null;
    history.forEach(function(h) {
      var v = h.value;
      var isIn = false;
      if (mode === 'below') isIn = v <= val1;
      else if (mode === 'above') isIn = v >= val1;
      else isIn = v >= val1 && v <= val2;

      if (isIn) inZone++; else outZone++;
      if (lastState !== null && lastState !== isIn) {
        breaches.push({ date: h.date, value: v, entered: isIn });
      }
      lastState = isIn;
    });

    var total = inZone + outZone;
    var pctIn = total > 0 ? Math.round(inZone / total * 100) : 0;
    var currentIn = false;
    if (mode === 'below') currentIn = current <= val1;
    else if (mode === 'above') currentIn = current >= val1;
    else currentIn = current >= val1 && current <= val2;

    // Build result HTML
    var html = '';

    // KPI row
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">';
    html += '<div style="padding:10px;background:' + (currentIn ? '#ECFDF5' : '#FEF2F2') + ';border-radius:6px;text-align:center;border:1px solid ' + (currentIn ? '#059669' : '#DC2626') + '">';
    html += '<div style="font-size:9px;color:#64748B">STATUT ACTUEL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (currentIn ? '#059669' : '#DC2626') + '">' + (currentIn ? '✅ DANS' : '❌ HORS') + '</div>';
    html += '<div style="font-size:9px;color:#64748B">' + rm.label + ' = ' + current.toFixed(2) + '%</div></div>';

    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:9px;color:#64748B">TEMPS DANS LA ZONE</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (pctIn >= 80 ? '#059669' : pctIn >= 50 ? '#D97706' : '#DC2626') + '">' + pctIn + '%</div>';
    html += '<div style="font-size:9px;color:#64748B">' + inZone + '/' + total + ' observations</div></div>';

    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:9px;color:#64748B">FRANCHISSEMENTS</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#7C3AED">' + breaches.length + '</div>';
    html += '<div style="font-size:9px;color:#64748B">croisements de seuil</div></div>';

    var distBp = 0;
    if (mode === 'below') distBp = Math.round((val1 - current) * 100);
    else if (mode === 'above') distBp = Math.round((current - val1) * 100);
    else distBp = Math.round(Math.min(current - val1, val2 - current) * 100);
    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:9px;color:#64748B">MARGE AU SEUIL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (distBp > 0 ? '#059669' : '#DC2626') + '">' + (distBp > 0 ? '+' : '') + distBp + 'bp</div>';
    html += '<div style="font-size:9px;color:#64748B">distance au plus proche</div></div>';
    html += '</div>';

    // Visual chart with zone overlay
    html += '<div style="position:relative;background:#F8F9FB;border:1px solid #D1D9E6;border-radius:6px;padding:12px;margin-bottom:8px">';
    html += '<div style="font-size:10px;font-weight:700;color:#1A202C;margin-bottom:8px">' + rm.label + ' — Historique vs ';
    if (mode === 'corridor') html += 'corridor [' + val1.toFixed(2) + '% — ' + val2.toFixed(2) + '%]';
    else html += 'seuil ' + (mode === 'below' ? '≤' : '≥') + ' ' + val1.toFixed(2) + '%';
    html += '</div>';

    // Compute chart bounds
    var allVals = history.map(function(h) { return h.value; });
    var chartMin = Math.min.apply(null, allVals.concat([val1, mode === 'corridor' ? val2 : val1])) - 0.15;
    var chartMax = Math.max.apply(null, allVals.concat([val1, mode === 'corridor' ? val2 : val1])) + 0.15;
    var chartRange = chartMax - chartMin || 0.3;
    var chartH = 100;

    html += '<div style="position:relative;height:' + chartH + 'px">';
    // Zone overlay
    if (mode === 'corridor') {
      var zoneBottom = ((val1 - chartMin) / chartRange) * chartH;
      var zoneTop = ((val2 - chartMin) / chartRange) * chartH;
      html += '<div style="position:absolute;left:0;right:0;bottom:' + zoneBottom + 'px;height:' + (zoneTop - zoneBottom) + 'px;background:#059669;opacity:0.12;border-radius:3px"></div>';
      // Lines for corridor
      html += '<div style="position:absolute;left:0;right:0;bottom:' + zoneBottom + 'px;height:1px;background:#059669;opacity:0.6"></div>';
      html += '<div style="position:absolute;left:0;right:0;bottom:' + zoneTop + 'px;height:1px;background:#059669;opacity:0.6"></div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (zoneBottom + 2) + 'px;font-size:8px;color:#059669;font-weight:700">' + val1.toFixed(2) + '%</div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (zoneTop + 2) + 'px;font-size:8px;color:#059669;font-weight:700">' + val2.toFixed(2) + '%</div>';
    } else {
      var lineY = ((val1 - chartMin) / chartRange) * chartH;
      html += '<div style="position:absolute;left:0;right:0;bottom:' + lineY + 'px;height:2px;background:#DC2626;opacity:0.6"></div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (lineY + 3) + 'px;font-size:8px;color:#DC2626;font-weight:700">Seuil ' + val1.toFixed(2) + '%</div>';
      // Zone overlay
      if (mode === 'below') {
        html += '<div style="position:absolute;left:0;right:0;bottom:0;height:' + lineY + 'px;background:#059669;opacity:0.08"></div>';
      } else {
        html += '<div style="position:absolute;left:0;right:0;bottom:' + lineY + 'px;top:0;background:#059669;opacity:0.08"></div>';
      }
    }

    // Data bars
    var barW = Math.max(4, Math.floor(100 / history.length) - 1);
    html += '<div style="display:flex;align-items:flex-end;height:100%;gap:1px">';
    history.forEach(function(h) {
      var barBottom = ((h.value - chartMin) / chartRange) * chartH;
      var isIn = false;
      if (mode === 'below') isIn = h.value <= val1;
      else if (mode === 'above') isIn = h.value >= val1;
      else isIn = h.value >= val1 && h.value <= val2;
      var color = isIn ? '#059669' : '#DC2626';
      html += '<div style="flex:1;position:relative;height:100%">';
      html += '<div style="position:absolute;bottom:0;left:0;right:0;height:' + barBottom + 'px;background:' + color + ';opacity:0.7;border-radius:2px 2px 0 0" title="' + h.date + ' : ' + h.value + '% — ' + (isIn ? 'DANS' : 'HORS') + '"></div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    // Date labels
    html += '<div style="display:flex;justify-content:space-between;font-size:8px;color:#94A3B8;margin-top:3px">';
    html += '<span>' + history[0].date + '</span>';
    html += '<span style="color:#059669">■ Dans la zone</span><span style="color:#DC2626">■ Hors zone</span>';
    html += '<span>' + history[history.length - 1].date + '</span>';
    html += '</div>';
    html += '</div>';

    // Breach list
    if (breaches.length > 0) {
      html += '<div style="font-size:10px;font-weight:700;color:#1A202C;margin-bottom:4px">Franchissements :</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
      breaches.forEach(function(b) {
        html += '<span style="padding:2px 8px;border-radius:3px;font-size:9px;font-family:var(--mono);background:' + (b.entered ? '#ECFDF5' : '#FEF2F2') + ';color:' + (b.entered ? '#059669' : '#DC2626') + '">';
        html += b.date + ' ' + b.value.toFixed(3) + '% ' + (b.entered ? '→ ENTRE' : '→ SORTI') + '</span>';
      });
      html += '</div>';
    }

    resultDiv.innerHTML = html;
  };

  window.renderMarketDashboard = async function(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B">Chargement des données marché...</div>';
    if (!_data.loaded) await _loadData();
    _render(container);
    // Init mode visibility
    setTimeout(function() { if (window._mktSimModeChange) _mktSimModeChange(); }, 50);
  };

  console.log('[StructBoard] Market Dashboard v1.0 loaded');
})();

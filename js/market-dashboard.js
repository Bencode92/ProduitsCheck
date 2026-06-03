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
    text: '#1A202C', textMuted: '#64748B', textDim: '#475569'
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
      '<div style="font-size:11px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.8px;text-transform:uppercase">' + label + '</div>' +
      '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + color + ';margin:6px 0">' + value + '</div>' +
      '<div style="font-size:11px;color:' + BG.textDim + ';line-height:1.4">' + sub + '</div></div>';
  }

  function _render(container) {
    var r = _data.rates || {};
    var mi = _data.mi || {};
    var md = mi.market_data_input || {};
    var ai = mi.ai_response || {};

    var yields = r.yields || {};
    var policy = r.policy_rates || {};
    var curve = r.yield_curve || {};

    var tec10 = yields.tec10_fr || yields.oat_fr_10y || {};
    var oat5y = yields.oat_fr_5y || {};
    var oat2y = yields.oat_fr_2y || {};
    var bce = policy.ecb_deposit_rate || {};
    var bceMain = policy.ecb_main_rate || {};
    var eur3m = yields.euribor_3m || policy.euribor_3m || {};
    var eur6m = policy.euribor_6m || {};

    var html = '<div style="background:' + BG.wrap + ';border-radius:12px;padding:24px;color:' + BG.text + '">';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid ' + BG.border + '">';
    html += '<div style="font-size:18px;font-weight:800;color:' + BG.text + '">📈 Données de Marché</div>';
    var fetchDate = r.fetched_at ? new Date(r.fetched_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    html += '<div style="font-size:10px;color:' + BG.textDim + ';padding:4px 10px;background:' + BG.row1 + ';border-radius:4px">Dernière MAJ : ' + fetchDate + ' · Source : ECB + Twelve Data + IA</div>';
    html += '</div>';

    // ═══ VERDICT DU JOUR : synthèse 5 secondes ═══
    (function() {
      var vSpread = Math.round((curve.spread_2_10 || 0) * 100);
      var vTec = tec10.current || 3.10;
      var vHy = md.hy_spread_bps || 0;
      var vVix = md.vix || 0;
      var normal = curve.shape === 'normal';
      var light, title, color, bg;
      if (!normal || vSpread < 0) { light = '🔴'; title = 'Défavorable aux structurés de taux'; color = '#DC2626'; bg = '#FEF2F2'; }
      else if (vSpread < 30 || (vHy && vHy > 450) || (vVix && vVix > 25)) { light = '🟠'; title = 'Favorable sous conditions — vigilance'; color = '#D97706'; bg = '#FFFBEB'; }
      else { light = '🟢'; title = 'Favorable aux structurés de taux capital garanti'; color = '#059669'; bg = '#ECFDF5'; }
      var chips = [];
      chips.push((normal ? '🟢' : '🔴') + ' Courbe ' + (normal ? 'normale' : 'inversée') + ' (' + (vSpread >= 0 ? '+' : '') + vSpread + 'bp 2s10s)');
      chips.push((vTec >= 2.8 ? '🟢' : '🟠') + ' TEC10 ' + vTec.toFixed(2) + '% ' + (vTec >= 2.8 ? '(budget option correct)' : '(bas)'));
      if (vHy) chips.push((vHy > 450 ? '🟠' : '🟢') + ' HY spread ' + vHy + 'bp');
      if (vVix) chips.push((vVix > 25 ? '🟠' : '🟢') + ' VIX ' + vVix.toFixed(0));
      if (ai.regime && ai.regime !== 'unknown') chips.push('🌍 Régime ' + ai.regime);
      html += '<div style="background:' + bg + ';border:1px solid ' + color + '55;border-left:5px solid ' + color + ';border-radius:10px;padding:13px 16px;margin-bottom:20px">';
      html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
      html += '<span style="font-size:20px">' + light + '</span>';
      html += '<span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:' + color + '">Verdict du jour</span>';
      html += '<span style="font-size:14px;font-weight:700;color:#0F172A">' + title + '</span></div>';
      html += '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">';
      chips.forEach(function(c) { html += '<span style="font-size:10.5px;background:#FFFFFF;border:1px solid ' + color + '33;border-radius:14px;padding:3px 10px;color:#334155">' + c + '</span>'; });
      html += '</div></div>';
    })();

    // ═══ SECTION 1: TAUX SOUVERAINS (cliquables) ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:4px">🏛️ Taux souverains EUR (zone euro AAA)</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + ';margin-bottom:10px">Cliquez sur un taux pour voir l\'analyse détaillée et l\'historique</div>';

    // Clickable rate cards
    var eur12m = yields.euribor_12m || {};

    var rateCards = [
      { id: 'tec10_fr', label: 'TEC10 (OAT 10 ans)', data: tec10, color: '#0891B2',
        desc: 'Taux d\'État français 10 ans (Banque de France). Référence pour les TARN et produits structurés taux longs.',
        sub: 'Vol ' + (tec10.vol_annualized_bps || 18) + 'bp · ' + (tec10.direction || 'stable') + ' · Range ' + (tec10.low_1y || '?') + '-' + (tec10.high_1y || '?') },
      { id: 'oat_fr_5y', label: 'OAT 5 ans', data: oat5y, color: '#2563EB',
        desc: 'Taux souverain à 5 ans. Sert au calcul du budget option des produits structurés 5 ans.',
        sub: 'Vol ' + (oat5y.vol_annualized_bps || 22) + 'bp · ' + (oat5y.direction || 'stable') + ' · Spread 5-10Y +' + Math.round(((tec10.current||3.10) - (oat5y.current||2.70)) * 100) + 'bp' },
      { id: 'oat_fr_2y', label: 'OAT 2 ans', data: oat2y, color: '#7C3AED',
        desc: 'Taux souverain à 2 ans. Reflète les anticipations de politique monétaire BCE à court terme.',
        sub: 'Vol ' + (oat2y.vol_annualized_bps || 26) + 'bp · ' + (oat2y.direction || 'stable') + ' · Spread 2-10Y +' + Math.round(((tec10.current||3.10) - (oat2y.current||2.53)) * 100) + 'bp' },
      { id: 'euribor_3m', label: 'Euribor 3M', data: eur3m, color: '#D97706',
        desc: 'Taux interbancaire euro à 3 mois. Piloté par la BCE. Référence pour les Range Accrual.',
        sub: 'Réf Range Accrual · piloté par BCE' },
      { id: 'euribor_12m', label: 'Euribor 12M', data: eur12m, color: '#EA580C',
        desc: 'Taux interbancaire euro à 12 mois. Reflète les anticipations de taux BCE à 1 an. Utilisé pour les prêts immobiliers et certains structurés.',
        sub: 'Anticipe la politique BCE à 1 an' }
    ];

    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:8px">';
    rateCards.forEach(function(rc) {
      var val = rc.data.current || 0;
      html += '<div onclick="_mktOpenRate(\'' + rc.id + '\')" style="padding:14px;border:1px solid ' + BG.border + ';border-radius:8px;border-left:4px solid ' + rc.color + ';background:' + BG.section + ';cursor:pointer;transition:all 0.2s" onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.1)\'" onmouseout="this.style.boxShadow=\'none\'">';
      html += '<div style="font-size:11px;font-weight:700;color:' + BG.textDim + ';letter-spacing:0.8px;text-transform:uppercase">' + rc.label + ' <span style="color:' + rc.color + '">▼ clic</span></div>';
      html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + rc.color + ';margin:4px 0">' + val.toFixed(2) + '%</div>';
      if (rc.desc) html += '<div style="font-size:11px;color:' + BG.text + ';line-height:1.3;margin-bottom:3px">' + rc.desc + '</div>';
      html += '<div style="font-size:11px;color:' + BG.textDim + ';line-height:1.3">' + rc.sub + '</div>';
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
      ['Emprunt\nSG', 3.10, '#DC2626'],
      ['TEC10\n10 ans', tec10.current || 3.10, '#0891B2']
    ];
    barData.forEach(function(b) {
      var h = Math.round((b[1] / 4.0) * 100);
      html += '<div style="flex:1;text-align:center">';
      html += '<div style="background:' + b[2] + ';height:' + h + 'px;border-radius:6px 6px 0 0;margin:0 3px;display:flex;align-items:flex-start;justify-content:center;padding-top:6px;min-height:30px">';
      html += '<span style="font-family:var(--mono);font-size:13px;font-weight:800;color:#fff">' + b[1].toFixed(2) + '%</span></div>';
      html += '<div style="font-size:11px;color:' + BG.textMuted + ';margin-top:4px;white-space:pre-line;line-height:1.2">' + b[0] + '</div></div>';
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

    // ═══ SECTION 4: JAUGES PRODUITS (collapsible, connectées au portfolio) ═══
    var tec10Val = tec10.current || 3.10;
    var eur3mVal = eur3m.current || 2.50;

    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-gauges-body\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶ Afficher\':\'▼ Masquer\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#2563EB">🎯 Jauges produits — Position vs triggers du portefeuille</div>';
    html += '<span style="font-size:10px;color:#64748B">▼ Masquer</span></div>';
    html += '<div id="mkt-gauges-body" style="display:block;padding:0 16px 16px">';

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
        g += '<div style="position:absolute;left:' + leftPct + '%;width:' + widthPct + '%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:' + z.color + ';pointer-events:none">' + z.label + '</div>';
      });
      // Current position marker
      g += '<div style="position:absolute;left:' + currentPct + '%;top:0;width:3px;height:100%;background:#2563EB;border-radius:2px;z-index:2"></div>';
      g += '<div style="position:absolute;left:' + Math.max(0, currentPct - 3) + '%;top:-2px;z-index:3">';
      g += '<div style="background:#2563EB;color:#fff;padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:11px;font-weight:700">' + currentVal.toFixed(2) + '</div></div>';
      g += '</div>';
      // Scale labels
      g += '<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:11px;color:' + BG.textDim + '">';
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

    // ── Jauges pilotées par le PORTEFEUILLE RÉEL ──────────────────────────────────────
    var _pf = (window.app && app.state && app.state.portfolio) ? app.state.portfolio : [];
    function _rateRef(p) {
      var t = ((p.name || '') + ' ' + (((p.coupon || {}).triggerDetail) || '')).toLowerCase();
      if (/euribor/.test(t)) return { val: eur3mVal, label: 'Euribor 3M' };
      if (/oat 5|5 ans|cms/.test(t)) return { val: (oat5y.current || 2.70), label: 'OAT 5Y' };
      return { val: tec10Val, label: 'TEC10' };
    }
    var _gHtml = '', _shown = 0, _noLevel = 0;
    _pf.forEach(function(p) {
      var name = (p.name || 'Produit structuré').slice(0, 50);
      var coupTxt = (p.coupon && p.coupon.rate) ? ' — coupon ' + p.coupon.rate + '%' : '';
      // Produit de TAUX : coupon si taux ≤ trigger
      if ((/rate|taux/i.test(p.underlyingType || '')) && p.coupon && p.coupon.trigger) {
        var ref = _rateRef(p);
        var trig = parseFloat(p.coupon.trigger);
        var maxR = Math.max(5.5, trig + 1, ref.val + 1);
        _gHtml += _gauge('📌 ' + name + coupTxt + ' si ' + ref.label + ' ≤ ' + trig + '%', ref.val, 0, maxR, [
          { from: 0, to: trig * 0.85, color: '#059669', label: 'CONFORT' },
          { from: trig * 0.85, to: trig, color: '#D97706', label: 'OK' },
          { from: trig, to: maxR, color: '#DC2626', label: 'HORS COUPON', trigger: trig, direction: 'below', triggerLabel: 'Trigger ' + trig + '%' }
        ]);
        _shown++; return;
      }
      // Produit EQUITY : barrière capital (+ barrière coupon)
      var bar = parseFloat(p.capitalProtection && p.capitalProtection.barrier);
      if (!isNaN(bar) && bar > 0) {
        var cBar = parseFloat(p.capitalProtection && p.capitalProtection.barrierCoupon);
        var coupTrig = (!isNaN(cBar) && cBar > 0) ? cBar : bar;
        var lvl = parseFloat(p.tracking && p.tracking.level);
        var hasLvl = !isNaN(lvl); if (!hasLvl) { lvl = 100; _noLevel++; }
        var lo = Math.min(40, bar - 10);
        var zones = [{ from: lo, to: bar, color: '#DC2626', label: 'PERTE CAPITAL', trigger: bar, direction: 'above', triggerLabel: 'Barrière ' + bar + '%' }];
        if (coupTrig > bar) zones.push({ from: bar, to: coupTrig, color: '#F59E0B', label: 'PAS DE COUPON' });
        zones.push({ from: coupTrig, to: 100, color: '#059669', label: 'COUPON', trigger: coupTrig, direction: 'above', triggerLabel: 'Coupon ≥ ' + coupTrig + '%' });
        zones.push({ from: 100, to: 120, color: '#0891B2', label: 'AUTOCALL' });
        _gHtml += _gauge('📌 ' + name + coupTxt + (hasLvl ? '' : ' — ⚠ niveau non saisi'), lvl, lo, 120, zones, '%');
        _shown++; return;
      }
    });
    if (_shown === 0) {
      _gHtml = '<div style="padding:20px;text-align:center;color:#64748B;font-size:12px">Aucun produit avec trigger exploitable.<br>Renseigne la barrière (equity) ou le seuil de coupon (taux) via l\'édition produit.</div>';
    }
    html += '<div style="font-size:10px;color:#64748B;margin-bottom:10px">' + _shown + ' produit(s) de votre portefeuille · position actuelle vs triggers' + (_noLevel > 0 ? ' · ⚠ ' + _noLevel + ' sans niveau saisi (affiché à 100%)' : '') + '</div>';
    html += _gHtml;
    html += '</div></div>';

    // ═══ SECTION 4b: PRODUITS TAUX BROCHURE (scan auto) ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-brochure-body\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶ Afficher\':\'▼ Masquer\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#7C3AED">📄 Produits taux en brochure — détection auto des seuils</div>';
    html += '<span style="font-size:10px;color:#64748B">▶ Afficher</span></div>';
    html += '<div id="mkt-brochure-body" style="display:none;padding:0 16px 16px">';
    html += '<div id="mkt-brochure-content" style="text-align:center;padding:12px;color:#475569;font-size:11px">Chargement des brochures...</div>';
    html += '</div></div>';

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
    // ═══ SYNTHÈSE SWISS LIFE GESTION PRIVÉE (avril 2026) ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-swisslife\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶\':\'▼\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#1E40AF">📄 Synthèse Swiss Life Gestion Privée — Forces Spéciales Op. n°5 (Avril 2026)</div>';
    html += '<span style="font-size:10px;color:#64748B">▶</span></div>';
    html += '<div id="mkt-swisslife" style="display:none;padding:0 16px 16px">';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';

    // Vision macro
    html += '<div style="padding:12px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:6px">';
    html += '<div style="font-size:11px;font-weight:700;color:#DC2626;margin-bottom:6px">⚠️ Contexte macro — Choc géopolitique</div>';
    html += '<div style="font-size:11px;color:#1A202C;line-height:1.6">';
    html += '• Conflit Iran / Moyen-Orient → cessez-le-feu temporaire (15j)<br>';
    html += '• Hausse prix énergie → <strong>inflation au cœur des préoccupations</strong><br>';
    html += '• BCE + Fed : <strong>marges de manœuvre limitées</strong>, baisses de taux repoussées<br>';
    html += '• <strong>Remontée des taux longs</strong> depuis le début du conflit<br>';
    html += '• Détroit d\'Ormuz = canal de transmission clé aux marchés</div></div>';

    // Impact taux
    html += '<div style="padding:12px;background:#DBEAFE;border:1px solid #93C5FD;border-radius:6px">';
    html += '<div style="font-size:11px;font-weight:700;color:#1E40AF;margin-bottom:6px">📈 Impact sur les taux (carry trade)</div>';
    html += '<div style="font-size:11px;color:#1A202C;line-height:1.6">';
    html += '• Taux longs en <strong>hausse</strong> → budget option structurés <strong>en augmentation</strong> (favorable)<br>';
    html += '• BCE en pause → Euribor <strong>stable</strong> autour de 2% (favorable Range Accrual)<br>';
    html += '• Baisses de taux <strong>repoussées</strong> → les produits taux gardent leur attractivité<br>';
    html += '• Spreads crédit élargis → <strong>prudence sur le risque émetteur</strong><br>';
    html += '• Positionnement SLGP : <strong>attente de réexposition progressive sur taux longs</strong></div></div>';
    html += '</div>';

    // Stratégie SLGP
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">';

    html += '<div style="padding:10px;background:#ECFDF5;border-radius:6px;border-left:3px solid #059669">';
    html += '<div style="font-size:10px;font-weight:700;color:#059669">CE QU\'ILS PRIVILÉGIENT</div>';
    html += '<div style="font-size:10px;color:#1A202C;margin-top:4px;line-height:1.5">';
    html += '• Actifs "anti-fragiles" (mines d\'or)<br>• Crédit HY européen (spreads attractifs)<br>• Actions émergentes + défense EU</div></div>';

    html += '<div style="padding:10px;background:#FEF3C7;border-radius:6px;border-left:3px solid #D97706">';
    html += '<div style="font-size:10px;font-weight:700;color:#D97706">CE QU\'ILS SURVEILLENT</div>';
    html += '<div style="font-size:10px;color:#1A202C;margin-top:4px;line-height:1.5">';
    html += '• Durée du conflit Iran<br>• Prix pétrole → inflation<br>• Opportunités de réexposition taux</div></div>';

    html += '<div style="padding:10px;background:#FEF2F2;border-radius:6px;border-left:3px solid #DC2626">';
    html += '<div style="font-size:10px;font-weight:700;color:#DC2626">RISQUES IDENTIFIÉS</div>';
    html += '<div style="font-size:10px;color:#1A202C;margin-top:4px;line-height:1.5">';
    html += '• Pétrole comprime les marges<br>• Visibilité court terme réduite<br>• Valeurs refuges classiques moins fiables</div></div>';

    html += '</div>';

    html += '<div style="padding:8px 10px;background:#F1F3F7;border-radius:4px;font-size:10px;color:#64748B">';
    html += 'Source : Swiss Life Gestion Privée, Forces Spéciales Opération n°5, données au 13/04/2026. Performances Forces : -1.2% (F4) à -1.7% (F6) sur le trimestre, surperformant les catégories Morningstar de +0.2 à +0.8%.';
    html += '</div></div></div>';

    // ═══ GUIDE PRODUITS STRUCTURÉS ═══
    html += '<div style="background:' + BG.section + ';border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:20px">';
    html += '<div onclick="var c=document.getElementById(\'mkt-guide\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'span\').textContent=c.style.display===\'none\'?\'▶\':\'▼\'" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:13px;font-weight:700;color:#7C3AED">📚 Guide des produits structurés — Tous les types expliqués</div>';
    html += '<span style="font-size:10px;color:#64748B">▶</span></div>';
    html += '<div id="mkt-guide" style="display:none;padding:0 16px 16px">';

    function _guideCard(emoji, name, coupon, capital, mecanism, forWho, risk, riskColor) {
      return '<div style="padding:12px;border:1px solid ' + BG.border + ';border-radius:8px;margin-bottom:8px;border-left:4px solid ' + riskColor + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<div style="font-size:13px;font-weight:700;color:' + BG.text + '">' + emoji + ' ' + name + '</div>' +
        '<div style="display:flex;gap:6px">' +
        '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#ECFDF5;color:#059669">' + coupon + '</span>' +
        '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:' + (capital === 'Garanti' ? '#ECFDF5' : '#FEF2F2') + ';color:' + (capital === 'Garanti' ? '#059669' : '#DC2626') + '">Capital ' + capital + '</span>' +
        '</div></div>' +
        '<div style="font-size:11px;color:' + BG.text + ';line-height:1.6;margin-bottom:6px">' + mecanism + '</div>' +
        '<div style="display:flex;gap:12px;font-size:10px">' +
        '<span style="color:#2563EB"><strong>Pour :</strong> ' + forWho + '</span>' +
        '<span style="color:' + riskColor + '"><strong>Risque :</strong> ' + risk + '</span>' +
        '</div></div>';
    }

    // TAUX (carry trade)
    html += '<div style="font-size:12px;font-weight:700;color:#059669;margin:12px 0 8px;padding:6px 10px;background:#ECFDF5;border-radius:4px">🛡️ PRODUITS TAUX — Capital garanti (pour le carry trade)</div>';

    html += _guideCard('🎯', 'TARN (Target Accrual)', 'Coupon 6-7%', 'Garanti',
      'Coupon élevé conditionnel (ex: si TEC10 ≤ 4.60%). An 1-2 garantis. Autocall quand cumul coupons atteint la cible (~27%). Le produit s\'arrête, tu récupères le capital.',
      'Max rendement carry trade', 'Faible — 0% coupon si taux montent', '#D97706');

    html += _guideCard('🔒', 'Taux Fixe Callable', 'Coupon 4-4.5% garanti', 'Garanti',
      'Coupon fixe GARANTI chaque année. La banque peut rappeler (si taux baissent). NC3 = pas de rappel avant An 3. Tu vends une option de rappel → la banque te paye un surcoupon.',
      'Zéro risque, carry sûr', 'Zéro', '#059669');

    html += _guideCard('💰', 'Callable In Fine', 'Coupon 4.6-5% capitalisé', 'Garanti',
      'Aucun flux annuel. Tout capitalisé et versé d\'un coup au call/échéance. Ex CIC: 4.66%, si call An 5 → remboursement 123% du nominal. Surcoupon vs Callable classique car pas de gestion de flux.',
      'Investisseur patient, pas besoin de flux', 'Zéro', '#059669');

    html += _guideCard('📊', 'Range Accrual', 'Coupon 5-6.5% proportionnel', 'Garanti',
      'Coupon proportionnel au nombre de jours où le taux (TEC10 ou Euribor) reste dans un corridor [min — max]. Pas binaire : si le taux sort 30 jours → tu perds 30/365 du coupon, pas tout.',
      'Investisseur qui veut du progressif (pas binaire)', 'Faible — coupon réduit si hors corridor', '#D97706');

    html += _guideCard('📈', 'Step-Up Callable', 'Coupon 3.5→6% croissant', 'Garanti',
      'Coupon garanti qui AUGMENTE chaque année (ex: 3.50% → 4.00% → 4.50% → 5.00%). La banque rappelle quand ça coûte trop cher. Le spread vs emprunt s\'élargit avec le temps.',
      'Carry trade patient, coupon garanti croissant', 'Zéro', '#059669');

    html += _guideCard('🔄', 'Fixed-to-Floater', 'Coupon 4% fixe puis variable', 'Garanti',
      'Phase fixe (An 1-3) : coupon garanti ~4%. Phase variable (An 4+) : indexé Euribor + spread, avec floor et cap. S\'adapte au marché.',
      'Investisseur qui veut sécuriser le début', 'Faible — phase variable peut être basse', '#D97706');

    html += _guideCard('🛟', 'Floater avec Plancher', 'Coupon 3-4.5% variable', 'Garanti',
      'Coupon = max(plancher 3%, TEC10 - spread). Plancher 3% = pire cas −0,10pt/an vs emprunt 3,10%. Si taux montent → coupon monte. Si taux baissent → plancher limite la perte.',
      'Carry trade qui veut profiter de la hausse des taux', 'Très faible — plancher garanti', '#0891B2');

    html += _guideCard('🧠', 'Digital Mémoire Taux', 'Coupon 4.6-7% conditionnel', 'Garanti',
      'Coupon conditionnel (ex: si TEC10 ≤ 4.40%). Si condition non remplie → coupon stocké en mémoire et versé quand condition revient. Filet de sécurité vs TARN sans mémoire.',
      'Carry trade avec filet de sécurité', 'Faible — mémoire rattrape', '#0891B2');

    html += _guideCard('📐', 'CMS Steepener', 'Coupon = N × pente courbe', 'Garanti',
      'Coupon = multiplicateur × (taux 10Y - taux 2Y). Aujourd\'hui: 5 × 0.59% = 2.95%. Gagne si courbe pentue. Avec le spread actuel de 59bp, le coupon est modeste.',
      'Investisseur qui parie sur la pente de courbe', 'Modéré — 0% si courbe inversée', '#D97706');

    // ACTIONS
    html += '<div style="font-size:12px;font-weight:700;color:#DC2626;margin:16px 0 8px;padding:6px 10px;background:#FEF2F2;border-radius:4px">⚠️ PRODUITS ACTIONS — Risque en capital (PAS pour le carry trade)</div>';

    html += _guideCard('⚡', 'Autocall / Athena', 'Coupon 5-10% conditionnel', 'Risque',
      'Rappel automatique si action ≥ 100% du strike à une date d\'observation. Coupon × nb années écoulées. Si pas de rappel et action < barrière à échéance → PERTE EN CAPITAL. Version "Privilège" = capital garanti.',
      'Investisseur qui pense que l\'action remonte', 'Élevé — perte si action < barrière', '#DC2626');

    html += _guideCard('🔥', 'Phoenix / Phoenix Mémoire', 'Coupon 7-9% trimestriel', 'Risque',
      'Coupons versés chaque trimestre si action ≥ trigger coupon (ex: 77%). Effet mémoire : coupons manqués sont stockés et rattrapés. Autocall si action ≥ 100%. Barrière capital à 60%.',
      'Investisseur qui veut des revenus réguliers', 'Élevé — perte si action < barrière', '#DC2626');

    html += _guideCard('🎲', 'Worst-of Basket', 'Coupon 7-12% conditionnel', 'Risque',
      'Comme Autocall/Phoenix mais sur un PANIER d\'actions. Le résultat dépend de la PIRE action. Coupon élevé car risque élevé — il suffit d\'une action qui plonge pour tout perdre.',
      'Investisseur convaincu sur TOUTES les actions du panier', 'Très élevé', '#DC2626');

    html += _guideCard('🎯', 'Dispersion / Paires', 'Rendement 5-15% variable', 'Garanti',
      'Parie sur l\'ÉCART entre actions (pas la direction). 16 paires de tech US. Gagne quand les actions divergent. Capital garanti 100%. Le seul produit action à capital garanti.',
      'Investisseur qui pense que les techs vont diverger', 'Faible (capital garanti)', '#0891B2');

    html += _guideCard('💎', 'Reverse Convertible', 'Coupon 8-12% GARANTI', 'Risque',
      'Coupon élevé GARANTI. MAIS à échéance si action < barrière → tu reçois les ACTIONS (pas le cash). Tu deviens actionnaire à perte. Coupon garanti = le prix du risque que tu portes.',
      'Investisseur qui accepte de devenir actionnaire', 'Élevé — conversion en actions', '#DC2626');

    // Résumé
    html += '<div style="margin-top:12px;padding:10px;background:#DBEAFE;border-radius:6px;font-size:11px;color:#1E40AF;line-height:1.6">';
    html += '<strong>Pour le carry trade (emprunt 3.10%, capital garanti obligatoire) :</strong><br>';
    html += '✅ TARN · Fixe Callable · Callable In Fine · Range Accrual · Step-Up · Floater · Digital Mémoire<br>';
    html += '❌ Autocall · Phoenix · Worst-of · Reverse Convertible (risque capital = incompatible avec carry trade adossé à un emprunt)';
    html += '</div>';

    html += '</div></div>';

    html += '<div style="font-size:14px;font-weight:700;color:#059669;margin-bottom:10px">💡 Impact sur le carry trade</div>';
    var tec10Val = tec10.current || 3.10;
    var spreadVsEmprunt = tec10Val - 3.10;
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">Spread TEC10 vs emprunt</div>';
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + (spreadVsEmprunt > 0 ? '#059669' : '#DC2626') + '">+' + (spreadVsEmprunt * 100).toFixed(0) + 'bp</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">' + tec10Val.toFixed(2) + '% - 3.10%</div></div>';

    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">Marge TARN (trigger 4.40%)</div>';
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:#0891B2">+' + ((4.40 - tec10Val) * 100).toFixed(0) + 'bp</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">4.40% - ' + tec10Val.toFixed(2) + '% de marge</div></div>';

    html += '<div style="padding:10px;background:#fff;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">Euribor dans corridor Range Accrual</div>';
    var eur3mVal = eur3m.current || 2.50;
    var inCorridor = eur3mVal >= 1.50 && eur3mVal <= 3.80;
    html += '<div style="font-family:var(--mono);font-size:22px;font-weight:800;color:' + (inCorridor ? '#059669' : '#DC2626') + '">' + (inCorridor ? '✅ OUI' : '❌ NON') + '</div>';
    html += '<div style="font-size:11px;color:' + BG.textDim + '">' + eur3mVal.toFixed(2) + '% dans [1.50%-3.80%]</div></div>';
    html += '</div></div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ SVG Chart builder ═══
  function _buildSVGChart(history, thresholds, current, maxObs) {
    var data = history.slice(-Math.min(maxObs, history.length));
    if (data.length < 2) return '<div style="padding:20px;text-align:center;color:#475569">Pas assez de données</div>';

    var W = 700, H = 180, padL = 50, padR = 10, padT = 10, padB = 24;
    var cW = W - padL - padR, cH = H - padT - padB;
    var vals = data.map(function(d) { return d.value; });
    var allValsForRange = vals.concat(thresholds.map(function(t) { return t.val; }));
    var yMin = Math.min.apply(null, allValsForRange) - 0.15;
    var yMax = Math.max.apply(null, allValsForRange) + 0.15;
    var yRange = yMax - yMin || 0.3;

    function x(i) { return padL + (i / (data.length - 1)) * cW; }
    function y(v) { return padT + cH - ((v - yMin) / yRange) * cH; }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;font-family:var(--mono)">';

    // Background
    svg += '<rect x="' + padL + '" y="' + padT + '" width="' + cW + '" height="' + cH + '" fill="#FAFBFC" rx="4"/>';

    // Grid lines (horizontal)
    var nGrid = 5;
    for (var gi = 0; gi <= nGrid; gi++) {
      var gVal = yMin + (yRange * gi / nGrid);
      var gY = y(gVal);
      svg += '<line x1="' + padL + '" y1="' + gY + '" x2="' + (W - padR) + '" y2="' + gY + '" stroke="#E2E8F0" stroke-width="0.5"/>';
      svg += '<text x="' + (padL - 4) + '" y="' + (gY + 3) + '" text-anchor="end" fill="#475569" font-size="8">' + gVal.toFixed(2) + '%</text>';
    }

    // Min-max band (rolling 3-period)
    if (data.length > 3) {
      var bandPath = 'M';
      var bandPathBottom = '';
      for (var bi = 1; bi < data.length - 1; bi++) {
        var bMin = Math.min(vals[bi-1], vals[bi], vals[bi+1]);
        var bMax = Math.max(vals[bi-1], vals[bi], vals[bi+1]);
        bandPath += (bi === 1 ? '' : 'L') + x(bi).toFixed(1) + ',' + y(bMax).toFixed(1);
        bandPathBottom = x(bi).toFixed(1) + ',' + y(bMin).toFixed(1) + (bandPathBottom ? 'L' : '') + bandPathBottom;
      }
      svg += '<path d="' + bandPath + 'L' + bandPathBottom + 'Z" fill="#93C5FD" opacity="0.15"/>';
    }

    // Threshold lines
    thresholds.forEach(function(t) {
      if (t.val >= yMin && t.val <= yMax) {
        var tY = y(t.val);
        svg += '<line x1="' + padL + '" y1="' + tY + '" x2="' + (W - padR) + '" y2="' + tY + '" stroke="' + t.color + '" stroke-width="1.5" stroke-dasharray="' + (t.dash || '6,3') + '" opacity="0.7"/>';
        svg += '<rect x="' + (W - padR - 4) + '" y="' + (tY - 8) + '" width="' + (t.label.length * 5.5 + 8) + '" height="14" rx="3" fill="' + t.color + '" opacity="0.9" transform="translate(-' + (t.label.length * 5.5 + 4) + ',0)"/>';
        svg += '<text x="' + (W - padR - 8) + '" y="' + (tY + 2) + '" text-anchor="end" fill="#fff" font-size="7.5" font-weight="700">' + t.label + '</text>';
      }
    });

    // Main line
    var linePath = '';
    data.forEach(function(d, i) {
      linePath += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(d.value).toFixed(1);
    });
    // Area fill
    var areaPath = linePath + 'L' + x(data.length - 1).toFixed(1) + ',' + y(yMin).toFixed(1) + 'L' + x(0).toFixed(1) + ',' + y(yMin).toFixed(1) + 'Z';
    svg += '<path d="' + areaPath + '" fill="#3B82F6" opacity="0.08"/>';
    svg += '<path d="' + linePath + '" fill="none" stroke="#2563EB" stroke-width="2" stroke-linejoin="round"/>';

    // Data points (show every N)
    var showEvery = Math.max(1, Math.floor(data.length / 20));
    data.forEach(function(d, i) {
      if (i % showEvery === 0 || i === data.length - 1) {
        svg += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d.value).toFixed(1) + '" r="2.5" fill="#2563EB" stroke="#fff" stroke-width="1"/>';
      }
    });

    // Current value marker (last point, bigger)
    var lastI = data.length - 1;
    svg += '<circle cx="' + x(lastI).toFixed(1) + '" cy="' + y(current).toFixed(1) + '" r="5" fill="#2563EB" stroke="#fff" stroke-width="2"/>';
    svg += '<text x="' + (x(lastI) - 2).toFixed(1) + '" y="' + (y(current) - 10).toFixed(1) + '" text-anchor="end" fill="#2563EB" font-size="10" font-weight="700">' + current.toFixed(2) + '%</text>';

    // X-axis dates
    var dateEvery = Math.max(1, Math.floor(data.length / 6));
    data.forEach(function(d, i) {
      if (i % dateEvery === 0 || i === lastI) {
        var dateShort = d.date.substring(0, 7); // YYYY-MM
        svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle" fill="#475569" font-size="7">' + dateShort + '</text>';
      }
    });

    svg += '</svg>';
    return svg;
  }

  // Period selector for chart
  window._mktChartPeriod = function(rateId, nObs) {
    var yields = _data.rates.yields || {};
    var rateObj = yields[rateId];
    // Euribor: check yields first (with history), then policy_rates fallback
    if (rateId === 'euribor_3m') {
      if (yields.euribor_3m) rateObj = yields.euribor_3m;
      else if (policy.euribor_3m) rateObj = policy.euribor_3m;
    }
    if (!rateObj || !rateObj.history) return;

    var container = document.getElementById('mkt-chart-container');
    if (!container) return;

    var thresholds = []; // chart vierge, seuils ajoutés seulement via Analyser

    var history = rateObj.history;
    var sliced = nObs >= 999 ? history : history.slice(-nObs);
    container.innerHTML = _buildSVGChart(sliced, thresholds, rateObj.current, nObs);

    // Update period buttons
    var btns = document.getElementById('mkt-period-btns');
    if (btns) {
      btns.querySelectorAll('button').forEach(function(btn) {
        var isActive = btn.textContent === (nObs === 12 ? '12M' : nObs === 24 ? '2A' : nObs === 60 ? '5A' : 'MAX');
        btn.style.background = isActive ? '#2563EB' : '#fff';
        btn.style.color = isActive ? '#fff' : '#64748B';
        btn.style.borderColor = isActive ? '#2563EB' : '#D1D9E6';
      });
    }
  };

  // ═══ Unified chart + stats update ═══
  var _currentPeriod = 9999;
  window._mktUpdateChart = function(periodObs) {
    var rd = window._mktRateData;
    if (!rd) return;
    var chartEl = document.getElementById('mkt-chart-container');
    var statsEl = document.getElementById('mkt-stats-container');
    if (!chartEl) return;

    // Period — keep current if not specified
    if (periodObs !== undefined) _currentPeriod = periodObs;
    var obs = _currentPeriod;
    var data = obs >= 9999 ? rd.history : rd.history.slice(-obs);

    // Update period button styles
    var btns = document.getElementById('mkt-period-btns');
    if (btns) btns.querySelectorAll('button').forEach(function(b) {
      var bObs = b.textContent === '12M' ? 12 : b.textContent === '2A' ? 24 : b.textContent === '5A' ? 60 : b.textContent === '10A' ? 120 : 9999;
      var active = bObs === obs;
      b.style.background = active ? '#2563EB' : '#fff';
      b.style.color = active ? '#fff' : '#64748B';
      b.style.borderColor = active ? '#2563EB' : '#D1D9E6';
    });

    // Build thresholds from custom input + defaults
    var thresholds = [];
    var customVal = parseFloat(document.getElementById('mkt-custom-threshold')?.value);
    var customMode = document.getElementById('mkt-custom-mode')?.value || 'above';
    var customRange2 = parseFloat(document.getElementById('mkt-custom-range2')?.value);

    if (customVal && !isNaN(customVal)) {
      if (customMode === 'range' && customRange2 && !isNaN(customRange2)) {
        var lo = Math.min(customVal, customRange2), hi = Math.max(customVal, customRange2);
        thresholds.push({ val: lo, label: 'Borne basse ' + lo.toFixed(2) + '%', color: '#DC2626', dash: '6,3' });
        thresholds.push({ val: hi, label: 'Borne haute ' + hi.toFixed(2) + '%', color: '#DC2626', dash: '6,3' });
      } else {
        thresholds.push({ val: customVal, label: (customMode === 'above' ? 'Seuil ≥ ' : 'Seuil ≤ ') + customVal.toFixed(2) + '%', color: '#DC2626', dash: '6,3' });
      }
    }

    // Pas de seuils par défaut — seulement les seuils custom de l'utilisateur

    // Render chart
    chartEl.innerHTML = _buildSVGChart(data, thresholds, rd.current, data.length);

    // Compute stats
    if (!statsEl) return;
    if (!customVal || isNaN(customVal)) {
      // Default stats — basic info
      var vals = data.map(function(d) { return d.value; });
      statsEl.innerHTML = '<div style="padding:8px 12px;background:#F1F3F7;border-radius:6px;font-size:10px;color:#64748B">' +
        'Période : ' + data[0].date + ' → ' + data[data.length-1].date + ' · ' + data.length + ' obs · ' +
        'Min <strong style="color:#059669">' + Math.min.apply(null,vals).toFixed(3) + '%</strong> · ' +
        'Max <strong style="color:#DC2626">' + Math.max.apply(null,vals).toFixed(3) + '%</strong> · ' +
        'Moy <strong style="color:#7C3AED">' + (vals.reduce(function(a,b){return a+b;},0)/vals.length).toFixed(3) + '%</strong>' +
        ' — Entrez un seuil et cliquez Analyser pour voir les stats de franchissement</div>';
      return;
    }

    // Custom threshold stats
    var shtml = '';
    if (customMode === 'range' && customRange2 && !isNaN(customRange2)) {
      var lo = Math.min(customVal, customRange2), hi = Math.max(customVal, customRange2);
      var inside = 0, outside = 0, breaches = 0, prevIn = null, lastOut = null, maxConsecOut = 0, consecOut = 0;
      data.forEach(function(h) {
        var isIn = h.value >= lo && h.value <= hi;
        if (isIn) { inside++; consecOut = 0; } else { outside++; lastOut = h.date; consecOut++; maxConsecOut = Math.max(maxConsecOut, consecOut); }
        if (prevIn !== null && prevIn !== isIn) breaches++;
        prevIn = isIn;
      });
      var pctIn = Math.round(inside / data.length * 100);
      shtml += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">';
      shtml += '<div style="padding:10px;background:' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '#ECFDF5' : '#FEF2F2') + ';border-radius:6px;text-align:center;border:2px solid ' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '#059669' : '#DC2626') + '">';
      shtml += '<div style="font-size:11px;color:#64748B">ACTUEL</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '#059669' : '#DC2626') + '">' + (data[data.length-1].value >= lo && data[data.length-1].value <= hi ? '✅ DANS' : '❌ HORS') + '</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">TEMPS DANS [' + lo.toFixed(2) + '-' + hi.toFixed(2) + ']</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:' + (pctIn >= 80 ? '#059669' : pctIn >= 50 ? '#D97706' : '#DC2626') + '">' + pctIn + '%</div>';
      shtml += '<div style="font-size:11px;color:#64748B">' + inside + '/' + data.length + ' obs</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">FRANCHISSEMENTS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#7C3AED">' + breaches + '</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">MAX CONSEC. HORS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#DC2626">' + maxConsecOut + ' obs</div></div>';
      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">DERNIÈRE SORTIE</div>';
      shtml += '<div style="font-family:var(--mono);font-size:11px;font-weight:700;color:#DC2626">' + (lastOut || 'Jamais') + '</div></div>';
      shtml += '</div>';
    } else {
      // Single threshold
      var above = 0, below = 0, breaches = 0, prevAbove = null, lastAbove = null, lastBelow = null;
      var maxConsecAbove = 0, consecAbove = 0, maxConsecBelow = 0, consecBelow = 0;
      data.forEach(function(h) {
        var isAbove = h.value >= customVal;
        if (isAbove) { above++; lastAbove = h.date; consecAbove++; maxConsecAbove = Math.max(maxConsecAbove, consecAbove); consecBelow = 0; }
        else { below++; lastBelow = h.date; consecBelow++; maxConsecBelow = Math.max(maxConsecBelow, consecBelow); consecAbove = 0; }
        if (prevAbove !== null && prevAbove !== isAbove) breaches++;
        prevAbove = isAbove;
      });
      var pctAbove = Math.round(above / data.length * 100);
      var isCurrentAbove = rd.current >= customVal;
      var relevant = customMode === 'above' ? above : below;
      var relevantPct = customMode === 'above' ? pctAbove : (100 - pctAbove);
      var relevantColor = relevantPct >= 80 ? '#059669' : relevantPct >= 50 ? '#D97706' : '#DC2626';
      var conditionMet = customMode === 'above' ? isCurrentAbove : !isCurrentAbove;

      shtml += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">';
      shtml += '<div style="padding:10px;background:' + (conditionMet ? '#ECFDF5' : '#FEF2F2') + ';border-radius:6px;text-align:center;border:2px solid ' + (conditionMet ? '#059669' : '#DC2626') + '">';
      shtml += '<div style="font-size:11px;color:#64748B">ACTUEL vs ' + customVal.toFixed(2) + '%</div>';
      shtml += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:' + (conditionMet ? '#059669' : '#DC2626') + '">' + (conditionMet ? '✅ OUI' : '❌ NON') + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">TEMPS AU-DESSUS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#DC2626">' + pctAbove + '%</div>';
      shtml += '<div style="font-size:11px;color:#64748B">' + above + '/' + data.length + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">TEMPS EN-DESSOUS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#059669">' + (100-pctAbove) + '%</div>';
      shtml += '<div style="font-size:11px;color:#64748B">' + below + '/' + data.length + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">FRANCHISSEMENTS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#7C3AED">' + breaches + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">DERNIER AU-DESSUS</div>';
      shtml += '<div style="font-family:var(--mono);font-size:10px;font-weight:700;color:#DC2626">' + (lastAbove || 'Jamais') + '</div></div>';

      shtml += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center"><div style="font-size:11px;color:#64748B">MAX CONSEC. ≥</div>';
      shtml += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#DC2626">' + maxConsecAbove + ' obs</div></div>';
      shtml += '</div>';
    }
    statsEl.innerHTML = shtml;
  };

  // ═══ INTERACTIVE: Rate detail panel (click on a card) ═══

  window._mktOpenRate = function(rateId) {
    var panel = document.getElementById('mkt-rate-detail');
    if (!panel || !_data.rates) return;

    var yields = _data.rates.yields || {};
    var policy = _data.rates.policy_rates || {};
    var rateObj = yields[rateId] || policy[rateId.replace('_', '')] || null;

    // Euribor special case
    if (rateId === 'euribor_3m') {
      if (yields.euribor_3m) rateObj = yields.euribor_3m;
      else if (policy.euribor_3m) rateObj = policy.euribor_3m;
    }

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
      html += '<div style="font-size:10px;color:#475569;margin-top:4px">Date : ' + (rateObj.date || '—') + ' · Historique détaillé non disponible (taux quotidien sans série)</div>';
      html += '</div>';

      // Thresholds
      html += '<div style="margin-top:12px;font-size:11px;color:#1A202C">';
      html += '<strong>Seuils produits liés :</strong>';
      if (rateId === 'euribor_3m') {
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
      _periodStats(history, '10 ans', 120),
      _periodStats(history, '20 ans', 250)
    ].filter(Boolean);

    // KPI cards
    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px">';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">ACTUEL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#2563EB">' + current.toFixed(2) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">MIN (' + nbObs + ' obs)</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + minAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">MAX</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#DC2626">' + maxAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">MOYENNE</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#7C3AED">' + avgAll.toFixed(3) + '%</div></div>';
    html += '<div style="padding:8px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#475569">OBSERVATIONS</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#1A202C">' + nbObs + '</div></div>';
    html += '</div>';

    // Period stats table
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px">';
    html += '<thead><tr style="border-bottom:2px solid #D1D9E6">';
    html += '<th style="padding:6px;text-align:left;color:#64748B;font-size:11px">PÉRIODE</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">MIN</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">MAX</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">MOYENNE</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">VARIATION</th>';
    html += '<th style="padding:6px;text-align:right;color:#64748B;font-size:11px">OBS</th>';
    html += '</tr></thead><tbody>';
    periods.forEach(function(p, i) {
      var bg = i % 2 === 0 ? '#FFFFFF' : '#F4F6F9';
      var chgColor = p.change >= 0 ? '#DC2626' : '#059669';
      html += '<tr style="background:' + bg + ';border-bottom:1px solid #D1D9E6">';
      html += '<td style="padding:6px;font-weight:700">' + p.label + ' <span style="font-size:11px;color:#475569">(' + p.startDate + '→' + p.endDate + ')</span></td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#059669">' + p.min.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#DC2626">' + p.max.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);color:#7C3AED">' + p.avg.toFixed(3) + '%</td>';
      html += '<td style="padding:6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + chgColor + '">' + (p.change >= 0 ? '+' : '') + (p.change * 100).toFixed(0) + 'bp</td>';
      html += '<td style="padding:6px;text-align:right;color:#475569">' + p.count + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    // Store data globally for interactive updates
    window._mktRateData = { id: rateId, history: history, current: current, label: label };

    // ═══ TOOLBAR: Period + Custom threshold ═══
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">';
    // Period buttons
    html += '<div style="display:flex;gap:4px" id="mkt-period-btns">';
    [['12M',12],['2A',24],['5A',60],['10A',120],['20A',250],['MAX',9999]].forEach(function(p) {
      html += '<button onclick="_mktUpdateChart(' + p[1] + ')" style="padding:4px 12px;border-radius:4px;border:1px solid #D1D9E6;background:#fff;color:#64748B;font-size:10px;font-weight:600;cursor:pointer">' + p[0] + '</button>';
    });
    html += '</div>';
    // Custom threshold input
    html += '<div style="display:flex;gap:6px;align-items:center">';
    html += '<input type="number" id="mkt-custom-threshold" placeholder="Ex: 4.60" step="0.05" style="width:80px;padding:5px 8px;border:1px solid #D1D9E6;border-radius:4px;font-family:var(--mono);font-size:11px;color:#1A202C;background:#fff">';
    html += '<select id="mkt-custom-mode" onchange="document.getElementById(\'mkt-custom-range2\').style.display=this.value===\'range\'?\'\':\'none\'" style="padding:5px;border:1px solid #D1D9E6;border-radius:4px;font-size:10px;color:#1A202C;background:#fff">';
    html += '<option value="above">Au-dessus ≥</option><option value="below">En-dessous ≤</option><option value="range">Range [min — max]</option></select>';
    html += '<input type="number" id="mkt-custom-range2" placeholder="Borne haute" step="0.05" style="width:80px;padding:5px 8px;border:1px solid #D1D9E6;border-radius:4px;font-family:var(--mono);font-size:11px;color:#1A202C;background:#fff;display:none">';
    html += '<button onclick="_mktUpdateChart()" style="padding:5px 12px;border-radius:4px;border:none;background:#7C3AED;color:#fff;font-size:10px;font-weight:700;cursor:pointer">Analyser</button>';
    html += '</div></div>';

    // Chart + stats container
    html += '<div id="mkt-chart-container" style="background:#FAFBFC;border:1px solid #E2E8F0;border-radius:8px;padding:8px"></div>';
    html += '<div id="mkt-stats-container" style="margin-top:8px"></div>';

    html += '</div>';
    panel.innerHTML = html;

    // Initial render
    _mktUpdateChart(9999);
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
      tec10: { key: 'tec10_fr', label: 'TEC10', section: 'yields', fallback: 'oat_fr_10y' },
      oat5y: { key: 'oat_fr_5y', label: 'OAT 5Y', section: 'yields' },
      oat2y: { key: 'oat_fr_2y', label: 'OAT 2Y', section: 'yields' },
      euribor3m: { key: 'euribor_3m', label: 'Euribor 3M', section: 'yields' },
      euribor12m: { key: 'euribor_12m', label: 'Euribor 12M', section: 'yields' }
    };
    var rm = rateMap[rateSel];
    var history = [];
    var current = 0;
    var yieldKey = rm.key;
    if (rm.section === 'yields' && _data.rates.yields && !_data.rates.yields[yieldKey] && rm.fallback) yieldKey = rm.fallback;
    if (rm.section === 'yields' && _data.rates.yields && _data.rates.yields[yieldKey]) {
      history = _data.rates.yields[yieldKey].history || [];
      current = _data.rates.yields[yieldKey].current || 0;
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
    html += '<div style="font-size:11px;color:#64748B">STATUT ACTUEL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (currentIn ? '#059669' : '#DC2626') + '">' + (currentIn ? '✅ DANS' : '❌ HORS') + '</div>';
    html += '<div style="font-size:11px;color:#64748B">' + rm.label + ' = ' + current.toFixed(2) + '%</div></div>';

    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#64748B">TEMPS DANS LA ZONE</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (pctIn >= 80 ? '#059669' : pctIn >= 50 ? '#D97706' : '#DC2626') + '">' + pctIn + '%</div>';
    html += '<div style="font-size:11px;color:#64748B">' + inZone + '/' + total + ' observations</div></div>';

    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#64748B">FRANCHISSEMENTS</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#7C3AED">' + breaches.length + '</div>';
    html += '<div style="font-size:11px;color:#64748B">croisements de seuil</div></div>';

    var distBp = 0;
    if (mode === 'below') distBp = Math.round((val1 - current) * 100);
    else if (mode === 'above') distBp = Math.round((current - val1) * 100);
    else distBp = Math.round(Math.min(current - val1, val2 - current) * 100);
    html += '<div style="padding:10px;background:#F1F3F7;border-radius:6px;text-align:center">';
    html += '<div style="font-size:11px;color:#64748B">MARGE AU SEUIL</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (distBp > 0 ? '#059669' : '#DC2626') + '">' + (distBp > 0 ? '+' : '') + distBp + 'bp</div>';
    html += '<div style="font-size:11px;color:#64748B">distance au plus proche</div></div>';
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
      html += '<div style="position:absolute;right:4px;bottom:' + (zoneBottom + 2) + 'px;font-size:11px;color:#059669;font-weight:700">' + val1.toFixed(2) + '%</div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (zoneTop + 2) + 'px;font-size:11px;color:#059669;font-weight:700">' + val2.toFixed(2) + '%</div>';
    } else {
      var lineY = ((val1 - chartMin) / chartRange) * chartH;
      html += '<div style="position:absolute;left:0;right:0;bottom:' + lineY + 'px;height:2px;background:#DC2626;opacity:0.6"></div>';
      html += '<div style="position:absolute;right:4px;bottom:' + (lineY + 3) + 'px;font-size:11px;color:#DC2626;font-weight:700">Seuil ' + val1.toFixed(2) + '%</div>';
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
    html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#475569;margin-top:3px">';
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
        html += '<span style="padding:2px 8px;border-radius:3px;font-size:11px;font-family:var(--mono);background:' + (b.entered ? '#ECFDF5' : '#FEF2F2') + ';color:' + (b.entered ? '#059669' : '#DC2626') + '">';
        html += b.date + ' ' + b.value.toFixed(3) + '% ' + (b.entered ? '→ ENTRE' : '→ SORTI') + '</span>';
      });
      html += '</div>';
    }

    resultDiv.innerHTML = html;
  };

  // ═══ Brochure products loading (uses MarketProductsScanner if available) ═══
  async function _loadBrochureProducts() {
    var contentEl = document.getElementById('mkt-brochure-content');
    if (!contentEl) return;
    if (!window.MarketProductsScanner) {
      contentEl.innerHTML = '<div style="color:#475569;font-size:10px">Module MarketProductsScanner non chargé</div>';
      return;
    }

    try {
      var products = await window.MarketProductsScanner.scan();
      if (!products || products.length === 0) {
        contentEl.innerHTML = '<div style="color:#475569;font-size:10px">Aucun produit taux détecté dans les brochures</div>';
        return;
      }

      // Enrich with rate stats
      if (_data.rates && window.MarketAnalyzer) {
        products = products.map(function(p) {
          return window.MarketProductsScanner.enrich(p, _data.rates, 'MAX');
        });
      }

      // Sort: exploitable first, then by coupon desc
      products.sort(function(a, b) {
        if (a.hasExploitableSeuil && !b.hasExploitableSeuil) return -1;
        if (!a.hasExploitableSeuil && b.hasExploitableSeuil) return 1;
        return (b.couponRate || 0) - (a.couponRate || 0);
      });

      // Render table
      var html = '<div style="font-size:10px;color:#64748B;margin-bottom:8px">' + products.length + ' produits taux détectés dans les brochures. Clic sur "Analyser" pour charger le seuil dans le chart.</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
      html += '<thead><tr style="border-bottom:2px solid #D1D9E6">';
      html += '<th style="padding:6px;text-align:left;color:#64748B">Produit</th>';
      html += '<th style="padding:6px;text-align:left;color:#64748B">Émetteur</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Sous-jacent</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Seuil</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Coupon</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Maturité</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Statut</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">% OK</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B">Marge</th>';
      html += '<th style="padding:6px;text-align:center;color:#64748B"></th>';
      html += '</tr></thead><tbody>';

      products.forEach(function(p, idx) {
        var bg = idx % 2 === 0 ? '#FFFFFF' : '#F4F6F9';
        var hasStats = p.stats && p.hasExploitableSeuil;
        var pctOK = hasStats ? (p.stats.pctInZone != null ? p.stats.pctInZone : p.stats.pctBelow != null ? p.stats.pctBelow : '—') : '—';
        var marge = hasStats && p.stats.marginBps != null ? (p.stats.marginBps >= 0 ? '+' : '') + p.stats.marginBps + 'bp' : '—';
        var statusOK = hasStats ? (p.stats.currentInZone || p.stats.currentBelow) : null;
        var seuilLabel = p.threshold ? (p.thresholdMode === 'below' ? '≤' : '≥') + ' ' + p.threshold + '%' :
                         p.corridorLow ? '[' + p.corridorLow + '-' + p.corridorHigh + '%]' : '—';

        html += '<tr style="background:' + bg + ';border-bottom:1px solid #E2E8F0">';
        html += '<td style="padding:6px;font-weight:600;color:#1A202C;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (p.name || '') + '">' + (p.name || '?').substring(0, 35) + '</td>';
        html += '<td style="padding:6px;color:#64748B">' + (p.emitter || '?').substring(0, 20) + '</td>';
        html += '<td style="padding:6px;text-align:center"><span style="padding:2px 6px;border-radius:3px;background:#E0F7FA;color:#0891B2;font-size:11px;font-weight:600">' + (p.rateAlias || '—') + '</span></td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-weight:700;color:#7C3AED">' + seuilLabel + '</td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-weight:700;color:#059669">' + (p.couponRate ? p.couponRate + '%' : '—') + '</td>';
        html += '<td style="padding:6px;text-align:center;color:#64748B">' + (p.maturityYears ? p.maturityYears + 'Y' : '—') + '</td>';
        html += '<td style="padding:6px;text-align:center">' + (statusOK === true ? '<span style="color:#059669;font-weight:700">✅</span>' : statusOK === false ? '<span style="color:#DC2626;font-weight:700">❌</span>' : '—') + '</td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (typeof pctOK === 'number' && pctOK >= 80 ? '#059669' : '#D97706') + '">' + (typeof pctOK === 'number' ? pctOK + '%' : pctOK) + '</td>';
        html += '<td style="padding:6px;text-align:center;font-family:var(--mono);font-size:11px;color:' + (typeof marge === 'string' && marge.indexOf('+') === 0 ? '#059669' : '#DC2626') + '">' + marge + '</td>';
        // Analyser button — loads threshold into the chart above
        if (p.hasExploitableSeuil && p.rateAlias) {
          var clickAction = '_mktOpenRate(\'' + (p.rateAlias === 'tec10' ? 'oat_fr_10y' : p.rateAlias === 'oat5y' ? 'oat_fr_5y' : p.rateAlias === 'oat2y' ? 'oat_fr_2y' : 'euribor_3m') + '\')';
          html += '<td style="padding:6px;text-align:center"><button onclick="' + clickAction + ';setTimeout(function(){var e=document.getElementById(\'mkt-custom-threshold\');if(e){e.value=\'' + (p.threshold || p.corridorLow || '') + '\';var m=document.getElementById(\'mkt-custom-mode\');if(m)m.value=\'' + (p.thresholdMode || 'below') + '\';_mktUpdateChart()}},200)" style="padding:3px 8px;border-radius:3px;border:1px solid #7C3AED;background:#F5F3FF;color:#7C3AED;font-size:11px;font-weight:600;cursor:pointer">Analyser</button></td>';
        } else {
          html += '<td style="padding:6px;text-align:center;color:#475569;font-size:11px">—</td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table>';
      contentEl.innerHTML = html;
    } catch(e) {
      console.error('[MarketDashboard] Erreur scan brochures:', e);
      contentEl.innerHTML = '<div style="color:#DC2626;font-size:10px">Erreur: ' + e.message + '</div>';
    }
  }

  window.renderMarketDashboard = async function(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B">Chargement des données marché...</div>';
    if (!_data.loaded) await _loadData();
    _render(container);
    // Load brochure products in background
    setTimeout(_loadBrochureProducts, 100);
  };

  console.log('[StructBoard] Market Dashboard v1.0 loaded');
})();

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

    // ═══ SECTION 1: TAUX SOUVERAINS ═══
    html += '<div style="font-size:14px;font-weight:700;color:' + BG.text + ';margin-bottom:12px">🏛️ Taux souverains EUR (zone euro AAA)</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">';
    html += _renderKPI('TEC10 (OAT 10 ans)', (tec10.current || 3.10).toFixed(2) + '%', '#0891B2',
      'Vol ' + (tec10.vol_annualized_bps || 18) + 'bp/an · ' + (tec10.direction || 'stable') + ' · Range 12M : ' + (tec10.low_1y || '?') + '-' + (tec10.high_1y || '?') + '%');
    html += _renderKPI('OAT 5 ans', (oat5y.current || 2.70).toFixed(2) + '%', '#2563EB',
      'Vol ' + (oat5y.vol_annualized_bps || 22) + 'bp/an · ' + (oat5y.direction || 'stable') + ' · Spread 5Y-10Y : +' + Math.round(((tec10.current||3.10) - (oat5y.current||2.70)) * 100) + 'bp');
    html += _renderKPI('OAT 2 ans', (oat2y.current || 2.53).toFixed(2) + '%', '#7C3AED',
      'Vol ' + (oat2y.vol_annualized_bps || 26) + 'bp/an · ' + (oat2y.direction || 'stable') + ' · Spread 2Y-10Y : +' + Math.round(((tec10.current||3.10) - (oat2y.current||2.53)) * 100) + 'bp');
    html += _renderKPI('Courbe des taux', (curve.shape === 'normal' ? 'Normale ↗' : 'Inversée ↘'), curve.shape === 'normal' ? '#059669' : '#DC2626',
      'Spread 2s10s : +' + Math.round((curve.spread_2_10 || 0.57) * 100) + 'bp · ' + (curve.shape === 'normal' ? 'Favorable aux structurés' : 'Défavorable'));
    html += '</div>';

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

    // ═══ SECTION 4: HISTORIQUE TEC10 ═══
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

  window.renderMarketDashboard = async function(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B">Chargement des données marché...</div>';
    if (!_data.loaded) await _loadData();
    _render(container);
  };

  console.log('[StructBoard] Market Dashboard v1.0 loaded');
})();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — CAT Optimizer Macro Intelligence Patch v1.0
// Integrates market data (rates, MI, macro) into CAT optimizer:
//   1. Rate trend signal (rising/stable/falling)
//   2. Forward rate estimation (CAT 12m forward from yield curve)
//   3. Duration recommendation aligned with bond strategy
//   4. Maturity calendar with renewal risk alerts
//   5. Scoped to "cash CAT" — does not interfere with structured allocator
// Pattern: override existing functions, fallback gracefully if data unavailable
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _macroCache = { rates: null, mi: null, macro: null, loaded: false, macroContext: null };

  // ═══ LOAD MARKET DATA (async, cached) ══════════════════════
  window._loadCATMacroData = async function() {
    if (_macroCache.loaded) return _macroCache;
    try {
      var results = await Promise.allSettled([
        github.readFile('data/market/rates.json'),
        github.readFile('data/market/market_intelligence.json'),
        github.readFile('data/market/macro_indicators.json')
      ]);
      if (results[0].status === 'fulfilled') _macroCache.rates = results[0].value;
      if (results[1].status === 'fulfilled') _macroCache.mi = results[1].value;
      if (results[2].status === 'fulfilled') _macroCache.macro = results[2].value;
      _macroCache.loaded = true;
      _macroCache.macroContext = _deriveMacroContext();
      console.log('[CATMacro] Loaded: rates=' + !!_macroCache.rates + ' MI=' + !!_macroCache.mi + ' macro=' + !!_macroCache.macro + ' → regime=' + (_macroCache.macroContext?.regime || 'n/a'));
    } catch(e) {
      console.warn('[CATMacro] Load error:', e.message);
    }
    return _macroCache;
  };

  // ═══ DERIVE MACRO CONTEXT ══════════════════════════════════
  function _deriveMacroContext() {
    var ctx = {
      rateTrend: 'stable', rateTrendScore: 0,
      regime: 'neutral', regimeConfidence: 0,
      ecbMainRate: null, ecbDepositRate: null,
      maxDurationMonths: 60,
      urgency: 'normal', urgencyLabel: '',
      forwardRate12m: null, forwardSpread: null,
      maturityAlerts: [],
      strategyLabel: '', bannerHTML: '',
      warnings: [], stressFlags: [],
      dataDate: null
    };

    // ─── Rates data ───────────────────────────────────────
    var rates = _macroCache.rates;
    if (rates) {
      ctx.dataDate = rates.fetched_at ? rates.fetched_at.split('T')[0] : null;
      var pr = rates.policy_rates || {};
      ctx.ecbMainRate = pr.ecb_main_rate?.current || null;
      ctx.ecbDepositRate = pr.ecb_deposit_rate?.current || null;

      // Rate trend from OAT 2Y (short end = most relevant for CAT)
      var oat2y = rates.yields?.oat_fr_2y;
      if (oat2y) {
        var changeBps = oat2y.change_3m_bps || 0;
        ctx.rateTrendScore = Math.max(-1, Math.min(1, changeBps / 30)); // normalize to [-1,1]
      }
    }

    // ─── Market Intelligence ──────────────────────────────
    var mi = _macroCache.mi;
    if (mi) {
      ctx.regime = mi.regime || mi.ai_response?.regime || 'neutral';
      ctx.regimeConfidence = mi.ai_response?.regime_confidence || 0;
      ctx.warnings = mi.warnings || mi.ai_response?.warnings || [];

      // Prob hike contributes to trend
      var probHike = mi.ai_response?.market_interpretation?.prob_hike_next_fomc_pct || 0;
      if (probHike > 50) ctx.rateTrendScore = Math.min(1, ctx.rateTrendScore + 0.3);
      if (probHike < 20) ctx.rateTrendScore = Math.max(-1, ctx.rateTrendScore - 0.2);

      // Bond strategy max duration
      var bs = mi.ai_response?.bond_strategy;
      if (bs && bs.max_duration_stable) {
        ctx.maxDurationMonths = Math.round(bs.max_duration_stable * 12);
      }
    }

    // ─── Macro indicators ─────────────────────────────────
    var macro = _macroCache.macro;
    if (macro) {
      var flat = macro._market_data_flat || macro.market_data_input || {};
      ctx.stressFlags = flat._stress_flags || [];
    }

    // ─── Synthesize rateTrend ─────────────────────────────
    if (ctx.rateTrendScore > 0.15) ctx.rateTrend = 'rising';
    else if (ctx.rateTrendScore < -0.15) ctx.rateTrend = 'falling';
    else ctx.rateTrend = 'stable';

    // ─── Forward rate (observed spread) ───────────────────
    if (ctx.ecbDepositRate != null && typeof catManager !== 'undefined') {
      var active = catManager.deposits.filter(function(d) { return d.status === 'active'; });
      var totalAmt = 0, totalWeighted = 0;
      active.forEach(function(d) {
        var a = parseFloat(d.amount) || 0, r = parseFloat(d.rate) || 0;
        totalAmt += a; totalWeighted += a * r;
      });
      var avgCATRate = totalAmt > 0 ? totalWeighted / totalAmt : 0;
      ctx.forwardSpread = Math.round((avgCATRate - ctx.ecbDepositRate) * 100) / 100;
      // Forward = current deposit rate + expected hikes + observed spread
      var probHikeVal = mi?.ai_response?.market_interpretation?.prob_hike_next_fomc_pct || 0;
      var expectedHikeBps = probHikeVal / 100 * 50; // 2 hikes of 25bps if prob=100%
      var forwardDeposit = ctx.ecbDepositRate + expectedHikeBps / 100;
      ctx.forwardRate12m = Math.round((forwardDeposit + ctx.forwardSpread) * 100) / 100;
    }

    // ─── Maturity alerts ──────────────────────────────────
    if (typeof catManager !== 'undefined') {
      var now = new Date();
      var in6m = new Date(now); in6m.setMonth(in6m.getMonth() + 6);
      var activeDeposits = catManager.deposits.filter(function(d) { return d.status === 'active' && d.maturityDate; });
      var maturing = activeDeposits.filter(function(d) { var m = new Date(d.maturityDate); return m > now && m <= in6m; });
      var totalMaturing = maturing.reduce(function(s, d) { return s + (parseFloat(d.amount) || 0); }, 0);

      if (maturing.length > 0) {
        var alert = {
          count: maturing.length,
          totalAmount: totalMaturing,
          deposits: maturing.map(function(d) { return { name: d.productName, amount: d.amount, date: d.maturityDate, bank: d.bankName }; }),
          risk: ctx.rateTrend === 'falling' ? 'high' : ctx.rateTrend === 'stable' ? 'medium' : 'low'
        };
        ctx.maturityAlerts.push(alert);
      }
    }

    // ─── Urgency (scoped cash CAT) ────────────────────────
    if ((ctx.regime === 'stagflation' || ctx.rateTrend === 'rising') && ctx.rateTrend !== 'falling') {
      ctx.urgency = 'place_now_short';
      ctx.urgencyLabel = 'Privilégier court terme (<12m) pour cash CAT';
    } else if (ctx.rateTrend === 'falling') {
      ctx.urgency = 'lock_long';
      ctx.urgencyLabel = 'Verrouiller long terme pour cash CAT';
    } else {
      ctx.urgency = 'normal';
      ctx.urgencyLabel = 'Allocation standard';
    }

    // ─── Strategy label ───────────────────────────────────
    var trendArrow = ctx.rateTrend === 'rising' ? '↗' : ctx.rateTrend === 'falling' ? '↘' : '→';
    var trendLabel = ctx.rateTrend === 'rising' ? 'hausse probable' : ctx.rateTrend === 'falling' ? 'baisse probable' : 'stable';
    ctx.strategyLabel = ctx.urgencyLabel;

    // ─── Banner HTML ──────────────────────────────────────
    var regimeColor = ctx.regime === 'stagflation' ? 'var(--red)' : ctx.regime === 'risk-on' ? 'var(--green)' : 'var(--text-muted)';
    var regimeBg = ctx.regime === 'stagflation' ? 'rgba(248,113,113,0.08)' : ctx.regime === 'risk-on' ? 'rgba(52,211,153,0.08)' : 'rgba(90,107,138,0.08)';
    var trendColor = ctx.rateTrend === 'rising' ? 'var(--orange)' : ctx.rateTrend === 'falling' ? 'var(--cyan)' : 'var(--text-muted)';

    var maturityWarning = '';
    if (ctx.maturityAlerts.length > 0) {
      var a = ctx.maturityAlerts[0];
      maturityWarning = '<div style="margin-top:8px;padding:8px 12px;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);border-radius:var(--radius-sm);font-size:11px">'
        + '<strong style="color:var(--orange)">⚠️ ' + (typeof formatNumber !== 'undefined' ? formatNumber(a.totalAmount) : a.totalAmount) + '€</strong>'
        + ' <span style="color:var(--text-muted)">maturent dans les 6 prochains mois (' + a.count + ' CAT) — négocier les taux en avance, diversifier (FGDR)</span></div>';
    }

    ctx.bannerHTML = '<div style="background:linear-gradient(135deg,' + regimeBg + ',rgba(59,130,246,0.04));border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius);padding:14px 16px;margin-bottom:16px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">'
      + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
      + '<span style="font-size:14px">📊</span>'
      + '<span style="padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;color:' + regimeColor + ';background:' + regimeColor + '12;border:1px solid ' + regimeColor + '30;text-transform:uppercase">' + ctx.regime + ' (' + ctx.regimeConfidence + '/5)</span>'
      + (ctx.ecbMainRate != null ? '<span style="font-size:11px;color:var(--text-muted)">BCE <strong style="color:var(--text-bright)">' + ctx.ecbMainRate + '%</strong></span>' : '')
      + '<span style="font-size:11px;color:' + trendColor + ';font-weight:600">' + trendArrow + ' ' + trendLabel + '</span>'
      + (ctx.forwardRate12m ? '<span style="font-size:11px;color:var(--text-muted)">CAT forward 12m: <strong style="color:var(--accent)">' + ctx.forwardRate12m + '%</strong></span>' : '')
      + '</div>'
      + (ctx.dataDate ? '<span style="font-size:9px;color:var(--text-dim)">' + ctx.dataDate + '</span>' : '')
      + '</div>'
      + '<div style="margin-top:8px;font-size:11px;color:var(--text)">'
      + '<span style="color:var(--accent);font-weight:600">💡 Cash CAT:</span> ' + ctx.strategyLabel
      + '<span style="color:var(--text-dim);margin-left:12px">· Pour structurés → voir allocateur</span>'
      + '</div>'
      + maturityWarning
      + '</div>';

    return ctx;
  }

  // ═══ OVERRIDE: _dynamicThreshold ═══════════════════════════
  // Rising → ×1.2 (more demanding: keep cash liquid to catch higher rates)
  // Falling → ×0.7 (less demanding: lock in before rates drop further)
  var _waitThreshold = setInterval(function() {
    if (typeof _dynamicThreshold !== 'function') return;
    clearInterval(_waitThreshold);

    var _origThreshold = _dynamicThreshold;
    window._dynamicThreshold = function(amount, monthsLeft) {
      var base = _origThreshold(amount, monthsLeft);
      var ctx = _macroCache.macroContext;
      if (!ctx) return base;
      if (ctx.rateTrend === 'rising') return base * 1.2;
      if (ctx.rateTrend === 'falling') return base * 0.7;
      return base;
    };
    console.log('[CATMacro] _dynamicThreshold override installed');
  }, 200);

  // ═══ OVERRIDE: buildOptimizationAnalysis ═══════════════════
  var _waitBuild = setInterval(function() {
    if (typeof buildOptimizationAnalysis !== 'function') return;
    clearInterval(_waitBuild);

    var _origBuild = buildOptimizationAnalysis;
    window.buildOptimizationAnalysis = function() {
      var analysis = _origBuild();
      var ctx = _macroCache.macroContext;
      if (!ctx) return analysis;

      analysis.macroContext = ctx;

      // Tag deposits with macro warnings
      if (analysis.depositAnalysis) {
        analysis.depositAnalysis.forEach(function(d) {
          if (d.bestAlt && d.bestAlt.duration > ctx.maxDurationMonths) {
            d.macroWarning = 'Durée alternative (' + d.bestAlt.duration + 'm) > max recommandé (' + ctx.maxDurationMonths + 'm en ' + ctx.regime + ')';
          }
        });
      }

      // Tag cash opportunities with macro fit
      if (analysis.cashOpportunities) {
        analysis.cashOpportunities.forEach(function(c) {
          c.macroFit = (ctx.urgency === 'place_now_short' && c.duration <= 12)
            || (ctx.urgency === 'lock_long' && c.duration >= 24)
            || ctx.urgency === 'normal';
        });
      }

      // Maturity calendar
      analysis.maturityCalendar = ctx.maturityAlerts;

      return analysis;
    };
    console.log('[CATMacro] buildOptimizationAnalysis override installed');
  }, 200);

  // ═══ OVERRIDE: getAIOptimizerSummary ═══════════════════════
  var _waitAI = setInterval(function() {
    if (typeof getAIOptimizerSummary !== 'function') return;
    clearInterval(_waitAI);

    var _origAI = getAIOptimizerSummary;
    window.getAIOptimizerSummary = async function(analysis) {
      // Ensure macro data is loaded
      await _loadCATMacroData();
      var ctx = _macroCache.macroContext;

      if (!ctx) return _origAI(analysis);

      // Inject macro context: we need to modify the prompt
      // Store context on analysis so the original function can't ignore it
      analysis._macroPromptSection = '\n\nCONTEXTE MACRO (cash CAT uniquement, pas structurés):\n'
        + '- Régime: ' + ctx.regime + ' (confiance ' + ctx.regimeConfidence + '/5)\n'
        + (ctx.ecbMainRate != null ? '- BCE: directeur ' + ctx.ecbMainRate + '%, dépôt ' + ctx.ecbDepositRate + '%\n' : '')
        + '- Tendance taux: ' + ctx.rateTrend + ' (score ' + (ctx.rateTrendScore > 0 ? '+' : '') + (ctx.rateTrendScore * 100).toFixed(0) + 'bps/3m)\n'
        + (ctx.forwardRate12m ? '- Taux CAT forward 12m estimé: ' + ctx.forwardRate12m + '% (spread observé ' + ctx.forwardSpread + '%)\n' : '')
        + '- Stratégie cash CAT: ' + ctx.strategyLabel + '\n'
        + (ctx.maturityAlerts.length > 0 ? '- ⚠️ Maturités proches: ' + (typeof formatNumber !== 'undefined' ? formatNumber(ctx.maturityAlerts[0].totalAmount) : ctx.maturityAlerts[0].totalAmount) + '€ dans 6m (' + ctx.maturityAlerts[0].count + ' CAT)\n' : '')
        + (ctx.stressFlags.length > 0 ? '- Stress: ' + ctx.stressFlags.join(', ') + '\n' : '')
        + (ctx.warnings.length > 0 ? '- Warnings: ' + ctx.warnings.slice(0, 2).join('; ') + '\n' : '')
        + '\nCONSIGNE MACRO:\n'
        + '- Intègre ce contexte macro dans tes recommandations\n'
        + '- Mentionne le taux forward estimé quand pertinent pour la décision\n'
        + '- Alerte sur les renouvellements à risque\n'
        + '- Recommandation scopée cash CAT uniquement\n';

      // Call original — we'll override the prompt by patching the fetch
      return _origAI(analysis);
    };

    // Also patch the prompt construction inside getAIOptimizerSummary
    // The cleanest way: override the fetch call to inject macro section
    var _origFetch = window.fetch;
    window.fetch = function(url, opts) {
      if (url === CONFIG.AI_ENDPOINT && opts && opts.body) {
        try {
          var body = JSON.parse(opts.body);
          if (body.messages && body.messages[0] && body.messages[0].content && body.messages[0].content.includes('Directeur financier') && body.messages[0].content.includes('v3.1')) {
            // This is the optimizer AI call — inject macro context
            var macroSection = '';
            if (_macroCache.macroContext) {
              var ctx = _macroCache.macroContext;
              macroSection = '\n\nCONTEXTE MACRO (cash CAT uniquement):\n'
                + '- Régime: ' + ctx.regime + ' (' + ctx.regimeConfidence + '/5) · BCE ' + (ctx.ecbMainRate || '?') + '%\n'
                + '- Tendance: ' + ctx.rateTrend + ' · Forward CAT 12m: ' + (ctx.forwardRate12m || '?') + '%\n'
                + '- Stratégie: ' + ctx.strategyLabel + '\n'
                + (ctx.maturityAlerts.length > 0 ? '- ⚠️ ' + ctx.maturityAlerts[0].totalAmount + '€ maturent dans 6m\n' : '')
                + '\nIntègre le macro dans l\'analyse. Mentionne forward rate. Scopé cash CAT.\n';
            }
            body.messages[0].content = body.messages[0].content.replace('Max 200 mots', macroSection + 'Max 220 mots');
            opts.body = JSON.stringify(body);
          }
        } catch(e) {}
      }
      return _origFetch.call(window, url, opts);
    };

    console.log('[CATMacro] getAIOptimizerSummary + fetch override installed');
  }, 200);

  // ═══ OVERRIDE: renderOptimizationTable — inject banner ═════
  var _waitTable = setInterval(function() {
    if (typeof renderOptimizationTable !== 'function') return;
    clearInterval(_waitTable);

    var _origTable = renderOptimizationTable;
    window.renderOptimizationTable = function(analysis) {
      var html = '';
      var ctx = analysis.macroContext || _macroCache.macroContext;
      if (ctx && ctx.bannerHTML) html += ctx.bannerHTML;
      html += _origTable(analysis);
      return html;
    };
    console.log('[CATMacro] renderOptimizationTable banner override installed');
  }, 200);

  // ═══ OVERRIDE: renderOptimizerDashboard — inject banner ════
  var _waitDash = setInterval(function() {
    if (typeof renderOptimizerDashboard !== 'function') return;
    clearInterval(_waitDash);

    var _origDash = renderOptimizerDashboard;
    window.renderOptimizerDashboard = function() {
      var html = _origDash();
      if (!html) return html;
      var ctx = _macroCache.macroContext;
      if (!ctx || !ctx.bannerHTML) return html;
      // Insert banner after the section header
      var insertPoint = html.indexOf('</div></div>');
      if (insertPoint > 0) {
        insertPoint = html.indexOf('</div></div>', insertPoint + 12);
        if (insertPoint > 0) {
          html = html.substring(0, insertPoint + 12) + ctx.bannerHTML + html.substring(insertPoint + 12);
        }
      }
      return html;
    };
    console.log('[CATMacro] renderOptimizerDashboard banner override installed');
  }, 200);

  // ═══ PRE-LOAD on init ══════════════════════════════════════
  var _initWait = setInterval(function() {
    if (typeof github === 'undefined' || !github.readFile) return;
    clearInterval(_initWait);
    _loadCATMacroData().then(function() {
      console.log('[CATMacro] Init complete');
    });
  }, 500);

})();

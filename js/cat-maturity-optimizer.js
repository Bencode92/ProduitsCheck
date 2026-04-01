// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — CAT Maturity Optimizer v1.0
// Analyzes CAT deposits approaching maturity and recommends:
//   A. Renew same bank
//   B. Switch to better bank
//   C. Subscribe structured product (capital garanti only)
//   D. Wait (if rates rising)
// Integrates MI (regime, rate trend, forward rate) for timing decisions.
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var MATURITY_HORIZON_MONTHS = 8; // Alert window: CATs maturing within 8 months
  var MIN_SPREAD_STRUCT = 1.0; // Structured must beat CAT by +1% for maturities > 5Y

  // ─── Get CAT deposits maturing soon ────────────────────
  function _getMaturingDeposits() {
    try {
      if (typeof catManager === 'undefined' || !catManager.deposits) return [];
      var now = new Date();
      var horizon = new Date(now);
      horizon.setMonth(horizon.getMonth() + MATURITY_HORIZON_MONTHS);

      return catManager.deposits.filter(function(d) {
        if (d.status !== 'active' || !d.maturityDate) return false;
        var mat = new Date(d.maturityDate);
        return mat > now && mat <= horizon;
      });
    } catch(e) { return []; }
  }

  // ─── Group by bank + maturity date + entity ────────────
  function _groupDeposits(deposits) {
    var groups = {};
    deposits.forEach(function(d) {
      var key = (d.entity || 'unknown') + '_' + (d.bankName || '') + '_' + (d.maturityDate || '');
      if (!groups[key]) {
        groups[key] = {
          entity: d.entity || 'unknown',
          bankName: d.bankName || '',
          maturityDate: d.maturityDate,
          deposits: [],
          totalAmount: 0,
          avgRate: 0,
          monthsToMaturity: 0
        };
      }
      groups[key].deposits.push(d);
      groups[key].totalAmount += parseFloat(d.amount) || 0;
    });

    // Calculate averages and months
    var now = new Date();
    Object.values(groups).forEach(function(g) {
      var totalWeighted = g.deposits.reduce(function(s, d) { return s + (parseFloat(d.amount) || 0) * (parseFloat(d.rate) || 0); }, 0);
      g.avgRate = g.totalAmount > 0 ? Math.round(totalWeighted / g.totalAmount * 100) / 100 : 0;
      g.monthsToMaturity = Math.round((new Date(g.maturityDate) - now) / (1000 * 60 * 60 * 24 * 30));
    });

    return Object.values(groups).sort(function(a, b) {
      return new Date(a.maturityDate) - new Date(b.maturityDate);
    });
  }

  // ─── Get best CAT offer for renewal ────────────────────
  function _getBestRenewalRate(bankName) {
    try {
      if (typeof catManager !== 'undefined' && catManager.rates && catManager.rates.rates) {
        var offers = catManager.rates.rates.filter(function(r) {
          return r.source !== 'web scan' && r.rate > 0;
        });
        // Same bank first
        var sameBankOffers = offers.filter(function(r) {
          return r.bankName.toLowerCase().indexOf(bankName.toLowerCase()) >= 0;
        });
        sameBankOffers.sort(function(a, b) { return b.rate - a.rate; });

        // All banks
        offers.sort(function(a, b) { return b.rate - a.rate; });

        return {
          sameBank: sameBankOffers.length > 0 ? sameBankOffers[0] : null,
          bestOther: offers.length > 0 ? offers[0] : null
        };
      }
    } catch(e) {}
    return { sameBank: null, bestOther: null };
  }

  // ─── Get eligible structured products ──────────────────
  function _getStructuredOptions(entity, amount, bestCatRate) {
    var candidates = [];
    try {
      Object.values(app.state.proposals || {}).forEach(function(arr) {
        arr.forEach(function(p) {
          if (p.status === 'rejected' || p.status === 'subscribed') return;
          if (!p.grading || !p.grading.grade || p.grading.grade === '-' || p.grading.grade === '?') return;

          var cp = p.capitalProtection || {};
          var isCapGaranti = cp.protected === true || (p.structureType || '').indexOf('dispersion') >= 0 || (p.structureType || '').indexOf('taux_fixe') >= 0;
          if (!isCapGaranti) return;

          var rdtNet = p._bsRendementNet || (p.grading.metadata && p.grading.metadata.bsRendementNet) || p._ratesRendementNet || null;
          if (rdtNet == null || rdtNet <= bestCatRate + MIN_SPREAD_STRUCT) return;

          var minInvest = parseFloat(p.minInvestment) || 0;
          if (minInvest > 0 && amount < minInvest) return; // Not enough to meet minimum

          candidates.push({
            id: p.id,
            name: p.name || 'Produit',
            bankName: p.bankId || '',
            grade: p.grading.grade,
            score: p.grading.score || 0,
            rdtNet: rdtNet,
            minInvestment: minInvest,
            maturityMonths: (parseFloat(p.maturityYears) || 5) * 12,
            structureType: p.structureType || ''
          });
        });
      });
    } catch(e) {}
    candidates.sort(function(a, b) { return b.rdtNet - a.rdtNet; });
    return candidates;
  }

  // ─── Get macro context ─────────────────────────────────
  var _matMacroCache = null;

  function _getMacro() {
    if (_matMacroCache) return _matMacroCache;

    // Best source: cat-optimizer-macro-patch exports _loadCATMacroData
    // which returns { macroContext: { rateTrend, regime, ... } }
    try {
      if (typeof _loadCATMacroData === 'function') {
        // It's async but may already be loaded. Check the return cache.
        var cache = _loadCATMacroData.__cache;
        // The function stores result in a closure var, not accessible.
        // But the unified allocator's _getMacroContext reads it.
      }
      if (typeof _getMacroContext === 'function') {
        var mc = _getMacroContext();
        if (mc && mc.rateTrend) { _matMacroCache = mc; return mc; }
      }
    } catch(e) {}

    // Direct fallback: read market_intelligence.json prob_hike
    var result = { rateTrend: 'stable', regime: 'neutral', forwardRate12m: null };
    try {
      var mi = typeof _getOptimizerMI === 'function' ? _getOptimizerMI() : null;
      if (mi) result.regime = (mi.regime || 'neutral').toLowerCase();

      // In stagflation with hawkish fed → rates rising
      if (result.regime === 'stagflation') result.rateTrend = 'rising';
      else if (result.regime === 'recession') result.rateTrend = 'falling';
      else if (result.regime === 'bull' || result.regime === 'expansion') result.rateTrend = 'stable';
    } catch(e) {}

    _matMacroCache = result;
    return result;
  }

  // ─── Build recommendations for a group ─────────────────
  function _buildOptions(group) {
    var options = [];
    var macro = _getMacro();
    var renewal = _getBestRenewalRate(group.bankName);
    var bestCatRate = renewal.bestOther ? renewal.bestOther.rate : group.avgRate;

    // Option A: Renew same bank
    if (renewal.sameBank) {
      var delta = renewal.sameBank.rate - group.avgRate;
      options.push({
        type: 'renew',
        label: 'Renouveler ' + group.bankName,
        icon: '🔄',
        rate: renewal.sameBank.rate,
        product: renewal.sameBank.productName + ' (' + renewal.sameBank.durationMonths + 'M)',
        annualReturn: Math.round(group.totalAmount * renewal.sameBank.rate / 100),
        delta: Math.round(group.totalAmount * delta / 100),
        deltaLabel: delta >= 0 ? '+' + delta.toFixed(2) + '%' : delta.toFixed(2) + '%'
      });
    }

    // Option B: Switch bank (if different from A)
    if (renewal.bestOther && (!renewal.sameBank || renewal.bestOther.rate > renewal.sameBank.rate + 0.05)) {
      var delta = renewal.bestOther.rate - group.avgRate;
      // Check FGDR: if amount > 100K, need to split
      var fgdrWarning = group.totalAmount > 100000;
      options.push({
        type: 'switch',
        label: 'Changer → ' + renewal.bestOther.bankName,
        icon: '🏦',
        rate: renewal.bestOther.rate,
        product: renewal.bestOther.productName + ' (' + renewal.bestOther.durationMonths + 'M)',
        annualReturn: Math.round(group.totalAmount * renewal.bestOther.rate / 100),
        delta: Math.round(group.totalAmount * delta / 100),
        deltaLabel: delta >= 0 ? '+' + delta.toFixed(2) + '%' : delta.toFixed(2) + '%',
        fgdrWarning: fgdrWarning,
        fgdrSplit: fgdrWarning ? Math.ceil(group.totalAmount / 100000) : 0
      });
    }

    // Option C: Structured product (capped, not full amount)
    var structOptions = _getStructuredOptions(group.entity, group.totalAmount, bestCatRate);
    if (structOptions.length > 0) {
      var best = structOptions[0];
      // Cap at min investment or 30% of total, whichever is higher
      var cap30 = Math.round(group.totalAmount * 0.30 / 1000) * 1000;
      var allocAmount = best.minInvestment > cap30 ? best.minInvestment : cap30;
      allocAmount = Math.min(allocAmount, group.totalAmount);
      allocAmount = Math.round(allocAmount / 1000) * 1000;
      var remainInCat = group.totalAmount - allocAmount;

      var structReturn = Math.round(allocAmount * best.rdtNet / 100);
      var catReturn = remainInCat > 0 ? Math.round(remainInCat * bestCatRate / 100) : 0;
      var totalReturn = structReturn + catReturn;
      var currentReturn = Math.round(group.totalAmount * group.avgRate / 100);

      options.push({
        type: 'structured',
        label: best.name + ' ' + best.grade,
        icon: '📦',
        rate: best.rdtNet,
        product: allocAmount >= group.totalAmount ? _fmt(allocAmount) + '€ en structuré' : _fmt(allocAmount) + '€ structuré + ' + _fmt(remainInCat) + '€ CAT',
        annualReturn: totalReturn,
        delta: totalReturn - currentReturn,
        deltaLabel: '+' + best.rdtNet.toFixed(1) + '% (BS net)',
        structName: best.name,
        structGrade: best.grade,
        structAmount: allocAmount,
        catRemain: remainInCat,
        catRate: bestCatRate,
        pessimiste: Math.round(allocAmount * best.rdtNet * 0.2 / 100) + catReturn,
        optimiste: Math.round(allocAmount * best.rdtNet * 1.5 / 100) + catReturn
      });
    }

    // Option D: Wait — always propose if time allows (> 3 months to maturity)
    if (group.monthsToMaturity > 3) {
      var trendMsg = macro.rateTrend === 'rising' ? 'taux en hausse — attendre peut payer' :
                     macro.rateTrend === 'falling' ? 'taux en baisse — ne pas trop attendre' :
                     'taux stables — marge de manœuvre';
      options.push({
        type: 'wait',
        label: 'Attendre de meilleures offres',
        icon: '⏳',
        rate: group.avgRate,
        product: group.monthsToMaturity + ' mois avant échéance · ' + trendMsg,
        annualReturn: Math.round(group.totalAmount * group.avgRate / 100),
        delta: 0, // same as current
        deltaLabel: 'Garder le taux actuel ' + group.avgRate.toFixed(2) + '%'
      });
    }

    // Sort: structured first (if big delta), then best CAT, then wait
    options.sort(function(a, b) { return b.delta - a.delta; });

    return {
      group: group,
      options: options,
      recommended: options.length > 0 ? options[0] : null
    };
  }

  function _fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }

  // ─── Render ────────────────────────────────────────────
  function _renderMaturitySection(analyses) {
    if (!analyses || analyses.length === 0) return '';

    var totalMaturing = analyses.reduce(function(s, a) { return s + a.group.totalAmount; }, 0);
    var html = '<div style="border:2px solid rgba(255,182,39,0.3);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;background:rgba(255,182,39,0.03)">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--orange)">🔔 CAT à échéance (' + MATURITY_HORIZON_MONTHS + ' prochains mois)</div>';
    html += '<div style="font-family:var(--mono);font-weight:700;color:var(--orange)">' + _fmt(totalMaturing) + '€ à réallouer</div>';
    html += '</div>';

    analyses.forEach(function(a) {
      var g = a.group;
      var gc = function(grade) { return {A:'#06D6A0',B:'#4ECDC4',C:'#FFB627',D:'#E85D04',F:'#EF233C'}[grade] || '#888'; };
      var matDate = new Date(g.maturityDate).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

      html += '<div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px;background:var(--bg-card)">';
      // Header
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      html += '<div><div style="font-size:12px;font-weight:600;color:var(--text-bright)">' + g.deposits.length + '× ' + g.deposits[0].productName + '</div>';
      html += '<div style="font-size:10px;color:var(--text-dim)">' + g.bankName + ' · ' + (g.entity === 'bycam' ? '🏢 ByCam' : '🦎 Cam.') + ' · Échéance ' + matDate + ' (' + g.monthsToMaturity + ' mois)</div></div>';
      html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + _fmt(g.totalAmount) + '€</div>';
      html += '<div style="font-size:10px;color:var(--text-dim)">Taux actuel ' + g.avgRate.toFixed(2) + '%</div></div>';
      html += '</div>';

      // Options
      a.options.forEach(function(opt, i) {
        var isReco = (i === 0);
        var borderC = isReco ? 'rgba(6,214,160,0.3)' : 'var(--border)';
        var bgC = isReco ? 'rgba(6,214,160,0.04)' : 'transparent';

        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;border:1px solid ' + borderC + ';border-radius:4px;background:' + bgC + '">';
        html += '<span style="font-size:14px">' + opt.icon + '</span>';
        html += '<div style="flex:1;min-width:0">';
        html += '<div style="font-size:11px;font-weight:' + (isReco ? '700' : '400') + ';color:var(--text-bright)">' + (isReco ? '✅ ' : '') + opt.label + '</div>';
        html += '<div style="font-size:9px;color:var(--text-dim)">' + opt.product + '</div>';
        html += '</div>';
        html += '<div style="text-align:right;white-space:nowrap">';
        if (opt.rate != null) html += '<div style="font-family:var(--mono);font-size:11px;color:var(--cyan)">' + opt.rate.toFixed(1) + '%</div>';
        html += '<div style="font-family:var(--mono);font-size:10px;color:' + (opt.delta >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (opt.delta >= 0 ? '+' : '') + _fmt(opt.delta) + '€/an</div>';
        html += '</div></div>';

        // FGDR warning
        if (opt.fgdrWarning) {
          html += '<div style="font-size:9px;color:var(--orange);padding-left:30px;margin-bottom:4px">⚠️ FGDR : splitter sur ' + opt.fgdrSplit + ' banques (max 100K€/banque)</div>';
        }
        // Structured fourchette
        if (opt.type === 'structured' && isReco) {
          html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:4px 0 4px 30px">';
          html += '<div style="text-align:center;padding:3px;border-radius:3px;background:rgba(239,35,60,0.06);font-size:8px"><span style="color:var(--text-dim)">Pessim.</span> <span style="font-family:var(--mono);color:var(--red)">+' + _fmt(opt.pessimiste) + '€</span></div>';
          html += '<div style="text-align:center;padding:3px;border-radius:3px;background:rgba(78,205,196,0.06);font-size:8px"><span style="color:var(--text-dim)">Médian</span> <span style="font-family:var(--mono);color:var(--cyan)">+' + _fmt(opt.annualReturn) + '€</span></div>';
          html += '<div style="text-align:center;padding:3px;border-radius:3px;background:rgba(6,214,160,0.06);font-size:8px"><span style="color:var(--text-dim)">Optim.</span> <span style="font-family:var(--mono);color:var(--green)">+' + _fmt(opt.optimiste) + '€</span></div>';
          html += '</div>';
        }
      });

      if (a.options.length === 0) {
        html += '<div style="font-size:10px;color:var(--text-dim);padding:4px 0">Renouveler aux mêmes conditions.</div>';
      }

      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  // ─── Public API ────────────────────────────────────────
  window._getMaturityAnalyses = function() {
    var maturing = _getMaturingDeposits();
    if (maturing.length === 0) return [];
    var groups = _groupDeposits(maturing);
    return groups.map(function(g) { return _buildOptions(g); });
  };

  window._renderMaturityOptimizer = function() {
    var analyses = window._getMaturityAnalyses();
    return _renderMaturitySection(analyses);
  };

  console.log('[StructBoard] CAT Maturity Optimizer v1.0 loaded');
})();

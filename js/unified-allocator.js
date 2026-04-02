// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Unified Allocator v1.0
// Combines CAT rates + Structured products into a single allocation engine.
// Questionnaire-based: user defines cash horizons, allocator optimizes across
// both CAT and structured products per time bucket.
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _state = {
    tranches: null,     // user-defined or auto from MI regime
    result: null,       // allocation result
    mode: 'auto',       // 'auto' or 'manual'
    totalCash: 0,
    entities: {},       // { bycam: { cash, deposits, structLiq, maturingCat }, cameleons: { ... } }
    includeStructLiq: {}, // { cameleons: true/false }
    includeMaturingCat: {} // { cameleons: true/false }
  };

  // ─── MI regime profiles ────────────────────────────────
  // Profils : immédiat = 1 - court - moyen - long (calculé auto)
  // CAT existants = la réserve, donc pas besoin de "court" élevé
  var REGIME_PROFILES = {
    stagflation: { court: 0.00, moyen: 0.50, long: 0.50, label: 'Stagflation — CAT existants = réserve, déployer moyen/long' },
    recession:   { court: 0.30, moyen: 0.40, long: 0.30, label: 'Récession — prudence, moyen terme' },
    crisis:      { court: 0.50, moyen: 0.30, long: 0.20, label: 'Crise — cash is king' },
    neutral:     { court: 0.15, moyen: 0.40, long: 0.45, label: 'Neutre — déploiement équilibré' },
    bull:        { court: 0.10, moyen: 0.35, long: 0.55, label: 'Haussier — déploiement maximal' },
    'risk-on':   { court: 0.05, moyen: 0.35, long: 0.60, label: 'Risk-on — agressif' },
    expansion:   { court: 0.10, moyen: 0.40, long: 0.50, label: 'Expansion — croissance' }
  };

  // ─── Horizon buckets ───────────────────────────────────
  var HORIZONS = [
    { id: 'immediat',   label: 'Immédiat', sublabel: '< 3 mois',   icon: '🔴', maxMonths: 3,   color: '#EF233C' },
    { id: 'court',      label: 'Court terme', sublabel: '3-12 mois', icon: '🟠', maxMonths: 12,  color: '#FFB627' },
    { id: 'moyen',      label: 'Moyen terme', sublabel: '1-3 ans',   icon: '🟡', maxMonths: 36,  color: '#4ECDC4' },
    { id: 'long',       label: 'Long terme', sublabel: '3-10 ans',   icon: '🟢', maxMonths: 120, color: '#06D6A0' }
  ];

  // ─── Get current regime ────────────────────────────────
  function _getRegime() {
    try {
      if (typeof _getOptimizerMI === 'function') {
        var mi = _getOptimizerMI();
        if (mi && mi.regime) return mi.regime.toLowerCase();
      }
      if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._mi && _mktCache._mi.regime) {
        return _mktCache._mi.regime.toLowerCase();
      }
    } catch(e) {}
    return 'neutral';
  }

  // ─── Compute cash per entity ────────────────────────────
  function _computeEntities() {
    var entities = {
      bycam: { cash: 0, structLiq: 0, maturingCat: 0, maturingDetails: [], label: '🏢 ByCam' },
      cameleons: { cash: 0, structLiq: 0, maturingCat: 0, maturingDetails: [], label: '🦎 Caméléons' }
    };

    // External cash — try catManager first, fallback to direct file read
    try {
      if (typeof catManager !== 'undefined' && catManager.objectives) {
        entities.bycam.cash = parseFloat(catManager.objectives.cashByCam) || 0;
        entities.cameleons.cash = parseFloat(catManager.objectives.cashCameleons) || 0;
      }
    } catch(e) {}
    // Fallback: if catManager not loaded, read from cached objectives
    if (entities.bycam.cash === 0 && entities.cameleons.cash === 0) {
      try {
        if (typeof catManager !== 'undefined' && typeof catManager.load === 'function' && !catManager.objectives) {
          // catManager exists but objectives not loaded yet
          console.log('[Allocator] catManager.objectives not loaded, using fallback');
        }
      } catch(e) {}
    }

    // Structured liquidity (Bond 12M etc.) — check entity on portfolio items
    var portfolio = app.state.portfolio || [];
    portfolio.forEach(function(p) {
      var isLiq = (p.grading && p.grading.grade === '-') || (typeof _isLiquidityProduct === 'function' && typeof _graderNormalize === 'function' && _isLiquidityProduct(_graderNormalize(p)));
      if (!isLiq) return;
      var amount = parseFloat(p.investedAmount) || 0;
      var ent = p.entity || 'cameleons'; // default to cameleons if not set
      if (entities[ent]) entities[ent].structLiq += amount;
      else entities.cameleons.structLiq += amount;
    });

    // Detect CAT maturing within 8 months
    try {
      if (typeof catManager !== 'undefined' && catManager.deposits) {
        var now = new Date();
        var horizon = new Date(now);
        horizon.setMonth(horizon.getMonth() + 8);
        catManager.deposits.forEach(function(d) {
          if (d.status !== 'active' || !d.maturityDate) return;
          var mat = new Date(d.maturityDate);
          if (mat > now && mat <= horizon) {
            var ent = d.entity || 'cameleons';
            var amount = parseFloat(d.amount) || 0;
            if (entities[ent]) {
              entities[ent].maturingCat += amount;
              entities[ent].maturingDetails.push({
                name: d.productName, amount: amount, rate: d.rate,
                maturityDate: d.maturityDate, bankName: d.bankName
              });
            }
          }
        });
      }
    } catch(e) {}

    // total = cash libre + structLiq (if opted in) + maturingCat (if opted in)
    entities.bycam.total = entities.bycam.cash
      + ((_state.includeStructLiq && _state.includeStructLiq.bycam) ? entities.bycam.structLiq : 0)
      + ((_state.includeMaturingCat && _state.includeMaturingCat.bycam) ? entities.bycam.maturingCat : 0);
    entities.cameleons.total = entities.cameleons.cash
      + ((_state.includeStructLiq && _state.includeStructLiq.cameleons) ? entities.cameleons.structLiq : 0)
      + ((_state.includeMaturingCat && _state.includeMaturingCat.cameleons) ? entities.cameleons.maturingCat : 0);

    return entities;
  }

  // ─── Get real CAT deposits (user's own contracts, not web rates) ──
  function _getCATDeposits(entityFilter) {
    try {
      if (typeof catManager !== 'undefined' && catManager.deposits) {
        return catManager.deposits.filter(function(d) {
          if (d.status !== 'active') return false;
          if (entityFilter && d.entity !== entityFilter) return false;
          return true;
        });
      }
    } catch(e) {}
    return [];
  }

  // Best CAT rate AVAILABLE for new placement (not existing deposits)
  // Existing deposits are already placed — the benchmark for new cash
  // is the best rate you can actually get NOW from available offers
  function _bestCATRate(entityFilter) {
    var best = 2.5; // fallback ECB
    // From available offers only (what you can subscribe to today)
    var offers = _getCATOffers(0);
    offers.forEach(function(o) { if (o.rate > best) best = o.rate; });
    // If no offers, fall back to existing deposits as proxy
    if (offers.length === 0) {
      var deposits = _getCATDeposits(entityFilter);
      deposits.forEach(function(d) { if (d.rate > best) best = d.rate; });
    }
    return best;
  }

  // ─── Get best CAT offers from user-entered rates ────────
  // v1.2: integrates MI-CAT macro context for duration filtering
  function _getCATOffers(amount) {
    try {
      if (typeof catManager !== 'undefined' && catManager.rates && catManager.rates.rates) {
        var offers = catManager.rates.rates.filter(function(r) {
          // Only use confirmed rates (user-entered), not web scan
          if (r.source === 'web scan') return false;
          return r.rate > 0 && (!r.minAmount || amount >= r.minAmount);
        });
        // Get macro context if available
        var macro = _getMacroContext();
        if (macro) {
          // Filter by recommended max duration
          if (macro.maxDurationMonths) {
            offers = offers.filter(function(r) {
              return r.durationMonths <= macro.maxDurationMonths;
            });
          }
          // Adjust scoring: in rising trend, prefer shorter duration (to renew at higher rate)
          if (macro.rateTrend === 'rising') {
            offers.sort(function(a, b) {
              // Prefer shorter durations in rising rate environment
              var scoreA = a.rate - (a.durationMonths > 12 ? 0.3 : 0);
              var scoreB = b.rate - (b.durationMonths > 12 ? 0.3 : 0);
              return scoreB - scoreA;
            });
          } else if (macro.rateTrend === 'falling') {
            // Lock in longest duration at best rate
            offers.sort(function(a, b) {
              var scoreA = a.rate + (a.durationMonths > 24 ? 0.2 : 0);
              var scoreB = b.rate + (b.durationMonths > 24 ? 0.2 : 0);
              return scoreB - scoreA;
            });
          } else {
            offers.sort(function(a, b) { return b.rate - a.rate; });
          }
        } else {
          offers.sort(function(a, b) { return b.rate - a.rate; });
        }
        return offers;
      }
    } catch(e) {}
    return [];
  }

  function _getMacroContext() {
    try {
      if (typeof _loadCATMacroData !== 'undefined' && typeof _macroCache !== 'undefined' && _macroCache && _macroCache.macroContext) {
        return _macroCache.macroContext;
      }
      // Fallback: try to derive from MI cache
      var regime = _getRegime();
      return {
        rateTrend: 'stable',
        regime: regime,
        maxDurationMonths: regime === 'stagflation' ? 48 : regime === 'crisis' ? 24 : 60,
        forwardRate12m: null
      };
    } catch(e) {}
    return null;
  }

  // ─── Get graded structured products ────────────────────
  function _getStructuredCandidates() {
    var candidates = [];
    Object.values(app.state.proposals || {}).forEach(function(arr) {
      arr.forEach(function(p) {
        if (p.status === 'rejected' || p.status === 'subscribed') return;
        if (!p.grading || !p.grading.grade || p.grading.grade === '?' || p.grading.grade === '-') return;
        var cp = p.capitalProtection || {};
        var isCapGaranti = cp.protected === true || (p.structureType || '').indexOf('capital_garanti') >= 0 || (p.structureType || '').indexOf('dispersion') >= 0 || (p.structureType || '').indexOf('taux_fixe') >= 0;
        var rdtNet = p._bsRendementNet || (p.grading.metadata && p.grading.metadata.bsRendementNet) || p._ratesRendementNet || null;
        // Correct rdtNet for dispersion if real correlation data is available
        if (rdtNet && (p.structureType === 'dispersion' || (p.underlyingType || '').indexOf('pairs') >= 0)) {
          try {
            var corrFile = null;
            if (typeof fetch === 'function') {
              // Check if correlation data loaded in grader
              // Use the formula: rdtNet = (1 - corr) × 16, capped
              // If _corrData available from grader v7
            }
            // Simple check: if grading metadata has corr data
            if (p.grading && p.grading.metadata && p.grading.metadata.bsRendementNet) {
              // Use latest grading value (may already be corrected if re-graded)
              rdtNet = p.grading.metadata.bsRendementNet;
            }
          } catch(e) {}
        }
        // Fallback for taux fixe: compute TRI actualisé (not facial coupon)
        if (rdtNet == null && (p.structureType === 'taux_fixe' || isCapGaranti)) {
          var c = p.coupon;
          var rateIfCalled = typeof c === 'object' ? (parseFloat(c.rateIfCalled) || parseFloat(c.rate) || 0) : (parseFloat(c) || 0);
          var rateAtMaturity = typeof c === 'object' ? (parseFloat(c.rateIfMaturity) || rateIfCalled) : rateIfCalled;
          var matY = parseFloat(p.maturityYears) || 5;

          if (rateIfCalled > 0 && matY > 0) {
            // Callable TRI: weighted by call probability
            // In stagflation, call prob ~20% → most likely goes to maturity
            var callProb = 0.20; // conservative default
            // TRI if called (avg year 3): (1 + rate × years)^(1/years) - 1
            var avgCallYear = Math.min(matY, Math.max(2, matY * 0.4));
            var triCalled = Math.pow(1 + rateIfCalled / 100 * avgCallYear, 1 / avgCallYear) - 1;
            // TRI at maturity
            var triMaturity = Math.pow(1 + rateAtMaturity / 100 * matY, 1 / matY) - 1;
            // Weighted TRI
            rdtNet = Math.round((callProb * triCalled * 100 + (1 - callProb) * triMaturity * 100) * 100) / 100;
          } else {
            rdtNet = rateIfCalled;
          }
        }
        var minInvest = parseFloat(p.minInvestment) || (p.aiParsed && parseFloat(p.aiParsed.minInvestment)) || 0;
        candidates.push({
          id: p.id,
          name: p.name || 'Produit',
          bankName: p.bankId || '',
          grade: p.grading.grade,
          minInvestment: minInvest,
          score: p.grading.score || 0,
          maturityYears: parseFloat(p.maturityYears) || 5,
          maturityMonths: (parseFloat(p.maturityYears) || 5) * 12,
          rdtNet: rdtNet,
          coupon: (p.coupon && p.coupon.rate) || parseFloat(p.coupon) || 0,
          capitalGaranti: isCapGaranti,
          structureType: p.structureType || '',
          type: 'structured'
        });
      });
    });
    return candidates;
  }

  // ─── Best candidates for a time bucket ─────────────────
  // CAT deposits are NOT candidates — they ARE the reserve.
  // Only structured products are candidates for new allocation.
  // For horizons where no structured fits, cash stays in existing CAT.
  function _bestForHorizon(horizon, structCandidates, allocated, bestCatRate) {
    var maxMonths = horizon.maxMonths;
    var candidates = [];

    // Structured candidates: maturity fits horizon AND capital garanti
    // v7.1: minimum spread threshold — products > 5Y must beat CAT by +1%
    structCandidates.forEach(function(s) {
      if (allocated[s.id]) return;
      if (s.maturityMonths <= maxMonths && s.capitalGaranti && s.rdtNet != null && s.rdtNet > 0) {
        var minSpread = s.maturityMonths > 60 ? 1.0 : 0; // >5Y needs +1% vs CAT
        if (s.rdtNet < bestCatRate + minSpread) return; // doesn't beat CAT enough
        candidates.push({
          id: s.id,
          name: s.name,
          bankName: s.bankName,
          rate: s.rdtNet,
          durationMonths: s.maturityMonths,
          type: 'structured',
          capitalGaranti: s.capitalGaranti,
          grade: s.grade,
          score: s.score,
          structureType: s.structureType,
          minInvestment: s.minInvestment || 0,
          liquidity: 'Échéance'
        });
      }
    });

    candidates.sort(function(a, b) { return b.rate - a.rate; });
    return candidates;
  }

  // ─── Allocate across all tranches ──────────────────────
  function _allocate(tranches, totalCash, entityKey) {
    var structCandidates = _getStructuredCandidates();
    // Only restrict to Swiss Life if the entity cash is ONLY from structLiq (no free cash, no maturing CAT)
    var ent = _state.entities[entityKey];
    var hasOnlyStructLiq = (_state.includeStructLiq && _state.includeStructLiq[entityKey]) && ent && ent.cash === 0 && ent.maturingCat === 0;
    if (hasOnlyStructLiq) {
      structCandidates = structCandidates.filter(function(s) {
        return s.bankName === 'swiss-life';
      });
    }
    var allocated = {};
    var results = [];

    // Best CAT rate from user's own deposits for comparison
    var bestCatRate = _bestCATRate(entityKey);

    tranches.forEach(function(tr) {
      var budget = tr.amount;
      if (budget <= 0) { results.push({ horizon: tr.horizon, amount: 0, allocated: 0, remaining: 0, allocations: [] }); return; }

      var candidates = _bestForHorizon(tr.horizon, structCandidates, allocated, bestCatRate);
      var allocs = [];
      var remaining = budget;
      // Max 30% of total entity cash per product (diversification)
      var maxPer = Math.round(totalCash * 0.30 / 1000) * 1000;

      candidates.forEach(function(c) {
        if (remaining <= 0) return;
        var minReq = c.minInvestment || 0;
        // If minimum investment exceeds remaining budget, skip
        if (minReq > 0 && remaining < minReq) return;
        // If minimum > cap 30%, use minimum (override cap)
        var effectiveMax = minReq > maxPer ? minReq : maxPer;
        var amount = Math.min(remaining, effectiveMax);
        amount = Math.round(amount / 1000) * 1000;
        if (amount < 1000) return;
        if (minReq > 0 && amount < minReq) return; // after rounding

        allocs.push({
          id: c.id,
          name: c.name,
          bankName: c.bankName,
          rate: c.rate,
          amount: amount,
          annualReturn: Math.round(amount * c.rate / 100),
          durationMonths: c.durationMonths,
          type: c.type,
          capitalGaranti: c.capitalGaranti,
          grade: c.grade || null,
          score: c.score || null,
          structureType: c.structureType || null,
          minInvestment: c.minInvestment || 0,
          liquidity: c.liquidity
        });

        remaining -= amount;
        if (c.type === 'structured') allocated[c.id] = true;
      });

      results.push({
        horizon: tr.horizon,
        amount: budget,
        allocated: budget - remaining,
        remaining: remaining,
        allocations: allocs
      });
    });

    // Compute totals
    var totalAllocated = results.reduce(function(s, r) { return s + r.allocated; }, 0);
    var totalReturn = results.reduce(function(s, r) { return s + r.allocations.reduce(function(s2, a) { return s2 + a.annualReturn; }, 0); }, 0);
    var catEquivReturn = Math.round(totalCash * bestCatRate / 100);
    var weightedRate = totalAllocated > 0 ? (totalReturn / totalAllocated * 100) : 0;

    return {
      tranches: results,
      totalCash: totalCash,
      totalAllocated: totalAllocated,
      totalUnallocated: totalCash - totalAllocated,
      totalReturn: totalReturn,
      catEquivReturn: catEquivReturn,
      excessVsCat: totalReturn - catEquivReturn,
      weightedRate: Math.round(weightedRate * 100) / 100,
      bestCatRate: bestCatRate,
      regime: _getRegime(),
      // Only show "Garder Bond 12M" if ALL the unallocated is from structLiq
      isStructLiqOnly: hasOnlyStructLiq && !(_state.includeMaturingCat && _state.includeMaturingCat[entityKey]),
      hasMaturingCat: !!(_state.includeMaturingCat && _state.includeMaturingCat[entityKey] && _state.entities[entityKey].maturingCat > 0)
    };
  }

  // ═══ RENDER ════════════════════════════════════════════

  function _fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }

  function _renderEntityBlock(entKey, ent, regime, profile) {
    var html = '';
    html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;background:var(--bg-card)">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--text-bright)">' + ent.label + '</span>';
    html += '<div style="text-align:right">';
    if (ent.cash > 0) html += '<span style="font-size:10px;color:var(--text-dim)">Cash ' + _fmt(ent.cash) + '€</span> ';
    html += '<span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--cyan);margin-left:8px">' + _fmt(ent.cash) + '€</span>';
    html += '</div></div>';
    if (ent.structLiq > 0) {
      var isChecked = _state.includeStructLiq && _state.includeStructLiq[entKey];
      html += '<div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between">';
      html += '<span style="color:#A855F7;font-weight:600">🔄 Arbitrage Swiss Life : ' + _fmt(ent.structLiq) + '€</span>';
      html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="alloc-sl-' + entKey + '" ' + (isChecked ? 'checked' : '') + ' onchange="_allocatorToggleSL(\'' + entKey + '\')" style="cursor:pointer"><span style="font-size:10px;color:var(--text-muted)">Optimiser</span></label>';
      html += '</div>';
      html += '<div style="color:var(--text-dim);margin-top:2px">Bond 12M — arbitrable uniquement vers produits Swiss Life</div>';
      html += '</div>';
    }

    // Maturing CAT badge
    if (ent.maturingCat > 0) {
      var isMatChecked = _state.includeMaturingCat && _state.includeMaturingCat[entKey];
      var matDate = ent.maturingDetails.length > 0 ? new Date(ent.maturingDetails[0].maturityDate).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '';
      var matRate = ent.maturingDetails.length > 0 ? ent.maturingDetails[0].rate : 0;
      html += '<div style="background:rgba(255,182,39,0.06);border:1px solid rgba(255,182,39,0.15);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between">';
      html += '<span style="color:var(--orange);font-weight:600">🔔 CAT à échéance : ' + _fmt(ent.maturingCat) + '€</span>';
      html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="alloc-matcat-' + entKey + '" ' + (isMatChecked ? 'checked' : '') + ' onchange="_allocatorToggleMatCat(\'' + entKey + '\')" style="cursor:pointer"><span style="font-size:10px;color:var(--text-muted)">Inclure</span></label>';
      html += '</div>';
      html += '<div style="color:var(--text-dim);margin-top:2px">' + ent.maturingDetails.length + '× ' + (ent.maturingDetails[0] ? ent.maturingDetails[0].name : 'CAT') + ' · ' + matRate.toFixed(1) + '% · Échéance ' + matDate + '</div>';
      html += '</div>';
    }

    if (ent.total <= 0 && !(_state.includeStructLiq && _state.includeStructLiq[entKey])) {
      // No free cash and structLiq not opted in
      if (ent.structLiq > 0) {
        html += '<div style="font-size:10px;color:var(--text-dim);text-align:center;padding:8px 0">Cochez "Optimiser" ci-dessus pour chercher un arbitrage Swiss Life</div>';
      } else {
        html += '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px 0">Pas de liquidité disponible</div>';
      }
      html += '</div>';
      return html;
    }

    if (_state.mode === 'manual') {
      HORIZONS.forEach(function(h) {
        var val = (_state.tranches && _state.tranches[entKey + '_' + h.id]) || 0;
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
        html += '<span style="font-size:14px;width:20px;text-align:center">' + h.icon + '</span>';
        html += '<div style="flex:1"><div style="font-size:11px;font-weight:600;color:var(--text-bright)">' + h.label + '</div>';
        html += '<div style="font-size:9px;color:var(--text-dim)">' + h.sublabel + '</div></div>';
        html += '<input type="number" id="alloc-' + entKey + '-' + h.id + '" value="' + val + '" min="0" step="1000" style="width:100px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elevated);color:var(--text-bright);font-family:var(--mono);font-size:12px;text-align:right" onchange="_allocatorUpdateRemaining()">';
        html += '<span style="font-size:10px;color:var(--text-dim)">€</span></div>';
      });
      // Libre
      html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<span style="font-size:14px;width:20px;text-align:center">➕</span>';
      html += '<input type="text" id="alloc-' + entKey + '-libre-label" placeholder="Ex: projet" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-elevated);color:var(--text-bright);font-size:10px">';
      html += '<input type="number" id="alloc-' + entKey + '-libre-months" placeholder="Mois" min="1" max="120" style="width:50px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-elevated);color:var(--text-bright);font-size:10px">';
      html += '<input type="number" id="alloc-' + entKey + '-libre" value="0" min="0" step="1000" style="width:100px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elevated);color:var(--text-bright);font-family:var(--mono);font-size:12px;text-align:right" onchange="_allocatorUpdateRemaining()">';
      html += '<span style="font-size:10px;color:var(--text-dim)">€</span></div></div>';
      html += '<div id="alloc-remaining-' + entKey + '" style="margin-top:6px;font-size:10px;color:var(--text-muted)"></div>';
    } else {
      var immPct = Math.max(0, 1.0 - profile.court - profile.moyen - profile.long);
      var pcts = [immPct, profile.court, profile.moyen, profile.long];
      HORIZONS.forEach(function(h, i) {
        var amount = Math.round(ent.total * pcts[i] / 1000) * 1000;
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">';
        html += '<span style="font-size:12px">' + h.icon + '</span>';
        html += '<span style="flex:1;font-size:11px;color:var(--text-bright)">' + h.label + '</span>';
        html += '<span style="font-size:10px;color:var(--text-dim)">' + Math.round(pcts[i] * 100) + '%</span>';
        html += '<span style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--cyan)">' + _fmt(amount) + '€</span>';
        html += '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function _renderQuestionnaire(container, totalCash) {
    var regime = _getRegime();
    var profile = REGIME_PROFILES[regime] || REGIME_PROFILES.neutral;
    var ents = _state.entities;

    var html = '<div class="section">';
    html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>💰 Allocateur Unifié</div></div>';

    // Regime + total
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px 16px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--accent)">🌍 ' + regime.toUpperCase() + '</span>';
    html += '<span style="font-size:11px;color:var(--text-muted)">' + profile.label + '</span>';
    var totalStructLiq = ents.bycam.structLiq + ents.cameleons.structLiq;
    html += '<span style="margin-left:auto;font-size:11px;color:var(--text-dim)">';
    html += '🏢 ByCam ' + _fmt(ents.bycam.cash) + '€ · 🦎 Cam. ' + _fmt(ents.cameleons.cash) + '€';
    if (totalStructLiq > 0) html += ' · <span style="color:#A855F7">🔄 SL ' + _fmt(totalStructLiq) + '€</span>';
    html += '</span>';
    html += '<span style="font-size:14px;font-weight:700;color:var(--cyan)">' + _fmt(totalCash) + '€ cash</span>';
    html += '</div>';

    // Mode toggle
    html += '<div style="display:flex;gap:8px;margin-bottom:16px">';
    html += '<button class="btn sm ' + (_state.mode === 'auto' ? 'primary' : '') + '" onclick="_allocatorSetMode(\'auto\')">🤖 Auto (' + regime + ')</button>';
    html += '<button class="btn sm ' + (_state.mode === 'manual' ? 'primary' : '') + '" onclick="_allocatorSetMode(\'manual\')">✏️ Personnalisé</button>';
    html += '</div>';

    // Two columns: ByCam + Caméléons
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
    html += _renderEntityBlock('bycam', ents.bycam, regime, profile);
    html += _renderEntityBlock('cameleons', ents.cameleons, regime, profile);
    html += '</div>';

    // Optimize button
    html += '<button class="btn primary ai-glow" style="width:100%;padding:14px;font-size:14px" onclick="_allocatorRun()">⚡ Optimiser l\'allocation des 2 entités</button>';
    html += '</div>';

    container.innerHTML = html;
    if (_state.mode === 'manual') _allocatorUpdateRemaining();
  }

  function _renderEntityResult(entKey, result) {
    var html = '';
    html += '<div style="margin-bottom:16px">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:8px">' + result.entityLabel + ' — ' + _fmt(result.totalCash) + '€</div>';

    // If nothing was allocated in any tranche AND cash > 0 → "en attente"
    var hasAnyAllocation = result.tranches.some(function(tr) { return tr.allocations && tr.allocations.length > 0; });
    var allTranchesEmpty = result.tranches.every(function(tr) { return tr.amount <= 0; });
    if (allTranchesEmpty && result.totalCash > 0 && !result.isStructLiqOnly) {
      html += '<div style="border:1px solid rgba(78,205,196,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:8px;background:rgba(78,205,196,0.03)">';
      html += '<div style="font-size:12px;font-weight:600;color:var(--cyan)">💰 Cash en attente d\'opportunité</div>';
      html += '<div style="font-size:10px;color:var(--text-dim);margin-top:4px">Aucun horizon défini. Cash disponible pour le prochain produit structuré capital garanti.</div>';
      html += '<div style="font-family:var(--mono);font-weight:700;color:var(--text-bright);margin-top:6px">' + _fmt(result.totalCash) + '€</div>';
      html += '</div></div>';
      return html;
    }

    // Tranches for this entity
    result.tranches.forEach(function(tr) {
      if (tr.amount <= 0) return;
      var h = HORIZONS.find(function(x) { return x.id === tr.horizon.id; }) || tr.horizon;
      html += '<div style="border:1px solid ' + (h.color || 'var(--border)') + '33;border-left:3px solid ' + (h.color || 'var(--accent)') + ';border-radius:var(--radius-sm);padding:12px;margin-bottom:10px;background:var(--bg-card)">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      html += '<span style="font-size:13px;font-weight:700;color:' + (h.color || 'var(--text-bright)') + '">' + (h.icon || '📌') + ' ' + h.label + ' <span style="font-weight:400;color:var(--text-dim);font-size:11px">' + (h.sublabel || '') + '</span></span>';
      html += '<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">' + _fmt(tr.amount) + '€</span>';
      html += '</div>';

      if (tr.allocations.length === 0) {
        html += '<div style="font-size:11px;color:var(--text-dim);padding:4px 0">Aucun véhicule optimal trouvé — garder en fonds monétaire.</div>';
      }

      tr.allocations.forEach(function(a) {
        var isCat = a.type === 'cat';
        var borderC = isCat ? 'rgba(255,182,39,0.2)' : 'rgba(6,214,160,0.2)';
        var bgC = isCat ? 'rgba(255,182,39,0.03)' : 'rgba(6,214,160,0.03)';
        var typeLabel = isCat ? '🏦 CAT' : '📦 Structuré';
        var gradeHtml = a.grade ? ' <span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:4px;background:' + ({A:'#06D6A0',B:'#4ECDC4',C:'#FFB627',D:'#E85D04',F:'#EF233C'}[a.grade] || '#888') + '22;color:' + ({A:'#06D6A0',B:'#4ECDC4',C:'#FFB627',D:'#E85D04',F:'#EF233C'}[a.grade] || '#888') + ';font-weight:700;font-size:10px">' + a.grade + '</span>' : '';

        html += '<div style="background:' + bgC + ';border:1px solid ' + borderC + ';border-radius:6px;padding:8px 10px;margin-bottom:4px;display:flex;align-items:center;gap:10px">';
        html += '<div style="flex:1;min-width:0">';
        html += '<div style="font-size:11px;font-weight:600;color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + a.name + gradeHtml + '</div>';
        html += '<div style="font-size:10px;color:var(--text-dim)">' + typeLabel + ' · ' + a.bankName + (a.capitalGaranti ? ' · 🛡️' : '') + ' · ' + a.durationMonths + 'M' + (a.type === 'structured' ? ' · <span style="color:var(--red);font-weight:600">non FGDR</span>' : '') + '</div>';
        html += '</div>';
        html += '<div style="text-align:right;white-space:nowrap">';
        html += '<div style="font-family:var(--mono);font-weight:700;color:var(--cyan);font-size:12px">' + _fmt(a.amount) + '€</div>';
        html += '<div style="font-family:var(--mono);font-size:10px;color:var(--green)">' + a.rate.toFixed(1) + '% → +' + _fmt(a.annualReturn) + '€/an</div>';
        html += '</div></div>';

        // Fourchette de rendement (pessimiste / médian / optimiste) + coût opportunité
        if (a.type === 'structured' && a.rate > 0) {
          var optimiste = Math.round(a.amount * a.rate * 1.5 / 100);
          var median = a.annualReturn;
          var pessimiste = Math.round(a.amount * a.rate * 0.2 / 100);
          // Coût d'opportunité : si CAT monte à +0.5% et dispersion = 0
          var catFutur = (result.bestCatRate || 2.9) + 0.5;
          var coutOpportunite = Math.round(a.amount * catFutur / 100 * ((a.durationMonths || 36) / 12 - 1));
          html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:4px">';
          html += '<div style="text-align:center;padding:4px;border-radius:4px;background:rgba(239,35,60,0.06);font-size:9px"><div style="color:var(--text-dim)">Pessimiste</div><div style="font-family:var(--mono);color:var(--red);font-weight:600">+' + _fmt(pessimiste) + '€</div></div>';
          html += '<div style="text-align:center;padding:4px;border-radius:4px;background:rgba(78,205,196,0.06);font-size:9px"><div style="color:var(--text-dim)">Médian</div><div style="font-family:var(--mono);color:var(--cyan);font-weight:600">+' + _fmt(median) + '€</div></div>';
          html += '<div style="text-align:center;padding:4px;border-radius:4px;background:rgba(6,214,160,0.06);font-size:9px"><div style="color:var(--text-dim)">Optimiste</div><div style="font-family:var(--mono);color:var(--green);font-weight:600">+' + _fmt(optimiste) + '€</div></div>';
          html += '</div>';
          html += '<div style="font-size:8px;color:var(--text-dim);margin-top:2px;padding-left:4px">Coût opportunité si rendement nul + CAT monte à ' + catFutur.toFixed(1) + '% : -' + _fmt(coutOpportunite) + '€ sur ' + Math.round((a.durationMonths || 36) / 12) + ' ans (capital garanti)</div>';
        }

        // Warning concentration si min investment override le cap 30%
        var cap30 = Math.round(result.totalCash * 0.30 / 1000) * 1000;
        var pctOfCash = Math.round(a.amount / result.totalCash * 100);
        if (a.minInvestment && a.minInvestment > cap30 && a.amount >= a.minInvestment) {
          html += '<div style="background:rgba(255,182,39,0.08);border:1px solid rgba(255,182,39,0.2);border-radius:4px;padding:6px 8px;margin-top:4px;font-size:9px;color:var(--orange)">';
          html += '⚠️ <strong>Concentration ' + pctOfCash + '%</strong> — le minimum d\'investissement (' + _fmt(a.minInvestment) + '€) dépasse le cap 30% (' + _fmt(cap30) + '€). ';
          html += 'Accepté car capital garanti (risque contrepartie ' + (a.bankName || 'émetteur') + ' sur ' + Math.round(a.durationMonths / 12) + ' ans).';
          html += '</div>';
        } else if (a.amount >= result.totalCash * 0.29) {
          html += '<div style="font-size:9px;color:var(--text-dim);margin-top:2px;padding-left:4px">Limité à ' + _fmt(a.amount) + '€ (30% max par produit — diversification risque émetteur)</div>';
        }
      });
      html += '</div>';
    });

    // Unallocated cash — depends on source
    if (result.totalUnallocated > 0) {
      // If this entity's cash is ALL from structLiq (Swiss Life), can't go to CIC
      var isStructLiqOnly = result.isStructLiqOnly;

      if (isStructLiqOnly) {
        // Swiss Life money stays in Bond 12M
        html += '<div style="border:1px solid rgba(168,85,247,0.2);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;background:rgba(168,85,247,0.03)">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between">';
        html += '<div><div style="font-size:11px;font-weight:600;color:#A855F7">🔄 Garder en Bond 12M</div>';
        html += '<div style="font-size:9px;color:var(--text-dim)">Aucun produit Swiss Life ne bat le Bond 12M (~2.5%)</div></div>';
        html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + _fmt(result.totalUnallocated) + '€</div>';
        html += '<div style="font-family:var(--mono);font-size:10px;color:#A855F7">~2.5% → +' + _fmt(Math.round(result.totalUnallocated * 2.5 / 100)) + '€/an</div></div>';
        html += '</div></div>';
      } else {
        // Free cash → propose best CAT
        var catOffers = _getCATOffers(result.totalUnallocated);
        html += '<div style="border:1px solid rgba(255,182,39,0.2);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;background:rgba(255,182,39,0.03)">';
        var macro = _getMacroContext();
        var trendIcon = macro && macro.rateTrend === 'rising' ? '📈' : macro && macro.rateTrend === 'falling' ? '📉' : '➡️';
        var trendLabel = macro && macro.rateTrend === 'rising' ? 'Taux en hausse → court terme recommandé' : macro && macro.rateTrend === 'falling' ? 'Taux en baisse → verrouiller long terme' : 'Taux stables';

        if (catOffers.length > 0) {
          var best = catOffers[0];
          var annualReturn = Math.round(result.totalUnallocated * best.rate / 100);
          html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
          html += '<div><div style="font-size:11px;font-weight:600;color:var(--orange)">🏦 Placer en CAT</div>';
          html += '<div style="font-size:9px;color:var(--text-dim)">' + trendIcon + ' ' + trendLabel + '</div></div>';
          html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + _fmt(result.totalUnallocated) + '€</div>';
          html += '<div style="font-family:var(--mono);font-size:10px;color:var(--orange)">+' + _fmt(annualReturn) + '€/an</div></div>';
          html += '</div>';
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,182,39,0.06);border:1px solid rgba(255,182,39,0.15);border-radius:6px">';
          html += '<div><div style="font-size:12px;font-weight:600;color:var(--text-bright)">' + best.bankName + ' — ' + best.productName + '</div>';
          html += '<div style="font-size:10px;color:var(--text-dim)">' + best.durationMonths + ' mois</div></div>';
          html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;font-size:14px;color:var(--orange)">' + _fmt(result.totalUnallocated) + '€</div>';
          html += '<div style="font-family:var(--mono);font-size:11px;color:var(--orange)">' + best.rate.toFixed(2) + '% → +' + _fmt(annualReturn) + '€/an</div></div>';
          html += '</div>';
        } else {
          html += '<div style="display:flex;align-items:center;justify-content:space-between">';
          html += '<div><div style="font-size:11px;font-weight:600;color:var(--orange)">🏦 À placer en CAT</div>';
          html += '<div style="font-size:9px;color:var(--text-dim)">Aucune offre confirmée</div></div>';
          html += '<div style="font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + _fmt(result.totalUnallocated) + '€</div>';
          html += '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  function _renderResult(container, result) {
    var html = '<div class="section">';
    html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>💰 Allocation Optimisée</div>';
    html += '<button class="btn sm" onclick="_allocatorReset()">← Modifier</button></div>';

    // Avant → Après (combined)
    html += '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:0;margin-bottom:14px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">';
    html += '<div style="padding:14px;background:var(--bg-card)">';
    html += '<div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:8px">Tout en CAT</div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Total <span style="float:right;font-family:var(--mono);color:var(--text-bright)">' + _fmt(result.totalCash) + '€</span></div>';
    html += '<div style="font-size:11px;color:var(--text-muted)">Rdt/an <span style="float:right;font-family:var(--mono);color:var(--orange)">+' + _fmt(result.totalCatEquiv) + '€</span></div>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;padding:0 10px;background:var(--bg-card);font-size:22px;color:var(--accent)">→</div>';
    html += '<div style="padding:14px;background:var(--bg-card)">';
    html += '<div style="font-size:10px;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:8px">Optimisé (CAT + Structurés)</div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Structurés <span style="float:right;font-family:var(--mono);color:var(--cyan)">' + _fmt(result.totalAllocated) + '€</span></div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">En CAT <span style="float:right;font-family:var(--mono);color:var(--orange)">' + _fmt(result.totalUnallocated) + '€</span></div>';
    html += '<div style="font-size:11px;color:var(--text-muted)">Rdt total/an <span style="float:right;font-family:var(--mono);color:var(--green);font-weight:700">+' + _fmt(result.totalReturnAll) + '€</span>' +
      (result.excessVsCat > 0 ? ' <span style="font-size:9px;color:var(--green)">+' + _fmt(result.excessVsCat) + '</span>' : '') + '</div>';
    html += '</div></div>';

    // Per-entity results — side by side
    var entKeys = Object.keys(result.entities);
    if (entKeys.length > 1) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">';
      entKeys.forEach(function(entKey) {
        html += '<div>' + _renderEntityResult(entKey, result.entities[entKey]) + '</div>';
      });
      html += '</div>';
    } else {
      entKeys.forEach(function(entKey) {
        html += _renderEntityResult(entKey, result.entities[entKey]);
      });
    }

    // CAT maturity recommendations
    if (typeof _renderMaturityOptimizer === 'function') {
      html += _renderMaturityOptimizer();
    }

    // Issuer exposure + FGDR view
    html += _renderIssuerExposure(result);

    // Collect existing CAT returns for "avant" view
    var catExistingReturn = 0;
    var catExistingTotal = 0;
    try {
      if (typeof catManager !== 'undefined' && catManager.deposits) {
        catManager.deposits.forEach(function(d) {
          if (d.status !== 'active') return;
          var amt = parseFloat(d.amount) || 0;
          catExistingTotal += amt;
          catExistingReturn += Math.round(amt * (parseFloat(d.rate) || 0) / 100);
        });
      }
    } catch(e) {}

    // Portfolio structured returns
    var pfStructReturn = 0, pfStructTotal = 0, pfFundReturn = 0, pfFundTotal = 0;
    try {
      (app.state.portfolio || []).forEach(function(p) {
        var amt = parseFloat(p.investedAmount) || 0;
        if (p.grading && p.grading.grade === '-') {
          pfFundTotal += amt;
          pfFundReturn += Math.round(amt * 2.5 / 100);
        } else if (p.grading && p.grading.score) {
          pfStructTotal += amt;
          var coupon = (p.coupon && p.coupon.rate) || parseFloat(p.coupon) || 0;
          pfStructReturn += Math.round(amt * coupon / 100);
        }
      });
    } catch(e) {}

    var patrimoineTotal = catExistingTotal + pfStructTotal + pfFundTotal + _state.totalCash;
    var avantReturn = catExistingReturn + pfStructReturn + pfFundReturn;
    var apresReturn = avantReturn + result.totalReturn;
    var avantTaux = patrimoineTotal > 0 ? Math.round(avantReturn / patrimoineTotal * 10000) / 100 : 0;
    var apresTotalReturn = apresReturn;
    var apresToux = patrimoineTotal > 0 ? Math.round(apresTotalReturn / patrimoineTotal * 10000) / 100 : 0;

    // Combined summary — patrimoine view
    html += '<div style="border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden;margin-top:8px">';
    html += '<div style="padding:12px 16px;background:rgba(59,130,246,0.08);display:flex;justify-content:space-between;align-items:center">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--accent)">📊 Synthèse patrimoniale</span>';
    html += '<span style="font-size:11px;color:var(--text-dim)">Régime ' + result.regime + '</span></div>';

    // Tableau récap
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
    html += '<th style="padding:8px 12px;text-align:left;color:var(--text-muted)"></th>';
    html += '<th style="padding:8px;text-align:right;color:var(--text-muted)">Patrimoine</th>';
    html += '<th style="padding:8px;text-align:right;color:var(--text-muted)">Rdt/an avant</th>';
    html += '<th style="padding:8px;text-align:right;color:var(--text-muted)">Rdt/an après</th>';
    html += '<th style="padding:8px;text-align:right;color:var(--text-muted)">Diff</th>';
    html += '</tr></thead><tbody>';

    // Collect per entity
    var catByEntity = { bycam: { total: 0, rdt: 0 }, cameleons: { total: 0, rdt: 0 } };
    var pfByEntity = { bycam: { struct: 0, structRdt: 0, fund: 0, fundRdt: 0 }, cameleons: { struct: 0, structRdt: 0, fund: 0, fundRdt: 0 } };
    try {
      if (typeof catManager !== 'undefined' && catManager.deposits) {
        catManager.deposits.forEach(function(d) {
          if (d.status !== 'active') return;
          var ent = d.entity || 'cameleons';
          var amt = parseFloat(d.amount) || 0;
          if (catByEntity[ent]) { catByEntity[ent].total += amt; catByEntity[ent].rdt += Math.round(amt * (parseFloat(d.rate) || 0) / 100); }
        });
      }
    } catch(e) {}
    try {
      (app.state.portfolio || []).forEach(function(p) {
        var ent = p.entity || 'cameleons';
        var amt = parseFloat(p.investedAmount) || 0;
        if (!pfByEntity[ent]) return;
        if (p.grading && p.grading.grade === '-') {
          pfByEntity[ent].fund += amt;
          pfByEntity[ent].fundRdt += Math.round(amt * 2.5 / 100);
        } else if (p.grading && p.grading.score) {
          pfByEntity[ent].struct += amt;
          var c = (p.coupon && p.coupon.rate) || parseFloat(p.coupon) || 0;
          pfByEntity[ent].structRdt += Math.round(amt * c / 100);
        }
      });
    } catch(e) {}

    var _entRow = function(label, icon, ent, entResult) {
      var catT = catByEntity[ent].total, catR = catByEntity[ent].rdt;
      var stT = pfByEntity[ent].struct, stR = pfByEntity[ent].structRdt;
      var fuT = pfByEntity[ent].fund, fuR = pfByEntity[ent].fundRdt;

      // Fix double-counting: if maturing CAT are included in allocation,
      // subtract them from CAT existants (they're already in newAlloc + cash→CAT)
      var matCatIncluded = (_state.includeMaturingCat && _state.includeMaturingCat[ent]) ? (_state.entities[ent] ? _state.entities[ent].maturingCat : 0) : 0;
      if (matCatIncluded > 0) {
        // Remove maturing amount from CAT line (they're being reallocated)
        var matRate = 0;
        if (_state.entities[ent] && _state.entities[ent].maturingDetails.length > 0) {
          matRate = _state.entities[ent].maturingDetails[0].rate || 0;
        }
        catT -= matCatIncluded;
        catR -= Math.round(matCatIncluded * matRate / 100);
        if (catT < 0) catT = 0;
        if (catR < 0) catR = 0;
      }

      // Bond 12M (structLiq): always show in patrimoine as a separate line
      // If included via checkbox → it's being reallocated (part of newAlloc + cash)
      // If not included → stays as "Fonds" line
      var slAmount = _state.entities[ent] ? _state.entities[ent].structLiq : 0;
      var slIncluded = (_state.includeStructLiq && _state.includeStructLiq[ent]) ? slAmount : 0;
      if (slIncluded > 0) {
        // Remove from fund line (it's in the allocation now)
        fuT -= slIncluded;
        fuR -= Math.round(slIncluded * 2.5 / 100);
        if (fuT < 0) fuT = 0;
        if (fuR < 0) fuR = 0;
      }

      var newAlloc = entResult ? entResult.totalAllocated : 0;
      var newReturn = entResult ? entResult.totalReturn : 0;
      var cashA = entResult ? (entResult.totalCash - entResult.totalAllocated) : 0;
      // Cash return: use best CAT rate, not the difference (which can be 0 if no tranche)
      var bestRate = entResult ? (entResult.bestCatRate || 2.8) : 2.8;
      var cashR = cashA > 0 ? Math.round(cashA * bestRate / 100) : 0;
      var totalBefore = catR + stR + fuR;
      var isWaitingCalc = !entResult || (entResult.totalAllocated === 0 && newAlloc === 0);
      var totalAfter = totalBefore + newReturn + (isWaitingCalc ? 0 : cashR);
      var totalPat = catT + stT + fuT + (entResult ? entResult.totalCash : 0);
      var h = '';
      h += '<tr style="border-bottom:2px solid var(--accent);background:var(--bg-elevated)">';
      h += '<td colspan="5" style="padding:8px 12px;font-weight:700;color:var(--text-bright);font-size:12px">' + icon + ' ' + label + '</td></tr>';
      if (catT > 0) {
        h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 12px 4px 24px;color:var(--text-muted);font-size:10px">🏦 CAT</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px">' + _fmt(catT) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(catR) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(catR) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text-dim)">—</td></tr>';
      }
      if (stT > 0) {
        h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 12px 4px 24px;color:var(--text-muted);font-size:10px">📦 Structurés (pf)</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px">' + _fmt(stT) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(stR) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(stR) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text-dim)">—</td></tr>';
      }
      if (fuT > 0) {
        h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 12px 4px 24px;color:var(--text-muted);font-size:10px">🔄 Fonds</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px">' + _fmt(fuT) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(fuR) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(fuR) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text-dim)">—</td></tr>';
      }
      // Bond 12M line (always show if entity has structLiq)
      if (slAmount > 0) {
        var slLabel = slIncluded > 0 ? '🔄 Bond 12M SL (réalloué)' : '🔄 Bond 12M SL';
        var slRdt = Math.round(slAmount * 2.5 / 100);
        h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 12px 4px 24px;color:#A855F7;font-size:10px">' + slLabel + '</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px">' + _fmt(slAmount) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(slRdt) + '€</td>';
        if (slIncluded > 0) {
          h += '<td style="padding:4px 8px;text-align:right;font-size:10px;color:#A855F7">→ réalloué</td>';
          h += '<td style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text-dim)">—</td>';
        } else {
          h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">+' + _fmt(slRdt) + '€</td>';
          h += '<td style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text-dim)">—</td>';
        }
        h += '</tr>';
      }

      if (newAlloc > 0) {
        h += '<tr style="border-bottom:1px solid var(--border);background:rgba(6,214,160,0.04)"><td style="padding:4px 12px 4px 24px;color:var(--green);font-weight:600;font-size:10px">⚡ Nouvelles alloc</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--cyan);font-weight:600">' + _fmt(newAlloc) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">0€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--green);font-weight:600">+' + _fmt(newReturn) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--green);font-weight:600">+' + _fmt(newReturn) + '€</td></tr>';
      }
      if (cashA > 0) {
        // If no allocation at all for this entity → cash is "en attente", not "→ CAT"
        var isWaiting = !entResult || (entResult.totalAllocated === 0 && newAlloc === 0);
        var cashLabel = isWaiting ? '💰 Cash disponible' : '🏦 Cash → CAT';
        var cashColor = isWaiting ? 'var(--cyan)' : 'var(--orange)';
        var cashReturnDisplay = isWaiting ? 0 : cashR; // waiting = 0 return (not placed yet)
        h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 12px 4px 24px;color:' + cashColor + ';font-size:10px">' + cashLabel + '</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px">' + _fmt(cashA) + '€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-size:10px;color:var(--text-dim)">0€</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:' + cashColor + '">' + (cashReturnDisplay > 0 ? '+' + _fmt(cashReturnDisplay) + '€' : 'en attente') + '</td>';
        h += '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:' + cashColor + '">' + (cashReturnDisplay > 0 ? '+' + _fmt(cashReturnDisplay) + '€' : '—') + '</td></tr>';
      }
      // Sub-total for this entity
      h += '<tr style="border-bottom:2px solid var(--border);background:rgba(59,130,246,0.03)">';
      h += '<td style="padding:6px 12px 6px 24px;font-weight:700;color:var(--text-bright);font-size:10px">Sous-total ' + label + '</td>';
      h += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-size:10px;font-weight:700">' + _fmt(totalPat) + '€</td>';
      h += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-size:10px;font-weight:600;color:var(--text-muted)">+' + _fmt(totalBefore) + '€</td>';
      h += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--green)">+' + _fmt(totalAfter) + '€</td>';
      h += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-size:10px;font-weight:700;color:' + (totalAfter - totalBefore > 0 ? 'var(--green)' : 'var(--text-dim)') + '">' + (totalAfter - totalBefore > 0 ? '+' : '') + _fmt(totalAfter - totalBefore) + '€</td></tr>';
      return h;
    };

    // ByCam
    html += _entRow('ByCam', '🏢', 'bycam', result.entities.bycam || null);
    // Caméléons
    html += _entRow('Caméléons', '🦎', 'cameleons', result.entities.cameleons || null);

    // Total
    html += '<tr style="border-top:2px solid var(--accent);background:var(--bg-elevated)">';
    html += '<td style="padding:10px 12px;font-weight:800;color:var(--text-bright);font-size:12px">TOTAL PATRIMOINE</td>';
    html += '<td style="padding:10px 8px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--text-bright)">' + _fmt(patrimoineTotal) + '€</td>';
    html += '<td style="padding:10px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--text-muted)">+' + _fmt(avantReturn) + '€</td>';
    html += '<td style="padding:10px 8px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--green)">+' + _fmt(apresTotalReturn) + '€</td>';
    var totalNewReturn = result.totalReturnAll || (result.totalReturn + (result.unallocatedReturn || 0));
    html += '<td style="padding:10px 8px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--green)">+' + _fmt(totalNewReturn) + '€</td></tr>';

    // Taux row
    html += '<tr style="background:var(--bg-elevated)">';
    html += '<td style="padding:6px 12px;color:var(--text-dim);font-size:10px">Taux moyen patrimoine</td>';
    html += '<td></td>';
    html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--text-dim)">' + avantTaux.toFixed(2) + '%</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--green)">' + apresToux.toFixed(2) + '%</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--green)">+' + (apresToux - avantTaux).toFixed(2) + '%</td></tr>';

    html += '</tbody></table>';

    // Capital garanti badge
    html += '<div style="padding:8px 16px;background:rgba(6,214,160,0.06);text-align:center;font-size:11px;color:var(--green);font-weight:600">🛡️ Capital garanti 100% sur toutes les nouvelles allocations</div>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ ACTIONS ═══════════════════════════════════════════

  window._allocatorToggleMatCat = function(entKey) {
    if (!_state.includeMaturingCat) _state.includeMaturingCat = {};
    _state.includeMaturingCat[entKey] = !_state.includeMaturingCat[entKey];
    _state.result = null;
    renderUnifiedAllocator(document.getElementById('main-content'));
  };

  window._allocatorToggleSL = function(entKey) {
    if (!_state.includeStructLiq) _state.includeStructLiq = {};
    _state.includeStructLiq[entKey] = !_state.includeStructLiq[entKey];
    // If checked, add structLiq to entity total so it can be allocated
    _state.result = null; // reset result
    renderUnifiedAllocator(document.getElementById('main-content'));
  };

  window._allocatorSetMode = function(mode) {
    _state.mode = mode;
    renderUnifiedAllocator(document.getElementById('main-content'));
  };

  window._allocatorUpdateRemaining = function() {
    ['bycam', 'cameleons'].forEach(function(entKey) {
      var total = _state.entities[entKey] ? _state.entities[entKey].total : 0;
      var used = 0;
      HORIZONS.forEach(function(h) {
        var el = document.getElementById('alloc-' + entKey + '-' + h.id);
        if (el) used += parseFloat(el.value) || 0;
      });
      var libreEl = document.getElementById('alloc-' + entKey + '-libre');
      if (libreEl) used += parseFloat(libreEl.value) || 0;
      var remaining = total - used;
      var el = document.getElementById('alloc-remaining-' + entKey);
      if (el) {
        el.innerHTML = remaining >= 0
          ? '<span style="color:var(--green)">Reste : ' + _fmt(remaining) + '€</span>'
          : '<span style="color:var(--red)">⚠️ Dépassement ' + _fmt(-remaining) + '€</span>';
      }
    });
  };

  window._allocatorReset = function() {
    _state.result = null;
    renderUnifiedAllocator(document.getElementById('main-content'));
  };

  window._allocatorRun = function() {
    var regime = _getRegime();
    var profile = REGIME_PROFILES[regime] || REGIME_PROFILES.neutral;
    var allResults = { entities: {}, totalCash: _state.totalCash };

    ['bycam', 'cameleons'].forEach(function(entKey) {
      var ent = _state.entities[entKey];
      if (!ent || ent.total <= 0) return;
      var tranches = [];

      if (_state.mode === 'manual') {
        HORIZONS.forEach(function(h) {
          var el = document.getElementById('alloc-' + entKey + '-' + h.id);
          tranches.push({ horizon: h, amount: el ? (parseFloat(el.value) || 0) : 0 });
        });
        var libreAmt = parseFloat((document.getElementById('alloc-' + entKey + '-libre') || {}).value) || 0;
        if (libreAmt > 0) {
          var lbl = (document.getElementById('alloc-' + entKey + '-libre-label') || {}).value || 'Libre';
          var lmo = parseInt((document.getElementById('alloc-' + entKey + '-libre-months') || {}).value) || 24;
          tranches.push({ horizon: { id: 'libre', label: lbl, sublabel: lmo + ' mois', icon: '📌', maxMonths: lmo, color: '#9382F6' }, amount: libreAmt });
        }
      } else {
        var immPct = Math.max(0, 1.0 - profile.court - profile.moyen - profile.long);
        [immPct, profile.court, profile.moyen, profile.long].forEach(function(pct, i) {
          tranches.push({ horizon: HORIZONS[i], amount: Math.round(ent.total * pct / 1000) * 1000 });
        });
      }

      allResults.entities[entKey] = _allocate(tranches, ent.total, entKey);
      allResults.entities[entKey].entityLabel = ent.label;
    });

    // Compute combined totals
    var totalReturn = 0, totalAllocated = 0, totalCatEquiv = 0;
    Object.values(allResults.entities).forEach(function(r) {
      totalReturn += r.totalReturn;
      totalAllocated += r.totalAllocated;
      totalCatEquiv += r.catEquivReturn;
    });
    // Include unallocated cash earning CAT rate in total return
    var totalUnallocated = _state.totalCash - totalAllocated;
    var bestCat = 2.5;
    Object.values(allResults.entities).forEach(function(r) { if (r.bestCatRate > bestCat) bestCat = r.bestCatRate; });
    var unallocatedReturn = Math.round(totalUnallocated * bestCat / 100);
    var totalReturnAll = totalReturn + unallocatedReturn;

    allResults.totalReturn = totalReturn; // structured only
    allResults.totalReturnAll = totalReturnAll; // structured + CAT on unallocated
    allResults.totalAllocated = totalAllocated;
    allResults.totalUnallocated = totalUnallocated;
    allResults.unallocatedReturn = unallocatedReturn;
    allResults.totalCatEquiv = totalCatEquiv;
    allResults.excessVsCat = totalReturnAll - totalCatEquiv;
    allResults.bestCatRate = bestCat;
    // Weighted rate on TOTAL cash (not just allocated)
    allResults.weightedRate = _state.totalCash > 0 ? Math.round(totalReturnAll / _state.totalCash * 10000) / 100 : 0;
    allResults.regime = regime;

    _state.result = allResults;
    _renderResult(document.getElementById('main-content'), allResults);
  };

  // ═══ ISSUER EXPOSURE + FGDR ═════════════════════════════
  function _renderIssuerExposure(result) {
    var issuers = {};

    // Normalize bank names to avoid duplicates (cic vs CIC)
    var _normBank = function(b) {
      var map = {
        'sg': 'Société Générale', 'societe generale': 'Société Générale', 'société générale': 'Société Générale',
        'cic': 'CIC', 'swiss-life': 'Swiss Life', 'swisslife': 'Swiss Life',
        'bnp': 'BNP Paribas', 'bnpp': 'BNP Paribas',
        'banque populaire': 'Banque Populaire', 'bp': 'Banque Populaire'
      };
      var lower = (b || 'Inconnu').toLowerCase().trim();
      return map[lower] || b || 'Inconnu';
    };

    // 1. Collect from CAT deposits
    try {
      if (typeof catManager !== 'undefined' && catManager.deposits) {
        catManager.deposits.forEach(function(d) {
          if (d.status !== 'active') return;
          var bank = _normBank(d.bankName);
          if (!issuers[bank]) issuers[bank] = { cat: 0, structured: 0, fund: 0, total: 0 };
          issuers[bank].cat += parseFloat(d.amount) || 0;
        });
      }
    } catch(e) {}

    // 2. Collect from portfolio (structured products + funds)
    try {
      (app.state.portfolio || []).forEach(function(p) {
        var bank = _normBank(p.bankId);
        if (p.grading && p.grading.grade === '-') {
          if (!issuers[bank]) issuers[bank] = { cat: 0, structured: 0, fund: 0, total: 0 };
          issuers[bank].fund += parseFloat(p.investedAmount) || 0;
        } else if (p.grading) {
          if (!issuers[bank]) issuers[bank] = { cat: 0, structured: 0, fund: 0, total: 0 };
          issuers[bank].structured += parseFloat(p.investedAmount) || 0;
        }
      });
    } catch(e) {}

    // 3. Add proposed allocations from result
    Object.values(result.entities || {}).forEach(function(entResult) {
      (entResult.tranches || []).forEach(function(tr) {
        (tr.allocations || []).forEach(function(a) {
          if (a.type === 'structured') {
            var bank = _normBank(a.bankName);
            if (!issuers[bank]) issuers[bank] = { cat: 0, structured: 0, fund: 0, total: 0 };
            issuers[bank].structured += a.amount;
          }
        });
      });
    });

    // Calculate totals
    var grandTotal = 0;
    Object.keys(issuers).forEach(function(bank) {
      issuers[bank].total = issuers[bank].cat + issuers[bank].structured + issuers[bank].fund;
      issuers[bank].fgdr = Math.min(100000, issuers[bank].cat); // FGDR covers CAT only, max 100K
      issuers[bank].exposed = issuers[bank].total - issuers[bank].fgdr;
      grandTotal += issuers[bank].total;
    });

    // Sort by total descending
    var sorted = Object.keys(issuers).sort(function(a, b) { return issuers[b].total - issuers[a].total; });

    // Render
    var html = '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:14px">';
    html += '<div style="padding:10px 14px;background:var(--bg-elevated);display:flex;justify-content:space-between;align-items:center">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--text-bright)">🏛️ Exposition émetteur + FGDR</span>';
    html += '<span style="font-size:10px;color:var(--text-dim)">Plafond FGDR : 100 000€/banque (CAT uniquement)</span>';
    html += '</div>';

    // Table header
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
    html += '<th style="padding:6px 12px;text-align:left;color:var(--text-muted);font-weight:500">Émetteur</th>';
    html += '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-weight:500">CAT</th>';
    html += '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-weight:500">Structurés</th>';
    html += '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-weight:500">Fonds</th>';
    html += '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-weight:500">Total</th>';
    html += '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-weight:500">FGDR</th>';
    html += '<th style="padding:6px 8px;text-align:right;color:var(--text-muted);font-weight:500">Exposé</th>';
    html += '<th style="padding:6px 8px;text-align:center;color:var(--text-muted);font-weight:500">% patrimoine</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function(bank) {
      var d = issuers[bank];
      var pct = grandTotal > 0 ? Math.round(d.total / grandTotal * 100) : 0;
      var isWarning = pct > 30 || d.exposed > 500000;
      var rowBg = isWarning ? 'rgba(255,182,39,0.04)' : '';

      html += '<tr style="border-bottom:1px solid var(--border);background:' + rowBg + '">';
      html += '<td style="padding:6px 12px;font-weight:600;color:var(--text-bright)">' + bank + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:var(--text-muted)">' + (d.cat > 0 ? _fmt(d.cat) + '€' : '—') + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:var(--cyan)">' + (d.structured > 0 ? _fmt(d.structured) + '€' : '—') + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:var(--text-muted)">' + (d.fund > 0 ? _fmt(d.fund) + '€' : '—') + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + _fmt(d.total) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:var(--green)">' + (d.fgdr > 0 ? _fmt(d.fgdr) + '€' : '—') + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:' + (d.exposed > 200000 ? 'var(--red)' : 'var(--orange)') + '">' + _fmt(d.exposed) + '€</td>';
      html += '<td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;' +
        (isWarning ? 'background:rgba(255,182,39,0.12);color:var(--orange)' : 'background:rgba(6,214,160,0.12);color:var(--green)') + '">' + pct + '%' + (isWarning ? ' ⚠️' : '') + '</span></td>';
      html += '</tr>';
    });

    // Total row
    var totalFgdr = sorted.reduce(function(s, b) { return s + issuers[b].fgdr; }, 0);
    var totalExposed = sorted.reduce(function(s, b) { return s + issuers[b].exposed; }, 0);
    html += '<tr style="border-top:2px solid var(--accent);background:var(--bg-elevated)">';
    html += '<td style="padding:8px 12px;font-weight:800;color:var(--text-bright)">TOTAL</td>';
    html += '<td colspan="3"></td>';
    html += '<td style="padding:8px 8px;text-align:right;font-family:var(--mono);font-weight:800;color:var(--text-bright)">' + _fmt(grandTotal) + '€</td>';
    html += '<td style="padding:8px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">' + _fmt(totalFgdr) + '€</td>';
    html += '<td style="padding:8px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--red)">' + _fmt(totalExposed) + '€</td>';
    html += '<td style="padding:8px 8px;text-align:center;font-size:10px;color:var(--text-dim)">' + Math.round(totalFgdr / grandTotal * 100) + '% couvert</td>';
    html += '</tr></tbody></table>';

    // Actionable warnings
    var warnings = [];
    sorted.forEach(function(bank) {
      var d = issuers[bank];
      var pct = grandTotal > 0 ? Math.round(d.total / grandTotal * 100) : 0;
      if (d.cat > 100000) {
        var nbBanques = Math.ceil(d.cat / 100000);
        warnings.push('⚠️ <strong>' + bank + '</strong> : ' + _fmt(d.cat) + '€ en CAT → splitter sur ' + nbBanques + ' banques (FGDR 100K€/banque)');
      }
      if (d.structured > 0) {
        warnings.push('🏛️ <strong>' + bank + '</strong> : ' + _fmt(d.structured) + '€ en structurés — <strong>non couvert FGDR</strong> (risque crédit ' + bank + ')');
      }
      if (pct > 40) {
        warnings.push('📊 <strong>' + bank + '</strong> : ' + pct + '% du patrimoine — diversifier à la prochaine échéance');
      }
    });
    if (warnings.length > 0) {
      html += '<div style="padding:8px 12px;background:rgba(255,182,39,0.04);border-top:1px solid var(--border);font-size:10px">';
      warnings.forEach(function(w) { html += '<div style="padding:2px 0;color:var(--text-muted)">' + w + '</div>'; });
      html += '</div>';
    }
    html += '</div>';

    return html;
  }

  // ═══ MAIN RENDER ═══════════════════════════════════════
  window.renderUnifiedAllocator = async function(container) {
    // Ensure catManager + macro data is loaded
    try {
      container.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Chargement des données...</div>';
      if (typeof catManager !== 'undefined' && typeof catManager.load === 'function' && !catManager.objectives) {
        await catManager.load();
      }
      if (typeof _loadCATMacroData === 'function') {
        await _loadCATMacroData();
      }
    } catch(e) { console.warn('[Allocator] Load failed:', e.message); }

    _state.entities = _computeEntities();
    _state.totalCash = _state.entities.bycam.cash + _state.entities.cameleons.cash;
    if (_state.result) {
      _renderResult(container, _state.result);
    } else {
      _renderQuestionnaire(container, _state.totalCash);
    }
  };

  console.log('[StructBoard] Unified Allocator v1.0 loaded');
})();

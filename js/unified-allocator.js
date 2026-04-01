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
    entities: {},       // { bycam: { cash, deposits, structLiq }, cameleons: { ... } }
    includeStructLiq: {} // { cameleons: true/false }
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
      bycam: { cash: 0, structLiq: 0, label: '🏢 ByCam' },
      cameleons: { cash: 0, structLiq: 0, label: '🦎 Caméléons' }
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

    // total = cash libre + structLiq if user opted in for arbitrage
    entities.bycam.total = entities.bycam.cash + ((_state.includeStructLiq && _state.includeStructLiq.bycam) ? entities.bycam.structLiq : 0);
    entities.cameleons.total = entities.cameleons.cash + ((_state.includeStructLiq && _state.includeStructLiq.cameleons) ? entities.cameleons.structLiq : 0);

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
    // If entity includes structLiq, only Swiss Life products are eligible for that portion
    var hasStructLiq = _state.includeStructLiq && _state.includeStructLiq[entityKey];
    if (hasStructLiq) {
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
      regime: _getRegime()
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
        html += '<div style="font-size:10px;color:var(--text-dim)">' + typeLabel + ' · ' + a.bankName + (a.capitalGaranti ? ' · 🛡️' : '') + ' · ' + a.durationMonths + 'M</div>';
        html += '</div>';
        html += '<div style="text-align:right;white-space:nowrap">';
        html += '<div style="font-family:var(--mono);font-weight:700;color:var(--cyan);font-size:12px">' + _fmt(a.amount) + '€</div>';
        html += '<div style="font-family:var(--mono);font-size:10px;color:var(--green)">' + a.rate.toFixed(1) + '% → +' + _fmt(a.annualReturn) + '€/an</div>';
        html += '</div></div>';

        // Fourchette de rendement (pessimiste / médian / optimiste)
        if (a.type === 'structured' && a.rate > 0) {
          var optimiste = Math.round(a.amount * a.rate * 1.5 / 100);
          var median = a.annualReturn;
          var pessimiste = Math.round(a.amount * a.rate * 0.2 / 100);
          html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:4px">';
          html += '<div style="text-align:center;padding:4px;border-radius:4px;background:rgba(239,35,60,0.06);font-size:9px"><div style="color:var(--text-dim)">Pessimiste</div><div style="font-family:var(--mono);color:var(--red);font-weight:600">+' + _fmt(pessimiste) + '€</div></div>';
          html += '<div style="text-align:center;padding:4px;border-radius:4px;background:rgba(78,205,196,0.06);font-size:9px"><div style="color:var(--text-dim)">Médian (BS)</div><div style="font-family:var(--mono);color:var(--cyan);font-weight:600">+' + _fmt(median) + '€</div></div>';
          html += '<div style="text-align:center;padding:4px;border-radius:4px;background:rgba(6,214,160,0.06);font-size:9px"><div style="color:var(--text-dim)">Optimiste</div><div style="font-family:var(--mono);color:var(--green);font-weight:600">+' + _fmt(optimiste) + '€</div></div>';
          html += '</div>';
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

    // Unallocated = propose best available CAT from user's rates
    if (result.totalUnallocated > 0) {
      var catOffers = _getCATOffers(result.totalUnallocated);
      html += '<div style="border:1px solid rgba(255,182,39,0.2);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;background:rgba(255,182,39,0.03)">';
      var macro = _getMacroContext();
      var trendIcon = macro && macro.rateTrend === 'rising' ? '📈' : macro && macro.rateTrend === 'falling' ? '📉' : '➡️';
      var trendLabel = macro && macro.rateTrend === 'rising' ? 'Taux en hausse → court terme recommandé' : macro && macro.rateTrend === 'falling' ? 'Taux en baisse → verrouiller long terme' : 'Taux stables';

      if (catOffers.length > 0) {
        var best = catOffers[0]; // already sorted by rate (adjusted for trend)
        var annualReturn = Math.round(result.totalUnallocated * best.rate / 100);
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
        html += '<div><div style="font-size:11px;font-weight:600;color:var(--orange)">🏦 Placer en CAT</div>';
        html += '<div style="font-size:9px;color:var(--text-dim)">' + trendIcon + ' ' + trendLabel + '</div></div>';
        html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + _fmt(result.totalUnallocated) + '€</div>';
        html += '<div style="font-family:var(--mono);font-size:10px;color:var(--orange)">+' + _fmt(annualReturn) + '€/an</div></div>';
        html += '</div>';
        // Single recommendation card
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,182,39,0.06);border:1px solid rgba(255,182,39,0.15);border-radius:6px">';
        html += '<div><div style="font-size:12px;font-weight:600;color:var(--text-bright)">' + best.bankName + ' — ' + best.productName + '</div>';
        html += '<div style="font-size:10px;color:var(--text-dim)">' + best.durationMonths + ' mois</div></div>';
        html += '<div style="text-align:right"><div style="font-family:var(--mono);font-weight:700;font-size:14px;color:var(--orange)">' + _fmt(result.totalUnallocated) + '€</div>';
        html += '<div style="font-family:var(--mono);font-size:11px;color:var(--orange)">' + best.rate.toFixed(2) + '% → +' + _fmt(annualReturn) + '€/an</div></div>';
        html += '</div>';
      } else {
        html += '<div style="display:flex;align-items:center;justify-content:space-between">';
        html += '<div><div style="font-size:11px;font-weight:600;color:var(--orange)">🏦 À placer en CAT</div>';
        html += '<div style="font-size:9px;color:var(--text-dim)">Aucune offre confirmée disponible</div></div>';
        html += '<div style="font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + _fmt(result.totalUnallocated) + '€</div>';
        html += '</div>';
      }
      html += '</div>';
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

    // Per-entity results
    Object.keys(result.entities).forEach(function(entKey) {
      html += _renderEntityResult(entKey, result.entities[entKey]);
    });

    // Combined summary
    html += '<div style="border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden;margin-top:8px">';
    html += '<div style="padding:12px 16px;background:rgba(59,130,246,0.08);display:flex;justify-content:space-between;align-items:center">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--accent)">📊 Synthèse combinée</span>';
    html += '<span style="font-size:11px;color:var(--text-dim)">Régime ' + result.regime + '</span></div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border)">';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement/an</div><div style="font-size:18px;font-weight:800;color:var(--green);font-family:var(--mono)">+' + _fmt(result.totalReturnAll) + '€</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Taux moyen</div><div style="font-size:18px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + result.weightedRate.toFixed(1) + '%</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">vs tout CAT</div><div style="font-size:18px;font-weight:800;color:' + (result.excessVsCat >= 0 ? 'var(--green)' : 'var(--red)') + ';font-family:var(--mono)">' + (result.excessVsCat >= 0 ? '+' : '') + _fmt(result.excessVsCat) + '€</div></div>';
    html += '<div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Capital garanti</div><div style="font-size:18px;font-weight:800;color:var(--green);font-family:var(--mono)">🛡️ 100%</div></div>';
    html += '</div></div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ ACTIONS ═══════════════════════════════════════════

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

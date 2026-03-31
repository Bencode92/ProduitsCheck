// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v5 BS Risk Patch v1.1
//
// Loaded AFTER optimizer-v4-patch.js (outermost optimizer layer)
// v1.1: Fix v4 detection (removed toString check, use runtime flag)
//
// Chantier 1: BS rendementNet replaces facial coupon
//   - annualReturn = allocatedAmount × rendementNet (not facial coupon)
//   - BS gate: PASSER if rendementNet < 0, ATTENDRE if < CAT
//
// Chantier 2: Vol-adjusted position sizing
//   - Inverse-vol: low vol → larger position
//   - Correlation limits: underlying overlap > 50% → -25%
//   - Portfolio risk metrics: vol, Sharpe, drawdown, diversification
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Data access ───────────────────────────────────────

  function _findProposal(id) {
    var found = null;
    try {
      Object.values(app.state.proposals || {}).forEach(function(arr) {
        arr.forEach(function(p) { if (p.id === id) found = p; });
      });
    } catch(e) {}
    return found;
  }

  function _getBSData(proposal) {
    if (!proposal) return null;
    var meta = (proposal.grading && proposal.grading.metadata) || {};
    var rdtNet = proposal._bsRendementNet;
    if (rdtNet === undefined || rdtNet === null) rdtNet = meta.bsRendementNet;
    // Fallback for guaranteed-rate products (rates-patch sets _ratesRendementNet)
    if (rdtNet === undefined || rdtNet === null) rdtNet = proposal._ratesRendementNet;
    if (rdtNet === undefined || rdtNet === null) return null;
    return {
      rendementNet: rdtNet,
      probCoupon: proposal._couponProbability || meta.bsProbCoupon || meta.couponProbability || 70,
      vols: meta.bsVols || null,
      perteEsperee: meta.bsPerteEsperee || 0,
      matEsperee: meta.bsMatEsperee || 5,
      isBasket: meta.isBasket || false
    };
  }

  function _getProductVol(bs) {
    if (!bs || !bs.vols || bs.vols.length === 0) return 25;
    if (bs.vols.length === 1) return bs.vols[0];
    var sum = 0;
    bs.vols.forEach(function(v) { sum += v; });
    return sum / bs.vols.length;
  }

  function _getUnderlyings(proposal) {
    if (!proposal) return [];
    var unds = proposal.underlyings || (proposal.aiParsed && proposal.aiParsed.underlyings) || [];
    return unds.map(function(u) {
      return (typeof u === 'string' ? u : (u.name || u.ticker || '')).toUpperCase();
    }).filter(Boolean);
  }

  // ─── Risk math ─────────────────────────────────────────

  function _overlap(u1, u2) {
    if (u1.length === 0 || u2.length === 0) return 0;
    var shared = 0;
    u1.forEach(function(a) { if (u2.indexOf(a) >= 0) shared++; });
    return shared / Math.min(u1.length, u2.length);
  }

  function _portfolioVol(pos) {
    var n = pos.length;
    if (n === 0) return 0;
    if (n === 1) return pos[0].vol * pos[0].w;
    var sv = 0, sc = 0;
    for (var i = 0; i < n; i++) {
      var wi = pos[i].w, vi = pos[i].vol / 100;
      sv += wi * wi * vi * vi;
      for (var j = i + 1; j < n; j++) {
        var wj = pos[j].w, vj = pos[j].vol / 100;
        var corr = pos[i]._c[j] || 0.3;
        sc += 2 * corr * wi * wj * vi * vj;
      }
    }
    return Math.sqrt(sv + sc) * 100;
  }

  function _cashRes(regime) {
    return { crisis: 0.25, recession: 0.20, stagflation: 0.15 }[regime] || 0.10;
  }

  // ─── Proactive recommendations engine ─────────────────
  function _buildRecommendations(regime, catRate, cashPct, actionCount) {
    var recos = [];
    var r = (regime || 'neutral').toLowerCase();
    var mi = null;
    try {
      // MI data may be cached by grader-mi-patch or grader-rates-patch
      if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._mi) mi = _mktCache._mi;
    } catch(e) {}

    var avoided = '';
    var bondStrat = null;
    var maxDur = 5;
    try {
      if (mi) {
        avoided = (mi.avoided_sectors || '').toLowerCase();
      }
      // Try loading full MI for bond strategy
      if (typeof github !== 'undefined' && github.readFile) {
        // Don't block — use cached data if available
      }
    } catch(e) {}

    // ─── Regime-specific recommendations ───
    if (r === 'stagflation' || r === 'recession') {
      recos.push({
        icon: '\ud83d\udee1\ufe0f',
        type: 'Taux fixe callable',
        criteria: 'Coupon garanti \u2265 4.5%, \u00e9metteur IG (A- min), maturit\u00e9 \u2264 10 ans',
        why: 'Coupon garanti insensible au march\u00e9. En ' + r + ', faible probabilit\u00e9 de rappel \u2192 lock-in du coupon.'
      });
      recos.push({
        icon: '\ud83c\udfaf',
        type: 'Dispersion capital garanti',
        criteria: 'Capital 100% garanti, maturit\u00e9 \u2264 3 ans, sous-jacents \u2265 6 actions',
        why: 'La volatilit\u00e9 haute en ' + r + ' est un atout (plus de dispersion). Z\u00e9ro risque capital.'
      });
      recos.push({
        icon: '\ud83d\udcb0',
        type: 'Capital garanti digitale',
        criteria: 'Capital 100% garanti, coupon conditionnel, trigger \u2264 90%, maturit\u00e9 \u2264 3 ans',
        why: 'Rendement conditionnel mais capital prot\u00e9g\u00e9. Pr\u00e9f\u00e9rer trigger bas et courte dur\u00e9e.'
      });
    }

    if (r === 'stagflation') {
      recos.push({
        icon: '\u26a0\ufe0f',
        type: '\u00c9viter',
        criteria: 'Autocall single-stock' + (avoided ? ', secteurs : ' + avoided : '') + ', maturit\u00e9 > 6 ans, d\u00e9cr\u00e9ment > 3%',
        why: 'March\u00e9 stagnant \u2192 autocall non rappel\u00e9 \u2192 capital bloqu\u00e9 longtemps. D\u00e9cr\u00e9ment mange le coupon.'
      });
    } else if (r === 'bull' || r === 'risk-on' || r === 'expansion') {
      recos.push({
        icon: '\ud83d\ude80',
        type: 'Autocall / Phoenix sur indices',
        criteria: 'Sous-jacent indice large (SX5E, CAC 40), coupon \u2265 7%, barri\u00e8re \u2264 60%',
        why: 'March\u00e9 haussier \u2192 forte prob de rappel anticip\u00e9. Privil\u00e9gier indices diversifi\u00e9s.'
      });
      recos.push({
        icon: '\ud83c\udfaf',
        type: 'Phoenix m\u00e9moire single-stock',
        criteria: 'Action quality (Buffett > 60), vol < 30%, coupon \u2265 8%, m\u00e9moire',
        why: 'En bull, m\u00eame une action volatile reste au-dessus du trigger. La m\u00e9moire accumule.'
      });
    } else if (r === 'neutral') {
      recos.push({
        icon: '\u2696\ufe0f',
        type: 'Basket autocall diversifi\u00e9',
        criteria: 'Panier \u2265 4 sous-jacents, secteurs mixtes, coupon \u2265 6%, barri\u00e8re \u2264 55%',
        why: 'Diversification du panier r\u00e9duit le risque worst-of. Pr\u00e9f\u00e9rer barri\u00e8re basse.'
      });
    }

    // ─── Cash guidance ───
    if (cashPct >= 50) {
      recos.push({
        icon: '\ud83d\udcb5',
        type: 'Cash \u2192 CAT / Bond 12M',
        criteria: 'Garder ' + cashPct + '% en CAT (' + catRate.toFixed(1) + '%) ou Bond 12M',
        why: actionCount === 0
          ? 'Aucune proposition ne justifie le risque. Le cash est la meilleure position.'
          : 'Qualit\u00e9 insuffisante des propositions restantes. Attendre de meilleures offres.'
      });
    }

    // ─── Duration guidance from bond strategy ───
    if (r === 'stagflation' || r === 'recession') {
      recos.push({
        icon: '\u23f3',
        type: 'Duration courte',
        criteria: 'Privil\u00e9gier maturit\u00e9 \u2264 4 ans, \u00e9viter > 7 ans',
        why: 'Risque de hausse de taux \u2192 duration longue = capital bloqu\u00e9 \u00e0 rendement insuffisant.'
      });
    }

    return recos;
  }

  function _detectSector(unds) {
    if (!unds || unds.length === 0) return 'autre';
    var joined = unds.join(' ').toLowerCase();
    if (/bank|bnp|sg |credit|intesa|santander|unicredit|hsbc|barclays|goldman|jpmorgan/i.test(joined)) return 'finance';
    if (/tech|asml|apple|nvidia|microsoft|meta|alphabet|tesla|amazon|netflix|sap|siemens energy/i.test(joined)) return 'tech';
    if (/lvmh|hermes|kering|richemont/i.test(joined)) return 'luxe';
    if (/total|eni|shell|bp |brent/i.test(joined)) return 'energie';
    if (/gold|gdx|silver|xau/i.test(joined)) return 'commodities';
    if (/euro stoxx|cac|eurostoxx|sx5e|dax|stoxx 600/i.test(joined)) return 'indice-eu';
    return 'autre';
  }

  function _mc(label, value, color, sub) {
    return '<div style="background:var(--bg-card);padding:10px;text-align:center">' +
      '<div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">' + label + '</div>' +
      '<div style="font-size:16px;font-weight:800;color:' + color + ';font-family:var(--mono)">' + value + '</div>' +
      '<div style="font-size:9px;color:var(--text-dim)">' + sub + '</div></div>';
  }

  // ─── Main patch ────────────────────────────────────────

  function _patch() {
    if (typeof buildStructuredOptimization !== 'function') return false;

    var _prevBuild = buildStructuredOptimization;

    window.buildStructuredOptimization = function() {
      var result = _prevBuild();
      if (!result || !result.allocationPlan) return result;

      // v1.2: selective allocation — only deploy if product truly beats cash
      var hasV4 = !!(result._v4);
      var catRate = result.catBenchmark || 2.5;
      var regime = hasV4 ? (result._v4.regime || 'neutral') : 'neutral';
      // Fallback: read regime from MI cache if v4 didn't set it
      if (regime === 'neutral') {
        try {
          if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._mi && _mktCache._mi.regime) regime = _mktCache._mi.regime.toLowerCase();
        } catch(e) {}
      }
      var seuil = hasV4 ? (result._v4.seuil || 55) : 55;
      var fmt = typeof formatNumber === 'function' ? formatNumber : function(n) { return n; };

      // No forced deployment cap — cash is the default, allocation must be earned
      var totalLiq = result.totalLiquidity || 0;
      var maxPer = totalLiq * 0.30; // max 30% in any single product

      // ═══ Phase 1: Enrich with BS data ═══
      var actionable = [];

      result.allocationPlan.forEach(function(a) {
        var prop = _findProposal(a.id);
        var bs = _getBSData(prop);
        a._unds = _getUnderlyings(prop);

        if (bs) {
          a._rn = bs.rendementNet;
          a._pc = bs.probCoupon;
          a._vol = _getProductVol(bs);
          a._pe = bs.perteEsperee;
          a._hasBS = true;
        } else {
          // Fallback: try to get coupon from original product, not normalized plan
          var fc = typeof a.coupon === 'object' ? (a.coupon.rate || 0) : (parseFloat(a.coupon) || 0);
          if (fc <= 0 && prop) {
            var rawC = prop.coupon;
            fc = typeof rawC === 'object' ? (parseFloat(rawC.rate || rawC.rateIfCalled || rawC.rateIfMaturity) || 0) : (parseFloat(rawC) || 0);
          }
          a._rn = fc > 0 ? fc * 0.65 : 0;
          a._pc = 65;
          a._vol = 25;
          a._pe = 0;
          a._hasBS = false;
        }

        // ═══ Phase 2: Selective quality gate ═══
        // Require risk-adjusted premium: spread must compensate for vol
        // minSpread = max(1.0%, vol × 0.05) — higher vol needs more premium
        var isAct = (a.recommendation === 'SOUSCRIRE' || a.recommendation === 'ARBITRER');
        var spread = a._rn - catRate;
        var minSpread = Math.max(1.0, a._vol * 0.05);

        if (isAct && a._rn < 0) {
          a.allocatedAmount = 0; a.annualReturn = 0; a.catReturn = 0; a.excessVsCat = 0;
          a.recommendation = 'PASSER';
          a.reason = '\u26a0 BS rdt net ' + a._rn.toFixed(1) + '%/an (n\u00e9gatif). Garder en CAT.';
        } else if (isAct && spread < minSpread) {
          a.allocatedAmount = 0; a.annualReturn = 0; a.catReturn = 0; a.excessVsCat = 0;
          a.recommendation = 'ATTENDRE';
          a.reason = 'Spread ' + spread.toFixed(1) + '% < min ' + minSpread.toFixed(1) +
            '% (vol ' + Math.round(a._vol) + '%). Prime insuffisante vs cash.';
        } else if (isAct) {
          // Compute individual Sharpe vs CAT
          a._sharpe = a._vol > 0 ? spread / a._vol : 0;
          actionable.push(a);
        }
      });

      // ═══ Phase 3: Quality-weighted sizing ═══
      // Only deploy cash proportional to aggregate quality.
      // If only 1 mediocre product passes, don't deploy 90% of cash into it.
      if (actionable.length > 0) {
        var tw = 0;
        actionable.forEach(function(a) {
          var vol = Math.max(5, a._vol);
          var sf = Math.pow(Math.max(1, a.score - seuil) / Math.max(1, 100 - seuil), 0.4);
          var spf = Math.max(0.5, Math.min(2, (a._rn - catRate) / 5));
          a._w = (1 / vol) * sf * spf;
          tw += a._w;
        });

        // Deployment budget scales with number and quality of candidates
        // avgSharpe of candidates determines how much cash to deploy
        var avgSharpe = actionable.reduce(function(s, a) { return s + (a._sharpe || 0); }, 0) / actionable.length;
        // deployRatio: 0.3 at sharpe=0.05, 0.6 at sharpe=0.15, 0.85 at sharpe=0.30+
        var deployRatio = Math.min(0.85, Math.max(0.20, avgSharpe * 3));
        var depMax = totalLiq * deployRatio;

        actionable.forEach(function(a) {
          var t = Math.round((a._w / tw) * depMax / 1000) * 1000;
          t = Math.min(t, maxPer);
          if (t < 5000) t = 0;
          a.allocatedAmount = t;
        });

        // ═══ Phase 4: Hard concentration limits ═══
        // 4a. Overlap > 50% → block (not just reduce)
        var freed = 0;
        for (var i = 0; i < actionable.length; i++) {
          for (var j = i + 1; j < actionable.length; j++) {
            var ol = _overlap(actionable[i]._unds, actionable[j]._unds);
            if (ol > 0.5 && actionable[j].allocatedAmount > 0) {
              freed += actionable[j].allocatedAmount;
              actionable[j].allocatedAmount = 0;
              actionable[j].recommendation = 'ATTENDRE';
              actionable[j].reason = '\u26d4 Overlap SJ >' + Math.round(ol * 100) + '% avec ' +
                (actionable[i].name || actionable[i].id) + '. Concentration bloqu\u00e9e.';
              actionable[j]._olap = true;
            }
          }
        }

        // 4b. Sector > 40% of allocated positions → block excess
        var sectorCount = {};
        var liveCount = 0;
        actionable.forEach(function(a) {
          if (a.allocatedAmount <= 0) return;
          liveCount++;
          var sec = _detectSector(a._unds);
          a._sector = sec;
          sectorCount[sec] = (sectorCount[sec] || 0) + 1;
        });
        if (liveCount >= 3) {
          Object.keys(sectorCount).forEach(function(sec) {
            if (sec === 'autre') return;
            while (sectorCount[sec] / liveCount > 0.40) {
              // Find lowest-scored product in this sector and block it
              var worst = null;
              actionable.forEach(function(a) {
                if (a._sector === sec && a.allocatedAmount > 0) {
                  if (!worst || a.score < worst.score) worst = a;
                }
              });
              if (!worst) break;
              freed += worst.allocatedAmount;
              worst.allocatedAmount = 0;
              worst.recommendation = 'ATTENDRE';
              worst.reason = '\u26d4 Secteur ' + sec + ' d\u00e9j\u00e0 >' + Math.round(sectorCount[sec] / liveCount * 100) + '% du portefeuille.';
              worst._olap = true;
              sectorCount[sec]--;
              liveCount--;
              if (liveCount < 3) break;
            }
          });
        }

        // 4c. Redistribute freed cash to surviving positions pro-rata
        if (freed > 0) {
          var survivors = actionable.filter(function(a) { return !a._olap && a.allocatedAmount > 0; });
          var survW = survivors.reduce(function(s, a) { return s + (a._w || 0); }, 0);
          if (survW > 0) {
            survivors.forEach(function(a) {
              var extra = Math.round((a._w / survW) * freed / 1000) * 1000;
              extra = Math.min(extra, maxPer - a.allocatedAmount);
              if (extra > 0) a.allocatedAmount += extra;
            });
          }
        }

        // Recalculate returns with BS rendementNet for ALL allocated products
        result.allocationPlan.forEach(function(a) {
          if (a.allocatedAmount > 0 && a._rn != null) {
            a.annualReturn = Math.round(a.allocatedAmount * a._rn / 100);
            a.expectedReturn = a.annualReturn;
            a.catReturn = Math.round(a.allocatedAmount * catRate / 100);
            a.excessVsCat = a.annualReturn - a.catReturn;
            // Fix display: show BS rendement as coupon for UI
            a.coupon = Math.round(a._rn * 10) / 10;

            var parts = [];
            if (a._v4source) parts.push(a._v4source);
            parts.push('Grade ' + a.grade + ' (' + a.score + ')');
            parts.push(fmt(a.allocatedAmount) + '\u20ac');
            parts.push('E[rdt] ' + a._rn.toFixed(1) + '%/an');
            parts.push('prob ' + Math.round(a._pc) + '% \u00b7 vol ' + Math.round(a._vol) + '%');
            if (a.excessVsCat !== 0) parts.push((a.excessVsCat >= 0 ? '+' : '') + fmt(a.excessVsCat) + '\u20ac vs CAT');
            if (a._olap) parts.push('\u26a0 overlap SJ \u2192 -25%');
            if (!a._hasBS) parts.push('(estim\u00e9)');
            a.reason = parts.join(' | ');
          }
        });

        // Recalc totals
        result.deployedAmount = result.allocationPlan.reduce(function(s, a) { return s + (a.allocatedAmount || 0); }, 0);
        result.deployedReturn = result.allocationPlan.reduce(function(s, a) { return s + (a.annualReturn || 0); }, 0);
        result.deployedCatReturn = Math.round(result.deployedAmount * catRate / 100);
        result.deployedExcess = result.deployedReturn - result.deployedCatReturn;
        result.remainingCash = (result.totalLiquidity || 0) - result.deployedAmount;
      }

      // Update “ne rien faire” after v5 filtering
      var subs = (result.allocationPlan || []).filter(function(a) {
        return a.recommendation === 'ARBITRER' || a.recommendation === 'SOUSCRIRE';
      });
      if (hasV4) {
        result._v4.nothingToDo = subs.length === 0;
        if (result._v4.nothingToDo) {
          result._v4.nothingReason = 'Aucune proposition avec rendement BS net > CAT (' +
            catRate.toFixed(1) + '%). Garder la liquidit\u00e9 en placement s\u00fbr.';
        }
      }

      // ═══ Phase 5: Portfolio risk metrics ═══
      var live = actionable.filter(function(a) { return a.allocatedAmount > 0; });
      if (live.length > 0) {
        var td = result.deployedAmount || 1;
        var pd = live.map(function(a) {
          return { vol: a._vol || 25, w: a.allocatedAmount / td, rn: a._rn, u: a._unds, _c: {} };
        });
        for (var i = 0; i < pd.length; i++) {
          for (var j = i + 1; j < pd.length; j++) {
            pd[i]._c[j] = Math.min(0.8, 0.2 + 0.6 * _overlap(pd[i].u, pd[j].u));
          }
        }
        var pv = _portfolioVol(pd);
        var pr = pd.reduce(function(s, p) { return s + p.w * p.rn; }, 0);
        var sh = pv > 0 ? (pr - catRate) / pv : 0;
        var av = pd.reduce(function(s, p) { return s + p.w * p.vol; }, 0);

        result._v5 = {
          portfolioVol: Math.round(pv * 10) / 10,
          portfolioReturn: Math.round(pr * 10) / 10,
          sharpeVsCat: Math.round(sh * 100) / 100,
          maxDrawdownEst: Math.round(pv * 2 * 10) / 10,
          divRatio: pv > 0 ? Math.round(av / pv * 100) / 100 : 1,
          posCount: live.length,
          avgVol: Math.round(av * 10) / 10,
          method: 'BS-vol-sizing-v5.1'
        };

        console.log('[opt-v5] Pf: rdt=' + result._v5.portfolioReturn + '%/an vol=' +
          result._v5.portfolioVol + '% Sharpe=' + result._v5.sharpeVsCat +
          ' DD\u2248' + result._v5.maxDrawdownEst + '% Div=' + result._v5.divRatio + 'x');
      }

      // Cash retained info
      result.cashRetained = totalLiq - (result.deployedAmount || 0);
      result.cashRetainedPct = totalLiq > 0 ? Math.round(result.cashRetained / totalLiq * 100) : 100;
      result.cashReason = subs.length === 0
        ? 'Aucune proposition ne justifie le risque vs CAT. 100% cash.'
        : result.cashRetainedPct > 50
          ? 'Qualit\u00e9 moyenne des propositions → ' + result.cashRetainedPct + '% en cash.'
          : result.cashRetainedPct + '% cash r\u00e9sidu (d\u00e9ploiement s\u00e9lectif).';

      // ═══ Phase 6: Proactive recommendations ═══
      result._recos = _buildRecommendations(regime, catRate, result.cashRetainedPct, subs.length);

      console.log('[opt-v5] deployed=' + fmt(result.deployedAmount || 0) + '\u20ac (' +
        (100 - result.cashRetainedPct) + '%) | cash=' + fmt(result.cashRetained) +
        '\u20ac (' + result.cashRetainedPct + '%) | actions=' + subs.length +
        ' | recos=' + result._recos.length);
      return result;
    };

    // ═══ Render patch: risk metrics banner ═══
    if (typeof renderStructOptimizationTable === 'function') {
      var _prevRender = renderStructOptimizationTable;
      window.renderStructOptimizationTable = function(analysis) {
        var html = '';
        if (analysis._v5) {
          var v = analysis._v5;
          var sc = v.sharpeVsCat >= 0.5 ? 'var(--green)' : v.sharpeVsCat >= 0.2 ? 'var(--cyan)' : v.sharpeVsCat >= 0 ? 'var(--orange)' : 'var(--red)';
          html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:12px">';
          html += _mc('E[rendement]', v.portfolioReturn.toFixed(1) + '%<span style="font-size:10px">/an</span>', 'var(--green)', v.posCount + ' positions BS');
          html += _mc('Vol portefeuille', v.portfolioVol.toFixed(1) + '%', 'var(--orange)', 'avg ind. ' + v.avgVol.toFixed(0) + '%');
          html += _mc('Sharpe vs CAT', v.sharpeVsCat.toFixed(2), sc, 'exc\u00e8s / vol');
          html += _mc('Max drawdown', '\u2248' + v.maxDrawdownEst.toFixed(0) + '%', 'var(--red)', '2\u00d7vol estim\u00e9');
          html += _mc('Diversification', v.divRatio.toFixed(2) + 'x', 'var(--cyan)', '>1 = diversifi\u00e9');
          html += '</div>';
        }
        // Proactive recommendations
        if (analysis._recos && analysis._recos.length > 0) {
          html += '<div style="background:linear-gradient(135deg,rgba(59,130,246,0.05),rgba(139,92,246,0.05));border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px">';
          html += '<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:8px">\ud83d\udca1 Recommandations — que chercher ?</div>';
          analysis._recos.forEach(function(r) {
            var bg = r.type === '\u00c9viter' ? 'rgba(239,35,60,0.06)' : 'rgba(59,130,246,0.04)';
            var border = r.type === '\u00c9viter' ? 'rgba(239,35,60,0.15)' : 'rgba(59,130,246,0.10)';
            html += '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;padding:8px 10px;margin-bottom:6px">';
            html += '<div style="font-size:12px;font-weight:600">' + r.icon + ' ' + r.type + '</div>';
            html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + r.criteria + '</div>';
            html += '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;font-style:italic">' + r.why + '</div>';
            html += '</div>';
          });
          html += '</div>';
        }

        html += _prevRender(analysis);
        return html;
      };
    }

    // ═══ Save patch: persist v5 metrics ═══
    if (typeof saveStructOptimizerResult === 'function') {
      var _prevSave = saveStructOptimizerResult;
      window.saveStructOptimizerResult = function(summary, analysis) {
        return _prevSave(summary, analysis).then(function() {
          if (analysis._v5 && typeof _lastStructOptResult !== 'undefined' && _lastStructOptResult) {
            _lastStructOptResult.v5Metrics = analysis._v5;
          }
        });
      };
    }

    console.log('[opt-v5] v1.1 BS return + vol-sizing + risk metrics active');
    return true;
  }

  // v1.1: simplified detection — just need buildStructuredOptimization to exist
  // v5 wraps whatever is there (v4 or base), checks result._v4 at runtime
  if (!_patch()) {
    var att = 0;
    var iv = setInterval(function() {
      att++;
      if (_patch()) { clearInterval(iv); }
      else if (att > 80) { console.warn('[opt-v5] Timeout — buildStructuredOptimization not found'); clearInterval(iv); }
    }, 200);
  }
})();

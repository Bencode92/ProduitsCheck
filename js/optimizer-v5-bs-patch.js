// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v5 BS Risk Patch
//
// Loaded AFTER optimizer-v4-patch.js (outermost optimizer layer)
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
    Object.values(app.state.proposals || {}).forEach(function(arr) {
      arr.forEach(function(p) { if (p.id === id) found = p; });
    });
    return found;
  }

  function _getBSData(proposal) {
    if (!proposal) return null;
    var meta = (proposal.grading && proposal.grading.metadata) || {};
    var rdtNet = proposal._bsRendementNet;
    if (rdtNet === undefined || rdtNet === null) rdtNet = meta.bsRendementNet;
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

  function _mc(label, value, color, sub) {
    return '<div style="background:var(--bg-card);padding:10px;text-align:center">' +
      '<div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">' + label + '</div>' +
      '<div style="font-size:16px;font-weight:800;color:' + color + ';font-family:var(--mono)">' + value + '</div>' +
      '<div style="font-size:9px;color:var(--text-dim)">' + sub + '</div></div>';
  }

  // ─── Main patch ────────────────────────────────────────

  function _patch() {
    if (typeof buildStructuredOptimization !== 'function') return false;
    // Wait for v4 to have patched (v4 uses result._v4 in its body)
    if (buildStructuredOptimization.toString().indexOf('_v4') < 0) return false;

    var _prevBuild = buildStructuredOptimization;

    window.buildStructuredOptimization = function() {
      var result = _prevBuild(); // v4 → original chain
      if (!result || !result.allocationPlan) return result;

      var catRate = result.catBenchmark || 2.5;
      var regime = (result._v4 && result._v4.regime) || 'neutral';
      var seuil = (result._v4 && result._v4.seuil) || 55;
      var cr = _cashRes(regime);
      var depMax = (result.totalLiquidity || 0) * (1 - cr);
      var maxPer = depMax * 0.30;
      var fmt = typeof formatNumber === 'function' ? formatNumber : function(n) { return n; };

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
          // Fallback: facial × 0.65 conservative
          var fc = typeof a.coupon === 'object' ? (a.coupon.rate || 0) : (parseFloat(a.coupon) || 0);
          a._rn = fc * 0.65;
          a._pc = 65;
          a._vol = 25;
          a._pe = 0;
          a._hasBS = false;
        }

        // ═══ Phase 2: BS gate ═══
        var isAct = (a.recommendation === 'SOUSCRIRE' || a.recommendation === 'ARBITRER');
        if (isAct && a._rn < 0) {
          a.allocatedAmount = 0; a.annualReturn = 0; a.catReturn = 0; a.excessVsCat = 0;
          a.recommendation = 'PASSER';
          a.reason = '\u26a0 BS rdt net ' + a._rn.toFixed(1) + '%/an (n\u00e9gatif). Garder en CAT.';
        } else if (isAct && a._rn < catRate) {
          a.allocatedAmount = 0; a.annualReturn = 0; a.catReturn = 0; a.excessVsCat = 0;
          a.recommendation = 'ATTENDRE';
          a.reason = 'BS rdt net ' + a._rn.toFixed(1) + '% < CAT ' + catRate.toFixed(1) + '%. Prime insuffisante.';
        } else if (isAct) {
          actionable.push(a);
        }
      });

      // ═══ Phase 3: Inverse-vol sizing ═══
      if (actionable.length > 0) {
        var tw = 0;
        actionable.forEach(function(a) {
          var vol = Math.max(5, a._vol);
          var sf = Math.pow(Math.max(1, a.score - seuil) / Math.max(1, 100 - seuil), 0.4);
          var spf = Math.max(0.5, Math.min(2, (a._rn - catRate) / 5));
          a._w = (1 / vol) * sf * spf;
          tw += a._w;
        });

        actionable.forEach(function(a) {
          var t = Math.round((a._w / tw) * depMax / 1000) * 1000;
          t = Math.min(t, maxPer);
          if (t < 5000) t = 0;
          a.allocatedAmount = t;
        });

        // ═══ Phase 4: Correlation limits ═══
        for (var i = 0; i < actionable.length; i++) {
          for (var j = i + 1; j < actionable.length; j++) {
            var ol = _overlap(actionable[i]._unds, actionable[j]._unds);
            if (ol > 0.5 && actionable[j].allocatedAmount > 0) {
              actionable[j].allocatedAmount = Math.round(actionable[j].allocatedAmount * 0.75 / 1000) * 1000;
              actionable[j]._olap = true;
            }
          }
        }

        // Recalculate returns with BS rendementNet
        result.allocationPlan.forEach(function(a) {
          if (a.allocatedAmount > 0) {
            a.annualReturn = Math.round(a.allocatedAmount * a._rn / 100);
            a.expectedReturn = a.annualReturn;
            a.catReturn = Math.round(a.allocatedAmount * catRate / 100);
            a.excessVsCat = a.annualReturn - a.catReturn;

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

      // Update "ne rien faire" after v5 filtering
      var subs = (result.allocationPlan || []).filter(function(a) {
        return a.recommendation === 'ARBITRER' || a.recommendation === 'SOUSCRIRE';
      });
      if (result._v4) {
        result._v4.nothingToDo = subs.length === 0;
        if (result._v4.nothingToDo && !result._v4._origNothing) {
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
          method: 'BS-vol-sizing-v5'
        };

        console.log('[opt-v5] Pf: rdt=' + result._v5.portfolioReturn + '%/an vol=' +
          result._v5.portfolioVol + '% Sharpe=' + result._v5.sharpeVsCat +
          ' DD\u2248' + result._v5.maxDrawdownEst + '% Div=' + result._v5.divRatio + 'x');
      }

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

    console.log('[opt-v5] BS return + vol-sizing + risk metrics active');
    return true;
  }

  // Wait for v4 to be applied before patching
  var att = 0;
  var iv = setInterval(function() {
    att++;
    if (_patch()) { clearInterval(iv); }
    else if (att > 200) { console.warn('[opt-v5] Timeout waiting for v4'); clearInterval(iv); }
  }, 250);
})();

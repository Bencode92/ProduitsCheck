// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Barrier Distance Patch v1.0
//
// Calculates real-time distance-to-barrier for each product
// using live spot prices from stocks_europe.json + underlyings_extra.json
//
// Distance = min(spot_i / strike_i) - barrier%
//   positive = above barrier (safe)
//   negative = below barrier (BREACH)
//
// Displays a colored badge on each product card
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _spotCache = null;

  // Load spot prices from both stock files
  function _loadSpots() {
    if (_spotCache) return Promise.resolve(_spotCache);
    _spotCache = {};

    var p1 = fetch('data/market/stocks_europe.json').then(function(r) { return r.json(); })
      .then(function(d) {
        var list = Array.isArray(d) ? d : (d.stocks || []);
        list.forEach(function(s) {
          if (s.ticker && s.last_close) {
            _spotCache[s.ticker.toUpperCase()] = {
              price: s.last_close, name: s.name || s.ticker,
              perf_ytd: s.perf_ytd, dd_3y: s.max_dd_3y
            };
            if (s.name) _spotCache[s.name.toUpperCase()] = _spotCache[s.ticker.toUpperCase()];
          }
        });
      }).catch(function() {});

    var p2 = fetch('data/market/underlyings_extra.json').then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.tickers) {
          Object.keys(d.tickers).forEach(function(k) {
            var t = d.tickers[k];
            if (t.last_close) {
              _spotCache[k.toUpperCase()] = {
                price: t.last_close, name: k,
                perf_ytd: t.perf_ytd, dd_3y: t.max_dd_3y
              };
            }
          });
        }
      }).catch(function() {});

    return Promise.all([p1, p2]).then(function() {
      console.log('[barrier-dist] Loaded ' + Object.keys(_spotCache).length + ' spot prices');
      return _spotCache;
    });
  }

  function _resolveSpot(name) {
    if (!_spotCache || !name) return null;
    var n = name.toUpperCase().trim();
    if (_spotCache[n]) return _spotCache[n];
    // keyword extraction
    var tokens = n.split(/[\s,.:;()%\-\/]+/).filter(function(t) { return t.length >= 2; });
    for (var i = 0; i < tokens.length; i++) {
      if (_spotCache[tokens[i]]) return _spotCache[tokens[i]];
    }
    // partial match
    var keys = Object.keys(_spotCache);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].length >= 3 && (keys[j].indexOf(n) >= 0 || n.indexOf(keys[j]) >= 0)) {
        return _spotCache[keys[j]];
      }
    }
    return null;
  }

  // Calculate distance to barrier for a product
  // Returns { distance: %, worstUnderlying: name, worstPerf: %, alert: level }
  function _calcBarrierDistance(product) {
    var cp = product.capitalProtection || {};
    var barrier = parseFloat(cp.barrier) || 0;
    if (!barrier || barrier <= 0 || barrier >= 100) return null;
    if (cp.protected === true) return null; // capital garanti = no barrier risk

    var unds = product.underlyings || [];
    if (typeof unds === 'string') unds = [unds];
    unds = unds.map(function(u) { return typeof u === 'string' ? u : (u.name || u.ticker || ''); }).filter(Boolean);
    if (unds.length === 0) return null;

    // Get strike prices if captured
    var strikes = product._strikes || product.strikes || {};

    var worstPct = Infinity;
    var worstName = '';
    var details = [];

    unds.forEach(function(uName) {
      var spot = _resolveSpot(uName);
      if (!spot) return;

      var strike = strikes[uName.toUpperCase()] || strikes[uName] || null;
      var pctOfStrike;

      if (strike && strike > 0) {
        // We have the actual strike → precise calculation
        pctOfStrike = (spot.price / strike) * 100;
      } else {
        // No strike captured → assume strike = 100% (product at inception)
        // Use YTD perf as proxy: if stock down 20% YTD and product is recent,
        // current level relative to strike ≈ (100 + perf)%
        // This is a rough approximation
        pctOfStrike = 100; // default: assume at strike level
        if (spot.perf_ytd !== undefined && spot.perf_ytd !== null) {
          // If stock has fallen, it's below its level from earlier this year
          // We don't know exact strike date, so this is approximate
          pctOfStrike = 100 + (spot.perf_ytd || 0) * 0.5; // damped estimate
        }
      }

      var distance = pctOfStrike - barrier;

      details.push({
        name: uName, price: spot.price, pctOfStrike: Math.round(pctOfStrike * 10) / 10,
        distance: Math.round(distance * 10) / 10, dd3y: spot.dd_3y
      });

      if (pctOfStrike < worstPct) {
        worstPct = pctOfStrike;
        worstName = uName;
      }
    });

    if (details.length === 0) return null;

    var worstDistance = Math.round((worstPct - barrier) * 10) / 10;
    var alert = 'safe';
    if (worstDistance <= 0) alert = 'breach';
    else if (worstDistance < 10) alert = 'danger';
    else if (worstDistance < 20) alert = 'warning';
    else if (worstDistance < 35) alert = 'watch';

    return {
      distance: worstDistance, barrier: barrier,
      worstUnderlying: worstName, worstPct: Math.round(worstPct * 10) / 10,
      alert: alert, details: details
    };
  }

  // Render badge HTML for a barrier distance result
  function _renderBadge(bd) {
    if (!bd) return '';
    var colors = {
      safe: { bg: 'rgba(6,214,160,0.1)', border: 'rgba(6,214,160,0.3)', text: 'var(--green)' },
      watch: { bg: 'rgba(78,205,196,0.1)', border: 'rgba(78,205,196,0.3)', text: 'var(--cyan)' },
      warning: { bg: 'rgba(255,182,39,0.1)', border: 'rgba(255,182,39,0.3)', text: 'var(--orange)' },
      danger: { bg: 'rgba(232,93,4,0.1)', border: 'rgba(232,93,4,0.3)', text: 'var(--orange)' },
      breach: { bg: 'rgba(239,35,60,0.1)', border: 'rgba(239,35,60,0.3)', text: 'var(--red)' }
    };
    var c = colors[bd.alert] || colors.watch;
    var icon = bd.alert === 'breach' ? '\u26d4' : bd.alert === 'danger' ? '\u26a0' : bd.alert === 'warning' ? '\u25b3' : '\u2713';

    var html = '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;' +
      'background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:6px;font-size:11px;cursor:pointer" ' +
      'title="Barri\u00e8re ' + bd.barrier + '% | Worst: ' + bd.worstUnderlying + ' \u00e0 ' + bd.worstPct + '% du strike">' +
      '<span style="font-size:13px">' + icon + '</span>' +
      '<span style="color:' + c.text + ';font-weight:700;font-family:var(--mono)">' +
      (bd.distance >= 0 ? '+' : '') + bd.distance + '%</span>' +
      '<span style="color:var(--text-dim)">barri\u00e8re</span></div>';
    return html;
  }

  // Inject barrier distance into grading results
  function _patchGrade() {
    if (typeof ProposalGrader === 'undefined' || !ProposalGrader.grade) return false;

    var _prev = ProposalGrader.grade;
    ProposalGrader.grade = function(product) {
      return _loadSpots().then(function() {
        return _prev.call(ProposalGrader, product);
      }).then(function(result) {
        if (!result || !product) return result;
        var bd = _calcBarrierDistance(product);
        if (bd) {
          product._barrierDistance = bd;
          if (result.metadata) {
            result.metadata.barrierDistance = bd.distance;
            result.metadata.barrierAlert = bd.alert;
            result.metadata.barrierWorst = bd.worstUnderlying;
          }
          console.log('[barrier-dist] ' + (product.name || '?').substring(0, 25) +
            ' | dist=' + bd.distance + '% | worst=' + bd.worstUnderlying +
            ' (' + bd.worstPct + '%) | ' + bd.alert.toUpperCase());
        }
        return result;
      });
    };
    console.log('[barrier-dist] Patch active');
    return true;
  }

  // Inject badge into the UI after grading renders
  function _patchUI() {
    if (typeof renderDashboard !== 'function') return false;
    var _prevRender = renderDashboard;
    renderDashboard = function(container, state) {
      _prevRender(container, state);
      setTimeout(function() {
        // Find product cards and inject barrier badges
        var portfolio = app.state.portfolio || [];
        portfolio.forEach(function(p) {
          if (!p._barrierDistance) return;
          var card = container.querySelector('[data-id="' + p.id + '"]');
          if (!card) return;
          if (card.querySelector('.barrier-badge')) return; // already injected
          var gradeEl = card.querySelector('.grade-badge') || card.querySelector('.grade-circle');
          if (gradeEl) {
            var badge = document.createElement('span');
            badge.className = 'barrier-badge';
            badge.innerHTML = _renderBadge(p._barrierDistance);
            badge.style.marginLeft = '8px';
            gradeEl.parentElement.appendChild(badge);
          }
        });

        // Also inject into proposals
        Object.values(app.state.proposals || {}).forEach(function(arr) {
          arr.forEach(function(p) {
            if (!p._barrierDistance) return;
            var card = container.querySelector('[data-id="' + p.id + '"]');
            if (!card || card.querySelector('.barrier-badge')) return;
            var gradeEl = card.querySelector('.grade-badge') || card.querySelector('.grade-circle');
            if (gradeEl) {
              var badge = document.createElement('span');
              badge.className = 'barrier-badge';
              badge.innerHTML = _renderBadge(p._barrierDistance);
              badge.style.marginLeft = '8px';
              gradeEl.parentElement.appendChild(badge);
            }
          });
        });
      }, 200);
    };
    return true;
  }

  // Export for comparison view
  window._calcBarrierDistance = _calcBarrierDistance;
  window._renderBarrierBadge = _renderBadge;
  window._loadBarrierSpots = _loadSpots;

  if (!_patchGrade()) {
    var att = 0;
    var iv = setInterval(function() {
      att++;
      if (_patchGrade() || att > 60) clearInterval(iv);
    }, 100);
  }

  var uiAtt = 0;
  var uiIv = setInterval(function() {
    uiAtt++;
    if (_patchUI() || uiAtt > 80) clearInterval(uiIv);
  }, 250);
})();

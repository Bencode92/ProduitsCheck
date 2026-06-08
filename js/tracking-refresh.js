// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Tracking refresh (TAUX uniquement)
// Met à jour automatiquement le suivi des produits de TAUX : niveau du taux de
// référence (TEC10 / Euribor / OAT5Y, depuis data/market/rates.json) vs le trigger
// du coupon, avec un point d'historique daté → alimente la validation forward.
// L'equity n'est PAS auto-tracké : les strikes stockés ne correspondent pas de façon
// fiable aux prix de marché résolus (indice vs action) → risque de faux. → saisie manuelle.
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  function _today() { return new Date().toISOString().split('T')[0]; }

  async function _liveRates() {
    try {
      var r = await fetch('data/market/rates.json').then(function (x) { return x.ok ? x.json() : null; });
      if (!r) return null;
      var y = r.yields || {};
      var cur = function (k) { return y[k] && y[k].current != null ? y[k].current : null; };
      return { tec10: cur('tec10_fr') != null ? cur('tec10_fr') : cur('oat_fr_10y'), euribor3m: cur('euribor_3m'), oat5y: cur('oat_fr_5y'), asOf: r.fetched_at || null };
    } catch (e) { return null; }
  }

  function _ref(p, R) {
    var t = ((p.name || '') + ' ' + (((p.coupon || {}).triggerDetail) || '')).toLowerCase();
    if (/euribor/.test(t)) return { v: R.euribor3m, l: 'Euribor 3M' };
    if (/oat 5|5 ans|cms/.test(t)) return { v: R.oat5y, l: 'OAT 5Y' };
    return { v: R.tec10, l: 'TEC10' };
  }

  function _isRateProduct(p) {
    return /rate|taux/i.test(p.underlyingType || '') && p.coupon && p.coupon.trigger != null && p.coupon.trigger !== '';
  }

  function _apply(p, R) {
    var ref = _ref(p, R);
    if (ref.v == null) return false;
    var trig = parseFloat(p.coupon.trigger);
    if (isNaN(trig)) return false;
    p.tracking = p.tracking || {};
    if (!Array.isArray(p.tracking.history)) p.tracking.history = [];
    p.tracking.level = ref.v;                                  // niveau = taux de réf (cohérent : produit de taux)
    p.tracking.refLabel = ref.l;
    p.tracking.trigger = trig;
    p.tracking.marginToTrigger = Math.round((trig - ref.v) * 100) / 100;
    p.tracking.couponOK = ref.v <= trig;                       // coupon si taux ≤ trigger
    p.tracking.date = _today();
    p.tracking.note = 'auto-taux (' + ref.l + ')';
    var last = p.tracking.history[p.tracking.history.length - 1];
    if (!last || last.date !== _today()) p.tracking.history.push({ date: _today(), level: ref.v, ref: ref.l });
    if (p.tracking.history.length > 60) p.tracking.history = p.tracking.history.slice(-60);
    return true;
  }

  window.refreshRateTracking = async function () {
    var R = await _liveRates();
    if (!R || R.tec10 == null) { showToast('Taux live indisponibles (rates.json)', 'error'); return; }
    var updated = 0, fails = 0, pfChanged = false, equityCount = 0;
    (app.state.portfolio || []).forEach(function (p) {
      if (_isRateProduct(p)) { if (_apply(p, R)) { updated++; pfChanged = true; } }
      else if (!/rate|taux/i.test(p.underlyingType || '') && (p.underlyings || []).length) equityCount++;
    });
    if (pfChanged) { try { await github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', app.state.portfolio, '[StructBoard] Suivi taux auto'); } catch (e) { fails++; } }
    var props = app.state.proposals || {};
    for (var bank in props) {
      for (var i = 0; i < props[bank].length; i++) {
        var p = props[bank][i];
        if (_isRateProduct(p) && _apply(p, R)) { try { await app._saveProductFile(bank, p); updated++; } catch (e) { fails++; } }
      }
    }
    if (typeof app.setState === 'function') app.setState({});
    var msg = 'Suivi taux actualisé : ' + updated + ' produit(s) de taux';
    if (fails) msg += ' · ' + fails + ' échec(s) écriture';
    if (equityCount) msg += ' · ' + equityCount + ' equity à saisir manuellement (strike manquant/non fiable)';
    showToast(msg, fails ? 'info' : 'success');
    return { updated: updated, fails: fails, equityToDo: equityCount };
  };
})();

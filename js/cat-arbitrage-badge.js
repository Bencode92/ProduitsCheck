// ═══════════════════════════════════════════════════════════════════════════
// CAT — le taux qui décide : celui que le produit paiera D'ICI À l'échéance
//
// La carte affiche le taux du palier en cours (ex. CATIP 2,70 %). Ce n'est ni le
// taux moyen depuis l'origine, ni le taux qui sert à décider. Pour savoir s'il faut
// arbitrer, le seul chiffre pertinent est la moyenne des paliers RESTANTS — le passé
// est encaissé, il ne se renégocie pas.
//
// Ce module ajoute sur chaque carte : taux restant, meilleure offre de même durée,
// coût de sortie réel (pénalité × jours écoulés dans la période en cours) et gain net.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var SEUIL_EUR = 300;          // en deçà, l'écart ne justifie pas un dossier
  var PREAVIS_DEFAUT = 32;

  function _d(x) { try { return new Date(x); } catch (e) { return null; } }
  function _jours(a, b) { return Math.max(0, (b - a) / 86400000); }
  function _eur(n) { return (typeof formatNumber === 'function' ? formatNumber(Math.round(n)) : Math.round(n)) + '€'; }
  function _pct(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + '%'; }

  // Moyenne pondérée par les jours des paliers encore à courir.
  function _tauxRestant(d, now) {
    var fin = _d(d.maturityDate); if (!fin || fin <= now) return null;
    var sched = Array.isArray(d.rateSchedule) ? d.rateSchedule : [];
    if (!sched.length) { var r = parseFloat(d.rate); return isNaN(r) ? null : { taux: r, jours: _jours(now, fin), palier: null, suivant: null }; }
    var acc = 0, tj = 0, courant = null, suivant = null;
    for (var i = 0; i < sched.length; i++) {
      var a = _d(sched[i].from), b = _d(sched[i].to), tx = parseFloat(sched[i].rate);
      if (!a || !b || isNaN(tx)) continue;
      if (b <= now) continue;
      if (a <= now && now < b) { courant = tx; suivant = sched[i + 1] ? parseFloat(sched[i + 1].rate) : null; }
      var deb = a > now ? a : now, f = b < fin ? b : fin;
      var j = _jours(deb, f);
      if (j > 0) { acc += tx * j; tj += j; }
    }
    if (!tj) return null;
    return { taux: acc / tj, jours: tj, palier: courant, suivant: suivant, debutPeriode: null };
  }

  // Meilleure offre du marché pour une durée comparable (grille en vigueur).
  function _meilleureOffre(mois) {
    try {
      var src = (typeof catManager !== 'undefined' && catManager.rates) ? catManager.rates : null;
      if (!src) return null;
      var list = (typeof window._catLatestRates === 'function') ? window._catLatestRates(src) : (src.rates || []);
      var best = null;
      list.forEach(function (o) {
        if (o.productType === 'parts-sociales') return;
        var m = parseInt(o.durationMonths, 10), r = parseFloat(o.rate);
        if (!m || isNaN(r)) return;
        if (m > mois * 1.6 || m < mois * 0.4) return;        // durée comparable
        if (!best || r > best.rate) best = { rate: r, bank: o.bankName || o.bankId, months: m, age: o._ageDays };
      });
      return best;
    } catch (e) { return null; }
  }

  // Pénalité réellement due : l'écart de taux appliqué aux jours DÉJÀ courus
  // dans la période en cours — pas sur toute la durée restante.
  function _coutSortie(d, now, tr) {
    var sched = Array.isArray(d.rateSchedule) ? d.rateSchedule : [];
    var mt = parseFloat(d.amount) || 0;
    for (var i = 0; i < sched.length; i++) {
      var a = _d(sched[i].from), b = _d(sched[i].to);
      if (!a || !b || !(a <= now && now < b)) continue;
      var tx = parseFloat(sched[i].rate);
      var early = sched[i].earlyRate != null ? parseFloat(sched[i].earlyRate) : null;
      if (early == null || isNaN(early) || isNaN(tx)) return { cout: 0, connu: false };
      return { cout: mt * ((tx - early) / 100) * (_jours(a, now) / 365), connu: true, taux: early };
    }
    return { cout: 0, connu: false };
  }

  if (typeof renderPlacementCard !== 'function') return;
  var _orig = renderPlacementCard;
  renderPlacementCard = function (d) {
    var html = _orig(d);
    try {
      if (d.status !== 'active' || d.productType === 'parts-sociales') return html;
      var now = new Date();
      var tr = _tauxRestant(d, now); if (!tr) return html;
      var mois = Math.round(tr.jours / 30.44);
      var off = _meilleureOffre(mois); if (!off) return html;

      var mt = parseFloat(d.amount) || 0, ans = tr.jours / 365;
      var ecart = off.rate - tr.taux;
      var gain = mt * (ecart / 100) * ans;
      var cs = _coutSortie(d, now, tr);
      var net = gain - cs.cout;

      var vert = '#059669', orange = '#E85D04', gris = '#64748B';
      var h = '';
      if (net >= SEUIL_EUR) {
        h = '<div style="margin-top:4px;padding:5px 8px;background:rgba(232,93,4,0.09);border-left:2px solid ' + orange + ';border-radius:4px;font-size:10px;line-height:1.5;color:' + orange + '">'
          + '<strong>⚖ Arbitrage : +' + _eur(net) + '</strong> — il paiera <strong>' + _pct(tr.taux) + '</strong> d\'ici à l\'échéance, contre <strong>' + _pct(off.rate) + '</strong> chez ' + off.bank + ' sur ' + off.months + ' mois.'
          + (off.age != null && off.age > 45 ? ' <em>Grille ' + off.bank + ' vieille de ' + off.age + ' j — à reconfirmer.</em>' : '')
          + (cs.connu && cs.cout > 1 ? ' Sortie : ' + _eur(cs.cout) + ' de pénalité, préavis ' + (d.noticeDays || PREAVIS_DEFAUT) + ' j.' : ' Sortie sans pénalité, préavis ' + (d.noticeDays || PREAVIS_DEFAUT) + ' j.')
          + '</div>';
      } else if (ecart < -0.25) {
        h = '<div style="margin-top:4px;padding:5px 8px;background:rgba(5,150,105,0.09);border-left:2px solid ' + vert + ';border-radius:4px;font-size:10px;line-height:1.5;color:' + vert + '">'
          + '<strong>🔒 À garder</strong> — il paiera <strong>' + _pct(tr.taux) + '</strong> d\'ici à l\'échéance, soit <strong>' + _pct(-ecart) + ' au-dessus</strong> du marché (' + _pct(off.rate) + ').'
          + (tr.suivant != null && tr.palier != null && tr.suivant > tr.palier ? ' Le palier passe de ' + _pct(tr.palier) + ' à ' + _pct(tr.suivant) + '.' : '')
          + '</div>';
      } else {
        h = '<div style="margin-top:4px;padding:5px 8px;background:rgba(100,116,139,0.08);border-radius:4px;font-size:10px;color:' + gris + '">'
          + '≈ au marché — ' + _pct(tr.taux) + ' restants contre ' + _pct(off.rate) + ' ailleurs. Rien à gagner à bouger.</div>';
      }
      return (typeof _injectBeforeLastDiv === 'function') ? _injectBeforeLastDiv(html, h) : html;
    } catch (e) { return html; }
  };

  console.log('[CAT] badge arbitrage (taux restant vs marché) actif');
})();

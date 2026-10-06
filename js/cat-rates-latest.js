// ═══════════════════════════════════════════════════════════════════════════
// CAT — une grille par banque, la plus récente
//
// data/cat/rates.json conserve l'HISTORIQUE des grilles : c'est voulu, ça permet
// de mesurer combien une banque a bougé d'un mois sur l'autre. Mais aucun écran ne
// doit afficher deux fois le même produit à deux taux différents. Ce module donne
// la vue « aujourd'hui » : pour chaque (banque, durée, type, nom de produit), on ne
// garde que l'entrée la plus récente, et on lui attache ce qu'elle remplace.
//
// Chargé avant tous les autres modules CAT ; les consommateurs l'utilisent avec un
// repli (`window._catLatestRates ? ... : rates`) pour rester robustes.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function _key(o) {
    return [o.bankId || o.bankName || '?', o.durationMonths, o.rateType || 'fixe',
            (o.productName || '').trim().toLowerCase()].join('|');
  }

  // Grille en vigueur. Chaque offre retenue porte `_previous` (l'entrée qu'elle
  // remplace) et `_deltaBp` (l'écart en points de base), pour que les écrans
  // puissent dire « +40 bp depuis la grille précédente » sans refaire le calcul.
  // Accepte soit un tableau d'offres, soit l'objet du fichier { rates, history } —
  // auquel cas l'historique est joint, uniquement pour calculer les écarts.
  function _flatten(input) {
    if (Array.isArray(input)) return input;
    if (input && Array.isArray(input.rates)) return input.rates.concat(Array.isArray(input.history) ? input.history : []);
    return [];
  }

  // Une grille vieille de six mois n'est pas une offre, c'est un souvenir. Sans ce
  // filtre, le comparateur proposait « 3,60 % chez HSBC » d'après une grille d'avril
  // comme meilleure offre du jour, et le test d'arbitrage s'appuyait dessus.
  var PEREMPTION_JOURS = 150;

  window._catStaleDays = function (o) {
    if (!o || !o.date) return null;
    var d = new Date(o.date); if (isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };

  // options.includeStale : garder les grilles périmées (vue « toutes les banques »).
  window._catLatestRates = function (input, options) {
    var rates = _flatten(input);
    if (!rates.length) return [];
    if (!(options && options.includeStale)) {
      var frais = rates.filter(function (o) {
        var age = window._catStaleDays(o);
        return age == null || age <= PEREMPTION_JOURS;
      });
      if (frais.length) rates = frais;
    }
    var byKey = {};
    rates.forEach(function (o) {
      if (!o || o.durationMonths == null) return;
      var k = _key(o), cur = byKey[k];
      if (!cur) { byKey[k] = o; return; }
      var a = String(o.date || ''), b = String(cur.date || '');
      if (a > b) byKey[k] = o;
    });
    var out = [];
    Object.keys(byKey).forEach(function (k) {
      var win = byKey[k];
      var older = rates.filter(function (o) { return _key(o) === k && o !== win && String(o.date || '') < String(win.date || ''); })
                       .sort(function (x, y) { return String(y.date || '').localeCompare(String(x.date || '')); });
      if (older.length) {
        var prev = older[0], d = (parseFloat(win.rate) - parseFloat(prev.rate));
        if (!isNaN(d)) { win._previous = prev; win._deltaBp = Math.round(d * 100); }
      }
      win._ageDays = window._catStaleDays(win);
      out.push(win);
    });
    return out;
  };

  // Historique complet d'un produit, du plus récent au plus ancien.
  window._catRateHistory = function (input, offer) {
    var rates = _flatten(input);
    if (!rates.length || !offer) return [];
    var k = _key(offer);
    return rates.filter(function (o) { return _key(o) === k; })
                .sort(function (x, y) { return String(y.date || '').localeCompare(String(x.date || '')); });
  };
})();

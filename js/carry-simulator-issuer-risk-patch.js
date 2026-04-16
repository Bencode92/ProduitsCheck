// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Patch Risque Émetteur
// Ajoute une ligne "Perte espérée défaut émetteur" dans le P&L du carry trade.
//
// MOTIVATION :
//   Capital garanti par CIC/SG ≠ capital sans risque.
//   - CIC (A+) : proba défaut 5Y ≈ 1.2% → perte espérée ~7K€/1M€
//   - SG (A)   : proba défaut 5Y ≈ 2.0% → perte espérée ~12K€/1M€
//   Rappel Credit Suisse 2023 : noté AA- en 2022, effondré en quelques mois.
//   Les EMTN seniors ont recovery ~70-80%, mais le risque n'est pas nul.
//
// CE PATCH :
//   - Expose window.calcIssuerRisk(rating, nominal, maturity) pour calcul manuel
//   - Expose window.CARRY_ISSUER_PD_TABLE pour consultation
//   - Recommandations de diversification émetteur
//
// NB : L'affichage dans l'UI nécessite un hook que carry-simulator.js n'expose pas.
//      Ce patch fournit donc les calculs ; l'intégration UI est à faire manuellement
//      dans _renderResult (voir README du patch pour l'emplacement).
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Table de probabilités de défaut cumulées ──────
  // Source : tables cumulative default rates S&P / Moody's 2024, sécurité senior bancaire
  // Ces valeurs sont des estimations centrales, la vraie PD dépend du secteur, du pays, etc.
  var ISSUER_PD_TABLE = {
    'AAA':  { 1: 0.0001, 3: 0.0010, 5: 0.0030, 7: 0.0055, 10: 0.0080 },
    'AA+':  { 1: 0.0003, 3: 0.0020, 5: 0.0050, 7: 0.0090, 10: 0.0150 },
    'AA':   { 1: 0.0005, 3: 0.0035, 5: 0.0080, 7: 0.0150, 10: 0.0250 },
    'AA-':  { 1: 0.0008, 3: 0.0055, 5: 0.0100, 7: 0.0200, 10: 0.0320 },
    'A+':   { 1: 0.0012, 3: 0.0075, 5: 0.0120, 7: 0.0240, 10: 0.0350 },   // CIC
    'A':    { 1: 0.0020, 3: 0.0110, 5: 0.0200, 7: 0.0350, 10: 0.0500 },   // SG, MS
    'A-':   { 1: 0.0035, 3: 0.0170, 5: 0.0300, 7: 0.0500, 10: 0.0700 },
    'BBB+': { 1: 0.0060, 3: 0.0280, 5: 0.0500, 7: 0.0800, 10: 0.1000 },
    'BBB':  { 1: 0.0100, 3: 0.0450, 5: 0.0750, 7: 0.1100, 10: 0.1400 },
    'BBB-': { 1: 0.0180, 3: 0.0700, 5: 0.1100, 7: 0.1500, 10: 0.1900 }
  };

  // ─── Recovery rates par type d'instrument ──────
  var RECOVERY_RATES = {
    'senior_secured':   0.60,
    'senior_unsecured': 0.40,   // standard pour EMTN structurés
    'subordinated':     0.25,
    'AT1':              0.00    // Credit Suisse rappel
  };

  // ─── Fonction principale de calcul ──────
  window.calcIssuerRisk = function(rating, nominal, maturityYears, instrumentType) {
    instrumentType = instrumentType || 'senior_unsecured';
    nominal = Number(nominal) || 0;
    maturityYears = Number(maturityYears) || 5;

    // Récupérer la PD pour la maturité exacte (interpolation linéaire si besoin)
    var ratingTable = ISSUER_PD_TABLE[rating];
    if (!ratingTable) {
      console.warn('[IssuerRisk] Rating inconnu : ' + rating + '. Fallback A.');
      ratingTable = ISSUER_PD_TABLE['A'];
    }

    var pd;
    var maturities = Object.keys(ratingTable).map(Number).sort(function(a, b) { return a - b; });
    if (ratingTable[maturityYears] !== undefined) {
      pd = ratingTable[maturityYears];
    } else {
      // Interpolation linéaire
      var lower = maturities[0], upper = maturities[maturities.length - 1];
      for (var i = 0; i < maturities.length - 1; i++) {
        if (maturities[i] <= maturityYears && maturities[i + 1] >= maturityYears) {
          lower = maturities[i];
          upper = maturities[i + 1];
          break;
        }
      }
      if (maturityYears < lower) pd = ratingTable[lower];
      else if (maturityYears > upper) pd = ratingTable[upper];
      else {
        var weight = (maturityYears - lower) / (upper - lower);
        pd = ratingTable[lower] * (1 - weight) + ratingTable[upper] * weight;
      }
    }

    var recovery = RECOVERY_RATES[instrumentType] || 0.40;
    var lgd = 1 - recovery;

    var expectedLoss = pd * lgd * nominal;
    var tailLoss = lgd * nominal;  // perte si défaut effectif (conditionnel)

    return {
      rating: rating,
      nominal: nominal,
      maturityYears: maturityYears,
      instrumentType: instrumentType,
      probDefault: pd,
      recoveryRate: recovery,
      lgd: lgd,
      expectedLoss: Math.round(expectedLoss),
      tailLossIfDefault: Math.round(tailLoss),
      annualizedExpectedLoss: Math.round(expectedLoss / maturityYears),
      description: 'Émetteur ' + rating + ' sur ' + maturityYears + 'Y : ' +
                   'PD=' + (pd * 100).toFixed(2) + '% · ' +
                   'Perte espérée=' + Math.round(expectedLoss).toLocaleString('fr-FR') + '€ · ' +
                   'Tail loss=' + Math.round(tailLoss).toLocaleString('fr-FR') + '€',
      warning: pd > 0.05 ? 'ATTENTION : PD > 5%, diversification émetteur fortement recommandée' : null
    };
  };

  // ─── Calcul de concentration émetteur pour un portefeuille ──────
  window.calcPortfolioIssuerRisk = function(positions) {
    // positions = [{ issuer: 'CIC', rating: 'A+', nominal: 500000, maturity: 5 }, ...]
    if (!Array.isArray(positions)) return null;

    var byIssuer = {};
    var totalNominal = 0;
    var totalExpectedLoss = 0;

    positions.forEach(function(p) {
      var risk = window.calcIssuerRisk(p.rating, p.nominal, p.maturity);
      if (!byIssuer[p.issuer]) {
        byIssuer[p.issuer] = { nominal: 0, expectedLoss: 0, rating: p.rating };
      }
      byIssuer[p.issuer].nominal += p.nominal;
      byIssuer[p.issuer].expectedLoss += risk.expectedLoss;
      totalNominal += p.nominal;
      totalExpectedLoss += risk.expectedLoss;
    });

    var concentrations = Object.keys(byIssuer).map(function(issuer) {
      return {
        issuer: issuer,
        rating: byIssuer[issuer].rating,
        nominal: byIssuer[issuer].nominal,
        expectedLoss: byIssuer[issuer].expectedLoss,
        concentrationPct: totalNominal > 0 ? (byIssuer[issuer].nominal / totalNominal * 100) : 0
      };
    }).sort(function(a, b) { return b.concentrationPct - a.concentrationPct; });

    var maxConcentration = concentrations.length > 0 ? concentrations[0].concentrationPct : 0;
    var recommendations = [];
    if (maxConcentration > 60) {
      recommendations.push('⚠️ Concentration > 60% sur un seul émetteur — envisager diversification');
    }
    if (concentrations.length === 1 && totalNominal > 500000) {
      recommendations.push('💡 Un seul émetteur pour ' + (totalNominal / 1000000).toFixed(1) + 'M€ — pour >500K€, splitter sur 2 émetteurs différents réduit le risque');
    }

    return {
      totalNominal: totalNominal,
      totalExpectedLoss: totalExpectedLoss,
      expectedLossPct: totalNominal > 0 ? (totalExpectedLoss / totalNominal * 100) : 0,
      byIssuer: concentrations,
      recommendations: recommendations
    };
  };

  // ─── Exposer les tables pour consultation ──────
  window.CARRY_ISSUER_PD_TABLE = ISSUER_PD_TABLE;
  window.CARRY_RECOVERY_RATES = RECOVERY_RATES;

  // ─── Démo au démarrage (désactivable en commentant) ──────
  function _demo() {
    console.log('[IssuerRisk Patch] Exemples calculs avec 1M€ :');
    ['A+', 'A', 'A-', 'BBB+'].forEach(function(r) {
      var res = window.calcIssuerRisk(r, 1000000, 5);
      console.log('  ' + res.description);
    });
  }

  if (document.readyState !== 'loading') {
    _demo();
  } else {
    document.addEventListener('DOMContentLoaded', _demo);
  }

  console.log('[StructBoard] Issuer Risk Patch v1.0 loaded — use calcIssuerRisk(rating, nominal, years)');
})();

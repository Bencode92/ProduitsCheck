// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Patch Benchmark Carry Trade
// Remplace le benchmark CAT 2.50% par le coût d'emprunt 3.10% (+ marge).
//
// MOTIVATION :
//   Pour un carry trade, le vrai benchmark n'est PAS un CAT théorique :
//   c'est le coût de financement net d'impôt + prime de risque minimale.
//
//   Formule consensus :
//     seuil_break_even = taux_emprunt × (1 - IS)  = 3.10% × 0.75 = 2.325%
//     seuil_cible      = break_even + 50bp       = 2.825%
//
//   Tout produit < 2.675% de rendement attendu net ne devrait PAS être retenu
//   pour le carry trade, même s'il bat un CAT classique.
//
// CE PATCH :
//   - Expose window.calcCarryBenchmark(loanRate, taxRate, riskPremium)
//   - Expose window.evaluateCarrySpread(productYield, benchmarkYield) pour chaque produit
//   - Log un résumé au démarrage
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var DEFAULT_PARAMS = {
    loanRate: 0.031,         // 3.10% emprunt SG Equipéa
    taxRate: 0.25,            // IS 25%
    minRiskPremium: 0.005     // 50bp prime minimale pour couvrir risque émetteur + réinvestissement
  };

  window.calcCarryBenchmark = function(loanRate, taxRate, riskPremium) {
    loanRate = loanRate !== undefined ? loanRate : DEFAULT_PARAMS.loanRate;
    taxRate = taxRate !== undefined ? taxRate : DEFAULT_PARAMS.taxRate;
    riskPremium = riskPremium !== undefined ? riskPremium : DEFAULT_PARAMS.minRiskPremium;

    var breakEven = loanRate * (1 - taxRate);
    var target = breakEven + riskPremium;
    var stretchTarget = breakEven + 2 * riskPremium;  // objectif confortable

    return {
      loanRate: loanRate,
      taxRate: taxRate,
      riskPremium: riskPremium,
      breakEven: breakEven,
      target: target,
      stretchTarget: stretchTarget,
      description: 'Emprunt ' + (loanRate * 100).toFixed(2) + '% net IS → ' +
                   'break-even ' + (breakEven * 100).toFixed(2) + '% · ' +
                   'cible ' + (target * 100).toFixed(2) + '% · ' +
                   'confortable ' + (stretchTarget * 100).toFixed(2) + '%'
    };
  };

  window.evaluateCarrySpread = function(productYield, productProb, loanRate, taxRate) {
    productYield = Number(productYield) || 0;
    productProb = Number(productProb) || 1.0;
    loanRate = loanRate !== undefined ? loanRate : DEFAULT_PARAMS.loanRate;
    taxRate = taxRate !== undefined ? taxRate : DEFAULT_PARAMS.taxRate;

    var effectiveYield = productYield * productProb;
    var benchmark = window.calcCarryBenchmark(loanRate, taxRate);
    var spreadVsBreakEven = effectiveYield - benchmark.breakEven;
    var spreadVsTarget = effectiveYield - benchmark.target;

    var verdict;
    if (effectiveYield >= benchmark.stretchTarget) verdict = '✅ EXCELLENT — carry confortable';
    else if (effectiveYield >= benchmark.target) verdict = '✅ BON — carry décent';
    else if (effectiveYield >= benchmark.breakEven) verdict = '⚠️ MARGINAL — juste au-dessus du break-even';
    else verdict = '❌ REJETÉ — sous le break-even, carry négatif';

    return {
      productYield: productYield,
      productProb: productProb,
      effectiveYield: effectiveYield,
      benchmark: benchmark,
      spreadVsBreakEven: spreadVsBreakEven,
      spreadVsTarget: spreadVsTarget,
      verdict: verdict,
      description: 'Produit ' + (productYield * 100).toFixed(2) + '% × prob ' + (productProb * 100).toFixed(0) + '% = ' +
                   'rendement effectif ' + (effectiveYield * 100).toFixed(2) + '% · ' +
                   'spread vs break-even +' + (spreadVsBreakEven * 100).toFixed(2) + '% · ' + verdict
    };
  };

  // ─── Démo au démarrage ──────
  function _demo() {
    var bench = window.calcCarryBenchmark();
    console.log('[Benchmark Patch] ' + bench.description);
    console.log('[Benchmark Patch] Exemples évaluation :');

    // Utilise les probas consensus si disponibles
    var probs = window.CARRY_CONSENSUS_PROBS || {
      cat_tarn5: 0.78, cat_digital: 0.88, cat_range: 0.85, cat_floater: 0.95
    };

    [
      { name: 'TARN TEC10 8%', yield: 0.08, prob: probs.cat_tarn5 },
      { name: 'Digital Mémoire 7%', yield: 0.07, prob: probs.cat_digital },
      { name: 'Range Accrual 7.5%', yield: 0.075, prob: probs.cat_range },
      { name: 'Floater TEC10 3.80%', yield: 0.038, prob: probs.cat_floater },
      { name: 'Fixe Callable 5.10%', yield: 0.051, prob: 1.0 }
    ].forEach(function(p) {
      var ev = window.evaluateCarrySpread(p.yield, p.prob);
      console.log('  ' + p.name + ' → ' + ev.verdict + ' (effectif ' + (ev.effectiveYield * 100).toFixed(2) + '%)');
    });
  }

  if (document.readyState !== 'loading') {
    _demo();
  } else {
    document.addEventListener('DOMContentLoaded', _demo);
  }

  console.log('[StructBoard] Benchmark Patch v1.0 loaded — use calcCarryBenchmark() / evaluateCarrySpread()');
})();

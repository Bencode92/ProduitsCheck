# Patches Calibration Carry Trade

**Date** : 2026-04-16
**Version** : 1.0
**Source** : Consensus Claude Opus + Claude Code après revue expert

## Contexte

Trois patches non intrusifs ajoutés au simulateur Carry Trade pour corriger les défauts identifiés lors de la revue méthodologique :

1. **conditionProb recalibrées** — les probas hardcodées (0.78 TARN, 0.85 Range...) étaient trop pessimistes
2. **Risque émetteur** — pas pris en compte dans le P&L original
3. **Benchmark carry trade** — 2.50% CAT remplacé par coût emprunt 2.90%

## Fichiers ajoutés

| Fichier | Rôle | Effort déploiement |
|---------|------|-------------------|
| `js/carry-simulator-conditionprob-patch.js` | Probas consensus au lieu des valeurs figées | Ajouter `<script>` dans index.html |
| `js/carry-simulator-issuer-risk-patch.js` | Helpers calcul risque émetteur (PD × LGD) | Ajouter `<script>` + intégration UI optionnelle |
| `js/carry-simulator-benchmark-patch.js` | Benchmark carry = coût emprunt net IS | Ajouter `<script>` |

## Activation

Ajouter dans `index.html` APRÈS la ligne `carry-simulator.js` :

```html
<script src="js/carry-simulator.js?v=20260416v8"></script>
<!-- Patches calibration v1.0 -->
<script src="js/carry-simulator-conditionprob-patch.js?v=20260416"></script>
<script src="js/carry-simulator-issuer-risk-patch.js?v=20260416"></script>
<script src="js/carry-simulator-benchmark-patch.js?v=20260416"></script>
```

Les patches ne modifient PAS `carry-simulator.js`. Retirer un `<script>` = désactiver ce patch.

## Table des probas consensus

| Produit | Avant | Vasicek pur | Consensus | Justification |
|---------|-------|-------------|-----------|---------------|
| TARN TEC10 5Y | 0.78 | ~1.00 | **0.90** | Marge 130bp au trigger, 1Y garanti |
| TARN TEC10 10Y | 0.78 | ~1.00 | **0.88** | Même trigger, plus long = plus d'incertitude |
| Digital Mémoire | 0.88 | ~0.95 | **0.93** | Trigger 4.50% + effet mémoire |
| Hybride Plancher | 0.90 | ~1.00 | **0.93** | Plancher 3% garanti |
| Range Accrual | 0.85 | ~1.00 | **0.82** | Euribor plus réactif que TEC10 |
| Floater TEC10 | 0.95 | ~1.00 | **0.97** | Plancher quasi-sûr |
| CMS Steepener | 0.80 | N/A | **0.75** | Pari directionnel, plus risqué |
| Fixe Callable | 1.00 | 1.00 | **1.00** | Garanti par construction |

**Impact concret** : sur un TARN 500K€ à 8%, passer de 0.78 à 0.90 change le revenu espéré de +4 800€/an → +24 000€ sur 5 ans.

## Utilisation des helpers

### Risque émetteur

```javascript
// Pour un produit seul
var risk = calcIssuerRisk('A+', 1000000, 5);
// → { probDefault: 0.012, expectedLoss: 7200, tailLossIfDefault: 600000, ... }

// Pour un portefeuille complet
var portfolio = calcPortfolioIssuerRisk([
  { issuer: 'CIC', rating: 'A+', nominal: 500000, maturity: 5 },
  { issuer: 'SG', rating: 'A', nominal: 500000, maturity: 5 }
]);
// → totalExpectedLoss, byIssuer, recommendations
```

### Benchmark carry

```javascript
var bench = calcCarryBenchmark(0.029, 0.25, 0.005);
// → { breakEven: 0.02175, target: 0.02675, ... }

var eval = evaluateCarrySpread(0.08, 0.90);  // TARN 8% × prob 90%
// → { effectiveYield: 0.072, verdict: '✅ EXCELLENT — carry confortable' }
```

## Révision

Ces probas sont à réviser tous les **6 mois** ou si :
- Changement de régime macro (hausse BCE brutale, récession)
- Vol TEC10 dépasse durablement 30bp/an
- Spread 2s10s inverse (récession signal)

**Prochaine revue prévue** : 2026-10-16

## À faire (non inclus dans ces patches)

- [ ] Intégration UI du risque émetteur dans `_renderResult` (ligne P&L dédiée)
- [ ] Autocall + réinvestissement dans la simulation
- [ ] `r` dynamique depuis `rates.json`
- [ ] Vérifier clause "memory catch-up at maturity" dans les term sheets

## Audit trail

Les patches logguent dans la console :
- `[ConditionProb Patch]` — valeurs appliquées
- `[IssuerRisk Patch]` — exemples calculés
- `[Benchmark Patch]` — évaluation de chaque produit du catalogue

Ouvrir DevTools > Console pour voir.

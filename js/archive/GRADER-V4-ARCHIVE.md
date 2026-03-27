# Grader v4.x — Archive

Ces 14 fichiers ont été consolidés dans `js/proposal-grader-v5.js` le 27/03/2026.

Ils ne sont plus chargés par `index.html` mais restent dans le repo pour référence.
Tout est dans l'historique Git si besoin de rollback.

## Fichiers consolidés

| Fichier | Version | Rôle principal |
|---|---|---|
| `proposal-grader.js` | v4.3 | Base scoring, UI, orchestrator |
| `grader-accuracy-patch.js` | v1.1 | Coupon sanity, décrément, payment timing, step-down, P4 lock-up |
| `grader-mi-patch.js` | v1.0 | Opus model, MI loading, MI prompt injection |
| `grader-p2-patch.js` | v1.1 | Index/commodity proxy via underlying-map + Twelve Data |
| `grader-v5-patch.js` | v5.0 | Barrier recal, beta non-linear, MI sensitivity, issuer rating |
| `grader-v5b-patch.js` | v5.0b | P3 correlation, confidence interval, VIX vol implicite |
| `grader-v5c-patch.js` | v5.0c | P1 log saturation, P4 expected return, coupon/loss prob |
| `grader-v6-sigma-patch.js` | v6.0 | Barrier σ, liquidity L1-L4, P2 indices refonte |
| `grader-rates-patch.js` | v1.1 | Taux fixe P1/P2/P4, yield curve, ECB rates |
| `grader-bugfix-patch.js` | v1.0 | barrier=0 default, model fallback |
| `grader-data-fix.js` | v5.1 | Buffett fallback, fuzzy alias, sector corr, prob_call 45% |
| `grader-structure-patch.js` | v1.2 | Dispersion/taux_fixe/capital_garanti prompts |
| `grader-p1p2-structure-override.js` | v1.1 | Normalize + P2 for dispersion |
| `grader-ui-patch.js` | - | UI overrides (peut encore être nécessaire séparément) |

## Fichier consolidé

`js/proposal-grader-v5.js` (62KB, ~1200 lignes)

## Architecture v5

```
Pipeline linéaire (plus de setInterval):
  NORMALIZE → COLLECT → TYPE → SCORE → ENRICH → AI → FINALIZE

Dispatch par type:
  _computeP1(p, type) → _p1Auto | _p1Disp | _p1Rate
  _computeP2(p, market, type) → _p2Auto | _p2Index | _p2Disp | _p2Rate
  _computeP4(p, catRate, type) → _p4Auto | _p4Rate
```

## Pour supprimer les anciens fichiers

Ces fichiers dans `js/` peuvent être supprimés manuellement :
```
proposal-grader.js
grader-accuracy-patch.js
grader-mi-patch.js
grader-p2-patch.js
grader-v5-patch.js
grader-v5b-patch.js
grader-v5c-patch.js
grader-v6-sigma-patch.js
grader-rates-patch.js
grader-bugfix-patch.js
grader-data-fix.js
grader-structure-patch.js
grader-p1p2-structure-override.js
js/staging/ (dossier entier)
```

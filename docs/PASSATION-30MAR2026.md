# STRUCTBOARD — Document de Passation Complète
## Session du 30 mars 2026 — État final du projet

---

## 1. PROJET

- **Repo**: `github.com/Bencode92/ProduitsCheck`
- **Site**: `bencode92.github.io/ProduitsCheck/`
- **Stack**: Vanilla JS (GitHub Pages), données marché via GitHub Actions (Python), IA grading via API Claude Opus
- **Transcripts précédents**: `/mnt/transcripts/2026-03-30-*.txt`

---

## 2. ARCHITECTURE — Fichiers clés et ordre de chargement

### index.html — ordre de chargement des scripts (CRITIQUE)
```
config.js → github.js → pdf.js (v79) → pdf-capgaranti-fix.js → scoring.js →
cat.js → cat-ai.js → app.js → ui.js → product-mechanism-patch.js →
tracking.js → archive.js → edit-modal.js (v19) → strike-capture-patch.js →
proposal-ai.js → deep-analysis.js →

[Grader chain:]
proposal-grader-v5.js (v52) → grader-freq-fix (v71) → grader-sprint1-patch →
grader-sprint2-patch → grader-mi-patch → grader-p1p2-structure-override →
grader-dispersion-patch → grader-basket-fix (v11) → basket-detection-v2 (v23) →

[UI + Optimizer:]
maturity-display-fix → ui-patches → cat-patches → cat-optimizer →
cat-objectives-patch → cat-scanner → proposal-patches → grader-ui-patch →
structured-optimizer → optimizer-v2/v3/v4 patches → dashboard-buttons →
liquidites-fix → analytics
```

### Noms des clés pilier dans le grader (SOURCE DE BUGS RÉCURRENTS)
```
P1 = result.pillars.adjustedReturn       (PAS couponAndCapital)
P2 = result.pillars.underlyingQuality
P3 = result.pillars.portfolioFit
P4 = result.pillars.riskPremium           (PAS primeVsCat)
```

### Chaîne de wrapping grade()
```
basket-fix.grade() [outermost, fire à 100%]
  → basket-detection-v2.grade() [NE FIRE PAS — conflit wrapping]
    → sprint2.grade()
      → sprint1.grade()
        → v5.grade() [base]
```
**Leçon critique** : Ne JAMAIS wrapper `_computeP1` ou `_computeP2` — le grader v5 utilise des closures internes, pas les globales `window._computeP1`. Tout fix doit se faire dans le post-processing de `grade()`.

---

## 3. PDF PARSER — V7.9

**Fichier**: `js/pdf.js` (cache-bust v=79)

### Règles du prompt IA (25 règles)
| # | Règle | Ajoutée en |
|---|---|---|
| 1-12 | Règles de base (coupon, autocall, décrément, step-down...) | V7.0-V7.6 |
| 13 | Coupon PAR PÉRIODE — "3.50% par semestre" → rate=3.50, PAS 7% | V7.7 |
| 14 | DOUBLE COUPON — rateIfCalled vs rateIfMaturity | V7.7 |
| 15-20 | Double barrière, barrier inversion, panier vs worst-of | V7.3-V7.6 |
| 21 | Panier équipondéré → structureType="basket" | V7.8 |
| **22** | **Callable au gré de l'émetteur → type="callable", PAS autocall** | **V7.9** |
| **23** | **Coupon cumulatif — "X% × nombre de semestres" → rate=X, PAS X×N** | **V7.9** |
| **24** | **Step-down start différé — "dès le semestre 4" → startSemester=4** | **V7.9** |
| **25** | **Produit sans sous-jacent → underlyings=[], underlyingType="none"** | **V7.9** |

### Post-processing V7.9
- Callable detection rawText: "à la discrétion" → force callable (sauf si "automatiquement activé")
- Cumulative coupon fix: si rate > 12% → cherche "X% par semestre/année" dans rawText → corrige
- Frequency fix: si IA dit "annuel" mais rawText contient "semestriel" → corrige
- Step-down start: regex "dès le semestre N"
- Capital garanti renforcé: "protection totale du capital"

### BUG CONNU — False positive capital garanti (V7.9.1)
**Fichier**: `js/pdf-capgaranti-fix.js` (chargé dans index.html après pdf.js)

La V7.9 a ajouté `txtLower.indexOf('100% du capital initial')` comme détection capital garanti. MAIS cette phrase apparaît dans TOUS les autocalls ("l'investisseur reçoit 100% du Capital Initial + coupon"). Le fix `pdf-capgaranti-fix.js` vérifie:
1. "Protection du capital : Non" dans le rawText → force `protected=false`
2. Si `capitalProtection.barrier` existe et < 100% → PAS capital garanti

---

## 4. GRADER — Système de patches

### Grader v5 (base) — `proposal-grader-v5.js`
- 4 piliers: P1 Rendement (30%), P2 Sous-jacent (25%), P3 Fit portfolio (20%), P4 Prime/CAT (25%)
- Grade: A ≥75, B ≥60, C ≥45, D ≥25, F <25
- Utilise Claude Opus pour l'analyse IA (+/- 5pts par pilier)

### Sprint 1 — `grader-sprint1-patch.js`
- Black-Scholes probabilités dans P1 (coupon prob, loss prob)

### Sprint 2 — `grader-sprint2-patch.js`
- Illiquidity premium dans P4 (pénalité maturité longue)

### MI Patch — `grader-mi-patch.js`
- Injecte Market Intelligence dans le prompt Claude (stagflation, VIX, secteurs)

### P1P2 Structure Override — `grader-p1p2-structure-override.js`
- Normalize fix pour dispersion/capital_garanti/taux_fixe

### Dispersion Patch — `grader-dispersion-patch.js`
- P1/P2 spécialisé dispersion

### Basket Fix V1.1 — `grader-basket-fix.js` (v=11)
**Bug 1**: Panier équipondéré traité comme worst-of → fix normalize + probs
**Bug 2**: P4=0 pour capital garanti → fix spread calc
**Bug 3 (V1.1)**: P1 worst-stock vol pour baskets → P1 boost post-grade

```
_fixBasketP1() formula:
  volReduction = sqrt((1 + (n-1) × 0.50) / n) ≈ 0.79 pour 4 stocks
  volBoost = (1 - volReduction) × 85 ≈ 18pts
  worstOfPenaltyReversal = 3 × (n-2)^1.3 ≈ 7pts pour n=4
  Total boost ~25pts, cap 30, max P1=75
```

### Basket Detection V2.3 — `basket-detection-v2.js` (v=23)
- Enhanced basket keywords detection
- P2 override avec metrics moyennes basket
- **V2.3**: Supprimé `_patchBasketP1()` (crashait SyntaxError) — boost P1 dans basket-fix

---

## 5. EDIT MODAL V1.9 — Import JSON

**Fichier**: `js/edit-modal.js` (v=19)

### Bouton "📋 Coller JSON (depuis l'analyseur)"
- Ouvre textarea dans le modal
- L'utilisateur colle le JSON de l'artifact analyseur
- `handleJSONImport()` pré-remplit tous les champs du formulaire
- Injecte aussi les données cachées: decrementPct, actualDividendYield, startSemester, stepDown, rateIfCalled, underlyingType
- Stocke le JSON complet dans `p.aiParsed`

---

## 6. ARTIFACT ANALYSEUR DE BROCHURE

**Fichier artifact**: `structboard-brochure-parser.jsx` (React, à mettre en projet Claude)

### Workflow
1. Upload PDF (drag & drop) → base64
2. Claude Sonnet analyse via API `/v1/messages` avec document PDF
3. Formulaire de review (Identité, Sous-jacents, Coupon, Protection, Remboursement, Mécanisme)
4. "📤 Générer JSON" → format exact StructBoard → "📋 Copier"
5. Coller dans StructBoard via "Modifier infos" > "📋 Coller JSON"

### Format de sortie JSON
```json
{
  "name": "", "structureType": "", "emitter": "", "guarantor": "",
  "guarantorRating": {"moodys": "", "sp": ""},
  "underlyings": [], "underlyingType": "",
  "currency": "EUR", "maturity": "", "maturityYears": 0,
  "coupon": { "rate": 0, "rateIfCalled": null, "rateIfMaturity": null,
    "type": "", "frequency": "", "trigger": null, "memory": false, "paymentTiming": "" },
  "participationRate": null,
  "capitalProtection": { "protected": false, "level": null, "barrier": null,
    "barrierCoupon": null, "barrierType": "europeenne" },
  "earlyRedemption": { "possible": false, "type": "", "trigger": null,
    "frequency": "", "startSemester": null, "stepDown": false, "stepDownPct": null },
  "decrementPct": null, "actualDividendYield": null,
  "mechanism": "", "risks": [], "summary": ""
}
```

---

## 7. ANALYSE EXPERT — 8 Produits testés

### Swiss Life (4 produits)
| Produit | Expert | StructBoard | Statut |
|---|---|---|---|
| ATHENA Intesa Sanpaolo | B+ 67 | B 66 | ✅ |
| Phoenix Richemont | B 66 | B 62 | ✅ |
| OBJECTIF Mai 2026 (basket) | B 63 | B 63 | ✅ Fixé |
| OXYGENE Objectif (basket) | B- 57 | B 63 | ✅ Fixé |

### Société Générale (3 produits)
| Produit | Expert | StructBoard | Analyse |
|---|---|---|---|
| Solution Court Terme Boostée (dispersion) | A- 72 | B 65 | SB sévère, ne capture pas "vol = ami" |
| Note Taux Fixe Callable | B+ 69 | C 54 | **SB a raison** (lock-up 10 ans) |
| Athena Gold Miners Décrément | C+ 54 | A 79 ❌ | **Faux positif cap garanti** — fix écrit |

---

## 8. TODO PROCHAINE SESSION

### Critiques
- [ ] Tester artifact analyseur avec les 3 PDFs SocGen
- [ ] Tester bouton "📋 Coller JSON" dans StructBoard
- [ ] Re-tester Gold Miners après fix capital garanti → devrait → C+ ~55
- [ ] Re-tester Taux Fixe Callable avec V7.9 → devrait → taux_fixe/callable

### Importants
- [ ] Pénalité décrément dans le grader (delta div réel vs prélèvement)
- [ ] Activer `grader-rates-patch.js` pour taux fixe scoring
- [ ] Rendement espéré (prob × coupon) dans l'optimizer
- [ ] Distance-à-la-barrière temps réel dans le dashboard

### Architecture
- [ ] Remplacer pdf.js auto-parsing par workflow artifact → JSON paste
- [ ] Consolider les 6+ patches grader en 2-3 fichiers
- [ ] Supprimer ou merger basket-detection-v2 grade() wrapper (ne fire pas)

---

## 9. PIÈGES CONNUS

1. **Noms de clés pilier**: `adjustedReturn` (PAS couponAndCapital), `riskPremium` (PAS primeVsCat)
2. **Wrapper _computeP1**: closures internes → faire les ajustements dans post-processing grade()
3. **False positive capital garanti**: "100% du Capital Initial" ≠ protection
4. **Coupon cumulatif**: "4.50% par semestre écoulé" = rate 4.50, PAS 4.5 × N
5. **Callable vs Autocall**: "au gré de l'émetteur" ≠ trigger de marché
6. **Cache-bust**: toujours mettre à jour `?v=XX` dans index.html après modification JS

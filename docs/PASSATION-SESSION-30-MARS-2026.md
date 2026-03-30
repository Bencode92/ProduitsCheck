# STRUCTBOARD — Passation Session 30 Mars 2026

## Repo & Accès
- **Repo**: `github.com/Bencode92/ProduitsCheck` (branch: main)
- **Site live**: `bencode92.github.io/ProduitsCheck/`
- **Stack**: Vanilla JS (GitHub Pages), proxy Cloudflare `CONFIG.AI_ENDPOINT`, Claude API
- **Grading**: Claude Sonnet via proxy → 4 piliers (P1 Rendement 30%, P2 Sous-jacent 25%, P3 Fit portfolio 20%, P4 Prime/CAT 25%)

---

## CE QUI A ÉTÉ FAIT CETTE SESSION (15 commits)

### 1. Brochure Parser v1.0 → v1.4 (`js/brochure-parser.js`)
Onglet "📄 Analyseur" intégré dans StructBoard. Upload PDF → Claude Sonnet analyse → formulaire review → ajout direct.

**29 règles de post-processing couvrant :**
- v1.1: Normalisation `underlyingType` ("indice"→"single-index", etc.)
- v1.2: Fix `[object Object]` dans underlyings — `_normalizeStringArray()` extrait `.name` des objets
- v1.3: Fix `capital_garanti` detection (capital garanti + no autocall ≠ autocall) + coupon avec trigger = "conditionnel" pas "fixe"
- v1.4: Inférence `barrierCoupon` depuis trigger autocall + `paymentTiming` "periodic" pour autocalls

**Prompt enrichi avec sections :** STRUCTURE TYPE, COUPON TYPE, PAYMENT TIMING, BARRIÈRE COUPON, AUTOCALL vs OBSERVATIONS

### 2. Edit Modal v2.0 (`js/edit-modal.js?v=20`)
5 sections avec headers colorés:
- 🏷️ Identité (nom, structure, enveloppe, montant, maturité, strike, sous-jacents)
- 💰 Coupon (rate, type, fréquence, mémoire)
- 🛡️ Protection Capital (barrière capital, barrière coupon digitale, protection)
- ⏰ Remboursement Anticipé (type autocall/callable, trigger, fréquence, start semester, step-down, step-down %)
- 📉 Décrément (décrément %/an, div réel %/an, drag calculé en rouge)

### 3. Grader Annualize Patch v2.0 (`js/grader-annualize-patch.js?v=2`)
**Root cause**: edit-modal sauve rate=4.5 (per-period), freq-fix voit `_freqFixApplied=true` et skip → grader utilise 4.5% au lieu de 9%.
**Fix**: wraps outermost `grade()`, FORCE `coupon.rate = annual` AVANT grading, RESTORE après. Pas de flags.

Fournit `window.getAnnualizedRate(product)` et `window.getFrequencyMultiplier(product)` globaux.

### 4. Grader Decrement Patch v1.0 (`js/grader-decrement-patch.js?v=1`)
P1 pénalité: ~4pts par % de drag (cap 25). Gold Miners: -16pts
P4 pénalité: ~5pts par % de drag (cap 30). Gold Miners: -20pts
Calcul: spread réel = coupon annualisé - drag - CAT

### 5. Grader Trigger Penalty Patch v1.0 (`js/grader-trigger-penalty-patch.js?v=1`)
- Trigger coupon ≥100%: -10pts P1 (×1.8 si worst-of = -18pts)
- Trigger 95%: -4pts
- Maturité ≥10 ans: -2pts/an au-delà de 7
- Cap garanti + trigger 100%: -5pts extra

### 6. Grader Dispersion Boost Patch v1.0 (`js/grader-dispersion-boost-patch.js?v=1`)
- P4 +15pts (vol = moteur de rendement)
- P4 +10pts extra si capital garanti
- P1 +10pts si dispersion + cap garanti (rendement mécanique)

---

## TESTS SUR 9 PDFs — RÉSULTATS

| # | Produit | Émetteur | Structure | Parsing | Grade |
|---|---------|----------|-----------|---------|-------|
| 1 | Gold Miners | SocGen | Autocall décrément | 10/10 | B 60 |
| 2 | Solution Court Terme | SocGen | Dispersion | 9/10 | B 61 → ~B+ 72 (après boost) |
| 3 | Digitale WO LVMH | CIC | Capital garanti WO | 10/10 | A 79 → ~B 67 (après penalty) |
| 4 | Euro Stoxx Banks | CIC | Autocall classique | 10/10 | B 65 |
| 5 | Intesa Sanpaolo | Swiss Life/GS | Autocall cap garanti | 10/10 | A 75 → ~B 67 (après penalty) |
| 6 | Objectif Mai 2026 | Swiss Life/GS | Autocall basket | 10/10 | B 72 |
| 7 | Oxygene Objectif | Swiss Life/Barclays | Autocall basket | 10/10 | B 65 |
| 8 | Phoenix Richemont | Swiss Life/HSBC | Phoenix mémoire | 10/10 | B 60 |

---

## CLASSEMENT CIBLE EXPERT (ce qu'on vise)

| Rang | Produit | Grade cible | Pourquoi |
|------|---------|-------------|----------|
| 1 | Solution Court Terme | B+ 72 | Cap garanti + rendement quasi-certain via dispersion |
| 2 | Objectif Mai 2026 | B 68 | Basket diversifié, coupon 9.7%, trigger 95% accessible |
| 3 | Oxygene Objectif | B 65 | Basket, coupon plus bas (7%) |
| 4 | Digitale WO LVMH | B 65 | Cap garanti MAIS rendement probable = 0% (trigger 100% WO) |
| 5 | Euro Stoxx Banks | B 63 | Secteur bancaire risqué mais coupon 9.7% |
| 6 | Intesa Sanpaolo | B 62 | Cap garanti mais 10 ans, single-stock bancaire |
| 7 | Gold Miners | C+ 55 | Drag décrément 4%/an mange le rendement |
| 8 | Phoenix Richemont | C+ 55 | Luxe en stagflation, DD -33%, barrière proche |

---

## CHAÎNE DE WRAPPING GRADER (ordre de chargement)

```
proposal-grader-v5.js    → Base grader (Claude AI prompt)
grader-freq-fix.js       → Pré-annualisation (souvent skippé)
grader-sprint1-patch.js  → Ajustements P1/P2
grader-sprint2-patch.js  → Ajustements P3/P4
grader-mi-patch.js       → Market intelligence
grader-p1p2-structure-override.js → Override par structure
grader-dispersion-patch.js → Ancien patch dispersion (peu efficace)
grader-basket-fix.js     → Basket detection
basket-detection-v2.js   → Basket v2 wrapping
--- fichiers outermost (chargés en dernier dans index.html) ---
grader-annualize-patch.js    → FORCE annualisation avant grading
grader-decrement-patch.js    → Pénalité drag décrément P1/P4
grader-trigger-penalty-patch.js → Pénalité trigger élevé P1
grader-dispersion-boost-patch.js → Boost dispersion P1/P4
```

**IMPORTANT**: Les fichiers chargés en DERNIER wrappent grade() en PREMIER (outermost). L'ordre dans index.html compte.

---

## ITEMS PENDING — PROCHAINE SESSION

### Priorité 1 — Grading (vital)
- [ ] **Valider les 2 nouveaux patchs** (trigger-penalty + dispersion-boost) sur les 9 produits
- [ ] **Comparer le classement résultant** avec le classement cible expert ci-dessus
- [ ] **Ajuster les coefficients** si les pénalités/boosts sont trop forts ou trop faibles
- [ ] **Seuil grade B**: 60 vs 55 — le doc passation mentionne que 55 serait plus permissif
- [ ] **P3 trop haut** pour tous les produits (~75-90) — pas assez discriminant
- [ ] **Rendement espéré** (prob × coupon) dans P1 — actuellement le grader ne pondère pas par la probabilité

### Priorité 2 — Grading avancé
- [ ] **Phoenix à mémoire**: P1 devrait valoriser l'effet mémoire (rattrapage des coupons perdus)
- [ ] **Basket vs Worst-of**: le grader traite parfois les baskets comme des worst-of
- [ ] **grader-rates-patch.js** existe mais PAS activé dans index.html — vérifier s'il est utile
- [ ] **basket-detection-v2.js** grade() wrapper ne fire pas dans certains cas (conflit wrapping)

### Priorité 3 — Optimizer
- [ ] **Rendement espéré** (prob × coupon) dans l'optimizer
- [ ] **Distance-à-la-barrière** temps réel dans le dashboard
- [ ] **Comparaison multi-produits** côte à côte

### Priorité 4 — Nettoyage
- [ ] Nettoyer les **14+ fichiers orphelins** dans js/ (anciens patchs obsolètes)
- [ ] Consolider les patchs grader en un seul fichier `grader-v6.js`
- [ ] Tests automatisés: JSON fixtures pour les 9 PDFs testés

---

## ARCHITECTURE CLÉS

### Fichiers critiques
```
js/proposal-grader-v5.js     — Grader principal (Claude AI prompt)
js/brochure-parser.js        — Analyseur PDF v1.4 (29 règles)
js/edit-modal.js             — Modal édition v2.0 (5 sections)
js/grader-annualize-patch.js — Fix annualisation coupon
js/grader-decrement-patch.js — Pénalité décrément
js/grader-trigger-penalty-patch.js — Pénalité trigger élevé
js/grader-dispersion-boost-patch.js — Boost dispersion
js/ui.js                     — Interface principale + bouton JSON
index.html                   — Ordre de chargement des scripts
```

### Pièges connus
1. **Ordre de chargement**: Les patchs dans index.html sont chargés séquentiellement. Le DERNIER chargé wrappe grade() en PREMIER (outermost). Si un patch est chargé avant un autre, il peut être "enveloppé" et ses fixes écrasés.
2. **_freqFixApplied flag**: Le freq-fix v7.1 met un flag qui empêche la ré-annualisation. Le annualize-patch v2.0 contourne ça en forçant/restaurant.
3. **coupon.rate mutation**: L'edit-modal sauve le taux per-period (4.5), pas l'annualisé (9). Le annualize-patch force l'annualisation avant chaque grading.
4. **Cache-bust**: index.html utilise `?v=XX` pour forcer le rechargement. Toujours incrementer après chaque modif.
5. **GitHub Pages delay**: 1-2 min entre push et déploiement.

---

## PROMPT POUR LA PROCHAINE SESSION

```
Je travaille sur StructBoard (github.com/Bencode92/ProduitsCheck).
C'est un outil de grading de produits structurés financiers.

Lis le document de passation dans docs/PASSATION-SESSION-30-MARS-2026.md 
pour comprendre l'architecture, les fichiers clés, et les pièges connus.

Priorités de cette session :
1. Valider les 2 nouveaux patchs grader (trigger-penalty + dispersion-boost)
   en re-gradant les 9 produits et comparer au classement cible expert
2. Ajuster les coefficients si nécessaire
3. [AJOUTER ICI LA PRIORITÉ SPÉCIFIQUE]

Règle d'or : ne JAMAIS modifier un fichier sans lire sa version actuelle d'abord.
Toujours incrémenter le cache-bust dans index.html après chaque modif.
```

---

*Document généré le 30 mars 2026 — Session complète: 15 commits, 9 PDFs testés, 4 patchs grader créés*

# StructBoard — LLM Handoff Document
## Date: 27 mars 2026 | Session: Consolidation Grader v5.1

---

## 1. PROJET

**Repo:** `github.com/Bencode92/ProduitsCheck`
**Site:** `bencode92.github.io/ProduitsCheck/`
**Stack:** Vanilla JS (pas de framework), GitHub Pages, Claude API (Opus/Sonnet)
**Objectif:** Dashboard d'analyse de produits structurés financiers avec grading IA hybride

---

## 2. ARCHITECTURE ACTUELLE

### Fichiers principaux

| Fichier | Rôle | Version |
|---|---|---|
| `index.html` | Point d'entrée, charge tous les scripts | Mis à jour 27/03 |
| `js/config.js` | API endpoints, modèles Claude, constantes | - |
| `js/github.js` | Lecture/écriture fichiers GitHub via API | - |
| `js/pdf.js` | Extraction PDF + parsing IA (Claude Sonnet) | V7.2 |
| `js/app.js` | State management, navigation, import produits | V2.3 |
| `js/ui.js` | Rendu HTML dashboard, fiches produit | - |
| `js/proposal-grader-v5.js` | **GRADER CONSOLIDÉ** — scoring + IA + UI | **V5.1** |
| `js/product-mechanism-patch.js` | Explication visuelle du mécanisme produit | V1.1 |
| `js/edit-modal.js` | Modal édition manuelle des champs produit | V1.5 |
| `js/structured-optimizer.js` | Optimiseur portefeuille structuré | - |
| `js/analytics.js` | Dashboard analytique portefeuille | - |

### Données marché (GitHub JSON, mis à jour par workflows)

```
data/market/
  stocks_europe.json    — 40+ actions EU (prix, vol, DD, beta, Buffett, Quality)
  stocks_us.json        — 40+ actions US
  markets.json          — Indices mondiaux (perf YTD, 3M, 52W)
  index.json            — Market Intelligence (régime macro, VIX, Brent, secteurs)
  rates.json            — Taux ECB, yield curve, OAT 2Y/5Y/10Y
  underlyings_extra.json — Métriques Twelve Data (vol 3Y, DD, beta pour proxies)
data/underlying-map.json — Mapping noms → tickers proxy (indices, commodities)
data/cat-market-rates.json — Taux CAT marché
```

---

## 3. GRADER v5.1 — COMMENT ÇA MARCHE

### Pipeline (séquentiel, déterministe)

```
1. NORMALIZE    — Extrait/normalise les champs du produit
                  Dispatch par structureType: autocall|dispersion|taux_fixe|capital_garanti
                  Détecte: décrément, step-down, payment-at-maturity, barrierCoupon

2. COLLECT      — Charge en parallèle: stocks, MI, rates, underlying-map, CAT benchmark
                  Résout les sous-jacents (actions directes, proxy indices, proxy commodities)

3. TYPE DETECT  — autocall | dispersion | taux_fixe | capital_garanti | rate

4. SCORE        — P1 (rendement), P2 (qualité SJ), P3 (fit PF), P4 (prime vs CAT)
                  Chaque Px a des variantes par type:
                  _p1Auto, _p1Disp, _p1Rate, _p1CapGaranti
                  _p2Auto, _p2Index, _p2Disp, _p2Rate
                  _p4Auto, _p4Rate

5. ENRICH       — Barrier σ, liquidité L1-L4, confidence interval, issuer rating

6. AI ADJUST    — Claude Opus ajuste ±15 pts/pilier (±2 si capital protégé)
                  MI sensitivity cap: protected×0.3, garanti×0.5, long mat×factor

7. FINALIZE     — Grade lettre, metadata, scénarios, risques clés
```

### Types de produits supportés

| Type | Dispatch | Particularités |
|---|---|---|
| `autocall` | Standard worst-of avec barrière capital | Barrier ((b-30)/50)^2, beta non-linear |
| `dispersion` | Perf relative, capital garanti | worstOf=false, vol=bonus, coupon=median/maturity |
| `taux_fixe` | Obligation callable | Yield curve ECB, duration risk, pas de SJ action |
| `capital_garanti` | Capital 100% + coupon conditionnel | **v5.1**: barrierCoupon scoring, prob-weighted P1 |
| `rate` | Indexé taux (TEC, CMS, Euribor) | Idem taux_fixe |

### Formules clés

**P1 autocall (coupon log saturation):**
```
if coupon ≤ 8%: score = coupon × 10
if coupon > 8%: score = 80 + 20 × ln(coupon/8) / ln(3)
Penalty barrière: score × (1 - ((barrier-30)/50)^2)
```

**P1 capital_garanti (v5.1, probability-weighted):**
```
probPerDate = max(0.20, min(0.90, 1.0 - (barrierCoupon-40) × 0.01))
if worst-of: probPerDate = probPerDate ^ √(n_underlyings)
if memory: probTotal = prob×0.4 + (1 - (1-prob)^maturity) × 0.6
expectedCoupon = coupon × probTotal
score = expectedCoupon × 10 + 10 (capital bonus) + 5 (short mat)
```

**P2 indices (v6 refonte):**
```
50% vol/DD quality + 30% momentum×conviction + 20% distance σ barrière
conviction = 1 / (1 + vol/25)  — high vol reduces momentum impact
```

**P4 expected return:**
```
expected = coupon × P(coupon) - avgLoss × P(loss) / maturity
effective_spread = expected - CAT - illiquidity_premium
```

**MI sensitivity:**
```
sens = 1.0
if capitalProtection: sens × 0.3
if couponType garanti/fixe: sens × 0.5
if maturity > 5Y: sens × max(0.2, 1 - mat/15)
max_IA_adjustment = 15 × sens
```

---

## 4. CE QUI A ÉTÉ FAIT AUJOURD'HUI (27/03/2026)

### Consolidation v5.0 → v5.1
- 13 patch files fusionnés en 1 seul `proposal-grader-v5.js` (65KB)
- Élimine tous les `setInterval` / timing races / override chains
- Pipeline déterministe séquentiel
- Testé sur 4 produits: Dispersion B(65), Gold Miners B(64), Taux Fixe C(45), Digitale WO B(74→fix)

### Fix v5.1: barrierCoupon
- Nouveau type scoring `_p1CapGaranti` pour digitales capital garanti avec coupon conditionnel
- `_estimateCouponProb` utilise `barrierCoupon` au lieu d'assumer 85%
- Prompt Claude enrichi avec section `capital_garanti`
- La Digitale WO LVMH/ACA devrait passer de B(74) à C+/B-(58-65)

### Bug parser identifié (pdf.js)
- Les digitales capital garanti sont confondues avec des autocalls
- "Date de Constatation Annuelle" (coupon) ≠ "remboursement anticipé" (autocall)
- Fix suggéré: règle 17 dans le prompt + post-process de sécurité
- L'utilisateur a corrigé manuellement pour l'instant

---

## 5. PROCHAINES ÉTAPES (par priorité)

### P0 — Fix parser digitale dans pdf.js
Ajouter règle 17 au prompt AI dans `parseBrochure()`:
```
17. DIGITALE / CAPITAL GARANTI: Si "garantie en capital à l'échéance" + "100%"
    ET pas de "remboursement anticipé automatique" → structureType "capital_garanti",
    earlyRedemption.possible=false
```
Ajouter post-process:
```javascript
if (parsed.capitalProtection?.protected && parsed.capitalProtection?.level === 100) {
    var hasAutocallKeyword = rawText.match(/remboursement\s*anticip[ée]/i);
    if (!hasAutocallKeyword) {
        parsed.earlyRedemption = { possible: false };
        if (!parsed.structureType) parsed.structureType = 'capital_garanti';
    }
}
```

### P1 — Champ barrierCoupon dans edit-modal.js
Ajouter un champ "Barrière Coupon (%)" dans le modal d'édition (`js/edit-modal.js`) pour que l'utilisateur puisse saisir la barrière coupon distincte de la barrière capital.

### P2 — Corrélation worst-of pour probabilité coupon
Utiliser la matrice `UNDERLYING_CORR_GROUPS` pour estimer la probabilité joint d'un worst-of:
- 2 actions même secteur (corr 0.8) → prob WO ≈ prob^1.1
- 2 actions secteurs différents (corr 0.3) → prob WO ≈ prob^1.4

### P3 — Backtest grades vs outcomes
Comparer les grades attribués avec les résultats réels à maturité pour calibrer le modèle.

### P4 — Supprimer les anciens fichiers grader
13 fichiers dans `js/` ne sont plus chargés mais restent dans le repo. Liste dans `js/archive/GRADER-V4-ARCHIVE.md`.

### P5 — Supprimer js/staging/
Le dossier `js/staging/proposal-grader-v5.js` est un placeholder obsolète.

---

## 6. PRODUITS EN PORTEFEUILLE (pour test)

| # | Nom | Type | Grade v5.1 | Sous-jacents |
|---|---|---|---|---|
| 1 | Solution Court Terme Boostée | Dispersion | B (65) | 8 tech FAANG |
| 2 | Athena Gold Miners | Autocall décrément | B (64) | Indice Solactive GDX |
| 3 | Note Taux Fixe Callable Bonus | Taux fixe callable | C (45) | Aucun (obligation) |
| 4 | Digitale WO LVMH Crédit Agricole | Capital garanti digitale | B(74)→C+(~60) | LVMH, Crédit Agricole |

---

## 7. POINTS D'ATTENTION

- **Toujours lire `js/proposal-grader-v5.js` avant de modifier le grading** — c'est LE fichier unique
- **Ne jamais créer de nouveau patch séparé** — tout va dans le fichier consolidé
- **Les anciens grader-*.js ne sont plus chargés** — ils sont dans le repo mais ignorés par index.html
- **Le transcript complet de cette session est dans** `/mnt/transcripts/`
- **L'API Claude est utilisée côté client** (via proxy Anthropic) — pas de backend
- **Données marché mises à jour par GitHub Actions workflows** — pas manuellement
- **Le site est sur GitHub Pages** — chaque push sur main déclenche un déploiement

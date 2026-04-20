# Audit Expert — Moteur de Grading StructBoard v7.0

## Contexte

StructBoard est un outil d'analyse de produits structurés (Vanilla JS, GitHub Pages). Le moteur de grading évalue chaque produit sur 4 piliers (A/B/C/D/F) en combinant :
- Black-Scholes pour les probabilités de coupon et de perte
- Données historiques de taux (20 ans, 695 observations TEC10)
- Intelligence de marché (régime, volatilité, corrélations)
- Ajustement IA via Claude (verdict qualitatif)

**Repository** : https://github.com/Bencode92/ProduitsCheck
**Fichiers clés** : `js/proposal-grader-v7.js` (pipeline consolidé), `js/proposal-grader-v5.js` (base)

---

## Architecture du Grading

### Pipeline d'exécution
```
NORMALISATION → Collecte contexte (marché, portefeuille, CAT) →
Détection type → P1-P4 heuristiques (base) → Ajustement IA (Claude) →
Override BS P1 → Calibration v6 → Recalibration finale → Scénarios régime
```

### 4 Piliers et Pondérations

| Pilier | Poids | Objet |
|--------|-------|-------|
| P1 — Rendement ajusté | **30%** | Rendement espéré ajusté par probabilités BS |
| P2 — Qualité sous-jacent | **20%** | Volatilité, rating émetteur, diversification |
| P3 — Fit portefeuille | **15%** | Adéquation structurelle, maturité, régime |
| P4 — Prime vs CAT | **30%** | Spread coupon - CAT, illiquidité, crédit |

**Score final** = `round(P1×0.30 + P2×0.20 + P3×0.15 + P4×0.30)`
**Grade** = A (≥75) | B (≥60) | C (≥45) | D (≥25) | F (<25)

---

## P1 — Rendement Ajusté (deux branches)

### Branche A : Produits Actions (Black-Scholes)

**Probabilité de coupon** :
```
d2 = [ln(S/K) + (r - σ²/2)·T] / (σ·√T)
P(coupon) = N(d2)

S = 100 (spot normalisé)
K = trigger coupon (ex: 100%, 95%, 77%)
σ = volatilité 3 ans (source: stocks_europe.json / underlyings_extra.json)
r = taux sans risque (CAT benchmark, défaut 2.5%)
T = maturité espérée
```

**Rendement net** :
```
rendementNet = coupon × P(coupon) - perteEspérée - drag - commissions/maturité

perteEspérée = (1 - barrière%) × 1.3 × P(breach) / T
drag = max(0, décrément - dividende_réel)
```

**Worst-of** : `P(coupon) = ∏(P_i) × (1 + ρ × (n-1))`, cappé à min(P_i)
**Basket** : volatilité du panier = `√[Σ(σ_i²/n²) + 2Σ(ρ×σ_i×σ_j/n²)]`, ρ défaut = 0.4
**Dispersion** : P(coupon) = 95%, rendement = `max(0.5%, (1-ρ)×16%)`

**Score** = `35 + rendementNet × 6` (cappé 5-95)

### Branche B : Produits Taux (données historiques)

**Source** : `data/market/rates.json` — 695 obs TEC10 (2004-2026), 167 obs Euribor

**Probabilité de coupon** :
```
- TARN / Digital : P = nb_obs(taux ≤ trigger) / total_obs
  Ex: TEC10 ≤ 4.60% → 94.7% sur 695 observations

- Range Accrual : P = nb_obs(borne_basse ≤ taux ≤ borne_haute) / total_obs
  Ex: Euribor 3M dans [1.75%, 3.50%] → X% sur 167 observations
```

**Ajustement régime** :
```
Si moyenne_12_derniers_mois > moyenne_20_ans × 1.1 :
  P *= 0.95  (taux récents élevés → réduction prudente)
```

**Boost mémoire** (coupon à mémoire) :
```
catchupBoost = 1 - (1 - missProb)^min(T, 5)
P_mémoire = P + (1-P) × catchupBoost × 0.5
```

**Maturité espérée TARN** :
```
yearsToTarget = autocallCumulTarget / couponRate
adjustedYears = yearsToTarget / P(coupon)
matEsperee = ceil(adjustedYears)

Ex: 26.8% / 6.7% / 0.95 = 4.2 ans → matEsperee = 5
```

**Score** = `35 + (coupon × P(coupon) - commissions/T) × 6`
- Boost +5 si guaranteedYears ≥ 2
- Boost +3 si guaranteedYears ≥ 1
- Boost +5 si capital garanti

---

## P2 — Qualité Sous-jacent

| Type | Score base | Ajustements |
|------|-----------|-------------|
| Blue-chip single stock (Buffett ≥70) | 75-85 | -5 si vol>40%, -3 si secteur évité |
| Indice large cap (CAC, STOXX) | 70-80 | +5 si diversifié (>30 composants) |
| Worst-of | 55-60 | -5 si n≥3, -10 si n≥5 |
| Basket équipondéré | 60-70 | +8 à +12 selon corrélation |
| Taux / Crédit | 65-75 | -5 à -10 si CDS > 150 bps |

**Pénalité crédit émetteur** = `(CDS_bps / 100) × échelle_maturité`
- 0.5× à 2 ans, 1.0× à 5 ans, 2.0× à 10 ans+, cappé à -8 points

---

## P3 — Fit Portefeuille

**Base** : 50 points

| Structure | Ajustement |
|-----------|-----------|
| Dispersion / Paires | +15 |
| Capital garanti | +10 |
| Basket (si P2≥60) | +8 à +12 |
| Single-index | +8 |
| Taux fixe / Rates | +5 |
| Maturité ≤ 2 ans | +5 |
| Maturité > 7 ans | -5 |
| Worst-of n≥3 | -5 |
| Worst-of n≥4 | -10 |
| Single-stock | -10 |

---

## P4 — Prime vs CAT

**Calcul de base** :
```
spread = coupon_annualisé - CAT_benchmark
spreadPoints = min(8, max(-8, (spread - 1.5) / 0.5))
score = 50 + spreadPoints × 5
```

**Correction BS** : si rendementNet BS < coupon facial :
```
ratio = max(0.25, bsSpread / facialSpread)
P4_corrigé = P4 × ratio
```

**Pénalités appliquées (dans l'ordre)** :

1. **Prime d'illiquidité** : `1.5% + 0.20% × max(0, T-2)` → delta score = `-round(delta × 5)` (max -10)
2. **Drag décrément** : `-min(30, round(drag × 5))`
3. **Trigger élevé** : -10 à -18 si trigger 100% + worst-of
4. **Maturité longue** : `-min(10, round((T-7) × 2))` si T≥8

**Boost dispersion** : +15 (+10 si capital protégé), cappé à 90

---

## Kill Criteria (Grade F automatique)

- Worst-of > 8 sous-jacents → F
- RendementNet BS < 0 → recommandation PASSER
- Spread < minSpread (`max(1.0%, vol × 0.05)`) → ATTENDRE

---

## Scénarios de Régime

| Scénario | P1 | P2 | P3 | P4 |
|----------|----|----|----|----|
| **Bull** | +8 | +10 | = | +5 |
| **Crash** | -15 | -15 | = | -8 |
| **Crash (capital protégé)** | -8 | -15 | = | -3 |

---

## Données de Marché Utilisées

| Source | Contenu | Usage |
|--------|---------|-------|
| `data/market/rates.json` | TEC10, OAT 5Y/2Y, Euribor 3M/6M/12M (20 ans) | P1 historique taux |
| `data/market/stocks_europe.json` | Vol 3Y, beta, perf par action EU | P1 BS, P2 |
| `data/market/stocks_us.json` | Vol 3Y actions US | P1 BS dispersion |
| `data/market/corr_dispersion_tech.json` | Corrélation 1Y basket tech | P1 dispersion |
| `data/market/market_intelligence.json` | Régime, secteurs, VIX, Brent | P2, P3, scénarios |
| ISSUER_RATINGS (hardcodé) | CDS proxy par banque (17 émetteurs) | P2, P4 |

---

## Hypothèses Hardcodées

| Paramètre | Valeur | Justification |
|-----------|--------|--------------|
| Taux sans risque | 2.5% (défaut CAT) | Benchmark des contrats à terme |
| Maturité espérée autocall | 35% de max | Heuristique calibrée historiquement |
| Recovery rate | 70% (×1.3 loss) | Convention marché structurés |
| Rendement dispersion | 11% base | Backtesting 2008-2023 |
| Corrélation intra-basket | 0.4 | Fourchette typique EU equities |
| Vol défaut single-index | 20% | — |
| Vol défaut single-stock | 28% | — |
| Vol défaut worst-of | 30% | — |

---

## Limitations Connues

1. **Pas de structure par terme de vol** — même σ pour toutes maturités
2. **Hypothèse gaussienne** — ignore fat tails, skew, sauts
3. **Pas de taux stochastiques** — callables évalués avec proba statique
4. **Corrélation unique** — pas de copule complète pour worst-of
5. **CDS émetteurs hardcodés** — pas de mise à jour temps réel
6. **Monitoring quotidien non modélisé** — barrière knockout simplifiée
7. **Pas de courbe forward** — taux futurs non pris en compte pour TARN
8. **Données Euribor limitées** — 167 obs (mensuel) vs 695 TEC10

---

## Champs Produit Utilisés par le Grader

### Utilisés
`coupon.rate`, `coupon.trigger`, `coupon.memory`, `coupon.frequency`, `coupon.type`
`capitalProtection.barrier`, `capitalProtection.barrierCoupon`, `capitalProtection.protected`
`earlyRedemption.trigger`, `earlyRedemption.type`, `earlyRedemption.possible`
`structureType`, `underlyingType`, `underlyings[]`, `maturityYears`
`guaranteedYears`, `decrementPct`, `actualDividendYield`, `participationRate`
`autocallCumulTarget`, `commissions`
`rangeAccrual.lowerBound`, `rangeAccrual.upperBound`

### Non utilisés (disponibles depuis le parsing enrichi)
- `callSchedule[]` — dates et montants exacts de call
- `guarantorRating` — rating du garant (différent de l'émetteur)
- `coupon.paymentTiming` — periodic vs in_fine
- `coupon.rateIfMaturity` — coupon total capitalisé
- `isin`, `minInvestment` — métadonnées structurelles

---

## Questions pour l'Expert

### Méthodologie
1. Les pondérations **30/20/15/30** sont-elles adaptées ? P3 à 15% semble faible — le fit portefeuille ne devrait-il pas peser plus ?
2. La formule BS pour P1 suppose une diffusion log-normale. Pour des produits à barrière avec observation quotidienne, un modèle de Heston ou local vol serait-il plus approprié ?
3. Le taux sans risque fixé au CAT benchmark (2.5%) est-il pertinent comme proxy du risk-free rate dans la formule BS ?

### Calibration
4. La probabilité historique de coupon (ex: TEC10 ≤ 4.60% = 94.7%) est basée sur 20 ans. Faut-il pondérer les observations récentes plus fortement (fenêtre mobile) ?
5. L'ajustement régime (-5% si moyenne récente > 1.1× moyenne historique) est-il suffisant pour capturer le risque de changement de régime ?
6. Le boost mémoire modélisé comme `P + (1-P) × catchup × 0.5` est-il réaliste ? Un modèle de chaîne de Markov serait-il plus précis ?

### Risque
7. La perte espérée utilise un multiplicateur fixe de 1.3× (recovery 70%). Est-ce calibré sur les structurés ou les obligations corporate ?
8. Pour les worst-of, la formule `∏(P_i) × corrAdj` ne capture pas les dépendances de queue. Un modèle de copule (Clayton, Gumbel) serait-il justifié ?
9. La prime d'illiquidité (1.5% + 0.20%/an) est-elle calibrée sur les spreads bid-ask observés en secondaire ?

### Produits Taux
10. Pour les TARN, la maturité espérée `autocallCumulTarget / couponRate / P(coupon)` est-elle la bonne formule ? Faut-il modéliser année par année avec une simulation ?
11. Les callables sont évalués avec P(call) = 30% ou 60% selon le niveau actuel vs historique. Cette heuristique est-elle défendable ?
12. Faudrait-il intégrer la courbe forward des taux pour estimer P(coupon) futur plutôt que de se baser uniquement sur l'historique ?

### Données
13. Les 695 observations TEC10 couvrent 2004-2026 (incluant ZIRP 2014-2022). Faut-il exclure la période ZIRP pour le régime actuel ?
14. Les corrélations sont hardcodées à 0.4. Faudrait-il les calculer dynamiquement à partir des données de marché ?
15. Les CDS émetteurs sont statiques. Quel impact si SG passe de 70 à 150 bps ?

### Améliorations Proposées
16. Intégrer le `callSchedule` (dates et montants exacts) pour une maturité espérée plus précise ?
17. Utiliser le `guarantorRating` pour un ajustement crédit plus fin ?
18. Différencier P1 pour `paymentTiming = in_fine` (risque de réinvestissement) ?
19. Faut-il un Monte Carlo côté client pour les produits complexes (dispersion, TARN) ou les formules fermées suffisent ?
20. Le score actuel ne distingue pas le carry trade (emprunt 2.90% + structuré 6.70%) d'un investissement simple. Faut-il un mode "carry" ?

---

## Accès au Code

| Fichier | Lignes | Objet |
|---------|--------|-------|
| `js/proposal-grader-v7.js` | ~900 | Pipeline consolidé v7 |
| `js/proposal-grader-v5.js` | ~200 | Base v5 (P1-P4, kill criteria, UI) |
| `js/grader-sprint2-patch.js` | ~180 | Maturité BS, illiquidité ×2 |
| `js/grader-p1-expected-return-patch.js` | ~300 | Override BS P1 |
| `js/maturity-display-fix.js` | ~80 | Fix affichage maturité |
| `js/optimizer-v5-bs-patch.js` | ~100 | Allocation optimale |
| `data/market/rates.json` | 258 KB | Historique taux 20 ans |

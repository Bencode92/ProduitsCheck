# REVUE EXPERT — StructBoard Grading & Simulation Engine
## Document technique pour validation par un structureur / quant

**Date** : Avril 2026
**Système** : StructBoard v7 — Tableau de bord produits structurés
**Utilisateur** : Trésorerie entreprise (Caméleons Com Mark)
**Objectif** : Valider que la méthodologie de grading et de simulation est correcte et adaptée pour prendre des décisions d'investissement (500K-1M€ par produit)

---

## 1. CONTEXTE D'UTILISATION

### 1.1 Portefeuille
- **82 produits structurés** analysés (propositions reçues + portefeuille)
- Typologies : Autocall, Phoenix Mémoire, TARN TEC10, Digitale Mémoire, Range Accrual Euribor, Taux Fixe Callable, Taux Fixe In Fine Callable, Dispersion (paires actions), Basket Worst-of
- Émetteurs : CIC (A+/Aa3), SG (A/A1), Morgan Stanley (A+/Aa3), Swiss Life (distributeur)

### 1.2 Cas d'usage immédiat
- **Carry trade** : Emprunt SG 1M€ à 2.90% fixe in fine 5 ans → placement sur produits structurés taux capital garanti
- Besoin de comparer et sélectionner les 1-2 meilleurs produits sur 500K-1M€

### 1.3 Questions pour l'expert
> À chaque section, des questions spécifiques sont posées.
> L'objectif est de valider ou corriger notre méthodologie avant de prendre des décisions d'investissement.

---

## 2. MÉTHODOLOGIE DE GRADING — 4 PILIERS

### 2.1 Architecture du scoring

Le grade final (A/B/C/D) est calculé sur 100 points, pondération de 4 piliers :

| Pilier | Nom | Poids | Ce qu'il mesure |
|--------|-----|-------|-----------------|
| P1 | Adjusted Return | 30% | Rendement ajusté du risque (Black-Scholes) |
| P2 | Underlying Quality | 20% | Qualité du sous-jacent (vol, momentum, secteur) |
| P3 | Portfolio Fit | 15% | Complémentarité avec le portefeuille existant |
| P4 | Risk Premium | 30% | Prime de risque vs benchmark CAT |

**Seuils de grade :**
- A : score ≥ 75
- B : score ≥ 60
- C : score ≥ 40
- D : score < 40

> **QUESTION EXPERT 1** : Cette pondération P1=30%, P2=20%, P3=15%, P4=30% est-elle adaptée pour un investisseur corporate en trésorerie ? Faut-il surpondérer P4 (prime de risque) vs P1 (rendement ajusté) ?

### 2.2 Pilier P1 — Rendement ajusté (Black-Scholes)

#### Formule de probabilité de coupon (_probAbove)

Pour les produits actions/indices, la probabilité que le sous-jacent soit au-dessus du trigger à maturité :

```
d2 = [ln(S0/K) + (r - σ²/2) × T] / (σ × √T)
P(coupon) = Φ(d2)
```

Où :
- S0 = 100 (niveau initial normalisé)
- K = trigger coupon (ex: 77% pour Phoenix BNP)
- r = taux sans risque = **2.5%** (valeur figée dans le code)
- σ = volatilité implicite 3 ans du sous-jacent (depuis data/market/)
- T = maturité espérée (pas la maturité max — voir 2.2.3)
- Φ = fonction de répartition normale

> **QUESTION EXPERT 2** : Le taux sans risque est fixé à 2.5% dans le code. Avec BCE à 2.15% et OAT 5Y à 2.70%, quelle valeur utiliser ? Faut-il le rendre dynamique ?

> **QUESTION EXPERT 3** : On utilise la volatilité implicite 3Y issue de données de marché stockées. Pour un produit à maturité 8 ans, est-ce correct d'utiliser la vol 3Y ou faut-il extrapoler vers une vol 8Y ?

#### Probabilité de franchissement de barrière (_probBreach)

Pour les produits avec barrière de protection du capital (ex: 60%) :

```
log(S0/B) = ln(100/barrière)
d1 = [log(S0/B) + μ×T] / (σ×√T)
d2 = [-log(S0/B) + μ×T] / (σ×√T)
P(breach) = Φ(-d1) + (B/S0)^(2μ/σ²) × Φ(d2)
```

Avec μ = r - σ²/2, et plafond à 95%.

> **QUESTION EXPERT 4** : Cette formule est la probabilité de franchissement de barrière en observation européenne (at maturity only). Pour les produits à observation continue ou quotidienne, faut-il utiliser une formule de barrière continue (plus conservative) ?

#### Volatilité basket (_basketVol)

Pour les paniers multi-sous-jacents :

```
σ_basket = √(Σ(wi²×σi²) + Σ(2×ρ×wi×wj×σi×σj))
```

Avec wi = 1/n (équipondéré) et ρ = corrélation (fallback 0.40 si non disponible).

> **QUESTION EXPERT 5** : La corrélation par défaut de 0.40 est-elle réaliste ? Pour un basket de 5 actions européennes (type Oxygène), quelle corrélation utiliser ? Pour un worst-of ?

#### Maturité espérée

Pour les autocalls, la maturité espérée est calculée comme :

```
matEspérée = min(matMax, max(1, matMax × 0.35))
```

Donc pour un autocall 10 ans → maturité espérée = 3.5 ans.

> **QUESTION EXPERT 6** : Ce coefficient de 0.35 est-il calibré sur des données réelles ? Dépend-il du trigger autocall (100% vs 95% stepdown) ? Un autocall avec trigger 100% sans stepdown devrait avoir une maturité espérée plus longue qu'un autocall avec stepdown -5%/semestre.

#### Score P1 final

```
rendementNet = couponEffectif × probCoupon - perteEspérée - drag(décrément)
scoreP1 = 35 + rendementNet × 6
```

Clampé entre 5 et 95.

> **QUESTION EXPERT 7** : Le coefficient 6 dans `35 + rendementNet × 6` est-il calibré ? Un rendement net de 5% donne un score de 65/95 — est-ce le bon mapping pour un investisseur corporate ?

### 2.3 Pilier P1 — Ajustements post-BS

| Condition | Ajustement | Justification |
|-----------|-----------|---------------|
| Effet mémoire (coupon.memory = true) | probCoupon × 1.08 puis +5 pts P1 | La mémoire rattrape les coupons manqués |
| Années garanties ≥ 2 | +5 pts P1 | Réduit l'incertitude des premières années |
| Années garanties = 1 | +3 pts P1 | Idem, moindre impact |
| Single-stock | -5 pts P1 | Concentration, pas de diversification |
| Single-stock + barrière < 65% | -3 pts P1 supplémentaires | Haute probabilité de breach |

> **QUESTION EXPERT 8** : Le boost mémoire de +8% sur la probabilité de coupon et +5 pts est-il calibré ? Sur un Phoenix mémoire trimestriel (4 observations/an), l'effet mémoire est beaucoup plus puissant que sur un annuel. Faut-il différencier ?

### 2.4 Pilier P1 — Produits de taux (TARN, Range Accrual, Callable)

Les produits de taux **ne passent PAS par le Black-Scholes** (la fonction retourne `null` pour `isRate`). Ils utilisent un scoring heuristique basé sur :

- Coupon facial vs benchmark CAT
- Type de structure (taux fixe garanti vs conditionnel)
- Spread vs OAT de même maturité

> **QUESTION EXPERT 9** : Pour les produits taux (TARN TEC10), est-il possible d'utiliser un modèle de taux (Vasicek, Hull-White) pour estimer la probabilité que TEC10 ≤ 4.40% sur 5 ans ? Le heuristique actuel ne prend pas en compte la volatilité du TEC10 (18bp/an) ni la courbe forward.

### 2.5 Pilier P4 — Prime de risque

Le benchmark est le meilleur taux CAT disponible (**2.50% en fallback figé**).

```
spreadVsCAT = couponAnnualisé - benchmarkCAT
```

Ce spread est comparé au Black-Scholes rendement net. Si le spread facial est très supérieur au rendement BS, le P4 est pénalisé (le coupon "apparaît" élevé mais le risque le mange).

> **QUESTION EXPERT 10** : Le benchmark CAT devrait-il être le meilleur taux CAT du marché (actuellement ~3.50% CATVAIR) ou le taux OAT de même maturité ? Pour un carry trade adossé à un emprunt à 2.90%, le vrai benchmark est 2.90%, pas 2.50%.

---

## 3. TRAITEMENT PAR TYPOLOGIE

### 3.1 Phoenix Mémoire

**Parsing :**
- memory: true/false détecté ✅
- Fréquence trimestrielle/semestrielle détectée ✅
- Trigger coupon (77%) et barrière capital (60%) séparés ✅

**Grading :**
- probCoupon × 1.08 (mémoire boost) ✅
- +5 pts P1 ✅
- BS vanilla sur single-stock sous-jacent ✅

> **QUESTION EXPERT 11** : Pour un Phoenix mémoire trimestriel avec trigger 77% et barrière 60% sur BNP Paribas (vol ~30%), notre grading donne B (71/100). Est-ce cohérent avec le profil risque/rendement de ce type de produit ?

### 3.2 TARN TEC10

**Parsing :**
- trigger TEC10 ≤ 4.40% ✅
- autocall cumulatif ≥ 24% ✅
- Capital garanti 100% ✅
- guaranteedYears : maintenant extrait (avant : manquant)

**Grading :**
- Heuristique taux (pas de BS) ✅
- Score actuel : C (54/100) en régime stagflation

**Problème identifié :**
- Le TEC10 est à 3.10% avec une vol de 18bp/an
- La probabilité que TEC10 > 4.40% (130bp au-dessus) sur 5 ans n'est pas calculée
- En utilisant une loi normale : P(TEC10 > 4.40%) sur 1 an = Φ(-(4.40-3.10)/(0.18)) ≈ Φ(-7.2) ≈ 0%
- MAIS la distribution des taux n'est pas normale — fat tails, mean-reversion, regime shifts

> **QUESTION EXPERT 12** : Avec TEC10 à 3.10% et vol historique 18bp/an, quelle est la probabilité réaliste que TEC10 dépasse 4.40% au moins une année sur 5 ? Le grading actuel à C (54) est-il trop sévère ou trop généreux pour un TARN capital garanti avec 2 ans de coupons garantis ?

> **QUESTION EXPERT 13** : Pour le TARN, le risque principal n'est pas la perte en capital (garanti) mais le coût d'opportunité (0% de coupon). Comment intégrer ce risque dans le scoring ? Faut-il un pilier dédié "risque de non-paiement" ?

### 3.3 Range Accrual Euribor

**Parsing :**
- Corridor [1.75% - 3.50%] détecté ✅
- Observation quotidienne ✅

**Grading :**
- Probabilité corridor modélisée via CDF normale dans grader-rates-patch
- Coupon effectif = coupon × P(in corridor)

> **QUESTION EXPERT 14** : Pour un Range Accrual sur Euribor 3M avec corridor [1.75%-3.50%], Euribor actuel à 2.50%, la probabilité d'être dans le corridor est estimée à ~85%. Est-ce réaliste sur 5 ans ? L'Euribor peut-il sortir durablement du corridor si la BCE change de politique ?

### 3.4 Taux Fixe Callable / In Fine Callable

**Parsing :**
- coupon.rate, callSchedule, firstCallDate, redemptionLevel ✅
- dayCount 30/360 détecté ✅
- Type callable vs autocall distingué ✅

**Grading :**
- Traité comme produit garanti (coupon fixe + capital garanti)
- Le risque de rappel anticipé réduit la maturité effective mais pas le rendement

**Produit Callable In Fine 10YNC4 :**
```
Coupon : 4.66% annualisé, versé IN FINE (pas chaque année)
Callable : à partir de l'an 4, remboursement = 118.64% → 146.60%
À maturité : 100% capital + 46.60% de coupon cumulé
```

> **QUESTION EXPERT 15** : Pour un Callable In Fine (coupon capitalisé versé uniquement au call ou à maturité), comment comparer avec un produit à coupons annuels ? Le TRI est-il la bonne métrique ? Notre grading traite le coupon annualisé (4.66%) comme un coupon périodique — est-ce biaisé ?

### 3.5 Dispersion / Solution Court Terme Boostée

**Parsing :**
- 8 sous-jacents tech US (NVIDIA, Meta, etc.) ✅
- participationRate = 7% (corrigé — avant 0% par bug de propagation)
- capitalProtection = 100% ✅
- Maturité 3 ans ✅

**Grading :**
- Rendement espéré = (1 - corrélation) × 16
- Si corrélation = 0.43 → rendement = 9.1%
- Annualisé sur 3 ans = ~3.0%/an
- Boost P4 dispersion : +15 pts (capital garanti) + +10 pts P1

> **QUESTION EXPERT 16** : La formule `dispersion_return = (1 - corr) × 16` est-elle correcte ? Les simulations historiques sur les paires tech US donnent-elles un résultat cohérent ? Le coefficient 16 est-il calibré sur des données réelles ?

### 3.6 Athena Décrément (Solactive Gold Miners)

**Parsing :**
- decrementPct détecté (prélèvement forfaitaire)
- actualDividendYield parfois manquant
- drag = max(0, décrément - dividende réel)

**Grading :**
- P1 pénalisé : -min(drag×4, 25)
- P4 pénalisé : -min(drag×5, 30)

> **QUESTION EXPERT 17** : Pour un indice à décrément de 5% et dividende réel de 2%, le drag est de 3%. La pénalité P1 = -12 pts et P4 = -15 pts est-elle proportionnée ? Le décrément est souvent LE facteur dominant sur la performance du produit.

---

## 4. SIMULATION CARRY TRADE

### 4.1 Modèle actuel

Pour chaque produit et chaque année :
```
revenue = amount × coupon% × probabilité (selon scénario)
interest = loanAmount × loanRate%
net = (revenue - interest) × (1 - taxRate%)
```

Trois scénarios :
- **Expected** : coupon × conditionProb (ex: 8% × 78% = 6.24%)
- **Worst** : coupon garanti uniquement (plancher ou guaranteedYears), sinon 0%
- **Best** : coupon à 100%

### 4.2 Mécanisme mémoire (récemment ajouté)

```
Si memory=true ET coupon=0 cette année :
  → accumulatedCoupons[produit] += coupon manqué
Si memory=true ET coupon>0 ET accumulated>0 :
  → revenue = coupon courant + coupons accumulés
  → accumulatedCoupons[produit] = 0
```

### 4.3 Lacunes identifiées

| Lacune | Impact | Description |
|--------|--------|-------------|
| **Pas d'autocall** | FORT | Le simulateur ne modélise pas le remboursement anticipé. Si un TARN autocall à l'an 3, le simulateur continue à calculer des coupons An 4-5 sur un produit qui n'existe plus. |
| **Pas de réinvestissement post-autocall** | FORT | Après un autocall, le capital devrait être replacé (probablement à un taux inférieur). Non modélisé. |
| **Probabilités figées** | MOYEN | conditionProb est fixe par produit (ex: 0.78). En réalité la probabilité change avec le temps et le niveau du sous-jacent. |
| **Pas de Monte Carlo** | MOYEN | 3 scénarios fixes (worst/expected/best) au lieu d'une distribution. Pas de VaR, pas de percentiles. |
| **Taux de marché statiques** | FAIBLE | TEC10 3.10% figé dans le code. Pas de lecture automatique des taux du jour. |

> **QUESTION EXPERT 18** : Pour un carry trade sur 5 ans avec 1M€, est-il acceptable d'utiliser des scénarios figés (worst/expected/best) ou faut-il absolument un Monte Carlo ? Quel niveau de sophistication est nécessaire pour prendre une décision d'investissement de 1M€ ?

> **QUESTION EXPERT 19** : L'autocall est le mécanisme le plus impactant sur le P&L réel (le TARN autocall probablement en 3 ans, pas 5). Comment modéliser simplement le réinvestissement post-autocall ? Utiliser le taux CAT du moment ? Le taux OAT ?

---

## 5. DONNÉES DE MARCHÉ UTILISÉES

### 5.1 Taux (avril 2026)

| Référence | Valeur | Source | Mise à jour |
|-----------|--------|--------|-------------|
| TEC10 (OAT 10Y) | 3.10% | ECB + Twelve Data | 13/04/2026 |
| OAT 5Y | 2.70% | ECB + Twelve Data | 13/04/2026 |
| OAT 2Y | 2.53% | ECB + Twelve Data | 13/04/2026 |
| BCE dépôt | 2.00% | ECB | 13/04/2026 |
| BCE main | 2.15% | ECB | 13/04/2026 |
| Euribor 3M | ~2.50% | Estimation | — |
| Vol TEC10 annualisée | 18bp | Calculée sur historique 12M | 13/04/2026 |

### 5.2 Volatilités actions

| Source | Contenu | Méthode |
|--------|---------|---------|
| data/market/stocks_europe.json | Vol implicite 3Y actions EU | Données de marché |
| data/market/stocks_us.json | Vol implicite 3Y actions US | Données de marché |
| data/market/underlyings_extra.json | Vol proxy pour sous-jacents non couverts | Estimation |

### 5.3 Intelligence de marché

| Champ | Valeur | Source |
|-------|--------|--------|
| Régime | Stagflation | IA (Claude) basé sur macro |
| Brent | $103 | Données marché |
| VIX | 22 | Données marché |
| PCE inflation | 2.8% | Données marché |
| Spread IG | 135bp | Données marché |

> **QUESTION EXPERT 20** : Les volatilités implicites 3Y stockées sont-elles la bonne mesure pour pricer des options embarquées dans les produits structurés ? Faut-il utiliser la vol implicite ATM, la vol à la barrière (skew), ou une vol locale ?

---

## 6. CALIBRATION — VALEURS À VALIDER

Toutes les constantes hardcodées dans le système :

| Paramètre | Valeur | Fichier | Ligne |
|-----------|--------|---------|-------|
| Taux sans risque BS | 2.5% | proposal-grader-v7.js | 291 |
| Corrélation fallback basket | 0.40 | proposal-grader-v7.js | 296 |
| Corrélation fallback worst-of | 0.15 | proposal-grader-v7.js | 316 |
| Maturité espérée = matMax × 0.35 | 0.35 | proposal-grader-v7.js | 273 |
| Memory boost probCoupon | ×1.08 | proposal-grader-v7.js | 325 |
| Score P1 = 35 + rendementNet × 6 | 35, 6 | proposal-grader-v7.js | 337 |
| Dispersion return = (1-corr) × 16 | 16 | proposal-grader-v7.js | 306 |
| Perte espérée = (1-B/100)×100×1.3×probB/mat | 1.3 | proposal-grader-v7.js | 333 |
| CAT benchmark fallback | 2.50% | grading config | — |
| Carry conditionProb TARN | 0.78 | carry-simulator.js | CATALOG |
| Carry conditionProb Range Accrual | 0.85 | carry-simulator.js | CATALOG |
| Carry conditionProb Digital Mémoire | 0.88 | carry-simulator.js | CATALOG |
| Carry conditionProb Hybride | 0.90 | carry-simulator.js | CATALOG |

> **QUESTION EXPERT 21** : Ces constantes sont-elles correctement calibrées ? En particulier :
> - Le 0.35 pour la maturité espérée des autocalls est-il basé sur des statistiques de marché ?
> - Le coefficient 1.3 dans la perte espérée est-il un facteur de sécurité ? Pourquoi 1.3 ?
> - Le 16 dans la formule de dispersion est-il calibré sur des backtests ?

---

## 7. RÉSUMÉ DES QUESTIONS POUR L'EXPERT

| # | Question | Priorité |
|---|---------|----------|
| 1 | Pondération P1=30/P2=20/P3=15/P4=30 adaptée pour corporate ? | Haute |
| 2 | Taux sans risque à 2.5% — dynamiser avec BCE/OAT ? | Haute |
| 3 | Vol 3Y pour produits 8-10 ans — extrapoler ? | Moyenne |
| 4 | Barrière européenne vs continue — formule adaptée ? | Moyenne |
| 5 | Corrélation fallback 0.40 pour baskets — réaliste ? | Moyenne |
| 6 | Maturité espérée = 0.35 × matMax — calibré ? | Haute |
| 7 | Score P1 = 35 + rdt × 6 — bon mapping ? | Haute |
| 8 | Memory boost +8% — différencier trim vs annuel ? | Moyenne |
| 9 | Modèle de taux pour TARN (Vasicek/HW) vs heuristique ? | Haute |
| 10 | Benchmark CAT 2.50% vs taux emprunt 2.90% ? | Haute |
| 11 | Phoenix B (71) — cohérent pour le profil ? | Faible |
| 12 | TARN C (54) — trop sévère avec TEC10 à 3.10% ? | Haute |
| 13 | Pilier dédié "risque de non-paiement" pour taux ? | Moyenne |
| 14 | Range Accrual proba corridor 85% — réaliste sur 5 ans ? | Moyenne |
| 15 | Callable In Fine — TRI vs coupon annualisé ? | Moyenne |
| 16 | Dispersion (1-corr)×16 — calibré sur données ? | Moyenne |
| 17 | Décrément drag penalty proportionnée ? | Faible |
| 18 | Scénarios figés vs Monte Carlo pour décision 1M€ ? | Haute |
| 19 | Modélisation réinvestissement post-autocall ? | Haute |
| 20 | Vol implicite ATM vs skew vs locale ? | Moyenne |
| 21 | Toutes les constantes hardcodées — calibrées ? | Haute |

---

## 8. PROCHAINES ÉTAPES PRÉVUES

Sous réserve de validation expert :

1. **Autocall dans le simulateur** — modéliser le remboursement anticipé + réinvestissement
2. **Probabilités dynamiques** — lire TEC10/Euribor depuis rates.json, calculer les probas en temps réel
3. **CAT benchmark dynamique** — utiliser le meilleur taux CAT réel au lieu du fallback 2.50%
4. **Monte Carlo simplifié** — 100-1000 simulations pour distribution de gains et VaR
5. **Modèle de taux** — Vasicek ou Hull-White pour les produits TARN/Range Accrual

Nous attendons vos retours avant d'implémenter ces évolutions.

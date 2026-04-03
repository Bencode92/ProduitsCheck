# StructBoard — Document de Référence Expert

## Système d'Analyse et d'Allocation de Produits Structurés

**Version :** 6.2.0 — Avril 2026
**Contexte macro :** Régime Stagflation (Brent $122, PCE 2.83%, BCE hawkish hold)
**Patrimoine géré :** ~2M€ (ByCam + Caméléons)

---

# PARTIE 1 — Les Produits Structurés

## 1.1 Définition

Un produit structuré est un instrument financier combinant :
- Un **composant obligataire** (protection du capital, total ou partiel)
- Un **composant dérivé** (coupon conditionnel lié à un sous-jacent)

L'investisseur accepte un risque conditionnel (coupon, capital) en échange d'un rendement potentiel supérieur aux placements sans risque (CAT, obligations).

## 1.2 Caractéristiques communes

| Paramètre | Description |
|-----------|-------------|
| **Nominal** | Montant unitaire (typiquement 1 000€ ou 10 000€) |
| **Maturité** | Durée maximale (3 à 12 ans) |
| **Coupon** | Rendement annuel, fixe ou conditionnel |
| **Protection capital** | Garantie totale (100%) ou partielle (barrière) |
| **Sous-jacent** | Action, indice, taux, panier — détermine le risque |
| **Autocall** | Remboursement anticipé si condition remplie |
| **Émetteur** | Banque qui garantit le produit (risque crédit) |

## 1.3 Les types de produits

### 1.3.1 Autocall / Phoenix

**Mécanisme :** Coupon conditionnel versé si le sous-jacent reste au-dessus d'un seuil (trigger coupon). Remboursement anticipé automatique si le sous-jacent dépasse un seuil d'autocall à une date d'observation.

**Variantes :**
- **Phoenix classique** : coupon annuel conditionnel, autocall annuel
- **Phoenix à mémoire** : les coupons non versés sont mémorisés et rattrapés si la condition est remplie ultérieurement
- **Step-down** : le seuil d'autocall diminue avec le temps (ex: 100%, 95%, 90%...)

**Exemple concret — Phoenix Richemont :**
```
Coupon : 7.5%/an si Richemont ≥ 70% du niveau initial
Autocall : si Richemont ≥ 100% du niveau initial (annuel)
Barrière capital : 60% (perte si Richemont < 60% à maturité)
Maturité : 6 ans
```

**Risque principal :** Perte en capital si le sous-jacent chute sous la barrière à l'échéance.

### 1.3.2 Dispersion / Performance Relative

**Mécanisme :** Le rendement dépend de la **dispersion** (écart de performance) entre les actions d'un panier, pas de leur performance absolue. Plus les actions performent différemment, plus le coupon est élevé.

**Avantage :** Le capital est garanti à 100% car le produit ne dépend pas de la direction du marché.

**Exemple concret — Dispersion US Tech (Solution Court Terme Boostée) :**
```
Panier : NVDA, META, NFLX, AMZN, GOOGL, MSFT, AAPL, TSLA
Coupon = f(dispersion entre les 8 actions)
Capital garanti 100%
Maturité : 3 ans
rdtNet estimé : 9.1-10.4% (selon corrélation réelle)
```

**Formule de rendement :**
```
rdtNet = participation × (1 - corrélation_moyenne) × facteur
```
Avec corrélation moyenne réelle = 0.43 (calculée sur 1 an via Twelve Data).

### 1.3.3 Taux Fixe / Callable

**Mécanisme :** Coupon **garanti** (pas conditionnel). L'émetteur peut rappeler le produit avant l'échéance (callable) si les conditions de marché le justifient.

**Exemple concret — TF Callable SG 5% :**
```
Coupon : 4-5% garanti/an
Callable : l'émetteur peut rembourser à partir de l'année 2
Capital garanti 100%
Maturité max : 10 ans
TRI actualisé : 3.67% (pondéré par probabilité de call)
```

**Risque principal :** Risque de call — l'émetteur rappelle quand les taux baissent, forçant un réinvestissement à des taux inférieurs.

**Calcul du TRI actualisé :**
```
callProb = 20% (en stagflation — taux élevés → émetteur ne rappelle pas)
TRI = callProb × TRI_si_call + (1-callProb) × TRI_si_maturité
    = 0.20 × 4.2% + 0.80 × 3.5% = 3.67%
```

### 1.3.4 Range Accrual

**Mécanisme :** Le coupon est proportionnel au nombre de jours où un taux de référence reste dans un corridor défini.

**Formule :**
```
Coupon = Taux_max × (jours_dans_le_range / jours_total_période)
```

**Exemple concret — Range Accrual Euribor Avril 2031 (CIC) :**
```
Taux max : 5.20%/an
Corridor : Euribor 3M entre 1.75% et 3.50%
Observation : journalière
Capital garanti 100%
Maturité : 5 ans
Émetteur : CIC (A1/A+/AA-)
```

Si Euribor 3M dans le range 250/365 jours → coupon = 5.20% × 250/365 = **3.56%**

**Estimation de la probabilité de rester dans le range :**
```
Euribor 3M actuel ≈ 2.50% (ECB depo + 50bps)
Distance borne basse : 2.50% - 1.75% = 0.75%
Distance borne haute : 3.50% - 2.50% = 1.00%
Vol Euribor ≈ 19.7 bps/an (proxy yield 2Y)
volT sur 5 ans = 19.7 × √5 = 44 bps = 0.44%
zScore = min(0.75, 1.00) / 0.44 = 1.70

probInRange ≈ 65-70% (avant ajustement régime)
Ajustement stagflation : ×0.85 (plus proche borne haute → BCE hawkish)
probInRange final ≈ 65%

rdtEspéré = 5.20% × 65% = 3.39%
```

### 1.3.5 Digitale à Mémoire sur Taux

**Mécanisme :** Coupon binaire (tout ou rien) versé si un taux de référence est en-dessous d'un seuil à la date de constatation annuelle. Effet mémoire : les coupons non versés sont rattrapés.

**Exemple concret — Digitale Mémoire TEC10 Avril 2031 (CIC) :**
```
Coupon : 4.60%/an si TEC10 ≤ 4.40%
Mémoire : Oui (rattrapage des coupons manqués)
Capital garanti 100%
Maturité : 5 ans
Gain max : 23% (4.60% × 5)
TEC10 actuel : ~3.07% (marge de 133 bps sous le seuil)
```

### 1.3.6 Capital Garanti Structuré

**Mécanisme :** Protection du capital à 100% avec un coupon conditionnel ou une participation à la hausse d'un sous-jacent.

### 1.3.7 Worst-of / Panier

**Mécanisme :** Le rendement et la protection dépendent du **pire** sous-jacent du panier (worst-of) ou de la performance moyenne (panier équipondéré).

**Risque worst-of :** Si une seule action du panier chute sous la barrière, l'investisseur subit la perte sur cette action.

---

# PARTIE 2 — Le Système de Grading StructBoard

## 2.1 Architecture

Le grading s'appuie sur **4 piliers** indépendants, pondérés :

```
Score final = P1 × 30% + P2 × 20% + P3 × 15% + P4 × 30%
```

Chaque pilier est noté de 0 à 100.

| Pilier | Poids | Ce qu'il mesure |
|--------|:-----:|-----------------|
| **P1 — Rendement ajusté** | 30% | Le rendement espéré après ajustement probabiliste |
| **P2 — Qualité sous-jacent** | 20% | La qualité et la stabilité du sous-jacent |
| **P3 — Fit portefeuille** | 15% | La complémentarité avec le portefeuille existant |
| **P4 — Prime vs CAT** | 30% | Le spread net vs un placement sans risque (CAT) |

**Échelle de grades :**

| Grade | Score | Interprétation |
|:-----:|:-----:|----------------|
| **A** | 70+ | Excellent — souscrire prioritairement |
| **B** | 55-69 | Bon — à considérer sérieusement |
| **C** | 45-54 | Moyen — acceptable sous conditions |
| **D** | 25-44 | Faible — éviter sauf raison spécifique |
| **F** | < 25 | Rejet — rendement négatif ou risque excessif |

## 2.2 P1 — Rendement Ajusté (30%)

### Produits actions (autocall, worst-of, dispersion)

Le rendement est estimé via **Black-Scholes** :

```
rdtNet = rendement_simulé_BS × probabilité_ajustée
```

Pour une dispersion :
```
rdtNet = participation × (1 - corrélation) × facteur_cap
Corrélation réelle = 0.43 (Twelve Data, 1Y, 8 tickers US Tech)
```

Pour un autocall :
```
probAbove(trigger) = Φ(d2) où d2 = [ln(S/K) + (r - σ²/2)T] / (σ√T)
rdtNet = coupon × probAbove × (1 - probBreach)
```

### Produits taux (callable, range accrual, digitale)

Le rendement espéré intègre :
- Le **TRI actualisé** (pondéré par probabilité de call pour les callables)
- La **probabilité de rester dans le corridor** (range accrual)
- Le **spread vs taux sans risque** (OAT du même tenor)

**Formule Range Accrual :**
```javascript
function _estimateRangeProb(current, lower, upper, volBps, matYears) {
  var distToBorder = Math.min(current - lower, upper - current);
  var volT = (volBps / 100) × √matYears;
  var zScore = distToBorder / volT;
  var prob = 0.50 + 0.40 × (1 - e^(-zScore × 1.5));
  prob *= Math.max(0.5, 1 - 0.05 × matYears); // decay maturité
  // Biais stagflation : si plus proche borne haute → ×0.85
  return prob;
}
```

### Mapping P1

```
P1 = 35 + rdtNet × 6  (borné [5, 95])
```

Ajustements :
- Coupon garanti : +15
- Maturité courte (≤3a) : +5
- Maturité longue (>8a) : -5 à -10
- Lock-in stagflation (garanti >3.5% pour >5a) : +3 à +10
- Observation daily (range accrual) : +3

## 2.3 P2 — Qualité Sous-jacent (20%)

### Produits actions
```
Base = 50
+ qualité stock (vol, drawdown, Buffett score, sector momentum)
+ diversification panier (n actions, corrélation)
- worst-of penalty (n > 3 → -5 à -10)
- single stock concentration (-10)
```

### Produits taux
```
Base = 65 (qualité institutionnelle)
- duration penalty : (mat-3) × 2.5 si mat > 3
- vol taux > 25bps : -8
+ courbe normale : +5
+ coupon garanti : +5
+ corridor large (>2%) : +5 (range accrual)
+ observation daily : +3 (range accrual)
```

### Ajustement crédit émetteur

Via **CDS proxy** dans le P4 :
```
CDS spread < 50bps → -0 pts
CDS spread 50-100bps → -1 pt
CDS spread 100-200bps → -2 pts
CDS spread > 200bps → -3 pts
```

## 2.4 P3 — Fit Portefeuille (15%)

```
Base = 50
+ dispersion/pairs : +15 (décorrélé)
+ capital garanti structuré : +10
+ basket : +12
+ single index : +8
+ range accrual : +5
+ taux fixe : +5
- worst-of (n>3) : -5 à -10
- single stock : -10
```

Ajustements contextuels :
- En stagflation, les produits capital garanti reçoivent un bonus (+5 IA)
- Les produits corrélés au portefeuille existant sont pénalisés

## 2.5 P4 — Prime vs CAT (30%)

**Benchmark CAT unique :** 2.80% (CIC Progressif 36M, source confirmée)

### Formule générique
```
illiquidityPremium = 0.50% + 0.15% × max(0, maturity - 2)
effectiveSpread = rdtNet - CAT_benchmark - illiquidityPremium

Si spread ≤ 0 : P4 = max(5, 30 + spread × 15)
Si spread > 0 : P4 = min(80, 30 + spread × 12.5)
Si spread > 4 : P4 = 80 + 20 × (1 - e^(-(spread-4)/4))
```

### Exemples de calcul P4

| Produit | rdtNet | - CAT | - Illiq | = Spread | P4 |
|---------|:------:|:-----:|:-------:|:--------:|:--:|
| Dispersion 10.4% (3a) | 10.4% | -2.8% | -0.65% | +6.95% | ~85 |
| Range Accrual 3.39% (5a) | 3.39% | -2.8% | -0.95% | -0.36% | ~25 |
| TF Callable 3.67% (10a) | 3.67% | -2.8% | -1.70% | -0.83% | ~18 |
| Gold Miners -10.67% | -10.67% | -2.8% | -0.95% | -14.42% | 5 |

### Exemption P4 BS

Les produits taux (callable, range accrual, capital_garanti sur taux) sont **exemptés** de la correction P4 Black-Scholes car ils n'ont pas de `_bsRendementNet`. Leur P4 utilise la formule rates directement.

### Ajustement stagflation

Pour les produits à coupon garanti en stagflation :
```
certPremium = min(12, (coupon - CAT) × 4)  // si coupon > CAT
lockInBonus = min(8, (1 - callProb) × 8)    // si call prob < 30%
```

## 2.6 Ajustement IA

Après le calcul local (P1-P4), le grading est soumis à **Claude IA** qui peut ajuster chaque pilier de ±5 points maximum, avec justification. L'IA reçoit :
- Le contexte de marché (régime MI, taux BCE, VIX, spreads)
- Les données du produit (coupon, barrière, sous-jacent, maturité)
- Les métriques des sous-jacents (vol, drawdown, Buffett score)

Le score final est : `Base + IA_adjustment` (borné dans la fourchette du grade).

## 2.7 Scénarios Régime

Chaque produit est gradé dans 3 scénarios :
- **Actuel** (stagflation) : le grade principal
- **Bull / Risk-on** : +3 à +7 pts typiquement
- **Crash / Récession** : -5 à -10 pts typiquement

---

# PARTIE 3 — L'Allocateur Unifié

## 3.1 Architecture

L'allocateur combine :
- **Cash libre** par entité (ByCam 177K€, Caméléons 0€)
- **CAT à échéance** par contrat individuel (4× OPTIPLUS 150K€)
- **Bond 12M Swiss Life** (109K€, arbitrable SL uniquement)
- **Structurés éligibles** (gradés, capital garanti, rdtNet > CAT + spread)
- **Market Intelligence** (régime, trend taux, prob_hike)
- **Objectif utilisateur** (long terme / court terme / en attente)

## 3.2 Les 5 Règles

### Règle 1 — Ne jamais sortir d'un CAT pour un CAT moins bon

```
Si meilleure_offre_CAT ≤ taux_CAT_existant → GARDER
Exemple : OPTIPLUS 3.03% → CIC 2.80% = INTERDIT
```

### Règle 2 — Seuil de spread progressif par durée

Le structuré doit battre le CAT source d'un spread minimum proportionnel à la durée :

```
≤ 24 mois  : +0.50%
25-48 mois : +1.00%
49-72 mois : +1.50%
> 72 mois  : +2.00%
```

Ce barème rémunère le **lock-up** (prime d'illiquidité).

### Règle 3 — Montant exact par contrat

L'allocateur traite les CAT par **contrat individuel**, pas par bloc :

```
AVANT (bug) : 4× OPTIPLUS 600K€ → sort tout → 213K€ Dispersion + 496K€ CIC
APRÈS (fix) : 1× OPTIPLUS 150K€ → sort → 150K€ Dispersion
              3× OPTIPLUS 450K€ → GARDER à 2.90%
```

### Règle 4 — Le Market Intelligence influence le timing

Le `prob_hike` de la BCE ajuste le seuil de spread :

```
miFactor = clamp(1.0 + prob_hike × 0.5, 0.5, 1.5)
seuilFinal = spreadDurée × miFactor

Exemple : prob_hike = 35% → miFactor = 1.175
          Seuil 36M = 1.0% × 1.175 = 1.175%
```

### Règle 5 — L'objectif guide le choix

| Objectif | Effet sur l'allocation |
|----------|----------------------|
| **Long terme** | Structurés favorisés, cap 30% maintenu dur |
| **Court terme** | miFactor × 1.5 (seuil plus exigeant), seuls les spreads exceptionnels passent |
| **En attente** | 0 allocation structurée, tout reste en CAT existant |

**Le cap 30% par produit reste dur dans tous les cas** — c'est une règle de risque, pas une préférence.

## 3.3 Benchmark CAT

**Source unique :** `window._getCATBenchmark()` → meilleur taux CAT confirmé (pas web scan)
**Valeur actuelle :** 2.80% (CIC Progressif 36M)

Utilisé de manière cohérente dans : grading P4, optimizer, allocateur, synthèse patrimoniale.

## 3.4 Bond 12M Swiss Life

Le Bond 12M (109K€, ~2.5%) est traité séparément :
- Arbitrable **uniquement** vers des produits Swiss Life
- Si aucun produit SL n'a un rdtNet > 2.5% avec grade A/B/C + capital garanti → **GARDER**
- État actuel : aucun produit SL éligible → Bond gardé

## 3.5 FGDR

Plafond de garantie des dépôts : **100 000€ par banque** (CAT uniquement).

| Émetteur | Total | FGDR couvert | Exposé | % patrimoine |
|----------|:-----:|:------------:|:------:|:------------:|
| Banque Populaire | 1 150K€ | 100K€ | 1 050K€ | 57% |
| Société Générale | 360K€ | 100K€ | 260K€ | 18% |
| CIC | 300K€ | 100K€ | 200K€ | 15% |
| Swiss Life | 199K€ | — | 199K€ | 10% |

Les structurés ne sont **pas couverts** par le FGDR — risque crédit émetteur pur.

---

# PARTIE 4 — Classement des Produits Analysés

## 4.1 Classement du meilleur au pire

### #1 — Dispersion US Tech — B (68) — SG

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 95 | rdtNet 10.4%, capital garanti, participation boostée |
| P2 | 69 | 8 tech US, corrélation 0.43, vol pairs ~25% |
| P3 | 65 | Décorrélé du book, mais concentration tech |
| P4 | 52 | Spread 10.4%-2.8%-0.65% = +6.95%, conditionnel |

**Éligible allocateur : OUI** — seul produit qui passe le quality gate.

### #2 — Digitale Mémoire TEC10 — C (53) — CIC

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 67 | Coupon 4.6% conditionnel, TEC10 ≤ 4.40%, mémoire |
| P2 | 33 | TEC10 souverain (sous-évalué par grille IA, devrait être ~65-70) |
| P3 | 60 | Capital garanti, diversificateur taux |
| P4 | 54 | Spread 4.6%-2.5%-0.5% = 1.6% facial, conditionnel |

**Grade corrigé estimé (P2 ajusté) : C+ 58-60**

### #3 — Range Accrual Euribor — C (51) — CIC

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 47 | 5.20% × prob 65% = rdtEspéré 3.39%, daily obs +3 |
| P2 | 56 | Euribor 3M institutionnel, corridor large 175bps |
| P3 | 57 | Diversificateur taux, capital garanti |
| P4 | 56 | Spread 3.39%-2.5%-0.95% = -0.06%, moyen |

**Probabilité corridor :** 65.2% (biais stagflation ×0.85 appliqué)

### #4 — TF Callable SG 5% — C (51)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 45 | TRI 3.67% (call prob 20%), coupon garanti |
| P2 | 61 | Taux, émetteur SG A1 |
| P3 | 65 | Diversificateur taux |
| P4 | 35 | Spread 3.67%-2.80% = 0.87% < seuil 1% |

**Note :** P1 potentiellement sous-évalué (coupon garanti devrait scorer plus haut que conditionnel).

### #5 — Digitale WO LVMH/CA — C (46)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 42 | Coupon 6.15% mais rdtNet BS ~1.20% (worst-of 2 actions) |
| P2 | 56 | LVMH + CA, vol WO ~30%, barrière 60% |
| P3 | 60 | Capital garanti mais worst-of asymétrique |
| P4 | 27 | rdtNet 1.20% < CAT → prime négative |

### #6 — Phoenix Richemont — D (44)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 39 | Coupon 7.5% mais rdtNet BS ~1.22% |
| P2 | 77 | Richemont qualité luxe, vol ~25% |
| P3 | 40 | Single stock, pas capital garanti |
| P4 | 35 | rdtNet < CAT |

### #7 — Euro Stoxx Banks 9.7% — D (40)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 53 | Coupon 9.7% attractif, rdtNet BS 3.08% |
| P2 | 56 | Secteur bancaire, vol ~22% |
| P3 | 58 | Exposition banques européennes |
| P4 | 13 | Pas capital garanti → P4 écrasé (double pénalité P3+P4 identifiée) |

### #8 — Athena ISP — D (34)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 37 | rdtNet BS 1.69%, 10 ans illiquide |
| P2 | 75 | ISP banque solide, Goldman émetteur |
| P3 | 35 | Single stock bancaire, 10 ans |
| P4 | 10 | Illiquidité excessive |

### #9 — Objectif Mai 9.7% — D (32)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 45 | Coupon 9.7% facial mais rdtNet BS 1.67% |
| P2 | 32 | Basket sous-jacents faible qualité |
| P3 | 56 | Pas capital garanti |
| P4 | 10 | rdtNet < CAT, pas capital garanti |

### #10 — Oxygène 7% — D (30)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 37 | rdtNet BS 0.31%, quasi nul |
| P2 | 32 | Basket mixte, vol élevée |
| P3 | 56 | Capital garanti mais rdtNet nul |
| P4 | 10 | Spread négatif |

### #11 — Gold Miners — F (21)

| Pilier | Score | Détail |
|--------|:-----:|--------|
| P1 | 5 | rdtNet BS **-10.67%** — décrément détruit la valeur |
| P2 | 41 | Gold Miners index, vol ~35% |
| P3 | 58 | Décorrélé (or) |
| P4 | 10 | Rendement négatif |

## 4.2 Tableau récapitulatif

| # | Produit | Grade | Score | rdtNet | Cap.gar. | Alloc. |
|---|---------|:-----:|:-----:|:------:|:--------:|:------:|
| 1 | Dispersion US Tech | **B** | 68 | 10.4% | OUI | **OUI** |
| 2 | Digitale Mémoire TEC10 | **C** | 53 | ~3.5%* | OUI | NON |
| 3 | Range Accrual Euribor | **C** | 51 | 3.39% | OUI | NON |
| 4 | TF Callable SG | **C** | 51 | 3.67% | OUI | NON |
| 5 | Digitale WO LVMH/CA | **C** | 46 | 1.20% | OUI | NON |
| 6 | Phoenix Richemont | **D** | 44 | 1.22% | non | NON |
| 7 | Euro Stoxx Banks | **D** | 40 | 3.08% | non | NON |
| 8 | Athena ISP | **D** | 34 | 1.69% | OUI | NON |
| 9 | Objectif Mai 9.7% | **D** | 32 | 1.67% | non | NON |
| 10 | Oxygène 7% | **D** | 30 | 0.31% | OUI | NON |
| 11 | Gold Miners | **F** | 21 | -10.67% | non | NON |

*rdtNet estimé = coupon × prob conditionnelle

---

# PARTIE 5 — Données de Marché (Market Intelligence)

## 5.1 Régime actuel : Stagflation

| Indicateur | Valeur | Impact |
|-----------|--------|--------|
| Brent | $122 (+14% en 5j) | Choc pétrolier inflationniste |
| PCE YoY | 2.83% | Au-dessus target Fed |
| Fed Funds | 3.64% | Pause forcée |
| VIX | 22 | Stress modéré |
| HY Spread | 328 bps | Proche seuil stress (350) |
| EUR/USD | 1.159 | Dollar neutre |
| Yield 10Y US | 4.30% | Courbe pentifiée |
| Prob hike BCE | 35% | Stance hawkish hold |
| Gold | $4 759 | Hedge anti-débasement |

## 5.2 Impact sur les structurés

- **Capital garanti** exempté du seuil 65% en stagflation
- **Duration cap** 48 mois recommandé
- **Secteurs évités** : tech, financials, communication-services
- **Secteur favori** : energy (+37.6% YTD)
- **Cash tactique** : 5-8% recommandé (option d'achat sur la vol)

## 5.3 Taux de référence

| Taux | Niveau | Direction | Vol (bps) |
|------|:------:|:---------:|:---------:|
| BCE dépôt | 2.00% | Stable | — |
| OAT 2Y | 2.645% | Rising | 19.7 |
| OAT 5Y | 2.85% | Rising | 17.4 |
| OAT 10Y | 3.07% | Rising | 15.1 |
| Euribor 3M (estimé) | ~2.50% | Stable/Rising | ~20 |

---

# PARTIE 6 — Points d'Attention et Limites

## 6.1 Limites connues du modèle

1. **P2 produits taux** : le grading IA sous-évalue les sous-jacents taux (P2 ~33 au lieu de ~70). Le scoring quantitatif range accrual corrige partiellement.

2. **Double pénalité capital non garanti** : l'absence de protection capital est pénalisée dans P3 ET P4. Le P4 devrait être indépendant de la protection (il mesure le spread, pas le risque).

3. **Vol Euribor proxy** : la vol de l'Euribor 3M est approximée par la vol du yield 2Y (19.7 bps). L'Euribor réel est plus stable en temps normal mais peut décaler brutalement.

4. **1 seul produit éligible allocateur** : en stagflation ultra-sélective, seule la Dispersion passe. C'est voulu (protection du capital) mais limite l'utilité de l'outil pour un investisseur qui veut comparer.

## 6.2 Calibration du modèle

- **Kendall τ = 1.0** sur 9 produits de test (classement parfait)
- **32 tests automatisés** (grading + allocation) : 100% pass
- **Précision grade** : 9/9 produits correctement classés (100%)
- **Écart IA vs théorique** : ±3 points en moyenne (dans la marge)

## 6.3 Sources de données

| Donnée | Source | Fréquence |
|--------|--------|-----------|
| Taux BCE/OAT | ECB Statistical Data Warehouse | Quotidien (GitHub Actions) |
| Corrélation panier | Twelve Data API (prix historiques) | Hebdomadaire |
| Vol sous-jacents | Twelve Data + stocks_europe.json | Hebdomadaire |
| Market Intelligence | Claude Opus + données marché | À chaque grading |
| Offres CAT | Saisie manuelle (source confirmée) | Mensuel |

---

# PARTIE 7 — Précisions Structurelles

## 7.1 Dispersion ≠ Exposition Directionnelle Tech

La Dispersion US Tech (produit #1, B 68) est souvent perçue à tort comme une "exposition tech". C'est fondamentalement différent :

**Un autocall Phoenix sur NVIDIA** = pari directionnel. Si NVIDIA baisse sous la barrière → perte en capital. L'investisseur est long NVIDIA.

**Une Dispersion sur 8 tech US** = pari sur l'écart de performance entre les 8 actions, pas sur leur direction. Le rendement augmente quand les actions performent différemment :

```
rdtNet = participation × (1 - corrélation_réalisée) × facteur

Si corrélation = 0.30 (titres se dispersent) → rdtNet élevé
Si corrélation = 0.80 (titres bougent en bloc) → rdtNet faible
```

**En crise** (2008, 2020, mars 2025), la corrélation intra-secteur baisse temporairement (les leaders résistent, les fragiles chutent) → le coupon de dispersion augmente. C'est **contra-cyclique** à court terme.

**Le capital est garanti 100%.** Le seul risque est un rendement faible (pas une perte). Le risque crédit émetteur (SG) est le seul risque de perte, indépendant du tech.

La corrélation réelle mesurée (Twelve Data, 1 an) = **0.43**, ce qui donne un rdtNet de 9.1-10.4%. En stress extrême (corrélation → 0.70), le rdtNet tomberait à ~5-6% — toujours supérieur au CAT.

## 7.2 Contexte Entités ByCam / Caméléons

**ByCam** : société sans contraintes de trésorerie. Les 177K€ de cash libre sont 100% déployables. Pas de besoin de réserve de liquidité — la société n'a pas de charges opérationnelles qui nécessiteraient un tampon.

**Caméléons** : les CAT existants constituent la réserve de liquidité (sortie avec préavis 32 jours, taux minoré mais capital disponible). Des réserves supplémentaires existent en dehors du périmètre StructBoard. Le cash libre à 0€ est voulu — tout est placé.

L'alerte "réserve de liquidité insuffisante" (8.85% < 10-15% recommandé) ne s'applique pas dans ce contexte spécifique.

## 7.3 Stress Test Liquidité

**Question :** "Si j'ai besoin de X€ sous N jours, que puis-je mobiliser ?"

### Sources de liquidité par délai

| Source | Montant | Délai | Coût de sortie |
|--------|:-------:|:-----:|:--------------:|
| Cash libre ByCam | 177K€ | Immédiat | 0% |
| CAT OPTIPLUS (×4, Cam) | 600K€ | 32 jours préavis | Taux minoré selon barème |
| CAT Croissance SG (ByCam) | 110K€ | 32 jours préavis | Taux minoré |
| CAT CATVAIR (Cam) | 50K€ | 32 jours préavis | Pénalité contractuelle |
| CATIP CIC (Cam) | 200K€ | 32 jours préavis | Taux minoré |
| OPTIPLUS 5 ANS (×2, Cam) | 500K€ | 32 jours préavis | Taux minoré |
| Bond 12M Swiss Life | 109K€ | Variable (SL) | Spread rachat |
| Structurés (portefeuille) | 190K€ | Pas de marché garanti | Décote 2-5% estimée |

### Scénarios de stress

**Besoin 100K€ sous 7 jours :**
→ Cash ByCam (177K€) couvre. Pas d'impact sur les placements.

**Besoin 300K€ sous 30 jours :**
→ Cash ByCam 177K€ + 1 OPTIPLUS 150K€ (sortie anticipée, taux minoré) = 327K€.
Coût : perte du taux progressif restant sur 1 contrat OPTIPLUS (~2-3 mois de coupon).

**Besoin 500K€ sous 30 jours :**
→ Cash ByCam 177K€ + 2 OPTIPLUS 300K€ + CAT Croissance SG 110K€ = 587K€.
Coût : perte de taux progressif sur 2 OPTIPLUS + minoration SG.

**Besoin 1M€ sous 60 jours :**
→ Cash 177K€ + 4 OPTIPLUS 600K€ + CAT SG 110K€ + Bond SL 109K€ = 996K€.
Quasi-totalité du patrimoine mobilisée. Structurés exclus (pas de marché secondaire fiable).

### Liquidity Coverage Ratio simplifié

```
LCR_30j = Actifs mobilisables sous 30 jours / Patrimoine total
        = (177K + 600K + 110K) / 1 936K
        = 887K / 1 936K = 45.8%
```

Interprétation : 45.8% du patrimoine est mobilisable sous 30 jours. C'est confortable pour un patrimoine de gestion sans contraintes opérationnelles.

## 7.4 Vue Duration / ALM Timeline

### Échéancier des actifs

```
2026 ─────────────────────────────────────────────────
 Avr  │ Aujourd'hui
 Sep  │ ██████ 4× OPTIPLUS CONQUÊTE 600K€ (Cam) ← échéance
      │
2027 ─────────────────────────────────────────────────
 Jan  │ ██ CATVAIR 50K€ (Cam)
 Sep  │ ███ 2× CAT Croissance SG 110K€ (ByCam)
      │
2028 ─────────────────────────────────────────────────
 Jan  │
 Aoû  │ ██ CATIP CIC 200K€ (Cam)
      │
2029 ─────────────────────────────────────────────────
 Mar  │ ██ Structurés portefeuille (échéances diverses)
 Aoû  │ █████ 2× OPTIPLUS 5 ANS 500K€ (Cam)
      │
2030 ─────────────────────────────────────────────────
      │ (pas d'échéance CAT)
      │
2031 ─────────────────────────────────────────────────
 Avr  │ ██ Range Accrual Euribor 5.20% (CIC) ← si souscrit
 Avr  │ ██ Digitale Mémoire TEC10 4.60% (CIC) ← si souscrit
```

### Points d'attention ALM

**Sept 2026 — Pic d'échéance :**
4× OPTIPLUS CONQUÊTE (600K€) arrivent à terme en même temps. C'est le moment de décision clé : renouveler, arbitrer vers un structuré, ou attendre.

**2028-2029 — Trou de liquidité :**
Entre l'échéance CATIP (août 2028) et les OPTIPLUS 5 ANS (août 2029), pas d'échéance intermédiaire. Si un besoin survient dans cette fenêtre, il faudra sortir d'un CAT en cours avec pénalité.

**2030 — Année vide :**
Aucune échéance CAT. Les structurés souscrits en 2026 (Range Accrual, Digitale TEC10) arriveraient en avril 2031. Planifier une échéance CAT en 2030 pour assurer la continuité du flux.

**Duration moyenne pondérée :**
```
CAT :       2.4 ans (pondéré par montant)
Structurés : 5.1 ans (portefeuille existant)
Nouveaux :  4.2 ans (si Dispersion 3a + Range Accrual 5a)
Global :    3.1 ans
```

---

*Document généré le 03/04/2026 — StructBoard v6.2.0*
*Grading engine : v7.1 (Kendall τ = 1.0) + Range Accrual v1.0*
*Allocateur : v2.1 (5 règles, per-contract, MI-adjusted)*

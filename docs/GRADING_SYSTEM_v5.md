# StructBoard — Grading System v5.0 Documentation

> **Version:** 5.0b · **Date:** 25 mars 2026 · **Repo:** Bencode92/ProduitsCheck  
> **Stack:** Vanilla JS, GitHub Pages, Claude Opus 4 (via Cloudflare Worker)  
> **Données:** Twelve Data API + ECB SDW + Market Intelligence (Claude Opus CIO)

---

## Table des matières

1. [Architecture générale](#1-architecture-générale)
2. [Pipeline de données](#2-pipeline-de-données)
3. [Les 4 piliers de scoring](#3-les-4-piliers-de-scoring)
4. [Scoring par type de produit](#4-scoring-par-type-de-produit)
5. [Ajustement IA (Claude Opus)](#5-ajustement-ia-claude-opus)
6. [Améliorations v5.0 (Audit Expert)](#6-améliorations-v50-audit-expert)
7. [Exemples concrets du portefeuille](#7-exemples-concrets-du-portefeuille)
8. [Fichiers et ordre de chargement](#8-fichiers-et-ordre-de-chargement)
9. [Limites et roadmap](#9-limites-et-roadmap)

---

## 1. Architecture générale

### 1.1 Flux de grading

```
PDF Brochure
  │
  ├── pdf.js (extraction texte)
  ├── Claude Opus (parsing structuré → aiParsed)
  │
  ▼
Produit normalisé (coupon, barrière, SJ, maturité, autocall)
  │
  ├── _collectContext() ─────────────────────────────┐
  │     ├── _loadAllMarketData() → stocks, markets    │
  │     ├── _loadUnderlyingMap() → proxy mapping       │
  │     ├── _loadUnderlyingsExtra() → Twelve Data réel │
  │     ├── _loadMacroData() → gold, brent, VIX        │
  │     ├── _loadRatesData() → ECB yields, curve       │
  │     └── Market Intelligence → régime, secteurs     │
  │                                                     │
  ├── _isLiquidityProduct() ─── OUI → Grade "-" (CASH) │
  │                                                     │
  ├── _extractStockData() ◄─────────────────────────────┘
  │     ├── Cherche dans stocks_europe/us.json (actions)
  │     ├── Sinon: underlying-map.json → proxy ETF (indices)
  │     ├── Sinon: commodities map (or, brent, argent)
  │     └── Enrichit avec underlyings_extra.json (données réelles)
  │
  ├── Scoring déterministe
  │     ├── P1 = _computeP1(product)       // Rendement ajusté
  │     ├── P2 = _computeP2(product, mkt)  // Qualité sous-jacent
  │     ├── P3 = _computeP3(product, pf)   // Fit portefeuille
  │     └── P4 = _computeP4(product, cat)  // Prime vs CAT
  │
  ├── Score composite = Σ(Pi × Wi)
  │
  ├── Ajustement IA (Claude Opus 4)
  │     ├── Prompt: données SJ + MI + taux + scores base
  │     ├── Chaque pilier: ±15pts max (réduit par MI sensitivity)
  │     └── Verdict + scénarios + keyRisks
  │
  ├── Post-processing v5.0
  │     ├── Issuer rating filter (CDS cap)
  │     ├── Confidence interval [low-high]
  │     └── MI sensitivity clamp
  │
  ▼
Résultat: { grade: "B", score: 65, ci: [58-72], verdict, keyRisks, metadata }
```

### 1.2 Pondérations

| Pilier | Portefeuille | Proposition | Justification |
|--------|-------------|-------------|---------------|
| P1 — Rendement | 35% | 30% | En PF, le rendement est ce qui compte |
| P2 — Qualité SJ | 35% | 25% | Qualité détermine si on touche le coupon |
| P3 — Fit PF | 0% | 20% | Produit déjà acheté = fit non pertinent |
| P4 — Prime/CAT | 30% | 25% | Coût d'opportunité toujours pertinent |

### 1.3 Grille de grades

| Grade | Score | Signification |
|-------|-------|---------------|
| **A** | ≥ 75 | Excellent — recommandé |
| **B** | ≥ 60 | Bon — acceptable |
| **C** | ≥ 45 | Passable — attention |
| **D** | ≥ 25 | Médiocre — à éviter |
| **F** | < 25 | Mauvais — ne pas souscrire |
| **-** | — | Liquidité / Cash |

---

## 2. Pipeline de données

### 2.1 Workflow GitHub Actions (`sync-market-data.yml`)

Déclenché 2×/jour (7h + 17h) + manuellement.

```
┌── Download market files (stock-analysis-platform) ──────────┐
│   stocks_europe.json  (~200 actions EU, Twelve Data)         │
│   stocks_us.json      (~300 actions US, Twelve Data)         │
│   markets.json        (35 indices mondiaux)                  │
│   sectors.json        (ETFs sectoriels EU/US)                │
│   market_context.json (régime RADAR, momentum)               │
│   macro_indicators.json (gold, brent, VIX, Fed, DXY)        │
└──────────────────────────────────────────────────────────────┘
         │
┌── Fetch Market Intelligence ────────────────────────────────┐
│   market_intelligence.json (Claude Opus CIO analysis)        │
│   → régime macro, secteurs favorisés/évités, bond_strategy   │
│   → stress_flags, warnings, VIX, Brent                      │
└──────────────────────────────────────────────────────────────┘
         │
┌── fetch-rates.py (ECB + Twelve Data fallback) ──────────────┐
│   rates.json:                                                │
│   → Euro AAA 2Y/5Y/10Y yields (direction, vol, historique)   │
│   → ECB Main Rate + Deposit Rate                             │
│   → Yield curve shape (normal/inverted) + spread 2-10Y       │
│   → US 10Y/2Y yields (Twelve Data fallback)                  │
└──────────────────────────────────────────────────────────────┘
         │
┌── fetch-underlyings.py (Twelve Data API) ───────────────────┐
│   underlyings_extra.json:                                    │
│   → 22+ proxy ETFs avec métriques réelles 3Y                │
│   → vol_3y, max_dd_3y, perf_ytd, perf_1y, perf_3m, beta     │
│   → Commodity ETFs: GLD, SLV, BNO (pas USO → contango)      │
└──────────────────────────────────────────────────────────────┘
         │
┌── build_index.py (consolidation) ───────────────────────────┐
│   index.json (~500KB):                                       │
│   → stocks: 500 actions avec Buffett/Quality/vol/DD/beta     │
│   → markets: 35 indices avec YTD/3M/52W/trend                │
│   → market_intelligence: régime + secteurs + bond_strategy   │
│   → macro: gold/silver/brent/VIX/fed_funds/DXY               │
│   → underlyings_extra: 22 ETFs avec métriques réelles        │
│   → context: régime RADAR + momentum sectoriel               │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Données réelles (underlyings_extra.json)

| Proxy ETF | Sous-jacent | Vol 3Y | DD 3Y | Beta SPY | YTD | Source |
|-----------|-------------|--------|-------|----------|-----|--------|
| FEZ | Eurostoxx 50 | 18.12% | -16.07% | 0.82 | -5.55% | Twelve Data |
| EWQ | CAC 40 | 17.79% | -16.98% | 0.71 | -5.45% | Twelve Data |
| SPY | S&P 500 | 16.21% | -19.0% | 1.00 | -3.9% | Twelve Data |
| QQQ | Nasdaq 100 | 20.72% | -22.88% | 1.16 | -4.22% | Twelve Data |
| GDX | Gold Miners | 38.85% | -30.84% | 0.53 | +1.12% | Twelve Data |
| EUFN | EuroStoxx Banks | — | — | — | — | Pending workflow |
| GLD | Gold | 22.03% | -18.52% | 0.09 | +5.07% | Twelve Data |
| SLV | Silver | 46.61% | -41.74% | 0.61 | -0.12% | Twelve Data |
| BNO | Brent Oil | — | — | — | — | Pending (remplace USO) |
| EWL | Suisse/SMI | 15.14% | -13.48% | 0.48 | -3.78% | Twelve Data |
| INDA | India/Sensex | 14.67% | -21.64% | 0.39 | -13.17% | Twelve Data |

### 2.3 Données ECB (rates.json)

| Série | Valeur actuelle | Direction | Vol (bps) | Usage |
|-------|----------------|-----------|-----------|-------|
| Euro AAA 2Y | 2.589% | rising | 19.4 | P1/P2 callable court |
| Euro AAA 5Y | 2.704% | stable | 17.8 | P1/P2 callable moyen |
| Euro AAA 10Y (≈TEC10) | 3.062% | stable | 12.5 | P1/P2 callable long |
| ECB Main Rate | 2.15% | — | — | Benchmark |
| ECB Deposit Rate | 2.00% | — | — | Floor risk-free |
| Courbe | Normal | — | — | P2 shape bonus/malus |
| Spread 2-10Y | 0.473% | — | — | Santé économique |

---

## 3. Les 4 piliers de scoring

### 3.1 P1 — Rendement ajusté

**Fichiers:** `scoring.js` + `grader-v5-patch.js` + `grader-rates-patch.js`

#### Autocall / Phoenix (produits actions/indices)

```
score = min(100, coupon_annualisé × 10)

// Pénalité barrière (v5.0 recalibrée)
si !capitalProtection && barrier > 0:
    penalty = ((barrier - 30) / 50) ^ 2.0 × score
    // Barrier 50% → penalty 16% | 55% → 25% | 60% → 36% | 65% → 49%

// Worst-of
si worstOf && n > 2: score -= 3 × (n-2)^1.3

// Mémoire coupon
si hasMemory: score += 5

// Coupon garanti
si couponType = 'garanti' || 'fixe': score += 15

// Maturité espérée
si maturity_esperée < 3a: +5 | 6-10a: -5 | >10a: -10
```

#### Callable / Taux fixe (grader-rates-patch.js)

```
score = min(100, coupon × 10)

// Coupon vs risk-free yield (interpolé sur courbe ECB)
rfYield = interpolate(yield_curve, maturity)
spreadVsRF = coupon - rfYield
si spreadVsRF > 3%: +10 | > 2%: +5 | > 1%: 0 | > 0%: -5 | ≤ 0%: -15

// Callable + direction taux
si callable && taux falling: -8 (risque réinvestissement)
si callable && taux rising: +5 (faible proba de call)

// Coupon garanti: +15
// Maturité: ≤2a +8 | ≤3a +5 | 5-8a -5 | >8a -5×ln(mat/5)
```

### 3.2 P2 — Qualité sous-jacent

**Fichiers:** `scoring.js` + `grader-p2-patch.js` v1.1 + `grader-v5-patch.js` + `grader-v5b-patch.js` + `grader-rates-patch.js`

#### Mode A — Actions individuelles

```
Source: stocks_europe.json / stocks_us.json (direct Twelve Data)
Métriques: Buffett Score, Quality Score, Vol 3Y, Max DD 3Y, Beta

Sans barrière: B=35% Q=35% V=15% D=15%
Avec barrière: B=20% Q=20% V=30% D=30%

volComp = max(0, 100 - (vol-20)×1.5)
ddComp = max(0, 100 - (DD-25)×1.2)
score = B×wB + Q×wQ + volComp×wV + ddComp×wD

// Beta penalty v5.0 (seuil 1.0, non-linéaire)
si barrier && beta > 1.0:
    score -= ((beta-1.0)^1.5) × 12
    // β=1.2 → -2.6 | β=1.5 → -7.3 | β=2.0 → -16.9

// Sector correlation
si tous SJ même secteur: -10
```

#### Mode B — Indices (proxy ETF)

```
Source: underlying-map.json → underlyings_extra.json (Twelve Data)
Priorité: données réelles > defaults statiques

base = 50

// Momentum (données réelles Twelve Data)
si ytd > 0 && 3m > 0: +10 | si ytd < 0 && 3m < 0: -5
ytd > 10%: +10 | > 0%: +5 | -5 à 0%: 0 | -5 à -15%: -5 | < -15%: -15
3m > 5%: +5 | < -10%: -10 | < -5%: -5
52w > 20%: +5 | < 0%: -10

// Vol réelle (Twelve Data)
vol > 30%: -15 | > 25%: -10 | > 20%: -5

// DD réel
DD > 40%: -10 | > 30%: -5

// Barrier + beta
si barrier: -5 | si beta > 1.1: -((beta-1.0)×10)
```

#### Mode C — Commodités

```
Source: underlying-map.json → macro_indicators (prix) + GLD/SLV/BNO (métriques réelles)

score = max(20, min(80, 100 - vol×1.5))
// Gold (vol 22%) → 67 | Brent (vol 33%) → 51 | Silver (vol 47%) → 30

DD > 30%: -10 | > 20%: -5

// Décorrélation bonus
beta < 0.2: +10 (gold=0.09 → +10) | < 0.5: +5

// Barrier penalty
si barrier: -vol×0.3 (commodité + barrier = très risqué)
```

#### Mode D — Callable / Taux fixe

```
Source: rates.json (ECB yields, yield curve, policy rates)

base = capitalProtection ? 70 : 55

// Duration risk
si maturity > 3a: -min(15, (mat-3)×2.5)
// 5a → -5 | 8a → -13 | 10a → -15 (cap)

// Rate volatility
rateVol > 25bps: -8 | > 15bps: -4

// Yield curve shape
inverted: -10 (signal récession) | normal && spread>0.5%: +5

// Rate direction
rising: -5 (mark-to-market loss) | falling: +3

// Callable: +5 (durée effective plus courte)
```

### 3.3 P3 — Fit portefeuille

**Fichiers:** `scoring.js` + `grader-v5b-patch.js`

```
// En portefeuille: neutre
si isInPortfolio: return 70

// Proposition: analyse diversification
base = 70

// Overlap exact (même SJ)
pour chaque overlap: -10 (premier), -15 (suivants)

// v5.0b: Corrélation croisée (40+ SJ mappés)
// Eurostoxx + CAC40 = "eu-equity-core" → corr 0.95 → -8pts
// S&P 500 + Nasdaq = corr 0.90 → -8pts
// Eurostoxx + S&P = corr 0.75 → -4pts
// Gold + equity = corr 0.05 → pas de pénalité

pour chaque nouveau SJ:
    si group_correlation(new, existing) ≥ 0.85: -8 (quasi-identique)
    si ≥ 0.70: -4 (haute corrélation)

cap corrélation: -20 max

// Bonus diversification
si SJ vraiment nouveau (corr < 0.70 avec tous existants): +10
```

**Matrice de corrélation (extrait):**

| Groupe A | Groupe B | Corrélation |
|----------|----------|-------------|
| eu-equity-core | eu-equity-core | 0.95 |
| eu-equity-core | us-equity | 0.75 |
| eu-equity-core | japan-equity | 0.55 |
| eu-equity-core | gold | 0.05 |
| us-equity | us-equity-tech | 0.90 |
| gold | silver | 0.80 |
| gold | oil | 0.20 |

### 3.4 P4 — Prime vs CAT

**Fichiers:** `scoring.js` + `grader-rates-patch.js`

#### Produits actions/indices

```
spread = coupon - meilleur_taux_CAT
si spread ≤ 0: P4 = 5
si spread ≤ 400bps: P4 = min(80, spread/5)
si spread > 400bps: P4 = 80 + 20×(1 - e^(-excess/400))
```

#### Produits taux fixe/callable (v1.1)

```
benchmark = max(CAT, risk_free_yield, ECB_deposit_rate)
illiquidity_premium = 0.5% + 0.15% × max(0, maturity-2)
effective_spread = coupon - benchmark - illiquidity_premium

// Scoring sur effective spread
si effective_spread ≤ 0: max(5, 30 + spread×15)
si ≤ 4%: min(80, 30 + spread×12.5)
si > 4%: 80 + 20×(1 - e^(-(spread-4)/4))
```

---

## 4. Scoring par type de produit

### 4.1 Autocall / Phoenix sur ACTION

**Exemple:** ATHENA sur ENI S.p.A. (SG, 9.7%, barrière 60%, 5 ans)

```
_extractStockData("ENI S.p.A.")
  → stocks_europe.json: TROUVÉ
  → ticker=ENI, sector=Energy, beta=0.71, vol_3y=20%, DD=-26%
  → buffett_score=44, quality_score=14

P1: min(100, 9.7×10)=97 → barrier penalty ((60-30)/50)^2 = 0.36 → 97×0.64=62
    + mémoire: +5 → P1 = 67

P2: B=44×0.20 + Q=14×0.20 + Vol=100×0.30 + DD=98.8×0.30
    = 8.8 + 2.8 + 30 + 29.6 = 71
    Beta 0.71 < 1.0 → pas de pénalité → P2 = 71

P3: base 70 (en PF) → P3 = 70

P4: spread = 9.7% - 2.5% = 7.2% → P4 = 80 + 20×(1-e^(-3.2/4)) = 91

Base: 67×0.35 + 71×0.35 + 70×0 + 91×0.30 = 23.5 + 24.9 + 0 + 27.3 = 75.6
→ IA (Claude Opus) ajuste: P1-10, P2-15, P3+5 → Score final: 63 → Grade B
```

### 4.2 Autocall / Phoenix sur INDICE

**Exemple:** Produit sur Eurostoxx 50 (barrière 60%, 10 ans)

```
_extractStockData("Eurostoxx 50")
  → stocks_europe.json: NON TROUVÉ
  → underlying-map.json: "eurostoxx 50" → proxy FEZ
  → underlyings_extra.json["FEZ"]: vol=18.12%, DD=16.07%, beta=0.82
  → _dataSource = 'twelve_data' ✅

P2 Index (données réelles):
  base = 50
  ytd=-5.55% && 3m negative → -5 = 45
  ytd entre -5% et 0% → 0
  3m entre -5% et -10% → -5 = 40
  52w > 0% → 0 = 40
  vol 18.12% → 0 (< 20%)
  DD 16.07% → 0 (< 30%)
  barrier → -5 = 35
  beta 0.82 < 1.1 → 0
  P2 = 35
```

### 4.3 Autocall sur COMMODITY INDEX

**Exemple:** ATHENA sur Indice Solactive Gold Miners (SG, 9%, barrière 50%, 5 ans)

```
_extractStockData("Indice Solactive GDX EUR AR 5%")
  → stocks: NON TROUVÉ
  → underlying-map.json: "solactive gdx" → proxy GDX
  → underlyings_extra.json["GDX"]: vol=38.85%, DD=30.84%, beta=0.53
  → Type: index (gold miners)

P2 Index (données réelles GDX):
  base = 50
  ytd=+1.12% → +5 = 55
  3m=-3.97% → 0 = 55
  52w=+92.56% → +5 = 60  (exceptionnel)
  vol 38.85% → -15 (> 30%) = 45
  DD 30.84% → -5 (> 30%) = 40
  barrier → -5 = 35
  beta 0.53 < 1.1 → 0
  P2 = 35

→ Claude voit: vol élevée 38.85%, DD -30.84%, secteur minier volatile
→ IA ajuste P2: -5 → P2 final = 30 (secteur très volatile)
→ Mais IA voit aussi: beta défensif 0.53, décorrélé, perf 1Y +92%
→ P1 bonus pour coupon élevé 18% annualisé
```

### 4.4 Autocall sur EUROSTOXX BANKS (indice sectoriel)

**Exemple:** Phoenix sur EuroStoxx Banks (CIC, 9.7%, barrière 60%, 5 ans)

```
_extractStockData("EuroStoxx Banks")
  → stocks: NON TROUVÉ
  → underlying-map.json: "eurostoxx banks" → proxy EUFN
  → underlyings_extra.json["EUFN"]: (pending workflow run)
  → Defaults: vol=28%, beta=1.3

P2 Index:
  base = 50
  (données markets.json pour EUFN si disponible)
  vol 28% → -10 = 40
  barrier → -5 = 35
  beta 1.3 > 1.1 → -(1.3-1.0)×10 = -3 → P2 = 32

→ MI: secteur bancaire = avoided sector (stagflation)
→ Claude pénalise P2: -5 à -10 supplémentaire
→ Verdict: "Secteur bancaire évité en régime macro actuel"
```

### 4.5 Callable TAUX FIXE

**Exemple:** Callable Taux Fixe 5% 8 ans (Swiss Life)

```
Détection: _isFixedRateProduct() = true
Pas de sous-jacent action → grader-rates-patch.js activé

P1 Rate:
  base = min(100, 5×10) = 50
  RF 8Y interpolé: 2.70% + 0.15×(8-5) = 2.90% (estimé)
  spread = 5% - 2.90% = 2.10% → +5
  Callable + taux "rising" (2Y) → +5 (faible proba call)
  Coupon garanti → +15
  Maturité 8Y → -5×ln(8/5) = -2
  P1 = 73

P2 Rate:
  base = 55 (non protégé)
  Duration: (8-3)×2.5 = -13
  Rate vol (5Y): 17.8bps → -4
  Yield curve normal, spread 0.47%: 0 (pas assez steep pour +5)
  Rate direction stable: 0
  Callable: +5
  P2 = 43

P3: base 70 (si proposition)

P4 Rate:
  benchmark = max(CAT 2.5%, RF 2.90%, ECB 2.0%) = 2.90%
  illiquidity = 0.5% + 0.15%×(8-2) = 1.4%
  effective_spread = 5% - 2.90% - 1.4% = 0.70%
  P4 = 30 + 0.70×12.5 = 39

Prompt Claude inclut:
  - Environnement taux ECB (2Y/5Y/10Y, courbe, direction)
  - MI bond_strategy (prefer_tips, avoid_hy)
  - Scénarios obligatoires: callé / tenu / défaut émetteur
```

### 4.6 Bond 12M / Liquidité (grade "-")

**Exemple:** Bond 12M Swiss Life

```
_isLiquidityProduct("Bond 12M un compartiment de Swiss Life")
  → "bond 12m" match LIQUIDITY_KEYWORDS → true

Court-circuit: pas de P1/P2/P3/P4
grade = "-"
verdict = "Produit de liquidité / parking cash"

Affichage:
  - Grade "-" ($) dans le badge
  - Comptabilisé dans "Liquidité structurés" de l'enveloppe
  - Pas inclus dans les analytics de performance
```

---

## 5. Ajustement IA (Claude Opus)

### 5.1 Modèle et configuration

```
Modèle: claude-opus-4-20250514
Endpoint: Cloudflare Worker (CONFIG.AI_ENDPOINT)
Max tokens: 1500
Ajustement max: ±15pts par pilier (avant MI sensitivity)
```

### 5.2 System Prompt

Construit par: `_buildSystemPrompt()` + `grader-mi-patch.js` + `grader-rates-patch.js`

```
Tu es un expert en produits structurés...

MARKET INTELLIGENCE:
- SJ dans secteur évité → malus P2 (-5 à -10)
- SJ dans secteur favorisé → bonus P2 (+3 à +5)
- Stagflation + cyclique → malus P1
- stress_flags → impact coupons conditionnels

[si produit taux fixe/callable:]
PRODUIT TAUX FIXE/CALLABLE:
- P1: Coupon vs taux sans risque
- P2: Duration + vol taux + courbe + direction
- Focus: crédit émetteur, réinvestissement, coût d'opportunité
```

### 5.3 User Prompt

Construit par: `_buildUserPrompt()` + `grader-mi-patch.js` + `grader-rates-patch.js`

```
## PRODUIT
Nom, type, coupon, barrière, SJ, maturité...

## DONNÉES SOUS-JACENT
Ticker, sector, Buffett, Quality, Vol 3Y, DD, Beta, Perfs...
[ou] Proxy ETF données réelles Twelve Data
[ou] Commodity: vol, beta, décorrélation

## MARKET INTELLIGENCE (Claude Opus CIO)
Régime: STAGFLATION (conf 4/5)
Secteurs évités: financials, consumer-discretionary
VIX: 22 | Brent: $101
Stratégie obligations: TIPS préférés, HY à éviter
Warnings: [si Brent > $105...]

## ENVIRONNEMENT TAUX [si produit taux]
BCE directeur: 2.15% | Dépôt: 2.0%
Euro AAA 2Y/5Y/10Y + courbe + direction

## SCORES DE BASE
P1=XX, P2=XX, P3=XX, P4=XX
```

### 5.4 MI Sensitivity (v5.0)

Réduit l'impact de l'IA pour les produits "safe" :

```
sensitivity = 1.0
si capitalProtection: ×0.3
si couponGaranti: ×0.5
si maturity > 5a: ×max(0.2, 1 - maturity/15)

max_adjustment = 15 × sensitivity

Exemple: capital protégé + garanti + 10 ans:
  sensitivity = 1.0 × 0.3 × 0.5 × 0.33 = 0.05
  max_adjustment = 15 × 0.05 = ±0.75pts (quasi neutre)
```

---

## 6. Améliorations v5.0 (Audit Expert)

Suite à l'audit expert (score initial 6.5/10, contre-analyse 7.5/10):

| # | Amélioration | Fichier | Impact |
|---|-------------|---------|--------|
| 1 | Barrière penalty ((b-30)/50)^2.0 | grader-v5-patch.js | Barrier 60%: 17%→36% |
| 2 | Beta seuil 1.0 + non-linéaire | grader-v5-patch.js | β1.5: -7.3pts |
| 3 | MI sensitivity | grader-v5-patch.js | Protected → IA ±2pts |
| 4 | Issuer rating (18 banques, CDS) | grader-v5-patch.js | CDS>100bps → cap C |
| 5 | USO → BNO (Brent proxy) | fetch-underlyings.py | Plus de contango |
| 6 | Confidence interval [low-high] | grader-v5b-patch.js | "B [58-72]" |
| 7 | Corrélation P3 (40+ SJ) | grader-v5b-patch.js | CAC+SX5E=-8pts |
| 8 | Vol implicite VIX vs réalisée | grader-v5b-patch.js | Ratio>1.3 → penalty |

---

## 7. Exemples concrets du portefeuille

### Produits en portefeuille (data/banks/)

| Banque | Produit | Type | SJ | Grade |
|--------|---------|------|-----|-------|
| SG | ATHENA sur ENI | Autocall/Phoenix | ENI S.p.A. | B 63 |
| SG | ATHENA Gold Miners | Autocall/Phoenix | Solactive GDX | A 79 |
| CIC | Phoenix EuroStoxx Banks | Autocall/Phoenix | EuroStoxx Banks | B 63 |
| Swiss Life | Bond 12M | Liquidité | — | - |
| Swiss Life | Callable Taux Fixe | Taux fixe callable | — | B~55 |

---

## 8. Fichiers et ordre de chargement

```html
<!-- index.html — ordre critique -->
<script src="js/config.js"></script>          <!-- CONFIG.AI_ENDPOINT -->
<script src="js/github.js"></script>          <!-- API GitHub -->
<script src="js/pdf.js"></script>             <!-- Extraction PDF -->
<script src="js/scoring.js"></script>         <!-- Grading core (P1-P4, _computeP*) -->
<script src="js/proposal-grader.js"></script> <!-- gradeProposal(), _callClaude -->
<script src="js/grader-mi-patch.js"></script> <!-- 1) Opus model + MI injection -->
<script src="js/grader-p2-patch.js"></script> <!-- 2) P2 proxy indices/commodités -->
<script src="js/grader-v5-patch.js"></script> <!-- 3) Barrier + beta + MI sensitivity + issuer -->
<script src="js/grader-v5b-patch.js"></script><!-- 4) CI + correlation P3 + vol implicite -->
<script src="js/grader-rates-patch.js"></script><!-- 5) Callable bonds + ECB rates -->
```

### Override chain (chaque patch surcharge le précédent):

```
scoring.js: _computeP1, _computeP2, _computeP3, _computeP4
  └── grader-mi-patch.js: _callClaude (→ Opus), _buildUserPrompt (+MI), _buildSystemPrompt (+MI)
       └── grader-p2-patch.js: _extractStockData (+proxy), _computeP2 (+index/commodity), _collectContext (+map+macro+extra)
            └── grader-v5-patch.js: _computeP1 (+barrier v5), _computeP2 (+beta v5), _callClaude (+MI sensitivity), gradeProposal (+issuer)
                 └── grader-v5b-patch.js: _computeP3 (+correlation), _computeP2Index (+vol implicite), gradeProposal (+CI), renderGradingSection (+CI display)
                      └── grader-rates-patch.js: _computeP1 (+rate), _computeP2 (+rate), _computeP4 (+rate), _buildUserPrompt (+ECB), _buildSystemPrompt (+callable)
```

---

## 9. Limites et roadmap

### Limites actuelles

1. **Proxy ETF ≠ indice exact** — FEZ ≠ Eurostoxx 50 (tracking error, devise USD, dividendes)
2. **Émetteur réel non extrait** — Le nom de l'émetteur vient du champ `bankId`, pas de la brochure PDF
3. **Vol implicite partielle** — Seul VIX est utilisé, pas VSTOXX directement (proxy VIX+3%)
4. **Pas de backtest** — Aucune validation empirique grade vs P&L réel
5. **Euribor manquant** — ECB API retourne 404 pour Euribor 3M/6M

### Roadmap v6.0

| Priorité | Feature | Effort |
|----------|---------|--------|
| P1 | VSTOXX direct (API payante) | Moyen |
| P1 | Extraction émetteur réel du PDF | Moyen |
| P2 | Backtest: grade historique vs performance réelle | Élevé |
| P2 | Corrélation implicite pour worst-of | Élevé |
| P3 | Grade structurel vs signal d'entrée (séparation) | Moyen |

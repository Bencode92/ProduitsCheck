# StructBoard v6.2 — Récap Complet pour Revue CFO

## Session Mars-Avril 2026 — 5 sessions de développement

---

# 1. CE QUI A ÉTÉ CONSTRUIT

## 1.1 Allocateur Unifié v2 — 6 règles d'allocation

L'allocateur est le moteur de décision de StructBoard. Il recommande quoi faire avec le cash libre et les CAT à échéance.

### Règle 1 — Ne jamais sortir d'un CAT pour un CAT moins bon
```
OPTIPLUS 3.03% → CIC 2.80% = INTERDIT
Le système compare automatiquement le taux du nouveau placement au taux existant.
```

### Règle 2 — Seuil de spread progressif par durée
Un structuré doit battre le CAT d'un minimum proportionnel au lock-up :
```
≤ 24 mois  : +0.50%
25-48 mois : +1.00%
49-72 mois : +1.50%
> 72 mois  : +2.00%
```

### Règle 3 — Montant exact par contrat individuel
Les CAT sont traités par contrat, pas par bloc :
```
AVANT : 4× OPTIPLUS 600K€ → sort tout → 213K structuré + 496K CIC
APRÈS : 1× OPTIPLUS 150K€ → sort → structuré, 3× OPTIPLUS → GARDER
```

### Règle 4 — Market Intelligence influence le timing
```
miFactor = clamp(1.0 + prob_hike_BCE × 0.5, 0.5, 1.5)
Actuellement : prob_hike 35% → miFactor 1.175 → seuils relevés de 17.5%
```

### Règle 5 — Objectif utilisateur
3 modes : Long terme / Court terme / En attente
- En attente = 0 allocation, tout reste en place
- Court terme = seuils × 1.5 (seuls les spreads exceptionnels passent)
- Le cap 30% par produit reste dur dans tous les cas

### Règle 6 — Concentration émetteur max 30%
```
Banque Populaire à 57% → aucun nouveau structuré BP accepté
Warning rouge sur les contrats CAT à l'échéance : "Diversifier"
```

## 1.2 Grading v7.1 — Système de notation en 4 piliers

### Architecture
```
Score = P1 (30%) + P2 (20%) + P3 (15%) + P4 (30%)
Grades : A (70+), B (55-69), C (45-54), D (25-44), F (<25)
```

### Pilier 1 — Rendement ajusté (30%)
- Estimation Black-Scholes pour les produits actions
- Estimation probabiliste pour Range Accrual / Digitale taux
- Corrélation réelle (Twelve Data) pour la Dispersion
- Ajustement stagflation (lock-in premium, call probability)

### Pilier 2 — Qualité sous-jacent (20%)
- Vol, drawdown, score Buffett pour les actions
- Qualité institutionnelle pour les taux (TEC10, Euribor)
- Détection automatique des sous-jacents taux (TEC10, Euribor, CMS → "rates")

### Pilier 3 — Fit portefeuille (15%)
- Dispersion = décorrélé (+15)
- Capital garanti = qualité (+10)
- Range accrual = diversificateur taux (+5)

### Pilier 4 — Prime vs CAT (30%)
```
Benchmark unique : 2.80% (CIC Progressif 36M confirmé)
Spread = rdtNet - CAT - illiquidityPremium
illiquidityPremium = 0.50% + 0.15% × max(0, maturité - 2)
```

### Calibration
- Kendall τ = 1.0 sur 9 produits de test (classement parfait)
- 32 tests automatisés (grading + allocation) : 100% pass
- 9/9 grades corrects (100%)

## 1.3 Support Range Accrual — Nouveau type de produit

Pipeline complet pour les Range Accrual (corridor sur taux de référence) :

### Parsing
- Détection automatique dans les brochures PDF
- Extraction des bornes du corridor, taux de référence, observation
- Formulaire avec champs spécifiques (bornes, Euribor/CMS/TEC, daily/monthly)

### Grading spécifique
```javascript
probInRange = f(taux_actuel, bornes, vol, maturité)
// Biais stagflation : ×0.85 si plus proche borne haute (BCE hawkish)
// Bonus observation daily : +3 (perte granulaire vs bloc)
rdtEspéré = coupon_max × probInRange
```

### Affichage corridor visuel
```
📊 Corridor Range Accrual
Euribor 3 mois · Observation Journalière    DANS LE RANGE
[████████████●█████████████████████]
1.75%           2.50% actuel         3.50%
Distance borne basse: 0.75%    Distance borne haute: 0.50%
```

## 1.4 Module Analytique enrichi

### Échéancier ALM (Asset-Liability Management)
- Tous les actifs (CAT ByCam + CAT Caméléons + structurés + liquidités)
- Résumé par année avec montants et rendements
- Détection des "trous de maturité" (années sans échéance)
- Colonnes : produit, type, entité, banque, montant, taux, rdt/an, échéance, mois restants

### Stress Test Liquidité
- 4 scénarios : besoin de 100K, 300K, 500K, 1M€
- Sources triées par coût de sortie croissant
- Coûts de sortie chiffrés pour chaque CAT :
  - CAT Croissance ByCam : 0€ (4ème semestre, earlyRate = normal)
  - OPTIPLUS CONQUÊTE : -363€/contrat (1 mois d'intérêts)
  - OPTIPLUS 5 ANS : -647€/contrat (1 mois d'intérêts)
  - CATIP CIC : -6 300€ (estimation 50% intérêts restants)
- LCR simplifié : **90%** (actifs mobilisables sous 30 jours / patrimoine)

## 1.5 Benchmark CAT unifié

Source unique `window._getCATBenchmark()` = **2.80%** (CIC Progressif 36M confirmé)
Utilisé dans : grading P4, optimizer, allocateur, synthèse patrimoniale.
Plus de divergence 2.5% / 2.8% entre les couches.

---

# 2. CLASSEMENT DES 11 PRODUITS ANALYSÉS

| # | Produit | Grade | Score | rdtNet | Capital | Éligible |
|---|---------|:-----:|:-----:|:------:|:-------:|:--------:|
| 1 | Dispersion US Tech | **B** | 68 | 10.4% | Garanti | **OUI** |
| 2 | Digitale Mémoire TEC10 | **C** | 53 | ~3.5% | Garanti | NON |
| 3 | Range Accrual Euribor | **C** | 51 | 3.39% | Garanti | NON |
| 4 | TF Callable SG 5% | **C** | 51 | 3.67% | Garanti | NON |
| 5 | Digitale WO LVMH/CA | **C** | 46 | 1.20% | Garanti | NON |
| 6 | Phoenix Richemont | **D** | 44 | 1.22% | Non | NON |
| 7 | Euro Stoxx Banks 9.7% | **D** | 40 | 3.08% | Non | NON |
| 8 | Athena ISP | **D** | 34 | 1.69% | Garanti | NON |
| 9 | Objectif Mai 9.7% | **D** | 32 | 1.67% | Non | NON |
| 10 | Oxygène 7% | **D** | 30 | 0.31% | Garanti | NON |
| 11 | Gold Miners | **F** | 21 | -10.67% | Non | NON |

**1 seul produit éligible à l'allocateur** (Dispersion) — posture ultra-sélective en stagflation.

---

# 3. RÉSULTAT D'ALLOCATION — SCÉNARIO DE RÉFÉRENCE

Config : ByCam 177K long terme + Caméléons 600K moyen terme (OPTIPLUS inclus)

### ByCam
| Action | Montant | Rendement |
|--------|---------|-----------|
| Structuré (Dispersion 10.4%) | 100K€ | +10 450€/an |
| CIC Progressif 36M (2.80%) | 77K€ | +2 156€/an |

### Caméléons
| Contrat | Action | Rendement |
|---------|--------|-----------|
| OPTIPLUS #1 (150K) | ARBITRER → Structuré 10.4% | +15 675€/an |
| OPTIPLUS #2 (150K) | GARDER 2.90% | +4 350€/an |
| OPTIPLUS #3 (150K) | GARDER 2.90% | +4 350€/an |
| OPTIPLUS #4 (150K) | GARDER 2.90% | +4 350€/an |
| Bond 12M SL (109K) | GARDER (aucun SL éligible) | +2 725€/an |

### Synthèse
```
Rendement AVANT optimisation :  58 386€/an (taux moyen 3.02%)
Rendement APRÈS optimisation :  84 511€/an (taux moyen 4.37%)
Gain net annuel :              +26 125€/an (+1.35%)
Capital garanti à 100% sur toutes les nouvelles allocations
```

---

# 4. GESTION DES RISQUES

## 4.1 Exposition FGDR

| Émetteur | Total | FGDR couvert | Exposé | % patrimoine |
|----------|:-----:|:------------:|:------:|:------------:|
| Banque Populaire | 1 150K€ | 100K€ | 1 050K€ | **57% ⚠️** |
| Société Générale | 360K€ | 100K€ | 260K€ | 18% |
| CIC | 300K€ | 100K€ | 200K€ | 15% |
| Swiss Life | 199K€ | — | 199K€ | 10% |

**Alerte concentration** : BP à 57% → l'allocateur bloque tout nouveau structuré BP et recommande la diversification à l'échéance sept 2026.

## 4.2 Stress Test Liquidité

| Besoin | Couvert | Coût sortie |
|:------:|:-------:|:-----------:|
| 100K€ | ✓ | 0€ |
| 300K€ | ✓ | 0€ |
| 500K€ | ✓ | -252€ |
| 1 000K€ | ✓ | -1 462€ |

**LCR simplifié : 90%** — 90% du patrimoine mobilisable sous 30 jours.

## 4.3 Contexte Entités

- **ByCam** : pas de contrainte de trésorerie, 177K€ 100% déployables
- **Caméléons** : CAT = réserve de liquidité (sortie 32j préavis), réserves externes hors périmètre
- L'alerte "réserve insuffisante" ne s'applique pas dans ce contexte

## 4.4 Dispersion ≠ Exposition Tech

La Dispersion US Tech n'est **pas** une exposition directionnelle au tech :
- Le rendement dépend de la dispersion (écart de performance), pas de la direction
- Capital garanti 100% — le seul risque est un rendement faible (pas une perte)
- En crise, la corrélation baisse → le coupon de dispersion augmente (contra-cyclique)
- Corrélation réelle 0.43 (Twelve Data) → rdtNet 9.1-10.4%

## 4.5 Vue ALM

```
Sept 2026 : 4× OPTIPLUS 600K€ → PIC D'ÉCHÉANCE (fenêtre de diversification BP)
2027      : CAT Croissance SG 110K€ + CATVAIR 50K€
2028      : CATIP CIC 200K€
2029      : 2× OPTIPLUS 5 ANS 500K€
2030      : TROU — aucune échéance → planifier un CAT en 2030
2031+     : Structurés portefeuille
```

**Duration moyenne pondérée : 3.1 ans** (raisonnable en stagflation)

---

# 5. LIMITES CONNUES ET AXES D'AMÉLIORATION

## 5.1 Limites identifiées

| Limite | Impact | Sévérité |
|--------|--------|:--------:|
| P2 produits taux sous-évalué par l'IA | Digitale TEC10 P2=33 au lieu de ~70 | Moyen |
| Double pénalité "capital non garanti" P3+P4 | Euro Stoxx Banks P4=13 excessif | Faible |
| Vol Euribor approximée (proxy yield 2Y) | Probabilité corridor ±5% | Faible |
| 1 seul produit éligible allocateur | Voulu en stagflation, mais limitant | Design |
| TF Callable potentiellement sous-évalué | P1=45 pour coupon garanti (devrait être ~55-60) | Moyen |

## 5.2 Ce qui a été corrigé cette session

| Bug | Correction |
|-----|-----------|
| CAT → CAT moins bon (OPTIPLUS → CIC) | Règle 1 : compare offerRate vs contrat.rate |
| 600K en bloc au lieu de 1 contrat 150K | Règle 3 : allocation per-contract, contrats entiers |
| Bond 12M SL "réalloué" sans produit éligible | Auto-keep quand aucun SL ne bat 2.5% |
| Benchmark CAT incohérent (2.5% vs 2.8%) | Source unique _getCATBenchmark() = 2.80% |
| Vol 22.46% affichée pour Euribor | Badge corridor visuel remplace table stock |
| TEC10 classé "single-stock" | Détection auto taux (TEC, Euribor, CMS → "rates") |
| Section "à réallouer" quand tout = GARDER | "✋ à conserver" + suppression doublon |
| Récursion infinie _bestCATRate | Fix boucle circulaire _getCATBenchmark |

## 5.3 Métriques de qualité

| Métrique | Valeur |
|----------|--------|
| Tests automatisés | 32 (100% pass) |
| Kendall τ (classement) | 1.0 (parfait) |
| Grade accuracy | 9/9 (100%) |
| Écart IA vs théorique | ±3 points |
| Scénarios allocateur testés | 6 (tous conformes) |

---

# 6. ARCHITECTURE TECHNIQUE

## 6.1 Stack
- Frontend vanilla JS (62 fichiers, ~18K LOC)
- Données JSON (GitHub API)
- Grading : pipeline local + Claude IA (ajustement ±5 pts)
- Market data : ECB + Twelve Data (via Cloudflare Worker)
- Hébergement : GitHub Pages

## 6.2 Fichiers clés modifiés
| Fichier | Rôle | LOC modifiées |
|---------|------|:------------:|
| unified-allocator.js | 6 règles d'allocation | +400 |
| grader-rates-patch.js | Scoring Range Accrual + taux | +150 |
| analytics.js | ALM + Stress Test | +300 |
| brochure-parser.js | Parsing Range Accrual + détection taux | +80 |
| proposal-grader-v7.js | Normalize Range Accrual | +20 |
| grader-v6-calibration-patch.js | P3 + P4 BS exemption | +10 |
| edit-modal.js | Formulaire Range Accrual | +30 |
| grader-ui-patch.js | Badge corridor visuel | +40 |

---

*StructBoard v6.2.0 — 03 avril 2026*
*Grading v7.1 · Allocateur v2.1 · Range Accrual v1.0 · Stress Test v1.0*

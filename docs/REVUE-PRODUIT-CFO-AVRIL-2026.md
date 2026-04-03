# StructBoard — Revue Produit Complète pour le CFO

## Outil de Gestion de Trésorerie Patrimoniale
**Date :** 03 avril 2026 | **Version :** 6.2.0 | **Patrimoine géré :** 1 936 000€

---

# ONGLET 1 — PRODUITS STRUCTURÉS

## Vue d'ensemble

L'onglet "Produits Structurés" est le registre central. Il contient **5 produits en portefeuille** (déjà souscrits) et **78 propositions** de 3 banques partenaires (CIC, Société Générale, Swiss Life).

### Portefeuille actuel — 5 produits (299 000€)

| Produit | Banque | Montant | Grade | Coupon | Maturité | Entité |
|---------|--------|:-------:|:-----:|:------:|:--------:|:------:|
| SL - ATHENA PRIVILEGE ENI | Swiss Life | 30 000€ | C (54) | 5.70% conditionnel | 12 ans | Cam. |
| Bond 12M Swiss Life Funds | Swiss Life | 109 000€ | $ (Liquidité) | ~2.5% | Permanent | Cam. |
| Oxygène Objectif Mars 2026 | Swiss Life | 30 000€ | C (53) | 7.00% conditionnel | 10 ans | Cam. |
| SL - PHOENIX MEMOIRE BNP | Swiss Life | 30 000€ | B (71) | 7.50% conditionnel | 8 ans | Cam. |
| TARN TEC 10 Décembre 2035 | CIC | 100 000€ | C (54) | 6.00% conditionnel | 10 ans | Cam. |

**Observations clés :**
- 100% des produits structurés sont dans l'entité Caméléons
- 3/5 sont Swiss Life (concentration distributeur)
- Le Bond 12M (109K€) est un véhicule de parking cash, pas un structuré
- Les produits existants ont des grades C-B : corrects mais pas exceptionnels
- Aucun produit en portefeuille n'a de capital garanti avec un rdtNet supérieur au CAT

### Propositions analysées — 78 produits de 3 banques

| Banque | Propositions | Gradées | Éligibles allocateur |
|--------|:-----------:|:-------:|:-------------------:|
| CIC | 25 | ~15 | 1 (Range Accrual*) |
| Société Générale | 22 | ~12 | 1 (Dispersion) |
| Swiss Life | 31 | ~15 | 0 |
| **Total** | **78** | **~42** | **1 confirmé** |

*Le Range Accrual CIC est gradé C (51) — au-dessus du CAT mais sous le seuil allocateur en stagflation.

### Comment le grading fonctionne

Chaque produit est analysé automatiquement via un pipeline en 7 étapes :

```
PDF brochure → Extraction IA → Normalisation → Scoring local (P1-P4)
→ Ajustement Claude IA (±5 pts) → Grade final → Fiche détaillée
```

**Les 4 piliers de notation (score sur 100) :**

| Pilier | Poids | Mesure | Exemple Dispersion |
|--------|:-----:|--------|:------------------:|
| P1 Rendement | 30% | rdtNet après probabilités BS | 95/100 |
| P2 Sous-jacent | 20% | Qualité/stabilité du sous-jacent | 69/100 |
| P3 Portefeuille | 15% | Complémentarité avec l'existant | 65/100 |
| P4 Prime/CAT | 30% | Spread net vs placement sans risque | 52/100 |

**Benchmark CAT unique :** 2.80% (CIC Progressif 36M, offre confirmée)

### Fiche produit type — ce que le CFO voit

Pour chaque produit, la fiche affiche :
- **Grade** avec badge couleur (A vert → F rouge)
- **Mécanisme** expliqué en clair
- **4 scénarios de rendement** : Optimiste / Base / Stress / Worst
- **3 scénarios régime** : Actuel (stagflation) / Bull / Crash
- **Risques** identifiés par l'IA
- **Exposition FGDR** et risque crédit émetteur
- **Badge corridor** pour les Range Accrual (position taux dans le range)

### Top 5 et Bottom 5 des propositions

**Top 5 :**

| # | Produit | Grade | rdtNet | Cap. garanti | Pourquoi |
|---|---------|:-----:|:------:|:------------:|----------|
| 1 | Dispersion US Tech (SG) | B (68) | 10.4% | OUI | Contra-cyclique, corr. 0.43, 3 ans |
| 2 | Digitale Mémoire TEC10 (CIC) | C (53) | ~3.5% | OUI | Mémoire, TEC10 ≤ 4.4%, 5 ans |
| 3 | Range Accrual Euribor (CIC) | C (51) | 3.39% | OUI | Corridor 1.75-3.50%, daily, 5 ans |
| 4 | TF Callable SG 5% | C (51) | 3.67% | OUI | Coupon garanti, 10 ans callable |
| 5 | Digitale WO LVMH/CA (CIC) | C (46) | 1.20% | OUI | Capital garanti mais rdtNet faible |

**Bottom 5 :**

| # | Produit | Grade | rdtNet | Pourquoi |
|---|---------|:-----:|:------:|----------|
| 7 | Euro Stoxx Banks 9.7% | D (40) | 3.08% | Pas capital garanti, secteur bancaire |
| 8 | Athena ISP | D (34) | 1.69% | 10 ans illiquide, rdtNet < CAT |
| 9 | Objectif Mai 9.7% | D (32) | 1.67% | Basket toxique, pas capital garanti |
| 10 | Oxygène 7% | D (30) | 0.31% | rdtNet quasi nul après ajustement BS |
| 11 | Gold Miners | F (21) | -10.67% | Décrément détruit la valeur |

### Support des nouveaux types

Le système supporte désormais le **Range Accrual** (corridor sur taux) :

```
Coupon = Taux_max × (jours_dans_le_range / jours_total)
Prob estimée = f(taux_actuel, bornes, vol, maturité, régime)
Biais stagflation : ×0.85 si BCE hawkish menace la borne haute
```

Résultat pour le CIC Range Accrual Euribor : prob 65%, rdtEspéré 3.39%, grade C (51).

---

# ONGLET 2 — COMPTES À TERME

## Vue d'ensemble

L'onglet "Comptes à Terme" gère **10 contrats CAT** pour un total de **1 460 000€** répartis sur 2 entités et 3 banques.

### Portefeuille CAT par entité

**ByCam — 110 000€ (2 contrats)**

| Contrat | Banque | Montant | Taux TRAAB | Type | Échéance |
|---------|--------|:-------:|:----------:|:----:|:--------:|
| CAT Croissance +3A | Société Générale | 60 000€ | 3.21% | Progressif | sept. 2027 |
| CAT Croissance +3A (copie) | Société Générale | 50 000€ | 3.21% | Progressif | sept. 2027 |

**Caméléons — 1 350 000€ (8 contrats)**

| Contrat | Banque | Montant | Taux TRAAB | Type | Échéance |
|---------|--------|:-------:|:----------:|:----:|:--------:|
| OPTIPLUS CONQUÊTE (×4) | Banque Populaire | 4 × 150 000€ | 2.90% | Progressif | sept. 2026 |
| OPTIPLUS 5 ANS Réf.1 | Banque Populaire | 250 000€ | 3.10% | Progressif | août 2029 |
| OPTIPLUS 5 ANS Réf.2 | Banque Populaire | 250 000€ | 3.10% | Progressif | août 2029 |
| CATVAIR 5 ANS | Banque Populaire | 50 000€ | 3.50% | Progressif | janv. 2028 |
| CATIP ENT 3ANS | CIC | 200 000€ | 2.70% | Progressif | août 2028 |

### Concentration contrepartie

```
Banque Populaire : 1 150 000€ / 1 936 000€ = 59% du patrimoine ⚠️
Société Générale :   110 000€ = 6%
CIC              :   200 000€ = 10%
```

**Alerte : 59% sur Banque Populaire dépasse largement le seuil de 30% recommandé.**

Opportunité de rééquilibrage : sept. 2026, 4× OPTIPLUS (600K€) arrivent à échéance → fenêtre pour diversifier.

### Offres CAT disponibles (confirmées CIC)

| Produit | Durée | Taux | Type |
|---------|:-----:|:----:|:----:|
| CAT Fixe 2m | 2M | 2.20% | Fixe |
| CAT Fixe 3m | 3M | 2.20% | Fixe |
| CAT Fixe 6m | 6M | 2.30% | Fixe |
| CAT Fixe 12m | 12M | 2.40% | Fixe |
| CAT Progressif 18m | 18M | 2.60% | Progressif |
| CAT Progressif 36m | 36M | **2.80%** | Progressif |
| CAT Progressif 60m | 60M | **2.90%** | Progressif |

**Benchmark : 2.80%** (CIC Progressif 36M) — utilisé comme référence dans tout le système.

### Règle 1 appliquée aux CAT

L'allocateur vérifie automatiquement : si le meilleur CAT disponible (CIC 2.80%) est inférieur au taux du CAT existant (OPTIPLUS 2.90%), la recommandation est **GARDER**, pas renouveler.

```
OPTIPLUS 2.90% → CIC 2.80% = INTERDIT (Règle 1)
OPTIPLUS 2.90% → CIC 2.90% 60M = ACCEPTÉ (même taux, durée plus longue → lock-in)
```

---

# ONGLET 3 — ANALYSEUR DE BROCHURE

## Vue d'ensemble

L'analyseur est l'outil d'import des nouvelles propositions. On y glisse un PDF de brochure et le système extrait automatiquement toutes les données.

### Pipeline d'analyse

```
1. UPLOAD     → Glisser-déposer du PDF
2. EXTRACTION → Claude IA lit la brochure (10-30 secondes)
3. FORMULAIRE → Les champs sont pré-remplis, l'utilisateur vérifie
4. AJOUT      → Le produit est ajouté à la banque avec grading automatique
```

### Types de produits supportés

| Type | Détection | Extraction automatique |
|------|-----------|----------------------|
| Autocall / Phoenix | ✓ | Coupon, trigger, barrière, step-down |
| Dispersion | ✓ | Participation, panier, corrélation |
| Taux Fixe / Callable | ✓ | Coupon garanti, callable, maturité |
| **Range Accrual** | ✓ (NOUVEAU) | Bornes corridor, référence, observation |
| Capital Garanti | ✓ | Protection, coupon conditionnel |
| Digitale à Mémoire | ✓ | Seuil, mémoire, taux de référence |
| Worst-of / Panier | ✓ | Sous-jacents, barrière |

### Détection automatique des sous-jacents taux

Le parser reconnaît automatiquement les références taux :
```
TEC 10, TEC 5      → underlyingType = "rates"
Euribor 3M, 6M     → underlyingType = "rates"
CMS 10 ans, 2 ans  → underlyingType = "rates"
ESTER, €STR, EONIA  → underlyingType = "rates"
```

Cela évite de classer un produit taux comme un "single-stock" (bug corrigé dans cette version).

### Formulaire Range Accrual

Quand un Range Accrual est détecté, une section spécifique apparaît :

```
📊 RANGE ACCRUAL
├── Borne basse (%) : 1.75
├── Borne haute (%) : 3.50
├── Taux de référence : Euribor 3 mois
└── Observation : Journalière
```

### Volume de traitement

- **78 brochures analysées** à ce jour
- 3 banques sources : CIC (25), SG (22), Swiss Life (31)
- Temps moyen d'analyse : 15-30 secondes par brochure
- Taux de succès d'extraction : ~95% (5% nécessitent correction manuelle)

---

# ONGLET 4 — ALLOCATEUR

## Vue d'ensemble

L'allocateur est le moteur de décision. Il recommande quoi faire avec le cash libre et les CAT à échéance, en appliquant 6 règles strictes.

### Inputs

| Donnée | Valeur actuelle |
|--------|----------------|
| Cash libre ByCam | 177 000€ |
| Cash libre Caméléons | 0€ |
| CAT à échéance (< 8 mois) | 4× OPTIPLUS 600 000€ (sept. 2026) |
| Bond 12M Swiss Life | 109 000€ |
| Structurés éligibles | 1 (Dispersion B 68) |
| Régime MI | Stagflation (confiance 4/5) |
| prob_hike BCE | 35% |
| Objectif utilisateur | Long terme / Court terme / En attente |

### Les 6 règles

| Règle | Description | Statut |
|:-----:|-------------|:------:|
| 1 | Ne jamais sortir d'un CAT pour un CAT moins bon | ✓ Actif |
| 2 | Spread progressif par durée (0.5% → 2.0%) × MI factor | ✓ Actif |
| 3 | Montant exact par contrat individuel (pas par bloc) | ✓ Actif |
| 4 | Market Intelligence ajuste les seuils (prob_hike) | ✓ Actif |
| 5 | Objectif utilisateur (long/court/attente) | ✓ Actif |
| 6 | Concentration émetteur max 30% du patrimoine | ✓ Actif |

### Scénario de référence — Long terme

**ByCam (177K€) :**

| Action | Montant | Produit | Rdt/an |
|--------|:-------:|---------|:------:|
| Structuré | 100 000€ | Dispersion 10.4% (SG) | +10 450€ |
| CAT | 77 000€ | CIC Progressif 36M 2.80% | +2 156€ |

**Caméléons (600K€ OPTIPLUS inclus) :**

| Contrat | Action | Justification | Rdt/an |
|---------|--------|---------------|:------:|
| OPTIPLUS #1 | **ARBITRER** → Dispersion | 10.4% bat 2.90% + spread 1.0% | +15 675€ |
| OPTIPLUS #2 | **GARDER** | CIC 2.80% ≤ OPTIPLUS 2.90% | +4 350€ |
| OPTIPLUS #3 | **GARDER** | CIC 2.80% ≤ OPTIPLUS 2.90% | +4 350€ |
| OPTIPLUS #4 | **GARDER** | CIC 2.80% ≤ OPTIPLUS 2.90% | +4 350€ |
| Bond 12M SL | **GARDER** | Aucun produit SL éligible | +2 725€ |

### Synthèse avec scénarios

```
                          Médian        Adverse (corr. stress)
Rendement AVANT :        58 386€/an
Rendement APRÈS :        84 511€/an    ~65 000€/an
Gain net :              +26 125€/an    +6 600€/an
Taux moyen patrimoine :  4.37%          3.36%
Capital garanti :        100% sur toutes les nouvelles allocations
```

### Recommandation par contrat CAT

Le système affiche pour chaque contrat :
- ⚡ **ARBITRER** — si un structuré bat le CAT + spread
- ✋ **GARDER** — si aucune offre ne bat le taux actuel
- 🔄 **RENOUVELER** — si une offre CAT est meilleure
- ⏳ **ATTENDRE** — si le MI recommande de patienter

Avec warning de diversification si l'émetteur > 30% :
```
⚠️ Banque Populaire = 57% du patrimoine (max 30%). Diversifier à l'échéance.
```

### Modes d'utilisation

| Mode | Description |
|------|-------------|
| **Auto** | Répartition selon le régime MI (stagflation = 50% moyen / 50% long) |
| **Personnalisé** | L'utilisateur définit les montants par horizon |
| **Objectif Long terme** | Structurés favorisés dans les limites |
| **Objectif Court terme** | Seuils × 1.5, seuls les spreads exceptionnels passent |
| **Objectif En attente** | 0 allocation, tout reste en place |

---

# ONGLET 5 — ANALYTIQUE

## Vue d'ensemble

L'onglet Analytique est le tableau de bord de synthèse. Il consolide tout le patrimoine (structurés + CAT + liquidités) avec 3 vues complémentaires.

### KPI en tête

| Métrique | Valeur |
|----------|--------|
| Total investi | 1 759 000€ (structurés 299K + CAT 1 460K) |
| Cash libre | 177 000€ (ByCam) |
| Rendement annuel estimé | ~58 386€/an |
| Taux moyen pondéré | 3.02% |
| Nombre de placements | 15 (5 structurés + 10 CAT) |

### Vue 1 — Échéancier ALM (Asset-Liability Management)

Tableau complet de tous les actifs avec échéances :

```
SEPT 2026    4× OPTIPLUS 600K€         ← PIC D'ÉCHÉANCE
SEPT 2027    2× CAT Croissance SG 110K€
JANV 2028    CATVAIR 50K€
AOÛT 2028    CATIP CIC 200K€
AOÛT 2029    2× OPTIPLUS 5 ANS 500K€
2030         AUCUNE ÉCHÉANCE            ← TROU (planifier un CAT)
JANV 2034    Phoenix Mémoire BNP 30K€
DÉC 2035     TARN TEC10 100K€
MARS 2036    Oxygène Objectif 30K€
DÉC 2037     Athena ENI 30K€
PERMANENT    Bond 12M SL 109K€
```

**Résumé par année** avec cards visuelles : montant + rendement + nombre de placements.
**Trous de maturité** signalés en rouge (ex: 2030 = aucune échéance).

**Duration moyenne pondérée : 3.1 ans** (raisonnable en stagflation).

### Vue 2 — Stress Test Liquidité

4 scénarios : "Si j'ai besoin de X€ sous 30 jours"

| Besoin | Couvert | Sources | Coût sortie |
|:------:|:-------:|---------|:-----------:|
| 100 000€ | ✓ | Cash ByCam | 0€ |
| 300 000€ | ✓ | Cash + 1 OPTIPLUS | 0€ |
| 500 000€ | ✓ | Cash + 3 OPTIPLUS | -252€ |
| 1 000 000€ | ✓ | Cash + CAT + Bond | -1 462€ |

**LCR simplifié : 90%** — 90% du patrimoine mobilisable sous 30 jours.

**Coûts de sortie détaillés par contrat :**

| Source | Montant | Coût sortie | Délai | Détail |
|--------|:-------:|:-----------:|:-----:|--------|
| Cash ByCam | 177K€ | 0€ | Immédiat | Disponible |
| CAT Croissance SG (×2) | 110K€ | 0€ | 32 jours | earlyRate = taux normal (4ème sem.) |
| Bond 12M SL | 109K€ | 0€ | Variable | Rachat OPCVM |
| OPTIPLUS CONQUÊTE (×4) | 600K€ | -363€/contrat | 32 jours | Perte 1 mois intérêts |
| OPTIPLUS 5 ANS (×2) | 500K€ | -647€/contrat | 32 jours | Perte 1 mois intérêts |
| CATVAIR | 50K€ | -146€ | 32 jours | Perte 1 mois intérêts |
| CATIP CIC | 200K€ | -6 300€ | 32 jours | ~50% intérêts restants (estimé) |
| Structurés | 190K€ | -3% décote | Non garanti | Pas de marché secondaire |

### Vue 3 — Graphiques de répartition

| Graphique | Ce qu'il montre |
|-----------|----------------|
| Rendement par produit | Bar chart des rendements annuels en € |
| Flux de trésorerie 10 ans | Projection cumulée structurés + CAT |
| Par Banque | Répartition (BP 59%, CIC 15%, SG 18%, SL 10%) |
| Par Type | CAT 83%, Autocall 10%, Autre 7% |
| Par Entreprise | Cam. 94%, ByCam 6% |

---

# EXPOSITION FGDR & RISQUE CRÉDIT

| Émetteur | Total | FGDR couvert | Exposé | % patrimoine | Statut |
|----------|:-----:|:------------:|:------:|:------------:|:------:|
| Banque Populaire | 1 150K€ | 100K€ | 1 050K€ | **57%** | ⚠️ CRITIQUE |
| Société Générale | 360K€ | 100K€ | 260K€ | 18% | OK |
| CIC | 300K€ | 100K€ | 200K€ | 15% | OK |
| Swiss Life | 199K€ | — | 199K€ | 10% | OK |
| **TOTAL** | **2 009K€** | **300K€** | **1 709K€** | | **15% couvert** |

**Les structurés ne sont pas couverts par le FGDR** — risque crédit émetteur pur.
Les CAT sont couverts jusqu'à 100K€ par banque (FGDR).

---

# CONTEXTE MARCHÉ (Market Intelligence)

| Indicateur | Valeur | Impact StructBoard |
|-----------|--------|-------------------|
| Régime | **Stagflation** (confiance 4/5) | Capital garanti privilégié |
| Brent | $122 (+14% en 5j) | Choc pétrolier → inflation |
| PCE | 2.83% | Au-dessus target Fed |
| Prob hike BCE | 35% | Seuils allocateur relevés (+17.5%) |
| VIX | 22 | Stress modéré |
| Euribor 3M (estimé) | ~2.50% | Range Accrual dans le corridor |
| OAT 10Y | 3.07% | TEC10 sous seuil 4.4% (Digitale OK) |
| Fed stance | Hawkish hold | Pas de baisse de taux imminente |

**Impact sur les décisions :**
- Profil stagflation = 0% immédiat / 0% court / 50% moyen / 50% long
- Duration cap recommandé : 48 mois
- Secteurs évités : tech, financials, communication-services
- Cash tactique : 5-8% recommandé

---

# MÉTRIQUES DE QUALITÉ DU SYSTÈME

| Métrique | Valeur | Interprétation |
|----------|:------:|----------------|
| Kendall τ | **1.0** | Classement parfait sur 9 produits de test |
| Tests automatisés | **32** | 100% pass |
| Grade accuracy | **9/9** | 100% des grades corrects |
| Écart IA vs théorique | **±3 pts** | Dans la marge acceptable |
| Scénarios allocateur testés | **6** | Tous conformes aux prédictions |
| Bugs corrigés cette session | **8** | Voir changelog |

---

# LIMITES IDENTIFIÉES

| # | Limite | Sévérité | Plan |
|---|--------|:--------:|------|
| 1 | P2 sous-évalue les produits taux (33 vs ~70 attendu) | Moyen | Scoring quantitatif taux en développement |
| 2 | Double pénalité "capital non garanti" P3+P4 | Faible | Calibration à affiner |
| 3 | Vol Euribor approximée (proxy yield 2Y) | Faible | Ajout Euribor réel planifié |
| 4 | 1 seul produit éligible allocateur | Design | Voulu en stagflation — évolue avec les nouvelles brochures |
| 5 | ALM pas encore intégré dans l'allocateur | Moyen | Observation passive, intégration future |
| 6 | TF Callable potentiellement sous-évalué | Moyen | Recalibration P1 coupon garanti planifiée |

---

# QUESTIONS POUR LE CFO

1. **Concentration BP (57%)** — La Règle 6 bloque les nouveaux flux. Quelle répartition cible à l'échéance sept. 2026 ? (Ex: 200K CIC + 200K SG + 200K structuré)

2. **Seuil allocateur** — En stagflation, seule la Dispersion passe. Est-ce trop restrictif ou la prudence est-elle justifiée ?

3. **Range Accrual + Digitale TEC10** — Ces 2 produits CIC capital garanti sont gradés C (51-53). Méritent-ils une souscription même sans passer le quality gate de l'allocateur ?

4. **Scénario adverse** — Le gain médian est +26K€/an, l'adverse est +6.6K€/an (capital garanti). Ce profil risque/rendement est-il acceptable ?

5. **Trou 2030** — Planifier un CAT avec échéance 2030 lors du renouvellement sept. 2026 ?

---

*StructBoard v6.2.0 — 03 avril 2026*
*Document préparé pour revue CFO*

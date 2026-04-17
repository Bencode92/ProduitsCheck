# Analyse Expert — Produits Optimaux pour Carry Trade
## Données marché + recommandations de structuration

**Date** : Avril 2026
**Repo** : https://github.com/Bencode92/ProduitsCheck
**Pages clés** : Onglet "Marché" (données 20 ans) · Onglet "Carry Trade" (5 configs)
**Objectif** : Valider les coupons et structures proposés pour un carry trade de 1M€

---

## 1. CONTEXTE OPÉRATION

| Paramètre | Valeur |
|-----------|--------|
| Emprunt | Prêt SG Equipéa 1 000 000€ |
| Taux | 2.90% fixe |
| Durée | 5 ans (in fine ou amortissable au choix) |
| Garanties | Aucune (crédit en blanc) |
| Entité | Caméleons Com Mark |
| Validité | Jusqu'au 14/05/2026 |
| Objectif | Placer sur 1-2 produits structurés capital garanti pour générer du portage positif |
| Contrainte | Minimum 500K€ par produit · Sous-jacent taux uniquement · Capital garanti 100% |

---

## 2. DONNÉES MARCHÉ (source: ECB, 20 ans d'historique)

### 2.1 Taux actuels

| Taux | Actuel | Vol annualisée | Direction | Δ3M |
|------|--------|---------------|-----------|-----|
| **TEC10 (OAT 10Y)** | **3.089%** | 14.3 bp | Stable | +5.7bp |
| OAT 5Y | 2.663% | 14.2 bp | Stable | +4.2bp |
| OAT 2Y | 2.495% | 13.1 bp | Stable | +4.3bp |
| **Euribor 3M** | **2.109%** | 50.8 bp | Stable | +0.8bp |
| Euribor 6M | 2.322% | 51.6 bp | Stable | +7.5bp |
| BCE dépôt | 2.00% | — | Pause | — |
| BCE main refi | 2.15% | — | Pause | — |

### 2.2 Courbe des taux

```
Forme : Normale (pentue)
Spread 2s10s : +59bp
OAT 2Y (2.50%) → OAT 5Y (2.66%) → TEC10 (3.09%)
```

**Impact** : Courbe normale = favorable à la structuration. Le budget option augmente significativement avec la durée.

### 2.3 Budget option disponible pour la banque

C'est le montant que la banque peut utiliser pour financer les coupons (= valeur du zero-coupon discount).

| Durée | Taux de référence | Budget % nominal | Sur 500K€ | Sur 1M€ |
|-------|------------------|-----------------|-----------|---------|
| **3 ans** | 2.50% (OAT 2Y) | **7.1%** | 35 632€ | 71 265€ |
| **5 ans** | 2.66% (OAT 5Y) | **12.3%** | 61 570€ | 123 140€ |
| **7 ans** | 2.66% (OAT 5Y) | **16.8%** | 84 020€ | 168 040€ |
| **10 ans** | 3.09% (TEC10) | **26.2%** | 131 153€ | 262 305€ |

> **QUESTION EXPERT** : Ces budgets sont calculés avec les taux souverains AAA. En pratique, le structureur utilise le taux swap EUR. Quel est l'écart swap-souverain actuel ? Impact sur le budget ?

---

## 3. ANALYSE HISTORIQUE DES SEUILS (20 ans, 2004-2026)

### 3.1 TEC10 — Probabilité de franchissement

| Seuil | % temps au-dessus | Observations | Dernière fois au-dessus |
|-------|------------------|-------------|------------------------|
| > 3.0% | **27.2%** | 189/695 | 15/04/2026 (actuellement) |
| > 3.5% | **18.0%** | 125/695 | 21/04/2011 |
| > 4.0% | **7.2%** | 50/695 | 12/06/2009 |
| > **4.4%** | **1.7%** | **12/695** | **25/09/2008** |
| > 4.5% | 1.0% | 7/695 | 31/07/2008 |
| > 5.0% | 0.0% | 0/695 | Jamais |

**Historique détaillé des pics** :
- **4.75%** (max absolu) : juillet 2008 (crise financière)
- **4.40%** : septembre 2008 (dernière fois)
- **3.50%** : avril 2011 (crise dette euro) — **17 ans sans dépasser 4.40%**
- Depuis 2009, le TEC10 n'a **jamais** dépassé 4.00%

**Conclusion TARN trigger 4.40%** : Probabilité historique de coupon = **98.3%** sur 20 ans.

### ⚠️ 3.1.1 Note de robustesse statistique

**Le 98.3% est biaisé par la période ZIRP/NIRP (2012-2021)** qui représente ~45% de l'historique.

**Analyse sur sous-échantillon "régimes normaux" (2004-2008 + 2022-2026)** :
- 363 observations, moyenne TEC10 = 2.99% (proche de l'actuel 3.09%)
- TEC10 > 4.40% : **3.3% du temps** (12/363 obs)
- TEC10 > 4.00% : **13.2% du temps** (48/363 obs)
- Détail période 2004-2008 seule (111 obs) : > 4.40% = **10.8% du temps**
- Détail période 2022-2026 (252 obs) : > 4.40% = **0% du temps** (max = 3.15%)

**Probabilité cumulée sur la durée du produit** (observation annuelle TARN) :

| Prob annuelle sous 4.40% | P(5 ans sans miss) | P(10 ans sans miss) |
|--------------------------|-------------------|-------------------|
| 98% (historique brut) | 90.4% | 81.7% |
| 97% | 85.9% | 73.7% |
| 95% | 77.4% | 59.9% |
| 92% | 65.9% | 43.4% |

**IMPORTANT** : ces probas cumulées supposent qu'il faut un coupon CHAQUE année. Or le TARN a un mécanisme de **cumul** (autocall à 26%). Si un coupon est manqué An 3 mais versé An 4-5, le cumul peut quand même être atteint. La probabilité effective est donc **supérieure** aux chiffres ci-dessus.

**Notre estimation forward** :
- Probabilité marginale annuelle TEC10 ≤ 4.40% : **95-97%** (sous-échantillon taux normaux = 96.7%, haircut stagflation)
- Probabilité d'atteindre l'autocall sur 5 ans : **85-92%**

> **QUESTION EXPERT** : Sur les 363 observations en régime de taux normalisés, TEC10 > 4.40% = 3.3%. Mais la période 2004-2008 montre 10.8%. Quelle probabilité annuelle forward recommandez-vous ? Et la mécanique de cumul du TARN (vs coupon chaque année) change-t-elle significativement la proba effective ?

### 3.2 Euribor 3M — Probabilité de franchissement

| Seuil | % temps au-dessus | Dernière fois |
|-------|------------------|--------------|
| > 3.0% | **19.8%** | Novembre 2024 (!!) |
| > 3.5% | 14.4% | Août 2024 |
| > 3.8% | ~8% | ~2024 |
| > 4.0% | 4.2% | Octobre 2008 |

**Point d'attention** : L'Euribor 3M a dépassé 3.0% **aussi récemment qu'en novembre 2024**. Il était à 3.99% en octobre 2023. C'est beaucoup plus volatile que le TEC10.

**Conclusion Range Accrual corridor [1.50%-3.80%]** : Probabilité de rester dans le corridor = **~80-82%** sur historique. Mais **attention** : l'Euribor est piloté par la BCE et peut sortir du corridor rapidement si la politique monétaire change.

> **QUESTION EXPERT** : Pour un Range Accrual Euribor 3M [1.50%-3.80%], quelle probabilité utiliseriez-vous ? Le corridor [1.50%-3.80%] est-il assez large vu la volatilité récente (50bp/an) ? Faut-il élargir à [1.00%-4.20%] pour plus de sécurité (avec un coupon plus faible) ?

---

## 4. PRODUITS PROPOSÉS — À VALIDER PAR L'EXPERT

### 4.1 TARN TEC10 — Le produit principal

| Caractéristique | Valeur proposée | Justification |
|----------------|----------------|---------------|
| **Coupon** | **6.5-7.0%** | Swap 10Y (3.09%) + prime ~3.5% pour vente d'optionalité. CIC propose déjà 6% sur son TARN TEC10 Dec 2035. Sur 1M€ le nominal devrait permettre un pricing plus agressif |
| **Durée** | **10 ans** | Budget option 26.2% (×2 vs 5 ans). Sortie probable en ~4 ans via autocall |
| **Garanti** | **An 1-2** | Standard du marché (confirmé par CIC sur le TARN existant) |
| **Conditionnel** | **TEC10 ≤ 4.40%** | Proba historique 98.3%. Le TEC10 n'a pas dépassé 4.40% depuis sept 2008 |
| **Autocall** | **Cumul ≥ 26-28%** | À 7%/an → autocall en ~4 ans. Post-autocall : capital récupéré |
| **Capital** | **Garanti 100% à échéance** | Inconditionnelle |

> **QUESTION EXPERT** : Le coupon de 6.5-7.0% est-il réaliste sur un TARN TEC10 1M€ / 10Y avec trigger 4.40% et 2 ans garantis ? Le CIC propose 6% sur un montant plus petit. Le surcoût d'un million de nominal justifie-t-il +0.5-1.0% de coupon ?

### 4.2 Fixe Callable — L'alternative sécurisée

| Caractéristique | Valeur proposée | Justification |
|----------------|----------------|---------------|
| **Coupon** | **4.0-4.5%** | Swap 5Y (2.66%) + prime swaption ~1.3-1.5%. Le CIC propose Callable 10YNC3 à 4.00% |
| **Durée** | **5 ans** ou **10 ans NC3** | 5Y = matche l'emprunt. 10Y NC3 = coupon plus élevé, callable à partir de l'an 3 |
| **Capital** | **Garanti 100%** | Inconditionnelle |
| **Callable** | **Emetteur à partir de An 1 (5Y) ou An 3 (10Y)** | Standard |

> **QUESTION EXPERT** : Le CIC propose un Callable 10YNC3 à 4.00%. Peut-on espérer 4.3-4.5% sur 1M€ de nominal ? Ou le 4.00% est-il le plafond du marché actuel pour ce type de structure ?

### 4.3 Hybride Plancher + Bonus — Le compromis

| Caractéristique | Valeur proposée | Justification |
|----------------|----------------|---------------|
| **Plancher garanti** | **3.00%** | Couvre le coût de l'emprunt (2.90%) — spread positif garanti |
| **Bonus conditionnel** | **+1.5-2.0%** | Si TEC10 ≤ 4.00% (proba ~93%) |
| **Coupon total espéré** | **4.5-5.0%** | Plancher 3% + bonus ~1.5-2% × 93% |
| **Durée** | **5 ou 10 ans** | |
| **Capital** | **Garanti 100%** | |

> **QUESTION EXPERT** : Un plancher de 3% + bonus digital de 2% si TEC10 ≤ 4.00%, est-ce faisable sur 5 ans ? Et sur 10 ans ? Le plancher de 3% est-il trop élevé (coûteux à financer) et il vaudrait mieux 2.50% + bonus 2.50% pour un total similaire mais avec plus de marge sur le plancher ?

### 4.4 Floater TEC10 — Le produit qui capte la hausse

| Caractéristique | Valeur proposée | Justification |
|----------------|----------------|---------------|
| **Coupon** | **max(3%, TEC10 - 2.00%)** | Aujourd'hui = 3% + 1.09% = 4.09% |
| **Si TEC10 monte à 4%** | **5.00%** | Le coupon monte avec les taux |
| **Si TEC10 baisse à 2%** | **3.00%** | Le plancher protège |
| **Durée** | **5 ans** | |
| **Capital** | **Garanti 100%** | |

> **QUESTION EXPERT** : Un floater plancher 3% indexé TEC10 - 2.00% est-il faisable ? Le coût du floor à 3% est-il compatible avec le spread (+1% aujourd'hui) ? Faudrait-il un floor plus bas (2.50%) pour avoir un meilleur spread ?

---

## 5. LES 5 CONFIGURATIONS COMPARÉES

### 5.1 Simulation P&L (sur 5 ans, emprunt 2.90% in fine)

| Config | Produit(s) | Rdt net/an | Gain 5 ans | Pire cas 5 ans | Proba coupon |
|--------|-----------|-----------|-----------|---------------|-------------|
| **A: 1M × 10Y** | TARN TEC10 6.6% | **+2.18%** | **+108 780€** | -13 000€ | 97% |
| **B: 1M × 5Y** | Fixe Callable 4.0% | +0.83% | +41 250€ | +41 250€ | 100% |
| **C: 2×500K 5Y** | Hybride + Floater | +0.99% | +49 729€ | +3 750€ | 95% |
| **D: 1M × 10Y** | Hybride 10Y | +1.65% | +82 421€ | -4 000€ | 93% |
| **E: 500K+500K** | Fixe 5Y + TARN 10Y | +1.50% | +75 015€ | +15 750€ | 99% |

### 5.1.1 Vérification arithmétique — Config A (TARN 1M × 10Y)

**Scénario central : autocall An 4 (probabilité estimée ~85-90%)**

```
An 1 : 6.60% GARANTI  → +66 000€  (cumul 6.6%)
An 2 : 6.60% GARANTI  → +66 000€  (cumul 13.2%)
An 3 : 6.60% si TEC10 ≤ 4.40% → +66 000€  (cumul 19.8%)
An 4 : 6.60% si TEC10 ≤ 4.40% → +66 000€  (cumul 26.4% ≥ 26% → AUTOCALL)
       Capital 1M€ récupéré, placé en CAT
An 5 : 3.00% CAT       → +30 000€  (réinvestissement post-autocall)
       Intérêts emprunt SG : -29 000€ (l'emprunt court toujours)
────────────────────────────────────────
Total revenus :           +294 000€
Intérêts emprunt 5 × 29K : -145 000€
Spread brut :             +149 000€
IS 25% (Caméleons IS) :   -37 250€
═══════════════════════════════════════
NET APRÈS IS :            +111 750€
ROI total :               +11.18%
ROI/an :                  +2.24%
```

**Scénario dégradé : TEC10 > 4.40% à partir de An 3 (probabilité ~10-15%)**

```
An 1 : 6.60% GARANTI  → +66 000€
An 2 : 6.60% GARANTI  → +66 000€
An 3 : 0% (TEC10 > 4.40%)  → 0€
An 4 : 0%                   → 0€
An 5 : 0%                   → 0€
────────────────────────────────────────
Total revenus :           +132 000€
Intérêts emprunt :        -145 000€
Net brut :                 -13 000€
IS : 0 (pas de bénéfice)
═══════════════════════════════════════
NET :                      -13 000€ (perte)
ROI :                      -1.30% sur 5 ans
```

**Espérance pondérée** (90% central / 10% dégradé) :

```
E[net] = 0.90 × 111 750 + 0.10 × (-13 000) = +99 275€
ROI espéré : +9.93% / 5 ans ≈ +1.99%/an
```

**Notes** :
- Entité fiscale : Caméleons Com Mark (société IS 25%, pas PFU 30%)
- Trigger TARN : TEC10 constaté à la date d'observation annuelle (fixing), pas en continu
- L'emprunt SG court 5 ans quelle que soit la date d'autocall — les intérêts An 5 sont toujours dus
- Pénalité de remboursement anticipé emprunt : soulte swap (potentiellement coûteux), donc on garde l'emprunt et on place en CAT

### 5.2 Analyse risque/rendement

**Config A (TARN 1M × 10Y)** — Rendement max, risque modéré
- Pire cas : TEC10 > 4.40% pendant 3 ans → 0% coupon → perte -13K€ sur 5 ans
- Mais la dernière fois que TEC10 > 4.40% = **septembre 2008** (18 ans sans)
- Autocall probable en ~4 ans → capital récupéré, puis réinvesti à 3% An 5

**Config B (Fixe 1M × 5Y)** — Rendement min, risque ZÉRO
- Gain garanti +41K€ quoi qu'il arrive
- Aucune condition, aucun risque de coupon
- Pire cas = meilleur cas

**Config E (500K Fixe + 500K TARN)** — Meilleur ratio rendement/risque
- Le Fixe garantit +15K€ minimum (couvre le pire cas du TARN)
- Le TARN booste le rendement à +75K€ espéré
- **Pire cas toujours positif (+15 750€)** grâce au Fixe qui compense

### 5.3 Ce que je demande à l'expert

Pour chaque config, est-ce que les **coupons sont réalistes** compte tenu :
1. Du budget option calculé (section 2.3)
2. De la marge banque standard (~12-18% du budget)
3. Du nominal (1M€ vs 500K€ — meilleur pricing ?)
4. Des conditions de marché actuelles (stagflation, BCE en pause)

---

## 6. QUESTIONS SPÉCIFIQUES POUR L'EXPERT

| # | Question | Contexte |
|---|---------|---------|
| **1** | **TARN 6.5-7% réaliste sur 1M€ ?** | CIC propose 6% sur nominal plus petit. Le budget 10Y = 26.2% donne de la marge |
| **2** | **Fixe Callable : 4.0% ou plus ?** | CIC propose 4.00% sur 10YNC3. Sur 5Y le coupon devrait être similaire |
| **3** | **Hybride plancher 3% + bonus 2% : faisable ?** | Le floor 3% coûte cher. 2.50% + 2.50% serait plus efficient ? |
| **4** | **Floater plancher 3% + TEC10 - 2% : faisable ?** | Le cap est implicite dans le budget option |
| **5** | **Euribor corridor [1.50-3.80%] trop serré ?** | Euribor était à 3.99% en oct 2023. Corridor [1.00-4.20%] plus safe ? |
| **6** | **Probabilité TARN 4.40% forward** | Historique dit 98.3% mais en stagflation, haircut à appliquer ? |
| **7** | **Config optimale** | Entre A (max rendement) et E (meilleur ratio risque/rendement), que recommandez-vous pour un corporate en trésorerie ? |
| **8** | **Autocall ~4 ans vs emprunt 5 ans** | Si le TARN autocall en 4 ans, il reste 1 an d'emprunt. Quelle stratégie de réinvestissement ? CAT 3% ou nouveau structuré 1Y ? |
| **9** | **Risque émetteur** | Sur 1M€ chez un seul émetteur A+ (CIC ou SG) sur 10 ans, le risque de défaut est estimé à ~2%. Faut-il diversifier (500K CIC + 500K SG) ? |
| **10** | **Données marché disponibles** | Le repo contient 20 ans d'historique TEC10/OAT + 26 ans d'Euribor. L'onglet Marché permet d'analyser n'importe quel seuil/corridor. L'expert peut explorer librement. |

---

## 7. ACCÈS AUX OUTILS

| Outil | URL / chemin | Ce qu'il permet |
|-------|-------------|----------------|
| **Page Marché** | Onglet "📈 Marché" sur le site | Cliquer sur un taux → chart 20 ans + analyse seuils custom |
| **Page Carry Trade** | Onglet "🏦 Carry Trade" | 5 configs comparées avec P&L, clic → détail + P&L année/année |
| **Données brutes** | `data/market/rates.json` (245 KB) | TEC10/OAT/Euribor avec 695 obs mensuelles |
| **Intelligence marché** | `data/market/market_intelligence.json` | Régime (stagflation), macro, secteurs |
| **Doc grading** | `docs/EXPERT-REVIEW-STRUCTBOARD.md` | Méthodologie de scoring complète |
| **Doc page Marché** | `docs/MARKET-DASHBOARD-SPECS.md` | Spécifications techniques données marché |
| **Portefeuille existant** | `data/portfolio.json` | 5 produits en portefeuille dont TARN TEC10 CIC |

L'expert a accès libre au repo GitHub pour explorer les données et le code.

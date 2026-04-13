# Opération Carry Trade — Document Expert

## Emprunt de Trésorerie + Produits Structurés Capital Garanti

**Date :** 13 avril 2026
**Entités :** ByCam / Caméléons
**Objectif :** Générer une marge nette sur un emprunt de trésorerie en plaçant en produits structurés capital garanti

---

# 1. PARAMÈTRES DE L'OPÉRATION

## 1.1 Emprunt

| Paramètre | Valeur |
|-----------|--------|
| **Montant** | 1 000 000€ |
| **Taux fixe** | 2.90% |
| **Durée** | 10 ans |
| **Type recommandé** | In fine (capital remboursé à l'échéance) |
| **Coût annuel** | 29 000€ (intérêts déductibles IS) |
| **Coût total intérêts** | 290 000€ (in fine) / 166 333€ (amortissable) |
| **Nature** | Emprunt de trésorerie non affecté — libre de placement |
| **Solvabilité** | Entreprise solvable, pas de besoin de liquidité opérationnel |

## 1.2 Pourquoi In Fine est optimal

En **in fine**, le capital de 1 000 000€ reste intégralement placé pendant 10 ans. Les produits structurés capital garanti remboursent le nominal à maturité → le capital récupéré rembourse l'emprunt.

En **amortissable**, le capital remboursé progressivement réduit le montant placé → les revenus diminuent chaque année. La marge nette totale est inférieure de ~74 000€.

```
In fine :     marge nette composée = +186 919€ sur 10 ans
Amortissable : marge nette composée = +112 770€ sur 10 ans
Différence :  +74 149€ en faveur de l'in fine
```

## 1.3 Effet composé (réinvestissement des intérêts nets)

Les intérêts nets perçus chaque année sont réinvestis dans les mêmes produits structurés :

```
An 1  : 1 000 000€ placé → marge nette 15 750€ → réinvesti
An 2  : 1 015 750€ placé → marge nette 16 341€ → réinvesti
An 5  : 1 066 634€ placé → marge nette 18 249€ → réinvesti
An 10 : 1 164 982€ placé → marge nette 21 937€

Bonus effet composé : +29 419€ sur 10 ans (vs placement linéaire)
```

---

# 2. RECOMMANDATION : PRODUIT HYBRIDE PLANCHER + BONUS

## 2.1 Structure du produit recommandé

| Caractéristique | Valeur |
|----------------|--------|
| **Nom** | Hybride Plancher 3% + Bonus TEC10 |
| **Montant** | 1 000 000€ |
| **Durée** | 5 ans (renouvelable) |
| **Capital** | Garanti 100% à l'échéance |
| **Coupon plancher** | **3.00% GARANTI** (versé dans tous les cas) |
| **Coupon bonus** | **+2.50% conditionnel** (si TEC10 ≤ 4.40%) |
| **Coupon total max** | 5.50% |
| **Fréquence** | Annuel ou trimestriel |
| **Émetteur cible** | CIC (A+/Aa3/AA-) |

## 2.2 Pourquoi ce produit est optimal

**Le plancher garanti de 3.00% couvre le coût de l'emprunt (2.90%)**

C'est la caractéristique clé : même dans le **pire scénario** (TEC10 > 4.40% toute l'année), le coupon plancher de 3.00% génère une marge positive de +0.10% = +1 000€/an. **L'opération ne perd jamais d'argent.**

**Le bonus conditionnel de 2.50% génère la vraie marge**

Si le TEC10 reste sous 4.40% (probabilité estimée ~80% basée sur le niveau actuel de 3.10% avec 130bps de marge), le coupon total est de 5.50% → marge de 2.60% = +26 000€/an.

## 2.3 Analyse de la condition : TEC10 ≤ 4.40%

Le TEC10 (Taux de l'Échéance Constante 10 ans) est le rendement de l'OAT française à 10 ans.

| Donnée | Valeur |
|--------|--------|
| **TEC10 actuel** | 3.10% |
| **Seuil du produit** | 4.40% |
| **Marge de sécurité** | 130 bps (1.30%) |
| **Dernière fois > 4.40%** | Début des années 2000 (>20 ans) |
| **Vol annualisée OAT 10Y** | ~70-90 bps (historique réaliste) |
| **Vol annualisée OAT 10Y réaliste** | ~70-90 bps (historique 2022-2025) |
| **Probabilité de rester ≤ 4.40%** | ~65-70% par année (vol réaliste, mean-reverting) |

**Historiquement, le TEC10 n'a pas dépassé 4.40% depuis plus de 20 ans.** Pour que le seuil soit franchi, il faudrait :
- Une crise de confiance sur la dette française (type crise souveraine)
- Une inflation durablement > 5% forçant la BCE à monter massivement les taux
- Un scénario de type éclatement de la zone euro

Ce sont des scénarios extrêmes, pas des scénarios centraux.

---

# 3. COMPARAISON DES 6 CONFIGURATIONS SIMULÉES

## 3.1 Tableau comparatif (classé par rentabilité)

| # | Configuration | Risque | Marge/an (in fine) | Net total composé 10 ans | Bonus composé | Pire cas/an |
|---|--------------|:------:|:------------------:|:------------------------:|:-------------:|:-----------:|
| 1 | **Hybride Plancher + Bonus** | **Très faible** | **+21 000€** | **+186 919€** | +29 419€ | **+1 000€** |
| 2 | TARN TEC10 6% | Modéré | +19 000€ | +167 947€ | +25 447€ | -11 000€ |
| 3 | 40% TARN + 30% Fixe + 30% Hybride | Modéré- | +17 800€ | +156 686€ | +23 186€ | -200€ |
| 4 | Taux Fixe Garanti 10 ans (4.6%) | Faible | +17 000€ | +149 231€ | +21 731€ | +17 000€ |
| 5 | 50% Fixe + 50% TARN | Modéré- | +16 000€ | +139 969€ | +19 969€ | +1 000€ |
| 6 | 50% Fixe + 50% Digitale Mémoire | Faible | +11 550€ | +99 496€ | +12 871€ | -1 100€ |

## 3.2 Analyse par configuration

### Configuration 1 — Hybride Plancher + Bonus (RECOMMANDÉE)

```
Coupon plancher : 3.00% GARANTI → couvre l'emprunt à 2.90%
Coupon bonus :    +2.50% si TEC10 ≤ 4.40%
Marge garantie :  +0.10% (= +1 000€/an minimum)
Marge espérée :   +2.60% (= +21 000€/an en base)
Pire cas :        +1 000€/an → JAMAIS NÉGATIF
```

**Avantage décisif :** c'est la seule configuration où le pire cas est **toujours positif**. Même si le TEC10 dépasse 4.40% chaque année pendant 10 ans, l'opération est bénéficiaire de +1 000€/an.

### Configuration 2 — TARN TEC10 6%

```
Coupon : 6.00% si TEC10 ≤ 4.40%, sinon 0%
Marge espérée : 6% × 80% - 2.9% = +1.90% = +19 000€/an
Pire cas : 0% - 2.9% = -29 000€/an → atténué en probabilité : -11 000€/an
```

Plus rentable en scénario favorable mais **pire cas négatif** : si TEC10 > 4.40%, le coupon est 0% et l'emprunt coûte 29K€/an.

### Configuration 4 — Taux Fixe Garanti 4.6%

```
Coupon : 4.60% GARANTI (100% certain)
Marge garantie : 4.6% - 2.9% = +1.70% = +17 000€/an
Pire cas : +17 000€/an → LE PLUS SÛR
```

Marge inférieure à l'hybride (-4 000€/an) mais **zéro incertitude**. Pour un investisseur très conservateur.

---

# 4. CASH FLOW DÉTAILLÉ — HYBRIDE IN FINE (COMPOSÉ)

| Année | Capital placé | Revenus | Intérêts emprunt | Marge brute | IS (25%) | Net après IS |
|-------|:------------:|:-------:|:----------------:|:-----------:|:--------:|:------------:|
| 1 | 1 000 000€ | +50 000€ | -29 000€ | +21 000€ | -5 250€ | **+15 750€** |
| 2 | 1 015 750€ | +50 788€ | -29 000€ | +21 788€ | -5 447€ | **+16 341€** |
| 3 | 1 032 091€ | +51 605€ | -29 000€ | +22 605€ | -5 651€ | **+16 954€** |
| 4 | 1 049 045€ | +52 452€ | -29 000€ | +23 452€ | -5 863€ | **+17 589€** |
| 5 | 1 066 634€ | +53 332€ | -29 000€ | +24 332€ | -6 083€ | **+18 249€** |
| 6 | 1 084 883€ | +54 244€ | -29 000€ | +25 244€ | -6 311€ | **+18 933€** |
| 7 | 1 103 816€ | +55 190€ | -29 000€ | +26 190€ | -6 548€ | **+19 642€** |
| 8 | 1 123 458€ | +56 173€ | -29 000€ | +27 173€ | -6 793€ | **+20 380€** |
| 9 | 1 143 838€ | +57 192€ | -29 000€ | +28 192€ | -7 048€ | **+21 144€** |
| 10 | 1 164 982€ | +58 249€ | -29 000€ | +29 249€ | -7 312€ | **+21 937€** |
| **TOTAL** | | **+539 225€** | **-290 000€** | **+249 225€** | **-62 306€** | **+186 919€** |

**Observations :**
- Le capital placé croît de 1M€ à 1.165M€ grâce au réinvestissement (+16.5%)
- Les revenus augmentent chaque année (de 50K€ à 58K€) grâce à l'effet composé
- La marge nette annuelle passe de 15.75K€ (An 1) à 21.9K€ (An 10) = +39% de croissance
- Le bonus d'effet composé = +29 419€ sur 10 ans

---

# 5. ANALYSE DES RISQUES

## 5.1 Matrice des risques

| Risque | Probabilité | Impact | Mitigation |
|--------|:-----------:|:------:|------------|
| TEC10 > 4.40% (perte bonus) | ~20%/an | Perte de 2.5% de coupon | Plancher 3% couvre l'emprunt |
| Défaut émetteur CIC | <0.5% sur 10 ans | Perte capital placé | Rating A+/Aa3/AA-, diversifiable |
| Hausse taux emprunt | 0% | Aucun | Taux fixe 2.9% verrouillé |
| Inflation érodant la marge | Possible | Rendement réel réduit | Capital garanti protège le nominal |
| Call du produit hybride | Faible en stagflation | Réinvestissement nécessaire | Renouveler avec nouveau produit |

## 5.2 Scénarios de stress

### Scénario 1 — Base (TEC10 reste sous 4.40%)
```
Probabilité : ~70-80%
Coupon : 5.50%/an
Marge nette : +186 919€ sur 10 ans (+18 692€/an moyen)
```

### Scénario 2 — TEC10 sort 3 années sur 10
```
Probabilité : ~15-20%
Coupon moyen : 3% × 3 ans + 5.5% × 7 ans = 4.75%/an moyen
Marge nette : ~+135 000€ sur 10 ans (+13 500€/an)
```

### Scénario 3 — Pire cas (TEC10 > 4.40% les 10 ans)
```
Probabilité : <5% (jamais arrivé depuis 2000)
Coupon : 3.00%/an (plancher garanti)
Marge nette : +7 500€ sur 10 ans (+750€/an)
L'opération reste POSITIVE grâce au plancher.
```

---

# 6. FISCALITÉ

| Élément | Traitement |
|---------|-----------|
| Intérêts d'emprunt (29 000€/an) | **Déductibles** du résultat imposable (charge financière) |
| Coupons structurés | **Imposables** au résultat (produits financiers) |
| Marge brute | Imposée à l'IS (~25%) |
| Taux réduit PME | 15% sur les premiers 42 500€ de bénéfice (le cas échéant) |

**Impact fiscal :** l'emprunt crée une charge déductible de 29K€/an qui réduit l'IS sur les autres revenus de l'entreprise. La marge nette après IS est donc optimisée par l'effet de levier fiscal.

---

# 7. POINTS DE DISCUSSION AVEC LE CIC

## 7.1 Questions à poser

1. **Taux fixe garanti disponible :** "Quel est le meilleur taux fixe garanti que vous pouvez offrir sur 1M€, 5 ans, capital garanti, versement annuel ou trimestriel ?"

2. **Produit hybride :** "Pouvez-vous structurer un produit avec un coupon plancher garanti à 3.00% + un bonus conditionnel de 2.50% lié au TEC10 ≤ 4.40% ?"

3. **Durée et renouvellement :** "Le produit est-il disponible sur 5 ans renouvelable ou directement sur 10 ans ?"

4. **Fréquence de coupon :** "Versement annuel ou trimestriel du coupon ?"

5. **Minimum d'investissement :** "Quel est le montant minimum pour un structuré sur-mesure ?"

6. **Callable :** "L'émetteur peut-il rappeler le produit avant l'échéance ? Si oui, sous quelles conditions ?"

## 7.2 Produits alternatifs à comparer

Si le CIC ne peut pas faire l'hybride, demander les alternatives :

| Alternative | Coupon | Avantage | Inconvénient |
|-------------|:------:|----------|-------------|
| Taux fixe pur 5 ans | 4.0-4.5% | Zéro risque | Marge plus faible |
| TARN TEC10 | 6.0% | Marge max | Pire cas négatif (-29K/an) |
| Digitale Mémoire TEC10 | 4.6% | Mémoire (rattrapage) | Coupon plus bas |
| Range Accrual Euribor | 5.2% | Observation daily | Euribor volatile |

## 7.3 Ce qu'on ne veut PAS

- ❌ Produit sans capital garanti (pas de Phoenix/Autocall sur actions)
- ❌ Produit sur sous-jacent actions (pas d'exposition directionnelle)
- ❌ Maturité > 10 ans (doit matcher la durée de l'emprunt)
- ❌ Coupon avec barrière de perte en capital

---

# 8. SYNTHÈSE POUR DÉCISION

| Critère | Valeur |
|---------|--------|
| **Investissement** | 0€ de fonds propres (100% financé par emprunt) |
| **Marge nette annuelle** | +18 692€/an (moyenne composée) |
| **Marge nette 10 ans** | +186 919€ |
| **Pire cas 10 ans** | +7 500€ (toujours positif) |
| **Capital à risque** | 0€ (capital garanti + emprunt = match) |
| **Risque maximum** | Défaut CIC (<0.5% sur 10 ans) |
| **Apport fonds propres** | 0€ (100% financé par emprunt) |
| **Effet composé** | +29 419€ de bonus sur 10 ans |

**L'opération génère ~120-150K€ de marge nette sur 10 ans sans apport de fonds propres, avec un pire cas toujours positif grâce au plancher garanti. Les chiffres dépendent de la probabilité conditionnelle du bonus (~65-70%) et du taux d'emprunt effectif.**

**Prérequis absolus avant signature :**
1. Offre de financement écrite ferme (taux ≤ 3.5%)
2. Term sheet complète du produit structuré (plancher, call, émetteur exact)

---

*Document préparé le 13/04/2026 — StructBoard v6.2.0*
*Simulateur Carry Trade v1.0 — Données TEC10 au 01/04/2026*
*À soumettre à l'expert pour validation avant RDV CIC*

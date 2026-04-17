# Produits structurés alternatifs — Analyse expert
## Quelles structures avons-nous oubliées ?

**Contexte** : Carry trade 1M€ emprunté à 2.90% in fine 5 ans. Capital garanti obligatoire. Sous-jacent taux.
**Objectif** : Identifier des structures plus rentables ou plus sûres que le TARN TEC10 et le Fixe Callable.

---

## 1. DONNÉES DE MARCHÉ (base de structuration)

### Courbe des taux

```
BCE dépôt   2.00%
Euribor 3M  2.11%
OAT 2Y      2.50%     ┐
OAT 5Y      2.66%     ├── Pente 2-10Y = +59bp
TEC10       3.09%     ┘
```

### Spreads exploitables

| Spread | Valeur | Produit possible |
|--------|--------|-----------------|
| **TEC10 - Euribor 3M** | **+98bp** | CMS Spread, Multi-index |
| **TEC10 - OAT 2Y** | **+59bp** | Steepener |
| **TEC10 - OAT 5Y** | **+43bp** | Pente 5-10Y |
| **TEC10 - Emprunt 2.90%** | **+19bp** | Carry naturel (même sans structuration) |
| **TEC10 - BCE dépôt** | **+109bp** | Spread vs taux directeur |

### Budget option par maturité

| Durée | Taux swap | Budget % | Budget sur 1M€ |
|-------|-----------|---------|----------------|
| 3 ans | 2.58% | 7.4% | 73 544€ |
| **5 ans** | **2.66%** | **12.3%** | **123 140€** |
| 7 ans | 2.88% | 18.0% | 180 023€ |
| **10 ans** | **3.09%** | **26.2%** | **262 305€** |
| 15 ans | ~3.24% | 38.0% | 380 470€ |

**Observation clé** : le budget option double entre 5Y et 10Y. Les structures longues ont un avantage massif en termes de coupon.

---

## 2. PRODUITS DÉJÀ ANALYSÉS (rappel)

| Produit | Coupon | Avantage | Limite |
|---------|--------|----------|--------|
| TARN TEC10 10Y | 6.6% conditionnel | Max rendement | Risque 0% coupon si TEC10 > 4.40% |
| Fixe Callable 5Y | 4.0% garanti | Zéro risque | Rendement limité |
| Hybride Plancher 3% + Bonus | 4.5% espéré | Plancher couvre emprunt | Bonus modeste |
| Floater TEC10 | 4.1% variable | Monte si taux montent | Coupon modeste |

---

## 3. PRODUITS ALTERNATIFS À EXPLORER

### 3.1 Callable In Fine (capitalisation des coupons)

**Principe** : Aucun coupon versé en cours de vie. Tout est capitalisé et versé en une seule fois au call ou à l'échéance.

```
Exemple CIC existant : Callable In Fine 10YNC4
  Coupon annualisé : 4,66%
  Si callable An 4 : remboursement = 118.64% du nominal
  Si callable An 5 : 123.30%
  À maturité 10 ans : 146.60%
  
  Sur 1M€ :
    Si call An 5 → vous recevez 1 233 000€ = +233 000€ brut
    Intérêts emprunt 5 ans : -145 000€
    IS 25% sur le spread : -22 000€
    NET : +66 000€
```

**Avantages** :
- Coupon **garanti** (comme le Fixe Callable, mais capitalisé)
- Pas de flux annuels → pas besoin de gérer les coupons
- Le rendement annualisé (4.66%) est **supérieur** au Fixe Callable classique (4.0%) car la banque économise les flux intermédiaires

**Inconvénient** :
- Pas de cash flow pendant la vie du produit → tu paies les intérêts de l'emprunt sans recevoir de coupon
- Tout est débloqué d'un coup au call/échéance

> **QUESTION EXPERT** : Le Callable In Fine est-il plus rentable que le Fixe Callable classique pour un carry trade ? Le surcoupon (~0.50-0.70% de plus) compense-t-il l'absence de flux annuels ?

### 3.2 Range Accrual sur TEC10 (pas Euribor)

**Principe** : Coupon proportionnel au nombre de jours où le **TEC10** (pas l'Euribor) reste dans un corridor.

```
Corridor proposé : [2.00% - 4.00%]
TEC10 actuel : 3.09% (bien centré)

Historique 20 ans : TEC10 dans [2.00-4.00%]
  2022-2026 : ~95% du temps ✅
  2004-2008 : ~45% du temps (périodes > 4%)
  Global 20 ans : ~35% du temps (biaisé par ZIRP < 2%)
```

**Pourquoi TEC10 plutôt qu'Euribor** :
- TEC10 vol = 14bp/an vs Euribor vol = 51bp/an → **3.6× moins volatile**
- TEC10 dans [2.00-4.00%] actuellement = 109bp de marge de chaque côté
- Euribor sort du corridor beaucoup plus facilement (piloté par BCE, mouvements brusques)

**Coupon estimé** : 5.5-6.5% sur 10 ans (budget option 26% permet un coupon élevé)

> **QUESTION EXPERT** : Un Range Accrual TEC10 [2.00%-4.00%] est-il structurable ? Quel coupon sur 1M€ / 10 ans capital garanti ? C'est potentiellement plus sûr que le TARN (corridor vs seuil unique) avec un coupon comparable.

### 3.3 Step-Up Callable (coupon croissant)

**Principe** : Coupon garanti qui **augmente** chaque année. La banque peut rappeler le produit quand le coupon devient trop coûteux.

```
Exemple :
  An 1 : 3.50% garanti
  An 2 : 4.00% garanti
  An 3 : 4.50% garanti (callable ici)
  An 4 : 5.00% garanti
  An 5 : 5.50% garanti
  
  Coupon moyen si pas de call : 4.50%
  Coupon moyen si call An 3 : 4.00%
```

**Avantages** :
- Coupon **100% garanti** chaque année (pas de condition)
- Le coupon croissant est psychologiquement attractif
- La banque calle quand les taux baissent → dans ce cas tu replaces à un taux qui baisse aussi (pas de perte d'opportunité)

> **QUESTION EXPERT** : Un Step-Up Callable 5Y (3.50% → 5.50%) est-il faisable ? Et sur 10Y (3.00% → 6.00%) ? Quel coupon moyen peut-on espérer ?

### 3.4 TARN avec Mémoire (coupons rattrapés)

**Principe** : Comme le TARN classique, mais les coupons non versés sont **stockés en mémoire** et versés dès que la condition est remplie.

```
TARN classique (sans mémoire) :
  An 3 : TEC10 = 4.50% > 4.40% → coupon 0% (perdu)
  An 4 : TEC10 = 3.80% ≤ 4.40% → coupon 6.6%

TARN avec mémoire :
  An 3 : TEC10 = 4.50% > 4.40% → coupon 0% (stocké : 6.6%)
  An 4 : TEC10 = 3.80% ≤ 4.40% → coupon 6.6% + mémoire 6.6% = 13.2% !
```

**Avantage** : Le pire cas est beaucoup moins sévère. Même si tu rates un coupon, tu le récupères plus tard.

**Inconvénient** : Le coupon de base sera plus bas (~5.5-6.0% au lieu de 6.6%) car la mémoire coûte à la banque.

> **QUESTION EXPERT** : Un TARN TEC10 avec mémoire est-il proposé par les salles de marché ? Quel coupon vs TARN sans mémoire (décote estimée) ? Pour un carry trade, le filet de sécurité de la mémoire vaut-il la réduction de coupon ?

### 3.5 Multi-Index : max(TEC10, Euribor + spread)

**Principe** : Le coupon est indexé sur le **meilleur** de deux taux. Diversification naturelle.

```
Coupon = max(TEC10, Euribor 3M + 1.00%) × facteur

Aujourd'hui :
  TEC10 = 3.09%
  Euribor + 1% = 3.11%
  → Le max est ~3.11%

Si BCE monte (Euribor → 3.5%) : max(3.09%, 4.50%) = 4.50%
Si taux longs montent (TEC10 → 4%) : max(4.00%, 3.11%) = 4.00%
→ Tu gagnes dans les deux scénarios de hausse
```

**Avantage** : Protection contre les deux types de hausse des taux (courts ET longs).

> **QUESTION EXPERT** : Une structure multi-index max(TEC10, Euribor+spread) est-elle structurable en capital garanti ? Quel coupon espérer ? C'est plus complexe mais la diversification d'index est un vrai avantage.

### 3.6 CMS Spread Digital (pente de courbe)

**Principe** : Coupon fixe versé tant que la courbe des taux reste pentue (CMS 10Y - CMS 2Y > 0).

```
Condition : CMS10 - CMS2 > 0 (courbe non inversée)
Coupon si condition remplie : 5.50-6.50%
Coupon si courbe inversée : 0%

Historique 20 ans :
  Courbe positive (CMS10 > CMS2) : ~80% du temps
  Actuellement : +59bp (bien positive)
  Dernière inversion : 2022-2023 (brève, liée aux hausses BCE)
```

**Avantage** : La courbe est positive la grande majorité du temps. Trigger plus "naturel" que TEC10 > 4.40%.

**Risque** : Si la BCE monte fortement les taux courts sans que les longs suivent → inversion → 0%.

> **QUESTION EXPERT** : Un CMS Spread Digital (coupon si CMS10-CMS2 > 0bp ou > -20bp comme marge) avec coupon 5.50-6.50%, est-ce réaliste sur 10Y capital garanti ?

### 3.7 Snowball TEC10

**Principe** : Le coupon de chaque année dépend du coupon précédent + un bonus. Le coupon "boule de neige" s'accumule.

```
An 1 : coupon = max(0, 5% + TEC10_An0 - TEC10_An1)
  Si TEC10 stable : ~5%
An 2 : coupon = max(0, coupon_An1 + 1% - variation_TEC10)
  Si TEC10 stable : ~6%
An 3 : ~7%
...

Si TEC10 monte fortement : coupon peut tomber à 0% et ne remonte pas facilement.
Si TEC10 stable/baisse : coupon croissant garanti.
```

**Avantage** : Coupon potentiellement très élevé si les taux restent stables.
**Risque** : Asymétrique — une fois que le coupon tombe à 0%, difficile de remonter.

> **QUESTION EXPERT** : Le Snowball est-il adapté à un environnement de stagflation (taux stables mais risque de hausse) ? Trop risqué pour un carry trade corporate ?

---

## 4. TABLEAU COMPARATIF — TOUS LES PRODUITS

| # | Produit | Coupon estimé | Proba coupon | Pire cas | Complexité | Adapté carry trade ? |
|---|---------|--------------|-------------|----------|-----------|---------------------|
| 1 | TARN TEC10 (existant) | 6.6% | 90% | 0% An 3-5 | Moyenne | ✅ Oui, notre base |
| 2 | Fixe Callable (existant) | 4.0% | 100% | = best case | Faible | ✅ Oui, zéro risque |
| 3 | **Callable In Fine** | **4.7%** | **100%** | = best case | Faible | ✅ **Intéressant — coupon garanti supérieur** |
| 4 | **Range Accrual TEC10** | **5.5-6.5%** | **~90%** | Proportionnel | Moyenne | ✅ **Plus sûr que TARN (corridor vs seuil)** |
| 5 | **Step-Up Callable** | **4.5% moyen** | **100%** | = best case | Faible | ✅ **Garanti + croissant** |
| 6 | TARN avec Mémoire | 5.5-6.0% | 95%+ | Très réduit | Moyenne | ✅ Filet de sécurité |
| 7 | Multi-Index | 4.5-5.5% | ~85% | Variable | Élevée | ⚠️ Complexe à pricer |
| 8 | CMS Spread Digital | 5.5-6.5% | ~80% | 0% si inversée | Moyenne | ⚠️ Risque d'inversion |
| 9 | Snowball | 5-10%+ | Variable | Catastrophique | Élevée | ❌ Trop risqué |

---

## 5. NOS 3 RECOMMANDATIONS POUR L'EXPERT

**Si vous ne deviez recommander que 3 structures additionnelles à explorer, lesquelles ?**

Notre pré-sélection :

1. **Callable In Fine 10YNC4** — coupon garanti supérieur au Fixe Callable classique. CIC en propose déjà à 4.66%. Un pricing compétitif pourrait monter à 4.80-5.00%.

2. **Range Accrual TEC10 [2.00%-4.00%]** — corridor centré sur le taux actuel (3.09%), vol TEC10 faible (14bp), potentiellement plus sûr que le TARN (coupon proportionnel vs binaire 0/100%).

3. **Step-Up Callable 5-10Y** — coupon garanti croissant, psychologiquement et financièrement attractif. Pas de condition, pas de risque de 0%.

> **QUESTION FINALE** : Parmi ces 3 + les 6 autres alternatives, lesquelles recommandez-vous pour notre carry trade (1M€, 2.90%, in fine 5 ans, capital garanti obligatoire) ? Y a-t-il une structure que nous n'avons pas du tout envisagée ?

---

## 6. DONNÉES DISPONIBLES

L'expert peut accéder au repo GitHub pour vérifier toutes les données :
- **20 ans d'historique TEC10** (695 obs, 2004-2026)
- **26 ans d'historique Euribor 3M** (167 obs mensuel, 2000-2026)
- **Page Marché interactive** : analyse de seuils et corridors custom sur n'importe quel taux
- **Page Carry Trade** : 5 configurations comparées avec P&L année par année

Repo : https://github.com/Bencode92/ProduitsCheck

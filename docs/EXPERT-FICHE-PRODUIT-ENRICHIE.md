# Fiche produit enrichie — Spécifications pour expert

## Ce qui existe déjà sur la fiche produit

Chaque produit structuré a une fiche avec :
- Résumé IA, mécanisme coupon, protection capital, remboursement anticipé
- Caractéristiques (sous-jacent, type, maturité, devise, dates)
- Scénarios (favorable / médian / défavorable)
- Points d'attention (risques)
- Grading unifié (score A/B/C/D avec 4 piliers)
- Actions (discuter avec Claude, intégrer, rejeter)

## Ce qu'on veut ajouter — 4 enrichissements

### 1. Probabilité historique de coupon (pour produits TAUX)

**Pour les TARN, Digital, Range Accrual indexés TEC10 ou Euribor** :
- Lire le trigger du produit (ex: TEC10 ≤ 4.40%)
- Calculer sur 20 ans d'historique : % du temps sous le trigger
- Afficher : "Probabilité historique de coupon : **98.3%** (TEC10 sous 4.40% sur 695 obs)"
- Mini-chart inline : la courbe du taux avec la ligne de trigger

**Données disponibles** : `data/market/rates.json` avec 695 obs TEC10, 167 obs Euribor (20+ ans)

### 2. Simulation du coupon conditionnel (pour produits ACTIONS)

**Pour les Autocall, Phoenix, Worst-of indexés sur des actions** :
- Lire la volatilité du sous-jacent depuis `data/market/stocks_europe.json` ou `stocks_us.json`
- Calculer la probabilité que l'action soit au-dessus du trigger coupon à chaque date d'observation
- Afficher : "Probabilité d'autocall An 1 : **35%** · An 2 : **55%** · An 3 : **70%**"
- Pour Phoenix Mémoire : probabilité du coupon trimestriel (trigger 77%)

**Données disponibles** : volatilité 3Y implicite par action dans stocks_europe/us.json

### 3. Backtest 1 an : "Si j'avais investi il y a 1 an"

**Pour tous les produits** :
- Prendre le cours du sous-jacent il y a 1 an (via historique)
- Simuler le mécanisme du produit sur les 12 derniers mois
- Afficher : "Sur les 12 derniers mois, ce produit aurait versé **X€** de coupon sur 100K€"
- Pour les autocalls : "L'autocall se serait déclenché en mois **N**"

**Données disponibles** : historiques de taux (rates.json) et indices de marché

### 4. Simulation de dispersion (pour produits Dispersion/Paires)

**Pour la "Solution Court Terme Boostée"** :
- Lire les 8 sous-jacents (NVIDIA, Meta, etc.)
- Calculer la dispersion historique des paires sur 1 an
- Afficher : "Dispersion moyenne 12M : **X%** · Rendement simulé : **Y%** × participation 7%"

**Données disponibles** : performances et volatilités dans stocks_us.json

## Questions pour l'expert

1. Ces 4 enrichissements sont-ils **utiles** pour la prise de décision ? Ou est-ce de l'over-engineering ?
2. Pour les produits actions (Phoenix, Autocall), faut-il un **Monte Carlo simplifié** (100 sims) ou les probas BS suffisent ?
3. Le backtest 1 an est-il **trompeur** (biais de hindsight) ou **informatif** ?
4. Quel **design** recommandez-vous pour intégrer ces données dans la fiche existante sans la surcharger ?
5. Le site est en **Vanilla JS** — est-il raisonnable de faire du Monte Carlo côté client ou faut-il un backend ?

## Accès

- Fiche produit exemple : ouvrir le site → onglet Structurés → cliquer sur "SL - ATHENA PRIVILEGE ENI"
- Repo : https://github.com/Bencode92/ProduitsCheck
- Code fiche : `js/ui.js` lignes 100-180
- Données marché : `data/market/rates.json` (258 KB, 20 ans)
- Données actions : `data/market/stocks_europe.json`, `stocks_us.json`

# Alternatives au TARN TEC10 CIC — Produits structurables
## Calibrés sur la courbe réelle du 17/04/2026

**Benchmark** : TARN TEC10 Avril 2036 B (CIC, ISIN XS3340532707)
- Coupon 6.70% · Trigger TEC10 ≤ 4.60% · Garanti An 1-2 · Autocall cumul ≥ 26.80%
- **Souscription : 9-24 avril 2026**

**Courbe** : TEC10 3.08% · OAT 5Y 2.66% · Euribor 3M 2.11% · Spread 2s10s +59bp

---

## 1. TARN TEC10 AVEC MÉMOIRE — "Le TARN amélioré"

```
Structure : Identique au TARN CIC mais avec effet mémoire
Coupon    : 5.80 – 6.20% (décote ~0.50-0.80% vs TARN sans mémoire)
Trigger   : TEC10 ≤ 4.60%
Garanti   : An 1-2
Mémoire   : OUI — coupons non versés stockés et rattrapés
Autocall  : Cumul ≥ 24-26%
Maturité  : 10 ans · Capital garanti 100%
Nominal   : 500K€ ou 1M€
```

**Pourquoi c'est intéressant** :
- Le TARN CIC classique : si TEC10 > 4.60% une année → coupon **perdu**
- Avec mémoire : coupon **stocké** et versé l'année suivante si condition remplie
- Le pire cas est beaucoup moins sévère
- La décote de ~0.50-0.80% de coupon = le prix de l'assurance mémoire

**Proba coupon** : identique au TARN (TEC10 > 4.60% = 0.3% du temps sur 20 ans)
**Avantage vs benchmark** : filet de sécurité · **Inconvénient** : coupon plus bas

> Demander au structureur : "Quel coupon pour un TARN TEC10 mémoire 10Y trigger 4.60%, 2 ans garantis, 500K-1M€ ?"

---

## 2. CALLABLE IN FINE — "Le coupon capitalisé"

```
Structure : Pas de flux annuels. Tout versé au call ou à maturité.
Coupon    : 4.60 – 5.00% annualisé (capitalisé)
Callable  : Émetteur à partir An 4 ou An 5
Si call An 5 : remboursement ~123-125% du nominal
À maturité 10Y : remboursement ~146-150% du nominal
Maturité  : 10 ans NC4 ou NC5 · Capital garanti 100%
```

**Le CIC propose déjà** le Callable In Fine 10YNC4 à 4.66% (ISIN dans votre portefeuille).

**Pourquoi c'est intéressant** :
- Coupon **100% garanti** (pas de condition)
- +0.50-0.70% de plus que le Fixe Callable classique (4.00%)
- La capitalisation donne un effet boule de neige
- 0 gestion pendant la vie du produit

**Attention carry trade** : pas de flux annuels → vous payez 29K€/an d'intérêts emprunt sans recevoir de coupon. Il faut avoir la trésorerie pour tenir.

**Sur 500K€, si call An 5** :
```
Vous recevez : 500K × 123% = 615 000€
Capital restitué : 500 000€ · Gain : 115 000€
Intérêts emprunt (5 ans × 14 500€) : -72 500€
IS 25% sur le gain : -10 625€
NET : +31 875€
```

> Demander : "Callable In Fine 10YNC4, 500K-1M€, quel taux annualisé ? Le CIC affiche 4.66%, pouvez-vous faire mieux ?"

---

## 3. RANGE ACCRUAL TEC10 — "Le corridor sur taux longs"

```
Structure : Coupon proportionnel au nb de jours TEC10 dans le corridor
Corridor  : [2.50% — 4.50%] (TEC10 actuel 3.08% = pile au milieu)
Coupon max: 5.50 – 6.50% (si 100% du temps dans le corridor)
Observation: Quotidienne
Maturité  : 8-10 ans · Capital garanti 100%
```

**Calibration historique** :
- TEC10 dans [2.50-4.50%] : **75% du temps** sur les 4 dernières années (2022-2026)
- Marge au plancher : +58bp (TEC10 3.08% vs borne basse 2.50%)
- Marge au plafond : +142bp (TEC10 3.08% vs borne haute 4.50%)

**Pourquoi TEC10 et pas Euribor** :
- TEC10 vol = 14bp/an vs Euribor vol = 51bp/an → **3.6× moins volatile**
- Euribor dans corridor [1.50-4.00%] = seulement 80% récent
- TEC10 dans [2.50-4.50%] = 75% récent et **le coupon est proportionnel** (pas binaire)

**Avantage vs TARN** : pas de 0% brutal. Si TEC10 sort 30 jours → vous perdez 30/365 × coupon, pas tout le coupon annuel. Plus progressif.

> Demander : "Range Accrual TEC10 quotidien [2.50%-4.50%], 10Y capital garanti, 500K-1M€, quel coupon max ?"

---

## 4. STEP-UP CALLABLE — "Le coupon qui monte"

```
Structure : Coupon garanti qui augmente chaque année
Exemple 7Y NC3 :
  An 1 : 3.50%  ← garanti
  An 2 : 3.80%  ← garanti
  An 3 : 4.10%  ← garanti (callable ici)
  An 4 : 4.50%  ← garanti
  An 5 : 5.00%  ← garanti
  An 6 : 5.50%  ← garanti
  An 7 : 6.00%  ← garanti
Coupon moyen : ~4.60% si pas de call
Callable : Émetteur à partir An 3
Capital garanti 100%
```

**Pourquoi c'est intéressant** :
- **100% garanti** — aucune condition, aucun trigger
- Le coupon **augmente** chaque année → plus attractif pour un carry trade car le spread vs emprunt (2.90%) s'élargit chaque année
- An 1 : 3.50% - 2.90% = +0.60% de spread → An 5 : 5.00% - 2.90% = +2.10% de spread
- Psychologiquement rassurant : on voit le coupon monter

**Risque de call** : la banque calle quand le coupon devient trop élevé pour elle. Typiquement An 3-4. Mais même si callé An 3, le coupon moyen (3.50+3.80+4.10)/3 = 3.80% > emprunt 2.90%.

> Demander : "Step-Up Callable 7Y NC3, 500K-1M€, quel schedule de coupons ? Commencer à 3.50% pour finir à combien ?"

---

## 5. FIXED-TO-FLOATER — "Fixe puis variable"

```
Structure : Coupon fixe les premières années, puis indexé Euribor ou TEC10
Phase fixe (An 1-3) : 4.00% garanti
Phase variable (An 4-10) : Euribor 3M + 90bp [floor 2.50%, cap 5.50%]
  Aujourd'hui : 2.11% + 0.90% = 3.01%
  Si Euribor monte à 3% : 3.90%
  Si Euribor baisse à 1% : 2.50% (floor)
Maturité : 8-10 ans · Capital garanti 100%
```

**Pourquoi c'est intéressant** :
- Phase fixe 3 ans = **sécurise le début** du carry trade (4.00% garanti > 2.90%)
- Phase variable = **s'adapte au marché**. Si BCE monte → Euribor monte → coupon monte
- Le floor 2.50% protège contre une baisse brutale (mais 2.50% < 2.90% emprunt → léger risque)
- Le cap 5.50% est rarement atteint

**Attention** : la phase variable avec floor 2.50% est **en dessous du coût d'emprunt** (2.90%). Si Euribor baisse fortement, le carry devient négatif en phase variable.

> Demander : "Fixed-to-Floater 8Y, fixe 4% An 1-3 puis Euribor+spread, 500K-1M€. Quel spread ? Quel floor/cap ?"

---

## 6. DIGITAL TAUX FIXE + BONUS — "Le socle + le bonus"

```
Structure : Coupon fixe garanti + bonus conditionnel
Fixe garanti : 3.00% chaque année (couvre l'emprunt)
Bonus digital : +3.50% si TEC10 ≤ 4.50% (proba ~99% historique)
Total si bonus : 6.50%
Total sans bonus : 3.00% (plancher)
Maturité : 5-10 ans · Capital garanti 100%
```

**Pourquoi c'est intéressant** :
- Le **plancher 3% est TOUJOURS versé** → carry positif garanti (3.00% - 2.90% = +0.10%)
- Le bonus 3.50% se déclenche si TEC10 ≤ 4.50% → proba historique **99%** sur 20 ans
- Le **pire cas = +0.10%/an** (pas de perte, jamais)
- Le total espéré 6.50% est comparable au TARN (6.70%) mais **avec un plancher qui couvre l'emprunt**

**C'est le produit avec le meilleur ratio rendement/sécurité** car le pire cas est toujours positif ET le rendement espéré est élevé.

> Demander : "Hybride Digital 5-10Y, plancher 3% garanti + bonus si TEC10 ≤ 4.50%, 500K-1M€. Quel bonus ? Le plancher 3% est-il faisable avec un bonus de 3%+ ?"

---

## 7. COMPARATIF — Tous les produits sur la table

| # | Produit | Coupon | Garanti min | Trigger/Condition | Pire cas/an vs emprunt | Complexité |
|---|---------|--------|------------|-------------------|----------------------|-----------|
| **REF** | **TARN CIC 6.70%** | **6.70%** | **An 1-2 seul** | **TEC10 ≤ 4.60%** | **-2.90%** (0% coupon) | Moyenne |
| 1 | TARN Mémoire | 5.80-6.20% | An 1-2 | TEC10 ≤ 4.60% + mémoire | -2.90% (mais rattrapé) | Moyenne |
| 2 | Callable In Fine | 4.60-5.00% | **100%** | Aucune | **+1.70%** (garanti) | Faible |
| 3 | Range Accrual TEC10 | 5.50-6.50% | 0% | TEC10 dans [2.50-4.50%] | Proportionnel | Moyenne |
| 4 | Step-Up Callable | 3.50→6.00% | **100%** | Aucune | **+0.60% An1 → +3.10%** | Faible |
| 5 | Fixed-to-Floater | 4.00% puis variable | Phase fixe 100% | Floor/Cap | -0.40% (si floor) | Moyenne |
| **6** | **Digital Plancher+Bonus** | **6.50%** | **3.00%** | **TEC10 ≤ 4.50%** | **+0.10%** (plancher) | Moyenne |

---

## 8. MA RECOMMANDATION — Top 3 à demander en plus du TARN CIC

### Le TARN CIC (6.70%, XS3340532707) est excellent. Le souscrire.

Pour la deuxième ligne de 500K€ (si config 2 produits) ou comme alternative :

**1er choix : Digital Plancher 3% + Bonus TEC10 (produit #6)**
- Pire cas = +0.10%/an (jamais de perte sur le carry)
- Coupon espéré ~6.50% (comparable au TARN)
- Le seul produit où le pire cas est positif ET le rendement est élevé

**2ème choix : Step-Up Callable 7Y NC3 (produit #4)**
- 100% garanti, coupon croissant
- Spread vs emprunt qui s'élargit chaque année
- Zéro stress, zéro condition

**3ème choix : Range Accrual TEC10 [2.50-4.50%] (produit #3)**
- Coupon proportionnel (pas binaire comme le TARN)
- TEC10 bien centré dans le corridor
- Plus progressif si le TEC10 sort temporairement

---

## 9. CONFIG OPTIMALE PROPOSÉE

```
LIGNE 1 : 500 000€ → TARN TEC10 CIC (XS3340532707) — souscrire avant le 24/04
          Coupon 6.70% · Trigger 4.60% · Garanti An 1-2 · Autocall ~4 ans

LIGNE 2 : 500 000€ → Digital Plancher 3% + Bonus TEC10 ≤ 4.50%
          Coupon espéré 6.50% · Plancher 3% garanti (couvre emprunt)
          → À faire structurer sur mesure (RFQ SG ou BNPP)

TOTAL ESPÉRÉ : ~66 000€/an de revenus = +2.78%/an net après IS
PIRE CAS     : +750€/an (TARN 0% + plancher 3% sur 500K)
              → TOUJOURS POSITIF
```

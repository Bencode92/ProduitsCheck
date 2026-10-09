# StructBoard — reprise de session

> Document de passation, écrit le **9 octobre 2026**.
> À lire en entier avant de reprendre le travail sur ce dépôt.
> Il remplace la mémoire d'une session Claude Code qui s'est déroulée du 17 septembre
> au 9 octobre 2026 et qui ne sera pas reprise (changement de machine).

---

## 1. Le contexte

**StructBoard** (`Bencode92/ProduitsCheck`, servi par GitHub Pages) est l'outil de
trésorerie d'entreprise de Benoit. Il couvre deux entités :

| Entité | Profil | Contrainte |
|---|---|---|
| **Caméléons** | prudent, capital garanti, majorité CAT | **plancher dur : ≥ 1 M€ en CAT** |
| **ByCam** | tolérant au risque | aucune contrainte de plancher |

Benoit est responsable financier. Il reçoit des **grilles de taux** de ses banques
(CIC, Banque Populaire, Société Générale) et des **brochures de produits structurés**
de Swiss Life, Natixis et CIC. L'outil sert à décider : placer, arbitrer, ou refuser.

### Ce qu'il attend de la façon de travailler

- **Des euros, pas seulement des pourcentages.** « +24 bp » ne lui parle pas, « +2 834 € sur la durée restante » oui.
- **Une réponse, puis le raisonnement.** Toute page doit trancher en une ligne avant d'expliquer.
- **Discuter avant de modifier** sur les sujets de fond (il l'a demandé explicitement).
- **Vérifier avant d'affirmer.** Plusieurs erreurs de cette session ont été trouvées en exécutant le calcul plutôt qu'en le supposant.
- Il écrit vite et en phonétique. Reformuler sa demande avant d'agir quand elle est ambiguë.

---

## 2. La doctrine de trésorerie

Validée par un expert externe le 17/09/2026, complétée depuis.

### Règles dures

1. **Plancher Caméléons : 1 000 000 € en CAT minimum.** Aucun arbitrage ne peut faire
   passer sous ce seuil. Seule la marge au-dessus est librement allouable (structuré,
   autre durée, autre banque). À vérifier **sur les CAT non échus**, jamais sur le total
   affiché — c'est l'erreur qui a masqué un plancher cassé pendant dix-huit jours.
2. **Concentration : 35 % maximum par groupe bancaire.** BPCE = Banque Populaire +
   Natixis + Caisse d'Épargne. CIC = Crédit Mutuel Alliance Fédérale.
3. **Un structuré ne se compare pas à un CAT 12 mois si son capital n'est pas
   disponible à 12 mois.** La référence d'un produit qui bloque 10 ans est l'OAT
   10 ans, liquide et sans risque émetteur.
4. **Plafond de l'émetteur** : un émetteur ne peut jamais verser, en espérance, plus
   que son propre coût de financement, frais et option de rappel déduits. Un coupon
   affiché très au-dessus de ce plafond signale une condition qui ne se réalisera
   presque jamais. Ce seul raisonnement élimine le Range Accrual CMS, l'EMTN CIC 4,15 %
   et le ZC Natixis — sans modèle.
5. **Callable acceptable uniquement ≥ 4,6-4,8 %** (fixe non rappelable de même durée
   + valeur de l'option vendue).

### Règles de lecture

- **Le taux qui décide est celui d'ici à l'échéance**, pas le palier en cours ni la
  moyenne depuis l'origine. Le passé est encaissé, il ne se renégocie pas.
- **Comparer un CAT au TEC français fausse le jugement** : le TEC porte la prime de
  risque politique française (TEC 2 ans à 3,69 % contre 2,99 % pour la zone euro AAA).
  Pour un dépôt bancaire, la bonne référence est l'**Euribor** jusqu'à 12 mois, le
  **swap** au-delà.
- **Une hausse BCE conforme aux anticipations ne déplace pas les taux offerts** : elle
  est déjà dans le prix. Seules les surprises comptent.

---

## 3. Le portefeuille au 9 octobre 2026

### Caméléons — 1 080 000 € (dont 1 050 000 € de CAT)

| Échéance | Banque | Montant | Taux | Produit |
|---|---|---|---|---|
| — | Banque Populaire | 30 000 € | 3 % | Part sociale (hors plancher) |
| 26/01/2028 | Banque Populaire | 50 000 € | 3,50 % | CATVAIR Grands Comptes 5 ans |
| 05/08/2028 | CIC | 200 000 € | 2,699 % | CATIP ENT 3 ans à préavis |
| 08/08/2029 | Banque Populaire | 250 000 € | 3,10 % | Optiplus 5 ans Réf.000001 |
| 08/08/2029 | Banque Populaire | 250 000 € | 3,10 % | Optiplus 5 ans Réf.000002 |
| 05/10/2029 | CIC | 300 000 € | 3,603 % | **CAT Progressif 36 mois** (nouveau) |

### ByCam — 110 000 €

| Échéance | Banque | Montant | Taux | Produit |
|---|---|---|---|---|
| 12/09/2027 | Société Générale | 60 000 € | 3,21 % | CAT Croissance +3A préavis |
| 12/09/2027 | Société Générale | 50 000 € | 3,21 % | CAT Croissance +3A préavis |

### Concentration — les deux groupes dépassent le plafond

| Groupe | Montant | Part | Plafond |
|---|---|---|---|
| BPCE | 580 000 € | **49 %** | 35 % ⚠ |
| Crédit Mutuel (CIC) | 500 000 € | **42 %** | 35 % ⚠ |
| Société Générale | 110 000 € | 9 % | ✅ |

**Historique** : avant le remploi d'octobre, BPCE était à 74 %. L'exposition maximale
a donc baissé de 25 points, mais deux groupes restent au-dessus du seuil. Benoit en a
été informé et a choisi de maintenir le placement CIC.

---

## 4. Les décisions prises, et pourquoi

### Le remploi des 300 k€ (6 octobre 2026)

Deux Optiplus Conquête de 150 k€ chez Banque Populaire, **échus le 18/09/2026**,
étaient restés marqués `active` pendant dix-huit jours — le plancher Caméléons était
donc cassé (750 k€ réels contre 1 M€ exigé) sans que l'outil le voie.

Archivés en « Maturité », remplacés par le **CAT Progressif 36 mois CIC** :

```
300 000 € · 06/10/2026 → 05/10/2029 · 3,603 % actuariel
Paliers : 3,10 % (an 1) → 3,60 % (an 2) → 4,11 % (an 3)
Sortie anticipée : 1,55 % en an 1, puis taux de la période précédente
Préavis 32 j · SORTIE LIBRE à chaque anniversaire, sans frais ni préavis
33 637 € d'intérêts attendus · revue posée au 06/10/2027
```

**Pourquoi 36 mois plutôt que les 24 mois SG à 3,54 %** : Benoit a choisi CIC. Chez
CIC, le progressif 36 mois est le meilleur produit de toute la grille — 3,60 % de
moyenne, contre 3,03 % pour le marché 3 ans, soit **+57 bp**. Et la sortie libre
annuelle fait que l'engagement réel ne porte que sur la première année.

**Le seul engagement ferme** : sortir avant le 06/10/2027 ramène le taux à 1,55 %.

### Ce qui reste à arbitrer

| Ligne | Taux restant | Marché | Gain net | Action |
|---|---|---|---|---|
| **CATIP CIC** 200 k€ | 2,75 % | 3,54 % | **+2 834 €** | Sortir, préavis 32 j, pénalité **34 €** |
| **Optiplus ×2** 500 k€ | 3,16 % | 3,60 % | **+3 121 € chacun** | ⚠ Conditions de sortie à confirmer par écrit |
| CATVAIR 50 k€ | **5,24 %** | 3,54 % | — | **Garder** — paliers 5,20 puis 5,54 % |

**Sur le CATIP** : une note du dossier recommandait d'attendre la sortie libre du
05/08/2027 pour éviter la pénalité. C'est faux. La pénalité consiste à servir l'année 2
à 2,60 % au lieu de 2,70 %, appliquée aux **jours déjà courus** — soit 34 €. Attendre
dix mois pour économiser 34 € coûte environ 1 300 € de manque à gagner.

**Sur les Optiplus** : la condition enregistrée est « 32 j préavis, pas de pénalité ».
C'est anormalement favorable pour un progressif 5 ans — un tel produit prévoit presque
toujours une reprise sur les intérêts acquis. **Faire confirmer par écrit par la Banque
Populaire avant de bouger 500 000 €.**

### Les produits structurés refusés

| Produit | Raison |
|---|---|
| **SL Range Accrual CMS10Y** 7 %, 10 ans | Corridor [1,50-3,35 %] déjà franchi (CMS à 3,48 %), coupons payés in fine (14 % garantis = 1,32 %/an actuariel), callable dès l'an 3. Espérance 1,3-2,5 %/an. Valeur réelle : 74-82 € pour 100 € investis. |
| **EMTN CIC** 4,15 % 10NC3 | Paie 33 bp **sous** l'OAT de même durée. |
| **ZC Natixis** 4,30 % simple | Intérêt simple (3,64 % actuariel), 0 € encaissé, IS annuel sur intérêts courus, même groupe BPCE. |
| **TARN TEC 10 Déc 2035** (détenu) | Coupon perdu (TEC10 à 4,90 % contre barrière 4,40 %). Bid attendu 75-85 %. |

### En cours d'analyse

**SL Phoenix Mémoire Fast Saint-Gobain** (novembre 2026) — JSON corrigé disponible
dans `~/Downloads/PHOENIX MEMOIRE FAST SAINT GOBAIN NOVEMBRE 2026 - corrige.json`.
Six corrections apportées au parsing automatique. **Deux points restent à vérifier
page 10 de la brochure** (non extractible) : l'échelle d'autocall (100 % puis −5 %/an,
déduite et non lue) et l'ISIN. Son propre cas favorable donne 4,53 % de TRA — à peine
l'OAT, pour une mono-action bloquée 7 ans avec 40 % du capital à risque.

---

## 5. L'architecture du code

Application JavaScript vanilla, sans build. Chargement par `<script>` dans
`index.html`, dans un ordre qui compte : chaque module enveloppe les fonctions des
précédents (`renderCAT`, `renderPlacementCard`…).

### Règle absolue après toute édition JS

**Bumper le `?v=` du script dans `index.html`.** GitHub Pages sert avec un cache
agressif ; sans ça, la modification n'est jamais visible.

### Modules clés

| Fichier | Rôle |
|---|---|
| `js/cat-rates-latest.js` | **Charger en premier.** Une seule grille par banque (la plus récente), péremption à 150 jours, calcul des écarts entre grilles. |
| `js/cat-arbitrage-badge.js` | Le moteur de décision partagé : `_catTauxRestant`, `_catMeilleureOffre`, `_catCoutSortie`. Alimente les badges de carte **et** la section B de Décision v4. |
| `js/cat-decision-v4.js` | **Le bloc unique de décision.** KPI de pilotage, échéances à replacer, lecture du marché, concentration, où placer, quels CAT arbitrer. |
| `js/cat-horizon-grid.js` | Grille d'équivalence par horizon de sortie + verdicts (meilleur produit, fixe ou progressif, faut-il fractionner). |
| `js/market-dashboard.js` | Page Marché : échelle des taux, décomposition du CAT, retard de grille, lancer un structuré ou attendre. |
| `js/comprendre.js` | Page pédagogique : les cinq taux par l'exemple, familles de swaps, 19 fiches produit. |
| `js/cat-optimizer.js` | **Neutralisé.** `window._catShowLegacyOptimizer = true` le réaffiche. Il contredisait Décision v4. |
| `scripts/fetch-rates.py` | Collecte BCE + Banque de France. |
| `scripts/fetch-swaps-eiopa.py` | Courbe swap EUR mensuelle. |
| `tools/grader-filet.cjs` | Rejoue la notation des produits hors navigateur, IA coupée. |

### Vérifier sans navigateur

Il n'existe pas de tests. La méthode utilisée dans cette session : un harnais `vm` Node
qui charge les modules avec des bouchons DOM, appelle la fonction de rendu, écrit le
HTML dans un fichier et vérifie la présence des blocs attendus et **l'équilibre des
balises `<div>`**. Deux pannes de page entières ont été évitées comme ça.

Piège connu : un `const` de haut niveau dans un fichier n'est pas visible du bac à
sable Node s'il est exécuté en script séparé. Il faut **concaténer les fichiers en un
seul script** pour reproduire le scope partagé des `<script>` du navigateur.

---

## 6. Les données de marché

### Sources automatisées (gratuites, sans clé)

| Donnée | Source | Cadence |
|---|---|---|
| Taux directeurs BCE | dataflow `FM` | quotidien |
| **€STR** | dataflow `EST` (`B.EU000A2X2A25.WT`) | quotidien, J+1 |
| **Courbe AAA** 3/6/9/12/24/36/60/84/120 mois | dataflow `YC` (`SR_xM`) | quotidien |
| **Forwards instantanés** 1 à 10 ans | dataflow `YC` (`IF_xY`) | quotidien |
| TEC France 2/5/7/10 | Banque de France Webstat | quotidien |
| **Courbe swap EUR** | **EIOPA**, RFR Solvabilité II | **mensuelle, J+5** |
| Euribor 3/6/12 mois | dataflow `FM` | **moyennes mensuelles seulement** |

### La trouvaille EIOPA

La courbe swap euro est publique et gratuite, personne ne le sait : EIOPA publie chaque
mois la term structure Solvabilité II, dont la colonne Euro (`EUR_<date>_SWP_LLP`) **est**
construite sur les taux swap du marché, diminués d'un *credit risk adjustment* de 10 bp
qu'il suffit de rajouter. Fiable jusqu'à 20 ans (Last Liquid Point).

Ni la BCE ni la Banque de France ne publient de courbe swap (vérifié).

### Conventions — vérifié numériquement, ne pas refaire l'erreur

- La « spot rate » BCE est en **composition continue**. Test : la moyenne des forwards
  instantanés sur [0,T] colle au SR publié à 0,5-2 bp près, contre 6,1-6,8 bp d'écart
  constant si on la suppose annuelle. **Toujours convertir** : `(exp(r/100) − 1) × 100`.
- L'**€STR** est en ACT/360 au jour le jour : capitalisé sur un an, 2,440 % vaut 2,505 %.
- La courbe swap EIOPA étant mensuelle, elle est **recalée** sur la variation de la
  courbe AAA quotidienne de même maturité depuis sa date de publication. Sans ce
  recalage, l'écart avec l'OAT du jour contient le mouvement de marché de l'intervalle.

### Trous connus

| Manque | Conséquence | Contournement |
|---|---|---|
| **CMS quotidien** | Courbe swap arrêtée au 30/09. Quand une barrière se joue à quelques bp, la valeur du jour compte. | Saisie manuelle dans `data/market/swaps-manual.json`, prioritaire sur EIOPA. |
| **Euribor quotidien** | Moyennes mensuelles. Inexploitable pour dater un mouvement de trois semaines. | Aucun. La série quotidienne de la BdF s'arrête au 04/07/2024. La courbe AAA sert de substitut. |
| **Volatilité de swaptions** | Un callable, un TARN, un range accrual vendent de l'optionalité de taux. C'est un vrai levier de timing, non mesuré. | Aucune source gratuite. |
| **Corrélations actions** | Figées depuis le 2 avril. | Sans objet sur les produits de taux. |
| **Forwards Euribor cotés** | Les forwards utilisés sont reconstruits depuis la courbe BCE. | À demander à la conseillère : 6M dans 6M, 12M dans 12M. |

---

## 7. L'état du marché au 9 octobre 2026

```
BCE dépôt 2,50 %  ·  refi 2,65 %  ·  €STR 2,438 %
Hausse de 25 bp décidée le 10/09, effet le 16/09. Prochaine réunion : 29/10.

Courbe zone euro AAA (continu, à convertir) :
   3 m 2,52  ·  6 m 2,68  ·  12 m 2,87  ·  24 m 2,99  ·  36 m 3,03  ·  120 m 3,46

TEC France : 2 a 3,69  ·  5 a 4,21  ·  7 a 4,54  ·  10 a 4,90
Prime France à 10 ans : ~140 bp au-dessus de la zone euro AAA.

Swap EUR (EIOPA 30/09) : 1 a 3,37  ·  2 a 3,54  ·  3 a 3,57  ·  5 a 3,59
```

**Lecture** : la courbe est **plate au-delà d'un an** — 14 bp entre 2 et 5 ans. Le
marché ne price plus de hausse. Il s'est même détendu de 15 à 20 bp sur la première
semaine d'octobre.

**Conséquence pratique** : attendre pour placer ne rapporte rien, et la prochaine
grille CIC risque d'être **plus basse** que celle du 1er octobre, pas plus haute.

### La leçon du 1er octobre

La grille CIC a monté de 15 à 40 bp selon la durée, alors que le marché n'avait bougé
que de 1 à 5 bp. **Ce n'était pas un rattrapage de marché, c'était une décision
commerciale.** Le test de dérive de grille, qui mesure le mouvement du marché depuis
l'édition d'une grille, ne peut pas voir ça : il répond à « la banque me doit-elle un
rattrapage », pas à « la banque va-t-elle devenir plus généreuse ». C'est le seul cas
où attendre une nouvelle grille paie, et il ne se prévoit pas.

---

## 8. Les erreurs de cette session, à ne pas refaire

Elles ont toutes la même famille : **des données périmées ou mal datées traitées comme
vivantes**, et des affirmations non vérifiées.

1. **Le CMS lu sur le TEC.** Le code rapprochait tout produit « CMS » du TEC 5 ans. Un
   taux de swap comparé à un rendement d'État : 100 bp d'écart, systématiquement dans
   le sens qui fait conclure « coupon perdu » à tort.
2. **Deux dates mélangées.** Un swap du 31/08 comparé à un TEC du jour : le mouvement
   de marché de l'intervalle passait pour du spread.
3. **Conventions mélangées**, deux fois — dont une dans la phrase même où je concédais
   l'erreur. Toujours convertir avant de comparer.
4. **Grilles périmées actives.** Septembre et octobre coexistaient pour CIC ; HSBC
   d'avril sortait comme « meilleure offre du jour ».
5. **Lignes échues comptées comme actives.** Le plancher Caméléons paraissait tenu à
   1,05 M€ alors qu'il était à 750 k€.
6. **Causalité supposée.** J'ai affirmé que la date d'effet de la hausse BCE expliquait
   le mouvement des taux à terme. Le test quotidien montre l'inverse : +11,8 bp le jour
   de la **décision** (10/09), −2,3 bp le jour de l'**effet** (16/09).
7. **Erreur d'unité** : 10 bp traités comme 10 %, d'où une pénalité de sortie calculée
   à 3 288 € au lieu de 52 €.
8. **Un calcul de concentration faux** : 300 k€ ajoutés à CIC sans être retirés de
   BPCE, alors que c'est un transfert. J'ai conclu « 34 %, sous le plafond » au lieu de
   42 %. Benoit a décidé sur ce chiffre erroné.

**La contre-expertise externe a trouvé quatre de ces erreurs.** Elle a aussi apporté
deux idées que l'outil a adoptées : le forward **1 an dans 1 an** comme seul instrument
qui dise où sera la grille dans un an, et le fait que les produits de taux vendent de
la **volatilité de taux**, pas de la volatilité actions.

---

## 9. Les problèmes ouverts

### Bloquant

**Le token GitHub du Worker Cloudflare est expiré** (401 Bad credentials). Dernière
écriture réussie depuis l'app : 17/09/2026 à 16 h 25. Le Worker
(`studyforge-proxy.benoit-comas.workers.dev`) répond — seul le token est refusé.

**Conséquence** : l'app ne peut plus rien enregistrer depuis le navigateur. La lecture
fonctionne (elle passe par `raw.githubusercontent.com`, sans authentification), donc la
panne ne se voit qu'au moment d'importer un produit. Les modifications de données de
cette session ont donc été faites **directement dans les fichiers, via git**.

**À faire** : créer un token GitHub avec le droit `contents: write` sur le dépôt et le
poser dans les secrets du Worker (`wrangler secret put GITHUB_TOKEN --name
studyforge-proxy`). **Noter la date d'expiration** — c'est une échéance de plus à
surveiller.

> ⚠️ Le Worker `studyforge-proxy` est **hors limites**. Une modification antérieure y
> avait cassé les appels Anthropic ; il a été restauré à l'octet près. Ne pas y toucher
> au-delà du renouvellement de secret, qui est une action de Benoit.

### À faire

- [ ] **Faire confirmer par écrit les conditions de sortie des Optiplus** (500 k€). La
      condition enregistrée est trop favorable pour être crédible.
- [ ] **Sortir le CATIP** : préavis 32 jours, pénalité 34 €, gain 2 834 €.
- [ ] Demander à la conseillère : **CMS 10 ans du jour**, forwards Euribor 6M dans 6M
      et 12M dans 12M, swaps 2 et 5 ans.
- [ ] Vérifier page 10 de la brochure Phoenix : échelle d'autocall et ISIN.
- [ ] Décider du sort de `cat-optimizer.js` — neutralisé depuis le 6/10, à supprimer
      s'il ne manque à personne.
- [ ] Question ouverte : le plancher de 1 M€ est-il un besoin d'exploitation ou une
      marge de confort ? La réponse détermine s'il existe une enveloppe structuré chez
      Caméléons (aujourd'hui : 50 000 €, donc aucune).

---

## 10. Les artefacts produits

- **`claude.ai/artifact/7gps93RVKted2qpuRSGhNv`** — « Méthode et angles morts », note de
  méthode soumise à contre-expertise. Les sections 1 à 5 documentent les sources et les
  constats ; la section 6 pose sept questions de contestation. **Le contenu est
  antérieur aux corrections** : les chiffres y sont ceux d'avant le recalage de courbe
  et la conversion de conventions.
- `~/Downloads/PHOENIX MEMOIRE FAST SAINT GOBAIN NOVEMBRE 2026 - corrige.json`

---

## 11. Mémoires persistantes liées

Dans `~/.claude/projects/-Users-benoit/memory/` :

- `project_cameleons_plancher_cat.md` — le plancher de 1 M€ et ses implications
- `project_tresorerie_doctrine_expert_2026_09.md` — la doctrine validée par expert
- `reference_courbe_swap_eur_eiopa.md` — où trouver quoi, et l'écart OAT/swap
- `project_produitscheck_grading_audit.md` — le moteur de notation des produits
- `project_produitscheck_rate_tracking.md` — suivi des produits de taux

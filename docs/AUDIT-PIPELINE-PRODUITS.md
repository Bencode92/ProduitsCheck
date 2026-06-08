# Audit du pipeline d'analyse produits — StructBoard

> Document destiné à validation par expert (structuration / risk).
> Date : juin 2026. Périmètre : PDF → Analyseur → JSON → Structuré → Grading.
> Objet : décrire **précisément** chaque étape, ses hypothèses, ses valeurs par défaut,
> ses cas limites et ses points à valider. Rien n'est modifié par ce document.

---

## 0. Vue d'ensemble

```
PDF brochure
   │  (1) extraction texte (pdf.js, pas d'OCR)
   ▼
texte brut (rawText)               ── plafonné : 14 000 car. envoyés à l'IA, 10 000 car. stockés
   │  (2) extraction IA → JSON (Claude)
   ▼
JSON structuré (coupon, barrière, trigger, maturité, ISIN, commissions…)
   │  (2b) post-traitement (32 règles : inversions barrière, annualisation coupon, type…)
   ▼
Produit (id sp_xxx)                 ── stocké JSON sur GitHub ; PDF uniquement en localStorage navigateur
   │  (3) import dans Portefeuille / Propositions
   ▼
Grading (v7) : 4 piliers + ajustement IA → note A–F
```

**Deux chemins d'entrée distincts** (à connaître, ils ne font pas la même chose) :
- **Analyseur (onglet 📄)** : `brochure-parser.js` — envoie le **PDF en base64** à Claude `sonnet-4`, 3000 tokens, et **stocke le PDF en localStorage**.
- **Upload direct (app.js)** : `pdf.js` — envoie le **texte extrait** (14 000 car.) à Claude `opus-4` (fallback sonnet), 8192 tokens, **ne stocke pas le PDF**.

→ Le même produit n'est donc pas traité de façon identique selon le point d'entrée (modèle, format d'entrée, rétention PDF différents). **Point à valider : harmoniser un seul chemin.**

---

## 1. Extraction PDF (étape 1)

| Aspect | Constat | Risque |
|---|---|---|
| Bibliothèque | pdf.js (`getTextContent`) | — |
| OCR | **Aucun** | 🔴 PDF scanné / image → texte vide → échec ("PDF semble vide ou illisible", seuil < 50 car.) |
| Plafond texte | 14 000 car. envoyés à l'IA ; 10 000 car. stockés ; 3 000 car. pour le post-traitement regex | 🟠 Brochures longues (>~6 pages) : pages finales perdues — frais/échéanciers souvent en fin de doc |
| Multi-pages | Concaténées avec séparateurs `--- PAGE n ---` | — |

**À valider expert :** les brochures dépassent-elles régulièrement 14 000 caractères ? Si oui, des infos critiques (échéancier de call, commissions, mentions légales) sont **tronquées avant d'atteindre l'IA**.

---

## 2. Parsing IA → JSON (étape 2)

- **Modèle** : Claude (sonnet-4 via Analyseur / opus-4 via upload direct).
- **Champs demandés** (~40) : name, type, structureType, emitter, guarantor, guarantorRating (Moody's/S&P), isin, underlyings[], underlyingType, currency, maturity, maturityYears, coupon{rate, rateIfCalled, rateIfMaturity, type, frequency, trigger, memory, paymentTiming}, participationRate, capitalProtection{protected, level, barrier, barrierCoupon, couponFloor}, earlyRedemption{possible, type, trigger, frequency, startSemester, stepDown, stepDownPct, callSchedule}, decrementPct, actualDividendYield, scenarios, risks[], mechanism, summary, commissions.
- **Réparation JSON** : `repairJSON()` (chemin upload) — multi-étapes (parse direct → regex accolades → troncature → auto-fermeture). Le chemin Analyseur fait un `JSON.parse` simple (moins robuste).

### 2.1 Fiabilité par champ (à double-checker systématiquement)

| Champ | Fiabilité | Pourquoi |
|---|---|---|
| **commissions** | 🔴 très faible | Rarement dans la brochure ; alerte « non détectées » quasi systématique |
| **ISIN** | 🔴 faible | Formats variables, souvent manqué |
| **guarantorRating** | 🔴 faible | Souvent absent, échelles incohérentes (A+ vs Aa1), non daté |
| **barrière capital** | 🟠 moyen | Souvent **inversée** ou confondue avec le trigger (règles de correction existent mais faillibles) |
| **barrière coupon** | 🟠 moyen | Souvent implicite / inférée du trigger (peut être faux avec mémoire/step-down) |
| **callSchedule (Callable In Fine)** | 🟠 moyen | Dates/montants en tableau dense, mal extraits |
| **coupon rate / fréquence** | 🟠 moyen | Coupon **annualisé** vs périodique : heuristique divise par 2 si semestriel détecté ou si taux >12% (faillible) |
| **structureType** | 🟠 moyen | L'IA tend à mettre « autocall » par défaut ; 32 règles corrigent ; cas « TYPE NON RECONNU » possible |
| **guaranteedYears** | 🟠 moyen | Inféré par regex (« An 1 garanti »…) |
| **maturité, nom, émetteur** | 🟢 bon | Fiable, alertes si manquant |

### 2.2 Validation (ce qui est / n'est pas contrôlé)

- **Alertes générées** : nom/émetteur/coupon/maturité manquants (critique), commissions & ISIN (toujours), barrières manquantes, type non reconnu, etc.
- **NON validé** : cohérence logique (capital garanti **et** barrière <100 ?), barrière vs trigger (inversion), bornes numériques, validité de l'échelle de rating, contenu du tableau `underlyings`, type de coupon vs condition de barrière. → **Un produit incohérent peut être enregistré sans blocage** (les alertes sont indicatives, le bouton « Ajouter » reste actif).

---

## 3. Stockage & récupération du PDF (étape 3) — POINT CLÉ

**Question : « puis-je récupérer les PDF ? » → Réponse : partiellement, et de façon NON durable.**

| Élément | Où | Durable ? |
|---|---|---|
| JSON produit (tous champs) | GitHub `data/banks/{banque}/products/{id}.json` + `data/portfolio.json` (via proxy Cloudflare, token côté serveur) | ✅ oui |
| `rawText` (texte extrait) | dans le JSON produit, **10 000 car. max** | ✅ oui (mais tronqué) |
| `sourceFile` (nom du fichier) | dans le JSON produit | ✅ oui |
| **PDF original (base64)** | **localStorage du navigateur** uniquement (`pdf_{id}`), via le chemin Analyseur seulement | ❌ **non** |

**Constats vérifiés :**
- **0 PDF stocké dans le repo** (recherche `*.pdf` → vide). Aucun champ `pdfUrl`/`pdfPath`.
- Le PDF base64 est écrit en localStorage (`brochure-parser.js:650`) et relu (`grader-ui-patch.js:17`) — donc **affichable, mais seulement** :
  - sur **le même navigateur/appareil** où il a été uploadé,
  - **si** il est passé sous le quota localStorage (~5–10 Mo total → quelques PDF seulement ; échec **silencieux** si plein),
  - **uniquement** si uploadé via l'Analyseur (le chemin upload direct ne le stocke pas).
- Conséquence : **vider le cache, changer d'appareil, ou dépasser le quota = PDF perdu**. Les PDF des 119 produits existants ne sont **pas récupérables** de façon fiable.

**Recommandation forte (à valider) :** stocker le PDF de façon durable (upload base64 sur GitHub via le proxy, ou bucket externe) avec mapping `id → pdfUrl`. Sans ça, la traçabilité réglementaire (preuve de la brochure souscrite) n'est pas assurée.

---

## 4. Import dans Structuré (étape 4) — intégrité

- **ID** : `sp_{timestamp_base36}_{random5}` — pas de contrôle d'unicité/dédup (collision théorique, faible).
- **Persistance** : écriture via proxy Cloudflare ; **l'état mémoire est muté AVANT** l'écriture réseau → en cas d'échec d'écriture, l'UI affiche « ok » mais le distant n'est pas à jour (**perte silencieuse possible**, surtout hors-ligne — pas de file d'attente/retry au-delà d'un retry sur conflit SHA).
- **edit-modal** : les `try/catch` sur sauvegarde **avalent les erreurs silencieusement**.
- **bankId manquant** : produit écrit dans `data/banks/null/products/` (orphelin, hors index) — 2 orphelins observés.
- **Proposition → Portefeuille** : copie complète de l'objet (pas de perte de champ) ; un multi-contrat crée N copies avec nouveaux ids. Édition post-intégration met à jour les 2 fichiers (proposition + portefeuille) — si la 2ᵉ écriture échoue, désynchronisation.

**À valider expert :** acceptable que des écritures puissent échouer silencieusement ? (enjeu : un produit « souscrit » à l'écran mais absent du registre distant.)

---

## 5. Grading (étape 5)

### 5.1 Pipeline (v7 consolidé, réutilise v5)
`NORMALIZE → CONTEXTE → DÉTECTION TYPE → 4 PILIERS → AJUSTEMENT IA → FINALISATION`

### 5.2 Les 4 piliers et leurs poids

| Pilier | Mesure | Poids proposition | Poids portefeuille | Poids Swiss Life |
|---|---|---|---|---|
| P1 Rendement ajusté | rendement espéré (coupon×proba − pertes − frais), pénalité barrière (σ), Black-Scholes si vol dispo | 0,30 | 0,35 | 0,35 |
| P2 Qualité sous-jacent | worst-of : Buffett + Quality + vol + drawdown | 0,25 | 0,35 | 0,25 |
| P3 Fit portefeuille | pénalité de corrélation/recouvrement (base 70) | 0,20 | 0,00 | 0,15 |
| P4 Prime de risque | coupon×proba − perte − prime illiquidité − spread CAT − pénalité émetteur | 0,25 | 0,30 | 0,25 |

**Note finale** : A ≥ 75, B ≥ 60, C ≥ 45, D ≥ 25, F < 25.

### 5.3 Kill criteria (note F automatique)
- **Worst-of de > 8 sous-jacents** → F. (Dispersion, capital garanti, taux fixe : exemptés.)
- Produits de liquidité (SICAV monétaire, livret, CAT…) : note `-` (hors notation).

### 5.4 Ajustement IA
- Appel Claude (opus-4, fallback sonnet) : renvoie un **delta ±15 par pilier** (plafonné ±20, **±10 pour Swiss Life**), un verdict, risques, points de négo, scénarios.
- Sensibilité réduite si capital protégé (×0,3), coupon fixe/garanti (×0,5), maturité longue (×0,2–1,0).
- **Fallback** : si l'IA échoue, on garde le score de base (`aiUsed=false`).

### 5.5 Probabilités & maturité espérée
- **Proba coupon** : 3 modèles selon le produit — (a) table calibrée barrière×maturité (v5), (b) **Black-Scholes** lognormal `N(d2)`, taux sans risque **2,05% (€STR)**, copule gaussienne pour worst-of (v7), (c) **historique 20 ans** pour produits de taux (pondération récence, demi-vie 5 ans).
- **Maturité espérée** (autocall) : chaîne de Markov sur les dates d'observation ; proba de call par observation **45%/36%/32%/28%** selon seuil ≤100/105/110/>110% ; worst-of : `p^√n` ; step-down pris en compte.

### 5.6 Valeurs par défaut quand une donnée manque (à valider)

| Donnée manquante | Valeur par défaut | Impact |
|---|---|---|
| Benchmark CAT | **2,5%** | base du spread P4 — si le vrai CAT diffère, P4 biaisé |
| Volatilité sous-jacent | **30%** (mono), 28% (worst-of), 22% (panier) | sous/sur-estime la distance σ à la barrière → P1/P2 |
| Score Buffett | **35** | P2 |
| Rating émetteur | **NR** (non noté) | pénalité crédit P4 neutralisée |
| Dividende (décrément) | **1%** | peut surestimer le drag |
| Commissions | parsées sinon **0** | P1/P4 et rendement net |

---

## 6. Cas limites & points de vigilance (pour l'expert)

1. **Deux chemins d'ingestion** (modèle + format + rétention PDF différents) → résultats non identiques.
2. **Texte tronqué à 14 000 car.** avant l'IA → infos de fin de brochure (frais, échéancier) potentiellement absentes.
3. **Pas d'OCR** → brochures scannées non traitables.
4. **Barrière capital vs barrière coupon vs trigger autocall** : sources d'erreur fréquentes ; v7 les sépare, v5 non.
5. **Coupon annualisé vs périodique** : heuristique de division faillible (semestriel non détecté → coupon ×2).
6. **Rendement affiché = coupon contractuel** (compté comme acquis sauf si tracking dit « perdu »), pas une espérance proba-pondérée au niveau du registre (le grader, lui, pondère par la proba dans P1/P4).
7. **Frais traités à deux endroits** : (a) le grader (commission annualisée dans P1/P4), (b) la couche d'affichage `scoring.getFeeDrag` (marge amortie sur **maturité espérée** depuis le correctif de juin). **À valider : cohérence entre les deux traitements de frais.**
8. **Déterminisme** : tout est reproductible SAUF l'ajustement IA (température non fixée → la note peut varier d'un run à l'autre de ±quelques points). Base sans IA = 100% reproductible.
9. **Kill « worst-of >8 »** : justification à valider (pourquoi 8 ?).
10. **CAT 2,5% par défaut** : si périmé, fausse le spread et donc P4 + le verdict « vs CAT ».
11. **Écritures silencieuses** (hors-ligne / quota / try-catch) → risque de divergence registre écran vs distant.

---

## 7. Checklist de vérification manuelle par produit (avant grading)

- [ ] Nom / émetteur / garant corrects
- [ ] Coupon : taux **et** fréquence (périodique vs annualisé)
- [ ] Type de coupon : conditionnel / fixe / participation (cohérent avec le trigger)
- [ ] Barrière capital < 100% si autocall (pas « garanti »)
- [ ] Barrière coupon distincte de la barrière capital
- [ ] structureType correct (surtout si « TYPE NON RECONNU »)
- [ ] Années garanties cohérentes
- [ ] Maturité (max **et** espérée plausible)
- [ ] **Commissions / marge de structuration** (quasi toujours à saisir à la main)
- [ ] ISIN (copier depuis la brochure)
- [ ] callSchedule si Callable In Fine
- [ ] step-down si applicable
- [ ] Le **PDF a-t-il bien été sauvegardé** et reste-t-il accessible ? (sinon, archiver à part)

---

## 8. Recommandations prioritaires

1. **Stockage durable du PDF** (GitHub/bucket + `pdfUrl`) — traçabilité réglementaire. *(actuellement : localStorage volatile uniquement)*
2. **Un seul chemin d'ingestion** (même modèle, même format, même rétention).
3. **Augmenter / supprimer le plafond 14 000 car.** ou faire un 2ᵉ passage ciblé sur frais/échéancier.
4. **OCR de secours** pour brochures scannées.
5. **Bloquer (et pas seulement alerter)** sur incohérences dures (capital garanti + barrière <100, barrière coupon manquante sur conditionnel).
6. **Fixer la température IA à 0** pour rendre le grading déterministe.
7. **Gérer les échecs d'écriture** (file d'attente / message clair, pas de catch silencieux).
8. **Réconcilier les deux traitements de frais** (grader vs affichage).
9. **Réviser les défauts** (CAT 2,5%, vol 30%, Buffett 35) avec l'expert et les sourcer/dater.

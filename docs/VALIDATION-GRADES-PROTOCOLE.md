# Protocole de validation empirique des grades — figé AVANT résultats

> But : sortir le grading de l'auto-référence. Aujourd'hui (juin 2026) **aucun produit
> n'est réalisé** (0 autocall, 0 maturité), donc le test ne peut pas tourner. Ce document
> **fige la procédure maintenant**, à l'aveugle des résultats — c'est la protection
> anti-overfitting : on ne pourra pas bricoler les seuils sous pression une fois les
> chiffres connus. À lancer quand le seuil de puissance est atteint, zéro code à improviser.

## Hypothèse testée
H1 : un grade plus élevé (à l'instant de la notation) prédit un **meilleur rendement réalisé net**
et/ou une **moindre fréquence d'incident** (barrière cassée / coupon perdu).
H0 : aucune relation (le grade est du bruit auto-référentiel).

## Définition du « réalisé » (par produit, à l'issue : autocall OU maturité)
- **Rendement réalisé annualisé net** = (coupons effectivement perçus − frais − IS 25%) / nominal / durée réelle.
- **Issue capital** = {capital intact (100%) | perte partielle | perte totale}.
- **Incidents** = barrière capital franchie (oui/non), coupon(s) perdu(s) (compte).
- Source : tracking périodique des niveaux + dates d'observation (⚠ **à collecter** — aujourd'hui 4/47 produits trackés).

## Règle d'or temporelle (anti-erreur-miroir)
On ne mesure QUE des couples où **`gradedAt` (t0) précède strictement l'issue**.
Interdit : corréler grade(t) avec un tracking contemporain ou passé (= `spearmanr(Buffett, perf_trailing)`,
l'erreur structurelle déjà identifiée sur l'autre projet). Le grade doit être figé AVANT le résultat —
le snapshot t0 (`metadata.gradeT0`, `metadata.trackingLevelAt0`, `metadata.inputHash`) le garantit.

## Métriques (définies maintenant)
1. **Spearman(grade_t0, rendement_réalisé)** sur les produits réalisés. Significatif si p < 0,05 **ET** N ≥ seuil.
2. **Spread de bandes** : moyenne réalisée {A,B} vs {C,D}. Attendu si H1 : Δ > 0 et hors intervalle de confiance.
3. **Taux d'incident par bande** : fréquence (barrière cassée / coupon perdu) doit **décroître** de D→A.

## Seuils de puissance (figés AVANT de voir les données)
- **N < 15 produits réalisés** → **lecture descriptive uniquement**, AUCUNE conclusion, AUCUN ajustement du grader.
- **15 ≤ N < 30** → première lecture directionnelle, conclusion faible, pas de recalibration.
- **N ≥ 30** → test formel ; recalibration du grader autorisée **seulement** sur la base de ce résultat, et **jamais** rétro-ajustée pour « faire joli ».

## Pièges à neutraliser (spécifiques structurés)
- **Survivorship** : inclure les produits **rejetés/non souscrits** s'ils ont une issue connue, sinon biais de sélection. À défaut, documenter l'exclusion.
- **Fenêtres / autocall** : la durée réelle varie (autocall ≠ maturité max) → annualiser, ne pas comparer des bruts.
- **Frais & IS** : rendement **net** (cohérent avec le reste de l'app), pas brut.
- **Gel de la note** : le grade comparé est celui figé à t0 (`inputHash`), pas un re-grade ultérieur.

## Procédure d'exécution (quand N suffisant)
1. Sélectionner les produits avec issue réalisée et `gradeT0` antérieur à l'issue.
2. Calculer rendement réalisé net + incidents par produit.
3. Spearman + spread de bandes + taux d'incident, avec N et p-value affichés.
4. Valider d'abord le harness sur **données synthétiques** (IC vrai connu) avant de l'appliquer au réel.
5. Conclusion bornée par le seuil de puissance ci-dessus.

## Préalable bloquant
**La collecte du tracking** (mise à jour périodique des niveaux des sous-jacents) doit être en place,
sinon le « réalisé » ne se remplit jamais. C'est le vrai goulot, pas le code du test.

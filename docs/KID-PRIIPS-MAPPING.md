# Mapping KID PRIIPs (DIC) → champs JSON StructBoard

> Pourquoi : le KID (Key Information Document / Document d'Informations Clés) est un
> document **précontractuel obligatoire et standardisé**. Il contient, dans un format
> prescrit, précisément les données qu'on galère à extraire d'une brochure marketing —
> en particulier les **coûts** (champ 🔴 « commissions »), le **niveau de risque** et les
> **scénarios de performance**. Parser le KID plutôt que la brochure résout d'un coup
> nos 3 pires champs.

## Sections standardisées du KID et leur cible

| Section KID (FR) | Donnée | Champ JSON cible | Note |
|---|---|---|---|
| « Quel est ce produit ? » | Nom, type, terme | `name`, `type`/`structureType`, `maturityYears` | |
| ISIN / Fabricant | ISIN, émetteur | `isin`, `emitter` | |
| « Indicateur de risque » | **SRI 1–7** | `sri` *(nouveau)* | Risque synthétique marché+crédit |
| « Que se passe-t-il si … ne peut pas payer ? » | Garantie / risque crédit | `guarantor`, `guarantorRating` | |
| « Scénarios de performance » | Tensions / Défavorable / Intermédiaire / Favorable | `scenarios.{stress, defavorable, median, favorable}` (% à la RHP) | |
| « Quels sont les coûts ? » → tableau coûts | Coûts d'entrée | `fees.structuring` + `commissions` (upfront) | |
| | Coûts de sortie | `fees.exit` | |
| | Coûts récurrents (gestion) | `fees.custodyAnnual` (%/an) | |
| | **RIY (Réduction du Rendement)** | `riy` *(nouveau)* | Drag annuel agrégé, sert de **sanity-check** des frais |
| « Période de détention recommandée » (RHP) | RHP | cross-check de `maturityYears` | |

## Règles de mapping (post-traitement)

- `commissions` (la marge upfront utilisée par le scoring) ← **coût d'entrée** du KID si présent.
- `fees = { structuring: coût_entrée, exit: coût_sortie, custodyAnnual: coût_récurrent }`.
- `riy` conservé séparément : si `riy` ≫ (structuring/RHP + custodyAnnual), c'est un **signal d'incohérence** (frais sous-déclarés) → à élever en alerte.
- `sri` conservé ; peut alimenter une sanity-check de P2 (un SRI 6-7 sur un produit noté « peu risqué » = drapeau).
- Scénarios KID = **vérité externe** pour challenger les scénarios calculés par le grader (premier pas de validation non auto-référentielle).

## Limites / à valider

- Le coût d'entrée du KID est un **upfront** → amorti sur la maturité **espérée** dans le drag de frais (cohérent avec le correctif de juin).
- Le SRI agrège marché + crédit ; il ne remplace pas le rating émetteur (à garder distinct).
- Conservation documentaire : MiFID II (≈ 5 ans, extensible 7) — à confirmer conformité avant d'en faire une exigence chiffrée.
- Zone euro → régime **PRIIPs KID** applicable (UK = régime CCI, hors périmètre).

## Implémentation (état)

- Prompt d'extraction étendu pour capter `sri`, `riy`, `costEntry`, `costExit`, `costOngoing`, scénarios (champs additifs : null si le doc n'est pas un KID).
- Mapping coûts KID → `commissions`/`fees` + `sri`/`riy` dans le post-traitement du parser.
- **À faire** : sanity-check `riy` vs frais déclarés (alerte si écart) ; affichage SRI sur la fiche produit ; comparaison scénarios KID vs grader (validation).

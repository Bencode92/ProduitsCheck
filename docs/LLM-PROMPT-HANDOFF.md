# Prompt de reprise pour un nouveau LLM

Copie ce prompt tel quel pour démarrer une nouvelle session Claude/GPT sur StructBoard.

---

## PROMPT

```
Tu reprends le développement de StructBoard, un dashboard d'analyse de produits structurés financiers.

Repo: github.com/Bencode92/ProduitsCheck
Site: bencode92.github.io/ProduitsCheck/

Contexte technique:
- Vanilla JS, GitHub Pages, pas de framework
- Grader hybride: scoring déterministe local + ajustement IA (Claude Opus)
- Données marché en JSON sur GitHub, mises à jour par workflows

État actuel (27/03/2026):
- Le grader a été consolidé: 13 patches fusionnés en 1 fichier `js/proposal-grader-v5.js` (v5.1, 65KB)
- Pipeline: NORMALIZE → COLLECT → TYPE → SCORE → ENRICH → AI → FINALIZE
- 5 types supportés: autocall, dispersion, taux_fixe, capital_garanti, rate
- Testé sur 4 produits avec grades corrects

Documentation complète: docs/LLM-HANDOFF-2026-03-27.md dans le repo
Archive des anciens fichiers: js/archive/GRADER-V4-ARCHIVE.md

Avant de modifier quoi que ce soit:
1. Lis `docs/LLM-HANDOFF-2026-03-27.md` pour comprendre l'architecture
2. Lis `js/proposal-grader-v5.js` — c'est LE fichier central du grading
3. Ne crée JAMAIS de patch séparé — tout va dans le fichier consolidé
4. Teste sur les 4 produits existants avant de valider un changement

Préférences utilisateur:
- Réponses en français, ton direct, orienté action
- Challenge les hypothèses, propose des contre-arguments
- Evidence-based, cite les sources, indique l'incertitude
- Mets en avant les risques (drawdown, vol, corrélations, queues)
- Livrables prêts à l'emploi: code, checklists, tableaux

Prochaines tâches prioritaires:
1. Fix parser pdf.js pour détecter les digitales capital garanti (règle 17)
2. Ajouter champ barrierCoupon dans edit-modal.js
3. Corrélation worst-of pour probabilité coupon
4. Supprimer les 13 anciens fichiers grader (liste dans GRADER-V4-ARCHIVE.md)
5. Backtest grades vs outcomes réels

Que veux-tu faire?
```

# StructBoard — Tableau de Bord Produits Structurés

Dashboard personnel pour le suivi, l'analyse et la gestion de produits structurés.

## Fonctionnalités

- **Portefeuille** — Registre complet avec upload PDF, extraction IA, suivi nominal/coupons/barrières
- **Propositions par Banque** — Réception, scoring de compatibilité, statuts de suivi
- **Analyse IA (Claude)** — Extraction brochure, résumé structuré, chat interactif, archivage décision
- **Scoring** — Redondance/complémentarité vs book, matrice de corrélation implicite

## Structure

```
ProduitsCheck/
├── index.html
├── css/style.css
├── js/
│   ├── config.js      # Configuration, constantes, poids scoring
│   ├── github.js      # CRUD JSON via GitHub API
│   ├── pdf.js         # Extraction PDF + parsing IA
│   ├── scoring.js     # Moteur de scoring
│   ├── app.js         # State management
│   └── ui.js          # Rendu DOM, modales, chat
├── data/
│   ├── portfolio.json
│   └── banks/{swiss-life,sg,cic}/
│       ├── index.json
│       └── products/
```

## Setup

1. Activer GitHub Pages (Settings → Pages → main)
2. Configurer `AI_ENDPOINT` dans `js/config.js` avec votre Cloudflare Worker
3. Ouvrir le site → Token GitHub → Upload PDF

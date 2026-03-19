# StructBoard — Tableau de Bord Produits Structurés

Dashboard personnel pour le suivi, l'analyse et la gestion de produits structurés.

## Fonctionnalités

### 📋 Portefeuille
- Registre complet de vos produits structurés en vie
- Upload PDF de brochure → extraction automatique par IA (Claude)
- Suivi du nominal investi, coupons, barrières, maturités
- Vue par carte avec accès rapide aux fiches détaillées

### 📨 Propositions par Banque
- Réception et enregistrement des propositions (Swiss Life, SG, CIC, etc.)
- Organisation par banque avec sous-dossiers par produit
- Score de compatibilité automatique vs portefeuille existant
- Statuts : Reçue → En analyse → Shortlistée → Souscrite / Rejetée

### 🤖 Analyse IA (Claude)
- Extraction automatique des infos clés depuis les brochures PDF
- Résumé structuré : sous-jacent, coupons, garantie, remboursement anticipé, scénarios
- Score de redondance/complémentarité vs book existant
- Chat interactif par produit pour approfondir l'analyse
- Résumé de discussion et archivage de la décision

### 📊 Scoring de Compatibilité
- **Redondance** : même sous-jacent, même type, même banque, maturité chevauchante
- **Complémentarité** : nouveau sous-jacent, nouvelle structure, diversification émetteur
- **Corrélation** : matrice de corrélation implicite entre classes de sous-jacents
- Verdict automatique avec détails des facteurs

## Structure du Repo

```
ProduitsCheck/
├── index.html              # Point d'entrée
├── css/
│   └── style.css           # Styles (dark terminal aesthetic)
├── js/
│   ├── config.js           # Configuration, constantes, poids scoring
│   ├── github.js           # API GitHub (lecture/écriture JSON)
│   ├── pdf.js              # Extraction PDF + parsing IA
│   ├── scoring.js          # Moteur de scoring compatibilité
│   ├── app.js              # Logique applicative, state management
│   └── ui.js               # Rendu DOM, modales, interactions
├── data/
│   ├── portfolio.json      # Produits en portefeuille
│   └── banks/
│       ├── swiss-life/
│       │   ├── index.json  # Index des produits Swiss Life
│       │   └── products/   # Fiches produits individuelles
│       ├── sg/
│       │   ├── index.json
│       │   └── products/
│       └── cic/
│           ├── index.json
│           └── products/
└── README.md
```

## Installation

### 1. Prérequis
- Un repo GitHub (public pour le proto, privé pour la prod)
- GitHub Pages activé sur le repo
- Un Cloudflare Worker configuré comme proxy pour l'API Claude

### 2. Cloudflare Worker

Créer un Worker avec ce code (adapter selon votre configuration) :

```javascript
export default {
  async fetch(request, env) {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
```

Ajouter `ANTHROPIC_API_KEY` dans les secrets du Worker.

### 3. Configuration

Dans `js/config.js`, mettre à jour :
```javascript
AI_ENDPOINT: 'https://your-worker.your-subdomain.workers.dev/api/chat',
```

### 4. Déploiement

```bash
git add .
git commit -m "Initial StructBoard setup"
git push origin main
```

Activer GitHub Pages (Settings → Pages → Source: main branch).

## Utilisation

1. Ouvrir le site → Entrer votre token GitHub (session uniquement)
2. **Ajouter un produit** : Upload PDF ou saisie manuelle
3. **Recevoir une proposition** : Choisir la banque → Upload PDF
4. **Analyser** : Consulter le score, le résumé IA, discuter avec Claude
5. **Décider** : Intégrer (montant investi) ou Rejeter (raison archivée)

## Sécurité

- Token GitHub stocké en `sessionStorage` uniquement (effacé à la fermeture)
- Clé API Anthropic côté Cloudflare Worker (jamais exposée côté client)
- Données financières sur le repo GitHub (privé recommandé pour la prod)

## Roadmap

- [ ] Suivi temps réel (coupons touchés, rappels anticipés, valeur estimée)
- [ ] Export Excel du portefeuille
- [ ] Notifications de dates clés (observation autocall, maturité)
- [ ] Comparateur multi-propositions côte à côte
- [ ] Graphiques de répartition (par banque, sous-jacent, maturité)

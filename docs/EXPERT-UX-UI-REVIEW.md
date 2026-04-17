# Revue Expert UX/UI — StructBoard
## Dashboard financier de gestion de trésorerie corporate

**Repo** : https://github.com/Bencode92/ProduitsCheck
**Live** : https://bencode92.github.io/ProduitsCheck/
**Stack** : Vanilla JS + CSS (pas de framework) · GitHub Pages
**Utilisateurs** : DAF / trésorier d'entreprise + collègues non-experts

---

## 1. CONTEXTE DU PRODUIT

### Ce que fait StructBoard
Tableau de bord pour gérer la trésorerie d'une entreprise (Caméleons Com Mark) :
- **Page Marché** : données de taux en temps réel (TEC10, OAT, Euribor), charts 20 ans, analyse de seuils
- **Page Carry Trade** : simulation d'un investissement de 1M€ en produits structurés, 3 configs comparées, P&L détaillé
- **Produits Structurés** : portefeuille de 82 produits avec parsing PDF et grading automatique
- **Comptes à Terme** : suivi des CAT, optimisation, taux progressifs
- **Analytique** : vue portefeuille globale

### Utilisateurs cibles
1. **Le DAF** (utilisateur principal) : expert en finance, utilise l'outil quotidiennement pour prendre des décisions de placement. Besoin de précision et de rapidité.
2. **Sa collègue** : moins experte en structurés, doit comprendre les produits et les risques. Besoin de clarté et de pédagogie.
3. **Les banquiers** (en RDV) : voient l'écran partagé lors des réunions. Besoin de crédibilité professionnelle.

---

## 2. ÉTAT ACTUEL — CAPTURES D'ÉCRAN

### 2.1 Navigation (topbar)
![Topbar](topbar.png)
- Fond bleu gradient (#1E3A5F → #2563EB)
- 7 onglets avec séparateurs visuels
- Marché en premier, Carry Trade en second

### 2.2 Page Marché
- Fond bleu très clair (#EFF6FF)
- 5 cartes de taux cliquables (TEC10, OAT 5Y, OAT 2Y, Euribor 3M, Euribor 12M)
- Chart SVG interactif avec analyse de seuils
- Sections accordéon (jauges produits, synthèse Swiss Life, guide produits)

### 2.3 Page Carry Trade
- Fond blanc (#F8F9FB)
- Tableau comparatif 3 configurations
- Verdict risque/rendement
- Cahier des charges en accordéon (script RDV, fiches produits, questions)
- Import JSON de propositions banquiers
- P&L année par année
- Tableau amortissement emprunt SG

### 2.4 Pages Structurés / CAT / Analytique
- Fond bleu très clair
- Cartes blanches avec ombres légères
- Hover effects sur les produits

---

## 3. CE QUE JE VOUDRAIS QUE L'EXPERT ÉVALUE

### 3.1 Cohérence visuelle

- Le **Carry Trade** a un fond blanc (#F8F9FB) tandis que les autres pages ont un fond bleu clair (#EFF6FF). Est-ce cohérent ou dérangeant ?
- La **topbar bleu gradient** fonctionne-t-elle avec le fond bleu clair ? Pas trop de bleu sur bleu ?
- Les **séparateurs** dans la topbar sont-ils lisibles ? Les onglets assez gros ?

### 3.2 Tableaux et données

Les tableaux sont le cœur de l'outil. Chaque page en a plusieurs :

**Page Carry Trade — Tableau des 3 configs :**

| CONFIG | PRODUIT(S) | CENTRAL/AN | BEST CASE 5A | ESPÉRANCE 5A | WORST CASE 5A |
|--------|-----------|-----------|-------------|-------------|--------------|
| 🏆 A (highlight vert) | 500K TARN + 500K Digital | +2.59% | +129K€ | +116K€ | +0€ |
| 🎯 B | 1M TARN 7% | +2.48% | +124K€ | +111K€ | -5K€ |
| 🛡️ C | 500K TARN + 500K Fixe | +1.80% | +90K€ | +84K€ | +26K€ |

**Questions :**
- Les colonnes sont-elles trop nombreuses ? Faut-il simplifier ?
- Le highlight vert (#DCFCE7) pour la meilleure config est-il suffisant ?
- Les emoji (🏆🎯🛡️) aident-ils ou c'est trop enfantin pour un outil pro ?
- Les montants en euros sont-ils lisibles en monospace ? Faut-il des couleurs plus marquées ?

**Page Marché — Tableau stats par période :**

| PÉRIODE | MIN | MAX | MOYENNE | VARIATION | OBS |
|---------|-----|-----|---------|-----------|-----|
| 12 mois | 2.979% | 3.150% | 3.085% | -6bp | 12 |
| 2 ans | ... | ... | ... | ... | ... |

**Questions :**
- Le font-size 11px est-il trop petit ?
- Les couleurs vert/rouge sur les variations sont-elles assez contrastées sur fond blanc ?

### 3.3 Typographie

Actuellement :
- **Titres** : Outfit, 13-16px, font-weight 700-800
- **Corps** : Outfit, 10-12px
- **Données chiffrées** : JetBrains Mono, 11-22px selon importance
- **Descriptions** : 9-10px, color #94A3B8 (gris clair)

**Questions :**
- La hiérarchie typographique est-elle claire ? Les tailles suffisantes ?
- Le monospace (JetBrains Mono) est-il le bon choix pour les chiffres ?
- Les descriptions en 9px sont-elles lisibles ?

### 3.4 Couleurs

**Palette actuelle :**

| Usage | Couleur | Hex |
|-------|---------|-----|
| Fond pages | Bleu très clair | #EFF6FF |
| Fond Carry Trade | Blanc cassé | #F8F9FB |
| Cartes | Blanc | #FFFFFF |
| Bordures | Gris | #CBD5E1 |
| Texte principal | Foncé | #1E293B |
| Texte secondaire | Gris | #64748B |
| Texte dim | Gris clair | #94A3B8 |
| Accent principal | Bleu | #2563EB |
| Positif / gain | Vert | #059669 |
| Négatif / perte | Rouge | #DC2626 |
| Attention | Orange | #D97706 |
| Violet (import) | Violet | #7C3AED |
| Cyan (taux) | Cyan | #0891B2 |
| Topbar | Bleu gradient | #1E3A5F → #2563EB |

**Questions :**
- Trop de couleurs fonctionnelles ? Les 6 couleurs (bleu, vert, rouge, orange, violet, cyan) sont-elles confuses ?
- Le vert #059669 est-il assez distinct du cyan #0891B2 ?
- Le fond #EFF6FF (bleu) crée-t-il un bon contraste avec les cartes blanches ?

### 3.5 Accordéons

Le Carry Trade utilise beaucoup d'accordéons (cahier des charges, 7 sections pliables).

**Questions :**
- Les accordéons sont-ils le bon pattern pour un outil de décision financière ?
- L'indicateur ▶/▼ est-il suffisant ou faut-il un meilleur affordance visuelle ?
- Faut-il que certaines sections soient ouvertes par défaut ?

### 3.6 Cartes de taux (Page Marché)

5 cartes cliquables en ligne avec :
- Nom du taux
- Valeur en gros (20px monospace)
- Description courte
- Sous-texte avec vol/direction

**Questions :**
- 5 cartes sur une ligne c'est trop dense ?
- La taille 20px pour la valeur est-elle assez grande ?
- Le "▼ CLIC" est-il un bon CTA pour indiquer que c'est cliquable ?

### 3.7 Chart SVG (Page Marché)

Chart interactif avec :
- Ligne bleue + area fill
- Seuils en pointillés
- Points de données
- Sélecteur de période (12M/2A/5A/10A/20A/MAX)
- Input de seuil custom + bouton Analyser

**Questions :**
- Le chart est-il lisible sur petit écran ?
- Les labels des seuils (badges colorés) ne se chevauchent-ils pas ?
- Le sélecteur de période (boutons) est-il intuitif ?

### 3.8 Import JSON (Carry Trade)

Zone avec textarea + bouton Importer pour coller des propositions de banquiers.

**Questions :**
- Un textarea pour du JSON c'est user-friendly pour un DAF ?
- Faudrait-il plutôt un formulaire avec des champs nommés ?
- Ou un upload de fichier ?

---

## 4. CONTRAINTES TECHNIQUES

- **Vanilla JS** : pas de React, pas de framework CSS. Tout est en inline styles ou dans `css/style.css`.
- **GitHub Pages** : pas de serveur, tout en statique.
- **Monolithique** : 70+ fichiers JS, 1 CSS global. Les pages Carry Trade et Marché ont leur propre thème light en inline.
- **Responsive** : non prioritaire (utilisé sur desktop principalement), mais devrait être lisible sur tablette.

---

## 5. QUESTIONS SPÉCIFIQUES POUR L'EXPERT

| # | Question |
|---|---------|
| 1 | Le **fond bleu clair** (#EFF6FF) est-il professionnel pour un outil financier corporate ? Ou trop "soft" ? |
| 2 | La **topbar gradient bleu** est-elle trop forte visuellement ? Faudrait-il un bleu plus sobre ? |
| 3 | Les **tableaux** (comparaison configs, P&L année par année) sont-ils bien structurés ? Colonnes à supprimer/ajouter ? |
| 4 | Les **accordéons** du cahier des charges fonctionnent-ils ? Ou faudrait-il tout afficher (onglets internes) ? |
| 5 | Les **emoji** dans les onglets et titres de section (📈🏦📦✅🏆) sont-ils adaptés à un contexte pro ? |
| 6 | La **densité d'information** est-elle trop élevée ? Le Carry Trade a 6 blocs empilés verticalement. |
| 7 | Le **contraste texte/fond** est-il suffisant ? Les gris (#64748B, #94A3B8) sur fond blanc (#FFFFFF) passent-ils les standards WCAG ? |
| 8 | Le **chart SVG** devrait-il utiliser Chart.js ou une lib dédiée pour plus de fonctionnalités (tooltip, zoom, responsive) ? |
| 9 | L'**import JSON** est-il le bon pattern ? Alternative : formulaire structuré, upload CSV/PDF ? |
| 10 | Quelles sont les **3 améliorations prioritaires** qui auraient le plus d'impact sur l'expérience utilisateur ? |

---

## 6. ACCÈS

- **Site live** : https://bencode92.github.io/ProduitsCheck/
- **Repo** : https://github.com/Bencode92/ProduitsCheck
- **CSS principal** : `css/style.css`
- **Pages clés** :
  - Onglet **Marché** (page par défaut)
  - Onglet **Carry Trade**
  - Onglet **Structurés** (dashboard produits)

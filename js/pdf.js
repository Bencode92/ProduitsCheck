// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing (V2)
// Extraction texte complète + parsing IA optimisé pour brochures FR
// ═══════════════════════════════════════════════════════════════

class PDFExtractor {
  constructor() { this.initialized = false; }

  async init() {
    if (this.initialized) return;
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.PDFJS_CDN + '/pdf.worker.min.js';
      this.initialized = true;
    }
  }

  async extractText(file) {
    await this.init();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const typedArray = new Uint8Array(e.target.result);
          const pdf = await pdfjsLib.getDocument(typedArray).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            fullText += `\n--- PAGE ${i} ---\n` + pageText;
          }
          resolve(fullText.trim());
        } catch (err) { reject(new Error('Erreur extraction PDF: ' + err.message)); }
      };
      reader.onerror = () => reject(new Error('Erreur lecture fichier'));
      reader.readAsArrayBuffer(file);
    });
  }
}

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    // Envoyer TOUT le texte (jusqu'à 12000 chars) pour couvrir les pages clés
    const textToSend = rawText.substring(0, 12000);

    const prompt = `Tu es un analyste EXPERT en produits structurés français (autocall, phoenix, reverse convertible, capital protégé, EMTN). Tu DOIS extraire TOUTES les informations de cette brochure.

TEXTE COMPLET DE LA BROCHURE:
---
${textToSend}
---

INSTRUCTIONS CRITIQUES:
- Lis TOUT le texte attentivement, les infos sont réparties sur plusieurs pages
- Le "gain" ou "objectif de gain" = c'est le COUPON (ex: "gain de 5,7% par année" → coupon = 5.7%)
- "remboursement automatique anticipé" = AUTOCALL
- Cherche les % précis: taux, barrières, seuils, rendements
- Les scénarios sont TOUJOURS décrits: favorable (hausse), médian (neutre), défavorable (baisse)
- La protection du capital peut être à l'échéance seulement
- Cherche le code ISIN, l'émetteur, le garant, le distributeur
- Cherche les dates: émission, constatation initiale, constatation finale, échéance

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de \`\`\`):
{
  "name": "Nom COMPLET du produit (ex: SL - ATHENA PRIVILEGE ENI DECEMBRE 2025)",
  "type": "autocall ou phoenix ou reverse-convertible ou capital-protege ou participation ou range-accrual ou cln ou emtn ou autre",
  "emitter": "Émetteur (la société qui émet, ex: Goldman Sachs Finance Corp International Ltd)",
  "guarantor": "Garant si différent de l'émetteur",
  "distributor": "Distributeur (ex: SwissLife Banque Privée)",
  "isin": "Code ISIN si trouvé",
  "underlyings": ["Liste exacte des sous-jacents (noms complets)"],
  "underlyingType": "single-stock ou eurostoxx50 ou cac40 ou sp500 ou basket ou rates ou credit ou autre",
  "currency": "EUR",
  "maturity": "Durée (ex: 12 ans)",
  "maturityDate": "Date d'échéance YYYY-MM-DD ou null",
  "strikeDate": "Date de constatation initiale YYYY-MM-DD ou null",
  "nominal": "Valeur nominale (ex: 1000 EUR)",
  "coupon": {
    "rate": 5.7,
    "type": "conditionnel ou fixe ou memoire",
    "frequency": "annuel ou semestriel ou trimestriel ou mensuel",
    "trigger": 100,
    "triggerDetail": "Description du seuil (ex: 100% du Niveau Initial de l'action)",
    "memory": false,
    "maxReturn": "Rendement max par an en % si plafonné",
    "totalReturn": "Gain total max en % si mentionné (ex: 68.4% sur 12 ans)"
  },
  "capitalProtection": {
    "protected": true,
    "level": 100,
    "type": "inconditionnelle-a-echeance ou conditionnelle-barriere ou aucune",
    "barrier": null,
    "barrierType": "europeenne ou americaine ou continue ou discrete",
    "barrierObservation": "Description (ex: à maturité, observation continue)",
    "inLifeRisk": "Description du risque en cours de vie (ex: perte totale possible si revente avant échéance)"
  },
  "earlyRedemption": {
    "possible": true,
    "type": "autocall ou issuer-call ou none",
    "trigger": 100,
    "triggerDetail": "Description (ex: si l'action clôture >= 100% du Niveau Initial)",
    "frequency": "annuel ou semestriel ou trimestriel",
    "startYear": 1,
    "stepDown": false,
    "stepDownDetail": "Si dégressif, détail"
  },
  "scenarios": {
    "favorable": "DÉTAILLÉ: ce qui se passe, rendement en %, TRA, exemple chiffré",
    "median": "DÉTAILLÉ: ce qui se passe, rendement en %, TRA, exemple chiffré",
    "defavorable": "DÉTAILLÉ: ce qui se passe, perte en %, exemple chiffré"
  },
  "advantages": ["Liste des avantages mentionnés dans la brochure"],
  "risks": ["Liste COMPLÈTE des risques: perte en capital, crédit, liquidité, marché, inflation, etc."],
  "keyDates": ["Toutes les dates importantes trouvées"],
  "ratings": "Notations de l'émetteur/garant (S&P, Moody's, Fitch)",
  "eligibility": "Éligibilité (compte-titres, assurance-vie, etc.)",
  "summary": "Résumé COMPLET en 4-5 phrases: type de produit, sous-jacent, coupon/gain, protection, autocall, durée"
}

IMPORTANT: Pour chaque champ, si tu trouves l'info dans le texte, REMPLIS-LE. Ne mets null que si l'info est VRAIMENT absente. Cherche bien dans TOUTES les pages.`;

    try {
      const response = await this._callAI(prompt, 3000);
      let cleaned = response.trim();
      cleaned = cleaned.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
      return JSON.parse(cleaned);
    } catch (e) {
      console.error('Erreur parsing IA:', e);
      throw new Error('Impossible de parser la brochure: ' + e.message);
    }
  }

  async generateSummary(productData) {
    const prompt = `Tu es un analyste senior en produits structurés. Génère un résumé LISIBLE et STRUCTURÉ de ce produit.

DONNÉES EXTRAITES:
${JSON.stringify(productData, null, 2)}

CONSIGNES:
- Utilise le format markdown avec des ## pour les sections
- Sois PRÉCIS avec les CHIFFRES (taux, %, dates, seuils)
- Chaque section doit contenir des informations CONCRÈTES, pas "non disponible"

Format EXACT à suivre:

## 1. DESCRIPTION
[Type de produit, émetteur, sous-jacent, durée — 2 phrases max]

## 2. RENDEMENT & COUPONS
[Taux du gain/coupon, fréquence, conditions de versement, seuil de déclenchement, gain max plafonné — avec les chiffres]

## 3. PROTECTION DU CAPITAL
[Protégé ou non, à quel niveau, quelle condition, barrière si applicable — en cours de vie vs à échéance]

## 4. REMBOURSEMENT ANTICIPÉ
[Autocall oui/non, à partir de quand, seuil de déclenchement, fréquence d'observation]

## 5. SCÉNARIOS
**Favorable:** [description avec chiffres]
**Médian:** [description avec chiffres]
**Défavorable:** [description avec chiffres]

## 6. POINTS D'ATTENTION
[3-5 risques/points clés à surveiller — perte en capital, risque émetteur, dividendes non réinvestis, etc.]

Sois direct, précis, PAS DE LANGUE DE BOIS.`;

    return await this._callAI(prompt, 2500);
  }

  async chat(messages, productContext, portfolioContext) {
    const systemPrompt = `Tu es un analyste expert en produits structurés. Tu discutes avec un investisseur/conseiller.

PRODUIT EN DISCUSSION:
${JSON.stringify(productContext, null, 2)}

PORTEFEUILLE ACTUEL:
${JSON.stringify(portfolioContext, null, 2)}

Règles:
- Sois direct, précis, evidence-based
- Cite les CHIFFRES du produit (coupon, barrière, seuils, dates)
- Challenge les hypothèses si nécessaire
- Mentionne les risques (drawdown, corrélation, queues de distribution)
- Compare avec le marché quand pertinent
- Donne ton avis franchement avec pour ET contre`;

    try {
      return await this._callAIWithHistory(systemPrompt, messages);
    } catch (e) { console.error('Erreur chat IA:', e); throw e; }
  }

  async summarizeConversation(messages, decision) {
    const chatText = messages.map(m => `${m.role === 'user' ? 'MOI' : 'CLAUDE'}: ${m.content}`).join('\n');
    const prompt = `Résume cette discussion sur un produit structuré en 3-5 points clés.

CONVERSATION:
${chatText}

DÉCISION FINALE: ${decision || 'Non encore décidée'}

Format:
- Points principaux discutés
- Arguments pour/contre
- Conclusion/décision et raison`;
    return await this._callAI(prompt, 1500);
  }

  async _callAI(prompt, maxTokens) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens || 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`AI API ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content?.map(b => b.text || '').join('\n') || '';
  }

  async _callAIWithHistory(systemPrompt, messages) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: messages,
      }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`AI API ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content?.map(b => b.text || '').join('\n') || '';
  }
}

const pdfExtractor = new PDFExtractor();
const aiParser = new AIParser();

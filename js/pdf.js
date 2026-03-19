// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing
// Extraction texte via pdf.js + parsing IA via Claude
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
            fullText += pageText + '\n\n';
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
    const prompt = `Tu es un analyste expert en produits structurés. Analyse ce texte de brochure et extrais les informations clés au format JSON strict.

TEXTE DE LA BROCHURE:
---
${rawText.substring(0, 6000)}
---

Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de backticks), avec cette structure exacte:
{
  "name": "Nom complet du produit",
  "type": "Type (autocall/phoenix/reverse-convertible/capital-protege/participation/range-accrual/cln/emtn/autre)",
  "emitter": "Nom de l'émetteur/banque",
  "underlyings": ["Liste des sous-jacents"],
  "underlyingType": "Type de sous-jacent (eurostoxx50/cac40/sp500/single-stock/basket/rates/credit/etc)",
  "currency": "EUR/USD/etc",
  "maturity": "Durée en texte (ex: 10 ans)",
  "maturityDate": "Date de maturité si mentionnée (YYYY-MM-DD ou null)",
  "strikeDate": "Date de constatation initiale si mentionnée (YYYY-MM-DD ou null)",
  "nominal": "Nominal ou valeur nominale si mentionné",
  "coupon": {
    "rate": "Taux du coupon en % (nombre)",
    "type": "fixe/conditionnel/memoire",
    "frequency": "annuel/semestriel/trimestriel/mensuel",
    "trigger": "Seuil de déclenchement du coupon en % si conditionnel (nombre ou null)",
    "memory": "true/false - effet mémoire sur les coupons"
  },
  "capitalProtection": {
    "protected": "true/false",
    "level": "Niveau de protection en % (100 = total, 90 = 90%, etc)",
    "type": "inconditionnelle/conditionnelle-barriere/aucune",
    "barrier": "Niveau de barrière de protection du capital en % (nombre ou null)",
    "barrierType": "europeenne/americaine/continue/discrete",
    "barrierObservation": "Description de l'observation (à maturité, continue, dates fixes)"
  },
  "earlyRedemption": {
    "possible": "true/false",
    "type": "autocall/issuer-call/none",
    "trigger": "Seuil de rappel anticipé en % (nombre ou null)",
    "frequency": "Fréquence d'observation autocall",
    "stepDown": "true/false - trigger dégressif",
    "stepDownDetail": "Détail de la dégressivité si applicable"
  },
  "scenarios": {
    "favorable": "Description du scénario favorable avec rendement",
    "median": "Description du scénario médian",
    "defavorable": "Description du scénario défavorable avec perte max"
  },
  "risks": ["Liste des risques principaux identifiés"],
  "keyDates": ["Dates clés identifiées"],
  "summary": "Résumé en 3-4 phrases du produit, son fonctionnement et ses caractéristiques principales"
}

Si une information n'est pas trouvée dans le texte, mets null. Sois précis sur les chiffres.`;

    try {
      const response = await this._callAI(prompt);
      let cleaned = response.trim();
      cleaned = cleaned.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
      return JSON.parse(cleaned);
    } catch (e) {
      console.error('Erreur parsing IA:', e);
      throw new Error('Impossible de parser la brochure: ' + e.message);
    }
  }

  async generateSummary(productData) {
    const prompt = `Tu es un analyste senior en produits structurés. Génère un résumé clair et structuré de ce produit.

DONNÉES DU PRODUIT:
${JSON.stringify(productData, null, 2)}

Génère un résumé en français, structuré ainsi:
1. DESCRIPTION — Ce que c'est en 2 phrases simples
2. MÉCANISME DES COUPONS — Comment et quand on est payé
3. PROTECTION DU CAPITAL — Quel niveau, quelle condition
4. REMBOURSEMENT ANTICIPÉ — Si possible, comment
5. SCÉNARIOS — Résumé des 3 scénarios avec chiffres
6. POINTS D'ATTENTION — 2-3 risques clés

Sois direct, précis, pas de langue de bois.`;
    return await this._callAI(prompt);
  }

  async chat(messages, productContext, portfolioContext) {
    const systemPrompt = `Tu es un analyste expert en produits structurés. Tu discutes avec un investisseur/conseiller à propos d'un produit spécifique.

PRODUIT EN DISCUSSION:
${JSON.stringify(productContext, null, 2)}

PORTEFEUILLE ACTUEL DE L'INVESTISSEUR:
${JSON.stringify(portfolioContext, null, 2)}

Règles:
- Sois direct, précis, evidence-based
- Challenge les hypothèses si nécessaire
- Mentionne les risques (drawdown, corrélation, queues de distribution)
- Si on te demande un avis, donne-le franchement avec les pour ET les contre
- Quand tu résumes une décision, sois factuel et actionnable`;

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

Format du résumé:
- Points principaux discutés
- Arguments pour/contre
- Conclusion/décision et raison`;
    return await this._callAI(prompt);
  }

  async _callAI(prompt) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
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

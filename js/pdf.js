// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing (V5 — robust JSON repair)
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

// ─── Robust JSON Repair V2 ─────────────────────────────────
function repairJSON(str) {
  if (!str || typeof str !== 'string') throw new Error('Réponse vide');
  str = str.trim();
  // Strip markdown fencing
  str = str.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  
  // Try direct parse first
  try { return JSON.parse(str); } catch(e) {}

  // Fix trailing commas
  let fixed = str.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}

  // Check if we're inside an unclosed string
  let inStr = false, lastChar = '';
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (c === '"' && lastChar !== '\\') inStr = !inStr;
    lastChar = c;
  }
  if (inStr) fixed += '"';

  // Count and close open brackets
  const stack = [];
  inStr = false; lastChar = '';
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (c === '"' && lastChar !== '\\') inStr = !inStr;
    if (!inStr) {
      if (c === '{') stack.push('}');
      else if (c === '[') stack.push(']');
      else if (c === '}' || c === ']') stack.pop();
    }
    lastChar = c;
  }

  // Remove trailing comma before closing
  fixed = fixed.replace(/,\s*$/, '');

  // Close remaining open brackets in reverse order
  while (stack.length > 0) fixed += stack.pop();

  // Final cleanup
  fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try { return JSON.parse(fixed); } catch(e) {}

  // Last resort: try to find the last valid closing brace
  for (let i = fixed.length - 1; i > 10; i--) {
    if (fixed[i] === '}') {
      try { return JSON.parse(fixed.substring(0, i + 1)); } catch(e) {}
    }
  }

  // Very last resort: extract JSON object from text
  const jsonMatch = str.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch(e) {}
    // Try repair on extracted JSON
    let extracted = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(extracted); } catch(e) {}
  }

  throw new Error('JSON invalide après réparation');
}

const MAX_TOKENS = 8192;

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 12000);
    const prompt = `Analyste expert en produits structurés FR. Extrais TOUTES les infos de cette brochure en JSON.

TEXTE:
${textToSend}

RÈGLES: "gain de X% par année" = coupon rate X. "remboursement automatique anticipé" = autocall. Cherche ISIN, émetteur, garant, dates, %, seuils.

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks).
Sois CONCIS dans les champs texte (max 100 caractères par champ texte).

{
  "name": "Nom complet du produit",
  "type": "autocall ou phoenix ou capital-protege ou autre",
  "emitter": "Émetteur",
  "guarantor": "Garant",
  "isin": "ISIN si trouvé",
  "underlyings": ["sous-jacent 1"],
  "underlyingType": "single-stock ou eurostoxx50 ou cac40 ou basket ou autre",
  "currency": "EUR",
  "maturity": "10 ans max",
  "maturityDate": "YYYY-MM-DD",
  "strikeDate": "YYYY-MM-DD",
  "coupon": {
    "rate": 5.7,
    "type": "conditionnel ou fixe ou memoire",
    "frequency": "annuel ou trimestriel ou semestriel",
    "trigger": 100,
    "memory": false
  },
  "capitalProtection": {
    "protected": true,
    "level": 100,
    "barrier": 60,
    "barrierType": "europeenne ou americaine"
  },
  "earlyRedemption": {
    "possible": true,
    "type": "autocall",
    "trigger": 100,
    "frequency": "annuel",
    "startYear": 1
  },
  "scenarios": {
    "favorable": "description courte avec %",
    "median": "description courte avec %",
    "defavorable": "description courte avec %"
  },
  "risks": ["risque 1", "risque 2"],
  "summary": "Résumé 2-3 phrases max"
}`;
    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      return repairJSON(response);
    } catch (e) {
      console.error('Erreur parsing IA:', e);
      throw new Error('Impossible de parser la brochure: ' + e.message);
    }
  }

  async generateSummary(productData) {
    const compact = { name: productData.name, type: productData.type, emitter: productData.emitter, underlyings: productData.underlyings, maturity: productData.maturity, coupon: productData.coupon, capitalProtection: productData.capitalProtection, earlyRedemption: productData.earlyRedemption, scenarios: productData.scenarios, risks: productData.risks };
    const prompt = `Résumé structuré de ce produit structuré. Données:\n${JSON.stringify(compact)}\n\nFormat avec ## sections:\n## 1. DESCRIPTION\n[2 phrases: type, émetteur, sous-jacent, durée]\n## 2. RENDEMENT & COUPONS\n[Taux, fréquence, seuil, gain max — CHIFFRES]\n## 3. PROTECTION DU CAPITAL\n[Niveau, condition, barrière — en vie vs échéance]\n## 4. REMBOURSEMENT ANTICIPÉ\n[Autocall, seuil, fréquence, à partir de quand]\n## 5. SCÉNARIOS\n**Favorable:** [chiffres]\n**Médian:** [chiffres]\n**Défavorable:** [chiffres]\n## 6. POINTS D'ATTENTION\n[3-5 risques clés]\n\nDirect, précis, avec chiffres.`;
    return await this._callAI(prompt, MAX_TOKENS);
  }

  async chat(messages, productContext, portfolioContext) {
    const systemPrompt = `Expert produits structurés. Produit:\n${JSON.stringify(productContext, null, 2)}\n\nPortefeuille:\n${JSON.stringify(portfolioContext, null, 2)}\n\nSois direct, cite les chiffres, challenge si nécessaire, mentionne les risques.`;
    try { return await this._callAIWithHistory(systemPrompt, messages); }
    catch (e) { console.error('Erreur chat IA:', e); throw e; }
  }

  async summarizeConversation(messages, decision) {
    const chatText = messages.map(m => `${m.role === 'user' ? 'MOI' : 'CLAUDE'}: ${m.content}`).join('\n');
    const prompt = `Résume cette discussion en 3-5 points clés.\n\n${chatText}\n\nDécision: ${decision || 'Non décidée'}\n\nFormat: points discutés, pour/contre, conclusion.`;
    return await this._callAI(prompt, MAX_TOKENS);
  }

  async _callAI(prompt, maxTokens) {
    const res = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens || MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`AI API ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content?.map(b => b.text || '').join('\n') || '';
  }

  async _callAIWithHistory(systemPrompt, messages) {
    const res = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: MAX_TOKENS, system: systemPrompt, messages }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`AI API ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content?.map(b => b.text || '').join('\n') || '';
  }
}

const pdfExtractor = new PDFExtractor();
const aiParser = new AIParser();

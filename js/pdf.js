// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing (V4 — max tokens)
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

// ─── JSON Repair for truncated responses ────────────────────
function repairJSON(str) {
  str = str.trim();
  str = str.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(str); } catch(e) {}
  let repaired = str;
  const quoteCount = (repaired.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) repaired += '"';
  const opens = { '{': 0, '[': 0 };
  let inString = false;
  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i];
    if (c === '"' && (i === 0 || repaired[i-1] !== '\\')) inString = !inString;
    if (!inString) {
      if (c === '{') opens['{']++;
      if (c === '}') opens['{']--;
      if (c === '[') opens['[']++;
      if (c === ']') opens['[']--;
    }
  }
  repaired = repaired.replace(/,\s*$/, '');
  for (let i = 0; i < opens['[']; i++) repaired += ']';
  for (let i = 0; i < opens['{']; i++) repaired += '}';
  try { return JSON.parse(repaired); } catch(e) {}
  for (let i = repaired.length - 1; i > 0; i--) {
    if (repaired[i] === '}') {
      try { return JSON.parse(repaired.substring(0, i + 1)); } catch(e) {}
    }
  }
  throw new Error('JSON irréparable');
}

// Max tokens for Sonnet 4 output
const MAX_TOKENS = 8192;

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 10000);
    const prompt = `Analyste expert en produits structurés FR. Extrais TOUTES les infos de cette brochure en JSON.

TEXTE:
${textToSend}

RÈGLES: "gain de X% par année" = coupon rate X. "remboursement automatique anticipé" = autocall. Cherche ISIN, émetteur, garant, dates, %, seuils.

JSON UNIQUEMENT (pas de markdown):
{"name":"Nom complet","type":"autocall/phoenix/capital-protege/autre","emitter":"Émetteur","guarantor":"Garant","distributor":"Distributeur","isin":"ISIN","underlyings":["sous-jacents"],"underlyingType":"single-stock/eurostoxx50/cac40/basket/autre","currency":"EUR","maturity":"durée","maturityDate":"YYYY-MM-DD","strikeDate":"YYYY-MM-DD","nominal":"1000 EUR","coupon":{"rate":5.7,"type":"conditionnel/fixe/memoire","frequency":"annuel","trigger":100,"triggerDetail":"description","memory":false,"maxReturn":"TRA max","totalReturn":"gain total max"},"capitalProtection":{"protected":true,"level":100,"type":"inconditionnelle-a-echeance/conditionnelle-barriere/aucune","barrier":null,"barrierType":"europeenne","barrierObservation":"description","inLifeRisk":"risque en cours de vie"},"earlyRedemption":{"possible":true,"type":"autocall","trigger":100,"triggerDetail":"description","frequency":"annuel","startYear":1,"stepDown":false},"scenarios":{"favorable":"détail avec %","median":"détail avec %","defavorable":"détail avec %"},"advantages":["avantages"],"risks":["risques"],"keyDates":["dates"],"ratings":"S&P/Moody/Fitch","eligibility":"éligibilité","summary":"résumé 3-4 phrases"}`;
    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      return repairJSON(response);
    } catch (e) {
      console.error('Erreur parsing IA:', e);
      throw new Error('Impossible de parser la brochure: ' + e.message);
    }
  }

  async generateSummary(productData) {
    const compact = { name: productData.name, type: productData.type, emitter: productData.emitter, underlyings: productData.underlyings, maturity: productData.maturity, coupon: productData.coupon, capitalProtection: productData.capitalProtection, earlyRedemption: productData.earlyRedemption, scenarios: productData.scenarios, risks: productData.risks, ratings: productData.ratings };
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens || MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`AI API ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content?.map(b => b.text || '').join('\n') || '';
  }

  async _callAIWithHistory(systemPrompt, messages) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: MAX_TOKENS, system: systemPrompt, messages }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`AI API ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content?.map(b => b.text || '').join('\n') || '';
  }
}

const pdfExtractor = new PDFExtractor();
const aiParser = new AIParser();

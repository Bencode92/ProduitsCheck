// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing V7
// V7: Enhanced extraction — structureType, participation,
//     historical simulations, guarantor rating, payment timing
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
            fullText += '\n--- PAGE ' + i + ' ---\n' + pageText;
          }
          resolve(fullText.trim());
        } catch (err) { reject(new Error('Erreur extraction PDF: ' + err.message)); }
      };
      reader.onerror = () => reject(new Error('Erreur lecture fichier'));
      reader.readAsArrayBuffer(file);
    });
  }
}

// ─── Robust JSON Repair V3 ──────
function repairJSON(str) {
  if (!str || typeof str !== 'string') throw new Error('Réponse vide');
  console.log('[repairJSON] Raw input length:', str.length);
  str = str.trim();
  str = str.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  try { return JSON.parse(str); } catch(e) {}

  const jsonMatches = [];
  let depth = 0, start = -1, inStr = false, prevChar = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"' && prevChar !== '\\') inStr = !inStr;
    if (!inStr) {
      if (c === '{') { if (depth === 0) start = i; depth++; }
      if (c === '}') { depth--; if (depth === 0 && start >= 0) { jsonMatches.push(str.substring(start, i + 1)); start = -1; } }
    }
    prevChar = c;
  }
  if (start >= 0 && depth > 0) {
    let partial = str.substring(start).replace(/,\s*$/, '');
    for (let i = 0; i < depth; i++) partial += '}';
    partial = partial.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    jsonMatches.push(partial);
  }

  const sorted = jsonMatches.sort((a, b) => b.length - a.length);
  for (const candidate of sorted) {
    let clean = candidate.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([\[{,])\s*,/g, '$1').replace(/\n/g, ' ');
    try { return JSON.parse(clean); } catch(e) {}
    const quoteCount = (clean.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      clean = clean.replace(/,\s*$/, '') + '"}';
      clean = clean.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      try { return JSON.parse(clean); } catch(e) {}
    }
    for (let i = clean.length - 1; i > Math.max(10, clean.length - 200); i--) {
      if (clean[i] === '}') { try { return JSON.parse(clean.substring(0, i + 1)); } catch(e) {} }
    }
  }

  let fixed = str.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  const firstBrace = fixed.indexOf('{');
  if (firstBrace >= 0) {
    fixed = fixed.substring(firstBrace);
    const stack = []; inStr = false; prevChar = '';
    for (let i = 0; i < fixed.length; i++) {
      const c = fixed[i];
      if (c === '"' && prevChar !== '\\') inStr = !inStr;
      if (!inStr) { if (c === '{') stack.push('}'); else if (c === '[') stack.push(']'); else if ((c === '}' || c === ']') && stack.length > 0) stack.pop(); }
      prevChar = c;
    }
    fixed = fixed.replace(/,\s*$/, '');
    while (stack.length > 0) fixed += stack.pop();
    fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(fixed); } catch(e) {}
  }

  throw new Error('JSON invalide. Réponse: «' + str.substring(0, 150).replace(/\n/g, ' ') + '…»');
}

const MAX_TOKENS = 8192;

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 14000);
    const prompt = `Tu es un parseur JSON expert en produits structurés. Extrais les données de cette brochure.

TEXTE BROCHURE:
${textToSend}

RÈGLES D'EXTRACTION CRITIQUES:
1. "gain de X% par année" ou "coupon de X%" = coupon rate X
2. "remboursement anticipé" = autocall
3. "performance relative" ou "paire d'actions" ou "dispersion" = structureType "dispersion"
4. "participation de X%" = participationRate X (PAS un coupon — c'est un multiplicateur de la performance)
5. "taux fixe" ou "callable" = structureType "taux_fixe"
6. "capital garanti" ou "protection 100%" sans barrière SJ = structureType "capital_garanti"
7. Si le produit calcule des DIFFERENCES de performance entre actions = structureType "dispersion"
8. Si le coupon est "à maturité" (pas périodique) = paymentTiming "maturity"
9. Extraire les simulations historiques si présentes (min, max, median, mean)
10. Extraire le rating de l'émetteur/garant (Moody's, S&P, Fitch)

Réponds UNIQUEMENT avec un objet JSON. Aucun texte avant ou après. Pas de backticks.

{"name":"Nom produit","type":"phoenix ou autocall ou dispersion ou capital-protege ou taux-fixe ou reverse ou participation","structureType":"autocall ou phoenix_memoire ou dispersion ou taux_fixe ou capital_garanti ou reverse ou twin_win ou participation","emitter":"Émetteur","guarantor":"Garant","guarantorRating":{"moodys":"A1","sp":"A","fitch":null},"isin":"ISIN","underlyings":["sous-jacent1","sous-jacent2"],"underlyingType":"single-stock ou basket ou pairs","nUnderlyings":8,"nPairs":16,"currency":"EUR","maturity":"3 ans","maturityYears":3,"maturityDate":"YYYY-MM-DD","strikeDate":"YYYY-MM-DD","coupon":{"rate":5.7,"type":"conditionnel ou fixe ou garanti ou participation","frequency":"semestriel ou annuel ou trimestriel ou maturity","trigger":60,"memory":true,"paymentTiming":"periodic ou maturity"},"participationRate":7.0,"capitalProtection":{"protected":true,"level":100,"barrier":60,"barrierType":"europeenne ou americaine","couponFloor":true},"earlyRedemption":{"possible":true,"type":"autocall","trigger":100,"frequency":"semestriel","startYear":1},"historicalSimulations":{"nSimulations":3120,"min":2.83,"max":39.27,"median":11.47,"mean":13.10},"scenarios":{"favorable":"max 50 car","median":"max 50 car","defavorable":"max 50 car"},"risks":["risque1","risque2"],"mechanism":"Description courte du mécanisme en 80 car max","summary":"max 100 car"}`;

    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      console.log('[parseBrochure] AI response length:', response.length);
      const parsed = repairJSON(response);

      // Post-process: set structureType if detected by type
      if (!parsed.structureType && parsed.type) {
        if (parsed.type === 'dispersion') parsed.structureType = 'dispersion';
        else if (parsed.type === 'taux-fixe') parsed.structureType = 'taux_fixe';
        else if (parsed.type === 'capital-protege' && parsed.capitalProtection?.level === 100) parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'reverse') parsed.structureType = 'reverse';
        else if (parsed.type === 'participation') parsed.structureType = 'participation';
      }

      // Post-process: detect dispersion from keywords if AI missed it
      if (!parsed.structureType) {
        var allText = JSON.stringify(parsed).toLowerCase();
        if (allText.indexOf('performance relative') >= 0 || allText.indexOf('paire') >= 0 || allText.indexOf('dispersion') >= 0 || allText.indexOf('diff\u00e9rence de performance') >= 0) {
          parsed.structureType = 'dispersion';
          console.log('[parseBrochure] Auto-detected structureType: dispersion');
        }
      }

      // Post-process: if participationRate detected, adjust coupon type
      if (parsed.participationRate && parsed.structureType === 'dispersion') {
        if (!parsed.coupon) parsed.coupon = {};
        parsed.coupon.type = 'participation';
        parsed.coupon.rate = parsed.participationRate;
        parsed.coupon.paymentTiming = 'maturity';
      }

      console.log('[parseBrochure] Extracted structureType:', parsed.structureType, 'type:', parsed.type);
      return parsed;
    } catch (e) {
      console.error('[parseBrochure] Error:', e);
      throw new Error('Impossible de parser la brochure: ' + e.message);
    }
  }

  async generateSummary(productData) {
    const compact = { name: productData.name, type: productData.type, structureType: productData.structureType, emitter: productData.emitter, underlyings: productData.underlyings, maturity: productData.maturity, coupon: productData.coupon, participationRate: productData.participationRate, capitalProtection: productData.capitalProtection, earlyRedemption: productData.earlyRedemption, scenarios: productData.scenarios, historicalSimulations: productData.historicalSimulations, risks: productData.risks, mechanism: productData.mechanism };
    const prompt = 'Résumé structuré de ce produit structuré. Données:\n' + JSON.stringify(compact) + '\n\nFormat avec ## sections: DESCRIPTION, MÉCANISME, RENDEMENT, PROTECTION, REMBOURSEMENT ANTICIPÉ, SCÉNARIOS, POINTS ATTENTION. Direct, précis, chiffres.';
    return await this._callAI(prompt, MAX_TOKENS);
  }

  async chat(messages, productContext, portfolioContext) {
    const systemPrompt = 'Expert produits structurés. Produit:\n' + JSON.stringify(productContext, null, 2) + '\n\nPortefeuille:\n' + JSON.stringify(portfolioContext, null, 2) + '\n\nSois direct, cite les chiffres, challenge si nécessaire.';
    try { return await this._callAIWithHistory(systemPrompt, messages); }
    catch (e) { console.error('Erreur chat IA:', e); throw e; }
  }

  async summarizeConversation(messages, decision) {
    const chatText = messages.map(m => (m.role === 'user' ? 'MOI' : 'CLAUDE') + ': ' + m.content).join('\n');
    return await this._callAI('Résume en 3-5 points clés:\n' + chatText + '\nDécision: ' + (decision || 'Non décidée'), MAX_TOKENS);
  }

  async _callAI(prompt, maxTokens) {
    const res = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens || MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error('AI API ' + res.status + ': ' + err.substring(0, 200)); }
    const data = await res.json();
    const text = data.content?.map(b => b.text || '').join('\n') || '';
    if (!text) throw new Error('Réponse IA vide (stop_reason: ' + data.stop_reason + ')');
    return text;
  }

  async _callAIWithHistory(systemPrompt, messages) {
    const res = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: MAX_TOKENS, system: systemPrompt, messages }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error('AI API ' + res.status + ': ' + err.substring(0, 200)); }
    const data = await res.json();
    return data.content?.map(b => b.text || '').join('\n') || '';
  }
}

const pdfExtractor = new PDFExtractor();
const aiParser = new AIParser();

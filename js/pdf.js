// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing (V6 — debug + aggressive JSON extraction)
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

// ─── Robust JSON Repair V3 — aggressive extraction + debug ──────
function repairJSON(str) {
  if (!str || typeof str !== 'string') throw new Error('Réponse vide');
  
  // Log raw response for debugging
  console.log('[repairJSON] Raw input length:', str.length);
  console.log('[repairJSON] First 300 chars:', str.substring(0, 300));
  
  str = str.trim();
  
  // Strip ALL markdown fencing (anywhere in text, not just start/end)
  str = str.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  
  // Method 1: Direct parse
  try { return JSON.parse(str); } catch(e) {
    console.log('[repairJSON] Direct parse failed:', e.message);
  }

  // Method 2: Extract JSON object from text (greedy — finds largest {...})
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
  // If we have unclosed braces, try to close them
  if (start >= 0 && depth > 0) {
    let partial = str.substring(start);
    // Remove trailing comma
    partial = partial.replace(/,\s*$/, '');
    // Close open brackets
    for (let i = 0; i < depth; i++) partial += '}';
    partial = partial.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    jsonMatches.push(partial);
  }
  
  console.log('[repairJSON] Found', jsonMatches.length, 'JSON candidates');
  
  // Try each candidate (largest first)
  const sorted = jsonMatches.sort((a, b) => b.length - a.length);
  for (const candidate of sorted) {
    // Clean up common issues
    let clean = candidate
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/([\[{,])\s*,/g, '$1')  // double commas
      .replace(/\n/g, ' ');
    
    try { return JSON.parse(clean); } catch(e) {
      console.log('[repairJSON] Candidate failed:', e.message, 'len:', clean.length);
    }
    
    // Try fixing unclosed strings in this candidate
    const quoteCount = (clean.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      clean = clean.replace(/,\s*$/, '') + '"}';
      clean = clean.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      try { return JSON.parse(clean); } catch(e) {}
    }
    
    // Try truncating from the end to find valid JSON
    for (let i = clean.length - 1; i > Math.max(10, clean.length - 200); i--) {
      if (clean[i] === '}') {
        try { return JSON.parse(clean.substring(0, i + 1)); } catch(e) {}
      }
    }
  }
  
  // Method 3: Stack-based repair on full string
  let fixed = str.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  // Find first { and work from there
  const firstBrace = fixed.indexOf('{');
  if (firstBrace >= 0) {
    fixed = fixed.substring(firstBrace);
    // Close unclosed brackets
    const stack = [];
    inStr = false; prevChar = '';
    for (let i = 0; i < fixed.length; i++) {
      const c = fixed[i];
      if (c === '"' && prevChar !== '\\') inStr = !inStr;
      if (!inStr) {
        if (c === '{') stack.push('}');
        else if (c === '[') stack.push(']');
        else if ((c === '}' || c === ']') && stack.length > 0) stack.pop();
      }
      prevChar = c;
    }
    fixed = fixed.replace(/,\s*$/, '');
    while (stack.length > 0) fixed += stack.pop();
    fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(fixed); } catch(e) {
      console.log('[repairJSON] Stack repair failed:', e.message);
    }
  }

  // Show what we got for debugging
  const preview = str.substring(0, 500).replace(/\n/g, '↵');
  console.error('[repairJSON] ALL methods failed. Preview:', preview);
  throw new Error('JSON invalide. Réponse reçue: «' + str.substring(0, 150).replace(/\n/g, ' ') + '…»');
}

const MAX_TOKENS = 8192;

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 12000);
    const prompt = `Tu es un parseur JSON. Extrais les données de cette brochure de produit structuré.

TEXTE BROCHURE:
${textToSend}

RÈGLES: "gain de X% par année" = coupon rate X. "remboursement anticipé" = autocall.

Réponds UNIQUEMENT avec un objet JSON. Aucun texte avant ou après. Pas de backticks.

{"name":"Nom produit","type":"phoenix ou autocall ou capital-protege","emitter":"Émetteur","guarantor":"Garant","isin":"ISIN","underlyings":["sous-jacent"],"underlyingType":"single-stock ou basket","currency":"EUR","maturity":"durée","maturityDate":"YYYY-MM-DD","strikeDate":"YYYY-MM-DD","coupon":{"rate":5.7,"type":"conditionnel","frequency":"semestriel","trigger":60,"memory":true},"capitalProtection":{"protected":true,"level":100,"barrier":60,"barrierType":"europeenne"},"earlyRedemption":{"possible":true,"type":"autocall","trigger":100,"frequency":"semestriel","startYear":1},"scenarios":{"favorable":"max 50 car","median":"max 50 car","defavorable":"max 50 car"},"risks":["risque1","risque2"],"summary":"max 100 car"}`;
    
    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      console.log('[parseBrochure] AI response length:', response.length);
      return repairJSON(response);
    } catch (e) {
      console.error('[parseBrochure] Error:', e);
      throw new Error('Impossible de parser la brochure: ' + e.message);
    }
  }

  async generateSummary(productData) {
    const compact = { name: productData.name, type: productData.type, emitter: productData.emitter, underlyings: productData.underlyings, maturity: productData.maturity, coupon: productData.coupon, capitalProtection: productData.capitalProtection, earlyRedemption: productData.earlyRedemption, scenarios: productData.scenarios, risks: productData.risks };
    const prompt = 'Résumé structuré de ce produit structuré. Données:\n' + JSON.stringify(compact) + '\n\nFormat avec ## sections: DESCRIPTION, RENDEMENT, PROTECTION, REMBOURSEMENT ANTICIPÉ, SCÉNARIOS, POINTS ATTENTION. Direct, précis, chiffres.';
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
    console.log('[_callAI] Response status:', res.status, 'stop_reason:', data.stop_reason, 'text length:', text.length);
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

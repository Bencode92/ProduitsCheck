// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing V7.1
// V7.1: Added décrément extraction + stepDown detection
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

function repairJSON(str) {
  if (!str || typeof str !== 'string') throw new Error('R\u00e9ponse vide');
  str = str.trim().replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
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
    try { return JSON.parse(fixed); } catch(e) {}
  }
  throw new Error('JSON invalide.');
}

const MAX_TOKENS = 8192;

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 14000);
    const prompt = `Tu es un parseur JSON expert en produits structur\u00e9s. Extrais les donn\u00e9es de cette brochure.

TEXTE BROCHURE:
${textToSend}

R\u00c8GLES D'EXTRACTION CRITIQUES:
1. "gain de X% par ann\u00e9e" ou "coupon de X%" = coupon rate X
2. "remboursement anticip\u00e9" = autocall
3. "performance relative" ou "paire d'actions" ou "dispersion" = structureType "dispersion"
4. "participation de X%" = participationRate X (PAS un coupon)
5. "taux fixe" ou "callable" = structureType "taux_fixe"
6. "capital garanti" ou "protection 100%" sans barri\u00e8re SJ = structureType "capital_garanti"
7. Si le produit calcule des DIFFERENCES de performance entre actions = structureType "dispersion"
8. Si le coupon est "\u00e0 maturit\u00e9" (pas p\u00e9riodique) = paymentTiming "maturity"
9. Extraire les simulations historiques si pr\u00e9sentes (min, max, median, mean)
10. Extraire le rating de l'\u00e9metteur/garant (Moody's, S&P, Fitch)
11. D\u00c9CR\u00c9MENT: si l'indice a un "pr\u00e9l\u00e8vement forfaitaire" ou "d\u00e9cr\u00e9ment" de X% par an, extraire decrementPct=X et actualDividendYield si mentionn\u00e9
12. STEP-DOWN: si la barri\u00e8re de rappel est "d\u00e9gressive" ou "step-down", extraire stepDown=true et stepDownPct (% de baisse par p\u00e9riode)
13. COUPON ATTENTION: si la brochure donne \u00e0 la fois un taux par p\u00e9riode ET un taux annualis\u00e9 (ex: "4.50% par semestre (9.00% p.a.)"), mettre coupon.rate = taux PAR P\u00c9RIODE (4.50), PAS le taux annualis\u00e9

R\u00e9ponds UNIQUEMENT avec un objet JSON. Aucun texte avant ou apr\u00e8s. Pas de backticks.

{"name":"Nom","type":"autocall ou dispersion ou taux-fixe...","structureType":"autocall ou dispersion ou taux_fixe...","emitter":"\u00c9metteur","guarantor":"Garant","guarantorRating":{"moodys":"A1","sp":"A"},"isin":"ISIN","underlyings":["sous-jacent"],"underlyingType":"single-index ou basket ou pairs","nUnderlyings":1,"nPairs":null,"currency":"EUR","maturity":"5 ans","maturityYears":5,"coupon":{"rate":4.5,"type":"conditionnel","frequency":"semestriel","trigger":60,"memory":false,"paymentTiming":"periodic"},"participationRate":null,"capitalProtection":{"protected":false,"level":null,"barrier":50,"barrierType":"europeenne","couponFloor":false},"earlyRedemption":{"possible":true,"type":"autocall","trigger":95,"frequency":"semestriel","startYear":2,"stepDown":true,"stepDownPct":2.5},"decrementPct":5.0,"actualDividendYield":0.97,"historicalSimulations":null,"scenarios":{"favorable":"...","median":"...","defavorable":"..."},"risks":["risque1"],"mechanism":"Description courte","summary":"max 100 car"}`;

    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      const parsed = repairJSON(response);

      // Post-process structureType
      if (!parsed.structureType && parsed.type) {
        if (parsed.type === 'dispersion') parsed.structureType = 'dispersion';
        else if (parsed.type === 'taux-fixe') parsed.structureType = 'taux_fixe';
        else if (parsed.type === 'capital-protege' && parsed.capitalProtection?.level === 100) parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'reverse') parsed.structureType = 'reverse';
        else if (parsed.type === 'participation') parsed.structureType = 'participation';
      }

      // Auto-detect dispersion from keywords
      if (!parsed.structureType) {
        var allText = JSON.stringify(parsed).toLowerCase();
        if (allText.indexOf('performance relative') >= 0 || allText.indexOf('paire') >= 0 || allText.indexOf('dispersion') >= 0) {
          parsed.structureType = 'dispersion';
        }
      }

      // Participation adjustment
      if (parsed.participationRate && parsed.structureType === 'dispersion') {
        if (!parsed.coupon) parsed.coupon = {};
        parsed.coupon.type = 'participation';
        parsed.coupon.rate = parsed.participationRate;
        parsed.coupon.paymentTiming = 'maturity';
      }

      // Post-process d\u00e9cr\u00e9ment from rawText if parser missed it
      if (!parsed.decrementPct) {
        var decMatch = rawText.match(/(?:pr\u00e9l\u00e8vement forfaitaire|d\u00e9cr\u00e9ment|decrement|AR)\s*(?:de\s*)?(?:fixe\s*(?:annuel\s*)?(?:de\s*)?)?([\d][\d.,]*)\s*%/i);
        if (decMatch) {
          parsed.decrementPct = parseFloat(decMatch[1].replace(',', '.'));
          console.log('[parseBrochure] Post-process d\u00e9cr\u00e9ment detected: ' + parsed.decrementPct + '%');
        }
      }
      // Detect actual dividend from rawText
      if (parsed.decrementPct && !parsed.actualDividendYield) {
        var divMatch = rawText.match(/dividendes?\s*(?:nets?\s*)?(?:distribu)?.*?(\d+[.,]\d+)\s*%/i);
        if (divMatch) {
          parsed.actualDividendYield = parseFloat(divMatch[1].replace(',', '.'));
        }
      }

      // Post-process step-down from rawText
      if (parsed.earlyRedemption && !parsed.earlyRedemption.stepDown) {
        if (rawText.indexOf('d\u00e9gressive') >= 0 || rawText.indexOf('step-down') >= 0 || rawText.indexOf('step down') >= 0) {
          parsed.earlyRedemption.stepDown = true;
          var sdMatch = rawText.match(/d\u00e9gressive\s*(?:de\s*)?[-\u2013]?\s*(\d+[.,]?\d*)\s*%/i);
          if (sdMatch) parsed.earlyRedemption.stepDownPct = parseFloat(sdMatch[1].replace(',', '.'));
        }
      }

      console.log('[parseBrochure] structureType:', parsed.structureType,
        'decrement:', parsed.decrementPct || 'none',
        'stepDown:', parsed.earlyRedemption?.stepDown || false);
      return parsed;
    } catch (e) {
      console.error('[parseBrochure] Error:', e);
      throw new Error('Impossible de parser la brochure: ' + e.message);
    }
  }

  async generateSummary(productData) {
    const compact = { name: productData.name, type: productData.type, structureType: productData.structureType, emitter: productData.emitter, underlyings: productData.underlyings, maturity: productData.maturity, coupon: productData.coupon, participationRate: productData.participationRate, capitalProtection: productData.capitalProtection, earlyRedemption: productData.earlyRedemption, scenarios: productData.scenarios, historicalSimulations: productData.historicalSimulations, risks: productData.risks, mechanism: productData.mechanism, decrementPct: productData.decrementPct, actualDividendYield: productData.actualDividendYield };
    const prompt = 'R\u00e9sum\u00e9 structur\u00e9 de ce produit structur\u00e9. Donn\u00e9es:\n' + JSON.stringify(compact) + '\n\nFormat avec ## sections: DESCRIPTION, M\u00c9CANISME, RENDEMENT, PROTECTION, REMBOURSEMENT ANTICIP\u00c9, SC\u00c9NARIOS, POINTS ATTENTION. Direct, pr\u00e9cis, chiffres.';
    return await this._callAI(prompt, MAX_TOKENS);
  }

  async chat(messages, productContext, portfolioContext) {
    const systemPrompt = 'Expert produits structur\u00e9s. Produit:\n' + JSON.stringify(productContext, null, 2) + '\n\nPortefeuille:\n' + JSON.stringify(portfolioContext, null, 2) + '\n\nSois direct, cite les chiffres, challenge si n\u00e9cessaire.';
    try { return await this._callAIWithHistory(systemPrompt, messages); }
    catch (e) { console.error('Erreur chat IA:', e); throw e; }
  }

  async summarizeConversation(messages, decision) {
    const chatText = messages.map(m => (m.role === 'user' ? 'MOI' : 'CLAUDE') + ': ' + m.content).join('\n');
    return await this._callAI('R\u00e9sume en 3-5 points cl\u00e9s:\n' + chatText + '\nD\u00e9cision: ' + (decision || 'Non d\u00e9cid\u00e9e'), MAX_TOKENS);
  }

  async _callAI(prompt, maxTokens) {
    const res = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens || MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error('AI API ' + res.status + ': ' + err.substring(0, 200)); }
    const data = await res.json();
    const text = data.content?.map(b => b.text || '').join('\n') || '';
    if (!text) throw new Error('R\u00e9ponse IA vide (stop_reason: ' + data.stop_reason + ')');
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

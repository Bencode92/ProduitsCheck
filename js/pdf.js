// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing V7.6
// V7.6: Robust barrier inversion fix — multi-pattern matching
// V7.5: Use CONFIG.AI_MODEL (Opus) instead of hardcoded Sonnet
// V7.4: Fix barrier inversion — "baisse de plus de X%" = barrier at (100-X)%
// V7.3: Fix digitale/capital garanti detection
// V7.2: 5 critical missing fields (double coupon, double barrier, décrément, etc.)
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
  if (!str || typeof str !== 'string') throw new Error('Réponse vide');
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
    jsonMatches.push(partial);
  }
  const sorted = jsonMatches.sort((a, b) => b.length - a.length);
  for (const candidate of sorted) {
    let clean = candidate.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([[{,])\s*,/g, '$1').replace(/\n/g, ' ');
    try { return JSON.parse(clean); } catch(e) {}
    const quoteCount = (clean.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) { clean = clean.replace(/,\s*$/, '') + '"}'.replace(/,\s*}/g, '}'); try { return JSON.parse(clean); } catch(e) {} }
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
      const c = fixed[i]; if (c === '"' && prevChar !== '\\') inStr = !inStr;
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

function _getAIModel() {
  return (typeof CONFIG !== 'undefined' && CONFIG.AI_MODEL) ? CONFIG.AI_MODEL : 'claude-opus-4-20250514';
}

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 14000);
    const prompt = `Tu es un parseur JSON expert en produits structurés. Extrais les données de cette brochure.\n\nTEXTE BROCHURE:\n${textToSend}\n\nRÈGLES D'EXTRACTION CRITIQUES:\n1. "gain de X% par année" ou "coupon de X%" = coupon rate X\n2. "remboursement anticipé AUTOMATIQUE" = autocall. ATTENTION: "Date de Constatation Annuelle" seule N'EST PAS un autocall si elle concerne uniquement le COUPON.\n3. "performance relative" ou "paire d'actions" ou "dispersion" = structureType "dispersion"\n4. "participation de X%" = participationRate X (PAS un coupon)\n5. "taux fixe" ou "callable" = structureType "taux_fixe"\n6. "capital garanti" ou "protection 100%" = structureType "capital_garanti" (même s'il y a une barrière COUPON)\n7. Si DIFFERENCES de performance entre actions = structureType "dispersion"\n8. Si paiement "à maturité" = paymentTiming "maturity"\n9. Extraire simulations historiques (min, max, median, mean)\n10. Extraire rating émetteur/garant (Moody's, S&P)\n11. DÉCRÉMENT: "prélèvement forfaitaire X%" ou "décrément X%" → decrementPct=X. Si dividendes réels mentionnés → actualDividendYield\n12. STEP-DOWN: barrière "dégressive" → stepDown=true, stepDownPct=baisse par période\n13. COUPON PAR PÉRIODE: si "X% par semestre (Y% p.a.)" → coupon.rate = X (par période), PAS Y\n14. DOUBLE COUPON: si rappelé = Z%/an et maturité = W%/an (Z≠W), extraire coupon.rateIfCalled=Z et coupon.rateIfMaturity=W\n15. DOUBLE BARRIÈRE: si barrière coupon ≠ barrière capital, extraire capitalProtection.barrierCoupon ET capitalProtection.barrier (capital)\n16. OBSERVATION START: si observations commencent au semestre X ou année Y (pas S1/Y1), extraire earlyRedemption.startSemester ou startYear\n17. DIGITALE / CAPITAL GARANTI: Si "garantie en capital à l'échéance" ou "remboursement de l'intégralité du capital investi, peu importe l'évolution du marché" ET il n'y a PAS de "remboursement anticipé automatique" → structureType="capital_garanti", earlyRedemption.possible=false.\n18. BARRIÈRE COUPON vs CAPITAL: Si le seuil (ex: 100%) déclenche le COUPON mais que le capital est garanti quoi qu'il arrive → c'est une barrierCoupon, PAS une barrier capital.\n19. ⚠️ BARRIÈRE CAPITAL — CONVERSION OBLIGATOIRE: Quand la brochure dit "perte en capital si baisse de plus de X%" ou "baisse n'excède pas X%", la barrière capital = 100 - X. Exemples: "baisse de plus de 40%" → barrier=60. "baisse n'excède pas 20%" → seuil coupon à 80%. NE JAMAIS mettre le pourcentage de baisse directement comme barrière.\n\nRéponds UNIQUEMENT avec un objet JSON. Aucun texte avant ou après.\n\n{"name":"Nom","type":"autocall ou digitale ou dispersion ou taux-fixe...","structureType":"autocall ou dispersion ou taux_fixe ou capital_garanti...","emitter":"Émetteur","guarantor":"Garant","guarantorRating":{"moodys":"A1","sp":"A"},"isin":"ISIN","underlyings":["sous-jacent"],"underlyingType":"single-index ou basket ou pairs","nUnderlyings":1,"nPairs":null,"currency":"EUR","maturity":"5 ans","maturityYears":5,"coupon":{"rate":4.5,"rateIfCalled":5.0,"rateIfMaturity":4.0,"type":"conditionnel","frequency":"semestriel","trigger":60,"memory":false,"paymentTiming":"periodic"},"participationRate":null,"capitalProtection":{"protected":false,"level":null,"barrier":50,"barrierCoupon":60,"barrierType":"europeenne","couponFloor":false},"earlyRedemption":{"possible":true,"type":"autocall","trigger":95,"frequency":"semestriel","startSemester":4,"startYear":2,"stepDown":true,"stepDownPct":2.5},"decrementPct":5.0,"actualDividendYield":0.97,"historicalSimulations":null,"scenarios":{"favorable":"...","median":"...","defavorable":"..."},"risks":["risque1"],"mechanism":"Description courte","summary":"max 100 car"}`;

    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      const parsed = repairJSON(response);

      if (!parsed.structureType && parsed.type) {
        if (parsed.type === 'dispersion') parsed.structureType = 'dispersion';
        else if (parsed.type === 'taux-fixe') parsed.structureType = 'taux_fixe';
        else if (parsed.type === 'digitale') parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'capital-protege' || parsed.type === 'capital-garanti') parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'reverse') parsed.structureType = 'reverse';
      }

      if (!parsed.structureType) {
        var allText = JSON.stringify(parsed).toLowerCase();
        if (allText.indexOf('performance relative') >= 0 || allText.indexOf('paire') >= 0 || allText.indexOf('dispersion') >= 0) {
          parsed.structureType = 'dispersion';
        }
      }

      var isCapitalGaranti100 = false;
      if (parsed.capitalProtection) {
        if (parsed.capitalProtection.level === 100 || parsed.capitalProtection.level === '100' || parsed.capitalProtection.level === '100%') isCapitalGaranti100 = true;
        if (parsed.capitalProtection.protected === true || parsed.capitalProtection.protected === 'true') {
          var txt = rawText.toLowerCase();
          if (txt.indexOf('intégralité du capital') >= 0 || txt.indexOf('garantie en capital') >= 0 || txt.indexOf('capital garanti') >= 0 || txt.indexOf('capital est garanti à 100') >= 0) {
            isCapitalGaranti100 = true;
            if (!parsed.capitalProtection.level) parsed.capitalProtection.level = 100;
          }
        }
      }

      if (isCapitalGaranti100) {
        var txt = rawText.toLowerCase();
        var hasRealAutocall = /remboursement\s*(?:automatique\s*)?anticip[ée]/i.test(rawText) || /rappel\s*(?:automatique\s*)?anticip[ée]/i.test(rawText) || /remboursement\s*anticip[ée]\s*automatique/i.test(rawText);
        var hasUnconditionalCapital = txt.indexOf('peu importe') >= 0 && txt.indexOf('capital') >= 0;
        if (!hasRealAutocall || hasUnconditionalCapital) {
          if (parsed.earlyRedemption) { parsed.earlyRedemption.possible = false; parsed.earlyRedemption.type = 'none'; }
          else { parsed.earlyRedemption = { possible: false, type: 'none' }; }
          if (!parsed.structureType || parsed.structureType === 'autocall') parsed.structureType = 'capital_garanti';
          if (parsed.type === 'autocall') parsed.type = 'digitale';
          console.log('[parseBrochure V7.3] Capital garanti 100% detected — autocall overridden to false');
        }
        if (parsed.capitalProtection && parsed.capitalProtection.barrier && !parsed.capitalProtection.barrierCoupon) {
          parsed.capitalProtection.barrierCoupon = parsed.capitalProtection.barrier;
          parsed.capitalProtection.barrier = null;
          console.log('[parseBrochure V7.3] Barrier reclassified as barrierCoupon=' + parsed.capitalProtection.barrierCoupon + '%');
        }
      }

      // V7.6: Robust barrier inversion
      if (parsed.capitalProtection && parsed.capitalProtection.barrier) {
        var b = parseFloat(parsed.capitalProtection.barrier);
        if (b > 0 && b < 100) {
          var baissePatterns = [/baisse\s*(?:de\s*)?(?:plus\s*de\s*)(\d+[.,]?\d*)\s*%/gi, /perte[^.]{0,80}(\d+[.,]?\d*)\s*%/gi, /capital[^.]{0,40}(\d+[.,]?\d*)\s*%/gi];
          var baisseValues = [];
          baissePatterns.forEach(function(re) { var m; while ((m = re.exec(rawText)) !== null) { var v = parseFloat(m[1].replace(',', '.')); if (v > 0 && v <= 60) baisseValues.push(v); } });
          baisseValues = baisseValues.filter(function(v, i, a) { return a.indexOf(v) === i; });
          var invertMatch = baisseValues.find(function(v) { return Math.abs(b - v) < 1; });
          if (invertMatch) { var corrected = 100 - invertMatch; console.log('[parseBrochure V7.6] Barrier inversion: ' + b + '% → ' + corrected + '%'); parsed.capitalProtection.barrier = corrected; }
          if (!invertMatch && b <= 40) { var maxBaisse = baisseValues.length > 0 ? Math.max.apply(null, baisseValues) : 0; if (maxBaisse > 0 && maxBaisse < 60) { console.log('[parseBrochure V7.6] Barrier ' + b + '% suspiciously low → correcting to ' + (100 - maxBaisse) + '%'); parsed.capitalProtection.barrier = 100 - maxBaisse; } }
          parsed._barrierChecked = true;
        }
      }

      // V7.6: "n'excède pas X%" — take smallest
      if (parsed.capitalProtection && !isCapitalGaranti100) {
        var excedeRe = /baisse\s*(?:n['''`]?\s*)?exc[èe]de\s*pas\s*(\d+[.,]?\d*)\s*%/gi;
        var excedeAll = [], excedeM;
        while ((excedeM = excedeRe.exec(rawText)) !== null) { excedeAll.push(parseFloat(excedeM[1].replace(',', '.'))); }
        if (excedeAll.length > 0) {
          var smallestExcede = Math.min.apply(null, excedeAll);
          var couponTrigger = 100 - smallestExcede;
          if (!parsed.capitalProtection.barrierCoupon || parsed.capitalProtection.barrierCoupon === parsed.capitalProtection.barrier) {
            parsed.capitalProtection.barrierCoupon = couponTrigger;
            console.log('[parseBrochure V7.6] Coupon trigger from n-excede-pas ' + smallestExcede + '% → barrierCoupon=' + couponTrigger + '%');
          }
        }
      }

      if (parsed.participationRate && parsed.structureType === 'dispersion') { if (!parsed.coupon) parsed.coupon = {}; parsed.coupon.type = 'participation'; parsed.coupon.rate = parsed.participationRate; parsed.coupon.paymentTiming = 'maturity'; }

      // V7.5: coupon primitive → object
      if (parsed.coupon && typeof parsed.coupon !== 'object') { var primitiveRate = typeof parsed.coupon === 'number' ? parsed.coupon : parseFloat(parsed.coupon); parsed.coupon = { rate: primitiveRate || 0 }; console.log('[parseBrochure V7.5] Coupon was primitive → converted to object'); }

      if (!parsed.decrementPct) { var decMatch = rawText.match(/(?:prélèvement forfaitaire|décrément|decrement)\s*(?:de\s*)?(?:fixe\s*(?:annuel\s*)?(?:de\s*)?)?\s*(\d[\d.,]*)\s*%/i); if (!decMatch) { var arMatch2 = rawText.match(/AR\s*(\d+[.,]?\d*)\s*%/i); if (arMatch2) decMatch = arMatch2; } if (decMatch) { parsed.decrementPct = parseFloat((decMatch[1] || '').replace(',', '.')); console.log('[parseBrochure] Post-process décrément: ' + parsed.decrementPct + '%'); } }
      if (parsed.decrementPct && !parsed.actualDividendYield) { var divMatch = rawText.match(/dividendes?\s*(?:nets?\s*)?(?:distribu)?[^.]{0,80}?(\d+[.,]\d+)\s*%/i); if (divMatch) parsed.actualDividendYield = parseFloat(divMatch[1].replace(',', '.')); }
      if (parsed.earlyRedemption && !parsed.earlyRedemption.stepDown) { if (rawText.indexOf('dégressive') >= 0 || rawText.indexOf('step-down') >= 0 || rawText.indexOf('step down') >= 0) { parsed.earlyRedemption.stepDown = true; var sdMatch = rawText.match(/dégressive\s*(?:de\s*)?[-–]?\s*(\d+[.,]?\d*)\s*%/i); if (sdMatch) parsed.earlyRedemption.stepDownPct = parseFloat(sdMatch[1].replace(',', '.')); } }
      if (parsed.capitalProtection && !parsed.capitalProtection.barrierCoupon) { var bcMatch = rawText.match(/barrière\s*(?:de\s*)?coupon[^.]{0,30}?(\d+[.,]?\d*)\s*%/i); if (bcMatch) parsed.capitalProtection.barrierCoupon = parseFloat(bcMatch[1].replace(',', '.')); }
      if (parsed.earlyRedemption && !parsed.earlyRedemption.startSemester) { var startMatch = rawText.match(/(?:à l'issue|à partir)\s*(?:des?\s*)?(?:semestres?\s*)(\d+)/i); if (startMatch) parsed.earlyRedemption.startSemester = parseInt(startMatch[1]); }

      delete parsed._barrierChecked;
      console.log('[parseBrochure V7.6] type:', parsed.structureType, '| autocall:', parsed.earlyRedemption?.possible || false, '| barrier:', parsed.capitalProtection?.barrier || 'none', '| barrierCoupon:', parsed.capitalProtection?.barrierCoupon || 'none', '| model:', _getAIModel());
      return parsed;
    } catch (e) { console.error('[parseBrochure] Error:', e); throw new Error('Impossible de parser la brochure: ' + e.message); }
  }

  async generateSummary(productData) {
    const compact = { name: productData.name, type: productData.type, structureType: productData.structureType, emitter: productData.emitter, underlyings: productData.underlyings, maturity: productData.maturity, coupon: productData.coupon, participationRate: productData.participationRate, capitalProtection: productData.capitalProtection, earlyRedemption: productData.earlyRedemption, scenarios: productData.scenarios, historicalSimulations: productData.historicalSimulations, risks: productData.risks, mechanism: productData.mechanism, decrementPct: productData.decrementPct, actualDividendYield: productData.actualDividendYield };
    const prompt = 'Résumé structuré de ce produit structuré. Données:\n' + JSON.stringify(compact) + '\n\nFormat avec ## sections: DESCRIPTION, MÉCANISME, RENDEMENT, PROTECTION, REMBOURSEMENT ANTICIPÉ, SCÉNARIOS, POINTS ATTENTION. Direct, précis, chiffres.';
    return await this._callAI(prompt, MAX_TOKENS);
  }

  async chat(messages, productContext, portfolioContext) {
    const systemPrompt = 'Expert produits structurés. Produit:\n' + JSON.stringify(productContext, null, 2) + '\n\nPortefeuille:\n' + JSON.stringify(portfolioContext, null, 2) + '\n\nSois direct, cite les chiffres, challenge si nécessaire.';
    try { return await this._callAIWithHistory(systemPrompt, messages); } catch (e) { console.error('Erreur chat IA:', e); throw e; }
  }

  async summarizeConversation(messages, decision) {
    const chatText = messages.map(m => (m.role === 'user' ? 'MOI' : 'CLAUDE') + ': ' + m.content).join('\n');
    return await this._callAI('Résume en 3-5 points clés:\n' + chatText + '\nDécision: ' + (decision || 'Non décidée'), MAX_TOKENS);
  }

  async _callAI(prompt, maxTokens) {
    var model = _getAIModel();
    const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model, max_tokens: maxTokens || MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }) });
    if (!res.ok) {
      if (typeof CONFIG !== 'undefined' && CONFIG.AI_MODEL_FALLBACK && model !== CONFIG.AI_MODEL_FALLBACK) {
        console.warn('[pdf.js V7.6] ' + model + ' failed, falling back to ' + CONFIG.AI_MODEL_FALLBACK);
        const res2 = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: CONFIG.AI_MODEL_FALLBACK, max_tokens: maxTokens || MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }) });
        if (!res2.ok) { const err = await res2.text(); throw new Error('AI API ' + res2.status + ': ' + err.substring(0, 200)); }
        const data2 = await res2.json(); return data2.content?.map(b => b.text || '').join('\n') || '';
      }
      const err = await res.text(); throw new Error('AI API ' + res.status + ': ' + err.substring(0, 200));
    }
    const data = await res.json(); const text = data.content?.map(b => b.text || '').join('\n') || ''; if (!text) throw new Error('Réponse IA vide'); return text;
  }

  async _callAIWithHistory(systemPrompt, messages) {
    var model = _getAIModel();
    const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model, max_tokens: MAX_TOKENS, system: systemPrompt, messages }) });
    if (!res.ok) {
      if (typeof CONFIG !== 'undefined' && CONFIG.AI_MODEL_FALLBACK && model !== CONFIG.AI_MODEL_FALLBACK) {
        console.warn('[pdf.js V7.6] ' + model + ' chat failed, falling back to ' + CONFIG.AI_MODEL_FALLBACK);
        const res2 = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: CONFIG.AI_MODEL_FALLBACK, max_tokens: MAX_TOKENS, system: systemPrompt, messages }) });
        if (!res2.ok) { const err = await res2.text(); throw new Error('AI API ' + res2.status + ': ' + err.substring(0, 200)); }
        const data2 = await res2.json(); return data2.content?.map(b => b.text || '').join('\n') || '';
      }
      const err = await res.text(); throw new Error('AI API ' + res.status + ': ' + err.substring(0, 200));
    }
    const data = await res.json(); return data.content?.map(b => b.text || '').join('\n') || '';
  }
}

const pdfExtractor = new PDFExtractor();
const aiParser = new AIParser();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing V7.4
// V7.4: Fix barrier inversion — "baisse de plus de X%" = barrier at (100-X)%
//   - Rule 19: "baisse de plus de 40%" → barrier = 60%, NOT 40%
//   - Post-process: auto-fix inverted barriers from rawText
// V7.3: Fix digitale/capital garanti detection
//   - Rule 17: Digitale with capital garanti ≠ autocall
//   - Post-process: capital 100% + no "remboursement anticipé" → not autocall
//   - Rule 18: Barrière coupon vs barrière capital distinction
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
    jsonMatches.push(partial);
  }
  const sorted = jsonMatches.sort((a, b) => b.length - a.length);
  for (const candidate of sorted) {
    let clean = candidate.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([[\{,])\s*,/g, '$1').replace(/\n/g, ' ');
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

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 14000);
    const prompt = `Tu es un parseur JSON expert en produits structur\u00e9s. Extrais les donn\u00e9es de cette brochure.

TEXTE BROCHURE:
${textToSend}

R\u00c8GLES D'EXTRACTION CRITIQUES:
1. "gain de X% par ann\u00e9e" ou "coupon de X%" = coupon rate X
2. "remboursement anticip\u00e9 AUTOMATIQUE" = autocall. ATTENTION: "Date de Constatation Annuelle" seule N'EST PAS un autocall si elle concerne uniquement le COUPON.
3. "performance relative" ou "paire d'actions" ou "dispersion" = structureType "dispersion"
4. "participation de X%" = participationRate X (PAS un coupon)
5. "taux fixe" ou "callable" = structureType "taux_fixe"
6. "capital garanti" ou "protection 100%" = structureType "capital_garanti" (m\u00eame s'il y a une barri\u00e8re COUPON)
7. Si DIFFERENCES de performance entre actions = structureType "dispersion"
8. Si paiement "\u00e0 maturit\u00e9" = paymentTiming "maturity"
9. Extraire simulations historiques (min, max, median, mean)
10. Extraire rating \u00e9metteur/garant (Moody's, S&P)
11. D\u00c9CR\u00c9MENT: "pr\u00e9l\u00e8vement forfaitaire X%" ou "d\u00e9cr\u00e9ment X%" \u2192 decrementPct=X. Si dividendes r\u00e9els mentionn\u00e9s \u2192 actualDividendYield
12. STEP-DOWN: barri\u00e8re "d\u00e9gressive" \u2192 stepDown=true, stepDownPct=baisse par p\u00e9riode
13. COUPON PAR P\u00c9RIODE: si "X% par semestre (Y% p.a.)" \u2192 coupon.rate = X (par p\u00e9riode), PAS Y
14. DOUBLE COUPON: si rappel\u00e9 = Z%/an et maturit\u00e9 = W%/an (Z\u2260W), extraire coupon.rateIfCalled=Z et coupon.rateIfMaturity=W
15. DOUBLE BARRI\u00c8RE: si barri\u00e8re coupon \u2260 barri\u00e8re capital, extraire capitalProtection.barrierCoupon ET capitalProtection.barrier (capital)
16. OBSERVATION START: si observations commencent au semestre X ou ann\u00e9e Y (pas S1/Y1), extraire earlyRedemption.startSemester ou startYear
17. DIGITALE / CAPITAL GARANTI: Si "garantie en capital \u00e0 l'\u00e9ch\u00e9ance" ou "remboursement de l'int\u00e9gralit\u00e9 du capital investi, peu importe l'\u00e9volution du march\u00e9" ET il n'y a PAS de "remboursement anticip\u00e9 automatique" \u2192 structureType="capital_garanti", earlyRedemption.possible=false. Les "Dates de Constatation Annuelle" sont pour le versement du COUPON, PAS pour un rappel anticip\u00e9 du produit.
18. BARRI\u00c8RE COUPON vs CAPITAL: Si le seuil (ex: 100%) d\u00e9clenche le COUPON mais que le capital est garanti quoi qu'il arrive \u2192 c'est une barrierCoupon, PAS une barrier capital. Mettre capitalProtection.barrier=null et capitalProtection.barrierCoupon=100.
19. \u26a0\ufe0f BARRI\u00c8RE CAPITAL — CONVERSION OBLIGATOIRE: Quand la brochure dit "perte en capital si baisse de plus de X%" ou "baisse n'exc\u00e8de pas X%", la barri\u00e8re capital = 100 - X. Exemples: "baisse de plus de 40%" \u2192 barrier=60. "baisse n'exc\u00e8de pas 20%" \u2192 c'est un seuil de coupon/remboursement \u00e0 80%. NE JAMAIS mettre le pourcentage de baisse directement comme barri\u00e8re. La barri\u00e8re est le NIVEAU (en % du initial) en dessous duquel il y a perte.

R\u00e9ponds UNIQUEMENT avec un objet JSON. Aucun texte avant ou apr\u00e8s.

{"name":"Nom","type":"autocall ou digitale ou dispersion ou taux-fixe...","structureType":"autocall ou dispersion ou taux_fixe ou capital_garanti...","emitter":"\u00c9metteur","guarantor":"Garant","guarantorRating":{"moodys":"A1","sp":"A"},"isin":"ISIN","underlyings":["sous-jacent"],"underlyingType":"single-index ou basket ou pairs","nUnderlyings":1,"nPairs":null,"currency":"EUR","maturity":"5 ans","maturityYears":5,"coupon":{"rate":4.5,"rateIfCalled":5.0,"rateIfMaturity":4.0,"type":"conditionnel","frequency":"semestriel","trigger":60,"memory":false,"paymentTiming":"periodic"},"participationRate":null,"capitalProtection":{"protected":false,"level":null,"barrier":50,"barrierCoupon":60,"barrierType":"europeenne","couponFloor":false},"earlyRedemption":{"possible":true,"type":"autocall","trigger":95,"frequency":"semestriel","startSemester":4,"startYear":2,"stepDown":true,"stepDownPct":2.5},"decrementPct":5.0,"actualDividendYield":0.97,"historicalSimulations":null,"scenarios":{"favorable":"...","median":"...","defavorable":"..."},"risks":["risque1"],"mechanism":"Description courte","summary":"max 100 car"}`;

    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      const parsed = repairJSON(response);

      // ═══ POST-PROCESS: structureType ═══
      if (!parsed.structureType && parsed.type) {
        if (parsed.type === 'dispersion') parsed.structureType = 'dispersion';
        else if (parsed.type === 'taux-fixe') parsed.structureType = 'taux_fixe';
        else if (parsed.type === 'digitale') parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'capital-protege' || parsed.type === 'capital-garanti') parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'reverse') parsed.structureType = 'reverse';
      }

      // ═══ POST-PROCESS: Auto-detect dispersion ═══
      if (!parsed.structureType) {
        var allText = JSON.stringify(parsed).toLowerCase();
        if (allText.indexOf('performance relative') >= 0 || allText.indexOf('paire') >= 0 || allText.indexOf('dispersion') >= 0) {
          parsed.structureType = 'dispersion';
        }
      }

      // ═══ V7.3 FIX: Capital garanti 100% + no autocall keyword → NOT an autocall ═══
      var cpLevel = parsed.capitalProtection && (parsed.capitalProtection.level || parsed.capitalProtection.protected);
      var isCapitalGaranti100 = false;
      if (parsed.capitalProtection) {
        if (parsed.capitalProtection.level === 100 || parsed.capitalProtection.level === '100' || parsed.capitalProtection.level === '100%') {
          isCapitalGaranti100 = true;
        }
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
        var hasRealAutocall = /remboursement\s*(?:automatique\s*)?anticip[ée]/i.test(rawText) ||
                              /rappel\s*(?:automatique\s*)?anticip[ée]/i.test(rawText) ||
                              /remboursement\s*anticip[ée]\s*automatique/i.test(rawText);
        var hasUnconditionalCapital = txt.indexOf('peu importe') >= 0 && txt.indexOf('capital') >= 0;

        if (!hasRealAutocall || hasUnconditionalCapital) {
          if (parsed.earlyRedemption) {
            parsed.earlyRedemption.possible = false;
            parsed.earlyRedemption.type = 'none';
          } else {
            parsed.earlyRedemption = { possible: false, type: 'none' };
          }
          if (!parsed.structureType || parsed.structureType === 'autocall') {
            parsed.structureType = 'capital_garanti';
          }
          if (parsed.type === 'autocall') parsed.type = 'digitale';
          console.log('[parseBrochure V7.3] Capital garanti 100% detected — autocall overridden to false');
        }

        if (parsed.capitalProtection && parsed.capitalProtection.barrier && !parsed.capitalProtection.barrierCoupon) {
          parsed.capitalProtection.barrierCoupon = parsed.capitalProtection.barrier;
          parsed.capitalProtection.barrier = null;
          console.log('[parseBrochure V7.3] Barrier reclassified as barrierCoupon=' + parsed.capitalProtection.barrierCoupon + '% (capital is 100% guaranteed)');
        }
      }

      // ═══ V7.4 FIX: Auto-fix inverted barrier from "baisse de plus de X%" ═══
      // If text says "baisse de plus de X%" and barrier was set to X instead of (100-X), fix it
      if (parsed.capitalProtection && parsed.capitalProtection.barrier) {
        var b = parseFloat(parsed.capitalProtection.barrier);
        if (b > 0 && b <= 50) {
          // Barrier ≤ 50% is suspicious — check if text says "baisse de plus de X%"
          var baisseMatch = rawText.match(/(?:baisse|perte)[^.]{0,40}(?:de\s*)?(?:plus\s*de\s*)?(\d+[.,]?\d*)\s*%\s*(?:par rapport|de son)/i);
          if (baisseMatch) {
            var baisseValue = parseFloat(baisseMatch[1].replace(',', '.'));
            // If the barrier equals the baisse percentage, it was inverted
            if (Math.abs(b - baisseValue) < 1) {
              var correctedBarrier = 100 - baisseValue;
              console.log('[parseBrochure V7.4] Barrier inversion detected: ' + b + '% → corrected to ' + correctedBarrier + '% (from "baisse de ' + baisseValue + '%")');
              parsed.capitalProtection.barrier = correctedBarrier;
            }
          }
        }
        // Also check: if barrier is exactly a "baisse" value even above 50
        if (!parsed._barrierChecked) {
          var allBaisseMatches = rawText.match(/baisse\s*(?:de\s*)?(?:plus\s*de\s*)?(\d+[.,]?\d*)\s*%\s*(?:par rapport|de son)/gi);
          if (allBaisseMatches) {
            allBaisseMatches.forEach(function(match) {
              var val = match.match(/(\d+[.,]?\d*)\s*%/);
              if (val) {
                var baisseVal = parseFloat(val[1].replace(',', '.'));
                if (Math.abs(b - baisseVal) < 1 && baisseVal !== (100 - b)) {
                  console.log('[parseBrochure V7.4] Barrier=' + b + '% matches "baisse de ' + baisseVal + '%" — correcting to ' + (100 - baisseVal) + '%');
                  parsed.capitalProtection.barrier = 100 - baisseVal;
                }
              }
            });
          }
          parsed._barrierChecked = true;
        }
      }

      // ═══ V7.4: Also fix coupon barrier from "n'excède pas X%" patterns ═══
      // "baisse n'excède pas 20%" → coupon paid if index ≥ 80% → this is a coupon trigger at 80%, NOT a barrier
      if (parsed.capitalProtection && !isCapitalGaranti100) {
        var excedeMatch = rawText.match(/baisse\s*(?:n['']?\s*)?exc[èe]de\s*pas\s*(\d+[.,]?\d*)\s*%/i);
        if (excedeMatch) {
          var excedeVal = parseFloat(excedeMatch[1].replace(',', '.'));
          var couponTrigger = 100 - excedeVal;
          // This is the level at which coupon is paid at maturity (not a barrier for capital)
          if (!parsed.capitalProtection.barrierCoupon || parsed.capitalProtection.barrierCoupon === parsed.capitalProtection.barrier) {
            parsed.capitalProtection.barrierCoupon = couponTrigger;
            console.log('[parseBrochure V7.4] Coupon trigger from "n\'excède pas ' + excedeVal + '%" → barrierCoupon=' + couponTrigger + '%');
          }
        }
      }

      // ═══ Participation adjustment ═══
      if (parsed.participationRate && parsed.structureType === 'dispersion') {
        if (!parsed.coupon) parsed.coupon = {};
        parsed.coupon.type = 'participation';
        parsed.coupon.rate = parsed.participationRate;
        parsed.coupon.paymentTiming = 'maturity';
      }

      // ═══ Post-process décrément from rawText ═══
      if (!parsed.decrementPct) {
        var decMatch = rawText.match(/(?:prélèvement forfaitaire|décrément|decrement)\s*(?:de\s*)?(?:fixe\s*(?:annuel\s*)?(?:de\s*)?)?\s*(\d[\d.,]*)\s*%/i);
        if (!decMatch) {
          var arMatch = rawText.match(/AR\s*(\d+[.,]?\d*)\s*%/i);
          if (arMatch) decMatch = arMatch;
        }
        if (decMatch) {
          parsed.decrementPct = parseFloat((decMatch[1] || '').replace(',', '.'));
          console.log('[parseBrochure] Post-process décrément: ' + parsed.decrementPct + '%');
        }
      }

      // ═══ Detect actual dividend ═══
      if (parsed.decrementPct && !parsed.actualDividendYield) {
        var divMatch = rawText.match(/dividendes?\s*(?:nets?\s*)?(?:distribu)?[^.]{0,80}?(\d+[.,]\d+)\s*%/i);
        if (divMatch) parsed.actualDividendYield = parseFloat(divMatch[1].replace(',', '.'));
      }

      // ═══ Post-process step-down ═══
      if (parsed.earlyRedemption && !parsed.earlyRedemption.stepDown) {
        if (rawText.indexOf('dégressive') >= 0 || rawText.indexOf('step-down') >= 0 || rawText.indexOf('step down') >= 0) {
          parsed.earlyRedemption.stepDown = true;
          var sdMatch = rawText.match(/dégressive\s*(?:de\s*)?[-\u2013]?\s*(\d+[.,]?\d*)\s*%/i);
          if (sdMatch) parsed.earlyRedemption.stepDownPct = parseFloat(sdMatch[1].replace(',', '.'));
        }
      }

      // ═══ Post-process double barrier from rawText ═══
      if (parsed.capitalProtection && !parsed.capitalProtection.barrierCoupon) {
        var bcMatch = rawText.match(/barrière\s*(?:de\s*)?coupon[^.]{0,30}?(\d+[.,]?\d*)\s*%/i);
        if (bcMatch) parsed.capitalProtection.barrierCoupon = parseFloat(bcMatch[1].replace(',', '.'));
      }

      // ═══ Post-process observation start ═══
      if (parsed.earlyRedemption && !parsed.earlyRedemption.startSemester) {
        var startMatch = rawText.match(/(?:à l'issue|à partir)\s*(?:des?\s*)?(?:semestres?\s*)(\d+)/i);
        if (startMatch) parsed.earlyRedemption.startSemester = parseInt(startMatch[1]);
      }

      // ═══ V7.4: Clean up internal flags ═══
      delete parsed._barrierChecked;

      console.log('[parseBrochure V7.4] type:', parsed.structureType,
        '| autocall:', parsed.earlyRedemption?.possible || false,
        '| capitalGaranti:', isCapitalGaranti100,
        '| decrement:', parsed.decrementPct || 'none',
        '| stepDown:', parsed.earlyRedemption?.stepDown || false,
        '| barrierCoupon:', parsed.capitalProtection?.barrierCoupon || 'none',
        '| barrier:', parsed.capitalProtection?.barrier || 'none',
        '| startSem:', parsed.earlyRedemption?.startSemester || 'S1',
        '| rateIfCalled:', parsed.coupon?.rateIfCalled || 'same');
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
    if (!text) throw new Error('R\u00e9ponse IA vide');
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

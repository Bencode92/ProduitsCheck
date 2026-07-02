// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — PDF Extraction & AI Parsing V7.9
// V7.9: Callable/cumulative coupon/step-down start/no-underlying rules
// V7.8: Basket/panier équipondéré detection + rawText passthrough
// V7.7: Fix coupon per-period extraction + barrier sanity checks
// V7.6: Robust barrier inversion fix — multi-pattern matching
// V7.5: Use CONFIG.AI_MODEL (Opus) instead of hardcoded Sonnet
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
  return (typeof CONFIG !== 'undefined' && CONFIG.AI_MODEL) ? CONFIG.AI_MODEL : 'claude-opus-4-8';
}

class AIParser {
  constructor() { this.endpoint = CONFIG.AI_ENDPOINT; }

  async parseBrochure(rawText) {
    const textToSend = rawText.substring(0, 14000);
    const prompt = `Tu es un parseur JSON expert en produits structurés. Extrais les données de cette brochure.\n\nTEXTE BROCHURE:\n${textToSend}\n\nRÈGLES D'EXTRACTION CRITIQUES:\n1. "gain de X% par année" ou "coupon de X%" = coupon rate X\n2. "remboursement anticipé AUTOMATIQUE" = autocall. ATTENTION: "Date de Constatation Annuelle" seule N'EST PAS un autocall si elle concerne uniquement le COUPON.\n3. "performance relative" ou "paire d'actions" ou "dispersion" = structureType "dispersion"\n4. "participation de X%" = participationRate X (PAS un coupon)\n5. "taux fixe" ou "callable" = structureType "taux_fixe"\n6. "capital garanti" ou "protection 100%" = structureType "capital_garanti" (même s'il y a une barrière COUPON)\n7. Si DIFFERENCES de performance entre actions = structureType "dispersion"\n8. Si paiement "à maturité" = paymentTiming "maturity"\n9. Extraire simulations historiques (min, max, median, mean)\n10. Extraire rating émetteur/garant (Moody's, S&P)\n11. DÉCRÉMENT: "prélèvement forfaitaire X%" ou "décrément X%" → decrementPct=X\n12. STEP-DOWN: barrière "dégressive" → stepDown=true, stepDownPct=baisse par période\n13. ⚠️ COUPON PAR PÉRIODE (CRITIQUE): Si le produit est semestriel et dit "coupon de X% par semestre", le rate DOIT être X (le taux PAR SEMESTRE), PAS le taux annualisé (2X). Si le produit est trimestriel et dit "coupon de X% par trimestre", rate = X. IGNORE le "TRA annuel brut" ou "rendement annuel" — c'est une info secondaire, pas le coupon rate. Exemples: "coupon de 3,50% par semestre" → rate=3.50, frequency="semestriel". "coupon de 1,875% par trimestre" → rate=1.875, frequency="trimestriel".\n14. DOUBLE COUPON: si rappelé = Z%/an et maturité = W%/an (Z≠W), extraire coupon.rateIfCalled=Z et coupon.rateIfMaturity=W\n15. DOUBLE BARRIÈRE: si barrière coupon ≠ barrière capital, extraire capitalProtection.barrierCoupon ET capitalProtection.barrier (capital)\n16. OBSERVATION START: si observations commencent au semestre X ou année Y (pas S1/Y1), extraire earlyRedemption.startSemester ou startYear\n17. DIGITALE / CAPITAL GARANTI: Si "garantie en capital à l'échéance" ET pas de "remboursement anticipé automatique" → structureType="capital_garanti", earlyRedemption.possible=false.\n18. BARRIÈRE COUPON vs CAPITAL: Si le seuil (ex: 100%) déclenche le COUPON mais que le capital est garanti → c'est une barrierCoupon, PAS une barrier capital.\n19. ⚠️ BARRIÈRE CAPITAL — CONVERSION: "perte en capital si baisse de plus de X%" → barrier = 100 - X. "baisse de plus de 40%" → barrier=60. "baisse de plus de 60%" → barrier=40.\n20. ⚠️ DOUBLE BARRIÈRE CRITIQUE: Beaucoup de Phoenix ont DEUX barrières distinctes. Exemple: "coupon versé si sous-jacent ≥ 60%" = barrierCoupon=60. "perte en capital si sous-jacent < 40%" = barrier=40. "capital remboursé si sous-jacent entre 40% et 60%" = zone de protection. Extraire LES DEUX: capitalProtection.barrierCoupon (seuil coupon, plus haut) ET capitalProtection.barrier (seuil perte capital, plus bas).\n21. ⚠️ PANIER ÉQUIPONDÉRÉ vs WORST-OF (CRITIQUE): Si la brochure dit "panier équi-pondéré", "panier composé de", "chaque action représente un poids identique", "somme pondérée" ou "niveau du panier" → c'est un PANIER (performance = MOYENNE des actions), PAS un worst-of. Dans ce cas: structureType="basket", underlyingType="basket".\n22. ⚠️ CALLABLE AU GRÉ DE L'ÉMETTEUR: Si "rappelé à la discrétion de l'émetteur", "au gré de l'émetteur", "callable", "peut être rappelé par anticipation à la discrétion" → ce n'est PAS un autocall automatique. earlyRedemption.type="callable" (PAS "autocall"). structureType="taux_fixe". Il n'y a PAS de trigger/barrière — c'est l'émetteur qui choisit.\n23. ⚠️ COUPON CUMULATIF (CRITIQUE): "X% par semestre écoulé" ou "X% × nombre de semestres écoulés" → rate=X, frequency="semestriel". Le "× nombre de semestres" est la formule de PAIEMENT (combien on reçoit au total), PAS le taux. Ne PAS multiplier X par le nombre de périodes. Exemples: "4,50% par semestre écoulé" → rate=4.50, frequency="semestriel". "9,00% p.a." dans le même produit = taux annualisé informatif, PAS le rate.\n24. ⚠️ STEP-DOWN AVEC START DIFFÉRÉ: "dès le 4ème semestre" ou "à partir du semestre 4" combiné avec "dégressive de -2,50%" → startSemester=4, stepDown=true, stepDownPct=2.5. Si "95% dès le semestre 4 puis -2.50% par semestre" → trigger=95, startSemester=4, stepDown=true, stepDownPct=2.5.\n25. PRODUIT SANS SOUS-JACENT ACTIONS: Si le produit est un "taux fixe" ou "note" sans référence à une action, indice, ou ETF → underlyings=[], underlyingType="none". Le produit ne dépend que du risque de crédit de l'émetteur.\n\nRéponds UNIQUEMENT avec un objet JSON. Aucun texte avant ou après.\n\n{"name":"Nom","type":"autocall ou digitale ou dispersion ou taux-fixe ou callable ou basket...","structureType":"autocall ou dispersion ou taux_fixe ou capital_garanti ou basket...","emitter":"Émetteur","guarantor":"Garant","guarantorRating":{"moodys":"A1","sp":"A"},"isin":"ISIN","underlyings":["sous-jacent"],"underlyingType":"single-index ou basket ou pairs ou worst-of ou none","nUnderlyings":1,"nPairs":null,"currency":"EUR","maturity":"5 ans","maturityYears":5,"coupon":{"rate":4.5,"rateIfCalled":5.0,"rateIfMaturity":4.0,"type":"conditionnel ou fixe","frequency":"semestriel ou annuel","trigger":60,"memory":false,"paymentTiming":"periodic ou maturity"},"participationRate":null,"capitalProtection":{"protected":false,"level":null,"barrier":50,"barrierCoupon":60,"barrierType":"europeenne","couponFloor":false},"earlyRedemption":{"possible":true,"type":"autocall ou callable","trigger":95,"frequency":"semestriel","startSemester":4,"startYear":2,"stepDown":true,"stepDownPct":2.5},"decrementPct":5.0,"actualDividendYield":0.97,"historicalSimulations":null,"scenarios":{"favorable":"...","median":"...","defavorable":"..."},"risks":["risque1"],"mechanism":"Description courte","summary":"max 100 car"}`;

    try {
      const response = await this._callAI(prompt, MAX_TOKENS);
      const parsed = repairJSON(response);

      if (!parsed.structureType && parsed.type) {
        if (parsed.type === 'dispersion') parsed.structureType = 'dispersion';
        else if (parsed.type === 'taux-fixe' || parsed.type === 'callable') parsed.structureType = 'taux_fixe';
        else if (parsed.type === 'digitale') parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'capital-protege' || parsed.type === 'capital-garanti') parsed.structureType = 'capital_garanti';
        else if (parsed.type === 'reverse') parsed.structureType = 'reverse';
        else if (parsed.type === 'basket' || parsed.type === 'panier') parsed.structureType = 'basket';
      }

      if (!parsed.structureType) {
        var allText = JSON.stringify(parsed).toLowerCase();
        if (allText.indexOf('performance relative') >= 0 || allText.indexOf('paire') >= 0 || allText.indexOf('dispersion') >= 0) {
          parsed.structureType = 'dispersion';
        }
      }

      // V7.8: Basket/panier équipondéré detection from rawText
      var txtLower = rawText.toLowerCase();
      var basketKeywords = [
        'panier equi-pondéré', 'panier équi-pondéré', 'panier equi pondéré', 'panier équi pondéré',
        'panier equipondéré', 'panier équipondéré',
        'chaque action représente un poids identique',
        'chaque action represente un poids identique',
        'somme pondérée (où chaque action représente un poids identique',
        'somme ponderee',
        'equally weighted basket', 'equal weight basket'
      ];
      var isBasketFromText = false;
      for (var bk = 0; bk < basketKeywords.length; bk++) {
        if (txtLower.indexOf(basketKeywords[bk].toLowerCase()) >= 0) {
          isBasketFromText = true;
          break;
        }
      }
      if (!isBasketFromText && txtLower.indexOf('niveau du panier') >= 0 && txtLower.indexOf('worst') < 0 && txtLower.indexOf('pire') < 0) {
        isBasketFromText = true;
      }
      if (isBasketFromText) {
        if (!parsed.structureType || parsed.structureType === 'autocall') parsed.structureType = 'basket';
        if (!parsed.underlyingType || parsed.underlyingType === 'worst-of') parsed.underlyingType = 'basket';
        parsed._isBasket = true;
        console.log('[parseBrochure V7.9] Basket detected from rawText');
      }

      // V7.9: Callable au gré de l'émetteur detection from rawText
      var callableKeywords = ['à la discrétion de', 'au gré de l\'émetteur', 'au gré de l\'emetteur', 'callable', 'rappelé par anticipation à la discrétion', 'peut être rappelé'];
      var isCallableFromText = false;
      for (var ck = 0; ck < callableKeywords.length; ck++) {
        if (txtLower.indexOf(callableKeywords[ck].toLowerCase()) >= 0) {
          isCallableFromText = true;
          break;
        }
      }
      // Only apply if there's no automatic trigger (no barrier-based autocall)
      if (isCallableFromText && txtLower.indexOf('automatiquement activé') < 0 && txtLower.indexOf('mécanisme de remboursement automatique') < 0) {
        if (parsed.earlyRedemption) {
          parsed.earlyRedemption.type = 'callable';
          delete parsed.earlyRedemption.trigger;
        }
        if (!parsed.structureType || parsed.structureType === 'autocall') {
          parsed.structureType = 'taux_fixe';
        }
        if (parsed.coupon && typeof parsed.coupon === 'object') {
          parsed.coupon.type = 'fixe';
        }
        console.log('[parseBrochure V7.9] Callable (au gré émetteur) detected — NOT autocall');

        // V7.9.1: Detect "In Fine" callable — coupon capitalisé, pas de versement périodique
        if (/in\s*fine/i.test(txtLower) || /coupon\s*capitalis/i.test(txtLower) || /par\s*ann[eé]e\s*[eé]coul[eé]e/i.test(txtLower)) {
          parsed.structureType = 'taux_fixe_in_fine';
          if (parsed.coupon && typeof parsed.coupon === 'object') {
            parsed.coupon.frequency = 'in_fine';
            parsed.coupon.paymentTiming = 'at_redemption';
            parsed.coupon.type = 'fixe_capitalise';
          }
          console.log('[parseBrochure V7.9.1] In Fine callable detected — coupon capitalisé');
        }
      }

      // V7.9: Fix cumulative coupon — AI often multiplies per-period rate by N
      if (parsed.coupon && typeof parsed.coupon === 'object' && parsed.coupon.rate) {
        var rate = parseFloat(parsed.coupon.rate) || 0;
        if (rate > 12) {
          // Suspiciously high rate — check if rawText has per-period rate
          var perPeriodPatterns = [
            /coupon[^.]{0,40}?(\d+[.,]\d+)\s*%\s*(?:par\s*semestre|par\s*sem)/i,
            /coupon[^.]{0,40}?(\d+[.,]\d+)\s*%\s*(?:par\s*ann[ée]e|par\s*an\b)/i,
            /(\d+[.,]\d+)\s*%\s*(?:par\s*semestre|semestriel)/i,
            /(\d+[.,]\d+)\s*%\s*(?:par\s*ann[ée]e\s*[ée]coul[ée]e|par\s*an\s)/i,
            /gain\s*(?:de\s*)?(\d+[.,]\d+)\s*%\s*(?:par\s*ann[ée]e)/i
          ];
          for (var pp = 0; pp < perPeriodPatterns.length; pp++) {
            var ppM = perPeriodPatterns[pp].exec(rawText);
            if (ppM) {
              var realRate = parseFloat(ppM[1].replace(',', '.'));
              if (realRate > 0 && realRate < rate && realRate <= 12) {
                console.log('[parseBrochure V7.9] Cumulative coupon fix: ' + rate + '% → ' + realRate + '% (per-period from rawText)');
                parsed.coupon.rate = realRate;
                // Also set rateIfCalled/rateIfMaturity if double coupon
                if (parsed.coupon.rateIfCalled && parseFloat(parsed.coupon.rateIfCalled) > 12) {
                  var calledMatch = rawText.match(/rappel[^.]{0,60}?(\d+[.,]\d+)\s*%\s*par/i);
                  if (calledMatch) parsed.coupon.rateIfCalled = parseFloat(calledMatch[1].replace(',', '.'));
                }
                break;
              }
            }
          }
          // Also check "X,XX% p.a." pattern
          var paMatch = rawText.match(/(\d+[.,]\d+)\s*%\s*p\.?a\.?/i);
          if (paMatch && rate > 12) {
            var paRate = parseFloat(paMatch[1].replace(',', '.'));
            if (paRate > 0 && paRate <= 12) {
              // p.a. rate is the annualized rate — for semestriel, divide by 2
              var freqNow = (parsed.coupon.frequency || '').toLowerCase();
              if (freqNow.indexOf('semest') >= 0) {
                parsed.coupon.rate = Math.round(paRate / 2 * 100) / 100;
                console.log('[parseBrochure V7.9] Rate from p.a.: ' + paRate + '%/an → ' + parsed.coupon.rate + '%/sem');
              } else {
                parsed.coupon.rate = paRate;
                console.log('[parseBrochure V7.9] Rate from p.a.: ' + paRate + '%');
              }
            }
          }
        }
      }

      // V7.9: Fix frequency — detect semestriel from rawText when AI said annuel
      if (parsed.coupon && typeof parsed.coupon === 'object') {
        var aiFreq = (parsed.coupon.frequency || '').toLowerCase();
        if (aiFreq === 'annuel' || aiFreq === 'annuelle' || !aiFreq) {
          if (txtLower.indexOf('semestriel') >= 0 || txtLower.indexOf('par semestre') >= 0 || txtLower.indexOf('chaque semestre') >= 0) {
            // Check it's about coupon frequency, not just observation
            if (/coupon[^.]{0,80}semest/i.test(rawText) || /semest[^.]{0,80}coupon/i.test(rawText) || txtLower.indexOf('par semestre écoulé') >= 0 || txtLower.indexOf('par semestre ecoulé') >= 0) {
              parsed.coupon.frequency = 'semestriel';
              console.log('[parseBrochure V7.9] Frequency corrected: annuel → semestriel');
            }
          }
        }
      }

      // V7.9: Step-down start semester — enhanced detection
      if (parsed.earlyRedemption) {
        if (!parsed.earlyRedemption.startSemester) {
          var startSemMatch = rawText.match(/(?:dès|à partir d[eu])\s*(?:le\s*)?(?:la\s*)?(?:fin\s*d[eu]\s*)?(?:semestre|S)\s*(\d+)/i);
          if (startSemMatch) {
            parsed.earlyRedemption.startSemester = parseInt(startSemMatch[1]);
            console.log('[parseBrochure V7.9] Step-down start: semester ' + parsed.earlyRedemption.startSemester);
          }
        }
        // Also detect step-down pct from rawText
        if (!parsed.earlyRedemption.stepDown) {
          if (txtLower.indexOf('dégressive') >= 0 || txtLower.indexOf('step-down') >= 0 || txtLower.indexOf('step down') >= 0) {
            parsed.earlyRedemption.stepDown = true;
            var sdPctMatch = rawText.match(/(?:d[ée]gressive|step.?down)\s*(?:de\s*)?[-–]?\s*(\d+[.,]?\d*)\s*%/i);
            if (sdPctMatch) parsed.earlyRedemption.stepDownPct = parseFloat(sdPctMatch[1].replace(',', '.'));
            console.log('[parseBrochure V7.9] Step-down detected: pct=' + (parsed.earlyRedemption.stepDownPct || '?') + '%');
          }
        }
      }

      // V7.8: Store rawText snippet
      parsed._rawTextSnippet = rawText.substring(0, 3000);

      var isCapitalGaranti100 = false;
      if (parsed.capitalProtection) {
        if (parsed.capitalProtection.level === 100 || parsed.capitalProtection.level === '100' || parsed.capitalProtection.level === '100%') isCapitalGaranti100 = true;
        if (parsed.capitalProtection.protected === true || parsed.capitalProtection.protected === 'true') {
          var txt = rawText.toLowerCase();
          if (txt.indexOf('intégralité du capital') >= 0 || txt.indexOf('garantie en capital') >= 0 || txt.indexOf('capital garanti') >= 0 || txt.indexOf('capital est garanti à 100') >= 0 || txt.indexOf('protection totale du capital') >= 0 || txt.indexOf('protection du capital 100%') >= 0) {
            isCapitalGaranti100 = true;
            if (!parsed.capitalProtection.level) parsed.capitalProtection.level = 100;
          }
        }
      }
      // V7.9: Also detect capital garanti from rawText even if AI missed it
      if (!isCapitalGaranti100) {
        if (txtLower.indexOf('protection totale du capital') >= 0 || txtLower.indexOf('100% du capital initial') >= 0 || /protection\s*du\s*capital\s*[:=]?\s*100/i.test(rawText)) {
          isCapitalGaranti100 = true;
          if (!parsed.capitalProtection) parsed.capitalProtection = {};
          parsed.capitalProtection.protected = true;
          parsed.capitalProtection.level = 100;
          console.log('[parseBrochure V7.9] Capital garanti 100% detected from rawText');
        }
      }

      if (isCapitalGaranti100) {
        var txt = rawText.toLowerCase();
        var hasRealAutocall = /remboursement\s*(?:automatique\s*)?anticip[ée]/i.test(rawText) || /rappel\s*(?:automatique\s*)?anticip[ée]/i.test(rawText) || /remboursement\s*anticip[ée]\s*automatique/i.test(rawText);
        var hasCallable = isCallableFromText;
        var hasUnconditionalCapital = txt.indexOf('peu importe') >= 0 && txt.indexOf('capital') >= 0;
        if ((!hasRealAutocall && !hasCallable) || hasUnconditionalCapital) {
          if (parsed.earlyRedemption) { parsed.earlyRedemption.possible = false; parsed.earlyRedemption.type = 'none'; }
          else { parsed.earlyRedemption = { possible: false, type: 'none' }; }
          if (!parsed.structureType || parsed.structureType === 'autocall') parsed.structureType = 'capital_garanti';
          if (parsed.type === 'autocall') parsed.type = 'digitale';
          console.log('[parseBrochure V7.3] Capital garanti 100% detected — autocall overridden to false');
        }
        if (parsed.capitalProtection && parsed.capitalProtection.barrier && !parsed.capitalProtection.barrierCoupon) {
          parsed.capitalProtection.barrierCoupon = parsed.capitalProtection.barrier;
          parsed.capitalProtection.barrier = null;
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
          if (invertMatch) { var corrected = 100 - invertMatch; parsed.capitalProtection.barrier = corrected; }
          if (!invertMatch && b <= 40) { var maxBaisse = baisseValues.length > 0 ? Math.max.apply(null, baisseValues) : 0; if (maxBaisse > 0 && maxBaisse < 60) { parsed.capitalProtection.barrier = 100 - maxBaisse; } }
          parsed._barrierChecked = true;
        }
      }

      // V7.7: Barrier sanity — reject absurd values (>95% or <5%)
      if (parsed.capitalProtection && parsed.capitalProtection.barrier) {
        var bv = parseFloat(parsed.capitalProtection.barrier);
        if (bv > 95 || bv < 5) {
          var realBarrier = null;
          var lossPatterns = [/inf[ée]rieure\s*(?:à\s*)?-\s*(\d+[.,]?\d*)\s*%/gi, /baisse\s*(?:de\s*)?(?:plus\s*de\s*)(\d+[.,]?\d*)\s*%/gi, /perte[^.]{0,40}(?:plus\s*de\s*|sup[ée]rieure\s*à\s*)(\d+[.,]?\d*)\s*%/gi];
          var lossVals = [];
          lossPatterns.forEach(function(re) { var m; while ((m = re.exec(rawText)) !== null) { var v = parseFloat(m[1].replace(',', '.')); if (v >= 30 && v <= 70) lossVals.push(v); } });
          var levelPatterns = [/(\d+[.,]?\d*)\s*%\s*(?:de\s*)?(?:son\s*)?(?:Niveau|niveau)\s*(?:Initial|initial)/gi];
          var levelVals = [];
          levelPatterns.forEach(function(re) { var m; while ((m = re.exec(rawText)) !== null) { var v = parseFloat(m[1].replace(',', '.')); if (v >= 30 && v <= 70) levelVals.push(v); } });
          if (lossVals.length > 0) realBarrier = 100 - Math.max.apply(null, lossVals);
          else if (levelVals.length > 0) realBarrier = Math.min.apply(null, levelVals);
          if (realBarrier && realBarrier > 5 && realBarrier <= 95) parsed.capitalProtection.barrier = realBarrier;
          else parsed.capitalProtection.barrier = 60;
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
          }
        }
      }

      // V7.7: Post-process coupon — detect if AI extracted annual rate instead of per-period
      if (parsed.coupon && typeof parsed.coupon === 'object' && parsed.coupon.rate) {
        var freq = (parsed.coupon.frequency || '').toLowerCase();
        var rate = parseFloat(parsed.coupon.rate) || 0;
        var mult = freq === 'semestriel' || freq === 'semestrielle' ? 2 : freq === 'trimestriel' || freq === 'trimestrielle' ? 4 : 1;
        if (mult > 1 && rate > 0) {
          var perPeriodRe;
          if (mult === 2) perPeriodRe = /coupon[^.]{0,60}?(\d+[.,]\d+)\s*%\s*(?:par\s*semestre|semestriel)/i;
          else if (mult === 4) perPeriodRe = /coupon[^.]{0,60}?(\d+[.,]\d+)\s*%\s*(?:par\s*trimestre|trimestriel)/i;
          if (perPeriodRe) {
            var ppMatch = perPeriodRe.exec(rawText);
            if (ppMatch) {
              var ppRate = parseFloat(ppMatch[1].replace(',', '.'));
              if (ppRate > 0 && Math.abs(rate - ppRate * mult) < 0.5) { parsed.coupon.rate = ppRate; }
              if (ppRate > 0 && Math.abs(rate - ppRate) > 0.5 && Math.abs(rate - ppRate * mult) > 0.5) { parsed.coupon.rate = ppRate; }
            }
          }
          var traMatch = rawText.match(/(?:TRA|[Tt]aux\s*de\s*[Rr]endement\s*[Aa]nnuel)[^.]{0,40}?(\d+[.,]\d+)\s*%/i);
          if (traMatch) {
            var tra = parseFloat(traMatch[1].replace(',', '.'));
            if (tra > 0 && Math.abs(rate - tra) < 0.5 && rate > 4) {
              var halfRate = Math.round(rate / mult * 1000) / 1000;
              var halfStr = halfRate.toString().replace('.', '[.,]');
              var halfRe = new RegExp(halfStr + '\\s*%', 'i');
              if (halfRe.test(rawText)) parsed.coupon.rate = halfRate;
            }
          }
        }
      }

      if (parsed.participationRate && parsed.structureType === 'dispersion') { if (!parsed.coupon) parsed.coupon = {}; parsed.coupon.type = 'participation'; parsed.coupon.rate = parsed.participationRate; parsed.coupon.paymentTiming = 'maturity'; }
      if (parsed.coupon && typeof parsed.coupon !== 'object') { var primitiveRate = typeof parsed.coupon === 'number' ? parsed.coupon : parseFloat(parsed.coupon); parsed.coupon = { rate: primitiveRate || 0 }; }

      if (!parsed.decrementPct) { var decMatch = rawText.match(/(?:prélèvement forfaitaire|décrément|decrement)\s*(?:de\s*)?(?:fixe\s*(?:annuel\s*)?(?:de\s*)?)?\s*(\d[\d.,]*)\s*%/i); if (!decMatch) { var arMatch2 = rawText.match(/AR\s*(\d+[.,]?\d*)\s*%/i); if (arMatch2) decMatch = arMatch2; } if (decMatch) { parsed.decrementPct = parseFloat((decMatch[1] || '').replace(',', '.')); console.log('[parseBrochure V7.9] Post-process décrément: ' + parsed.decrementPct + '%'); } }
      if (parsed.decrementPct && !parsed.actualDividendYield) { var divMatch = rawText.match(/dividendes?\s*(?:nets?\s*)?(?:distribu)?[^.]{0,80}?(\d+[.,]\d+)\s*%/i); if (divMatch) parsed.actualDividendYield = parseFloat(divMatch[1].replace(',', '.')); }
      if (parsed.capitalProtection && !parsed.capitalProtection.barrierCoupon) { var bcMatch = rawText.match(/barrière\s*(?:de\s*)?coupon[^.]{0,30}?(\d+[.,]?\d*)\s*%/i); if (bcMatch) parsed.capitalProtection.barrierCoupon = parseFloat(bcMatch[1].replace(',', '.')); }

      delete parsed._barrierChecked;
      console.log('[parseBrochure V7.9] type:', parsed.structureType, '| basket:', parsed._isBasket || false, '| callable:', (parsed.earlyRedemption && parsed.earlyRedemption.type === 'callable') || false, '| autocall:', parsed.earlyRedemption?.possible || false, '| barrier:', parsed.capitalProtection?.barrier || 'none', '| coupon:', parsed.coupon?.rate, '| freq:', parsed.coupon?.frequency, '| model:', _getAIModel());
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
        console.warn('[pdf.js V7.9] ' + model + ' failed, falling back to ' + CONFIG.AI_MODEL_FALLBACK);
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
        console.warn('[pdf.js V7.9] ' + model + ' chat failed, falling back to ' + CONFIG.AI_MODEL_FALLBACK);
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

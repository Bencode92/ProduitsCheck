// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Scoring Engine
// ═══════════════════════════════════════════════════════════════

class ScoringEngine {
  calculateScore(proposal, portfolio) {
    if (!portfolio || portfolio.length === 0) {
      return { score: 85, details: [{ type: 'info', icon: '📋', text: 'Portefeuille vide — premier produit, pas de comparaison possible.' }], verdict: 'Premier produit du portefeuille. Analyse individuelle uniquement.', breakdown: { redundancy: 0, complementarity: 85 } };
    }
    const penalties = this._calculateRedundancy(proposal, portfolio);
    const bonuses = this._calculateComplementarity(proposal, portfolio);
    let score = 50 + bonuses.total - penalties.total;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const details = [...penalties.details, ...bonuses.details].sort((a, b) => (b.impact || 0) - (a.impact || 0));
    return { score, details, verdict: this._generateVerdict(score), breakdown: { redundancy: penalties.total, complementarity: bonuses.total } };
  }

  _calculateRedundancy(proposal, portfolio) {
    const details = []; let total = 0;
    const sameUnderlying = portfolio.filter(p => p.underlyingType === proposal.underlyingType && proposal.underlyingType !== 'autre');
    if (sameUnderlying.length > 0) {
      total += SCORING_WEIGHTS.SAME_UNDERLYING;
      const pct = Math.round((sameUnderlying.length / portfolio.length) * 100);
      details.push({ type: 'warning', icon: '⚠️', text: `Même sous-jacent que ${sameUnderlying.length} produit(s) — ${pct}% du book`, impact: SCORING_WEIGHTS.SAME_UNDERLYING, category: 'redundancy' });
    } else {
      const proposalGroup = this._getCorrelationGroup(proposal.underlyingType);
      const correlated = portfolio.filter(p => { const g = this._getCorrelationGroup(p.underlyingType); return this._getCorrelation(proposalGroup, g) > 0.7 && g !== proposalGroup; });
      if (correlated.length > 0) {
        total += SCORING_WEIGHTS.CORRELATED_UNDERLYING;
        details.push({ type: 'warning', icon: '🔗', text: `Sous-jacent corrélé avec ${correlated.length} produit(s) du book (>70%)`, impact: SCORING_WEIGHTS.CORRELATED_UNDERLYING, category: 'redundancy' });
      }
    }
    const sameType = portfolio.filter(p => p.type === proposal.type);
    if (sameType.length > 0) {
      const penalty = Math.round(Math.min(SCORING_WEIGHTS.SAME_PRODUCT_TYPE, SCORING_WEIGHTS.SAME_PRODUCT_TYPE * (sameType.length / portfolio.length) * 2));
      total += penalty;
      details.push({ type: 'warning', icon: '📦', text: `Même type que ${sameType.length} produit(s) — ${Math.round((sameType.length / portfolio.length) * 100)}% du book en "${this._getTypeName(proposal.type)}"`, impact: penalty, category: 'redundancy' });
    }
    const sameBank = portfolio.filter(p => p.bankId === proposal.bankId);
    if (sameBank.length > 0) {
      const penalty = Math.round(SCORING_WEIGHTS.SAME_BANK * (sameBank.length / portfolio.length) * 2);
      total += penalty;
      details.push({ type: 'info', icon: '🏦', text: `Même émetteur que ${sameBank.length} produit(s) — concentration ${this._getBankName(proposal.bankId)}`, impact: penalty, category: 'redundancy' });
    }
    const pMat = this._parseMaturityMonths(proposal.maturity);
    if (pMat) {
      const overlapping = portfolio.filter(p => { const m = this._parseMaturityMonths(p.maturity); return m && Math.abs(m - pMat) <= 6; });
      if (overlapping.length > 0) {
        const penalty = Math.round(SCORING_WEIGHTS.OVERLAPPING_MATURITY * (overlapping.length / portfolio.length));
        total += penalty;
        details.push({ type: 'info', icon: '📅', text: `Maturité similaire (±6 mois) à ${overlapping.length} produit(s)`, impact: penalty, category: 'redundancy' });
      }
    }
    return { total: Math.round(total), details };
  }

  _calculateComplementarity(proposal, portfolio) {
    const details = []; let total = 0;
    if (!new Set(portfolio.map(p => p.underlyingType)).has(proposal.underlyingType)) {
      total += SCORING_WEIGHTS.NEW_UNDERLYING;
      details.push({ type: 'positive', icon: '✅', text: 'Nouveau sous-jacent absent du book — diversification', impact: SCORING_WEIGHTS.NEW_UNDERLYING, category: 'complementarity' });
    }
    if (!new Set(portfolio.map(p => p.type)).has(proposal.type)) {
      total += SCORING_WEIGHTS.NEW_PRODUCT_TYPE;
      details.push({ type: 'positive', icon: '✅', text: `Nouveau type "${this._getTypeName(proposal.type)}" absent du book`, impact: SCORING_WEIGHTS.NEW_PRODUCT_TYPE, category: 'complementarity' });
    }
    if (!new Set(portfolio.map(p => p.bankId)).has(proposal.bankId)) {
      total += SCORING_WEIGHTS.NEW_BANK;
      details.push({ type: 'positive', icon: '✅', text: 'Nouvelle contrepartie — diversification émetteur', impact: SCORING_WEIGHTS.NEW_BANK, category: 'complementarity' });
    }
    const pMat = this._parseMaturityMonths(proposal.maturity);
    if (pMat) {
      const mats = portfolio.map(p => this._parseMaturityMonths(p.maturity)).filter(Boolean).sort((a, b) => a - b);
      if (mats.length > 0) {
        const fillsGap = mats.some((m, i) => { if (i === 0) return false; return (m - mats[i-1]) > 12 && pMat > mats[i-1] && pMat < m; });
        if (fillsGap) { total += SCORING_WEIGHTS.FILLS_MATURITY_GAP; details.push({ type: 'positive', icon: '📅', text: 'Comble un trou de maturité', impact: SCORING_WEIGHTS.FILLS_MATURITY_GAP, category: 'complementarity' }); }
      }
    }
    const coupon = parseFloat(proposal.coupon?.rate) || 0;
    if (coupon > 0) {
      const avg = portfolio.reduce((s, p) => s + (parseFloat(p.coupon?.rate) || 0), 0) / portfolio.length;
      if (coupon > avg * 1.1) { total += SCORING_WEIGHTS.BETTER_YIELD_RISK; details.push({ type: 'positive', icon: '📈', text: `Coupon (${coupon}%) > moyenne du book (${avg.toFixed(1)}%)`, impact: SCORING_WEIGHTS.BETTER_YIELD_RISK, category: 'complementarity' }); }
    }
    const group = this._getCorrelationGroup(proposal.underlyingType);
    const avgCorr = portfolio.reduce((s, p) => s + this._getCorrelation(group, this._getCorrelationGroup(p.underlyingType)), 0) / portfolio.length;
    if (avgCorr < 0.4) { total += SCORING_WEIGHTS.DECORRELATION_BONUS; details.push({ type: 'positive', icon: '🔀', text: `Faible corrélation moyenne (${(avgCorr*100).toFixed(0)}%) — diversification`, impact: SCORING_WEIGHTS.DECORRELATION_BONUS, category: 'complementarity' }); }
    return { total: Math.round(total), details };
  }

  _generateVerdict(score) {
    if (score >= 80) return '🟢 Excellent candidat — forte complémentarité avec le book.';
    if (score >= 65) return '🟡 Intéressant — bonne diversification avec quelques recouvrements.';
    if (score >= 45) return '🟠 Modéré — apport limité, recouvrements significatifs.';
    if (score >= 25) return '🔴 Redondant — forte concentration, peu de valeur ajoutée.';
    return '⛔ Fortement déconseillé — duplication quasi-totale.';
  }

  _getCorrelationGroup(t) { const f = UNDERLYINGS.find(u => u.id === t); return f ? f.correlation_group : 'autre'; }
  _getCorrelation(g1, g2) { if (!g1||!g2||g1==='autre'||g2==='autre') return 0.3; return CORRELATION_MATRIX[g1]?.[g2] ?? 0.3; }
  _getTypeName(id) { const f = PRODUCT_TYPES.find(t => t.id === id); return f ? f.name : id; }
  _getBankName(id) { const f = BANKS.find(b => b.id === id); return f ? f.name : id; }
  _parseMaturityMonths(m) {
    if (!m) return null; const s = m.toString().toLowerCase();
    let r = s.match(/(\d+)\s*an/); if (r) return parseInt(r[1]) * 12;
    r = s.match(/(\d+)\s*mois/); if (r) return parseInt(r[1]);
    r = s.match(/^(\d+)$/); if (r) return parseInt(r[1]) * 12;
    return null;
  }

  // ── Coupon annualisé (SOURCE UNIQUE d'annualisation) ────────────────────────────────
  // Le coupon est stocké PAR PÉRIODE (le parser n'annualise jamais) : 3,5% semestriel = 7%/an,
  // 1,88% trimestriel = 7,52%/an. Ce helper est LA convention réutilisée partout (cockpit,
  // carte Net, comparateur, analytique) pour qu'un seul et même chiffre s'affiche.
  // frequency = annuel / in_fine / à maturité / na → déjà annualisé, on renvoie tel quel.
  annualizedCoupon(p) {
    // 1) Si le grader a déjà calculé le coupon annualisé (avec sanity-cap), on le RÉUTILISE →
    //    le rendement affiché colle exactement à la note (cohérence display ↔ grading).
    var meta = p && p.grading && p.grading.metadata;
    if (meta && meta.couponAnnualized != null) {
      var ga = parseFloat(meta.couponAnnualized);
      if (!isNaN(ga) && ga > 0) return ga;
    }
    // 2) Sinon (produit non encore noté) : annualisation par la fréquence.
    var c = (p && p.coupon) || {};
    var rate = parseFloat(typeof c === 'object' ? c.rate : c);
    if (isNaN(rate) || rate === 0) return 0;
    var freq = ((c.frequency || '') + '').toLowerCase().trim();
    if (freq.indexOf('trimestr') >= 0 || freq.indexOf('quarter') >= 0) return rate * 4;
    if (freq.indexOf('semestr') >= 0 || freq.indexOf('semi') >= 0) return rate * 2;
    if (freq.indexOf('mensuel') >= 0 || freq.indexOf('month') >= 0) return rate * 12;
    // Garde-fou : coupon mémoire à taux faible sans fréquence explicite mais libellé "trimestriel"
    if (rate <= 3 && ((c.type || '') + '').toLowerCase().indexOf('memoire') >= 0) {
      var txt = '';
      try { txt = JSON.stringify(p).toLowerCase(); } catch (e) {}
      if (txt.indexOf('trimestr') >= 0) return rate * 4;
      if (txt.indexOf('semestr') >= 0) return rate * 2;
    }
    return rate;
  }

  // ── Frais & rendement net (helpers canoniques, réutilisés dans toutes les vues) ──────
  // Frais normalisés d'un produit, en %. `documented` = true si au moins un frais est saisi.
  // `commissions` (legacy) = marge de structuration upfront. fees.{structuring,custodyAnnual,exit}.
  getProductFees(p) {
    // Frais : on lit le produit, mais on retombe sur aiParsed (toujours rempli à l'import JSON)
    // pour ne jamais afficher « 0% / non renseigné » alors que la brochure documente la marge.
    const ai = (p && p.aiParsed) || {};
    const aiFees = ai.fees || {};
    const f = (p && p.fees) || aiFees || {};
    let struct = parseFloat(f.structuring);
    if (isNaN(struct)) struct = parseFloat(aiFees.structuring);
    if (isNaN(struct)) struct = parseFloat(p && p.commissions != null ? p.commissions : ai.commissions);
    let custody = parseFloat(f.custodyAnnual);
    if (isNaN(custody)) custody = parseFloat(aiFees.custodyAnnual);
    let exit = parseFloat(f.exit);
    if (isNaN(exit)) exit = parseFloat(aiFees.exit);
    const documented = !isNaN(struct) || !isNaN(custody) || !isNaN(exit);
    return { structuring: isNaN(struct) ? 0 : struct, custodyAnnual: isNaN(custody) ? 0 : custody, exit: isNaN(exit) ? 0 : exit, documented };
  }
  // Maturité ESPÉRÉE (tient compte de l'autocall) pour amortir la marge upfront.
  // Un autocall rappelle souvent bien avant la maturité max → la marge se répartit
  // sur moins d'années → drag réel plus élevé.
  _effectiveMaturity(p) {
    const em = p && p.grading && p.grading.metadata && parseFloat(p.grading.metadata.expectedMaturity);
    if (em && em > 0) return em;
    if (typeof _estimateExpectedMaturity === 'function') {
      try { const r = _estimateExpectedMaturity(p); if (r && r.expected > 0) return r.expected; } catch (e) {}
    }
    const mm = parseFloat(p && p.maturityYears);
    return (!isNaN(mm) && mm > 0) ? mm : 5;
  }
  // Drag de frais. On distingue :
  //  • la MARGE EMBARQUÉE (commission de structuration/distribution « incluse dans le prix ») :
  //    elle ne réduit PAS le payoff contractuel — tu reçois la formule quoi qu'il arrive — mais
  //    tu SURPAYES le produit (sa juste valeur à l'émission ≈ 100% − marge).
  //  • les droits de GARDE (récurrents) : eux amputent réellement le rendement REÇU.
  // → dragPct = ce qui ampute le reçu (garde). economicDragPct = reçu + marge amortie (vue "bonne affaire").
  getFeeDrag(p) {
    const fees = this.getProductFees(p);
    const yrs = this._effectiveMaturity(p);
    const received = fees.custodyAnnual;                                   // garde (%/an) — ampute le reçu
    // Commission RÉCURRENTE « X%/an sur la durée de vie » (ex Barclays 1,5%/an × 8 ans = 12%) :
    // le chiffre stocké (12%) est un TOTAL sur la maturité MAX, PAS une marge upfront. Le vrai
    // coût annuel est plat (1,5%/an) quel que soit le moment de sortie. Sans ça, 12% amortis sur
    // ~1,5 an d'autocall = 8%/an de drag → P4 catastrophé à tort.
    // Détection ROBUSTE d'une commission RÉCURRENTE %/an (pas upfront) : flag explicite OU
    // texte de brochure (« X%/an sur la durée de vie », « rémunération annuelle », « 1,50% annuel »).
    // Le flag transitait mal (aiParsed non toujours propagé) → on lit aussi mécanisme/résumé.
    let overLife = !!(p && (p.commissionAnnualOverLife || (p.aiParsed && p.aiParsed.commissionAnnualOverLife)));
    if (!overLife && p) {
      const _ct = ((p.mechanism || '') + ' ' + (p.summary || '') + ' ' + ((p.aiParsed || {}).summary || '')).toLowerCase();
      if (/(commission|r[ée]mun[ée]ration|distribution)[^.]{0,60}(annuel|par an|%\s*\/\s*an|% annuel|sur la (base de la )?dur[ée]e de vie)/.test(_ct)
          || /(1[.,]\d+|[0-2])\s*%\s*(annuel|par an|\/an)[^.]{0,30}dur[ée]e/.test(_ct)) {
        overLife = true;
      }
    }
    const matMax = parseFloat(p && p.maturityYears) || yrs;
    let embeddedMargin, marginAnnualized;
    if (overLife && matMax > 0) {
      const annualRate = fees.structuring / matMax;                        // 12 / 8 = 1,5%/an (plat)
      marginAnnualized = annualRate;                                       // coût annuel réel (récurrent)
      embeddedMargin = annualRate * yrs;                                   // total réellement payé sur la durée espérée
    } else {
      embeddedMargin = fees.structuring;                                   // marge embarquée totale upfront (%)
      marginAnnualized = yrs > 0 ? embeddedMargin / yrs : embeddedMargin;  // amortie sur la maturité espérée
    }
    return {
      dragPct: received,                          // drag sur le rendement REÇU (garde)
      marginAnnualized,                           // marge embarquée annualisée
      embeddedMargin,                             // marge embarquée totale (surcoût)
      economicDragPct: received + marginAnnualized, // drag "valeur économique" (reçu + marge)
      documented: fees.documented, fees, years: yrs
    };
  }
  // Rendement d'un produit : brut, net d'IS, net REÇU (si coupon touché), net ÉCONOMIQUE (marge incluse).
  getNetYield(p) {
    // gross = coupon ANNUALISÉ (source unique) : un 3,5% semestriel compte pour 7%/an.
    let gross = this.annualizedCoupon(p);
    if (isNaN(gross)) gross = 0;
    const drag = this.getFeeDrag(p);
    const netExFees = gross * (1 - 0.25);
    return {
      gross, netExFees,
      netAfterFees: netExFees - drag.dragPct,           // ce que tu REÇOIS (IS + garde, PAS la marge embarquée)
      netEconomic: netExFees - drag.economicDragPct,    // vue valeur économique (marge embarquée amortie incluse)
      dragPct: drag.dragPct,
      marginAnnualized: drag.marginAnnualized,
      embeddedMargin: drag.embeddedMargin,
      economicDragPct: drag.economicDragPct,
      feesDocumented: drag.documented
    };
  }

  getPortfolioStats(portfolio) {
    if (!portfolio || portfolio.length === 0) return { total: 0, nominal: 0, avgCoupon: 0, weightedCoupon: 0, netExFees: 0, netAfterFees: 0, feeDrag: 0, feesDocumentedPct: 0, banks: 0, underlyings: 0, types: 0, concentrations: [] };
    const nominal = portfolio.reduce((s, p) => s + (parseFloat(p.investedAmount) || 0), 0);
    const avgCoupon = portfolio.reduce((s, p) => s + this.annualizedCoupon(p), 0) / portfolio.length;
    // Rendements pondérés par l'encours (le vrai chiffre de pilotage)
    let wGross = 0, wNetEx = 0, wNetAfter = 0, wDrag = 0, wMargin = 0, feesDocAmt = 0;
    portfolio.forEach(p => {
      const a = parseFloat(p.investedAmount) || 0;
      const ny = this.getNetYield(p);
      // Pilotage portefeuille : vue ÉCONOMIQUE (marge embarquée amortie incluse) = conservateur.
      wGross += ny.gross * a; wNetEx += ny.netExFees * a; wNetAfter += ny.netEconomic * a; wDrag += ny.economicDragPct * a;
      wMargin += (ny.embeddedMargin || 0) * a;
      if (ny.feesDocumented) feesDocAmt += a;
    });
    const den = nominal || 1;
    const weightedCoupon = wGross / den, netExFees = wNetEx / den, netAfterFees = wNetAfter / den, feeDrag = wDrag / den, weightedMargin = wMargin / den;
    const feesDocumentedPct = nominal > 0 ? feesDocAmt / nominal * 100 : 0;
    const concentrations = [];
    const countBy = (arr, key) => { const c = {}; arr.forEach(p => { c[p[key]] = (c[p[key]] || 0) + 1; }); return c; };
    Object.entries(countBy(portfolio, 'bankId')).forEach(([id, count]) => {
      const pct = (count / portfolio.length) * 100;
      if (pct > 30) concentrations.push({ type: 'bank', name: this._getBankName(id), pct: Math.round(pct), level: pct > 50 ? 'danger' : 'warning' });
    });
    Object.entries(countBy(portfolio, 'underlyingType')).forEach(([id, count]) => {
      const pct = (count / portfolio.length) * 100;
      if (pct > 30) { const f = UNDERLYINGS.find(u => u.id === id); concentrations.push({ type: 'underlying', name: f ? f.name : id, pct: Math.round(pct), level: pct > 50 ? 'danger' : 'warning' }); }
    });
    return { total: portfolio.length, nominal, avgCoupon, weightedCoupon, netExFees, netAfterFees, feeDrag, weightedMargin, feesDocumentedPct, banks: new Set(portfolio.map(p => p.bankId)).size, underlyings: new Set(portfolio.map(p => p.underlyingType)).size, types: new Set(portfolio.map(p => p.type)).size, concentrations };
  }
}

const scoring = new ScoringEngine();

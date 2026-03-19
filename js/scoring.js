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

  getPortfolioStats(portfolio) {
    if (!portfolio || portfolio.length === 0) return { total: 0, nominal: 0, avgCoupon: 0, banks: 0, underlyings: 0, types: 0, concentrations: [] };
    const nominal = portfolio.reduce((s, p) => s + (parseFloat(p.investedAmount) || 0), 0);
    const avgCoupon = portfolio.reduce((s, p) => s + (parseFloat(p.coupon?.rate) || 0), 0) / portfolio.length;
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
    return { total: portfolio.length, nominal, avgCoupon, banks: new Set(portfolio.map(p => p.bankId)).size, underlyings: new Set(portfolio.map(p => p.underlyingType)).size, types: new Set(portfolio.map(p => p.type)).size, concentrations };
  }
}

const scoring = new ScoringEngine();

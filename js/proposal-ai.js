// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Proposal AI Analysis & Comparison
// Auto-categorize, quick opinion, portfolio comparison
// ═══════════════════════════════════════════════════════════════

/*
  Adds to product:
  product.aiCategory = 'phoenix-mono'    // category id
  product.aiCategoryLabel = '🎯 Phoenix Mono-actif'  // display label
  product.aiOpinion = 'Bon rendement sur ENI...'  // 2-3 lines
  product.aiAnalyzedAt = '2026-03-19T16:00:00Z'
*/

const PRODUCT_CATEGORIES = [
  { id: 'phoenix-mono', label: '🎯 Phoenix Mono-actif', color: '#3B82F6' },
  { id: 'phoenix-multi', label: '🎯 Phoenix Multi-actifs', color: '#8338EC' },
  { id: 'autocall-mono', label: '⚡ Autocall Mono-actif', color: '#06D6A0' },
  { id: 'autocall-multi', label: '⚡ Autocall Multi-actifs', color: '#2EC4B6' },
  { id: 'capital-protege', label: '🛡️ Capital Protégé', color: '#4CAF50' },
  { id: 'track-taux', label: '📈 Tracker Taux', color: '#FFB74D' },
  { id: 'track-bond', label: '📊 Tracker Obligataire', color: '#FF7043' },
  { id: 'participation', label: '🚀 Participation / Tracker', color: '#E040FB' },
  { id: 'credit', label: '🏦 Crédit / CLN', color: '#78909C' },
  { id: 'autre', label: '📝 Autre', color: '#94A3B8' },
];

// ─── Auto-analyze a proposal after PDF extraction ───────
async function analyzeProposal(product) {
  if (!product) return product;

  // Build compact product summary
  const summary = [
    `Nom: ${product.name || '?'}`,
    `Type: ${product.type || '?'}`,
    `Coupon: ${product.coupon?.rate || '?'}% ${product.coupon?.frequency || ''} ${product.coupon?.type || ''} ${product.coupon?.memory ? 'm\u00e9moire' : ''}`,
    `Barri\u00e8re: ${product.capitalProtection?.barrier || 'N/A'}%`,
    `Maturit\u00e9: ${product.maturity || '?'}`,
    `Autocall: ${product.earlyRedemption?.possible ? 'oui, seuil ' + (product.earlyRedemption.trigger || '?') + '%' : 'non'}`,
    `Sous-jacent: ${(product.underlyings || []).join(', ') || '?'}`,
    `Protection: ${product.capitalProtection?.protected ? 'oui ' + (product.capitalProtection.level || '') + '%' : 'non'}`,
  ].join('\n');

  try {
    const resp = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Produit structur\u00e9:\n${summary}\n\nR\u00e9ponds en JSON strict (pas de markdown):\n{\n  "category": "<ID parmi: phoenix-mono, phoenix-multi, autocall-mono, autocall-multi, capital-protege, track-taux, track-bond, participation, credit, autre>",\n  "opinion": "<2 phrases max: ton avis sur ce produit, rendement/risque, points forts et faibles>"\n}`
        }]
      })
    });
    const data = await resp.json();
    let text = data.content?.[0]?.text || '';
    // Clean potential markdown fencing
    text = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);
    const cat = PRODUCT_CATEGORIES.find(c => c.id === parsed.category) || PRODUCT_CATEGORIES.find(c => c.id === 'autre');
    product.aiCategory = cat.id;
    product.aiCategoryLabel = cat.label;
    product.aiCategoryColor = cat.color;
    product.aiOpinion = parsed.opinion || '';
    product.aiAnalyzedAt = new Date().toISOString();
  } catch (e) {
    console.warn('AI analysis failed:', e);
    // Fallback: simple heuristic categorization
    const name = (product.name || '').toLowerCase();
    const type = (product.type || '').toLowerCase();
    if (name.includes('phoenix') || (product.coupon?.memory && type.includes('autocall'))) {
      const multi = (product.underlyings || []).length > 1;
      product.aiCategory = multi ? 'phoenix-multi' : 'phoenix-mono';
    } else if (type.includes('autocall')) {
      const multi = (product.underlyings || []).length > 1;
      product.aiCategory = multi ? 'autocall-multi' : 'autocall-mono';
    } else if (type.includes('capital') || product.capitalProtection?.protected) {
      product.aiCategory = 'capital-protege';
    } else {
      product.aiCategory = 'autre';
    }
    const cat = PRODUCT_CATEGORIES.find(c => c.id === product.aiCategory);
    product.aiCategoryLabel = cat?.label || '📝 Autre';
    product.aiCategoryColor = cat?.color || '#94A3B8';
    product.aiOpinion = '';
  }
  return product;
}

// ─── Compare all pending proposals vs portfolio ─────────
async function compareProposals() {
  const btn = document.getElementById('compare-proposals-btn');
  const box = document.getElementById('compare-proposals-box');
  if (!btn || !box) return;
  btn.disabled = true; btn.innerHTML = '⏳ Comparaison en cours...';
  box.style.display = 'block';
  box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 8px"></div>Claude compare les propositions vs votre portefeuille...</div>';

  // Gather proposals
  const allProposals = [];
  Object.entries(app.state.proposals || {}).forEach(([bankId, prods]) => {
    prods.forEach(p => {
      if (!['rejected', 'subscribed'].includes(p.status)) {
        const annRate = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
        allProposals.push({
          id: p.id,
          bankId,
          nom: (p.name || '').substring(0, 40),
          banque: BANKS_LIST.find(b => b.id === bankId)?.name || bankId,
          categorie: p.aiCategoryLabel || p.type || '?',
          coupon: annRate + '%',
          barriere: p.capitalProtection?.barrier ? p.capitalProtection.barrier + '%' : 'N/A',
          maturite: p.maturity || '?',
          autocall: p.earlyRedemption?.possible ? 'oui' : 'non',
          score: p.score?.score || null,
          opinion: p.aiOpinion || ''
        });
      }
    });
  });

  if (allProposals.length === 0) {
    box.innerHTML = '<div style="padding:16px;color:var(--text-dim);text-align:center">Aucune proposition en attente \u00e0 comparer.</div>';
    btn.disabled = false; btn.innerHTML = '\ud83e\udd16 Comparer les propositions';
    return;
  }

  // Portfolio summary
  const portfolio = (app.state.portfolio || []).filter(p => !p.archived);
  const portfolioSummary = portfolio.map(p => {
    const annRate = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
    return `${(p.name || '').substring(0, 30)}: ${formatNumber(p.investedAmount)}\u20ac, ${annRate}%/an, banque=${BANKS_LIST.find(b => b.id === p.bankId)?.name || '?'}`;
  }).join('\n');

  const prompt = `Tu es un conseiller en produits structur\u00e9s. Compare ces propositions par rapport au portefeuille existant.

PORTEFEUILLE ACTUEL (${portfolio.length} produits):
${portfolioSummary || 'Vide'}

PROPOSITIONS \u00c0 COMPARER (${allProposals.length}):
${allProposals.map((p, i) => `${i + 1}. ${p.nom} (${p.banque}) - ${p.categorie} - Coupon ${p.coupon}, barri\u00e8re ${p.barriere}, maturit\u00e9 ${p.maturite}${p.opinion ? ' - Avis: ' + p.opinion : ''}`).join('\n')}

R\u00e9ponds en JSON strict (pas de markdown):
{"ranking": [
  {"index": 1, "nom": "...", "stars": 3, "verdict": "1 phrase courte: pourquoi int\u00e9ressant ou pas vs le portefeuille"}
]}
Classe du plus int\u00e9ressant (3 \u00e9toiles) au moins int\u00e9ressant (1 \u00e9toile). Crit\u00e8res: diversification, rendement/risque, compl\u00e9mentarit\u00e9 avec l'existant.`;

  try {
    const resp = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await resp.json();
    let text = data.content?.[0]?.text || '';
    text = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);

    // Build comparison table
    const rows = (parsed.ranking || []).map(r => {
      const proposal = allProposals[r.index - 1] || allProposals.find(p => p.nom.includes(r.nom?.substring(0, 15)));
      const stars = '\u2b50'.repeat(Math.min(r.stars || 1, 3));
      const starsEmpty = '\u2606'.repeat(3 - Math.min(r.stars || 1, 3));
      const rowColor = r.stars >= 3 ? 'rgba(76,175,80,0.08)' : r.stars >= 2 ? 'rgba(255,183,77,0.05)' : 'transparent';
      return `<tr style="border-top:1px solid var(--border);background:${rowColor};cursor:pointer" ${proposal ? `onclick="app.openProduct(app._findProduct('${proposal.id}','${proposal.bankId}'))"` : ''}>
        <td style="padding:8px 12px"><div style="font-weight:600;color:var(--text-bright)">${r.nom || '?'}</div><div style="font-size:10px;color:var(--text-dim)">${proposal?.banque || ''} \u00b7 ${proposal?.categorie || ''}</div></td>
        <td style="padding:8px;text-align:center;font-family:var(--mono);color:var(--green)">${proposal?.coupon || '?'}</td>
        <td style="padding:8px;text-align:center">${proposal?.barriere || '?'}</td>
        <td style="padding:8px;text-align:center;font-size:14px">${stars}${starsEmpty}</td>
        <td style="padding:8px;font-size:11px;color:var(--text)">${r.verdict || ''}</td>
      </tr>`;
    }).join('');

    box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;font-weight:600;color:var(--text-bright)">\ud83e\udd16 Classement IA des propositions</div>
        <div style="font-size:10px;color:var(--text-dim)">vs portefeuille de ${portfolio.length} produits \u00b7 ${new Date().toLocaleDateString('fr-FR')}</div>
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr style="background:var(--bg)">
          <th style="padding:8px 12px;text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase">Proposition</th>
          <th style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px;text-transform:uppercase">Coupon</th>
          <th style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px;text-transform:uppercase">Barri\u00e8re</th>
          <th style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px;text-transform:uppercase">Note</th>
          <th style="padding:8px;text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase">Verdict IA</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  } catch (e) {
    box.innerHTML = `<div style="padding:16px;color:var(--red)">Erreur: ${e.message}</div>`;
  }
  btn.disabled = false; btn.innerHTML = '\ud83e\udd16 Comparer les propositions';
}

// ─── Render category badge on proposal card ─────────────
function renderCategoryBadge(product) {
  if (!product.aiCategoryLabel) return '';
  return `<div style="margin-top:4px;padding:3px 8px;display:inline-block;border-radius:10px;font-size:10px;font-weight:600;background:${product.aiCategoryColor || '#94A3B8'}22;color:${product.aiCategoryColor || '#94A3B8'}">${product.aiCategoryLabel}</div>`;
}

// ─── Render AI opinion on proposal card ───────────────
function renderAIOpinionBadge(product) {
  if (!product.aiOpinion) return '';
  return `<div style="margin-top:4px;padding:4px 8px;background:rgba(59,130,246,0.08);border-radius:4px;font-size:10px;color:var(--text-muted);line-height:1.4">\ud83e\udd16 ${product.aiOpinion}</div>`;
}

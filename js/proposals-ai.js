// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Proposals AI Module
// Auto-categorize + AI opinion on upload
// Compare proposals vs portfolio
// ═══════════════════════════════════════════════════════════════

const PRODUCT_CATEGORIES = [
  { id: 'autocall-mono', label: 'Autocall Action Unique', icon: '🎯', color: '#3B82F6' },
  { id: 'autocall-indice', label: 'Autocall Indice', icon: '📊', color: '#06D6A0' },
  { id: 'autocall-basket', label: 'Autocall Panier', icon: '🧺', color: '#8338EC' },
  { id: 'phoenix', label: 'Phoenix (coupon conditionnel)', icon: '🔥', color: '#FF006E' },
  { id: 'obligation', label: 'Obligation / Bond', icon: '📄', color: '#FFBE0B' },
  { id: 'taux', label: 'Produit de Taux', icon: '📈', color: '#00B4D8' },
  { id: 'participation', label: 'Participation / Tracker', icon: '🚀', color: '#E07A5F' },
  { id: 'capital-garanti', label: 'Capital Garanti', icon: '🛡️', color: '#4CAF50' },
  { id: 'autre', label: 'Autre', icon: '📋', color: '#94A3B8' },
];

// ═══ AUTO-ANALYZE after PDF upload ══════════════════════════
async function autoAnalyzeProposal(product) {
  if (!product || product._aiAnalyzed) return;

  const data = JSON.stringify({
    nom: product.name || '',
    type: product.type || '',
    coupon: product.coupon || {},
    barriere: product.capitalProtection || {},
    autocall: product.earlyRedemption || {},
    maturite: product.maturity || '',
    sousjacents: product.underlyings || [],
    resume: (product.aiSummary || '').substring(0, 500)
  });

  try {
    const resp = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 500,
        messages: [{ role: 'user', content: `Analyse ce produit structuré et réponds UNIQUEMENT en JSON valide (pas de texte avant/après):

${data}

Format exact:
{
  "category": "un parmi: autocall-mono, autocall-indice, autocall-basket, phoenix, obligation, taux, participation, capital-garanti, autre",
  "category_label": "label lisible",
  "avis_court": "1 phrase: ton avis sur le rapport rendement/risque",
  "points_forts": ["max 2 points forts courts"],
  "points_faibles": ["max 2 points faibles courts"],
  "note_risque": "1-5 (1=très sûr, 5=très risqué)",
  "note_rendement": "1-5 (1=faible, 5=excellent)"
}` }]
      })
    });
    const result = await resp.json();
    let text = result.content?.[0]?.text || '';
    // Clean JSON
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const analysis = JSON.parse(text);

    product.aiAnalysis = analysis;
    product._aiAnalyzed = true;

    // Auto-set category if detected
    if (analysis.category) {
      product.aiCategory = analysis.category;
      product.aiCategoryLabel = analysis.category_label || PRODUCT_CATEGORIES.find(c => c.id === analysis.category)?.label || analysis.category;
    }

    return analysis;
  } catch (e) {
    console.warn('Auto-analyze failed:', e);
    product._aiAnalyzed = true; // Don't retry
    return null;
  }
}

// ═══ RENDER AI ANALYSIS BADGE on proposal card ══════════════
function renderProposalAIBadge(product) {
  const a = product.aiAnalysis;
  if (!a) return '';
  const cat = PRODUCT_CATEGORIES.find(c => c.id === product.aiCategory) || PRODUCT_CATEGORIES.find(c => c.id === 'autre');
  const riskStars = '●'.repeat(parseInt(a.note_risque) || 0) + '○'.repeat(5 - (parseInt(a.note_risque) || 0));
  const yieldStars = '●'.repeat(parseInt(a.note_rendement) || 0) + '○'.repeat(5 - (parseInt(a.note_rendement) || 0));

  return `<div style="margin-top:6px;padding:6px 8px;background:${cat.color}11;border:1px solid ${cat.color}33;border-radius:4px;font-size:10px">
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
      <span>${cat.icon}</span>
      <span style="font-weight:600;color:${cat.color}">${cat.label}</span>
    </div>
    <div style="color:var(--text-muted);line-height:1.3">${a.avis_court || ''}</div>
    <div style="display:flex;gap:12px;margin-top:3px;color:var(--text-dim)">
      <span title="Risque">⚠️ ${riskStars}</span>
      <span title="Rendement">💰 ${yieldStars}</span>
    </div>
  </div>`;
}

// ═══ RENDER AI ANALYSIS SECTION on product sheet ════════════
function renderProposalAISection(product) {
  const a = product.aiAnalysis;
  if (!a) return '';
  const cat = PRODUCT_CATEGORIES.find(c => c.id === product.aiCategory) || PRODUCT_CATEGORIES.find(c => c.id === 'autre');
  const riskNum = parseInt(a.note_risque) || 3;
  const yieldNum = parseInt(a.note_rendement) || 3;

  return `<div class="fiche-section">
    <div class="fiche-section-header"><span class="fiche-section-icon">🤖</span><span class="fiche-section-title">Analyse IA du Produit</span></div>
    <div class="fiche-section-body">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:24px">${cat.icon}</span>
        <div>
          <div style="font-weight:700;color:${cat.color};font-size:14px">${cat.label}</div>
          <div style="font-size:12px;color:var(--text-muted)">${a.avis_court || ''}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px">
          <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px">Risque</div>
          <div style="display:flex;gap:3px">${Array.from({length:5}, (_,i) => `<div style="width:20px;height:8px;border-radius:2px;background:${i < riskNum ? (riskNum <= 2 ? 'var(--green)' : riskNum <= 3 ? 'var(--orange)' : 'var(--red)') : 'var(--border)'}"></div>`).join('')}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${riskNum <= 2 ? 'Faible' : riskNum <= 3 ? 'Modéré' : 'Élevé'}</div>
        </div>
        <div style="background:var(--surface);border-radius:var(--radius-sm);padding:10px">
          <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;margin-bottom:4px">Rendement</div>
          <div style="display:flex;gap:3px">${Array.from({length:5}, (_,i) => `<div style="width:20px;height:8px;border-radius:2px;background:${i < yieldNum ? 'var(--green)' : 'var(--border)'}"></div>`).join('')}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${yieldNum <= 2 ? 'Faible' : yieldNum <= 3 ? 'Correct' : 'Attractif'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${(a.points_forts || []).length > 0 ? `<div class="fiche-info-box green"><div class="fiche-info-box-title">✅ Points forts</div><div class="fiche-info-box-text">${a.points_forts.map(p => '▸ ' + p).join('<br>')}</div></div>` : ''}
        ${(a.points_faibles || []).length > 0 ? `<div class="fiche-info-box orange"><div class="fiche-info-box-title">⚠️ Points faibles</div><div class="fiche-info-box-text">${a.points_faibles.map(p => '▸ ' + p).join('<br>')}</div></div>` : ''}
      </div>
    </div>
  </div>`;
}

// ═══ COMPARE PROPOSALS — Claude ranks them vs portfolio ═════
async function compareProposals() {
  const btn = document.getElementById('compare-proposals-btn');
  const box = document.getElementById('compare-proposals-box');
  if (!btn || !box) return;
  btn.disabled = true; btn.innerHTML = '⏳ Comparaison en cours...';
  box.style.display = 'block';
  box.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 8px"></div>Claude compare vos propositions...</div>';

  const portfolio = (app.state.portfolio || []).filter(p => !p.archived);
  const allProposals = [];
  Object.entries(app.state.proposals || {}).forEach(([bankId, proposals]) => {
    proposals.forEach(p => {
      if (!['rejected', 'subscribed'].includes(p.status)) allProposals.push(p);
    });
  });

  if (allProposals.length === 0) {
    box.innerHTML = '<div style="padding:12px;color:var(--text-dim);text-align:center">Aucune proposition en attente à comparer.</div>';
    btn.disabled = false; btn.innerHTML = '🤖 Comparer les propositions';
    return;
  }

  // Compact portfolio summary
  const portfolioSummary = portfolio.map(p => {
    const r = typeof getAnnualizedRate === 'function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate) || 0);
    return `${(p.name||'').substring(0,25)}: ${formatNumber(p.investedAmount)}€, ${r}%/an, barrière ${p.capitalProtection?.barrier||'N/A'}%, ${p.maturity||''}${p.tracking?.level ? ', niveau ' + p.tracking.level + '%' : ''}`;
  }).join('\n');

  const proposalsSummary = allProposals.map((p, i) => {
    const r = parseFloat(p.coupon?.rate) || 0;
    const cat = p.aiCategory ? ` [${p.aiCategoryLabel || p.aiCategory}]` : '';
    const bank = BANKS_LIST.find(b => b.id === p.bankId)?.name || p.bankId || '?';
    return `${i+1}. ${(p.name||'').substring(0,40)}${cat} (${bank}): coupon ${r}%, barrière ${p.capitalProtection?.barrier||'N/A'}%, maturité ${p.maturity||'?'}, autocall ${p.earlyRedemption?.possible ? 'oui' : 'non'}`;
  }).join('\n');

  try {
    const resp = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 800,
        messages: [{ role: 'user', content: `Tu es conseiller en produits structurés. Compare ces propositions par rapport au portefeuille existant.

PORTEFEUILLE ACTUEL:
${portfolioSummary || 'Vide'}

PROPOSITIONS À COMPARER:
${proposalsSummary}

Classe chaque proposition de la meilleure à la pire. Pour chacune, donne:
- Un emoji verdict (🥇🥈🥉 ou ❌)
- 1 phrase: pourquoi c'est intéressant OU pas pour CE portefeuille (diversification, rendement, risque, complémentarité)

Format EXACT pour chaque ligne:
EMOJI | NOM_COURT | VERDICT_1_PHRASE

Pas de titre, pas de numéro, juste les lignes.` }]
      })
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || 'Erreur';

    // Parse lines and build table
    const lines = text.split('\n').filter(l => l.trim() && l.includes('|'));
    let tableHTML = '';
    if (lines.length > 0) {
      tableHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse">
        ${lines.map(line => {
          const parts = line.split('|').map(s => s.trim());
          const emoji = parts[0] || '';
          const name = parts[1] || '';
          const verdict = (parts[2] || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px;font-size:16px;width:30px">${emoji}</td>
            <td style="padding:8px;font-weight:600;color:var(--text-bright);white-space:nowrap">${name}</td>
            <td style="padding:8px;color:var(--text-muted)">${verdict}</td>
          </tr>`;
        }).join('')}
      </table>`;
    } else {
      tableHTML = `<div style="font-size:12px;color:var(--text);white-space:pre-line">${text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>`;
    }

    box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
      <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px">🤖 Classement IA des propositions</div>
      ${tableHTML}
      <div style="font-size:9px;color:var(--text-dim);text-align:right;margin-top:8px">Analysé le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</div>
    </div>`;
  } catch (e) {
    box.innerHTML = `<div style="color:var(--red);padding:12px">Erreur: ${e.message}</div>`;
  }
  btn.disabled = false; btn.innerHTML = '🤖 Comparer les propositions';
}

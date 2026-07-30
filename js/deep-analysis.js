// ═════════════════════════════════════════════════════════════════
// STRUCTBOARD — Deep Analysis V1 — Market-enriched AI analysis
// Uses data/market/index.json (synced 2x/day from stock-analysis-platform)
// ═════════════════════════════════════════════════════════════════

let _marketIndex = null;

// ═══ 1. LOAD MARKET INDEX ════════════════════════════════════════
async function loadMarketIndex() {
  if (_marketIndex) return _marketIndex;
  try {
    const url = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${CONFIG.BRANCH}/data/market/index.json?t=${Date.now()}`;
    const r = await fetch(url);
    if (r.ok) {
      _marketIndex = await r.json();
      console.log(`[DeepAnalysis] Market index loaded: ${_marketIndex.stocks_count} stocks, ${_marketIndex.markets_count} indices`);
    }
  } catch (e) { console.warn('[DeepAnalysis] Failed to load market index:', e); }
  return _marketIndex;
}

// ═══ 2. MATCH UNDERLYINGS ═══════════════════════════════════════
const TICKER_ALIASES = {
  'DANONE': 'BN', 'BN SA': 'BN', 'DANONE SA': 'BN',
  'ENI SPA': 'ENI', 'ENI S.P.A.': 'ENI',
  'TOTALENERGIES': 'TTE', 'TOTAL': 'TTE',
  'BNP PARIBAS': 'BNP', 'SOCIETE GENERALE': 'GLE', 'CREDIT AGRICOLE': 'ACA',
  'LVMH': 'MC', 'AIRBUS': 'AIR', 'SANOFI': 'SAN', 'LOREAL': 'OR', "L'OREAL": 'OR',
  'ASML': 'ASML', 'SCHNEIDER': 'SU', 'SCHNEIDER ELECTRIC': 'SU',
  'EUROSTOXX 50': 'FEZ', 'EURO STOXX 50': 'FEZ', 'EUROSTOXX50': 'FEZ',
  'CAC 40': 'EWQ', 'CAC40': 'EWQ', 'S&P 500': 'SPY', 'SP500': 'SPY',
  'NASDAQ': 'QQQ', 'NASDAQ 100': 'QQQ', 'FTSE 100': 'EWU',
  'NIKKEI': 'EWJ', 'NIKKEI 225': 'EWJ', 'DAX': 'EWG',
};

function matchUnderlying(name) {
  if (!_marketIndex || !name) return null;
  const upper = name.toUpperCase().trim();

  // Direct ticker match
  if (_marketIndex.stocks[upper]) return { type: 'stock', ticker: upper, data: _marketIndex.stocks[upper] };
  if (_marketIndex.markets[upper]) return { type: 'market', ticker: upper, data: _marketIndex.markets[upper] };

  // Alias match
  const alias = TICKER_ALIASES[upper];
  if (alias) {
    if (_marketIndex.stocks[alias]) return { type: 'stock', ticker: alias, data: _marketIndex.stocks[alias] };
    if (_marketIndex.markets[alias]) return { type: 'market', ticker: alias, data: _marketIndex.markets[alias] };
  }

  // Fuzzy: search by name in stocks
  for (const [ticker, stock] of Object.entries(_marketIndex.stocks)) {
    if (stock.name && stock.name.toUpperCase().includes(upper)) return { type: 'stock', ticker, data: stock };
    if (upper.includes(ticker)) return { type: 'stock', ticker, data: stock };
  }

  // Rate-based products
  if (/TEC|CMS|EURIBOR|OAT|BUND|TAUX/i.test(upper)) return { type: 'rate', ticker: upper, data: null };

  return null;
}

function getProductUnderlyings(product) {
  const results = [];
  const names = product.underlyings || product.aiParsed?.underlyings || [];
  // Also try extracting from product name
  const nameTokens = (product.name || '').split(/[\s\-_]+/).filter(t => t.length >= 2);

  const tried = new Set();
  for (const n of [...names, ...nameTokens]) {
    const key = n.toUpperCase().trim();
    if (tried.has(key) || key.length < 2) continue;
    tried.add(key);
    const match = matchUnderlying(n);
    if (match) results.push(match);
  }
  return results;
}

// ═══ 3. GET MARKET CONTEXT ══════════════════════════════════════
function getMarketContext(underlyingData) {
  if (!_marketIndex?.markets || !underlyingData) return null;
  const country = underlyingData.data?.country || '';
  const COUNTRY_INDEX = { 'France': 'EWQ', 'Italie': 'EWI', 'Allemagne': 'EWG', 'Royaume-Uni': 'EWU', 'Espagne': 'EWP', 'Pays-Bas': 'EWN', 'Suisse': 'EWL' };
  const idxSymbol = COUNTRY_INDEX[country];
  const idx = idxSymbol ? _marketIndex.markets[idxSymbol] : null;
  const euZone = _marketIndex.markets['FEZ'] || null;
  return { countryIndex: idx, eurozone: euZone, countryName: country };
}

// ═══ 4. BUILD ENRICHED PROMPT ═══════════════════════════════════
function buildDeepAnalysisPrompt(product, underlyings, portfolio) {
  const amount = parseFloat(product.investedAmount) || 0;
  const couponRate = parseFloat(product.coupon?.rate) || 0;
  const barrier = parseFloat(product.capitalProtection?.barrier) || 0;
  const maturity = product.maturity || '?';
  const autocall = product.earlyRedemption?.possible ? 'oui, seuil ' + (product.earlyRedemption.trigger || '100') + '%' : 'non';
  const couponType = product.coupon?.type || 'conditionnel';
  const memory = product.coupon?.memory ? 'oui' : 'non';

  let underlyingText = '';
  for (const u of underlyings) {
    if (u.type === 'stock' && u.data) {
      const d = u.data;
      const mkt = getMarketContext(u);
      underlyingText += `\nSOUS-JACENT: ${u.ticker} (${d.name})\n`;
      underlyingText += `• Buffett: ${d.buffett_score}/100 (${d.buffett_grade}) | Quality: ${d.quality_score}/100 (${d.quality_grade})`;
      if (d.quality_subscores) underlyingText += ` | Safety: ${d.quality_subscores.safety}, Value: ${d.quality_subscores.value}, Growth: ${d.quality_subscores.growth}`;
      underlyingText += `\n• ROE: ${d.roe}% | Dette/Equity: ${d.de_ratio} | Marge nette: ${d.net_margin}%`;
      underlyingText += `\n• Beta: ${d.beta} | Volatilité 3Y: ${d.volatility_3y}% | Max drawdown 3Y: ${d.max_dd_3y}%`;
      underlyingText += `\n• Perf YTD: ${d.perf_ytd>0?'+':''}${d.perf_ytd}% | 1Y: ${d.perf_1y>0?'+':''}${d.perf_1y}% | Distance 52w high: ${d.distance_52w_high}%`;
      underlyingText += `\n• PE: ${d.pe_ratio} | FCF yield: ${d.fcf_yield}% | Dividende: ${d.dividend_yield}%`;
      underlyingText += `\n• Secteur: ${d.sector} | Pays: ${d.country}`;
      if (mkt?.countryIndex) underlyingText += `\n• Indice ${mkt.countryName} (${mkt.countryIndex.name}): YTD ${mkt.countryIndex.ytd>0?'+':''}${mkt.countryIndex.ytd?.toFixed(1)}% | 52w ${mkt.countryIndex.w52>0?'+':''}${mkt.countryIndex.w52?.toFixed(1)}%`;
      if (mkt?.eurozone) underlyingText += `\n• Zone Euro (STOXX 50): YTD ${mkt.eurozone.ytd>0?'+':''}${mkt.eurozone.ytd?.toFixed(1)}%`;
    } else if (u.type === 'market' && u.data) {
      underlyingText += `\nSOUS-JACENT INDICE: ${u.ticker} (${u.data.name})\n`;
      underlyingText += `• Valeur: ${u.data.value} | YTD: ${u.data.ytd>0?'+':''}${u.data.ytd?.toFixed(1)}% | 3M: ${u.data.m3>0?'+':''}${u.data.m3?.toFixed(1)}% | 52w: ${u.data.w52>0?'+':''}${u.data.w52?.toFixed(1)}%`;
    } else if (u.type === 'rate') {
      underlyingText += `\nSOUS-JACENT TAUX: ${u.ticker} (pas de données marché disponibles — analyse qualitative)\n`;
    }
  }

  if (!underlyingText) underlyingText = '\nSOUS-JACENT: Non identifié dans l\'index marché — analyse basée sur les données produit uniquement.\n';

  // Portfolio context
  const active = (portfolio || []).filter(p => !p.archived);
  const totalInvested = active.reduce((s, p) => s + (parseFloat(p.investedAmount) || 0), 0);
  const bankMap = {};
  active.forEach(p => { const b = BANKS_LIST.find(x => x.id === p.bankId)?.name || '?'; bankMap[b] = (bankMap[b] || 0) + (parseFloat(p.investedAmount) || 0); });
  const topBank = Object.entries(bankMap).sort((a, b) => b[1] - a[1])[0];
  const avgCoupon = active.length > 0 ? (active.reduce((s, p) => s + (parseFloat(p.coupon?.rate) || 0), 0) / active.length).toFixed(1) : 0;

  // CAT comparison
  const bestCATRate = typeof catManager !== 'undefined' ? (catManager.rates?.rates || []).reduce((max, r) => r.rate > max ? r.rate : max, 0) : 0;

  const portfolioText = totalInvested > 0
    ? `\nPORTEFEUILLE (${active.length} produits, ${formatNumber(totalInvested)}€):\n• Coupon moyen: ${avgCoupon}%\n• Concentration: ${topBank ? topBank[0] + ' ' + Math.round(topBank[1]/totalInvested*100) + '%' : 'N/A'}\n• Meilleur CAT: ${bestCATRate}%`
    : '';

  return `Tu es analyste produits structurés. Analyse ce produit avec les données marché réelles fournies.

PRODUIT: ${product.name || '?'}
• Type: ${product.aiCategoryLabel || product.type || '?'}
• Coupon: ${couponRate}% ${couponType}${memory === 'oui' ? ' (mémoire)' : ''}
• Barrière: ${barrier > 0 ? barrier + '%' : 'N/A'}
• Maturité: ${maturity}
• Autocall: ${autocall}
• Montant investi: ${amount > 0 ? formatNumber(amount) + '€' : 'Non défini'}
${underlyingText}${portfolioText}

Réponds UNIQUEMENT en JSON strict (pas de markdown, pas de texte avant/après):
{
  "risk_score": <1-10>,
  "risk_breakdown": { "underlying": <1-10>, "barrier": <1-10>, "issuer": <1-10>, "complexity": <1-10> },
  "scenarios": {
    "optimistic": { "label": "<ex: Autocall S4>", "return_pct": <number>, "return_eur": <number>, "probability": "<Élevée/Moyenne/Faible>" },
    "base": { "label": "<ex: Coupons 3 ans>", "return_pct": <number>, "return_eur": <number>, "probability": "<Élevée/Moyenne/Faible>" },
    "stress": { "label": "<ex: Barrière approchée>", "return_pct": <number>, "return_eur": <number>, "probability": "<Élevée/Moyenne/Faible>" },
    "worst": { "label": "<ex: Barrière touchée>", "return_pct": <number>, "return_eur": <number>, "probability": "<Élevée/Moyenne/Faible>" }
  },
  "vs_cat": { "cat_rate": ${bestCATRate}, "product_tra_expected": <number>, "risk_premium": <number>, "verdict": "<1 phrase>" },
  "underlying_verdict": "<1-2 phrases sur la qualité fondamentale du sous-jacent>",
  "alerts": [ { "type": "<danger/warning/info/positive>", "text": "<1 phrase>" } ],
  "summary": "<2-3 phrases de synthèse globale>"
}`;
}

// ═══ 5. RUN DEEP ANALYSIS ═══════════════════════════════════════
async function runDeepAnalysis(product) {
  await loadMarketIndex();
  const underlyings = getProductUnderlyings(product);
  const prompt = buildDeepAnalysisPrompt(product, underlyings, app.state.portfolio);

  const resp = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
  });
  if (!resp.ok) throw new Error('IA: ' + resp.status);
  const data = await resp.json();
  let text = (data.content || []).map(b => b.text || '').join('');
  text = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  const analysis = JSON.parse(text);
  analysis._underlyings = underlyings.map(u => ({ ticker: u.ticker, type: u.type, name: u.data?.name || u.ticker }));
  analysis._timestamp = new Date().toISOString();
  analysis._marketDataDate = _marketIndex?.timestamp || null;
  return analysis;
}

// ═══ 6. RENDER ANALYSIS HTML ════════════════════════════════════
function renderDeepAnalysisHTML(analysis, product) {
  if (!analysis) return '';
  const a = analysis;
  const amount = parseFloat(product.investedAmount) || 0;

  // Risk score color
  const riskColor = a.risk_score <= 3 ? '#4CAF50' : a.risk_score <= 5 ? '#FFB74D' : a.risk_score <= 7 ? '#FF7043' : '#E53935';
  const riskLabel = a.risk_score <= 3 ? 'Faible' : a.risk_score <= 5 ? 'Modéré' : a.risk_score <= 7 ? 'Élevé' : 'Critique';

  // Risk bar helper
  const riskBar = (label, value) => {
    const c = value <= 3 ? '#4CAF50' : value <= 5 ? '#FFB74D' : value <= 7 ? '#FF7043' : '#E53935';
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="font-size:10px;color:var(--text-dim);width:80px">${label}</span>
      <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${value*10}%;height:100%;background:${c};border-radius:3px"></div></div>
      <span style="font-size:10px;font-weight:600;color:${c};width:20px;text-align:right">${value}</span>
    </div>`;
  };

  // Scenario card helper
  const scenarioCard = (icon, label, s, bgColor) => {
    if (!s) return '';
    const eurStr = s.return_eur >= 0 ? '+' + formatNumber(s.return_eur) + '€' : formatNumber(s.return_eur) + '€';
    const pctStr = s.return_pct >= 0 ? '+' + s.return_pct.toFixed(1) + '%' : s.return_pct.toFixed(1) + '%';
    const pColor = s.return_pct >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div style="background:${bgColor};border-radius:var(--radius-sm);padding:10px;text-align:center">
      <div style="font-size:14px;margin-bottom:4px">${icon}</div>
      <div style="font-size:10px;font-weight:600;color:var(--text-bright);margin-bottom:2px">${s.label || label}</div>
      <div style="font-size:16px;font-weight:800;color:${pColor};font-family:var(--mono)">${eurStr}</div>
      <div style="font-size:10px;color:var(--text-dim)">${pctStr} · ${s.probability || '?'}</div>
    </div>`;
  };

  // Underlying badges
  const ulBadges = (a._underlyings || []).map(u => {
    const c = u.type === 'stock' ? 'var(--accent)' : u.type === 'market' ? 'var(--purple)' : 'var(--orange)';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${c}15;color:${c};border:1px solid ${c}30;margin-right:4px">${u.ticker} ${u.type === 'stock' ? '📊' : u.type === 'market' ? '🌐' : '📈'}</span>`;
  }).join('');

  // Alerts
  const alertColors = { danger: { bg: 'rgba(229,57,53,0.08)', border: '#E53935', icon: '🔴' }, warning: { bg: 'rgba(255,183,77,0.08)', border: '#FFB74D', icon: '⚠️' }, info: { bg: 'rgba(100,181,246,0.08)', border: '#64B5F6', icon: 'ℹ️' }, positive: { bg: 'rgba(76,175,80,0.08)', border: '#4CAF50', icon: '✅' } };
  const alertsHTML = (a.alerts || []).map(al => {
    const ac = alertColors[al.type] || alertColors.info;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:${ac.bg};border-left:3px solid ${ac.border};border-radius:0 var(--radius-sm) var(--radius-sm) 0;margin-bottom:4px;font-size:11px;color:var(--text)">${ac.icon} ${al.text}</div>`;
  }).join('');

  // vs CAT
  const vsCat = a.vs_cat || {};
  const catBarW = Math.min(100, (vsCat.cat_rate || 0) / Math.max(vsCat.product_tra_expected || 1, 1) * 100);

  // Timestamp
  const ts = a._timestamp ? new Date(a._timestamp) : null;
  const tsStr = ts ? ts.toLocaleDateString('fr-FR') + ' ' + ts.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

  return `<div class="fiche-section" style="border:1px solid rgba(139,92,246,0.2);background:linear-gradient(135deg,rgba(139,92,246,0.03),rgba(59,130,246,0.03))">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">🧠</span>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text-bright)">Analyse approfondie</div>
          <div style="font-size:10px;color:var(--text-dim)">${tsStr} · Données marché ${a._marketDataDate ? new Date(a._marketDataDate).toLocaleDateString('fr-FR') : '?'}</div>
        </div>
      </div>
      <button class="btn sm" onclick="triggerDeepAnalysis('${product.id}','${product.bankId||''}')" style="font-size:10px">🔄 Actualiser</button>
    </div>

    <!-- SOUS-JACENTS -->
    <div style="margin-bottom:12px">${ulBadges || '<span style="font-size:10px;color:var(--text-dim)">Sous-jacent non identifié</span>'}</div>

    <!-- RISK SCORE + BREAKDOWN -->
    <div style="display:grid;grid-template-columns:120px 1fr;gap:16px;margin-bottom:16px">
      <div style="text-align:center;padding:12px;background:var(--bg-card);border-radius:var(--radius-sm);border:2px solid ${riskColor}">
        <div style="font-size:32px;font-weight:900;color:${riskColor};font-family:var(--mono)">${a.risk_score}</div>
        <div style="font-size:10px;color:${riskColor};font-weight:600">/10 • ${riskLabel}</div>
      </div>
      <div style="padding:8px 0">
        ${a.risk_breakdown ? riskBar('Sous-jacent', a.risk_breakdown.underlying) + riskBar('Barrière', a.risk_breakdown.barrier) + riskBar('Emetteur', a.risk_breakdown.issuer) + riskBar('Complexité', a.risk_breakdown.complexity) : ''}
      </div>
    </div>

    <!-- SCENARIOS -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;margin-bottom:8px">Scénarios${amount > 0 ? ' (sur ' + formatNumber(amount) + '€)' : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${scenarioCard('🟢', 'Optimiste', a.scenarios?.optimistic, 'rgba(76,175,80,0.06)')}
        ${scenarioCard('🟡', 'Base', a.scenarios?.base, 'rgba(255,183,77,0.06)')}
        ${scenarioCard('🟠', 'Stress', a.scenarios?.stress, 'rgba(255,112,67,0.06)')}
        ${scenarioCard('🔴', 'Pire', a.scenarios?.worst, 'rgba(229,57,53,0.06)')}
      </div>
    </div>

    <!-- VS CAT -->
    ${vsCat.cat_rate ? `<div style="margin-bottom:16px;padding:10px;background:var(--bg-card);border-radius:var(--radius-sm)">
      <div style="font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;margin-bottom:6px">Rendement vs CAT sans risque</div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px"><span style="color:var(--green)">CAT ${vsCat.cat_rate}%</span><span style="color:var(--purple)">Produit ~${vsCat.product_tra_expected}%</span></div>
          <div style="height:8px;background:var(--green);border-radius:4px;position:relative;overflow:visible">
            <div style="position:absolute;left:0;top:0;height:100%;width:100%;background:var(--purple);border-radius:4px"></div>
            <div style="position:absolute;left:0;top:0;height:100%;width:${catBarW}%;background:var(--green);border-radius:4px;z-index:1"></div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:16px;font-weight:800;color:var(--cyan);font-family:var(--mono)">+${(vsCat.risk_premium || 0).toFixed(1)}%</div>
          <div style="font-size:9px;color:var(--text-dim)">prime de risque</div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${vsCat.verdict || ''}</div>
    </div>` : ''}

    <!-- UNDERLYING VERDICT -->
    ${a.underlying_verdict ? `<div style="margin-bottom:12px;padding:8px 12px;background:rgba(59,130,246,0.05);border-radius:var(--radius-sm);font-size:11px;color:var(--text)">📊 ${a.underlying_verdict}</div>` : ''}

    <!-- ALERTS -->
    ${alertsHTML ? `<div style="margin-bottom:12px">${alertsHTML}</div>` : ''}

    <!-- SUMMARY -->
    ${a.summary ? `<div style="padding:10px 12px;background:rgba(139,92,246,0.05);border-radius:var(--radius-sm);font-size:12px;line-height:1.5;color:var(--text-bright);font-weight:500">${a.summary}</div>` : ''}
  </div>`;
}

// ═══ 7. TRIGGER FROM UI ═════════════════════════════════════════
async function triggerDeepAnalysis(productId, bankId) {
  const product = app._findProduct(productId, bankId);
  if (!product) return;

  const container = document.getElementById('deep-analysis-container');
  if (container) container.innerHTML = `<div class="fiche-section" style="text-align:center;padding:30px"><div class="spinner" style="margin:0 auto 8px"></div><div style="color:var(--text-muted);font-size:12px">🧠 Analyse en cours... données marché + IA</div></div>`;

  try {
    const analysis = await runDeepAnalysis(product);
    product.aiDeepAnalysis = analysis;

    // Save to product file
    if (product.bankId) {
      try { await app._saveProductFile(product.bankId, product); } catch (e) {}
    }
    // Also update portfolio if in portfolio
    const pItem = (app.state.portfolio || []).find(p => p.id === product.id);
    if (pItem) {
      pItem.aiDeepAnalysis = analysis;
      try { await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, app.state.portfolio, `[StructBoard] Deep analysis: ${product.name || product.id}`); } catch (e) {}
    }

    if (container) container.innerHTML = renderDeepAnalysisHTML(analysis, product);
    showToast('Analyse terminée', 'success');
  } catch (e) {
    console.error('[DeepAnalysis] Error:', e);
    if (container) container.innerHTML = `<div class="fiche-section" style="color:var(--red);padding:16px">❌ Erreur: ${e.message}</div>`;
    showToast('Erreur analyse: ' + e.message, 'error');
  }
}

// ═══ 8. INJECT INTO PRODUCT SHEET ═══════════════════════════════
function injectDeepAnalysis(container, product) {
  const sm = container.querySelector('.sheet-main');
  if (!sm) return;

  // Create container
  const div = document.createElement('div');
  div.id = 'deep-analysis-container';

  // If already analyzed, show saved result
  if (product.aiDeepAnalysis) {
    div.innerHTML = renderDeepAnalysisHTML(product.aiDeepAnalysis, product);
  } else {
    // Show button to trigger
    div.innerHTML = `<div class="fiche-section" style="border:1px dashed rgba(139,92,246,0.3);background:rgba(139,92,246,0.03);text-align:center;padding:20px">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">🧠 Analyse approfondie avec données marché réelles</div>
      <div style="font-size:10px;color:var(--text-dim);margin-bottom:12px">Scénarios chiffrés · Score Buffett/Quality · Comparaison CAT · Alertes</div>
      <button class="btn ai-glow" onclick="triggerDeepAnalysis('${product.id}','${product.bankId||''}')"
        style="background:var(--purple);color:white;border:none;padding:8px 24px">
        🧠 Lancer l'analyse
      </button>
    </div>`;
  }

  // Insert after tracking section or at the top of sheet-main
  const trackingSection = sm.querySelector('.fiche-section');
  if (trackingSection) {
    trackingSection.after(div);
  } else {
    sm.prepend(div);
  }
}

// Load market index on startup
loadMarketIndex();

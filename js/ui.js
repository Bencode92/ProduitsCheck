// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — UI Rendering (V3.1 — JSON paste in upload modal)
// V3.1: Added "📋 Coller JSON" option in upload modal
// ═══════════════════════════════════════════════════════════════

function renderApp(state) { const main = document.getElementById('main-content'); if (!main) return; switch(state.view) { case 'dashboard': renderDashboard(main,state); break; case 'product-sheet': renderProductSheet(main,state); break; case 'chat': renderChat(main,state); break; } }

// ═══ DASHBOARD ═══
// ── Cockpit exécutif : bandeau de synthèse 5 secondes, réutilisé en tête des 3 vues ──
function renderExecCockpit(opts) {
  opts = opts || {};
  const portfolio = (typeof app !== 'undefined' && app.state && app.state.portfolio) ? app.state.portfolio : [];
  if (!portfolio.length) return '';
  const stats = scoring.getPortfolioStats(portfolio);
  // Duration pondérée
  let durNum = 0, durDen = 0;
  portfolio.forEach(p => { const a = parseFloat(p.investedAmount) || 0; const y = parseFloat(p.maturityYears) || 0; if (a > 0 && y > 0) { durNum += a * y; durDen += a; } });
  const duration = durDen ? durNum / durDen : 0;
  const feeCostYr = stats.nominal * stats.feeDrag / 100;
  // Marge barrière la plus tendue (distance niveau actuel ↔ barrière)
  let tightest = null;
  portfolio.forEach(p => { const lvl = parseFloat(p.tracking?.level); const bar = parseFloat(p.capitalProtection?.barrier); if (!isNaN(lvl) && !isNaN(bar) && bar > 0) { const m = lvl - bar; if (tightest === null || m < tightest) tightest = m; } });
  // Top risque (clignotant)
  let risk = { label: 'RAS', color: 'var(--green)', danger: false };
  const danger = stats.concentrations.find(c => c.level === 'danger');
  const warn = stats.concentrations.find(c => c.level === 'warning');
  if (danger) risk = { label: 'Concentration ' + danger.name + ' ' + danger.pct + '%', color: 'var(--red)', danger: true };
  else if (tightest !== null && tightest < 10) risk = { label: 'Barrière tendue ' + tightest.toFixed(0) + ' pts', color: 'var(--red)', danger: true };
  else if (warn) risk = { label: 'Concentration ' + warn.name + ' ' + warn.pct + '%', color: 'var(--orange)', danger: false };
  else if (stats.feesDocumentedPct < 50) risk = { label: 'Frais à documenter (' + Math.round(stats.feesDocumentedPct) + '%)', color: 'var(--orange)', danger: false };

  const tile = (label, value, sub, color) =>
    `<div style="flex:1;min-width:130px;padding:0 16px;border-left:1px solid var(--border)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted)">${label}</div>
      <div style="font-family:var(--mono);font-size:21px;font-weight:800;color:${color || 'var(--text-bright)'};line-height:1.15;margin-top:2px">${value}</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:1px">${sub}</div>
    </div>`;
  const dot = risk.danger ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + risk.color + ';margin-right:5px;animation:qlpulse 1.2s ease-in-out infinite"></span>' : '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + risk.color + ';margin-right:5px"></span>';

  return `<style>@keyframes qlpulse{0%,100%{opacity:1}50%{opacity:.25}}</style>
    <div style="display:flex;align-items:stretch;flex-wrap:wrap;gap:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 6px;margin-bottom:16px;box-shadow:var(--shadow)">
      <div style="display:flex;align-items:center;padding:0 14px 0 12px;font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-left:0">🎯 Cockpit</div>
      ${tile('AUM', formatNumber(stats.nominal) + '€', stats.banks + ' contreparties', 'var(--text-bright)')}
      ${tile('Rdt net pondéré', formatPct(stats.netAfterFees), formatPct(stats.weightedCoupon) + ' brut · net IS+frais', stats.netAfterFees > 0 ? 'var(--green)' : 'var(--red)')}
      ${tile('Duration moy.', duration.toFixed(1) + ' a', stats.total + ' lignes', 'var(--purple)')}
      ${tile('Coût frais / an', '−' + formatNumber(Math.round(feeCostYr)) + '€', stats.feesDocumentedPct < 80 ? '⚠ frais ' + Math.round(stats.feesDocumentedPct) + '%' : 'documenté', feeCostYr > 0 ? 'var(--orange)' : 'var(--text-dim)')}
      <div style="flex:1.3;min-width:150px;padding:0 16px;border-left:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted)">Top risque</div>
        <div style="font-size:13px;font-weight:700;color:${risk.color};line-height:1.25;margin-top:4px">${dot}${risk.label}</div>
      </div>
    </div>`;
}
window.renderExecCockpit = renderExecCockpit;

function renderDashboard(container, state) {
  const stats = scoring.getPortfolioStats(state.portfolio);
  const allProposalsCount = Object.values(state.proposals).reduce((s, arr) => s + arr.length, 0);
  const pendingCount = Object.values(state.proposals).reduce((s, arr) => s + arr.filter(p => !['rejected','subscribed'].includes(p.status)).length, 0);
  // Liquidités mobilisables (produits classés cash) + prochaine échéance
  const cashAvail = state.portfolio.reduce((s, p) => s + ((p.grading && p.grading.grade === '-') ? (parseFloat(p.investedAmount) || 0) : 0), 0);
  const _now = new Date();
  let _nextDate = null;
  state.portfolio.forEach(p => { const d = p.maturityDate ? new Date(p.maturityDate) : null; if (d && !isNaN(d) && d > _now && (!_nextDate || d < _nextDate)) _nextDate = d; });
  const nextDays = _nextDate ? Math.round((_nextDate - _now) / 864e5) : null;
  const nextSub = _nextDate ? _nextDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'aucune';
  container.innerHTML = `
    ${renderExecCockpit()}
    <div class="stats-row">
      <div class="stat-card blue"><div class="stat-label">Portefeuille</div><div class="stat-value">${stats.total}</div><div class="stat-sub">produits actifs</div></div>
      <div class="stat-card green"><div class="stat-label">Liquidités à investir</div><div class="stat-value">${formatNumber(cashAvail)}€</div><div class="stat-sub">cash mobilisable</div></div>
      <div class="stat-card orange"><div class="stat-label">Prochaine échéance</div><div class="stat-value">${nextDays != null ? nextDays + ' j' : '—'}</div><div class="stat-sub">${nextSub}</div></div>
      <div class="stat-card purple"><div class="stat-label">Propositions</div><div class="stat-value">${pendingCount}</div><div class="stat-sub">${allProposalsCount} total reçues</div></div>
      <div class="stat-card cyan"><div class="stat-label">Sous-jacents</div><div class="stat-value">${stats.underlyings}</div><div class="stat-sub">${stats.types} types de structure</div></div>
    </div>
    ${stats.concentrations.length > 0 ? `<div class="alert-bar"><span>⚠️</span><span>Concentrations: ${stats.concentrations.map(c=>`<strong>${c.name}</strong> (${c.pct}%)`).join(', ')}</span></div>` : ''}
    <div class="section">
      <div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>Mon Portefeuille</div><div style="display:flex;gap:6px">${(state.portfolio.length + Object.keys(state.proposals).length) ? `<button class="btn sm" onclick="showProductComparison()">📊 Comparer</button>` : ''}<button class="btn primary" onclick="showAddPortfolioModal()">+ Ajouter un produit</button></div></div>
      ${state.portfolio.length ? _sbControls() : ''}
      ${state.portfolio.length === 0 ? `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">Aucun produit en portefeuille</div><div class="empty-sub">Ajoutez votre premier produit structuré</div></div>` : `<div class="portfolio-grid">${_sbApply(state.portfolio).map(p => renderProductCard(p,'portfolio')).join('')}</div>`}
    </div>
    <div class="section">
      <div class="section-header"><div class="section-title"><span class="dot" style="background:var(--orange)"></span>Propositions${_sbActive() ? ' — vue à plat (tri actif)' : ' par Banque'}</div><button class="btn primary" onclick="showAddProposalModal()">+ Nouvelle proposition</button></div>
      ${!state.portfolio.length && Object.keys(state.proposals).length ? _sbControls() : ''}
      ${_sbActive()
        ? `<div class="portfolio-grid">${_sbApply(Object.values(state.proposals).reduce((a,b)=>a.concat(b),[])).map(p => renderProductCard(p,'proposal')).join('')}</div>`
        : `<div class="banks-container">${renderBankSections(state)}</div>`}
      ${Object.keys(state.proposals).length === 0 ? `<div class="empty-state"><div class="empty-icon">📨</div><div class="empty-text">Aucune proposition</div><div class="empty-sub">Ajoutez les offres des banques</div></div>` : ''}
    </div>`;
}

// ═══ StructBoard quick-wins : badges de risque, tri/filtre, négociation ═══
var _GRADE_RANK = { A: 0, B: 1, C: 2, D: 3, F: 4 };
function _gradeRank(g) { return _GRADE_RANK[g] != null ? _GRADE_RANK[g] : 9; }

// Drapeaux de risque en badge sur la carte (données déjà calculées ailleurs)
function _cardRiskBadges(p) {
  var b = [];
  var cp = p.capitalProtection || {};
  var ny = (typeof scoring !== 'undefined' && scoring.getNetYield) ? scoring.getNetYield(p) : {};
  var mk = function (t, danger) { b.push([t, danger ? '#B91C1C' : '#B45309', danger ? '#FEE2E2' : '#FEF3C7']); };
  if (cp.guaranteeType === 'garantie') b.push(['✓ Garanti', '#047857', '#D1FAE5']);
  else if (cp.protected === true || cp.protected === 'true' || cp.guaranteeType === 'formule') b.push(['🛡 Protégé éch.', '#B45309', '#FEF3C7']);
  else if (cp.barrier || cp.protected === false) mk('⚠ Capital risqué', true);
  var bar = parseFloat(cp.barrier);
  if (!isNaN(bar) && bar > 0 && bar <= 60) mk('Barr. ' + bar + '%', true);
  var dec = parseFloat(p.decrementPct != null ? p.decrementPct : (p.aiParsed && p.aiParsed.decrementPct));
  if (!isNaN(dec) && dec > 0) mk('📉 Décr. ' + String(dec).replace('.', ',') + '%', true);
  var isIC = (typeof window._isIssuerCallable === 'function' && window._isIssuerCallable(p)) || (p.earlyRedemption && p.earlyRedemption.atIssuerDiscretion === true);
  if (isIC) mk('⚖ Call émetteur', false);
  var m = ny.embeddedMargin || 0;
  if (m >= 8) mk('💸 Marge ' + m.toFixed(1).replace('.', ',') + '%', true);
  else if (m >= 4) mk('💸 Marge ' + m.toFixed(1).replace('.', ',') + '%', false);
  if (p.underlyingHistorySimulated === true || (p.aiParsed && p.aiParsed.underlyingHistorySimulated === true)) mk('🚩 Indice simulé', true);
  if (!b.length) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">' + b.slice(0, 5).map(function (x) {
    return '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:5px;color:' + x[1] + ';background:' + x[2] + '">' + x[0] + '</span>';
  }).join('') + '</div>';
}

// ── Tri / filtre de la liste (état global + contrôles) ──
window._sbSort = window._sbSort || 'default';
window._sbFilter = window._sbFilter || 'all';
function _sbSet(k, v) { if (k === 'sort') window._sbSort = v; else window._sbFilter = v; if (window.app && app.render) app.render(); }
function _sbSortValue(p, key) {
  var g = p.grading || {};
  var ny = (typeof scoring !== 'undefined' && scoring.getNetYield) ? scoring.getNetYield(p) : {};
  switch (key) {
    case 'grade': return _gradeRank(g.grade);
    case 'net': return -((ny.netEconomic != null) ? ny.netEconomic : -999);
    case 'margin': return -(ny.embeddedMargin || 0);
    case 'barrier': return parseFloat((p.capitalProtection || {}).barrier) || 999;
    case 'maturity': return parseFloat(p.maturityYears) || 999;
    case 'coupon': return -((typeof scoring !== 'undefined' && scoring.annualizedCoupon) ? scoring.annualizedCoupon(p) : (parseFloat(p.coupon && p.coupon.rate) || 0));
    default: return 0;
  }
}
function _sbFilterMatch(p, f) {
  if (f === 'all') return true;
  var g = p.grading || {}, cp = p.capitalProtection || {};
  var ny = (typeof scoring !== 'undefined' && scoring.getNetYield) ? scoring.getNetYield(p) : {};
  if (f === 'weak') return ['D', 'F'].indexOf(g.grade) >= 0;
  if (f === 'unprotected') return cp.protected !== true && cp.guaranteeType !== 'garantie';
  if (f === 'decrement') return parseFloat(p.decrementPct) > 0;
  if (f === 'highmargin') return (ny.embeddedMargin || 0) >= 5;
  return true;
}
function _sbApply(list) {
  var f = window._sbFilter || 'all', s = window._sbSort || 'default';
  var out = (list || []).filter(function (p) { return _sbFilterMatch(p, f); });
  if (s !== 'default') out = out.slice().sort(function (a, b) { return _sbSortValue(a, s) - _sbSortValue(b, s); });
  return out;
}
function _sbActive() { return (window._sbSort && window._sbSort !== 'default') || (window._sbFilter && window._sbFilter !== 'all'); }
function _sbControls() {
  var s = window._sbSort || 'default', f = window._sbFilter || 'all';
  var o = function (v, l) { return '<option value="' + v + '"' + (s === v ? ' selected' : '') + '>' + l + '</option>'; };
  var chip = function (v, l) {
    var on = f === v;
    return '<button onclick="_sbSet(\'filter\',\'' + v + '\')" style="font-size:10px;padding:2px 8px;border-radius:6px;cursor:pointer;border:1px solid ' + (on ? 'var(--accent)' : 'var(--border)') + ';background:' + (on ? 'rgba(37,99,235,.12)' : 'transparent') + ';color:' + (on ? 'var(--accent)' : 'var(--text-muted)') + ';font-weight:' + (on ? '700' : '500') + '">' + l + '</button>';
  };
  return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0 12px">'
    + '<span style="font-size:10px;color:var(--text-dim);font-weight:700">TRIER</span>'
    + '<select onchange="_sbSet(\'sort\',this.value)" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);font-family:var(--font)">'
    + o('default', 'Ordre d\'ajout') + o('grade', 'Grade (meilleur)') + o('net', 'Rendement net éco') + o('margin', 'Marge embarquée') + o('barrier', 'Barrière (+ risquée)') + o('maturity', 'Maturité') + o('coupon', 'Coupon')
    + '</select>'
    + '<span style="font-size:10px;color:var(--text-dim);font-weight:700;margin-left:6px">FILTRER</span>'
    + chip('all', 'Tous') + chip('weak', 'D-F') + chip('unprotected', 'Capital risqué') + chip('decrement', 'Décrément') + chip('highmargin', 'Marge ≥5%')
    + '</div>';
}

// Points de négociation (déjà calculés par l'IA, jamais affichés jusqu'ici)
function _renderNegotiation(p) {
  var np = p.grading && p.grading.negotiationPoints;
  if (!np || !np.length) return '';
  return '<div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🤝</span><span class="fiche-section-title">Points de négociation</span></div><div class="fiche-section-body"><div class="fiche-risks">'
    + np.map(function (n) { return '<div class="fiche-risk"><span class="fiche-risk-icon" style="color:var(--accent)">→</span><span>' + (typeof n === 'string' ? n : (n.point || n.text || '')) + '</span></div>'; }).join('')
    + '</div></div></div>';
}

// ═══ Bloc « Comprendre le produit » — tête de fiche, tout regroupé pour décider ═══
function _renderUnderstand(p) {
  if (typeof scoring === 'undefined' || !scoring.getNetYield) return '';
  var coupon = p.coupon || {};
  var couponRate = (typeof coupon === 'object' ? coupon.rate : coupon) || 0;
  if (!couponRate) return '';
  var ny = scoring.getNetYield(p);
  var fd = scoring.getFeeDrag(p);
  var cp = p.capitalProtection || {};
  var md = (p.grading && p.grading.metadata) || {};
  var er = p.earlyRedemption || {};
  var nominal = parseFloat(p.investedAmount) || 100000;
  var barrier = parseFloat(cp.barrier);
  var protectedMat = cp.guaranteeType === 'garantie' || cp.guaranteeType === 'formule' || cp.protected === true || cp.protected === 'true';
  var garanti = cp.guaranteeType === 'garantie';
  var cprob = (md.couponProbability != null) ? md.couponProbability : null;
  var margin = ny.embeddedMargin || 0;
  var isIC = (typeof window._isIssuerCallable === 'function' && window._isIssuerCallable(p)) || er.atIssuerDiscretion === true;
  var sj = (p.underlyings && p.underlyings.length) ? p.underlyings[0] : 'le sous-jacent';
  var catRate = 2.8; try { if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._catRate) catRate = _mktCache._catRate; else if (md.catRate) catRate = md.catRate; } catch (e) {}
  var eur = function (v) { return formatNumber(Math.round(v)) + '€'; };
  var pc = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%'; };
  var f1 = function (v) { return v.toFixed(1).replace('.', ','); };

  // Rendement espéré économique (proba-pondéré, net de frais + marge) = le vrai chiffre
  var espereEco = (cprob != null) ? (couponRate * (cprob / 100) * 0.75 - fd.economicDragPct) : (ny.netEconomic != null ? ny.netEconomic : null);
  var netRecu = ny.netAfterFees;

  // ── Le pari en une phrase ──
  var pari;
  if (isIC) pari = 'Tu prêtes à la banque. Elle te rembourse <strong>quand ça L\'arrange</strong> (prime ~' + f1(couponRate) + '%/an). Ton capital est protégé à l\'échéance — mais le rendement dépend d\'elle, pas de toi.';
  else if (protectedMat) pari = 'Ton capital est protégé à l\'échéance. Tu touches le coupon si <strong>' + sj + '</strong> tient ses conditions. Rendement plafonné.';
  else if (!isNaN(barrier)) pari = 'Tu paries que <strong>' + sj + '</strong> ne s\'effondre pas de plus de <strong>' + (100 - barrier) + '%</strong>. S\'il tient → coupon ' + f1(couponRate) + '%/an ; s\'il chute sous ce seuil → tu encaisses toute la baisse.';
  else pari = 'Coupon ' + f1(couponRate) + '%/an conditionné à <strong>' + sj + '</strong>.';

  // ── 3 scénarios chiffrés ──
  var favAmount = nominal * (1 + couponRate / 100);
  var rows = [];
  rows.push(['#065F46', '#ECFDF5', '✅ Favorable' + (cprob != null ? ' (proba ~' + Math.round(cprob) + '%)' : ''),
    (isIC ? 'La banque te rappelle tôt' : sj + ' ≥ son seuil') + ' → capital + coupon',
    eur(favAmount), 'soit ' + pc(netRecu) + '/an net']);
  rows.push(['#92400E', '#FFFBEB', '⚖️ Médian (capital seul)',
    (protectedMat ? 'À l\'échéance sans rappel' : sj + ' baisse un peu (au-dessus de la barrière), pas de coupon') + ' → capital rendu',
    eur(nominal), 'soit ' + pc(-(fd.dragPct || 0) - 1) + '/an net (frais)']);
  if (!protectedMat && !isNaN(barrier) && barrier > 0) {
    var dropEx = Math.min(90, (100 - barrier) + 10);
    var defAmount = nominal * (100 - dropEx) / 100;
    rows.push(['#991B1B', '#FEF2F2', '❌ Défavorable',
      sj + ' finit sous −' + (100 - barrier) + '% (barrière touchée) → perte = toute la baisse. Ex : −' + dropEx + '%',
      eur(defAmount), 'perte de ' + eur(nominal - defAmount)]);
  } else {
    rows.push(['#065F46', '#ECFDF5', '🛡️ Défavorable',
      (garanti ? 'Capital garanti' : 'Capital protégé à l\'échéance (sauf défaut émetteur)') + ' → tu récupères ta mise',
      eur(nominal), garanti ? 'aucune perte' : 'perte seulement si la banque fait défaut']);
  }

  var h = '<div style="padding:16px;background:linear-gradient(135deg,#F0F9FF,#FFFBEB);border:1px solid #BAE6FD;border-radius:10px;margin-bottom:8px">';
  h += '<div style="font-size:13px;font-weight:800;color:#0C4A6E;margin-bottom:6px">🎓 Comprendre le produit <span style="font-weight:400;color:#64748B;font-size:11px">— exemple sur ' + eur(nominal) + '</span></div>';
  h += '<div style="font-size:12px;color:#334155;line-height:1.55;margin-bottom:12px">' + pari + '</div>';

  // scénarios
  h += '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">';
  rows.forEach(function (r) {
    h += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:' + r[1] + ';border-radius:7px">'
      + '<div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:700;color:' + r[0] + '">' + r[2] + '</div>'
      + '<div style="font-size:10.5px;color:#475569;line-height:1.4">' + r[3] + '</div></div>'
      + '<div style="text-align:right;white-space:nowrap"><div style="font-family:var(--mono);font-size:14px;font-weight:800;color:' + r[0] + '">' + r[4] + '</div>'
      + '<div style="font-size:9.5px;color:#64748B">' + r[5] + '</div></div></div>';
  });
  h += '</div>';

  // rendement + comparaisons
  var espCol = (espereEco != null && espereEco >= catRate) ? '#059669' : '#DC2626';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">';
  // vs direct
  var vsDirect = protectedMat
    ? 'Tu <strong>plafonnes</strong> ta hausse (~' + f1(couponRate) + '%/an max), mais ton capital est <strong>protégé</strong> à l\'échéance. En direct : 100% de la hausse ET de la baisse.'
    : 'Tu <strong>plafonnes</strong> ta hausse (~' + f1(couponRate) + '%/an), et tu es <strong>protégé jusqu\'à −' + (isNaN(barrier) ? '?' : (100 - barrier)) + '%</strong>. Au-delà : même perte qu\'en direct. En direct : toute la hausse, toute la baisse.';
  h += '<div style="padding:9px 11px;background:#fff;border:1px solid #E2E8F0;border-radius:7px">'
    + '<div style="font-weight:700;color:#334155;margin-bottom:2px">📊 vs acheter ' + sj + ' en direct</div>'
    + '<div style="color:#475569;line-height:1.4">' + vsDirect + '</div></div>';
  // vs CAT
  var vsCatPts = (espereEco != null) ? (espereEco - catRate) : null;
  h += '<div style="padding:9px 11px;background:#fff;border:1px solid #E2E8F0;border-radius:7px">'
    + '<div style="font-weight:700;color:#334155;margin-bottom:2px">🏦 vs CAT ' + f1(catRate) + '% (sans risque)</div>'
    + '<div style="color:#475569;line-height:1.4">Rendement <strong>espéré net</strong> : <strong style="color:' + espCol + '">' + (espereEco != null ? pc(espereEco) + '/an' : '—') + '</strong>'
    + (vsCatPts != null ? ' → <strong style="color:' + espCol + '">' + (vsCatPts >= 0 ? '+' : '') + f1(vsCatPts) + ' pt</strong> vs CAT' : '')
    + '. Le CAT ne bloque rien et ne risque rien.</div></div>';
  h += '</div>';

  // ligne de synthèse frais + marge
  h += '<div style="margin-top:10px;padding-top:9px;border-top:1px dashed #CBD5E1;font-size:10.5px;color:#64748B">'
    + '💸 <strong>Si ça marche</strong> : tu touches <strong style="color:#059669">' + pc(netRecu) + '/an</strong> net d\'IS.'
    + (margin > 0 ? ' Mais tu paies <strong style="color:#B45309">' + f1(margin) + '% de marge embarquée</strong> (le produit vaut ~' + f1(100 - margin) + '% à l\'émission).' : '')
    + (cprob != null ? ' Proba de toucher le coupon : <strong>~' + Math.round(cprob) + '%</strong>.' : '')
    + ' Détail complet dans « Frais &amp; Rendement net » ci-dessous.</div>';

  h += '</div>';
  return h;
}

// Bandeau frais/net sous la grille d'une carte produit
function _cardFeeStrip(product) {
  if (!product.coupon?.rate) return '';
  const ny = scoring.getNetYield(product);
  const margin = ny.embeddedMargin || 0;
  const netColor = ny.netAfterFees > 0 ? 'var(--green)' : 'var(--red)';
  const chip = margin > 0
    ? `<span style="color:${margin >= 8 ? 'var(--red)' : 'var(--orange)'};font-size:10px;font-weight:600">marge ${margin.toFixed(1).replace('.', ',')}%</span>`
    : (ny.feesDocumented ? '' : `<span style="color:var(--orange);font-size:10px;font-weight:600">⚠ frais ?</span>`);
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px">
    <span style="color:var(--text-muted)">Net reçu</span>
    <span style="font-family:var(--mono);font-weight:700;color:${netColor}">${formatPct(ny.netAfterFees)}</span>${chip}</div>`;
}

function renderProductCard(product, context) {
  const bank = BANKS.find(b => b.id === product.bankId); const bankName = bank?.name || product.bankId || '—'; const bankColor = bank?.color || 'var(--text-muted)';
  const typeName = PRODUCT_TYPES.find(t => t.id === product.type)?.name || product.type || '—';
  const scoreHTML = product.score ? `<div class="card-score ${product.score.score >= 65 ? 'good' : product.score.score >= 40 ? 'medium' : 'low'}">${product.score.score}</div>` : '';
  const statusBadge = product.status && PROPOSAL_STATUS[product.status] ? `<span class="status-badge" style="--badge-color:${PROPOSAL_STATUS[product.status].color}">${PROPOSAL_STATUS[product.status].icon} ${PROPOSAL_STATUS[product.status].label}</span>` : '';
  const safeBankId = product.bankId || '';
  return `<div class="product-card" onclick="app.openProduct(app._findProduct('${product.id}','${safeBankId}'))">
    <div class="product-card-header"><div class="product-card-name">${product.name||typeName}</div><div class="product-card-bank" style="color:${bankColor};border-color:${bankColor}33;background:${bankColor}12">${bankName}</div></div>
    <div class="product-card-type">${typeName}</div>
    <div class="product-card-grid">
      <div class="product-card-field"><span class="label">Nominal</span><span class="value">${product.investedAmount ? formatNumber(product.investedAmount)+'€' : '—'}</span></div>
      <div class="product-card-field"><span class="label">Coupon</span><span class="value green">${product.coupon?.rate ? formatPct(product.coupon.rate) : '—'}</span></div>
      <div class="product-card-field"><span class="label">Barrière</span><span class="value ${product.capitalProtection?.barrier&&product.capitalProtection.barrier<70?'red':''}">${product.capitalProtection?.barrier ? product.capitalProtection.barrier+'%' : '—'}</span></div>
      <div class="product-card-field"><span class="label">Maturité</span><span class="value">${product.maturity||'—'}</span></div>
    </div>
    ${_cardFeeStrip(product)}
    ${_cardRiskBadges(product)}
    <div class="product-card-footer">${scoreHTML}${statusBadge}</div></div>`;
}

function renderBankSections(state) {
  const bankIds = Object.keys(state.proposals); if (bankIds.length === 0) return '';
  return bankIds.map(bankId => {
    const bank = BANKS.find(b => b.id === bankId); const proposals = state.proposals[bankId]||[];
    const expanded = state.bankSections[bankId] !== false; const pending = proposals.filter(p => !['rejected','subscribed'].includes(p.status)).length;
    return `<div class="bank-section ${expanded?'expanded':''}">
      <div class="bank-header" onclick="toggleBankSection('${bankId}')"><div class="bank-header-left">
        <span class="bank-dot" style="background:${bank?.color||'var(--text-muted)'}"></span><span class="bank-name">${bank?.name||bankId}</span>
        <span class="bank-count">${proposals.length} produit${proposals.length>1?'s':''}</span>${pending>0?`<span class="bank-pending">${pending} en attente</span>`:''}</div>
        <span class="bank-chevron">${expanded?'▾':'▸'}</span></div>
      ${expanded?`<div class="bank-products">${proposals.map(p=>renderProductCard(p,'proposal')).join('')}</div>`:''}</div>`;
  }).join('');
}

// ═══ Call Schedule Table (for callable in fine / callable with redemption levels) ═══
function _renderCallSchedule(p) {
  const schedule = p.earlyRedemption?.callSchedule || p.callSchedule;
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return '';
  const matLevel = p.earlyRedemption?.maturityRedemptionLevel;
  return `<div class="fiche-call-schedule" style="margin-top:12px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:2px solid var(--border);text-align:left">
        <th style="padding:6px 8px">Année</th>
        <th style="padding:6px 8px">Date de rappel</th>
        <th style="padding:6px 8px;text-align:right">Niveau remb.</th>
      </tr></thead>
      <tbody>
        ${schedule.map((s, i) => {
          const dt = s.date || s.redemptionDate || '';
          const level = s.amount || s.redemptionLevel || 100;
          const startYr = p.earlyRedemption?.startSemester ? Math.ceil(p.earlyRedemption.startSemester / 2) : 3;
          return `<tr style="border-bottom:1px solid var(--border-dim)">
          <td style="padding:5px 8px;font-weight:600">An ${startYr + i}</td>
          <td style="padding:5px 8px">${dt || '—'}</td>
          <td style="padding:5px 8px;text-align:right;font-weight:600;color:var(--green)">${level}%</td>
        </tr>`;
        }).join('')}
        ${matLevel ? `<tr style="border-top:2px solid var(--accent)">
          <td colspan="2" style="padding:5px 8px;font-weight:600">Remboursement final</td>
          <td style="padding:5px 8px;text-align:right;font-weight:700;color:var(--accent)">${matLevel}%</td>
        </tr>` : ''}
      </tbody>
    </table>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// FICHE PRODUIT — Style StudyForge
// ═══════════════════════════════════════════════════════════════
function renderProductSheet(container, state) {
  const p = state.currentProduct; if (!p) return;
  const bank = BANKS.find(b => b.id === p.bankId);
  const bankName = bank?.name || p.bankId || '—';
  const bankColor = bank?.color || 'var(--text-muted)';
  const typeName = PRODUCT_TYPES.find(t => t.id === p.type)?.name || p.type || '—';
  const couponRate = p.coupon?.rate;
  const barrier = p.capitalProtection?.barrier;
  const isProtected = p.capitalProtection?.protected === true || p.capitalProtection?.protected === 'true';
  const hasAutocall = p.earlyRedemption?.possible === true || p.earlyRedemption?.possible === 'true';
  const hasMem = p.coupon?.memory === true || p.coupon?.memory === 'true';
  const safeBankId = p.bankId || '';

  container.innerHTML = `
    <div class="sheet-nav">
      <button class="btn ghost" onclick="app.goToDashboard()">← Retour</button>
      <div class="sheet-nav-actions">
        <button class="btn ai-glow" onclick="app.openChat(app.state.currentProduct)">💬 Discuter avec Claude</button>
        ${p.status !== 'subscribed' ? `
          <button class="btn success" onclick="showIntegrateModal('${p.id}','${safeBankId}')">✅ Intégrer</button>
          <button class="btn danger" onclick="handleReject('${p.id}','${safeBankId}')">❌ Rejeter</button>
          <button class="btn ghost" style="color:var(--red)" onclick="handleDelete('${p.id}','${safeBankId}')">🗑 Supprimer</button>
        ` : ''}
      </div>
    </div>

    <div class="fiche-header">
      <div class="fiche-title-block">
        <h1 class="fiche-title">${p.name || 'Produit sans nom'}</h1>
        <div class="fiche-subtitle">
          <span class="fiche-tag bank" style="color:${bankColor};border-color:${bankColor}">${bankName}</span>
          <span class="fiche-tag type">${typeName}</span>
          ${p.status ? `<span class="fiche-tag status" style="color:${PROPOSAL_STATUS[p.status]?.color};background:${PROPOSAL_STATUS[p.status]?.color}18;border:1px solid ${PROPOSAL_STATUS[p.status]?.color}33">${PROPOSAL_STATUS[p.status]?.label}</span>` : ''}
          ${p.sourceFile ? `<span style="color:var(--text-dim);font-size:11px">📄 ${p.sourceFile}</span>` : ''}
        </div>
      </div>
      ${p.score ? renderScoreWidget(p.score) : ''}
    </div>

    <div class="fiche-metrics">
      <div class="fiche-metric green"><div class="fiche-metric-label">Coupon</div><div class="fiche-metric-value">${couponRate ? formatPct(couponRate) : '—'}${p.coupon?.frequency === 'in_fine' ? '/an cap.' : ''}</div><div class="fiche-metric-sub">${p.coupon?.type || 'conditionnel'}${p.coupon?.frequency === 'in_fine' ? ' · in fine' : ''}${hasMem ? ' · mémoire' : ''}</div></div>
      <div class="fiche-metric ${barrier && barrier < 65 ? 'red' : 'orange'}"><div class="fiche-metric-label">Barrière Capital</div><div class="fiche-metric-value">${barrier ? barrier + '%' : '—'}</div><div class="fiche-metric-sub">${p.capitalProtection?.barrierType || '—'}</div></div>
      <div class="fiche-metric blue"><div class="fiche-metric-label">Maturité</div><div class="fiche-metric-value">${p.maturity || '—'}</div><div class="fiche-metric-sub">${p.maturityDate ? formatDate(p.maturityDate) : ''}</div></div>
      <div class="fiche-metric ${isProtected ? (p.capitalProtection?.guaranteeType === 'garantie' ? 'green' : 'orange') : 'red'}" title="${isProtected ? (p.capitalProtection?.guaranteeType === 'garantie' ? 'Garantie externe du capital' : 'Capital remboursé à échéance par la formule, mais soumis au risque de crédit émetteur (pas une garantie)') : 'Capital exposé à une barrière'}"><div class="fiche-metric-label">Capital</div><div class="fiche-metric-value">${isProtected ? (p.capitalProtection?.guaranteeType === 'garantie' ? '✓ Garanti' : '✓ Protégé éch.') : '✕ Non protégé'}</div><div class="fiche-metric-sub">${isProtected ? (p.capitalProtection?.guaranteeType === 'garantie' ? 'garantie externe' : 'risque émetteur') : (barrier ? 'barrière ' + barrier + '%' : '—')}</div></div>
      <div class="fiche-metric ${hasAutocall ? 'purple' : 'blue'}"><div class="fiche-metric-label">${p.earlyRedemption?.type === 'callable' ? 'Callable' : 'Autocall'}</div><div class="fiche-metric-value">${hasAutocall ? '✓ Oui' : '✕ Non'}</div><div class="fiche-metric-sub">${p.earlyRedemption?.type === 'callable' ? (p.earlyRedemption?.firstCallDate ? formatDate(p.earlyRedemption.firstCallDate) : 'Au gre emetteur') : (p.earlyRedemption?.trigger ? 'Seuil ' + p.earlyRedemption.trigger + '%' : '—')}</div></div>
      ${p.investedAmount ? `<div class="fiche-metric blue"><div class="fiche-metric-label">Montant Investi</div><div class="fiche-metric-value">${formatNumber(p.investedAmount)}€</div></div>` : ''}
    </div>

    <div class="sheet-layout">
      <div class="sheet-main">
        ${_renderUnderstand(p)}
        ${p.aiSummary ? `<div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🤖</span><span class="fiche-section-title">Résumé IA</span></div><div class="fiche-section-body"><div class="fiche-ai-summary">${formatAISummary(p.aiSummary)}</div></div></div>` : ''}
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">💰</span><span class="fiche-section-title">Mécanisme des Coupons</span></div><div class="fiche-section-body">
          <div class="fiche-info-box ${couponRate && couponRate >= 5 ? 'green' : 'blue'}"><div class="fiche-info-box-title">Coupon ${p.coupon?.type || ''} — ${couponRate ? formatPct(couponRate) : 'N/A'}</div><div class="fiche-info-box-text">${p.coupon?.frequency ? `<strong>Fréquence:</strong> ${p.coupon.frequency}` : ''}${p.coupon?.trigger ? ` · <strong>Seuil:</strong> ${p.coupon.trigger}% du niveau initial` : ''}${hasMem ? ' · <strong>Effet mémoire:</strong> Oui' : ''}</div></div></div></div>
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🛡️</span><span class="fiche-section-title">Protection du Capital</span></div><div class="fiche-section-body">
          <div class="fiche-info-box ${isProtected ? 'green' : 'orange'}"><div class="fiche-info-box-title">${isProtected ? '✓ Capital protégé' : '⚠️ Capital non protégé'} ${p.capitalProtection?.level ? '— ' + p.capitalProtection.level + '%' : ''}</div><div class="fiche-info-box-text">${p.capitalProtection?.type ? `<strong>Type:</strong> ${p.capitalProtection.type}` : ''}${barrier ? ` · <strong>Barrière:</strong> ${barrier}% (${p.capitalProtection?.barrierType || 'européenne'})` : ''}${p.capitalProtection?.barrierObservation ? `<br><strong>Observation:</strong> ${p.capitalProtection.barrierObservation}` : ''}</div></div>
          ${barrier && barrier < 70 ? `<div class="fiche-alert warn">⚠️ Barrière basse (${barrier}%)</div>` : ''}</div></div>
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">⏩</span><span class="fiche-section-title">Remboursement Anticipé</span></div><div class="fiche-section-body">
          <div class="fiche-info-box ${hasAutocall ? 'purple' : 'neutral'}"><div class="fiche-info-box-title">${hasAutocall ? '✓ Rappel anticipé possible' : '✕ Pas de remboursement anticipé'}</div><div class="fiche-info-box-text">${p.earlyRedemption?.type ? `<strong>Type:</strong> ${p.earlyRedemption.type}` : ''}${p.earlyRedemption?.trigger ? ` · <strong>Seuil:</strong> ${p.earlyRedemption.trigger}%` : ''}${p.earlyRedemption?.frequency ? ` · <strong>Fréquence:</strong> ${p.earlyRedemption.frequency}` : ''}${p.earlyRedemption?.stepDown === true || p.earlyRedemption?.stepDown === 'true' ? `<br><strong>Step-down:</strong> Oui — ${p.earlyRedemption.stepDownDetail || 'seuil dégressif'}` : ''}</div></div>${_renderCallSchedule(p)}</div></div>
        ${_renderFeesNet(p) ? `<div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">💸</span><span class="fiche-section-title">Frais &amp; Rendement net</span></div><div class="fiche-section-body">${_renderFeesNet(p)}</div></div>` : ''}
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📈</span><span class="fiche-section-title">Métriques Investisseur</span></div><div class="fiche-section-body">
          ${_renderInvestorMetrics(p)}
        </div></div>
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📊</span><span class="fiche-section-title">Caractéristiques</span></div><div class="fiche-section-body"><div class="fiche-kv-grid">
          <div class="fiche-kv"><span class="fiche-kv-label">Sous-jacent(s)</span><span class="fiche-kv-value">${(p.underlyings||[]).join(', ') || '—'}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Type</span><span class="fiche-kv-value">${typeName}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Maturité</span><span class="fiche-kv-value">${p.maturity || '—'}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Devise</span><span class="fiche-kv-value">${p.currency || 'EUR'}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Date de strike</span><span class="fiche-kv-value">${formatDate(p.strikeDate)}</span></div>
          <div class="fiche-kv"><span class="fiche-kv-label">Date maturité</span><span class="fiche-kv-value">${formatDate(p.maturityDate)}</span></div>
        </div></div></div>
        ${p.scenarios && (p.scenarios.favorable || p.scenarios.median || p.scenarios.defavorable) ? `
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">🎯</span><span class="fiche-section-title">Scénarios</span></div><div class="fiche-section-body"><div class="fiche-scenarios">
          ${p.scenarios.favorable ? `<div class="fiche-scenario good"><div class="fiche-scenario-label">✅ Favorable</div><div class="fiche-scenario-text">${p.scenarios.favorable}</div></div>` : ''}
          ${p.scenarios.median ? `<div class="fiche-scenario mid"><div class="fiche-scenario-label">⚖️ Médian</div><div class="fiche-scenario-text">${p.scenarios.median}</div></div>` : ''}
          ${p.scenarios.defavorable ? `<div class="fiche-scenario bad"><div class="fiche-scenario-label">❌ Défavorable</div><div class="fiche-scenario-text">${p.scenarios.defavorable}</div></div>` : ''}
        </div></div></div>` : ''}
        ${p.risks && p.risks.length > 0 ? `
        <div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">⚠️</span><span class="fiche-section-title">Points d'Attention</span></div><div class="fiche-section-body"><div class="fiche-risks">
          ${p.risks.map(r => `<div class="fiche-risk"><span class="fiche-risk-icon">▸</span><span>${r}</span></div>`).join('')}
        </div></div></div>` : ''}
        ${_renderNegotiation(p)}
        ${p.conversationSummary ? `<div class="fiche-section"><div class="fiche-section-header"><span class="fiche-section-icon">📝</span><span class="fiche-section-title">Résumé Discussion</span></div><div class="fiche-section-body"><div class="fiche-ai-summary">${formatAISummary(p.conversationSummary)}</div>${p.decision ? `<div class="fiche-alert ${p.decision === 'subscribed' ? 'success' : 'warn'}">Décision: <strong>${PROPOSAL_STATUS[p.decision]?.label || p.decision}</strong></div>` : ''}</div></div>` : ''}
      </div>
      <div class="sheet-sidebar">
        ${p.score ? renderScorePanel(p.score) : ''}
        <div class="sheet-card"><h3 class="sheet-card-title">Actions</h3><div class="action-buttons">
          <button class="btn ai-glow lg" style="width:100%" onclick="app.openChat(app.state.currentProduct)">💬 Discuter avec Claude</button>
          ${p.status !== 'subscribed' ? `
            <button class="btn success lg" style="width:100%" onclick="showIntegrateModal('${p.id}','${safeBankId}')">✅ Intégrer</button>
            <button class="btn danger lg" style="width:100%" onclick="handleReject('${p.id}','${safeBankId}')">❌ Rejeter</button>
            <button class="btn ghost lg" style="width:100%;color:var(--red)" onclick="handleDelete('${p.id}','${safeBankId}')">🗑 Supprimer définitivement</button>
          ` : `<div class="integrated-notice">✅ Intégré le ${formatDate(p.addedDate)}<br>Montant: ${formatNumber(p.investedAmount)}€</div>`}
        </div></div>
      </div>
    </div>`;
}

// ─── Format helpers ─────────────────────────────────────────
function formatAISummary(text) {
  if (!text) return '';
  let html = escapeHTML(text);
  html = html.replace(/^##\s*(\d+)\.\s*(.+)$/gm, '<h2>$1. $2</h2>');
  html = html.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s*(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^(\d+)\.\s*\*\*(.+?)\*\*\s*[—–-]\s*/gm, '<h2>$1. $2</h2>');
  html = html.replace(/^(\d+)\.\s*\*\*(.+?)\*\*/gm, '<h2>$1. $2</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<h2>') && !html.startsWith('<p>')) html = '<p>' + html + '</p>';
  return html;
}

function renderScoreWidget(score) {
  const color = score.score>=65?'var(--green)':score.score>=40?'var(--orange)':'var(--red)';
  return `<div class="score-widget"><svg viewBox="0 0 80 80" class="score-ring"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" stroke-width="4"/><circle cx="40" cy="40" r="34" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${2*Math.PI*34}" stroke-dashoffset="${2*Math.PI*34*(1-score.score/100)}" stroke-linecap="round" transform="rotate(-90 40 40)"/></svg><div class="score-number" style="color:${color}">${score.score}</div></div>`;
}

// ─── Investor Metrics: MtM, P(loss), spread vs OAT, proba coupon ──────
// 💸 Frais & Rendement net — ce que le produit donne vraiment, marge déduite.
function _renderFeesNet(p) {
  var coupon = p.coupon || {};
  var couponRate = (typeof coupon === 'object' ? coupon.rate : coupon) || 0;
  if (!couponRate || typeof scoring === 'undefined' || !scoring.getNetYield) return '';
  var ny = scoring.getNetYield(p);
  var fd = scoring.getFeeDrag(p);
  var fees = fd.fees || {};
  var matEsp = fd.years;
  var custody = fees.custodyAnnual || 0;
  var margin = ny.embeddedMargin || 0;             // marge embarquée totale (incluse dans le prix)
  var marginAnnual = ny.marginAnnualized || 0;     // marge annualisée (surcoût implicite)
  var netRecu = ny.netAfterFees;                   // NET REÇU (si coupon touché) : coupon − garde − IS
  var isCond = coupon.type === 'conditionnel' || (coupon.trigger != null && coupon.trigger !== '');
  var cprob = (p.grading && p.grading.metadata && p.grading.metadata.couponProbability != null) ? p.grading.metadata.couponProbability / 100 : null;
  var pc = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%'; };
  var f1 = function (v) { return v.toFixed(1).replace('.', ','); };
  var f2 = function (v) { return v.toFixed(2).replace('.', ','); };
  var netCol = netRecu > 0 ? '#059669' : '#DC2626';
  var isOverLife = !!(p.commissionAnnualOverLife || (p.aiParsed && p.aiParsed.commissionAnnualOverLife));

  var h = '<div style="padding:14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;margin-bottom:8px">';
  // ── 1. NET REÇU (payoff contractuel, si coupon touché) — la marge n'ampute PAS ce chiffre ──
  h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">';
  h += '<span style="font-size:11px;font-weight:700;color:#92400E">💸 NET REÇU (si coupon touché)</span>';
  h += '<span style="font-family:var(--mono);font-size:24px;font-weight:800;color:' + netCol + '">' + pc(netRecu) + '/an</span></div>';
  h += '<div style="font-size:12px;color:#475569;line-height:1.8">';
  h += 'Coupon brut : <strong>' + pc(ny.gross) + '/an</strong><br>';
  if (custody > 0) h += '<span style="color:#B45309">− Droits de garde ' + f2(custody) + '%/an</span><br>';
  h += '<span style="color:#B45309">− IS 25%</span><br>';
  h += '= <strong style="color:' + netCol + '">Net reçu ' + pc(netRecu) + '/an</strong> <span style="color:#94A3B8;font-size:11px">— le payoff contractuel : la marge embarquée n\'ampute PAS ce que tu touches</span>';
  h += '</div>';

  // ── 2. MARGE EMBARQUÉE : tu ne la « paies » pas sur le coupon, mais tu SURPAYES le produit ──
  if (margin > 0) {
    var fairVal = Math.max(0, 100 - margin);
    h += '<div style="margin-top:10px;padding:9px 11px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;font-size:11.5px;color:#78350F">';
    h += '⚠️ <strong>Marge embarquée : ' + f2(margin) + '%</strong> incluse dans le prix' + (isOverLife ? ' (≈ ' + f2(marginAnnual) + '%/an × ' + f1(matEsp || 1) + ' ans)' : '') + '.<br>';
    h += '<span style="color:#92400E">Tu paies <strong>100%</strong> pour un produit valant ≈ <strong>' + f1(fairVal) + '%</strong> à l\'émission → surcoût implicite ≈ <strong>' + f2(marginAnnual) + '%/an</strong>. Un produit équitable offrirait un coupon plus élevé.</span>';
    h += '</div>';
  }

  // ── 3. RENDEMENT ESPÉRÉ NET — vue « bonne affaire ? » : proba de coupon + surcoût de marge ──
  if (isCond && cprob != null) {
    var couponEspere = ny.gross * cprob;
    var couponEspereNet = couponEspere * 0.75;
    var espereEco = couponEspereNet - fd.economicDragPct;   // − garde − marge amortie
    var espCol = espereEco > 0 ? '#059669' : '#DC2626';
    var probSrc = (p.grading && p.grading.metadata && p.grading.metadata.couponProbMethod) || 'Black-Scholes P(≥ seuil)';
    var nUnd = Array.isArray(p.underlyings) ? p.underlyings.length : 0;
    var isWO = /worst|pire|moins/i.test((p.basketType || '') + '') || (nUnd > 1 && !/equipond|basket|panier|moyen|index|indice/i.test((p.basketType || p.underlyingType || '') + ''));
    var row = function (lbl, op, val, valCol, note) {
      return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:1px 0">'
        + '<span style="color:#475569">' + lbl + (note ? ' <span style="font-size:9.5px;color:#94A3B8">' + note + '</span>' : '') + '</span>'
        + '<span style="font-family:var(--mono);white-space:nowrap"><span style="color:#94A3B8">' + (op || '') + '</span> <strong style="color:' + (valCol || '#334155') + '">' + val + '</strong></span></div>';
    };
    var rule = '<div style="border-top:1px solid #E2E8F0;margin:3px 0"></div>';
    h += '<div style="margin-top:10px;padding:11px 13px;background:#fff;border:1px solid #FDE68A;border-radius:6px;font-size:12px">';
    h += '<div style="font-size:10.5px;font-weight:700;color:#92400E;margin-bottom:6px">🧮 RENDEMENT ESPÉRÉ NET <span style="font-weight:400;color:#94A3B8">(valeur économique : proba + surcoût de marge)</span></div>';
    h += row('Coupon brut', '', pc(ny.gross) + '/an');
    h += row('Proba de coupon', '×', Math.round(cprob * 100) + '%', '#B45309', '— ' + probSrc + (isWO ? ', worst-of ' + nUnd : ''));
    h += rule;
    h += row('= Coupon espéré', '', pc(couponEspere) + '/an');
    h += row('Impôt (IS)', '×', '0,75', '#B45309', '— (1 − 25%)');
    h += rule;
    h += row('= Coupon espéré net', '', pc(couponEspereNet) + '/an');
    if (custody > 0) h += row('Droits de garde', '−', f2(custody) + '%/an', '#B45309');
    if (margin > 0) h += row('Surcoût marge', '−', f2(marginAnnual) + '%/an', '#B45309', '— ' + f1(margin) + '% ÷ ' + f1(matEsp || 1) + ' ans (tu surpayes)');
    h += rule;
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:2px">'
      + '<span style="font-weight:700;color:#334155">= Rendement ESPÉRÉ net</span>'
      + '<span style="font-family:var(--mono);font-size:15px;font-weight:800;color:' + espCol + '">' + pc(espereEco) + '/an</span></div>';
    // Comparaison CAT — même source que le grader (_mktCache._catRate)
    var catRate = 2.8;
    try {
      if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache._catRate) catRate = _mktCache._catRate;
      else if (p.grading && p.grading.metadata && p.grading.metadata.catRate) catRate = p.grading.metadata.catRate;
    } catch (e) {}
    var vsCat = espereEco - catRate;
    h += '<div style="margin-top:7px;padding-top:6px;border-top:1px dashed #E2E8F0;font-size:11px;color:' + (vsCat >= 0 ? '#059669' : '#DC2626') + '">'
      + (vsCat >= 0 ? '✓ ' : '✗ ') + 'vs CAT ' + f1(catRate) + '% → <strong>' + (vsCat >= 0 ? '+' : '') + f2(vsCat) + ' pt' + (Math.abs(vsCat) >= 2 ? 's' : '') + '</strong>' + (vsCat < 0 ? ' — sous le dépôt à terme, pour un risque actions' : '') + '</div>';
    h += '<div style="margin-top:5px;font-size:10px;color:#64748B">Deux chiffres à ne pas confondre : <strong>' + pc(netRecu) + '</strong> = ce que tu touches SI ça marche ; <strong>' + pc(espereEco) + '</strong> = la valeur attendue (proba de coupon' + (margin > 0 ? ' + marge que tu surpayes' : '') + ').' + (isWO ? ' Panier <strong>worst-of</strong> : proba réelle plus basse → espéré probablement inférieur.' : '') + '</div>';
    h += '</div>';
  }
  // Caveat qualité des frais
  if (!fd.documented) {
    h += '<div style="margin-top:6px;font-size:10px;color:#D97706">⚠ Frais non renseignés. Saisis la marge (KID) pour un net fiable.</div>';
  } else {
    h += '<div style="margin-top:6px;font-size:10px;color:#94A3B8">Marge = commission de distribution (incluse dans le prix). Le RIY du KID donne le coût total exact.</div>';
  }
  h += '</div>';
  return h;
}

function _renderInvestorMetrics(p) {
  var coupon = p.coupon || {};
  var cp = p.capitalProtection || {};
  var couponRate = (typeof coupon === 'object' ? coupon.rate : coupon) || 0;
  var barrier = cp.barrier || 0;
  var isProtected = cp.protected || false;
  var matYears = parseFloat(p.maturityYears) || 5;
  var trigger = parseFloat(coupon.trigger) || 0;
  var st = (p.structureType || p.type || '').toLowerCase();
  var undType = (p.underlyingType || '').toLowerCase();
  var isRate = st.indexOf('taux') >= 0 || st === 'capital_garanti' || undType === 'rates';

  var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">';

  // ─── A. Mark-to-Market estimé ──────
  var mtmEstimate = 0;
  if (isProtected && !barrier) {
    mtmEstimate = 97; // capital garanti = ~97% en secondaire
  } else if (barrier) {
    mtmEstimate = Math.max(85, Math.min(97, 100 - (100 - barrier) * 0.15));
  } else {
    mtmEstimate = 93; // estimation générique
  }
  html += '<div style="padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;border-left:3px solid #2563EB">';
  html += '<div style="font-size:11px;font-weight:700;color:#475569">VALEUR SECONDAIRE ESTIMÉE</div>';
  html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:#2563EB;margin:4px 0">' + mtmEstimate + '%</div>';
  html += '<div style="font-size:11px;color:#475569">Si revente jour 1 → ~' + mtmEstimate + '% du nominal<br>Coût de liquidité : ~' + (100 - mtmEstimate) + '%</div>';
  html += '</div>';

  // ─── B. P(perte capital) + perte attendue ──────
  var pLoss = 0;
  var lossGivenLoss = 0;
  var expectedLoss = 0;
  if (isProtected && !barrier) {
    pLoss = 0;
    lossGivenLoss = 0;
  } else if (barrier) {
    // BS approximation de P(breach)
    var vol = 25; // default stock vol
    var bSigma = Math.log(100 / barrier) / (vol / 100 * Math.sqrt(matYears));
    pLoss = Math.round((1 - _normcdfApprox(bSigma)) * 1000) / 10;
    lossGivenLoss = Math.round((100 - barrier) * 1.3); // severity
    expectedLoss = Math.round(pLoss * lossGivenLoss / 100 * 10) / 10;
  }
  var pLossColor = pLoss === 0 ? '#059669' : pLoss < 10 ? '#D97706' : '#DC2626';
  html += '<div style="padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;border-left:3px solid ' + pLossColor + '">';
  html += '<div style="font-size:11px;font-weight:700;color:#475569">RISQUE EN CAPITAL</div>';
  if (pLoss === 0) {
    var _trueGuar = (p.capitalProtection && p.capitalProtection.guaranteeType) === 'garantie';
    if (_trueGuar) {
      html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:#059669;margin:4px 0">0%</div>';
      html += '<div style="font-size:11px;color:#059669">Capital garanti 100% à l\'échéance (garantie externe)</div>';
    } else {
      html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:#D97706;margin:4px 0">0% <span style="font-size:11px;font-weight:600">marché</span></div>';
      html += '<div style="font-size:11px;color:#475569">Capital protégé à l\'échéance par la formule — <strong style="color:#D97706">exposé au risque de crédit émetteur</strong> (pas une garantie)</div>';
    }
  } else {
    html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + pLossColor + ';margin:4px 0">' + pLoss + '%</div>';
    html += '<div style="font-size:11px;color:#475569">Probabilité de perte en capital<br>Perte moyenne si perte : -' + lossGivenLoss + '% · Perte attendue : -' + expectedLoss + '%</div>';
  }
  html += '</div>';

  // ─── C. Spread vs alternative simple ──────
  var oatRate = 3.08; // OAT 10Y actuel (ou lire depuis MARKET_RATES)
  if (typeof MARKET_RATES !== 'undefined' && MARKET_RATES.tec10) oatRate = MARKET_RATES.tec10;
  var spread = Math.round((couponRate - oatRate) * 100) / 100;
  var spreadColor = spread > 2 ? '#059669' : spread > 0 ? '#D97706' : '#DC2626';
  html += '<div style="padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;border-left:3px solid ' + spreadColor + '">';
  html += '<div style="font-size:11px;font-weight:700;color:#475569">PRIME DE COMPLEXITÉ</div>';
  html += '<div style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + spreadColor + ';margin:4px 0">' + (spread >= 0 ? '+' : '') + spread.toFixed(2) + '%</div>';
  html += '<div style="font-size:11px;color:#475569">Coupon ' + couponRate + '% vs OAT ' + matYears + 'Y ' + oatRate.toFixed(2) + '%<br>Ce que vous gagnez de plus vs un placement sans risque</div>';
  html += '</div>';

  html += '</div>';

  // ─── Proba historique de coupon (pour produits taux) — avec données réelles ──────
  if (isRate && trigger && trigger < 10) {
    // Charger les données depuis le cache global si disponible
    var ratesData = window._ficheRatesCache;
    if (!ratesData && typeof fetch !== 'undefined') {
      // Fetch synchrone via XMLHttpRequest pour la fiche
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'data/market/rates.json', false);
        xhr.send();
        if (xhr.status === 200) {
          ratesData = JSON.parse(xhr.responseText);
          window._ficheRatesCache = ratesData;
        }
      } catch(e) { /* silent */ }
    }

    // Deviner quel taux ce produit suit
    var productText = ((p.name || '') + ' ' + (p.mechanism || '') + ' ' + ((p.coupon || {}).triggerDetail || '')).toLowerCase();
    var rateKey = /euribor/i.test(productText) ? 'euribor_3m' : 'oat_fr_10y';
    var rateLabel = rateKey === 'euribor_3m' ? 'Euribor 3M' : 'TEC10';

    var history = (ratesData && ratesData.yields && ratesData.yields[rateKey] && ratesData.yields[rateKey].history) || [];
    var totalObs = history.length;

    // Calculer les stats si on a les données
    if (totalObs > 10) {
      var below = 0, above = 0, lastAbove = null, maxConsecAbove = 0, consecAbove = 0;
      var below5y = 0, total5y = 0;
      var fiveYearsAgo = new Date(); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
      var fiveYStr = fiveYearsAgo.toISOString().substring(0, 10);

      history.forEach(function(h) {
        if (h.value <= trigger) { below++; consecAbove = 0; }
        else { above++; lastAbove = h.date; consecAbove++; maxConsecAbove = Math.max(maxConsecAbove, consecAbove); }
        if (h.date >= fiveYStr) { total5y++; if (h.value <= trigger) below5y++; }
      });

      var pctBelow20y = Math.round(below / totalObs * 1000) / 10;
      var pctBelow5y = total5y > 0 ? Math.round(below5y / total5y * 1000) / 10 : 0;

      html += '<div style="padding:14px;background:#EFF6FF;border:1px solid #93C5FD;border-radius:8px;margin-bottom:8px">';
      html += '<div style="font-size:12px;font-weight:700;color:#1E40AF;margin-bottom:8px">📊 Probabilité historique de coupon (' + rateLabel + ' ≤ ' + trigger + '%)</div>';

      // 5 KPIs en ligne
      html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:8px">';

      // 20 ans
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">20 ans</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + pctBelow20y + '%</div>';
      html += '<div style="font-size:11px;color:#475569">' + below + '/' + totalObs + ' obs</div>';
      html += '</div>';

      // 5 ans
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">5 ans</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + pctBelow5y + '%</div>';
      html += '<div style="font-size:11px;color:#475569">' + below5y + '/' + total5y + ' obs</div>';
      html += '</div>';

      // Nb jours au-dessus
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">Nb obs au-dessus</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (above === 0 ? '#059669' : '#DC2626') + '">' + above + '</div>';
      html += '<div style="font-size:11px;color:#475569">sur ' + totalObs + ' total</div>';
      html += '</div>';

      // Dernière fois au-dessus
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">Dernier dépassement</div>';
      html += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:' + (lastAbove ? '#DC2626' : '#059669') + '">' + (lastAbove || 'Jamais') + '</div>';
      html += '<div style="font-size:11px;color:#475569">' + (lastAbove ? 'il y a ' + Math.round((Date.now() - new Date(lastAbove).getTime()) / 86400000 / 365) + ' ans' : 'sur 20 ans') + '</div>';
      html += '</div>';

      // Max consécutif au-dessus
      html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
      html += '<div style="font-size:11px;color:#475569;margin-bottom:4px">Max consécutif ≥</div>';
      html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (maxConsecAbove <= 2 ? '#059669' : '#DC2626') + '">' + maxConsecAbove + ' obs</div>';
      html += '<div style="font-size:11px;color:#475569">pire épisode continu</div>';
      html += '</div>';

      html += '</div>';

      // Forward estimée
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      html += '<div style="padding:8px 12px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;font-size:11px;color:#065F46">';
      html += '<strong>Forward estimée : 85-92%</strong> — en régime de taux normalisés (post-ZIRP), avec haircut stagflation.</div>';
      html += '<div style="padding:8px 12px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;font-size:11px;color:#92400E">';
      html += '⚠️ L\'historique 20 ans inclut 10 ans de taux zéro/négatifs (2012-2022) qui gonflent la probabilité. La forward est plus conservatrice.</div>';
      html += '</div>';

      html += '</div>';
    }
  }

  // ─── Probabilités détaillées (produits actions: autocall, phoenix) ──────
  if (!isRate && couponRate > 0) {
    var er = p.earlyRedemption || {};
    var hasAutocallProb = er.possible && (er.type === 'autocall' || er.type === 'callable');
    var freq = (coupon.frequency || 'annuel').toLowerCase();
    var obsPerYear = freq.indexOf('semestr') >= 0 ? 2 : freq.indexOf('trimestr') >= 0 ? 4 : 1;
    var triggerAC = parseFloat(er.trigger) || parseFloat(coupon.trigger) || 100;
    var vol = 28; // default single-stock
    var hasMemory = coupon.memory === true;

    // Try to get real vol from grading metadata
    if (p.grading && p.grading.metadata && p.grading.metadata.bsVols && p.grading.metadata.bsVols.length > 0) {
      vol = Math.max.apply(null, p.grading.metadata.bsVols);
    }

    // Worst-of : la condition porte sur le sous-jacent le MOINS performant → tous doivent tenir.
    // Prob conjointe < prob d'une seule. Exposant effectif = 1 + (n-1)(1-ρ) (copule à un facteur).
    var nUnd = (p.underlyings || []).filter(Boolean).length || 1;
    var isWorstOf = nUnd > 1 && (p.underlyingType === 'worst-of' || p.underlyingType === 'basket' || /worst/i.test(p.underlyingType || ''));
    var rhoWO = 0.5; // corrélation supposée entre sous-jacents
    var woExp = isWorstOf ? 1 + (nUnd - 1) * (1 - rhoWO) : 1;

    // Compute prob autocall at each observation date
    var totalObs2 = Math.floor(matYears * obsPerYear);
    var probSurvival = 1.0;
    var autocallProbs = [];
    var cumulProb = 0;

    for (var obs = 1; obs <= totalObs2; obs++) {
      var T = obs / obsPerYear;
      // Start semester check
      if (er.startSemester && obs < er.startSemester) {
        autocallProbs.push({ obs: obs, year: T, probCall: 0, probCumul: 0, probSurvival: probSurvival });
        continue;
      }
      // Step-down: trigger decreases over time
      var adjTrigger = triggerAC;
      if (er.stepDown && er.stepDownPct) {
        adjTrigger = Math.max(70, triggerAC - (er.stepDownPct * (obs - (er.startSemester || 2))));
      }
      // BS prob qu'UNE action soit ≥ trigger à T, puis ajustement worst-of (toutes doivent tenir)
      var sigma = vol / 100;
      var d2 = (Math.log(100 / adjTrigger) + (0.02 - sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
      var probAboveSingle = _normcdfApprox(d2);
      var probAbove = isWorstOf ? Math.pow(probAboveSingle, woExp) : probAboveSingle;
      var probCallThisObs;
      if (hasAutocallProb) { probCallThisObs = probSurvival * probAbove; cumulProb += probCallThisObs; probSurvival *= (1 - probAbove); }
      else { probCallThisObs = probAbove; } // digital sans rappel : prob de COUPON cette année, pas de redemption → survie inchangée

      autocallProbs.push({ obs: obs, year: T, trigger: adjTrigger, probCall: probCallThisObs, probCumul: cumulProb, probSurvival: probSurvival });
    }

    // Digital sans rappel : le produit va toujours à l'échéance ; on mesure le coupon, pas l'autocall.
    var probReachMaturity = hasAutocallProb ? probSurvival : 1.0;
    var expectedMat = matYears;
    if (hasAutocallProb) { expectedMat = 0; autocallProbs.forEach(function(ap) { expectedMat += ap.probCall * ap.year; }); expectedMat += probReachMaturity * matYears; }
    var probNoCoupon = 1; autocallProbs.forEach(function(ap) { probNoCoupon *= (1 - ap.probCall); }); // prob de ne JAMAIS toucher de coupon

    // Prob de coupon (au moins un coupon versé sur la durée avec mémoire)
    var probAtLeastOneCoupon = hasMemory ? (1 - Math.pow(1 - autocallProbs[0].probCall, totalObs2)) : (autocallProbs.length > 0 ? autocallProbs[0].probCall / (autocallProbs[0].probSurvival || 1) : 0.5);

    // Prob de perte (reach maturity AND below barrier)
    var probLoss = 0;
    if (barrier > 0 && barrier < 100) {
      var d2Loss = (Math.log(100 / barrier) + (0.02 - (vol/100) * (vol/100) / 2) * matYears) / ((vol/100) * Math.sqrt(matYears));
      probLoss = Math.round((1 - _normcdfApprox(d2Loss)) * probReachMaturity * 1000) / 10;
    }

    html += '<div style="padding:14px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;margin-bottom:8px">';
    html += '<div style="font-size:12px;font-weight:700;color:#0369A1;margin-bottom:10px">📊 Probabilités détaillées — ' + (hasAutocallProb ? 'Autocall & Coupon' : 'Coupon (digital, sans rappel)') + '</div>';

    // Summary KPIs
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">';
    html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
    html += '<div style="font-size:10px;color:#475569">' + (hasAutocallProb ? 'Maturité espérée' : 'Durée') + '</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#7C3AED">' + (hasAutocallProb ? expectedMat.toFixed(1) : matYears) + ' ans</div>';
    html += '<div style="font-size:10px;color:#475569">' + (hasAutocallProb ? 'sur ' + matYears + ' max' : 'fixe — pas de rappel') + '</div></div>';

    html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
    html += '<div style="font-size:10px;color:#475569">' + (hasAutocallProb ? 'Prob autocall < 3 ans' : 'Prob ≥1 coupon') + '</div>';
    var probBefore3 = 0;
    autocallProbs.forEach(function(ap) { if (ap.year <= 3) probBefore3 = ap.probCumul; });
    var _kpi2 = hasAutocallProb ? Math.round(probBefore3 * 100) : Math.round((1 - probNoCoupon) * 100);
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#059669">' + _kpi2 + '%</div></div>';

    html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
    html += '<div style="font-size:10px;color:#475569">Prob atteindre maturité</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:#D97706">' + Math.round(probReachMaturity * 100) + '%</div></div>';

    html += '<div style="padding:10px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
    html += '<div style="font-size:10px;color:#475569">Prob perte en capital</div>';
    html += '<div style="font-family:var(--mono);font-size:18px;font-weight:800;color:' + (probLoss < 5 ? '#059669' : probLoss < 15 ? '#D97706' : '#DC2626') + '">' + probLoss + '%</div></div>';
    html += '</div>';

    // Timeline par observation
    html += '<div style="font-size:11px;font-weight:600;color:#475569;margin-bottom:6px">' + (hasAutocallProb ? 'Probabilité d\'autocall par date d\'observation :' : 'Probabilité de toucher le coupon par observation :') + '</div>';
    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">';
    autocallProbs.forEach(function(ap) {
      if (ap.probCall <= 0) return;
      var pct = Math.round(ap.probCall * 100);
      var cumPct = Math.round(ap.probCumul * 100);
      var label = obsPerYear >= 2 ? 'S' + ap.obs : 'An ' + ap.obs;
      var bg = pct >= 70 ? '#ECFDF5' : pct >= 40 ? '#FFF7ED' : '#F8FAFC';
      var color = pct >= 70 ? '#059669' : pct >= 40 ? '#D97706' : '#475569';
      html += '<div style="padding:4px 8px;background:' + bg + ';border:1px solid #E2E8F0;border-radius:4px;text-align:center;min-width:50px">';
      html += '<div style="font-size:9px;color:#94A3B8">' + label + '</div>';
      html += '<div style="font-size:12px;font-weight:700;color:' + color + '">' + pct + '%</div>';
      html += (hasAutocallProb ? '<div style="font-size:9px;color:#94A3B8">cum. ' + cumPct + '%</div>' : '');
      html += '</div>';
    });
    html += '</div>';

    if (hasMemory) {
      html += '<div style="padding:6px 10px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:4px;font-size:10px;color:#065F46;margin-bottom:4px">';
      html += '🧠 <strong>Effet mémoire</strong> : les coupons non versés sont accumulés et versés dès que la condition est remplie. Sur ' + totalObs2 + ' observations, la probabilité de ne JAMAIS recevoir de coupon est de ' + Math.round((hasAutocallProb ? probReachMaturity : probNoCoupon) * 100) + '%.</div>';
    }

    html += '<div style="font-size:10px;color:#94A3B8;margin-top:4px">Vol implicite : ' + vol.toFixed(1) + '% · ' + (hasAutocallProb ? 'Trigger autocall : ' : 'Seuil coupon : ') + triggerAC + '%' + (er.stepDown ? ' (step-down -' + er.stepDownPct + '%/sem)' : '') + (isWorstOf ? ' · <strong>Worst-of ' + nUnd + ' sous-jacents</strong> (corr. ~' + Math.round(rhoWO * 100) + '% → les ' + nUnd + ' doivent tenir)' : '') + '</div>';
    if (isWorstOf) html += '<div style="font-size:9px;color:#94A3B8;margin-top:2px;font-style:italic">Prob conjointe (worst-of) ≈ prob d\'une seule^' + woExp.toFixed(2) + '. Les « Scénarios régime » ci-dessus ajoutent en plus la vue macro.</div>';

    // ─── Détail coupon & remboursement ───
    var nominal = parseFloat(p.investedAmount) || parseFloat(p.minInvestment) || 100000;
    var guaranteedYrs = p.guaranteedYears || 0;
    var annualizedCoupon = couponRate * obsPerYear;
    var couponPerObs = Math.round(nominal * couponRate / 100);
    var couponPerYear = couponPerObs * obsPerYear;

    html += '<div style="margin-top:10px;padding:12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px">';
    html += '<div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:8px">💰 Détail Coupons & Remboursement</div>';

    // Coupon summary
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">';
    html += '<div style="padding:8px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
    html += '<div style="font-size:10px;color:#475569">Coupon / observation</div>';
    html += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#D97706">' + couponRate + '% = ' + formatNumber(couponPerObs) + '€</div>';
    html += '<div style="font-size:10px;color:#475569">' + (obsPerYear === 2 ? 'Semestriel' : obsPerYear === 4 ? 'Trimestriel' : 'Annuel') + '</div></div>';

    html += '<div style="padding:8px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
    html += '<div style="font-size:10px;color:#475569">Coupon annualisé</div>';
    html += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#D97706">' + annualizedCoupon + '% = ' + formatNumber(couponPerYear) + '€/an</div></div>';

    html += '<div style="padding:8px;background:white;border-radius:6px;text-align:center;border:1px solid #E2E8F0">';
    html += '<div style="font-size:10px;color:#475569">Coupon max total (' + matYears + 'a)</div>';
    html += '<div style="font-family:var(--mono);font-size:16px;font-weight:800;color:#059669">' + (annualizedCoupon * matYears) + '% = ' + formatNumber(couponPerYear * matYears) + '€</div></div>';
    html += '</div>';

    // Guaranteed coupons
    if (guaranteedYrs > 0) {
      var guaranteedTotal = couponPerYear * guaranteedYrs;
      html += '<div style="padding:8px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:6px;font-size:11px;color:#065F46;margin-bottom:6px">';
      html += '✅ <strong>' + guaranteedYrs + ' an' + (guaranteedYrs > 1 ? 's' : '') + ' de coupons garantis</strong> = <strong>' + formatNumber(guaranteedTotal) + '€ acquis</strong> sans condition de marché</div>';
    } else {
      html += '<div style="padding:8px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:6px;font-size:11px;color:#991B1B;margin-bottom:6px">';
      html += '⚠️ <strong>Aucun coupon garanti</strong> — tous les coupons sont conditionnels (sous-jacent ≥ ' + triggerAC + '%)</div>';
    }

    // Memory detail
    if (hasMemory) {
      html += '<div style="padding:8px;background:#EFF6FF;border:1px solid #93C5FD;border-radius:6px;font-size:11px;color:#1E40AF;margin-bottom:6px">';
      html += '🧠 <strong>Effet mémoire</strong> — Exemple : si coupon manqué au S3 et S4, puis condition remplie au S5 → versement de <strong>3 × ' + formatNumber(couponPerObs) + '€ = ' + formatNumber(couponPerObs * 3) + '€</strong> d\'un coup. ';
      html += 'Les coupons non versés s\'accumulent et sont tous payés dès le premier retour au-dessus de ' + triggerAC + '%.</div>';
    } else {
      html += '<div style="padding:8px;background:#FFF7ED;border:1px solid #FDBA74;border-radius:6px;font-size:11px;color:#92400E;margin-bottom:6px">';
      html += '❌ <strong>Pas de mémoire</strong> — Un coupon manqué est perdu définitivement.</div>';
    }

    // Step-down detail
    if (er.stepDown && er.stepDownPct) {
      html += '<div style="padding:8px;background:#F5F3FF;border:1px solid #C4B5FD;border-radius:6px;font-size:11px;color:#5B21B6;margin-bottom:6px">';
      html += '📉 <strong>Step-down</strong> — Le seuil d\'autocall baisse de ' + er.stepDownPct + '% par semestre : ';
      var startSem = er.startSemester || 2;
      for (var sd = 0; sd < Math.min(6, totalObs2 - startSem + 1); sd++) {
        var sdTrigger = Math.max(70, triggerAC - er.stepDownPct * sd);
        html += (sd > 0 ? ' → ' : '') + sdTrigger.toFixed(1) + '%';
      }
      html += '... Plus le temps passe, plus l\'autocall est facile à atteindre.</div>';
    } else if (hasAutocallProb) {
      html += '<div style="padding:8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;color:#475569;margin-bottom:6px">';
      html += '📌 <strong>Seuil constant</strong> — L\'autocall se déclenche toujours à ' + triggerAC + '% du niveau initial. Pas de step-down.</div>';
    }

    // Capital protection detail
    if (barrier > 0 && barrier < 100) {
      html += '<div style="padding:8px;background:' + (barrier >= 60 ? '#FFF7ED' : '#FEF2F2') + ';border:1px solid ' + (barrier >= 60 ? '#FDBA74' : '#FCA5A5') + ';border-radius:6px;font-size:11px;color:' + (barrier >= 60 ? '#92400E' : '#991B1B') + ';margin-bottom:6px">';
      html += '🛡️ <strong>Protection partielle</strong> — Capital protégé si le sous-jacent ne baisse pas de plus de ' + (100 - barrier) + '% sur ' + matYears + ' ans (barrière à ' + barrier + '%). ';
      html += 'Si barrière touchée → perte proportionnelle à la baisse (ex: sous-jacent à 50% → perte de 50% soit -' + formatNumber(nominal * 0.5) + '€).</div>';
    } else if (isProtected) {
      var _gtt = (p.capitalProtection && p.capitalProtection.guaranteeType) === 'garantie';
      html += '<div style="padding:8px;background:' + (_gtt ? '#ECFDF5' : '#FFF7ED') + ';border:1px solid ' + (_gtt ? '#6EE7B7' : '#FDBA74') + ';border-radius:6px;font-size:11px;color:' + (_gtt ? '#065F46' : '#92400E') + ';margin-bottom:6px">';
      html += _gtt ? '✅ <strong>Capital 100% garanti</strong> à l\'échéance (garantie externe).</div>'
                   : '🛡️ <strong>Capital protégé à 100% à l\'échéance</strong> par la formule — soumis au risque de crédit émetteur (pas une garantie).</div>';
    }

    html += '</div>';
    html += '</div>';
  }

  // ─── Stress test 3 scénarios (pour produits actions) ──────
  if (!isRate && barrier) {
    html += '<div style="padding:12px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;margin-bottom:8px">';
    html += '<div style="font-size:12px;font-weight:700;color:#DC2626;margin-bottom:6px">🔥 Stress Test — Votre capital dans 3 crises historiques</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">';

    var stresses = [
      { name: '2008 Financière', drop: -55, color: '#DC2626' },
      { name: '2020 COVID', drop: -35, color: '#D97706' },
      { name: '2022 Inflation', drop: -22, color: '#D97706' }
    ];
    stresses.forEach(function(s) {
      var finalLevel = 100 + s.drop;
      var breached = finalLevel < barrier;
      var capitalLoss = breached ? Math.round((1 - finalLevel / 100) * 100) : 0;
      html += '<div style="padding:8px;background:white;border-radius:6px;text-align:center;border-left:3px solid ' + s.color + '">';
      html += '<div style="font-size:11px;font-weight:700;color:' + s.color + '">' + s.name + '</div>';
      html += '<div style="font-size:11px;color:#475569">Sous-jacent : ' + s.drop + '%</div>';
      if (breached) {
        html += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:#DC2626">-' + capitalLoss + '% capital</div>';
      } else {
        html += '<div style="font-family:var(--mono);font-size:14px;font-weight:800;color:#059669">Capital protégé ✅</div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
  }

  return html;
}

// Simple normal CDF approximation for investor metrics
function _normcdfApprox(x) {
  var t = 1 / (1 + 0.2316419 * Math.abs(x));
  var d = 0.3989422804 * Math.exp(-x * x / 2);
  var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}

function renderScorePanel(score) {
  return `<div class="sheet-card score-panel"><h3 class="sheet-card-title">Score de Compatibilité</h3><div class="score-big">${renderScoreWidget(score)}</div><div class="score-verdict">${score.verdict}</div><div class="score-details">${score.details.map(d=>`<div class="score-detail ${d.type}"><span class="score-detail-icon">${d.icon}</span><span class="score-detail-text">${d.text}</span></div>`).join('')}</div></div>`;
}

// ═══ CHAT ═══
function renderChat(container, state) {
  const p = state.currentProduct; if (!p) return; const messages = p.conversation||[]; const bank = BANKS.find(b => b.id === p.bankId);
  container.innerHTML = `<div class="chat-layout">
    <div class="chat-header"><button class="btn ghost" onclick="app.openProduct(app.state.currentProduct)">← Fiche</button>
      <div class="chat-header-info"><div class="chat-header-name">${p.name||'Produit'}</div><div class="chat-header-bank">${bank?.name||''}</div></div>
      <div class="chat-header-actions"><button class="btn sm success" onclick="handleSummarizeAndDecide('subscribed')">✅ Résumer & Intégrer</button>
        <button class="btn sm danger" onclick="handleSummarizeAndDecide('rejected')">❌ Résumer & Rejeter</button></div></div>
    <div class="chat-messages" id="chat-messages">
      <div class="chat-msg system"><div class="chat-msg-content">💡 Discussion sur <strong>${p.name||'ce produit'}</strong>.</div></div>
      ${messages.map(m=>`<div class="chat-msg ${m.role}"><div class="chat-msg-avatar">${m.role==='user'?'👤':'🤖'}</div><div class="chat-msg-content">${m.role==='assistant'?formatAIText(m.content):escapeHTML(m.content)}</div></div>`).join('')}</div>
    <div class="chat-input-area"><textarea id="chat-input" class="chat-input" placeholder="Posez une question..." onkeydown="handleChatKeydown(event)"></textarea>
      <button class="btn primary" onclick="handleSendChat()" id="chat-send-btn">Envoyer</button></div></div>`;
  const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight;
}

// ═══ MODALS ═══
function showAddPortfolioModal() { showUploadModal('portfolio', null); }
function showAddProposalModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">Nouvelle proposition — Choisir la banque</h2>
    <div class="bank-select-grid">${BANKS.map(b=>`<button class="bank-select-btn" style="--bank-color:${b.color}" onclick="showUploadModal('proposal','${b.id}')"><span class="bank-select-dot" style="background:${b.color}"></span>${b.name}</button>`).join('')}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button></div></div></div>`;
  modal.classList.add('visible');
}
function showUploadModal(context, bankId) {
  const modal = document.getElementById('modal'); const bank = BANKS.find(b => b.id === bankId);
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="modal-title">${context==='portfolio'?'Ajouter au portefeuille':`Proposition — ${bank?.name||''}`}</h2>
    <div class="upload-zone" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handleFileDrop(event,'${context}','${bankId||''}')">
      <div class="upload-icon">📄</div><div class="upload-text">Glisser le PDF ici</div><div class="upload-sub">ou cliquer pour sélectionner</div>
      <input type="file" accept=".pdf" id="file-input" style="display:none" onchange="handleFileSelect(event,'${context}','${bankId||''}')"></div>
    <button class="btn" style="width:100%;margin-top:12px" onclick="document.getElementById('file-input').click()">Choisir un fichier PDF</button>
    <div class="upload-divider"><span>ou</span></div>
    <button class="btn" style="width:100%;background:rgba(59,130,246,0.08);border-color:rgba(59,130,246,0.25);color:var(--accent)" onclick="toggleJSONPasteZone('${context}','${bankId||''}')">📋 Coller JSON (depuis l'analyseur)</button>
    <div id="json-paste-zone" style="display:none;margin-top:12px">
      <textarea id="json-paste-input" placeholder="Colle ici le JSON généré par l'analyseur de brochure..." style="width:100%;height:120px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:11px;padding:10px;resize:vertical;box-sizing:border-box;outline:none"></textarea>
      <button class="btn primary" style="width:100%;margin-top:8px" onclick="handleJSONPasteImport('${context}','${bankId||''}')">✅ Importer le produit</button>
    </div>
    <div style="margin-top:8px">
      <button class="btn ghost" style="width:100%" onclick="showManualEntryModal('${context}','${bankId||''}')">✏️ Saisie manuelle</button>
    </div>
    <div id="upload-progress" class="upload-progress hidden"><div class="spinner"></div><span id="upload-status">Extraction...</span></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button></div></div></div>`;
  modal.classList.add('visible');
}

// V3.1: Toggle JSON paste zone
window.toggleJSONPasteZone = function(context, bankId) {
  var zone = document.getElementById('json-paste-zone');
  if (zone) {
    zone.style.display = zone.style.display === 'none' ? 'block' : 'none';
    if (zone.style.display !== 'none') {
      var input = document.getElementById('json-paste-input');
      if (input) input.focus();
    }
  }
};

// V3.1: Import product from pasted JSON
window.handleJSONPasteImport = async function(context, bankId) {
  var input = document.getElementById('json-paste-input');
  if (!input || !input.value.trim()) {
    showToast('Colle un JSON valide', 'error');
    return;
  }

  try {
    var json = JSON.parse(input.value.trim());
    console.log('[UI V3.1] JSON paste import:', json.name || 'unnamed');

    // Build product from JSON
    var product = {
      id: app._uid(),
      name: json.name || 'Produit importé',
      type: json.type || json.structureType || 'autre',
      structureType: json.structureType || '',
      emitter: json.emitter || '',
      guarantor: json.guarantor || '',
      guarantorRating: json.guarantorRating || null,
      underlyings: json.underlyings || [],
      underlyingType: json.underlyingType || 'autre',
      currency: json.currency || 'EUR',
      maturity: json.maturity || '',
      maturityYears: json.maturityYears || null,
      coupon: json.coupon || {},
      participationRate: json.participationRate || null,
      capitalProtection: json.capitalProtection || {},
      earlyRedemption: json.earlyRedemption || {},
      decrementPct: json.decrementPct || null,
      actualDividendYield: json.actualDividendYield || null,
      mechanism: json.mechanism || '',
      risks: json.risks || [],
      summary: json.summary || '',
      aiParsed: json,
      sourceFile: 'JSON import'
    };

    // Coupon normalization
    if (typeof product.coupon === 'number') {
      product.coupon = { rate: product.coupon };
    }

    closeModal();

    if (context === 'portfolio') {
      var amount = prompt('Montant investi (€) :');
      if (amount) {
        product.bankId = bankId || '';
        await app.addToPortfolio(product, amount);
      }
    } else {
      var saved = await app.addProposal(bankId, product);
      // Auto-analyze
      if (typeof analyzeProposal === 'function') {
        analyzeProposal(saved).catch(function() {});
      }
      showToast('✅ ' + product.name + ' importé !', 'success');
      app.openProduct(saved);
      return;
    }
    app.render();
  } catch(e) {
    console.error('[UI V3.1] JSON parse error:', e);
    showToast('JSON invalide: ' + e.message, 'error');
  }
};

function showManualEntryModal(context, bankId) {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()">
    <h2 class="modal-title">Saisie manuelle</h2><div class="form-grid">
      <div class="form-field full"><label>Nom du produit</label><input id="f-name" placeholder="Ex: Phoenix Autocall Eurostoxx Q1-2025"></div>
      ${context==='portfolio'?`<div class="form-field"><label>Banque</label><select id="f-bank"><option value="">Sélectionner...</option>${BANKS.map(b=>`<option value="${b.id}" ${b.id===bankId?'selected':''}>${b.name}</option>`).join('')}</select></div>`:''}
      <div class="form-field"><label>Type</label><select id="f-type"><option value="">Sélectionner...</option>${PRODUCT_TYPES.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Sous-jacent</label><select id="f-underlying"><option value="">Sélectionner...</option>${UNDERLYINGS.map(u=>`<option value="${u.id}">${u.name}</option>`).join('')}</select></div>
      <div class="form-field"><label>Maturité</label><input id="f-maturity" placeholder="Ex: 5 ans"></div>
      <div class="form-field"><label>Coupon (%)</label><input id="f-coupon" type="number" step="0.01" placeholder="8.5"></div>
      <div class="form-field"><label>Type coupon</label><select id="f-coupon-type"><option value="conditionnel">Conditionnel</option><option value="fixe">Fixe</option><option value="memoire">Mémoire</option></select></div>
      <div class="form-field"><label>Barrière (%)</label><input id="f-barrier" type="number" step="0.1" placeholder="60"></div>
      <div class="form-field"><label>Protection (%)</label><input id="f-protection" type="number" step="0.1" placeholder="100"></div>
      <div class="form-field"><label>Autocall</label><select id="f-autocall"><option value="true">Oui</option><option value="false">Non</option></select></div>
      ${context==='portfolio'?`<div class="form-field"><label>Montant investi (€)</label><input id="f-invested" type="number" placeholder="50000"></div>`:''}
      <div class="form-field full"><label>Notes</label><textarea id="f-notes" placeholder="Détails..."></textarea></div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleManualSave('${context}','${bankId||''}')">Enregistrer</button></div></div></div>`;
}
function showIntegrateModal(productId, bankId) {
  const modal = document.getElementById('modal');
  const product = app._findProduct(productId, bankId);
  const pName = product ? (product.name || 'Produit').substring(0, 40) : 'Produit';
  const entOpts = (typeof MY_ENTITIES !== 'undefined' ? MY_ENTITIES : []).map(e =>
    `<option value="${e.id}">${e.icon || ''} ${e.name}</option>`
  ).join('');

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:560px">
    <h2 class="modal-title">Intégrer au portefeuille</h2>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${escapeHTML(pName)}</div>

    <div id="integrate-contracts">
      <div class="integrate-row" style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:10px">
        <div class="form-field" style="margin:0"><label>Entreprise</label><select class="int-entity">${entOpts}</select></div>
        <div class="form-field" style="margin:0"><label>Montant (€)</label><input class="int-amount" type="number" placeholder="100000" autofocus></div>
        <button class="btn sm" onclick="this.closest('.integrate-row').remove()" style="color:var(--red);margin-bottom:2px" title="Retirer">✕</button>
      </div>
    </div>

    <button class="btn sm" onclick="_addIntegrateRow()" style="margin-bottom:16px;color:var(--accent);border-color:var(--accent)">+ Ajouter un contrat</button>

    <div id="integrate-summary" style="padding:10px;background:rgba(6,214,160,0.05);border-radius:8px;margin-bottom:16px;font-size:12px;color:var(--text-muted)">
      Total : <strong id="integrate-total">0€</strong>
    </div>

    <div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrateMulti('${productId}','${bankId}')">✅ Intégrer</button></div></div></div>`;
  modal.classList.add('visible');

  // Live total update
  modal.addEventListener('input', _updateIntegrateTotal);
  _updateIntegrateTotal();
}

function _addIntegrateRow() {
  const container = document.getElementById('integrate-contracts');
  if (!container) return;
  const entOpts = (typeof MY_ENTITIES !== 'undefined' ? MY_ENTITIES : []).map(e =>
    `<option value="${e.id}">${e.icon || ''} ${e.name}</option>`
  ).join('');
  const row = document.createElement('div');
  row.className = 'integrate-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:10px';
  row.innerHTML = `
    <div class="form-field" style="margin:0"><label>Entreprise</label><select class="int-entity">${entOpts}</select></div>
    <div class="form-field" style="margin:0"><label>Montant (€)</label><input class="int-amount" type="number" placeholder="100000"></div>
    <button class="btn sm" onclick="this.closest('.integrate-row').remove();_updateIntegrateTotal()" style="color:var(--red);margin-bottom:2px" title="Retirer">✕</button>`;
  container.appendChild(row);
  row.querySelector('.int-amount')?.focus();
}

function _updateIntegrateTotal() {
  const amounts = document.querySelectorAll('.int-amount');
  let total = 0;
  amounts.forEach(a => { total += parseFloat(a.value) || 0; });
  const el = document.getElementById('integrate-total');
  if (el) el.textContent = (typeof formatNumber === 'function' ? formatNumber(total) : total) + '€';
}
function closeModal() { const m = document.getElementById('modal'); m.classList.remove('visible'); setTimeout(()=>{m.innerHTML='';},300); }

// ═══ EVENT HANDLERS ═══
function toggleBankSection(bankId) { app.state.bankSections[bankId] = app.state.bankSections[bankId]===false; app.render(); }
async function handleFileDrop(event, context, bankId) { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && file.type === 'application/pdf') await processUploadedFile(file, context, bankId); }
async function handleFileSelect(event, context, bankId) { const file = event.target.files[0]; if (file) await processUploadedFile(file, context, bankId); }

async function processUploadedFile(file, context, bankId) {
  const progress = document.getElementById('upload-progress'); const status = document.getElementById('upload-status');
  if (progress) progress.classList.remove('hidden');
  try {
    if (status) status.textContent = 'Extraction du texte PDF...';
    const product = await app.handlePDFUpload(file, bankId);
    if (status) status.textContent = 'Analyse terminée !'; closeModal();
    if (context === 'portfolio') { const amount = prompt('Montant investi (€) :'); if (amount) { product.bankId = bankId || product.bankId; await app.addToPortfolio(product, amount); } }
    else { await app.addProposal(bankId, product); }
    app.render();
  } catch (e) { if (status) status.textContent = 'Erreur: ' + e.message; if (progress) progress.classList.add('error'); }
}

function handleManualSave(context, bankId) {
  const product = { id: app._uid(), name: document.getElementById('f-name')?.value||'', bankId: bankId||document.getElementById('f-bank')?.value||'',
    type: document.getElementById('f-type')?.value||'autre', underlyingType: document.getElementById('f-underlying')?.value||'autre', underlyings: [],
    maturity: document.getElementById('f-maturity')?.value||'',
    coupon: { rate: document.getElementById('f-coupon')?.value||null, type: document.getElementById('f-coupon-type')?.value||'conditionnel' },
    capitalProtection: { barrier: document.getElementById('f-barrier')?.value||null, level: document.getElementById('f-protection')?.value||null, protected: !!(document.getElementById('f-protection')?.value) },
    earlyRedemption: { possible: document.getElementById('f-autocall')?.value==='true', type: document.getElementById('f-autocall')?.value==='true'?'autocall':'none' },
    notes: document.getElementById('f-notes')?.value||'' };
  closeModal();
  if (context === 'portfolio') { app.addToPortfolio(product, document.getElementById('f-invested')?.value||0); }
  else { app.addProposal(bankId, product); }
}

async function handleIntegrate(productId, bankId) {
  const amount = document.getElementById('f-integrate-amount')?.value; if (!amount) { showToast('Montant requis','error'); return; }
  const product = app._findProduct(productId, bankId); if (!product) return; closeModal();
  await app.updateProposalStatus(bankId, productId, 'subscribed'); await app.addToPortfolio({...product}, amount); app.goToDashboard();
}

async function handleIntegrateMulti(productId, bankId) {
  const rows = document.querySelectorAll('.integrate-row');
  if (rows.length === 0) { showToast('Ajoutez au moins un contrat', 'error'); return; }

  const contracts = [];
  rows.forEach(row => {
    const entity = row.querySelector('.int-entity')?.value || '';
    const amount = parseFloat(row.querySelector('.int-amount')?.value) || 0;
    if (amount > 0) contracts.push({ entity, amount });
  });

  if (contracts.length === 0) { showToast('Montant requis', 'error'); return; }

  const product = app._findProduct(productId, bankId);
  if (!product) return;
  closeModal();

  // Mark proposal as subscribed
  await app.updateProposalStatus(bankId, productId, 'subscribed');

  // Add each contract as a separate portfolio entry
  for (let i = 0; i < contracts.length; i++) {
    const c = contracts[i];
    const copy = JSON.parse(JSON.stringify(product));
    copy.id = app._uid(); // unique ID for each contract
    copy.envelope = c.entity;
    copy.entity = c.entity;
    if (contracts.length > 1) {
      const entName = (typeof MY_ENTITIES !== 'undefined' ? MY_ENTITIES.find(e => e.id === c.entity)?.name : c.entity) || c.entity;
      copy.name = (product.name || 'Produit') + ' (' + entName + ')';
    }
    await app.addToPortfolio(copy, c.amount);
  }

  showToast(contracts.length + ' contrat' + (contracts.length > 1 ? 's' : '') + ' intégré' + (contracts.length > 1 ? 's' : ''), 'success');
  app.goToDashboard();
}

// ─── REJETER: change le statut mais garde le produit ────────
async function handleReject(productId, bankId) {
  if (!confirm('Rejeter cette proposition ?')) return;
  try {
    const resolvedBankId = _resolveBankId(productId, bankId);
    if (!resolvedBankId) { showToast('Erreur: banque introuvable pour ce produit', 'error'); return; }

    const product = app._findProduct(productId, resolvedBankId);
    if (product?.conversation?.length > 0) {
      showToast('Résumé en cours...','info');
      await app.summarizeAndDecide(productId, resolvedBankId, 'rejected');
    }
    await app.updateProposalStatus(resolvedBankId, productId, 'rejected', 'Rejeté manuellement');
    showToast('Proposition rejetée', 'success');
    app.goToDashboard();
  } catch (e) { showToast('Erreur: ' + e.message, 'error'); console.error(e); }
}

// ─── SUPPRIMER: retire complètement le produit ──────────────
async function handleDelete(productId, bankId) {
  if (!confirm('Supprimer définitivement cette proposition ? Cette action est irréversible.')) return;
  try {
    const resolvedBankId = _resolveBankId(productId, bankId);
    if (resolvedBankId) {
      await app.removeProposal(resolvedBankId, productId);
    }
    const inPortfolio = app.state.portfolio.find(p => p.id === productId);
    if (inPortfolio) {
      await app.removeFromPortfolio(productId);
    }
    showToast('Produit supprimé', 'success');
    app.goToDashboard();
  } catch (e) { showToast('Erreur: ' + e.message, 'error'); console.error(e); }
}

// ─── Résoudre le bankId même s'il est vide/undefined ────────
function _resolveBankId(productId, bankId) {
  if (bankId && bankId !== 'undefined' && bankId !== 'null' && app.state.proposals[bankId]) {
    const found = app.state.proposals[bankId].find(p => p.id === productId);
    if (found) return bankId;
  }
  for (const [bId, proposals] of Object.entries(app.state.proposals)) {
    if (proposals.find(p => p.id === productId)) return bId;
  }
  return null;
}

async function handleSendChat() {
  const input = document.getElementById('chat-input'); const btn = document.getElementById('chat-send-btn');
  if (!input||!input.value.trim()) return; const message = input.value.trim(); input.value = ''; btn.disabled = true; btn.textContent = '...';
  try { const p = app.state.currentProduct; await app.sendChatMessage(p.id, p.bankId, message); renderChat(document.getElementById('main-content'), app.state); }
  catch (e) { showToast('Erreur: '+e.message,'error'); } btn.disabled = false; btn.textContent = 'Envoyer';
}
function handleChatKeydown(event) { if (event.key==='Enter'&&!event.shiftKey) { event.preventDefault(); handleSendChat(); } }

async function handleSummarizeAndDecide(decision) {
  const label = decision==='subscribed'?'intégrer':'rejeter'; if (!confirm(`Résumer et ${label} ?`)) return;
  const p = app.state.currentProduct; showToast('Résumé en cours...','info');
  try { await app.summarizeAndDecide(p.id,p.bankId,decision);
    if (decision==='subscribed') { const amount = prompt('Montant investi (€):'); if (amount) await app.addToPortfolio({...p},amount); }
    await app.updateProposalStatus(p.bankId,p.id,decision);
    showToast(decision==='subscribed'?'Produit intégré!':'Produit rejeté','success'); app.goToDashboard();
  } catch(e) { showToast('Erreur: '+e.message,'error'); }
}

function renderSpec(label, value) { return `<div class="spec-item"><span class="spec-label">${label}</span><span class="spec-value">${value}</span></div>`; }
function formatAIText(text) { if (!text) return ''; return escapeHTML(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'); }
function escapeHTML(str) { const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — CAT/PS Analyse IA + Chat
// Analyse qualitative du portefeuille + discussion interactive
// Sauvegardé sur GitHub
// ═══════════════════════════════════════════════════════════════

let catAIConversation = [];
let catAIAnalysis = null;

// ─── Générer le contexte portefeuille pour Claude ───────
function buildCATPortfolioContext() {
  const stats = catManager.getStats();
  const active = catManager.deposits.filter(d => d.status === 'active');
  const timeline = catManager.getMaturityTimeline();

  const depositsDetail = active.map(d => {
    const type = d.productType === 'parts-sociales' ? 'Parts Sociales' : 'CAT';
    const exit = EXIT_CONDITIONS.find(e => e.id === d.exitCondition)?.name || d.exitCondition;
    return `- ${type} | ${d.bankName} | "${d.productName || 'Sans nom'}" | ${d.amount}€ | ${d.rate}% ${d.rateType || 'fixe'} | ${d.durationMonths ? d.durationMonths + ' mois' : 'Indéterminée'} | Échéance: ${d.maturityDate || 'N/A'} | Sortie: ${exit} | Pénalité: ${d.exitPenalty || 'Aucune'} | Intérêts: ${d.interestPayment || 'maturité'} | Auto-renew: ${d.autoRenew ? 'Oui' : 'Non'}`;
  }).join('\n');

  const ratesDetail = catManager.rates.rates.length > 0
    ? catManager.rates.rates.map(r => `- ${r.bankName} | ${r.productType} | ${r.durationMonths} mois | ${r.rate}%`).join('\n')
    : 'Aucun taux renseigné';

  const timelineDetail = timeline.map(m => `- ${m.month}: ${m.total}€ (${m.deposits.length} placements)`).join('\n');

  const bankConcentration = Object.entries(stats.byBank).map(([id, v]) => `- ${v.name}: ${v.total}€ (${v.count} placements, ${v.cats} CAT, ${v.ps} PS)`).join('\n');

  return `PORTEFEUILLE ÉPARGNE (CAT + PARTS SOCIALES)
========================================
Total placé: ${stats.totalInvested}€
Nombre placements: ${stats.totalDeposits} (${stats.catCount} CAT, ${stats.psCount} Parts Sociales)
Taux pondéré: ${stats.weightedRate.toFixed(2)}%
Intérêts estimés: ${stats.totalInterest}€

OBJECTIFS:
Besoin mensuel: ${catManager.objectives.monthlyNeed}€
Réserve liquidité: ${catManager.objectives.liquidityReserve}€
Plafond FGDR/banque: ${catManager.objectives.maxPerBank}€
${catManager.objectives.notes ? 'Notes: ' + catManager.objectives.notes : ''}

DÉTAIL DES PLACEMENTS:
${depositsDetail || 'Aucun placement'}

CONCENTRATION PAR BANQUE:
${bankConcentration || 'N/A'}

ÉCHÉANCIER MATURITÉS:
${timelineDetail || 'Aucune maturité'}

TAUX DU MARCHÉ RENSEIGNÉS:
${ratesDetail}

ALERTES FGDR: ${stats.fgdrAlerts.length > 0 ? stats.fgdrAlerts.map(([,v]) => v.name + ' (' + v.total + '€)').join(', ') : 'Aucune'}`;
}

// ─── Analyse IA complète du portefeuille ─────────────────
async function runCATAIAnalysis() {
  const context = buildCATPortfolioContext();

  const prompt = `Tu es un conseiller en gestion de patrimoine spécialisé en épargne. Analyse ce portefeuille de Comptes à Terme et Parts Sociales.

${context}

Fournis une analyse COMPLÈTE et DIRECTE:

1. **DIAGNOSTIC** — État global du portefeuille: diversification, rendement, liquidité, risques
2. **CONCENTRATIONS** — Risques de concentration par banque (FGDR), par durée, par type
3. **RENDEMENT** — Le taux pondéré est-il bon vs le marché actuel? Quels placements sous-performent?
4. **ARBITRAGES RECOMMANDÉS** — Quels placements arrêter, renouveler, augmenter? Quelles banques privilégier?
5. **OPTIMISATION** — Si on devait ré-allouer tout le portefeuille aujourd'hui, comment le structurer?
6. **RISQUES** — Risques de taux (baisse des taux à venir?), liquidité, contrepartie
7. **POINTS D'ATTENTION** — Pénalités de sortie, renew auto à surveiller, échéances clés

Sois direct, quantitatif, contrarian si nécessaire. Pas de langue de bois.`;

  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  return data.content?.map(b => b.text || '').join('\n') || 'Pas de réponse.';
}

// ─── Chat IA sur le portefeuille ───────────────────────
async function sendCATChatMessage(userMessage) {
  const context = buildCATPortfolioContext();

  catAIConversation.push({ role: 'user', content: userMessage, timestamp: Date.now() });

  const systemPrompt = `Tu es un conseiller en gestion de patrimoine expert en épargne (CAT, parts sociales, placements à taux fixe).

Voici le portefeuille du client:
${context}

${catAIAnalysis ? 'ANALYSE PRÉCÉDENTE:\n' + catAIAnalysis : ''}

Règles:
- Sois direct, précis, quantitatif
- Challenge les hypothèses si nécessaire
- Mentionne les risques (taux, FGDR, liquidité, pénalités)
- Compare avec les taux du marché quand possible
- Si on te demande une recommandation, donne-la franchement avec pour ET contre
- Propose des alternatives concrètes`;

  const messages = catAIConversation.map(m => ({ role: m.role, content: m.content }));

  const res = await fetch(CONFIG.AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: systemPrompt, messages }),
  });
  if (!res.ok) throw new Error('Erreur IA: ' + res.status);
  const data = await res.json();
  const response = data.content?.map(b => b.text || '').join('\n') || '';

  catAIConversation.push({ role: 'assistant', content: response, timestamp: Date.now() });

  // Sauvegarder la conversation sur GitHub
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, {
    lastUpdated: new Date().toISOString(),
    analysis: catAIAnalysis,
    conversation: catAIConversation,
  }, '[StructBoard] Update CAT AI conversation');

  return response;
}

// ─── Charger la conversation précédente ─────────────────
async function loadCATAIConversation() {
  const data = await github.readFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`);
  if (data) {
    catAIConversation = data.conversation || [];
    catAIAnalysis = data.analysis || null;
  }
}

// ═══ UI: Vue Analyse IA ════════════════════════════════════════

function showCATAnalysis() {
  const container = document.getElementById('main-content');

  container.innerHTML = `
    <div class="sheet-nav">
      <button class="btn ghost" onclick="switchMainView('cat')">← Retour Placements</button>
      <div class="sheet-nav-title">🧠 Analyse IA du Portefeuille</div>
      <div class="sheet-nav-actions">
        <button class="btn" onclick="resetCATChat()">Nouvelle conversation</button>
      </div>
    </div>

    <div class="sheet-layout">
      <!-- Colonne gauche: Analyse -->
      <div class="sheet-main">
        <div class="sheet-card">
          <h3 class="sheet-card-title"><span class="card-icon">🧠</span> Analyse Complète</h3>
          <div id="cat-ai-analysis-content">
            ${catAIAnalysis
              ? `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>`
              : `<div style="text-align:center;padding:30px">
                  <p style="color:var(--text-muted);margin-bottom:16px">Claude va analyser votre portefeuille complet: concentrations, rendement, risques, arbitrages.</p>
                  <button class="btn ai-glow lg" onclick="launchCATAnalysis()">🚀 Lancer l'analyse IA</button>
                </div>`
            }
          </div>
        </div>

        <!-- Chat -->
        <div class="sheet-card" style="min-height:400px;display:flex;flex-direction:column">
          <h3 class="sheet-card-title"><span class="card-icon">💬</span> Discussion</h3>
          <div id="cat-chat-messages" style="flex:1;overflow-y:auto;max-height:400px;margin-bottom:12px">
            <div class="chat-msg system"><div class="chat-msg-content">
              💡 Posez vos questions sur votre portefeuille. Claude a accès à tous vos placements, taux, objectifs et à l'analyse.
            </div></div>
            ${catAIConversation.map(m => `
              <div class="chat-msg ${m.role}">
                <div class="chat-msg-avatar">${m.role === 'user' ? '👤' : '🤖'}</div>
                <div class="chat-msg-content">${m.role === 'assistant' ? formatAIText(m.content) : escapeHTML(m.content)}</div>
              </div>
            `).join('')}
          </div>
          <div class="chat-input-area">
            <textarea id="cat-chat-input" class="chat-input" placeholder="Ex: Dois-je renouveler mon CAT SG? Mon taux est-il compétitif? Comment réduire ma concentration?"
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCATChat()}"></textarea>
            <button class="btn primary" onclick="sendCATChat()" id="cat-chat-send">Envoyer</button>
          </div>
        </div>
      </div>

      <!-- Colonne droite: Résumé portefeuille -->
      <div class="sheet-sidebar">
        <div class="sheet-card">
          <h3 class="sheet-card-title">Portefeuille</h3>
          ${renderCATSidebarStats()}
        </div>
        <div class="sheet-card">
          <h3 class="sheet-card-title">Actions rapides</h3>
          <div class="action-buttons">
            <button class="btn ai-glow" style="width:100%" onclick="launchCATAnalysis()">🚀 Re-analyser</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels placements sous-performent?')">Sous-performances?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels arbitrages recommandes-tu?')">Arbitrages?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Mon portefeuille est-il bien diversifié?')">Diversification?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Quels risques vois-tu?')">Risques?</button>
            <button class="btn" style="width:100%" onclick="askCATQuestion('Si les taux baissent de 1%, quel impact sur mes renouvellements?')">Impact taux?</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Scroll chat to bottom
  const chatEl = document.getElementById('cat-chat-messages');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
}

function renderCATSidebarStats() {
  const stats = catManager.getStats();
  return `
    <div style="font-size:12px;line-height:1.8">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Total placé</span><span style="font-family:var(--mono);color:var(--text-bright)">${formatNumber(stats.totalInvested)}€</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Taux pondéré</span><span style="font-family:var(--mono);color:var(--green)">${formatPct(stats.weightedRate)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Intérêts</span><span style="font-family:var(--mono);color:var(--green)">+${formatNumber(stats.totalInterest)}€</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">CAT</span><span>${stats.catCount} (${formatNumber(stats.catTotal)}€)</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Parts Sociales</span><span>${stats.psCount} (${formatNumber(stats.psTotal)}€)</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">Banques</span><span>${Object.keys(stats.byBank).length}</span></div>
      ${stats.fgdrAlerts.length > 0 ? `<div style="color:var(--red);margin-top:8px">⚠️ FGDR: ${stats.fgdrAlerts.length} alerte(s)</div>` : ''}
    </div>
  `;
}

async function launchCATAnalysis() {
  const content = document.getElementById('cat-ai-analysis-content');
  content.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse en cours... Claude examine votre portefeuille complet.</div>';

  try {
    catAIAnalysis = await runCATAIAnalysis();
    content.innerHTML = `<div class="ai-summary">${formatAIText(catAIAnalysis)}</div>`;

    // Sauvegarder
    await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, {
      lastUpdated: new Date().toISOString(),
      analysis: catAIAnalysis,
      conversation: catAIConversation,
    }, '[StructBoard] CAT AI analysis');

    showToast('Analyse terminée', 'success');
  } catch (e) {
    content.innerHTML = `<div style="color:var(--red);padding:20px">Erreur: ${e.message}</div>`;
  }
}

async function sendCATChat() {
  const input = document.getElementById('cat-chat-input');
  const btn = document.getElementById('cat-chat-send');
  if (!input || !input.value.trim()) return;

  const message = input.value.trim();
  input.value = '';
  btn.disabled = true; btn.textContent = '...';

  // Ajouter le message user au DOM immédiatement
  const chatEl = document.getElementById('cat-chat-messages');
  chatEl.innerHTML += `<div class="chat-msg user"><div class="chat-msg-avatar">👤</div><div class="chat-msg-content">${escapeHTML(message)}</div></div>`;
  chatEl.innerHTML += `<div class="chat-msg assistant" id="cat-typing"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content"><div class="spinner" style="display:inline-block"></div> Réflexion...</div></div>`;
  chatEl.scrollTop = chatEl.scrollHeight;

  try {
    const response = await sendCATChatMessage(message);
    const typing = document.getElementById('cat-typing');
    if (typing) typing.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content">${formatAIText(response)}</div></div>`;
    chatEl.scrollTop = chatEl.scrollHeight;
  } catch (e) {
    const typing = document.getElementById('cat-typing');
    if (typing) typing.outerHTML = `<div class="chat-msg assistant"><div class="chat-msg-avatar">🤖</div><div class="chat-msg-content" style="color:var(--red)">Erreur: ${e.message}</div></div>`;
  }

  btn.disabled = false; btn.textContent = 'Envoyer';
}

function askCATQuestion(question) {
  const input = document.getElementById('cat-chat-input');
  if (input) { input.value = question; sendCATChat(); }
}

async function resetCATChat() {
  if (catAIConversation.length > 0 && !confirm('Effacer la conversation?')) return;
  catAIConversation = [];
  catAIAnalysis = null;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/ai-conversation.json`, { lastUpdated: new Date().toISOString(), analysis: null, conversation: [] }, '[StructBoard] Reset CAT AI conversation');
  showToast('Conversation réinitialisée', 'success');
  showCATAnalysis();
}

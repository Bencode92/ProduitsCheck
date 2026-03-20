// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Bank Rate Scanner V3 — Fix web_search response parsing
// ═══════════════════════════════════════════════════════════════

const SCAN_BANKS = [
  { id: 'bnp', name: 'BNP Paribas' },
  { id: 'credit-agricole', name: 'Crédit Agricole' },
  { id: 'lcl', name: 'LCL' },
  { id: 'hsbc', name: 'HSBC France' },
  { id: 'bred', name: 'BRED' },
  { id: 'caisse-epargne', name: "Caisse d'Epargne" },
  { id: 'credit-mutuel', name: 'Crédit Mutuel' },
  { id: 'la-banque-postale', name: 'La Banque Postale' },
];

function showBankScannerModal() {
  const modal = document.getElementById('modal');
  const existingBanks = new Set((catManager.rates?.rates || []).map(r => r.bankId));
  const scannedBanks = new Set((catManager.rates?.rates || []).filter(r => r.source === 'web scan').map(r => r.bankId));

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">🔍 Scanner les taux bancaires</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Claude recherche les taux CAT actuels. Résultats <strong>automatiquement sauvegardés</strong>.</p>
    <div style="margin-bottom:16px">
      <h3 style="font-size:12px;color:var(--text-bright);margin-bottom:8px">Banques à scanner</h3>
      <div id="scan-banks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
        ${SCAN_BANKS.map(b => {
          const hasManual = existingBanks.has(b.id) && !scannedBanks.has(b.id);
          const hasScanned = scannedBanks.has(b.id);
          return `<label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;font-size:12px" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
            <input type="checkbox" value="${b.id}" ${!hasManual ? 'checked' : ''} style="accent-color:var(--accent)">
            <span style="color:var(--text-bright);font-weight:500">${b.name}</span>
            ${hasScanned ? '<span style="font-size:9px;color:var(--cyan)">🔄</span>' : ''}
            ${hasManual ? '<span style="font-size:9px;color:var(--green)">✅</span>' : ''}
          </label>`;
        }).join('')}
      </div>
    </div>
    <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">
      <strong style="color:var(--accent)">ℹ️</strong> Taux web = indicatifs. En entreprise, négociez +0.1 à +0.5%.
    </div>
    <button class="btn ai-glow lg" style="width:100%" onclick="runBankScan()">🚀 Scanner et sauvegarder</button>
    <div id="scan-results" style="margin-top:16px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

// Extract JSON from mixed API response (web_search returns tool_use blocks + text)
function _extractJSONFromResponse(data) {
  let allText = '';

  // Collect ALL text blocks from the response
  if (data.content && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        allText += block.text + '\n';
      }
    }
  }

  // If no text found, the response might need follow-up (shouldn't happen with server-side tools)
  if (!allText.trim()) {
    throw new Error('Pas de réponse texte de Claude. Réessayez.');
  }

  // Try to extract JSON from the text (may have preamble/postamble)
  // Method 1: Direct parse
  const cleaned = allText.replace(/^```json?\s*/im, '').replace(/\s*```$/im, '').trim();
  try { return JSON.parse(cleaned); } catch(e) {}

  // Method 2: Find JSON object in text
  const jsonMatch = allText.match(/\{[\s\S]*"banks"[\s\S]*\}/);
  if (jsonMatch) {
    try { return repairJSON(jsonMatch[0]); } catch(e) {}
  }

  // Method 3: Find anything that looks like JSON
  const anyJson = allText.match(/\{[\s\S]*\}/);
  if (anyJson) {
    try { return repairJSON(anyJson[0]); } catch(e) {}
  }

  // Method 4: Try repairJSON on the full text
  try { return repairJSON(allText); } catch(e) {}

  throw new Error('Impossible de parser la réponse. Texte reçu: ' + allText.substring(0, 200));
}

async function runBankScan() {
  const checkboxes = document.querySelectorAll('#scan-banks input[type=checkbox]:checked');
  const selectedIds = [...checkboxes].map(cb => cb.value);
  const selectedBanks = SCAN_BANKS.filter(b => selectedIds.includes(b.id));

  if (selectedBanks.length === 0) { showToast('Sélectionnez au moins une banque', 'error'); return; }

  const results = document.getElementById('scan-results');
  results.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Recherche sur ${selectedBanks.length} banque${selectedBanks.length > 1 ? 's' : ''}... (30-60 sec)</div>`;

  try {
    const bankList = selectedBanks.map(b => b.name).join(', ');
    const today = new Date().toISOString().split('T')[0];

    const prompt = `Recherche les taux de comptes à terme (CAT) actuels en France pour ces banques: ${bankList}.

Date: ${today}. Cherche les taux CAT entreprise/pro ou particulier, toutes durées, fixe et progressif.

IMPORTANT: Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après, sans backticks:
{"scanDate":"${today}","banks":[{"bankName":"Nom","bankId":"id-lowercase","source":"URL source","confidence":"high ou medium ou low","note":"note courte","products":[{"name":"CAT 12m","durationMonths":12,"rate":2.40,"rateType":"fixe","minAmount":1000,"withdrawalConditions":"conditions courtes"}]}]}

Si pas de taux trouvé pour une banque: products=[] avec note explicative.`;

    // Try with web_search first
    let parsed = null;
    try {
      const res = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        }),
      });
      if (!res.ok) throw new Error('API ' + res.status);
      const data = await res.json();
      parsed = _extractJSONFromResponse(data);
    } catch(e) {
      console.warn('Web search scan failed, trying without:', e.message);
      // Fallback: try without web_search (uses Claude's knowledge)
      results.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Recherche alternative (sans web)...</div>`;
      const res2 = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 4000,
          messages: [{ role: 'user', content: prompt + '\n\nUtilise tes connaissances des taux bancaires français actuels. Indique confidence=low si données potentiellement obsolètes.' }]
        }),
      });
      if (!res2.ok) throw new Error('API fallback ' + res2.status);
      const data2 = await res2.json();
      const text2 = data2.content?.map(b => b.text || '').join('') || '';
      parsed = repairJSON(text2);
    }

    if (!parsed || !parsed.banks || parsed.banks.length === 0) {
      results.innerHTML = '<div style="color:var(--orange);padding:16px">⚠️ Aucun taux trouvé.</div>';
      return;
    }

    // ═══ AUTO-IMPORT ═══
    let imported = 0;
    for (const bank of parsed.banks) {
      if (!bank.products || bank.products.length === 0) continue;
      const bankId = bank.bankId || bank.bankName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
      catManager.rates.rates = catManager.rates.rates.filter(r => !(r.bankId === bankId && r.source === 'web scan'));
      for (const p of bank.products) {
        const duration = parseInt(p.durationMonths) || 0;
        const rate = parseFloat(p.rate) || 0;
        if (duration <= 0 || rate <= 0) continue;
        catManager.rates.rates.push({
          bankId, bankName: bank.bankName, durationMonths: duration, rate, productType: 'cat',
          date: parsed.scanDate || today, rateType: p.rateType || 'fixe',
          withdrawalConditions: p.withdrawalConditions || null, productName: p.name || null,
          minAmount: p.minAmount || null, source: 'web scan', confidence: bank.confidence || 'low',
          scanNote: bank.note || null, scanSource: bank.source || null,
        });
        imported++;
      }
    }
    catManager.rates.lastUpdated = new Date().toISOString();
    await catManager.saveRates();

    // ═══ RENDER ═══
    let html = `<div style="padding:12px;background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
      <div><strong style="color:var(--green)">✅ ${imported} taux importés</strong><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${parsed.banks.length} banques · ${today}</div></div>
      <button class="btn sm primary" onclick="closeModal();renderCAT(document.getElementById('main-content'))">Dashboard →</button>
    </div>`;

    parsed.banks.forEach(bank => {
      const confColor = bank.confidence === 'high' ? 'var(--green)' : bank.confidence === 'medium' ? 'var(--orange)' : 'var(--red)';
      const confIcon = bank.confidence === 'high' ? '✅' : bank.confidence === 'medium' ? '🟡' : '🟠';
      html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;overflow:hidden">
        <div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div><strong style="color:var(--text-bright)">${bank.bankName}</strong><span style="font-size:10px;color:${confColor};margin-left:8px">${confIcon} ${bank.confidence || '?'}</span></div>
          <span style="font-size:10px;color:var(--text-dim)">${bank.products?.length || 0} taux${bank.source ? ' · <a href="' + bank.source + '" target="_blank" style="color:var(--accent)">source</a>' : ''}</span>
        </div>`;
      if (bank.note) html += `<div style="padding:6px 14px;font-size:10px;color:var(--orange);background:rgba(245,158,11,0.05)">ℹ️ ${bank.note}</div>`;
      if (bank.products && bank.products.length > 0) {
        html += `<div style="padding:8px 14px"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">`;
        bank.products.forEach(p => {
          html += `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px">
            <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:var(--text-bright);font-weight:500">${p.name || p.durationMonths + 'm'}</span><span style="font-family:var(--mono);color:var(--green);font-weight:700;font-size:13px">${p.rate}%</span></div>
            <div style="font-size:9px;color:var(--text-dim);margin-top:2px">${p.durationMonths}m · ${p.rateType || 'fixe'}${p.minAmount ? ' · min ' + p.minAmount + '€' : ''}</div>
          </div>`;
        });
        html += `</div></div>`;
      } else {
        html += `<div style="padding:12px 14px;font-size:11px;color:var(--text-dim)">Aucun taux trouvé — contactez directement.</div>`;
      }
      html += `</div>`;
    });

    html += `<div style="margin-top:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
      <h3 style="font-size:12px;color:var(--accent);margin-bottom:8px">📧 Prospecter directement</h3>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:11px;color:var(--text);line-height:1.6;font-family:var(--mono)">
        Objet: Demande conditions CAT entreprise<br><br>Bonjour,<br><br>Nous souhaitons placer [MONTANT]€ sur CAT à préavis.<br>Durées: 12 à 60 mois, fixe et progressif.<br><br>Grille de taux entreprise SVP?<br><br>Cordialement
      </div>
      <button class="btn sm" style="margin-top:8px" onclick="navigator.clipboard.writeText('Objet: Demande conditions CAT entreprise\\n\\nBonjour,\\n\\nNous souhaitons placer [MONTANT]€ sur CAT à préavis.\\nDurées: 12 à 60 mois, fixe et progressif.\\n\\nGrille de taux entreprise SVP?\\n\\nCordialement');showToast('Copié!','success')">📋 Copier</button>
    </div>`;

    results.innerHTML = html;
    showToast(`${imported} taux sauvegardés`, 'success');

  } catch(e) {
    results.innerHTML = `<div style="color:var(--red);padding:16px">❌ Erreur: ${e.message}</div>`;
  }
}

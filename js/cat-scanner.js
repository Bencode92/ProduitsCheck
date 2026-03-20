// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Bank Rate Scanner V3 — Robust extraction + fallback
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
  const scannedBanks = new Set((catManager.rates?.rates || []).filter(r => r.source === 'web scan').map(r => r.bankId));
  const manualBanks = new Set((catManager.rates?.rates || []).filter(r => r.source !== 'web scan').map(r => r.bankId));

  modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">' +
    '<h2 class="modal-title">🔍 Scanner les taux bancaires</h2>' +
    '<p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Claude recherche les taux CAT. Résultats <strong>sauvegardés automatiquement</strong>.</p>' +
    '<div style="margin-bottom:16px"><h3 style="font-size:12px;color:var(--text-bright);margin-bottom:8px">Banques</h3>' +
    '<div id="scan-banks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">' +
    SCAN_BANKS.map(function(b) {
      var hasManual = manualBanks.has(b.id);
      var hasScanned = scannedBanks.has(b.id);
      return '<label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;font-size:12px">' +
        '<input type="checkbox" value="' + b.id + '" ' + (!hasManual ? 'checked' : '') + ' style="accent-color:var(--accent)">' +
        '<span style="color:var(--text-bright);font-weight:500">' + b.name + '</span>' +
        (hasScanned ? '<span style="font-size:9px;color:var(--cyan)">🔄</span>' : '') +
        (hasManual ? '<span style="font-size:9px;color:var(--green)">✅</span>' : '') +
        '</label>';
    }).join('') +
    '</div></div>' +
    '<div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">' +
    '<strong style="color:var(--accent)">ℹ️</strong> Taux web = indicatifs. Négociez +0.1 à +0.5% en entreprise.</div>' +
    '<button class="btn ai-glow lg" style="width:100%" onclick="runBankScan()">🚀 Scanner et sauvegarder</button>' +
    '<div id="scan-results" style="margin-top:16px"></div>' +
    '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>' +
    '</div></div>';
  modal.classList.add('visible');
}

// Extract JSON from API response — handles web_search mixed blocks
function _extractJSONFromResponse(data) {
  // Collect ALL text blocks
  var allText = '';
  if (data.content && Array.isArray(data.content)) {
    for (var i = 0; i < data.content.length; i++) {
      var block = data.content[i];
      if (block.type === 'text' && block.text) {
        allText += block.text + '\n';
      }
      // Also check tool_result blocks for text content
      if (block.type === 'mcp_tool_result' && block.content) {
        for (var j = 0; j < block.content.length; j++) {
          if (block.content[j].type === 'text') allText += block.content[j].text + '\n';
        }
      }
    }
  }

  console.log('[_extractJSON] Total text length:', allText.length);
  console.log('[_extractJSON] First 500 chars:', allText.substring(0, 500));
  console.log('[_extractJSON] Content block types:', (data.content || []).map(function(b) { return b.type; }).join(', '));
  console.log('[_extractJSON] stop_reason:', data.stop_reason);

  if (!allText.trim()) {
    throw new Error('Réponse vide. stop_reason=' + data.stop_reason + ', blocks=' + (data.content || []).map(function(b) { return b.type; }).join(','));
  }

  // Use the global repairJSON which now has aggressive extraction
  try {
    return repairJSON(allText);
  } catch(e) {
    console.error('[_extractJSON] repairJSON failed:', e.message);
    throw new Error(e.message);
  }
}

async function runBankScan() {
  var checkboxes = document.querySelectorAll('#scan-banks input[type=checkbox]:checked');
  var selectedIds = Array.from(checkboxes).map(function(cb) { return cb.value; });
  var selectedBanks = SCAN_BANKS.filter(function(b) { return selectedIds.indexOf(b.id) >= 0; });

  if (selectedBanks.length === 0) { showToast('Sélectionnez au moins une banque', 'error'); return; }

  var results = document.getElementById('scan-results');
  results.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Recherche sur ' + selectedBanks.length + ' banques... (30-60 sec)</div>';

  try {
    var bankList = selectedBanks.map(function(b) { return b.name; }).join(', ');
    var today = new Date().toISOString().split('T')[0];

    var prompt = 'Recherche les taux de comptes à terme (CAT) actuels pour: ' + bankList + '.\n' +
      'Date: ' + today + '. Taux CAT entreprise/pro ou particulier, toutes durées, fixe et progressif.\n\n' +
      'IMPORTANT: Réponds UNIQUEMENT avec un objet JSON. Aucun texte explicatif avant ou après. Pas de backticks markdown.\n\n' +
      '{"scanDate":"' + today + '","banks":[{"bankName":"Nom","bankId":"id","source":"URL","confidence":"high/medium/low","note":"courte note","products":[{"name":"CAT 12m","durationMonths":12,"rate":2.40,"rateType":"fixe","minAmount":1000,"withdrawalConditions":"conditions courtes"}]}]}\n\n' +
      'Si rien trouvé: products=[]. Confidence: high=source officielle, medium=récent, low=ancien.';

    var parsed = null;

    // === TRY 1: With web_search ===
    try {
      console.log('[scanner] Try 1: with web_search...');
      var res = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        }),
      });
      if (!res.ok) throw new Error('API ' + res.status);
      var data = await res.json();
      parsed = _extractJSONFromResponse(data);
    } catch(e) {
      console.warn('[scanner] Web search failed:', e.message);

      // === TRY 2: Without web_search (Claude's knowledge) ===
      results.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Recherche alternative (sans web)...</div>';
      try {
        console.log('[scanner] Try 2: without web_search...');
        var res2 = await fetch(CONFIG.AI_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', max_tokens: 4000,
            messages: [{ role: 'user', content: prompt + '\nUtilise tes connaissances. Mets confidence=low si potentiellement obsolète.' }]
          }),
        });
        if (!res2.ok) throw new Error('API fallback ' + res2.status);
        var data2 = await res2.json();
        var text2 = (data2.content || []).map(function(b) { return b.text || ''; }).join('');
        console.log('[scanner] Fallback response length:', text2.length, 'preview:', text2.substring(0, 300));
        parsed = repairJSON(text2);
      } catch(e2) {
        throw new Error('Échec des 2 tentatives. Dernière erreur: ' + e2.message);
      }
    }

    if (!parsed || !parsed.banks || parsed.banks.length === 0) {
      results.innerHTML = '<div style="color:var(--orange);padding:16px">⚠️ Aucun taux trouvé.</div>';
      return;
    }

    // === AUTO-IMPORT ===
    var imported = 0;
    for (var bi = 0; bi < parsed.banks.length; bi++) {
      var bank = parsed.banks[bi];
      if (!bank.products || bank.products.length === 0) continue;
      var bankId = bank.bankId || bank.bankName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
      // Remove old scanned rates for this bank
      catManager.rates.rates = catManager.rates.rates.filter(function(r) { return !(r.bankId === bankId && r.source === 'web scan'); });
      for (var pi = 0; pi < bank.products.length; pi++) {
        var p = bank.products[pi];
        var duration = parseInt(p.durationMonths) || 0;
        var rate = parseFloat(p.rate) || 0;
        if (duration <= 0 || rate <= 0) continue;
        catManager.rates.rates.push({
          bankId: bankId, bankName: bank.bankName, durationMonths: duration, rate: rate, productType: 'cat',
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

    // === RENDER ===
    var html = '<div style="padding:12px;background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">' +
      '<div><strong style="color:var(--green)">✅ ' + imported + ' taux importés</strong><div style="font-size:10px;color:var(--text-dim);margin-top:2px">' + parsed.banks.length + ' banques · ' + today + '</div></div>' +
      '<button class="btn sm primary" onclick="closeModal();renderCAT(document.getElementById(\'main-content\'))">Dashboard →</button></div>';

    for (var bi2 = 0; bi2 < parsed.banks.length; bi2++) {
      var bk = parsed.banks[bi2];
      var confColor = bk.confidence === 'high' ? 'var(--green)' : bk.confidence === 'medium' ? 'var(--orange)' : 'var(--red)';
      var confIcon = bk.confidence === 'high' ? '✅' : bk.confidence === 'medium' ? '🟡' : '🟠';
      html += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;overflow:hidden">' +
        '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
        '<div><strong style="color:var(--text-bright)">' + bk.bankName + '</strong><span style="font-size:10px;color:' + confColor + ';margin-left:8px">' + confIcon + ' ' + (bk.confidence || '?') + '</span></div>' +
        '<span style="font-size:10px;color:var(--text-dim)">' + (bk.products ? bk.products.length : 0) + ' taux' + (bk.source ? ' · <a href="' + bk.source + '" target="_blank" style="color:var(--accent)">source</a>' : '') + '</span></div>';
      if (bk.note) html += '<div style="padding:6px 14px;font-size:10px;color:var(--orange);background:rgba(245,158,11,0.05)">ℹ️ ' + bk.note + '</div>';
      if (bk.products && bk.products.length > 0) {
        html += '<div style="padding:8px 14px"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">';
        for (var pi2 = 0; pi2 < bk.products.length; pi2++) {
          var pr = bk.products[pi2];
          html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:var(--text-bright);font-weight:500">' + (pr.name || pr.durationMonths + 'm') + '</span><span style="font-family:var(--mono);color:var(--green);font-weight:700;font-size:13px">' + pr.rate + '%</span></div>' +
            '<div style="font-size:9px;color:var(--text-dim);margin-top:2px">' + pr.durationMonths + 'm · ' + (pr.rateType || 'fixe') + (pr.minAmount ? ' · min ' + pr.minAmount + '€' : '') + '</div></div>';
        }
        html += '</div></div>';
      } else {
        html += '<div style="padding:12px 14px;font-size:11px;color:var(--text-dim)">Aucun taux en ligne — contactez directement.</div>';
      }
      html += '</div>';
    }

    html += '<div style="margin-top:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:14px">' +
      '<h3 style="font-size:12px;color:var(--accent);margin-bottom:8px">📧 Prospecter directement</h3>' +
      '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:11px;color:var(--text);line-height:1.6;font-family:var(--mono)">' +
      'Objet: Demande conditions CAT entreprise<br><br>Bonjour,<br><br>Nous souhaitons placer [MONTANT]€ sur CAT à préavis.<br>Durées: 12 à 60 mois, fixe et progressif.<br><br>Grille de taux entreprise SVP?<br><br>Cordialement</div>' +
      '<button class="btn sm" style="margin-top:8px" onclick="navigator.clipboard.writeText(\'Objet: Demande conditions CAT entreprise\\nBonjour,\\nNous souhaitons placer [MONTANT]€ sur CAT.\\nDurées: 12 à 60 mois.\\nGrille taux entreprise SVP?\\nCordialement\');showToast(\'Copié!\',\'success\')">📋 Copier</button></div>';

    results.innerHTML = html;
    showToast(imported + ' taux sauvegardés', 'success');

  } catch(e) {
    console.error('[scanner] Final error:', e);
    results.innerHTML = '<div style="color:var(--red);padding:16px">❌ ' + e.message + '</div>';
  }
}

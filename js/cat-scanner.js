// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Bank Rate Scanner V2 — Auto-save + persistent
// ═══════════════════════════════════════════════════════════════

const SCAN_BANKS = [
  { id: 'bnp', name: 'BNP Paribas', search: 'BNP Paribas taux compte à terme entreprise 2026' },
  { id: 'credit-agricole', name: 'Crédit Agricole', search: 'Crédit Agricole taux compte à terme entreprise 2026' },
  { id: 'lcl', name: 'LCL', search: 'LCL taux compte à terme entreprise 2026' },
  { id: 'hsbc', name: 'HSBC France', search: 'HSBC France taux dépôt à terme entreprise 2026' },
  { id: 'bred', name: 'BRED', search: 'BRED taux compte à terme 2026' },
  { id: 'caisse-epargne', name: 'Caisse d\'Epargne', search: 'Caisse Epargne taux placement à terme entreprise 2026' },
  { id: 'credit-mutuel', name: 'Crédit Mutuel', search: 'Crédit Mutuel taux compte à terme 2026' },
  { id: 'la-banque-postale', name: 'La Banque Postale', search: 'La Banque Postale taux placement terme 2026' },
];

function showBankScannerModal() {
  const modal = document.getElementById('modal');
  const existingBanks = new Set((catManager.rates?.rates || []).map(r => r.bankId));
  const scannedBanks = new Set((catManager.rates?.rates || []).filter(r => r.source === 'web scan').map(r => r.bankId));

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">🔍 Scanner les taux bancaires</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Claude recherche les taux CAT actuels. Les résultats sont <strong>automatiquement sauvegardés</strong> et mis à jour uniquement quand vous re-scannez.</p>

    <div style="margin-bottom:16px">
      <h3 style="font-size:12px;color:var(--text-bright);margin-bottom:8px">Banques à scanner</h3>
      <div id="scan-banks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
        ${SCAN_BANKS.map(b => {
          const hasManual = existingBanks.has(b.id) && !scannedBanks.has(b.id);
          const hasScanned = scannedBanks.has(b.id);
          return `<label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;font-size:12px" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
            <input type="checkbox" value="${b.id}" ${!hasManual ? 'checked' : ''} style="accent-color:var(--accent)">
            <span style="color:var(--text-bright);font-weight:500">${b.name}</span>
            ${hasScanned ? '<span style="font-size:9px;color:var(--cyan)">🔄 re-scan</span>' : ''}
            ${hasManual ? '<span style="font-size:9px;color:var(--green)">✅ manuel</span>' : ''}
          </label>`;
        }).join('')}
      </div>
    </div>

    <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">
      <strong style="color:var(--accent)">ℹ️</strong> Taux web = taux indicatifs grand public. En entreprise, négociez +0.1 à +0.5%. Les taux sont <strong>sauvegardés automatiquement</strong> après le scan.
    </div>

    <button class="btn ai-glow lg" style="width:100%" onclick="runBankScan()">🚀 Scanner et sauvegarder</button>
    <div id="scan-results" style="margin-top:16px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
}

async function runBankScan() {
  const checkboxes = document.querySelectorAll('#scan-banks input[type=checkbox]:checked');
  const selectedIds = [...checkboxes].map(cb => cb.value);
  const selectedBanks = SCAN_BANKS.filter(b => selectedIds.includes(b.id));

  if (selectedBanks.length === 0) { showToast('Sélectionnez au moins une banque', 'error'); return; }

  const results = document.getElementById('scan-results');
  results.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Recherche sur ${selectedBanks.length} banque${selectedBanks.length > 1 ? 's' : ''}... (20-40 sec)</div>`;

  try {
    const bankList = selectedBanks.map(b => b.name).join(', ');
    const today = new Date().toISOString().split('T')[0];

    const prompt = `Recherche les taux de comptes à terme (CAT) actuels pour: ${bankList}.

Date: ${today}

Pour chaque banque cherche: taux CAT entreprise/pro (prioritaire) ou particulier, toutes durées (1-60 mois), fixe et progressif, montant min, conditions retrait.

JSON valide uniquement:
{"scanDate":"${today}","banks":[{"bankName":"Nom","bankId":"id","source":"URL","confidence":"high/medium/low","note":"max 60 car","products":[{"name":"CAT 12m","durationMonths":12,"rate":2.40,"rateType":"fixe","minAmount":1000,"withdrawalConditions":"max 60 car"}]}]}

Règles: products=[] si rien trouvé, confidence=high si source officielle, medium si récent, low si ancien. Source obligatoire. Concis.`;

    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      }),
    });

    if (!res.ok) throw new Error('Erreur API: ' + res.status);
    const data = await res.json();

    let responseText = '';
    if (data.content) { for (const block of data.content) { if (block.type === 'text' && block.text) responseText += block.text; } }

    const parsed = repairJSON(responseText);
    if (!parsed.banks || parsed.banks.length === 0) { results.innerHTML = '<div style="color:var(--orange);padding:16px">⚠️ Aucun taux trouvé.</div>'; return; }

    // ═══ AUTO-IMPORT: Save immediately ═══
    let imported = 0;
    for (const bank of parsed.banks) {
      if (!bank.products || bank.products.length === 0) continue;
      const bankId = bank.bankId || bank.bankName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);

      // Remove old scanned rates for this bank (keep manual imports)
      catManager.rates.rates = catManager.rates.rates.filter(r =>
        !(r.bankId === bankId && r.source === 'web scan')
      );

      for (const p of bank.products) {
        const duration = parseInt(p.durationMonths) || 0;
        const rate = parseFloat(p.rate) || 0;
        if (duration <= 0 || rate <= 0) continue;

        catManager.rates.rates.push({
          bankId, bankName: bank.bankName, durationMonths: duration,
          rate, productType: 'cat',
          date: parsed.scanDate || today,
          rateType: p.rateType || 'fixe',
          withdrawalConditions: p.withdrawalConditions || null,
          productName: p.name || null,
          minAmount: p.minAmount || null,
          source: 'web scan',
          confidence: bank.confidence || 'low',
          scanNote: bank.note || null,
          scanSource: bank.source || null,
        });
        imported++;
      }
    }

    catManager.rates.lastUpdated = new Date().toISOString();
    await catManager.saveRates();

    // ═══ RENDER RESULTS ═══
    let html = `<div style="padding:12px;background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
      <div><strong style="color:var(--green)">✅ ${imported} taux importés et sauvegardés</strong><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${parsed.banks.length} banques scannées · ${today}</div></div>
      <button class="btn sm primary" onclick="closeModal();renderCAT(document.getElementById('main-content'))">Voir sur le dashboard →</button>
    </div>`;

    parsed.banks.forEach(bank => {
      const confColor = bank.confidence === 'high' ? 'var(--green)' : bank.confidence === 'medium' ? 'var(--orange)' : 'var(--red)';
      const confIcon = bank.confidence === 'high' ? '✅' : bank.confidence === 'medium' ? '🟡' : '🟠';

      html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;overflow:hidden">
        <div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div><strong style="color:var(--text-bright);font-size:13px">${bank.bankName}</strong><span style="font-size:10px;color:${confColor};margin-left:8px">${confIcon} ${bank.confidence || '?'}</span></div>
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

    // Email template
    html += `<div style="margin-top:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
      <h3 style="font-size:12px;color:var(--accent);margin-bottom:8px">📧 Prospecter directement</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Les meilleurs taux s'obtiennent par contact direct:</p>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:11px;color:var(--text);line-height:1.6;font-family:var(--mono)">
        Objet: Demande de conditions CAT entreprise<br><br>Bonjour,<br><br>Nous souhaitons placer [MONTANT]€ sur un compte à terme à préavis.<br>Durées: 12 à 60 mois, fixe et progressif.<br><br>Grille de taux entreprise en vigueur SVP?<br><br>Cordialement
      </div>
      <button class="btn sm" style="margin-top:8px" onclick="navigator.clipboard.writeText('Objet: Demande de conditions CAT entreprise\\n\\nBonjour,\\n\\nNous souhaitons placer [MONTANT]€ sur un compte à terme à préavis.\\nDurées: 12 à 60 mois, fixe et progressif.\\n\\nGrille de taux entreprise en vigueur SVP?\\n\\nCordialement');showToast('Email copié!','success')">📋 Copier</button>
    </div>`;

    results.innerHTML = html;
    showToast(`${imported} taux sauvegardés`, 'success');

  } catch(e) {
    results.innerHTML = `<div style="color:var(--red);padding:16px">❌ Erreur: ${e.message}</div>`;
  }
}

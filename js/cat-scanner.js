// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Bank Rate Scanner V1
// Scans major French banks for current CAT rates via Claude + web_search
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
  // Filter out banks already in our rates
  const existingBanks = new Set((catManager.rates?.rates || []).map(r => r.bankId));
  const availableBanks = SCAN_BANKS.filter(b => !existingBanks.has(b.id));
  const alreadyBanks = SCAN_BANKS.filter(b => existingBanks.has(b.id));

  modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">🔍 Scanner les taux bancaires</h2>
    <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px">Claude recherche sur le web les taux CAT actuels des banques françaises majeures. Les résultats sont indicatifs — les taux réels sont souvent négociés.</p>

    <div style="margin-bottom:16px">
      <h3 style="font-size:12px;color:var(--text-bright);margin-bottom:8px">Sélectionnez les banques à scanner</h3>
      <div id="scan-banks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
        ${availableBanks.map(b => `<label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;font-size:12px" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
          <input type="checkbox" value="${b.id}" checked style="accent-color:var(--accent)">
          <span style="color:var(--text-bright);font-weight:500">${b.name}</span>
        </label>`).join('')}
        ${alreadyBanks.map(b => `<label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;font-size:12px;opacity:0.5">
          <input type="checkbox" value="${b.id}" style="accent-color:var(--accent)">
          <span style="color:var(--text-dim)">${b.name} <span style="font-size:10px">(déjà importé)</span></span>
        </label>`).join('')}
      </div>
    </div>

    <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">
      <strong style="color:var(--accent)">ℹ️ Bon à savoir:</strong> Les taux publiés sur le web sont souvent les taux grand public. En tant qu'entreprise, vous obtiendrez généralement des conditions négociées (+0.1 à +0.5%). Utilisez ces résultats comme base de négociation.
    </div>

    <button class="btn ai-glow lg" style="width:100%" onclick="runBankScan()">🚀 Scanner les taux (${availableBanks.length} banques)</button>
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
  results.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Recherche en cours sur ${selectedBanks.length} banque${selectedBanks.length > 1 ? 's' : ''}... (20-40 sec)</div>`;

  try {
    // Build search query for all banks at once
    const bankList = selectedBanks.map(b => b.name).join(', ');
    const today = new Date().toISOString().split('T')[0];

    const prompt = `Recherche les taux de comptes à terme (CAT) actuels pour les banques françaises suivantes: ${bankList}.

Date d'aujourd'hui: ${today}

Pour chaque banque, cherche:
- Les taux CAT entreprise / professionnel (prioritaire) ou particulier
- Toutes les durées disponibles (1 mois à 60 mois)
- Fixe et progressif si disponible
- Montant minimum si mentionné
- Conditions de retrait anticipé

Réponds UNIQUEMENT en JSON valide (pas de markdown):
{
  "scanDate": "${today}",
  "banks": [
    {
      "bankName": "Nom banque",
      "bankId": "id",
      "source": "URL ou source",
      "confidence": "high/medium/low",
      "note": "Taux particulier, à négocier pour pro",
      "products": [
        {
          "name": "CAT 12 mois",
          "durationMonths": 12,
          "rate": 2.40,
          "rateType": "fixe",
          "minAmount": 1000,
          "withdrawalConditions": "Conditions retrait"
        }
      ]
    }
  ]
}

RÈGLES:
- Si pas de taux trouvé pour une banque, products = [] avec note explicative
- confidence: "high" = source officielle, "medium" = article récent, "low" = données anciennes
- Précise toujours la source
- Sois CONCIS dans les notes (max 60 car)`;

    const res = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      }),
    });

    if (!res.ok) throw new Error('Erreur API: ' + res.status);
    const data = await res.json();

    // Extract text from response (may have tool_use blocks)
    let responseText = '';
    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text' && block.text) responseText += block.text;
      }
    }

    // Parse JSON
    const parsed = repairJSON(responseText);

    if (!parsed.banks || parsed.banks.length === 0) {
      results.innerHTML = '<div style="color:var(--orange);padding:16px">⚠️ Aucun taux trouvé. Les banques publient rarement leurs taux en ligne.</div>';
      return;
    }

    // Render results
    let html = `<div style="margin-bottom:12px"><h3 style="font-size:13px;color:var(--green);margin-bottom:4px">✅ ${parsed.banks.length} banque${parsed.banks.length > 1 ? 's' : ''} scannée${parsed.banks.length > 1 ? 's' : ''}</h3></div>`;

    let totalProducts = 0;
    parsed.banks.forEach(bank => {
      const confColor = bank.confidence === 'high' ? 'var(--green)' : bank.confidence === 'medium' ? 'var(--orange)' : 'var(--red)';
      const confIcon = bank.confidence === 'high' ? '✅' : bank.confidence === 'medium' ? '🟡' : '🟠';

      html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;overflow:hidden">
        <div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong style="color:var(--text-bright);font-size:13px">${bank.bankName}</strong>
            <span style="font-size:10px;color:${confColor};margin-left:8px">${confIcon} ${bank.confidence || 'unknown'}</span>
          </div>
          <span style="font-size:10px;color:var(--text-dim)">${bank.products?.length || 0} taux · ${bank.source ? '<a href="' + bank.source + '" target="_blank" style="color:var(--accent)">source</a>' : 'pas de source'}</span>
        </div>`;

      if (bank.note) {
        html += `<div style="padding:6px 14px;font-size:10px;color:var(--orange);background:rgba(245,158,11,0.05)">ℹ️ ${bank.note}</div>`;
      }

      if (bank.products && bank.products.length > 0) {
        html += `<div style="padding:8px 14px"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">`;
        bank.products.forEach(p => {
          totalProducts++;
          html += `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;color:var(--text-bright);font-weight:500">${p.name || p.durationMonths + 'm'}</span>
              <span style="font-family:var(--mono);color:var(--green);font-weight:700;font-size:13px">${p.rate}%</span>
            </div>
            <div style="font-size:9px;color:var(--text-dim);margin-top:2px">${p.durationMonths}m · ${p.rateType || 'fixe'}${p.minAmount ? ' · min ' + p.minAmount + '€' : ''}</div>
          </div>`;
        });
        html += `</div></div>`;
      } else {
        html += `<div style="padding:12px 14px;font-size:11px;color:var(--text-dim)">Aucun taux trouvé en ligne. Contactez directement la banque.</div>`;
      }

      html += `</div>`;
    });

    // Import button
    if (totalProducts > 0) {
      html += `<button class="btn success lg" style="width:100%;margin-top:12px" onclick="confirmScanImport()">✅ Importer ${totalProducts} taux trouvés</button>`;
      window._pendingScanImport = parsed;
    }

    // Contact suggestion
    html += `<div style="margin-top:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
      <h3 style="font-size:12px;color:var(--accent);margin-bottom:8px">📧 Prospecter directement</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Les meilleurs taux s'obtiennent par contact direct. Voici un modèle d'email à envoyer:</p>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;font-size:11px;color:var(--text);line-height:1.6;font-family:var(--mono)">
        Objet: Demande de conditions CAT entreprise<br><br>
        Bonjour,<br><br>
        Nous souhaitons placer [MONTANT]€ sur un compte à terme à préavis.<br>
        Durées recherchées: 12 à 60 mois, fixe et progressif.<br><br>
        Pourriez-vous nous communiquer votre grille de taux entreprise en vigueur?<br><br>
        Cordialement
      </div>
      <button class="btn sm" style="margin-top:8px" onclick="navigator.clipboard.writeText('Objet: Demande de conditions CAT entreprise\n\nBonjour,\n\nNous souhaitons placer [MONTANT]€ sur un compte à terme à préavis.\nDurées recherchées: 12 à 60 mois, fixe et progressif.\n\nPourriez-vous nous communiquer votre grille de taux entreprise en vigueur?\n\nCordialement');showToast('Email copié!','success')">📋 Copier l'email</button>
    </div>`;

    results.innerHTML = html;

  } catch(e) {
    results.innerHTML = `<div style="color:var(--red);padding:16px">❌ Erreur: ${e.message}</div>`;
  }
}

async function confirmScanImport() {
  const data = window._pendingScanImport;
  if (!data || !data.banks) return;

  let imported = 0;
  for (const bank of data.banks) {
    if (!bank.products || bank.products.length === 0) continue;
    const bankId = bank.bankId || bank.bankName.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
    const bankName = bank.bankName;

    for (const p of bank.products) {
      const duration = parseInt(p.durationMonths) || 0;
      const rate = parseFloat(p.rate) || 0;
      if (duration <= 0 || rate <= 0) continue;

      // Check for existing with same bank + name
      const productKey = (p.name || '').toLowerCase().replace(/\s+/g, '-').substring(0, 30);
      catManager.rates.rates = catManager.rates.rates.filter(r =>
        !(r.bankId === bankId && r.durationMonths === duration && (r.productName || '').toLowerCase().replace(/\s+/g, '-').substring(0, 30) === productKey)
      );

      catManager.rates.rates.push({
        bankId, bankName, durationMonths: duration,
        rate, productType: 'cat',
        date: data.scanDate || new Date().toISOString().split('T')[0],
        rateType: p.rateType || 'fixe',
        rateSchedule: p.rateSchedule || null,
        withdrawalConditions: p.withdrawalConditions || null,
        notice: p.notice || null,
        productName: p.name || null,
        source: bank.source || 'web scan',
        confidence: bank.confidence || 'low',
      });
      imported++;
    }
  }

  catManager.rates.lastUpdated = new Date().toISOString();
  await catManager.saveRates();
  showToast(`${imported} taux importés depuis le scan`, 'success');
  window._pendingScanImport = null;

  // Refresh
  closeModal();
  renderCAT(document.getElementById('main-content'));
}

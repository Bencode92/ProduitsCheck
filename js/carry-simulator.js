// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Carry Trade Simulator v2.0
// Refonte UX: import JSON banquier, comparateur produits, mail type
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _state = {
    amount: 1000000,
    rate: 2.90,
    years: 10,
    taxRate: 25,
    products: [], // user-defined products (from JSON or manual)
    result: null
  };

  function _fmt(n) { return typeof formatNumber === 'function' ? formatNumber(n) : String(Math.round(n)); }

  // ─── Compute cash flow for a single product config ──────
  function _computeCashFlow(product, loanAmount, loanRate, years, taxRate, loanType, reinvest) {
    var flows = [];
    var capitalRemaining = loanAmount;
    var reinvestedCapital = 0;
    var totalRevenue = 0, totalInterest = 0;
    var annualRate = loanRate / 100;
    var catFallback = 2.80 / 100;

    for (var yr = 1; yr <= years; yr++) {
      var interest = Math.round(capitalRemaining * annualRate);
      var capitalPayment = 0;
      if (loanType === 'amortissable') {
        var annuity = Math.round(loanAmount * annualRate / (1 - Math.pow(1 + annualRate, -years)));
        capitalPayment = annuity - interest;
        if (yr === years) capitalPayment = capitalRemaining;
      } else {
        if (yr === years) capitalPayment = loanAmount;
      }

      var basePlaced = loanType === 'amortissable'
        ? Math.round(product.amount * (capitalRemaining / loanAmount))
        : product.amount;
      var placedAmount = basePlaced + (reinvest ? reinvestedCapital : 0);

      // Revenue
      var revenue = 0;
      if (product.duration && yr > product.duration) {
        revenue = Math.round(placedAmount * catFallback);
      } else if (product.type === 'fixe') {
        revenue = Math.round(placedAmount * product.coupon / 100);
      } else if (product.type === 'hybride') {
        revenue = Math.round(placedAmount * product.couponPlancher / 100);
        revenue += Math.round(placedAmount * product.couponBonus / 100 * (product.conditionProb || 0.68));
      } else {
        revenue = Math.round(placedAmount * product.coupon / 100 * (product.conditionProb || 0.68));
      }

      var netBeforeTax = revenue - interest;
      var tax = netBeforeTax > 0 ? Math.round(netBeforeTax * taxRate / 100) : 0;
      var netAfterTax = netBeforeTax - tax;
      if (reinvest && netAfterTax > 0) reinvestedCapital += netAfterTax;
      capitalRemaining = Math.max(0, capitalRemaining - capitalPayment);

      flows.push({ year: yr, revenue: revenue, interest: interest, netBeforeTax: netBeforeTax, tax: tax, netAfterTax: netAfterTax, placedAmount: placedAmount, capitalRemaining: capitalRemaining });
      totalRevenue += revenue;
      totalInterest += interest;
    }

    // Worst case
    var effectiveYears = product.duration ? Math.min(product.duration, years) : years;
    var remainingYears = years - effectiveYears;
    var worstRevenue = 0;
    if (product.type === 'fixe') {
      worstRevenue = product.amount * product.coupon / 100 * effectiveYears + product.amount * catFallback * remainingYears;
    } else if (product.type === 'hybride') {
      worstRevenue = product.amount * product.couponPlancher / 100 * effectiveYears + product.amount * catFallback * remainingYears;
    } else {
      worstRevenue = product.amount * catFallback * remainingYears; // 0% during product life
    }
    var worstNet = Math.round((worstRevenue - totalInterest) * (1 - taxRate / 100));

    return {
      flows: flows,
      totalRevenue: totalRevenue,
      totalInterest: totalInterest,
      totalNet: totalRevenue - totalInterest,
      totalNetAfterTax: Math.round((totalRevenue - totalInterest) * (1 - taxRate / 100)),
      avgPerYear: Math.round((totalRevenue - totalInterest) * (1 - taxRate / 100) / years),
      worstNetTotal: worstNet,
      worstPerYear: Math.round(worstNet / years),
      reinvestedCapital: reinvestedCapital
    };
  }

  // ─── Default product templates ──────────────────────────
  function _defaultProducts() {
    return [
      { id: 'hybride', name: 'Hybride Plancher + Bonus TEC10', type: 'hybride', coupon: 5.50, couponPlancher: 3.00, couponBonus: 2.50, duration: 5, capitalGaranti: true, condition: 'TEC10 ≤ 4.40%', conditionProb: 0.68, color: '#4ECDC4', risk: 'Très faible — plancher couvre l\'emprunt' },
      { id: 'tarn', name: 'TARN TEC10 6%', type: 'conditionnel', coupon: 6.00, duration: 10, capitalGaranti: true, condition: 'TEC10 ≤ 4.40%', conditionProb: 0.68, color: '#FFB627', risk: 'Modéré — coupon 0% si TEC10 > 4.40%' },
      { id: 'fixe10', name: 'Taux Fixe Garanti 10 ans', type: 'fixe', coupon: 4.60, duration: 10, capitalGaranti: true, condition: null, conditionProb: 1.0, color: '#06D6A0', risk: 'Aucun — coupon 100% garanti' },
      { id: 'fixe5', name: 'Taux Fixe Garanti 5 ans', type: 'fixe', coupon: 4.20, duration: 5, capitalGaranti: true, condition: null, conditionProb: 1.0, color: '#06D6A0', risk: 'Aucun — coupon garanti, renouvellement à 5 ans' },
      { id: 'digitale', name: 'Digitale Mémoire TEC10', type: 'conditionnel', coupon: 4.60, duration: 5, capitalGaranti: true, condition: 'TEC10 ≤ 4.40% + mémoire', conditionProb: 0.75, color: '#FFB627', risk: 'Modéré — mémoire rattrape les coupons' }
    ];
  }

  // ─── Parse JSON product from banker ─────────────────────
  function _parseJSON(json) {
    try {
      var d = typeof json === 'string' ? JSON.parse(json) : json;
      var coupon = d.coupon ? (typeof d.coupon === 'object' ? parseFloat(d.coupon.rate) || 0 : parseFloat(d.coupon) || 0) : 0;
      var type = 'conditionnel';
      if (d.coupon && (d.coupon.type === 'fixe' || d.coupon.type === 'garanti')) type = 'fixe';
      if (d.structureType === 'range_accrual' || d.structureType === 'taux_fixe') type = d.structureType === 'taux_fixe' ? 'fixe' : 'conditionnel';
      return {
        id: 'custom_' + Date.now(),
        name: d.name || 'Produit banquier',
        type: type,
        coupon: coupon,
        duration: parseFloat(d.maturityYears) || 5,
        capitalGaranti: d.capitalProtection && d.capitalProtection.protected,
        condition: d.rangeAccrual ? 'Corridor ' + (d.rangeAccrual.lowerBound || '?') + '%-' + (d.rangeAccrual.upperBound || '?') + '%' : (d.coupon && d.coupon.triggerDetail) || null,
        conditionProb: type === 'fixe' ? 1.0 : 0.68,
        color: '#3B82F6',
        risk: type === 'fixe' ? 'Coupon garanti' : 'Coupon conditionnel — prob ~68%',
        source: 'import JSON'
      };
    } catch(e) {
      return null;
    }
  }

  // ═══ RENDER — FORM ═════════════════════════════════════════
  function _renderForm(container) {
    var html = '<div class="section">';
    html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>🏦 Simulateur Carry Trade v2</div></div>';

    // Loan params
    html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:12px">💰 EMPRUNT DE TRÉSORERIE</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">';
    html += '<div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px">Montant (€)</label>';
    html += '<input type="number" id="carry-amount" value="' + _state.amount + '" step="100000" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-family:var(--mono);font-size:15px"></div>';
    html += '<div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px">Taux fixe (%)</label>';
    html += '<input type="number" id="carry-rate" value="' + _state.rate + '" step="0.1" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-family:var(--mono);font-size:15px"></div>';
    html += '<div><label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:4px">Durée (ans)</label>';
    html += '<input type="number" id="carry-years" value="' + _state.years + '" min="1" max="30" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-family:var(--mono);font-size:15px"></div>';
    html += '</div></div>';

    // Import JSON
    html += '<div style="background:var(--bg-elevated);border:1px solid rgba(59,130,246,0.3);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:8px">📋 IMPORTER UN PRODUIT BANQUIER (JSON)</div>';
    html += '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px">Collez le JSON d\'un produit proposé par votre banquier. Le système l\'analyse et le compare automatiquement.</div>';
    html += '<textarea id="carry-json" placeholder=\'{"name":"Hybride TEC10","coupon":{"rate":5.5,"type":"conditionnel"},"maturityYears":5,"capitalProtection":{"protected":true}}\' style="width:100%;height:80px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-family:monospace;font-size:11px;resize:vertical;box-sizing:border-box"></textarea>';
    html += '<button class="btn" onclick="_carryImportJSON()" style="margin-top:8px;font-size:11px;padding:6px 14px;background:rgba(59,130,246,0.1);border-color:rgba(59,130,246,0.3);color:var(--accent)">📥 Importer et ajouter au comparateur</button>';
    html += '</div>';

    // AI generation
    html += '<div style="background:var(--bg-elevated);border:1px solid rgba(168,85,247,0.3);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:#A855F7;margin-bottom:8px">🤖 GÉNÉRER DES PRODUITS AVEC CLAUDE</div>';
    html += '<div style="font-size:10px;color:var(--text-dim);margin-bottom:10px">Claude analyse les conditions de marché (TEC10 3.10%, BCE 2.15%, stagflation) et propose des produits sur-mesure réalistes que vous pourriez négocier avec votre banquier.</div>';
    html += '<div id="carry-ai-status"></div>';
    html += '<button class="btn" id="carry-ai-btn" onclick="_carryGenerateAI()" style="font-size:11px;padding:8px 16px;background:rgba(168,85,247,0.1);border-color:rgba(168,85,247,0.3);color:#A855F7">🤖 Générer 3-4 produits sur-mesure</button>';
    html += '</div>';

    // Manual product add
    html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:8px">✏️ AJOUTER UN PRODUIT MANUELLEMENT</div>';
    html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">';
    html += '<div><label style="font-size:9px;color:var(--text-dim)">Nom</label><input id="carry-pname" placeholder="Ex: Hybride CIC" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text-bright);font-size:11px"></div>';
    html += '<div><label style="font-size:9px;color:var(--text-dim)">Type</label><select id="carry-ptype" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text-bright);font-size:11px"><option value="fixe">Fixe garanti</option><option value="conditionnel">Conditionnel</option><option value="hybride">Hybride</option></select></div>';
    html += '<div><label style="font-size:9px;color:var(--text-dim)">Coupon (%)</label><input id="carry-pcoupon" type="number" step="0.1" placeholder="5.0" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text-bright);font-size:11px;font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:9px;color:var(--text-dim)">Durée (ans)</label><input id="carry-pduration" type="number" value="5" min="1" max="30" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text-bright);font-size:11px;font-family:var(--mono)"></div>';
    html += '<div><label style="font-size:9px;color:var(--text-dim)">Plancher (hybride)</label><input id="carry-pfloor" type="number" step="0.1" placeholder="3.0" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text-bright);font-size:11px;font-family:var(--mono)"></div>';
    html += '</div>';
    html += '<button class="btn" onclick="_carryAddManual()" style="font-size:11px;padding:6px 14px;background:rgba(6,214,160,0.1);border-color:rgba(6,214,160,0.3);color:var(--green)">+ Ajouter au comparateur</button>';
    html += '</div>';

    // Products in comparator
    var allProducts = _state.products.slice(); // only user-created products
    html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:10px">📦 MES PRODUITS SUR-MESURE (' + allProducts.length + ')</div>';
    if (allProducts.length === 0) {
      html += '<div style="text-align:center;padding:20px;color:var(--text-dim);font-size:11px">Aucun produit ajouté. Utilisez le JSON ou le formulaire ci-dessus pour créer vos produits sur-mesure.</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
      allProducts.forEach(function(p, idx) {
        var typeLabel = p.type === 'fixe' ? '🛡️ Fixe' : p.type === 'hybride' ? '⚖️ Hybride' : '🎯 Conditionnel';
        html += '<div style="padding:10px;border-radius:6px;border:1px solid ' + (p.color || '#888') + '33;background:' + (p.color || '#888') + '08;position:relative">';
        html += '<button onclick="_carryRemoveProduct(' + idx + ')" style="position:absolute;top:4px;right:6px;background:none;border:none;color:var(--red);cursor:pointer;font-size:12px" title="Supprimer">✕</button>';
        html += '<div style="font-size:11px;font-weight:600;color:' + (p.color || '#888') + '">' + p.name + '</div>';
        html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + typeLabel + ' · ' + p.coupon + '% · ' + p.duration + ' ans</div>';
        if (p.type === 'hybride' && p.couponPlancher) html += '<div style="font-size:9px;color:var(--green);margin-top:2px">Plancher ' + p.couponPlancher + '% garanti + bonus ' + p.couponBonus + '%</div>';
        if (p.condition) html += '<div style="font-size:9px;color:var(--text-dim);margin-top:2px">' + p.condition + '</div>';
        if (p.source) html += '<div style="font-size:9px;color:var(--accent);margin-top:2px">📥 ' + p.source + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Simulate button
    if (allProducts.length > 0) {
      html += '<button class="btn primary ai-glow" style="width:100%;padding:14px;font-size:14px" onclick="_carrySimulate()">⚡ Simuler le carry trade (' + allProducts.length + ' produit' + (allProducts.length > 1 ? 's' : '') + ' — in fine vs amortissable)</button>';
    } else {
      html += '<div style="width:100%;padding:14px;font-size:13px;text-align:center;color:var(--text-dim);background:var(--bg-elevated);border:1px dashed var(--border);border-radius:var(--radius-sm)">Ajoutez au moins 1 produit sur-mesure pour lancer la simulation</div>';
    }

    // Mail template
    html += '<div style="background:var(--bg-elevated);border:1px solid rgba(168,85,247,0.3);border-radius:var(--radius-sm);padding:16px;margin-top:16px">';
    html += '<div style="font-size:12px;font-weight:700;color:#A855F7;margin-bottom:8px">📧 MAIL TYPE POUR LE BANQUIER</div>';
    var mailLines = [
      'Objet : Demande de structuration - ' + _fmt(_state.amount) + ' EUR capital garanti',
      '',
      'Bonjour,',
      '',
      'Dans le cadre de la gestion de notre tresorerie, nous souhaitons etudier la structuration de produits capital garanti sur-mesure :',
      '',
      '- Montant : ' + _fmt(_state.amount) + ' EUR',
      '- Duree : 5 a 10 ans',
      '- Capital : garanti 100% a echeance',
      '- Coupon : minimum 3% garanti (plancher) + bonus conditionnel lie au TEC10',
      '- Versement : annuel ou trimestriel',
      '- Pas de sous-jacent actions',
      '',
      'Nous sommes interesses par :',
      '1. Produit hybride plancher garanti + bonus TEC10',
      '2. Taux fixe garanti 5-10 ans',
      '3. TARN TEC10 avec autocall',
      '',
      'Merci de nous transmettre les term sheets et conditions.',
      '',
      'Cordialement'
    ];
    html += '<textarea id="carry-mail" style="width:100%;height:200px;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-bright);font-size:11px;line-height:1.5;resize:vertical;box-sizing:border-box;white-space:pre-wrap">' + mailLines.join('\n') + '</textarea>';
    html += '<button class="btn" onclick="navigator.clipboard.writeText(document.getElementById(\'carry-mail\').value);this.textContent=\'✓ Copié\';setTimeout(()=>this.textContent=\'📋 Copier le mail\',2000)" style="margin-top:8px;font-size:11px;padding:6px 14px">📋 Copier le mail</button>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ RENDER — RESULTS ══════════════════════════════════════
  function _renderResult(container) {
    var r = _state.result;
    var html = '<div class="section">';
    html += '<div class="section-header"><div class="section-title"><span class="dot" style="background:var(--accent)"></span>🏦 Carry Trade — Résultats</div>';
    html += '<button class="btn sm" onclick="_carryReset()">← Modifier</button></div>';

    // Loan summary
    html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">';
    html += '<div><span style="font-size:12px;font-weight:700;color:var(--accent)">Emprunt ' + _fmt(_state.amount) + '€ à ' + _state.rate + '% sur ' + _state.years + ' ans</span></div>';
    html += '<div style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--red)">-' + _fmt(Math.round(_state.amount * _state.rate / 100)) + '€/an</div>';
    html += '</div>';

    // Best recommendation
    var best = r.results[0];
    html += '<div style="background:rgba(6,214,160,0.06);border:2px solid rgba(6,214,160,0.3);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--green)">⭐ RECOMMANDATION : ' + best.product.name + '</div>';
    html += '<div style="font-size:11px;color:var(--text-muted)">Marge nette composée (' + best.bestType + ') : <strong style="color:var(--green);font-family:var(--mono)">+' + _fmt(best.bestNet) + '€</strong> sur ' + _state.years + ' ans · <strong>+' + _fmt(Math.round(best.bestNet / _state.years)) + '€/an</strong></div>';
    if (best.worstPerYear !== undefined) {
      html += '<div style="font-size:10px;color:' + (best.worstPerYear >= 0 ? 'var(--green)' : 'var(--red)') + ';margin-top:2px">Pire cas : ' + (best.worstPerYear >= 0 ? '+' : '') + _fmt(best.worstPerYear) + '€/an</div>';
    }
    html += '</div>';

    // Comparison table
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px">';
    html += '<thead><tr style="border-bottom:2px solid var(--border)">';
    html += '<th style="padding:8px 6px;text-align:left;color:var(--text-muted);font-size:10px">Produit</th>';
    html += '<th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-size:10px">Type</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--cyan);font-size:10px">In Fine net/an</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:#A855F7;font-size:10px">Amort. net/an</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--green);font-size:10px">Total composé</th>';
    html += '<th style="padding:8px 6px;text-align:right;color:var(--orange);font-size:10px">Pire cas/an</th>';
    html += '</tr></thead><tbody>';

    r.results.forEach(function(res, i) {
      var p = res.product;
      var isBest = i === 0;
      var bg = isBest ? 'rgba(6,214,160,0.04)' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)');
      var typeLabel = p.type === 'fixe' ? '🛡️' : p.type === 'hybride' ? '⚖️' : '🎯';
      var wc = res.worstPerYear;
      html += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)">';
      html += '<td style="padding:8px 6px;font-weight:600;color:var(--text-bright)">' + p.name + (isBest ? ' <span style="color:var(--green);font-size:9px">⭐</span>' : '') + (p.source ? ' <span style="font-size:9px;color:var(--accent)">📥</span>' : '') + '</td>';
      html += '<td style="padding:8px 6px;text-align:center">' + typeLabel + ' ' + p.coupon + '%</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:var(--cyan)">+' + _fmt(res.inFine.avgPerYear) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:#A855F7">+' + _fmt(res.amort.avgPerYear) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">+' + _fmt(res.bestNet) + '€</td>';
      html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);color:' + (wc >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (wc >= 0 ? '+' : '') + _fmt(wc) + '€</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    // Cash flow detail for best — in fine vs amortissable side by side
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px">📋 Cash Flow — ' + best.product.name + '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';

    ['inFineCompound', 'amortCompound'].forEach(function(key) {
      var cf = best[key];
      var label = key === 'inFineCompound' ? 'IN FINE' : 'AMORTISSABLE';
      var color = key === 'inFineCompound' ? 'var(--cyan)' : '#A855F7';
      html += '<div style="border:1px solid ' + color + '33;border-radius:var(--radius-sm);overflow:hidden">';
      html += '<div style="padding:8px 10px;background:' + color + '0A;font-weight:700;color:' + color + ';font-size:11px">' + label + ' — net total : +' + _fmt(cf.totalNetAfterTax) + '€</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
      html += '<tr style="background:rgba(255,255,255,0.03)"><th style="padding:4px 6px;text-align:left;color:var(--text-dim)">An</th><th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Revenus</th><th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Intérêts</th><th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Net IS</th><th style="padding:4px 6px;text-align:right;color:var(--text-dim)">Capital</th></tr>';
      cf.flows.forEach(function(f, fi) {
        var bg2 = fi % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
        var nc = f.netAfterTax >= 0 ? 'var(--green)' : 'var(--red)';
        html += '<tr style="background:' + bg2 + '"><td style="padding:3px 6px">An ' + f.year + '</td>';
        html += '<td style="padding:3px 6px;text-align:right;font-family:var(--mono);color:var(--green)">+' + _fmt(f.revenue) + '€</td>';
        html += '<td style="padding:3px 6px;text-align:right;font-family:var(--mono);color:var(--red)">-' + _fmt(f.interest) + '€</td>';
        html += '<td style="padding:3px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + nc + '">' + (f.netAfterTax >= 0 ? '+' : '') + _fmt(f.netAfterTax) + '€</td>';
        html += '<td style="padding:3px 6px;text-align:right;font-family:var(--mono);color:var(--cyan);font-size:9px">' + _fmt(f.placedAmount) + '€</td>';
        html += '</tr>';
      });
      html += '</table></div>';
    });
    html += '</div>';

    // Product details
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px">📦 Détail du produit recommandé</div>';
    var bp = best.product;
    html += '<div style="border:1px solid ' + (bp.color || '#888') + '33;border-radius:var(--radius-sm);padding:14px;background:' + (bp.color || '#888') + '08;margin-bottom:16px">';
    html += '<div style="font-size:14px;font-weight:700;color:' + (bp.color || '#888') + '">' + bp.name + '</div>';
    html += '<div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--text-bright);margin:8px 0">' + _fmt(_state.amount) + '€</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;font-size:11px;color:var(--text-muted)">';
    html += '<div>Coupon : <strong>' + bp.coupon + '%</strong> ' + bp.type + '</div>';
    html += '<div>Durée : <strong>' + bp.duration + ' ans</strong></div>';
    html += '<div>Capital garanti : <strong>' + (bp.capitalGaranti ? '✓ OUI' : '✗ NON') + '</strong></div>';
    html += '</div>';
    if (bp.condition) html += '<div style="font-size:10px;color:var(--orange);margin-top:6px">Condition : ' + bp.condition + '</div>';
    if (bp.type === 'hybride') html += '<div style="font-size:10px;color:var(--green);margin-top:4px">Plancher garanti : ' + bp.couponPlancher + '% · Bonus conditionnel : +' + bp.couponBonus + '%</div>';
    html += '<div style="font-size:10px;margin-top:6px;padding:6px 8px;border-radius:4px;background:' + (bp.color || '#888') + '15;color:' + (bp.color || '#888') + '">Risque : ' + (bp.risk || '?') + '</div>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ═══ ACTIONS ═══════════════════════════════════════════════

  window._carryGenerateAI = async function() {
    var btn = document.getElementById('carry-ai-btn');
    var status = document.getElementById('carry-ai-status');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Claude analyse le marché...'; }
    if (status) status.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:8px;color:var(--text-muted);font-size:11px"><div class="spinner" style="width:16px;height:16px;border-width:2px"></div>Génération en cours (10-20s)...</div>';

    var prompt = 'Tu es un structureur de produits financiers. Un client entreprise emprunte ' + _fmt(_state.amount) + ' EUR a ' + _state.rate + '% fixe sur ' + _state.years + ' ans (in fine). Il veut placer en produits structures capital garanti pour generer une marge.\n\n';
    prompt += 'Conditions marche actuelles :\n- TEC10 (OAT 10 ans) : 3.10%\n- BCE depot : 2.00%\n- BCE main : 2.15%\n- Regime : stagflation (Brent $122, PCE 2.83%)\n- Vol OAT 10Y : ~80 bps/an\n- Euribor 3M : ~2.50%\n\n';
    prompt += 'Genere 3-4 produits structures sur-mesure REALISTES qu\'une banque CIC/SG pourrait proposer. Chaque produit doit :\n- Etre capital garanti 100%\n- Avoir un coupon > ' + _state.rate + '% (sinon pas de marge)\n- Etre realisable (pas de coupon fantaisiste)\n\n';
    prompt += 'Reponds UNIQUEMENT en JSON, un tableau de produits :\n```json\n[\n  {\n    "name": "Nom du produit",\n    "type": "fixe" ou "conditionnel" ou "hybride",\n    "coupon": 5.0,\n    "couponPlancher": 3.0,\n    "couponBonus": 2.0,\n    "duration": 5,\n    "condition": "TEC10 <= 4.40%" ou null,\n    "conditionProb": 0.68,\n    "risk": "Description courte du risque",\n    "rationale": "Pourquoi ce produit est realiste"\n  }\n]\n```\nPas de texte avant ou apres le JSON.';

    try {
      var resp = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CONFIG.AI_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      var data = await resp.json();
      var text = data.content ? data.content[0].text : (data.choices ? data.choices[0].message.content : '');

      // Extract JSON from response
      var jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Pas de JSON dans la réponse');
      var products = JSON.parse(jsonMatch[0]);

      products.forEach(function(p) {
        _state.products.push({
          id: 'ai_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          name: p.name || 'Produit IA',
          type: p.type || 'conditionnel',
          coupon: parseFloat(p.coupon) || 5,
          couponPlancher: p.type === 'hybride' ? (parseFloat(p.couponPlancher) || 3) : undefined,
          couponBonus: p.type === 'hybride' ? (parseFloat(p.couponBonus) || 2) : undefined,
          duration: parseInt(p.duration) || 5,
          capitalGaranti: true,
          condition: p.condition || null,
          conditionProb: parseFloat(p.conditionProb) || (p.type === 'fixe' ? 1.0 : 0.68),
          color: p.type === 'fixe' ? '#06D6A0' : p.type === 'hybride' ? '#4ECDC4' : '#FFB627',
          risk: p.risk || '?',
          rationale: p.rationale || '',
          source: 'Claude IA'
        });
      });

      if (status) status.innerHTML = '<div style="padding:8px;color:var(--green);font-size:11px">✅ ' + products.length + ' produits générés avec succès</div>';
      setTimeout(function() { renderCarrySimulator(document.getElementById('main-content')); }, 1000);
    } catch(e) {
      console.error('[CarryAI] Error:', e);
      if (status) status.innerHTML = '<div style="padding:8px;color:var(--red);font-size:11px">❌ Erreur : ' + e.message + '</div>';
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Réessayer'; }
    }
  };

  window._carryRemoveProduct = function(idx) {
    _state.products.splice(idx, 1);
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window._carryImportJSON = function() {
    var textarea = document.getElementById('carry-json');
    if (!textarea || !textarea.value.trim()) return;
    var product = _parseJSON(textarea.value);
    if (product) {
      product.amount = _state.amount;
      _state.products.push(product);
      textarea.value = '';
      renderCarrySimulator(document.getElementById('main-content'));
    } else {
      alert('JSON invalide');
    }
  };

  window._carryAddManual = function() {
    var name = document.getElementById('carry-pname')?.value || 'Produit manuel';
    var type = document.getElementById('carry-ptype')?.value || 'conditionnel';
    var coupon = parseFloat(document.getElementById('carry-pcoupon')?.value) || 5;
    var duration = parseInt(document.getElementById('carry-pduration')?.value) || 5;
    var floor = parseFloat(document.getElementById('carry-pfloor')?.value) || 0;

    var product = {
      id: 'manual_' + Date.now(),
      name: name,
      type: type,
      coupon: coupon,
      duration: duration,
      capitalGaranti: true,
      conditionProb: type === 'fixe' ? 1.0 : 0.68,
      color: '#3B82F6',
      risk: type === 'fixe' ? 'Coupon garanti' : 'Coupon conditionnel',
      source: 'saisie manuelle'
    };
    if (type === 'hybride' && floor > 0) {
      product.couponPlancher = floor;
      product.couponBonus = coupon - floor;
    }
    _state.products.push(product);
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window._carrySimulate = function() {
    _state.amount = parseFloat(document.getElementById('carry-amount')?.value) || 1000000;
    _state.rate = parseFloat(document.getElementById('carry-rate')?.value) || 2.90;
    _state.years = parseInt(document.getElementById('carry-years')?.value) || 10;

    var allProducts = _state.products.slice(); // only user-created products
    var results = [];

    allProducts.forEach(function(p) {
      p.amount = _state.amount;
      var inFine = _computeCashFlow(p, _state.amount, _state.rate, _state.years, _state.taxRate, 'inFine', false);
      var amort = _computeCashFlow(p, _state.amount, _state.rate, _state.years, _state.taxRate, 'amortissable', false);
      var inFineC = _computeCashFlow(p, _state.amount, _state.rate, _state.years, _state.taxRate, 'inFine', true);
      var amortC = _computeCashFlow(p, _state.amount, _state.rate, _state.years, _state.taxRate, 'amortissable', true);
      var bestNet = Math.max(inFineC.totalNetAfterTax, amortC.totalNetAfterTax);
      var bestType = inFineC.totalNetAfterTax >= amortC.totalNetAfterTax ? 'in fine' : 'amortissable';
      var worstPerYear = Math.round((bestType === 'in fine' ? inFine.worstNetTotal : amort.worstNetTotal) / _state.years);
      results.push({
        product: p,
        inFine: inFine, amort: amort,
        inFineCompound: inFineC, amortCompound: amortC,
        bestNet: bestNet, bestType: bestType, worstPerYear: worstPerYear
      });
    });

    results.sort(function(a, b) { return b.bestNet - a.bestNet; });
    _state.result = { results: results };
    _renderResult(document.getElementById('main-content'));
  };

  window._carryReset = function() {
    _state.result = null;
    renderCarrySimulator(document.getElementById('main-content'));
  };

  window.renderCarrySimulator = function(container) {
    if (_state.result) _renderResult(container);
    else _renderForm(container);
  };

  console.log('[StructBoard] Carry Trade Simulator v2.0 loaded');
})();

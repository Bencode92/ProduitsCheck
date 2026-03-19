// ═══ PATCHES V12e — Visual AI Summary Dashboard ═══

let _pendingProduct = null;
let _cachedAISummary = null;

function entityOptionsHTML(selected) { return `<option value="">Sélectionner...</option>${MY_ENTITIES.map(e => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${e.icon} ${e.name}</option>`).join('')}`; }
function bankOnlyOptionsHTML(selected) { return `<option value="">Sélectionner...</option>${BANKS_LIST.map(b => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${b.name}</option>`).join('')}<option value="autre">Autre</option>`; }
function metadataFieldsHTML(p) { const entity=p?.entity||'',bank=p?.bankId||'',amount=p?.investedAmount||''; const date=p?.subscriptionDate||new Date().toISOString().split('T')[0],notes=p?.integrationNotes||''; return `<div class="form-field"><label>🏢 Entreprise</label><select id="f-meta-entity">${entityOptionsHTML(entity)}</select></div><div class="form-field"><label>🏦 Banque source</label><select id="f-meta-bank">${bankOnlyOptionsHTML(bank)}</select></div><div class="form-field"><label>Montant investi (€)</label><input id="f-meta-amount" type="number" value="${amount}" placeholder="50000"></div><div class="form-field"><label>Date de souscription</label><input id="f-meta-date" type="date" value="${date}"></div><div class="form-field full"><label>Notes</label><input id="f-meta-notes" value="${notes}" placeholder="Ex: Via AV SwissLife..."></div>`; }
function readMetadataForm() { return {entity:document.getElementById('f-meta-entity')?.value||'',bankId:document.getElementById('f-meta-bank')?.value||'',amount:document.getElementById('f-meta-amount')?.value||'',date:document.getElementById('f-meta-date')?.value||'',notes:document.getElementById('f-meta-notes')?.value||''}; }
function applyMetadata(product,meta) { if(meta.entity){product.entity=meta.entity;product.entityName=MY_ENTITIES.find(e=>e.id===meta.entity)?.name||meta.entity;} if(meta.bankId&&meta.bankId!=='autre'){product.bankId=meta.bankId;product.bankName=BANKS_LIST.find(b=>b.id===meta.bankId)?.name||meta.bankId;} if(meta.amount)product.investedAmount=parseFloat(meta.amount); if(meta.date)product.subscriptionDate=meta.date; product.integrationNotes=meta.notes||''; }
function _isInPortfolio(p) { return !!(app.state.portfolio||[]).find(x=>x.id===p.id); }
function _injectBeforeLastDiv(html,content) { const idx=html.lastIndexOf('</div>'); return idx<0?html+content:html.substring(0,idx)+content+html.substring(idx); }

async function _loadAISummary() { try { const r=await fetch(`https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${CONFIG.BRANCH}/${CONFIG.DATA_PATH}/ai-summary.json?t=${Date.now()}`); if(r.ok) _cachedAISummary=await r.json(); } catch(e){} }
_loadAISummary();

// ═══════════════════════════════════════════════════════════════
// BUILD VISUAL SUMMARY DASHBOARD (data-driven, no AI for this part)
// ═══════════════════════════════════════════════════════════════
function _buildPortfolioSummaryHTML(active, aiInsights) {
  const totalInvested = active.reduce((s,p) => s + (parseFloat(p.investedAmount)||0), 0);

  // Per-product row data
  const rows = active.map(p => {
    const annRate = typeof getAnnualizedRate==='function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate)||0);
    const amount = parseFloat(p.investedAmount)||0;
    const yieldAmt = Math.round(amount * annRate / 100);
    const s = typeof getTrackingStatus==='function' ? getTrackingStatus(p) : null;
    const variation = s ? s.variation : null;
    const couponOK = s ? s.couponOK : true;
    const margeRestante = s?.margeRestante ?? null;
    const barrier = parseFloat(p.capitalProtection?.barrier)||0;
    const bank = BANKS_LIST.find(b=>b.id===p.bankId)?.name||'';
    const entity = p.entity ? MY_ENTITIES.find(e=>e.id===p.entity) : null;

    let riskLevel, riskColor, riskIcon;
    if (barrier > 0 && margeRestante !== null && margeRestante <= 10) { riskLevel='CRITIQUE'; riskColor='#E53935'; riskIcon='🔴'; }
    else if (!couponOK) { riskLevel='COUPON PERDU'; riskColor='#FFB74D'; riskIcon='⚠️'; }
    else if (barrier > 0 && margeRestante !== null && margeRestante <= 20) { riskLevel='VIGILANCE'; riskColor='#FFB74D'; riskIcon='🟡'; }
    else if (s?.autocallOK) { riskLevel='AUTOCALL'; riskColor='#4CAF50'; riskIcon='✅'; }
    else { riskLevel='OK'; riskColor='#81C784'; riskIcon='🟢'; }

    return { name: (p.name||'').substring(0,35), amount, annRate, yieldAmt, variation, couponOK, margeRestante, barrier, bank, entity, riskLevel, riskColor, riskIcon, id: p.id, bankId: p.bankId||'' };
  });

  // Aggregate metrics
  const totalYield = rows.reduce((s,r) => s + r.yieldAmt, 0);
  const avgRate = totalInvested > 0 ? (rows.reduce((s,r) => s + r.amount * r.annRate, 0) / totalInvested) : 0;
  const couponsOK = rows.filter(r => r.couponOK).length;
  const couponsLost = rows.filter(r => !r.couponOK).length;
  const lostAmount = rows.filter(r => !r.couponOK).reduce((s,r) => s + r.yieldAmt, 0);
  const atRisk = rows.filter(r => r.riskLevel === 'CRITIQUE' || r.riskLevel === 'VIGILANCE').length;

  // Bank concentration
  const bankMap = {};
  rows.forEach(r => { bankMap[r.bank||'?'] = (bankMap[r.bank||'?']||0) + r.amount; });
  const topBank = Object.entries(bankMap).sort((a,b) => b[1]-a[1])[0];
  const topBankPct = topBank ? Math.round(topBank[1]/totalInvested*100) : 0;
  const bankCount = Object.keys(bankMap).length;
  const diversOK = topBankPct <= 40;

  // Overall risk score
  let globalRisk, globalRiskColor;
  if (atRisk > 0 || couponsLost >= 2) { globalRisk = '⚠️ Élevé'; globalRiskColor = '#E53935'; }
  else if (couponsLost > 0 || !diversOK) { globalRisk = '🟡 Modéré'; globalRiskColor = '#FFB74D'; }
  else { globalRisk = '🟢 Faible'; globalRiskColor = '#4CAF50'; }

  // Build HTML
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
    <!-- HEADER METRICS -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid var(--border)">
      <div style="padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px">Investi</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-bright)">${formatNumber(totalInvested)}€</div>
      </div>
      <div style="padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px">Rendement/an</div>
        <div style="font-size:18px;font-weight:700;color:var(--green)">${formatNumber(totalYield)}€</div>
        <div style="font-size:10px;color:var(--text-dim)">${avgRate.toFixed(2)}% moy.</div>
      </div>
      <div style="padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px">Coupons</div>
        <div style="font-size:18px;font-weight:700;color:${couponsLost>0?'var(--orange)':'var(--green)'}">${couponsOK}/${rows.length}</div>
        <div style="font-size:10px;color:${couponsLost>0?'var(--red)':'var(--text-dim)'}">${couponsLost>0?couponsLost+' perdu ('+formatNumber(lostAmount)+'€)':'tous versés'}</div>
      </div>
      <div style="padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px">Diversification</div>
        <div style="font-size:18px;font-weight:700;color:${diversOK?'var(--green)':'var(--orange)'}">${bankCount} banque${bankCount>1?'s':''}</div>
        <div style="font-size:10px;color:var(--text-dim)">${topBank?topBank[0]+' '+topBankPct+'%':''}</div>
      </div>
      <div style="padding:12px 16px;text-align:center">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px">Risque global</div>
        <div style="font-size:16px;font-weight:700;color:${globalRiskColor}">${globalRisk}</div>
      </div>
    </div>

    <!-- POSITIONS TABLE -->
    <table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr style="background:var(--bg)">
        <th style="padding:8px 12px;text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;font-weight:600">Produit</th>
        <th style="padding:8px 8px;text-align:right;color:var(--text-dim);font-size:10px;text-transform:uppercase;font-weight:600">Montant</th>
        <th style="padding:8px 8px;text-align:right;color:var(--text-dim);font-size:10px;text-transform:uppercase;font-weight:600">Taux</th>
        <th style="padding:8px 8px;text-align:right;color:var(--text-dim);font-size:10px;text-transform:uppercase;font-weight:600">Rdt/an</th>
        <th style="padding:8px 8px;text-align:center;color:var(--text-dim);font-size:10px;text-transform:uppercase;font-weight:600">Variation</th>
        <th style="padding:8px 8px;text-align:center;color:var(--text-dim);font-size:10px;text-transform:uppercase;font-weight:600">Statut</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const varStr = r.variation !== null ? ((r.variation>=0?'+':'')+r.variation.toFixed(1)+'%') : '—';
        const varColor = r.variation===null?'var(--text-dim)':r.variation>=0?'var(--green)':r.variation>-20?'var(--orange)':'var(--red)';
        return `<tr style="border-top:1px solid var(--border);cursor:pointer" onclick="app.openProduct(app._findProduct('${r.id}','${r.bankId}'))">
          <td style="padding:8px 12px"><div style="font-weight:600;color:var(--text-bright)">${r.name}</div><div style="font-size:10px;color:var(--text-dim)">${r.bank}${r.entity?' · <span style=color:'+r.entity.color+'>'+r.entity.icon+r.entity.name+'</span>':''}</div></td>
          <td style="padding:8px;text-align:right;font-family:var(--mono);color:var(--text)">${formatNumber(r.amount)}€</td>
          <td style="padding:8px;text-align:right;font-family:var(--mono);color:var(--green)">${r.annRate.toFixed(2)}%</td>
          <td style="padding:8px;text-align:right;font-family:var(--mono);font-weight:600;color:var(--green)">${formatNumber(r.yieldAmt)}€</td>
          <td style="padding:8px;text-align:center;font-family:var(--mono);font-weight:600;color:${varColor}">${varStr}</td>
          <td style="padding:8px;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${r.riskColor}22;color:${r.riskColor}">${r.riskIcon} ${r.riskLevel}</span></td>
        </tr>`;
      }).join('')}
      <tr style="border-top:2px solid var(--border);font-weight:700">
        <td style="padding:8px 12px;color:var(--text-bright)">TOTAL</td>
        <td style="padding:8px;text-align:right;font-family:var(--mono)">${formatNumber(totalInvested)}€</td>
        <td style="padding:8px;text-align:right;font-family:var(--mono);color:var(--green)">${avgRate.toFixed(2)}%</td>
        <td style="padding:8px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">${formatNumber(totalYield)}€</td>
        <td colspan="2"></td>
      </tr></tbody>
    </table>

    ${aiInsights ? `
    <!-- AI INSIGHTS (short bullets only) -->
    <div style="border-top:1px solid var(--border);padding:12px 16px;background:rgba(59,130,246,0.04)">
      <div style="font-size:10px;font-weight:600;color:var(--accent);text-transform:uppercase;margin-bottom:6px">🤖 Analyse IA</div>
      <div style="font-size:12px;line-height:1.5;color:var(--text)">${aiInsights}</div>
    </div>` : ''}
  </div>`;
}

// ═══ GENERATE SUMMARY ═══════════════════════════════════════
async function generatePortfolioSummary() {
  const btn = document.getElementById('ai-summary-btn');
  const box = document.getElementById('ai-summary-box');
  if (!btn||!box) return;
  btn.disabled = true; btn.innerHTML = '⏳ Analyse...';

  const active = (app.state.portfolio||[]).filter(p => !p.archived);

  // Show data dashboard immediately
  box.style.display = 'block';
  box.innerHTML = _buildPortfolioSummaryHTML(active, '<div style="text-align:center;color:var(--text-dim)"><span class="spinner" style="display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:middle"></span>Claude analyse...</div>');

  // Build compact data for AI
  const productsData = active.map(p => {
    const annRate = typeof getAnnualizedRate==='function' ? getAnnualizedRate(p) : (parseFloat(p.coupon?.rate)||0);
    const s = typeof getTrackingStatus==='function' ? getTrackingStatus(p) : null;
    return `${(p.name||'').substring(0,30)}: ${formatNumber(p.investedAmount)}€, ${annRate}%/an${s?', variation '+((s.variation>=0?'+':'')+s.variation.toFixed(1))+'%'+(!s.couponOK?' COUPON PERDU':'')+(s.margeRestante<20?' marge '+s.margeRestante.toFixed(0)+'%':''):''}`;
  }).join('\n');

  try {
    const resp = await fetch(CONFIG.AI_ENDPOINT, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user',
        content: `Portefeuille structurés:\n${productsData}\n\nDonne exactement 3 bullet points courts (1 ligne chacun) en français:\n- 1 constat clé sur la situation\n- 1 risque principal\n- 1 action recommandée\nFormat: "▸ texte". Pas de titre, pas de numéro, juste 3 lignes.`
      }]})
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const insights = text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');

    const now = new Date();
    _cachedAISummary = { insights, date: now.toLocaleDateString('fr-FR'), time: now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}), timestamp: now.toISOString() };
    box.innerHTML = _buildPortfolioSummaryHTML(active, insights + `<div style="font-size:9px;color:var(--text-dim);text-align:right;margin-top:4px">Mis à jour le ${_cachedAISummary.date} à ${_cachedAISummary.time}</div>`);

    try { await github.writeFile(`${CONFIG.DATA_PATH}/ai-summary.json`, _cachedAISummary, `[StructBoard] AI Summary ${_cachedAISummary.date}`); } catch(e){}
    showToast('Résumé mis à jour','success');
  } catch(e) {
    box.innerHTML = _buildPortfolioSummaryHTML(active, `<span style="color:var(--red)">Erreur IA: ${e.message}</span>`);
  }
  btn.disabled = false; btn.innerHTML = '🤖 Actualiser';
}

function _renderSavedSummary() {
  const active = (app.state.portfolio||[]).filter(p => !p.archived);
  if (!active.length) return '';
  const insights = _cachedAISummary?.insights ? _cachedAISummary.insights + `<div style="font-size:9px;color:var(--text-dim);text-align:right;margin-top:4px">Mis à jour le ${_cachedAISummary.date||'?'} à ${_cachedAISummary.time||'?'}</div>` : null;
  return _buildPortfolioSummaryHTML(active, insights);
}

// ═══ Upload / Integrate / Edit (unchanged) ══════════════════
const _origProcessUploadedFile=processUploadedFile;processUploadedFile=async function(file,ctx,bid){const pr=document.getElementById('upload-progress'),st=document.getElementById('upload-status');if(pr)pr.classList.remove('hidden');try{if(st)st.textContent='Extraction...';const p=await app.handlePDFUpload(file,bid);if(st)st.textContent='OK!';if(ctx==='portfolio'){_pendingProduct=p;const m=document.getElementById('modal');m.classList.remove('visible');m.innerHTML='';setTimeout(()=>showDirectAddModal(p,bid),350);}else{closeModal();await app.addProposal(bid,p);app.render();}}catch(e){if(st)st.textContent='Erreur: '+e.message;}};
const _origHandleManualSave=handleManualSave;handleManualSave=function(ctx,bid){const p={id:app._uid(),name:document.getElementById('f-name')?.value||'',bankId:bid||document.getElementById('f-bank')?.value||'',type:document.getElementById('f-type')?.value||'autre',underlyingType:document.getElementById('f-underlying')?.value||'autre',underlyings:[],maturity:document.getElementById('f-maturity')?.value||'',coupon:{rate:document.getElementById('f-coupon')?.value||null,type:document.getElementById('f-coupon-type')?.value||'conditionnel'},capitalProtection:{barrier:document.getElementById('f-barrier')?.value||null,level:document.getElementById('f-protection')?.value||null,protected:!!(document.getElementById('f-protection')?.value)},earlyRedemption:{possible:document.getElementById('f-autocall')?.value==='true',type:document.getElementById('f-autocall')?.value==='true'?'autocall':'none'},notes:document.getElementById('f-notes')?.value||''};if(ctx==='portfolio'){_pendingProduct=p;const m=document.getElementById('modal');m.classList.remove('visible');m.innerHTML='';setTimeout(()=>showDirectAddModal(p,bid),350);}else{closeModal();app.addProposal(bid,p);}};
function showDirectAddModal(p,bid){const det=p?.aiParsed?.distributor||p?.aiParsed?.emitter||'';p.bankId=p.bankId||bid||'';const m=document.getElementById('modal');m.innerHTML=`<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()"><h2 class="modal-title">Ajouter au portefeuille</h2><div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px"><strong style="color:var(--accent)">Produit:</strong> ${p.name||'Sans nom'}${det?'<br><strong>Distributeur:</strong> '+det:''}</div><div class="form-grid">${metadataFieldsHTML(p)}</div><div class="modal-actions"><button class="btn" onclick="closeModal();_pendingProduct=null;">Annuler</button><button class="btn success" onclick="handleDirectAdd()">✅ Ajouter</button></div></div></div>`;m.classList.add('visible');}
async function handleDirectAdd(){if(!_pendingProduct)return;const m=readMetadataForm();if(!m.amount){showToast('Montant requis','error');return;}applyMetadata(_pendingProduct,m);closeModal();await app.addToPortfolio(_pendingProduct,m.amount);_pendingProduct=null;app.render();}
const _origShowIntegrateModal=showIntegrateModal;showIntegrateModal=function(pid,bid){const p=app._findProduct(pid,bid);if(!p)return;p.bankId=p.bankId||bid||'';const m=document.getElementById('modal');m.innerHTML=`<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()"><h2 class="modal-title">Intégrer</h2><div class="form-grid">${metadataFieldsHTML(p)}</div><div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn success" onclick="handleIntegrate('${pid}','${bid}')">✅ Confirmer</button></div></div></div>`;m.classList.add('visible');};
const _origHandleIntegrate=handleIntegrate;handleIntegrate=async function(pid,bid){const m=readMetadataForm();if(!m.amount){showToast('Montant requis','error');return;}const p=app._findProduct(pid,bid);if(!p)return;applyMetadata(p,m);closeModal();const rb=_resolveBankId(pid,bid);if(rb)await app.updateProposalStatus(rb,pid,'subscribed');await app.addToPortfolio({...p},m.amount);app.goToDashboard();};
function showEditMetadataModal(){const p=app.state.currentProduct;if(!p)return;const m=document.getElementById('modal');m.innerHTML=`<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()"><h2 class="modal-title">✏️ Modifier</h2><div style="color:var(--text-muted);font-size:12px;margin-bottom:16px">${p.name||''}</div><div class="form-grid">${metadataFieldsHTML(p)}</div><div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleEditMetadata()">💾 Enregistrer</button></div></div></div>`;m.classList.add('visible');}
async function handleEditMetadata(){const p=app.state.currentProduct;if(!p)return;const m=readMetadataForm();applyMetadata(p,m);if(!m.entity){p.entity='';p.entityName='';}if(!m.bankId){p.bankId='';p.bankName='';}closeModal();const ip=app.state.portfolio.find(x=>x.id===p.id);if(ip){Object.assign(ip,{entity:p.entity,entityName:p.entityName,bankId:p.bankId,bankName:p.bankName,investedAmount:p.investedAmount,subscriptionDate:p.subscriptionDate,integrationNotes:p.integrationNotes});await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`,app.state.portfolio,`[StructBoard] Update: ${p.name||p.id}`);}if(p.bankId)await app._saveProductFile(p.bankId,p);showToast('OK','success');app.openProduct(p);}

// ═══ renderProductCard ═══
const _origRenderProductCard=renderProductCard;renderProductCard=function(product,context){if(!product.bankId||product.bankId==='undefined'||product.bankId==='null')product.bankId='';const origRate=product.coupon?.rate;if(product.coupon&&typeof getAnnualizedRate==='function'){const ann=getAnnualizedRate(product);if(ann!==origRate&&ann>0){product.coupon._origRate=origRate;product.coupon.rate=ann;}}let html=_origRenderProductCard(product,context);if(product.coupon?._origRate!==undefined){product.coupon.rate=product.coupon._origRate;delete product.coupon._origRate;}if(product.entity){const ei=MY_ENTITIES.find(e=>e.id===product.entity);if(ei){const badge=`<div class="product-card-bank" style="color:${ei.color};border-color:${ei.color}33;background:${ei.color}12;margin-left:4px">${ei.icon} ${ei.name}</div>`;const he=html.indexOf('</div></div>');if(he>=0)html=html.substring(0,he)+badge+html.substring(he);}}let extra='';if(product.archived&&typeof renderArchiveBadge==='function')extra=renderArchiveBadge(product);else if(product.tracking?.level!=null&&typeof renderTrackingGauge==='function')extra=renderTrackingGauge(product);if(extra)html=_injectBeforeLastDiv(html,extra);return html;};

// ═══ renderDashboard ═══
const _origRenderDashboard=renderDashboard;renderDashboard=function(container,state){
  _origRenderDashboard(container,state);
  const allP=state.portfolio||[]; const active=allP.filter(p=>!p.archived); const archived=allP.filter(p=>p.archived);
  let ay=0,twr=0,ti=0; active.forEach(p=>{const a=parseFloat(p.investedAmount)||0;ti+=a;const r=typeof getAnnualizedRate==='function'?getAnnualizedRate(p):(parseFloat(p.coupon?.rate)||0);twr+=a*r;ay+=Math.round(a*r/100);});
  const avg=ti>0?(twr/ti):0;
  container.querySelectorAll('.stat-card.orange').forEach(c=>{const l=c.querySelector('.stat-label');if(l&&l.textContent.includes('Coupon')){const v=c.querySelector('.stat-value'),s=c.querySelector('.stat-sub');if(v)v.textContent=avg.toFixed(2).replace('.',',')+  '%';if(s)s.textContent='annualisé pondéré';}});
  const sr=container.querySelector('.stats-row');if(sr){const yc=document.createElement('div');yc.className='stat-card green';yc.innerHTML=`<div class="stat-label">Rendement Annuel</div><div class="stat-value">${formatNumber(ay)}€</div><div class="stat-sub">${avg.toFixed(2).replace('.',',')}% pondéré</div>`;sr.appendChild(yc);}

  // Tracking alerts
  if(typeof getPortfolioAlerts==='function'){const alerts=getPortfolioAlerts(active);if(alerts.length>0){const ac={danger:'rgba(229,57,53,0.15)',warn:'rgba(255,183,77,0.15)',success:'rgba(76,175,80,0.15)',info:'rgba(100,181,246,0.15)'};const ab={danger:'#E53935',warn:'#FFB74D',success:'#4CAF50',info:'#64B5F6'};const ah=alerts.map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${ac[a.type]};border-left:3px solid ${ab[a.type]};border-radius:0 var(--radius-sm) var(--radius-sm) 0;cursor:pointer" onclick="app.openProduct(app._findProduct('${a.productId}','${a.bankId||''}'))"><span>${a.icon}</span><span style="font-size:12px">${a.text}</span></div>`).join('');const secs=container.querySelectorAll('.section');const ps=secs[0];if(ps){const ta=document.createElement('div');ta.style.cssText='display:flex;flex-direction:column;gap:4px;margin-bottom:16px';ta.innerHTML=`<div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:4px">📍 SUIVI POSITIONS</div>${ah}`;ps.before(ta);}}}

  // AI Summary panel
  if(active.length>0){const secs=container.querySelectorAll('.section');const ps=secs[0];if(ps){
    const sh=ps.querySelector('.section-header');
    if(sh){const aiBtn=document.createElement('button');aiBtn.id='ai-summary-btn';aiBtn.className='btn ai-glow';aiBtn.style.cssText='white-space:nowrap;margin-right:8px';aiBtn.innerHTML=_cachedAISummary?'🤖 Actualiser':'🤖 Résumé IA';aiBtn.onclick=generatePortfolioSummary;sh.insertBefore(aiBtn,sh.querySelector('.btn'));}
    const aiBox=document.createElement('div');aiBox.id='ai-summary-box';
    const hasSaved=!!_cachedAISummary?.insights;
    aiBox.style.cssText=`${hasSaved?'':'display:none;'}margin-bottom:16px`;
    aiBox.innerHTML=hasSaved?_renderSavedSummary():'';
    const grid=ps.querySelector('.portfolio-grid')||ps.querySelector('.empty-state');if(grid)grid.before(aiBox);
  }}

  if(archived.length>0&&typeof renderArchivedSection==='function'){const ah=renderArchivedSection(state);if(ah){const ad=document.createElement('div');ad.innerHTML=ah;container.appendChild(ad);}}
};

// ═══ renderProductSheet ═══
const _origRenderProductSheet=renderProductSheet;renderProductSheet=function(container,state){
  const p=state.currentProduct;if(p&&(!p.bankId||p.bankId==='undefined'||p.bankId==='null'))p.bankId='';_origRenderProductSheet(container,state);
  if(typeof getAnnualizedRate==='function'&&p.coupon?.rate){const ann=getAnnualizedRate(p),raw=parseFloat(p.coupon.rate)||0;if(ann!==raw&&ann>0){const cm=container.querySelector('.fiche-metric.green .fiche-metric-value');if(cm)cm.innerHTML=formatPct(ann)+' <span style="font-size:10px;color:var(--text-dim)">('+formatPct(raw)+'/'+(p.coupon.frequency||'période')+')</span>';}}
  if(p.archived&&typeof renderArchiveSection==='function'){const sm=container.querySelector('.sheet-main');if(sm){const ad=document.createElement('div');ad.innerHTML=renderArchiveSection(p);sm.insertBefore(ad.firstElementChild,sm.firstChild);}}
  if(typeof renderTrackingSection==='function'&&!p.archived){const sm=container.querySelector('.sheet-main');if(sm){const td=document.createElement('div');td.innerHTML=renderTrackingSection(p);const fs=sm.querySelector('.fiche-section');if(fs)sm.insertBefore(td.firstElementChild,fs);else sm.appendChild(td.firstElementChild);}}
  const sub=container.querySelector('.fiche-subtitle');if(sub){sub.querySelectorAll('.fiche-tag.bank').forEach(tag=>{const t=tag.textContent.trim();if(t==='\u2014'||t.toUpperCase()==='UNDEFINED'||t===''){tag.textContent='\u270f\ufe0f Assigner';tag.style.color='var(--accent)';tag.style.borderColor='var(--accent)';}tag.style.cursor='pointer';tag.onclick=e=>{e.stopPropagation();showEditMetadataModal();};});if(p.entity){const ei=MY_ENTITIES.find(e=>e.id===p.entity);if(ei){const et=document.createElement('span');et.className='fiche-tag bank';et.style.cssText=`color:${ei.color};border-color:${ei.color};cursor:pointer`;et.textContent=`${ei.icon} ${ei.name}`;et.onclick=e=>{e.stopPropagation();showEditMetadataModal();};sub.insertBefore(et,sub.firstChild);}}if(p.archived){const ab=document.createElement('span');ab.className='fiche-tag';ab.style.cssText='color:#94A3B8;border-color:#94A3B8;background:rgba(148,163,184,0.1)';ab.textContent='\ud83d\udce6 Archivé';sub.appendChild(ab);}if(p.subscriptionDate){const d=document.createElement('span');d.style.cssText='color:var(--text-muted);font-size:11px;cursor:pointer';d.textContent=`\ud83d\udcc5 Souscrit le ${new Date(p.subscriptionDate).toLocaleDateString('fr-FR')}`;d.onclick=e=>{e.stopPropagation();showEditMetadataModal();};sub.appendChild(d);}if(p.integrationNotes){const n=document.createElement('span');n.style.cssText='color:var(--text-dim);font-size:11px;cursor:pointer';n.textContent=`\ud83d\udcac ${p.integrationNotes}`;n.onclick=e=>{e.stopPropagation();showEditMetadataModal();};sub.appendChild(n);}if(!p.entity&&!p.subscriptionDate&&!p.archived){const es=document.createElement('span');es.style.cssText='color:var(--accent);font-size:11px;cursor:pointer;text-decoration:underline';es.textContent='\u270f\ufe0f Compléter';es.onclick=e=>{e.stopPropagation();showEditMetadataModal();};sub.appendChild(es);}}
  const sb=container.querySelector('.sheet-sidebar .action-buttons');if(sb){const eb=document.createElement('button');eb.className='btn lg';eb.style.cssText='width:100%';eb.innerHTML='\u270f\ufe0f Modifier infos';eb.onclick=()=>showEditMetadataModal();sb.insertBefore(eb,sb.firstChild);if(!p.archived){if(typeof showTrackingModal==='function'){const tb=document.createElement('button');tb.className='btn lg';tb.style.cssText='width:100%;background:var(--surface);border:1px solid var(--border)';tb.innerHTML='\ud83d\udccd Valorisation';tb.onclick=()=>showTrackingModal();sb.insertBefore(tb,sb.children[1]||null);}if(_isInPortfolio(p)&&typeof showArchiveModal==='function'){const ab=document.createElement('button');ab.className='btn lg';ab.style.cssText='width:100%;background:rgba(148,163,184,0.1);border:1px solid #94A3B8;color:#94A3B8';ab.innerHTML='\ud83d\udce6 Archiver (produit terminé)';ab.onclick=()=>showArchiveModal();sb.appendChild(ab);}}}
  if(_isInPortfolio(p)&&!p.archived){const n=container.querySelector('.integrated-notice');if(n){const rd=p.subscriptionDate?new Date(p.subscriptionDate).toLocaleDateString('fr-FR'):formatDate(p.addedDate);const el=p.entity?(MY_ENTITIES.find(e=>e.id===p.entity)?.name||''):'';const bl=p.bankId?(BANKS_LIST.find(b=>b.id===p.bankId)?.name||p.bankId):'';n.innerHTML=`\u2705 Intégré le ${rd}${el?'<br>\ud83c\udfe2 '+el:''}${bl?'<br>\ud83c\udfe6 '+bl:''}<br>Montant: ${formatNumber(p.investedAmount)}\u20ac${p.integrationNotes?'<br><span style="color:var(--text-dim);font-size:11px">'+p.integrationNotes+'</span>':''}`;}}
};

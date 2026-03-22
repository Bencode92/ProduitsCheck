// ═══ CAT PATCHES V2j — Collapsible banks + compact table + best rate highlight ═══

let _extractedBrochure = null;

// ─── 1. ENTITY + schedule badge on cards ─────────────────
const _origRenderPlacementCard = renderPlacementCard;
renderPlacementCard = function(d) {
  let html = _origRenderPlacementCard(d);
  if (d.entity) { const ei = MY_ENTITIES.find(e => e.id === d.entity); if (ei) { const badge = `<div class="product-card-bank" style="color:${ei.color};border-color:${ei.color}33;background:${ei.color}12;margin-left:4px">${ei.icon} ${ei.name}</div>`; const he = html.indexOf('</div></div>'); if (he >= 0) html = html.substring(0, he) + badge + html.substring(he); } }
  if (d.status === 'archived' && d.archived) { html = _injectBeforeLastDiv(html, `<div style="margin-top:4px;padding:3px 8px;background:rgba(148,163,184,0.15);border-radius:4px;font-size:10px;color:#94A3B8">📦 Archivé — ${d.archived.reasonLabel || 'Terminé'}${d.archived.interestReceived ? ' — +' + formatNumber(d.archived.interestReceived) + '€' : ''}</div>`); }
  if (d.rateSchedule && d.rateSchedule.length > 0) { const last = d.rateSchedule[d.rateSchedule.length - 1]; html = _injectBeforeLastDiv(html, `<div style="margin-top:4px;padding:3px 8px;background:rgba(59,130,246,0.08);border-radius:4px;font-size:10px;color:var(--accent)">📊 ${d.rateSchedule[0].rate}% → ${last.rate}% (${d.rateSchedule.length} paliers)</div>`); }
  return html;
};

// ═══ RATE SCHEDULE helpers (unchanged) ═══════════════════
function calcInterestAtExit(deposit, exitDate) { if (!deposit.rateSchedule || deposit.rateSchedule.length === 0) { const amount = parseFloat(deposit.amount) || 0; const rate = parseFloat(deposit.rate) || 0; const start = new Date(deposit.startDate); const exit = new Date(exitDate); const days = Math.max(0, (exit - start) / 86400000); return Math.round(amount * (rate / 100) * (days / 365) * 100) / 100; } const amount = parseFloat(deposit.amount) || 0; let total = 0; const exitD = new Date(exitDate); for (const step of deposit.rateSchedule) { const from = new Date(step.from), to = new Date(step.to); if (exitD <= from) break; const effectiveTo = exitD < to ? exitD : to; const days = Math.max(0, (effectiveTo - from) / 86400000); const isEarly = exitD < new Date(deposit.maturityDate || to); const rate = isEarly && step.earlyRate != null ? step.earlyRate : step.rate; total += amount * (rate / 100) * (days / 365); } return Math.round(total * 100) / 100; }
function calcEarlyExitCost(deposit, exitDate) { const full = calcInterestAtExit(deposit, deposit.maturityDate); const early = calcInterestAtExit(deposit, exitDate); return { fullInterest: full, earlyInterest: early, lost: Math.round((full - early) * 100) / 100 }; }
function buildRateScheduleHTML(schedule) { if (!schedule || schedule.length === 0) return ''; return schedule.map((s, i) => `<div class="rs-row" data-idx="${i}" style="display:grid;grid-template-columns:1fr 1fr 80px 80px auto;gap:6px;margin-bottom:6px;align-items:end"><div class="form-field" style="margin:0"><label style="font-size:9px">Début</label><input class="rs-from" type="date" value="${s.from || ''}"></div><div class="form-field" style="margin:0"><label style="font-size:9px">Fin</label><input class="rs-to" type="date" value="${s.to || ''}"></div><div class="form-field" style="margin:0"><label style="font-size:9px">Taux</label><input class="rs-rate" type="number" step="0.01" value="${s.rate || ''}"></div><div class="form-field" style="margin:0"><label style="font-size:9px">Sortie</label><input class="rs-early" type="number" step="0.01" value="${s.earlyRate != null ? s.earlyRate : ''}" placeholder="=taux"></div><button class="btn sm danger" onclick="this.closest('.rs-row').remove()" style="margin-bottom:2px">✕</button></div>`).join(''); }
function readRateScheduleFromModal() { const rows = document.querySelectorAll('.rs-row'); const schedule = []; rows.forEach(row => { const from = row.querySelector('.rs-from')?.value||''; const to = row.querySelector('.rs-to')?.value||''; const rate = parseFloat(row.querySelector('.rs-rate')?.value)||0; const ev = row.querySelector('.rs-early')?.value; const earlyRate = ev !== '' && ev != null ? parseFloat(ev) : null; if (rate > 0) schedule.push({ from, to, rate, earlyRate }); }); return schedule; }
function addRateScheduleRow(startDate) { const container = document.getElementById('rs-container'); if (!container) return; const rows = container.querySelectorAll('.rs-row'); let defaultFrom = startDate || document.getElementById('pl-start')?.value || new Date().toISOString().split('T')[0]; if (rows.length > 0) { const lastTo = rows[rows.length - 1].querySelector('.rs-to')?.value; if (lastTo) { const d = new Date(lastTo); d.setDate(d.getDate() + 1); defaultFrom = d.toISOString().split('T')[0]; } } const row = document.createElement('div'); row.className = 'rs-row'; row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 80px 80px auto;gap:6px;margin-bottom:6px;align-items:end'; row.innerHTML = `<div class="form-field" style="margin:0"><label style="font-size:9px">Début</label><input class="rs-from" type="date" value="${defaultFrom}"></div><div class="form-field" style="margin:0"><label style="font-size:9px">Fin</label><input class="rs-to" type="date" value=""></div><div class="form-field" style="margin:0"><label style="font-size:9px">Taux</label><input class="rs-rate" type="number" step="0.01" value=""></div><div class="form-field" style="margin:0"><label style="font-size:9px">Sortie</label><input class="rs-early" type="number" step="0.01" value="" placeholder="=taux"></div><button class="btn sm danger" onclick="this.closest('.rs-row').remove()" style="margin-bottom:2px">✕</button>`; container.appendChild(row); }
function _resolveScheduleForDisplay(schedule, startDate) { if (!schedule || schedule.length === 0) return []; if (schedule[0].from && schedule[0].from.match && schedule[0].from.match(/^\d{4}-\d{2}-\d{2}$/)) return schedule; if (!startDate) return schedule; const start = new Date(startDate); if (isNaN(start.getTime())) return schedule; return schedule.map(s => { const fm = parseInt(s.fromMonth) || 1; const tm = parseInt(s.toMonth) || fm; const fromDate = new Date(start); fromDate.setMonth(fromDate.getMonth() + fm - 1); const toDate = new Date(start); toDate.setMonth(toDate.getMonth() + tm); toDate.setDate(toDate.getDate() - 1); return { from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0], rate: s.rate, earlyRate: s.earlyRate != null ? s.earlyRate : null, label: s.label || `Mois ${fm}-${tm}`, fromMonth: fm, toMonth: tm }; }); }
function _recalcScheduleDates() { const startDate = document.getElementById('pl-start')?.value; const container = document.getElementById('rs-container'); if (!startDate || !container) return; const rawAttr = container.getAttribute('data-raw-schedule'); if (!rawAttr) return; try { const rawSchedule = JSON.parse(rawAttr); const resolved = _resolveScheduleForDisplay(rawSchedule, startDate); container.innerHTML = buildRateScheduleHTML(resolved); } catch(e) {} }
function _injectRateScheduleSection(deposit, prefillSchedule) { const formGrid = document.querySelector('.modal-content .form-grid'); if (!formGrid) return; const startDate = document.getElementById('pl-start')?.value || deposit?.startDate || ''; const rawSchedule = deposit?.rateSchedule || prefillSchedule || []; const schedule = _resolveScheduleForDisplay(rawSchedule, startDate); const section = document.createElement('div'); section.className = 'form-field full'; section.style.cssText = 'margin-top:12px'; section.innerHTML = `<label style="display:flex;justify-content:space-between;align-items:center"><span>📊 Barème progressif</span><span style="font-size:10px;color:var(--text-dim)">${schedule.length > 0 ? schedule.length + ' paliers' : 'Optionnel'}</span></label><div id="rs-container" data-raw-schedule='${JSON.stringify(rawSchedule).replace(/'/g, "&#39;")}' style="margin-top:8px">${buildRateScheduleHTML(schedule)}</div><button class="btn ghost sm" style="width:100%;margin-top:4px" type="button" onclick="addRateScheduleRow()">+ Ajouter un palier</button>`; formGrid.after(section); setTimeout(() => { const si = document.getElementById('pl-start'); if (si && rawSchedule.length > 0 && rawSchedule[0].fromMonth) si.addEventListener('change', _recalcScheduleDates); }, 100); }

// ─── 2-3. PDF + Brochure modals (unchanged) ─────────────
const _origProcessPlacementPDF = processPlacementPDF;
processPlacementPDF = async function(file, productType) { const progress = document.getElementById('placement-progress'), status = document.getElementById('placement-status'); if (progress) progress.classList.remove('hidden'); try { if (status) status.textContent = 'Extraction du PDF...'; const { parsed, rawText } = await catManager.parsePDFConditions(file); if (status) status.textContent = 'Extraction OK!'; _extractedBrochure = { parsed, rawText, sourceFile: file.name, productType }; const m = document.getElementById('modal'); m.classList.remove('visible'); m.innerHTML = ''; setTimeout(() => showBrochureContractsModal(), 350); } catch (e) { if (status) status.textContent = 'Erreur: ' + e.message; if (progress) progress.classList.add('error'); } };
function showBrochureContractsModal() { const b = _extractedBrochure; if (!b) return; const p = b.parsed || {}; const hasSchedule = p.rateSchedule && p.rateSchedule.length > 0; const modal = document.getElementById('modal'); modal.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()"><h2 class="modal-title">🤖 Brochure extraite</h2>${p.summary ? `<div style="background:var(--accent-glow);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;font-size:12px;line-height:1.5"><strong style="color:var(--accent)">📄 ${p.productName || b.sourceFile}</strong><br>${p.summary}${hasSchedule ? '<br><strong style="color:var(--accent)">📊 ' + p.rateSchedule.length + ' paliers</strong>' : ''}</div>` : ''}<div class="form-grid"><div class="form-field"><label>🏦 Banque</label><select id="bc-bank"><option value="">Sélectionner...</option>${BANKS.map(bk => `<option value="${bk.id}" ${p.emitter && bk.name.toLowerCase().includes((p.emitter||'').toLowerCase().substring(0,4)) ? 'selected' : ''}>${bk.name}</option>`).join('')}<option value="autre">Autre</option></select></div><div class="form-field"><label>Type</label><select id="bc-type">${PLACEMENT_TYPES.map(t => `<option value="${t.id}" ${(p.productType || b.productType) === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></div><div class="form-field"><label>Taux (%)</label><input id="bc-rate" type="number" step="0.01" value="${p.rate || ''}"></div><div class="form-field"><label>Durée (mois)</label><input id="bc-duration" type="number" value="${p.durationMonths || ''}"></div></div><div style="margin:20px 0 12px;font-size:13px;font-weight:600;color:var(--text-bright)">📋 Contrats</div><div id="bc-contracts"><div class="bc-contract-row" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end"><div class="form-field" style="margin:0"><label style="font-size:10px">🏢 Entreprise</label><select class="bc-entity"><option value="">—</option>${MY_ENTITIES.map(e => `<option value="${e.id}">${e.icon} ${e.name}</option>`).join('')}</select></div><div class="form-field" style="margin:0"><label style="font-size:10px">Montant (€)</label><input class="bc-amount" type="number" value="${p.amount || ''}"></div><div class="form-field" style="margin:0"><label style="font-size:10px">Date</label><input class="bc-date" type="date" value="${p.startDate || new Date().toISOString().split('T')[0]}"></div><button class="btn sm danger" onclick="this.closest('.bc-contract-row').remove()">✕</button></div></div><button class="btn ghost" style="width:100%;margin-bottom:16px" onclick="addContractRow()">+</button><div class="modal-actions"><button class="btn" onclick="closeModal();_extractedBrochure=null;">Annuler</button><button class="btn primary" onclick="handleSaveBrochureContracts()">✅ Créer</button></div></div></div>`; modal.classList.add('visible'); }
function handleSwitchToDetailed() { const b = _extractedBrochure; if (!b) { closeModal(); return; } const m=document.getElementById('modal'); m.classList.remove('visible'); m.innerHTML=''; setTimeout(()=>showManualPlacementModal(b.productType,b.parsed,b.rawText,b.sourceFile),350); }
function addContractRow() { const c=document.getElementById('bc-contracts'); if(!c) return; const r=document.createElement('div'); r.className='bc-contract-row'; r.style.cssText='display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end'; r.innerHTML=`<div class="form-field" style="margin:0"><label style="font-size:10px">🏢</label><select class="bc-entity"><option value="">—</option>${MY_ENTITIES.map(e=>`<option value="${e.id}">${e.icon} ${e.name}</option>`).join('')}</select></div><div class="form-field" style="margin:0"><label style="font-size:10px">Montant</label><input class="bc-amount" type="number"></div><div class="form-field" style="margin:0"><label style="font-size:10px">Date</label><input class="bc-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div><button class="btn sm danger" onclick="this.closest('.bc-contract-row').remove()">✕</button>`; c.appendChild(r); }
async function handleSaveBrochureContracts() { const b=_extractedBrochure; if(!b)return; const bankId=document.getElementById('bc-bank')?.value; const bank=BANKS.find(bk=>bk.id===bankId); const productType=document.getElementById('bc-type')?.value||b.productType; const rate=parseFloat(document.getElementById('bc-rate')?.value)||0; const dur=parseInt(document.getElementById('bc-duration')?.value)||0; if(!bankId){showToast('Banque requise','error');return;} const rows=document.querySelectorAll('.bc-contract-row'); const contracts=[]; rows.forEach(row=>{const e=row.querySelector('.bc-entity')?.value||'';const a=parseFloat(row.querySelector('.bc-amount')?.value)||0;const d=row.querySelector('.bc-date')?.value||'';if(a>0)contracts.push({entity:e,amount:a,startDate:d});}); if(contracts.length===0){showToast('Contrat requis','error');return;} closeModal(); const aiSch = b.parsed?.rateSchedule || []; for(const c of contracts){ catManager.addDeposit({ productType, bankId, bankName:bank?.name||bankId, productName: b.parsed?.productName||'CAT '+(dur||'')+'m', amount:c.amount, rate, rateType: aiSch.length > 0 ? 'progressif' : (b.parsed?.rateType||'fixe'), rateSchedule: aiSch.length > 0 ? aiSch : undefined, durationMonths:dur, startDate:c.startDate, exitPenalty:b.parsed?.exitPenalty||'', status:'active', entity:c.entity, entityName:c.entity?(MY_ENTITIES.find(e=>e.id===c.entity)?.name||c.entity):'', sourceFile:b.sourceFile||'' }); } await catManager.saveDeposits(); _extractedBrochure=null; showToast(`${contracts.length} créé(s)`, 'success'); renderCAT(document.getElementById('main-content')); }

// ─── 4. Entity + Schedule modals ─────────────────────────
const _origShowManualPlacementModal = showManualPlacementModal;
showManualPlacementModal = function(pt, pf, rt, sf) { _origShowManualPlacementModal(pt, pf, rt, sf); const bf = document.getElementById('pl-bank')?.closest('.form-field'); if (bf) { const ef=document.createElement('div'); ef.className='form-field'; ef.innerHTML=`<label>🏢 Entreprise</label><select id="pl-entity"><option value="">—</option>${MY_ENTITIES.map(e=>`<option value="${e.id}">${e.icon} ${e.name}</option>`).join('')}</select>`; bf.after(ef); } _injectRateScheduleSection(null, pf?.rateSchedule || []); };
const _origShowEditPlacementModal = showEditPlacementModal;
showEditPlacementModal = function(id) { _origShowEditPlacementModal(id); const d = catManager.deposits.find(x => x.id === id); if (!d) return; const bf = document.getElementById('pl-bank')?.closest('.form-field'); if (bf) { const ef=document.createElement('div'); ef.className='form-field'; ef.innerHTML=`<label>🏢 Entreprise</label><select id="pl-entity"><option value="">—</option>${MY_ENTITIES.map(e=>`<option value="${e.id}" ${d.entity===e.id?'selected':''}>${e.icon} ${e.name}</option>`).join('')}</select>`; bf.after(ef); } _injectRateScheduleSection(d, null); const ac = document.querySelector('.modal-actions'); if (ac) { const db=document.createElement('button'); db.className='btn'; db.style.cssText='color:var(--accent);border-color:var(--accent)'; db.innerHTML='📋 Dupliquer'; db.onclick=()=>handleDuplicatePlacement(id); ac.insertBefore(db, ac.querySelector('.btn.danger')||ac.querySelector('.btn.primary')); if (d.status==='active') { const ab=document.createElement('button'); ab.className='btn'; ab.style.cssText='color:#94A3B8;border-color:#94A3B8'; ab.innerHTML='📦'; ab.onclick=()=>{const m=document.getElementById('modal');m.classList.remove('visible');m.innerHTML='';setTimeout(()=>showCATArchiveModal(id),350);}; ac.insertBefore(ab,ac.querySelector('.btn.danger')||ac.querySelector('.btn.primary')); } } };
const _origSavePlacement = savePlacement;
savePlacement = async function(editId) { const ev = document.getElementById('pl-entity')?.value || ''; const sch = readRateScheduleFromModal(); let ai = []; const ae = document.getElementById('pl-ai-schedule'); if (ae?.value && sch.length === 0) { try { ai = JSON.parse(decodeURIComponent(ae.value)); } catch(e) {} } await _origSavePlacement(editId); const t = editId ? catManager.deposits.find(d => d.id === editId) : catManager.deposits[catManager.deposits.length - 1]; if (t) { if (ev) { t.entity = ev; t.entityName = MY_ENTITIES.find(e => e.id === ev)?.name || ev; } const fs = sch.length > 0 ? sch : ai; if (fs.length > 0) { t.rateSchedule = convertRelativeScheduleToDates(fs, t.startDate); t.rateType = 'progressif'; } await catManager.saveDeposits(); } };

// ─── Duplicate + Archive ─────────────────────────────────
async function handleDuplicatePlacement(id) { const d=catManager.deposits.find(x=>x.id===id); if(!d) return; const c=JSON.parse(JSON.stringify(d)); delete c.id; c.productName=(c.productName||'')+' (copie)'; c.status='active'; delete c.archived; catManager.addDeposit(c); await catManager.saveDeposits(); closeModal(); showToast('Dupliqué','success'); renderCAT(document.getElementById('main-content')); }
const CAT_ARCHIVE_REASONS = [{id:'maturite',label:'Maturité',icon:'📅'},{id:'retrait',label:'Retrait anticipé',icon:'💸'},{id:'non-renouvele',label:'Non renouvelé',icon:'❌'},{id:'transfert',label:'Transféré',icon:'➡️'},{id:'autre',label:'Autre',icon:'📝'}];
function showCATArchiveModal(id) { const d=catManager.deposits.find(x=>x.id===id); if(!d) return; const modal=document.getElementById('modal'); modal.innerHTML=`<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()"><h2 class="modal-title">📦 Archiver</h2><div class="form-grid"><div class="form-field"><label>Raison</label><select id="cat-arch-reason">${CAT_ARCHIVE_REASONS.map(r=>`<option value="${r.id}">${r.icon} ${r.label}</option>`).join('')}</select></div><div class="form-field"><label>Date</label><input id="cat-arch-date" type="date" value="${d.maturityDate||new Date().toISOString().split('T')[0]}"></div><div class="form-field"><label>Intérêts</label><input id="cat-arch-interest" type="number" value="${d.estimatedInterest||0}"></div><div class="form-field"><label>Capital</label><input id="cat-arch-capital" type="number" value="${d.amount}"></div></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button><button class="btn primary" onclick="handleCATArchive('${id}')">📦</button></div></div></div>`; modal.classList.add('visible'); }
async function handleCATArchive(id) { const d=catManager.deposits.find(x=>x.id===id); if(!d) return; d.status='archived'; d.archived={date:document.getElementById('cat-arch-date')?.value,reason:document.getElementById('cat-arch-reason')?.value||'autre',reasonLabel:(CAT_ARCHIVE_REASONS.find(r=>r.id===(document.getElementById('cat-arch-reason')?.value))?.label||'Autre'),interestReceived:parseFloat(document.getElementById('cat-arch-interest')?.value)||0,capitalReturned:parseFloat(document.getElementById('cat-arch-capital')?.value)||0}; closeModal(); await catManager.saveDeposits(); showToast('Archivé','success'); renderCAT(document.getElementById('main-content')); }
async function deleteMarketRate(idx) { if (!confirm('Supprimer ?')) return; catManager.rates.rates.splice(idx, 1); catManager.rates.lastUpdated = new Date().toISOString(); await catManager.saveRates(); showToast('Supprimé', 'success'); renderCAT(document.getElementById('main-content')); }
function _isRateExpired(r) { if (!r.date) return false; const d = new Date(r.date); return !isNaN(d.getTime()) && (new Date() - d) / 86400000 > 5; }

// ═══ TOGGLE BANK COLLAPSE ════════════════════════════════
function toggleBankRates(bankId) {
  const el = document.getElementById('bank-rates-' + bankId);
  const arrow = document.getElementById('bank-arrow-' + bankId);
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? '' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▾' : '▸';
}

// ═══ BUILD BEST RATES MAP (best rate per duration across ALL banks) ═══
function _buildBestRatesMap(rates) {
  const best = {};
  rates.filter(r => !_isRateExpired(r)).forEach(r => {
    const dur = r.durationMonths;
    if (!best[dur] || r.rate > best[dur]) best[dur] = r.rate;
  });
  return best;
}

// ═══ RENDER BANK GROUP — compact table for >6 fixe rates, cards for progressifs ═══
function _renderBankGroup(group, bankKey, isScanned, bestRates, allRates) {
  const sorted = [...group.rates].sort((a, b) => a.durationMonths - b.durationMonths);
  const fixeRates = sorted.filter(r => r.rateType !== 'progressif');
  const progRates = sorted.filter(r => r.rateType === 'progressif');
  const useTable = fixeRates.length > 5; // compact table if > 5 fixe rates
  const collapsed = sorted.length > 6;
  const maxRate = Math.max(...sorted.map(r => r.rate));
  const minRate = Math.min(...sorted.map(r => r.rate));
  const dotColor = isScanned ? 'var(--purple)' : group.color;

  let html = `<div style="margin-bottom:16px;border:1px solid ${isScanned ? 'rgba(139,92,246,0.2)' : 'var(--border)'};border-radius:var(--radius-sm);overflow:hidden${isScanned ? ';border-left:3px solid var(--purple)' : ''}">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-elevated);cursor:pointer;user-select:none" onclick="toggleBankRates('${bankKey}')">
      <div style="display:flex;align-items:center;gap:8px">
        <span id="bank-arrow-${bankKey}" style="color:var(--text-dim);font-size:10px;width:12px">${collapsed ? '▸' : '▾'}</span>
        <span class="bank-dot" style="background:${dotColor}"></span>
        <strong style="font-size:13px;color:var(--text-bright)">${group.name}</strong>
        <span style="font-size:10px;color:var(--text-dim)">${sorted.length} taux</span>
        ${isScanned ? '<span style="font-size:8px;color:var(--purple);background:rgba(139,92,246,0.15);padding:1px 6px;border-radius:8px">📞 web</span>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:11px;color:var(--text-dim)">${minRate === maxRate ? '' : minRate + '% →'}</span>
        <span style="font-family:var(--mono);color:var(--green);font-size:15px;font-weight:700">${maxRate}%</span>
        ${group.rates[0]?.date ? '<span style="font-size:9px;color:var(--text-dim)">' + group.rates[0].date + '</span>' : ''}
      </div>
    </div>
    <div id="bank-rates-${bankKey}" style="${collapsed ? 'display:none' : ''}">`;

  // COMPACT TABLE for many fixe rates
  if (useTable && fixeRates.length > 0) {
    html += `<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="padding:6px 14px;text-align:left;color:var(--text-muted);font-weight:500;font-size:10px">Produit</th>
        <th style="padding:6px 8px;text-align:center;color:var(--text-muted);font-weight:500;font-size:10px">Durée</th>
        <th style="padding:6px 8px;text-align:center;color:var(--text-muted);font-weight:500;font-size:10px">Taux</th>
        ${fixeRates[0]?.withdrawalConditions ? '<th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:500;font-size:10px">Conditions</th>' : ''}
        <th style="padding:6px 8px;width:30px"></th>
      </tr></thead><tbody>`;
    fixeRates.forEach(r => {
      const isBest = bestRates[r.durationMonths] && r.rate >= bestRates[r.durationMonths];
      const expired = _isRateExpired(r);
      const name = r.productName || ('Fixe ' + r.durationMonths + 'm');
      html += `<tr style="border-bottom:1px solid var(--border);${expired ? 'opacity:0.4;' : ''}${isBest ? 'background:rgba(6,214,160,0.06);' : ''}" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background='${isBest ? 'rgba(6,214,160,0.06)' : ''}'">
        <td style="padding:5px 14px;color:var(--text-bright);font-weight:500">${name}${isBest ? ' <span style="font-size:8px;color:var(--green)">★</span>' : ''}</td>
        <td style="padding:5px 8px;text-align:center;color:var(--text-muted)">${r.durationMonths}m</td>
        <td style="padding:5px 8px;text-align:center;font-family:var(--mono);font-weight:700;color:${isBest ? 'var(--green)' : 'var(--text-bright)'}">${r.rate}%</td>
        ${fixeRates[0]?.withdrawalConditions ? '<td style="padding:5px 8px;font-size:9px;color:var(--orange);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.withdrawalConditions ? '⚠️ ' + r.withdrawalConditions : '') + '</td>' : ''}
        <td style="padding:5px 8px"><button onclick="event.stopPropagation();deleteMarketRate(${r._idx})" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:2px" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-dim)'">✕</button></td>
      </tr>`;
    });
    html += `</tbody></table>`;
  } else if (fixeRates.length > 0) {
    // CARD VIEW for few fixe rates
    html += `<div style="padding:8px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;
    fixeRates.forEach(r => {
      const isBest = bestRates[r.durationMonths] && r.rate >= bestRates[r.durationMonths];
      const expired = _isRateExpired(r);
      const name = r.productName || ('Fixe ' + r.durationMonths + 'm');
      html += `<div style="background:var(--bg-card);border:1px solid ${isBest ? 'var(--green)' : expired ? 'var(--orange)' : 'var(--border)'};border-radius:var(--radius-sm);padding:8px 10px;position:relative;${expired ? 'opacity:0.4;' : ''}${isBest ? 'box-shadow:0 0 0 1px var(--green);' : ''}">
        <button onclick="event.stopPropagation();deleteMarketRate(${r._idx})" style="position:absolute;top:2px;right:4px;background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-dim)'">✕</button>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-right:16px">
          <span style="font-size:11px;font-weight:600;color:var(--text-bright)">${name}${isBest ? ' <span style="color:var(--green);font-size:8px">★</span>' : ''}</span>
          <span style="font-family:var(--mono);color:${isBest ? 'var(--green)' : 'var(--text-bright)'};font-size:13px;font-weight:700">${r.rate}%</span>
        </div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:2px">${r.durationMonths}m · fixe</div>
        ${r.withdrawalConditions ? '<div style="font-size:8px;color:var(--orange);margin-top:2px">⚠️ ' + r.withdrawalConditions + '</div>' : ''}
      </div>`;
    });
    html += `</div>`;
  }

  // PROGRESSIVE rates always as cards (fewer, more complex)
  if (progRates.length > 0) {
    html += `<div style="padding:8px 14px;${fixeRates.length > 0 ? 'border-top:1px solid var(--border);' : ''}display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">`;
    progRates.forEach(r => {
      const isBest = bestRates[r.durationMonths] && r.rate >= bestRates[r.durationMonths];
      const name = r.productName || ('Progressif ' + r.durationMonths + 'm');
      let schedTxt = ''; if (r.rateSchedule && Array.isArray(r.rateSchedule)) { try { schedTxt = r.rateSchedule.map(s => s.rate + '%').join(' → '); } catch(e) {} }
      html += `<div style="background:var(--bg-card);border:1px solid ${isBest ? 'var(--green)' : 'var(--border)'};border-radius:var(--radius-sm);padding:8px 10px;position:relative;${isBest ? 'box-shadow:0 0 0 1px var(--green);' : ''}">
        <button onclick="event.stopPropagation();deleteMarketRate(${r._idx})" style="position:absolute;top:2px;right:4px;background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-dim)'">✕</button>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-right:16px">
          <span style="font-size:11px;font-weight:600;color:var(--text-bright)">${name}${isBest ? ' <span style="color:var(--green);font-size:8px">★</span>' : ''}</span>
          <span style="font-family:var(--mono);color:${isBest ? 'var(--green)' : 'var(--text-bright)'};font-size:13px;font-weight:700">${r.rate}%</span>
        </div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:2px">${r.durationMonths}m · 📈 progressif</div>
        ${schedTxt ? '<div style="font-size:8px;color:var(--text-dim);margin-top:2px">' + schedTxt + '</div>' : ''}
        ${r.withdrawalConditions ? '<div style="font-size:8px;color:var(--orange);margin-top:2px">⚠️ ' + r.withdrawalConditions + '</div>' : ''}
      </div>`;
    });
    html += `</div>`;
  }

  html += `</div></div>`;
  return html;
}

// ═══ 7. renderCAT — MARKET RATES with collapsible + compact ═══
const _origRenderCAT = renderCAT;
renderCAT = function(container) {
  _origRenderCAT(container);

  const statsRow = container.querySelector('.stats-row');
  if (statsRow) { const active = catManager.deposits.filter(d => d.status === 'active'); const entityMap = {}; active.forEach(d => { const n = d.entity ? (MY_ENTITIES.find(e => e.id === d.entity)?.name || d.entity) : 'Non assigné'; entityMap[n] = (entityMap[n] || 0) + (parseFloat(d.amount) || 0); }); const sub = Object.entries(entityMap).map(([n, v]) => `${n}: ${formatNumber(v)}€`).join(' · '); if (sub) { const ec = document.createElement('div'); ec.className = 'stat-card blue'; ec.innerHTML = `<div class="stat-label">Par Entreprise</div><div class="stat-value">${Object.keys(entityMap).length}</div><div class="stat-sub">${sub}</div>`; statsRow.appendChild(ec); } }

  try {
    const rates = catManager.rates?.rates || [];
    const confirmedRates = rates.filter(r => r.source !== 'web scan');
    const scannedRates = rates.filter(r => r.source === 'web scan');
    const activeConfirmed = confirmedRates.filter(r => !_isRateExpired(r));
    const activeScanned = scannedRates.filter(r => !_isRateExpired(r));
    const bestRates = _buildBestRatesMap(rates);

    function groupByBank(ratesList) {
      const byBank = {};
      ratesList.forEach(r => { const realIdx = rates.indexOf(r); const key = r.bankId || 'autre'; if (!byBank[key]) byBank[key] = { name: r.bankName || key, rates: [], color: BANKS.find(b => b.id === key)?.color || 'var(--accent)' }; byBank[key].rates.push({ ...r, _idx: realIdx }); });
      return byBank;
    }

    let ratesHTML = `<div class="section">
      <div class="section-header">
        <div class="section-title"><span class="dot" style="background:var(--accent)"></span>📊 Taux du Marché</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:11px;color:var(--text-dim)">${activeConfirmed.length} confirmé${activeConfirmed.length > 1 ? 's' : ''} · ${activeScanned.length} indicatif${activeScanned.length > 1 ? 's' : ''}</span>
          ${typeof showBankScannerModal === 'function' ? '<button class="btn sm ai-glow" onclick="showBankScannerModal()">🔍 Scanner</button>' : ''}
          <button class="btn sm" onclick="showCATRatesModal()">✏️ Gérer</button>
        </div>
      </div>`;

    if (rates.length === 0) {
      ratesHTML += `<div style="text-align:center;padding:30px;color:var(--text-dim)"><div style="font-size:24px;margin-bottom:8px">📊</div><div style="font-size:12px;margin-bottom:12px">Aucun taux</div><div style="display:flex;gap:8px;justify-content:center"><button class="btn ai-glow" onclick="showBankScannerModal()">🔍 Scanner</button><button class="btn" onclick="showCATRatesModal()">✏️ Importer</button></div></div>`;
    }

    // Confirmed rates
    if (confirmedRates.length > 0) {
      const byBank = groupByBank(confirmedRates);
      Object.entries(byBank).forEach(([bankId, group]) => { ratesHTML += _renderBankGroup(group, 'confirmed-' + bankId, false, bestRates, rates); });
    }

    // Scanned rates
    if (scannedRates.length > 0) {
      ratesHTML += `<div style="margin-top:${confirmedRates.length > 0 ? '20px' : '0'};${confirmedRates.length > 0 ? 'padding-top:16px;border-top:1px dashed var(--border);' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:14px">📞</span><strong style="font-size:13px;color:var(--purple)">Taux indicatifs — à contacter</strong></div>
          <button class="btn sm ai-glow" onclick="showBankScannerModal()" style="font-size:10px">🔄 Mettre à jour</button>
        </div>`;
      const byBank = groupByBank(scannedRates);
      Object.entries(byBank).forEach(([bankId, group]) => { ratesHTML += _renderBankGroup(group, 'scanned-' + bankId, true, bestRates, rates); });
      ratesHTML += `</div>`;
    }

    ratesHTML += `</div>`;
    container.insertAdjacentHTML('beforeend', ratesHTML);
  } catch(e) { console.error('Market rates error:', e); }

  // Archives
  const archived = catManager.deposits.filter(d => d.status === 'archived');
  if (archived.length > 0) { const ti = archived.reduce((s, d) => s + (d.archived?.interestReceived || 0), 0); const as = document.createElement('div'); as.className = 'section'; as.style.opacity = '0.75'; as.innerHTML = `<div class="section-header"><div class="section-title"><span class="dot" style="background:#94A3B8"></span>📦 Archives (${archived.length})</div></div><div class="portfolio-grid">${archived.map(d => renderPlacementCard(d)).join('')}</div>`; container.appendChild(as); }
};

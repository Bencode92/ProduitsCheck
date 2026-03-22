// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V5c — Expert review fixes
// Fix 1: Explicit min 3 months filter (no more 0.25y floor bug)
// Fix 2: IS tax factor (×0.75) on net gain
// Fix 3: Stricter duration matching + break-even + mismatch warning
// ═══════════════════════════════════════════════════════════════

let _lastOptimizerResult = null;
let _optimizerRateSource = 'confirmed';
const _IS_TAX_RATE = 0.25; // Impôt sur les sociétés

async function loadOptimizerResult() { try { const d = await github.readFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`); if (d) _lastOptimizerResult = d; } catch(e) {} }

async function saveOptimizerResult(summary, analysis) {
  const result = { lastUpdated: new Date().toISOString(), summary, rateSource: _optimizerRateSource, algorithmVersion: 'v2.1',
    totalInvested: analysis.totalInvested, totalInterestPerYear: analysis.totalInterestPerYear,
    weightedRate: analysis.weightedRate, optimizedInterest: analysis.optimizedInterest,
    optimizedRate: analysis.optimizedRate, totalPotentialGain: analysis.totalNetGain,
    totalGrossGain: analysis.totalGrossGain, totalExitCost: analysis.totalExitCost, totalNoticeCost: analysis.totalNoticeCost,
    arbitrageCount: analysis.arbitrageCount, depositCount: analysis.depositAnalysis.length, rateCount: analysis._rateCount || 0,
    deposits: analysis.depositAnalysis.map(d => ({
      name: d.name, bankName: d.bankName, entity: d.entity, amount: d.amount,
      rate: d.rate, currentPeriodRate: d.currentPeriodRate, interestPerYear: d.interestPerYear,
      remainingMonths: d.remainingMonths, maturityDate: d.maturityDate,
      bestAlt: d.bestAlt, switchGainPerYear: d.netGainAnnual, grossGainPerYear: d.grossGainAnnual,
      exitPenaltyCost: d.exitPenaltyCost, noticeOpportunityCost: d.noticeOpportunityCost,
      netGainAfterTax: d.netGainAfterTax, breakEvenMonths: d.breakEvenMonths,
      durationMismatch: d.durationMismatch,
      dynamicThreshold: d.dynamicThreshold, compositeScore: d.compositeScore,
      recommendation: d.recommendation, reason: d.reason,
    })),
  };
  _lastOptimizerResult = result;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`, result, '[StructBoard] Optimizer v2.1');
}

// ═══ FORMATTING ══════════════════════════════════════════
function _mdToHtmlTable(md) { return md.replace(/(\|[^\n]+\|\n)((?:\|[-:| ]+\|\n))(\|[^\n]+\|\n?)+/g, (match) => { const lines = match.trim().split('\n').filter(l => l.trim()); if (lines.length < 2) return match; const parseRow = (line) => line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim()); const headers = parseRow(lines[0]); const ds = /^\|[\s:-]+\|$/.test(lines[1].trim().replace(/\|/g, '|')) ? 2 : 1; let h = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin:12px 0"><thead><tr>'; headers.forEach(x => { h += `<th style="padding:8px 10px;text-align:left;color:var(--accent);font-weight:600;border-bottom:2px solid var(--border)">${x.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</th>`; }); h += '</tr></thead><tbody>'; for (let i = ds; i < lines.length; i++) { const cells = parseRow(lines[i]); if (!cells.length) continue; h += '<tr style="border-bottom:1px solid var(--border)">'; cells.forEach((c, j) => { const s = j === 0 ? 'font-weight:600;color:var(--text-bright)' : c.includes('ARBITRER') ? 'color:var(--orange);font-weight:600' : c.includes('GARDER') ? 'color:var(--green);font-weight:600' : /^\+/.test(c) ? 'color:var(--green);font-family:var(--mono)' : ''; h += `<td style="padding:6px 10px;${s}">${c.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</td>`; }); h += '</tr>'; } h += '</tbody></table>'; return h; }); }
function _formatOptimizerAI(t) { return t ? formatAIText(_mdToHtmlTable(t)) : ''; }
function _renderAISummaryBlock(summary) { if (!summary) return ''; return `<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden"><div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">🤖</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandations Claude (algo v2.1)</span></div><div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">${_formatOptimizerAI(summary)}</div></div>`; }

// ═══ V2.1 ALGORITHM ══════════════════════════════════════
const MIN_MONTHS_FOR_ARBITRAGE = 3; // FIX #1: Explicit filter, no arbitrage under 3 months

function _dynamicThreshold(amount, monthsLeft) { const B=0.30,af=Math.sqrt(amount/100000),tf=12/Math.max(monthsLeft,3); return Math.max(0.05,Math.min(B/Math.max(af,0.3)*Math.min(tf,3),1)); }

function _calcExitPenaltyCost(deposit) { if (!deposit.rateSchedule||!deposit.rateSchedule.length) return 0; const a=parseFloat(deposit.amount)||0,now=new Date(); let tN=0,tE=0; for(const s of deposit.rateSchedule){const f=new Date(s.from),t=new Date(s.to),ps=new Date(Math.max(f.getTime(),new Date(deposit.startDate).getTime())),pe=new Date(Math.min(t.getTime(),now.getTime())); if(pe<=ps)continue; const d=(pe-ps)/864e5,nr=parseFloat(s.rate)||0,er=s.earlyRate!=null?parseFloat(s.earlyRate):nr; tN+=a*nr/100*d/365; tE+=a*er/100*d/365;} return Math.max(0,Math.round((tN-tE)*100)/100); }

function _calcNoticeOpportunityCost(dep,targetRate) { return Math.round((parseFloat(dep.amount)||0)*targetRate/100*32/365*100)/100; }

function _calcFgdrScore(dep,all,lim) { const l=lim||1e5; let e=0; for(const d of all){if(d.status!=='active')continue;if(d.bankName===dep.bankName&&(d.entityName||'')===(dep.entityName||''))e+=parseFloat(d.amount)||0;} return e<=l?0:Math.min(1,(e-l)/(10*l)); }

function _calcFgdrBonus(dep,tBank,all,lim) { const l=lim||1e5; let cE=0,tE=0; for(const d of all){if(d.status!=='active')continue;const en=d.entityName||'',de=dep.entityName||'';if(en!==de)continue;if(d.bankName===dep.bankName)cE+=parseFloat(d.amount)||0;if(d.bankName===tBank)tE+=parseFloat(d.amount)||0;} return tE<cE&&cE>l?(cE-tE)/cE*0.15:0; }

// FIX #3: Break-even calculation
function _calcBreakEvenMonths(totalOneTimeCosts, grossGainMonthly) {
  if (grossGainMonthly <= 0) return Infinity;
  return Math.ceil(totalOneTimeCosts / grossGainMonthly);
}

// ═══ MAIN ENGINE ═════════════════════════════════════════
function buildOptimizationAnalysis() {
  const now=new Date(),nowStr=now.toISOString().split('T')[0];
  const active=catManager.deposits.filter(d=>d.status==='active');
  const allRates=(catManager.rates?.rates||[]).filter(r=>!_isRateExpired(r));
  const rates=_optimizerRateSource==='confirmed'?allRates.filter(r=>r.source!=='web scan'):allRates;
  const webOnly=allRates.filter(r=>r.source==='web scan');
  const confirmedOnly=allRates.filter(r=>r.source!=='web scan');
  const obj=catManager.objectives;
  const fgdrLimit=parseFloat(obj.maxPerBank)||1e5;
  const placable=Math.max(0,(parseFloat(obj.availableCash)||0)-(parseFloat(obj.liquidityReserve)||0));

  const bestByDuration={};
  rates.forEach(r=>{if(!bestByDuration[r.durationMonths]||r.rate>bestByDuration[r.durationMonths].rate)bestByDuration[r.durationMonths]=r;});
  const bestOverall=rates.reduce((b,r)=>r.rate>(b?.rate||0)?r:b,null);

  const webRatesUsed = new Set();

  const depositAnalysis=active.map(d=>{
    const amount=parseFloat(d.amount)||0,rate=parseFloat(d.rate)||0;
    const durationMonths=parseInt(d.durationMonths)||0;
    const elapsedMonths=Math.round(Math.max(0,(now-new Date(d.startDate))/864e5)/30);
    const remainingMonths=Math.max(0,durationMonths-elapsedMonths);
    const interestPerYear=Math.round(amount*(rate/100)*100)/100;
    let currentPeriodRate=rate;
    if(d.rateSchedule&&d.rateSchedule.length>0){const cp=d.rateSchedule.find(s=>s.from<=nowStr&&s.to>=nowStr);if(cp)currentPeriodRate=cp.rate;}

    // FIX #1: No arbitrage if < 3 months remaining — skip search entirely
    if (remainingMonths < MIN_MONTHS_FOR_ARBITRAGE) {
      return { id:d.id, name:d.productName||'CAT', bankName:d.bankName, entity:d.entityName||'',
        amount, rate, currentPeriodRate, durationMonths, elapsedMonths, remainingMonths, interestPerYear,
        bestAlt:null, grossGainAnnual:0, exitPenaltyCost:0, noticeOpportunityCost:0,
        netGainAnnual:0, netGainAfterTax:0, netGainRemaining:0, breakEvenMonths:null, durationMismatch:false,
        switchGainPerYear:0, dynamicThreshold:0, fgdrScore:_calcFgdrScore(d,active,fgdrLimit), fgdrBonus:0, compositeScore:0,
        recommendation:'GARDER', reason:`< ${MIN_MONTHS_FOR_ARBITRAGE} mois restants — attendre maturité`,
        maturityDate:d.maturityDate, exitPenalty:d.exitPenalty||'', altWithdrawalConditions:'' };
    }

    // FIX #3: Stricter duration matching — prefer rates within ±50% of remaining duration
    const compatible=Object.values(bestByDuration).filter(r=>{
      if(r.rate<=rate) return false;
      // Strict match: target duration should be ≥ 50% of remaining and ≤ 200%
      if(remainingMonths > 6) {
        const ratio = r.durationMonths / remainingMonths;
        if(ratio < 0.5 || ratio > 2.0) return false;
      }
      return true;
    }).sort((a,b)=>b.rate-a.rate);
    const bestAlt=compatible[0]||null;

    // Duration mismatch warning
    const durationMismatch = bestAlt ? Math.abs(bestAlt.durationMonths - remainingMonths) > remainingMonths * 0.5 : false;

    const spread=bestAlt?bestAlt.rate-rate:0;
    const grossGainAnnual=bestAlt?Math.round(amount*spread/100*100)/100:0;
    const exitPenaltyCost=_calcExitPenaltyCost(d);
    const noticeOpportunityCost=bestAlt?_calcNoticeOpportunityCost(d,bestAlt.rate):0;
    const totalOneTimeCosts=exitPenaltyCost+noticeOpportunityCost;

    // FIX #1: Use actual years remaining (no artificial floor)
    const yearsRemaining = remainingMonths / 12;
    const amortizedCostAnnual = yearsRemaining > 0 ? totalOneTimeCosts / yearsRemaining : 0;
    const netGainAnnual=Math.round((grossGainAnnual-amortizedCostAnnual)*100)/100;

    // FIX #2: Net gain after IS tax
    const netGainAfterTax = Math.round(netGainAnnual * (1 - _IS_TAX_RATE) * 100) / 100;

    // FIX #3: Break-even in months
    const grossGainMonthly = grossGainAnnual / 12;
    const breakEvenMonths = totalOneTimeCosts > 0 && grossGainMonthly > 0
      ? _calcBreakEvenMonths(totalOneTimeCosts, grossGainMonthly)
      : null;

    const dynThreshold=_dynamicThreshold(amount,remainingMonths);
    const fgdrSc=_calcFgdrScore(d,active,fgdrLimit);
    const fgdrBonus=bestAlt?_calcFgdrBonus(d,bestAlt.bankName,active,fgdrLimit):0;
    const adjustedSpread=spread+fgdrBonus;
    const normNG=Math.min(1,Math.max(0,netGainAfterTax/Math.max(amount*0.01,1)));
    const normS=Math.min(1,Math.max(0,adjustedSpread));
    const normF=fgdrBonus>0?fgdrBonus/0.15:0;
    const normT=Math.min(1,remainingMonths/60);
    const compositeScore=0.50*normNG+0.25*normS+0.15*normF+0.10*normT;

    const bestAltFull=bestAlt?rates.find(r=>r.rate===bestAlt.rate&&r.durationMonths===bestAlt.durationMonths):null;
    const altIsScanned=bestAltFull?.source==='web scan';
    if(altIsScanned&&bestAltFull) webRatesUsed.add(bestAltFull.productName||bestAltFull.bankName+' '+bestAltFull.durationMonths+'m');

    // Decision uses netGainAfterTax (FIX #2)
    let recommendation='GARDER',reason='Leader marché';
    if(bestAlt && netGainAfterTax > 0 && adjustedSpread >= dynThreshold) {
      // FIX #3: Warn if break-even exceeds remaining duration
      if(breakEvenMonths && breakEvenMonths > remainingMonths) {
        recommendation='SURVEILLER';
        reason=`Break-even ${breakEvenMonths}m > restant ${remainingMonths}m — coûts non amortis`;
      } else {
        recommendation='ARBITRER';
        const beStr = breakEvenMonths ? ` (break-even: ${breakEvenMonths}m)` : '';
        reason=`NET après IS +${formatNumber(netGainAfterTax)}€/an → ${bestAlt.productName||bestAlt.bankName+' '+bestAlt.durationMonths+'m'}${beStr}`;
      }
    } else if(bestAlt && spread > 0) {
      recommendation='SURVEILLER';
      if(netGainAfterTax <= 0) {
        reason=`Brut +${formatNumber(grossGainAnnual)}€ mais NET après IS ${formatNumber(netGainAfterTax)}€ (coûts -${formatNumber(totalOneTimeCosts)}€)`;
      } else {
        reason=`Écart ${spread.toFixed(2)}% < seuil ${dynThreshold.toFixed(2)}%`;
      }
    } else if(rate >= (bestOverall?.rate||0)) { reason='Leader marché'; }
    else { reason='Taux compétitif'; }

    return { id:d.id, name:d.productName||'CAT', bankName:d.bankName, entity:d.entityName||'',
      amount, rate, currentPeriodRate, durationMonths, elapsedMonths, remainingMonths, interestPerYear,
      bestAlt:bestAlt?{name:bestAlt.productName||bestAlt.bankName+' '+bestAlt.durationMonths+'m',rate:bestAlt.rate,duration:bestAlt.durationMonths,bankName:bestAlt.bankName,isScanned:altIsScanned}:null,
      grossGainAnnual, exitPenaltyCost, noticeOpportunityCost, netGainAnnual, netGainAfterTax,
      netGainRemaining:Math.round(netGainAfterTax*yearsRemaining*100)/100,
      breakEvenMonths, durationMismatch,
      switchGainPerYear:netGainAfterTax, // FIX #2: dashboard shows after-tax
      dynamicThreshold:dynThreshold, fgdrScore:fgdrSc, fgdrBonus, compositeScore,
      recommendation, reason, maturityDate:d.maturityDate, exitPenalty:d.exitPenalty||'', altWithdrawalConditions:bestAltFull?.withdrawalConditions||'' };
  });
  depositAnalysis.sort((a,b)=>b.compositeScore-a.compositeScore);

  const cashOpportunities=[];
  if(placable>0){[...rates].sort((a,b)=>b.rate-a.rate).slice(0,5).forEach(r=>{cashOpportunities.push({name:r.productName||r.bankName+' '+r.durationMonths+'m',rate:r.rate,duration:r.durationMonths,bankName:r.bankName,interestPerYear:Math.round(placable*(r.rate/100)*100)/100,amount:placable,withdrawalConditions:r.withdrawalConditions||'',isScanned:r.source==='web scan'});});}

  const totalInvested=depositAnalysis.reduce((s,d)=>s+d.amount,0);
  const totalInterestPerYear=depositAnalysis.reduce((s,d)=>s+d.interestPerYear,0);
  const weightedRate=totalInvested>0?totalInterestPerYear/totalInvested*100:0;
  const arbs=depositAnalysis.filter(d=>d.recommendation==='ARBITRER');
  const totalGrossGain=arbs.reduce((s,d)=>s+d.grossGainAnnual,0);
  const totalNetGain=arbs.reduce((s,d)=>s+d.netGainAfterTax,0); // FIX #2: after tax
  const totalExitCost=arbs.reduce((s,d)=>s+d.exitPenaltyCost,0);
  const totalNoticeCost=arbs.reduce((s,d)=>s+d.noticeOpportunityCost,0);
  const optimizedInterest=totalInterestPerYear+totalNetGain;
  const optimizedRate=totalInvested>0?optimizedInterest/totalInvested*100:0;

  const webRatesSummary = webOnly.map(r => ({
    name: r.productName || r.bankName + ' ' + r.durationMonths + 'm',
    bank: r.bankName, rate: r.rate, duration: r.durationMonths,
    usedAsAlt: webRatesUsed.has(r.productName || r.bankName + ' ' + r.durationMonths + 'm')
  }));

  return{depositAnalysis,cashOpportunities,placable,totalInvested,totalInterestPerYear,weightedRate,
    totalGrossGain:Math.round(totalGrossGain*100)/100,totalNetGain:Math.round(totalNetGain*100)/100,
    totalExitCost:Math.round(totalExitCost*100)/100,totalNoticeCost:Math.round(totalNoticeCost*100)/100,
    totalPotentialGain:Math.round(totalNetGain*100)/100,
    arbitrageCount:arbs.length,bestByDuration,bestOverall,optimizedInterest:Math.round(optimizedInterest*100)/100,optimizedRate,
    _rateCount:rates.length,_confirmedCount:confirmedOnly.length,_webCount:webOnly.length,
    _webRatesSummary:webRatesSummary,_webRatesUsedCount:webRatesUsed.size};
}

// ═══ UI ══════════════════════════════════════════════════
const _origShowCATSimulator = showCATSimulator;
showCATSimulator = function() {
  const allRates=(catManager.rates?.rates||[]).filter(r=>!_isRateExpired(r));
  const cR=allRates.filter(r=>r.source!=='web scan'),sR=allRates.filter(r=>r.source==='web scan');
  if(!allRates.length){showToast("Importez des taux d'abord",'error');return;}
  const modal=document.getElementById('modal'),n=catManager.deposits.filter(d=>d.status==='active').length;
  modal.innerHTML=`<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">
    <h2 class="modal-title">⚡ Optimiseur v2.1</h2>
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-bright);margin-bottom:10px">📊 Comparer avec :</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label style="flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-card);border:2px solid var(--green);border-radius:var(--radius-sm);cursor:pointer" id="opt-src-confirmed" onclick="document.getElementById('opt-radio-confirmed').checked=true;this.style.borderColor='var(--green)';document.getElementById('opt-src-all').style.borderColor='var(--border)'">
          <input type="radio" name="opt-source" id="opt-radio-confirmed" value="confirmed" checked style="accent-color:var(--green)">
          <div><div style="font-size:12px;font-weight:600;color:var(--green)">✅ Taux confirmés</div><div style="font-size:10px;color:var(--text-dim)">${cR.length} taux · 🔒 fiables</div></div>
        </label>
        <label style="flex:1;min-width:200px;display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-card);border:2px solid var(--border);border-radius:var(--radius-sm);cursor:pointer" id="opt-src-all" onclick="document.getElementById('opt-radio-all').checked=true;this.style.borderColor='var(--purple)';document.getElementById('opt-src-confirmed').style.borderColor='var(--border)'">
          <input type="radio" name="opt-source" id="opt-radio-all" value="all" style="accent-color:var(--purple)">
          <div><div style="font-size:12px;font-weight:600;color:var(--purple)">🔍 Tous (+ web)</div><div style="font-size:10px;color:var(--text-dim)">${allRates.length} taux (${cR.length}+${sR.length} web)</div></div>
        </label>
      </div>
    </div>
    <div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:10px;color:var(--text-muted)">
      <strong style="color:var(--accent)">v2.1</strong> : seuil dynamique, gain NET après IS (×0.75), break-even en mois, filtre <3m, matching durée strict.</div>
    <button class="btn ai-glow lg" style="width:100%" onclick="launchOptimizer()">⚡ Optimiser (${n} contrats)</button>
    <div id="optimizer-results" style="margin-top:16px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

function launchOptimizer() {
  _optimizerRateSource=document.querySelector('input[name="opt-source"]:checked')?.value||'confirmed';
  document.getElementById('optimizer-results').innerHTML=`<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse v2.1...</div>`;
  setTimeout(()=>runSmartOptimizer(),100);
}

async function runSmartOptimizer() {
  const results=document.getElementById('optimizer-results');
  if(!results)return;
  try{
    const analysis=buildOptimizationAnalysis();
    const srcBadge=_optimizerRateSource==='confirmed'
      ?'<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--green);background:rgba(6,214,160,0.1);border:1px solid rgba(6,214,160,0.3);margin-bottom:12px">✅ vs '+analysis._confirmedCount+' confirmés · v2.1 (NET après IS)</span>'
      :'<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--purple);background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);margin-bottom:12px">🔍 vs '+analysis._rateCount+' taux · v2.1 (NET après IS)</span>';
    let html=srcBadge+renderOptimizationTable(analysis);
    html+='<div id="ai-optimizer-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse (v2.1)...</div></div>';
    results.innerHTML=html;
    const ai=await getAIOptimizerSummary(analysis);
    const d=document.getElementById('ai-optimizer-summary');
    if(d)d.innerHTML=_renderAISummaryBlock(ai);
    await saveOptimizerResult(ai,analysis);
    showToast('v2.1 OK','success');
    const ma=document.querySelector('.modal-actions');
    if(ma)ma.innerHTML=`<button class="btn" onclick="closeModal()">Fermer</button><button class="btn primary" onclick="closeModal();renderCAT(document.getElementById('main-content'));">✅ Dashboard</button>`;
  }catch(e){results.innerHTML=`<div style="color:var(--red);padding:16px">❌ ${e.message}</div>`;}
}

// ═══ TABLE ═══════════════════════════════════════════════
function renderOptimizationTable(analysis) {
  const{depositAnalysis,cashOpportunities,placable,totalInvested,totalInterestPerYear,weightedRate,totalNetGain,totalGrossGain,totalExitCost,totalNoticeCost,arbitrageCount,optimizedInterest,optimizedRate,bestOverall,_webRatesSummary,_webRatesUsedCount,_webCount,_confirmedCount}=analysis;

  let html=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:8px">
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+${formatNumber(totalInterestPerYear)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${weightedRate.toFixed(2)}%</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après (NET IS)</div><div style="font-size:20px;font-weight:800;color:${totalNetGain>0?'var(--cyan)':'var(--green)'};font-family:var(--mono)">+${formatNumber(optimizedInterest)}€/an</div><div style="font-size:10px;color:var(--text-dim)">${optimizedRate.toFixed(2)}%</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Gain NET après IS</div><div style="font-size:20px;font-weight:800;color:${totalNetGain>0?'var(--green)':'var(--text-dim)'};font-family:var(--mono)">${totalNetGain>0?'+'+formatNumber(totalNetGain)+'€':'✅'}</div><div style="font-size:10px;color:var(--text-dim)">${totalNetGain>0?'brut '+formatNumber(totalGrossGain)+'€ ×0.75':'Optimisé'}</div></div>
    <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Meilleur</div><div style="font-size:20px;font-weight:800;color:var(--accent);font-family:var(--mono)">${bestOverall?bestOverall.rate+'%':'—'}</div><div style="font-size:10px;color:var(--text-dim)">${bestOverall?(bestOverall.productName||bestOverall.bankName):''}</div></div>
  </div>`;

  if(totalExitCost>0||totalNoticeCost>0){
    html+=`<div style="display:flex;gap:16px;margin-bottom:12px;padding:8px 12px;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15);border-radius:var(--radius-sm);font-size:10px"><span style="color:var(--text-muted)">Coûts :</span><span style="color:var(--orange)">earlyRate: -${formatNumber(totalExitCost)}€</span><span style="color:var(--orange)">Préavis: -${formatNumber(totalNoticeCost)}€</span><span style="color:var(--green)">Brut: +${formatNumber(totalGrossGain)}€/an</span><span style="color:var(--text-dim)">IS 25%: ×0.75</span></div>`;
  }

  // Web rates box (same as v5b)
  if(_optimizerRateSource==='all'&&_webRatesSummary&&_webRatesSummary.length>0){
    const usedWeb=_webRatesSummary.filter(r=>r.usedAsAlt),unusedWeb=_webRatesSummary.filter(r=>!r.usedAsAlt);
    const bestCR=Math.max(...(catManager.rates?.rates||[]).filter(r=>r.source!=='web scan'&&!_isRateExpired(r)).map(r=>r.rate),0);
    const bestWR=Math.max(..._webRatesSummary.map(r=>r.rate),0);
    html+=`<div style="margin-bottom:12px;padding:12px;background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.2);border-radius:var(--radius-sm)"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:12px;font-weight:600;color:var(--purple)">📞 ${_webRatesSummary.length} taux web évalués</span><span style="font-size:10px;color:var(--text-dim)">${_webRatesUsedCount} utilisé${_webRatesUsedCount>1?'s':''}</span></div>`;
    if(usedWeb.length>0){html+=`<div style="font-size:10px;color:var(--green)">✅ ${usedWeb.length} retenus :</div>`;usedWeb.forEach(r=>{html+=`<div style="font-size:10px;color:var(--text-bright)">→ ${r.name} (${r.bank}) <strong style="color:var(--green)">${r.rate}%</strong></div>`;});}
    if(unusedWeb.length>0){const g={};unusedWeb.forEach(r=>{if(!g[r.bank])g[r.bank]={n:0,mx:0};g[r.bank].n++;g[r.bank].mx=Math.max(g[r.bank].mx,r.rate);});html+=`<div style="margin-top:6px;font-size:10px;color:var(--text-dim)">❌ ${unusedWeb.length} non retenus :</div>`;Object.entries(g).forEach(([b,v])=>{html+=`<div style="font-size:10px;color:var(--text-muted)">${b}: max ${v.mx}%${v.mx<bestCR?' (< '+bestCR+'%)':''} — ${v.n} taux</div>`;});}
    if(bestWR<=bestCR&&!usedWeb.length){html+=`<div style="margin-top:8px;padding:8px;background:rgba(6,214,160,0.08);border-radius:4px;font-size:10px;color:var(--green)">💡 Vos taux négociés (${bestCR}%) > tous les taux web (${bestWR}%).</div>`;}
    html+=`</div>`;
  }

  // Table with break-even column
  html+=`<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden"><div style="max-height:400px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">
    <th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th>
    <th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur</th>
    <th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500" title="NET après IS 25%">NET/an</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500" title="Mois pour amortir les coûts">B/E</th>
    <th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th>
  </tr></thead><tbody>`;
  depositAnalysis.forEach(d=>{
    const rc=d.recommendation==='ARBITRER'?'var(--orange)':d.recommendation==='SURVEILLER'?'var(--cyan)':'var(--green)';
    const ri=d.recommendation==='ARBITRER'?'🔄':d.recommendation==='SURVEILLER'?'👀':'✅';
    const sp=d.bestAlt?(d.bestAlt.rate-d.rate).toFixed(2):'—';
    const ab=d.bestAlt?.isScanned?'<span style="font-size:7px;color:var(--purple);background:rgba(139,92,246,0.15);padding:0 4px;border-radius:6px">web</span>':'';
    const beColor = d.breakEvenMonths && d.breakEvenMonths > d.remainingMonths ? 'var(--red)' : d.breakEvenMonths ? 'var(--text-bright)' : 'var(--text-dim)';
    const beText = d.breakEvenMonths ? d.breakEvenMonths + 'm' : '—';
    const dmWarn = d.durationMismatch ? '<div style="font-size:7px;color:var(--orange)">⚠️durée</div>' : '';

    html+=`<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background=''">
      <td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity?' · '+d.entity:''}${d.fgdrScore>0.3?' <span style="color:var(--orange)">⚠️FGDR</span>':''}</div></td>
      <td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td>
      <td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;color:${d.bestAlt&&d.bestAlt.rate>d.rate?'var(--orange)':'var(--green)'}">${d.rate}%</span>${d.currentPeriodRate!==d.rate?'<div style="font-size:9px;color:var(--text-dim)">palier '+d.currentPeriodRate+'%</div>':''}</td>
      <td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td>
      <td style="padding:8px 6px;text-align:center">${d.bestAlt?'<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">'+d.bestAlt.rate+'%</span>'+ab+dmWarn+'<div style="font-size:9px;color:var(--text-dim)">'+d.bestAlt.name+'</div>':'<span style="color:var(--green)">✨</span>'}</td>
      <td style="padding:8px 6px;text-align:right"><span style="font-family:var(--mono);font-weight:600;color:${d.netGainAfterTax>0?'var(--green)':d.netGainAfterTax<0?'var(--red)':'var(--text-dim)'}">${d.netGainAfterTax!==0?(d.netGainAfterTax>0?'+':'')+formatNumber(d.netGainAfterTax)+'€':'—'}</span>${d.exitPenaltyCost>0?'<div style="font-size:8px;color:var(--orange)">coûts -'+formatNumber(d.exitPenaltyCost+d.noticeOpportunityCost)+'€</div>':''}</td>
      <td style="padding:8px 6px;text-align:center;font-size:10px;color:${beColor}">${beText}</td>
      <td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${rc};background:${rc}12;border:1px solid ${rc}30">${ri} ${d.recommendation}</span></td>
    </tr>`;
  });
  html+=`</tbody></table></div></div>`;
  if(cashOpportunities.length>0){html+=`<div style="margin-top:16px"><h3 style="font-size:12px;color:var(--cyan);margin-bottom:8px">💰 Placer ${formatNumber(placable)}€</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">`;cashOpportunities.forEach((c,i)=>{html+=`<div style="background:var(--bg-elevated);border:1px solid ${i===0?'var(--cyan)':'var(--border)'};border-radius:var(--radius-sm);padding:10px">${i===0?'<div style="font-size:9px;color:var(--cyan);margin-bottom:4px">⭐</div>':''}<div style="display:flex;justify-content:space-between"><strong style="font-size:11px;color:var(--text-bright)">${c.name}</strong><span style="font-family:var(--mono);color:var(--green);font-weight:700">${c.rate}%</span></div><div style="font-size:10px;color:var(--text-muted);margin-top:4px">${c.duration}m · +${formatNumber(c.interestPerYear)}€/an${c.isScanned?' <span style="font-size:7px;color:var(--purple);background:rgba(139,92,246,0.15);padding:0 4px;border-radius:6px">web</span>':''}</div></div>`;});html+=`</div></div>`;}
  return html;
}

// ═══ DASHBOARD ═══════════════════════════════════════════
function renderOptimizerDashboard() {
  if(!_lastOptimizerResult)return '';const r=_lastOptimizerResult;
  const dt=r.lastUpdated?new Date(r.lastUpdated):null;const ds=dt?dt.toLocaleDateString('fr-FR')+' '+dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'';
  const deps=r.deposits||[];const sl=r.rateSource==='all'?'🔍 tous':'✅ confirmés';const al=r.algorithmVersion||'v2';
  let html=`<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:var(--purple)"></span>⚡ Optimisation</div><div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--text-dim)">${ds} · ${sl} · ${al}</span><button class="btn sm ai-glow" onclick="showCATSimulator()">🔄</button></div></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px">
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Actuel</div><div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono);margin-top:4px">+${formatNumber(r.totalInterestPerYear)}€<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">${(r.weightedRate||0).toFixed(2)}%</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Après IS</div><div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain>0?'var(--cyan)':'var(--green)'};font-family:var(--mono);margin-top:4px">+${formatNumber(r.optimizedInterest)}€<span style="font-size:11px">/an</span></div><div style="font-size:10px;color:var(--text-dim)">${(r.optimizedRate||0).toFixed(2)}%</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Gain NET IS</div><div style="font-size:20px;font-weight:800;color:${r.totalPotentialGain>0?'var(--green)':'var(--text-dim)'};font-family:var(--mono);margin-top:4px">${r.totalPotentialGain>0?'+'+formatNumber(r.totalPotentialGain)+'€':'✅'}</div><div style="font-size:10px;color:var(--text-dim)">${r.totalPotentialGain>0?'après coûts + IS':'Optimisé'}</div></div>
      <div style="background:var(--bg-card);padding:12px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Périmètre</div><div style="font-size:20px;font-weight:800;color:var(--text-bright);margin-top:4px">${r.depositCount||0} <span style="font-size:11px;color:var(--text-dim)">vs ${r.rateCount||0}</span></div><div style="font-size:10px;color:var(--text-dim)">${r.arbitrageCount||0} arbitrage${(r.arbitrageCount||0)>1?'s':''}</div></div>
    </div>`;
  if(deps.length>0){html+=`<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px"><div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between"><span style="font-size:12px;font-weight:600;color:var(--text-bright)">📊 Contrats vs marché (NET après IS)</span><span style="font-size:10px;color:var(--text-dim)">${deps.length}</span></div><div style="max-height:320px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)"><th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:500">Produit</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">Montant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Taux</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Restant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Meilleur</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:500">NET/an</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:500">Action</th></tr></thead><tbody>`;
  deps.forEach(d=>{const rc=d.recommendation==='ARBITRER'?'var(--orange)':d.recommendation==='SURVEILLER'?'var(--cyan)':'var(--green)';const ri=d.recommendation==='ARBITRER'?'🔄':d.recommendation==='SURVEILLER'?'👀':'✅';const g=d.switchGainPerYear||0;
    html+=`<tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity?' · '+d.entity:''}</div></td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td><td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;color:var(--green)">${d.rate}%</span></td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td><td style="padding:8px 6px;text-align:center">${d.bestAlt?'<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">'+d.bestAlt.rate+'%</span>':'✨'}</td><td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:${g>0?'var(--green)':g<0?'var(--red)':'var(--text-dim)'}">${g!==0?(g>0?'+':'')+formatNumber(g)+'€':'—'}</td><td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${rc};background:${rc}12;border:1px solid ${rc}30">${ri} ${d.recommendation}</span></td></tr>`;});
  html+=`</tbody></table></div></div>`;}
  if(r.summary)html+=_renderAISummaryBlock(r.summary);
  html+=`</div>`;return html;
}

// ═══ AI PROMPT ═══════════════════════════════════════════
async function getAIOptimizerSummary(analysis) {
  const{depositAnalysis,cashOpportunities,placable,totalInvested,totalInterestPerYear,weightedRate,totalNetGain,totalGrossGain,totalExitCost,totalNoticeCost,optimizedInterest,optimizedRate,_webRatesSummary,_webRatesUsedCount,_webCount}=analysis;
  const src=_optimizerRateSource==='confirmed'?'taux confirmés':'tous (confirmés + '+_webCount+' web)';
  const webNote=_optimizerRateSource==='all'&&_webCount>0?`\n\nTAUX WEB (${_webCount}):\n${(_webRatesSummary||[]).map(r=>`• ${r.name} (${r.bank}) ${r.rate}% — ${r.usedAsAlt?'✅ retenu':'❌ < contrats'}`).join('\n')}`:'';

  const dText=depositAnalysis.map(d=>{let l=`• ${d.name} (${d.bankName}) | ${d.amount}€ à ${d.rate}%`;if(d.currentPeriodRate!==d.rate)l+=` (palier ${d.currentPeriodRate}%)`;l+=` | ${d.remainingMonths}m`;if(d.bestAlt){l+=` | Cible: ${d.bestAlt.rate}% (${d.bestAlt.name})${d.bestAlt.isScanned?' [web]':''}`;l+=` | Brut: +${d.grossGainAnnual}€`;if(d.exitPenaltyCost>0)l+=` | Pénalité: -${d.exitPenaltyCost}€`;l+=` | NET après IS: ${d.netGainAfterTax>0?'+':''}${d.netGainAfterTax}€/an`;if(d.breakEvenMonths)l+=` | Break-even: ${d.breakEvenMonths}m`;}l+=` → ${d.recommendation}`;return l;}).join('\n');
  const cText=placable>0&&cashOpportunities.length>0?'\n\n💰 CASH: '+formatNumber(placable)+'€\n'+cashOpportunities.slice(0,3).map(c=>`• ${c.name} ${c.rate}% → +${c.interestPerYear}€/an`).join('\n'):'';

  const prompt=`Directeur financier. Optimisation v2.1 (gains NET après IS 25%). Source: ${src}.

**AVANT:** ${formatNumber(totalInvested)}€ à ${weightedRate.toFixed(2)}% = +${formatNumber(totalInterestPerYear)}€/an
**APRÈS (NET IS):** ${optimizedRate.toFixed(2)}% = +${formatNumber(optimizedInterest)}€/an
Brut: +${formatNumber(totalGrossGain)}€ | Coûts: -${formatNumber(totalExitCost+totalNoticeCost)}€ | IS 25% | **NET: ${totalNetGain>0?'+':''}${formatNumber(totalNetGain)}€/an**${webNote}

${depositAnalysis.length} CONTRATS:
${dText}${cText}

FORMAT:
- **AVANT → APRÈS (NET IS +Z€)**
- Chaque arbitrage: 🔄 **[Nom]** → **[cible]** = **NET IS +Z€/an** (break-even: Xm) ⚠️ [conditions]
- Si gain NET IS négatif: expliquer
- ✅ **N contrats** leaders
- Tous les gains sont après IS 25%
- Max 180 mots`;

  const res=await fetch(CONFIG.AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1500,messages:[{role:'user',content:prompt}]})});
  if(!res.ok)throw new Error('IA: '+res.status);
  const data=await res.json();
  return data.content?.map(b=>b.text||'').join('\n')||'';
}

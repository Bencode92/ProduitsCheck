// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Smart CAT Optimizer V3 — Remaining Effective Rate
// Fix 1: Explicit min 3 months filter
// Fix 2: IS tax factor (×0.75) on net gain
// Fix 3: Stricter duration matching + break-even + mismatch warning
// Fix 4: Uses REMAINING effective rate (not TRAAB) for progressive CATs
//        + acceleration loss calculation for progressive schedules
// ═══════════════════════════════════════════════════════════════

let _lastOptimizerResult = null;
let _optimizerRateSource = 'confirmed';
const _IS_TAX_RATE = 0.25; // Impôt sur les sociétés

async function loadOptimizerResult() { try { const d = await github.readFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`); if (d) _lastOptimizerResult = d; } catch(e) {} }

async function saveOptimizerResult(summary, analysis) {
  const result = { lastUpdated: new Date().toISOString(), summary, rateSource: _optimizerRateSource, algorithmVersion: 'v3',
    totalInvested: analysis.totalInvested, totalInterestPerYear: analysis.totalInterestPerYear,
    weightedRate: analysis.weightedRate, optimizedInterest: analysis.optimizedInterest,
    optimizedRate: analysis.optimizedRate, totalPotentialGain: analysis.totalNetGain,
    totalGrossGain: analysis.totalGrossGain, totalExitCost: analysis.totalExitCost, totalNoticeCost: analysis.totalNoticeCost,
    arbitrageCount: analysis.arbitrageCount, depositCount: analysis.depositAnalysis.length, rateCount: analysis._rateCount || 0,
    deposits: analysis.depositAnalysis.map(d => ({
      name: d.name, bankName: d.bankName, entity: d.entity, amount: d.amount,
      rate: d.rate, currentPeriodRate: d.currentPeriodRate, remainingEffectiveRate: d.remainingEffectiveRate, interestPerYear: d.interestPerYear,
      remainingMonths: d.remainingMonths, maturityDate: d.maturityDate,
      bestAlt: d.bestAlt, switchGainPerYear: d.netGainAnnual, grossGainPerYear: d.grossGainAnnual,
      exitPenaltyCost: d.exitPenaltyCost, noticeOpportunityCost: d.noticeOpportunityCost,
      netGainAfterTax: d.netGainAfterTax, accelerationLoss: d.accelerationLoss || 0,
      keep12m: d.keep12m, switch12m: d.switch12m, advantage12m: d.advantage12m, advantage12mAfterTax: d.advantage12mAfterTax,
      breakEvenMonths: d.breakEvenMonths, durationMismatch: d.durationMismatch, isProgressif: d.isProgressif,
      dynamicThreshold: d.dynamicThreshold, compositeScore: d.compositeScore,
      recommendation: d.recommendation, reason: d.reason,
    })),
  };
  _lastOptimizerResult = result;
  await github.writeFile(`${CONFIG.DATA_PATH}/cat/optimizer-result.json`, result, '[StructBoard] Optimizer v3');
}

// ═══ FORMATTING ══════════════════════════════════════════
function _mdToHtmlTable(md) { return md.replace(/(\|[^\n]+\|\n)((?:\|[-:| ]+\|\n))(\|[^\n]+\|\n?)+/g, (match) => { const lines = match.trim().split('\n').filter(l => l.trim()); if (lines.length < 2) return match; const parseRow = (line) => line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim()); const headers = parseRow(lines[0]); const ds = /^\|[\s:-]+\|$/.test(lines[1].trim().replace(/\|/g, '|')) ? 2 : 1; let h = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin:12px 0"><thead><tr>'; headers.forEach(x => { h += `<th style="padding:8px 10px;text-align:left;color:var(--accent);font-weight:600;border-bottom:2px solid var(--border)">${x.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</th>`; }); h += '</tr></thead><tbody>'; for (let i = ds; i < lines.length; i++) { const cells = parseRow(lines[i]); if (!cells.length) continue; h += '<tr style="border-bottom:1px solid var(--border)">'; cells.forEach((c, j) => { const s = j === 0 ? 'font-weight:600;color:var(--text-bright)' : c.includes('ARBITRER') ? 'color:var(--orange);font-weight:600' : c.includes('GARDER') ? 'color:var(--green);font-weight:600' : /^\+/.test(c) ? 'color:var(--green);font-family:var(--mono)' : ''; h += `<td style="padding:6px 10px;${s}">${c.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</td>`; }); h += '</tr>'; } h += '</tbody></table>'; return h; }); }
function _formatOptimizerAI(t) { return t ? formatAIText(_mdToHtmlTable(t)) : ''; }
function _renderAISummaryBlock(summary) { if (!summary) return ''; return `<div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius);overflow:hidden"><div style="padding:12px 16px;background:rgba(59,130,246,0.08);border-bottom:1px solid rgba(59,130,246,0.15);display:flex;align-items:center;gap:8px"><span style="font-size:16px">🤖</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Recommandations Claude (algo v3)</span></div><div style="padding:16px;font-size:12px;line-height:1.7;color:var(--text)" class="ai-summary">${_formatOptimizerAI(summary)}</div></div>`; }

// ═══ V3.1 ALGORITHM — 12-Month Horizon Comparison ════════
const MIN_MONTHS_FOR_ARBITRAGE = 3;
const HORIZON_MONTHS = 12;
const HORIZON_DAYS = 365;

// Calculate total € earned over next 12 months for KEEP scenario
// If CAT matures before 12m: interest until maturity + reinvest freed cash at bestReinvestRate
function _calcKeepScenario12m(deposit, bestReinvestRate) {
  const amount = parseFloat(deposit.amount) || 0;
  const now = new Date();
  const horizon = new Date(now); horizon.setMonth(horizon.getMonth() + HORIZON_MONTHS);
  const maturity = deposit.maturityDate ? new Date(deposit.maturityDate) : null;
  const schedule = deposit.rateSchedule;

  let interestKeep = 0;

  if (schedule && schedule.length > 0) {
    // Progressive: sum interest from each remaining period, capped at horizon
    for (const step of schedule) {
      const stepFrom = new Date(step.from);
      const stepTo = new Date(step.to);
      const effectiveFrom = stepFrom > now ? stepFrom : now;
      const effectiveTo = stepTo < horizon ? stepTo : horizon;
      if (effectiveTo <= effectiveFrom) continue;
      const days = (effectiveTo - effectiveFrom) / 864e5;
      interestKeep += amount * (parseFloat(step.rate) || 0) / 100 * (days / 365);
    }
  } else {
    // Fixed rate: interest until min(maturity, horizon)
    const rate = parseFloat(deposit.rate) || 0;
    const endDate = maturity && maturity < horizon ? maturity : horizon;
    const days = Math.max(0, (endDate - now) / 864e5);
    interestKeep += amount * (rate / 100) * (days / 365);
  }

  // If maturity falls within 12m horizon, reinvest freed amount at best rate for remaining months
  if (maturity && maturity < horizon && maturity > now && bestReinvestRate > 0) {
    const reinvestDays = (horizon - maturity) / 864e5;
    interestKeep += amount * (bestReinvestRate / 100) * (reinvestDays / 365);
  }

  return Math.round(interestKeep * 100) / 100;
}

// Calculate total € earned over next 12 months for SWITCH scenario
// Break now → pay exit costs → reinvest at altRate for altDuration (capped at 12m)
function _calcSwitchScenario12m(deposit, altRate, exitCosts) {
  const amount = parseFloat(deposit.amount) || 0;
  const now = new Date();
  // Notice period: 32 days where money earns nothing
  const noticeDays = (deposit.exitCondition === 'notice') ? 32 : 0;
  const investDays = Math.max(0, HORIZON_DAYS - noticeDays);
  const grossInterest = amount * (altRate / 100) * (investDays / 365);
  const netInterest = grossInterest - exitCosts;
  return Math.round(netInterest * 100) / 100;
}

// FIX #4: Calculate weighted average rate of REMAINING periods only
// For progressive CATs, the TRAAB is misleading mid-term — what matters is the rate going forward
function _calcRemainingEffectiveRate(deposit) {
  const schedule = deposit.rateSchedule;
  if (!schedule || schedule.length === 0) return parseFloat(deposit.rate) || 0;

  const now = new Date();
  const maturity = deposit.maturityDate ? new Date(deposit.maturityDate) : null;
  if (!maturity || maturity <= now) return parseFloat(deposit.rate) || 0;

  let totalWeightedRate = 0, totalDays = 0;

  for (const step of schedule) {
    const stepFrom = new Date(step.from);
    const stepTo = new Date(step.to);
    // Only consider the portion of this period that is in the future
    const effectiveFrom = stepFrom > now ? stepFrom : now;
    const effectiveTo = stepTo;
    if (effectiveTo <= effectiveFrom) continue; // period fully elapsed

    const days = (effectiveTo - effectiveFrom) / 864e5;
    const rate = parseFloat(step.rate) || 0;
    totalWeightedRate += rate * days;
    totalDays += days;
  }

  if (totalDays <= 0) return parseFloat(deposit.rate) || 0;
  return Math.round(totalWeightedRate / totalDays * 100) / 100;
}

// FIX #4: Calculate the total remaining interest if we KEEP the deposit until maturity
// This is the opportunity cost of breaking early — we lose the future progressive acceleration
function _calcRemainingInterest(deposit) {
  const schedule = deposit.rateSchedule;
  const amount = parseFloat(deposit.amount) || 0;
  if (!schedule || schedule.length === 0) {
    const rate = parseFloat(deposit.rate) || 0;
    const now = new Date();
    const maturity = deposit.maturityDate ? new Date(deposit.maturityDate) : null;
    if (!maturity || maturity <= now) return 0;
    const daysLeft = (maturity - now) / 864e5;
    return Math.round(amount * (rate / 100) * (daysLeft / 365) * 100) / 100;
  }

  const now = new Date();
  let total = 0;
  for (const step of schedule) {
    const stepFrom = new Date(step.from);
    const stepTo = new Date(step.to);
    const effectiveFrom = stepFrom > now ? stepFrom : now;
    if (stepTo <= effectiveFrom) continue;
    const days = (stepTo - effectiveFrom) / 864e5;
    total += amount * (parseFloat(step.rate) || 0) / 100 * (days / 365);
  }
  return Math.round(total * 100) / 100;
}

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

    // FIX #4: Remaining effective rate — the TRUE rate for arbitrage comparison
    const remainingEffectiveRate = _calcRemainingEffectiveRate(d);
    const remainingInterest = _calcRemainingInterest(d);
    const isProgressif = d.rateSchedule && d.rateSchedule.length > 1;
    // For comparison: use remaining effective rate, not TRAAB
    const comparisonRate = remainingEffectiveRate;

    // FIX #1: No arbitrage if < 3 months remaining — skip search entirely
    if (remainingMonths < MIN_MONTHS_FOR_ARBITRAGE) {
      return { id:d.id, name:d.productName||'CAT', bankName:d.bankName, entity:d.entityName||'',
        amount, rate, currentPeriodRate, remainingEffectiveRate, remainingInterest,
        durationMonths, elapsedMonths, remainingMonths, interestPerYear,
        bestAlt:null, grossGainAnnual:0, exitPenaltyCost:0, noticeOpportunityCost:0,
        netGainAnnual:0, netGainAfterTax:0, netGainRemaining:0, breakEvenMonths:null, durationMismatch:false,
        switchGainPerYear:0, dynamicThreshold:0, fgdrScore:_calcFgdrScore(d,active,fgdrLimit), fgdrBonus:0, compositeScore:0,
        recommendation:'GARDER', reason:`< ${MIN_MONTHS_FOR_ARBITRAGE} mois restants — attendre maturité`,
        maturityDate:d.maturityDate, exitPenalty:d.exitPenalty||'', altWithdrawalConditions:'', isProgressif };
    }

    // Stricter duration matching — prefer rates within ±50% of remaining duration
    // FIX #4: Compare against remainingEffectiveRate, not TRAAB
    const compatible=Object.values(bestByDuration).filter(r=>{
      if(r.rate<=comparisonRate) return false;
      if(remainingMonths > 6) {
        const ratio = r.durationMonths / remainingMonths;
        if(ratio < 0.5 || ratio > 2.0) return false;
      }
      return true;
    }).sort((a,b)=>b.rate-a.rate);
    const bestAlt=compatible[0]||null;

    // Duration mismatch warning
    const durationMismatch = bestAlt ? Math.abs(bestAlt.durationMonths - remainingMonths) > remainingMonths * 0.5 : false;

    // FIX #4: Spread uses remaining effective rate
    const spread=bestAlt?bestAlt.rate-comparisonRate:0;
    const grossGainAnnual=bestAlt?Math.round(amount*spread/100*100)/100:0;
    const exitPenaltyCost=_calcExitPenaltyCost(d);
    const noticeOpportunityCost=bestAlt?_calcNoticeOpportunityCost(d,bestAlt.rate):0;

    // FIX #4: For progressive CATs, add opportunity cost of losing future acceleration
    // = remaining interest at current CAT vs remaining interest at flat alternative rate
    let accelerationLoss = 0;
    if (isProgressif && bestAlt && remainingMonths > 0) {
      const altInterestRemaining = Math.round(amount * (bestAlt.rate / 100) * (remainingMonths / 12) * 100) / 100;
      // If keeping the progressive CAT earns more than switching, that's an acceleration loss
      if (remainingInterest > altInterestRemaining) {
        accelerationLoss = Math.round((remainingInterest - altInterestRemaining) * 100) / 100;
      }
    }

    const totalOneTimeCosts=exitPenaltyCost+noticeOpportunityCost;
    const yearsRemaining = remainingMonths / 12;

    // ═══ V3.1: 12-MONTH HORIZON COMPARISON ═══
    // Best reinvestment rate = best rate for 12m or closest duration
    const bestReinvest = bestOverall ? bestOverall.rate : 0;
    const keep12m = _calcKeepScenario12m(d, bestReinvest);
    const switch12m = bestAlt ? _calcSwitchScenario12m(d, bestAlt.rate, totalOneTimeCosts) : 0;
    const advantage12m = bestAlt ? Math.round((switch12m - keep12m) * 100) / 100 : 0;
    // After IS 25%
    const advantage12mAfterTax = Math.round(advantage12m * (1 - _IS_TAX_RATE) * 100) / 100;

    // Annualized for display consistency
    const trueNetGainAfterTax = advantage12mAfterTax;
    const trueNetGainAnnual = Math.round(advantage12m * (1 - _IS_TAX_RATE) * 100) / 100;

    // Break-even in months
    const grossGainMonthly = bestAlt ? Math.max(0, advantage12m) / 12 : 0;
    const breakEvenMonths = totalOneTimeCosts > 0 && grossGainMonthly > 0
      ? _calcBreakEvenMonths(totalOneTimeCosts, grossGainMonthly)
      : null;

    const dynThreshold=_dynamicThreshold(amount,remainingMonths);
    const fgdrSc=_calcFgdrScore(d,active,fgdrLimit);
    const fgdrBonus=bestAlt?_calcFgdrBonus(d,bestAlt.bankName,active,fgdrLimit):0;
    const adjustedSpread=spread+fgdrBonus;
    const normNG=Math.min(1,Math.max(0,trueNetGainAfterTax/Math.max(amount*0.01,1)));
    const normS=Math.min(1,Math.max(0,adjustedSpread));
    const normF=fgdrBonus>0?fgdrBonus/0.15:0;
    const normT=Math.min(1,remainingMonths/60);
    const compositeScore=0.50*normNG+0.25*normS+0.15*normF+0.10*normT;

    const bestAltFull=bestAlt?rates.find(r=>r.rate===bestAlt.rate&&r.durationMonths===bestAlt.durationMonths):null;
    const altIsScanned=bestAltFull?.source==='web scan';
    if(altIsScanned&&bestAltFull) webRatesUsed.add(bestAltFull.productName||bestAltFull.bankName+' '+bestAltFull.durationMonths+'m');

    // V3.1: Decision based on 12-month € comparison
    let recommendation='GARDER',reason='';
    const maturesWithin12m = remainingMonths <= 12;

    if(bestAlt && advantage12mAfterTax > 0 && adjustedSpread >= dynThreshold) {
      if(breakEvenMonths && breakEvenMonths > remainingMonths) {
        recommendation='SURVEILLER';
        reason=`Break-even ${breakEvenMonths}m > restant ${remainingMonths}m`;
      } else {
        recommendation='ARBITRER';
        reason=`Sur 12m: garder=${formatNumber(keep12m)}€ vs arbitrer=${formatNumber(switch12m)}€ → +${formatNumber(advantage12mAfterTax)}€ net IS`;
      }
    } else if(bestAlt && spread > 0 && advantage12mAfterTax <= 0) {
      recommendation='GARDER';
      if (maturesWithin12m) {
        reason=`Garder + réinvestir à maturité: ${formatNumber(keep12m)}€/12m > arbitrer: ${formatNumber(switch12m)}€`;
      } else {
        const costDetail = accelerationLoss > 0 ? ` (paliers futurs: +${formatNumber(accelerationLoss)}€)` : '';
        reason=`Sur 12m: garder=${formatNumber(keep12m)}€ > arbitrer=${formatNumber(switch12m)}€${costDetail}`;
      }
    } else if(comparisonRate >= (bestOverall?.rate||0)) {
      reason = isProgressif
        ? `Leader marché (restant ${comparisonRate}% > TRAAB ${rate}%) · 12m: +${formatNumber(keep12m)}€`
        : `Leader marché · 12m: +${formatNumber(keep12m)}€`;
    } else {
      reason = `Taux restant ${comparisonRate}% · 12m: +${formatNumber(keep12m)}€`;
    }

    return { id:d.id, name:d.productName||'CAT', bankName:d.bankName, entity:d.entityName||'',
      amount, rate, currentPeriodRate, remainingEffectiveRate, remainingInterest,
      durationMonths, elapsedMonths, remainingMonths, interestPerYear,
      bestAlt:bestAlt?{name:bestAlt.productName||bestAlt.bankName+' '+bestAlt.durationMonths+'m',rate:bestAlt.rate,duration:bestAlt.durationMonths,bankName:bestAlt.bankName,isScanned:altIsScanned}:null,
      grossGainAnnual, exitPenaltyCost, noticeOpportunityCost, accelerationLoss,
      keep12m, switch12m, advantage12m, advantage12mAfterTax,
      netGainAnnual:trueNetGainAnnual, netGainAfterTax:trueNetGainAfterTax,
      netGainRemaining:Math.round(trueNetGainAfterTax*yearsRemaining*100)/100,
      breakEvenMonths, durationMismatch, isProgressif,
      switchGainPerYear:trueNetGainAfterTax,
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
    <h2 class="modal-title">⚡ Optimiseur v3</h2>
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
      <strong style="color:var(--accent)">v3.1</strong> : comparaison € sur 12 mois (garder+réinvestir vs arbitrer), taux effectif restant, NET après IS (×0.75).</div>
    <button class="btn ai-glow lg" style="width:100%" onclick="launchOptimizer()">⚡ Optimiser (${n} contrats)</button>
    <div id="optimizer-results" style="margin-top:16px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>
  </div></div>`;
  modal.classList.add('visible');
};

function launchOptimizer() {
  _optimizerRateSource=document.querySelector('input[name="opt-source"]:checked')?.value||'confirmed';
  document.getElementById('optimizer-results').innerHTML=`<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-muted)"><div class="spinner"></div>Analyse v3...</div>`;
  setTimeout(()=>runSmartOptimizer(),100);
}

async function runSmartOptimizer() {
  const results=document.getElementById('optimizer-results');
  if(!results)return;
  try{
    const analysis=buildOptimizationAnalysis();
    const srcBadge=_optimizerRateSource==='confirmed'
      ?'<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--green);background:rgba(6,214,160,0.1);border:1px solid rgba(6,214,160,0.3);margin-bottom:12px">✅ vs '+analysis._confirmedCount+' confirmés · v3 (NET après IS)</span>'
      :'<span style="display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:600;color:var(--purple);background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);margin-bottom:12px">🔍 vs '+analysis._rateCount+' taux · v3 (NET après IS)</span>';
    let html=srcBadge+renderOptimizationTable(analysis);
    html+='<div id="ai-optimizer-summary" style="margin-top:16px"><div style="display:flex;align-items:center;gap:10px;padding:16px;color:var(--text-muted);background:var(--accent-glow);border-radius:var(--radius-sm)"><div class="spinner"></div>Claude analyse (v3)...</div></div>';
    results.innerHTML=html;
    const ai=await getAIOptimizerSummary(analysis);
    const d=document.getElementById('ai-optimizer-summary');
    if(d)d.innerHTML=_renderAISummaryBlock(ai);
    await saveOptimizerResult(ai,analysis);
    showToast('v3 OK','success');
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

  // Table v3 — remaining effective rate as PRIMARY, visual row accents
  html+=`<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden"><div style="max-height:450px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)">
    <th style="padding:10px 12px;text-align:left;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Produit</th>
    <th style="padding:10px 8px;text-align:right;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Montant</th>
    <th style="padding:10px 8px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px" title="Taux effectif restant (ou TRAAB si fixe)">Taux effectif</th>
    <th style="padding:10px 8px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Durée</th>
    <th style="padding:10px 8px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Alternative</th>
    <th style="padding:10px 8px;text-align:right;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px" title="Comparaison € sur 12 mois: garder vs arbitrer">Sur 12 mois</th>
    <th style="padding:10px 8px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.5px"></th>
  </tr></thead><tbody>`;
  depositAnalysis.forEach(d=>{
    const isArbitrer = d.recommendation === 'ARBITRER';
    const isSurveiller = d.recommendation === 'SURVEILLER';
    const rc=isArbitrer?'var(--orange)':isSurveiller?'var(--cyan)':'var(--green)';
    const ri=isArbitrer?'🔄':isSurveiller?'👀':'✅';
    const ab=d.bestAlt?.isScanned?'<span style="font-size:7px;color:var(--purple);background:rgba(139,92,246,0.15);padding:1px 5px;border-radius:6px;margin-left:4px">web</span>':'';
    const beColor = d.breakEvenMonths && d.breakEvenMonths > d.remainingMonths ? 'var(--red)' : d.breakEvenMonths ? 'var(--text-bright)' : 'var(--text-dim)';
    const beText = d.breakEvenMonths ? d.breakEvenMonths + 'm' : '';
    const dmWarn = d.durationMismatch ? ' <span style="font-size:7px;color:var(--orange)">⚠️</span>' : '';

    // Row accent: left border + subtle background for ARBITRER
    const rowBg = isArbitrer ? 'background:rgba(251,191,36,0.04)' : '';
    const rowBorder = isArbitrer ? 'border-left:3px solid var(--orange)' : isSurveiller ? 'border-left:3px solid rgba(34,211,238,0.3)' : 'border-left:3px solid transparent';

    // v3 UX: Remaining effective rate is THE primary number
    const effectiveRate = d.remainingEffectiveRate || d.rate;
    const showRemaining = d.isProgressif && Math.abs((d.remainingEffectiveRate||0) - d.rate) >= 0.2;
    const effColor = d.bestAlt && d.bestAlt.rate > effectiveRate ? 'var(--orange)' : 'var(--green)';
    let rateCell = `<span style="font-family:var(--mono);font-weight:800;font-size:13px;color:${effColor}">${effectiveRate}%</span>`;
    if (showRemaining) {
      rateCell += `<div style="font-size:9px;color:var(--text-dim);margin-top:1px">TRAAB ${d.rate}% · 📈</div>`;
    }

    // Impact column: 12-month € comparison
    let impactCell = '';
    if (d.keep12m > 0) {
      impactCell = `<div style="font-size:10px;color:var(--text-muted)">garder: <span style="font-family:var(--mono);color:var(--green)">${formatNumber(d.keep12m)}€</span></div>`;
      if (d.bestAlt && d.switch12m !== 0) {
        if (d.advantage12mAfterTax > 0) {
          // ARBITRER wins: show both + green advantage
          impactCell += `<div style="font-size:10px;color:var(--text-muted)">arbitrer: <span style="font-family:var(--mono);color:var(--cyan)">${formatNumber(d.switch12m)}€</span></div>`;
          impactCell += `<div style="font-family:var(--mono);font-weight:700;font-size:11px;color:var(--green);margin-top:2px">+${formatNumber(d.advantage12mAfterTax)}€ net IS</div>`;
        } else {
          // GARDER wins: show advantage positively
          const gain = Math.abs(d.advantage12mAfterTax);
          impactCell += `<div style="font-size:9px;color:var(--text-dim);margin-top:2px">arbitrer perdrait ${formatNumber(gain)}€</div>`;
        }
      } else if (!d.bestAlt) {
        impactCell += `<div style="font-size:9px;color:var(--green)">leader marché</div>`;
      }
    } else {
      impactCell = `<span style="color:var(--text-dim)">—</span>`;
    }

    // Alternative column with spread indicator
    let altCell = '';
    if (d.bestAlt) {
      const spread = (d.bestAlt.rate - effectiveRate).toFixed(2);
      const spreadColor = spread > 0 ? 'var(--cyan)' : 'var(--text-dim)';
      altCell = `<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">${d.bestAlt.rate}%</span>${ab}${dmWarn}`;
      altCell += `<div style="font-size:9px;color:var(--text-dim)">${d.bestAlt.name}</div>`;
      if (spread > 0) altCell += `<div style="font-size:8px;color:${spreadColor}">+${spread}% spread</div>`;
    } else {
      altCell = `<span style="color:var(--green);font-size:13px" title="Meilleur taux du marché">✨</span>`;
    }

    // Duration with break-even inline
    let durationCell = `<span style="font-weight:600">${d.remainingMonths}m</span>`;
    if (beText) durationCell += `<div style="font-size:8px;color:${beColor}" title="Break-even">⏱ ${beText}</div>`;

    html+=`<tr style="border-bottom:1px solid var(--border);${rowBg};${rowBorder};transition:background 0.15s" onmouseover="this.style.background='var(--bg-elevated)'" onmouseout="this.style.background='${isArbitrer?'rgba(251,191,36,0.04)':''}'">
      <td style="padding:10px 12px"><strong style="color:var(--text-bright);font-size:12px">${d.name}</strong><div style="font-size:10px;color:var(--text-dim);margin-top:2px">${d.bankName}${d.entity?' · <span style="opacity:0.7">'+d.entity+'</span>':''}${d.fgdrScore>0.3?' <span style="color:var(--orange)">⚠️FGDR</span>':''}</div></td>
      <td style="padding:10px 8px;text-align:right;font-family:var(--mono);font-weight:600">${formatNumber(d.amount)}€</td>
      <td style="padding:10px 8px;text-align:center">${rateCell}</td>
      <td style="padding:10px 8px;text-align:center;font-size:10px">${durationCell}</td>
      <td style="padding:10px 8px;text-align:center">${altCell}</td>
      <td style="padding:10px 8px;text-align:right">${impactCell}</td>
      <td style="padding:10px 8px;text-align:center"><span style="display:inline-block;padding:4px 10px;border-radius:10px;font-size:10px;font-weight:700;color:${rc};background:${rc}12;border:1px solid ${rc}30;white-space:nowrap">${ri} ${d.recommendation}</span></td>
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
  if(deps.length>0){
    const has12m = deps.some(d => d.keep12m != null);
    html+=`<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:16px"><div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between"><span style="font-size:12px;font-weight:600;color:var(--text-bright)">📊 Contrats — comparaison sur 12 mois</span><span style="font-size:10px;color:var(--text-dim)">${deps.length}</span></div><div style="max-height:400px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--bg-elevated);border-bottom:2px solid var(--border)"><th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">Produit</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">Montant</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">Taux effectif</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">Durée</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">Alt.</th><th style="padding:8px 6px;text-align:right;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">Sur 12 mois</th><th style="padding:8px 6px;text-align:center;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase"></th></tr></thead><tbody>`;
  deps.forEach(d=>{
    const isArb=d.recommendation==='ARBITRER';const isSurv=d.recommendation==='SURVEILLER';
    const rc=isArb?'var(--orange)':isSurv?'var(--cyan)':'var(--green)';const ri=isArb?'🔄':isSurv?'👀':'✅';
    const rowBg=isArb?'background:rgba(251,191,36,0.04);':'';
    const rowBorder=isArb?'border-left:3px solid var(--orange);':isSurv?'border-left:3px solid rgba(34,211,238,0.3);':'border-left:3px solid transparent;';
    const eff=d.remainingEffectiveRate||d.rate;
    const rateGap=d.remainingEffectiveRate?Math.abs(d.remainingEffectiveRate-d.rate):0;
    const rr=rateGap>=0.2?'<div style="font-size:9px;color:var(--text-dim)">TRAAB '+d.rate+'% · 📈</div>':'';

    // 12m column
    let col12m = '';
    if (has12m && d.keep12m != null) {
      col12m = `<div style="font-size:10px;color:var(--text-muted)">garder: <span style="font-family:var(--mono);color:var(--green)">${formatNumber(d.keep12m)}€</span></div>`;
      if (d.bestAlt && d.switch12m) {
        if (d.advantage12mAfterTax > 0) {
          col12m += `<div style="font-size:10px;color:var(--text-muted)">arbitrer: <span style="font-family:var(--mono);color:var(--cyan)">${formatNumber(d.switch12m)}€</span></div>`;
          col12m += `<div style="font-family:var(--mono);font-weight:700;font-size:11px;color:var(--green)">+${formatNumber(d.advantage12mAfterTax)}€</div>`;
        } else {
          const gain = Math.abs(d.advantage12mAfterTax || 0);
          col12m += `<div style="font-size:9px;color:var(--text-dim)">arbitrer perdrait ${formatNumber(gain)}€</div>`;
        }
      } else {
        col12m += `<div style="font-size:9px;color:var(--green)">leader marché</div>`;
      }
    } else {
      const g = d.switchGainPerYear || 0;
      col12m = g !== 0 ? `<span style="font-family:var(--mono);font-weight:600;color:${g>0?'var(--green)':'var(--text-dim)'}">${g>0?'+':''}${formatNumber(g)}€</span>` : '—';
    }

    html+=`<tr style="border-bottom:1px solid var(--border);${rowBg}${rowBorder}"><td style="padding:8px 10px"><strong style="color:var(--text-bright)">${d.name}</strong><div style="font-size:10px;color:var(--text-dim)">${d.bankName}${d.entity?' · '+d.entity:''}</div></td><td style="padding:8px 6px;text-align:right;font-family:var(--mono)">${formatNumber(d.amount)}€</td><td style="padding:8px 6px;text-align:center"><span style="font-family:var(--mono);font-weight:700;font-size:12px;color:var(--green)">${eff}%</span>${rr}</td><td style="padding:8px 6px;text-align:center;font-size:10px">${d.remainingMonths}m</td><td style="padding:8px 6px;text-align:center">${d.bestAlt?'<span style="font-family:var(--mono);font-weight:700;color:var(--cyan)">'+d.bestAlt.rate+'%</span>':'✨'}</td><td style="padding:8px 6px;text-align:right">${col12m}</td><td style="padding:8px 6px;text-align:center"><span style="padding:3px 8px;border-radius:10px;font-size:10px;font-weight:700;color:${rc};background:${rc}12;border:1px solid ${rc}30">${ri} ${d.recommendation}</span></td></tr>`;});
  html+=`</tbody></table></div></div>`;}
  if(r.summary)html+=_renderAISummaryBlock(r.summary);
  html+=`</div>`;return html;
}

// ═══ AI PROMPT ═══════════════════════════════════════════
async function getAIOptimizerSummary(analysis) {
  const{depositAnalysis,cashOpportunities,placable,totalInvested,totalInterestPerYear,weightedRate,totalNetGain,totalGrossGain,totalExitCost,totalNoticeCost,optimizedInterest,optimizedRate,_webRatesSummary,_webRatesUsedCount,_webCount}=analysis;
  const src=_optimizerRateSource==='confirmed'?'taux confirmés':'tous (confirmés + '+_webCount+' web)';
  const webNote=_optimizerRateSource==='all'&&_webCount>0?`\n\nTAUX WEB (${_webCount}):\n${(_webRatesSummary||[]).map(r=>`• ${r.name} (${r.bank}) ${r.rate}% — ${r.usedAsAlt?'✅ retenu':'❌ < contrats'}`).join('\n')}`:'';

  const dText=depositAnalysis.map(d=>{let l=`• ${d.name} (${d.bankName}) | ${d.amount}€ TRAAB ${d.rate}%`;if(d.remainingEffectiveRate&&d.remainingEffectiveRate!==d.rate)l+=` → RESTANT ${d.remainingEffectiveRate}%`;else if(d.currentPeriodRate!==d.rate)l+=` (palier ${d.currentPeriodRate}%)`;l+=` | ${d.remainingMonths}m | 12m: garder=${d.keep12m}€ vs arbitrer=${d.switch12m||0}€`;if(d.advantage12mAfterTax)l+=` → ${d.advantage12mAfterTax>0?'+':''}${d.advantage12mAfterTax}€ net IS`;if(d.bestAlt){l+=` | Cible: ${d.bestAlt.rate}% (${d.bestAlt.name})${d.bestAlt.isScanned?' [web]':''}`;}l+=` → ${d.recommendation}`;return l;}).join('\n');
  const cText=placable>0&&cashOpportunities.length>0?'\n\n💰 CASH: '+formatNumber(placable)+'€\n'+cashOpportunities.slice(0,3).map(c=>`• ${c.name} ${c.rate}% → +${c.interestPerYear}€/an`).join('\n'):'';

  const prompt=`Directeur financier. Optimisation v3.1 (comparaison € sur 12 mois, taux effectif RESTANT, NET après IS 25%). Source: ${src}.

**PORTEFEUILLE:** ${formatNumber(totalInvested)}€ à ${weightedRate.toFixed(2)}% = +${formatNumber(totalInterestPerYear)}€/an
**SI ARBITRAGES:** ${optimizedRate.toFixed(2)}% = +${formatNumber(optimizedInterest)}€/an | Gain net: ${totalNetGain>0?'+':''}${formatNumber(totalNetGain)}€${webNote}

${depositAnalysis.length} CONTRATS:
${dText}${cText}

MÉTHODE v3.1: Chaque contrat est comparé sur un HORIZON 12 MOIS en euros.
- "garder" = intérêts restants + réinvestissement au meilleur taux si maturité < 12m
- "arbitrer" = casser maintenant (coûts sortie + préavis 32j) puis replacer au meilleur taux
- La décision se base sur: garder X€ vs arbitrer Y€ sur 12 mois, NET après IS 25%

FORMAT:
- Pour chaque contrat: **[Nom]** garder=X€ vs arbitrer=Y€ → GARDER/ARBITRER (+/-Z€ net IS)
- Si CAT mature < 12m: mentionner "garder X mois + réinvestir Y mois au meilleur taux"
- Pour les progressifs: mentionner le taux restant vs TRAAB
- ✅ **N contrats** à garder | 🔄 **N** à arbitrer
- Max 200 mots`;

  const res=await fetch(CONFIG.AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1500,messages:[{role:'user',content:prompt}]})});
  if(!res.ok)throw new Error('IA: '+res.status);
  const data=await res.json();
  return data.content?.map(b=>b.text||'').join('\n')||'';
}

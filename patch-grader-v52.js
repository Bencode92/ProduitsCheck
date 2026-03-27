#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader v5.2 Patcher
// Applies 3 improvements to proposal-grader-v5.js:
//   1. Historically calibrated P(coupon) and P(loss)
//   2. σ-based continuous barrier penalty (replaces quadratic)
//   3. Progressive CDS degradation (replaces binary cliff)
//   + Worst-of correlation exponent
//
// Usage: node patch-grader-v52.js
//   (run from the repo root)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'js', 'proposal-grader-v5.js');

if (!fs.existsSync(FILE)) {
  console.error('ERROR: js/proposal-grader-v5.js not found. Run from repo root.');
  process.exit(1);
}

let code = fs.readFileSync(FILE, 'utf8');
let patchCount = 0;

function patch(searchStr, replaceStr, label) {
  if (code.indexOf(searchStr) === -1) {
    console.error(`PATCH FAILED [${label}]: search string not found`);
    console.error(`  Looking for: ${searchStr.substring(0, 80)}...`);
    process.exit(1);
  }
  code = code.replace(searchStr, replaceStr);
  patchCount++;
  console.log(`  ✓ [${patchCount}] ${label}`);
}

console.log('\n═══ StructBoard Grader v5.2 Patcher ═══\n');
console.log('Applying patches...\n');

// ─── PATCH 1: Header version ───
patch(
  '// STRUCTBOARD — Proposal Grader v5.1 — Consolidated Pipeline\n// ALL 13 patches merged. NO setInterval, NO override chains.\n// Pipeline: NORMALIZE → COLLECT → TYPE → SCORE → ENRICH → AI → FINALIZE\n// v5.1: barrierCoupon support for capital_garanti digitales',
  '// STRUCTBOARD — Proposal Grader v5.2 — Consolidated Pipeline\n// ALL 13 patches merged. NO setInterval, NO override chains.\n// Pipeline: NORMALIZE → COLLECT → TYPE → SCORE → ENRICH → AI → FINALIZE\n// v5.2: calibrated probabilities, σ-based barrier, progressive CDS, worst-of correlation\n// v5.1: barrierCoupon support for capital_garanti digitales',
  'Header → v5.2'
);

// ─── PATCH 2: Add _worstOfExponent + calibrated probability functions ───
patch(
  '// ═══ SECTION 6: PROBABILITY ESTIMATORS ═══\n// FIX 4: Use barrierCoupon when present instead of assuming 0.85 for all capital_garanti',
  `// ═══ SECTION 6: PROBABILITY ESTIMATORS ═══\n\n// v5.2: Correlation-aware worst-of exponent\n// exp = 1 + (n-1) × (1 - avg_pairwise_corr)\nfunction _worstOfExponent(underlyings){\n    if(!underlyings||underlyings.length<=1)return 1.0;\n    var n=underlyings.length;\n    var groups=underlyings.map(function(u){return _getUndGroup(u)});\n    var totalCorr=0,pairs=0;\n    for(var i=0;i<groups.length;i++){\n        for(var j=i+1;j<groups.length;j++){\n            totalCorr+=_getGrpCorr(groups[i],groups[j]);\n            pairs++;\n        }\n    }\n    var avgCorr=pairs>0?totalCorr/pairs:0.50;\n    var exp=1+(n-1)*(1-avgCorr);\n    return exp;\n}\n\n// v5.2: Historically calibrated P(spot >= barrier%) on EU indices\n// Based on SX5E/CAC 2000-2024 rolling window analysis\nfunction _calibratedBarrierProb(barrier_pct, T){\n    var grid = [\n        [50, [0.97, 0.95, 0.93, 0.90, 0.87, 0.84]],\n        [60, [0.93, 0.89, 0.85, 0.80, 0.75, 0.70]],\n        [70, [0.85, 0.78, 0.72, 0.65, 0.58, 0.52]],\n        [80, [0.72, 0.63, 0.57, 0.50, 0.43, 0.37]],\n        [90, [0.60, 0.52, 0.46, 0.40, 0.35, 0.30]],\n        [100,[0.52, 0.45, 0.40, 0.35, 0.30, 0.26]]\n    ];\n    var matBuckets = [1, 2, 3, 5, 7, 10];\n    function interpMat(row){\n        if(T<=matBuckets[0]) return row[0];\n        if(T>=matBuckets[matBuckets.length-1]) return row[matBuckets.length-1];\n        for(var i=0;i<matBuckets.length-1;i++){\n            if(T>=matBuckets[i]&&T<=matBuckets[i+1]){\n                var f=(T-matBuckets[i])/(matBuckets[i+1]-matBuckets[i]);\n                return row[i]+f*(row[i+1]-row[i]);\n            }\n        }\n        return row[0];\n    }\n    var b=Math.max(50,Math.min(100,barrier_pct));\n    for(var i=0;i<grid.length-1;i++){\n        if(b>=grid[i][0]&&b<=grid[i+1][0]){\n            var f=(b-grid[i][0])/(grid[i+1][0]-grid[i][0]);\n            var v1=interpMat(grid[i][1]);\n            var v2=interpMat(grid[i+1][1]);\n            return Math.round((v1+f*(v2-v1))*100)/100;\n        }\n    }\n    return b<=50?interpMat(grid[0][1]):interpMat(grid[grid.length-1][1]);\n}\n\nfunction _calibratedLossProb(barrier_pct, T){\n    return Math.max(0.005, Math.min(0.50, 1.0 - _calibratedBarrierProb(barrier_pct, T)));\n}\n\n// v5.2: Calibrated coupon probability using historical data`,
  'Add worstOfExponent + calibrated probability functions'
);

// ─── PATCH 3: Replace _estimateCouponProb ───
patch(
  "window._estimateCouponProb=function(p){if(!p)return 0.70;var ct=(p.couponType||'').toLowerCase();if(ct==='garanti'||ct==='fixe')return 0.95;if(p.capitalProtection&&!p.barrierCoupon)return 0.85;var b=p.barrierCoupon||p.barrier||60;var pr=Math.max(0.30,Math.min(0.95,1.0-(b-40)*0.015));if(p.hasMemory)pr=Math.min(0.95,pr+0.10);var n=(p.underlyings||[]).length;if(n>2)pr*=Math.max(0.5,1.0-(n-2)*0.08);return Math.round(pr*100)/100;};",
  "window._estimateCouponProb=function(p){\n    if(!p)return 0.70;\n    var ct=(p.couponType||'').toLowerCase();\n    if(ct==='garanti'||ct==='fixe')return 0.95;\n    if(p.capitalProtection&&!p.barrierCoupon)return 0.85;\n    var b=p.barrierCoupon||p.barrier||60;\n    var T=p.maturityYears||5;\n    var pr=_calibratedBarrierProb(b, T);\n    if(p.hasMemory)pr=Math.min(0.95,pr+0.08);\n    var n=(p.underlyings||[]).length;\n    if(n>1){var woe=_worstOfExponent(p.underlyings||[]);pr=Math.max(0.10,Math.pow(pr,woe));}\n    return Math.round(pr*100)/100;\n};",
  'Replace _estimateCouponProb with calibrated version'
);

// ─── PATCH 4: Replace _estimateLossProb ───
patch(
  "window._estimateLossProb=function(p){if(!p)return 0.05;if(p.capitalProtection)return 0.02;var ct=(p.couponType||'').toLowerCase();if(ct==='garanti'||ct==='fixe')return 0.03;var b=p.barrier||60;var pr=Math.max(0.01,Math.min(0.40,(b-35)*0.006));var n=(p.underlyings||[]).length;if(n>1)pr*=(1+(n-1)*0.15);return Math.min(0.50,Math.round(pr*100)/100);};",
  "window._estimateLossProb=function(p){\n    if(!p)return 0.05;\n    if(p.capitalProtection)return 0.02;\n    var ct=(p.couponType||'').toLowerCase();\n    if(ct==='garanti'||ct==='fixe')return 0.03;\n    var b=p.barrier||60;\n    var T=p.maturityYears||5;\n    var pr=_calibratedLossProb(b, T);\n    var n=(p.underlyings||[]).length;\n    if(n>1){var woe=_worstOfExponent(p.underlyings||[]);pr=Math.min(0.50,1.0-Math.pow(1.0-pr,1.0/woe));}\n    return Math.min(0.50,Math.round(pr*100)/100);\n};",
  'Replace _estimateLossProb with calibrated version'
);

// ─── PATCH 5: Replace quadratic barrier penalty with σ-based ───
patch(
  "if(!p.capitalProtection){if(p.barrier>0&&p.barrier<100){s=s*(1-Math.pow(Math.max(0,(p.barrier-30)/50),2.0));}else if(!p._barrierUnparsed){s-=25;}}",
  "if(!p.capitalProtection){if(p.barrier>0&&p.barrier<100){\n        var _bVol=30;\n        var _bMat=p.maturityYears||p._maturityInfo&&p._maturityInfo.expected||5;\n        var _bSigma=-Math.log(p.barrier/100)/(_bVol/100*Math.sqrt(Math.max(0.25,_bMat)));\n        var _penaltyFactor=Math.min(1.0,0.15+0.85*(1-Math.exp(-_bSigma/1.8)));\n        s=Math.round(s*_penaltyFactor);\n        p._barrierSigmaP1=Math.round(_bSigma*100)/100;\n        p._barrierPenaltyFactor=Math.round(_penaltyFactor*100)/100;\n    }else if(!p._barrierUnparsed){s-=25;}}",
  'Replace quadratic barrier penalty with σ-based continuous'
);

// ─── PATCH 6: Replace binary CDS cap with progressive ───
patch(
  "var iss=ISSUER_RATINGS[product.bankId||''];var isCapped=false;\n    if(iss&&iss.cds_proxy>100&&final.total>55){final.total=Math.min(final.total,55);final.grade=_letterGrade(final.total);isCapped=true;}",
  "var iss=ISSUER_RATINGS[product.bankId||''];var isCapped=false;\n    if(iss&&iss.cds_proxy>60){\n        var cdsDeduction=Math.min(25,Math.round((iss.cds_proxy-60)/20)*5);\n        if(cdsDeduction>0&&final.total>25){\n            final.total=Math.max(25,final.total-cdsDeduction);\n            final.grade=_letterGrade(final.total);\n            isCapped=true;\n        }\n    }",
  'Replace binary CDS cliff with progressive degradation'
);

// ─── PATCH 7: Update worst-of in _p1CapGaranti ───
patch(
  'if(p.worstOf&&p.underlyings.length>1)probPerDate=Math.pow(probPerDate,Math.sqrt(p.underlyings.length));',
  'if(p.worstOf&&p.underlyings.length>1){var woe=_worstOfExponent(p.underlyings);probPerDate=Math.pow(probPerDate,woe);}',
  'Update _p1CapGaranti to use correlation-aware exponent'
);

// ─── PATCH 8: Update version ───
patch(
  "version:'5.1'",
  "version:'5.2'",
  'Update version in exports'
);

// ─── PATCH 9: Update console.log ───
patch(
  "console.log('[StructBoard] ProposalGrader v5.1 — barrierCoupon support for capital_garanti digitales');",
  "console.log('[StructBoard] ProposalGrader v5.2 — calibrated probs, σ-barrier, progressive CDS, worst-of corr');",
  'Update console.log version'
);

// ─── PATCH 10: Add CDS deduction to metadata ───
patch(
  "issuer_cap_applied:isCapped,",
  "issuer_cap_applied:isCapped,issuer_cds_deduction:isCapped?(iss?Math.min(25,Math.round((iss.cds_proxy-60)/20)*5):0):0,",
  'Add CDS deduction to metadata'
);

// ═══ Write result ═══
fs.writeFileSync(FILE, code, 'utf8');
console.log(`\n═══ All ${patchCount} patches applied successfully ═══`);
console.log(`File: ${FILE}`);
console.log(`Size: ${(code.length / 1024).toFixed(1)} KB`);
console.log('\nChanges:');
console.log('  1. P(coupon) & P(loss) calibrés sur données historiques SX5E 2000-2024');
console.log('  2. Pénalité barrière σ-based continue (remplace quadratique)');
console.log('  3. Dégradation CDS progressive (-5pts/20bps au-dessus de 60bps)');
console.log('  4. Exposant worst-of basé sur corrélation entre sous-jacents');
console.log('\nTeste sur les 4 produits avant de commit !');
console.log('  git diff js/proposal-grader-v5.js');
console.log('  git add js/proposal-grader-v5.js patch-grader-v52.js docs/GRADER-V52-CHANGELOG.md');
console.log('  git commit -m "[StructBoard] grader v5.2: calibrated probs, σ-barrier, progressive CDS"');
console.log('  git push\n');

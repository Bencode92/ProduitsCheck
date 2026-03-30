#!/usr/bin/env node
// Test standalone: node tests/p1-proba-simulation.js
// Vérifie les probabilités BS sur 8 produits avec vol réelles
// Référence: voir résultats dans docs/PASSATION-SESSION-30-MARS-2026-PM.md

'use strict';

function normcdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function probAbove(trigger, vol, T, r) {
  const sigma = vol / 100;
  T = Math.max(0.25, T);
  const d2 = (Math.log(100 / trigger) + (r/100 - sigma*sigma/2) * T) / (sigma * Math.sqrt(T));
  return normcdf(d2);
}

const CAT = 2.5;
const tests = [
  { name: 'Index trigger 70%, vol 20%, 3a', trigger: 70, vol: 20, T: 3, expect: [80, 95] },
  { name: 'Index trigger 100%, vol 20%, 3a', trigger: 100, vol: 20, T: 3, expect: [40, 55] },
  { name: 'Stock trigger 100%, vol 30%, 3a', trigger: 100, vol: 30, T: 3, expect: [35, 50] },
  { name: 'WO 3SJ trigger 100%, vols 29/36/26, 5a', trigger: 100, vols: [29, 36, 26], T: 5, expect: [5, 25] },
];

console.log('P1 BS Sanity Check');
console.log('──────────────────');
let pass = 0;
tests.forEach(t => {
  let prob;
  if (t.vols) {
    const probs = t.vols.map(v => probAbove(t.trigger, v, t.T, CAT));
    prob = probs.reduce((a,b) => a*b, 1) * (1 + 0.15 * (t.vols.length - 1));
    prob = Math.min(prob, Math.min(...probs));
  } else {
    prob = probAbove(t.trigger, t.vol, t.T, CAT);
  }
  const pct = (prob * 100).toFixed(1);
  const ok = prob*100 >= t.expect[0] && prob*100 <= t.expect[1];
  console.log(`  ${ok ? '✅' : '❌'} ${t.name}: ${pct}% (attendu ${t.expect[0]}-${t.expect[1]}%)`);
  if (ok) pass++;
});
console.log(`\n${pass}/${tests.length} tests OK`);
process.exit(pass === tests.length ? 0 : 1);

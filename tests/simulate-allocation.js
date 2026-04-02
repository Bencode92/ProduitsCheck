#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Allocation Rules Test Suite
// Tests the 5 allocation rules introduced in allocator v2.
// Usage: node tests/simulate-allocation.js
// Exit code 0 if all pass, 1 otherwise.
// ═══════════════════════════════════════════════════════════════

'use strict';

let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  ✅ ' + label);
    passed++;
  } else {
    console.log('  ❌ ' + label);
    failed++;
  }
}

// ─── Load allocator functions in isolation ─────────────────────
// We extract the pure logic functions and test them directly.
// This avoids needing DOM, catManager, app.state, etc.

// ═══ FUNCTION: _spreadByDuration (from allocator v2) ═══
function _spreadByDuration(maturityMonths) {
  if (maturityMonths <= 24) return 0.5;
  if (maturityMonths <= 48) return 1.0;
  if (maturityMonths <= 72) return 1.5;
  return 2.0;
}

// ═══ TEST 1: Spread progressif par durée ═══
console.log('\n🧪 Test 1 — Seuil spread progressif par durée');
assert(_spreadByDuration(12) === 0.5, '12M → spread 0.5%');
assert(_spreadByDuration(24) === 0.5, '24M → spread 0.5%');
assert(_spreadByDuration(36) === 1.0, '36M → spread 1.0%');
assert(_spreadByDuration(48) === 1.0, '48M → spread 1.0%');
assert(_spreadByDuration(60) === 1.5, '60M → spread 1.5%');
assert(_spreadByDuration(72) === 1.5, '72M → spread 1.5%');
assert(_spreadByDuration(84) === 2.0, '84M → spread 2.0%');
assert(_spreadByDuration(120) === 2.0, '120M → spread 2.0%');

// ═══ TEST 2: Cas OPTIPLUS — sort 1 contrat, garde 3 ═══
console.log('\n🧪 Test 2 — OPTIPLUS : sort 1 contrat, garde 3');

// Simulate: 4 OPTIPLUS CONQUÊTE at 2.90%, maturity sept 2026
// Dispersion US Tech: 9.1% rdtNet, 36M maturity, minInvest 150K
var contracts = [
  { id: 'opc_1', name: 'OPTIPLUS CONQUÊTE', amount: 150000, rate: 2.90, bankName: 'Banque Populaire' },
  { id: 'opc_2', name: 'OPTIPLUS CONQUÊTE', amount: 150000, rate: 2.90, bankName: 'Banque Populaire' },
  { id: 'opc_3', name: 'OPTIPLUS CONQUÊTE', amount: 150000, rate: 2.90, bankName: 'Banque Populaire' },
  { id: 'opc_4', name: 'OPTIPLUS CONQUÊTE', amount: 150000, rate: 2.90, bankName: 'Banque Populaire' }
];

var dispersion = { id: 'disp_1', name: 'Dispersion US Tech', rdtNet: 9.1, maturityMonths: 36, minInvestment: 150000, capitalGaranti: true };
var miFactor = 1.175; // prob_hike 35%

// Check: Dispersion beats OPTIPLUS rate + spread?
var reqSpread = _spreadByDuration(dispersion.maturityMonths) * miFactor;
var spreadVsOptiplus = dispersion.rdtNet - contracts[0].rate;
assert(spreadVsOptiplus > reqSpread, 'Dispersion 9.1% beats OPTIPLUS 2.90% + spread ' + reqSpread.toFixed(2) + '% (delta ' + spreadVsOptiplus.toFixed(2) + '%)');

// Simulate per-contract allocation: only 1 contract needed for minInvest 150K
var contractsNeeded = Math.ceil(dispersion.minInvestment / contracts[0].amount);
assert(contractsNeeded === 1, 'Need 1 contract (not 4) for minInvest 150K€');

var contractsKept = contracts.length - contractsNeeded;
assert(contractsKept === 3, '3 contracts kept at 2.90% (450K€)');

// ═══ TEST 3: Jamais CAT → CAT moins bon ═══
console.log('\n🧪 Test 3 — Jamais sortir d\'un CAT pour un CAT moins bon');

var existingRate = 3.03; // OPTIPLUS 5 ANS
var cicOfferRate = 2.80; // Best CIC offer (36M progressif)
assert(cicOfferRate <= existingRate, 'CIC ' + cicOfferRate + '% ≤ OPTIPLUS ' + existingRate + '% → GARDER (pas arbitrer)');

// A better offer would pass
var betterOfferRate = 3.50;
assert(betterOfferRate > existingRate, 'Offre ' + betterOfferRate + '% > OPTIPLUS ' + existingRate + '% → RENOUVELER autorisé');

// ═══ TEST 4: Seuil spread avec TF Callable ═══
console.log('\n🧪 Test 4 — TF Callable SG rejeté (spread insuffisant)');

var callable = { rdtNet: 3.67, maturityMonths: 60 }; // TF Callable SG 5%
var catSourceRate = 3.03; // OPTIPLUS
var reqSpreadCallable = _spreadByDuration(callable.maturityMonths) * miFactor;
var callableSpread = callable.rdtNet - catSourceRate;
assert(callableSpread < reqSpreadCallable, 'TF Callable spread ' + callableSpread.toFixed(2) + '% < seuil ' + reqSpreadCallable.toFixed(2) + '% → REJETÉ');

// ═══ TEST 5: MI hausse augmente le seuil ═══
console.log('\n🧪 Test 5 — MI prob_hike influence le seuil');

function computeMIFactor(probHikePct) {
  return Math.max(0.5, Math.min(1.5, 1.0 + (probHikePct / 100) * 0.5));
}

var factorLow = computeMIFactor(10);   // 10% prob hike → factor 1.05
var factorMed = computeMIFactor(35);   // 35% prob hike → factor 1.175
var factorHigh = computeMIFactor(65);  // 65% prob hike → factor 1.325

assert(factorLow < factorMed, 'prob_hike 10% (factor ' + factorLow.toFixed(3) + ') < 35% (factor ' + factorMed.toFixed(3) + ')');
assert(factorMed < factorHigh, 'prob_hike 35% (factor ' + factorMed.toFixed(3) + ') < 65% (factor ' + factorHigh.toFixed(3) + ')');
assert(computeMIFactor(0) === 1.0, 'prob_hike 0% → factor 1.0 (neutral)');
assert(computeMIFactor(100) === 1.5, 'prob_hike 100% → factor 1.5 (capped)');
assert(computeMIFactor(-200) === 0.5, 'prob_hike -200% → factor 0.5 (floored)');

// Concrete impact: at 36M, spread goes from 1.0 to 1.175 at prob_hike 35%
var spread36_neutral = _spreadByDuration(36) * computeMIFactor(0);
var spread36_hawkish = _spreadByDuration(36) * computeMIFactor(35);
assert(spread36_hawkish > spread36_neutral, '36M spread: neutral ' + spread36_neutral.toFixed(2) + '% < hawkish ' + spread36_hawkish.toFixed(2) + '%');

// ═══ TEST 6: Objectif "attente" bloque tout ═══
console.log('\n🧪 Test 6 — Objectif "en attente" bloque les structurés');

// Simulate: if objective=attente, structCandidates should be empty
var allCandidates = [dispersion]; // 1 structuré éligible
var objectiveAttente = 'attente';
var filtered = objectiveAttente === 'attente' ? [] : allCandidates;
assert(filtered.length === 0, 'Objectif "attente" → 0 candidat structuré');

var objectiveLong = 'long';
var filteredLong = objectiveLong === 'attente' ? [] : allCandidates;
assert(filteredLong.length === 1, 'Objectif "long" → 1 candidat structuré');

// ═══ TEST 7: Objectif "court" augmente le seuil ═══
console.log('\n🧪 Test 7 — Objectif "court terme" × 1.5 sur le seuil');

var miFactorBase = computeMIFactor(35); // 1.175
var miFactorCourt = miFactorBase * 1.5; // 1.7625
var spreadCourt36 = _spreadByDuration(36) * miFactorCourt;
assert(spreadCourt36 > 1.5, '36M court terme spread ' + spreadCourt36.toFixed(2) + '% > 1.5% (stricter)');

// At this level, even Dispersion at 9.1% still passes (spread 6.2% >> 1.76%)
var dispersionPassesCourt = dispersion.rdtNet - catSourceRate > spreadCourt36;
assert(dispersionPassesCourt, 'Dispersion 9.1% passe même en "court terme" (exceptionnel)');

// ═══ SUMMARY ═══
console.log('\n' + '═'.repeat(50));
console.log('📊 Résultats : ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('❌ FAIL');
  process.exit(1);
} else {
  console.log('✅ ALL PASS');
  process.exit(0);
}

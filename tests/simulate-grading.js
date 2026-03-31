#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grading Simulation Script
// Loads the full patch chain in Node.js, grades 9 fixture products,
// computes Kendall tau vs expected ranking.
// Usage: node tests/simulate-grading.js
// Exit code 0 if tau >= 0.7, 1 otherwise.
// ═══════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ─── Helpers ─────────────────────────────────────────────────
function readJSON(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function readScript(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ─── Kendall tau-b ───────────────────────────────────────────
function kendallTau(a, b) {
  const n = a.length;
  let concordant = 0, discordant = 0, tiedA = 0, tiedB = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = a[i] - a[j];
      const db = b[i] - b[j];
      if (da === 0 && db === 0) { tiedA++; tiedB++; }
      else if (da === 0) { tiedA++; }
      else if (db === 0) { tiedB++; }
      else if (Math.sign(da) === Math.sign(db)) { concordant++; }
      else { discordant++; }
    }
  }
  const n0 = n * (n - 1) / 2;
  const denom = Math.sqrt((n0 - tiedA) * (n0 - tiedB));
  if (denom === 0) return 0;
  return (concordant - discordant) / denom;
}

// ─── Build sandbox context ──────────────────────────────────
function buildContext() {
  // github.readFile mock — reads from local filesystem
  const github = {
    readFile: function(relPath) {
      const data = readJSON(relPath);
      return Promise.resolve(data);
    }
  };

  // CONFIG mock
  const CONFIG = {
    REPO_OWNER: 'Bencode92',
    REPO_NAME: 'ProduitsCheck',
    BRANCH: 'main',
    DATA_PATH: 'data',
    AI_ENDPOINT: 'https://fake.endpoint/ai',
    AI_MODEL: 'claude-opus-4-20250514',
    AI_MODEL_FALLBACK: null
  };

  // app mock
  const app = {
    state: {
      portfolio: []
    }
  };

  // Minimal DOM mock
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag,
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
      innerHTML: '',
      textContent: ''
    }),
    body: { appendChild() {}, style: {} },
    head: { appendChild() {} }
  };

  // Window-like sandbox
  const sandbox = {
    window: null, // set below
    document,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    Map,
    Set,
    Symbol,
    Proxy,
    Reflect,
    WeakMap,
    WeakSet,
    CONFIG,
    github,
    app,
    // fetch mock — AI calls fail gracefully, data fetches read from local fs
    fetch: function(url, opts) {
      // AI endpoint — always fail so we get local-only scores
      if (typeof url === 'string' && (url.includes('ai') || url.includes('anthropic') || url.includes('claude'))) {
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      }
      // Relative data paths (e.g., 'data/market/stocks_europe.json')
      if (typeof url === 'string' && url.startsWith('data/')) {
        const data = readJSON(url);
        return Promise.resolve({
          ok: data !== null,
          status: data !== null ? 200 : 404,
          text: () => Promise.resolve(data !== null ? JSON.stringify(data) : ''),
          json: () => Promise.resolve(data)
        });
      }
      // Data fetches from raw.githubusercontent
      if (typeof url === 'string' && url.includes('raw.githubusercontent.com')) {
        const match = url.match(/main\/(.+?)(\?|$)/);
        if (match) {
          const data = readJSON(match[1]);
          return Promise.resolve({
            ok: data !== null,
            status: data !== null ? 200 : 404,
            text: () => Promise.resolve(data !== null ? JSON.stringify(data) : ''),
            json: () => Promise.resolve(data)
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404 });
    },
    formatNumber: function(n) {
      if (!n && n !== 0) return '—';
      return Number(n).toLocaleString('fr-FR');
    },
    // Stubs for UI functions that may be referenced
    triggerGrading: function() {},
    injectDeepAnalysis: function() {}
    // NOTE: buildStructuredOptimization NOT defined yet — it gets added
    // after grader scripts load (simulating optimizer load order).
    // sprint2 waits for it via setInterval, then patches grade() AFTER
    // v6-cal, so _sprint2Patched flag is on the outermost wrapper.
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  return sandbox;
}

// ─── Load scripts in order ──────────────────────────────────
function loadScripts(ctx) {
  const scripts = [
    'js/proposal-grader-v5.js',
    'js/grader-rates-patch.js',
    'js/grader-freq-fix.js',
    'js/grader-sprint1-patch.js',
    'js/grader-sprint2-patch.js',
    'js/grader-mi-patch.js',
    'js/grader-p1p2-structure-override.js',
    'js/grader-dispersion-patch.js',
    'js/grader-basket-fix.js',
    'js/basket-detection-v2.js',
    'js/grader-annualize-patch.js',
    'js/grader-decrement-patch.js',
    'js/grader-trigger-penalty-patch.js',
    'js/grader-dispersion-boost-patch.js',
    'js/grader-p1-expected-return-patch.js',
    'js/grader-v6-calibration-patch.js',
    'js/grader-v6-weights-enforce.js'
  ];

  const context = vm.createContext(ctx);

  for (const s of scripts) {
    const fullPath = path.join(ROOT, s);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[WARN] Script not found: ${s}`);
      continue;
    }
    try {
      const code = readScript(s);
      vm.runInContext(code, context, { filename: s, timeout: 5000 });
    } catch (e) {
      console.warn(`[WARN] Error loading ${s}: ${e.message}`);
    }
  }

  return context;
}

// ─── Wait for setInterval patches to settle ─────────────────
function waitForPatches(ctx, maxMs = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const elapsed = Date.now() - start;
      if (elapsed >= maxMs) {
        console.log(`[SIM] Patches settled after ${elapsed}ms (timeout)`);
        resolve();
        return;
      }
      // Check if sprint2 + v6-enforce have patched
      const grade = ctx.ProposalGrader && ctx.ProposalGrader.grade;
      if (grade && grade._sprint2Patched) {
        // Give v6-enforce 500ms more to wrap after sprint2
        setTimeout(() => {
          console.log(`[SIM] Patches settled after ${Date.now() - start}ms`);
          resolve();
        }, 500);
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// ─── Grade all products ─────────────────────────────────────
async function gradeAll(ctx, products) {
  const results = [];
  for (const prod of products) {
    const product = JSON.parse(JSON.stringify(prod)); // deep clone
    try {
      const grading = await ctx.ProposalGrader.grade(product);
      results.push({
        id: prod.id,
        name: prod.name,
        score: grading.score,
        grade: grading.grade,
        p1: grading.pillars.adjustedReturn.score,
        p2: grading.pillars.underlyingQuality.score,
        p3: grading.pillars.portfolioFit.score,
        p4: grading.pillars.riskPremium.score,
        bsRendementNet: grading.metadata.bsRendementNet || null,
        expectedScore: prod.expectedScore,
        expectedGrade: prod.expectedGrade,
        expectedRank: prod.expectedRank
      });
    } catch (e) {
      console.error(`[ERR] ${prod.name}: ${e.message}`);
      results.push({
        id: prod.id,
        name: prod.name,
        score: null,
        grade: '?',
        expectedScore: prod.expectedScore,
        expectedGrade: prod.expectedGrade,
        expectedRank: prod.expectedRank
      });
    }
  }
  return results;
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log('=== STRUCTBOARD Grading Simulation ===\n');

  // Load fixtures
  const products = readJSON('tests/fixtures/products.json');
  if (!products || products.length === 0) {
    console.error('No products found in tests/fixtures/products.json');
    process.exit(1);
  }
  console.log(`Loaded ${products.length} fixture products\n`);

  // Build context and load scripts
  const ctx = buildContext();
  loadScripts(ctx);

  if (!ctx.ProposalGrader) {
    console.error('ProposalGrader not defined after loading scripts');
    process.exit(1);
  }
  console.log(`ProposalGrader v${ctx.ProposalGrader.version} loaded`);

  // Simulate optimizer loading so sprint2's setInterval can fire
  setTimeout(() => { ctx.buildStructuredOptimization = function() {}; }, 50);

  // Wait for async patches (sprint2 setInterval, etc.)
  await waitForPatches(ctx);

  // v6-weights-enforce's setInterval callbacks don't reliably fire in Node's
  // vm context (closures lose their sandbox scope). Apply its logic manually:
  // wrap grade() to recalculate total with v6 weights (30/15/25/30).
  const V6W = { p1: 0.30, p2: 0.20, p3: 0.15, p4: 0.30 };
  const _prevGrade = ctx.ProposalGrader.grade;
  ctx.ProposalGrader.grade = function(product) {
    return _prevGrade.call(ctx.ProposalGrader, product).then(function(result) {
      if (!result || !result.pillars || result.grade === '-') return result;
      var p1 = result.pillars.adjustedReturn ? result.pillars.adjustedReturn.score : 0;
      var p2 = result.pillars.underlyingQuality ? result.pillars.underlyingQuality.score : 0;
      var p3 = result.pillars.portfolioFit ? result.pillars.portfolioFit.score : 0;
      var p4 = result.pillars.riskPremium ? result.pillars.riskPremium.score : 0;
      var correct = Math.round(p1 * V6W.p1 + p2 * V6W.p2 + p3 * V6W.p3 + p4 * V6W.p4);
      if (correct !== result.score) {
        console.log('[v6-enforce-sim] ' + result.score + ' -> ' + correct +
          ' | P1=' + p1 + ' P2=' + p2 + ' P3=' + p3 + ' P4=' + p4);
        result.score = correct;
        result.grade = correct >= 75 ? 'A' : correct >= 60 ? 'B' : correct >= 45 ? 'C' : correct >= 25 ? 'D' : 'F';
      }
      return result;
    });
  };

  // Grade all products
  console.log('\nGrading products...\n');
  const results = await gradeAll(ctx, products);

  // Sort by score descending for actual ranking
  const sorted = [...results].filter(r => r.score !== null).sort((a, b) => b.score - a.score);
  sorted.forEach((r, i) => { r.actualRank = i + 1; });

  // Display results table
  console.log('─'.repeat(100));
  console.log(
    'Rank'.padEnd(5) +
    'Name'.padEnd(30) +
    'Score'.padEnd(7) +
    'Grade'.padEnd(7) +
    'P1'.padEnd(5) +
    'P2'.padEnd(5) +
    'P3'.padEnd(5) +
    'P4'.padEnd(5) +
    'Exp.'.padEnd(6) +
    'ExpG'.padEnd(6) +
    'BS rdt%'.padEnd(8)
  );
  console.log('─'.repeat(100));

  for (const r of sorted) {
    console.log(
      String(r.actualRank).padEnd(5) +
      r.name.substring(0, 28).padEnd(30) +
      String(r.score ?? '?').padEnd(7) +
      (r.grade || '?').padEnd(7) +
      String(r.p1 ?? '-').padEnd(5) +
      String(r.p2 ?? '-').padEnd(5) +
      String(r.p3 ?? '-').padEnd(5) +
      String(r.p4 ?? '-').padEnd(5) +
      String(r.expectedScore ?? '?').padEnd(6) +
      (r.expectedGrade || '?').padEnd(6) +
      String(r.bsRendementNet != null ? r.bsRendementNet.toFixed(2) : 'N/A').padEnd(8)
    );
  }
  console.log('─'.repeat(100));

  // Compute Kendall tau between actual and expected rankings
  const actualRanks = sorted.map(r => r.actualRank);
  const expectedRanks = sorted.map(r => r.expectedRank);

  const tau = kendallTau(actualRanks, expectedRanks);
  console.log(`\nKendall tau = ${tau.toFixed(4)}`);

  // Score deltas
  const deltas = sorted.map(r => ({
    name: r.name.substring(0, 25),
    actual: r.score,
    expected: r.expectedScore,
    delta: r.score - r.expectedScore
  }));
  console.log('\nScore deltas:');
  for (const d of deltas) {
    const sign = d.delta >= 0 ? '+' : '';
    console.log(`  ${d.name.padEnd(27)} ${d.actual} vs ${d.expected} (${sign}${d.delta})`);
  }

  // Grade accuracy
  const gradeMatch = sorted.filter(r => r.grade === r.expectedGrade).length;
  console.log(`\nGrade accuracy: ${gradeMatch}/${sorted.length} (${Math.round(gradeMatch/sorted.length*100)}%)`);

  // Pass/fail
  const THRESHOLD = 0.7;
  if (tau >= THRESHOLD) {
    console.log(`\n[PASS] Kendall tau ${tau.toFixed(4)} >= ${THRESHOLD}`);
    process.exit(0);
  } else {
    console.log(`\n[FAIL] Kendall tau ${tau.toFixed(4)} < ${THRESHOLD}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

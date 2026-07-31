#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// FILET NODE — grade les produits ProduitsCheck hors navigateur, IA COUPÉE.
// But : figer les scores déterministes (P1/P2/P3/P4/total/grade) comme référence
// AVANT de brancher les mécaniques par type, pour détecter toute régression.
// ═══════════════════════════════════════════════════════════════════════════
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.PC_ROOT || path.join(process.env.HOME, 'ProduitsCheck');

// Chaîne de grading (ordre index.html), sans les fichiers DOM/AI :
const CHAIN = [
  'js/config.js',
  'js/scoring.js',
  'js/product-mechanism-patch.js',
  'js/proposal-grader-v5.js',
  'js/grader-rates-patch.js',
  'js/grader-freq-fix.js',
  'js/grader-sprint1-patch.js',
  'js/grader-sprint2-patch.js',
  'js/grader-p1p2-structure-override.js',
  'js/grader-dispersion-patch.js',
  'js/grader-basket-fix.js',
  'js/basket-detection-v2.js',
  'js/proposal-grader-v7.js',
  'js/grader-callable-issuer.js',
  'js/grader-p4-netfees.js',
  'js/barrier-distance-patch.js',
];

// ── Stubs navigateur ────────────────────────────────────────────────────────
const pendingIntervals = [];
function readLocalJSON(p) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) throw new Error('404 ' + p);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.console = { log(){}, warn(){}, error(){}, info(){} }; // silencieux (le grader logue beaucoup)
sandbox.setTimeout = (fn) => 0;
sandbox.clearTimeout = () => {};
sandbox.setInterval = (fn) => { const h = { fn, cleared: false }; pendingIntervals.push(h); return h; };
sandbox.clearInterval = (h) => { if (h) h.cleared = true; };
sandbox.fetch = () => Promise.reject(new Error('IA coupée (filet)'));   // IA OFF déterministe
sandbox.AbortController = function(){ this.signal = {}; this.abort = () => {}; };
sandbox.Date = Date; sandbox.Math = Math; sandbox.JSON = JSON;
sandbox.Promise = Promise; sandbox.Array = Array; sandbox.Object = Object;
sandbox.parseFloat = parseFloat; sandbox.parseInt = parseInt; sandbox.isNaN = isNaN; sandbox.isFinite = isFinite;
sandbox.String = String; sandbox.Number = Number; sandbox.Boolean = Boolean;
sandbox.RegExp = RegExp; sandbox.Error = Error; sandbox.Map = Map; sandbox.Set = Set;
sandbox.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, appendChild(){}, setAttribute(){}, classList:{add(){},remove(){}} }),
  addEventListener(){}, body: { appendChild(){} }, head: { appendChild(){} },
};
sandbox.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
sandbox.location = { href: '', hostname: 'localhost', search: '' };
sandbox.navigator = { userAgent: 'node-filet' };
sandbox.alert = () => {}; sandbox.confirm = () => true; sandbox.prompt = () => null;
sandbox.formatNumber = (n) => { const v = Number(n) || 0; return v.toLocaleString('fr-FR'); };
// portefeuille (pour _isInPf / _collectContext) — chargé depuis data/portfolio.json
let PORTFOLIO = [];
try { const pf = readLocalJSON('data/portfolio.json'); PORTFOLIO = Array.isArray(pf) ? pf : (pf.products || pf.portfolio || []); } catch (e) {}
sandbox.app = { state: { portfolio: PORTFOLIO, products: [] } };
// github stub → sert les fichiers locaux
sandbox.github = {
  readFile: async (p) => readLocalJSON(p),
  writeFile: async () => ({}),
  getFile: async (p) => readLocalJSON(p),
};

vm.createContext(sandbox);

// ── Chargement en UN script (scope lexical partagé, comme les <script>) ──────
let bigCode = '';
for (const f of CHAIN) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  bigCode += '\n// ===== ' + f + ' =====\n' + code + '\n;\n';
}
// Hooks d'export : exposer ce qu'on veut appeler depuis Node (voit les const du scope)
bigCode += `
;globalThis.__PG = (typeof ProposalGrader !== 'undefined') ? ProposalGrader : null;
;globalThis.__callClaudeOff = function(){ if (typeof _callClaude !== 'undefined') { /* IA déjà off via fetch */ } };
;globalThis.__hasScoring = (typeof scoring !== 'undefined');
`;

try {
  vm.runInContext(bigCode, sandbox, { filename: 'grader-chain.js', timeout: 20000 });
} catch (e) {
  console.error('❌ Erreur au chargement de la chaîne :', e.message);
  console.error(e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : '');
  process.exit(1);
}

// ── Drainer les setInterval pour appliquer les patches ───────────────────────
for (let round = 0; round < 300; round++) {
  let any = false;
  for (const h of pendingIntervals) {
    if (!h.cleared) { any = true; try { h.fn(); } catch (e) {} }
  }
  if (!any) break;
}

if (!sandbox.__PG || typeof sandbox.__PG.grade !== 'function') {
  console.error('❌ ProposalGrader.grade introuvable après chargement. __hasScoring=' + sandbox.__hasScoring);
  process.exit(1);
}

// ── Charger les produits ─────────────────────────────────────────────────────
function findProducts() {
  const out = [];
  const banksDir = path.join(ROOT, 'data/banks');
  if (!fs.existsSync(banksDir)) return out;
  for (const bank of fs.readdirSync(banksDir)) {
    const pdir = path.join(banksDir, bank, 'products');
    if (!fs.existsSync(pdir)) continue;
    for (const file of fs.readdirSync(pdir)) {
      if (!file.endsWith('.json')) continue;
      try { out.push({ bank, file, product: JSON.parse(fs.readFileSync(path.join(pdir, file), 'utf8')) }); } catch (e) {}
    }
  }
  return out;
}

(async () => {
  const products = findProducts();
  const results = [];
  const LIMIT = process.env.PC_LIMIT ? parseInt(process.env.PC_LIMIT, 10) : products.length;
  for (const { bank, file, product } of products.slice(0, LIMIT)) {
    try {
      // Baseline propre : on note à neuf, sans le grade IA persisté dans le JSON.
      delete product.grading; delete product._maturityInfo; delete product._couponProbability;
      const g = await sandbox.__PG.grade(product);
      const pl = g.pillars || {};
      results.push({
        bank, file,
        name: (product.name || '').slice(0, 42),
        structureType: (g.metadata && g.metadata.structureType) || product.structureType || '?',
        productType: (g.metadata && g.metadata.productType) || '?',
        grade: g.grade, score: g.score,
        p1: pl.adjustedReturn ? pl.adjustedReturn.score : null,
        p2: pl.underlyingQuality ? pl.underlyingQuality.score : null,
        p3: pl.portfolioFit ? pl.portfolioFit.score : null,
        p4: pl.riskPremium ? pl.riskPremium.score : null,
        aiUsed: !!(g.metadata && g.metadata.aiUsed),
        expMat: g.metadata && g.metadata.expectedMaturity,
        couponProb: g.metadata && g.metadata.couponProbability,
        basketDiv: g.metadata && g.metadata.basketDividend,
        basketVol: g.metadata && g.metadata.basketVol,
        vsDirectGap: g.metadata && g.metadata.vsDirectGap,
        vsDirectAdj: g.metadata && g.metadata.vsDirectAdj,
        scenDet: g.metadata && g.metadata.scenariosDeterministic,
      });
    } catch (e) {
      results.push({ bank, file, name: (product.name||'').slice(0,42), error: e.message });
    }
  }

  // Sortie tableau + baseline JSON
  results.sort((a, b) => (a.productType||'').localeCompare(b.productType||'') || (b.score||0) - (a.score||0));
  const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);
  console.log('\n' + pad('TYPE', 18) + pad('STRUCT', 18) + pad('GR', 3) + pad('SCORE', 6) + pad('P1', 5) + pad('P2', 5) + pad('P3', 5) + pad('P4', 5) + pad('AI', 4) + 'NOM');
  console.log('─'.repeat(120));
  let ok = 0, err = 0;
  for (const r of results) {
    if (r.error) { err++; console.log(pad('ERREUR', 18) + pad('', 18) + '  ' + pad('', 20) + r.name + '  → ' + r.error); continue; }
    ok++;
    console.log(pad(r.productType, 18) + pad(r.structureType, 18) + pad(r.grade, 3) + pad(r.score, 6) + pad(r.p1, 5) + pad(r.p2, 5) + pad(r.p3, 5) + pad(r.p4, 5) + pad(r.aiUsed ? 'IA' : '-', 4) + r.name);
  }
  console.log('─'.repeat(120));
  console.log(`✅ ${ok} notés · ❌ ${err} erreurs · IA=${results.some(r=>r.aiUsed)?'ON⚠':'OFF✓'}`);

  // répartition par type
  const byType = {};
  for (const r of results) if (!r.error) byType[r.productType] = (byType[r.productType]||0)+1;
  console.log('Répartition productType :', JSON.stringify(byType));

  const outPath = path.join(__dirname, 'grader-baseline.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log('Baseline écrite : ' + outPath);
})();

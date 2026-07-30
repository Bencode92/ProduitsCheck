// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Configuration
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  REPO_OWNER: 'Bencode92',
  REPO_NAME: 'ProduitsCheck',
  DATA_PATH: 'data',
  BRANCH: 'main',
  AI_ENDPOINT: 'https://studyforge-proxy.benoit-comas.workers.dev',
  AI_MODEL: 'claude-opus-4-8',
  AI_MODEL_FALLBACK: 'claude-sonnet-5',
  PDFJS_CDN: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174',
  // Twelve Data via Cloudflare Worker proxy (API key stays in env vars)
  TWELVE_DATA_PROXY: 'https://studyforge-proxy.benoit-comas.workers.dev/twelvedata',
};

const MY_ENTITIES = [
  // riskTolerant / guaranteedOnly = politique de placement portée par l'entité (plus de "=== 'bycam'" en dur).
  { id: 'bycam', name: 'ByCam', legalName: 'ByCam', color: '#06D6A0', icon: '🏢', riskTolerant: true, guaranteedOnly: false, fgdrLimit: 100000 },
  { id: 'cameleons', name: 'Cam.', legalName: 'Caméléons Com Mark', color: '#8338EC', icon: '🦎', riskTolerant: false, guaranteedOnly: true, fgdrLimit: 100000 },
  { id: 'swiss-life', name: 'Swiss Life', color: '#E85D04', icon: '🛡️' },
];

// Normalise une chaîne pour comparer des noms d'entité malgré accents/casse/orthographes.
function _normEntityStr(s) {
  return (s == null ? '' : String(s)).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
// SOURCE UNIQUE de résolution d'entité. Priorité : entity → envelope → entityName (tolérant).
// NE DEVINE JAMAIS : un objet sans rattachement clair renvoie 'non_assigne' (au lieu d'un fallback
// silencieux 'cameleons'/'bycam' qui attribuait de l'argent à la mauvaise société).
function resolveEntity(obj) {
  if (!obj) return 'non_assigne';
  var ids = MY_ENTITIES.map(function (e) { return e.id; });
  var direct = obj.entity || obj.envelope;
  if (direct && ids.indexOf(direct) >= 0) return direct;
  var nm = _normEntityStr(obj.entityName || direct);
  if (nm) {
    for (var i = 0; i < MY_ENTITIES.length; i++) {
      var e = MY_ENTITIES[i], en = _normEntityStr(e.name), el = _normEntityStr(e.legalName || '');
      if (nm === e.id || (en && (nm === en || nm.indexOf(en) >= 0)) || (el && nm.indexOf(el) >= 0)) return e.id;
    }
    if (nm.indexOf('bycam') >= 0 || nm.indexOf('by cam') >= 0) return 'bycam'; // avant 'cam' (bycam contient cam)
    if (nm.indexOf('cam') >= 0) return 'cameleons';
  }
  return 'non_assigne';
}
// Politique d'une entité (défaut PRUDENT pour 'non_assigne' : capital garanti, pas de risque).
function entityPolicy(id) {
  var e = MY_ENTITIES.find(function (x) { return x.id === id; });
  return {
    riskTolerant: !!(e && e.riskTolerant),
    guaranteedOnly: e ? !!e.guaranteedOnly : true,
    fgdrLimit: (e && e.fgdrLimit) || 100000,
    label: e ? (e.icon + ' ' + e.name) : '❓ Non assigné'
  };
}

const BANKS_LIST = [
  { id: 'swiss-life', name: 'Swiss Life', color: '#E63946' },
  { id: 'sg', name: 'Société Générale', color: '#FF006E' },
  { id: 'cic', name: 'CIC', color: '#3A86FF' },
  { id: 'bnp', name: 'BNP Paribas', color: '#06D6A0' },
  { id: 'natixis', name: 'Natixis', color: '#8338EC' },
  { id: 'ca-cib', name: 'Crédit Agricole CIB', color: '#FFBE0B' },
  { id: 'banque-populaire', name: 'Banque Populaire', color: '#0072CE' },
  { id: 'credit-mutuel', name: 'Crédit Mutuel', color: '#005A9C' },
  { id: 'caisse-epargne', name: 'Caisse d\'Épargne', color: '#D4213D' },
  { id: 'lcl', name: 'LCL', color: '#FFD100' },
  { id: 'goldman', name: 'Goldman Sachs', color: '#70A0FF' },
  { id: 'jpmorgan', name: 'JP Morgan', color: '#2EC4B6' },
  { id: 'morgan-stanley', name: 'Morgan Stanley', color: '#E07A5F' },
  { id: 'barclays', name: 'Barclays', color: '#00B4D8' },
  { id: 'ubs', name: 'UBS', color: '#D62828' },
  { id: 'hsbc', name: 'HSBC', color: '#F77F00' },
  { id: 'leonteq', name: 'Leonteq', color: '#7209B7' },
  { id: 'vontobel', name: 'Vontobel', color: '#4361EE' },
];

const BANKS = BANKS_LIST;

const PRODUCT_TYPES = [
  { id: 'autocall', name: 'Autocall / Phoenix', category: 'conditionnel' },
  { id: 'reverse-convertible', name: 'Reverse Convertible', category: 'conditionnel' },
  { id: 'capital-protege', name: 'Capital Protégé', category: 'protege' },
  { id: 'participation', name: 'Participation (Tracker/Outperformance)', category: 'participation' },
  { id: 'range-accrual', name: 'Range Accrual', category: 'conditionnel' },
  { id: 'accumulator', name: 'Accumulator / Decumulator', category: 'conditionnel' },
  { id: 'worst-of', name: 'Worst-of Basket', category: 'conditionnel' },
  { id: 'cln', name: 'CLN (Credit Linked Note)', category: 'credit' },
  { id: 'emtn', name: 'EMTN', category: 'emtn' },
  { id: 'taux_fixe_in_fine', name: 'Taux Fixe Callable In Fine', category: 'emtn' },
  { id: 'bonus', name: 'Certificat Bonus', category: 'conditionnel' },
  { id: 'discount', name: 'Certificat Discount', category: 'conditionnel' },
  { id: 'autre', name: 'Autre', category: 'autre' },
];

const UNDERLYINGS = [
  { id: 'eurostoxx50', name: 'Eurostoxx 50', class: 'indices-eu', correlation_group: 'eu-equity' },
  { id: 'cac40', name: 'CAC 40', class: 'indices-eu', correlation_group: 'eu-equity' },
  { id: 'dax', name: 'DAX', class: 'indices-eu', correlation_group: 'eu-equity' },
  { id: 'ftse100', name: 'FTSE 100', class: 'indices-eu', correlation_group: 'uk-equity' },
  { id: 'sp500', name: 'S&P 500', class: 'indices-us', correlation_group: 'us-equity' },
  { id: 'nasdaq100', name: 'Nasdaq 100', class: 'indices-us', correlation_group: 'us-equity' },
  { id: 'nikkei225', name: 'Nikkei 225', class: 'indices-asia', correlation_group: 'asia-equity' },
  { id: 'msci-world', name: 'MSCI World', class: 'indices-global', correlation_group: 'global-equity' },
  { id: 'single-stock', name: 'Action unique', class: 'single', correlation_group: 'single' },
  { id: 'basket', name: 'Panier actions', class: 'basket', correlation_group: 'basket' },
  { id: 'rates', name: 'Taux (CMS, Euribor)', class: 'rates', correlation_group: 'rates' },
  { id: 'credit', name: 'Crédit (iTraxx, CDX)', class: 'credit', correlation_group: 'credit' },
  { id: 'commodities', name: 'Matières premières', class: 'commodities', correlation_group: 'commodities' },
  { id: 'autre', name: 'Autre', class: 'autre', correlation_group: 'autre' },
];

const CORRELATION_MATRIX = {
  'eu-equity':     { 'eu-equity': 1.0, 'uk-equity': 0.85, 'us-equity': 0.75, 'asia-equity': 0.55, 'global-equity': 0.85, 'rates': -0.2, 'credit': 0.4, 'commodities': 0.3 },
  'uk-equity':     { 'eu-equity': 0.85, 'uk-equity': 1.0, 'us-equity': 0.7, 'asia-equity': 0.5, 'global-equity': 0.8, 'rates': -0.15, 'credit': 0.35, 'commodities': 0.3 },
  'us-equity':     { 'eu-equity': 0.75, 'uk-equity': 0.7, 'us-equity': 1.0, 'asia-equity': 0.5, 'global-equity': 0.9, 'rates': -0.25, 'credit': 0.35, 'commodities': 0.25 },
  'asia-equity':   { 'eu-equity': 0.55, 'uk-equity': 0.5, 'us-equity': 0.5, 'asia-equity': 1.0, 'global-equity': 0.65, 'rates': -0.1, 'credit': 0.3, 'commodities': 0.35 },
  'global-equity': { 'eu-equity': 0.85, 'uk-equity': 0.8, 'us-equity': 0.9, 'asia-equity': 0.65, 'global-equity': 1.0, 'rates': -0.2, 'credit': 0.4, 'commodities': 0.3 },
  'rates':         { 'eu-equity': -0.2, 'uk-equity': -0.15, 'us-equity': -0.25, 'asia-equity': -0.1, 'global-equity': -0.2, 'rates': 1.0, 'credit': 0.5, 'commodities': 0.1 },
  'credit':        { 'eu-equity': 0.4, 'uk-equity': 0.35, 'us-equity': 0.35, 'asia-equity': 0.3, 'global-equity': 0.4, 'rates': 0.5, 'credit': 1.0, 'commodities': 0.15 },
  'commodities':   { 'eu-equity': 0.3, 'uk-equity': 0.3, 'us-equity': 0.25, 'asia-equity': 0.35, 'global-equity': 0.3, 'rates': 0.1, 'credit': 0.15, 'commodities': 1.0 },
};

const PROPOSAL_STATUS = {
  received:    { label: 'Reçue',       color: '#64B5F6', icon: '📥' },
  analyzing:   { label: 'En analyse',  color: '#FFB74D', icon: '🔍' },
  shortlisted: { label: 'Shortlistée', color: '#AED581', icon: '⭐' },
  rejected:    { label: 'Rejetée',     color: '#E57373', icon: '❌' },
  subscribed:  { label: 'Souscrite',   color: '#81C784', icon: '✅' },
  archived:    { label: 'Archivé',     color: '#94A3B8', icon: '📦' },
};

const SCORING_WEIGHTS = {
  SAME_UNDERLYING: 35, CORRELATED_UNDERLYING: 20, SAME_PRODUCT_TYPE: 20,
  SAME_BANK: 10, OVERLAPPING_MATURITY: 15, NEW_UNDERLYING: 25,
  NEW_PRODUCT_TYPE: 20, NEW_BANK: 15, FILLS_MATURITY_GAP: 15,
  BETTER_YIELD_RISK: 15, DECORRELATION_BONUS: 10,
};

function _isFixedRateOrCallable(p) {
    if (!p) return false;
    var name = (p.name || '').toLowerCase();
    var type = (p.type || '').toLowerCase();
    if (type.indexOf('taux fixe') >= 0 || type.indexOf('callable') >= 0) return true;
    if (type.indexOf('obligation') >= 0 || type === 'cln') return true;
    if (name.indexOf('taux fixe') >= 0 || name.indexOf('callable') >= 0) return true;
    if (name.indexOf('fixed rate') >= 0 || name.indexOf('obligation') >= 0) return true;
    if (name.indexOf('bond') >= 0 && name.indexOf('bond 12m') < 0) return true;
    if (name.indexOf('cln') >= 0) return true;
    var noEquity = !p.underlyings || p.underlyings.length === 0;
    if (noEquity && p.coupon > 0) return true;
    if (noEquity && (p.couponType === 'fixe' || p.couponType === 'garanti')) return true;
    return false;
}

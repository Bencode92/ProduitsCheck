// ═══════════════════════════════════════════════════════════════════
// COMPRENDRE — page de référence sur les produits structurés
//   0. Les cinq taux, par l'exemple (où chacun mord, et ce qui les distingue)
//   1. Le test du souverain : chaque produit de taux vs l'OAT de même durée
//   2. Les 3 briques + budget option (calculé sur la courbe du jour)
//   3. Les familles de produits, avec TES produits rattachés
//   4. Décodeur des noms commerciaux
//   5. Les 6 questions devant une brochure
// Courbe FRANÇAISE = séries TEC Banque de France (la zone euro AAA est 58-92 bp plus basse).
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var _rates = null, _open = {};

  function _fmtP(x) { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' %'; }
  function _fmtBp(x) { return (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100)) + ' bp'; }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // ── Courbe souveraine française (TEC) ────────────────────────────
  function _curveFR() {
    var y = (_rates && _rates.yields) || {};
    var g = function (k) { return (y[k] && parseFloat(y[k].current)) || null; };
    var pts = [[24, g('tec2_fr')], [60, g('tec5_fr')], [84, g('tec7_fr')], [120, g('tec10_fr')]].filter(function (p) { return p[1] != null; });
    return pts;
  }
  function _oatAt(months) {
    var p = _curveFR(); if (!p.length) return null;
    if (months <= p[0][0]) return p[0][1];
    if (months >= p[p.length - 1][0]) return p[p.length - 1][1];
    for (var i = 0; i < p.length - 1; i++) {
      if (months >= p[i][0] && months <= p[i + 1][0]) {
        var t = (months - p[i][0]) / (p[i + 1][0] - p[i][0]);
        return p[i][1] + t * (p[i + 1][1] - p[i][1]);
      }
    }
    return p[p.length - 1][1];
  }

  // ── Produits de taux du portefeuille et des propositions ─────────
  function _rateProducts() {
    var seen = {}, out = [];
    var push = function (p) { if (!p || !p.id || seen[p.id]) return; seen[p.id] = 1; out.push(p); };
    try { Object.keys((app.state && app.state.proposals) || {}).forEach(function (b) { (app.state.proposals[b] || []).forEach(push); }); } catch (e) {}
    try { ((app.state && app.state.portfolio) || []).forEach(push); } catch (e) {}
    return out.filter(function (p) {
      var c = p.coupon || {}, er = p.earlyRedemption || {}, cp = p.capitalProtection || {};
      var rateLike = /TEC|EURIBOR|CMS|ESTR|€STR|OAT|BFRTEC/i.test(String(c.barrierCouponType || '') + ' ' + ((p.underlyings || []).join(' '))) ||
        c.type === 'fixe' || c.type === 'fixe_capitalise' || er.type === 'callable' || er.type === 'tarn';
      return rateLike && (cp.protected === true || /taux|capital_garanti|capital-protege/.test(String(p.structureType || p.type || '')));
    }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
  }

  // Rendement ACQUIS : ce que tu touches quoi qu'il arrive (hors conditionnel)
  function _acquis(p) {
    var c = p.coupon || {}, er = p.earlyRedemption || {};
    var rate = parseFloat(c.annualizedRate != null ? c.annualizedRate : c.rate) || 0;
    var T = parseFloat(p.maturityYears) || 10;
    var inFine = /in_fine|maturit/i.test(String(c.frequency || '')) || c.paymentTiming === 'at_redemption';
    var cond = c.type === 'conditionnel';
    var gy = parseInt(c.guaranteedYears != null ? c.guaranteedYears : p.guaranteedYears, 10) || 0;
    var fees = parseFloat((p.aiParsed && p.aiParsed.commissions) || (p.fees && p.fees.structuring)) || 0;
    if (cond) {
      // Seule la période garantie est acquise ; au-delà, le coupon dépend d'une barrière.
      if (!gy) return { r: 0, note: 'aucun coupon acquis — tout est conditionnel', cond: true, fees: fees, T: T };
      return { r: rate, note: gy + ' an' + (gy > 1 ? 's' : '') + ' garantis puis conditionnel', cond: true, gy: gy, fees: fees, T: T };
    }
    if (inFine && rate > 0) {
      // Intérêt simple capitalisé en une fois → rendement actuariel décroissant avec la durée
      var lvl = 1 + rate / 100 * T;
      return { r: (Math.pow(lvl, 1 / T) - 1) * 100, note: 'in fine, intérêt simple ' + _fmtP(rate) + '/an', cond: false, fees: fees, T: T, inFine: true };
    }
    return { r: rate, note: 'coupon versé chaque période', cond: false, fees: fees, T: T };
  }


  // ── 0. L'échelle de placement d'une trésorerie d'entreprise ──────
  function _echelle() {
    var y = (_rates && _rates.yields) || {}, pr = (_rates && _rates.policy_rates) || {};
    var g = function (k) { return (y[k] && parseFloat(y[k].current)) || null; };
    var dep = pr.ecb_deposit_rate && pr.ecb_deposit_rate.current;
    var e3 = g('euribor_3m'), e12 = g('euribor_12m'), t5 = g('tec5_fr'), t10 = g('tec10_fr');
    var bestCat = null;
    try { bestCat = (typeof window._getCATBenchmark === 'function') ? parseFloat(window._getCATBenchmark()) : null; } catch (e) {}
    var L = [
      ['Compte courant (DAV)', 'immédiate', '≈ 0 %', 'Aucun rendement. Tout ce qui y dort au-delà du BFR est une perte sèche face à l\'inflation.', 'var(--text-dim)'],
      ['OPC monétaire', 'J+1', (dep ? _fmtP(dep - 0.15) : '≈ 2,4 %'), 'Suit l\'€STR moins les frais de gestion. Valeur liquidative quotidienne, pas de capital garanti mais risque quasi nul. Le bon support pour du cash qui peut partir à tout moment.', 'var(--text)'],
      ['TCN / NEU CP', '1 à 12 mois', '2,7 à 3,0 %', 'Billets de trésorerie émis par des entreprises ou des banques. Négociables, mais montant minimum souvent élevé et marché secondaire étroit.', 'var(--text)'],
      ['Compte à terme', 'à l\'échéance', (bestCat ? 'jusqu\'à ' + _fmtP(bestCat) : '2,55 à 3,54 %'), 'Capital garanti, couvert par le <strong>FGDR à 100 000 € par banque et par société</strong>. Pénalités de sortie variables selon les banques — c\'est le point à négocier, pas seulement le taux.', 'var(--green)'],
      ['Obligation d\'État (OAT)', 'quotidienne', (t5 && t10 ? _fmtP(t5) + ' à ' + _fmtP(t10) : '3,9 à 4,5 %'), '<strong>Le grand absent des propositions bancaires.</strong> Liquide tous les jours, pas de call, pas de risque bancaire — et aujourd\'hui mieux payé que la plupart des structurés qu\'on te propose. Valeur de marché variable, mais tu récupères le pair à l\'échéance.', 'var(--accent)'],
      ['Obligation corporate ou OPC obligataire daté', 'quotidienne', '+ 0,3 à 2 % selon la signature', 'Tu portes le risque de crédit d\'une entreprise. En format OPC : valorisation quotidienne, diversification, mais frais de gestion annuels.', 'var(--text)'],
      ['Structuré de taux à capital garanti', 'illiquide', '4,15 à 6,55 % affichés', 'Capital garanti <em>par la banque</em> à l\'échéance. Le coupon acquis est très inférieur au coupon affiché dès qu\'il y a une condition. Sortie en cours de vie au prix du marché, à la main de l\'émetteur.', 'var(--orange)'],
      ['Structuré actions', 'illiquide', '7 à 11 % affichés', 'Capital à risque sous une barrière. Le coupon élevé est le prix du put que tu vends. Hors cadre pour la poche prudente.', 'var(--red)'],
      ['Actions, OPC actions', 'quotidienne', '—', 'Ce n\'est plus de la trésorerie. À réserver à une poche longue clairement identifiée.', 'var(--red)']
    ];
    var h = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#059669"></span>🪜 L\'échelle de placement d\'une trésorerie d\'entreprise</div>' +
      '<span style="font-size:10px;color:var(--text-dim)">taux du ' + ((_rates && _rates.fetched_at) ? _rates.fetched_at.split('T')[0] : '?') + '</span></div>' +
      '<div style="font-size:12px;line-height:1.65;max-width:72ch;margin-bottom:12px">Les banques présentent toujours le même escalier — du compte courant aux actions. Ce qui compte n\'est pas le taux affiché de chaque marche, mais <strong>ce que tu abandonnes pour l\'obtenir</strong> : la liquidité d\'abord, la garantie ensuite.</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:680px"><thead><tr style="border-bottom:1px solid var(--border)">' +
      '<th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Support</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Disponibilité</th>' +
      '<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Rendement actuel</th><th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Ce qu\'il faut savoir</th></tr></thead><tbody>';
    L.forEach(function (r) {
      h += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:7px 6px;font-weight:600;color:' + r[4] + '">' + r[0] + '</td>' +
        '<td style="padding:7px 6px;color:var(--text-muted)">' + r[1] + '</td>' +
        '<td style="padding:7px 6px;text-align:right;font-family:var(--mono);white-space:nowrap">' + r[2] + '</td>' +
        '<td style="padding:7px 6px;font-size:10.5px;color:var(--text-muted);line-height:1.5">' + r[3] + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div style="margin-top:10px;padding:10px 12px;border:1px solid rgba(8,145,178,0.35);background:rgba(8,145,178,0.06);border-radius:6px;font-size:11.5px;line-height:1.6">' +
      '<strong>Le trou dans l\'escalier.</strong> Entre le meilleur compte à terme (' + (bestCat ? _fmtP(bestCat) : '≈ 3,5 %') + ') et les structurés de taux, il y a l\'<strong>OAT à ' + (t10 ? _fmtP(t10) : '≈ 4,5 %') + '</strong> — liquide, sans call, sans risque bancaire. Aucune banque ne te la proposera : elle ne marge pas dessus. C\'est pourtant le repère contre lequel tout structuré de taux devrait être jugé.</div>' +
      '</div>';
    return h;
  }

  // ── 1. Le test du souverain ──────────────────────────────────────
  function _testSouverain() {
    var prods = _rateProducts();
    if (!prods.length) return '';
    var rows = prods.map(function (p) {
      var a = _acquis(p), T = a.T, oat = _oatAt(Math.round(T * 12));
      var net = a.r - (a.fees ? a.fees / T : 0);
      var spread = (oat != null && a.r > 0) ? net - oat : null;
      return { p: p, a: a, oat: oat, net: net, spread: spread };
    }).sort(function (x, y) { return (y.spread == null ? -99 : y.spread) - (x.spread == null ? -99 : x.spread); });

    var h = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#0891B2"></span>⚖️ Le test du souverain</div>' +
      '<span style="font-size:10px;color:var(--text-dim)">courbe française TEC · Banque de France</span></div>' +
      '<div style="font-size:12px;color:var(--text);line-height:1.6;margin-bottom:10px;max-width:70ch">La première question devant n\'importe quel produit de taux : <strong>est-ce qu\'il paie plus que l\'État français sur la même durée ?</strong> Si non, tu prends du risque bancaire, une option de rappel et dix ans d\'illiquidité pour être moins bien payé qu\'avec une OAT liquide et sans call.</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:720px"><thead><tr style="border-bottom:1px solid var(--border)">' +
      '<th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Produit</th>' +
      '<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Durée</th>' +
      '<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Rendement acquis</th>' +
      '<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">OAT même durée</th>' +
      '<th style="text-align:right;padding:5px 6px;color:var(--text-muted)">Écart</th>' +
      '<th style="text-align:left;padding:5px 6px;color:var(--text-muted)">Lecture</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var col = r.spread == null ? 'var(--text-dim)' : r.spread >= 0.30 ? 'var(--green)' : r.spread >= 0 ? 'var(--orange)' : 'var(--red)';
      var verdict = r.spread == null ? 'rendement acquis nul : tout dépend d\'une barrière' :
        r.spread >= 0.30 ? 'prime réelle sur le souverain' :
        r.spread >= 0 ? 'prime trop mince pour payer l\'illiquidité et le risque émetteur' :
        'payé MOINS que l\'État français, pour plus de risque';
      h += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:5px 6px"><strong>' + _esc((r.p.name || '?').substring(0, 42)) + '</strong>' +
        '<div style="font-size:9px;color:var(--text-dim)">' + _esc(r.p.emitter || '') + ' · ' + _esc(r.a.note) + (r.a.fees ? ' · commission ' + _fmtP(r.a.fees) : '') + '</div></td>' +
        '<td style="padding:5px 6px;text-align:right;font-family:var(--mono)">' + r.a.T + ' a</td>' +
        '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700">' + (r.a.r > 0 ? _fmtP(r.net) : '—') + '</td>' +
        '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:var(--text-dim)">' + (r.oat != null ? _fmtP(r.oat) : '—') + '</td>' +
        '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:' + col + '">' + (r.spread != null ? _fmtBp(r.spread) : '—') + '</td>' +
        '<td style="padding:5px 6px;font-size:10px;color:var(--text-muted);max-width:230px">' + verdict + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div style="font-size:10px;color:var(--text-dim);margin-top:8px;line-height:1.5">« Rendement acquis » = ce que tu touches <strong>quoi qu\'il arrive</strong>, net de commission amortie : le coupon pour un produit à coupon fixe, le seul taux actuariel du remboursement pour un in fine à intérêt simple, et uniquement les années garanties pour un produit conditionnel. Le conditionnel (TARN, digitale, range accrual) peut rapporter bien plus — mais rien n\'en est dû. La courbe TEC est le vrai souverain français ; la courbe « zone euro AAA » (allemande) est 58 à 92 bp plus basse et ne doit pas servir de repère pour un produit émis par une banque française.</div>' +
      '</div>';
    return h;
  }

  // ── 2. Les briques + budget option ───────────────────────────────
  function _briques() {
    var y = (_rates && _rates.yields) || {};
    var t5 = y.tec5_fr && y.tec5_fr.current, t10 = y.tec10_fr && y.tec10_fr.current;
    var b5 = t5 ? (1 - 1 / Math.pow(1 + t5 / 100, 5)) * 100 : null;
    var b10 = t10 ? (1 - 1 / Math.pow(1 + t10 / 100, 10)) * 100 : null;
    return '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#7C3AED"></span>🧱 Comment un structuré est fabriqué</div></div>' +
      '<div style="font-size:12px;line-height:1.65;max-width:70ch;margin-bottom:12px">Il n\'existe que trois briques. Tous les produits en sont une combinaison, et connaître la combinaison suffit à comprendre le payoff sans lire la formule.</div>' +
      '<div style="font-family:var(--mono);font-size:11px;background:var(--bg-elevated);border-left:3px solid var(--purple);padding:12px 14px;line-height:1.8;overflow-x:auto;margin-bottom:12px">' +
      '<strong>brique 1</strong>  une obligation zéro-coupon de l\'émetteur  → ramène le capital à l\'échéance<br>' +
      '<strong>brique 2</strong>  des options ACHETÉES pour toi             → participation, protection<br>' +
      '<strong>brique 3</strong>  des options VENDUES par toi               → le coupon<br><br>' +
      'prix payé 100 = brique 1 + brique 2 − brique 3 + <span style="color:var(--orange)">marge de la banque</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:12px">' +
      '<div style="padding:10px 12px;background:var(--bg-elevated);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Budget option à 5 ans</div><div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--purple)">' + (b5 != null ? _fmtP(b5) : '—') + '</div><div style="font-size:9px;color:var(--text-dim)">du nominal, avec TEC 5 à ' + (t5 ? _fmtP(t5) : '?') + '</div></div>' +
      '<div style="padding:10px 12px;background:var(--bg-elevated);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Budget option à 10 ans</div><div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--purple)">' + (b10 != null ? _fmtP(b10) : '—') + '</div><div style="font-size:9px;color:var(--text-dim)">du nominal, avec TEC 10 à ' + (t10 ? _fmtP(t10) : '?') + '</div></div>' +
      '<div style="padding:10px 12px;background:rgba(232,93,4,0.08);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Ce qu\'une commission de 1 % coûte</div><div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--orange)">' + (b5 ? Math.round(100 / b5) + ' %' : '—') + '</div><div style="font-size:9px;color:var(--text-dim)">du budget option sur 5 ans — pas 1 %</div></div>' +
      '</div>' +
      '<div style="font-size:11px;line-height:1.6;max-width:70ch"><strong>budget option = 1 − 1 ÷ (1 + taux)<sup>durée</sup></strong>. Trois conséquences : un coupon élevé signifie toujours une option vendue plus chère, jamais une conviction de la banque ; à taux bas le capital garanti est impossible, à taux hauts il redevient abordable ; et la marge sort du même budget que ton coupon — elle ne s\'ajoute pas au prix, elle se retire de ta rémunération.</div>' +
      '</div>';
  }

  // ── 3. Les familles ──────────────────────────────────────────────
  // ── 3. Les fiches produit ────────────────────────────────────────
  //  Une carte par type classique rencontré par une trésorerie d'entreprise :
  //  définition · mécanique · exemple chiffré sur 100 000 € · ce que tu vends · le piège.
  var CATS = [
    { k: 'base', l: 'Sans risque', c: '#059669' },
    { k: 'taux', l: 'Structurés de taux', c: '#0891B2' },
    { k: 'actions', l: 'Structurés actions', c: '#7C3AED' },
    { k: 'autre', l: 'Fonds & crédit', c: '#C2410C' }
  ];

  var FICHES = [
    // ───────── SANS RISQUE ─────────
    { cat: 'base', nom: 'Compte à terme à taux fixe', sous: 'CAT fixe',
      def: 'Tu bloques une somme sur une durée convenue, à un taux connu d\'avance. Le capital est garanti par la banque et couvert par le FGDR jusqu\'à 100 000 € par société et par banque.',
      meca: 'Le taux annoncé est <strong>actuariel</strong> : il suppose que tu vas au terme. Sortir avant déclenche les conditions de retrait anticipé, qui varient beaucoup d\'une banque à l\'autre.',
      ex: '100 000 € à 3,05 % sur 12 mois → <strong>103 050 €</strong> à l\'échéance. Sortie au mois 5 avec la grille CIC (0 % les 3 premiers mois, puis 50 %) → seulement <strong>1,53 %</strong> annualisé.',
      vend: 'Rien — mais tu cèdes ta liquidité jusqu\'au terme.',
      piege: 'Le taux n\'est que la moitié du sujet. À taux égal, c\'est la <strong>pénalité de sortie</strong> qui départage les offres : 0 % puis 50 % chez CIC, minoration de 90/60/30 % chez SG, aucune pénalité chez Banque Populaire. Demande-la toujours par écrit.' },

    { cat: 'base', nom: 'Compte à terme à taux progressif', sous: 'CAT progressif, à préavis',
      def: 'Un compte à terme dont le taux monte par paliers, avec une sortie libre à chaque fin de palier.',
      meca: 'Le taux affiché est la <strong>moyenne actuarielle</strong> de tous les paliers, jamais le taux du dernier. Hors échéance de palier, la sortie exige un préavis (32 jours) et te rémunère au taux de la période précédente.',
      ex: 'CIC 18 mois : 2,90 % (S1) → 3,10 % (S2) → 3,61 % (S3), soit <strong>3,20 % de moyenne</strong>. Sorti fin du S1 tu touches 2,90 % — à comparer au fixe 6 mois à 2,80 %. Sorti au milieu du S2, tu retombes à 2,90 %.',
      vend: 'Rien. C\'est le produit le plus souple de la gamme sans risque.',
      piege: 'Ne jamais comparer le « 3,20 % » d\'un progressif au « 3,05 % » d\'un fixe 12 mois : ce ne sont pas les mêmes durées. Compare toujours à <strong>horizon de sortie égal</strong> — c\'est ce que fait la grille d\'équivalence de l\'onglet CAT.' },

    { cat: 'base', nom: 'OPC monétaire', sous: 'fonds monétaire, SICAV de trésorerie',
      def: 'Un fonds qui place à très court terme sur le marché monétaire. Pas de capital garanti, mais un risque quasi nul et une valeur liquidative quotidienne.',
      meca: 'Le rendement suit l\'€STR (le taux au jour le jour de la BCE) diminué des frais de gestion. Aucun engagement de durée : tu entres et tu sors en J+1.',
      ex: 'Avec l\'€STR à 2,50 % et 0,15 % de frais → environ <strong>2,35 % annualisé</strong>, disponible à tout moment.',
      vend: 'Rien. Tu paies simplement des frais de gestion pour la liquidité.',
      piege: 'Rendement inférieur au CAT, et ce n\'est pas un dépôt : pas de FGDR. C\'est le bon support pour le cash qui peut partir demain, pas pour du cash immobilisable.' },

    { cat: 'base', nom: 'Obligation d\'État', sous: 'OAT, TEC',
      def: 'Un prêt à l\'État français, matérialisé par un titre coté que tu peux revendre tous les jours sur un marché profond.',
      meca: 'Coupon annuel fixe, remboursement au pair à l\'échéance. Entre-temps, la valeur de marché bouge à l\'inverse des taux : elle baisse quand ils montent.',
      ex: 'Une OAT 10 ans à 4,48 % rapporte <strong>4 480 € par an</strong> sur 100 000 €. Si les taux montent de 1 point, sa valeur baisse d\'environ 8 % — mais si tu la gardes, tu récupères 100 000 € plus tous les coupons.',
      vend: 'Rien du tout. Aucune option cédée, aucun call, aucun risque bancaire.',
      piege: 'Personne ne te la proposera : la banque ne marge pas dessus. La moins-value latente peut imposer une provision comptable à la clôture selon la classification retenue — à valider avec ton expert-comptable, c\'est le seul vrai frein.' },

    { cat: 'base', nom: 'Obligation d\'entreprise', sous: 'corporate, OPC obligataire daté',
      def: 'Le même mécanisme, mais tu prêtes à une entreprise au lieu de l\'État. Le supplément de taux rémunère le risque qu\'elle ne rembourse pas.',
      meca: 'Le <strong>rang</strong> compte plus que le coupon : une dette senior et une dette subordonnée du même émetteur n\'ont rien à voir en cas de difficulté. En format OPC daté, tu obtiens la diversification et une valorisation quotidienne, contre des frais annuels.',
      ex: 'Une corporate BBB à 6 ans autour de 4,5 % quand l\'État paie 4,0 % : <strong>+50 bp</strong> pour le risque de crédit. En dessous de cet écart, le risque n\'est pas payé.',
      vend: 'Rien, mais tu portes le risque de défaut de l\'entreprise.',
      piege: 'Les titres « subordonnés » et les « hybrides » affichent des coupons séduisants parce qu\'ils passent après tout le monde en cas de faillite. Un AT1 bancaire peut même être effacé par le régulateur sans faillite.' },

    // ───────── STRUCTURÉS DE TAUX ─────────
    { cat: 'taux', nom: 'EMTN à taux fixe', sous: 'obligation bancaire simple, non rappelable',
      def: 'Un titre de créance émis par une banque, à coupon fixe et durée ferme. C\'est le mètre étalon de tous les structurés de taux.',
      meca: 'Rien de plus qu\'une obligation, sauf qu\'elle est émise par une banque et non par l\'État, et qu\'elle n\'a pas de marché secondaire actif.',
      ex: '100 000 € à 4,20 % sur 5 ans → <strong>4 200 € par an</strong>, capital rendu à l\'échéance.',
      vend: 'Rien — aucune option cédée. C\'est ce qui en fait la référence.',
      piege: 'C\'est contre ce produit qu\'il faut comparer tous les autres : si un callable de même durée ne paie pas nettement plus qu\'un fixe non rappelable, l\'option de rappel que tu cèdes est offerte gratuitement.' },

    { cat: 'taux', nom: 'Callable — coupon annuel', sous: '10NC3, rappelable par l\'émetteur',
      def: 'Un taux fixe dont <strong>la banque</strong> peut décider d\'arrêter le paiement, en te remboursant par anticipation à partir d\'une certaine année.',
      meca: 'Chaque année à partir de l\'année N, l\'émetteur choisit : il rembourse ou il continue. Il rembourse quand il peut se refinancer moins cher — donc <strong>quand les taux ont baissé</strong>.',
      ex: 'EMTN CIC 4,15 %, 10 ans, rappelable dès l\'an 3 : <strong>4 150 €/an</strong>. Si les taux baissent et qu\'il te rappelle fin an 3, tu as touché 12 450 € et tu replaces 100 000 € dans un marché devenu moins généreux. S\'ils montent, il ne rappelle pas et tu restes à 4,15 % jusqu\'en 2036.',
      vend: 'Une option de rappel bermudéenne, qui vaut 30 à 60 bp par an.',
      piege: 'Tu es <strong>perdant dans les deux sens</strong>, par construction. Ce n\'est pas une arnaque, c\'est le prix du coupon — mais il faut que ce coupon dépasse le taux fixe non rappelable de même durée <em>plus</em> la valeur de l\'option. Aujourd\'hui, ce seuil est vers 4,6-4,8 % sur 10 ans.' },

    { cat: 'taux', nom: 'Callable in fine', sous: 'zéro-coupon, intérêt simple',
      def: 'Un callable qui ne verse rien pendant toute sa vie : les gains sont accumulés et payés en une seule fois au remboursement.',
      meca: 'Le gain est presque toujours exprimé en <strong>intérêt simple</strong> — « 4,82 % par année écoulée ». Le rendement actuariel réel <em>baisse</em> donc avec la durée, puisque rien n\'est réinvesti.',
      ex: 'Callable In Fine 4,82 %, rappelable dès l\'an 4. Rappelé an 4 : tu reçois 119 280 €, soit <strong>4,50 % actuariel</strong>. Jamais rappelé, à 10 ans : 148 200 €, soit seulement <strong>4,02 %</strong>.',
      vend: 'L\'option de rappel, et la disponibilité de tes flux pendant toute la durée.',
      piege: 'Double peine pour une société à l\'IS : la prime de remboursement est imposée <strong>chaque année sur les intérêts courus</strong>, alors que tu n\'encaisses rien. Tu paies l\'impôt avant de toucher l\'argent.' },

    { cat: 'taux', nom: 'TARN', sous: 'Target Accrual Redemption Note, à cible de coupons',
      def: 'Un produit qui verse des coupons conditionnels et se rembourse <strong>tout seul</strong> dès que le total des coupons versés atteint un objectif fixé d\'avance.',
      meca: 'Coupons garantis les N premières années, puis versés uniquement si un taux de référence (le TEC 10) reste sous une barrière. Dès que le cumul atteint la cible, le produit s\'arrête et te rend le capital.',
      ex: 'TARN 6,55 %, 2 ans garantis, barrière TEC10 ≤ 4,90 %, cible 26,20 %. Années 1 et 2 : <strong>6 550 € chacune</strong>, acquis. Ensuite il faut que le TEC10 reste sous 4,90 % — il est à 4,48 % aujourd\'hui. Si les 4 premiers coupons tombent, le cumul atteint 26,20 % et tu es remboursé fin an 4.',
      vend: 'La durée <em>et</em> la conditionnalité, en une seule fois.',
      piege: 'L\'asymétrie est totale. Taux bas : cible atteinte vite, tu es remboursé au moment où tu aurais voulu rester. Taux hauts : coupons perdus, cible jamais atteinte, <strong>tu restes immobilisé dix ans sans rien toucher</strong>. Regarde toujours où est le taux de référence <em>aujourd\'hui</em> par rapport à la barrière.' },

    { cat: 'taux', nom: 'Range accrual', sous: 'corridor, tunnel',
      def: 'Un coupon payé <strong>au prorata du nombre de jours</strong> où un taux reste à l\'intérieur d\'une fourchette.',
      meca: 'Ce n\'est pas du tout ou rien : chaque jour compte. Le coupon final est le taux facial multiplié par la fraction de jours passés dans le tunnel.',
      ex: 'Range accrual 4,20 %, tunnel Euribor 3M [1,90 % – 3,75 %]. L\'Euribor est à 2,66 % : dans le tunnel. Si c\'est le cas toute l\'année → <strong>4 200 €</strong>. S\'il en sort la moitié du temps → <strong>2 100 €</strong>.',
      vend: 'De la volatilité de taux : tu paries sur l\'immobilité, pas sur une direction.',
      piege: 'C\'est le produit où l\'écart entre l\'affiche et la réalité est le plus grand. <strong>Demande l\'historique</strong> : sur les 5 et 10 dernières années, quel pourcentage du temps le taux serait-il resté dans ce tunnel ? La réponse est souvent bien inférieure à 100 %.' },

    { cat: 'taux', nom: 'Digitale de taux', sous: 'binaire, avec ou sans mémoire',
      def: 'Tout ou rien : à chaque date d\'observation, le coupon est versé en entier si le taux est du bon côté d\'un seuil, ou pas du tout.',
      meca: 'La variante <strong>mémoire</strong> change tout : les coupons non versés sont mis en réserve et rattrapés dès qu\'une observation repasse du bon côté. Sans mémoire, un coupon raté est perdu définitivement.',
      ex: 'Digitale Mémoire TEC10 : 4,60 % si le TEC 10 est ≤ 4,40 %. Le TEC 10 est à <strong>4,48 %</strong> : au-dessus, coupon non versé cette année mais <em>mémorisé</em>. Si l\'an prochain il repasse sous 4,40 %, tu touches <strong>9 200 €</strong> d\'un coup.',
      vend: 'Une option binaire sur un seuil de taux.',
      piege: 'Sensibilité extrême au voisinage du seuil : 4,39 % et 4,41 % donnent des résultats opposés. Et sans mémoire, une année ratée ne se rattrape jamais.' },

    { cat: 'taux', nom: 'Steepener', sous: 'CMS spread, pari sur la pente',
      def: 'Un coupon indexé sur l\'<strong>écart</strong> entre un taux long et un taux court, multiplié par un levier.',
      meca: 'Formule type : <span class="mono">levier × (CMS 10 ans − CMS 2 ans)</span>, avec un plancher à zéro. Tu gagnes si la courbe se redresse, tu perds si elle s\'aplatit.',
      ex: 'Avec un levier 5 et une pente actuelle d\'environ 1,00 point → <strong>5 %/an</strong>. Si la pente se réduit à 0,50 → <strong>2,5 %</strong>. Si elle s\'annule → zéro.',
      vend: 'L\'aplatissement de la courbe, amplifié par le levier.',
      piege: 'Le levier joue dans les deux sens et la pente est très instable. Ce produit se vend surtout quand la courbe est raide — c\'est-à-dire quand le coupon de départ paraît généreux, et que le potentiel d\'amélioration est déjà derrière.' },

    { cat: 'taux', nom: 'Floater', sous: 'taux variable, capé/floaté',
      def: 'Un coupon révisé périodiquement, égal à un taux de marché plus une marge fixe.',
      meca: 'Chaque trimestre, le coupon est recalculé sur l\'Euribor du moment. Un <strong>cap</strong> plafonne le coupon (c\'est une option que tu vends), un <strong>floor</strong> le protège (c\'est une option qu\'on te donne).',
      ex: 'Euribor 3M + 0,80 % : avec l\'Euribor à 2,66 %, le coupon actuel est de <strong>3,46 %</strong>. Si la BCE monte encore, ton coupon suit automatiquement.',
      vend: 'Rien s\'il n\'y a pas de cap ; le plafond s\'il y en a un.',
      piege: 'C\'est le <strong>seul produit de taux qui te protège d\'une hausse</strong> au lieu de te punir. Vérifie où est le cap par rapport au forward : un cap déjà dépassé par les anticipations du marché est perdu dès la souscription.' },

    // ───────── STRUCTURÉS ACTIONS ─────────
    { cat: 'actions', nom: 'Autocall / Athena', sous: 'Express, à rappel automatique',
      def: 'Un produit sur action qui se rembourse automatiquement, avec un coupon, dès que le sous-jacent dépasse un seuil à une date d\'observation.',
      meca: 'À chaque observation : si le titre est au-dessus du seuil de rappel, fin du produit avec coupon. Sinon on continue. À l\'échéance, le capital est rendu <em>si</em> le titre est au-dessus de la barrière ; sinon tu encaisses toute la baisse.',
      ex: 'Athena Siemens Energy, 11,35 %/an, rappel dès le mois 12 si l\'action ≥ 85 %, barrière capital 55 %. Rappelé au mois 12 : <strong>111 350 €</strong>. Mais si l\'action finit à 40 % : tu récupères <strong>40 000 €</strong>.',
      vend: 'Un put à barrière, et toute la hausse au-delà du coupon.',
      piege: 'Le coupon élevé n\'est jamais une conviction de la banque sur le titre : elle choisit au contraire les valeurs les <strong>plus volatiles</strong>, parce que c\'est ce qui rend le coupon vendable. Un coupon de 11 % te dit que le marché juge ce titre très risqué.' },

    { cat: 'actions', nom: 'Phoenix', sous: 'coupon conditionnel à barrière basse',
      def: 'Un autocall amélioré : le coupon a sa <strong>propre barrière</strong>, plus basse que celle du capital. Tu peux donc toucher des coupons même si le titre a beaucoup baissé.',
      meca: 'Deux seuils indépendants : une barrière coupon (par exemple 40 %) et une barrière capital. Avec l\'effet mémoire, les coupons ratés sont rattrapés.',
      ex: 'Phoenix Mémoire STMicro : 2 % par trimestre si l\'action ≥ 40 % de son niveau initial, soit <strong>8 %/an</strong>. Capital protégé tant que la baisse n\'excède pas 60 %.',
      vend: 'Le même put à barrière, mais on te laisse une chance bien plus large de toucher le coupon.',
      piege: 'C\'est la variante la plus favorable de la famille à coupon égal — mais le risque de perte en capital reste entier. Regarde la barrière capital, pas la barrière coupon.' },

    { cat: 'actions', nom: 'Digitale actions', sous: 'binaire, souvent worst-of',
      def: 'Un coupon tout ou rien selon que le sous-jacent est au-dessus d\'un seuil à la date anniversaire — très souvent 100 % de son niveau de départ.',
      meca: 'Le seuil à 100 % est une condition dure : il faut que le titre <strong>n\'ait pas baissé du tout</strong>. En version <em>worst-of</em>, la condition porte sur le plus mauvais d\'un panier.',
      ex: 'Digitale WO BNP / Airbus, 3 ans, capital garanti : <strong>7 300 €</strong> par an si le moins performant des deux est ≥ 100 % de son niveau initial, avec mémoire. Sinon rien cette année-là, mémorisé.',
      vend: 'Une option binaire, et sur un worst-of, de la décorrélation entre les titres.',
      piege: 'Sur un worst-of, il suffit qu\'<strong>un seul</strong> titre soit en retard pour tout bloquer. Avec deux titres, la probabilité de rater le coupon est bien supérieure au double de celle d\'un seul titre.' },

    { cat: 'actions', nom: 'Reverse convertible', sous: 'BRC, à livraison d\'actions',
      def: 'Coupon fixe élevé versé quoi qu\'il arrive, mais remboursement <strong>en actions</strong> si le titre a franchi la barrière.',
      meca: 'C\'est la vente de put sous sa forme la plus nue, et la plus honnête : la mécanique est visible dès la première ligne de la brochure.',
      ex: 'Coupon 8 % garanti sur 2 ans. Si le titre finit sous 70 %, on te livre les actions valant 65 000 € au lieu de te rendre 100 000 €.',
      vend: 'Un put, directement.',
      piege: 'Le coupon est garanti, ce qui rassure — mais il ne compense pas une chute du titre. C\'est un produit de conviction sur le sous-jacent, jamais un produit de trésorerie.' },

    { cat: 'actions', nom: 'Capital garanti + participation', sous: 'indexé, à formule',
      def: 'Ton capital est intégralement rendu, et tu reçois en plus une fraction de la hausse d\'un indice.',
      meca: 'Le budget option (aujourd\'hui 17 % à 5 ans) est dépensé en options d\'achat au lieu de coupon. Le taux de participation dépend directement de ce budget.',
      ex: '100 % du capital + 50 % de la hausse de l\'EuroStoxx sur 6 ans. Si l\'indice fait +30 %, tu touches <strong>115 000 €</strong>. S\'il baisse, tu récupères 100 000 € — mais tu as immobilisé six ans pour un rendement nul.',
      vend: 'Les dividendes de l\'indice, et la part de hausse au-delà de la participation.',
      piege: 'Le risque n\'est pas la perte, c\'est le <strong>coût d\'opportunité</strong> : six ans à 0 % pendant qu\'un CAT payait 3,5 %. Et la participation est calculée sur un indice <em>hors dividendes</em>, voire à décrément.' },

    { cat: 'actions', nom: 'Airbag', sous: 'amorti, protection dégressive',
      def: 'Une variante qui <strong>amortit la perte</strong> au lieu de la subir intégralement quand la barrière est franchie.',
      meca: 'Sous la barrière, la perte est divisée par le niveau de la barrière au lieu d\'être proportionnelle à la baisse.',
      ex: 'Barrière 55 %, titre à 47 % à l\'échéance. Sans airbag tu perds 53 % ; <strong>avec airbag tu perds 14,5 %</strong> (47 ÷ 55).',
      vend: 'Un peu de coupon, pour acheter cette protection.',
      piege: 'Rare, et jamais mis en avant parce qu\'il fait baisser le coupon affiché. C\'est pourtant l\'une des trois seules mécaniques du marché qui jouent en ta faveur — à demander par son nom.' },

    // ───────── FONDS & CRÉDIT ─────────
    { cat: 'autre', nom: 'Note à capital garanti sur fonds', sous: 'CPPI, gestion à coussin',
      def: 'Un titre qui garantit ton capital à l\'échéance tout en investissant dans un fonds de gestion alternative.',
      meca: 'Un algorithme répartit en permanence entre l\'actif risqué et le monétaire, en gardant toujours de quoi ramener 100 % à l\'échéance. Plus le « coussin » est épais, plus il investit dans le risqué.',
      ex: 'Note 5 ans, objectif €STR + 3 %, capital garanti, sortie mensuelle avec 1 % de frais. Si le fonds chute fortement la première année, l\'algorithme bascule en monétaire.',
      vend: 'La participation à la hausse, en échange d\'une garantie mécanique.',
      piege: '<strong>Le risque de monétarisation.</strong> Après une forte baisse précoce, le coussin disparaît : le fonds se fige définitivement en monétaire et ne profitera d\'<em>aucun</em> rebond. Tu conserves ton capital, mais tu immobilises cinq ans pour zéro. Et « objectif de rendement » n\'est jamais un engagement.' },

    { cat: 'autre', nom: 'CLN — obligation synthétique', sous: 'Credit Linked Note, sur entité de référence',
      def: 'Tu reçois un coupon en échange d\'une <strong>assurance que tu vends</strong> sur la solvabilité d\'une entreprise donnée.',
      meca: 'Tant qu\'aucun événement de crédit (défaut, restructuration, procédure collective) n\'affecte l\'entreprise de référence, tu touches le coupon et récupères ton capital. Sinon tu perds tout ou partie du capital.',
      ex: 'CLN Renault 6 ans à 3,90 % : <strong>3 900 €/an</strong>. Mais l\'État français paie environ 4,00 % sur la même durée — tu prendrais donc le risque Renault <em>et</em> le risque Natixis pour être moins bien payé que sans risque.',
      vend: 'Une protection contre la faillite d\'une entreprise. C\'est littéralement un contrat d\'assurance où tu es l\'assureur.',
      piege: '<strong>Deux signatures, pas une.</strong> « Capital garanti » veut dire ici « garanti par l\'émetteur, sauf événement de crédit sur la référence » — ce n\'est pas la garantie d\'un CAT. Le test : compare toujours le coupon à l\'OAT de même durée, et demande le spread CDS de la signature.' },

    { cat: 'autre', nom: 'Indice crédit — panier d\'entités', sous: 'CLN sur panier, first-to-default',
      def: 'La même chose, mais sur plusieurs entreprises à la fois.',
      meca: 'En version <strong>linéaire</strong>, chaque défaut réduit coupon et capital au prorata. En version <strong>first-to-default</strong>, le tout premier défaut du panier fait tout perdre.',
      ex: 'Panier de 3 entités, version linéaire : si une seule fait défaut, tu reçois <strong>2/3 du coupon</strong> chaque année et <strong>2/3 du capital</strong> à l\'échéance.',
      vend: 'Une protection sur plusieurs signatures simultanément.',
      piege: 'Sur un first-to-default, plus le panier est large, <strong>plus c\'est dangereux</strong> — exactement l\'inverse de l\'intuition de diversification. Et en récession, les défauts n\'arrivent pas isolément : ils arrivent ensemble.' }
  ];

  function _fiches() {
    var prods = [];
    try { Object.keys((app.state && app.state.proposals) || {}).forEach(function (b) { (app.state.proposals[b] || []).forEach(function (p) { prods.push(p); }); }); } catch (e) {}
    try { ((app.state && app.state.portfolio) || []).forEach(function (p) { prods.push(p); }); } catch (e) {}
    var filt = _open.filter || 'tous';

    var h = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#0891B2"></span>🗂️ Les fiches produit</div>' +
      '<span style="font-size:10px;color:var(--text-dim)">' + FICHES.length + ' types classiques · définition, mécanique, exemple chiffré sur 100 000 €</span></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
      '<button class="btn sm" style="' + (filt === 'tous' ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : '') + '" onclick="window._cmpFilter(\'tous\')">Tous</button>';
    CATS.forEach(function (c) {
      h += '<button class="btn sm" style="' + (filt === c.k ? 'background:' + c.c + ';color:#fff;border-color:' + c.c : 'color:' + c.c) + '" onclick="window._cmpFilter(\'' + c.k + '\')">' + c.l + '</button>';
    });
    h += '</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px">';

    FICHES.filter(function (f) { return filt === 'tous' || f.cat === filt; }).forEach(function (f) {
      var cat = CATS.filter(function (c) { return c.k === f.cat; })[0] || CATS[0];
      h += '<div style="border:1px solid var(--border);border-top:3px solid ' + cat.c + ';border-radius:var(--radius-sm);padding:14px 16px;background:var(--bg-card,var(--bg-elevated))">' +
        '<div style="font-size:9px;letter-spacing:.06em;font-weight:700;color:' + cat.c + ';margin-bottom:3px">' + cat.l.toUpperCase() + '</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--text-bright);line-height:1.25">' + f.nom + '</div>' +
        '<div style="font-size:10px;color:var(--text-dim);font-style:italic;margin-bottom:9px">aussi appelé : ' + f.sous + '</div>' +
        '<div style="font-size:11.5px;line-height:1.6;margin-bottom:9px">' + f.def + '</div>' +
        '<div style="font-size:11px;line-height:1.55;margin-bottom:9px;color:var(--text-muted)"><span style="font-weight:700;color:var(--text)">Comment ça marche · </span>' + f.meca + '</div>' +
        '<div style="font-size:11px;line-height:1.55;padding:9px 11px;background:var(--bg-elevated);border-left:2px solid ' + cat.c + ';border-radius:4px;margin-bottom:9px"><span style="font-size:9px;letter-spacing:.06em;font-weight:700;color:' + cat.c + ';display:block;margin-bottom:3px">EXEMPLE SUR 100 000 €</span>' + f.ex + '</div>' +
        '<div style="font-size:11px;line-height:1.55;margin-bottom:8px"><span style="font-weight:700">Ce que tu vends · </span><span style="color:var(--text-muted)">' + f.vend + '</span></div>' +
        '<div style="font-size:11px;line-height:1.55;padding:9px 11px;background:rgba(232,93,4,0.07);border-left:2px solid var(--orange);border-radius:4px"><span style="color:var(--orange);font-weight:700">⚠ Le piège · </span>' + f.piege + '</div>';
      // Produits du portefeuille rattachés à cette fiche
      var mine = prods.filter(function (p) {
        var t = ((p.name || '') + ' ' + (p.structureType || '') + ' ' + ((p.earlyRedemption || {}).type || '') + ' ' + ((p.coupon || {}).frequency || '')).toLowerCase();
        var n = f.nom.toLowerCase();
        if (/tarn/.test(n)) return /tarn/.test(t);
        if (/range/.test(n)) return /range|accrual/.test(t);
        if (/digitale de taux/.test(n)) return /digital/.test(t) && /tec|euribor|cms/i.test((p.underlyings || []).join(' ') + t);
        if (/digitale actions/.test(n)) return /digital/.test(t) && !/tec|euribor|cms/i.test((p.underlyings || []).join(' ') + t);
        if (/callable in fine|in fine/.test(n)) return /callable/.test(t) && /in_fine|maturit/.test(t);
        if (/callable — coupon annuel/.test(n)) return /callable/.test(t) && !/in_fine|maturit/.test(t);
        if (/phoenix/.test(n)) return /phoenix/.test(t);
        if (/autocall|athena/.test(n)) return /autocall|athena/.test(t) && !/phoenix/.test(t);
        if (/cppi|fonds/.test(n)) return /cppi|coussin|stork|guaranteed note/.test(t);
        if (/cln/.test(n)) return /cln|credit linked|synth/.test(t);
        return false;
      });
      if (mine.length) {
        h += '<div style="margin-top:9px;padding-top:8px;border-top:1px dashed var(--border)"><div style="font-size:9px;letter-spacing:.05em;color:var(--text-dim);margin-bottom:4px">CHEZ TOI</div>';
        mine.slice(0, 5).forEach(function (p) {
          var c = p.coupon || {}, inv = parseFloat(p.investedAmount) || 0;
          h += '<div style="display:flex;justify-content:space-between;gap:8px;font-size:10.5px;padding:2px 0;flex-wrap:wrap"><span>' + _esc((p.name || '?').substring(0, 40)) + (inv > 0 ? ' <span style="color:var(--green);font-size:9px">· détenu</span>' : '') + '</span><span style="font-family:var(--mono);color:var(--text-dim);white-space:nowrap">' + (c.rate ? _fmtP(parseFloat(c.rate)) : '—') + ' · ' + (p.maturityYears || '?') + ' a</span></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    return h + '</div></div>';
  }

  // ── 4. Décodeur ──────────────────────────────────────────────────
  var DECODEUR = [
    ['Athena', 'Autocall standard, coupon lié au rappel'],
    ['Phoenix', 'Autocall avec barrière coupon séparée et plus basse — variante plus favorable'],
    ['Express', 'Autocall (appellation allemande)'],
    ['Fast', 'Première date de rappel avancée (3 à 6 mois) — les frais sont alors très lourds annualisés'],
    ['Mémoire', 'Coupons ratés rattrapés ultérieurement — l\'option la plus utile qu\'on puisse t\'offrir'],
    ['Worst-of (WO)', 'Le plus mauvais titre du panier décide de tout — tu vends de la décorrélation'],
    ['Objectif, Oxygène, Livingstone', 'Noms maison de distributeurs : généralement un autocall ou une digitale sur panier'],
    ['Airbag', 'Sous la barrière, la perte est amortie au lieu d\'être proportionnelle — à chercher activement'],
        ['Bonus', 'Certificat bonus, barrière américaine observée en continu — bien plus risquée'],
            ['Snowball', 'Coupon cumulatif : un mauvais millésime contamine tous les suivants'],
                ['Cliquet, Lock-in', 'Gains périodiques verrouillés définitivement — l\'une des rares mécaniques en ta faveur'],
    ['TARN, Target', 'Remboursement dès que le cumul de coupons atteint la cible'],
    ['Callable, 10NC3', '10 ans, non rappelable 3 ans, puis à la main de l\'émetteur'],
    ['Range Accrual, Corridor, Tunnel', 'Coupon au prorata du temps passé dans une plage'],
    ['Steepener', 'Pari à levier sur la pente de la courbe'],
    ['CLN, Credit Linked, Obligation synthétique', 'Vente de protection sur une entreprise — double risque crédit'],
    ['Décrément', 'Indice amputé d\'un dividende synthétique fixe : il baisse mécaniquement'],
    ['CPPI, gestion à coussin', 'Allocation dynamique — risque de monétarisation : après une forte baisse, le fonds se fige et ne remonte jamais'],
    ['Puttable, fenêtres de sortie', 'C\'est TOI qui peux sortir — le seul produit structurellement favorable, jamais mis en avant']
  ];

  function _decodeur() {
    var h = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#64748B"></span>🔤 Décodeur des noms commerciaux</div></div>' +
      '<div style="font-size:12px;color:var(--text);margin-bottom:10px;max-width:70ch">Les noms sur les brochures sont des marques, pas des mécaniques. Traduction :</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>';
    DECODEUR.forEach(function (d, i) {
      h += '<tr style="border-bottom:1px solid var(--border);' + (i % 2 ? 'background:var(--bg-elevated)' : '') + '">' +
        '<td style="padding:6px 8px;font-weight:600;white-space:nowrap;vertical-align:top">' + d[0] + '</td>' +
        '<td style="padding:6px 8px;color:var(--text-muted)">' + d[1] + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  // ── 5. Les six questions ─────────────────────────────────────────
  var QUESTIONS = [
    ['Qu\'est-ce que je vends ?', 'Une option de rappel, un put à barrière, une protection crédit, de la volatilité de taux ? Si tu ne sais pas le dire en une phrase, tu ne sais pas ce que tu achètes.'],
    ['Qui décide de la durée ?', 'Moi (presque jamais), un mécanisme automatique (TARN, autocall), ou l\'émetteur à sa main (callable) ? Cette réponse détermine dans quel scénario tu te retrouves coincé.'],
    ['Le coupon est-il acquis ou conditionnel ?', 'Combien d\'années garanties, quelle barrière, mémoire ou pas — et surtout <strong>où est le taux de référence aujourd\'hui</strong> par rapport à cette barrière.'],
    ['Le capital : garanti par qui, à quelle date, sous quelle condition ?', '« À l\'échéance » ne veut pas dire « en cours de vie ». « Garanti » veut dire « par la banque », pas par le FGDR — sauf pour un <strong>dépôt structuré</strong>, la seule forme couverte à 100 000 €. Demande toujours s\'il en existe une version dépôt.'],
    ['Combien prend la banque ?', 'La commission affichée, et surtout : <em>à quel prix rachètes-tu le titre demain ?</em> Un produit émis à 100 et coté 98,5 le lendemain a 1,5 point de marge embarquée.'],
    ['Le pire cas bat-il l\'OAT de même durée ?', 'Pas le coupon facial, pas le meilleur scénario : le rendement <strong>acquis</strong>, actuariel, net de frais et d\'IS, face au souverain français. S\'il ne le bat pas, le produit ne paie ni l\'illiquidité ni le risque émetteur.']
  ];

  function _questions() {
    var h = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#059669"></span>✅ Les six questions devant une brochure</div></div>';
    QUESTIONS.forEach(function (q, i) {
      h += '<div style="display:grid;grid-template-columns:28px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="font-family:var(--mono);font-weight:700;color:var(--accent)">' + (i + 1) + '</div>' +
        '<div style="font-size:11.5px;line-height:1.6"><strong style="display:block;margin-bottom:2px;color:var(--text-bright)">' + q[0] + '</strong>' + q[1] + '</div></div>';
    });
    return h + '</div>';
  }

  // Un seul principe — échanger des flux sans échanger le capital — décliné selon
  // ce qu'on met de chaque côté. C'est la question « si le CMS est un swap, il existe
  // quoi d'autre en swap ? », qui revient dès qu'on a compris le premier.
  var SWAPS = [
    ['IRS', 'Swap de taux vanille', 'un taux fixe', 'l\'Euribor 3 ou 6 mois',
     'Le plus courant. Une entreprise s\'en sert pour figer le coût d\'un crédit à taux variable.', true],
    ['OIS', 'Overnight Index Swap', 'un taux fixe', 'l\'€STR composé jour après jour',
     'Aucun risque bancaire à terme dedans : c\'est <strong>la courbe d\'actualisation</strong>, celle qui fixe la valeur de rachat de tes produits.', true],
    ['CMS', 'Constant Maturity Swap', 'un taux fixe', '<strong>le taux swap 10 ans</strong>, relevé à chaque date',
     'La jambe variable n\'est pas un taux court mais un <strong>taux long</strong>, dont la maturité ne raccourcit jamais. Sous-jacent de ton range accrual.', true],
    ['Swaption', 'Option sur swap', 'une prime', 'le droit d\'entrer plus tard dans un swap',
     '<strong>C\'est ce que tu vends dans un callable</strong> : l\'émetteur t\'achète le droit de te rembourser par anticipation. Le coupon élevé, c\'est le prix de cette option.', true],
    ['Basis swap', 'Swap de base', 'un index variable', 'un autre index variable',
     'Euribor 3 mois contre Euribor 6 mois, ou Euribor contre €STR. Sert à mesurer l\'écart entre deux références.', false],
    ['Cross-currency', 'Swap de devises', 'des intérêts en euros', 'des intérêts en dollars',
     'Seule famille où <strong>le capital s\'échange vraiment</strong>, au début et à la fin. Sert à se financer dans une devise et à dépenser dans une autre.', false],
    ['Inflation swap', 'Swap d\'inflation', 'un taux fixe', 'l\'inflation réellement constatée',
     'Le taux fixe qui équilibre l\'échange <em>est</em> l\'inflation anticipée par le marché — le « point mort d\'inflation » qui sert à juger un taux réel.', false],
    ['CDS', 'Credit Default Swap', 'une prime annuelle', 'une indemnité si l\'émetteur fait défaut',
     'Pas un swap de taux malgré le nom. Sa prime <strong>est</strong> le prix du risque de crédit de l\'émetteur — le chiffre à comparer au supplément de coupon qu\'on te propose.', false]
  ];

  function _familleSwaps() {
    var h = '<div style="margin-top:11px;border:1px solid var(--border);border-radius:6px;padding:11px 13px">';
    h += '<div style="font-size:11.5px;font-weight:700;color:var(--text-bright);margin-bottom:3px">Et il existe quoi d\'autre, en swap ?</div>';
    h += '<div style="font-size:11.5px;line-height:1.6;color:var(--text-muted);margin-bottom:9px">Toujours le même principe — <strong>échanger des flux sans échanger le capital</strong>. Ce qui change, c\'est ce qu\'on met de chaque côté. Les quatre premiers te concernent directement.</div>';
    h += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
    h += '<thead><tr style="border-bottom:1px solid var(--border)">' +
      ['', 'Tu paies', 'Tu reçois', 'Où ça te concerne'].map(function (x) {
        return '<th style="text-align:left;padding:5px 8px;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim);white-space:nowrap">' + x + '</th>';
      }).join('') + '</tr></thead><tbody>';
    SWAPS.forEach(function (w, i) {
      h += '<tr style="border-bottom:1px solid var(--border);' + (i % 2 ? 'background:var(--bg-elevated)' : '') + (w[5] ? '' : 'opacity:.72') + '">';
      h += '<td style="padding:6px 8px;vertical-align:top;white-space:nowrap"><strong style="color:' + (w[5] ? '#0F766E' : 'var(--text-muted)') + '">' + w[0] + '</strong><div style="font-size:9.5px;color:var(--text-dim)">' + w[1] + '</div></td>';
      h += '<td style="padding:6px 8px;vertical-align:top;color:var(--text-muted)">' + w[2] + '</td>';
      h += '<td style="padding:6px 8px;vertical-align:top;color:var(--text-muted)">' + w[3] + '</td>';
      h += '<td style="padding:6px 8px;vertical-align:top;color:var(--text)">' + w[4] + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div style="margin-top:9px;font-size:11px;line-height:1.6;color:var(--text-muted)">Deux d\'entre eux changent ta lecture d\'une brochure. La <strong>swaption</strong> : quand on te vante un coupon élevé sur un callable, tu n\'es pas payé pour un risque de marché mais pour <em>une option que tu as vendue</em>. Le <strong>CDS</strong> : sa prime donne le prix de marché du risque de l\'émetteur — si le supplément de coupon qu\'on te propose est inférieur à cette prime, tu prends le risque sans être payé pour.</div>';
    return h + '</div>';
  }

  // ── 0. Les cinq taux, par l'exemple ──────────────────────────────
  // Même matière que l'échelle de la page Marché, mais ici l'entrée se fait par
  // l'exemple : où chaque taux mord concrètement, et en quoi il diffère du voisin.
  // Les niveaux viennent de la courbe du jour ; les exemples sont des cas types.
  function _lesTaux() {
    var y = (_rates && _rates.yields) || {}, pr = (_rates && _rates.policy_rates) || {};
    var sc = (_rates && _rates.short_curve) || {};
    var n = function (o) { return (o && o.current != null) ? parseFloat(o.current) : null; };
    var act = function (r) { return r == null ? null : (Math.exp(r / 100) - 1) * 100; };
    var dep = n(pr.ecb_deposit_rate), estr = n(pr.estr);
    var e3 = n(y.euribor_3m), e12 = n(y.euribor_12m), t10 = n(y.tec10_fr);
    var cms = act(n(sc.curve_120m));   // proxy swap 10 ans, courbe du jour
    var P = _fmtP;

    var T = [
      {
        c: '#7C3AED', nom: 'Taux directeurs BCE', val: dep,
        court: 'Le prix que la BCE fixe pour le cash des banques, au jour le jour.',
        diff: 'C\'est le seul de la liste qui soit <strong>décidé</strong>. Tous les autres sont constatés ou négociés sur un marché.',
        ex: 'Tu places <strong>300 000 €</strong> un an. Laissés à la BCE, ils rapporteraient <strong>7 500 €</strong> — c\'est ce que ta banque obtient sans rien faire. Ton CAT à 3,13 % t\'en verse <strong>9 390 €</strong>. Les <strong>1 890 €</strong> d\'écart sont ce qu\'elle consent pour garder ton dépôt, et la première chose qui disparaîtra si la BCE baisse.'
      },
      {
        c: '#0891B2', nom: '€STR', val: estr,
        court: 'Le taux vraiment payé, hier, sur les prêts d\'une nuit entre banques.',
        diff: 'Même horizon que le taux directeur — une nuit — mais <strong>mesuré au lieu d\'être décidé</strong>. L\'écart entre les deux est un thermomètre de la liquidité bancaire.',
        ex: 'Tu détiens un produit à taux fixe <strong>4 %</strong> émis il y a deux ans et tu veux sortir. La banque n\'actualise pas au taux de l\'époque mais à celui d\'aujourd\'hui. Comme les taux ont monté, ton 4 % vaut moins qu\'un produit neuf : <strong>elle te rachète sous 100</strong>. Même contrat, même coupon — c\'est le taux d\'actualisation qui a bougé.'
      },
      {
        c: '#0284C7', nom: 'Euribor', val: e12,
        court: 'Ce que les banques se prêtent sur 3, 6 ou 12 mois.',
        diff: 'Ce qu\'il ajoute à l\'€STR, c\'est <strong>le temps</strong> : prêter une nuit ne demande aucune anticipation, prêter un an oblige à parier sur toute l\'année de décisions BCE.',
        ex: 'Un crédit d\'entreprise de <strong>500 000 €</strong> indexé « Euribor 3 mois + 1,20 % ». Avec l\'Euribor 3 mois à ' + P(e3) + ', tu paies ' + P(e3 + 1.2) + ', soit <strong>' + (typeof formatNumber === 'function' ? formatNumber(Math.round(500000 * (e3 + 1.2) / 100)) : Math.round(500000 * (e3 + 1.2) / 100)) + ' € par an</strong>. S\'il prend 50 bp, ta charge grimpe de <strong>2 500 €</strong> sans qu\'une ligne du contrat ait changé.'
      },
      {
        c: '#0F766E', nom: 'Swap et CMS', val: cms,
        court: 'Le taux fixe qu\'on échange contre un taux variable, sans que le capital bouge.',
        diff: 'C\'est <strong>la courbe avec laquelle ta banque fabrique ses produits</strong>. Un CMS n\'est pas un autre taux : c\'est ce même taux swap, relevé à une date future.',
        famille: _familleSwaps(),
        ex: '<strong>Le swap :</strong> une entreprise endettée à taux variable dit à sa banque « je te paie ' + P(cms) + ' fixe pendant 10 ans, tu me paies l\'Euribor ». Son crédit devient fixe. <strong>Les capitaux ne bougent jamais</strong> — seuls les intérêts s\'échangent.<br><br><strong>Le CMS :</strong> ce taux change tous les jours. Un « CMS 10 ans » est ce taux swap 10 ans constaté à telle date. <strong>La différence à retenir :</strong> l\'Euribor 3 mois constaté dans cinq ans sera encore un taux à <em>3 mois</em> ; le CMS 10 ans constaté dans cinq ans sera encore un taux à <em>10 ans</em>. Sa maturité ne raccourcit jamais — d\'où « maturité constante ».'
      },
      {
        c: '#047857', nom: 'TEC France (OAT)', val: t10,
        court: 'Ce que l\'État français paie pour emprunter à 10 ans.',
        diff: 'Même durée que le swap, mais ici <strong>on prête vraiment 100 €</strong> à un État pendant dix ans. D\'où l\'écart : ' + (t10 != null && cms != null ? '<strong>' + Math.round((t10 - cms) * 100) + ' bp</strong> au-dessus du swap' : 'le souverain se traite au-dessus du swap') + '.',
        ex: 'Un <strong>TARN TEC 10</strong> verse un coupon si le TEC 10 reste sous 4,40 %. Il est à <strong>' + P(t10) + '</strong> : pas de coupon cette année. Et attention au piège — si tu avais lu « taux 10 ans » sur la courbe swap (' + P(cms) + '), tu aurais conclu l\'inverse. <strong>Regarde toujours quel taux la fiche nomme.</strong>'
      }
    ];

    var h = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#0284C7"></span>🪜 Les cinq taux, par l\'exemple</div></div>' +
      '<div style="font-size:12px;line-height:1.65;color:var(--text);margin-bottom:12px;max-width:72ch">« Le taux à 10 ans » ne veut rien dire tout seul : il en existe plusieurs, qui ne mesurent pas la même chose et ne donnent pas la même réponse. Voici chacun avec l\'endroit précis où il mord.</div>';

    T.forEach(function (t) {
      h += '<div style="border:1px solid var(--border);border-left:3px solid ' + t.c + ';border-radius:8px;padding:12px 14px;margin-bottom:9px">';
      h += '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px">';
      h += '<span style="font-size:13px;font-weight:700;color:var(--text-bright)">' + t.nom + '</span>';
      if (t.val != null) h += '<span style="font-family:var(--mono);font-size:15px;font-weight:700;color:' + t.c + '">' + P(t.val) + '</span>';
      h += '</div>';
      h += '<div style="font-size:11.5px;line-height:1.6;color:var(--text);margin-bottom:6px">' + t.court + '</div>';
      h += '<div style="font-size:11.5px;line-height:1.6;color:var(--text-muted);margin-bottom:9px"><strong style="color:' + t.c + '">Ce qui le distingue :</strong> ' + t.diff + '</div>';
      h += '<div style="border:1px dashed var(--border);border-radius:6px;padding:10px 12px;font-size:11.5px;line-height:1.65;color:var(--text)">';
      h += '<div style="font-size:9px;letter-spacing:.07em;text-transform:uppercase;font-weight:700;color:' + t.c + ';margin-bottom:4px">Un exemple concret</div>' + t.ex + '</div>';
      if (t.famille) h += t.famille;
      h += '</div>';
    });

    h += '<div style="font-size:11.5px;line-height:1.65;color:var(--text-muted);padding:10px 12px;background:var(--bg-elevated);border-radius:6px">';
    h += '<strong style="color:var(--text-bright)">La règle qui évite l\'erreur la plus chère.</strong> Avant de juger une barrière, regarde <strong>quel taux la fiche produit nomme</strong> — TEC, CMS, Euribor — et va chercher celui-là. Deux taux « 10 ans » peuvent différer de plus de 100 bp, ce qui suffit à inverser la conclusion sur un coupon.';
    h += '</div></div>';
    return h;
  }

  // ── Rendu ────────────────────────────────────────────────────────
  window._cmpToggle = function (id) { _open[id] = !_open[id]; renderComprendre(document.getElementById('main-content')); };
  window._cmpFilter = function (k) { _open.filter = k; renderComprendre(document.getElementById('main-content')); };

  window.renderComprendre = function (container) {
    if (!container) return;
    var head = '<div class="section" style="border-left:3px solid var(--accent)"><div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:4px">Comprendre ce qu\'on te propose</div>' +
      '<div style="font-size:12px;line-height:1.65;color:var(--text);max-width:72ch">Tout produit structuré est un prêt à une banque <em>plus</em> une option que tu lui vends. Le coupon est le prix de cette option — jamais une générosité, jamais une conviction de la banque sur le sous-jacent. Cette page te donne la mécanique de chaque famille, le test qui les départage, et la traduction des noms commerciaux.</div></div>';
    if (!_rates) {
      container.innerHTML = head + '<div class="section" style="font-size:12px;color:var(--text-dim)">Chargement de la courbe des taux…</div>';
      github.readFile('data/market/rates.json').then(function (r) { _rates = r; renderComprendre(container); }).catch(function () {
        container.innerHTML = head + _lesTaux() + _briques() + _fiches() + _decodeur() + _questions();
      });
      return;
    }
    container.innerHTML = head + _lesTaux() + _echelle() + _testSouverain() + _briques() + _fiches() + _decodeur() + _questions();
  };
})();

// ═══════════════════════════════════════════════════════════════════
// COMPRENDRE — page de référence sur les produits structurés
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
  var FAMILLES = [
    { id: 'cat', tag: 'SANS RISQUE', col: '#059669', nom: 'Compte à terme — fixe, progressif, à préavis',
      vend: 'Rien. C\'est le seul support de la liste où tu ne cèdes aucune option.',
      meca: 'Tu bloques une somme pour une durée convenue. <strong>Fixe</strong> : un taux unique. <strong>Progressif</strong> : des paliers croissants, avec sortie libre à chaque fin de palier — le taux affiché est une moyenne actuarielle, jamais le taux du dernier palier. <strong>À préavis</strong> : sortie possible hors échéance moyennant 32 jours de préavis et une rémunération réduite.',
      piege: 'Le taux n\'est que la moitié du sujet : les <strong>conditions de sortie anticipée</strong> varient énormément d\'une banque à l\'autre (0 % les trois premiers mois puis 50 % chez l\'une, minoration de 90/60/30 % chez l\'autre, aucune pénalité chez une troisième). À taux égal, c\'est ce qui départage les offres. Et le FGDR ne couvre que 100 000 € par banque et par société.',
      match: function (p) { return false; } },
    { id: 'oblig', tag: 'SANS RISQUE', col: '#0891B2', nom: 'Obligation d\'État et obligation corporate',
      vend: 'Rien non plus — tu prêtes, simplement.',
      meca: 'Tu achètes un titre coté. Il te verse un coupon et te rend le pair à l\'échéance. Entre-temps sa valeur bouge avec les taux : elle baisse quand les taux montent, et inversement.',
      piege: 'La valeur de marché inquiète à tort : si tu tiens jusqu\'à l\'échéance, tu récupères le pair, exactement comme sur un EMTN — à la différence que l\'obligation d\'État, elle, est <strong>vendable tous les jours sur un marché profond</strong>. Pour une société, la moins-value latente peut toutefois imposer une provision à la clôture : à valider avec l\'expert-comptable selon la classification comptable retenue.',
      match: function (p) { return false; } },
    { id: 'callable', tag: 'TAUX', col: '#0891B2', nom: 'Callable — l\'émetteur choisit la durée',
      vend: 'Une option de rappel bermudéenne. Elle vaut 30 à 60 bp par an.',
      meca: 'À partir de l\'année N, la banque peut te rembourser quand ça l\'arrange. Elle rappelle si elle peut se refinancer moins cher, donc <strong>quand les taux baissent</strong> — tu réinvestis plus bas. Elle ne rappelle pas quand les taux montent : tu restes coincé sous le marché.',
      piege: 'Perdant dans les deux sens. C\'est normal et c\'est le prix du coupon — la question est seulement « suis-je assez payé ? ». Le seuil : coupon ≥ taux fixe non rappelable de même durée + la valeur de l\'option.',
      match: function (p) { var er = p.earlyRedemption || {}; return er.type === 'callable'; } },
    { id: 'tarn', tag: 'TAUX', col: '#0891B2', nom: 'TARN — cible de coupons cumulés',
      vend: 'La durée et la conditionnalité ensemble.',
      meca: 'Coupons garantis N années, puis payés seulement si le taux de référence reste sous une barrière. Remboursement automatique dès que le <strong>cumul</strong> des coupons atteint la cible.',
      piege: 'Asymétrie totale : taux bas → cible atteinte vite → remboursé quand tu voulais rester. Taux hauts → coupons perdus → cible jamais atteinte → immobilisé jusqu\'au terme sans rien toucher. Regarde toujours où est le taux de référence <em>aujourd\'hui</em> par rapport à la barrière.',
      match: function (p) { var er = p.earlyRedemption || {}; return er.type === 'tarn' || (er.targetCouponLevel > 0); } },
    { id: 'range', tag: 'TAUX', col: '#0891B2', nom: 'Range accrual — coupon au prorata du temps',
      vend: 'De la volatilité de taux : tu paries sur l\'immobilité.',
      meca: 'Le coupon n\'est pas binaire : tu touches <span class="mono">taux facial × (jours dans le corridor ÷ jours totaux)</span>.',
      piege: 'L\'écart le plus grand du catalogue entre l\'affiche et le réel. 4,20 % affiché avec un corridor tenu 55 % du temps = 2,31 % encaissés. Demande toujours le pourcentage de temps historiquement passé dans le corridor, sur 5 et 10 ans.',
      match: function (p) { return /range|accrual|corridor/i.test(p.name || '') || /range/i.test(p.structureType || ''); } },
    { id: 'digitale', tag: 'TAUX', col: '#0891B2', nom: 'Digitale — tout ou rien',
      vend: 'Une option binaire sur un seuil.',
      meca: 'Coupon plein ou zéro selon la position du sous-jacent face à un seuil, à chaque observation annuelle.',
      piege: 'La variante décisive est la <strong>mémoire</strong> : avec elle, les coupons ratés sont rattrapés dès qu\'une observation repasse du bon côté ; sans elle, ils sont perdus définitivement. Sur une digitale actions, un seuil à 100 % du niveau initial est une condition dure — il faut que le titre n\'ait pas baissé du tout.',
      match: function (p) { return /digital/i.test((p.name || '') + (p.structureType || '')); } },
    { id: 'infine', tag: 'TAUX', col: '#0891B2', nom: 'In fine / zéro-coupon — rien avant la fin',
      vend: 'La disponibilité de tes flux pendant toute la vie du produit.',
      meca: 'Aucun coupon versé ; remboursement à 100 + gain cumulé, souvent en intérêt <strong>simple</strong> — le rendement actuariel baisse alors avec la durée.',
      piege: 'Double peine pour une société à l\'IS : la prime de remboursement est imposée <strong>chaque année sur les intérêts courus</strong>, alors que tu n\'encaisses rien. Tu paies l\'impôt avant de toucher l\'argent. Et 4,82 %/an d\'intérêt simple sur 10 ans, ce n\'est pas 4,82 % : c\'est 4,02 % actuariel.',
      match: function (p) { var c = p.coupon || {}; return /in_fine|maturit/i.test(String(c.frequency || '')) || c.paymentTiming === 'at_redemption'; } },
    { id: 'autocall', tag: 'ACTIONS', col: '#7C3AED', nom: 'Autocall / Athena / Phoenix',
      vend: 'Un put à barrière, et ta participation à la hausse.',
      meca: 'À chaque observation, si le sous-jacent dépasse le seuil : remboursement + coupons, fin du produit. Sinon on continue. À l\'échéance, capital rendu si le sous-jacent est au-dessus de la barrière. <strong>Phoenix</strong> ajoute une barrière coupon distincte et plus basse : tu peux toucher des coupons même si le titre a beaucoup baissé.',
      piege: 'Le vrai risque n\'est pas le coupon, c\'est la barrière capital. Et sur un <strong>worst-of</strong>, c\'est le plus mauvais titre du panier qui décide de tout : passer de 1 à 4 sous-jacents peut doubler la probabilité de toucher la barrière, à barrière identique. C\'est le mécanisme qui gonfle le plus les coupons.',
      match: function (p) { var er = p.earlyRedemption || {}; return er.type === 'autocall' || /autocall|athena|phoenix/i.test((p.name || '') + (p.structureType || '')); } },
    { id: 'cppi', tag: 'FONDS', col: '#B45309', nom: 'Note à capital garanti sur fonds (CPPI, gestion à coussin)',
      vend: 'La participation, contre une garantie mécanique et non contractuelle.',
      meca: 'Le gérant répartit en permanence entre un actif risqué et du monétaire, en gardant un « coussin » suffisant pour ramener 100 % à l\'échéance. Plus le coussin s\'épaissit, plus il investit dans le risqué ; plus il s\'amincit, plus il se réfugie en monétaire.',
      piege: '<strong>Le risque de monétarisation.</strong> Après une forte baisse précoce, le coussin disparaît : le fonds se fige définitivement en monétaire et ne profitera d\'aucun rebond. Tu conserves ton capital, mais tu immobilises plusieurs années pour un rendement nul. Regarde aussi les frais de sortie anticipée (souvent 1 %) et le fait qu\'un objectif de rendement (« €STR + 3 % ») n\'est jamais un engagement.',
      match: function (p) { return /cppi|coussin|stork|guaranteed note|fonds/i.test((p.name || '') + (p.structureType || '')); } },
    { id: 'credit', tag: 'CRÉDIT', col: '#C2410C', nom: 'CLN / indice crédit — tu assures une entreprise',
      vend: 'Une protection contre la faillite d\'une ou plusieurs entreprises. Ton coupon est la prime d\'assurance.',
      meca: 'En l\'absence d\'événement de crédit, tu touches le coupon et récupères ton capital. Sinon, coupon et capital sont réduits au prorata des entités en défaut — ou totalement perdus s\'il s\'agit d\'un <em>first-to-default</em>.',
      piege: '<strong>Double risque crédit</strong> : l\'émetteur du titre <em>et</em> l\'entreprise de référence. « Capital garanti » veut dire ici « garanti par l\'émetteur, sauf événement de crédit sur la référence » — ce n\'est pas la garantie d\'un CAT. Le test : le coupon face au spread CDS de la même signature à la même maturité, et face à l\'OAT. Un CLN à 3,90 % sur du BBB− quand l\'État paie 4,00 % ne rémunère rien du tout.',
      match: function (p) { return /cln|credit linked|crédit/i.test((p.name || '') + (p.structureType || '')) && !/capital/i.test(p.structureType || ''); } }
  ];

  function _familles() {
    var prods = [];
    try { Object.keys((app.state && app.state.proposals) || {}).forEach(function (b) { (app.state.proposals[b] || []).forEach(function (p) { prods.push(p); }); }); } catch (e) {}
    try { ((app.state && app.state.portfolio) || []).forEach(function (p) { prods.push(p); }); } catch (e) {}

    var h = '<div class="section"><div class="section-header"><div class="section-title"><span class="dot" style="background:#0891B2"></span>📚 Les familles de produits</div>' +
      '<span style="font-size:10px;color:var(--text-dim)">clique pour déplier · tes produits sont rattachés à leur famille</span></div>';
    FAMILLES.forEach(function (f) {
      var mine = prods.filter(function (p) { try { return f.match(p); } catch (e) { return false; } });
      var open = !!_open[f.id];
      h += '<div style="border:1px solid var(--border);border-left:3px solid ' + f.col + ';border-radius:var(--radius-sm);margin-bottom:8px;overflow:hidden">' +
        '<div onclick="window._cmpToggle(\'' + f.id + '\')" style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--bg-elevated)">' +
        '<span style="color:var(--text-dim);font-size:10px;width:10px">' + (open ? '▾' : '▸') + '</span>' +
        '<span style="font-size:9px;letter-spacing:.06em;font-weight:700;color:' + f.col + '">' + f.tag + '</span>' +
        '<strong style="font-size:12.5px;color:var(--text-bright)">' + f.nom + '</strong>' +
        (mine.length ? '<span style="margin-left:auto;font-size:10px;color:var(--text-dim)">' + mine.length + ' produit' + (mine.length > 1 ? 's' : '') + ' chez toi</span>' : '<span style="margin-left:auto;font-size:10px;color:var(--text-dim)">—</span>') +
        '</div>';
      if (open) {
        h += '<div style="padding:12px 16px;font-size:11.5px;line-height:1.6">' +
          '<div style="margin-bottom:8px"><span style="color:var(--text-dim);font-weight:600">Ce que tu vends · </span>' + f.vend + '</div>' +
          '<div style="margin-bottom:8px"><span style="color:var(--text-dim);font-weight:600">Mécanique · </span>' + f.meca + '</div>' +
          '<div style="padding:9px 11px;background:rgba(232,93,4,0.07);border-left:2px solid var(--orange);border-radius:4px"><span style="color:var(--orange);font-weight:600">Le piège · </span>' + f.piege + '</div>';
        if (mine.length) {
          h += '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border)"><div style="font-size:10px;color:var(--text-dim);margin-bottom:5px">DANS TON PORTEFEUILLE OU TES PROPOSITIONS</div>';
          mine.forEach(function (p) {
            var c = p.coupon || {}, inv = parseFloat(p.investedAmount) || 0;
            h += '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:11px;flex-wrap:wrap"><span>' + _esc((p.name || '?').substring(0, 46)) + (inv > 0 ? ' <span style="font-size:9px;color:var(--green)">· détenu</span>' : '') + '</span>' +
              '<span style="font-family:var(--mono);color:var(--text-dim);white-space:nowrap">' + (c.rate ? _fmtP(parseFloat(c.rate)) : '—') + (c.trigger && c.trigger < 20 ? ' si ≤ ' + _fmtP(parseFloat(c.trigger)) : '') + ' · ' + (p.maturityYears || '?') + ' a</span></div>';
          });
          h += '</div>';
        }
        h += '</div>';
      }
      h += '</div>';
    });
    return h + '</div>';
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

  // ── Rendu ────────────────────────────────────────────────────────
  window._cmpToggle = function (id) { _open[id] = !_open[id]; renderComprendre(document.getElementById('main-content')); };

  window.renderComprendre = function (container) {
    if (!container) return;
    var head = '<div class="section" style="border-left:3px solid var(--accent)"><div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:4px">Comprendre ce qu\'on te propose</div>' +
      '<div style="font-size:12px;line-height:1.65;color:var(--text);max-width:72ch">Tout produit structuré est un prêt à une banque <em>plus</em> une option que tu lui vends. Le coupon est le prix de cette option — jamais une générosité, jamais une conviction de la banque sur le sous-jacent. Cette page te donne la mécanique de chaque famille, le test qui les départage, et la traduction des noms commerciaux.</div></div>';
    if (!_rates) {
      container.innerHTML = head + '<div class="section" style="font-size:12px;color:var(--text-dim)">Chargement de la courbe des taux…</div>';
      github.readFile('data/market/rates.json').then(function (r) { _rates = r; renderComprendre(container); }).catch(function () {
        container.innerHTML = head + _briques() + _familles() + _decodeur() + _questions();
      });
      return;
    }
    container.innerHTML = head + _echelle() + _testSouverain() + _briques() + _familles() + _decodeur() + _questions();
  };
})();

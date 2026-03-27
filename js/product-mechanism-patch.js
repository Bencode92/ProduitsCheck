// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Product Mechanism Patch v1.1
// v1.1: Concrete examples for each structure type
//       + better auto-detection from product data
//       + auto-sets structureType on product if detected
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var MECHANISM_DESCRIPTIONS = {
        autocall: {
            title: 'Autocall / Phoenix',
            icon: '\ud83d\udd04',
            color: '#3B82F6',
            description: 'Aux dates d\u2019observation, si le sous-jacent cl\u00f4ture au-dessus du seuil de rappel (ex: 100% du strike), le produit est rembours\u00e9 par anticipation avec le coupon cumul\u00e9. Si le SJ reste au-dessus de la barri\u00e8re coupon, le coupon p\u00e9riodique est vers\u00e9. \u00c0 maturit\u00e9, si le SJ est sous la barri\u00e8re capital, perte proportionnelle \u00e0 la baisse.',
            example: null, // will be built dynamically from product data
            keyPoints: ['Coupon conditionnel (SJ > barri\u00e8re)', 'Rappel anticip\u00e9 possible', 'Risque de perte en capital si barri\u00e8re touch\u00e9e']
        },
        phoenix_memoire: {
            title: 'Phoenix \u00e0 m\u00e9moire',
            icon: '\ud83e\udde0',
            color: '#8B5CF6',
            description: 'M\u00eame m\u00e9canisme qu\u2019un autocall, mais les coupons non vers\u00e9s sont \u00ab\u202fmis en m\u00e9moire\u202f\u00bb et rattrap\u00e9s d\u00e8s que le sous-jacent repasse au-dessus de la barri\u00e8re. Cela r\u00e9duit le risque de perte de coupons en cas de baisse temporaire.',
            example: null,
            keyPoints: ['Coupons non pay\u00e9s sont rattrap\u00e9s', 'Plus protecteur que le Phoenix classique', 'M\u00eame risque capital qu\u2019un autocall']
        },
        dispersion: {
            title: 'Dispersion / Performance relative',
            icon: '\ud83d\udcc8',
            color: '#06D6A0',
            description: 'Le rendement d\u00e9pend de la DIFF\u00c9RENCE de performance entre paires d\u2019actions \u2014 pas de leur performance absolue. Plus les actions divergent, plus le rendement est \u00e9lev\u00e9. Le capital est garanti \u00e0 100%.',
            example: null,
            keyPoints: ['Capital 100% garanti \u00e0 maturit\u00e9', 'La volatilit\u00e9 est un ATOUT (augmente la dispersion)', 'Rendement = participation \u00d7 dispersion moyenne', 'Risque principal : rendement faible si actions corr\u00e9l\u00e9es']
        },
        taux_fixe: {
            title: 'Taux fixe / Callable',
            icon: '\ud83c\udfdb',
            color: '#3B82F6',
            description: 'Placement \u00e0 taux fixe garanti, ind\u00e9pendant de tout march\u00e9. Le coupon est pay\u00e9 r\u00e9guli\u00e8rement sans condition. Si callable, l\u2019\u00e9metteur peut rembourser avant maturit\u00e9 (g\u00e9n\u00e9ralement quand les taux baissent).',
            example: null,
            keyPoints: ['Coupon fixe garanti', 'Pas de risque march\u00e9', 'Risque de rappel anticip\u00e9 si callable', 'Comparer au taux BCE']
        },
        capital_garanti: {
            title: 'Capital garanti structur\u00e9',
            icon: '\ud83d\udee1',
            color: '#06D6A0',
            description: 'Capital 100% garanti \u00e0 maturit\u00e9. Le rendement d\u00e9pend de la performance du sous-jacent mais la perte en capital est impossible (hors d\u00e9faut \u00e9metteur). En contrepartie, le rendement est g\u00e9n\u00e9ralement plus modeste.',
            example: null,
            keyPoints: ['Z\u00e9ro risque de perte en capital', 'Rendement potentiellement limit\u00e9', 'Risque \u00e9metteur uniquement']
        },
        reverse: {
            title: 'Reverse convertible',
            icon: '\u26a0',
            color: '#EF4444',
            description: 'Coupon \u00e9lev\u00e9 en \u00e9change d\u2019un risque de perte en capital. L\u2019investisseur vend implicitement une option put. Si le SJ baisse fortement, le remboursement est calcul\u00e9 sur la performance du SJ.',
            example: null,
            keyPoints: ['Coupon \u00e9lev\u00e9 mais risque asym\u00e9trique', 'Gain plafonn\u00e9 / perte potentiellement forte', 'Plus le coupon est haut, plus le risque est \u00e9lev\u00e9']
        },
        twin_win: {
            title: 'Twin-Win',
            icon: '\u2194',
            color: '#8B5CF6',
            description: 'Le produit gagne que le SJ monte OU baisse, tant qu\u2019il reste au-dessus de la barri\u00e8re. Id\u00e9al en march\u00e9 volatil.',
            example: null,
            keyPoints: ['Gain dans les deux directions', 'Id\u00e9al en march\u00e9 range-bound', 'Barri\u00e8re = point de bascule critique']
        },
        participation: {
            title: 'Participation / Bonus',
            icon: '\ud83d\udcc8',
            color: '#06D6A0',
            description: 'Participation \u00e0 la hausse du SJ (souvent avec un multiplicateur) et protection partielle ou totale \u00e0 la baisse.',
            example: null,
            keyPoints: ['Participation \u00e0 la hausse', 'Protection partielle ou totale', 'Cap \u00e9ventuel sur le rendement max']
        }
    };

    // ═══ AUTO-DETECT structure type from ALL available product data ═══
    window._autoDetectStructureType = function(product) {
        // 1. Explicit field
        if (product.structureType) return product.structureType;

        var name = (product.name || '').toLowerCase();
        var allText = name + ' ' + ((product.underlyings || []).join(' ')).toLowerCase();
        var couponType = (product.coupon?.type || '').toLowerCase();
        var aiParsed = product.aiParsed || {};
        var aiText = JSON.stringify(aiParsed).toLowerCase();
        var mechanism = (product.mechanism || aiParsed.mechanism || '').toLowerCase();
        var rawText = (product.rawText || '').toLowerCase().substring(0, 3000);

        // Dispersion detection (multiple signals)
        if (aiParsed.structureType === 'dispersion') return 'dispersion';
        if (name.indexOf('dispers') >= 0 || name.indexOf('perf relative') >= 0 || name.indexOf('performance relative') >= 0) return 'dispersion';
        if (name.indexOf('paire') >= 0 || name.indexOf('pairs') >= 0) return 'dispersion';
        if (mechanism.indexOf('performance relative') >= 0 || mechanism.indexOf('diff\u00e9rence de performance') >= 0) return 'dispersion';
        if (rawText.indexOf('performance relative') >= 0 && rawText.indexOf('paire') >= 0) return 'dispersion';
        if (aiParsed.nPairs > 0 || product.nPairs > 0) return 'dispersion';
        if (aiParsed.participationRate && !product.capitalProtection?.barrier) return 'dispersion';
        // "Court terme boost\u00e9e" with pairs of tech stocks = dispersion
        if (name.indexOf('boost\u00e9e') >= 0 && name.indexOf('panier') >= 0) return 'dispersion';

        // Twin-win
        if (name.indexOf('twin') >= 0 && name.indexOf('win') >= 0) return 'twin_win';

        // Reverse
        if (name.indexOf('reverse') >= 0) return 'reverse';

        // Taux fixe / Callable
        if (couponType === 'fixe' || couponType === 'garanti') {
            if (name.indexOf('callable') >= 0 || name.indexOf('taux fixe') >= 0 || name.indexOf('note taux') >= 0) return 'taux_fixe';
            // Fixed rate with no underlyings = taux fixe
            if (!product.underlyings || product.underlyings.length === 0) return 'taux_fixe';
        }

        // Participation / Bonus
        if (name.indexOf('participation') >= 0 || name.indexOf('bonus') >= 0) return 'participation';

        // Phoenix \u00e0 m\u00e9moire
        if ((name.indexOf('phoenix') >= 0 || name.indexOf('m\u00e9moire') >= 0 || name.indexOf('memoire') >= 0) && (product.coupon?.memory === true)) return 'phoenix_memoire';

        // Capital garanti without barrier
        var protection = product.capitalProtection;
        if (protection && (protection.level === 100 || protection.protected === true)) {
            if (!protection.barrier || protection.barrier >= 100) return 'capital_garanti';
        }

        // Autocall (most common default)
        if (name.indexOf('autocall') >= 0 || name.indexOf('phoenix') >= 0 || name.indexOf('athena') >= 0) return 'autocall';
        if (product.earlyRedemption?.possible === true || product.earlyRedemption?.hasAutocall === true) return 'autocall';

        return '';
    };

    // ═══ BUILD CONCRETE EXAMPLE from product data ═══
    function _buildExample(product, structType) {
        var coupon = product.coupon?.rate || 0;
        var barrier = product.capitalProtection?.barrier || 60;
        var maturity = product.maturity || '5 ans';
        var sj = (product.underlyings || [])[0] || 'Sous-jacent';
        var participation = product.participationRate || coupon;
        var amount = 100000;

        switch(structType) {
            case 'autocall':
                var semestrialCoupon = coupon;
                var freq = (product.coupon?.frequency || '').toLowerCase();
                if (freq.indexOf('semestr') >= 0) semestrialCoupon = coupon; // already per period
                var annualCoupon = freq.indexOf('semestr') >= 0 ? coupon * 2 : coupon;
                return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-top:10px">' +
                    '<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">\ud83d\udca1 Exemple concret (investissement ' + formatNumber(amount) + '\u20ac)</div>' +
                    '<div style="font-size:12px;line-height:1.8;color:var(--text)">' +
                    '<strong>Sc\u00e9nario favorable</strong> \u2014 ' + sj + ' au-dessus de ' + (product.earlyRedemption?.trigger || 100) + '% au bout de 1 an :<br>' +
                    '\u2192 Rappel anticip\u00e9 : vous recevez <span style="color:var(--green);font-weight:700">' + formatNumber(amount) + '\u20ac + ' + formatNumber(Math.round(amount * annualCoupon / 100)) + '\u20ac de coupon</span> = ' + formatNumber(amount + Math.round(amount * annualCoupon / 100)) + '\u20ac<br><br>' +
                    '<strong>Sc\u00e9nario d\u00e9favorable</strong> \u2014 ' + sj + ' \u00e0 -50% \u00e0 maturit\u00e9 (sous barri\u00e8re ' + barrier + '%) :<br>' +
                    '\u2192 Perte en capital : vous recevez <span style="color:var(--red);font-weight:700">' + formatNumber(amount / 2) + '\u20ac</span> (perte de ' + formatNumber(amount / 2) + '\u20ac)' +
                    '</div></div>';

            case 'phoenix_memoire':
                return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-top:10px">' +
                    '<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">\ud83d\udca1 Exemple m\u00e9moire (investissement ' + formatNumber(amount) + '\u20ac)</div>' +
                    '<div style="font-size:12px;line-height:1.8;color:var(--text)">' +
                    '<strong>Ann\u00e9e 1</strong> \u2014 SJ \u00e0 -15% (sous barri\u00e8re coupon) : coupon <span style="color:var(--orange)">non vers\u00e9 (mis en m\u00e9moire)</span><br>' +
                    '<strong>Ann\u00e9e 2</strong> \u2014 SJ remonte \u00e0 +5% : <span style="color:var(--green);font-weight:700">2 coupons vers\u00e9s d\u2019un coup</span> = ' + formatNumber(Math.round(amount * coupon / 100 * 2)) + '\u20ac<br>' +
                    '\u2192 Le m\u00e9canisme m\u00e9moire \u00e9vite de perdre les coupons lors des baisses temporaires' +
                    '</div></div>';

            case 'dispersion':
                return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-top:10px">' +
                    '<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">\ud83d\udca1 Exemple concret (investissement ' + formatNumber(amount) + '\u20ac, participation ' + participation + '%)</div>' +
                    '<div style="font-size:12px;line-height:1.8;color:var(--text)">' +
                    '<strong>Paire 1</strong> : NVIDIA +40%, Apple -10% \u2192 diff\u00e9rence = <strong>50%</strong><br>' +
                    '<strong>Paire 2</strong> : Tesla +20%, Microsoft +5% \u2192 diff\u00e9rence = <strong>15%</strong><br>' +
                    'Dispersion moyenne = (50% + 15%) / 2 = <strong>32.5%</strong><br>' +
                    'Rendement = ' + participation + '% \u00d7 32.5% = <span style="color:var(--green);font-weight:700">+' + (participation * 32.5 / 100).toFixed(2) + '%</span><br>' +
                    'Vous recevez : <span style="color:var(--green);font-weight:700">' + formatNumber(amount) + '\u20ac + ' + formatNumber(Math.round(amount * participation * 32.5 / 10000)) + '\u20ac = ' + formatNumber(amount + Math.round(amount * participation * 32.5 / 10000)) + '\u20ac</span><br><br>' +
                    '<span style="color:var(--text-dim)">M\u00eame si les 2 actions baissent (NVIDIA -5%, Apple -30%) \u2192 diff\u00e9rence = 25% \u2192 rendement positif !<br>' +
                    'Seul cas d\u00e9favorable : toutes les actions font la m\u00eame perf \u2192 diff\u00e9rence \u2248 0% \u2192 rendement \u2248 0% (mais capital garanti)</span>' +
                    '</div></div>';

            case 'taux_fixe':
                return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-top:10px">' +
                    '<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">\ud83d\udca1 Exemple concret (investissement ' + formatNumber(amount) + '\u20ac \u00e0 ' + coupon + '%)</div>' +
                    '<div style="font-size:12px;line-height:1.8;color:var(--text)">' +
                    'Chaque ann\u00e9e vous recevez <span style="color:var(--green);font-weight:700">' + formatNumber(Math.round(amount * coupon / 100)) + '\u20ac</span> de coupon garanti, quoi qu\u2019il arrive sur les march\u00e9s.<br>' +
                    'Sur ' + maturity + ' (si non rappel\u00e9) : total coupons = <span style="color:var(--green);font-weight:700">' + formatNumber(Math.round(amount * coupon / 100 * (parseInt(maturity) || 5))) + '\u20ac</span><br>' +
                    '<span style="color:var(--text-dim)">Si callable : l\u2019\u00e9metteur peut rembourser plus t\u00f4t \u2192 vous r\u00e9cup\u00e9rez le capital mais arr\u00eatez de recevoir le coupon</span>' +
                    '</div></div>';

            case 'reverse':
                return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-top:10px">' +
                    '<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">\ud83d\udca1 Exemple concret (investissement ' + formatNumber(amount) + '\u20ac)</div>' +
                    '<div style="font-size:12px;line-height:1.8;color:var(--text)">' +
                    '<strong>Si SJ > barri\u00e8re ' + barrier + '%</strong> \u2192 Vous recevez <span style="color:var(--green);font-weight:700">' + formatNumber(amount) + '\u20ac + coupon ' + coupon + '%</span><br>' +
                    '<strong>Si SJ < barri\u00e8re ' + barrier + '%</strong> (ex: -50%) \u2192 Remboursement = <span style="color:var(--red);font-weight:700">' + formatNumber(amount / 2) + '\u20ac</span> + coupon<br>' +
                    '<span style="color:var(--orange)">\u26a0 Gain plafonn\u00e9 au coupon, perte potentiellement illimit\u00e9e</span>' +
                    '</div></div>';

            default:
                return '';
        }
    }

    // ═══ Override renderProductSheet to inject mechanism section ═══
    var _waitUI = setInterval(function() {
        if (typeof renderProductSheet !== 'function') return;
        clearInterval(_waitUI);

        var _origRender = renderProductSheet;
        renderProductSheet = function(container, state) {
            _origRender(container, state);
            var p = state.currentProduct;
            if (!p) return;

            // Auto-detect structureType if not set
            var structType = _autoDetectStructureType(p);
            // Persist on product if detected (so grader can use it)
            if (structType && !p.structureType) {
                p.structureType = structType;
                console.log('[MechanismPatch] Auto-detected structureType: ' + structType);
            }

            var mechanism = p.mechanism || (p.aiParsed ? p.aiParsed.mechanism : '') || '';
            var histSim = p.historicalSimulations || (p.aiParsed ? p.aiParsed.historicalSimulations : null);

            var mechHTML = _buildMechanismHTML(p, structType, mechanism, histSim);
            if (!mechHTML) return;

            var sheetLayout = container.querySelector('.sheet-layout');
            if (sheetLayout) {
                var mechDiv = document.createElement('div');
                mechDiv.innerHTML = mechHTML;
                sheetLayout.parentNode.insertBefore(mechDiv.firstElementChild, sheetLayout);
            }
        };
        console.log('[MechanismPatch] v1.1 — examples + auto-detect');
    }, 300);
    setTimeout(function() { clearInterval(_waitUI); }, 12000);

    function _buildMechanismHTML(product, structType, mechanism, histSim) {
        var info = MECHANISM_DESCRIPTIONS[structType];
        if (!info && !mechanism) return '';

        var title = info ? info.title : 'M\u00e9canisme';
        var icon = info ? info.icon : '\u2699';
        var color = info ? info.color : 'var(--accent)';
        var desc = mechanism || (info ? info.description : '');
        var keyPoints = info ? info.keyPoints : [];

        var html = '<div class="fiche-section" style="margin-bottom:20px">';
        html += '<div class="fiche-section-header"><span class="fiche-section-icon">' + icon + '</span><span class="fiche-section-title">Comment \u00e7a marche</span>';
        html += '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;background:' + color + '18;color:' + color + ';border:1px solid ' + color + '33;margin-left:8px;text-transform:uppercase">' + title + '</span>';
        html += '</div><div class="fiche-section-body">';

        // Description
        html += '<div style="padding:14px 16px;background:' + color + '08;border:1px solid ' + color + '20;border-radius:var(--radius-sm);margin-bottom:12px">';
        html += '<p style="margin:0;font-size:13px;line-height:1.6;color:var(--text-bright)">' + desc + '</p></div>';

        // Key points
        if (keyPoints.length > 0) {
            html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">';
            keyPoints.forEach(function(pt) {
                var pc = pt.indexOf('risque') >= 0 || pt.indexOf('Risque') >= 0 || pt.indexOf('perte') >= 0 ? 'var(--orange)' : pt.indexOf('garanti') >= 0 || pt.indexOf('ATOUT') >= 0 || pt.indexOf('Z\u00e9ro') >= 0 ? 'var(--green)' : 'var(--text-muted)';
                html += '<span style="display:inline-block;padding:4px 10px;border-radius:8px;font-size:10px;font-weight:500;background:var(--bg-elevated);border:1px solid var(--border);color:' + pc + '">' + pt + '</span>';
            });
            html += '</div>';
        }

        // Historical simulations
        if (histSim && (histSim.median || histSim.mean)) {
            html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px">';
            if (histSim.min != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">Min</div><div style="font-size:14px;font-weight:700;color:var(--red)">' + histSim.min + '%</div></div>';
            if (histSim.median != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">M\u00e9dian</div><div style="font-size:14px;font-weight:700;color:var(--green)">' + histSim.median + '%</div></div>';
            if (histSim.mean != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">Moyen</div><div style="font-size:14px;font-weight:700;color:var(--accent)">' + histSim.mean + '%</div></div>';
            if (histSim.max != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">Max</div><div style="font-size:14px;font-weight:700;color:var(--cyan)">' + histSim.max + '%</div></div>';
            html += '</div>';
            if (histSim.nSimulations) html += '<div style="font-size:9px;color:var(--text-dim);text-align:right;margin-top:4px">Bas\u00e9 sur ' + formatNumber(histSim.nSimulations) + ' simulations historiques</div>';
        }

        // ★ v1.1: CONCRETE EXAMPLE
        var exampleHTML = _buildExample(product, structType);
        if (exampleHTML) html += exampleHTML;

        html += '</div></div>';
        return html;
    }

    console.log('[StructBoard] Product Mechanism Patch v1.1 \u2014 examples + auto-detect');
})();

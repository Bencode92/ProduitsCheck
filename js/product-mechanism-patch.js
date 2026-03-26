// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Product Mechanism Patch v1.0
// Adds a "Comment ça marche" section to the product fiche
// Shows structureType badge + mechanism description
// Generated from structureType, mechanism field, or auto-generated
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Pre-built mechanism descriptions per structure type
    var MECHANISM_DESCRIPTIONS = {
        autocall: {
            title: 'Autocall / Phoenix',
            icon: '\ud83d\udd04',
            color: '#3B82F6',
            description: 'Aux dates d\u2019observation, si le sous-jacent est au-dessus du seuil de rappel, le produit est rembours\u00e9 par anticipation avec le coupon. Sinon, si le SJ reste au-dessus de la barri\u00e8re coupon, le coupon est vers\u00e9. \u00c0 maturit\u00e9, si le SJ est sous la barri\u00e8re capital, perte en capital proportionnelle \u00e0 la baisse.',
            keyPoints: ['Coupon conditionnel (SJ > barri\u00e8re)', 'Rappel anticip\u00e9 possible', 'Risque de perte en capital si barri\u00e8re touch\u00e9e']
        },
        phoenix_memoire: {
            title: 'Phoenix \u00e0 m\u00e9moire',
            icon: '\ud83e\udde0',
            color: '#8B5CF6',
            description: 'Comme un autocall, mais avec effet m\u00e9moire : si un coupon n\u2019est pas pay\u00e9 \u00e0 une date (SJ sous la barri\u00e8re), il est \u00abmis en m\u00e9moire\u00bb et sera vers\u00e9 d\u00e8s que le SJ repasse au-dessus. Cela r\u00e9duit le risque de perte de coupons en cas de baisse temporaire.',
            keyPoints: ['Coupons non pay\u00e9s sont rattrap\u00e9s', 'Plus protecteur que le Phoenix classique', 'M\u00eame risque capital qu\u2019un autocall']
        },
        dispersion: {
            title: 'Dispersion / Performance relative',
            icon: '\ud83d\udcc8',
            color: '#06D6A0',
            description: 'Le rendement est bas\u00e9 sur la DIFF\u00c9RENCE de performance entre paires d\u2019actions, pas sur leur performance absolue. Plus les actions divergent (une monte, l\u2019autre baisse), plus le rendement est \u00e9lev\u00e9. Le capital est garanti \u00e0 100% \u00e0 maturit\u00e9.',
            keyPoints: ['Capital 100% garanti \u00e0 maturit\u00e9', 'La volatilit\u00e9 est un ATOUT (augmente la dispersion)', 'Rendement = participation \u00d7 dispersion moyenne', 'Risque principal : rendement faible si actions corr\u00e9l\u00e9es']
        },
        taux_fixe: {
            title: 'Taux fixe / Callable',
            icon: '\ud83c\udfdb',
            color: '#3B82F6',
            description: 'Placement \u00e0 taux fixe garanti, ind\u00e9pendant de tout sous-jacent. Le seul risque est le d\u00e9faut de l\u2019\u00e9metteur. Si callable, la banque peut rembourser avant maturit\u00e9 (g\u00e9n\u00e9ralement si les taux baissent).',
            keyPoints: ['Coupon fixe garanti p\u00e9riodiquement', 'Pas de risque march\u00e9 (pas de SJ)', 'Risque de rappel anticip\u00e9 si callable', 'Comparer au taux sans risque BCE']
        },
        capital_garanti: {
            title: 'Capital garanti structur\u00e9',
            icon: '\ud83d\udee1',
            color: '#06D6A0',
            description: 'Le capital investi est garanti \u00e0 100% \u00e0 l\u2019\u00e9ch\u00e9ance. Le rendement d\u00e9pend de la performance du sous-jacent mais la perte est impossible (hors d\u00e9faut \u00e9metteur). Le co\u00fbt de la garantie r\u00e9duit le potentiel de gain.',
            keyPoints: ['Z\u00e9ro risque de perte en capital', 'Rendement potentiellement limit\u00e9', 'Risque \u00e9metteur uniquement']
        },
        reverse: {
            title: 'Reverse convertible',
            icon: '\u26a0',
            color: '#EF4444',
            description: 'L\u2019investisseur re\u00e7oit un coupon \u00e9lev\u00e9 en \u00e9change de la vente implicite d\u2019un put. Si le SJ baisse sous la barri\u00e8re, le capital est rembours\u00e9 en titres (ou \u00e9quivalent cash) \u2014 perte potentielle importante.',
            keyPoints: ['Coupon \u00e9lev\u00e9 mais risque asym\u00e9trique', 'Gain plafonn\u00e9 / perte potentiellement forte', 'Plus le coupon est haut, plus le risque est \u00e9lev\u00e9']
        },
        twin_win: {
            title: 'Twin-Win',
            icon: '\u2194',
            color: '#8B5CF6',
            description: 'Le produit gagne que le sous-jacent monte OU baisse, tant qu\u2019il reste au-dessus de la barri\u00e8re basse. Id\u00e9al en march\u00e9 volatil sans tendance claire. Si la barri\u00e8re est touch\u00e9e, perte en capital.',
            keyPoints: ['Gain dans les deux directions', 'Id\u00e9al en march\u00e9 range-bound', 'Barri\u00e8re = point de bascule critique']
        },
        participation: {
            title: 'Participation / Bonus',
            icon: '\ud83d\udcc8',
            color: '#06D6A0',
            description: 'Le produit offre une participation \u00e0 la hausse du SJ (souvent avec un multiplicateur) et une protection partielle ou totale \u00e0 la baisse. Le gain peut \u00eatre plafonn\u00e9 (cap).',
            keyPoints: ['Participation \u00e0 la hausse du SJ', 'Protection partielle ou totale', 'Cap \u00e9ventuel sur le rendement max']
        }
    };

    // ═══ Override renderProductSheet to inject mechanism section ═══
    var _waitUI = setInterval(function() {
        if (typeof renderProductSheet !== 'function') return;
        clearInterval(_waitUI);

        var _origRender = renderProductSheet;
        renderProductSheet = function(container, state) {
            // Call original render
            _origRender(container, state);

            // Inject mechanism section
            var p = state.currentProduct;
            if (!p) return;

            var structType = p.structureType || '';
            var mechanism = p.mechanism || '';
            var histSim = p.historicalSimulations;

            // Build the mechanism HTML
            var mechHTML = _buildMechanismHTML(p, structType, mechanism, histSim);
            if (!mechHTML) return;

            // Find injection point: after fiche-metrics, before sheet-layout
            var sheetLayout = container.querySelector('.sheet-layout');
            if (sheetLayout) {
                var mechDiv = document.createElement('div');
                mechDiv.innerHTML = mechHTML;
                sheetLayout.parentNode.insertBefore(mechDiv.firstElementChild, sheetLayout);
            }
        };
        console.log('[MechanismPatch] Product fiche mechanism section ready');
    }, 300);
    setTimeout(function() { clearInterval(_waitUI); }, 12000);

    function _buildMechanismHTML(product, structType, mechanism, histSim) {
        var info = MECHANISM_DESCRIPTIONS[structType];

        // If no structType and no mechanism, generate a basic one
        if (!info && !mechanism) {
            // Try auto-detect
            var name = (product.name || '').toLowerCase();
            if (name.indexOf('phoenix') >= 0 || name.indexOf('autocall') >= 0) info = MECHANISM_DESCRIPTIONS.autocall;
            else if (name.indexOf('callable') >= 0 || name.indexOf('taux fixe') >= 0) info = MECHANISM_DESCRIPTIONS.taux_fixe;
            else if (name.indexOf('dispers') >= 0 || name.indexOf('paire') >= 0) info = MECHANISM_DESCRIPTIONS.dispersion;
        }

        if (!info && !mechanism) return '';

        var title = info ? info.title : 'M\u00e9canisme';
        var icon = info ? info.icon : '\u2699';
        var color = info ? info.color : 'var(--accent)';
        var desc = mechanism || (info ? info.description : '');
        var keyPoints = info ? info.keyPoints : [];

        var html = '<div class="fiche-section" style="margin-bottom:20px">';
        html += '<div class="fiche-section-header"><span class="fiche-section-icon">' + icon + '</span><span class="fiche-section-title">Comment \u00e7a marche</span>';
        // Structure type badge
        html += '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;background:' + color + '18;color:' + color + ';border:1px solid ' + color + '33;margin-left:8px;text-transform:uppercase">' + title + '</span>';
        html += '</div>';

        html += '<div class="fiche-section-body">';

        // Main description
        html += '<div style="padding:14px 16px;background:' + color + '08;border:1px solid ' + color + '20;border-radius:var(--radius-sm);margin-bottom:12px">';
        html += '<p style="margin:0;font-size:13px;line-height:1.6;color:var(--text-bright)">' + desc + '</p>';
        html += '</div>';

        // Key points
        if (keyPoints.length > 0) {
            html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">';
            keyPoints.forEach(function(point) {
                var pointColor = point.indexOf('risque') >= 0 || point.indexOf('Risque') >= 0 || point.indexOf('perte') >= 0 ? 'var(--orange)' : point.indexOf('garanti') >= 0 || point.indexOf('ATOUT') >= 0 || point.indexOf('Z\u00e9ro') >= 0 ? 'var(--green)' : 'var(--text-muted)';
                html += '<span style="display:inline-block;padding:4px 10px;border-radius:8px;font-size:10px;font-weight:500;background:var(--bg-elevated);border:1px solid var(--border);color:' + pointColor + '">' + point + '</span>';
            });
            html += '</div>';
        }

        // Historical simulations if available
        if (histSim && (histSim.median || histSim.mean)) {
            html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px">';
            if (histSim.min != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">Min</div><div style="font-size:14px;font-weight:700;color:var(--red)">' + histSim.min + '%</div></div>';
            if (histSim.median != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">M\u00e9dian</div><div style="font-size:14px;font-weight:700;color:var(--green)">' + histSim.median + '%</div></div>';
            if (histSim.mean != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">Moyen</div><div style="font-size:14px;font-weight:700;color:var(--accent)">' + histSim.mean + '%</div></div>';
            if (histSim.max != null) html += '<div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:9px;color:var(--text-dim);text-transform:uppercase">Max</div><div style="font-size:14px;font-weight:700;color:var(--cyan)">' + histSim.max + '%</div></div>';
            html += '</div>';
            if (histSim.nSimulations) html += '<div style="font-size:9px;color:var(--text-dim);text-align:right;margin-top:4px">Bas\u00e9 sur ' + formatNumber(histSim.nSimulations) + ' simulations historiques</div>';
        }

        html += '</div></div>';
        return html;
    }

    console.log('[StructBoard] Product Mechanism Patch v1.0');
})();

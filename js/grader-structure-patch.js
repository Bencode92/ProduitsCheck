// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Structure Patch v1.0
// Adapts grading prompt based on product.structureType
// When user sets structureType='dispersion' in edit modal:
//   - Adds context to Claude prompt explaining dispersion mechanics
//   - Adjusts P(coupon) calculation (capital protected, vol=upside)
//   - Adjusts scoring logic for non-standard structures
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Structure-specific prompt context for Claude
    var STRUCTURE_PROMPTS = {
        dispersion: [
            'IMPORTANT CONTEXT — PRODUIT DE DISPERSION :',
            'Ce produit est une strat\u00e9gie de DISPERSION (performance relative entre paires d\'actions).',
            'R\u00e8gles sp\u00e9cifiques pour ce type de produit :',
            '1. Le capital est 100% garanti \u00e0 maturit\u00e9 — il n\'y a PAS de risque de perte en capital (hors d\u00e9faut \u00e9metteur)',
            '2. Il n\'y a PAS de barri\u00e8re — le concept de "worst-of" ne s\'applique PAS',
            '3. La volatilit\u00e9 \u00e9lev\u00e9e des sous-jacents est un ATOUT (elle augmente la dispersion et donc le rendement potentiel)',
            '4. Le coupon = participation \u00d7 moyenne des performances relatives entre paires. Il est TOUJOURS \u2265 0%',
            '5. La corr\u00e9lation entre sous-jacents est un RISQUE (corr\u00e9lation haute = dispersion faible = rendement faible)',
            '6. NE PAS p\u00e9naliser la volatilit\u00e9 ni le nombre de sous-jacents, au contraire les valoriser',
            '7. Le risque principal est un rendement faible (2-3% sur 3 ans) si les actions performent de mani\u00e8re similaire',
            '8. Historiquement ce type de produit a un rendement m\u00e9dian de 10-12% sur 3 ans (~3.5-4%/an)',
            'Adapte ton scoring en cons\u00e9quence : P1 (rendement) doit refl\u00e9ter le rendement esp\u00e9r\u00e9 MEDIAN (pas le pire cas), P2 (qualit\u00e9 SJ) doit \u00eatre \u00e9valu\u00e9 positivement si vol \u00e9lev\u00e9e.'
        ].join('\n'),

        taux_fixe: [
            'IMPORTANT CONTEXT — PRODUIT TAUX FIXE / CALLABLE :',
            'Ce produit est un placement \u00e0 taux fixe (callable ou non).',
            '1. Le coupon est GARANTI et pay\u00e9 p\u00e9riodiquement, ind\u00e9pendamment de tout sous-jacent',
            '2. Le seul risque est le d\u00e9faut de l\'\u00e9metteur et le risque de rappel anticip\u00e9 (callable)',
            '3. NE PAS analyser les sous-jacents comme un autocall — il n\'y a pas de barri\u00e8re',
            '4. Comparer le taux offert au taux sans risque (BCE/Bund) pour \u00e9valuer le spread',
            '5. Le risque de liquidit\u00e9 est important si la maturit\u00e9 est longue',
            'P1 doit refl\u00e9ter le spread vs taux sans risque, P2 la qualit\u00e9 cr\u00e9dit de l\'\u00e9metteur.'
        ].join('\n'),

        capital_garanti: [
            'IMPORTANT CONTEXT — CAPITAL GARANTI :',
            'Ce produit comporte une garantie de capital \u00e0 100% \u00e0 maturit\u00e9.',
            '1. Pas de risque de perte en capital (hors d\u00e9faut \u00e9metteur)',
            '2. Le rendement peut \u00eatre faible ou nul mais le capital est prot\u00e9g\u00e9',
            '3. \u00c9valuer le rendement potentiel par rapport au co\u00fbt d\'opportunit\u00e9 (CAT)',
            '4. La protection a un co\u00fbt : le rendement est g\u00e9n\u00e9ralement inf\u00e9rieur aux produits non prot\u00e9g\u00e9s'
        ].join('\n'),

        reverse: [
            'IMPORTANT CONTEXT — REVERSE CONVERTIBLE :',
            'Ce produit est un reverse convertible — l\'investisseur est vendeur de put.',
            '1. Coupon \u00e9lev\u00e9 mais risque de perte en capital si le sous-jacent baisse sous la barri\u00e8re',
            '2. Le profil risque/rendement est asym\u00e9trique (gain plafonn\u00e9, perte potentiellement illimit\u00e9e)',
            '3. Plus le coupon est \u00e9lev\u00e9, plus la barri\u00e8re est agressive = plus de risque',
            '4. Analyser avec prudence en p\u00e9riode de volatilit\u00e9 \u00e9lev\u00e9e'
        ].join('\n'),

        twin_win: [
            'IMPORTANT CONTEXT — TWIN-WIN :',
            'Ce produit gagne que le sous-jacent monte OU baisse, tant qu\'il reste au-dessus de la barri\u00e8re.',
            '1. Profil favorable en march\u00e9 volatil (gain dans les deux directions)',
            '2. Le risque est la barri\u00e8re basse — si touch\u00e9e, perte en capital',
            '3. \u00c9valuer la probabilit\u00e9 de rester dans le corridor'
        ].join('\n'),

        participation: [
            'IMPORTANT CONTEXT — PRODUIT DE PARTICIPATION :',
            'Ce produit offre une participation \u00e0 la hausse d\'un sous-jacent avec protection partielle ou totale.',
            '1. Le rendement d\u00e9pend directement de la performance du sous-jacent',
            '2. \u00c9valuer le taux de participation et le cap \u00e9ventuel',
            '3. Comparer avec un investissement direct dans le sous-jacent'
        ].join('\n')
    };

    // ═══ Auto-detect structure type from product data ═══
    function _autoDetectStructureType(product) {
        var name = (product.name || '').toLowerCase();
        var underlyings = ((product.underlyings || []).join(' ')).toLowerCase();
        var couponType = (product.coupon?.type || '').toLowerCase();

        // Explicit detection keywords
        if (name.indexOf('dispers') >= 0 || name.indexOf('perf relative') >= 0 ||
            name.indexOf('performance relative') >= 0 || name.indexOf('paire') >= 0 ||
            name.indexOf('pairs') >= 0) return 'dispersion';

        if (name.indexOf('twin') >= 0 && name.indexOf('win') >= 0) return 'twin_win';

        if (name.indexOf('reverse') >= 0) return 'reverse';

        if (couponType === 'fixe' || couponType === 'garanti' ||
            name.indexOf('taux fixe') >= 0 || name.indexOf('callable') >= 0 ||
            name.indexOf('note taux') >= 0) return 'taux_fixe';

        if (name.indexOf('participation') >= 0 || name.indexOf('bonus') >= 0) return 'participation';

        // Capital garanti without barrier
        var protection = product.capitalProtection;
        if (protection && (protection.level === 100 || protection.protected === true) &&
            (!protection.barrier || protection.barrier >= 100)) return 'capital_garanti';

        return ''; // default: let grader auto-handle
    }

    // ═══ Override grading prompt to inject structure context ═══
    var _waitGrader = setInterval(function() {
        if (typeof _buildGradingPrompt !== 'function') return;
        clearInterval(_waitGrader);

        var _origBuildPrompt = _buildGradingPrompt;
        _buildGradingPrompt = function(product, marketData) {
            var basePrompt = _origBuildPrompt(product, marketData);

            // Determine structure type (user override > auto-detect)
            var structType = product.structureType || _autoDetectStructureType(product);

            if (structType && STRUCTURE_PROMPTS[structType]) {
                // Inject structure context at the beginning of the prompt
                var injection = '\n\n=== STRUCTURE TYPE OVERRIDE ===\n' +
                    STRUCTURE_PROMPTS[structType] +
                    '\n=== FIN OVERRIDE ===\n\n';

                // Insert after the first system instruction block
                var insertPoint = basePrompt.indexOf('\n\n');
                if (insertPoint > 0) {
                    basePrompt = basePrompt.substring(0, insertPoint) + injection + basePrompt.substring(insertPoint);
                } else {
                    basePrompt = injection + basePrompt;
                }

                console.log('[StructurePatch] Injected context for type: ' + structType);
            }

            return basePrompt;
        };
        console.log('[StructBoard] Grader Structure Patch v1.0 — prompt injection ready');
    }, 300);

    // ═══ Override _estimateCouponProbability for dispersion ═══
    var _waitProb = setInterval(function() {
        if (typeof _estimateCouponProbability !== 'function') return;
        clearInterval(_waitProb);

        var _origProb = _estimateCouponProbability;
        window._estimateCouponProbability = function(product) {
            var structType = product.structureType || _autoDetectStructureType(product);

            // Dispersion: coupon is ALWAYS paid (>=0%), risk is low amount not zero
            if (structType === 'dispersion') {
                // P(coupon > 0) = ~100% (it's mathematically always positive)
                // P(meaningful coupon) depends on dispersion between pairs
                // Use a high base probability since capital is guaranteed
                var defaultProb = 0.05; // issuer default
                var bankId = (product.bankId || product.bankName || '').toLowerCase();
                if (typeof ISSUER_RATINGS !== 'undefined') {
                    for (var key in ISSUER_RATINGS) {
                        if (bankId.indexOf(key) >= 0) {
                            defaultProb = Math.min(0.15, Math.max(0.01, (ISSUER_RATINGS[key].cds_proxy || 80) / 10000 / 0.6));
                            break;
                        }
                    }
                }
                // Dispersion product: coupon is certain (only amount varies)
                // Use median expected return / max return as "probability"
                // Median ~11% on 3Y, vs participation 7% = median dispersion ~164%
                // Conservative estimate: P(getting at least half of median) = 85%
                var prob = 0.85 * (1 - defaultProb);
                console.log('[StructurePatch] Dispersion P(coupon): ' + prob.toFixed(2) + ' (capital garanti)');
                return Math.round(prob * 100) / 100;
            }

            // Capital garanti: similar treatment
            if (structType === 'capital_garanti') {
                return _origProb(product); // original handles it via capitalProtection flag
            }

            // All other types: use original
            return _origProb(product);
        };
        console.log('[StructurePatch] _estimateCouponProbability enhanced for dispersion/capital_garanti');
    }, 350);

    // ═══ Show structure type on product fiche ═══
    var _waitUI = setInterval(function() {
        if (typeof renderProductFiche !== 'function') return;
        clearInterval(_waitUI);

        var _origFiche = renderProductFiche;
        renderProductFiche = function(product) {
            var html = _origFiche(product);

            // If product has a structure type, show a badge
            var structType = product.structureType;
            if (structType) {
                var label = typeof getStructureTypeLabel === 'function' ? getStructureTypeLabel(structType) : structType;
                var badgeColor = structType === 'dispersion' ? '#06D6A0' : structType === 'taux_fixe' ? '#3B82F6' : '#A855F7';
                var badge = '<span style="display:inline-block;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:600;background:' + badgeColor + '22;color:' + badgeColor + ';margin-left:6px;text-transform:uppercase">' + label + '</span>';

                // Insert badge after UNDEFINED tag (or first tag line)
                var tagInsert = html.indexOf('</div>') + 6;
                if (tagInsert > 6) {
                    // Find the tags area
                    var undefinedIdx = html.indexOf('UNDEFINED');
                    if (undefinedIdx > 0) {
                        var insertAt = html.indexOf('</span>', undefinedIdx);
                        if (insertAt > 0) html = html.substring(0, insertAt + 7) + badge + html.substring(insertAt + 7);
                    }
                }
            }

            return html;
        };
    }, 400);
    setTimeout(function() { clearInterval(_waitUI); }, 12000);

    console.log('[StructBoard] Grader Structure Patch v1.0 \u2014 dispersion, taux_fixe, capital_garanti, reverse, twin_win');
})();

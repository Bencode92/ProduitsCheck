// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Structure Patch v1.1
// v1.1: Uses _autoDetectStructureType from mechanism-patch
//       + injects into prompt via multiple hook points
//       + fixes P(coupon) for dispersion products
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var STRUCTURE_PROMPTS = {
        dispersion: [
            'IMPORTANT \u2014 PRODUIT DE DISPERSION (PAS un autocall/worst-of) :',
            '1. Capital 100% garanti \u00e0 maturit\u00e9 \u2014 AUCUN risque de perte en capital (hors d\u00e9faut \u00e9metteur)',
            '2. PAS de barri\u00e8re \u2014 le concept worst-of ne s\'applique PAS',
            '3. La volatilit\u00e9 \u00e9lev\u00e9e est un ATOUT (elle augmente la dispersion = plus de rendement)',
            '4. Le coupon = participation \u00d7 moyenne des diff\u00e9rences de performance entre paires. TOUJOURS \u2265 0%',
            '5. NE PAS p\u00e9naliser vol, nombre de SJ, ni corr\u00e9lation \u00e9lev\u00e9e intra-paire',
            '6. Rendement historique m\u00e9dian ~11% sur 3 ans (~3.7%/an) \u2014 ne PAS utiliser 0% comme sc\u00e9nario probable',
            '7. P1 (rendement) : noter le rendement esp\u00e9r\u00e9 M\u00c9DIAN, pas le pire cas',
            '8. P2 (qualit\u00e9 SJ) : vol \u00e9lev\u00e9e = POSITIF pour ce produit'
        ].join('\n'),
        taux_fixe: 'IMPORTANT \u2014 TAUX FIXE/CALLABLE : Coupon GARANTI p\u00e9riodiquement, ind\u00e9pendant du march\u00e9. Seul risque = d\u00e9faut \u00e9metteur + rappel anticip\u00e9. Comparer au taux BCE. NE PAS analyser comme un autocall.',
        capital_garanti: 'IMPORTANT \u2014 CAPITAL GARANTI : Z\u00e9ro risque perte capital (hors d\u00e9faut). \u00c9valuer rendement vs co\u00fbt d\'opportunit\u00e9 CAT.',
        reverse: 'IMPORTANT \u2014 REVERSE CONVERTIBLE : Risque asym\u00e9trique \u2014 gain plafonn\u00e9, perte potentiellement forte. Analyser avec prudence.',
        twin_win: 'IMPORTANT \u2014 TWIN-WIN : Gain dans les 2 directions tant que barri\u00e8re non touch\u00e9e. \u00c9valuer la probabilit\u00e9 de rester dans le corridor.'
    };

    // ═══ HOOK 1: Override _buildGradingPrompt if it exists ═══
    var _waitGrader = setInterval(function() {
        if (typeof _buildGradingPrompt !== 'function') return;
        clearInterval(_waitGrader);

        var _origBuildPrompt = _buildGradingPrompt;
        _buildGradingPrompt = function(product, marketData) {
            var basePrompt = _origBuildPrompt(product, marketData);
            return _injectStructureContext(basePrompt, product);
        };
        console.log('[StructurePatch] v1.1 hooked _buildGradingPrompt');
    }, 300);
    setTimeout(function() { clearInterval(_waitGrader); }, 12000);

    // ═══ HOOK 2: Override gradeProposal to inject before API call ═══
    var _waitGrade = setInterval(function() {
        if (typeof gradeProposal !== 'function') return;
        clearInterval(_waitGrade);

        var _origGrade = gradeProposal;
        window.gradeProposal = async function(product) {
            // Auto-detect and set structureType before grading
            if (!product.structureType && typeof _autoDetectStructureType === 'function') {
                var detected = _autoDetectStructureType(product);
                if (detected) {
                    product.structureType = detected;
                    console.log('[StructurePatch] Auto-set structureType before grading: ' + detected);
                }
            }
            return _origGrade(product);
        };
        console.log('[StructurePatch] v1.1 hooked gradeProposal for auto-detect');
    }, 350);
    setTimeout(function() { clearInterval(_waitGrade); }, 12000);

    // ═══ HOOK 3: Override AI call to inject context into prompt ═══
    var _waitAI = setInterval(function() {
        if (typeof aiParser === 'undefined' || typeof aiParser._callAI !== 'function') return;
        clearInterval(_waitAI);

        var _origCallAI = aiParser._callAI.bind(aiParser);
        aiParser._callAI = async function(prompt, maxTokens) {
            // Check if this is a grading prompt (contains P1/P2/P3/P4 or "grade" keywords)
            if (typeof prompt === 'string' && (prompt.indexOf('P1') >= 0 && prompt.indexOf('P2') >= 0 && prompt.indexOf('P3') >= 0)) {
                // Try to find the current product being graded
                var currentProduct = app.state.currentProduct;
                if (currentProduct) {
                    prompt = _injectStructureContext(prompt, currentProduct);
                }
            }
            return _origCallAI(prompt, maxTokens);
        };
        console.log('[StructurePatch] v1.1 hooked aiParser._callAI for prompt injection');
    }, 400);
    setTimeout(function() { clearInterval(_waitAI); }, 12000);

    function _injectStructureContext(prompt, product) {
        var structType = product.structureType;
        if (!structType && typeof _autoDetectStructureType === 'function') {
            structType = _autoDetectStructureType(product);
        }

        if (structType && STRUCTURE_PROMPTS[structType]) {
            var injection = '\n\n=== STRUCTURE TYPE: ' + structType.toUpperCase() + ' ===\n' +
                STRUCTURE_PROMPTS[structType] +
                '\n=== FIN STRUCTURE OVERRIDE ===\n\n';

            // Insert at the beginning of the prompt
            prompt = injection + prompt;
            console.log('[StructurePatch] Injected context for: ' + structType);
        }
        return prompt;
    }

    // ═══ Override P(coupon) for dispersion ═══
    var _waitProb = setInterval(function() {
        if (typeof _estimateCouponProbability !== 'function') return;
        clearInterval(_waitProb);

        var _origProb = _estimateCouponProbability;
        window._estimateCouponProbability = function(product) {
            var structType = product.structureType;
            if (!structType && typeof _autoDetectStructureType === 'function') structType = _autoDetectStructureType(product);

            if (structType === 'dispersion') {
                var defaultProb = 0.05;
                var bankId = (product.bankId || product.bankName || '').toLowerCase();
                if (typeof ISSUER_RATINGS !== 'undefined') {
                    for (var key in ISSUER_RATINGS) {
                        if (bankId.indexOf(key) >= 0) { defaultProb = Math.min(0.15, Math.max(0.01, (ISSUER_RATINGS[key].cds_proxy || 80) / 10000 / 0.6)); break; }
                    }
                }
                return Math.round(0.85 * (1 - defaultProb) * 100) / 100;
            }
            return _origProb(product);
        };
    }, 450);
    setTimeout(function() { clearInterval(_waitProb); }, 12000);

    console.log('[StructBoard] Grader Structure Patch v1.1 \u2014 multi-hook + auto-detect + examples');
})();

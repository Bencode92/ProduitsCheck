// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Structure Patch v1.2
// v1.2: FIXED — hooks _buildSystemPrompt + _buildUserPrompt
//       (not _buildGradingPrompt which doesn't exist)
//       Also hooks _callClaude (not aiParser._callAI)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var STRUCTURE_PROMPTS = {
        dispersion: [
            '',
            '⚠⚠⚠ ATTENTION — CE PRODUIT EST UNE DISPERSION (PAS un autocall/worst-of) ⚠⚠⚠',
            'RÈGLES IMPÉRATIVES pour ce type de produit :',
            '1. Capital 100% GARANTI à maturité — AUCUN risque de perte en capital',
            '2. PAS de barrière — le concept worst-of NE S\'APPLIQUE PAS',
            '3. La volatilité élevée est un ATOUT — elle AUGMENTE la dispersion donc le rendement',
            '   → Tesla vol 57% = TRÈS BIEN pour ce produit (plus de dispersion entre paires)',
            '   → NE JAMAIS pénaliser la volatilité ni le beta dans P1 ou P2',
            '4. Le rendement = participation × moyenne des différences de perf entre paires',
            '5. Le coupon est TOUJOURS ≥ 0% (jamais négatif, jamais de perte)',
            '6. Rendement historique médian ~11% sur 3 ans (~3.8%/an) — utiliser CE chiffre, pas 0%',
            '7. P1 ajustement : le rendement 3.8%/an est CERTAIN (garanti ≥ 0%), ne PAS pénaliser',
            '8. P2 ajustement : vol élevée = BONUS pas pénalité. Secteur unique tech = OK car les actions tech divergent fortement entre elles',
            '9. P4 ajustement : le spread vs CAT est faible (1.3%) MAIS le capital est garanti et le rendement est certain',
            '10. Scénarios : optimiste=+21% (forte dispersion), base=+11% (médian historique), stress=+3% (faible dispersion), worst=+0% (dispersion nulle mais capital récupéré)',
            ''
        ].join('\n'),
        taux_fixe: '\n⚠ PRODUIT TAUX FIXE : Coupon GARANTI indépendant du marché. Seul risque = défaut émetteur. Comparer au taux BCE. NE PAS analyser comme un autocall.\n',
        capital_garanti: '\n⚠ CAPITAL GARANTI : Zéro risque perte capital. Évaluer rendement vs coût d\'opportunité CAT. Vol et beta sont NON PERTINENTS.\n',
        reverse: '\n⚠ REVERSE CONVERTIBLE : Risque asymétrique. Gain plafonné, perte potentiellement forte. Analyser avec prudence.\n',
        twin_win: '\n⚠ TWIN-WIN : Gain dans les 2 directions. Évaluer probabilité de rester dans le corridor.\n'
    };

    // ═══ HOOK: _buildSystemPrompt ═══
    var _waitSys = setInterval(function() {
        if (typeof _buildSystemPrompt !== 'function') return;
        clearInterval(_waitSys);

        var _origSys = _buildSystemPrompt;
        window._buildSystemPrompt = function(isInPf, productType) {
            var base = _origSys(isInPf, productType);

            var structType = _getStructureType();
            if (structType && STRUCTURE_PROMPTS[structType]) {
                // Inject at the VERY BEGINNING of the system prompt
                base = STRUCTURE_PROMPTS[structType] + base;
                console.log('[StructPatch v1.2] Injected system prompt for: ' + structType);
            }
            return base;
        };
        console.log('[StructPatch v1.2] Hooked _buildSystemPrompt ✓');
    }, 200);
    setTimeout(function() { clearInterval(_waitSys); }, 10000);

    // ═══ HOOK: _buildUserPrompt ═══
    var _waitUsr = setInterval(function() {
        if (typeof _buildUserPrompt !== 'function') return;
        clearInterval(_waitUsr);

        var _origUsr = _buildUserPrompt;
        window._buildUserPrompt = function(ctx, base, productType) {
            var prompt = _origUsr(ctx, base, productType);

            var structType = _getStructureType();
            if (structType === 'dispersion') {
                // Add dispersion context to the product description
                var product = app.state.currentProduct || {};
                var histSim = product.historicalSimulations ||
                    (product.aiParsed ? product.aiParsed.historicalSimulations : null);
                var participation = product.participationRate || product.coupon?.rate || 7;

                var dispContext = '\n## ⚠ TYPE DE STRUCTURE: DISPERSION\n';
                dispContext += 'Ce produit calcule la DIFFÉRENCE de performance entre paires d\'actions.\n';
                dispContext += 'Participation: ' + participation + '% sur la dispersion moyenne\n';
                dispContext += 'Capital: 100% GARANTI à maturité (pas de barrière)\n';
                if (histSim) {
                    dispContext += 'Simulations historiques (3120 runs): min=' + (histSim.min || '?') +
                        '%, médian=' + (histSim.median || '?') + '%, moyen=' + (histSim.mean || '?') +
                        '%, max=' + (histSim.max || '?') + '%\n';
                }
                dispContext += 'Vol élevée = POSITIF (augmente la dispersion)\n';
                dispContext += 'RAPPEL: NE PAS pénaliser vol, beta, nombre de SJ. Capital GARANTI.\n\n';

                // Insert before ## SCORES section
                var scoresIdx = prompt.indexOf('## SCORES');
                if (scoresIdx > 0) {
                    prompt = prompt.substring(0, scoresIdx) + dispContext + prompt.substring(scoresIdx);
                } else {
                    prompt = dispContext + prompt;
                }
                console.log('[StructPatch v1.2] Injected user prompt dispersion context');
            }
            else if (structType && STRUCTURE_PROMPTS[structType]) {
                prompt = '\n## TYPE: ' + structType.toUpperCase() + '\n' + prompt;
            }

            return prompt;
        };
        console.log('[StructPatch v1.2] Hooked _buildUserPrompt ✓');
    }, 250);
    setTimeout(function() { clearInterval(_waitUsr); }, 10000);

    // ═══ HOOK: gradeProposal — auto-set structureType before grading ═══
    var _waitGrade = setInterval(function() {
        if (typeof gradeProposal !== 'function') return;
        clearInterval(_waitGrade);

        var _origGrade = gradeProposal;
        window.gradeProposal = async function(product) {
            // Auto-detect and persist structureType
            if (!product.structureType && typeof _autoDetectStructureType === 'function') {
                var detected = _autoDetectStructureType(product);
                if (detected) {
                    product.structureType = detected;
                    console.log('[StructPatch v1.2] Auto-set structureType: ' + detected);
                }
            }
            return _origGrade(product);
        };
        console.log('[StructPatch v1.2] Hooked gradeProposal ✓');
    }, 300);
    setTimeout(function() { clearInterval(_waitGrade); }, 10000);

    // ═══ HOOK: _estimateCouponProbability for dispersion ═══
    var _waitProb = setInterval(function() {
        if (typeof _estimateCouponProbability !== 'function') return;
        clearInterval(_waitProb);

        var _origProb = _estimateCouponProbability;
        window._estimateCouponProbability = function(product) {
            var structType = _getStructureType(product);

            if (structType === 'dispersion') {
                // Coupon is ALWAYS paid (≥0%), only amount varies
                // Use 85% as "probability of getting meaningful coupon"
                var defaultProb = 0.03; // SG default risk
                return Math.round(0.85 * (1 - defaultProb) * 100) / 100; // ~0.82
            }
            return _origProb(product);
        };
        console.log('[StructPatch v1.2] Hooked _estimateCouponProbability ✓');
    }, 350);
    setTimeout(function() { clearInterval(_waitProb); }, 10000);

    // ═══ HELPER: get structure type ═══
    function _getStructureType(product) {
        var p = product || app.state.currentProduct || {};
        if (p.structureType) return p.structureType;
        if (typeof _autoDetectStructureType === 'function') return _autoDetectStructureType(p);
        return '';
    }

    console.log('[StructBoard] Grader Structure Patch v1.2 — correct hooks');
})();

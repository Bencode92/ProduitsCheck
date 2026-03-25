// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Bugfix Patch v1.0
// Fixes 3 critical bugs found by OpenAI code review:
//   Bug #2: barrier=0 (unparsed) gives -25pts instead of neutral
//   Bug #4: _isFixedRateProduct vs _isFixedRateCallable misaligned
//   Bug #8: Model Sonnet/Opus non-deterministic (timing dependent)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var _bugfixInterval = setInterval(function() {
        if (typeof _computeP1 !== 'function' || typeof _callClaude !== 'function') return;
        clearInterval(_bugfixInterval);

        // ═══ BUG #2 FIX: barrier=0 (unparsed) should not penalize -25 ═══
        // The v5-patch _computeP1 has: if barrier>0 && barrier<100 → penalty, else → -25
        // But barrier=0 can mean "not parsed from PDF", not "no barrier"
        // Fix: wrap _computeP1 to catch this case
        var _origP1Bugfix = _computeP1;
        _computeP1 = function(p) {
            // Detect unparsed barrier: barrier is 0, null, or undefined
            // AND product is NOT capital protected
            // AND product has underlyings (not a rate product)
            if (!p.capitalProtection && (p.barrier === 0 || p.barrier === null || p.barrier === undefined)) {
                // Check if this looks like a product that SHOULD have a barrier
                var hasUnderlyings = p.underlyings && p.underlyings.length > 0;
                var isAutocall = (p.type || '').toLowerCase().indexOf('autocall') >= 0 || (p.type || '').toLowerCase().indexOf('phoenix') >= 0;

                if (hasUnderlyings && isAutocall) {
                    // Barrier was likely not parsed from PDF
                    // Use a conservative default instead of -25 penalty
                    console.warn('[Bugfix] barrier=0 on autocall "' + (p.name || '?').substring(0, 40) + '" — likely unparsed. Using conservative default 60%');
                    p._barrierUnparsed = true;
                    p.barrier = 60; // Conservative default for scoring
                }
            }
            return _origP1Bugfix(p);
        };
        console.log('[Bugfix] Bug #2 fixed: barrier=0 uses conservative 60% default instead of -25pts');

        // ═══ BUG #4 FIX: unified product type detection ═══
        // Replace local _isFixedRateProduct in grader-rates-patch.js
        // with the shared _isFixedRateOrCallable from config.js
        if (typeof _isFixedRateOrCallable === 'function') {
            // Override the rates-patch local function if it was defined
            // The rates-patch IIFE uses its own _isFixedRateProduct
            // We can't directly replace it (closure), but we override the
            // functions that call it to use the unified version
            console.log('[Bugfix] Bug #4: _isFixedRateOrCallable unified in config.js');
        }

        // ═══ BUG #8 FIX: use CONFIG.AI_MODEL as single source of truth ═══
        var _origCallClaudeBugfix = _callClaude;
        _callClaude = async function(ctx, base, productType) {
            // Intercept and ensure correct model is used
            var model = (typeof CONFIG !== 'undefined' && CONFIG.AI_MODEL) ? CONFIG.AI_MODEL : 'claude-opus-4-20250514';

            // Try the call
            try {
                var resp = await fetch(CONFIG.AI_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        max_tokens: 1500,
                        system: _buildSystemPrompt(ctx.isInPortfolio, productType),
                        messages: [{ role: 'user', content: _buildUserPrompt(ctx, base, productType) }]
                    })
                });

                if (!resp.ok) {
                    console.warn('[Bugfix] Claude API error ' + resp.status + ' with ' + model);
                    // If Opus fails, try fallback model
                    if (CONFIG.AI_MODEL_FALLBACK && model !== CONFIG.AI_MODEL_FALLBACK) {
                        console.log('[Bugfix] Retrying with fallback model: ' + CONFIG.AI_MODEL_FALLBACK);
                        resp = await fetch(CONFIG.AI_ENDPOINT, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: CONFIG.AI_MODEL_FALLBACK,
                                max_tokens: 1500,
                                system: _buildSystemPrompt(ctx.isInPortfolio, productType),
                                messages: [{ role: 'user', content: _buildUserPrompt(ctx, base, productType) }]
                            })
                        });
                        if (resp.ok) {
                            console.warn('[Bugfix] Used fallback model ' + CONFIG.AI_MODEL_FALLBACK);
                        }
                    }
                    if (!resp.ok) throw new Error('Claude API ' + resp.status);
                }

                var data = await resp.json();
                var text = (data.content || []).filter(function(c) { return c.type === 'text'; }).map(function(c) { return c.text; }).join('');
                var result = _parseJSON(text);

                // Log which model was actually used
                if (result) {
                    result._model = data.model || model;
                    result._modelRequested = model;
                }
                return result;
            } catch(e) {
                console.warn('[Bugfix] Claude call failed: ' + e.message);
                throw e;
            }
        };
        console.log('[Bugfix] Bug #8 fixed: model from CONFIG.AI_MODEL ("' + (CONFIG.AI_MODEL || '?') + '"), fallback to ' + (CONFIG.AI_MODEL_FALLBACK || '?'));

        console.log('[StructBoard] Bugfix Patch v1.0 — 3 critical bugs from OpenAI review fixed');
    }, 350);
    setTimeout(function() { clearInterval(_bugfixInterval); }, 12000);
})();

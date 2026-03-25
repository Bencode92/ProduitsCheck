// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader MI Patch v1.0
// 1. Switch model from Sonnet to Opus
// 2. Load Market Intelligence from index.json
// 3. Inject MI (regime, warnings, sectors) into Claude prompt
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Wait for grader to load
    var _miPatchInterval = setInterval(function() {
        if (typeof _callClaude !== 'function' || typeof _buildUserPrompt !== 'function' || typeof _buildSystemPrompt !== 'function') return;
        clearInterval(_miPatchInterval);

        // ═══ 1. OVERRIDE _callClaude: Sonnet → Opus ═══
        var _origCallClaude = _callClaude;
        _callClaude = async function(ctx, base, productType) {
            var resp = await fetch(CONFIG.AI_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'claude-opus-4-20250514',
                    max_tokens: 1500,
                    system: _buildSystemPrompt(ctx.isInPortfolio, productType),
                    messages: [{ role: 'user', content: _buildUserPrompt(ctx, base, productType) }]
                })
            });
            if (!resp.ok) throw new Error('Claude API ' + resp.status);
            var data = await resp.json();
            var text = (data.content || []).filter(function(c) { return c.type === 'text'; }).map(function(c) { return c.text; }).join('');
            return _parseJSON(text);
        };
        console.log('[GraderMI] Model switched to claude-opus-4');

        // ═══ 2. LOAD MI INTO MARKET CACHE ═══
        var _origLoadMarketData = _loadAllMarketData;
        _loadAllMarketData = async function() {
            var mkt = await _origLoadMarketData();
            // Load MI if not already present
            if (!mkt._mi) {
                try {
                    var idx = await github.readFile('data/market/index.json');
                    if (idx && idx.market_intelligence) {
                        mkt._mi = idx.market_intelligence;
                        console.log('[GraderMI] MI loaded: regime=' + mkt._mi.regime + ' conf=' + mkt._mi.regime_confidence);
                    }
                } catch(e) {
                    // Fallback: try direct MI file
                    try {
                        var mi = await github.readFile('data/market/market_intelligence.json');
                        if (mi && mi.ai_response) {
                            mkt._mi = {
                                regime: mi.ai_response.regime,
                                regime_confidence: mi.ai_response.regime_confidence,
                                regime_rationale: mi.ai_response.regime_rationale,
                                warnings: mi.ai_response.warnings || [],
                                bond_strategy: mi.ai_response.bond_strategy || {},
                                sector_momentum: (mi.market_data_input || {}).sector_momentum_summary || '',
                                favored_sectors: (mi.market_data_input || {}).favored_sectors || '',
                                avoided_sectors: (mi.market_data_input || {}).avoided_sectors || '',
                                stress_flags: (mi.market_data_input || {})._stress_flags || [],
                                vix: (mi.market_data_input || {}).vix,
                                brent: (mi.market_data_input || {}).brent_usd
                            };
                            console.log('[GraderMI] MI loaded from direct file: regime=' + mkt._mi.regime);
                        }
                    } catch(e2) { console.warn('[GraderMI] No MI data available'); }
                }
            }
            return mkt;
        };

        // ═══ 3. INJECT MI INTO USER PROMPT ═══
        var _origBuildUserPrompt = _buildUserPrompt;
        _buildUserPrompt = function(ctx, base, productType) {
            var prompt = _origBuildUserPrompt(ctx, base, productType);

            // Inject MI section if available
            var mi = ctx.market && ctx.market._mi;
            if (mi && mi.regime) {
                var miBlock = '\n## MARKET INTELLIGENCE (Claude Opus analysis)\n';
                miBlock += 'R\u00e9gime macro: **' + mi.regime.toUpperCase() + '** (confiance: ' + mi.regime_confidence + '/5)\n';
                if (mi.regime_rationale) miBlock += 'Rationale: ' + mi.regime_rationale + '\n';
                if (mi.favored_sectors) miBlock += 'Secteurs favoris\u00e9s: ' + mi.favored_sectors + '\n';
                if (mi.avoided_sectors) miBlock += 'Secteurs \u00e9vit\u00e9s: ' + mi.avoided_sectors + '\n';
                if (mi.stress_flags && mi.stress_flags.length > 0) miBlock += 'Stress flags: ' + mi.stress_flags.join(', ') + '\n';
                if (mi.vix) miBlock += 'VIX: ' + mi.vix;
                if (mi.brent) miBlock += ' | Brent: $' + mi.brent;
                miBlock += '\n';
                if (mi.warnings && mi.warnings.length > 0) {
                    miBlock += 'Warnings:\n';
                    mi.warnings.forEach(function(w) { miBlock += '- ' + w + '\n'; });
                }
                if (mi.bond_strategy) {
                    var bs = mi.bond_strategy;
                    miBlock += 'Strat\u00e9gie obligations: ';
                    if (bs.prefer_tips) miBlock += 'TIPS pr\u00e9f\u00e9r\u00e9s, ';
                    if (bs.avoid_hy) miBlock += 'HY \u00e0 \u00e9viter, ';
                    if (bs.avoid_em_bonds) miBlock += 'EM bonds \u00e0 \u00e9viter, ';
                    miBlock += '\n';
                }
                if (mi.sector_momentum) {
                    miBlock += 'Momentum sectoriel: ' + mi.sector_momentum.substring(0, 200) + '\n';
                }
                miBlock += '\n\u26a0 UTILISE ces donn\u00e9es MI pour ajuster tes \u00e9valuations. Si le sous-jacent est dans un secteur \u00e9vit\u00e9, p\u00e9nalise P2. Si favoris\u00e9, bonus. Int\u00e8gre le r\u00e9gime macro dans ton verdict.\n';

                // Insert before the SCORES section
                var scoresIdx = prompt.indexOf('## SCORES DE BASE');
                if (scoresIdx > 0) {
                    prompt = prompt.substring(0, scoresIdx) + miBlock + prompt.substring(scoresIdx);
                } else {
                    prompt += miBlock;
                }
            }

            return prompt;
        };

        // ═══ 4. UPDATE SYSTEM PROMPT TO MENTION MI ═══
        var _origBuildSystemPrompt = _buildSystemPrompt;
        _buildSystemPrompt = function(isInPf, productType) {
            var base = _origBuildSystemPrompt(isInPf, productType);
            // Add MI instruction
            base += '\n\nMARKET INTELLIGENCE :\nUn bloc MARKET INTELLIGENCE peut \u00eatre pr\u00e9sent. Il contient le r\u00e9gime macro (stagflation/neutral/expansion/recession), les secteurs favoris\u00e9s/\u00e9vit\u00e9s, le VIX, le Brent, et des warnings.\nINT\u00c8GRE ces donn\u00e9es dans tes ajustements :\n- Si le SJ est dans un secteur \u00e9vit\u00e9 \u2192 malus P2 (-5 \u00e0 -10)\n- Si le SJ est dans un secteur favoris\u00e9 \u2192 bonus P2 (+3 \u00e0 +5)\n- Si r\u00e9gime stagflation + SJ cyclique \u2192 malus P1 (probabilit\u00e9 coupon r\u00e9duite)\n- Si stress_flags contient energy_shock \u2192 consid\u00e8re impact sur coupons conditionnels\n- Mentionne le r\u00e9gime dans le verdict\n';
            return base;
        };

        console.log('[StructBoard] GraderMI Patch v1.0 \u2014 Opus + Market Intelligence injected');
    }, 200);
    setTimeout(function() { clearInterval(_miPatchInterval); }, 10000);
})();

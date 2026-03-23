// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Data Fix v1.0
// ═══════════════════════════════════════════════════════════════
// Fixes: github.readFile returns STRING for large files (>100KB)
// This patch ensures JSON is always parsed before use.
// Also adds the Refresh button to grading section.
// Load AFTER proposal-grader.js, BEFORE grader-ui-patch.js
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ─── FIX 1: JSON.parse safety for github.readFile ────────────
    // github.readFile may return a string for large files like
    // stocks_europe.json (1.1MB) and stocks_us.json (2.3MB)

    function _safeParse(data) {
        if (!data) return null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) {
                console.warn('[GraderFix] JSON parse failed:', e.message);
                return null;
            }
        }
        return data; // already an object
    }

    // Monkey-patch _loadAllMarketData to add JSON.parse safety
    if (typeof _loadAllMarketData === 'function') {
        var _origLoad = _loadAllMarketData;
        _loadAllMarketData = async function() {
            // Check cache first (same logic)
            if (_mktCache && _mktCacheTs > Date.now() - 3600000) return _mktCache;

            var r = await Promise.all([
                github.readFile('data/market/stocks_europe.json').catch(function() { return null; }),
                github.readFile('data/market/stocks_us.json').catch(function() { return null; }),
                github.readFile('data/market/sectors.json').catch(function() { return null; }),
                github.readFile('data/market/markets.json').catch(function() { return null; }),
                github.readFile('data/market/market_context.json').catch(function() { return null; })
            ]);

            // CRITICAL FIX: parse strings to objects
            var eu = _safeParse(r[0]);
            var us = _safeParse(r[1]);
            var sec = _safeParse(r[2]);
            var mkt = _safeParse(r[3]);
            var ctx = _safeParse(r[4]);

            _mktCache = {
                stocksEurope: (eu && eu.stocks) ? eu.stocks : [],
                stocksUS: (us && us.stocks) ? us.stocks : [],
                sectors: (sec && sec.sectors) ? sec.sectors : {},
                indices: (mkt && mkt.indices) ? mkt.indices : {},
                context: ctx || {}
            };
            _mktCacheTs = Date.now();

            console.log('[Grader] Market loaded (with parse fix):',
                _mktCache.stocksEurope.length, 'EU stocks,',
                _mktCache.stocksUS.length, 'US stocks,',
                Object.keys(_mktCache.sectors).length, 'sectors');

            // Debug: log first stock found
            if (_mktCache.stocksEurope.length > 0) {
                var sample = _mktCache.stocksEurope[0];
                console.log('[Grader] Sample EU stock:', sample.ticker, sample.name, 'Buffett:', sample.buffett_score);
            }

            return _mktCache;
        };
        console.log('[GraderFix] _loadAllMarketData patched with JSON.parse safety');
    } else {
        console.warn('[GraderFix] _loadAllMarketData not found, skipping patch');
    }

    // ─── FIX 2: Override renderGradingSection to add Refresh btn ─
    if (typeof renderGradingSection === 'function') {
        var _origRender = renderGradingSection;
        renderGradingSection = function(grading) {
            var html = _origRender(grading);
            // Add refresh button at the end of the grading section
            if (grading && grading.grade) {
                var refreshBtn = '<div style="margin-top:12px;text-align:right">' +
                    '<button onclick="triggerGrading(this)" style="' +
                    'padding:6px 16px;border-radius:6px;border:1px solid var(--border);' +
                    'background:transparent;color:var(--text-muted);cursor:pointer;font-size:12px' +
                    '">\ud83d\udd04 Actualiser le grading</button></div>';
                // Insert before closing </div>
                html = html.replace(/<\/div>\s*$/, refreshBtn + '</div>');
            }
            return html;
        };
        // Also update ProposalGrader export
        if (window.ProposalGrader) {
            window.ProposalGrader.renderSection = renderGradingSection;
        }
        console.log('[GraderFix] renderGradingSection patched with refresh button');
    }

    // ─── FIX 3: Force clear market cache on load ─────────────────
    // So the new parse-safe version runs on next grading
    _mktCache = null;
    _mktCacheTs = 0;
    console.log('[GraderFix] Market cache cleared, will reload with parse safety');

})();

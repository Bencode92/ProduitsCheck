// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Liquidités Fix v2: Read from catManager.objectives
// ByCam/Caméléons amounts come from "Objectifs & Trésorerie" in CAT
// ═══════════════════════════════════════════════════════════════

(function() {
    var _fixInterval = setInterval(function() {
        if (typeof _renderLiquiditesSection !== 'function') return;
        clearInterval(_fixInterval);

        window._renderLiquiditesSection = _renderLiquiditesSection = function(state) {
            var portfolio = state.portfolio || [];
            if (typeof ENVELOPES === 'undefined' || !ENVELOPES) return '';

            // Read liquidity amounts from catManager.objectives (set in CAT > Objectifs)
            var cashByCam = 0, cashCameleons = 0;
            if (typeof catManager !== 'undefined' && catManager.objectives) {
                cashByCam = parseFloat(catManager.objectives.cashByCam) || 0;
                cashCameleons = parseFloat(catManager.objectives.cashCameleons) || 0;
            }
            var totalLiquidity = cashByCam + cashCameleons;
            if (totalLiquidity === 0) return '';

            // Map envelope id → configured liquidity
            var envLiquidity = { bycam: cashByCam, cameleons: cashCameleons };

            // Compute per-envelope: how much is already deployed in structurés
            var envs = ENVELOPES.filter(function(e) { return e.id && envLiquidity[e.id] > 0; });
            var envData = envs.map(function(env) {
                var envProducts = portfolio.filter(function(p) { return p.envelope === env.id; });
                var envStruct = envProducts.reduce(function(s, p) { return s + (parseFloat(p.investedAmount) || 0); }, 0);
                return { id: env.id, label: env.label, icon: env.icon, color: env.color, liquidity: envLiquidity[env.id], structAmount: envStruct };
            });

            // CAT total
            var catTotal = 0, catRate = 0;
            if (typeof catManager !== 'undefined' && catManager.deposits) {
                var catActive = catManager.deposits.filter(function(d) { return d.status === 'active'; });
                catActive.forEach(function(d) { catTotal += parseFloat(d.amount) || 0; });
                if (catActive.length > 0) {
                    var totalW = 0, totalA = 0;
                    catActive.forEach(function(d) { var a = parseFloat(d.amount) || 0; totalW += a * (parseFloat(d.rate) || 0); totalA += a; });
                    if (totalA > 0) catRate = totalW / totalA;
                }
            }

            var totalStruct = portfolio.reduce(function(s, p) { return s + (parseFloat(p.investedAmount) || 0); }, 0);

            // Build HTML
            var html = '<div style="margin-bottom:20px;padding:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius)" data-section="liquidites-disponibles">';
            html += '<div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:12px">Liquidit\u00e9s disponibles</div>';

            // Envelope cards
            html += '<div style="display:grid;grid-template-columns:repeat(' + envData.length + ',1fr);gap:12px;margin-bottom:12px">';
            envData.forEach(function(e) {
                html += '<div style="background:var(--bg-card);border:1px solid ' + e.color + '33;border-radius:var(--radius-sm);padding:12px;display:flex;justify-content:space-between;align-items:center">';
                html += '<div><span style="color:' + e.color + ';font-weight:600;font-size:13px">' + e.icon + ' ' + e.label + '</span>';
                if (e.structAmount > 0) html += '<div style="font-size:10px;color:var(--text-dim);margin-top:2px">D\u00e9j\u00e0 en structur\u00e9s : ' + formatNumber(e.structAmount) + '\u20ac</div>';
                html += '</div>';
                html += '<span style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + e.color + '">' + formatNumber(e.liquidity) + '\u20ac</span>';
                html += '</div>';
            });
            html += '</div>';

            // Progress bar
            var total = catTotal + totalStruct + totalLiquidity;
            if (total > 0) {
                var catPct = Math.round(catTotal / total * 100);
                var structPct = Math.round(totalStruct / total * 100);
                var investPct = Math.max(0, 100 - catPct - structPct);
                html += '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:6px">';
                if (catPct > 0) html += '<div style="width:' + catPct + '%;background:var(--green)"></div>';
                if (structPct > 0) html += '<div style="width:' + structPct + '%;background:var(--orange)"></div>';
                if (investPct > 0) html += '<div style="width:' + investPct + '%;background:var(--cyan)"></div>';
                html += '</div>';
                html += '<div style="display:flex;gap:16px;font-size:10px;color:var(--text-dim)">';
                if (catTotal > 0) html += '<span>\u25a0 CAT ' + formatNumber(catTotal) + '\u20ac' + (catRate > 0 ? ' (' + catRate.toFixed(1) + '%)' : '') + '</span>';
                html += '<span>\u25a0 Structur\u00e9s ' + formatNumber(totalStruct) + '\u20ac</span>';
                html += '<span>\u25a0 \u00c0 investir ' + formatNumber(totalLiquidity) + '\u20ac</span>';
                html += '</div>';
            }

            html += '</div>';
            return html;
        };

        console.log('[StructBoard] Liquidit\u00e9s fix v2: reads from catManager.objectives');
    }, 150);
    setTimeout(function() { clearInterval(_fixInterval); }, 8000);
})();

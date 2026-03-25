// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Liquidités Fix v4: Show "Liquidité structurés" per envelope
// Shows cash products (grade "-") per envelope, not total structurés
// ═══════════════════════════════════════════════════════════════

(function() {
    var _fixInterval = setInterval(function() {
        if (typeof _renderLiquiditesSection !== 'function') return;
        clearInterval(_fixInterval);

        window._renderLiquiditesSection = _renderLiquiditesSection = function(state) {
            var portfolio = state.portfolio || [];
            if (typeof ENVELOPES === 'undefined' || !ENVELOPES) return '';

            var cashByCam = 0, cashCameleons = 0;
            if (typeof catManager !== 'undefined' && catManager.objectives) {
                cashByCam = parseFloat(catManager.objectives.cashByCam) || 0;
                cashCameleons = parseFloat(catManager.objectives.cashCameleons) || 0;
            }
            var totalLiquidity = cashByCam + cashCameleons;
            if (totalLiquidity === 0) return '';

            // Per-envelope: cash products (grade "-") = liquidité structurés
            var liqStructByCam = 0, liqStructCameleons = 0;
            portfolio.forEach(function(p) {
                var isCash = p.grading && p.grading.grade === '-';
                var amount = parseFloat(p.investedAmount) || 0;
                if (isCash) {
                    if (p.envelope === 'bycam') liqStructByCam += amount;
                    else if (p.envelope === 'cameleons') liqStructCameleons += amount;
                }
            });

            // Total structured (non-cash)
            var totalStruct = portfolio.filter(function(p) { return !p.grading || p.grading.grade !== '-'; })
                .reduce(function(s, p) { return s + (parseFloat(p.investedAmount) || 0); }, 0);

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

            var bcColor = '#3B82F6', camColor = '#A855F7';

            var html = '<div style="margin-bottom:20px;padding:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius)" data-section="liquidites-disponibles">';
            html += '<div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:12px">Liquidit\u00e9s disponibles</div>';

            // ── Two envelope cards ──
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';

            // ByCam card
            html += '<div style="background:var(--bg-card);border:1px solid ' + bcColor + '33;border-radius:var(--radius-sm);padding:12px">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center">';
            html += '<span style="color:' + bcColor + ';font-weight:600;font-size:13px">\ud83c\udfe6 ByCam</span>';
            html += '<span style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + bcColor + '">' + formatNumber(cashByCam) + '\u20ac</span>';
            html += '</div>';
            if (liqStructByCam > 0) html += '<div style="font-size:10px;color:var(--text-dim);margin-top:4px">Liquidit\u00e9 structur\u00e9s : ' + formatNumber(liqStructByCam) + '\u20ac</div>';
            html += '</div>';

            // Caméléons card
            html += '<div style="background:var(--bg-card);border:1px solid ' + camColor + '33;border-radius:var(--radius-sm);padding:12px">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center">';
            html += '<span style="color:' + camColor + ';font-weight:600;font-size:13px">\ud83e\udd8e Cam\u00e9l\u00e9ons</span>';
            html += '<span style="font-family:var(--mono);font-size:20px;font-weight:800;color:' + camColor + '">' + formatNumber(cashCameleons) + '\u20ac</span>';
            html += '</div>';
            if (liqStructCameleons > 0) html += '<div style="font-size:10px;color:var(--text-dim);margin-top:4px">Liquidit\u00e9 structur\u00e9s : ' + formatNumber(liqStructCameleons) + '\u20ac</div>';
            html += '</div>';

            html += '</div>';

            // ── Progress bar ──
            var totalAll = catTotal + totalStruct + totalLiquidity;
            if (totalAll > 0) {
                var catPct = Math.round(catTotal / totalAll * 100);
                var structPct = Math.round(totalStruct / totalAll * 100);
                var investPct = Math.max(0, 100 - catPct - structPct);
                html += '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:6px">';
                if (catPct > 0) html += '<div style="width:' + catPct + '%;background:var(--green)"></div>';
                if (structPct > 0) html += '<div style="width:' + structPct + '%;background:var(--orange)"></div>';
                if (investPct > 0) html += '<div style="width:' + investPct + '%;background:var(--cyan)"></div>';
                html += '</div>';
                html += '<div style="display:flex;flex-wrap:wrap;gap:12px;font-size:10px;color:var(--text-dim)">';
                if (catTotal > 0) html += '<span><span style="color:var(--green)">\u25a0</span> CAT ' + formatNumber(catTotal) + '\u20ac' + (catRate > 0 ? ' (' + catRate.toFixed(1) + '%)' : '') + '</span>';
                html += '<span><span style="color:var(--orange)">\u25a0</span> Structur\u00e9s ' + formatNumber(totalStruct) + '\u20ac</span>';
                html += '<span><span style="color:var(--cyan)">\u25a0</span> \u00c0 investir ' + formatNumber(totalLiquidity) + '\u20ac</span>';
                html += '</div>';
            }

            html += '</div>';
            return html;
        };

        console.log('[StructBoard] Liquidit\u00e9s fix v4: liquidit\u00e9 structur\u00e9s per envelope');
    }, 150);
    setTimeout(function() { clearInterval(_fixInterval); }, 8000);
})();

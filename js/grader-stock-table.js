// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader Stock Table v1.0
// ═══════════════════════════════════════════════════════════════
// Adds a compact underlying data table to the grading section
// Loads AFTER proposal-grader.js and grader-data-fix.js
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ─── Wrap gradeProposal to inject underlyingData into result ───
    if (typeof gradeProposal === 'function') {
        var _origGrade = gradeProposal;
        gradeProposal = async function(product) {
            var result = await _origGrade(product);
            // After grading, attach stock data summary for UI table
            try {
                if (_mktCache) {
                    var p = _graderNormalize(product);
                    var mkt = _extractStockData(p, _mktCache);
                    if (mkt.available && mkt.stocks) {
                        result.underlyingData = mkt.stocks.filter(function(s) { return s.found; }).map(function(s) {
                            return {
                                name: s.name, ticker: s.ticker, sector: s.sector || '—',
                                perf_ytd: s.perf_ytd, perf_1y: s.perf_1y, volatility_3y: s.volatility_3y,
                                buffett_score: s.buffett_score, quality_score: s.quality_score,
                                max_drawdown_3y: s.max_drawdown_3y
                            };
                        });
                        // Also save to product for persistence
                        product.grading = result;
                    }
                }
            } catch(e) { console.warn('[StockTable] Could not attach data:', e.message); }
            return result;
        };
        // Update reference
        if (window.ProposalGrader) window.ProposalGrader.grade = gradeProposal;
    }

    // ─── Wrap renderGradingSection to inject the table ───
    if (typeof renderGradingSection === 'function') {
        var _origRender = renderGradingSection;
        renderGradingSection = function(grading) {
            var html = _origRender(grading);
            if (!grading || !grading.underlyingData || grading.underlyingData.length === 0) return html;

            // Build compact table
            var t = '<div style="margin-bottom:16px;margin-top:4px">';
            t += '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px">\ud83d\udcca Sous-jacents</div>';
            t += '<div style="overflow-x:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.08)">';
            t += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
            // Header
            t += '<tr style="background:rgba(255,255,255,0.03)">';
            t += '<th style="text-align:left;padding:5px 8px;color:var(--text-muted);font-weight:500;white-space:nowrap">Sous-jacent</th>';
            t += '<th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:500">YTD</th>';
            t += '<th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:500">1Y</th>';
            t += '<th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:500">Vol</th>';
            t += '<th style="text-align:right;padding:5px 6px;color:var(--text-muted);font-weight:500">DD</th>';
            t += '<th style="text-align:center;padding:5px 6px;color:var(--text-muted);font-weight:500">Buffett</th>';
            t += '<th style="text-align:center;padding:5px 6px;color:var(--text-muted);font-weight:500">Quality</th>';
            t += '</tr>';

            // Rows
            grading.underlyingData.forEach(function(s) {
                var yC = s.perf_ytd >= 0 ? '#06D6A0' : '#EF233C';
                var oC = s.perf_1y >= 0 ? '#06D6A0' : '#EF233C';
                var bC = s.buffett_score >= 60 ? '#06D6A0' : s.buffett_score >= 40 ? '#FFB627' : '#EF233C';
                var qC = s.quality_score >= 60 ? '#06D6A0' : s.quality_score >= 40 ? '#FFB627' : '#EF233C';
                var volC = s.volatility_3y > 35 ? '#EF233C' : s.volatility_3y > 25 ? '#FFB627' : '#06D6A0';
                var ddC = Math.abs(s.max_drawdown_3y || 0) > 35 ? '#EF233C' : Math.abs(s.max_drawdown_3y || 0) > 25 ? '#FFB627' : '#06D6A0';

                t += '<tr style="border-top:1px solid rgba(255,255,255,0.05)">';
                // Name + ticker
                t += '<td style="padding:5px 8px;white-space:nowrap"><span style="font-weight:600">' + s.name + '</span> <span style="color:var(--text-muted);font-size:10px">' + s.ticker + '</span></td>';
                // YTD
                t += '<td style="text-align:right;padding:5px 6px;color:' + yC + ';font-weight:500">' + _fmtPct(s.perf_ytd) + '</td>';
                // 1Y
                t += '<td style="text-align:right;padding:5px 6px;color:' + oC + ';font-weight:500">' + _fmtPct(s.perf_1y) + '</td>';
                // Vol
                t += '<td style="text-align:right;padding:5px 6px;color:' + volC + '">' + _fmtVal(s.volatility_3y, '%') + '</td>';
                // DD
                t += '<td style="text-align:right;padding:5px 6px;color:' + ddC + '">' + (s.max_drawdown_3y != null ? '-' + Math.abs(s.max_drawdown_3y).toFixed(0) + '%' : '\u2014') + '</td>';
                // Buffett
                t += '<td style="text-align:center;padding:5px 6px"><span style="display:inline-block;min-width:32px;padding:1px 6px;border-radius:4px;background:' + bC + '20;color:' + bC + ';font-weight:700;font-size:11px">' + _fmtVal(s.buffett_score, '') + '</span></td>';
                // Quality
                t += '<td style="text-align:center;padding:5px 6px"><span style="display:inline-block;min-width:32px;padding:1px 6px;border-radius:4px;background:' + qC + '20;color:' + qC + ';font-weight:700;font-size:11px">' + _fmtVal(s.quality_score, '') + '</span></td>';
                t += '</tr>';
            });

            t += '</table></div></div>';

            // Insert table before scenarios (or before risks if no scenarios)
            var scenarioAnchor = '<div style="display:grid;grid-template-columns:repeat(4,1fr)';
            var riskAnchor = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><strong>Risques';
            var insertPos = html.indexOf(scenarioAnchor);
            if (insertPos === -1) insertPos = html.indexOf(riskAnchor);
            if (insertPos === -1) {
                // Fallback: insert before closing div
                var lastDiv = html.lastIndexOf('</div>');
                if (lastDiv > 0) insertPos = lastDiv;
            }
            if (insertPos > 0) {
                html = html.substring(0, insertPos) + t + html.substring(insertPos);
            }

            return html;
        };
        if (window.ProposalGrader) window.ProposalGrader.renderSection = renderGradingSection;
    }

    function _fmtPct(v) {
        if (v == null) return '\u2014';
        return (v >= 0 ? '+' : '') + (typeof v === 'number' ? v.toFixed(1) : v) + '%';
    }
    function _fmtVal(v, suffix) {
        if (v == null) return '\u2014';
        return (typeof v === 'number' ? Math.round(v) : v) + (suffix || '');
    }

    console.log('[StructBoard] Grader Stock Table v1.0 \u2014 underlying metrics in grading UI');
})();

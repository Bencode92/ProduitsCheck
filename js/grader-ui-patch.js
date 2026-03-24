// STRUCTBOARD — Grader UI Patch v1.5 — Underlying stock data table
// Adds: stock data saved in grading result + mini table in renderGradingSection
// This file patches proposal-grader.js AFTER it loads

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // PATCH 1: Save stock data in grading result
    // ═══════════════════════════════════════════════════════════════
    // Wrap gradeProposal to inject stockData into the result
    if (typeof gradeProposal === 'function') {
        var _origGrade = gradeProposal;
        gradeProposal = async function(product) {
            var result = await _origGrade(product);
            // After grading, attach stock data from cache if available
            try {
                if (_mktCache && result && result.metadata && !result.metadata.stockData) {
                    var p = _graderNormalize(product);
                    var stockInfo = _extractStockData(p, _mktCache);
                    if (stockInfo.available && stockInfo.stocks.length > 0) {
                        // Save compact stock data (only what we need for the table)
                        result.metadata.stockData = stockInfo.stocks.filter(function(s) { return s.found; }).map(function(s) {
                            return {
                                name: s.name, ticker: s.ticker, sector: s.sector || '—',
                                perf_ytd: s.perf_ytd, perf_1y: s.perf_1y,
                                volatility_3y: s.volatility_3y, max_drawdown_3y: s.max_drawdown_3y,
                                buffett_score: s.buffett_score, quality_score: s.quality_score,
                                buffett_grade: s.buffett_grade
                            };
                        });
                        // Re-save to product
                        product.grading = result;
                    }
                }
            } catch(e) { console.warn('[GraderUI] stockData attach:', e.message); }
            return result;
        };
        // Update ProposalGrader reference
        if (window.ProposalGrader) window.ProposalGrader.grade = gradeProposal;
    }

    // ═══════════════════════════════════════════════════════════════
    // PATCH 2: Save grading to BOTH proposal file AND portfolio.json
    // ═══════════════════════════════════════════════════════════════
    // When triggerGrading runs on a portfolio product, save to portfolio.json too
    if (typeof window.triggerGrading === 'function') {
        var _origTrigger = window.triggerGrading;
        window.triggerGrading = async function(btn) {
            await _origTrigger(btn);
            // After grading, also save to portfolio.json if product is in portfolio
            try {
                var card = btn.closest('.product-detail, [data-product-id]');
                if (!card) return;
                var productId = card.dataset.productId || (app.state.currentProduct && app.state.currentProduct.id);
                if (!productId) return;
                var pf = app.state.portfolio || [];
                var pfProduct = pf.find(function(p) { return p.id === productId; });
                if (pfProduct && pfProduct.grading) {
                    _saveGrading(pfProduct);
                }
            } catch(e) { console.warn('[GraderUI] portfolio save:', e.message); }
        };
    }

    async function _saveGrading(product) {
        try {
            // Save to portfolio.json
            var pf = app.state.portfolio || [];
            var idx = pf.findIndex(function(p) { return p.id === product.id; });
            if (idx >= 0) {
                pf[idx] = product;
                await github.writeFile('data/portfolio.json', JSON.stringify({ products: pf }, null, 2));
                console.log('[GraderUI] Saved grading to portfolio.json for', product.id);
            }
        } catch(e) { console.warn('[GraderUI] save:', e.message); }
    }

    // ═══════════════════════════════════════════════════════════════
    // PATCH 3: Render stock data table in grading section
    // ═══════════════════════════════════════════════════════════════

    function _renderStockTable(stockData) {
        if (!stockData || stockData.length === 0) return '';

        function _perfColor(v) {
            if (v == null) return '#888';
            return v >= 10 ? '#06D6A0' : v >= 0 ? '#4ECDC4' : v >= -10 ? '#FFB627' : '#EF233C';
        }
        function _scoreColor(v) {
            if (v == null) return '#888';
            return v >= 70 ? '#06D6A0' : v >= 50 ? '#4ECDC4' : v >= 30 ? '#FFB627' : '#EF233C';
        }
        function _fmt(v, suffix) {
            if (v == null) return '<span style="color:#555">\u2014</span>';
            var color = suffix === '%' ? _perfColor(v) : _scoreColor(v);
            return '<span style="color:' + color + ';font-weight:600">' + (v >= 0 && suffix === '%' ? '+' : '') + v + (suffix || '') + '</span>';
        }

        var cellStyle = 'padding:4px 6px;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.06);white-space:nowrap;';
        var headerStyle = cellStyle + 'color:var(--text-muted);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;';

        var h = '<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px">\ud83d\udcca Sous-jacents</div>';
        h += '<div style="overflow-x:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.08)">';
        h += '<table style="width:100%;border-collapse:collapse;font-size:11px">';

        // Header
        h += '<tr style="background:rgba(255,255,255,0.03)">';
        h += '<th style="' + headerStyle + 'text-align:left">Nom</th>';
        h += '<th style="' + headerStyle + 'text-align:right">YTD</th>';
        h += '<th style="' + headerStyle + 'text-align:right">1 an</th>';
        h += '<th style="' + headerStyle + 'text-align:right">Vol 3Y</th>';
        h += '<th style="' + headerStyle + 'text-align:right">DD 3Y</th>';
        h += '<th style="' + headerStyle + 'text-align:right">Buffett</th>';
        h += '<th style="' + headerStyle + 'text-align:right">Quality</th>';
        h += '</tr>';

        // Rows
        stockData.forEach(function(s, i) {
            var rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
            h += '<tr style="background:' + rowBg + '">';
            h += '<td style="' + cellStyle + 'text-align:left"><span style="font-weight:600;color:var(--text-primary,#e0e0e0)">' + s.name + '</span> <span style="color:#666;font-size:10px">' + s.ticker + '</span></td>';
            h += '<td style="' + cellStyle + 'text-align:right">' + _fmt(s.perf_ytd, '%') + '</td>';
            h += '<td style="' + cellStyle + 'text-align:right">' + _fmt(s.perf_1y, '%') + '</td>';
            h += '<td style="' + cellStyle + 'text-align:right">' + _fmt(s.volatility_3y, '%') + '</td>';
            h += '<td style="' + cellStyle + 'text-align:right">' + _fmt(s.max_drawdown_3y != null ? -Math.abs(s.max_drawdown_3y) : null, '%') + '</td>';
            h += '<td style="' + cellStyle + 'text-align:right">' + _fmt(s.buffett_score, '') + '<span style="font-size:9px;color:#666">/' + (s.buffett_grade || '?') + '</span></td>';
            h += '<td style="' + cellStyle + 'text-align:right">' + _fmt(s.quality_score, '') + '</td>';
            h += '</tr>';
        });

        h += '</table></div></div>';
        return h;
    }

    // Override renderGradingSection to inject stock table
    if (typeof renderGradingSection === 'function') {
        var _origRender = renderGradingSection;
        renderGradingSection = function(grading) {
            var html = _origRender(grading);
            // Inject stock table AFTER the pillar bars, BEFORE scenarios
            if (grading && grading.metadata && grading.metadata.stockData && grading.metadata.stockData.length > 0) {
                var stockHtml = _renderStockTable(grading.metadata.stockData);
                // Find insertion point: after pillar bars div, before scenarios grid
                var scenarioIdx = html.indexOf('grid-template-columns:repeat(4');
                if (scenarioIdx > 0) {
                    // Insert before the scenario grid container
                    var divStart = html.lastIndexOf('<div style="display:grid', scenarioIdx);
                    if (divStart > 0) {
                        html = html.substring(0, divStart) + stockHtml + html.substring(divStart);
                    }
                } else {
                    // No scenarios: insert before risks
                    var risksIdx = html.indexOf('<strong>Risques');
                    if (risksIdx > 0) {
                        var divR = html.lastIndexOf('<div', risksIdx);
                        if (divR > 0) html = html.substring(0, divR) + stockHtml + html.substring(divR);
                    } else {
                        // Fallback: insert before footer
                        var footerIdx = html.lastIndexOf('<div style="font-size:10px');
                        if (footerIdx > 0) html = html.substring(0, footerIdx) + stockHtml + html.substring(footerIdx);
                    }
                }
            }
            return html;
        };
        if (window.ProposalGrader) window.ProposalGrader.renderSection = renderGradingSection;
    }

    console.log('[GraderUI] v1.5 \u2014 stock data table + portfolio save patch');
})();

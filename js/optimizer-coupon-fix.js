// ═══════════════════════════════════════════════════════════════════════════════
// Optimizer Coupon Fix — Fix [object Object]% display bug
//
// After freq-fix v7, product.coupon can be an object {rate:7, annualized:true}
// The optimizer and UI render p.coupon directly as string → "[object Object]%"
// This patch ensures coupon is always a number in optimizer outputs.
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    // Safe coupon extractor: handles number, string, or object
    function _safeCoupon(c) {
        if (typeof c === 'number') return c;
        if (typeof c === 'string') return parseFloat(c) || 0;
        if (typeof c === 'object' && c !== null) {
            return parseFloat(c.rate || c.annualized || c.taux || c.annual) || 0;
        }
        return 0;
    }

    function _patch() {
        if (typeof buildStructuredOptimization !== 'function') return false;

        // Wrap buildStructuredOptimization to fix coupon values in output
        var _origBuild = buildStructuredOptimization;
        window.buildStructuredOptimization = function() {
            var result = _origBuild();

            // Fix portfolio analysis coupons
            if (result.portfolioAnalysis) {
                result.portfolioAnalysis.forEach(function(p) {
                    p.coupon = _safeCoupon(p.coupon);
                    // Recalc if annualReturn is 0 due to object coupon
                    if (p.annualReturn === 0 && p.coupon > 0 && p.amount > 0) {
                        p.annualReturn = Math.round(p.amount * p.coupon / 100);
                        p.catReturn = Math.round(p.amount * (result.catBenchmark || 2.5) / 100);
                        p.excessVsCat = p.annualReturn - p.catReturn;
                    }
                });
            }

            // Fix allocation plan coupons
            if (result.allocationPlan) {
                result.allocationPlan.forEach(function(a) {
                    a.coupon = _safeCoupon(a.coupon);
                    // Recalc if expectedReturn/annualReturn is 0 due to object coupon
                    if (a.allocatedAmount > 0 && a.coupon > 0) {
                        if (!a.annualReturn || a.annualReturn === 0) {
                            var probCoupon = a.probCoupon || 0.70;
                            a.annualReturn = Math.round(a.allocatedAmount * a.coupon / 100 * probCoupon);
                            a.catReturn = Math.round(a.allocatedAmount * (result.catBenchmark || 2.5) / 100);
                            a.excessVsCat = a.annualReturn - a.catReturn;
                        }
                        if (!a.expectedReturn || a.expectedReturn === 0) {
                            a.expectedReturn = a.annualReturn; // already prob-adjusted from sprint1
                        }
                    }
                });
            }

            // Recalculate totals
            result.totalPortfolioReturn = (result.portfolioAnalysis || []).reduce(function(s, p) {
                return s + (p.annualReturn || 0);
            }, 0);
            result.deployedReturn = (result.allocationPlan || []).reduce(function(s, a) {
                return s + (a.annualReturn || a.expectedReturn || 0);
            }, 0);
            result.deployedCatReturn = Math.round((result.deployedAmount || 0) * (result.catBenchmark || 2.5) / 100);
            result.deployedExcess = result.deployedReturn - result.deployedCatReturn;

            // Add global summary for display
            var totalInvested = (result.totalPortfolioInvested || 0) + (result.deployedAmount || 0);
            var totalReturn = result.totalPortfolioReturn + result.deployedReturn;
            var totalCatReturn = Math.round(totalInvested * (result.catBenchmark || 2.5) / 100);
            result._globalSummary = {
                totalInvested: totalInvested,
                totalReturn: totalReturn,
                totalCatReturn: totalCatReturn,
                totalExcess: totalReturn - totalCatReturn,
                yieldPct: totalInvested > 0 ? Math.round(totalReturn / totalInvested * 10000) / 100 : 0,
                catYieldPct: Math.round((result.catBenchmark || 2.5) * 100) / 100
            };

            return result;
        };

        // Also patch the renderStructOptimizationTable to show global summary
        if (typeof renderStructOptimizationTable === 'function') {
            var _origRender = renderStructOptimizationTable;
            window.renderStructOptimizationTable = function(analysis) {
                var html = _origRender(analysis);

                // Inject global summary before the end
                if (analysis._globalSummary) {
                    var gs = analysis._globalSummary;
                    var summaryHtml = '<div style="margin-top:16px;border:2px solid var(--accent);border-radius:var(--radius);overflow:hidden">' +
                        '<div style="padding:12px 16px;background:rgba(59,130,246,0.1);border-bottom:1px solid var(--accent);display:flex;justify-content:space-between;align-items:center">' +
                        '<span style="font-size:13px;font-weight:700;color:var(--accent)">' +
                        '\ud83c\udfaf BILAN GLOBAL (Portefeuille + D\u00e9ploiement)</span></div>' +
                        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border)">' +
                        '<div style="background:var(--bg-card);padding:14px;text-align:center">' +
                        '<div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Total investi</div>' +
                        '<div style="font-size:20px;font-weight:800;color:var(--text-bright);font-family:var(--mono)">' + (typeof formatNumber === 'function' ? formatNumber(gs.totalInvested) : gs.totalInvested) + '\u20ac</div></div>' +
                        '<div style="background:var(--bg-card);padding:14px;text-align:center">' +
                        '<div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Rendement esp\u00e9r\u00e9</div>' +
                        '<div style="font-size:20px;font-weight:800;color:var(--green);font-family:var(--mono)">+' + (typeof formatNumber === 'function' ? formatNumber(gs.totalReturn) : gs.totalReturn) + '\u20ac<span style="font-size:11px">/an</span></div>' +
                        '<div style="font-size:11px;color:var(--green);font-weight:600">' + gs.yieldPct + '%</div></div>' +
                        '<div style="background:var(--bg-card);padding:14px;text-align:center">' +
                        '<div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Si tout en CAT</div>' +
                        '<div style="font-size:20px;font-weight:800;color:var(--orange);font-family:var(--mono)">+' + (typeof formatNumber === 'function' ? formatNumber(gs.totalCatReturn) : gs.totalCatReturn) + '\u20ac<span style="font-size:11px">/an</span></div>' +
                        '<div style="font-size:11px;color:var(--orange)">' + gs.catYieldPct + '%</div></div>' +
                        '<div style="background:var(--bg-card);padding:14px;text-align:center">' +
                        '<div style="font-size:9px;text-transform:uppercase;color:var(--text-muted)">Exc\u00e9dent annuel</div>' +
                        '<div style="font-size:20px;font-weight:800;color:' + (gs.totalExcess >= 0 ? 'var(--green)' : 'var(--red)') + ';font-family:var(--mono)">' + (gs.totalExcess >= 0 ? '+' : '') + (typeof formatNumber === 'function' ? formatNumber(gs.totalExcess) : gs.totalExcess) + '\u20ac</div>' +
                        '<div style="font-size:11px;color:' + (gs.totalExcess >= 0 ? 'var(--green)' : 'var(--red)') + '">+' + (gs.yieldPct - gs.catYieldPct).toFixed(2) + '% vs CAT</div></div>' +
                        '</div></div>';
                    html += summaryHtml;
                }

                return html;
            };
        }

        console.log('[optimizer-coupon-fix] Fixed [object Object] coupon + added global summary');
        return true;
    }

    // Wait for optimizer to be ready
    var attempts = 0;
    var iv = setInterval(function() {
        attempts++;
        if (_patch() || attempts > 150) clearInterval(iv);
    }, 200);
})();

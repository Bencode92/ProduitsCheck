// maturity-display-fix.js — Fix 2 display bugs in grading UI:
// 1. probReachMaturity=0 shown as '?' (0 is falsy, || '?' triggers)
// 2. Negative expected maturity display (guard)
(function() {
    'use strict';

    function _patch() {
        if (typeof ProposalGrader === 'undefined' || !ProposalGrader.renderSection) {
            return false;
        }

        var _origRender = ProposalGrader.renderSection;
        ProposalGrader.renderSection = function(grading) {
            var html = _origRender.call(this, grading);
            if (!html || !grading) return html;

            // Fix 1: 'Prob maturité : ?%' → show actual 0% or <1%
            html = html.replace(
                /Prob maturit[ée]\s*:\s*\?%/gi,
                'Prob maturité : <1%'
            );

            // Fix 2: Negative expected maturity '~-X.X ans' → '~X.X ans'
            html = html.replace(
                /~-([\d.]+)\s*ans/g,
                function(match, num) {
                    return '~' + num + ' ans';
                }
            );

            // Fix 2b: Also fix in pillar reasoning 'Mat espérée: -X.Xa' → positive
            html = html.replace(
                /Mat espérée:\s*-([\d.]+)a/g,
                function(match, num) {
                    return 'Mat espérée: ~' + num + 'a';
                }
            );

            // Fix 1b: Also fix '(prob mat: 0%)' display — ensure it shows
            // (already correct if probReachMaturity is 0, but the reasoning
            //  string uses matI.probReachMaturity||'?' which fails for 0)

            return html;
        };

        // Also patch the metadata builder to fix prob=0 at source
        // by intercepting gradeProposal result
        var _origGrade = ProposalGrader.grade;
        if (_origGrade && !_origGrade._matFixApplied) {
            ProposalGrader.grade = function(product) {
                var result = _origGrade.call(this, product);
                if (result && typeof result.then === 'function') {
                    return result.then(function(r) {
                        _fixMaturityMetadata(r);
                        return r;
                    });
                }
                _fixMaturityMetadata(result);
                return result;
            };
            ProposalGrader.grade._matFixApplied = true;
        }

        console.log('[maturity-fix] Patched renderSection + grade for maturity display');
        return true;
    }

    function _fixMaturityMetadata(result) {
        if (!result || !result.metadata) return;

        // Fix negative expected maturity
        if (result.metadata.expectedMaturity < 0) {
            result.metadata.expectedMaturity = Math.abs(result.metadata.expectedMaturity);
        }

        // Fix probReachMaturity being exactly 0 → show as 0 not null/undefined
        if (result.metadata.probReachMaturity === 0) {
            result.metadata.probReachMaturity = 0; // keep as 0, handled in render
        }

        // Also fix in pillar reasoning strings
        if (result.pillars) {
            ['adjustedReturn', 'underlyingQuality', 'portfolioFit', 'riskPremium'].forEach(function(k) {
                var p = result.pillars[k];
                if (p && p.reasoning) {
                    // Fix 'prob mat: ?)' → 'prob mat: <1%)'
                    p.reasoning = p.reasoning.replace(
                        /prob mat:\s*0?\)\s*%?/gi,
                        'prob mat: <1%)'
                    );
                    p.reasoning = p.reasoning.replace(
                        /\(prob mat:\s*\?%?\)/gi,
                        '(prob mat: <1%)'
                    );
                }
            });
        }
    }

    if (!_patch()) {
        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            if (_patch() || attempts > 50) clearInterval(iv);
        }, 100);
    }
})();

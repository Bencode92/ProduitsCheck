// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v3.2 Patch
// v3.2: Granular liquidity sources + bank-routed allocation
//   - Choose: CAT only / Structured only / Both
//   - Set amount to deploy from each source
//   - Structured liquidity → same bank only
//   - External liquidity → any bank
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    window._optimizerOptions = {
        entity: 'all',
        liquidityPriority: false,
        liquiditySource: 'all',
        structuredDeploy: null,
    };

    function _getLiquidityScore(product) {
        if (typeof _computeLiquidityScore === 'function') {
            try { var v6r = _computeLiquidityScore(product); if (v6r && typeof v6r.score === 'number') return v6r.score; } catch(e) {}
        }
        var g = product.grading || {};
        if (g.liquidityLevel) { var m = { L1:100, L2:75, L3:40, L4:15 }; if (m[g.liquidityLevel]) return m[g.liquidityLevel]; }
        if (product.capitalProtected) return 90;
        if (typeof _isFixedRateOrCallable === 'function' && _isFixedRateOrCallable(product)) return 75;
        var name = (product.name || '').toLowerCase();
        if (name.indexOf('callable') >= 0 || name.indexOf('taux fixe') >= 0) return 75;
        var mat = product.maturity || 0;
        return mat <= 1 ? 80 : mat <= 3 ? 50 : 20;
    }

    function _getLiquidityLabel(p) { var s = _getLiquidityScore(p); return s >= 90 ? '\ud83d\udca7L1' : s >= 70 ? '\ud83d\udca7L2' : s >= 35 ? '\ud83d\udca7L3' : '\ud83d\udca7L4'; }

    function _filterByEntity(products, entity) {
        if (!entity || entity === 'all') return products;
        return products.filter(function(p) { return p.entity === entity; });
    }

    function _identifyLiquiditySources(portfolio, entity) {
        var filtered = _filterByEntity(portfolio, entity);
        var structLiq = filtered.filter(function(p) {
            return (p.grading && p.grading.grade === '-') ||
                   (typeof _isLiquidityProduct === 'function' && typeof _graderNormalize === 'function' && _isLiquidityProduct(_graderNormalize(p)));
        });
        var byBank = {};
        structLiq.forEach(function(p) {
            var bankId = p.bankId || 'unknown';
            var bankName = '';
            if (typeof BANKS !== 'undefined') { var found = BANKS.find(function(b) { return b.id === bankId; }); if (found) bankName = found.name; }
            if (!byBank[bankId]) byBank[bankId] = { bankId: bankId, bankName: bankName || bankId, products: [], total: 0 };
            byBank[bankId].products.push(p);
            byBank[bankId].total += (parseFloat(p.investedAmount) || 0);
        });
        var totalStruct = structLiq.reduce(function(s, p) { return s + (parseFloat(p.investedAmount) || 0); }, 0);
        var externalLiq = 0;
        try {
            if (typeof _lastOptimizerResult !== 'undefined' && _lastOptimizerResult) {
                var catProducts = _lastOptimizerResult.products || [];
                if (entity !== 'all') catProducts = catProducts.filter(function(c) { return c.entity === entity; });
                externalLiq = catProducts.reduce(function(s, c) { return s + (parseFloat(c.amount) || 0); }, 0);
            }
        } catch(e) {}
        return { structured: { total: totalStruct, byBank: byBank, products: structLiq }, external: { total: externalLiq }, combined: totalStruct + externalLiq };
    }

    function _entityBtn(v, label, cur) {
        return '<button class="btn sm" style="' + (cur === v ? 'background:var(--accent);color:white;border-color:var(--accent)' : 'opacity:0.6') +
            '" onclick="_setOptimizerEntity(\'' + v + '\')">' + label + '</button>';
    }
    function _sourceBtn(v, label, cur) {
        return '<button class="btn sm" style="' + (cur === v ? 'background:var(--cyan);color:white;border-color:var(--cyan)' : 'opacity:0.6') +
            '" onclick="_setLiquiditySource(\'' + v + '\')">' + label + '</button>';
    }

    window._setOptimizerEntity = function(e) { window._optimizerOptions.entity = e; window._optimizerOptions.structuredDeploy = null; showStructuredOptimizer(); };
    window._setLiquiditySource = function(s) { window._optimizerOptions.liquiditySource = s; showStructuredOptimizer(); };
    window._toggleLiqPriority = function() { window._optimizerOptions.liquidityPriority = !window._optimizerOptions.liquidityPriority; showStructuredOptimizer(); };
    window._updateStructDeploy = function(val) {
        var v = parseInt(val) || 0;
        window._optimizerOptions.structuredDeploy = v;
        var el = document.getElementById('struct-deploy-val');
        if (el) el.textContent = formatNumber(v) + '\u20ac';
        var sources = _identifyLiquiditySources(app.state.portfolio || [], window._optimizerOptions.entity);
        var total = 0, src = window._optimizerOptions.liquiditySource;
        if (src === 'structured') total = v;
        else if (src === 'external') total = sources.external.total;
        else total = v + sources.external.total;
        var te = document.getElementById('total-deploy-val');
        if (te) te.textContent = formatNumber(total) + '\u20ac';
    };

    // ═══ MODAL ═══
    var _waitModal = setInterval(function() {
        if (typeof showStructuredOptimizer !== 'function') return;
        clearInterval(_waitModal);

        showStructuredOptimizer = function() {
            var portfolio = app.state.portfolio || [];
            var opts = window._optimizerOptions;
            var pCount = portfolio.length;
            var bycamCount = portfolio.filter(function(p) { return p.entity === 'bycam'; }).length;
            var camCount = portfolio.filter(function(p) { return p.entity === 'cameleons'; }).length;
            var noEntity = portfolio.filter(function(p) { return !p.entity; }).length;
            var sources = _identifyLiquiditySources(portfolio, opts.entity);
            var prCount = 0;
            Object.values(app.state.proposals || {}).forEach(function(arr) {
                arr.forEach(function(p) { if (p.status !== 'rejected' && p.status !== 'subscribed') prCount++; });
            });

            var structMax = sources.structured.total;
            var structDeploy = opts.structuredDeploy != null ? Math.min(opts.structuredDeploy, structMax) : structMax;
            var totalDeploy = 0;
            if (opts.liquiditySource === 'structured') totalDeploy = structDeploy;
            else if (opts.liquiditySource === 'external') totalDeploy = sources.external.total;
            else totalDeploy = structDeploy + sources.external.total;

            var structBankHtml = '';
            Object.values(sources.structured.byBank).forEach(function(bank) {
                structBankHtml += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px">' +
                    '<span style="color:var(--text-bright)">' + bank.bankName + '</span>' +
                    '<span style="color:var(--green);font-family:var(--mono);font-weight:600">' + formatNumber(bank.total) + '\u20ac</span></div>';
                bank.products.forEach(function(p) {
                    structBankHtml += '<div style="padding-left:12px;font-size:10px;color:var(--text-dim)">\u2514 ' + (p.name || '').substring(0, 35) + '</div>';
                });
            });
            var bankNames = Object.values(sources.structured.byBank).map(function(b) { return b.bankName; }).join(', ');

            var modal = document.getElementById('modal');
            modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto">' +
                '<h2 class="modal-title">\ud83d\udcca Optimiseur Structur\u00e9s v3.2</h2>' +

                // Entity
                '<div style="margin-bottom:12px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px">\ud83c\udfe2 Entit\u00e9</label>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                _entityBtn('all', 'Toutes (' + pCount + ')', opts.entity) +
                _entityBtn('bycam', '\ud83c\udfe2 ByCam (' + bycamCount + ')', opts.entity) +
                _entityBtn('cameleons', '\ud83e\udd8e Cam\u00e9leons (' + camCount + ')', opts.entity) +
                (noEntity > 0 ? '<span style="font-size:10px;color:var(--orange);align-self:center">\u26a0 ' + noEntity + ' sans entit\u00e9</span>' : '') +
                '</div></div>' +

                // Liquidity source
                '<div style="margin-bottom:16px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">' +
                '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border)"><span style="font-size:12px;font-weight:600;color:var(--cyan)">\ud83d\udcb0 Source de liquidit\u00e9</span></div>' +
                '<div style="padding:12px 14px">' +
                '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">' +
                _sourceBtn('all', '\ud83d\udcb0 Tout (' + formatNumber(sources.combined) + '\u20ac)', opts.liquiditySource) +
                _sourceBtn('structured', '\ud83c\udfe6 Structur\u00e9s (' + formatNumber(structMax) + '\u20ac)', opts.liquiditySource) +
                _sourceBtn('external', '\ud83d\udcb5 Externe (' + formatNumber(sources.external.total) + '\u20ac)', opts.liquiditySource) +
                '</div>' +

                // Structured details + slider
                (opts.liquiditySource !== 'external' && structMax > 0 ? (
                    '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:10px">' +
                    '<div style="font-size:11px;font-weight:600;color:var(--text-bright);margin-bottom:6px">\ud83c\udfe6 Liquidit\u00e9 structur\u00e9e par banque :</div>' +
                    structBankHtml +
                    '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
                    '<span style="font-size:11px;color:var(--text-muted)">Montant \u00e0 d\u00e9ployer :</span>' +
                    '<span style="font-size:13px;font-weight:700;color:var(--cyan);font-family:var(--mono)" id="struct-deploy-val">' + formatNumber(structDeploy) + '\u20ac</span></div>' +
                    '<input type="range" min="0" max="' + structMax + '" step="1000" value="' + structDeploy + '" style="width:100%;cursor:pointer;accent-color:var(--cyan)" oninput="_updateStructDeploy(this.value)">' +
                    '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-dim)"><span>0\u20ac</span><span>' + formatNumber(structMax) + '\u20ac</span></div></div>' +
                    '<div style="margin-top:8px;font-size:10px;color:var(--orange)">\u26a0 Cet argent est chez <strong>' + bankNames + '</strong> \u2192 allou\u00e9 uniquement aux produits de cette banque</div></div>'
                ) : '') +

                // External info
                (opts.liquiditySource !== 'structured' && sources.external.total > 0 ? (
                    '<div style="background:rgba(6,214,160,0.05);border:1px solid rgba(6,214,160,0.15);border-radius:var(--radius-sm);padding:10px;font-size:11px;margin-bottom:10px">' +
                    '<strong style="color:var(--green)">\ud83d\udcb5 Liquidit\u00e9 externe :</strong> ' + formatNumber(sources.external.total) + '\u20ac (CAT/comptes)' +
                    '<div style="color:var(--text-dim);margin-top:4px">\u2192 Disponible pour toutes les banques (CIC, SG, Swiss Life...)</div></div>'
                ) : '') +

                // Total
                '<div style="margin-top:10px;padding:8px 12px;background:var(--bg-card);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">' +
                '<span style="font-size:12px;font-weight:600;color:var(--text-bright)">Total \u00e0 d\u00e9ployer</span>' +
                '<span style="font-size:18px;font-weight:800;color:var(--cyan);font-family:var(--mono)" id="total-deploy-val">' + formatNumber(totalDeploy) + '\u20ac</span></div>' +
                '</div></div>' +

                // Liquidity priority
                '<div style="margin-bottom:16px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="_toggleLiqPriority()">' +
                '<div style="width:36px;height:20px;border-radius:10px;background:' + (opts.liquidityPriority ? 'var(--green)' : 'var(--border)') + ';position:relative;transition:all 0.2s">' +
                '<div style="width:16px;height:16px;border-radius:50%;background:white;position:absolute;top:2px;' + (opts.liquidityPriority ? 'left:18px' : 'left:2px') + ';transition:all 0.2s"></div></div>' +
                '<span style="font-size:12px;color:var(--text-bright)">\ud83d\udca7 Priorit\u00e9 liquidit\u00e9</span>' +
                '<span style="font-size:10px;color:var(--text-dim)">(favorise L1/L2)</span></label></div>' +

                '<button class="btn ai-glow lg" style="width:100%" onclick="launchStructOptimizer()">\ud83d\udcca Optimiser (' + formatNumber(totalDeploy) + '\u20ac \u2192 ' + prCount + ' propositions)</button>' +
                '<div id="struct-optimizer-results" style="margin-top:16px"></div>' +
                '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>' +
                '</div></div>';
            modal.classList.add('visible');
        };
        console.log('[StructBoard] Optimizer v3.2 \u2014 granular liquidity + bank routing');
    }, 250);
    setTimeout(function() { clearInterval(_waitModal); }, 10000);

    // ═══ ALLOCATION WITH BANK ROUTING ═══
    var _waitBuild = setInterval(function() {
        if (typeof buildStructuredOptimization !== 'function') return;
        if (typeof _allocateWithConstraints !== 'function') return;
        clearInterval(_waitBuild);

        var _origBuild = buildStructuredOptimization;
        buildStructuredOptimization = function() {
            var opts = window._optimizerOptions;
            var origPortfolio = app.state.portfolio;
            if (opts.entity !== 'all') app.state.portfolio = _filterByEntity(origPortfolio || [], opts.entity);
            var analysis = _origBuild();
            app.state.portfolio = origPortfolio;

            analysis._entity = opts.entity;
            analysis._entityLabel = opts.entity === 'bycam' ? 'ByCam' : opts.entity === 'cameleons' ? 'Cam\u00e9leons' : 'Toutes';

            // Identify sources
            var sources = _identifyLiquiditySources(origPortfolio, opts.entity);
            var structMax = sources.structured.total;
            var structDeploy = opts.structuredDeploy != null ? Math.min(opts.structuredDeploy, structMax) : structMax;
            var externalDeploy = sources.external.total;
            if (opts.liquiditySource === 'structured') externalDeploy = 0;
            else if (opts.liquiditySource === 'external') structDeploy = 0;

            analysis.totalLiquidity = structDeploy + externalDeploy;
            analysis._structuredLiquidity = structDeploy;
            analysis._externalLiquidity = externalDeploy;
            analysis._structuredByBank = sources.structured.byBank;

            // Tag proposals with available pools
            var proposals = analysis.allocationPlan.slice();
            proposals.forEach(function(p) {
                var pBankKey = (p.bankName || '').toLowerCase();
                p._canUseStructured = false;
                p._canUseExternal = externalDeploy > 0;
                p._liquidityLabel = _getLiquidityLabel(p);
                p._liquidityScore = _getLiquidityScore(p);

                Object.values(sources.structured.byBank).forEach(function(bank) {
                    if (pBankKey.indexOf(bank.bankName.toLowerCase()) >= 0 || bank.bankName.toLowerCase().indexOf(pBankKey) >= 0 || pBankKey.indexOf(bank.bankId) >= 0)
                        p._canUseStructured = structDeploy > 0;
                });
            });

            // Sort
            if (opts.liquidityPriority) {
                proposals.sort(function(a, b) {
                    var lA = a._liquidityScore || 0, lB = b._liquidityScore || 0;
                    if (lA !== lB) return lB - lA;
                    return (b.score || 0) - (a.score || 0);
                });
            } else {
                proposals.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
            }

            // Allocate with bank routing
            var remainStruct = structDeploy * 0.90;
            var remainExternal = externalDeploy * 0.90;
            var warnings = analysis.constraintWarnings || [];
            var totalAssets = analysis.totalPortfolioInvested + analysis.totalLiquidity;

            proposals.forEach(function(p) {
                if (p.recommendation !== 'SOUSCRIRE' && p.recommendation !== 'ENVISAGER') {
                    p.allocatedAmount = 0; p.annualReturn = 0; p.expectedReturn = 0; p.catReturn = 0; p.excessVsCat = 0;
                    return;
                }

                // Pick pool
                var pool = null, poolLabel = '';
                if (p._canUseStructured && remainStruct > 0) { pool = 'structured'; poolLabel = '\ud83c\udfe6'; }
                else if (p._canUseExternal && remainExternal > 0) { pool = 'external'; poolLabel = '\ud83d\udcb5'; }
                if (!pool) {
                    p.allocatedAmount = 0; p.annualReturn = 0; p.expectedReturn = 0; p.catReturn = 0; p.excessVsCat = 0;
                    if (!p._canUseStructured && !p._canUseExternal) warnings.push(p.name.substring(0, 25) + ': pas de liquidit\u00e9 pour cette banque');
                    else p.reason = 'Liquidit\u00e9 \u00e9puis\u00e9e';
                    return;
                }

                var remaining = pool === 'structured' ? remainStruct : remainExternal;
                var targetAmount = p.nominal > 0 ? p.nominal : Math.min(remaining, 50000);
                var gradeMultiplier = Math.max(0.6, Math.min(1.3, (p.score || 50) / 75));
                targetAmount = Math.round(targetAmount * gradeMultiplier);
                targetAmount = Math.min(targetAmount, totalAssets * 0.30, remaining);
                if (targetAmount < 5000) { p.allocatedAmount = 0; p.annualReturn = 0; p.expectedReturn = 0; p.catReturn = 0; p.excessVsCat = 0; return; }

                if (pool === 'structured') remainStruct -= targetAmount;
                else remainExternal -= targetAmount;

                var probCoupon = typeof _estimateCouponProbability === 'function' ? _estimateCouponProbability(p) : 0.75;
                var annualReturn = Math.round(targetAmount * p.coupon / 100);
                var expectedReturn = Math.round(annualReturn * probCoupon);
                var catReturn = Math.round(targetAmount * analysis.catBenchmark / 100);

                p.allocatedAmount = targetAmount;
                p.annualReturn = annualReturn;
                p.expectedReturn = expectedReturn;
                p.probCoupon = probCoupon;
                p.catReturn = catReturn;
                p.excessVsCat = expectedReturn - catReturn;
                p._pool = pool;
                p._poolLabel = poolLabel;
                p._gradeMultiplier = gradeMultiplier;

                var liqTag = opts.liquidityPriority ? p._liquidityLabel + ' ' : '';
                p.reason = liqTag + poolLabel + ' Grade ' + p.grade + ' (' + p.score + '/100) \u00d7' + gradeMultiplier.toFixed(2) +
                    ' \u2014 ' + formatNumber(targetAmount) + '\u20ac \u2192 +' + formatNumber(expectedReturn) + '\u20ac/an' +
                    (p.excessVsCat > 0 ? ' +' + formatNumber(p.excessVsCat) + '\u20ac vs CAT' : ' \u26a0 < CAT');
            });

            analysis.allocationPlan = proposals;
            analysis.deployedAmount = proposals.reduce(function(s, a) { return s + a.allocatedAmount; }, 0);
            analysis.deployedReturn = proposals.reduce(function(s, a) { return s + (a.expectedReturn || 0); }, 0);
            analysis.deployedCatReturn = Math.round(analysis.deployedAmount * analysis.catBenchmark / 100);
            analysis.deployedExcess = analysis.deployedReturn - analysis.deployedCatReturn;
            analysis.remainingCash = analysis.totalLiquidity - analysis.deployedAmount;
            analysis.constraintWarnings = warnings;
            analysis._liquidityPriority = opts.liquidityPriority;
            analysis._liquiditySource = opts.liquiditySource;

            console.log('[Optimizer v3.2] Struct: ' + formatNumber(structDeploy) + '\u20ac, Ext: ' + formatNumber(externalDeploy) + '\u20ac, Deployed: ' + formatNumber(analysis.deployedAmount) + '\u20ac');
            return analysis;
        };
    }, 300);
    setTimeout(function() { clearInterval(_waitBuild); }, 10000);
})();

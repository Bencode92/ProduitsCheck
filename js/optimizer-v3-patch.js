// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Optimizer v3.3 Patch
// v3.3: Auto-deploy + fix external liquidity detection
//   - External liquidity from CAT optimizer / entity totals
//   - Auto-deploy: optimizer decides amount based on products
//   - Slider is OPTIONAL override, not the default
//   - Bank routing: structured → same bank, external → any
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    window._optimizerOptions = {
        entity: 'all',
        liquidityPriority: false,
        liquiditySource: 'all',
        manualOverride: false,     // false = auto, true = slider controls
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

    // ═══ FIX: IDENTIFY ALL LIQUIDITY SOURCES ═══
    function _identifyLiquiditySources(portfolio, entity) {
        var filtered = _filterByEntity(portfolio, entity);

        // 1. Structured liquidity = products with grade "-" (Bond 12M, etc.)
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

        // 2. External liquidity = CAT amounts for this entity
        var externalLiq = 0;
        var externalSource = '';

        // Method A: from CAT optimizer result
        try {
            if (typeof _lastOptimizerResult !== 'undefined' && _lastOptimizerResult) {
                var catData = _lastOptimizerResult;
                // Try different formats the CAT optimizer might use
                if (catData.totalAmount) {
                    externalLiq = parseFloat(catData.totalAmount) || 0;
                    externalSource = 'CAT optimizer total';
                } else if (catData.products && catData.products.length > 0) {
                    var catProducts = catData.products;
                    if (entity !== 'all') catProducts = catProducts.filter(function(c) { return c.entity === entity; });
                    externalLiq = catProducts.reduce(function(s, c) { return s + (parseFloat(c.amount || c.nominal) || 0); }, 0);
                    externalSource = 'CAT products';
                } else if (catData.summary) {
                    // Try to parse from summary
                    var match = (catData.summary || '').match(/(\d[\d\s]*)\s*[€e]/);
                    if (match) externalLiq = parseFloat(match[1].replace(/\s/g, '')) || 0;
                    externalSource = 'CAT summary';
                }
            }
        } catch(e) {}

        // Method B: from entity display data (MY_ENTITIES amounts on dashboard)
        if (externalLiq <= 0) {
            try {
                // Look at app.state for entity liquidity
                if (app && app.state) {
                    // Check if there's a CAT section with amounts
                    var catState = app.state.cat || app.state.catProducts || [];
                    if (Array.isArray(catState)) {
                        var catFiltered = entity !== 'all' ? catState.filter(function(c) { return c.entity === entity; }) : catState;
                        externalLiq = catFiltered.reduce(function(s, c) { return s + (parseFloat(c.amount || c.investedAmount || c.nominal) || 0); }, 0);
                        if (externalLiq > 0) externalSource = 'CAT state';
                    }
                }
            } catch(e) {}
        }

        // Method C: from dashboard display (entity totals minus structured)
        if (externalLiq <= 0) {
            try {
                // The dashboard shows total per entity — subtract structured to get external
                var entityConfig = null;
                if (typeof MY_ENTITIES !== 'undefined') {
                    entityConfig = MY_ENTITIES.find(function(e) { return e.id === entity; });
                }
                // Read from DOM if visible
                var liqCards = document.querySelectorAll('[data-entity-liquidity]');
                liqCards.forEach(function(card) {
                    if (card.getAttribute('data-entity-liquidity') === entity || entity === 'all') {
                        var val = parseFloat(card.getAttribute('data-amount')) || 0;
                        if (val > 0) { externalLiq += val; externalSource = 'dashboard'; }
                    }
                });
            } catch(e) {}
        }

        // Don't double-count: external = external total minus what's already in structured
        if (externalSource === 'dashboard' && externalLiq > totalStruct) {
            externalLiq = externalLiq - totalStruct;
        }

        console.log('[LiqSources] entity=' + entity + ' | struct=' + formatNumber(totalStruct) + '\u20ac | external=' + formatNumber(externalLiq) + '\u20ac (' + externalSource + ')');

        return {
            structured: { total: totalStruct, byBank: byBank, products: structLiq },
            external: { total: externalLiq, source: externalSource },
            combined: totalStruct + externalLiq
        };
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
    window._toggleManualOverride = function() { window._optimizerOptions.manualOverride = !window._optimizerOptions.manualOverride; showStructuredOptimizer(); };
    window._updateStructDeploy = function(val) {
        var v = parseInt(val) || 0;
        window._optimizerOptions.structuredDeploy = v;
        var el = document.getElementById('struct-deploy-val'); if (el) el.textContent = formatNumber(v) + '\u20ac';
        var sources = _identifyLiquiditySources(app.state.portfolio || [], window._optimizerOptions.entity);
        var total = 0, src = window._optimizerOptions.liquiditySource;
        if (src === 'structured') total = v; else if (src === 'external') total = sources.external.total; else total = v + sources.external.total;
        var te = document.getElementById('total-deploy-val'); if (te) te.textContent = formatNumber(total) + '\u20ac';
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
            var totalAvailable = sources.combined;

            // Structured details
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
                '<h2 class="modal-title">\ud83d\udcca Optimiseur Structur\u00e9s v3.3</h2>' +

                // Entity
                '<div style="margin-bottom:12px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px">\ud83c\udfe2 Entit\u00e9</label>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                _entityBtn('all', 'Toutes (' + pCount + ')', opts.entity) +
                _entityBtn('bycam', '\ud83c\udfe2 ByCam (' + bycamCount + ')', opts.entity) +
                _entityBtn('cameleons', '\ud83e\udd8e Cam\u00e9leons (' + camCount + ')', opts.entity) +
                (noEntity > 0 ? '<span style="font-size:10px;color:var(--orange);align-self:center">\u26a0 ' + noEntity + ' sans entit\u00e9</span>' : '') +
                '</div></div>' +

                // Liquidity summary
                '<div style="margin-bottom:16px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">' +
                '<div style="padding:10px 14px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
                '<span style="font-size:12px;font-weight:600;color:var(--cyan)">\ud83d\udcb0 Liquidit\u00e9 disponible</span>' +
                '<span style="font-size:16px;font-weight:800;color:var(--cyan);font-family:var(--mono)">' + formatNumber(totalAvailable) + '\u20ac</span></div>' +
                '<div style="padding:12px 14px">' +

                // Two liquidity boxes side by side
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +

                // Structured box
                '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px">' +
                '<div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">\ud83c\udfe6 Structur\u00e9s</div>' +
                '<div style="font-size:18px;font-weight:800;color:var(--accent);font-family:var(--mono)">' + formatNumber(structMax) + '\u20ac</div>' +
                structBankHtml +
                (bankNames ? '<div style="font-size:9px;color:var(--orange);margin-top:4px">\u2192 ' + bankNames + ' uniquement</div>' : '') +
                '</div>' +

                // External box
                '<div style="background:rgba(6,214,160,0.05);border:1px solid rgba(6,214,160,0.15);border-radius:var(--radius-sm);padding:10px">' +
                '<div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">\ud83d\udcb5 Externe (CAT)</div>' +
                '<div style="font-size:18px;font-weight:800;color:var(--green);font-family:var(--mono)">' + formatNumber(sources.external.total) + '\u20ac</div>' +
                '<div style="font-size:10px;color:var(--text-dim);margin-top:4px">\u2192 Toutes banques</div>' +
                (sources.external.source ? '<div style="font-size:9px;color:var(--text-dim)">Source: ' + sources.external.source + '</div>' : '') +
                '</div></div>' +

                // Source filter
                '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">' +
                _sourceBtn('all', 'Utiliser tout', opts.liquiditySource) +
                _sourceBtn('structured', 'Structur\u00e9s seuls', opts.liquiditySource) +
                _sourceBtn('external', 'Externe seul', opts.liquiditySource) +
                '</div>' +

                // Mode: auto vs manual
                '<div style="font-size:11px;color:var(--text-muted);padding:6px 0">' +
                '\ud83e\udd16 <strong>Mode auto</strong> : l\'optimiseur d\u00e9cide le montant optimal par produit en fonction du grade, du nominal et des contraintes.' +
                '</div>' +

                '</div></div>' +

                // Liquidity priority
                '<div style="margin-bottom:16px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="_toggleLiqPriority()">' +
                '<div style="width:36px;height:20px;border-radius:10px;background:' + (opts.liquidityPriority ? 'var(--green)' : 'var(--border)') + ';position:relative;transition:all 0.2s">' +
                '<div style="width:16px;height:16px;border-radius:50%;background:white;position:absolute;top:2px;' + (opts.liquidityPriority ? 'left:18px' : 'left:2px') + ';transition:all 0.2s"></div></div>' +
                '<span style="font-size:12px;color:var(--text-bright)">\ud83d\udca7 Priorit\u00e9 liquidit\u00e9</span>' +
                '<span style="font-size:10px;color:var(--text-dim)">(favorise L1/L2)</span></label></div>' +

                '<button class="btn ai-glow lg" style="width:100%" onclick="launchStructOptimizer()">\ud83d\udcca Optimiser (' + prCount + ' propositions \u2014 max ' + formatNumber(totalAvailable) + '\u20ac)</button>' +
                '<div id="struct-optimizer-results" style="margin-top:16px"></div>' +
                '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>' +
                '</div></div>';
            modal.classList.add('visible');
        };
        console.log('[StructBoard] Optimizer v3.3 \u2014 auto-deploy + external liquidity fix');
    }, 250);
    setTimeout(function() { clearInterval(_waitModal); }, 10000);

    // ═══ ALLOCATION ═══
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

            var sources = _identifyLiquiditySources(origPortfolio, opts.entity);
            var structDeploy = sources.structured.total;
            var externalDeploy = sources.external.total;
            if (opts.liquiditySource === 'structured') externalDeploy = 0;
            else if (opts.liquiditySource === 'external') structDeploy = 0;

            analysis.totalLiquidity = structDeploy + externalDeploy;
            analysis._structuredLiquidity = structDeploy;
            analysis._externalLiquidity = externalDeploy;
            analysis._structuredByBank = sources.structured.byBank;

            // Tag proposals
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

            // ═══ AUTO-DEPLOY: optimizer decides amount per product ═══
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

                // AUTO: amount = nominal du produit (ou 30K default), adjusted by grade
                var baseAmount = p.nominal > 0 ? p.nominal : 30000;
                var gradeMultiplier = Math.max(0.6, Math.min(1.3, (p.score || 50) / 75));
                var targetAmount = Math.round(baseAmount * gradeMultiplier);

                // Constraints
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

            console.log('[Optimizer v3.3] Struct: ' + formatNumber(structDeploy) + '\u20ac, Ext: ' + formatNumber(externalDeploy) + '\u20ac');
            console.log('[Optimizer v3.3] Auto-deployed: ' + formatNumber(analysis.deployedAmount) + '\u20ac on ' +
                proposals.filter(function(p) { return p.allocatedAmount > 0; }).length + ' products, remaining: ' + formatNumber(analysis.remainingCash) + '\u20ac');
            return analysis;
        };
    }, 300);
    setTimeout(function() { clearInterval(_waitBuild); }, 10000);
})();

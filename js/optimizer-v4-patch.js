// ═══════════════════════════════════════════════════════════════════════════════
// OPTIMIZER V4 — Patch ciblé sur v3.5
//
// 4 ajustements chirurgicaux (pas une réécriture) :
// 1. Seuil dynamique selon régime MI
// 2. Contrainte enveloppe durcie (Swiss Life → Swiss Life ONLY)
// 3. "Ne rien faire" quand rien ne vaut le coup
// 4. Warning diversification sectorielle simple
// ═══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    // ========================================
    // 1. SEUIL DYNAMIQUE SELON RÉGIME
    // ========================================
    function _getDynamicThreshold() {
        var mi = null;
        try { mi = typeof _getOptimizerMI === 'function' ? _getOptimizerMI() : null; } catch(e) {}
        if (!mi) return { seuil: 55, regime: 'unknown', rationale: 'Pas de MI disponible → seuil par défaut 55' };

        var regime = (mi.regime || '').toLowerCase();
        var conf = mi.regime_confidence || 3;
        var seuil, rationale;

        if (regime === 'crisis') {
            seuil = 80;
            rationale = 'Crisis → très sélectif, garder cash';
        } else if (regime === 'recession') {
            seuil = 70;
            rationale = 'Recession → privilégier la sécurité';
        } else if (regime === 'stagflation') {
            seuil = 65;
            rationale = 'Stagflation → exigence relevée';
        } else if (regime === 'bull' || regime === 'risk-on') {
            seuil = 50;
            rationale = 'Marché porteur → déployer';
        } else {
            seuil = 55;
            rationale = 'Neutre → seuil standard';
        }

        // Modérer par la confidence (faible confidence → plus proche de 55)
        if (conf < 3) {
            seuil = Math.round(55 + (seuil - 55) * 0.5);
            rationale += ' (conf. faible, seuil modéré)';
        }

        return { seuil: seuil, regime: regime, confidence: conf, rationale: rationale };
    }

    // ========================================
    // 2. CONTRAINTE ENVELOPPE
    // ========================================
    function _matchBank(productBankName, liquidityBankName) {
        if (!productBankName || !liquidityBankName) return false;
        var p = productBankName.toLowerCase().replace(/[^a-z]/g, '');
        var l = liquidityBankName.toLowerCase().replace(/[^a-z]/g, '');
        // Exact or substring match
        return p.indexOf(l) >= 0 || l.indexOf(p) >= 0;
    }

    function _findCompatibleSource(product, sources) {
        var pBank = (product.bankName || '').toLowerCase();
        var result = { source: null, type: null, amount: 0, label: '' };

        // 1. Check structured liquidity (same bank = arbitrage)
        if (sources.structured && sources.structured.byBank) {
            Object.values(sources.structured.byBank).forEach(function(bank) {
                if (result.source) return; // already found
                if (_matchBank(pBank, bank.bankName)) {
                    result.source = bank;
                    result.type = 'ARBITRAGE';
                    result.amount = bank.total;
                    result.label = '\ud83d\udd04 Arbitrage ' + bank.bankName;
                }
            });
        }

        // 2. If no structured match, check external cash
        if (!result.source && sources.external && sources.external.total > 0) {
            result.source = sources.external;
            result.type = 'SOUSCRIPTION';
            result.amount = sources.external.total;
            result.label = '\ud83d\udcb5 Cash externe';
        }

        return result;
    }

    // ========================================
    // 3. "NE RIEN FAIRE" + WARNING DIVERSIFICATION
    // ========================================
    function _analyzePortfolioSectors(portfolio) {
        var sectors = {};
        var underlyings = [];
        (portfolio || []).forEach(function(p) {
            if (p.grading && p.grading.grade === '-') return; // skip liquidity
            var und = p.underlyings || (p.aiParsed && p.aiParsed.underlyings) || [];
            if (typeof und === 'string') und = [und];
            und.forEach(function(u) {
                var name = typeof u === 'string' ? u : (u.name || u.ticker || '');
                if (!name) return;
                underlyings.push(name.toUpperCase());
                // Rough sector detection
                var n = name.toLowerCase();
                var sector = 'autre';
                if (n.indexOf('bank') >= 0 || n.indexOf('stoxx bank') >= 0 || n.indexOf('bnp') >= 0 || n.indexOf('sg') >= 0 || n.indexOf('cr\'edit') >= 0 || n.indexOf('credit') >= 0) sector = 'finance';
                else if (n.indexOf('tech') >= 0 || n.indexOf('asml') >= 0 || n.indexOf('apple') >= 0 || n.indexOf('nvidia') >= 0 || n.indexOf('microsoft') >= 0 || n.indexOf('meta') >= 0 || n.indexOf('alphabet') >= 0 || n.indexOf('tesla') >= 0 || n.indexOf('amazon') >= 0 || n.indexOf('netflix') >= 0) sector = 'tech';
                else if (n.indexOf('lvmh') >= 0 || n.indexOf('hermes') >= 0 || n.indexOf('kering') >= 0) sector = 'luxe';
                else if (n.indexOf('total') >= 0 || n.indexOf('eni') >= 0 || n.indexOf('shell') >= 0) sector = 'energie';
                else if (n.indexOf('euro stoxx 50') >= 0 || n.indexOf('cac') >= 0 || n.indexOf('eurostoxx') >= 0) sector = 'indice-eu';
                sectors[sector] = (sectors[sector] || 0) + 1;
            });
        });
        return { sectors: sectors, underlyings: underlyings };
    }

    function _getDiversificationWarnings(product, pfSectors, pfUnderlyings) {
        var warnings = [];
        var pUnd = product.underlyings || (product.aiParsed && product.aiParsed.underlyings) || [];
        if (typeof pUnd === 'string') pUnd = [pUnd];

        // Check direct overlap
        var overlapCount = 0;
        pUnd.forEach(function(u) {
            var name = (typeof u === 'string' ? u : (u.name || '')).toUpperCase();
            if (pfUnderlyings.indexOf(name) >= 0) overlapCount++;
        });
        if (overlapCount > 0) {
            warnings.push('\u26a0 ' + overlapCount + ' sous-jacent(s) d\u00e9j\u00e0 en portefeuille');
        }

        // Check sector concentration
        var total = Object.values(pfSectors).reduce(function(s, v) { return s + v; }, 0);
        if (total > 0) {
            Object.keys(pfSectors).forEach(function(sec) {
                if (pfSectors[sec] / total >= 0.40) {
                    warnings.push('\u26a0 Secteur ' + sec + ' d\u00e9j\u00e0 ' + Math.round(pfSectors[sec] / total * 100) + '% du portefeuille');
                }
            });
        }

        return warnings;
    }

    // ========================================
    // MAIN PATCH — Override allocation logic
    // ========================================
    function _patch() {
        if (typeof buildStructuredOptimization !== 'function') return false;

        var _origBuild = buildStructuredOptimization;
        window.buildStructuredOptimization = function() {
            var result = _origBuild();

            // Get dynamic threshold
            var threshold = _getDynamicThreshold();
            result._v4 = {
                seuil: threshold.seuil,
                regime: threshold.regime,
                confidence: threshold.confidence,
                rationale: threshold.rationale
            };

            // Get portfolio sectors
            var pfAnalysis = _analyzePortfolioSectors(app.state.portfolio || []);

            // Get liquidity sources
            var sources = null;
            try {
                sources = typeof _identifyLiquiditySources === 'function' ?
                    _identifyLiquiditySources(app.state.portfolio || [], (window._optimizerOptions || {}).entity || 'all') : null;
            } catch(e) {}

            // Re-process each allocation
            var deployedTotal = 0;
            var maxPerProduct = (result.totalLiquidity || 0) * 0.35;
            var cashReserveRatio = threshold.regime === 'crisis' ? 0.25 : threshold.regime === 'recession' ? 0.20 : threshold.regime === 'stagflation' ? 0.15 : 0.10;
            var deployableMax = (result.totalLiquidity || 0) * (1 - cashReserveRatio);
            var poolsUsed = {}; // track remaining per bank

            if (result.allocationPlan) {
                result.allocationPlan.forEach(function(a) {
                    // --- SEUIL DYNAMIQUE ---
                    // Capital garanti products have zero capital risk → lower threshold
                    // But only if truly no barrier risk (not autocalls with parsing errors)
                    var effectiveSeuil = threshold.seuil;
                    var trueCapGaranti = a.capitalProtected && !a.hasBarrier &&
                        (a.couponType === 'garanti' || a.couponType === 'fixe' || a.couponType === 'conditionnel');
                    if (trueCapGaranti) {
                        effectiveSeuil = Math.min(threshold.seuil, 50);
                    }
                    if (a.score < effectiveSeuil) {
                        a.allocatedAmount = 0;
                        a.annualReturn = 0;
                        a.expectedReturn = 0;
                        a.catReturn = 0;
                        a.excessVsCat = 0;
                        if (a.score >= 45) {
                            a.recommendation = 'ATTENDRE';
                            a.reason = 'Score ' + a.score + ' < seuil ' + effectiveSeuil + ' (' + threshold.regime + '). \u00c0 reconsid\u00e9rer si march\u00e9 s\'am\u00e9liore.';
                        } else {
                            a.recommendation = 'PASSER';
                            a.reason = 'Score ' + a.score + ' insuffisant (' + threshold.regime + '). Risque trop \u00e9lev\u00e9 vs rendement.';
                        }
                        return;
                    }

                    // --- CONTRAINTE ENVELOPPE ---
                    var match = sources ? _findCompatibleSource(a, sources) : null;
                    if (!match || !match.source || match.amount <= 0) {
                        // Fallback: use total available liquidity for subscription
                        var totalAvail = (result.totalLiquidity || 0) - deployedTotal;
                        if (totalAvail > 5000) {
                            match = { source: { total: totalAvail }, type: 'SOUSCRIPTION', amount: totalAvail, label: '\ud83d\udcb5 Souscription' };
                        } else {
                            a.allocatedAmount = 0;
                            a.annualReturn = 0;
                            a.expectedReturn = 0;
                            a.catReturn = 0;
                            a.excessVsCat = 0;
                            a.recommendation = 'IMPOSSIBLE';
                            a.reason = '\ud83d\udd12 Liquidit\u00e9 \u00e9puis\u00e9e.';
                            return;
                        }
                    }

                    // Track pool usage
                    var poolKey = match.type + '_' + (match.source.bankName || 'ext');
                    if (!poolsUsed[poolKey]) poolsUsed[poolKey] = match.amount;
                    var poolRemaining = poolsUsed[poolKey];
                    if (poolRemaining <= 0 || deployedTotal >= deployableMax) {
                        a.allocatedAmount = 0;
                        a.recommendation = 'ATTENDRE';
                        a.reason = 'Liquidit\u00e9 \u00e9puis\u00e9e pour ce pool.';
                        return;
                    }

                    // --- SIZING ---
                    var weight = Math.pow(Math.max(0, (a.score - threshold.seuil) / (100 - threshold.seuil)), 1.3);
                    var targetAmount = Math.round(deployableMax * Math.max(0.10, weight * 0.40));
                    targetAmount = Math.min(targetAmount, maxPerProduct, poolRemaining, deployableMax - deployedTotal);
                    targetAmount = Math.round(targetAmount / 1000) * 1000;
                    if (targetAmount < 5000) { targetAmount = 0; }

                    if (targetAmount <= 0) {
                        a.allocatedAmount = 0;
                        a.recommendation = 'ATTENDRE';
                        a.reason = 'Allocation trop faible apr\u00e8s sizing.';
                        return;
                    }

                    // --- RENDEMENT ESPER\u00c9 ---
                    var coupon = typeof a.coupon === 'object' ? (a.coupon.rate || 0) : (parseFloat(a.coupon) || 0);
                    var probCoupon = a.probCoupon || 0.70;
                    try {
                        var allP = []; Object.values(app.state.proposals || {}).forEach(function(arr) { arr.forEach(function(p) { allP.push(p); }); });
                        var prop = allP.find(function(x) { return x.id === a.id; });
                        if (prop && typeof ProposalGrader !== 'undefined' && typeof _estimateCouponProb === 'function') {
                            var norm = ProposalGrader.normalize(prop);
                            if (norm) probCoupon = _estimateCouponProb(norm);
                        }
                    } catch(e) {}

                    a.allocatedAmount = targetAmount;
                    a.annualReturn = Math.round(targetAmount * coupon / 100 * probCoupon);
                    a.expectedReturn = a.annualReturn;
                    a.catReturn = Math.round(targetAmount * (result.catBenchmark || 2.5) / 100);
                    a.excessVsCat = a.annualReturn - a.catReturn;
                    a.recommendation = match.type === 'ARBITRAGE' ? 'ARBITRER' : 'SOUSCRIRE';

                    // --- DIVERSIFICATION WARNINGS ---
                    var divWarnings = [];
                    try {
                        var propObj = null;
                        var allProps = []; Object.values(app.state.proposals || {}).forEach(function(arr) { arr.forEach(function(p) { allProps.push(p); }); });
                        propObj = allProps.find(function(x) { return x.id === a.id; });
                        if (propObj) {
                            divWarnings = _getDiversificationWarnings(propObj, pfAnalysis.sectors, pfAnalysis.underlyings);
                        }
                    } catch(e) {}

                    // Build reason
                    var reasonParts = [
                        match.label,
                        'Grade ' + a.grade + ' (' + a.score + '/' + threshold.seuil + ')',
                        (typeof formatNumber === 'function' ? formatNumber(targetAmount) : targetAmount) + '\u20ac',
                        'E[ret] +' + (typeof formatNumber === 'function' ? formatNumber(a.annualReturn) : a.annualReturn) + '\u20ac/an',
                        '(prob ' + Math.round(probCoupon * 100) + '%)'
                    ];
                    if (a.excessVsCat > 0) reasonParts.push('+' + (typeof formatNumber === 'function' ? formatNumber(a.excessVsCat) : a.excessVsCat) + '\u20ac vs CAT');
                    if (divWarnings.length > 0) reasonParts.push(divWarnings.join(' '));
                    a.reason = reasonParts.join(' | ');
                    a._v4match = match.type;
                    a._v4source = match.label;

                    poolsUsed[poolKey] -= targetAmount;
                    deployedTotal += targetAmount;
                });

                // Sort: ARBITRER/SOUSCRIRE first, then ATTENDRE, PASSER, IMPOSSIBLE
                var order = { 'ARBITRER': 0, 'SOUSCRIRE': 1, 'ATTENDRE': 2, 'PASSER': 3, 'IMPOSSIBLE': 4 };
                result.allocationPlan.sort(function(a, b) {
                    var oa = order[a.recommendation] || 5, ob = order[b.recommendation] || 5;
                    return oa !== ob ? oa - ob : (b.score || 0) - (a.score || 0);
                });
            }

            // Recalculate totals
            result.deployedAmount = (result.allocationPlan || []).reduce(function(s, a) { return s + (a.allocatedAmount || 0); }, 0);
            result.deployedReturn = (result.allocationPlan || []).reduce(function(s, a) { return s + (a.annualReturn || 0); }, 0);
            result.deployedCatReturn = Math.round(result.deployedAmount * (result.catBenchmark || 2.5) / 100);
            result.deployedExcess = result.deployedReturn - result.deployedCatReturn;
            result.remainingCash = (result.totalLiquidity || 0) - result.deployedAmount;

            // --- "NE RIEN FAIRE" ---
            var subscribes = (result.allocationPlan || []).filter(function(a) {
                return a.recommendation === 'ARBITRER' || a.recommendation === 'SOUSCRIRE';
            });
            result._v4.nothingToDo = subscribes.length === 0;
            if (result._v4.nothingToDo) {
                result._v4.nothingReason = 'Aucune proposition ne d\u00e9passe le seuil de ' + threshold.seuil + '/100 (' + threshold.regime + '). ' +
                    'Recommandation : garder la liquidit\u00e9 en CAT/Bond 12M (' + (result.catBenchmark || 2.5).toFixed(1) + '% sans risque) en attendant de meilleures opportunit\u00e9s.';
            }

            // Diversification summary
            result._v4.portfolioSectors = pfAnalysis.sectors;
            result._v4.uniqueUnderlyings = pfAnalysis.underlyings.length;

            console.log('[optimizer-v4] Seuil=' + threshold.seuil + ' (' + threshold.regime + ') | D\u00e9ploy\u00e9=' + (typeof formatNumber === 'function' ? formatNumber(result.deployedAmount) : result.deployedAmount) + '\u20ac | Actions=' + subscribes.length);
            return result;
        };

        // ========================================
        // PATCH RENDER TABLE — add regime badge + "ne rien faire"
        // ========================================
        if (typeof renderStructOptimizationTable === 'function') {
            var _origRender = renderStructOptimizationTable;
            window.renderStructOptimizationTable = function(analysis) {
                var html = '';

                // V4 regime badge
                if (analysis._v4) {
                    var v4 = analysis._v4;
                    var regimeColors = { crisis: '#EF233C', recession: '#E85D04', stagflation: '#FFB627', neutral: '#4ECDC4', bull: '#06D6A0', 'risk-on': '#06D6A0' };
                    var rc = regimeColors[v4.regime] || '#888';
                    html += '<div style="margin-bottom:12px;padding:10px 14px;background:' + rc + '10;border:1px solid ' + rc + '30;border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">';
                    html += '<div><span style="font-size:14px;font-weight:700;color:' + rc + '">' + (v4.regime || '?').toUpperCase() + '</span>';
                    html += '<span style="font-size:11px;color:var(--text-dim);margin-left:8px">(conf. ' + (v4.confidence || '?') + '/5)</span></div>';
                    html += '<div style="font-size:12px;color:var(--text-bright)">Seuil d\'exigence : <strong style="color:' + rc + '">' + v4.seuil + '/100</strong></div></div>';
                }

                // "Ne rien faire" banner
                if (analysis._v4 && analysis._v4.nothingToDo) {
                    html += '<div style="margin-bottom:16px;padding:16px;background:rgba(6,214,160,0.05);border:2px solid rgba(6,214,160,0.3);border-radius:var(--radius);text-align:center">';
                    html += '<div style="font-size:24px;margin-bottom:8px">\u2705</div>';
                    html += '<div style="font-size:14px;font-weight:700;color:var(--green);margin-bottom:8px">Recommandation : garder la liquidit\u00e9</div>';
                    html += '<div style="font-size:12px;color:var(--text-muted);max-width:500px;margin:0 auto">' + analysis._v4.nothingReason + '</div>';
                    html += '</div>';
                }

                // Call original render
                html += _origRender(analysis);
                return html;
            };
        }

        buildStructuredOptimization._v4Patched = true;
        console.log('[optimizer-v4] Patch applied: dynamic threshold + envelope constraints + ne rien faire + diversification warnings');
        return true;
    }

    // Wait for all dependencies
    var attempts = 0;
    var iv = setInterval(function() {
        attempts++;
        if (typeof buildStructuredOptimization === 'function' && _patch()) clearInterval(iv);
        if (attempts > 150) clearInterval(iv);
    }, 200);
})();

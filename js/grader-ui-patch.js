// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader UI Patch v2.1 — Fiche order: Suivi before Grading
// For PORTFOLIO products: Suivi Performance → Grading ("où en suis-je" first)
// For PROPOSALS: Grading first (no performance to track yet)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';
    if (typeof ProposalGrader === 'undefined') { console.warn('[GraderUI] ProposalGrader not loaded'); return; }
    if (typeof GRADING_CONFIG !== 'undefined' && GRADING_CONFIG.killCriteria) { delete GRADING_CONFIG.killCriteria.maxIssuerConcentration; }

    // ─── View Brochure PDF ───
    window.viewBrochurePDF = function() {
        var p = app.state.currentProduct;
        if (!p) return;
        var pdf = null;
        try { pdf = localStorage.getItem('pdf_' + p.id); } catch(e) {}
        if (pdf) {
            var blob = new Blob([Uint8Array.from(atob(pdf), function(c) { return c.charCodeAt(0); })], { type: 'application/pdf' });
            var url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
        } else if (p.sourceFile && p.sourceFile !== 'JSON import') {
            showToast('PDF non disponible — re-parsez la brochure pour stocker le PDF', 'info');
        } else {
            showToast('Aucune brochure associée', 'info');
        }
    };

    // Dispersion backtest using stockData (called after grading when perf_1y is available)
    function _computeDispersionBacktest1Y(product, stockData) {
      if (!stockData || stockData.length < 2) return null;
      var unds = product.underlyings || [];
      var perfs = [];
      unds.forEach(function(u) {
        var name = typeof u === 'string' ? u : (u.name || '');
        var match = stockData.find(function(s) {
          return s && ((s.name || '').toUpperCase().indexOf(name.toUpperCase()) >= 0 ||
            name.toUpperCase().indexOf((s.ticker || '').toUpperCase()) >= 0 ||
            (s.ticker || '').toUpperCase() === name.toUpperCase());
        });
        if (match && match.perf_1y != null) perfs.push({ name: name.substring(0, 20), perf: parseFloat(match.perf_1y) });
      });
      if (perfs.length < 2) return null;
      var pairs = [];
      for (var i = 0; i < perfs.length; i++) {
        for (var j = i + 1; j < perfs.length; j++) {
          pairs.push({ stock1: perfs[i].name, stock2: perfs[j].name, perf1: perfs[i].perf, perf2: perfs[j].perf, dispersion: Math.abs(perfs[i].perf - perfs[j].perf) });
        }
      }
      var avg = pairs.reduce(function(s, p) { return s + p.dispersion; }, 0) / pairs.length;
      var part = parseFloat(product.participationRate) || parseFloat(product.coupon && product.coupon.rate) || 7;
      var retPct = Math.round(part * avg) / 100;
      var nom = parseFloat(product.investedAmount) || 100000;
      pairs.sort(function(a, b) { return b.dispersion - a.dispersion; });
      return { pairs: pairs, avgDispersion: Math.round(avg * 100) / 100, participation: part, returnPct: Math.round(retPct * 100) / 100, returnEur: Math.round(nom * retPct / 100), nbPairs: pairs.length, nbStocks: perfs.length, perfs: perfs };
    }

    async function _clearOldKillGrading() { let cleared = 0; for (const [bankId, proposals] of Object.entries(app.state?.proposals || {})) { for (const p of proposals) { if (p.grading && p.grading.killCriteria?.triggered) { const reasons = p.grading.killCriteria.reasons || []; if (reasons.some(r => r.includes('metteur') || r.includes('book') || r.includes('max: 40'))) { delete p.grading; cleared++; try { await app._saveProductFile(bankId, p); } catch(e){} } } } } if (cleared > 0) { console.log('[GraderUI] Cleared ' + cleared + ' old F grades'); app.render(); } }
    setTimeout(_clearOldKillGrading, 3000);

    async function _saveGrading(product) { var saved = { proposal: false, portfolio: false }; if (product.bankId) { try { await app._saveProductFile(product.bankId, product); saved.proposal = true; } catch(e) {} } var portfolio = app.state.portfolio || []; var pfProduct = portfolio.find(function(p) { return p.id === product.id; }); if (pfProduct) { pfProduct.grading = product.grading; try { await github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', portfolio, '[StructBoard] Grading: ' + (product.grading.grade || '?') + ' \u2014 ' + (product.name || product.id).substring(0, 40)); saved.portfolio = true; } catch(e) {} } return saved; }

    window.triggerGrading = async function(btn) { const product = app.state.currentProduct; if (!product) { showToast('Aucun produit', 'error'); return; } if (btn && btn.disabled) return; if (btn) { btn.disabled = true; btn.textContent = '\u23f3 Analyse en cours...'; } try { delete product.grading; if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; } showToast('Grading en cours...', 'info'); const result = await ProposalGrader.grade(product); try { if (_mktCache && result && result.metadata && typeof _extractStockData === 'function') { var norm = ProposalGrader.normalize(product); var stockInfo = _extractStockData(norm, _mktCache); if (stockInfo.available && stockInfo.stocks.length > 0) { result.metadata.stockData = stockInfo.stocks.filter(function(s) { return s.found; }).map(function(s) { return { name: s.name, ticker: s.ticker, sector: s.sector || '\u2014', perf_ytd: s.perf_ytd, perf_1y: s.perf_1y, volatility_3y: s.volatility_3y, max_drawdown_3y: s.max_drawdown_3y, buffett_score: s.buffett_score, quality_score: s.quality_score, buffett_grade: s.buffett_grade }; }); product.grading = result; if ((product.structureType||'').toLowerCase()==='dispersion' && result.metadata.stockData && result.metadata.stockData.length>=2) { var _bt=_computeDispersionBacktest1Y(product,result.metadata.stockData); if(_bt){result.dispersionBacktest=_bt;product._dispersionBacktest=_bt;} } } } } catch(e) {} var saveResult = await _saveGrading(product); app.openProduct(product); var gc = ProposalGrader.config.grades[result.grade] || {}; showToast('Grade ' + result.grade + ' \u2014 ' + (gc.label || '') + ' (' + (result.score !== null ? result.score + '/100' : 'liquidit\u00e9') + ')', 'success'); } catch (e) { console.error('[Grader] Error:', e); if (btn) { btn.textContent = '\u274c Erreur'; btn.disabled = false; } showToast('Erreur: ' + e.message, 'error'); } };

    window.tagAsLiquidity = async function(btn) { var product = app.state.currentProduct; if (!product) return; product.grading = { grade: '-', score: null, killCriteria: { triggered: false, reasons: [] }, pillars: { adjustedReturn: { score: null }, underlyingQuality: { score: null }, portfolioFit: { score: null }, riskPremium: { score: null } }, verdict: 'Produit de liquidit\u00e9 / parking cash.', keyRisks: ['Rendement tr\u00e8s faible'], scenarios: null, metadata: { gradedAt: new Date().toISOString(), durationMs: 0, aiUsed: false, version: '4.1', productType: 'liquidity', isInPortfolio: true } }; await _saveGrading(product); app.openProduct(product); showToast('Marqu\u00e9 comme liquidit\u00e9', 'success'); };

    const _prevRPC = renderProductCard; renderProductCard = function(product, context) { let html = _prevRPC(product, context); const g = product.grading; if (g && g.grade && g.grade !== '?') { const badge = ProposalGrader.renderBadge(g.grade, g.score); html = html.replace(/<div class="card-score[^"]*">[^<]*<\/div>/, badge); if (!html.includes('style="display:inline-flex')) { const fi = html.indexOf('product-card-footer'); if (fi > -1) { const ii = html.indexOf('>', fi) + 1; html = html.substring(0, ii) + badge + html.substring(ii); } } } return html; };

    const _prevRPS = renderProductSheet; renderProductSheet = function(container, state) { _prevRPS(container, state); const p = state.currentProduct; if (!p) return; setTimeout(() => _cleanupProductSheet(container, p), 0); };

    function _cleanupProductSheet(container, p) {
        const sheetMain = container.querySelector('.sheet-main');
        const sidebar = container.querySelector('.sheet-sidebar');

        const navActions = container.querySelector('.sheet-nav-actions');
        if (navActions) navActions.remove();

        if (sheetMain) { sheetMain.querySelectorAll('.fiche-section').forEach(section => { const title = section.querySelector('.fiche-section-title'); if (!title) return; const t = title.textContent.trim().toLowerCase(); if (t.includes('analyse ia') || t.includes('r\u00e9sum\u00e9 ia') || t.includes('r\u00e9sum\u00e9 discussion') || t.includes('analyse approfondie') || t.includes('grading unifi')) section.remove(); }); sheetMain.querySelectorAll('.deep-analysis-section, [data-section="deep-analysis"]').forEach(s => s.remove()); sheetMain.querySelectorAll('.fiche-ai-summary').forEach(el => { const parent = el.closest('.fiche-section'); if (parent) parent.remove(); }); sheetMain.querySelectorAll('.fiche-section').forEach(section => { if (section.textContent.includes('Analyse approfondie')) section.remove(); }); }
        if (sidebar) { sidebar.querySelectorAll('.sheet-card').forEach(card => { const title = card.querySelector('.sheet-card-title, h3'); if (title) { const t = title.textContent.trim().toLowerCase(); if (t.includes('score') || t.includes('compatib')) card.remove(); } }); sidebar.querySelectorAll('.score-panel').forEach(el => el.remove()); }
        const scoreWidget = container.querySelector('.score-widget'); if (scoreWidget) { if (p.grading) { scoreWidget.outerHTML = ProposalGrader.renderBadge(p.grading.grade, p.grading.score, 'large'); } else { scoreWidget.outerHTML = '<div style="width:80px;height:80px;border-radius:50%;border:3px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0.5" onclick="triggerGrading(this)"><span style="font-size:20px;color:var(--text-muted)">?</span></div>'; } }

        // Build grading section
        if (sheetMain) {
            const gd = document.createElement('div'); gd.className = 'fiche-section'; gd.setAttribute('data-section', 'grading');
            var btns = ''; if (p.grading) { btns = '<button onclick="triggerGrading(this)" style="margin-left:auto;padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;font-size:11px;display:flex;align-items:center;gap:4px">\ud83d\udd04 Actualiser</button>'; } if (!p.grading || (p.grading.grade !== '-')) { btns += '<button onclick="tagAsLiquidity(this)" style="padding:4px 12px;border-radius:6px;border:1px solid #94A3B844;background:transparent;color:#94A3B8;cursor:pointer;font-size:11px;margin-left:6px">$ Liquidit\u00e9</button>'; }
            var gradingHtml = ProposalGrader.renderSection(p.grading);
            if (p.grading && p.grading.metadata && p.grading.metadata.stockData && p.grading.metadata.stockData.length > 0) { var st = (p.structureType || '').toLowerCase(); var stockTableHtml = st === 'range_accrual' ? _renderRangeAccrualBadge(p) : _renderStockTable(p.grading.metadata.stockData); var insertPoint = gradingHtml.indexOf('grid-template-columns:repeat(4'); if (insertPoint > 0) { var divStart = gradingHtml.lastIndexOf('<div style="display:grid', insertPoint); if (divStart > 0) gradingHtml = gradingHtml.substring(0, divStart) + stockTableHtml + gradingHtml.substring(divStart); } else { var risksPoint = gradingHtml.indexOf('<strong>Risques'); if (risksPoint > 0) { var divR = gradingHtml.lastIndexOf('<div', risksPoint); if (divR > 0) gradingHtml = gradingHtml.substring(0, divR) + stockTableHtml + gradingHtml.substring(divR); } else { var footerPoint = gradingHtml.lastIndexOf('<div style="font-size:10px'); if (footerPoint > 0) gradingHtml = gradingHtml.substring(0, footerPoint) + stockTableHtml + gradingHtml.substring(footerPoint); } } }
            // v7.1: Regime scenarios widget
            if (p.grading && p.grading.regimeScenarios) {
                var rs = p.grading.regimeScenarios;
                var _gc = function(g) { return {A:'#06D6A0',B:'#4ECDC4',C:'#FFB627',D:'#E85D04',F:'#EF233C'}[g] || '#888'; };
                gradingHtml += '<div style="margin:12px 0"><div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px">\ud83c\udf0d Sc\u00e9narios r\u00e9gime</div>';
                gradingHtml += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
                [rs.current, rs.bull, rs.crash].forEach(function(sc) {
                    var c = _gc(sc.grade);
                    var deltaHtml = sc.delta ? '<div style="font-size:10px;font-weight:600;color:' + (sc.delta > 0 ? '#06D6A0' : '#EF233C') + '">' + (sc.delta > 0 ? '+' : '') + sc.delta + ' pts</div>' : '';
                    gradingHtml += '<div style="text-align:center;padding:8px;border-radius:6px;background:' + c + '08;border:1px solid ' + c + '22">';
                    gradingHtml += '<div style="font-size:9px;color:var(--text-dim)">' + sc.label + '</div>';
                    gradingHtml += '<div style="font-size:20px;font-weight:800;color:' + c + '">' + sc.grade + '</div>';
                    gradingHtml += '<div style="font-size:11px;color:var(--text-muted)">' + sc.score + '/100</div>';
                    gradingHtml += deltaHtml;
                    if (sc.desc) gradingHtml += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;line-height:1.4">' + sc.desc + '</div>';
                    gradingHtml += '</div>';
                });
                gradingHtml += '</div></div>';
            }

            // v7.1: Dispersion backtest 1Y
            var bt = p.grading.dispersionBacktest || p._dispersionBacktest;
            if (bt) {
                gradingHtml += '<div style="margin:14px 0;padding:14px;background:rgba(59,130,246,0.04);border:1px solid rgba(59,130,246,0.15);border-radius:8px">';
                gradingHtml += '<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px">📊 Simulation 1 an — Dispersion réelle</div>';
                var matY = parseFloat(p.maturityYears) || 3;
                var projectedPct = Math.round(bt.returnPct * matY * 100) / 100;
                var projectedEur = Math.round(bt.returnEur * matY);
                gradingHtml += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px">';
                gradingHtml += '<div style="text-align:center;padding:8px;background:var(--bg-card);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Dispersion moy.</div><div style="font-size:18px;font-weight:700;color:var(--accent)">' + bt.avgDispersion.toFixed(1) + '%</div><div style="font-size:9px;color:var(--text-dim)">' + bt.nbPairs + ' paires</div></div>';
                gradingHtml += '<div style="text-align:center;padding:8px;background:var(--bg-card);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Participation</div><div style="font-size:18px;font-weight:700;color:var(--text-bright)">×' + bt.participation + '%</div></div>';
                gradingHtml += '<div style="text-align:center;padding:8px;background:var(--bg-card);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Rendement /an</div><div style="font-size:18px;font-weight:700;color:var(--green)">' + bt.returnPct.toFixed(1) + '%</div><div style="font-size:9px;color:var(--text-dim)">×' + bt.participation + '% × ' + bt.avgDispersion.toFixed(0) + '%</div></div>';
                gradingHtml += '<div style="text-align:center;padding:8px;background:rgba(6,214,160,0.06);border-radius:6px"><div style="font-size:10px;color:var(--text-dim)">Projeté ' + matY + ' ans</div><div style="font-size:18px;font-weight:700;color:var(--green)">' + projectedPct.toFixed(1) + '%</div><div style="font-size:9px;color:var(--text-dim)">~' + (typeof formatNumber === 'function' ? formatNumber(projectedEur) : projectedEur) + '€</div></div>';
                gradingHtml += '<div style="text-align:center;padding:8px;background:rgba(6,214,160,0.10);border-radius:6px;border:1px solid rgba(6,214,160,0.2)"><div style="font-size:10px;color:var(--text-dim)">Sur 100K€ / ' + matY + 'a</div><div style="font-size:18px;font-weight:700;color:var(--green)">+' + (typeof formatNumber === 'function' ? formatNumber(projectedEur) : projectedEur) + '€</div><div style="font-size:9px;color:var(--green)">' + (projectedPct / matY).toFixed(1) + '%/an</div></div>';
                gradingHtml += '</div>';

                // Top 3 and worst pair
                gradingHtml += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Top paires (sur ' + bt.nbPairs + ' paires, ' + bt.nbStocks + ' actions) :</div>';
                gradingHtml += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
                bt.pairs.slice(0, 5).forEach(function(pair) {
                    gradingHtml += '<div style="padding:3px 8px;background:var(--bg-card);border-radius:4px;font-size:10px;border:1px solid var(--border)">';
                    gradingHtml += '<span style="color:var(--text-bright)">' + pair.stock1 + '</span>';
                    gradingHtml += ' <span style="color:var(--text-dim)">vs</span> ';
                    gradingHtml += '<span style="color:var(--text-bright)">' + pair.stock2 + '</span>';
                    gradingHtml += ' → <span style="color:var(--green);font-weight:600">' + pair.dispersion.toFixed(1) + '%</span>';
                    gradingHtml += '</div>';
                });
                gradingHtml += '</div>';
                gradingHtml += '<div style="font-size:9px;color:var(--text-dim);margin-top:6px">Backtest basé sur les performances 1 an réelles. Résultat passé, non garanti.</div>';
                gradingHtml += '</div>';
            }

            // v7.1: Issuer credit badge
            if (p.grading && p.grading.metadata && p.grading.metadata.issuerCDS) {
                var cds = p.grading.metadata.issuerCDS;
                var penalty = p.grading.metadata.issuerCreditPenalty || 0;
                var rating = p.grading.metadata.issuer_rating || 'NR';
                gradingHtml += '<div style="font-size:10px;color:var(--text-dim);margin-top:4px">\ud83c\udfe6 \u00c9metteur ' + rating + ' \u00b7 CDS ~' + cds + 'bps' + (penalty > 0 ? ' \u00b7 P4 -' + penalty + 'pts (risque cr\u00e9dit)' : '') + '</div>';
            }

            gd.innerHTML = '<div class="fiche-section-header" style="display:flex;align-items:center"><span class="fiche-section-icon">\ud83c\udfaf</span><span class="fiche-section-title">Grading Unifi\u00e9</span>' + btns + '</div><div class="fiche-section-body">' + gradingHtml + '</div>';

            // [v2.1] CONDITIONAL ORDER: Portfolio → Suivi before Grading | Proposals → Grading first
            var isInPortfolio = (app.state.portfolio || []).some(function(x) { return x.id === p.id; });
            if (isInPortfolio) {
                // Find "Suivi Performance" section and insert grading AFTER it
                var suiviSection = null;
                sheetMain.querySelectorAll('.fiche-section').forEach(function(sec) {
                    var title = sec.querySelector('.fiche-section-title');
                    if (title && title.textContent.toLowerCase().indexOf('suivi') >= 0) suiviSection = sec;
                });
                if (suiviSection) {
                    suiviSection.after(gd);
                } else {
                    // No suivi section found — prepend as fallback
                    sheetMain.prepend(gd);
                }
            } else {
                // Proposals: grading first (no performance to track)
                sheetMain.prepend(gd);
            }
        }

        // Sidebar: grade panel + actions
        if (sidebar) {
            const panel = document.createElement('div');
            panel.innerHTML = _buildGradeSidebarPanel(p.grading);
            if (panel.firstElementChild) sidebar.insertBefore(panel.firstElementChild, sidebar.firstChild);

            var actionsCard = null;
            sidebar.querySelectorAll('.sheet-card').forEach(function(card) {
                var title = card.querySelector('.sheet-card-title, h3');
                if (title && title.textContent.trim().toUpperCase() === 'ACTIONS') actionsCard = card;
            });

            if (actionsCard) {
                var hasModifier = actionsCard.innerHTML.indexOf('Modifier infos') >= 0;
                var hasValorisation = actionsCard.innerHTML.indexOf('Valorisation') >= 0;
                var hasBrochure = actionsCard.innerHTML.indexOf('Brochure') >= 0;
                if (!hasModifier || !hasValorisation || !hasBrochure) {
                    var extraBtns = '';
                    if (!hasModifier) extraBtns += '<button class="btn" style="width:100%;margin-bottom:6px" onclick="if(typeof showEditModal===\'function\')showEditModal();">\u270e Modifier infos</button>';
                    if (!hasValorisation) extraBtns += '<button class="btn" style="width:100%;margin-bottom:6px" onclick="if(typeof showTrackingModal===\'function\')showTrackingModal();">\ud83d\udccd Valorisation</button>';
                    if (!hasBrochure && p.sourceFile && p.sourceFile !== 'JSON import') extraBtns += '<button class="btn" style="width:100%;margin-bottom:6px" onclick="viewBrochurePDF()">📄 Voir la brochure</button>';
                    var discuterBtn = actionsCard.querySelector('.ai-glow, [onclick*="showChat"], [onclick*="openChat"]');
                    if (discuterBtn) { var wrapper = document.createElement('div'); wrapper.innerHTML = extraBtns; while (wrapper.firstChild) discuterBtn.parentNode.insertBefore(wrapper.firstChild, discuterBtn); }
                    else { var cardBody = actionsCard.querySelector('.sheet-card-body') || actionsCard; var firstChild = cardBody.querySelector('button, a') || cardBody.firstChild; if (firstChild) { var wrapper2 = document.createElement('div'); wrapper2.innerHTML = extraBtns; while (wrapper2.firstChild) firstChild.parentNode.insertBefore(wrapper2.firstChild, firstChild); } else { cardBody.insertAdjacentHTML('afterbegin', extraBtns); } }
                }
            } else {
                var actDiv = document.createElement('div'); actDiv.className = 'sheet-card';
                actDiv.innerHTML = '<h3 class="sheet-card-title">ACTIONS</h3>' +
                    '<button class="btn" style="width:100%;margin-bottom:6px" onclick="if(typeof showEditModal===\'function\')showEditModal();">\u270e Modifier infos</button>' +
                    '<button class="btn" style="width:100%;margin-bottom:6px" onclick="if(typeof showTrackingModal===\'function\')showTrackingModal();">\ud83d\udccd Valorisation</button>' +
                    (p.sourceFile && p.sourceFile !== 'JSON import' ? '<button class="btn" style="width:100%;margin-bottom:6px" onclick="viewBrochurePDF()">📄 Voir la brochure</button>' : '') +
                    '<button class="btn ai-glow" style="width:100%;margin-bottom:6px" onclick="if(typeof showProposalChat===\'function\')showProposalChat();">\ud83d\udcac Discuter avec Claude</button>' +
                    (p.bankId ? '<button class="btn" style="width:100%;margin-bottom:6px" onclick="if(typeof integrateProduct===\'function\')integrateProduct();">\u2705 Int\u00e9grer</button>' : '') +
                    '<button class="btn" style="width:100%;margin-bottom:6px;color:var(--red)" onclick="if(typeof rejectProduct===\'function\')rejectProduct();">\u274c Rejeter</button>' +
                    '<button class="btn" style="width:100%;margin-bottom:6px;color:var(--text-dim)" onclick="if(typeof deleteProduct===\'function\')deleteProduct();">\ud83d\uddd1 Supprimer</button>' +
                    '<button class="btn" style="width:100%;color:var(--orange)" onclick="if(typeof archiveProduct===\'function\')archiveProduct();">\ud83d\udce6 Archiver</button>';
                sidebar.appendChild(actDiv);
            }
        }
    }

    function _renderStockTable(stockData) { if (!stockData || stockData.length === 0) return ''; function _pc(v) { if (v == null) return '#888'; return v >= 10 ? '#06D6A0' : v >= 0 ? '#4ECDC4' : v >= -10 ? '#FFB627' : '#EF233C'; } function _sc(v) { if (v == null) return '#888'; return v >= 70 ? '#06D6A0' : v >= 50 ? '#4ECDC4' : v >= 30 ? '#FFB627' : '#EF233C'; } function _f(v, s) { if (v == null) return '<span style="color:#555">\u2014</span>'; var c = s === '%' ? _pc(v) : _sc(v); return '<span style="color:' + c + ';font-weight:600">' + (v >= 0 && s === '%' ? '+' : '') + v + (s || '') + '</span>'; } var cs = 'padding:4px 6px;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.06);white-space:nowrap;'; var hs = cs + 'color:var(--text-muted);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;'; var h = '<div style="margin:12px 0"><div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px">\ud83d\udcca Sous-jacents</div><div style="overflow-x:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.08)"><table style="width:100%;border-collapse:collapse;font-size:11px"><tr style="background:rgba(255,255,255,0.03)"><th style="' + hs + 'text-align:left">Nom</th><th style="' + hs + 'text-align:right">YTD</th><th style="' + hs + 'text-align:right">1 an</th><th style="' + hs + 'text-align:right">Vol 3Y</th><th style="' + hs + 'text-align:right">DD 3Y</th><th style="' + hs + 'text-align:right">Buffett</th><th style="' + hs + 'text-align:right">Quality</th></tr>'; stockData.forEach(function(s, i) { var bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'; h += '<tr style="background:' + bg + '"><td style="' + cs + 'text-align:left"><span style="font-weight:600;color:var(--text-primary,#e0e0e0)">' + s.name + '</span> <span style="color:#666;font-size:10px">' + s.ticker + '</span></td><td style="' + cs + 'text-align:right">' + _f(s.perf_ytd, '%') + '</td><td style="' + cs + 'text-align:right">' + _f(s.perf_1y, '%') + '</td><td style="' + cs + 'text-align:right">' + _f(s.volatility_3y, '%') + '</td><td style="' + cs + 'text-align:right">' + _f(s.max_drawdown_3y != null ? -Math.abs(s.max_drawdown_3y) : null, '%') + '</td><td style="' + cs + 'text-align:right">' + _f(s.buffett_score, '') + '<span style="font-size:9px;color:#666">/' + (s.buffett_grade || '?') + '</span></td><td style="' + cs + 'text-align:right">' + _f(s.quality_score, '') + '</td></tr>'; }); h += '</table></div></div>'; return h; }

    function _renderRangeAccrualBadge(product) {
      var ra = product.rangeAccrual || (product.aiParsed && product.aiParsed.rangeAccrual) || {};
      var lower = ra.lowerBound || 1.75;
      var upper = ra.upperBound || 3.50;
      var ref = ra.reference || 'Euribor 3 mois';
      var obs = ra.observation || 'daily';
      var obsLabel = obs === 'daily' ? 'Journalière' : obs === 'weekly' ? 'Hebdomadaire' : 'Mensuelle';
      // Estimate current rate from ECB data
      var currentRate = 2.5; // default
      try { if (typeof _mktCache !== 'undefined' && _mktCache && _mktCache.rates && _mktCache.rates.policy_rates && _mktCache.rates.policy_rates.ecb_deposit_rate) currentRate = _mktCache.rates.policy_rates.ecb_deposit_rate.current + 0.5; } catch(e) {}
      var width = upper - lower;
      var distToEdge = Math.min(currentRate - lower, upper - currentRate);
      var isInRange = currentRate >= lower && currentRate <= upper;
      var pos = isInRange ? Math.max(0, Math.min(1, (currentRate - lower) / width)) : (currentRate < lower ? 0 : 1);
      var statusColor = isInRange ? (distToEdge > 0.5 ? '#06D6A0' : '#FFB627') : '#EF233C';
      var statusLabel = isInRange ? 'DANS LE RANGE' : 'HORS RANGE';
      var h = '<div style="margin:12px 0;border:1px solid rgba(168,85,247,0.2);border-radius:8px;padding:12px;background:rgba(168,85,247,0.03)">';
      h += '<div style="font-size:11px;font-weight:600;color:#A855F7;margin-bottom:8px">📊 Corridor Range Accrual</div>';
      h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">';
      h += '<div style="flex:1;font-size:10px;color:var(--text-dim)">' + ref + ' · Observation ' + obsLabel + '</div>';
      h += '<div style="font-size:11px;font-weight:700;color:' + statusColor + '">' + statusLabel + '</div>';
      h += '</div>';
      // Visual corridor bar
      h += '<div style="position:relative;height:24px;background:rgba(255,255,255,0.05);border-radius:12px;overflow:hidden;margin-bottom:6px">';
      h += '<div style="position:absolute;left:0;top:0;height:100%;width:100%;background:rgba(168,85,247,0.15);border-radius:12px"></div>';
      if (isInRange) h += '<div style="position:absolute;left:' + (pos * 100).toFixed(1) + '%;top:2px;width:8px;height:20px;background:' + statusColor + ';border-radius:4px;transform:translateX(-50%)"></div>';
      h += '</div>';
      h += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted)">';
      h += '<span>' + lower.toFixed(2) + '%</span>';
      h += '<span style="color:' + statusColor + ';font-weight:600">' + currentRate.toFixed(2) + '% actuel</span>';
      h += '<span>' + upper.toFixed(2) + '%</span>';
      h += '</div>';
      h += '<div style="display:flex;gap:12px;margin-top:8px;font-size:10px">';
      h += '<div>Distance borne basse: <span style="font-weight:600;color:var(--green)">' + (currentRate - lower).toFixed(2) + '%</span></div>';
      h += '<div>Distance borne haute: <span style="font-weight:600;color:' + (upper - currentRate < 0.5 ? 'var(--red)' : 'var(--orange)') + '">' + (upper - currentRate).toFixed(2) + '%</span></div>';
      h += '</div></div>';
      return h;
    }

    function _disableDeepAnalysis() { if (typeof window.injectDeepAnalysis === 'function' && !window._deepAnalysisDisabled) { window._origInjectDeepAnalysis = window.injectDeepAnalysis; window.injectDeepAnalysis = function() {}; window._deepAnalysisDisabled = true; } }
    _disableDeepAnalysis(); setTimeout(_disableDeepAnalysis, 100); setTimeout(_disableDeepAnalysis, 500);

    function _buildGradeSidebarPanel(grading) { if (!grading) return '<div class="sheet-card"><h3 class="sheet-card-title">Grade</h3><div style="text-align:center;padding:20px 0;"><div style="width:64px;height:64px;border-radius:50%;border:3px dashed var(--border);display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px"><span style="font-size:24px;color:var(--text-muted)">?</span></div><div style="font-size:12px;color:var(--text-muted)">Non grad\u00e9</div></div></div>'; const g = grading; if (g.grade === '-') return '<div class="sheet-card" style="border-top:3px solid #94A3B8"><h3 class="sheet-card-title">Grade</h3><div style="text-align:center;padding:12px 0"><span style="font-size:32px;color:#94A3B8">$</span><div style="font-size:14px;font-weight:600;color:#94A3B8;margin-top:4px">Liquidit\u00e9</div><div style="font-size:11px;color:var(--text-muted);margin-top:8px">' + (g.verdict || '') + '</div></div></div>'; const config = ProposalGrader.config.grades[g.grade] || ProposalGrader.config.grades.F; const color = config.color; let html = '<div class="sheet-card" style="border-top:3px solid ' + color + '"><h3 class="sheet-card-title">Grade</h3><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' + ProposalGrader.renderBadge(g.grade, g.score, 'large') + '<div><div style="font-size:14px;font-weight:600;color:' + color + '">' + config.label + '</div><div style="font-size:11px;color:var(--text-muted)">' + (g.score !== null ? g.score + '/100' : '') + '</div></div></div>'; if (g.killCriteria && g.killCriteria.triggered) html += '<div style="background:rgba(239,35,60,0.08);border-radius:6px;padding:8px;margin-bottom:10px;"><div style="font-size:11px;font-weight:600;color:#EF233C;margin-bottom:4px">\u26d4 Rejet</div>' + g.killCriteria.reasons.map(function(r) { return '<div style="font-size:10px;color:#EF233C;padding:1px 0">\u2022 ' + r + '</div>'; }).join('') + '</div>'; var pn = { adjustedReturn: 'Rendement', underlyingQuality: 'Sous-jacent', portfolioFit: 'Fit portfolio', riskPremium: 'Prime/CAT' }; if (g.pillars) { Object.entries(pn).forEach(function(e) { var key = e[0], name = e[1], pillar = g.pillars[key] || {}, score = pillar.score; if (score === null || score === undefined) return; var bc = score >= 70 ? '#06D6A0' : score >= 45 ? '#FFB627' : '#EF233C'; html += '<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span style="color:var(--text-muted)">' + name + '</span><span style="font-weight:600">' + score + '</span></div><div style="height:4px;background:var(--surface);border-radius:2px;overflow:hidden"><div style="height:100%;width:' + score + '%;background:' + bc + ';border-radius:2px"></div></div></div>'; }); } if (g.verdict) html += '<div style="font-size:11px;color:var(--text-muted);margin-top:10px;padding-top:8px;border-top:1px solid var(--border);line-height:1.4">' + g.verdict + '</div>'; if (g.keyRisks && g.keyRisks.length > 0) { html += '<div style="margin-top:8px">'; g.keyRisks.forEach(function(r) { html += '<div style="font-size:10px;color:var(--red);padding:2px 0">\u26a0 ' + r + '</div>'; }); html += '</div>'; } if (g.metadata) html += '<div style="font-size:9px;color:var(--text-dim);margin-top:8px;opacity:0.6">' + (g.metadata.aiUsed ? 'Claude IA' : 'Local') + ' \u00b7 ' + new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR') + '</div>'; html += '</div>'; return html; }

    var _prevRBS = typeof renderBankSections === 'function' ? renderBankSections : null;
    if (_prevRBS) { renderBankSections = function(state) { var html = _prevRBS(state); Object.keys(state.proposals).forEach(function(bankId) { var graded = (state.proposals[bankId] || []).filter(function(p) { return p.grading && p.grading.grade; }); if (!graded.length) return; var counts = { A:0, B:0, C:0, D:0, F:0 }; graded.forEach(function(p) { if (counts[p.grading.grade] !== undefined) counts[p.grading.grade]++; }); var summary = Object.entries(counts).filter(function(e) { return e[1] > 0; }).map(function(e) { var clr = ProposalGrader.config.grades[e[0]]?.color || '#888'; return '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:4px;background:' + clr + '22;color:' + clr + ';font-weight:700;font-size:10px;padding:0 4px">' + e[1] + e[0] + '</span>'; }).join(' '); if (summary) { var bn = (BANKS.find(function(b) { return b.id === bankId; })?.name || bankId); var bs = html.indexOf(bn); if (bs > -1) { var ci = html.indexOf('<span class="bank-count">', bs); if (ci > -1) { var ec = html.indexOf('</span>', ci) + 7; html = html.substring(0, ec) + '<span style="margin-left:6px">' + summary + '</span>' + html.substring(ec); } } } }); return html; }; }

    var _origAP = app.addProposal.bind(app);
    app.addProposal = async function(bankId, product) { var result = await _origAP(bankId, product); if (result && !result.grading) { try { var n = ProposalGrader.normalize(result); var pc = (app.state.portfolio || []).length > 0 ? { available: true, currentIssuerPct: 0, overlappingUnderlyings: [], totalProducts: app.state.portfolio.length } : { available: false }; var kc = ProposalGrader.checkKillCriteria(n, pc, { bestRate: 3.0 }); if (kc.killed) { result.grading = { grade: 'F', score: 0, killCriteria: { triggered: true, reasons: kc.reasons }, verdict: 'Rejet: ' + kc.reasons[0], metadata: { gradedAt: new Date().toISOString(), aiUsed: false, version: '2.1' } }; await app._saveProductFile(bankId, result); showToast('\u26d4 Grade F \u2014 ' + kc.reasons[0], 'error'); } } catch (e) {} } return result; };

    async function _handleBatch(state, mode) {
        var products = [], label = '';
        if (mode === 'ungraded') { products = Object.values(state.proposals).flat().filter(function(p) { return !p.grading; }); label = products.length + ' propositions non grad\u00e9es'; }
        else if (mode === 'portfolio') { products = (state.portfolio || []).filter(function(p) { return !p.grading || p.grading.grade !== '-'; }); label = products.length + ' produits portefeuille'; }
        else if (mode === 'all') { var pf = (state.portfolio || []).filter(function(p) { return !p.grading || p.grading.grade !== '-'; }); var pr = Object.values(state.proposals || {}).flat().filter(function(p) { return !p.grading || (p.grading.grade !== '-' && p.grading.grade !== '?'); }); products = pf.concat(pr); label = products.length + ' produits (portefeuille + propositions)'; }
        if (!products.length) { showToast('Rien \u00e0 grader', 'info'); return; }
        if (!confirm('Actualiser ' + label + ' ?\nDur\u00e9e : ~' + Math.ceil(products.length * 2.5 / 60) + ' min (' + products.length + ' appels Claude)')) return;
        if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }
        showToast('Grading de ' + label + '...', 'info');
        try {
            products.forEach(function(p) { delete p.grading; });
            var results = await ProposalGrader.gradeBatch(products, function(i, t, r) { showToast(i + '/' + t + ' \u2014 ' + (r.proposal?.name || '').substring(0, 20) + ' \u2192 ' + r.grading.grade, 'info'); });
            var pfSaved = false;
            for (var j = 0; j < results.length; j++) { var product = results[j].proposal; if (product.bankId) { try { await app._saveProductFile(product.bankId, product); } catch(e) {} } var pfP = (state.portfolio || []).find(function(p) { return p.id === product.id; }); if (pfP) { pfP.grading = product.grading; pfSaved = true; } }
            if (pfSaved) { try { await github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', state.portfolio, '[StructBoard] Batch re-grade ' + results.length + ' products'); } catch(e) {} }
            var counts = {}; results.forEach(function(r) { counts[r.grading.grade] = (counts[r.grading.grade] || 0) + 1; });
            showToast('Termin\u00e9 : ' + Object.entries(counts).map(function(e) { return e[1] + '\u00d7' + e[0]; }).join(', '), 'success');
            app.render();
        } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
    }

    window.batchReGradeAll = function() { _handleBatch(app.state, 'all'); };

    console.log('[StructBoard] GraderUI v2.1 \u2014 portfolio: suivi before grading');
})();

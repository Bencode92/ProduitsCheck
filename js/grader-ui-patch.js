// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader UI Patch v1.4 — with Actualiser button
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    if (typeof ProposalGrader === 'undefined') {
        console.warn('[GraderUI] ProposalGrader not loaded');
        return;
    }

    // ─── 0. KILL CRITERIA: remove issuer concentration ───────────
    if (typeof GRADING_CONFIG !== 'undefined' && GRADING_CONFIG.killCriteria) {
        delete GRADING_CONFIG.killCriteria.maxIssuerConcentration;
    }

    // Clear old F grades from GitHub
    async function _clearOldKillGrading() {
        let cleared = 0;
        for (const [bankId, proposals] of Object.entries(app.state?.proposals || {})) {
            for (const p of proposals) {
                if (p.grading && p.grading.killCriteria?.triggered) {
                    const reasons = p.grading.killCriteria.reasons || [];
                    if (reasons.some(r => r.includes('metteur') || r.includes('book') || r.includes('max: 40'))) {
                        delete p.grading;
                        cleared++;
                        try { await app._saveProductFile(bankId, p); } catch(e){}
                    }
                }
            }
        }
        if (cleared > 0) { console.log(`[GraderUI] Cleared ${cleared} old F grades`); app.render(); }
    }
    setTimeout(_clearOldKillGrading, 3000);

    // ─── 1. OVERRIDE triggerGrading — save + full re-render ──────
    window.triggerGrading = async function(btn) {
        const product = app.state.currentProduct;
        if (!product) { showToast('Aucun produit', 'error'); return; }

        if (btn && btn.disabled) return;
        if (btn) { btn.disabled = true; btn.textContent = '\u23f3 Analyse en cours...'; }

        try {
            // Clear old grading so it gets fresh data
            delete product.grading;
            // Clear market cache to force reload with parse fix
            if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }

            showToast('Grading en cours...', 'info');
            const result = await ProposalGrader.grade(product);

            // SAVE to GitHub
            if (product.bankId) {
                await app._saveProductFile(product.bankId, product);
            }

            // FULL re-render of the product sheet
            app.openProduct(product);

            const gc = ProposalGrader.config.grades[result.grade] || {};
            showToast(`Grade ${result.grade} \u2014 ${gc.label} (${result.score}/100)`, 'success');
        } catch (e) {
            console.error('[Grader] Error:', e);
            if (btn) { btn.textContent = '\u274c Erreur'; btn.disabled = false; }
            showToast('Erreur: ' + e.message, 'error');
        }
    };

    // ─── 2. PATCH renderProductCard — Badge grade ────────────────
    const _prevRenderProductCard = renderProductCard;
    renderProductCard = function(product, context) {
        let html = _prevRenderProductCard(product, context);
        const g = product.grading;
        if (g && g.grade && g.grade !== '?') {
            const badge = ProposalGrader.renderBadge(g.grade, g.score);
            html = html.replace(/<div class="card-score[^"]*">[^<]*<\/div>/, badge);
            if (!html.includes('style="display:inline-flex')) {
                const fi = html.indexOf('product-card-footer');
                if (fi > -1) { const ii = html.indexOf('>', fi) + 1; html = html.substring(0, ii) + badge + html.substring(ii); }
            }
        }
        return html;
    };

    // ─── 3. PATCH renderProductSheet — clean + inject ─────────────
    const _prevRenderProductSheet = renderProductSheet;
    renderProductSheet = function(container, state) {
        _prevRenderProductSheet(container, state);
        const p = state.currentProduct;
        if (!p) return;
        setTimeout(() => _cleanupProductSheet(container, p), 0);
    };

    function _cleanupProductSheet(container, p) {
        const sheetMain = container.querySelector('.sheet-main');
        const sidebar = container.querySelector('.sheet-sidebar');

        // Remove top nav actions (duplicated in sidebar)
        const navActions = container.querySelector('.sheet-nav-actions');
        if (navActions) navActions.remove();

        // Remove ALL old analysis sections
        if (sheetMain) {
            sheetMain.querySelectorAll('.fiche-section').forEach(section => {
                const title = section.querySelector('.fiche-section-title');
                if (!title) return;
                const t = title.textContent.trim().toLowerCase();
                if (t.includes('analyse ia') || t.includes('r\u00e9sum\u00e9 ia') ||
                    t.includes('r\u00e9sum\u00e9 discussion') || t.includes('analyse approfondie') ||
                    t.includes('grading unifi')) {
                    section.remove();
                }
            });
            sheetMain.querySelectorAll('.deep-analysis-section, [data-section="deep-analysis"]').forEach(s => s.remove());
            sheetMain.querySelectorAll('.fiche-ai-summary').forEach(el => {
                const parent = el.closest('.fiche-section');
                if (parent) parent.remove();
            });
            sheetMain.querySelectorAll('.fiche-section').forEach(section => {
                if (section.textContent.includes('Analyse approfondie')) section.remove();
            });
        }

        // Remove old sidebar score panel
        if (sidebar) {
            sidebar.querySelectorAll('.sheet-card').forEach(card => {
                const title = card.querySelector('.sheet-card-title, h3');
                if (title) {
                    const t = title.textContent.trim().toLowerCase();
                    if (t.includes('score') || t.includes('compatib')) card.remove();
                }
            });
            sidebar.querySelectorAll('.score-panel').forEach(el => el.remove());
        }

        // Replace header score widget
        const scoreWidget = container.querySelector('.score-widget');
        if (scoreWidget) {
            if (p.grading) {
                scoreWidget.outerHTML = ProposalGrader.renderBadge(p.grading.grade, p.grading.score, 'large');
            } else {
                scoreWidget.outerHTML = '<div style="width:80px;height:80px;border-radius:50%;border:3px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0.5" onclick="triggerGrading(this)"><span style="font-size:20px;color:var(--text-muted)">?</span></div>';
            }
        }

        // ═══ Inject grading section WITH Actualiser button ═══
        if (sheetMain) {
            const gd = document.createElement('div');
            gd.className = 'fiche-section';
            gd.setAttribute('data-section', 'grading');

            // Header with Actualiser button
            const refreshBtn = p.grading
                ? '<button onclick="triggerGrading(this)" style="margin-left:auto;padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;font-size:11px;display:flex;align-items:center;gap:4px">\ud83d\udd04 Actualiser</button>'
                : '';

            gd.innerHTML = '<div class="fiche-section-header" style="display:flex;align-items:center">' +
                '<span class="fiche-section-icon">\ud83c\udfaf</span>' +
                '<span class="fiche-section-title">Grading Unifi\u00e9</span>' +
                refreshBtn +
                '</div>' +
                '<div class="fiche-section-body">' +
                ProposalGrader.renderSection(p.grading) +
                '</div>';

            sheetMain.prepend(gd);
        }

        // Inject sidebar grade panel
        if (sidebar) {
            const panel = document.createElement('div');
            panel.innerHTML = _buildGradeSidebarPanel(p.grading);
            if (panel.firstElementChild) sidebar.insertBefore(panel.firstElementChild, sidebar.firstChild);
        }
    }

    // ─── 4. DISABLE injectDeepAnalysis completely ────────────────
    function _disableDeepAnalysis() {
        if (typeof window.injectDeepAnalysis === 'function' && !window._deepAnalysisDisabled) {
            window._origInjectDeepAnalysis = window.injectDeepAnalysis;
            window.injectDeepAnalysis = function() {};
            window._deepAnalysisDisabled = true;
        }
    }
    _disableDeepAnalysis();
    setTimeout(_disableDeepAnalysis, 100);
    setTimeout(_disableDeepAnalysis, 500);

    // ─── 5. Grade sidebar panel builder ──────────────────────────
    function _buildGradeSidebarPanel(grading) {
        if (!grading) {
            return '<div class="sheet-card"><h3 class="sheet-card-title">Grade</h3><div style="text-align:center;padding:20px 0;"><div style="width:64px;height:64px;border-radius:50%;border:3px dashed var(--border);display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px"><span style="font-size:24px;color:var(--text-muted)">?</span></div><div style="font-size:12px;color:var(--text-muted)">Non grad\u00e9</div></div></div>';
        }
        const g = grading;
        const config = ProposalGrader.config.grades[g.grade] || ProposalGrader.config.grades.F;
        const color = config.color;
        let html = '<div class="sheet-card" style="border-top:3px solid ' + color + '"><h3 class="sheet-card-title">Grade</h3><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' + ProposalGrader.renderBadge(g.grade, g.score, 'large') + '<div><div style="font-size:14px;font-weight:600;color:' + color + '">' + config.label + '</div><div style="font-size:11px;color:var(--text-muted)">' + (g.score !== null ? g.score + '/100' : '') + '</div></div></div>';
        if (g.killCriteria && g.killCriteria.triggered) {
            html += '<div style="background:rgba(239,35,60,0.08);border-radius:6px;padding:8px;margin-bottom:10px;"><div style="font-size:11px;font-weight:600;color:#EF233C;margin-bottom:4px">\u26d4 Rejet automatique</div>' + g.killCriteria.reasons.map(function(r) { return '<div style="font-size:10px;color:#EF233C;padding:1px 0">\u2022 ' + r + '</div>'; }).join('') + '</div>';
        }
        var pn = { adjustedReturn: 'Rendement', underlyingQuality: 'Sous-jacent', portfolioFit: 'Fit portfolio', riskPremium: 'Prime/CAT' };
        if (g.pillars) {
            Object.entries(pn).forEach(function(e) {
                var key = e[0], name = e[1], pillar = g.pillars[key] || {}, score = pillar.score;
                if (score === null || score === undefined) return;
                var bc = score >= 70 ? '#06D6A0' : score >= 45 ? '#FFB627' : '#EF233C';
                html += '<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span style="color:var(--text-muted)">' + name + '</span><span style="font-weight:600">' + score + '</span></div><div style="height:4px;background:var(--surface);border-radius:2px;overflow:hidden"><div style="height:100%;width:' + score + '%;background:' + bc + ';border-radius:2px"></div></div></div>';
            });
        }
        if (g.verdict) html += '<div style="font-size:11px;color:var(--text-muted);margin-top:10px;padding-top:8px;border-top:1px solid var(--border);line-height:1.4">' + g.verdict + '</div>';
        if (g.keyRisks && g.keyRisks.length > 0) { html += '<div style="margin-top:8px">'; g.keyRisks.forEach(function(r) { html += '<div style="font-size:10px;color:var(--red);padding:2px 0">\u26a0 ' + r + '</div>'; }); html += '</div>'; }
        if (g.metadata) html += '<div style="font-size:9px;color:var(--text-dim);margin-top:8px;opacity:0.6">' + (g.metadata.aiUsed ? 'Claude IA' : 'Local') + ' \u00b7 ' + new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR') + '</div>';
        html += '</div>';
        return html;
    }

    // ─── 6. Bank section badges ──────────────────────────────────
    var _prevRBS = typeof renderBankSections === 'function' ? renderBankSections : null;
    if (_prevRBS) {
        renderBankSections = function(state) {
            var html = _prevRBS(state);
            Object.keys(state.proposals).forEach(function(bankId) {
                var graded = (state.proposals[bankId] || []).filter(function(p) { return p.grading && p.grading.grade; });
                if (!graded.length) return;
                var counts = { A:0, B:0, C:0, D:0, F:0 };
                graded.forEach(function(p) { if (counts[p.grading.grade] !== undefined) counts[p.grading.grade]++; });
                var summary = Object.entries(counts).filter(function(e) { return e[1] > 0; }).map(function(e) { var clr = ProposalGrader.config.grades[e[0]]?.color || '#888'; return '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:4px;background:' + clr + '22;color:' + clr + ';font-weight:700;font-size:10px;padding:0 4px">' + e[1] + e[0] + '</span>'; }).join(' ');
                if (summary) { var bn = (BANKS.find(function(b) { return b.id === bankId; })?.name || bankId); var bs = html.indexOf(bn); if (bs > -1) { var ci = html.indexOf('<span class="bank-count">', bs); if (ci > -1) { var ec = html.indexOf('</span>', ci) + 7; html = html.substring(0, ec) + '<span style="margin-left:6px">' + summary + '</span>' + html.substring(ec); } } }
            });
            return html;
        };
    }

    // ─── 7. Auto kill-check on upload ────────────────────────────
    var _origAP = app.addProposal.bind(app);
    app.addProposal = async function(bankId, product) {
        var result = await _origAP(bankId, product);
        if (result && !result.grading) {
            try {
                var n = ProposalGrader.normalize(result);
                var pc = (app.state.portfolio || []).length > 0 ? { available: true, currentIssuerPct: 0, overlappingUnderlyings: [], totalProducts: app.state.portfolio.length } : { available: false };
                var kc = ProposalGrader.checkKillCriteria(n, pc, { bestRate: 3.0 });
                if (kc.killed) {
                    result.grading = { grade: 'F', score: 0, killCriteria: { triggered: true, reasons: kc.reasons }, verdict: 'Rejet automatique : ' + kc.reasons[0], metadata: { gradedAt: new Date().toISOString(), aiUsed: false, version: '1.4' } };
                    await app._saveProductFile(bankId, result);
                    showToast('\u26d4 Grade F \u2014 ' + kc.reasons[0], 'error');
                }
            } catch (e) { console.warn('[GraderUI] kill-check failed:', e); }
        }
        return result;
    };

    // ─── 8. Batch grade button ───────────────────────────────────
    var _dashPatch = function(container, state) {
        setTimeout(function() {
            container.querySelectorAll('.section-header').forEach(function(header) {
                var title = header.querySelector('.section-title');
                if (title && title.textContent.includes('Propositions') && !header.querySelector('.btn-grade-all')) {
                    var ungraded = Object.values(state.proposals).flat().filter(function(p) { return !p.grading; });
                    if (ungraded.length > 0) {
                        var btn = document.createElement('button');
                        btn.className = 'btn btn-grade-all';
                        btn.style.cssText = 'margin-right:8px;white-space:nowrap';
                        btn.innerHTML = '\ud83c\udfaf Grader tout (' + ungraded.length + ')';
                        btn.onclick = function() { _handleBatch(state); };
                        var ab = header.querySelector('.btn.primary');
                        if (ab) header.insertBefore(btn, ab);
                    }
                }
            });
        }, 50);
    };
    var _di2 = setInterval(function() {
        if (typeof renderDashboard === 'function') {
            var _cd2 = renderDashboard;
            renderDashboard = function(c, s) { _cd2(c, s); _dashPatch(c, s); };
            clearInterval(_di2);
        }
    }, 100);
    setTimeout(function() { clearInterval(_di2); }, 5000);

    async function _handleBatch(state) {
        var ungraded = Object.values(state.proposals).flat().filter(function(p) { return !p.grading; });
        if (!ungraded.length) { showToast('Tout grad\u00e9', 'info'); return; }
        if (!confirm('Grader ' + ungraded.length + ' propositions ?')) return;
        showToast('Grading...', 'info');
        try {
            var results = await ProposalGrader.gradeBatch(ungraded, function(i, t, r) { showToast(i + '/' + t + ' \u2014 ' + r.grading.grade, 'info'); });
            for (var j = 0; j < results.length; j++) { var pr = results[j].proposal; if (pr.bankId) try { await app._saveProductFile(pr.bankId, pr); } catch(e){} }
            var counts = {}; results.forEach(function(r) { counts[r.grading.grade] = (counts[r.grading.grade]||0)+1; });
            showToast('Termin\u00e9 : ' + Object.entries(counts).map(function(e) { return e[1] + '\u00d7' + e[0]; }).join(', '), 'success');
            app.render();
        } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
    }

    console.log('[StructBoard] GraderUI v1.4 loaded');
})();

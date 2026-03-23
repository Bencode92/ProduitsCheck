// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader UI Patch v1.2 — CLEAN + FIX PERSIST
// ═══════════════════════════════════════════════════════════════
// v1.2 fixes: saves cleared grading back to GitHub, removes dup nav buttons
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    if (typeof ProposalGrader === 'undefined') {
        console.warn('[GraderUI] ProposalGrader not loaded, skipping');
        return;
    }

    // ─── 0. KILL CRITERIA FIX ────────────────────────────────────
    // Remove issuer concentration from kill criteria COMPLETELY
    // It's handled by portfolioFit pillar (-20 to -30 pts penalty) instead
    if (typeof GRADING_CONFIG !== 'undefined' && GRADING_CONFIG.killCriteria) {
        delete GRADING_CONFIG.killCriteria.maxIssuerConcentration;
    }

    // Clear persisted F grades caused by old issuer-kill rule
    // MUST also save back to GitHub otherwise it reloads the old F
    async function _clearOldKillGrading() {
        let cleared = 0;
        for (const [bankId, proposals] of Object.entries(app.state?.proposals || {})) {
            for (const p of proposals) {
                if (p.grading && p.grading.killCriteria?.triggered) {
                    const reasons = p.grading.killCriteria.reasons || [];
                    const wasIssuerKill = reasons.some(r =>
                        r.includes('metteur') || r.includes('book') || r.includes('max: 40')
                    );
                    if (wasIssuerKill) {
                        delete p.grading;
                        cleared++;
                        // Save back to GitHub to clear the persisted F
                        try {
                            await app._saveProductFile(bankId, p);
                        } catch (e) { console.warn('[GraderUI] Save failed for', p.name); }
                    }
                }
            }
        }
        if (cleared > 0) {
            console.log(`[GraderUI] Cleared ${cleared} old issuer-kill gradings & saved`);
            app.render(); // Re-render to show the clean state
        }
    }
    setTimeout(_clearOldKillGrading, 3000);

    // ─── 1. PATCH renderProductCard — Badge grade ────────────────

    const _prevRenderProductCard = renderProductCard;
    renderProductCard = function(product, context) {
        let html = _prevRenderProductCard(product, context);
        const grading = product.grading;
        if (grading && grading.grade && grading.grade !== '?') {
            const badge = ProposalGrader.renderBadge(grading.grade, grading.score);
            html = html.replace(/<div class="card-score[^"]*">[^<]*<\/div>/, badge);
            if (!html.includes('style="display:inline-flex')) {
                const footerIdx = html.indexOf('product-card-footer');
                if (footerIdx > -1) {
                    const insertIdx = html.indexOf('>', footerIdx) + 1;
                    html = html.substring(0, insertIdx) + badge + html.substring(insertIdx);
                }
            }
        }
        return html;
    };

    // ─── 2. PATCH renderProductSheet — NETTOYAGE COMPLET ─────────

    const _prevRenderProductSheet = renderProductSheet;
    renderProductSheet = function(container, state) {
        _prevRenderProductSheet(container, state);
        const p = state.currentProduct;
        if (!p) return;

        const sheetMain = container.querySelector('.sheet-main');
        const sidebar = container.querySelector('.sheet-sidebar');

        // ═══ PHASE 0 — Supprimer les boutons d'action dupliqués du top bar ═══
        const sheetNavActions = container.querySelector('.sheet-nav-actions');
        if (sheetNavActions) {
            // Garder seulement le bouton Retour, supprimer les actions
            // (elles sont déjà dans la sidebar Actions)
            sheetNavActions.remove();
        }

        // ═══ PHASE 1 — Supprimer anciennes sections d'analyse ═══
        if (sheetMain) {
            sheetMain.querySelectorAll('.fiche-section').forEach(section => {
                const title = section.querySelector('.fiche-section-title');
                if (!title) return;
                const text = title.textContent.trim().toLowerCase();
                if (text.includes('analyse ia') ||
                    text.includes('résumé ia') ||
                    text.includes('résumé discussion') ||
                    text.includes('analyse approfondie') ||
                    text.includes('grading unifi')) {
                    section.remove();
                }
            });
            sheetMain.querySelectorAll('.deep-analysis-section, [data-section="deep-analysis"]').forEach(s => s.remove());
            sheetMain.querySelectorAll('.fiche-ai-summary').forEach(el => {
                const parent = el.closest('.fiche-section');
                if (parent) parent.remove();
            });
        }

        // ═══ PHASE 2 — Supprimer ancien sidebar score panel ═══
        if (sidebar) {
            sidebar.querySelectorAll('.sheet-card').forEach(card => {
                const title = card.querySelector('.sheet-card-title, h3');
                if (title) {
                    const text = title.textContent.trim().toLowerCase();
                    if (text.includes('score') || text.includes('compatib')) card.remove();
                }
            });
            sidebar.querySelectorAll('.score-panel').forEach(el => el.remove());
        }

        // ═══ PHASE 3 — Remplacer le cercle score du header ═══
        const scoreWidget = container.querySelector('.score-widget');
        if (scoreWidget) {
            if (p.grading) {
                scoreWidget.outerHTML = ProposalGrader.renderBadge(p.grading.grade, p.grading.score, 'large');
            } else {
                scoreWidget.outerHTML = `<div style="width:80px;height:80px;border-radius:50%;border:3px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0.5" onclick="triggerGrading(this)" title="Cliquer pour grader"><span style="font-size:20px;color:var(--text-muted)">?</span></div>`;
            }
        }

        // ═══ PHASE 4 — Injecter grading unifié ═══
        if (sheetMain) {
            const gradingDiv = document.createElement('div');
            gradingDiv.className = 'fiche-section';
            gradingDiv.setAttribute('data-section', 'grading');
            gradingDiv.innerHTML = `<div class="fiche-section-header"><span class="fiche-section-icon">\ud83c\udfaf</span><span class="fiche-section-title">Grading Unifi\u00e9</span></div><div class="fiche-section-body">${ProposalGrader.renderSection(p.grading)}</div>`;
            sheetMain.prepend(gradingDiv);
        }

        // ═══ PHASE 5 — Sidebar grade panel ═══
        if (sidebar) {
            const panel = document.createElement('div');
            panel.innerHTML = _buildGradeSidebarPanel(p.grading);
            if (panel.firstElementChild) {
                sidebar.insertBefore(panel.firstElementChild, sidebar.firstChild);
            }
        }
    };

    // ─── 3. DISABLE injectDeepAnalysis ───────────────────────────
    if (typeof window.injectDeepAnalysis === 'function') {
        window._origInjectDeepAnalysis = window.injectDeepAnalysis;
        window.injectDeepAnalysis = function(container, product) {
            if (product && product.grading) return;
            window._origInjectDeepAnalysis(container, product);
        };
    }

    // ─── 4. Grade sidebar panel builder ──────────────────────────

    function _buildGradeSidebarPanel(grading) {
        if (!grading) {
            return `<div class="sheet-card"><h3 class="sheet-card-title">Grade</h3><div style="text-align:center;padding:20px 0;"><div style="width:64px;height:64px;border-radius:50%;border:3px dashed var(--border);display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px"><span style="font-size:24px;color:var(--text-muted)">?</span></div><div style="font-size:12px;color:var(--text-muted)">Non grad\u00e9</div></div></div>`;
        }

        const g = grading;
        const config = ProposalGrader.config.grades[g.grade] || ProposalGrader.config.grades.F;
        const color = config.color;

        let html = `<div class="sheet-card" style="border-top:3px solid ${color}"><h3 class="sheet-card-title">Grade</h3><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">${ProposalGrader.renderBadge(g.grade, g.score, 'large')}<div><div style="font-size:14px;font-weight:600;color:${color}">${config.label}</div><div style="font-size:11px;color:var(--text-muted)">${g.score !== null ? g.score + '/100' : ''}</div></div></div>`;

        if (g.killCriteria && g.killCriteria.triggered) {
            html += `<div style="background:rgba(239,35,60,0.08);border-radius:6px;padding:8px;margin-bottom:10px;"><div style="font-size:11px;font-weight:600;color:#EF233C;margin-bottom:4px">\u26d4 Rejet automatique</div>${g.killCriteria.reasons.map(r => `<div style="font-size:10px;color:#EF233C;padding:1px 0">\u2022 ${r}</div>`).join('')}</div>`;
        }

        const pillarNames = { adjustedReturn: 'Rendement', underlyingQuality: 'Sous-jacent', portfolioFit: 'Fit portfolio', riskPremium: 'Prime/CAT' };
        if (g.pillars) {
            Object.entries(pillarNames).forEach(([key, name]) => {
                const pillar = g.pillars[key] || {};
                const score = pillar.score;
                if (score === null || score === undefined) return;
                const barColor = score >= 70 ? '#06D6A0' : score >= 45 ? '#FFB627' : '#EF233C';
                html += `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span style="color:var(--text-muted)">${name}</span><span style="font-weight:600">${score}</span></div><div style="height:4px;background:var(--surface);border-radius:2px;overflow:hidden"><div style="height:100%;width:${score}%;background:${barColor};border-radius:2px"></div></div></div>`;
            });
        }

        if (g.verdict) html += `<div style="font-size:11px;color:var(--text-muted);margin-top:10px;padding-top:8px;border-top:1px solid var(--border);line-height:1.4">${g.verdict}</div>`;
        if (g.keyRisks && g.keyRisks.length > 0) { html += `<div style="margin-top:8px">`; g.keyRisks.forEach(r => { html += `<div style="font-size:10px;color:var(--red);padding:2px 0">\u26a0 ${r}</div>`; }); html += `</div>`; }
        if (g.metadata) html += `<div style="font-size:9px;color:var(--text-dim);margin-top:8px;opacity:0.6">${g.metadata.aiUsed ? 'Claude IA' : 'Local'} \u00b7 ${new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR')}</div>`;

        html += `</div>`;
        return html;
    }

    // ─── 5. PATCH renderBankSections ─────────────────────────────

    const _prevRenderBankSections = typeof renderBankSections === 'function' ? renderBankSections : null;
    if (_prevRenderBankSections) {
        renderBankSections = function(state) {
            let html = _prevRenderBankSections(state);
            Object.keys(state.proposals).forEach(bankId => {
                const graded = (state.proposals[bankId] || []).filter(p => p.grading && p.grading.grade);
                if (graded.length === 0) return;
                const counts = { A:0, B:0, C:0, D:0, F:0 };
                graded.forEach(p => { if (counts[p.grading.grade] !== undefined) counts[p.grading.grade]++; });
                const summary = Object.entries(counts).filter(([,c]) => c > 0).map(([g,c]) => { const clr = ProposalGrader.config.grades[g]?.color || '#888'; return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:4px;background:${clr}22;color:${clr};font-weight:700;font-size:10px;padding:0 4px">${c}${g}</span>`; }).join(' ');
                if (summary) { const bn = BANKS.find(b => b.id === bankId)?.name || bankId; const bs = html.indexOf(bn); if (bs > -1) { const ci = html.indexOf('<span class="bank-count">', bs); if (ci > -1) { const ec = html.indexOf('</span>', ci) + 7; html = html.substring(0, ec) + `<span style="margin-left:6px">${summary}</span>` + html.substring(ec); } } }
            });
            return html;
        };
    }

    // ─── 6. Auto kill-check on upload ────────────────────────────

    const _origAddProposal = app.addProposal.bind(app);
    app.addProposal = async function(bankId, product) {
        const result = await _origAddProposal(bankId, product);
        if (result && !result.grading) {
            try {
                const normalized = ProposalGrader.normalize(result);
                const portfolioCtx = (app.state.portfolio || []).length > 0
                    ? { available: true, currentIssuerPct: 0, overlappingUnderlyings: [], totalProducts: app.state.portfolio.length }
                    : { available: false };
                const killCheck = ProposalGrader.checkKillCriteria(normalized, portfolioCtx, { bestRate: 3.0 });
                if (killCheck.killed) {
                    result.grading = { grade: 'F', score: 0, killCriteria: { triggered: true, reasons: killCheck.reasons }, verdict: `Rejet automatique : ${killCheck.reasons[0]}`, metadata: { gradedAt: new Date().toISOString(), aiUsed: false, version: '1.2' } };
                    await app._saveProductFile(bankId, result);
                    showToast(`\u26d4 Grade F \u2014 ${killCheck.reasons[0]}`, 'error');
                }
            } catch (e) { console.warn('[GraderUI] Auto kill-check failed:', e); }
        }
        return result;
    };

    // ─── 7. Batch grade button ───────────────────────────────────

    const _myDashboardPatch = function(container, state) {
        setTimeout(() => {
            container.querySelectorAll('.section-header').forEach(header => {
                const title = header.querySelector('.section-title');
                if (title && title.textContent.includes('Propositions') && !header.querySelector('.btn-grade-all')) {
                    const ungraded = Object.values(state.proposals).flat().filter(p => !p.grading);
                    if (ungraded.length > 0) {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-grade-all';
                        btn.style.cssText = 'margin-right:8px;white-space:nowrap';
                        btn.innerHTML = `\ud83c\udfaf Grader tout (${ungraded.length})`;
                        btn.onclick = () => _handleBatchGrade(state);
                        const addBtn = header.querySelector('.btn.primary');
                        if (addBtn) header.insertBefore(btn, addBtn);
                    }
                }
            });
        }, 50);
    };

    const _di = setInterval(() => {
        if (typeof renderDashboard === 'function') {
            const _cd = renderDashboard;
            renderDashboard = function(c, s) { _cd(c, s); _myDashboardPatch(c, s); };
            clearInterval(_di);
        }
    }, 100);
    setTimeout(() => clearInterval(_di), 5000);

    async function _handleBatchGrade(state) {
        const ungraded = Object.values(state.proposals).flat().filter(p => !p.grading);
        if (!ungraded.length) { showToast('Tout est grad\u00e9', 'info'); return; }
        if (!confirm(`Grader ${ungraded.length} propositions ? ~${Math.ceil(ungraded.length * 2.5 / 60)} min.`)) return;
        showToast('Grading...', 'info');
        try {
            const results = await ProposalGrader.gradeBatch(ungraded, (i, t, r) => showToast(`${i}/${t} \u2014 ${r.grading.grade}`, 'info'));
            for (const { proposal } of results) { if (proposal.bankId) try { await app._saveProductFile(proposal.bankId, proposal); } catch(e){} }
            const counts = {}; results.forEach(r => { counts[r.grading.grade] = (counts[r.grading.grade]||0)+1; });
            showToast(`Termin\u00e9 : ${Object.entries(counts).map(([g,c])=>`${c}\u00d7${g}`).join(', ')}`, 'success');
            const toReject = results.filter(r => ['D','F'].includes(r.grading.grade));
            if (toReject.length > 0 && confirm(`${toReject.length} D/F. Rejeter ?`)) {
                for (const { proposal } of toReject) { const bid = _resolveBankId(proposal.id, proposal.bankId); if (bid) await app.updateProposalStatus(bid, proposal.id, 'rejected', `Grade ${proposal.grading.grade}`); }
            }
            app.render();
        } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
    }

    console.log('[StructBoard] GraderUI Patch v1.2 loaded');
})();

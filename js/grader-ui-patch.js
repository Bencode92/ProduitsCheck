// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader UI Patch v1.1 — CLEAN REWRITE
// ═══════════════════════════════════════════════════════════════
// Replaces ALL old analysis sections with the unified grading.
// Old sections removed: Analyse IA, Score Compatibilité,
//   Analyse Approfondie, Résumé IA portefeuille
// Kept: Grading Unifié, Suivi Performance, Caractéristiques
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    if (typeof ProposalGrader === 'undefined') {
        console.warn('[GraderUI] ProposalGrader not loaded, skipping');
        return;
    }

    // ─── 0. FIX: Remove issuer concentration from kill criteria ──
    // Concentration is handled by portfolioFit pillar (-20 to -30 pts), not as an auto-kill
    // This allows full AI analysis even for concentrated portfolios
    if (typeof GRADING_CONFIG !== 'undefined' && GRADING_CONFIG.killCriteria) {
        delete GRADING_CONFIG.killCriteria.maxIssuerConcentration;
        console.log('[GraderUI] Kill criteria: issuer concentration disabled (→ pilier Fit)');
    }
    // Also clear any cached F grading from previous version
    // so products get re-analyzed with the new rules
    function _clearOldKillGrading() {
        const proposals = Object.values(app.state?.proposals || {}).flat();
        proposals.forEach(p => {
            if (p.grading && p.grading.killCriteria?.triggered) {
                const reasons = p.grading.killCriteria.reasons || [];
                const wasIssuerKill = reasons.some(r => r.includes('metteur') || r.includes('book'));
                if (wasIssuerKill) {
                    delete p.grading;  // Clear so it can be re-graded
                    console.log('[GraderUI] Cleared old issuer-kill grading for:', p.name);
                }
            }
        });
    }
    setTimeout(_clearOldKillGrading, 2000);  // After app.init()


    // ─── 1. PATCH renderProductCard — Badge grade dans le footer ──

    const _prevRenderProductCard = renderProductCard;
    renderProductCard = function(product, context) {
        let html = _prevRenderProductCard(product, context);

        const grading = product.grading;
        if (grading && grading.grade && grading.grade !== '?') {
            const badge = ProposalGrader.renderBadge(grading.grade, grading.score);
            // Remplacer le score numérique existant
            html = html.replace(/<div class="card-score[^"]*">[^<]*<\/div>/, badge);
            // Si pas de score existant, injecter dans le footer
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

        // ══════════════════════════════════════════════════════════
        // PHASE 1 — SUPPRIMER toutes les anciennes sections d'analyse
        // ══════════════════════════════════════════════════════════

        const sheetMain = container.querySelector('.sheet-main');
        const sidebar = container.querySelector('.sheet-sidebar');

        if (sheetMain) {
            // Supprimer par titre de section (texte dans fiche-section-title)
            const allSections = sheetMain.querySelectorAll('.fiche-section');
            allSections.forEach(section => {
                const title = section.querySelector('.fiche-section-title');
                if (!title) return;
                const text = title.textContent.trim().toLowerCase();

                // Sections à supprimer :
                if (text.includes('analyse ia') ||
                    text.includes('résumé ia') ||
                    text.includes('résumé discussion') ||
                    text.includes('analyse approfondie') ||
                    text.includes('grading unifi')) {  // remove any previous grading section too
                    section.remove();
                }
            });

            // Supprimer aussi les sections injectées par deep-analysis.js
            const deepSections = sheetMain.querySelectorAll('.deep-analysis-section, [data-section="deep-analysis"]');
            deepSections.forEach(s => s.remove());

            // Supprimer l'ancien résumé IA (qui peut être un div standalone)
            sheetMain.querySelectorAll('.fiche-ai-summary').forEach(el => {
                // Remonter au parent .fiche-section si possible
                const parent = el.closest('.fiche-section');
                if (parent) parent.remove();
            });
        }

        // ══════════════════════════════════════════════════════════
        // PHASE 2 — SUPPRIMER l'ancien sidebar score panel
        // ══════════════════════════════════════════════════════════

        if (sidebar) {
            // Supprimer le "Score de Compatibilité" panel
            const allCards = sidebar.querySelectorAll('.sheet-card');
            allCards.forEach(card => {
                const title = card.querySelector('.sheet-card-title, h3');
                if (title) {
                    const text = title.textContent.trim().toLowerCase();
                    if (text.includes('score') || text.includes('compatib')) {
                        card.remove();
                    }
                }
            });

            // Supprimer aussi le score-panel par classe
            sidebar.querySelectorAll('.score-panel').forEach(el => el.remove());
        }

        // ══════════════════════════════════════════════════════════
        // PHASE 3 — REMPLACER le score widget du header (cercle 39)
        // ══════════════════════════════════════════════════════════

        const scoreWidget = container.querySelector('.score-widget');
        if (scoreWidget) {
            if (p.grading) {
                scoreWidget.outerHTML = ProposalGrader.renderBadge(p.grading.grade, p.grading.score, 'large');
            } else {
                // Pas encore gradé : afficher un placeholder
                scoreWidget.outerHTML = `<div style="width:80px;height:80px;border-radius:50%;border:3px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0.5" onclick="triggerGrading(this)" title="Cliquer pour grader">
                    <span style="font-size:20px;color:var(--text-muted)">?</span>
                </div>`;
            }
        }

        // ══════════════════════════════════════════════════════════
        // PHASE 4 — INJECTER le grading unifié (section + sidebar)
        // ══════════════════════════════════════════════════════════

        if (sheetMain) {
            const gradingDiv = document.createElement('div');
            gradingDiv.className = 'fiche-section';
            gradingDiv.setAttribute('data-section', 'grading');
            gradingDiv.innerHTML = `
                <div class="fiche-section-header">
                    <span class="fiche-section-icon">\ud83c\udfaf</span>
                    <span class="fiche-section-title">Grading Unifi\u00e9</span>
                </div>
                <div class="fiche-section-body">
                    ${ProposalGrader.renderSection(p.grading)}
                </div>`;

            // Insérer en première position (avant Suivi Performance et tout le reste)
            sheetMain.prepend(gradingDiv);
        }

        // Sidebar : injecter le grade panel
        if (sidebar) {
            const panel = document.createElement('div');
            panel.innerHTML = _buildGradeSidebarPanel(p.grading);
            if (panel.firstElementChild) {
                sidebar.insertBefore(panel.firstElementChild, sidebar.firstChild);
            }
        }
    };

    // ─── 3. DISABLE injectDeepAnalysis ───────────────────────────
    // Empêcher deep-analysis.js d'injecter son contenu (on le remplace)

    if (typeof window.injectDeepAnalysis === 'function') {
        window._origInjectDeepAnalysis = window.injectDeepAnalysis;
        window.injectDeepAnalysis = function(container, product) {
            // Si le produit a un grading, ne pas injecter la deep analysis
            if (product && product.grading) return;
            // Sinon, laisser l'ancien comportement
            window._origInjectDeepAnalysis(container, product);
        };
    }

    // ─── 4. Grade sidebar panel ──────────────────────────────────

    function _buildGradeSidebarPanel(grading) {
        if (!grading) {
            return `<div class="sheet-card">
                <h3 class="sheet-card-title">Grade</h3>
                <div style="text-align:center;padding:20px 0;">
                    <div style="width:64px;height:64px;border-radius:50%;border:3px dashed var(--border);display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px">
                        <span style="font-size:24px;color:var(--text-muted)">?</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted)">Non grad\u00e9</div>
                </div>
            </div>`;
        }

        const g = grading;
        const config = ProposalGrader.config.grades[g.grade] || ProposalGrader.config.grades.F;
        const color = config.color;

        let html = `<div class="sheet-card" style="border-top:3px solid ${color}">
            <h3 class="sheet-card-title">Grade</h3>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                ${ProposalGrader.renderBadge(g.grade, g.score, 'large')}
                <div>
                    <div style="font-size:14px;font-weight:600;color:${color}">${config.label}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${g.score !== null ? g.score + '/100' : ''}</div>
                </div>
            </div>`;

        if (g.killCriteria && g.killCriteria.triggered) {
            html += `<div style="background:rgba(239,35,60,0.08);border-radius:6px;padding:8px;margin-bottom:10px;">
                <div style="font-size:11px;font-weight:600;color:#EF233C;margin-bottom:4px">\u26d4 Rejet automatique</div>
                ${g.killCriteria.reasons.map(r =>
                    `<div style="font-size:10px;color:#EF233C;padding:1px 0">\u2022 ${r}</div>`
                ).join('')}
            </div>`;
        }

        const pillarNames = {
            adjustedReturn: 'Rendement',
            underlyingQuality: 'Sous-jacent',
            portfolioFit: 'Fit portfolio',
            riskPremium: 'Prime/CAT'
        };

        if (g.pillars) {
            Object.entries(pillarNames).forEach(([key, name]) => {
                const pillar = g.pillars[key] || {};
                const score = pillar.score;
                if (score === null || score === undefined) return;

                const barColor = score >= 70 ? '#06D6A0' : score >= 45 ? '#FFB627' : '#EF233C';
                html += `<div style="margin-bottom:6px">
                    <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">
                        <span style="color:var(--text-muted)">${name}</span>
                        <span style="font-weight:600">${score}</span>
                    </div>
                    <div style="height:4px;background:var(--surface);border-radius:2px;overflow:hidden">
                        <div style="height:100%;width:${score}%;background:${barColor};border-radius:2px"></div>
                    </div>
                </div>`;
            });
        }

        if (g.verdict) {
            html += `<div style="font-size:11px;color:var(--text-muted);margin-top:10px;padding-top:8px;border-top:1px solid var(--border);line-height:1.4">${g.verdict}</div>`;
        }

        if (g.keyRisks && g.keyRisks.length > 0) {
            html += `<div style="margin-top:8px">`;
            g.keyRisks.forEach(r => {
                html += `<div style="font-size:10px;color:var(--red);padding:2px 0">\u26a0 ${r}</div>`;
            });
            html += `</div>`;
        }

        if (g.metadata) {
            html += `<div style="font-size:9px;color:var(--text-dim);margin-top:8px;opacity:0.6">
                ${g.metadata.aiUsed ? 'Claude IA' : 'Local'} \u00b7 ${new Date(g.metadata.gradedAt).toLocaleDateString('fr-FR')}
            </div>`;
        }

        html += `</div>`;
        return html;
    }

    // ─── 5. PATCH renderBankSections — Grade badges ──────────────

    const _prevRenderBankSections = typeof renderBankSections === 'function' ? renderBankSections : null;
    if (_prevRenderBankSections) {
        renderBankSections = function(state) {
            let html = _prevRenderBankSections(state);

            Object.keys(state.proposals).forEach(bankId => {
                const proposals = state.proposals[bankId] || [];
                const graded = proposals.filter(p => p.grading && p.grading.grade);
                if (graded.length === 0) return;

                const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
                graded.forEach(p => { if (counts[p.grading.grade] !== undefined) counts[p.grading.grade]++; });

                const summary = Object.entries(counts)
                    .filter(([, c]) => c > 0)
                    .map(([grade, count]) => {
                        const color = ProposalGrader.config.grades[grade]?.color || '#888';
                        return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:4px;background:${color}22;color:${color};font-weight:700;font-size:10px;padding:0 4px">${count}${grade}</span>`;
                    }).join(' ');

                if (summary) {
                    const bankName = (BANKS.find(b => b.id === bankId)?.name || bankId);
                    const bankStart = html.indexOf(bankName);
                    if (bankStart > -1) {
                        const countIdx = html.indexOf('<span class="bank-count">', bankStart);
                        if (countIdx > -1) {
                            const endOfCount = html.indexOf('</span>', countIdx) + 7;
                            html = html.substring(0, endOfCount) +
                                `<span style="margin-left:6px">${summary}</span>` +
                                html.substring(endOfCount);
                        }
                    }
                }
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
                const portfolio = app.state.portfolio || [];
                const portfolioCtx = portfolio.length > 0
                    ? { available: true, currentIssuerPct: 0, overlappingUnderlyings: [], totalProducts: portfolio.length }
                    : { available: false };
                const killCheck = ProposalGrader.checkKillCriteria(normalized, portfolioCtx, { bestRate: 3.0 });

                if (killCheck.killed) {
                    result.grading = {
                        grade: 'F', score: 0,
                        killCriteria: { triggered: true, reasons: killCheck.reasons },
                        verdict: `Rejet automatique : ${killCheck.reasons[0]}`,
                        metadata: { gradedAt: new Date().toISOString(), aiUsed: false, version: '1.0' }
                    };
                    await app._saveProductFile(bankId, result);
                    showToast(`\u26d4 Grade F \u2014 ${killCheck.reasons[0]}`, 'error');
                }
            } catch (e) {
                console.warn('[GraderUI] Auto kill-check failed:', e);
            }
        }
        return result;
    };

    // ─── 7. Batch grade button ───────────────────────────────────

    const _myDashboardPatch = function(container, state) {
        setTimeout(() => {
            container.querySelectorAll('.section-header').forEach(header => {
                const title = header.querySelector('.section-title');
                if (title && title.textContent.includes('Propositions') && !header.querySelector('.btn-grade-all')) {
                    const allProposals = Object.values(state.proposals).flat();
                    const ungraded = allProposals.filter(p => !p.grading);
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

    const _dashboardInterval = setInterval(() => {
        if (typeof renderDashboard === 'function') {
            const _currentDashboard = renderDashboard;
            renderDashboard = function(container, state) {
                _currentDashboard(container, state);
                _myDashboardPatch(container, state);
            };
            clearInterval(_dashboardInterval);
        }
    }, 100);
    setTimeout(() => clearInterval(_dashboardInterval), 5000);

    async function _handleBatchGrade(state) {
        const ungraded = Object.values(state.proposals).flat().filter(p => !p.grading);
        if (ungraded.length === 0) { showToast('Tout est grad\u00e9', 'info'); return; }
        if (!confirm(`Grader ${ungraded.length} propositions ? ~${Math.ceil(ungraded.length * 2.5 / 60)} min.`)) return;

        showToast(`Grading en cours...`, 'info');
        try {
            const results = await ProposalGrader.gradeBatch(ungraded, (i, total, result) => {
                showToast(`${i}/${total} \u2014 Grade ${result.grading.grade}`, 'info');
            });

            for (const { proposal } of results) {
                if (proposal.bankId) try { await app._saveProductFile(proposal.bankId, proposal); } catch(e){}
            }

            const counts = {};
            results.forEach(r => { counts[r.grading.grade] = (counts[r.grading.grade]||0) + 1; });
            showToast(`Termin\u00e9 : ${Object.entries(counts).map(([g,c])=>`${c}\u00d7${g}`).join(', ')}`, 'success');

            const toReject = results.filter(r => ['D','F'].includes(r.grading.grade));
            if (toReject.length > 0 && confirm(`${toReject.length} D/F. Rejeter ?`)) {
                for (const { proposal } of toReject) {
                    const bid = _resolveBankId(proposal.id, proposal.bankId);
                    if (bid) await app.updateProposalStatus(bid, proposal.id, 'rejected', `Grade ${proposal.grading.grade}`);
                }
            }
            app.render();
        } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
    }

    console.log('[StructBoard] GraderUI Patch v1.1 loaded \u2014 clean UI');
})();

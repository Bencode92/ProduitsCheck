// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Grader UI Patch v1.0
// ═══════════════════════════════════════════════════════════════
// Injecte le grading unifié A-F dans :
//   1. Fiche produit (remplace Analyse IA + Score compatibilité + Deep Analysis)
//   2. Cards produit (badge grade dans le footer)
//   3. Liste propositions (badge + tri par grade)
//
// Dépendances : proposal-grader.js (ProposalGrader), ui.js, ui-patches.js
// Charger APRÈS proposal-patches.js dans index.html
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    if (typeof ProposalGrader === 'undefined') {
        console.warn('[GraderUI] ProposalGrader not loaded, skipping UI patch');
        return;
    }

    // ─── 1. PATCH renderProductCard — Badge grade dans le footer ──

    const _prevRenderProductCard = renderProductCard;
    renderProductCard = function(product, context) {
        let html = _prevRenderProductCard(product, context);

        const grading = product.grading;
        if (grading && grading.grade && grading.grade !== '?') {
            const badge = ProposalGrader.renderBadge(grading.grade, grading.score);
            html = html.replace(
                /<div class="card-score[^"]*">[^<]*<\/div>/,
                badge
            );
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

    // ─── 2. PATCH renderProductSheet — Section grading unifiée ────

    const _prevRenderProductSheet = renderProductSheet;
    renderProductSheet = function(container, state) {
        _prevRenderProductSheet(container, state);

        const p = state.currentProduct;
        if (!p) return;

        // 2a. Remplacer le score widget dans le header par le grade badge
        const scoreWidget = container.querySelector('.score-widget');
        if (scoreWidget && p.grading) {
            scoreWidget.outerHTML = ProposalGrader.renderBadge(p.grading.grade, p.grading.score, 'large');
        }

        // 2b. Remplacer le score panel dans la sidebar
        const scorePanel = container.querySelector('.score-panel');
        if (scorePanel && p.grading) {
            scorePanel.outerHTML = _buildGradeSidebarPanel(p.grading);
        } else if (!scorePanel && p.grading) {
            // Pas de score panel existant → injecter avant les actions
            const sidebar = container.querySelector('.sheet-sidebar');
            if (sidebar) {
                const panel = document.createElement('div');
                panel.innerHTML = _buildGradeSidebarPanel(p.grading);
                sidebar.insertBefore(panel.firstElementChild, sidebar.firstChild);
            }
        }

        // 2c. Injecter la section grading dans le main content
        const sheetMain = container.querySelector('.sheet-main');
        if (sheetMain) {
            let existingGrading = sheetMain.querySelector('.grading-section');
            if (!existingGrading) {
                const gradingDiv = document.createElement('div');
                gradingDiv.className = 'fiche-section';
                gradingDiv.setAttribute('data-section', 'grading');
                gradingDiv.innerHTML = `
                    <div class="fiche-section-header">
                        <span class="fiche-section-icon">\ud83c\udfaf</span>
                        <span class="fiche-section-title">Grading Unifié</span>
                    </div>
                    <div class="fiche-section-body">
                        ${ProposalGrader.renderSection(p.grading)}
                    </div>`;

                // Insérer en première position visible
                const firstSection = sheetMain.querySelector('.fiche-section');
                if (firstSection) {
                    firstSection.before(gradingDiv);
                } else {
                    sheetMain.prepend(gradingDiv);
                }
            }
        }

        // 2d. Masquer l'ancienne Deep Analysis si grading existe
        if (p.grading && p.grading.grade !== '?') {
            const deepSection = container.querySelector('.deep-analysis-section, [data-section="deep-analysis"]');
            if (deepSection) {
                deepSection.style.display = 'none';
            }
        }
    };

    // ─── 3. Grade sidebar panel ──────────────────────────────────

    function _buildGradeSidebarPanel(grading) {
        if (!grading) return '';

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

    // ─── 4. PATCH renderBankSections — Compteur grades par banque ─

    const _prevRenderBankSections = typeof renderBankSections === 'function' ? renderBankSections : null;
    if (_prevRenderBankSections) {
        renderBankSections = function(state) {
            let html = _prevRenderBankSections(state);

            Object.keys(state.proposals).forEach(bankId => {
                const proposals = state.proposals[bankId] || [];
                const graded = proposals.filter(p => p.grading && p.grading.grade);
                if (graded.length === 0) return;

                const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
                graded.forEach(p => {
                    const g = p.grading.grade;
                    if (counts[g] !== undefined) counts[g]++;
                });

                const summary = Object.entries(counts)
                    .filter(([, count]) => count > 0)
                    .map(([grade, count]) => {
                        const color = ProposalGrader.config.grades[grade]?.color || '#888';
                        return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:4px;background:${color}22;color:${color};font-weight:700;font-size:10px;padding:0 4px">${count}${grade}</span>`;
                    }).join(' ');

                if (summary) {
                    const bankName = (BANKS.find(b => b.id === bankId)?.name || bankId);
                    const marker = `<span class="bank-count">`;
                    const bankStart = html.indexOf(bankName);
                    if (bankStart > -1) {
                        const countIdx = html.indexOf(marker, bankStart);
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

    // ─── 5. Auto kill-check on PDF upload ─────────────────────────

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

    // ─── 6. Batch grade button in dashboard ──────────────────────

    const _myDashboardPatch = function(container, state) {
        setTimeout(() => {
            const proposalHeaders = container.querySelectorAll('.section-header');
            proposalHeaders.forEach(header => {
                const title = header.querySelector('.section-title');
                if (title && title.textContent.includes('Propositions')) {
                    const existingGradeBtn = header.querySelector('.btn-grade-all');
                    if (!existingGradeBtn) {
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
                }
            });
        }, 50);
    };

    // Hook into dashboard render chain
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
        const allProposals = Object.values(state.proposals).flat();
        const ungraded = allProposals.filter(p => !p.grading);

        if (ungraded.length === 0) {
            showToast('Toutes les propositions sont d\u00e9j\u00e0 grad\u00e9es', 'info');
            return;
        }

        if (!confirm(`Grader ${ungraded.length} propositions ? ~${Math.ceil(ungraded.length * 2.5 / 60)} min.`)) return;

        showToast(`Grading de ${ungraded.length} propositions...`, 'info');

        try {
            const results = await ProposalGrader.gradeBatch(ungraded, (i, total, result) => {
                showToast(`${i}/${total} \u2014 Grade ${result.grading.grade}`, 'info');
            });

            for (const { proposal } of results) {
                if (proposal.bankId) {
                    try { await app._saveProductFile(proposal.bankId, proposal); } catch (e) {}
                }
            }

            const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
            results.forEach(r => { const g = r.grading.grade; if (counts[g] !== undefined) counts[g]++; });
            const summary = Object.entries(counts).filter(([, c]) => c > 0).map(([g, c]) => `${c}\u00d7${g}`).join(', ');

            showToast(`Grading termin\u00e9 : ${summary}`, 'success');

            const toReject = results.filter(r => ['D', 'F'].includes(r.grading.grade));
            if (toReject.length > 0 && confirm(`${toReject.length} propositions en D/F. Rejeter automatiquement ?`)) {
                for (const { proposal } of toReject) {
                    const bid = _resolveBankId(proposal.id, proposal.bankId);
                    if (bid) await app.updateProposalStatus(bid, proposal.id, 'rejected', `Grade ${proposal.grading.grade}`);
                }
                showToast(`${toReject.length} propositions rejet\u00e9es`, 'success');
            }

            app.render();
        } catch (e) {
            showToast('Erreur batch: ' + e.message, 'error');
        }
    }

    console.log('[StructBoard] GraderUI Patch v1.0 loaded');
})();

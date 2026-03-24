// ═══ DASHBOARD BUTTONS PATCH ═══
// Adds "Actualiser tout" + "Grader tout" buttons via the same
// renderDashboard hook as "Optimiser" — no race conditions
(function() {
    var _btnInterval = setInterval(function() {
        if (typeof renderDashboard !== 'function') return;
        var _prev = renderDashboard;
        renderDashboard = function(container, state) {
            _prev(container, state);
            setTimeout(function() {
                container.querySelectorAll('.section-header').forEach(function(header) {
                    var title = header.querySelector('.section-title');
                    if (!title) return;
                    var t = title.textContent || '';

                    // PORTFOLIO: "🔄 Actualiser tout (N)" — ALL products
                    if (t.indexOf('Portefeuille') >= 0 && !header.querySelector('.btn-regrade-all')) {
                        if (typeof window.batchReGradeAll === 'function') {
                            var pf = (state.portfolio || []).filter(function(p) { return !p.grading || p.grading.grade !== '-'; });
                            var pr = Object.values(state.proposals || {}).flat().filter(function(p) { return !p.grading || (p.grading.grade !== '-' && p.grading.grade !== '?'); });
                            var total = pf.length + pr.length;
                            if (total > 0) {
                                var btn = document.createElement('button');
                                btn.className = 'btn btn-regrade-all';
                                btn.style.cssText = 'margin-right:8px;white-space:nowrap';
                                btn.innerHTML = '\ud83d\udd04 Actualiser tout (' + total + ')';
                                btn.onclick = function() { window.batchReGradeAll(); };
                                var ref = header.querySelector('.btn-struct-opt') || header.querySelector('.btn.primary') || header.querySelector('.btn');
                                if (ref) header.insertBefore(btn, ref);
                                else header.appendChild(btn);
                            }
                        }
                    }

                    // PROPOSALS: "🎯 Grader tout (N)" — ungraded only
                    if (t.indexOf('Propositions') >= 0 && !header.querySelector('.btn-grade-all')) {
                        var ungraded = Object.values(state.proposals || {}).flat().filter(function(p) { return !p.grading; });
                        if (ungraded.length > 0 && typeof window.batchReGradeAll === 'function') {
                            var gbtn = document.createElement('button');
                            gbtn.className = 'btn btn-grade-all';
                            gbtn.style.cssText = 'margin-right:8px;white-space:nowrap';
                            gbtn.innerHTML = '\ud83c\udfaf Grader tout (' + ungraded.length + ')';
                            gbtn.onclick = function() {
                                if (typeof ProposalGrader === 'undefined') return;
                                var toGrade = Object.values(app.state.proposals).flat().filter(function(p) { return !p.grading; });
                                if (!toGrade.length) { showToast('Tout grad\u00e9', 'info'); return; }
                                if (!confirm('Grader ' + toGrade.length + ' propositions ?')) return;
                                showToast('Grading...', 'info');
                                if (typeof _mktCache !== 'undefined') { _mktCache = null; _mktCacheTs = 0; }
                                ProposalGrader.gradeBatch(toGrade, function(i, t, r) { showToast(i + '/' + t + ' \u2014 ' + r.grading.grade, 'info'); }).then(function(results) {
                                    Promise.all(results.map(function(r) { return r.proposal.bankId ? app._saveProductFile(r.proposal.bankId, r.proposal).catch(function(){}) : Promise.resolve(); })).then(function() {
                                        var c = {}; results.forEach(function(r) { c[r.grading.grade] = (c[r.grading.grade]||0)+1; });
                                        showToast('Termin\u00e9: ' + Object.entries(c).map(function(e) { return e[1]+'\u00d7'+e[0]; }).join(', '), 'success');
                                        app.render();
                                    });
                                }).catch(function(e) { showToast('Erreur: ' + e.message, 'error'); });
                            };
                            var addBtn = header.querySelector('.btn.primary');
                            if (addBtn) header.insertBefore(gbtn, addBtn);
                        }
                    }
                });
            }, 120); // 120ms = after structured-optimizer's 80ms hook
        };
        clearInterval(_btnInterval);
    }, 300); // 300ms = after structured-optimizer's 200ms interval
    setTimeout(function() { clearInterval(_btnInterval); }, 8000);
})();
console.log('[StructBoard] Dashboard buttons patch \u2014 Actualiser tout + Grader tout');

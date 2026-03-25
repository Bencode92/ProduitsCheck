// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Dashboard Buttons + Portfolio Summary Table v5
// Added MARGE BARRIÈRE + PROCHAINE DATE columns
// ═══════════════════════════════════════════════════════════════

// ═══ QUICK VARIATION EDITOR ══════════════════════════════
window._quickEditVariation = function(productId) {
    var p = (app.state.portfolio || []).find(function(x) { return x.id === productId; });
    if (!p) return;
    var current = (p.tracking && p.tracking.level != null) ? (p.tracking.level - 100) : '';
    var currentStr = current !== '' ? (current >= 0 ? '+' + current : '' + current) : '';
    var input = prompt('Variation de ' + (p.name || 'Produit').substring(0, 30) + ' (%) :\nExemple: -6.7 ou +2.2', currentStr);
    if (input === null) return;
    var val = parseFloat(input);
    if (isNaN(val) || val < -99 || val > 200) { showToast('Variation invalide', 'error'); return; }
    var level = 100 + val;
    if (!p.tracking) p.tracking = { history: [] };
    if (!p.tracking.history) p.tracking.history = [];
    p.tracking.level = level;
    p.tracking.date = new Date().toISOString().split('T')[0];
    var subDate = p.subscriptionDate ? new Date(p.subscriptionDate) : new Date(p.addedDate || Date.now());
    var yearNum = Math.max(1, Math.ceil((Date.now() - subDate.getTime()) / (365.25 * 86400000)));
    var idx = p.tracking.history.findIndex(function(h) { return h.year === yearNum; });
    var entry = { date: p.tracking.date, level: level, year: yearNum };
    if (idx >= 0) p.tracking.history[idx] = entry;
    else { p.tracking.history.push(entry); p.tracking.history.sort(function(a, b) { return a.year - b.year; }); }
    github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', app.state.portfolio, '[StructBoard] Tracking: ' + (p.name || '').substring(0, 25) + ' ' + (val >= 0 ? '+' : '') + val + '%').then(function() {
        showToast((p.name || 'Produit').substring(0, 20) + ': ' + (val >= 0 ? '+' : '') + val + '%', 'success');
        app.render();
    }).catch(function(e) { showToast('Erreur: ' + e.message, 'error'); });
};

// ═══ ENVELOPE BADGES ═════════════════════════════════════
function _envelopeBadge(envelope) {
    if (!envelope) return '<span style="color:var(--text-dim);font-size:10px">\u2014</span>';
    var info = typeof getEnvelopeInfo === 'function' ? getEnvelopeInfo(envelope) : null;
    if (!info || !info.id) return '<span style="color:var(--text-dim);font-size:10px">\u2014</span>';
    return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:' + info.color + '22;color:' + info.color + ';border:1px solid ' + info.color + '33">' + info.icon + ' ' + info.label + '</span>';
}
function _envelopeBadgeSmall(envelope) {
    if (!envelope) return '';
    var info = typeof getEnvelopeInfo === 'function' ? getEnvelopeInfo(envelope) : null;
    if (!info || !info.id) return '';
    return '<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;background:' + info.color + '18;color:' + info.color + ';border:1px solid ' + info.color + '25;margin-left:4px">' + info.icon + ' ' + info.label + '</span>';
}

// ═══ PATCH renderProductCard — envelope badge on cards ═══
(function() {
    var _cardPatchInterval = setInterval(function() {
        if (typeof renderProductCard !== 'function') return;
        clearInterval(_cardPatchInterval);
        var _prevCard = renderProductCard;
        renderProductCard = function(product, context) {
            var html = _prevCard(product, context);
            if (product.envelope && typeof getEnvelopeInfo === 'function') {
                var badge = _envelopeBadgeSmall(product.envelope);
                if (badge) { var typeIdx = html.indexOf('product-card-type'); if (typeIdx > -1) { var closeDiv = html.indexOf('</div>', typeIdx); if (closeDiv > -1) { html = html.substring(0, closeDiv + 6) + '<div style="margin-top:2px">' + badge + '</div>' + html.substring(closeDiv + 6); } } }
            }
            return html;
        };
    }, 100);
    setTimeout(function() { clearInterval(_cardPatchInterval); }, 5000);
})();

// ═══ HELPERS: marge barrière + prochaine date ════════════
function _computeMargeBarriere(p, tracking) {
    var barrier = parseFloat(p.capitalProtection?.barrier) || 0;
    var isProtected = p.capitalProtection?.protected === true || p.capitalProtection?.protected === 'true';
    var grade = (p.grading && p.grading.grade) || '?';
    if (grade === '-') return { html: '<span style="color:#94A3B8;font-size:10px">\u2014</span>', value: 999 };
    if (isProtected && barrier === 0) return { html: '<span style="color:var(--green);font-weight:600;font-size:10px">\u2705 Prot\u00e9g\u00e9</span>', value: 999 };
    if (barrier === 0) return { html: '<span style="color:var(--text-dim);font-size:10px">\u2014</span>', value: 999 };
    if (!tracking) return { html: '<span style="color:var(--text-dim);font-size:10px">' + (100 - barrier) + '%</span>', value: 100 - barrier };
    var marge = tracking.level - barrier;
    var mc = marge > 25 ? 'var(--green)' : marge > 15 ? '#4ECDC4' : marge > 10 ? 'var(--orange)' : 'var(--red)';
    return { html: '<span style="color:' + mc + ';font-weight:700;font-size:11px">' + marge.toFixed(0) + '%</span>', value: marge };
}

function _computeNextEvent(p) {
    var grade = (p.grading && p.grading.grade) || '?';
    if (grade === '-') return { html: '<span style="color:#94A3B8;font-size:10px">\u2014</span>', days: 9999 };
    // Try maturityDate
    var matDate = p.maturityDate ? new Date(p.maturityDate) : null;
    if (!matDate && p.maturity) {
        var yMatch = p.maturity.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (yMatch) matDate = new Date(yMatch[3] + '-' + yMatch[2] + '-' + yMatch[1]);
    }
    // Try to find next autocall observation date
    var subDate = p.subscriptionDate ? new Date(p.subscriptionDate) : (p.addedDate ? new Date(p.addedDate) : null);
    var hasAutocall = p.earlyRedemption?.possible === true || p.earlyRedemption?.possible === 'true';
    var nextObs = null;
    if (subDate && hasAutocall) {
        var now = Date.now();
        var freq = p.earlyRedemption?.frequency || p.coupon?.frequency || 'annuel';
        var monthsStep = 12;
        if (typeof freq === 'string') {
            if (freq.indexOf('trimestr') >= 0) monthsStep = 3;
            else if (freq.indexOf('semestr') >= 0) monthsStep = 6;
        }
        for (var m = 12; m <= 240; m += monthsStep) {
            var d = new Date(subDate);
            d.setMonth(d.getMonth() + m);
            if (d.getTime() > now) { nextObs = d; break; }
        }
    }
    // Pick the earliest: next observation or maturity
    var eventDate = null;
    var eventLabel = '';
    if (nextObs && matDate) {
        if (nextObs < matDate) { eventDate = nextObs; eventLabel = 'Obs'; }
        else { eventDate = matDate; eventLabel = 'Mat'; }
    } else if (nextObs) { eventDate = nextObs; eventLabel = 'Obs'; }
    else if (matDate) { eventDate = matDate; eventLabel = 'Mat'; }
    if (!eventDate) return { html: '<span style="color:var(--text-dim);font-size:10px">\u2014</span>', days: 9999 };
    var daysLeft = Math.ceil((eventDate.getTime() - Date.now()) / 86400000);
    var dateStr = eventDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    var dc = daysLeft < 90 ? 'var(--red)' : daysLeft < 180 ? 'var(--orange)' : daysLeft < 365 ? '#4ECDC4' : 'var(--text-muted)';
    return { html: '<span style="font-size:10px"><span style="color:' + dc + ';font-weight:600">' + dateStr + '</span><br><span style="color:var(--text-dim);font-size:9px">' + eventLabel + ' ' + daysLeft + 'j</span></span>', days: daysLeft };
}

// ═══ PORTFOLIO SUMMARY TABLE ═════════════════════════════
function _renderPortfolioSummaryTable(state) {
    var portfolio = state.portfolio || [];
    if (portfolio.length === 0) return '';

    var totalInvested = 0, totalReturn = 0, couponsOK = 0, couponsTotal = 0;
    var rows = [];

    portfolio.forEach(function(p) {
        var norm = typeof _graderNormalize === 'function' ? _graderNormalize(p) : { coupon: 0 };
        var amount = parseFloat(p.investedAmount) || 0;
        var coupon = norm.coupon || 0;
        var annualReturn = Math.round(amount * coupon / 100);
        var tracking = typeof getTrackingStatus === 'function' ? getTrackingStatus(p) : null;
        var grade = (p.grading && p.grading.grade) || '?';
        var bankName = '';
        if (typeof BANKS !== 'undefined') { var b = BANKS.find(function(bk) { return bk.id === p.bankId; }); if (b) bankName = b.name; }
        bankName = bankName || p.bankId || '';

        var statusHtml = '', statusType = 'ok';
        if (grade === '-') { statusHtml = '<span style="color:#94A3B8;font-weight:600">$ CASH</span>'; statusType = 'cash'; }
        else if (tracking) {
            if (tracking.autocallOK) { statusHtml = '<span style="background:rgba(76,175,80,0.15);color:#4CAF50;padding:2px 8px;border-radius:10px;font-weight:600;font-size:10px">\u2705 AUTOCALL</span>'; statusType = 'autocall'; }
            else if (!tracking.couponOK) { statusHtml = '<span style="background:rgba(255,183,77,0.15);color:#FFB74D;padding:2px 8px;border-radius:10px;font-weight:600;font-size:10px">\u26a0 COUPON PERDU</span>'; statusType = 'lost'; }
            else { statusHtml = '<span style="background:rgba(76,175,80,0.1);color:#81C784;padding:2px 8px;border-radius:10px;font-weight:600;font-size:10px">\ud83d\udfe2 OK</span>'; }
            couponsTotal++; if (tracking.couponOK) couponsOK++;
        } else if (grade !== '-') { statusHtml = '<span style="color:var(--text-dim);font-size:10px">\u2014</span>'; if (coupon > 0) { couponsTotal++; couponsOK++; } }

        var effectiveReturn = annualReturn;
        if (tracking && !tracking.couponOK && !(p.coupon && p.coupon.memory)) effectiveReturn = 0;
        totalInvested += amount;
        if (grade !== '-') totalReturn += effectiveReturn;

        var variationHtml;
        if (tracking) {
            var v = tracking.variation;
            var vc = v >= 5 ? 'var(--green)' : v >= 0 ? '#4ECDC4' : v >= -10 ? 'var(--orange)' : 'var(--red)';
            variationHtml = '<span style="color:' + vc + ';font-weight:700;cursor:pointer" onclick="event.stopPropagation();_quickEditVariation(\'' + p.id + '\')" title="Modifier">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '% \u270e</span>';
        } else {
            variationHtml = '<span style="cursor:pointer;color:var(--text-dim);border:1px dashed var(--border);padding:2px 8px;border-radius:4px;font-size:10px" onclick="event.stopPropagation();_quickEditVariation(\'' + p.id + '\')" title="Saisir">\u270e Saisir</span>';
        }

        var marge = _computeMargeBarriere(p, tracking);
        var nextEvt = _computeNextEvent(p);

        rows.push({
            name: (p.name || 'Produit').substring(0, 30),
            bankName: bankName, amount: amount, coupon: coupon,
            annualReturn: effectiveReturn, variation: variationHtml,
            statusHtml: statusHtml, statusType: statusType, grade: grade,
            envelope: p.envelope || '', margeHtml: marge.html, nextEventHtml: nextEvt.html,
            productId: p.id, bankId: p.bankId
        });
    });

    var avgRate = totalInvested > 0 ? (totalReturn / totalInvested * 100) : 0;
    var lostCoupons = couponsTotal - couponsOK;

    // ── Summary cards ──
    var html = '<div style="margin:20px 0;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden" data-section="portfolio-summary">';
    html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--border)">';
    html += '<div style="background:var(--bg-card);padding:14px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">INVESTI</div><div style="font-size:22px;font-weight:800;color:var(--text-bright);font-family:var(--mono);margin-top:4px">' + formatNumber(totalInvested) + '\u20ac</div></div>';
    html += '<div style="background:var(--bg-card);padding:14px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">RENDEMENT/AN</div><div style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono);margin-top:4px">' + formatNumber(totalReturn) + '\u20ac</div><div style="font-size:10px;color:var(--text-dim)">' + avgRate.toFixed(2) + '% moy.</div></div>';
    html += '<div style="background:var(--bg-card);padding:14px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">COUPONS</div><div style="font-size:22px;font-weight:800;color:' + (lostCoupons > 0 ? 'var(--orange)' : 'var(--green)') + ';font-family:var(--mono);margin-top:4px">' + couponsOK + '/' + couponsTotal + '</div>' + (lostCoupons > 0 ? '<div style="font-size:10px;color:var(--orange)">' + lostCoupons + ' perdu' + (lostCoupons > 1 ? 's' : '') + '</div>' : '') + '</div>';
    var banks = {}; rows.forEach(function(r) { if (r.bankName) banks[r.bankName] = (banks[r.bankName] || 0) + 1; });
    var bankCount = Object.keys(banks).length; var topBank = Object.entries(banks).sort(function(a, b) { return b[1] - a[1]; })[0];
    html += '<div style="background:var(--bg-card);padding:14px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">DIVERSIFICATION</div><div style="font-size:22px;font-weight:800;color:var(--text-bright);margin-top:4px">' + bankCount + ' banque' + (bankCount > 1 ? 's' : '') + '</div>' + (topBank ? '<div style="font-size:10px;color:var(--text-dim)">' + topBank[0] + ' ' + Math.round(topBank[1] / rows.length * 100) + '%</div>' : '') + '</div>';
    var hasLost = rows.some(function(r) { return r.statusType === 'lost'; });
    var hasDanger = rows.some(function(r) { return r.statusType === 'danger'; });
    var riskColor = hasDanger ? 'var(--red)' : hasLost ? 'var(--orange)' : 'var(--green)';
    var riskLabel = hasDanger ? '\ud83d\udd34 \u00c9lev\u00e9' : hasLost ? '\ud83d\udfe0 Mod\u00e9r\u00e9' : '\ud83d\udfe2 Faible';
    html += '<div style="background:var(--bg-card);padding:14px;text-align:center"><div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">RISQUE GLOBAL</div><div style="font-size:18px;font-weight:800;color:' + riskColor + ';margin-top:6px">' + riskLabel + '</div></div>';
    html += '</div>';

    // ── Table ──
    var th = 'padding:8px 6px;text-align:center;color:var(--text-muted);font-size:9px;text-transform:uppercase;font-weight:500;letter-spacing:0.3px';
    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="border-bottom:2px solid var(--border)">';
    html += '<th style="padding:8px 10px;text-align:left;color:var(--text-muted);font-size:9px;text-transform:uppercase;font-weight:500">PRODUIT</th>';
    html += '<th style="' + th + '">ENVELOPPE</th>';
    html += '<th style="' + th + ';text-align:right">MONTANT</th>';
    html += '<th style="' + th + '">TAUX</th>';
    html += '<th style="' + th + ';text-align:right">RDT/AN</th>';
    html += '<th style="' + th + '">VARIATION</th>';
    html += '<th style="' + th + '">MARGE</th>';
    html += '<th style="' + th + '">PROCHAINE DATE</th>';
    html += '<th style="' + th + '">STATUT</th>';
    html += '</tr></thead><tbody>';

    rows.forEach(function(r) {
        html += '<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="var p=(app.state.portfolio||[]).find(function(x){return x.id===\'' + r.productId + '\'});if(p)app.openProduct(p);">';
        html += '<td style="padding:8px 10px"><strong style="color:var(--text-bright);font-size:11px">' + r.name + '</strong><div style="font-size:9px;color:var(--text-dim)">' + r.bankName + '</div></td>';
        html += '<td style="padding:8px 6px;text-align:center">' + _envelopeBadge(r.envelope) + '</td>';
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;font-size:11px">' + formatNumber(r.amount) + '\u20ac</td>';
        html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:' + (r.coupon > 0 ? 'var(--green)' : 'var(--text-dim)') + ';font-size:11px">' + (r.coupon > 0 ? r.coupon + '%' : '\u2014') + '</td>';
        html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:600;color:' + (r.annualReturn > 0 ? 'var(--green)' : 'var(--text-dim)') + ';font-size:11px">' + (r.annualReturn > 0 ? formatNumber(r.annualReturn) + '\u20ac' : '0\u20ac') + '</td>';
        html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono)">' + r.variation + '</td>';
        html += '<td style="padding:8px 6px;text-align:center">' + r.margeHtml + '</td>';
        html += '<td style="padding:8px 6px;text-align:center">' + r.nextEventHtml + '</td>';
        html += '<td style="padding:8px 6px;text-align:center">' + r.statusHtml + '</td>';
        html += '</tr>';
    });

    html += '<tr style="border-top:2px solid var(--border);background:var(--bg-elevated)"><td style="padding:8px 10px;font-weight:700;color:var(--text-bright)">TOTAL</td>';
    html += '<td></td>';
    html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700">' + formatNumber(totalInvested) + '\u20ac</td>';
    html += '<td style="padding:8px 6px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--green)">' + avgRate.toFixed(2) + '%</td>';
    html += '<td style="padding:8px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--green)">' + formatNumber(totalReturn) + '\u20ac</td>';
    html += '<td colspan="4"></td></tr>';
    html += '</tbody></table></div></div>';
    return html;
}

// ═══ DASHBOARD BUTTONS + TABLE INJECTION ═════════════════
(function() {
    var _btnInterval = setInterval(function() {
        if (typeof renderDashboard !== 'function') return;
        var _prev = renderDashboard;
        renderDashboard = function(container, state) {
            _prev(container, state);
            setTimeout(function() {
                if (!container.querySelector('[data-section="portfolio-summary"]')) {
                    var tableHtml = _renderPortfolioSummaryTable(state);
                    if (tableHtml) {
                        var sections = container.querySelectorAll('.section');
                        for (var i = 0; i < sections.length; i++) {
                            var title = sections[i].querySelector('.section-title');
                            if (title && (title.textContent || '').indexOf('Portefeuille') >= 0) {
                                var div = document.createElement('div'); div.innerHTML = tableHtml;
                                sections[i].appendChild(div.firstElementChild); break;
                            }
                        }
                    }
                }
                container.querySelectorAll('.section-header').forEach(function(header) {
                    var title = header.querySelector('.section-title'); if (!title) return;
                    var t = title.textContent || '';
                    if (t.indexOf('Portefeuille') >= 0 && !header.querySelector('.btn-regrade-all')) {
                        if (typeof window.batchReGradeAll === 'function') {
                            var pf = (state.portfolio || []).filter(function(p) { return !p.grading || p.grading.grade !== '-'; });
                            var pr = Object.values(state.proposals || {}).flat().filter(function(p) { return !p.grading || (p.grading.grade !== '-' && p.grading.grade !== '?'); });
                            var total = pf.length + pr.length;
                            if (total > 0) {
                                var btn = document.createElement('button'); btn.className = 'btn btn-regrade-all'; btn.style.cssText = 'margin-right:8px;white-space:nowrap';
                                btn.innerHTML = '\ud83d\udd04 Actualiser tout (' + total + ')'; btn.onclick = function() { window.batchReGradeAll(); };
                                var ref = header.querySelector('.btn-struct-opt') || header.querySelector('.btn.primary') || header.querySelector('.btn');
                                if (ref) header.insertBefore(btn, ref); else header.appendChild(btn);
                            }
                        }
                    }
                    if (t.indexOf('Propositions') >= 0 && !header.querySelector('.btn-grade-all')) {
                        var ungraded = Object.values(state.proposals || {}).flat().filter(function(p) { return !p.grading; });
                        if (ungraded.length > 0 && typeof ProposalGrader !== 'undefined') {
                            var gbtn = document.createElement('button'); gbtn.className = 'btn btn-grade-all'; gbtn.style.cssText = 'margin-right:8px;white-space:nowrap';
                            gbtn.innerHTML = '\ud83c\udfaf Grader tout (' + ungraded.length + ')';
                            gbtn.onclick = function() {
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
            }, 120);
        };
        clearInterval(_btnInterval);
    }, 300);
    setTimeout(function() { clearInterval(_btnInterval); }, 8000);
})();

console.log('[StructBoard] Dashboard v5 \u2014 marge barri\u00e8re + prochaine date');

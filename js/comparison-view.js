// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Comparison View v1.0
//
// Side-by-side comparison of all graded products
// Shows: grade, 4 pillar scores, BS metrics, barrier distance,
// structure type, underlyings, and optimizer recommendation
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  function _gc(grade) {
    return { A:'#06D6A0', B:'#4ECDC4', C:'#FFB627', D:'#E85D04', F:'#EF233C' }[grade] || '#888';
  }

  function _bar(score, max) {
    max = max || 100;
    var pct = Math.round(score / max * 100);
    var color = score >= 70 ? '#06D6A0' : score >= 50 ? '#4ECDC4' : score >= 35 ? '#FFB627' : '#EF233C';
    return '<div style="display:flex;align-items:center;gap:4px">' +
      '<div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
      '<div style="width:' + pct + '%;height:100%;background:' + color + '"></div></div>' +
      '<span style="font-family:var(--mono);font-size:10px;color:var(--text-bright);min-width:22px;text-align:right">' + score + '</span></div>';
  }

  function _collectProducts() {
    var all = [];
    // Portfolio
    (app.state.portfolio || []).forEach(function(p) {
      if (p.grading && p.grading.grade && p.grading.grade !== '-' && p.grading.grade !== '?') {
        all.push({ source: 'portfolio', product: p });
      }
    });
    // Proposals
    Object.values(app.state.proposals || {}).forEach(function(arr) {
      arr.forEach(function(p) {
        if (p.grading && p.grading.grade && p.grading.grade !== '-' && p.grading.grade !== '?' && p.status !== 'rejected') {
          all.push({ source: 'proposal', product: p });
        }
      });
    });
    // Sort by score desc
    all.sort(function(a, b) { return (b.product.grading.score || 0) - (a.product.grading.score || 0); });
    return all;
  }

  function _renderComparisonTable() {
    var items = _collectProducts();
    if (items.length === 0) return '<div style="padding:20px;text-align:center;color:var(--text-muted)">Aucun produit grad\u00e9</div>';

    var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap">';

    // Header
    html += '<thead><tr style="background:var(--bg-elevated);border-bottom:1px solid var(--border)">';
    html += '<th style="padding:8px 6px;text-align:left;color:var(--text-muted);font-weight:500;position:sticky;left:0;background:var(--bg-elevated);z-index:2;min-width:140px">Produit</th>';
    html += '<th style="padding:8px 4px;text-align:center;color:var(--text-muted);font-weight:500;width:40px">Grade</th>';
    html += '<th style="padding:8px 4px;text-align:center;color:var(--text-muted);font-weight:500;width:40px">Score</th>';
    html += '<th style="padding:8px 4px;color:var(--text-muted);font-weight:500;min-width:60px">P1 Rdt</th>';
    html += '<th style="padding:8px 4px;color:var(--text-muted);font-weight:500;min-width:60px">P2 SJ</th>';
    html += '<th style="padding:8px 4px;color:var(--text-muted);font-weight:500;min-width:60px">P3 Fit</th>';
    html += '<th style="padding:8px 4px;color:var(--text-muted);font-weight:500;min-width:60px">P4 CAT</th>';
    html += '<th style="padding:8px 4px;text-align:center;color:var(--text-muted);font-weight:500">Coupon</th>';
    html += '<th style="padding:8px 4px;text-align:center;color:var(--text-muted);font-weight:500">BS Net</th>';
    html += '<th style="padding:8px 4px;text-align:center;color:var(--text-muted);font-weight:500">Prob</th>';
    html += '<th style="padding:8px 4px;text-align:center;color:var(--text-muted);font-weight:500">Barri\u00e8re</th>';
    html += '<th style="padding:8px 4px;text-align:center;color:var(--text-muted);font-weight:500">Mat</th>';
    html += '<th style="padding:8px 4px;text-align:left;color:var(--text-muted);font-weight:500;min-width:80px">Type</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function(item, idx) {
      var p = item.product;
      var g = p.grading || {};
      var pl = g.pillars || {};
      var meta = g.metadata || {};
      var gc = _gc(g.grade);
      var norm = typeof _graderNormalize === 'function' ? _graderNormalize(p) : {};

      var p1 = pl.adjustedReturn ? pl.adjustedReturn.score : '-';
      var p2 = pl.underlyingQuality ? pl.underlyingQuality.score : '-';
      var p3 = pl.portfolioFit ? pl.portfolioFit.score : '-';
      var p4 = pl.riskPremium ? pl.riskPremium.score : '-';

      var coupon = norm.coupon || (typeof p.coupon === 'object' ? (p.coupon.rate || 0) : (parseFloat(p.coupon) || 0));
      var bsNet = p._bsRendementNet !== undefined ? p._bsRendementNet : (meta.bsRendementNet !== undefined ? meta.bsRendementNet : null);
      var prob = p._couponProbability || meta.couponProbability || meta.bsProbCoupon || null;
      var barrier = (p.capitalProtection && p.capitalProtection.barrier) ? p.capitalProtection.barrier : null;
      var mat = p.maturityYears || meta.maxMaturity || '-';
      var st = (p.structureType || '').replace(/_/g, ' ');
      var bd = p._barrierDistance || null;

      var rowBg = idx % 2 === 0 ? 'transparent' : 'var(--bg-elevated)';

      html += '<tr style="border-bottom:1px solid var(--border);background:' + rowBg + '">';

      // Product name (sticky)
      html += '<td style="padding:6px;position:sticky;left:0;background:' + (idx % 2 === 0 ? 'var(--bg)' : 'var(--bg-elevated)') + ';z-index:1">';
      html += '<div style="font-weight:600;color:var(--text-bright);max-width:140px;overflow:hidden;text-overflow:ellipsis">' + (p.name || 'Produit').substring(0, 28) + '</div>';
      html += '<div style="font-size:9px;color:var(--text-dim)">' + (item.source === 'portfolio' ? '\ud83d\udd12' : '\ud83d\udce8') + ' ' + (p.bankId || '') + '</div></td>';

      // Grade badge
      html += '<td style="padding:6px 4px;text-align:center"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;background:' + gc + '22;color:' + gc + ';font-weight:700;font-size:12px">' + (g.grade || '?') + '</span></td>';

      // Score
      html += '<td style="padding:6px 4px;text-align:center;font-family:var(--mono);font-weight:700;color:var(--text-bright)">' + (g.score || '-') + '</td>';

      // 4 pillar bars
      html += '<td style="padding:6px 4px">' + (p1 !== '-' ? _bar(p1) : '-') + '</td>';
      html += '<td style="padding:6px 4px">' + (p2 !== '-' ? _bar(p2) : '-') + '</td>';
      html += '<td style="padding:6px 4px">' + (p3 !== '-' ? _bar(p3) : '-') + '</td>';
      html += '<td style="padding:6px 4px">' + (p4 !== '-' ? _bar(p4) : '-') + '</td>';

      // Coupon
      html += '<td style="padding:6px 4px;text-align:center;font-family:var(--mono);color:var(--green);font-weight:600">' + (coupon > 0 ? coupon + '%' : '-') + '</td>';

      // BS Net
      var bsColor = bsNet === null ? 'var(--text-dim)' : bsNet >= 5 ? 'var(--green)' : bsNet >= 2 ? 'var(--cyan)' : bsNet >= 0 ? 'var(--orange)' : 'var(--red)';
      html += '<td style="padding:6px 4px;text-align:center;font-family:var(--mono);color:' + bsColor + ';font-weight:600">' +
        (bsNet !== null ? (bsNet >= 0 ? '+' : '') + bsNet.toFixed(1) + '%' : '-') + '</td>';

      // Prob coupon
      html += '<td style="padding:6px 4px;text-align:center;font-family:var(--mono);color:var(--text-muted)">' +
        (prob ? Math.round(prob) + '%' : '-') + '</td>';

      // Barrier + distance
      if (bd) {
        var bc = bd.alert === 'breach' ? 'var(--red)' : bd.alert === 'danger' ? 'var(--orange)' : bd.distance < 20 ? 'var(--orange)' : 'var(--green)';
        html += '<td style="padding:6px 4px;text-align:center"><span style="font-family:var(--mono);font-weight:600;color:' + bc + '">' +
          barrier + '% ' + (bd.distance >= 0 ? '+' : '') + bd.distance + '%</span></td>';
      } else if (barrier) {
        html += '<td style="padding:6px 4px;text-align:center;font-family:var(--mono);color:var(--text-dim)">' + barrier + '%</td>';
      } else {
        html += '<td style="padding:6px 4px;text-align:center;color:var(--text-dim)">\u2014</td>';
      }

      // Maturity
      html += '<td style="padding:6px 4px;text-align:center;font-family:var(--mono);color:var(--text-muted)">' + mat + 'a</td>';

      // Structure type
      html += '<td style="padding:6px 4px;color:var(--text-dim);font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis">' + st + '</td>';

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  // Show comparison modal
  window.showProductComparison = function() {
    var modal = document.getElementById('modal');
    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content modal-large" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto;max-width:95vw">' +
      '<h2 class="modal-title">\ud83d\udcca Comparaison Produits</h2>' +
      '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">' +
      'Tous les produits grad\u00e9s tri\u00e9s par score. Barres = score pilier /100. BS Net = rendement esp\u00e9r\u00e9 apr\u00e8s risque.</div>' +
      '<div id="comparison-table">' + _renderComparisonTable() + '</div>' +
      '<div class="modal-actions"><button class="btn" onclick="closeModal()">Fermer</button></div>' +
      '</div></div>';
    modal.classList.add('visible');
  };

  // Add button to dashboard
  var _compIv = setInterval(function() {
    if (typeof renderDashboard !== 'function') return;
    var _prevRender = renderDashboard;
    renderDashboard = function(container, state) {
      _prevRender(container, state);
      setTimeout(function() {
        container.querySelectorAll('.section-header').forEach(function(header) {
          var title = header.querySelector('.section-title');
          if (title && title.textContent.indexOf('Portefeuille') >= 0 && !header.querySelector('.btn-comparison')) {
            var btn = document.createElement('button');
            btn.className = 'btn sm btn-comparison';
            btn.style.cssText = 'margin-right:4px;white-space:nowrap';
            btn.innerHTML = '\ud83d\udcca Comparer';
            btn.onclick = showProductComparison;
            var ref = header.querySelector('.btn-struct-opt') || header.querySelector('.btn');
            if (ref) header.insertBefore(btn, ref);
            else header.appendChild(btn);
          }
        });
      }, 100);
    };
    clearInterval(_compIv);
  }, 200);
  setTimeout(function() { clearInterval(_compIv); }, 10000);

  console.log('[comparison-view] v1.0 active');
})();

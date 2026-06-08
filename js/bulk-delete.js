// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTBOARD — Suppression en lot
// Modale avec cases à cocher pour supprimer plusieurs produits d'un coup
// (portefeuille + propositions), au lieu de les retirer un par un.
// Récupérable via l'historique git.
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function _section(title, items) {
    if (!items.length) return '';
    var h = '<div class="bd-section" style="margin:14px 0">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
      + '<strong style="font-size:12px;color:var(--text-bright)">' + _esc(title) + ' (' + items.length + ')</strong>'
      + '<label style="font-size:11px;color:var(--text-muted);cursor:pointer;user-select:none"><input type="checkbox" onclick="_bdToggleGroup(this)"> tout</label></div>';
    items.forEach(function (it) {
      h += '<label class="bd-row" style="display:flex;gap:8px;align-items:center;padding:7px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;cursor:pointer;font-size:12px">'
        + '<input type="checkbox" class="bd-cb" data-id="' + _esc(it.id) + '" data-bank="' + _esc(it.bankId || '') + '" data-scope="' + it.scope + '" onchange="_bdCount()">'
        + '<span style="flex:1;font-weight:600;color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(it.label) + '</span>'
        + '<span style="color:var(--text-muted);font-size:11px;white-space:nowrap">' + _esc(it.meta) + '</span></label>';
    });
    return h + '</div>';
  }

  window.openBulkDelete = function () {
    var modal = document.getElementById('modal'); if (!modal) return;
    var body = '';
    var pf = (app.state.portfolio || []).map(function (p) {
      return { id: p.id, bankId: p.bankId, scope: 'portfolio', label: p.name || p.type || p.id, meta: (p.bankName || p.bankId || '') + (p.investedAmount ? ' · ' + formatNumber(p.investedAmount) + '€' : '') };
    });
    body += _section('Portefeuille', pf);
    var props = app.state.proposals || {};
    Object.keys(props).forEach(function (bank) {
      var bn = (typeof BANKS !== 'undefined' && (BANKS.find(function (b) { return b.id === bank; }) || {}).name) || bank;
      var items = props[bank].map(function (p) {
        return { id: p.id, bankId: bank, scope: 'proposal', label: p.name || p.type || p.id, meta: (p.status || '') + (p.grading && p.grading.grade ? ' · ' + p.grading.grade : '') };
      });
      body += _section('Propositions — ' + bn, items);
    });
    if (!body) body = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Aucun produit.</div>';

    modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:640px">'
      + '<h2 class="modal-title">🗑️ Supprimer en lot</h2>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Coche les produits à supprimer, puis valide. Récupérable via l\'historique git.</div>'
      + '<div style="max-height:58vh;overflow:auto;padding-right:4px">' + body + '</div>'
      + '<div class="modal-actions"><button class="btn" onclick="closeModal()">Annuler</button>'
      + '<button class="btn" id="bd-del" onclick="bulkDeleteConfirm()" style="background:var(--red);border-color:var(--red);color:#fff">Supprimer la sélection (0)</button></div>'
      + '</div></div>';
    modal.classList.add('visible');
    _bdCount();
  };

  window._bdToggleGroup = function (cb) {
    var sec = cb.closest('.bd-section'); if (!sec) return;
    sec.querySelectorAll('.bd-cb').forEach(function (x) { x.checked = cb.checked; });
    _bdCount();
  };

  window._bdCount = function () {
    var n = document.querySelectorAll('.bd-cb:checked').length;
    var btn = document.getElementById('bd-del');
    if (btn) { btn.textContent = 'Supprimer la sélection (' + n + ')'; btn.disabled = n === 0; btn.style.opacity = n === 0 ? '0.5' : '1'; }
  };

  window.bulkDeleteConfirm = async function () {
    var checked = Array.prototype.map.call(document.querySelectorAll('.bd-cb:checked'), function (x) {
      return { id: x.dataset.id, bankId: x.dataset.bank, scope: x.dataset.scope };
    });
    if (!checked.length) return;
    if (!confirm('Supprimer ' + checked.length + ' élément(s) ? (récupérable via git)')) return;
    closeModal();
    showToast('Suppression de ' + checked.length + ' élément(s)…', 'info');
    try {
      await app.bulkDelete(checked);
      showToast(checked.length + ' élément(s) supprimé(s)', 'success');
    } catch (e) {
      showToast('Erreur suppression : ' + e.message, 'error');
    }
    if (typeof app.goToDashboard === 'function') app.goToDashboard();
  };
})();

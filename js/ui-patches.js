// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — UI Patches v2.1 — Compact sections + missing helper
// ═══════════════════════════════════════════════════════════════

// ─── _injectBeforeLastDiv: used by proposal-patches.js ───
// Injects HTML before the last closing </div> of a string
function _injectBeforeLastDiv(html, inject) {
    var lastDiv = html.lastIndexOf('</div>');
    if (lastDiv === -1) return html + inject;
    return html.substring(0, lastDiv) + inject + html.substring(lastDiv);
}

// ─── Compact 3-column product detail sections ───
(function() {
    'use strict';

    var _patchAttempts = 0;
    var _patchInterval = setInterval(function() {
        _patchAttempts++;
        if (_patchAttempts > 50) { clearInterval(_patchInterval); return; }
        if (typeof renderProductSheet !== 'function') return;
        clearInterval(_patchInterval);

        var _origRenderSheet = renderProductSheet;
        renderProductSheet = function(container, state) {
            _origRenderSheet(container, state);
            setTimeout(function() { _mergeProductSections(container); }, 10);
        };
        console.log('[UI-Patches] v2.1 — compact 3-col + _injectBeforeLastDiv');
    }, 50);

    function _mergeProductSections(container) {
        var sheetMain = container.querySelector('.sheet-main');
        if (!sheetMain) return;

        var sections = sheetMain.querySelectorAll('.fiche-section');
        var couponSection = null, capitalSection = null, autocallSection = null;

        sections.forEach(function(sec) {
            var title = sec.querySelector('.fiche-section-title');
            if (!title) return;
            var t = title.textContent.trim().toLowerCase();
            if (t.indexOf('coupon') >= 0) couponSection = sec;
            else if (t.indexOf('protection') >= 0 || t.indexOf('capital') >= 0) capitalSection = sec;
            else if (t.indexOf('remboursement') >= 0 || t.indexOf('anticip') >= 0) autocallSection = sec;
        });

        if (!couponSection || !capitalSection || !autocallSection) return;

        var couponBody = couponSection.querySelector('.fiche-section-body');
        var capitalBody = capitalSection.querySelector('.fiche-section-body');
        var autocallBody = autocallSection.querySelector('.fiche-section-body');
        if (!couponBody || !capitalBody || !autocallBody) return;

        var merged = document.createElement('div');
        merged.className = 'fiche-section';
        merged.setAttribute('data-section', 'product-details-compact');
        merged.innerHTML = '<div class="fiche-section-header">' +
            '<span class="fiche-section-icon">\ud83d\udcdd</span>' +
            '<span class="fiche-section-title">D\u00e9tails du Produit</span>' +
            '</div>' +
            '<div class="fiche-section-body">' +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
            '<div>' + couponBody.innerHTML + '</div>' +
            '<div>' + capitalBody.innerHTML + '</div>' +
            '<div>' + autocallBody.innerHTML + '</div>' +
            '</div></div>';

        couponSection.parentNode.insertBefore(merged, couponSection);
        couponSection.remove();
        capitalSection.remove();
        autocallSection.remove();
    }
})();

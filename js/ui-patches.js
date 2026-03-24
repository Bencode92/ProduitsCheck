// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — UI Patches v2.0 — Compact product detail sections
// ═══════════════════════════════════════════════════════════════
// Merges Coupon + Capital + Autocall into a single 3-column row

(function() {
    'use strict';

    // Wait for renderProductSheet to exist, then patch it
    var _patchAttempts = 0;
    var _patchInterval = setInterval(function() {
        _patchAttempts++;
        if (_patchAttempts > 50) { clearInterval(_patchInterval); return; }
        if (typeof renderProductSheet !== 'function') return;
        clearInterval(_patchInterval);

        var _origRenderSheet = renderProductSheet;
        renderProductSheet = function(container, state) {
            _origRenderSheet(container, state);
            // After original render, merge the 3 sections
            setTimeout(function() { _mergeProductSections(container); }, 10);
        };
        console.log('[UI-Patches] v2.0 — compact 3-col sections');
    }, 50);

    function _mergeProductSections(container) {
        var sheetMain = container.querySelector('.sheet-main');
        if (!sheetMain) return;

        // Find the 3 target sections by their icon
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

        // Only merge if we found all 3
        if (!couponSection || !capitalSection || !autocallSection) return;

        // Extract the info-box content from each section
        var couponBody = couponSection.querySelector('.fiche-section-body');
        var capitalBody = capitalSection.querySelector('.fiche-section-body');
        var autocallBody = autocallSection.querySelector('.fiche-section-body');
        if (!couponBody || !capitalBody || !autocallBody) return;

        // Create the merged 3-column section
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

        // Insert merged section where couponSection was
        couponSection.parentNode.insertBefore(merged, couponSection);

        // Remove the 3 original sections
        couponSection.remove();
        capitalSection.remove();
        autocallSection.remove();
    }
})();

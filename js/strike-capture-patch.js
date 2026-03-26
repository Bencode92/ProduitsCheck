// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Strike Price Auto-Capture v1.2
// - Auto-captures spot price at integration time
// - Button on product page next to Actualiser/Liquidité
// - PDF extraction fallback
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ AUTO-CAPTURE STRIKE AT INTEGRATION ═══
    window._captureStrikePrice = async function(product) {
        if (!product) return null;
        if (product.strikePrice && product.strikePrice > 0) {
            return product.strikePrice;
        }
        var underlyings = product.underlyings || [];
        if (underlyings.length === 0) return null;
        var marketData = null;
        try { marketData = await github.readFile('data/market/index.json'); } catch(e) { return null; }
        var prices = [];
        for (var i = 0; i < underlyings.length; i++) {
            var uj = underlyings[i];
            var ujNorm = uj.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
            var price = null, source = null;
            if (marketData.stocks) {
                for (var ticker in marketData.stocks) {
                    var stock = marketData.stocks[ticker];
                    var nameNorm = (stock.name || '').toLowerCase();
                    var nameApiNorm = (stock.name_api || '').toLowerCase();
                    if (nameNorm.indexOf(ujNorm) >= 0 || ujNorm.indexOf(nameNorm) >= 0 ||
                        nameApiNorm.indexOf(ujNorm) >= 0 || ujNorm.indexOf(nameApiNorm) >= 0 ||
                        ticker.toLowerCase() === ujNorm) {
                        if (stock.price && stock.price > 0) { price = stock.price; source = 'stock:' + ticker; break; }
                    }
                }
            }
            if (!price && marketData.underlyings_extra) {
                try {
                    var umap = await github.readFile('data/underlying-map.json');
                    if (umap && umap.indices) {
                        for (var key in umap.indices) {
                            if (ujNorm.indexOf(key) >= 0 || key.indexOf(ujNorm) >= 0) {
                                var proxyTicker = umap.indices[key].proxy;
                                var extra = marketData.underlyings_extra[proxyTicker];
                                if (extra && extra.last_close > 0) { price = extra.last_close; source = 'proxy:' + proxyTicker; }
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }
            if (price) prices.push({ underlying: uj, price: price, source: source });
        }
        if (prices.length === 0) return null;
        product.strikePrice = Math.round(prices[0].price * 100) / 100;
        product._strikePriceSource = prices[0].source;
        product._strikePriceDate = new Date().toISOString().split('T')[0];
        product._strikePriceAll = prices;
        return product.strikePrice;
    };

    // ═══ HOOK INTO INTEGRATION FLOW ═══
    var _strikeInterval = setInterval(function() {
        if (typeof app === 'undefined' || !app.integrateProposal) return;
        clearInterval(_strikeInterval);
        var _origIntegrate = app.integrateProposal;
        app.integrateProposal = async function(product) {
            if (product && (!product.strikePrice || product.strikePrice <= 0)) {
                showToast('Capture du prix initial...', 'info');
                var strike = await _captureStrikePrice(product);
                if (strike) showToast('Prix initial captur\u00e9: ' + strike, 'success');
            }
            return _origIntegrate.call(app, product);
        };
    }, 300);
    setTimeout(function() { clearInterval(_strikeInterval); }, 10000);

    // ═══ PDF EXTRACTION ═══
    window._extractStrikeFromPDF = function(product) {
        if (!product || !product.rawText) return null;
        var text = product.rawText;
        var patterns = [
            /niveau\s*initial\s*[:=]?\s*([\d\s,.]+)/i,
            /fixing\s*initial\s*[:=]?\s*([\d\s,.]+)/i,
            /cours\s*initial\s*[:=]?\s*([\d\s,.]+)/i,
            /strike\s*[:=]?\s*([\d\s,.]+)/i,
            /valeur\s*initiale\s*[:=]?\s*([\d\s,.]+)/i,
        ];
        for (var i = 0; i < patterns.length; i++) {
            var match = text.match(patterns[i]);
            if (match && match[1]) {
                var num = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
                if (num > 0 && num < 100000) return num;
            }
        }
        return null;
    };

    // ═══ UI: STRIKE BUTTON — ROBUST INSERTION ═══
    // Strategy: find ANY button on the page that contains "Actualiser" or "Liquidit"
    // and insert our button next to it. This works regardless of DOM structure.
    window._showStrikeButton = function() {
        if (document.querySelector('.btn-strike')) return; // Already added
        var p = app && app.state && app.state.currentProduct;
        if (!p) return;

        // Find anchor: the "Actualiser" or "Liquidité" button
        var anchor = null;
        var allButtons = document.querySelectorAll('button');
        for (var i = 0; i < allButtons.length; i++) {
            var txt = allButtons[i].textContent || '';
            if (txt.indexOf('Liquidit') >= 0 || txt.indexOf('Actualiser') >= 0) {
                anchor = allButtons[i];
                // Prefer the last matching button (Liquidité comes after Actualiser)
            }
        }

        if (!anchor) return; // Not on product page

        var btn = document.createElement('button');
        btn.className = 'btn sm btn-strike';
        btn.style.cssText = 'margin-left:6px;white-space:nowrap;';

        if (p.strikePrice && p.strikePrice > 0) {
            btn.innerHTML = '\ud83d\udccd Strike: ' + p.strikePrice;
            btn.style.cssText += 'color:var(--green);border-color:var(--green);';
            btn.title = 'Strike enregistr\u00e9 (' + (p._strikePriceSource || 'manuel') + '). Cliquer pour modifier.';
            btn.onclick = function() { _promptStrikeEdit(p); };
        } else {
            btn.innerHTML = '\ud83d\udccd Capturer Strike';
            btn.style.cssText += 'color:var(--orange);border-color:var(--orange);';
            btn.title = 'Chercher le prix du sous-jacent \u00e0 la date de souscription';
            btn.onclick = function() { _triggerStrikeCapture(p); };
        }

        // Insert right after the anchor button
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
        console.log('[Strike] Button injected next to: ' + (anchor.textContent || '').trim());
    };

    // Trigger auto-capture from button click
    window._triggerStrikeCapture = async function(product) {
        if (!product) return;
        showToast('Recherche du prix initial...', 'info');
        var strike = await _captureStrikePrice(product);
        if (strike) {
            showToast('\u2705 Strike captur\u00e9: ' + strike, 'success');
            await _saveStrikePrice(product);
            document.querySelectorAll('.btn-strike').forEach(function(b) { b.remove(); });
            _showStrikeButton();
        } else {
            var pdfStrike = _extractStrikeFromPDF(product);
            if (pdfStrike) {
                product.strikePrice = pdfStrike;
                product._strikePriceSource = 'pdf_extraction';
                product._strikePriceDate = new Date().toISOString().split('T')[0];
                showToast('\u2705 Strike extrait du PDF: ' + pdfStrike, 'success');
                await _saveStrikePrice(product);
                document.querySelectorAll('.btn-strike').forEach(function(b) { b.remove(); });
                _showStrikeButton();
            } else {
                _promptStrikeEdit(product);
            }
        }
    };

    // Manual strike entry modal
    window._promptStrikeEdit = function(product) {
        var current = product.strikePrice || '';
        var underlyings = (product.underlyings || []).join(', ');
        var subDate = product.subscriptionDate || product.addedDate || '?';
        var modal = document.getElementById('modal');
        modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:450px">' +
            '<h2 class="modal-title">\ud83d\udccd Niveau Initial (Strike)</h2>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">' +
            '<div style="margin-bottom:8px"><strong>Produit:</strong> ' + (product.name || '?').substring(0, 50) + '</div>' +
            '<div style="margin-bottom:8px"><strong>Sous-jacent:</strong> ' + underlyings + '</div>' +
            '<div style="margin-bottom:8px"><strong>Date souscription:</strong> ' + subDate + '</div>' +
            (product._strikePriceSource ? '<div style="margin-bottom:8px"><strong>Source:</strong> ' + product._strikePriceSource + ' (' + (product._strikePriceDate || '') + ')</div>' : '') +
            '</div>' +
            '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">' +
            '\ud83d\udca1 Le strike = prix du sous-jacent le jour de la souscription. Cherchez dans la brochure: "Niveau Initial", "Fixing Initial", ou "Cours Initial".' +
            '</div>' +
            '<div class="form-field"><label>Strike Price (pts ou \u20ac)</label>' +
            '<input id="strike-input" type="number" step="0.01" value="' + current + '" placeholder="Ex: 4950 pour Eurostoxx, 14.25 pour ENI" style="width:100%;padding:10px;font-size:16px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-bright)">' +
            '</div>' +
            '<div class="modal-actions" style="margin-top:16px">' +
            '<button class="btn" onclick="closeModal()">Annuler</button>' +
            '<button class="btn primary" onclick="_saveStrikeFromModal()">\ud83d\udcbe Enregistrer</button>' +
            '</div></div></div>';
        modal.classList.add('visible');
        setTimeout(function() { var inp = document.getElementById('strike-input'); if (inp) inp.focus(); }, 100);
    };

    window._saveStrikeFromModal = async function() {
        var p = app.state.currentProduct;
        if (!p) return;
        var val = parseFloat(document.getElementById('strike-input')?.value);
        if (!val || val <= 0) { showToast('Valeur invalide', 'error'); return; }
        p.strikePrice = Math.round(val * 100) / 100;
        p._strikePriceSource = 'manual';
        p._strikePriceDate = new Date().toISOString().split('T')[0];
        closeModal();
        await _saveStrikePrice(p);
        showToast('\u2705 Strike enregistr\u00e9: ' + p.strikePrice, 'success');
        document.querySelectorAll('.btn-strike').forEach(function(b) { b.remove(); });
        _showStrikeButton();
    };

    window._saveStrikePrice = async function(product) {
        if (!product) return;
        try {
            var bankId = product.bankId;
            if (bankId && typeof app._saveProductFile === 'function') {
                await app._saveProductFile(bankId, product);
            }
            var portfolio = app.state.portfolio || [];
            var pfProduct = portfolio.find(function(x) { return x.id === product.id; });
            if (pfProduct) {
                pfProduct.strikePrice = product.strikePrice;
                pfProduct._strikePriceSource = product._strikePriceSource;
                pfProduct._strikePriceDate = product._strikePriceDate;
                pfProduct._strikePriceAll = product._strikePriceAll;
                await github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', portfolio,
                    '[StructBoard] Strike: ' + product.strikePrice + ' for ' + (product.name || product.id).substring(0, 30));
            }
        } catch(e) { console.warn('[Strike] Save error:', e); }
    };

    // ═══ AUTO-INJECT: poll for the anchor button ═══
    setInterval(function() {
        if (typeof app === 'undefined' || !app.state || !app.state.currentProduct) return;
        if (document.querySelector('.btn-strike')) return;
        _showStrikeButton();
    }, 800);

    console.log('[StructBoard] Strike Capture v1.2 \u2014 robust button injection');
})();

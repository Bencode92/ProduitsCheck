// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Strike Price Auto-Capture v1.5
// v1.5: Green button also re-runs capture to show found/not-found
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function _cleanUnderlyingName(raw) {
        var s = (raw || '').toLowerCase();
        s = s.replace(/^action\s+/i, '');
        s = s.replace(/\s*\([a-z]{2}\d{8,12}\)/gi, '');
        s = s.replace(/\s*\([^)]*\)/g, '');
        s = s.replace(/\b(s\.?p\.?a\.?|s\.?a\.?|s\.?e\.?|n\.?v\.?|a\.?g\.?|plc|inc|ltd|corp|group)\b/gi, '');
        s = s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        return s;
    }

    window._captureStrikePrice = async function(product) {
        if (!product) return null;
        if (product.strikePrice && product.strikePrice > 0) return product.strikePrice;
        var underlyings = product.underlyings || [];
        if (underlyings.length === 0) return null;
        var marketData = null;
        try { marketData = await github.readFile('data/market/index.json'); } catch(e) { return null; }
        var prices = [], notFound = [];
        for (var i = 0; i < underlyings.length; i++) {
            var uj = underlyings[i];
            var ujClean = _cleanUnderlyingName(uj);
            var ujWords = ujClean.split(' ').filter(function(w) { return w.length >= 2; });
            var price = null, source = null;
            if (marketData.stocks) {
                var bestMatch = null;
                for (var ticker in marketData.stocks) {
                    var stock = marketData.stocks[ticker];
                    var nameClean = _cleanUnderlyingName(stock.name || '');
                    var nameApiClean = _cleanUnderlyingName(stock.name_api || '');
                    var tickerLow = ticker.toLowerCase();
                    for (var w = 0; w < ujWords.length; w++) {
                        if (ujWords[w] === tickerLow && ujWords[w].length >= 2)
                            if (stock.price > 0 && (!bestMatch || bestMatch.score < 100))
                                bestMatch = { price: stock.price, source: 'stock:' + ticker, score: 100 };
                    }
                    if (nameClean && ujClean && (nameClean.indexOf(ujClean) >= 0 || ujClean.indexOf(nameClean) >= 0))
                        if (stock.price > 0 && (!bestMatch || bestMatch.score < 90))
                            bestMatch = { price: stock.price, source: 'stock:' + ticker, score: 90 };
                    if (nameApiClean && ujClean && (nameApiClean.indexOf(ujClean) >= 0 || ujClean.indexOf(nameApiClean) >= 0))
                        if (stock.price > 0 && (!bestMatch || bestMatch.score < 85))
                            bestMatch = { price: stock.price, source: 'stock:' + ticker, score: 85 };
                    if (ujWords.length >= 2) {
                        var mc = 0, ft = (nameClean + ' ' + nameApiClean + ' ' + tickerLow);
                        for (var ww = 0; ww < ujWords.length; ww++) if (ft.indexOf(ujWords[ww]) >= 0) mc++;
                        if (mc >= 2 && mc / ujWords.length >= 0.5) {
                            var ws = Math.round(mc / ujWords.length * 80);
                            if (stock.price > 0 && (!bestMatch || bestMatch.score < ws))
                                bestMatch = { price: stock.price, source: 'stock:' + ticker, score: ws };
                        }
                    }
                }
                if (bestMatch) { price = bestMatch.price; source = bestMatch.source; }
            }
            if (!price && marketData.underlyings_extra) {
                try {
                    var umap = await github.readFile('data/underlying-map.json');
                    if (umap && umap.indices) {
                        for (var key in umap.indices) {
                            if (ujClean.indexOf(key) >= 0 || key.indexOf(ujClean) >= 0) {
                                var pt = umap.indices[key].proxy;
                                var ex = marketData.underlyings_extra[pt];
                                if (ex && ex.last_close > 0) { price = ex.last_close; source = 'proxy:' + pt; }
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }
            if (price) prices.push({ underlying: uj, price: price, source: source });
            else notFound.push(uj);
        }
        if (prices.length === 0) return null;
        product.strikePrice = Math.round(prices[0].price * 100) / 100;
        product._strikePriceSource = prices[0].source;
        product._strikePriceDate = new Date().toISOString().split('T')[0];
        product._strikePriceAll = prices;
        product._strikePriceNotFound = notFound;
        return product.strikePrice;
    };

    // ═══ HOOK INTO INTEGRATION ═══
    var _strikeInterval = setInterval(function() {
        if (typeof app === 'undefined' || !app.integrateProposal) return;
        clearInterval(_strikeInterval);
        var _origIntegrate = app.integrateProposal;
        app.integrateProposal = async function(product) {
            if (product && (!product.strikePrice || product.strikePrice <= 0)) {
                showToast('Capture du prix initial...', 'info');
                var strike = await _captureStrikePrice(product);
                if (strike) showToast('Strike captur\u00e9: ' + strike, 'success');
            }
            return _origIntegrate.call(app, product);
        };
    }, 300);
    setTimeout(function() { clearInterval(_strikeInterval); }, 10000);

    // ═══ PDF EXTRACTION ═══
    window._extractStrikeFromPDF = function(product) {
        if (!product || !product.rawText) return null;
        var patterns = [/niveau\s*initial\s*[:=]?\s*([\d\s,.]+)/i, /fixing\s*initial\s*[:=]?\s*([\d\s,.]+)/i,
            /cours\s*initial\s*[:=]?\s*([\d\s,.]+)/i, /strike\s*[:=]?\s*([\d\s,.]+)/i];
        for (var i = 0; i < patterns.length; i++) {
            var match = product.rawText.match(patterns[i]);
            if (match && match[1]) {
                var num = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
                if (num > 0 && num < 100000) return num;
            }
        }
        return null;
    };

    // ═══ UI: STRIKE BUTTON ═══
    window._showStrikeButton = function() {
        if (document.querySelector('.btn-strike')) return;
        var p = app && app.state && app.state.currentProduct;
        if (!p) return;
        var anchor = null;
        var allButtons = document.querySelectorAll('button');
        for (var i = 0; i < allButtons.length; i++) {
            var txt = allButtons[i].textContent || '';
            if (txt.indexOf('Liquidit') >= 0 || txt.indexOf('Actualiser') >= 0) anchor = allButtons[i];
        }
        if (!anchor) return;
        var btn = document.createElement('button');
        btn.className = 'btn sm btn-strike';
        btn.style.cssText = 'margin-left:6px;white-space:nowrap;';
        if (p.strikePrice && p.strikePrice > 0) {
            btn.innerHTML = '\ud83d\udccd Strike: ' + p.strikePrice;
            btn.style.cssText += 'color:var(--green);border-color:var(--green);';
            // v1.5: ALWAYS re-run capture on click so user sees found/not-found details
            btn.onclick = function() { _triggerStrikeCapture(p); };
        } else {
            btn.innerHTML = '\ud83d\udccd Capturer Strike';
            btn.style.cssText += 'color:var(--orange);border-color:var(--orange);';
            btn.onclick = function() { _triggerStrikeCapture(p); };
        }
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    };

    // ═══ TRIGGER: ALWAYS RESET + SEARCH + OPEN MODAL ═══
    window._triggerStrikeCapture = async function(product) {
        if (!product) return;
        showToast('Recherche du prix initial...', 'info');

        // ALWAYS reset to force re-search
        product.strikePrice = null;
        product._strikePriceAll = null;
        product._strikePriceNotFound = null;

        var strike = await _captureStrikePrice(product);

        if (!strike) {
            var pdfStrike = _extractStrikeFromPDF(product);
            if (pdfStrike) { product.strikePrice = pdfStrike; product._strikePriceSource = 'pdf_extraction'; }
        }

        // ALWAYS open modal — user confirms
        _promptStrikeEdit(product);
    };

    // ═══ MODAL ═══
    window._promptStrikeEdit = function(product) {
        var current = product.strikePrice || '';
        var underlyings = (product.underlyings || []).join(', ');
        var subDate = product.subscriptionDate || product.addedDate || '?';
        var isHistorical = product.subscriptionDate && new Date(product.subscriptionDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        var foundHtml = '';
        if (product._strikePriceAll && product._strikePriceAll.length > 0) {
            foundHtml = '<div style="background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:11px">';
            foundHtml += '<strong style="color:var(--green)">\u2705 Trouv\u00e9s:</strong><br>';
            product._strikePriceAll.forEach(function(f) {
                foundHtml += '<span style="color:var(--text-bright)">' + f.underlying + '</span> \u2192 <strong style="color:var(--green)">' + f.price + '</strong> <span style="color:var(--text-dim)">(' + f.source + ')</span><br>';
            });
            foundHtml += '</div>';
        }

        var notFoundHtml = '';
        if (product._strikePriceNotFound && product._strikePriceNotFound.length > 0) {
            notFoundHtml = '<div style="background:rgba(255,166,0,0.08);border:1px solid rgba(255,166,0,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:11px">';
            notFoundHtml += '<strong style="color:var(--orange)">\u274c Non trouv\u00e9s dans la base:</strong><br>';
            product._strikePriceNotFound.forEach(function(nf) {
                notFoundHtml += '<span style="color:var(--text-bright)">' + nf + '</span> \u2014 <span style="color:var(--orange)">entrez la valeur manuellement</span><br>';
            });
            notFoundHtml += '</div>';
        }

        var historicalWarning = '';
        if (isHistorical) {
            historicalWarning = '<div style="background:rgba(255,166,0,0.08);border:1px solid rgba(255,166,0,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:11px;color:var(--orange)">' +
                '\u26a0 <strong>Souscrit le ' + subDate + '</strong> \u2014 les prix ci-dessus sont actuels. ' +
                'V\u00e9rifiez dans la brochure ("Niveau Initial") le prix \u00e0 la date de souscription et corrigez si besoin.</div>';
        }

        var modal = document.getElementById('modal');
        modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:480px">' +
            '<h2 class="modal-title">\ud83d\udccd Niveau Initial (Strike)</h2>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">' +
            '<div style="margin-bottom:6px"><strong>Produit:</strong> ' + (product.name || '?').substring(0, 50) + '</div>' +
            '<div style="margin-bottom:6px"><strong>Sous-jacents:</strong> ' + underlyings + '</div>' +
            '<div style="margin-bottom:6px"><strong>Date souscription:</strong> ' + subDate + '</div>' +
            '</div>' +
            foundHtml +
            notFoundHtml +
            historicalWarning +
            '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:16px;font-size:11px;color:var(--text-muted)">' +
            '\ud83d\udca1 Le strike = prix du sous-jacent le jour de la souscription. Cherchez dans la brochure: "Niveau Initial", "Fixing Initial".' +
            '</div>' +
            '<div class="form-field"><label>Strike Price \u00e0 confirmer (pts ou \u20ac)</label>' +
            '<input id="strike-input" type="number" step="0.01" value="' + current + '" placeholder="Entrez le prix du sous-jacent \u00e0 la souscription" style="width:100%;padding:12px;font-size:18px;font-weight:700;background:var(--bg-elevated);border:2px solid var(--accent);border-radius:var(--radius-sm);color:var(--text-bright)">' +
            '</div>' +
            '<div class="modal-actions" style="margin-top:16px">' +
            '<button class="btn" onclick="closeModal()">Annuler</button>' +
            '<button class="btn primary" onclick="_saveStrikeFromModal()" style="font-size:14px;padding:10px 24px">\ud83d\udcbe Confirmer le Strike</button>' +
            '</div></div></div>';
        modal.classList.add('visible');
        setTimeout(function() { var inp = document.getElementById('strike-input'); if (inp) { inp.focus(); inp.select(); } }, 100);
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
        showToast('\u2705 Strike confirm\u00e9: ' + p.strikePrice, 'success');
        document.querySelectorAll('.btn-strike').forEach(function(b) { b.remove(); });
        _showStrikeButton();
    };

    window._saveStrikePrice = async function(product) {
        if (!product) return;
        try {
            var bankId = product.bankId;
            if (bankId && typeof app._saveProductFile === 'function') await app._saveProductFile(bankId, product);
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

    setInterval(function() {
        if (typeof app === 'undefined' || !app.state || !app.state.currentProduct) return;
        if (document.querySelector('.btn-strike')) return;
        _showStrikeButton();
    }, 800);

    console.log('[StructBoard] Strike Capture v1.5 \u2014 always re-search + confirm');
})();

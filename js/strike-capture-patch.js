// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Strike Price Auto-Capture v2.0
// v2.0: Multi-asset support — one strike per underlying
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function _cleanName(raw) {
        var s = (raw || '').toLowerCase();
        s = s.replace(/^action\s+/i, '');
        s = s.replace(/\s*\([a-z]{2}\d{8,12}\)/gi, '');
        s = s.replace(/\s*\([^)]*\)/g, '');
        s = s.replace(/\b(s\.?p\.?a\.?|s\.?a\.?|s\.?e\.?|n\.?v\.?|a\.?g\.?|plc|inc|ltd|corp|group)\b/gi, '');
        s = s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        return s;
    }

    // ═══ SEARCH PRICE FOR ONE UNDERLYING ═══
    async function _findPriceForUnderlying(uj, marketData) {
        var ujClean = _cleanName(uj);
        var ujWords = ujClean.split(' ').filter(function(w) { return w.length >= 2; });
        var price = null, source = null, ticker = null;

        if (marketData.stocks) {
            var best = null;
            for (var t in marketData.stocks) {
                var s = marketData.stocks[t];
                var nc = _cleanName(s.name || '');
                var nac = _cleanName(s.name_api || '');
                var tl = t.toLowerCase();
                for (var w = 0; w < ujWords.length; w++) {
                    if (ujWords[w] === tl && ujWords[w].length >= 2)
                        if (s.price > 0 && (!best || best.score < 100))
                            best = { price: s.price, source: 'stock', ticker: t, score: 100 };
                }
                if (nc && ujClean && (nc.indexOf(ujClean) >= 0 || ujClean.indexOf(nc) >= 0))
                    if (s.price > 0 && (!best || best.score < 90))
                        best = { price: s.price, source: 'stock', ticker: t, score: 90 };
                if (nac && ujClean && (nac.indexOf(ujClean) >= 0 || ujClean.indexOf(nac) >= 0))
                    if (s.price > 0 && (!best || best.score < 85))
                        best = { price: s.price, source: 'stock', ticker: t, score: 85 };
                if (ujWords.length >= 2) {
                    var mc = 0, ft = nc + ' ' + nac + ' ' + tl;
                    for (var ww = 0; ww < ujWords.length; ww++) if (ft.indexOf(ujWords[ww]) >= 0) mc++;
                    if (mc >= 2 && mc / ujWords.length >= 0.5) {
                        var ws = Math.round(mc / ujWords.length * 80);
                        if (s.price > 0 && (!best || best.score < ws))
                            best = { price: s.price, source: 'stock', ticker: t, score: ws };
                    }
                }
            }
            if (best) { price = best.price; source = best.source; ticker = best.ticker; }
        }

        if (!price && marketData.underlyings_extra) {
            try {
                var umap = await github.readFile('data/underlying-map.json');
                if (umap && umap.indices) {
                    for (var key in umap.indices) {
                        if (ujClean.indexOf(key) >= 0 || key.indexOf(ujClean) >= 0) {
                            var pt = umap.indices[key].proxy;
                            var ex = marketData.underlyings_extra[pt];
                            if (ex && ex.last_close > 0) { price = ex.last_close; source = 'proxy'; ticker = pt; }
                            break;
                        }
                    }
                }
            } catch(e) {}
        }

        return price ? { underlying: uj, price: Math.round(price * 100) / 100, source: source, ticker: ticker, found: true }
                      : { underlying: uj, price: null, source: null, ticker: null, found: false };
    }

    // ═══ CAPTURE ALL STRIKES ═══
    window._captureAllStrikes = async function(product) {
        if (!product) return [];
        var underlyings = product.underlyings || [];
        if (underlyings.length === 0) return [];
        var marketData = null;
        try { marketData = await github.readFile('data/market/index.json'); } catch(e) { return []; }

        var results = [];
        for (var i = 0; i < underlyings.length; i++) {
            var r = await _findPriceForUnderlying(underlyings[i], marketData);
            // If we have existing strikes saved, use them as defaults
            if (product.strikePrices && product.strikePrices[underlyings[i]]) {
                r.savedStrike = product.strikePrices[underlyings[i]];
            }
            results.push(r);
        }
        return results;
    };

    // ═══ HOOK INTO INTEGRATION ═══
    var _strikeInterval = setInterval(function() {
        if (typeof app === 'undefined' || !app.integrateProposal) return;
        clearInterval(_strikeInterval);
        var _origIntegrate = app.integrateProposal;
        app.integrateProposal = async function(product) {
            if (product && (!product.strikePrice || product.strikePrice <= 0)) {
                var results = await _captureAllStrikes(product);
                var allFound = results.every(function(r) { return r.found; });
                if (allFound && results.length > 0) {
                    // All found → auto-save for new products
                    _saveStrikesFromResults(product, results);
                    showToast('Strikes captur\u00e9s: ' + results.map(function(r) { return r.ticker + '=' + r.price; }).join(', '), 'success');
                }
            }
            return _origIntegrate.call(app, product);
        };
    }, 300);
    setTimeout(function() { clearInterval(_strikeInterval); }, 10000);

    // ═══ PDF EXTRACTION ═══
    window._extractStrikeFromPDF = function(product) {
        if (!product || !product.rawText) return null;
        var patterns = [/niveau\s*initial\s*[:=]?\s*([\d\s,.]+)/i, /fixing\s*initial\s*[:=]?\s*([\d\s,.]+)/i,
            /cours\s*initial\s*[:=]?\s*([\d\s,.]+)/i];
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
        var hasStrikes = p.strikePrices && Object.keys(p.strikePrices).length > 0;
        var hasSingle = p.strikePrice && p.strikePrice > 0;
        if (hasStrikes || hasSingle) {
            var label = hasStrikes ? Object.keys(p.strikePrices).length + ' strikes' : p.strikePrice;
            btn.innerHTML = '\ud83d\udccd ' + label;
            btn.style.cssText += 'color:var(--green);border-color:var(--green);';
        } else {
            btn.innerHTML = '\ud83d\udccd Capturer Strike';
            btn.style.cssText += 'color:var(--orange);border-color:var(--orange);';
        }
        btn.onclick = function() { _triggerStrikeCapture(p); };
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    };

    // ═══ TRIGGER ═══
    window._triggerStrikeCapture = async function(product) {
        if (!product) return;
        showToast('Recherche des prix initiaux...', 'info');
        var results = await _captureAllStrikes(product);
        _showStrikeModal(product, results);
    };

    // ═══ MODAL — ONE FIELD PER UNDERLYING ═══
    window._showStrikeModal = function(product, results) {
        var underlyings = product.underlyings || [];
        var subDate = product.subscriptionDate || product.addedDate || '?';
        var isHistorical = product.subscriptionDate && new Date(product.subscriptionDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        var isMulti = underlyings.length > 1;

        var rowsHtml = '';
        results.forEach(function(r, idx) {
            var savedVal = (product.strikePrices && product.strikePrices[r.underlying]) || r.price || '';
            var statusIcon = r.found ? '\u2705' : '\u274c';
            var statusColor = r.found ? 'var(--green)' : 'var(--orange)';
            var priceInfo = r.found ? r.price + ' <span style="color:var(--text-dim);font-size:10px">(' + r.source + ':' + r.ticker + ' prix actuel)</span>' : '<span style="color:var(--orange)">non trouv\u00e9 \u2014 entrer manuellement</span>';

            rowsHtml += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;background:var(--bg-elevated)">';
            rowsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
            rowsHtml += '<span style="font-weight:600;color:var(--text-bright);font-size:12px">' + statusIcon + ' ' + r.underlying + '</span>';
            rowsHtml += '<span style="font-size:10px;color:' + statusColor + '">' + priceInfo + '</span>';
            rowsHtml += '</div>';
            rowsHtml += '<input id="strike-' + idx + '" type="number" step="0.01" value="' + savedVal + '" ';
            rowsHtml += 'placeholder="Prix au ' + subDate + '" ';
            rowsHtml += 'style="width:100%;padding:8px;font-size:14px;font-weight:700;background:var(--bg-card);border:1px solid ' + (r.found ? 'var(--border)' : 'var(--orange)') + ';border-radius:var(--radius-sm);color:var(--text-bright)">';
            rowsHtml += '</div>';
        });

        var historicalWarning = '';
        if (isHistorical) {
            historicalWarning = '<div style="background:rgba(255,166,0,0.08);border:1px solid rgba(255,166,0,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:11px;color:var(--orange)">' +
                '\u26a0 <strong>Souscrit le ' + subDate + '</strong> \u2014 les prix affich\u00e9s sont actuels. Corrigez avec les prix de la brochure ("Niveau Initial") \u00e0 la date de souscription.</div>';
        }

        var explainHtml = '';
        if (isMulti) {
            explainHtml = '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">' +
                '\ud83d\udca1 <strong>Worst-of multi-actifs:</strong> chaque action a son propre niveau initial (strike). La barri\u00e8re se mesure sur le pire performeur par rapport \u00e0 son propre strike. Entrez le prix de chaque action au jour de la souscription.</div>';
        } else {
            explainHtml = '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">' +
                '\ud83d\udca1 Le strike = prix du sous-jacent le jour de la souscription. Cherchez "Niveau Initial" ou "Fixing Initial" dans la brochure.</div>';
        }

        var modal = document.getElementById('modal');
        modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:520px;max-height:90vh;overflow-y:auto">' +
            '<h2 class="modal-title">\ud83d\udccd Niveaux Initiaux (Strike' + (isMulti ? 's' : '') + ')</h2>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' +
            '<div style="margin-bottom:4px"><strong>Produit:</strong> ' + (product.name || '?').substring(0, 50) + '</div>' +
            '<div style="margin-bottom:4px"><strong>Date souscription:</strong> ' + subDate + '</div>' +
            (isMulti ? '<div style="margin-bottom:4px"><strong>Type:</strong> Worst-of ' + underlyings.length + ' actifs</div>' : '') +
            '</div>' +
            historicalWarning +
            explainHtml +
            '<div style="margin-bottom:12px">' + rowsHtml + '</div>' +
            '<div class="modal-actions">' +
            '<button class="btn" onclick="closeModal()">Annuler</button>' +
            '<button class="btn primary" onclick="_saveStrikesFromModal(' + results.length + ')" style="font-size:14px;padding:10px 24px">\ud83d\udcbe Confirmer</button>' +
            '</div></div></div>';
        modal.classList.add('visible');

        // Focus first empty or not-found input
        setTimeout(function() {
            for (var i = 0; i < results.length; i++) {
                var inp = document.getElementById('strike-' + i);
                if (inp && (!inp.value || !results[i].found)) { inp.focus(); inp.select(); break; }
            }
        }, 100);
    };

    // ═══ SAVE FROM MODAL ═══
    window._saveStrikesFromModal = async function(count) {
        var p = app.state.currentProduct;
        if (!p) return;
        var underlyings = p.underlyings || [];
        var strikePrices = {};
        var allValid = true;
        var firstPrice = null;

        for (var i = 0; i < count; i++) {
            var val = parseFloat(document.getElementById('strike-' + i)?.value);
            if (!val || val <= 0) {
                // Allow empty for rate/commodity underlyings
                continue;
            }
            if (!firstPrice) firstPrice = val;
            if (underlyings[i]) strikePrices[underlyings[i]] = Math.round(val * 100) / 100;
        }

        if (Object.keys(strikePrices).length === 0) {
            showToast('Au moins un strike requis', 'error');
            return;
        }

        // Save individual strikes
        p.strikePrices = strikePrices;
        // Keep backward-compatible single strikePrice (first underlying)
        p.strikePrice = firstPrice;
        p._strikePriceSource = 'manual';
        p._strikePriceDate = new Date().toISOString().split('T')[0];

        closeModal();
        await _saveStrikePrice(p);
        showToast('\u2705 ' + Object.keys(strikePrices).length + ' strike(s) confirm\u00e9(s)', 'success');
        document.querySelectorAll('.btn-strike').forEach(function(b) { b.remove(); });
        _showStrikeButton();
    };

    // ═══ HELPER: save results directly ═══
    function _saveStrikesFromResults(product, results) {
        var strikePrices = {};
        results.forEach(function(r) {
            if (r.found && r.price) strikePrices[r.underlying] = r.price;
        });
        product.strikePrices = strikePrices;
        if (results[0] && results[0].price) product.strikePrice = results[0].price;
        product._strikePriceSource = 'auto';
        product._strikePriceDate = new Date().toISOString().split('T')[0];
    }

    // ═══ SAVE TO FILES ═══
    window._saveStrikePrice = async function(product) {
        if (!product) return;
        try {
            var bankId = product.bankId;
            if (bankId && typeof app._saveProductFile === 'function') await app._saveProductFile(bankId, product);
            var portfolio = app.state.portfolio || [];
            var pfProduct = portfolio.find(function(x) { return x.id === product.id; });
            if (pfProduct) {
                pfProduct.strikePrice = product.strikePrice;
                pfProduct.strikePrices = product.strikePrices;
                pfProduct._strikePriceSource = product._strikePriceSource;
                pfProduct._strikePriceDate = product._strikePriceDate;
                await github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', portfolio,
                    '[StructBoard] Strikes for ' + (product.name || product.id).substring(0, 30));
            }
        } catch(e) { console.warn('[Strike] Save error:', e); }
    };

    // ═══ AUTO-INJECT ═══
    setInterval(function() {
        if (typeof app === 'undefined' || !app.state || !app.state.currentProduct) return;
        if (document.querySelector('.btn-strike')) return;
        _showStrikeButton();
    }, 800);

    console.log('[StructBoard] Strike Capture v2.0 \u2014 multi-asset strikes');
})();

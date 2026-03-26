// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Strike Price Auto-Capture v1.3
// v1.3: Better matching (strips "Action", ISIN, suffixes)
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ NAME CLEANING FOR MATCHING ═══
    function _cleanUnderlyingName(raw) {
        var s = (raw || '').toLowerCase();
        // Remove "action " prefix
        s = s.replace(/^action\s+/i, '');
        // Remove ISIN codes in parentheses: (FR0000131104), (XS3238166899)
        s = s.replace(/\s*\([a-z]{2}\d{8,12}\)/gi, '');
        // Remove other parenthetical content
        s = s.replace(/\s*\([^)]*\)/g, '');
        // Remove common company suffixes
        s = s.replace(/\b(s\.?p\.?a\.?|s\.?a\.?|s\.?e\.?|n\.?v\.?|a\.?g\.?|plc|inc|ltd|corp|group)\b/gi, '');
        // Clean whitespace
        s = s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        return s;
    }

    // ═══ AUTO-CAPTURE STRIKE ═══
    window._captureStrikePrice = async function(product) {
        if (!product) return null;
        if (product.strikePrice && product.strikePrice > 0) return product.strikePrice;

        var underlyings = product.underlyings || [];
        if (underlyings.length === 0) return null;

        var marketData = null;
        try { marketData = await github.readFile('data/market/index.json'); } catch(e) { return null; }

        var prices = [];
        var notFound = [];

        for (var i = 0; i < underlyings.length; i++) {
            var uj = underlyings[i];
            var ujClean = _cleanUnderlyingName(uj);
            var ujWords = ujClean.split(' ').filter(function(w) { return w.length >= 2; });
            var price = null, source = null;

            // 1. Try matching stocks
            if (marketData.stocks) {
                var bestMatch = null;
                var bestScore = 0;

                for (var ticker in marketData.stocks) {
                    var stock = marketData.stocks[ticker];
                    var nameClean = _cleanUnderlyingName(stock.name || '');
                    var nameApiClean = _cleanUnderlyingName(stock.name_api || '');
                    var tickerLow = ticker.toLowerCase();

                    // Exact ticker match (e.g., "BNP" matches ticker "BNP")
                    for (var w = 0; w < ujWords.length; w++) {
                        if (ujWords[w] === tickerLow && ujWords[w].length >= 2) {
                            if (stock.price && stock.price > 0) {
                                bestMatch = { price: stock.price, source: 'stock:' + ticker, score: 100 };
                            }
                        }
                    }

                    // Name contains match
                    if (nameClean && ujClean && (nameClean.indexOf(ujClean) >= 0 || ujClean.indexOf(nameClean) >= 0)) {
                        if (stock.price && stock.price > 0 && (!bestMatch || bestMatch.score < 90)) {
                            bestMatch = { price: stock.price, source: 'stock:' + ticker, score: 90 };
                        }
                    }
                    if (nameApiClean && ujClean && (nameApiClean.indexOf(ujClean) >= 0 || ujClean.indexOf(nameApiClean) >= 0)) {
                        if (stock.price && stock.price > 0 && (!bestMatch || bestMatch.score < 85)) {
                            bestMatch = { price: stock.price, source: 'stock:' + ticker, score: 85 };
                        }
                    }

                    // Word overlap scoring (at least 2 words must match)
                    if (ujWords.length >= 2) {
                        var matchCount = 0;
                        var fullText = (nameClean + ' ' + nameApiClean + ' ' + tickerLow);
                        for (var ww = 0; ww < ujWords.length; ww++) {
                            if (fullText.indexOf(ujWords[ww]) >= 0) matchCount++;
                        }
                        var matchRatio = matchCount / ujWords.length;
                        if (matchRatio >= 0.5 && matchCount >= 2) {
                            var wordScore = Math.round(matchRatio * 80);
                            if (stock.price && stock.price > 0 && (!bestMatch || bestMatch.score < wordScore)) {
                                bestMatch = { price: stock.price, source: 'stock:' + ticker, score: wordScore };
                            }
                        }
                    }
                }

                if (bestMatch) {
                    price = bestMatch.price;
                    source = bestMatch.source;
                    console.log('[Strike] Matched "' + uj + '" → ' + source + ' (score: ' + bestMatch.score + ', price: ' + price + ')');
                }
            }

            // 2. Try proxy ETF for indices
            if (!price && marketData.underlyings_extra) {
                try {
                    var umap = await github.readFile('data/underlying-map.json');
                    if (umap && umap.indices) {
                        for (var key in umap.indices) {
                            if (ujClean.indexOf(key) >= 0 || key.indexOf(ujClean) >= 0) {
                                var proxyTicker = umap.indices[key].proxy;
                                var extra = marketData.underlyings_extra[proxyTicker];
                                if (extra && extra.last_close > 0) { price = extra.last_close; source = 'proxy:' + proxyTicker; }
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }

            if (price) {
                prices.push({ underlying: uj, price: price, source: source });
            } else {
                notFound.push(uj);
                console.warn('[Strike] No match for: "' + uj + '" (cleaned: "' + ujClean + '")');
            }
        }

        if (prices.length === 0) return null;

        // Store all found prices
        product.strikePrice = Math.round(prices[0].price * 100) / 100;
        product._strikePriceSource = prices[0].source;
        product._strikePriceDate = new Date().toISOString().split('T')[0];
        product._strikePriceAll = prices;
        product._strikePriceNotFound = notFound;
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
                if (strike) {
                    var msg = 'Strike captur\u00e9: ' + strike;
                    if (product._strikePriceNotFound && product._strikePriceNotFound.length > 0) {
                        msg += ' (\u26a0 ' + product._strikePriceNotFound.length + ' SJ non trouv\u00e9s)';
                    }
                    showToast(msg, 'success');
                }
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

    // ═══ UI: STRIKE BUTTON ═══
    window._showStrikeButton = function() {
        if (document.querySelector('.btn-strike')) return;
        var p = app && app.state && app.state.currentProduct;
        if (!p) return;

        var anchor = null;
        var allButtons = document.querySelectorAll('button');
        for (var i = 0; i < allButtons.length; i++) {
            var txt = allButtons[i].textContent || '';
            if (txt.indexOf('Liquidit') >= 0 || txt.indexOf('Actualiser') >= 0) {
                anchor = allButtons[i];
            }
        }
        if (!anchor) return;

        var btn = document.createElement('button');
        btn.className = 'btn sm btn-strike';
        btn.style.cssText = 'margin-left:6px;white-space:nowrap;';

        if (p.strikePrice && p.strikePrice > 0) {
            btn.innerHTML = '\ud83d\udccd Strike: ' + p.strikePrice;
            btn.style.cssText += 'color:var(--green);border-color:var(--green);';
            btn.title = 'Strike ' + p.strikePrice + ' (' + (p._strikePriceSource || 'manuel') + '). Cliquer pour modifier.';
            btn.onclick = function() { _promptStrikeEdit(p); };
        } else {
            btn.innerHTML = '\ud83d\udccd Capturer Strike';
            btn.style.cssText += 'color:var(--orange);border-color:var(--orange);';
            btn.title = 'Chercher le prix du sous-jacent';
            btn.onclick = function() { _triggerStrikeCapture(p); };
        }

        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    };

    // Trigger auto-capture
    window._triggerStrikeCapture = async function(product) {
        if (!product) return;
        showToast('Recherche du prix initial...', 'info');

        // Reset to allow re-capture
        product.strikePrice = null;
        var strike = await _captureStrikePrice(product);

        if (strike) {
            var msg = '\u2705 Strike: ' + strike + ' (prix actuel ' + (product._strikePriceSource || '') + ')';
            if (product._strikePriceNotFound && product._strikePriceNotFound.length > 0) {
                msg += '\n\u26a0 Non trouv\u00e9s: ' + product._strikePriceNotFound.join(', ');
            }
            showToast(msg, 'success');
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

    // Manual strike modal
    window._promptStrikeEdit = function(product) {
        var current = product.strikePrice || '';
        var underlyings = (product.underlyings || []).join(', ');
        var subDate = product.subscriptionDate || product.addedDate || '?';
        var isHistorical = product.subscriptionDate && new Date(product.subscriptionDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        var notFoundHtml = '';
        if (product._strikePriceNotFound && product._strikePriceNotFound.length > 0) {
            notFoundHtml = '<div style="background:rgba(255,166,0,0.08);border:1px solid rgba(255,166,0,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--orange)">' +
                '\u26a0 <strong>Sous-jacents non trouv\u00e9s dans la base:</strong> ' + product._strikePriceNotFound.join(', ') +
                '<br>Entrez le prix manuellement depuis la brochure.</div>';
        }

        var historicalWarning = '';
        if (isHistorical) {
            historicalWarning = '<div style="background:rgba(255,166,0,0.08);border:1px solid rgba(255,166,0,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:10px;color:var(--orange)">' +
                '\u26a0 <strong>Produit souscrit le ' + subDate + '</strong> \u2014 le strike doit \u00eatre le prix \u00e0 cette date, pas le prix actuel. Consultez la brochure (\"Niveau Initial\") ou lancez le workflow GitHub pour r\u00e9cup\u00e9rer le prix historique automatiquement.</div>';
        }

        var modal = document.getElementById('modal');
        modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:450px">' +
            '<h2 class="modal-title">\ud83d\udccd Niveau Initial (Strike)</h2>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">' +
            '<div style="margin-bottom:8px"><strong>Produit:</strong> ' + (product.name || '?').substring(0, 50) + '</div>' +
            '<div style="margin-bottom:8px"><strong>Sous-jacent:</strong> ' + underlyings + '</div>' +
            '<div style="margin-bottom:8px"><strong>Date souscription:</strong> ' + subDate + '</div>' +
            (product._strikePriceSource ? '<div style="margin-bottom:8px"><strong>Source:</strong> ' + product._strikePriceSource + ' (' + (product._strikePriceDate || '') + ')</div>' : '') +
            '</div>' +
            notFoundHtml +
            historicalWarning +
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

    // ═══ AUTO-INJECT ═══
    setInterval(function() {
        if (typeof app === 'undefined' || !app.state || !app.state.currentProduct) return;
        if (document.querySelector('.btn-strike')) return;
        _showStrikeButton();
    }, 800);

    console.log('[StructBoard] Strike Capture v1.3 \u2014 improved matching + warnings');
})();

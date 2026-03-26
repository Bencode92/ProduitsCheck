// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Strike Price Auto-Capture v2.1
// v2.1: Twelve Data API for HISTORICAL prices at subscription date
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

    // ═══ FIND TICKER FOR AN UNDERLYING ═══
    function _findTickerForUnderlying(uj, marketData) {
        var ujClean = _cleanName(uj);
        var ujWords = ujClean.split(' ').filter(function(w) { return w.length >= 2; });
        if (!marketData || !marketData.stocks) return null;

        var best = null;
        for (var ticker in marketData.stocks) {
            var stock = marketData.stocks[ticker];
            var nc = _cleanName(stock.name || '');
            var nac = _cleanName(stock.name_api || '');
            var tl = ticker.toLowerCase();
            for (var w = 0; w < ujWords.length; w++) {
                if (ujWords[w] === tl && ujWords[w].length >= 2)
                    if (stock.price > 0 && (!best || best.score < 100))
                        best = { ticker: ticker, price: stock.price, score: 100 };
            }
            if (nc && ujClean && (nc.indexOf(ujClean) >= 0 || ujClean.indexOf(nc) >= 0))
                if (stock.price > 0 && (!best || best.score < 90))
                    best = { ticker: ticker, price: stock.price, score: 90 };
            if (nac && ujClean && (nac.indexOf(ujClean) >= 0 || ujClean.indexOf(nac) >= 0))
                if (stock.price > 0 && (!best || best.score < 85))
                    best = { ticker: ticker, price: stock.price, score: 85 };
            if (ujWords.length >= 2) {
                var mc = 0, ft = nc + ' ' + nac + ' ' + tl;
                for (var ww = 0; ww < ujWords.length; ww++) if (ft.indexOf(ujWords[ww]) >= 0) mc++;
                if (mc >= 2 && mc / ujWords.length >= 0.5) {
                    var ws = Math.round(mc / ujWords.length * 80);
                    if (stock.price > 0 && (!best || best.score < ws))
                        best = { ticker: ticker, price: stock.price, score: ws };
                }
            }
        }
        return best;
    }

    // ═══ FETCH HISTORICAL PRICE FROM TWELVE DATA ═══
    async function _fetchHistoricalPrice(ticker, dateStr) {
        var apiKey = CONFIG.TWELVE_DATA_API_KEY;
        if (!apiKey || !ticker || !dateStr) return null;

        try {
            var target = new Date(dateStr);
            var start = new Date(target); start.setDate(start.getDate() - 5);
            var end = new Date(target); end.setDate(end.getDate() + 5);
            var startStr = start.toISOString().split('T')[0];
            var endStr = end.toISOString().split('T')[0];

            var url = 'https://api.twelvedata.com/time_series?symbol=' + ticker +
                '&interval=1day&start_date=' + startStr + '&end_date=' + endStr +
                '&outputsize=10&apikey=' + apiKey;

            console.log('[Strike] Fetching historical: ' + ticker + ' @ ' + dateStr);
            var response = await fetch(url);
            var data = await response.json();

            if (data.status === 'error') {
                console.warn('[Strike] API error for ' + ticker + ': ' + (data.message || ''));
                return null;
            }

            var values = data.values || [];
            if (values.length === 0) return null;

            // Find closest date to target
            var targetTime = target.getTime();
            var bestVal = null;
            var bestDiff = 999999999;
            for (var i = 0; i < values.length; i++) {
                var vDate = new Date(values[i].datetime);
                var diff = Math.abs(vDate.getTime() - targetTime);
                if (diff < bestDiff) { bestDiff = diff; bestVal = values[i]; }
            }

            if (bestVal && parseFloat(bestVal.close) > 0) {
                return {
                    close: Math.round(parseFloat(bestVal.close) * 100) / 100,
                    date: bestVal.datetime.split(' ')[0],
                    open: Math.round(parseFloat(bestVal.open || 0) * 100) / 100,
                    high: Math.round(parseFloat(bestVal.high || 0) * 100) / 100,
                    low: Math.round(parseFloat(bestVal.low || 0) * 100) / 100,
                };
            }
            return null;
        } catch(e) {
            console.warn('[Strike] Fetch error: ' + e.message);
            return null;
        }
    }

    // ═══ CAPTURE ALL STRIKES (HISTORICAL OR CURRENT) ═══
    window._captureAllStrikes = async function(product) {
        if (!product) return [];
        var underlyings = product.underlyings || [];
        if (underlyings.length === 0) return [];
        var marketData = null;
        try { marketData = await github.readFile('data/market/index.json'); } catch(e) { return []; }

        var subDate = product.subscriptionDate || product.addedDate || null;
        var isHistorical = subDate && new Date(subDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        var hasApiKey = !!(CONFIG.TWELVE_DATA_API_KEY);
        var results = [];

        for (var i = 0; i < underlyings.length; i++) {
            var uj = underlyings[i];
            var match = _findTickerForUnderlying(uj, marketData);
            var result = { underlying: uj, price: null, source: null, ticker: null, found: false, historical: false };

            if (match) {
                result.ticker = match.ticker;
                result.currentPrice = match.price;

                // If historical + API key available → fetch real historical price
                if (isHistorical && hasApiKey) {
                    showToast('Twelve Data: ' + match.ticker + ' @ ' + subDate + '...', 'info');
                    var hist = await _fetchHistoricalPrice(match.ticker, subDate);
                    if (hist) {
                        result.price = hist.close;
                        result.source = 'twelve_data';
                        result.found = true;
                        result.historical = true;
                        result.histDate = hist.date;
                        result.ohlc = hist;
                        console.log('[Strike] Historical ' + match.ticker + ' @ ' + hist.date + ' = ' + hist.close);
                    } else {
                        // Fallback to current price
                        result.price = match.price;
                        result.source = 'stock_current';
                        result.found = true;
                        result.historical = false;
                    }
                } else {
                    // Use current price (new product or no API key)
                    result.price = match.price;
                    result.source = isHistorical ? 'stock_current' : 'stock';
                    result.found = true;
                }
            } else {
                // Try proxy ETF
                if (marketData.underlyings_extra) {
                    try {
                        var ujClean = _cleanName(uj);
                        var umap = await github.readFile('data/underlying-map.json');
                        if (umap && umap.indices) {
                            for (var key in umap.indices) {
                                if (ujClean.indexOf(key) >= 0 || key.indexOf(ujClean) >= 0) {
                                    var proxyTicker = umap.indices[key].proxy;
                                    // Try historical for proxy too
                                    if (isHistorical && hasApiKey) {
                                        var histProxy = await _fetchHistoricalPrice(proxyTicker, subDate);
                                        if (histProxy) {
                                            result.price = histProxy.close;
                                            result.source = 'twelve_data_proxy';
                                            result.ticker = proxyTicker;
                                            result.found = true;
                                            result.historical = true;
                                            result.histDate = histProxy.date;
                                        }
                                    }
                                    if (!result.found) {
                                        var ex = marketData.underlyings_extra[proxyTicker];
                                        if (ex && ex.last_close > 0) {
                                            result.price = ex.last_close;
                                            result.source = 'proxy_current';
                                            result.ticker = proxyTicker;
                                            result.found = true;
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                    } catch(e) {}
                }
            }

            // Restore saved value if exists
            if (product.strikePrices && product.strikePrices[uj]) {
                result.savedStrike = product.strikePrices[uj];
            }

            results.push(result);
        }
        return results;
    };

    // ═══ HOOK INTO INTEGRATION ═══
    var _si = setInterval(function() {
        if (typeof app === 'undefined' || !app.integrateProposal) return;
        clearInterval(_si);
        var _orig = app.integrateProposal;
        app.integrateProposal = async function(product) {
            if (product && (!product.strikePrice || product.strikePrice <= 0)) {
                var results = await _captureAllStrikes(product);
                if (results.length > 0 && results.every(function(r) { return r.found; })) {
                    _saveStrikesFromResults(product, results);
                    showToast('Strikes captur\u00e9s', 'success');
                }
            }
            return _orig.call(app, product);
        };
    }, 300);
    setTimeout(function() { clearInterval(_si); }, 10000);

    // ═══ UI: BUTTON ═══
    window._showStrikeButton = function() {
        if (document.querySelector('.btn-strike')) return;
        var p = app && app.state && app.state.currentProduct;
        if (!p) return;
        var anchor = null;
        document.querySelectorAll('button').forEach(function(b) {
            var t = b.textContent || '';
            if (t.indexOf('Liquidit') >= 0 || t.indexOf('Actualiser') >= 0) anchor = b;
        });
        if (!anchor) return;
        var btn = document.createElement('button');
        btn.className = 'btn sm btn-strike';
        btn.style.cssText = 'margin-left:6px;white-space:nowrap;';
        var has = (p.strikePrices && Object.keys(p.strikePrices).length > 0) || (p.strikePrice && p.strikePrice > 0);
        if (has) {
            var lbl = p.strikePrices ? Object.keys(p.strikePrices).length + ' strikes' : p.strikePrice;
            btn.innerHTML = '\ud83d\udccd ' + lbl;
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
        showToast('Recherche des prix historiques...', 'info');
        product.strikePrice = null;
        product._strikePriceAll = null;
        product._strikePriceNotFound = null;
        var results = await _captureAllStrikes(product);
        _showStrikeModal(product, results);
    };

    // ═══ MODAL ═══
    window._showStrikeModal = function(product, results) {
        var underlyings = product.underlyings || [];
        var subDate = product.subscriptionDate || product.addedDate || '?';
        var isMulti = underlyings.length > 1;

        var rowsHtml = '';
        results.forEach(function(r, idx) {
            var displayVal = r.savedStrike || r.price || '';
            var statusIcon = r.found ? '\u2705' : '\u274c';

            var priceInfo = '';
            if (r.found && r.historical) {
                priceInfo = '<strong style="color:var(--green)">' + r.price + '</strong> <span style="color:var(--text-dim);font-size:10px">(close ' + r.histDate + ' via Twelve Data)</span>';
            } else if (r.found) {
                priceInfo = '<span style="color:var(--orange)">' + r.price + '</span> <span style="color:var(--text-dim);font-size:10px">(prix actuel ' + r.ticker + ')</span>';
            } else {
                priceInfo = '<span style="color:var(--orange)">non trouv\u00e9 \u2014 entrer manuellement</span>';
            }

            var borderColor = r.found && r.historical ? 'var(--green)' : r.found ? 'var(--orange)' : 'var(--red)';

            rowsHtml += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;background:var(--bg-elevated)">';
            rowsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:4px">';
            rowsHtml += '<span style="font-weight:600;color:var(--text-bright);font-size:12px">' + statusIcon + ' ' + r.underlying + '</span>';
            rowsHtml += '<span style="font-size:10px">' + priceInfo + '</span>';
            rowsHtml += '</div>';
            rowsHtml += '<input id="strike-' + idx + '" type="number" step="0.01" value="' + displayVal + '" ';
            rowsHtml += 'placeholder="Prix au ' + subDate + '" ';
            rowsHtml += 'style="width:100%;padding:8px;font-size:14px;font-weight:700;background:var(--bg-card);border:2px solid ' + borderColor + ';border-radius:var(--radius-sm);color:var(--text-bright)">';
            rowsHtml += '</div>';
        });

        var histCount = results.filter(function(r) { return r.historical; }).length;
        var currentCount = results.filter(function(r) { return r.found && !r.historical; }).length;
        var missingCount = results.filter(function(r) { return !r.found; }).length;

        var statusHtml = '';
        if (histCount > 0) {
            statusHtml += '<div style="background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:8px;font-size:11px;color:var(--green)">' +
                '\u2705 <strong>' + histCount + ' prix historique(s)</strong> r\u00e9cup\u00e9r\u00e9(s) via Twelve Data \u00e0 la date de souscription</div>';
        }
        if (currentCount > 0) {
            statusHtml += '<div style="background:rgba(255,166,0,0.08);border:1px solid rgba(255,166,0,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:8px;font-size:11px;color:var(--orange)">' +
                '\u26a0 <strong>' + currentCount + ' prix actuel(s)</strong> \u2014 v\u00e9rifiez dans la brochure ("Niveau Initial")</div>';
        }
        if (missingCount > 0) {
            statusHtml += '<div style="background:rgba(239,35,60,0.08);border:1px solid rgba(239,35,60,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:8px;font-size:11px;color:var(--red)">' +
                '\u274c <strong>' + missingCount + ' non trouv\u00e9(s)</strong> \u2014 entrez la valeur manuellement depuis la brochure</div>';
        }

        var explainHtml = isMulti ?
            '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">' +
            '\ud83d\udca1 <strong>Worst-of:</strong> chaque action a son propre niveau initial. La barri\u00e8re se mesure sur le pire performeur par rapport \u00e0 son propre strike.</div>' :
            '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">' +
            '\ud83d\udca1 Le strike = prix du sous-jacent le jour de la souscription.</div>';

        var modal = document.getElementById('modal');
        modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:520px;max-height:90vh;overflow-y:auto">' +
            '<h2 class="modal-title">\ud83d\udccd Niveaux Initiaux (Strike' + (isMulti ? 's' : '') + ')</h2>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' +
            '<div style="margin-bottom:4px"><strong>Produit:</strong> ' + (product.name || '?').substring(0, 50) + '</div>' +
            '<div style="margin-bottom:4px"><strong>Date souscription:</strong> ' + subDate + '</div>' +
            (isMulti ? '<div style="margin-bottom:4px"><strong>Type:</strong> Worst-of ' + underlyings.length + ' actifs</div>' : '') +
            '</div>' +
            statusHtml +
            explainHtml +
            '<div style="margin-bottom:12px">' + rowsHtml + '</div>' +
            '<div class="modal-actions">' +
            '<button class="btn" onclick="closeModal()">Annuler</button>' +
            '<button class="btn primary" onclick="_saveStrikesFromModal(' + results.length + ')" style="font-size:14px;padding:10px 24px">\ud83d\udcbe Confirmer</button>' +
            '</div></div></div>';
        modal.classList.add('visible');
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
        var firstPrice = null;
        for (var i = 0; i < count; i++) {
            var val = parseFloat(document.getElementById('strike-' + i)?.value);
            if (!val || val <= 0) continue;
            if (!firstPrice) firstPrice = val;
            if (underlyings[i]) strikePrices[underlyings[i]] = Math.round(val * 100) / 100;
        }
        if (Object.keys(strikePrices).length === 0) { showToast('Au moins un strike requis', 'error'); return; }
        p.strikePrices = strikePrices;
        p.strikePrice = firstPrice;
        p._strikePriceSource = 'confirmed';
        p._strikePriceDate = new Date().toISOString().split('T')[0];
        closeModal();
        await _saveStrikePrice(p);
        showToast('\u2705 ' + Object.keys(strikePrices).length + ' strike(s) confirm\u00e9(s)', 'success');
        document.querySelectorAll('.btn-strike').forEach(function(b) { b.remove(); });
        _showStrikeButton();
    };

    function _saveStrikesFromResults(product, results) {
        var sp = {};
        results.forEach(function(r) { if (r.found && r.price) sp[r.underlying] = r.price; });
        product.strikePrices = sp;
        if (results[0] && results[0].price) product.strikePrice = results[0].price;
        product._strikePriceSource = 'auto';
        product._strikePriceDate = new Date().toISOString().split('T')[0];
    }

    window._saveStrikePrice = async function(product) {
        if (!product) return;
        try {
            var bankId = product.bankId;
            if (bankId && typeof app._saveProductFile === 'function') await app._saveProductFile(bankId, product);
            var portfolio = app.state.portfolio || [];
            var pf = portfolio.find(function(x) { return x.id === product.id; });
            if (pf) {
                pf.strikePrice = product.strikePrice;
                pf.strikePrices = product.strikePrices;
                pf._strikePriceSource = product._strikePriceSource;
                pf._strikePriceDate = product._strikePriceDate;
                await github.writeFile(CONFIG.DATA_PATH + '/portfolio.json', portfolio,
                    '[StructBoard] Strikes for ' + (product.name || product.id).substring(0, 30));
            }
        } catch(e) { console.warn('[Strike] Save error:', e); }
    };

    setInterval(function() {
        if (typeof app === 'undefined' || !app.state || !app.state.currentProduct) return;
        if (document.querySelector('.btn-strike')) return;
        _showStrikeButton();
    }, 800);

    console.log('[StructBoard] Strike Capture v2.1 \u2014 Twelve Data historical prices');
})();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Strike Price Auto-Capture v2.5
// v2.5: Twelve Data via Cloudflare Worker proxy (no API key in frontend)
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
            var score = 0;

            for (var w = 0; w < ujWords.length; w++) {
                if (ujWords[w] === tl && ujWords[w].length >= 2) score = Math.max(score, 100);
            }
            if (nc && ujClean && (nc.indexOf(ujClean) >= 0 || ujClean.indexOf(nc) >= 0)) score = Math.max(score, 90);
            if (nac && ujClean && (nac.indexOf(ujClean) >= 0 || ujClean.indexOf(nac) >= 0)) score = Math.max(score, 85);
            if (ujWords.length >= 2) {
                var mc = 0, ft = nc + ' ' + nac + ' ' + tl;
                for (var ww = 0; ww < ujWords.length; ww++) if (ft.indexOf(ujWords[ww]) >= 0) mc++;
                if (mc >= 2 && mc / ujWords.length >= 0.5) score = Math.max(score, Math.round(mc / ujWords.length * 80));
            }

            if (score > 0 && stock.price > 0 && (!best || best.score < score)) {
                best = {
                    ticker: ticker,
                    tdSymbol: stock.resolved_symbol || ticker,
                    price: stock.price,
                    score: score
                };
            }
        }
        return best;
    }

    // ═══ FETCH HISTORICAL PRICE VIA CLOUDFLARE PROXY ═══
    async function _fetchHistoricalPrice(tdSymbol, dateStr, fallbackTicker) {
        var proxyBase = CONFIG.TWELVE_DATA_PROXY;
        if (!proxyBase || !tdSymbol || !dateStr) return null;

        var target = new Date(dateStr);
        var start = new Date(target); start.setDate(start.getDate() - 5);
        var end = new Date(target); end.setDate(end.getDate() + 5);
        var startStr = start.toISOString().split('T')[0];
        var endStr = end.toISOString().split('T')[0];

        var symbolsToTry = [tdSymbol];
        if (fallbackTicker && fallbackTicker !== tdSymbol) symbolsToTry.push(fallbackTicker);

        for (var s = 0; s < symbolsToTry.length; s++) {
            var symbol = symbolsToTry[s];
            try {
                // Call via Cloudflare Worker proxy — API key added server-side
                var url = proxyBase + '/time_series?symbol=' + encodeURIComponent(symbol) +
                    '&interval=1day&start_date=' + startStr + '&end_date=' + endStr + '&outputsize=10';

                console.log('[Strike] Proxy fetch: ' + symbol + ' @ ' + dateStr);
                var response = await fetch(url);
                var data = await response.json();

                if (data.status === 'error') {
                    console.warn('[Strike] ' + symbol + ': ' + (data.message || 'error'));
                    continue;
                }

                var values = data.values || [];
                if (values.length === 0) continue;

                var targetTime = target.getTime();
                var bestVal = null, bestDiff = 999999999;
                for (var i = 0; i < values.length; i++) {
                    var vDate = new Date(values[i].datetime);
                    var diff = Math.abs(vDate.getTime() - targetTime);
                    if (diff < bestDiff) { bestDiff = diff; bestVal = values[i]; }
                }

                if (bestVal && parseFloat(bestVal.close) > 0) {
                    console.log('[Strike] OK: ' + symbol + ' @ ' + bestVal.datetime + ' = ' + bestVal.close);
                    return {
                        close: Math.round(parseFloat(bestVal.close) * 100) / 100,
                        date: bestVal.datetime.split(' ')[0],
                        symbol: symbol,
                    };
                }
            } catch(e) {
                console.warn('[Strike] Error ' + symbol + ': ' + e.message);
                continue;
            }
        }
        return null;
    }

    window._captureAllStrikes = async function(product) {
        if (!product) return [];
        var underlyings = product.underlyings || [];
        if (underlyings.length === 0) return [];
        var marketData = null;
        try { marketData = await github.readFile('data/market/index.json'); } catch(e) { return []; }

        var subDate = product.subscriptionDate || product.addedDate || null;
        var isHistorical = subDate && new Date(subDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        var hasProxy = !!(CONFIG.TWELVE_DATA_PROXY);
        var results = [];

        for (var i = 0; i < underlyings.length; i++) {
            var uj = underlyings[i];
            var match = _findTickerForUnderlying(uj, marketData);
            var result = { underlying: uj, price: null, source: null, ticker: null, found: false, historical: false, error: null };

            if (match) {
                result.ticker = match.ticker;
                result.currentPrice = match.price;

                if (isHistorical && hasProxy) {
                    showToast('Twelve Data: ' + match.tdSymbol + ' @ ' + subDate + '...', 'info');
                    var hist = await _fetchHistoricalPrice(match.tdSymbol, subDate, match.ticker);
                    if (hist) {
                        result.price = hist.close;
                        result.source = 'twelve_data';
                        result.found = true;
                        result.historical = true;
                        result.histDate = hist.date;
                        result.tdSymbol = hist.symbol;
                    } else {
                        result.price = match.price;
                        result.source = 'stock_current';
                        result.found = true;
                        result.error = 'API: pas de donn\u00e9es pour ' + match.tdSymbol;
                    }
                } else {
                    result.price = match.price;
                    result.source = isHistorical ? 'stock_current' : 'stock';
                    result.found = true;
                }
            } else {
                if (marketData.underlyings_extra) {
                    try {
                        var ujClean = _cleanName(uj);
                        var umap = await github.readFile('data/underlying-map.json');
                        if (umap && umap.indices) {
                            for (var key in umap.indices) {
                                if (ujClean.indexOf(key) >= 0 || key.indexOf(ujClean) >= 0) {
                                    var proxyTicker = umap.indices[key].proxy;
                                    if (isHistorical && hasProxy) {
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

            if (product.strikePrices && product.strikePrices[uj]) {
                result.savedStrike = product.strikePrices[uj];
            }
            results.push(result);
        }
        return results;
    };

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

    window._triggerStrikeCapture = async function(product) {
        if (!product) return;
        showToast('Recherche des prix historiques...', 'info');
        product.strikePrice = null;
        product._strikePriceAll = null;
        product._strikePriceNotFound = null;
        var results = await _captureAllStrikes(product);
        _showStrikeModal(product, results);
    };

    window._showStrikeModal = function(product, results) {
        var underlyings = product.underlyings || [];
        var subDate = product.subscriptionDate || product.addedDate || '?';
        var isMulti = underlyings.length > 1;

        var rowsHtml = '';
        results.forEach(function(r, idx) {
            var displayVal = r.savedStrike || r.price || '';
            var statusIcon = r.found ? '\u2705' : '\u274c';
            var priceInfo = '', borderColor = 'var(--border)';

            if (r.found && r.historical) {
                priceInfo = '<strong style="color:var(--green)">' + r.price + '</strong> <span style="color:var(--text-dim);font-size:10px">(close ' + r.histDate + ' via ' + (r.tdSymbol || r.ticker) + ')</span>';
                borderColor = 'var(--green)';
            } else if (r.found && r.error) {
                priceInfo = '<span style="color:var(--orange)">' + r.price + '</span> <span style="color:var(--text-dim);font-size:10px">(actuel \u2014 ' + r.error + ')</span>';
                borderColor = 'var(--orange)';
            } else if (r.found) {
                priceInfo = '<span style="color:var(--orange)">' + r.price + '</span> <span style="color:var(--text-dim);font-size:10px">(actuel ' + r.ticker + ')</span>';
                borderColor = 'var(--orange)';
            } else {
                priceInfo = '<span style="color:var(--red)">non trouv\u00e9 \u2014 entrer manuellement</span>';
                borderColor = 'var(--red)';
            }

            rowsHtml += '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;background:var(--bg-elevated)">';
            rowsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:4px">';
            rowsHtml += '<span style="font-weight:600;color:var(--text-bright);font-size:12px">' + statusIcon + ' ' + r.underlying + '</span>';
            rowsHtml += '<span style="font-size:10px">' + priceInfo + '</span>';
            rowsHtml += '</div>';
            rowsHtml += '<input id="strike-' + idx + '" type="number" step="0.01" value="' + displayVal + '" placeholder="Prix au ' + subDate + '" ';
            rowsHtml += 'style="width:100%;padding:8px;font-size:14px;font-weight:700;background:var(--bg-card);border:2px solid ' + borderColor + ';border-radius:var(--radius-sm);color:var(--text-bright)">';
            rowsHtml += '</div>';
        });

        var histCount = results.filter(function(r) { return r.historical; }).length;
        var currentCount = results.filter(function(r) { return r.found && !r.historical; }).length;
        var missingCount = results.filter(function(r) { return !r.found; }).length;

        var statusHtml = '';
        if (histCount > 0)
            statusHtml += '<div style="background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:8px;font-size:11px;color:var(--green)">\u2705 <strong>' + histCount + ' prix historique(s)</strong> r\u00e9cup\u00e9r\u00e9(s) via Twelve Data</div>';
        if (currentCount > 0)
            statusHtml += '<div style="background:rgba(255,166,0,0.08);border:1px solid rgba(255,166,0,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:8px;font-size:11px;color:var(--orange)">\u26a0 <strong>' + currentCount + ' prix actuel(s)</strong> \u2014 corrigez avec la brochure</div>';
        if (missingCount > 0)
            statusHtml += '<div style="background:rgba(239,35,60,0.08);border:1px solid rgba(239,35,60,0.2);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:8px;font-size:11px;color:var(--red)">\u274c <strong>' + missingCount + ' non trouv\u00e9(s)</strong> \u2014 entrez manuellement</div>';

        var explainHtml = isMulti ?
            '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">\ud83d\udca1 <strong>Worst-of:</strong> chaque action a son propre strike.</div>' :
            '<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px;font-size:11px;color:var(--text-muted)">\ud83d\udca1 Strike = prix du sous-jacent au jour de la souscription.</div>';

        var modal = document.getElementById('modal');
        modal.innerHTML = '<div class="modal-overlay" onclick="closeModal()"><div class="modal-content" onclick="event.stopPropagation()" style="max-width:520px;max-height:90vh;overflow-y:auto">' +
            '<h2 class="modal-title">\ud83d\udccd Niveaux Initiaux (Strike' + (isMulti ? 's' : '') + ')</h2>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' +
            '<div style="margin-bottom:4px"><strong>Produit:</strong> ' + (product.name || '?').substring(0, 50) + '</div>' +
            '<div style="margin-bottom:4px"><strong>Date souscription:</strong> ' + subDate + '</div>' +
            (isMulti ? '<div style="margin-bottom:4px"><strong>Type:</strong> Worst-of ' + underlyings.length + ' actifs</div>' : '') +
            '</div>' + statusHtml + explainHtml +
            '<div style="margin-bottom:12px">' + rowsHtml + '</div>' +
            '<div class="modal-actions">' +
            '<button class="btn" onclick="closeModal()">Annuler</button>' +
            '<button class="btn primary" onclick="_saveStrikesFromModal(' + results.length + ')" style="font-size:14px;padding:10px 24px">\ud83d\udcbe Confirmer</button>' +
            '</div></div></div>';
        modal.classList.add('visible');
        setTimeout(function() {
            for (var i = 0; i < results.length; i++) {
                var inp = document.getElementById('strike-' + i);
                if (inp && (!inp.value || !results[i].found)) { inp.focus(); break; }
            }
        }, 100);
    };

    window._saveStrikesFromModal = async function(count) {
        var p = app.state.currentProduct;
        if (!p) return;
        var underlyings = p.underlyings || [];
        var strikePrices = {}, firstPrice = null;
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

    console.log('[StructBoard] Strike Capture v2.5 \u2014 Cloudflare Worker proxy');
})();

// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Strike Price Auto-Capture v1.0
// Auto-captures the spot price of the underlying at integration time
// so the user doesn't have to enter it manually for new products.
// For existing products: manual entry via edit-modal.
// ═══════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══ AUTO-CAPTURE STRIKE AT INTEGRATION ═══
    // When a product is integrated (✅ Intégrer button),
    // automatically look up the current spot price and save it as strikePrice.
    //
    // Logic:
    // 1. Product has underlyings (e.g., ["ENI S.p.A.", "TotalEnergies"])
    // 2. For each underlying, look up current price in stocks_europe/us.json
    // 3. For indices, look up last_close in underlyings_extra.json
    // 4. Save the WORST price as strikePrice (for worst-of, the barrier
    //    is measured against the worst performer)
    //
    // The strike is saved once and never changes.

    window._captureStrikePrice = async function(product) {
        if (!product) return null;
        if (product.strikePrice && product.strikePrice > 0) {
            console.log('[Strike] Already set: ' + product.strikePrice);
            return product.strikePrice; // Already captured
        }

        var underlyings = product.underlyings || [];
        if (underlyings.length === 0) {
            console.log('[Strike] No underlyings, skipping');
            return null; // No underlying = rate product, no strike needed
        }

        // Load market data
        var marketData = null;
        try {
            marketData = await github.readFile('data/market/index.json');
        } catch(e) {
            console.warn('[Strike] Cannot load index.json');
            return null;
        }

        var prices = [];

        for (var i = 0; i < underlyings.length; i++) {
            var uj = underlyings[i];
            var ujNorm = uj.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
            var price = null;
            var source = null;

            // 1. Try stocks (actions individuelles)
            if (marketData.stocks) {
                // Search by name match
                for (var ticker in marketData.stocks) {
                    var stock = marketData.stocks[ticker];
                    var nameNorm = (stock.name || '').toLowerCase();
                    var nameApiNorm = (stock.name_api || '').toLowerCase();
                    if (nameNorm.indexOf(ujNorm) >= 0 || ujNorm.indexOf(nameNorm) >= 0 ||
                        nameApiNorm.indexOf(ujNorm) >= 0 || ujNorm.indexOf(nameApiNorm) >= 0 ||
                        ticker.toLowerCase() === ujNorm) {
                        if (stock.price && stock.price > 0) {
                            price = stock.price;
                            source = 'stock:' + ticker;
                            break;
                        }
                    }
                }
            }

            // 2. Try proxy ETF (indices)
            if (!price && marketData.underlyings_extra) {
                // Load underlying map to find proxy ticker
                try {
                    var umap = await github.readFile('data/underlying-map.json');
                    if (umap && umap.indices) {
                        for (var key in umap.indices) {
                            if (ujNorm.indexOf(key) >= 0 || key.indexOf(ujNorm) >= 0) {
                                var proxyTicker = umap.indices[key].proxy;
                                var extra = marketData.underlyings_extra[proxyTicker];
                                if (extra && extra.last_close > 0) {
                                    price = extra.last_close;
                                    source = 'proxy:' + proxyTicker;
                                }
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }

            if (price) {
                prices.push({ underlying: uj, price: price, source: source });
                console.log('[Strike] ' + uj + ' \u2192 ' + price + ' (' + source + ')');
            } else {
                console.warn('[Strike] No price found for: ' + uj);
            }
        }

        if (prices.length === 0) return null;

        // For worst-of: use the first underlying's price as the reference
        // (each underlying has its own strike in reality, but we store one for simplicity)
        var strikePrice = prices[0].price;
        product.strikePrice = Math.round(strikePrice * 100) / 100;
        product._strikePriceSource = prices[0].source;
        product._strikePriceDate = new Date().toISOString().split('T')[0];
        product._strikePriceAll = prices; // Store all for multi-underlying

        console.log('[Strike] Auto-captured: ' + product.strikePrice + ' from ' + prices[0].source + ' on ' + product._strikePriceDate);
        return product.strikePrice;
    };

    // ═══ HOOK INTO INTEGRATION FLOW ═══
    // Override the "Intégrer" button action to capture strike before saving
    var _strikeInterval = setInterval(function() {
        if (typeof app === 'undefined' || !app.integrateProposal) return;
        clearInterval(_strikeInterval);

        var _origIntegrate = app.integrateProposal;
        app.integrateProposal = async function(product) {
            // Auto-capture strike price before integration
            if (product && (!product.strikePrice || product.strikePrice <= 0)) {
                showToast('Capture du prix initial...', 'info');
                var strike = await _captureStrikePrice(product);
                if (strike) {
                    showToast('Prix initial captur\u00e9: ' + strike, 'success');
                } else {
                    console.warn('[Strike] Could not auto-capture. User can enter manually.');
                }
            }
            // Proceed with original integration
            return _origIntegrate.call(app, product);
        };
        console.log('[Strike] Integration hook installed \u2014 auto-capture on Int\u00e9grer');
    }, 300);
    setTimeout(function() { clearInterval(_strikeInterval); }, 10000);

    // ═══ ALSO TRY TO EXTRACT FROM PDF BROCHURE ═══
    // Many brochures have "Niveau Initial" or "Fixing Initial" in the text
    window._extractStrikeFromPDF = function(product) {
        if (!product || !product.rawText) return null;
        var text = product.rawText.toLowerCase();

        // Common patterns in French brochures
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
                var val = match[1].replace(/\s/g, '').replace(',', '.');
                var num = parseFloat(val);
                if (num > 0 && num < 100000) {
                    console.log('[Strike] Extracted from PDF: ' + num + ' (pattern: ' + patterns[i].source.substring(0, 20) + ')');
                    return num;
                }
            }
        }
        return null;
    };

    console.log('[StructBoard] Strike Capture v1.0 \u2014 auto-capture at integration + PDF extraction');
})();

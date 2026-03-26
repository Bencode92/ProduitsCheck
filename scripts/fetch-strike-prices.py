#!/usr/bin/env python3
"""
Fetch historical strike prices for portfolio products.
For each product without a strikePrice, uses the subscriptionDate
to fetch the close price from Twelve Data API.

Runs in GitHub Actions as part of sync-market-data workflow.
Reads data/banks/*/products/*.json, updates strikePrice field.
"""

import json, os, sys, time, glob
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

API_KEY = os.environ.get('TWELVE_DATA_API_KEY', '')
BASE = 'https://api.twelvedata.com'

# Mapping underlying names to Twelve Data symbols
# For stocks: use the ticker directly
# For indices: use the proxy ETF from underlying-map.json
UNDERLYING_MAP = None

def load_underlying_map():
    global UNDERLYING_MAP
    if UNDERLYING_MAP: return
    try:
        with open('data/underlying-map.json') as f:
            UNDERLYING_MAP = json.load(f)
    except:
        UNDERLYING_MAP = {'indices': {}, 'commodities': {}}

def get_twelve_data_symbol(underlying_name, stocks_data=None):
    """Map an underlying name to a Twelve Data ticker symbol."""
    load_underlying_map()
    name = underlying_name.lower().strip()
    
    # 1. Try exact stock match from stocks data
    if stocks_data:
        for ticker, stock in stocks_data.items():
            stock_name = (stock.get('name', '') or '').lower()
            stock_name_api = (stock.get('name_api', '') or '').lower()
            if (name in stock_name or stock_name in name or
                name in stock_name_api or stock_name_api in name or
                ticker.lower() == name):
                return ticker, 'stock'
    
    # 2. Try index proxy from underlying-map
    if UNDERLYING_MAP and UNDERLYING_MAP.get('indices'):
        for key, entry in UNDERLYING_MAP['indices'].items():
            if name.find(key) >= 0 or key.find(name) >= 0:
                return entry['proxy'], 'index_proxy'
    
    # 3. Try commodity
    if UNDERLYING_MAP and UNDERLYING_MAP.get('commodities'):
        commo_map = {'gold_usd': 'GLD', 'silver_usd': 'SLV', 'brent_usd': 'BNO'}
        for key, entry in UNDERLYING_MAP['commodities'].items():
            if name.find(key) >= 0 or key.find(name) >= 0:
                macro_key = entry.get('macro_key', '')
                if macro_key in commo_map:
                    return commo_map[macro_key], 'commodity_proxy'
    
    return None, None

def fetch_historical_close(symbol, date_str):
    """Fetch close price for a symbol on a specific date via Twelve Data.
    Uses time_series with 1 day around the target date."""
    if not API_KEY:
        return None
    
    # Parse date and get a range (the exact date might be a weekend/holiday)
    try:
        target = datetime.strptime(date_str[:10], '%Y-%m-%d')
    except:
        return None
    
    # Search 5 days before and after to handle weekends/holidays
    start = (target - timedelta(days=5)).strftime('%Y-%m-%d')
    end = (target + timedelta(days=5)).strftime('%Y-%m-%d')
    
    url = f'{BASE}/time_series?symbol={symbol}&interval=1day&start_date={start}&end_date={end}&outputsize=10&apikey={API_KEY}'
    
    try:
        req = Request(url, headers={'User-Agent': 'StructBoard/1.0'})
        with urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        
        if data.get('status') == 'error':
            print(f'    \u26a0 API error for {symbol}: {data.get("message", "?")}')
            return None
        
        values = data.get('values', [])
        if not values:
            return None
        
        # Find the closest date to target
        target_str = target.strftime('%Y-%m-%d')
        best = None
        best_diff = 999
        
        for v in values:
            v_date = v['datetime'][:10]
            try:
                v_dt = datetime.strptime(v_date, '%Y-%m-%d')
                diff = abs((v_dt - target).days)
                if diff < best_diff:
                    best_diff = diff
                    best = v
            except:
                continue
        
        if best:
            close = float(best['close'])
            actual_date = best['datetime'][:10]
            if close > 0:
                return {
                    'price': round(close, 4),
                    'date': actual_date,
                    'requested_date': target_str,
                    'open': round(float(best.get('open', 0)), 4),
                    'high': round(float(best.get('high', 0)), 4),
                    'low': round(float(best.get('low', 0)), 4),
                }
        
        return None
    except Exception as e:
        print(f'    \u26a0 Fetch error {symbol} @ {date_str}: {e}')
        return None

def main():
    if not API_KEY:
        print('\u26a0 TWELVE_DATA_API_KEY not set, skipping strike price fetch')
        return
    
    print('\u2550' * 60)
    print('StructBoard \u2014 Strike Price Auto-Fetch')
    print('\u2550' * 60)
    
    # Load stocks data for name matching
    stocks_data = {}
    for region in ['stocks_europe.json', 'stocks_us.json']:
        path = f'data/market/{region}'
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
            for stock in data.get('stocks', []):
                t = stock.get('ticker', '')
                if t:
                    stocks_data[t] = stock
    print(f'Loaded {len(stocks_data)} stocks for matching')
    
    # Find all product files
    product_files = glob.glob('data/banks/*/products/*.json')
    print(f'Found {len(product_files)} product files')
    
    updated = 0
    skipped = 0
    failed = 0
    
    for pf in product_files:
        if pf.endswith('.gitkeep'):
            continue
        
        try:
            with open(pf) as f:
                product = json.load(f)
        except:
            continue
        
        # Skip if already has strikePrice
        if product.get('strikePrice') and product['strikePrice'] > 0:
            skipped += 1
            continue
        
        # Skip if no subscription date
        sub_date = product.get('subscriptionDate') or product.get('addedDate')
        if not sub_date:
            continue
        
        # Skip if no underlyings (rate products)
        underlyings = product.get('underlyings', [])
        if not underlyings:
            continue
        
        # Skip liquidity / cash products
        name = (product.get('name', '') or '').lower()
        if 'bond 12m' in name or 'compartiment' in name or 'fonds mon' in name:
            continue
        
        print(f'\n\u2192 {product.get("name", "?")[:50]}')
        print(f'  Date souscription: {sub_date}')
        print(f'  Sous-jacents: {", ".join(underlyings[:3])}')
        
        # Fetch strike for the first underlying (worst-of: each has its own, but we store the primary)
        uj = underlyings[0]
        symbol, sym_type = get_twelve_data_symbol(uj, stocks_data)
        
        if not symbol:
            print(f'  \u274c No symbol found for "{uj}"')
            failed += 1
            continue
        
        print(f'  Symbol: {symbol} ({sym_type})')
        
        # Fetch historical close
        result = fetch_historical_close(symbol, sub_date)
        
        if result:
            product['strikePrice'] = result['price']
            product['_strikePriceDate'] = result['date']
            product['_strikePriceSource'] = f'twelve_data:{symbol}'
            product['_strikePriceOpen'] = result['open']
            product['_strikePriceRequested'] = result['requested_date']
            
            # Save back
            with open(pf, 'w') as f:
                json.dump(product, f, indent=2, ensure_ascii=False)
            
            print(f'  \u2705 Strike = {result["price"]} (close on {result["date"]}, requested {result["requested_date"]})')
            print(f'     OHLC: O={result["open"]} H={result["high"]} L={result["low"]} C={result["price"]}')
            updated += 1
        else:
            print(f'  \u274c No historical data for {symbol} @ {sub_date}')
            failed += 1
        
        # Rate limit
        time.sleep(1)
    
    print(f'\n{"\u2550" * 60}')
    print(f'Strike prices: {updated} updated, {skipped} already set, {failed} failed')
    print(f'{"\u2550" * 60}')

if __name__ == '__main__':
    main()

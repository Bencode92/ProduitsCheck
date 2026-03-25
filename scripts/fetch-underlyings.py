#!/usr/bin/env python3
"""
Fetch real metrics for underlying proxies via Twelve Data API.
Reads underlying-map.json, calls API for each unique proxy ticker,
computes: vol_3y, max_dd_3y, perf_ytd, perf_1y, perf_3m, beta vs SPY.
Outputs: data/market/underlyings_extra.json
"""

import json, os, sys, math, time
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

API_KEY = os.environ.get('TWELVE_DATA_API_KEY', '')
BASE = 'https://api.twelvedata.com'
OUT = 'data/market/underlyings_extra.json'

def api_get(endpoint, params):
    params['apikey'] = API_KEY
    qs = '&'.join(f'{k}={v}' for k, v in params.items())
    url = f'{BASE}/{endpoint}?{qs}'
    try:
        req = Request(url, headers={'User-Agent': 'StructBoard/1.0'})
        with urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f'  \u26a0 API error {endpoint} {params.get("symbol","?")}: {e}')
        return None

def fetch_time_series(symbol, days=756):
    """Fetch daily closes for ~3 years."""
    start = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    data = api_get('time_series', {
        'symbol': symbol,
        'interval': '1day',
        'start_date': start,
        'outputsize': '756'
    })
    if not data or data.get('status') == 'error' or 'values' not in data:
        return None
    return data['values']

def compute_metrics(values, bench_values=None):
    """Compute vol, DD, perfs, beta from daily OHLCV."""
    if not values or len(values) < 22:
        return None
    
    # Sort oldest first
    vals = sorted(values, key=lambda x: x['datetime'])
    closes = [float(v['close']) for v in vals if float(v['close']) > 0]
    dates = [v['datetime'] for v in vals]
    
    if len(closes) < 22:
        return None
    
    last = closes[-1]
    
    # Perf YTD
    year = datetime.now().strftime('%Y')
    first_of_year = None
    for i, d in enumerate(dates):
        if d.startswith(year):
            first_of_year = closes[i]
            break
    perf_ytd = ((last / first_of_year) - 1) * 100 if first_of_year and first_of_year > 0 else None
    
    # Perf 1Y (252 trading days)
    perf_1y = ((last / closes[-252]) - 1) * 100 if len(closes) > 252 else None
    
    # Perf 3M (63 trading days)
    perf_3m = ((last / closes[-63]) - 1) * 100 if len(closes) > 63 else None
    
    # Vol 3Y (annualized from log returns)
    n = min(len(closes), 756)
    slice_c = closes[-n:]
    rets = [math.log(slice_c[i] / slice_c[i-1]) for i in range(1, len(slice_c)) if slice_c[i-1] > 0]
    vol_3y = None
    if len(rets) > 20:
        mean_r = sum(rets) / len(rets)
        var_r = sum((r - mean_r)**2 for r in rets) / (len(rets) - 1)
        vol_3y = round(math.sqrt(var_r) * math.sqrt(252) * 100, 2)
    
    # Max Drawdown 3Y
    peak = slice_c[0]
    max_dd = 0
    for p in slice_c:
        if p > peak:
            peak = p
        dd = (peak - p) / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd
    max_dd_3y = round(max_dd, 2)
    
    # Beta vs SPY (if benchmark provided)
    beta = None
    if bench_values and len(bench_values) > 22:
        bench_sorted = sorted(bench_values, key=lambda x: x['datetime'])
        bench_map = {v['datetime']: float(v['close']) for v in bench_sorted if float(v['close']) > 0}
        # Align by date
        aligned = []
        for i, v in enumerate(vals):
            if v['datetime'] in bench_map and float(v['close']) > 0:
                aligned.append((float(v['close']), bench_map[v['datetime']]))
        
        if len(aligned) > 60:
            # Use last 252 aligned points
            al = aligned[-253:]
            a_rets = [(al[i][0] / al[i-1][0] - 1) for i in range(1, len(al)) if al[i-1][0] > 0]
            b_rets = [(al[i][1] / al[i-1][1] - 1) for i in range(1, len(al)) if al[i-1][1] > 0]
            if len(a_rets) == len(b_rets) and len(a_rets) > 20:
                m_a = sum(a_rets) / len(a_rets)
                m_b = sum(b_rets) / len(b_rets)
                cov = sum((a_rets[i] - m_a) * (b_rets[i] - m_b) for i in range(len(a_rets))) / len(a_rets)
                var_b = sum((b_rets[i] - m_b)**2 for i in range(len(b_rets))) / len(b_rets)
                if var_b > 0:
                    beta = round(cov / var_b, 2)
                    if abs(beta) > 10:
                        beta = None
    
    return {
        'perf_ytd': round(perf_ytd, 2) if perf_ytd is not None else None,
        'perf_1y': round(perf_1y, 2) if perf_1y is not None else None,
        'perf_3m': round(perf_3m, 2) if perf_3m is not None else None,
        'vol_3y': vol_3y,
        'max_dd_3y': max_dd_3y,
        'beta': beta,
        'last_close': round(last, 4),
        'data_points': len(closes),
    }

def main():
    if not API_KEY:
        print('\u26a0 TWELVE_DATA_API_KEY not set, skipping underlyings fetch')
        # Write empty file so downstream doesn't fail
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'w') as f:
            json.dump({'timestamp': datetime.now().isoformat(), 'tickers': {}}, f)
        return
    
    # Load underlying map
    map_path = 'data/underlying-map.json'
    if not os.path.exists(map_path):
        print(f'\u26a0 {map_path} not found')
        return
    
    with open(map_path) as f:
        umap = json.load(f)
    
    # Collect unique proxy tickers
    tickers = set()
    for entry in (umap.get('indices', {}) or {}).values():
        if entry.get('proxy'):
            tickers.add(entry['proxy'])
    # Add commodity proxies (GLD, SLV for real data)
    commodity_etfs = {
        'gold_usd': 'GLD',
        'silver_usd': 'SLV',
        'brent_usd': 'USO',
    }
    for etf in commodity_etfs.values():
        tickers.add(etf)
    
    # Always include SPY as benchmark
    tickers.add('SPY')
    
    print(f'\U0001f4ca Fetching {len(tickers)} proxy tickers from Twelve Data...')
    
    # Fetch SPY first (benchmark for beta)
    print(f'  \U0001f4c8 Fetching benchmark SPY...')
    spy_values = fetch_time_series('SPY')
    if spy_values:
        print(f'  \u2705 SPY: {len(spy_values)} data points')
    else:
        print(f'  \u26a0 SPY fetch failed, beta will be null')
    
    results = {}
    for ticker in sorted(tickers):
        print(f'  \U0001f50d {ticker}...', end=' ')
        values = fetch_time_series(ticker) if ticker != 'SPY' else spy_values
        if not values:
            print('\u274c no data')
            continue
        
        metrics = compute_metrics(values, spy_values if ticker != 'SPY' else None)
        if metrics:
            results[ticker] = metrics
            print(f'\u2705 vol={metrics["vol_3y"]}% dd={metrics["max_dd_3y"]}% ytd={metrics["perf_ytd"]}% beta={metrics["beta"]}')
        else:
            print('\u26a0 insufficient data')
        
        # Rate limit: Twelve Data free = 8 calls/min, paid = more
        time.sleep(1)
    
    # Map commodity ETFs back to macro_key
    commodity_metrics = {}
    for macro_key, etf in commodity_etfs.items():
        if etf in results:
            commodity_metrics[macro_key] = {
                'proxy_etf': etf,
                **results[etf]
            }
    
    output = {
        'timestamp': datetime.now().isoformat(),
        'tickers': results,
        'commodity_metrics': commodity_metrics,
        'benchmark': 'SPY',
        'data_source': 'twelve_data',
    }
    
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(output, f, indent=2)
    
    sz = os.path.getsize(OUT)
    print(f'\n\u2705 {len(results)} tickers enriched \u2192 {OUT} ({sz:,} bytes)')
    print(f'   Commodities: {list(commodity_metrics.keys())}')

if __name__ == '__main__':
    main()

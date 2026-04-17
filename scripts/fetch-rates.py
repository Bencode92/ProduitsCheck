#!/usr/bin/env python3
"""Fetch sovereign yields + ECB rates.
Primary: ECB Statistical Data Warehouse (free, no key).
Fallback: Twelve Data API (for yields if ECB fails).
Outputs data/market/rates.json.
"""
import json, csv, io, sys, os, statistics
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError

BASE_ECB = "https://data-api.ecb.europa.eu/service/data"
TD_API_KEY = os.environ.get("TWELVE_DATA_API_KEY", "")

# ─── ECB API endpoints (updated 2026) ─────────────────────────
# ECB SDW changed series keys — using confirmed working ones
RATE_SERIES = {
    "oat_fr_10y": {
        "ecb_url": f"{BASE_ECB}/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&startPeriod=2004-01",
        "td_symbol": None,  # No direct OAT on TD
        "name": "Euro Area AAA 10Y Yield",
        "tec_equivalent": "TEC 10",
        "description": "Rendement zone euro AAA 10 ans (proxy TEC 10)",
        "freq": "monthly"
    },
    "bund_de_10y": {
        "ecb_url": f"{BASE_ECB}/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&startPeriod=2004-01",
        "td_symbol": None,
        "name": "Euro Area AAA 10Y Yield",
        "description": "Rendement zone euro AAA 10 ans",
        "freq": "monthly"
    },
    "oat_fr_2y": {
        "ecb_url": f"{BASE_ECB}/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y?format=csvdata&startPeriod=2004-01",
        "td_symbol": None,
        "name": "Euro Area AAA 2Y Yield",
        "description": "Rendement zone euro AAA 2 ans",
        "freq": "monthly"
    },
    "oat_fr_5y": {
        "ecb_url": f"{BASE_ECB}/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_5Y?format=csvdata&startPeriod=2004-01",
        "td_symbol": None,
        "name": "Euro Area AAA 5Y Yield",
        "description": "Rendement zone euro AAA 5 ans",
        "freq": "monthly"
    },
}

DAILY_RATES = {
    "ecb_main_rate": {
        "ecb_url": f"{BASE_ECB}/FM/D.U2.EUR.4F.KR.MRR_FR.LEV?format=csvdata&lastNObservations=1",
        "name": "ECB Main Refinancing Rate",
        "description": "Taux directeur BCE"
    },
    "ecb_deposit_rate": {
        "ecb_url": f"{BASE_ECB}/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata&lastNObservations=1",
        "name": "ECB Deposit Facility Rate",
        "description": "Taux de dépôt BCE"
    },
}

# Euribor avec historique complet (comme les yields)
RATE_SERIES["euribor_3m"] = {
    "ecb_url": f"{BASE_ECB}/FM/M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA?format=csvdata&startPeriod=2000-01",
    "td_symbol": None,
    "name": "Euribor 3M",
    "description": "Taux interbancaire euro 3 mois (moyenne mensuelle)",
    "freq": "monthly"
}
RATE_SERIES["euribor_6m"] = {
    "ecb_url": f"{BASE_ECB}/FM/M.U2.EUR.RT.MM.EURIBOR6MD_.HSTA?format=csvdata&startPeriod=2000-01",
    "td_symbol": None,
    "name": "Euribor 6M",
    "description": "Taux interbancaire euro 6 mois (moyenne mensuelle)",
    "freq": "monthly"
}

# Twelve Data fallback tickers for yields
TD_YIELD_PROXIES = {
    "us_10y": {"symbol": "US10Y", "name": "US Treasury 10Y"},
    "us_2y": {"symbol": "US02Y", "name": "US Treasury 2Y"},
    "de_10y": {"symbol": "DE10Y", "name": "Germany 10Y Bund"},
}


def fetch_ecb_csv(url, timeout=15):
    """Fetch ECB CSV data. Returns list of (date, value) tuples."""
    try:
        req = Request(url, headers={"Accept": "text/csv", "User-Agent": "StructBoard/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(text))
        results = []
        for row in reader:
            date = row.get("TIME_PERIOD", row.get("TIME", ""))
            val = row.get("OBS_VALUE", "")
            if date and val:
                try:
                    results.append((date, float(val)))
                except ValueError:
                    pass
        return results
    except (URLError, Exception) as e:
        print(f"  ⚠ ECB fetch failed: {e}", file=sys.stderr)
        return []


def fetch_td_quote(symbol, timeout=10):
    """Fetch a quote from Twelve Data. Returns (date, value) or None."""
    if not TD_API_KEY:
        return None
    try:
        url = f"https://api.twelvedata.com/quote?symbol={symbol}&apikey={TD_API_KEY}"
        req = Request(url, headers={"User-Agent": "StructBoard/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        if data.get("status") == "error":
            return None
        close = float(data.get("close", 0))
        date = data.get("datetime", "")
        if close > 0:
            return (date, close)
    except Exception as e:
        print(f"  ⚠ TD fetch {symbol}: {e}", file=sys.stderr)
    return None


def compute_stats(observations):
    """Compute stats from time series."""
    if not observations:
        return None
    values = [v for _, v in observations]
    current = values[-1]
    stats = {
        "current": round(current, 3),
        "date": observations[-1][0],
        "high_1y": round(max(values[-12:]) if len(values) >= 12 else max(values), 3),
        "low_1y": round(min(values[-12:]) if len(values) >= 12 else min(values), 3),
        "avg_1y": round(statistics.mean(values[-12:]) if len(values) >= 12 else statistics.mean(values), 3),
        "observations": len(values),
    }
    if len(values) >= 6:
        changes = [(values[i] - values[i-1]) for i in range(1, len(values))]
        monthly_std = statistics.stdev(changes) if len(changes) > 1 else 0
        stats["vol_annualized_bps"] = round(monthly_std * (12 ** 0.5) * 100, 1)
        stats["vol_annualized_pct"] = round(monthly_std * (12 ** 0.5) / current * 100, 1) if current > 0 else 0
        recent = statistics.mean(values[-3:])
        previous = statistics.mean(values[-6:-3])
        diff = recent - previous
        stats["direction"] = "rising" if diff > 0.15 else ("falling" if diff < -0.15 else "stable")
        stats["change_3m_bps"] = round(diff * 100, 1)
    else:
        stats["direction"] = "unknown"
    # Smart history: daily for last 6 months, sampled for older (keeps file size manageable)
    full_hist = [{"date": d, "value": round(v, 3)} for d, v in observations]
    if len(full_hist) > 130:
        recent = full_hist[-130:]  # last ~6 months daily
        older = full_hist[:-130]
        # Sample every 10 for very old data (>2 years), every 5 for medium
        if len(older) > 500:
            very_old = older[:len(older)-250]
            medium = older[len(older)-250:]
            sampled = [very_old[i] for i in range(0, len(very_old), 10)]
            sampled += [medium[i] for i in range(0, len(medium), 5)]
        else:
            sampled = [older[i] for i in range(0, len(older), 5)]
        stats["history"] = sampled + recent
    else:
        stats["history"] = full_hist
    return stats


def main():
    print("═" * 60)
    print("StructBoard — Rate Data Fetch (ECB + Twelve Data fallback)")
    print("═" * 60)

    output = {
        "source": "ECB + Twelve Data",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "yields": {},
        "policy_rates": {},
        "yield_curve": {},
    }

    # ─── Fetch monthly yield series (ECB primary) ───
    for key, config in RATE_SERIES.items():
        print(f"\n→ {config['name']}...")
        obs = fetch_ecb_csv(config["ecb_url"])
        if not obs and config.get("td_symbol"):
            print(f"  ↳ Trying Twelve Data fallback: {config['td_symbol']}")
            td = fetch_td_quote(config["td_symbol"])
            if td:
                obs = [td]
        stats = compute_stats(obs)
        if stats:
            stats["name"] = config["name"]
            stats["description"] = config["description"]
            if "tec_equivalent" in config:
                stats["tec_equivalent"] = config["tec_equivalent"]
            output["yields"][key] = stats
            print(f"  ✓ {config['name']}: {stats['current']}%")
        else:
            print(f"  ✗ No data for {config['name']}")

    # ─── Fetch daily policy rates (ECB) ───
    for key, config in DAILY_RATES.items():
        print(f"\n→ {config['name']}...")
        obs = fetch_ecb_csv(config["ecb_url"])
        if not obs and config.get("td_symbol"):
            td = fetch_td_quote(config["td_symbol"])
            if td:
                obs = [td]
        if obs:
            date, value = obs[-1]
            output["policy_rates"][key] = {
                "name": config["name"],
                "description": config["description"],
                "current": round(value, 3),
                "date": date,
            }
            print(f"  ✓ {config['name']}: {value}%")
        else:
            print(f"  ✗ No data for {config['name']}")

    # ─── Twelve Data yield proxies (always try if key available) ───
    if TD_API_KEY:
        print(f"\n→ Twelve Data yield proxies...")
        for key, config in TD_YIELD_PROXIES.items():
            td = fetch_td_quote(config["symbol"])
            if td:
                output["yields"][key] = {
                    "name": config["name"],
                    "current": round(td[1], 3),
                    "date": td[0],
                    "source": "twelve_data",
                }
                print(f"  ✓ {config['name']}: {td[1]}%")

    # ─── Build yield curve ───
    curve_points = []
    for key, maturity in [("oat_fr_2y", 2), ("oat_fr_5y", 5), ("oat_fr_10y", 10)]:
        if key in output["yields"]:
            curve_points.append({"maturity": maturity, "yield": output["yields"][key]["current"]})
    # Fallback: US curve if EUR not available
    if len(curve_points) < 2:
        for key, maturity in [("us_2y", 2), ("us_10y", 10)]:
            if key in output["yields"]:
                curve_points.append({"maturity": maturity, "yield": output["yields"][key]["current"]})
    if len(curve_points) >= 2:
        output["yield_curve"] = {
            "points": curve_points,
            "spread_2_10": round(curve_points[-1]["yield"] - curve_points[0]["yield"], 3),
            "shape": "normal" if curve_points[-1]["yield"] > curve_points[0]["yield"] else "inverted",
        }

    # ─── Write output ───
    outpath = "data/market/rates.json"
    os.makedirs(os.path.dirname(outpath), exist_ok=True)
    with open(outpath, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    sz = os.path.getsize(outpath)
    n_yields = len(output["yields"])
    n_rates = len(output["policy_rates"])
    print(f"\n{'═' * 60}")
    print(f"Output: {outpath} ({sz:,} bytes)")
    print(f"Yields: {n_yields}, Policy rates: {n_rates}")
    print(f"{'═' * 60}")


if __name__ == "__main__":
    main()

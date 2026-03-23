#!/usr/bin/env python3
"""Fetch sovereign yields + ECB rates from ECB Statistical Data Warehouse.
Free API, no key required. Outputs data/market/rates.json.

Rate references for structured products:
  TEC 10 ≈ OAT France 10Y yield
  CMS 10Y ≈ EUR swap rate 10Y (proxy: Bund + spread)
  Euribor 3M/6M = ECB interbank rates
"""
import json, csv, io, sys, statistics
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError

BASE = "https://data-api.ecb.europa.eu/service/data"

# ─── ECB API endpoints ─────────────────────────────────────────
RATE_SERIES = {
    # Monthly yields (last 24 months for vol calculation)
    "oat_fr_10y": {
        "url": f"{BASE}/FM/M.FR.EUR.FR2.BB.FR10YT_RR.YLDA?format=csvdata&lastNObservations=24",
        "name": "OAT France 10Y",
        "tec_equivalent": "TEC 10",
        "description": "Rendement OAT françaises 10 ans (≈ TEC 10)",
        "freq": "monthly"
    },
    "bund_de_10y": {
        "url": f"{BASE}/FM/M.DE.EUR.FR2.BB.DE10YT_RR.YLDA?format=csvdata&lastNObservations=24",
        "name": "Bund Germany 10Y",
        "description": "Rendement Bund allemand 10 ans (référence zone euro)",
        "freq": "monthly"
    },
    "oat_fr_2y": {
        "url": f"{BASE}/FM/M.FR.EUR.FR2.BB.FR2YT_RR.YLDA?format=csvdata&lastNObservations=24",
        "name": "OAT France 2Y",
        "description": "Rendement OAT françaises 2 ans (court terme)",
        "freq": "monthly"
    },
    "oat_fr_5y": {
        "url": f"{BASE}/FM/M.FR.EUR.FR2.BB.FR5YT_RR.YLDA?format=csvdata&lastNObservations=24",
        "name": "OAT France 5Y",
        "description": "Rendement OAT françaises 5 ans",
        "freq": "monthly"
    },
}

# Daily rates (last observation only)
DAILY_RATES = {
    "ecb_main_rate": {
        "url": f"{BASE}/FM/D.U2.EUR.4F.KR.MRR_FR.LEV?format=csvdata&lastNObservations=1",
        "name": "ECB Main Refinancing Rate",
        "description": "Taux directeur BCE"
    },
    "euribor_3m": {
        "url": f"{BASE}/FM/D.U2.EUR.RT.MM.EURIBOR3MD_.HSTA?format=csvdata&lastNObservations=1",
        "name": "Euribor 3M",
        "description": "Taux interbancaire euro 3 mois"
    },
    "euribor_6m": {
        "url": f"{BASE}/FM/D.U2.EUR.RT.MM.EURIBOR6MD_.HSTA?format=csvdata&lastNObservations=1",
        "name": "Euribor 6M",
        "description": "Taux interbancaire euro 6 mois"
    },
}


def fetch_csv(url, timeout=15):
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
        print(f"  ⚠ Failed to fetch {url}: {e}", file=sys.stderr)
        return []


def compute_stats(observations):
    """Compute stats from time series: current, high, low, avg, vol, direction."""
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
    
    # Volatility: annualized std of monthly changes
    if len(values) >= 6:
        changes = [(values[i] - values[i-1]) for i in range(1, len(values))]
        monthly_std = statistics.stdev(changes) if len(changes) > 1 else 0
        stats["vol_annualized_bps"] = round(monthly_std * (12 ** 0.5) * 100, 1)  # in basis points
        stats["vol_annualized_pct"] = round(monthly_std * (12 ** 0.5) / current * 100, 1) if current > 0 else 0
    
    # Direction: compare last 3 months avg to previous 3 months
    if len(values) >= 6:
        recent = statistics.mean(values[-3:])
        previous = statistics.mean(values[-6:-3])
        diff = recent - previous
        if diff > 0.15:
            stats["direction"] = "rising"
        elif diff < -0.15:
            stats["direction"] = "falling"
        else:
            stats["direction"] = "stable"
        stats["change_3m_bps"] = round(diff * 100, 1)
    else:
        stats["direction"] = "unknown"
    
    # History (last 12 months for charting)
    stats["history"] = [{"date": d, "value": round(v, 3)} for d, v in observations[-12:]]
    
    return stats


def main():
    print("═" * 60)
    print("StructBoard — ECB Rate Data Fetch")
    print("═" * 60)
    
    output = {
        "source": "ECB Statistical Data Warehouse",
        "fetched_at": datetime.utcnow().isoformat() + "Z",
        "yields": {},
        "policy_rates": {},
        "yield_curve_fr": {},
    }
    
    # ─── Fetch monthly yield series ───
    for key, config in RATE_SERIES.items():
        print(f"\n→ {config['name']}...")
        obs = fetch_csv(config["url"])
        stats = compute_stats(obs)
        if stats:
            stats["name"] = config["name"]
            stats["description"] = config["description"]
            if "tec_equivalent" in config:
                stats["tec_equivalent"] = config["tec_equivalent"]
            output["yields"][key] = stats
            print(f"  ✓ {config['name']}: {stats['current']}% (range {stats['low_1y']}-{stats['high_1y']}%, dir: {stats.get('direction', '?')})")
        else:
            print(f"  ✗ No data for {config['name']}")
    
    # ─── Fetch daily policy rates ───
    for key, config in DAILY_RATES.items():
        print(f"\n→ {config['name']}...")
        obs = fetch_csv(config["url"])
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
    
    # ─── Build French yield curve ───
    curve_points = []
    for key, maturity in [("oat_fr_2y", 2), ("oat_fr_5y", 5), ("oat_fr_10y", 10)]:
        if key in output["yields"]:
            curve_points.append({
                "maturity": maturity,
                "yield": output["yields"][key]["current"],
            })
    if len(curve_points) >= 2:
        output["yield_curve_fr"] = {
            "points": curve_points,
            "spread_2_10": round(curve_points[-1]["yield"] - curve_points[0]["yield"], 3) if len(curve_points) >= 2 else None,
            "shape": "normal" if curve_points[-1]["yield"] > curve_points[0]["yield"] else "inverted",
        }
        print(f"\n→ Yield curve FR: {output['yield_curve_fr']['shape']} (2-10 spread: {output['yield_curve_fr']['spread_2_10']}%)")
    
    # ─── Grading helper: pre-computed risk assessment ───
    fr10 = output["yields"].get("oat_fr_10y", {})
    ecb_rate = output["policy_rates"].get("ecb_main_rate", {}).get("current")
    
    if fr10:
        # For TEC 10 products: assess probability that TEC stays below threshold
        current_tec = fr10.get("current", 3.5)
        vol_bps = fr10.get("vol_annualized_bps", 80)
        direction = fr10.get("direction", "stable")
        
        output["grading_context"] = {
            "tec_10": {
                "current": current_tec,
                "vol_annual_pct": fr10.get("vol_annualized_pct", 15),
                "vol_annual_bps": vol_bps,
                "direction": direction,
                "range_1y": f"{fr10.get('low_1y', 0)}-{fr10.get('high_1y', 0)}%",
                "ecb_rate": ecb_rate,
                "risk_assessment": "hawkish" if direction == "rising" else ("dovish" if direction == "falling" else "neutral"),
                "comment": f"TEC 10 à {current_tec}%, tendance {direction}. Vol annuelle ~{vol_bps}bps. BCE à {ecb_rate}%."
            }
        }
        print(f"\n✓ Grading context: TEC 10 = {current_tec}%, vol {vol_bps}bps, {direction}")
    
    # ─── Write output ───
    outpath = "data/market/rates.json"
    with open(outpath, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    import os
    sz = os.path.getsize(outpath)
    n_yields = len(output["yields"])
    n_rates = len(output["policy_rates"])
    print(f"\n{'═' * 60}")
    print(f"Output: {outpath} ({sz:,} bytes)")
    print(f"Yields: {n_yields}, Policy rates: {n_rates}")
    print(f"{'═' * 60}")


if __name__ == "__main__":
    main()

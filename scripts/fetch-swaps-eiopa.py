#!/usr/bin/env python3
"""Courbe des taux SWAP euro — source officielle, gratuite, mensuelle.

Pourquoi EIOPA : la BCE ne publie aucune courbe swap, la Banque de France non plus
(vérifié 23/09/2026 — sa seule série Euribor quotidienne s'arrête au 04/07/2024).
EIOPA, en revanche, publie chaque mois la « risk-free interest rate term structure »
que les assureurs utilisent pour Solvabilité II, et cette courbe EST construite sur
les taux swap du marché (colonne « EUR_..._SWP_LLP »), diminués d'un ajustement pour
risque de crédit (CRA) de 10 bp. On rajoute le CRA pour retrouver le swap brut.

C'est la courbe que la salle des marchés utilise pour actualiser les flux d'un
produit structuré — et donc le seul repère honnête pour juger un coupon.
Jusqu'à la LLP (20 ans) c'est de la donnée de marché ; au-delà c'est extrapolé
vers l'UFR, donc non utilisé ici.

Sortie : data/market/swaps.json
"""
import io, json, os, re, sys, zipfile
from datetime import datetime, timezone
from urllib.request import urlopen, Request

PAGE = "https://www.eiopa.europa.eu/tools-and-data/risk-free-interest-rate-term-structures_en"
BASE = "https://www.eiopa.europa.eu/"
UA = {"User-Agent": "Mozilla/5.0 (StructBoard)"}
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "market", "swaps.json")
MATURITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20]
LLP = 20  # Last Liquid Point : au-delà, EIOPA extrapole — on ne publie pas.


def latest_rfr_url():
    with urlopen(Request(PAGE, headers=UA), timeout=60) as r:
        html = r.read().decode("utf-8", "ignore")
    hits = re.findall(r'document/download/([a-f0-9-]{36})_en\?filename=(EIOPA_RFR_(\d{8})\.zip)', html)
    if not hits:
        raise RuntimeError("aucun lien EIOPA_RFR trouvé sur la page")
    uid, fname, date = max(hits, key=lambda h: h[2])
    return BASE + f"document/download/{uid}_en?filename={fname}", date


def eur_curve(zbytes):
    """Extrait la colonne Euro de la feuille RFR_spot_no_VA, sans openpyxl
    (xlsx = zip de XML : on lit la feuille et la table de chaînes partagées)."""
    zf = zipfile.ZipFile(io.BytesIO(zbytes))
    xlsx = next(n for n in zf.namelist() if n.endswith("_Term_Structures.xlsx"))
    wb = zipfile.ZipFile(io.BytesIO(zf.read(xlsx)))

    names = re.findall(r'<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"', wb.read("xl/workbook.xml").decode("utf8", "ignore"))
    # Les attributs de <Relationship> ne sont PAS dans un ordre garanti (Target avant Id chez
    # EIOPA) : on parse chaque balise et on extrait Id et Target indépendamment.
    rels = {}
    for tag in re.findall(r'<Relationship\b[^>]*/>', wb.read("xl/_rels/workbook.xml.rels").decode("utf8", "ignore")):
        rid = re.search(r'Id="([^"]+)"', tag)
        tgt = re.search(r'Target="([^"]+)"', tag)
        if rid and tgt: rels[rid.group(1)] = tgt.group(1)
    rid = next((r for nm, r in names if nm == "RFR_spot_no_VA"), None)
    if rid is None or rid not in rels:
        raise RuntimeError("feuille RFR_spot_no_VA introuvable")
    target = rels[rid].lstrip("/")
    xml = wb.read(target if target.startswith("xl/") else "xl/" + target).decode("utf8", "ignore")

    # Colonne C = Euro (vérifié : ligne 2 = "Euro", ligne 3 = "EUR_..._SWP_LLP").
    # Lignes 11+ = maturité 1, 2, 3 … en années ; valeurs en décimal (0.03268 = 3,268 %).
    cells = dict(re.findall(r'<c r="C(\d+)"[^>]*>(?:<f[^>]*/?>(?:[^<]*</f>)?)?<v>([^<]*)</v>', xml))
    # CRA : ligne 9 de la colonne Euro, en points de base
    try: cra = float(cells.get("9", "10"))
    except ValueError: cra = 10.0

    curve = {}
    for m in MATURITIES:
        if m > LLP: continue
        raw = cells.get(str(10 + m))          # ligne 11 = maturité 1
        if raw is None: continue
        try: spot = float(raw) * 100
        except ValueError: continue
        # RFR = swap − CRA → on rajoute le CRA pour retrouver le swap coté
        curve[f"{m}y"] = round(spot + cra / 100, 4)
    return curve, cra


def main():
    print("→ Courbe swap EUR (EIOPA, dérivée des taux swap du marché)…")
    url, date = latest_rfr_url()
    print(f"  fichier : EIOPA_RFR_{date}.zip")
    with urlopen(Request(url, headers=UA), timeout=180) as r:
        blob = r.read()
    print(f"  {len(blob):,} octets")
    curve, cra = eur_curve(blob)
    if not curve:
        print("  ✗ courbe vide — structure du fichier modifiée ?", file=sys.stderr)
        sys.exit(1)

    out = {
        "source": "EIOPA Risk-Free Rate term structures (courbe swap EUR, SWP_LLP)",
        "source_url": PAGE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "as_of": f"{date[:4]}-{date[4:6]}-{date[6:]}",
        "frequency": "mensuelle (publiée ~5 jours après la fin du mois)",
        "credit_risk_adjustment_bps": cra,
        "note": ("Courbe swap euro zéro-coupon. EIOPA publie RFR = swap − CRA ; le CRA est "
                 "rajouté ici pour retrouver le taux swap coté. Fiable jusqu'à 20 ans (Last "
                 "Liquid Point) ; au-delà EIOPA extrapole vers l'UFR, non publié ici. "
                 "Le CMS n ans se lit sur cette courbe au point n."),
        "swap_eur": curve,
    }
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(os.path.abspath(OUT), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    for k in ["1y", "2y", "5y", "10y", "20y"]:
        if k in curve: print(f"  ✓ swap {k:>3} : {curve[k]:.3f} %")
    print(f"  → {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()

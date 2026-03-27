# StructBoard Grader v5.2 — Changelog

## Résumé
3 améliorations + 1 fix corrélation worst-of.

## Comment appliquer
```bash
node patch-grader-v52.js
git diff js/proposal-grader-v5.js
# tester sur les 4 produits
git add . && git commit -m "[StructBoard] grader v5.2" && git push
```

## 1. Probabilités calibrées (P0)
Table historique SX5E/CAC 2000-2024 remplace les formules ad hoc.
Interpolation bilinéaire sur barrier% × maturité.

## 2. Pénalité barrière σ-based (P1)
Remplace `score × (1-((barrier-30)/50)²)` par :
`penalty = min(1.0, 0.15 + 0.85 × (1 - exp(-σ/1.8)))`
Élimine le cliff effect, utilise la vol réelle.

## 3. Dégradation CDS progressive (P1)
Remplace seuil binaire 100bps → -5pts/20bps au-dessus de 60bps (max -25).

## 4. Exposant worst-of corrélé
`exp = 1 + (n-1) × (1 - corrMoyenne)` remplace sqrt(n) et pénalité linéaire.

## Grades attendus v5.2
| Produit | v5.1 | v5.2 attendu |
|---------|------|--------------|
| Dispersion FAANG | B(65) | B(63-67) |
| Gold Miners | B(64) | B-(58-64) |
| Taux Fixe Callable | C(45) | C(43-47) |
| Digitale WO LVMH/ACA | C+(~60) | C(50-58) |

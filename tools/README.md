# tools/grader-filet.cjs — Filet de test du grader (hors navigateur)

Note les produits structurés **hors navigateur, IA coupée**, de façon **déterministe**.
Sert de garde-fou anti-régression avant de toucher au moteur de grading.

## Usage
```bash
cd ~/ProduitsCheck
node tools/grader-filet.cjs            # note les 53 produits, écrit tools/grader-baseline.json
PC_LIMIT=5 node tools/grader-filet.cjs # limite à 5 produits (debug rapide)
```

## Anti-régression
```bash
cp tools/grader-baseline.json /tmp/avant.json   # avant une modif du grader
# ... modifier js/proposal-grader-v7.js etc ...
node tools/grader-filet.cjs                       # régénère
diff /tmp/avant.json tools/grader-baseline.json   # ce qui a bougé (attendu : SEULEMENT les types ciblés)
```

Charge la chaîne de grading (config → scoring → v5 → patches → v7 → p4-netfees → barrier-distance)
dans un contexte `vm`, stubbe `github`(→fichiers locaux)/`fetch`(→IA off)/`app`/DOM, draine les
`setInterval` pour appliquer les patches. IA coupée = note de base déterministe (pas d'ajustement Claude).

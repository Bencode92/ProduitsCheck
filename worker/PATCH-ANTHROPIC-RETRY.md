# 🔧 Patch Worker — Retry Anthropic (corrige le mode « Local » intermittent)

> **But** : quand l'API Anthropic renvoie une erreur transitoire (**529 overloaded**, 429, 5xx),
> le grader tombait en mode « Local » **en silence**. Ce patch fait **3 tentatives** avec un
> **timeout de 12 s** par essai → l'IA passe au 2ᵉ/3ᵉ coup au lieu de lâcher.

---

## ⚠️ AVANT DE COMMENCER — À LIRE

1. **NE colle PAS** le fichier `worker/worker.js` du repo ProduitsCheck.
   Ton worker déployé (`studyforge-proxy`) est un **gros worker partagé** (bordereaux + Notion +
   dispos + GitHub + TwelveData + BdF + Gemini + Anthropic). Le `worker.js` du repo est une vieille
   copie de référence incomplète — la coller **effacerait tout ton système bordereaux**.

2. Tu ne modifies **qu'UN SEUL bloc**. Rien d'autre ne bouge.

3. Où éditer :
   - **Option rapide** : Cloudflare → Workers & Pages → `studyforge-proxy` → **Edit code**.
   - **Option durable** : le **fichier source** de ce worker (dans ton projet bordereaux/studyforge).
     ⚠️ Si tu édites seulement dans le dashboard, un futur `wrangler deploy` **écrasera** la modif.
     Idéalement, fais la modif dans la source **et** redéploie.

---

## Étape 1 — TROUVER le bloc à remplacer

Dans le code du worker, cherche (Ctrl+F / Cmd+F) :

```
api.anthropic.com/v1/messages
```

Il apparaît **tout à la fin** du `fetch`, dans ce bloc (le catch-all POST). C'est **CE bloc-là**,
celui qui commence par `if (request.method === "POST")` :

```js
    if (request.method === "POST") {
      const body = await request.text();
      if (!body) return json({ error: "No body" }, 400);
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body
      });
      return new Response(await resp.text(), { status: resp.status, headers: JSON_H });
    }
```

> 💡 Il y a un **autre** appel à `api.anthropic.com` nulle part ailleurs — celui-ci est **unique**.
> Repère-toi au `if (request.method === "POST")` juste au-dessus de `const body = await request.text();`.

---

## Étape 2 — REMPLACER par ce bloc

Sélectionne **tout le bloc du dessus** (de `if (request.method === "POST") {` jusqu'à sa `}` fermante)
et colle **exactement** ceci à la place :

```js
    if (request.method === "POST") {
      const body = await request.text();
      if (!body) return json({ error: "No body" }, 400);
      // Retry sur erreurs transitoires d'Anthropic (429 rate-limit, 529 overloaded, 5xx)
      // + timeout 12s/tentative. Sans ça, un 529 repassait tel quel → front en "Local".
      const TRANSIENT = [429, 500, 502, 503, 529];
      let resp = null, lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": env.ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01"
            },
            body,
            signal: ctrl.signal
          });
          clearTimeout(timer);
          if (resp.ok || !TRANSIENT.includes(resp.status)) break;
        } catch (e) {
          clearTimeout(timer);
          lastErr = e;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 900));
      }
      if (!resp) return json({ error: "anthropic_unreachable", detail: lastErr && lastErr.message }, 502);
      return new Response(await resp.text(), { status: resp.status, headers: JSON_H });
    }
```

C'est un remplacement **1-pour-1**. La fonction lit toujours le body en texte et renvoie la réponse
avec `JSON_H` — le comportement est identique, on ajoute juste le retry + le timeout.

---

## Étape 3 — DÉPLOYER

- **Dashboard** : clique **Save and Deploy** (en haut à droite de l'éditeur).
- **Depuis la source** : `wrangler deploy` (ou ton workflow habituel bordereaux).

---

## Étape 4 — VÉRIFIER

1. Recharge la page StructBoard (Ctrl+Maj+R pour vider le cache).
2. Re-note un produit (bouton **Actualiser** sur la fiche).
3. Le bandeau doit afficher **« Claude IA »** (pas « Local »). En cas de coup de charge,
   ça peut prendre 1-2 s de plus (le temps du retry), mais ça ne bascule plus en Local.

---

## Ce que fait le patch, en clair

| Situation | Avant | Après |
|---|---|---|
| Anthropic renvoie **529 overloaded** | Front tombe en **Local** en silence | **Réessaie 2×** (400 ms puis 900 ms) → passe |
| Un appel **reste figé** | Bloque jusqu'à ~30 s | **Coupé à 12 s**, réessaie |
| Anthropic vraiment KO | Erreur muette | Renvoie `502 anthropic_unreachable` (explicite) |

> Ce worker étant partagé avec les bordereaux, le retry **profite aussi** à tes appels IA bordereaux.

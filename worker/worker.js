// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Cloudflare Worker Proxy
// Route /api/chat    → Claude API      (clé ANTHROPIC_API_KEY)
// Route /github/*    → GitHub API      (clé GITHUB_TOKEN)
// Route /twelvedata/* → Twelve Data API (clé TWELVE_DATA_API_KEY)
// Route /bdf/*       → Banque de France Webstat (base BDF_API_BASE)
// ═══════════════════════════════════════════════════════════════
//
// SECRETS / VARS À CONFIGURER DANS LE WORKER :
// - ANTHROPIC_API_KEY : ta clé API Claude
// - GITHUB_TOKEN : un Personal Access Token GitHub (scope: repo)
// - TWELVE_DATA_API_KEY : clé Twelve Data (prix historiques / strikes)
// - BDF_API_BASE (+ BDF_API_KEY si requise) : base de l'API Webstat BdF (TEC).
//   ⚠ Les routes /twelvedata et /bdf ont été reconstruites à partir de l'usage
//   client — VÉRIFIE la base BdF (BDF_API_BASE) contre le worker réellement
//   déployé avant de redéployer depuis ce fichier.
//
// DÉPLOIEMENT :
// Copie ce code dans ton Worker studyforge-proxy 
// (ou crée un nouveau Worker dédié)
// Ajoute GITHUB_TOKEN dans Settings → Variables → Secrets
// ═══════════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    // ─── CORS ─────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ─── Route: Claude API (/api/chat) ──────────────────
      if (path === '/api/chat' || path === '/') {
        return handleClaudeAPI(request, env);
      }

      // ─── Route: GitHub API (/github/...) ────────────────
      if (path.startsWith('/github/')) {
        return handleGitHubAPI(request, env, path);
      }

      // ─── Route: Twelve Data (/twelvedata/...) ───────────
      if (path.startsWith('/twelvedata')) {
        return handleTwelveData(request, env, url);
      }

      // ─── Route: Banque de France Webstat (/bdf/...) ─────
      if (path.startsWith('/bdf')) {
        return handleBdF(request, env, url);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }
  },
};

// ─── Claude API Handler ─────────────────────────────────────
// Retry sur erreurs TRANSITOIRES d'Anthropic (429 rate-limit, 529 overloaded, 5xx).
// Sans ça, un simple 529 (fréquent aux heures de pointe) repassait tel quel → le front
// voyait !resp.ok et basculait en "Local" EN SILENCE. C'était LA cause du mode Local
// intermittent. + timeout dur par tentative pour ne jamais bloquer sur un upstream figé.
const _TRANSIENT = [429, 500, 502, 503, 529];

async function handleClaudeAPI(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
  }

  const body = await request.json();
  const payload = JSON.stringify(body);
  const MAX_TRIES = 3;
  let response = null, lastErr = null;

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    // Timeout par tentative (12s) — le front coupe à 15s, on reste dessous pour laisser
    // la place à au moins un retry sans dépasser sa propre limite.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: payload,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      // Succès ou erreur définitive (4xx hors 429) → on ne retente pas
      if (response.ok || _TRANSIENT.indexOf(response.status) === -1) break;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;                       // timeout/abort/réseau → on retente
    }
    // Backoff court avant la prochaine tentative (400ms puis 900ms)
    if (attempt < MAX_TRIES - 1) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 900));
    }
  }

  if (!response) {
    return new Response(JSON.stringify({ error: 'upstream_unreachable', detail: lastErr && lastErr.message }), {
      status: 502,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const data = await response.text();

  return new Response(data, {
    status: response.status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// ─── GitHub API Handler ─────────────────────────────────────
// Proxies: /github/{owner}/{repo}/contents/{path}
// → https://api.github.com/repos/{owner}/{repo}/contents/{path}
async function handleGitHubAPI(request, env, path) {
  // Extraire le chemin après /github/
  const githubPath = path.replace('/github/', '');
  const githubURL = `https://api.github.com/repos/${githubPath}`;

  const headers = {
    'Authorization': `token ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'StructBoard-Worker',
  };

  let response;

  if (request.method === 'GET') {
    response = await fetch(githubURL, { method: 'GET', headers });
  } else if (request.method === 'PUT') {
    const body = await request.text();
    response = await fetch(githubURL, { method: 'PUT', headers, body });
  } else if (request.method === 'DELETE') {
    const body = await request.text();
    response = await fetch(githubURL, { method: 'DELETE', headers, body });
  } else {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
  }

  const data = await response.text();

  return new Response(data, {
    status: response.status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// ─── Twelve Data Handler ────────────────────────────────────
// Proxies: /twelvedata/{endpoint}?params → https://api.twelvedata.com/{endpoint}?params&apikey=KEY
// La clé est injectée côté serveur (jamais exposée au front). Ex. endpoint = time_series.
async function handleTwelveData(request, env, url) {
  const endpoint = url.pathname.replace(/^\/twelvedata\/?/, '');
  const params = new URLSearchParams(url.search);
  params.set('apikey', env.TWELVE_DATA_API_KEY || '');
  const target = `https://api.twelvedata.com/${endpoint}?${params.toString()}`;
  const response = await fetch(target);
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// ─── Banque de France Webstat Handler ───────────────────────
// Proxies: /bdf/{endpoint}?params → {BDF_API_BASE}/{endpoint}?params
// ⚠ BDF_API_BASE doit correspondre à l'API réellement utilisée par le worker déployé
// (endpoint observé : observations/exports/json avec select/refine/where/order_by/limit).
async function handleBdF(request, env, url) {
  const endpoint = url.pathname.replace(/^\/bdf\/?/, '');
  const base = (env.BDF_API_BASE || 'https://webstat.banque-france.fr/api/explore/v2.1').replace(/\/$/, '');
  const target = `${base}/${endpoint}${url.search}`;
  const headers = { 'Accept': 'application/json', 'User-Agent': 'StructBoard-Worker' };
  if (env.BDF_API_KEY) headers['Authorization'] = `Apikey ${env.BDF_API_KEY}`;
  const response = await fetch(target, { headers });
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// ─── CORS Headers ───────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

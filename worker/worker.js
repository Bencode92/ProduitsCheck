// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Cloudflare Worker Proxy
// Route /api/chat → Claude API (clé ANTHROPIC_API_KEY)
// Route /github/*  → GitHub API (clé GITHUB_TOKEN)
// ═══════════════════════════════════════════════════════════════
//
// SECRETS À CONFIGURER DANS LE WORKER :
// - ANTHROPIC_API_KEY : ta clé API Claude
// - GITHUB_TOKEN : un Personal Access Token GitHub (scope: repo)
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
async function handleClaudeAPI(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
  }

  const body = await request.json();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

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

// ─── CORS Headers ───────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

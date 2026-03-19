// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — GitHub API Integration (V2 — No rate limit)
// Lecture: raw.githubusercontent.com (pas de rate limit)
// Écriture: via Cloudflare Worker proxy (token côté serveur)
// ═══════════════════════════════════════════════════════════════

class GitHubAPI {
  constructor() {
    this.owner = CONFIG.REPO_OWNER;
    this.repo = CONFIG.REPO_NAME;
    this.branch = CONFIG.BRANCH;
    this.apiURL = 'https://api.github.com';
    this.rawURL = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${CONFIG.BRANCH}`;
    this.proxyURL = CONFIG.AI_ENDPOINT;
    this.cache = new Map(); // path → sha
  }

  // ─── LECTURE via raw.githubusercontent.com (NO rate limit) ─
  async readFile(path) {
    try {
      // raw.githubusercontent.com sert le contenu directement, pas de base64
      const url = `${this.rawURL}/${path}?_t=${Date.now()}`;
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Raw GET ${res.status}`);
      const text = await res.text();
      if (!text || text.trim().length === 0) return null;
      return JSON.parse(text);
    } catch (e) {
      // Si le fichier n'existe pas (404) on retourne null silencieusement
      if (e.message?.includes('404')) return null;
      console.error(`Erreur lecture ${path}:`, e);
      return null;
    }
  }

  // ─── ÉCRITURE via Cloudflare Worker proxy ─────────────────
  async writeFile(path, data, message) {
    try {
      const content = JSON.stringify(data, null, 2);
      const encoded = btoa(unescape(encodeURIComponent(content)));
      const body = {
        message: message || `[StructBoard] Update ${path}`,
        content: encoded,
        branch: this.branch,
      };
      // Récupérer le SHA (nécessaire pour update d'un fichier existant)
      const sha = this.cache.get(path) || await this._getSHA(path);
      if (sha) body.sha = sha;

      const res = await fetch(`${this.proxyURL}/github/${this.owner}/${this.repo}/contents/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.text(); throw new Error(`GitHub PUT ${res.status}: ${err}`); }
      const result = await res.json();
      if (result.content?.sha) this.cache.set(path, result.content.sha);
      return true;
    } catch (e) {
      console.error(`Erreur écriture ${path}:`, e);
      throw e;
    }
  }

  async deleteFile(path, message) {
    try {
      const sha = this.cache.get(path) || await this._getSHA(path);
      if (!sha) return true;
      const res = await fetch(`${this.proxyURL}/github/${this.owner}/${this.repo}/contents/${path}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message || `[StructBoard] Delete ${path}`, sha, branch: this.branch }),
      });
      if (!res.ok) throw new Error(`GitHub DELETE ${res.status}`);
      this.cache.delete(path);
      return true;
    } catch (e) {
      console.error(`Erreur suppression ${path}:`, e);
      throw e;
    }
  }

  // SHA lookup via Worker proxy (avoid API rate limit)
  async _getSHA(path) {
    try {
      // Route through worker to avoid rate limit on api.github.com
      const url = `${this.proxyURL}/github/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
      const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/vnd.github.v3+json' } });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.sha) this.cache.set(path, data.sha);
      return data.sha || null;
    } catch { return null; }
  }
}

const github = new GitHubAPI();

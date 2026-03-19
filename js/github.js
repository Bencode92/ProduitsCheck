// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — GitHub API Integration
// Lecture: direct sur repo public (pas d'auth)
// Écriture: via Cloudflare Worker proxy (token GitHub côté serveur)
// ═══════════════════════════════════════════════════════════════

class GitHubAPI {
  constructor() {
    this.owner = CONFIG.REPO_OWNER;
    this.repo = CONFIG.REPO_NAME;
    this.branch = CONFIG.BRANCH;
    this.apiURL = 'https://api.github.com';
    this.proxyURL = CONFIG.AI_ENDPOINT; // Cloudflare Worker qui a le token GitHub
    this.cache = new Map();
  }

  // ─── LECTURE (direct GitHub API, repo public) ─────────────
  async readFile(path) {
    try {
      const url = `${this.apiURL}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}&_t=${Date.now()}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub GET ${res.status}`);
      const data = await res.json();
      this.cache.set(path, data.sha);
      const content = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(content.split('').map(c => c.charCodeAt(0)));
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      console.error(`Erreur lecture ${path}:`, e);
      return null;
    }
  }

  async listDirectory(path) {
    try {
      const url = `${this.apiURL}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`GitHub LIST ${res.status}`);
      const items = await res.json();
      if (!Array.isArray(items)) return [];
      return items.map(item => ({ name: item.name, path: item.path, type: item.type, sha: item.sha }));
    } catch (e) {
      console.error(`Erreur listage ${path}:`, e);
      return [];
    }
  }

  // ─── ÉCRITURE (via Cloudflare Worker proxy) ───────────────
  async writeFile(path, data, message) {
    try {
      const content = JSON.stringify(data, null, 2);
      const encoded = btoa(unescape(encodeURIComponent(content)));
      const body = {
        message: message || `[StructBoard] Update ${path}`,
        content: encoded,
        branch: this.branch,
      };
      // Récupérer le SHA si le fichier existe (nécessaire pour update)
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

  async _getSHA(path) {
    try {
      const url = `${this.apiURL}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
      if (!res.ok) return null;
      const data = await res.json();
      this.cache.set(path, data.sha);
      return data.sha;
    } catch { return null; }
  }
}

const github = new GitHubAPI();

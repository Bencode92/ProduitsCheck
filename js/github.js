// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — GitHub API Integration
// ═══════════════════════════════════════════════════════════════

class GitHubAPI {
  constructor() {
    this.token = null;
    this.owner = CONFIG.REPO_OWNER;
    this.repo = CONFIG.REPO_NAME;
    this.branch = CONFIG.BRANCH;
    this.baseURL = 'https://api.github.com';
    this.cache = new Map();
  }

  setToken(token) {
    this.token = token;
    sessionStorage.setItem('gh_token', token);
  }

  getToken() {
    if (!this.token) this.token = sessionStorage.getItem('gh_token');
    return this.token;
  }

  isAuthenticated() { return !!this.getToken(); }

  logout() {
    this.token = null;
    sessionStorage.removeItem('gh_token');
    this.cache.clear();
  }

  _headers() {
    return {
      'Authorization': `token ${this.getToken()}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  async readFile(path) {
    try {
      const url = `${this.baseURL}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
      const res = await fetch(url, { headers: this._headers() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${res.statusText}`);
      const data = await res.json();
      this.cache.set(path, data.sha);
      const content = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(content.split('').map(c => c.charCodeAt(0)));
      const decoded = new TextDecoder('utf-8').decode(bytes);
      return JSON.parse(decoded);
    } catch (e) {
      console.error(`Erreur lecture ${path}:`, e);
      return null;
    }
  }

  async writeFile(path, data, message) {
    try {
      const content = JSON.stringify(data, null, 2);
      const encoded = btoa(unescape(encodeURIComponent(content)));
      const body = {
        message: message || `[StructBoard] Update ${path}`,
        content: encoded,
        branch: this.branch,
      };
      const sha = this.cache.get(path);
      if (sha) { body.sha = sha; } else {
        const existing = await this._getSHA(path);
        if (existing) body.sha = existing;
      }
      const url = `${this.baseURL}/repos/${this.owner}/${this.repo}/contents/${path}`;
      const res = await fetch(url, { method: 'PUT', headers: this._headers(), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json(); throw new Error(`GitHub PUT ${res.status}: ${err.message}`); }
      const result = await res.json();
      this.cache.set(path, result.content.sha);
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
      const url = `${this.baseURL}/repos/${this.owner}/${this.repo}/contents/${path}`;
      const res = await fetch(url, {
        method: 'DELETE', headers: this._headers(),
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

  async listDirectory(path) {
    try {
      const url = `${this.baseURL}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
      const res = await fetch(url, { headers: this._headers() });
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

  async _getSHA(path) {
    try {
      const url = `${this.baseURL}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
      const res = await fetch(url, { headers: this._headers() });
      if (!res.ok) return null;
      const data = await res.json();
      this.cache.set(path, data.sha);
      return data.sha;
    } catch { return null; }
  }

  async validateToken() {
    try {
      const res = await fetch(`${this.baseURL}/repos/${this.owner}/${this.repo}`, { headers: this._headers() });
      return res.ok;
    } catch { return false; }
  }
}

const github = new GitHubAPI();

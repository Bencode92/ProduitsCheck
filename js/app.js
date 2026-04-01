// ═══════════════════════════════════════════════════════════════
// STRUCTBOARD — Main Application V2.3
// V2.3: Fix coupon.rate fallback from rateIfCalled/rateIfMaturity
//       + copy all V7.2 parser fields (barrierCoupon, startSemester)
// ═══════════════════════════════════════════════════════════════

class StructBoard {
  constructor() {
    this.state = { view: 'dashboard', portfolio: [], proposals: {}, currentProduct: null, currentChat: [], bankSections: {}, loading: false, initialized: false };
    this.listeners = [];
  }

  setState(updates) { Object.assign(this.state, updates); this._notify(); }
  subscribe(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }
  _notify() { this.listeners.forEach(fn => fn(this.state)); }

  async init() {
    this.setState({ loading: true });
    try {
      const portfolio = await github.readFile(`${CONFIG.DATA_PATH}/portfolio.json`);
      this.state.portfolio = portfolio || [];
      const proposals = {};
      for (const bank of BANKS) {
        const bankData = await github.readFile(`${CONFIG.DATA_PATH}/banks/${bank.id}/index.json`);
        if (bankData && bankData.products && bankData.products.length > 0) {
          const fullProducts = [];
          for (const summary of bankData.products) {
            try {
              const fullProduct = await github.readFile(`${CONFIG.DATA_PATH}/banks/${bank.id}/products/${summary.id}.json`);
              if (fullProduct && fullProduct.id) fullProducts.push(fullProduct);
              else fullProducts.push({ ...summary, bankId: bank.id });
            } catch (e) { fullProducts.push({ ...summary, bankId: bank.id }); }
          }
          if (fullProducts.length > 0) proposals[bank.id] = fullProducts;
        }
      }
      await catManager.load();
      this.setState({ proposals, loading: false, initialized: true });
      this.render();
    } catch (e) {
      console.error('Erreur initialisation:', e);
      this.setState({ loading: false });
      showToast('Erreur de chargement des donn\u00e9es', 'error');
    }
  }

  async addToPortfolio(product, investedAmount) {
    const item = { ...product, id: product.id || this._uid(), investedAmount: parseFloat(investedAmount) || 0, addedDate: new Date().toISOString().split('T')[0], status: 'active' };
    this.state.portfolio.push(item);
    await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, this.state.portfolio, `[StructBoard] Ajout: ${product.name || product.type}`);
    if (product.bankId) await this._saveProductFile(product.bankId, item);
    this.setState({ portfolio: [...this.state.portfolio] });
    showToast('Produit ajout\u00e9 au portefeuille', 'success');
  }

  async removeFromPortfolio(productId) {
    this.state.portfolio = this.state.portfolio.filter(p => p.id !== productId);
    await github.writeFile(`${CONFIG.DATA_PATH}/portfolio.json`, this.state.portfolio, `[StructBoard] Retrait: ${productId}`);
    this.setState({ portfolio: [...this.state.portfolio] });
    showToast('Produit retir\u00e9', 'success');
  }

  async addProposal(bankId, product) {
    if (!this.state.proposals[bankId]) this.state.proposals[bankId] = [];
    const proposal = { ...product, id: product.id || this._uid(), bankId, status: 'analyzing', receivedDate: new Date().toISOString().split('T')[0], conversation: [], conversationSummary: null, decision: null, decisionReason: null };
    // Legacy scoring removed — grading v6.3 (ProposalGrader.grade) is the only scoring system
    this.state.proposals[bankId].push(proposal);
    await this._saveBankIndex(bankId);
    await this._saveProductFile(bankId, proposal);
    this.setState({ proposals: { ...this.state.proposals } });
    showToast('Proposition enregistr\u00e9e', 'success');
    return proposal;
  }

  async updateProposalStatus(bankId, productId, status, reason) {
    const proposals = this.state.proposals[bankId]; if (!proposals) return;
    const idx = proposals.findIndex(p => p.id === productId); if (idx === -1) return;
    proposals[idx].status = status;
    proposals[idx].decision = status;
    proposals[idx].decisionReason = reason || null;
    await this._saveBankIndex(bankId);
    await this._saveProductFile(bankId, proposals[idx]);
    this.setState({ proposals: { ...this.state.proposals } });
  }

  async removeProposal(bankId, productId) {
    const proposals = this.state.proposals[bankId]; if (!proposals) return;
    this.state.proposals[bankId] = proposals.filter(p => p.id !== productId);
    if (this.state.proposals[bankId].length === 0) delete this.state.proposals[bankId];
    await this._saveBankIndex(bankId);
    this.setState({ proposals: { ...this.state.proposals } });
    showToast('Proposition supprim\u00e9e', 'success');
  }

  async handlePDFUpload(file, bankId) {
    this.setState({ loading: true });
    try {
      showToast('Extraction du texte PDF...', 'info');
      const rawText = await pdfExtractor.extractText(file);
      if (!rawText || rawText.trim().length < 50) throw new Error('Le PDF semble vide ou illisible');
      showToast('Analyse IA de la brochure...', 'info');
      const parsed = await aiParser.parseBrochure(rawText);
      showToast('G\u00e9n\u00e9ration du r\u00e9sum\u00e9...', 'info');
      const summary = await aiParser.generateSummary(parsed);

      // V2.3: Fix coupon.rate fallback
      // If parser extracted rateIfCalled/rateIfMaturity but not rate, use rateIfMaturity as default
      const coupon = parsed.coupon || {};
      if (!coupon.rate && (coupon.rateIfCalled || coupon.rateIfMaturity)) {
        coupon.rate = coupon.rateIfMaturity || coupon.rateIfCalled;
        console.log('[handlePDFUpload] Coupon rate fallback: ' + coupon.rate + 
          ' (ifCalled=' + (coupon.rateIfCalled || '?') + ', ifMaturity=' + (coupon.rateIfMaturity || '?') + ')');
      }

      const product = {
        id: this._uid(), name: parsed.name || file.name.replace('.pdf', ''), bankId,
        type: this._matchType(parsed.type), underlyingType: this._matchUnderlying(parsed.underlyingType, parsed.underlyings),
        underlyings: parsed.underlyings || [], currency: parsed.currency || 'EUR',
        maturity: parsed.maturity || null, maturityDate: parsed.maturityDate || null, strikeDate: parsed.strikeDate || null,
        coupon: coupon, capitalProtection: parsed.capitalProtection || {},
        earlyRedemption: parsed.earlyRedemption || {}, scenarios: parsed.scenarios || {},
        risks: parsed.risks || [],
        // V2.2: rawText 10K
        rawText: rawText.substring(0, 10000),
        aiParsed: parsed, aiSummary: summary, sourceFile: file.name,
        // V2.1: Structure fields
        structureType: parsed.structureType || '',
        participationRate: parsed.participationRate || null,
        historicalSimulations: parsed.historicalSimulations || null,
        guarantorRating: parsed.guarantorRating || null,
        mechanism: parsed.mechanism || null,
        nPairs: parsed.nPairs || null,
        nUnderlyings: parsed.nUnderlyings || null,
        // V2.2: D\u00e9cr\u00e9ment + step-down
        decrementPct: parsed.decrementPct || null,
        actualDividendYield: parsed.actualDividendYield || null,
      };

      // Log detections
      if (product.structureType) {
        console.log('[handlePDFUpload] structureType: ' + product.structureType);
        showToast('Structure: ' + (typeof getStructureTypeLabel === 'function' ? getStructureTypeLabel(product.structureType) : product.structureType), 'success');
      }
      if (product.decrementPct) {
        console.log('[handlePDFUpload] D\u00e9cr\u00e9ment: ' + product.decrementPct + '% (div r\u00e9el: ' + (product.actualDividendYield || '?') + '%)');
        showToast('\u26a0 D\u00e9cr\u00e9ment d\u00e9tect\u00e9: ' + product.decrementPct + '%/an', 'info');
      }
      // V2.3: Log double coupon
      if (coupon.rateIfCalled && coupon.rateIfMaturity && coupon.rateIfCalled !== coupon.rateIfMaturity) {
        console.log('[handlePDFUpload] Double coupon: rappel=' + coupon.rateIfCalled + '%/an, maturit\u00e9=' + coupon.rateIfMaturity + '%/an');
        showToast('Coupon: ' + coupon.rateIfCalled + '% si rappel\u00e9, ' + coupon.rateIfMaturity + '% sinon', 'info');
      }
      // V2.3: Log double barrier
      var cp = parsed.capitalProtection || {};
      if (cp.barrier && cp.barrierCoupon && cp.barrier !== cp.barrierCoupon) {
        console.log('[handlePDFUpload] Double barri\u00e8re: capital=' + cp.barrier + '%, coupon=' + cp.barrierCoupon + '%');
        showToast('Barri\u00e8res: capital ' + cp.barrier + '%, coupon ' + cp.barrierCoupon + '%', 'info');
      }

      if (parsed.maturityYears) product.maturityYears = parsed.maturityYears;
      else if (parsed.maturity) {
        const ym = parsed.maturity.match(/(\d+)/);
        if (ym) product.maturityYears = parseInt(ym[1]);
      }

      this.setState({ loading: false }); return product;
    } catch (e) { this.setState({ loading: false }); showToast('Erreur: ' + e.message, 'error'); throw e; }
  }

  async sendChatMessage(productId, bankId, userMessage) {
    const product = this._findProduct(productId, bankId); if (!product) return;
    if (!product.conversation) product.conversation = [];
    product.conversation.push({ role: 'user', content: userMessage, timestamp: Date.now() });
    const messages = product.conversation.map(m => ({ role: m.role, content: m.content }));
    const ctx = this.state.portfolio.map(p => ({ name: p.name, type: p.type, underlying: p.underlyingType, coupon: p.coupon?.rate, barrier: p.capitalProtection?.barrier, maturity: p.maturity, bank: p.bankId }));
    const response = await aiParser.chat(messages, product.aiParsed || product, ctx);
    product.conversation.push({ role: 'assistant', content: response, timestamp: Date.now() });
    await this._saveProductFile(bankId || product.bankId, product);
    this.setState({}); return response;
  }

  async summarizeAndDecide(productId, bankId, decision) {
    const product = this._findProduct(productId, bankId);
    if (!product || !product.conversation || product.conversation.length === 0) return;
    const summary = await aiParser.summarizeConversation(product.conversation.map(m => ({ role: m.role, content: m.content })), decision);
    product.conversationSummary = summary; product.decision = decision; product.decisionDate = new Date().toISOString().split('T')[0];
    await this._saveProductFile(bankId || product.bankId, product);
    this.setState({}); return summary;
  }

  async _saveBankIndex(bankId) {
    const proposals = this.state.proposals[bankId] || [];
    const bankConfig = BANKS.find(b => b.id === bankId);
    const index = {
      bankId, bankName: bankConfig?.name || bankId, lastUpdated: new Date().toISOString(),
      products: proposals.map(p => ({ id: p.id, name: p.name, type: p.type, status: p.status, score: p.score?.score || null, receivedDate: p.receivedDate })),
    };
    await github.writeFile(`${CONFIG.DATA_PATH}/banks/${bankId}/index.json`, index, `[StructBoard] Update ${bankConfig?.name || bankId}`);
  }

  async _saveProductFile(bankId, product) {
    if (!product || !product.id) return;
    await github.writeFile(`${CONFIG.DATA_PATH}/banks/${bankId}/products/${product.id}.json`, product, `[StructBoard] Save ${product.id}`);
  }

  openProduct(product) { this.setState({ view: 'product-sheet', currentProduct: product }); this.render(); }
  openChat(product) { this.setState({ view: 'chat', currentProduct: product, currentChat: product.conversation || [] }); this.render(); }
  goToDashboard() { this.setState({ view: 'dashboard', currentProduct: null, currentChat: [] }); this.render(); }

  render() {
    const main = document.getElementById('main-content');
    if (!main) return;
    if (this.state.view === 'cat') { renderCAT(main); return; }
    if (typeof renderApp === 'function') renderApp(this.state);
  }

  _uid() { return 'sp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  _matchType(t) { if (!t) return 'autre'; const l = t.toLowerCase(); const m = PRODUCT_TYPES.find(x => l.includes(x.id) || x.name.toLowerCase().includes(l)); return m ? m.id : 'autre'; }
  _matchUnderlying(t, u) { if (!t && (!u || u.length === 0)) return 'autre'; const s = (t || (u||[]).join(' ')).toLowerCase(); const m = UNDERLYINGS.find(x => s.includes(x.id.replace(/-/g,'')) || s.includes(x.name.toLowerCase()) || x.name.toLowerCase().split(' ').some(w => s.includes(w) && w.length > 3)); return m ? m.id : 'autre'; }
  _findProduct(id, bankId) {
    const p = this.state.portfolio.find(x => x.id === id); if (p) return p;
    if (bankId && this.state.proposals[bankId]) { const f = this.state.proposals[bankId].find(x => x.id === id); if (f) return f; }
    for (const arr of Object.values(this.state.proposals)) { const f = arr.find(x => x.id === id); if (f) return f; }
    return null;
  }
}

function showToast(message, type = 'info') {
  const c = document.getElementById('toast-container'); if (!c) return;
  const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = message; c.appendChild(t);
  setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 3000);
}

function formatNumber(n) { if (!n && n !== 0) return '\u2014'; return Number(n).toLocaleString('fr-FR'); }
function formatPct(n) { if (!n && n !== 0) return '\u2014'; return Number(n).toFixed(2).replace('.', ',') + '%'; }
function formatDate(d) { if (!d) return '\u2014'; return new Date(d).toLocaleDateString('fr-FR'); }

const app = new StructBoard();

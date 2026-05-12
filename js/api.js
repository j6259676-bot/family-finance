const Api = {
  _token: null,

  init(token) { this._token = token; },

  async get(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('token', this._token);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '伺服器錯誤');
    return json.data;
  },

  async post(action, data = {}) {
    // 使用 text/plain 避免 CORS preflight（Apps Script 不回應 OPTIONS）
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, data, token: this._token })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '伺服器錯誤');
    return json.data;
  },

  // 讀取
  getCategories()          { return this.get('getCategories'); },
  getAccounts()            { return this.get('getAccounts'); },
  getTransactions(month)   { return this.get('getTransactions', { month }); },
  getDashboard(month)      { return this.get('getDashboard', { month }); },
  getMonthlyBudgets(month) { return this.get('getMonthlyBudgets', { month }); },
  getDreamAccounts()       { return this.get('getDreamAccounts'); },
  getInvestment()          { return this.get('getInvestment'); },
  getRecurringRules()      { return this.get('getRecurringRules'); },
  getBudgetSummary(startDate, endDate) {
    return this.get('getBudgetSummary', { startDate, endDate });
  },

  // 寫入
  addTransaction(data)       { return this.post('addTransaction', data); },
  deleteTransaction(id)      { return this.post('deleteTransaction', { id }); },
  addTransfer(data)          { return this.post('addTransfer', data); },
  setMonthlyBudgets(data)    { return this.post('setMonthlyBudgets', data); },
  updateDreamAccount(data)   { return this.post('updateDreamAccount', data); },
  updateAccountBalance(data) { return this.post('updateAccountBalance', data); },
  addInvestmentSnapshot(data){ return this.post('addInvestmentSnapshot', data); },
  resolveReconciliation(data){ return this.post('resolveReconciliation', data); },
};

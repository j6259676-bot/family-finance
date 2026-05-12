// ============================================================
// 全局狀態 (Alpine store)
// ============================================================
document.addEventListener('alpine:init', () => {

  Alpine.store('auth', {
    loggedIn: false,
    user: null,   // { id, name, avatar, color }
    token: null,

    init() {
      const saved = localStorage.getItem('hf_auth');
      if (saved) {
        try {
          const data = JSON.parse(saved);
          this.user  = data.user;
          this.token = data.token;
          Api.init(data.token);
          this.loggedIn = true;
        } catch (e) { this.logout(); }
      }
    },

    login(userId, token) {
      const user = CONFIG.USERS.find(u => u.id === userId);
      if (!user) return false;
      this.user  = user;
      this.token = token;
      Api.init(token);
      this.loggedIn = true;
      localStorage.setItem('hf_auth', JSON.stringify({ user, token }));
      // 通知各頁面元件可以開始載入資料
      window.dispatchEvent(new CustomEvent('auth-login'));
      return true;
    },

    logout() {
      this.loggedIn = false;
      this.user = null;
      this.token = null;
      localStorage.removeItem('hf_auth');
    }
  });

  Alpine.store('nav', {
    tab: 'today',   // today | accounts | budget | reports
    setTab(t) { this.tab = t; }
  });

});

// ============================================================
// 登入頁元件
// ============================================================
function LoginPage() {
  return {
    selectedUser: null,
    password: '',
    error: '',
    loading: false,

    selectUser(userId) { this.selectedUser = userId; this.error = ''; },

    async submit() {
      if (!this.selectedUser) { this.error = '請先選擇你是誰'; return; }
      if (!this.password)     { this.error = '請輸入密碼'; return; }
      this.loading = true;
      this.error = '';
      try {
        // 驗證密碼：用 getCategories 測試 API 是否通
        Api.init(this.password);
        await Api.getCategories();
        Alpine.store('auth').login(this.selectedUser, this.password);
      } catch (e) {
        this.error = '密碼錯誤，請重試';
        Api.init(null);
      } finally {
        this.loading = false;
      }
    }
  };
}

// ============================================================
// 今天頁（記帳首頁）
// ============================================================
function TodayPage() {
  return {
    transactions: [],
    categories: [],
    accounts: [],
    loading: false,
    showAddModal: false,

    init() {
      if (Alpine.store('auth').loggedIn) {
        this.loadData();
      } else {
        window.addEventListener('auth-login', () => this.loadData(), { once: true });
      }
      window.addEventListener('tx-added', () => this.loadData());
    },

    async loadData() {
      this.loading = true;
      try {
        const month = currentMonth();
        [this.transactions, this.categories, this.accounts] = await Promise.all([
          Api.getTransactions(month),
          Api.getCategories(),
          Api.getAccounts()
        ]);
        this.transactions = this.transactions.sort((a, b) =>
          String(b.date).localeCompare(String(a.date))
        );
      } catch (e) { console.error(e); }
      this.loading = false;
    },

    getCatName(id) {
      const c = this.categories.find(c => c.id === id);
      return c ? c.name : id;
    },
    getCatIcon(id) {
      const c = this.categories.find(c => c.id === id);
      return c ? (c.icon || '•') : '•';
    },

    get recentTx() {
      return this.transactions.slice(0, 20);
    },

    async deleteTx(id) {
      if (!confirm('確定刪除這筆記帳？')) return;
      await Api.deleteTransaction(id);
      this.transactions = this.transactions.filter(t => t.id !== id);
    }
  };
}

// ============================================================
// 記帳 Modal 元件（手機快速記帳）
// ============================================================
function AddModal() {
  return {
    show: false,
    step: 'amount',   // amount | category | transfer-accounts | confirm
    direction: 'expense',  // expense | income | transfer
    amountStr: '',
    selectedCat: null,
    note: '',
    selectedAccount: null,
    fromAccountId: null,   // 轉帳：來源帳戶
    toAccountId: null,     // 轉帳：目標帳戶
    categories: [],
    accounts: [],
    loading: false,
    done: false,

    async open() {
      this.reset();
      this.show = true;
      this.step = 'amount';
      if (!this.categories.length) {
        try {
          [this.categories, this.accounts] = await Promise.all([
            Api.getCategories(),
            Api.getAccounts()
          ]);
        } catch(e) { console.error('載入類別失敗', e); }
      }
    },

    close() { this.show = false; this.reset(); },

    reset() {
      this.step = 'amount'; this.amountStr = ''; this.selectedCat = null;
      this.note = ''; this.selectedAccount = null; this.direction = 'expense';
      this.fromAccountId = null; this.toAccountId = null;
      this.done = false;
    },

    pressNum(n) {
      if (this.amountStr === '0') { this.amountStr = String(n); return; }
      if (this.amountStr.length >= 8) return;
      this.amountStr += String(n);
    },
    pressDot() {
      if (this.amountStr.includes('.')) return;
      this.amountStr = (this.amountStr || '0') + '.';
    },
    pressBack() { this.amountStr = this.amountStr.slice(0, -1); },

    get amount() { return parseFloat(this.amountStr) || 0; },

    get expenseCats() {
      return this.categories.filter(c =>
        ['fixed', 'variable', 'special'].includes(c.group)
      );
    },
    get incomeCats() {
      return this.categories.filter(c => c.group === 'income' || c.group === 'savings');
    },
    get displayCats() {
      return this.direction === 'expense' ? this.expenseCats : this.incomeCats;
    },
    get nonCreditAccounts() {
      return this.accounts.filter(a => a.type !== 'credit');
    },

    nextStep() {
      if (this.step === 'amount') {
        if (!this.amount || this.amount <= 0) { alert('請輸入金額'); return; }
        this.step = this.direction === 'transfer' ? 'transfer-accounts' : 'category';
      }
    },

    selectCat(cat) {
      this.selectedCat = cat;
      this.step = 'confirm';
    },

    confirmTransfer() {
      if (!this.fromAccountId) { alert('請選擇轉出帳戶'); return; }
      if (!this.toAccountId)   { alert('請選擇轉入帳戶'); return; }
      if (this.fromAccountId === this.toAccountId) { alert('轉出和轉入帳戶不能相同'); return; }
      this.step = 'confirm';
    },

    getAccountName(id) {
      const a = this.accounts.find(a => a.id === id);
      return a ? a.name : id;
    },

    async submit() {
      if (this.loading) return;
      this.loading = true;
      try {
        const user = Alpine.store('auth').user;
        if (this.direction === 'transfer') {
          await Api.addTransfer({
            date: new Date().toISOString().split('T')[0],
            amount: this.amount,
            from_account_id: this.fromAccountId,
            to_account_id: this.toAccountId,
            note: this.note || '帳戶轉帳',
            created_by: user.id
          });
        } else {
          await Api.addTransaction({
            date: new Date().toISOString().split('T')[0],
            amount: this.amount,
            direction: this.direction,
            category_id: this.selectedCat.id,
            note: this.note,
            account_id: this.selectedAccount || '',
            created_by: user.id
          });
        }
        this.done = true;
        setTimeout(() => {
          this.close();
          window.dispatchEvent(new CustomEvent('tx-added'));
        }, 800);
      } catch (e) {
        alert('記帳失敗：' + e.message);
      } finally {
        this.loading = false;
      }
    }
  };
}

// ============================================================
// 帳戶頁
// ============================================================
function AccountsPage() {
  return {
    accounts: [],
    loading: false,

    init() {
      if (Alpine.store('auth').loggedIn) {
        this.loadData();
      } else {
        window.addEventListener('auth-login', () => this.loadData(), { once: true });
      }
    },

    async loadData() {
      this.loading = true;
      try { this.accounts = await Api.getAccounts(); }
      catch (e) { console.error(e); }
      this.loading = false;
    },

    get bankAccounts() {
      return this.accounts.filter(a => a.type !== 'credit');
    },
    get creditCards() {
      return this.accounts.filter(a => a.type === 'credit');
    },
    get totalCash() {
      return this.bankAccounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    },
    get totalCredit() {
      return this.creditCards.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    }
  };
}

// ============================================================
// 預算頁
// ============================================================
function BudgetPage() {
  return {
    dashboard: null,
    loading: false,
    month: currentMonth(),

    init() {
      if (Alpine.store('auth').loggedIn) {
        this.loadData();
      } else {
        window.addEventListener('auth-login', () => this.loadData(), { once: true });
      }
    },

    async loadData() {
      this.loading = true;
      try { this.dashboard = await Api.getDashboard(this.month); }
      catch (e) { console.error(e); }
      this.loading = false;
    },

    statusColor(s) {
      if (s === 'over')    return 'text-red-400';
      if (s === 'warning') return 'text-yellow-400';
      return 'text-green-400';
    },

    barColor(s) {
      if (s === 'over')    return 'bg-red-500';
      if (s === 'warning') return 'bg-yellow-500';
      return 'bg-indigo-500';
    },

    pct(actual, budget) {
      if (!budget) return 0;
      return Math.min(100, Math.round(actual / budget * 100));
    }
  };
}

// ============================================================
// 報表頁（儀表板 + 花費分析圖表）
// ============================================================
function ReportsPage() {
  return {
    dashboard: null,
    summary: null,
    loading: false,
    chartLoading: false,
    month: currentMonth(),
    startDate: '',
    endDate: '',
    rangeMode: 'month',
    _chart: null,

    init() {
      const today = new Date();
      const m = currentMonth();
      this.startDate = m + '-01';
      this.endDate = today.toISOString().slice(0, 10);

      // 切換到報表 tab 時重繪圖表（x-show 隱藏時 canvas 尺寸為 0）
      this.$watch('$store.nav.tab', tab => {
        if (tab === 'reports' && this.summary && !this._chart) {
          this.$nextTick(() => this.renderChart());
        }
      });

      if (Alpine.store('auth').loggedIn) {
        this.loadData();
      } else {
        window.addEventListener('auth-login', () => this.loadData(), { once: true });
      }
    },

    async loadData() {
      this.loading = true;
      this.chartLoading = true;
      try {
        [this.dashboard, this.summary] = await Promise.all([
          Api.getDashboard(this.month),
          Api.getBudgetSummary(this.startDate, this.endDate)
        ]);
        this.$nextTick(() => this.renderChart());
      } catch (e) { console.error(e); }
      this.loading = false;
      this.chartLoading = false;
    },

    async loadSummary() {
      this.chartLoading = true;
      if (this._chart) { this._chart.destroy(); this._chart = null; }
      try {
        this.summary = await Api.getBudgetSummary(this.startDate, this.endDate);
        this.$nextTick(() => this.renderChart());
      } catch (e) { console.error(e); }
      this.chartLoading = false;
    },

    setThisMonth() {
      const today = new Date();
      this.startDate = currentMonth() + '-01';
      this.endDate = today.toISOString().slice(0, 10);
      this.rangeMode = 'month';
      this.loadSummary();
    },

    setLastMonth() {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
      this.startDate = `${y}-${m}-01`;
      this.endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
      this.rangeMode = 'last';
      this.loadSummary();
    },

    renderChart() {
      const canvas = document.getElementById('budgetChart');
      if (!canvas) return;

      const rows = (this.summary?.rows || [])
        .filter(r => r.direction !== 'income' && (r.budget > 0 || r.actual > 0))
        .sort((a, b) => (b.budget || b.actual) - (a.budget || a.actual))
        .slice(0, 14);

      if (this._chart) { this._chart.destroy(); this._chart = null; }

      const labels   = rows.map(r => (r.emoji ? r.emoji + ' ' : '') + r.name);
      const budgets  = rows.map(r => r.budget || 0);
      const actuals  = rows.map(r => r.actual || 0);
      const colors   = rows.map(r => {
        if (!r.budget) return 'rgba(99,102,241,0.75)';
        const ratio = r.actual / r.budget;
        if (ratio >= 1)   return 'rgba(239,68,68,0.85)';
        if (ratio >= 0.8) return 'rgba(234,179,8,0.85)';
        return 'rgba(34,197,94,0.85)';
      });

      this._chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: '預算',
              data: budgets,
              backgroundColor: 'rgba(100,116,139,0.25)',
              borderColor: 'rgba(100,116,139,0.5)',
              borderWidth: 1,
              borderRadius: 3,
            },
            {
              label: '實際',
              data: actuals,
              backgroundColor: colors,
              borderWidth: 0,
              borderRadius: 3,
            }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.dataset.label}: $${Number(ctx.raw).toLocaleString('zh-TW')}`
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: '#6b7280', font: { size: 10 },
                callback: v => v === 0 ? '' : '$' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v)
              },
              grid: { color: 'rgba(255,255,255,0.04)' }
            },
            y: {
              ticks: { color: '#d1d5db', font: { size: 11 } },
              grid: { display: false }
            }
          }
        }
      });
    }
  };
}

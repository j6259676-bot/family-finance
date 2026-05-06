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
    loading: true,
    showAddModal: false,

    async init() {
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
    step: 'amount',   // amount | category | confirm
    direction: 'expense',
    amountStr: '',
    selectedCat: null,
    note: '',
    selectedAccount: null,
    categories: [],
    accounts: [],
    loading: false,
    done: false,

    async open() {
      this.reset();
      if (!this.categories.length) {
        [this.categories, this.accounts] = await Promise.all([
          Api.getCategories(),
          Api.getAccounts()
        ]);
      }
      this.show = true;
      this.step = 'amount';
    },

    close() { this.show = false; this.reset(); },

    reset() {
      this.step = 'amount'; this.amountStr = ''; this.selectedCat = null;
      this.note = ''; this.selectedAccount = null; this.direction = 'expense';
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

    nextStep() {
      if (this.step === 'amount') {
        if (!this.amount || this.amount <= 0) { alert('請輸入金額'); return; }
        this.step = 'category';
      }
    },

    selectCat(cat) {
      this.selectedCat = cat;
      this.step = 'confirm';
    },

    async submit() {
      if (this.loading) return;
      this.loading = true;
      try {
        const user = Alpine.store('auth').user;
        await Api.addTransaction({
          date: new Date().toISOString().split('T')[0],
          amount: this.amount,
          direction: this.direction,
          category_id: this.selectedCat.id,
          note: this.note,
          account_id: this.selectedAccount || '',
          created_by: user.id
        });
        this.done = true;
        setTimeout(() => {
          this.close();
          // 通知今天頁重新載入
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
    loading: true,

    async init() {
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
    loading: true,
    month: currentMonth(),

    async init() {
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
// 報表頁（儀表板）
// ============================================================
function ReportsPage() {
  return {
    dashboard: null,
    loading: true,
    month: currentMonth(),

    async init() {
      this.loading = true;
      try { this.dashboard = await Api.getDashboard(this.month); }
      catch (e) { console.error(e); }
      this.loading = false;
    }
  };
}

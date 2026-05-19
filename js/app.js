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
    expression: '',        // 計算機算式字串，如 "120+85+30"
    selectedCat: null,
    note: '',
    date: '',              // YYYY-MM-DD，預設今天
    selectedAccount: null,
    fromAccountId: null,   // 轉帳：來源帳戶
    toAccountId: null,     // 轉帳：目標帳戶
    pickerParentId: null,  // 兩層分類：已選父類別 id（null = 顯示第一層）
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
      this.step = 'amount'; this.expression = ''; this.selectedCat = null;
      this.note = ''; this.selectedAccount = null; this.direction = 'expense';
      this.fromAccountId = null; this.toAccountId = null;
      this.pickerParentId = null; this.done = false;
      this.date = todayStr();
    },

    // ---- 計算機鍵盤 ----
    pressNum(n) {
      if (this.expression.length >= 20) return;
      this.expression += String(n);
    },
    pressDot() {
      // 只在最後一個數字段還沒有小數點時才加
      const parts = this.expression.split(/[+\-×÷]/);
      const last = parts[parts.length - 1];
      if (last.includes('.')) return;
      this.expression = (this.expression || '0') + '.';
    },
    pressOp(op) {
      if (!this.expression) return;
      const last = this.expression.slice(-1);
      if (['+', '-', '×', '÷'].includes(last)) {
        // 替換掉最後一個運算符
        this.expression = this.expression.slice(0, -1) + op;
      } else {
        this.expression += op;
      }
    },
    pressEqual() {
      const result = this.evalExpression(this.expression);
      if (result !== null) this.expression = String(result);
    },
    pressBack() {
      this.expression = this.expression.slice(0, -1);
    },

    // 安全的算式解析（不使用 eval，支援 + - × ÷ 和小數）
    evalExpression(expr) {
      if (!expr) return 0;
      try {
        // 把顯示用符號換成標準運算符
        const normalized = expr.replace(/×/g, '*').replace(/÷/g, '/');
        // 只允許數字、小數點、+ - * /
        if (!/^[\d.+\-*/\s]+$/.test(normalized)) return null;
        // 手動解析：先處理 * /，再處理 + -
        const tokens = normalized.match(/[\d.]+|[+\-*/]/g) || [];
        if (!tokens.length) return 0;

        // 第一遍：處理 * /
        const afterMD = [];
        let i = 0;
        while (i < tokens.length) {
          if (tokens[i] === '*' || tokens[i] === '/') {
            const left  = parseFloat(afterMD.pop());
            const right = parseFloat(tokens[++i]);
            afterMD.push(String(tokens[i - 1] === '*' ? left * right : left / right));
          } else {
            afterMD.push(tokens[i]);
          }
          i++;
        }

        // 第二遍：處理 + -
        let result = parseFloat(afterMD[0]) || 0;
        for (let j = 1; j < afterMD.length; j += 2) {
          const op  = afterMD[j];
          const num = parseFloat(afterMD[j + 1]) || 0;
          if (op === '+') result += num;
          if (op === '-') result -= num;
        }
        const rounded = Math.round(result * 100) / 100;
        return isNaN(rounded) ? null : rounded;
      } catch(e) { return null; }
    },

    get amount() {
      return this.evalExpression(this.expression) || 0;
    },
    get displayResult() {
      if (!this.expression || !/[+\-×÷]/.test(this.expression)) return '';
      const r = this.evalExpression(this.expression);
      return r !== null ? '= $' + formatMoney(r) : '';
    },

    // 父類別（第一層群組標題）
    get parentCats() {
      return this.categories.filter(c => c.group === 'parent');
    },
    // 獨立支出類別（無父類別、非 parent/income/savings/other/transfer 群組、sort < 90）
    get independentExpenseCats() {
      const excludeGroups = new Set(['parent', 'income', 'savings', 'other', 'transfer']);
      return this.categories.filter(c =>
        !excludeGroups.has(c.group) && !c.parent_id && Number(c.sort_order) < 90
      );
    },
    // 目前選定父類別的子類別
    get childCats() {
      if (!this.pickerParentId) return [];
      return this.categories.filter(c =>
        c.parent_id === this.pickerParentId && Number(c.sort_order) < 90
      );
    },
    get pickerParentCat() {
      if (!this.pickerParentId) return null;
      return this.categories.find(c => c.id === this.pickerParentId) || null;
    },
    get incomeCats() {
      return this.categories.filter(c => c.group === 'income' || c.group === 'savings');
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

    selectParent(cat) {
      this.pickerParentId = cat.id;
    },

    selectCat(cat) {
      this.selectedCat = cat;
      this.pickerParentId = null;
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
        const txDate = this.date || todayStr();
        if (this.direction === 'transfer') {
          await Api.addTransfer({
            date: txDate,
            amount: this.amount,
            from_account_id: this.fromAccountId,
            to_account_id: this.toAccountId,
            note: this.note || '帳戶轉帳',
            created_by: user.id
          });
        } else {
          await Api.addTransaction({
            date: txDate,
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
    // 帳戶明細 drawer
    selectedAcc: null,
    accTx: [],
    accTxLoading: false,
    accMonthsBack: 3,
    accStats: null,
    showDrawer: false,

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

    async openAccount(acc) {
      this.selectedAcc = acc;
      this.accTx = [];
      this.accMonthsBack = 3;
      this.showDrawer = true;
      await this.loadAccTx();
    },

    closeDrawer() {
      this.showDrawer = false;
      this.selectedAcc = null;
      this.accTx = [];
    },

    async loadAccTx() {
      this.accTxLoading = true;
      try {
        const data = await Api.getAccountTransactions(this.selectedAcc.id, this.accMonthsBack);
        this.accTx = data.transactions || [];
        this.accStats = { totalIncome: data.totalIncome, totalExpense: data.totalExpense };
      } catch(e) { console.error(e); }
      this.accTxLoading = false;
    },

    async loadMoreAccTx() {
      this.accMonthsBack += 3;
      await this.loadAccTx();
    },

    // 把 accTx 按日期分組
    get accTxGrouped() {
      const groups = {};
      (this.accTx || []).forEach(t => {
        const d = String(t.date);
        if (!groups[d]) groups[d] = [];
        groups[d].push(t);
      });
      return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(d => ({
        date: d,
        txs: groups[d]
      }));
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
    prevDashboard: null,  // 上月，供家庭會議參考
    loading: false,
    month: currentMonth(),
    mode: 'view',          // 'view' | 'edit'
    editMonth: nextMonth(),
    editBudgets: {},       // { [cat_id]: amount }

    init() {
      if (Alpine.store('auth').loggedIn) {
        this.loadData();
      } else {
        window.addEventListener('auth-login', () => this.loadData(), { once: true });
      }
    },

    async loadData() {
      this.loading = true;
      try {
        this.dashboard = await Api.getDashboard(this.month);
      } catch (e) { console.error(e); }
      this.loading = false;
    },

    // 月份清單（近 6 個月 + 未來 2 個月）
    get monthOptions() {
      const months = [];
      const d = new Date();
      for (let i = -5; i <= 2; i++) {
        const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
        const str = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
        months.push(str);
      }
      return months.reverse();
    },

    // 總預算警示
    get totalBudget() {
      return (this.dashboard?.budgetSummary || [])
        .filter(c => c.group !== 'income' && !c.parent_id)
        .reduce((s, c) => s + (c.budget || 0), 0);
    },
    get totalActual() {
      return (this.dashboard?.budgetSummary || [])
        .filter(c => c.group !== 'income' && !c.parent_id)
        .reduce((s, c) => s + (c.actual || 0), 0);
    },
    get totalRemaining() { return this.totalBudget - this.totalActual; },
    get usagePct() {
      if (!this.totalBudget) return 0;
      return Math.min(100, Math.round(this.totalActual / this.totalBudget * 100));
    },
    get warnLevel() {
      if (!this.totalBudget) return 'no-budget';
      const r = this.totalActual / this.totalBudget;
      if (r >= 1) return 'over';
      if (r >= 0.8) return 'warning';
      return 'ok';
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
    },

    // ---- 家庭會議編輯模式 ----
    async enterEditMode() {
      this.mode = 'edit';
      this.editMonth = nextMonth();
      // 載入下月現有預算
      const buds = await Api.getMonthlyBudgets(this.editMonth);
      this.editBudgets = {};
      buds.forEach(b => { this.editBudgets[b.category_id] = Number(b.budget_amount) || 0; });
      // 載入上月實際
      if (!this.prevDashboard) {
        const pm = prevMonth(this.month);
        try { this.prevDashboard = await Api.getDashboard(pm); } catch(e) {}
      }
    },

    exitEditMode() { this.mode = 'view'; },

    lastMonthActual(catId) {
      const s = this.prevDashboard?.budgetSummary || [];
      return s.find(c => c.category_id === catId)?.actual || 0;
    },

    applyLastMonth(catId) {
      this.editBudgets[catId] = this.lastMonthActual(catId);
    },

    applyAllLastMonth(group) {
      (this.dashboard?.budgetSummary || [])
        .filter(c => c.group === group)
        .forEach(c => { this.editBudgets[c.category_id] = this.lastMonthActual(c.category_id); });
    },

    // 三段公式 computed
    editCats(group) {
      return (this.dashboard?.budgetSummary || []).filter(c => c.group === group && !c.parent_id);
    },
    get editTotalIncome() {
      return this.editCats('income').reduce((s, c) => s + (Number(this.editBudgets[c.category_id]) || 0), 0);
    },
    get editTotalFixed() {
      return this.editCats('fixed').reduce((s, c) => s + (Number(this.editBudgets[c.category_id]) || 0), 0);
    },
    get editTotalSavings() {
      return this.editCats('savings').reduce((s, c) => s + (Number(this.editBudgets[c.category_id]) || 0), 0);
    },
    get editAllocatable() {
      return this.editTotalIncome - this.editTotalFixed - this.editTotalSavings;
    },
    get editTotalVariable() {
      return ['variable', 'growth', 'discretionary'].flatMap(g => this.editCats(g))
        .reduce((s, c) => s + (Number(this.editBudgets[c.category_id]) || 0), 0);
    },
    get editUnallocated() { return this.editAllocatable - this.editTotalVariable; },

    async saveBudgets() {
      const budgets = Object.keys(this.editBudgets).map(catId => ({
        category_id: catId,
        amount: Number(this.editBudgets[catId]) || 0
      }));
      try {
        await Api.setMonthlyBudgets({ month: this.editMonth, budgets });
        alert('✅ 已寫入 ' + this.editMonth + ' 預算！');
        this.exitEditMode();
      } catch(e) {
        alert('儲存失敗：' + e.message);
      }
    }
  };
}

// ============================================================
// 報表頁（家庭總覽 + 現金流分群 + 花費分析圖表 + 夢想帳戶）
// ============================================================
function ReportsPage() {
  return {
    overview: null,
    breakdown: null,
    summary: null,
    dreamAccounts: [],
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
        [this.overview, this.breakdown, this.summary, this.dreamAccounts] = await Promise.all([
          Api.getFamilyOverview(this.month),
          Api.getCashflowBreakdown(this.month),
          Api.getBudgetSummary(this.startDate, this.endDate),
          Api.getDreamAccounts()
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

    trendIcon(trend) {
      if (trend === 'up')   return '↑';
      if (trend === 'down') return '↓';
      return '—';
    },

    trendClass(trend, higherIsBetter) {
      if (trend === 'N/A' || trend === 'flat') return 'text-gray-500';
      const good = higherIsBetter ? trend === 'up' : trend === 'down';
      return good ? 'text-green-400' : 'text-red-400';
    },

    groupColor(key) {
      const map = { fixed: '#6366f1', variable: '#3b82f6', growth: '#22c55e', discretionary: '#f97316' };
      return map[key] || '#6b7280';
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

// ---------- Global State ----------
let accountsCache = [];
let expensesCache = [];
let incomeCache = [];

// ---------- Tab Navigation ----------
function switchTab(tabId) {
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`nav a[data-tab="${tabId}"]`).classList.add('active');

    if (tabId === 'dashboard') loadDashboard();
    else if (tabId === 'accounts') loadAccounts();
    else if (tabId === 'expenses') loadExpenses();
    else if (tabId === 'income') loadIncome();
    else if (tabId === 'history') loadHistory();
    else if (tabId === 'update') loadAccountsCacheOnly();
}

// ---------- Init ----------
// checkAuth is called after page fragments are loaded (see index.html)

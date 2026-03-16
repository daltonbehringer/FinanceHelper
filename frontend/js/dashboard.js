// ---------- Dashboard ----------

async function loadDashboard() {
    const [accountsResp, expensesResp] = await Promise.all([
        apiFetch('/api/accounts'),
        apiFetch('/api/expenses'),
    ]);

    if (!accountsResp || !accountsResp.ok) return;
    const accounts = await accountsResp.json();
    accountsCache = accounts;

    // Net worth
    let totalAssets = 0, totalDebts = 0;
    accounts.forEach(a => {
        const bal = a.current_balance || 0;
        if (isDebt(a.type)) totalDebts += bal;
        else totalAssets += bal;
    });
    const netWorth = totalAssets - totalDebts;
    const el = document.getElementById('net-worth-amount');
    el.textContent = formatMoney(netWorth);
    el.className = 'amount ' + (netWorth >= 0 ? 'positive' : 'negative');

    // Monthly expenses total
    if (expensesResp && expensesResp.ok) {
        const expenses = await expensesResp.json();
        expensesCache = expenses;
        const total = expenses.filter(e => e.is_recurring !== 0).reduce((sum, e) => sum + (e.amount || 0), 0);
        document.getElementById('monthly-expenses-total').textContent = formatMoney(total);
    }

    // Account cards — split into Debts and Assets
    const cardHtml = a => `
        <div class="card account-card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3>${esc(a.name)}</h3>
                <span class="type-badge">${formatType(a.type)}</span>
            </div>
            <div class="balance" style="color:${isDebt(a.type) ? 'var(--red)' : 'var(--green)'}">
                ${formatMoney(a.current_balance)}
            </div>
            <div class="meta">
                ${a.due_date ? `<span>Due: ${formatDate(a.due_date)}</span>` : ''}
                ${a.last_updated ? `<span>Updated: ${formatDate(a.last_updated)}</span>` : ''}
            </div>
        </div>
    `;

    const debts = accounts.filter(a => isDebt(a.type));
    const assets = accounts.filter(a => !isDebt(a.type));

    const debtsGrid = document.getElementById('dashboard-debts');
    const assetsGrid = document.getElementById('dashboard-assets');

    debtsGrid.innerHTML = debts.length
        ? debts.map(cardHtml).join('')
        : '<p style="color:var(--gray-600); font-size:0.875rem; padding:0.25rem 0;">No debts.</p>';
    assetsGrid.innerHTML = assets.length
        ? assets.map(cardHtml).join('')
        : '<p style="color:var(--gray-600); font-size:0.875rem; padding:0.25rem 0;">No assets.</p>';
}

async function getRecommendation() {
    const btn = document.getElementById('recommend-btn');
    const panel = document.getElementById('recommendation-panel');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Getting recommendation...';
    panel.style.display = 'none';

    const resp = await apiFetch('/api/ai/recommend', { method: 'POST' });
    btn.disabled = false;
    btn.textContent = 'Get Recommendation';

    if (!resp || !resp.ok) {
        panel.style.display = 'block';
        panel.textContent = 'Failed to get recommendation. Please try again.';
        return;
    }
    const data = await resp.json();
    panel.style.display = 'block';
    const formatted = formatRecommendation(data.recommendation);
    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
            <strong>Recommendation</strong>
            <button class="btn btn-outline btn-sm" onclick="saveRecommendationPDF()">Save as PDF</button>
        </div>
        <div id="recommendation-text">${formatted}</div>
    `;
}

function formatRecommendation(text) {
    function inlineFmt(str) {
        let safe = esc(str);
        safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>');
        return safe;
    }
    return text
        .split('\n')
        .map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '<div style="height:0.4rem;"></div>';
            if (/^#{1,3}\s/.test(trimmed)) return `<div style="font-weight:700; margin-top:0.5rem;">${inlineFmt(trimmed.replace(/^#+\s*/, ''))}</div>`;
            if (/^[-*]\s/.test(trimmed)) return `<div style="padding-left:1rem;">&#8226; ${inlineFmt(trimmed.replace(/^[-*]\s*/, ''))}</div>`;
            if (/^\d+\.\s/.test(trimmed)) return `<div style="padding-left:1rem;">${inlineFmt(trimmed)}</div>`;
            return `<p style="margin:0.25rem 0;">${inlineFmt(trimmed)}</p>`;
        })
        .join('');
}

function saveRecommendationPDF() {
    const textEl = document.getElementById('recommendation-text');
    if (!textEl) return;
    const printWin = window.open('', '_blank');
    printWin.document.write(`
        <html><head><title>Finance Recommendation</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; line-height: 1.6; color: #333; }
            strong { display: block; margin-top: 1rem; font-size: 1.1rem; }
            div { margin: 0.25rem 0; }
            p { margin: 0.25rem 0; }
        </style></head>
        <body>
            <h2>Finance Recommendation — ${new Date().toLocaleDateString()}</h2>
            ${textEl.innerHTML}
        </body></html>
    `);
    printWin.document.close();
    printWin.print();
}

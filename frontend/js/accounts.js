// ---------- Accounts ----------

async function loadAccounts() {
    const includeInactive = document.getElementById('show-inactive').checked ? 1 : 0;
    const resp = await apiFetch(`/api/accounts?include_inactive=${includeInactive}`);
    if (!resp || !resp.ok) return;
    const accounts = await resp.json();
    accountsCache = accounts;

    const tbody = document.getElementById('accounts-table-body');
    const emptyEl = document.getElementById('accounts-empty');

    if (accounts.length === 0) {
        tbody.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    tbody.innerHTML = accounts.map(a => `
        <tr style="${a.is_active ? '' : 'opacity:0.5;'}">
            <td>${esc(a.name)}</td>
            <td>${formatType(a.type)}</td>
            <td style="color:${isDebt(a.type) ? 'var(--red)' : 'var(--green)'}">${formatMoney(a.current_balance)}</td>
            <td>${formatRate(a.interest_rate)}</td>
            <td>${formatPromo(a)}</td>
            <td>${a.minimum_payment ? formatMoney(a.minimum_payment) : '—'}</td>
            <td>${a.credit_limit ? formatMoney(a.credit_limit) : '—'}</td>
            <td>${a.due_date ? formatDate(a.due_date) : '—'}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="openEditModal(${a.id})">Edit</button>
                ${a.is_active ? `<button class="btn btn-danger btn-sm" onclick="deactivateAccount(${a.id})">Deactivate</button>` : ''}
            </td>
        </tr>
    `).join('');

    updateHistoryFilter(accounts);
}

function showAddForm() { document.getElementById('add-account-form').style.display = 'block'; }
function hideAddForm() {
    document.getElementById('add-account-form').style.display = 'none';
    document.getElementById('acc-name').value = '';
    document.getElementById('acc-balance').value = '0';
    document.getElementById('acc-rate').value = '0';
    document.getElementById('acc-min-payment').value = '';
    document.getElementById('acc-credit-limit').value = '';
    document.getElementById('acc-due-date').value = '';
    document.getElementById('acc-promo-rate').value = '';
    document.getElementById('acc-promo-end-date').value = '';
}

async function createAccount() {
    const body = {
        name: document.getElementById('acc-name').value,
        type: document.getElementById('acc-type').value,
        balance: parseFloat(document.getElementById('acc-balance').value) || 0,
        interest_rate: parseFloat(document.getElementById('acc-rate').value) || 0,
    };
    const minPay = document.getElementById('acc-min-payment').value;
    const creditLimit = document.getElementById('acc-credit-limit').value;
    const dueDate = document.getElementById('acc-due-date').value;
    const promoRate = document.getElementById('acc-promo-rate').value;
    const promoEndDate = document.getElementById('acc-promo-end-date').value;
    if (minPay) body.minimum_payment = parseFloat(minPay);
    if (creditLimit) body.credit_limit = parseFloat(creditLimit);
    if (dueDate) body.due_date = dueDate;
    if (promoRate !== '') body.promo_rate = parseFloat(promoRate);
    if (promoEndDate) body.promo_end_date = promoEndDate;

    const resp = await apiFetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    if (resp && resp.ok) {
        hideAddForm();
        loadAccounts();
    }
}

function openEditModal(id) {
    const a = accountsCache.find(acc => acc.id === id);
    if (!a) return;
    document.getElementById('edit-id').value = a.id;
    document.getElementById('edit-name').value = a.name;
    document.getElementById('edit-type').value = a.type;
    document.getElementById('edit-rate').value = a.interest_rate || '';
    document.getElementById('edit-min-payment').value = a.minimum_payment || '';
    document.getElementById('edit-credit-limit').value = a.credit_limit || '';
    document.getElementById('edit-due-date').value = a.due_date || '';
    document.getElementById('edit-promo-rate').value = a.promo_rate != null ? a.promo_rate : '';
    document.getElementById('edit-promo-end-date').value = a.promo_end_date || '';
    document.getElementById('edit-modal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

async function saveEdit() {
    const id = document.getElementById('edit-id').value;
    const body = {
        name: document.getElementById('edit-name').value,
        type: document.getElementById('edit-type').value,
        interest_rate: parseFloat(document.getElementById('edit-rate').value) || 0,
    };
    const minPay = document.getElementById('edit-min-payment').value;
    const creditLimit = document.getElementById('edit-credit-limit').value;
    const dueDate = document.getElementById('edit-due-date').value;
    const promoRate = document.getElementById('edit-promo-rate').value;
    const promoEndDate = document.getElementById('edit-promo-end-date').value;
    if (minPay) body.minimum_payment = parseFloat(minPay);
    if (creditLimit) body.credit_limit = parseFloat(creditLimit);
    if (dueDate) body.due_date = dueDate;
    if (promoRate !== '') body.promo_rate = parseFloat(promoRate);
    if (promoEndDate) body.promo_end_date = promoEndDate;

    const resp = await apiFetch(`/api/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
    if (resp && resp.ok) {
        closeEditModal();
        loadAccounts();
    }
}

async function deactivateAccount(id) {
    if (!confirm('Deactivate this account?')) return;
    const resp = await apiFetch(`/api/accounts/${id}/deactivate`, { method: 'POST' });
    if (resp && resp.ok) loadAccounts();
}

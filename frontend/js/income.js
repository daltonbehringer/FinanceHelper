// ---------- Income ----------

async function loadIncome() {
    const includeInactive = document.getElementById('show-inactive-income').checked ? 1 : 0;
    const resp = await apiFetch(`/api/income?include_inactive=${includeInactive}`);
    if (!resp || !resp.ok) return;
    const income = await resp.json();
    incomeCache = income;

    const tbody = document.getElementById('income-table-body');
    const emptyEl = document.getElementById('income-empty');

    if (income.length === 0) {
        tbody.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    tbody.innerHTML = income.map(i => `
        <tr style="${i.is_active ? '' : 'opacity:0.5;'}">
            <td>${esc(i.name)}</td>
            <td>${formatMoney(i.amount)}</td>
            <td>${formatFrequency(i.frequency)}</td>
            <td style="color:var(--green);">${formatMoney(monthlyEquiv(i.amount, i.frequency))}</td>
            <td>${i.income_day != null ? 'Day ' + i.income_day : '—'}</td>
            <td>${i.last_pay_date ? formatDate(i.last_pay_date) : '—'}</td>
            <td style="color:var(--green); font-weight:500;">${nextPayday(i.last_pay_date, i.frequency)}</td>
            <td>
                ${i.is_active && i.last_pay_date ? `<button class="btn btn-success btn-sm" onclick="markAsPaid(${i.id})">Mark Paid</button>` : ''}
                <button class="btn btn-outline btn-sm" onclick="openEditIncomeModal(${i.id})">Edit</button>
                ${i.is_active ? `<button class="btn btn-danger btn-sm" onclick="deactivateIncome(${i.id})">Deactivate</button>` : ''}
            </td>
        </tr>
    `).join('');
}

function showAddIncomeForm() { document.getElementById('add-income-form').style.display = 'block'; }
function hideAddIncomeForm() {
    document.getElementById('add-income-form').style.display = 'none';
    document.getElementById('inc-name').value = '';
    document.getElementById('inc-amount').value = '';
    document.getElementById('inc-frequency').value = 'monthly';
    document.getElementById('inc-income-day').value = '';
    document.getElementById('inc-last-pay-date').value = '';
}

async function createIncome() {
    const name = document.getElementById('inc-name').value.trim();
    const amount = parseFloat(document.getElementById('inc-amount').value);
    if (!name || isNaN(amount)) {
        alert('Name and amount are required.');
        return;
    }
    const body = {
        name,
        amount,
        frequency: document.getElementById('inc-frequency').value,
    };
    const incomeDay = document.getElementById('inc-income-day').value;
    if (incomeDay) body.income_day = parseInt(incomeDay);
    const lastPayDate = document.getElementById('inc-last-pay-date').value;
    if (lastPayDate) body.last_pay_date = lastPayDate;

    const resp = await apiFetch('/api/income', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    if (resp && resp.ok) {
        hideAddIncomeForm();
        loadIncome();
    } else if (resp) {
        const err = await resp.json();
        alert(err.detail || 'Failed to save income.');
    }
}

function openEditIncomeModal(id) {
    const i = incomeCache.find(x => x.id === id);
    if (!i) return;
    document.getElementById('edit-income-id').value = i.id;
    document.getElementById('edit-inc-name').value = i.name;
    document.getElementById('edit-inc-amount').value = i.amount;
    document.getElementById('edit-inc-frequency').value = i.frequency;
    document.getElementById('edit-inc-income-day').value = i.income_day != null ? i.income_day : '';
    document.getElementById('edit-inc-last-pay-date').value = i.last_pay_date || '';
    document.getElementById('edit-income-modal').classList.add('active');
}

function closeEditIncomeModal() {
    document.getElementById('edit-income-modal').classList.remove('active');
}

async function saveIncomeEdit() {
    const id = document.getElementById('edit-income-id').value;
    const body = {
        name: document.getElementById('edit-inc-name').value,
        amount: parseFloat(document.getElementById('edit-inc-amount').value),
        frequency: document.getElementById('edit-inc-frequency').value,
    };
    const incomeDay = document.getElementById('edit-inc-income-day').value;
    if (incomeDay) body.income_day = parseInt(incomeDay);
    const lastPayDate = document.getElementById('edit-inc-last-pay-date').value;
    if (lastPayDate) body.last_pay_date = lastPayDate;

    const resp = await apiFetch(`/api/income/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
    if (resp && resp.ok) {
        closeEditIncomeModal();
        loadIncome();
    }
}

async function deactivateIncome(id) {
    if (!confirm('Deactivate this income source?')) return;
    const resp = await apiFetch(`/api/income/${id}/deactivate`, { method: 'POST' });
    if (resp && resp.ok) loadIncome();
}

async function markAsPaid(id) {
    const today = new Date().toISOString().split('T')[0];
    const resp = await apiFetch(`/api/income/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ last_pay_date: today }),
    });
    if (resp && resp.ok) loadIncome();
}

// ---------- Expenses ----------

async function loadExpenses() {
    const includeInactive = document.getElementById('show-inactive-expenses').checked ? 1 : 0;
    const resp = await apiFetch(`/api/expenses?include_inactive=${includeInactive}`);
    if (!resp || !resp.ok) return;
    const expenses = await resp.json();
    expensesCache = expenses;

    const tbody = document.getElementById('expenses-table-body');
    const emptyEl = document.getElementById('expenses-empty');

    if (expenses.length === 0) {
        tbody.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    tbody.innerHTML = expenses.map(e => {
        const isRecurring = e.is_recurring !== 0;
        const dueCol = isRecurring
            ? (e.due_day != null ? 'Day ' + e.due_day : '—')
            : (e.due_date ? formatDate(e.due_date) : '—');
        return `
            <tr style="${e.is_active ? '' : 'opacity:0.5;'}">
                <td>${esc(e.name)}</td>
                <td>${formatMoney(e.amount)}</td>
                <td>${isRecurring ? 'Recurring' : 'One-time'}</td>
                <td>${esc(e.category || '—')}</td>
                <td>${dueCol}</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="openEditExpenseModal(${e.id})">Edit</button>
                    ${e.is_active ? `<button class="btn btn-danger btn-sm" onclick="deactivateExpense(${e.id})">Deactivate</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// ---------- Add form ----------

function toggleExpenseType() {
    const oneTime = document.getElementById('exp-one-time').checked;
    document.getElementById('exp-recurring-fields').style.display = oneTime ? 'none' : '';
    document.getElementById('exp-onetime-fields').style.display = oneTime ? '' : 'none';
}

function showAddExpenseForm() { document.getElementById('add-expense-form').style.display = 'block'; }
function hideAddExpenseForm() {
    document.getElementById('add-expense-form').style.display = 'none';
    document.getElementById('exp-name').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-category').value = '';
    document.getElementById('exp-due-day').value = '';
    document.getElementById('exp-due-date').value = '';
    document.getElementById('exp-one-time').checked = false;
    toggleExpenseType();
}

async function createExpense() {
    const name = document.getElementById('exp-name').value.trim();
    const amount = parseFloat(document.getElementById('exp-amount').value);
    if (!name || isNaN(amount)) {
        alert('Name and amount are required.');
        return;
    }
    const isOneTime = document.getElementById('exp-one-time').checked;
    const body = { name, amount, is_recurring: !isOneTime };

    if (isOneTime) {
        const dueDate = document.getElementById('exp-due-date').value;
        if (dueDate) body.due_date = dueDate;
    } else {
        const dueDayVal = document.getElementById('exp-due-day').value;
        if (dueDayVal) body.due_day = parseInt(dueDayVal);
    }

    const category = document.getElementById('exp-category').value.trim();
    if (category) body.category = category;

    const resp = await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    if (resp && resp.ok) {
        hideAddExpenseForm();
        loadExpenses();
    } else if (resp) {
        const err = await resp.json();
        alert(err.detail || 'Failed to save expense.');
    }
}

// ---------- Edit modal ----------

function toggleEditExpenseType() {
    const oneTime = document.getElementById('edit-exp-one-time').checked;
    document.getElementById('edit-exp-recurring-fields').style.display = oneTime ? 'none' : '';
    document.getElementById('edit-exp-onetime-fields').style.display = oneTime ? '' : 'none';
}

function openEditExpenseModal(id) {
    const e = expensesCache.find(ex => ex.id === id);
    if (!e) return;
    const isOneTime = e.is_recurring === 0;
    document.getElementById('edit-expense-id').value = e.id;
    document.getElementById('edit-exp-name').value = e.name;
    document.getElementById('edit-exp-amount').value = e.amount;
    document.getElementById('edit-exp-category').value = e.category || '';
    document.getElementById('edit-exp-due-day').value = e.due_day != null ? e.due_day : '';
    document.getElementById('edit-exp-due-date').value = e.due_date || '';
    document.getElementById('edit-exp-one-time').checked = isOneTime;
    toggleEditExpenseType();
    document.getElementById('edit-expense-modal').classList.add('active');
}

function closeEditExpenseModal() {
    document.getElementById('edit-expense-modal').classList.remove('active');
}

async function saveExpenseEdit() {
    const id = document.getElementById('edit-expense-id').value;
    const isOneTime = document.getElementById('edit-exp-one-time').checked;
    const body = {
        name: document.getElementById('edit-exp-name').value,
        amount: parseFloat(document.getElementById('edit-exp-amount').value),
        is_recurring: !isOneTime,
    };

    if (isOneTime) {
        const dueDate = document.getElementById('edit-exp-due-date').value;
        if (dueDate) body.due_date = dueDate;
    } else {
        const dueDayVal = document.getElementById('edit-exp-due-day').value;
        if (dueDayVal) body.due_day = parseInt(dueDayVal);
    }

    const category = document.getElementById('edit-exp-category').value.trim();
    if (category) body.category = category;

    const resp = await apiFetch(`/api/expenses/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
    if (resp && resp.ok) {
        closeEditExpenseModal();
        loadExpenses();
    }
}

async function deactivateExpense(id) {
    if (!confirm('Deactivate this expense?')) return;
    const resp = await apiFetch(`/api/expenses/${id}/deactivate`, { method: 'POST' });
    if (resp && resp.ok) loadExpenses();
}

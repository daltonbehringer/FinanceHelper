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
    tbody.innerHTML = expenses.map(e => `
        <tr style="${e.is_active ? '' : 'opacity:0.5;'}">
            <td>${esc(e.name)}</td>
            <td>${formatMoney(e.amount)}</td>
            <td>${esc(e.category || '—')}</td>
            <td>${e.due_day != null ? 'Day ' + e.due_day : '—'}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="openEditExpenseModal(${e.id})">Edit</button>
                ${e.is_active ? `<button class="btn btn-danger btn-sm" onclick="deactivateExpense(${e.id})">Deactivate</button>` : ''}
            </td>
        </tr>
    `).join('');
}

function showAddExpenseForm() { document.getElementById('add-expense-form').style.display = 'block'; }
function hideAddExpenseForm() {
    document.getElementById('add-expense-form').style.display = 'none';
    document.getElementById('exp-name').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-category').value = '';
    document.getElementById('exp-due-day').value = '';
}

async function createExpense() {
    const name = document.getElementById('exp-name').value.trim();
    const amount = parseFloat(document.getElementById('exp-amount').value);
    if (!name || isNaN(amount)) {
        alert('Name and amount are required.');
        return;
    }
    const body = { name, amount };
    const dueDayVal = document.getElementById('exp-due-day').value;
    if (dueDayVal) body.due_day = parseInt(dueDayVal);
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

function openEditExpenseModal(id) {
    const e = expensesCache.find(ex => ex.id === id);
    if (!e) return;
    document.getElementById('edit-expense-id').value = e.id;
    document.getElementById('edit-exp-name').value = e.name;
    document.getElementById('edit-exp-amount').value = e.amount;
    document.getElementById('edit-exp-category').value = e.category || '';
    document.getElementById('edit-exp-due-day').value = e.due_day != null ? e.due_day : '';
    document.getElementById('edit-expense-modal').classList.add('active');
}

function closeEditExpenseModal() {
    document.getElementById('edit-expense-modal').classList.remove('active');
}

async function saveExpenseEdit() {
    const id = document.getElementById('edit-expense-id').value;
    const body = {
        name: document.getElementById('edit-exp-name').value,
        amount: parseFloat(document.getElementById('edit-exp-amount').value),
    };
    const dueDayVal = document.getElementById('edit-exp-due-day').value;
    if (dueDayVal) body.due_day = parseInt(dueDayVal);
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

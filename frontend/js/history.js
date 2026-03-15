// ---------- History ----------

function updateHistoryFilter(accounts) {
    const sel = document.getElementById('history-filter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All Accounts</option>' +
        accounts.filter(a => a.is_active).map(a =>
            `<option value="${a.id}">${esc(a.name)}</option>`
        ).join('');
    sel.value = current;
}

async function loadHistory() {
    const accountId = document.getElementById('history-filter').value;
    const url = accountId ? `/api/snapshots?account_id=${accountId}` : '/api/snapshots';
    const resp = await apiFetch(url);
    if (!resp || !resp.ok) return;
    const snapshots = await resp.json();

    const tbody = document.getElementById('history-table-body');
    const emptyEl = document.getElementById('history-empty');

    if (snapshots.length === 0) {
        tbody.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    tbody.innerHTML = snapshots.map(s => `
        <tr>
            <td>${formatDate(s.recorded_at)}</td>
            <td>${esc(s.account_name)}</td>
            <td>${formatMoney(s.balance)}</td>
            <td>${s.payment_made != null ? formatMoney(s.payment_made) : '—'}</td>
            <td>${esc(s.note || '')}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="restoreSnapshot(${s.id})">Restore</button>
            </td>
        </tr>
    `).join('');
}

async function restoreSnapshot(id) {
    if (!confirm('Undo to this point? All newer snapshots for this account will be removed.')) return;
    const resp = await apiFetch(`/api/snapshots/${id}/restore`, { method: 'POST' });
    if (resp && resp.ok) {
        loadHistory();
        const accountsResp = await apiFetch('/api/accounts');
        if (accountsResp && accountsResp.ok) accountsCache = await accountsResp.json();
    } else {
        alert('Failed to restore snapshot.');
    }
}

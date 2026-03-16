// ---------- Ask / Update Balances ----------

async function loadAccountsCacheOnly() {
    if (accountsCache.length === 0) {
        const resp = await apiFetch('/api/accounts');
        if (resp && resp.ok) accountsCache = await resp.json();
    }
}

async function submitChat(prefix = '') {
    const text = document.getElementById(prefix + 'update-text').value.trim();
    if (!text) return;

    const btn = document.getElementById(prefix + 'parse-btn');
    const errorEl = document.getElementById(prefix + 'parse-error');
    const previewEl = document.getElementById(prefix + 'parse-preview');
    errorEl.style.display = 'none';
    previewEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Thinking...';

    const resp = await apiFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ text }),
    });
    btn.disabled = false;
    btn.textContent = prefix ? 'Send' : 'Send';

    if (!resp || !resp.ok) {
        errorEl.textContent = 'Something went wrong. Please try again.';
        errorEl.style.display = 'block';
        return;
    }

    const parsed = await resp.json();

    if (parsed.type === 'question') {
        previewEl.style.display = 'block';
        previewEl.innerHTML = renderAnswer(parsed.answer);
        return;
    }

    // Balance update flow
    if (parsed.new_balance == null && parsed.payment_made == null) {
        errorEl.textContent = 'No balance or payment amount found. Please include a dollar amount (e.g. "Chase balance is $4,200" or "paid $300 on Discover").';
        errorEl.style.display = 'block';
        return;
    }

    if (parsed.account_id == null) {
        errorEl.innerHTML = 'Could not identify the account. Please select manually:';
        const selectHtml = `
            <select id="${prefix}manual-account-select" style="margin-top:0.5rem;">
                <option value="">Select an account</option>
                ${accountsCache.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
            </select>
        `;
        errorEl.innerHTML += selectHtml;
        errorEl.style.display = 'block';

        previewEl.style.display = 'block';
        previewEl.innerHTML = renderPreview({ ...parsed, _manualSelect: true }, prefix);
        return;
    }

    previewEl.style.display = 'block';
    previewEl.innerHTML = renderPreview(parsed, prefix);
}

function renderAnswer(text) {
    const formatted = formatRecommendation(text);
    return `
        <div class="card" style="margin-top:1rem; background:var(--blue-bg); border-color:var(--blue);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                <strong style="font-size:0.85rem; color:var(--navy);">Advisor</strong>
            </div>
            <div style="font-size:0.9rem; line-height:1.6;">${formatted}</div>
        </div>
    `;
}

function renderPreview(parsed, prefix = '') {
    const account = accountsCache.find(a => a.id === parsed.account_id);
    const accountName = account ? account.name : (parsed._manualSelect ? '(Select above)' : 'Unknown');
    const currentBalance = account ? (account.current_balance ?? account.balance ?? null) : null;
    const parsedJson = JSON.stringify({...parsed, _prefix: prefix}).replace(/"/g, '&quot;');
    return `
        <div class="preview-card">
            <div class="field"><span class="field-label">Account:</span> ${esc(accountName)}</div>
            ${currentBalance != null ? `<div class="field"><span class="field-label">Current Balance:</span> ${formatMoney(currentBalance)}</div>` : ''}
            <div class="field"><span class="field-label">New Balance:</span> ${parsed.new_balance != null ? formatMoney(parsed.new_balance) : '—'}</div>
            <div class="field"><span class="field-label">Payment Made:</span> ${parsed.payment_made != null ? formatMoney(parsed.payment_made) : '—'}</div>
            <div class="field"><span class="field-label">Note:</span> ${esc(parsed.note || '')}</div>
            <div class="preview-actions">
                <button class="btn btn-success" onclick="confirmUpdate(${parsedJson})">Confirm</button>
                <button class="btn btn-outline" onclick="cancelUpdate('${prefix}')">Cancel</button>
            </div>
        </div>
    `;
}

async function confirmUpdate(parsed) {
    const prefix = parsed._prefix || '';
    let accountId = parsed.account_id;
    if (!accountId) {
        const sel = document.getElementById(prefix + 'manual-account-select');
        if (sel) accountId = parseInt(sel.value);
        if (!accountId) {
            alert('Please select an account.');
            return;
        }
    }

    const body = { account_id: accountId, balance: parsed.new_balance || 0 };
    if (parsed.payment_made != null) body.payment_made = parsed.payment_made;
    if (parsed.note) body.note = parsed.note;

    const resp = await apiFetch('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    const previewEl = document.getElementById(prefix + 'parse-preview');
    const errorEl = document.getElementById(prefix + 'parse-error');

    if (resp && resp.ok) {
        previewEl.innerHTML = '<div class="alert alert-success">Balance updated successfully!</div>';
        errorEl.style.display = 'none';
        document.getElementById(prefix + 'update-text').value = '';
        setTimeout(() => { previewEl.style.display = 'none'; }, 3000);
        if (prefix) loadDashboard();
    } else {
        previewEl.innerHTML = '<div class="alert alert-error">Failed to save update.</div>';
    }
}

function cancelUpdate(prefix = '') {
    document.getElementById(prefix + 'parse-preview').style.display = 'none';
    document.getElementById(prefix + 'parse-error').style.display = 'none';
}

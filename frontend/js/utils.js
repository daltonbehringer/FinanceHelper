// ---------- Formatting Utilities ----------

const MONTHLY_MULTIPLIERS = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    semimonthly: 2.0,
    monthly: 1.0,
    annual: 1 / 12,
};

function monthlyEquiv(amount, frequency) {
    return amount * (MONTHLY_MULTIPLIERS[frequency] || 1);
}

function formatFrequency(f) {
    return { weekly: 'Weekly', biweekly: 'Biweekly', semimonthly: 'Semimonthly', monthly: 'Monthly', annual: 'Annual' }[f] || f;
}

function nextPayday(lastPayDate, frequency) {
    if (!lastPayDate) return '—';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let d = new Date(lastPayDate + 'T00:00:00');
    function advance(date) {
        const next = new Date(date);
        if (frequency === 'weekly')         next.setDate(next.getDate() + 7);
        else if (frequency === 'biweekly')  next.setDate(next.getDate() + 14);
        else if (frequency === 'semimonthly') next.setDate(next.getDate() + 15);
        else if (frequency === 'monthly')   next.setMonth(next.getMonth() + 1);
        else if (frequency === 'annual')    next.setFullYear(next.getFullYear() + 1);
        return next;
    }
    while (d <= today) d = advance(d);
    return formatDate(d.toISOString().split('T')[0]);
}

function formatMoney(amount) {
    if (amount == null) return '—';
    const sign = amount < 0 ? '-' : '';
    return sign + '$' + Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRate(rate) {
    if (rate == null) return '—';
    return rate.toFixed(2) + '%';
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = dateStr.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[month - 1]} ${String(day).padStart(2, '0')}, ${year}`;
}

function formatType(type) {
    if (type === '401k') return '401(k)';
    if (type === 'ira') return 'IRA';
    if (type === 'roth_ira') return 'Roth IRA';
    if (type === 'hsa') return 'HSA';
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isDebt(type) {
    return ['credit_card', 'loan', 'mortgage', 'line_of_credit'].includes(type);
}

function formatPromo(account) {
    if (account.promo_rate == null) return '—';
    const rate = `${account.promo_rate.toFixed(2)}%`;
    if (account.promo_end_date) {
        return `<span class="promo-badge">${rate} until ${formatDate(account.promo_end_date)}</span>`;
    }
    return `<span class="promo-badge">${rate}</span>`;
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

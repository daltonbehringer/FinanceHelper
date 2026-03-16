// ---------- API & Auth ----------

function getToken() {
    const match = document.cookie.match(/(?:^|; )stytch_session=([^;]*)/);
    return match ? match[1] : null;
}

async function apiFetch(url, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { ...options, headers });
    if (resp.status === 401) {
        window.location.href = '/auth/login';
        return null;
    }
    return resp;
}

async function checkAuth() {
    const resp = await apiFetch('/auth/me');
    if (!resp) return;
    if (!resp.ok) {
        window.location.href = '/auth/login';
        return;
    }
    const data = await resp.json();
    document.getElementById('user-email').textContent = data.email;
    loadDashboard();
}

async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    document.cookie = 'stytch_session=; Max-Age=0; path=/';
    window.location.href = '/auth/login';
}

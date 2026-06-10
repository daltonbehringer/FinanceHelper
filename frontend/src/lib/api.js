const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  // The session lives in an HttpOnly cookie set by the backend; we just need
  // the browser to send it. No token is read or attached in JS.
  const resp = await fetch(API_BASE + path, { ...options, headers, credentials: 'include' })
  if (resp.status === 401) {
    window.location.href = API_BASE + '/api/auth/login'
    return null
  }
  return resp
}

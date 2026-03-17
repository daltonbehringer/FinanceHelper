const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export function getToken() {
  const match = document.cookie.match(/(?:^|; )stytch_session=([^;]*)/)
  return match ? match[1] : null
}

export async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const resp = await fetch(API_BASE + path, { ...options, headers })
  if (resp.status === 401) {
    window.location.href = API_BASE + '/auth/login'
    return null
  }
  return resp
}

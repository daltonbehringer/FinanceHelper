export function getToken() {
  const match = document.cookie.match(/(?:^|; )stytch_session=([^;]*)/)
  return match ? match[1] : null
}

export async function apiFetch(url, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const resp = await fetch(url, { ...options, headers })
  if (resp.status === 401) {
    window.location.href = '/auth/login'
    return null
  }
  return resp
}

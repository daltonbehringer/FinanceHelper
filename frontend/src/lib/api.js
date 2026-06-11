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

function parseSSEBlock(raw) {
  let event = null
  const dataLines = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!event || dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

// POST a JSON body and consume a text/event-stream response, invoking callbacks
// per SSE event. Used by the advisor chat: `text` deltas stream in, then either
// `pending_action` (a proposed write awaiting confirmation) or `done`.
export async function apiStream(path, body, { onText, onPending, onError, onDone, signal } = {}) {
  let resp
  try {
    resp = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    })
  } catch {
    onError?.('Could not reach the advisor. Please try again.')
    return
  }
  if (resp.status === 401) {
    window.location.href = API_BASE + '/api/auth/login'
    return
  }
  if (!resp.ok || !resp.body) {
    onError?.('The advisor is unavailable right now. Please try again.')
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const parsed = parseSSEBlock(raw)
        if (!parsed) continue
        const { event, data } = parsed
        if (event === 'text') onText?.(data.text || '')
        else if (event === 'pending_action') onPending?.(data)
        else if (event === 'error') onError?.(data.detail || 'Something went wrong.')
        else if (event === 'done') onDone?.()
      }
    }
  } catch {
    onError?.('The connection was interrupted. Please try again.')
  }
}

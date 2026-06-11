import { useEffect, useRef, useState } from 'react'
import { apiFetch, apiStream } from '../lib/api'

// Owns the advisor conversation: the Anthropic-format history sent to the server
// (client-held), the display thread, the SSE stream, and the pending confirmation
// lifecycle. Mounted ONCE in AdvisorChatContext so the thread is shared across the
// Dashboard widget and the Chat page and survives navigation.
//
// History is persisted to localStorage (keyed by user) at settled points only —
// when status is 'idle', the history is balanced (no dangling tool_use), so a
// reload never restores a half-finished proposal.
//
// State machine: idle → streaming → (idle | awaiting_confirmation)
//                awaiting_confirmation → confirming → idle

const STORAGE_PREFIX = 'advisorChat:'

function storageKey(userId) {
  return STORAGE_PREFIX + (userId ?? 'default')
}

function loadHistory(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!Array.isArray(data?.thread) || !Array.isArray(data?.apiHistory)) return null
    return data
  } catch {
    return null
  }
}

export function useAdvisorChat({ onUpdate, onExpenseUpdate, userId } = {}) {
  // Load persisted history once (user is resolved before this mounts).
  const [initial] = useState(() => loadHistory(userId) || { thread: [], apiHistory: [] })
  const apiHistory = useRef(initial.apiHistory)
  const [thread, setThread] = useState(initial.thread)
  const [pending, setPending] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const busy = status === 'streaming' || status === 'confirming'

  // Persist only when settled: a 'pending' proposal and in-flight streams are not
  // saved, so the stored history is always a valid (balanced) message list.
  useEffect(() => {
    if (status !== 'idle') return
    try {
      localStorage.setItem(
        storageKey(userId),
        JSON.stringify({ thread, apiHistory: apiHistory.current }),
      )
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, [thread, status, userId])

  function _setLastAssistant(content, streaming) {
    setThread((t) => {
      const next = [...t]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant' && !next[i].system) {
          next[i] = { ...next[i], content, streaming }
          break
        }
      }
      return next
    })
  }

  function _dropStreamingPlaceholder() {
    setThread((t) => t.filter((m) => !(m.role === 'assistant' && m.streaming && !m.content)))
  }

  async function send(text) {
    const clean = (text || '').trim()
    if (!clean || busy) return
    setError('')
    apiHistory.current = [...apiHistory.current, { role: 'user', content: clean }]
    setThread((t) => [
      ...t,
      { role: 'user', content: clean },
      { role: 'assistant', content: '', streaming: true },
    ])
    setStatus('streaming')
    setPending(null)

    let acc = ''
    let proposed = false

    await apiStream('/api/ai/chat', { messages: apiHistory.current }, {
      onText: (delta) => {
        acc += delta
        _setLastAssistant(acc, true)
      },
      onPending: (data) => {
        proposed = true
        const blocks = []
        if (data.text) blocks.push({ type: 'text', text: data.text })
        blocks.push({
          type: 'tool_use',
          id: data.tool_use.id,
          name: data.tool_use.name,
          input: data.tool_use.input,
        })
        apiHistory.current = [...apiHistory.current, { role: 'assistant', content: blocks }]
        _setLastAssistant(data.text || acc, false)
        setPending({
          id: data.pending_action_id,
          preview: data.preview,
          toolName: data.tool_use.name,
        })
        setStatus('awaiting_confirmation')
      },
      onError: (detail) => {
        _dropStreamingPlaceholder()
        setError(detail)
        setStatus('idle')
      },
      onDone: () => {
        if (!proposed) {
          apiHistory.current = [...apiHistory.current, { role: 'assistant', content: acc }]
          _setLastAssistant(acc, false)
          setStatus('idle')
        }
      },
    })
  }

  async function confirm() {
    if (!pending || status === 'confirming') return
    setStatus('confirming')
    setError('')
    const resp = await apiFetch(`/api/ai/actions/${pending.id}/confirm`, { method: 'POST' })
    if (!resp || !resp.ok) {
      let detail = 'Could not apply the change. Please try again.'
      try { detail = (await resp.json()).detail || detail } catch { /* ignore */ }
      setError(detail)
      setPending(null)
      setStatus('idle')
      return
    }
    const body = await resp.json()
    apiHistory.current = [...apiHistory.current, { role: 'user', content: [body.tool_result] }]
    setThread((t) => [...t, { role: 'assistant', content: body.message, system: true }])
    const toolName = pending.toolName
    setPending(null)
    setStatus('idle')
    onUpdate?.()
    if (toolName === 'pay_expense') onExpenseUpdate?.()
  }

  async function cancel() {
    if (!pending) return
    const resp = await apiFetch(`/api/ai/actions/${pending.id}/cancel`, { method: 'POST' })
    if (resp && resp.ok) {
      const body = await resp.json()
      apiHistory.current = [...apiHistory.current, { role: 'user', content: [body.tool_result] }]
      setThread((t) => [...t, { role: 'assistant', content: body.message, system: true }])
    }
    setPending(null)
    setStatus('idle')
  }

  function clear() {
    apiHistory.current = []
    setThread([])
    setPending(null)
    setStatus('idle')
    setError('')
    try { localStorage.removeItem(storageKey(userId)) } catch { /* ignore */ }
  }

  return { thread, pending, status, error, busy, send, confirm, cancel, clear }
}

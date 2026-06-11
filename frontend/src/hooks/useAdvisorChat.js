import { useRef, useState } from 'react'
import { apiFetch, apiStream } from '../lib/api'

// Owns the advisor conversation: the Anthropic-format history sent to the
// server (client-held), the display thread, the SSE stream, and the pending
// confirmation lifecycle.
//
// State machine: idle → streaming → (idle | awaiting_confirmation)
//                awaiting_confirmation → confirming → idle
//
// The server holds only the single-use pending_actions row; everything else
// (history) lives here and is sent per request.
export function useAdvisorChat({ onUpdate, onExpenseUpdate } = {}) {
  const apiHistory = useRef([]) // Anthropic messages: user strings, assistant blocks, tool_result user blocks
  const [thread, setThread] = useState([]) // display messages: {role, content, system?}
  const [pending, setPending] = useState(null) // {id, preview, toolName}
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const busy = status === 'streaming' || status === 'confirming'

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

  return { thread, pending, status, error, busy, send, confirm, cancel }
}

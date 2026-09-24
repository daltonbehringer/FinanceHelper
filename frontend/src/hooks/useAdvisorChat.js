import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiStream } from '../lib/api'
import { ADVISOR_TTL_MS, advisorStorageKey, loadAdvisorHistory } from '../lib/advisor'

// Shared across routes. Only settled conversations are persisted, and every
// conversation has a fixed 24-hour deadline that follow-ups never extend.
export function useAdvisorChat({ onUpdate, onExpenseUpdate, userId } = {}) {
  const [conversation, setConversation] = useState(() => loadAdvisorHistory(userId) || { thread: [], apiHistory: [], expiresAt: null })
  const { thread, expiresAt } = conversation
  const apiHistory = useRef(conversation.apiHistory || [])
  const deadline = useRef(expiresAt)
  const generation = useRef(0)
  const streamController = useRef(null)
  const statusRef = useRef('idle')
  const setThread = useCallback(next => setConversation(current => ({
    thread: typeof next === 'function' ? next(current.thread) : next, expiresAt: current.expiresAt,
  })), [])
  const [pending, setPending] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const busy = status === 'streaming' || status === 'confirming'

  function changeStatus(next) {
    statusRef.current = next
    setStatus(next)
  }

  const clear = useCallback((expired = false) => {
    generation.current += 1
    streamController.current?.abort()
    streamController.current = null
    apiHistory.current = []
    deadline.current = null
    statusRef.current = 'idle'
    setConversation({ thread: [], expiresAt: null })
    setPending(null)
    setStatus('idle')
    setError('')
    setNotice(expired ? 'Your conversation expired after 24 hours. Ask again for fresh guidance.' : '')
    try { localStorage.removeItem(advisorStorageKey(userId)) } catch { /* storage unavailable */ }
  }, [userId])

  const expireIfNeeded = useCallback(() => {
    if (deadline.current && deadline.current <= Date.now()) {
      clear(true)
      return true
    }
    return false
  }, [clear])

  useEffect(() => {
    const timeout = expiresAt ? setTimeout(expireIfNeeded, Math.max(0, expiresAt - Date.now())) : null
    // Timers can be suspended in background tabs. Recheck when the app resumes.
    window.addEventListener('focus', expireIfNeeded)
    document.addEventListener('visibilitychange', expireIfNeeded)
    const onStorage = event => {
      if (event.key === advisorStorageKey(userId) && event.newValue === null) clear()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('focus', expireIfNeeded)
      document.removeEventListener('visibilitychange', expireIfNeeded)
      window.removeEventListener('storage', onStorage)
    }
  }, [expiresAt, expireIfNeeded, clear, userId])

  useEffect(() => () => {
    generation.current += 1
    streamController.current?.abort()
  }, [])

  useEffect(() => {
    if (status !== 'idle' || !expiresAt || expiresAt <= Date.now()) return
    try {
      localStorage.setItem(advisorStorageKey(userId), JSON.stringify({ thread, apiHistory: apiHistory.current, expiresAt }))
    } catch { /* storage full or unavailable — non-fatal */ }
  }, [thread, status, expiresAt, userId])

  function setLastAssistant(content, streaming) {
    setThread(t => {
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

  async function send(text, { fresh = false } = {}) {
    const clean = (text || '').trim()
    expireIfNeeded()
    // Do not replace an in-flight request or an unreviewed financial proposal.
    if (!clean || statusRef.current !== 'idle') return
    if (fresh) clear()
    if (!deadline.current) {
      deadline.current = Date.now() + ADVISOR_TTL_MS
      const nextDeadline = deadline.current
      setConversation(current => ({ thread: current.thread, expiresAt: nextDeadline }))
    }
    const requestGeneration = generation.current
    const active = () => !expireIfNeeded() && generation.current === requestGeneration
    const controller = new AbortController()
    streamController.current = controller
    setError('')
    setNotice('')
    apiHistory.current = [...apiHistory.current, { role: 'user', content: clean }]
    setThread(t => [...t, { role: 'user', content: clean }, { role: 'assistant', content: '', streaming: true }])
    changeStatus('streaming')
    let acc = ''
    let proposed = false
    let finished = false
    let failed = false
    function fail(detail) {
      if (!active() || failed) return
      failed = true
      setThread(t => t.filter(m => !(m.role === 'assistant' && m.streaming && !m.content)).map(m => ({ ...m, streaming: false })))
      setError(detail)
      changeStatus(proposed ? 'awaiting_confirmation' : 'idle')
    }

    await apiStream('/api/ai/chat', { messages: apiHistory.current, ...(fresh ? { mode: 'advice' } : {}) }, {
      signal: controller.signal,
      onText: delta => {
        if (!active() || failed) return
        acc += delta
        setLastAssistant(acc, true)
      },
      onPending: data => {
        if (!active() || failed) return
        proposed = true
        const blocks = []
        if (data.text) blocks.push({ type: 'text', text: data.text })
        blocks.push({ type: 'tool_use', id: data.tool_use.id, name: data.tool_use.name, input: data.tool_use.input })
        apiHistory.current = [...apiHistory.current, { role: 'assistant', content: blocks }]
        setLastAssistant(data.text || acc, false)
        setPending({ id: data.pending_action_id, preview: data.preview, toolName: data.tool_use.name, toolUseId: data.tool_use.id })
        changeStatus('awaiting_confirmation')
      },
      onError: fail,
      onDone: () => {
        if (!active() || failed) return
        finished = true
        if (!proposed) {
          apiHistory.current = [...apiHistory.current, { role: 'assistant', content: acc }]
          setLastAssistant(acc, false)
          changeStatus('idle')
        }
      },
    })
    if (!finished && !proposed && !failed) fail('The response ended early. Please ask again.')
    if (streamController.current === controller) streamController.current = null
  }

  async function resolveProposal(action) {
    if (expireIfNeeded() || !pending || statusRef.current !== 'awaiting_confirmation') return
    const proposal = pending
    const requestGeneration = generation.current
    changeStatus('confirming')
    setError('')
    try {
      const resp = await apiFetch(`/api/ai/actions/${proposal.id}/${action}`, { method: 'POST' })
      const body = await resp?.json().catch(() => ({}))
      // A confirmed write remains real even if the conversation expired while
      // the request was in flight. Refresh financial data, but don't restore chat.
      if (resp?.ok && action === 'confirm') {
        onUpdate?.()
        if (proposal.toolName === 'pay_expense') onExpenseUpdate?.()
      }
      if (expireIfNeeded() || generation.current !== requestGeneration) return
      if (!resp?.ok) {
        if (resp?.status === 404 || resp?.status === 409) {
          apiHistory.current = [...apiHistory.current, { role: 'user', content: [{
            type: 'tool_result', tool_use_id: proposal.toolUseId,
            content: body?.detail || 'This proposal is no longer available. Ask for a new proposal.', is_error: true,
          }] }]
          setPending(null)
          changeStatus('idle')
        } else changeStatus('awaiting_confirmation')
        setError(body?.detail || 'Could not complete the request. Please try again.')
        return
      }
      apiHistory.current = [...apiHistory.current, { role: 'user', content: [body.tool_result] }]
      setThread(t => [...t, { role: 'assistant', content: body.message, system: true }])
      setPending(null)
      changeStatus('idle')
    } catch {
      if (expireIfNeeded() || generation.current !== requestGeneration) return
      setError('Could not reach the advisor. Please try again.')
      changeStatus('awaiting_confirmation')
    }
  }

  return { thread, expiresAt, pending, status, error, notice, busy, send,
    confirm: () => resolveProposal('confirm'), cancel: () => resolveProposal('cancel'), clear }
}

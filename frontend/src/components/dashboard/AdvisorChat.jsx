import { useEffect, useRef, useState } from 'react'
import { useAdvisorChatContext } from '../../context/AdvisorChatContext'
import { formatMoney } from '../../lib/utils'
import { Link } from 'react-router-dom'
import Button from '../ui/Button'
import Markdown from '../ui/Markdown'

function Row({ label, value }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text">{value}</span>
    </>
  )
}

// One generic confirmation card driven entirely by preview_json (cents).
function PreviewCard({ preview, busy, onConfirm, onCancel }) {
  const isExpense = preview.tool === 'pay_expense'
  const title = {
    pay_expense: 'Confirm expense payment',
    pay_account: 'Confirm debt payment',
    record_balance_update: 'Confirm balance update',
  }[preview.tool] || 'Confirm balance update'
  return (
    <div className="advisor-preview rounded-lg border border-warning/40 bg-warning/10 px-4 py-4 space-y-3">
      <h3 className="text-sm font-semibold text-text">{title}</h3>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {isExpense
          ? <Row label="Expense" value={preview.expense_name || 'Not identified'} />
          : <Row label="Account" value={preview.account_name || 'Not identified'} />}

        {preview.current_balance != null && (
          <Row label="Current balance" value={formatMoney(preview.current_balance)} />
        )}
        {preview.new_balance != null && (
          <Row label="New balance" value={formatMoney(preview.new_balance)} />
        )}
        {preview.payment_made != null && (
          <Row label="Payment" value={formatMoney(preview.payment_made)} />
        )}
        {preview.interest_portion != null && preview.principal_portion != null && (
          <>
            <Row label="Interest" value={formatMoney(preview.interest_portion)} />
            <Row label="Principal" value={formatMoney(preview.principal_portion)} />
          </>
        )}
        {preview.note && <Row label="Note" value={preview.note} />}
      </div>

      {preview.source && (
        <div className="mt-2 pt-3 border-t border-warning/30 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <span className="col-span-2 text-xs font-semibold text-text-muted">Paid from</span>
          <Row label="Account" value={preview.source.account_name} />
          <Row label="New balance" value={formatMoney(preview.source.new_balance)} />
        </div>
      )}

      {preview.warnings?.length > 0 && (
        <div className="rounded-md bg-warning/15 border border-warning/40 px-3 py-2 text-xs text-warning space-y-1">
          {preview.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="success" loading={busy} onClick={onConfirm}>
          Confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export default function AdvisorChat({ variant = 'full' }) {
  const { thread, pending, status, error, busy, send, confirm, cancel, clear } =
    useAdvisorChatContext()

  const [text, setText] = useState('')
  const textareaRef = useRef(null)
  const threadEndRef = useRef(null)

  // 'compact' (Dashboard widget): a fresh quick-action box — show only the latest
  // assistant response to what's asked HERE this visit, no echoed prompts, no
  // history (that lives on the Chat page). 'full' (Chat page): the whole thread.
  const compact = variant === 'compact'
  const [sessionStart] = useState(() => thread.length)
  const displayed = compact
    ? thread.slice(sessionStart).filter((m) => m.role === 'assistant').slice(-1)
    : thread

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
  }, [thread, pending])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function submit() {
    const value = text.trim()
    if (!value || busy) return
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    send(value)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function handleClear() {
    if (window.confirm('Clear the entire chat history?')) clear()
  }

  const starters = [
    { label: 'Plan my spending', prompt: 'How much can I safely spend before my next paycheck?' },
    { label: 'Look at my debt', prompt: 'Which debt should I focus on paying down next, and why?' },
    { label: 'Review upcoming bills', prompt: 'What payments do I need to plan for before my next paycheck?' },
  ]

  function draftPrompt(prompt) {
    setText(prompt)
    textareaRef.current?.focus()
  }

  return (
    <div className={compact ? 'advisor-layout advisor-compact' : 'advisor-layout'}>
      <section className="journal-panel advisor-conversation" aria-label="Financial advisor">
        <header className="advisor-header">
          <div className="advisor-heading">
            <span className="advisor-mark" aria-hidden="true">✳</span>
            <div>
              <p className="journal-kicker">FINANCIAL ADVISOR</p>
              <h2>Your conversation</h2>
            </div>
          </div>
          {!compact && thread.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={busy}>Clear</Button>
          )}
        </header>

        {displayed.length === 0 && !pending ? (
          <div className="advisor-empty">
            <p className="journal-kicker">LET’S THINK IT THROUGH</p>
            <h3>More clarity.<br />A confident next step.</h3>
            <p>Start with what is on your mind. Your advisor can help connect your balances, bills, and goals.</p>
            <button type="button" className="journal-link" onClick={() => textareaRef.current?.focus()}>Start a conversation <span aria-hidden="true">↗</span></button>
          </div>
        ) : (
          <div className="advisor-thread" role="log" aria-label="Conversation" aria-busy={busy} tabIndex={0}>
            {displayed.map((m, i) => (
              <div key={i} className={`advisor-message ${m.role === 'user' ? 'advisor-message-user' : m.system ? 'advisor-message-system' : 'advisor-message-assistant'}`}>
                <p className="advisor-speaker">{m.role === 'user' ? 'YOU' : m.system ? 'ACTIVITY UPDATE' : 'ADVISOR'}</p>
                <div className="advisor-message-content">
                  {m.role === 'user' || m.system
                    ? <p>{m.content}</p>
                    : <Markdown>{m.content || (m.streaming ? 'Thinking…' : '')}</Markdown>}
                </div>
              </div>
            ))}
            {pending && (
              <PreviewCard preview={pending.preview} busy={status === 'confirming'} onConfirm={confirm} onCancel={cancel} />
            )}
            {!compact && <div ref={threadEndRef} />}
          </div>
        )}

        <div className="advisor-compose">
          {error && <div id="advisor-error" className="advisor-error" role="alert">{error}</div>}
          <label className="sr-only" htmlFor="advisor-message">Message your advisor</label>
          <textarea
            id="advisor-message"
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize() }}
            onKeyDown={handleKeyDown}
            aria-describedby={error ? 'advisor-error advisor-keyboard-hint' : 'advisor-keyboard-hint'}
            placeholder="Ask a question or describe an update…"
            rows={2}
            disabled={busy}
          />
          <div className="advisor-compose-footer">
            <div>
              <p role="status" className="advisor-status">{status === 'streaming' ? 'Your advisor is responding…' : status === 'confirming' ? 'Applying your change…' : pending ? 'Review the proposed change above.' : 'Ready when you are.'}</p>
              <p id="advisor-keyboard-hint">Enter to send · Shift + Enter for a new line</p>
            </div>
            <Button className="advisor-send" onClick={submit} loading={status === 'streaming'} disabled={!text.trim() || busy}>
              Send <span aria-hidden="true">↗</span>
            </Button>
          </div>
        </div>
      </section>

      {!compact && (
        <aside className="advisor-sidebar" aria-label="Conversation ideas">
          <section className="advisor-starters">
            <p className="journal-kicker">A PLACE TO BEGIN</p>
            <h2>What’s on <br />your mind?</h2>
            <p>Choose a starting point, then make it your own.</p>
            {starters.map((starter, index) => (
              <button key={starter.label} type="button" onClick={() => draftPrompt(starter.prompt)} disabled={busy}>
                <span className="advisor-prompt-number" aria-hidden="true">0{index + 1}</span>
                <span>{starter.label}</span><span aria-hidden="true">↗</span>
              </button>
            ))}
          </section>
          <section className="advisor-note">
            <p className="journal-kicker">FROM WORDS TO ACTION</p>
            <h3>You have the final say.</h3>
            <p>Payments and balance updates appear as a proposal. Review the details, then confirm or cancel.</p>
            <Link className="journal-link" to="/history">Review your activity <span aria-hidden="true">↗</span></Link>
          </section>
          <p className="advisor-sidebar-caption">Your conversation stays together as you move between pages.</p>
        </aside>
      )}
    </div>
  )
}

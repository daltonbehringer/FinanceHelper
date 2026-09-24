import { useEffect, useRef, useState } from 'react'
import { useAdvisorChatContext } from '../../context/AdvisorChatContext'
import { formatMoney } from '../../lib/utils'
import { ADVISOR_PROMPTS, RECOMMENDATIONS_PROMPT } from '../../lib/advisor'
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

export default function AdvisorChat() {
  const { thread, pending, status, error, notice, busy, send, confirm, cancel, clear } = useAdvisorChatContext()
  const [text, setText] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const textareaRef = useRef(null)
  const answerRef = useRef(null)
  const blocked = busy || Boolean(pending)
  const displayed = showHistory ? thread : thread.filter(message => message.role === 'assistant').slice(-1)
  const hasEarlierMessages = thread.length > 2

  useEffect(() => {
    if (status === 'streaming') {
      answerRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
      answerRef.current?.focus({ preventScroll: true })
    }
  }, [status])

  function submit() {
    const value = text.trim()
    if (!value || blocked) return
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    send(value)
  }

  function ask(prompt) {
    if (blocked) return
    setText('')
    setShowHistory(false)
    send(prompt, { fresh: true })
  }

  return (
    <div className="advisor-workspace">
      <section className="advisor-guidance" aria-label="Get recommendations">
        <div>
          <p className="journal-kicker">YOUR MONEY. YOUR NEXT MOVE.</p>
          <h2>A little clarity goes a long way.</h2>
          <p>Get a fresh look at your spending room, upcoming bills, and priorities for debt or savings.</p>
        </div>
        <Button className="advisor-ask" onClick={() => ask(RECOMMENDATIONS_PROMPT)} disabled={blocked}>
          Ask advisor <span aria-hidden="true">↗</span>
        </Button>
      </section>

      <div className="advisor-quick-prompts" role="group" aria-label="Quick questions">
        {ADVISOR_PROMPTS.map((starter, index) => <button key={starter.label} type="button" onClick={() => ask(starter.prompt)} disabled={blocked}>
          <span className="advisor-prompt-number" aria-hidden="true">0{index + 1}</span>
          <span>{starter.label}</span><span aria-hidden="true">↗</span>
        </button>)}
      </div>

      <section className="journal-panel advisor-conversation" aria-label="Financial advisor">
        <header className="advisor-header">
          <div className="advisor-heading">
            <span className="advisor-mark" aria-hidden="true">✳</span>
            <div>
              <p className="journal-kicker">FINANCIAL ADVISOR</p>
              <h2>{showHistory ? 'This conversation' : 'Your answer'}</h2>
            </div>
          </div>
          {thread.length > 0 && <Button variant="ghost" size="sm" onClick={() => { if (window.confirm('Clear this conversation?')) clear() }} disabled={blocked}>Clear</Button>}
        </header>

        {notice && <p className="advisor-retention-notice" role="status">{notice}</p>}
        {thread.length > 0 ? <>
          {hasEarlierMessages && <button type="button" className="advisor-history-toggle" aria-expanded={showHistory} aria-controls="advisor-answer" onClick={() => setShowHistory(value => !value)}>
            {showHistory ? 'Show latest answer only' : 'Show this conversation'}
          </button>}
          <div id="advisor-answer" className={`advisor-thread${showHistory ? ' advisor-thread-expanded' : ''}`} role="log" aria-label="Conversation" aria-busy={busy} tabIndex={0} ref={answerRef}>
            {displayed.map((message, index) => <div key={index} className={`advisor-message ${message.role === 'user' ? 'advisor-message-user' : message.system ? 'advisor-message-system' : 'advisor-message-assistant'}`}>
              <p className="advisor-speaker">{message.role === 'user' ? 'YOU' : message.system ? 'ACTIVITY UPDATE' : 'ADVISOR'}</p>
              <div className="advisor-message-content">
                {message.role === 'user' || message.system
                  ? <p>{message.content}</p>
                  : <Markdown>{message.content || (message.streaming ? 'Thinking…' : '')}</Markdown>}
              </div>
            </div>)}
            {pending && <PreviewCard preview={pending.preview} busy={status === 'confirming'} onConfirm={confirm} onCancel={cancel} />}
          </div>
        </> : <div className="advisor-empty">
          <h3>What would help today?</h3>
          <p>Ask for recommendations, choose a quick question, or write your own below.</p>
        </div>}

        <div className="advisor-compose">
          {error && <div id="advisor-error" className="advisor-error" role="alert">{error}</div>}
          <label className="sr-only" htmlFor="advisor-message">Message your advisor</label>
          <textarea id="advisor-message" ref={textareaRef} value={text}
            onChange={event => {
              setText(event.target.value)
              event.target.style.height = 'auto'
              event.target.style.height = event.target.scrollHeight + 'px'
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
            aria-describedby={error ? 'advisor-error advisor-keyboard-hint' : 'advisor-keyboard-hint'}
            placeholder={thread.length ? 'Ask a follow-up or describe an update…' : 'Or ask your own question…'}
            rows={2} disabled={blocked} />
          <div className="advisor-compose-footer">
            <div>
              <p role="status" className="advisor-status">{status === 'streaming' ? 'Your advisor is responding…' : status === 'confirming' ? 'Processing your choice…' : pending ? 'Confirm or cancel the proposal to continue.' : thread.length ? 'Have a follow-up? Keep going.' : 'Ready when you are.'}</p>
              <p id="advisor-keyboard-hint">Enter to send · Shift + Enter for a new line</p>
            </div>
            <Button className="advisor-send" onClick={submit} loading={status === 'streaming'} disabled={!text.trim() || blocked}>
              Send <span aria-hidden="true">↗</span>
            </Button>
          </div>
        </div>
      </section>
      <div className="advisor-footnotes">
        <p>Conversation memory expires after 24 hours. Ask advisor and quick questions start fresh; follow-ups keep the current context.</p>
        <p>Payments and balance updates still need your confirmation. Recorded financial activity stays in History.</p>
      </div>
    </div>
  )
}

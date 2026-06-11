import { useEffect, useRef, useState } from 'react'
import { useAdvisorChat } from '../../hooks/useAdvisorChat'
import { formatMoney } from '../../lib/utils'
import Card, { CardHeader, CardBody } from '../ui/Card'
import Button from '../ui/Button'
import Markdown from '../ui/Markdown'

const RECOMMEND_PROMPT = 'What should I prioritize this month?'

function Row({ label, value }) {
  return (
    <>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </>
  )
}

// One generic confirmation card driven entirely by preview_json (cents).
function PreviewCard({ preview, busy, onConfirm, onCancel }) {
  const isExpense = preview.tool === 'pay_expense'
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 space-y-3">
      <h3 className="text-sm font-semibold text-amber-900">
        {isExpense ? 'Confirm expense payment' : 'Confirm balance update'}
      </h3>

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
        <div className="mt-2 pt-3 border-t border-amber-200 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <span className="col-span-2 text-xs font-semibold text-amber-800">Paid from</span>
          <Row label="Account" value={preview.source.account_name} />
          <Row label="New balance" value={formatMoney(preview.source.new_balance)} />
        </div>
      )}

      {preview.warnings?.length > 0 && (
        <div className="rounded-md bg-amber-100 border border-amber-300 px-3 py-2 text-xs text-amber-900 space-y-1">
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

export default function AdvisorChat({ onUpdate, onExpenseUpdate, variant = 'full' }) {
  const { thread, pending, status, error, busy, send, confirm, cancel } =
    useAdvisorChat({ onUpdate, onExpenseUpdate })

  const [text, setText] = useState('')
  const textareaRef = useRef(null)
  const threadEndRef = useRef(null)

  // 'compact' (Dashboard widget): show only the most recent assistant response
  // and any confirmation card — no running thread, no echoed prompts.
  // 'full' (Chat page): the whole conversation, scrollable, with quick actions.
  const compact = variant === 'compact'
  const displayed = compact
    ? thread.filter((m) => m.role === 'assistant').slice(-1)
    : thread

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-gray-900">Financial Advisor</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        {(displayed.length > 0 || pending) && (
          <div className={compact ? 'space-y-3' : 'space-y-3 max-h-[28rem] overflow-y-auto pr-1'}>
            {displayed.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                {m.role === 'user' ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white whitespace-pre-wrap">
                    {m.content}
                  </div>
                ) : (
                  <div className={`rounded-2xl rounded-bl-sm px-4 py-3 ${m.system ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
                    {m.system
                      ? <p className="text-sm text-green-900">{m.content}</p>
                      : <Markdown>{m.content || (m.streaming ? '…' : '')}</Markdown>}
                  </div>
                )}
              </div>
            ))}
            {pending && (
              <PreviewCard preview={pending.preview} busy={status === 'confirming'} onConfirm={confirm} onCancel={cancel} />
            )}
            {!compact && <div ref={threadEndRef} />}
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize() }}
            onKeyDown={handleKeyDown}
            placeholder="Record a payment, update a balance, or ask for advice…"
            rows={2}
            disabled={busy}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
          />
          <div className={`flex gap-2 ${compact ? 'justify-end' : 'justify-between'}`}>
            {!compact && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => send(RECOMMEND_PROMPT)}>
                Get recommendation
              </Button>
            )}
            <Button onClick={submit} loading={status === 'streaming'} disabled={!text.trim() || busy}>
              Send
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

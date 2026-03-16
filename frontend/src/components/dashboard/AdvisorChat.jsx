import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatMoney, formatRecommendation } from '../../lib/utils'
import { useToast } from '../../context/ToastContext'
import Card, { CardHeader, CardBody } from '../ui/Card'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'

function RecommendationContent({ items }) {
  return (
    <div className="space-y-1">
      {items.map((item) => {
        switch (item.type) {
          case 'heading':
            return (
              <div key={item.key} className="font-bold text-gray-900 text-sm pt-2 first:pt-0">
                {item.text}
              </div>
            )
          case 'bullet':
            return (
              <div key={item.key} className="pl-4 text-sm text-gray-700 flex gap-2">
                <span className="text-gray-400 select-none">&bull;</span>
                <span>{item.text}</span>
              </div>
            )
          case 'numbered':
            return (
              <div key={item.key} className="pl-4 text-sm text-gray-700">
                {item.text}
              </div>
            )
          case 'paragraph':
            return (
              <p key={item.key} className="text-sm text-gray-700">
                {item.text}
              </p>
            )
          case 'spacer':
            return <div key={item.key} className="h-2" />
          default:
            return null
        }
      })}
    </div>
  )
}

export default function AdvisorChat({ accounts, onUpdate }) {
  const { showToast } = useToast()

  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState('')
  const [manualAccountId, setManualAccountId] = useState('')
  const [confirming, setConfirming] = useState(false)

  async function handleSend() {
    if (!text.trim()) return

    setLoading(true)
    setResponse(null)
    setError('')
    setManualAccountId('')

    try {
      const resp = await apiFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ text: text.trim() }),
      })

      if (!resp || !resp.ok) {
        setError('Failed to get a response. Please try again.')
        return
      }

      const data = await resp.json()

      if (data.type === 'question') {
        setResponse(data)
      } else {
        // Balance update
        if (data.new_balance == null && data.payment_made == null) {
          setError('No balance or payment amount found. Please be more specific.')
          return
        }
        setResponse(data)

        if (data.account_id == null) {
          setError('Could not identify the account. Please select it below.')
        }
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!response) return

    const accountId = response.account_id ?? (manualAccountId ? Number(manualAccountId) : null)
    if (!accountId) {
      setError('Please select an account before confirming.')
      return
    }

    setConfirming(true)
    try {
      const resp = await apiFetch('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({
          account_id: accountId,
          balance: response.new_balance,
          payment_made: response.payment_made,
          note: response.note || '',
        }),
      })

      if (!resp || !resp.ok) {
        showToast('Failed to save update', 'error')
        return
      }

      showToast('Balance updated successfully', 'success')
      onUpdate?.()
      handleClear()
    } catch {
      showToast('Failed to save update', 'error')
    } finally {
      setConfirming(false)
    }
  }

  function handleClear() {
    setText('')
    setResponse(null)
    setError('')
    setManualAccountId('')
  }

  function getAccountName(id) {
    const account = accounts.find((a) => a.id === id)
    return account ? account.name : `Account #${id}`
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-gray-900">Financial Advisor</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Input area */}
        <div className="flex gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your finances or update a balance..."
            rows={2}
            className="flex-1 resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <Button
            onClick={handleSend}
            loading={loading}
            disabled={!text.trim()}
            className="self-end"
          >
            Send
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Question response */}
        {response && response.type === 'question' && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-4">
            <RecommendationContent items={formatRecommendation(response.answer)} />
          </div>
        )}

        {/* Balance update preview */}
        {response && response.type !== 'question' && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-4 space-y-3">
            <h3 className="text-sm font-semibold text-amber-900">Confirm Balance Update</h3>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <span className="text-amber-700">Account</span>
              <span className="font-medium text-amber-900">
                {response.account_id ? getAccountName(response.account_id) : 'Not identified'}
              </span>

              {response.current_balance != null && (
                <>
                  <span className="text-amber-700">Current Balance</span>
                  <span className="font-medium text-amber-900">
                    {formatMoney(response.current_balance)}
                  </span>
                </>
              )}

              {response.new_balance != null && (
                <>
                  <span className="text-amber-700">New Balance</span>
                  <span className="font-medium text-amber-900">
                    {formatMoney(response.new_balance)}
                  </span>
                </>
              )}

              {response.payment_made != null && (
                <>
                  <span className="text-amber-700">Payment Made</span>
                  <span className="font-medium text-amber-900">
                    {formatMoney(response.payment_made)}
                  </span>
                </>
              )}

              {response.note && (
                <>
                  <span className="text-amber-700">Note</span>
                  <span className="text-amber-900">{response.note}</span>
                </>
              )}
            </div>

            {/* Manual account selection if account_id is null */}
            {response.account_id == null && (
              <div>
                <label className="block text-xs font-medium text-amber-800 mb-1">
                  Select Account
                </label>
                <select
                  value={manualAccountId}
                  onChange={(e) => {
                    setManualAccountId(e.target.value)
                    if (e.target.value) setError('')
                  }}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">Choose an account...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="success"
                loading={confirming}
                onClick={handleConfirm}
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClear}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

import { useState, useRef } from 'react'
import { apiFetch } from '../../lib/api'
import { formatMoney, formatRecommendation, isDebt } from '../../lib/utils'
import { useToast } from '../../context/ToastContext'
import { useSettings } from '../../hooks/useSettings'
import Card, { CardHeader, CardBody } from '../ui/Card'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'

const LIQUID_TYPES = ['checking', 'savings', 'other']

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

export default function AdvisorChat({ accounts, expenses = [], onUpdate, onExpenseUpdate }) {
  const { showToast } = useToast()
  const { settings } = useSettings()

  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState('')
  const [manualAccountId, setManualAccountId] = useState('')
  const [manualSourceAccountId, setManualSourceAccountId] = useState('')
  const [manualExpenseId, setManualExpenseId] = useState('')
  const [confirming, setConfirming] = useState(false)

  const hasDefaultPaymentAccount = !!settings.default_payment_account_id
  const liquidAccounts = accounts.filter(a => LIQUID_TYPES.includes(a.type))

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
      } else if (data.type === 'expense_payment') {
        setResponse(data)
        if (data.expense_id == null) {
          setError('Could not identify the expense. Please select it below.')
        }
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

    if (response.new_balance == null) {
      setError('Could not determine the new balance. Please try again with more details.')
      return
    }

    // Resolve source account: use AI's suggestion if default is configured,
    // otherwise use the manual dropdown selection
    const needsSourceSelection = showSourceDropdown
    let sourceAccountId = null
    let sourceNewBalance = null

    if (hasDefaultPaymentAccount) {
      // Default is configured — trust AI's source fields
      sourceAccountId = response.source_account_id
      sourceNewBalance = response.source_new_balance
    } else if (needsSourceSelection && manualSourceAccountId) {
      // No default — user selected from dropdown
      sourceAccountId = Number(manualSourceAccountId)
      const sourceAcct = accounts.find(a => a.id === sourceAccountId)
      if (sourceAcct && response.payment_made != null) {
        sourceNewBalance = (sourceAcct.current_balance ?? sourceAcct.balance) - response.payment_made
      }
    }

    setConfirming(true)
    try {
      // Create snapshot for the primary (debt) account.
      // source: 'llm' tags the event log — this write originated from the AI chat.
      const resp = await apiFetch('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({
          account_id: accountId,
          balance: response.new_balance,
          payment_made: response.payment_made,
          note: response.note || '',
          source: 'llm',
          source_detail: 'balance_update',
        }),
      })

      if (!resp || !resp.ok) {
        showToast('Failed to save update', 'error')
        return
      }

      // Create snapshot for the source (payment) account if present
      if (sourceAccountId != null && sourceNewBalance != null) {
        const sourceResp = await apiFetch('/api/snapshots', {
          method: 'POST',
          body: JSON.stringify({
            account_id: sourceAccountId,
            balance: sourceNewBalance,
            note: `Payment of ${formatMoney(response.payment_made)} to ${getAccountName(accountId)}`,
            source: 'llm',
            source_detail: 'balance_update',
          }),
        })

        if (!sourceResp || !sourceResp.ok) {
          showToast('Debt updated, but failed to update payment account', 'error')
          onUpdate?.()
          handleClear()
          return
        }
      }

      const msg = sourceAccountId != null
        ? 'Both accounts updated successfully'
        : 'Balance updated successfully'
      showToast(msg, 'success')
      onUpdate?.()
      handleClear()
    } catch {
      showToast('Failed to save update', 'error')
    } finally {
      setConfirming(false)
    }
  }

  async function handleConfirmExpensePayment() {
    if (!response) return

    const expenseId = response.expense_id ?? (manualExpenseId ? Number(manualExpenseId) : null)
    if (!expenseId) {
      setError('Please select an expense before confirming.')
      return
    }

    // Resolve source account
    let sourceAccountId = null
    let sourceNewBalance = null

    if (hasDefaultPaymentAccount) {
      sourceAccountId = response.source_account_id
      sourceNewBalance = response.source_new_balance
    } else if (manualSourceAccountId) {
      sourceAccountId = Number(manualSourceAccountId)
      const sourceAcct = accounts.find(a => a.id === sourceAccountId)
      if (sourceAcct) {
        sourceNewBalance = (sourceAcct.current_balance ?? sourceAcct.balance) - response.amount
      }
    }

    setConfirming(true)
    try {
      const resp = await apiFetch(`/api/expenses/${expenseId}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          source_account_id: sourceAccountId,
          source_new_balance: sourceNewBalance,
          note: response.note || '',
          source: 'llm',
          source_detail: 'expense_payment',
        }),
      })

      if (!resp || !resp.ok) {
        showToast('Failed to record expense payment', 'error')
        return
      }

      showToast(`${response.expense_name} marked as paid`, 'success')
      onUpdate?.()
      onExpenseUpdate?.()
      handleClear()
    } catch {
      showToast('Failed to record expense payment', 'error')
    } finally {
      setConfirming(false)
    }
  }

  function handleClear() {
    setText('')
    setResponse(null)
    setError('')
    setManualAccountId('')
    setManualSourceAccountId('')
    setManualExpenseId('')
  }

  function getAccountName(id) {
    const account = accounts.find((a) => a.id === id)
    return account ? account.name : `Account #${id}`
  }

  const textareaRef = useRef(null)

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Determine if the target account is a debt account
  const targetAccountId = response?.account_id ?? (manualAccountId ? Number(manualAccountId) : null)
  const targetAccount = targetAccountId ? accounts.find(a => a.id === targetAccountId) : null
  const targetIsDebt = targetAccount ? isDebt(targetAccount.type) : false

  // Show source account dropdown when: no default configured, target is debt, and a payment was made
  const showSourceDropdown = response
    && response.type !== 'question'
    && response.type !== 'expense_payment'
    && !hasDefaultPaymentAccount
    && targetIsDebt
    && response.payment_made != null

  // Show source dropdown for expense payments when no default configured
  const showExpenseSourceDropdown = response
    && response.type === 'expense_payment'
    && !hasDefaultPaymentAccount

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-gray-900">Financial Advisor</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Input area */}
        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize() }}
            onKeyDown={handleKeyDown}
            placeholder="Add payments, update a balance, or ask for advice..."
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSend}
              loading={loading}
              disabled={!text.trim()}
            >
              Send
            </Button>
          </div>
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

        {/* Expense payment preview */}
        {response && response.type === 'expense_payment' && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-4 space-y-3">
            <h3 className="text-sm font-semibold text-green-900">Confirm Expense Payment</h3>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <span className="text-green-700">Expense</span>
              <span className="font-medium text-green-900">
                {response.expense_name || 'Not identified'}
              </span>

              <span className="text-green-700">Amount</span>
              <span className="font-medium text-green-900">
                {formatMoney(response.amount)}
              </span>

              {response.note && (
                <>
                  <span className="text-green-700">Note</span>
                  <span className="text-green-900">{response.note}</span>
                </>
              )}
            </div>

            {/* Source account preview (when default payment account is configured) */}
            {hasDefaultPaymentAccount && response.source_account_id != null && response.source_new_balance != null && (
              <div className="mt-3 pt-3 border-t border-green-200">
                <h4 className="text-xs font-semibold text-green-800 mb-2">Deducting From</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <span className="text-green-700">Account</span>
                  <span className="font-medium text-green-900">
                    {getAccountName(response.source_account_id)}
                  </span>
                  <span className="text-green-700">New Balance</span>
                  <span className="font-medium text-green-900">
                    {formatMoney(response.source_new_balance)}
                  </span>
                </div>
              </div>
            )}

            {/* Source account dropdown (when no default configured) */}
            {showExpenseSourceDropdown && (
              <div>
                <label className="block text-xs font-medium text-green-800 mb-1">
                  Deduct payment from
                </label>
                <select
                  value={manualSourceAccountId}
                  onChange={(e) => setManualSourceAccountId(e.target.value)}
                  className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">None (don't deduct from any account)</option>
                  {liquidAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatMoney(a.current_balance ?? a.balance)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Manual expense selection if expense_id is null */}
            {response.expense_id == null && (
              <div>
                <label className="block text-xs font-medium text-green-800 mb-1">
                  Select Expense
                </label>
                <select
                  value={manualExpenseId}
                  onChange={(e) => {
                    setManualExpenseId(e.target.value)
                    if (e.target.value) setError('')
                  }}
                  className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">Choose an expense...</option>
                  {expenses.filter(e => e.is_active !== 0).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({formatMoney(e.amount)})
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
                onClick={handleConfirmExpensePayment}
              >
                Confirm Payment
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClear}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Balance update preview */}
        {response && response.type !== 'question' && response.type !== 'expense_payment' && (
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

              {response.interest_portion != null && response.principal_portion != null && (
                <>
                  <span className="text-amber-700">Interest Portion</span>
                  <span className="font-medium text-amber-900">
                    {formatMoney(response.interest_portion)}
                  </span>
                  <span className="text-amber-700">Principal Portion</span>
                  <span className="font-medium text-amber-900">
                    {formatMoney(response.principal_portion)}
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

            {/* Source account deduction preview (when default payment account is configured) */}
            {hasDefaultPaymentAccount && response.source_account_id != null && response.source_new_balance != null && (
              <div className="mt-3 pt-3 border-t border-amber-200">
                <h4 className="text-xs font-semibold text-amber-800 mb-2">Also Updating (Payment Source)</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <span className="text-amber-700">Account</span>
                  <span className="font-medium text-amber-900">
                    {getAccountName(response.source_account_id)}
                  </span>
                  <span className="text-amber-700">New Balance</span>
                  <span className="font-medium text-amber-900">
                    {formatMoney(response.source_new_balance)}
                  </span>
                </div>
              </div>
            )}

            {/* Source account dropdown (when no default is configured and this is a debt payment) */}
            {showSourceDropdown && (
              <div>
                <label className="block text-xs font-medium text-amber-800 mb-1">
                  Deduct payment from
                </label>
                <select
                  value={manualSourceAccountId}
                  onChange={(e) => setManualSourceAccountId(e.target.value)}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">None (don't deduct from any account)</option>
                  {liquidAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatMoney(a.current_balance ?? a.balance)})
                    </option>
                  ))}
                </select>
              </div>
            )}

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

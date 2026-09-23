import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { centsToDollarInput, moneyInputCents, formatType } from '../../lib/utils'
import Button from '../ui/Button'
import Input from '../ui/Input'
import MoneyInput from '../ui/MoneyInput'
import Badge from '../ui/Badge'

// Categories replace the single estimate in both cash planning and monthly surplus.
export default function BudgetEditor({ zip, householdSize, showToast, lines, refetch, children }) {
  const [newCategory, setNewCategory] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [estimating, setEstimating] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  async function write(path, method, body, message) {
    setError('')
    setStatus('Saving categories…')
    try {
      const response = await apiFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      if (!response?.ok) throw new Error(message)
      refetch()
      setStatus('Categories saved')
      return true
    } catch {
      setError(message)
      setStatus('')
      return false
    }
  }

  function saveLine(line, patch) {
    return write(`/api/budget/lines/${line.id}`, 'PUT', patch, `Could not save ${formatType(line.category)}. Try editing it again.`)
  }

  async function addLine() {
    const amount = moneyInputCents(newAmount)
    if (!newCategory.trim() || amount === null) {
      setError('Enter a category and a valid monthly dollar amount before adding it.')
      return
    }
    setAdding(true)
    const saved = await write('/api/budget/lines', 'POST', { category: newCategory.trim(), amount }, 'Could not add the category. Try again.')
    if (saved) { setNewCategory(''); setNewAmount('') }
    setAdding(false)
  }

  async function estimate() {
    if (!zip) { setError('Enter a ZIP code before requesting a local estimate.'); return }
    if (householdSize && (!Number.isInteger(Number(householdSize)) || Number(householdSize) < 1)) {
      setError('Household size must be a whole number of at least 1.')
      return
    }
    setError('')
    setEstimating(true)
    try {
      const resp = await apiFetch('/api/budget/estimate', {
        method: 'POST',
        body: JSON.stringify({ zip_code: zip, household_size: householdSize ? Number(householdSize) : 1 }),
      })
      if (!resp?.ok) throw new Error('Estimate failed')
      showToast('Estimated from your area — review and adjust', 'success')
      setStatus('Estimated categories saved. Review the amounts below.')
      refetch()
    } catch {
      setError('Could not generate an estimate. Try again.')
    } finally {
      setEstimating(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted text-pretty">
        Category edits save when you leave a field. Adding, removing, and estimating categories
        also saves immediately. Enter monthly amounts in dollars.
      </p>
      {lines.length > 0 && (
        <div className="space-y-3">
          {lines.map((line) => (
            <div key={line.id} className="grid grid-cols-2 sm:flex sm:items-start gap-2">
              <Input
                key={`category-${line.category}`}
                label="Category"
                className="min-w-0 sm:flex-1"
                aria-label={`Budget category: ${line.category}`}
                defaultValue={formatType(line.category)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  if (!value) { setError('Category names cannot be empty.'); return }
                  if (value !== formatType(line.category)) saveLine(line, { category: value })
                }}
              />
              <MoneyInput
                key={`amount-${line.amount}`}
                label="Monthly amount"
                className="min-w-0 sm:w-36"
                aria-label={`Monthly amount for ${line.category}`}
                defaultValue={centsToDollarInput(line.amount)}
                required
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                onCommit={(value) => {
                  const cents = moneyInputCents(value)
                  if (cents !== null && cents !== line.amount) saveLine(line, { amount: cents })
                }}
              />
              <div className="col-span-2 flex items-center justify-end gap-2 sm:pt-6">
                <Badge color={line.origin === 'user' ? 'blue' : 'gray'} size="sm">
                  {line.origin === 'user' ? 'Edited' : 'Estimate'}
                </Badge>
                <button
                  type="button"
                  onClick={() => write(`/api/budget/lines/${line.id}`, 'DELETE', null, 'Could not remove the category. Try again.')}
                  className="p-2 text-text-subtle hover:text-debit rounded-lg hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label={`Remove ${formatType(line.category)}`}
                >
                  <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:flex sm:items-start gap-2">
        <Input
          label="New category"
          className="min-w-0 sm:flex-1"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLine() } }}
          placeholder="e.g. Groceries"
        />
        <MoneyInput
          label="Monthly amount"
          className="min-w-0 sm:w-36"
          aria-label="New monthly budget amount"
          value={newAmount}
          onValueChange={setNewAmount}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLine() } }}
        />
        <Button type="button" variant="outline" size="sm" onClick={addLine} loading={adding} className="col-span-2 sm:mt-6">Add category</Button>
      </div>
      {children}
      <Button type="button" variant="outline" size="sm" onClick={estimate} loading={estimating}>
        Estimate from my area
      </Button>
      {error && <p role="alert" className="text-sm text-debit">{error}</p>}
      {status && <p role="status" className="text-sm text-text-muted">{status}</p>}
    </div>
  )
}

import { useState } from 'react'
import { apiFetch } from '../../lib/api'
import { centsToDollarInput, dollarsToCents, formatMoney, formatType } from '../../lib/utils'
import { useBudgetLines } from '../../hooks/useBudgetLines'
import { useSpendingMoney } from '../../hooks/useSpendingMoney'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Badge from '../ui/Badge'

/**
 * Budget-lines editor for Settings. Lines are untracked variable-spending
 * estimates that feed the deterministic Monthly Spending Money number. The
 * "Estimate from my area" button seeds metro-level averages (origin badge =
 * "LLM est"); any edit flips a line to "You" and protects it from re-estimation.
 *
 * `zip` and `householdSize` come from the parent Settings form so an estimate
 * can run against unsaved values.
 */
export default function BudgetEditor({ zip, householdSize, showToast }) {
  const { lines, refetch } = useBudgetLines()
  const { summary, refetch: refetchSummary } = useSpendingMoney()
  const [newCategory, setNewCategory] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [estimating, setEstimating] = useState(false)

  function reload() { refetch(); refetchSummary() }

  async function saveLine(line, patch) {
    const resp = await apiFetch(`/api/budget/lines/${line.id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
    if (resp && resp.ok) reload()
    else showToast('Failed to update line', 'error')
  }

  async function removeLine(line) {
    const resp = await apiFetch(`/api/budget/lines/${line.id}`, { method: 'DELETE' })
    if (resp && resp.ok) reload()
    else showToast('Failed to remove line', 'error')
  }

  async function addLine() {
    const amount = dollarsToCents(newAmount)
    if (!newCategory.trim() || amount == null || amount < 0) return
    const resp = await apiFetch('/api/budget/lines', {
      method: 'POST',
      body: JSON.stringify({ category: newCategory.trim(), amount }),
    })
    if (resp && resp.ok) {
      setNewCategory(''); setNewAmount(''); reload()
    } else {
      showToast('Failed to add line', 'error')
    }
  }

  async function estimate() {
    if (!zip) { showToast('Enter a ZIP code first', 'error'); return }
    setEstimating(true)
    try {
      const resp = await apiFetch('/api/budget/estimate', {
        method: 'POST',
        body: JSON.stringify({ zip_code: zip, household_size: householdSize ? Number(householdSize) : null }),
      })
      if (resp && resp.ok) {
        showToast('Estimated from your area — review and adjust', 'success')
        reload()
      } else {
        showToast('Could not generate an estimate. Try again.', 'error')
      }
    } catch {
      showToast('Could not generate an estimate. Try again.', 'error')
    } finally {
      setEstimating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Estimated monthly spending for untracked, variable costs. Don't duplicate bills you
          already track as recurring expenses.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={estimate} loading={estimating}>
          Estimate from my area
        </Button>
      </div>

      {lines.length > 0 && (
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.id} className="flex items-center gap-2">
              <Input
                className="flex-1"
                defaultValue={formatType(line.category)}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== formatType(line.category)) saveLine(line, { category: v })
                }}
              />
              <Input
                className="w-28"
                type="number"
                min="0"
                step="0.01"
                defaultValue={centsToDollarInput(line.amount)}
                onBlur={(e) => {
                  const cents = dollarsToCents(e.target.value)
                  if (cents != null && cents !== line.amount) saveLine(line, { amount: cents })
                }}
              />
              <Badge color={line.origin === 'user' ? 'blue' : 'gray'} size="sm">
                {line.origin === 'user' ? 'You' : 'LLM est'}
              </Badge>
              <button
                type="button"
                onClick={() => removeLine(line)}
                className="p-2 text-text-subtle hover:text-debit rounded-lg hover:bg-surface-raised transition-colors"
                aria-label="Remove line"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Input
          label="Add a line"
          className="flex-1"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLine() } }}
          placeholder="e.g. Pet care"
        />
        <Input
          className="w-28"
          type="number"
          min="0"
          step="0.01"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLine() } }}
          placeholder="0.00"
        />
        <Button type="button" variant="ghost" size="sm" onClick={addLine}>Add</Button>
      </div>

      {summary?.has_budget && (
        <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-text-muted">Monthly cash flow</span>
            <span className="tnum text-text">{formatMoney(summary.monthly_cash_flow)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">− Budgeted variable spending</span>
            <span className="tnum text-text">{formatMoney(summary.budget_total)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <span className="text-text">Monthly spending money</span>
            <span className={`tnum ${summary.spending_money >= 0 ? 'text-credit' : 'text-debit'}`}>
              {formatMoney(summary.spending_money)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Input, { Select } from './ui/Input'
import { centsToDollarInput, dollarsToCents, formatMoney, isDebt } from '../lib/utils'

/**
 * Shared payment modal for the Expenses and Accounts pages.
 *
 * `accounts` are the funding-source candidates (active asset accounts). On submit
 * it calls `onSubmit({ amountCents, sourceId, note })` — the caller POSTs to the
 * right endpoint. Amount is entered in dollars and converted to integer cents.
 */
export default function PayModal({
  isOpen, onClose, title, label, defaultAmount, accounts, defaultSourceId,
  requireSource = false, busy, onSubmit,
}) {
  const [amount, setAmount] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [note, setNote] = useState('')

  // Reset fields each time the modal opens for a (possibly different) target.
  useEffect(() => {
    if (isOpen) {
      setAmount(centsToDollarInput(defaultAmount) ?? '')
      setSourceId(defaultSourceId != null ? String(defaultSourceId) : '')
      setNote('')
    }
  }, [isOpen, defaultAmount, defaultSourceId])

  // Funding sources: active, non-debt accounts (you pay FROM cash/savings).
  const sources = accounts.filter((a) => !isDebt(a.type))

  function handleSubmit(e) {
    e.preventDefault()
    const amountCents = dollarsToCents(amount)
    if (!amountCents || amountCents <= 0) return
    if (requireSource && !sourceId) return
    onSubmit({
      amountCents,
      sourceId: sourceId ? Number(sourceId) : null,
      note: note.trim() || null,
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {label && <p className="text-sm text-text-muted">{label}</p>}
        <Input
          label="Amount"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
          required
        />
        <Select
          label="Pay from"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          required={requireSource}
        >
          <option value="">{requireSource ? 'Select an account…' : 'No source (record only)'}</option>
          {sources.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({formatMoney(a.current_balance ?? a.balance ?? 0)})
            </option>
          ))}
        </Select>
        <Input
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Extra principal payment"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="success" loading={busy}>Record payment</Button>
        </div>
      </form>
    </Modal>
  )
}

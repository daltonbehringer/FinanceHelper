import { useState } from 'react'
import { formatMoney, formatDate, nextDueDate, dollarsToCents, centsToDollarInput } from '../lib/utils'
import { useExpenses } from '../hooks/useExpenses'
import { useAccounts } from '../hooks/useAccounts'
import { useSettings } from '../hooks/useSettings'
import { useCrudPage } from '../hooks/useCrudPage'
import { apiFetch } from '../lib/api'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import OverflowMenu from '../components/ui/OverflowMenu'
import PayModal from '../components/PayModal'
import EntityPage, { isInactive } from '../components/crud/EntityPage'

const EMPTY_FORM = { name: '', amount: '', category: '', isOneTime: false, due_day: '', due_date: '' }

const isRecurring = (e) => e.is_recurring === 1 || e.is_recurring === true

function getSortValue(item, key) {
  switch (key) {
    case 'name': return (item.name || '').toLowerCase()
    case 'type': return isRecurring(item) ? 'recurring' : 'one-time'
    case 'amount': return item.amount ?? 0
    case 'due': return isRecurring(item) ? (item.due_day ?? 9999) : (item.due_date || '￿')
    case 'category': return (item.category || '').toLowerCase()
    default: return ''
  }
}

function expenseDue(exp) {
  if (isRecurring(exp)) return exp.due_day ? nextDueDate(exp.due_day, exp.last_paid_date) : '—'
  return exp.due_date ? formatDate(exp.due_date) : '—'
}

function ExpenseForm({ form, setForm, onSubmit, loading, submitLabel }) {
  const handleChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Input label="Name" value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="e.g. Netflix, Rent" required />
      <Input label="Amount" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => handleChange('amount', e.target.value)} placeholder="0.00" required />
      <Input label="Category" value={form.category} onChange={(e) => handleChange('category', e.target.value)} placeholder="e.g. Entertainment, Housing" />

      <div className="flex items-end">
        <label className="flex items-center gap-2 cursor-pointer select-none pb-2">
          <div
            role="switch"
            aria-checked={form.isOneTime}
            tabIndex={0}
            onClick={() => handleChange('isOneTime', !form.isOneTime)}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleChange('isOneTime', !form.isOneTime) } }}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out cursor-pointer ${form.isOneTime ? 'bg-accent' : 'bg-border-strong'}`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ease-in-out ${form.isOneTime ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
          <span className="text-sm font-medium text-text-muted">One-time expense</span>
        </label>
      </div>

      {form.isOneTime ? (
        <Input label="Due Date" type="date" value={form.due_date} onChange={(e) => handleChange('due_date', e.target.value)} />
      ) : (
        <Input label="Due Day (1-28)" type="number" min="1" max="28" value={form.due_day} onChange={(e) => handleChange('due_day', e.target.value)} placeholder="e.g. 15" />
      )}

      <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
        <Button type="submit" loading={loading}>{submitLabel}</Button>
      </div>
    </form>
  )
}

function MobileRow({ expense, actions }) {
  const inactive = isInactive(expense)
  const recurring = isRecurring(expense)
  const due = expenseDue(expense)
  return (
    <div className={`flex items-center justify-between px-4 py-3 ${inactive ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text truncate">{expense.name}</span>
          {inactive && <Badge color="gray">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge color={recurring ? 'green' : 'blue'}>{recurring ? 'Recurring' : 'One-time'}</Badge>
          <span className="text-sm font-semibold tnum text-text">{formatMoney(expense.amount)}</span>
        </div>
        {due !== '—' && <div className="text-xs text-text-subtle mt-0.5">Due: {due}</div>}
      </div>
      <OverflowMenu items={actions} />
    </div>
  )
}

function buildPayload(form) {
  const body = {
    name: form.name.trim(),
    amount: dollarsToCents(form.amount),
    category: form.category.trim() || null,
    is_recurring: !form.isOneTime,
  }
  if (form.isOneTime) { body.due_date = form.due_date || null; body.due_day = null }
  else { body.due_day = form.due_day ? parseInt(form.due_day, 10) : null; body.due_date = null }
  return body
}

export default function Expenses() {
  const crud = useCrudPage({
    useEntities: useExpenses,
    itemsKey: 'expenses',
    basePath: '/api/expenses',
    entityLabel: 'Expense',
    emptyForm: EMPTY_FORM,
    buildAddPayload: buildPayload,
    buildEditPayload: buildPayload,
    mapToForm: (exp) => ({
      name: exp.name,
      amount: centsToDollarInput(exp.amount),
      category: exp.category || '',
      isOneTime: exp.is_recurring === 0 || exp.is_recurring === false,
      due_day: exp.due_day != null ? String(exp.due_day) : '',
      due_date: exp.due_date || '',
    }),
    getSortValue,
    defaultSort: { col: 'due', dir: 'asc' },
  })

  const { accounts } = useAccounts()
  const { settings } = useSettings()
  const [payTarget, setPayTarget] = useState(null)
  const [paying, setPaying] = useState(false)

  async function handlePay({ amountCents, sourceId, note }) {
    setPaying(true)
    try {
      const body = { note }
      if (sourceId) {
        const source = accounts.find((a) => a.id === sourceId)
        const cur = source?.current_balance ?? source?.balance ?? 0
        body.source_account_id = sourceId
        body.source_new_balance = cur - amountCents
      }
      const resp = await apiFetch(`/api/expenses/${payTarget.id}/pay`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (resp && resp.ok) {
        crud.showToast(`Paid ${payTarget.name}`, 'success')
        setPayTarget(null)
        crud.refetch()
      } else {
        crud.showToast('Failed to record payment', 'error')
      }
    } catch {
      crud.showToast('Failed to record payment', 'error')
    } finally {
      setPaying(false)
    }
  }

  const columns = [
    { key: 'name', label: 'Name', headerClass: 'w-[25%]', cellClass: 'font-medium text-text truncate', render: (e) => e.name },
    { key: 'type', label: 'Type', headerClass: 'w-[15%]', render: (e) => <Badge color={isRecurring(e) ? 'green' : 'blue'}>{isRecurring(e) ? 'Recurring' : 'One-time'}</Badge> },
    { key: 'amount', label: 'Amount', align: 'right', headerClass: 'w-[15%]', cellClass: 'text-text tnum truncate', render: (e) => formatMoney(e.amount) },
    { key: 'due', label: 'Due', headerClass: 'w-[15%]', cellClass: 'text-text-muted truncate', render: expenseDue },
    { key: 'category', label: 'Category', hide: 'lg', headerClass: 'w-[20%]', render: (e) => (e.category ? <Badge color="gray">{e.category}</Badge> : <span className="text-text-subtle">{'—'}</span>) },
  ]

  return (
    <>
    <EntityPage
      crud={crud}
      title="Expenses"
      addLabel="Add Expense"
      entityLabel="Expense"
      columns={columns}
      extraActions={(exp) => [{ label: 'Pay', onClick: () => setPayTarget(exp) }]}
      mobileSortOptions={[
        { value: 'due:asc', label: 'Sort: Due Date (soonest)' },
        { value: 'due:desc', label: 'Sort: Due Date (latest)' },
        { value: 'name:asc', label: 'Sort: Name (A-Z)' },
        { value: 'name:desc', label: 'Sort: Name (Z-A)' },
        { value: 'amount:desc', label: 'Sort: Amount (high-low)' },
        { value: 'amount:asc', label: 'Sort: Amount (low-high)' },
        { value: 'type:asc', label: 'Sort: Type' },
        { value: 'category:asc', label: 'Sort: Category' },
      ]}
      renderMobileRow={(e, actions) => <MobileRow key={e.id} expense={e} actions={actions} />}
      FormComponent={ExpenseForm}
      addFormProps={{ form: crud.addForm, setForm: crud.setAddForm, onSubmit: crud.handleAdd, loading: crud.addLoading, submitLabel: 'Add Expense' }}
      editFormProps={{ form: crud.editForm, setForm: crud.setEditForm, onSubmit: crud.handleEdit, loading: crud.editLoading, submitLabel: 'Save Changes' }}
      formTitles={{ add: 'New Expense', edit: 'Edit Expense' }}
      modalMaxWidth="max-w-lg"
      emptyTitle="No expenses yet"
      emptyDescription="Add your first expense to start tracking your spending."
      emptyIcon={
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
        </svg>
      }
    />
    <PayModal
      isOpen={payTarget != null}
      onClose={() => setPayTarget(null)}
      title={payTarget ? `Pay ${payTarget.name}` : 'Pay expense'}
      label="Marks this expense paid and advances its due date."
      defaultAmount={payTarget?.amount}
      accounts={accounts}
      defaultSourceId={settings?.default_payment_account_id}
      busy={paying}
      onSubmit={handlePay}
    />
    </>
  )
}

import { apiFetch } from '../lib/api'
import { formatMoney, formatDate, formatFrequency, monthlyEquiv, nextPayday, dollarsToCents, centsToDollarInput } from '../lib/utils'
import { useIncome } from '../hooks/useIncome'
import { useCrudPage } from '../hooks/useCrudPage'
import { FREQUENCIES } from '../lib/constants'
import Button from '../components/ui/Button'
import Input, { Select } from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import OverflowMenu from '../components/ui/OverflowMenu'
import EntityPage, { isInactive } from '../components/crud/EntityPage'

const EMPTY_FORM = { name: '', amount: '', frequency: 'monthly', income_day: '', last_pay_date: '' }

function freqBadgeColor(frequency) {
  return { weekly: 'purple', biweekly: 'blue', semimonthly: 'blue', monthly: 'green', annual: 'yellow' }[frequency] || 'gray'
}

const FREQ_ORDER = { weekly: 0, biweekly: 1, semimonthly: 2, monthly: 3, annual: 4 }

function getSortValue(item, key) {
  switch (key) {
    case 'name': return (item.name || '').toLowerCase()
    case 'amount': return item.amount ?? 0
    case 'frequency': return FREQ_ORDER[item.frequency] ?? 99
    case 'next_payday': return nextPayday(item.last_pay_date, item.frequency)
    case 'last_paid': return item.last_pay_date || ''
    case 'monthly_equiv': return monthlyEquiv(item.amount, item.frequency)
    default: return ''
  }
}

function IncomeForm({ form, setForm, onSubmit, onCancel, loading, submitLabel }) {
  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <Input label="Name *" name="name" value={form.name} onChange={handleChange} required placeholder="e.g. Salary" />
      <Input label="Amount (per period, post-tax) *" name="amount" type="number" step="0.01" min="0" value={form.amount} onChange={handleChange} required placeholder="0.00" />
      <Select label="Frequency *" name="frequency" value={form.frequency} onChange={handleChange} required>
        {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </Select>
      <Input label="Pay Day" name="income_day" type="number" min="1" max="28" value={form.income_day} onChange={handleChange} placeholder="1-28" />
      <Input label="Last Pay Date" name="last_pay_date" type="date" value={form.last_pay_date} onChange={handleChange} />
      <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-2">
        <Button type="submit" loading={loading}>{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function MobileRow({ item, actions }) {
  const inactive = isInactive(item)
  const next = nextPayday(item.last_pay_date, item.frequency)
  return (
    <div className={`flex items-center justify-between px-4 py-3 ${inactive ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text truncate">{item.name}</span>
          {inactive && <Badge color="gray">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge color={freqBadgeColor(item.frequency)}>{formatFrequency(item.frequency)}</Badge>
          <span className="text-sm font-semibold tnum text-credit">{formatMoney(item.amount)}</span>
        </div>
        {next && next !== '—' && <div className="text-xs text-text-subtle mt-0.5">Next: {next}</div>}
      </div>
      <OverflowMenu items={actions} />
    </div>
  )
}

function buildPayload(form) {
  const payload = { name: form.name.trim(), amount: dollarsToCents(form.amount) ?? 0, frequency: form.frequency }
  if (form.income_day !== '') payload.income_day = parseInt(form.income_day, 10)
  if (form.last_pay_date) payload.last_pay_date = form.last_pay_date
  return payload
}

export default function Income() {
  const crud = useCrudPage({
    useEntities: useIncome,
    itemsKey: 'income',
    basePath: '/api/income',
    entityLabel: 'Income',
    emptyForm: EMPTY_FORM,
    buildAddPayload: buildPayload,
    buildEditPayload: buildPayload,
    mapToForm: (item) => ({
      name: item.name || '',
      amount: centsToDollarInput(item.amount),
      frequency: item.frequency || 'monthly',
      income_day: item.income_day ?? '',
      last_pay_date: item.last_pay_date || '',
    }),
    getSortValue,
    defaultSort: { col: 'name', dir: 'asc' },
  })

  async function handleMarkPaid(item) {
    try {
      const resp = await apiFetch(`/api/income/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ last_pay_date: new Date().toISOString().split('T')[0] }),
      })
      if (resp && resp.ok) {
        crud.showToast(`${item.name} marked as paid`, 'success')
        crud.refetch()
      } else {
        crud.showToast('Failed to mark as paid', 'error')
      }
    } catch {
      crud.showToast('Failed to mark as paid', 'error')
    }
  }

  const columns = [
    { key: 'name', label: 'Name', headerClass: 'w-[18%]', cellClass: 'font-medium text-text truncate', render: (i) => (<>{i.name}{isInactive(i) && <Badge color="gray" className="ml-2">Inactive</Badge>}</>) },
    { key: 'amount', label: 'Amount', align: 'right', headerClass: 'w-[14%]', cellClass: 'font-medium text-text tnum truncate', render: (i) => formatMoney(i.amount) },
    { key: 'frequency', label: 'Frequency', headerClass: 'w-[14%]', render: (i) => <Badge color={freqBadgeColor(i.frequency)}>{formatFrequency(i.frequency)}</Badge> },
    { key: 'next_payday', label: 'Next Payday', headerClass: 'w-[14%]', cellClass: 'font-bold text-credit truncate', render: (i) => nextPayday(i.last_pay_date, i.frequency) },
    { key: 'last_paid', label: 'Last Paid', hide: 'lg', headerClass: 'w-[14%]', cellClass: 'text-text-muted truncate', render: (i) => formatDate(i.last_pay_date) },
    { key: 'monthly_equiv', label: 'Monthly Equiv', align: 'right', hide: 'lg', headerClass: 'w-[14%]', cellClass: 'font-medium text-credit tnum truncate', render: (i) => formatMoney(monthlyEquiv(i.amount, i.frequency)) },
  ]

  return (
    <EntityPage
      crud={crud}
      title="Income"
      addLabel="Add Income"
      entityLabel="Income"
      columns={columns}
      mobileSortOptions={[
        { value: 'name:asc', label: 'Sort: Name (A-Z)' },
        { value: 'name:desc', label: 'Sort: Name (Z-A)' },
        { value: 'amount:desc', label: 'Sort: Amount (high-low)' },
        { value: 'amount:asc', label: 'Sort: Amount (low-high)' },
        { value: 'frequency:asc', label: 'Sort: Frequency' },
        { value: 'monthly_equiv:desc', label: 'Sort: Monthly (high-low)' },
      ]}
      renderMobileRow={(i, actions) => <MobileRow key={i.id} item={i} actions={actions} />}
      extraActions={(item) => (item.last_pay_date ? [{ label: 'Mark Paid', onClick: () => handleMarkPaid(item) }] : [])}
      FormComponent={IncomeForm}
      addFormProps={{ form: crud.addForm, setForm: crud.setAddForm, onSubmit: crud.handleAdd, onCancel: crud.toggleAdd, loading: crud.addLoading, submitLabel: 'Create Income' }}
      editFormProps={{ form: crud.editForm, setForm: crud.setEditForm, onSubmit: crud.handleEdit, onCancel: crud.closeEdit, loading: crud.editLoading, submitLabel: 'Save Changes' }}
      formTitles={{ add: 'New Income', edit: 'Edit Income' }}
      emptyTitle="No income sources yet"
      emptyDescription="Add your first income source to start tracking your earnings."
      emptyIcon={
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      }
    />
  )
}

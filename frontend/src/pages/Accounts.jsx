import { formatMoney, formatRate, formatDate, formatType, isDebt, dollarsToCents, centsToDollarInput } from '../lib/utils'
import { useAccounts } from '../hooks/useAccounts'
import { useAccountFields } from '../hooks/useAccountFields'
import { useCrudPage } from '../hooks/useCrudPage'
import { INVESTMENT_TYPES } from '../lib/constants'
import Button from '../components/ui/Button'
import Input, { Select } from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import OverflowMenu from '../components/ui/OverflowMenu'
import EntityPage, { isInactive } from '../components/crud/EntityPage'

const EMPTY_FORM = {
  name: '', type: 'checking', balance: '', interest_rate: '', minimum_payment: '',
  credit_limit: '', due_date: '', promo_rate: '', promo_end_date: '',
}

function typeBadgeColor(type) {
  if (isDebt(type)) return 'red'
  if (['checking', 'savings'].includes(type)) return 'green'
  if (INVESTMENT_TYPES.includes(type)) return 'blue'
  return 'gray'
}

function getSortValue(item, key) {
  switch (key) {
    case 'name': return (item.name || '').toLowerCase()
    case 'type': return (item.type || '').toLowerCase()
    case 'balance': return item.current_balance ?? item.balance ?? 0
    case 'minimum_payment': return item.minimum_payment ?? 0
    case 'due_date': return item.due_date || '￿'
    case 'interest_rate': return item.interest_rate ?? 0
    case 'promo': return item.promo_rate ?? 0
    default: return ''
  }
}

// Fields render dynamically from the backend registry (GET /api/meta/account-fields).
// Account type is immutable after creation, so the type selector is locked in edit mode.
function AccountForm({ form, setForm, fieldTypes, onSubmit, onCancel, loading, submitLabel, lockType = false }) {
  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }
  const selectedType = fieldTypes.find((t) => t.value === form.type)
  const fields = selectedType ? selectedType.fields : []

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <Input label="Name *" name="name" value={form.name} onChange={handleChange} required placeholder="e.g. Chase Sapphire" />
      <Select label="Type *" name="type" value={form.type} onChange={handleChange} required disabled={lockType}>
        {fieldTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      {fields.map((f) => (
        <Input
          key={f.name}
          label={f.required ? `${f.label} *` : f.label}
          name={f.name}
          type={f.kind === 'date' ? 'date' : 'number'}
          step={f.kind === 'date' ? undefined : '0.01'}
          min={f.name === 'balance' || f.kind === 'date' ? undefined : '0'}
          value={form[f.name] ?? ''}
          onChange={handleChange}
          required={f.required}
          placeholder={f.kind === 'date' ? undefined : '0.00'}
        />
      ))}
      <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-2">
        <Button type="submit" loading={loading}>{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function MobileRow({ account, actions }) {
  const balance = account.current_balance ?? account.balance
  const inactive = isInactive(account)
  return (
    <div className={`flex items-center justify-between px-4 py-3 ${inactive ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text truncate">{account.name}</span>
          {inactive && <Badge color="gray">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge color={typeBadgeColor(account.type)}>{formatType(account.type)}</Badge>
          <span className={`text-sm font-semibold tnum ${isDebt(account.type) ? 'text-debit' : 'text-credit'}`}>
            {formatMoney(balance)}
          </span>
        </div>
        {(account.minimum_payment || account.due_date) && (
          <div className="flex items-center gap-2 mt-0.5 text-xs text-text-subtle">
            {account.minimum_payment && <span>Min: {formatMoney(account.minimum_payment)}</span>}
            {account.minimum_payment && account.due_date && <span>&middot;</span>}
            {account.due_date && <span>Due: {formatDate(account.due_date)}</span>}
          </div>
        )}
      </div>
      <OverflowMenu items={actions} />
    </div>
  )
}

export default function Accounts() {
  const { types: fieldTypes } = useAccountFields()

  // Build the request from the registry's field list for the chosen type.
  // Money inputs are dollars in the UI and integer cents on the wire.
  function buildPayload(form, includeType) {
    const payload = { name: form.name.trim() }
    if (includeType) payload.type = form.type
    const selectedType = fieldTypes.find((t) => t.value === form.type)
    for (const f of selectedType?.fields ?? []) {
      const value = form[f.name]
      if (f.name === 'balance') {
        payload.balance = dollarsToCents(value) ?? 0
      } else if (value !== '' && value != null) {
        payload[f.name] = f.kind === 'money' ? dollarsToCents(value)
          : f.kind === 'rate' ? parseFloat(value)
          : value
      }
    }
    return payload
  }

  const crud = useCrudPage({
    useEntities: useAccounts,
    itemsKey: 'accounts',
    basePath: '/api/accounts',
    entityLabel: 'Account',
    emptyForm: EMPTY_FORM,
    buildAddPayload: (form) => buildPayload(form, true),
    buildEditPayload: (form) => buildPayload(form, false),   // type is immutable
    mapToForm: (a) => ({
      name: a.name || '',
      type: a.type || 'checking',
      balance: centsToDollarInput(a.current_balance ?? a.balance),
      interest_rate: a.interest_rate ?? '',
      minimum_payment: centsToDollarInput(a.minimum_payment),
      credit_limit: centsToDollarInput(a.credit_limit),
      due_date: a.due_date || '',
      promo_rate: a.promo_rate ?? '',
      promo_end_date: a.promo_end_date || '',
    }),
    getSortValue,
    defaultSort: { col: 'due_date', dir: 'asc' },
  })

  const columns = [
    {
      key: 'name', label: 'Name', headerClass: 'w-[18%]',
      cellClass: 'font-medium text-text truncate',
      render: (a) => (
        <>{a.name}{isInactive(a) && <Badge color="gray" className="ml-2">Inactive</Badge>}</>
      ),
    },
    { key: 'type', label: 'Type', headerClass: 'w-[12%]', render: (a) => <Badge color={typeBadgeColor(a.type)}>{formatType(a.type)}</Badge> },
    {
      key: 'balance', label: 'Balance', align: 'right', headerClass: 'w-[14%]',
      cellClass: `font-medium tnum truncate`,
      render: (a) => (
        <span className={isDebt(a.type) ? 'text-debit' : 'text-credit'}>
          {formatMoney(a.current_balance ?? a.balance)}
        </span>
      ),
    },
    { key: 'minimum_payment', label: 'Min Payment', align: 'right', hide: 'lg', headerClass: 'w-[12%]', cellClass: 'text-text-muted tnum truncate', render: (a) => (a.minimum_payment ? formatMoney(a.minimum_payment) : '—') },
    { key: 'due_date', label: 'Due Date', hide: 'lg', headerClass: 'w-[12%]', cellClass: 'text-text-muted truncate', render: (a) => formatDate(a.due_date) },
    { key: 'interest_rate', label: 'Rate', align: 'right', headerClass: 'w-[10%]', cellClass: 'text-text-muted tnum truncate', render: (a) => formatRate(a.interest_rate) },
    {
      key: 'promo', label: 'Promo', hide: 'xl', headerClass: 'w-[12%]',
      render: (a) => (a.promo_rate ? <Badge color="yellow">{formatRate(a.promo_rate)}</Badge> : <span className="text-text-subtle">{'—'}</span>),
    },
  ]

  return (
    <EntityPage
      crud={crud}
      title="Accounts"
      addLabel="Add Account"
      entityLabel="Account"
      columns={columns}
      mobileSortOptions={[
        { value: 'due_date:asc', label: 'Sort: Due Date (soonest)' },
        { value: 'due_date:desc', label: 'Sort: Due Date (latest)' },
        { value: 'name:asc', label: 'Sort: Name (A-Z)' },
        { value: 'name:desc', label: 'Sort: Name (Z-A)' },
        { value: 'balance:desc', label: 'Sort: Balance (high-low)' },
        { value: 'balance:asc', label: 'Sort: Balance (low-high)' },
        { value: 'type:asc', label: 'Sort: Type' },
        { value: 'interest_rate:desc', label: 'Sort: Rate (highest)' },
      ]}
      renderMobileRow={(a, actions) => <MobileRow key={a.id} account={a} actions={actions} />}
      FormComponent={AccountForm}
      addFormProps={{ fieldTypes, form: crud.addForm, setForm: crud.setAddForm, onSubmit: crud.handleAdd, onCancel: crud.toggleAdd, loading: crud.addLoading, submitLabel: 'Create Account' }}
      editFormProps={{ fieldTypes, form: crud.editForm, setForm: crud.setEditForm, lockType: true, onSubmit: crud.handleEdit, onCancel: crud.closeEdit, loading: crud.editLoading, submitLabel: 'Save Changes' }}
      formTitles={{ add: 'New Account', edit: 'Edit Account' }}
      emptyTitle="No accounts yet"
      emptyDescription="Add your first account to start tracking your finances."
      emptyIcon={
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
      }
    />
  )
}

import { useState, useMemo } from 'react'
import { apiFetch } from '../lib/api'
import { formatMoney, formatRate, formatDate, formatType, isDebt } from '../lib/utils'
import { useAccounts } from '../hooks/useAccounts'
import { useToast } from '../context/ToastContext'
import { ACCOUNT_TYPES, INVESTMENT_TYPES } from '../lib/constants'
import Button from '../components/ui/Button'
import Card, { CardBody } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Input, { Select } from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import OverflowMenu from '../components/ui/OverflowMenu'
import SortableHeader from '../components/ui/SortableHeader'

const EMPTY_FORM = {
  name: '',
  type: 'checking',
  balance: '',
  interest_rate: '',
  minimum_payment: '',
  credit_limit: '',
  due_date: '',
  promo_rate: '',
  promo_end_date: '',
}

function typeBadgeColor(type) {
  if (isDebt(type)) return 'red'
  if (['checking', 'savings'].includes(type)) return 'green'
  if (INVESTMENT_TYPES.includes(type)) return 'blue'
  return 'gray'
}

function AccountForm({ form, setForm, onSubmit, onCancel, loading, submitLabel }) {
  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        onSubmit()
      }}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <Input
        label="Name *"
        name="name"
        value={form.name}
        onChange={handleChange}
        required
        placeholder="e.g. Chase Sapphire"
      />
      <Select
        label="Type *"
        name="type"
        value={form.type}
        onChange={handleChange}
        required
      >
        {ACCOUNT_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </Select>
      <Input
        label="Balance *"
        name="balance"
        type="number"
        step="0.01"
        value={form.balance}
        onChange={handleChange}
        required
        placeholder="0.00"
      />
      <Input
        label="Interest Rate (%)"
        name="interest_rate"
        type="number"
        step="0.01"
        min="0"
        value={form.interest_rate}
        onChange={handleChange}
        placeholder="0.00"
      />
      <Input
        label="Minimum Payment"
        name="minimum_payment"
        type="number"
        step="0.01"
        min="0"
        value={form.minimum_payment}
        onChange={handleChange}
        placeholder="0.00"
      />
      <Input
        label="Credit Limit"
        name="credit_limit"
        type="number"
        step="0.01"
        min="0"
        value={form.credit_limit}
        onChange={handleChange}
        placeholder="0.00"
      />
      <Input
        label="Due Date"
        name="due_date"
        type="date"
        value={form.due_date}
        onChange={handleChange}
      />
      <Input
        label="Promo Rate (%)"
        name="promo_rate"
        type="number"
        step="0.01"
        min="0"
        value={form.promo_rate}
        onChange={handleChange}
        placeholder="0.00"
      />
      <Input
        label="Promo End Date"
        name="promo_end_date"
        type="date"
        value={form.promo_end_date}
        onChange={handleChange}
      />
      <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-2">
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function MobileAccountList({ accounts, onEdit, onDeactivate }) {
  return (
    <div className="divide-y divide-gray-100">
      {accounts.map(a => {
        const balance = a.current_balance ?? a.balance
        const inactive = a.is_active === 0 || a.is_active === false
        const menuItems = [{ label: 'Edit', onClick: () => onEdit(a) }]
        if (!inactive) {
          menuItems.push({ label: 'Deactivate', onClick: () => onDeactivate(a), danger: true })
        }

        return (
          <div
            key={a.id}
            className={`flex items-center justify-between px-4 py-3 ${inactive ? 'opacity-50' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 truncate">{a.name}</span>
                {inactive && <Badge color="gray">Inactive</Badge>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge color={typeBadgeColor(a.type)}>{formatType(a.type)}</Badge>
                <span className={`text-sm font-semibold ${isDebt(a.type) ? 'text-red-600' : 'text-green-600'}`}>
                  {formatMoney(balance)}
                </span>
              </div>
            </div>
            <OverflowMenu items={menuItems} />
          </div>
        )
      })}
    </div>
  )
}

function getSortValue(item, key) {
  switch (key) {
    case 'name': return (item.name || '').toLowerCase()
    case 'type': return (item.type || '').toLowerCase()
    case 'balance': return item.current_balance ?? item.balance ?? 0
    case 'minimum_payment': return item.minimum_payment ?? 0
    case 'due_date': return item.due_date || ''
    case 'interest_rate': return item.interest_rate ?? 0
    case 'promo': return item.promo_rate ?? 0
    default: return ''
  }
}

export default function Accounts() {
  const [showInactive, setShowInactive] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editAccount, setEditAccount] = useState(null)
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [addLoading, setAddLoading] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const { accounts, loading, refetch } = useAccounts(showInactive)
  const { showToast } = useToast()

  const sorted = useMemo(() => {
    const copy = [...accounts]
    copy.sort((a, b) => {
      const va = getSortValue(a, sortCol)
      const vb = getSortValue(b, sortCol)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [accounts, sortCol, sortDir])

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  function buildPayload(form) {
    const payload = {
      name: form.name.trim(),
      type: form.type,
      balance: parseFloat(form.balance) || 0,
    }
    if (form.interest_rate !== '') payload.interest_rate = parseFloat(form.interest_rate)
    if (form.minimum_payment !== '') payload.minimum_payment = parseFloat(form.minimum_payment)
    if (form.credit_limit !== '') payload.credit_limit = parseFloat(form.credit_limit)
    if (form.due_date) payload.due_date = form.due_date
    if (form.promo_rate !== '') payload.promo_rate = parseFloat(form.promo_rate)
    if (form.promo_end_date) payload.promo_end_date = form.promo_end_date
    return payload
  }

  async function handleAdd() {
    setAddLoading(true)
    try {
      const resp = await apiFetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(buildPayload(addForm)),
      })
      if (resp && resp.ok) {
        showToast('Account created', 'success')
        setAddForm(EMPTY_FORM)
        setShowAddForm(false)
        refetch()
      } else {
        const err = resp ? await resp.json().catch(() => null) : null
        showToast(err?.detail || 'Failed to create account', 'error')
      }
    } catch {
      showToast('Failed to create account', 'error')
    } finally {
      setAddLoading(false)
    }
  }

  async function handleEdit() {
    if (!editAccount) return
    setEditLoading(true)
    try {
      const resp = await apiFetch(`/api/accounts/${editAccount.id}`, {
        method: 'PUT',
        body: JSON.stringify(buildPayload(editForm)),
      })
      if (resp && resp.ok) {
        showToast('Account updated', 'success')
        setEditAccount(null)
        refetch()
      } else {
        const err = resp ? await resp.json().catch(() => null) : null
        showToast(err?.detail || 'Failed to update account', 'error')
      }
    } catch {
      showToast('Failed to update account', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  async function handleDeactivate(account) {
    if (!window.confirm(`Deactivate "${account.name}"? It will be hidden from active views.`)) return
    try {
      const resp = await apiFetch(`/api/accounts/${account.id}/deactivate`, { method: 'POST' })
      if (resp && resp.ok) {
        showToast(`${account.name} deactivated`, 'success')
        refetch()
      } else {
        showToast('Failed to deactivate account', 'error')
      }
    } catch {
      showToast('Failed to deactivate account', 'error')
    }
  }

  function openEdit(account) {
    setEditForm({
      name: account.name || '',
      type: account.type || 'checking',
      balance: account.current_balance ?? account.balance ?? '',
      interest_rate: account.interest_rate ?? '',
      minimum_payment: account.minimum_payment ?? '',
      credit_limit: account.credit_limit ?? '',
      due_date: account.due_date || '',
      promo_rate: account.promo_rate ?? '',
      promo_end_date: account.promo_end_date || '',
    })
    setEditAccount(account)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" className="text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded border-gray-300 text-accent focus:ring-accent/20"
            />
            Show inactive
          </label>
          <Button
            onClick={() => {
              setAddForm(EMPTY_FORM)
              setShowAddForm(v => !v)
            }}
          >
            {showAddForm ? 'Cancel' : 'Add Account'}
          </Button>
        </div>
      </div>

      {/* Add Account form */}
      {showAddForm && (
        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Account</h2>
            <AccountForm
              form={addForm}
              setForm={setAddForm}
              onSubmit={handleAdd}
              onCancel={() => setShowAddForm(false)}
              loading={addLoading}
              submitLabel="Create Account"
            />
          </CardBody>
        </Card>
      )}

      {/* Accounts list/table */}
      {accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
              </svg>
            }
            title="No accounts yet"
            description="Add your first account to start tracking your finances."
            action="Add Account"
            onAction={() => {
              setAddForm(EMPTY_FORM)
              setShowAddForm(true)
            }}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Mobile compact list */}
          <div className="md:hidden">
            <MobileAccountList
              accounts={sorted}
              onEdit={openEdit}
              onDeactivate={handleDeactivate}
            />
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <SortableHeader label="Name" sortKey="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[18%]" />
                  <SortableHeader label="Type" sortKey="type" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[12%]" />
                  <SortableHeader label="Balance" sortKey="balance" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right w-[14%]" />
                  <SortableHeader label="Min Payment" sortKey="minimum_payment" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right w-[12%] hidden lg:table-cell" />
                  <SortableHeader label="Due Date" sortKey="due_date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[12%] hidden lg:table-cell" />
                  <SortableHeader label="Rate" sortKey="interest_rate" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right w-[10%]" />
                  <SortableHeader label="Promo" sortKey="promo" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[12%] hidden xl:table-cell" />
                  <th className="px-4 py-3 text-right font-medium text-gray-500 w-[10%]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(a => {
                  const balance = a.current_balance ?? a.balance
                  const inactive = a.is_active === 0 || a.is_active === false
                  return (
                    <tr
                      key={a.id}
                      className={`hover:bg-gray-50/50 transition-colors ${inactive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 truncate">
                        {a.name}
                        {inactive && (
                          <Badge color="gray" className="ml-2">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={typeBadgeColor(a.type)}>{formatType(a.type)}</Badge>
                      </td>
                      <td className={`px-4 py-3 text-right font-medium truncate ${
                        isDebt(a.type) ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {formatMoney(balance)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 truncate hidden lg:table-cell">
                        {a.minimum_payment ? formatMoney(a.minimum_payment) : '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 truncate hidden lg:table-cell">
                        {formatDate(a.due_date)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 truncate">
                        {formatRate(a.interest_rate)}
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        {a.promo_rate ? (
                          <Badge color="yellow">
                            {formatRate(a.promo_rate)}
                          </Badge>
                        ) : (
                          <span className="text-gray-400">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <OverflowMenu
                          items={[
                            { label: 'Edit', onClick: () => openEdit(a) },
                            ...(!inactive ? [{ label: 'Deactivate', onClick: () => handleDeactivate(a), danger: true }] : []),
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Edit Account modal */}
      <Modal
        isOpen={editAccount !== null}
        onClose={() => setEditAccount(null)}
        title="Edit Account"
        maxWidth="max-w-2xl"
      >
        <AccountForm
          form={editForm}
          setForm={setEditForm}
          onSubmit={handleEdit}
          onCancel={() => setEditAccount(null)}
          loading={editLoading}
          submitLabel="Save Changes"
        />
      </Modal>
    </div>
  )
}

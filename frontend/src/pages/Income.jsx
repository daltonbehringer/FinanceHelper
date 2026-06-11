import { useState, useMemo } from 'react'
import { apiFetch } from '../lib/api'
import { formatMoney, formatDate, formatFrequency, monthlyEquiv, nextPayday, dollarsToCents, centsToDollarInput } from '../lib/utils'
import { useIncome } from '../hooks/useIncome'
import { useToast } from '../context/ToastContext'
import { FREQUENCIES } from '../lib/constants'
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
  amount: '',
  frequency: 'monthly',
  income_day: '',
  last_pay_date: '',
}

function freqBadgeColor(frequency) {
  return {
    weekly: 'purple',
    biweekly: 'blue',
    semimonthly: 'blue',
    monthly: 'green',
    annual: 'yellow',
  }[frequency] || 'gray'
}

const FREQ_ORDER = { weekly: 0, biweekly: 1, semimonthly: 2, monthly: 3, annual: 4 }

function IncomeForm({ form, setForm, onSubmit, onCancel, loading, submitLabel }) {
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
        placeholder="e.g. Salary"
      />
      <Input
        label="Amount (per period, post-tax) *"
        name="amount"
        type="number"
        step="0.01"
        min="0"
        value={form.amount}
        onChange={handleChange}
        required
        placeholder="0.00"
      />
      <Select
        label="Frequency *"
        name="frequency"
        value={form.frequency}
        onChange={handleChange}
        required
      >
        {FREQUENCIES.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </Select>
      <Input
        label="Pay Day"
        name="income_day"
        type="number"
        min="1"
        max="28"
        value={form.income_day}
        onChange={handleChange}
        placeholder="1-28"
      />
      <Input
        label="Last Pay Date"
        name="last_pay_date"
        type="date"
        value={form.last_pay_date}
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

function MobileIncomeList({ income, onEdit, onDeactivate, onMarkPaid, markPaidLoading }) {
  return (
    <div className="divide-y divide-gray-100">
      {income.map(item => {
        const inactive = item.is_active === 0 || item.is_active === false
        const menuItems = [{ label: 'Edit', onClick: () => onEdit(item) }]
        if (item.last_pay_date && !inactive) {
          menuItems.push({ label: 'Mark Paid', onClick: () => onMarkPaid(item) })
        }
        if (!inactive) {
          menuItems.push({ label: 'Deactivate', onClick: () => onDeactivate(item), danger: true })
        }

        const next = nextPayday(item.last_pay_date, item.frequency)

        return (
          <div
            key={item.id}
            className={`flex items-center justify-between px-4 py-3 ${inactive ? 'opacity-50' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 truncate">{item.name}</span>
                {inactive && <Badge color="gray">Inactive</Badge>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge color={freqBadgeColor(item.frequency)}>
                  {formatFrequency(item.frequency)}
                </Badge>
                <span className="text-sm font-semibold text-green-600">
                  {formatMoney(item.amount)}
                </span>
              </div>
              {next && next !== '\u2014' && (
                <div className="text-xs text-gray-500 mt-0.5">Next: {next}</div>
              )}
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
    case 'amount': return item.amount ?? 0
    case 'frequency': return FREQ_ORDER[item.frequency] ?? 99
    case 'next_payday': return nextPayday(item.last_pay_date, item.frequency)
    case 'last_paid': return item.last_pay_date || ''
    case 'monthly_equiv': return monthlyEquiv(item.amount, item.frequency)
    default: return ''
  }
}

export default function Income() {
  const [showInactive, setShowInactive] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editIncome, setEditIncome] = useState(null)
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [addLoading, setAddLoading] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [markPaidLoading, setMarkPaidLoading] = useState(null)
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const { income, loading, refetch } = useIncome(showInactive)
  const { showToast } = useToast()

  const sorted = useMemo(() => {
    const copy = [...income]
    copy.sort((a, b) => {
      const va = getSortValue(a, sortCol)
      const vb = getSortValue(b, sortCol)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [income, sortCol, sortDir])

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
      amount: dollarsToCents(form.amount) ?? 0,
      frequency: form.frequency,
    }
    if (form.income_day !== '') payload.income_day = parseInt(form.income_day, 10)
    if (form.last_pay_date) payload.last_pay_date = form.last_pay_date
    return payload
  }

  async function handleAdd() {
    setAddLoading(true)
    try {
      const resp = await apiFetch('/api/income', {
        method: 'POST',
        body: JSON.stringify(buildPayload(addForm)),
      })
      if (resp && resp.ok) {
        showToast('Income created', 'success')
        setAddForm(EMPTY_FORM)
        setShowAddForm(false)
        refetch()
      } else {
        const err = resp ? await resp.json().catch(() => null) : null
        showToast(err?.detail || 'Failed to create income', 'error')
      }
    } catch {
      showToast('Failed to create income', 'error')
    } finally {
      setAddLoading(false)
    }
  }

  async function handleEdit() {
    if (!editIncome) return
    setEditLoading(true)
    try {
      const resp = await apiFetch(`/api/income/${editIncome.id}`, {
        method: 'PUT',
        body: JSON.stringify(buildPayload(editForm)),
      })
      if (resp && resp.ok) {
        showToast('Income updated', 'success')
        setEditIncome(null)
        refetch()
      } else {
        const err = resp ? await resp.json().catch(() => null) : null
        showToast(err?.detail || 'Failed to update income', 'error')
      }
    } catch {
      showToast('Failed to update income', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  async function handleMarkPaid(item) {
    setMarkPaidLoading(item.id)
    try {
      const resp = await apiFetch(`/api/income/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ last_pay_date: new Date().toISOString().split('T')[0] }),
      })
      if (resp && resp.ok) {
        showToast(`${item.name} marked as paid`, 'success')
        refetch()
      } else {
        showToast('Failed to mark as paid', 'error')
      }
    } catch {
      showToast('Failed to mark as paid', 'error')
    } finally {
      setMarkPaidLoading(null)
    }
  }

  async function handleDeactivate(item) {
    if (!window.confirm(`Deactivate "${item.name}"? It will be hidden from active views.`)) return
    try {
      const resp = await apiFetch(`/api/income/${item.id}/deactivate`, { method: 'POST' })
      if (resp && resp.ok) {
        showToast(`${item.name} deactivated`, 'success')
        refetch()
      } else {
        showToast('Failed to deactivate income', 'error')
      }
    } catch {
      showToast('Failed to deactivate income', 'error')
    }
  }

  function openEdit(item) {
    setEditForm({
      name: item.name || '',
      amount: centsToDollarInput(item.amount),
      frequency: item.frequency || 'monthly',
      income_day: item.income_day ?? '',
      last_pay_date: item.last_pay_date || '',
    })
    setEditIncome(item)
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
        <h1 className="text-2xl font-bold text-gray-900">Income</h1>
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
            {showAddForm ? 'Cancel' : 'Add Income'}
          </Button>
        </div>
      </div>

      {/* Add Income form */}
      {showAddForm && (
        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Income</h2>
            <IncomeForm
              form={addForm}
              setForm={setAddForm}
              onSubmit={handleAdd}
              onCancel={() => setShowAddForm(false)}
              loading={addLoading}
              submitLabel="Create Income"
            />
          </CardBody>
        </Card>
      )}

      {/* Income list/table */}
      {income.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            title="No income sources yet"
            description="Add your first income source to start tracking your earnings."
            action="Add Income"
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
            <MobileIncomeList
              income={sorted}
              onEdit={openEdit}
              onDeactivate={handleDeactivate}
              onMarkPaid={handleMarkPaid}
              markPaidLoading={markPaidLoading}
            />
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <SortableHeader label="Name" sortKey="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[18%]" />
                  <SortableHeader label="Amount" sortKey="amount" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right w-[14%]" />
                  <SortableHeader label="Frequency" sortKey="frequency" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[14%]" />
                  <SortableHeader label="Next Payday" sortKey="next_payday" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[14%]" />
                  <SortableHeader label="Last Paid" sortKey="last_paid" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[14%] hidden lg:table-cell" />
                  <SortableHeader label="Monthly Equiv" sortKey="monthly_equiv" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right w-[14%] hidden lg:table-cell" />
                  <th className="px-4 py-3 text-right font-medium text-gray-500 w-[12%]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(item => {
                  const inactive = item.is_active === 0 || item.is_active === false
                  const menuItems = [{ label: 'Edit', onClick: () => openEdit(item) }]
                  if (item.last_pay_date && !inactive) {
                    menuItems.push({ label: 'Mark Paid', onClick: () => handleMarkPaid(item) })
                  }
                  if (!inactive) {
                    menuItems.push({ label: 'Deactivate', onClick: () => handleDeactivate(item), danger: true })
                  }

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-gray-50/50 transition-colors ${inactive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 truncate">
                        {item.name}
                        {inactive && (
                          <Badge color="gray" className="ml-2">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 truncate">
                        {formatMoney(item.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={freqBadgeColor(item.frequency)}>
                          {formatFrequency(item.frequency)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-bold text-green-600 truncate">
                        {nextPayday(item.last_pay_date, item.frequency)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 truncate hidden lg:table-cell">
                        {formatDate(item.last_pay_date)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-600 truncate hidden lg:table-cell">
                        {formatMoney(monthlyEquiv(item.amount, item.frequency))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <OverflowMenu items={menuItems} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Edit Income modal */}
      <Modal
        isOpen={editIncome !== null}
        onClose={() => setEditIncome(null)}
        title="Edit Income"
        maxWidth="max-w-2xl"
      >
        <IncomeForm
          form={editForm}
          setForm={setEditForm}
          onSubmit={handleEdit}
          onCancel={() => setEditIncome(null)}
          loading={editLoading}
          submitLabel="Save Changes"
        />
      </Modal>
    </div>
  )
}

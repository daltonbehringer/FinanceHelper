import { useState, useMemo } from 'react'
import { apiFetch } from '../lib/api'
import { formatMoney, formatDate, nextDueDate } from '../lib/utils'
import { useExpenses } from '../hooks/useExpenses'
import { useToast } from '../context/ToastContext'
import Button from '../components/ui/Button'
import Card, { CardBody } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import OverflowMenu from '../components/ui/OverflowMenu'
import SortableHeader from '../components/ui/SortableHeader'

const INITIAL_FORM = {
  name: '',
  amount: '',
  category: '',
  isOneTime: false,
  due_day: '',
  due_date: '',
}

function ExpenseForm({ form, setForm, onSubmit, loading, submitLabel }) {
  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit() }}
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
    >
      <Input
        label="Name"
        value={form.name}
        onChange={e => handleChange('name', e.target.value)}
        placeholder="e.g. Netflix, Rent"
        required
      />
      <Input
        label="Amount"
        type="number"
        min="0"
        step="0.01"
        value={form.amount}
        onChange={e => handleChange('amount', e.target.value)}
        placeholder="0.00"
        required
      />
      <Input
        label="Category"
        value={form.category}
        onChange={e => handleChange('category', e.target.value)}
        placeholder="e.g. Entertainment, Housing"
      />

      <div className="flex items-end">
        <label className="flex items-center gap-2 cursor-pointer select-none pb-2">
          <div
            role="switch"
            aria-checked={form.isOneTime}
            tabIndex={0}
            onClick={() => handleChange('isOneTime', !form.isOneTime)}
            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleChange('isOneTime', !form.isOneTime) } }}
            className={`
              relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent
              transition-colors duration-200 ease-in-out cursor-pointer
              ${form.isOneTime ? 'bg-accent' : 'bg-gray-200'}
            `}
          >
            <span
              className={`
                pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
                transform transition duration-200 ease-in-out
                ${form.isOneTime ? 'translate-x-4' : 'translate-x-0'}
              `}
            />
          </div>
          <span className="text-sm font-medium text-gray-700">One-time expense</span>
        </label>
      </div>

      {form.isOneTime ? (
        <Input
          label="Due Date"
          type="date"
          value={form.due_date}
          onChange={e => handleChange('due_date', e.target.value)}
        />
      ) : (
        <Input
          label="Due Day (1-28)"
          type="number"
          min="1"
          max="28"
          value={form.due_day}
          onChange={e => handleChange('due_day', e.target.value)}
          placeholder="e.g. 15"
        />
      )}

      <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function MobileExpenseList({ expenses, onEdit, onDeactivate }) {
  return (
    <div className="divide-y divide-gray-100">
      {expenses.map(exp => {
        const inactive = exp.is_active === 0 || exp.is_active === false
        const isRecurring = exp.is_recurring === 1 || exp.is_recurring === true
        const menuItems = [{ label: 'Edit', onClick: () => onEdit(exp) }]
        if (!inactive) {
          menuItems.push({ label: 'Deactivate', onClick: () => onDeactivate(exp), danger: true })
        }

        let dueDisplay = null
        if (isRecurring && exp.due_day) {
          dueDisplay = `Due: ${nextDueDate(exp.due_day, exp.last_paid_date)}`
        } else if (!isRecurring && exp.due_date) {
          dueDisplay = `Due: ${formatDate(exp.due_date)}`
        }

        return (
          <div
            key={exp.id}
            className={`flex items-center justify-between px-4 py-3 ${inactive ? 'opacity-50' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 truncate">{exp.name}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge color={isRecurring ? 'green' : 'blue'}>
                  {isRecurring ? 'Recurring' : 'One-time'}
                </Badge>
                <span className="text-sm font-semibold text-gray-700">
                  {formatMoney(exp.amount)}
                </span>
              </div>
              {dueDisplay && (
                <div className="text-xs text-gray-500 mt-0.5">{dueDisplay}</div>
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
  const isRecurring = item.is_recurring === 1 || item.is_recurring === true
  switch (key) {
    case 'name': return (item.name || '').toLowerCase()
    case 'type': return isRecurring ? 'recurring' : 'one-time'
    case 'amount': return item.amount ?? 0
    case 'due': {
      if (isRecurring) return item.due_day ?? 9999
      return item.due_date || '\uffff'
    }
    case 'category': return (item.category || '').toLowerCase()
    default: return ''
  }
}

export default function Expenses() {
  const [showInactive, setShowInactive] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editExpense, setEditExpense] = useState(null)
  const [addForm, setAddForm] = useState(INITIAL_FORM)
  const [editForm, setEditForm] = useState(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [sortCol, setSortCol] = useState('due')
  const [sortDir, setSortDir] = useState('asc')

  const { expenses, loading, refetch } = useExpenses(showInactive)
  const { showToast } = useToast()

  const sorted = useMemo(() => {
    const copy = [...expenses]
    copy.sort((a, b) => {
      const va = getSortValue(a, sortCol)
      const vb = getSortValue(b, sortCol)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [expenses, sortCol, sortDir])

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const handleAdd = async () => {
    setSubmitting(true)
    try {
      const body = {
        name: addForm.name.trim(),
        amount: parseFloat(addForm.amount),
        category: addForm.category.trim() || null,
        is_recurring: !addForm.isOneTime,
      }
      if (addForm.isOneTime) {
        body.due_date = addForm.due_date || null
      } else {
        body.due_day = addForm.due_day ? parseInt(addForm.due_day, 10) : null
      }
      const resp = await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (resp && resp.ok) {
        showToast('Expense added', 'success')
        refetch()
        setAddForm(INITIAL_FORM)
        setShowAddForm(false)
      } else {
        showToast('Failed to add expense', 'error')
      }
    } catch {
      showToast('Failed to add expense', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const openEdit = (expense) => {
    const isOneTime = expense.is_recurring === 0 || expense.is_recurring === false
    setEditForm({
      name: expense.name,
      amount: String(expense.amount),
      category: expense.category || '',
      isOneTime,
      due_day: expense.due_day != null ? String(expense.due_day) : '',
      due_date: expense.due_date || '',
    })
    setEditExpense(expense)
  }

  const handleEdit = async () => {
    if (!editExpense) return
    setSubmitting(true)
    try {
      const body = {
        name: editForm.name.trim(),
        amount: parseFloat(editForm.amount),
        category: editForm.category.trim() || null,
        is_recurring: !editForm.isOneTime,
      }
      if (editForm.isOneTime) {
        body.due_date = editForm.due_date || null
        body.due_day = null
      } else {
        body.due_day = editForm.due_day ? parseInt(editForm.due_day, 10) : null
        body.due_date = null
      }
      const resp = await apiFetch(`/api/expenses/${editExpense.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      if (resp && resp.ok) {
        showToast('Expense updated', 'success')
        refetch()
        setEditExpense(null)
      } else {
        showToast('Failed to update expense', 'error')
      }
    } catch {
      showToast('Failed to update expense', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeactivate = async (expense) => {
    if (!window.confirm(`Deactivate "${expense.name}"?`)) return
    try {
      const resp = await apiFetch(`/api/expenses/${expense.id}/deactivate`, {
        method: 'POST',
      })
      if (resp && resp.ok) {
        showToast('Expense deactivated', 'success')
        refetch()
      } else {
        showToast('Failed to deactivate expense', 'error')
      }
    } catch {
      showToast('Failed to deactivate expense', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
            />
            <span className="text-sm text-gray-600">Show inactive</span>
          </label>
          <Button onClick={() => setShowAddForm(prev => !prev)}>
            {showAddForm ? 'Cancel' : 'Add Expense'}
          </Button>
        </div>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Expense</h2>
            <ExpenseForm
              form={addForm}
              setForm={setAddForm}
              onSubmit={handleAdd}
              loading={submitting}
              submitLabel="Add Expense"
            />
          </CardBody>
        </Card>
      )}

      {/* Table / List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : expenses.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              }
              title="No expenses yet"
              description="Add your first expense to start tracking your spending."
              action="Add Expense"
              onAction={() => setShowAddForm(true)}
            />
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Mobile compact list */}
          <div className="md:hidden">
            <div className="px-4 py-2 border-b border-gray-100">
              <select
                value={`${sortCol}:${sortDir}`}
                onChange={e => {
                  const [col, dir] = e.target.value.split(':')
                  setSortCol(col)
                  setSortDir(dir)
                }}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="due:asc">Sort: Due Date (soonest)</option>
                <option value="due:desc">Sort: Due Date (latest)</option>
                <option value="name:asc">Sort: Name (A-Z)</option>
                <option value="name:desc">Sort: Name (Z-A)</option>
                <option value="amount:desc">Sort: Amount (high-low)</option>
                <option value="amount:asc">Sort: Amount (low-high)</option>
                <option value="type:asc">Sort: Type</option>
                <option value="category:asc">Sort: Category</option>
              </select>
            </div>
            <MobileExpenseList
              expenses={sorted}
              onEdit={openEdit}
              onDeactivate={handleDeactivate}
            />
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <SortableHeader label="Name" sortKey="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[25%]" />
                  <SortableHeader label="Type" sortKey="type" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[15%]" />
                  <SortableHeader label="Amount" sortKey="amount" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right w-[15%]" />
                  <SortableHeader label="Due" sortKey="due" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[15%]" />
                  <SortableHeader label="Category" sortKey="category" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[20%] hidden lg:table-cell" />
                  <th className="text-right px-5 py-3 font-medium text-gray-500 w-[10%]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(exp => {
                  const inactive = exp.is_active === 0 || exp.is_active === false
                  const isRecurring = exp.is_recurring === 1 || exp.is_recurring === true

                  let dueDisplay = '\u2014'
                  if (isRecurring) {
                    dueDisplay = exp.due_day ? nextDueDate(exp.due_day, exp.last_paid_date) : '\u2014'
                  } else {
                    dueDisplay = exp.due_date ? formatDate(exp.due_date) : '\u2014'
                  }

                  return (
                    <tr
                      key={exp.id}
                      className={`hover:bg-gray-50 transition-colors ${inactive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-5 py-3 font-medium text-gray-900 truncate">{exp.name}</td>
                      <td className="px-5 py-3">
                        <Badge color={isRecurring ? 'green' : 'blue'}>
                          {isRecurring ? 'Recurring' : 'One-time'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700 tabular-nums truncate">
                        {formatMoney(exp.amount)}
                      </td>
                      <td className="px-5 py-3 text-gray-600 truncate">{dueDisplay}</td>
                      <td className="px-5 py-3 hidden lg:table-cell">
                        {exp.category ? (
                          <Badge color="gray">{exp.category}</Badge>
                        ) : (
                          <span className="text-gray-400">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <OverflowMenu
                          items={[
                            { label: 'Edit', onClick: () => openEdit(exp) },
                            ...(!inactive ? [{ label: 'Deactivate', onClick: () => handleDeactivate(exp), danger: true }] : []),
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

      {/* Edit Modal */}
      <Modal
        isOpen={editExpense !== null}
        onClose={() => setEditExpense(null)}
        title="Edit Expense"
      >
        <ExpenseForm
          form={editForm}
          setForm={setEditForm}
          onSubmit={handleEdit}
          loading={submitting}
          submitLabel="Save Changes"
        />
      </Modal>
    </div>
  )
}

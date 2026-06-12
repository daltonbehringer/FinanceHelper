import { useState, useMemo } from 'react'
import { apiFetch } from '../lib/api'
import { useToast } from '../context/ToastContext'

/** Shared state + handlers for the list/add/edit/deactivate CRUD pages
 *  (Accounts, Expenses, Income). The page supplies the entity hook, REST paths,
 *  form mapping, and sort comparator; this owns the rest. Deactivate routes
 *  through a ConfirmDialog (no window.confirm). */
export function useCrudPage({
  useEntities,            // (showInactive) -> { [itemsKey], loading, refetch }
  itemsKey,               // e.g. 'accounts'
  basePath,               // '/api/accounts'
  entityLabel,            // 'Account'
  emptyForm,
  buildAddPayload,        // (form) => body
  buildEditPayload,       // (form, item) => body
  mapToForm,              // (item) => form
  getSortValue,           // (item, key) => comparable
  defaultSort,            // { col, dir }
  deactivatePath = (id) => `${basePath}/${id}/deactivate`,
}) {
  const [showInactive, setShowInactive] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [addForm, setAddForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState(emptyForm)
  const [addLoading, setAddLoading] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [pendingDeactivate, setPendingDeactivate] = useState(null)
  const [sortCol, setSortCol] = useState(defaultSort.col)
  const [sortDir, setSortDir] = useState(defaultSort.dir || 'asc')

  const entity = useEntities(showInactive)
  const items = entity[itemsKey]
  const { loading, refetch } = entity
  const { showToast } = useToast()

  const sorted = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) => {
      const va = getSortValue(a, sortCol)
      const vb = getSortValue(b, sortCol)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [items, sortCol, sortDir, getSortValue])

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }
  function setSort(col, dir) { setSortCol(col); setSortDir(dir) }

  function toggleAdd() { setAddForm(emptyForm); setShowAddForm((v) => !v) }
  function startAdd() { setAddForm(emptyForm); setShowAddForm(true) }
  function openEdit(item) { setEditForm(mapToForm(item)); setEditItem(item) }
  function closeEdit() { setEditItem(null) }

  const lc = entityLabel.toLowerCase()

  async function handleAdd() {
    setAddLoading(true)
    try {
      const resp = await apiFetch(basePath, {
        method: 'POST',
        body: JSON.stringify(buildAddPayload(addForm)),
      })
      if (resp && resp.ok) {
        showToast(`${entityLabel} created`, 'success')
        setAddForm(emptyForm)
        setShowAddForm(false)
        refetch()
      } else {
        const err = resp ? await resp.json().catch(() => null) : null
        showToast(err?.detail || `Failed to create ${lc}`, 'error')
      }
    } catch {
      showToast(`Failed to create ${lc}`, 'error')
    } finally {
      setAddLoading(false)
    }
  }

  async function handleEdit() {
    if (!editItem) return
    setEditLoading(true)
    try {
      const resp = await apiFetch(`${basePath}/${editItem.id}`, {
        method: 'PUT',
        body: JSON.stringify(buildEditPayload(editForm, editItem)),
      })
      if (resp && resp.ok) {
        showToast(`${entityLabel} updated`, 'success')
        setEditItem(null)
        refetch()
      } else {
        const err = resp ? await resp.json().catch(() => null) : null
        showToast(err?.detail || `Failed to update ${lc}`, 'error')
      }
    } catch {
      showToast(`Failed to update ${lc}`, 'error')
    } finally {
      setEditLoading(false)
    }
  }

  async function confirmDeactivate() {
    const item = pendingDeactivate
    if (!item) return
    setPendingDeactivate(null)
    try {
      const resp = await apiFetch(deactivatePath(item.id), { method: 'POST' })
      if (resp && resp.ok) {
        showToast(`${item.name} deactivated`, 'success')
        refetch()
      } else {
        showToast(`Failed to deactivate ${lc}`, 'error')
      }
    } catch {
      showToast(`Failed to deactivate ${lc}`, 'error')
    }
  }

  return {
    sorted, loading, refetch, items,
    showInactive, setShowInactive,
    showAddForm, toggleAdd, startAdd,
    editItem, openEdit, closeEdit,
    addForm, setAddForm, editForm, setEditForm,
    addLoading, editLoading,
    sortCol, sortDir, handleSort, setSort,
    pendingDeactivate, requestDeactivate: setPendingDeactivate,
    confirmDeactivate, cancelDeactivate: () => setPendingDeactivate(null),
    showToast,
  }
}

import Button from '../ui/Button'
import Card, { CardBody } from '../ui/Card'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import Spinner from '../ui/Spinner'
import SortableHeader from '../ui/SortableHeader'
import OverflowMenu from '../ui/OverflowMenu'
import ConfirmDialog from '../ui/ConfirmDialog'

export function isInactive(item) {
  return item.is_active === 0 || item.is_active === false
}

const alignClass = (align) => (align === 'right' ? 'text-right' : 'text-left')
const hideClass = (hide) =>
  hide === 'lg' ? 'hidden lg:table-cell' : hide === 'xl' ? 'hidden xl:table-cell' : ''

/** The shared list/add/edit/deactivate shell for CRUD pages. `crud` is the
 *  useCrudPage return; the page supplies the form, the desktop `columns`
 *  (each with a render fn), and a `renderMobileRow`. Edit + Deactivate actions
 *  are built here; `extraActions(item)` injects page-specific ones (e.g. Mark Paid). */
export default function EntityPage({
  crud,
  title,
  addLabel,
  entityLabel,
  columns,
  mobileSortOptions,
  renderMobileRow,
  extraActions,
  FormComponent,
  addFormProps,
  editFormProps,
  formTitles,            // { add, edit }
  emptyIcon,
  emptyTitle,
  emptyDescription,
  modalMaxWidth = 'max-w-2xl',
}) {
  const {
    sorted, loading,
    showInactive, setShowInactive,
    showAddForm, toggleAdd, startAdd,
    editItem, closeEdit, openEdit,
    sortCol, sortDir, handleSort, setSort,
    pendingDeactivate, requestDeactivate, confirmDeactivate, cancelDeactivate,
  } = crud

  function buildActions(item) {
    const actions = [{ label: 'Edit', onClick: () => openEdit(item) }]
    if (!isInactive(item)) {
      if (extraActions) actions.push(...extraActions(item))
      actions.push({ label: 'Deactivate', danger: true, onClick: () => requestDeactivate(item) })
    }
    return actions
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
        <h1 className="text-2xl font-bold text-text">{title}</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-border text-accent focus:ring-accent/20"
            />
            Show inactive
          </label>
          <Button onClick={toggleAdd}>{showAddForm ? 'Cancel' : addLabel}</Button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-text mb-4">{formTitles.add}</h2>
            <FormComponent {...addFormProps} />
          </CardBody>
        </Card>
      )}

      {/* List / table */}
      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={addLabel}
            onAction={startAdd}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Mobile compact list */}
          <div className="md:hidden">
            {mobileSortOptions && (
              <div className="px-4 py-2 border-b border-border">
                <select
                  value={`${sortCol}:${sortDir}`}
                  onChange={(e) => {
                    const [col, dir] = e.target.value.split(':')
                    setSort(col, dir)
                  }}
                  className="w-full rounded-lg border border-border bg-surface-sunken px-3 py-1.5 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                >
                  {mobileSortOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="divide-y divide-border">
              {sorted.map((item) => renderMobileRow(item, buildActions(item)))}
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-border bg-surface-sunken/40">
                  {columns.map((col) =>
                    col.sortable === false ? (
                      <th
                        key={col.key}
                        className={`px-4 py-3 font-medium text-text-subtle ${alignClass(col.align)} ${col.headerClass || ''} ${hideClass(col.hide)}`}
                      >
                        {col.label}
                      </th>
                    ) : (
                      <SortableHeader
                        key={col.key}
                        label={col.label}
                        sortKey={col.key}
                        sortCol={sortCol}
                        sortDir={sortDir}
                        onSort={handleSort}
                        className={`${alignClass(col.align)} ${col.headerClass || ''} ${hideClass(col.hide)}`}
                      />
                    )
                  )}
                  <th className="px-4 py-3 text-right font-medium text-text-subtle w-[10%]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((item) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-surface-raised/40 transition-colors ${isInactive(item) ? 'opacity-50' : ''}`}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${alignClass(col.align)} ${col.cellClass || ''} ${hideClass(col.hide)}`}
                      >
                        {col.render(item)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <OverflowMenu items={buildActions(item)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Edit modal */}
      <Modal isOpen={editItem !== null} onClose={closeEdit} title={formTitles.edit} maxWidth={modalMaxWidth}>
        <FormComponent {...editFormProps} />
      </Modal>

      {/* Deactivate confirmation (replaces window.confirm) */}
      <ConfirmDialog
        isOpen={pendingDeactivate !== null}
        onClose={cancelDeactivate}
        onConfirm={confirmDeactivate}
        title={`Deactivate ${entityLabel.toLowerCase()}?`}
        message={pendingDeactivate ? `"${pendingDeactivate.name}" will be hidden from active views.` : ''}
        confirmText="Deactivate"
      />
    </div>
  )
}

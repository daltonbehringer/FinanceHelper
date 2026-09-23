import { useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import Spinner from '../ui/Spinner'
import SortableHeader from '../ui/SortableHeader'
import OverflowMenu from '../ui/OverflowMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import '../../styles/entities.css'
import { isInactive } from '../../lib/entities'


const alignClass = (align) => (align === 'right' ? 'text-right' : 'text-left')
const hideClass = (hide) =>
  hide === 'lg'
    ? 'hidden lg:table-cell'
    : hide === 'xl'
      ? 'hidden xl:table-cell'
      : ''

// Presentation only: form props, actions, sort state, and writes are still owned
// by the page and useCrudPage. Search and category filters apply to the list only.
export default function EntityPage({
  crud,
  title,
  eyebrow,
  description,
  summaries = [],
  filters = [],
  listNote,
  addLabel,
  entityLabel,
  columns,
  mobileSortOptions,
  renderMobileRow,
  extraActions,
  FormComponent,
  addFormProps,
  editFormProps,
  formTitles,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  modalMaxWidth = 'max-w-2xl',
}) {
  const Form = FormComponent
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const {
    sorted,
    loading,
    showInactive,
    setShowInactive,
    showAddForm,
    toggleAdd,
    startAdd,
    editItem,
    closeEdit,
    openEdit,
    sortCol,
    sortDir,
    handleSort,
    setSort,
    pendingDeactivate,
    requestDeactivate,
    confirmDeactivate,
    cancelDeactivate,
  } = crud
  const selectedFilter = filters.find((item) => item.key === filter)
  const visible = sorted.filter(
    (item) =>
      (!selectedFilter || selectedFilter.matches(item)) &&
      [item.name, item.type, item.category, item.frequency]
        .filter(Boolean)
        .join(' ')
        .replaceAll('_', ' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  )

  function buildActions(item) {
    const actions = [{ label: 'Edit', onClick: () => openEdit(item) }]
    if (!isInactive(item)) {
      if (extraActions) actions.push(...extraActions(item))
      actions.push({
        label: 'Deactivate',
        danger: true,
        onClick: () => requestDeactivate(item),
      })
    }
    return actions
  }

  if (loading)
    return (
      <div
        role="status"
        aria-label={`Loading ${title.toLowerCase()}`}
        className="ledger-loading"
      >
        <Spinner size="lg" />
      </div>
    )

  return (
    <div className={`ledger-page ledger-${title.toLowerCase()}`}>
      <header className="ledger-header">
        <div>
          <p className="ledger-kicker">{eyebrow}</p>
          <h1>{title}.</h1>
          <p className="ledger-description">{description}</p>
        </div>
        <Button className="ledger-add-button" onClick={toggleAdd}>
          <span aria-hidden="true">{showAddForm ? '−' : '+'}</span>
          {showAddForm ? 'Cancel' : addLabel}
        </Button>
      </header>

      <section className="ledger-summaries" aria-label={`${title} summary`}>
        {summaries.map((summary, index) => (
          <div
            key={summary.label}
            className={`ledger-summary ${index === 0 ? 'ledger-summary-featured' : ''}`}
          >
            <p className="ledger-kicker">{summary.label}</p>
            <p className="ledger-summary-value">{summary.value}</p>
            <p className="ledger-summary-detail">{summary.detail}</p>
          </div>
        ))}
      </section>

      {showAddForm && (
        <section className="ledger-form-panel" aria-label={formTitles.add}>
          <div className="ledger-form-heading">
            <span className="ledger-kicker">A NEW ENTRY</span>
            <h2>{formTitles.add}</h2>
          </div>
          <Form {...addFormProps} />
        </section>
      )}

      <section className="ledger-list" aria-label={`${title} list`}>
        <div className="ledger-list-heading">
          <div>
            <p className="ledger-kicker">THE DETAILS</p>
            <h2>Your {title.toLowerCase()}</h2>
          </div>
          <span className="ledger-count">
            {sorted.length} {sorted.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <div className="ledger-toolbar">
          <div
            className="ledger-filters"
            role="group"
            aria-label={`Filter ${title.toLowerCase()}`}
          >
            <button
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All {title.toLowerCase()} <span>{sorted.length}</span>
            </button>
            {filters.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                {item.label} <span>{sorted.filter(item.matches).length}</span>
              </button>
            ))}
          </div>
          <label className="ledger-search">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="search"
              aria-label={`Search ${title.toLowerCase()}`}
              placeholder={`Search ${title.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="ledger-list-options">
          <span>
            {visible.length} of {sorted.length} shown
          </span>
          <label>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={addLabel}
            onAction={startAdd}
          />
        ) : visible.length === 0 ? (
          <div className="ledger-no-results">
            <h3>No matching {title.toLowerCase()}.</h3>
            <p>Try another name or show all entries.</p>
            <Button
              variant="outline"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <>
            <div className="ledger-mobile md:hidden">
              {mobileSortOptions && (
                <div className="ledger-mobile-sort">
                  <label>
                    <span className="sr-only">Sort {title.toLowerCase()}</span>
                    <select
                      value={`${sortCol}:${sortDir}`}
                      onChange={(e) => {
                        const [col, dir] = e.target.value.split(':')
                        setSort(col, dir)
                      }}
                    >
                      {mobileSortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <div className="ledger-mobile-list">
                {visible.map((item) =>
                  renderMobileRow(item, buildActions(item))
                )}
              </div>
            </div>
            <div className="ledger-table-wrap hidden md:block">
              <table className="w-full text-sm table-fixed">
                <caption className="sr-only">
                  {title}. Use column headings to sort and row actions to edit
                  or record activity.
                </caption>
                <thead>
                  <tr>
                    {columns.map((col) =>
                      col.sortable === false ? (
                        <th
                          scope="col"
                          key={col.key}
                          className={`${alignClass(col.align)} ${col.headerClass || ''} ${hideClass(col.hide)}`}
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
                    <th scope="col" className="ledger-actions-heading">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr
                      key={item.id}
                      className={isInactive(item) ? 'ledger-inactive' : ''}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`${alignClass(col.align)} ${col.cellClass || ''} ${hideClass(col.hide)}`}
                        >
                          {col.key === 'name' ? (
                            <div className="ledger-identity">
                              <span
                                className="ledger-monogram"
                                aria-hidden="true"
                              >
                                {item.name?.trim().slice(0, 1).toUpperCase() ||
                                  '·'}
                              </span>
                              <div title={item.name}>{col.render(item)}</div>
                            </div>
                          ) : (
                            col.render(item)
                          )}
                        </td>
                      ))}
                      <td className="text-right">
                        <OverflowMenu
                          items={buildActions(item)}
                          label={`Actions for ${item.name}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <footer className="ledger-list-footer">
          <span>{listNote}</span>
          <span>Summary totals use active entries.</span>
        </footer>
      </section>

      <Modal
        isOpen={editItem !== null}
        onClose={closeEdit}
        title={formTitles.edit}
        maxWidth={modalMaxWidth}
      >
        <Form {...editFormProps} />
      </Modal>
      <ConfirmDialog
        isOpen={pendingDeactivate !== null}
        onClose={cancelDeactivate}
        onConfirm={confirmDeactivate}
        title={`Deactivate ${entityLabel.toLowerCase()}?`}
        message={
          pendingDeactivate
            ? `"${pendingDeactivate.name}" will be hidden from active views.`
            : ''
        }
        confirmText="Deactivate"
      />
    </div>
  )
}

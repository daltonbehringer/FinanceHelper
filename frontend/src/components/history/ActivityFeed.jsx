import { useMemo, useState } from 'react'
import { formatMoney, formatDateTime, timeAgo } from '../../lib/utils'
import {
  groupEvents, primaryEvent, actionLabel, entityName, groupTime, isLlm,
  changeRows, prettyField,
} from '../../lib/eventDisplay'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import EmptyState from '../ui/EmptyState'

function AmountTag({ delta }) {
  if (delta == null) return null
  const credit = delta > 0
  return (
    <span className={`tnum font-semibold text-sm ${credit ? 'text-credit' : 'text-debit'}`}>
      {credit ? '+' : '−'}{formatMoney(Math.abs(delta))}
    </span>
  )
}

function ChangeList({ changes }) {
  const rows = changeRows(changes)
  if (!rows.length) return null
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-text-subtle">{prettyField(r.field)}</dt>
          <dd className="text-text-muted tnum">
            {'next' in r
              ? <><span className="text-text-subtle line-through">{r.old}</span>
                  <span className="mx-1.5 text-text-subtle">→</span>
                  <span className="text-text">{r.next}</span></>
              : r.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function FeedRow({ group }) {
  const [open, setOpen] = useState(false)
  const primary = primaryEvent(group)
  const time = groupTime(group)
  const llm = isLlm(group)
  const multi = group.events.length > 1

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-surface-raised/50 transition-colors"
      >
        <svg
          className={`w-4 h-4 flex-shrink-0 text-text-subtle transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text truncate">{entityName(primary)}</span>
            {llm && <Badge color="purple" size="sm">AI</Badge>}
            {multi && <span className="text-2xs text-text-subtle">· {group.events.length} changes</span>}
          </div>
          <div className="text-xs text-text-muted mt-0.5">{actionLabel(primary)}</div>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <AmountTag delta={primary.amount_delta} />
          <span className="text-2xs text-text-subtle" title={formatDateTime(time)}>{timeAgo(time)}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-3 pl-11 space-y-3 animate-in">
          {group.events.map(ev => (
            <div key={ev.id} className="rounded-lg bg-surface-sunken border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-text">
                  {actionLabel(ev)} <span className="text-text-muted">· {entityName(ev)}</span>
                </span>
                <AmountTag delta={ev.amount_delta} />
              </div>
              <ChangeList changes={ev.changes} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ActivityFeed({
  events, loading, loadingMore, hasMore, onLoadMore, showAll, onToggleShowAll,
}) {
  const groups = useMemo(() => groupEvents(events), [events])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Activity</h2>
        <button
          onClick={onToggleShowAll}
          className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors ${
            showAll
              ? 'border-accent text-accent bg-accent-soft'
              : 'border-border text-text-muted hover:text-text'
          }`}
        >
          {showAll ? 'Showing all activity' : 'Show all activity'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" className="text-accent" /></div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Payments, balance updates, and edits will show up here."
        />
      ) : (
        <>
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            {groups.map(g => <FeedRow key={g.key} group={g} />)}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-4">
              <Button variant="outline" size="sm" loading={loadingMore} onClick={onLoadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useId, useMemo, useState } from 'react'
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
  const detailId = useId()
  const primary = primaryEvent(group)
  const time = groupTime(group)
  const llm = isLlm(group)
  const multi = group.events.length > 1

  return (
    <div className="activity-row">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={() => setOpen(o => !o)}
        className="activity-row-button"
      >
        <svg aria-hidden="true"
          className={`w-4 h-4 flex-shrink-0 text-text-subtle transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
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
        <div id={detailId} className="activity-row-details space-y-3">
          <p className="journal-caption">{formatDateTime(time)}</p>
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
    <section id="activity" className="journal-panel activity-panel" aria-label="Activity">
      <div className="journal-section-heading activity-heading">
        <div><p className="journal-kicker">THE RECORD</p><h2>Activity</h2></div>
        <button
          type="button"
          aria-pressed={showAll}
          onClick={onToggleShowAll}
          className="activity-toggle"
        >
          {showAll ? 'Showing all activity' : 'Show all activity'}
        </button>
      </div>

      <p className="activity-intro">{showAll ? 'All recorded changes, including field edits.' : 'Payments, balance changes, and added or removed entries.'} Select an entry for details.</p>

      {loading ? (
        <div role="status" aria-label="Loading activity" className="flex justify-center py-12"><Spinner size="lg" className="text-accent" /></div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Payments, balance updates, and edits will show up here."
        />
      ) : (
        <>
          <div className="activity-rows">
            {groups.map(g => <FeedRow key={g.key} group={g} />)}
          </div>
          {hasMore && (
            <div className="activity-load-more">
              <Button variant="outline" size="sm" loading={loadingMore} onClick={onLoadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

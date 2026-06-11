import { useState, useMemo } from 'react'
import { formatMoney } from '../lib/utils'
import { useNetWorth } from '../hooks/useNetWorth'
import { useEvents } from '../hooks/useEvents'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'
import NetWorthChart from '../components/history/NetWorthChart'
import CompositionChart from '../components/history/CompositionChart'
import ActivityFeed from '../components/history/ActivityFeed'

function Stat({ label, value, color = 'text-text' }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-text-subtle">{label}</p>
      <p className={`text-lg sm:text-xl font-bold tnum ${color}`}>{value}</p>
    </div>
  )
}

export default function History() {
  const [showAll, setShowAll] = useState(false)
  const { series, loading: nwLoading } = useNetWorth()
  const { events, loading: evLoading, loadingMore, hasMore, loadMore } = useEvents({ all: showAll })

  const summary = useMemo(() => {
    if (!series.length) return null
    const latest = series[series.length - 1]
    const prev = series.length > 1 ? series[series.length - 2] : null
    const change = prev ? latest.net - prev.net : null
    return { ...latest, change }
  }, [series])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">History</h1>
        <p className="text-sm text-text-muted mt-1">
          Net worth over time and a full log of every balance change.
        </p>
      </div>

      {/* Hero: net worth */}
      <Card>
        <CardBody>
          {nwLoading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" className="text-accent" /></div>
          ) : series.length === 0 ? (
            <div className="py-16 text-center text-sm text-text-muted">
              Add an account to start tracking your net worth.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-text-subtle">Net worth</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold tnum text-text">{formatMoney(summary.net)}</p>
                    {summary.change != null && summary.change !== 0 && (
                      <span className={`text-sm font-semibold tnum ${summary.change > 0 ? 'text-credit' : 'text-debit'}`}>
                        {summary.change > 0 ? '+' : '−'}{formatMoney(Math.abs(summary.change))}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-6">
                  <Stat label="Assets" value={formatMoney(summary.assets)} color="text-credit" />
                  <Stat label="Debts" value={formatMoney(summary.debts)} color="text-debit" />
                </div>
              </div>
              <NetWorthChart series={series} />
            </>
          )}
        </CardBody>
      </Card>

      {/* Secondary: composition */}
      {!nwLoading && series.length > 1 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Assets vs. Debts</h2>
          </CardHeader>
          <CardBody>
            <CompositionChart series={series} />
          </CardBody>
        </Card>
      )}

      {/* Activity feed */}
      <ActivityFeed
        events={events}
        loading={evLoading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        showAll={showAll}
        onToggleShowAll={() => setShowAll(s => !s)}
      />
    </div>
  )
}

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney, formatDate } from '../lib/utils'
import { useNetWorth } from '../hooks/useNetWorth'
import { useEvents } from '../hooks/useEvents'
import Spinner from '../components/ui/Spinner'
import NetWorthChart from '../components/history/NetWorthChart'
import CompositionChart from '../components/history/CompositionChart'
import ActivityFeed from '../components/history/ActivityFeed'
import '../styles/journal.css'

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
    <div className="journal-page history-page">
      <header className="journal-header journal-header-row">
        <div>
          <p className="journal-kicker">THE BIGGER PICTURE</p>
          <h1>History.</h1>
          <p className="journal-description">Follow your balances over time, and the decisions that shaped them.</p>
        </div>
        <a className="journal-link" href="#activity">View activity <span aria-hidden="true">↓</span></a>
      </header>

      {nwLoading ? (
        <div className="journal-panel journal-loading" role="status" aria-label="Loading net worth">
          <Spinner size="lg" />
        </div>
      ) : !summary ? (
        <section className="journal-panel journal-empty">
          <p className="journal-kicker">YOUR STORY STARTS HERE</p>
          <h2>A picture that grows with you.</h2>
          <p>Add an account to start tracking your net worth.</p>
          <Link className="journal-link" to="/accounts">Go to accounts <span aria-hidden="true">↗</span></Link>
        </section>
      ) : (
        <section className="history-overview" aria-label="Net worth history">
          <div className="history-snapshot">
            <p className="journal-kicker">LATEST NET WORTH</p>
            <p className="history-net">{formatMoney(summary.net)}</p>
            <p className="history-asof">As of {formatDate(summary.date)}</p>
            <div className="history-change">
              <strong>{summary.change == null ? 'First recorded day' : `${summary.change > 0 ? '+' : summary.change < 0 ? '−' : ''}${formatMoney(Math.abs(summary.change))}`}</strong>
              <span>{summary.change == null ? 'Your starting point for the days ahead.' : 'Since the previous recorded day'}</span>
            </div>
            <dl className="history-balances">
              <div><dt>Total assets</dt><dd>{formatMoney(summary.assets)}</dd></div>
              <div><dt>Total debt</dt><dd>{formatMoney(summary.debts)}</dd></div>
            </dl>
            <p className="history-snapshot-note">Assets minus debt, based on your recorded balances.</p>
          </div>
          <div className="journal-panel history-trend">
            <div className="journal-section-heading">
              <div><p className="journal-kicker">OVER TIME</p><h2>Your financial trajectory</h2></div>
            </div>
            <NetWorthChart series={series} />
            <p className="journal-caption">Choose a balance and date range, or drag the slider to explore.</p>
          </div>
        </section>
      )}

      <div className={`history-details ${!nwLoading && series.length > 1 ? 'history-details-with-chart' : ''}`}>
        <ActivityFeed
          events={events}
          loading={evLoading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          showAll={showAll}
          onToggleShowAll={() => setShowAll(s => !s)}
        />
        {!nwLoading && series.length > 1 && (
          <section className="journal-panel history-composition" aria-label="Assets and debts over time">
            <div className="journal-section-heading">
              <div><p className="journal-kicker">BOTH SIDES OF THE BALANCE</p><h2>Assets &amp; debts</h2></div>
            </div>
            <CompositionChart series={series} />
            <p className="journal-caption">The makeup of your recorded balances over time. Select a legend item to show or hide it.</p>
          </section>
        )}
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { formatMoney, formatDate, isDebt } from '../lib/utils'
import { useAccounts } from '../hooks/useAccounts'
import { useSnapshots } from '../hooks/useSnapshots'
import Card, { CardBody } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'

const RANGES = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 91 },
  { key: '6m', label: '6M', days: 182 },
  { key: '1y', label: '1Y', days: 365 },
  { key: '5y', label: '5Y', days: 1826 },
]

// Consistent color palette for chart lines
const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
  '#e11d48', '#84cc16', '#a855f7', '#0ea5e9', '#d946ef',
]

function getDateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-gray-500 mb-1">{formatDate(label)}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-700">{entry.name}</span>
          <span className="font-semibold text-gray-900 ml-auto pl-3">
            {formatMoney(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function History() {
  const [range, setRange] = useState('1y')
  const [filter, setFilter] = useState('all') // 'all' | 'assets' | 'debts' | account id

  const { accounts, loading: accountsLoading } = useAccounts()
  const { snapshots, loading: snapshotsLoading } = useSnapshots()
  const loading = accountsLoading || snapshotsLoading

  // Determine which accounts are visible based on filter
  const visibleAccounts = useMemo(() => {
    if (filter === 'all') return accounts
    if (filter === 'assets') return accounts.filter((a) => !isDebt(a.type))
    if (filter === 'debts') return accounts.filter((a) => isDebt(a.type))
    // Individual account id
    const id = Number(filter)
    return accounts.filter((a) => a.id === id)
  }, [accounts, filter])

  const visibleIds = useMemo(() => new Set(visibleAccounts.map((a) => a.id)), [visibleAccounts])

  // Build chart data: one data point per date with a key per visible account
  const chartData = useMemo(() => {
    if (!snapshots.length || !visibleAccounts.length) return []

    const selectedRange = RANGES.find((r) => r.key === range)
    const startDate = getDateNDaysAgo(selectedRange.days)
    const today = new Date().toISOString().split('T')[0]

    // Build a map: accountId -> sorted [{date, balance}]
    const byAccount = {}
    for (const snap of snapshots) {
      if (!visibleIds.has(snap.account_id)) continue
      const date = snap.recorded_at.split('T')[0] // handle both date-only and datetime
      if (!byAccount[snap.account_id]) byAccount[snap.account_id] = {}
      // Keep the latest balance per date per account (snapshots are newest-first,
      // so the first one we see for a date is the latest)
      if (!byAccount[snap.account_id][date]) {
        byAccount[snap.account_id][date] = snap.balance
      }
    }

    // Collect all unique dates within range, plus start boundary and today
    const dateSet = new Set()
    dateSet.add(startDate)
    dateSet.add(today)
    for (const accountDates of Object.values(byAccount)) {
      for (const d of Object.keys(accountDates)) {
        if (d >= startDate && d <= today) dateSet.add(d)
      }
    }
    const allDates = [...dateSet].sort()

    // For each account, find the last known balance before startDate (carry-forward seed)
    const lastKnown = {}
    for (const acct of visibleAccounts) {
      // Snapshots are newest-first; find the latest one on or before startDate
      const snapsForAcct = snapshots.filter((s) => s.account_id === acct.id)
      let seed = acct.balance // fallback to accounts.balance
      for (const s of snapsForAcct) {
        const d = s.recorded_at.split('T')[0]
        if (d <= startDate) {
          seed = s.balance
          break // newest-first, so first match <= startDate is the latest before range
        }
      }
      lastKnown[acct.id] = seed
    }

    // Build data points with carry-forward
    const data = []
    const current = { ...lastKnown }
    for (const date of allDates) {
      const point = { date }
      for (const acct of visibleAccounts) {
        if (byAccount[acct.id]?.[date] != null) {
          current[acct.id] = byAccount[acct.id][date]
        }
        point[acct.name] = current[acct.id] ?? null
      }
      data.push(point)
    }

    return data
  }, [snapshots, visibleAccounts, visibleIds, range])

  // Assign colors to visible accounts (stable order by account id)
  const accountColors = useMemo(() => {
    const map = {}
    const sorted = [...accounts].sort((a, b) => a.id - b.id)
    sorted.forEach((a, i) => {
      map[a.name] = COLORS[i % COLORS.length]
    })
    return map
  }, [accounts])

  const hasData = chartData.length > 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Balance History</h1>
        <p className="text-sm text-gray-500 mt-1">
          Track your account balances over time.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Time range buttons */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    range === r.key
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Account filter */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none sm:ml-auto"
            >
              <option value="all">All Accounts</option>
              <option value="assets">Assets</option>
              <option value="debts">Debts</option>
              <optgroup label="Individual">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Chart */}
          <Card>
            <CardBody className="p-4 sm:p-6">
              {!hasData ? (
                <EmptyState
                  title="No balance data"
                  description="Update your account balances to see them charted over time."
                />
              ) : (
                <div className="h-80 sm:h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                        tickFormatter={(d) => {
                          const [, m, day] = d.split('-')
                          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                          return `${months[Number(m) - 1]} ${Number(day)}`
                        }}
                        interval="preserveStartEnd"
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                        tickFormatter={(v) =>
                          v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                        }
                        width={55}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      {visibleAccounts.map((acct) => (
                        <Line
                          key={acct.id}
                          type="stepAfter"
                          dataKey={acct.name}
                          stroke={accountColors[acct.name]}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Legend */}
          {hasData && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1">
              {visibleAccounts.map((acct) => (
                <div key={acct.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span
                    className="inline-block w-3 h-0.5 rounded-full"
                    style={{ backgroundColor: accountColors[acct.name] }}
                  />
                  {acct.name}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

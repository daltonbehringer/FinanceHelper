import { useState, useMemo } from 'react'
import { formatMoney, formatDate } from '../lib/utils'
import { useAccounts } from '../hooks/useAccounts'
import { useSnapshots } from '../hooks/useSnapshots'
import Card, { CardBody } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import SortableHeader from '../components/ui/SortableHeader'

function classifySnapshot(snap) {
  const note = (snap.note || '').toLowerCase()
  // Source-account deduction for a debt/expense payment
  if (note.startsWith('payment of') || note.startsWith('paid ')) {
    return { type: 'payment', label: 'Payment' }
  }
  // Direct debt payment (has payment_made on the target account)
  if (snap.payment_made && snap.payment_made > 0) {
    return { type: 'payment', label: 'Payment' }
  }
  // Balance went up — treat as income / deposit
  return { type: 'credit', label: 'Credit' }
}

function extractPaidFrom(snap, accountMap) {
  const note = snap.note || ''
  // Source-side snapshot: "Payment of $X to AccountName" — the current account IS the source
  if (note.toLowerCase().startsWith('payment of')) {
    return null // this row IS the source account entry
  }
  // Target-side: look for a matching source snapshot on the same date
  // We'll resolve this in the parent by pairing snapshots
  return null
}

function buildLogEntries(snapshots, accountMap) {
  // Group snapshots by recorded_at to pair target + source entries
  const byDate = {}
  for (const snap of snapshots) {
    const date = snap.recorded_at.split('T')[0]
    if (!byDate[date]) byDate[date] = []
    byDate[date].push(snap)
  }

  const entries = []
  const usedIds = new Set()

  for (const dateSnaps of Object.values(byDate)) {
    // Find source-side snapshots (note starts with "Payment of")
    const sourceSnaps = dateSnaps.filter(s => (s.note || '').toLowerCase().startsWith('payment of'))
    const sourceAccountIds = new Set(sourceSnaps.map(s => s.account_id))

    // Mark source snapshots so we can pair them
    const sourceByTarget = {}
    for (const s of sourceSnaps) {
      // Try to match "Payment of $X to TargetName"
      const match = (s.note || '').match(/to\s+(.+)$/i)
      if (match) {
        const targetName = match[1].trim()
        sourceByTarget[targetName] = s
      }
    }

    for (const snap of dateSnaps) {
      if (usedIds.has(snap.id)) continue
      const note = (snap.note || '').toLowerCase()

      // Skip source-side entries — they'll be merged into the target row
      if (note.startsWith('payment of')) {
        usedIds.add(snap.id)
        // Only show standalone if there's no matching target entry
        const acctName = accountMap[snap.account_id] || `Account #${snap.account_id}`
        const targetMatch = (snap.note || '').match(/to\s+(.+)$/i)
        const targetName = targetMatch ? targetMatch[1].trim() : null
        // Check if a target-side snap exists for this date
        const hasTarget = targetName && dateSnaps.some(
          ds => ds.id !== snap.id && (accountMap[ds.account_id] || '').toLowerCase() === targetName.toLowerCase()
        )
        if (!hasTarget) {
          entries.push({
            id: snap.id,
            date: snap.recorded_at.split('T')[0],
            target: targetName || 'Unknown',
            amount: snap.payment_made ?? Math.abs(snap.balance),
            type: 'payment',
            paidFrom: acctName,
            note: snap.note,
          })
        }
        continue
      }

      // Expense payment snapshots (note starts with "Paid ")
      if (note.startsWith('paid ')) {
        usedIds.add(snap.id)
        const acctName = accountMap[snap.account_id] || `Account #${snap.account_id}`
        const expenseName = (snap.note || '').replace(/^Paid\s+/i, '')
        entries.push({
          id: snap.id,
          date: snap.recorded_at.split('T')[0],
          target: expenseName,
          amount: snap.payment_made ?? 0,
          type: 'payment',
          paidFrom: acctName,
          note: snap.note,
        })
        continue
      }

      usedIds.add(snap.id)
      const acctName = accountMap[snap.account_id] || `Account #${snap.account_id}`
      const { type } = classifySnapshot(snap)

      // Find paired source snapshot
      let paidFrom = '\u2014'
      if (type === 'payment' && snap.payment_made) {
        const paired = sourceByTarget[acctName]
        if (paired) {
          paidFrom = accountMap[paired.account_id] || `Account #${paired.account_id}`
          usedIds.add(paired.id)
        }
      }

      entries.push({
        id: snap.id,
        date: snap.recorded_at.split('T')[0],
        target: acctName,
        amount: snap.payment_made ?? Math.abs(snap.balance),
        type,
        paidFrom,
        note: snap.note,
      })
    }
  }

  // Sort newest first
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  return entries
}

function MobileLogList({ entries }) {
  return (
    <div className="divide-y divide-gray-100">
      {entries.map(entry => (
        <div key={entry.id} className="px-4 py-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-900 truncate">{entry.target}</span>
            <span className="font-semibold text-gray-900 tabular-nums">
              {formatMoney(entry.amount)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{formatDate(entry.date)}</span>
            <Badge color={entry.type === 'payment' ? 'red' : 'green'} size="sm">
              {entry.type === 'payment' ? 'Payment' : 'Credit'}
            </Badge>
          </div>
          {entry.paidFrom !== '\u2014' && (
            <div className="text-xs text-gray-500">
              Paid from: <span className="text-gray-700">{entry.paidFrom}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function getSortValue(entry, key) {
  switch (key) {
    case 'date': return entry.date
    case 'target': return entry.target.toLowerCase()
    case 'amount': return entry.amount ?? 0
    case 'type': return entry.type
    case 'paidFrom': return (entry.paidFrom || '').toLowerCase()
    default: return ''
  }
}

export default function History() {
  const [filter, setFilter] = useState('all')
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  const { accounts, loading: accountsLoading } = useAccounts()
  const { snapshots, loading: snapshotsLoading } = useSnapshots()
  const loading = accountsLoading || snapshotsLoading

  const accountMap = useMemo(() => {
    const map = {}
    for (const a of accounts) map[a.id] = a.name
    return map
  }, [accounts])

  const entries = useMemo(
    () => buildLogEntries(snapshots, accountMap),
    [snapshots, accountMap]
  )

  const filtered = useMemo(() => {
    if (filter === 'all') return entries
    if (filter === 'payments') return entries.filter(e => e.type === 'payment')
    if (filter === 'credits') return entries.filter(e => e.type === 'credit')
    return entries
  }, [entries, filter])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      const va = getSortValue(a, sortCol)
      const vb = getSortValue(b, sortCol)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      // Secondary sort by id desc for stability
      return b.id - a.id
    })
    return copy
  }, [filtered, sortCol, sortDir])

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir(col === 'date' ? 'desc' : 'asc')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payment History</h1>
        <p className="text-sm text-gray-500 mt-1">
          Log of all payments and balance changes.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No history yet"
              description="Payments and balance updates will appear here."
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Filter */}
          <div className="flex justify-end">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="all">All</option>
              <option value="payments">Payments Only</option>
              <option value="credits">Credits Only</option>
            </select>
          </div>

          <Card className="overflow-hidden">
            {/* Mobile list */}
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
                  <option value="date:desc">Sort: Date (newest)</option>
                  <option value="date:asc">Sort: Date (oldest)</option>
                  <option value="target:asc">Sort: Account/Expense (A-Z)</option>
                  <option value="amount:desc">Sort: Amount (high-low)</option>
                  <option value="amount:asc">Sort: Amount (low-high)</option>
                  <option value="type:asc">Sort: Type</option>
                </select>
              </div>
              <MobileLogList entries={sorted} />
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <SortableHeader label="Date" sortKey="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[15%]" />
                    <SortableHeader label="Account / Expense" sortKey="target" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[25%]" />
                    <SortableHeader label="Amount" sortKey="amount" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right w-[15%]" />
                    <SortableHeader label="Type" sortKey="type" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[15%]" />
                    <SortableHeader label="Paid From" sortKey="paidFrom" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-left w-[20%]" />
                    <th className="text-left px-5 py-3 font-medium text-gray-500 w-[10%]">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-600 tabular-nums">{formatDate(entry.date)}</td>
                      <td className="px-5 py-3 font-medium text-gray-900 truncate">{entry.target}</td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900 tabular-nums">
                        {formatMoney(entry.amount)}
                      </td>
                      <td className="px-5 py-3">
                        <Badge color={entry.type === 'payment' ? 'red' : 'green'}>
                          {entry.type === 'payment' ? 'Payment' : 'Credit'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-gray-600 truncate">{entry.paidFrom}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs truncate" title={entry.note}>
                        {entry.note || '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

import { useState, useMemo } from 'react'
import { apiFetch } from '../lib/api'
import { formatMoney, formatDateTime } from '../lib/utils'
import { useAccounts } from '../hooks/useAccounts'
import { useSnapshots } from '../hooks/useSnapshots'
import { useToast } from '../context/ToastContext'
import { Select } from '../components/ui/Input'
import Button from '../components/ui/Button'
import Card, { CardBody } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import ConfirmDialog from '../components/ui/ConfirmDialog'

const MAX_VERSIONS = 10

export default function History() {
  const [selectedAccountId, setSelectedAccountId] = useState(null)
  const [confirmRestore, setConfirmRestore] = useState(null)
  const [restoring, setRestoring] = useState(false)

  const { accounts } = useAccounts()
  const { snapshots, loading, refetch } = useSnapshots(selectedAccountId)
  const { showToast } = useToast()

  // Group snapshots by account and assign version numbers (oldest = v1)
  // Then take only the last MAX_VERSIONS per account
  const versionedSnapshots = useMemo(() => {
    // Group by account_id
    const byAccount = {}
    for (const snap of snapshots) {
      if (!byAccount[snap.account_id]) byAccount[snap.account_id] = []
      byAccount[snap.account_id].push(snap)
    }

    // Snapshots come newest-first from API. Reverse to assign versions oldest=v1.
    const result = []
    for (const accountId of Object.keys(byAccount)) {
      const accountSnaps = byAccount[accountId]
      const reversed = [...accountSnaps].reverse() // oldest first
      const total = reversed.length
      // Take only last MAX_VERSIONS (most recent)
      const startIdx = Math.max(0, total - MAX_VERSIONS)
      for (let i = startIdx; i < total; i++) {
        result.push({
          ...reversed[i],
          version: i + 1,
          isLatest: i === total - 1,
        })
      }
    }

    // Sort by recorded_at descending (newest first) for display
    result.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
    return result
  }, [snapshots])

  function handleFilterChange(e) {
    const val = e.target.value
    setSelectedAccountId(val === '' ? null : Number(val))
  }

  async function handleRestore() {
    if (!confirmRestore) return
    setRestoring(true)
    try {
      const resp = await apiFetch(`/api/snapshots/${confirmRestore}/restore`, {
        method: 'POST',
      })
      if (resp && resp.ok) {
        showToast('Rolled back successfully', 'success')
        refetch()
      } else {
        const data = resp ? await resp.json().catch(() => null) : null
        showToast(data?.detail || 'Failed to rollback', 'error')
      }
    } catch {
      showToast('Failed to rollback', 'error')
    } finally {
      setRestoring(false)
      setConfirmRestore(null)
    }
  }

  const restoreSnap = confirmRestore
    ? versionedSnapshots.find((s) => s.id === confirmRestore)
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Version History</h1>
          <p className="text-sm text-gray-500 mt-1">
            Last {MAX_VERSIONS} updates per account
          </p>
        </div>
        <Select
          label="Filter by account"
          className="sm:w-64"
          value={selectedAccountId ?? ''}
          onChange={handleFilterChange}
        >
          <option value="">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : versionedSnapshots.length === 0 ? (
        <Card>
          <EmptyState
            title="No history yet"
            description="Version history will appear here as you update your accounts."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {versionedSnapshots.map((snap) => (
            <Card
              key={snap.id}
              className={`transition-colors ${
                snap.isLatest
                  ? 'ring-2 ring-accent/30 bg-accent/[0.02]'
                  : 'hover:bg-gray-50/50'
              }`}
            >
              <CardBody className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: version info */}
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Version + account + badge */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-xs font-bold text-gray-700 tabular-nums">
                        v{snap.version}
                      </span>
                      <span className="font-semibold text-gray-900 text-sm">
                        {snap.account_name}
                      </span>
                      {snap.isLatest && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-green-100 text-[10px] font-semibold text-green-700 uppercase tracking-wide">
                          Current
                        </span>
                      )}
                    </div>

                    {/* Timestamp */}
                    <p className="text-xs text-gray-400">
                      {formatDateTime(snap.recorded_at)}
                    </p>

                    {/* Balance + payment details */}
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-700">
                        Balance: <span className="font-semibold">{formatMoney(snap.balance)}</span>
                      </span>
                      {snap.payment_made != null && snap.payment_made !== 0 && (
                        <span className="text-gray-500">
                          Payment: <span className="font-medium">{formatMoney(snap.payment_made)}</span>
                        </span>
                      )}
                    </div>

                    {/* Note */}
                    {snap.note && (
                      <p className="text-xs text-gray-500 italic">
                        &ldquo;{snap.note}&rdquo;
                      </p>
                    )}
                  </div>

                  {/* Right: rollback button */}
                  <div className="flex-shrink-0">
                    {snap.isLatest ? (
                      <span className="text-xs text-gray-400 hidden sm:block">Latest</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmRestore(snap.id)}
                      >
                        <span className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                          </svg>
                          Rollback
                        </span>
                      </Button>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmRestore !== null}
        onClose={() => setConfirmRestore(null)}
        onConfirm={handleRestore}
        title="Rollback to previous version"
        message={
          restoreSnap
            ? `Roll back "${restoreSnap.account_name}" to v${restoreSnap.version} (${formatMoney(restoreSnap.balance)})? All newer versions for this account will be removed.`
            : 'Roll back to this version? All newer versions will be removed.'
        }
        confirmText={restoring ? 'Rolling back...' : 'Rollback'}
        variant="danger"
      />
    </div>
  )
}

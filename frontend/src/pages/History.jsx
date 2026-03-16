import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatMoney, formatDate } from '../lib/utils'
import { useAccounts } from '../hooks/useAccounts'
import { useSnapshots } from '../hooks/useSnapshots'
import { useToast } from '../context/ToastContext'
import { Select } from '../components/ui/Input'
import Button from '../components/ui/Button'
import Card, { CardBody } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export default function History() {
  const [selectedAccountId, setSelectedAccountId] = useState(null)
  const [confirmRestore, setConfirmRestore] = useState(null)
  const [restoring, setRestoring] = useState(false)

  const { accounts } = useAccounts()
  const { snapshots, loading, refetch } = useSnapshots(selectedAccountId)
  const { showToast } = useToast()

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
        showToast('Balance restored successfully', 'success')
        refetch()
      } else {
        const data = resp ? await resp.json().catch(() => null) : null
        showToast(data?.detail || 'Failed to restore snapshot', 'error')
      }
    } catch {
      showToast('Failed to restore snapshot', 'error')
    } finally {
      setRestoring(false)
      setConfirmRestore(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Balance History</h1>
        <Select
          label="Filter by account"
          className="sm:w-64"
          value={selectedAccountId ?? ''}
          onChange={handleFilterChange}
        >
          <option value="">All Accounts</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </div>

      <Card>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" className="text-accent" />
            </div>
          ) : snapshots.length === 0 ? (
            <EmptyState
              title="No snapshots yet"
              description="Balance snapshots will appear here as you update your accounts."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Account</th>
                    <th className="px-5 py-3 text-right">Balance</th>
                    <th className="px-5 py-3 text-right">Payment</th>
                    <th className="px-5 py-3">Note</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {snapshots.map(snap => (
                    <tr key={snap.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap text-gray-700">
                        {formatDate(snap.recorded_at)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap font-medium text-gray-900">
                        {snap.account_name}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-right text-gray-700">
                        {formatMoney(snap.balance)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-right text-gray-700">
                        {snap.payment_made ? formatMoney(snap.payment_made) : '\u2014'}
                      </td>
                      <td className="px-5 py-3 text-gray-500 max-w-xs truncate">
                        {snap.note || '\u2014'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmRestore(snap.id)}
                        >
                          Restore
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        isOpen={confirmRestore !== null}
        onClose={() => setConfirmRestore(null)}
        onConfirm={handleRestore}
        title="Restore balance"
        message="Undo to this point? All newer snapshots for this account will be removed."
        confirmText={restoring ? 'Restoring...' : 'Restore'}
        variant="danger"
      />
    </div>
  )
}

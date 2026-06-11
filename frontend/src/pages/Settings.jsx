import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { dollarsToCents, centsToDollarInput } from '../lib/utils'
import { useSettings } from '../hooks/useSettings'
import { useAccounts } from '../hooks/useAccounts'
import { useToast } from '../context/ToastContext'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'

export default function Settings() {
  const { settings, loading, refetch } = useSettings()
  const { accounts, loading: accountsLoading } = useAccounts()
  const { showToast } = useToast()
  const [minChecking, setMinChecking] = useState('')
  const [defaultPaymentAccountId, setDefaultPaymentAccountId] = useState('')
  const [saving, setSaving] = useState(false)

  const checkingAccounts = accounts.filter(a => a.type === 'checking')

  useEffect(() => {
    if (!loading) {
      setMinChecking(settings.min_checking ? centsToDollarInput(settings.min_checking) : '')
      setDefaultPaymentAccountId(
        settings.default_payment_account_id ? String(settings.default_payment_account_id) : ''
      )
    }
  }, [loading, settings.min_checking, settings.default_payment_account_id])

  async function handleSave(e) {
    e.preventDefault()
    const value = dollarsToCents(minChecking) ?? 0
    if (value < 0) {
      showToast('Minimum balance cannot be negative', 'error')
      return
    }
    const paymentId = defaultPaymentAccountId ? Number(defaultPaymentAccountId) : 0
    setSaving(true)
    try {
      const resp = await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ min_checking: value, default_payment_account_id: paymentId }),
      })
      if (resp && resp.ok) {
        showToast('Settings saved', 'success')
        refetch()
      } else {
        showToast('Failed to save settings', 'error')
      }
    } catch {
      showToast('Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || accountsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" className="text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure how the AI advisor manages your finances.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-gray-900">Default Payment Account</h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-gray-600 mb-4">
              Select the checking account you typically pay bills from. When you report a payment
              (e.g. "made minimum payment on Amex"), the advisor will automatically deduct
              the payment from this account too.
              {checkingAccounts.length === 1 && (
                <span className="block mt-2 text-blue-600 font-medium">
                  Auto-detected: you have one checking account, so it's set as the default.
                </span>
              )}
            </p>
            {checkingAccounts.length === 0 ? (
              <p className="text-sm text-amber-600">
                No checking accounts found. Add a checking account first.
              </p>
            ) : (
              <select
                value={defaultPaymentAccountId}
                onChange={(e) => setDefaultPaymentAccountId(e.target.value)}
                className="w-full sm:max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="">None (ask every time)</option>
                {checkingAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-gray-900">Checking Account Floor</h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-gray-600 mb-4">
              Set the minimum balance you want to keep in your checking account at all times.
              The AI advisor will treat this as a floor and never recommend payments that would
              drop your checking balance below this amount. This reserve covers essentials like
              groceries, gas, and unexpected expenses.
            </p>
            <Input
              label="Minimum Checking Balance"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 1500"
              value={minChecking}
              onChange={(e) => setMinChecking(e.target.value)}
              className="flex-1 sm:max-w-xs"
            />
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </div>
  )
}

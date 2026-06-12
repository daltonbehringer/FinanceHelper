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
import BudgetEditor from '../components/settings/BudgetEditor'

export default function Settings() {
  const { settings, loading, refetch } = useSettings()
  const { accounts, loading: accountsLoading } = useAccounts()
  const { showToast } = useToast()
  const [minChecking, setMinChecking] = useState('')
  const [defaultPaymentAccountId, setDefaultPaymentAccountId] = useState('')
  const [advicePosture, setAdvicePosture] = useState('default')
  const [zipCode, setZipCode] = useState('')
  const [householdSize, setHouseholdSize] = useState('')
  const [saving, setSaving] = useState(false)

  const checkingAccounts = accounts.filter(a => a.type === 'checking')

  useEffect(() => {
    if (!loading) {
      setMinChecking(settings.min_checking ? centsToDollarInput(settings.min_checking) : '')
      setDefaultPaymentAccountId(
        settings.default_payment_account_id ? String(settings.default_payment_account_id) : ''
      )
      setAdvicePosture(settings.advice_posture || 'default')
      setZipCode(settings.zip_code || '')
      setHouseholdSize(settings.household_size != null ? String(settings.household_size) : '')
    }
  }, [loading, settings.min_checking, settings.default_payment_account_id, settings.advice_posture, settings.zip_code, settings.household_size])

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
        body: JSON.stringify({
          min_checking: value,
          default_payment_account_id: paymentId,
          advice_posture: advicePosture,
          zip_code: zipCode.trim(),
          household_size: householdSize ? Number(householdSize) : null,
        }),
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
        <Spinner size="lg" className="text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text">Settings</h1>
        <p className="text-sm text-text-muted mt-1">
          Configure how the AI advisor manages your finances.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Advice Posture</h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-text-muted mb-4">
              Tune how the advisor weighs paying down debt versus keeping a cushion and
              investing. <span className="font-medium">Default</span> lets the advisor pick the
              posture that best fits your situation.
            </p>
            <select
              value={advicePosture}
              onChange={(e) => setAdvicePosture(e.target.value)}
              className="w-full sm:max-w-xs rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent outline-none"
            >
              <option value="default">Default (let the advisor decide)</option>
              <option value="aggressive_payoff">Aggressive payoff</option>
              <option value="balanced">Balanced</option>
              <option value="conservative">Conservative</option>
              <option value="wealth_building">Wealth-building</option>
            </select>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Default Payment Account</h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-text-muted mb-4">
              Select the checking account you typically pay bills from. When you report a payment
              (e.g. "made minimum payment on Amex"), the advisor will automatically deduct
              the payment from this account too.
              {checkingAccounts.length === 1 && (
                <span className="block mt-2 text-accent font-medium">
                  Auto-detected: you have one checking account, so it's set as the default.
                </span>
              )}
            </p>
            {checkingAccounts.length === 0 ? (
              <p className="text-sm text-warning">
                No checking accounts found. Add a checking account first.
              </p>
            ) : (
              <select
                value={defaultPaymentAccountId}
                onChange={(e) => setDefaultPaymentAccountId(e.target.value)}
                className="w-full sm:max-w-xs rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent outline-none"
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
            <h2 className="text-base font-semibold text-text">Monthly Spending Money</h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-text-muted mb-4">
              How much you keep available each month for everyday variable expenses — groceries,
              gas, transportation, and the like. The advisor reserves this for you: it won't
              recommend debt or savings that dip into it, and it plans so your "safe to spend"
              (balance minus upcoming bills) stays at or above this amount.
            </p>
            <Input
              label="Monthly spending money"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 1200"
              value={minChecking}
              onChange={(e) => setMinChecking(e.target.value)}
              className="flex-1 sm:max-w-xs"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Cost of Living &amp; Budget</h2>
          </CardHeader>
          <CardBody className="space-y-5">
            <p className="text-sm text-text-muted">
              Your ZIP code and household size let the advisor seed metro-level monthly spending
              estimates. These are starting points — adjust them to your situation. Together with
              your income and recurring bills they produce your <span className="font-medium">monthly
              spending money</span>.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:max-w-xs">
              <Input
                label="ZIP code"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                placeholder="e.g. 94110"
                inputMode="numeric"
              />
              <Input
                label="Household size"
                type="number"
                min="1"
                value={householdSize}
                onChange={(e) => setHouseholdSize(e.target.value)}
                placeholder="e.g. 2"
              />
            </div>
            <BudgetEditor zip={zipCode.trim()} householdSize={householdSize} showToast={showToast} />
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

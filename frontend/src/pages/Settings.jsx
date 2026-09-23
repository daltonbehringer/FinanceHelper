import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { moneyInputCents, centsToDollarInput, formatMoney } from '../lib/utils'
import { useSettings } from '../hooks/useSettings'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useAccounts } from '../hooks/useAccounts'
import { useToast } from '../context/ToastContext'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Input, { Select } from '../components/ui/Input'
import MoneyInput from '../components/ui/MoneyInput'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import BudgetEditor from '../components/settings/BudgetEditor'

export default function Settings() {
  const { settings, loading, refetch } = useSettings()
  const { accounts, loading: accountsLoading } = useAccounts()
  const { lines: budgetLines, loading: budgetLoading, refetch: refetchBudgetLines } = useBudgetLines()
  const { showToast } = useToast()
  const [minChecking, setMinChecking] = useState('')
  const [cashCushion, setCashCushion] = useState('')
  const [largePaymentThreshold, setLargePaymentThreshold] = useState('')
  const [defaultPaymentAccountId, setDefaultPaymentAccountId] = useState('')
  const [advicePosture, setAdvicePosture] = useState('default')
  const [zipCode, setZipCode] = useState('')
  const [householdSize, setHouseholdSize] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const checkingAccounts = accounts.filter(a => a.type === 'checking')
  const monthlyTotal = budgetLines.length > 0
    ? budgetLines.reduce((sum, line) => sum + line.amount, 0)
    : moneyInputCents(minChecking)
  const hasSavedEstimate = settings.living_budget_configured || settings.min_checking > 0

  useEffect(() => {
    if (!loading) {
      setCashCushion(centsToDollarInput(settings.cash_cushion ?? 0))
      setLargePaymentThreshold(centsToDollarInput(settings.large_payment_threshold ?? 0))
      setMinChecking(settings.living_budget_configured || settings.min_checking > 0 ? centsToDollarInput(settings.min_checking ?? 0) : '')
      setDefaultPaymentAccountId(
        settings.default_payment_account_id ? String(settings.default_payment_account_id) : ''
      )
      setAdvicePosture(settings.advice_posture || 'default')
      setZipCode(settings.zip_code || '')
      setHouseholdSize(settings.household_size != null ? String(settings.household_size) : '')
    }
  }, [loading, settings.min_checking, settings.default_payment_account_id, settings.advice_posture, settings.zip_code, settings.household_size, settings.cash_cushion, settings.living_budget_configured, settings.large_payment_threshold])

  async function handleSave(e) {
    e.preventDefault()
    setSaveError('')
    const value = moneyInputCents(minChecking) ?? 0
    const cushion = moneyInputCents(cashCushion) ?? 0
    const threshold = moneyInputCents(largePaymentThreshold) ?? 0
    if (value < 0 || cushion < 0 || threshold < 0) {
      setSaveError('Budget, cushion, and payment threshold cannot be negative')
      return
    }
    const paymentId = defaultPaymentAccountId ? Number(defaultPaymentAccountId) : 0
    setSaving(true)
    try {
      const resp = await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          ...(budgetLines.length === 0 && minChecking !== '' ? { min_checking: value } : {}),
          cash_cushion: cushion,
          large_payment_threshold: threshold,
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
        const error = await resp?.json().catch(() => null)
        setSaveError(typeof error?.detail === 'string' ? error.detail : 'Failed to save settings')
      }
    } catch {
      setSaveError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading || accountsLoading || (budgetLoading && budgetLines.length === 0)) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" className="text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text text-balance">Settings</h1>
        <p className="text-sm text-text-muted mt-1 text-pretty">
          Set your living costs, cash reserves, and advisor preferences.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text text-balance">Living costs</h2>
          </CardHeader>
          <CardBody className="space-y-5">
            <p className="text-sm text-text-muted text-pretty">
              Plan for groceries, gas, utilities, and other everyday costs. This monthly budget
              feeds both safe to spend (prorated until payday) and projected monthly surplus.
              Exclude payments already tracked in Expenses or Accounts.
            </p>
            <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 space-y-1">
              <div className="flex flex-wrap justify-between gap-2 font-medium text-text">
                <span>Monthly living-cost total</span>
                <output aria-label="Monthly living-cost total" className="tabular-nums">{formatMoney(monthlyTotal)}</output>
              </div>
              <p className="text-sm text-text-muted text-pretty">
                {budgetLines.length > 0
                  ? 'Using your saved categories below. They replace the single monthly estimate.'
                  : 'Using your single monthly estimate. Save Settings to apply changes.'}
              </p>
            </div>
            {budgetLines.length === 0 ? (
              <MoneyInput
                label="Monthly living-cost estimate"
                required
                value={minChecking}
                onValueChange={setMinChecking}
                className="sm:max-w-xs"
                aria-describedby="living-estimate-help"
              />
            ) : (
              <p className="text-sm text-text-muted text-pretty">
                {hasSavedEstimate
                  ? `Your saved single estimate of ${formatMoney(settings.min_checking)} is inactive. Removing every category restores it.`
                  : 'If you remove every category, enter a single monthly estimate instead.'}
              </p>
            )}
            {budgetLines.length === 0 && (
              <p id="living-estimate-help" className="text-sm text-text-muted text-pretty">
                Enter one total, or add categories below to replace it. Set $0.00 if no living-cost reserve is needed.
              </p>
            )}
            <div className="border-t border-border pt-5 space-y-4">
              <h3 className="text-sm font-semibold text-text text-balance">Monthly categories (optional)</h3>
              <BudgetEditor lines={budgetLines} refetch={refetchBudgetLines} zip={zipCode.trim()} householdSize={householdSize} showToast={showToast}>
                <div className="border-t border-border pt-5 space-y-3">
                  <h3 className="text-sm font-semibold text-text text-balance">Local estimates (optional)</h3>
                  <p className="text-sm text-text-muted text-pretty">
                    Enter your ZIP code and household size to fill in suggested categories.
                    Review the amounts before relying on them. Categories you have edited
                    are kept when you estimate again.
                  </p>
                  <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
                    <Input label="ZIP code" value={zipCode} onChange={(e) => setZipCode(e.target.value)}
                      placeholder="e.g. 94110" inputMode="numeric" autoComplete="postal-code" />
                    <Input label="Household size" type="number" min="1" step="1" value={householdSize}
                      onChange={(e) => setHouseholdSize(e.target.value)} placeholder="Defaults to 1" />
                  </div>
                </div>
              </BudgetEditor>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text text-balance">Cash reserves</h2>
          </CardHeader>
          <CardBody className="space-y-5">
            <div>
              <MoneyInput label="Minimum cash cushion" value={cashCushion} onValueChange={setCashCushion}
                className="sm:max-w-xs" aria-describedby="cash-cushion-help" />
              <p id="cash-cushion-help" className="mt-2 text-sm text-text-muted text-pretty">
                A fixed amount to leave untouched after bills and living costs. It is not prorated.
                Set $0.00 to use a zero-dollar floor.
              </p>
            </div>
            <div>
              <MoneyInput label="Large payment threshold" value={largePaymentThreshold} onValueChange={setLargePaymentThreshold}
                className="sm:max-w-xs" aria-describedby="large-payment-help" />
              <p id="large-payment-help" className="mt-2 text-sm text-text-muted text-pretty">
                Set $0.00 to turn early holds off. Payments strictly above this amount reserve half
                one pay period early, then the full unpaid amount in the due period.
                For $1,500.00 rent, that means $750.00 first, then $1,500.00 total until paid.
                These reserves reduce safe to spend; they do not move money or change monthly surplus.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text text-balance">Payment account</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <p id="payment-account-help" className="text-sm text-text-muted text-pretty">
              Safe to spend uses the checking account selected here. It is also suggested as the
              funding account when you record a payment. With no default, safe to spend combines
              all active checking balances and you choose an account for each payment.
            </p>
            {checkingAccounts.length === 0 ? (
              <p className="text-sm text-warning">Add a checking account in Accounts to calculate safe to spend.</p>
            ) : (
              <Select label="Default payment account" value={defaultPaymentAccountId}
                onChange={(e) => setDefaultPaymentAccountId(e.target.value)} aria-describedby="payment-account-help">
                <option value="">No default — choose for each payment</option>
                {checkingAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text text-balance">Advisor preferences</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <Select label="Advice style" value={advicePosture} onChange={(e) => setAdvicePosture(e.target.value)}
              aria-describedby="advice-style-help">
              <option value="default">Let the advisor decide</option>
              <option value="aggressive_payoff">Prioritize debt payoff</option>
              <option value="balanced">Balance debt payoff and saving</option>
              <option value="conservative">Prioritize a cash buffer</option>
              <option value="wealth_building">Prioritize wealth building</option>
            </Select>
            <p id="advice-style-help" className="text-sm text-text-muted text-pretty">
              Guides the advisor's recommendations. Your living-cost budget, cash cushion, and
              safe-to-spend calculation stay the same regardless of advice style.
            </p>
          </CardBody>
        </Card>

        {saveError && <p role="alert" className="text-sm text-debit">{saveError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted">Categories save automatically. Save all other settings here.</p>
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
        </div>
      </form>
    </div>
  )
}

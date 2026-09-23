import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useSettingsData } from '../hooks/useSettingsData'
import { moneyInputCents, centsToDollarInput, formatMoney } from '../lib/utils'
import { Select } from '../components/ui/Input'
import Input from '../components/ui/Input'
import MoneyInput from '../components/ui/MoneyInput'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import BudgetEditor from '../components/settings/BudgetEditor'
import SettingsSection from '../components/settings/SettingsSection'
import '../styles/journal.css'
import '../styles/settings.css'

const PRIORITIES = [
  { value: 'default', title: 'Let the advisor decide', detail: 'The advisor chooses a priority based on your current financial picture and explains its choice when relevant.' },
  { value: 'aggressive_payoff', title: 'Prioritize debt payoff', detail: 'Direct available surplus to the highest-interest debt first, while preserving living costs and your cash cushion.' },
  { value: 'balanced', title: 'Balance debt payoff and saving', detail: 'Pay down debt while aiming to save roughly 20% of monthly income over time, only within available free cash. This is guidance, not a reserved amount.' },
  { value: 'conservative', title: 'Prioritize a cash buffer', detail: 'Build emergency savings before making aggressive extra debt payments. This preference does not increase your configured cash cushion automatically.' },
  { value: 'wealth_building', title: 'Prioritize wealth building', detail: 'Favor retirement and tax-advantaged saving while addressing high-interest debt. This does not establish a personal investment risk profile.' },
]
const cashForm = (s) => ({ cash_cushion: centsToDollarInput(s.cash_cushion ?? 0), large_payment_threshold: centsToDollarInput(s.large_payment_threshold ?? 0), default_payment_account_id: s.default_payment_account_id ? String(s.default_payment_account_id) : '' })
const locationForm = (s) => ({ zip_code: s.zip_code || '', household_size: s.household_size == null ? '' : String(s.household_size) })
const priorityForm = (s) => ({ advice_posture: s.advice_posture || 'default' })

export default function Settings() {
  const { data, setData, loading, error, retry } = useSettingsData()
  const [dirtySections, setDirtySections] = useState({})
  const dirty = Object.values(dirtySections).some(Boolean)
  const markDirty = useCallback((id, value) => setDirtySections((prev) => prev[id] === value ? prev : ({ ...prev, [id]: value })), [])
  const markLivingDirty = useCallback((value) => markDirty('living-costs', value), [markDirty])
  useEffect(() => {
    if (!dirty) return
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function savePreferences(payload) {
    const response = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(payload) })
    if (!response?.ok) {
      const body = await response?.json().catch(() => null)
      throw new Error(typeof body?.detail === 'string' ? body.detail : 'Could not save this section. Your changes are still here; try again.')
    }
    const saved = await response.json()
    // Merge only this section; other sections may contain independent drafts.
    const patch = Object.fromEntries(Object.keys(payload).map((key) => [key, saved[key]]))
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }))
    return saved
  }

  const settings = data?.settings || {}
  const checking = data?.accounts.filter((a) => a.type === 'checking' && a.is_active !== 0 && a.is_active !== false) || []
  const configured = settings.living_budget_configured || settings.min_checking > 0
  const monthly = data?.lines.length ? data.lines.reduce((sum, line) => sum + line.amount, 0) : configured ? settings.min_checking : null
  const priority = PRIORITIES.find((p) => p.value === (settings.advice_posture || 'default'))

  return (
    <div className="journal-page settings-page">
      <header className="journal-header"><p className="journal-kicker">MAKE IT YOURS</p><h1>Settings.</h1><p className="journal-description">A plan that fits your everyday life. Set your spending boundaries and what matters to your advisor.</p></header>
      {loading ? <div className="journal-panel journal-loading" role="status" aria-label="Loading settings"><Spinner size="lg" /></div>
        : error ? <section className="journal-panel settings-load-error"><h2>Your settings couldn’t be loaded.</h2><p role="alert">{error}</p><Button onClick={retry}>Retry loading settings</Button></section>
        : data && <div className="settings-layout">
          <div className="settings-main">
            <SettingsSection id="cash-planning" number="01" title="Cash planning" description="Choose the cash behind your plan and the reserves you want to protect." initial={cashForm(settings)} onDirty={markDirty} onSave={async (draft) => {
              const cushion = moneyInputCents(draft.cash_cushion)
              const threshold = moneyInputCents(draft.large_payment_threshold)
              if (cushion === null || threshold === null) throw new Error('Enter valid dollar amounts for the cushion and threshold, including zero when off.')
              return cashForm(await savePreferences({ cash_cushion: cushion, large_payment_threshold: threshold, default_payment_account_id: draft.default_payment_account_id ? Number(draft.default_payment_account_id) : 0 }))
            }}>
              {(draft, update) => <>
                <Select label="Default payment account" value={draft.default_payment_account_id} onChange={(e) => update('default_payment_account_id', e.target.value)} aria-describedby="payment-help">
                  <option value="">No default — combine active checking accounts</option>
                  {settings.default_payment_account_id && !checking.some((a) => a.id === settings.default_payment_account_id) && <option value={settings.default_payment_account_id} disabled>Previously selected account is unavailable</option>}
                  {checking.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
                <p id="payment-help" className="settings-help">Safe to spend uses this account; payment forms suggest it as the funding source. With no default, the plan combines active checking balances and you choose a source for each payment.</p>
                {!checking.length && <p className="settings-notice">Add an active checking account in <Link to="/accounts">Accounts</Link> to calculate safe to spend.</p>}
                <div className="settings-field-grid">
                  <div><MoneyInput label="Minimum cash cushion" required value={draft.cash_cushion} onValueChange={(v) => update('cash_cushion', v)} aria-describedby="cushion-help" /><p id="cushion-help" className="settings-help">Leave this fixed amount untouched after bills and living costs. It is not prorated. $0.00 sets a zero-dollar floor.</p></div>
                  <div><MoneyInput label="Large payment threshold" required value={draft.large_payment_threshold} onValueChange={(v) => update('large_payment_threshold', v)} aria-describedby="holds-help" /><p id="holds-help" className="settings-help">{moneyInputCents(draft.large_payment_threshold) === 0 ? 'Off. ' : ''}Payments strictly above this amount are held at half their amount one pay period early, then in full during the due period. Set $0.00 to turn off.</p></div>
                </div>
                <div className="settings-example"><span className="journal-kicker">HOW EARLY HOLDS WORK</span><p>With a $1,000 threshold, $1,500 rent holds $750 one pay period early, then $1,500 total until paid. Holds reduce safe to spend; they do not transfer money.</p></div>
              </>}
            </SettingsSection>

            <BudgetEditor lines={data.lines} settings={settings} onDirty={markLivingDirty} onSaved={(result) => setData((prev) => ({ ...prev, lines: result.lines, settings: { ...prev.settings, ...result.settings } }))} />

            <SettingsSection id="local-estimates" number="03" title="Local estimates" description="Optional household details for generating living-cost suggestions. Save these details before requesting a preview above." initial={locationForm(settings)} onDirty={markDirty} onSave={async (draft) => {
              const zip = draft.zip_code.trim()
              const size = draft.household_size === '' ? null : Number(draft.household_size)
              if (zip && !/^[0-9]{5}(-[0-9]{4})?$/.test(zip)) throw new Error('Enter a valid US ZIP code (12345 or 12345-6789).')
              if (size !== null && (!Number.isSafeInteger(size) || size < 1)) throw new Error('Household size must be a whole number of at least 1 within the supported range.')
              return locationForm(await savePreferences({ zip_code: zip, household_size: size }))
            }}>
              {(draft, update) => <><div className="settings-field-grid"><Input label="ZIP code" value={draft.zip_code} onChange={(e) => update('zip_code', e.target.value)} pattern="[0-9]{5}(-[0-9]{4})?" inputMode="numeric" autoComplete="postal-code" placeholder="e.g. 94110" /><Input label="Household size" type="number" min="1" step="1" value={draft.household_size} onChange={(e) => update('household_size', e.target.value)} placeholder="Defaults to 1" /></div><p className="settings-help">Estimates use your area and household size, with one person assumed if blank. They are AI suggestions, not verified local prices. Review them for overlap with bills you already track.</p></>}
            </SettingsSection>

            <SettingsSection id="advisor-priority" number="04" title="Advisor priority" description="Tell your advisor how to prioritize available money." initial={priorityForm(settings)} onDirty={markDirty} onSave={async (draft) => priorityForm(await savePreferences(draft))}>
              {(draft, update) => <><Select label="Financial priority" value={draft.advice_posture} onChange={(e) => update('advice_posture', e.target.value)} aria-describedby="priority-description">{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.title}</option>)}</Select><p id="priority-description" className="settings-priority-description">{PRIORITIES.find((p) => p.value === draft.advice_posture)?.detail}</p><p className="settings-help">This guides recommendations. Every priority respects the same computed free cash. It does not change your budget, cushion, or safe-to-spend calculation.</p></>}
            </SettingsSection>
          </div>
          <aside className="settings-sidebar" aria-label="Saved cash-plan rules">
            <div className="settings-rule-card"><p className="journal-kicker">YOUR CASH-PLAN RULES</p><h2>Room for<br />everyday life.</h2><p className="settings-rule-label">Saved monthly living costs</p><output aria-label="Saved monthly living costs" className="settings-rule-total">{monthly === null ? 'Not set' : formatMoney(monthly)}</output><p className="settings-rule-source">{data.lines.length ? `${data.lines.length} saved categories` : configured ? 'Single monthly estimate' : 'Set a total or add categories'}</p><dl><div><dt>Cash cushion</dt><dd>{formatMoney(settings.cash_cushion || 0)}</dd></div><div><dt>Early holds</dt><dd>{settings.large_payment_threshold ? `Above ${formatMoney(settings.large_payment_threshold)}` : 'Off'}</dd></div><div><dt>Checking cash</dt><dd>{settings.default_payment_account_id ? checking.find((a) => a.id === settings.default_payment_account_id)?.name || 'Review selection' : 'All active checking'}</dd></div></dl><p>Living costs are prorated until payday. Your cushion stays fixed.</p></div>
            <div className="settings-side-note"><p className="journal-kicker">SAVED ADVISOR PRIORITY</p><h3>{priority?.title}</h3><p>Your advisor works within the cash available after your obligations and reserves.</p></div>
            <p className="settings-draft-note" role="status">{dirty ? 'You have unsaved changes. Save each edited section to apply them.' : 'All shown rules reflect your saved settings.'}</p>
          </aside>
        </div>}
    </div>
  )
}

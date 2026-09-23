import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { centsToDollarInput, moneyInputCents, formatType, formatMoney } from '../../lib/utils'
import Button from '../ui/Button'
import Input from '../ui/Input'
import MoneyInput from '../ui/MoneyInput'

const categoryKey = (name) => name.trim().toLowerCase().replaceAll('_', ' ')
const toDraft = (lines) => lines.map((line) => ({ ...line, key: `saved-${line.id}`, amount: centsToDollarInput(line.amount) }))
const normalized = (rows) => rows.map((r) => ({ id: r.id ?? null, category: r.category.trim(), amount: moneyInputCents(r.amount) }))

export default function BudgetEditor({ lines, settings, onSaved, onDirty }) {
  const configured = settings.living_budget_configured || settings.min_checking > 0
  const initialEstimate = configured ? centsToDollarInput(settings.min_checking) : ''
  const [rows, setRows] = useState(() => toDraft(lines))
  const [estimate, setEstimate] = useState(initialEstimate)
  const [newCategory, setNewCategory] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [version, setVersion] = useState(0)
  const sequence = useRef(0)
  const nextKey = () => `new-${sequence.current++}`
  const dirty = JSON.stringify(normalized(rows)) !== JSON.stringify(normalized(toDraft(lines)))
    || (!rows.length && moneyInputCents(estimate) !== moneyInputCents(initialEstimate))
    || Boolean(newCategory || newAmount)
  const total = rows.length ? rows.reduce((sum, line) => sum + (moneyInputCents(line.amount) ?? 0), 0) : moneyInputCents(estimate)
  const validTotal = rows.every((row) => moneyInputCents(row.amount) !== null) && total !== null
  const zip = settings.zip_code || ''
  const household = settings.household_size ?? 1
  const currentPreview = preview && preview.zip === zip && preview.household === household
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])

  function changeRow(key, patch) {
    setRows((prev) => prev.map((row) => row.key === key ? { ...row, ...patch, origin: 'user' } : row))
    setStatus('')
  }
  function addLine() {
    if (!newCategory.trim() || moneyInputCents(newAmount) === null) {
      setError('Enter a category and a valid monthly dollar amount before adding it.'); return
    }
    if (rows.some((r) => categoryKey(r.category) === categoryKey(newCategory))) {
      setError('Use a unique name for each category.'); return
    }
    setRows([...rows, { key: nextKey(), category: newCategory.trim(), amount: newAmount, origin: 'user' }])
    setNewCategory(''); setNewAmount(''); setError(''); setStatus('')
  }
  function discard() {
    setRows(toDraft(lines)); setEstimate(initialEstimate); setNewCategory(''); setNewAmount('')
    setPreview(null); setError(''); setStatus(''); setVersion((value) => value + 1)
  }
  async function save(event) {
    event.preventDefault()
    setError(''); setStatus('')
    if (newCategory || newAmount) { setError('Add the new category to your draft, or clear its fields before saving.'); return }
    const payload = normalized(rows)
    if (payload.some((r) => !r.category || r.amount === null) || (!rows.length && moneyInputCents(estimate) === null)) {
      setError('Enter a name and valid monthly amount for each category, or a valid single estimate.'); return
    }
    if (new Set(payload.map((r) => categoryKey(r.category))).size !== payload.length) { setError('Use a unique name for each category.'); return }
    setBusy(true)
    try {
      const response = await apiFetch('/api/budget/plan', {
        method: 'PUT', body: JSON.stringify({ lines: payload, base_lines: lines, ...(!rows.length ? { min_checking: moneyInputCents(estimate) } : {}) }),
      })
      const result = await response?.json().catch(() => null)
      if (!response?.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'Could not save living costs. Your draft is still here; try again.')
      onSaved(result)
      setRows(toDraft(result.lines))
      if (result.settings.living_budget_configured || result.settings.min_checking > 0) setEstimate(centsToDollarInput(result.settings.min_checking))
      setPreview(null); setStatus('Living costs saved')
    } catch (err) { setError(err.message || 'Could not save living costs. Try again.') }
    finally { setBusy(false) }
  }
  async function generate() {
    if (!zip) { setError('Save a ZIP code in Local estimates before requesting a preview.'); return }
    setError(''); setPreview(null); setEstimating(true)
    try {
      const response = await apiFetch('/api/budget/estimate', { method: 'POST', body: JSON.stringify({ zip_code: zip, household_size: household }) })
      const result = await response?.json().catch(() => null)
      if (!response?.ok || !Array.isArray(result)) throw new Error(typeof result?.detail === 'string' ? result.detail : 'Could not generate an estimate. Your saved budget has not changed.')
      setPreview({ lines: result, zip, household })
      setSelected(result.filter((suggestion) => !rows.some((row) => categoryKey(row.category) === categoryKey(suggestion.category) && row.origin === 'user')).map((s) => s.category))
    } catch (err) { setError(err.message || 'Could not generate an estimate. Try again.') }
    finally { setEstimating(false) }
  }
  function usePreview() {
    if (!currentPreview) return
    const next = [...rows]
    for (const suggestion of preview.lines.filter((s) => selected.includes(s.category))) {
      const index = next.findIndex((r) => categoryKey(r.category) === categoryKey(suggestion.category))
      if (index >= 0 && next[index].origin === 'user') continue
      const line = { category: suggestion.category, amount: centsToDollarInput(suggestion.amount), origin: 'user' }
      if (index >= 0) next[index] = { ...next[index], ...line }
      else next.push({ ...line, key: nextKey() })
    }
    setRows(next); setPreview(null); setStatus('Selected estimates added to your draft. Save living costs to apply them.')
  }

  return (
    <section id="living-costs" className="journal-panel settings-section" aria-label="Living costs">
      <div className="settings-section-heading"><span className="settings-number" aria-hidden="true">02</span><div><p className="journal-kicker">THE EVERYDAY ESSENTIALS</p><h2>Living costs</h2></div></div>
      <p className="settings-description">Plan for groceries, gas, and other everyday costs. These monthly amounts are prorated until payday. Exclude bills already tracked in Expenses or Accounts.</p>
      <form onSubmit={save}>
        <fieldset key={version} disabled={busy || estimating} className="settings-fields">
          <div className="settings-budget-total"><div><span>{dirty ? 'Draft monthly total' : 'Monthly living-cost total'}</span><output aria-label="Monthly living-cost total">{validTotal ? formatMoney(total) : 'Enter valid amounts'}</output></div><p>{dirty ? 'Your saved plan stays unchanged until you save this section.' : rows.length ? 'Categories replace the single monthly estimate.' : 'Using one monthly estimate.'}</p></div>
          {!rows.length ? <MoneyInput label="Monthly living-cost estimate" required value={estimate} onValueChange={(value) => { setEstimate(value); setStatus('') }} aria-describedby="estimate-help" /> : <p className="settings-help">{configured ? `Your saved single estimate of ${formatMoney(settings.min_checking)} is inactive. Removing all categories restores it in the draft.` : 'If you remove all categories, enter a single monthly estimate before saving.'}</p>}
          <p id="estimate-help" className="settings-help">Use a single total or replace it with categories. $0.00 explicitly means no living-cost reserve.</p>
          <div className="settings-subheading"><h3>Monthly categories</h3><span>Optional</span></div>
          {rows.map((row) => <div key={row.key} className="settings-budget-row">
            <Input label="Category" aria-label={`Budget category: ${row.category}`} required value={row.category} onChange={(e) => changeRow(row.key, { category: e.target.value })} />
            <MoneyInput label="Monthly amount" aria-label={`Monthly amount for ${row.category}`} required value={row.amount} onValueChange={(value) => changeRow(row.key, { amount: value })} />
            <Button type="button" variant="ghost" aria-label={`Remove ${formatType(row.category)}`} onClick={() => { setRows(rows.filter((r) => r.key !== row.key)); setStatus('') }}>Remove</Button>
          </div>)}
          <div className="settings-budget-row settings-budget-new">
            <Input label="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Groceries" />
            <MoneyInput label="Monthly amount" aria-label="New monthly budget amount" value={newAmount} onValueChange={setNewAmount} />
            <Button type="button" variant="outline" onClick={addLine}>Add category</Button>
          </div>
          <p className="settings-help">Adding, editing, and removing categories changes this draft only.</p>
          <div className="settings-estimate-launch"><div><h3>A starting point for your area</h3><p className="settings-help">{zip ? `Using saved ZIP ${zip} and a household of ${household}.` : 'Add your household details in Local estimates below.'} Review suggestions before adding them to your draft. Your edited categories are protected.</p><a href="#local-estimates" className="journal-link">Edit household details <span aria-hidden="true">↓</span></a></div><Button type="button" variant="outline" loading={estimating} onClick={generate}>Preview local estimates</Button></div>
          {preview && <div className="settings-estimate-preview" role="region" aria-label="Estimate preview">
            <h3>Review your estimates</h3><p className="settings-help">AI suggestions, not verified local prices. Select only costs you do not already track as bills. Nothing is saved yet.</p>
            {!currentPreview && <p role="alert" className="settings-error">Household details changed. Generate a new preview before using these estimates.</p>}
            {preview.lines.map((suggestion) => {
              const current = rows.find((row) => categoryKey(row.category) === categoryKey(suggestion.category))
              const protectedLine = current?.origin === 'user'
              return <label key={suggestion.category} className="settings-estimate-row"><input type="checkbox" checked={!protectedLine && selected.includes(suggestion.category)} disabled={protectedLine || !currentPreview} onChange={(e) => setSelected(e.target.checked ? [...selected, suggestion.category] : selected.filter((s) => s !== suggestion.category))} /><span><strong>{formatType(suggestion.category)}</strong><small>{protectedLine ? 'Your edited amount is protected' : current ? `Current draft: ${formatMoney(moneyInputCents(current.amount))}` : 'New category'}{protectedLine && ` · ${formatMoney(moneyInputCents(current.amount))}`}</small></span><span>{formatMoney(suggestion.amount)}<small>Suggested / month</small></span></label>
            })}
            <div className="settings-preview-actions"><Button type="button" variant="ghost" onClick={() => setPreview(null)}>Dismiss preview</Button><Button type="button" onClick={usePreview} disabled={!currentPreview || !preview.lines.some((s) => selected.includes(s.category) && !rows.some((r) => categoryKey(r.category) === categoryKey(s.category) && r.origin === 'user'))}>Use selected in draft</Button></div>
          </div>}
        </fieldset>
        {error && <p role="alert" className="settings-error">{error}</p>}
        {status && <p role="status" className="settings-help">{status}</p>}
        <div className="settings-save-row"><p role="status">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'Using saved living costs'}</p><div><Button type="button" variant="ghost" onClick={discard} disabled={(!dirty && !preview) || busy || estimating}>Discard</Button><Button type="submit" loading={busy} disabled={!dirty || busy || estimating}>Save living costs</Button></div></div>
      </form>
    </section>
  )
}

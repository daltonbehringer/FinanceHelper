import { useState } from 'react'
import Button from '../ui/Button'

export default function SettingsSection({ id, number, title, description, initial, onSave, children, onDirty }) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [version, setVersion] = useState(0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  function update(key, value) {
    const next = { ...draft, [key]: value }
    setDraft(next)
    setSaved(false)
    onDirty(id, JSON.stringify(next) !== JSON.stringify(initial))
  }
  function discard() {
    setDraft(initial)
    setError('')
    setSaved(false)
    setVersion((v) => v + 1)
    onDirty(id, false)
  }
  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const next = await onSave(draft)
      setDraft(next)
      setSaved(true)
      onDirty(id, false)
    } catch (err) {
      setError(err.message || 'Could not save. Your changes are still here; try again.')
    } finally { setBusy(false) }
  }
  return (
    <section id={id} className="journal-panel settings-section" aria-label={title}>
      <div className="settings-section-heading"><span className="settings-number" aria-hidden="true">{number}</span><div><p className="journal-kicker">YOUR PREFERENCES</p><h2>{title}</h2></div></div>
      <p className="settings-description">{description}</p>
      <form onSubmit={save}>
        <fieldset key={version} disabled={busy} className="settings-fields">{children(draft, update)}</fieldset>
        {error && <p role="alert" className="settings-error">{error}</p>}
        <div className="settings-save-row">
          <p role="status">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : saved ? `${title} saved` : 'Using saved settings'}</p>
          <div><Button type="button" variant="ghost" onClick={discard} disabled={!dirty || busy}>Discard</Button><Button type="submit" loading={busy} disabled={!dirty || busy}>Save {title.toLowerCase()}</Button></div>
        </div>
      </form>
    </section>
  )
}

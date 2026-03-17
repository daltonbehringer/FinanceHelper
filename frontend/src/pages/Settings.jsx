import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'

export default function Settings() {
  const { settings, loading, refetch } = useSettings()
  const { showToast } = useToast()
  const [minChecking, setMinChecking] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!loading) {
      setMinChecking(settings.min_checking ? String(settings.min_checking) : '')
    }
  }, [loading, settings.min_checking])

  async function handleSave(e) {
    e.preventDefault()
    const value = parseFloat(minChecking) || 0
    if (value < 0) {
      showToast('Minimum balance cannot be negative', 'error')
      return
    }
    setSaving(true)
    try {
      const resp = await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ min_checking: value }),
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

  if (loading) {
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
          <form onSubmit={handleSave} className="flex items-end gap-3">
            <Input
              label="Minimum Checking Balance"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 1500"
              value={minChecking}
              onChange={(e) => setMinChecking(e.target.value)}
              className="flex-1 max-w-xs"
            />
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}

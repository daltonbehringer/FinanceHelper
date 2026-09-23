import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

// Settings must never turn a failed read into an editable default configuration.
export function useSettingsData() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setError('')
    setLoading(true)
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const read = async (path, name, array = false) => {
      const response = await apiFetch(path, { signal: controller.signal })
      if (!response?.ok) throw new Error(`Could not load ${name}. Your saved settings have not changed.`)
      const value = await response.json()
      if (!value || (array ? !Array.isArray(value) : typeof value !== 'object' || Array.isArray(value))) {
        throw new Error(`Could not load ${name}. Please retry.`)
      }
      return value
    }
    Promise.all([
      read('/api/settings', 'settings'),
      read('/api/budget/lines', 'living-cost categories', true),
      read('/api/accounts?include_inactive=0', 'payment accounts', true),
    ]).then(([settings, lines, accounts]) => {
      if (!controller.signal.aborted) { setData({ settings, lines, accounts }); setLoading(false) }
    }).catch((err) => {
      if (!controller.signal.aborted) { setError(err.message || 'Could not load settings. Please retry.'); setLoading(false) }
    })
    return () => controller.abort()
  }, [attempt])
  return { data, setData, loading, error, retry }
}

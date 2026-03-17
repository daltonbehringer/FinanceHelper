import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useSettings() {
  const [settings, setSettings] = useState({ min_checking: 0 })
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    setLoading(true)
    apiFetch('/api/settings')
      .then(resp => resp && resp.ok ? resp.json() : { min_checking: 0 })
      .then(data => { setSettings(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tick])

  return { settings, loading, refetch }
}

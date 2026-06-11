import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/** Server-computed safe-to-spend summary (integer cents) — the same figure the
 *  AI advisor states, so the dashboard tile can't drift from it. */
export function useSafeToSpend() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    apiFetch('/api/dashboard/safe-to-spend')
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => { if (active) { setSummary(d); setLoading(false) } })
      .catch(() => active && setLoading(false))
    return () => { active = false }
  }, [tick])

  return { summary, loading, refetch }
}

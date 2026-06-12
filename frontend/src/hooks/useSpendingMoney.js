import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

// Server-computed monthly spending-money summary (integer cents), the same
// figure the advisor cites — see backend/lib/budget.py. `summary.has_budget`
// is false until the user has budget lines (tile shows an em-dash then).
export function useSpendingMoney() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    apiFetch('/api/budget/spending-money')
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => { if (active) { setSummary(d); setLoading(false) } })
      .catch(() => active && setLoading(false))
    return () => { active = false }
  }, [tick])

  return { summary, loading, refetch }
}

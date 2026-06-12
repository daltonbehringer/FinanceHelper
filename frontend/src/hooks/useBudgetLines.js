import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

// Editable budget lines (integer cents). `origin` is 'llm_estimate' or 'user'.
export function useBudgetLines() {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    apiFetch('/api/budget/lines')
      .then((r) => (r && r.ok ? r.json() : []))
      .then((d) => { if (active) { setLines(d || []); setLoading(false) } })
      .catch(() => active && setLoading(false))
    return () => { active = false }
  }, [tick])

  return { lines, loading, refetch }
}

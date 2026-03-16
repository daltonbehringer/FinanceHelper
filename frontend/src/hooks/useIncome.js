import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useIncome(includeInactive = false) {
  const [income, setIncome] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/income?include_inactive=${includeInactive ? 1 : 0}`)
      .then(resp => resp && resp.ok ? resp.json() : [])
      .then(data => { setIncome(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [includeInactive, tick])

  return { income, loading, refetch }
}

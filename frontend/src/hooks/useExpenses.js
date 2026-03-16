import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useExpenses(includeInactive = false) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/expenses?include_inactive=${includeInactive ? 1 : 0}`)
      .then(resp => resp && resp.ok ? resp.json() : [])
      .then(data => { setExpenses(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [includeInactive, tick])

  return { expenses, loading, refetch }
}

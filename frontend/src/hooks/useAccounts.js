import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useAccounts(includeInactive = false) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/accounts?include_inactive=${includeInactive ? 1 : 0}`)
      .then(resp => resp && resp.ok ? resp.json() : [])
      .then(data => { setAccounts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [includeInactive, tick])

  return { accounts, loading, refetch }
}

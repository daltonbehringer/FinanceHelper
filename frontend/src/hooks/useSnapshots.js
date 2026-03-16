import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useSnapshots(accountId = null) {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    setLoading(true)
    const url = accountId ? `/api/snapshots?account_id=${accountId}` : '/api/snapshots'
    apiFetch(url)
      .then(resp => resp && resp.ok ? resp.json() : [])
      .then(data => { setSnapshots(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId, tick])

  return { snapshots, loading, refetch }
}

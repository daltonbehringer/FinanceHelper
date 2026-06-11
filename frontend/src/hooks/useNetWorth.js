import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

/** Server-computed net-worth time series (assets/debts/net in cents, ascending). */
export function useNetWorth(accountId = null) {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    const url = accountId
      ? `/api/history/net-worth?account_id=${accountId}`
      : '/api/history/net-worth'
    apiFetch(url)
      .then(r => (r && r.ok ? r.json() : { series: [] }))
      .then(d => { if (active) { setSeries(d.series || []); setLoading(false) } })
      .catch(() => active && setLoading(false))
    return () => { active = false }
  }, [accountId])

  return { series, loading }
}

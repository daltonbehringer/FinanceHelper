import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

// Per-account-type field registry from GET /api/meta/account-fields.
// The backend owns which fields each account type supports; forms render from it.
export function useAccountFields() {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/meta/account-fields')
      .then(resp => resp && resp.ok ? resp.json() : { types: [] })
      .then(data => { setTypes(data.types || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return { types, loading }
}

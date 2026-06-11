import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Cursor-paginated event feed. `all` toggles the History default-visibility
 * filter (false = balance + create/delete; true = every event, incl. field edits).
 * Refetches from scratch when `all` changes; loadMore() appends the next page.
 */
export function useEvents({ all = false } = {}) {
  const [events, setEvents] = useState([])
  const [cursor, setCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchPage = useCallback((cur) => {
    const params = new URLSearchParams()
    if (all) params.set('all', 'true')
    if (cur != null) params.set('cursor', cur)
    return apiFetch(`/api/events?${params.toString()}`)
      .then(r => (r && r.ok ? r.json() : { events: [], next_cursor: null }))
  }, [all])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchPage(null)
      .then(d => {
        if (!active) return
        setEvents(d.events || [])
        setCursor(d.next_cursor)
        setHasMore(d.next_cursor != null)
        setLoading(false)
      })
      .catch(() => active && setLoading(false))
    return () => { active = false }
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    fetchPage(cursor)
      .then(d => {
        setEvents(prev => [...prev, ...(d.events || [])])
        setCursor(d.next_cursor)
        setHasMore(d.next_cursor != null)
        setLoadingMore(false)
      })
      .catch(() => setLoadingMore(false))
  }, [hasMore, loadingMore, cursor, fetchPage])

  return { events, loading, loadingMore, hasMore, loadMore }
}

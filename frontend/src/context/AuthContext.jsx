import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'

const AuthContext = createContext(null)

const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const THROTTLE_MS = 30 * 1000 // only reset timer every 30s

function useIdleLogout(logout, enabled) {
  const timerRef = useRef(null)
  const lastResetRef = useRef(Date.now())

  const resetTimer = useCallback(() => {
    const now = Date.now()
    if (now - lastResetRef.current < THROTTLE_MS) return
    lastResetRef.current = now

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      logout()
    }, IDLE_TIMEOUT_MS)
  }, [logout])

  useEffect(() => {
    if (!enabled) return

    // Start the initial timer
    timerRef.current = setTimeout(() => {
      logout()
    }, IDLE_TIMEOUT_MS)

    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
    for (const evt of events) {
      window.addEventListener(evt, resetTimer, { passive: true })
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const evt of events) {
        window.removeEventListener(evt, resetTimer)
      }
    }
  }, [enabled, logout, resetTimer])
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/auth/me')
      .then(resp => {
        if (resp && resp.ok) return resp.json()
        return null
      })
      .then(data => {
        if (data) setUser(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' })
    document.cookie = 'stytch_session=; Max-Age=0; path=/'
    const apiBase = import.meta.env.VITE_API_BASE_URL || ''
    window.location.href = apiBase + '/auth/login'
  }, [])

  useIdleLogout(logout, !!user)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

import { createContext, useCallback, useContext, useRef } from 'react'
import { useAuth } from './AuthContext'
import { useAdvisorChat } from '../hooks/useAdvisorChat'

// One shared advisor conversation for the whole app. Mounted above the routes so
// the thread survives navigation and is the SAME on the Dashboard widget and the
// Chat page. Pages register a refresh callback so their data (account cards, etc.)
// refetches after a confirmed write, regardless of which page triggered it.
const AdvisorChatContext = createContext(null)

export function AdvisorChatProvider({ children }) {
  const { user } = useAuth()
  const subscribers = useRef(new Set())

  const notifyWrite = useCallback(() => {
    subscribers.current.forEach((fn) => {
      try { fn() } catch { /* a subscriber error must not block the others */ }
    })
  }, [])

  const registerRefresh = useCallback((fn) => {
    subscribers.current.add(fn)
    return () => subscribers.current.delete(fn)
  }, [])

  const chat = useAdvisorChat({
    userId: user?.id ?? user?.email,
    onUpdate: notifyWrite,
    onExpenseUpdate: notifyWrite,
  })

  return (
    <AdvisorChatContext.Provider value={{ ...chat, registerRefresh }}>
      {children}
    </AdvisorChatContext.Provider>
  )
}

export function useAdvisorChatContext() {
  const ctx = useContext(AdvisorChatContext)
  if (!ctx) throw new Error('useAdvisorChatContext must be used within AdvisorChatProvider')
  return ctx
}

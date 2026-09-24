import { createContext, useCallback, useContext, useRef } from 'react'
import { useAuth } from './AuthContext'
import { useAdvisorChat } from '../hooks/useAdvisorChat'

// One temporary conversation shared by the advisor entry points. It survives
// navigation for up to 24 hours. Pages register refresh callbacks so confirmed
// financial changes refresh their data even when the conversation has expired.
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

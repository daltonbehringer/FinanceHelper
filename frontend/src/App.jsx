import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Expenses from './pages/Expenses'
import Income from './pages/Income'
import Chat from './pages/Chat'
import History from './pages/History'
import Settings from './pages/Settings'

// The session is established server-side: the backend OAuth callback sets an
// HttpOnly cookie and redirects here. No token handling happens in the browser.

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/income" element={<Income />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/advisor" element={<Navigate to="/chat" replace />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Layout>
        </ToastProvider>
      </AuthProvider>
      <Analytics />
    </BrowserRouter>
  )
}

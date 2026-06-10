import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Expenses from './pages/Expenses'
import Income from './pages/Income'
import Advisor from './pages/Advisor'
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
              <Route path="/advisor" element={<Advisor />} />
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

import { BrowserRouter, Routes, Route } from 'react-router-dom'
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

// Extract session token from URL after OAuth redirect and store in cookie
const params = new URLSearchParams(window.location.search)
const _token = params.get('session_token')
if (_token) {
  document.cookie = `stytch_session=${_token}; path=/; max-age=3600; SameSite=lax`
  window.history.replaceState({}, '', window.location.pathname)
}

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
    </BrowserRouter>
  )
}

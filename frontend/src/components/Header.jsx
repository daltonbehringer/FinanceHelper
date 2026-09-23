import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { navigationGroups } from '../lib/navigation'

export default function Header({ onMenuToggle, sidebarOpen, collapsed, onCollapseToggle }) {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const accountPopover = useRef(null)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const group = navigationGroups.find(group => group.items.some(item => item.to === pathname))
  const page = group?.items.find(item => item.to === pathname)?.label || 'Workspace'
  const initial = user?.email?.slice(0, 1).toUpperCase() || 'F'

  async function handleLogout() {
    setSigningOut(true)
    setError('')
    try { await logout() }
    catch {
      setError('Could not sign out. Please try again.')
      setSigningOut(false)
    }
  }

  return (
    <header className="shell-header">
      <div className="shell-location">
        <button type="button" className="shell-icon-button shell-desktop-toggle"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed} aria-controls="desktop-navigation" onClick={onCollapseToggle}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          <PanelIcon />
        </button>
        <button type="button" className="shell-icon-button shell-mobile-toggle"
          aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls="mobile-navigation" onClick={onMenuToggle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="shell-breadcrumb" aria-label="Current page">
          <span className="shell-breadcrumb-group">{group?.label || 'FinanceAI'}</span>
          <span className="shell-breadcrumb-divider" aria-hidden="true">/</span>
          <span aria-current="page">{page}</span>
        </div>
      </div>
      <div className="shell-header-actions">
        {pathname !== '/chat' && <Link to="/chat" className="shell-advisor-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3 1.5-6A7.5 7.5 0 1 1 20 11.5Z" />
          </svg>
          <span>Ask advisor</span>
        </Link>}
        <button type="button" className="shell-account-button" popoverTarget="account-popover" aria-label="Account options">
          <span className="shell-avatar" aria-hidden="true">{initial}</span>
          <svg className="shell-account-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
        <div id="account-popover" className="shell-account-popover" popover="auto" ref={accountPopover}>
          <p className="shell-account-caption">Your account</p>
          <p className="shell-account-email">{user?.email || 'FinanceAI workspace'}</p>
          <Link to="/settings" onClick={() => accountPopover.current?.hidePopover()}>Settings <span aria-hidden="true">↗</span></Link>
          <button type="button" onClick={handleLogout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'} <span aria-hidden="true">→</span></button>
          {error && <p className="shell-account-error" role="alert">{error}</p>}
        </div>
      </div>
    </header>
  )
}

function PanelIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" />
  </svg>
}

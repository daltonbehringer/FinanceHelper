import { useCallback, useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'
import '../styles/shell.css'

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('finance:sidebar-collapsed') === 'true' }
    catch { return false }
  })
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const onResize = () => { if (desktop.matches) closeSidebar() }
    desktop.addEventListener('change', onResize)
    return () => desktop.removeEventListener('change', onResize)
  }, [closeSidebar])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('finance:sidebar-collapsed', String(next)) }
    catch { /* Navigation still works when browser storage is unavailable. */ }
  }

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      <a className="shell-skip-link" href="#main-content">Skip to content</a>
      <Sidebar open={sidebarOpen} onClose={closeSidebar} collapsed={collapsed} />
      <div className="shell-workspace">
        <Header collapsed={collapsed} onCollapseToggle={toggleCollapsed}
          sidebarOpen={sidebarOpen} onMenuToggle={() => setSidebarOpen(true)} />
        <main id="main-content" tabIndex={-1} className="shell-content">
          {children}
        </main>
      </div>
    </div>
  )
}

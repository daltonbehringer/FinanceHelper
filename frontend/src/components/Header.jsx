import { useAuth } from '../context/AuthContext'

export default function Header({ onMenuToggle }) {
  const { user, logout } = useAuth()

  return (
    <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-3 md:hidden">
        <button
          onClick={onMenuToggle}
          className="p-2.5 -ml-2.5 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <img src="/favicon.png" alt="Finance AI" className="w-7 h-7 rounded-lg" />
        <span className="font-semibold text-gray-900">FinanceAI</span>
      </div>

      <div className="flex-1 hidden md:block" />

      <div className="flex items-center gap-4">
        {user && (
          <span className="text-sm text-gray-500 hidden sm:inline">
            {user.email}
          </span>
        )}
        <button
          onClick={logout}
          className="text-sm text-gray-500 hover:text-danger transition-colors font-medium"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}

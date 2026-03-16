import { useAuth } from '../context/AuthContext'

export default function Header({ onMenuToggle }) {
  const { user, logout } = useAuth()

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      <button
        onClick={onMenuToggle}
        className="md:hidden p-2 -ml-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      <div className="flex-1" />

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

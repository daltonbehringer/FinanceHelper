export const navigationGroups = [
  { label: 'Workspace', items: [{ to: '/', label: 'Dashboard' }] },
  { label: 'Your money', items: [
    { to: '/accounts', label: 'Accounts' },
    { to: '/expenses', label: 'Expenses' },
    { to: '/income', label: 'Income' },
  ] },
  { label: 'Perspective', items: [
    { to: '/chat', label: 'Chat' },
    { to: '/history', label: 'History' },
  ] },
  { label: 'Preferences', items: [{ to: '/settings', label: 'Settings' }] },
]

const colorMap = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/10',
  green: 'bg-green-50 text-green-700 ring-green-600/10',
  red: 'bg-red-50 text-red-700 ring-red-600/10',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-600/10',
  gray: 'bg-gray-50 text-gray-600 ring-gray-500/10',
  purple: 'bg-purple-50 text-purple-700 ring-purple-600/10',
}

export default function Badge({ children, color = 'gray', className = '' }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${colorMap[color]} ${className}`}
    >
      {children}
    </span>
  )
}

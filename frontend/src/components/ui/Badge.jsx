const colorMap = {
  blue: 'bg-blue-500/15 text-blue-300 ring-blue-400/20',
  green: 'bg-green-500/15 text-green-300 ring-green-400/20',
  red: 'bg-red-500/15 text-red-300 ring-red-400/20',
  yellow: 'bg-yellow-500/15 text-yellow-300 ring-yellow-400/20',
  gray: 'bg-surface-raised text-text-muted ring-border',
  purple: 'bg-purple-500/15 text-purple-300 ring-purple-400/20',
}

const sizeMap = {
  sm: 'px-2 py-0.5 text-2xs',
  md: 'px-2.5 py-1 text-xs',
}

export default function Badge({ children, color = 'gray', size = 'md', className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-md font-medium ring-1 ring-inset ${sizeMap[size] || sizeMap.md} ${colorMap[color]} ${className}`}
    >
      {children}
    </span>
  )
}

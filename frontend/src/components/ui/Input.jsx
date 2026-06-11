export default function Input({ label, className = '', ...props }) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <input
        className="w-full px-3 py-2 rounded-lg border border-border bg-surface-sunken text-text text-sm
          focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
          transition-colors placeholder:text-text-subtle"
        {...props}
      />
    </div>
  )
}

export function Select({ label, children, className = '', ...props }) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <select
        className="w-full px-3 py-2 rounded-lg border border-border bg-surface-sunken text-text text-sm
          focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
          transition-colors"
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

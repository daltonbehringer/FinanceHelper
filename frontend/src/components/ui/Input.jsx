import { useId } from 'react'

export default function Input({ label, className = '', ...props }) {
  const generatedId = useId()
  const id = props.id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-text-muted mb-1">
          {label}
        </label>
      )}
      <input
        id={id}
        className="w-full px-3 py-2 rounded-lg border border-border bg-surface-sunken text-text text-sm
          focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
          transition-colors placeholder:text-text-subtle"
        {...props}
      />
    </div>
  )
}

export function Select({ label, children, className = '', ...props }) {
  const generatedId = useId()
  const id = props.id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-text-muted mb-1">
          {label}
        </label>
      )}
      <select
        id={id}
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

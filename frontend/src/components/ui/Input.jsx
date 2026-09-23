import { useId } from 'react'

export default function Input({ label, className = '', prefix, ...props }) {
  const generatedId = useId()
  const id = props.id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-text-muted mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        {prefix && <span aria-hidden="true" className="pointer-events-none absolute left-3 top-2 text-sm text-text-muted">{prefix}</span>}
        <input
          id={id}
          className={`w-full ${prefix ? 'pl-7 pr-3 tabular-nums' : 'px-3'} py-2 rounded-lg border border-border bg-surface-sunken text-text text-sm
          focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
          transition-colors placeholder:text-text-subtle`}
          {...props}
        />
      </div>
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

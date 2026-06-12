import Button from './Button'

export default function EmptyState({ icon, title, description, action, onAction }) {
  return (
    <div className="text-center py-12 px-4">
      {icon && <div className="mx-auto mb-4 text-text-subtle/60">{icon}</div>}
      <h3 className="text-sm font-semibold text-text mb-1">{title}</h3>
      {description && <p className="text-sm text-text-muted mb-4">{description}</p>}
      {action && onAction && (
        <Button variant="primary" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}

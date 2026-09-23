import { useEffect, useId, useRef } from 'react'

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}) {
  const titleId = useId()
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!isOpen || !dialogRef.current) return
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 m-auto w-full h-full max-w-none max-h-none bg-transparent p-4 open:flex items-center justify-center backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div
        className={`relative bg-surface border border-border rounded-xl shadow-xl ${maxWidth} w-full max-h-[90vh] overflow-auto animate-in`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 id={titleId} className="text-lg font-semibold text-text">
            {title}
          </h3>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="p-2 text-text-subtle hover:text-text rounded-lg hover:bg-surface-raised transition-colors"
          >
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </dialog>
  )
}

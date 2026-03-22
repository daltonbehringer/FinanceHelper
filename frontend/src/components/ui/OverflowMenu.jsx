import { useState, useRef, useEffect, useCallback } from 'react'

export default function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, direction: 'down' })
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < 120
    setPos({
      top: openUp ? rect.top : rect.bottom + 4,
      left: rect.right - 144, // 144px = w-36
      direction: openUp ? 'up' : 'down',
    })
  }, [])

  function handleOpen() {
    if (!open) updatePosition()
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (buttonRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Recalculate on scroll/resize while open
  useEffect(() => {
    if (!open) return
    function handleReposition() { updatePosition() }
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('resize', handleReposition)
    return () => {
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('resize', handleReposition)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="fixed z-50 w-36 rounded-lg bg-white shadow-lg ring-1 ring-black/5 py-1"
          style={{
            top: pos.direction === 'up' ? undefined : pos.top,
            bottom: pos.direction === 'up' ? window.innerHeight - pos.top + 4 : undefined,
            left: Math.max(8, Math.min(pos.left, window.innerWidth - 152)),
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); item.onClick() }}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

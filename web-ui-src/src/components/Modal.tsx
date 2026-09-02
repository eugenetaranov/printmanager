import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Centered modal dialog: dimmed backdrop, pop-in card, Esc / backdrop-click to
// close. Mirrors the previous UI's merge modal styling.
export function Modal({
  open,
  onClose,
  labelledBy,
  wide,
  children,
}: {
  open: boolean
  onClose: () => void
  labelledBy?: string
  wide?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="modal modal-open"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={'modal-box ' + (wide ? 'max-w-[520px]' : 'max-w-[380px]')}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

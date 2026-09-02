import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Centered modal dialog: dimmed backdrop, pop-in card, Esc / backdrop-click to
// close. Mirrors the previous UI's merge modal styling.
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean
  onClose: () => void
  labelledBy?: string
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(20,20,16,0.38)] p-5 backdrop-blur-[2px] [animation:mfade_0.16s_ease_both]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full max-w-[340px] rounded-2xl border border-border bg-surface p-5 shadow-pop [animation:mpop_0.18s_cubic-bezier(0.2,0.9,0.3,1.2)_both]"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

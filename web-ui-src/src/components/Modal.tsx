import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Centered modal dialog: dimmed backdrop, pop-in card, Esc / backdrop-click to
// close. Focus is moved into the dialog on open, trapped with Tab, and returned
// to the triggering element on close.
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
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Remember what had focus so we can restore it when the dialog closes.
    const prev = document.activeElement as HTMLElement | null

    // Move focus into the dialog (first focusable, else the box itself).
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? box.current)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !box.current) return
      // Trap Tab within the dialog.
      const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        box.current.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || active === box.current)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
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
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={'modal-box overflow-x-hidden focus:outline-none ' + (wide ? 'max-w-[640px]' : 'max-w-[380px]')}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Modal dialog: a bottom sheet on phones, a centred card from `sm` up. Dimmed
// backdrop, Esc / backdrop-click to close. Focus is moved into the dialog on
// open, trapped with Tab, and returned to the triggering element on close.
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
  // Callers pass an inline onClose, which changes on every parent render (the
  // queue poll re-renders every 3 s). Read it through a ref so the effect runs
  // only on open/close — otherwise focus jumped back to the first control.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

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
        closeRef.current()
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
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      className="modal modal-open modal-bottom sm:modal-middle"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current()
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={'modal-box max-h-[85dvh] overflow-x-hidden p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] focus:outline-none sm:p-6 ' + (wide ? 'sm:max-w-[640px]' : 'sm:max-w-[380px]')}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

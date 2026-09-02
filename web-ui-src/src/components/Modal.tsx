import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// Thin wrapper over shadcn's Dialog so existing call sites keep the simple
// open/onClose API while gaining a real focus trap, Escape/backdrop handling,
// and animations. DialogContent renders its own close (X) button.
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
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        aria-labelledby={labelledBy}
        className={wide ? 'sm:max-w-[520px]' : 'sm:max-w-[380px]'}
      >
        {/* Callers render their own visible heading; this satisfies Radix's
            requirement for a DialogTitle without duplicating it visually. */}
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

import type { ReactNode } from 'react'

// Shared compact controls: the Devices modal's square icon buttons, icon set
// and status dot, reused by the Queue tab so device rows look the same in both.

export function Dot({ status }: { status: string }) {
  const cls = status === 'error' ? 'bg-error' : status === 'connected' ? 'bg-primary' : 'bg-warning'
  return <span className={'h-[7px] w-[7px] flex-none rounded-full ' + cls} />
}

// Square icon button with a hover tooltip — keeps the device rows compact.
export function IconBtn({ title, onClick, variant, disabled, tip = 'top', children }: { title: string; onClick: () => void; variant?: 'primary' | 'active' | 'danger'; disabled?: boolean; tip?: 'top' | 'bottom'; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={title}
      aria-label={title}
      className={`tooltip tooltip-${tip} btn btn-square btn-sm ` + (variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-error' : variant === 'active' ? 'btn-active' : 'btn-ghost')}
    >
      {children}
    </button>
  )
}

const svg = (children: ReactNode) => () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
export const Icon = {
  test: svg(<><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="13" width="12" height="8" rx="1" /></>),
  reconnect: svg(<><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>),
  disconnect: svg(<><path d="M18.4 6.6a9 9 0 1 1-12.7 0" /><path d="M12 2v10" /></>),
  size: svg(<><rect x="2.5" y="7" width="19" height="10" rx="1.5" /><path d="M7 7v3M11 7v4M15 7v3M19 7v4" /></>),
  log: svg(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  forget: svg(<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />),
  connect: svg(<path d="M12 5v14M5 12h14" />),
  refresh: svg(<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  close: svg(<path d="M6 6 18 18M18 6 6 18" />),
  edit: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  minus: svg(<path d="M5 12h14" />),
  stop: svg(<rect x="6" y="6" width="12" height="12" rx="1.5" />),
}


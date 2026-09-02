import { useState } from 'react'
import { StatusProvider, StatusLed } from './components/status'
import { useRoute, type TabId } from './lib/router'
import { ScanTab } from './tabs/ScanTab'

const TABS: { id: TabId; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'labels', label: 'Labels' },
  { id: 'print', label: 'Print' },
]

export function App() {
  return (
    <StatusProvider>
      <Shell />
    </StatusProvider>
  )
}

function Shell() {
  const [tab, navigate] = useRoute()
  const [, setDevicesOpen] = useState(false)

  return (
    <div className="mx-auto max-w-[640px] px-5 pb-24 pt-[clamp(22px,5vw,44px)]">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="text-[19px] font-[640] tracking-[-0.01em]">Print / Scan</div>
        <div className="flex items-center gap-3">
          <StatusLed />
          <button
            type="button"
            title="Devices"
            aria-label="Manage devices"
            onClick={() => setDevicesOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted shadow-card transition-colors hover:text-text"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V3h12v6" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="13.5" width="12" height="7.5" rx="1" />
              <path d="M17.5 11.5h.01" />
            </svg>
          </button>
        </div>
      </header>

      <nav className="mb-6 inline-flex rounded-xl border border-border bg-surface p-1 shadow-card" role="tablist" aria-label="Tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => navigate(t.id)}
            className={
              'cursor-pointer rounded-[9px] px-[18px] py-2 font-sans text-[13.5px] font-[640] tracking-[-0.01em] transition-colors ' +
              (tab === t.id ? 'bg-accent-weak text-accent' : 'text-muted hover:text-text')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'scan' && <ScanTab />}
      {tab === 'labels' && <Placeholder name="Labels" />}
      {tab === 'print' && <Placeholder name="Print" />}
    </div>
  )
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <p className="font-mono text-[13px] text-muted">{name} tab — not yet ported.</p>
    </div>
  )
}

import { useState } from 'react'
import { StatusProvider, StatusLed } from './components/status'
import { useRoute, type TabId } from './lib/router'
import { ScanTab } from './tabs/ScanTab'
import { PrintTab } from './tabs/PrintTab'
import { LabelsTab } from './tabs/LabelsTab'
import { DevicesModal } from './components/DevicesModal'

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
  const [devicesOpen, setDevicesOpen] = useState(false)

  return (
    <div className="mx-auto max-w-[640px] px-5 pb-24 pt-[clamp(22px,5vw,44px)]">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="text-[19px] font-[640] tracking-[-0.01em]">Print / Scan</div>
        <div className="flex items-center gap-3">
          <StatusLed />
          <button
            type="button"
            data-tip="Devices"
            aria-label="Manage devices"
            onClick={() => setDevicesOpen(true)}
            className="tooltip tooltip-left btn btn-square btn-ghost btn-sm"
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

      <div role="tablist" aria-label="Tools" className="tabs tabs-box mb-6 inline-flex w-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => navigate(t.id)}
            className={'tab font-[640] ' + (tab === t.id ? 'tab-active' : '')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'scan' && <ScanTab />}
      {tab === 'labels' && <LabelsTab />}
      {tab === 'print' && <PrintTab />}

      <DevicesModal open={devicesOpen} onClose={() => setDevicesOpen(false)} />
    </div>
  )
}

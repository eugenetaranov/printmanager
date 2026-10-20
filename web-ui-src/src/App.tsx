import { useState } from 'react'
import { StatusProvider, StatusLed } from './components/status'
import { useRoute, type TabId } from './lib/router'
import { ScanTab } from './tabs/ScanTab'
import { PrintTab } from './tabs/PrintTab'
import { DevicesModal } from './components/DevicesModal'
import { ActivityLogProvider, ActivityFooter } from './components/ActivityLog'
import { LabelsTab } from './tabs/LabelsTab'
import { QueueProvider, useQueue } from './components/QueueContext'

const TABS: { id: TabId; label: string }[] = [
  { id: 'labels', label: 'Labels' },
  { id: 'scan', label: 'Scan' },
  { id: 'print', label: 'Print' },
]

export function App() {
  return (
    <StatusProvider>
      <ActivityLogProvider>
        <QueueProvider>
          <Shell />
        </QueueProvider>
      </ActivityLogProvider>
    </StatusProvider>
  )
}

function Shell() {
  const [tab, navigate] = useRoute()
  const [devicesOpen, setDevicesOpen] = useState(false)
  const { state: queue } = useQueue()
  const queued = queue.items.length
  const queueFailed = queue.items.some((i) => i.state === 'failed')

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* Full-bleed white bar on the paper background, hairline below. */}
      <header className="border-b border-base-300 bg-base-100">
        <div className="mx-auto flex h-14 max-w-[680px] items-center justify-between gap-4 px-4 sm:px-5">
          <div className="flex items-center gap-[10px]">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true" className="flex-none text-primary">
              <rect width="32" height="32" rx="7" fill="currentColor" />
              <g fill="var(--color-primary-content)">
                <rect x="7.5" y="7.5" width="7" height="7" rx="1.6" />
                <rect x="17.5" y="7.5" width="7" height="7" rx="1.6" />
                <rect x="7.5" y="17.5" width="7" height="7" rx="1.6" />
                <rect x="17.5" y="17.5" width="7" height="7" rx="1.6" />
              </g>
            </svg>
            <div className="text-title font-[700] tracking-[-0.02em]">Print <span className="font-[450] text-base-content/60">/ Scan</span></div>
          </div>
          <div className="flex items-center gap-3">
            <StatusLed />
            {queued > 0 && tab !== 'labels' && (
              <div className="indicator">
                <span className={'indicator-item badge badge-xs translate-x-[-4px] translate-y-[4px] font-mono tabular-nums ' + (queueFailed ? 'badge-error' : 'badge-primary')}>{queued}</span>
                <button
                  type="button"
                  data-tip="Queue"
                  aria-label={`Print queue, ${queued} waiting`}
                  onClick={() => navigate('labels')}
                  className="tooltip tooltip-bottom btn btn-square btn-ghost btn-sm pointer-coarse:size-11"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="13" height="5" rx="1" />
                    <rect x="4" y="10" width="13" height="5" rx="1" />
                    <path d="M4 19.5h13" />
                    <path d="M20 6v12" />
                  </svg>
                </button>
              </div>
            )}
            <button
              type="button"
              data-tip="Devices"
              aria-label="Manage devices"
              onClick={() => setDevicesOpen(true)}
              className="tooltip tooltip-bottom btn btn-square btn-ghost btn-sm pointer-coarse:size-11"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9V3h12v6" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="13.5" width="12" height="7.5" rx="1" />
                <path d="M17.5 11.5h.01" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 pb-24 pt-[clamp(12px,4vw,32px)] sm:px-5">
        {/* Underlined text tabs on a hairline, like a document's section nav. */}
        <div role="tablist" aria-label="Tools" className="mb-5 flex gap-6 border-b border-base-300 sm:mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => navigate(t.id)}
              className={'-mb-px flex min-h-11 cursor-pointer items-center gap-[6px] border-b-2 text-body font-[600] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary '
                + (tab === t.id ? 'border-primary text-primary' : 'border-transparent text-base-content/60 hover:text-base-content')}
            >
              {t.label}
              {t.id === 'labels' && queued > 0 && (
                <span className={'badge badge-xs font-mono tabular-nums ' + (queueFailed ? 'badge-error' : 'badge-primary')}>{queued}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'scan' && <ScanTab />}
        {tab === 'print' && <PrintTab />}
        {tab === 'labels' && <LabelsTab />}

        {tab === 'scan' && <ActivityFooter />}

        {/* mt-auto pins the build line to the bottom of the viewport (flex-col
            container) so it sits at the same place on every tab, instead of
            floating up under short content. */}
        <div className="mt-auto pt-8 text-right font-mono text-2xs text-base-content/60">Build: {__APP_VERSION__}</div>

      </div>

      <DevicesModal open={devicesOpen} onClose={() => setDevicesOpen(false)} />
    </div>
  )
}

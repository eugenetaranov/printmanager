import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { StatusProvider, StatusLed } from './components/status'
import { useRoute, type TabId } from './lib/router'
import { ScanTab } from './tabs/ScanTab'
import { PrintTab } from './tabs/PrintTab'
import { LabelsTab } from './tabs/LabelsTab'
import { DevicesModal } from './components/DevicesModal'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
          <Button variant="outline" size="icon" title="Devices" aria-label="Manage devices" onClick={() => setDevicesOpen(true)}>
            <Monitor />
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => navigate(v as TabId)} className="mb-6">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === 'scan' && <ScanTab />}
      {tab === 'labels' && <LabelsTab />}
      {tab === 'print' && <PrintTab />}

      <DevicesModal open={devicesOpen} onClose={() => setDevicesOpen(false)} />
    </div>
  )
}

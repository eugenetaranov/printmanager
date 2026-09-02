import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { devices as devApi, niimbot as nb, type Device, type NiimState, type NiimPrinter, type NiimCandidate } from '../api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type DStatus = { msg: string; cls: '' | 'ok' | 'err' }

const GROUPS: { kind: string; label: string }[] = [
  { kind: 'printer', label: 'Printers' },
  { kind: 'scanner', label: 'Scanners' },
  { kind: 'usb', label: 'Other' },
]

function Dot({ status }: { status: string }) {
  const cls = status === 'error' ? 'bg-destructive' : status === 'connected' ? 'bg-primary' : 'bg-warn'
  return <span className={'h-[7px] w-[7px] flex-none rounded-full ' + cls} />
}

export function DevicesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [devs, setDevs] = useState<Device[]>([])
  const [state, setState] = useState<NiimState | null>(null)
  const [candidates, setCandidates] = useState<NiimCandidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dstatus, setDstatus] = useState<Record<string, DStatus>>({})
  const [editSize, setEditSize] = useState('')
  const [logAddr, setLogAddr] = useState('')
  const [note, setNote] = useState<DStatus | null>(null)

  const setDS = (addr: string, msg: string, cls: DStatus['cls'] = '') =>
    setDstatus((m) => ({ ...m, [addr]: { msg, cls } }))

  const reload = useCallback(() => {
    devApi.list().then(setDevs).catch(() => {})
    nb.state().then(setState).catch(() => {})
  }, [])

  useEffect(() => { if (open) { reload(); setCandidates([]); setNote(null) } }, [open, reload])

  const refresh = () => {
    setBusy(true)
    devApi.refresh().then((r) => setDevs(r.devices)).catch(() => {}).finally(() => setBusy(false))
    nb.state().then(setState).catch(() => {})
  }

  const testDevice = (d: Device) => {
    setNote({ msg: `Sending test page to ${d.name}…`, cls: '' })
    devApi.testpage(d.kind, d.id)
      .then((r) => setNote({ msg: r.ok ? `Test page sent to ${d.name}` : r.error || 'Test page failed', cls: r.ok ? 'ok' : 'err' }))
      .catch(() => setNote({ msg: 'Test page failed', cls: 'err' }))
  }

  const scan = () => {
    setScanning(true)
    nb.scan()
      .then((r) => setCandidates(r.candidates || []))
      .catch(() => setNote({ msg: 'Scan failed', cls: 'err' }))
      .finally(() => setScanning(false))
  }

  const connect = (c: NiimCandidate) => {
    setBusy(true)
    setDS(c.address, 'Connecting…')
    nb.connect(c.address, c.name)
      .then((r) => { setState(r); setCandidates((cs) => cs.filter((x) => x.address !== c.address)); setDS(c.address, '') })
      .catch(() => setDS(c.address, 'Connection failed', 'err'))
      .finally(() => { setBusy(false); reload() })
  }

  const action = (act: 'reconnect' | 'disconnect' | 'forget' | 'test', p: NiimPrinter) => {
    if (busy) return
    if (act === 'test') {
      setBusy(true); setDS(p.address, 'Printing…')
      devApi.testpage('label-printer', p.address)
        .then((r) => setDS(p.address, r.ok ? 'Test sent' : r.error || 'Test failed', r.ok ? 'ok' : 'err'))
        .catch(() => setDS(p.address, 'Test failed', 'err'))
        .finally(() => setBusy(false))
      return
    }
    setBusy(true)
    setDS(p.address, act === 'reconnect' ? 'Connecting…' : act === 'disconnect' ? 'Disconnecting…' : 'Removing…')
    const call = act === 'reconnect' ? nb.reconnect(p.address) : act === 'disconnect' ? nb.disconnect(p.address) : nb.forget(p.address)
    call
      .then((r) => { if (r.ok) { setState(r); setDS(p.address, '') } else setDS(p.address, act === 'reconnect' ? 'Connection failed' : r.error || 'Failed', 'err') })
      .catch(() => setDS(p.address, 'Request failed — try again', 'err'))
      .finally(() => { setBusy(false); reload() })
  }

  const saveSize = (p: NiimPrinter, w: number, h: number) => {
    if (!(w > 0 && h > 0)) return
    setEditSize(''); setDS(p.address, 'Saving size…')
    nb.labelsize(p.address, w, h).then(() => { setDS(p.address, ''); reload() }).catch(() => setDS(p.address, 'Could not save size', 'err'))
  }

  const printers = state?.printers ?? []
  const showAdapterWarn = state?.adapter === false && printers.length === 0
  const anyInv = devs.length > 0
  const log = (state?.log ?? []) as unknown[]

  return (
    <Modal open={open} onClose={onClose} labelledBy="devTitle" wide>
      <div className="mb-4 flex items-center justify-between">
        <h3 id="devTitle" className="m-0 text-[15px] font-[640]">Devices</h3>
        <Button variant="outline" size="sm" onClick={refresh} disabled={busy} className="mr-8 font-mono">Refresh</Button>
      </div>

      {/* Inventory */}
      {GROUPS.map((g) => {
        const rows = devs.filter((d) => d.kind === g.kind)
        if (!rows.length) return null
        return (
          <div key={g.kind} className="mb-3">
            <div className="mb-1 font-mono text-[10px] font-[700] uppercase tracking-[0.06em] text-faint">{g.label}</div>
            {rows.map((d) => (
              <div key={d.kind + d.id + d.name} className="flex items-center gap-2 border-b border-border py-2 last:border-0">
                <Dot status={d.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{d.name}</div>
                  <div className={'truncate font-mono text-[11px] ' + (d.error ? 'text-destructive' : 'text-faint')}>{d.error || d.detail || d.status}</div>
                </div>
                {d.kind === 'printer' && d.id && (
                  <Button variant="ghost" size="xs" className="font-mono" onClick={() => testDevice(d)}>Test</Button>
                )}
              </div>
            ))}
          </div>
        )
      })}
      {!anyInv && <p className="text-sm text-muted-foreground">No devices found.</p>}

      {/* Niimbot printers */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[10px] font-[700] uppercase tracking-[0.06em] text-faint">Label printers (Niimbot)</span>
          <Button variant="outline" size="sm" onClick={scan} disabled={scanning} className="font-mono">
            {scanning ? 'Scanning…' : 'Scan for printers'}
          </Button>
        </div>
        {showAdapterWarn && <p className="mb-2 font-mono text-[11px] text-warn">No Bluetooth adapter detected.</p>}
        {printers.length === 0 && <p className="text-sm text-muted-foreground">No Niimbot printers yet. Tap “Scan for printers”.</p>}

        {printers.map((p) => {
          const conn = p.status === 'connected'
          const ds = dstatus[p.address]
          const stTxt = ds && ds.msg ? ds.msg : conn ? 'Connected' : 'Disconnected'
          const mm = p.label_mm || [12, 40]
          return (
            <div key={p.address} className="border-b border-border py-2 last:border-0">
              <div className="flex items-center gap-2">
                <Dot status={p.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{p.model_label || p.model}</div>
                  <div className="truncate font-mono text-[11px] text-faint">
                    {p.name} · <span className={ds?.cls === 'err' ? 'text-destructive' : ds?.cls === 'ok' ? 'text-primary' : ''}>{stTxt}</span>
                    {p.label_mm ? ` · ${p.label_mm[0]}×${p.label_mm[1]} mm` : ''}
                  </div>
                </div>
                <div className="flex flex-none gap-1">
                  {conn ? (
                    <>
                      <MiniBtn onClick={() => action('test', p)}>Test</MiniBtn>
                      <MiniBtn onClick={() => action('disconnect', p)}>Disconnect</MiniBtn>
                    </>
                  ) : (
                    <MiniBtn primary onClick={() => action('reconnect', p)}>Reconnect</MiniBtn>
                  )}
                  <MiniBtn active={editSize === p.address} onClick={() => setEditSize((a) => (a === p.address ? '' : p.address))}>Size</MiniBtn>
                  <MiniBtn active={logAddr === p.address} onClick={() => setLogAddr((a) => (a === p.address ? '' : p.address))}>Log</MiniBtn>
                  <MiniBtn onClick={() => action('forget', p)}>Forget</MiniBtn>
                </div>
              </div>
              {editSize === p.address && <SizeEditor w={mm[0]} h={mm[1]} onSave={(w, h) => saveSize(p, w, h)} onCancel={() => setEditSize('')} />}
              {logAddr === p.address && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-background p-2 font-mono text-[11px] text-muted-foreground">
                  {log.length === 0 ? 'No log yet.' : log.map((l, i) => <div key={i}>{typeof l === 'string' ? l : JSON.stringify(l)}</div>)}
                  <div className="mt-1 text-right">
                    <Button variant="link" size="xs" className="h-auto p-0 text-faint hover:text-destructive" onClick={() => nb.clearlog(p.address).then(setState).catch(() => {})}>clear</Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Scan candidates */}
        {candidates.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 font-mono text-[10px] font-[700] uppercase tracking-[0.06em] text-faint">Found</div>
            {candidates.map((c) => (
              <div key={c.address} className="flex items-center gap-2 border-b border-border py-2 last:border-0">
                <span className="h-[7px] w-[7px] flex-none rounded-full bg-warn" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{c.name}</div>
                  <div className="truncate font-mono text-[11px] text-faint">{c.address}{c.rssi != null ? ` · ${c.rssi} dBm` : ''}</div>
                </div>
                <MiniBtn primary onClick={() => connect(c)}>Connect</MiniBtn>
              </div>
            ))}
          </div>
        )}
      </div>

      {note && <p className={'mt-3 font-mono text-[12px] ' + (note.cls === 'err' ? 'text-destructive' : note.cls === 'ok' ? 'text-primary' : 'text-muted-foreground')}>{note.msg}</p>}
    </Modal>
  )
}

function MiniBtn({ children, onClick, primary, active }: { children: React.ReactNode; onClick: () => void; primary?: boolean; active?: boolean }) {
  return (
    <Button
      size="xs"
      variant={primary ? 'default' : active ? 'secondary' : 'ghost'}
      onClick={onClick}
      className="font-mono"
    >
      {children}
    </Button>
  )
}

function SizeEditor({ w, h, onSave, onCancel }: { w: number; h: number; onSave: (w: number, h: number) => void; onCancel: () => void }) {
  const [ww, setWw] = useState(String(w))
  const [hh, setHh] = useState(String(h))
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-background p-2">
      <span className="font-mono text-[11px] text-faint">Roll size</span>
      <Input type="number" min={5} max={120} value={ww} onChange={(e) => setWw(e.target.value)} aria-label="Width mm" className="h-8 w-16 font-mono text-[12px]" />
      <span className="text-faint">×</span>
      <Input type="number" min={5} max={300} value={hh} onChange={(e) => setHh(e.target.value)} aria-label="Length mm" className="h-8 w-16 font-mono text-[12px]" />
      <span className="font-mono text-[11px] text-faint">mm</span>
      <MiniBtn primary onClick={() => onSave(parseFloat(ww), parseFloat(hh))}>Save</MiniBtn>
      <MiniBtn onClick={onCancel}>Cancel</MiniBtn>
    </div>
  )
}

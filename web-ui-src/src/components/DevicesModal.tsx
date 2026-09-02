import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { devices as devApi, niimbot as nb, type Device, type NiimState, type NiimPrinter, type NiimCandidate } from '../api/client'

type DStatus = { msg: string; cls: '' | 'ok' | 'err' }

const GROUPS: { kind: string; label: string }[] = [
  { kind: 'printer', label: 'Printers' },
  { kind: 'scanner', label: 'Scanners' },
  { kind: 'usb', label: 'Other' },
]

function Dot({ status }: { status: string }) {
  const cls = status === 'error' ? 'bg-error' : status === 'connected' ? 'bg-primary' : 'bg-warning'
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
  const [loaded, setLoaded] = useState(false)

  const setDS = (addr: string, msg: string, cls: DStatus['cls'] = '') =>
    setDstatus((m) => ({ ...m, [addr]: { msg, cls } }))

  const reload = useCallback(() => {
    Promise.allSettled([
      devApi.list().then(setDevs),
      nb.state().then(setState),
    ]).then(() => setLoaded(true))
  }, [])

  useEffect(() => { if (open) { setLoaded(false); reload(); setCandidates([]); setNote(null) } }, [open, reload])

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
        <h3 id="devTitle" className="m-0 text-title font-[640]">Devices</h3>
        <div className="flex gap-2">
          <IconBtn title="Refresh devices" tip="bottom" onClick={refresh} disabled={busy}><Icon.refresh /></IconBtn>
          <IconBtn title="Close" tip="bottom" onClick={onClose}><Icon.close /></IconBtn>
        </div>
      </div>

      {!loaded && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <div className="skeleton h-[7px] w-[7px] flex-none rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-[13px] w-40 rounded" />
                <div className="skeleton mt-1 h-[11px] w-56 rounded" />
              </div>
              <div className="skeleton h-8 w-8 flex-none rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Inventory */}
      {loaded && GROUPS.map((g) => {
        const rows = devs.filter((d) => d.kind === g.kind)
        if (!rows.length) return null
        return (
          <div key={g.kind} className="mb-3">
            <div className="mb-1 field-label">{g.label}</div>
            {rows.map((d) => (
              <div key={d.kind + d.id + d.name} className="flex items-center gap-2 border-b border-base-300 py-2 last:border-0">
                <Dot status={d.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{d.name}</div>
                  <div className={'truncate font-mono text-2xs ' + (d.error ? 'text-error' : 'text-base-content/60')}>{d.error || d.detail || d.status}</div>
                </div>
                {d.kind === 'printer' && d.id && (
                  <IconBtn title="Print test page" onClick={() => testDevice(d)}><Icon.test /></IconBtn>
                )}
              </div>
            ))}
          </div>
        )
      })}
      {loaded && !anyInv && <p className="text-body text-base-content/60">No devices found.</p>}

      {/* Niimbot printers */}
      <div className={'mt-4 ' + (loaded ? '' : 'hidden')}>
        <div className="mb-1 flex items-center justify-between">
          <span className="field-label">Label printers (Niimbot)</span>
          <IconBtn title="Scan for Bluetooth printers" onClick={scan} disabled={scanning}>
            {scanning ? <span className="loading loading-spinner loading-xs" /> : <Icon.search />}
          </IconBtn>
        </div>
        {showAdapterWarn && <p className="mb-2 text-2xs text-warning">No Bluetooth adapter detected.</p>}
        {printers.length === 0 && <p className="text-body text-base-content/60">No Niimbot printers yet. Tap “Scan for printers”.</p>}

        {printers.map((p) => {
          const conn = p.status === 'connected'
          const ds = dstatus[p.address]
          const stTxt = ds && ds.msg ? ds.msg : conn ? 'Connected' : 'Disconnected'
          const mm = p.label_mm || [12, 40]
          return (
            <div key={p.address} className="border-b border-base-300 py-2 last:border-0">
              <div className="flex items-center gap-2">
                <Dot status={p.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{p.model_label || p.model}</div>
                  <div className="truncate font-mono text-2xs text-base-content/60">
                    {p.name} · <span className={ds?.cls === 'err' ? 'text-error' : ds?.cls === 'ok' ? 'text-primary' : ''}>{stTxt}</span>
                    {p.label_mm ? ` · ${p.label_mm[0]}×${p.label_mm[1]} mm` : ''}
                  </div>
                </div>
                <div className="flex flex-none gap-1">
                  {conn ? (
                    <>
                      <IconBtn title="Print test label" onClick={() => action('test', p)}><Icon.test /></IconBtn>
                      <IconBtn title="Disconnect" onClick={() => action('disconnect', p)}><Icon.disconnect /></IconBtn>
                    </>
                  ) : (
                    <IconBtn title="Reconnect" variant="primary" onClick={() => action('reconnect', p)}><Icon.reconnect /></IconBtn>
                  )}
                  <IconBtn title="Roll size" variant={editSize === p.address ? 'active' : undefined} onClick={() => setEditSize((a) => (a === p.address ? '' : p.address))}><Icon.size /></IconBtn>
                  <IconBtn title="Connection log" variant={logAddr === p.address ? 'active' : undefined} onClick={() => setLogAddr((a) => (a === p.address ? '' : p.address))}><Icon.log /></IconBtn>
                  <IconBtn title="Forget" onClick={() => action('forget', p)}><Icon.forget /></IconBtn>
                </div>
              </div>
              {editSize === p.address && <SizeEditor w={mm[0]} h={mm[1]} onSave={(w, h) => saveSize(p, w, h)} onCancel={() => setEditSize('')} />}
              {logAddr === p.address && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-base-200 p-2 font-mono text-2xs text-base-content/60">
                  {log.length === 0 ? 'No log yet.' : log.map((l, i) => <div key={i}>{typeof l === 'string' ? l : JSON.stringify(l)}</div>)}
                  <div className="mt-1 text-right">
                    <button type="button" onClick={() => nb.clearlog(p.address).then(setState).catch(() => {})} className="btn btn-link btn-xs h-auto min-h-0 p-0 text-base-content/60 hover:text-error">clear</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Scan candidates */}
        {candidates.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 field-label">Found</div>
            {candidates.map((c) => (
              <div key={c.address} className="flex items-center gap-2 border-b border-base-300 py-2 last:border-0">
                <span className="h-[7px] w-[7px] flex-none rounded-full bg-warning" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{c.name}</div>
                  <div className="truncate font-mono text-2xs text-base-content/60">{c.address}{c.rssi != null ? ` · ${c.rssi} dBm` : ''}</div>
                </div>
                <IconBtn title="Connect" variant="primary" onClick={() => connect(c)}><Icon.connect /></IconBtn>
              </div>
            ))}
          </div>
        )}
      </div>

      {note && <p className={'mt-3 text-xs ' + (note.cls === 'err' ? 'text-error' : note.cls === 'ok' ? 'text-primary' : 'text-base-content/60')}>{note.msg}</p>}
    </Modal>
  )
}

function MiniBtn({ children, onClick, primary, active }: { children: React.ReactNode; onClick: () => void; primary?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={'btn btn-xs ' + (primary ? 'btn-primary' : active ? 'btn-active' : 'btn-ghost')}
    >
      {children}
    </button>
  )
}

// Square icon button with a hover tooltip — keeps the device rows compact.
function IconBtn({ title, onClick, variant, disabled, tip = 'top', children }: { title: string; onClick: () => void; variant?: 'primary' | 'active'; disabled?: boolean; tip?: 'top' | 'bottom'; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={title}
      aria-label={title}
      className={`tooltip tooltip-${tip} btn btn-square btn-sm ` + (variant === 'primary' ? 'btn-primary' : variant === 'active' ? 'btn-active' : 'btn-ghost')}
    >
      {children}
    </button>
  )
}

const svg = (children: React.ReactNode) => () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const Icon = {
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
}

function SizeEditor({ w, h, onSave, onCancel }: { w: number; h: number; onSave: (w: number, h: number) => void; onCancel: () => void }) {
  const [ww, setWw] = useState(String(w))
  const [hh, setHh] = useState(String(h))
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-base-200 p-2">
      <span className="font-mono text-2xs text-base-content/60">Roll size</span>
      <input type="number" min={5} max={120} value={ww} onChange={(e) => setWw(e.target.value)} aria-label="Width mm" className="input input-sm w-16 font-mono" />
      <span className="text-base-content/60">×</span>
      <input type="number" min={5} max={300} value={hh} onChange={(e) => setHh(e.target.value)} aria-label="Length mm" className="input input-sm w-16 font-mono" />
      <span className="font-mono text-2xs text-base-content/60">mm</span>
      <MiniBtn primary onClick={() => onSave(parseFloat(ww), parseFloat(hh))}>Save</MiniBtn>
      <MiniBtn onClick={onCancel}>Cancel</MiniBtn>
    </div>
  )
}

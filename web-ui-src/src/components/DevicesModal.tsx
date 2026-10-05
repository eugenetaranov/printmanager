import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { IconBtn, Icon, Dot } from './IconBtn'
import { devices as devApi, niimbot as nb, type Device, type NiimState, type NiimPrinter, type NiimCandidate } from '../api/client'

type DStatus = { msg: string; cls: '' | 'ok' | 'err' }

const GROUPS: { kind: string; label: string }[] = [
  { kind: 'printer', label: 'Printers' },
  { kind: 'scanner', label: 'Scanners' },
  { kind: 'usb', label: 'Other' },
]

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

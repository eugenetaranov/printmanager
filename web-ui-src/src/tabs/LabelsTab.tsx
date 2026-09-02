import { useEffect, useMemo, useState } from 'react'
import { devices as devApi, niimbot as nb, templates as tplApi, type Device, type NiimState, type Template } from '../api/client'
import { useNote, Note } from '../components/Note'
import { Modal } from '../components/Modal'
import { NiimbotComposer } from '../components/NiimbotComposer'
import { SheetComposer } from '../components/SheetComposer'
import { ManageLabels } from '../components/ManageLabels'
import { formatOptions, type FormatOption, type ThermalFormat } from '../lib/formats'

const STORE_KEY = 'pm_format'

export function LabelsTab() {
  const { note, ok, err, info } = useNote()
  const [templates, setTemplates] = useState<Template[]>([])
  const [devs, setDevs] = useState<Device[]>([])
  const [state, setState] = useState<NiimState | null>(null)
  const [formatV, setFormatV] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [conn, setConn] = useState<{ fmt: ThermalFormat; status: 'connecting' | 'ok' | 'err'; msg: string; then?: () => void } | null>(null)

  const loadTemplates = () => tplApi.list().then(setTemplates).catch(() => {})

  useEffect(() => {
    Promise.allSettled([
      tplApi.list().then(setTemplates),
      devApi.list().then(setDevs),
      nb.state().then(setState),
    ]).then(() => setLoaded(true))
  }, [])

  const opts = useMemo(() => formatOptions(templates, state?.printers ?? [], devs), [templates, state, devs])

  // Pick persisted format or the first available, once options are known.
  useEffect(() => {
    if (!opts.length) return
    const saved = (() => { try { return localStorage.getItem(STORE_KEY) || '' } catch { return '' } })()
    setFormatV((cur) => (opts.some((o) => o.v === cur) ? cur : opts.some((o) => o.v === saved) ? saved : opts[0].v))
  }, [opts])

  const format: FormatOption | undefined = opts.find((o) => o.v === formatV)

  const selectFormat = (v: string) => {
    setFormatV(v)
    try { localStorage.setItem(STORE_KEY, v) } catch { /* ignore */ }
    const o = opts.find((x) => x.v === v)
    if (o?.kind === 'thermal') {
      nb.select(o.address).catch(() => {})
      if (!o.connected) ensureConnected(o)
    }
  }

  const ensureConnected = (fmt: ThermalFormat, then?: () => void) => {
    if (fmt.connected) { then?.(); return }
    setConn({ fmt, status: 'connecting', msg: 'Connecting…', then })
    nb.reconnect(fmt.address)
      .then((r) => {
        if (r.ok) {
          setState(r)
          setConn((c) => (c ? { ...c, status: 'ok', msg: 'Connected' } : c))
          then?.()
          window.setTimeout(() => setConn((c) => (c?.fmt.address === fmt.address ? null : c)), 550)
        } else {
          setConn((c) => (c ? { ...c, status: 'err', msg: r.error || 'Couldn’t connect. Is the printer on and in range?' } : c))
        }
      })
      .catch(() => setConn((c) => (c ? { ...c, status: 'err', msg: 'Couldn’t connect. Is the printer on and in range?' } : c)))
  }

  const activeTemplate = format?.kind === 'a4' ? templates.find((t) => t.id === format.tplId) : undefined

  return (
    <div className="card mx-auto w-full max-w-[600px] border border-base-300 bg-base-100 p-5 shadow-sm">
      {!loaded ? (
        <div>
          <div className="mb-4 flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-[6px]">
              <div className="skeleton h-[13px] w-24 rounded" />
              <div className="skeleton h-10 w-full rounded" />
            </div>
            <div className="skeleton h-10 w-28 rounded" />
          </div>
          <div className="skeleton mt-3 h-8 w-48 rounded" />
          <div className="skeleton mt-3 h-24 w-full rounded" />
          <div className="skeleton mt-4 h-11 w-full rounded" />
        </div>
      ) : opts.length === 0 ? (
        <p className="text-body text-base-content/60">No printers yet. Open the Devices manager (the printer icon, top-right) to connect one.</p>
      ) : (
        <>
          <div className="mb-4 flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-[6px]">
              <span className="field-label">Label format</span>
              <select value={formatV} onChange={(e) => selectFormat(e.target.value)} className="select w-full font-mono">
                {opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setManageOpen(true)} title="Add, edit or delete A4 label sizes" className="btn btn-outline">
              Manage labels
            </button>
          </div>

          {format?.kind === 'thermal' && (
            <NiimbotComposer
              format={format}
              onNote={(k, m) => (k === 'ok' ? ok(m) : k === 'err' ? err(m) : info(m))}
              onEnsureConnected={ensureConnected}
            />
          )}
          {format?.kind === 'a4' && activeTemplate && (
            <SheetComposer format={format} template={activeTemplate} onNote={(k, m) => (k === 'ok' ? ok(m) : k === 'err' ? err(m) : info(m))} />
          )}

          <Note note={note} />
        </>
      )}

      {/* Connect-on-demand modal for an offline thermal printer */}
      <Modal open={!!conn} onClose={() => setConn(null)} labelledBy="connName">
        {conn && (
          <div className="text-center">
            <div id="connName" className="text-title font-[640]">{conn.fmt.name}</div>
            <div className="mt-1 font-mono text-xs text-base-content/60">{conn.fmt.w}×{conn.fmt.h} mm</div>
            <div className={'mt-3 text-body ' + (conn.status === 'err' ? 'text-error' : conn.status === 'ok' ? 'text-primary' : 'text-base-content/60')}>{conn.msg}</div>
            <div className="mt-4 flex justify-center gap-2">
              {conn.status === 'err' && (
                <button type="button" onClick={() => ensureConnected(conn.fmt, conn.then)} className="btn btn-primary btn-sm">Try again</button>
              )}
              <button type="button" onClick={() => setConn(null)} className="btn btn-ghost btn-sm">Compose anyway</button>
            </div>
          </div>
        )}
      </Modal>

      <ManageLabels open={manageOpen} onClose={() => setManageOpen(false)} templates={templates} onChanged={loadTemplates} />
    </div>
  )
}

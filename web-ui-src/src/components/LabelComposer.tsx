import { useEffect, useMemo, useState } from 'react'
import { api, niimbot as nb, templates as tplApi, type NiimPrinter, type Template } from '../api/client'
import { useNote, Note } from './Note'
import { Modal } from './Modal'
import { NiimbotComposer } from './NiimbotComposer'
import { SheetComposer } from './SheetComposer'
import { ManageLabels } from './ManageLabels'
import { formatOptions, type FormatOption, type ThermalFormat } from '../lib/formats'

const STORE_KEY = 'pm_format'

// The Queue tab's Customize section (formerly the Labels tab): pick any label
// format — a Niimbot roll or an A4 sheet template — and design one label with
// a live preview. `printers` comes from the queue poll, so connection state is
// live; `onConnected` asks the queue to re-poll after a reconnect.
export function LabelComposer({ printers, onConnected }: { printers: NiimPrinter[]; onConnected: () => void }) {
  const { note, ok, err, info } = useNote()
  const [templates, setTemplates] = useState<Template[]>([])
  const [queues, setQueues] = useState<string[]>([])
  const [formatV, setFormatV] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [conn, setConn] = useState<{ fmt: ThermalFormat; status: 'connecting' | 'ok' | 'err'; msg: string; then?: () => void } | null>(null)

  const loadTemplates = () => tplApi.list().then(setTemplates).catch(() => {})

  useEffect(() => {
    // Only the cached CUPS queue list is needed here — not the full device
    // inventory (uncached lpstat + cold scanimage -L).
    Promise.allSettled([
      tplApi.list().then(setTemplates),
      api.queues().then((r) => setQueues(r.queues.map((q) => q.queue))),
    ]).then(() => setLoaded(true))
  }, [])

  const opts = useMemo(() => formatOptions(templates, printers, queues), [templates, printers, queues])

  // Pick the persisted format, else the active label printer, else the first.
  useEffect(() => {
    if (!opts.length) return
    const saved = (() => { try { return localStorage.getItem(STORE_KEY) || '' } catch { return '' } })()
    const active = printers.find((p) => p.active)
    const fallback = active ? 'niim:' + active.address : opts[0].v
    setFormatV((cur) => (opts.some((o) => o.v === cur) ? cur : opts.some((o) => o.v === saved) ? saved : fallback))
  }, [opts, printers])

  const format: FormatOption | undefined = opts.find((o) => o.v === formatV)

  const selectFormat = (v: string) => {
    setFormatV(v)
    try { localStorage.setItem(STORE_KEY, v) } catch { /* ignore */ }
    const o = opts.find((x) => x.v === v)
    if (o?.kind === 'thermal') {
      // Also makes it the quick-add printer above.
      nb.select(o.address).then(onConnected).catch(() => {})
      if (!o.connected) ensureConnected(o)
    }
  }

  const ensureConnected = (fmt: ThermalFormat, then?: () => void) => {
    if (fmt.connected) { then?.(); return }
    setConn({ fmt, status: 'connecting', msg: 'Connecting…', then })
    nb.reconnect(fmt.address)
      .then((r) => {
        if (r.ok) {
          onConnected()
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
  const onNote = (k: '' | 'ok' | 'err', m: string) => (k === 'ok' ? ok(m) : k === 'err' ? err(m) : info(m))

  return (
    <div>
      {!loaded ? (
        <div>
          <div className="mb-4 flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-[6px]">
              <div className="skeleton h-[13px] w-24 rounded" />
              <div className="skeleton h-10 w-full rounded" />
            </div>
          </div>
          <div className="skeleton mt-3 h-8 w-48 rounded" />
          <div className="skeleton mt-3 h-24 w-full rounded" />
        </div>
      ) : opts.length === 0 ? (
        <p className="text-body text-base-content/60">No printers yet. Open the Devices manager (the printer icon, top-right) to connect one.</p>
      ) : (
        <>
          <label className="mb-1 flex flex-col gap-[6px]">
            <span className="field-label">Label format</span>
            <select value={formatV} onChange={(e) => selectFormat(e.target.value)} className="select w-full font-mono">
              {opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </label>

          {format?.kind === 'thermal' && (
            <NiimbotComposer format={format} onNote={onNote} onEnsureConnected={ensureConnected} />
          )}
          {format?.kind === 'a4' && activeTemplate && (
            <SheetComposer format={format} template={activeTemplate} onNote={onNote} />
          )}

          <Note note={note} />

          <button type="button" onClick={() => setManageOpen(true)} className="btn btn-ghost btn-sm mt-3 px-2 text-base-content/60 pointer-coarse:h-11">
            Manage A4 label sizes
          </button>
        </>
      )}

      {/* Connect-on-demand modal for an offline thermal printer */}
      <Modal open={!!conn} onClose={() => setConn(null)} labelledBy="connName">
        {conn && (
          <div className="text-center">
            <div id="connName" className="text-title font-semibold">{conn.fmt.name}</div>
            <div className="mt-1 font-mono text-xs text-base-content/60">{conn.fmt.w}×{conn.fmt.h} mm</div>
            <div className={'mt-3 text-body ' + (conn.status === 'err' ? 'text-error' : conn.status === 'ok' ? 'text-primary' : 'text-base-content/60')}>{conn.msg}</div>
            <div className="mt-4 flex justify-center gap-2">
              {conn.status === 'err' && (
                <button type="button" onClick={() => ensureConnected(conn.fmt, conn.then)} className="btn btn-primary btn-sm pointer-coarse:h-11">Try again</button>
              )}
              <button type="button" onClick={() => setConn(null)} className="btn btn-ghost btn-sm pointer-coarse:h-11">Compose anyway</button>
            </div>
          </div>
        )}
      </Modal>

      <ManageLabels open={manageOpen} onClose={() => setManageOpen(false)} templates={templates} onChanged={loadTemplates} />
    </div>
  )
}

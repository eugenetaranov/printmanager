import { useEffect, useRef, useState } from 'react'
import { api, niimbot as nb, printQueue, type NiimPrinter, type Queue, type QueueItem, type QueueTarget } from '../api/client'
import { useNote, Note } from '../components/Note'
import { useQueue } from '../components/QueueContext'
import { readImageB64 } from '../lib/formats'
import { IconBtn, Icon, Dot } from '../components/IconBtn'

// Stage shipment numbers (or a PDF/image) while the printers are off, then
// release everything with one Print all. Items live on the Pi, so a number
// pasted on the phone can be printed from any device.

const targetKey = (t: QueueTarget) => (t.type === 'label' ? 'label:' + t.address : 'a4:' + t.queue)

function age(created: number) {
  const s = Math.max(0, Date.now() / 1000 - created)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export function QueueTab() {
  const { state, loaded, refresh } = useQueue()
  const { note, ok: okNote, err, clear } = useNote()
  // Success notes are transient: the list itself shows what's queued, and a
  // lingering "Added 1" next to an emptied (printed) queue reads as a bug.
  const okTimer = useRef<number | undefined>(undefined)
  const ok = (msg: string) => {
    okNote(msg)
    window.clearTimeout(okTimer.current)
    okTimer.current = window.setTimeout(clear, 4000)
  }
  useEffect(() => () => window.clearTimeout(okTimer.current), [])
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [labelPrinters, setLabelPrinters] = useState<NiimPrinter[]>([])
  const [queues, setQueues] = useState<Queue[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  // Per-printer connect attempt: address -> 'busy' | error message.
  const [connecting, setConnecting] = useState<Record<string, string>>({})

  useEffect(() => {
    nb.state(false).then((s) => setLabelPrinters(s.printers ?? [])).catch(() => {})
    api.queues().then((d) => setQueues(d.queues)).catch(() => {})
  }, [])

  const items = state.items
  const pending = items.filter((i) => i.state !== 'printing').length
  const failed = items.some((i) => i.state === 'failed')

  const addText = () => {
    if (!text.trim() || adding) return
    setAdding(true)
    clear()
    printQueue.addText(text)  // server defaults to the label printer used last
      .then((r) => {
        if (r.ok) { setText(''); ok(`Added ${r.added} to the queue.`) }
        else err(r.error || 'Could not add to the queue.')
        return refresh()
      })
      .catch(() => err('Could not reach the print service.'))
      .finally(() => setAdding(false))
  }

  const addFile = (f?: File | null) => {
    if (!f || adding) return
    setAdding(true)
    clear()
    readImageB64(f)
      .then(({ b64 }) => printQueue.addFile(b64, f.name || 'pasted image'))
      .then((r) => {
        if (r.ok) ok(`Added ${f.name || 'image'} to the queue.`)
        else err(r.error || 'Could not add the file.')
        return refresh()
      })
      .catch(() => err('Could not read the file.'))
      .finally(() => {
        setAdding(false)
        if (fileInput.current) fileInput.current.value = ''
      })
  }

  // A pasted screenshot (desktop, Android) goes straight in as a file item.
  // Pasted text is left to the textarea.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith('image/'))
      const f = item?.getAsFile()
      if (f) { e.preventDefault(); addFile(f) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = (p: Promise<{ ok: boolean; error?: string }>) =>
    p.then((r) => { if (!r.ok) err(r.error || 'Something went wrong.'); return refresh() })
      .catch(() => err('Could not reach the print service.'))

  // Same reconnect the Devices page uses (it also follows a D110 whose BLE
  // address rotated).
  const connect = (address: string) => {
    setConnecting((c) => ({ ...c, [address]: 'busy' }))
    nb.reconnect(address)
      .then((r) => {
        setConnecting((c) => ({ ...c, [address]: r.ok ? '' : 'Couldn’t connect. Is it on and in range?' }))
        return refresh()
      })
      .catch(() => setConnecting((c) => ({ ...c, [address]: 'Could not reach the print service.' })))
  }

  const release = () => { clear(); run(printQueue.release()) }
  const stop = () => run(printQueue.stop())

  const targetOptions: { key: string; target: QueueTarget; label: string }[] = [
    ...labelPrinters.map((p) => ({
      key: 'label:' + p.address,
      target: { type: 'label' as const, address: p.address },
      label: `${p.model_label || p.model} · ${(p.label_mm || [])[0] ?? '?'}×${(p.label_mm || [])[1] ?? '?'} mm`,
    })),
    ...queues.map((q) => ({ key: 'a4:' + q.queue, target: { type: 'a4' as const, queue: q.queue }, label: `${q.name} · A4` })),
  ]

  return (
    <div className="card mx-auto w-full max-w-[600px] border border-base-300 bg-base-100 p-5 shadow-sm">
      {/* Add */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFile(e.dataTransfer.files?.[0]) }}
        className={'rounded-xl border-2 border-dashed p-3 transition-colors ' + (dragOver ? 'border-primary bg-primary/10' : 'border-base-300')}
      >
        <label className="flex flex-col gap-[6px]">
          <span className="field-label">Add to queue</span>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addText() }}
            placeholder={'Paste shipment numbers, one per line'}
            className="textarea w-full font-mono"
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={adding} className="btn btn-ghost btn-sm">
            Choose file
          </button>
          <button type="button" onClick={addText} disabled={!text.trim() || adding} className="btn btn-primary btn-sm">
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/*,text/plain,.txt"
          className="hidden"
          onChange={(e) => addFile(e.target.files?.[0])}
        />
        <p className="mt-2 text-2xs text-base-content/60">Numbers print on your label printer. PDFs and images print on A4. Unprinted items are removed after 7 days.</p>
      </div>

      {/* Items */}
      <div className="mt-5 mb-2 flex items-baseline justify-between">
        <span className="field-label">Waiting</span>
        <span className="font-mono text-xs tabular-nums text-base-content/60">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
      </div>
      {!loaded ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-14 w-full rounded-lg" />
          <div className="skeleton h-14 w-full rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        <>
          {state.message && <p aria-live="polite" className="m-0 pt-1 text-body text-primary">{state.message}</p>}
          <p className="py-3 text-body text-base-content/60">Nothing queued. Paste numbers above to print them later.</p>
        </>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <ItemRow key={it.id} item={it} options={targetOptions} busy={state.running} onChange={run} />
          ))}
        </ul>
      )}

      {/* Release */}
      {items.length > 0 && (
        <>
          {state.targets.length > 0 && (
            <div className="mt-4">
              <span className="field-label">Printers</span>
              {state.targets.map((t) => {
                const c = connecting[t.id] || ''
                const canConnect = t.type === 'label' && !t.ready && !state.running
                const stTxt = c === 'busy' ? 'Connecting…'
                  : t.ready ? (t.type === 'label' ? 'Connected' : 'On')
                  : t.type === 'label' ? 'Disconnected' : 'Off — switch it on'
                return (
                  <div key={t.type + t.id} className="border-b border-base-300 py-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <Dot status={t.ready ? 'connected' : 'disconnected'} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body">{t.name}</div>
                        <div className="truncate font-mono text-2xs text-base-content/60">
                          {c && c !== 'busy' && canConnect ? <span className="text-error">{c}</span> : stTxt}
                        </div>
                      </div>
                      {canConnect && (
                        <IconBtn title="Reconnect" variant="primary" onClick={() => connect(t.id)} disabled={c === 'busy'}>
                          {c === 'busy' ? <span className="loading loading-spinner loading-xs" /> : <Icon.reconnect />}
                        </IconBtn>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <hr className="my-4 border-t border-base-300" />
          <div className="flex items-center justify-between gap-3">
            <p aria-live="polite" className="m-0 min-w-0 text-xs text-base-content/60">
              {state.message || (!state.running && state.targets.some((t) => !t.ready)
                ? 'Switch the printer on, then Print all.'
                : '')}
            </p>
            <div className="flex flex-none gap-2">
              {state.running ? (
                <>
                  <button type="button" onClick={stop} className="btn btn-ghost btn-sm">Stop</button>
                  <button type="button" disabled className="btn btn-primary btn-sm">
                    <span className="loading loading-spinner loading-xs" />Printing
                  </button>
                </>
              ) : (
                <button type="button" onClick={release} disabled={pending === 0} className="btn btn-primary btn-sm">
                  {failed ? `Resume (${pending})` : `Print all (${pending})`}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <Note note={note} />
    </div>
  )
}

function ItemRow({
  item,
  options,
  busy,
  onChange,
}: {
  item: QueueItem
  options: { key: string; target: QueueTarget; label: string }[]
  busy: boolean
  onChange: (p: Promise<{ ok: boolean; error?: string }>) => void
}) {
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const armTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(armTimer.current), [])

  const printing = item.state === 'printing'
  const locked = printing || busy
  const isText = item.kind === 'text'
  const opts = isText ? options : options.filter((o) => o.target.type === 'a4')
  const current = opts.find((o) => o.key === targetKey(item.target))
  const where = current?.label.split(' · ')[0] ?? (item.target.type === 'label' ? item.target.name || 'Label printer' : item.target.queue)

  const onRemove = () => {
    if (!armed) {
      setArmed(true)
      window.clearTimeout(armTimer.current)
      armTimer.current = window.setTimeout(() => setArmed(false), 3000)
      return
    }
    setArmed(false)
    onChange(printQueue.remove(item.id))
  }

  const setCopies = (n: number) => onChange(printQueue.update(item.id, { copies: Math.max(1, Math.min(20, n)) }))

  return (
    <li className={'rounded-lg border p-2 ' + (item.state === 'failed' ? 'border-error' : 'border-base-300')}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 flex-none items-center justify-center">
          {printing ? (
            <span className="loading loading-spinner loading-sm text-primary" aria-label="Printing" />
          ) : item.state === 'failed' ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-error text-error-content" aria-label="Failed">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 6v8M12 18h.01" /></svg>
            </span>
          ) : (
            <span className="h-5 w-5 rounded-full border-2 border-dashed border-base-300" aria-label="Waiting" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-body text-base-content">{isText ? item.text : item.filename}</div>
          <div className="truncate font-mono text-2xs text-base-content/60">
            {where}
            {item.barcode ? ' · barcode' : ''}
            {item.copies > 1 ? ` · ×${item.copies}` : ''}
            {item.pages ? ` · ${item.pages} p` : ''}
            {' · '}{age(item.created)}
          </div>
        </div>
        <div className="flex flex-none gap-1">
          <IconBtn title="Printer & copies" variant={open ? 'active' : undefined} onClick={() => setOpen((o) => !o)} disabled={locked}><Icon.edit /></IconBtn>
          <IconBtn title={armed ? 'Click again to remove' : 'Remove'} variant={armed ? 'danger' : undefined} onClick={onRemove} disabled={locked}><Icon.forget /></IconBtn>
        </div>
      </div>
      {item.state === 'failed' && item.error && <p className="m-0 mt-1 pl-8 text-xs text-error">{item.error}</p>}

      {open && !locked && (
        <div className="mt-3 flex flex-col gap-3 border-t border-base-300 pt-3">
          <label className="flex flex-col gap-[6px]">
            <span className="field-label">Printer</span>
            <select
              value={current?.key ?? ''}
              onChange={(e) => {
                const o = opts.find((x) => x.key === e.target.value)
                if (o) onChange(printQueue.update(item.id, { target: o.target }))
              }}
              className="select select-sm w-full font-mono"
            >
              {!current && <option value="">{where}</option>}
              {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <div className="flex items-end justify-between gap-3">
            {isText ? (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={item.barcode}
                  onChange={(e) => onChange(printQueue.update(item.id, { barcode: e.target.checked }))}
                />
                <span className="text-body">Barcode</span>
              </label>
            ) : <span />}
            <div className="flex flex-col items-end gap-[6px]">
              <span className="field-label">Copies</span>
              <div className="join">
                <button type="button" onClick={() => setCopies(item.copies - 1)} disabled={item.copies <= 1} aria-label="Fewer copies" className="btn btn-sm btn-square join-item"><Icon.minus /></button>
                <span className="join-item flex h-8 w-9 items-center justify-center border-y border-base-300 font-mono text-body tabular-nums">{item.copies}</span>
                <button type="button" onClick={() => setCopies(item.copies + 1)} disabled={item.copies >= 20} aria-label="More copies" className="btn btn-sm btn-square join-item"><Icon.connect /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, niimbot as nb, printQueue, type NiimPrinter, type Queue, type QueueItem, type QueueTarget } from '../api/client'
import { useNote, Note } from '../components/Note'
import { useQueue } from '../components/QueueContext'
import { LabelComposer } from '../components/LabelComposer'
import { readImageB64 } from '../lib/formats'
import { IconBtn, Icon, Dot } from '../components/IconBtn'

// The label home. Paste shipment numbers and either print them now (printer
// connected) or stage them while the printers are off and release everything
// later with Print all. Items live on the Pi, so a number pasted on the phone
// can be printed from any device. Customize opens the full label composer
// (formats, QR/image, preview, A4 sheets) in place of the quick box.

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
  // Errors from the list (remove, edit, Print all) show by the list, not up at quick add.
  const { note: listNote, err: listErr, clear: listClear } = useNote()
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [queues, setQueues] = useState<Queue[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  // Per-printer connect attempt: address -> 'busy' | error message.
  const [connecting, setConnecting] = useState<Record<string, string>>({})
  const [customize, setCustomize] = useState(false)
  const customizeRef = useRef(false)
  customizeRef.current = customize

  useEffect(() => {
    api.queues().then((d) => setQueues(d.queues)).catch(() => {})
  }, [])

  // Label printers ride along on the 3 s queue poll, so connection state is live.
  const labels = state.labels
  const labelPrinters: NiimPrinter[] = useMemo(() => (labels ?? []).map((l) => ({
    address: l.address,
    name: l.name,
    status: l.connected ? 'connected' : 'disconnected',
    label_mm: (l.label_mm.length === 2 ? l.label_mm : undefined) as [number, number] | undefined,
    model: l.model,
    model_label: l.model_label,
    active: l.active,
  })), [labels])
  // Quick add goes to the active label printer (the one that printed last).
  const quick = labels?.find((l) => l.active) ?? labels?.[0]
  const canPrintNow = !!quick?.connected && !state.running

  const items = state.items
  const pending = items.filter((i) => i.state !== 'printing').length
  const failed = items.some((i) => i.state === 'failed')

  // Print now = add, then release just the new items (not the whole queue),
  // so it shares the worker's reconnect, copies and failed-item handling.
  const addText = (printNow = false) => {
    if (!text.trim() || adding) return
    setAdding(true)
    clear()
    const target: QueueTarget | undefined = quick ? { type: 'label', address: quick.address } : undefined
    printQueue.addText(text, target)  // no label printer: the server falls back to A4
      .then(async (r) => {
        if (!r.ok) { err(r.error || 'Could not add to the queue.'); return refresh() }
        setText('')
        if (printNow && r.ids?.length) {
          const rel = await printQueue.release(r.ids)
          if (!rel.ok) err(rel.error || 'Added, but could not start printing.')
        } else ok(`Added ${r.added} to the queue.`)
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
      // While Customize is open, its composer takes the pasted image instead.
      if (f && !customizeRef.current) { e.preventDefault(); addFile(f) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = (p: Promise<{ ok: boolean; error?: string }>) =>
    p.then((r) => { if (!r.ok) listErr(r.error || 'Something went wrong.'); return refresh() })
      .catch(() => listErr('Could not reach the print service.'))

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

  // The quick-add printer already has its row (and Reconnect) at the top.
  const otherTargets = state.targets.filter((t) => !(t.type === 'label' && t.id === quick?.address))

  const switchPrinter = (address: string) => { nb.select(address).then(refresh).catch(() => {}) }

  const release = () => { listClear(); run(printQueue.release()) }
  const stop = () => run(printQueue.stop())

  const targetOptions: { key: string; target: QueueTarget; label: string }[] = [
    ...labelPrinters.map((p) => ({
      key: 'label:' + p.address,
      target: { type: 'label' as const, address: p.address },
      label: `${p.model_label || p.model} · ${(p.label_mm || [])[0] ?? '?'}×${(p.label_mm || [])[1] ?? '?'} mm`,
    })),
    ...queues.map((q) => ({ key: 'a4:' + q.queue, target: { type: 'a4' as const, queue: q.queue }, label: `${q.name} · A4` })),
  ]

  const statusOf = (address: string, connected: boolean) => {
    const c = connecting[address] || ''
    return c === 'busy' ? { text: 'Connecting…', err: false, busy: true }
      : c ? { text: c, err: true, busy: false }
      : { text: connected ? 'Connected' : 'Not connected', err: false, busy: false }
  }
  const mm = (l: number[] | undefined) => `${(l ?? [])[0] ?? '?'}×${(l ?? [])[1] ?? '?'} mm`
  const canAdd = !!text.trim() && !adding
  const btn = 'btn btn-sm pointer-coarse:h-11'

  return (
    <div className="card w-full border border-base-300 bg-base-100 p-4 sm:p-5">
      {/* Label printer: where quick add goes, with a one-tap Bluetooth reconnect. */}
      {quick && (() => {
        const st = statusOf(quick.address, quick.connected)
        return (
          <PrinterRow
            connected={quick.connected}
            name={labelPrinters.length > 1 ? (
              <select
                aria-label="Label printer"
                value={quick.address}
                onChange={(e) => switchPrinter(e.target.value)}
                disabled={state.running}
                className="select select-ghost -ml-1 h-auto min-h-0 w-auto max-w-full py-0 pr-7 pl-1 font-mono [--font-size:0.8125rem]"
              >
                {labelPrinters.map((p) => (
                  <option key={p.address} value={p.address}>{p.model_label || p.name} · {mm(p.label_mm)}</option>
                ))}
              </select>
            ) : <span className="font-mono">{quick.model_label || quick.name} · {mm(quick.label_mm)}</span>}
            status={st.text}
            statusErr={st.err}
            reconnect={state.running ? undefined : { busy: st.busy, onClick: () => connect(quick.address) }}
          />
        )
      })()}

      {/* Quick add. The whole section is a drop target; the outline only
          appears while a file is dragged over it. */}
      {!customize && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFile(e.dataTransfer.files?.[0]) }}
          className={'mt-4 rounded-box outline-2 outline-offset-4 transition-[outline-color] ' + (dragOver ? 'outline-dashed outline-primary' : 'outline-transparent')}
        >
          <label className="flex flex-col gap-[6px]">
            <span className="field-label">Add a label</span>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addText(canPrintNow) }}
              placeholder={'Paste shipment numbers, one per line\n\nOr a number + what it is,\na blank line before the next'}
              className="textarea w-full font-mono"
            />
          </label>
          {/* Phone: the main action full-width on top, the rest in a row below. */}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={adding} className={btn + ' btn-ghost sm:mr-auto'}>
              Choose file
            </button>
            {/* Printer connected: printing is the likelier intent, so it leads. */}
            {canPrintNow ? (
              <>
                <button type="button" onClick={() => addText(false)} disabled={!canAdd} className={btn + ' btn-outline'}>
                  Add to queue
                </button>
                <button type="button" onClick={() => addText(true)} disabled={!canAdd} className={btn + ' btn-primary order-first col-span-2 sm:order-none'}>
                  {adding ? 'Sending…' : 'Print now'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => addText(false)} disabled={!canAdd} className={btn + ' btn-primary'}>
                {adding ? 'Adding…' : 'Add to queue'}
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,image/*,text/plain,.txt"
            className="hidden"
            onChange={(e) => addFile(e.target.files?.[0])}
          />
          <Note note={note} />
          <p className="mt-2 text-2xs text-base-content/60">A blank line starts the next label; a plain list adds one per number. Files print on A4. Unprinted items are removed after 7 days.</p>
        </div>
      )}

      {/* Customize: one disclosure row; open, it swaps the paste box for the composer. */}
      <button
        type="button"
        aria-expanded={customize}
        aria-controls="customizePanel"
        onClick={() => setCustomize((c) => !c)}
        className={'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-field px-1 text-left text-body hover:bg-base-200 ' + (customize ? 'mt-3' : 'mt-3 border-t border-base-300 pt-1')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={'flex-none text-base-content/60 transition-transform ' + (customize ? 'rotate-90' : '')}><path d="m9 6 6 6-6 6" /></svg>
        <span className="flex-none font-[600]">Customize a label</span>
        <span className="min-w-0 truncate text-xs text-base-content/60">{customize ? 'back to quick add' : 'QR, image, preview, A4 sheets'}</span>
      </button>
      {customize && (
        <div id="customizePanel" className="mt-2">
          <LabelComposer printers={labelPrinters} onConnected={refresh} />
        </div>
      )}

      {/* Items */}
      <div className="mt-6 mb-2 flex items-baseline justify-between">
        <span className="field-label">Waiting</span>
        <span className="font-mono text-xs tabular-nums text-base-content/60">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
      </div>
      {!loaded ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-14 w-full rounded-box" />
          <div className="skeleton h-14 w-full rounded-box" />
        </div>
      ) : items.length === 0 ? (
        <>
          {state.message && <p aria-live="polite" className="m-0 pt-1 text-body text-primary">{state.message}</p>}
          <p className="py-3 text-body text-base-content/60">Nothing waiting. Paste numbers above to print them now or later.</p>
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
          {otherTargets.length > 0 && (
            <div className="mt-4">
              <span className="field-label">Printers</span>
              {otherTargets.map((t) => {
                const label = t.type === 'label'
                const st = label ? statusOf(t.id, t.ready) : { text: t.ready ? 'On' : 'Off — switch it on', err: false, busy: false }
                return (
                  <PrinterRow
                    key={t.type + t.id}
                    connected={t.ready}
                    name={t.name}
                    status={st.text}
                    statusErr={st.err}
                    reconnect={label && !t.ready && !state.running ? { busy: st.busy, onClick: () => connect(t.id) } : undefined}
                  />
                )
              })}
            </div>
          )}
          <hr className="my-4 border-t border-base-300" />
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            <p aria-live="polite" className="m-0 min-w-0 flex-1 basis-48 text-xs text-base-content/60">
              {state.message || (!state.running && state.targets.some((t) => !t.ready)
                ? 'Switch the printer on, then Print all.'
                : '')}
            </p>
            <div className="flex flex-none gap-2 max-sm:w-full">
              {state.running ? (
                <>
                  <button type="button" onClick={stop} className={btn + ' btn-ghost max-sm:flex-1'}>Stop</button>
                  <button type="button" disabled className={btn + ' btn-primary max-sm:flex-1'}>
                    <span className="loading loading-spinner loading-xs" />Printing
                  </button>
                </>
              ) : (
                <button type="button" onClick={release} disabled={pending === 0} className={btn + ' btn-primary max-sm:flex-1'}>
                  {failed ? `Resume (${pending})` : `Print all (${pending})`}
                </button>
              )}
            </div>
          </div>
          <Note note={listNote} />
        </>
      )}
    </div>
  )
}

// One printer line, the same everywhere on this tab: dot, name, a plain status
// sentence, and Reconnect — a labelled button when disconnected (touch has no
// tooltips), a small icon when connected (a BLE link can be stale).
function PrinterRow({ connected, name, status, statusErr, reconnect }: {
  connected: boolean
  name: ReactNode
  status: string
  statusErr?: boolean
  reconnect?: { busy: boolean; onClick: () => void }
}) {
  return (
    <div className="flex min-h-11 items-center gap-2 border-b border-base-300 py-1.5 last:border-0">
      <Dot status={connected ? 'connected' : 'disconnected'} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body">{name}</div>
        <div aria-live="polite" className={'truncate text-2xs ' + (statusErr ? 'text-error' : 'text-base-content/60')}>{status}</div>
      </div>
      {reconnect && (connected ? (
        <IconBtn title="Reconnect" onClick={reconnect.onClick} disabled={reconnect.busy}>
          {reconnect.busy ? <span className="loading loading-spinner loading-xs" /> : <Icon.reconnect />}
        </IconBtn>
      ) : (
        <button type="button" onClick={reconnect.onClick} disabled={reconnect.busy} className="btn btn-outline btn-sm pointer-coarse:h-11">
          {reconnect.busy ? <span className="loading loading-spinner loading-xs" /> : <Icon.reconnect />}
          Reconnect
        </button>
      ))}
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
  const [head, ...restLines] = (isText ? item.text ?? '' : '').split('\n')
  const rest = restLines.join('\n')
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
    <li className={'rounded-box border p-2 ' + (item.state === 'failed' ? 'border-error' : 'border-base-300')}>
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
          <div className="truncate font-mono text-body text-base-content">{isText ? head : item.filename}</div>
          {/* A multi-line label: the number above, what it is (prose) under it. */}
          {isText && rest && <div className="line-clamp-2 whitespace-pre-line text-xs text-base-content">{rest}</div>}
          <div className="truncate font-mono text-2xs text-base-content/60">
            {where}
            {item.barcode ? ' · barcode' : ''}
            {item.copies > 1 ? ` · ×${item.copies}` : ''}
            {item.pages ? ` · ${item.pages} p` : ''}
            {' · '}{age(item.created)}
          </div>
        </div>
        <div className="flex flex-none gap-1">
          <IconBtn title="Printer & copies" variant={open ? 'active' : undefined} onClick={() => setOpen((o) => !o)} disabled={locked}><Icon.sliders /></IconBtn>
          <IconBtn title="Remove" confirm={armed ? 'Remove?' : undefined} onClick={onRemove} disabled={locked}><Icon.forget /></IconBtn>
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
              className="select w-full font-mono"
            >
              {!current && <option value="">{where}</option>}
              {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <div className="flex items-end justify-between gap-3">
            {isText ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={item.barcode}
                  onChange={(e) => onChange(printQueue.update(item.id, { barcode: e.target.checked }))}
                />
                <span className="text-body">Barcode</span>
              </label>
            ) : <span />}
            <div className="flex flex-col items-end gap-[6px]">
              <span className="field-label">Copies</span>
              <div className="join">
                <button type="button" onClick={() => setCopies(item.copies - 1)} disabled={item.copies <= 1} aria-label="Fewer copies" className="btn btn-sm btn-square join-item pointer-coarse:size-11"><Icon.minus /></button>
                <span className="join-item flex h-8 w-9 items-center justify-center border-y border-base-300 font-mono text-body tabular-nums pointer-coarse:h-11 pointer-coarse:w-11">{item.copies}</span>
                <button type="button" onClick={() => setCopies(item.copies + 1)} disabled={item.copies >= 20} aria-label="More copies" className="btn btn-sm btn-square join-item pointer-coarse:size-11"><Icon.connect /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

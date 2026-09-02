import { useEffect, useRef, useState } from 'react'
import { api, type Queue } from '../api/client'
import { useStatus } from '../components/status'
import { useNote, Note } from '../components/Note'
import { DualRange } from '../components/DualRange'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Field, PlainSelect } from '../components/form'

interface Doc {
  filename: string
  token: string
  pages: number
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;base64,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

export function PrintTab() {
  const status = useStatus()
  const { note, ok, err, clear } = useNote()

  const [queues, setQueues] = useState<Queue[]>([])
  const [queue, setQueue] = useState('')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 1, to: 1 })
  const [sides, setSides] = useState<'one' | 'two'>('one')
  const [flip, setFlip] = useState<{ token: string; instruction: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.queues()
      .then((d) => {
        setQueues(d.queues)
        setQueue(d.default || d.queues.find((q) => q.default)?.queue || d.queues[0]?.queue || '')
      })
      .catch(() => {})
  }, [])

  const loadFile = (file: File) => {
    clear()
    status.set('busy', 'Reading')
    readAsBase64(file)
      .then((b64) => api.documentInfo(b64, file.name))
      .then((d) => {
        status.set('idle', 'Ready')
        if (d.ok && d.token && d.pages) {
          setDoc({ filename: file.name, token: d.token, pages: d.pages })
          setRange({ from: 1, to: d.pages })
          if (d.pages <= 1) setSides('one')
        } else {
          err(d.error || 'Could not read the file.')
          setDoc(null)
        }
      })
      .catch(() => {
        status.set('error', 'Failed')
        err('Could not read the file.')
        setDoc(null)
      })
  }

  const clearFile = () => {
    setDoc(null)
    setSides('one')
    setFlip(null)
    clear()
    if (fileInput.current) fileInput.current.value = ''
  }

  // Paste an image (screenshot) while the Print tab is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith('image/'))
      const f = item?.getAsFile()
      if (f) {
        e.preventDefault()
        loadFile(f)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const print = () => {
    if (!doc || busy) return
    setBusy(true)
    clear()
    status.set('busy', 'Printing')
    const full = range.from === 1 && range.to === doc.pages
    api.documentPrint({
      src_token: doc.token,
      queue,
      sides,
      ...(full ? {} : { from: range.from, to: range.to }),
    })
      .then((d) => {
        setBusy(false)
        if (!d.ok) {
          status.set('error', 'Failed')
          err(d.error || 'Print failed.')
          return
        }
        if (d.step === 'flip' && d.token) {
          status.set('idle', 'Ready')
          setFlip({ token: d.token, instruction: d.instruction || 'Flip the stack and continue.' })
          return
        }
        status.set('idle', 'Ready')
        const n = d.pages ?? 0
        ok(`Sent ${n} ${n === 1 ? 'page' : 'pages'} to ${d.queue}${d.duplex === 'auto' ? ' (double-sided)' : ''}.`)
      })
      .catch(() => {
        setBusy(false)
        status.set('error', 'Failed')
        err('Could not reach the print service.')
      })
  }

  const doContinue = () => {
    if (!flip) return
    setBusy(true)
    status.set('busy', 'Printing')
    api.documentContinue(flip.token)
      .then((d) => {
        setBusy(false)
        setFlip(null)
        if (d.ok) {
          status.set('idle', 'Ready')
          ok('Done — printed both sides.')
        } else {
          status.set('error', 'Failed')
          err(d.error || 'Print failed.')
        }
      })
      .catch(() => {
        setBusy(false)
        status.set('error', 'Failed')
        err('Could not reach the print service.')
      })
  }

  const doCancel = () => {
    if (flip) api.documentCancel(flip.token).catch(() => {})
    setFlip(null)
    clear()
  }

  const multiPage = (doc?.pages ?? 1) > 1

  return (
    <Card className="p-5">
      {queues.length >= 2 && (
        <div className="mb-4">
          <Field label="Printer">
            <PlainSelect
              value={queue}
              onChange={setQueue}
              options={queues.map((q) => [q.queue, q.name + (q.queue !== q.name ? ` (${q.queue})` : '')])}
            />
          </Field>
        </div>
      )}

      {/* Dropzone */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) loadFile(f)
        }}
        className={
          'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ' +
          (dragOver ? 'border-primary bg-accent' : 'border-border hover:border-primary')
        }
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/*,text/plain,.txt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f) }}
        />
        {doc ? (
          <div className="flex items-center gap-2">
            <span className="break-all font-mono text-[13px] text-foreground">{doc.filename}</span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); clearFile() }}
              aria-label="Remove file"
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-destructive text-white"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6 18 18M18 6 6 18" /></svg>
            </button>
          </div>
        ) : (
          <>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M12 15V4M8 8l4-4 4 4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
            <div className="text-[14px] text-foreground">Drop a file, or <span className="text-primary">choose one</span></div>
            <div className="font-mono text-xs text-faint">PDF, image, or text — drag, choose, or paste an image</div>
          </>
        )}
      </label>

      {/* Page range */}
      {doc && multiPage && (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-faint">Pages to print</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {range.from}–{range.to} <span className="text-faint">of {doc.pages}</span>
            </span>
          </div>
          <DualRange
            min={1}
            max={doc.pages}
            from={range.from}
            to={range.to}
            onChange={(from, to) => setRange({ from, to })}
          />
        </div>
      )}

      {/* Double-sided toggle (hidden for single-page docs) */}
      {doc && multiPage && (
        <label className="mt-4 flex w-full cursor-pointer items-center justify-between">
          <span className="text-[14px]">Double-sided</span>
          <Switch checked={sides === 'two'} onCheckedChange={(on) => setSides(on ? 'two' : 'one')} />
        </label>
      )}

      {/* Guided manual-duplex flip step */}
      {flip && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <p className="m-0 mb-3 text-[13px] leading-[1.5] text-foreground">{flip.instruction}</p>
          <div className="flex gap-2">
            <Button onClick={doContinue} disabled={busy}>{busy ? 'Printing…' : 'Continue'}</Button>
            <Button variant="outline" onClick={doCancel}>Cancel</Button>
          </div>
        </div>
      )}

      {!flip && (
        <>
          <hr className="my-4 border-t border-border" />
          <Button size="lg" onClick={print} disabled={!doc || busy} className="h-11 w-full text-[15px]">
            {busy ? 'Printing…' : 'Print'}
          </Button>
        </>
      )}

      <Note note={note} />
    </Card>
  )
}

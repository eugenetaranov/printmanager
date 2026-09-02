import { useMemo, useState } from 'react'
import { printSheet, type Template } from '../api/client'
import { useStatus } from './status'
import { readImageB64, type A4Format } from '../lib/formats'
import { Seg } from './NiimbotComposer'

type CellContent =
  | { mode: 'text'; text: string }
  | { mode: 'qr'; text: string }
  | { mode: 'file'; dataB64: string; filename: string; dataUrl: string }

interface Geom {
  cols: number; rows: number
  margin_l: number; margin_t: number
  gap_x: number; gap_y: number
  cell_w: number; cell_h: number
  page_w: number; page_h: number
}

function geomOf(t: Template): Geom {
  const n = (k: string, d = 0) => Number(t[k] ?? d)
  return {
    cols: n('cols'), rows: n('rows'),
    margin_l: n('margin_l'), margin_t: n('margin_t'),
    gap_x: n('gap_x'), gap_y: n('gap_y'),
    cell_w: n('cell_w'), cell_h: n('cell_h'),
    page_w: n('page_w', 210), page_h: n('page_h', 297),
  }
}

export function SheetComposer({
  format,
  template,
  onNote,
}: {
  format: A4Format
  template: Template
  onNote: (kind: '' | 'ok' | 'err', msg: string) => void
}) {
  const status = useStatus()
  const g = useMemo(() => geomOf(template), [template])
  const n = g.cols * g.rows

  const [sel, setSel] = useState<Set<number>>(new Set())
  const [content, setContent] = useState<Record<number, CellContent>>({})
  const [pmode, setPmode] = useState<'text' | 'file' | 'qr'>('text')
  const [text, setText] = useState('')
  const [qr, setQr] = useState('')
  const [img, setImg] = useState<{ b64: string; url: string; name: string } | null>(null)
  const [printing, setPrinting] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)

  const cellXY = (i: number) => {
    const c = i % g.cols, r = Math.floor(i / g.cols)
    return { x: g.margin_l + c * (g.cell_w + g.gap_x), y: g.margin_t + r * (g.cell_h + g.gap_y) }
  }

  const toggle = (i: number) =>
    setSel((s) => { const n2 = new Set(s); if (n2.has(i)) n2.delete(i); else n2.add(i); return n2 })

  const pending = (): CellContent | null => {
    if (pmode === 'text') return text.trim() ? { mode: 'text', text } : null
    if (pmode === 'qr') return qr.trim() ? { mode: 'qr', text: qr } : null
    return img ? { mode: 'file', dataB64: img.b64, filename: img.name, dataUrl: img.url } : null
  }

  const addToSheet = () => {
    const p = pending()
    if (!p || sel.size === 0) return
    setContent((c) => { const c2 = { ...c }; sel.forEach((i) => { c2[i] = p }); return c2 })
  }
  const erase = () =>
    setContent((c) => { const c2 = { ...c }; sel.forEach((i) => delete c2[i]); return c2 })

  const clearSheet = () => {
    if (!clearArmed) { setClearArmed(true); window.setTimeout(() => setClearArmed(false), 3000); return }
    setClearArmed(false); setContent({}); setSel(new Set())
  }

  const print = () => {
    const keys = Object.keys(content)
    if (!keys.length || printing) return
    setPrinting(true)
    status.set('busy', 'Printing')
    onNote('', '')
    const cells: Record<string, { mode: 'text' | 'file' | 'qr'; text?: string; dataB64?: string; filename?: string }> = {}
    for (const [k, cc] of Object.entries(content)) {
      if (cc.mode === 'file') cells[k] = { mode: 'file', dataB64: cc.dataB64, filename: cc.filename }
      else cells[k] = { mode: cc.mode, text: cc.text }
    }
    printSheet({ queue: format.queue, template: template.id, cells })
      .then((r) => {
        if (r.ok) { status.set('idle', 'Ready'); onNote('ok', `Printed ${keys.length} label${keys.length === 1 ? '' : 's'}.`) }
        else { status.set('error', 'Failed'); onNote('err', r.error || 'Print failed.') }
      })
      .catch(() => { status.set('error', 'Failed'); onNote('err', 'Could not reach the print service.') })
      .finally(() => setPrinting(false))
  }

  const filled = Object.keys(content).length
  const pd = pending()

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="field-label">
          {sel.size ? `${sel.size} cell${sel.size === 1 ? '' : 's'} selected` : 'Tap cells to place your label'}
        </span>
        <span className="flex gap-1">
          <button type="button" onClick={() => setSel(new Set(Array.from({ length: n }, (_, i) => i)))} className="btn btn-ghost btn-xs">All</button>
          <button type="button" onClick={() => setSel(new Set())} className="btn btn-ghost btn-xs">None</button>
        </span>
      </div>

      <div className="mx-auto max-w-[280px]">
        <svg viewBox={`0 0 ${g.page_w} ${g.page_h}`} className="w-full rounded-lg border border-base-300 bg-white" role="group" aria-label="Label sheet">
          {Array.from({ length: n }, (_, i) => {
            const { x, y } = cellXY(i)
            const isSel = sel.has(i)
            const cc = content[i]
            return (
              <g key={i} onClick={() => toggle(i)} style={{ cursor: 'pointer' }}>
                <rect x={x} y={y} width={g.cell_w} height={g.cell_h} rx={1.5}
                  fill={isSel ? 'color-mix(in oklch, var(--color-primary) 15%, transparent)' : cc ? '#fff' : '#fafafa'}
                  stroke={isSel ? 'var(--color-primary)' : '#d8d8d2'} strokeWidth={isSel ? 0.7 : 0.3} />
                {cc?.mode === 'file' && (
                  <image href={cc.dataUrl} x={x + 1} y={y + 1} width={g.cell_w - 2} height={g.cell_h - 2} preserveAspectRatio="xMidYMid meet" />
                )}
                {cc && cc.mode !== 'file' && (
                  <text x={x + g.cell_w / 2} y={y + g.cell_h / 2} fontSize={Math.min(g.cell_h * 0.28, 4)}
                    textAnchor="middle" dominantBaseline="central" fill="#1b1b18" fontFamily="monospace">
                    {cc.mode === 'qr' ? 'QR' : (cc.text.split('\n')[0] || '').slice(0, 12)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <Seg value={pmode} onChange={setPmode} options={[['text', 'Text'], ['file', 'Image / PDF'], ['qr', 'QR']]} />

      <div className="mt-3">
        {pmode === 'text' && (
          <textarea rows={2} maxLength={200} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'e.g. 42 — or a short\nlabel on two lines'} className="textarea w-full font-mono" />
        )}
        {pmode === 'qr' && (
          <textarea rows={2} maxLength={512} value={qr} onChange={(e) => setQr(e.target.value)}
            placeholder="e.g. https://example.com or any text" className="textarea w-full font-mono" />
        )}
        {pmode === 'file' && (
          <div>
            <input type="file" accept="image/*,application/pdf" className="text-body"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readImageB64(f).then(({ b64, dataUrl }) => setImg({ b64, url: dataUrl, name: f.name })) }} />
            {img && <div className="mt-2"><img src={img.url} alt="" className="max-h-24 rounded border border-base-300" /></div>}
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={addToSheet} disabled={!pd || sel.size === 0} className="btn btn-primary">Add to sheet</button>
        <button type="button" onClick={erase} disabled={sel.size === 0} className="btn btn-ghost">Erase</button>
      </div>

      <hr className="my-4 border-t border-base-300" />
      <button type="button" onClick={print} disabled={!filled || printing} className="btn btn-primary btn-block btn-lg">
        {printing ? 'Printing…' : `Print sheet${filled ? ` (${filled})` : ''}`}
      </button>
      {filled > 0 && (
        <button type="button" onClick={clearSheet} className="btn btn-ghost btn-sm mt-2 w-full text-base-content/45 hover:text-error">
          {clearArmed ? 'Click again to clear' : 'Clear sheet'}
        </button>
      )}
    </div>
  )
}

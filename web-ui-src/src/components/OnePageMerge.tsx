import { useEffect, useRef, useState } from 'react'
import { api, type OnePageChoice, type OnePageItem } from '../api/client'
import { IconBtn, Icon } from './IconBtn'

// "One page" mode of the Merge dialog: the server finds the item on each
// scanned page and lays them out on one A4 page. Show that page before saving
// (detection can be wrong and the originals are removed on merge), with small
// fixes per item: reorder, use the whole page, or leave it out.

export interface OnePageState {
  token: string
  choices: OnePageChoice[]
  ready: boolean          // a preview exists and has something on it
}

interface Row extends OnePageItem {
  whole: boolean
  skip: boolean
}

export function OnePageMerge({ names, onState }: { names: string[]; onState: (s: OnePageState) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [token, setToken] = useState('')
  const [png, setPng] = useState('')
  const [scale, setScale] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const seq = useRef(0)

  const choicesOf = (rs: Row[]): OnePageChoice[] => rs.map((r) => ({ id: r.id, whole: r.whole, skip: r.skip }))

  const fetchPreview = (rs: Row[] | null, tok: string) => {
    const my = ++seq.current
    setBusy(true)
    api.onePagePreview(names, tok || undefined, rs ? choicesOf(rs) : undefined)
      .then((d) => {
        if (my !== seq.current) return
        setBusy(false)
        if (!d.ok) { setError(d.error || 'Couldn’t read the scans.'); setPng(''); return }
        setToken(d.token || '')
        setPng(d.png || '')
        setScale(d.scale || 0)
        setError(d.error || '')
        if (!rs) {
          // First analysis: rows in merge order; a page with nothing found starts left out.
          setRows((d.items || []).map((it) => ({ ...it, whole: false, skip: !it.found })))
        }
      })
      .catch(() => { if (my === seq.current) { setBusy(false); setError('Could not reach the merge service.') } })
  }

  useEffect(() => { fetchPreview(null, '') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const used = rows.some((r) => !r.skip && (r.found || r.whole))
    onState({ token, choices: choicesOf(rows), ready: !!token && !busy && !!png && used })
  }, [rows, token, busy, png]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (rs: Row[]) => { setRows(rs); fetchPreview(rs, token) }
  const move = (i: number, d: -1 | 1) => {
    const rs = rows.slice()
    ;[rs[i], rs[i + d]] = [rs[i + d], rs[i]]
    update(rs)
  }
  const patch = (i: number, p: Partial<Row>) => update(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))

  const multiPage = new Set(rows.map((r) => r.name)).size < rows.length

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* Preview: an A4 sheet, real proportions */}
      <div className="flex flex-none flex-col items-center gap-[6px] sm:w-[220px]">
        <div className="relative aspect-[210/297] w-[180px] overflow-hidden rounded-sm border border-base-300 bg-white shadow-sm sm:w-[200px]">
          {png ? (
            <img src={png} alt="Preview of the merged page" className={'block h-full w-full ' + (busy ? 'opacity-50' : '')} />
          ) : busy ? (
            <div className="skeleton h-full w-full rounded-none" />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-base-content/60">No preview</div>
          )}
        </div>
        <div className="font-mono text-2xs tabular-nums text-base-content/60">
          {busy && !png ? 'Finding items…'
            : scale >= 0.999 ? '1 × A4 · real size'
            : scale > 0 ? <span className={scale < 0.4 ? 'text-warning' : ''}>1 × A4 · scaled to {Math.round(scale * 100)}%</span>
            : ''}
        </div>
      </div>

      {/* Order + per-item fixes */}
      <div className="min-w-0 flex-1">
        <span className="field-label">Order</span>
        {rows.length === 0 && busy && (
          <div className="mt-1 flex flex-col gap-2">
            {names.map((n) => <div key={n} className="skeleton h-10 w-full rounded" />)}
          </div>
        )}
        {rows.map((r, i) => {
          const off = r.skip || (!r.found && !r.whole)
          return (
            <div key={r.id} className="border-b border-base-300 py-2 last:border-0">
              <div className="flex items-center gap-2">
                <span className="w-4 flex-none text-right font-mono text-2xs tabular-nums text-base-content/60">{i + 1}</span>
                {r.thumb
                  ? <img src={r.thumb} alt="" className={'h-9 w-9 flex-none rounded-sm border border-base-300 bg-white object-contain ' + (off ? 'opacity-40' : '')} />
                  : <span className="h-9 w-9 flex-none rounded-sm border border-base-300" />}
                <div className="min-w-0 flex-1">
                  <div className={'truncate font-mono text-xs ' + (off ? 'text-base-content/60 line-through' : 'text-base-content')}>
                    {r.name}{multiPage ? ` · p${r.page}` : ''}
                  </div>
                  <div className="truncate font-mono text-2xs text-base-content/60">
                    {!r.found && !r.whole ? <span className="text-error">Nothing found</span>
                      : r.skip ? 'Left out'
                      : r.whole ? 'Whole page'
                      : `${r.w_mm}×${r.h_mm} mm`}
                  </div>
                </div>
                <div className="flex flex-none gap-[2px]">
                  <IconBtn title="Move up" onClick={() => move(i, -1)} disabled={i === 0}><Icon.up /></IconBtn>
                  <IconBtn title="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}><Icon.down /></IconBtn>
                  <IconBtn title={r.whole ? 'Use the detected item' : 'Use the whole page'} variant={r.whole ? 'active' : undefined}
                    onClick={() => patch(i, { whole: !r.whole, skip: false })}><Icon.page /></IconBtn>
                  <IconBtn title={r.skip ? 'Put it back' : 'Leave out'} variant={r.skip ? 'active' : undefined}
                    onClick={() => patch(i, { skip: !r.skip })}><Icon.close /></IconBtn>
                </div>
              </div>
            </div>
          )
        })}
        {error && <p className="mt-2 text-xs text-error">{error}</p>}
        {rows.some((r) => r.skip) && (
          <p className="mt-2 text-2xs text-base-content/60">Scans left out entirely are kept, not removed.</p>
        )}
      </div>
    </div>
  )
}

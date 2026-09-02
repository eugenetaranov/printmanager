import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode,
} from 'react'
import { api, type Scan } from '../api/client'
import { Modal } from './Modal'
import { useActivityLog } from './ActivityLog'

export interface RecentScansHandle {
  refresh: (newest?: string) => void
}

interface Props {
  share: string
  onNote: (kind: 'ok' | 'err' | '', content: ReactNode) => void
}

function fmtSize(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

function ago(mtime: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - mtime))
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

export const RecentScans = forwardRef<RecentScansHandle, Props>(function RecentScans(
  { share, onNote },
  ref,
) {
  const { push } = useActivityLog()
  const [scans, setScans] = useState<Scan[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [newest, setNewest] = useState<string>('')
  const [selected, setSelected] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string>('')
  const [removeArmed, setRemoveArmed] = useState<string>('')
  const [clearArmed, setClearArmed] = useState(false)
  const [printing, setPrinting] = useState<string>('')
  const [preview, setPreview] = useState<{ src: string; x: number; y: number } | null>(null)

  // Merge modal state.
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeName, setMergeName] = useState('')
  const [mergeCap, setMergeCap] = useState(0)   // MB; 0 = no limit
  const [mergeError, setMergeError] = useState('')
  const [mergeBusy, setMergeBusy] = useState(false)
  const mergeNames = useRef<string[]>([])

  const load = useCallback((n?: string) => {
    api.recent().then((s) => {
      setScans(s)
      setLoaded(true)
      setLoadError(false)
      // Drop selections whose rows are gone.
      const have = new Set(s.map((x) => x.name))
      setSelected((sel) => sel.filter((name) => have.has(name)))
      if (n !== undefined) setNewest(n)
    }).catch(() => {
      // Keep any previously-loaded rows; surface the failure instead of an empty state.
      setLoaded(true)
      setLoadError(true)
    })
  }, [])

  useImperativeHandle(ref, () => ({ refresh: load }), [load])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 15s, paused while a rename is in progress.
  useEffect(() => {
    const id = setInterval(() => { if (!renaming) load() }, 15000)
    return () => clearInterval(id)
  }, [renaming, load])

  const toggle = (name: string) =>
    setSelected((sel) => (sel.includes(name) ? sel.filter((n) => n !== name) : [...sel, name]))

  const toggleAll = () =>
    setSelected((sel) => (sel.length === scans.length ? [] : scans.map((s) => s.name)))

  // --- remove (two-click arm/confirm) ---
  const armTimer = useRef<number | undefined>(undefined)
  const onRemove = (name: string) => {
    if (removeArmed !== name) {
      setRemoveArmed(name)
      window.clearTimeout(armTimer.current)
      armTimer.current = window.setTimeout(() => setRemoveArmed(''), 3000)
      return
    }
    setRemoveArmed('')
    api.remove(name)
      .then((r) => {
        push(`Removed ${name}`, r.undo ? async () => { await api.undo(r.undo!); load() } : undefined)
        load()
      })
      .catch(() => {})
  }

  // --- print a stored scan to the default queue ---
  const onPrint = (name: string) => {
    if (printing) return
    setPrinting(name)
    api.printScan(name)
      .then((r) => {
        if (r.ok) push(`Printed ${name}${r.queue ? ` → ${r.queue}` : ''}`)
        else onNote('err', r.error || 'Print failed.')
      })
      .catch(() => onNote('err', 'Could not reach the print service.'))
      .finally(() => setPrinting(''))
  }

  // --- clear all (two-click arm/confirm) ---
  const clearTimer = useRef<number | undefined>(undefined)
  const onClear = () => {
    if (!clearArmed) {
      setClearArmed(true)
      window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setClearArmed(false), 4000)
      return
    }
    setClearArmed(false)
    api.clear()
      .then((d) => {
        if (d.removed) push(`Removed ${d.removed} scan${d.removed === 1 ? '' : 's'}`, d.undo ? async () => { await api.undo(d.undo!); load() } : undefined)
        else onNote('', 'Nothing to remove.')
        load()
      })
      .catch(() => onNote('err', 'Could not clear the scans.'))
  }

  // --- merge ---
  const openMerge = () => {
    if (selected.length < 2) return
    mergeNames.current = selected.slice()
    setMergeName('')
    setMergeCap(0)
    setMergeError('')
    setMergeBusy(false)
    setMergeOpen(true)
  }
  const doMerge = () => {
    if (mergeBusy || mergeNames.current.length < 2) return
    setMergeBusy(true)
    setMergeError('')
    const n = mergeNames.current.length
    api.merge(mergeNames.current, mergeName.trim(), mergeCap > 0 ? mergeCap : undefined)
      .then((d) => {
        setMergeBusy(false)
        if (d.ok && d.file) {
          setMergeOpen(false)
          const tok = d.undo
          const mb = d.size ? ` (${(d.size / 1048576).toFixed(1)} MB)` : ''
          push(`Merged ${n} scans → ${d.file}${mb}`, tok ? async () => { await api.undo(tok); load() } : undefined)
          setSelected([])
          load(d.file)
        } else {
          // Keep the modal open so the user can raise the cap and retry.
          setMergeError(d.error || 'Merge failed.')
        }
      })
      .catch(() => {
        setMergeBusy(false)
        setMergeError('Could not reach the merge service.')
      })
  }

  const nSel = selected.length
  const allChecked = scans.length > 0 && nSel === scans.length

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[13px] font-[640] tracking-[0.02em]">Recent scans</h2>
        <div className="flex items-center gap-2">
          {nSel >= 2 && (
            <button type="button" onClick={openMerge} className="btn btn-primary btn-sm font-mono">Merge {nSel}</button>
          )}
          <button
            type="button"
            onClick={onClear}
            className={'btn btn-sm font-mono ' + (clearArmed ? 'btn-error' : 'btn-ghost text-base-content/45')}
          >
            {clearArmed ? 'Click again to delete all' : 'Clear all'}
          </button>
        </div>
      </div>

      {share && (
        <div className="break-all font-mono text-xs font-medium text-base-content/45">
          Saved to{' '}
          <a href={share} className="text-primary no-underline hover:underline">{share}</a>
        </div>
      )}

      <div className="mt-[14px]">
        {/* table-fixed + colgroup: column widths are pinned, so content changing
            (e.g. the order badge showing/hiding) can never reflow the layout.
            No overflow wrapper — it would let tooltip bubbles create a horizontal
            scrollbar; the fixed-layout table always fits its container. */}
        <table className="table table-sm w-full table-fixed text-[13px]">
          <colgroup>
            <col className="w-10" />
            <col className="w-[46px]" />
            <col />
            <col className="w-[52px]" />
            <col className="w-[66px]" />
            <col className="w-[74px]" />
            <col className="w-[168px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-base-300 [&>th]:px-[10px] [&>th]:pb-2 [&>th]:text-left [&>th]:font-mono [&>th]:text-[11px] [&>th]:font-[600] [&>th]:uppercase [&>th]:tracking-[0.04em] [&>th]:text-base-content/45">
              <th className="text-center">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = nSel > 0 && !allChecked }}
                  onChange={toggleAll}
                  className="checkbox checkbox-sm align-middle"
                />
              </th>
              <th></th>
              <th>Name</th>
              <th>DPI</th>
              <th>Size</th>
              <th>When</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!loaded && Array.from({ length: 4 }, (_, i) => (
              <tr key={'sk' + i} className="[&>td]:border-b [&>td]:border-base-300 [&>td]:px-[10px] [&>td]:py-2">
                <td><div className="skeleton mx-auto h-4 w-4 rounded" /></td>
                <td><div className="skeleton h-11 w-[34px] rounded" /></td>
                <td><div className="skeleton h-4 w-40 rounded" /></td>
                <td><div className="skeleton h-4 w-6 rounded" /></td>
                <td><div className="skeleton h-4 w-12 rounded" /></td>
                <td><div className="skeleton h-4 w-12 rounded" /></td>
                <td><div className="skeleton ml-auto h-4 w-16 rounded" /></td>
              </tr>
            ))}
            {loaded && scans.map((s) => {
              const i = selected.indexOf(s.name)
              return (
                <tr key={s.name} className={'[&>td]:border-b [&>td]:border-base-300 [&>td]:px-[10px] [&>td]:py-2 [&>td]:align-middle ' + (s.name === newest ? '[&>td]:[animation:rowin_0.35s_ease_both]' : '')}>
                  <td className="whitespace-nowrap text-center">
                    <span className="relative inline-flex items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label="Select"
                        checked={i >= 0}
                        onChange={() => toggle(s.name)}
                        className="checkbox checkbox-sm align-middle"
                      />
                      {i >= 0 && (
                        <span className="absolute left-full ml-[3px] font-mono text-[10px] font-[700] leading-none text-primary">
                          {i + 1}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <img
                      loading="lazy"
                      src={api.thumbUrl(s.name)}
                      alt=""
                      onMouseEnter={(e) => setPreview({ src: api.thumbUrl(s.name), x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))}
                      onMouseLeave={() => setPreview(null)}
                      className="block h-11 w-[34px] cursor-zoom-in rounded-[3px] border border-base-300 bg-base-200 object-cover"
                    />
                  </td>
                  <td>
                    {renaming === s.name ? (
                      <RenameField
                        name={s.name}
                        onDone={() => setRenaming('')}
                        onCommit={(to) => {
                          setRenaming('')
                          const from = s.name
                          const oldBase = from.replace(/\.pdf$/i, '')
                          if (!to || to === oldBase) { load(); return }
                          api.rename(from, to)
                            .then((d) => {
                              if (!d.ok) { onNote('err', d.error || 'Rename failed.'); load(); return }
                              const newName = d.file!
                              push(`Renamed ${from} → ${newName}`, async () => { await api.rename(newName, oldBase); load() })
                              load(newName)
                            })
                            .catch(() => load())
                        }}
                      />
                    ) : (
                      <span className="break-all font-mono text-[13px]">{s.name}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-base-content/60">{s.dpi || '—'}</td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-base-content/60">{fmtSize(s.size)}</td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-base-content/45">{ago(s.mtime)}</td>
                  <td>
                    <div className="flex justify-end gap-[2px] whitespace-nowrap">
                      <a className="tooltip tooltip-top btn btn-ghost btn-xs btn-square" href={api.fileUrl(s.name)} target="_blank" rel="noopener" data-tip="Open in new tab" aria-label="Open">
                        <IconOpen />
                      </a>
                      <button type="button" onClick={() => onPrint(s.name)} disabled={printing === s.name} className="tooltip tooltip-top btn btn-ghost btn-xs btn-square" data-tip="Print" aria-label="Print">
                        {printing === s.name ? <span className="loading loading-spinner loading-xs" /> : <IconPrint />}
                      </button>
                      <a className="tooltip tooltip-top btn btn-ghost btn-xs btn-square" href={api.fileUrl(s.name)} download data-tip="Download" aria-label="Download">
                        <IconDownload />
                      </a>
                      <button type="button" onClick={() => setRenaming(s.name)} className="tooltip tooltip-top btn btn-ghost btn-xs btn-square" data-tip="Rename" aria-label="Rename">
                        <IconRename />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.name)}
                        className={'tooltip tooltip-top btn btn-xs btn-square ' + (removeArmed === s.name ? 'btn-error' : 'btn-ghost')}
                        data-tip={removeArmed === s.name ? 'Click again to delete' : 'Remove'}
                        aria-label="Remove"
                      >
                        <IconRemove />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {loadError && (
        <div role="alert" className="mt-2 flex items-center justify-between gap-3 rounded-md bg-error/10 px-3 py-2 text-[13px] text-error">
          <span>Couldn’t reach the scan service.</span>
          <button type="button" onClick={() => load()} className="btn btn-ghost btn-xs">Retry</button>
        </div>
      )}

      {loaded && !loadError && scans.length === 0 && (
        <p className="px-[2px] py-4 text-sm text-base-content/60">No scans yet. Place a page on the glass and press Scan.</p>
      )}

      {preview && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl"
          style={{
            left: Math.min(preview.x + 16, window.innerWidth - 316),
            top: Math.min(preview.y + 16, Math.max(8, window.innerHeight - 428)),
          }}
        >
          <img src={preview.src} alt="" className="block h-auto w-[300px] rounded-[5px]" />
        </div>
      )}

      <Modal open={mergeOpen} onClose={() => { if (!mergeBusy) setMergeOpen(false) }} labelledBy="mergeTitle">
        <h3 id="mergeTitle" className="m-0 mb-1 text-[15px] font-[640] tracking-[0.01em]">Merge scans</h3>
        <p className="m-0 mb-4 text-[12.5px] leading-[1.45] text-base-content/60">
          Combining {mergeNames.current.length} scans into one PDF, in the order you selected. The originals are removed after merging.
        </p>
        <label htmlFor="mergeName" className="mb-[6px] block font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-base-content/45">
          Name <span className="font-medium normal-case tracking-normal opacity-70">optional</span>
        </label>
        <input
          id="mergeName"
          type="text"
          maxLength={80}
          autoComplete="off"
          autoFocus
          value={mergeName}
          onChange={(e) => setMergeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); doMerge() }
            else if (e.key === 'Escape') { e.preventDefault(); if (!mergeBusy) setMergeOpen(false) }
          }}
          placeholder="auto: merged-YYYYMMDD-HHMMSS"
          className="input w-full font-mono"
        />

        <div className="mt-4 mb-[6px] flex items-baseline justify-between">
          <label htmlFor="mergeCap" className="font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-base-content/45">
            Max size <span className="font-medium normal-case tracking-normal opacity-70">optional</span>
          </label>
          <span className="font-mono text-xs text-base-content/70">{mergeCap === 0 ? 'No limit' : `${mergeCap} MB`}</span>
        </div>
        <input
          id="mergeCap"
          type="range"
          min={0}
          max={10}
          step={1}
          value={mergeCap}
          onChange={(e) => setMergeCap(Number(e.target.value))}
          className="range range-sm w-full"
        />
        <div className="mt-1 flex justify-between px-[2px] font-mono text-[10px] text-base-content/40">
          <span>Off</span><span>10 MB</span>
        </div>

        {mergeError && <p className="mt-3 font-mono text-[12px] text-error">{mergeError}</p>}

        <div className="mt-[18px] flex justify-end gap-2">
          <button type="button" onClick={() => { if (!mergeBusy) setMergeOpen(false) }} className="btn btn-ghost btn-sm">Cancel</button>
          <button type="button" onClick={doMerge} disabled={mergeBusy} className="btn btn-primary btn-sm">
            {mergeBusy ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </Modal>
    </section>
  )
})

// Inline rename field: commits once on Enter or blur (guarded), cancels on Esc.
function RenameField({ name, onCommit, onDone }: { name: string; onCommit: (to: string) => void; onDone: () => void }) {
  const base = name.replace(/\.pdf$/i, '')
  const [val, setVal] = useState(base)
  const done = useRef(false)
  const commit = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) onCommit(val.trim())
    else onDone()
  }
  return (
    <input
      autoFocus
      type="text"
      maxLength={80}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true) }
        else if (e.key === 'Escape') { commit(false) }
      }}
      onBlur={() => commit(true)}
      className="input input-sm w-full min-w-[160px] font-mono"
    />
  )
}

function IconOpen() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
  )
}
function IconPrint() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></svg>
  )
}
function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M4 21h16" /></svg>
  )
}
function IconRename() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
  )
}
function IconRemove() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6" /></svg>
  )
}

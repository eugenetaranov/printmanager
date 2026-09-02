import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode,
} from 'react'
import { api, type Scan } from '../api/client'
import { Modal } from './Modal'

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
  const [scans, setScans] = useState<Scan[]>([])
  const [newest, setNewest] = useState<string>('')
  const [selected, setSelected] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string>('')
  const [removeArmed, setRemoveArmed] = useState<string>('')
  const [clearArmed, setClearArmed] = useState(false)
  const [preview, setPreview] = useState<{ src: string; x: number; y: number } | null>(null)

  // Merge modal state.
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeName, setMergeName] = useState('')
  const [mergeBusy, setMergeBusy] = useState(false)
  const mergeNames = useRef<string[]>([])

  const load = useCallback((n?: string) => {
    api.recent().then((s) => {
      setScans(s)
      // Drop selections whose rows are gone.
      const have = new Set(s.map((x) => x.name))
      setSelected((sel) => sel.filter((name) => have.has(name)))
      if (n !== undefined) setNewest(n)
    }).catch(() => {})
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
    api.remove(name).then(() => load()).catch(() => {})
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
        onNote('', d.removed ? `Removed ${d.removed} scan${d.removed === 1 ? '' : 's'}.` : 'Nothing to remove.')
        load()
      })
      .catch(() => onNote('err', 'Could not clear the scans.'))
  }

  // --- merge ---
  const openMerge = () => {
    if (selected.length < 2) return
    mergeNames.current = selected.slice()
    setMergeName('')
    setMergeBusy(false)
    setMergeOpen(true)
  }
  const doMerge = () => {
    if (mergeBusy || mergeNames.current.length < 2) return
    setMergeBusy(true)
    const n = mergeNames.current.length
    api.merge(mergeNames.current, mergeName.trim())
      .then((d) => {
        setMergeOpen(false)
        setMergeBusy(false)
        if (d.ok && d.file) {
          onNote('ok', `Merged ${n} scans → ${d.file}.`)
          setSelected([])
          load(d.file)
        } else {
          onNote('err', d.error || 'Merge failed.')
        }
      })
      .catch(() => {
        setMergeOpen(false)
        setMergeBusy(false)
        onNote('err', 'Could not reach the merge service.')
      })
  }

  const nSel = selected.length
  const allChecked = scans.length > 0 && nSel === scans.length

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[13px] font-[640] tracking-[0.02em]">Recent scans</h2>
        <div className="flex items-center gap-[10px]">
          {nSel >= 2 && (
            <button
              type="button"
              onClick={openMerge}
              className="cursor-pointer rounded-[7px] bg-accent px-3 py-[3px] font-mono text-xs font-[600] tracking-[0.02em] text-white hover:brightness-[1.06]"
            >
              Merge {nSel}
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className={
              'cursor-pointer rounded-md px-1 py-[2px] font-mono text-xs font-[600] tracking-[0.02em] ' +
              (clearArmed ? 'bg-danger text-white' : 'text-faint hover:text-danger')
            }
          >
            {clearArmed ? 'Click again to delete all' : 'Clear all'}
          </button>
        </div>
      </div>

      {share && (
        <div className="break-all font-mono text-xs font-medium text-faint">
          Saved to{' '}
          <a href={share} className="text-accent no-underline hover:underline">{share}</a>
        </div>
      )}

      <div className="mt-[14px] overflow-x-auto">
        {/* table-fixed + colgroup: column widths are pinned, so content changing
            (e.g. the order badge showing/hiding) can never reflow the layout. */}
        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-10" />
            <col className="w-[46px]" />
            <col />
            <col className="w-[52px]" />
            <col className="w-[66px]" />
            <col className="w-[74px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-[10px] [&>th]:pb-2 [&>th]:text-left [&>th]:font-mono [&>th]:text-[11px] [&>th]:font-[600] [&>th]:uppercase [&>th]:tracking-[0.04em] [&>th]:text-faint">
              <th className="text-center">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = nSel > 0 && !allChecked }}
                  onChange={toggleAll}
                  className="cursor-pointer align-middle accent-[var(--accent)]"
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
            {scans.map((s) => {
              const i = selected.indexOf(s.name)
              return (
                <tr key={s.name} className={'[&>td]:border-b [&>td]:border-border [&>td]:px-[10px] [&>td]:py-2 [&>td]:align-middle ' + (s.name === newest ? '[&>td]:[animation:rowin_0.35s_ease_both]' : '')}>
                  <td className="whitespace-nowrap text-center">
                    <span className="relative inline-flex items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label="Select"
                        checked={i >= 0}
                        onChange={() => toggle(s.name)}
                        className="cursor-pointer align-middle accent-[var(--accent)]"
                      />
                      {i >= 0 && (
                        <span className="absolute left-full ml-[3px] font-mono text-[10px] font-[700] leading-none text-accent">
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
                      className="block h-11 w-[34px] cursor-zoom-in rounded-[3px] border border-border bg-bg object-cover"
                    />
                  </td>
                  <td>
                    {renaming === s.name ? (
                      <RenameField
                        name={s.name}
                        onDone={() => setRenaming('')}
                        onCommit={(to) => {
                          setRenaming('')
                          if (!to || to === s.name.replace(/\.pdf$/i, '')) { load(); return }
                          api.rename(s.name, to)
                            .then((d) => {
                              if (!d.ok) onNote('err', d.error || 'Rename failed.')
                              load(d.file ?? undefined)
                            })
                            .catch(() => load())
                        }}
                      />
                    ) : (
                      <span className="break-all font-mono text-[13px]">{s.name}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-muted">{s.dpi || '—'}</td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-muted">{fmtSize(s.size)}</td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-faint">{ago(s.mtime)}</td>
                  <td>
                    <div className="flex justify-end gap-[2px] whitespace-nowrap">
                      <a
                        className="rounded-md p-[5px] leading-[0] text-muted no-underline hover:bg-bg hover:text-text"
                        href={api.fileUrl(s.name)}
                        download
                        title="Download"
                        aria-label="Download"
                      >
                        <IconDownload />
                      </a>
                      <button
                        type="button"
                        onClick={() => setRenaming(s.name)}
                        className="rounded-md p-[5px] leading-[0] text-muted hover:bg-bg hover:text-text"
                        title="Rename"
                        aria-label="Rename"
                      >
                        <IconRename />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.name)}
                        className={'rounded-md p-[5px] leading-[0] ' + (removeArmed === s.name ? 'bg-danger text-white' : 'text-muted hover:bg-bg hover:text-text')}
                        title={removeArmed === s.name ? 'Click again to delete' : 'Remove'}
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

      {scans.length === 0 && (
        <p className="px-[2px] py-4 text-sm text-muted">No scans yet. Place a page on the glass and press Scan.</p>
      )}

      {preview && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-surface p-1 shadow-pop"
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
        <p className="m-0 mb-4 text-[12.5px] leading-[1.45] text-muted">
          Combining {mergeNames.current.length} scans into one PDF, in the order you selected. The originals are removed after merging.
        </p>
        <label htmlFor="mergeName" className="mb-[6px] block font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-faint">
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
          className="w-full rounded-[9px] border border-border bg-bg px-[11px] py-[9px] font-mono text-[13px] text-text focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-weak)] focus:outline-none"
        />
        <div className="mt-[18px] flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { if (!mergeBusy) setMergeOpen(false) }}
            className="cursor-pointer rounded-[9px] border border-border bg-surface px-[14px] py-2 font-mono text-xs font-[600] tracking-[0.02em] text-muted hover:bg-bg hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={doMerge}
            disabled={mergeBusy}
            className="cursor-pointer rounded-[9px] bg-accent px-4 py-2 font-mono text-xs font-[600] tracking-[0.02em] text-white hover:brightness-[1.06] disabled:cursor-default disabled:opacity-50"
          >
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
      className="w-full min-w-[160px] rounded-md border border-accent bg-bg px-[6px] py-1 font-mono text-[13px] text-text"
    />
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

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode,
} from 'react'
import { api, type Scan } from '../api/client'
import { Modal } from './Modal'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

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
        <div className="flex items-center gap-2">
          {nSel >= 2 && (
            <Button size="sm" onClick={openMerge} className="font-mono">Merge {nSel}</Button>
          )}
          <Button
            size="sm"
            variant={clearArmed ? 'destructive' : 'ghost'}
            onClick={onClear}
            className="font-mono text-faint"
          >
            {clearArmed ? 'Click again to delete all' : 'Clear all'}
          </Button>
        </div>
      </div>

      {share && (
        <div className="break-all font-mono text-xs font-medium text-faint">
          Saved to{' '}
          <a href={share} className="text-primary no-underline hover:underline">{share}</a>
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
                <div className="flex justify-center">
                  <Checkbox
                    aria-label="Select all"
                    checked={allChecked ? true : nSel > 0 ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                  />
                </div>
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
                      <Checkbox aria-label="Select" checked={i >= 0} onCheckedChange={() => toggle(s.name)} />
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
                      className="block h-11 w-[34px] cursor-zoom-in rounded-[3px] border border-border bg-background object-cover"
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
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{s.dpi || '—'}</td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{fmtSize(s.size)}</td>
                  <td className="whitespace-nowrap font-mono text-xs tabular-nums text-faint">{ago(s.mtime)}</td>
                  <td>
                    <div className="flex justify-end gap-[2px] whitespace-nowrap">
                      <Button asChild variant="ghost" size="icon-sm" title="Download" aria-label="Download">
                        <a href={api.fileUrl(s.name)} download><IconDownload /></a>
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setRenaming(s.name)} title="Rename" aria-label="Rename">
                        <IconRename />
                      </Button>
                      <Button
                        variant={removeArmed === s.name ? 'destructive' : 'ghost'}
                        size="icon-sm"
                        onClick={() => onRemove(s.name)}
                        title={removeArmed === s.name ? 'Click again to delete' : 'Remove'}
                        aria-label="Remove"
                      >
                        <IconRemove />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {scans.length === 0 && (
        <p className="px-[2px] py-4 text-sm text-muted-foreground">No scans yet. Place a page on the glass and press Scan.</p>
      )}

      {preview && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-card p-1 shadow-lg"
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
        <p className="m-0 mb-4 text-[12.5px] leading-[1.45] text-muted-foreground">
          Combining {mergeNames.current.length} scans into one PDF, in the order you selected. The originals are removed after merging.
        </p>
        <label htmlFor="mergeName" className="mb-[6px] block font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-faint">
          Name <span className="font-medium normal-case tracking-normal opacity-70">optional</span>
        </label>
        <Input
          id="mergeName"
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
          className="font-mono"
        />
        <div className="mt-[18px] flex justify-end gap-2">
          <Button variant="outline" onClick={() => { if (!mergeBusy) setMergeOpen(false) }}>Cancel</Button>
          <Button onClick={doMerge} disabled={mergeBusy}>{mergeBusy ? 'Merging…' : 'Merge'}</Button>
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
    <Input
      autoFocus
      maxLength={80}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true) }
        else if (e.key === 'Escape') { commit(false) }
      }}
      onBlur={() => commit(true)}
      className="h-8 min-w-[160px] font-mono"
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

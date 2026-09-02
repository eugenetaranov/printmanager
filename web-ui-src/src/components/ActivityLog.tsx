import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export interface LogEntry {
  id: string
  content: ReactNode
  undo?: () => Promise<void> | void
  undone?: boolean
  undoing?: boolean
}

interface LogValue {
  entries: LogEntry[]
  push: (content: ReactNode, undo?: () => Promise<void> | void) => void
  runUndo: (id: string) => void
}

const Ctx = createContext<LogValue | null>(null)
let seq = 0

export function ActivityLogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const push = useCallback((content: ReactNode, undo?: () => Promise<void> | void) => {
    setEntries((es) => [...es, { id: 'e' + ++seq, content, undo }].slice(-30))
  }, [])

  const runUndo = useCallback((id: string) => {
    const e = entriesRef.current.find((x) => x.id === id)
    if (!e || !e.undo || e.undone || e.undoing) return
    const set = (patch: Partial<LogEntry>) => setEntries((es) => es.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    set({ undoing: true })
    Promise.resolve(e.undo())
      .then(() => set({ undone: true, undoing: false }))
      .catch(() => set({ undoing: false }))
  }, [])

  const value = useMemo(() => ({ entries, push, runUndo }), [entries, push, runUndo])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActivityLog(): LogValue {
  const c = useContext(Ctx)
  if (!c) throw new Error('useActivityLog must be used within ActivityLogProvider')
  return c
}

// Footer: newest event prominent with an Undo button; older events subtle, each
// still undoable.
export function ActivityFooter() {
  const { entries, runUndo } = useActivityLog()
  if (entries.length === 0) return null
  const latest = entries[entries.length - 1]
  const older = entries.slice(0, -1).reverse()
  return (
    <footer className="mt-10 border-t border-base-300 pt-4">
      <div className="mb-1 font-mono text-[10px] font-[700] uppercase tracking-[0.06em] text-base-content/45">Activity</div>
      <LogRow entry={latest} onUndo={runUndo} prominent />
      {older.length > 0 && (
        <div className="mt-1">
          {older.map((e) => <LogRow key={e.id} entry={e} onUndo={runUndo} />)}
        </div>
      )}
    </footer>
  )
}

function LogRow({ entry, onUndo, prominent }: { entry: LogEntry; onUndo: (id: string) => void; prominent?: boolean }) {
  return (
    <div className={'flex items-center justify-between gap-3 ' + (prominent ? 'rounded-md bg-base-200 px-3 py-2' : 'px-3 py-[3px] opacity-55')}>
      <span className={'min-w-0 truncate font-mono ' + (prominent ? 'text-[13px]' : 'text-[12px]') + (entry.undone ? ' text-base-content/45 line-through' : '')}>
        {entry.content}
      </span>
      {entry.undo && !entry.undone ? (
        <button
          type="button"
          onClick={() => onUndo(entry.id)}
          disabled={entry.undoing}
          className={'btn btn-ghost flex-none font-mono ' + (prominent ? 'btn-sm' : 'btn-xs')}
        >
          {entry.undoing ? 'Undoing…' : 'Undo'}
        </button>
      ) : entry.undone ? (
        <span className="flex-none font-mono text-[11px] text-base-content/45">undone</span>
      ) : null}
    </div>
  )
}

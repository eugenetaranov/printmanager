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

// Footer: a uniform list of recent events, newest first, each undoable.
export function ActivityFooter() {
  const { entries, runUndo } = useActivityLog()
  if (entries.length === 0) return null
  const rows = [...entries].reverse()
  return (
    <footer className="mt-10 w-full border-t border-base-300 pt-3">
      <h2 className="m-0 mb-2 text-body font-[640] tracking-[0.02em]">Activity</h2>
      <div className="divide-y divide-base-200">
        {rows.map((e) => <LogRow key={e.id} entry={e} onUndo={runUndo} />)}
      </div>
    </footer>
  )
}

function LogRow({ entry, onUndo }: { entry: LogEntry; onUndo: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[6px]">
      <span className={'min-w-0 truncate font-mono text-body ' + (entry.undone ? 'text-base-content/60 line-through' : 'text-base-content')}>
        {entry.content}
      </span>
      {entry.undo && !entry.undone ? (
        <button type="button" onClick={() => onUndo(entry.id)} disabled={entry.undoing} className="btn btn-ghost btn-xs w-16 flex-none">
          {entry.undoing ? '…' : 'Undo'}
        </button>
      ) : (
        <span className="w-16 flex-none text-right font-mono text-2xs text-base-content/60">{entry.undone ? 'undone' : ''}</span>
      )}
    </div>
  )
}

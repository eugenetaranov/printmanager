import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { printQueue, type QueueState } from '../api/client'

// The print queue lives on the Pi so every device sees the same items. Poll it
// every 3 s while the page is visible: that keeps the header/tab count fresh
// and doubles as the heartbeat a waiting release worker needs to keep going.
const EMPTY: QueueState = { items: [], running: false, message: '', targets: [] }
const POLL_MS = 3000

interface QueueValue {
  state: QueueState
  loaded: boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<QueueValue | null>(null)

export function QueueProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<QueueState>(EMPTY)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(
    () => printQueue.state().then((s) => { setState(s); setLoaded(true) }).catch(() => {}),
    [],
  )

  useEffect(() => {
    refresh()
    const id = window.setInterval(() => { if (!document.hidden) refresh() }, POLL_MS)
    const onVis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  const value = useMemo(() => ({ state, loaded, refresh }), [state, loaded, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useQueue(): QueueValue {
  const c = useContext(Ctx)
  if (!c) throw new Error('useQueue must be used within QueueProvider')
  return c
}

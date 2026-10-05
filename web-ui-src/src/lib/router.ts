import { useSyncExternalStore, useCallback } from 'react'

// Four tabs; the URL path matches the tab name (scan / labels / print / queue).
export type TabId = 'scan' | 'labels' | 'print' | 'queue'

const TAB_TO_PATH: Record<TabId, string> = {
  scan: '/scan',
  labels: '/labels',
  print: '/print',
  queue: '/queue',
}

export function pathToTab(pathname: string): TabId {
  const p = pathname.replace(/\/+$/, '')
  if (p === '/labels') return 'labels'
  if (p === '/print') return 'print'
  if (p === '/queue') return 'queue'
  return 'scan'
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

export function useRoute(): [TabId, (tab: TabId) => void] {
  const tab = useSyncExternalStore(
    subscribe,
    () => pathToTab(window.location.pathname),
    () => 'scan' as TabId,
  )
  const navigate = useCallback((next: TabId) => {
    history.pushState({ tab: next }, '', TAB_TO_PATH[next])
    // pushState does not emit popstate; nudge subscribers so the store re-reads.
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])
  return [tab, navigate]
}

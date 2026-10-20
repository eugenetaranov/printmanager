import { useSyncExternalStore, useCallback } from 'react'

// Three tabs; the URL path matches the tab name (scan / queue / print).
export type TabId = 'scan' | 'print' | 'queue'

const TAB_TO_PATH: Record<TabId, string> = {
  scan: '/scan',
  print: '/print',
  queue: '/queue',
}

// The Labels tab became the Queue tab's Customize section; keep old links working.
if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/labels') {
  history.replaceState(null, '', '/queue' + window.location.search + window.location.hash)
}

export function pathToTab(pathname: string): TabId {
  const p = pathname.replace(/\/+$/, '')
  if (p === '/print') return 'print'
  if (p === '/scan') return 'scan'
  // The label home is where most visits start, so `/` (and anything unknown) opens it.
  return 'queue'
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

export function useRoute(): [TabId, (tab: TabId) => void] {
  const tab = useSyncExternalStore(
    subscribe,
    () => pathToTab(window.location.pathname),
    () => 'queue' as TabId,
  )
  const navigate = useCallback((next: TabId) => {
    history.pushState({ tab: next }, '', TAB_TO_PATH[next])
    // pushState does not emit popstate; nudge subscribers so the store re-reads.
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])
  return [tab, navigate]
}

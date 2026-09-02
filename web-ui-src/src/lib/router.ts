import { useSyncExternalStore, useCallback } from 'react'

// Three tabs. Internal ids are descriptive; the URL paths are kept identical to
// the previous UI so existing deep links keep working:
//   scan   -> /scan  (also / )
//   labels -> /print      (the Labels tab lived at /print)
//   print  -> /document   (the document Print tab lived at /document)
export type TabId = 'scan' | 'labels' | 'print'

const TAB_TO_PATH: Record<TabId, string> = {
  scan: '/scan',
  labels: '/print',
  print: '/document',
}

export function pathToTab(pathname: string): TabId {
  const p = pathname.replace(/\/+$/, '')
  if (p === '/print') return 'labels'
  if (p === '/document') return 'print'
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

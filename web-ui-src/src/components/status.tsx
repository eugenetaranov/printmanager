import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type StatusState = 'idle' | 'busy' | 'error'

interface StatusValue {
  state: StatusState
  label: string
  set: (state: StatusState, label: string) => void
}

const StatusContext = createContext<StatusValue | null>(null)

export function StatusProvider({ children }: { children: ReactNode }) {
  const [{ state, label }, setStatus] = useState<{ state: StatusState; label: string }>({
    state: 'idle',
    label: 'Ready',
  })
  const value = useMemo<StatusValue>(
    () => ({ state, label, set: (s, l) => setStatus({ state: s, label: l }) }),
    [state, label],
  )
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

export function useStatus(): StatusValue {
  const ctx = useContext(StatusContext)
  if (!ctx) throw new Error('useStatus must be used within StatusProvider')
  return ctx
}

// The header status light + label, mirroring the previous UI's `.status` row.
export function StatusLed() {
  const { state, label } = useStatus()
  return (
    <span
      data-state={state}
      className="flex flex-none items-center gap-[7px] self-start pt-1 font-mono text-xs leading-none text-muted"
    >
      <span
        className={
          'h-[7px] w-[7px] rounded-full ' +
          (state === 'error' ? 'bg-danger' : 'bg-accent ') +
          (state === 'busy' ? ' [animation:pulse_1.2s_ease-in-out_infinite]' : '')
        }
      />
      {label}
    </span>
  )
}

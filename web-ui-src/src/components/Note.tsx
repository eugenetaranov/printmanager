import { useState, useCallback, type ReactNode } from 'react'

export type NoteKind = '' | 'ok' | 'err'
export interface NoteState {
  kind: NoteKind
  content: ReactNode
}

// A shared status line, matching the previous UI's `.note` element with
// `.note.ok` (accent) / `.note.err` (danger) coloring.
export function useNote() {
  const [note, setNote] = useState<NoteState>({ kind: '', content: null })
  const ok = useCallback((content: ReactNode) => setNote({ kind: 'ok', content }), [])
  const err = useCallback((content: ReactNode) => setNote({ kind: 'err', content }), [])
  const info = useCallback((content: ReactNode) => setNote({ kind: '', content }), [])
  const clear = useCallback(() => setNote({ kind: '', content: null }), [])
  return { note, ok, err, info, clear }
}

export function Note({ note }: { note: NoteState }) {
  if (!note.content) return null
  const color = note.kind === 'ok' ? 'text-primary' : note.kind === 'err' ? 'text-error' : 'text-base-content/60'
  return (
    <p aria-live="polite" className={`mt-3 font-mono text-[13px] ${color}`}>
      {note.content}
    </p>
  )
}

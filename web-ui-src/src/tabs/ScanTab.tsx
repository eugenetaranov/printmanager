import { useEffect, useRef, useState } from 'react'
import { api, type AppConfig } from '../api/client'
import { useStatus } from '../components/status'
import { useNote, Note } from '../components/Note'
import { RecentScans, type RecentScansHandle } from '../components/RecentScans'

export function ScanTab() {
  const status = useStatus()
  const { note, ok, err, info, clear } = useNote()
  const recent = useRef<RecentScansHandle>(null)

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState('')
  const [resolution, setResolution] = useState('')
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    api.config().then((c) => {
      setConfig(c)
      setMode(c.defaultMode)
      setResolution(c.defaultResolution)
    })
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (scanning) return
    setScanning(true)
    clear()
    status.set('busy', 'Scanning')
    api.scan({ name, mode, resolution })
      .then((d) => {
        if (d.ok && d.file) {
          status.set('idle', 'Ready')
          ok(
            <>
              Saved {d.file} · {d.seconds}s —{' '}
              <a href={api.fileUrl(d.file)} target="_blank" rel="noopener" className="text-accent underline">open</a>
            </>,
          )
          setName('')
          recent.current?.refresh(d.file)
        } else {
          status.set('error', 'Failed')
          err(d.error || 'Scan failed.')
        }
      })
      .catch(() => {
        status.set('error', 'Failed')
        err('Could not reach the scanner service.')
      })
      .finally(() => setScanning(false))
  }

  const hasModes = (config?.modes.length ?? 0) > 0
  const hasRes = (config?.resolutions.length ?? 0) > 0

  return (
    <>
      <form onSubmit={submit} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        {(hasModes || hasRes) && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            {hasModes && (
              <label className="flex flex-col gap-[6px]">
                <span className="font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-faint">Mode</span>
                <Select value={mode} onChange={setMode} options={config!.modes.map((m) => ({ value: m.value, label: m.label }))} />
              </label>
            )}
            {hasRes && (
              <label className="flex flex-col gap-[6px]">
                <span className="font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-faint">Resolution</span>
                <Select value={resolution} onChange={setResolution} options={config!.resolutions.map((r) => ({ value: r, label: r }))} />
              </label>
            )}
          </div>
        )}

        <label className="flex flex-col gap-[6px]">
          <span className="font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-faint">
            Name <span className="font-medium normal-case tracking-normal opacity-70">optional</span>
          </span>
          <input
            type="text"
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="auto: scan-YYYYMMDD-HHMMSS"
            className="rounded-[9px] border border-border bg-bg px-3 py-[10px] font-mono text-[13px] text-text placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-weak)] focus:outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={scanning}
          className="mt-4 w-full cursor-pointer rounded-xl bg-primary px-4 py-[14px] text-[15px] font-[640] text-primary-ink transition-[filter] hover:brightness-110 disabled:cursor-default disabled:opacity-70"
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>

        {scanning && (
          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-border" aria-hidden="true">
            <div className="h-full w-2/5 rounded-full bg-accent [animation:slide_1.1s_ease-in-out_infinite]" />
          </div>
        )}

        <Note note={note} />
      </form>

      <RecentScans
        ref={recent}
        share={config?.share ?? ''}
        onNote={(kind, content) => (kind === 'ok' ? ok(content) : kind === 'err' ? err(content) : info(content))}
      />
    </>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[9px] border border-border bg-bg px-3 py-[10px] font-mono text-[13px] text-text focus:border-accent focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

import { useEffect, useRef, useState } from 'react'
import { api, type AppConfig } from '../api/client'
import { useStatus } from '../components/status'
import { useNote, Note } from '../components/Note'
import { RecentScans, type RecentScansHandle } from '../components/RecentScans'
import { useActivityLog } from '../components/ActivityLog'

export function ScanTab() {
  const status = useStatus()
  const { note, ok, err, info, clear } = useNote()
  const { push } = useActivityLog()
  const recent = useRef<RecentScansHandle>(null)

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState('')
  const [resolution, setResolution] = useState('')
  const [cap, setCap] = useState(0)   // MB; 0 = no limit
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
    api.scan({ name, mode, resolution, maxMb: cap > 0 ? cap : undefined })
      .then((d) => {
        if (d.ok && d.file) {
          status.set('idle', 'Ready')
          const file = d.file
          const mb = d.size ? ` · ${(d.size / 1048576).toFixed(1)} MB` : ''
          push(
            <>
              Saved {file} · {d.seconds}s{mb} —{' '}
              <a href={api.fileUrl(file)} target="_blank" rel="noopener" className="link">open</a>
            </>,
            async () => { await api.remove(file); recent.current?.refresh() },
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
      <form onSubmit={submit} className="card mx-auto w-full max-w-[600px] border border-base-300 bg-base-100 p-5 shadow-sm">
        {config === null ? (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <FieldSkeleton /><FieldSkeleton />
          </div>
        ) : hasModes || hasRes ? (
          <div className="mb-4 grid grid-cols-2 gap-3">
            {hasModes && (
              <label className="flex flex-col gap-[6px]">
                <span className="field-label">Mode</span>
                <Select value={mode} onChange={setMode} options={config.modes.map((m) => ({ value: m.value, label: m.label }))} />
              </label>
            )}
            {hasRes && (
              <label className="flex flex-col gap-[6px]">
                <span className="field-label">Resolution</span>
                <Select value={resolution} onChange={setResolution} options={config.resolutions.map((r) => ({ value: r, label: r }))} />
              </label>
            )}
          </div>
        ) : null}

        <label className="flex flex-col gap-[6px]">
          <span className="field-label">
            Name <span className="font-medium normal-case tracking-normal opacity-70">optional</span>
          </span>
          <input
            type="text"
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="auto: scan-YYYYMMDD-HHMMSS"
            className="input w-full font-mono"
          />
        </label>

        <div className="mt-4">
          <div className="mb-[6px] flex items-baseline justify-between">
            <label htmlFor="scanCap" className="field-label">
              Max size <span className="font-medium normal-case tracking-normal opacity-70">optional</span>
            </label>
            <span className="font-mono text-xs text-base-content/70">{cap === 0 ? 'No limit' : `${cap} MB`}</span>
          </div>
          <input id="scanCap" type="range" min={0} max={10} step={1} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="range range-sm w-full" />
          <div className="mt-1 flex justify-between px-[2px] font-mono text-2xs text-base-content/60">
            <span>Off</span><span>10 MB</span>
          </div>
        </div>

        <button type="submit" disabled={scanning} className="btn btn-primary btn-block btn-lg mt-4">
          {scanning ? 'Scanning…' : 'Scan'}
        </button>

        {scanning && (
          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-base-300" aria-hidden="true">
            <div className="h-full w-2/5 rounded-full bg-primary [animation:slide_1.1s_ease-in-out_infinite]" />
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

function FieldSkeleton() {
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="skeleton h-[13px] w-16 rounded" />
      <div className="skeleton h-10 w-full rounded" />
    </div>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="select w-full font-mono"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

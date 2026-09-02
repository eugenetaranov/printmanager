import { useEffect, useRef, useState } from 'react'
import { api, type AppConfig } from '../api/client'
import { useStatus } from '../components/status'
import { useNote, Note } from '../components/Note'
import { RecentScans, type RecentScansHandle } from '../components/RecentScans'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Field, PlainSelect } from '../components/form'

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
              <a href={api.fileUrl(d.file)} target="_blank" rel="noopener" className="text-primary underline">open</a>
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
      <Card className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {(hasModes || hasRes) && (
            <div className="grid grid-cols-2 gap-3">
              {hasModes && (
                <Field label="Mode">
                  <PlainSelect value={mode} onChange={setMode} options={config!.modes.map((m) => [m.value, m.label])} />
                </Field>
              )}
              {hasRes && (
                <Field label="Resolution">
                  <PlainSelect value={resolution} onChange={setResolution} options={config!.resolutions.map((r) => [r, r])} />
                </Field>
              )}
            </div>
          )}

          <Field label={<>Name <span className="font-normal normal-case tracking-normal opacity-70">optional</span></>} htmlFor="scanName">
            <Input
              id="scanName"
              maxLength={80}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="auto: scan-YYYYMMDD-HHMMSS"
              className="font-mono"
            />
          </Field>

          <Button type="submit" size="lg" disabled={scanning} className="h-11 w-full text-[15px]">
            {scanning ? 'Scanning…' : 'Scan'}
          </Button>

          {scanning && (
            <div className="h-[3px] overflow-hidden rounded-full bg-border" aria-hidden="true">
              <div className="h-full w-2/5 rounded-full bg-primary [animation:slide_1.1s_ease-in-out_infinite]" />
            </div>
          )}

          <Note note={note} />
        </form>
      </Card>

      <RecentScans
        ref={recent}
        share={config?.share ?? ''}
        onNote={(kind, content) => (kind === 'ok' ? ok(content) : kind === 'err' ? err(content) : info(content))}
      />
    </>
  )
}

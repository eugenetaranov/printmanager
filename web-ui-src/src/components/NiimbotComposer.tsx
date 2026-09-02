import { useEffect, useRef, useState } from 'react'
import { niimbot as nb } from '../api/client'
import { useStatus } from './status'
import { readImageB64, type ThermalFormat } from '../lib/formats'

type Kind = 'text' | 'image' | 'qr'

export function NiimbotComposer({
  format,
  onNote,
  onEnsureConnected,
}: {
  format: ThermalFormat
  onNote: (kind: '' | 'ok' | 'err', msg: string) => void
  onEnsureConnected: (fmt: ThermalFormat, then: () => void) => void
}) {
  const status = useStatus()
  const [kind, setKind] = useState<Kind>('text')
  const [text, setText] = useState('')
  const [imgB64, setImgB64] = useState('')
  const [imgUrl, setImgUrl] = useState('')
  const [previewPng, setPreviewPng] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const hasContent = kind === 'image' ? !!imgB64 : !!text.trim()

  // WYSIWYG preview via /niimbot/preview (no BLE — works before connecting).
  useEffect(() => {
    if (!hasContent) { setPreviewPng(''); return }
    const body =
      kind === 'image'
        ? { kind, dataB64: imgB64, model: format.model, w_mm: format.w, h_mm: format.h }
        : { kind, text: text.trim(), model: format.model, w_mm: format.w, h_mm: format.h }
    const id = window.setTimeout(() => {
      abort.current?.abort()
      abort.current = new AbortController()
      // Preview uses the typed client shape; abort handled by re-render/unmount.
      nb.preview(body)
        .then((d) => setPreviewPng(d.ok && d.png ? d.png : ''))
        .catch(() => {})
    }, 250)
    return () => window.clearTimeout(id)
  }, [kind, text, imgB64, format.model, format.w, format.h, hasContent])

  const loadImage = (f?: File | null) => {
    if (!f) { setImgB64(''); setImgUrl(''); return }
    readImageB64(f).then(({ b64, dataUrl }) => { setImgB64(b64); setImgUrl(dataUrl); setKind('image') })
  }

  const doPrint = () => {
    setBusy(true)
    status.set('busy', 'Printing')
    onNote('', '')
    const body =
      kind === 'image'
        ? { kind, dataB64: imgB64, address: format.address }
        : { kind, text: text.trim(), address: format.address }
    nb.print(body)
      .then((r) => {
        if (r.ok) { status.set('idle', 'Ready'); onNote('ok', 'Printed label ✓') }
        else { status.set('error', 'Failed'); onNote('err', (r.error as string) || 'Print failed.') }
      })
      .catch(() => { status.set('error', 'Failed'); onNote('err', 'Print failed.') })
      .finally(() => setBusy(false))
  }

  const onPrint = () => {
    if (busy || !hasContent) return
    if (!format.connected) onEnsureConnected(format, doPrint)
    else doPrint()
  }

  return (
    <div>
      <p className="text-xs text-base-content/45">Label {format.w}×{format.h} mm — change the roll size in Devices</p>

      <Seg value={kind} onChange={setKind} options={[['text', 'Text'], ['image', 'Image'], ['qr', 'QR']]} />

      {kind !== 'image' ? (
        <label className="mt-3 flex flex-col gap-[6px]">
          <span className="field-label">
            {kind === 'qr' ? 'Text or URL' : <>Text <span className="normal-case opacity-70">one line per row</span></>}
          </span>
          <textarea
            rows={2}
            maxLength={kind === 'qr' ? 512 : 200}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'qr' ? 'e.g. https://example.com or any text' : 'e.g. 42 — or a short\nlabel on two lines'}
            className="textarea w-full font-mono"
          />
        </label>
      ) : (
        <div className="mt-3">
          <input type="file" accept="image/*" onChange={(e) => loadImage(e.target.files?.[0])} className="text-body" />
          {imgUrl && (
            <div className="relative mt-2 inline-block">
              <img src={imgUrl} alt="" className="max-h-32 rounded border border-base-300" />
              <button type="button" onClick={() => loadImage(null)} aria-label="Remove image" className="btn btn-circle btn-error btn-xs absolute -right-2 -top-2">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6 18 18M18 6 6 18" /></svg>
              </button>
            </div>
          )}
          <div className="mt-1 text-2xs text-base-content/45">Tip: paste an image with ⌘V / Ctrl+V</div>
        </div>
      )}

      {previewPng && (
        <div className="mt-4">
          <span className="field-label">Preview</span>
          <div className="mt-[6px] inline-block rounded-lg border border-base-300 bg-white p-[7px] shadow-sm">
            <img src={previewPng} alt="Label preview" className="block max-w-full" />
          </div>
        </div>
      )}

      <hr className="my-4 border-t border-base-300" />
      <button type="button" onClick={onPrint} disabled={busy || !hasContent} className="btn btn-primary btn-block btn-lg">
        {busy ? 'Printing…' : 'Print label'}
      </button>
    </div>
  )
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div role="tablist" className="tabs tabs-box tabs-sm mt-3 inline-flex w-auto">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={'tab ' + (value === v ? 'tab-active' : '')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

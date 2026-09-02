import { useState } from 'react'
import { Modal } from './Modal'
import { templates as tplApi, type Template } from '../api/client'

const FIELDS: { key: string; label: string; step?: number }[] = [
  { key: 'cols', label: 'Columns' },
  { key: 'rows', label: 'Rows' },
  { key: 'cell_w', label: 'Cell W (mm)', step: 0.1 },
  { key: 'cell_h', label: 'Cell H (mm)', step: 0.1 },
  { key: 'margin_l', label: 'Left margin', step: 0.1 },
  { key: 'margin_t', label: 'Top margin', step: 0.1 },
  { key: 'gap_x', label: 'Gap X', step: 0.1 },
  { key: 'gap_y', label: 'Gap Y', step: 0.1 },
]

type Draft = { id?: string; name: string; vals: Record<string, string> }

function draftFrom(t?: Template): Draft {
  const vals: Record<string, string> = {}
  for (const f of FIELDS) vals[f.key] = String(t?.[f.key] ?? '')
  vals.page_w = String(t?.page_w ?? 210)
  vals.page_h = String(t?.page_h ?? 297)
  return { id: t?.id, name: t?.name ?? '', vals }
}

export function ManageLabels({
  open, onClose, templates, onChanged,
}: {
  open: boolean
  onClose: () => void
  templates: Template[]
  onChanged: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState('')
  const [armed, setArmed] = useState('')

  const save = () => {
    if (!draft) return
    setErr('')
    const body: Partial<Template> = { name: draft.name }
    if (draft.id) body.id = draft.id
    for (const key of [...FIELDS.map((f) => f.key), 'page_w', 'page_h']) body[key] = Number(draft.vals[key])
    tplApi.save(body)
      .then((r) => { if (r.ok) { setDraft(null); onChanged() } else setErr(r.error || 'Could not save.') })
      .catch(() => setErr('Could not save.'))
  }

  const remove = (id: string) => {
    if (armed !== id) { setArmed(id); window.setTimeout(() => setArmed(''), 3000); return }
    setArmed('')
    tplApi.remove(id).then(() => onChanged()).catch(() => setErr('Could not delete.'))
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="mlTitle" wide>
      <div className="mb-3 flex items-center justify-between">
        <h3 id="mlTitle" className="m-0 text-[15px] font-[640]">Manage A4 label sheets</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-xs btn-square">✕</button>
      </div>

      {draft ? (
        <div>
          <label className="mb-3 flex flex-col gap-[6px]">
            <span className="font-mono text-[11px] font-[600] uppercase tracking-[0.04em] text-base-content/45">Name</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input w-full font-mono" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-[4px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-base-content/45">{f.label}</span>
                <input type="number" step={f.step ?? 1} value={draft.vals[f.key]} onChange={(e) => setDraft({ ...draft, vals: { ...draft.vals, [f.key]: e.target.value } })} className="input input-sm w-full font-mono" />
              </label>
            ))}
          </div>
          {err && <p className="mt-2 font-mono text-[12px] text-error">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="btn btn-ghost btn-sm">Cancel</button>
            <button type="button" onClick={save} disabled={!draft.name.trim()} className="btn btn-primary btn-sm">Save</button>
          </div>
        </div>
      ) : (
        <div>
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 border-b border-base-300 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{t.name}</div>
                <div className="font-mono text-[11px] text-base-content/45">{t.cols}×{t.rows} · {Math.round(Number(t.cell_w))}×{Math.round(Number(t.cell_h))} mm{t.builtin ? ' · built-in' : ''}</div>
              </div>
              <button type="button" onClick={() => setDraft(draftFrom(t))} className="btn btn-ghost btn-sm">Edit</button>
              <button type="button" onClick={() => remove(t.id)} className={'btn btn-sm ' + (armed === t.id ? 'btn-error' : 'btn-ghost')}>{armed === t.id ? 'Confirm' : 'Delete'}</button>
            </div>
          ))}
          {err && <p className="mt-2 font-mono text-[12px] text-error">{err}</p>}
          <button type="button" onClick={() => setDraft(draftFrom())} className="btn btn-outline btn-block btn-sm mt-3 border-dashed">
            + New label sheet
          </button>
        </div>
      )}
    </Modal>
  )
}

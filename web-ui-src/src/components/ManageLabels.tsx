import { useState } from 'react'
import { Modal } from './Modal'
import { templates as tplApi, type Template } from '../api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from './form'

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
      </div>

      {draft ? (
        <div className="flex flex-col gap-3">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="font-mono" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input type="number" step={f.step ?? 1} value={draft.vals[f.key]} onChange={(e) => setDraft({ ...draft, vals: { ...draft.vals, [f.key]: e.target.value } })} className="h-8 font-mono" />
              </Field>
            ))}
          </div>
          {err && <p className="font-mono text-[12px] text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save} disabled={!draft.name.trim()}>Save</Button>
          </div>
        </div>
      ) : (
        <div>
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 border-b border-border py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{t.name}</div>
                <div className="font-mono text-[11px] text-faint">{t.cols}×{t.rows} · {Math.round(Number(t.cell_w))}×{Math.round(Number(t.cell_h))} mm{t.builtin ? ' · built-in' : ''}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDraft(draftFrom(t))}>Edit</Button>
              <Button variant={armed === t.id ? 'destructive' : 'ghost'} size="sm" onClick={() => remove(t.id)}>{armed === t.id ? 'Confirm' : 'Delete'}</Button>
            </div>
          ))}
          {err && <p className="mt-2 font-mono text-[12px] text-destructive">{err}</p>}
          <Button variant="outline" onClick={() => setDraft(draftFrom())} className="mt-3 w-full border-dashed">
            + New label sheet
          </Button>
        </div>
      )}
    </Modal>
  )
}

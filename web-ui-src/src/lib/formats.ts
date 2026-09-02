import type { Device, NiimPrinter, Template } from '../api/client'

export type A4Format = {
  v: string
  kind: 'a4'
  w: number
  h: number
  label: string
  tplId: string
  queue: string
}

export type ThermalFormat = {
  v: string
  kind: 'thermal'
  w: number
  h: number
  label: string
  name: string
  model: string
  address: string
  connected: boolean
}

export type FormatOption = A4Format | ThermalFormat

// Build the size-sorted "Label format" list: A4 sheet templates (only when a
// CUPS printer exists) + one entry per remembered Niimbot. Sorted by perimeter,
// largest first, area as tiebreak. Mirrors the previous UI's formatOptions().
export function formatOptions(
  templates: Template[],
  printers: NiimPrinter[],
  devices: Device[],
): FormatOption[] {
  const opts: FormatOption[] = []
  const cups = devices.filter((d) => d.kind === 'printer' && d.id)
  if (cups.length) {
    const queue = cups[0].id
    for (const t of templates) {
      const cw = Number(t.cell_w), ch = Number(t.cell_h)
      opts.push({
        v: 'a4:' + t.id,
        kind: 'a4',
        w: cw,
        h: ch,
        label: `${Math.round(cw)}×${Math.round(ch)}mm · A4 (${t.cols}×${t.rows})`,
        tplId: t.id,
        queue,
      })
    }
  }
  for (const p of printers) {
    const mm = p.label_mm || [12, 40]
    opts.push({
      v: 'niim:' + p.address,
      kind: 'thermal',
      w: mm[0],
      h: mm[1],
      label: `${mm[0]}×${mm[1]}mm · ${p.model_label || p.model}`,
      name: p.model_label || p.model,
      model: p.model,
      address: p.address,
      connected: p.status === 'connected',
    })
  }
  opts.sort((a, b) => {
    const pa = 2 * (a.w + a.h), pb = 2 * (b.w + b.h)
    return pb !== pa ? pb - pa : b.w * b.h - a.w * a.h
  })
  return opts
}

export function readImageB64(file: File): Promise<{ b64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      resolve({ b64: s.split(',')[1] || '', dataUrl: s })
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

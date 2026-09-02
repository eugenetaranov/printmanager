// Typed client for the scan-web JSON API. Every mutating endpoint returns an
// object carrying `ok`; on failure it also carries `error`. Filenames are always
// full names including the `.pdf` suffix (the server validates them).

export interface Scan {
  name: string
  size: number
  mtime: number
  dpi: string
  mode: string
  thumb: boolean
}

export interface OkResult {
  ok: boolean
  error?: string
}

export interface ScanResult extends OkResult {
  file?: string
  seconds?: number
}

export interface RenameResult extends OkResult {
  file?: string | null
}

export interface MergeResult extends OkResult {
  file?: string
}

export interface AppConfig {
  modes: { value: string; label: string }[]
  resolutions: string[]
  defaultMode: string
  defaultResolution: string
  share: string
  features: { print: boolean; document: boolean; devices: boolean }
}

// Sensible fallback when the backend does not (yet) expose /config: no mode /
// resolution pickers, and /scan applies its own server-side defaults.
const CONFIG_FALLBACK: AppConfig = {
  modes: [],
  resolutions: [],
  defaultMode: '',
  defaultResolution: '',
  share: '',
  features: { print: true, document: true, devices: true },
}

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

async function postForm<T>(path: string, fields: Record<string, string>): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

// --- Scans / storage --------------------------------------------------------

export const api = {
  config: () => getJSON<AppConfig>('/config').catch(() => CONFIG_FALLBACK),

  recent: () => getJSON<{ scans: Scan[] }>('/recent').then((d) => d.scans ?? []),

  scan: (opts: { name?: string; mode?: string; resolution?: string }) =>
    postForm<ScanResult>('/scan', {
      name: opts.name ?? '',
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.resolution ? { resolution: opts.resolution } : {}),
    }),

  rename: (name: string, to: string) => postForm<RenameResult>('/rename', { name, to }),

  remove: (name: string) => postForm<OkResult>('/remove', { name }),

  clear: () => postJSON<{ ok: boolean; removed: number }>('/clear'),

  merge: (names: string[], to: string) => postJSON<MergeResult>('/merge', { names, to }),

  fileUrl: (name: string) => `/file/${encodeURIComponent(name)}`,
  thumbUrl: (name: string) => `/thumb/${encodeURIComponent(name)}`,

  // --- Document printing --------------------------------------------------
  queues: () => getJSON<{ queues: Queue[]; default: string }>('/print/queues'),

  documentInfo: (dataB64: string, filename: string) =>
    postJSON<DocInfoResult>('/document/info', { dataB64, filename }),

  documentPrint: (body: {
    src_token: string
    queue: string
    sides: 'one' | 'two'
    from?: number
    to?: number
  }) => postJSON<DocPrintResult>('/document/print', body),

  documentContinue: (token: string) =>
    postJSON<DocPrintResult>('/document/continue', { token }),

  documentCancel: (token: string) => postJSON<OkResult>('/document/cancel', { token }),
}

export interface Queue {
  queue: string
  name: string
  default: boolean
}

export interface DocInfoResult extends OkResult {
  pages?: number
  token?: string
}

export interface DocPrintResult extends OkResult {
  queue?: string
  job?: string
  pages?: number
  done?: boolean
  duplex?: string
  step?: string
  token?: string
  instruction?: string
}

// --- Devices / Niimbot / templates ------------------------------------------

export interface Device {
  kind: 'printer' | 'scanner' | 'usb' | string
  id: string
  name: string
  transport: 'usb' | 'bluetooth' | 'network' | 'cups' | 'sane' | string
  status: string
  error?: string
  detail?: string
}

export interface NiimPrinter {
  address: string
  name: string
  status: string
  label_mm?: [number, number]
  model: string
  model_label?: string
}

export interface NiimCandidate {
  name: string
  address: string
  rssi?: number
}

export interface NiimState extends OkResult {
  enabled: boolean
  adapter: boolean
  printers: NiimPrinter[]
  active: string | null
  log: unknown[]
}

export interface Template {
  id: string
  name: string
  cols: number
  rows: number
  [k: string]: unknown
}

export const devices = {
  list: () => getJSON<{ devices: Device[] }>('/devices/list').then((d) => d.devices ?? []),
  refresh: () => postJSON<{ ok: boolean; devices: Device[] }>('/devices/refresh', {}),
  forget: (kind: string, id: string) => postJSON<{ ok: boolean; devices: Device[] }>('/devices/forget', { kind, id }),
  testpage: (kind: string, id: string) => postJSON<OkResult>('/devices/testpage', { kind, id }),
}

export const niimbot = {
  state: () => getJSON<NiimState>('/niimbot/state'),
  scan: () => postJSON<{ ok: boolean; candidates: NiimCandidate[]; error?: string }>('/niimbot/scan', {}),
  connect: (address: string, name?: string) => postJSON<NiimState>('/niimbot/connect', { address, name }),
  reconnect: (address: string) => postJSON<NiimState>('/niimbot/reconnect', { address }),
  disconnect: (address: string) => postJSON<NiimState>('/niimbot/disconnect', { address }),
  forget: (address: string) => postJSON<NiimState>('/niimbot/forget', { address }),
  clearlog: (address?: string) => postJSON<NiimState>('/niimbot/clearlog', { address }),
  select: (address: string) => postJSON<NiimState>('/niimbot/select', { address }),
  labelsize: (address: string, w: number, h: number) => postJSON<NiimState>('/niimbot/labelsize', { address, w, h }),
  print: (body: { kind: 'text' | 'image'; text?: string; dataB64?: string; address?: string }) =>
    postJSON<OkResult & Record<string, unknown>>('/niimbot/print', body),
  preview: (body: { kind: 'text' | 'image'; text?: string; dataB64?: string; model: string; w_mm?: number; h_mm?: number }) =>
    postJSON<{ ok: boolean; png: string; w?: number; h?: number; error?: string }>('/niimbot/preview', body),
}

export const templates = {
  list: () => getJSON<{ templates: Template[] }>('/templates').then((d) => d.templates ?? []),
  save: (tpl: Partial<Template>) => postJSON<{ ok: boolean; id?: string; templates?: Template[]; error?: string }>('/templates', tpl),
  remove: (id: string) => postJSON<{ ok: boolean; templates?: Template[]; error?: string }>('/templates/delete', { id }),
  restore: (id: string) => postJSON<{ ok: boolean; templates?: Template[]; error?: string }>('/templates/restore', { id }),
}

// A4 label-sheet print. `cells` maps a cell index to its content.
export interface SheetPrintResult extends OkResult {
  queue?: string
  count?: number
}
export function printSheet(body: {
  queue?: string
  template: string
  fontScale?: number
  calX?: number
  calY?: number
  cells: Record<string, { mode: 'text' | 'file' | 'qr'; text?: string; dataB64?: string; filename?: string }>
}) {
  return postJSON<SheetPrintResult>('/print', body)
}

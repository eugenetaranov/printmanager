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

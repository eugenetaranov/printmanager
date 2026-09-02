## Context

The web UI is a single Python file, `roles/web-ui/files/scan-web.py` (~3,300 lines,
188 KB). It is both an HTTP server and the frontend: HTML, CSS, and vanilla JS live as
Python string literals, assembled per request by `render_page()` and served from the page
routes. Data already flows through discrete JSON endpoints, so the backend is *already*
close to a JSON API — the coupling is the embedded, hand-written frontend.

Endpoint inventory the SPA must consume (all under `/`, gated by `NAME_RE` where a filename
is involved):

- **Page routes** (currently HTML): `GET /`, `/index.html`, `/scan`, `/print`, `/document`
- **Scan/storage**: `GET /recent`; `POST /scan`, `/rename`, `/remove`, `/clear`, `/merge`;
  `GET /file/<name>` (PDF stream), `/thumb/<name>` (JPEG)
- **Document print**: `POST /document/info|print|continue|cancel`; `GET /print/queues`
- **Labels**: `POST /print`; `GET/POST /templates`, `/templates/delete`, `/templates/restore`
- **Devices/Niimbot**: `GET /devices/list`, `/niimbot/state`; `POST /devices/*`, `/niimbot/*`

Constraints: the target is a LAN-only Raspberry Pi (Ubuntu 24.04, arm64) provisioned by the
`tack` tool, which today ships the UI with a single `copy:` task. The systemd unit runs the
Python server as an unprivileged `scan-web` user. There is no Node toolchain on the Pi today.

## Goals / Non-Goals

**Goals:**
- Replace the embedded frontend with a React SPA (Vite build, Tailwind v4) at **full parity**
  across all four tabs, reproducing the current bespoke look via ported design tokens.
- Keep the Python process as the single server: it serves the built static bundle **and** the
  existing JSON endpoints — no second runtime at serve time.
- Make the JSON/HTTP surface an explicit, documented contract (`web-ui-http-api`).
- Preserve provisioning as a self-contained `tack` run (no external CI/artifact dependency).

**Non-Goals:**
- No change to user-facing behavior, the systemd unit, the SMB share, or any non-web role.
- No redesign of the endpoint surface or response shapes beyond documenting them (a later
  change may clean up the API).
- No new frontend features — merge/rename/duplex/BLE behave exactly as today.
- No SSR, no client-side auth, no PWA/offline work.

## Decisions

**D1 — Vite + React SPA, served as static assets by the existing Python server.**
Page routes (`/`, `/scan`, `/print`, `/document`, and any unknown non-API path) return the
built `index.html`; a client-side router renders the right tab from the path so existing deep
links keep working. *Alternatives:* Next.js (needs a Node runtime at serve time and SSR we
don't want — rejected); keeping vanilla JS (the status quo we're leaving). React chosen for
component structure + ecosystem familiarity.

**D2 — Tailwind CSS v4, seeded from the current design tokens.**
Port the existing CSS variables (`--accent`, `--surface`, `--muted`, mono font stack,
tabular-nums) into the Tailwind theme so components reproduce today's look rather than a
generic framework skin. *Alternatives:* Bootstrap (component defaults fight the bespoke look —
rejected); ship the current CSS verbatim (works, but loses utility ergonomics). Utility-first
matches the "own JSX + utilities" direction already chosen.

**D3 — Build on the Pi during provisioning.**
The `web-ui` role installs a pinned Node LTS, copies `web-ui-src/` to the Pi, runs
`npm ci && npm run build`, and points the server at the produced `dist/`. *Alternatives:*
commit a prebuilt `dist/` (build artifacts in git — rejected); build in CI and fetch a pinned
asset (adds CI + a release/versioning step — rejected). Chosen so the repo stays source-only
and a single `tack` run remains fully self-contained. *Trade-off:* a Node toolchain and a
build step now live on the device.

**D4 — Reuse the existing JSON endpoints as the SPA contract.**
The endpoints already return `{ok, error, ...}`-shaped JSON. Document them in the
`web-ui-http-api` spec and consume them as-is; the only backend change is swapping the page
routes from `render_page()` to static-file serving (with an SPA fallback to `index.html`).

**D5 — Dev workflow via Vite proxy.**
`npm run dev` runs the Vite dev server; a proxy forwards the API path prefixes
(`/scan`, `/recent`, `/merge`, `/document`, `/file`, `/thumb`, `/devices`, `/niimbot`,
`/templates`, `/print`) to a running Python backend (a dev box or the Pi), so the frontend is
developed and tested in isolation against the real API.

**D6 — Project layout.**
```
web-ui-src/                 # new React/Vite/Tailwind project (committed source only)
  package.json  vite.config.ts  tailwind/theme
  src/{main.tsx, App, tabs/{Scan,Labels,Print,Devices}, components/, api/, hooks/}
roles/web-ui/
  files/scan-web.py         # retained backend; page routes now serve dist/
  tasks/main.yaml           # + Node install, ship web-ui-src, npm ci && vite build
```
No `dist/` is committed; it is produced on the Pi under the server's static root
(e.g. `/usr/local/lib/scan-web/webui-dist`).

**D7 — One-shot cutover, old UI retained until parity.**
Develop the SPA to full parity against the live API first. The embedded HTML keeps serving on
`main` until a single cutover commit flips the page routes to the bundle and deletes the
embedded block. Rollback = revert that commit.

## Risks / Trade-offs

- **ARM build headroom** (a Pi may be slow or OOM on `vite build`) → pin Node LTS, cap heap
  (`NODE_OPTIONS=--max-old-space-size`), keep the bundle small (no heavy deps); if the device
  can't build reliably, fall back to a committed/CI-built bundle (D3 alternatives are the
  escape hatch). **Confirm the Pi can build before committing to build-on-Pi.**
- **Toolchain footprint on the device** (Node + node_modules disk) → install Node for build,
  `npm ci --omit=dev` where possible, and optionally prune `node_modules` after a successful
  build since only `dist/` is served.
- **Complex custom widgets** (Niimbot BLE composer, the schematic label preview, the
  page-range slider) are the hardest to port faithfully → isolate each as its own component and
  verify against hardware (BLE label print) and visually (schematic) per the parity checklist.
- **Behavior drift from parity** → the `web-ui-http-api` spec pins the contract, and a per-tab
  parity checklist (in tasks) gates cutover.
- **Loss of single-file deploy simplicity** → accepted; the win is a testable, component-based
  frontend. The backend remains a single Python process.
- **First-provision latency** (build runs on device) → accepted; steady-state serving is
  faster (static assets vs per-request render).

## Migration Plan

1. Scaffold `web-ui-src/` (Vite + React + Tailwind), theme seeded from current tokens.
2. Port tab-by-tab against a running backend via the Vite proxy: Scan → Print → Labels →
   Devices, checking each against the current UI.
3. Add build-on-Pi steps to the `web-ui` role (Node install, ship src, `npm ci`, `vite build`)
   — not yet serving the bundle.
4. Verify parity on the Pi (all four tabs, incl. a real BLE label print and a scan→merge).
5. **Cutover** (single commit): switch the Python page routes to serve `dist/index.html` with
   SPA fallback; remove the embedded HTML/CSS/JS block from `scan-web.py`.
6. **Rollback**: revert the cutover commit — the embedded UI returns; no data migration.

## Open Questions

- Can the specific Pi model reliably run `vite build` (RAM/time)? If not, switch to a
  committed or CI-built bundle (the D3 alternatives) — decide after a build smoke test.
- Prune `node_modules` after build to reclaim disk, or keep it for faster re-provisions?

## Resolved during implementation

- **TypeScript**, not JSX-only (chosen for API-shape safety; the client is fully typed).
- **Light + dark theming is in scope** — both token sets ported and driven by
  `prefers-color-scheme`, matching the previous UI.
- **Devices is a modal, not a tab.** The real UI has **three** tabs (Scan; Labels at `/print`;
  Print at `/document`) plus a Devices modal opened from a header icon. Tasks/specs that said
  "four tabs" are corrected — see tasks group 6.
- **A `GET /config` endpoint is required.** The old server injected scan mode/resolution
  options, defaults, the share URL, and feature flags as template placeholders; the SPA needs
  them as JSON. Added as task 7.4; the client (`api.config()`) already degrades gracefully when
  it is absent.

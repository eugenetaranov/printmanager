## 1. Project scaffold

- [x] 1.1 Create `web-ui-src/` with a Vite + React project (TypeScript); add `package.json`,
  `vite.config.ts`, `tsconfig.json`, and pin Node/npm engine versions.
- [x] 1.2 Add and configure Tailwind CSS v4 (Vite plugin, base stylesheet).
- [x] 1.3 Port the current UI's design tokens (accent/surface/muted colors, mono font stack,
  tabular-nums, radii, shadows) into the Tailwind theme; add a light/dark decision per design
  open question.
- [x] 1.4 Configure the Vite dev-server proxy to forward API path prefixes (`/scan`, `/recent`,
  `/rename`, `/remove`, `/clear`, `/merge`, `/file`, `/thumb`, `/document`, `/print`,
  `/templates`, `/devices`, `/niimbot`) to a running Python backend.
- [x] 1.5 Verify `npm ci && npm run build` produces a `dist/` bundle and `npm run dev` serves
  the shell against the proxied backend.

## 2. Shared foundation

- [x] 2.1 Build a typed API client module wrapping the JSON endpoints, with a shared
  `{ok, error}` response type and filename-safe helpers.
- [x] 2.2 Implement the app shell: tab layout, client-side router mapping `/scan`, `/print`,
  `/document`, `/devices` to tabs, and the shared status/"note" component (ok/err styles).
- [x] 2.3 Port shared primitives: buttons, segmented control, inline-edit field, arm/confirm
  (destructive) button, and toast/note behavior.

## 3. Scan tab

- [x] 3.1 Scan form (name/mode/resolution) calling `POST /scan`; busy/error states.
- [x] 3.2 Recent-scans table from `GET /recent` with thumbnails (`/thumb/<name>`), size, age.
- [x] 3.3 Row actions: download (`/file/<name>`), inline rename (`POST /rename`, single-submit,
  no spurious error), arm/confirm remove (`POST /remove`), and Clear all (`POST /clear`).
- [x] 3.4 Multi-select + tick-order merge: checkbox column with order badges, select-all, name
  prompt, `POST /merge`; sources removed on success only.
- [x] 3.5 Hover thumbnail preview.

## 4. Print (document) tab

- [x] 4.1 File/upload input driving `POST /document/info` (page count, capabilities).
- [x] 4.2 Print controls: single/double-sided, page range selector; `POST /document/print`.
- [x] 4.3 Guided manual-duplex flow via `/document/continue` and `/document/cancel`.
- [x] 4.4 Queue selection from `GET /print/queues`.

## 5. Labels tab

- [ ] 5.1 Niimbot label composer (text/image/QR content, the schematic preview) → `POST /print`.
- [ ] 5.2 Label template management: list/create/edit via `/templates`, delete/restore via
  `/templates/delete` and `/templates/restore`.

## 6. Devices modal (opened from the header icon, not a tab)

- [x] 6.1 Devices modal: hardware inventory from `GET /devices/list` and Niimbot state from `GET /niimbot/state` (the real UI opens this from the header printer icon; there are only 3 tabs).
- [x] 6.2 Device actions and connect-on-demand BLE flow via `POST /devices/*`, `/niimbot/*`.

## 7. Backend: serve the SPA

- [ ] 7.1 Replace the embedded-HTML page routes in `scan-web.py` with static-asset serving of
  the built `dist/` (correct content types, caching for hashed assets).
- [ ] 7.2 Add SPA fallback: unknown non-API, non-asset paths return `index.html`; keep all JSON
  endpoints and `NAME_RE` filename validation unchanged.
- [ ] 7.3 Delete the embedded HTML/CSS/JS string block once serving `dist/` (the cutover edit).
- [ ] 7.4 Add a `GET /config` JSON endpoint exposing what the old UI injected as template
  placeholders: scan mode/resolution options + defaults, the SMB share URL, and feature flags
  (print / document / devices enabled). The SPA reads it on load (`api.config()`).

## 8. Provisioning (web-ui tack role)

- [ ] 8.1 Add a pinned Node LTS install step to `roles/web-ui/tasks/main.yaml`.
- [ ] 8.2 Ship `web-ui-src/` to the Pi and run `npm ci && npm run build` into the server's
  static root (e.g. `/usr/local/lib/scan-web/webui-dist`); notify Restart scan-web.
- [ ] 8.3 Build-headroom smoke test on the target Pi (RAM/time); if it can't build reliably,
  switch to a committed/CI-built bundle per the design's D3 alternatives.
- [ ] 8.4 Decide and implement `node_modules` retention vs prune after a successful build.

## 9. Parity verification and cutover

- [ ] 9.1 Per-tab parity checklist vs the current UI (Scan, Print, Labels, Devices), including a
  real scan→merge and a real BLE label print on the Pi.
- [ ] 9.2 Confirm deep links (`/scan`, `/print`, `/document`, `/devices`) resolve to the right
  tab and the SPA fallback works.
- [ ] 9.3 Cut over on the Pi (deploy the role), verify end-to-end, and document rollback (revert
  the cutover commit).

## 10. Docs and cleanup

- [ ] 10.1 Update `README.md` and any web-ui role docs to describe the SPA source tree, dev
  workflow (Vite proxy), and the build-on-Pi provisioning step.
- [x] 10.2 Add `web-ui-src/` build outputs (`dist/`, `node_modules/`) to `.gitignore`.

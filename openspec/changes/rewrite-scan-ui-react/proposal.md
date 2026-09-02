## Why

The scan-web UI is a single 188 KB Python file (`roles/web-ui/files/scan-web.py`) that
embeds all HTML, CSS, and vanilla JS as string literals rendered by hand. Every UI change
means editing JS-in-Python with no components, no type checking, no build step, and no way
to test the frontend in isolation — the recent "not found" and merge work all had to be
verified by string-grepping the served page. As the UI has grown to four tabs (Scan,
Labels, Print, Devices) this approach no longer scales. Moving to a React single-page app
with a real build gives us components, a testable frontend, and a clean separation from the
Python backend, which already exposes almost everything the UI needs as JSON endpoints.

## What Changes

- Add a React single-page app (Vite build, **Tailwind CSS v4** for styling) under a new
  `web-ui-src/` source tree, reproducing today's UI at **full parity** across all four tabs
  (Scan + recent-scans list with rename/remove/merge/thumbnails; Labels/Niimbot composer;
  Print/document duplex; Devices inventory + BLE connect).
- Reproduce the current bespoke look by porting the existing CSS variables and mono type
  system into the Tailwind theme — not a generic framework restyle.
- **BREAKING (internal):** the Python server stops rendering embedded HTML/CSS/JS. Its
  page routes (`/`, `/scan`, `/print`, `/document`) serve the built SPA's static assets
  instead; all data flows through the existing JSON/HTTP endpoints, which become the
  documented, stable contract the SPA consumes.
- The `web-ui` tack role installs Node on the Pi and runs `npm ci && vite build` during
  provisioning, then serves the resulting `dist/` bundle. No behavior change for end users.
- No change to user-facing behavior, the systemd unit, the SMB share, or any other role.

## Capabilities

### New Capabilities
- `web-ui-application`: the React + Tailwind single-page app — its component structure,
  full-parity coverage of the four tabs, client-side behaviors (selection/merge, inline
  rename, tab routing, thumbnail preview, label composer), and the Vite build that produces
  the deployable bundle.
- `web-ui-http-api`: the JSON/HTTP contract the SPA consumes and the Python backend serves —
  the endpoint surface (scan, recent, rename, remove, clear, merge, file/thumb, document/*,
  print, devices/*, niimbot/*, templates*), request/response shapes, and the backend's shift
  from serving embedded HTML to serving the static SPA bundle plus JSON.

### Modified Capabilities
<!-- None. The rewrite preserves all existing user-facing behavior (full parity), so no
     existing spec's REQUIREMENTS change — only the UI's implementation technology. The
     scanning, storage, printing, duplex, label, and device capabilities are untouched. -->

## Impact

- **Code**: replaces the embedded HTML/CSS/JS block in
  `roles/web-ui/files/scan-web.py` with static-asset serving; adds a new `web-ui-src/`
  React/Vite/Tailwind project; the backend Python (scan pipeline, `merge_scans`, document
  and Niimbot logic) is retained and refactored only where needed to serve `dist/`.
- **Provisioning**: `roles/web-ui/tasks/main.yaml` gains Node install + `npm ci`/`vite build`
  steps and ships the `web-ui-src/` tree to the Pi; build runs at provision time on ARM.
- **Dependencies**: adds a Node/npm toolchain requirement on the Pi and JS dev-dependencies
  (React, Vite, Tailwind) to the repo. No new Python dependencies.
- **Deploy/latency**: provisioning the web-ui role now includes an on-device build step
  (slower first run); steady-state serving is faster (static assets, no per-request render).
- **Risk**: the old UI remains until parity is verified; cutover is a single role change.

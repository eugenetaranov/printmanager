## ADDED Requirements

### Requirement: React single-page application

The web UI SHALL be a React single-page application built with Vite and served as static
assets (HTML, hashed JS/CSS bundles) by the scan-web server. The application SHALL render
entirely client-side; the server SHALL NOT assemble UI markup per request. Client-side
routing SHALL map the URL path to the correct tab so existing deep links continue to work.

#### Scenario: Application loads and renders

- **WHEN** a browser requests `/`
- **THEN** the server returns the built SPA `index.html` and its hashed asset bundle
- **AND** the app mounts and renders the Scan tab with no server-rendered UI markup

#### Scenario: Deep link opens the matching tab

- **WHEN** a browser navigates to `/print`, `/scan`, `/document`, or `/devices`
- **THEN** the SPA loads and the client router renders the tab named by that path
- **AND** navigating between tabs updates the URL without a full page reload

### Requirement: Full-parity tab coverage

The SPA SHALL reproduce every user-facing capability of the previous UI across all four
tabs — Scan, Labels, Print, and Devices — with no loss of function. Each ported behavior
SHALL be equivalent to the prior implementation from the user's perspective.

#### Scenario: Scan tab parity

- **WHEN** the user opens the Scan tab
- **THEN** they can trigger a scan (with optional name, mode, resolution), see the recent-scans
  list with thumbnails, and rename, remove, download, clear, and merge scans
- **AND** selecting two or more scans and merging produces a combined PDF in tick order, exactly
  as the previous UI did

#### Scenario: Labels, Print, and Devices tab parity

- **WHEN** the user opens the Labels, Print, or Devices tab
- **THEN** the Labels tab composes and prints Niimbot labels and manages label templates, the
  Print tab uploads a document and prints it single- or double-sided with page ranges, and the
  Devices tab lists hardware and connects a Niimbot printer over BLE on demand
- **AND** each action calls the same backend endpoint and yields the same result as before

### Requirement: Bespoke visual design preserved via Tailwind theme

The SPA SHALL be styled with Tailwind CSS, with the previous UI's design tokens (accent,
surface, muted colors, the monospace type system, tabular numerals) ported into the Tailwind
theme so the rendered look matches the previous UI rather than a generic framework skin.

#### Scenario: Design tokens drive component styling

- **WHEN** the SPA renders buttons, tables, notes, and the label schematic
- **THEN** their colors, fonts, and spacing derive from the ported theme tokens
- **AND** the result is visually equivalent to the previous bespoke UI

### Requirement: Client-side interaction behaviors

The SPA SHALL reproduce the previous UI's interaction behaviors, including inline rename,
multi-select with tick-order merge, hover thumbnail preview, the page-range selector, and the
label composer — without the defects fixed in the prior UI (e.g. a rename SHALL NOT emit a
spurious error, and a merge/rename SHALL NOT double-submit).

#### Scenario: Inline rename does not double-submit

- **WHEN** the user renames a scan and confirms with Enter
- **THEN** the rename is submitted exactly once and no spurious "not found" error is shown

#### Scenario: Merge selection tracks tick order

- **WHEN** the user checks scans in a given order and merges
- **THEN** the merged PDF orders pages by the sequence in which the boxes were checked

### Requirement: Deployable Vite build

The application SHALL build to a self-contained static bundle via `npm ci && npm run build`,
producing a `dist/` directory of hashed assets that the server can serve directly.

#### Scenario: Production build succeeds

- **WHEN** `npm ci && npm run build` runs in the SPA source tree
- **THEN** a `dist/` directory is produced containing `index.html` and hashed JS/CSS assets
- **AND** serving that `dist/` yields a working UI with no dev server or Node runtime required

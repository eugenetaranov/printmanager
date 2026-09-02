## ADDED Requirements

### Requirement: Server serves the static SPA bundle

The scan-web server SHALL serve the built SPA bundle from its page routes instead of
rendering embedded HTML. Requests for the application shell (`/`, `/index.html`, `/scan`,
`/print`, `/document`, `/devices`, and any other non-API path that is not a static asset)
SHALL return the SPA `index.html`, so client-side routing can resolve the view. Requests for
built assets SHALL return those assets with appropriate content types.

#### Scenario: Application shell served for page routes

- **WHEN** a browser requests `/`, `/scan`, `/print`, `/document`, or `/devices`
- **THEN** the server returns the built `index.html`
- **AND** the server no longer assembles or returns any embedded HTML/CSS/JS string

#### Scenario: Static assets served

- **WHEN** the SPA requests a hashed JS or CSS asset produced by the build
- **THEN** the server returns it with the correct content type and caching headers

#### Scenario: Unknown non-API path falls back to the shell

- **WHEN** a browser requests a path that is neither a known API endpoint nor an existing
  static asset
- **THEN** the server returns `index.html` (SPA fallback) rather than a 404

### Requirement: JSON endpoint contract

The server SHALL expose the scan, storage, document-print, label, template, and device
operations as JSON/HTTP endpoints that the SPA consumes. Endpoints SHALL return JSON objects
carrying an `ok` boolean and, on failure, an `error` string; success payloads SHALL carry the
operation's result fields. The contract SHALL cover at least: `GET /recent`; `POST /scan`,
`/rename`, `/remove`, `/clear`, `/merge`; `GET /file/<name>` and `/thumb/<name>`;
`POST /document/info|print|continue|cancel` and `GET /print/queues`; `POST /print` and the
`/templates*` operations; and `GET /devices/list`, `/niimbot/state` with the `POST /devices/*`,
`/niimbot/*` operations.

#### Scenario: Scan and recent-list endpoints

- **WHEN** the SPA calls `GET /recent`
- **THEN** the server returns `{"scans": [...]}` with one object per scan (name, size, mtime,
  dpi, mode, thumb)
- **AND** `POST /scan` returns `{"ok": true, "file": ..., "seconds": ...}` on success or
  `{"ok": false, "error": ...}` on failure

#### Scenario: Merge endpoint

- **WHEN** the SPA calls `POST /merge` with a JSON body `{"names": [...], "to": "..."}`
- **THEN** on success the server merges the named scans in list order and returns
  `{"ok": true, "file": "<merged>.pdf"}`, deleting the sources only after success
- **AND** on a validation failure (fewer than two names, a missing source, a name collision,
  or a bad name) it returns `{"ok": false, "error": ...}` and leaves the sources intact

#### Scenario: Document, template, and device endpoints respond as JSON

- **WHEN** the SPA calls any `/document/*`, `/templates*`, `/print`, `/devices/*`, or
  `/niimbot/*` endpoint
- **THEN** the server returns a JSON object with `ok` and, on failure, `error`
- **AND** the payload matches what the corresponding tab needs to render its result

### Requirement: Filename safety on the API

Every endpoint that accepts a filename SHALL validate it against the server's safe-name
pattern and reject path traversal, so the JSON API cannot read or write outside the scan
directory.

#### Scenario: Traversal rejected

- **WHEN** a request supplies a filename containing path separators or `..`
- **THEN** the server rejects it with an error and performs no filesystem access outside the
  scan directory

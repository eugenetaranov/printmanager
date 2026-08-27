# Tasks

Reuses existing primitives in `roles/web-ui/files/scan-web.py` (`_submit_lp`, `_printer_name`, the per-job `tempfile.mkdtemp` pattern) and already-provisioned tools (reportlab, poppler-utils `pdfseparate`/`pdfunite`, cups-client). No new dependencies.

## 1. Document surface + single-sided printing

- [x] 1.1 Add a `document_enabled` config flag (default on) to `roles/web-ui/defaults/main.yaml` + `scan-web-config.yaml.j2`; wire it into scan-web.py config
- [x] 1.2 Add a **Document** tab to the UI: PDF file input, queue `<select>` (reuse the queue list + `_printer_name()`), a single/double-sided toggle, Print button
- [x] 1.3 Add `POST /document/print`: accept the uploaded PDF, validate it's a readable PDF within page-count + size caps, stream to a tempfile
- [x] 1.4 Single-sided path: submit via `_submit_lp` to the chosen queue; return the queue + job id; confirmation reports the queue

## 2. Duplex capability detection

- [x] 2.1 Add a helper that queries a queue's duplex capability via `lpoptions -p <q> -l` (PPD `Duplex` option, or IPP `sides` with real choices); return auto/none/unknown
- [x] 2.2 Cache the result per queue (at print time); default to "none/guided" on unknown
- [x] 2.3 Auto-duplex path: when the queue supports it and double-sided is requested, submit one job with `-o sides=two-sided-long-edge`; no flip step

## 3. Guided manual duplex (simplex printers)

- [x] 3.1 Even-count pad: append one blank A4 page (reportlab) when the page count is odd, positioned so the blank is the back of the last sheet
- [x] 3.2 Split into odd/even halves with poppler (`pdfseparate` → `pdfunite`), with the half's page order controlled by a per-printer constant (`duplex_even_order`, `duplex_flip_edge`)
- [x] 3.3 Two-phase job store: `token → {tempdir, created}` in-memory map; `POST /document/print` prints the first half and returns `{token, step:"flip", instruction}` without deleting the tempdir
- [x] 3.4 `POST /document/continue?token=…`: submit the second half from the stored tempdir, then clean up; `POST /document/cancel` discards
- [x] 3.5 TTL reaper for tokens older than ~30 min (browser-close/refresh/restart orphans)
- [x] 3.6 UI flip step: after the first half, show the printer-specific flip-and-reload instruction (generated from the same constant) + Continue/Cancel; then report completion

## 4. Calibrate the flip/order constant (needs the real printer + user)

- [x] 4.1 Build a numbered test PDF (pages "1/2/3/4" with a corner orientation marker) and run it through the guided flow with a provisional constant
- [x] 4.2 With the user physically flipping as instructed, print the second half and inspect the collated result; adjust `duplex_even_order` / `duplex_flip_edge` (and odds-first vs evens-first) until pages land 1–4 in order and upright
- [x] 4.3 Record the winning values as the DCP-1511 defaults in `roles/web-ui/defaults/main.yaml`; keep them per-queue overridable

## 5. Docs + verify

- [x] 5.1 Document the Document tab and duplex behavior in `README.md`; note the per-queue duplex override
- [x] 5.2 Deploy to the Pi; verify single-sided, auto-duplex (if any capable queue exists), and the full guided manual-duplex flow end-to-end
- [x] 5.3 Verify graceful behavior: disabled tab, invalid/oversized upload, and an abandoned two-phase job (reaper removes it, no stray second half)

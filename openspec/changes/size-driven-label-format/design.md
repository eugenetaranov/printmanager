## Context

The Print tab (in `scan-web.py`, a single inline HTML/JS app) currently has two selectors — a unified printer selector (`printerSel`, fed by `printerOptions()` from the CUPS inventory + connected Niimbots) and a "Label sheet" template selector (`tpl`, from `LABEL_TEMPLATES`) — plus two composer bodies (`a4Composer` grid, `labelComposer` single thermal) that `applyPrinter()` already toggles by device type. A4 templates carry physical per-label sizes (`cell_w`,`cell_h`); Niimbot models/roll carry `label_mm`. The Niimbot connect flow (scan/connect/reconnect + `/niimbot/state` polling) already exists in the Devices tab. There is no label preview today.

The user's model: choose by **label size**; the printer is incidental and should connect on demand. Decisions already taken: one size-sorted list (2–6 entries expected); only sizes the host has hardware for; connect-on-selection but non-blocking (Print re-triggers); a simple WYSIWYG preview for text/image/QR.

## Goals / Non-Goals

**Goals:**
- Replace both selectors with one size-sorted "Label format" list.
- Route a chosen format to the right composer + device automatically.
- Connect an offline thermal printer on demand without trapping the user.
- Show a true-to-print preview of the composed label.
- Reuse existing machinery (composer switch, Niimbot endpoints, `render_label`, `do_print` queue routing).

**Non-Goals:**
- Listing sizes for hardware not present; size→model discovery.
- Auto-connect for CUPS printers (always ready); pipeline/provisioning changes; N-up/imposition.

## Decisions

### 1. Format model
A format entry: `{ id, kind: 'a4'|'thermal', w_mm, h_mm, label, target }` where
- **A4**: one per `LABEL_TEMPLATES` entry — `w_mm/h_mm = cell_w/cell_h`, `label = "A4 · <w>×<h>mm (<cols>×<rows>)"`, `target = {type:'cups', queue}` (the default CUPS queue; secondary printer choice only if >1 A4 printer — deferred).
- **thermal**: one per *remembered* Niimbot — `w_mm/h_mm` from its `label_mm`, `label = "<model> · <w>×<h>mm"`, `target = {type:'niim', address}`. Included even when disconnected.
Only emit A4 entries when a CUPS printer exists, and thermal entries for remembered Niimbots (`/niimbot/state` includes remembered, not just connected — already true).

### 2. One list, longest-edge descending
Sort by `max(w_mm,h_mm)` desc (tiebreak on area). Interleaves A4 and thermal so "biggest→smallest" reads naturally; each entry's label carries its type prefix. Refactor `printerOptions()`→`formatOptions()`; `syncSelectors()` populates a single `formatSel`; the "Label sheet" `tpl` select is removed and its role folded into the A4 format entries (selecting an A4 format sets the active template).

### 3. Selection drives composer + device (reuse `applyPrinter`)
Rename/extend `applyPrinter(format)`: `kind==='a4'` → show grid, set the active template (was the `tpl` change handler), set `do_print` target to `format.target.queue`; `kind==='thermal'` → show the label composer, `POST /niimbot/select`, seed the size inputs. Persist the last format id (`pm_format`, replacing `pm_printer`/`pm_tpl`).

### 4. On-demand connect: non-blocking modal, Print re-triggers
Selecting a thermal format whose Niimbot isn't connected opens a **connect modal**:
- Kicks off `POST /niimbot/connect` (or `/reconnect`) for the known address; polls `/niimbot/state` for live status (connecting → connected / failed), reusing the Devices-tab log/status rendering.
- **Non-blocking**: a "Compose while it connects" / dismiss path leaves the composer usable; the preview renders regardless (§5).
- On connected → auto-dismiss, enable Print. On failure → retry + a "scan for it" fallback (address changed).
- The **Print button** checks connection first: if the selected thermal printer is offline, it opens the same modal instead of failing (so connect can also happen lazily). This closes the "dismissed the modal, then hit Print" gap.
*Alternative considered:* connect only at Print time. Rejected — the user wants the printer warming up as soon as the size is chosen; but we keep the Print-time trigger too, so both paths work.

### 5. Preview via `render_label` → PNG (keep it simple)
New `POST /preview {kind, payload, w_mm, h_mm, model?}` → calls the existing `render_label` (text/image/QR) to a 1-bpp bitmap, converts to a PNG (Pillow, already present), returns it (base64 or a short-lived URL). The composer shows it; it's rendered in the background while the connect modal is up so it's ready on connect. Scope to text/image/QR only (no A4-grid preview — A4 keeps its cell-placement view). Server-side (not canvas) so the preview matches the printed dots (rotation, dithering) exactly.

### 6. Retire the printer selector
The `printerSel` UI and its `pm_printer` persistence are removed/replaced by `formatSel`. `do_print`'s validated `queue` targeting (from the superseded Group 4) is kept — it's now fed by the selected A4 format's target queue. Update `printer-agnostic-multi-device` task notes to mark Group 4 superseded.

## Risks / Trade-offs

- **Eager BLE connect on selection is a side effect** → mitigated by the non-blocking modal + keeping a Print-time trigger; the user explicitly wants warm-up on selection.
- **Preview adds a print-path call per edit** → debounce preview renders; cap payload size; reuse the print lock only for printing, not preview.
- **Refactor of the selector logic is the risky part** (it currently also drives Niimbot select/size) → keep `applyPrinter`'s device-side effects intact; change only what feeds it; verify A4 and thermal both still print.
- **A4 format ↔ multiple A4 printers is ambiguous** → default to the system-default queue now; a secondary printer picker is a deferred edge case.
- **Empty state** (no printers) → the selector shows a "connect a printer" hint rather than being blank.

## Migration Plan

1. Build `formatOptions()` + the single `formatSel` (A4 + thermal, size-first labels, sorted); wire selection to the existing composer switch + template activation + queue target. Keep both composers working.
2. Add the connect modal (selection + Print-time triggers, live status, non-blocking).
3. Add the `/preview` route and wire it into both composers (background render during connect).
4. Remove the retired printer/label-sheet selectors; persist `pm_format`.
5. Docs + live verification on the Pi with the D110/B1.
Rollback: revert to the printer + label-sheet selectors (previous commit).

## Open Questions

- Preview return shape: inline base64 PNG vs a short-lived `/preview/<token>.png` URL? (Leaning: base64 for simplicity, given small labels.)
- A4-with-multiple-A4-printers: add a secondary printer picker now or defer? (Leaning: defer — one A4 printer today.)
- Should selecting an A4 format also remember the last-used *content mode* (text/image/QR) per format, or globally? (Leaning: global, as today.)

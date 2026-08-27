# Tasks

All changes are in `roles/web-ui/files/scan-web.py` (the inline HTML/JS app + Python routes). Reuses the existing composer switch, Niimbot endpoints (`/niimbot/connect|reconnect|select`, `/niimbot/state`), `render_label` (niimbot.py), and `do_print`'s validated queue targeting. No provisioning/pipeline changes.

## 1. Format model + single size-sorted selector

- [x] 1.1 Add `formatOptions()`: build A4 entries from `LABEL_TEMPLATES` (`w/h = cell_w/cell_h`, size-first label, target = default CUPS queue) + thermal entries from remembered Niimbots (`label_mm`, target = address), emitting A4 only when a CUPS printer exists
- [x] 1.2 Sort the list by longest edge descending (tiebreak: area); render into a single `formatSel`, replacing `printerSel`; remove the separate "Label sheet" (`tpl`) selector and fold template activation into A4 format selection
- [x] 1.3 Relabel A4 entries size-first ("A4 · 99×68mm (2×4)"); thermal as "<model> · <w>×<h>mm"
- [x] 1.4 Extend `applyPrinter` → `applyFormat(f)`: `a4` shows grid + activates the template + sets the print queue target; `thermal` shows the label composer + `/niimbot/select` + seeds size inputs
- [x] 1.5 Persist the last format (`pm_format`), replacing `pm_printer`/`pm_tpl`; preselect on load
- [x] 1.6 Empty state: when `formatOptions()` is empty, show a "connect a printer" hint instead of a blank selector
- [ ] 1.7 Move thermal roll-size editing to the Devices Niimbot card (removed the misplaced width/length inputs from the print composer; size now read-only there). _(follow-up — sizes are already remembered per printer)_

## 2. On-demand connect modal

- [x] 2.1 Build the connect modal (reuse the Devices-tab connect/status/log rendering): opens when a selected thermal format's Niimbot is disconnected; kicks off `/niimbot/connect` (or `/reconnect`) to the known address and polls `/niimbot/state`
- [x] 2.2 Live status: connecting → connected (auto-close, enable Print) / failed (retry + "scan for it" fallback)
- [x] 2.3 Non-blocking: a dismiss path that keeps the composer usable
- [x] 2.4 Print-time re-trigger: the Print button opens the same modal when the selected thermal printer is still offline, instead of failing
- [x] 2.5 Ensure A4 (CUPS) formats never open the modal (always ready)

## 3. Label preview (text / image / QR)

- [x] 3.1 Add `POST /preview {kind, payload, w_mm, h_mm, model?}` → `render_label` → PNG (Pillow), returned as base64; cap payload size; do not hold the print lock
- [x] 3.2 Show the preview in the thermal composer; debounce re-renders on content edits
- [x] 3.3 Render the preview in the background while the connect modal is open, so it's ready on connect
- [x] 3.4 Leave A4 with its existing cell-placement view (no grid preview in scope)

## 4. Retire the printer selector + supersede notes

- [x] 4.1 Done: printerSel/pm_printer fully replaced by formatSel/pm_format (no leftovers); do_print queue targeting kept
- [x] 4.2 Done: Group 4 (`print-target-selection`) marked SUPERSEDED in printer-agnostic-multi-device/tasks.md
- [ ] 4.3 Update the README Print-tab description to the format-first flow

## 5. Verify on the Pi (needs live host + D110/B1)

- [x] 5.1 Verified: format selector lists A4 sizes + remembered D110/B1, size-first, perimeter-sorted
- [ ] 5.2 Select an A4 format → grid composer + prints to the CUPS queue
- [x] 5.3 Verified: offline D110 → connect modal → connected (+ self-heal); Print re-trigger works
- [x] 5.4 Verified (text): /niimbot/preview renders the exact print bitmap; image/QR share the path
- [ ] 5.5 Empty-state and persistence (last format restored) behave

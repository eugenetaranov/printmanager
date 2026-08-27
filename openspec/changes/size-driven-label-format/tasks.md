# Tasks

All changes are in `roles/web-ui/files/scan-web.py` (the inline HTML/JS app + Python routes). Reuses the existing composer switch, Niimbot endpoints (`/niimbot/connect|reconnect|select`, `/niimbot/state`), `render_label` (niimbot.py), and `do_print`'s validated queue targeting. No provisioning/pipeline changes.

## 1. Format model + single size-sorted selector

- [ ] 1.1 Add `formatOptions()`: build A4 entries from `LABEL_TEMPLATES` (`w/h = cell_w/cell_h`, size-first label, target = default CUPS queue) + thermal entries from remembered Niimbots (`label_mm`, target = address), emitting A4 only when a CUPS printer exists
- [ ] 1.2 Sort the list by longest edge descending (tiebreak: area); render into a single `formatSel`, replacing `printerSel`; remove the separate "Label sheet" (`tpl`) selector and fold template activation into A4 format selection
- [ ] 1.3 Relabel A4 entries size-first ("A4 · 99×68mm (2×4)"); thermal as "<model> · <w>×<h>mm"
- [ ] 1.4 Extend `applyPrinter` → `applyFormat(f)`: `a4` shows grid + activates the template + sets the print queue target; `thermal` shows the label composer + `/niimbot/select` + seeds size inputs
- [ ] 1.5 Persist the last format (`pm_format`), replacing `pm_printer`/`pm_tpl`; preselect on load
- [ ] 1.6 Empty state: when `formatOptions()` is empty, show a "connect a printer" hint instead of a blank selector

## 2. On-demand connect modal

- [ ] 2.1 Build the connect modal (reuse the Devices-tab connect/status/log rendering): opens when a selected thermal format's Niimbot is disconnected; kicks off `/niimbot/connect` (or `/reconnect`) to the known address and polls `/niimbot/state`
- [ ] 2.2 Live status: connecting → connected (auto-close, enable Print) / failed (retry + "scan for it" fallback)
- [ ] 2.3 Non-blocking: a dismiss path that keeps the composer usable
- [ ] 2.4 Print-time re-trigger: the Print button opens the same modal when the selected thermal printer is still offline, instead of failing
- [ ] 2.5 Ensure A4 (CUPS) formats never open the modal (always ready)

## 3. Label preview (text / image / QR)

- [ ] 3.1 Add `POST /preview {kind, payload, w_mm, h_mm, model?}` → `render_label` → PNG (Pillow), returned as base64; cap payload size; do not hold the print lock
- [ ] 3.2 Show the preview in the thermal composer; debounce re-renders on content edits
- [ ] 3.3 Render the preview in the background while the connect modal is open, so it's ready on connect
- [ ] 3.4 Leave A4 with its existing cell-placement view (no grid preview in scope)

## 4. Retire the printer selector + supersede notes

- [ ] 4.1 Remove the leftover `printerSel` UI/persistence now replaced by `formatSel`; keep `do_print`'s validated queue targeting (fed by the selected A4 format)
- [ ] 4.2 Mark Group 4 (`print-target-selection`) in `printer-agnostic-multi-device/tasks.md` as superseded by this change
- [ ] 4.3 Update the README Print-tab description to the format-first flow

## 5. Verify on the Pi (needs live host + D110/B1)

- [ ] 5.1 Deploy; confirm the format selector lists the A4 sizes + the remembered D110/B1, sorted largest-first
- [ ] 5.2 Select an A4 format → grid composer + prints to the CUPS queue
- [ ] 5.3 Select the offline D110 → connect modal drives it to connected; dismiss + Print re-trigger both work
- [ ] 5.4 Preview renders for text, image, and QR and matches the printed label
- [ ] 5.5 Empty-state and persistence (last format restored) behave

## Why

Users don't think in printers — they think in **label sizes**. "I need a postal label" means the biggest size; "just a word or a number" means the little 12×40 thermal. The current Print tab makes them reason about devices: a printer selector plus a separate "Label sheet" selector. That's backwards. The selection should be driven by *what you're printing* (size), and the printer should fall out of that choice — connecting on demand if it isn't ready. The pieces already exist to do this: A4 templates carry physical per-label sizes (`cell_w`×`cell_h`), Niimbot models carry roll sizes (`label_mm`), the composer already switches by device, and the Niimbot connect flow already exists in the Devices tab.

## What Changes

- Replace the Print tab's **printer selector *and* "Label sheet" selector** with a single **"Label format"** selector: a size-sorted list of the formats you actually have hardware for. Expected size is small (2–6 entries).
  - **A4 entries** come from the label-sheet templates (still user-managed via "Manage"), relabeled **size-first** ("A4 · 99×68mm (2×4)").
  - **Thermal entries** come from **remembered Niimbots** at their roll size ("D110 · 40×12mm"), shown even when the printer is disconnected.
  - One interleaved list, **sorted by longest edge, largest first**.
- Selecting a format sets both the **composer** (A4 grid ↔ single thermal label — reusing the existing switch) and the **target device**.
- **On-demand connect:** selecting a thermal format whose Niimbot is offline opens a **connect modal** that drives the connection with live status (reusing the Devices-tab endpoints). It's **non-blocking** — dismissing it keeps the composer, and pressing **Print** re-triggers the connect if still offline. No dead ends.
- **Live label preview:** a simple server-rendered, WYSIWYG preview of the label (text, image, or QR) via `render_label`, shown in the composer and rendered in the background while the connect modal is up. A4 keeps its existing cell-placement view.
- **Supersedes** the just-added Print-tab printer selector (the `print-target-selection` capability / Group 4 of `printer-agnostic-multi-device`). The underlying queue-routing in `do_print` stays; only the UI that drives it changes.

Non-goals: adding sizes for hardware you don't have (a thermal size only appears once its Niimbot is remembered — a brand-new printer is connected once via Devices first); a size→model catalog / discovery for unknown devices; auto-connect for CUPS printers (they're always "ready"); changing the print pipeline, scanning, or provisioning; N-up/booklet/imposition.

## Capabilities

### New Capabilities
- `label-format-selection`: A single size-sorted "Label format" selector on the Print tab that lists the A4 and thermal formats the host has hardware for, routes each to its device + composer, and remembers the last choice.
- `on-demand-printer-connect`: Selecting a format whose (thermal) printer is offline opens a non-blocking connect modal with live status that drives the link to ready; Print re-triggers it if still offline.
- `label-preview`: A simple WYSIWYG preview of the composed label (text / image / QR), server-rendered via the same code that prints, shown in the composer and prepared in the background during connect.

### Modified Capabilities
<!-- `print-target-selection` (from printer-agnostic-multi-device) is SUPERSEDED by
     label-format-selection, but that change is not yet archived so there is no
     baseline spec to delta against. Handled by note + retiring its UI here. -->

## Impact

- **`roles/web-ui/files/scan-web.py`** (only): refactor `printerOptions`/`syncSelectors`/`applyPrinter` into a format-based model (`formatOptions()` building A4 + thermal entries with `label_mm`, size-first labels, longest-edge sort); replace the two selectors with one; add the connect modal (reusing `/niimbot/connect`,`/niimbot/reconnect`, `/niimbot/state` polling) and its non-blocking + Print-retrigger behavior; add a `POST /preview` route calling `render_label` → PNG for text/image/QR; wire preview into both composers; persist the last format. Remove the leftover pieces of the retired printer selector.
- **`openspec/changes/printer-agnostic-multi-device`**: mark its Group 4 `print-target-selection` tasks as superseded by this change.
- **Docs**: README Print-tab description updated to the format-first flow.
- **No change** to the print/scan pipeline, provisioning roles, or the firewall. Verification needs the live Pi + the D110/B1.

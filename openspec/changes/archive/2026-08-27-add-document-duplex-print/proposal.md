## Why

The Brother DCP-1511 has no automatic duplex unit, so printing a document double-sided means the manual dance: print the odd pages, work out which way to flip and reload the stack, then print the even pages in the right order. Getting the flip axis or page order wrong wastes paper and reprints, and the OS print dialogs handle non-duplex printers clumsily. printmanager sits right next to the printer, so it can own this: a **"print a document" path** that takes a PDF and, for a simplex printer, walks the user through a foolproof guided manual-duplex flow with the flip direction and even-page order pre-calibrated for this specific printer. (Today printmanager's Print tab only composes label sheets — it can't print an arbitrary document at all.)

## What Changes

- Add a **Document** path to the web UI: upload a PDF, pick the target A4 queue, choose single- or double-sided, and print. This is a **new surface**, separate from the label-sheet Print tab; the label composer is untouched.
- **Auto-duplex printers**: when the chosen queue reports duplex support, double-sided is a single job (`lp -o sides=two-sided-long-edge`). No flip dance.
- **Simplex printers (the DCP-1511)**: a **guided two-phase manual-duplex** flow — pad to an even page count, split odd/even, print one half, show a clear printer-specific "flip and reload" instruction, and on **Continue** print the other half in the correct order. The correct even-page order and flip axis are a fixed constant **calibrated once with a test print on the real printer**.
- Handle the fiddly bits so the user never thinks about them: **odd page counts** (blank-page pad), **even-page ordering/reversal**, and clean job state across the flip (two `lp` calls bridged by a short-lived server-side token, with a reaper for abandoned jobs).

Non-goals: turning the label Print tab into a document printer (this is a distinct path); editing/reflowing PDFs; N-up, booklet, or stapling; scanning changes; and full multi-printer routing (this consumes the queue list when available but does not depend on the printer-agnostic refactor landing first).

## Capabilities

### New Capabilities
- `document-printing`: Upload a PDF and print it to a selected A4 CUPS queue from the web UI, with page-count/size validation and a single-sided default.
- `duplex-printing`: Print a document double-sided — a one-shot `sides=` job on auto-duplex queues, or a guided two-phase manual-duplex flow (odd → flip → even, correctly ordered) on simplex printers, with the flip/order behavior calibrated per printer.

### Modified Capabilities
<!-- None. The label-sheet print-sharing capability is untouched; this adds a separate document path. -->

## Impact

- **`roles/web-ui`**: a new **Document** tab + client flow (PDF upload, sided toggle, the flip/Continue step); new server routes (`/document/print`, `/document/continue`); PDF handling (page count, even-count pad via reportlab which is already present, odd/even split + reorder via poppler `pdfseparate`/`pdfunite` which are already installed); a small server-side job store (token → temp PDF halves + TTL reaper) reusing the existing per-job tempdir pattern; reuse `_submit_lp`/`_printer_name`. A toggle to enable/disable the Document tab.
- **Queue duplex capability**: detect per queue via `lpoptions -p <q> -l` (a `Duplex` PPD option or IPP `sides` with real choices), cached at print time; composes with the printer-agnostic change's per-queue capability work but does not require it (simplex is the safe default).
- **Calibration**: a one-time empirical determination (numbered test print) of the DCP-1511's even-page order + flip edge, recorded as a per-printer constant/default.
- **No change** to label printing, scanning, the share, Niimbot, or the firewall (uses the existing web port).
- **Dependencies**: none new — reportlab, Pillow, poppler-utils, and the CUPS client are already provisioned.

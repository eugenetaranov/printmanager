## Context

printmanager's web UI (dependency-light: stdlib Python + reportlab/Pillow/poppler-utils/cups-client) has a label-sheet Print tab whose `do_print` builds an A4 PDF from grid cells and submits it via `_submit_lp` (`lp -d <queue> -o media=A4`). There is **no path to print an arbitrary document**. The reference printer, a Brother DCP-1511, has **no auto-duplex**; users currently reshuffle pages by hand (typically from an OS print dialog). The ask: let printmanager take a PDF and handle double-sided printing, including the manual flip, so the user doesn't have to think about page order or flip direction.

A parallel change (`printer-agnostic-multi-device`) is introducing per-queue capability awareness and a queue selector; this change should reuse that seam where present but must stand alone (simplex/guided is the safe default with no dependency on that change landing).

## Goals / Non-Goals

**Goals:**
- Upload a PDF and print it to a chosen A4 queue.
- Double-sided that "just works": one-shot on auto-duplex queues; a guided, foolproof manual flow on simplex printers.
- Bake the error-prone knowledge (even-page order, flip edge, odd-count padding) into the software, calibrated once for the real printer.
- No new dependencies; label printing and everything else untouched.

**Non-Goals:**
- Changing the label Print tab into a document printer.
- PDF editing/reflow, N-up, booklet imposition, stapling, collation beyond duplex.
- Depending on the printer-agnostic refactor landing first.

## Decisions

### 1. A separate "Document" surface, not an extension of the label composer
The label composer's model (templates, cells, per-cell content) has nothing to do with printing a whole document. A distinct tab + routes keeps both simple and avoids overloading `do_print`. Reuse only the low-level primitives (`_submit_lp`, `_printer_name`, the tempdir pattern).
*Alternative considered:* bolt a "document mode" onto the Print tab. Rejected — conflates two products and complicates label logic.

### 2. Capability-gated duplex: one-shot vs guided
Detect whether the chosen queue supports auto-duplex (`lpoptions -p <q> -l`: a `Duplex` PPD option, or IPP `sides` with more than `one-sided`). 
- **Auto-duplex** → single job: `lp -o sides=two-sided-long-edge` (long-edge is correct for portrait A4; expose short-edge only if a real need appears).
- **Simplex** → the guided two-phase flow below.
Cache the capability at print time (query is ~50–150 ms); default to **simplex/guided** if detection is uncertain (safe — worst case is an extra manual step the printer can actually satisfy). This composes with the sibling change's per-queue capability field when it exists.

### 3. Manual-duplex mechanics (the calibrated core)
Work entirely from the uploaded PDF (can't rebuild from a page list as the label path does):
- **Pad** to an even page count by appending one blank A4 page (reportlab) so odd/even halves align.
- **Split** with poppler: `pdfseparate` to per-page files, then `pdfunite` the odd set and the even set (already-installed, no new dep). This makes page **reordering** trivial — just choose the `pdfunite` argument order.
- **Order/flip constant:** after the user flips the printed odd stack and reloads, the even pages usually must print in **reverse** so the final collated stack is in order; the exact reversal + which edge to flip depends on the printer's feed/output orientation (face-up vs face-down). This is **not guessable** — determine it once empirically (below) and store it as a per-printer default (`duplex_flip_edge: long`, `duplex_even_order: reverse`), overridable per queue.
- Print order: odd pages first (natural), then evens after the flip. (Whether odds print in normal or reverse order is part of the same one-time calibration.)

### 4. Two-phase job bridged by a server-side token
A stateless POST can't span the physical flip. Flow:
1. `POST /document/print` → validate, pad, split; write the two half-PDFs to a per-job tempdir; submit the first half via `_submit_lp`; return `{token, step: "flip", instruction}` **without** deleting the tempdir.
2. UI shows the printer-specific flip instruction + a **Continue** button (and a Cancel).
3. `POST /document/continue?token=…` → submit the second half from the stored tempdir; clean up.
A small in-memory `token → {dir, created}` map (mirrors the existing per-print tempdir pattern) with a **reaper** for tokens older than ~30 min covers browser-refresh/abandon/restart orphans. No websockets/polling — two independent requests joined by a filesystem token.
*Alternative considered:* a CUPS-level pausing queue that any OS job prints to. Rejected — reliable mid-job pause-for-flip at the CUPS filter layer is fragile; the web flow is controllable and testable.

### 5. Calibration procedure (one-time, on the real printer)
Print a **numbered test document** (e.g. 4 pages "1/2/3/4" with a corner marker) through the guided flow using a candidate constant, physically flip as instructed, print the second half, and read the collated output. Adjust `duplex_even_order`/`duplex_flip_edge` until pages land 1–4 in order, right way up. Record the winning constants as the DCP-1511 defaults. Because the Pi is reachable over SSH and the printer is on-site, this is a single short loop with the user doing the physical flip.

## Risks / Trade-offs

- **Wrong flip/order wastes paper** → mitigated by calibrating once against the real printer before shipping the default, and by keeping the constant per-queue overridable; the guided instruction text is generated from the same constant so UI and behavior can't drift.
- **Abandoned two-phase jobs leak temp files** → TTL reaper + cleanup on Continue/Cancel, same footprint as today's per-job tempdirs.
- **Capability mis-detection** → default to guided/simplex (always works); only the one-shot fast path is gated on positive detection.
- **Large PDF uploads** → enforce a page-count and size cap (reuse the label path's size-guard style) and stream to a tempfile.
- **Scope creep toward a full print dialog** → explicit non-goals; ship upload + sided-toggle only.

## Migration Plan

1. Land the Document tab + `/document/print` single-sided first (upload → `_submit_lp`); verify a plain document prints.
2. Add capability detection + the auto-duplex one-shot path (safe on any queue that reports it).
3. Add the guided manual-duplex two-phase flow with a provisional constant; **calibrate** on the DCP-1511; lock the default.
4. Document the feature and the per-queue override.
Rollback: hide the Document tab via its enable toggle; no other surface is affected.

## Open Questions

- Print odds-first then evens, or evens-first? (Decide during calibration — whichever yields correct collation with the simplest flip instruction.)
- Expose short-edge flip as an option, or long-edge only until someone needs landscape duplex? (Leaning: long-edge only initially.)
- Enforce a hard page/size cap value (e.g. 50 pages / 40 MB) — confirm limits during implementation.

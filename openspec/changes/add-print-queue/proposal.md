## Why

Parcel drop-offs need a shipment number on each box (the courier prints the address label at the counter). The number usually arrives on the phone while the label printer is off. Today the user has to keep those numbers somewhere, later boot the printer and retype or re-paste each one in the Labels tab. They want to throw one to three items into a queue from the phone, then switch the printer on, open the web UI and hit Print once.

The design review also found a latent bug: printing to the USB Brother while it is powered off reports "sent". The CUPS USB backend keeps the job with no time limit and prints it whenever the printer next appears, possibly days later.

## What Changes

- New **Queue** tab (`/queue`) with a count badge, plus a header queue button reachable from every tab.
- Paste field (one item per non-empty line), file picker and desktop drag-drop. A pasted number defaults to the last-used label format (a Niimbot); a PDF/image goes to the default A4 CUPS queue.
- Items persist on the Pi (`DATA_DIR/queue/`), shared across devices, capped at 20 items and expiring after 7 days.
- Per item: target (any label printer or A4 queue), copies, and a Code 128 barcode option for label text. Remove uses the two-click arm/confirm pattern.
- **Print all** releases items one at a time in order through a server-side worker: label printers are connected with the existing reconnect path; an A4 item waits until the USB printer is actually present, then its CUPS job is tracked to completion. The worker only waits while a client is watching (heartbeat) and pauses the batch at the first failure; **Resume** retries from there. Printed items are deleted immediately (no undo — a printed label can't be un-printed).
- **Print now on an absent USB printer is refused** with a clear message, and the Print tab offers **Add to queue** instead (fixes the silent hold bug for documents).
- Labels tab (thermal text) gains an **Add to queue** secondary action.

Non-goals (v1): HTTPS / Web Share Target, iPhone Shortcut docs, double-sided items, auto-print without a tap, scheduling, cropping screenshots, queueing A4 label sheets.

## Capabilities

### New Capabilities
- `print-queue`: Stage items for later printing and release them together once the printer is ready.

### Modified Capabilities
- `document-printing`: refuse a direct print when the target USB printer is not present, and offer queueing instead.

## Impact

- `roles/web-ui/files/scan-web.py`: queue store, `/queue*` routes, release worker, USB presence check, refusal in `do_document`/`do_print`.
- `roles/web-ui/files/niimbot.py`: `barcode` render kind (Code 128, solid black, no dither).
- `web-ui-src`: `QueueTab`, queue context/polling, header button, router entry, Add-to-queue on Print and Labels (thermal text).

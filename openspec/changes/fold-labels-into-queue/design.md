## Context

Labels and Queue overlapped. Both put text on a Niimbot label, but they split text differently. Queue splits on blank lines (or one bare code per line); the composer prints everything as one label (`whole=true`). A three-person UX review compared three options (https://claude.ai/artifact/8CdXMmsBcyX1WvjpA1QrED):

- **A. Queue-first** (chosen): the Queue is the home, and the composer sits behind progressive disclosure.
- B. One composer: a single box where the last button decides now or later.
- C. One tab with a [Queue | Compose] switch.

## Decisions

- **Customize replaces the paste box; the two never show together.** One visible input means one splitting rule, so a pasted list can't silently become one stacked label. Customize always opens collapsed, because quick add is the frequent path.
- **Print now goes through the queue worker** (add, then `release {ids}`), not a direct `/niimbot/print`. It reuses the worker's reconnect, copies, Stop and failed-item retry, and splits multi-item pastes the same way as Add. `ids` keeps it from printing the rest of the queue. When a run is already active, Print now isn't offered: an `ids`-limited run won't pick up later items, and an unlimited run would.
- **Printer state rides on the existing 3 s queue poll** (`labels` in `/queue/state`) instead of a second poll of `/niimbot/state`. `manager.state()` is in-memory, so it's cheap, and the Reconnect row and the composer's "connected" flag stay live.
- **The quick-add target is the active label printer** (the one that last printed). The picker and the composer's format choice both call `/niimbot/select`, so all three agree.
- **Reconnect is always available.** A full button shows when disconnected. A small icon shows when connected, because BLE often reports "connected" over a link that has gone stale.
- **The default tab is Queue.** Most visits are a paste; Scan is still one tap away.

## Risks / Trade-offs

- The A4 sheet grid inside the Queue page makes it long on a phone → it only shows while Customize is open.
- Changing format needs one more tap (open Customize) → the format is remembered (`pm_format`).
- Print now feedback arrives through the 3 s poll instead of instantly → the item shows its printing state, and failures stay listed.
- QR/image labels and A4 sheets still can't be queued → their own composer buttons print them directly, as before.

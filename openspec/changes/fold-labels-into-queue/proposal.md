## Why

The Queue tab gets far more use than the Labels tab. Most visits are "paste a shipment number, print it now or later". The Labels tab's extra power is still needed now and then: format choice, QR or image labels, a live preview, A4 label sheets. A design review compared three ways to combine the two (see design.md), and the user picked **Queue-first**. The Queue becomes the label home, and the Labels composer folds into it behind a Customize section. The review also found that Bluetooth label printers often need a quick reconnect, and the user asked for a one-tap button.

## What Changes

- **BREAKING (UI):** the Labels tab is removed. The tabs are **Queue · Scan · Print** (Queue first). `/labels` redirects to `/queue`, and `/` (and unknown paths) opens Queue instead of Scan.
- The Queue tab gets a **label printer row** at the top: the printer quick add goes to (the active one), its live connection state, and a one-tap **Reconnect**. With several label printers the row is a picker, and switching makes that printer active.
- Quick add's button adapts. When the label printer is connected, **Print now** is primary and **Add to queue** is secondary. Otherwise **Add to queue** is the only button. Print now adds the items and then releases **only those items**.
- A collapsed **Customize a label** row opens the former Labels composer in place of the paste box: format picker (Niimbot rolls and A4 sheet templates), Text/Image/QR, preview, A4 sheet grid and Manage A4 label sizes. The two text boxes never show at once, because they split text differently.
- Backend:
  - `GET /queue/state` adds `labels` (every remembered label printer with its live connection state, cheap in-memory BLE state).
  - `POST /queue/add` returns the new item `ids`.
  - `POST /queue/release` accepts optional `ids`, which limits the run to those items.

Non-goals: queueing QR/image labels or A4 sheets; text size or alignment controls; renaming the Queue tab.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `print-queue`: the Queue tab becomes the label home (printer row with reconnect, Print now, Customize composer, default tab), and release can be limited to given items. `print-queue` is still being introduced by the `add-print-queue` change (not yet archived), so this change ADDs requirements to it instead of modifying archived ones.

## Impact

- `roles/web-ui/files/scan-web.py`: `queue_state` (labels), `queue_add` (ids), `queue_release` / `_queue_worker` (`ids` filter).
- `web-ui-src`:
  - `QueueTab` (printer row, Print now, Customize).
  - New `components/LabelComposer.tsx`; `tabs/LabelsTab.tsx` removed.
  - `lib/router.ts` (3 tabs, default Queue, `/labels` redirect), `App.tsx`, `api/client.ts`.
  - `vite.config.ts`: the dev proxy now forwards `/queue/*`.
  - `CLAUDE.md`.

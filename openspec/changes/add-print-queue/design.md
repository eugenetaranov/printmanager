## Context

Single-user LAN Pi, plain HTTP, no auth. Printers: USB Brother DCP-1511 via CUPS (`usb://` backend, `ErrorPolicy retry-job`) and Niimbot D110/B1 over BLE (`niimbot.manager`). The server is a threaded stdlib `http.server`.

## Decisions

- **App-level staging, not CUPS hold.** Niimbot jobs never touch CUPS, a held CUPS job can't be re-targeted, and a stuck processing job blocks the queue. Items live in `DATA_DIR/queue/queue.json` (atomic temp+rename under a lock); file items keep their converted PDF as `DATA_DIR/queue/<id>.pdf`, converted at add time so errors show while the user still holds the phone.
- **Item shape:** `{id, kind: text|file, text?, filename?, pages?, target: {type: label, address} | {type: a4, queue}, copies, barcode, state: waiting|printing|failed, error, created}`. Printed items are removed from the store.
- **Release worker.** `POST /queue/release` starts one daemon thread (no-op if running). It walks waiting/failed items in the order the user sees. For each item:
  - label: `sync_reconnect` if not connected, then `sync_print` × copies.
  - a4: wait until the USB device for the queue's brand is present (`/sys/bus/usb/devices/*/manufacturer`), then `lp -n copies` and poll `lpstat -o <queue>` until the job id disappears (completed) or 3 min passes (fail).
  - On error: mark failed with the message and stop the batch. Resume = release again (failed items retry first because they are earlier in order).
- **Waiting only while watched.** The UI polls `GET /queue` every 3 s while visible; each poll stamps a heartbeat. A worker waiting for a printer gives up (items back to waiting, batch stopped with "Stopped: page closed") after 30 s without a heartbeat. `POST /queue/stop` stops after the current item.
- **Readiness in `GET /queue`:** per-target status — label: connected/not connected (from `manager.state()`, no BLE scans); a4: present/absent via sysfs. Non-USB CUPS queues are treated as present.
- **Refuse direct print to an absent USB printer** in `do_document` and `do_print` with error code `offline`, so the Print tab can offer Add to queue.
- **Barcode:** a small Code 128 (set B, set C for all-digit even-length runs) encoder in `niimbot.py`, rendered with integer module widths and the digits underneath, never dithered.
- **Expiry/cap:** sweep on every queue access: drop items older than 7 days; refuse adds beyond 20 items.

## Risks

- sysfs manufacturer match by brand is heuristic; if the URI brand can't be found the queue is treated as present (old behaviour) rather than blocking prints forever.
- Two devices pressing Print all: the worker is a singleton, so the second call is a no-op.

# Tasks

Reference for the Niimbot protocol/rendering: `/Users/e/projects/moverse/mobile/src/niimbot/`
(`packet.ts`, `transport.ts`, `client.ts`, `models.ts`, `label.ts`) — port to Python.

## 1. Provisioning: BLE + label deps (`roles/web-ui`)

- [x] 1.1 Add BLE/label vars to `defaults/main.yaml`: `scan_web_devices_enabled: true`, per-model default label sizes (D110, B1), and a `niimbot_bleak_version` pin
- [x] 1.2 Ensure Bluetooth at the OS level: `bluez` installed and `bluetooth.service` enabled (in `roles/base` or `roles/web-ui`), tolerating a host with no adapter
- [x] 1.3 Install `bleak`: prefer apt `python3-bleak`; if unavailable, create a `--system-site-packages` venv at `/usr/local/lib/scan-web/venv` and `pip install` the pinned `bleak` (+ `qrcode` if not apt)
- [x] 1.4 Point the `scan-web.service` unit at the venv interpreter when the venv path is used; confirm the unit does not sandbox away system D-Bus
- [x] 1.5 Ship a D-Bus policy drop-in granting the `scans` user send access to `org.bluez`; ensure `scans` is in any group BlueZ requires
- [x] 1.6 Add `python3-qrcode` to `web_packages` (Pillow already present); create `/var/lib/scan-web` store dir owned by `scans` if not already
- [ ] 1.7 `tack site.yaml --tags web`: verify deps import and the service starts (no printer needed)  _(needs live host)_

## 2. Niimbot protocol module (port from moverse)

- [x] 2.1 `niimbot/packet.py`: frame `55 55 <type> <len> <data> <xor> AA AA` + a `PacketReassembler` (port `packet.ts`)
- [x] 2.2 `niimbot/models.py`: model registry (D110 96px, B1 384px, defaults + fallback) with anchored name matching + `detect_model`/`is_niimbot_name` (port `models.ts`)
- [x] 2.3 `niimbot/transport.py`: `bleak`-based transport — scan (RSSI-sorted, service UUID `e7810a71-…`, char `bef8d6c9-…`), connect-by-address, MTU-chunked write + write-with-response, notification reassembly, disconnect callback (port `transport.ts`)
- [x] 2.4 `niimbot/client.py`: print client — density/label-type/print-start/page-start/page-size, row packets (bitmap/indexed/empty, repeat-run merge capped at 255, per-third counts), batched acked flush with no-response fallback, `GET_STATUS` poll to physical completion, `ping()` (port `client.ts`)
- [x] 2.5 Unit-check packet framing + reassembly + repeat-run merge against known-good byte sequences from moverse (offline, no hardware)

## 3. Label composition (Pillow)

- [x] 3.1 `niimbot/label.py`: render text to a 1-bpp bitmap sized to model head × roll length, long-axis layout with 90° rotation for narrow portrait tape (port `label.ts` logic to Pillow `ImageDraw`)
- [x] 3.2 QR rendering: `qrcode` → Pillow → pack into the label bounds
- [x] 3.3 Image rendering: grayscale → contain-fit → Floyd–Steinberg dither → 1-bpp pack
- [x] 3.4 Per-printer label size (mm → px at 8 px/mm), clamp width to a multiple of 8 ≤ model head

## 4. Server-side printer manager (BLE lifecycle)

- [x] 4.1 Start one daemon thread running a persistent asyncio loop at server startup; helper to run coroutines from HTTP handlers via `run_coroutine_threadsafe(...).result(timeout)`
- [x] 4.2 `PrinterManager`: connected set + remembered set, per-printer `asyncio.Lock`, connect/disconnect/reconnect/forget, active-printer selection (port `connection.ts`, minus role routing)
- [x] 4.3 Persist remembered printers + active selection + per-printer label size to `/var/lib/scan-web/niimbot-devices.json`; load on startup
- [x] 4.4 Adapter-state check (bleak) so the UI can report "Bluetooth unavailable" without erroring

## 5. Device inventory (union of sources)

- [x] 5.1 Enumerate CUPS printers via `lpstat` (queues, enabled/idle vs disabled, backing device for USB/network); normalize to the common `{kind,transport,id,name,status,forgettable,actions}` shape
- [x] 5.2 Enumerate SANE scanners (reuse the existing scan device list / `scanimage -L`, cached); normalize
- [x] 5.3 Enumerate raw USB via `lsusb`, deduped against CUPS/SANE entries; mark non-forgettable
- [x] 5.4 Merge Niimbot connected ∪ remembered from the `PrinterManager`; each source degrades independently (error row on failure)

## 6. HTTP routes + Devices tab UI (`scan-web.py.j2`)

- [x] 6.1 Inventory routes: `GET /devices`, `POST /devices/refresh`, `POST /devices/forget` (`lpadmin -x` for a queue; Niimbot forget; reject non-forgettable)
- [x] 6.2 Niimbot routes: `GET /niimbot/state`, `POST /niimbot/scan`, `/connect`, `/reconnect`, `/disconnect`, `/select`, `/labelsize`
- [x] 6.3 Print route: `POST /niimbot/print` (kind=text|qr|image + payload) → compose → send to active printer; reject with a clear message when none is active
- [x] 6.4 Add the Devices tab (gated by `scan_web_devices_enabled`) to the page: inventory list with per-row status + forget; Niimbot section with scan/connect/reconnect/select, label composer (text/QR/image), label-size control, and a live per-printer log pane (mirror moverse UX)
- [x] 6.5 Client JS: load inventory + niimbot state on tab open, Refresh action, wire all actions to the routes

## 7. Verification (needs hardware)

- [ ] 7.1 Confirm the host exposes a working BLE adapter (`bluetoothctl list`); if not, note the USB dongle requirement  _(needs live host)_
- [ ] 7.2 Scan → connect a D110 and a B1; verify model detection, status, and persistence across a service restart  _(needs hardware)_
- [ ] 7.3 One-click reconnect after powering a printer off/on  _(needs hardware)_
- [ ] 7.4 Print a text label, a QR label, and an image label on each model; confirm sizing/orientation and no truncation; tune default `SET_LABEL_TYPE` per model  _(needs hardware)_
- [ ] 7.5 Inventory: verify DCP-1511 queue + scanner + lsusb rows show correct status; forget a scratch CUPS queue and confirm removal  _(needs live host)_
- [x] 7.6 Update `README.md` with the Devices page + Niimbot setup notes; record follow-ups in project memory

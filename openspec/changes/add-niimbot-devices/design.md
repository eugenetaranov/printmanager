## Context

The printmanager web UI (`roles/web-ui/templates/scan-web.py.j2`) is a single-file, stdlib-only `ThreadingHTTPServer` running as the unprivileged `scans` user on port 80, with Scan and Print (A4/CUPS) tabs. It reaches the DCP-1511 through CUPS (`lp`).

Niimbot D110/B1 printers cannot use that path at all: they are battery thermal label printers that speak a proprietary framed protocol over **Bluetooth LE** (D110 has no USB print path). The Pi is Ubuntu 24.04 arm64 with an onboard/adapter Bluetooth radio driven by **BlueZ**.

A prior project, **moverse** (`/Users/e/projects/moverse`, `mobile/src/niimbot/`), already implements this exact protocol in TypeScript and has been **physically verified on a B1** and tuned for the D110's small buffer. It is the authoritative reference for this change: the packet framing, the print command sequence, the per-model printhead widths, and the reliability tuning are all proven there and are transport-portable.

## Goals / Non-Goals

**Goals:**
- A **Devices** tab that inventories **all** attached print/scan hardware — USB printers/scanners, the CUPS queue, the SANE scanner, and Niimbot BLE printers — each with a live connected/disconnected status and a remove/forget action.
- Within that page, discover Niimbot printers over BLE, connect on click, remember them, pick the **active** label printer, and offer **one-click reconnect** for a remembered printer that dropped.
- Print a label composed from **text**, a **QR code**, or an **uploaded image**, sized to the active printer's roll, to the selected Niimbot.
- Provisioning installs cleanly with **no printer present** (matching the existing degrade-gracefully behavior); connecting happens at runtime.

**Non-Goals:**
- CUPS/AirPrint for the Niimbots; auto-reconnect on boot; battery/telemetry beyond connected/disconnected; multi-copy queue accounting; the moverse notion of per-role routing (item/box). Here there is one active printer at a time.

## Decisions

### D0. The Devices page is a read-mostly inventory that unions several sources
The page enumerates hardware by querying each subsystem and normalizing to one shape `{ kind, transport, id, name, status, forgettable, actions[] }`:
- **CUPS printers** — `lpstat -p` / `lpstat -l -e` for queues and their enabled/idle/disabled state; a queue's backing device (`lpstat -v`) tells USB vs network. Status: enabled+idle → connected; disabled/paused → disconnected. Forget = `lpadmin -x <queue>` (guarded confirm).
- **SANE scanners** — the existing scan pipeline's device list (the brscan chroot / `scanimage -L`), cached because probing is slow. Status: present in the list → connected.
- **Raw USB** — `lsusb` for anything attached that isn't already represented by a CUPS/SANE entry (deduped by USB vendor:product), so a freshly plugged, not-yet-configured device still shows up. These are informational (status connected while enumerated); not forgettable.
- **Niimbot BLE** — from the `PrinterManager` (D2/D4): remembered set ∪ live connections, status = connected/disconnected, with connect/reconnect/select/forget actions.

Enumeration is invoked on tab load and on an explicit Refresh (subsystem probes, esp. SANE and BLE scans, are too slow for a tight poll). Each source degrades independently: if `lsusb` or `scanimage -L` fails, its section shows an error row and the rest still render.
- **Alternative — a single hotplug/udev daemon** feeding a live device tree: more faithful but a much larger surface (persistent socket, udev rules, event stream) than the "show me what's attached and let me forget it" ask. Rejected for now.

### D1. Port the moverse Niimbot module to Python rather than depend on `niimprint`
The moverse `packet.ts` / `client.ts` / `models.ts` / `label.ts` are ~600 lines total and encode hard-won, device-verified behavior: repeat-run row merging, batched acked writes with a no-response fallback, per-third black-pixel counts, and physical-completion status polling (`GET_STATUS 0xa3` → `0xb3`) before ending the job. Porting them to Python (stdlib + Pillow + `qrcode`) reuses that exactly and keeps the model registry we need (D110 = 96 px head, B1 = 384 px head; 203 dpi ≈ 8 px/mm).
- **Alternative — PyPI `niimprint`:** implements the same wire protocol but is less tuned for the D110's small buffer and would still need the label-composition + model-registry + remembered-set layers written on top. Rejected to avoid an unverified print path for one of the two target models.

### D2. BLE via `bleak` on a dedicated background asyncio loop thread
`bleak` is the maintained cross-platform BLE library and uses BlueZ/D-Bus on Linux. A `BleakClient` must live on the event loop that created it and must **persist between HTTP requests** (to hold the link open for reconnect and multi-request prints). So the server starts **one daemon thread running a persistent asyncio loop**; a server-side `PrinterManager` (the analogue of moverse's) lives there and owns the connected clients. Synchronous HTTP handlers marshal work in with `asyncio.run_coroutine_threadsafe(coro, loop).result(timeout)`. A per-printer `asyncio.Lock` serializes commands so two requests can't interleave on one link.
- BLE constants from moverse: service `e7810a71-73ae-499d-8c15-faa9aef0c3f2`, characteristic `bef8d6c9-9c21-4c9e-b632-bd58c1009f9f` (write + notify).
- **Alternative — spawn a CLI per print (`niimprint` subprocess):** simplest, but a fresh connect per action is slow and defeats "quick reconnect" / persistent selection. Rejected.

### D3. Install `bleak` via a `--system-site-packages` venv
The service runs system `python3` with apt-provided reportlab/Pillow. `bleak` is not dependably in apt. The role creates a venv at `/usr/local/lib/scan-web/venv` with `--system-site-packages` (so apt reportlab/Pillow/qrcode stay importable), `pip install`s a pinned `bleak`, and points the systemd unit at the venv's interpreter. If `python3-bleak` is present in apt on the host, prefer it and skip the venv.

### D4. Remembered set + active selection persisted as JSON under `/var/lib/scan-web`
`niimbot-devices.json`: list of `{ address, name, model, labelWidthMm, labelHeightMm }` plus the `activeAddress`. On Linux/BlueZ the device **address is the stable MAC**, so reconnect-by-address is reliable (unlike moverse's iOS opaque UUIDs). "Connect" scans (RSSI-sorted) and adds a new device; "Reconnect" connects a remembered address without a scan; "Forget" drops it. No bonding/PIN is needed — Niimbots use Just-Works GATT.

### D5. Label composition with Pillow, oriented long-axis-along-tape
Render a 1-bpp bitmap the width of the active model's head (clamped to a multiple of 8): **text** via Pillow `ImageDraw` + a bundled TrueType font, **QR** via `qrcode` → Pillow, **image** via Pillow grayscale → contain-fit → Floyd–Steinberg dither to 1-bit. As in moverse `label.ts`, lay out on a logical canvas whose long axis is horizontal and rotate 90° for portrait/narrow tape (D110) so content reads along the label length. Pack to MSB-first rows (`black = 1`) for the client.

### D6. New server routes, Devices tab in the same page
Inventory: `GET /devices` (the unioned list from D0), `POST /devices/refresh`, `POST /devices/forget` (`{ kind, id }` — routes to `lpadmin -x` for a CUPS queue or Niimbot forget; rejected for non-forgettable USB rows). Niimbot-specific: `GET /niimbot/state` (connected + remembered + active + adapter state), `POST /niimbot/scan`, `POST /niimbot/connect` (address), `POST /niimbot/reconnect` (address), `POST /niimbot/disconnect`, `POST /niimbot/select` (active), `POST /niimbot/labelsize`, `POST /niimbot/print` (kind=text|qr|image + payload). A `scan_web_devices_enabled` default gates the tab (mirrors `scan_web_print_enabled`).

## Risks / Trade-offs

- **Unprivileged `scans` user driving BlueZ over D-Bus** → BlueZ's default system-D-Bus policy restricts `org.bluez` to root. Mitigation: ship a D-Bus policy drop-in (`/etc/dbus-1/system.d/…`) granting the `scans` user send access to `org.bluez`, ensure `bluetooth.service` is enabled, and do not sandbox D-Bus away in the unit (the unit already avoids `NoNewPrivileges` for the scan sudo path). If the policy can't be applied, connect fails cleanly and is surfaced in the UI log.
- **Onboard Bluetooth presence/enablement is unverified on this host** (memory notes it's Ubuntu 24.04 arm64, not confirmed Pi hardware) → the base role ensures `bluetooth.service`; if no adapter exists, the Devices tab shows "no Bluetooth adapter" rather than erroring. Listed as an open question.
- **BLE reliability/range on the built-in radio** → reuse moverse's proven safeguards: RSSI-sorted candidate list, write-with-response with no-response fallback, repeat-run merging (cap 255), and status-poll-to-completion before ending the job; stream a per-printer log to the UI as moverse does.
- **Concurrency** (two requests hitting BLE) → single asyncio loop + per-printer lock serializes; scans and prints can't overlap on one link.
- **Provisioning without hardware** → every install step (packages, venv, policy, service) is device-independent; no connect at provision time. Rollback: `scan_web_devices_enabled=false` hides the tab; the venv/policy are inert without it.

## Open Questions

- Does the host actually expose a working Bluetooth adapter (`hciconfig`/`bluetoothctl list`)? If not, a USB BLE dongle is needed before the Devices tab is useful.
- Is `python3-bleak` available in the host's apt (universe) at a workable version, letting us skip the venv (D3)?
- Default `SET_LABEL_TYPE` per model (gap / continuous) — confirm the D110 tape and B1 stock defaults against a real print, as with the existing Print-tab nudge calibration.

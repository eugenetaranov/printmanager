## Why

The printmanager Pi drives devices through several unrelated subsystems — CUPS for the USB Brother DCP-1511, SANE for its scanner — and there is **no single place to see what hardware is actually attached and working**. On top of that, the user owns two **Niimbot** thermal label printers (a **D110** and a **B1**) that speak a proprietary protocol over **Bluetooth LE** (the D110 has no USB print path at all) and are invisible to every existing tool. The user wants one **Devices** page that inventories everything — USB printers/scanners, Bluetooth label printers, anything attached — shows each one's connected/disconnected status, lets them forget a device, and (for the Niimbots) connect, quickly reconnect, and print a label.

## What Changes

- Add a new **Devices** page (third tab) to the scan-web UI that presents a **unified inventory of all print/scan hardware** across transports — USB (via CUPS queues, SANE scanners, and raw `lsusb`), Bluetooth LE (Niimbot printers), and the CUPS/SANE services — each shown with a live **connected / disconnected** status and a **remove/forget** action.
- **Discover & connect** Niimbot printers over **Bluetooth LE** (primary) with a **USB-serial fallback** for models/cables that support it. The page lists nearby/known devices and connects on click.
- **Remember known Niimbot printers** (friendly name + BLE address/USB path + model) so they persist across restarts, and offer **one-click reconnect** for a saved printer that has dropped its link.
- **Select the active label printer** among connected/known Niimbots; the label-print action targets the selected one. Switching is immediate.
- **Print labels** to the selected Niimbot: compose a label from **text**, a **QR code** (from text/URL), or an **uploaded image**, sized to the loaded roll (e.g. D110 12–15 mm tapes, B1 up to ~50 mm), rendered monochrome and sent over the wire.
- Provision the supporting stack in the **web-ui role**: BlueZ + BLE Python deps, the Niimbot print backend, QR/image rendering, service-user Bluetooth access, and any firewall/permission changes.

Non-goals: driving the Niimbots through CUPS/AirPrint, auto-reconnect on boot, battery/status telemetry beyond connect state, multi-copy/queue accounting, and adding/creating brand-new CUPS/SANE devices from this page (it inventories, statuses, and forgets — creation of the DCP-1511 queue stays in the print-server role).

## Capabilities

### New Capabilities
- `device-inventory`: A unified Devices page that enumerates all attached print/scan hardware across USB, Bluetooth, and the CUPS/SANE subsystems, reports each device's connected/disconnected status, and can remove/forget a device.
- `niimbot-connectivity`: Discover, connect to, remember, select, and reconnect Niimbot D110/B1 label printers over Bluetooth LE (with USB-serial fallback), surfaced within the Devices page.
- `niimbot-label-printing`: Compose a label from text, a QR code, or an uploaded image, size it to the loaded roll, and print it to the selected Niimbot printer.

### Modified Capabilities
<!-- None. The existing print-sharing (CUPS/DCP-1511) and network-scanning capabilities are untouched; the Devices page reads their state (and can remove a queue) but does not change how they provision. -->

## Impact

- **`roles/web-ui`**: new page and server routes in `templates/scan-web.py.j2`; new packages in `defaults/main.yaml` (BLE stack: `bluez`, a BLE client lib e.g. `bleak`; the Niimbot protocol backend; `python3-qrcode`, Pillow already present); a small persistent store for known printers (e.g. JSON under `/var/lib/scan-web`); the scan-web systemd unit likely needs D-Bus/BlueZ access so the unprivileged `scans` user can drive the adapter.
- **`roles/base`** (possibly): ensure the Pi's Bluetooth adapter is enabled and `bluetooth.service` is up; group membership (`bluetooth`) for the service user.
- **New config vars**: default label roll sizes per model, and a toggle to enable/disable the Devices tab (mirrors `scan_web_print_enabled`).
- **Hardware dependency**: the D110/B1 must be powered and in range to pair; provisioning must install and configure cleanly with no printer present (like the existing degrade-gracefully behavior for the DCP-1511).
- **No change** to CUPS, scanning, or the Samba share.

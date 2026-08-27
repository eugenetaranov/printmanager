## Why

printmanager is hardwired to one specific set of hardware — a single USB **Brother DCP-1511** — in ways that live inside the roles, not in config. The print queue is created only when a device whose URI matches `usb://Brother` is detected, bound to the `brlaser` PPD; the scanner path is an entire architecture built around Brother's proprietary x86 `brscan4` driver running under i386 qemu emulation. Someone else who wants to run this on their own printer/scanner has to edit role internals and understand the Brother emulation hack. The goal is to make the hardware **config-driven and multi-device** so a new user adds their printers/scanners by editing one documented vars file, while the current Brother setup keeps working as one configured example.

## What Changes

- **BREAKING (config shape):** hardware is declared as **lists** in one place (host vars) — `printers:` and `scanners:` — instead of the single-device scalars (`printer_queue_name`, `printer_ppd`, `scan_mode`, the implicit brscan4 assumption). The existing single-Brother setup is expressed as one entry in each list, so behavior is preserved once migrated.
- **print-server** provisions **N CUPS queues** by looping over `printers:`. USB detection becomes **brand-agnostic** (match any `usb://…` device, or an explicit per-printer match string) instead of hardcoding `usb://Brother`. Each printer declares its driver as `driverless` (IPP Everywhere / driverless-USB, no PPD or vendor package) or a named driver/PPD (e.g. `brlaser` + `drv:///brlaser.drv/br1510.ppd`). Driver packages install per the drivers actually used.
- **scan-server** gains a **pluggable scan backend** per scanner. `escl` (driverless via `sane-airscan`) becomes the **default** — no chroot, no qemu, no saned net-bridge. The current Brother path becomes the opt-in `brscan4-emu` backend, and all of today's brscan4 machinery (i386 chroot, net-bridge, `pad_pnm.py`) is provisioned **only when a scanner selects it**.
- **web-ui Print tab** gets a **printer-selector dropdown**: it lists the available CUPS queues with friendly brand+model names (reusing `_printer_name()`), the user picks the target, and `do_print` sends to the chosen queue instead of the fixed `PRINT_QUEUE`. The configured default is just the initial selection.
- **Docs**: README and role comments stop presenting "Brother DCP-1511" as the identity of the system; it's documented as the shipped example config, with instructions for adding other printers/scanners.

Non-goals: rewriting the Niimbot BLE path (already model-registry driven); automatic driver detection beyond `driverless` vs a named driver/PPD; packaging drivers for arbitrary vendors beyond what CUPS and driverless already provide; changing scan storage, Samba, the watchdog, or the firewall model.

## Capabilities

### New Capabilities
- `device-configuration`: A single, documented, config-driven model for declaring the host's print/scan hardware as `printers:` and `scanners:` lists (identity, driver/backend, options), which the roles consume by looping — supporting multiple devices and provisioning cleanly when hardware is absent.
- `print-target-selection`: The Print tab lets the user choose which CUPS queue a job is sent to, from the queues available on the host, shown with friendly brand+model names, defaulting to the configured queue.

### Modified Capabilities
- `print-sharing`: from a single hardcoded Brother/`brlaser` queue to N config-driven queues with brand-agnostic USB detection and per-printer `driverless`-or-named-driver selection.
- `network-scanning`: from a Brother-`brscan4`-only pipeline to a per-scanner pluggable backend with driverless **eSCL** as the default and `brscan4-emu` as an opt-in backend (today's behavior preserved when selected).

## Impact

- **`roles/print-server`**: loop over `printers:`; brand-agnostic `setup-printer-queue.sh` (match any USB URI or a per-printer pattern); driver/PPD and driver-package selection per printer; `driverless` path (no PPD). `defaults/main.yaml` gains a `printers:` default holding the DCP-1511 example.
- **`roles/scan-server`**: introduce `scan_backend` per scanner; gate the chroot/qemu/net-bridge/`pad_pnm.py`/`brscan4` install on `brscan4-emu`; add the `escl`/`sane-airscan` path (packages, dll config, AirSane still optional); generalize `scan_mode`/resolution handling so it isn't tied to brscan4's exact mode strings.
- **`roles/web-ui`**: Print-tab queue dropdown (server route to list queues + friendly names, client `<select>`, `do_print` honoring the selection); `scan_web_print_queue` becomes the default among many.
- **`roles/base`**: possibly `avahi`/`sane-airscan` prerequisites for driverless discovery.
- **`site.yaml` / new `host_vars/`**: the `printers:`/`scanners:` config; a documented example.
- **`README.md`** and role comments: reframe Brother as the example, document adding other hardware.
- **Hardware/degradation**: provisioning must succeed with no printer/scanner attached, per today's behavior, for every backend/driver path.

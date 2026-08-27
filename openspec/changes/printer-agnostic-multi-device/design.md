## Context

The roles today encode one specific device set. `print-server` creates a single CUPS queue, detecting the printer by the hardcoded URI pattern `usb://Brother` and binding the `brlaser` PPD. `scan-server` is an entire architecture dedicated to running Brother's proprietary x86 `brscan4` driver under i386 qemu emulation (debootstrap chroot, a localhost saned net-bridge, `pad_pnm.py` to work around a Brother short-read bug, AirSane to re-expose the chroot scanner as eSCL). `web-ui` is already largely device-agnostic (it derives brand+model from CUPS URIs and drives Niimbots off a model registry) except that the Print tab prints to a single fixed `PRINT_QUEUE`.

A hard constraint from the provisioning tool (**tack**): templates render in a **single pass**, and **loop item values are not template-expanded**. The `print-server` role already documents this — it uses two explicit iptables tasks instead of a loop because a loop item like `"{{ cups_listen_port }}/tcp"` would reach the module unrendered. This directly shapes how "N devices" must be implemented: we cannot write a task that loops over `printers:` passing `{{ item.ppd }}`-style values.

## Goals / Non-Goals

**Goals:**
- Declare all print/scan hardware as `printers:` and `scanners:` **lists** in one documented place; roles consume them.
- Support **multiple** printers (N CUPS queues) and scanners (N sources) on one host.
- Driverless-first: `driverless` printers and `escl` scanners need **no** vendor driver, PPD, chroot, or qemu.
- Preserve the current Brother DCP-1511 + `brscan4` behavior exactly, expressed as one configured example.
- Provision cleanly when a device is absent, for every driver/backend path (matches today).
- Add the Print-tab queue selector.

**Non-Goals:**
- Niimbot BLE rework (already registry-driven).
- Auto driver detection beyond `driverless` vs a named driver/PPD.
- Vendor driver packaging beyond CUPS + driverless + the existing brscan4-emu recipe.
- Changes to scan storage, Samba, watchdog, or the firewall model.

## Decisions

### 1. Config lives in role `defaults/main.yaml` as `printers:` / `scanners:` lists, overridden via `site.yaml` `vars:`
Tack has no Ansible-style `host_vars/` directory — host/group vars come from an `inventory.yaml` (`hosts.<name>.vars`) or `vars:` blocks. This repo keeps a self-contained `site.yaml` (host inlined, no inventory file) with all config in role defaults, so: the **example lists live in each role's `defaults/main.yaml`** (a bare checkout provisions the reference box), and a user overrides them in a **`vars:` block in `site.yaml`** (play- or role-level). An `inventory.yaml` remains a drop-in option for multi-host setups but is not required. (Original plan said `host_vars/`; corrected to tack's model during apply.) Shipped example encodes today's box:
```yaml
printers:
  - name: DCP1511            # CUPS queue name
    description: Brother DCP-1511
    location: Home LAN
    match: "usb://Brother"   # URI substring for USB detection; omit ⇒ first usb://
    driver: brlaser          # driverless | brlaser | <driver-package>
    ppd: "drv:///brlaser.drv/br1510.ppd"   # omitted when driver: driverless
    default: true            # initial Print-tab selection
scanners:
  - name: dcp1510
    backend: brscan4-emu     # escl | brscan4-emu
    mode: "24bit Color"
    resolution: 300
    # brscan4-emu-only knobs (deb url, suite, mirror) namespaced under the entry
```
*Alternative considered:* keep scalars in `defaults/main.yaml` and override in `site.yaml`. Rejected — it doesn't scale to N devices and keeps hardware identity spread across role internals, which is the thing we're removing. Role `defaults/main.yaml` still holds the **example** lists so a bare checkout provisions the current box.

### 2. Iterate lists at TEMPLATE-render time, not with task loops (works around tack single-pass)
Instead of looping tasks over `printers:`, render **one** helper script from a template that `range`s over the list, then execute it once. This keeps every `{{ .field }}` inside file rendering (which tack does fully — `scan-to-share.sh.j2` already uses `{{ range … }}`) and never puts a templated value into a task loop item.
- `setup-printers.sh.j2` ranges over `.printers`, and for each runs the detect-and-`lpadmin` logic (driverless ⇒ `-m everywhere`/`driverless:` URI, no PPD; named driver ⇒ its PPD). Executed by one `command` task.
- Firewall/service tasks that can't be a single rendered file (iptables ports) stay as today's small fixed set — the LAN-facing ports (631, 5353, web, AirSane) don't multiply per device.
*Alternative considered:* a tack task loop with `item.*`. Rejected — the single-pass limitation would deliver unrendered `{{ item.ppd }}` to `lpadmin`.

### 3. Scan backend is per-scanner; `escl` is default and carries none of the brscan4 machinery
- `escl`: install `sane-airscan`; host `dll.conf` enables the `airscan` backend; the scanner is reached by `scanimage -d "airscan:…"` (or by name). No chroot, no qemu, no net-bridge, no `pad_pnm.py`, no forced AirSane (eSCL scanners self-advertise; AirSane stays optional and off by default for escl).
- `brscan4-emu`: exactly today's path — chroot, net-bridge, `brother4`, `pad_pnm.py`, AirSane to re-export as eSCL — provisioned **only** when at least one scanner selects it.
- The chroot/qemu/debootstrap tasks become `when:` gated on "any scanner uses brscan4-emu".

### 4. Scan mode/resolution move into per-scanner config; the pipeline passes them through
brscan4 mode strings (`"24bit Color"`, `"True Gray"`) differ from SANE/escl (`Color`, `Gray`, `Lineart`). `scan-to-share.sh` already reads `SCAN_MODE`/`SCAN_RES` from the environment; the per-scanner `mode`/`resolution` supply the defaults, and `pad_pnm.py` is applied only on the brscan4 path. The Scan-tab dropdown defaults come from the selected scanner.

### 5. Print-tab printer selector (web-ui)
Add a server route that lists CUPS queues (`lpstat`) with friendly names via the existing `_printer_name()`. The client renders a `<select>` (default = the `default: true` printer, remembered in the browser like the nudge offsets). `do_print` accepts the chosen `queue` and calls `lp -d <queue>`; the fixed `PRINT_QUEUE` becomes the fallback default only. Multi-scanner gets the analogous (lighter) treatment: the pipeline targets a configured scanner via `scanimage -d`; a Scan-tab scanner picker is included only if more than one scanner is configured.

## Risks / Trade-offs

- **tack single-pass rendering** → all per-device iteration happens inside rendered `range` templates executed once; no task uses `{{ item.* }}`. Verified pattern already exists in the repo.
- **Behavior drift for the Brother path** → the `brscan4-emu` backend keeps the exact current scripts/units; a migration entry reproduces today's config 1:1 and is verified on the live Pi before the change is considered done.
- **Driverless reliability varies by model** → `driverless`/`escl` is the default because it's the common modern case, but a device that misbehaves can fall back to a named driver / `brscan4-emu`; both remain first-class.
- **Multi-scanner web-ui scope creep** → keep the Scan-tab picker minimal (only shown for >1 scanner); the printer dropdown (explicit ask) is the primary UI deliverable.
- **Config migration is BREAKING** → old scalar vars stop being read. Mitigated by shipping the example lists as role defaults (bare checkout still works) and a documented migration.

## Migration Plan

1. Add `printers:`/`scanners:` example lists to role `defaults/main.yaml` reproducing the DCP-1511 + brscan4-emu box; keep old scalars working as a thin shim for one release if cheap, else document the swap.
2. Land print-server multi-queue + driverless; verify the DCP-1511 queue is byte-for-byte equivalent and LAN printing + AirPrint still work.
3. Land scan-server backend split; verify `brscan4-emu` produces identical scans to today, then verify an `escl` scanner end-to-end if hardware is available.
4. Land the Print-tab selector; verify default selection + switching.
5. Update README/docs; add a "adding your own printer/scanner" section.
Rollback: revert the change; the roles return to the single-device scalars.

## Open Questions

- Keep a compatibility shim mapping the old scalars → a one-entry list for one release, or cut over cleanly with a documented migration? (Leaning: clean cut, example lists in defaults.)
- Should `escl` scanners ever provision AirSane, or rely solely on the scanner's own eSCL advertisement? (Leaning: rely on the device; AirSane stays brscan4-emu-only.)

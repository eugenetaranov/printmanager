# Tasks

Design constraint (see design.md §2): **tack renders templates single-pass and does NOT expand `{{ item.* }}` in task loops.** Iterate device lists inside rendered `range` templates executed once — never with a task loop over templated per-device values. The repo already does this in `scan-to-share.sh.j2` (`{{ range … }}`).

## 1. Config schema + example lists

- [ ] 1.1 Define the `printers:` list schema (name, description, location, `match`, `driver` = `driverless|<driver-pkg>`, `ppd`, `default`) and add the DCP-1511 example to `roles/print-server/defaults/main.yaml`, replacing the single-device scalars
- [ ] 1.2 Define the `scanners:` list schema (name, `backend` = `escl|brscan4-emu`, `mode`, `resolution`, and brscan4-emu-only knobs: deb url/suite/mirror) and add the DCP-1510 `brscan4-emu` example to `roles/scan-server/defaults/main.yaml`
- [ ] 1.3 Add a documented `host_vars/printmanager.yaml` (or equivalent) showing the reference box as config; confirm a bare checkout still resolves to the example lists
- [ ] 1.4 Add derived helpers the roles need: list of driver packages to install, and a boolean "any scanner uses brscan4-emu" for gating

## 2. print-server: multi-queue, driverless, brand-agnostic

- [ ] 2.1 Rewrite `setup-printer-queue.sh.j2` → `setup-printers.sh.j2` that `range`s over `.printers`: per entry, detect the URI (match substring or first `usb://`), and `lpadmin` with the entry's PPD, or driverless (`-m everywhere`/`driverless:` URI, no PPD) when `driver: driverless`; keep the "leave existing queue untouched when device absent, exit 0" behavior
- [ ] 2.2 Update `tasks/main.yaml` to install only the driver packages actually referenced (derived in 1.4) plus CUPS/Avahi, and to run `setup-printers.sh` once (no task loop over printers)
- [ ] 2.3 Mark the configured `default: true` printer as the CUPS system default; ensure `printer-is-shared=true` per queue
- [ ] 2.4 Confirm the IPP/mDNS firewall rules remain the fixed small set (ports don't multiply per device)

## 3. scan-server: pluggable backend (escl default, brscan4-emu gated)

- [ ] 3.1 Gate all brscan4-emu machinery (`install-brscan4-emu.sh`, chroot bind mounts, net-bridge saned socket/service, host `dll.conf=net`/`net.conf`, `pad_pnm.py`, AirSane) behind the "any scanner uses brscan4-emu" boolean
- [ ] 3.2 Add the `escl` path: install `sane-airscan`, enable the `airscan` host SANE backend (`dll.conf`), and select the scanner by name/URI; no chroot/qemu/net-bridge for escl-only hosts
- [ ] 3.3 Generalize `scan-to-share.sh.j2`: take mode/resolution from the target scanner's config; apply `pad_pnm.py` only on the brscan4 path; keep OCR/thumbnail/metadata steps backend-independent
- [ ] 3.4 Support selecting which scanner the pipeline scans from (`scanimage -d <device>`), defaulting to the first configured scanner
- [ ] 3.5 Keep the retention cron and scan-share integration unchanged

## 4. web-ui: Print-tab printer selector

- [ ] 4.1 Add a server route that lists CUPS queues via `lpstat` with friendly names from `_printer_name()`; include which is the configured default
- [ ] 4.2 Add a `<select>` to the Print tab populated from that route; default to the configured default and remember the choice in the browser (like the nudge offsets)
- [ ] 4.3 Change `do_print` to accept the chosen `queue` and `lp -d <queue>`; `PRINT_QUEUE` becomes the fallback default; confirmation reports the queue used
- [ ] 4.4 If more than one scanner is configured, add the analogous (minimal) scanner picker to the Scan tab; otherwise omit it
- [ ] 4.5 Update `scan-web-config.yaml.j2` so print/scan defaults come from the lists (default queue, default scanner + its mode/res)

## 5. Docs

- [ ] 5.1 Rework `README.md` so Brother DCP-1511 is presented as the shipped example, not the system's identity
- [ ] 5.2 Add an "Adding your own printer/scanner" section (a driverless printer entry; an escl scanner entry; when to reach for `brscan4-emu`)
- [ ] 5.3 Update role header comments that name the Brother as if it were the only supported device

## 6. Verify on the Pi (needs live host + hardware)

- [ ] 6.1 Migrate the live Pi to the new config and re-run `tack site.yaml`; confirm the DCP-1511 queue is equivalent (enabled, shared, AirPrint-visible) and LAN printing still works
- [ ] 6.2 Confirm the `brscan4-emu` scan path produces scans equivalent to today (mode/res/OCR/thumbnail)
- [ ] 6.3 Verify the Print-tab selector: default pre-selected, switching queues routes the job, selection persists
- [ ] 6.4 If an eSCL scanner is available, verify the `escl` backend end-to-end on a host with no chroot/qemu
- [ ] 6.5 Confirm clean provisioning with no printer/scanner attached for both driver paths and both scan backends

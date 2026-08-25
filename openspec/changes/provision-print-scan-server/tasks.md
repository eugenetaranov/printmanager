## 1. Base host provisioning role (`roles/base`)

- [x] 1.1 Scaffold `roles/base/{tasks,defaults,handlers}/main.yaml`
- [x] 1.2 Define `local_subnet` and other shared vars in `roles/base/defaults/main.yaml`
- [x] 1.3 Task: `apt update` + install common packages (ca-certificates, curl, usbutils, ufw)
- [x] 1.4 Task: configure ufw — allow SSH (22) first, then enable (avoid lockout)
- [x] 1.5 Wire `base` as the first role for `printmanager.local` in `site.yaml`
- [ ] 1.6 Run playbook; verify base packages installed and ufw active with SSH allowed  _(needs live host)_

## 2. Print server role (`roles/print-server`)

- [x] 2.1 Scaffold `roles/print-server/{tasks,defaults,handlers,templates}/main.yaml`
- [x] 2.2 Task: install `cups`, `printer-driver-brlaser`, `avahi-daemon`
- [x] 2.3 Task: configure `cupsd.conf` to listen on the LAN and allow the subnet (template + restart handler)
- [x] 2.4 Task: define the `DCP1511` queue via `lpadmin` — helper auto-detects the Brother `usb://` URI (includes serial) so re-plugging doesn't break it, using the brlaser PPD
- [x] 2.5 Task: mark the queue shared and enable/accept jobs; set as default
- [x] 2.6 Task: enable Avahi and confirm CUPS AirPrint advertisement is on
- [x] 2.7 Task: open ufw for IPP 631/tcp and mDNS 5353/udp from the subnet
- [x] 2.8 Wire `print-server` into `site.yaml`
- [ ] 2.9 Verify (provision-time): services up, port 631 open, queue config present  _(needs live host)_

## 3. Scan server role (`roles/scan-server`)

- [x] 3.1 Scaffold `roles/scan-server/{tasks,defaults,handlers,templates,files}/main.yaml`
- [x] 3.2 Task: install `sane-utils`, `imagemagick`/`sane-frontends`, `scanbd`
- [x] 3.3 Task: detect host arch (via `.facts.arch`) and install the matching `brscan4` vendor `.deb` (URL/version pinned in defaults; graceful skip on ARM)
- [x] 3.4 Task: scanner registration — USB devices are auto-detected via brscan4's udev rules; `brsaneconfig4 -a` is network-only and intentionally not used (deviation from original wording, see summary)
- [x] 3.5 Task: template the scan script — `scanimage` → PDF (300dpi, `scan-YYYYMMDD-HHMMSS.pdf`) → write to the Samba scan dir
- [x] 3.6 Task: configure `scanbd` (button monitor) to run the scan script on the Scan button action  _(trigger name needs on-device confirmation)_
- [x] 3.7 Task: configure `saned` for network pull scanning, allow the subnet, coordinate with scanbd for device access
- [x] 3.8 Task: enable `scanbd` and `saned` services (systemd/socket as appropriate)
- [x] 3.9 Task: open ufw for SANE net 6566/tcp from the subnet
- [x] 3.10 Wire `scan-server` into `site.yaml` (after `scan-share` dir exists)
- [ ] 3.11 Verify (provision-time): scanbd + saned active, port 6566 open, scanner probed  _(needs live host)_

## 4. Scan share role (`roles/scan-share`)

- [x] 4.1 Scaffold `roles/scan-share/{tasks,defaults,handlers,templates}/main.yaml`
- [x] 4.2 Task: install `samba`; create the backing directory (`/srv/scans`, setgid) with ownership/permissions for the scan process and share users
- [x] 4.3 Task: template `smb.conf` with a `[scans]` share, LAN-scoped `hosts allow`, and the scan directory as path
- [x] 4.4 Task: create the `scans` Samba user and set its password from a Tack variable/secret (default empty → skipped, no committed plaintext)
- [x] 4.5 Task: enable `smbd`; open ufw for SMB (445/tcp, 139/tcp) from the subnet
- [x] 4.6 Wire `scan-share` into `site.yaml` before `scan-server`
- [ ] 4.7 Verify: mount `\\printmanager.local\scans` from a client with credentials; off-subnet/unauthenticated access denied  _(needs live host)_

## 5. End-to-end verification (printer attached)

- [ ] 5.1 Physically connect the DCP-1511 via USB; re-run the playbook (idempotent, no changes expected beyond device pickup)  _(needs hardware)_
- [ ] 5.2 Verify print: `lpstat -p DCP1511` enabled; submit a test print from a LAN client  _(needs hardware)_
- [ ] 5.3 Verify AirPrint: DCP-1511 appears automatically in an iOS/macOS print dialog and prints  _(needs hardware)_
- [ ] 5.4 Verify scanner: `scanimage -L` lists the device via `brother4`; test `scanimage` scan succeeds  _(needs hardware + working brscan4)_
- [ ] 5.5 Verify button scan: press Scan → timestamped PDF appears in `\\printmanager.local\scans`  _(needs hardware)_
- [ ] 5.6 Verify network scan: client initiates a pull scan via saned and receives an image  _(needs hardware)_
- [ ] 5.7 Verify coexistence: a button scan and a network scan do not collide/corrupt  _(needs hardware)_

## 6. Documentation

- [x] 6.1 Add a README documenting client setup (add printer, mount share, network-scan config) and the post-connect verification steps
- [x] 6.2 Note pinned `brscan4` version/URL and the manual fallback if vendor packaging changes

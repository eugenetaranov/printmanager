## Context

The target is a Raspberry Pi (Debian-based Raspberry Pi OS Lite) at `192.168.1.113`, provisioned with **Tack** — a single-binary, Ansible-compatible config tool — via this repo's `site.yaml` playbook and `roles/` directory. The Pi will host a USB-connected Brother DCP-1511 (mono laser MFP, USB-only, no networking). The community `tack-roles` collection provides infrastructure roles (docker, tailscale, etc.) but **nothing for printing or scanning**, so roles are authored locally.

Key constraint: the printer is **not yet physically connected**. All provisioning must be idempotent and must not fail on the absence of the USB device; the device-dependent behaviors (queue binding, scanner detection) become live once the printer is plugged in, with no re-provision needed.

Roles follow the Ansible-compatible layout Tack expects: `roles/<name>/{tasks,handlers,defaults,templates,files}/main.yaml`.

## Goals / Non-Goals

**Goals:**
- LAN-wide printing to the DCP-1511 via CUPS + `brlaser`, discoverable via Avahi/AirPrint.
- Scanning via SANE + `brscan4`, with both physical Scan-button-to-share and network pull (`saned`).
- A cross-platform Samba share as the scan destination.
- Fully reproducible via `site.yaml`; safe to run before the printer is attached.

**Non-Goals:**
- Color/photo profile tuning, duplex, or advanced finishing.
- Print accounting/quotas, cloud print, or multi-printer fleets.
- NFS/FTP shares (SMB chosen; see Decisions).
- Remote/off-LAN access (Tailscale et al. are out of scope for this change).

## Decisions

**Role decomposition** — four local roles wired into `site.yaml`, in order:
1. `base` — apt update, common packages, firewall (ufw) baseline, subnet variable.
2. `print-server` — CUPS, `printer-driver-brlaser`, queue definition, sharing, Avahi/AirPrint.
3. `scan-server` — SANE, `brscan4` (vendor `.deb`), `brsaneconfig4` device registration, `scanbd` (button), `saned` (network pull), the scan script.
4. `scan-share` — Samba install, `scans` share, user/creds, permissions.

Rationale: one role per capability keeps tasks/handlers cohesive and lets `base` own cross-cutting concerns. Each maps 1:1 to a spec (`print-sharing`, `network-scanning`, `scan-storage`).

**Print driver: `brlaser` over Brother's proprietary driver** — `brlaser` (packaged as `printer-driver-brlaser`) supports the DCP-1510/1511 family, is in Debian repos, and needs no vendor blob. *Alternative:* Brother's proprietary LPR/cupswrapper `.deb`s — heavier, arch-sensitive (the Pi is ARM), and unnecessary here.

**Scan driver: Brother `brscan4`** — the DCP-1511 scanner is not supported by generic SANE backends; `brscan4` is Brother's supported backend. It ships as a vendor `.deb`; on ARM the armhf/arm64 package (or the source config) is used, registered with `brsaneconfig4 -a`. *Alternative:* `sane-airscan`/eSCL — not applicable, the DCP-1511 has no network/IPP-scan capability.

**Button handling: `scanbd`** — `scanbd` monitors scanner button events and can dispatch a scan script; it also brokers device access with `saned` (scanbd holds the device and hands off), which is why it's preferred over bare `scanbuttond`. On a button press it runs a script that invokes `scanimage`, converts to PDF, and drops the file into the Samba share directory. *Alternative:* `scanbuttond` — lighter but no clean saned coexistence story.

**Network scanning: `saned`** — standard SANE net daemon for client-initiated scans, run under scanbd's coordination so button and pull scans don't collide on the USB device.

**Share protocol: Samba/SMB** — chosen for the broadest cross-platform, authenticated, browsable UX on a mixed LAN (Windows/macOS/Linux/mobile). *Alternatives considered:* NFS (host-based auth, poor Windows/macOS UX) and FTP (plaintext, not a real mount). SMB wins for this use case.

**Discovery: Avahi/mDNS** — CUPS + `avahi-daemon` advertises the queue as AirPrint so Apple/mobile devices need no driver. Non-Apple clients can still add the IPP queue manually.

**Idempotency / no-printer-attached:** package installs, service enablement, config templating, `brsaneconfig4` registration, and CUPS queue definition all run regardless of USB presence. Device-detection steps (`lpstat`, `scanimage -L`) are verification-only and are expected to be empty until the printer is connected — provisioning does not gate on them.

## Risks / Trade-offs

- **brscan4 ARM packaging is finicky** → pin a known-good `.deb` URL/version in role defaults; register via `brsaneconfig4`; document the manual fallback if the vendor package layout changes.
- **scanbd ↔ saned device contention** → use scanbd's saned wrapper so only one holds the scanner; document that simultaneous button + network scans serialize.
- **Cannot fully verify without the printer** → split verification into "provision-time" checks (services up, ports open, config present) and "printer-attached" checks (queue prints, `scanimage -L` lists device); the latter is a documented post-connect step.
- **USB device path instability** → bind CUPS/SANE to the Brother by USB VID/PID or serial rather than a bus path so re-plugging doesn't break the queue.
- **Samba credential management** → store the share password via a Tack variable/secret, not committed plaintext; restrict the share to the LAN subnet.
- **Firewall lockout risk when enabling ufw over SSH** → allow SSH (22) before enabling ufw; open 631/6566/137-139/445 to the subnet only.

## Migration Plan

1. Author roles under `roles/`, wire into `site.yaml`.
2. Run the playbook against `192.168.1.113` (printer may be absent) — expect all services up and config present.
3. Physically connect the DCP-1511 via USB; run provision-time verification.
4. Run printer-attached verification (test print, `scanimage -L`, button scan → file in share, network pull scan).
5. Rollback: roles are additive; disabling is `systemctl disable` of the services + removing the `site.yaml` role entries. No destructive changes to the host baseline.

## Open Questions

- Exact `brscan4` package variant for this Pi's architecture (armhf vs arm64) — resolve at implementation by checking `dpkg --print-architecture` on the host.
- Scan output defaults: PDF vs TIFF/JPEG, resolution, and filename scheme — default to 300dpi PDF named `scan-YYYYMMDD-HHMMSS.pdf`; adjust after first real scan.
- Single shared Samba credential vs per-user accounts — default to a single `scans` user for simplicity; revisit if multi-user separation is needed.

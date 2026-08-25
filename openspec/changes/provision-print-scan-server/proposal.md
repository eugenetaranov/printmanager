## Why

A Brother DCP-1511 is a USB-only mono laser multifunction device with no built-in networking, so today only a single directly-attached computer can print or scan with it. Connecting it to a Raspberry Pi and provisioning that Pi as a print/scan server makes the device usable by every machine on the LAN and adds scan-to-network-share, which the hardware cannot do on its own.

## What Changes

- Provision the Raspberry Pi at `192.168.1.113` via the existing Tack playbook (`site.yaml`) using purpose-built roles under `roles/` (tack-roles has no printer/scanner role to reuse).
- Install and configure **CUPS** with the open-source **brlaser** driver, creating a shared print queue for the USB-attached DCP-1511 reachable by all LAN clients over IPP.
- Advertise the queue via **Avahi/mDNS (AirPrint)** so Apple and mobile devices discover and print to it with zero driver install.
- Install **SANE + Brother brscan4** and enable **both** scan paths: device **Scan-button-triggered** scan-to-share (via scanbd/scanbuttond) **and** network **pull scanning** (via `saned`).
- Stand up a cross-platform **Samba/SMB share** as the destination folder where button-triggered scans (PDF/image) are written and from which clients retrieve them.
- Wire the new roles into `site.yaml` so the whole setup is reproducible and idempotent.

Non-goals: color/photo tuning, cloud print, print quota/accounting, and multi-printer fleets. Note: the printer is **not yet physically connected**, so USB-dependent steps must degrade gracefully and be verifiable once plugged in.

## Capabilities

### New Capabilities
- `print-sharing`: LAN-wide network printing to the USB DCP-1511 via CUPS + brlaser, including Avahi/mDNS AirPrint discovery.
- `network-scanning`: Scanning the DCP-1511 over the network via SANE + brscan4, supporting both physical Scan-button-triggered jobs and client-initiated pull scans (saned).
- `scan-storage`: A Samba/SMB network share that serves as the destination for scanned documents and is accessible from Windows, macOS, and Linux clients.

### Modified Capabilities
<!-- None: this is a greenfield provisioning project with no existing specs. -->

## Impact

- **New roles** under `roles/`: printing (CUPS/brlaser/Avahi), scanning (SANE/brscan4/scanbd/saned), and file sharing (Samba), plus a base host-prep role.
- **`site.yaml`**: updated to include the new roles for host `192.168.1.113`.
- **System packages** on the Pi: `cups`, `printer-driver-brlaser`, `avahi-daemon`, `sane-utils`, `brscan4` (vendor `.deb`), `scanbd`, `samba`.
- **Services**: `cups`, `avahi-daemon`, `saned`, `scanbd`, `smbd` enabled and firewall/ports opened on the LAN.
- **Hardware dependency**: USB connection to the DCP-1511 (currently absent) required for end-to-end verification.

# printmanager

Provisions a Raspberry Pi (`printmanager.local`) as a **print + scan server** for a
USB-connected **Brother DCP-1511** using [Tack](https://github.com/tackhq/tack)
(an Ansible-compatible config tool). The Pi bridges the USB-only printer onto
the LAN and adds scan-to-network-share.

## What it sets up

| Capability | How |
| --- | --- |
| LAN printing | CUPS + `brlaser`, shared queue `DCP1511` over IPP (631) |
| Zero-config discovery | Avahi/mDNS → AirPrint for Apple/mobile devices |
| Scanning | SANE + Brother `brscan4` |
| Scan button → share | `scanbd` runs a scan and drops a PDF into the SMB share |
| Network pull scanning | `saned` (SANE net, 6566) |
| Scan storage | Samba share `\\printmanager.local\scans` |

## Layout

```
site.yaml            # Tack playbook: host + role order
roles/
  base/              # common packages, ufw baseline (allows SSH first)
  print-server/      # CUPS, brlaser, Avahi, shared DCP1511 queue
  scan-share/        # Samba [scans] share -> /srv/scans
  scan-server/       # SANE, brscan4, scanbd (button), saned (network)
```

Roles run in the order above; `scan-share` precedes `scan-server` because the
scanner writes into the share directory it creates.

## Running

```sh
tack site.yaml            # provision (safe to run before the printer is attached)
tack site.yaml --tags print   # just the print server, etc.
```

Provisioning is idempotent and **does not require the printer to be connected** —
services install and configure; device-bound steps become live once the
DCP-1511 is plugged in. After connecting the printer, **run `tack site.yaml`
once more** to finalize the CUPS queue and pick up the scanner.

### Secrets

The Samba password for the `scans` user is a secret. It is empty by default, so
the password task is skipped and you set it on the host:

```sh
sudo smbpasswd -a scans
```

To automate it, supply `scan_samba_password` via encrypted vars instead of
committing it.

## Client setup

**Print (Apple/iOS/macOS):** the DCP-1511 appears automatically in the print
dialog via AirPrint — no driver needed.

**Print (Linux/Windows):** add an IPP printer at
`ipp://printmanager.local:631/printers/DCP1511`, or browse `http://printmanager.local:631`.

**Scan share:**
- macOS: Finder → Go → Connect to Server → `smb://printmanager.local/scans`
- Windows: `\\printmanager.local\scans`
- Linux: `sudo mount -t cifs //printmanager.local/scans /mnt -o user=scans`

**Network (pull) scan:** on a client with SANE, add the Pi as a net host
(`/etc/sane.d/net.conf` → `printmanager.local`), then `scanimage -L` / your scan app.

**Button scan:** load a page, press **Scan** on the printer — a
`scan-YYYYMMDD-HHMMSS.pdf` appears in the share.

## brscan4 on ARM (Raspberry Pi) — important

Brother ships `brscan4` **only for amd64/i386**. On the Pi (arm64/armhf) the
installer **skips with a warning** (no ARM package exists), so scanning will not
work out of the box. Options for the manual fallback:

1. **Recommended:** run the scan stack in an **x86 emulation container**
   (e.g. an amd64 Debian container via `qemu-user-static`/`binfmt`) where the
   amd64 `brscan4` `.deb` installs and talks to the USB device.
2. Try a community ARM build of `brscan4` if one is available for your OS
   release, then set the matching URL in `roles/scan-server/defaults/main.yaml`
   under `brscan4_urls.arm64` / `.armhf`.
3. If only printing is needed, skip scanning (`tack site.yaml --tags print,share`).

Printing (`brlaser`) works natively on ARM and is unaffected.

Pinned driver: `brscan4 0.4.11-1` — URLs in
`roles/scan-server/defaults/main.yaml`. Update there if Brother changes the
download paths.

## Post-connect verification

After plugging in the DCP-1511 and re-running the play:

```sh
# Print
lpstat -p DCP1511                 # queue enabled
avahi-browse -rt _ipp._tcp        # advertised for AirPrint
# submit a test print from a LAN client

# Scan (requires working brscan4 — see ARM note)
scanimage -L                      # lists the DCP-1511 via brother4
# press the Scan button -> file appears in \\printmanager.local\scans
# client pull scan via saned returns an image
```

## Notes / known limitations

- The **scanbd button trigger** name/values in
  `roles/scan-server/templates/scanbd.conf.j2` are common defaults; confirm the
  exact action the DCP-1511 emits with `scanbd -d -f` (press Scan) and adjust if
  the button does not fire the script.
- **scanbd ↔ saned** device coordination and simultaneous button/network scans
  can only be fully validated with the scanner attached.

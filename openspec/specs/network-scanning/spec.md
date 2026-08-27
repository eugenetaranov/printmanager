# network-scanning Specification

## Purpose
TBD - created by archiving change provision-print-scan-server. Update Purpose after archive.
## Requirements
### Requirement: SANE scanner backend for the DCP-1511

The system SHALL provision a scan backend per entry in the configured `scanners:` list, where each entry selects a `backend`: `escl` (driverless, via `sane-airscan`) as the default, or `brscan4-emu` (Brother's proprietary `brscan4` driver under i386 qemu emulation) as an opt-in. The heavyweight `brscan4-emu` machinery — the i386 chroot, the localhost saned net-bridge, the PNM padder, and AirSane's chroot re-export — SHALL be provisioned only when at least one scanner selects `brscan4-emu`. An `escl` scanner SHALL be reachable by `scanimage` on the host with no chroot, qemu, or net-bridge. Scan mode and resolution SHALL come from each scanner's configuration rather than from a hardcoded set of driver-specific mode strings.

#### Scenario: Driverless (escl) scanner detected

- **WHEN** provisioning completes for a scanner entry with `backend: escl` and the device is reachable
- **THEN** `sane-airscan` is installed and the host SANE configuration enables the `airscan` backend
- **AND** `scanimage -L` lists the scanner and a test scan produces a valid image, with no i386 chroot or qemu present for that scanner

#### Scenario: Brother emulation backend preserved

- **WHEN** a scanner entry selects `backend: brscan4-emu` and provisioning completes
- **THEN** the i386 chroot, `brother4` backend, saned net-bridge, and PNM padding are provisioned exactly as before
- **AND** scans are equivalent to the pre-change Brother DCP-1511 behavior

#### Scenario: Emulation machinery gated on use

- **WHEN** no configured scanner selects `brscan4-emu`
- **THEN** the debootstrap chroot, qemu emulation, net-bridge, and `pad_pnm.py` are not installed

#### Scenario: Per-scanner mode and resolution

- **WHEN** a scanner entry declares its scan `mode` and `resolution`
- **THEN** the scan pipeline uses those values for that scanner
- **AND** the mode strings valid for the chosen backend are what the entry supplies (e.g. SANE `Color`/`Gray` for `escl`, brscan4's `"24bit Color"` for `brscan4-emu`)

#### Scenario: Scanner not yet connected

- **WHEN** provisioning runs while a configured scanner is not physically connected
- **THEN** the selected backend installs and configures successfully without error
- **AND** scanning works once the scanner is plugged in, with no re-provision required

### Requirement: Button-triggered scan-to-share

The system SHALL run a button-monitoring service (scanbd/scanbuttond) so that pressing the physical Scan button on the DCP-1511 performs a scan and writes the resulting file to the Samba scan share.

#### Scenario: Pressing Scan saves a file to the share

- **WHEN** a document is placed on the scanner and the physical Scan button is pressed
- **THEN** the Pi scans the document via brscan4
- **AND** a timestamped PDF (or configured image format) is written to the scan share destination directory

#### Scenario: Button service running

- **WHEN** the Pi has finished provisioning
- **THEN** the scanbd (or scanbuttond) service is enabled and active
- **AND** it holds the scanner device so button presses are captured

### Requirement: Network pull scanning via saned

The system SHALL run `saned` so that clients on the LAN can initiate scans over the network using the SANE net protocol.

#### Scenario: Client performs a network scan

- **WHEN** a client on the LAN connects to the Pi's SANE net service and starts a scan
- **THEN** the DCP-1511 scans and the image is returned to the requesting client

#### Scenario: saned reachable on the LAN

- **WHEN** saned is configured
- **THEN** the service listens on the SANE port (6566/tcp) and permits the local subnet
- **AND** the firewall allows SANE net traffic from the LAN

#### Scenario: Button service and saned coexist

- **WHEN** both button-triggered scanning and saned are enabled
- **THEN** the button service releases/coordinates the scanner device (e.g. via scanbd's saned integration) so a network scan and a button scan do not corrupt each other


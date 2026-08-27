## MODIFIED Requirements

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

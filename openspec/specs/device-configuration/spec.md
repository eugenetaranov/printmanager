# device-configuration Specification

## Purpose
TBD - created by archiving change printer-agnostic-multi-device. Update Purpose after archive.

## Requirements

### Requirement: Config-driven declaration of print/scan hardware

The system SHALL take the host's printers and scanners from declarative `printers:` and `scanners:` lists in host configuration, and the roles SHALL provision from those lists rather than from hardcoded device identities. A bare checkout with no host overrides SHALL provision the shipped example (the Brother DCP-1511 as one printer entry and its scanner as one `brscan4-emu` entry) so the reference box still works unchanged.

#### Scenario: Adding a printer by config only

- **WHEN** a user adds a `printers:` entry (name, driver, and — for a named driver — its PPD) and re-runs provisioning
- **THEN** a matching CUPS queue is created for that printer with no edits to any role's tasks or templates
- **AND** existing queues from other list entries are left intact

#### Scenario: Adding a scanner by config only

- **WHEN** a user adds a `scanners:` entry choosing a `backend` (`escl` or `brscan4-emu`)
- **THEN** the scan pipeline is provisioned for that scanner using the selected backend with no edits to any role's tasks or templates

#### Scenario: Bare checkout provisions the reference box

- **WHEN** provisioning runs with no host-specific `printers:`/`scanners:` overrides
- **THEN** the shipped example lists are used
- **AND** the resulting CUPS queue and scan backend are equivalent to the pre-change single-device Brother DCP-1511 setup

### Requirement: Multiple printers and scanners on one host

The system SHALL support declaring more than one printer and more than one scanner, provisioning a CUPS queue per printer entry and a scan source per scanner entry.

#### Scenario: Two printers, two queues

- **WHEN** `printers:` declares two entries with distinct names
- **THEN** provisioning creates two CUPS queues, one per entry, each with its own driver/PPD or driverless configuration

#### Scenario: Iteration survives single-pass rendering

- **WHEN** the roles provision N devices from the lists
- **THEN** every per-device value (queue name, PPD, match string, backend, mode) is fully rendered before use
- **AND** no templated per-device value reaches a command or module unexpanded

### Requirement: Clean provisioning when hardware is absent

For every driver and backend path, the system SHALL install and configure successfully when the corresponding device is not physically connected, leaving the device usable once connected without re-provisioning.

#### Scenario: Provision with nothing attached

- **WHEN** provisioning runs with no printers or scanners physically connected
- **THEN** all packages, queues, backends, and services install/configure without error
- **AND** each device becomes usable when later plugged in, with no re-run required

### Requirement: Single declaration of settings shared between roles

Every provisioning setting that more than one role reads SHALL be declared once, with one default. Overriding it once in host configuration SHALL apply to every role that uses it. Two settings that must agree SHALL NOT both be independently configurable: one SHALL default from the other.

#### Scenario: One override changes every consumer

- **WHEN** a host overrides the scan directory once and provisioning runs
- **THEN** the Samba share, the scan pipeline output, the cleanup job and the web UI all use the overridden directory

#### Scenario: Print queue follows the default printer

- **WHEN** the `printers:` list marks an entry other than the shipped example as `default: true` and the web UI print queue is not overridden
- **THEN** the web UI submits print jobs to that entry's queue

#### Scenario: Web UI scan defaults follow the scan backend

- **WHEN** the scan backend is changed and the web UI's default scan mode and resolution are not overridden
- **THEN** the web UI preselects the scan mode and resolution configured for that backend

#### Scenario: Explicit override still wins

- **WHEN** a host explicitly sets the web UI print queue, default scan mode or default resolution
- **THEN** the explicit value is used instead of the derived one

### Requirement: One scan backend selector

The active scan backend SHALL be chosen by a single setting whose value is either `brscan4-emu` or `escl`. A configuration that can express both backends at once, or neither, SHALL NOT be possible.

#### Scenario: Selecting the driverless backend

- **WHEN** the scan backend is set to `escl` and provisioning runs
- **THEN** the driverless backend is provisioned and the Brother emulation machinery is not

#### Scenario: Default is unchanged

- **WHEN** provisioning runs with no scan backend override
- **THEN** the `brscan4-emu` backend is provisioned exactly as before this change

### Requirement: Invalid shared settings fail before changes

Provisioning SHALL stop with a message naming the setting before it changes the host when a shared setting a role depends on is missing, or when the scan backend has an unknown value.

#### Scenario: Unknown backend value

- **WHEN** the scan backend is set to a value other than `brscan4-emu` or `escl`
- **THEN** provisioning fails before any package, file or service is changed
- **AND** the error names the setting and the allowed values

#### Scenario: Role run without its shared settings

- **WHEN** a role that depends on another role's settings is run on its own and those settings are not supplied
- **THEN** provisioning fails at the start of that role with a message naming each missing setting

### Requirement: Consolidation preserves the reference box

Moving settings to a single declaration SHALL NOT change what is provisioned when no host overrides are present.

#### Scenario: Bare checkout renders identically

- **WHEN** provisioning is previewed with diffs against a host provisioned before this change, with no host overrides
- **THEN** no package, user, group, firewall rule or service differs
- **AND** no rendered file differs except comments that name a renamed setting

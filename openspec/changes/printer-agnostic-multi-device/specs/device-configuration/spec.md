## ADDED Requirements

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

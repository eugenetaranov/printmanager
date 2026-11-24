# Spec Delta

## ADDED Requirements

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

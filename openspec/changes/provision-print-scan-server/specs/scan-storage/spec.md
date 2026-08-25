## ADDED Requirements

### Requirement: Samba share for scanned documents

The system SHALL run Samba on the Pi exposing a network share (e.g. `\\printmanager.local\scans`) that is the destination directory for button-triggered scans and is accessible from Windows, macOS, and Linux clients.

#### Scenario: Share is reachable cross-platform

- **WHEN** a client on the LAN connects to the `scans` SMB share with valid credentials
- **THEN** the client can browse and read the scanned files
- **AND** the share is mountable from macOS (`smb://`), Windows (`\\...`), and Linux (`cifs`)

#### Scenario: Scans land in the share

- **WHEN** a button-triggered scan completes
- **THEN** the resulting file appears in the share's backing directory and is visible to connected clients

### Requirement: Authenticated, LAN-scoped access

The system SHALL require authentication for share access and SHALL restrict access to the local subnet.

#### Scenario: Unauthenticated access rejected

- **WHEN** a client attempts to access the share without valid credentials
- **THEN** access is denied

#### Scenario: Off-subnet access blocked

- **WHEN** a host outside the configured local subnet attempts to reach the SMB service
- **THEN** the firewall and/or Samba host restrictions deny the connection

#### Scenario: Scan process can write

- **WHEN** the scan service writes a completed scan
- **THEN** the file is created with ownership/permissions that allow authorized share users to read it

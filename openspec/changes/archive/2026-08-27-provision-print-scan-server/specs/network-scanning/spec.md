## ADDED Requirements

### Requirement: SANE scanner backend for the DCP-1511

The system SHALL install SANE and the Brother `brscan4` backend on the Pi and configure it so the USB-attached DCP-1511 is recognized as a scannable device.

#### Scenario: Scanner detected by SANE

- **WHEN** provisioning completes and the DCP-1511 is connected via USB
- **THEN** `scanimage -L` lists the DCP-1511 via the `brother4` backend
- **AND** a test scan with `scanimage` produces a valid image file

#### Scenario: Scanner not yet connected

- **WHEN** provisioning runs while the DCP-1511 is not physically connected
- **THEN** SANE and the brscan4 backend install successfully without error
- **AND** the device configuration (brsaneconfig4 entry) is registered so scanning works once the printer is plugged in

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

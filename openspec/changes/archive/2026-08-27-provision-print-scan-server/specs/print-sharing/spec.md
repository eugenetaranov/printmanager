## ADDED Requirements

### Requirement: Shared CUPS print queue for the USB printer

The system SHALL run CUPS on the Raspberry Pi with a print queue bound to the USB-attached Brother DCP-1511 using the open-source `brlaser` driver, and SHALL share that queue to all clients on the local network over IPP.

#### Scenario: Queue created with brlaser driver

- **WHEN** provisioning completes and the DCP-1511 is connected via USB
- **THEN** a CUPS queue named `DCP1511` exists using a `brlaser`-based PPD
- **AND** `lpstat -p DCP1511` reports the queue as enabled and accepting jobs

#### Scenario: Printer shared to the LAN

- **WHEN** CUPS is configured
- **THEN** the queue is marked shared (`Shared Yes`) and CUPS listens on the LAN interface (port 631)
- **AND** the firewall permits IPP (631/tcp) from the local subnet

#### Scenario: A LAN client prints a document

- **WHEN** a client on the LAN submits a print job to the shared queue over IPP
- **THEN** the page prints on the DCP-1511
- **AND** the completed job appears in the CUPS job history on the Pi

#### Scenario: Printer not yet connected

- **WHEN** provisioning runs while the DCP-1511 is not physically connected
- **THEN** CUPS and the driver install successfully without error
- **AND** the queue configuration is applied so that the printer becomes usable once plugged in (no re-provision required)

### Requirement: Zero-config discovery via Avahi/AirPrint

The system SHALL advertise the shared print queue over mDNS using Avahi so that AirPrint-capable Apple and mobile devices discover and print to it without installing drivers.

#### Scenario: Queue advertised over mDNS

- **WHEN** Avahi and CUPS are running
- **THEN** the DCP1511 queue is advertised as an AirPrint/IPP service on the LAN
- **AND** the service is visible via an mDNS browse (e.g. `avahi-browse -rt _ipp._tcp`)

#### Scenario: Apple device prints via AirPrint

- **WHEN** an iOS or macOS device on the same LAN opens a print dialog
- **THEN** the DCP-1511 appears automatically as an available printer
- **AND** selecting it and printing produces output with no driver installation

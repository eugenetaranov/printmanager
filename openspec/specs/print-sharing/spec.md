# print-sharing Specification

## Purpose
TBD - created by archiving change provision-print-scan-server. Update Purpose after archive.
## Requirements
### Requirement: Shared CUPS print queue for the USB printer

The system SHALL run CUPS on the Raspberry Pi and, for each entry in the configured `printers:` list, create a print queue bound to the attached USB printer and share that queue to all clients on the local network over IPP. Printer detection SHALL be brand-agnostic: a queue entry MAY specify a URI match substring, and when omitted the system SHALL bind the first available `usb://` device. Each entry SHALL declare its driver as either `driverless` (IPP Everywhere / driverless, no PPD or vendor package) or a named driver with its PPD (e.g. `brlaser` with `drv:///brlaser.drv/br1510.ppd`), and only the driver packages actually referenced SHALL be installed.

#### Scenario: Queue created for a named-driver printer

- **WHEN** provisioning completes and a printer entry declares a named driver and PPD, and the device is connected via USB
- **THEN** a CUPS queue with the entry's name exists using that driver's PPD
- **AND** `lpstat -p <name>` reports the queue as enabled and accepting jobs

#### Scenario: Queue created for a driverless printer

- **WHEN** a printer entry declares `driver: driverless` and the device is connected
- **THEN** a CUPS queue is created without any vendor PPD or driver package
- **AND** the queue prints using driverless/IPP Everywhere

#### Scenario: Brand-agnostic USB detection

- **WHEN** a printer entry omits a match substring
- **THEN** the queue binds to the first detected `usb://` device
- **AND** when a match substring is given, only a device whose URI contains it is bound

#### Scenario: Printer shared to the LAN

- **WHEN** CUPS is configured
- **THEN** each queue is marked shared and CUPS listens on the LAN interface (port 631)
- **AND** the firewall permits IPP (631/tcp) from the local subnet

#### Scenario: Multiple printers each get a queue

- **WHEN** `printers:` declares more than one entry
- **THEN** provisioning creates one shared CUPS queue per entry

#### Scenario: Printer not yet connected

- **WHEN** provisioning runs while a configured printer is not physically connected
- **THEN** CUPS and any referenced driver install successfully without error
- **AND** the queue configuration is applied so the printer becomes usable once plugged in (no re-provision required)

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


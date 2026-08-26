## ADDED Requirements

### Requirement: Discover Niimbot printers over Bluetooth LE

The system SHALL scan for nearby Bluetooth LE devices and present those recognized as Niimbot printers (by advertised name token such as `D110`/`B1`/`niimbot`, or by the Niimbot GATT service UUID) as connection candidates, sorted strongest-signal first, excluding any already connected.

#### Scenario: A nearby printer is discovered

- **WHEN** the user starts a scan with a powered-on D110 or B1 in range
- **THEN** that printer appears as a candidate with its name and signal strength
- **AND** an unrelated BLE device (e.g. a speaker) does not appear

#### Scenario: No adapter present

- **WHEN** the host has no usable Bluetooth adapter
- **THEN** the page reports that Bluetooth is unavailable instead of erroring
- **AND** the rest of the Devices page still functions

### Requirement: Connect to a discovered printer

The system SHALL connect to a chosen candidate over BLE, detect its model from the advertised name (D110 → 96 px head, B1 → 384 px head; unknown → safe default), confirm it is a real printer with a status handshake, and keep the link open for subsequent prints.

#### Scenario: Connect succeeds and model is detected

- **WHEN** the user clicks Connect on a D110 candidate
- **THEN** a BLE link is established and held open
- **AND** the printer is recorded with model `d110` and its default label size

#### Scenario: Connect target is unreachable

- **WHEN** the user connects to a candidate that has since powered off
- **THEN** the attempt fails within a bounded time
- **AND** the failure is surfaced to the user without crashing the server

### Requirement: Remember printers and reconnect in one click

The system SHALL persist each connected Niimbot (BLE address, friendly name, model, label size) so it survives a service restart, and SHALL offer a one-click Reconnect that re-establishes the link to a remembered printer by address without a fresh scan. Auto-reconnect on boot is out of scope.

#### Scenario: Remembered printer persists across restart

- **WHEN** a printer has been connected and the scan-web service restarts
- **THEN** the printer still appears as a remembered device (disconnected)
- **AND** a Reconnect action is offered for it

#### Scenario: One-click reconnect

- **WHEN** the user clicks Reconnect on a remembered, in-range printer
- **THEN** the link is re-established by its saved address without scanning
- **AND** its status becomes connected

#### Scenario: Link drop is reflected

- **WHEN** a connected printer powers off or goes out of range
- **THEN** its status returns to disconnected
- **AND** it remains in the remembered set for later reconnect

### Requirement: Select the active label printer

When more than one Niimbot is known, the system SHALL let the user choose which one is the **active** printer that label prints target, persist that choice, and switch immediately when changed.

#### Scenario: Switching the active printer

- **WHEN** two Niimbots are connected and the user selects the B1 as active
- **THEN** the active selection is persisted
- **AND** a subsequent label print targets the B1

#### Scenario: Active selection defaults sensibly

- **WHEN** exactly one Niimbot is connected and none is explicitly selected
- **THEN** that printer is treated as the active printer

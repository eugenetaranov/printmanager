## ADDED Requirements

### Requirement: Unified device inventory page

The web UI SHALL present a **Devices** page that lists all print/scan hardware known to the Pi across every transport — CUPS print queues, SANE scanners, raw USB devices, and Bluetooth Niimbot printers — normalized into a single list where each entry shows a name, its kind (printer/scanner/label-printer), its transport (USB/Bluetooth/network), and a connected/disconnected status.

#### Scenario: Page lists devices from every source

- **WHEN** the user opens the Devices page
- **THEN** the CUPS queue `DCP1511`, any SANE scanner, any relevant `lsusb` device, and any remembered/connected Niimbot printer each appear as a row
- **AND** each row shows its name, kind, transport, and a connected or disconnected status

#### Scenario: Devices tab can be disabled

- **WHEN** `scan_web_devices_enabled` is false
- **THEN** the Devices tab is not rendered and its routes are not served

### Requirement: Live connected/disconnected status per device

The Devices page SHALL report each device's status by querying its subsystem: a CUPS queue is connected when enabled and idle/accepting and disconnected when disabled or paused; a SANE scanner is connected when it appears in the scanner list; a Niimbot printer is connected when a live BLE link exists and disconnected otherwise.

#### Scenario: CUPS queue reflects enabled state

- **WHEN** the `DCP1511` queue is enabled and accepting jobs
- **THEN** its row shows connected
- **WHEN** the queue is disabled or the printer is unplugged so CUPS marks it stopped
- **THEN** its row shows disconnected

#### Scenario: Remembered Niimbot shows disconnected when its link is down

- **WHEN** a Niimbot printer has been remembered but is powered off or out of range
- **THEN** its row appears with a disconnected status (not omitted from the list)

### Requirement: Refresh the inventory on demand

Because probing SANE and scanning BLE are slow, the page SHALL populate on load and re-enumerate on an explicit Refresh action rather than continuous polling.

#### Scenario: Refresh re-queries subsystems

- **WHEN** the user triggers Refresh
- **THEN** the page re-queries CUPS, SANE, USB, and Niimbot state and updates each row's status

### Requirement: Sources degrade independently

Failure to enumerate one subsystem SHALL NOT blank the whole page; the failing source SHALL show an error indication while the other sources still render their devices.

#### Scenario: One probe fails

- **WHEN** enumerating scanners fails (e.g. the scan backend is unavailable)
- **THEN** the scanner section shows an error row
- **AND** CUPS printers, USB devices, and Niimbot printers still list normally

### Requirement: Remove/forget a device

The Devices page SHALL let the user remove a forgettable device: forgetting a CUPS queue deletes that queue (`lpadmin -x`), and forgetting a Niimbot disconnects it and drops it from the remembered set. Devices that cannot be meaningfully removed (a raw USB enumeration entry) SHALL NOT offer a forget action.

#### Scenario: Forget a CUPS queue

- **WHEN** the user forgets a CUPS printer row and confirms
- **THEN** the queue is deleted via `lpadmin -x <queue>`
- **AND** the row disappears on the next refresh

#### Scenario: Forget a Niimbot printer

- **WHEN** the user forgets a remembered Niimbot
- **THEN** its live BLE link (if any) is closed and it is removed from the remembered set
- **AND** it no longer appears until discovered again

#### Scenario: Non-forgettable device offers no forget action

- **WHEN** a row represents a raw USB device with no associated queue or remembered entry
- **THEN** no forget action is shown for that row

## ADDED Requirements

### Requirement: Unified device inventory (Devices modal)

The web UI SHALL present device management in a **Devices modal**, opened from a gear button in the header, kept separate from the Scan/Print service tabs (which hold the actual scan/print settings and actions). The modal SHALL list all print/scan hardware known to the Pi across every transport — CUPS print queues, SANE scanners, raw USB devices, and Bluetooth Niimbot printers — normalized into a single list where each entry shows a name, its kind (printer/scanner/label-printer), its transport (USB/Bluetooth/network), and a connected/disconnected status.

#### Scenario: Modal lists devices from every source

- **WHEN** the user opens the Devices modal from the header gear
- **THEN** the CUPS queue `DCP1511`, any SANE scanner, any relevant `lsusb` device, and any remembered/connected Niimbot printer each appear as a row
- **AND** each row shows its name, kind, transport, and a connected or disconnected status

#### Scenario: Device management can be disabled

- **WHEN** `scan_web_devices_enabled` is false
- **THEN** the header gear is not rendered and the device routes are not served

### Requirement: Live connected/disconnected status per device

The Devices modal SHALL report each device's status by querying its subsystem: a CUPS queue is connected when enabled and idle/accepting and disconnected when disabled or paused; a SANE scanner is connected when it appears in the scanner list; a Niimbot printer is connected when a live BLE link exists and disconnected otherwise.

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

### Requirement: Grouped presentation with interface and consistent rows

The Devices modal SHALL group devices by role under headings (Printers, Scanners, Label printers), render every device as a fixed-height row, and show each device's connection interface as an icon (USB / Bluetooth / Network). The same physical scanner exposed through more than one SANE backend (e.g. the direct brscan backend and the AirSane eSCL bridge) SHALL be shown once, preferring the direct USB backend.

#### Scenario: One row per physical scanner

- **WHEN** the Brother scanner is enumerated by both the brscan backend and the eSCL bridge
- **THEN** exactly one scanner row is shown, labelled with a USB interface icon

#### Scenario: Rows are uniform

- **WHEN** device details differ in length (e.g. a long USB URI vs a short one)
- **THEN** rows keep a consistent height and long detail text is truncated

### Requirement: Print a test page per printer

Each connected printer SHALL offer a test-page action that prints a device-appropriate test: an A4 sheet to a CUPS queue (title, queue name, timestamp, paper size, border/ticks), or a small test label sized to the roll for a Niimbot.

#### Scenario: A4 test page

- **WHEN** the user triggers the test action on the CUPS printer
- **THEN** an A4 test page is generated and sent to that queue

#### Scenario: Niimbot test label

- **WHEN** the user triggers the test action on a connected Niimbot
- **THEN** a test label sized to that printer's roll is printed

### Requirement: Per-device connection log

Each Niimbot SHALL expose its connection log via a per-device control that is muted when the device has no log lines and highlighted when it does. Opening it SHALL show that device's log within the modal with actions to copy (working over plain HTTP) and clear it.

#### Scenario: Log indicator reflects activity

- **WHEN** a Niimbot has recorded connection log lines
- **THEN** its log control is highlighted; a device with no lines shows it muted

#### Scenario: Copy and clear

- **WHEN** the user opens a device's log and chooses copy
- **THEN** the log text is placed on the clipboard even though the UI is served over HTTP
- **WHEN** the user chooses clear
- **THEN** that device's log lines are removed

### Requirement: Remove/forget only remembered Bluetooth devices

Only remembered Bluetooth (Niimbot) printers SHALL offer a forget action (which disconnects the link and drops it from the remembered set). Auto-detected USB/network hardware (CUPS queues, SANE scanners, raw USB) SHALL NOT offer forget, since forgetting an attached device is meaningless.

#### Scenario: Forget a Niimbot printer

- **WHEN** the user forgets a remembered Niimbot and confirms
- **THEN** its live BLE link (if any) is closed and it is removed from the remembered set
- **AND** it no longer appears until discovered again

#### Scenario: Auto-detected hardware offers no forget

- **WHEN** a row represents a CUPS printer, a SANE scanner, or a raw USB device
- **THEN** no forget action is shown for that row

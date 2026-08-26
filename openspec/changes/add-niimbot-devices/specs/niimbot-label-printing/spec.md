## ADDED Requirements

### Requirement: Label composing lives in the Print tab

Niimbot label composition SHALL live in the **Print tab** (not a separate device screen), reached by selecting a Niimbot in the Print-tab printer selector. The content-type choices SHALL be consistent with the A4 path — **Text / Image / QR** — while device-specific settings differ (a Niimbot exposes label width/length in mm; it does not offer A4 sheet layouts).

#### Scenario: Selecting a Niimbot reveals the label composer

- **WHEN** a connected Niimbot is chosen in the Print-tab printer selector
- **THEN** the Print tab shows the label composer (label size + Text/Image/QR) and hides the A4 sheet composer

### Requirement: Compose a label from text, QR, or an image

The system SHALL render a label from one of three content kinds — free **text**, a **QR code** generated from a text/URL payload, or an **uploaded image** — into a 1-bit-per-pixel monochrome bitmap sized to the active printer's printhead width (multiple of 8, ≤ that model's head) and its configured roll length, with content laid out along the label's long axis (rotated 90° for narrow portrait tape such as the D110) so it is as large and readable as the stock allows.

#### Scenario: Text label

- **WHEN** the user enters text and prints to a connected D110
- **THEN** a monochrome bitmap sized to the D110 head is produced with the text scaled to fill the label's long axis

#### Scenario: QR label

- **WHEN** the user enters a URL and chooses QR
- **THEN** a QR code encoding that URL is rendered and centered within the label bounds

#### Scenario: Image label

- **WHEN** the user uploads an image
- **THEN** it is converted to grayscale, contain-fit to the label, and dithered to 1-bit before printing

### Requirement: Print the composed label to the active Niimbot

The system SHALL transmit the composed bitmap to the active printer using the Niimbot print sequence (set density and label type, start print/page, stream bitmap rows, end page) and SHALL wait for the printer to report physical completion before ending the job, so the print is not truncated.

#### Scenario: Label prints end to end

- **WHEN** the user prints a composed label to a connected B1
- **THEN** the label is physically printed
- **AND** the job ends only after the printer reports the page completed

#### Scenario: No active printer

- **WHEN** the user attempts to print with no Niimbot connected/selected
- **THEN** the print is rejected with a clear message and nothing is sent

#### Scenario: Printer error during print

- **WHEN** the printer reports an error (e.g. cover open or out of paper) mid-print
- **THEN** the job stops and the error is surfaced to the user

### Requirement: Per-printer label size

Each Niimbot SHALL carry its own configurable label stock size (width × length in mm), defaulting to a sensible per-model value (narrow tape for the D110, larger stock for the B1), used to size composed labels and persisted with the remembered printer.

#### Scenario: Label size drives rendering

- **WHEN** the active printer's label size is set to 12 × 40 mm
- **THEN** composed labels are rasterized to that size at the printer's dot density

#### Scenario: Size persists with the printer

- **WHEN** the user changes a printer's label size and later reconnects it
- **THEN** the previously set size is restored

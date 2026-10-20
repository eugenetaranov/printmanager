## ADDED Requirements

### Requirement: Labels tab is the label home

The web UI SHALL have three tabs, named for the task, in this order: Labels, Scan and Print. The Labels tab SHALL hold the quick add, the label composer and the print queue; there SHALL be no separate Queue tab. `/` and unknown paths SHALL open the Labels tab, and `/queue` SHALL redirect to `/labels`.

#### Scenario: Open the app

- **WHEN** the user opens the web UI at `/`
- **THEN** the Labels tab is shown

#### Scenario: Old Queue link

- **WHEN** the user opens `/queue`
- **THEN** the address becomes `/labels` and the Labels tab is shown

### Requirement: Label printer row with quick reconnect

When at least one label printer is remembered, the Labels tab SHALL show, above the paste box, the label printer that quick add targets (the active one), its live connection state and a Reconnect control. The connection state SHALL come from the queue state poll. With several label printers the row SHALL let the user pick one, and picking SHALL make it the active printer.

#### Scenario: Printer disconnected

- **WHEN** the active label printer is not connected
- **THEN** the row shows "Disconnected" and a Reconnect button
- **AND** tapping it reconnects over Bluetooth and the row shows "Connected" on success, or the error on failure

#### Scenario: Printer connected

- **WHEN** the active label printer is connected
- **THEN** a smaller Reconnect control stays available for a stale link

#### Scenario: Switch printer

- **WHEN** the user picks another label printer in the row
- **THEN** it becomes the active printer, and new quick-add items target it

### Requirement: Print now from quick add

When the active label printer is connected and no release is running, quick add SHALL offer Print now as the primary action and Add to queue as secondary. Otherwise Add to queue SHALL be the only action. Print now SHALL add the pasted items with the same splitting rules as Add, and SHALL then print only those items. Other waiting items SHALL stay in the queue.

#### Scenario: Print now with other items waiting

- **WHEN** two items are already waiting and the user pastes one number and taps Print now
- **THEN** only the new number is printed
- **AND** the two earlier items stay waiting

#### Scenario: Printer off

- **WHEN** the active label printer is disconnected
- **THEN** quick add shows only Add to queue

### Requirement: Customize a label

The Labels tab SHALL offer a Customize switch in the input's header row. Switching SHALL replace the paste box with the label composer: format picker (label printers and A4 sheet templates), Text/Image/QR, live preview, A4 sheet grid and Manage A4 label sizes. The paste box and the composer SHALL never be shown together. While the composer is open, a pasted image SHALL go to the composer, not to the queue.

#### Scenario: Design a label

- **WHEN** the user opens Customize and types two lines of text
- **THEN** the preview shows one two-line label, which can be printed now or added to the queue as one item

#### Scenario: Back to quick add

- **WHEN** the user taps Quick add
- **THEN** the composer closes and the paste box returns

### Requirement: Input stays in place across Customize

For a label printer format, the composer's text box SHALL take the paste box's place, so the input does not move when switching between quick add and Customize.

#### Scenario: Switch to Customize

- **WHEN** the user switches to Customize with a label printer format
- **THEN** the composer's text box appears where the paste box was

### Requirement: Release selected items

`POST /queue/release` SHALL accept an optional list of item ids. With ids, the run SHALL print only waiting or failed items whose id is in the list. Without ids, it SHALL print every waiting or failed item. `POST /queue/add` SHALL return the ids of the items it added.

#### Scenario: Release by id

- **WHEN** a release is requested with the ids of one of three waiting items
- **THEN** that item is printed and removed, and the other two stay waiting

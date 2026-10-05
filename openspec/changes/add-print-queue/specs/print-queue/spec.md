## ADDED Requirements

### Requirement: Stage items in a persistent queue

The web UI SHALL provide a Queue tab at `/queue` where the user can add items by pasting text into a field, choosing a file, or dropping a file. Pasted text SHALL become one item per non-empty line. Items SHALL be stored on the server so any device sees the same queue, SHALL expire after 7 days, and the queue SHALL hold at most 20 items.

#### Scenario: Paste several numbers

- **WHEN** the user pastes three shipment numbers on separate lines and taps Add
- **THEN** three text items appear in the queue, each targeting the last-used label format

#### Scenario: Add a file

- **WHEN** the user chooses a PDF or image
- **THEN** it is converted and validated immediately and appears as one item targeting the default A4 queue
- **AND** an unreadable or oversized file is rejected with a clear message

#### Scenario: Queue visible from every tab

- **WHEN** items are waiting
- **THEN** the Queue tab and the header queue button show the count, on every tab

#### Scenario: Cap and expiry

- **WHEN** the queue already holds 20 items
- **THEN** adding is refused with a message
- **AND** items older than 7 days are removed automatically

### Requirement: Adjust and remove items

Each item SHALL show its content, target and copies; the user SHALL be able to change the target (any remembered label printer or A4 queue), the copies, and for label text a barcode option, and to remove the item using the two-click arm/confirm pattern.

#### Scenario: Remove an item

- **WHEN** the user clicks remove twice on an item
- **THEN** the item and its stored file are deleted

### Requirement: Release the queue with one action

The Queue tab SHALL offer one primary Print all action that prints all waiting and failed items in queue order, one at a time, via a single server-side worker. Label items SHALL connect the printer through the existing reconnect path. A4 items SHALL wait until the USB printer is present and SHALL be tracked until CUPS reports the job completed. Printed items SHALL be deleted. Nothing SHALL print without the user pressing Print all.

#### Scenario: Print with the printer off

- **WHEN** the user presses Print all while the A4 printer is off and then switches it on
- **THEN** the items show as waiting for the printer, then print in order once it is detected

#### Scenario: Failure pauses the batch

- **WHEN** an item fails (printer not reachable, job not completing)
- **THEN** that item is marked failed with the reason, later items stay waiting, and the batch stops
- **AND** pressing Resume retries from the failed item without reprinting completed items

#### Scenario: Page closed while waiting

- **WHEN** no client has polled the queue for 30 seconds while the worker waits for a printer
- **THEN** the worker stops and the items return to waiting

#### Scenario: Concurrent release

- **WHEN** Print all is pressed on two devices
- **THEN** only one worker runs and no item prints twice

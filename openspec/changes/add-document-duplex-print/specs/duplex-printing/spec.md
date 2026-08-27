## ADDED Requirements

### Requirement: Double-sided printing adapts to the queue's capability

When the user requests double-sided, the system SHALL determine whether the target queue supports automatic duplex and choose the appropriate path: a single duplex job for auto-duplex queues, or the guided manual flow for simplex printers. When capability cannot be determined, the system SHALL default to the guided manual flow (which any printer can complete).

#### Scenario: Auto-duplex queue prints in one job

- **WHEN** the target queue reports automatic duplex support and the user requests double-sided
- **THEN** the document is printed as a single two-sided job (long-edge binding)
- **AND** no manual flip step is shown

#### Scenario: Simplex printer uses the guided flow

- **WHEN** the target queue has no automatic duplex and the user requests double-sided
- **THEN** the system runs the guided two-phase manual-duplex flow

#### Scenario: Unknown capability defaults to guided

- **WHEN** the queue's duplex capability cannot be determined
- **THEN** the system uses the guided manual flow rather than assuming auto-duplex

### Requirement: Guided manual duplex prints correctly ordered pages

For the manual flow, the system SHALL pad the document to an even page count, split it into odd and even halves, print the first half, prompt the user with a printer-specific flip-and-reload instruction, and on confirmation print the second half so that the final collated stack is in correct page order and orientation. The even-page order and flip edge SHALL come from a per-printer constant calibrated for the actual printer, overridable per queue.

#### Scenario: Odd page count is padded

- **WHEN** a document with an odd number of pages is printed double-sided via the manual flow
- **THEN** a single blank page is appended so the halves align
- **AND** the blank lands as the back of the last sheet, not mid-document

#### Scenario: First half prints, then the flow pauses for the flip

- **WHEN** the manual flow starts
- **THEN** the first half of the pages is submitted to the queue
- **AND** the UI shows a clear flip-and-reload instruction specific to the printer, with a Continue action

#### Scenario: Second half prints in the correct order after Continue

- **WHEN** the user reloads the flipped stack and confirms Continue
- **THEN** the second half is submitted in the order that yields a correctly collated, correctly oriented double-sided document
- **AND** the temporary job data is cleaned up

#### Scenario: Abandoned job is reaped

- **WHEN** the user never confirms Continue (browser closed, refresh, or timeout)
- **THEN** the pending job's temporary data is removed after a bounded time
- **AND** no second-half pages are printed

#### Scenario: Flip instruction matches the actual behavior

- **WHEN** the flip instruction is shown
- **THEN** its wording (which edge to flip, which way to reload) is derived from the same per-printer constant that orders the pages, so the instruction and the printed result cannot disagree

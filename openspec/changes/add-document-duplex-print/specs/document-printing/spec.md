## ADDED Requirements

### Requirement: Upload and print a PDF document

The web UI SHALL provide a document path, separate from the label-sheet Print tab, that lets the user upload a PDF, choose a target A4 CUPS queue, and print it. The system SHALL validate the upload (a readable PDF within configured page-count and size limits) and default to single-sided. The label-sheet composer SHALL be unaffected.

#### Scenario: Print a PDF single-sided

- **WHEN** the user uploads a valid PDF, selects a queue, and prints without double-sided
- **THEN** the document is submitted to the selected queue at A4
- **AND** the confirmation reports the queue the job was sent to

#### Scenario: Target queue chosen from available queues

- **WHEN** more than one CUPS queue exists
- **THEN** the document path lets the user pick which queue to print to, shown with a friendly brand+model name
- **AND** the configured default queue is pre-selected

#### Scenario: Invalid or oversized upload rejected

- **WHEN** the upload is not a readable PDF, or exceeds the configured page-count or size limit
- **THEN** the request is rejected with a clear message and nothing is sent to the printer

#### Scenario: Document path can be disabled

- **WHEN** the document path is disabled by configuration
- **THEN** the Document surface is hidden and its routes reject requests, leaving label printing and scanning available

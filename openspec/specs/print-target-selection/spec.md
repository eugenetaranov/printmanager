# print-target-selection Specification

## Purpose
TBD - created by archiving change printer-agnostic-multi-device. Update Purpose after archive.
## Requirements
### Requirement: Choose the target printer on the Print tab

The Print tab SHALL let the user choose which CUPS queue a composed label sheet is sent to, from the queues available on the host, and SHALL submit the job to the chosen queue. The queue configured as the default SHALL be pre-selected.

#### Scenario: Selector lists available queues with friendly names

- **WHEN** the user opens the Print tab and more than one CUPS queue exists
- **THEN** a printer selector lists the available queues, each shown with a friendly brand+model name derived from its device URI (falling back to the queue name)
- **AND** the queue marked default in configuration is pre-selected

#### Scenario: Job goes to the chosen queue

- **WHEN** the user selects a queue and prints a composed sheet
- **THEN** the job is submitted to the selected queue
- **AND** the confirmation reports the queue the job was sent to

#### Scenario: Selection persists in the browser

- **WHEN** the user has chosen a non-default queue and returns to the Print tab later
- **THEN** the previously chosen queue is restored as the selection, in the same way the print nudge offsets are remembered

#### Scenario: Single queue needs no choice

- **WHEN** exactly one CUPS queue exists
- **THEN** that queue is used as the target without requiring the user to pick


# on-demand-printer-connect Specification

## Purpose
TBD - created by archiving change size-driven-label-format. Update Purpose after archive.
## Requirements
### Requirement: Connect an offline printer on demand without blocking

When the user selects a format whose printer needs a live connection (a thermal Niimbot) and it is not connected, the system SHALL open a connect modal that drives the connection and shows live status, reusing the existing device connect flow. The modal SHALL be non-blocking: the user MAY dismiss it and keep composing, and pressing Print SHALL re-trigger the connection if the printer is still offline. CUPS printers, which are always ready, SHALL NOT trigger the modal.

#### Scenario: Selecting an offline thermal format opens the connect modal

- **WHEN** the user selects a thermal format whose Niimbot is disconnected
- **THEN** a connect modal opens and begins connecting to that printer's known address
- **AND** it shows live status (connecting → connected, or failed)

#### Scenario: Connected dismisses and enables printing

- **WHEN** the printer connects successfully
- **THEN** the modal reports success and closes
- **AND** the Print action is enabled for that format

#### Scenario: Dismiss keeps composing; Print re-triggers connect

- **WHEN** the user dismisses the connect modal while the printer is still offline
- **THEN** the composer remains usable
- **AND** pressing Print re-opens the connect modal rather than failing

#### Scenario: Connection failure offers retry

- **WHEN** the connection attempt fails or times out
- **THEN** the modal offers to retry, and a way to scan for the printer if its address has changed

#### Scenario: CUPS format needs no connect step

- **WHEN** the user selects an A4 (CUPS) format
- **THEN** no connect modal appears and printing is available immediately


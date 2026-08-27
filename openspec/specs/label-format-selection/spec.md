# label-format-selection Specification

## Purpose
TBD - created by archiving change size-driven-label-format. Update Purpose after archive.
## Requirements
### Requirement: Size-sorted label format selector

The Print tab SHALL present a single "Label format" selector listing the label formats the host has hardware for, sorted by size (longest edge, largest first), replacing the separate printer and label-sheet selectors. Each entry SHALL show its physical label size and type. Selecting an entry SHALL set both the composer and the target device for the print.

#### Scenario: A4 and thermal formats in one sorted list

- **WHEN** the host has a CUPS A4 printer and one or more remembered Niimbots
- **THEN** the selector lists the A4 label-sheet formats and one thermal format per remembered Niimbot, as a single list sorted by longest edge descending
- **AND** each entry is labelled size-first (e.g. "A4 · 99×68mm (2×4)", "D110 · 40×12mm")

#### Scenario: Only formats with hardware appear

- **WHEN** no Niimbot has ever been remembered
- **THEN** no thermal formats are listed
- **AND** the A4 formats are still listed because the CUPS printer is present

#### Scenario: Selecting a format switches the composer and target

- **WHEN** the user selects an A4 format
- **THEN** the A4 grid composer is shown with that format's template active
- **AND** the print target is that format's CUPS queue

- **WHEN** the user selects a thermal format
- **THEN** the single-label composer is shown sized to that format
- **AND** the print target is that format's Niimbot

#### Scenario: Last format is remembered

- **WHEN** the user returns to the Print tab after choosing a format
- **THEN** that format is preselected (persisted in the browser)

#### Scenario: No printers at all

- **WHEN** the host has no CUPS printer and no remembered Niimbot
- **THEN** the selector shows a "connect a printer" hint instead of an empty list


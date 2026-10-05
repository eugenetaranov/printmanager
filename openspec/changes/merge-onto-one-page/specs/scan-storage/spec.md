## ADDED Requirements

### Requirement: Merge scans onto one page

The Merge dialog SHALL offer to place the selected scans onto a single A4 page. When chosen, the system SHALL detect the scanned object on each page of the selected scans, crop it, and place the crops one under another in merge order, at real size when they fit and uniformly scaled down otherwise.

#### Scenario: Three receipts onto one page

- **WHEN** the user merges three single-receipt scans with "Put them on one page" on
- **THEN** the result is a one-page A4 PDF with the three receipts stacked top to bottom in the selected order, cropped to the receipts

#### Scenario: Too tall to fit at real size

- **WHEN** the detected objects are taller in total than an A4 page
- **THEN** all are scaled down by the same factor so they fit on the page

#### Scenario: Blank page

- **WHEN** no object is found on one of the pages
- **THEN** the merge fails with a message naming that scan and the originals are kept

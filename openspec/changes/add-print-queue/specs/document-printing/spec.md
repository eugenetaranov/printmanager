## ADDED Requirements

### Requirement: Refuse direct print to an absent USB printer

A direct print (document or A4 label sheet) to a USB CUPS queue whose printer is not present SHALL be refused with a clear message instead of being handed to CUPS, and the Print tab SHALL offer to add the document to the queue instead.

#### Scenario: Printer off

- **WHEN** the user prints a document while the USB printer is powered off
- **THEN** the request fails with "The printer is off" and nothing is sent to CUPS
- **AND** the Print tab offers Add to queue

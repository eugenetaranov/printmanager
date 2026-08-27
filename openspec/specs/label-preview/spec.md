# label-preview Specification

## Purpose
TBD - created by archiving change size-driven-label-format. Update Purpose after archive.
## Requirements
### Requirement: WYSIWYG preview of the composed label

The system SHALL render a preview of the composed thermal label — for text, image, or QR content — that matches what will actually print, using the same rendering code path as printing, sized to the selected format. The preview MAY be prepared in the background while a connect modal is open, so it is ready once the printer connects.

#### Scenario: Text preview matches print

- **WHEN** the user enters text for a selected thermal format
- **THEN** a preview image of the label is shown, rendered by the same code that prints it (same rotation, scaling, and 1-bit rendering), sized to the format

#### Scenario: Image and QR previews

- **WHEN** the content is an uploaded image or a QR payload
- **THEN** the preview shows the dithered image, or the generated QR, laid out as it will print

#### Scenario: Preview renders during connect

- **WHEN** a connect modal is open for the selected thermal format
- **THEN** the preview is rendered in the background from the current content
- **AND** it is visible in the composer once the modal closes

#### Scenario: Preview updates as content changes

- **WHEN** the user edits the text, image, or QR content
- **THEN** the preview updates to reflect the change (debounced to avoid excessive renders)


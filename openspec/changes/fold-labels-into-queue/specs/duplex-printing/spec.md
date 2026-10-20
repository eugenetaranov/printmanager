## ADDED Requirements

### Requirement: Double-sided option is always visible

The Print tab SHALL always show the Double-sided option. Until a document with two or more pages is loaded, it SHALL be disabled and SHALL say why. A one-page document SHALL always print one-sided, even if the option was switched on for an earlier document.

#### Scenario: No document yet

- **WHEN** the user opens the Print tab without a document
- **THEN** Double-sided is shown, disabled, with "For documents with 2 or more pages."

#### Scenario: One-page document after a two-sided one

- **WHEN** the user printed a multi-page document double-sided and then loads a one-page document
- **THEN** the option is disabled and the page prints one-sided

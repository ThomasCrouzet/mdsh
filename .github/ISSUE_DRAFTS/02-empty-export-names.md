# Add export filename edge-case coverage

Labels: `good first issue`, `testing`

Extend export tests for blank names, reserved characters, duplicate extensions, and Unicode normalization.

Acceptance criteria:

- Unit tests cover Markdown, HTML, PDF, and ZIP filename helpers.
- Existing names remain unchanged when already valid.
- No browser download is triggered by an invalid empty selection.
- Check, lint, and unit tests pass.

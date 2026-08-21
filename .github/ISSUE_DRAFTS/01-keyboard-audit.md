# Audit keyboard shortcuts across platforms

Labels: `good first issue`, `accessibility`, `documentation`

Verify every shortcut in the README on Chromium, Firefox, and WebKit, then correct documentation or focused-key handling without changing shortcut assignments.

Acceptance criteria:

- Results cover macOS and Windows/Linux modifier rendering.
- Conflicts inside CodeMirror and Milkdown are recorded with reproduction steps.
- Any code fix has a Playwright regression test.
- English and French labels remain in parity.

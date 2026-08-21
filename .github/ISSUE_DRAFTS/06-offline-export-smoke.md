# Extend the standalone HTML offline smoke test

Labels: `good first issue`, `testing`, `offline`

Add an offline export fixture covering KaTeX, code highlighting, a table, and a data-URI image.

Acceptance criteria:

- The exported file opens under `file://` with networking disabled.
- No request leaves the document.
- KaTeX fonts are data URLs and the CSP contains no script source.
- The test records a clear failure when any required local asset cannot be embedded.

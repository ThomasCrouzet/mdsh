# Source preservation and library export

The browser scenarios cover these failure modes:

- A visual editor visit changes source formatting without an edit.
- A delayed editor event restores an obsolete source snapshot.
- A library export allocates an archive above the project import limits.
- A same-document project link does not move to its heading.

Run `E2E_PORT=4287 npm run test:e2e -- source-fidelity.spec.ts portable-projects.spec.ts --project=chromium`.
The report contains source fixtures, exported bytes, screenshots, and revision metadata.
The source remains exact until a visual edit changes the document model.
Visual edits can normalize Markdown syntax that the editor supports.

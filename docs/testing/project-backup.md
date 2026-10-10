# Project backup scenarios

These scenarios define the browser evidence for portable project backups.

## Failure risks

- A version 1.9 backup can fail after the schema 2 migration.
- An IndexedDB version 5 upgrade can lose drafts, trash, workspaces, templates, history, or metadata.
- A backup can omit a project document or change its relative path.
- Binary conversion can change image bytes.
- A backup can expose a native directory identifier or disk permission.
- Replacement can restore documents without their project or assets.
- Encryption can exclude project data or fail to restore it.
- Merge can reuse a conflicting project identifier and mix two projects.
- A repeated merge can create another copy of an unchanged project.
- Invalid identifiers, paths, references, counts, or sizes can change stored data.

## Browser workflows

Run the focused scenarios with:

```sh
npm run test:e2e -- project-backup.spec.ts --project=chromium --workers=1
```

The migration scenario imports a schema 1 backup from version 1.9. It verifies the complete document after replacement.

The database migration scenario creates the exact version 5 stores and indexes. It seeds open and closed data before the application starts. It then verifies every retained row and imports a new project through schema 6.

The plaintext scenario imports a project ZIP, then exports a schema 2 backup. It checks the project paths and exact image bytes. It also checks that the export omits the native directory identifier. It restores the backup and compares the image in a new project ZIP.

The encrypted scenario exports the same project with a passphrase. It replaces local storage from that file and compares the restored image bytes.

## Evidence

Each test attaches its input backup or ZIP and its downloaded result. The Playwright report records the command, source revision, working diff, environment, and result.

The exact image comparison detects base64 conversion errors. The version 1.9 fixture detects accidental schema 1 rejection.

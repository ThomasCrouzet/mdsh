# Roadmap

> For what is shipped: [`CHANGELOG.md`](./CHANGELOG.md). To contribute: [`CONTRIBUTING.md`](./CONTRIBUTING.md).
> Open an issue before a large PR.

## Pending ideas

- **Regenerate E2E snapshots on Linux** - since the Milkdown 7.20 upgrade, the `e2e/visual.spec.ts-snapshots/` must be regenerated on Linux (`--update-snapshots`) via the official Playwright container (`mcr.microsoft.com/playwright:vX.Y.Z-jammy`) before being re-enabled in CI.
- **Watch `lucide-svelte`** - pinned to `1.0.1` (latest available). Re-check when `1.1.0` ships.

## Out of scope (product positioning)

- **Cloud / WebDAV sync** - contradicts "100% offline, zero backend". A regular ZIP dump covers migration.
- **Import from URL** - incompatible with the `connect-src 'self'` CSP.
- **`[[wiki]]` autocompletion in WYSIWYG** - costly ProseMirror plugin, unclear ROI. Rendered wiki-links plus click-through resolution are enough.
- **At-rest encryption of all notes** - encrypted backups already exist; encrypting every draft at boot is deliberately deferred (a dedicated unlock flow needs to be designed, and a forgotten passphrase means permanent loss).
- **Writing stats, sample documents on first launch, cross-window drag** - gadgets or too niche.

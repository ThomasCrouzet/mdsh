# Roadmap

> For what is shipped: [`CHANGELOG.md`](./CHANGELOG.md). To contribute: [`CONTRIBUTING.md`](./CONTRIBUTING.md).
> Open an issue before a large PR.

## Pending ideas

- **Watch `lucide-svelte`** - pinned to `1.0.1` (still the latest on npm as of 2026-07-15). Re-check when `1.1.0` ships; icon API was breaking at 1.0.
- **`--legacy-peer-deps`** - still required for Milkdown peer resolution (see `.npmrc`). Re-evaluate when Milkdown peers allow a clean install.
- **Community announcement** - draft copy lives in [`docs/announcement-draft.md`](./docs/announcement-draft.md) (Show HN / r/sveltejs) for when you choose to post.

## Visual snapshots (deliberate CI policy)

Playwright visual snapshots (`e2e/visual.spec.ts`) are **local-only by design**.
CI runs with `--ignore-snapshots --grep-invert "Snapshots visuels"` (see
`.github/workflows/deploy.yml`): font rendering differs between the official
Playwright Docker image and `ubuntu-latest`, which previously failed unrelated PRs.

Baselines `*-chromium-linux.png` and `*-chromium-darwin.png` remain versioned for
**local** comparison (Docker / macOS). They are not a CI gate. To re-enable
gating later, regenerate baselines **on the same runner class as CI** (not only
Docker desktop) and remove the grep-invert flag.

## Out of scope (product positioning)

- **Cloud / WebDAV sync** - contradicts "100% offline, zero backend". A regular ZIP dump covers migration.
- **Import from URL** - incompatible with the `connect-src 'self'` CSP.
- **`[[wiki]]` autocompletion in WYSIWYG** - costly ProseMirror plugin, unclear ROI. Rendered wiki-links plus click-through resolution are enough.
- **At-rest encryption of all notes** - encrypted backups already exist; encrypting every draft at boot is deliberately deferred (a dedicated unlock flow needs to be designed, and a forgotten passphrase means permanent loss).
- **Writing stats, sample documents on first launch, cross-window drag** - gadgets or too niche.
- **Search / tag index scale beyond ~300 files** - documented ceiling; incremental worker corpus sync is in place for search, full inverted `filesByTag` only if real usage exceeds the target.

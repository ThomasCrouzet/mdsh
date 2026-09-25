# Roadmap

> For what is shipped: [`CHANGELOG.md`](./CHANGELOG.md). To contribute: [`CONTRIBUTING.md`](./CONTRIBUTING.md).
> Open an issue before a large PR.

## Pending ideas

- **Watch `@lucide/svelte`** - keep the exact version pinned and test icon API changes before upgrading.
- **`--legacy-peer-deps`** - still required for Milkdown peer resolution (see `.npmrc`). Re-evaluate when Milkdown peers allow a clean install.
- **Community announcement** - maintain one [announcement draft](docs/outreach/announcement.md) and the [directory entries](docs/outreach/list-submissions.md).

## Proposals that need user validation

The retired [1.6.0 product review](archive/2026-09-25/PRODUCT_REVIEW.md) contains the original evidence and estimates.
Its library, link, navigation, template-manager, and offline-status corrections are delivered.
These remaining proposals are not release commitments:

Owner: the project maintainer. Source date: 2026-09-22.
Close a proposal after a documented scope decision or a release with its workflow checks.

- Split source and rendered preview, with a measured rendering budget.
- Portable project archives with separate image assets and link reports.
- Detailed version and disk-conflict comparisons.
- Metadata forms that preserve unsupported YAML fields.
- Image insertion at the caret, optional conversion, and clear size feedback.
- Print presets, text size, and interface density controls.
- Saved searches, pinned documents, and explicit system sharing.
- Physical mobile-device workflows and human assistive-technology checks.

## Desktop clients (Tauri 2)

Shipped in-tree (`src-tauri/`, `npm run desktop:dev` / `desktop:build`, workflow `desktop.yml`):

- Path-based disk open/save (native dialogs + Rust `disk_*` commands) alongside browser FSA
- Native app menu, window-state restore, `.md` / `.markdown` / `.mdx` / `.txt` associations + argv open

Still deferred:

- Authenticated distribution signing / notarization / SmartScreen
- Auto-update (`tauri-plugin-updater`)
- Optional directory vault watch, tray icon
- App Store / Microsoft Store listings

## Visual snapshots (deliberate CI policy)

Playwright visual snapshots (`e2e/visual.spec.ts`) are **local-only by design**.
CI runs with `--ignore-snapshots --grep-invert "Snapshots visuels"` (see
`.github/workflows/deploy.yml`): font rendering differs between the official
Playwright Docker image and the GitHub-hosted runner, which previously failed unrelated PRs.

Baselines `*-chromium-linux.png` and `*-chromium-darwin.png` remain versioned for
**local** comparison (Docker / macOS). They are not a CI gate. To re-enable
gating later, regenerate baselines **on the same runner class as CI** (not only
Docker desktop) and remove the grep-invert flag.

## Out of scope (product positioning)

- **Cloud / WebDAV sync** - would add a backend synchronization surface. Regular ZIP exports cover migration.
- **Import from URL** - outside the local-file workflow. HTTPS connections are available only for document images that the user explicitly requests.
- **`[[wiki]]` autocompletion in WYSIWYG** - a ProseMirror plugin would cost too much work for an unclear benefit. Rendered wiki links and click navigation are sufficient.
- **At-rest encryption of all notes** - encrypted backups already exist. Encryption of every draft at startup remains deferred. It needs a separate unlock flow. A forgotten passphrase causes permanent data loss.
- **Writing stats, sample documents on first launch, cross-window drag** - these add unnecessary features or serve too few users.
- **Search / tag index scale beyond about 300 files** - documented limit. Search reuses its worker corpus until the fingerprint changes, then sends a full replacement. Consider document-level updates and a full inverted tag index only if real usage exceeds the target.

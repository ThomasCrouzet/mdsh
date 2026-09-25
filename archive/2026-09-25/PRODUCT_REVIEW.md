# Product review and improvement plan

Review date: 2026-09-22. Source: version 1.6.0, commit `6a25d8a`.

Implementation follow-up: the next feature release includes the library and link
consistency fixes, an Actions menu, in-mode visual search, document outlines,
backup inspection, a template manager, optional preference storage, and explicit
offline readiness. The findings below record the reviewed 1.6.0 baseline.

## Summary

mdsh has a clear purpose: private Markdown work, with local files and offline operation. The three editor modes, portable exports, and small application shell form a useful product. The storage and release controls are strong for a project with one maintainer.

The best next step is to make the existing features work as one coherent workspace. Some operations use only open tabs, although closed documents remain in the library. This causes missing search results, incomplete ZIP exports, and duplicate notes from wiki links. These problems affect trust in the product.

Recommended order:

1. Make the document library consistent across search, links, and export.
2. Keep note links valid after rename and backup merge.
3. Make save status, external backups, and recovery easy to understand.
4. Add document navigation and search that preserve the current editor mode.
5. Give common actions a simple touch-friendly menu.

These changes support the current product limits. Each can operate on the client, with English and French interface text. Later additions can include a split preview, portable project archives, and a template manager.

## 1. Review method and evidence

The review covered the product documents, interface components, file stores, metadata index, search workers, editor wrappers, image handling, export and backup services, PWA configuration, Tauri file boundary, tests, and CI definitions. It also included screenshots of desktop and emulated mobile workflows.

Additional browser checks used temporary Chromium profiles and small test documents. The checks exercised closed documents, ZIP export, wiki links, rename, and backup merge. No real document library was used.

Evidence labels in this report:

- **Observed:** reproduced in the local production build.
- **Source:** established from the current implementation.
- **Hypothesis:** an expected user benefit that needs feedback from users.

The review did not include user interviews, physical mobile devices, a human screen-reader audit, or execution of the native installers. Native conclusions come from source and CI review. Dependency security jobs were inspected, but fresh npm and Cargo advisory scans were not run. The report does not claim measured user demand or a new security certification.

### Checks run

Environment: macOS, Node 26.9.0. CI specifies Node 22.

| Check | Result |
| --- | --- |
| `npm run check` | Passed. No Svelte or TypeScript errors or warnings. KaTeX assets match. |
| `npm run lint` | Passed before this report was added. |
| `npm run test` | Passed: 85 test files, 1,482 tests. |
| `npm run test:e2e -- --ignore-snapshots --grep-invert "Snapshots visuels" --workers=2` | Passed: 82 tests. Includes Chromium, mobile Chromium, and the configured Firefox and WebKit subsets. |
| `npm run build` | Passed as the Playwright server setup step. Used an empty base path. |
| `npm run size` | Passed the entry, page, CSS, dependency graph, and precache limits. |
| PWA output inspection | The manifest, four required icons, maskable purpose, service worker, and Workbox file are present. Offline and update browser tests passed. |
| Report formatting | Reviewed manually. The repository excludes Markdown files from Prettier. |

Visual snapshot comparisons were excluded, as the project policy specifies. Coverage percentages were not measured again. Passing tests show that the covered workflows work; the additional checks below found gaps outside those workflows.

### Bundle and offline cost

The full build contains the following files. Gzip totals are the sum of individually compressed files, including lazy JavaScript and service worker files.

| Category | Raw size | Gzip size |
| --- | ---: | ---: |
| All build JavaScript | 8,710,868 bytes | 2,699,536 bytes |
| All build CSS | 205,191 bytes | 44,434 bytes |

Total JavaScript exceeds the bundle audit's general 500 KB reference. The app already loads Milkdown and CodeMirror on demand, and loads the rendering module on demand. Further work should examine unused modules and conditional math or code-highlighting loads. Recommending lazy editors as a new feature would miss work that is already complete.

The project-specific measurements give better information about each loading path:

| Dependency graph or cache | Measured gzip bytes | Limit | Remaining margin |
| --- | ---: | ---: | ---: |
| Startup graph | 150,837 | 163,840 | 13,003 |
| Reading graph | 279,733 | 327,680 | 47,947 |
| Source graph | 234,891 | 307,200 | 72,309 |
| WYSIWYG graph | 564,955 | 655,360 | 90,405 |
| PWA precache | 2,746,856 | 2,900,000 | 153,144 |
| PWA resource count | 359 resources | 360 resources | 1 resource |

The mode graphs can share files. Do not add their sizes to estimate one page load. The startup graph also includes dependencies that a single page-chunk measurement omits. Local gzip measurements are reference values, not observed network transfer times.

**Implication:** new lazy components can exhaust the resource-count budget even when their byte cost is small. Measure the graph and offline cache for each addition. Preserve offline availability when reducing unused code. Mermaid's large ELK chunk is already excluded from the precache; its presence in the build is not proof that startup loads it.

## 2. Assessment by area

| Area | Existing strengths | Best improvement opportunity |
| --- | --- | --- |
| Product purpose | Clear local-first scope, no account, offline PWA, optional desktop application. | Make the whole library behave consistently. Use a few clear workflows to explain the feature set. |
| First use | New, import, and optional linked demo documents are already available. Storage limits are explained. | Add short contextual help for save, export, backup, and installation. Keep the demo optional. |
| Visual design | Consistent BLACKSITE colors, system fonts, light/dark/system modes, and a quiet document surface. | Improve action discovery and text-size control. A complete visual redesign has less evidence of benefit. |
| Writing | WYSIWYG tables, lists, images, math, diagram previews, source editing, focus mode, and typewriter mode exist. | Find text and move through long documents without changing modes. Offer a split preview later. |
| Organization | Tabs, durable closed documents, tags, workspaces, backlinks, and graph view exist. | Give library-wide operations an explicit document scope. Add title-aware filtering and recent-document access to the existing controls. |
| Search | Worker execution, timeout handling, Unicode word boundaries, regex checks, and replacement checkpoints exist. | Include closed documents when the user selects the whole library. Show the result limit and a preview of replacements. |
| Storage | Dexie, a 400 ms save delay, explicit write errors, retry, conflict preservation, and durability checks. | Explain the difference between a local draft, a disk copy, and an external backup. Make recovery actions easy to find. |
| Backup | Validated JSON, encrypted backups, merge/replace, and full draft collection including closed notes. | Put the existing reminder in a visible workflow. Add a non-mutating inspection step before restore. |
| Privacy and security | Sanitized rendering, explicit consent for remote images, no runtime CDN, encrypted backups, and restricted native file access. | Reuse the same rendering and media controls in previews, archives, and sharing. Keep the existing dependency and native security checks. |
| Links and metadata | Wiki links, aliases, backlinks, tags, and a small cached metadata index. | Preserve link targets through document lifecycle changes. Align metadata behavior across the sidebar, palette, and renderer. |
| Images and interoperability | Embedded images survive reload. Relative images can be resolved through an explicit selection. HTML is self-contained. | Offer an archive with normal asset files for other Markdown tools. Improve image placement and size control. |
| Export | Markdown, ZIP, HTML, and prepared PDF output. Tests cover math, diagrams, pixels, and multipage output. | Make export scope explicit. Later, offer a small set of print options and project-level portable output. |
| Mobile | Responsive toolbar, visible mode labels, drawer focus handling, and 44 px coarse-pointer toolbar targets. | Put common actions within two taps. Add a mobile contents panel and test with real software keyboards. |
| Accessibility and language | Focus traps, skip link, keyboard alternatives, live status, reduced motion, contrast support, and English/French catalogs. | Test complete tasks with assistive technology. Translate built-in template labels and descriptions. |
| PWA | Offline resource preparation, update prompts, and save-before-reload behavior are tested. | Show persistent preparation status and installation help. Keep enough resource budget for future changes. |
| Desktop | Rust capability tokens, revision checks, atomic writes, file associations, and native smoke jobs on four runner targets. | Add a useful conflict comparison flow. Signed distribution is a later adoption step already listed in the roadmap. |
| Architecture | Svelte 5 runes, strict TypeScript, pure operation modules, lazy panels, and a shared command registry. | Centralize document scope and link resolution. Keep new behavior out of the large store facade and command component. |
| Tests and release | Broad unit tests, browser tests, bundle limits, accessibility checks, security jobs, and release provenance. | Add lifecycle scenarios that cross feature boundaries. Test mobile editing and export on actual devices. |
| Documentation and adoption | User guide, support policy, contribution guide, security model, demo, and announcement draft. | Align older statements with current behavior. Add version and local diagnostic information inside the app. |

Likely users include occasional Markdown writers, people who write technical documents, and people who keep a small collection of linked notes. These are hypotheses from the feature set. The priorities below favor benefits shared by these groups and the cost of maintenance by one person.

## 3. Confirmed gaps

### F1. Closed documents disappear from full-text search

**Observed.** Import `alpha.md` with a unique text marker and `beta.md`. Close only the `alpha` tab. Search for its marker with cross-file search. The result is empty, although `alpha.md` remains in IndexedDB with `open: false`.

The search label says that it searches all files. `SearchPanel.svelte` supplies `filesStore.files` to the worker. The store keeps closed notes in a separate `closedFiles` array. The palette can already reopen closed files by name, so the missing feature is a consistent content-search scope.

Sources: `src/lib/components/SearchPanel.svelte`, `src/lib/files.svelte.ts`, `src/lib/i18n/messages/en.ts`.

### F2. A wiki link to a closed note creates an empty duplicate

**Observed.** Keep `beta.md` open with `[[alpha]]` and close `alpha.md`. Activate the link in reading mode. The app creates `alpha (2).md` with empty content. The original note remains closed and intact.

`MetaIndex` receives only open files. `openWikiLink()` interprets an unresolved target as a new document. This can look like lost content even though the original survives.

Sources: `src/lib/files.svelte.ts` (`metaIndex`, `openWikiLink`, `reopen`), `src/lib/meta-index.ts` (`resolveWikiLink`).

### F3. Export all omits closed documents

**Observed.** With `alpha.md` closed and `beta.md` open, the command named `Export all files` produces a ZIP that contains only `beta.md`.

The export dependency accessor returns only `this.files`. JSON backup uses the full Dexie draft table and therefore has a different scope. Open-tab ZIP export is useful, but its label must state that scope. A separate full-library export would match the broader user expectation.

Sources: `src/lib/files.svelte.ts` (`exportDeps`), `src/lib/export-ops.ts`, `src/lib/services/backup.ts` (`collectBackup`).

### F4. Rename leaves incoming name-based links unchanged

**Observed.** Rename open `alpha.md` to `gamma.md`. The content of `beta.md` still contains `[[alpha]]`. The resolver matches filenames or exact identifiers, so it does not redirect that link to `gamma.md`.

Sources: `src/lib/files.svelte.ts` (`rename`, `syncDiskName`), `src/lib/meta-index.ts`.

### F5. Backup merge leaves identifier-based links unchanged

**Observed.** Merge a backup containing `alpha.md` with ID `audit-alpha` and `beta.md` with `[[audit-alpha]]`. Merge assigns new draft IDs and updates workspace references. The Markdown link retains the old ID. Activating it creates an empty `audit-alpha.md` instead of opening the imported `alpha.md`.

The same issue applies to exact UUID targets. Identifier-based wiki links are supported by the resolver, so this is a supported-path consistency gap.

Sources: `src/lib/services/backup.ts` (`applyBackup`, `importedIdMap`), `src/lib/meta-index.ts`.

### F6. Mobile layout works, but common actions require the command list

**Observed and source.** At an emulated 393 x 727 CSS-pixel viewport, the toolbar has no horizontal overflow. Visible toolbar buttons are at least 44 px high. Direct export and disk-save buttons are hidden at this width. The test library exposes 42 palette entries, with close and delete near the start. The contents column has `display: none` below 1024 px.

The opportunity is action discovery and document navigation. The review did not find a need to rebuild the existing drawer or mode buttons.

Sources: `src/lib/components/Toolbar.svelte`, `src/lib/components/CommandPalette.svelte`, `src/lib/components/EditorPane.svelte`, `src/app.css`.

## 4. Top five recommendations

Priority uses observed impact, frequency of the affected workflow, confidence, and maintenance cost. Effort is relative: **S** is a contained interface or logic change; **M** affects several modules and workflows; **L** needs a new subsystem or substantial editor integration. These are planning estimates, not delivery dates.

| Rank | Recommendation | Main benefit | Evidence | Effort |
| --- | --- | --- | --- | --- |
| 1 | Consistent library and explicit operation scope | Users can find and export every retained document. | High: F1, F2, F3 reproduced. | M |
| 2 | Link integrity through rename and merge | A linked notebook keeps its connections as it changes. | High: F4 and F5 reproduced. | M |
| 3 | Clear save, backup, and recovery controls | Users understand where their current work exists and how to recover it. | High for the current behavior; user benefit is a hypothesis. | S for status/reminder, M for restore inspection. |
| 4 | Navigation and search within the current mode | Long-document work needs fewer mode changes and less scrolling. | High for the current limitation; demand needs validation. | M for outline, L for full WYSIWYG search. |
| 5 | Common actions in a touch-friendly menu | Occasional and mobile users can use the feature set without command-name knowledge. | F6 plus a usability hypothesis. | M |

### 1. Consistent library and explicit operation scope

**User goal:** close a document to reduce tab clutter, then find it again without knowing its filename.

First release:

- Define one library accessor that includes open and closed drafts, with stable IDs.
- Add explicit search scopes: library and open tabs. Use library scope for a label that says all files.
- Resolve wiki links against the library and reopen an existing closed target.
- Label ZIP scopes clearly: current document, selection, open tabs, and library.
- Keep replacement scope explicit when adding closed-document search. A wider search must not silently make replacement affect more documents.

Next increment: improve the existing closed-document area with a filter, recent changes, tags, and a consistent title/filename display. Use the existing palette for quick opening. Workspaces remain saved tab sessions; explain that model in the interface.

**Acceptance:** closing a target does not change its search visibility in library scope, its link identity, or its inclusion in a library ZIP. Opening a search result preserves its ID and history. A library of 300 documents remains within the current performance target.

**Implementation:** extend the store through a small document-scope module. Update search, metadata, graph, navigation, and export callers deliberately. Include closed-row persistence when an operation can change a closed draft. Reuse `reopen()`.

### 2. Link integrity through rename and merge

**User goal:** reorganize a linked notebook without repairing every reference by hand.

First release:

- Before rename, find affected incoming links across the library and show the change count.
- Offer to update the link targets. Preserve displayed aliases and literal examples in code.
- Apply the backup merge ID map to supported identifier-based wiki targets in imported Markdown.
- Detect ambiguous name matches and name collisions. Let the user select the target rather than choosing the first match silently.

Next increment: add a small link-status panel with unresolved targets and actions to select an existing note or create a new one. Add back/forward document navigation after this if linked-note users request it.

**Acceptance:** a linked note survives close/reopen, rename, and backup merge. Renaming does not change code examples. A failed write preserves a recoverable state. Native disk rename and browser unlink behavior still follow their existing contracts.

**Implementation:** share one resolver and a Markdown-aware target rewrite function. Reuse metadata caching and version checkpoints. Extend the code-region scanner carefully before using it to rewrite documents. This work does not require WYSIWYG wiki autocomplete, which the roadmap excludes.

### 3. Clear save, backup, and recovery controls

**User goal:** know whether the latest work is in the browser, on disk, and in an external backup.

The app already has persistent-storage checks, backup dates, and a reminder policy. `storage.ts` marks a backup as old after 30 days and permits a reminder every seven days. `SettingsPanel.svelte` reads and shows that state when Settings opens. The status bar shows local save age, while disk export has separate state.

First release:

- Use explicit status text for local draft save and linked disk save.
- Make the existing backup reminder visible from the normal workspace, with a direct action and a dismiss choice.
- Offer backup as a direct command in the palette as well as in Settings.
- State the backup scope beside the action. History, trash, and file permissions have different recovery rules.

Next increment: inspect a selected backup before restore. Show its date, draft/workspace/template counts, and the effect of merge or replace. A verification-only action should validate or decrypt the file without changing the library.

**Acceptance:** a local save label cannot be mistaken for a disk write. A failed or cancelled export does not advance the backup date. A browser download is described as initiated unless completion can be verified. Restore inspection makes no writes. The 400 ms save delay and existing durability checks remain in force.

**Recovery detail:** when persistence fails, make the existing current-document export easy to reach. If a full in-memory recovery export is added later, label it as a recovery copy with its actual scope. Keep the normal backup guarantee that it represents durable state.

Sources: `src/lib/storage.ts`, `src/lib/components/StatusBar.svelte`, `src/lib/components/SettingsPanel.svelte`, `src/lib/services/backup.ts`.

### 4. Navigation and search within the current mode

**User goal:** find a paragraph or section while writing, without losing the visual context.

Current behavior: `Cmd/Ctrl+F` changes WYSIWYG and reading mode to source mode. The contents panel works only in reading mode and is hidden on smaller screens. Source undo and editor-position restoration already exist and provide a useful base.

First release:

- Add a heading navigator in source and WYSIWYG modes, with a compact panel on mobile.
- Start with source-mode navigation, where line positions are available.
- Add find-and-next/previous in reading mode, then assess WYSIWYG decorations separately.
- Preserve the active mode, caret, and scroll position when the user closes navigation or search.

**Acceptance:** users can jump to a section and find a phrase in the same mode. Headings inside code do not become outline entries. Repeated headings work. Search results and active sections have accessible labels. Editing a large document does not trigger a full diagram render for each keystroke.

**Implementation:** use a shared heading model with editor-specific position adapters. Reuse the existing state cache and source navigation method. Avoid a live DOM scan of the whole WYSIWYG document on every input. Treat WYSIWYG replacement as a later step after find-only behavior is stable.

Sources: `src/routes/+page.svelte` (`openInFileSearch`), `src/lib/components/Toc.svelte`, `src/lib/components/EditorPane.svelte`, `src/lib/editor-state.ts`.

### 5. Common actions in a touch-friendly menu

**User goal:** search, export, change settings, and recover a version without remembering command labels.

First release:

- Add a small menu with Search, Export, History, Settings, and document actions.
- Group export formats in one place and show the current export scope.
- Keep the existing searchable palette for the full command set.
- Put a visible New action within easy reach after the first document is open.
- Reduce persistent success overlays after simple imports. Keep failed-file details available.

Next increment: offer a system share action for a generated file when the browser supports it. The user must initiate the action. Use the existing download path as the fallback.

**Acceptance:** common actions take at most two taps from the editing screen. The menu works at 320 to 430 px, with zoom and a software keyboard. All controls have visible labels or accessible names. Closing the menu restores focus. Test editing, import, export, and history on physical iOS and Android devices.

**Implementation:** reuse command identifiers and enabled-state rules. Extend the registry where useful so the menu, palette, and shortcuts do not acquire separate behavior. Retain the current coarse-pointer sizing and mobile drawer.

Sources: `src/lib/components/Toolbar.svelte`, `src/lib/components/CommandPalette.svelte`, `src/lib/ui/commands.ts`, `src/lib/components/ImportProgress.svelte`.

## 5. Further additions worth considering

These ideas have a useful fit, but the top five should establish the main workflows first.

| Priority | Addition | User value and current evidence | Small first version | Effort / condition |
| --- | --- | --- | --- | --- |
| Next | Split source and preview | Technical writers can check Markdown while they edit. `EditorPane.svelte` currently mounts one mode at a time. | Desktop-only source plus read-only preview, with a delayed refresh and a toggle. | M. Measure math/diagram cost and keep one editable source of truth. |
| Next | Portable project archive | Users can move notes to another Markdown tool with ordinary image files. Current ZIP output is flat; embedded images remain data URIs in the Markdown. Folder import keeps basenames. | Export selected notes plus an `assets/` directory, rewrite image destinations in the exported copy, and include a link report. | M/L. Add ZIP import and relative document paths in a later step. Bound decompressed size and file count. |
| Next | Useful version comparison | The current history shows a source preview and added/removed line counts. Users cannot inspect a line-by-line change view. | A highlighted text diff and an explicit checkpoint action. | M. Reuse the diff later for disk conflicts and replacement previews. |
| Next | Template manager | Templates and date substitution already exist. The store has a delete method, but the interface does not expose a manager. | List, rename, edit, duplicate, and delete custom templates. Translate built-in choice labels and descriptions. | M. Preserve user template content and backup compatibility. |
| Next | PWA preparation and install status | Offline readiness is a transient notification. The toolbar's `LOCAL // OFFLINE` text is static. | A persistent preparation/ready/error state and browser-specific installation help. | S/M. Report service worker readiness, not just `navigator.onLine`. |
| Next | Local support information | `SUPPORT.md` asks for the app version and platform, but Settings has no About section. | Show version, platform, storage capability, and service worker state. Provide explicit copy-to-clipboard. | S. Exclude note content, filenames, paths, and passphrases. No automatic submission. |
| Later | Simple metadata editing | Tags are useful, but users must know front-matter syntax. The synchronous index supports only a subset of YAML. | A title/tag form with clear source representation and unsupported-format feedback. | M. Preserve unknown YAML fields and avoid a whole-document rewrite. |
| Later | Image size and placement controls | Embedding is reliable, but base64 increases Markdown size. Window-level dropped images are appended to the document. | Optional resize before embedding, size feedback, and insertion at the active editor position. | M. Keep the original unless the user selects a conversion. Measure image-heavy history and search. |
| Later | Print presets | PDF preparation is already well tested. Presentation needs can differ. | Local font, margin, and paper-size choices with a small preview. | M. Keep content-only output as the default and retain formula/diagram fidelity. |
| Later | Text size and interface density | Width and theme are configurable. Font sizes remain fixed in several controls and editors. | A small set of text-size and line-spacing choices that use existing system fonts. | S/M. Validate zoom, focus, touch targets, and both themes. |
| Later | Saved searches and favorites | Useful for repeat access within the supported few hundred documents. | Pin a document and save a library filter. | M. Validate demand after the unified library is in use. Avoid a new task-management subsystem. |
| Conditional | Signed Desktop distribution | Unsigned installers add installation friction. Signing and notarization are already deferred in `ROADMAP.md`. | Sign and notarize one supported platform, with the same provenance checks. | L plus recurring platform cost. Prioritize if Desktop users report this as a main barrier. |

### Small corrections with a good cost-to-benefit ratio

- **Metadata consistency:** `MetaIndex.getMeta()` uses the H1 fallback only when a front-matter block exists. The general title-priority comment describes broader behavior. Align the rule and expose both the display title and filename in search/open controls.
- **Search limit:** `search-core.ts` returns at most 200 matching lines, with one hit per matching line. Show when results are limited and describe the count correctly. Replacement counts can differ because they count occurrences.
- **Template dates:** `templates.ts` uses `toISOString()` for the date. This is a UTC date and can differ from the user's calendar date around midnight. Define local-date semantics for journal templates.
- **Preference resilience:** some theme and storage helpers handle unavailable preferences, but `+page.svelte` still reads and writes `localStorage` directly after mount. Test the case where preferences fail but IndexedDB is usable. A preference failure should not leave the workspace inert.
- **Documentation alignment:** `ROADMAP.md` describes a self-only connection CSP, while the current configuration permits HTTPS for explicit image embedding. `CONTRIBUTING.md` describes a dark default, while the README describes system-theme selection. `docs/DEVELOPMENT.md` says `allTags` rebuilds on every access, but the implementation caches it. The roadmap describes incremental corpus sync, but search sends the full corpus when its fingerprint changes. Update these statements with the related feature work.
- **Test descriptions:** some test names still refer to closing tabs as moving files to trash. Align them with durable closed-document behavior so future changes follow the intended model.

These points are source-review findings. They were not all reproduced as browser failures.

## 6. Engineering and release plan

### First delivery: document lifecycle consistency

Implement the initial scopes from recommendations 1 and 2. Add regression scenarios for F1 to F5 before extending the interface. Include close/reopen, workspace switch, rename, merge, and ZIP export in the same test library. Verify open and closed drafts, aliases, exact IDs, duplicate names, and code examples.

A shared scope accessor and resolver have more value here than a broad store rewrite. Preserve the pure operation modules. Explicit scope types also make future menus and archives easier to implement.

### Second delivery: trust and action discovery

Add the status/reminder part of recommendation 3 and the common-action menu from recommendation 5. Reuse the current backup service and command rules. Add backup inspection after the status flow is understood. Include keyboard and French-label checks.

### Third delivery: writing improvements

Add source outline and mobile contents navigation. Validate whether users next prefer reading-mode search, WYSIWYG find, or a split preview. These features share a navigation need but have different implementation costs.

### Checks for implementation work

- Shared state, storage, export, or PWA changes require the full project checks and browser tests specified in `AGENTS.md`.
- Recheck startup dependencies, lazy-mode graphs, and precache limits for new panels.
- Preserve the 400 ms save delay, visible write failures, and save-before-update behavior.
- Keep a 200 to 300 document test library. Add image-heavy notes to the existing text-heavy performance checks.
- Run the existing native validation when disk behavior changes. Mocked browser tests do not replace native file-write and installer checks.
- Keep English and French labels in the catalogs. Use the existing theme tokens, focus management, and reduced-motion support.

## 7. Validate user value without telemetry

Use a small voluntary test group, for example five to eight people across occasional writing, technical documents, and linked notes. Supply local test files and ask them to complete these tasks:

1. Import notes, close one, and find it from a phrase in its content.
2. Follow a link to a closed note, rename that note, and follow the link again.
3. Explain what saved means, make an external backup, and inspect a restore.
4. Find a phrase and jump to a heading in a long document without changing mode.
5. Export a note and open version history on a phone without instructions.

Record task completion, wrong turns, duplicate creation, and whether help was needed. Ask which later addition would save the most effort: split preview, portable archive, or templates. Keep observations outside the application and collect them with the participants' agreement.

This gives direct evidence for the next release while preserving the no-telemetry design. The immediate goal is reliable completion of normal writing tasks, with clear control over local documents.

## Appendix: large build files

The ten largest JavaScript/CSS files in `build/_app/immutable/` on this build are listed below. Names are build-specific. This is a size inspection, not a claim that each file loads at startup.

| File under `build/_app/immutable/` | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| `chunks/S9qfoDle.js` | 1,457,530 | 446,164 |
| `chunks/DHwB1DNv.js` | 662,120 | 141,696 |
| `chunks/CFArpuRi.js` | 518,929 | 152,407 |
| `chunks/B-NFISlW.js` | 434,767 | 136,307 |
| `chunks/DNgGsnE3.js` | 288,108 | 87,443 |
| `chunks/CVhxFAN8.js` | 229,797 | 69,477 |
| `chunks/BDk15gIn.js` | 211,431 | 25,989 |
| `chunks/BWzczNHn.js` | 199,075 | 63,303 |
| `chunks/BNtZCn5I.js` | 186,468 | 49,462 |
| `chunks/p4AcYWcV.js` | 154,338 | 52,079 |

Six more JavaScript files exceed 100 KiB raw: `chunks/DbZTxGeM.js` (148,772 bytes), `chunks/CEhZXjIb.js` (117,221), `chunks/CCRN2H72.js` (115,374), `chunks/BAoz1Mu0.js` (106,101), `nodes/2.DaqyfUaT.js` (104,434), and `chunks/QtKOTMUO.js` (103,882). No CSS file exceeds 100 KiB. The application-specific budgets pass despite these individual large files.

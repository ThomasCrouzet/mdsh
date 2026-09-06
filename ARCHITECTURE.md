# Architecture

This document explains the main design decisions in mdsh. For a module reference,
see the map in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Offline-first without a backend

mdsh has no server. Dexie stores drafts in IndexedDB. The File System Access API
edits disk files in place. Exports are plain files. The PWA must work offline on
its first use, before a previous online visit can fill browser caches.

The pre-1.0 hardening pass broke this guarantee. The precache transform in
`vite.config.ts` converts Workbox build URLs to requested browser URLs. But
the SPA fallback used `/mdsh` instead of the served `/mdsh/` path. A new install
could not match its navigation request to the precache key. `navigateFallback`
then returned a blank offline shell. With an empty base path, the same transform
produced an empty precache.

A previous online visit hid the defect because the browser already had the page.
`e2e/pwa.spec.ts` found it by loading a new installation after network access was
disabled. The fix aligned the fallback key with the served URL. An offline-first
claim requires a CI test that disables the network before first use.

## The bundle budget as a design constraint

`.size-limit.json` limits the gzip JavaScript entry to 12 KB, the startup page
chunk to 60 KB, and CSS to 120 KB. CI blocks a change that exceeds a limit.
The application uses `marked` to render Markdown and KaTeX to render math.
It uses `highlight.js` for syntax highlighting and Mermaid for diagrams.
It uses `jszip` for exports and `js-yaml` to parse YAML front matter.
The startup graph cannot include these engines and remain within the limits.

Each engine stays behind a dynamic `import()` from `render/markdown.ts`,
`services/export.ts`, or `frontmatter.ts`. The PWA cache still contains all
revisioned chunks. Offline startup can load the requested engine without a
network and keep the initial graph small. A static import from `+page.svelte`, a
store, or a component mounted at startup would increase the initial cost. ESLint
blocks this leak. `scripts/bundle-graph.mjs` measures the transitive closures of
the startup, reading, source, and WYSIWYG graphs. Thus, the budget checks what
each path loads without counting a shared chunk more than once.

## A facade store over pure, testable modules

`files.svelte.ts` is the primary file store. Svelte 5 requires its `$state` to
stay in one class. Runes cannot move to a plain module and then be imported.
This restriction can put all file logic in one class. Such a class does not
scale across exports, disk sync, tags, search, saves, and trash. Unit tests would
need to start the full class and mock `$state`.

The store is a thin facade. It owns reactive state and connects pure logic
modules. `export-ops` controls Markdown, HTML, PDF, and ZIP exports. `disk-sync`
controls the File System Access API. `meta-index` controls tags, backlinks, and
titles. `save-queue` controls debounced Dexie writes. `trash` controls the trash.

Each module is a plain class or function set. Callbacks connect it to the store.
For example, `meta-index` receives a `() => FileItem[]` accessor. `save-queue`
receives `onSaved` and `onError` callbacks. Thus, `save-queue.test.ts` and
`meta-index.test.ts` test logic without the store, DOM, or Svelte runtime. An
IndexedDB failure reaches `onError` instead of a silent store `console.error`.

## An in-house bilingual layer instead of a library

mdsh uses a small runes-based layer in `src/lib/i18n/`. It supports English and
French without a general i18n library. English is the default. The app detects
French in the browser, and Settings can change the locale.

`en.ts` satisfies `Record<string, string>` and defines the `MessageKey` type.
`fr.ts` uses the same type. A missing key is thus a TypeScript error instead
of a runtime fallback. `i18n.test.ts` also checks key parity, nonempty values,
and the English default. The type system alone cannot check these value rules.
For two locales, this layer uses less code and gives strict guarantees.

## Durability is a state transition, not a timer

The 400 ms save debounce is an optimization, not proof that content is durable. `SaveQueue` serializes writes per document and records a rejected IndexedDB revision as a durability failure. `flushAwait()` retries failed rows and rejects while any in-memory revision is not represented in IndexedDB. Backup export, restore, and workspace replacement stop at that barrier. The UI reports the error without converting it into a successful save.

Visibility, page-hide, and before-unload events trigger an immediate flush to reduce the residual recovery point. They cannot guarantee execution after a browser or operating-system kill. External backup remains the recovery mechanism for loss of the browser profile.

## Native file access uses session capabilities

The Desktop Beta does not accept JavaScript paths for file commands. A Rust-owned picker or operating-system open event canonicalizes the path and returns an opaque session token. The capability store retains the path and permissions; IndexedDB records cannot recreate a grant after restart.

Native writes stage data in the target directory and synchronize it. They then compare a SHA-256 revision immediately before replacement. The operation preserves permissions and uses the platform replacement function. It detects external edits with unchanged size and timestamp. A staging failure keeps the original file.

## Measured corpus budget

Logic tests build corpora of 50, 200, and 300 documents. They then measure the
metadata index and search. A separate browser test uses a Mac mini M4, Chromium,
and a 50,000-character document. Search takes 183 to 205 ms for 200 and 300
notes. The first WYSIWYG pass takes 119 ms, then 85 to 88 ms. Typing takes a
median of 25 ms and 34 ms at the 95th percentile. These values are references
for this machine. The wider CI budgets are regression alarms. They are not a
performance guarantee for all devices.

# Development guide

Working reference for developing mdsh. [ARCHITECTURE.md](../ARCHITECTURE.md)
explains the key design decisions; [CONTRIBUTING.md](../CONTRIBUTING.md) covers
scope and conventions; this file is the day-to-day map: commands, module map,
design limits, pitfalls, and debugging recipes.

## Commands

```sh
npm install --legacy-peer-deps   # MANDATORY (engine-strict + Milkdown peer deps)
npm run dev                      # Vite dev server (http://localhost:5173)
make dev                         # Variant: bind the dev server to the Tailscale IP only
npm run check                    # svelte-check (TS + a11y)
npm run test                     # Vitest (unit)
npm run test:e2e                 # Playwright (e2e, chromium)
npm run lint                     # eslint + prettier --check
npm run size                     # size-limit (bundle budget - blocking in CI)
npm run analyze                  # vite-bundle-visualizer
npm run build                    # Static build → build/
npm run preview                  # Test the build locally
npm run preview:pages            # Test the build under the /mdsh/ base path
npm run desktop:dev              # Tauri desktop shell + Vite (requires Rust)
npm run desktop:build            # Packaged app (macOS / Linux / Windows)
```

### Desktop shell (Tauri 2)

The web PWA remains first-class. The desktop apps are a thin Tauri 2 shell around
the same static SPA (`src-tauri/`).

| Concern | Behavior |
|---------|----------|
| Disk open/save | Native dialogs + path links in IDB (`mdsh-fs`); browser keeps FSA |
| Menu | File: New, Open, Save to Disk, exports, Settings; Edit: system defaults |
| Window | Size/position restore via `tauri-plugin-window-state` |
| File association | `.md` / `.markdown` / `.mdx` / `.txt` + argv; frontend `openPathsFromDesktop` |
| Service worker | Not registered in the shell (`isDesktop()`) |
| Base path | Empty locally by default; release CI explicitly provides `BASE_PATH=''` |
| Version | Single source in `package.json`; `tauri.conf.json` reads it directly |

**Prerequisites (desktop contributors only):**

- Rust stable (`rustup`, `cargo`) - see [https://rustup.rs](https://rustup.rs)
- Platform webview deps:
  - **macOS**: Xcode CLT
  - **Linux**: WebKitGTK (e.g. `webkit2gtk-4.1` / distro equivalent) + usual build tools
  - **Windows**: [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually preinstalled on Win10/11) + MSVC build tools

```sh
npm run desktop:dev     # opens the native window against the Vite dev server
npm run desktop:build   # builds the SPA with the current BASE_PATH, then packages installers
```

Icons: `npx tauri icon static/pwa-512x512.png`. CI: `.github/workflows/desktop.yml` validates Rust on pull requests and `main`, then packages release-please releases, tags `v*`, and manual runs. macOS uses an ad hoc signature by default; authenticated distribution signing, notarization, and auto-update are deferred (see ROADMAP).

## Module map

| Path | Role |
|------|------|
| `src/routes/+page.svelte` | Single page: 3-mode layout + shortcuts + launchQueue + share_target + mounting of the modals (palette / search / disk-links / workspaces) |
| `src/routes/+layout.ts` | `prerender = true`, SPA |
| `src/routes/+layout.svelte` | Root layout: imports `app.css` + renders `children` (minimal shell) |
| `src/lib/files.svelte.ts` | Files store (runes singleton: `$state`, multi-selection, current mode). **Thin facade**: delegates most of the logic to pure modules wired in via callbacks - `export-ops` (exports), `disk-sync` (FSA), `meta-index` (tags/backlinks/titles), `save-queue` (IDB debounce), `trash` (trash bin). Holds the `$state` itself (Svelte 5 constraint) and orchestrates |
| `src/lib/export-ops.ts` | Pure export operations (md / HTML / PDF / ZIP, selection or everything) with a spinner - wrappers extracted from the store, delegating to `services/export`, resetting `dirty=false` + scheduling a save |
| `src/lib/disk-sync.ts` | Disk synchronization (File System Access API): `openFromDisk` / `saveToDisk` / `saveActiveToDisk` / `unlinkFromDisk` / `refreshBrokenLinks` wrapping `fsa.ts` + `broken-links.ts`. Pure module (mutations via store callbacks) |
| `src/lib/meta-index.ts` | Corpus metadata index (pure class): per-file cache (title / tags / wiki targets) + inverted backlinks index, lazy rebuild. Data source via the `() => FileItem[]` accessor |
| `src/lib/save-queue.ts` | Dexie save queue with 400 ms debounce (pure class). Surfaces `hasPendingSave` / `lastSavedAt` / write errors via callbacks - an IDB failure is never swallowed silently |
| `src/lib/trash.ts` | Pure trash-bin logic (move-to-trash, restore, purge, reorder, purge timers) extracted from the store - Dexie operations testable without mounting the store |
| `src/lib/cross-tab.ts` | Cross-tab synchronization (`BroadcastChannel`): fail-soft `createCrossTab` wrapper (post/close). The policy (reload when not dirty / notify on dirty conflict) lives in `files.svelte.ts`. No-op if the API is absent |
| `src/lib/config.ts` | Shared centralized constants (editor widths + `EDITOR` presets, `TIMERS` including the 400 ms debounce, `READING.wpm`) |
| `src/lib/file-utils.ts` | Pure file helpers: `isMarkdownFile` (accepted extensions / MIME types), `uniqueName` (deduplication), `normalizeRename`, `stripMdExtension` |
| `src/lib/types.ts` | Shared types (`EditMode`, `FileItem`, `TrashedFile`, `Hit`...) - no logic |
| `src/lib/i18n/` | i18n layer: `locale.ts` (pure logic - `Locale`, `LOCALES`, `DEFAULT_LOCALE = 'en'`, `detectLocale`, `interpolate`), `messages/en.ts` (default locale, `satisfies Record<string, string>`, exports the `MessageKey` type), `messages/fr.ts` (typed against `MessageKey`, so en/fr keys must match exactly), `i18n.svelte.ts` (runes singleton `i18n` + reactive `t(key, params)`, `load()` / `set()`), `index.ts` (barrel) |
| `src/lib/notify.svelte.ts` | Singleton store of transient toasts (`error` / `success` / `info`), distinct from the spinner and the undo-close toasts. Reporting channel for IDB / quota failures and export completions, announced to screen readers |
| `src/lib/storage.ts` | IDB storage resilience: `isQuotaError`, `reportPersistenceError` (routes to `notify` instead of swallowing), `requestPersistentStorage` (persistent bucket at boot), `checkStoragePressure`. One of the only two modules allowed to call `console` (with `report.ts`) |
| `src/lib/prompt.svelte.ts` | Singleton store driving `PromptModal` via a promise-based API (`promptStore.prompt(...)` / `.confirm(...)`) - replaces `window.prompt` / `window.confirm` (styling, focus trap, SR) |
| `src/lib/workers/search.worker.ts` | Cross-file search worker: moves the O(N×L) loop off the main thread, case/wholeWord/regex matcher, cancellation via an increasing `id` |
| `src/lib/ui/shortcuts.svelte.ts` | Global keyboard shortcuts (pure logic) - callbacks provided by `+page.svelte`, listener via `<svelte:window onkeydown>` |
| `src/lib/ui/modals.svelte.ts` | `createModals()` factory: open state of each modal + memoized loaders (dynamic imports, never static) + `handleOpenHit` |
| `src/lib/ui/file-intents.svelte.ts` | `createFileIntents()` factory: Launch Queue (File Handling), Share Target, tab-title `$effect`, flushing drafts before close |
| `src/lib/ui/image-drop.svelte.ts` | Drag & drop of local images → inline data-URI (pure logic), with a size guard |
| `src/lib/ui/editor-width.svelte.ts` | `createEditorWidth()` factory: editor width + resize handle, persisted |
| `src/lib/ui/prefetch.svelte.ts` | Adaptive prefetch of heavy chunks (mode/math heuristic) after `load()` - dynamic imports guarded by `no-restricted-imports` |
| `src/lib/ui/prefs.svelte.ts` | `createUiPrefs()` factory: focus mode, typewriter, TOC visibility - reactive state + localStorage persistence + DOM `$effect` |
| `src/lib/ui/pwa-update.ts` | "Reload" toast on a new version (`registerType: 'prompt'`); no-op inside the Tauri shell |
| `src/lib/desktop.ts` | Desktop shell detection (`isDesktop`) - no static `@tauri-apps/*` import |
| `src/lib/desktop-shell.ts` | Native menu + open-paths listeners (dynamic Tauri imports) |
| `src/lib/disk-link.ts` | Pure path-link helpers (basename, extension, IDB record shape) |
| `src/lib/disk-tauri.ts` | Path-based open/save I/O (injectable boundary for tests) |
| `src-tauri/` | Tauri 2 native shell (window, dialogs, disk commands, file associations, menu) |
| `src/lib/ui/theme.svelte.ts` + `src/lib/theme.ts` | Light/dark/system theme - `themeStore` singleton applies `data-theme` + `meta theme-color`, follows the OS via matchMedia |
| `src/lib/workspaces.svelte.ts` | Workspaces store (named sessions of open tabs, Dexie v3 persistence) |
| `src/lib/spinner.svelte.ts` | Global spinner toast for long exports (PDF / HTML / ZIP) |
| `src/lib/broken-links.ts` | Pure testable helper: checks `FileSystemFileHandle`s (orphan / broken / permission-needed / ok) |
| `src/lib/fsa.ts` | File System Access API wrapper + handle persistence (separate `mdsh-fs` IDB), `listHandles` + `checkHandle` |
| `src/lib/stats.ts` | Word / char / line counting + "saved X ago" formatting |
| `src/lib/platform.ts` | Mac vs Win/Linux detection + `formatKbd('⌘N')` → `Ctrl+N` per platform |
| `src/lib/frontmatter.ts` | YAML front-matter parser (lazy `js-yaml`, fail-soft), `getTitle` / `getTags` |
| `src/lib/wiki-links.ts` | Pre-processes `[[Target]]` / `[[Target\|alias]]` → `<a class="wiki-link" data-mdsh-wiki>` |
| `src/lib/db.ts` | Dexie v4 schema - `drafts` (`id, updatedAt, order`), `trashed` (`id, trashedAt`), `workspaces` (`id, updatedAt`), `versions` (`id, draftId, createdAt, [draftId+createdAt]`), `templates` (`id, updatedAt`) |
| `src/lib/report.ts` | Centralized logging (`reportError`/`reportWarning`) → console + `notify` (never a silent `console.*` elsewhere; ESLint `no-console` rule) |
| `src/lib/services/backup.ts` | Full backup/restore of the JSON state (drafts+workspaces+templates), versioned, + encrypted variant |
| `src/lib/crypto.ts` | WebCrypto AES-GCM + PBKDF2 encryption - used by encrypted backups (at-rest encryption of all drafts: deferred, see ROADMAP.md) |
| `src/lib/version-history.ts` | Throttled local snapshots + purge (N/30d) + lightweight diff |
| `src/lib/templates.ts` + `src/lib/templates.svelte.ts` | Document templates (dated builtins + custom), `templatesStore` |
| `src/lib/replace.ts` | Pure cross-file replace (case / whole-word / regex, backrefs) |
| `src/lib/graph.ts` + `src/lib/components/GraphPanel.svelte` | Link graph - in-house force-directed layout + SVG rendering |
| `src/lib/slides.ts` + `src/lib/components/PresentationView.svelte` | Presentation mode: splits on `---` + fullscreen slides |
| `src/lib/services/clipboard.ts` | Copy as Markdown / rich HTML |
| `src/lib/services/export.ts` | Pure export service (md / HTML / PDF / ZIP via lazy `jszip`) |
| `src/lib/render/markdown.ts` | md → HTML rendering (marked + KaTeX math + highlight.js + Mermaid + DOMPurify), all lazy-loaded |
| `src/lib/render/print.ts` | Builds the print-ready HTML doc + printing via a hidden iframe |
| `src/lib/milkdown-mermaid-preview.ts` | `CodeBlockConfig.renderPreview` hook → live Mermaid SVG inside the WYSIWYG editor |
| `src/lib/components/Editor.svelte` | Milkdown Crepe wrapper (cancellation token) + Mermaid live-preview `featureConfigs` |
| `src/lib/components/SourceEditor.svelte` | CodeMirror 6 source mode (markdown highlight, history, search panel, typewriter mode via `Compartment`) |
| `src/lib/components/ReadView.svelte` | Reading mode + wiki-links click handler + article ref for the TOC |
| `src/lib/components/EditorPane.svelte` | Main editing pane: 3-mode switch + resize handle + drag overlay + lazy-loaded TOC |
| `src/lib/components/Modals.svelte` | Mounting of the lazy-loaded modals (`{#if open}{#await loadXxx() then Cmp}`) - no static modal import (bundle constraint) |
| `src/lib/components/Toasts.svelte` | Renders the toasts from the `notify` store (top-center), `role="alert"` (errors) / `role="status"` (success/info) |
| `src/lib/components/PromptModal.svelte` | Reusable prompt/confirm modal (dark-mode, focus trap, SR), mounted as a singleton in `+page.svelte`, reads `promptStore` |
| `src/lib/components/Toc.svelte` | Floating table of contents (reading mode, `IntersectionObserver` scrollspy) |
| `src/lib/components/Sidebar.svelte` | Tabs + drag-reorder + multi-selection + tag chips + backlinks + broken-link badge |
| `src/lib/components/Toolbar.svelte` | Modes + export + palette + save-to-disk |
| `src/lib/components/StatusBar.svelte` | Counters + save indicator |
| `src/lib/components/Toast.svelte` | Undo-close toast (5 s) |
| `src/lib/components/SpinnerToast.svelte` | Persistent spinner toast for long exports |
| `src/lib/components/CommandPalette.svelte` | `⌘⇧P` palette (all actions, including dynamic workspaces) |
| `src/lib/components/SearchPanel.svelte` | `⌘⇧F` cross-file search |
| `src/lib/components/DiskLinksPanel.svelte` | "Disk links" modal: ✓ / ⚠ / ✗ statuses + unlink |
| `src/lib/components/WorkspacesPanel.svelte` | "Workspaces" modal: load / update / rename / delete |
| `src/lib/components/SettingsPanel.svelte` | Centralized settings: theme, language, width, display, backup (⌘,) |
| `src/lib/components/VersionHistoryPanel.svelte` | Version history + restore |
| `src/lib/components/Welcome.svelte` | Welcome screen when no file is open |
| `src/lib/a11y/focusTrap.ts` | Svelte `use:focusTrap` action for the modals |
| `src/lib/milkdown.css` | Editor style overrides (dark theme) + Mermaid preview styles |
| `src/lib/render/preview.css` | `.mdsh-preview` styles (reading mode) + `.mdsh-frontmatter` + `.wiki-link` |
| `src/lib/styles/prose-base.css` | Shared typography rules (headings, lists, code, tables) |
| `src/app.css` | Tailwind tokens + `--bg`, `--fg`, `--accent` variables + `prefers-*` media queries |
| `src/app.html` | PWA meta + Open Graph / Twitter card (the CSP is NOT here: it is emitted by SvelteKit in `hash` mode from `svelte.config.js` → `kit.csp`) |
| `static/katex/` | KaTeX CSS + woff2 fonts (served at print time for math rendering) |
| `static/print/print.css` | Light A4 stylesheet for PDF and HTML export |

## Tests

- **Unit** (Vitest, jsdom): `src/**/*.{test,spec}.ts` - config `vitest.config.ts`, setup `src/lib/test-setup.ts` (which forces the locale to French and polyfills `localStorage`), `$app/environment` and `$app/paths` aliases mocked. jsdom uses a non-opaque URL so `localStorage` is available. The coverage `include` targets the logic surface (`src/lib/**/*.ts` + `.svelte.ts`); `.svelte` components are covered by e2e and targeted component tests, not the unit threshold.
- **i18n**: `src/lib/i18n/i18n.test.ts` verifies en/fr key parity and the English default (it re-sets the locale to `'en'`), plus the pure `locale.ts` logic (`detectLocale`, `isLocale`, `interpolate`).
- **E2E** (Playwright, chromium): `e2e/*.spec.ts` - config `playwright.config.ts`, shared helpers in `e2e/helpers.ts`.
- **Visual snapshots**: `e2e/visual.spec.ts-snapshots/` - platform-sensitive (Linux ≠ macOS), both baselines versioned (`*-chromium-linux.png`, `*-chromium-darwin.png`), deliberately skipped in CI (see CONTRIBUTING.md).
- **E2E a11y**: `e2e/a11y.spec.ts` - informational, non-blocking.
- **WebKit**: the `webkit` project runs only `golden-path.spec.ts` (basic persistence flow). The FSA specs (`drop-image`, `export`, `disk-links`, etc.) are skipped outside Chromium - the File System Access API is unsupported in WebKit/Safari.

## Design limits (deliberate)

Deliberate decisions - do not "fix" them without context.

- **Bilingual UI (English default + French).** All user-facing strings go through the i18n layer (`src/lib/i18n/`): English is the default locale, French is auto-detected from the browser and switchable in Settings. Both dictionaries (`messages/en.ts`, `messages/fr.ts`) must define exactly the same keys; plurals use the parenthetical "(s)" form in both locales. Adding a third locale is a dedicated task, not currently planned.
- **Storage = IndexedDB, hardened best-effort.** No backend. Write failures are surfaced to the user via the `notify` store (`src/lib/notify.svelte.ts`), the quota is monitored, and persistent storage is requested at boot (`src/lib/storage.ts`). **Never re-swallow an IDB error in a silent `console.error`** - route it to `reportPersistenceError`.
- **Scales to ~ a few hundred files.** `allTags` rebuilds a sorted `Set` on every access (O(N) over the file count) but front-matter parsing is memoized by `MetaIndex`: on each keystroke, only the modified file is re-parsed (the residual cost - rebuilding the `Set` + `sort` - is negligible at the target ceiling). The search worker, however, serializes the whole corpus per query. Comfortable up to ~200-300 files; beyond that, pre-index `filesByTag` and switch the worker to incremental/delta sync (not done - outside the target use case).

## Pitfalls

- Milkdown Crepe must be instantiated in `onMount` (DOM required).
- `lucide-svelte` 1.0.1 has a breaking icon-API change - version pinned.
- PWA cache: any change to `static/` or the manifest requires a rebuild + clearing the browser cache.
- `--legacy-peer-deps` is required, otherwise Milkdown resolution breaks.
- Any code touching `window` / `document` / `localStorage` must be guarded by `if (browser)` or placed in `onMount`.
- PDF export: the print iframe inherits the parent origin - it loads `${base}/katex/katex.min.css` + `${base}/print/print.css`. If you modify `static/katex/` or `static/print/`, you must rebuild.
- The heavy rendering/export libraries stay **out of the initial bundle** because their carrier modules are themselves always reached lazily (`await import(...)`): `render/markdown.ts` (which imports `marked` / `katex` / `highlight.js` statically - acceptable because this module is never in the boot graph - and `mermaid` / `dompurify` via `import()`), `services/export.ts` (`jszip` via `import()`), and `frontmatter.ts` (`js-yaml` via `import()`). Rule: **never import these deps from the boot graph** (`+page.svelte`, stores, etc.), otherwise they fall into the initial bundle and out of the precache (see `vite.config.ts`). Invariant enforced by the ESLint `no-restricted-imports` rule (disabled only in the dedicated lazy modules). See also ARCHITECTURE.md.

## Debugging recipes

### Reset the PWA cache (the service worker caches stale content)

1. DevTools → Application → Storage → Clear site data
2. Or via CLI: DevTools → Application → Service Workers → Unregister
3. Reload without cache: `Cmd+Shift+R` / `Ctrl+Shift+R`
4. If nothing works: Application → IndexedDB → delete both the `mdsh-fs` AND `mdsh` databases, then reload

### Testing FSA over HTTP (without HTTPS)

The File System Access API requires a secure context. In dev, `localhost` is treated as secure → it works natively. On a remote host over HTTP:

```sh
# Chrome with a local exception
google-chrome --unsafely-treat-insecure-origin-as-secure="http://192.168.x.x:5173" --user-data-dir=/tmp/dev-chrome
```

NEVER do this on your main browser (it temporarily downgrades all of the domain's protections).

### Dev server won't start

Symptom: `vite dev` crashes with a Milkdown / peer-deps error.
Cause: `--legacy-peer-deps` was not applied (corrupted lock file).

```sh
rm -rf node_modules package-lock.json .svelte-kit
npm install --legacy-peer-deps
npm run dev
```

### Prod build fails but dev works

Often: a CodeMirror / Milkdown / Mermaid module declared as `import type` that becomes a runtime import in a patch release. Inspect:

```sh
# Visualize the prod bundle
npm run analyze
```

Or check the initial chunks: `ls -la build/_app/immutable/entry/` then `grep "from\"" build/_app/immutable/entry/*.js` - if an unexpected chunk appears, a static import has leaked.

### Flaky E2E tests in CI

Playwright tests pass locally but fail in CI:

1. `npx playwright test --ignore-snapshots --grep-invert "Snapshots visuels"` isolates whether a visual snapshot mismatch is the cause (platform-sensitive - Linux ≠ macOS)
2. If it is, regenerate the Linux baseline via the official Playwright Docker image (see CONTRIBUTING.md) before committing
3. Slow dev server? Increase `expect(...).toPass({ timeout: 10_000 })`

### Mermaid doesn't render in reading mode

1. Check the console: `[mdsh] mermaid` or an import error
2. The block must be ` ```mermaid` (not `mermaidjs`, no leading spaces)
3. The content must be valid (see https://mermaid.live)
4. On a parse error, the output shows a `<div class="mermaid-error">` block with the message - that is expected

### YAML front-matter ignored

1. The block must start on the **first line** of the file (no blank line before)
2. Strict format: `---\n...YAML...\n---\n` then the content
3. Invalid YAML → logs `[mdsh] front-matter YAML invalide, ignoré : ...` in the console
4. Test with a simple YAML: `title: foo` then `tags: [a, b]`

# Test policy and evidence

Use E2E tests as the preferred verification method. Test observable results through
the application. For a complex change, write the workflow and its failure cases
before implementation. Never write unit tests after implementation.

If isolated tests are necessary, first record all identified failure risks. Explain
which risk each test detects and why the browser suite cannot detect it. Do not add
tests only to increase coverage. Do not test dependency internals, type contracts,
constant values, or mocked call sequences alone.

## Retained isolated risks

The test review removed duplicate creation, selection, rendering, export, and
preference tests. Browser workflows verify those results. The remaining isolated
tests cover these additional risks:

| Area | Failure risks absent from the browser suite |
| --- | --- |
| Saves, trash, history, and workspaces | Write ordering, concurrent variants, rollback, history retention, invalid records, and failed durability barriers. |
| Native and browser disk access | Revoked permissions, stale capabilities, changed revisions, interrupted reads, rename rollback, and restart recovery. |
| Backup, crypto, and export | Malformed backups, linked ID remapping, authentication failure, invalid crypto parameters, name collisions, and cancellation cleanup. |
| Markdown, search, and media | Hostile CSS and SVG, parser time limits, code and YAML boundaries, Unicode matching, unsafe regexes, invalid images, and resource limits. |
| UI coordination | Competing prompts, rejected lazy imports, stale search results, worker timeouts, failed preference writes, and keyboard composition. |
| Release scripts and budgets | Incorrect checksums, missing installers, source identity, SBOM patch provenance, changelog boundaries, and shared-chunk accounting. |
| Native Rust code | Symlink substitution, persisted grants, file replacement, close ordering, and the GLib iterator security regression. |

Remove an isolated case when a reliable E2E test covers the same risk. Keep the
reason for each remaining case clear in its test name. `npm run test:coverage`
still reports coverage for diagnosis. No percentage target requires extra tests.

## Repeat the browser suite

### Durability and resource pressure risks

- A process kill before the 400 ms timer can lose the in-memory revision. An
  unload event is not a durability barrier. Record the last committed revision
  separately from the text that existed only in the editor.
- A kill during an IndexedDB transaction must retain the previous committed
  data. A completed backup or workspace barrier must survive a process restart.
- Concurrent saves must retain both branches, including the closed conflict
  copy. A failed conflict write must not replace the original draft.
- Large libraries can fill storage through drafts, history, and trash. Record
  both logical bytes and the browser storage estimate. A quota error must keep
  the save status in error and roll back the whole backup replacement.
- An export can stop at consent, media fetch, image decoding, stylesheet loading,
  or the native dialog. Cancellation must remove progress UI and print DOM,
  preserve edits and the dirty indicator, and permit the next export.
- An external process can replace, rename, or substitute a selected disk path
  while a save is staged. Native permission revocation must serialize with file
  writes. Check actual filesystem contents and retain each result.
- PDF inspection can exceed its deadline through per-pixel AppKit allocations.
  Keep all page images and pixel assertions, with a measured inspection budget.

These workflows use real browser processes, IndexedDB, and the native WebView.
Test-only gates select interruption points. They do not report simulated
filesystem or quota errors as native evidence.

### Durability and resource pressure evidence

Run the focused browser workflows with one worker:

```sh
npm run test:e2e -- abrupt-exit.spec.ts storage-pressure.spec.ts export-cancellation.spec.ts --project=chromium --workers=1
```

| Workflow | Observable result and artifact |
| --- | --- |
| `abrupt-exit.spec.ts` | SIGKILL before debounce, during a live transaction, and after backup, workspace, and conflict writes. The same profile reopens. `abrupt-exit.json` records process IDs, signals, before/after rows, lost memory-only text, and recoverable history. The backup case also retains its downloaded JSON. |
| `storage-pressure.spec.ts` | A seeded xorshift32 corpus has 300 drafts of 32 KiB, 9,000 history rows of about 2 KiB, and 100 trash entries. `storage-pressure.json` records timestamps, table counts, logical bytes, SHA-256 values, and Chromium usage/quota measurements. A real quota override rejects a save and replacement restore. Retry succeeds when quota returns. |
| `export-cancellation.spec.ts` | Cancel consent, a held image response, image decoding, CSS, fonts, and browser print preparation. Each case keeps the draft and dirty marker, removes progress within two seconds, and downloads a subsequent HTML export. |

The crash workflow delays only the save timer or holds a real IndexedDB
transaction at a known point. The transaction and conflict cases request a
flush first. SIGKILL itself does not run an unload handler.
It tests browser-process loss, not device power loss or deletion of a profile.
The quota workflow waits 32 seconds for Chromium's bucket-space cache before
each constrained write. This avoids filling the host disk. The decoder workflow
holds the real bitmap operation until cancellation, then releases it to check
that a late result cannot trigger a download.

For native evidence, build and run in sequence:

```sh
CARGO_BUILD_JOBS=2 BASE_PATH='' npm run tauri -- build --debug --features native-smoke --no-bundle --config src-tauri/tauri.smoke.conf.json
node scripts/native-smoke.mjs
```

`disk-races.json` records actual file replacement, external rename, native rename,
symlink substitution on Unix, and permission revocation before a pending write.
Test-only gates wait at most 15 seconds and are absent from normal builds.
On macOS, the runner cancels the actual Markdown, ZIP, HTML, and print panels
through AppKit. The result includes editor content and dirty state. A later
native print operation must produce a complete PDF.

The macOS runner compiles the PDF inspector once with `swiftc -O` (60 second
compile limit). It inspects two separate product exports. Each inspection has
a 20 second internal budget and a 30 second process deadline on both Apple
Silicon and Intel CI runners. The inspector renders every page to a 595 by 842
RGBA bitmap, counts both colored image bands, and checks A4 dimensions and the
final paragraph. It retains both PDFs, all PNG pages, extracted text, per-page
timings, and `native-pdf-inspection.json`, including under `repeated-pdf/`.
The parent `results.json` records source, environment, binary hash, and command.

Browser consent checks replace two isolated tests that asserted mocked export
calls. Native panel checks replace the old assumption that a frontend abort can
remove print content while an AppKit panel remains open. Isolated printer-error
and invalid-stylesheet checks remain because these workflows do not cause those
failures through the operating system.

### Image layout and native export risks

- Embedded image data can fill the source editor. Hide the payload with a keyboard-accessible
  control. Editing, undo, mode changes, reload, and Markdown export must preserve the bytes.
- A fixed image height can crop pixels when the PDF width guide or window becomes narrower.
  Check wide and tall images, image resize handles, and the saved scale.
- An image taller than the printable A4 area can cross a page boundary. Check its aspect ratio
  and the actual PDF, including the first and last rows of pixels.
- WebKit can display SVG while `createImageBitmap` rejects it. Use the native image decoder
  as a fallback and retain the image limits and sanitization.
- JavaScript `window.print()` can do nothing in WKWebView. The macOS test must use the product's
  native print operation and save a real PDF. A WebDriver screen capture is not equivalent.
- Native print cancellation, asset failure, repeated export, and a long-running dialog must
  restore the editor without deleting the print content before the operation completes.
- Replacing the macOS application menu can remove Hide, Services, Minimize, and Full Screen.
  Native edit commands must reach the active editor, including Undo and Redo. Application
  shortcuts must execute once and respect user overrides.
- Installer renaming can cause collisions or incorrect checksums. Keep architecture checks
  before collection and calculate checksums from the final published names.
- Presentation separators must stay inside code fences until a matching closing fence.
- An initial horizontal rule without a closing YAML marker must not hide source headings.
- An hourly service worker update can fail offline. Editing must remain usable without an
  unhandled rejection.
- Selection ZIP export must keep the content snapshot taken when the command starts.
- System theme changes must refresh diagram colors without replacing editor history.
- Reading mode must restore list markers removed by the global CSS reset. Check nested
  bullets, ordered-list start values, and task lists without duplicate markers.
- A Safari-compatible user agent can report a Linux keyboard platform. Prefer the platform
  for shortcut labels and keep native Control-only handling inside Desktop.

Run `npm run test:e2e -- image-layout.spec.ts` for image payload and layout checks.
Run the native build command from `.github/workflows/desktop.yml`, then
`node scripts/native-smoke.mjs`. On macOS, `native-test-results/native.pdf` comes from
the same native print operation as the application. The test supplies a save destination
instead of a print panel. PDFKit checks A4 pages, the final paragraph, and both colored
image borders on one page. It writes page images and `native-pdf-inspection.json`.
Native menu checks inspect shortcut bindings and execute the associated AppKit actions.
Reports include the command, source SHA, working diff identity, binary hash, environment,
fixture, and results.

Use the Node version from `.node-version` and the committed lockfile:

```sh
npm ci --legacy-peer-deps
npx playwright install --with-deps chromium firefox webkit
npx playwright test --ignore-snapshots --grep-invert "Snapshots visuels"
```

Playwright builds the application and starts a new preview server. Each workflow
uses a fresh browser context. Test helpers reset local data. Visual snapshots are
local-only, as specified in [CONTRIBUTING.md](../CONTRIBUTING.md#visual-tests-snapshots).

On a Linux host without a display, prefix the browser command with `xvfb-run -a`.
The scrollbar tests use headed Firefox because its headless mode hides native
scrollbars. CI supplies a virtual display for the same checks.

For the bulk deletion, PDF width, scrollbar, and heading-command workflows:

```sh
npm run test:e2e -- bulk-delete.spec.ts editor-width.spec.ts slash-commands.spec.ts
```

## Verify the artifacts

Every browser run produces:

- `playwright-report/index.html`: test results, steps, attachments, and Git metadata.
- `test-results/results.json`: machine-readable results, project settings, source metadata, and timing.
- `test-results/`: failed-test screenshots and traces, plus workflow attachments.
  The PDF width test attaches the actual A4 PDF that it measures.
  Cross-tab tests attach saved document and active-view evidence. Scrollbar tests
  attach screenshots and measured drag positions.

Open the HTML report with `npx playwright show-report playwright-report`. Inspect a
failed trace with `npx playwright show-trace <trace.zip>`. Use the report's file,
test title, and browser project to repeat one case with `--project` and `--grep`.

CI uploads `playwright-report` on success and failure and keeps it for 14 days.
The artifact belongs to the workflow run and its source commit. Compare that
commit with the release tag before using the results as release evidence.
Native WebView runs also upload `native-smoke-<platform>` artifacts.

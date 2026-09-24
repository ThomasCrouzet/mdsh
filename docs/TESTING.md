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

# Contributing to mdsh

mdsh is a **solo-maintained, deliberately scoped, local-first** project. Contributions are welcome, while the offline and privacy boundaries remain intentionally narrow.

**Welcome:**

- Bug fixes (with a clear repro).
- Accessibility improvements (contrast, keyboard, screen readers, `prefers-reduced-motion`).
- Performance gains / bundle reduction (the `size-limit` budget is a hard gate).
- Documentation, typo, and consistency fixes.
- Translations: adding or fixing message strings in the i18n layer (`src/lib/i18n`, `en` and `fr` dictionaries) is welcome, as are new locales if you are willing to maintain them.

**Out of scope (unless discussed first):**

- Anything that adds a backend, an account, cloud sync, or telemetry.
- Heavy new features that broaden the tool's reach.

For a large PR or a feature, **open an issue first**: it is better to confirm the direction before investing time.

## Setup

```sh
npm install --legacy-peer-deps   # required (Milkdown peer deps)
npm run dev
```

Node **22+** required (`package.json` `engines.node`). CI uses Node 22. `pnpm`/`yarn` untested.

Desktop development also needs Rust 1.97.1. Linux packaging uses `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and `patchelf`. The exact Rust toolchain is in `rust-toolchain.toml`; `package-lock.json` and `src-tauri/Cargo.lock` are required inputs. Builds are not claimed to be bit-for-bit reproducible.

## Conventions

- **Language** : docs and identifiers (variables, functions, files, classes) in English. Code comments are historically a mix of French and English; either is accepted, match the file you are editing.
- **UI strings** : all user-facing text goes through the i18n layer (`src/lib/i18n`, with `en` and `fr` message dictionaries). English is the default locale; French is auto-detected from the browser on first launch and switchable in Settings. Never hard-code UI strings - add a message key to both dictionaries.
- **Svelte 5 runes required** (`$state`, `$derived`, `$effect`, `$props`) - no `$:` and no reactive `let`.
- **TypeScript strict**, `checkJs` enabled.
- **Tailwind 4**, dark by default + light / system theme (cf. `theme.ts`, `data-theme` attribute). Every color goes through the tokens (`--bg`, `--fg`, `--accent`…), never hard-coded, so it stays valid in both themes. No `text-align: justify` (WCAG 1.4.8).
- **Offline-first** : system fonts and no app-initiated network request by default. Remote document images require explicit consent. The heavy libs (`marked`, `katex`, `highlight.js`, `mermaid`, `jszip`, `js-yaml`) are imported **dynamically** - never statically.
- **Browser guards** : any access to `window`/`document`/`localStorage`/`IndexedDB` must be inside `onMount` or guarded by `if (browser)`.
- **A11y** : contrast ≥ 4.5:1 (text) / 3:1 (UI), `aria-label` on icon-only buttons, full keyboard navigation.

Additional conventions (module map, pitfalls, debugging recipes): see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Workflow

1. Fork + branch from `main`
2. Before pushing : `npm run check && npm run lint && npm test && npm run build`
3. For visual PRs : test in the browser (golden path + edge cases + focus mode + mobile DevTools)
4. Open a PR against `main`. CI runs check, lint, tests, builds, accessibility audits, dependency review, security scans, and Lighthouse. Dependabot PRs are merged manually after the required checks so the normal post-merge deployment path always runs.

lefthook hooks installed via `npm install` : `pre-commit` (prettier + eslint on staged) and `pre-push` (check + tests).

## Visual tests (snapshots)

The Playwright snapshots (`e2e/visual.spec.ts`) are **local-only by design** - not a CI gate (`--ignore-snapshots --grep-invert "Snapshots visuels"` in `deploy.yml`). A Linux baseline generated via the official Playwright Docker image diverges enough from the fixed GitHub runner's font rendering to fail unrelated PRs. Linux and macOS baselines remain versioned for local comparison only. See `ROADMAP.md` for the policy rationale.

To compare locally against your platform's own baseline :

```sh
npm run test:e2e -- visual.spec.ts
```

To regenerate the **Linux** baseline (for local reference, not currently CI-enforced) :

```sh
docker run --rm -v "$(pwd)":/work -w /work --ipc=host \
  mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e \
  bash -c "npm ci --legacy-peer-deps && npm run build && npx playwright test visual.spec.ts --project=chromium --update-snapshots"
```

The digest above is the multi-platform manifest for `v1.62.1-noble`, matching the exact `@playwright/test` version in `package.json`. To regenerate the **macOS** baselines:

```sh
npm run test:e2e -- visual.spec.ts --update-snapshots
```

Do not commit snapshots from a platform other than the two already versioned (Linux CI baseline, macOS local baseline) without agreement.

## Issues

[Bugs / features](https://github.com/ThomasCrouzet/mdsh/issues). For a large PR, open an issue before coding.

## License

MIT - by contributing, you agree that your code is published under this license.

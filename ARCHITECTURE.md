# Architecture

This is not an exhaustive module reference (see the module map in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for that). It is a short case study of
the decisions that shaped mdsh - the ones that would otherwise stay invisible in
a repo a visitor skims for sixty seconds.

## Offline-first without a backend

mdsh has no server. Every document lives in the browser: drafts in IndexedDB via
Dexie, in-place disk editing through the File System Access API, exports as plain
files. That constraint is the whole point of the project (see the README), but it
also means the PWA has to be _actually_ offline-capable on day one, not "offline
after you've visited once."

That guarantee broke silently during the pre-1.0 hardening pass. The precache
manifest transform (`vite.config.ts`) rewrites Workbox's build-output URLs into
the URLs the browser actually requests, and the SPA fallback entry was keyed to
the base path _without_ a trailing slash (`/mdsh` instead of `/mdsh/`). A fresh
install's navigation request for `/mdsh/` never matched that precache key, so
`navigateFallback` found nothing and the app served a blank shell offline - and
on an empty base path, the broken transform produced an empty precache outright.
The bug was invisible in the common case (the browser had already cached the
page from a prior online visit) and only showed up on a true first-launch,
never-online install. It surfaced when a dedicated e2e test (`e2e/pwa.spec.ts`)
was written specifically to simulate that path: kill the network, load fresh,
assert the shell renders. The fix was one line - align the fallback key with the
served URL - but the lesson generalizes: for an offline-first app, "works when
online" and "works offline" are different claims, and only the second one is
testable by actually cutting the network in CI.

## The bundle budget as a design constraint

The initial JS entry is capped at 12 KB gzipped, the boot page chunk at 60 KB,
CSS at 120 KB (`.size-limit.json`) - enforced as a blocking CI gate, not a
guideline. mdsh renders markdown with `marked`, math with KaTeX, syntax
highlighting with `highlight.js`, diagrams with Mermaid, exports through
`jszip`, and parses YAML front-matter with `js-yaml`. None of that can be in
the boot graph and stay under budget.

La règle conserve chaque moteur derrière un `import()` dynamique depuis
`render/markdown.ts`, `services/export.ts` ou `frontmatter.ts`. Le cache PWA
contient pourtant tous ces chunks révisionnés: le démarrage hors ligne peut donc
charger le moteur demandé sans le réseau, tout en laissant le graphe initial
léger. Un import statique depuis `+page.svelte`, un store ou un composant monté au
démarrage augmenterait le coût initial. ESLint bloque cette fuite et
`scripts/bundle-graph.mjs` mesure les fermetures transitives des graphes de
démarrage, lecture, source et WYSIWYG. Le budget vérifie ainsi ce que charge
chaque parcours, sans compter plusieurs fois un chunk partagé.

## A facade store over pure, testable modules

`files.svelte.ts` is the file store the rest of the app talks to, and Svelte 5's
rules require the `$state` it holds to live in a single class - runes cannot be
extracted into a plain module and re-imported. That constraint pushes toward
putting _all_ logic in that one file, which does not scale: by the time mdsh had
exports, disk sync, tagging, search indexing, a save queue, and a trash bin, a
monolithic store would mean no unit could be tested without booting the whole
class and mocking `$state`.

The store is a thin facade instead. It owns the reactive state and wires
together pure modules that hold the actual logic: `export-ops` for md/HTML/PDF/ZIP
exports, `disk-sync` for the File System Access API, `meta-index` for the
tag/backlink/title index, `save-queue` for the debounced Dexie writes, `trash`
for the trash bin. Each module is a plain class or function set, constructed
with callbacks back into the store rather than a reference to it - `meta-index`
takes a `() => FileItem[]` accessor, `save-queue` takes `onSaved` / `onError`
callbacks. The practical payoff: `save-queue.test.ts` and `meta-index.test.ts`
exercise their logic directly, with no store, no DOM, no Svelte runtime - and an
IndexedDB write failure surfaces through an explicit `onError` callback instead
of disappearing into a silent `console.error` inside the store.

## An in-house bilingual layer instead of a library

mdsh ships two locales (English default, French auto-detected from the browser,
switchable in Settings) through a small runes-based layer in `src/lib/i18n/`
rather than an i18n library. The reasoning: `en.ts` is `satisfies Record<string, string>`
and is the source of truth for the `MessageKey` type; `fr.ts` is typed against
that same `MessageKey`, so a key present in one dictionary and missing in the
other is a TypeScript error, not a runtime fallback to the wrong language. A
dedicated test (`i18n.test.ts`) additionally checks key parity and the English
default at the value level, which the type system alone cannot guarantee (it
proves the keys line up, not that nobody left a key's value empty). For two
locales with an app of this size, that was less code and a stricter guarantee
than pulling in a general-purpose i18n library and configuring it to enforce
the same thing.

## Durability is a state transition, not a timer

The 400 ms save debounce is an optimization, not proof that content is durable. `SaveQueue` serializes writes per document and records a rejected IndexedDB revision as a durability failure. `flushAwait()` retries failed rows and rejects while any in-memory revision is not represented in IndexedDB. Backup export, restore, and workspace replacement stop at that barrier. The UI reports the error without converting it into a successful save.

Visibility, page-hide, and before-unload events trigger an immediate flush to reduce the residual recovery point. They cannot guarantee execution after a browser or operating-system kill. External backup remains the recovery mechanism for loss of the browser profile.

## Native file access uses session capabilities

The Desktop Beta does not accept JavaScript paths for file commands. A Rust-owned picker or operating-system open event canonicalizes the path and returns an opaque session token. The capability store retains the path and permissions; IndexedDB records cannot recreate a grant after restart.

Native writes stage data in the target directory, synchronize it, compare a SHA-256 content revision immediately before replacement, preserve permissions, and then use the platform replacement primitive. This prevents a same-size, same-timestamp external edit from being overwritten silently and keeps the original intact if staging fails.

## Budget de corpus mesuré

Les tests de logique construisent des corpus de 50, 200 et 300 documents, puis
mesurent l'index de métadonnées et la recherche. Une mesure navigateur séparée,
réalisée sur Mac mini M4 avec Chromium et un document de 50 000 caractères,
observe 183 à 205 ms pour la recherche sur 200 et 300 notes, 119 ms pour le
premier passage en WYSIWYG, puis 85 à 88 ms. La frappe mesure 25 ms en médiane et
34 ms au 95e centile. Ces chiffres servent de référence sur cette machine. Les
budgets CI, volontairement plus larges, restent des alarmes de régression et ne
constituent pas une promesse pour tous les appareils.

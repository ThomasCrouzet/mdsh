# AGENTS.md - mdsh

## Scope

Keep this Markdown PWA offline, private, and on the client. Do not add a required backend, telemetry, network request, or cloud storage.

## Rules

- Use Svelte 5 runes and strict TypeScript.
- Check browser API availability before access to `localStorage` or IndexedDB.
- Save drafts with Dexie. Keep the 400 ms save delay. Report write failures.
- Use i18n for interface text. Keep English as the default and French as an option.
- Write project documentation, comments, docstrings, and new commit text in English with ASD-STE100 rules and vocabulary.
- Keep translation catalogs and their keys. Preserve licenses, external quotations, and generated files.
- Do not use U+2014 or U+2013 in controlled content. Do not add automated attribution.

## Tests

- Never write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, first write down all the ways it could fail, then write the code.
- Keep an isolated test only when it detects a concrete failure that the E2E suite does not detect. Do not test library behavior, type contracts, or mocked call sequences alone.
- Use `docs/TESTING.md` for the retained failure risks, browser commands, and report artifacts.

## Commands

```bash
npm run dev
npm run check
npm run lint
npm run test
npm run build
npm run test:e2e       # For a changed browser workflow.
```

Start with the applicable check. Use the full suite for shared state, storage, export, PWA, or release changes.

## References by task

- Product scope, supported browsers, and limits: `README.md`.
- Contribution and writing rules: `CONTRIBUTING.md`.
- Modules, storage, export, and PWA: `.codex/references/project-map.md`.
- Architecture decisions: `ARCHITECTURE.md`.

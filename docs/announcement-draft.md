# Announcement draft (not posted)

Copy-ready blurbs for when you choose to announce mdsh. Edit the links if the
repo path changes. Do **not** post until CI is green and [SECURITY.md](../SECURITY.md)
is on `main`.

## One-liner

**mdsh** - a local-first WYSIWYG markdown workspace that never phones home.
Offline PWA, no account, no telemetry. https://thomascrouzet.github.io/mdsh/

## Show HN

**Title:** Show HN: mdsh - offline WYSIWYG markdown editor (no server, no account)

**Body (short):**

I built mdsh because I wanted a markdown workspace that stays in the browser:
WYSIWYG (Milkdown), source (CodeMirror), reading mode, wiki-links + backlinks,
link graph, encrypted backups, and exports (md / HTML / PDF / ZIP) - all
client-side, installable as a PWA, with a hard bundle budget and a strict CSP.

- Live demo: https://thomascrouzet.github.io/mdsh/
- Source: https://github.com/ThomasCrouzet/mdsh
- How it is built: https://github.com/ThomasCrouzet/mdsh/blob/main/ARCHITECTURE.md

Happy to answer questions about the offline-first choices (IndexedDB, File
System Access API, no backend).

## r/sveltejs

**Title:** mdsh - local-first markdown editor in SvelteKit 2 + Svelte 5 runes

Same links as above. Mention: Svelte 5 runes store facade, pure modules for
exports/trash/meta-index, i18n en/fr without a heavy library, size-limit gate
on the entry chunk.

## Awesome-list blurb

`mdsh` - Offline-first WYSIWYG markdown editor (SvelteKit PWA). No backend, no
telemetry. https://github.com/ThomasCrouzet/mdsh

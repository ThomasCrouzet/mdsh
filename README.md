# `$ mdsh`

[![Deploy and tests](https://github.com/ThomasCrouzet/mdsh/actions/workflows/deploy.yml/badge.svg)](https://github.com/ThomasCrouzet/mdsh/actions/workflows/deploy.yml)
[![Security](https://github.com/ThomasCrouzet/mdsh/actions/workflows/security.yml/badge.svg)](https://github.com/ThomasCrouzet/mdsh/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**mdsh editor is a local-first, offline Markdown workspace.** Write in WYSIWYG, source, or reading mode without an account, backend, cloud sync, collaboration service, telemetry, or tracking.

[Try web app](https://thomascrouzet.github.io/mdsh/) | [Install PWA](docs/USER_GUIDE.md#install-the-pwa) | [Download Desktop Beta](https://github.com/ThomasCrouzet/mdsh/releases) | [User guide](docs/USER_GUIDE.md) | [Contribute](CONTRIBUTING.md)

The BLACKSITE interface uses graphite surfaces, warm ivory text, and restrained amber instrumentation. Light, dark, and system themes are available; system is the initial preference.

![WYSIWYG editing, source mode, the command palette, the link graph and a wiki-link click](docs/demo.gif)

## What it does

- Three editing modes: Milkdown WYSIWYG, CodeMirror source, and rendered reading view.
- GFM, code highlighting, KaTeX, Mermaid, YAML front matter, wiki links, backlinks, and a link graph.
- Local tabs, workspaces, version history, templates, trash, tags, search, and cross-file replace.
- Markdown, content-only PDF, self-contained offline HTML, and ZIP exports.
- Installable offline PWA with file and share intents where the browser supports them.
- Optional encrypted JSON backup using WebCrypto AES-GCM and PBKDF2.
- English and French interface.
- Documented keyboard support and release-blocking automated accessibility checks. These checks are not a WCAG certification or a substitute for a human audit.

## Browser and desktop support

| Capability | Chromium | Firefox | Safari / WebKit | Tauri Desktop Beta |
| --- | --- | --- | --- | --- |
| Edit, read, search, export | Tested | Golden path tested | Golden path tested | Same static application |
| Offline PWA shell | Tested | Browser-dependent install UX | Browser-dependent install UX | Bundled locally |
| Direct save back to an opened path | File System Access API | Download fallback | Download fallback | Native capability token |
| Remote Markdown images | Blocked until explicit per-document consent | Same | Same | Same |
| Native installers | Not applicable | Not applicable | Not applicable | Unsigned beta, OS warnings may appear |

Desktop downloads are published separately as prerelease Desktop Beta artifacts. They are not notarized on macOS or signed for Windows. Each beta release includes checksums, npm and Cargo SBOMs, and build provenance. Verify those files before installation.

## Local data and backups

Drafts are saved to IndexedDB after a 400 ms debounce. A failed write remains visible and blocks backup, restore, workspace replacement, and other durability-sensitive actions. The app also flushes when the page becomes hidden, but no browser can guarantee the final keystrokes survive a process kill or device failure.

IndexedDB is still one local storage domain, not a backup. Export backups regularly from Settings. The JSON backup includes drafts, workspaces, and custom templates. It excludes trash, version history, browser file handles, and native path capabilities. See the [user guide](docs/USER_GUIDE.md#backups-and-storage-health).

## Privacy model

- The application has no backend, account, telemetry, cloud sync, or runtime CDN.
- User HTML is sanitized. CSS URLs are limited to validated local fragments.
- Remote Markdown images are placeholders until the user explicitly loads them for that document. Loading them reveals the client IP to their hosts, with no referrer sent.
- Drafts and preferences remain in browser storage unless the user exports or opens a file.
- See [SECURITY.md](SECURITY.md) for the browser and Desktop threat models.

## Shortcuts

On Windows and Linux, the displayed Command shortcuts become Control shortcuts.

| Shortcut | Action |
| --- | --- |
| `Cmd+N`, `Cmd+O`, `Cmd+S`, `Cmd+Shift+S` | New, open, export Markdown, save to disk |
| `Cmd+P`, `Cmd+,` | Export PDF, settings |
| `Cmd+E`, `Cmd+R`, `Cmd+/` | WYSIWYG, reading, source |
| `Cmd+B`, `Cmd+W`, `Cmd+Shift+.` | Sidebar, close tab, focus mode |
| `Cmd+Shift+P`, `Cmd+F`, `Cmd+Shift+F` | Palette, in-file search, cross-file search |

## Scope and limits

- No backend, account, cloud sync, collaboration, plugins, or telemetry.
- The in-memory corpus model targets about 200 to 300 documents. Larger corpora are outside the current performance target.
- Milkdown may normalize Markdown formatting during AST serialization. Use source mode when byte-for-byte formatting matters.
- Browser-generated print headers and footers, such as date, URL, title, and page number, are controlled by the browser print dialog. Disable them there for a content-only PDF.

## Development

```sh
npm ci --legacy-peer-deps
npm run dev
npm run check
npm run lint
npm test
npm run build
```

The stack is SvelteKit 2, Svelte 5 runes, strict TypeScript, Milkdown, CodeMirror, Dexie, Tailwind CSS, Vite PWA, and Tauri 2. Heavy rendering libraries remain behind dynamic imports and blocking bundle budgets.

Architecture decisions are documented in [ARCHITECTURE.md](ARCHITECTURE.md). Setup and contribution policy are in [CONTRIBUTING.md](CONTRIBUTING.md). Support is described in [SUPPORT.md](SUPPORT.md).

License: [MIT](LICENSE). Redistributed asset notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

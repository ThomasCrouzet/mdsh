# Security policy

mdsh editor is a local-first static PWA with an optional Tauri Desktop Beta shell. It has no application backend, account, cloud synchronization, or telemetry. Browser drafts live in IndexedDB.

## Supported versions

| Version | Support |
| --- | --- |
| Latest `1.x` release and `main` | Supported |
| Older tags | Best effort |

## Report a vulnerability privately

Do not open a public issue for a security-sensitive finding. Use [GitHub Private Vulnerability Reporting](https://github.com/ThomasCrouzet/mdsh/security/advisories/new). This is the private enforcement and conduct contact for this repository as well as the preferred security channel.

Include the version or commit, browser or operating system, reproduction steps, impact, and any planned disclosure. The solo maintainer aims to acknowledge a report within seven days on a best-effort basis. Disclosure timing is coordinated after a fix or an explicit risk decision.

## Browser threat model

In scope:

- script or markup injection through imported Markdown, reading mode, presentations, or exports;
- CSS or image requests that disclose network metadata without consent;
- a CSP or offline-shell bypass;
- silent IndexedDB loss, stale backups, or a false durability status;
- weaknesses in encrypted backup handling.

The renderer uses DOMPurify as a final sanitizer. CSS `url()` values from user content are accepted only for validated local SVG fragments. Remote image sources are removed by default and can be loaded only after an explicit per-document action. Loading them contacts third-party hosts and reveals the client IP, but the request uses a no-referrer policy. The project does not proxy images.

The production CSP blocks scripts, objects, forms, framing, and external connections. Inline styles remain necessary for the editor, KaTeX, and Mermaid. Mermaid runs in strict security mode. Standalone HTML exports contain no scripts or remote font dependencies.

## Desktop threat model

The Desktop Beta treats the WebView as potentially compromised. JavaScript cannot grant itself an arbitrary path. A native file picker or an operating-system file-open event canonicalizes an allowed path and creates an opaque, random, session-only capability token in Rust. Read, stat, and write commands accept that token rather than a path. Persisted browser records are not treated as native capabilities and require a fresh picker after restart.

Native file operations reject relative paths, parent traversal, unsupported extensions, and symlink substitutions. Writes use a same-directory temporary file, file synchronization, permission preservation, a final content-revision conflict check, atomic replacement, and directory synchronization where supported. An external edit requires an explicit user decision. Windows uses the native replace API for an existing target.

These boundaries reduce the impact of a WebView compromise but do not make an already compromised local operating-system account safe. Desktop installers remain unsigned beta artifacts until platform signing and notarization are available. There is no auto-update channel.

## Durability and backup limits

IndexedDB writes are debounced by 400 ms and flushed when the page becomes hidden, on page hide, and before relevant navigation. A rejected write makes the durability barrier fail closed and blocks backup, restore, and workspace replacement. A browser or device kill can still lose edits within the debounce window, and IndexedDB can be removed with browser profile data.

External backups include drafts, workspaces, and custom templates. They exclude trash, version history, File System Access handles, and Desktop capability tokens. Encrypted backups are unrecoverable without their passphrase.

## Supply chain

CI audits the complete npm tree and Cargo lockfile, reviews dependency changes, scans TypeScript and Rust with CodeQL, scans Git history for secrets, verifies third-party notices, and enforces tests and bundle budgets. Release builds run without write credentials. A separate final job publishes Desktop Beta artifacts with SHA-256 checksums, npm and Cargo SBOMs, and GitHub build provenance.

Security controls and scanners reduce risk; they are not a guarantee that every vulnerability has been found.

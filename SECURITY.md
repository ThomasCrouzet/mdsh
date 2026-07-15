# Security Policy

mdsh is a **local-first, client-side only** PWA: there is no application backend,
no accounts, and no telemetry. Drafts live in the browser (IndexedDB). That
shapes both the threat model and how to report issues.

## Supported versions

| Version | Supported |
| ------- | --------- |
| `1.x` (latest release / `main`) | Yes |
| Older tags | Best-effort only |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive findings.

1. Prefer **GitHub Private vulnerability reporting** on this repository
   (Security tab → Report a vulnerability), when enabled for the repo.
2. If that channel is unavailable, open a **draft GitHub Security Advisory**
   from the Security tab, or contact the maintainer via the email on their
   GitHub profile (use a clear subject such as `mdsh security`).

You can expect an initial acknowledgement within **7 days** on a best-effort
basis (solo maintainer). Please include:

- mdsh version or commit SHA, and browser / OS
- steps to reproduce
- impact (XSS, data loss, offline bypass, CSP bypass, etc.)
- whether a public write-up is planned

We will coordinate disclosure once a fix is available or the risk is accepted.

## Threat model (summary)

In scope examples:

- XSS or script injection via imported / rendered markdown (reading mode,
  presentation, exports)
- CSP bypass that enables remote script execution
- Silent data loss or corruption of IndexedDB drafts
- Offline shell failures that leave a blank installable PWA
- Weaknesses in encrypted backup (AES-GCM / PBKDF2) handling

Out of scope / accepted constraints:

- **No cloud sync**: there is no server-side multi-user isolation to break
- **File System Access API** behaviour outside Chromium
- Content the user deliberately pastes (images as data-URIs, remote image URLs
  allowed by `img-src` for markdown authoring)
- Supply-chain issues in transitive devDependencies that never ship to the
  static Pages build (tracked via Dependabot + `npm audit` on production deps
  in CI)

## Hardening already in place

- **CSP** emitted by SvelteKit in `hash` mode (`svelte.config.js`):
  `default-src 'self'`, `connect-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`, `form-action 'none'`. See below for deliberate
  relaxations.
- **DOMPurify** on all markdown → HTML paths (`src/lib/render/markdown.ts`),
  including stripping hostile `url(...)` values inside inline `style`
  (KaTeX / Mermaid still need geometric `style` attributes).
- **Production dependency audit** gate in CI (`npm audit --audit-level=high --omit=dev`).
- **Secret scanning** on the GitHub repo + **gitleaks** on history
  (`.github/workflows/gitleaks.yml`).
- **Encrypted backups** optional via WebCrypto (`src/lib/crypto.ts`).

### CSP notes (deliberate)

| Directive | Value | Why |
| --------- | ----- | --- |
| `script-src` | `'self'` + build-time hashes | No `'unsafe-eval'` and no `'wasm-unsafe-eval'`: no runtime dependency instantiates WebAssembly (verified on mermaid 11.16, katex, highlight.js). The e2e render tests exercise the built app under this CSP, so a future WASM consumer fails CI rather than shipping. |
| `style-src` | `'self' 'unsafe-inline'` | Runtime styles from the editor stack, KaTeX, and Mermaid SVGs. |
| `img-src` | `'self' data: blob: https:` | Markdown images: local data-URIs plus optional remote `https:` figures. Remote images can perform a simple IP beacon; that is an accepted authoring trade-off, documented here. Inline `style` `url(https://...)` beacons are stripped by the sanitize pass. |

## Prefer fixes over silence

Security-relevant regressions belong in tests when practical (e.g. sanitize
non-regression for `style` + `url()`, offline PWA shell in `e2e/pwa.spec.ts`).
Thank you for helping keep an offline-first editor trustworthy.

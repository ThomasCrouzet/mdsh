# Security policy

mdsh editor is a local-first static PWA with an optional Tauri Desktop Beta shell. It has no application backend, account, cloud synchronization, or telemetry. Browser drafts live in IndexedDB.

## Supported versions

| Version                         | Support     |
| ------------------------------- | ----------- |
| Latest `1.x` release and `main` | Supported   |
| Older tags                      | Best effort |

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

Le rendu utilise DOMPurify comme dernier assainissement. Les valeurs CSS `url()` du contenu utilisateur acceptent uniquement les fragments SVG locaux validés. Les filtres SVG `feImage` sont supprimés pour fermer cette voie de requête réseau. Les images distantes sont bloquées par défaut et ne sont récupérées qu'après une action explicite sur le document. Cette récupération HTTPS révèle l'adresse IP au serveur distant, sans cookie ni référent et sans suivre les redirections. Les octets validés sont ensuite incorporés au document. Le projet ne fournit pas de proxy d'images.

La CSP de production bloque les scripts non autorisés, les objets, les formulaires et l'encadrement externe. Elle autorise les connexions HTTPS nécessaires à la récupération consentie des images, mais interdit leur chargement direct depuis une origine externe; le contrôle du consentement reste appliqué par la couche de préparation des médias. Les styles intégrés restent nécessaires à l'éditeur, KaTeX et Mermaid. Les diagrammes Mermaid refusent les images et les styles réseau avant le rendu, utilisent des labels SVG natifs et conservent uniquement des styles de dessin bornés au SVG. Les exports HTML autonomes ne contiennent ni script ni dépendance à une police distante.

## Desktop threat model

The Desktop Beta treats the WebView as potentially compromised. JavaScript cannot grant itself an arbitrary path. A native file picker or an operating-system file-open event canonicalizes an allowed path and creates an opaque, random, session-only capability token in Rust. Read, stat, and write commands accept that token rather than a path. Persisted browser records are not treated as native capabilities and require a fresh picker after restart.

Native file operations reject relative paths, parent traversal, unsupported extensions, and symlink substitutions. Writes use a same-directory temporary file, file synchronization, permission preservation, a final content-revision conflict check, atomic replacement, and directory synchronization where supported. An external edit requires an explicit user decision. Windows uses the native replace API for an existing target.

These boundaries reduce the impact of a WebView compromise but do not make an already compromised local operating-system account safe. Desktop installers remain unsigned beta artifacts until platform signing and notarization are available. There is no auto-update channel.

## Durability and backup limits

IndexedDB writes are debounced by 400 ms and flushed when the page becomes hidden, on page hide, and before relevant navigation. A rejected write makes the durability barrier fail closed and blocks backup, restore, and workspace replacement. A browser or device kill can still lose edits within the debounce window, and IndexedDB can be removed with browser profile data.

External backups include drafts, workspaces, and custom templates. They exclude trash, version history, File System Access handles, and Desktop capability tokens. Encrypted backups are unrecoverable without their passphrase.

## Supply chain

CI audits the complete npm tree and Cargo lockfile, reviews dependency changes, scans TypeScript and Rust with CodeQL, scans Git history for secrets, verifies third-party notices, and enforces tests and bundle budgets. Release builds run without write credentials. A separate final job publishes Desktop Beta artifacts with SHA-256 checksums, npm and Cargo SBOMs, and GitHub build provenance.

La chaîne GTK3 de Tauri Linux exige encore `glib 0.18.5`. Le projet applique le correctif officiel de `GHSA-wrw7-89jp-8q8g` / `RUSTSEC-2024-0429` dans une copie locale, sans changer sa version ni ses licences. [La provenance et le patch](patches/glib/README.md) sont versionnés. La CI et la publication Desktop comparent chaque octet de cette copie à l'archive officielle vérifiée par SHA256, après application du patch canonique. Six tests Linux en mode optimisé couvrent les itérateurs concernés ; la version non corrigée provoque des SIGSEGV sur les parcours non vides. Le SBOM Cargo conserve la version réelle et décrit le backport ainsi que son origine.

`cargo audit --deny unsound` bloque également les avis de comportement indéfini. Cargo Audit ne contrôle pas les dépendances locales comme les paquets du registre : son silence ne prouve pas que le backport est correct. La vérification de provenance et les tests optimisés sont donc des contrôles bloquants distincts. Les avis de maintenance restent visibles. Le backport sera retiré lorsque la chaîne GTK acceptera une version officiellement corrigée.

Security controls and scanners reduce risk; they are not a guarantee that every vulnerability has been found.

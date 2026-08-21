# Announcement draft

I built mdsh editor as a local-first Markdown workspace that runs entirely in the browser and an optional Tauri Desktop Beta shell. It supports WYSIWYG, source, and reading modes, plus math, diagrams, wiki links, workspaces, local history, and self-contained exports.

The interesting part is the boundary work: IndexedDB durability barriers fail closed, remote document images require consent, user CSS cannot issue network requests, and native file access uses opaque Rust-owned capabilities with atomic conflict-checked writes. The initial bundle also has blocking size budgets, so rendering libraries stay behind lazy boundaries.

There is no account, cloud synchronization, collaboration service, telemetry, or runtime CDN. Feedback on the storage, sanitizer, accessibility, and native capability design is especially welcome.

Web app: https://thomascrouzet.github.io/mdsh/

Source: https://github.com/ThomasCrouzet/mdsh

# Improvement priorities

Keep the offline, client-only design in [ARCHITECTURE.md](ARCHITECTURE.md).
Use [Testing](docs/TESTING.md) for current browser and native evidence.

## P1: Retain abrupt-exit recovery evidence

- Component: `src/lib/save-queue.ts`, backup and workspace transitions.
- Benefit: distinguish completed durability barriers from best-effort unload writes.
- Completion: a browser process is terminated at defined save stages and reopened.
  The artifact identifies durable content, retained conflicts, and recoverable unsaved revisions.

## P1: Verify native filesystem races

- Component: `src-tauri/src/disk.rs`, `src/lib/disk-sync.ts`.
- Benefit: clarify guarantees during external edits and path substitutions.
- Completion: native scenarios retain both file versions or reject the write
  during concurrent replacement, rename, and capability revocation.
  Document the remaining race window for writers that do not cooperate.

## P2: Add bounded export cancellation evidence

- Component: `src/lib/export-ops.ts`, media preparation and native printing.
- Benefit: preserve editing and pending changes after dialog or media cancellation.
- Completion: browser and native scenarios cancel each export stage and verify
  spinner cleanup, unchanged dirty state, and a subsequent successful export.

## P2: Measure large-library storage pressure

- Component: IndexedDB history, conflict preservation, trash, and backup import.
- Benefit: make retention and quota behavior predictable for long-lived notebooks.
- Completion: a repeatable large fixture records storage use and verifies that
  quota failures cannot produce a successful save or destructive backup replacement.

## P2: Stabilize native PDF inspection cost

- Component: `scripts/inspect-native-pdf.swift`, `scripts/native-smoke.mjs`.
- Benefit: reduce timing variation on Intel macOS while retaining pixel assertions.
- Completion: repeated native runs retain complete PDFs and page checks within
  a documented inspection budget on both macOS architectures.

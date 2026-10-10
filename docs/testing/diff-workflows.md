# Diff workflow test plan

## Scope

These workflows verify visible line diffs for version history and global replacement.
The native smoke suite must verify the external disk conflict workflow.

## Failure risks

- A large comparison can block the interface through quadratic work.
- A long line can create an excessive DOM node or unreadable output.
- Untrusted Markdown can become executable HTML in a diff.
- A collapsed diff can hide the amount of omitted content.
- A bounded fallback can display sampled tail lines before its omission marker.
- Screen readers can miss added, removed, or omitted lines.
- Keyboard users can lose focus when a conflict dialog opens.
- A history restore can overwrite the current revision without a checkpoint.
- A replacement preview can become stale before confirmation.
- A durable remote edit can exist before its BroadcastChannel message arrives.
- A partial replacement can remain after a checkpoint or write failure.
- A conflict decision can apply to a newer disk revision than the displayed revision.
- An empty document can appear as one removed blank line.
- A late history query can show versions for a previously active document.
- Conflict Escape handling can reach global keyboard shortcuts.

## Browser scenarios

Run the focused browser workflow with one worker:

```sh
npm run test:e2e -- e2e/diff-workflows.spec.ts --project=chromium --workers=1
```

The workflow performs these checks:

1. Open a stored version and inspect added and removed lines.
2. Keep Markdown and HTML-like text as escaped plain text.
3. Restore the stored version and keep the replaced revision in history.
4. Preview a replacement across multiple files before any content changes.
5. Change a previewed file from another tab and reject the stale preview.
6. Delay the cross-tab message and reject the durable remote edit in IndexedDB.
7. Confirm a fresh preview and keep a checkpoint for each changed file.
8. Bound a large diff and shorten a long line in the rendered output.
9. Close a preview and its parent dialog with consecutive Escape keys.

The Playwright report retains screenshots and a JSON summary.
The report metadata includes the command, source revision, working diff, environment, fixtures, and results.

## Native scenario

The native conflict workflow must use two real filesystem revisions.
It must display local and disk text before it accepts a decision.

The runner must verify these results:

- Cancel keeps both revisions unchanged.
- Reload checkpoints the local revision before it applies disk content.
- Overwrite checks the displayed disk revision again before replacement.
- A changed revision after preview rejects the decision and opens a new comparison.
- Escape resolves the active request as cancel and restores focus.

Record the paths, SHA-256 revisions, decision, final bytes, and retained checkpoint.
Do not include document content in the native artifact.

## Limits

The rendered diff has explicit work, output, and line-length limits.
A bounded fallback can report approximate counts for a large changed region.
The source documents remain unchanged by comparison.

# Split source and preview risks

## Workflow

1. Open a document in Source mode.
2. Enable the split preview.
3. Edit the only source editor.
4. Check the delayed rendered result.
5. Resize the panes with a pointer or keyboard.
6. Move between document sections in either pane.
7. Reload the application and check the saved layout.

## Failure risks

- The split view can create a second editable document state.
- Toggling the preview can discard CodeMirror undo history or the caret position.
- Each keystroke can start an expensive Markdown, KaTeX, or Mermaid render.
- A late render can replace a newer preview or a different document preview.
- Source and preview scrolling can form a feedback loop.
- Repeated headings can synchronize with the wrong rendered section.
- Code blocks and front matter can create false section targets.
- Pointer resizing can make one pane unusable.
- Keyboard resizing can omit its current value or ignore writing directions.
- A narrow viewport can make both panes too small to use.
- A stored ratio can be invalid, unavailable, or outside the supported range.
- A storage failure can prevent Source mode from opening.
- The preview can expose unsanitized HTML or remote media.
- The split controls can obscure document navigation or the editor scrollbar.
- The preview can lose its accessible name or busy state.

## E2E evidence

`e2e/split-view.spec.ts` checks the visible toggle, one editable source, delayed output,
sanitized output, keyboard resizing, persistence, section synchronization, undo, and
the narrow layout. Playwright retains screenshots and the Markdown fixture.

Run the focused workflow with:

```sh
npm run test:e2e -- split-view.spec.ts --project=chromium --workers=1
```

The standard Playwright report records the command, revision, working diff,
environment, fixture, assertions, and result.

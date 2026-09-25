# Screenshots

The root `README.md` uses these screenshots. Regenerate them with:

```sh
npm run build
node scripts/capture-screenshots.mjs
```

Use [BRANDING.md](../BRANDING.md#capture-the-current-interface) for tools, fixtures, and evidence paths.
The capture uses Chromium, English labels, and explicit theme settings.
The script defines viewport and encoding settings. It resets local test data before capture.

| File                | Scenario                                                            |
| ------------------- | ------------------------------------------------------------------- |
| `mode-wysiwyg.webp` | Milkdown editor: H1, KaTeX math, code, checklist, populated sidebar |
| `mode-wysiwyg-light.webp` | Visual editor with the light theme |
| `mode-source.webp`  | CodeMirror source mode: syntax highlighting and line numbers        |
| `mode-read.webp`    | Reading mode: floating table of contents, rendered KaTeX, backlinks |
| `palette.webp`      | Open `⌘⇧P` palette with all primary commands                        |

# Screenshots

The root `README.md` uses these screenshots. Regenerate them with:

```sh
npm run build
node scripts/capture-screenshots.mjs
```

The Playwright script uses Chromium at 1280 x 800, DPR 2, in dark mode. It does these steps:

1. Reset IndexedDB and localStorage before each capture. Set the French locale for the scenario.
2. Seed three linked demo files: `idées`, `diagrammes`, and `bienvenue`. They show a populated sidebar, tag chips, and backlinks.
3. Disable CSS animations, including the CodeMirror caret and modal fade-in.
4. Convert the images to WebP with `cwebp -q 88`. This reduces size by about 65 percent with no visible loss. If `cwebp` is absent, keep the PNG files.

| File                | Scenario                                                            |
| ------------------- | ------------------------------------------------------------------- |
| `mode-wysiwyg.webp` | Milkdown editor: H1, KaTeX math, code, checklist, populated sidebar |
| `mode-source.webp`  | CodeMirror source mode: syntax highlighting and line numbers        |
| `mode-read.webp`    | Reading mode: floating table of contents, rendered KaTeX, backlinks |
| `palette.webp`      | Open `⌘⇧P` palette with all primary commands                        |

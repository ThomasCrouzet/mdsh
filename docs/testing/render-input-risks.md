# Render input risk scenarios

These browser scenarios cover source changes and stalls from hostile Markdown inputs.

## Failure risks

- Automatic syntax detection can block the main thread on a large code block.
- Image embedding can replace destinations inside quoted or list code fences.
- Reference-style remote images can remain blocked after explicit user consent.

## Browser scenarios

`render-input-risks.spec.ts` verifies these observable results:

1. Read mode keeps a large code block usable and marks skipped syntax highlighting.
2. Explicit image embedding changes a live image and keeps fenced examples unchanged.
3. Explicit image embedding updates a reference definition and renders the local data image.

The image scenarios intercept local fixture URLs. They do not contact an external host.

## Repeatable command and artifacts

Run the focused workflow after a coordinated build freeze:

```sh
npm run test:e2e -- render-input-risks.spec.ts --project=chromium --workers=1
```

Keep `playwright-report/index.html` and `test-results/results.json`. Failed cases retain
screenshots and traces under `test-results/`.

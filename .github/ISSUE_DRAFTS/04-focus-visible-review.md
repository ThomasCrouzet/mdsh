# Review focus indicators in light and dark themes

Labels: `good first issue`, `accessibility`, `css`

Inspect keyboard focus on toolbar, sidebar, dialogs, Settings, and command palette in light and dark themes.

Acceptance criteria:

- Every interactive control has a visible focus indicator.
- Focus styles meet the existing contrast tokens and BLACKSITE visual language.
- Pointer-only focus rings are avoided where `:focus-visible` is appropriate.
- Axe and focused Playwright checks pass without rule exclusions.

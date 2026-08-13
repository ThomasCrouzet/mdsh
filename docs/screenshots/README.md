# Screenshots

Captures référencées par le `README.md` racine. Régénération :

```sh
npm run build
node scripts/capture-screenshots.mjs
```

Le script Playwright (Chromium, 1280×800, DPR 2, dark mode) :

1. Réinitialise IndexedDB + localStorage avant chaque capture et fixe la locale française utilisée par le scénario
2. Seed 3 fichiers de démo liés (`idées`, `diagrammes`, `bienvenue`) pour exhiber la sidebar peuplée, les chips de tags et la section backlinks
3. Désactive les animations CSS (caret CodeMirror, fade-in modaux)
4. Convertit ensuite en WebP via `cwebp -q 88` (gain ~65 % vs PNG sans perte visible). Si `cwebp` n'est pas installé, les PNG sont conservés tels quels.

| Fichier              | Scénario                                                              |
| -------------------- | --------------------------------------------------------------------- |
| `mode-wysiwyg.webp`  | Éditeur Milkdown - H1, math KaTeX, code, checklist, sidebar peuplée   |
| `mode-source.webp`   | Mode source CodeMirror - syntax highlight, numéros de lignes          |
| `mode-read.webp`     | Mode lecture - TOC flottante, KaTeX rendu, backlinks                  |
| `palette.webp`       | Palette `⌘⇧P` ouverte - toutes les commandes principales              |

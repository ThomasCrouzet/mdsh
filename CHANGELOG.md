# Changelog

Toutes les évolutions notables de **mdsh** sont documentées ici.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnement [SemVer](https://semver.org/lang/fr/).

## [1.1.0](https://github.com/ThomasCrouzet/mdsh/compare/v1.0.0...v1.1.0) (2026-07-15)


### Features

* propose un rechargement explicite en cas de conflit multi-onglets ([512323c](https://github.com/ThomasCrouzet/mdsh/commit/512323c6f5eb7dc27407bc249f1438563d8966c9))


### Bug Fixes

* restreint le fast-path front-matter au YAML sur une seule ligne ([5e8bcb7](https://github.com/ThomasCrouzet/mdsh/commit/5e8bcb7ced501f0f6bb54cf0fcf77079b0a34fb8))
* **security:** retire wasm-unsafe-eval de la CSP ([5e793f6](https://github.com/ThomasCrouzet/mdsh/commit/5e793f625f87cdf2600800054aed7a77439db9eb))


### Performance Improvements

* ne resynchronise le corpus du worker de recherche que s'il a change ([342625d](https://github.com/ThomasCrouzet/mdsh/commit/342625d7e9ca25c75e7bbf196ecb7b23ffd8d6aa))

## [1.0.0] - 2026-07-10

### ⚠ BREAKING CHANGES

* aucun changement d'API (mdsh est une application, pas une bibliothèque) - ce jalon marque le seuil v1.0.0 : produit stable, CI verte, documentation consolidée.

### Features

* marque le lancement public v1.0.0

## [0.10.0] - 2026-07-10

### Features

* ajoute les screenshots au manifest PWA et repositionne ses métadonnées
* ajoute un document de démo opt-in sur l'écran Welcome
* ajoute une couche i18n bilingue (anglais par défaut + français)

## [0.9.0] - 2026-06-17

### Features

* implémente la roadmap d'améliorations (thème clair, sauvegarde, historique, graphe…)

### Bug Fixes

* **a11y:** focus modal, contraste des statuts, Échap sidebar
* **a11y:** rend les wiki-links activables au clavier en mode lecture
* **export:** assainit les noms de fichiers à l'export
* **persistence:** élimine les pertes de données silencieuses par race
* **pwa:** injecte le `<link rel="manifest">` dans le document
* **pwa:** rend le précache réellement offline-ready
* **render:** code-aware wiki-links/slides, math inline, export HTML autonome
* **security:** borne les itérations PBKDF2 au déchiffrement
* **security:** durcit PBKDF2 (600k) et signale la corruption partielle de sauvegarde
* **storage:** reorder honnête, snapshots transactionnels, sync inter-onglets testée
* **stores:** remonte les échecs d'écriture IDB des workspaces et templates
* **ui:** remonte les erreurs au lieu de les avaler

## [0.8.1] - 2026-05-28

### Bug Fixes

* **test:** supprime la race de mode source dans search-replace (e2e flaky)

## [0.8.0] - 2026-05-28

### Features

* **a11y:** retours visibles des exports et de l'enregistrement disque
* canal de notifications (toasts erreur/succès/info)

### Bug Fixes

* **deps:** bump marked/dompurify/mermaid + passage en pin ~
* **deps:** correction des vulnérabilités transitives (npm audit fix)
* **security:** forcer rel="noopener noreferrer" sur les liens externes
* **storage:** durcir la persistance IndexedDB (erreurs visibles, quota, anti-éviction)

## [0.7.0] - 2026-05-20

### Features

* drag & drop d'images locales (data URI inline, 100 % offline)

### Bug Fixes

* **ci:** mobile E2E project utilise Pixel 5 (Chromium) au lieu d'iPhone 13

### Performance Improvements

* SearchPanel via Web Worker + virtualisation Sidebar conditionnelle

## [0.6.0] - 2026-04-28

### Features

* **hardening:** Sprint 1 - XSS, CSP, a11y, trash persistence, refactors
* optimisations performance (Plan A) + a11y/UX (Plan B)
* **perf+ci:** Sprint 2 - lazy Milkdown, prefetch renderer, size-limit, DX
* quick wins Tier 5+6+7 - focus indicator, typewriter, CODEOWNERS, CHANGELOG, ROADMAP
* Tier 1+2+3 - DX, perf, refactor ExportService + spinner + Lighthouse CI
* Tier 4 - front-matter, wiki-links, ZIP, CodeMirror, TOC, search & replace
* Tier 5+6+7+8+9 - multi-select, workspaces, mermaid WYSIWYG, release-please, etc.

### Bug Fixes

* **dnd:** l'overlay d'import ne réagit plus aux drags internes

### Performance Improvements

* fluidité du resize éditeur (rAF + contain + prefetch différé)

## [0.5.0] - 2026-04-28 (Tier 5+6+7+8+9)

### Added

- **Multi-sélection sidebar** (`⌘`/`Ctrl`/`Shift`+clic) avec barre d'actions groupées : exporter en ZIP, fermer, désélectionner.
- **Workspaces / sessions nommées** persistés dans Dexie (table `workspaces`, schéma v3) - sauvegarde l'état d'onglets ouverts + actif, restauration via la palette `⌘⇧P`, modal dédié pour gérer (renommer / supprimer / mettre à jour).
- **Badge « lien cassé »** sur les fichiers dont le `FileSystemFileHandle` ne résout plus (déplacé / supprimé sur le disque). Détecté en arrière-plan au load et après chaque échec d'écriture.
- **Mode typewriter** (Tier 5 polish) : caret centrée verticalement (cf. iA Writer), via un `Compartment` CodeMirror reconfigurable à chaud - toggle via la palette, persisté en `localStorage`.
- **Focus indicator persistant** : liseré accent vertical à gauche de l'onglet actif dans la sidebar.
- **Mermaid live-preview en WYSIWYG** (Tier 8) - via l'API officielle Crepe `CodeBlockConfig.renderPreview`, le SVG est rendu dans le panneau d'aperçu de chaque bloc ` ```mermaid ` directement dans l'éditeur ; mermaid reste lazy-loadé.
- **OG image + meta tags Open Graph / Twitter** pour partage social.
- **Documentation** : `CHANGELOG.md` (Keep a Changelog), `ROADMAP.md` public, FAQ + comparatif (vs StackEdit / HackMD / Obsidian / iA Writer / Typora) + diagram Mermaid d'architecture dans `README.md`, recettes de debugging consolidées dans la doc de dev.
- **CI / DX** : `release-please` configuré (workflow + config + manifest), script `npm run preview:pages` qui simule le sous-chemin `/mdsh/` localement, scripts d'outillage local (audit a11y via axe-core, audit des deps), `.github/CODEOWNERS`.
- **Calibration Lighthouse** : budgets `.github/lighthouse-budget.json` calés sur le build local (script 350 / total 800 KB) avec marge ~30 %.
- **Veille deps** : audits `lucide-svelte` et `@milkdown/crepe` documentés dans la roadmap (lucide figé en `1.0.1` = dernière dispo, no-op ; Crepe `7.16` → `7.20` reporté en lot séparé pour régénérer les snapshots E2E sur Linux CI).

### Changed

- `vitest` `^2.1.9` → `^3.2.4`. Configuration inchangée (`environment: 'jsdom'` + `globals: true` toujours supportés).
- `vite.config.ts` : nouvelle tentative `manualChunks` conservatrice - seules les libs **lazy-loadées exclusivement** sont groupées (`marked`, `highlight.js`, `katex`, `jszip`, `js-yaml`). Mermaid et DOMPurify exclus pour éviter le bug `__vitePreload` rencontré lors de la première tentative. Build vérifié : entry n'importe statiquement que les chunks SvelteKit.

### Fixed

- **Workspaces - perte de données** : `closeMany({ trash: false })` supprimait les drafts à chaque switch de workspace. Ajout d'un flag `keepDB` qui retire l'onglet sans toucher la DB ; `restore()` ré-ouvre les fichiers manquants via `db.drafts.bulkGet`.
- **Mermaid renderPreview** : le token de validité du rendu était global au module, l'édition d'un bloc B annulait le rendu en cours du bloc A. Tracker désormais via `WeakMap<applyPreview, token>` pour invalider correctement par bloc.
- `unlinkFromDisk` : fonctionne désormais aussi pour les handles orphelins (pas de file dans le store), nécessaire au panneau « Liens disque ».

## [0.4.0] - 2026-04-28 (Tier 4)

### Added

- Front-matter YAML : `title` / `tags` / `author` / `date` / `created` extraits via `js-yaml` (lazy, ~26 KB gzip), titre prioritaire dans `document.title` et label sidebar, métadonnées rendues dans une `<aside>` discrète preview + PDF.
- Wiki-links `[[Cible]]` et `[[Cible|alias]]` - résolus au clic dans le mode lecture, créent le fichier absent (Obsidian-style), backlinks listés dans la sidebar.
- Filtre par tag dans la sidebar : chips cliquables, bouton « Tous » pour reset.
- Export ZIP (« Exporter tous les fichiers ») : un seul download au lieu de N téléchargements séquentiels, `jszip` lazy ~27 KB gzip, nom horodaté `mdsh-export-YYYY-MM-DD.zip`.
- Table des matières flottante en mode lecture : extraction h1-h3, scrollspy `IntersectionObserver`, smooth-scroll.
- Panneau « Liens disque » (palette → Gérer les liens disque) : liste les `FileSystemFileHandle` persistés, statuts ✓/⚠/✗, dissocier.
- Mode source en CodeMirror 6 - coloration syntaxique markdown, numéros de ligne, history, lazy-loadé.
- Search & replace in-file via `⌘F` - panel CodeMirror themed, bascule auto en mode source si appelé depuis WYSIWYG/lecture.

### Fixed

- `unlinkFromDisk` ne dissociait pas les orphelins (handle stocké sans file dans le store) - désormais retire le handle IDB avant de checker le file.
- ESLint `no-irregular-whitespace` (caractère ZWSP littéral) corrigé via `String.fromCharCode`.
- TOC : la colonne 220 px ne se masquait pas quand le contenu n'avait aucun heading.

### Changed

- `gray-matter` abandonné (dépend de `Buffer` Node, incompatible browser sans polyfill) → remplacé par `js-yaml` qui fonctionne nativement.

## [0.3.0] - 2026-04-28 (Tier 1+2+3)

### Added

- DX : `legacy-peer-deps=true` permanent dans `.npmrc`, `.editorconfig`, scripts npm `analyze` / `clean`.
- Détection plateforme : `⌘` / `Ctrl` détectés automatiquement, raccourcis affichés dans la bonne notation (Mac : `⌘N`, Win/Linux : `Ctrl+N`) sur 31 occurrences UI.
- Spinner toast pour les exports PDF/HTML longs : délai anti-flash 200 ms, `role="status"`, `aria-live`, animation respectant `prefers-reduced-motion`.
- Lighthouse CI sur chaque PR : audit Perf / A11y / Best Practices / SEO, A11y assertion stricte ≥ 0.95, budget configurable.
- Benchmark rendu : 50k chars + 10 mermaid en < 2s en CI (~80 ms en local).

### Changed

- Service d'export extrait dans `src/lib/services/export.ts` - fonctions pures, testables, étendables (Zip/DOCX/EPUB futurs).
- `reorder()` : transaction Dexie unique au lieu de N timers (gain mesurable dès 20+ fichiers).
- KaTeX fonts slim : retrait Fraktur / SansSerif / Script (-72 KiB sur les fonts précachées par le SW).
- Mermaid counter scopé en closure (élimine le state module global).

### Fixed

- Régression first-paint : tentative de `manualChunks` Vite annulée (Rolldown faisait remonter `mermaid` 2.5 Mio en static dans l'entry).

## [0.2.0] - 2026-04-24

### Added

- Sprint 1 (hardening) : XSS sanitisation via DOMPurify, CSP durcie (`frame-src 'none'`, `frame-ancestors 'none'`), corbeille persistée Dexie, focus trap, skip link, types partagés, constants centralisées.
- Sprint 2 (perf) : Milkdown lazy-loadé, prefetch renderer au idle, debounce SearchPanel, size-limit en CI, Dependabot, lefthook (pre-commit / pre-push).
- Sprint 3 (tests) : tests unitaires `fsa` / `print`, Playwright E2E (golden-path, palette, focus, a11y), snapshots visuels.

## [0.1.0] - 2026-04-17

### Added

- Init mdsh - éditeur markdown WYSIWYG SvelteKit + Svelte 5 + Milkdown Crepe.
- Modes WYSIWYG / source / lecture.
- Stockage Dexie (IndexedDB), debounce 400 ms.
- PWA offline (`vite-plugin-pwa`), `file_handlers`, `share_target`, `launchQueue`.
- Export Markdown / HTML / PDF.
- Palette de commandes ⌘⇧P.
- Recherche cross-fichiers ⌘⇧F.
- Mode focus ⌘⇧.
- Drag-drop import `.md`.
- File System Access API (save-to-disk, ⌘⇧S).
- Dark-mode-first, contraste WCAG AAA, raccourcis clavier.

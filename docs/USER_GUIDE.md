# User guide

## Start writing

Open the [web app](https://thomascrouzet.github.io/mdsh/), create a document, and choose WYSIWYG, source, or reading mode from the toolbar. Drafts save to this browser profile. There is no account or cloud copy.

## Install the PWA

Visit the web app in a browser that supports PWA installation, then use the browser's Install action. Open the installed app once while online so its local application shell is current. Editing and local exports work offline after installation.

## Backups and storage health

Open Settings to review whether browser storage is persistent or best-effort, inspect the available quota estimate, and see the last successful external backup. Export a backup regularly, especially before clearing browser data or changing profiles.

A backup includes drafts, workspaces, and custom templates. It does not include trash, version history, browser file handles, or Desktop path capabilities. Encrypted backups cannot be recovered without their passphrase.

## Remote images

Remote images in Markdown are blocked by default. Reading mode shows a notice and an action to load them for the current document. Loading a remote image contacts its host and reveals your IP address. The request sends no referrer. CSS URLs from user content remain blocked regardless of image consent.

## Export

PDF exports contain the rendered author content without an application header, generated title, or visible front matter. Browser print headers and footers are controlled by the print dialog and should be disabled there.

Standalone HTML embeds its styles and required KaTeX fonts so math remains available from a local file without a network connection. Markdown, ZIP, and HTML downloads do not preserve browser file handles.

## Desktop Beta

Desktop installers are unsigned beta artifacts and may trigger operating-system warnings. Download them only from the project's prerelease page, compare the file with `SHA256SUMS`, and review the attached provenance and SBOM files. Direct file access is granted only by a native picker or an operating-system open event and lasts for the application session.

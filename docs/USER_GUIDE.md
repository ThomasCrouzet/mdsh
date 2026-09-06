# User guide

## Start writing

Open the [web app](https://thomascrouzet.github.io/mdsh/) and create a document. Select WYSIWYG, source, or reading mode on the toolbar. Drafts stay in the current browser profile. The app does not create an account or remote copy.

Closing a tab keeps the document in the library. The delete command moves it to the trash for 30 days. Open the library and trash from the sidebar.

<a id="install-the-pwa"></a>

## Install the PWA

Use the browser install action from the web app. Wait for offline preparation to finish before you disconnect the network. The cache contains both editors, Markdown rendering, formulas, diagrams, fonts, and export modules. You can then create, edit, search, and export documents offline.

A new version waits for IndexedDB writes before it reloads the app. If a local save fails, the document stays visible. The update does not force a reload.

## Import documents

A selection or folder can contain up to 300 files and 64 MiB. Each file can contain up to 16 MiB. The app rejects binary files, prohibited control characters, and text that is not UTF-8. It shows a result for each rejection. If you cancel an import, the app keeps imported documents and reports how many it added.

A document with at least 262,144 characters opens first in source mode. You must confirm before you change to visual rendering because parsing can take more time.

## Local and remote images

The app embeds images that you add with the picker, clipboard, or drag and drop. Embedded images remain available after a reload and appear in PDF and standalone HTML exports. Older versions created temporary links that cannot be recovered after expiration. Import the image again from its original file.

The app blocks remote images by default. Reading mode can load and embed them in the current document. This action contacts the image host and reveals your IP address. The request sends no cookies or referrer and rejects redirects. Each remote image can contain up to 2 MiB. One operation can fetch up to 8 MiB in total. The app sanitizes SVG files before it embeds them.

To resolve a relative image path, select the applicable file or folder. The app then embeds the image to keep the document portable.

Mermaid diagrams reject images and network styles. Put images directly in the Markdown.

<a id="backups-and-storage-health"></a>

## Backups and storage health

Settings shows whether the browser granted persistent storage. It also shows the estimated quota and the date of the latest successful external backup. Export a backup regularly. Always make one before you clear browser data or change profiles.

A backup contains open and closed documents, workspaces, and custom templates. It excludes trash, version history, browser file handles, and Desktop path permissions. The format accepts up to 3,000 documents, 300 workspaces, 16 MiB per document, and 64 MiB in total. The app checks these limits before it reports a successful download. You cannot recover an encrypted backup without its passphrase.

Replace mode keeps old documents in the trash and preserves variants that share an identifier. Merge mode assigns new identifiers after collisions and updates workspace references.

## Export

PDF export renders content, embedded images, formulas, code blocks, and diagrams before it opens the print dialog. The app reports success only after preparation finishes. Select a PDF printer in the browser or system dialog. You can disable browser headers and footers in that dialog.

The standalone HTML file embeds its styles, images, and required KaTeX fonts. You can read the local file without a network. Markdown, ZIP, and HTML exports do not include direct disk-access permissions.

## Keyboard shortcuts

The Commands menu shows all active shortcuts. In Settings, you can customize commands, detect conflicts, and restore defaults. The app saves web and Desktop profiles separately. Content-editing shortcuts have priority when the cursor is in the editor.

## Desktop Beta app

Desktop installers are unsigned beta artifacts. macOS can show a Gatekeeper warning, and Windows can show a SmartScreen warning. Download files only from the Desktop prerelease for the applicable version. Compare their checksums with `SHA256SUMS`. The release also contains npm and Cargo SBOMs and a provenance attestation.

The macOS version requires macOS 14 or later. Windows uses the Tauri installation mode to install WebView2 if it is absent. Linux packages use WebKitGTK. Each file association and native selection creates an opaque permission for the current session. Open the file again after the next start to restore access.

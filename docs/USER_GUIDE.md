# User guide

## Start writing

Open the [web app](https://thomascrouzet.github.io/mdsh/) and create a document. Select WYSIWYG, source, or reading mode on the toolbar. Drafts stay in the current browser profile. The app does not create an account or remote copy.

Closing a tab keeps the document in the library. The delete command moves it to the trash for 30 days. Open the library and trash from the sidebar.

The **Actions** button gives direct access to documents, search, export, and settings. The keyboard icon opens all commands and their shortcuts. Labels use Command on macOS and Control on Windows and Linux. File navigation uses Control on every platform.

Open **Document library** to filter open and closed documents by filename, title, or tag. The list shows recent changes first. It also lists unresolved or ambiguous wiki links. Open the referring document to correct a target.

Use the library checkboxes to select documents, then select **Delete selected**.
**Select all results** follows the current filter. **Delete all** includes the full
library, including closed documents. Confirm the count before you continue.
Documents move to trash. In the trash, select individual documents or use
**Empty trash** to remove them permanently. This removes their version history
and unused disk permissions, but does not delete files from disk.

**Document outline** in Actions works in all three modes and on small screens. Source mode includes headings outside code and front matter. Reading and WYSIWYG modes use the visible headings. Find in document keeps the current mode. In source mode, the search panel also supports replacement.

Source mode keeps a separate undo history for each recently used draft. A change of draft cannot undo content from another draft.
The current browser session keeps editor positions for up to 32 recently used drafts. Reloading clears undo history, but keeps these positions.

<a id="install-the-pwa"></a>

## Install the PWA

Use the browser install action from the web app. Wait for offline preparation to finish before you disconnect the network. The cache contains both editors, Markdown rendering, formulas, diagrams, fonts, and export modules. You can then create, edit, search, and export documents offline.

A new version waits for IndexedDB writes before it reloads the app. If a local save fails, the document stays visible. The update does not force a reload.

## Import documents

A selection or folder can contain up to 300 files and 64 MiB. Each file can contain up to 16 MiB. The app rejects binary files, prohibited control characters, and text that is not UTF-8. It shows a result for each rejection. If you cancel an import, the app keeps imported documents and reports how many it added.

A document with at least 262,144 characters opens first in source mode. You must confirm before you change to visual rendering because parsing can take more time.

On supported systems, opening a file with the installed PWA uses the same import limits.

## Search and disk links

Whole-word search includes Unicode letters, marks, numbers, and underscores. Apostrophes and hyphens separate words. Search and replacement use the same boundaries.

Cross-file search includes closed documents by default. Select **Open tabs** to limit its scope. Replacement uses the selected scope and saves a history checkpoint. Search shows up to 200 matching lines and reports this limit.

Wiki links reopen closed targets without making a copy. A rename updates incoming name-based links, including links in closed documents. Code examples and displayed aliases stay intact. A backup merge updates identifier-based links to the imported IDs. If several documents have the same target name, select the correct document in the library.

Before saving a linked file, the app compares its content with the last saved reference. If the check fails, it stops the save.
An older link without a reference requires an explicit decision before the first write. Use a new target if you cannot verify the file.

In Desktop, change the name in the toolbar and press Enter or leave the field to rename the linked file on disk. Escape cancels the edit. A rename keeps the file in the same folder and refuses a name that another file uses. In a browser, renaming disconnects the old disk link. Save the renamed draft to a new file; the original disk file stays unchanged.

Importing an exact copy of one linked document, with the same name and content, opens its existing tab. A different content version remains a separate draft.

## Local and remote images

The app embeds images that you add with the picker, clipboard, or drag and drop. Embedded images remain available after a reload and appear in PDF and standalone HTML exports. Older versions created temporary links that cannot be recovered after expiration. Import the image again from its original file.

The app blocks remote images by default. Reading mode can load and embed them in the current document. This action contacts the image host and reveals your IP address. The request sends no cookies or referrer and rejects redirects. Each remote image can contain up to 2 MiB. One operation can fetch up to 8 MiB in total. The app sanitizes SVG files before it embeds them.

To resolve a relative image path, select the applicable file or folder. The app then embeds the image to keep the document portable.

Mermaid diagrams reject images and network styles. Put images directly in the Markdown.

<a id="backups-and-storage-health"></a>

## Backups and storage health

Settings shows whether the browser granted persistent storage. It also shows the estimated quota and the date of the latest successful external backup. Export a backup regularly. Always make one before you clear browser data or change profiles.

The status bar identifies local draft saves. A linked disk file requires the explicit **Save to disk** action. The backup reminder opens Settings. You can dismiss the reminder for a week.

Select **Check a backup** to validate a JSON file or decrypt and validate an encrypted backup without changing your library. A restore first shows the backup date and document counts, then asks whether to merge or replace. In a browser, wait for the download to finish before you rely on an exported file.

A backup contains open and closed documents, workspaces, and custom templates. It excludes trash, version history, browser file handles, and Desktop path permissions. The format accepts up to 3,000 documents, 300 workspaces, 16 MiB per document, and 64 MiB in total. The app checks these limits before it reports a successful download. You cannot recover an encrypted backup without its passphrase.

Replace mode keeps old documents in the trash and preserves variants that share an identifier. Merge mode assigns new identifiers to added drafts and updates workspace references.

Replace mode also disconnects disk links. Imported content cannot reuse an old file permission. Merge mode keeps links for existing local drafts.

## Export

PDF export renders content, embedded images, formulas, code blocks, and diagrams before it opens the print dialog. The app reports success only after preparation finishes. Select a PDF printer in the browser or system dialog. You can disable browser headers and footers in that dialog.

Select **PDF (A4)** under **Editor width** in Settings or through Commands. This
preset uses the 178 mm text width of an A4 page with 16 mm side margins. It is a
width guide. Fonts, page breaks, and print settings can differ from the editor.

The standalone HTML file embeds its styles, images, and required KaTeX fonts. You can read the local file without a network. Markdown, ZIP, and HTML exports do not include direct disk-access permissions.

**Export all files (ZIP)** includes open and closed documents in the library. **Export open tabs as ZIP** limits the archive to the current session. Selection export includes only selected tabs.

## Templates

Use Commands to create a document from a built-in or custom template, or save the current document as a template. Settings contains **Manage templates** for editing and deleting custom templates. The `{{date}}` variable uses the local calendar date. Built-in template labels follow the interface language.

## Keyboard shortcuts

The Commands menu shows all active shortcuts. In Settings, you can customize commands, detect conflicts, and restore defaults. The app saves web and Desktop profiles separately. Content-editing shortcuts have priority when the cursor is in the editor.

In the sidebar, focus a draft and press Space to change its selection. Press Enter to open the draft.
Focus another draft and press Shift+Space to select the range. The buttons expose their selection state to screen readers.

Use `Ctrl+Tab` for the next workspace file and `Ctrl+Shift+Tab` for the previous file. Both shortcuts use Control on macOS too. Navigation follows the workspace order and continues from the last file to the first. Some browsers reserve these shortcuts for browser tabs. The Desktop app receives them directly.

In the visual editor, type `/h1` through `/h6`, or `/t1` through `/t6`, to select
a heading level. Press Enter to apply it. The full translated command names also
remain available.

## Desktop Beta app

Desktop installers are unsigned beta artifacts. macOS can show a Gatekeeper warning, and Windows can show a SmartScreen warning. Download files only from the Desktop prerelease for the applicable version. Compare their checksums with `SHA256SUMS`. The release also contains npm and Cargo SBOMs and a provenance attestation.

The macOS version requires macOS 14 or later. Windows uses the Tauri installation mode to install WebView2 if it is absent. Linux packages use WebKitGTK. Native selections and file associations authorize each Markdown path. The app restores that access after restart, so `Cmd+Shift+S` or `Ctrl+Shift+S` saves the restored draft directly. Removing a disk link revokes access. Files first selected in an older version need one new native selection to enter the access registry.

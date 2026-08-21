/**
 * Desktop shell wiring (Tauri): native menu, window-state is plugin-side,
 * argv / file-association open, and menu events → existing frontend handlers.
 *
 * All `@tauri-apps/*` imports are dynamic - never static from the boot graph.
 */

import { isDesktop } from './desktop';
import { reportError, reportWarning } from './report';
import type { NativeDiskGrant } from './disk-tauri';

export type DesktopMenuAction =
	| 'new'
	| 'open'
	| 'save-disk'
	| 'export-md'
	| 'export-pdf'
	| 'export-html'
	| 'export-zip'
	| 'settings';

export interface DesktopMenuLabels {
	file: string;
	edit: string;
	newFile: string;
	open: string;
	saveToDisk: string;
	exportMarkdown: string;
	exportPdf: string;
	exportHtml: string;
	exportZip: string;
	settings: string;
}

export interface DesktopShellHandlers {
	onMenuAction: (action: DesktopMenuAction) => void | Promise<void>;
	/** Native capabilities from argv, OS "Open with" and subsequent open events. */
	onOpenPaths: (grants: NativeDiskGrant[]) => void | Promise<void>;
	labels: DesktopMenuLabels;
}

/**
 * Initializes native menu + open-path listeners. No-op outside the desktop shell.
 * Returns a dispose function that unsubscribes listeners.
 */
export async function initDesktopShell(handlers: DesktopShellHandlers): Promise<() => void> {
	if (!isDesktop()) return () => {};

	const unsubs: Array<() => void> = [];

	try {
		await installAppMenu(handlers.onMenuAction, handlers.labels);
	} catch (err) {
		reportWarning('initialisation du menu desktop', err);
	}

	try {
		const unlistenOpen = await listenOpenPaths(handlers.onOpenPaths);
		unsubs.push(unlistenOpen);
	} catch (err) {
		reportWarning("initialisation de l'écoute des fichiers desktop", err);
	}

	try {
		const { invoke } = await import('@tauri-apps/api/core');
		const pending = await invoke<NativeDiskGrant[]>('take_pending_open_paths');
		if (Array.isArray(pending) && pending.length > 0) {
			await handlers.onOpenPaths(pending);
		}
	} catch (err) {
		reportWarning('lecture des fichiers desktop en attente', err);
	}

	return () => {
		for (const u of unsubs) u();
	};
}

async function installAppMenu(
	onAction: DesktopShellHandlers['onMenuAction'],
	labels: DesktopMenuLabels
): Promise<void> {
	const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu');

	// No `accelerator` on custom items: the SPA already owns these chords via
	// `buildKeydownHandler`. On Windows/Linux, native menu accelerators and the
	// webview keydown both fire → double New/Open/Export. macOS usually consumes
	// the chord in NSMenu, but dropping accelerators keeps all platforms single-fire.
	// Users still see shortcuts in the command palette / toolbar tooltips.
	const item = async (id: DesktopMenuAction, text: string) =>
		MenuItem.new({
			id,
			text,
			action: () => {
				void Promise.resolve(onAction(id)).catch((err: unknown) => {
					reportError(`action du menu desktop "${id}"`, err);
				});
			}
		});

	const fileMenu = await Submenu.new({
		text: labels.file,
		items: [
			await item('new', labels.newFile),
			await item('open', labels.open),
			await item('save-disk', labels.saveToDisk),
			await PredefinedMenuItem.new({ item: 'Separator' }),
			await item('export-md', labels.exportMarkdown),
			await item('export-pdf', labels.exportPdf),
			await item('export-html', labels.exportHtml),
			await item('export-zip', labels.exportZip),
			await PredefinedMenuItem.new({ item: 'Separator' }),
			await item('settings', labels.settings),
			await PredefinedMenuItem.new({ item: 'Separator' }),
			await PredefinedMenuItem.new({ item: 'CloseWindow' }),
			await PredefinedMenuItem.new({ item: 'Quit' })
		]
	});

	const editMenu = await Submenu.new({
		text: labels.edit,
		items: [
			await PredefinedMenuItem.new({ item: 'Undo' }),
			await PredefinedMenuItem.new({ item: 'Redo' }),
			await PredefinedMenuItem.new({ item: 'Separator' }),
			await PredefinedMenuItem.new({ item: 'Cut' }),
			await PredefinedMenuItem.new({ item: 'Copy' }),
			await PredefinedMenuItem.new({ item: 'Paste' }),
			await PredefinedMenuItem.new({ item: 'SelectAll' })
		]
	});

	const menu = await Menu.new({
		items: [fileMenu, editMenu]
	});
	await menu.setAsAppMenu();
}

async function listenOpenPaths(
	onOpenPaths: DesktopShellHandlers['onOpenPaths']
): Promise<() => void> {
	const { listen } = await import('@tauri-apps/api/event');
	const unlisten = await listen<NativeDiskGrant[]>('mdsh://open-paths', (event) => {
		const grants = event.payload;
		if (Array.isArray(grants) && grants.length > 0) {
			void Promise.resolve(onOpenPaths(grants)).catch((err: unknown) => {
				reportError('ouverture depuis un événement desktop', err);
			});
		}
	});
	return unlisten;
}

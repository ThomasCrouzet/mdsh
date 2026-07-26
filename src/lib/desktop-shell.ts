/**
 * Desktop shell wiring (Tauri): native menu, window-state is plugin-side,
 * argv / file-association open, and menu events → existing frontend handlers.
 *
 * All `@tauri-apps/*` imports are dynamic - never static from the boot graph.
 */

import { isDesktop } from './desktop';
import { reportError, reportWarning } from './report';

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
	/** Absolute paths from argv / OS "Open with" / subsequent Opened events. */
	onOpenPaths: (paths: string[]) => void | Promise<void>;
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
		const pending = await invoke<string[]>('take_pending_open_paths');
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

	const item = async (id: DesktopMenuAction, text: string, accelerator?: string) =>
		MenuItem.new({
			id,
			text,
			...(accelerator !== undefined ? { accelerator } : {}),
			action: () => {
				void Promise.resolve(onAction(id)).catch((err: unknown) => {
					reportError(`action du menu desktop "${id}"`, err);
				});
			}
		});

	const fileMenu = await Submenu.new({
		text: labels.file,
		items: [
			await item('new', labels.newFile, 'CmdOrCtrl+N'),
			await item('open', labels.open, 'CmdOrCtrl+O'),
			await item('save-disk', labels.saveToDisk, 'CmdOrCtrl+Shift+S'),
			await PredefinedMenuItem.new({ item: 'Separator' }),
			await item('export-md', labels.exportMarkdown, 'CmdOrCtrl+S'),
			await item('export-pdf', labels.exportPdf, 'CmdOrCtrl+P'),
			await item('export-html', labels.exportHtml),
			await item('export-zip', labels.exportZip),
			await PredefinedMenuItem.new({ item: 'Separator' }),
			await item('settings', labels.settings, 'CmdOrCtrl+,'),
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
	const unlisten = await listen<string[]>('mdsh://open-paths', (event) => {
		const paths = event.payload;
		if (Array.isArray(paths) && paths.length > 0) {
			void Promise.resolve(onOpenPaths(paths)).catch((err: unknown) => {
				reportError('ouverture depuis un événement desktop', err);
			});
		}
	});
	return unlisten;
}

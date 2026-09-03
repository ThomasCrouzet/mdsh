/**
 * Desktop shell wiring (Tauri): native menu, window-state is plugin-side,
 * argv / file-association open, and menu events → existing frontend handlers.
 *
 * All `@tauri-apps/*` imports are dynamic - never static from the boot graph.
 */

import { isDesktop } from './desktop';
import { reportError, reportWarning } from './report';
import { t } from './i18n';
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
	onOpenPaths: (grants: NativeDiskGrant[]) => string[] | Promise<string[]>;
	labels?: DesktopMenuLabels;
	getLabels?: () => DesktopMenuLabels;
	onBeforeClose?: () => void | Promise<void>;
}

/**
 * Initializes native menu + open-path listeners. No-op outside the desktop shell.
 * Returns a dispose function that unsubscribes listeners.
 */
export async function initDesktopShell(handlers: DesktopShellHandlers): Promise<() => void> {
	if (!isDesktop()) return () => {};

	const unsubs: Array<() => void> = [];
	let menuQueue = Promise.resolve();
	const updateMenu = () => {
		menuQueue = menuQueue
			.catch(() => {})
			.then(async () => {
				const labels = handlers.getLabels?.() ?? handlers.labels;
				if (!labels) throw new Error('Desktop menu labels are unavailable.');
				await installAppMenu(handlers.onMenuAction, labels);
			});
		return menuQueue;
	};

	try {
		await updateMenu();
	} catch (err) {
		reportWarning('initialisation du menu desktop', err);
	}
	const onLocaleChange = () => {
		void updateMenu().catch((err: unknown) => reportWarning('langue du menu desktop', err));
	};
	window.addEventListener('mdsh:locale-change', onLocaleChange);
	unsubs.push(() => window.removeEventListener('mdsh:locale-change', onLocaleChange));
	unsubs.push(installExternalLinkHandler());

	interface PendingGrant extends NativeDiskGrant {
		queuedPath: string;
	}
	interface PendingDelivery {
		grants: PendingGrant[];
		rejected: Array<{ path: string; reason: string }>;
		remaining: number;
	}
	let openQueue = Promise.resolve();
	const drainPending = () => {
		const next = openQueue.then(async () => {
			const { invoke } = await import('@tauri-apps/api/core');
			const excludedPaths = new Set<string>();
			let remaining: number;
			do {
				const pending = await invoke<PendingDelivery>('take_pending_open_paths', {
					excludePaths: [...excludedPaths]
				});
				if (!pending || !Array.isArray(pending.grants) || !Array.isArray(pending.rejected))
					throw new Error('Invalid pending file delivery');
				remaining = pending.remaining;
				if (pending.rejected.length > 0) {
					const details = pending.rejected
						.slice(0, 5)
						.map(({ path, reason }) => `${path}: ${reason}`)
						.join('\n');
					reportError('fichiers desktop refusés', new Error(details), {
						notifyUser: t('page.openFromDiskError')
					});
					await invoke('ack_pending_open_paths', {
						processed: [],
						rejectedPaths: pending.rejected.map(({ path }) => path)
					});
				}
				if (pending.grants.length > 0) {
					const processedTokens = new Set(await handlers.onOpenPaths(pending.grants));
					const knownTokens = new Set(pending.grants.map(({ token }) => token));
					for (const token of processedTokens) {
						if (!knownTokens.has(token)) throw new Error('Unknown processed file capability');
					}
					const processed = pending.grants
						.filter(({ token }) => processedTokens.has(token))
						.map(({ token, queuedPath }) => ({ token, queuedPath }));
					for (const grant of pending.grants) {
						if (!processedTokens.has(grant.token)) excludedPaths.add(grant.queuedPath);
					}
					if (processed.length > 0)
						await invoke('ack_pending_open_paths', { processed, rejectedPaths: [] });
				}
				if (remaining > 0 && pending.grants.length === 0 && pending.rejected.length === 0)
					throw new Error('Pending file delivery made no progress');
			} while (remaining > 0);
		});
		openQueue = next.catch(() => {});
		return next;
	};

	try {
		const unlistenOpen = await listenOpenPaths(drainPending);
		unsubs.push(unlistenOpen);
	} catch (err) {
		reportWarning("initialisation de l'écoute des fichiers desktop", err);
	}

	try {
		await drainPending();
	} catch (err) {
		reportWarning('lecture des fichiers desktop en attente', err);
	}
	if (handlers.onBeforeClose) {
		try {
			unsubs.push(await installCloseGuard(handlers.onBeforeClose));
		} catch (err) {
			reportError('protection de fermeture desktop', err, {
				notifyUser: t('desktop.closeFailed')
			});
		}
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
				void Promise.resolve()
					.then(() => onAction(id))
					.catch((err: unknown) => {
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
	const previous = await menu.setAsAppMenu();
	await previous?.close();
}

async function listenOpenPaths(drainPending: () => Promise<void>): Promise<() => void> {
	const { listen } = await import('@tauri-apps/api/event');
	const unlisten = await listen('mdsh://open-paths-pending', () => {
		void drainPending().catch((err: unknown) => {
			reportError('ouverture depuis un événement desktop', err);
		});
	});
	return unlisten;
}

async function installCloseGuard(onBeforeClose: () => void | Promise<void>): Promise<() => void> {
	const [{ listen }, { invoke }] = await Promise.all([
		import('@tauri-apps/api/event'),
		import('@tauri-apps/api/core')
	]);
	let closing: Promise<void> | null = null;
	const reportCloseError = (err: unknown) => {
		reportError('fermeture desktop', err, { notifyUser: t('desktop.closeFailed') });
	};
	const unlisten = await listen<number>('mdsh://close-request', ({ payload: requestId }) => {
		// Accuser réception même pendant une sauvegarde évite de rejouer une
		// demande déjà traitée après un échec de persistance suivi d'un reload.
		const acknowledge = () => invoke<void>('desktop_ack_close_request', { requestId });
		if (closing) {
			void Promise.resolve().then(acknowledge).catch(reportCloseError);
			return;
		}
		closing = Promise.resolve()
			.then(acknowledge)
			.then(onBeforeClose)
			.then(() => invoke<void>('desktop_complete_close'))
			.catch(reportCloseError)
			.finally(() => {
				closing = null;
			});
	});
	try {
		await invoke('desktop_arm_close_guard');
	} catch (err) {
		unlisten();
		throw err;
	}
	return unlisten;
}

function installExternalLinkHandler(): () => void {
	const onClick = (event: MouseEvent) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const anchor = target.closest<HTMLAnchorElement>('a[href]');
		if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-mdsh-wiki')) return;
		const raw = anchor.getAttribute('href') ?? '';
		if (raw.startsWith('#')) return;
		let url: URL;
		try {
			url = new URL(anchor.href, window.location.href);
		} catch (err) {
			event.preventDefault();
			reportError('lien desktop', err, { notifyUser: t('desktop.linkFailed') });
			return;
		}
		if (url.origin === window.location.origin && url.pathname === window.location.pathname) return;
		event.preventDefault();
		event.stopPropagation();
		if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) {
			reportError('lien desktop', new Error('Unsupported external link'), {
				notifyUser: t('desktop.linkFailed')
			});
			return;
		}
		void import('@tauri-apps/api/core')
			.then(({ invoke }) => invoke('desktop_open_external', { url: url.href }))
			.catch((err: unknown) => {
				reportError('lien desktop', err, { notifyUser: t('desktop.linkFailed') });
			});
	};
	document.addEventListener('click', onClick, true);
	return () => document.removeEventListener('click', onClick, true);
}

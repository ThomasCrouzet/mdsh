import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	isDesktop: vi.fn(),
	reportError: vi.fn(),
	reportWarning: vi.fn(),
	invoke: vi.fn(),
	listen: vi.fn(),
	unlisten: vi.fn(),
	menuItemNew: vi.fn(),
	predefinedMenuItemNew: vi.fn(),
	submenuNew: vi.fn(),
	menuNew: vi.fn(),
	setAsAppMenu: vi.fn()
}));

vi.mock('./desktop', () => ({
	isDesktop: mocks.isDesktop
}));

vi.mock('./report', () => ({
	reportError: mocks.reportError,
	reportWarning: mocks.reportWarning
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: mocks.invoke
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: mocks.listen
}));

vi.mock('@tauri-apps/api/menu', () => ({
	Menu: { new: mocks.menuNew },
	MenuItem: { new: mocks.menuItemNew },
	PredefinedMenuItem: { new: mocks.predefinedMenuItemNew },
	Submenu: { new: mocks.submenuNew }
}));

import { initDesktopShell, type DesktopMenuAction, type DesktopMenuLabels } from './desktop-shell';

const labels: DesktopMenuLabels = {
	file: 'File',
	edit: 'Edit',
	newFile: 'New',
	open: 'Open',
	saveToDisk: 'Save to disk',
	exportMarkdown: 'Export Markdown',
	exportPdf: 'Export PDF',
	exportHtml: 'Export HTML',
	exportZip: 'Export ZIP',
	settings: 'Settings'
};

interface MenuItemOptions {
	id?: DesktopMenuAction;
	action?: () => void;
}

interface OpenEvent {
	payload: string[];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.isDesktop.mockReturnValue(false);
	mocks.invoke.mockResolvedValue([]);
	mocks.listen.mockResolvedValue(mocks.unlisten);
	mocks.menuItemNew.mockImplementation(async (options: unknown) => options);
	mocks.predefinedMenuItemNew.mockImplementation(async (options: unknown) => options);
	mocks.submenuNew.mockImplementation(async (options: unknown) => options);
	mocks.menuNew.mockResolvedValue({ setAsAppMenu: mocks.setAsAppMenu });
	mocks.setAsAppMenu.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('initDesktopShell', () => {
	it('is a no-op outside the desktop shell', async () => {
		const dispose = await initDesktopShell({
			onMenuAction: vi.fn(),
			onOpenPaths: vi.fn(),
			labels
		});

		dispose();
		expect(mocks.menuNew).not.toHaveBeenCalled();
		expect(mocks.listen).not.toHaveBeenCalled();
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it('installs the menu, handles pending paths and disposes the listener', async () => {
		mocks.isDesktop.mockReturnValue(true);
		mocks.invoke.mockResolvedValue(['/tmp/pending.md']);
		const onMenuAction = vi.fn(async () => {});
		const onOpenPaths = vi.fn(async () => {});

		const dispose = await initDesktopShell({ onMenuAction, onOpenPaths, labels });

		expect(mocks.setAsAppMenu).toHaveBeenCalledOnce();
		expect(mocks.listen).toHaveBeenCalledWith('mdsh://open-paths', expect.any(Function));
		expect(mocks.invoke).toHaveBeenCalledWith('take_pending_open_paths');
		expect(onOpenPaths).toHaveBeenCalledWith(['/tmp/pending.md']);

		const menuCalls = mocks.menuItemNew.mock.calls as unknown as Array<[MenuItemOptions]>;
		const newItem = menuCalls.map(([options]) => options).find((options) => options.id === 'new');
		newItem?.action?.();
		await vi.waitFor(() => expect(onMenuAction).toHaveBeenCalledWith('new'));

		const listenCalls = mocks.listen.mock.calls as unknown as Array<
			[string, (event: OpenEvent) => void]
		>;
		listenCalls[0]![1]({ payload: ['/tmp/event.md'] });
		await vi.waitFor(() => expect(onOpenPaths).toHaveBeenCalledWith(['/tmp/event.md']));

		dispose();
		expect(mocks.unlisten).toHaveBeenCalledOnce();
	});

	it('reports asynchronous handler failures', async () => {
		mocks.isDesktop.mockReturnValue(true);
		const onMenuAction = vi.fn(async () => {
			throw new Error('menu failed');
		});
		const onOpenPaths = vi.fn(async () => {
			throw new Error('open failed');
		});

		await initDesktopShell({ onMenuAction, onOpenPaths, labels });

		const menuCalls = mocks.menuItemNew.mock.calls as unknown as Array<[MenuItemOptions]>;
		menuCalls
			.map(([options]) => options)
			.find((options) => options.id === 'open')
			?.action?.();
		await vi.waitFor(() =>
			expect(mocks.reportError).toHaveBeenCalledWith(
				'action du menu desktop "open"',
				expect.any(Error)
			)
		);

		const listenCalls = mocks.listen.mock.calls as unknown as Array<
			[string, (event: OpenEvent) => void]
		>;
		listenCalls[0]![1]({ payload: ['/tmp/failing.md'] });
		await vi.waitFor(() =>
			expect(mocks.reportError).toHaveBeenCalledWith(
				'ouverture depuis un événement desktop',
				expect.any(Error)
			)
		);
	});

	it('reports initialization failures without aborting startup', async () => {
		mocks.isDesktop.mockReturnValue(true);
		mocks.menuItemNew.mockRejectedValueOnce(new Error('menu unavailable'));
		mocks.listen.mockRejectedValueOnce(new Error('events unavailable'));
		mocks.invoke.mockRejectedValueOnce(new Error('command unavailable'));

		await expect(
			initDesktopShell({
				onMenuAction: vi.fn(),
				onOpenPaths: vi.fn(),
				labels
			})
		).resolves.toEqual(expect.any(Function));

		expect(mocks.reportWarning).toHaveBeenCalledTimes(3);
	});

	it('ignores empty pending and event path lists', async () => {
		mocks.isDesktop.mockReturnValue(true);
		const onOpenPaths = vi.fn();

		await initDesktopShell({
			onMenuAction: vi.fn(),
			onOpenPaths,
			labels
		});

		const listenCalls = mocks.listen.mock.calls as unknown as Array<
			[string, (event: OpenEvent) => void]
		>;
		listenCalls[0]![1]({ payload: [] });
		expect(onOpenPaths).not.toHaveBeenCalled();
	});
});

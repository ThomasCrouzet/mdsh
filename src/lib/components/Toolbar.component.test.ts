// Unit tests for Toolbar.svelte with @testing-library/svelte.
//
// Toolbar exposes all callbacks through $props(): onToggleSidebar, onSetMode,
// onExport, onExportPDF, onOpenPalette, and onSaveToDisk.
// It reads `filesStore.active` to control buttons and show the file name. Set the store before each test.
//
// Coverage:
//  - Render the "Editing mode" radio group with three modes.
//  - Make aria-checked show the active mode from the prop.
//  - Call onSetMode with the correct mode when a mode button is clicked.
//  - Support ArrowRight and ArrowLeft navigation in the radio group.
//  - Always show the palette button and call onOpenPalette on click.
//  - Disable export and PDF buttons when no file is active.
//  - Enable export and PDF buttons when a file is active.
//  - Show the active file name in the rename input.

import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Toolbar from './Toolbar.svelte';
import { filesStore } from '$lib/files.svelte';
import type { FileItem } from '$lib/types';
import type { EditMode } from '$lib/types';

// ------------------------------------------------------------------
// Fixture
// ------------------------------------------------------------------

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
	return {
		id: 'toolbar-test-id',
		name: 'document.md',
		content: 'Contenu de test',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		dirty: false,
		linkedToDisk: false,
		...overrides
	};
}

function seedStore(file: FileItem | null) {
	if (file) {
		filesStore.files = [file];
		filesStore.activeId = file.id;
	} else {
		filesStore.files = [];
		filesStore.activeId = null;
	}
}

/** Minimum props required to render Toolbar. */
function defaultProps(mode: EditMode = 'wysiwyg') {
	return {
		mode,
		sidebarOpen: true,
		onToggleSidebar: vi.fn(),
		onSetMode: vi.fn(),
		onExport: vi.fn(),
		onExportPDF: vi.fn(),
		onOpenPalette: vi.fn(),
		onSaveToDisk: vi.fn()
	};
}

beforeEach(() => {
	seedStore(null);
});

// ------------------------------------------------------------------
// Test the mode radio group.
// ------------------------------------------------------------------

describe('Toolbar - edit mode radio group', () => {
	it('shows the three mode buttons', () => {
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		expect(screen.getByRole('radio', { name: /wysiwyg/i })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: /source/i })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: /lecture/i })).toBeInTheDocument();
	});

	it('checks WYSIWYG mode when mode is wysiwyg', () => {
		render(Toolbar, { props: defaultProps('wysiwyg') });

		expect(screen.getByRole('radio', { name: /wysiwyg/i })).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('radio', { name: /source/i })).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByRole('radio', { name: /lecture/i })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	it('checks source mode when mode is source', () => {
		render(Toolbar, { props: defaultProps('source') });

		expect(screen.getByRole('radio', { name: /source/i })).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('radio', { name: /wysiwyg/i })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	it('checks read mode when mode is read', () => {
		render(Toolbar, { props: defaultProps('read') });

		expect(screen.getByRole('radio', { name: /lecture/i })).toHaveAttribute('aria-checked', 'true');
	});
});

// ------------------------------------------------------------------
// Test mode callbacks.
// ------------------------------------------------------------------

describe('Toolbar - mode callbacks', () => {
	it('calls onSetMode with source after a Source mode click', async () => {
		const user = userEvent.setup();
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		await user.click(screen.getByRole('radio', { name: /source/i }));

		expect(props.onSetMode).toHaveBeenCalledOnce();
		expect(props.onSetMode).toHaveBeenCalledWith('source');
	});

	it('calls onSetMode with read after a Read mode click', async () => {
		const user = userEvent.setup();
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		await user.click(screen.getByRole('radio', { name: /lecture/i }));

		expect(props.onSetMode).toHaveBeenCalledOnce();
		expect(props.onSetMode).toHaveBeenCalledWith('read');
	});

	it('calls onSetMode with wysiwyg after a WYSIWYG mode click', async () => {
		const user = userEvent.setup();
		const props = defaultProps('source');
		render(Toolbar, { props });

		await user.click(screen.getByRole('radio', { name: /wysiwyg/i }));

		expect(props.onSetMode).toHaveBeenCalledOnce();
		expect(props.onSetMode).toHaveBeenCalledWith('wysiwyg');
	});
});

// ------------------------------------------------------------------
// Test keyboard navigation in the radio group.
// ------------------------------------------------------------------

describe('Toolbar - radio group keyboard navigation', () => {
	it('calls onSetMode with source after ArrowRight from wysiwyg', async () => {
		const user = userEvent.setup();
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		const radioGroup = screen.getByRole('radiogroup', { name: /mode d'édition/i });
		radioGroup.focus();
		await user.keyboard('{ArrowRight}');

		expect(props.onSetMode).toHaveBeenCalledWith('source');
	});

	it('wraps to read mode after ArrowLeft from wysiwyg', async () => {
		const user = userEvent.setup();
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		const radioGroup = screen.getByRole('radiogroup', { name: /mode d'édition/i });
		radioGroup.focus();
		await user.keyboard('{ArrowLeft}');

		expect(props.onSetMode).toHaveBeenCalledWith('read');
	});
});

// ------------------------------------------------------------------
// Test the palette button.
// ------------------------------------------------------------------

describe('Toolbar - command palette button', () => {
	it('shows the command palette button', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /palette de commandes/i })).toBeInTheDocument();
	});

	it('calls onOpenPalette after a palette button click', async () => {
		const user = userEvent.setup();
		const props = defaultProps();
		render(Toolbar, { props });

		await user.click(screen.getByRole('button', { name: /palette de commandes/i }));

		expect(props.onOpenPalette).toHaveBeenCalledOnce();
	});
});

// ------------------------------------------------------------------
// Test the disabled state with and without an active file.
// ------------------------------------------------------------------

describe('Toolbar - disabled buttons without an active file', () => {
	it('disables the Export button without an active file', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /^exporter$/i })).toBeDisabled();
	});

	it('disables the PDF export button without an active file', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /exporter en pdf/i })).toBeDisabled();
	});

	it('enables the Export button with an active file', () => {
		seedStore(makeFile());
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /^exporter$/i })).not.toBeDisabled();
	});

	it('enables the PDF export button with an active file', () => {
		seedStore(makeFile());
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /exporter en pdf/i })).not.toBeDisabled();
	});
});

// ------------------------------------------------------------------
// Test the file name display.
// ------------------------------------------------------------------

describe('Toolbar - active file name', () => {
	it('shows the active file name without its extension', () => {
		seedStore(makeFile({ name: 'mon-rapport.md' }));
		render(Toolbar, { props: defaultProps() });

		const input = screen.getByRole('textbox', { name: /nom du fichier/i }) as HTMLInputElement;
		expect(input.value).toBe('mon-rapport');
	});

	it('shows the no-file label without an active file', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByText(/aucun fichier ouvert/i)).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Test the sidebar callback.
// ------------------------------------------------------------------

describe('Toolbar - sidebar button', () => {
	it('calls onToggleSidebar after a Menu button click', async () => {
		const user = userEvent.setup();
		const props = defaultProps();
		render(Toolbar, { props });

		// There are mobile and desktop Menu buttons. Use the first visible button.
		const menuButtons = screen.getAllByRole('button', { name: /^menu$|^afficher/i });
		expect(menuButtons.length).toBeGreaterThan(0);
		await user.click(menuButtons[0]!);

		expect(props.onToggleSidebar).toHaveBeenCalledOnce();
	});
});

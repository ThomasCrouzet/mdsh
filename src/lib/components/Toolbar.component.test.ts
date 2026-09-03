// Tests unitaires de Toolbar.svelte via @testing-library/svelte.
//
// Toolbar expose tous ses callbacks via $props() (onToggleSidebar, onSetMode,
// onExport, onExportPDF, onOpenPalette, onSaveToDisk). Elle lit néanmoins
// `filesStore.active` pour conditionner les boutons (disabled si pas de fichier
// actif) et afficher le nom du fichier. On seed le store avant chaque test.
//
// Couverture :
//  - Rendu du radiogroup « Mode d'édition » avec les 3 modes.
//  - aria-checked reflète le mode actif passé en prop.
//  - Clic sur un bouton de mode appelle onSetMode avec le bon mode.
//  - Navigation clavier ArrowRight/ArrowLeft dans le radiogroup.
//  - Bouton palette toujours présent et déclenche onOpenPalette au clic.
//  - Boutons export/PDF désactivés (disabled) si pas de fichier actif.
//  - Boutons export/PDF actifs si un fichier est actif.
//  - Affichage du nom du fichier actif dans l'input de rename.

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

/** Props minimaux nécessaires pour rendre Toolbar. */
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
// Tests - radiogroup des modes
// ------------------------------------------------------------------

describe("Toolbar - radiogroup modes d'édition", () => {
	it('affiche les 3 boutons de mode', () => {
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		expect(screen.getByRole('radio', { name: /wysiwyg/i })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: /source/i })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: /lecture/i })).toBeInTheDocument();
	});

	it('marque le mode wysiwyg comme coché quand mode="wysiwyg"', () => {
		render(Toolbar, { props: defaultProps('wysiwyg') });

		expect(screen.getByRole('radio', { name: /wysiwyg/i })).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('radio', { name: /source/i })).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByRole('radio', { name: /lecture/i })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	it('marque le mode source comme coché quand mode="source"', () => {
		render(Toolbar, { props: defaultProps('source') });

		expect(screen.getByRole('radio', { name: /source/i })).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('radio', { name: /wysiwyg/i })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	it('marque le mode lecture comme coché quand mode="read"', () => {
		render(Toolbar, { props: defaultProps('read') });

		expect(screen.getByRole('radio', { name: /lecture/i })).toHaveAttribute('aria-checked', 'true');
	});
});

// ------------------------------------------------------------------
// Tests - callbacks des modes
// ------------------------------------------------------------------

describe('Toolbar - callbacks de mode', () => {
	it('appelle onSetMode("source") au clic sur Mode source', async () => {
		const user = userEvent.setup();
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		await user.click(screen.getByRole('radio', { name: /source/i }));

		expect(props.onSetMode).toHaveBeenCalledOnce();
		expect(props.onSetMode).toHaveBeenCalledWith('source');
	});

	it('appelle onSetMode("read") au clic sur Mode lecture', async () => {
		const user = userEvent.setup();
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		await user.click(screen.getByRole('radio', { name: /lecture/i }));

		expect(props.onSetMode).toHaveBeenCalledOnce();
		expect(props.onSetMode).toHaveBeenCalledWith('read');
	});

	it('appelle onSetMode("wysiwyg") au clic sur Mode WYSIWYG', async () => {
		const user = userEvent.setup();
		const props = defaultProps('source');
		render(Toolbar, { props });

		await user.click(screen.getByRole('radio', { name: /wysiwyg/i }));

		expect(props.onSetMode).toHaveBeenCalledOnce();
		expect(props.onSetMode).toHaveBeenCalledWith('wysiwyg');
	});
});

// ------------------------------------------------------------------
// Tests - navigation clavier dans le radiogroup
// ------------------------------------------------------------------

describe('Toolbar - navigation clavier radiogroup', () => {
	it('ArrowRight depuis wysiwyg appelle onSetMode("source")', async () => {
		const user = userEvent.setup();
		const props = defaultProps('wysiwyg');
		render(Toolbar, { props });

		const radioGroup = screen.getByRole('radiogroup', { name: /mode d'édition/i });
		radioGroup.focus();
		await user.keyboard('{ArrowRight}');

		expect(props.onSetMode).toHaveBeenCalledWith('source');
	});

	it('ArrowLeft depuis wysiwyg appelle onSetMode("read") (cycle)', async () => {
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
// Tests - bouton palette
// ------------------------------------------------------------------

describe('Toolbar - bouton palette', () => {
	it('affiche le bouton palette de commandes', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /palette de commandes/i })).toBeInTheDocument();
	});

	it('appelle onOpenPalette au clic sur la palette', async () => {
		const user = userEvent.setup();
		const props = defaultProps();
		render(Toolbar, { props });

		await user.click(screen.getByRole('button', { name: /palette de commandes/i }));

		expect(props.onOpenPalette).toHaveBeenCalledOnce();
	});
});

// ------------------------------------------------------------------
// Tests - état disabled selon fichier actif
// ------------------------------------------------------------------

describe('Toolbar - boutons désactivés sans fichier actif', () => {
	it('le bouton Exporter est désactivé si pas de fichier actif', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /^exporter$/i })).toBeDisabled();
	});

	it('le bouton Exporter en PDF est désactivé si pas de fichier actif', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /exporter en pdf/i })).toBeDisabled();
	});

	it('le bouton Exporter est actif si un fichier est actif', () => {
		seedStore(makeFile());
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /^exporter$/i })).not.toBeDisabled();
	});

	it('le bouton Exporter en PDF est actif si un fichier est actif', () => {
		seedStore(makeFile());
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByRole('button', { name: /exporter en pdf/i })).not.toBeDisabled();
	});
});

// ------------------------------------------------------------------
// Tests - affichage du nom de fichier
// ------------------------------------------------------------------

describe('Toolbar - nom du fichier actif', () => {
	it("affiche le nom du fichier sans extension dans l'input", () => {
		seedStore(makeFile({ name: 'mon-rapport.md' }));
		render(Toolbar, { props: defaultProps() });

		const input = screen.getByRole('textbox', { name: /nom du fichier/i }) as HTMLInputElement;
		expect(input.value).toBe('mon-rapport');
	});

	it('affiche « Aucun fichier ouvert » si pas de fichier actif', () => {
		render(Toolbar, { props: defaultProps() });
		expect(screen.getByText(/aucun fichier ouvert/i)).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests - callback sidebar
// ------------------------------------------------------------------

describe('Toolbar - bouton sidebar', () => {
	it('appelle onToggleSidebar au clic sur le bouton Menu', async () => {
		const user = userEvent.setup();
		const props = defaultProps();
		render(Toolbar, { props });

		// Il y a deux boutons Menu (mobile + desktop) - on prend le premier visible.
		const menuButtons = screen.getAllByRole('button', { name: /^menu$|^afficher/i });
		expect(menuButtons.length).toBeGreaterThan(0);
		await user.click(menuButtons[0]!);

		expect(props.onToggleSidebar).toHaveBeenCalledOnce();
	});
});

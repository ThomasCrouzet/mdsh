// Tests unitaires de PromptModal.svelte via @testing-library/svelte.
//
// PromptModal est 100 % props-driven ($props()) - aucune dépendance au store
// singleton. Testable en isolation totale.
//
// Couverture :
//  - Rendu en mode `prompt` : titre, input texte, boutons OK/Annuler.
//  - Rendu en mode `confirm` : titre, message, boutons.
//  - Soumission mode prompt via bouton OK → `onResolve` reçoit la valeur.
//  - Soumission mode prompt via touche Entrée → `onResolve` reçoit la valeur.
//  - Annulation via bouton Annuler → `onResolve(null)`.
//  - Annulation via touche Escape → `onResolve(null)`.
//  - Annulation via clic fond modal → `onResolve(null)`.
//  - Confirmation mode confirm via bouton OK → `onResolve(true)`.
//  - Annulation mode confirm via bouton Annuler → `onResolve(false)`.
//  - Composant non affiché si `open = false`.
//  - `defaultValue` pré-remplit l'input.
//  - `danger = true` : libellé bouton confirm personnalisé.

import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import PromptModal from './PromptModal.svelte';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function renderPrompt(overrides: Record<string, unknown> = {}) {
	const onResolve = vi.fn();
	const { rerender, unmount } = render(PromptModal, {
		props: {
			open: true,
			mode: 'prompt' as const,
			title: 'Nom du fichier ?',
			defaultValue: '',
			onResolve,
			...overrides
		}
	});
	return { onResolve, rerender, unmount };
}

function renderConfirm(overrides: Record<string, unknown> = {}) {
	const onResolve = vi.fn();
	const { rerender, unmount } = render(PromptModal, {
		props: {
			open: true,
			mode: 'confirm' as const,
			title: 'Supprimer ?',
			message: 'Cette action est irréversible.',
			onResolve,
			...overrides
		}
	});
	return { onResolve, rerender, unmount };
}

// ------------------------------------------------------------------
// Tests - rendu initial
// ------------------------------------------------------------------

describe('PromptModal - rendu', () => {
	it('affiche le titre en mode prompt', () => {
		renderPrompt({ title: 'Saisir un nom' });
		expect(screen.getByRole('heading', { name: /saisir un nom/i })).toBeInTheDocument();
	});

	it('affiche le champ texte et les boutons OK / Annuler en mode prompt', () => {
		renderPrompt();
		expect(screen.getByRole('textbox')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /annuler/i })).toBeInTheDocument();
	});

	it('affiche le titre et le message en mode confirm', () => {
		renderConfirm();
		expect(screen.getByRole('heading', { name: /supprimer/i })).toBeInTheDocument();
		expect(screen.getByText(/cette action est irréversible/i)).toBeInTheDocument();
	});

	it("n'affiche rien si open = false", () => {
		render(PromptModal, {
			props: {
				open: false,
				mode: 'prompt' as const,
				title: 'Test',
				onResolve: vi.fn()
			}
		});
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it("pré-remplit l'input avec defaultValue", () => {
		renderPrompt({ defaultValue: 'mon-fichier' });
		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input.value).toBe('mon-fichier');
	});

	it('affiche un libellé personnalisé via confirmLabel', () => {
		renderConfirm({ confirmLabel: 'Supprimer définitivement', danger: true });
		expect(screen.getByRole('button', { name: /supprimer définitivement/i })).toBeInTheDocument();
	});

	it('a l\'attribut ARIA role="dialog"', () => {
		renderPrompt();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests - interactions mode prompt
// ------------------------------------------------------------------

describe('PromptModal - mode prompt : interactions', () => {
	it('appelle onResolve avec la valeur saisie au clic sur OK', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderPrompt({ defaultValue: 'initial' });

		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'nouveau-nom');
		await user.click(screen.getByRole('button', { name: /^ok$/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith('nouveau-nom');
	});

	it('appelle onResolve avec la valeur saisie via touche Entrée', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderPrompt({ defaultValue: '' });

		const input = screen.getByRole('textbox');
		await user.type(input, 'entrée-test{Enter}');

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith('entrée-test');
	});

	it('appelle onResolve(null) au clic sur Annuler', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderPrompt();

		await user.click(screen.getByRole('button', { name: /annuler/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(null);
	});

	it('appelle onResolve(null) via touche Escape', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderPrompt();

		const dialog = screen.getByRole('dialog');
		dialog.focus();
		await user.keyboard('{Escape}');

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(null);
	});
});

// ------------------------------------------------------------------
// Tests - interactions mode confirm
// ------------------------------------------------------------------

describe('PromptModal - mode confirm : interactions', () => {
	it('appelle onResolve(true) au clic sur Confirmer', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderConfirm({ confirmLabel: 'Confirmer' });

		await user.click(screen.getByRole('button', { name: /confirmer/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(true);
	});

	it('appelle onResolve(false) au clic sur Annuler', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderConfirm();

		await user.click(screen.getByRole('button', { name: /annuler/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(false);
	});

	it('appelle onResolve(false) via touche Escape en mode confirm', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderConfirm();

		const dialog = screen.getByRole('dialog');
		dialog.focus();
		await user.keyboard('{Escape}');

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(false);
	});

	it('affiche le bouton Confirmer par défaut si aucun confirmLabel', () => {
		renderConfirm();
		expect(screen.getByRole('button', { name: /confirmer/i })).toBeInTheDocument();
	});
});

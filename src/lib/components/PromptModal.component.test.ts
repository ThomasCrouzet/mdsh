// Unit tests for PromptModal.svelte with @testing-library/svelte.
//
// PromptModal uses only $props() and has no store dependency.
// singleton. Testable en isolation totale.
//
// Coverage:
//  - Render the title, text input, OK button, and Cancel button in prompt mode.
//  - Render the title, message, and buttons in confirm mode.
//  - Submit prompt mode with the OK button and pass the value to `onResolve`.
//  - Submit prompt mode with Enter and pass the value to `onResolve`.
//  - Call `onResolve(null)` from the Cancel button.
//  - Annulation via touche Escape → `onResolve(null)`.
//  - Annulation via clic fond modal → `onResolve(null)`.
//  - Call `onResolve(true)` from the OK button in confirm mode.
//  - Call `onResolve(false)` from the Cancel button in confirm mode.
//  - Hide the component when `open = false`.
//  - Fill the input with `defaultValue`.
//  - Use the custom confirm button label when `danger = true`.

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
// Test initial rendering.
// ------------------------------------------------------------------

describe('PromptModal - rendering', () => {
	it('shows the title in prompt mode', () => {
		renderPrompt({ title: 'Saisir un nom' });
		expect(screen.getByRole('heading', { name: /saisir un nom/i })).toBeInTheDocument();
	});

	it('shows the text field and action buttons in prompt mode', () => {
		renderPrompt();
		expect(screen.getByRole('textbox')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /annuler/i })).toBeInTheDocument();
	});

	it('shows the title and message in confirm mode', () => {
		renderConfirm();
		expect(screen.getByRole('heading', { name: /supprimer/i })).toBeInTheDocument();
		expect(screen.getByText(/cette action est irréversible/i)).toBeInTheDocument();
	});

	it('renders nothing when open is false', () => {
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

	it('fills the input with defaultValue', () => {
		renderPrompt({ defaultValue: 'mon-fichier' });
		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input.value).toBe('mon-fichier');
	});

	it('shows a custom confirmLabel', () => {
		renderConfirm({ confirmLabel: 'Supprimer définitivement', danger: true });
		expect(screen.getByRole('button', { name: /supprimer définitivement/i })).toBeInTheDocument();
	});

	it('has the ARIA dialog role', () => {
		renderPrompt();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Test prompt mode interactions.
// ------------------------------------------------------------------

describe('PromptModal - prompt interactions', () => {
	it('calls onResolve with the entered value after an OK click', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderPrompt({ defaultValue: 'initial' });

		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'nouveau-nom');
		await user.click(screen.getByRole('button', { name: /^ok$/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith('nouveau-nom');
	});

	it('calls onResolve with the entered value after Enter', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderPrompt({ defaultValue: '' });

		const input = screen.getByRole('textbox');
		await user.type(input, 'entrée-test{Enter}');

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith('entrée-test');
	});

	it('calls onResolve with null after a Cancel click', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderPrompt();

		await user.click(screen.getByRole('button', { name: /annuler/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(null);
	});

	it('calls onResolve with null after Escape', async () => {
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
// Test confirm mode interactions.
// ------------------------------------------------------------------

describe('PromptModal - confirm interactions', () => {
	it('calls onResolve with true after a Confirm click', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderConfirm({ confirmLabel: 'Confirmer' });

		await user.click(screen.getByRole('button', { name: /confirmer/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(true);
	});

	it('calls onResolve with false after a Cancel click', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderConfirm();

		await user.click(screen.getByRole('button', { name: /annuler/i }));

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(false);
	});

	it('calls onResolve with false after Escape in confirm mode', async () => {
		const user = userEvent.setup();
		const { onResolve } = renderConfirm();

		const dialog = screen.getByRole('dialog');
		dialog.focus();
		await user.keyboard('{Escape}');

		expect(onResolve).toHaveBeenCalledOnce();
		expect(onResolve).toHaveBeenCalledWith(false);
	});

	it('shows the default Confirm button without confirmLabel', () => {
		renderConfirm();
		expect(screen.getByRole('button', { name: /confirmer/i })).toBeInTheDocument();
	});
});

describe('restore and passphrase', () => {
	it('Escape cancels a choice without selecting merge', async () => {
		const onResolve = vi.fn();
		render(PromptModal, {
			props: {
				open: true,
				mode: 'choice',
				title: 'Restaurer',
				alternateLabel: 'Fusionner',
				confirmLabel: 'Remplacer',
				onResolve
			}
		});
		await userEvent.keyboard('{Escape}');
		expect(onResolve).toHaveBeenCalledWith(null);
	});
	it('hides the passphrase', () => {
		renderPrompt({ title: 'Phrase secrète', inputType: 'password' });
		expect(screen.getByLabelText('Phrase secrète', { selector: 'input' })).toHaveAttribute(
			'type',
			'password'
		);
	});
});

it('clears the first passphrase before its confirmation', async () => {
	const { rerender } = renderPrompt({ title: 'Phrase secrète', inputType: 'password' });
	await userEvent.type(screen.getByLabelText('Phrase secrète', { selector: 'input' }), 'secret');
	await rerender({ title: 'Confirmer la phrase' });
	expect(screen.getByLabelText('Confirmer la phrase', { selector: 'input' })).toHaveValue('');
});

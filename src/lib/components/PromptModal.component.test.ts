import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { it, expect, vi } from 'vitest';
import PromptModal from './PromptModal.svelte';

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

it('clears the first passphrase before its confirmation', async () => {
	const { rerender } = renderPrompt({ title: 'Phrase secrète', inputType: 'password' });
	await userEvent.type(screen.getByLabelText('Phrase secrète', { selector: 'input' }), 'secret');
	await rerender({ title: 'Confirmer la phrase' });
	expect(screen.getByLabelText('Confirmer la phrase', { selector: 'input' })).toHaveValue('');
});

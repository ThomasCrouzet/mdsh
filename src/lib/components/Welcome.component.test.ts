// Unit tests for Welcome.svelte - the three primary CTAs on the empty state.
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Welcome from './Welcome.svelte';

describe('Welcome', () => {
	it('renders new / import / demo actions', () => {
		render(Welcome, {
			props: { onNew: vi.fn(), onImport: vi.fn(), onDemo: vi.fn() }
		});
		expect(screen.getByTestId('welcome-new')).toBeInTheDocument();
		expect(screen.getByTestId('welcome-import')).toBeInTheDocument();
		expect(screen.getByTestId('welcome-demo')).toBeInTheDocument();
	});

	it('fires onNew when the new-file button is clicked', async () => {
		const user = userEvent.setup();
		const onNew = vi.fn();
		render(Welcome, {
			props: { onNew, onImport: vi.fn(), onDemo: vi.fn() }
		});
		await user.click(screen.getByTestId('welcome-new'));
		expect(onNew).toHaveBeenCalledOnce();
	});

	it('fires onImport and onDemo', async () => {
		const user = userEvent.setup();
		const onImport = vi.fn();
		const onDemo = vi.fn();
		render(Welcome, {
			props: { onNew: vi.fn(), onImport, onDemo }
		});
		await user.click(screen.getByTestId('welcome-import'));
		await user.click(screen.getByTestId('welcome-demo'));
		expect(onImport).toHaveBeenCalledOnce();
		expect(onDemo).toHaveBeenCalledOnce();
	});
});

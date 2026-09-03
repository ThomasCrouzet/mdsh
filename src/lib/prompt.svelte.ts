// §B1.3 - Singleton store to drive PromptModal from any component via a
// promise-based API: `await promptStore.prompt(...)`,
// `await promptStore.confirm(...)`. Replaces the native `window.prompt` /
// `window.confirm` (inconsistent style, dark-mode ignored, focus trap not
// guaranteed, variable SR support).
//
// The `PromptModal.svelte` component is mounted as a singleton in `+page.svelte`
// and reads this store. Only one modal active at a time - a concurrent call
// automatically rejects the previous one (resolving `null`/`false`).

export interface PromptConfig {
	mode: 'prompt' | 'confirm' | 'choice';
	title: string;
	message?: string;
	defaultValue?: string;
	placeholder?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	alternateLabel?: string;
	inputType?: 'text' | 'password';
	danger?: boolean;
}

class PromptStore {
	open = $state(false);
	config = $state<PromptConfig | null>(null);

	private resolver: ((v: string | boolean | null) => void) | null = null;

	/** Opens a text-input modal. Returns the value or `null` if cancelled. */
	prompt(opts: Omit<PromptConfig, 'mode'> & { defaultValue?: string }): Promise<string | null> {
		return new Promise<string | null>((resolve) => {
			// If a modal is already open, cancel the old one so as not to leave
			// a pending promise. UX: a concurrent call wants to replace the old
			// dialog.
			this.cancel();
			this.config = { mode: 'prompt', ...opts };
			this.open = true;
			this.resolver = (v) => resolve(typeof v === 'string' ? v : null);
		});
	}

	/** Opens a confirmation modal. Returns `true` if confirmed, `false` otherwise. */
	confirm(opts: Omit<PromptConfig, 'mode' | 'defaultValue' | 'placeholder'>): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.cancel();
			this.config = { mode: 'confirm', ...opts };
			this.open = true;
			this.resolver = (v) => resolve(v === true);
		});
	}

	/** Opens a three-way decision. Closing always returns `null`. */
	choose(
		opts: Omit<PromptConfig, 'mode' | 'defaultValue' | 'placeholder' | 'alternateLabel'> & {
			alternateLabel: string;
		}
	): Promise<'primary' | 'alternate' | null> {
		return new Promise((resolve) => {
			this.cancel();
			this.config = { mode: 'choice', ...opts };
			this.open = true;
			this.resolver = (value) => {
				resolve(value === 'primary' || value === 'alternate' ? value : null);
			};
		});
	}

	/** Called by `PromptModal.onResolve` - propagates the value to the caller. */
	resolve(value: string | boolean | null): void {
		const r = this.resolver;
		this.resolver = null;
		this.open = false;
		// Purge `config` too: otherwise the `{#if promptStore.config}` on the
		// +page.svelte side keeps the component mounted indefinitely after close
		// (DOM still present, just invisible via the internal `{#if open}`).
		this.config = null;
		r?.(value);
	}

	/** Forces the close, signaling a cancellation to the caller. */
	private cancel(): void {
		if (!this.resolver) return;
		this.resolve(null);
	}
}

export const promptStore = new PromptStore();

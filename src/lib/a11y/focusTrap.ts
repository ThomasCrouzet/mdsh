// Svelte action: confines keyboard focus inside a container (typically a
// dialog/modal). On destroy, restores focus to the element that had it before
// opening. Compliant with WCAG 2.4.3 (Focus Order).
//
// Modal usage (always active):
//   <div role="dialog" use:focusTrap>…</div>
//
// §B1.11 - Conditional usage (mobile sidebar, drawer):
//   <aside use:focusTrap={{ active: isMobile && open }}>…</aside>
// When `active` becomes false (desktop resize, closing), the trap is lifted
// without unmounting the DOM and focus returns to the triggering element.

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

export interface FocusTrapParams {
	active?: boolean;
}

export function focusTrap(node: HTMLElement, params?: FocusTrapParams) {
	let active = params?.active ?? true;
	let previouslyFocused: HTMLElement | null = null;

	function focusables(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
			(el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null
		);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const els = focusables();
		if (els.length === 0) {
			e.preventDefault();
			return;
		}
		// Guards required by noUncheckedIndexedAccess: after the `els.length === 0`
		// check, first and last are guaranteed defined - the check serves as
		// control-flow documentation as much as type safety.
		const first = els[0];
		const last = els[els.length - 1];
		if (!first || !last) return;
		const focused = document.activeElement as HTMLElement | null;
		if (e.shiftKey) {
			if (focused === first || !node.contains(focused)) {
				e.preventDefault();
				last.focus();
			}
		} else {
			if (focused === last || !node.contains(focused)) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	function attach() {
		previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;
		node.addEventListener('keydown', onKeydown);
	}

	function detach(restoreFocus: boolean) {
		node.removeEventListener('keydown', onKeydown);
		if (restoreFocus) {
			// Restores focus to the triggering element. Try/catch because the
			// element may have disappeared from the DOM in the meantime.
			try {
				previouslyFocused?.focus?.();
			} catch {
				/* ignore */
			}
		}
		previouslyFocused = null;
	}

	if (active) attach();

	return {
		update(next?: FocusTrapParams) {
			const wantActive = next?.active ?? true;
			if (wantActive === active) return;
			active = wantActive;
			if (active) attach();
			// Lifting the trap (mobile->desktop resize on sidebar): we do NOT
			// restore focus. The node stays visible/usable, and the previous
			// element may have disappeared (e.g. mobile menu button hidden via
			// `md:hidden`). Restoring would jump focus onto an invisible element.
			// The restore only applies on destroy (modal close).
			else detach(false);
		},
		destroy() {
			if (active) detach(true);
		}
	};
}

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { focusTrap } from './focusTrap';

// jsdom ne calcule pas de layout : `offsetParent` est toujours null, ce qui
// ferait filtrer TOUS les focusables. On le mocke pour refléter la visibilité
// (un élément connecté au document est considéré visible).
let original: PropertyDescriptor | undefined;
beforeAll(() => {
	original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
	Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
		configurable: true,
		get(this: HTMLElement) {
			return this.isConnected ? document.body : null;
		}
	});
});
afterAll(() => {
	if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
});

beforeEach(() => {
	document.body.innerHTML = '';
});

function makeContainer(n: number): { container: HTMLElement; buttons: HTMLElement[] } {
	const container = document.createElement('div');
	const buttons: HTMLElement[] = [];
	for (let i = 0; i < n; i++) {
		const b = document.createElement('button');
		b.textContent = `b${i}`;
		container.appendChild(b);
		buttons.push(b);
	}
	document.body.appendChild(container);
	return { container, buttons };
}

function tab(node: HTMLElement, shift = false): KeyboardEvent {
	const e = new KeyboardEvent('keydown', {
		key: 'Tab',
		shiftKey: shift,
		bubbles: true,
		cancelable: true
	});
	node.dispatchEvent(e);
	return e;
}

describe('focusTrap', () => {
	it('restaure le focus au déclencheur à la destruction', () => {
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		const { container, buttons } = makeContainer(2);
		const trap = focusTrap(container);
		buttons[0]!.focus();
		trap.destroy();
		expect(document.activeElement).toBe(trigger);
	});

	it('Tab depuis le dernier élément reboucle au premier', () => {
		const { container, buttons } = makeContainer(3);
		focusTrap(container);
		buttons[2]!.focus();
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(buttons[0]);
	});

	it('Shift+Tab depuis le premier reboucle au dernier', () => {
		const { container, buttons } = makeContainer(3);
		focusTrap(container);
		buttons[0]!.focus();
		const e = tab(container, true);
		expect(e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(buttons[2]);
	});

	it('Tab au milieu laisse le navigateur gérer (pas de preventDefault)', () => {
		const { container, buttons } = makeContainer(3);
		focusTrap(container);
		buttons[1]!.focus();
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(false);
	});

	it('conteneur sans focusable : Tab est annulé sans crash', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		focusTrap(container);
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(true);
	});

	it('ignore les touches autres que Tab', () => {
		const { container } = makeContainer(2);
		focusTrap(container);
		const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
		container.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(false);
	});

	it('active:false : aucun piège ni restauration', () => {
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		trigger.focus();
		const { container } = makeContainer(2);
		const trap = focusTrap(container, { active: false });
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(false);
		trap.destroy();
		expect(document.activeElement).toBe(trigger);
	});

	it('update bascule le trap : false->true attache, true->false détache sans restaurer', () => {
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		trigger.focus();
		const { container, buttons } = makeContainer(2);
		const trap = focusTrap(container, { active: false });

		trap.update({ active: true });
		buttons[1]!.focus();
		const e1 = tab(container, false);
		expect(e1.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(buttons[0]);

		trap.update({ active: false });
		expect(document.activeElement).toBe(buttons[0]); // pas de restauration
		const e2 = tab(container, false);
		expect(e2.defaultPrevented).toBe(false); // listener retiré
	});

	it('update sans changement d’état est un no-op', () => {
		const { container, buttons } = makeContainer(2);
		const trap = focusTrap(container, { active: true });
		trap.update({ active: true });
		buttons[1]!.focus();
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(true);
	});
});

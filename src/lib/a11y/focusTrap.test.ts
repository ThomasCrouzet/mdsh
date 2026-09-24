import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { focusTrap } from './focusTrap';

// Treat connected elements as visible because jsdom does not calculate layout.
let original: PropertyDescriptor | undefined;
beforeAll(() => {
	original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getClientRects');
	Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
		configurable: true,
		value(this: HTMLElement) {
			return this.isConnected ? [{}] : [];
		}
	});
});
afterAll(() => {
	if (original) Object.defineProperty(HTMLElement.prototype, 'getClientRects', original);
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
	it('prevents Tab without an error when the container has no focusable element', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		focusTrap(container);
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(true);
	});

	it('attaches and detaches the trap when active changes', () => {
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
		expect(document.activeElement).toBe(buttons[0]);
		const e2 = tab(container, false);
		expect(e2.defaultPrevented).toBe(false);
	});
});

it('excludes tabindex=-1 results from the last Tab target', () => {
	const { container, buttons } = makeContainer(3);
	buttons[2]!.tabIndex = -1;
	focusTrap(container);
	buttons[1]!.focus();
	expect(tab(container).defaultPrevented).toBe(true);
	expect(document.activeElement).toBe(buttons[0]);
});

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { focusTrap } from './focusTrap';

// jsdom does not calculate layout, so `getClientRects` is always empty.
// This would filter all focusable elements.
// Mock it so that an element connected to the document is visible.
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
	it('restores focus to the trigger on destroy', () => {
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

	it('wraps Tab from the last element to the first element', () => {
		const { container, buttons } = makeContainer(3);
		focusTrap(container);
		buttons[2]!.focus();
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(buttons[0]);
	});

	it('wraps Shift+Tab from the first element to the last element', () => {
		const { container, buttons } = makeContainer(3);
		focusTrap(container);
		buttons[0]!.focus();
		const e = tab(container, true);
		expect(e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(buttons[2]);
	});

	it('lets the browser handle Tab from a middle element', () => {
		const { container, buttons } = makeContainer(3);
		focusTrap(container);
		buttons[1]!.focus();
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(false);
	});

	it('prevents Tab without an error when the container has no focusable element', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		focusTrap(container);
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(true);
	});

	it('ignores keys other than Tab', () => {
		const { container } = makeContainer(2);
		focusTrap(container);
		const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
		container.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(false);
	});

	it('does not trap or restore focus when active is false', () => {
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
		expect(document.activeElement).toBe(buttons[0]); // pas de restauration
		const e2 = tab(container, false);
		expect(e2.defaultPrevented).toBe(false); // listener retiré
	});

	it('does nothing when an update does not change active', () => {
		const { container, buttons } = makeContainer(2);
		const trap = focusTrap(container, { active: true });
		trap.update({ active: true });
		buttons[1]!.focus();
		const e = tab(container, false);
		expect(e.defaultPrevented).toBe(true);
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

it('restores the trigger after the drawer closes', () => {
	const trigger = document.createElement('button');
	document.body.append(trigger);
	trigger.focus();
	const { container, buttons } = makeContainer(2);
	const trap = focusTrap(container, { active: true });
	buttons[0]!.focus();
	trap.update({ active: false, restoreOnDeactivate: true });
	expect(document.activeElement).toBe(trigger);
});

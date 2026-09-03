import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile, switchToSource, writeSourceContent } from './helpers';

test.describe('Golden path - persistance cycle de vie', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('crée un fichier, tape du contenu, recharge, contenu intact', async ({ page }) => {
		await createFirstFile(page);
		// Bascule en mode source via le bouton UI - garantit CodeMirror visible
		// y compris sur WebKit où le localStorage forcé par resetAppState peut ne
		// pas être persisté avant le reload (comportement WebKit sandbox IDB).
		await switchToSource(page);
		const cm = page.locator('.cm-content').first();
		await expect(cm).toBeVisible({ timeout: 10_000 });

		const payload = 'Bonjour\n\nContenu de test E2E';
		await cm.click();
		// CodeMirror est un contenteditable - on tape via le clavier pour simuler l'input réel.
		await page.keyboard.type(payload);

		// Attendre le debounce save (400 ms) + marge
		await page.waitForTimeout(800);

		// Recharger
		await page.reload();
		// Sur WebKit, le mode n'est pas toujours restauré via localStorage après reload
		// → on repasse explicitement en source avant de lire le contenu.
		await switchToSource(page);
		const cmAfter = page.locator('.cm-content').first();
		await expect(cmAfter).toBeVisible({ timeout: 10_000 });
		// CodeMirror rend chaque ligne dans un .cm-line ; on assemble pour comparer.
		await expect(async () => {
			const text = await cmAfter.evaluate((el) => {
				const lines = el.querySelectorAll('.cm-line');
				return Array.from(lines)
					.map((l) =>
						(l.textContent ?? '').replace(new RegExp(String.fromCharCode(0x200b), 'g'), '')
					)
					.join('\n');
			});
			expect(text).toBe(payload);
		}).toPass({ timeout: 10_000 });
	});

	test('chargement lent: bloque clic, raccourci et dépôt puis conserve les créations', async ({
		page
	}) => {
		await createFirstFile(page);
		await writeSourceContent(page, 'Document conservé avant rechargement');
		const readDrafts = () =>
			page.evaluate(
				() =>
					new Promise<Array<{ content: string }>>((resolve, reject) => {
						const request = indexedDB.open('mdsh');
						request.onerror = () => reject(request.error);
						request.onsuccess = () => {
							const database = request.result;
							const transaction = database.transaction('drafts');
							const rows = transaction.objectStore('drafts').getAll();
							rows.onsuccess = () => resolve(rows.result);
							rows.onerror = () => reject(rows.error);
							transaction.oncomplete = () => database.close();
						};
					})
			);
		await expect
			.poll(async () => (await readDrafts()).map((row) => row.content))
			.toEqual(['Document conservé avant rechargement']);

		// Retient le résultat initial réellement lu par Dexie. La transaction reste
		// vivante avec count(), sans retarder le réseau ni changer les données.
		await page.addInitScript(() => {
			if (sessionStorage.getItem('mdsh:test:read-gate')) return;
			sessionStorage.setItem('mdsh:test:read-gate', 'used');
			const gate = { blocked: false, release: () => {} };
			(window as typeof window & { mdshReadGate: typeof gate }).mdshReadGate = gate;
			const original = IDBIndex.prototype.getAll;
			IDBIndex.prototype.getAll = function (...args: Parameters<IDBIndex['getAll']>) {
				const request = original.apply(this, args);
				if (this.name !== 'order' || this.objectStore.name !== 'drafts' || gate.blocked)
					return request;
				const store = this.objectStore;
				request.addEventListener(
					'success',
					(event) => {
						event.stopImmediatePropagation();
						gate.blocked = true;
						let released = false;
						const keepAlive = () => {
							store.count().onsuccess = () => {
								if (!released) keepAlive();
							};
						};
						keepAlive();
						gate.release = () => {
							released = true;
							request.dispatchEvent(new Event('success'));
						};
					},
					{ once: true }
				);
				return request;
			};
		});
		await page.reload();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as typeof window & { mdshReadGate?: { blocked: boolean } }).mdshReadGate
							?.blocked
				)
			)
			.toBe(true);
		const shell = page.locator('.mdsh-shell');
		await expect(shell).toHaveAttribute('aria-busy', 'true');
		await expect(shell).toHaveAttribute('inert', '');
		const button = page.getByTestId('welcome-new');
		const box = await button.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.keyboard.press('ControlOrMeta+n');
		const dropPrevented = await page.evaluate(() => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(['Document déposé trop tôt'], 'before-ready.md', { type: 'text/markdown' })
			);
			const event = new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer
			});
			window.dispatchEvent(event);
			return event.defaultPrevented;
		});
		expect(dropPrevented).toBe(true);
		await expect(page.locator('input[aria-label^="Nom du fichier"]')).toHaveCount(0);
		await page.evaluate(() =>
			(window as typeof window & { mdshReadGate: { release: () => void } }).mdshReadGate.release()
		);
		await expect(shell).toHaveAttribute('aria-busy', 'false');
		await expect(shell).not.toHaveAttribute('inert');
		await expect
			.poll(async () => (await readDrafts()).map((row) => row.content))
			.toEqual(['Document conservé avant rechargement']);

		await page.keyboard.press('ControlOrMeta+n');
		await writeSourceContent(page, 'Création après chargement');
		const expected = ['Création après chargement', 'Document conservé avant rechargement'].sort();
		await expect
			.poll(async () => (await readDrafts()).map((row) => row.content).sort())
			.toEqual(expected);
		await page.reload();
		await expect(page.locator('.mdsh-shell[aria-busy="false"]:not([inert])')).toBeVisible();
		await expect(page.locator('.cm-content')).toContainText('Création après chargement');
		expect((await readDrafts()).map((row) => row.content).sort()).toEqual(expected);
	});

	test('la sidebar liste les fichiers après création', async ({ page }) => {
		await createFirstFile(page);

		// Ouvrir la sidebar explicitement (peut être fermée selon la largeur viewport)
		const toggle = page.getByRole('button', { name: 'Afficher/masquer le panneau' });
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');

		// Un item de fichier doit apparaître dans l'aside
		const sidebarItem = page
			.locator('aside')
			.getByText(/Sans titre/)
			.first();
		await expect(sidebarItem).toBeVisible({ timeout: 5000 });
	});
});

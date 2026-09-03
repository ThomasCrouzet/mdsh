import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createFirstFile, openPalette, writeSourceContent } from './helpers';
import { expect, test } from '@playwright/test';

/**
 * §1.2 - Non-régression installabilité PWA.
 *
 * @vite-pwa/sveltekit génère et précache `manifest.webmanifest` mais n'injecte
 * pas le `<link rel="manifest">` dans le document. On l'injecte via `pwaInfo`
 * dans `+layout.svelte`. Sans ce lien, le navigateur ignore le manifest et toute
 * la couche installable (prompt d'install, file_handlers, share_target,
 * launch_handler, shortcuts) devient inerte. Ce test garde le lien présent.
 *
 * Tourne contre le build (webServer = `npm run build && npm run preview`), où le
 * manifest est réellement émis et servi.
 */
test.describe('PWA - manifest', () => {
	test('le <link rel="manifest"> est présent et pointe vers le manifest', async ({ page }) => {
		await page.goto('/');

		const manifestLink = page.locator('head link[rel="manifest"]');
		await expect(manifestLink).toHaveCount(1);

		const href = await manifestLink.getAttribute('href');
		expect(href, 'href du manifest absent').toBeTruthy();
		expect(href).toContain('manifest.webmanifest');
	});

	test('le manifest est servi, valide, et déclare nom + icônes', async ({ page, request }) => {
		await page.goto('/');
		const href = await page.locator('head link[rel="manifest"]').getAttribute('href');
		expect(href).toBeTruthy();

		const res = await request.get(new URL(href as string, page.url()).toString());
		expect(res.ok(), `manifest non servi (HTTP ${res.status()})`).toBeTruthy();

		const manifest = (await res.json()) as {
			name?: string;
			icons?: Array<{ src: string; sizes?: string }>;
		};
		expect(manifest.name).toBeTruthy();
		expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeGreaterThan(0);
	});
});

/**
 * §A1.5 - Non-régression du démarrage hors-ligne (constat HIGH de l'audit
 * 2026-06-16). Le précache doit amorcer l'app-shell COMPLET - le document de
 * navigation (fallback SPA), le CSS Tailwind render-blocking et les chunks JS
 * de boot - sans dépendre du cache runtime cache-on-use (`mdsh-immutable-v1`),
 * évincible ou jamais peuplé si le premier chargement est interrompu.
 *
 * Le test isole exactement ce risque : après le premier chargement en ligne, il
 * SUPPRIME le cache runtime, passe hors-ligne, puis RECHARGE. Un échec de
 * couverture du précache (asset de boot absent, ou `navigateFallback` qui ne
 * matche pas la clé de précache de la racine) laisserait la page blanche / non
 * interactive et l'assertion finale timeout-erait.
 *
 * Chromium uniquement (Service Worker + `context.setOffline` ; non supporté
 * dans le projet WebKit/golden-path).
 */
test.describe('PWA - boot offline depuis le précache', () => {
	test('démarre et reste interactif hors-ligne via le seul précache', async ({
		page,
		context,
		browser
	}, testInfo) => {
		// 1) Premier chargement EN LIGNE : enregistre le SW et peuple le précache.
		await page.goto('/');

		// Attend que le SW soit actif pour le scope (le précache, posé pendant
		// `install`, est donc terminé avant que `ready` résolve).
		await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

		// 2) `registerType: 'prompt'` → pas de clientsClaim : le SW ne contrôle la
		//    page qu'à une navigation POSTÉRIEURE à son activation. On recharge
		//    jusqu'à obtenir un controller (robuste face à la course activation).
		await expect(async () => {
			await page.reload();
			expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
		}).toPass({ timeout: 30_000 });

		// 3) Supprime le cache runtime cache-on-use des assets immutables : tout ce
		//    qui sert au boot doit désormais venir du SEUL précache workbox.
		await page.evaluate(() => caches.delete('mdsh-immutable-v1'));

		// 4) Hors-ligne + reload : seul le précache peut servir la navigation, le
		//    CSS d'app-shell et les chunks de boot.
		await context.setOffline(true);
		await page.reload();

		// 5) L'app-shell doit booter ET être interactive (le JS d'entry a exécuté).
		//    Sans précache complet ou avec un navigateFallback désaligné, la page
		//    resterait blanche → timeout ici.
		await expect(page.locator('main').getByRole('button', { name: /Nouveau fichier/ })).toBeVisible(
			{ timeout: 15_000 }
		);

		await createFirstFile(page);
		await page.locator('button[data-mode="wysiwyg"]').click();
		await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 20_000 });
		const png = (await readFile('static/pwa-192x192.png')).toString('base64');
		await writeSourceContent(
			page,
			`# Hors ligne\n\n$e^{i\\pi}+1=0$\n\n![Image locale](data:image/png;base64,${png})`
		);
		await page.locator('button[data-mode="read"]').click();
		await expect(page.locator('.mdsh-preview math')).toBeAttached();
		await expect
			.poll(() =>
				page
					.locator('.mdsh-preview img')
					.evaluate((element) => (element as HTMLImageElement).naturalWidth)
			)
			.toBe(192);
		await openPalette(page);
		await page.getByRole('combobox').fill('Exporter en HTML');
		const downloading = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const download = await downloading;
		const output = testInfo.outputPath('first-visit-offline.html');
		await download.saveAs(output);
		const html = await readFile(output, 'utf8');
		expect(html).toContain('data:image/png;base64,');
		expect(html).toContain('data:font/woff2;base64,');
		const exportedContext = await browser.newContext({ offline: true });
		try {
			const exportedPage = await exportedContext.newPage();
			await exportedPage.goto(pathToFileURL(output).href);
			await expect(exportedPage.locator('math')).toBeAttached();
			await expect
				.poll(() =>
					exportedPage
						.locator('img')
						.evaluate((element) => (element as HTMLImageElement).naturalWidth)
				)
				.toBe(192);
		} finally {
			await exportedContext.close();
		}
		await context.setOffline(false);
	});
});

// Le serveur expose deux releases HTML/SW réelles du même bundle applicatif.
// Pas de mock registerSW : installation, waiting et activation sont celles du navigateur.
test('mise à jour réelle : deux clients sales, refus de persistance et reprise sans perte', async ({
	browser
}) => {
	const { resolve } = await import('node:path');
	const { createPwaUpdateServer } = await import('./pwa-update-server');
	const server = await createPwaUpdateServer(resolve('build'));
	const context = await browser.newContext({ locale: 'fr-FR' });
	await context.addInitScript(() => {
		localStorage.setItem('mdsh:locale', 'fr');
		localStorage.setItem('mdsh:mode', 'source');
	});
	try {
		const first = await context.newPage();
		await first.goto(server.origin);
		await first.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
		await first.reload();
		await expect.poll(() => first.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
		await createFirstFile(first);
		await writeSourceContent(first, '# Premier, état durable');
		const second = await context.newPage();
		await second.goto(server.origin);
		await second.locator('aside button[aria-label^="Nouveau fichier"]').click();
		await writeSourceContent(second, '# Second, état durable');

		async function contents() {
			return first.evaluate(
				() =>
					new Promise<string[]>((resolve, reject) => {
						const request = indexedDB.open('mdsh');
						request.onerror = () => reject(request.error);
						request.onsuccess = () => {
							const database = request.result;
							const rows = database.transaction('drafts').objectStore('drafts').getAll();
							rows.onsuccess = () => {
								database.close();
								resolve(rows.result.map((row: { content: string }) => row.content).sort());
							};
							rows.onerror = () => {
								database.close();
								reject(rows.error);
							};
						};
					})
			);
		}
		await expect.poll(contents).toEqual(['# Premier, état durable', '# Second, état durable']);
		await first.evaluate(() => {
			const original = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
				if (this.name === 'drafts')
					throw new DOMException('Stockage indisponible pour le test', 'QuotaExceededError');
				return original.apply(this, args);
			};
			(window as Window & { restoreDraftWrites?: () => void }).restoreDraftWrites = () => {
				IDBObjectStore.prototype.put = original;
			};
		});
		await first.locator('.cm-content').fill('# Premier, dernière frappe non enregistrée');
		await expect(first.getByRole('alert').first()).toBeVisible();
		server.publishNextVersion();
		await first.evaluate(async () => (await navigator.serviceWorker.ready).update());
		const reloadFirst = first.getByRole('button', { name: 'Recharger', exact: true });
		const reloadSecond = second.getByRole('button', { name: 'Recharger', exact: true });
		await expect(reloadFirst).toBeVisible({ timeout: 15000 });
		await expect(reloadSecond).toBeVisible({ timeout: 15000 });
		await expect(first.locator('meta[name="pwa-test-release"]')).toHaveAttribute('content', '1');
		await expect(second.locator('meta[name="pwa-test-release"]')).toHaveAttribute('content', '1');
		await reloadFirst.click();
		await expect(
			first
				.getByRole('alert')
				.filter({ hasText: /enregistr|sauvegarde|stockage/i })
				.first()
		).toBeVisible();
		await expect
			.poll(() => first.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting))
			.toBe(true);
		await expect(first.locator('.cm-content')).toHaveText(
			'# Premier, dernière frappe non enregistrée'
		);
		await expect.poll(contents).toEqual(['# Premier, état durable', '# Second, état durable']);

		// Le deuxième client active la version suivante. Le premier refuse son reload
		// tant que sa propre barrière de durabilité échoue.
		await second.locator('.cm-content').fill('# Second, dernière frappe avant activation');
		await reloadSecond.click();
		await expect(second.locator('meta[name="pwa-test-release"]')).toHaveAttribute('content', '2', {
			timeout: 15000
		});
		await expect(second.locator('.cm-content')).toHaveText(
			'# Second, dernière frappe avant activation'
		);
		await expect(first.locator('meta[name="pwa-test-release"]')).toHaveAttribute('content', '1');
		await expect(first.locator('.cm-content')).toHaveText(
			'# Premier, dernière frappe non enregistrée'
		);
		await expect
			.poll(() =>
				first.evaluate(async () => {
					const worker = navigator.serviceWorker.controller;
					if (!worker) return 0;
					return new Promise<number>((resolve) => {
						const channel = new MessageChannel();
						channel.port1.onmessage = (event) => resolve(event.data as number);
						worker.postMessage({ type: 'PWA_TEST_VERSION' }, [channel.port2]);
					});
				})
			)
			.toBe(2);
		await expect
			.poll(contents)
			.toEqual(['# Premier, état durable', '# Second, dernière frappe avant activation']);
		await first.evaluate(() =>
			(window as Window & { restoreDraftWrites?: () => void }).restoreDraftWrites?.()
		);
		// La frappe suivante réessaie la sauvegarde; le reload manuel devient sûr.
		await first.locator('.cm-content').fill('# Premier, reprise enregistrée');
		await expect
			.poll(contents)
			.toEqual(['# Premier, reprise enregistrée', '# Second, dernière frappe avant activation']);
		await first.reload();
		await expect(first.locator('meta[name="pwa-test-release"]')).toHaveAttribute('content', '2');
		await expect
			.poll(contents)
			.toEqual(['# Premier, reprise enregistrée', '# Second, dernière frappe avant activation']);
	} finally {
		await context.close();
		await server.close();
	}
});

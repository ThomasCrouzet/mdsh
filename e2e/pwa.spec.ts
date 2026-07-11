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
	test('démarre et reste interactif hors-ligne via le seul précache', async ({ page, context }) => {
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

		await context.setOffline(false);
	});
});

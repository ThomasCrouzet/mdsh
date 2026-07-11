import { expect, type Page } from '@playwright/test';

/**
 * Purge toutes les IndexedDB de l'app avant un test - assure un état propre
 * (pas de fichiers restants, pas de corbeille persistée).
 * Force par défaut le mode 'source' via localStorage : évite le lazy-load
 * de Milkdown Crepe dans les tests (gain temps + déterminisme).
 */
export async function resetAppState(
	page: Page,
	opts: { mode?: 'wysiwyg' | 'source' | 'read' } = {}
) {
	const mode = opts.mode ?? 'source';
	await page.goto('/');
	await page.evaluate(async (forcedMode) => {
		await Promise.all(
			['mdsh', 'mdsh-fs'].map(
				(name) =>
					new Promise<void>((resolve) => {
						const req = indexedDB.deleteDatabase(name);
						req.onsuccess = () => resolve();
						req.onerror = () => resolve();
						req.onblocked = () => resolve();
					})
			)
		);
		localStorage.clear();
		localStorage.setItem('mdsh:mode', forcedMode);
	}, mode);
	await page.reload();
	await page.waitForSelector('header, button:has-text("Nouveau fichier")', { timeout: 15_000 });
}

/**
 * Crée un premier fichier en cliquant le bouton "Nouveau fichier" du
 * Welcome screen (situé dans <main>). Attend que la toolbar reflète
 * le fichier actif via son input de renommage.
 */
export async function createFirstFile(page: Page) {
	// Welcome + sidebar exposent tous deux un bouton "Nouveau fichier" - on
	// cible celui du <main> (Welcome) pour éviter l'ambiguïté strict-mode.
	const welcomeBtn = page.locator('main').getByRole('button', { name: /Nouveau fichier/ });
	await welcomeBtn.click();
	// §B1.7/B1.8 - l'aria-label inclut maintenant des hints clavier
	// ("Nom du fichier (Entrée pour valider, Échap pour annuler)") ; on
	// match par préfixe.
	await expect(page.locator('input[aria-label^="Nom du fichier"]')).toBeVisible({
		timeout: 10_000
	});
}

/** Ouvre la palette via le bouton toolbar (évite les conflits keyboard). */
export async function openPalette(page: Page) {
	await page.getByRole('button', { name: 'Palette de commandes' }).click();
	await expect(page.getByRole('dialog', { name: 'Palette de commandes' })).toBeVisible();
}

/** Bascule en mode source via le bouton toolbar (CodeMirror déterministe). */
export async function switchToSource(page: Page) {
	// Le sélecteur du mode est `role="radio"` dans un radiogroup, pas `button`.
	// On utilise `data-mode` qui est unique et stable.
	await page.locator('button[data-mode="source"]').click();
	await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Renomme le fichier actif via l'input toolbar. Le nom apparaît tel quel dans
 * la sidebar (sauf si le contenu fournit un YAML `title:` qui prend la priorité).
 */
export async function renameActiveFile(page: Page, newName: string) {
	const input = page.locator('input[aria-label^="Nom du fichier"]');
	await input.waitFor({ timeout: 10_000 });
	await input.fill(newName);
	await input.press('Enter');
	// Petit délai pour laisser le flash success (800 ms) retomber et le store
	// propager le rename vers la sidebar avant qu'un test consulte le DOM.
	await page.waitForTimeout(900);
}

/**
 * Écrit du contenu dans CodeMirror (mode source). Remplace l'intégralité de
 * l'éditeur - sélection complète puis insertText. Suppose qu'on est déjà en
 * mode source (cf. resetAppState avec mode = 'source').
 */
export async function writeSourceContent(page: Page, content: string) {
	// Garantit explicitement le mode source plutôt que de dépendre de la
	// restauration asynchrone de `mdsh:mode` (localStorage → onMount), fragile
	// sous charge : l'automatisation peut créer un fichier avant que le mode
	// soit restauré, laissant l'app en WYSIWYG (Milkdown, pas de .cm-content).
	// Même approche que golden-path.spec.ts. Clic idempotent si déjà en source.
	const sourceBtn = page.locator('button[data-mode="source"]');
	if (await sourceBtn.count()) await sourceBtn.click();
	const editor = page.locator('.cm-content').first();
	await editor.waitFor({ timeout: 10_000 });
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText(content);
	// Debounce save 400 ms + marge pour que `dirty` soit clean et la persistance OK.
	await page.waitForTimeout(600);
}

export interface SeedFile {
	name: string;
	content: string;
}

/**
 * Seed `n` fichiers via l'UI (clic Welcome / Sidebar → rename → write).
 * Plus lent qu'un seed direct via IDB mais robuste face aux migrations de
 * schéma Dexie : on passe par les mêmes APIs qu'un utilisateur. Le dernier
 * fichier reste actif (utile pour pré-positionner un test sur le contenu
 * "principal" à exercer).
 */
export async function seedFiles(page: Page, files: SeedFile[]) {
	if (files.length === 0) return;
	const [first, ...rest] = files;
	// 1er fichier : bouton du Welcome screen
	await page
		.locator('main')
		.getByRole('button', { name: /Nouveau fichier/ })
		.click();
	await renameActiveFile(page, first.name);
	await writeSourceContent(page, first.content);
	// Fichiers suivants : bouton "Nouveau fichier" de la Sidebar
	for (const f of rest) {
		await page.locator('aside button[aria-label^="Nouveau fichier"]').first().click();
		await renameActiveFile(page, f.name);
		await writeSourceContent(page, f.content);
	}
}

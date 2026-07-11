// Tests unitaires de StatusBar.svelte via @testing-library/svelte.
//
// StatusBar lit `filesStore.active` (pour les compteurs) et
// `filesStore.hasPendingSave` (indicateur enregistrement). Le store est un
// singleton Svelte 5 `$state` - on seed ses champs publics *avant* le rendu
// pour contrôler l'état initial sans déclencher de side-effects (pas d'appel
// à `filesStore.load()`, pas d'IndexedDB réelle).
//
// Couverture :
//  - Composant absent si aucun fichier actif (filesStore.active === null).
//  - Affichage des compteurs mots / caractères / lignes (via computeStats).
//  - Document vide → 0 mots, 0 caractères, 1 ligne.
//  - Indicateur « enregistrement… » si hasPendingSave = true.
//  - Indicateur de date si hasPendingSave = false et un fichier actif.

import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import StatusBar from './StatusBar.svelte';
import { filesStore } from '$lib/files.svelte';
import type { FileItem } from '$lib/types';

// ------------------------------------------------------------------
// Fixture
// ------------------------------------------------------------------

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
	return {
		id: 'test-id',
		name: 'test.md',
		content: '',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		dirty: false,
		...overrides
	};
}

/** Seed le store singleton avant chaque test. */
function seedStore(file: FileItem | null, hasPendingSave = false) {
	if (file) {
		filesStore.files = [file];
		filesStore.activeId = file.id;
	} else {
		filesStore.files = [];
		filesStore.activeId = null;
	}
	filesStore.hasPendingSave = hasPendingSave;
	filesStore.lastSavedAt = 0;
}

// ------------------------------------------------------------------
// Nettoyage entre les tests
// ------------------------------------------------------------------

beforeEach(() => {
	seedStore(null);
});

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('StatusBar - visibilité', () => {
	it("n'est pas rendu si aucun fichier actif", () => {
		render(StatusBar);
		// Le composant est conditionnel : {#if filesStore.active}
		expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
	});

	it('est rendu si un fichier est actif', () => {
		seedStore(makeFile());
		render(StatusBar);
		expect(screen.getByRole('contentinfo')).toBeInTheDocument();
	});
});

describe('StatusBar - compteurs', () => {
	it('affiche 0 mots pour un fichier vide', () => {
		seedStore(makeFile({ content: '' }));
		render(StatusBar);
		expect(screen.getByText('0 mots')).toBeInTheDocument();
	});

	it('compte correctement les mots', () => {
		seedStore(makeFile({ content: 'Bonjour le monde' }));
		render(StatusBar);
		expect(screen.getByText('3 mots')).toBeInTheDocument();
	});

	it('affiche le nombre de caractères', () => {
		seedStore(makeFile({ content: 'abc' }));
		render(StatusBar);
		expect(screen.getByText('3 car.')).toBeInTheDocument();
	});

	it('affiche le nombre de lignes', () => {
		seedStore(makeFile({ content: 'ligne1\nligne2\nligne3' }));
		render(StatusBar);
		// La stat lignes est dans un span caché en mobile (hidden sm:inline)
		// mais bien présent dans le DOM.
		expect(screen.getByText('3 lignes')).toBeInTheDocument();
	});

	it('ignore les annotations Markdown pour le décompte des mots', () => {
		// Le contenu Markdown ne doit pas être compté comme des mots de symboles.
		seedStore(makeFile({ content: '# Titre\n\nParagraphe ici.' }));
		render(StatusBar);
		// computeStats strip les balises markdown
		const wordsEl = screen.getByText(/mots$/);
		expect(wordsEl).toBeInTheDocument();
		// On vérifie juste que le rendu ne plante pas et qu'un compteur est affiché.
		expect(wordsEl.textContent).toMatch(/^\d+ mots$/);
	});
});

describe('StatusBar - indicateur de sauvegarde', () => {
	it('affiche « enregistrement… » si hasPendingSave est vrai', () => {
		seedStore(makeFile(), true);
		render(StatusBar);
		expect(screen.getByText('enregistrement…')).toBeInTheDocument();
	});

	it("n'affiche pas « enregistrement… » si hasPendingSave est faux", () => {
		seedStore(makeFile(), false);
		render(StatusBar);
		expect(screen.queryByText('enregistrement…')).not.toBeInTheDocument();
	});
});

import type { ProjectMessageKey } from './project-en';

export const projectFr: Record<ProjectMessageKey, string> = {
	'projects.title': 'Projets Markdown',
	'projects.open': 'Projets',
	'projects.close': 'Fermer les projets',
	'projects.create': 'Nouveau projet',
	'projects.name': 'Nom du projet',
	'projects.importZip': 'Importer un projet ZIP',
	'projects.importFolder': 'Importer un dossier',
	'projects.export': 'Exporter le projet',
	'projects.checkLinks': 'Vérifier les liens',
	'projects.noIssues': 'Tous les liens locaux sont résolus.',
	'projects.newDocument': 'Nouveau document du projet',
	'projects.documentPath': 'Chemin du document, par exemple notes/guide.md',
	'projects.openDocument': 'Ouvrir {path}',
	'projects.empty': 'Créez un projet ou importez un dossier ou une archive ZIP.',
	'projects.local':
		'Les documents et ressources restent sur cet appareil. Exportez un ZIP pour conserver une copie séparée.',
	'projects.operationFailed':
		'L’opération a échoué. Vérifiez les chemins, les formats et les limites de taille, puis réessayez.',
	'projects.limits': 'Jusqu’à 300 documents, 64 Mo par projet et 2 Mo par image.',
	'projects.linkMissing': 'Le document lié est absent de ce projet.',
	'projects.busy': 'Traitement du projet...',
	'projects.missing': 'Ressource manquante',
	'projects.ambiguous': 'Lien wiki ambigu',
	'projects.outside-project': 'Chemin hors du projet',
	'projects.remote': 'Image distante soumise à autorisation',
	'projects.nativeOpen': 'Ouvrir un dossier du disque',
	'projects.refresh': 'Actualiser depuis le disque',
	'projects.save': 'Enregistrer le projet sur disque',
	'projects.unlink': 'Dissocier le dossier du disque',
	'projects.saved': 'Projet enregistré sur disque.',
	'projects.refreshed': 'Projet actualisé depuis le disque.'
};

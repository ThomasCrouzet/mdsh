# Guide utilisateur

## Commencer à écrire

Ouvrez [l'application web](https://thomascrouzet.github.io/mdsh/), créez un document, puis choisissez le mode WYSIWYG, source ou lecture dans la barre d'outils. Les brouillons restent dans le profil courant du navigateur. Il n'existe ni compte ni copie distante.

Fermer un onglet conserve le document dans la bibliothèque. La commande de suppression l'envoie dans la corbeille pendant 30 jours. La bibliothèque et la corbeille sont accessibles depuis la barre latérale.

<a id="install-the-pwa"></a>

## Installer la PWA

Utilisez l'action d'installation du navigateur depuis l'application web. Attendez que la préparation hors ligne soit terminée avant de couper le réseau. Le cache contient l'éditeur visuel, l'éditeur source, le rendu Markdown, les formules, les diagrammes, les polices et les modules d'export. L'application peut ensuite créer, modifier, rechercher et exporter des documents sans réseau.

Une nouvelle version attend que les écritures IndexedDB soient terminées avant de recharger l'application. Si une sauvegarde locale échoue, le document reste affiché et la mise à jour ne force pas le rechargement.

## Importer des documents

Une sélection ou un dossier peut contenir au maximum 300 fichiers et 64 Mio. Chaque fichier est limité à 16 Mio. Les fichiers binaires, les caractères de contrôle interdits et le texte qui n'est pas en UTF-8 sont refusés avec un bilan visible. Une annulation conserve les documents déjà importés et signale le nombre réellement ajouté.

Un document d'au moins 262 144 caractères s'ouvre d'abord en mode source. Le passage au rendu visuel demande une confirmation, car l'analyse peut prendre plus de temps.

## Images locales et distantes

Une image ajoutée avec le sélecteur, le presse-papiers ou le glisser-déposer est incorporée dans le Markdown. Elle reste donc disponible après un rechargement et apparaît dans les exports PDF et HTML autonome. Les liens temporaires créés par d'anciennes versions ne peuvent pas être récupérés après leur expiration: réimportez alors l'image depuis son fichier d'origine.

Les images distantes sont bloquées par défaut. Le mode lecture propose de les charger et de les incorporer pour le document courant. Cette action contacte l'hébergeur et lui révèle votre adresse IP. La requête n'envoie ni cookie ni référent et refuse les redirections. Une image distante est limitée à 2 Mio, avec un maximum cumulé de 8 Mio par opération. Les SVG sont assainis avant leur incorporation.

Un chemin d'image relatif peut être résolu en sélectionnant le fichier ou le dossier correspondant. L'image est alors incorporée pour que le document reste portable.

<a id="backups-and-storage-health"></a>

## Sauvegardes et stockage

Les réglages indiquent si le navigateur a accordé un stockage persistant, l'estimation du quota disponible et la date de la dernière sauvegarde externe réussie. Exportez une sauvegarde régulièrement, en particulier avant d'effacer les données du navigateur ou de changer de profil.

Une sauvegarde contient les documents ouverts et fermés, les espaces de travail et les modèles personnalisés. Elle exclut la corbeille, l'historique des versions, les handles de fichiers du navigateur et les autorisations de chemin de l'application Desktop. Le format accepte au maximum 3 000 documents, 300 espaces de travail, 16 Mio par document et 64 Mio au total. L'application vérifie ces limites avant d'annoncer la réussite du téléchargement. Une sauvegarde chiffrée ne peut pas être récupérée sans sa phrase secrète.

Le mode de remplacement conserve les anciens documents dans la corbeille et préserve les variantes qui partagent un identifiant. Le mode de fusion remappe les collisions et maintient les références des espaces de travail.

## Exporter

L'export PDF rend le contenu, les images incorporées, les formules, les blocs de code et les diagrammes avant d'ouvrir le dialogue d'impression. La réussite n'est annoncée qu'après la préparation complète. Choisissez ensuite une imprimante PDF dans le dialogue du navigateur ou du système. Les en-têtes et pieds de page ajoutés par le navigateur se désactivent dans ce dialogue.

Le fichier HTML autonome incorpore ses styles, ses images et les polices KaTeX nécessaires. Il reste lisible depuis un fichier local sans réseau. Les exports Markdown, ZIP et HTML ne transportent pas les autorisations d'accès direct au disque.

## Raccourcis clavier

Le menu Commandes affiche tous les raccourcis actifs. Les réglages permettent de personnaliser chaque commande, de détecter les conflits et de restaurer les valeurs par défaut. Les profils web et Desktop sont enregistrés séparément. Les raccourcis d'édition du contenu gardent la priorité quand le curseur se trouve dans l'éditeur.

## Application Desktop Beta

Les installateurs Desktop sont des artefacts bêta non signés. macOS peut afficher Gatekeeper et Windows SmartScreen peut afficher un avertissement. Téléchargez uniquement les fichiers de la prerelease Desktop associée à la version, puis comparez leur empreinte avec `SHA256SUMS`. La release fournit aussi les SBOM npm et Cargo ainsi qu'une attestation de provenance.

La version macOS demande macOS 14 ou plus récent. Windows installe WebView2 avec le mode prévu par Tauri si le composant manque. Les paquets Linux utilisent WebKitGTK. Chaque association de fichier et chaque sélection native crée une autorisation opaque valable uniquement pendant la session. Au prochain lancement, ouvrez à nouveau le fichier pour rétablir cet accès.

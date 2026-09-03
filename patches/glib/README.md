# Backport de sécurité glib 0.18.5

GTK3 impose encore glib 0.18 dans la chaîne Tauri Linux. Cette copie applique le
correctif officiel de GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429 sans modifier l'API,
la version du paquet ni ses licences. Les métadonnées amont décrivent la source
initiale ; le présent fichier documente sa modification locale.

- Archive : https://static.crates.io/crates/glib/glib-0.18.5.crate
- SHA256 : `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`
- Source du paquet : https://github.com/gtk-rs/gtk-rs-core/tree/42b9caf98e03ded086362d9653ca58fe94dc8658/glib
- Correctif : https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34
- Revue amont : https://github.com/gtk-rs/gtk-rs-core/pull/1343
- Backport officiel sur la branche 0.19 : https://github.com/gtk-rs/gtk-rs-core/commit/44ff04449535135aa82507ff492883bba77a9b75
- Avis : https://rustsec.org/advisories/RUSTSEC-2024-0429.html
- Licence : MIT, notices originales conservées dans `src-tauri/vendor/glib/LICENSE`
  et `src-tauri/vendor/glib/COPYRIGHT`.

`variant-str-iter.patch` est le diff officiel, avec ses chemins adaptés à la
racine du paquet publié. Il rend mutable le pointeur de sortie fourni à GLib :
écrire par la référence immuable précédente constituait un comportement indéfini.
Seules ces deux lignes diffèrent de l'archive publiée. Aucun fichier amont n'est
reformaté ou supprimé.

Depuis la racine du dépôt, avec Node 22, Git et tar :

```sh
node scripts/vendor-glib.mjs --write
node scripts/vendor-glib.mjs --check
```

Les deux modes vérifient le SHA256 avant extraction. `--check` reconstruit en
répertoire temporaire et compare l'inventaire complet et chaque fichier octet par
octet. Pour utiliser une archive déjà téléchargée, ajouter `--archive chemin.crate`.
Modifier le patch canonique puis régénérer ; ne pas éditer la copie vendor.

Les tests amont pertinents sont `variant_iter::tests::test_variant_iter_array`,
`test_variant_str_iter_nth` et `test_variant_str_iter_last`. Les exécuter avec
`cargo test --release --manifest-path chemin-vers-copie-temporaire/Cargo.toml variant_iter::tests::`.
Le mode optimisé est essentiel pour reproduire le défaut ; le processus qui
exécute la version non corrigée doit être isolé car il peut terminer par SIGSEGV.
Tester une copie temporaire préserve l'inventaire vendor de tout fichier généré.

La CI Linux et la publication Desktop exécutent aussi les six régressions sur le
graphe de dépendances livré, après installation des bibliothèques système Tauri :

```sh
cargo test --manifest-path src-tauri/Cargo.toml --release --locked --test glib_variant_regression
cargo audit --file src-tauri/Cargo.lock --deny unsound
```

Le contrôle d'inventaire est exécuté sur les quatre plateformes Desktop. Les
attributs Git préservent les octets des fichiers amont et du patch sous Windows.
Le SBOM Cargo décrit le backport, le SHA256 du patch et les références amont, en
conservant la version réelle 0.18.5.

La version reste 0.18.5. `cargo-audit 0.22.2` utilise RustSec 0.33.0, dont
`Database::query_vulnerabilities` écarte les paquets sans source de registre,
notamment les dépendances locales. Son absence d'alerte pour cette copie ne
constitue donc pas une preuve de correction. La preuve repose sur l'origine
vérifiée, le diff et les tests optimisés. Retirer le backport lorsque la chaîne
GTK permet une version officiellement corrigée.

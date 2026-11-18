# EcoClock-rs Web

[![CI](https://github.com/Roger364/ecoclock-rs-web/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Roger364/ecoclock-rs-web/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/github/license/Roger364/ecoclock-rs-web)](LICENSE)

Configurateur web (React + Vite) pour un utilitaire Windows d'underclocking écrit en Rust.
L'interface construit, compare et exporte des profils d'alimentation sobres ; le crate Rust
embarqué les applique via les API Windows documentées, sans pilote noyau.

**Feuille de route** : [ROADMAP.md](ROADMAP.md) — licence, intégration continue, releases, puis le reste.

![Interface d'EcoClock-rs](docs/interface.png)

## Fonctionnalités

- **5 profils** (éco-productivité, silence, jeu, veille active, stock) avec comparateur avant/après.
- **Export `profiles.toml`** au schéma du crate Rust (`ProfileStore`), avec migration des anciens fichiers à booléens.
- **Script `.ps1` autonome** : applique le profil, sauvegarde le plan d'alimentation actif et sait le restaurer (`-Restore`).
- **Audit de sûreté** avant application, matrice adaptative sur 7 situations, journal des appels Win32.
- **Détection de capacités** : un réglage refusé par Windows est compté et annoncé, jamais ignoré en silence.
- **Interface multilingue FR / EN / IT / DE** : sélecteur persistant dans la barre de titre, français par défaut. FR et EN sont complets, infobulles techniques comprises ; IT et DE affichent l'anglais avec un bandeau explicite tant que leur traduction n'existe pas. Les vues d'analyse restent en français et l'annoncent.

## Mesuré ou modélisé

L'interface affiche des projections, pas des relevés. Ce tableau dit ce qui vient d'un capteur et ce qui sort du modèle.

| Grandeur affichée | Origine | Comment |
|---|---|---|
| Températures CPU/GPU, point chaud, RPM, dBA système | **modélisé** | `src/engine/physics.ts` : TDP, charge, résidence C-states, ambiance 22 °C |
| Puissance paquet, consommation murale, €/an, CO₂ | **modélisé** | rendement PSU, tarif et mix paramétrables |
| Temps d'exécution avant/après (ms) | **modélisé** | modèle de charge, pas un benchmark exécuté |
| Valeurs écrites puis relues dans le plan d'alimentation | **mesuré** | `powrprof` côté Rust, relecture après écriture |
| Effet du plafond 55 % et de `PROCFREQMAX` | **mesuré sur ce poste** | 775,5 → 1 088,5 ms (+40,4 %, 1 thread) ; 6 023 → 8 642 ms (+43,5 %) à 3 300 MHz, identique à 2 000 MHz |
| Température réelle du CPU | **indisponible** | `MSAcpi_ThermalZoneTemperature` absent sur ce poste |

Le crate Rust lit les capteurs quand ils existent ; le configurateur web, lui, ne lit rien : il calcule.

Le protocole et les données brutes sont dans [measurements/](measurements/) ; le banc est
`scripts/measure-cppc.ps1`.

## Téléchargement

Les binaires sont dans les [releases](https://github.com/Roger364/ecoclock-rs-web/releases) :

- `ecoclock-<tag>-windows-x64.exe` — la GUI, CRT statique, aucun runtime à installer ;
- `ecoclock-crate-<tag>.zip` — le crate complet, pour compiler soi-même ;
- `SHA256SUMS.txt` — les empreintes, à comparer avec `Get-FileHash`.

Le binaire n'est pas signé : Windows SmartScreen affichera un avertissement, c'est attendu.
Une signature demanderait un certificat payant, hors de portée de ce projet.

## Démarrage

```bash
npm ci
npm run dev      # serveur de développement Vite
npm run build    # bundle single-file dans dist/
```

## Livrable Rust

L'onglet « Code Rust & .zip » assemble un crate complet (22 fichiers) téléchargeable. Il n'existe
pas sur le disque : il est généré depuis `src/data/rustProject.ts`. La garde :

```bash
npm run check:rust   # extrait le crate puis cargo check --all-targets
```

## Tests

| Commande | Résultat |
|---|---|
| `npx vitest run` | 48/48 |
| `npm run check:rust -- --keep`, puis `cargo test` dans `.check-rust/` | 15/15 |
| `npx tsc --noEmit` | 0 erreur |

## Sécurité

- Aucun pilote noyau, aucun service : uniquement les API Windows documentées (`powrprof`, `ChangeDisplaySettingsExW`) et NVML pour NVIDIA.
- `RollbackGuard` restaure le profil de départ à la sortie si demandé.
- Chaque application est journalisée dans `%APPDATA%\EcoClock\journal.log` : horodatage, valeurs demandées, refus et droits. Le journal survit au redémarrage et se lit avec `ecoclock --journal`. Vérifié avec le vrai binaire dans un bac à sable jetable : deux commandes (appliquer P3, restaurer) ont produit exactement deux lignes, relues par `--journal`.
- Le script `.ps1` exporte le plan actif (`baseline-scheme.pow`) avant toute modification et vérifie sa restauration.

## Limites connues

- Windows uniquement.
- `PROCFREQMAX` n'a **qu'un cran utile** sur ce Ryzen 9 5900X : 3 300 et 2 000 MHz y donnent le même temps (8 642 vs 8 630 ms) et la même fréquence rapportée, 3 342 MHz. Au-dessus de 3 300, aucun effet mesuré sur ce modèle. Mesuré +43,5 % de temps mono-thread sur une charge de 6 s — une charge d'une seconde sous-estimait l'effet à +21,8 %. **Un seul CPU testé** : sur un autre modèle, un plafond plus bas peut encore agir ; le repère affiché n'est pas une limite universelle.
- **EPP (`PERFEPP`) sans effet mesurable** sur ce poste : 6 122 / 6 029 / 6 105 ms à EPP 0 / 50 / 100, soit l'amplitude du bruit (±1,6 %). Il n'est pas présenté comme un levier de débit.
- **Turbo désactivé** : 7 806 ms au lieu de 6 115 (+29,6 %), effet net et reproductible.
- La température CPU n'est pas toujours exposée (`MSAcpi_ThermalZoneTemperature` absent sur certains postes).
- **Interface anglaise (v3)** : le tableau de bord et les 39 infobulles techniques sont traduits, y compris les constats d'audit, les propositions Pareto et les benchmarks. Seules les vues Avant/Après, Mode intelligent, Audit et 5 Profils restent en français et l'annoncent hors français. L'italien et l'allemand sont sélectionnables mais affichent l'anglais avec un bandeau, faute de traduction.

## Structure

```
src/engine/                  physique, optimisation Pareto, validation, tests
src/i18n/                    langue persistée (FR/EN/IT/DE) et helper de traduction
src/data/rustProject.ts      crate Rust embarqué (22 fichiers)
src/utils/windowsScript.ts   générateur du script .ps1
PLAN-ACTIONS.md              état du projet, décisions et pièges connus
```

## Licence

[MIT](LICENSE) — Copyright (c) 2026 Bisse Studio.

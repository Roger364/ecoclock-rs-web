# Feuille de route

État au 17/11/2026 : configurateur React + crate Rust embarqué, 47 tests TypeScript, 12 tests Rust,
GUI réparée, dépôt public. Phases 1 à 4 faites (sonde thermique bloquée) ; phase 5 entamée par la
détection du constructeur CPU. Le détail technique, les décisions et les pièges sont dans
[PLAN-ACTIONS.md](PLAN-ACTIONS.md) ; ce document ne dit que **quoi faire ensuite, dans quel ordre**.

L'ordre n'est pas arbitraire : un dépôt public doit d'abord être utilisable et honnête, ensuite
automatisé, ensuite distribuable — les fonctionnalités viennent après.

## Phase 1 — Crédibilité (✅ faite le 17/11/2026, ≈ 1 h)

| # | Action | Pourquoi | Fini quand |
|---|---|---|---|
| 1 | Choisir une licence (MIT ou Apache-2.0) | sans licence, personne ne peut légalement réutiliser le code | `LICENSE` à la racine + section du README mise à jour |
| 2 | Séparer **mesuré** et **modélisé** | l'interface affiche des températures et des décibels calculés par `src/engine/physics.ts`, pas lus sur un capteur ; un lecteur doit le savoir avant de citer un chiffre | tableau « mesuré / modélisé » dans le README |
| 3 | Une capture d'écran | un projet visuel sans image ne se clique pas | image dans `docs/` et affichée en tête du README |

## Phase 2 — Qualité continue (✅ faite le 17/11/2026, ≈ 2 h)

| # | Action | Pourquoi | Fini quand |
|---|---|---|---|
| 4 | GitHub Actions : `tsc`, `vitest`, `vite build`, `check:rust` + `cargo test` | aujourd'hui rien ne protège `main` ; les 53 tests n'existent que sur cette machine | workflow vert sur un push de test |
| 5 | Badges (tests, build) | l'état se lit en un coup d'œil | badges dans le README, alignés sur les vrais chiffres |

## Phase 3 — Livraison (✅ faite le 17/11/2026, ≈ 0,5 j)

| # | Action | Pourquoi | Fini quand |
|---|---|---|---|
| 6 | Release automatique : exe portable, zip du crate, `SHA256SUMS.txt` | un utilisateur ne devrait pas avoir à compiler pour essayer | tag `v0.5.0` publié, trois assets ✅ |
| 7 | Documenter SmartScreen ✅ | un exe non signé déclenche un avertissement ; mieux vaut l'expliquer que le subir | note dans le README, aucune signature prétendue |

Le `.ps1` n'est pas un asset de release : il est généré par l'application pour le profil choisi, avec son `-Restore`.

## Phase 4 — Produit (✅ faite le 17/11/2026 hors sonde thermique)

| # | Action | Pourquoi | Fini quand |
|---|---|---|---|
| 8 | Test exécutable du `.ps1` ✅ | les assertions de chaîne n'ont pas attrapé la restauration muette ; seule l'exécution l'a vue | 4 tests qui lancent le vrai script, exécutables masqués |
| 9 | Sonde thermique — **bloquée** : aucune sonde exposée sur ce poste (`MSAcpi_ThermalZoneTemperature` absent, compteurs perf en `0xC0000BB8`) | sans elle, aucune campagne chaleur/bruit n'est défendable | relevés Tctl avant/après sur une charge fixe, nécessite l'installation de LibreHardwareMonitor |
| 10 | Trancher le curseur MHz ✅ | mesuré +43,5 % de temps à 3 300 MHz sur charge longue ; 2 000 MHz donne le même résultat sur ce 5900X | gardé, affiché en plafond (« ≤ 3,3 GHz ») avec un repère à 3,3 GHz, présenté comme une mesure et non une limite |

## Phase 5 — Portée (à discuter)

| # | Action | Pourquoi |
|---|---|---|
| 11 | Détecter le vendor CPU (Intel/AMD) ✅ détection + campagne CPPC2 | `PROCFREQMAX` est Intel-first ; côté AMD c'est CPPC2 qui compte. Mesure sur 5900X : EPP sans effet, plafond à un cran, Turbo -30 %. L'adaptation AMD n'a donc rien de mesuré à proposer de plus que l'existant |
| 12 | Interface FR/EN ✅ v2 (18/11/2026) | le dépôt est public, l'interface est francophone ; tableau de bord complet (réglages, profils, dialogues, audit, propositions, benchmarks) bilingue, infobulles et vues d'analyse encore FR et annoncées |

## Phase 6 — Auditabilité (vague 11)

| # | Action | Pourquoi | Fini quand |
|---|---|---|---|
| 13 | Journal d'application ✅ | le statut disparaissait avec la session : impossible de dire ce qui avait été écrit, refusé ou restauré | une ligne par application dans `%APPDATA%\EcoClock\journal.log`, relue par `ecoclock --journal` ; vérifié en bac à sable : 2 commandes → 2 lignes |
| 14 | Zone morte du curseur ✅ | sous 3,3 GHz, le plafond n'agit plus sur le 5900X ; l'interface laissait croire à un gain | hachures sous la piste (web + egui) et valeur annotée « aucun gain sous 3 300 (mesuré) » |

## Ce que je ne ferais pas

- **Ajouter des réglages sans mesure derrière.** Chaque levier doit avoir une preuve de débit, de température ou de bruit — sinon c'est du décor.
- **Signer le binaire sans identité d'éditeur.** Un certificat coûte plus cher que le projet et n'améliore pas le code.
- **Refactoriser le moteur.** 53 tests couvrent le contrat ; le remaniement n'apporterait rien de visible.
- **Passer la GUI en autre chose qu'egui.** Elle démarre, se teste et pèse 3,7 Mo.

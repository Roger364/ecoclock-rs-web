# Feuille de route

État au 18/11/2026 : configurateur React + crate Rust embarqué, 43 tests TypeScript, 10 tests Rust,
GUI réparée, dépôt public. Phases 1 et 2 faites. Le détail technique, les décisions et les pièges sont dans
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

## Phase 3 — Livraison (≈ 0,5 j)

| # | Action | Pourquoi | Fini quand |
|---|---|---|---|
| 6 | Release automatique : `ecoclock.exe` (release), zip du crate, `.ps1` | un utilisateur ne devrait pas avoir à compiler pour essayer | tag `v0.5.0` avec trois assets téléchargeables |
| 7 | Documenter SmartScreen | un exe non signé déclenche un avertissement ; mieux vaut l'expliquer que le subir | note dans le README, aucune signature prétendue |

## Phase 4 — Produit (ordre de valeur)

| # | Action | Pourquoi | Fini quand |
|---|---|---|---|
| 8 | Test **exécutable** du `.ps1` en sandbox | les assertions de chaîne n'ont pas attrapé la restauration muette ; seule l'exécution l'a vue | test qui exige `[OK] … X réglage(s), Y ignoré(s)` |
| 9 | Sonde thermique (LibreHardwareMonitor) | sans elle, aucune campagne chaleur/bruit n'est défendable | relevés Tctl avant/après sur une charge fixe |
| 10 | Trancher le curseur MHz | mesuré partiel (+21,8 % à 2 000 MHz au lieu de ~+85 %) : le garder, le brider ou le retirer | décision écrite + texte définitif dans l'UI |

## Phase 5 — Portée (à discuter)

| # | Action | Pourquoi |
|---|---|---|
| 11 | Détecter le vendor CPU (Intel/AMD) et adapter les réglages | `PROCFREQMAX` est Intel-first ; côté AMD c'est CPPC2 qui compte |
| 12 | Interface FR/EN | le dépôt est public, l'interface est francophone |

## Ce que je ne ferais pas

- **Ajouter des réglages sans mesure derrière.** Chaque levier doit avoir une preuve de débit, de température ou de bruit — sinon c'est du décor.
- **Signer le binaire sans identité d'éditeur.** Un certificat coûte plus cher que le projet et n'améliore pas le code.
- **Refactoriser le moteur.** 53 tests couvrent le contrat ; le remaniement n'apporterait rien de visible.
- **Passer la GUI en autre chose qu'egui.** Elle démarre, se teste et pèse 3,7 Mo.

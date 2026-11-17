# Plan d'actions — EcoClock-rs Web

Base : `rust-hardware-underclocking-utility4.zip` (17/11/2026, 54 fichiers). Ce document est le point d'entrée : état vérifié, décisions prises, pièges connus, et travail restant. L'historique détaillé des patches est dans git, pas ici. Feuille de route publique : [ROADMAP.md](ROADMAP.md).

**État vérifié au 17/11/2026 — commit `d04ea13` :**

```
tsc --noEmit            0 erreur
vitest run              43/43
vite build              823,00 kB (243,25 kB gzip), bundle single-file
cargo check --all-targets  OK (21 fichiers, 3 warnings de code mort)
cargo test                 10/10
ecoclock --check        policies_absentes=aucun
sandbox Windows         13 réglages appliqués, 1 ignoré (IGPU_BIAS), restauration 100 %
mesure hôte             plafond 55 % : +40,4 % ; PROCFREQMAX 2000 MHz : +21,8 % mono-thread
binaire release         GUI + headless validés (sandbox 4/4, fenêtre réelle sur l'hôte)
```

---

# Où en est le projet

| Vague | Livré | Preuve | Commit |
|---|---|---|---|
| 1 | Contrat TOML documenté, pertes annoncées, audit F-14 cohérent | 41 tests | `00f64ec` |
| 2 | `hasEthernet` : plus de proposition EEE fantôme sur iGPU | 42 tests | `1a1ee1c` |
| 3 | Le crate livré compile + garde `npm run check:rust` | cargo check OK | `cb73088` |
| 4 | Schéma à 3 états (VRAM, timer) + migration + verrou racine/autostart | 43 tests | `8c7836f`…`8aedafe` |
| 5 | Restauration `.ps1` réellement fonctionnelle | sandbox ×2 | `3ad278a` |
| 6 | Recette UI + mesure réelle du plafond | navigateur + hôte | `2ddf7fc` |
| 7 | Détection de capacités par code retour d'écriture | sandbox 13/1 | `d04ea13` |
| 8 | Binaire release testé ; GUI réparée (débordement au démarrage) | sandbox 4/4 + fenêtre hôte | — |

La vague 1 annonçait une perte inévitable (VRAM `prefer_p5`, timer 0,5 ms). La vague 4 l'a supprimée à la source : ces deux états sont désormais des champs Rust de première classe, l'export n'a plus d'extension web et l'avertissement a disparu avec sa cause.

---

# Ce qui reste à faire

Par ordre de valeur. Chaque ligne dit **pourquoi** et **comment vérifier**.

1. **Verrouiller le contrat du `.ps1` par un test exécutable.** Aujourd'hui seules des assertions de chaîne couvrent le générateur. Un test pourrait exécuter le script dans le sandbox et exiger `[OK] … X réglage(s), Y ignoré(s)` — c'est le seul moyen d'attraper une régression comme celle de la vague 5.

2. **Sonde thermique dédiée (optionnel).** Sans elle, aucune campagne chaleur/bruit n'est possible : `MSAcpi_ThermalZoneTemperature` est absent sur ce poste.

---

# Invariants à ne pas casser

Dix propriétés, chacune tenue par un test nommé. Si l'une rougit, c'est la modification qui est fautive, pas le test.

| Invariant | Test garde-fou |
|---|---|
| Rendement PSU strictement croissant (pas de saut à 45/95 W) | « la courbe d'alimentation 80+ Gold est strictement croissante » |
| Aucun watt sur le rail dGPU quand il n'y a qu'un iGPU | « sur un Mini-PC iGPU seul … 0 W, 0 RPM » |
| Latence combinée dans le budget annoncé | « le total de latence combiné … strictement dans le budget » |
| L'optimiseur converge (0 proposition User restante) | « appliquer toutes les propositions User converge » |
| Aucun gain inventé (< 0,25 W rejeté) | « toute proposition … économise réellement ≥ 0,3 W » |
| Fenêtre de confirmation réelle de 2,5 s | « exige une vraie fenêtre temporelle » |
| `.ps1` non injectable, sans NVML sur iGPU | « buildWindowsPowerShellScript génère un script sûr » |
| Schéma complet : 3 clés racine + 6 clés `[autostart]` + 24 champs, exactement | « verrouille le schéma : [profiles.config] contient exactement … » |
| Les 3 états (`prefer_p5`, `0,5 ms`) survivent à l'aller-retour | « le schéma à 3 états survit à l'aller-retour TOML » |
| Un TOML legacy à booléens reste lisible | « parseProfilesToml décode un TOML legacy … » |

---

# Décisions

| Décision | Raison |
|---|---|
| Helper pur plutôt que logique dans le composant | seul point d'encodage du contrat de perte, testable sans React |
| Avertissement nominatif (P3, P5) | actionnable ; un compteur oblige à chercher le profil fautif |
| Assertion sur l'état **réel** des profils d'usine | un test doit décrire le système, pas l'intention du rédacteur |
| Verrou de schéma par égalité exacte de clés | attrape les deux sens de dérive : champ oublié et clé non reconnue par serde |
| Énumérations Rust à 3 variantes plutôt que `bool` | un `bool` ne peut représenter ni `prefer_p5` ni `0,5 ms` ; le schéma doit porter le modèle |
| Migration au chargement plutôt que `serde(alias)` | les anciens exports contiennent les deux clés, ce que serde refuse en double |
| Migration appliquée aussi au `baseline_snapshot` | sinon un snapshot d'origine serait recapturé en silence |
| Restauration `.ps1` : `[regex]::Match` sur sortie aplatie | `-match` sur un tableau laisse `$Matches` vide → `setactive` muet mais `[OK]` affiché |
| `$ErrorActionPreference` repassé en `Continue` autour des appels natifs | sous `Stop`, le stderr natif devient un `NativeCommandError` terminant |
| Détection de capacités = échec réel de l'écriture | `PowerReadACValueIndex` réussit pour un réglage absent ; `powercfg /q` masque les policies sans valeur |
| Binaire de test en CRT statique | l'image Sandbox n'a pas le runtime Visual C++ → `0xC0000135` avant tout code applicatif |
| Mesures sur l'hôte sous élévation, restauration vérifiée | seule façon de connaître l'effet réel ; l'état initial est relu après coup |
| Garder le curseur MHz avec la mention « plafond indicatif » | mesuré partiel (+21,8 %), donc utile mais pas une limite dure |
| Afficher « ≤ 3,3 GHz » au lieu de « 3,3 GHz » | le plafond n'est pas une fréquence d'exécution : le firmware l'honore partiellement |
| Exporter le `.ps1` avec un BOM UTF-8 | sans BOM, PowerShell 5.1 lit le fichier en ANSI et casse les accents |
| Checksum des benchmarks en `wrapping_add` | les valeurs sommées sont des hashes, pas des durées ; le débordement tuait la GUI |

---

# Validation

## Chasse de défauts du crate (vague 3)

`cargo check` sur les 21 fichiers assemblés a révélé **sept** défauts, dont quatre bloquants (manifeste inanalysable, build script non liant). Trois venaient de la même cause : les `\"` et `\\` du Rust consommés par les gabarits TypeScript. La correction bannit tout antislash littéral (chaînes brutes `r"…"`, séparateurs POSIX), ce qui supprime la classe de bug. `npm run check:rust` est depuis le seul moyen de vérifier un livrable absent du disque.

## Sandbox Windows (17/11/2026)

Binaire debug, sous-système console conservé, CRT statique.

| Test | Attendu | Obtenu |
|---|---|---|
| `--check` sans `profiles.toml` | crée le schéma canonique | OK, aucun ancien booléen |
| Migration legacy puis `--apply-profile 3` | `cpu_max_percent` 55 appliqué | OK (55), `gpu_vram_policy = auto` |
| Témoin canonique P3 = 55 | 55 appliqué | OK |
| `--restore-baseline` | retour au baseline (100) | OK |
| `profiles.toml` après chargement | inchangé | md5 identique |
| `.ps1` P1 puis `-Restore`, deux fois | 92 puis 100 | OK ×2 |
| `.ps1 -Restore` sans sauvegarde | refus explicite, code 1 | OK |
| Interface native | démarre sans GPU | vivante après 6 s |
| `powercfg` direct (référence) | 77 appliqué | OK |
| Capacités : `IGPU_BIAS` sans iGPU | compté et annoncé | 13 appliqués, 1 ignoré |

## Mesure réelle (Ryzen 9 5900X, 12C/24T)

Charge fixe déterministe, 4 passes par phase, médiane, plafond relu avant/après.

| Phase | 1 thread | 24 threads |
|---|---|---|
| `PROCTHROTTLEMAX = 100` | 775,5 ms | 1 025 ms |
| `PROCTHROTTLEMAX = 55` | 1 088,5 ms (**+40,4 %**) | 1 126,5 ms (+9,9 %) |
| Retour à 100 | 775 ms, relu 100/100 | — |

En mono-thread le débit suit la fréquence : 55 % coûte 29 % de débit. En 24 threads l'effet tombe à 10 % — SMT et boost se partagent la fréquence, le débit agrégé ne suit plus linéairement.

## Plafond MHz (`PROCFREQMAX`)

Même protocole, 1 thread, 4 passes, valeur relue avant et après chaque passe.

| Phase | Médiane |
|---|---|
| `PROCFREQMAX = 0` (défaut) | 922,5 ms |
| `PROCFREQMAX = 2000` | 1 123,5 ms (**+21,8 %**) |
| Retour à 0 | 889 ms, valeur relue 0 |

Un vrai verrou à 2 000 MHz (54 % de la base 3 701 MHz) devrait coûter ~+85 % ; on n'observe que +22 %. Le réglage **agit** — il n'est pas décoratif — mais le firmware AMD l'honore **partiellement** : c'est un plafond indicatif, pas une limite dure. Le curseur reste utile à condition de le dire.

## Binaire release

Sous-système GUI : les commandes headless doivent être lancées avec `Start-Process -Wait -PassThru`, et `$args` **ne peut pas** servir de nom de paramètre (variable automatique : le binaire était lancé sans argument).

| Test | Résultat |
|---|---|
| `--check` sans fichier de profils | code 0, schéma canonique créé |
| `--apply-profile 3 --headless` | 55 appliqué |
| `--restore-baseline` | 100 restauré |
| GUI | vivante après 6 s, fenêtre réelle (sandbox et hôte) |

Le premier passage a révélé que la GUI **ne démarrait jamais** : `bench_multithread_aggregate` additionnait des états LCG de 64 bits, la somme débordait à chaque lancement, et `panic = "abort"` tuait le processus (`0xC0000409`). En debug la panique était avalée par winit, d'où une fenêtre morte mais un processus vivant. Corrigé par un repli `wrapping_add`, verrouillé par un test.

## Détection de capacités

| Sonde | Verdict |
|---|---|
| `PowerReadACValueIndex` | réussit **même** pour un réglage absent (val=0) → aveugle |
| `powercfg /q` | n'affiche que les policies avec une valeur stockée → faux négatifs |
| `PowerEnumerate(ACCESS_INDIVIDUAL_SETTING)` | liste le catalogue Windows, pas ce que le firmware honore |

Détection retenue : le **code retour de l'écriture**. Rust le consigne dans `ApplyReport::unsupported_items` ; le `.ps1` compare les codes AC et DC et affiche `[INFO] Refusés par Windows …` puis `[OK] … X réglage(s), Y ignoré(s)`. Limite assumée : une écriture acceptée ne garantit pas que le firmware l'applique.

---

# Pièges connus

1. **Binaire de test sandbox** : sans `-C target-feature=+crt-static`, le processus meurt en `0xC0000135` avant la première ligne de code. Le binaire release n'est pas concerné sur une machine avec le runtime VC++.
2. **`$Matches` sur un tableau** : `powercfg /import` peut renvoyer plusieurs lignes ; `-match` travaille alors sur une collection et `$Matches` reste vide. Toujours aplatir (`Out-String`) avant `[regex]::Match`.
3. **`$ErrorActionPreference = 'Stop'` + commande native** : tout stderr devient un `NativeCommandError` terminant. Repasser en `Continue` le temps de l'appel.
4. **`powercfg /q` n'est pas un test de capacité** : une policy sans valeur stockée n'est pas affichée, alors qu'elle existe et s'écrit.
5. **`PROCFREQMAX` est un plafond indicatif sur AMD** : mesuré à +21,8 % pour 2 000 MHz au lieu des ~+85 % attendus d'un verrou dur.
6. **Somme de checksums en `u64`** : additionner des hashes (états LCG) déborde ; avec `overflow-checks = true` et `panic = abort`, cela tue la GUI avant la première frame.
7. **`.ps1` sans BOM** : PowerShell 5.1 lit un fichier sans BOM comme de l'ANSI, donc « sauvegardée » sort en « sauvegardÃ©e ». Le BOM est obligatoire.
8. **Clés `PowerSchemes` protégées** : même élevé, un administrateur ne peut pas supprimer une valeur écrite via l'API ; il faut passer par l'API elle-même.

---

# Idées à ne pas appliquer (et pourquoi)

1. **Supprimer `gpu_vram_policy` / `timer_resolution` de l'export.** Non : c'était soigner le symptôme ; la vague 4 en a fait les champs Rust eux-mêmes.
2. **Revenir aux paliers de rendement PSU.** Non : non monotone — baisser la charge de 46 à 44,5 W faisait *monter* la consommation murale.
3. **Remettre `nicEeeEnabled` dans la règle User `usb_wifi_idle`.** Non : réglage admin dans une proposition User ⇒ re-proposition infinie.
4. **Remplacer la fenêtre 2,5 s par un compteur de cycles.** Non : deux re-renders à 50 ms validaient la bascule.
5. **« Corriger » `noppme` (ps0_only → 0).** Non : déjà aligné sur `u32::from(cfg.nvme_apst != NvmeApst::Ps0Only)`.
6. **Additionner les `latencyDeltaMs`.** Non : double comptage CPU/timer, total supérieur au budget réel.
7. **Remplacer `ac == ERROR_SUCCESS && dc == ERROR_SUCCESS.0` par `.is_ok()`.** Non : `PowerWriteDCValueIndex` renvoie un `u32`, `.is_ok()` ne compile pas.
8. **Masquer l'avertissement d'export quand les valeurs sont celles d'usine.** Non : il fallait le montrer ; depuis la vague 4 la perte n'existe plus, l'avertissement a été supprimé avec sa cause.

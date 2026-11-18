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
| 9 | Constructeur CPU détecté ; plafond MHz annoncé comme indicatif sur AMD | `cargo test` 12/12 (`vendor_tests`) | ce commit |
| 10 | Banc CPPC2 versionné : EPP sans effet, plafond à un cran, Turbo -30 % | 33 mesures, CSV dans `measurements/` | ce commit |

La vague 1 annonçait une perte inévitable (VRAM `prefer_p5`, timer 0,5 ms). La vague 4 l'a supprimée à la source : ces deux états sont désormais des champs Rust de première classe, l'export n'a plus d'extension web et l'avertissement a disparu avec sa cause.

---

# Ce qui reste à faire

Par ordre de valeur. Chaque ligne dit **pourquoi** et **comment vérifier**.

1. **Adapter à CPPC2 côté AMD.** La détection du constructeur et l'avertissement sous le curseur sont faits ; proposer des réglages propres à AMD demanderait une campagne de mesure sur un poste AMD, sinon c'est du décor.

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
| Garder le curseur MHz avec la mention « plafond » | +43,5 % mesurés à 3 300 MHz sur charge longue ; sur ce 5900X, 2 000 MHz donne le même résultat — un seul cran, pas une échelle |
| Mesurer sur 6 s après chauffe plutôt que sur 1 s | une charge courte se fait encore en boost et sous-estime le plafond de moitié (+21,8 % au lieu de +43,5 %) |
| Ne pas exposer l'EPP comme levier de débit | mesuré sans effet sur le 5900X (6 122 / 6 029 / 6 105 ms à EPP 0 / 50 / 100, soit le bruit) |
| Réactiver le plan après écriture (`PowerSetActiveScheme`) | sans cela le système conserve les anciennes valeurs : la première campagne mesurait trois fois le même état |
| Afficher « ≤ 3,3 GHz » au lieu de « 3,3 GHz » | le plafond n'est pas une fréquence d'exécution : le firmware l'honore partiellement |
| Exporter le `.ps1` avec un BOM UTF-8 | sans BOM, PowerShell 5.1 lit le fichier en ANSI et casse les accents |
| Checksum des benchmarks en `wrapping_add` | les valeurs sommées sont des hashes, pas des durées ; le débordement tuait la GUI |
| Détecter le constructeur via `PROCESSOR_IDENTIFIER` plutôt que CPUID | pas d'unsafe, pas de dépendance, et le nom ne sert qu'à avertir — jamais à choisir un réglage |
| Ne proposer aucun réglage CPPC2 non mesuré | la règle du projet : aucun levier sans preuve de débit, de température ou de bruit |
| Désarmer le garde-fou après une restauration explicite | sinon son `Drop` réapplique la même baseline : double écriture et journal qui compte deux restaurations pour une |

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

Première campagne (charge ~1 s, 4 passes) : `PROCFREQMAX = 2 000` coûtait +21,8 %, très loin des ~+85 % d'un verrou dur.

Campagne CPPC2 du 17/11/2026 (charge calibrée de 6 s, 3 passes, chauffe de 3 s, 4 750 M itérations, `scripts/measure-cppc.ps1`) :

| Phase | Médiane | Écart |
|---|---|---|
| référence (plafond 0) | 6 022,6 ms | — |
| `PROCFREQMAX = 3300` | 8 642,2 ms | **+43,5 %** |
| `PROCFREQMAX = 2000` | 8 630,1 ms | **+43,3 %** |
| retour à 0 | 6 135,3 ms | +1,9 % |

Deux faits que la charge courte masquait :

1. l'effet réel est **deux fois plus grand** (+43 % et non +22 %) : sur une seconde, le début de passe se fait encore en boost, ce qui dilue la moyenne ;
2. le plafond n'a **qu'un cran sur ce 5900X** : 3 300 et 2 000 MHz donnent le même temps (0,14 % d'écart, étendue de 3-4 ms) et la même fréquence rapportée, 3 342 MHz. Un autre modèle peut descendre plus bas : le repère affiché est une mesure, pas une limite.

C'est un plafond à palier unique, pas une échelle de fréquences.

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
5. **`PROCFREQMAX` n'a qu'un cran sur le 5900X testé** : 3 300 et 2 000 MHz y donnent le même temps (+43,5 %) et la même fréquence (3 342 MHz) ; un autre CPU peut descendre plus bas. Une charge d'une seconde sous-estime l'effet de moitié (+21,8 %) : le début de passe échappe encore au plafond. Mesurer 6 s après chauffe.
6. **Somme de checksums en `u64`** : additionner des hashes (états LCG) déborde ; avec `overflow-checks = true` et `panic = abort`, cela tue la GUI avant la première frame.
7. **`.ps1` sans BOM** : PowerShell 5.1 lit un fichier sans BOM comme de l'ANSI, donc « sauvegardée » sort en « sauvegardÃ©e ». Le BOM est obligatoire.
8. **Clés `PowerSchemes` protégées** : même élevé, un administrateur ne peut pas supprimer une valeur écrite via l'API ; il faut passer par l'API elle-même.
9. **Backtick dans une doc Rust** : le contenu des fichiers Rust vit dans un template literal TypeScript ; un backtick non échappé dans un commentaire ferme la chaîne et casse l'assemblage (`Expected "}"`). Même classe que les `\"` de la vague 3.
10. **Écrire ne suffit pas** : sans `PowerSetActiveScheme` après `PowerWriteACValueIndex`, le système peut conserver l'ancien réglage. Le crate le fait ; le banc aussi depuis la deuxième campagne.
11. **`\n` dans un template literal** : un `join("\n")` écrit tel quel dans `rustProject.ts` devient un vrai saut de ligne dans le Rust généré et casse la chaîne. Il faut `\\n` dans le TS.
12. **Un aplat n'est pas une hachure** : sur egui, un rectangle ambre semi-transparent sous le repère ressemblait à une barre de progression. Des traits fins sous la piste disent « zone morte » sans ambiguïté.

---

# Vague 11 — Journal & zone morte (18/11/2026)

1. **Journal au point unique.** `PlatformController::apply_config` est le seul passage de toutes les écritures (CLI, Safe-Boot, GUI) : le journal y est écrit, donc aucun chemin ne peut l'oublier. Une erreur d'écriture est ignorée : elle ne doit jamais faire échouer une application.
2. **Format une ligne.** Horodatage UTC, droits, valeurs clés et refus, sans JSON ni dépendance de date : lisible dans Notepad et parsable. `--journal` montre les 20 dernières lignes et le chemin réel.
3. **Zone morte hachurée, pas bridée.** Le curseur garde toute sa plage (décision de la vague 10) ; sous le repère, des hachures signalent l'absence d'effet mesuré et la valeur affiche « aucun gain sous 3 300 (mesuré) ».
4. **Pas de plancher inventé.** Le plancher de 3 342 MHz est propre au 5900X ; les profils AMD du web (7800X3D, 7840HS) n'ont pas été mesurés. On annote, on ne modifie pas le modèle physique.
5. **Journal prouvé par le binaire (18/11/2026).** Le test unitaire ne suffisait pas : dans le bac à sable jetable, `--apply-profile 3 --headless` puis `--restore-baseline` ont écrit deux lignes (`cpu_max=55%`, puis `cpu_max=100%`), relues par un troisième processus `--journal` ; sans journal, la commande répond « aucune application enregistrée » et sort en 0. Premier passage : trois lignes, car `--restore-baseline` appliquait la baseline une fois explicitement puis une fois via le `Drop` du `RollbackGuard`. Le garde-fou est désormais désarmé après la restauration explicite.

---

# Vague 12 — Interface multilingue, v3 (18/11/2026)

1. **Bascule persistante.** `ecoclock_rs_locale_v1` dans `localStorage`, `document.documentElement.lang` mis à jour, défaut français. Le sélecteur FR / EN / IT / DE vit dans la barre de titre.
2. **Traduit :** coquille (titre, navigation, pied de page), 5 profils (noms et descriptions d'usine, un profil renommé garde son nom), scénarios de charge, libellés matériel, tous les réglages et leurs notes, dialogues UAC / démarrage / matériel, raccourcis, notifications, barrière d'erreur.
3. **Diagnostics moteur bilingues (suite).** Les 19 constats d'audit portent `titleEn`/`detailEn`/`consequenceEn`/`fixLabelEn`, les 9 propositions Pareto `titleEn`/`whyTechnicalEn`, les benchmarks `nameEn`/`humanVerdictEn`. Le tableau de bord est donc entièrement anglais, sans bandeau.
4. **Reste en français, annoncé :** onglets Avant/Après, Mode intelligent, Audit et 5 Profils. Ces vues affichent un bandeau dès que la langue n'est pas le français.
5. **Pas de dictionnaire central.** Les paires FR/EN vivent au point d'affichage (`t(fr, en)`), les données localisées à côté de leur source (`descriptionEn`, `shortLabelEn`, `hardwareDisplayLabel`, `titleEn`, `nameEn`). Aucune clé abstraite à désynchroniser, et le français reste la source de vérité du projet. Le compilateur force la couverture : les champs `*En` d'audit et de proposition sont obligatoires.
6. **Infobulles bilingues.** Les 39 fiches de `tooltips.ts` ont une traduction anglaise dans `tooltipsEn.ts`, typée `Record<keyof typeof TOOLTIPS, TooltipDocEn>` : une clé manquante casse le build. Plus aucune mention « encore en français » dans le panneau.
7. **IT / DE annoncés, pas simulés.** Ces deux langues n'ont pas encore de traduction : l'interface et les infobulles s'affichent en anglais, avec un bandeau rédigé dans la langue choisie. Le français reste la langue par défaut.

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

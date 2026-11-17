# Plan d'actions — EcoClock-rs Web

Base : `rust-hardware-underclocking-utility4.zip` (17/11/2026, 54 fichiers, 16 121 lignes `src/`).
Organisation en **vagues** : une vague = un ensemble de correctifs sans interaction entre eux, validable en une seule passe de vérification.

**État vérifié à l'instant :** `tsc --noEmit` 0 erreur · `vitest run` **43/43** · `vite build` OK (~815 kB / 240,9 kB gzip) · `cargo check` OK sur le crate livré.
Référence d'origine (v4 non modifiée) : 39 tests, 808,45 kB / 239,10 kB.

| Vague | Contenu | Statut | Tests |
|---|---|---|---|
| **1** | Contrat TOML documenté, pertes annoncées, audit cohérent, docstrings | ✅ **livrée** | 41 |
| **2** | `hasEthernet` : suppression de la proposition EEE fantôme | ✅ **livrée** | 42 |
| **3** | Le crate Rust livré compile réellement + garde `npm run check:rust` | ✅ **livrée** | 42 |
| **4** | Schéma TOML à 3 états : plus aucune perte web → Rust | ✅ **livrée** | 43 |

---

# Vague 1 — livrée

## Ce qui a changé

| Fichier | Changement | Lignes |
|---|---|---|
| `src/data/profiles.ts` | en-tête TOML documentant les 2 extensions + helper pur `getTomlPersistenceWarnings` | +3 / +17 |
| `src/App.tsx` | `handleExportToml` distingue export fidèle et export à pertes | 1 import + 16 |
| `src/components/AuditPlanView.tsx` | fiche F-14 et tableau comparatif remis en cohérence | 4 |
| `src/engine/adaptive.ts` | docstring 6 → 7 situations | 2 |
| `src/engine/engine.test.ts` | 2 tests de contrat | +2 tests |

## 1.1 — Les deux clés TOML hors schéma Rust sont désormais assumées

> **Remplacé par la vague 4 (§4.1)** : le schéma Rust porte maintenant les 3 états, il n'y a plus de clé hors schéma.

`src/data/profiles.ts`, en-tête de `serializeProfilesToToml` :

```ts
"# %APPDATA%\\EcoClock\\profiles.toml — Compatible 1:1 avec EcoClock-rs (src/domain.rs::ProfileStore)",
"# Écriture atomique (.tmp + sync_all + rename) | Toutes les valeurs sont re-bornées par clamped()",
"# Extensions web volontaires (ignorées par serde côté Rust) : gpu_vram_policy, timer_resolution",
"#   -> préservent prefer_p5 et high_0_5ms, non représentables par les booléens Rust",
```

**Pourquoi ne pas les supprimer.** `GpuVramPolicy` et `TimerResolutionPolicy` ont 3 états chacun ; le `HardwareConfig` Rust n'a qu'un `bool` pour chacun (`gpu_force_p8_idle`, `timer_coalescing`). Ces deux clés sont donc ce qui rend l'export fidèle en web↔web. Les supprimer dégraderait le round-trip sans rien apporter côté Rust, qui les ignore de toute façon.

## 1.2 — La perte inévitable côté Rust est calculée et annoncée

> **Remplacé par la vague 4 (§4.2–4.3)** : la perte a été supprimée à la source ; le helper et son test ont été retirés.

Nouveau helper **pur** dans `src/data/profiles.ts` :

```ts
export function getTomlPersistenceWarnings(profiles: readonly Profile[]): string[] {
  const warnings: string[] = [];
  for (const profile of profiles) {
    if (profile.config.timerResolution === "high_0_5ms") {
      warnings.push(`P${profile.id} : timer 0,5 ms → reviendra à 1 ms`);
    }
    if (profile.config.gpuVramPolicy === "prefer_p5") {
      warnings.push(`P${profile.id} : VRAM prefer_p5 → reviendra à auto`);
    }
  }
  return warnings;
}
```

Et dans `handleExportToml`, l'avertissement remplace le toast « schéma 1:1 » trompeur :

```ts
const losses = getTomlPersistenceWarnings(profiles);
if (losses.length > 0) {
  pushToast(
    "warning",
    `profiles.toml exporté — ${losses.length} réglage(s) propre(s) au web`,
    `${losses.join(" · ")}. Ils reviendront à leur valeur Rust au premier enregistrement par ecoclock.exe ; les autres champs sont conservés.`
  );
} else { /* toast de succès existant */ }
```

**Pourquoi un helper pur plutôt qu'un `filter` dans le composant.** C'est le seul endroit où le contrat de perte est encodé. Une fonction pure est testable sans React, et le jour où le schéma Rust évoluera, un seul point sera à modifier.

**Pourquoi des messages nominatifs et non un compteur.** « P5 : timer 0,5 ms → reviendra à 1 ms » est actionnable ; « 1 profil en timer 0,5 ms » oblige l'utilisateur à chercher lequel.

## 1.3 — Ce que l'exécution a appris (et que le plan initial ignorait)

Le premier jet du test affirmait que les profils d'usine étaient fidèles. **Il a échoué**, et c'était une erreur d'analyse de ma part, pas un bug du code :

- **P3 « Jeu & Création Frais »** utilise `gpuVramPolicy: "prefer_p5"` — logique, c'est le profil gaming.
- **P5 « Nominal Windows (Stock) »** hérite de `STOCK_BASELINE_CONFIG`, donc de `timerResolution: "high_0_5ms"` — logique aussi, c'est la référence Windows.

Conséquence : **l'avertissement s'affichera dès le premier export, sur la configuration d'usine.** Ce n'est pas un défaut du correctif, c'est la réalité du contrat : le binaire Rust ne peut pas encoder ces deux états.

Deux suites possibles, à arbitrer :

1. **Accepter** (état actuel). L'utilisateur est prévenu à chaque export, ce qui est exact mais répétitif.
2. **Corriger à la source, côté Rust** : remplacer `gpu_force_p8_idle: bool` par un `GpuVramPolicy` à 3 variantes et `timer_coalescing: bool` par un `TimerResolutionPolicy` à 3 variantes. L'avertissement disparaît alors naturellement. C'est un changement de `src/domain.rs` + migration de schéma — **hors périmètre de cette app web**, noté en vague 3.

Le test a été réécrit pour verrouiller l'état **réel**, pas l'état souhaité :

```ts
expect(getTomlPersistenceWarnings(DEFAULT_PROFILES)).toEqual([
  "P3 : VRAM prefer_p5 → reviendra à auto",
  "P5 : timer 0,5 ms → reviendra à 1 ms",
]);
```

## 1.4 — Verrou de schéma : 24 champs Rust + 2 extensions, et rien d'autre

> **Mis à jour par la vague 4 (§4.4)** : le verrou exige désormais exactement 24 champs, sans extension.

Test ajouté dans `engine.test.ts` : il découpe le TOML exporté par `[[profiles]]`, isole chaque bloc `[profiles.config]`, extrait les clés et exige l'égalité **exacte** avec les 24 champs du `HardwareConfig` Rust plus les 2 extensions.

Ce que ça empêche : qu'une future évolution du modèle ajoute un champ sans l'exporter (perte silencieuse), ou qu'un champ soit exporté sous un nom que serde ignorera (perte silencieuse aussi). C'est le seul test du projet qui protège le contrat **dans les deux sens**, et il ne dépend d'aucune donnée d'usine.

Le commentaire du test cite la source de vérité (`struct HardwareConfig` de `src/data/rustProject.ts`) pour qu'un relecteur puisse vérifier la liste sans deviner.

## 1.5 — Fiche d'audit F-14 remise en cohérence

```diff
-    title: "Tests unitaires TypeScript non encore industrialisés",
-    evidence: "Le moteur physique et l'optimiseur ne sont pas couverts par une suite automatisée.",
+    title: "Couverture de tests TypeScript industrialisée (41 tests, Vitest)",
+    evidence: "La v3 ne couvrait ni la monotonie du modèle PSU, ni la convergence de l'optimiseur, ni le contrat TOML.",
```

Le tableau comparatif de l'onglet Audit passe de « 39 tests » à « 41 tests ». Aucune autre occurrence de « 39 tests » ne subsiste dans `src/` (vérifié par `grep`).

## 1.6 — Docstring des 7 situations

`src/engine/adaptive.ts`, commentaire de `simulatePolicyMatrix` : « sur 6 situations » → liste explicite des 7 (bureau, pause, batterie, nuit, jeu, build, surchauffe). Le tableau en génère 7, l'UI en affiche 7, le test vérifie 7 : seul le commentaire était resté en arrière.

---

# Vague 2 — livrée

## Ce qui a changé

| Fichier | Changement |
|---|---|
| `src/types/hardware.ts` | champ `hasEthernet: boolean`, obligatoire |
| `src/data/hardwareProfiles.ts` | valeur pour les 4 profils : `true`, `true`, **`false` (portable)**, `true` |
| `src/engine/validation.ts` | le clamp force `nicEeeEnabled = false` sans Ethernet |
| `src/engine/optimizer.ts` | `isNeeded` exige `hw.hasEthernet` |
| `src/engine/engine.test.ts` | 1 test : proposition absente en Wi-Fi seul, présente en filaire, clamp vérifié |

**Arbitrage sur le portable.** Le profil « Portable Ryzen + RTX 4060 » décrit une dalle interne 2560×1600 165 Hz sans port RJ45 mentionné : `hasEthernet: false`. C'est le choix prudent — omettre une optimisation possible coûte moins cher qu'annoncer 2,4 W qui ne peuvent pas se produire, puisque l'app revendique « aucun gain inventé ». Si votre châssis possède un RJ45, repasser la ligne à `true`.

## `hasEthernet` : supprimer la proposition EEE fantôme

**Le défaut.** La règle `nic_eee_802_3az` (ajoutée en v4) teste le réglage mais jamais le matériel :

```ts
isNeeded: (c) => !c.nicEeeEnabled,
```

Sur un portable Wi-Fi seul, l'optimiseur propose « Activer Ethernet IEEE 802.3az » et annonce ~2,4 W sur un contrôleur inexistant. C'est la même classe de bug que le NVML sur iGPU, corrigée en v4 mais non généralisée : `HardwareProfile` ne décrit aucune connectivité.

### Patch 2a — `src/types/hardware.ts`, après `hasDedicatedGpu` (ligne 59)

```diff
   hasDedicatedGpu: boolean;
+  /** Présence d'un contrôleur Ethernet cuivre. Conditionne la pertinence de l'EEE 802.3az. */
+  hasEthernet: boolean;
   maxDisplayHz: DisplayRefreshHz;
```

Champ **obligatoire** : le compilateur signalera les 4 profils à compléter, aucun oubli possible.

### Patch 2b — `src/data/hardwareProfiles.ts`

À côté de chaque `hasDedicatedGpu` (lignes 30, 55, 80, 105) :

| Profil | valeur |
|---|---|
| Desktop Intel i7-13700K + RTX 4070 | `hasEthernet: true` |
| Desktop AMD 7800X3D + RTX 4070 SUPER | `hasEthernet: true` |
| Portable Ryzen 7840HS + RTX 4060 Laptop | **`false`** (dalle 1600p, pas de RJ45 — voir arbitrage) |
| Mini-PC i5-12400 / UHD 730 | `hasEthernet: true` |

### Patch 2c — `src/engine/validation.ts`, dans l'objet retourné par `clampConfigToProfile` (après ligne 57)

```diff
   gpuZeroRpmFanStop: hasDgpu ? cfg.gpuZeroRpmFanStop : false,
+  nicEeeEnabled: profile.hasEthernet ? cfg.nicEeeEnabled : false,
   nvmeIdleTimeoutMs: Math.min(5000, Math.max(50, Math.round(cfg.nvmeIdleTimeoutMs))),
```

Même logique que les trois lignes qui précèdent : ce que le matériel ne peut pas faire est neutralisé dans l'état, pas seulement masqué dans l'interface. Un TOML importé depuis une autre machine ne peut donc pas transporter un réglage inapplicable.

### Patch 2d — `src/engine/optimizer.ts`, règle `nic_eee_802_3az` (ligne 350)

```diff
-    isNeeded: (c) => !c.nicEeeEnabled,
+    isNeeded: (c, _g, hw) => hw.hasEthernet && !c.nicEeeEnabled,
```

La signature `isNeeded(cfg, goal, profile)` accepte déjà le profil.

### Patch 2e — test, à la fin de `engine.test.ts` (avant la ligne 703)

```ts
  it("ne propose l'EEE 802.3az que sur une machine réellement dotée d'un port Ethernet", () => {
    const wifiOnly = { ...HARDWARE_PROFILES[0], hasEthernet: false };
    const cfgWifi = clampConfigToProfile(STOCK_BASELINE_CONFIG, wifiOnly);
    expect(
      generateOptimizationProposals(cfgWifi, "office", "pareto", wifiOnly).some((p) => p.id === "nic_eee_802_3az")
    ).toBe(false);

    const wired = HARDWARE_PROFILES[0];
    const cfgWired = clampConfigToProfile(STOCK_BASELINE_CONFIG, wired);
    expect(
      generateOptimizationProposals(cfgWired, "office", "pareto", wired).some((p) => p.id === "nic_eee_802_3az")
    ).toBe(true);

    // Le clamp doit éteindre le réglage, pas seulement masquer la proposition
    expect(clampConfigToProfile({ ...cfgWired, nicEeeEnabled: true }, wifiOnly).nicEeeEnabled).toBe(false);
  });
```

> Si la 2ᵉ assertion échoue, c'est que le seuil « gain ≥ 0,25 W » filtre la règle. Dans ce cas, réduire l'assertion à `isNeeded` seul (via un profil à `nicEeeEnabled: true`) — **ne pas** abaisser le seuil, il protège contre les gains inventés.

### Vérification — exécutée

```bash
npx tsc --noEmit    # 0 erreur (les 4 profils se sont bien signalés incomplets avant 2b)
npx vitest run      # 42/42
npm run build       # 809,32 kB / 239,46 kB gzip
```

---

# Vague 3 — livrée : le crate Rust compile

## Le défaut

L'onglet « Source Rust » présente 21 fichiers comme un projet complet et téléchargeable. Ce crate n'existait nulle part sur le disque : il est assemblé à partir de littéraux TypeScript, donc `tsc` ne voit jamais son contenu et aucun test ne le compilait. `cargo check` révélait **sept défauts**, dont quatre bloquants dès la première étape.

| # | Fichier | Défaut | Effet |
|---|---|---|---|
| 1 | `Cargo.toml` | `nvml-wrapper` placé **après** `[features]` | manifeste inanalysable par Cargo |
| 2 | `Cargo.toml` | `embed_resource` utilisé sans `[build-dependencies]` | build script impossible à lier |
| 3 | `build.rs` | `'\'` : littéral de caractère non terminé | build script ne compile pas |
| 4 | `build.rs` | `"1 24 "{manifest}""` : guillemets non échappés | idem |
| 5 | `platform/autostart.rs` | clé de registre et nom de tâche en antislashs simples | 5 erreurs d'échappement |
| 6 | `platform/autostart.rs` | `format!(""{}" --apply-profile…")` | ligne de commande cassée |
| 7 | `platform/gpu_nvml.rs` | `struct_wrappers::device::GpuLockedClocksSetting` | type inexistant en 0.10 (c'est `enums::device`) |

Les défauts 3, 4 et 6 ont la même cause : les `\"` et `\\` du Rust ont été consommés par les gabarits TypeScript qui les hébergent. La correction évite désormais **tout antislash littéral** (chaînes brutes Rust `r"…"` / `r#"…"#`, séparateurs POSIX pour `rc.exe`), ce qui supprime la classe de bug plutôt que l'occurrence.

## La garde

`npm run check:rust` (`scripts/check-rust.mjs`) bundle les deux modules de données avec esbuild, écrit les 21 fichiers dans `.check-rust/`, lance `cargo check` et propage le code de sortie. Le dossier est supprimé en cas de succès, conservé avec `--keep` pour inspection.

```bash
npm run check:rust     # 21 fichiers Rust extraits → cargo check : OK
```

Cette commande est le seul moyen de vérifier un livrable qui n'existe pas sur le disque. Elle doit être lancée à chaque modification de `rustProject.ts` ou `rustExtras.ts`.

## État vérifié

```
npm run check:rust   → 21 fichiers, cargo check OK (3 warnings de code mort)
tsc --noEmit         → 0 erreur
vitest run           → 42/42
vite build           → ~810 kB / 239,6 kB gzip
```

# Vague 4 — livrée

Objectif : supprimer la **cause** des pertes TOML, pas seulement les signaler.

## 4.1 — Le schéma Rust porte les 3 états

`src/domain.rs` : deux énumérations remplacent les deux `bool`.

```rust
pub enum GpuVramPolicy { Auto, PreferP5, ForceP8Idle }
// auto | prefer_p5 | force_p8_idle

pub enum TimerResolutionPolicy { Standard1Ms, High0_5Ms, Coalesced15_6Ms }
// standard_1ms | high_0_5ms | coalesced_15_6ms
```

`HardwareConfig` expose donc `gpu_vram_policy` et `timer_resolution` : exactement les noms et les valeurs que l'export web écrivait déjà. Les variantes sont renommées **une par une** (`#[serde(rename = "...")]`) ; `rename_all = "snake_case"` aurait produit `standard1_ms` et `high0_5ms`, incompatibles avec le contrat web.

`TimerResolutionPolicy::ignores_timer_resolution()` remplace le booléen au point d'appel Windows (`PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION`) : seule la coalescence l'active. `Standard1Ms` et `High0_5Ms` ne l'activent pas, comme l'ancien `timer_coalescing = false`.

## 4.2 — Migration des fichiers existants

`src/config.rs` : `decode_profiles` et `decode_baseline` désérialisent d'abord en `toml::Value`, migrent, puis convertissent.

- `gpu_force_p8_idle` → `gpu_vram_policy` (`true` → `force_p8_idle`, `false` → `auto`) ;
- `timer_coalescing` → `timer_resolution` (`true` → `coalesced_15_6ms`, `false` → `standard_1ms`) ;
- si la clé canonique existe déjà (exports web de la vague 1, qui écrivaient les deux), **elle gagne** ;
- l'ancienne clé est toujours retirée : serde refuse un champ en double, et `prefer_p5` / `0,5 ms` ne sont pas représentables par un booléen.

La même migration s'applique à `baseline_snapshot.toml`, sinon un snapshot d'origine serait silencieusement recapturé.

## 4.3 — Le web n'a plus d'extension ni d'avertissement

`src/data/profiles.ts` :

- `serializeProfilesToToml` n'écrit que `gpu_vram_policy` et `timer_resolution` : l'export est le schéma Rust, sans clé supplémentaire ;
- `parseProfilesToml` valide la valeur contre les 3 états connus (une chaîne inconnue retombe sur le profil par défaut, au lieu d'un cast aveugle) et accepte encore les booléens hérités ;
- `getTomlPersistenceWarnings` est supprimé : il n'y a plus de perte à annoncer.

`src/App.tsx` : `handleExportToml` n'a plus qu'un toast de succès.

## 4.4 — Tests

- **TypeScript** : le verrou de schéma exige désormais **exactement les 24 champs** de `HardwareConfig`, sans extension ; import d'un TOML legacy où les booléens remplacent les énumérations ; aller-retour `prefer_p5` / `high_0_5ms` ; valeur inconnue retombant sur le défaut.
- **Rust** : migration des deux clés (dont le cas « clé canonique prioritaire »), aller-retour TOML des énumérations avec la forme exacte des chaînes, et table de vérité de `ignores_timer_resolution`.

## 4.5 — Le verrou couvre tout le fichier

Le test de schéma ne vérifiait que les blocs `[profiles.config]`. Il contrôle désormais aussi les 3 clés racine (`active_slot`, `show_tooltips`, `adaptive_enabled`) et les 6 clés de `[autostart]`. Une clé mal orthographiée serait ignorée en silence par serde, faute de `deny_unknown_fields` côté Rust.

## Vérification

| Commande | Résultat |
|---|---|
| `tsc --noEmit` | 0 erreur |
| `vitest run` | **43/43** |
| `vite build` | OK, 814,83 kB (240,87 kB gzip) |
| `cargo check` | OK, 4 tests unitaires ajoutés |

Non vérifié : l'interface (toast d'export, onglet « Source Rust », téléchargement `.zip`) n'a pas été ouverte.

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
| **Schéma complet : 3 clés racine + 6 clés `[autostart]` + 24 champs, exactement** | « verrouille le schéma : [profiles.config] contient exactement … » |
| **Les 3 états (prefer_p5, 0,5 ms) survivent à l'aller-retour** | « le schéma à 3 états survit à l'aller-retour TOML » |
| **Un TOML legacy à booléens reste lisible** | « parseProfilesToml décode un TOML legacy … » |

---

# Idées à ne pas appliquer (et pourquoi)

1. **Supprimer `gpu_vram_policy` / `timer_resolution` de l'export (idée de la vague 1).** Non : c'était soigner le symptôme. La vague 4 a corrigé la cause — ces clés sont devenues les champs Rust eux-mêmes.
2. **Revenir aux paliers de rendement PSU (0,835 / 0,885 / 0,905).** Non : non monotone — baisser la charge de 46 à 44,5 W faisait *monter* la consommation murale.
3. **Remettre `nicEeeEnabled` dans la règle User `usb_wifi_idle`.** Non : réglage admin dans une proposition applicable en User ⇒ re-proposition infinie.
4. **Remplacer la fenêtre 2,5 s par un compteur de cycles.** Non : deux re-renders à 50 ms validaient la bascule.
5. **« Corriger » `noppme` (ps0_only → 0).** Non : déjà aligné sur `u32::from(cfg.nvme_apst != NvmeApst::Ps0Only)`, ligne 1240 de `rustProject.ts`.
6. **Additionner les `latencyDeltaMs`.** Non : double comptage CPU/timer, total supérieur au budget réel.
7. **Remplacer `ac == ERROR_SUCCESS && dc == ERROR_SUCCESS.0` par `.is_ok()`.** Non : `PowerWriteDCValueIndex` renvoie un `u32`, `.is_ok()` ne compile pas.
8. **Masquer l'avertissement d'export quand les valeurs sont celles d'usine.** Non : il fallait au contraire le montrer. Depuis la vague 4 la perte n'existe plus, l'avertissement a donc été supprimé avec sa cause.

---

# Journal des décisions

| Décision | Raison |
|---|---|
| Helper pur plutôt que logique dans le composant | seul point d'encodage du contrat de perte, testable sans React |
| Avertissement nominatif (P3, P5) | actionnable ; un compteur oblige à chercher le profil fautif |
| Assertion sur l'état **réel** des profils d'usine | un test doit décrire le système, pas l'intention du rédacteur |
| Verrou de schéma par égalité exacte de clés | attrape les deux sens de dérive : champ oublié et clé non reconnue par serde |
| Aucun changement de comportement produit | P3 reste en `prefer_p5`, P5 en `high_0_5ms` : ce sont des choix métier, pas des bugs |
| Énumérations Rust à 3 variantes plutôt que `bool` | un `bool` ne peut représenter ni `prefer_p5` ni `0,5 ms` ; le schéma doit porter le modèle |
| Migration au chargement plutôt que `serde(alias)` | les anciens exports web contiennent les deux clés, ce que serde refuse en double |
| Migration appliquée aussi au `baseline_snapshot` | sinon un snapshot d'origine serait recapturé en silence |

---

# Definition of done

- [x] `npx tsc --noEmit` : 0 erreur
- [x] `npx vitest run` : 43/43
- [x] `npm run build` : succès, ~815 kB (240,9 kB gzip)
- [x] Aucune occurrence de « 39 tests » dans `src/`
- [x] Vague 2 : `npx vitest run` → 43/43
- [ ] Export `profiles.toml` puis réimport : les 5 profils et l'autostart reviennent à l'identique
- [ ] Export depuis l'UI : un seul toast vert, plus aucune perte (code en place, non vu à l'écran)
- [x] `npm run check:rust` : 21 fichiers extraits, `cargo check` OK
- [x] Vague 4 : import d'un `profiles.toml` legacy couvert côté Rust et côté TypeScript
- [ ] `npm run dev` : l'app démarre, les 6 onglets s'ouvrent, la matrice adaptative affiche 7 lignes

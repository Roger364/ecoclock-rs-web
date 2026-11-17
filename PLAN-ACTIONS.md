# Plan d'actions — EcoClock-rs Web

Base : `rust-hardware-underclocking-utility4.zip` (17/11/2026, 54 fichiers, 16 121 lignes `src/`).
Organisation en **vagues** : une vague = un ensemble de correctifs sans interaction entre eux, validable en une seule passe de vérification.

**État vérifié à l'instant :** `tsc --noEmit` 0 erreur · `vitest run` **41/41** · `vite build` OK (811,56 kB / 239,72 kB gzip).
Référence d'origine (v4 non modifiée) : 39 tests, 808,45 kB / 239,10 kB.

| Vague | Contenu | Statut | Tests |
|---|---|---|---|
| **1** | Contrat TOML documenté, pertes annoncées, audit cohérent, docstrings | ✅ **livrée** | 41 |
| **2** | `hasEthernet` : suppression de la proposition EEE fantôme | ⏳ prête, patchs ci-dessous | 42 attendus |
| **3** | Verrou de schéma étendu, fidélité Rust | 💤 optionnelle | — |

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

`src/data/profiles.ts`, en-tête de `serializeProfilesToToml` :

```ts
"# %APPDATA%\\EcoClock\\profiles.toml — Compatible 1:1 avec EcoClock-rs (src/domain.rs::ProfileStore)",
"# Écriture atomique (.tmp + sync_all + rename) | Toutes les valeurs sont re-bornées par clamped()",
"# Extensions web volontaires (ignorées par serde côté Rust) : gpu_vram_policy, timer_resolution",
"#   -> préservent prefer_p5 et high_0_5ms, non représentables par les booléens Rust",
```

**Pourquoi ne pas les supprimer.** `GpuVramPolicy` et `TimerResolutionPolicy` ont 3 états chacun ; le `HardwareConfig` Rust n'a qu'un `bool` pour chacun (`gpu_force_p8_idle`, `timer_coalescing`). Ces deux clés sont donc ce qui rend l'export fidèle en web↔web. Les supprimer dégraderait le round-trip sans rien apporter côté Rust, qui les ignore de toute façon.

## 1.2 — La perte inévitable côté Rust est calculée et annoncée

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

# Vague 2 — prête à exécuter

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
| Portable Ryzen 7840HS + RTX 4060 Laptop | `true` si RJ45, sinon `false` |
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

### Vérification

```bash
npx tsc --noEmit    # doit d'abord signaler 4 profils incomplets (preuve de couverture), puis 0
npx vitest run      # 42 attendus
npm run build
```

---

# Vague 3 — optionnelle

Rien n'est requis ici. Deux chantiers sont documentés pour mémoire :

1. **Étendre le verrou de schéma** aux blocs `[autostart]` et aux clés racine (`active_slot`, `show_tooltips`, `adaptive_enabled`). Même technique que 1.4, ~15 lignes. Utile si le schéma Rust bouge encore.
2. **Supprimer la cause des pertes** plutôt que les signaler : côté Rust, remplacer les deux `bool` par des énumérations à 3 variantes (`GpuVramPolicy`, `TimerResolutionPolicy`) avec migration de `profiles.toml`. C'est le vrai correctif de fond ; il rend `getTomlPersistenceWarnings` inutile et doit donc être fait **avant** d'investir davantage côté web.

---

# Invariants à ne pas casser

Neuf propriétés, chacune tenue par un test nommé. Si l'une rougit, c'est la modification qui est fautive, pas le test.

| Invariant | Test garde-fou |
|---|---|
| Rendement PSU strictement croissant (pas de saut à 45/95 W) | « la courbe d'alimentation 80+ Gold est strictement croissante » |
| Aucun watt sur le rail dGPU quand il n'y a qu'un iGPU | « sur un Mini-PC iGPU seul … 0 W, 0 RPM » |
| Latence combinée dans le budget annoncé | « le total de latence combiné … strictement dans le budget » |
| L'optimiseur converge (0 proposition User restante) | « appliquer toutes les propositions User converge » |
| Aucun gain inventé (< 0,25 W rejeté) | « toute proposition … économise réellement ≥ 0,3 W » |
| Fenêtre de confirmation réelle de 2,5 s | « exige une vraie fenêtre temporelle » |
| `.ps1` non injectable, sans NVML sur iGPU | « buildWindowsPowerShellScript génère un script sûr » |
| **Schéma TOML = 24 champs Rust + 2 extensions, exactement** | « verrouille le schéma : [profiles.config] contient exactement … » |
| **Les seules pertes annoncées sont P3/prefer_p5 et P5/0,5 ms** | « getTomlPersistenceWarnings nomme les créneaux … » |

---

# Idées à ne pas appliquer (et pourquoi)

1. **Supprimer `gpu_vram_policy` / `timer_resolution` de l'export.** Non : elles préservent `prefer_p5` et `high_0_5ms` en web↔web. Un booléen Rust ne code que 2 états sur 3.
2. **Revenir aux paliers de rendement PSU (0,835 / 0,885 / 0,905).** Non : non monotone — baisser la charge de 46 à 44,5 W faisait *monter* la consommation murale.
3. **Remettre `nicEeeEnabled` dans la règle User `usb_wifi_idle`.** Non : réglage admin dans une proposition applicable en User ⇒ re-proposition infinie.
4. **Remplacer la fenêtre 2,5 s par un compteur de cycles.** Non : deux re-renders à 50 ms validaient la bascule.
5. **« Corriger » `noppme` (ps0_only → 0).** Non : déjà aligné sur `u32::from(cfg.nvme_apst != NvmeApst::Ps0Only)`, ligne 1240 de `rustProject.ts`.
6. **Additionner les `latencyDeltaMs`.** Non : double comptage CPU/timer, total supérieur au budget réel.
7. **Remplacer `ac == ERROR_SUCCESS && dc == ERROR_SUCCESS.0` par `.is_ok()`.** Non : `PowerWriteDCValueIndex` renvoie un `u32`, `.is_ok()` ne compile pas.
8. **Masquer l'avertissement d'export quand les valeurs sont celles d'usine.** Non : ce serait précisément cacher le cas le plus fréquent (P3/P5), donc le seul que l'utilisateur n'a jamais eu l'occasion de découvrir.

---

# Journal des décisions

| Décision | Raison |
|---|---|
| Helper pur plutôt que logique dans le composant | seul point d'encodage du contrat de perte, testable sans React |
| Avertissement nominatif (P3, P5) | actionnable ; un compteur oblige à chercher le profil fautif |
| Assertion sur l'état **réel** des profils d'usine | un test doit décrire le système, pas l'intention du rédacteur |
| Verrou de schéma par égalité exacte de clés | attrape les deux sens de dérive : champ oublié et clé non reconnue par serde |
| Aucun changement de comportement produit | P3 reste en `prefer_p5`, P5 en `high_0_5ms` : ce sont des choix métier, pas des bugs |

---

# Definition of done

- [x] `npx tsc --noEmit` : 0 erreur
- [x] `npx vitest run` : 41/41
- [x] `npm run build` : succès, 811,56 kB (239,72 kB gzip)
- [x] Aucune occurrence de « 39 tests » dans `src/`
- [ ] Vague 2 : `npx vitest run` → 42/42
- [ ] Export `profiles.toml` puis réimport : les 5 profils et l'autostart reviennent à l'identique
- [ ] Export depuis l'UI : le toast orange liste `P3 : VRAM prefer_p5` et `P5 : timer 0,5 ms`
- [ ] `npm run dev` : l'app démarre, les 6 onglets s'ouvrent, la matrice adaptative affiche 7 lignes

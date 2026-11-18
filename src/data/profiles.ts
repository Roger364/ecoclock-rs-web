import { AutostartConfig, HardwareConfig, Profile, WorkloadMode } from "../types/hardware";
import type { Locale } from "../i18n";

/**
 * Configuration nominale d'origine d'un PC Windows standard avant optimisation
 * (Plan d'alimentation Performances / Équilibré constructeur, 165 Hz, Turbo agressif, ASPM désactivé)
 */
export const STOCK_BASELINE_CONFIG: HardwareConfig = {
  cpuMaxPercent: 100,
  cpuMinPercent: 35,
  cpuFreqCapMhz: 5200,
  cpuTurboMode: "aggressive",
  cpuEpp: 15,
  cpuCoreParkingMinActive: 100,
  cpuDeepCStates: false,
  cpuPl1Watts: 125,
  bgEcoQos: false,

  gpuPowerLimitPct: 100,
  gpuCoreClockCapMhz: 2610,
  gpuVramPolicy: "auto",
  gpuZeroRpmFanStop: false,
  igpuEcoClock: false,

  pcieAspm: "off",
  nvmeApst: "ps0_only",
  nvmeIdleTimeoutMs: 1500,
  sataAlpm: "active",

  displayRefreshHz: 165,
  displayBrightnessPct: 85,
  nicEeeEnabled: false,
  wifiPowerMode: "cam",
  usbSelectiveSuspend: false,
  timerResolution: "high_0_5ms",
};

/**
 * Les 5 profils configurables retenus par EcoClock-rs dans %APPDATA%\EcoClock\profiles.toml
 */
export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 1,
    name: "Éco-Productivité (Pareto)",
    shortTag: "Quotidien",
    description: "Point d'inflexion idéal V/F pour bureau, dev, web et multimédia : -58% de watts, quasi 0 impact ressenti.",
    updatedAt: "2026-03-01T09:00:00Z",
    config: {
      cpuMaxPercent: 92,
      cpuMinPercent: 5,
      cpuFreqCapMhz: 3300,
      cpuTurboMode: "disabled",
      cpuEpp: 72,
      cpuCoreParkingMinActive: 35,
      cpuDeepCStates: true,
      cpuPl1Watts: 45,
      bgEcoQos: true,

      gpuPowerLimitPct: 60,
      gpuCoreClockCapMhz: 1680,
      gpuVramPolicy: "force_p8_idle",
      gpuZeroRpmFanStop: true,
      igpuEcoClock: true,

      pcieAspm: "l1_substates",
      nvmeApst: "ps3_balanced",
      nvmeIdleTimeoutMs: 150,
      sataAlpm: "dipm_slumber",

      displayRefreshHz: 60,
      displayBrightnessPct: 45,
      nicEeeEnabled: true,
      wifiPowerMode: "medium_psp",
      usbSelectiveSuspend: true,
      timerResolution: "coalesced_15_6ms",
    },
  },
  {
    id: 2,
    name: "Silence Absolu (Nuit)",
    shortTag: "Inaudible",
    description: "Froid et silencieux (< 21 dBA, GPU 0 RPM permanent) pour rédaction, lecture, musique et travail nocturne.",
    updatedAt: "2026-03-01T09:00:00Z",
    config: {
      cpuMaxPercent: 68,
      cpuMinPercent: 5,
      cpuFreqCapMhz: 2100,
      cpuTurboMode: "disabled",
      cpuEpp: 88,
      cpuCoreParkingMinActive: 25,
      cpuDeepCStates: true,
      cpuPl1Watts: 28,
      bgEcoQos: true,

      gpuPowerLimitPct: 45,
      gpuCoreClockCapMhz: 1200,
      gpuVramPolicy: "force_p8_idle",
      gpuZeroRpmFanStop: true,
      igpuEcoClock: true,

      pcieAspm: "l1_substates",
      nvmeApst: "ps4_deep",
      nvmeIdleTimeoutMs: 80,
      sataAlpm: "dipm_slumber",

      displayRefreshHz: 60,
      displayBrightnessPct: 32,
      nicEeeEnabled: true,
      wifiPowerMode: "max_psp",
      usbSelectiveSuspend: true,
      timerResolution: "coalesced_15_6ms",
    },
  },
  {
    id: 3,
    name: "Jeu & Création Frais",
    shortTag: "Sweet-Spot",
    description: "Conserve ~92% des FPS en 120 Hz tout en coupant 85 W de surchauffe inutile et en divisant le bruit par 2.",
    updatedAt: "2026-03-01T09:00:00Z",
    config: {
      cpuMaxPercent: 100,
      cpuMinPercent: 5,
      cpuFreqCapMhz: 4200,
      cpuTurboMode: "efficient",
      cpuEpp: 40,
      cpuCoreParkingMinActive: 60,
      cpuDeepCStates: true,
      cpuPl1Watts: 65,
      bgEcoQos: true,

      gpuPowerLimitPct: 72,
      gpuCoreClockCapMhz: 2070,
      gpuVramPolicy: "prefer_p5",
      gpuZeroRpmFanStop: true,
      igpuEcoClock: true,

      pcieAspm: "l1",
      nvmeApst: "ps1_light",
      nvmeIdleTimeoutMs: 400,
      sataAlpm: "hipm",

      displayRefreshHz: 120,
      displayBrightnessPct: 60,
      nicEeeEnabled: true,
      wifiPowerMode: "cam",
      usbSelectiveSuspend: true,
      timerResolution: "standard_1ms",
    },
  },
  {
    id: 4,
    name: "Veille Active / Serveur",
    shortTag: "Ultra-Bas",
    description: "Consommation plancher pour téléchargement, sauvegarde cloud, serveur local ou PC laissé allumé.",
    updatedAt: "2026-03-01T09:00:00Z",
    config: {
      cpuMaxPercent: 42,
      cpuMinPercent: 5,
      cpuFreqCapMhz: 1200,
      cpuTurboMode: "disabled",
      cpuEpp: 100,
      cpuCoreParkingMinActive: 12,
      cpuDeepCStates: true,
      cpuPl1Watts: 18,
      bgEcoQos: true,

      gpuPowerLimitPct: 40,
      gpuCoreClockCapMhz: 930,
      gpuVramPolicy: "force_p8_idle",
      gpuZeroRpmFanStop: true,
      igpuEcoClock: true,

      pcieAspm: "l1_substates",
      nvmeApst: "ps4_deep",
      nvmeIdleTimeoutMs: 50,
      sataAlpm: "dipm_slumber",

      displayRefreshHz: 60,
      displayBrightnessPct: 20,
      nicEeeEnabled: true,
      wifiPowerMode: "max_psp",
      usbSelectiveSuspend: true,
      timerResolution: "coalesced_15_6ms",
    },
  },
  {
    id: 5,
    name: "Nominal Windows (Stock)",
    shortTag: "Référence",
    description: "État d'origine non bridé (100% fréquences, 165 Hz, Turbo agressif) — sert de référence Avant ou de secours.",
    updatedAt: "2026-03-01T09:00:00Z",
    config: { ...STOCK_BASELINE_CONFIG },
  },
];

export const DEFAULT_AUTOSTART: AutostartConfig = {
  enabled: true,
  bootProfileId: 1,
  method: "hkcu_registry",
  startMinimizedToTray: true,
  safeBootDelaySec: 15,
  restoreOnShutdown: true,
};

export const WORKLOAD_META: Record<
  WorkloadMode,
  {
    label: string;
    shortLabel: string;
    cpuLoad: number;
    gpuLoad: number;
    ioRate: number;
    description: string;
    labelEn: string;
    shortLabelEn: string;
    descriptionEn: string;
  }
> = {
  idle: {
    label: "Repos / Bureau calme",
    shortLabel: "Repos",
    cpuLoad: 0.06,
    gpuLoad: 0.03,
    ioRate: 0.05,
    description: "Bureau Windows 11, éditeur de texte, lecture PDF, messagerie en fond (6% CPU, 3% GPU).",
    labelEn: "Idle / Quiet desktop",
    shortLabelEn: "Idle",
    descriptionEn: "Windows 11 desktop, text editor, PDF reading, background messaging (6% CPU, 3% GPU).",
  },
  office: {
    label: "Productivité / Web / Dev",
    shortLabel: "Bureau & Dev",
    cpuLoad: 0.28,
    gpuLoad: 0.14,
    ioRate: 0.25,
    description: "Navigateur 20 onglets, vidéo 4K, IDE VS Code, appels visio (28% CPU, 14% GPU).",
    labelEn: "Productivity / Web / Dev",
    shortLabelEn: "Office & Dev",
    descriptionEn: "20-tab browser, 4K video, VS Code IDE, video calls (28% CPU, 14% GPU).",
  },
  gaming: {
    label: "Charge Mixte / Jeu 3D",
    shortLabel: "Jeu / 3D",
    cpuLoad: 0.56,
    gpuLoad: 0.86,
    ioRate: 0.45,
    description: "Jeu 3D 1440p, aperçu Blender/DaVinci Resolve ou inférence IA locale (56% CPU, 86% GPU).",
    labelEn: "Mixed load / 3D gaming",
    shortLabelEn: "Gaming / 3D",
    descriptionEn: "1440p 3D game, Blender/DaVinci Resolve preview or local AI inference (56% CPU, 86% GPU).",
  },
  heavy: {
    label: "Pleine Charge (Rendu/Build)",
    shortLabel: "Stress 100%",
    cpuLoad: 0.96,
    gpuLoad: 0.95,
    ioRate: 0.85,
    description: "Compilation Rust multi-cœurs + encodage GPU / rendu lourd simultané (96% CPU, 95% GPU).",
    labelEn: "Full load (Render/Build)",
    shortLabelEn: "100% stress",
    descriptionEn: "Multi-core Rust compilation plus GPU encoding or heavy rendering at the same time (96% CPU, 95% GPU).",
  },
};

/** Noms d'usine en anglais, utilisés seulement si le profil n'a pas été renommé. */
const PROFILE_EN: Record<number, { name: string; description: string }> = {
  1: {
    name: "Eco Productivity (Pareto)",
    description:
      "Ideal V/F inflection point for desktop, dev, web and media: -58% watts with almost no perceived impact.",
  },
  2: {
    name: "Absolute Silence (Night)",
    description:
      "Cool and quiet (< 21 dBA, GPU 0 RPM permanently) for writing, reading, music and night work.",
  },
  3: {
    name: "Cool Gaming & Creation",
    description:
      "Keeps ~92% of FPS at 120 Hz while cutting 85 W of useless heat and halving noise.",
  },
  4: {
    name: "Active Standby / Server",
    description:
      "Lowest power draw for downloads, cloud backup, a local server or an always-on PC.",
  },
  5: {
    name: "Windows Nominal (Stock)",
    description:
      "Unrestricted original state (100% clocks, 165 Hz, aggressive Turbo) — used as the Before reference or fallback.",
  },
};

/** Un profil renommé par l'utilisateur garde son nom dans les deux langues. */
export function profileDisplayName(
  profile: Pick<Profile, "id" | "name">,
  locale: Locale
): string {
  if (locale === "fr") return profile.name;
  const isDefault = DEFAULT_PROFILES.some((p) => p.id === profile.id && p.name === profile.name);
  return isDefault ? (PROFILE_EN[profile.id]?.name ?? profile.name) : profile.name;
}

export function profileDisplayDescription(
  profile: Pick<Profile, "id" | "name" | "description">,
  locale: Locale
): string {
  if (locale === "fr") return profile.description;
  const isDefault = DEFAULT_PROFILES.some((p) => p.id === profile.id && p.name === profile.name);
  return isDefault ? (PROFILE_EN[profile.id]?.description ?? profile.description) : profile.description;
}

/** Échappe strictement une chaîne basique TOML (RFC / spec TOML v1.0) : \, ", \n, \r, \t et contrôles. */
export function escapeTomlString(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u001F\u007F]/g, "");
}

function unescapeTomlString(input: string): string {
  return input.replace(/\\(["\\nrt])/g, (_m, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "r") return "\r";
    if (ch === "t") return "\t";
    return ch;
  });
}

export interface TomlExportOptions {
  activeSlot?: number;
  showTooltips?: boolean;
  adaptiveEnabled?: boolean;
}

const PCIE_TO_RUST: Record<HardwareConfig["pcieAspm"], string> = {
  off: "off",
  l0s: "moderate_l0s",
  l1: "max_power_savings_l1",
  l1_substates: "l1_substates",
};

const PCIE_FROM_RUST: Record<string, HardwareConfig["pcieAspm"]> = {
  off: "off",
  l0s: "l0s",
  moderate_l0s: "l0s",
  l1: "l1",
  max_power_savings_l1: "l1",
  l1_substates: "l1_substates",
};

const WIFI_TO_RUST: Record<HardwareConfig["wifiPowerMode"], string> = {
  cam: "cam_max_perf",
  medium_psp: "medium_psp",
  max_psp: "max_psp",
};

const WIFI_FROM_RUST: Record<string, HardwareConfig["wifiPowerMode"]> = {
  cam: "cam",
  cam_max_perf: "cam",
  medium_psp: "medium_psp",
  max_psp: "max_psp",
};

const GPU_VRAM_POLICIES = ["auto", "prefer_p5", "force_p8_idle"] as const;
const TIMER_RESOLUTIONS = ["standard_1ms", "high_0_5ms", "coalesced_15_6ms"] as const;

/** Valide une valeur lue dans un TOML : une chaîne inconnue ne devient jamais un cast aveugle. */
function asVramPolicy(value: unknown): HardwareConfig["gpuVramPolicy"] | undefined {
  return typeof value === "string" && (GPU_VRAM_POLICIES as readonly string[]).includes(value)
    ? (value as HardwareConfig["gpuVramPolicy"])
    : undefined;
}

function asTimerResolution(value: unknown): HardwareConfig["timerResolution"] | undefined {
  return typeof value === "string" && (TIMER_RESOLUTIONS as readonly string[]).includes(value)
    ? (value as HardwareConfig["timerResolution"])
    : undefined;
}

/**
 * Sérialise les 5 profils et l'autostart dans le schéma TOML EXACT attendu par
 * `toml::from_str::<ProfileStore>` dans `src/domain.rs` (`%APPDATA%\\EcoClock\\profiles.toml`).
 */
export function serializeProfilesToToml(
  profiles: Profile[],
  autostart: AutostartConfig,
  opts: TomlExportOptions = {}
): string {
  const activeSlot = Math.min(5, Math.max(1, Math.round(opts.activeSlot ?? 1)));
  const showTooltips = opts.showTooltips ?? true;
  const adaptiveEnabled = opts.adaptiveEnabled ?? false;
  const rustMethod =
    autostart.method === "task_scheduler_admin" ? "task_scheduler_admin" : "hkcu_registry_run";

  const lines: string[] = [
    "# %APPDATA%\\EcoClock\\profiles.toml — Compatible 1:1 avec EcoClock-rs (src/domain.rs::ProfileStore)",
    "# Écriture atomique (.tmp + sync_all + rename) | Toutes les valeurs sont re-bornées par clamped()",
    "",
    `active_slot = ${activeSlot}`,
    `show_tooltips = ${showTooltips}`,
    `adaptive_enabled = ${adaptiveEnabled}`,
    "",
    "[autostart]",
    `enabled = ${autostart.enabled}`,
    `boot_profile_slot = ${autostart.bootProfileId}`,
    `method = "${rustMethod}"`,
    `start_minimized = ${autostart.startMinimizedToTray}`,
    `safe_boot_delay_sec = ${autostart.safeBootDelaySec}`,
    `restore_on_shutdown = ${autostart.restoreOnShutdown}`,
    "",
  ];

  for (const p of profiles) {
    const c = p.config;
    lines.push(
      "[[profiles]]",
      `slot = ${p.id}`,
      `name = "${escapeTomlString(p.name)}"`,
      `description = "${escapeTomlString(p.description)}"`,
      "",
      "[profiles.config]",
      `cpu_max_percent = ${c.cpuMaxPercent}`,
      `cpu_min_percent = ${c.cpuMinPercent}`,
      `cpu_freq_cap_mhz = ${c.cpuFreqCapMhz}`,
      `cpu_turbo = "${c.cpuTurboMode}"`,
      `cpu_epp_percent = ${c.cpuEpp}`,
      `cpu_min_active_cores = ${c.cpuCoreParkingMinActive}`,
      `cpu_deep_cstates = ${c.cpuDeepCStates}`,
      `cpu_pl1_watts = ${c.cpuPl1Watts}`,
      `bg_eco_qos = ${c.bgEcoQos}`,
      `gpu_power_limit_pct = ${c.gpuPowerLimitPct}`,
      `gpu_clock_cap_mhz = ${c.gpuCoreClockCapMhz}`,
      `gpu_vram_policy = "${c.gpuVramPolicy}"`,
      `gpu_zero_rpm = ${c.gpuZeroRpmFanStop}`,
      `igpu_eco_mode = ${c.igpuEcoClock}`,
      `pcie_aspm = "${PCIE_TO_RUST[c.pcieAspm]}"`,
      `nvme_apst = "${c.nvmeApst}"`,
      `nvme_idle_timeout_ms = ${c.nvmeIdleTimeoutMs}`,
      `sata_alpm = "${c.sataAlpm}"`,
      `display_refresh_hz = ${c.displayRefreshHz}`,
      `display_brightness_pct = ${c.displayBrightnessPct}`,
      `nic_eee_802_3az = ${c.nicEeeEnabled}`,
      `wifi_power = "${WIFI_TO_RUST[c.wifiPowerMode]}"`,
      `usb_selective_suspend = ${c.usbSelectiveSuspend}`,
      `timer_resolution = "${c.timerResolution}"`,
      ""
    );
  }

  return lines.join("\n");
}

export interface ParsedTomlBundle {
  activeSlot: number;
  showTooltips?: boolean;
  adaptiveEnabled?: boolean;
  autostart: Partial<AutostartConfig>;
  profiles: Partial<Profile>[];
}

/**
 * Parse un fichier `profiles.toml` (généré par l'app web ou par `ecoclock.exe`)
 * vers une structure brute destinée à être validée par `sanitizeProfiles` & `sanitizeAutostart`.
 * Accepte aussi les fichiers antérieurs à la vague 4, où `gpu_vram_policy` / `timer_resolution`
 * étaient absents ou doublés par les booléens `gpu_force_p8_idle` / `timer_coalescing`.
 */
export function parseProfilesToml(raw: string): ParsedTomlBundle | null {
  if (typeof raw !== "string" || raw.length > 512_000) return null;

  let section: "root" | "autostart" | "profile" | "profile.config" = "root";
  let activeSlot = 1;
  let showTooltips: boolean | undefined;
  let adaptiveEnabled: boolean | undefined;
  const autostart: Partial<AutostartConfig> = {};
  const rawProfiles: {
    slot?: number;
    name?: string;
    description?: string;
    cfg: Record<string, unknown>;
  }[] = [];

  const parseScalar = (v: string): string | number | boolean | null => {
    const s = v.trim();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      return unescapeTomlString(s.slice(1, -1));
    }
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : null;
    }
    return null;
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed === "[[profiles]]") {
      rawProfiles.push({ cfg: {} });
      section = "profile";
      continue;
    }
    if (trimmed === "[profiles.config]") {
      if (rawProfiles.length === 0) return null;
      section = "profile.config";
      continue;
    }
    if (trimmed === "[autostart]") {
      section = "autostart";
      continue;
    }
    if (trimmed.startsWith("[")) {
      section = "root";
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    // Retire un éventuel commentaire de fin de ligne hors guillemets
    let valPart = trimmed.slice(eq + 1).trim();
    if (!valPart.startsWith('"')) {
      const hash = valPart.indexOf("#");
      if (hash >= 0) valPart = valPart.slice(0, hash).trim();
    }
    const val = parseScalar(valPart);
    if (val === null) continue;

    if (section === "root") {
      if (key === "active_slot" && typeof val === "number") activeSlot = val;
      else if (key === "show_tooltips" && typeof val === "boolean") showTooltips = val;
      else if (key === "adaptive_enabled" && typeof val === "boolean") adaptiveEnabled = val;
    } else if (section === "autostart") {
      if (key === "enabled" && typeof val === "boolean") autostart.enabled = val;
      else if (key === "boot_profile_slot" && typeof val === "number") {
        autostart.bootProfileId = val as AutostartConfig["bootProfileId"];
      } else if (key === "method" && typeof val === "string") {
        autostart.method = val === "task_scheduler_admin" ? "task_scheduler_admin" : "hkcu_registry";
      } else if ((key === "start_minimized" || key === "start_minimized_to_tray") && typeof val === "boolean") {
        autostart.startMinimizedToTray = val;
      } else if (key === "safe_boot_delay_sec" && typeof val === "number") {
        autostart.safeBootDelaySec = val;
      } else if (key === "restore_on_shutdown" && typeof val === "boolean") {
        autostart.restoreOnShutdown = val;
      }
    } else if (section === "profile") {
      const cur = rawProfiles[rawProfiles.length - 1];
      if (!cur) continue;
      if (key === "slot" && typeof val === "number") cur.slot = val;
      else if (key === "name" && typeof val === "string") cur.name = val;
      else if (key === "description" && typeof val === "string") cur.description = val;
    } else if (section === "profile.config") {
      const cur = rawProfiles[rawProfiles.length - 1];
      if (cur) cur.cfg[key] = val;
    }
  }

  if (rawProfiles.length !== DEFAULT_PROFILES.length) return null;

  const profiles: Partial<Profile>[] = rawProfiles.map((rp, idx) => {
    const def = DEFAULT_PROFILES[idx];
    const c = rp.cfg;
    // Repli pour les fichiers antérieurs à la vague 4 : un booléen ne codait que 2 des 3 états.
    const legacyVram =
      c.gpu_force_p8_idle === true ? "force_p8_idle" : c.gpu_force_p8_idle === false ? "auto" : undefined;
    const legacyTimer =
      c.timer_coalescing === true ? "coalesced_15_6ms" : c.timer_coalescing === false ? "standard_1ms" : undefined;
    const mappedCfg: Partial<HardwareConfig> = {
      cpuMaxPercent: c.cpu_max_percent as number,
      cpuMinPercent: c.cpu_min_percent as number,
      cpuFreqCapMhz: c.cpu_freq_cap_mhz as number,
      cpuTurboMode: c.cpu_turbo as HardwareConfig["cpuTurboMode"],
      cpuEpp: c.cpu_epp_percent as number,
      cpuCoreParkingMinActive: c.cpu_min_active_cores as number,
      cpuDeepCStates: c.cpu_deep_cstates as boolean,
      cpuPl1Watts: c.cpu_pl1_watts as number,
      bgEcoQos: c.bg_eco_qos as boolean,
      gpuPowerLimitPct: c.gpu_power_limit_pct as number,
      gpuCoreClockCapMhz: c.gpu_clock_cap_mhz as number,
      gpuVramPolicy: asVramPolicy(c.gpu_vram_policy) ?? legacyVram ?? def.config.gpuVramPolicy,
      gpuZeroRpmFanStop: c.gpu_zero_rpm as boolean,
      igpuEcoClock: c.igpu_eco_mode as boolean,
      pcieAspm:
        typeof c.pcie_aspm === "string" ? PCIE_FROM_RUST[c.pcie_aspm] ?? def.config.pcieAspm : def.config.pcieAspm,
      nvmeApst: c.nvme_apst as HardwareConfig["nvmeApst"],
      nvmeIdleTimeoutMs: c.nvme_idle_timeout_ms as number,
      sataAlpm: c.sata_alpm as HardwareConfig["sataAlpm"],
      displayRefreshHz: c.display_refresh_hz as HardwareConfig["displayRefreshHz"],
      displayBrightnessPct: c.display_brightness_pct as number,
      nicEeeEnabled: c.nic_eee_802_3az as boolean,
      wifiPowerMode:
        typeof c.wifi_power === "string"
          ? WIFI_FROM_RUST[c.wifi_power] ?? def.config.wifiPowerMode
          : def.config.wifiPowerMode,
      usbSelectiveSuspend: c.usb_selective_suspend as boolean,
      timerResolution: asTimerResolution(c.timer_resolution) ?? legacyTimer ?? def.config.timerResolution,
    };

    return {
      id: (rp.slot ?? def.id) as Profile["id"],
      name: rp.name ?? def.name,
      description: rp.description ?? def.description,
      shortTag: def.shortTag,
      updatedAt: new Date().toISOString(),
      config: mappedCfg as HardwareConfig,
    };
  });

  return { activeSlot, showTooltips, adaptiveEnabled, autostart, profiles };
}

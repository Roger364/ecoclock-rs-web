import { DEFAULT_AUTOSTART, DEFAULT_PROFILES } from "../data/profiles";
import { AutostartConfig, DisplayRefreshHz, HardwareConfig, Profile, ProfileSlotId } from "../types/hardware";

/** Valeurs autorisées pour chaque champ énuméré chaîne. */
export const ENUM_OPTIONS: Record<string, readonly string[]> = {
  cpuTurboMode: ["aggressive", "efficient", "disabled"],
  pcieAspm: ["off", "l0s", "l1", "l1_substates"],
  nvmeApst: ["ps0_only", "ps1_light", "ps3_balanced", "ps4_deep"],
  sataAlpm: ["active", "hipm", "dipm_slumber"],
  gpuVramPolicy: ["auto", "prefer_p5", "force_p8_idle"],
  wifiPowerMode: ["cam", "medium_psp", "max_psp"],
  timerResolution: ["high_0_5ms", "standard_1ms", "coalesced_15_6ms"],
};

const VALID_REFRESH_HZ: readonly DisplayRefreshHz[] = [60, 75, 120, 165];
const VALID_SLOTS: readonly ProfileSlotId[] = [1, 2, 3, 4, 5];

/** Vérifie qu'une valeur possède le même type primitif ET rejette NaN / ±Infinity pour les nombres. */
function isValidFieldValue(key: string, value: unknown, fallback: unknown): boolean {
  if (typeof fallback === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (key === "displayRefreshHz") {
      return VALID_REFRESH_HZ.includes(value as DisplayRefreshHz);
    }
    return true;
  }
  if (typeof fallback === "boolean") {
    return typeof value === "boolean";
  }
  if (typeof fallback === "string") {
    if (typeof value !== "string") return false;
    const allowed = ENUM_OPTIONS[key];
    return !allowed || allowed.includes(value);
  }
  return false;
}

/**
 * Valide strictement les 5 profils lus depuis localStorage ou un fichier importé.
 * Rejette NaN, ±Infinity, types invalides, taux Hz inconnus et énumérations hors domaine :
 * toute valeur invalide retombe proprement sur la valeur d'usine du slot.
 */
export function sanitizeProfiles(raw: unknown): Profile[] {
  const defaults = DEFAULT_PROFILES.map((p) => ({ ...p, config: { ...p.config } }));
  if (!Array.isArray(raw) || raw.length !== defaults.length) return defaults;

  return defaults.map((def, idx) => {
    const item = raw[idx] as Partial<Profile> | undefined;
    if (!item || typeof item !== "object" || item.id !== def.id) return def;

    const src =
      item.config && typeof item.config === "object"
        ? (item.config as unknown as Record<string, unknown>)
        : {};
    const defConfig = def.config as unknown as Record<string, unknown>;
    const config: Record<string, unknown> = { ...defConfig };

    for (const key of Object.keys(defConfig)) {
      const value = src[key];
      if (isValidFieldValue(key, value, defConfig[key])) {
        config[key] = value;
      }
    }

    const cleanName =
      typeof item.name === "string" && item.name.trim().length > 0
        ? item.name.trim().slice(0, 32)
        : def.name;
    const cleanTag =
      typeof item.shortTag === "string" && item.shortTag.trim().length > 0
        ? item.shortTag.trim().slice(0, 16)
        : def.shortTag;

    return {
      ...def,
      name: cleanName,
      shortTag: cleanTag,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt.slice(0, 40) : def.updatedAt,
      config: config as unknown as HardwareConfig,
    };
  });
}

/** Valide strictement la configuration de démarrage automatique Windows. */
export function sanitizeAutostart(raw: unknown): AutostartConfig {
  const base: AutostartConfig = { ...DEFAULT_AUTOSTART };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<AutostartConfig>;

  const delay =
    typeof r.safeBootDelaySec === "number" && Number.isFinite(r.safeBootDelaySec)
      ? Math.min(120, Math.max(5, Math.round(r.safeBootDelaySec)))
      : base.safeBootDelaySec;

  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled,
    bootProfileId: VALID_SLOTS.includes(r.bootProfileId as ProfileSlotId)
      ? (r.bootProfileId as ProfileSlotId)
      : base.bootProfileId,
    method: r.method === "task_scheduler_admin" ? "task_scheduler_admin" : "hkcu_registry",
    startMinimizedToTray:
      typeof r.startMinimizedToTray === "boolean" ? r.startMinimizedToTray : base.startMinimizedToTray,
    safeBootDelaySec: delay,
    restoreOnShutdown:
      typeof r.restoreOnShutdown === "boolean" ? r.restoreOnShutdown : base.restoreOnShutdown,
  };
}

/** Valide un numéro de slot 1..5. */
export function sanitizeSlot(raw: unknown): ProfileSlotId {
  const n = typeof raw === "number" ? raw : Number(raw);
  return VALID_SLOTS.includes(n as ProfileSlotId) ? (n as ProfileSlotId) : 1;
}

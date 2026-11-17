import { useSyncExternalStore } from "react";
import {
  AdaptivePreset,
  AdaptiveRule,
  AdaptiveSettings,
  AppSettings,
  RuleCondition,
} from "../types/adaptive";
import { ProfileSlotId, WorkloadMode } from "../types/hardware";

const STORAGE_KEY = "ecoclock_rs_settings_v2";
const VALID_WORKLOADS: readonly WorkloadMode[] = ["idle", "office", "gaming", "heavy"];
const VALID_SLOTS: readonly ProfileSlotId[] = [1, 2, 3, 4, 5];

/**
 * Règles par défaut :
 * 1. Sécurité thermique prioritaire (refroidir si le CPU dépasse 85 °C, hystérésis 5 °C).
 * 2. Protection des charges lourdes (rendu / compilation : ne jamais brider en temps normal).
 * 3. Jeu 3D : sweet-spot 120 Hz.
 * 4. Batterie : profil Éco-Productivité.
 * 5. Inactivité ≥ 2 min : Silence Absolu.
 * 6. Nuit (22 h → 7 h) : Silence Absolu en repos/bureau.
 * 7. Sinon : profil quotidien Éco-Productivité.
 */
export const DEFAULT_RULES: AdaptiveRule[] = [
  {
    id: "protect-heavy",
    enabled: true,
    label: "Rendu / compilation : ne jamais brider",
    condition: { kind: "workload", workload: "heavy" },
    target: 5,
    protect: true,
  },
  {
    id: "thermal",
    enabled: true,
    label: "Sécurité thermique CPU ≥ 85 °C : refroidir",
    condition: { kind: "thermal", tempC: 85 },
    target: 2,
    protect: false,
  },
  {
    id: "gaming",
    enabled: true,
    label: "Jeu 3D : performance fraîche 120 Hz",
    condition: { kind: "workload", workload: "gaming" },
    target: 3,
    protect: false,
  },
  {
    id: "battery",
    enabled: true,
    label: "Sur batterie : sobriété Pareto",
    condition: { kind: "battery" },
    target: 1,
    protect: false,
  },
  {
    id: "idle",
    enabled: true,
    label: "Inactivité ≥ 2 min : silence absolu",
    condition: { kind: "idle", seconds: 120 },
    target: 2,
    protect: false,
  },
  {
    id: "night-quiet",
    enabled: false,
    label: "Heures nocturnes (22 h → 7 h) : silence",
    condition: { kind: "schedule", from: 22, to: 7 },
    target: 2,
    protect: false,
  },
  {
    id: "active",
    enabled: true,
    label: "Activité courante : profil quotidien",
    condition: { kind: "always" },
    target: 1,
    protect: false,
  },
];

/** Préréglages intelligents pour configurer la politique adaptative en un clic. */
export const ADAPTIVE_PRESETS: AdaptivePreset[] = [
  {
    id: "balanced-daily",
    name: "Quotidien & Portable",
    description: "Protège les builds, passe en Sweet-Spot en jeu, et en Silence après 2 min d'inactivité.",
    patch: {
      budgetMs: 4,
      minSavingW: 3,
      dwellSec: 60,
      manualSnoozeMin: 15,
      rules: DEFAULT_RULES,
    },
  },
  {
    id: "quiet-studio",
    name: "Silence & Nuit Prioritaires",
    description: "Inactivité courte (60 s), plage nocturne 22 h → 7 h active et seuil thermique à 75 °C.",
    patch: {
      budgetMs: 8,
      minSavingW: 2,
      dwellSec: 30,
      manualSnoozeMin: 10,
      rules: [
        {
          id: "protect-heavy",
          enabled: true,
          label: "Rendu / compilation : garder P3 frais",
          condition: { kind: "workload", workload: "heavy" },
          target: 3,
          protect: true,
        },
        {
          id: "thermal",
          enabled: true,
          label: "CPU ≥ 75 °C : retour au calme",
          condition: { kind: "thermal", tempC: 75 },
          target: 2,
          protect: false,
        },
        {
          id: "idle-fast",
          enabled: true,
          label: "Inactivité ≥ 60 s : veille ultra-basse",
          condition: { kind: "idle", seconds: 60 },
          target: 4,
          protect: false,
        },
        {
          id: "night-quiet",
          enabled: true,
          label: "Nuit (22 h → 7 h) : silence absolu",
          condition: { kind: "schedule", from: 22, to: 7 },
          target: 2,
          protect: false,
        },
        {
          id: "active",
          enabled: true,
          label: "Journée active : sobriété Pareto",
          condition: { kind: "always" },
          target: 1,
          protect: false,
        },
      ],
    },
  },
  {
    id: "creator-latency",
    name: "Dev / Jeu Zéro Latence",
    description: "Ne bride jamais en activité (budget strict 1 ms) ; économise uniquement sur batterie ou pause ≥ 5 min.",
    patch: {
      budgetMs: 1,
      minSavingW: 8,
      dwellSec: 120,
      manualSnoozeMin: 30,
      rules: [
        {
          id: "protect-heavy",
          enabled: true,
          label: "Compilation / rendu : plein régime",
          condition: { kind: "workload", workload: "heavy" },
          target: 5,
          protect: true,
        },
        {
          id: "protect-gaming",
          enabled: true,
          label: "Jeu 3D : 120 Hz sans bridage",
          condition: { kind: "workload", workload: "gaming" },
          target: 3,
          protect: true,
        },
        {
          id: "battery",
          enabled: true,
          label: "Sur batterie : Éco-Productivité",
          condition: { kind: "battery" },
          target: 1,
          protect: false,
        },
        {
          id: "idle-long",
          enabled: true,
          label: "Pause ≥ 5 min : Éco-Productivité",
          condition: { kind: "idle", seconds: 300 },
          target: 1,
          protect: false,
        },
      ],
    },
  },
  {
    id: "power-cap-110w",
    name: "Budget Électrique / Solaire 110 W",
    description: "Écrête automatiquement vers P1 dès que le PC dépasse 110 W, et vers P4 en inactivité.",
    patch: {
      budgetMs: 6,
      minSavingW: 5,
      dwellSec: 30,
      manualSnoozeMin: 15,
      rules: [
        {
          id: "thermal",
          enabled: true,
          label: "CPU ≥ 80 °C : refroidir",
          condition: { kind: "thermal", tempC: 80 },
          target: 2,
          protect: false,
        },
        {
          id: "cap-110w",
          enabled: true,
          label: "Puissance ≥ 110 W : écrêter en Pareto",
          condition: { kind: "power_above", watts: 110 },
          target: 1,
          protect: false,
        },
        {
          id: "idle",
          enabled: true,
          label: "Inactivité ≥ 90 s : veille active",
          condition: { kind: "idle", seconds: 90 },
          target: 4,
          protect: false,
        },
        {
          id: "active",
          enabled: true,
          label: "Usage normal : Pareto quotidien",
          condition: { kind: "always" },
          target: 1,
          protect: false,
        },
      ],
    },
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  tooltips: true,
  adaptive: {
    enabled: false, // opt-in : rien n'est basculé sans action explicite de l'utilisateur
    mode: "suggest",
    budgetMs: 4,
    minSavingW: 3,
    dwellSec: 60,
    manualSnoozeMin: 15,
    batterySimulated: false,
    onBatterySim: false,
    rules: DEFAULT_RULES,
  },
};

export function cloneRules(rules: readonly AdaptiveRule[]): AdaptiveRule[] {
  return rules.map((r) => ({ ...r, condition: { ...r.condition } }));
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const int = (v: unknown, fallback: number, min: number, max: number): number =>
  Math.round(num(v, fallback, min, max));

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Valide et borne strictement chaque variante discriminée de RuleCondition. */
export function sanitizeCondition(raw: unknown): RuleCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.kind) {
    case "always":
      return { kind: "always" };
    case "battery":
      return { kind: "battery" };
    case "idle":
      if (typeof c.seconds !== "number" || !Number.isFinite(c.seconds)) return null;
      return { kind: "idle", seconds: int(c.seconds, 120, 10, 7200) };
    case "workload":
      if (typeof c.workload !== "string" || !VALID_WORKLOADS.includes(c.workload as WorkloadMode)) {
        return null;
      }
      return { kind: "workload", workload: c.workload as WorkloadMode };
    case "schedule":
      if (
        typeof c.from !== "number" ||
        !Number.isFinite(c.from) ||
        typeof c.to !== "number" ||
        !Number.isFinite(c.to)
      ) {
        return null;
      }
      return {
        kind: "schedule",
        from: int(c.from, 22, 0, 23),
        to: int(c.to, 7, 0, 23),
      };
    case "thermal":
      if (typeof c.tempC !== "number" || !Number.isFinite(c.tempC)) return null;
      return { kind: "thermal", tempC: int(c.tempC, 85, 50, 100) };
    case "power_above":
      if (typeof c.watts !== "number" || !Number.isFinite(c.watts)) return null;
      return { kind: "power_above", watts: int(c.watts, 110, 25, 450) };
    default:
      return null;
  }
}

export function sanitizeRule(raw: unknown): AdaptiveRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    !r.id.trim() ||
    typeof r.label !== "string" ||
    typeof r.enabled !== "boolean" ||
    typeof r.protect !== "boolean" ||
    !VALID_SLOTS.includes(r.target as ProfileSlotId)
  ) {
    return null;
  }
  const condition = sanitizeCondition(r.condition);
  if (!condition) return null;
  return {
    id: r.id.slice(0, 48),
    enabled: r.enabled,
    label: r.label.slice(0, 64),
    condition,
    target: r.target as ProfileSlotId,
    protect: r.protect,
  };
}

/** Valide toute donnée lue depuis localStorage ou importée : toute entrée corrompue est assainie. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const base: AppSettings = {
    tooltips: DEFAULT_SETTINGS.tooltips,
    adaptive: {
      ...DEFAULT_SETTINGS.adaptive,
      rules: cloneRules(DEFAULT_RULES),
    },
  };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<AppSettings>;
  const a = (r.adaptive && typeof r.adaptive === "object" ? r.adaptive : {}) as Partial<AdaptiveSettings>;

  const rules = Array.isArray(a.rules)
    ? a.rules.map(sanitizeRule).filter((item): item is AdaptiveRule => item !== null)
    : base.adaptive.rules;

  return {
    tooltips: bool(r.tooltips, base.tooltips),
    adaptive: {
      enabled: bool(a.enabled, base.adaptive.enabled),
      mode: a.mode === "auto" ? "auto" : "suggest",
      budgetMs: num(a.budgetMs, base.adaptive.budgetMs, 0.2, 15),
      minSavingW: num(a.minSavingW, base.adaptive.minSavingW, 0, 80),
      dwellSec: int(a.dwellSec, base.adaptive.dwellSec, 10, 900),
      manualSnoozeMin: int(a.manualSnoozeMin, base.adaptive.manualSnoozeMin, 0, 120),
      batterySimulated: bool(a.batterySimulated, base.adaptive.batterySimulated),
      onBatterySim: bool(a.onBatterySim, base.adaptive.onBatterySim),
      rules,
    },
  };
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : sanitizeSettings(null);
  } catch {
    return sanitizeSettings(null);
  }
}

let state: AppSettings = load();
const listeners = new Set<() => void>();

export function getSettings(): AppSettings {
  return state;
}

export function updateSettings(updater: (current: AppSettings) => AppSettings): void {
  state = sanitizeSettings(updater(state));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // stockage indisponible : les réglages restent valables pour la session
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook React : abonnement aux réglages globaux (infobulles, mode intelligent). */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** Hook léger pour les composants qui ne dépendent que du toggle des infobulles. */
export function useTooltipsEnabled(): boolean {
  return useSettings().tooltips;
}

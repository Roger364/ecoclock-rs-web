import { ProfileSlotId, WorkloadMode } from "./hardware";

/**
 * Condition d'une règle du mode intelligent.
 * Évaluée dans l'ordre : la première règle active qui correspond gagne.
 */
export type RuleCondition =
  | { kind: "always" }
  | { kind: "battery" }
  | { kind: "idle"; seconds: number }
  | { kind: "workload"; workload: WorkloadMode }
  /** Plage horaire locale (0–23). from > to = plage nocturne qui traverse minuit. */
  | { kind: "schedule"; from: number; to: number }
  /** Alerte thermique (CPU ≥ seuil, avec hystérésis de relâchement de 5 °C). */
  | { kind: "thermal"; tempC: number }
  /** Plafond électrique : se déclenche quand la puissance système dépasse watts W (hors charge protégée). */
  | { kind: "power_above"; watts: number };

export interface AdaptiveRule {
  id: string;
  enabled: boolean;
  label: string;
  condition: RuleCondition;
  target: ProfileSlotId;
  /** Protection : interdit tout bridage tant que la règle correspond (ex. rendu, compilation, jeu compétitif). */
  protect: boolean;
}

export type AdaptiveMode = "auto" | "suggest";

export interface AdaptiveSettings {
  enabled: boolean;
  mode: AdaptiveMode;
  /** Budget maximal de latence ajoutée (ms) accepté pour une bascule d'économie (hors urgence thermique). */
  budgetMs: number;
  /** Gain électrique minimal (W) pour qu'une bascule d'économie soit jugée utile. */
  minSavingW: number;
  /** Délai minimal entre deux bascules automatiques de sobriété (s). */
  dwellSec: number;
  /** Durée de pause automatique après un choix manuel de profil (min ; 0 = désactivé). */
  manualSnoozeMin: number;
  /** Simulation de batterie (utile si l'API Battery n'est pas disponible). */
  batterySimulated: boolean;
  onBatterySim: boolean;
  rules: AdaptiveRule[];
}

export interface AppSettings {
  tooltips: boolean;
  adaptive: AdaptiveSettings;
}

export type AdaptiveState =
  | "off"
  | "snoozed"
  | "idle"
  | "waiting"
  | "applied"
  | "blocked"
  | "suggested";

export interface AdaptiveStatus {
  state: AdaptiveState;
  target: string;
  matchedRuleId: string | null;
  reason: string;
  gate: string;
}

export interface AdaptivePreset {
  id: string;
  name: string;
  description: string;
  patch: Partial<Omit<AdaptiveSettings, "enabled" | "batterySimulated" | "onBatterySim">>;
}

import { AdaptiveMode, AdaptiveRule, AdaptiveSettings, AdaptiveStatus } from "../types/adaptive";
import { HardwareProfile, PrivilegeLevel, Profile, ProfileSlotId, WorkloadMode } from "../types/hardware";
import { STOCK_BASELINE_CONFIG, WORKLOAD_META } from "../data/profiles";
import { computeBenchmarks, computeTelemetry, resolveEffectiveConfig } from "./physics";
import { clampConfigToProfile } from "./validation";

/** Hystérésis thermique : une alerte ne se relâche qu'à seuil − 5 °C (évite le yo-yo entre profils). */
export const THERMAL_HYSTERESIS_C = 5;

export interface AdaptiveSignals {
  idleSec: number;
  onBattery: boolean;
  workload: WorkloadMode;
  /** Heure locale 0–23 (défaut : 12). */
  hour?: number;
  /** Alerte thermique verrouillée (voir updateThermalLatch). Défaut : false. */
  thermalLatched?: boolean;
  /** Puissance système actuelle en Watts (pour les règles power_above). */
  currentWatts?: number;
}

export interface RuleMatch {
  rule: AdaptiveRule | null;
  target: ProfileSlotId | null;
  reason: string;
}

/** Plage horaire ; une plage 22 → 7 traverse minuit. Une plage vide (from = to) ne correspond jamais. */
export function inHourRange(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Met à jour le verrou thermique : déclenchement au seuil, relâchement à seuil − hystérésis. */
export function updateThermalLatch(previous: boolean, tempC: number, thresholdC: number): boolean {
  return previous ? tempC >= thresholdC - THERMAL_HYSTERESIS_C : tempC >= thresholdC;
}

export function matchCondition(rule: AdaptiveRule, s: AdaptiveSignals): boolean {
  const c = rule.condition;
  switch (c.kind) {
    case "always":
      return true;
    case "battery":
      return s.onBattery;
    case "idle":
      return s.idleSec >= c.seconds;
    case "workload":
      return s.workload === c.workload;
    case "schedule":
      return inHourRange(s.hour ?? 12, c.from, c.to);
    case "thermal":
      return s.thermalLatched === true;
    case "power_above":
      return (s.currentWatts ?? 0) >= c.watts;
  }
}

export function describeCondition(rule: AdaptiveRule): string {
  const c = rule.condition;
  switch (c.kind) {
    case "always":
      return "toujours";
    case "battery":
      return "sur batterie";
    case "idle":
      return `inactif ≥ ${c.seconds} s`;
    case "workload":
      return `charge « ${WORKLOAD_META[c.workload].shortLabel} »`;
    case "schedule":
      return `entre ${c.from} h et ${c.to} h${c.from > c.to ? " (nuit)" : ""}`;
    case "thermal":
      return `CPU ≥ ${c.tempC} °C (relâche à ${c.tempC - THERMAL_HYSTERESIS_C} °C)`;
    case "power_above":
      return `puissance ≥ ${c.watts} W`;
  }
}

/**
 * Détecte statiquement les règles actives qui ne pourront JAMAIS être atteintes :
 * - toute règle située après une règle active `always` ;
 * - un doublon de `battery` ou du même `workload` ;
 * - un `idle` avec un délai ≥ à un `idle` actif antérieur ;
 * - un `power_above` avec un seuil ≥ à un `power_above` actif antérieur ;
 * - une plage horaire vide (`from === to`).
 */
export function findShadowedRules(rules: readonly AdaptiveRule[]): Map<string, string> {
  const shadowed = new Map<string, string>();
  let seenAlways: string | null = null;
  let seenBattery: string | null = null;
  let minIdleSec = Infinity;
  let minPowerW = Infinity;
  const seenWorkloads = new Map<WorkloadMode, string>();

  for (const r of rules) {
    if (!r.enabled) continue;
    const c = r.condition;

    if (seenAlways) {
      shadowed.set(r.id, `Masquée par « ${seenAlways} » (toujours vrai plus haut — montez cette règle ↑).`);
      continue;
    }
    if (c.kind === "schedule" && c.from === c.to) {
      shadowed.set(r.id, "Plage horaire vide (heure de début = heure de fin).");
      continue;
    }
    if (c.kind === "battery" && seenBattery) {
      shadowed.set(r.id, `Doublon de « ${seenBattery} » plus haut.`);
      continue;
    }
    if (c.kind === "workload" && seenWorkloads.has(c.workload)) {
      shadowed.set(r.id, `Doublon de « ${seenWorkloads.get(c.workload)} » pour cette charge.`);
      continue;
    }
    if (c.kind === "idle" && c.seconds >= minIdleSec) {
      shadowed.set(r.id, `Masquée par une règle d'inactivité plus courte (≥ ${minIdleSec} s) située plus haut.`);
      continue;
    }
    if (c.kind === "power_above" && c.watts >= minPowerW) {
      shadowed.set(r.id, `Masquée par un seuil électrique plus bas (≥ ${minPowerW} W) situé plus haut.`);
      continue;
    }

    if (c.kind === "always") seenAlways = r.label;
    else if (c.kind === "battery") seenBattery = r.label;
    else if (c.kind === "workload") seenWorkloads.set(c.workload, r.label);
    else if (c.kind === "idle") minIdleSec = Math.min(minIdleSec, c.seconds);
    else if (c.kind === "power_above") minPowerW = Math.min(minPowerW, c.watts);
  }

  return shadowed;
}

/** Insère intelligemment une nouvelle règle juste AVANT la première règle `always` (pour éviter le code mort). */
export function insertRuleSmart(rules: readonly AdaptiveRule[], newRule: AdaptiveRule): AdaptiveRule[] {
  const alwaysIdx = rules.findIndex((r) => r.condition.kind === "always");
  if (alwaysIdx === -1) return [...rules, newRule];
  return [...rules.slice(0, alwaysIdx), newRule, ...rules.slice(alwaysIdx)];
}

/** Déplace une règle vers le haut (-1) ou vers le bas (+1) en préservant les bornes. */
export function moveRule(rules: readonly AdaptiveRule[], id: string, direction: -1 | 1): AdaptiveRule[] {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return [...rules];
  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= rules.length) return [...rules];
  const copy = [...rules];
  const [item] = copy.splice(idx, 1);
  copy.splice(nextIdx, 0, item);
  return copy;
}

/** Évalue les règles activées dans l'ordre ; la première correspondance gagne. */
export function evaluateRules(rules: readonly AdaptiveRule[], s: AdaptiveSignals): RuleMatch {
  for (const rule of rules) {
    if (rule.enabled && matchCondition(rule, s)) {
      return {
        rule,
        target: rule.target,
        reason: `Règle « ${rule.label} » (${describeCondition(rule)}).`,
      };
    }
  }
  return { rule: null, target: null, reason: "Aucune règle active ne correspond : profil actuel conservé." };
}

export interface GateInput {
  currentWatts: number;
  targetWatts: number;
  latencyMs: number;
  budgetMs: number;
  minSavingW: number;
  workload: WorkloadMode;
  protect: boolean;
  /** Vrai si la règle déclenchée est une sécurité thermique : outrepasse budgetMs, minSavingW et charge lourde. */
  thermalEmergency?: boolean;
  /** Vrai si l'utilisateur est réellement inactif : tolère un budget de latence élargi puisqu'il n'interagit pas. */
  idleTriggered?: boolean;
}

export interface GateResult {
  allowed: boolean;
  savedW: number;
  /** Vrai pour un retour vers plus de performance ou une sécurité thermique (pas d'attente de dwellSec). */
  urgent: boolean;
  reason: string;
}

/**
 * Porte de décision : détermine si économiser (ou remonter en puissance) est approprié maintenant.
 * 1. Sécurité thermique : TOUJOURS autorisée et urgente (refroidir prime sur +ms d'interface).
 * 2. Retour vers plus de performance (savedW <= 0) : TOUJOURS autorisé et réactif (ne bride jamais l'utilisateur).
 * 3. Règle protégée ou charge lourde (hors alerte thermique) : interdit tout bridage (race-to-idle / rendu).
 * 4. Gain inférieur au seuil minSavingW : refusé (évite les micro-bascules inutiles).
 * 5. En activité interactive, latence ajoutée > budgetMs : refusé. (En inactivité confirmée, l'écran n'est pas sollicité : budget doublé, min 8 ms.)
 */
export function gateDecision(i: GateInput): GateResult {
  const savedW = Math.round((i.currentWatts - i.targetWatts) * 10) / 10;

  if (i.thermalEmergency && savedW > 0) {
    return {
      allowed: true,
      savedW,
      urgent: true,
      reason: `Sécurité thermique prioritaire : refroidissement immédiat (−${savedW.toFixed(1)} W, outrepasse le budget ms).`,
    };
  }

  if (savedW <= 0) {
    return {
      allowed: true,
      savedW,
      urgent: true,
      reason:
        savedW === 0
          ? "Puissance équivalente : alignement de profil autorisé."
          : `Retour vers plus de performance (+${(-savedW).toFixed(1)} W) : autorisé sans délai.`,
    };
  }

  if (i.protect || i.workload === "heavy") {
    return {
      allowed: false,
      savedW,
      urgent: false,
      reason: "Charge lourde ou règle protégée : aucun bridage appliqué, performances maintenues à 100 %.",
    };
  }

  if (savedW < i.minSavingW) {
    return {
      allowed: false,
      savedW,
      urgent: false,
      reason: `Gain de ${savedW.toFixed(1)} W inférieur au seuil de ${i.minSavingW} W : bascule non rentable.`,
    };
  }

  const effectiveBudgetMs = i.idleTriggered ? Math.max(i.budgetMs * 2, 8) : i.budgetMs;
  if (i.latencyMs > effectiveBudgetMs) {
    return {
      allowed: false,
      savedW,
      urgent: false,
      reason: `Latence ajoutée +${i.latencyMs.toFixed(2)} ms > budget ${effectiveBudgetMs.toFixed(1)} ms : économie refusée pour préserver la fluidité.`,
    };
  }

  return {
    allowed: true,
    savedW,
    urgent: false,
    reason: i.idleTriggered
      ? `Inactivité confirmée : −${savedW.toFixed(1)} W (+${i.latencyMs.toFixed(2)} ms invisible hors interaction, réveil immédiat au retour).`
      : `Compromis validé : −${savedW.toFixed(1)} W pour +${i.latencyMs.toFixed(2)} ms (≤ budget ${i.budgetMs} ms).`,
  };
}

/** Durée minimale de stabilité (ms) exigée avant de confirmer une bascule d'économie (insensible aux re-renders). */
export const DEFAULT_CONFIRM_MS = 2500;

/** État interne pur de la machine à états du contrôleur adaptatif (zéro dépendance React/DOM). */
export interface AdaptiveRuntimeState {
  pending: { slot: ProfileSlotId; sinceMs: number } | null;
  lastSwitchMs: number;
  snoozeUntilMs: number;
  thermalLatched: boolean;
  lastSuggestedSlot: ProfileSlotId | null;
}

export function createInitialRuntimeState(): AdaptiveRuntimeState {
  return {
    pending: null,
    lastSwitchMs: 0,
    snoozeUntilMs: 0,
    thermalLatched: false,
    lastSuggestedSlot: null,
  };
}

export interface AdaptiveStepInput {
  nowMs: number;
  enabled: boolean;
  mode: AdaptiveMode;
  dwellSec: number;
  /** Fenêtre temporelle de confirmation (ms) avant bascule éco ; défaut : 2 500 ms. */
  confirmMs?: number;
  /** Vrai si l'utilisateur demande un test immédiat (ignore la confirmation et dwellSec). */
  immediate?: boolean;
  activeSlot: ProfileSlotId;
  isDirty: boolean;
  match: RuleMatch;
  /** Gate précalculée lorsque match.target !== null et match.target !== activeSlot. */
  gate: GateResult | null;
}

export type AdaptiveEffect =
  | { kind: "none" }
  | { kind: "apply"; target: ProfileSlotId; logText: string }
  | { kind: "suggest"; target: ProfileSlotId; isNew: boolean; logText: string };

export interface AdaptiveStepOutput {
  nextRuntime: AdaptiveRuntimeState;
  status: AdaptiveStatus;
  effect: AdaptiveEffect;
}

/**
 * Transition pure et déterministe du contrôleur adaptatif :
 * gère off → snooze manuel → match → gate → dirty → confirmation 2 cycles → dwellSec → apply/suggest.
 */
export function stepAdaptiveEngine(
  runtime: AdaptiveRuntimeState,
  input: AdaptiveStepInput
): AdaptiveStepOutput {
  const { nowMs, enabled, mode, dwellSec, immediate, activeSlot, isDirty, match, gate } = input;

  if (!enabled) {
    return {
      nextRuntime: { ...runtime, pending: null, lastSuggestedSlot: null },
      status: {
        state: "off",
        target: "—",
        matchedRuleId: null,
        reason: "Mode intelligent désactivé — vos réglages restent 100 % manuels.",
        gate: "",
      },
      effect: { kind: "none" },
    };
  }

  const isThermalEmergency = match.rule?.condition.kind === "thermal";

  // Pause temporaire après un choix manuel (sauf urgence thermique !)
  if (!immediate && !isThermalEmergency && runtime.snoozeUntilMs > nowMs) {
    const remSec = Math.ceil((runtime.snoozeUntilMs - nowMs) / 1000);
    const remLabel = remSec >= 60 ? `${Math.ceil(remSec / 60)} min` : `${remSec} s`;
    return {
      nextRuntime: { ...runtime, pending: null },
      status: {
        state: "snoozed",
        target: `P${activeSlot} (manuel)`,
        matchedRuleId: match.rule?.id ?? null,
        reason: `Pause automatique suite à votre choix manuel (encore ${remLabel}) — le mode auto respecte votre main.`,
        gate: match.target && match.target !== activeSlot ? `Cible en veille : P${match.target} (${match.reason})` : "",
      },
      effect: { kind: "none" },
    };
  }

  if (!match.target || !match.rule) {
    return {
      nextRuntime: { ...runtime, pending: null, lastSuggestedSlot: null },
      status: {
        state: "idle",
        target: "—",
        matchedRuleId: null,
        reason: match.reason,
        gate: "",
      },
      effect: { kind: "none" },
    };
  }

  if (match.target === activeSlot) {
    return {
      nextRuntime: { ...runtime, pending: null, lastSuggestedSlot: null },
      status: {
        state: "applied",
        target: `P${activeSlot}`,
        matchedRuleId: match.rule.id,
        reason: `Déjà sur le profil optimal P${activeSlot}. ${match.reason}`,
        gate: "Aucune bascule requise (0 oscillation).",
      },
      effect: { kind: "none" },
    };
  }

  if (!gate || !gate.allowed) {
    return {
      nextRuntime: { ...runtime, pending: null, lastSuggestedSlot: null },
      status: {
        state: "blocked",
        target: `P${match.target}`,
        matchedRuleId: match.rule.id,
        reason: match.reason,
        gate: gate?.reason ?? "Bascule refusée par la porte de sécurité.",
      },
      effect: { kind: "none" },
    };
  }

  if (isDirty) {
    return {
      nextRuntime: { ...runtime, pending: null },
      status: {
        state: "blocked",
        target: `P${match.target}`,
        matchedRuleId: match.rule.id,
        reason: match.reason,
        gate: `Modifications non enregistrées sur P${activeSlot} : jamais écrasées automatiquement. Sauvegardez (Ctrl+S) ou annulez (Ctrl+Z).`,
      },
      effect: { kind: "none" },
    };
  }

  const confirmMs = input.confirmMs ?? DEFAULT_CONFIRM_MS;
  // Urgence thermique et retour vers plus de performance s'appliquent immédiatement sans délai
  const bypassStabilization = immediate === true || gate.urgent;

  if (!bypassStabilization) {
    const prev = runtime.pending;
    const sinceMs = prev && prev.slot === match.target ? prev.sinceMs : nowMs;
    const stableMs = Math.max(0, nowMs - sinceMs);
    if (stableMs < confirmMs) {
      const remSec = Math.max(1, Math.ceil((confirmMs - stableMs) / 1000));
      return {
        nextRuntime: { ...runtime, pending: { slot: match.target, sinceMs } },
        status: {
          state: "waiting",
          target: `P${match.target}`,
          matchedRuleId: match.rule.id,
          reason: `Cible P${match.target} détectée (${match.rule.label}) : confirmation de stabilité (${remSec} s)…`,
          gate: gate.reason,
        },
        effect: { kind: "none" },
      };
    }

    if (runtime.lastSwitchMs > 0) {
      const elapsedSec = (nowMs - runtime.lastSwitchMs) / 1000;
      if (elapsedSec < dwellSec) {
        const waitSec = Math.max(1, Math.ceil(dwellSec - elapsedSec));
        return {
          nextRuntime: { ...runtime, pending: { slot: match.target, sinceMs } },
          status: {
            state: "waiting",
            target: `P${match.target}`,
            matchedRuleId: match.rule.id,
            reason: `Anti-oscillation actif : bascule vers P${match.target} dans ${waitSec} s.`,
            gate: gate.reason,
          },
          effect: { kind: "none" },
        };
      }
    }
  }

  const target = match.target;
  if (mode === "auto") {
    return {
      nextRuntime: {
        ...runtime,
        pending: null,
        lastSwitchMs: nowMs,
        snoozeUntilMs: 0,
        lastSuggestedSlot: null,
      },
      status: {
        state: "applied",
        target: `P${target}`,
        matchedRuleId: match.rule.id,
        reason: match.reason,
        gate: gate.reason,
      },
      effect: {
        kind: "apply",
        target,
        logText: `Auto → P${target} · ${match.rule.label} · ${gate.reason}`,
      },
    };
  }

  const isNew = runtime.lastSuggestedSlot !== target;
  const keptSince =
    runtime.pending && runtime.pending.slot === target ? runtime.pending.sinceMs : nowMs - confirmMs;
  return {
    nextRuntime: {
      ...runtime,
      pending: { slot: target, sinceMs: keptSince },
      lastSuggestedSlot: target,
    },
    status: {
      state: "suggested",
      target: `P${target}`,
      matchedRuleId: match.rule.id,
      reason: match.reason,
      gate: gate.reason,
    },
    effect: {
      kind: "suggest",
      target,
      isNew,
      logText: `Suggestion → P${target} · ${match.rule.label} · ${gate.reason}`,
    },
  };
}

export interface ScenarioPreview {
  id: string;
  label: string;
  contextHint: string;
  verdict: "Économise" | "Protégé 100 %" | "Refroidit" | "Équilibré" | "Bloqué (budget)";
  chosenSlot: ProfileSlotId;
  chosenName: string;
  ruleLabel: string;
  savedWattsVsStock: number;
  uiDeltaMsVsStock: number;
}

/**
 * Simule instantanément le comportement exact des règles et garde-fous de l'utilisateur
 * sur 7 situations représentatives d'une vraie journée Windows — bureau, pause, batterie, nuit,
 * jeu, build, surchauffe — de façon déterministe et sans aucun effet de bord.
 */
export function simulatePolicyMatrix(
  adaptive: AdaptiveSettings,
  profiles: readonly Profile[],
  hardware: HardwareProfile,
  privilege: PrivilegeLevel
): ScenarioPreview[] {
  const stockCfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, hardware);

  const scenarios: {
    id: string;
    label: string;
    contextHint: string;
    signals: Omit<AdaptiveSignals, "currentWatts">;
    forceHot?: boolean;
  }[] = [
    {
      id: "office-day",
      label: "Bureau & Dev actif",
      contextHint: "14 h · Secteur · actif",
      signals: { idleSec: 0, onBattery: false, workload: "office", hour: 14, thermalLatched: false },
    },
    {
      id: "coffee-idle",
      label: "Pause / Lecture (3 min)",
      contextHint: "15 h · Inactif 180 s",
      signals: { idleSec: 180, onBattery: false, workload: "idle", hour: 15, thermalLatched: false },
    },
    {
      id: "on-battery",
      label: "Nomade sur batterie",
      contextHint: "11 h · Batterie · actif",
      signals: { idleSec: 0, onBattery: true, workload: "office", hour: 11, thermalLatched: false },
    },
    {
      id: "night-work",
      label: "Soirée / Nuit calme",
      contextHint: "23 h · Secteur · repos",
      signals: { idleSec: 0, onBattery: false, workload: "idle", hour: 23, thermalLatched: false },
    },
    {
      id: "gaming-3d",
      label: "Session Jeu 3D",
      contextHint: "20 h · Charge 3D 86 %",
      signals: { idleSec: 0, onBattery: false, workload: "gaming", hour: 20, thermalLatched: false },
    },
    {
      id: "heavy-build",
      label: "Build Rust / Rendu 100 %",
      contextHint: "16 h · Pleine charge",
      signals: { idleSec: 0, onBattery: false, workload: "heavy", hour: 16, thermalLatched: false },
    },
    {
      id: "thermal-spike",
      label: "Alerte surchauffe (88 °C)",
      contextHint: "Verrou thermique actif",
      signals: { idleSec: 0, onBattery: false, workload: "gaming", hour: 16, thermalLatched: true },
      forceHot: true,
    },
  ];

  return scenarios.map((sc) => {
    const wl = sc.signals.workload;
    const stockTel = computeTelemetry(stockCfg, wl, undefined, 0, hardware);
    const match = evaluateRules(adaptive.rules, {
      ...sc.signals,
      currentWatts: stockTel.totalSystemWatts,
    });

    const fallbackSlot: ProfileSlotId = 5;
    const candidateSlot = match.target ?? fallbackSlot;
    const targetProfile = profiles.find((p) => p.id === candidateSlot) ?? profiles[profiles.length - 1];
    const targetCfg = resolveEffectiveConfig(
      clampConfigToProfile(targetProfile.config, hardware),
      privilege,
      stockCfg
    );
    const targetTel = computeTelemetry(targetCfg, wl, undefined, 0, hardware);
    const benches = computeBenchmarks(stockCfg, targetCfg, 1, hardware);
    const uiDelta = Math.max(
      0,
      ...benches.filter((b) => b.id === "json" || b.id === "gpu_frame").map((b) => b.deltaMs)
    );

    const gate =
      match.rule && candidateSlot !== 5
        ? gateDecision({
            currentWatts: stockTel.totalSystemWatts,
            targetWatts: targetTel.totalSystemWatts,
            latencyMs: uiDelta,
            budgetMs: adaptive.budgetMs,
            minSavingW: adaptive.minSavingW,
            workload: wl,
            protect: match.rule.protect,
            thermalEmergency: match.rule.condition.kind === "thermal",
            idleTriggered: match.rule.condition.kind === "idle",
          })
        : { allowed: true, savedW: 0, urgent: false, reason: "" };

    const isProtected = !!match.rule?.protect || (wl === "heavy" && !sc.forceHot && candidateSlot === 5);

    if (!gate.allowed && !isProtected) {
      const p5 = profiles.find((p) => p.id === 5) ?? profiles[profiles.length - 1];
      return {
        id: sc.id,
        label: sc.label,
        contextHint: sc.contextHint,
        verdict: "Bloqué (budget)",
        chosenSlot: p5.id,
        chosenName: p5.name,
        ruleLabel: match.rule ? `${match.rule.label} (refusée)` : "Aucune règle",
        savedWattsVsStock: 0,
        uiDeltaMsVsStock: 0,
      };
    }

    const savedW = Math.max(0, Math.round((stockTel.totalSystemWatts - targetTel.totalSystemWatts) * 10) / 10);
    const jsonDelta = Math.max(0, Math.round((benches[0]?.deltaMs ?? 0) * 10) / 10);

    let verdict: ScenarioPreview["verdict"] = "Économise";
    if (match.rule?.condition.kind === "thermal") verdict = "Refroidit";
    else if (isProtected) verdict = "Protégé 100 %";
    else if (wl === "gaming" && savedW > 0) verdict = "Équilibré";
    else if (savedW < 1) verdict = "Protégé 100 %";

    return {
      id: sc.id,
      label: sc.label,
      contextHint: sc.contextHint,
      verdict,
      chosenSlot: targetProfile.id,
      chosenName: targetProfile.name,
      ruleLabel: match.rule?.label ?? "Profil conservé",
      savedWattsVsStock: savedW,
      uiDeltaMsVsStock: jsonDelta,
    };
  });
}

import React, { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Battery,
  Check,
  Clock,
  Flame,
  HelpCircle,
  Lightbulb,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import {
  AdaptiveMode,
  AdaptivePreset,
  AdaptiveRule,
  AdaptiveSettings,
  AdaptiveStatus,
  AppSettings,
  RuleCondition,
} from "../types/adaptive";
import {
  HardwareProfile,
  PrivilegeLevel,
  Profile,
  ProfileSlotId,
  TelemetrySnapshot,
  WorkloadMode,
} from "../types/hardware";
import { WORKLOAD_META } from "../data/profiles";
import { ADAPTIVE_PRESETS, cloneRules, DEFAULT_RULES } from "../store/settings";
import { findShadowedRules, insertRuleSmart, moveRule, simulatePolicyMatrix } from "../engine/adaptive";
import { TechTooltip } from "./TechTooltip";

interface AdaptivePanelProps {
  settings: AppSettings;
  profiles: Profile[];
  hardware: HardwareProfile;
  privilege: PrivilegeLevel;
  status: AdaptiveStatus;
  savedWh: number;
  activeSlot: ProfileSlotId;
  workload: WorkloadMode;
  afterTel: TelemetrySnapshot;
  idleSecDisplay: number;
  simulatedIdleSec: number | null;
  onSetSimulatedIdleSec: (val: number | null) => void;
  simulatedHour: number | null;
  onSetSimulatedHour: (val: number | null) => void;
  thermalLatched: boolean;
  batteryAvailable: boolean;
  realOnBattery: boolean;
  log: { id: string; at: string; text: string }[];
  suggestion: ProfileSlotId | null;
  onChangeWorkload: (w: WorkloadMode) => void;
  onPatchAdaptive: (patch: Partial<AdaptiveSettings>) => void;
  onSetRules: (rules: AdaptiveRule[]) => void;
  onSetTooltips: (value: boolean) => void;
  onEvaluateNow: () => void;
  onClearSnooze: () => void;
  onApplySuggestion: () => void;
  onClearLog: () => void;
  onResetSavings: () => void;
}

const STATE_STYLE: Record<AdaptiveStatus["state"], { label: string; cls: string }> = {
  off: { label: "Désactivé", cls: "bg-slate-800 text-slate-300 border-slate-700" },
  snoozed: { label: "Pause manuelle", cls: "bg-amber-500/15 text-amber-200 border-amber-500/40" },
  idle: { label: "Aucune règle active", cls: "bg-slate-800 text-slate-300 border-slate-700" },
  waiting: { label: "Stabilisation", cls: "bg-sky-500/15 text-sky-300 border-sky-500/35" },
  applied: { label: "Profil optimal actif", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35" },
  blocked: { label: "Économie refusée", cls: "bg-amber-500/15 text-amber-300 border-amber-500/35" },
  suggested: { label: "Suggestion prête", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/35" },
};

const BUDGETS = [0.5, 1, 2, 4, 8, 12];
const MIN_SAVINGS = [0, 3, 6, 12, 25];
const DWELLS = [15, 30, 60, 120, 300];
const SNOOZES = [0, 5, 15, 30, 60];

export const AdaptivePanel: React.FC<AdaptivePanelProps> = ({
  settings,
  profiles,
  hardware,
  privilege,
  status,
  savedWh,
  activeSlot,
  workload,
  afterTel,
  idleSecDisplay,
  simulatedIdleSec,
  onSetSimulatedIdleSec,
  simulatedHour,
  onSetSimulatedHour,
  thermalLatched,
  batteryAvailable,
  realOnBattery,
  log,
  suggestion,
  onChangeWorkload,
  onPatchAdaptive,
  onSetRules,
  onSetTooltips,
  onEvaluateNow,
  onClearSnooze,
  onApplySuggestion,
  onClearLog,
  onResetSavings,
}) => {
  const ad = settings.adaptive;
  const style = STATE_STYLE[status.state];
  const shadowedMap = useMemo(() => findShadowedRules(ad.rules), [ad.rules]);
  const scenarioMatrix = useMemo(
    () => simulatePolicyMatrix(ad, profiles, hardware, privilege),
    [ad, profiles, hardware, privilege]
  );

  const updateRule = (id: string, patch: Partial<AdaptiveRule>) =>
    onSetRules(ad.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const setCondition = (rule: AdaptiveRule, kind: RuleCondition["kind"]) => {
    const condition: RuleCondition =
      kind === "idle"
        ? { kind: "idle", seconds: 120 }
        : kind === "workload"
        ? { kind: "workload", workload: "gaming" }
        : kind === "schedule"
        ? { kind: "schedule", from: 22, to: 7 }
        : kind === "thermal"
        ? { kind: "thermal", tempC: 85 }
        : kind === "power_above"
        ? { kind: "power_above", watts: 110 }
        : { kind };
    updateRule(rule.id, { condition });
  };

  const patchCondition = (
    rule: AdaptiveRule,
    patch: { from?: number; to?: number; tempC?: number; seconds?: number; watts?: number }
  ) => {
    const c = rule.condition;
    if (c.kind === "schedule") {
      updateRule(rule.id, { condition: { ...c, from: patch.from ?? c.from, to: patch.to ?? c.to } });
    } else if (c.kind === "thermal") {
      updateRule(rule.id, { condition: { kind: "thermal", tempC: patch.tempC ?? c.tempC } });
    } else if (c.kind === "idle") {
      updateRule(rule.id, { condition: { kind: "idle", seconds: patch.seconds ?? c.seconds } });
    } else if (c.kind === "power_above") {
      updateRule(rule.id, { condition: { kind: "power_above", watts: patch.watts ?? c.watts } });
    }
  };

  const clampHour = (v: string) => Math.max(0, Math.min(23, Math.round(Number(v) || 0)));

  const addRule = () => {
    const newRule: AdaptiveRule = {
      id: `rule-${Date.now().toString(36)}`,
      enabled: true,
      label: "Pause prolongée : veille active",
      condition: { kind: "idle", seconds: 300 },
      target: 4,
      protect: false,
    };
    onSetRules(insertRuleSmart(ad.rules, newRule));
  };

  const applyPreset = (preset: AdaptivePreset) => {
    onPatchAdaptive({
      ...preset.patch,
      enabled: true,
      rules: preset.patch.rules ? cloneRules(preset.patch.rules) : ad.rules,
    });
  };

  const removeRule = (id: string) => onSetRules(ad.rules.filter((r) => r.id !== id));
  const currentHour = simulatedHour !== null ? simulatedHour : new Date().getHours();
  const effectiveBattery = ad.batterySimulated ? ad.onBatterySim : realOnBattery;
  const kwh = savedWh / 1000;

  return (
    <div className="space-y-4">
      {/* 1. EN-TÊTE : INTERRUPTEUR + DÉCISION EN DIRECT + COMPTEUR WH */}
      <section className="rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-emerald-400" />
              <TechTooltip tooltipKey="adaptive_mode">
                <h2 className="text-sm font-semibold text-white">
                  Mode intelligent : économiser uniquement quand c'est approprié
                </h2>
              </TechTooltip>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Évalue la charge, la température, la batterie, l'inactivité, l'heure et la puissance — ne bride jamais une tâche lourde ni votre confort.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {ad.enabled && (
              <button
                type="button"
                onClick={onEvaluateNow}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
                title="Forcer une décision immédiate sans attendre le délai anti-oscillation"
              >
                <Play className="w-3 h-3 text-emerald-400" />
                Tester maintenant
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={ad.enabled}
              onClick={() => onPatchAdaptive({ enabled: !ad.enabled })}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                ad.enabled
                  ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-200"
                  : "bg-slate-800 border-slate-700 text-slate-300"
              }`}
            >
              <span
                className={`w-8 h-4 rounded-full p-0.5 transition-colors ${
                  ad.enabled ? "bg-emerald-500" : "bg-slate-600"
                }`}
              >
                <span
                  className={`block w-3 h-3 rounded-full bg-white transition-transform ${
                    ad.enabled ? "translate-x-4" : ""
                  }`}
                />
              </span>
              {ad.enabled ? "Activé" : "Désactivé"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-7 rounded-lg bg-[#0F131B] border border-slate-800 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded border ${style.cls}`}>
                  {style.label}
                </span>
                <span className="font-mono text-[11px] text-slate-200">
                  Actif : P{activeSlot} → Cible : <strong>{status.target}</strong>
                </span>
              </div>
              {status.state === "snoozed" && (
                <button
                  type="button"
                  onClick={onClearSnooze}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10.5px] font-semibold text-amber-200 cursor-pointer"
                >
                  Reprendre l'automatisme
                </button>
              )}
            </div>
            <p className="text-[11.5px] text-slate-200 leading-relaxed">{status.reason}</p>
            {status.gate && (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-300">Porte de décision :</strong> {status.gate}
              </p>
            )}
            {status.state === "suggested" && suggestion && (
              <button
                type="button"
                onClick={onApplySuggestion}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" /> Appliquer P{suggestion} maintenant
              </button>
            )}
          </div>

          <div className="lg:col-span-5 rounded-lg bg-emerald-950/25 border border-emerald-500/25 p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
              <Zap className="w-3.5 h-3.5" /> Énergie économisée vs Stock (intégrée Δt réel)
            </div>
            <div className="font-mono text-lg font-bold text-white tabular-nums">
              {savedWh.toFixed(2)} Wh{" "}
              <span className="text-xs font-normal text-emerald-300">({kwh.toFixed(4)} kWh)</span>
            </div>
            <button
              type="button"
              onClick={onResetSavings}
              className="self-start inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Remettre le compteur à zéro
            </button>
          </div>
        </div>

        {/* Préréglages intelligents en 1 clic */}
        <div className="pt-1">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            Stratégies prêtes à l'emploi (active & configure en 1 clic)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ADAPTIVE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className="p-2.5 rounded-lg bg-[#0E1219] hover:bg-[#161D29] border border-slate-800 hover:border-emerald-500/40 text-left transition-colors cursor-pointer"
              >
                <div className="text-[11.5px] font-semibold text-slate-100">{preset.name}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{preset.description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 2. BANC DE TEST INTERACTIF DES SIGNAUX EN DIRECT */}
      <section className="rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-100">
            Capteurs & simulateur interactif (testez vos règles en temps réel sans attendre)
          </h3>
          {(simulatedIdleSec !== null || simulatedHour !== null || ad.batterySimulated) && (
            <button
              type="button"
              onClick={() => {
                onSetSimulatedIdleSec(null);
                onSetSimulatedHour(null);
                onPatchAdaptive({ batterySimulated: false, onBatterySim: false });
              }}
              className="text-[10.5px] text-amber-300 hover:text-amber-200 underline underline-offset-2 cursor-pointer"
            >
              Revenir aux capteurs réels
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 text-[11px]">
          {/* Inactivité */}
          <div className="rounded-lg bg-[#0F131B] border border-slate-800 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-medium">Inactivité clavier/souris</span>
              <span className="font-mono font-semibold text-emerald-300 tabular-nums">{idleSecDisplay} s</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { val: null, label: "Réel" },
                  { val: 0, label: "0 s" },
                  { val: 130, label: "2 min+" },
                  { val: 360, label: "6 min" },
                ] as const
              ).map((opt) => (
                <button
                  key={String(opt.val)}
                  type="button"
                  onClick={() => onSetSimulatedIdleSec(opt.val)}
                  aria-pressed={simulatedIdleSec === opt.val}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] border cursor-pointer ${
                    simulatedIdleSec === opt.val
                      ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200"
                      : "bg-[#151B26] border-slate-700/70 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alimentation / Batterie */}
          <div className="rounded-lg bg-[#0F131B] border border-slate-800 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-medium inline-flex items-center gap-1">
                <Battery className="w-3 h-3 text-sky-400" /> Alimentation
              </span>
              <span className="font-mono font-semibold text-sky-300">
                {effectiveBattery ? "Batterie" : "Secteur AC"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => onPatchAdaptive({ batterySimulated: false })}
                aria-pressed={!ad.batterySimulated}
                className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                  !ad.batterySimulated
                    ? "bg-sky-500/20 border-sky-500/50 text-sky-200"
                    : "bg-[#151B26] border-slate-700/70 text-slate-400"
                }`}
              >
                {batteryAvailable ? "Capteur réel" : "Auto (AC)"}
              </button>
              <button
                type="button"
                onClick={() => onPatchAdaptive({ batterySimulated: true, onBatterySim: false })}
                aria-pressed={ad.batterySimulated && !ad.onBatterySim}
                className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                  ad.batterySimulated && !ad.onBatterySim
                    ? "bg-sky-500/20 border-sky-500/50 text-sky-200"
                    : "bg-[#151B26] border-slate-700/70 text-slate-400"
                }`}
              >
                Sim. Secteur
              </button>
              <button
                type="button"
                onClick={() => onPatchAdaptive({ batterySimulated: true, onBatterySim: true })}
                aria-pressed={ad.batterySimulated && ad.onBatterySim}
                className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                  ad.batterySimulated && ad.onBatterySim
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                    : "bg-[#151B26] border-slate-700/70 text-slate-400"
                }`}
              >
                Sim. Batterie
              </button>
            </div>
          </div>

          {/* Heure locale */}
          <div className="rounded-lg bg-[#0F131B] border border-slate-800 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-medium inline-flex items-center gap-1">
                <Clock className="w-3 h-3 text-indigo-400" /> Heure locale
              </span>
              <span className="font-mono font-semibold text-indigo-300">{currentHour} h</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { val: null, label: "Réelle" },
                  { val: 14, label: "14 h (Jour)" },
                  { val: 23, label: "23 h (Nuit)" },
                  { val: 3, label: "03 h" },
                ] as const
              ).map((opt) => (
                <button
                  key={String(opt.val)}
                  type="button"
                  onClick={() => onSetSimulatedHour(opt.val)}
                  aria-pressed={simulatedHour === opt.val}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] border cursor-pointer ${
                    simulatedHour === opt.val
                      ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
                      : "bg-[#151B26] border-slate-700/70 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Charge, Watts & Thermique */}
          <div className="rounded-lg bg-[#0F131B] border border-slate-800 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-medium inline-flex items-center gap-1">
                <Flame className="w-3 h-3 text-amber-400" /> Charge & T°
              </span>
              <span className="font-mono text-[10.5px] tabular-nums">
                <strong className="text-white">{afterTel.totalSystemWatts.toFixed(0)}W</strong> ·{" "}
                <strong className={thermalLatched ? "text-rose-300" : "text-slate-300"}>
                  {afterTel.cpuTempC.toFixed(0)}°C{thermalLatched ? " !" : ""}
                </strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(WORKLOAD_META) as WorkloadMode[]).map((wm) => (
                <button
                  key={wm}
                  type="button"
                  onClick={() => onChangeWorkload(wm)}
                  aria-pressed={workload === wm}
                  className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                    workload === wm
                      ? "bg-slate-700 border-slate-500 text-white font-medium"
                      : "bg-[#151B26] border-slate-700/70 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {WORKLOAD_META[wm].shortLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. GARDE-FOUS + ÉDITEUR DE RÈGLES ORDONNÉES */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-3.5">
          <h3 className="text-xs font-semibold text-slate-100">Comportement & garde-fous anti-gêne</h3>

          <div className="space-y-1.5">
            <span className="text-[11px] text-slate-400">Mode d'application</span>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Mode d'application">
              {(
                [
                  { id: "suggest" as AdaptiveMode, label: "Suggérer", hint: "Notification + confirmation en 1 clic" },
                  { id: "auto" as AdaptiveMode, label: "Automatique", hint: "Bascule autonome & réversible" },
                ]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={ad.mode === m.id}
                  onClick={() => onPatchAdaptive({ mode: m.id })}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                    ad.mode === m.id
                      ? "bg-emerald-500/15 border-emerald-500/50"
                      : "bg-[#0F131B] border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-100">{m.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Budget max de latence en activité</span>
              <span className="font-mono text-emerald-300 font-semibold">+{ad.budgetMs} ms max</span>
            </div>
            <div className="inline-flex flex-wrap rounded bg-[#0C1017] border border-slate-700 p-0.5" role="group" aria-label="Budget de latence">
              {BUDGETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={ad.budgetMs === v}
                  onClick={() => onPatchAdaptive({ budgetMs: v })}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                    ad.budgetMs === v ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {v}ms
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">
              Outrepassé uniquement en cas d'urgence thermique ; doublé automatiquement pendant l'inactivité confirmée.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Gain électrique minimal requis</span>
              <span className="font-mono text-slate-200">{ad.minSavingW} W</span>
            </div>
            <div className="inline-flex flex-wrap rounded bg-[#0C1017] border border-slate-700 p-0.5" role="group" aria-label="Gain minimal">
              {MIN_SAVINGS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={ad.minSavingW === v}
                  onClick={() => onPatchAdaptive({ minSavingW: v })}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                    ad.minSavingW === v ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {v} W
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Délai minimal entre deux bascules éco</span>
              <span className="font-mono text-slate-200">
                {ad.dwellSec < 60 ? `${ad.dwellSec} s` : `${ad.dwellSec / 60} min`}
              </span>
            </div>
            <div className="inline-flex flex-wrap rounded bg-[#0C1017] border border-slate-700 p-0.5" role="group" aria-label="Délai entre bascules">
              {DWELLS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={ad.dwellSec === v}
                  onClick={() => onPatchAdaptive({ dwellSec: v })}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                    ad.dwellSec === v ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {v < 60 ? `${v} s` : `${v / 60} min`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Pause auto après un clic manuel sur P1..P5</span>
              <span className="font-mono text-slate-200">
                {ad.manualSnoozeMin === 0 ? "Aucune" : `${ad.manualSnoozeMin} min`}
              </span>
            </div>
            <div className="inline-flex flex-wrap rounded bg-[#0C1017] border border-slate-700 p-0.5" role="group" aria-label="Pause après choix manuel">
              {SNOOZES.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={ad.manualSnoozeMin === v}
                  onClick={() => onPatchAdaptive({ manualSnoozeMin: v })}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                    ad.manualSnoozeMin === v ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {v === 0 ? "Off" : `${v} min`}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Éditeur de règles avec priorité ↑/↓ et détection de masquage */}
        <section className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-100">
                Règles de décision par ordre de priorité (la 1re qui correspond gagne)
              </h3>
              {shadowedMap.size > 0 && (
                <p className="text-[10.5px] text-amber-300 inline-flex items-center gap-1 mt-0.5">
                  <AlertTriangle className="w-3 h-3" />
                  {shadowedMap.size} règle(s) masquée(s) : utilisez ↑ pour les remonter au-dessus d'une règle plus générale.
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSetRules(cloneRules(DEFAULT_RULES))}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10.5px] text-slate-300 cursor-pointer"
              >
                Par défaut
              </button>
              <button
                type="button"
                onClick={addRule}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-semibold cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Ajouter une règle
              </button>
            </div>
          </div>

          <ul className="space-y-2">
            {ad.rules.map((rule, idx) => {
              const isMatched = ad.enabled && status.matchedRuleId === rule.id;
              const shadowReason = shadowedMap.get(rule.id);
              return (
                <li
                  key={rule.id}
                  className={`rounded-lg border p-2.5 space-y-2 transition-colors ${
                    !rule.enabled
                      ? "bg-[#0B0E14] border-slate-800/60 opacity-60"
                      : isMatched
                      ? "bg-emerald-950/25 border-emerald-500/50"
                      : shadowReason
                      ? "bg-amber-950/15 border-amber-500/40"
                      : "bg-[#0F131B] border-slate-800"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-slate-500 w-5">{idx + 1}.</span>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      aria-label={`Activer la règle ${rule.label}`}
                      onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                      className="accent-emerald-500 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={rule.label}
                      maxLength={64}
                      aria-label="Libellé de la règle"
                      onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                      className="flex-1 min-w-[150px] bg-[#0C1017] border border-slate-700 rounded px-2 py-1 text-[11.5px] text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                    {isMatched && (
                      <span className="font-mono text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950">
                        ACTIVE
                      </span>
                    )}
                    <div className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onSetRules(moveRule(ad.rules, rule.id, -1))}
                        aria-label={`Monter la règle ${rule.label}`}
                        title="Augmenter la priorité (monter)"
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === ad.rules.length - 1}
                        onClick={() => onSetRules(moveRule(ad.rules, rule.id, 1))}
                        aria-label={`Descendre la règle ${rule.label}`}
                        title="Diminuer la priorité (descendre)"
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRule(rule.id)}
                        aria-label={`Supprimer la règle ${rule.label}`}
                        title="Supprimer cette règle"
                        className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-6 text-[11px] text-slate-300">
                    <span className="text-slate-500">Si</span>
                    <select
                      value={rule.condition.kind}
                      aria-label="Type de condition"
                      onChange={(e) => setCondition(rule, e.target.value as RuleCondition["kind"])}
                      className="bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                    >
                      <option value="workload">charge =</option>
                      <option value="thermal">CPU ≥ (°C)</option>
                      <option value="power_above">puissance ≥ (W)</option>
                      <option value="battery">sur batterie</option>
                      <option value="idle">inactif ≥</option>
                      <option value="schedule">heure entre</option>
                      <option value="always">toujours (défaut)</option>
                    </select>

                    {rule.condition.kind === "workload" && (
                      <select
                        value={rule.condition.workload}
                        aria-label="Scénario de charge"
                        onChange={(e) =>
                          updateRule(rule.id, {
                            condition: { kind: "workload", workload: e.target.value as WorkloadMode },
                          })
                        }
                        className="bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                      >
                        {(Object.keys(WORKLOAD_META) as WorkloadMode[]).map((wm) => (
                          <option key={wm} value={wm}>
                            {WORKLOAD_META[wm].shortLabel}
                          </option>
                        ))}
                      </select>
                    )}

                    {rule.condition.kind === "idle" && (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={10}
                          max={7200}
                          step={10}
                          value={rule.condition.seconds}
                          aria-label="Durée d'inactivité en secondes"
                          onChange={(e) =>
                            patchCondition(rule, {
                              seconds: Math.max(10, Math.min(7200, Number(e.target.value) || 10)),
                            })
                          }
                          className="w-18 bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px]"
                        />
                        s
                      </span>
                    )}

                    {rule.condition.kind === "schedule" && (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={rule.condition.from}
                          aria-label="Heure de début"
                          onChange={(e) => patchCondition(rule, { from: clampHour(e.target.value) })}
                          className="w-13 bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px]"
                        />
                        h →
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={rule.condition.to}
                          aria-label="Heure de fin"
                          onChange={(e) => patchCondition(rule, { to: clampHour(e.target.value) })}
                          className="w-13 bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px]"
                        />
                        h
                      </span>
                    )}

                    {rule.condition.kind === "thermal" && (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={50}
                          max={100}
                          value={rule.condition.tempC}
                          aria-label="Seuil de température CPU en degrés Celsius"
                          onChange={(e) =>
                            patchCondition(rule, {
                              tempC: Math.max(50, Math.min(100, Number(e.target.value) || 85)),
                            })
                          }
                          className="w-15 bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px]"
                        />
                        °C (hyst. −5°C)
                      </span>
                    )}

                    {rule.condition.kind === "power_above" && (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={25}
                          max={450}
                          step={5}
                          value={rule.condition.watts}
                          aria-label="Seuil de puissance système en Watts"
                          onChange={(e) =>
                            patchCondition(rule, {
                              watts: Math.max(25, Math.min(450, Number(e.target.value) || 110)),
                            })
                          }
                          className="w-16 bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px]"
                        />
                        W
                      </span>
                    )}

                    <span className="text-slate-500">→</span>
                    <select
                      value={rule.target}
                      aria-label="Profil cible"
                      onChange={(e) => updateRule(rule.id, { target: Number(e.target.value) as ProfileSlotId })}
                      className="bg-[#0C1017] border border-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          P{p.id} — {p.name}
                        </option>
                      ))}
                    </select>

                    <label className="inline-flex items-center gap-1 cursor-pointer text-slate-400">
                      <input
                        type="checkbox"
                        checked={rule.protect}
                        onChange={(e) => updateRule(rule.id, { protect: e.target.checked })}
                        className="accent-amber-500 cursor-pointer"
                      />
                      Ne jamais brider
                    </label>
                  </div>

                  {shadowReason && (
                    <div className="pl-6 text-[10px] text-amber-300 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{shadowReason}</span>
                    </div>
                  )}
                </li>
              );
            })}
            {ad.rules.length === 0 && (
              <li className="text-[11px] text-slate-500">
                Aucune règle configurée : le mode intelligent conservera toujours votre profil actuel.
              </li>
            )}
          </ul>
        </section>
      </div>

      {/* 3b. MATRICE DE VÉRIFICATION : QUE FAIT VOTRE POLITIQUE SELON LA SITUATION ? */}
      <section className="rounded-xl border border-slate-800 bg-[#141922] overflow-hidden">
        <div className="px-4 py-2.5 bg-[#10151E] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-100">
            Aperçu en 7 situations : quand votre configuration économise (et quand elle s'abstient)
          </h3>
          <span className="font-mono text-[10px] text-slate-400">
            {hardware.label} · jeton {privilege === "admin" ? "Admin" : "User"} · budget +{ad.budgetMs} ms
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-slate-800/80 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 px-3.5 font-medium">Situation réelle</th>
                <th className="py-2 px-3 font-medium">Décision</th>
                <th className="py-2 px-3 font-medium">Profil retenu</th>
                <th className="py-2 px-3 font-medium">Règle déclenchée</th>
                <th className="py-2 px-3 font-medium text-right">Gain vs Stock</th>
                <th className="py-2 px-3.5 font-medium text-right">Impact UI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {scenarioMatrix.map((sc) => {
                const verdictCls =
                  sc.verdict === "Économise"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : sc.verdict === "Protégé 100 %"
                    ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
                    : sc.verdict === "Refroidit"
                    ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                    : sc.verdict === "Équilibré"
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/30";
                return (
                  <tr key={sc.id} className="hover:bg-[#181F2B]">
                    <td className="py-2 px-3.5">
                      <div className="font-medium text-slate-200">{sc.label}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{sc.contextHint}</div>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${verdictCls}`}>
                        {sc.verdict}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-200">
                      P{sc.chosenSlot} <span className="font-sans text-slate-400">{sc.chosenName}</span>
                    </td>
                    <td className="py-2 px-3 text-[11px] text-slate-400">{sc.ruleLabel}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      {sc.savedWattsVsStock >= 0.5 ? (
                        <span className="text-emerald-300 font-semibold">−{sc.savedWattsVsStock.toFixed(1)} W</span>
                      ) : (
                        <span className="text-slate-500">0 W (plein régime)</span>
                      )}
                    </td>
                    <td className="py-2 px-3.5 text-right font-mono tabular-nums text-slate-300">
                      +{sc.uiDeltaMsVsStock.toFixed(1)} ms
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. PRÉFÉRENCE INFOBULLES + JOURNAL DE DÉCISIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-sky-400" /> Infobulles détaillées
            </h3>
            <button
              type="button"
              role="switch"
              aria-checked={settings.tooltips}
              aria-label="Activer ou désactiver toutes les infobulles techniques"
              onClick={() => onSetTooltips(!settings.tooltips)}
              className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                settings.tooltips ? "bg-emerald-500" : "bg-slate-700"
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                  settings.tooltips ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {settings.tooltips
              ? "Activées : chaque paramètre affiche l'API Win32, la loi physique CMOS, l'effet Avant/Après et la garantie de sûreté."
              : "Désactivées : interface épurée sans icônes « ? » ni bulles au survol (idéal une fois les réglages maîtrisés)."}
          </p>
          <p className="text-[10px] text-slate-500 font-mono">
            Raccourci direct partout : touche <kbd className="px-1 py-0.2 rounded bg-slate-800 text-slate-200">T</kbd>
          </p>
        </section>

        <section className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-amber-300" /> Journal explicatif des décisions ({log.length})
            </h3>
            {log.length > 0 && (
              <button
                type="button"
                onClick={onClearLog}
                className="text-[10.5px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Vider
              </button>
            )}
          </div>
          {log.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Activez le mode intelligent puis utilisez le simulateur ci-dessus (ex. « 2 min+ », « Sim. Batterie » ou « Jeu / 3D ») pour observer ses décisions.
            </p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto font-mono text-[10.5px]">
              {log.map((entry) => (
                <li key={entry.id} className="flex gap-2 text-slate-300">
                  <span className="text-slate-500 shrink-0">{entry.at}</span>
                  <span className="min-w-0">{entry.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

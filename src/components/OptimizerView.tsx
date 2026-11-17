import React from "react";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Flame,
  Lock,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Wind,
  Zap,
} from "lucide-react";
import {
  HardwareConfig,
  HardwareProfile,
  OptimizationProposal,
  OptimizerGoal,
  PrivilegeLevel,
  WorkloadMode,
} from "../types/hardware";
import { cpuVoltageAtFreq } from "../engine/physics";
import { buildBudgetPlan } from "../engine/optimizer";
import { TechTooltip } from "./TechTooltip";

interface OptimizerViewProps {
  goal: OptimizerGoal;
  onChangeGoal: (g: OptimizerGoal) => void;
  proposals: OptimizationProposal[];
  currentConfig: HardwareConfig;
  hardware: HardwareProfile;
  workload: WorkloadMode;
  privilege: PrivilegeLevel;
  budgetMs: number;
  onChangeBudgetMs: (ms: number) => void;
  onApplyOne: (p: OptimizationProposal) => void;
  onApplyAll: (onlyUserSafe: boolean) => void;
  onApplySelection: (proposals: OptimizationProposal[]) => void;
  onRequestAdmin: () => void;
}

const GOAL_INFO: { id: OptimizerGoal; title: string; subtitle: string; targetFreq: number }[] = [
  {
    id: "pareto",
    title: "Optimum Pareto (Recommandé)",
    subtitle: "Max de Watts économisés par ms (Bureau, Web, Dev, Vidéo)",
    targetFreq: 3300,
  },
  {
    id: "silent",
    title: "Silence Absolu (< 21 dBA)",
    subtitle: "Ventilation minimale + GPU 0 RPM permanent (Nuit, Audio)",
    targetFreq: 2100,
  },
  {
    id: "gaming_eco",
    title: "Jeu & Création Frais (120 Hz)",
    subtitle: "~92% des FPS conservés, -80 W de chaleur inutile",
    targetFreq: 4200,
  },
  {
    id: "server_24_7",
    title: "Veille Active / Serveur 24h/24",
    subtitle: "Consommation plancher absolue (Cloud, NAS, Téléchargement)",
    targetFreq: 1200,
  },
];

export const OptimizerView: React.FC<OptimizerViewProps> = ({
  goal,
  onChangeGoal,
  proposals,
  currentConfig,
  hardware,
  workload,
  privilege,
  budgetMs,
  onChangeBudgetMs,
  onApplyOne,
  onApplyAll,
  onApplySelection,
  onRequestAdmin,
}) => {
  const isAdmin = privilege === "admin";
  const activeGoalMeta = GOAL_INFO.find((g) => g.id === goal)!;
  const plan = buildBudgetPlan(proposals, currentConfig, workload, budgetMs, hardware, true);
  const userPlan = buildBudgetPlan(proposals, currentConfig, workload, budgetMs, hardware, false);

  // Courbe CMOS P(f) = C * V(f)^2 * f pour visualiser le "genou" (sweet-spot)
  const chartW = 540;
  const chartH = 155;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const fMin = hardware.cpuFreqMinMhz;
  const fMax = hardware.cpuFreqMaxMhz;
  const kneeMhz = Math.round(fMin + (fMax - fMin) * 0.68);
  const effectiveTargetFreq = Math.min(fMax, Math.max(fMin, activeGoalMeta.targetFreq));
  const clampedCurrentFreq = Math.min(fMax, Math.max(fMin, currentConfig.cpuFreqCapMhz));

  const relPower = (mhz: number) => {
    const v = cpuVoltageAtFreq(mhz);
    const vMax = cpuVoltageAtFreq(fMax);
    return ((v * v * mhz) / Math.max(1, vMax * vMax * fMax)) * 100;
  };

  const toXY = (mhz: number) => {
    const x = padL + ((mhz - fMin) / Math.max(100, fMax - fMin)) * innerW;
    const p = relPower(mhz);
    const y = padT + innerH - (p / 100) * innerH;
    return { x, y, p };
  };

  const samples: number[] = [];
  for (let f = fMin; f <= fMax; f += 100) samples.push(f);
  if (samples[samples.length - 1] !== fMax) samples.push(fMax);
  const curvePath = samples
    .map((f, idx) => {
      const pt = toXY(f);
      return `${idx === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(" ");

  const stockPt = toXY(fMax);
  const currentPt = toXY(clampedCurrentFreq);
  const targetPt = toXY(effectiveTargetFreq);
  const xTicks = [1000, 2000, 3000, 4000, 5000].filter((f) => f >= fMin && f <= fMax);

  const hasAdminProposals = proposals.some((p) => p.requiresAdmin);
  const userOnlyCount = proposals.filter((p) => !p.requiresAdmin).length;

  return (
    <div className="space-y-4">
      {/* Sélecteur d'objectif d'usage */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <TechTooltip tooltipKey="optimizer_pareto">
              <h2 className="text-sm font-semibold text-white">
                Conseiller de Configuration Optimisée & Justification Physique (« Pourquoi »)
              </h2>
            </TechTooltip>
          </div>

          {proposals.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {!isAdmin && hasAdminProposals && userOnlyCount > 0 && (
                <button
                  type="button"
                  onClick={() => onApplyAll(true)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-emerald-300 cursor-pointer"
                >
                  User seuls ({userPlan.selected.length} · -{userPlan.totalSavedWatts.toFixed(0)} W)
                </button>
              )}
              <button
                type="button"
                onClick={() => onApplyAll(false)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-slate-300 cursor-pointer"
                title="Appliquer toutes les propositions, sans tenir compte du budget de latence."
              >
                Tout ({proposals.length})
              </button>
              <button
                type="button"
                disabled={plan.selected.length === 0}
                onClick={() => {
                  onApplySelection(plan.selected);
                  if (!isAdmin && plan.selected.some((p) => p.requiresAdmin)) onRequestAdmin();
                }}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Appliquer uniquement les optimisations qui tiennent dans le budget de latence."
              >
                <Zap className="w-3.5 h-3.5" />
                <span>
                  Sélection optimale ({plan.selected.length}) · -{plan.totalSavedWatts.toFixed(0)} W · +
                  {plan.totalLatencyMs.toFixed(2)} ms
                </span>
                {!isAdmin && plan.selected.some((p) => p.requiresAdmin) ? " + UAC" : ""}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {GOAL_INFO.map((g) => {
            const active = goal === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onChangeGoal(g.id)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  active
                    ? "bg-emerald-500/15 border-emerald-500/60 text-white"
                    : "bg-[#0F131B] border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <div className="text-xs font-semibold">{g.title}</div>
                <div className="text-[10.5px] text-slate-400 mt-0.5 leading-snug">{g.subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Budget de latence : optimisation sous contrainte */}
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/12 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Budget de latence accepté (optimisation sous contrainte)
              <TechTooltip tooltipKey="optimizer_pareto" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-white tabular-nums">{budgetMs.toFixed(1)} ms</span>
              <div className="inline-flex rounded bg-[#0C1017] border border-slate-700 p-0.5">
                {[0.5, 1, 3, 5, 10].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onChangeBudgetMs(v)}
                    aria-pressed={Math.abs(budgetMs - v) < 0.01}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                      Math.abs(budgetMs - v) < 0.01 ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="block">
            <span className="sr-only">Budget maximal de latence ajoutée en millisecondes</span>
            <input
              type="range"
              min={0.2}
              max={10}
              step={0.1}
              value={budgetMs}
              onChange={(e) => onChangeBudgetMs(Number(e.target.value))}
              className="eco-slider w-full"
              aria-valuetext={`${budgetMs.toFixed(1)} millisecondes`}
            />
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-[10.5px]">
            <div className="rounded bg-[#0C1017] border border-slate-800 px-2 py-1">
              <div className="text-slate-500">Retenues</div>
              <div className="text-slate-100 font-semibold">{plan.selected.length} / {proposals.length}</div>
            </div>
            <div className="rounded bg-[#0C1017] border border-slate-800 px-2 py-1">
              <div className="text-slate-500">Économie</div>
              <div className="text-emerald-300 font-semibold">-{plan.totalSavedWatts.toFixed(1)} W</div>
            </div>
            <div className="rounded bg-[#0C1017] border border-slate-800 px-2 py-1">
              <div className="text-slate-500">Latence cumulée</div>
              <div className="text-sky-300 font-semibold">+{plan.totalLatencyMs.toFixed(2)} ms</div>
            </div>
            <div className="rounded bg-[#0C1017] border border-slate-800 px-2 py-1">
              <div className="text-slate-500">Bruit / chaleur</div>
              <div className="text-indigo-300 font-semibold">-{plan.totalNoiseDropDba.toFixed(1)} dBA · -{plan.totalTempDropC.toFixed(0)}°C</div>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 leading-snug">
            Sac-à-dos glouton par ratio Watts/ms, puis recalcul exact de l'effet combiné des patchs.
            {plan.deferred.length > 0 && (
              <span className="text-amber-300"> {plan.deferred.length} proposition(s) différée(s) car hors budget ou bloquée(s) par les droits.</span>
            )}
            {!isAdmin && userPlan.adminBlockedCount > 0 && (
              <span className="text-slate-500"> {userPlan.adminBlockedCount} réglage(s) Admin nécessitent l'élévation UAC.</span>
            )}
          </p>
        </div>
      </div>

      {/* Courbe pédagogique non-linéaire V/F/P : pourquoi underclocker marche si bien */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        <div className="lg:col-span-7 rounded-lg bg-[#0C1017] border border-slate-800 p-2.5">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-36 overflow-visible">
            {/* Zone rouge de gaspillage exponentiel (au-delà du coude V/F du CPU actif) */}
            <rect
              x={toXY(kneeMhz).x}
              y={padT}
              width={Math.max(0, padL + innerW - toXY(kneeMhz).x)}
              height={innerH}
              fill="#F43F5E"
              opacity="0.07"
            />
            <text x={toXY(kneeMhz).x + 6} y={padT + 12} fill="#FDA4AF" fontSize="9">
              Zone survoltée (V² explose)
            </text>

            {/* Grille */}
            {[0, 25, 50, 75, 100].map((pct) => {
              const y = padT + innerH - (pct / 100) * innerH;
              return (
                <g key={pct}>
                  <line x1={padL} x2={padL + innerW} y1={y} y2={y} stroke="#1D2532" strokeWidth="1" />
                  <text x={padL - 5} y={y + 3} fill="#64748B" fontSize="8.5" textAnchor="end" fontFamily="JetBrains Mono">
                    {pct}%
                  </text>
                </g>
              );
            })}

            {xTicks.map((f) => {
              const x = toXY(f).x;
              return (
                <text key={f} x={x} y={chartH - 6} fill="#64748B" fontSize="8.5" textAnchor="middle">
                  {(f / 1000).toFixed(0)} GHz
                </text>
              );
            })}

            {/* Courbe P = C * V^2 * f */}
            <path d={curvePath} fill="none" stroke="#475569" strokeWidth="2.2" />

            {/* Point Stock */}
            <circle cx={stockPt.x} cy={stockPt.y} r="4.5" fill="#FB7185" />
            <text x={stockPt.x - 6} y={stockPt.y - 6} fill="#FDA4AF" fontSize="8.5" textAnchor="end">
              Turbo {(fMax / 1000).toFixed(1)}G (100% W)
            </text>

            {/* Point Cible recommandée */}
            <circle cx={targetPt.x} cy={targetPt.y} r="5.5" fill="#10B981" stroke="#052E16" strokeWidth="1.5" />
            <text
              x={targetPt.x}
              y={targetPt.y - 9}
              fill="#6EE7B7"
              fontSize="9"
              fontWeight="600"
              textAnchor="middle"
            >
              Cible {(effectiveTargetFreq / 1000).toFixed(1)}G ({targetPt.p.toFixed(0)}% W !)
            </text>

            {/* Point Actuel si différent */}
            {Math.abs(clampedCurrentFreq - effectiveTargetFreq) > 120 && (
              <>
                <circle cx={currentPt.x} cy={currentPt.y} r="4.5" fill="#38BDF8" />
                <text x={currentPt.x} y={currentPt.y + 14} fill="#7DD3FC" fontSize="8.5" textAnchor="middle">
                  Actuel {(clampedCurrentFreq / 1000).toFixed(1)}G ({currentPt.p.toFixed(0)}% W)
                </text>
              </>
            )}
          </svg>
        </div>

        <div className="lg:col-span-5 space-y-2 text-xs">
          <div className="font-semibold text-slate-100 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-emerald-400" />
            Pourquoi la courbe silicium rend l'underclocking si efficace ?
          </div>
          <p className="text-slate-300 leading-relaxed text-[11.5px]">
            Dans un processeur ou GPU CMOS, la puissance dynamique vaut{" "}
            <code className="text-emerald-300">P = α · C · V² · f</code>. Pour passer de{" "}
            <strong>3,3 GHz</strong> ({Math.round(cpuVoltageAtFreq(3300) * 1000)} mV) à{" "}
            <strong>5,2 GHz</strong> ({Math.round(cpuVoltageAtFreq(5200) * 1000)} mV), le constructeur doit augmenter la tension de{" "}
            <strong>+51%</strong> : vous multipliez la chaleur et l'électricité par{" "}
            <strong className="text-rose-300">×3,6</strong> pour seulement <strong>+36%</strong> de fréquence théorique !
          </p>
          <div className="font-mono text-[11px] rounded bg-[#0C1017] border border-slate-800 px-2.5 py-1.5 text-emerald-300 tabular-nums">
            Cible {(effectiveTargetFreq / 1000).toFixed(1)} GHz ={" "}
            {Math.round((effectiveTargetFreq / fMax) * 100)}% du Turbo ({(fMax / 1000).toFixed(1)} GHz) pour seulement{" "}
            {targetPt.p.toFixed(0)}% de la puissance dynamique !
          </div>
        </div>
      </div>

      {/* Liste détaillée des propositions */}
      {proposals.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/20 p-6 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
          <h3 className="text-sm font-semibold text-white">
            Configuration parfaitement optimisée pour l'objectif « {activeGoalMeta.title} » !
          </h3>
          <p className="text-xs text-slate-300 max-w-xl mx-auto">
            Tous les sous-systèmes (CPU, Turbo, EPP, C-States, GPU NVML, VRAM, PCIe ASPM, NVMe APST, Affichage Hz, Réseau EEE, USB et Timer Windows) sont à leur point de rendement optimal. Pensez à cliquer sur <strong>Sauver P#</strong> pour retenir ce profil.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((prop, idx) => {
            const needsUacNow = prop.requiresAdmin && !isAdmin;
            const inBudget = plan.selectedIds.includes(prop.id);
            return (
              <div
                key={prop.id}
                className="rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-3 hover:border-slate-700 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        #{idx + 1} · Score Pareto {prop.efficiencyScore}/100
                      </span>
                      <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {prop.subsystem}
                      </span>
                      {prop.requiresAdmin ? (
                        <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" /> Admin UAC
                        </span>
                      ) : (
                        <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                          Mode User (0 UAC)
                        </span>
                      )}
                      <span
                        className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                          inBudget
                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
                            : "bg-slate-800 text-slate-400 border-slate-700"
                        }`}
                        title={inBudget ? "Retenue par l'optimisation sous budget" : "Différée : dépasse le budget de latence"}
                      >
                        <ShieldCheck className="w-2.5 h-2.5" />
                        {inBudget ? "Dans le budget" : "Hors budget"}
                      </span>
                    </div>
                    <TechTooltip tooltipKey={prop.tooltipKey}>
                      <h3 className="text-sm font-semibold text-white">{prop.title}</h3>
                    </TechTooltip>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onApplyOne(prop);
                      if (needsUacNow) onRequestAdmin();
                    }}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                      needsUacNow
                        ? "bg-amber-500 hover:bg-amber-400 text-slate-950"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    {needsUacNow && <Lock className="w-3 h-3" />}
                    <span>{needsUacNow ? "Appliquer (demander UAC)" : "Appliquer ce réglage"}</span>
                  </button>
                </div>

                {/* Diff Avant -> Proposé */}
                <div className="rounded-lg bg-[#0D1118] border border-slate-800/90 px-3 py-2 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                  <span className="text-slate-400">{prop.currentSummary}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 font-semibold">{prop.proposedSummary}</span>
                </div>

                {/* Explication détaillée du POURQUOI */}
                <div className="space-y-1.5 text-xs leading-relaxed">
                  <p className="text-slate-200">
                    <strong className="text-sky-300">Pourquoi : </strong>
                    {prop.whyTechnical}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded bg-slate-800/40 border border-slate-700/50 px-2.5 py-1.5 text-slate-300">
                      <strong className="text-slate-200">Principe physique :</strong> {prop.physicsLaw}
                    </div>
                    <div className="rounded bg-slate-800/40 border border-slate-700/50 px-2.5 py-1.5 text-slate-300">
                      <strong className="text-slate-200">Ressenti concret :</strong> {prop.realWorldEffect}
                    </div>
                  </div>
                </div>

                {/* Puces chiffrées des gains */}
                <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] tabular-nums">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                    <Zap className="w-3 h-3" /> -{prop.savedWatts.toFixed(1)} W (-{prop.savedWallWatts.toFixed(1)} W prise)
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/25">
                    <Flame className="w-3 h-3" /> -{prop.tempDropC.toFixed(1)} °C
                  </span>
                  {(prop.fanDropRpm > 0 || prop.noiseDropDba > 0) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                      <Wind className="w-3 h-3" /> -{prop.fanDropRpm} RPM (-{prop.noiseDropDba.toFixed(1)} dBA)
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    <Timer className="w-3 h-3 text-slate-400" /> +{prop.latencyDeltaMs.toFixed(2)} ms ({prop.latencyContext})
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

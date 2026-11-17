import React, { useState } from "react";
import {
  Activity,
  ArrowRight,
  Cpu,
  Gauge,
  HardDrive,
  Lock,
  Monitor,
  Sparkles,
  Terminal,
  Unlock,
} from "lucide-react";
import {
  ActiveTab,
  ApiLogEntry,
  BenchmarkMetric,
  DisplayRefreshHz,
  GpuVramPolicy,
  HardwareConfig,
  HardwareProfile,
  NvmeApstMode,
  OptimizationProposal,
  PcieAspmMode,
  PrivilegeLevel,
  SataAlpmMode,
  TelemetrySnapshot,
  TimerResolutionPolicy,
  TurboBoostMode,
  WifiPowerMode,
} from "../types/hardware";
import { cpuVoltageAtFreq, gpuVoltageAtFreq } from "../engine/physics";
import { TechTooltip } from "./TechTooltip";

type SubGroup = "cpu" | "gpu" | "bus_storage" | "io_display";

interface SubsystemControlsProps {
  config: HardwareConfig;
  hardware: HardwareProfile;
  beforeTel: TelemetrySnapshot;
  afterTel: TelemetrySnapshot;
  benchmarks: BenchmarkMetric[];
  topProposals: OptimizationProposal[];
  powerHistory: { before: number; after: number }[];
  apiLogs: ApiLogEntry[];
  privilege: PrivilegeLevel;
  unlockedAdminExtraW: number;
  onUpdateConfig: <K extends keyof HardwareConfig>(key: K, value: HardwareConfig[K], apiDesc: string, needsAdmin?: boolean) => void;
  onApplyProposal: (p: OptimizationProposal) => void;
  onRequestAdmin: () => void;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const SubsystemControls: React.FC<SubsystemControlsProps> = ({
  config,
  hardware,
  beforeTel,
  afterTel,
  benchmarks,
  topProposals,
  powerHistory,
  apiLogs,
  privilege,
  unlockedAdminExtraW,
  onUpdateConfig,
  onApplyProposal,
  onRequestAdmin,
  onNavigateTab,
}) => {
  const [group, setGroup] = useState<SubGroup>("cpu");

  // Repère mesuré sur Ryzen 9 5900X : le plafond PROCFREQMAX n'a qu'un cran.
  // Affiché seulement sur AMD, et jamais présenté comme une loi pour un autre modèle.
  const isAmd = /AMD|Ryzen/i.test(hardware.cpuName);
  const markerMhz = 3300;
  const freqSpan = Math.max(1, hardware.cpuFreqMaxMhz - hardware.cpuFreqMinMhz);
  const markerRatio = Math.min(1, Math.max(0, (markerMhz - hardware.cpuFreqMinMhz) / freqSpan));
  const isAdmin = privilege === "admin";

  const renderAdminGate = (needsAdmin: boolean) => {
    if (!needsAdmin) {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
          User
        </span>
      );
    }
    if (isAdmin) {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
          <Unlock className="w-2.5 h-2.5" /> Admin actif
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={onRequestAdmin}
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1 transition-colors cursor-pointer"
        title="Cliquer pour demander l'élévation UAC Administrateur et débloquer ce réglage"
      >
        <Lock className="w-2.5 h-2.5" /> Débloquer (UAC)
      </button>
    );
  };

  // Calcul du graphe SVG historique de puissance
  const svgW = 420;
  const svgH = 112;
  const maxW = Math.max(80, ...powerHistory.map((p) => Math.max(p.before, p.after))) * 1.1;
  const toPoint = (idx: number, val: number) => {
    const x = powerHistory.length > 1 ? (idx / (powerHistory.length - 1)) * svgW : 0;
    const y = svgH - 8 - (val / maxW) * (svgH - 18);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const beforePolyline = powerHistory.map((p, i) => toPoint(i, p.before)).join(" ");
  const afterPolyline = powerHistory.map((p, i) => toPoint(i, p.after)).join(" ");
  const afterArea = `0,${svgH} ${afterPolyline} ${svgW},${svgH}`;

  // Répartition des watts après optimisation
  const breakdown = [
    { label: "CPU Pkg", w: afterTel.cpuPackageWatts, color: "bg-emerald-400" },
    { label: "GPU + iGPU", w: afterTel.gpuBoardWatts + afterTel.igpuWatts, color: "bg-sky-400" },
    { label: "Écran", w: afterTel.displayWatts, color: "bg-indigo-400" },
    { label: "PCIe/PCH", w: afterTel.pcieChipsetWatts, color: "bg-amber-400" },
    { label: "NVMe/SATA", w: afterTel.storageWatts, color: "bg-teal-300" },
    { label: "NIC/USB", w: afterTel.nicUsbMiscWatts, color: "bg-slate-400" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* COLONNE GAUCHE : CONTRÔLES DES SOUS-SYSTÈMES (7/12) */}
      <div className="lg:col-span-7 flex flex-col gap-3">
        {/* Bandeau info si en mode User et que le profil a des gains Admin en attente */}
        {!isAdmin && unlockedAdminExtraW > 1.5 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-amber-100">
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Mode <strong>User</strong> actif : les leviers Admin de ce profil (GPU NVML, NVMe APST, PL1) peuvent économiser{" "}
                <strong className="font-mono text-emerald-300">-{unlockedAdminExtraW.toFixed(1)} W</strong> supplémentaires.
              </span>
            </div>
            <button
              type="button"
              onClick={onRequestAdmin}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px] transition-colors cursor-pointer shrink-0"
            >
              Élever en Admin (UAC)
            </button>
          </div>
        )}

        <div className="rounded-xl border border-slate-800 bg-[#141922] overflow-hidden">
          {/* Onglets des 4 familles matérielles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-800 bg-[#10141C]">
            {(
              [
                {
                  id: "cpu" as const,
                  label: "CPU & Noyau",
                  sub: `${afterTel.cpuPackageWatts.toFixed(1)} W · ${afterTel.cpuEffectivePClockMhz} MHz`,
                  icon: Cpu,
                },
                {
                  id: "gpu" as const,
                  label: "GPU & iGPU",
                  sub: `${afterTel.gpuBoardWatts.toFixed(1)} W · ${afterTel.gpuPState}`,
                  icon: Gauge,
                },
                {
                  id: "bus_storage" as const,
                  label: "PCIe & NVMe",
                  sub: `${(afterTel.pcieChipsetWatts + afterTel.storageWatts).toFixed(1)} W · ${afterTel.nvmeTempC.toFixed(0)}°C`,
                  icon: HardDrive,
                },
                {
                  id: "io_display" as const,
                  label: "Écran, Réseau, USB",
                  sub: `${config.displayRefreshHz} Hz · ${(afterTel.displayWatts + afterTel.nicUsbMiscWatts).toFixed(1)} W`,
                  icon: Monitor,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = group === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setGroup(tab.id)}
                  className={`px-3 py-2.5 text-left border-b-2 transition-colors cursor-pointer ${
                    active
                      ? "border-emerald-400 bg-[#161D28] text-white"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#141A24]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon className={`w-3.5 h-3.5 ${active ? "text-emerald-400" : "text-slate-500"}`} />
                    <span className="truncate">{tab.label}</span>
                  </div>
                  <div className="font-mono text-[10px] text-slate-400 mt-0.5 tabular-nums truncate">
                    {tab.sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Contenu du groupe actif */}
          <div className="p-4 space-y-3.5">
            {group === "cpu" && (
              <>
                {/* Plafond fréquence MHz */}
                <ControlRow
                  title="Plafond de fréquence CPU (PROCFREQMAX)"
                  tooltipKey="cpu_freq_cap"
                  extraBeforeAfter={`${beforeTel.cpuEffectivePClockMhz} MHz (${beforeTel.cpuVidMv} mV) → ${afterTel.cpuEffectivePClockMhz} MHz (${afterTel.cpuVidMv} mV)`}
                  badge={renderAdminGate(false)}
                  valueText={`${config.cpuFreqCapMhz} MHz · VID ~${Math.round(cpuVoltageAtFreq(config.cpuFreqCapMhz) * 1000)} mV`}
                >
                  <div className="relative pt-4">
                    {isAmd && (
                      <>
                        <div
                          aria-hidden
                          className="pointer-events-none absolute border-l border-dashed border-amber-400/70"
                          style={{
                            left: `calc(7px + (100% - 15px) * ${markerRatio})`,
                            top: "1rem",
                            height: "6px",
                          }}
                        />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute top-0 -translate-x-1/2 font-mono text-[9px] text-amber-300/90"
                          style={{ left: `calc(7px + (100% - 15px) * ${markerRatio})` }}
                        >
                          3,3 GHz
                        </span>
                      </>
                    )}
                    <input
                      type="range"
                      min={hardware.cpuFreqMinMhz}
                      max={hardware.cpuFreqMaxMhz}
                      step={100}
                      value={config.cpuFreqCapMhz}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        onUpdateConfig("cpuFreqCapMhz", v, `PowerWriteACValueIndex(SUB_PROCESSOR, PROCFREQMAX, ${v})`);
                      }}
                      className="eco-slider w-full block"
                      aria-label="Plafond de fréquence du processeur en MHz"
                      aria-valuetext={`${config.cpuFreqCapMhz} mégahertz`}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                    <span>{hardware.cpuFreqMinMhz} MHz (LFM)</span>
                    <span className="text-emerald-400/80">{Math.round(hardware.cpuBaseMhz * 0.92)} MHz (Sweet-spot)</span>
                    <span>{hardware.cpuFreqMaxMhz} MHz (Turbo)</span>
                  </div>
                  {isAmd ? (
                    <p className="mt-1 text-[10px] leading-snug text-amber-300/80">
                      Repère 3 300 MHz : mesuré sur Ryzen 9 5900X — 2 000 et 3 300 MHz y donnent le même résultat
                      (3 342 MHz, +43 % de temps). Sur d'autres processeurs, un plafond plus bas peut encore agir :
                      c'est un repère, pas une limite.
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] leading-snug text-amber-300/70">
                      Plafond indicatif : le firmware peut l'honorer partiellement. Un refus est compté et signalé,
                      jamais passé sous silence.
                    </p>
                  )}
                </ControlRow>

                {/* Turbo Boost Mode */}
                <ControlRow
                  title="Politique Turbo Boost / Precision Boost"
                  tooltipKey="cpu_turbo"
                  extraBeforeAfter={`Package CPU : ${beforeTel.cpuPackageWatts} W → ${afterTel.cpuPackageWatts} W`}
                  badge={renderAdminGate(false)}
                  valueText={
                    config.cpuTurboMode === "disabled"
                      ? "Désactivé (0 pic Vcore)"
                      : config.cpuTurboMode === "efficient"
                      ? "Efficient Enabled"
                      : "Agressif (Stock)"
                  }
                >
                  <SegmentedButtons<TurboBoostMode>
                    value={config.cpuTurboMode}
                    options={[
                      { value: "disabled", label: "Désactivé (≤ 3,6 GHz)" },
                      { value: "efficient", label: "Efficient (Modéré)" },
                      { value: "aggressive", label: "Agressif (5,2 GHz)" },
                    ]}
                    onChange={(v) =>
                      onUpdateConfig("cpuTurboMode", v, `PowerWriteACValueIndex(SUB_PROCESSOR, PERFBOOSTMODE, "${v}")`)
                    }
                  />
                </ControlRow>

                {/* EPP + État max/min */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ControlRow
                    title="Préférence Énergétique EPP (HWP/CPPC2)"
                    tooltipKey="cpu_epp"
                    badge={renderAdminGate(false)}
                    valueText={`${config.cpuEpp}%`}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={2}
                      value={config.cpuEpp}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        onUpdateConfig("cpuEpp", v, `PowerWriteACValueIndex(SUB_PROCESSOR, PERFEPP, ${v})`);
                      }}
                      className="eco-slider w-full"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
                      <span>0% Perf</span>
                      <span>80% Éco</span>
                      <span>100% Max</span>
                    </div>
                  </ControlRow>

                  <ControlRow
                    title="États Processeur Min / Max (%)"
                    tooltipKey="cpu_max_pct"
                    badge={renderAdminGate(false)}
                    valueText={`${config.cpuMinPercent}% .. ${config.cpuMaxPercent}%`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-400 w-7">Max</span>
                      <input
                        type="range"
                        min={25}
                        max={100}
                        step={1}
                        value={config.cpuMaxPercent}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          onUpdateConfig("cpuMaxPercent", v, `PowerWriteACValueIndex(PROCTHROTTLEMAX, ${v}%)`);
                        }}
                        className="eco-slider flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <TechTooltip tooltipKey="cpu_min_pct" showIcon={false}>
                        <span className="text-[10px] font-mono text-slate-400 w-7">Min</span>
                      </TechTooltip>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={5}
                        value={config.cpuMinPercent}
                        onChange={(e) => {
                          const v = Math.min(config.cpuMaxPercent, Number(e.target.value));
                          onUpdateConfig("cpuMinPercent", v, `PowerWriteACValueIndex(PROCTHROTTLEMIN, ${v}%)`);
                        }}
                        className="eco-slider flex-1"
                      />
                    </div>
                  </ControlRow>
                </div>

                {/* C-States & EcoQoS toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ToggleCard
                    title="C-States profonds (C6 / C8 / C10)"
                    subtitle={`Résidence veille profonde : ${afterTel.cpuCStateDeepPct}%`}
                    tooltipKey="cpu_cstates"
                    checked={config.cpuDeepCStates}
                    onChange={(v) =>
                      onUpdateConfig("cpuDeepCStates", v, `PowerWriteACValueIndex(IDLEDISABLE, ${v ? 0 : 1})`)
                    }
                  />
                  <ToggleCard
                    title="EcoQoS processus d'arrière-plan"
                    subtitle={`Confine le fond sur E-Cores (${afterTel.cpuEffectiveEClockMhz} MHz)`}
                    tooltipKey="bg_ecoqos"
                    checked={config.bgEcoQos}
                    onChange={(v) =>
                      onUpdateConfig(
                        "bgEcoQos",
                        v,
                        `SetProcessInformation(ProcessPowerThrottling, EXEC_SPEED=${v ? 1 : 0})`
                      )
                    }
                  />
                </div>

                {/* Admin CPU : PL1 & Core Parking */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ControlRow
                    title="Plafond Package RAPL PL1 (Watts)"
                    tooltipKey="cpu_pl1"
                    badge={renderAdminGate(true)}
                    valueText={`${config.cpuPl1Watts} W max`}
                    dimmed={!isAdmin}
                  >
                    <input
                      type="range"
                      min={hardware.cpuPl1MinW}
                      max={hardware.cpuPl1MaxW}
                      step={1}
                      disabled={!isAdmin}
                      value={config.cpuPl1Watts}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        onUpdateConfig("cpuPl1Watts", v, `RAPL/DPTF SetPackagePowerLimit1(${v} W)`, true);
                      }}
                      className="eco-slider admin-slider w-full"
                      aria-label="Enveloppe de puissance PL1 du processeur en watts"
                      aria-valuetext={`${config.cpuPl1Watts} watts`}
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
                      <span>{hardware.cpuPl1MinW} W (min constructeur)</span>
                      <span>{Math.round(hardware.cpuTdpW * 0.36)} W (Frais)</span>
                      <span>{hardware.cpuPl1MaxW} W TDP</span>
                    </div>
                  </ControlRow>

                  <ControlRow
                    title="Core Parking (Cœurs actifs min)"
                    tooltipKey="cpu_core_parking"
                    badge={renderAdminGate(true)}
                    valueText={`${afterTel.cpuActiveCores}/${afterTel.cpuTotalCores} actifs (${config.cpuCoreParkingMinActive}%)`}
                    dimmed={!isAdmin}
                  >
                    <input
                      type="range"
                      min={12}
                      max={100}
                      step={4}
                      disabled={!isAdmin}
                      value={config.cpuCoreParkingMinActive}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        onUpdateConfig("cpuCoreParkingMinActive", v, `PowerWriteACValueIndex(CPMINCORES, ${v}%)`, true);
                      }}
                      className="eco-slider admin-slider w-full"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
                      <span>12% (2 cœurs)</span>
                      <span>50%</span>
                      <span>100% (0 parqué)</span>
                    </div>
                  </ControlRow>
                </div>
              </>
            )}

            {group === "gpu" && (
              <>
                {!hardware.hasDedicatedGpu && (
                  <div className="rounded-lg bg-sky-500/10 border border-sky-500/30 px-3 py-2 text-[11px] text-sky-100">
                    <strong>Circuit intégré uniquement ({hardware.gpuName})</strong> : les leviers NVML de carte dédiée sont désactivés. Agissez sur <strong>Sobriété iGPU (RC6)</strong> ci-dessous et sur l'onglet <strong>CPU & Noyau</strong>.
                  </div>
                )}
                <ControlRow
                  title={`GPU Power Management Limit (% du TDP ${hardware.gpuTdpW} W)`}
                  tooltipKey="gpu_power_limit"
                  extraBeforeAfter={`${beforeTel.gpuBoardWatts} W (${beforeTel.gpuTempC}°C) → ${afterTel.gpuBoardWatts} W (${afterTel.gpuTempC}°C)`}
                  badge={renderAdminGate(true)}
                  valueText={
                    hardware.hasDedicatedGpu
                      ? `${config.gpuPowerLimitPct}% (${Math.round((hardware.gpuTdpW * config.gpuPowerLimitPct) / 100)} W max)`
                      : "N/A (iGPU seul)"
                  }
                  dimmed={!isAdmin || !hardware.hasDedicatedGpu}
                >
                  <input
                    type="range"
                    min={hardware.gpuMinPowerPct}
                    max={100}
                    step={1}
                    disabled={!isAdmin || !hardware.hasDedicatedGpu}
                    value={config.gpuPowerLimitPct}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const mw = Math.round(hardware.gpuTdpW * 10 * v);
                      onUpdateConfig("gpuPowerLimitPct", v, `nvmlDeviceSetPowerManagementLimit(dev0, ${mw} mW)`, true);
                    }}
                    className="eco-slider admin-slider w-full"
                    aria-label="Limite de puissance de la carte graphique en pourcentage du TDP"
                    aria-valuetext={`${config.gpuPowerLimitPct} pour cent`}
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                    <span>{hardware.gpuMinPowerPct}% ({Math.round((hardware.gpuTdpW * hardware.gpuMinPowerPct) / 100)} W min VBIOS)</span>
                    <span className="text-emerald-400/80">70% ({Math.round(hardware.gpuTdpW * 0.7)} W · ~91% FPS)</span>
                    <span>100% ({hardware.gpuTdpW} W)</span>
                  </div>
                </ControlRow>

                <ControlRow
                  title="Plafond d'horloge cœur GPU (Locked Clocks 210..Max MHz)"
                  tooltipKey="gpu_clock_cap"
                  extraBeforeAfter={`${beforeTel.gpuEffectiveCoreMhz} MHz (${beforeTel.gpuVoltageMv} mV) → ${afterTel.gpuEffectiveCoreMhz} MHz (${afterTel.gpuVoltageMv} mV)`}
                  badge={renderAdminGate(true)}
                  valueText={`${config.gpuCoreClockCapMhz} MHz · Vgpu ~${Math.round(gpuVoltageAtFreq(config.gpuCoreClockCapMhz) * 1000)} mV`}
                  dimmed={!isAdmin}
                >
                  <input
                    type="range"
                    min={hardware.gpuMinClockMhz}
                    max={hardware.gpuMaxClockMhz}
                    step={30}
                    disabled={!isAdmin || !hardware.hasDedicatedGpu}
                    value={config.gpuCoreClockCapMhz}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onUpdateConfig("gpuCoreClockCapMhz", v, `nvmlDeviceSetGpuLockedClocks(dev0, 210, ${v})`, true);
                    }}
                    className="eco-slider admin-slider w-full"
                    aria-label="Plafond d'horloge du cœur graphique en MHz"
                    aria-valuetext={`${config.gpuCoreClockCapMhz} mégahertz`}
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                    <span>{hardware.gpuMinClockMhz} MHz</span>
                    <span>~{Math.round(hardware.gpuMaxClockMhz * 0.67)} MHz (0,82V)</span>
                    <span>{hardware.gpuMaxClockMhz} MHz max</span>
                  </div>
                </ControlRow>

                <ControlRow
                  title="Politique d'états mémoire GDDR6 (P8 / P5 / P0)"
                  tooltipKey="gpu_vram_policy"
                  extraBeforeAfter={`VRAM effective : ${beforeTel.gpuEffectiveVramMhz} MHz → ${afterTel.gpuEffectiveVramMhz} MHz (${afterTel.gpuPState})`}
                  badge={renderAdminGate(true)}
                  valueText={`Actuel : ${afterTel.gpuPState} · ${afterTel.gpuEffectiveVramMhz} MHz`}
                  dimmed={!isAdmin}
                >
                  <SegmentedButtons<GpuVramPolicy>
                    disabled={!isAdmin}
                    value={config.gpuVramPolicy}
                    options={[
                      { value: "force_p8_idle", label: "Forcer P8 Repos (405 MHz)" },
                      { value: "prefer_p5", label: "Équilibré P5 (Éco 3D)" },
                      { value: "auto", label: "Auto Pilote (Stock)" },
                    ]}
                    onChange={(v) =>
                      onUpdateConfig("gpuVramPolicy", v, `nvmlSetMemoryPStatePolicy(dev0, "${v}")`, true)
                    }
                  />
                </ControlRow>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ToggleCard
                    title="Semi-passif 0 RPM Fan-Stop (< 52°C)"
                    subtitle={
                      !hardware.hasDedicatedGpu
                        ? "Pas de ventilateur GPU dédié (refroidi par le CPU)"
                        : afterTel.gpuFanRpm === 0
                        ? `Ventilateurs GPU À L'ARRÊT (0 RPM · ${afterTel.gpuTempC}°C)`
                        : `Ventilateurs GPU : ${afterTel.gpuFanRpm} RPM (${afterTel.gpuTempC}°C)`
                    }
                    tooltipKey="gpu_zero_rpm"
                    checked={hardware.hasDedicatedGpu ? config.gpuZeroRpmFanStop : false}
                    disabled={!hardware.hasDedicatedGpu}
                    onChange={(v) =>
                      onUpdateConfig("gpuZeroRpmFanStop", v, `nvmlDeviceSetFanControlPolicy(AUTO_ZERO_RPM=${v})`)
                    }
                  />
                  <ToggleCard
                    title="Sobriété iGPU (Intel GT / Radeon iGPU)"
                    subtitle={`Consommation circuit intégré : ${afterTel.igpuWatts.toFixed(1)} W (RC6)`}
                    tooltipKey="igpu_eco"
                    checked={config.igpuEcoClock}
                    onChange={(v) =>
                      onUpdateConfig("igpuEcoClock", v, `PowerWriteACValueIndex(SUB_IGPU, BIAS=${v ? "MAX_BATTERY" : "PERF"})`)
                    }
                  />
                </div>
              </>
            )}

            {group === "bus_storage" && (
              <>
                <ControlRow
                  title="PCIe ASPM (Active State Power Management)"
                  tooltipKey="pcie_aspm"
                  extraBeforeAfter={`${beforeTel.pcieCurrentLink} → ${afterTel.pcieCurrentLink} (${afterTel.pcieChipsetWatts} W)`}
                  badge={renderAdminGate(config.pcieAspm === "l1_substates")}
                  valueText={afterTel.pcieCurrentLink}
                >
                  <SegmentedButtons<PcieAspmMode>
                    value={config.pcieAspm}
                    options={[
                      { value: "off", label: "OFF (L0 fixe)" },
                      { value: "l0s", label: "L0s Modéré" },
                      { value: "l1", label: "L1 Éco (User)" },
                      { value: "l1_substates", label: "L1.2 CLKREQ# (Max)" },
                    ]}
                    onChange={(v) => {
                      if (v === "l1_substates" && !isAdmin) {
                        onUpdateConfig("pcieAspm", "l1", `PowerWriteACValueIndex(SUB_PCIEXPRESS, ASPM, L1_USER_FALLBACK)`);
                        onRequestAdmin();
                        return;
                      }
                      onUpdateConfig("pcieAspm", v, `PowerWriteACValueIndex(SUB_PCIEXPRESS, ASPM, "${v}")`, v === "l1_substates");
                    }}
                  />
                </ControlRow>

                <ControlRow
                  title="SSD NVMe APST (Transition Autonome d'États d'Énergie)"
                  tooltipKey="nvme_apst"
                  extraBeforeAfter={`NVMe : ${beforeTel.nvmeTempC}°C → ${afterTel.nvmeTempC}°C | État : ${afterTel.nvmeCurrentState}`}
                  badge={renderAdminGate(true)}
                  valueText={`${afterTel.nvmeCurrentState} · ${afterTel.nvmeTempC}°C`}
                  dimmed={!isAdmin}
                >
                  <SegmentedButtons<NvmeApstMode>
                    disabled={!isAdmin}
                    value={config.nvmeApst}
                    options={[
                      { value: "ps0_only", label: "PS0 (5,5 W)" },
                      { value: "ps1_light", label: "PS1 (2,2 W)" },
                      { value: "ps3_balanced", label: "PS3 (50 mW)" },
                      { value: "ps4_deep", label: "PS4 (5 mW)" },
                    ]}
                    onChange={(v) =>
                      onUpdateConfig("nvmeApst", v, `PowerWriteACValueIndex(SUB_DISK, NVME_APST, "${v}")`, true)
                    }
                  />
                </ControlRow>

                <ControlRow
                  title="Délai d'inactivité NVMe avant mise en veille (ms)"
                  tooltipKey="nvme_timeout"
                  badge={renderAdminGate(true)}
                  valueText={`${config.nvmeIdleTimeoutMs} ms`}
                  dimmed={!isAdmin}
                >
                  <input
                    type="range"
                    min={50}
                    max={1500}
                    step={50}
                    disabled={!isAdmin}
                    value={config.nvmeIdleTimeoutMs}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onUpdateConfig("nvmeIdleTimeoutMs", v, `PowerWriteACValueIndex(SUB_DISK, NVME_IDLE_MS, ${v})`, true);
                    }}
                    className="eco-slider admin-slider w-full"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
                    <span>50 ms (Ultra-sobre)</span>
                    <span>200 ms (Recommandé)</span>
                    <span>1500 ms (Stock)</span>
                  </div>
                </ControlRow>

                <ControlRow
                  title="Lien PHY SATA AHCI (HIPM / DIPM Slumber)"
                  tooltipKey="sata_alpm"
                  badge={renderAdminGate(true)}
                  valueText={config.sataAlpm.toUpperCase()}
                  dimmed={!isAdmin}
                >
                  <SegmentedButtons<SataAlpmMode>
                    disabled={!isAdmin}
                    value={config.sataAlpm}
                    options={[
                      { value: "active", label: "Active (2,9 W)" },
                      { value: "hipm", label: "HIPM Partial (1,3 W)" },
                      { value: "dipm_slumber", label: "DIPM + Slumber (0,4 W)" },
                    ]}
                    onChange={(v) =>
                      onUpdateConfig("sataAlpm", v, `PowerWriteACValueIndex(SUB_DISK, AHCI_ALPM, "${v}")`, true)
                    }
                  />
                </ControlRow>
              </>
            )}

            {group === "io_display" && (
              <>
                <ControlRow
                  title="Fréquence de rafraîchissement écran (Hz + impact VRAM GPU)"
                  tooltipKey="display_hz"
                  extraBeforeAfter={`Écran : ${beforeTel.displayWatts} W → ${afterTel.displayWatts} W | VRAM : ${afterTel.gpuEffectiveVramMhz} MHz`}
                  badge={renderAdminGate(false)}
                  valueText={`${config.displayRefreshHz} Hz (${(1000 / config.displayRefreshHz).toFixed(2)} ms/img)`}
                >
                  <SegmentedButtons<DisplayRefreshHz>
                    value={config.displayRefreshHz}
                    options={[
                      { value: 60 as DisplayRefreshHz, label: "60 Hz (Éco Max)" },
                      { value: 75 as DisplayRefreshHz, label: "75 Hz" },
                      { value: 120 as DisplayRefreshHz, label: "120 Hz (Fluide)" },
                      { value: 165 as DisplayRefreshHz, label: "165 Hz (VRAM P0!)" },
                    ].filter((option) => option.value <= hardware.maxDisplayHz)}
                    onChange={(v) =>
                      onUpdateConfig("displayRefreshHz", v, `ChangeDisplaySettingsExW(CDS_TEST -> ${v} Hz)`)
                    }
                  />
                </ControlRow>

                <ControlRow
                  title="Luminosité matérielle écran (WMI / DDC-CI VCP 0x10)"
                  tooltipKey="display_brightness"
                  badge={renderAdminGate(false)}
                  valueText={`${config.displayBrightnessPct}% (~${Math.round(45 + config.displayBrightnessPct * 3.05)} cd/m²) · ${afterTel.displayWatts} W`}
                >
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={1}
                    value={config.displayBrightnessPct}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onUpdateConfig("displayBrightnessPct", v, `SetVCPFeature(0x10_LUMINANCE, ${v}%)`);
                    }}
                    className="eco-slider w-full"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
                    <span>20% (Nuit 105 cd/m²)</span>
                    <span>45% (Norme sRGB 180 cd/m²)</span>
                    <span>100% (350 cd/m²)</span>
                  </div>
                </ControlRow>

                <ControlRow
                  title="Résolution Timer Noyau Windows & Coalescing d'IRQ"
                  tooltipKey="timer_resolution"
                  badge={renderAdminGate(false)}
                  valueText={
                    config.timerResolution === "coalesced_15_6ms"
                      ? "15,625 ms (64 IRQ/s)"
                      : config.timerResolution === "standard_1ms"
                      ? "1,00 ms (1000 IRQ/s)"
                      : "0,50 ms (2000 IRQ/s)"
                  }
                >
                  <SegmentedButtons<TimerResolutionPolicy>
                    value={config.timerResolution}
                    options={[
                      { value: "coalesced_15_6ms", label: "Coalescé 15,6 ms (C8+)" },
                      { value: "standard_1ms", label: "Standard 1,0 ms" },
                      { value: "high_0_5ms", label: "Forcé 0,5 ms (Gaspille)" },
                    ]}
                    onChange={(v) =>
                      onUpdateConfig(
                        "timerResolution",
                        v,
                        `SetProcessInformation(IGNORE_TIMER_RESOLUTION, "${v}")`
                      )
                    }
                  />
                </ControlRow>

                <ControlRow
                  title="Politique Radio Wi-Fi 802.11 (CAM / Power Save Polling)"
                  tooltipKey="wifi_psp"
                  badge={renderAdminGate(false)}
                  valueText={config.wifiPowerMode.toUpperCase()}
                >
                  <SegmentedButtons<WifiPowerMode>
                    value={config.wifiPowerMode}
                    options={[
                      { value: "max_psp", label: "Max PSP (0,3 W)" },
                      { value: "medium_psp", label: "Medium PSP (0,9 W)" },
                      { value: "cam", label: "CAM Éveil continu (2,6 W)" },
                    ]}
                    onChange={(v) =>
                      onUpdateConfig("wifiPowerMode", v, `PowerWriteACValueIndex(SUB_WIFI, PSM, "${v}")`)
                    }
                  />
                </ControlRow>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ToggleCard
                    title="Suspension Sélective USB (U3)"
                    subtitle="Met en sommeil les ports USB inactifs (< 2,5 mA)"
                    tooltipKey="usb_suspend"
                    checked={config.usbSelectiveSuspend}
                    onChange={(v) =>
                      onUpdateConfig("usbSelectiveSuspend", v, `PowerWriteACValueIndex(SUB_USB, USBSELECTIVE, ${v ? 1 : 0})`)
                    }
                  />
                  <ToggleCard
                    title="Ethernet 802.3az EEE (2.5 GbE LPI)"
                    subtitle={isAdmin ? "Économise ~2,4 W (+0,02 ms ping)" : "Requiert Admin UAC (NDIS OID)"}
                    tooltipKey="nic_eee"
                    checked={isAdmin ? config.nicEeeEnabled : false}
                    requiresAdmin
                    isAdmin={isAdmin}
                    onRequestAdmin={onRequestAdmin}
                    onChange={(v) =>
                      onUpdateConfig("nicEeeEnabled", v, `SetNetAdapterAdvancedProperty(*EEE, ${v ? 1 : 0})`, true)
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Journal d'audit API Windows en direct */}
        <div className="rounded-xl border border-slate-800 bg-[#11151D] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
              <Terminal className="w-3.5 h-3.5 text-sky-400" />
              <span>Journal temps réel des appels FFI Win32 / NVML (zéro pilote noyau)</span>
            </div>
            <span className="font-mono text-[10px] text-slate-500">poll 1 Hz · 0,02% CPU</span>
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto font-mono text-[10.5px]">
            {apiLogs.map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-2 text-slate-400">
                <div className="truncate">
                  <span className="text-slate-600 mr-1.5">{log.timestamp}</span>
                  <span
                    className={`mr-1.5 px-1 rounded text-[9.5px] ${
                      log.privilege === "admin"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {log.privilege.toUpperCase()}
                  </span>
                  <span className="text-slate-200">{log.call}</span>
                </div>
                <span className="text-emerald-400 shrink-0 tabular-nums">{log.latencyUs} µs</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* COLONNE DROITE : TÉLÉMÉTRIE AVANT/APRÈS, EFFETS MS & OPTIMISATIONS RAPIDES (5/12) */}
      <div className="lg:col-span-5 flex flex-col gap-3">
        {/* Oscilloscope de puissance & répartition */}
        <div className="rounded-xl border border-slate-800 bg-[#141922] p-3.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <TechTooltip tooltipKey="kpi_power">
                <span>Télémétrie Puissance (Avant vs Après)</span>
              </TechTooltip>
            </div>
            <div className="flex items-center gap-3 text-[10.5px] font-mono">
              <span className="inline-flex items-center gap-1 text-rose-300/90">
                <span className="w-2.5 h-0.5 bg-rose-400 inline-block" /> Avant {beforeTel.totalSystemWatts}W
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> Après {afterTel.totalSystemWatts}W
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-[#0C1017] border border-slate-800/90 p-2">
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-24 overflow-visible">
              <defs>
                <linearGradient id="ecoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((r) => (
                <line
                  key={r}
                  x1={0}
                  x2={svgW}
                  y1={svgH * r}
                  y2={svgH * r}
                  stroke="#1E2633"
                  strokeDasharray="2 3"
                  strokeWidth={1}
                />
              ))}
              <polygon points={afterArea} fill="url(#ecoFill)" />
              <polyline
                fill="none"
                stroke="#FB7185"
                strokeWidth="1.6"
                strokeDasharray="4 3"
                opacity="0.85"
                points={beforePolyline}
              />
              <polyline fill="none" stroke="#10B981" strokeWidth="2.2" points={afterPolyline} />
            </svg>
          </div>

          {/* Barre empilée de répartition par sous-système */}
          <div className="mt-3 space-y-1.5">
            <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-slate-800">
              {breakdown.map((b) => (
                <div
                  key={b.label}
                  style={{ width: `${Math.max(1.5, (b.w / afterTel.totalSystemWatts) * 100)}%` }}
                  className={`${b.color} transition-all duration-300`}
                  title={`${b.label} : ${b.w.toFixed(1)} W`}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10.5px] font-mono tabular-nums">
              {breakdown.map((b) => (
                <div key={b.label} className="flex items-center justify-between text-slate-400">
                  <span className="inline-flex items-center gap-1 truncate">
                    <span className={`w-2 h-2 rounded-sm ${b.color} shrink-0`} />
                    {b.label}
                  </span>
                  <span className="text-slate-200">{b.w.toFixed(1)}W</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Effets réels en millisecondes (résumé) */}
        <div className="rounded-xl border border-slate-800 bg-[#141922] p-3.5">
          <div className="flex items-center justify-between mb-2">
            <TechTooltip tooltipKey="kpi_latency_ms">
              <span className="text-xs font-semibold text-slate-200">
                Effets en vrai (Temps d'exécution en ms)
              </span>
            </TechTooltip>
            <button
              type="button"
              onClick={() => onNavigateTab("compare")}
              className="text-[11px] text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 font-medium cursor-pointer"
            >
              Tout voir & Bencher <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-1.5">
            {benchmarks.slice(0, 5).map((b) => {
              const deltaPositive = b.deltaMs > 0.05;
              const verdictColor =
                b.humanVerdict === "Imperceptible"
                  ? "text-emerald-400"
                  : b.humanVerdict === "Très léger"
                  ? "text-sky-400"
                  : b.humanVerdict === "Perceptible mais fluide"
                  ? "text-amber-400"
                  : "text-rose-400";
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#0F131B] border border-slate-800/80 text-[11px]"
                >
                  <TechTooltip
                    tooltipKey={b.tooltipKey}
                    extraBeforeAfter={`${b.beforeMs} ms → ${b.afterMs} ms (${b.deltaMs >= 0 ? "+" : ""}${b.deltaMs} ms)`}
                    className="min-w-0"
                  >
                    <span className="text-slate-300 truncate">{b.name}</span>
                  </TechTooltip>
                  <div className="flex items-center gap-2 font-mono text-[10.5px] shrink-0 tabular-nums">
                    <span className="text-slate-500">{b.beforeMs.toFixed(1)}</span>
                    <span className="text-slate-600">→</span>
                    <span className="text-white font-semibold">{b.afterMs.toFixed(1)} ms</span>
                    <span className={`w-16 text-right ${deltaPositive ? verdictColor : "text-emerald-400"}`}>
                      {b.deltaMs >= 0 ? `+${b.deltaMs.toFixed(1)}` : b.deltaMs.toFixed(1)} ms
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Propositions d'optimisation rapides */}
        <div className="rounded-xl border border-slate-800 bg-[#141922] p-3.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <TechTooltip tooltipKey="optimizer_pareto">
                <span>Propositions optimisées</span>
              </TechTooltip>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("optimizer")}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 font-medium cursor-pointer"
            >
              Pourquoi & détails ({topProposals.length}) <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {topProposals.length === 0 ? (
            <div className="rounded-lg bg-emerald-950/30 border border-emerald-500/25 p-3 text-xs text-emerald-200">
              Votre configuration actuelle est déjà sur le <strong>Front de Pareto</strong> optimal ! Tous les gaspillages majeurs sont éliminés.
            </div>
          ) : (
            <div className="space-y-2">
              {topProposals.slice(0, 2).map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg bg-[#0F131B] border border-slate-800 p-2.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[11.5px] font-semibold text-slate-100 leading-snug">
                      {p.title}
                    </div>
                    <button
                      type="button"
                      onClick={() => onApplyProposal(p)}
                      className="px-2 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[10.5px] font-semibold shrink-0 cursor-pointer inline-flex items-center gap-1"
                    >
                      {p.requiresAdmin && !isAdmin && <Lock className="w-2.5 h-2.5" />}
                      Appliquer
                    </button>
                  </div>
                  <p className="text-[10.5px] text-slate-400 line-clamp-2">{p.whyTechnical}</p>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                    <span className="text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      -{p.savedWatts.toFixed(1)} W
                    </span>
                    <span className="text-sky-300 bg-sky-500/10 px-1.5 py-0.5 rounded">
                      -{p.tempDropC.toFixed(1)}°C
                    </span>
                    <span className="text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded">
                      +{p.latencyDeltaMs.toFixed(2)} ms
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* --- Sous-composants ergonomiques internes --- */

interface ControlRowProps {
  title: string;
  tooltipKey: string;
  extraBeforeAfter?: string;
  badge: React.ReactNode;
  valueText: string;
  dimmed?: boolean;
  children: React.ReactNode;
}

const ControlRow: React.FC<ControlRowProps> = ({
  title,
  tooltipKey,
  extraBeforeAfter,
  badge,
  valueText,
  dimmed = false,
  children,
}) => (
  <div
    className={`rounded-lg bg-[#0F131B] border border-slate-800/90 p-3 transition-opacity ${
      dimmed ? "border-slate-800/60" : ""
    }`}
  >
    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
      <div className="flex items-center gap-2">
        <TechTooltip tooltipKey={tooltipKey} extraBeforeAfter={extraBeforeAfter}>
          <span className="text-xs font-medium text-slate-200">{title}</span>
        </TechTooltip>
        {badge}
      </div>
      <span className="font-mono text-xs font-semibold text-emerald-300 tabular-nums">
        {valueText}
      </span>
    </div>
    <div className={dimmed ? "opacity-65" : ""}>{children}</div>
  </div>
);

interface SegmentedButtonsProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

function SegmentedButtons<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedButtonsProps<T>) {
  return (
    <div
      className="grid gap-1.5"
      role="group"
      aria-label="Options mutuellement exclusives"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`px-2 py-1.5 rounded text-[11px] font-medium border transition-colors truncate ${
              disabled ? "cursor-not-allowed opacity-55 " : "cursor-pointer "
            }${
              active
                ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-200"
                : "bg-[#151B26] border-slate-700/70 text-slate-400 hover:text-slate-200 hover:border-slate-600"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface ToggleCardProps {
  title: string;
  subtitle: string;
  tooltipKey: string;
  checked: boolean;
  disabled?: boolean;
  requiresAdmin?: boolean;
  isAdmin?: boolean;
  onRequestAdmin?: () => void;
  onChange: (next: boolean) => void;
}

const ToggleCard: React.FC<ToggleCardProps> = ({
  title,
  subtitle,
  tooltipKey,
  checked,
  disabled = false,
  requiresAdmin = false,
  isAdmin = true,
  onRequestAdmin,
  onChange,
}) => {
  const locked = !disabled && requiresAdmin && !isAdmin;
  return (
    <div className="rounded-lg bg-[#0F131B] border border-slate-800/90 p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <TechTooltip tooltipKey={tooltipKey}>
          <span className="text-xs font-medium text-slate-200">{title}</span>
        </TechTooltip>
        <div className="text-[10.5px] text-slate-400 mt-0.5 truncate">{subtitle}</div>
      </div>
      {locked ? (
        <button
          type="button"
          onClick={onRequestAdmin}
          className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-[10px] font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer"
        >
          <Lock className="w-2.5 h-2.5" /> UAC
        </button>
      ) : (
        <button
          type="button"
          role="switch"
          disabled={disabled}
          aria-checked={checked}
          aria-label={`${title} : ${checked ? "activé" : "désactivé"}`}
          onClick={() => !disabled && onChange(!checked)}
          className={`w-10 h-5.5 rounded-full p-0.5 transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
            disabled ? "opacity-40 cursor-not-allowed " : "cursor-pointer "
          }${checked ? "bg-emerald-500" : "bg-slate-700"}`}
        >
          <span
            className={`block w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-4.5" : "translate-x-0"
            }`}
          />
        </button>
      )}
    </div>
  );
};

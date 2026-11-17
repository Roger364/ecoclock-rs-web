import React, { useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  Euro,
  FlaskConical,
  History,
  Play,
  RefreshCw,
  Square,
  Terminal,
  Timer,
} from "lucide-react";
import {
  BenchmarkMetric,
  BenchRun,
  HardwareProfile,
  Profile,
  ProfileSlotId,
  TelemetrySnapshot,
} from "../types/hardware";
import { CostAssumptions } from "../engine/physics";
import { TechTooltip } from "./TechTooltip";

interface BeforeAfterViewProps {
  profiles: Profile[];
  referenceSlot: "stock" | ProfileSlotId;
  onChangeReferenceSlot: (ref: "stock" | ProfileSlotId) => void;
  activeLabel: string;
  beforeTel: TelemetrySnapshot;
  afterTel: TelemetrySnapshot;
  benchmarks: BenchmarkMetric[];
  lastBenchRunInfo: { measuredHostMs: number; opsPerSec: number; ranAt: string } | null;
  onRunRealBench: () => void;
  cost: CostAssumptions;
  onChangeCost: (next: CostAssumptions) => void;
  hardware: HardwareProfile;
  activeProfileName: string;
  benchRuns: BenchRun[];
  onExportReport: () => void;
  onExportPs1: () => void;
}

interface MetricRow {
  label: string;
  tooltipKey: string;
  beforeStr: string;
  afterStr: string;
  deltaStr: string;
  deltaGood: boolean | "neutral";
}

function fmtDelta(before: number, after: number, unit: string, decimals = 1, lowerIsBetter = true): {
  str: string;
  good: boolean | "neutral";
} {
  const d = after - before;
  if (Math.abs(d) < Math.pow(10, -decimals) * 0.6) {
    return { str: `0 ${unit}`, good: "neutral" };
  }
  const pct = before !== 0 ? Math.round((d / before) * 100) : 0;
  const sign = d > 0 ? "+" : "";
  const pctStr = Math.abs(pct) >= 1 ? ` (${sign}${pct}%)` : "";
  const good = lowerIsBetter ? d < 0 : d > 0;
  return { str: `${sign}${d.toFixed(decimals)} ${unit}${pctStr}`, good };
}

export const BeforeAfterView: React.FC<BeforeAfterViewProps> = ({
  profiles,
  referenceSlot,
  onChangeReferenceSlot,
  activeLabel,
  beforeTel,
  afterTel,
  benchmarks,
  lastBenchRunInfo,
  onRunRealBench,
  cost,
  onChangeCost,
  hardware,
  activeProfileName,
  benchRuns,
  onExportReport,
  onExportPs1,
}) => {
  const [running, setRunning] = useState(false);
  const [protocolChecks, setProtocolChecks] = useState<Record<string, boolean>>({});

  const PROTOCOL_STEPS = [
    "Point de restauration Windows créé et valeurs BIOS notées (PL1/PL2, Turbo).",
    "Profil de référence capturé : baseline_snapshot.toml présent.",
    "Leviers User appliqués, mesure de 10 min sous charge stable.",
    "Élévation UAC accordée, leviers Admin appliqués, mesure répétée.",
    "Aucun événement WHEA ni throttling thermique dans l'Observateur d'événements.",
    "Écarts de temps réels vérifiés (< 16,7 ms image 60 Hz, < 50 ms interaction).",
    "Décision prise : sauvegarder le profil, ajuster, ou restaurer Stock.",
  ];
  const checkedCount = PROTOCOL_STEPS.filter((s) => protocolChecks[s]).length;

  const triggerBench = () => {
    setRunning(true);
    window.setTimeout(() => {
      onRunRealBench();
      setRunning(false);
    }, 90);
  };

  const sections: { title: string; rows: MetricRow[] }[] = [
    {
      title: "1. Puissances Électriques par Rail (DC & Prise Murale AC 230V)",
      rows: [
        {
          label: "Prise murale 230V AC (alim 80+ Gold + écran)",
          tooltipKey: "kpi_power",
          beforeStr: `${beforeTel.psuWallWatts.toFixed(1)} W`,
          afterStr: `${afterTel.psuWallWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.psuWallWatts, afterTel.psuWallWatts, "W")),
        },
        {
          label: "Total composants système (DC)",
          tooltipKey: "kpi_power",
          beforeStr: `${beforeTel.totalSystemWatts.toFixed(1)} W`,
          afterStr: `${afterTel.totalSystemWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.totalSystemWatts, afterTel.totalSystemWatts, "W")),
        },
        {
          label: "CPU Package (Cœurs P+E + Uncore/IMC)",
          tooltipKey: "cpu_pl1",
          beforeStr: `${beforeTel.cpuPackageWatts.toFixed(1)} W`,
          afterStr: `${afterTel.cpuPackageWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.cpuPackageWatts, afterTel.cpuPackageWatts, "W")),
        },
        {
          label: "Carte graphique dédiée (GPU + GDDR6 + VRM)",
          tooltipKey: "gpu_power_limit",
          beforeStr: `${beforeTel.gpuBoardWatts.toFixed(1)} W`,
          afterStr: `${afterTel.gpuBoardWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.gpuBoardWatts, afterTel.gpuBoardWatts, "W")),
        },
        {
          label: "Circuit graphique intégré (iGPU / GT)",
          tooltipKey: "igpu_eco",
          beforeStr: `${beforeTel.igpuWatts.toFixed(1)} W`,
          afterStr: `${afterTel.igpuWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.igpuWatts, afterTel.igpuWatts, "W")),
        },
        {
          label: "Bus PCIe SerDes & Chipset PCH",
          tooltipKey: "pcie_aspm",
          beforeStr: `${beforeTel.pcieChipsetWatts.toFixed(1)} W`,
          afterStr: `${afterTel.pcieChipsetWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.pcieChipsetWatts, afterTel.pcieChipsetWatts, "W")),
        },
        {
          label: "Stockage SSD NVMe + Contrôleur SATA",
          tooltipKey: "nvme_apst",
          beforeStr: `${beforeTel.storageWatts.toFixed(1)} W`,
          afterStr: `${afterTel.storageWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.storageWatts, afterTel.storageWatts, "W")),
        },
        {
          label: "Moniteur (Scaler Hz + Rétroéclairage LED)",
          tooltipKey: "display_brightness",
          beforeStr: `${beforeTel.displayWatts.toFixed(1)} W`,
          afterStr: `${afterTel.displayWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.displayWatts, afterTel.displayWatts, "W")),
        },
        {
          label: "Réseau Ethernet 2.5G + Wi-Fi + Ports USB",
          tooltipKey: "nic_eee",
          beforeStr: `${beforeTel.nicUsbMiscWatts.toFixed(1)} W`,
          afterStr: `${afterTel.nicUsbMiscWatts.toFixed(1)} W`,
          ...mapD(fmtDelta(beforeTel.nicUsbMiscWatts, afterTel.nicUsbMiscWatts, "W")),
        },
      ],
    },
    {
      title: "2. Vitesses d'Horloge, Tensions VID & États d'Énergie Matériels",
      rows: [
        {
          label: "Fréquence effective CPU P-Cores",
          tooltipKey: "cpu_freq_cap",
          beforeStr: `${beforeTel.cpuEffectivePClockMhz} MHz`,
          afterStr: `${afterTel.cpuEffectivePClockMhz} MHz`,
          ...mapD(fmtDelta(beforeTel.cpuEffectivePClockMhz, afterTel.cpuEffectivePClockMhz, "MHz", 0)),
        },
        {
          label: "Fréquence effective CPU E-Cores (EcoQoS)",
          tooltipKey: "bg_ecoqos",
          beforeStr: `${beforeTel.cpuEffectiveEClockMhz} MHz`,
          afterStr: `${afterTel.cpuEffectiveEClockMhz} MHz`,
          ...mapD(fmtDelta(beforeTel.cpuEffectiveEClockMhz, afterTel.cpuEffectiveEClockMhz, "MHz", 0)),
        },
        {
          label: "Tension CPU Vcore VID (impact quadratique V²)",
          tooltipKey: "cpu_freq_cap",
          beforeStr: `${beforeTel.cpuVidMv} mV`,
          afterStr: `${afterTel.cpuVidMv} mV`,
          ...mapD(fmtDelta(beforeTel.cpuVidMv, afterTel.cpuVidMv, "mV", 0)),
        },
        {
          label: "Résidence veille profonde Package C6/C8/C10",
          tooltipKey: "cpu_cstates",
          beforeStr: `${beforeTel.cpuCStateDeepPct} %`,
          afterStr: `${afterTel.cpuCStateDeepPct} %`,
          ...mapD(fmtDelta(beforeTel.cpuCStateDeepPct, afterTel.cpuCStateDeepPct, "pts", 0, false)),
        },
        {
          label: "Cœurs logiques dé-parqués (actifs / total)",
          tooltipKey: "cpu_core_parking",
          beforeStr: `${beforeTel.cpuActiveCores} / ${beforeTel.cpuTotalCores}`,
          afterStr: `${afterTel.cpuActiveCores} / ${afterTel.cpuTotalCores}`,
          deltaStr:
            afterTel.cpuActiveCores < beforeTel.cpuActiveCores
              ? `${beforeTel.cpuActiveCores - afterTel.cpuActiveCores} cœurs parqués (C6)`
              : "Identique",
          deltaGood: afterTel.cpuActiveCores < beforeTel.cpuActiveCores ? true : "neutral",
        },
        {
          label: "GPU Cœur (MHz) & Tension Vgpu (mV)",
          tooltipKey: "gpu_clock_cap",
          beforeStr: `${beforeTel.gpuEffectiveCoreMhz} MHz @ ${beforeTel.gpuVoltageMv} mV`,
          afterStr: `${afterTel.gpuEffectiveCoreMhz} MHz @ ${afterTel.gpuVoltageMv} mV`,
          ...mapD(fmtDelta(beforeTel.gpuEffectiveCoreMhz, afterTel.gpuEffectiveCoreMhz, "MHz", 0)),
        },
        {
          label: "GPU Mémoire GDDR6 & P-State",
          tooltipKey: "gpu_vram_policy",
          beforeStr: `${beforeTel.gpuPState} · ${beforeTel.gpuEffectiveVramMhz} MHz`,
          afterStr: `${afterTel.gpuPState} · ${afterTel.gpuEffectiveVramMhz} MHz`,
          ...mapD(fmtDelta(beforeTel.gpuEffectiveVramMhz, afterTel.gpuEffectiveVramMhz, "MHz", 0)),
        },
        {
          label: "Lien Bus PCIe & État SSD NVMe",
          tooltipKey: "pcie_aspm",
          beforeStr: `${beforeTel.pcieCurrentLink} | ${beforeTel.nvmeCurrentState}`,
          afterStr: `${afterTel.pcieCurrentLink} | ${afterTel.nvmeCurrentState}`,
          deltaStr: afterTel.nvmeCurrentState !== beforeTel.nvmeCurrentState ? "Veille active OK" : "Voir état",
          deltaGood: afterTel.pcieChipsetWatts < beforeTel.pcieChipsetWatts ? true : "neutral",
        },
      ],
    },
    {
      title: "3. Températures, Ventilation PWM & Niveau Sonore (dBA)",
      rows: [
        {
          label: "Température CPU Package (TjMax 100°C)",
          tooltipKey: "kpi_temp",
          beforeStr: `${beforeTel.cpuTempC.toFixed(1)} °C`,
          afterStr: `${afterTel.cpuTempC.toFixed(1)} °C (marge ${afterTel.cpuTjMaxMarginC.toFixed(0)}°C)`,
          ...mapD(fmtDelta(beforeTel.cpuTempC, afterTel.cpuTempC, "°C")),
        },
        {
          label: "Température GPU Cœur / Hotspot",
          tooltipKey: "kpi_temp",
          beforeStr: `${beforeTel.gpuTempC.toFixed(1)} / ${beforeTel.gpuHotspotTempC.toFixed(0)} °C`,
          afterStr: `${afterTel.gpuTempC.toFixed(1)} / ${afterTel.gpuHotspotTempC.toFixed(0)} °C`,
          ...mapD(fmtDelta(beforeTel.gpuTempC, afterTel.gpuTempC, "°C")),
        },
        {
          label: "Température SSD NVMe (SMART) & VRM Carte Mère",
          tooltipKey: "nvme_apst",
          beforeStr: `NVMe ${beforeTel.nvmeTempC.toFixed(1)}°C · VRM ${beforeTel.vrmTempC.toFixed(0)}°C`,
          afterStr: `NVMe ${afterTel.nvmeTempC.toFixed(1)}°C · VRM ${afterTel.vrmTempC.toFixed(0)}°C`,
          ...mapD(fmtDelta(beforeTel.nvmeTempC, afterTel.nvmeTempC, "°C NVMe")),
        },
        {
          label: "Ventilateur CPU PWM (RPM)",
          tooltipKey: "kpi_fan_noise",
          beforeStr: `${beforeTel.cpuFanRpm} RPM (${beforeTel.cpuFanPct}%)`,
          afterStr: `${afterTel.cpuFanRpm} RPM (${afterTel.cpuFanPct}%)`,
          ...mapD(fmtDelta(beforeTel.cpuFanRpm, afterTel.cpuFanRpm, "RPM", 0)),
        },
        {
          label: "Ventilateurs GPU (avec hystérésis 0 RPM)",
          tooltipKey: "gpu_zero_rpm",
          beforeStr: beforeTel.gpuFanRpm === 0 ? "0 RPM (Passif)" : `${beforeTel.gpuFanRpm} RPM (${beforeTel.gpuFanPct}%)`,
          afterStr: afterTel.gpuFanRpm === 0 ? "0 RPM (Fan-Stop !)" : `${afterTel.gpuFanRpm} RPM (${afterTel.gpuFanPct}%)`,
          ...mapD(fmtDelta(beforeTel.gpuFanRpm, afterTel.gpuFanRpm, "RPM", 0)),
        },
        {
          label: "Ventilation Boîtier (RPM)",
          tooltipKey: "kpi_fan_noise",
          beforeStr: `${beforeTel.caseFanRpm} RPM`,
          afterStr: `${afterTel.caseFanRpm} RPM`,
          ...mapD(fmtDelta(beforeTel.caseFanRpm, afterTel.caseFanRpm, "RPM", 0)),
        },
        {
          label: "Bruit global perçu à 60 cm (somme logarithmique)",
          tooltipKey: "kpi_fan_noise",
          beforeStr: `${beforeTel.systemNoiseDba.toFixed(1)} dBA`,
          afterStr: `${afterTel.systemNoiseDba.toFixed(1)} dBA (${afterTel.acousticLabel})`,
          ...mapD(fmtDelta(beforeTel.systemNoiseDba, afterTel.systemNoiseDba, "dBA")),
        },
      ],
    },
  ];

  const savedEuroYear = Math.max(0, beforeTel.annualEuro - afterTel.annualEuro);
  const savedKwhYear = Math.max(0, beforeTel.annualKwh - afterTel.annualKwh);
  const savedCo2Year = Math.max(0, beforeTel.annualCo2Kg - afterTel.annualCo2Kg);

  return (
    <div className="space-y-4">
      {/* Barre de sélection de la référence "Avant" + Simulateur facture électrique */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#141922] p-3.5 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">
              Comparer l'état actif ({activeLabel}) contre :
            </span>
            <select
              value={String(referenceSlot)}
              onChange={(e) => {
                const val = e.target.value;
                onChangeReferenceSlot(val === "stock" ? "stock" : (Number(val) as ProfileSlotId));
              }}
              className="bg-[#0C1017] border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="stock">État Nominal Windows d'origine (Stock)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  Profil P{p.id} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-mono text-slate-400">
            <span className="text-slate-300">{hardware.cpuName.split("(")[0].trim()}</span>
            <span className="text-slate-600">·</span>
            <span>{hardware.gpuName.split("(")[0].trim()}</span>
            <span className="text-slate-600">·</span>
            <span>{hardware.monitorName.match(/\d+\s*Hz/)?.[0] ?? `${hardware.maxDisplayHz} Hz`}</span>
            <span className="text-slate-600">·</span>
            <span>actif : {activeProfileName}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10.5px] text-slate-400">
              Survolez ou cliquez sur <code className="text-sky-400">?</code> pour l'API Win32, la loi physique et l'effet Avant/Après.
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onExportPs1}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-emerald-300 transition-colors cursor-pointer shrink-0"
                title="Exporter un script PowerShell autonome (powercfg + nvidia-smi + sauvegarde -Restore)"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                Script Windows (.ps1)
              </button>
              <button
                type="button"
                onClick={onExportReport}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-slate-200 transition-colors cursor-pointer shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                Rapport (.md)
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
              <Euro className="w-3.5 h-3.5" />
              <span>Économie annuelle réelle à la prise 230V :</span>
            </div>
            <div className="font-mono text-sm font-bold text-white tabular-nums">
              -{savedEuroYear.toFixed(1)} €/an{" "}
              <span className="text-xs font-normal text-emerald-300">
                (-{savedKwhYear.toFixed(0)} kWh/an · -{savedCo2Year.toFixed(1)} kg CO₂)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <label className="flex flex-col gap-0.5 text-slate-400">
              <span>Tarif €/kWh</span>
              <input
                type="number"
                step="0.01"
                min="0.05"
                max="1.00"
                value={cost.euroPerKwh}
                onChange={(e) =>
                  onChangeCost({
                    ...cost,
                    euroPerKwh: Math.max(0.05, Math.min(1.5, Number(e.target.value) || 0.25)),
                  })
                }
                className="w-20 bg-[#0C1017] border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-slate-400">
              <span>Heures / jour</span>
              <input
                type="number"
                step="1"
                min="1"
                max="24"
                value={cost.hoursPerDay}
                onChange={(e) =>
                  onChangeCost({
                    ...cost,
                    hoursPerDay: Math.max(1, Math.min(24, Number(e.target.value) || 8)),
                  })
                }
                className="w-16 bg-[#0C1017] border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
              />
            </label>
          </div>
        </div>
      </div>

      {/* SECTION PHARE : EFFETS EN VRAI EN MILLISECONDES (BENCHMARKS CONCRETS) */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-[#10151E] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-sky-400" />
            <TechTooltip tooltipKey="kpi_latency_ms">
              <h3 className="text-xs sm:text-sm font-semibold text-white">
                Effets en Vrai : Temps d'Exécution Réels Avant → Après (ms) & Énergie par Tâche (Joules)
              </h3>
            </TechTooltip>
          </div>

          <div className="flex items-center gap-2.5">
            {lastBenchRunInfo && (
              <span className="hidden md:inline-flex items-center gap-1 font-mono text-[10.5px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded">
                <CheckCircle2 className="w-3 h-3" />
                Calibré ({lastBenchRunInfo.measuredHostMs} ms hôte · {(lastBenchRunInfo.opsPerSec / 1e6).toFixed(1)} Mops/s · {lastBenchRunInfo.ranAt})
              </span>
            )}
            <button
              type="button"
              onClick={triggerBench}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Exécuter micro-bench réel</span>
            </button>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {benchmarks.map((b) => {
            const maxBar = Math.max(b.beforeMs, b.afterMs, b.humanThresholdMs) * 1.12;
            const beforePct = Math.min(100, (b.beforeMs / maxBar) * 100);
            const afterPct = Math.min(100, (b.afterMs / maxBar) * 100);
            const threshPct = Math.min(100, (b.humanThresholdMs / maxBar) * 100);

            // Calcul d'énergie réelle de la tâche en Joules (W * secondes)
            const refPowerBefore = b.category === "GPU" ? beforeTel.gpuBoardWatts : beforeTel.cpuPackageWatts;
            const refPowerAfter = b.category === "GPU" ? afterTel.gpuBoardWatts : afterTel.cpuPackageWatts;
            const joulesBefore = (refPowerBefore * b.beforeMs) / 1000;
            const joulesAfter = (refPowerAfter * b.afterMs) / 1000;
            const jouleSavePct =
              joulesBefore > 0.01 ? Math.round(((joulesAfter - joulesBefore) / joulesBefore) * 100) : 0;

            const badgeCls =
              b.humanVerdict === "Imperceptible"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : b.humanVerdict === "Très léger"
                ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
                : b.humanVerdict === "Perceptible mais fluide"
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                : "bg-rose-500/15 text-rose-300 border-rose-500/30";

            return (
              <div
                key={b.id}
                className="rounded-lg bg-[#0E1219] border border-slate-800 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                        {b.category}
                      </span>
                      <TechTooltip
                        tooltipKey={b.tooltipKey}
                        extraBeforeAfter={`${b.beforeMs} ms → ${b.afterMs} ms (${b.deltaMs >= 0 ? "+" : ""}${b.deltaMs} ms / ${b.deltaPct >= 0 ? "+" : ""}${b.deltaPct}%)`}
                      >
                        <span className="text-xs font-semibold text-slate-100">{b.name}</span>
                      </TechTooltip>
                    </div>
                    <p className="text-[10.5px] text-slate-400 mt-0.5">{b.taskDescription}</p>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${badgeCls}`}>
                    {b.humanVerdict}
                  </span>
                </div>

                {/* Barres Avant / Après + repère seuil humain */}
                <div className="relative space-y-1 pt-1">
                  <div className="flex items-center gap-2 text-[10.5px] font-mono tabular-nums">
                    <span className="w-11 text-slate-500">Avant</span>
                    <div className="flex-1 h-2 bg-slate-800/80 rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-slate-500 rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(2, beforePct)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-slate-400">{b.beforeMs.toFixed(2)} ms</span>
                  </div>

                  <div className="flex items-center gap-2 text-[10.5px] font-mono tabular-nums">
                    <span className="w-11 text-slate-300">Après</span>
                    <div className="flex-1 h-2.5 bg-slate-800/80 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          b.afterMs <= b.humanThresholdMs ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                        style={{ width: `${Math.max(2, afterPct)}%` }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-sky-300"
                        style={{ left: `${threshPct}%` }}
                        title={`Seuil confort humain / fluide : ${b.humanThresholdMs} ms`}
                      />
                    </div>
                    <span className="w-16 text-right text-white font-semibold">{b.afterMs.toFixed(2)} ms</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[10.5px] font-mono tabular-nums">
                  <span className="text-slate-300">
                    Écart :{" "}
                    <strong className={b.deltaMs <= 4 ? "text-emerald-300" : "text-amber-300"}>
                      {b.deltaMs >= 0 ? "+" : ""}
                      {b.deltaMs.toFixed(2)} ms
                    </strong>{" "}
                    <span className="text-slate-500">
                      (seuil fluide : {b.humanThresholdMs} ms)
                    </span>
                  </span>
                  {(b.category === "CPU" || b.category === "GPU") && joulesBefore > 0.05 && (
                    <span className="text-emerald-400">
                      Énergie/tâche : {joulesBefore.toFixed(2)}J → {joulesAfter.toFixed(2)}J ({jouleSavePct}%)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MÉTHODOLOGIE & PROTOCOLE DE VALIDATION MATÉRIELLE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#141922] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <ClipboardCheck className="w-4 h-4 text-emerald-400" />
              Protocole de validation matérielle
            </h3>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              {checkedCount}/{PROTOCOL_STEPS.length} étapes
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-2">
            <div
              className="h-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${(checkedCount / PROTOCOL_STEPS.length) * 100}%` }}
            />
          </div>
          <ul className="space-y-1">
            {PROTOCOL_STEPS.map((step, idx) => {
              const done = !!protocolChecks[step];
              return (
                <li key={step}>
                  <button
                    type="button"
                    onClick={() => setProtocolChecks((prev) => ({ ...prev, [step]: !prev[step] }))}
                    aria-pressed={done}
                    className="w-full flex items-start gap-2 px-2 py-1 rounded hover:bg-[#181F2B] text-left cursor-pointer"
                  >
                    {done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                    )}
                    <span className={`text-[10.5px] leading-snug ${done ? "text-slate-400 line-through" : "text-slate-300"}`}>
                      {idx + 1}. {step}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-slate-500 mt-1.5">
            Ce protocole ne remplace pas un test de stabilité long (OCCT/Prime95) si vous descendez le PL1 sous 30 W.
          </p>
        </div>

        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-xl border border-amber-500/25 bg-amber-950/12 p-3.5">
            <h3 className="text-xs font-semibold text-amber-200 flex items-center gap-1.5 mb-1">
              <FlaskConical className="w-3.5 h-3.5" /> Ce que mesure ce comparatif
            </h3>
            <p className="text-[10.5px] text-slate-300 leading-relaxed">
              Les temps d'exécution sont calculés par le modèle physique calibré (fréquence effective,
              PL1, EPP, états mémoire), puis recalibrés par un vrai micro-benchmark exécuté dans votre
              navigateur. Les Watts, °C et dBA sont des <strong>estimations de dimensionnement</strong> :
              seul le binaire Rust lit le RAPL/EMI, la sonde NVML et le SMART du PC cible.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#141922] p-3.5">
            <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5 mb-1.5">
              <History className="w-3.5 h-3.5 text-sky-400" /> Historique des calibrations ({benchRuns.length})
            </h3>
            {benchRuns.length === 0 ? (
              <p className="text-[10.5px] text-slate-500">
                Aucune exécution. Cliquez sur « Exécuter micro-bench réel » pour mesurer la machine hôte et figer un point de comparaison.
              </p>
            ) : (
              <ul className="space-y-1 max-h-24 overflow-y-auto font-mono text-[10px]">
                {benchRuns.map((run) => (
                  <li key={run.id} className="flex items-center justify-between gap-2 text-slate-400">
                    <span>{run.ranAt} · {run.workload}</span>
                    <span className="text-slate-200">
                      {run.measuredHostMs.toFixed(2)} ms · ×{run.calibrationScale.toFixed(3)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* MATRICE TECHNIQUE EXHAUSTIVE AVANT / APRÈS */}
      <div className="space-y-3">
        {sections.map((sec) => (
          <div
            key={sec.title}
            className="rounded-xl border border-slate-800 bg-[#141922] overflow-hidden"
          >
            <div className="px-4 py-2.5 bg-[#10151E] border-b border-slate-800 text-xs font-semibold text-slate-200">
              {sec.title}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800/90 text-[10.5px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 px-4 font-medium">Capteur / Paramètre matériel</th>
                    <th className="py-2 px-3 font-medium text-right">Avant (Réf.)</th>
                    <th className="py-2 px-3 font-medium text-right">Après (Actif)</th>
                    <th className="py-2 px-4 font-medium text-right">Gain / Écart (Δ)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sec.rows.map((row) => (
                    <tr key={row.label} className="hover:bg-[#181F2B] transition-colors">
                      <td className="py-2 px-4 text-slate-200">
                        <TechTooltip
                          tooltipKey={row.tooltipKey}
                          extraBeforeAfter={`${row.beforeStr} → ${row.afterStr} (${row.deltaStr})`}
                        >
                          <span>{row.label}</span>
                        </TechTooltip>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-[11.5px] text-slate-400 tabular-nums">
                        {row.beforeStr}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-[11.5px] text-white font-semibold tabular-nums">
                        {row.afterStr}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-mono text-[11.5px] font-semibold tabular-nums ${
                          row.deltaGood === "neutral"
                            ? "text-slate-500"
                            : row.deltaGood
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {row.deltaStr}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function mapD(d: { str: string; good: boolean | "neutral" }): {
  deltaStr: string;
  deltaGood: boolean | "neutral";
} {
  return { deltaStr: d.str, deltaGood: d.good };
}

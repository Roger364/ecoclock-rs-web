import React from "react";
import { ArrowDownRight, Check, Cpu, Gauge, Leaf, Star, Timer } from "lucide-react";
import {
  HardwareProfile,
  PrivilegeLevel,
  Profile,
  ProfileSlotId,
  TelemetrySnapshot,
  WorkloadMode,
} from "../types/hardware";
import { STOCK_BASELINE_CONFIG, WORKLOAD_META } from "../data/profiles";
import { computeBenchmarks, computeTelemetry, CostAssumptions, resolveEffectiveConfig } from "../engine/physics";
import { clampConfigToProfile } from "../engine/validation";
import { TechTooltip } from "./TechTooltip";

interface ProfileCompareViewProps {
  profiles: Profile[];
  activeSlot: ProfileSlotId;
  bootProfileId: ProfileSlotId;
  bootEnabled: boolean;
  hardware: HardwareProfile;
  workload: WorkloadMode;
  privilege: PrivilegeLevel;
  cost: CostAssumptions;
  onApplySlot: (slot: ProfileSlotId) => void;
  onSetBootSlot: (slot: ProfileSlotId) => void;
}

interface Column {
  key: string;
  name: string;
  tag: string;
  chart: string;
  config: (typeof STOCK_BASELINE_CONFIG);
  tel: TelemetrySnapshot;
  benchJson: number;
  benchGpu: number;
  isStock: boolean;
  slot?: ProfileSlotId;
}

export const ProfileCompareView: React.FC<ProfileCompareViewProps> = ({
  profiles,
  activeSlot,
  bootProfileId,
  bootEnabled,
  hardware,
  workload,
  privilege,
  cost,
  onApplySlot,
  onSetBootSlot,
}) => {
  const stockBounded = clampConfigToProfile(STOCK_BASELINE_CONFIG, hardware);
  const stockBenches = computeBenchmarks(stockBounded, stockBounded, 1, hardware);

  const columns: Column[] = [
    {
      key: "stock",
      name: "Windows Stock",
      tag: "Référence",
      chart: "#94A3B8",
      config: stockBounded,
      tel: computeTelemetry(stockBounded, workload, cost, 0, hardware),
      benchJson: stockBenches[0].afterMs,
      benchGpu: stockBenches[3].afterMs,
      isStock: true,
    },
    ...profiles.map((p): Column => {
      const bounded = clampConfigToProfile(p.config, hardware);
      const effective = resolveEffectiveConfig(bounded, privilege, stockBounded);
      const benches = computeBenchmarks(stockBounded, effective, 1, hardware);
      return {
        key: `p${p.id}`,
        name: p.name,
        tag: p.shortTag,
        chart: ["#10B981", "#38BDF8", "#F59E0B", "#A78BFA", "#94A3B8"][p.id - 1],
        config: effective,
        tel: computeTelemetry(effective, workload, cost, 0, hardware),
        benchJson: benches[0].afterMs,
        benchGpu: benches[3].afterMs,
        isStock: false,
        slot: p.id,
      };
    }),
  ];

  const stock = columns[0];

  interface Row {
    label: string;
    tooltipKey: string;
    render: (c: Column) => string;
    value: (c: Column) => number;
    lowerIsBetter: boolean;
    bestDelta?: boolean;
  }

  const rows: Row[] = [
    {
      label: "Fréquence CPU effective",
      tooltipKey: "cpu_freq_cap",
      render: (c) => `${c.tel.cpuEffectivePClockMhz} MHz @ ${c.tel.cpuVidMv} mV`,
      value: (c) => c.tel.cpuEffectivePClockMhz,
      lowerIsBetter: true,
    },
    {
      label: "Résidence C6/C8",
      tooltipKey: "cpu_cstates",
      render: (c) => `${c.tel.cpuCStateDeepPct} %`,
      value: (c) => c.tel.cpuCStateDeepPct,
      lowerIsBetter: false,
    },
    {
      label: "Enveloppe RAPL PL1",
      tooltipKey: "cpu_pl1",
      render: (c) => `${c.config.cpuPl1Watts} W`,
      value: (c) => c.config.cpuPl1Watts,
      lowerIsBetter: true,
    },
    {
      label: "GPU Power Limit",
      tooltipKey: "gpu_power_limit",
      render: (c) => (hardware.hasDedicatedGpu ? `${c.config.gpuPowerLimitPct}% · ${Math.round((hardware.gpuTdpW * c.config.gpuPowerLimitPct) / 100)} W` : "iGPU seul"),
      value: (c) => c.config.gpuPowerLimitPct,
      lowerIsBetter: true,
    },
    {
      label: "VRAM / Écran",
      tooltipKey: "display_hz",
      render: (c) => `${hardware.hasDedicatedGpu ? c.tel.gpuPState : "iGPU"} · ${c.tel.gpuEffectiveVramMhz || "-"} MHz · ${c.config.displayRefreshHz} Hz`,
      value: (c) => c.tel.gpuEffectiveVramMhz,
      lowerIsBetter: true,
    },
    {
      label: "PCIe ASPM",
      tooltipKey: "pcie_aspm",
      render: (c) => c.config.pcieAspm.toUpperCase(),
      value: (c) => ({ off: 0, l0s: 1, l1: 2, l1_substates: 3 }[c.config.pcieAspm]),
      lowerIsBetter: false,
    },
    {
      label: "SSD NVMe APST",
      tooltipKey: "nvme_apst",
      render: (c) => c.tel.nvmeCurrentState,
      value: (c) => c.tel.storageWatts,
      lowerIsBetter: true,
    },
    {
      label: "Puissance système DC",
      tooltipKey: "kpi_power",
      render: (c) => `${c.tel.totalSystemWatts.toFixed(1)} W`,
      value: (c) => c.tel.totalSystemWatts,
      lowerIsBetter: true,
    },
    {
      label: "Prise murale 230 V",
      tooltipKey: "kpi_power",
      render: (c) => `${c.tel.psuWallWatts.toFixed(1)} W`,
      value: (c) => c.tel.psuWallWatts,
      lowerIsBetter: true,
    },
    {
      label: "Température CPU / GPU",
      tooltipKey: "kpi_temp",
      render: (c) => `${c.tel.cpuTempC.toFixed(0)} / ${c.tel.gpuTempC.toFixed(0)} °C`,
      value: (c) => c.tel.cpuTempC + c.tel.gpuTempC,
      lowerIsBetter: true,
    },
    {
      label: "Ventilation & bruit",
      tooltipKey: "kpi_fan_noise",
      render: (c) => `${c.tel.cpuFanRpm} · ${c.tel.gpuFanRpm} RPM · ${c.tel.systemNoiseDba.toFixed(1)} dBA`,
      value: (c) => c.tel.systemNoiseDba,
      lowerIsBetter: true,
    },
    {
      label: "Réactivité UI (JSON 5 Mo)",
      tooltipKey: "bench_json",
      render: (c) => `${c.benchJson.toFixed(2)} ms`,
      value: (c) => c.benchJson,
      lowerIsBetter: true,
    },
    {
      label: "Rendu GPU (frame time)",
      tooltipKey: "bench_gpu_frame",
      render: (c) => `${c.benchGpu.toFixed(2)} ms`,
      value: (c) => c.benchGpu,
      lowerIsBetter: true,
    },
    {
      label: "Économie vs Stock",
      tooltipKey: "kpi_power",
      render: (c) =>
        c.isStock
          ? "—"
          : `${c.tel.annualEuro - stock.tel.annualEuro > 0 ? "+" : ""}${(c.tel.annualEuro - stock.tel.annualEuro).toFixed(1)} €/an`,
      value: (c) => c.tel.annualEuro,
      lowerIsBetter: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Leaf className="w-4 h-4 text-emerald-400" />
            Comparer les 5 profils retenus (et le profil Stock)
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {hardware.cpuName} · {hardware.gpuName} — scénario {WORKLOAD_META[workload].label},{" "}
            jeton {privilege === "admin" ? "Admin" : "User"} (les leviers Admin non appliqués sont donc exclus).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-mono text-slate-400">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Puissance</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-400" /> Thermique</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Acoustic.</span>
          <span className="inline-flex items-center gap-1"><Timer className="w-3 h-3 text-indigo-400" /> Effet en ms</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-[#141922] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-[11.5px]">
            <thead>
              <tr className="bg-[#10151E] border-b border-slate-800">
                <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-wider text-slate-500 font-medium sticky left-0 bg-[#10151E] z-10">
                  Indicateur
                </th>
                {columns.map((c) => (
                  <th key={c.key} className="py-2.5 px-2.5 text-center align-top">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] font-mono" style={{ color: c.chart }}>
                        {c.isStock ? "STOCK" : `P${c.slot}`}
                      </span>
                      <span className="text-[10.5px] font-semibold text-slate-200 max-w-[112px] leading-tight">
                        {c.name}
                      </span>
                      <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400">
                        {c.isStock ? "non bridé" : c.tag}
                      </span>
                      <div className="flex gap-1">
                        {!c.isStock && c.slot === activeSlot && (
                          <span className="text-[8.5px] px-1 rounded bg-emerald-500/20 text-emerald-300">actif</span>
                        )}
                        {bootEnabled && !c.isStock && c.slot === bootProfileId && (
                          <span className="text-[8.5px] px-1 rounded bg-amber-500/20 text-amber-300 inline-flex items-center gap-0.5">
                            <Star className="w-2 h-2" /> boot
                          </span>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((row) => {
                const values = columns.map(row.value);
                const best = row.lowerIsBetter ? Math.min(...values) : Math.max(...values);
                return (
                  <tr key={row.label} className="hover:bg-[#181F2B]">
                    <td className="py-1.5 px-3 text-slate-300 sticky left-0 bg-[#141922] z-10">
                      <TechTooltip tooltipKey={row.tooltipKey} showIcon={false}>
                        <span>{row.label}</span>
                      </TechTooltip>
                    </td>
                    {columns.map((c, idx) => {
                      const isBest = Math.abs(values[idx] - best) < 0.01;
                      return (
                        <td
                          key={c.key}
                          className={`py-1.5 px-2.5 text-center font-mono text-[10.5px] tabular-nums ${
                            isBest ? "text-emerald-300 font-semibold" : "text-slate-300"
                          }`}
                        >
                          {row.render(c)}
                          {isBest && <span className="ml-1 text-[8px] text-emerald-500">●</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#10151E] border-t border-slate-800">
                <td className="py-2 px-3 text-[10.5px] text-slate-500 sticky left-0 bg-[#10151E]">
                  Action
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="py-2 px-2 text-center">
                    {c.isStock || !c.slot ? (
                      <span className="text-[10px] text-slate-500">référence</span>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onApplySlot(c.slot!)}
                          className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold cursor-pointer inline-flex items-center gap-1"
                        >
                          {c.slot === activeSlot ? <Check className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                          {c.slot === activeSlot ? "Actif" : "Appliquer"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetBootSlot(c.slot!)}
                          className="text-[9px] text-slate-400 hover:text-amber-300 cursor-pointer"
                        >
                          définir au boot
                        </button>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
            <Leaf className="w-3.5 h-3.5" /> Meilleure sobriété
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {(() => {
              const best = [...columns].sort((a, b) => a.tel.psuWallWatts - b.tel.psuWallWatts)[0];
              return `${best.isStock ? "Stock" : `P${best.slot} ${best.name}`} — ${best.tel.psuWallWatts.toFixed(1)} W à la prise`;
            })()}
          </div>
        </div>
        <div className="rounded-lg border border-sky-500/25 bg-sky-950/15 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-300">
            <Cpu className="w-3.5 h-3.5" /> Meilleure réactivité
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {(() => {
              const best = [...columns].sort((a, b) => a.benchJson - b.benchJson)[0];
              return `${best.isStock ? "Stock" : `P${best.slot} ${best.name}`} — ${best.benchJson.toFixed(2)} ms`;
            })()}
          </div>
        </div>
        <div className="rounded-lg border border-amber-500/25 bg-amber-950/15 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
            <Gauge className="w-3.5 h-3.5" /> Murale
          </div>
          <div className="mt-1 text-xs text-slate-300">
            Tous les profils sont recalculés avec le même matériel et le même scénario de charge.
          </div>
        </div>
      </div>
    </div>
  );
};

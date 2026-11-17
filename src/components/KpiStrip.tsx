import React from "react";
import { Flame, Timer, Wind, Zap } from "lucide-react";
import { BenchmarkMetric, TelemetrySnapshot } from "../types/hardware";
import { TechTooltip } from "./TechTooltip";

interface KpiStripProps {
  beforeTel: TelemetrySnapshot;
  afterTel: TelemetrySnapshot;
  benchmarks: BenchmarkMetric[];
}

export const KpiStrip: React.FC<KpiStripProps> = ({ beforeTel, afterTel, benchmarks }) => {
  const wattsDelta = afterTel.totalSystemWatts - beforeTel.totalSystemWatts;
  const wattsPct =
    beforeTel.totalSystemWatts > 0 ? Math.round((wattsDelta / beforeTel.totalSystemWatts) * 100) : 0;
  const euroSaved = Math.max(0, beforeTel.annualEuro - afterTel.annualEuro);
  const cpuTempDelta = afterTel.cpuTempC - beforeTel.cpuTempC;
  const noiseDelta = afterTel.systemNoiseDba - beforeTel.systemNoiseDba;
  const jsonBench = benchmarks[0];
  const gpuBench = benchmarks[3];

  return (
    <div className="px-4 pt-3.5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
      {/* Carte 1 : Électricité */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <TechTooltip
            tooltipKey="kpi_power"
            extraBeforeAfter={`DC: ${beforeTel.totalSystemWatts}W → ${afterTel.totalSystemWatts}W | Prise 230V: ${beforeTel.psuWallWatts}W → ${afterTel.psuWallWatts}W`}
          >
            <span className="font-medium inline-flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-emerald-400" /> Électricité (Avant → Après)
            </span>
          </TechTooltip>
          <span
            className={`font-mono text-[11px] font-bold px-1.5 py-0.2 rounded tabular-nums ${
              wattsDelta <= -0.5 ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
            }`}
          >
            {wattsDelta <= 0 ? `${wattsPct}%` : `+${wattsPct}%`}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
          <span className="text-xs text-slate-500 line-through">{beforeTel.totalSystemWatts.toFixed(1)}W</span>
          <span className="text-lg font-bold text-white">{afterTel.totalSystemWatts.toFixed(1)} W</span>
          <span className="text-xs font-semibold text-emerald-400">
            ({wattsDelta > 0 ? "+" : ""}
            {wattsDelta.toFixed(1)} W)
          </span>
        </div>
        <div className="mt-1 text-[10.5px] font-mono text-slate-400 flex justify-between tabular-nums">
          <span>Prise : {afterTel.psuWallWatts.toFixed(0)} W AC</span>
          <span className="text-emerald-300/90">Éco : -{euroSaved.toFixed(1)} €/an</span>
        </div>
      </div>

      {/* Carte 2 : Températures */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <TechTooltip
            tooltipKey="kpi_temp"
            extraBeforeAfter={`CPU ${beforeTel.cpuTempC}°C → ${afterTel.cpuTempC}°C | GPU ${beforeTel.gpuTempC}°C → ${afterTel.gpuTempC}°C | NVMe ${beforeTel.nvmeTempC}°C → ${afterTel.nvmeTempC}°C`}
          >
            <span className="font-medium inline-flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" /> Températures (CPU / GPU)
            </span>
          </TechTooltip>
          <span className="font-mono text-[11px] font-semibold text-sky-300 tabular-nums">
            {cpuTempDelta <= 0 ? `${cpuTempDelta.toFixed(1)}°C` : `+${cpuTempDelta.toFixed(1)}°C`}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
          <span className="text-xs text-slate-500 line-through">{beforeTel.cpuTempC.toFixed(0)}°C</span>
          <span className="text-lg font-bold text-white">{afterTel.cpuTempC.toFixed(1)} °C</span>
          <span className="text-xs text-slate-400">
            GPU <strong className="text-slate-200">{afterTel.gpuTempC.toFixed(0)}°C</strong>
          </span>
        </div>
        <div className="mt-1 text-[10.5px] font-mono text-slate-400 flex justify-between tabular-nums">
          <span>NVMe : {afterTel.nvmeTempC.toFixed(0)}°C</span>
          <span>CPU VID : {afterTel.cpuVidMv} mV</span>
        </div>
      </div>

      {/* Carte 3 : Ventilation & Bruit */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <TechTooltip
            tooltipKey="kpi_fan_noise"
            extraBeforeAfter={`Bruit ${beforeTel.systemNoiseDba} dBA → ${afterTel.systemNoiseDba} dBA | CPU ${beforeTel.cpuFanRpm} → ${afterTel.cpuFanRpm} RPM | GPU ${beforeTel.gpuFanRpm} → ${afterTel.gpuFanRpm} RPM`}
          >
            <span className="font-medium inline-flex items-center gap-1">
              <Wind className="w-3.5 h-3.5 text-sky-400" /> Ventilation & Bruit (dBA)
            </span>
          </TechTooltip>
          <span className="font-mono text-[11px] font-semibold text-emerald-300 tabular-nums">
            {noiseDelta <= 0 ? `${noiseDelta.toFixed(1)} dBA` : `+${noiseDelta.toFixed(1)} dBA`}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
          <span className="text-xs text-slate-500 line-through">{beforeTel.systemNoiseDba.toFixed(1)}</span>
          <span className="text-lg font-bold text-white">{afterTel.systemNoiseDba.toFixed(1)} dBA</span>
          <span className="text-xs text-slate-400">({afterTel.cpuFanRpm} RPM)</span>
        </div>
        <div className="mt-1 text-[10.5px] font-mono text-slate-400 flex justify-between tabular-nums">
          <span>
            GPU :{" "}
            <strong className={afterTel.gpuFanRpm === 0 ? "text-emerald-300" : "text-slate-300"}>
              {afterTel.gpuFanRpm === 0 ? "0 RPM Passif" : `${afterTel.gpuFanRpm} RPM`}
            </strong>
          </span>
          <span className="truncate ml-2">{afterTel.acousticLabel.split(" ")[0]}</span>
        </div>
      </div>

      {/* Carte 4 : Effet réel en ms */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <TechTooltip
            tooltipKey="kpi_latency_ms"
            extraBeforeAfter={`JSON 5Mo: ${jsonBench.beforeMs} → ${jsonBench.afterMs} ms | Frame GPU: ${gpuBench.beforeMs} → ${gpuBench.afterMs} ms`}
          >
            <span className="font-medium inline-flex items-center gap-1">
              <Timer className="w-3.5 h-3.5 text-indigo-400" /> Effet Réel en Vrai (ms)
            </span>
          </TechTooltip>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
              jsonBench.humanVerdict === "Imperceptible"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {jsonBench.humanVerdict}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
          <span className="text-xs text-slate-500">{jsonBench.beforeMs.toFixed(1)} →</span>
          <span className="text-lg font-bold text-white">{jsonBench.afterMs.toFixed(1)} ms</span>
          <span className="text-xs text-sky-300">
            ({jsonBench.deltaMs >= 0 ? "+" : ""}
            {jsonBench.deltaMs.toFixed(1)} ms UI)
          </span>
        </div>
        <div className="mt-1 text-[10.5px] font-mono text-slate-400 flex justify-between tabular-nums">
          <span>GPU : {gpuBench.afterMs.toFixed(1)} ms/img</span>
          <span>C8 : {afterTel.cpuCStateDeepPct}% repos</span>
        </div>
      </div>
    </div>
  );
};

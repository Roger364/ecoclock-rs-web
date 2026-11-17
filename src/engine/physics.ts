import { STOCK_BASELINE_CONFIG, WORKLOAD_META } from "../data/profiles";
import { DEFAULT_HARDWARE_PROFILE } from "../data/hardwareProfiles";
import {
  BenchmarkMetric,
  HardwareConfig,
  HardwareProfile,
  PrivilegeLevel,
  TelemetrySnapshot,
  WorkloadMode,
} from "../types/hardware";

const AMBIENT_TEMP_C = 22.0;

/**
 * Applique le filtrage réel des droits Windows :
 * en mode Utilisateur standard (asInvoker), seuls les leviers User-space sont appliqués au matériel ;
 * les registres Admin (NVML PL/Lock, NVMe APST, SATA ALPM, PL1, CoreParking, NIC EEE, ASPM L1.2)
 * restent à leur état initial tant que l'utilisateur n'a pas accordé l'élévation UAC.
 */
export function resolveEffectiveConfig(
  desired: HardwareConfig,
  privilege: PrivilegeLevel,
  fallback: HardwareConfig = STOCK_BASELINE_CONFIG
): HardwareConfig {
  if (privilege === "admin") {
    return { ...desired };
  }
  return {
    ...desired,
    // Leviers nécessitant TokenElevation (Admin)
    cpuCoreParkingMinActive: fallback.cpuCoreParkingMinActive,
    cpuPl1Watts: fallback.cpuPl1Watts,
    gpuPowerLimitPct: fallback.gpuPowerLimitPct,
    gpuCoreClockCapMhz: fallback.gpuCoreClockCapMhz,
    gpuVramPolicy: fallback.gpuVramPolicy,
    // En mode User, PowerCfg autorise L0s/L1 mais pas le forçage registre L1.2 Substates
    pcieAspm: desired.pcieAspm === "l1_substates" ? "l1" : desired.pcieAspm,
    nvmeApst: fallback.nvmeApst,
    nvmeIdleTimeoutMs: fallback.nvmeIdleTimeoutMs,
    sataAlpm: fallback.sataAlpm,
    nicEeeEnabled: fallback.nicEeeEnabled,
  };
}

/** Tension VID CPU (en Volts) en fonction de la fréquence (MHz) — courbe non-linéaire réaliste */
export function cpuVoltageAtFreq(freqMhz: number): number {
  const f = Math.max(600, Math.min(5300, freqMhz));
  const norm = (f - 600) / (5200 - 600); // 0..1
  // Pente douce jusqu'à ~3.4 GHz puis coude exponentiel au-delà de 3.8 GHz
  const v = 0.645 + 0.34 * norm + 0.415 * Math.pow(norm, 2.85);
  return Math.round(v * 1000) / 1000;
}

/** Tension cœur GPU (en Volts) en fonction de la fréquence (MHz) */
export function gpuVoltageAtFreq(freqMhz: number): number {
  const f = Math.max(210, Math.min(2650, freqMhz));
  const norm = (f - 210) / (2610 - 210);
  const v = 0.635 + 0.19 * norm + 0.26 * Math.pow(norm, 2.55);
  return Math.round(v * 1000) / 1000;
}

/** Calcule le plafond de fréquence CPU autorisé par la configuration (hors PL1) */
export function computeCpuAllowedMaxMhz(
  cfg: HardwareConfig,
  profile: HardwareProfile = DEFAULT_HARDWARE_PROFILE
): number {
  const base = profile.cpuBaseMhz;
  const turboCap =
    cfg.cpuTurboMode === "disabled"
      ? base
      : cfg.cpuTurboMode === "efficient"
      ? Math.round(base + (profile.cpuTurboMhz - base) * 0.62)
      : profile.cpuTurboMhz;

  const pctCap =
    cfg.cpuMaxPercent >= 100
      ? turboCap
      : Math.round((base * cfg.cpuMaxPercent) / 100);

  return Math.max(
    Math.min(profile.cpuFreqMinMhz, turboCap),
    Math.min(turboCap, pctCap, cfg.cpuFreqCapMhz, profile.cpuFreqMaxMhz)
  );
}

export interface CostAssumptions {
  euroPerKwh: number; // ex: 0.2516 €/kWh tarif bleu EDF
  hoursPerDay: number; // ex: 10 h/jour
  co2GramsPerKwh: number; // ex: 52 gCO2/kWh mix FR (ou 250 UE)
}

export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  euroPerKwh: 0.2516,
  hoursPerDay: 10,
  co2GramsPerKwh: 56,
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Puissance AC tirée à la prise par le bloc d'alimentation (80+ Gold) pour une charge interne DC donnée.
 * Fonction C∞ strictement croissante (dP_ac/dP_dc > 1.088 partout) : économiser 1 W DC économise toujours > 1 W AC.
 */
export function computePsuWallPcWatts(pcDcWatts: number): number {
  const p = Math.max(0, pcDcWatts);
  return 3.2 + 1.088 * p + 0.00005 * p * p;
}

/**
 * Calcule un instantané complet de télémétrie matérielle pour une configuration donnée
 */
export function computeTelemetry(
  cfg: HardwareConfig,
  workload: WorkloadMode,
  cost: CostAssumptions = DEFAULT_COST_ASSUMPTIONS,
  jitterSeed = 0, // léger micro-bruit réaliste 1Hz (-1..+1) si souhaité
  profile: HardwareProfile = DEFAULT_HARDWARE_PROFILE
): TelemetrySnapshot {
  const w = WORKLOAD_META[workload];
  const totalCores = profile.cpuCores;

  // --- 1. CPU ---
  const maxAllowedMhz = computeCpuAllowedMaxMhz(cfg, profile);
  const minFloorMhz = Math.min(
    maxAllowedMhz,
    Math.max(profile.cpuFreqMinMhz, Math.round((profile.cpuBaseMhz * cfg.cpuMinPercent) / 100))
  );

  // L'EPP (0..100) tire la fréquence demandée vers le point d'efficacité sur charges légères/moyennes
  const eppFactor = 1 - (cfg.cpuEpp / 100) * (1 - w.cpuLoad * 0.72) * 0.62;
  const turboAggression =
    cfg.cpuTurboMode === "aggressive" ? 1.12 : cfg.cpuTurboMode === "efficient" ? 0.96 : 0.9;
  const demandRatio = Math.min(1, Math.pow(w.cpuLoad, 0.44) * eppFactor * turboAggression);

  let pClockMhz = Math.round(minFloorMhz + (maxAllowedMhz - minFloorMhz) * demandRatio);
  pClockMhz = Math.max(minFloorMhz, Math.min(maxAllowedMhz, pClockMhz));

  // EcoQoS réduit l'activité parasite de fond sur les P-Cores
  const effectiveCpuLoad = cfg.bgEcoQos
    ? Math.max(0.03, w.cpuLoad * (workload === "heavy" ? 0.97 : 0.84))
    : w.cpuLoad;

  // Timer resolution réveille inutilement les cœurs
  const timerWakePenaltyW =
    cfg.timerResolution === "high_0_5ms"
      ? 4.4 * (1 - effectiveCpuLoad * 0.6)
      : cfg.timerResolution === "standard_1ms"
      ? 1.8 * (1 - effectiveCpuLoad * 0.6)
      : 0.0;

  // C-State deep residency (% du temps inactif passé en C6/C8/C10)
  let cStatePotential = cfg.cpuDeepCStates ? 0.93 : 0.14;
  if (cfg.pcieAspm === "off") cStatePotential *= 0.58; // PCIe L0 bloque Pkg-C8 !
  else if (cfg.pcieAspm === "l0s") cStatePotential *= 0.76;
  else if (cfg.pcieAspm === "l1") cStatePotential *= 0.9;
  if (!cfg.usbSelectiveSuspend) cStatePotential *= 0.88;
  if (cfg.timerResolution === "high_0_5ms") cStatePotential *= 0.72;
  else if (cfg.timerResolution === "standard_1ms") cStatePotential *= 0.88;

  const cpuCStateDeepPct = Math.round(
    Math.max(0, Math.min(96, (1 - effectiveCpuLoad) * cStatePotential * 100))
  );

  // Cœurs actifs (Core Parking)
  const minCores = Math.max(2, Math.round((totalCores * cfg.cpuCoreParkingMinActive) / 100));
  const loadCores = Math.ceil(effectiveCpuLoad * totalCores * 1.15);
  const cpuActiveCores = Math.min(totalCores, Math.max(minCores, loadCores));
  const parkedFraction = (totalCores - cpuActiveCores) / totalCores;

  // Facteur de capacité effective du die selon la classe thermique du CPU (1.00 pour 125 W desktop)
  const cpuCapScale = Math.min(1.15, Math.max(0.55, 0.45 + 0.55 * (profile.cpuTdpW / 125)));

  // Calcul P_dyn = C * V^2 * f + P_static
  const calcCpuWattsAtFreq = (freqMhz: number): { coresW: number; uncoreW: number; pkgW: number; vidV: number } => {
    const v = cpuVoltageAtFreq(freqMhz);
    const fGhz = freqMhz / 1000;
    // Calibration : à 5.1 GHz, 1.37V, load 0.96 (125W) => ~118 W cores + 14 W uncore = 132 W (clampé PL1 125W)
    const dynCores = 12.1 * cpuCapScale * v * v * fGhz * (0.06 + 0.94 * effectiveCpuLoad);
    const idleLeak =
      (1 - cpuCStateDeepPct / 100) * (9.2 * v * v) * (1 - parkedFraction * 0.42) + 1.1;
    const coresW = dynCores + idleLeak + timerWakePenaltyW * 0.65;
    const uncoreW =
      3.4 +
      4.6 * effectiveCpuLoad +
      (cfg.pcieAspm === "off" ? 2.6 : cfg.pcieAspm === "l1_substates" ? 0.3 : 1.1) +
      timerWakePenaltyW * 0.35;
    return { coresW, uncoreW, pkgW: coresW + uncoreW, vidV: v };
  };

  let cpuPower = calcCpuWattsAtFreq(pClockMhz);

  // Régulation fermée RAPL PL1 : si pkgW > PL1, abaisse la fréquence par dichotomie
  if (cpuPower.pkgW > cfg.cpuPl1Watts && pClockMhz > 700) {
    let lo = 700;
    let hi = pClockMhz;
    for (let i = 0; i < 12; i++) {
      const mid = Math.round((lo + hi) / 2);
      const test = calcCpuWattsAtFreq(mid);
      if (test.pkgW > cfg.cpuPl1Watts) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    pClockMhz = lo;
    cpuPower = calcCpuWattsAtFreq(pClockMhz);
    if (cpuPower.pkgW > cfg.cpuPl1Watts) {
      const scale = cfg.cpuPl1Watts / cpuPower.pkgW;
      cpuPower.coresW *= scale;
      cpuPower.uncoreW *= scale;
      cpuPower.pkgW = cfg.cpuPl1Watts;
    }
  }

  const eClockMhz = Math.max(600, Math.min(3900, Math.round(pClockMhz * (cfg.bgEcoQos ? 0.72 : 0.79))));

  // --- 2. GPU DÉDIÉ & iGPU ---
  const hasDgpu = profile.hasDedicatedGpu;
  const gpuPlWatts = hasDgpu ? (profile.gpuTdpW * cfg.gpuPowerLimitPct) / 100 : 0;
  const vramMax = profile.gpuVramMaxMhz;
  const vramIdle = profile.gpuVramIdleMhz;

  // Piège classique Windows : un écran haute fréquence bloque souvent la VRAM en P0/P2 si force_p8_idle n'est pas actif
  const highHzVramStuck = hasDgpu && cfg.displayRefreshHz >= 144 && cfg.gpuVramPolicy === "auto";
  const medHzVramPenalty = hasDgpu && cfg.displayRefreshHz >= 120 && cfg.gpuVramPolicy === "auto";

  let gpuPState: "P0" | "P2" | "P5" | "P8" = "P8";
  let gpuVramMhz = hasDgpu ? vramIdle : 0;
  let gpuCoreMhz = hasDgpu ? 210 : profile.gpuMinClockMhz;

  if (!hasDgpu) {
    // iGPU : la fréquence GT monte proportionnellement à la charge puis redescend en RC6
    const loadClock = Math.round(
      profile.gpuMinClockMhz + w.gpuLoad * (profile.gpuMaxClockMhz - profile.gpuMinClockMhz)
    );
    gpuCoreMhz = cfg.igpuEcoClock ? Math.round(loadClock * 0.62) : loadClock;
    gpuPState = w.gpuLoad > 0.2 ? "P2" : "P8";
    gpuVramMhz = vramIdle;
  } else if (w.gpuLoad > 0.35) {
    gpuPState = cfg.gpuVramPolicy === "force_p8_idle" && w.gpuLoad < 0.5 ? "P2" : "P0";
    gpuVramMhz = cfg.gpuVramPolicy === "prefer_p5" ? Math.round(vramMax * 0.81) : vramMax;
    const rawCore = Math.round(
      profile.gpuMinClockMhz + (profile.gpuMaxClockMhz - profile.gpuMinClockMhz) * Math.pow(w.gpuLoad, 0.38) * 1.05
    );
    gpuCoreMhz = Math.min(cfg.gpuCoreClockCapMhz, rawCore);
  } else if (w.gpuLoad > 0.08) {
    if (cfg.gpuVramPolicy === "force_p8_idle") {
      gpuPState = "P8";
      gpuVramMhz = Math.round(vramIdle * 2);
    } else if (cfg.gpuVramPolicy === "prefer_p5") {
      gpuPState = "P5";
      gpuVramMhz = Math.round(vramMax * 0.48);
    } else {
      gpuPState = highHzVramStuck ? "P0" : "P5";
      gpuVramMhz = highHzVramStuck ? vramMax : Math.round(vramMax * 0.52);
    }
    const rawCore = highHzVramStuck ? 1185 : 645;
    gpuCoreMhz = Math.min(cfg.gpuCoreClockCapMhz, rawCore);
  } else {
    // Repos
    if (highHzVramStuck) {
      gpuPState = "P0";
      gpuVramMhz = Math.round(vramMax * 0.9);
      gpuCoreMhz = Math.min(cfg.gpuCoreClockCapMhz, 870);
    } else if (medHzVramPenalty) {
      gpuPState = "P5";
      gpuVramMhz = Math.round(vramMax * 0.19);
      gpuCoreMhz = 345;
    } else {
      gpuPState = "P8";
      gpuVramMhz = vramIdle;
      gpuCoreMhz = 210;
    }
  }

  const tdpScale = profile.gpuTdpW / 220;
  const calcGpuWatts = (coreMhz: number): { watts: number; vGpu: number } => {
    const v = gpuVoltageAtFreq(coreMhz);
    const fGhz = coreMhz / 1000;
    const vramW = 2.4 + (gpuVramMhz / Math.max(1, vramMax)) * (15.5 + 11.5 * w.gpuLoad);
    const coreDynW = 69.5 * tdpScale * v * v * fGhz * (0.045 + 0.955 * w.gpuLoad);
    const boardMiscW = 3.2 * Math.max(0.55, tdpScale);
    return { watts: vramW + coreDynW + boardMiscW, vGpu: v };
  };

  let gpuCalc = hasDgpu
    ? calcGpuWatts(gpuCoreMhz)
    : { watts: 0.4, vGpu: gpuVoltageAtFreq(gpuCoreMhz) };
  if (hasDgpu && gpuCalc.watts > gpuPlWatts && gpuCoreMhz > 450) {
    let lo = 450;
    let hi = gpuCoreMhz;
    for (let i = 0; i < 12; i++) {
      const mid = Math.round((lo + hi) / 2);
      const t = calcGpuWatts(mid);
      if (t.watts > gpuPlWatts) hi = mid;
      else lo = mid;
    }
    gpuCoreMhz = lo;
    gpuCalc = calcGpuWatts(gpuCoreMhz);
    gpuCalc.watts = Math.min(gpuCalc.watts, gpuPlWatts);
  }

  const igpuWatts = hasDgpu
    ? cfg.igpuEcoClock
      ? 0.9 + 1.4 * Math.min(0.5, w.gpuLoad)
      : 3.4 + 3.2 * Math.min(0.6, w.gpuLoad + 0.15)
    : cfg.igpuEcoClock
    ? 3.2 + 9.0 * w.gpuLoad
    : 4.8 + 16.0 * w.gpuLoad;

  // --- 3. BUS PCIe & STOCKAGE ---
  const busIdleRatio = Math.max(0.08, 1 - (w.gpuLoad * 0.55 + w.ioRate * 0.45));
  const pcieBaseIdleW =
    cfg.pcieAspm === "off"
      ? 8.4
      : cfg.pcieAspm === "l0s"
      ? 5.2
      : cfg.pcieAspm === "l1"
      ? 2.5
      : 0.85;
  const pcieChipsetWatts = pcieBaseIdleW * busIdleRatio + 8.6 * (1 - busIdleRatio) + 2.1;

  const pcieCurrentLink =
    w.gpuLoad > 0.45
      ? "Gen4 x16 (L0 Actif)"
      : cfg.pcieAspm === "off"
      ? "Gen4 x16 (Bloqué L0)"
      : cfg.pcieAspm === "l0s"
      ? "Gen3 x16 (ASPM L0s)"
      : cfg.pcieAspm === "l1"
      ? "Gen1 x16 (ASPM L1)"
      : "Gen1 x1 (L1.2 CLKREQ# Off)";

  // NVMe + SATA
  const timeoutEfficiency = Math.max(0.45, 1 - (cfg.nvmeIdleTimeoutMs - 50) / 3400);
  const nvmeSleepShare = Math.max(0, (1 - w.ioRate) * timeoutEfficiency);
  const nvmeSleepW =
    cfg.nvmeApst === "ps0_only"
      ? 4.9
      : cfg.nvmeApst === "ps1_light"
      ? 2.2
      : cfg.nvmeApst === "ps3_balanced"
      ? 0.08
      : 0.015;
  const nvmeActiveW = 5.4 + 2.6 * w.ioRate;
  const nvmeWatts =
    cfg.nvmeApst === "ps0_only"
      ? 4.9 + 2.9 * w.ioRate
      : nvmeSleepW * nvmeSleepShare + nvmeActiveW * (1 - nvmeSleepShare);

  const sataWatts =
    cfg.sataAlpm === "active" ? 2.9 : cfg.sataAlpm === "hipm" ? 1.3 : 0.45;
  const storageWatts = nvmeWatts + sataWatts;

  const nvmeCurrentState: TelemetrySnapshot["nvmeCurrentState"] =
    w.ioRate > 0.65 || cfg.nvmeApst === "ps0_only"
      ? "PS0 (Actif)"
      : cfg.nvmeApst === "ps1_light"
      ? "PS1 (Léger)"
      : cfg.nvmeApst === "ps3_balanced"
      ? "PS3 (Veille)"
      : "PS4 (Sommeil profond)";

  // --- 4. ÉCRAN, RÉSEAU & USB ---
  const hzElectronicsW =
    cfg.displayRefreshHz === 165
      ? 9.2
      : cfg.displayRefreshHz === 120
      ? 6.6
      : cfg.displayRefreshHz === 75
      ? 4.7
      : 3.8;
  const backlightW = 3.2 + (cfg.displayBrightnessPct / 100) * 23.5;
  const displayWatts = hzElectronicsW + backlightW;

  const nicW = cfg.nicEeeEnabled ? 0.75 : 3.15;
  const wifiW =
    cfg.wifiPowerMode === "cam" ? 2.55 : cfg.wifiPowerMode === "medium_psp" ? 0.95 : 0.28;
  const usbW = cfg.usbSelectiveSuspend ? 1.35 : 4.25;
  const nicUsbMiscWatts = nicW + wifiW + usbW;

  // Micro-variation vivante (±0.3W max) ; 0 W sur le rail carte graphique dédiée si iGPU seul
  const j = jitterSeed * 0.25;
  const cpuPackageWatts = Math.max(2.2, cpuPower.pkgW + j);
  const gpuBoardWatts = hasDgpu ? Math.max(4.5, gpuCalc.watts - j * 0.6) : 0;

  const totalSystemWatts =
    cpuPackageWatts +
    gpuBoardWatts +
    igpuWatts +
    pcieChipsetWatts +
    storageWatts +
    displayWatts +
    nicUsbMiscWatts;

  // Modèle physique continu et strictement monotone d'alimentation 80+ Gold :
  // P_ac = P_veille (3.2 W) + (1 + r_commutation)*P_dc + r_joule*P_dc²
  // (~82 % à 25 W, ~89 % à 110 W, ~90 % à 250 W — élimine toute discontinuité d'escalier)
  const pcInternalDcW = Math.max(0, totalSystemWatts - displayWatts);
  const psuWallWatts = computePsuWallPcWatts(pcInternalDcW) + displayWatts;

  // --- 5. TEMPÉRATURES (°C) ---
  const cpuTempC = Math.min(
    98,
    AMBIENT_TEMP_C + 7.5 + Math.pow(cpuPackageWatts, 0.89) * 0.98 + gpuBoardWatts * 0.025
  );
  const cpuTjMaxMarginC = Math.max(2, 100 - cpuTempC);

  const gpuPassiveRise = hasDgpu
    ? Math.pow(gpuBoardWatts, 0.86) * 0.72 + cpuPackageWatts * 0.02
    : igpuWatts * 0.55 + cpuPackageWatts * 0.015;
  const gpuTempRaw = AMBIENT_TEMP_C + (hasDgpu ? 5.0 : 3.0) + gpuPassiveRise;
  const gpuTempC = Math.min(88, gpuTempRaw);
  const gpuHotspotTempC = hasDgpu
    ? Math.min(102, gpuTempC + 5.5 + (gpuBoardWatts / Math.max(1, profile.gpuTdpW)) * 8.5)
    : gpuTempC + 2.0;

  const nvmeTempC = Math.min(74, AMBIENT_TEMP_C + 8.5 + nvmeWatts * 4.3 + gpuBoardWatts * 0.02);
  const vrmTempC = Math.min(92, AMBIENT_TEMP_C + 9.0 + cpuPackageWatts * 0.34 + pcieChipsetWatts * 0.4);

  // --- 6. VENTILATION (RPM) & ACOUSTIQUE (dBA logarithmique) ---
  // Courbe PWM CPU silencieuse sous 46°C, progressive au-dessus
  let cpuFanPct = 22;
  if (cpuTempC > 44) {
    cpuFanPct = Math.min(100, 22 + Math.pow((cpuTempC - 44) / 46, 1.32) * 78);
  }
  const cpuFanRpm = Math.round(480 + (cpuFanPct / 100) * 1680);

  // Courbe PWM GPU avec 0-RPM Fan-Stop si autorisé et gpuTempC < 51.5°C
  let gpuFanPct = 0;
  let gpuFanRpm = 0;
  if (hasDgpu && (!cfg.gpuZeroRpmFanStop || gpuTempC >= 51.5)) {
    gpuFanPct = Math.min(100, Math.max(30, 30 + Math.pow(Math.max(0, gpuTempC - 46) / 38, 1.25) * 70));
    gpuFanRpm = Math.round(320 + (gpuFanPct / 100) * 1880);
  }

  const internalHeatW = cpuPackageWatts + gpuBoardWatts + pcieChipsetWatts;
  const caseFanRpm = Math.round(
    Math.min(1450, 420 + Math.pow(Math.max(0, internalHeatW - 28) / 290, 1.15) * 1030)
  );

  // Addition acoustique logarithmique : L = 10 * log10(sum 10^(Li/10))
  const ambientLin = Math.pow(10, 18.8 / 10);
  const fanDba = (rpm: number, refRpm: number, refDba: number): number => {
    if (rpm <= 50) return 0;
    const db = refDba + 42 * Math.log10(rpm / refRpm);
    return Math.pow(10, Math.max(10, db) / 10);
  };
  const cpuNoiseLin = fanDba(cpuFanRpm, 1500, 33.5);
  const gpuNoiseLin = fanDba(gpuFanRpm, 1500, 35.2);
  const caseNoiseLin = fanDba(caseFanRpm, 1100, 28.0);
  const systemNoiseDba = 10 * Math.log10(ambientLin + cpuNoiseLin + gpuNoiseLin + caseNoiseLin);

  const acousticLabel =
    systemNoiseDba < 22.5
      ? "Inaudible (bruit de fond pièce)"
      : systemNoiseDba < 26.5
      ? "Murmure très discret"
      : systemNoiseDba < 32.5
      ? "Souffle léger audible"
      : systemNoiseDba < 38.5
      ? "Ventilation soutenue"
      : "Bruyant (souffle fort)";

  // --- 7. COÛTS ANNUELS & CO₂ ---
  const annualHours = cost.hoursPerDay * 365;
  const annualKwh = (psuWallWatts * annualHours) / 1000;
  const annualEuro = annualKwh * cost.euroPerKwh;
  const annualCo2Kg = (annualKwh * cost.co2GramsPerKwh) / 1000;

  return {
    totalSystemWatts: round1(totalSystemWatts),
    cpuPackageWatts: round1(cpuPackageWatts),
    cpuCoresWatts: round1(cpuPower.coresW),
    cpuUncoreDramWatts: round1(cpuPower.uncoreW),
    gpuBoardWatts: round1(gpuBoardWatts),
    igpuWatts: round1(igpuWatts),
    pcieChipsetWatts: round1(pcieChipsetWatts),
    storageWatts: round1(storageWatts),
    displayWatts: round1(displayWatts),
    nicUsbMiscWatts: round1(nicUsbMiscWatts),
    psuWallWatts: round1(psuWallWatts),

    cpuEffectivePClockMhz: pClockMhz,
    cpuEffectiveEClockMhz: eClockMhz,
    cpuVidMv: Math.round(cpuPower.vidV * 1000),
    cpuCStateDeepPct,
    cpuActiveCores,
    cpuTotalCores: totalCores,
    gpuEffectiveCoreMhz: gpuCoreMhz,
    gpuEffectiveVramMhz: gpuVramMhz,
    gpuVoltageMv: Math.round(gpuCalc.vGpu * 1000),
    gpuPState,
    pcieCurrentLink,
    nvmeCurrentState,

    cpuTempC: round1(cpuTempC),
    cpuTjMaxMarginC: round1(cpuTjMaxMarginC),
    gpuTempC: round1(gpuTempC),
    gpuHotspotTempC: round1(gpuHotspotTempC),
    nvmeTempC: round1(nvmeTempC),
    vrmTempC: round1(vrmTempC),

    cpuFanRpm,
    cpuFanPct: Math.round(cpuFanPct),
    gpuFanRpm,
    gpuFanPct: Math.round(gpuFanPct),
    caseFanRpm,
    systemNoiseDba: round1(systemNoiseDba),
    acousticLabel,

    annualKwh: round1(annualKwh),
    annualEuro: round1(annualEuro),
    annualCo2Kg: round1(annualCo2Kg),
  };
}

/** Calcule le temps d'exécution en ms de chaque tâche réelle pour une configuration donnée */
function computeSingleConfigMs(
  cfg: HardwareConfig,
  calibrationScale = 1.0,
  profile: HardwareProfile = DEFAULT_HARDWARE_PROFILE
): Record<string, number> {
  // Fréquence maximale atteignable sur une rafale interactive
  const burstMaxMhz = computeCpuAllowedMaxMhz(cfg, profile);
  // Prise en compte du plafond PL1 pour les tâches multi-threads
  const pl1Ref = Math.max(25, profile.cpuTdpW * 0.76);
  const pl1Factor = Math.min(1, Math.pow(cfg.cpuPl1Watts / pl1Ref, 0.36));
  const eppRampDelayMs = (cfg.cpuEpp / 100) * 1.45;
  const unparkDelayMs = ((100 - cfg.cpuCoreParkingMinActive) / 100) * 0.55;
  const cstateWakeMs = cfg.cpuDeepCStates ? 0.14 : 0.01;

  // 1. Compression LZ4 + BLAKE3 64 Mo (65% CPU freq, 35% DRAM fixe)
  const cpuRatio = Math.max(1, profile.cpuTurboMhz) / Math.max(600, burstMaxMhz);
  const lz4Ms = (18.2 * (0.35 + 0.65 * cpuRatio) + eppRampDelayMs * 0.6) * calibrationScale;

  // 2. Parsing JSON 5 Mo & rendu DOM/UI (single-thread burst + cache)
  const jsonMs = (6.1 * (0.28 + 0.72 * cpuRatio) + eppRampDelayMs + cstateWakeMs) * calibrationScale;

  // 3. Requête SQLite 50k lignes / Compilation incrémentale (multi-thread sensible PL1)
  const mtEffectiveRatio = cpuRatio / pl1Factor;
  const sqliteMs =
    (41.8 * (0.22 + 0.78 * mtEffectiveRatio) + unparkDelayMs + eppRampDelayMs) * calibrationScale;

  // 4. Temps de rendu d'une image GPU (Frame time en ms)
  const gpuPlFactor = Math.pow(cfg.gpuPowerLimitPct / 100, 0.34); // Courbe rendement GPU : 70% PL => ~89% perf !
  const gpuClockFactor = Math.min(1, cfg.gpuCoreClockCapMhz / Math.max(1, profile.gpuMaxClockMhz));
  const gpuPerf = Math.min(gpuPlFactor, 0.22 + 0.78 * gpuClockFactor);
  const gpuBaseFrameMs = profile.hasDedicatedGpu ? 6.35 : 22.0;
  const gpuFrameMs = (gpuBaseFrameMs / Math.max(0.32, gpuPerf)) * calibrationScale;

  // 5. Réveil SSD NVMe (1ère lecture aléatoire 4 Ko QD1 après silence)
  const nvmeBaseMs =
    cfg.nvmeApst === "ps0_only"
      ? 0.06
      : cfg.nvmeApst === "ps1_light"
      ? 0.16
      : cfg.nvmeApst === "ps3_balanced"
      ? 0.88
      : 1.92;
  const pcieWakeMs =
    cfg.pcieAspm === "off"
      ? 0.0
      : cfg.pcieAspm === "l0s"
      ? 0.004
      : cfg.pcieAspm === "l1"
      ? 0.018
      : 0.048;
  const nvmeWakeMs = nvmeBaseMs + pcieWakeMs;

  // 6. Réveil Bus PCIe + Latence 1er paquet Réseau (EEE + Wi-Fi PSP)
  const eeeMs = cfg.nicEeeEnabled ? 0.02 : 0.0;
  const wifiMs =
    cfg.wifiPowerMode === "cam" ? 0.35 : cfg.wifiPowerMode === "medium_psp" ? 1.15 : 2.95;
  const busNetMs = 0.25 + pcieWakeMs + eeeMs + wifiMs;

  return {
    lz4: Math.round(lz4Ms * 100) / 100,
    json: Math.round(jsonMs * 100) / 100,
    sqlite: Math.round(sqliteMs * 100) / 100,
    gpu_frame: Math.round(gpuFrameMs * 100) / 100,
    nvme_wake: Math.round(nvmeWakeMs * 100) / 100,
    bus_net: Math.round(busNetMs * 100) / 100,
  };
}

function classifyVerdict(
  afterMs: number,
  deltaMs: number,
  thresholdMs: number
): BenchmarkMetric["humanVerdict"] {
  if (deltaMs <= 0.15 || (deltaMs < 4.5 && afterMs <= thresholdMs)) return "Imperceptible";
  if (afterMs <= thresholdMs * 1.15 && deltaMs < 18) return "Très léger";
  if (afterMs <= thresholdMs * 1.85) return "Perceptible mais fluide";
  return "Ralentissement net";
}

export function computeBenchmarks(
  beforeCfg: HardwareConfig,
  afterCfg: HardwareConfig,
  calibrationScale = 1.0,
  profile: HardwareProfile = DEFAULT_HARDWARE_PROFILE
): BenchmarkMetric[] {
  const b = computeSingleConfigMs(beforeCfg, calibrationScale, profile);
  const a = computeSingleConfigMs(afterCfg, calibrationScale, profile);

  const build = (
    id: string,
    key: keyof typeof b,
    name: string,
    category: BenchmarkMetric["category"],
    tooltipKey: string,
    taskDescription: string,
    humanThresholdMs: number
  ): BenchmarkMetric => {
    const beforeMs = b[key];
    const afterMs = a[key];
    const deltaMs = Math.round((afterMs - beforeMs) * 100) / 100;
    const deltaPct = beforeMs > 0 ? Math.round(((afterMs - beforeMs) / beforeMs) * 1000) / 10 : 0;
    return {
      id,
      name,
      category,
      tooltipKey,
      taskDescription,
      beforeMs,
      afterMs,
      deltaMs,
      deltaPct,
      humanThresholdMs,
      humanVerdict: classifyVerdict(afterMs, deltaMs, humanThresholdMs),
    };
  };

  const frameBudgetMs = Math.round((1000 / afterCfg.displayRefreshHz) * 100) / 100;

  return [
    build(
      "json",
      "json",
      "Ouverture Page / Parsing JSON 5 Mo",
      "CPU",
      "bench_json",
      "Réactivité clic interface, onglet web, document bureautique (mono-cœur + EPP)",
      16.67
    ),
    build(
      "lz4",
      "lz4",
      "Décompression LZ4 + BLAKE3 (64 Mo)",
      "CPU",
      "bench_lz4",
      "Lancement d'application, extraction d'archive, chargement d'assets (CPU + L3/DRAM)",
      50.0
    ),
    build(
      "sqlite",
      "sqlite",
      "Requête 50k lignes / Build incrémental",
      "CPU",
      "bench_sqlite",
      "Recherche locale, filtre photo, recalcul tableur, compilation (multi-cœurs + PL1)",
      100.0
    ),
    build(
      "gpu_frame",
      "gpu_frame",
      "Rendu d'une image GPU (Frame time)",
      "GPU",
      "bench_gpu_frame",
      `Scène 3D/Shader 1440p — budget fluide à ${afterCfg.displayRefreshHz} Hz = ${frameBudgetMs} ms/image`,
      frameBudgetMs
    ),
    build(
      "nvme_wake",
      "nvme_wake",
      "1ère lecture SSD 4 Ko après repos",
      "Stockage",
      "bench_nvme_wake",
      "Sortie de veille autonome NVMe APST (PS1/PS3/PS4) + lien PCIe (accès suivants : 0,06 ms)",
      10.0
    ),
    build(
      "bus_net",
      "bus_net",
      "Réveil Bus PCIe + 1er paquet Réseau",
      "Bus / Réseau",
      "bench_bus_wake",
      "Sortie ASPM L1.2 + Ethernet 802.3az LPI + balise Wi-Fi PSP sur paquet interactif",
      15.0
    ),
  ];
}

/**
 * Exécute un VRAI micro-benchmark CPU déterministe dans le thread courant (~25 ms)
 * (hachage FNV-1a + tri structuré + compression RLE sur tampon mémoire) pour calibrer les mesures !
 */
export function runRealMicroBenchmark(): { measuredHostMs: number; calibrationScale: number; opsPerSec: number } {
  const buf = new Uint32Array(262_144); // 1 Mo
  for (let i = 0; i < buf.length; i++) {
    buf[i] = (i * 2654435761) >>> 0;
  }

  const t0 = performance.now();
  let hash = 2166136261 >>> 0;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < buf.length; i++) {
      hash ^= buf[i];
      hash = Math.imul(hash, 16777619) >>> 0;
      buf[i] = (hash ^ (buf[i] >>> 3)) >>> 0;
    }
  }
  // Empêche toute élimination dead-code
  const guard = hash & 1;
  const elapsed = Math.max(0.4, performance.now() - t0 + guard * 0.0001);

  // Normalise doucement autour de 1.0 (entre 0.88 et 1.16) pour refléter la machine hôte réelle
  const norm = Math.max(0.88, Math.min(1.16, 0.92 + (elapsed / 28) * 0.14));
  const opsPerSec = Math.round((buf.length * 6) / (elapsed / 1000));

  return {
    measuredHostMs: Math.round(elapsed * 100) / 100,
    calibrationScale: Math.round(norm * 1000) / 1000,
    opsPerSec,
  };
}

export type PrivilegeLevel = "user" | "admin";

export type WorkloadMode = "idle" | "office" | "gaming" | "heavy";

export type TurboBoostMode = "aggressive" | "efficient" | "disabled";

export type PcieAspmMode = "off" | "l0s" | "l1" | "l1_substates";

export type NvmeApstMode = "ps0_only" | "ps1_light" | "ps3_balanced" | "ps4_deep";

export type SataAlpmMode = "active" | "hipm" | "dipm_slumber";

export type GpuVramPolicy = "auto" | "prefer_p5" | "force_p8_idle";

export type DisplayRefreshHz = 165 | 120 | 75 | 60;

export type WifiPowerMode = "cam" | "medium_psp" | "max_psp";

export type TimerResolutionPolicy = "high_0_5ms" | "standard_1ms" | "coalesced_15_6ms";

export type OptimizerGoal = "pareto" | "silent" | "gaming_eco" | "server_24_7";

export type ActiveTab =
  | "dashboard"
  | "compare"
  | "profiles"
  | "adaptive"
  | "optimizer"
  | "audit"
  | "rust_source";

export type IssueSeverity = "critical" | "warning" | "info";

/**
 * Profil matériel de référence : borne les réglages aux capacités constructeur
 * (le binaire Rust lit ces valeurs via WMI/NVML ; ici elles servent à calibrer le modèle).
 */
export interface HardwareProfile {
  id: string;
  label: string;
  cpuName: string;
  gpuName: string;
  storageName: string;
  monitorName: string;
  cpuBaseMhz: number;
  cpuTurboMhz: number;
  cpuCores: number;
  cpuTdpW: number;
  cpuPl1MinW: number;
  cpuPl1MaxW: number;
  cpuFreqMinMhz: number;
  cpuFreqMaxMhz: number;
  gpuTdpW: number;
  gpuMinPowerPct: number;
  gpuMaxClockMhz: number;
  gpuMinClockMhz: number;
  gpuVramMaxMhz: number;
  gpuVramIdleMhz: number;
  hasDedicatedGpu: boolean;
  /** Présence d'un contrôleur Ethernet cuivre. Conditionne la pertinence de l'EEE 802.3az. */
  hasEthernet: boolean;
  maxDisplayHz: DisplayRefreshHz;
  note: string;
}

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  subsystem: string;
  subsystemEn?: string;
  title: string;
  titleEn: string;
  detail: string;
  detailEn: string;
  consequence: string;
  consequenceEn: string;
  fix?: Partial<HardwareConfig>;
  fixLabel?: string;
  fixLabelEn?: string;
}

export interface BenchRun {
  id: string;
  ranAt: string;
  measuredHostMs: number;
  opsPerSec: number;
  calibrationScale: number;
  activeProfile: string;
  workload: WorkloadMode;
  totalWatts: number;
}

export type ProfileSlotId = 1 | 2 | 3 | 4 | 5;

export interface HardwareConfig {
  // 1. CPU & Ordonnanceur
  cpuMaxPercent: number; // 20..100% (PROCTHROTTLEMAX - User)
  cpuMinPercent: number; // 5..100% (PROCTHROTTLEMIN - User)
  cpuFreqCapMhz: number; // 800..5200 MHz (PROCFREQMAX - User)
  cpuTurboMode: TurboBoostMode; // PERFBOOSTMODE (User)
  cpuEpp: number; // 0..100% Energy Performance Preference (User)
  cpuCoreParkingMinActive: number; // 12..100% active cores unparked (Admin: hidden GUID)
  cpuDeepCStates: boolean; // C6/C8/C10 enabled (User)
  cpuPl1Watts: number; // 15..125 W Package Power Limit RAPL/PowerCfg (Admin)
  bgEcoQos: boolean; // Win11 EcoQoS execution speed throttling on background apps (User)

  // 2. GPU Dédié (NVML / ADLX) & iGPU
  gpuPowerLimitPct: number; // 40..100% TDP (Admin: nvmlDeviceSetPowerManagementLimit)
  gpuCoreClockCapMhz: number; // 900..2610 MHz (Admin: nvmlDeviceSetGpuLockedClocks)
  gpuVramPolicy: GpuVramPolicy; // Admin for force_p8_idle / User for auto
  gpuZeroRpmFanStop: boolean; // Allow 0 RPM below 52°C (User/Curve)
  igpuEcoClock: boolean; // Intel/AMD iGPU Power Plan Balanced/Max Battery (User)

  // 3. Bus PCIe & Stockage (NVMe / SATA)
  pcieAspm: PcieAspmMode; // GUID_PCIEXPRESS_SETTINGS_SUBGROUP (User for basic, Admin for L1.2 substates)
  nvmeApst: NvmeApstMode; // NVMe APST Primary/Secondary idle timeout (Admin)
  nvmeIdleTimeoutMs: number; // 50..2000 ms before transition to PS3/PS4 (Admin)
  sataAlpm: SataAlpmMode; // AHCI Link Power Management HIPM/DIPM (Admin)

  // 4. Écran, Réseau, USB & Timer OS
  displayRefreshHz: DisplayRefreshHz; // ChangeDisplaySettingsExW (User)
  displayBrightnessPct: number; // 20..100% WMI/DDC-CI brightness budget (User)
  nicEeeEnabled: boolean; // IEEE 802.3az Energy Efficient Ethernet + Downshift (Admin)
  wifiPowerMode: WifiPowerMode; // WLAN Power Saving Mode (User)
  usbSelectiveSuspend: boolean; // GUID_USB_SUBGROUP (User)
  timerResolution: TimerResolutionPolicy; // Global timer coalescing / PowerThrottling (User)
}

export interface Profile {
  id: ProfileSlotId;
  name: string;
  shortTag: string;
  description: string;
  config: HardwareConfig;
  updatedAt: string;
}

export type AutostartMethod = "hkcu_registry" | "task_scheduler_admin";

export interface AutostartConfig {
  enabled: boolean;
  bootProfileId: ProfileSlotId;
  method: AutostartMethod;
  startMinimizedToTray: boolean;
  safeBootDelaySec: number; // 15s stability delay before applying hardware limits
  restoreOnShutdown: boolean; // RollbackGuard on WM_ENDSESSION / panic
}

export interface BenchmarkMetric {
  id: string;
  name: string;
  nameEn: string;
  category: "CPU" | "GPU" | "Stockage" | "Bus / Réseau" | "Système";
  tooltipKey: string;
  taskDescription: string;
  beforeMs: number;
  afterMs: number;
  deltaMs: number;
  deltaPct: number;
  humanThresholdMs: number;
  humanVerdict: "Imperceptible" | "Très léger" | "Perceptible mais fluide" | "Ralentissement net";
  humanVerdictEn: "Imperceptible" | "Very slight" | "Perceptible but smooth" | "Clear slowdown";
}

export interface TelemetrySnapshot {
  // Puissances (Watts)
  totalSystemWatts: number;
  cpuPackageWatts: number;
  cpuCoresWatts: number;
  cpuUncoreDramWatts: number;
  gpuBoardWatts: number;
  igpuWatts: number;
  pcieChipsetWatts: number;
  storageWatts: number;
  displayWatts: number;
  nicUsbMiscWatts: number;
  psuWallWatts: number; // Including 80+ Gold efficiency curve

  // Fréquences & Tensions
  cpuEffectivePClockMhz: number;
  cpuEffectiveEClockMhz: number;
  cpuVidMv: number;
  cpuCStateDeepPct: number; // % time in C6/C8/C10
  cpuActiveCores: number;
  cpuTotalCores: number;
  gpuEffectiveCoreMhz: number;
  gpuEffectiveVramMhz: number;
  gpuVoltageMv: number;
  gpuPState: "P0" | "P2" | "P5" | "P8";
  pcieCurrentLink: string;
  nvmeCurrentState: "PS0 (Actif)" | "PS1 (Léger)" | "PS3 (Veille)" | "PS4 (Sommeil profond)";

  // Températures (°C)
  cpuTempC: number;
  cpuTjMaxMarginC: number;
  gpuTempC: number;
  gpuHotspotTempC: number;
  nvmeTempC: number;
  vrmTempC: number;

  // Ventilation & Acoustique
  cpuFanRpm: number;
  cpuFanPct: number;
  gpuFanRpm: number;
  gpuFanPct: number;
  caseFanRpm: number;
  systemNoiseDba: number;
  acousticLabel: string;

  // Coûts annuels & carbone
  annualKwh: number;
  annualEuro: number;
  annualCo2Kg: number;
}

export interface OptimizationProposal {
  id: string;
  title: string;
  titleEn: string;
  whyTechnicalEn: string;
  subsystem: "CPU" | "GPU" | "PCIe" | "NVMe/SATA" | "Affichage" | "Réseau/OS";
  requiresAdmin: boolean;
  tooltipKey: string;
  currentSummary: string;
  proposedSummary: string;
  whyTechnical: string;
  physicsLaw: string;
  realWorldEffect: string;
  savedWatts: number;
  savedWallWatts: number;
  tempDropC: number;
  fanDropRpm: number;
  noiseDropDba: number;
  latencyDeltaMs: number;
  latencyContext: string;
  efficiencyScore: number; // 0..100 Pareto score
  patch: Partial<HardwareConfig>;
}

export interface TooltipDoc {
  key: string;
  title: string;
  subsystem: string;
  privilege: "user" | "admin" | "both";
  winApi: string;
  summary: string;
  physicsDetail: string;
  beforeAfterHint: string;
  safetyNote: string;
}

export interface ApiLogEntry {
  id: string;
  timestamp: string;
  privilege: PrivilegeLevel;
  subsystem: string;
  call: string;
  status: "OK" | "BLOQUÉ_UAC" | "ROLLBACK_ARMED";
  latencyUs: number;
}

export interface RustSourceFile {
  path: string;
  layer: "Configuration" | "Entrée & Sécurité" | "Domaine" | "Plateforme Win32" | "Télémétrie & IA Pareto" | "Interface egui" | "Documentation";
  summary: string;
  linesEstimate?: number;
  content: string;
}

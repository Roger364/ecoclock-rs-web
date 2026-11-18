import {
  DisplayRefreshHz,
  HardwareConfig,
  HardwareProfile,
  OptimizationProposal,
  OptimizerGoal,
  WorkloadMode,
} from "../types/hardware";
import { DEFAULT_HARDWARE_PROFILE } from "../data/hardwareProfiles";
import { computeBenchmarks, computeTelemetry } from "./physics";
import { clampConfigToProfile } from "./validation";

interface CandidateRule {
  id: string;
  title: string | ((profile: HardwareProfile) => string);
  titleEn: string | ((profile: HardwareProfile) => string);
  subsystem: OptimizationProposal["subsystem"];
  requiresAdmin: boolean | ((goal: OptimizerGoal) => boolean);
  tooltipKey: string;
  latencyBenchId: string;
  latencyContext: string;
  isNeeded: (cfg: HardwareConfig, goal: OptimizerGoal, profile: HardwareProfile) => boolean;
  buildPatch: (cfg: HardwareConfig, goal: OptimizerGoal, profile: HardwareProfile) => Partial<HardwareConfig>;
  currentSummary: (cfg: HardwareConfig, profile: HardwareProfile) => string;
  proposedSummary: (nextCfg: HardwareConfig, profile: HardwareProfile) => string;
  whyTechnical: (cfg: HardwareConfig, nextCfg: HardwareConfig, goal: OptimizerGoal, profile: HardwareProfile) => string;
  whyTechnicalEn: (cfg: HardwareConfig, nextCfg: HardwareConfig, goal: OptimizerGoal, profile: HardwareProfile) => string;
  physicsLaw: string;
  realWorldEffect: string;
}

const GOAL_TARGETS: Record<
  OptimizerGoal,
  {
    cpuFreqMhz: number;
    cpuMaxPct: number;
    cpuTurbo: HardwareConfig["cpuTurboMode"];
    cpuEpp: number;
    cpuPl1: number;
    parking: number;
    gpuPl: number;
    gpuClock: number;
    vram: HardwareConfig["gpuVramPolicy"];
    hz: DisplayRefreshHz;
    brightness: number;
    aspm: HardwareConfig["pcieAspm"];
    nvme: HardwareConfig["nvmeApst"];
    nvmeTimeout: number;
    wifi: HardwareConfig["wifiPowerMode"];
    timer: HardwareConfig["timerResolution"];
  }
> = {
  pareto: {
    cpuFreqMhz: 3300,
    cpuMaxPct: 92,
    cpuTurbo: "disabled",
    cpuEpp: 72,
    cpuPl1: 45,
    parking: 35,
    gpuPl: 60,
    gpuClock: 1680,
    vram: "force_p8_idle",
    hz: 60,
    brightness: 45,
    aspm: "l1_substates",
    nvme: "ps3_balanced",
    nvmeTimeout: 150,
    wifi: "medium_psp",
    timer: "coalesced_15_6ms",
  },
  silent: {
    cpuFreqMhz: 2100,
    cpuMaxPct: 68,
    cpuTurbo: "disabled",
    cpuEpp: 88,
    cpuPl1: 28,
    parking: 25,
    gpuPl: 45,
    gpuClock: 1200,
    vram: "force_p8_idle",
    hz: 60,
    brightness: 32,
    aspm: "l1_substates",
    nvme: "ps4_deep",
    nvmeTimeout: 80,
    wifi: "max_psp",
    timer: "coalesced_15_6ms",
  },
  gaming_eco: {
    cpuFreqMhz: 4200,
    cpuMaxPct: 100,
    cpuTurbo: "efficient",
    cpuEpp: 40,
    cpuPl1: 65,
    parking: 60,
    gpuPl: 72,
    gpuClock: 2070,
    vram: "prefer_p5",
    hz: 120,
    brightness: 58,
    aspm: "l1",
    nvme: "ps1_light",
    nvmeTimeout: 350,
    wifi: "cam",
    timer: "standard_1ms",
  },
  server_24_7: {
    cpuFreqMhz: 1200,
    cpuMaxPct: 42,
    cpuTurbo: "disabled",
    cpuEpp: 100,
    cpuPl1: 18,
    parking: 12,
    gpuPl: 40,
    gpuClock: 930,
    vram: "force_p8_idle",
    hz: 60,
    brightness: 20,
    aspm: "l1_substates",
    nvme: "ps4_deep",
    nvmeTimeout: 50,
    wifi: "max_psp",
    timer: "coalesced_15_6ms",
  },
};

const RULES: CandidateRule[] = [
  {
    id: "cpu_vf_sweetspot",
    title: "Couper la surtension Turbo Boost & plafonner la fréquence CPU au coude V/F",
    titleEn: "Cut Turbo Boost overvoltage & cap CPU frequency at the V/F knee",
    subsystem: "CPU",
    requiresAdmin: false,
    tooltipKey: "cpu_freq_cap",
    latencyBenchId: "json",
    latencyContext: "parsing JSON 5 Mo / UI",
    isNeeded: (c, g, hw) => {
      const targetMhz = Math.min(hw.cpuFreqMaxMhz, GOAL_TARGETS[g].cpuFreqMhz);
      return (
        c.cpuFreqCapMhz > targetMhz + 150 ||
        (GOAL_TARGETS[g].cpuTurbo === "disabled" && c.cpuTurboMode !== "disabled") ||
        c.cpuMinPercent > 10
      );
    },
    buildPatch: (c, g, hw) => ({
      cpuFreqCapMhz: Math.min(hw.cpuFreqMaxMhz, GOAL_TARGETS[g].cpuFreqMhz),
      cpuMaxPercent: GOAL_TARGETS[g].cpuMaxPct,
      cpuMinPercent: 5,
      cpuTurboMode: GOAL_TARGETS[g].cpuTurbo,
      cpuEpp: Math.max(c.cpuEpp, GOAL_TARGETS[g].cpuEpp),
    }),
    currentSummary: (c) =>
      `${c.cpuFreqCapMhz} MHz · Turbo ${c.cpuTurboMode} · EPP ${c.cpuEpp}% · Min ${c.cpuMinPercent}%`,
    proposedSummary: (n) =>
      `${n.cpuFreqCapMhz} MHz · Turbo ${n.cpuTurboMode} · EPP ${n.cpuEpp}% · Min ${n.cpuMinPercent}%`,
    whyTechnical: (c, n) =>
      `Au-delà du coude V/F, les transistors exigent une hausse disproportionnée de la tension VID (jusqu'à ~1,38 V à ${c.cpuFreqCapMhz} MHz) pour ne gagner que les derniers pourcents de fréquence. En plafonnant à ${n.cpuFreqCapMhz} MHz avec EPP ${n.cpuEpp}%, le processeur opère dans sa zone de rendement instructions/joule maximal et supprime les pics thermiques qui emballent le ventilateur.`,
    whyTechnicalEn: (c, n) =>
      `Beyond the V/F knee, transistors need a disproportionate VID increase (up to ~1.38 V at ${c.cpuFreqCapMhz} MHz) for the last percent of frequency. Capping at ${n.cpuFreqCapMhz} MHz with EPP ${n.cpuEpp}% keeps the CPU in its best instructions/joule zone and removes the heat spikes that spin up the fan.`,
    physicsLaw: "Loi CMOS P_dyn = α·C·V²·f : comme V croît avec f, P varie en f^2,8 → −30 % MHz ≈ −58 % Watts !",
    realWorldEffect:
      "Navigation, code, bureautique et vidéo 4K indiscernables (< 16 ms), disparition complète du « yo-yo » du ventilateur CPU.",
  },
  {
    id: "display_hz_vram",
    title: (hw) =>
      hw.hasDedicatedGpu
        ? "Abaisser le rafraîchissement écran & la luminosité (débloque le repos VRAM GPU)"
        : "Optimiser la luminosité matérielle & le rafraîchissement du moniteur",
    titleEn: (hw) =>
      hw.hasDedicatedGpu
        ? "Lower display refresh & brightness (unlocks GPU VRAM idle)"
        : "Optimize hardware brightness & monitor refresh rate",
    subsystem: "Affichage",
    requiresAdmin: false,
    tooltipKey: "display_hz",
    latencyBenchId: "json",
    latencyContext: "impact calcul CPU/GPU nul",
    isNeeded: (c, g, hw) => {
      const targetHz = Math.min(hw.maxDisplayHz, GOAL_TARGETS[g].hz);
      return c.displayRefreshHz > targetHz || c.displayBrightnessPct > GOAL_TARGETS[g].brightness + 8;
    },
    buildPatch: (c, g, hw) => ({
      displayRefreshHz: Math.min(c.displayRefreshHz, hw.maxDisplayHz, GOAL_TARGETS[g].hz) as DisplayRefreshHz,
      displayBrightnessPct: Math.min(c.displayBrightnessPct, GOAL_TARGETS[g].brightness),
      ...(hw.hasDedicatedGpu ? { gpuZeroRpmFanStop: true } : {}),
    }),
    currentSummary: (c) => `${c.displayRefreshHz} Hz · Luminosité ${c.displayBrightnessPct}%`,
    proposedSummary: (n, hw) =>
      `${n.displayRefreshHz} Hz · Luminosité ${n.displayBrightnessPct}%${hw.hasDedicatedGpu ? " + 0 RPM" : ""}`,
    whyTechnical: (c, n, _g, hw) =>
      hw.hasDedicatedGpu && c.displayRefreshHz >= 144
        ? `À ${c.displayRefreshHz} Hz, l'intervalle VBLANK est trop court pour recalibrer la GDDR6 : le pilote bloque la mémoire vidéo en état P0 (${hw.gpuVramMaxMhz} MHz) même sur un bureau statique, gaspillant ~14 W dans le GPU en plus du scaler ! Passer à ${n.displayRefreshHz} Hz fait plonger la VRAM à ${hw.gpuVramIdleMhz} MHz (P8) et réduit le rétroéclairage LED.`
        : `Le rétroéclairage LED représente ~75 % de la consommation d'un écran. Descendre à ${n.displayBrightnessPct} % (confort visuel sRGB intérieur) et ${n.displayRefreshHz} Hz économise directement des watts secteur sans aucun coût de calcul.`,
    whyTechnicalEn: (c, n, _g, hw) =>
      hw.hasDedicatedGpu && c.displayRefreshHz >= 144
        ? `At ${c.displayRefreshHz} Hz the VBLANK interval is too short to recalibrate GDDR6: the driver pins video memory in P0 (${hw.gpuVramMaxMhz} MHz) even on a static desktop, wasting ~14 W in the GPU on top of the scaler! Moving to ${n.displayRefreshHz} Hz drops VRAM to ${hw.gpuVramIdleMhz} MHz (P8) and cuts the LED backlight.`
        : `The LED backlight is ~75% of a monitor's consumption. Dropping to ${n.displayBrightnessPct}% (indoor sRGB comfort) and ${n.displayRefreshHz} Hz saves wall watts with zero compute cost.`,
    physicsLaw: "Rétroéclairage LED linéaire + bande passante DisplayPort ∝ Hz (+ repos VRAM P8 sur GPU dédié).",
    realWorldEffect:
      "0,00 ms de ralentissement applicatif ; maintient aussi le GPU dédié sous 50 °C en 0 RPM passif.",
  },
  {
    id: "gpu_power_sweetspot",
    title: "Écrêter le Power Limit GPU & verrouiller la crête MHz + VRAM P8 au repos",
    titleEn: "Cap the GPU Power Limit & lock the MHz peak + VRAM P8 at idle",
    subsystem: "GPU",
    requiresAdmin: true,
    tooltipKey: "gpu_power_limit",
    latencyBenchId: "gpu_frame",
    latencyContext: "temps de rendu d'une image 3D",
    isNeeded: (c, g, hw) => {
      if (!hw.hasDedicatedGpu) return false;
      const targetPl = Math.max(hw.gpuMinPowerPct, GOAL_TARGETS[g].gpuPl);
      const targetClk = Math.min(hw.gpuMaxClockMhz, Math.max(hw.gpuMinClockMhz, GOAL_TARGETS[g].gpuClock));
      return (
        c.gpuPowerLimitPct > targetPl + 5 ||
        c.gpuCoreClockCapMhz > targetClk + 120 ||
        (c.gpuVramPolicy === "auto" && GOAL_TARGETS[g].vram !== "auto")
      );
    },
    buildPatch: (_c, g, hw) => ({
      gpuPowerLimitPct: Math.max(hw.gpuMinPowerPct, GOAL_TARGETS[g].gpuPl),
      gpuCoreClockCapMhz: Math.min(hw.gpuMaxClockMhz, Math.max(hw.gpuMinClockMhz, GOAL_TARGETS[g].gpuClock)),
      gpuVramPolicy: GOAL_TARGETS[g].vram,
      gpuZeroRpmFanStop: true,
    }),
    currentSummary: (c, hw) =>
      `PL ${c.gpuPowerLimitPct}% (${Math.round((hw.gpuTdpW * c.gpuPowerLimitPct) / 100)} W) · Max ${c.gpuCoreClockCapMhz} MHz · VRAM ${c.gpuVramPolicy}`,
    proposedSummary: (n, hw) =>
      `PL ${n.gpuPowerLimitPct}% (${Math.round((hw.gpuTdpW * n.gpuPowerLimitPct) / 100)} W) · Max ${n.gpuCoreClockCapMhz} MHz · VRAM ${n.gpuVramPolicy}`,
    whyTechnical: (_c, n, _g, hw) =>
      `${hw.gpuName} est poussé d'usine dans la partie plate de sa courbe de rendement : les derniers 30 % de Watts n'apportent que ~7 à 9 % d'images/s mais saturent le radiateur. Limiter le TDP via NVML à ${n.gpuPowerLimitPct} % (${Math.round((hw.gpuTdpW * n.gpuPowerLimitPct) / 100)} W, borné au VBIOS ≥ ${hw.gpuMinPowerPct} %) et l'horloge à ${n.gpuCoreClockCapMhz} MHz maintient Vgpu autour de 0,78–0,84 V.`,
    whyTechnicalEn: (_c, n, _g, hw) =>
      `${hw.gpuName} ships in the flat part of its efficiency curve: the last 30% of watts brings only ~7–9% more FPS but saturates the heatsink. Limiting TDP via NVML to ${n.gpuPowerLimitPct}% (${Math.round((hw.gpuTdpW * n.gpuPowerLimitPct) / 100)} W, VBIOS floor ≥ ${hw.gpuMinPowerPct}%) and the clock to ${n.gpuCoreClockCapMhz} MHz keeps Vgpu around 0.78–0.84 V.`,
    physicsLaw: "Rendement shader ∝ Perf / (V_gpu² · f) : jusqu'à +52 % d'images calculées par Watt consommé !",
    realWorldEffect:
      "Baisse de −12 à −22 °C sur le GPU/Hotspot et arrêt complet des ventilateurs (0 RPM) hors 3D lourde.",
  },
  {
    id: "cstates_timer_ecoqos",
    title: "Débloquer les C-States profonds C8/C10, Timer Coalescing & EcoQoS",
    titleEn: "Unlock deep C-States C8/C10, Timer Coalescing & EcoQoS",
    subsystem: "CPU",
    requiresAdmin: false,
    tooltipKey: "cpu_cstates",
    latencyBenchId: "json",
    latencyContext: "réveil C8 (0,12 ms) sur tâche UI",
    isNeeded: (c, g) =>
      !c.cpuDeepCStates ||
      !c.bgEcoQos ||
      !c.igpuEcoClock ||
      (GOAL_TARGETS[g].timer === "coalesced_15_6ms" && c.timerResolution !== "coalesced_15_6ms") ||
      (c.timerResolution === "high_0_5ms" && GOAL_TARGETS[g].timer !== "high_0_5ms"),
    buildPatch: (_c, g) => ({
      cpuDeepCStates: true,
      bgEcoQos: true,
      igpuEcoClock: true,
      timerResolution: GOAL_TARGETS[g].timer,
    }),
    currentSummary: (c) =>
      `C-States ${c.cpuDeepCStates ? "ON" : "OFF"} · Timer ${c.timerResolution} · EcoQoS ${c.bgEcoQos ? "ON" : "OFF"}`,
    proposedSummary: (n) => `C8/C10 ON · Timer ${n.timerResolution} · EcoQoS + iGPU RC6 ON`,
    whyTechnical: () =>
      `Un timer forcé à 0,5 ms bombarde le noyau de 2 000 interruptions/s au lieu de 64/s, empêchant le power-gating C8/C10 des cœurs inactifs. En activant les C-States profonds, le regroupement de timer, iGPU RC6 et EcoQoS, les processus de fond restent confinés à basse tension et le CPU coupe son rail entre deux frappes clavier.`,
    whyTechnicalEn: () =>
      `A timer forced to 0.5 ms bombards the kernel with 2,000 interrupts/s instead of 64/s, preventing C8/C10 power-gating of idle cores. With deep C-States, timer coalescing, iGPU RC6 and EcoQoS, background work stays confined at low voltage and the CPU cuts its rail between keystrokes.`,
    physicsLaw: "Power-gating transistor C8 : tension cœur → ~0 V pendant > 85 % du temps en bureautique.",
    realWorldEffect:
      "Zéro ralentissement sur la fenêtre active au premier plan ; économie immédiate dès le repos.",
  },
  {
    id: "pcie_aspm_unlock",
    title: "Activer PCIe ASPM L1 / L1.2 (éteint les lignes SerDes 16 GT/s inactives)",
    titleEn: "Enable PCIe ASPM L1 / L1.2 (powers down idle 16 GT/s SerDes lanes)",
    subsystem: "PCIe",
    requiresAdmin: (g) => GOAL_TARGETS[g].aspm === "l1_substates",
    tooltipKey: "pcie_aspm",
    latencyBenchId: "bus_net",
    latencyContext: "sortie de veille lien PCIe (45 µs)",
    isNeeded: (c, g) => {
      const order = { off: 0, l0s: 1, l1: 2, l1_substates: 3 };
      return order[c.pcieAspm] < order[GOAL_TARGETS[g].aspm];
    },
    buildPatch: (_c, g) => ({
      pcieAspm: GOAL_TARGETS[g].aspm,
    }),
    currentSummary: (c) => `PCIe ASPM : ${c.pcieAspm.toUpperCase()}`,
    proposedSummary: (n) =>
      `PCIe ASPM : ${n.pcieAspm.toUpperCase()}${n.pcieAspm === "l1_substates" ? " (CLKREQ#)" : ""}`,
    whyTechnical: () =>
      `Double gain : un bus PCIe Gen4 bloqué en L0 dissipe inutilement ~6–8 W dans les transceivers SerDes et interdit physiquement au contrôleur racine du CPU d'entrer en Package C8. Activer L1/L1.2 rétrograde dynamiquement le lien au repos et libère les C-States du processeur.`,
    whyTechnicalEn: () =>
      `Double win: a PCIe Gen4 bus stuck in L0 needlessly dissipates ~6–8 W in the SerDes transceivers and physically blocks the CPU root complex from entering Package C8. Enabling L1/L1.2 dynamically downgrades the idle link and frees the CPU C-States.`,
    physicsLaw: "Coupure PLL SerDes + horloge 100 MHz CLKREQ# : lien PCIe au repos 7,5 W → < 0,05 W.",
    realWorldEffect:
      "Latence de réveil de 0,045 ms (45 µs) : totalement imperceptible, plein débit Gen4 restitué en charge.",
  },
  {
    id: "storage_nvme_sata",
    title: "Activer la veille autonome SSD NVMe APST (PS3/PS4) & SATA DIPM Slumber",
    titleEn: "Enable NVMe APST autonomous idle (PS3/PS4) & SATA DIPM Slumber",
    subsystem: "NVMe/SATA",
    requiresAdmin: true,
    tooltipKey: "nvme_apst",
    latencyBenchId: "nvme_wake",
    latencyContext: "1ère lecture 4 Ko après inactivité",
    isNeeded: (c, g) => {
      const order = { ps0_only: 0, ps1_light: 1, ps3_balanced: 2, ps4_deep: 3 };
      return order[c.nvmeApst] < order[GOAL_TARGETS[g].nvme] || c.sataAlpm === "active";
    },
    buildPatch: (_c, g) => ({
      nvmeApst: GOAL_TARGETS[g].nvme,
      nvmeIdleTimeoutMs: GOAL_TARGETS[g].nvmeTimeout,
      sataAlpm: g === "gaming_eco" ? "hipm" : "dipm_slumber",
    }),
    currentSummary: (c) => `NVMe ${c.nvmeApst} (${c.nvmeIdleTimeoutMs} ms) · SATA ${c.sataAlpm}`,
    proposedSummary: (n) => `NVMe ${n.nvmeApst} (${n.nvmeIdleTimeoutMs} ms) · SATA ${n.sataAlpm}`,
    whyTechnical: (_c, n) =>
      `Sans APST, le contrôleur ARM multi-cœurs du SSD NVMe reste en PS0 (~5,5 W) même sans aucun accès disque, chauffant au-delà de 50 °C. Avec APST ${n.nvmeApst} après ${n.nvmeIdleTimeoutMs} ms de silence, le SSD descend à 5–50 mW et le PHY SATA entre en veille.`,
    whyTechnicalEn: (_c, n) =>
      `Without APST, the multi-core ARM controller of the NVMe SSD stays in PS0 (~5.5 W) with no disk access at all, heating above 50 °C. With APST ${n.nvmeApst} after ${n.nvmeIdleTimeoutMs} ms of silence, the SSD drops to 5–50 mW and the SATA PHY sleeps.`,
    physicsLaw: "Transition autonome PS0 (5 500 mW) → PS3 (50 mW) / PS4 (5 mW) : facteur ÷110 à ÷1000 !",
    realWorldEffect:
      "SSD refroidi de −15 à −20 °C (longévité accrue), +0,8 à +1,8 ms sur le seul 1er accès après pause.",
  },
  {
    id: "cpu_pl1_parking",
    title: "Verrouiller l'enveloppe RAPL PL1 & activer le Core Parking intelligent",
    titleEn: "Lock the RAPL PL1 envelope & enable smart Core Parking",
    subsystem: "CPU",
    requiresAdmin: true,
    tooltipKey: "cpu_pl1",
    latencyBenchId: "sqlite",
    latencyContext: "requête lourde multi-cœurs",
    isNeeded: (c, g, hw) => {
      const targetPl1 = Math.min(hw.cpuPl1MaxW, Math.max(hw.cpuPl1MinW, GOAL_TARGETS[g].cpuPl1));
      return c.cpuPl1Watts > targetPl1 + 6 || c.cpuCoreParkingMinActive > GOAL_TARGETS[g].parking + 15;
    },
    buildPatch: (_c, g, hw) => ({
      cpuPl1Watts: Math.min(hw.cpuPl1MaxW, Math.max(hw.cpuPl1MinW, GOAL_TARGETS[g].cpuPl1)),
      cpuCoreParkingMinActive: GOAL_TARGETS[g].parking,
    }),
    currentSummary: (c) => `PL1 ${c.cpuPl1Watts} W · Cœurs actifs min ${c.cpuCoreParkingMinActive}%`,
    proposedSummary: (n) => `PL1 ${n.cpuPl1Watts} W max · Cœurs actifs min ${n.cpuCoreParkingMinActive}%`,
    whyTechnical: (_c, n, _g, hw) =>
      `Garantie thermique absolue : même si une indexation ou une compilation sature les ${hw.cpuCores} cœurs, RAPL plafonne le package à ${n.cpuPl1Watts} W max. Au repos, le Core Parking regroupe les threads légers et coupe le rail C6 des cœurs inutilisés.`,
    whyTechnicalEn: (_c, n, _g, hw) =>
      `Absolute thermal guarantee: even if an indexing job or a build saturates all ${hw.cpuCores} cores, RAPL caps the package at ${n.cpuPl1Watts} W max. At idle, Core Parking groups light threads and cuts the C6 rail of unused cores.`,
    physicsLaw: "Régulation boucle fermée RAPL (1 ms) + coupure rail C6 des cœurs parqués (dé-parquage 0,35 ms).",
    realWorldEffect:
      "Silence garanti même lors des pics imprévus ; réveil instantané de tous les cœurs en cas de besoin.",
  },
  {
    id: "usb_wifi_idle",
    title: "Activer la Suspension Sélective USB (U3) & la sobriété radio Wi-Fi (PSP)",
    titleEn: "Enable USB selective suspend (U3) & Wi-Fi radio efficiency (PSP)",
    subsystem: "Réseau/OS",
    requiresAdmin: false,
    tooltipKey: "usb_suspend",
    latencyBenchId: "bus_net",
    latencyContext: "1er paquet Wi-Fi après silence",
    isNeeded: (c, g) =>
      !c.usbSelectiveSuspend || (GOAL_TARGETS[g].wifi !== "cam" && c.wifiPowerMode === "cam"),
    buildPatch: (c, g) => ({
      usbSelectiveSuspend: true,
      wifiPowerMode: GOAL_TARGETS[g].wifi === "cam" ? c.wifiPowerMode : GOAL_TARGETS[g].wifi,
    }),
    currentSummary: (c) =>
      `USB Suspend ${c.usbSelectiveSuspend ? "ON" : "OFF"} · Wi-Fi ${c.wifiPowerMode}`,
    proposedSummary: (n) => `USB Suspend ON (U3) · Wi-Fi ${n.wifiPowerMode}`,
    whyTechnical: () =>
      `Les ports USB inactifs (webcam, lecteur de carte, dongle au repos) et la radio Wi-Fi en écoute permanente CAM brûlent 4 à 6 W en continu et maintiennent du trafic DMA xHCI qui empêche le CPU d'entrer en C8 profond — le tout réglable en mode User sans UAC.`,
    whyTechnicalEn: () =>
      `Idle USB ports (webcam, card reader, idle dongle) and a Wi-Fi radio in permanent CAM listening burn 4 to 6 W continuously and keep xHCI DMA traffic that prevents deep C8 — all adjustable in User mode without UAC.`,
    physicsLaw: "État suspendu USB U3 (< 2,5 mA) + extinction chaîne RF 802.11 entre balises DTIM.",
    realWorldEffect:
      "Jusqu'à −5,5 W permanents sans couper clavier, souris ni débit de téléchargement actif.",
  },
  {
    id: "nic_eee_802_3az",
    title: "Activer Ethernet Éco-Énergétique IEEE 802.3az (EEE Low-Power Idle)",
    titleEn: "Enable IEEE 802.3az Energy-Efficient Ethernet (EEE Low-Power Idle)",
    subsystem: "Réseau/OS",
    requiresAdmin: true,
    tooltipKey: "nic_eee",
    latencyBenchId: "bus_net",
    latencyContext: "sortie LPI Ethernet (20 µs)",
    isNeeded: (c, _g, hw) => hw.hasEthernet && !c.nicEeeEnabled,
    buildPatch: () => ({ nicEeeEnabled: true }),
    currentSummary: () => "Ethernet 802.3az EEE : OFF (trames IDLE continues)",
    proposedSummary: () => "Ethernet 802.3az EEE : ON (Low-Power Idle)",
    whyTechnical: () =>
      `Sans 802.3az, le transceiver cuivre RJ45 (1 / 2.5 GbE) émet des symboles IDLE à pleine puissance 100 % du temps sur les 4 paires torsadées même à 0 ko/s. En Low-Power Idle, l'émetteur dort entre deux paquets et ne consomme que ~0,75 W au lieu de ~3,15 W.`,
    whyTechnicalEn: () =>
      `Without 802.3az, the RJ45 copper transceiver (1 / 2.5 GbE) emits full-power IDLE symbols 100% of the time on all four twisted pairs even at 0 KB/s. In Low-Power Idle the transmitter sleeps between packets and draws only ~0.75 W instead of ~3.15 W.`,
    physicsLaw: "Mise en sommeil PHY IEEE 802.3az LPI : −2,4 W permanents pour +0,02 ms de réveil.",
    realWorldEffect:
      "Ratio de rendement exceptionnel (~120 W économisés par milliseconde), imperceptible même en jeu en ligne.",
  },
];

export function generateOptimizationProposals(
  currentCfg: HardwareConfig,
  workload: WorkloadMode,
  goal: OptimizerGoal,
  profile: HardwareProfile = DEFAULT_HARDWARE_PROFILE
): OptimizationProposal[] {
  const clampedCurrent = clampConfigToProfile(currentCfg, profile);
  const baseTel = computeTelemetry(clampedCurrent, workload, undefined, 0, profile);
  const proposals: OptimizationProposal[] = [];

  for (const rule of RULES) {
    if (!rule.isNeeded(clampedCurrent, goal, profile)) continue;

    const rawPatch = rule.buildPatch(clampedCurrent, goal, profile);
    const nextCfg = clampConfigToProfile({ ...clampedCurrent, ...rawPatch }, profile);
    if (JSON.stringify(nextCfg) === JSON.stringify(clampedCurrent)) continue;

    // Reconstruit le patch effectivement borné pour garantir zéro valeur hors spécification
    const boundedPatch: Partial<HardwareConfig> = {};
    for (const k of Object.keys(rawPatch) as (keyof HardwareConfig)[]) {
      (boundedPatch as Record<string, unknown>)[k] = nextCfg[k];
    }

    const nextTel = computeTelemetry(nextCfg, workload, undefined, 0, profile);
    const rawSavedWatts = baseTel.totalSystemWatts - nextTel.totalSystemWatts;
    // N'invente jamais de gain fictif : écarte toute règle qui n'économise pas réellement ≥ 0,25 W dans ce contexte
    if (rawSavedWatts < 0.25) continue;

    const benches = computeBenchmarks(clampedCurrent, nextCfg, 1, profile);
    const savedWatts = Math.round(rawSavedWatts * 10) / 10;
    const savedWallWatts = Math.max(0.1, Math.round((baseTel.psuWallWatts - nextTel.psuWallWatts) * 10) / 10);

    const maxBaseTemp = Math.max(baseTel.cpuTempC, baseTel.gpuTempC);
    const maxNextTemp = Math.max(nextTel.cpuTempC, nextTel.gpuTempC);
    const nvmeDrop = baseTel.nvmeTempC - nextTel.nvmeTempC;
    const rawTempDrop =
      rule.subsystem === "NVMe/SATA"
        ? nvmeDrop
        : Math.max(
            maxBaseTemp - maxNextTemp,
            (baseTel.cpuTempC - nextTel.cpuTempC + baseTel.gpuTempC - nextTel.gpuTempC) * 0.65
          );
    const tempDropC = Math.max(0, Math.round(rawTempDrop * 10) / 10);

    const fanDropRpm = Math.max(
      0,
      Math.round(baseTel.cpuFanRpm - nextTel.cpuFanRpm + (baseTel.gpuFanRpm - nextTel.gpuFanRpm) * 0.6)
    );
    const noiseDropDba = Math.max(0, Math.round((baseTel.systemNoiseDba - nextTel.systemNoiseDba) * 10) / 10);

    const refBench = benches.find((b) => b.id === rule.latencyBenchId);
    const latencyDeltaMs =
      rule.id === "display_hz_vram" ? 0 : Math.max(0, refBench ? refBench.deltaMs : 0);

    const requiresAdmin =
      typeof rule.requiresAdmin === "function" ? rule.requiresAdmin(goal) : rule.requiresAdmin;
    const title = typeof rule.title === "function" ? rule.title(profile) : rule.title;
    const titleEn = typeof rule.titleEn === "function" ? rule.titleEn(profile) : rule.titleEn;

    const rawRatio = (savedWatts * 3.4 + noiseDropDba * 4.5 + tempDropC * 1.4) / (1 + latencyDeltaMs * 0.22);
    const efficiencyScore = Math.min(99, Math.max(42, Math.round(45 + Math.min(54, rawRatio * 1.45))));

    proposals.push({
      id: rule.id,
      title,
      titleEn,
      subsystem: rule.subsystem,
      requiresAdmin,
      tooltipKey: rule.tooltipKey,
      currentSummary: rule.currentSummary(clampedCurrent, profile),
      proposedSummary: rule.proposedSummary(nextCfg, profile),
      whyTechnical: rule.whyTechnical(clampedCurrent, nextCfg, goal, profile),
      whyTechnicalEn: rule.whyTechnicalEn(clampedCurrent, nextCfg, goal, profile),
      physicsLaw: rule.physicsLaw,
      realWorldEffect: rule.realWorldEffect,
      savedWatts,
      savedWallWatts,
      tempDropC,
      fanDropRpm,
      noiseDropDba,
      latencyDeltaMs,
      latencyContext: rule.latencyContext,
      efficiencyScore,
      patch: boundedPatch,
    });
  }

  return proposals.sort((a, b) => b.efficiencyScore - a.efficiencyScore || b.savedWatts - a.savedWatts);
}

export interface BudgetPlan {
  selected: OptimizationProposal[];
  deferred: OptimizationProposal[];
  selectedIds: string[];
  totalSavedWatts: number;
  totalSavedWallWatts: number;
  /** Pire latence interactive combinée réellement ajoutée (mesurée sur le profil fusionné, sans double comptage). */
  totalLatencyMs: number;
  totalNoiseDropDba: number;
  totalTempDropC: number;
  budgetMs: number;
  adminBlockedCount: number;
  budgetSaturated: boolean;
}

/**
 * Mesure la pire latence réellement ajoutée (ms) entre baseCfg et candidateCfg sur les tâches interactives
 * (UI/JSON, frame GPU, 1er accès NVMe, réveil bus/réseau).
 */
function computeWorstInteractiveDeltaMs(
  baseCfg: HardwareConfig,
  candidateCfg: HardwareConfig,
  profile: HardwareProfile
): number {
  const interactiveIds = new Set(["json", "gpu_frame", "nvme_wake", "bus_net"]);
  const benches = computeBenchmarks(baseCfg, candidateCfg, 1, profile);
  let worst = 0;
  for (const b of benches) {
    if (interactiveIds.has(b.id) && b.deltaMs > worst) {
      worst = b.deltaMs;
    }
  }
  return Math.round(worst * 100) / 100;
}

/**
 * Optimisation sous contrainte : maximise les Watts économisés sous un budget de latence réel.
 * Trie par rendement marginal (Watts / ms), puis simule à chaque ajout la configuration fusionnée exacte
 * pour éviter tout double comptage entre règles CPU/timer et garantir `totalLatencyMs <= budgetMs`.
 */
export function buildBudgetPlan(
  proposals: OptimizationProposal[],
  baseCfg: HardwareConfig,
  workload: WorkloadMode,
  budgetMs: number,
  profile: HardwareProfile = DEFAULT_HARDWARE_PROFILE,
  includeAdmin = true
): BudgetPlan {
  const safeBudget = Math.max(0, budgetMs);
  const clampedBase = clampConfigToProfile(baseCfg, profile);

  const sorted = [...proposals].sort((a, b) => {
    const ratioA = a.savedWatts / (a.latencyDeltaMs + 0.08);
    const ratioB = b.savedWatts / (b.latencyDeltaMs + 0.08);
    return ratioB - ratioA;
  });

  const selected: OptimizationProposal[] = [];
  const deferred: OptimizationProposal[] = [];
  let workingMerged: HardwareConfig = { ...clampedBase };
  let adminBlockedCount = 0;

  for (const proposal of sorted) {
    if (proposal.requiresAdmin && !includeAdmin) {
      deferred.push(proposal);
      adminBlockedCount += 1;
      continue;
    }
    const trialMerged = clampConfigToProfile({ ...workingMerged, ...proposal.patch }, profile);
    const combinedWorstMs = computeWorstInteractiveDeltaMs(clampedBase, trialMerged, profile);
    if (proposal.latencyDeltaMs <= safeBudget + 1e-6 && combinedWorstMs <= safeBudget + 1e-6) {
      selected.push(proposal);
      workingMerged = trialMerged;
    } else {
      deferred.push(proposal);
    }
  }

  const before = computeTelemetry(clampedBase, workload, undefined, 0, profile);
  const after = computeTelemetry(workingMerged, workload, undefined, 0, profile);
  const totalLatencyMs =
    selected.length === 0 ? 0 : computeWorstInteractiveDeltaMs(clampedBase, workingMerged, profile);

  return {
    selected,
    deferred,
    selectedIds: selected.map((p) => p.id),
    totalSavedWatts: Math.max(0, Math.round((before.totalSystemWatts - after.totalSystemWatts) * 10) / 10),
    totalSavedWallWatts: Math.max(0, Math.round((before.psuWallWatts - after.psuWallWatts) * 10) / 10),
    totalLatencyMs,
    totalNoiseDropDba: Math.max(0, Math.round((before.systemNoiseDba - after.systemNoiseDba) * 10) / 10),
    totalTempDropC:
      Math.round(
        Math.max(0, before.cpuTempC - after.cpuTempC, before.gpuTempC - after.gpuTempC, before.nvmeTempC - after.nvmeTempC) *
          10
      ) / 10,
    budgetMs: safeBudget,
    adminBlockedCount,
    budgetSaturated: deferred.length > 0,
  };
}

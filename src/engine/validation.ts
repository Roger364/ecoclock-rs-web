import {
  DisplayRefreshHz,
  HardwareConfig,
  HardwareProfile,
  PrivilegeLevel,
  ValidationIssue,
  WorkloadMode,
} from "../types/hardware";
import { STOCK_BASELINE_CONFIG } from "../data/profiles";

const SEVERITY_RANK: Record<ValidationIssue["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Borne une configuration aux capacités réelles du matériel de référence.
 * Cette fonction est volontairement pure et idempotente : clamp(clamp(x)) === clamp(x).
 * C'est le miroir de `HardwareConfig::clamped()` + contraintes profil côté Rust.
 */
export function clampConfigToProfile(cfg: HardwareConfig, profile: HardwareProfile): HardwareConfig {
  const cpuMax = Math.min(100, Math.max(20, Math.round(cfg.cpuMaxPercent)));
  const cpuMin = Math.min(cpuMax, Math.max(5, Math.round(cfg.cpuMinPercent)));
  const freqCap = Math.min(
    profile.cpuFreqMaxMhz,
    Math.max(profile.cpuFreqMinMhz, Math.round(cfg.cpuFreqCapMhz / 100) * 100)
  );

  const pl1 = Math.min(
    profile.cpuPl1MaxW,
    Math.max(profile.cpuPl1MinW, Math.round(cfg.cpuPl1Watts))
  );

  const displayAllowed: DisplayRefreshHz[] = [60, 75, 120, 165];
  const displayHz = displayAllowed.includes(cfg.displayRefreshHz)
    ? (Math.min(cfg.displayRefreshHz, profile.maxDisplayHz) as DisplayRefreshHz)
    : 60;

  const hasDgpu = profile.hasDedicatedGpu;

  return {
    ...cfg,
    cpuMaxPercent: cpuMax,
    cpuMinPercent: cpuMin,
    cpuFreqCapMhz: freqCap,
    cpuPl1Watts: pl1,
    cpuCoreParkingMinActive: Math.min(100, Math.max(10, Math.round(cfg.cpuCoreParkingMinActive))),
    cpuEpp: Math.min(100, Math.max(0, Math.round(cfg.cpuEpp))),
    gpuPowerLimitPct: hasDgpu
      ? Math.min(100, Math.max(profile.gpuMinPowerPct, Math.round(cfg.gpuPowerLimitPct)))
      : 100,
    gpuCoreClockCapMhz: hasDgpu
      ? Math.min(profile.gpuMaxClockMhz, Math.max(profile.gpuMinClockMhz, Math.round(cfg.gpuCoreClockCapMhz)))
      : profile.gpuMaxClockMhz,
    gpuVramPolicy: hasDgpu ? cfg.gpuVramPolicy : "auto",
    gpuZeroRpmFanStop: hasDgpu ? cfg.gpuZeroRpmFanStop : false,
    nicEeeEnabled: profile.hasEthernet ? cfg.nicEeeEnabled : false,
    nvmeIdleTimeoutMs: Math.min(5000, Math.max(50, Math.round(cfg.nvmeIdleTimeoutMs))),
    displayRefreshHz: displayHz,
    displayBrightnessPct: Math.min(100, Math.max(20, Math.round(cfg.displayBrightnessPct))),
  };
}

/**
 * Audit de sûreté et de cohérence, exécuté avant toute application et à chaque modification.
 * Chaque anomalie peut embarquer un patch correctif appliqué en un clic.
 */
export function auditConfig(
  cfg: HardwareConfig,
  profile: HardwareProfile,
  privilege: PrivilegeLevel,
  workload: WorkloadMode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue) => issues.push(issue);

  // --- Cohérence des bornes / intégrité ---
  if (cfg.cpuMinPercent > cfg.cpuMaxPercent) {
    add({
      id: "cpu-min-gt-max",
      severity: "critical",
      subsystem: "CPU",
      title: "État minimal supérieur à l'état maximal",
      detail: `Min ${cfg.cpuMinPercent}% > Max ${cfg.cpuMaxPercent}%. Le noyau applique le minimum strict et ignore le plafond.`,
      consequence: "Comportement indéterminé du gouverneur, risque de surchauffe locale ou d'étranglement imprévisible.",
      fix: { cpuMinPercent: Math.min(cfg.cpuMaxPercent, 5) },
      fixLabel: "Ramener le minimum à 5%",
    });
  }

  if (cfg.cpuFreqCapMhz > profile.cpuFreqMaxMhz) {
    add({
      id: "cpu-freq-over-spec",
      severity: "critical",
      subsystem: "CPU",
      title: "Plafond MHz au-dessus de la spécification constructeur",
      detail: `Demandé : ${cfg.cpuFreqCapMhz} MHz. Maximum certifié pour ${profile.cpuName} : ${profile.cpuFreqMaxMhz} MHz.`,
      consequence: "Valeur ignorée ou ramenée par le firmware ; le profil pourrait ne pas faire ce qu'il annonce.",
      fix: { cpuFreqCapMhz: profile.cpuFreqMaxMhz },
      fixLabel: `Borner à ${profile.cpuFreqMaxMhz} MHz`,
    });
  }

  if (cfg.cpuFreqCapMhz < profile.cpuFreqMinMhz) {
    add({
      id: "cpu-freq-under-lfm",
      severity: "critical",
      subsystem: "CPU",
      title: "Plafond MHz sous le plancher matériel",
      detail: `Demandé : ${cfg.cpuFreqCapMhz} MHz. Plancher LFM certifié : ${profile.cpuFreqMinMhz} MHz.`,
      consequence: "Le CPU ne peut pas descendre sous son P-State minimal ; valeur sans effet voire rejetée.",
      fix: { cpuFreqCapMhz: profile.cpuFreqMinMhz },
      fixLabel: `Remonter à ${profile.cpuFreqMinMhz} MHz`,
    });
  }

  if (cfg.cpuPl1Watts < profile.cpuPl1MinW || cfg.cpuPl1Watts > profile.cpuPl1MaxW) {
    add({
      id: "pl1-out-of-range",
      severity: "critical",
      subsystem: "CPU",
      title: "Enveloppe RAPL PL1 hors plage du profil",
      detail: `Demandé : ${cfg.cpuPl1Watts} W. Plage sûre pour ${profile.cpuName} : ${profile.cpuPl1MinW}–${profile.cpuPl1MaxW} W.`,
      consequence: "Refus du pilote ou bridage brutal des performances ; les limites VRM ne sont pas garanties.",
      fix: { cpuPl1Watts: Math.min(profile.cpuPl1MaxW, Math.max(profile.cpuPl1MinW, cfg.cpuPl1Watts)) },
      fixLabel: "Ramener dans la plage constructeur",
    });
  }

  if (profile.hasDedicatedGpu && cfg.gpuPowerLimitPct < profile.gpuMinPowerPct) {
    add({
      id: "gpu-pl-under-vbios",
      severity: "critical",
      subsystem: "GPU",
      title: "Power Limit GPU sous la limite minimale du VBIOS",
      detail: `${cfg.gpuPowerLimitPct}% demandé, minimum certifié ${profile.gpuMinPowerPct}% pour ${profile.gpuName}.`,
      consequence: "NVML rejette l'appel (NVML_ERROR_INVALID_ARGUMENT) : aucun effet, mais profil trompeur.",
      fix: { gpuPowerLimitPct: profile.gpuMinPowerPct },
      fixLabel: `Borner à ${profile.gpuMinPowerPct}%`,
    });
  }

  if (profile.hasDedicatedGpu && cfg.gpuCoreClockCapMhz > profile.gpuMaxClockMhz) {
    add({
      id: "gpu-clock-over-spec",
      severity: "critical",
      subsystem: "GPU",
      title: "Plafond d'horloge GPU au-dessus du maximum certifié",
      detail: `${cfg.gpuCoreClockCapMhz} MHz demandés, maximum ${profile.gpuMaxClockMhz} MHz.`,
      consequence: "Appel NVML rejeté ; risque de confusion sur l'application réelle du profil.",
      fix: { gpuCoreClockCapMhz: profile.gpuMaxClockMhz },
      fixLabel: "Borner au maximum GPU",
    });
  }

  if (!profile.hasDedicatedGpu && cfg.gpuPowerLimitPct < 100) {
    add({
      id: "gpu-no-dgpu",
      severity: "warning",
      subsystem: "GPU",
      title: "Réglages GPU dédié sans GPU dédié détecté",
      detail: `Le profil ${profile.label} n'expose qu'un iGPU. Les leviers NVML (Power Limit, Clock Lock, VRAM P-State) sont inopérants.`,
      consequence: "Les valeurs sont ignorées ; l'énergie doit être gagnée via le package CPU et l'iGPU.",
      fix: { gpuPowerLimitPct: 100, gpuVramPolicy: "auto", gpuZeroRpmFanStop: false },
      fixLabel: "Désactiver les leviers GPU dédié",
    });
  }

  // --- Risques de charge / latence ---
  if (cfg.cpuPl1Watts <= 22 && (workload === "heavy" || workload === "gaming")) {
    add({
      id: "pl1-too-low-for-load",
      severity: "warning",
      subsystem: "CPU",
      title: "Budget PL1 très bas pour une charge soutenue",
      detail: `${cfg.cpuPl1Watts} W sur ${profile.cpuCores} cœurs en scénario « ${workload} » : le CPU sera limité à ~${Math.round(cfg.cpuPl1Watts / profile.cpuCores)} W/cœur.`,
      consequence: "Rendus et compilations nettement ralentis. À réserver au profil Serveur/Veille.",
      fix: { cpuPl1Watts: Math.min(profile.cpuPl1MaxW, Math.max(45, cfg.cpuPl1Watts)) },
      fixLabel: "Remonter PL1 à 45 W",
    });
  }

  if (workload === "gaming" && cfg.displayRefreshHz < 120) {
    add({
      id: "hz-too-low-gaming",
      severity: "warning",
      subsystem: "Affichage",
      title: "60 Hz sélectionné pendant un scénario jeu 3D",
      detail: `${cfg.displayRefreshHz} Hz limite artificiellement la fluidité perçue en jeu, alors que le GPU peut produire bien plus d'images.`,
      consequence: "Perte de réactivité sans gain énergétique significatif en charge 3D.",
      fix: { displayRefreshHz: Math.min(120, profile.maxDisplayHz) as DisplayRefreshHz },
      fixLabel: "Passer à 120 Hz",
    });
  }

  if (workload === "gaming" && cfg.wifiPowerMode !== "cam") {
    add({
      id: "wifi-psp-gaming",
      severity: "warning",
      subsystem: "Réseau",
      title: "Wi-Fi en Power Save pendant une session compétitive",
      detail: "Le mode PSP ajoute 1,1 à 2,9 ms de gigue sur le premier paquet après silence.",
      consequence: "Micro-lag possible en jeu en ligne ; sans intérêt si Ethernet est utilisé.",
      fix: { wifiPowerMode: "cam" },
      fixLabel: "Repasser en CAM (Max Perf)",
    });
  }

  if (cfg.displayRefreshHz >= 144 && cfg.gpuVramPolicy === "auto" && profile.hasDedicatedGpu) {
    add({
      id: "vram-stuck-p0",
      severity: "warning",
      subsystem: "Affichage / GPU",
      title: "Risque de VRAM bloquée en P0 avec un écran haute fréquence",
      detail: `${cfg.displayRefreshHz} Hz avec politique VRAM « auto » : l'intervalle VBLANK peut être trop court pour recalibrer la GDDR6, qui reste à ${profile.gpuVramMaxMhz} MHz même au repos.`,
      consequence: "≈12–18 W gaspillés en permanence et carte graphique au-dessus du seuil 0 RPM.",
      fix: { gpuVramPolicy: "force_p8_idle", gpuZeroRpmFanStop: true },
      fixLabel: "Forcer VRAM P8 + Fan-Stop",
    });
  }

  // --- Gaspillages et occasions manquées ---
  if (!cfg.cpuDeepCStates) {
    add({
      id: "cstates-off",
      severity: "warning",
      subsystem: "CPU",
      title: "C-States profonds désactivés",
      detail: "Les cœurs restent à ~0,65 V entre deux interruptions au lieu de couper leur rail (C6/C8).",
      consequence: "10 à 18 W de fuite permanente au repos et températures minimales plus élevées.",
      fix: { cpuDeepCStates: true },
      fixLabel: "Activer C6/C8",
    });
  }

  if (cfg.timerResolution === "high_0_5ms") {
    add({
      id: "timer-05",
      severity: "warning",
      subsystem: "Noyau NT",
      title: "Timer forcé à 0,5 ms (2 000 interruptions/seconde)",
      detail: "Un timer haute résolution global empêche l'entrée en Package C8 et réveille un cœur 2 000 fois par seconde.",
      consequence: "4 à 11 W gaspillés, résidence profonde divisée par ~3.",
      fix: { timerResolution: "coalesced_15_6ms" },
      fixLabel: "Coalescer à 15,625 ms",
    });
  }

  if (cfg.pcieAspm === "off") {
    add({
      id: "pcie-aspm-off",
      severity: "info",
      subsystem: "PCIe",
      title: "ASPM désactivé : liens PCIe maintenus en L0",
      detail: "Un lien Gen4 x16 actif à vide dissipe 6–8 W et bloque le Package C8 du CPU.",
      consequence: "Jusqu'à 11 W de pertes combinées, sans aucun bénéfice mesurable en usage courant.",
      fix: { pcieAspm: "l1" },
      fixLabel: "Activer ASPM L1 (User)",
    });
  }

  if (cfg.nvmeApst === "ps0_only") {
    add({
      id: "nvme-ps0",
      severity: "info",
      subsystem: "NVMe",
      title: "SSD NVMe maintenu en PS0 à pleine puissance",
      detail: "Le contrôleur reste à ~5,5 W et 50–60 °C même sans le moindre accès disque.",
      consequence: "Température SSD élevée, usure accrue, ~5 W permanents perdus.",
      fix: { nvmeApst: "ps3_balanced", nvmeIdleTimeoutMs: 150 },
      fixLabel: "Activer APST PS3 (Admin)",
    });
  }

  if (!cfg.usbSelectiveSuspend) {
    add({
      id: "usb-suspend-off",
      severity: "info",
      subsystem: "USB",
      title: "Suspension sélective USB désactivée",
      detail: "Les périphériques inactifs (webcam, lecteurs, DAC) restent alimentés et interrogés en continu.",
      consequence: "1,5 à 4,5 W perdus et déblocage plus difficile des états C profonds.",
      fix: { usbSelectiveSuspend: true },
      fixLabel: "Activer USB U3",
    });
  }

  if (cfg.displayBrightnessPct >= 92) {
    add({
      id: "brightness-high",
      severity: "info",
      subsystem: "Affichage",
      title: "Rétroéclairage proche du maximum",
      detail: `${cfg.displayBrightnessPct}% en intérieur : ~350 cd/m², bien au-delà du confort sRGB (~140–180 cd/m²).`,
      consequence: "10 à 18 W réels perdus, fatigue oculaire accrue.",
      fix: { displayBrightnessPct: 55 },
      fixLabel: "Réduire à 55%",
    });
  }

  // --- Privilèges ---
  const wantsAdminLevers =
    cfg.cpuPl1Watts < STOCK_BASELINE_CONFIG.cpuPl1Watts ||
    cfg.cpuCoreParkingMinActive < 100 ||
    (profile.hasDedicatedGpu &&
      (cfg.gpuPowerLimitPct < 100 || cfg.gpuCoreClockCapMhz < profile.gpuMaxClockMhz)) ||
    cfg.nvmeApst !== "ps0_only" ||
    cfg.nicEeeEnabled;

  if (wantsAdminLevers && privilege === "user") {
    add({
      id: "admin-pending",
      severity: "info",
      subsystem: "UAC",
      title: "Réglages Admin présents dans le profil, jeton User actif",
      detail: "PL1, Core Parking, NVML, NVMe APST, SATA et EEE ne sont pas appliqués tant que l'élévation UAC n'a pas été accordée.",
      consequence: "Le profil est partiellement appliqué : le gain affiché peut ne pas être atteint en réel.",
      fixLabel: "Demander l'élévation UAC",
    });
  }

  if (cfg.gpuCoreClockCapMhz > 2200 && workload !== "gaming" && workload !== "heavy") {
    add({
      id: "gpu-clock-high-idle",
      severity: "info",
      subsystem: "GPU",
      title: "Plafond GPU élevé pour une charge légère",
      detail: `Un plafond à ${cfg.gpuCoreClockCapMhz} MHz n'apporte aucun gain en « ${workload} » mais empêche le GPU de rester dans sa zone d'efficacité.`,
      consequence: "Réveils GPU inutiles et chaleur résiduelle au bureau.",
      fix: { gpuCoreClockCapMhz: Math.min(1750, profile.gpuMaxClockMhz) },
      fixLabel: "Plafonner à 1750 MHz",
    });
  }

  return issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function auditScore(issues: ValidationIssue[]): number {
  const penalty = issues.reduce((acc, issue) => {
    if (issue.severity === "critical") return acc + 20;
    if (issue.severity === "warning") return acc + 7;
    return acc + 2;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function countBySeverity(issues: ValidationIssue[]): Record<ValidationIssue["severity"], number> {
  return issues.reduce(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { critical: 0, warning: 0, info: 0 }
  );
}

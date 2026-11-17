import {
  BenchmarkMetric,
  BenchRun,
  HardwareProfile,
  OptimizationProposal,
  PrivilegeLevel,
  Profile,
  TelemetrySnapshot,
  WorkloadMode,
} from "../types/hardware";
import { CostAssumptions } from "../engine/physics";
import { WORKLOAD_META } from "../data/profiles";

export interface ReportPayload {
  profile: Profile;
  hardware: HardwareProfile;
  workload: WorkloadMode;
  privilege: PrivilegeLevel;
  before: TelemetrySnapshot;
  after: TelemetrySnapshot;
  benchmarks: BenchmarkMetric[];
  proposals: OptimizationProposal[];
  benchRuns: BenchRun[];
  cost: CostAssumptions;
}

const fmt = (n: number, d = 1) => n.toFixed(d);

export function buildMarkdownReport(payload: ReportPayload): string {
  const { profile, hardware, workload, privilege, before, after, benchmarks, proposals, benchRuns, cost } = payload;
  const savedKwh = Math.max(0, before.annualKwh - after.annualKwh);
  const savedEuro = Math.max(0, before.annualEuro - after.annualEuro);
  const savedPct = before.totalSystemWatts > 0
    ? Math.round(((before.totalSystemWatts - after.totalSystemWatts) / before.totalSystemWatts) * 100)
    : 0;

  const rows = benchmarks
    .map(
      (b) =>
        `| ${b.name} | ${fmt(b.beforeMs, 2)} ms | ${fmt(b.afterMs, 2)} ms | ${b.deltaMs >= 0 ? "+" : ""}${fmt(b.deltaMs, 2)} ms (${b.deltaPct >= 0 ? "+" : ""}${fmt(b.deltaPct, 1)}%) | ${b.humanVerdict} |`
    )
    .join("\n");

  const proposalRows = proposals
    .map(
      (p, i) =>
        `${i + 1}. **${p.title}** — -${fmt(p.savedWatts)} W / -${fmt(p.tempDropC)} °C / +${fmt(p.latencyDeltaMs, 2)} ms\n   - Pourquoi : ${p.whyTechnical}\n   - Privilège : ${p.requiresAdmin ? "Admin (UAC)" : "User"} | Score Pareto : ${p.efficiencyScore}/100`
    )
    .join("\n");

  const runs = benchRuns.length
    ? benchRuns
        .map(
          (r) =>
            `- ${r.ranAt} · ${fmt(r.measuredHostMs, 2)} ms hôte · ${(r.opsPerSec / 1e6).toFixed(1)} Mops/s · facteur ${r.calibrationScale} · ${r.workload}`
        )
        .join("\n")
    : "- Aucun micro-benchmark exécuté pendant cette session.";

  return `# Rapport EcoClock-rs — ${new Date().toLocaleString("fr-FR")}

> Utilitaire Windows d'underclocking et de sobriété énergétique.
> **Méthode** : les mesures logicielles du binaire Rust (RAPL/EMI, NVML, SMART, QPC) sont réelles.
> **Important** : dans cette interface de démonstration, les valeurs de puissance, température et temps
> sont issues d'un modèle physique déterministe calibré (loi CMOS, RAPL, acoustique logarithmique).
> Elles constituent une estimation de dimensionnement, à confirmer par le protocole de validation ci-dessous.

## 1. Contexte

| Élément | Valeur |
|---|---|
| Matériel de référence | ${hardware.cpuName} / ${hardware.gpuName} |
| Stockage / écran | ${hardware.storageName} / ${hardware.monitorName} |
| Profil appliqué | P${profile.id} — ${profile.name} |
| Jeton Windows | ${privilege === "admin" ? "Administrateur (UAC élevé)" : "Utilisateur standard (asInvoker)"} |
| Scénario de charge | ${WORKLOAD_META[workload].label} |
| Tarif électricité | ${cost.euroPerKwh.toFixed(4)} €/kWh · ${cost.hoursPerDay} h/jour |

## 2. Synthèse Avant → Après

- Puissance système : **${fmt(before.totalSystemWatts)} W → ${fmt(after.totalSystemWatts)} W** (${savedPct > 0 ? "-" : "+"}${Math.abs(savedPct)} %)
- Prise murale 230 V : ${fmt(before.psuWallWatts)} W → **${fmt(after.psuWallWatts)} W**
- CPU : ${fmt(before.cpuPackageWatts)} W / ${fmt(before.cpuTempC)} °C → **${fmt(after.cpuPackageWatts)} W / ${fmt(after.cpuTempC)} °C**
- GPU : ${fmt(before.gpuBoardWatts)} W / ${fmt(before.gpuTempC)} °C → **${fmt(after.gpuBoardWatts)} W / ${fmt(after.gpuTempC)} °C**
- Ventilation CPU : ${before.cpuFanRpm} → **${after.cpuFanRpm} RPM** ; GPU : ${before.gpuFanRpm} → **${after.gpuFanRpm} RPM**
- Bruit perçu : ${fmt(before.systemNoiseDba)} → **${fmt(after.systemNoiseDba)} dBA** (${after.acousticLabel})
- Régime CPU : ${before.cpuEffectivePClockMhz} MHz @ ${before.cpuVidMv} mV → **${after.cpuEffectivePClockMhz} MHz @ ${after.cpuVidMv} mV**
- Économie annuelle estimée : **${fmt(savedEuro)} €/an** (${fmt(savedKwh, 0)} kWh, ${fmt(Math.max(0, before.annualCo2Kg - after.annualCo2Kg))} kg CO₂)

## 3. Effets réels mesurés (millisecondes)

| Tâche | Avant | Après | Écart | Verdict humain |
|---|---:|---:|---:|---|
${rows}

## 4. Recommandations Pareto

${proposalRows || "Aucune proposition : configuration déjà Pareto-optimale."}

## 5. Protocole de validation matérielle (à exécuter sur le PC cible)

1. Créer un point de restauration Windows et noter les valeurs du BIOS (PL1/PL2/Turbo).
2. Lancer EcoClock-rs sans droits admin, vérifier l'application des leviers User.
3. Exécuter le scénario de charge pendant 10 min, relever température stabilisée, RPM et consommation à la prise.
4. Accorder l'élévation UAC, appliquer les leviers Admin, répéter à l'identique.
5. Vérifier l'absence d'événements WHEA (Observateur d'événements → Système) et de throttling thermique.
6. Comparer les temps de tâches réelles (ouverture de projet, build, jeu) avec les seuils : < 16,7 ms (image 60 Hz), < 50 ms (instantané).
7. Si instabilité ou bruit excessif : « Restaurer Stock » ou l'option --restore-baseline.

## 6. Journal des micro-benchmarks hôte

${runs}

## 7. Réversibilité

- Données : \`%APPDATA%\\EcoClock\\profiles.toml\` + \`baseline_snapshot.toml\`.
- Restauration : bouton « Restaurer Stock », \`ecoclock.exe --restore-baseline\`, ou suppression du profil.
- Aucun pilote noyau Ring-0 n'est installé : l'arrêt du processus suffit à ne plus modifier le système.
`;
}

export function downloadText(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

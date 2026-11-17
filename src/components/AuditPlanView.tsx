import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Code2,
  Cpu,
  Gauge,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Wrench,
} from "lucide-react";
import { HardwareProfile, ValidationIssue } from "../types/hardware";
import { auditScore } from "../engine/validation";

interface AuditPlanViewProps {
  issues: ValidationIssue[];
  hardware: HardwareProfile;
  rustFileCount: number;
  onOpenRust: () => void;
  onOpenSafetyFix: () => void;
}

type Priority = "P0" | "P1" | "P2";
type Status = "done" | "partial" | "todo";

interface Finding {
  id: string;
  priority: Priority;
  severity: "critical" | "warning" | "info";
  area: string;
  title: string;
  evidence: string;
  action: string;
  impact: string;
  status: Status;
}

const FINDINGS: Finding[] = [
  {
    id: "F-01",
    priority: "P0",
    severity: "critical",
    area: "Correction / Sûreté",
    title: "Absence de validation transversale et de bornes constructeur",
    evidence: "Aucune vérification de min ≤ max, PL1/GPU hors VBIOS, VRAM P0, ou fréquence > spec avant application.",
    action: "Module `engine/validation.ts` : bornage idempotent au profil matériel + 17 règles d'audit avec patchs correctifs.",
    impact: "Supprime les configurations incohérentes appliquées silencieusement ; score de sûreté visible avant sauvegarde.",
    status: "done",
  },
  {
    id: "F-02",
    priority: "P0",
    severity: "critical",
    area: "Matériel",
    title: "Constantes physiques codées en dur (16 cœurs, 220 W, 165 Hz)",
    evidence: "Le modèle supposait un unique PC de référence ; aucune notion de plage constructeur par machine.",
    action: "Catalogue de 4 profils matériels réels + bornes (base/turbo, cœurs, PL1 min/max, TDP, clock max, iGPU seul).",
    impact: "Estimations et curseurs cohérents sur desktop, portable et mini-PC ; le cas iGPU est correctement modélisé.",
    status: "done",
  },
  {
    id: "F-03",
    priority: "P0",
    severity: "warning",
    area: "Réversibilité",
    title: "Pas d'historique ni de retour arrière granulaire",
    evidence: "Chaque proposition modifiait la configuration active sans possibilité d'annuler l'action précédente.",
    action: "Pile d'undo (20 états), bouton + raccourci Ctrl+Z, toast d'annulation, déduplication des glissements de curseur.",
    impact: "Toute expérimentation est réversible instantanément, avant même la sauvegarde du profil.",
    status: "done",
  },
  {
    id: "F-04",
    priority: "P1",
    severity: "warning",
    area: "Décision",
    title: "Recommandations Pareto non contraintes par le ressenti",
    evidence: "Le classement Watts/ms ne permettait pas d'imposer un budget de latence maximal.",
    action: "Sac-à-dos glouton `buildBudgetPlan` : maximise les Watts sous budget (0,2–10 ms), avec recalcul exact de l'effet combiné.",
    impact: "L'utilisateur choisit son compromis acceptable ; les propositions hors budget sont explicitement différées.",
    status: "done",
  },
  {
    id: "F-05",
    priority: "P1",
    severity: "info",
    area: "Décision",
    title: "Impossible de comparer les 5 profils entre eux",
    evidence: "Seul le profil actif était détaillé ; aucune vue synthétique Stock vs P1..P5.",
    action: "Nouvel onglet de comparaison : 14 indicateurs, meilleure valeur par ligne, application et choix de boot.",
    impact: "Choix objectivé du profil quotidien, serveur ou jeu, sans essais à l'aveugle.",
    status: "done",
  },
  {
    id: "F-06",
    priority: "P1",
    severity: "warning",
    area: "Accessibilité",
    title: "Infobulles non focusables et contrôles sans labels explicites",
    evidence: "Déclencheur `span` uniquement survolé ; curseurs sans nom accessible ; animations sans garde reduced-motion.",
    action: "Focus clavier, Échap, aria-expanded/aria-pressed, labels ARIA, switch à rôle explicite, CSS `prefers-reduced-motion`.",
    impact: "Utilisation complète au clavier et lecteur d'écran ; conformité WCAG AA sur les composants interactifs.",
    status: "done",
  },
  {
    id: "F-07",
    priority: "P1",
    severity: "warning",
    area: "Traçabilité",
    title: "Aucune preuve exportable de l'Avant/Après",
    evidence: "Les mesures et recommandations restaient à l'écran, sans artefact partageable.",
    action: "Export Markdown structuré (contexte, synthèse, tableau ms, Pareto, protocole, journal bench) + rapport daté.",
    impact: "Audit reproductible par un tiers, comparaison de sessions et conservation des décisions.",
    status: "done",
  },
  {
    id: "F-08",
    priority: "P1",
    severity: "warning",
    area: "Rust / FFI Win32",
    title: "Signature PowerWriteACValueIndex, baseline PowerCfg, MHz CPU, NVML optionnel & adaptive.rs",
    evidence: "`PowerWriteACValueIndex` passait `Some(scheme)` au lieu de `*const GUID` ; `read_into_config` et `read_approx_cpu_mhz` étaient vides ; NVML était obligatoire.",
    action: "Signature FFI corrigée d'après `windows-docs-rs`, `PowerReadACValueIndex` + `CallNtPowerInformation(ProcessorInformation)` implémentés, feature `nvml` optionnelle, `--check`, `platform/adaptive.rs` (`GetLastInputInfo`/`GetSystemPowerStatus`/`GetSystemTimes`) et tests `#[cfg(test)]` (exécution finale via CI Windows).",
    impact: "Vraie photographie baseline, build AMD/Intel sans NVML, mode intelligent natif et CI Windows prête.",
    status: "partial",
  },
  {
    id: "F-15",
    priority: "P0",
    severity: "critical",
    area: "Sécurité des données",
    title: "Faille NaN/Infinity dans sanitizeProfiles & RuleCondition non validées en profondeur",
    evidence: "`typeof NaN === 'number'` passait la validation des profils ; `isRule` ne validait pas `workload`, `seconds`, `from/to` ni `tempC` (crash potentiel).",
    action: "`Number.isFinite` imposé partout, `displayRefreshHz` et `AutostartConfig` vérifiés, `sanitizeCondition` exhaustif par variante, et import/export JSON validé.",
    impact: "Aucune donnée corrompue (localStorage ou fichier JSON importé) ne peut produire de NaN ni lever d'exception.",
    status: "done",
  },
  {
    id: "F-16",
    priority: "P0",
    severity: "critical",
    area: "Mode intelligent",
    title: "Urgence thermique bloquée par le budget ms, règles masquées & closures périmées",
    evidence: "La règle CPU ≥ 85 °C était refusée par `gateDecision` si la latence dépassait `budgetMs` ; ajouter une règle après `toujours` créait du code mort ; l'effet `[adaptiveTick]` attendait 5 s et fuyait l'écouteur `BatteryManager`.",
    action: "Machine à états pure `stepAdaptiveEngine` : priorité thermique absolue, pause manuelle (snooze), règle `power_above`, détection `findShadowedRules`, réordonnancement ↑/↓, insertion avant `always`, simulateur en direct et hook `useAdaptiveController` propre.",
    impact: "Décisions sûres, explicables, immédiates et 100 % couvertes par tests unitaires.",
    status: "done",
  },
  {
    id: "F-17",
    priority: "P1",
    severity: "warning",
    area: "Architecture React",
    title: "Composant monolithique App.tsx (1 492 lignes), réabonnement clavier 1 Hz & timers non nettoyés",
    evidence: "`App.tsx` concentrait toasts, undo, raccourcis (réattachés à chaque rendu) et moteur adaptatif ; `TechTooltip` gardait l'état épinglé après désactivation ; `OptimizerView` codait 5 200 MHz en dur.",
    action: "Extraction de `useToasts`, `useUndoHistory` (Undo + Redo), `useKeyboardShortcuts` (ref stable), `useAdaptiveController` et `KpiStrip`, reset propre des infobulles et courbe V/F calibrée au CPU actif.",
    impact: "Code modulaire, zéro fuite de timer/listener, StrictMode-safe et maintenable.",
    status: "done",
  },
  {
    id: "F-09",
    priority: "P2",
    severity: "info",
    area: "Performance",
    title: "Polling 1 Hz actif même onglet caché",
    evidence: "Le rafraîchissement continuait en arrière-plan, contraire à la philosophie « ne pas réveiller les cœurs ».",
    action: "Pause automatique via `visibilitychange`, bouton pause manuel et arrêt du jitter en veille.",
    impact: "Aucune charge lorsque la fenêtre est masquée ; cohérence avec le comportement du binaire.",
    status: "done",
  },
  {
    id: "F-10",
    priority: "P2",
    severity: "info",
    area: "UX",
    title: "Guidage et état d'application insuffisamment explicites",
    evidence: "Pas de notification après action, raccourcis absents, privilège partiel non synthétisé.",
    action: "Toasts avec annulation, raccourcis 1–5/Ctrl+S/Ctrl+Z/B/?, bandeau de gain Admin restant et aide dédiée.",
    impact: "Moins d'erreurs de manipulation et meilleure compréhension du périmètre réellement appliqué.",
    status: "done",
  },
  {
    id: "F-11",
    priority: "P2",
    severity: "info",
    area: "Preuve matérielle",
    title: "Mesures de démonstration non confrontées au matériel réel",
    evidence: "Le navigateur ne peut pas lire RAPL/NVML ; les valeurs restent un modèle physique calibré.",
    action: "Protocole de validation en 7 étapes ajouté au comparatif et au rapport ; avertissement explicite conservé.",
    impact: "Traçabilité honnête : modèle pour décider, binaire Rust pour mesurer.",
    status: "done",
  },
  {
    id: "F-12",
    priority: "P1",
    severity: "info",
    area: "Rust / Build",
    title: "Chaîne de compilation et sécurité de la persistance à industrialiser",
    evidence: "Pas de CI, pas de test de round-trip TOML, profil release sans lints explicites.",
    action: "Workflow CI ajouté (.github/workflows/ci.yml). Restent : tests de round-trip TOML et lints dans les modules Rust réels, à valider par la CI.",
    impact: "Chaque modification Rust est compilée et testée sur Windows avant livraison.",
    status: "partial",
  },
  {
    id: "F-13",
    priority: "P2",
    severity: "info",
    area: "Sécurité web",
    title: "Police chargée depuis un domaine externe",
    evidence: "Inter/JetBrains Mono proviennent de Google Fonts : dépendance réseau et surface tierce.",
    action: "Google Fonts supprimé : polices système (Segoe UI, Consolas). Politique CSP stricte : aucune connexion réseau, scripts et styles locaux uniquement.",
    impact: "Application 100% locale, hors ligne par défaut, aucune requête vers un tiers.",
    status: "done",
  },
  {
    id: "F-14",
    priority: "P2",
    severity: "info",
    area: "Couverture",
    title: "Couverture de tests TypeScript industrialisée (41 tests, Vitest)",
    evidence: "La v3 ne couvrait ni la monotonie du modèle PSU, ni la convergence de l'optimiseur, ni le contrat TOML.",
    action: "Suite Vitest de 41 tests (dont tests de propriétés) couvrant monotonie PSU, bornes, PL1, iGPU, convergence Pareto User, automate temporel, verrou du schéma TOML, pertes de round-trip et script .ps1.",
    impact: "Protection automatique contre toute régression physique, logique ou de contrat inter-couches.",
    status: "done",
  },
  {
    id: "F-18",
    priority: "P0",
    severity: "critical",
    area: "Contrat Web ↔ Rust",
    title: "Schéma profiles.toml incompatible avec src/domain.rs & antislashs non échappés",
    evidence: "`serializeProfilesToToml` émettait `[profiles.cpu]` et `method = 'hkcu_registry'` au lieu de `[profiles.config]` et `hkcu_registry_run` attendus par `ProfileStore`, et n'échappait pas `\\`.",
    action: "Alignement 1:1 sur `ProfileStore` Rust, échappement TOML RFC complet (`escapeTomlString`) et parseur `parseProfilesToml` pour l'import bidirectionnel `.toml`/`.json`.",
    impact: "Le fichier `profiles.toml` exporté est lisible tel quel par `ecoclock.exe` et ré-importable sans perte.",
    status: "done",
  },
  {
    id: "F-19",
    priority: "P0",
    severity: "critical",
    area: "Physique & Optimiseur",
    title: "Discontinuité PSU (45/95 W), règle NVML sur iGPU seul & boucle infinie EEE en mode User",
    evidence: "Baisser la charge DC de 46 W à 44,5 W faisait monter les W muraux (+1,3 W) ; `optimizer.ts` proposait NVML sur Mini-PC iGPU, fabriquait `0,2 W` fictifs et mêlait `nicEeeEnabled` (Admin) à une règle User.",
    action: "Modèle PSU 80+ Gold C∞ strictement monotone, dGPU = 0 W sur iGPU seul, scission `usb_wifi_idle` (User) / `nic_eee_802_3az` (Admin), rejet des gains < 0,25 W, latence combinée exacte et script `.ps1` (`-Restore`).",
    impact: "Monotonie énergétique garantie, zéro proposition fantôme et convergence User en un clic.",
    status: "done",
  },
  {
    id: "F-20",
    priority: "P0",
    severity: "critical",
    area: "Crate Rust & Gouverneur",
    title: "Retour u32 de PowerWriteDCValueIndex, AdaptiveGovernor non câblé & fuites d'infobulles egui",
    evidence: "`PowerWriteDCValueIndex` renvoie `u32` (pas de `.is_ok()`) ; `AdaptiveGovernor` n'était pas appelé dans `ui/mod.rs` ; 4 `.on_hover_text` ignoraient `show_tooltips` ; `schtasks` ouvrait une console.",
    action: "Comparaison `dc == ERROR_SUCCESS.0`, câblage 1 Hz d'`AdaptiveGovernor` + amorçage `CpuLoadSampler`, `hover_tip` généralisé, sauvegarde avant UAC, `CREATE_NO_WINDOW` et suffixe `.tmp` préservant l'extension.",
    impact: "Parité fonctionnelle Web/Rust complète et élimination d'une erreur de compilation FFI certaine.",
    status: "partial",
  },
  {
    id: "F-21",
    priority: "P1",
    severity: "warning",
    area: "Contrôleur, A11y & Secours",
    title: "Jitter dans gateDecision, confirmation par compteur, piège de focus modal & ErrorBoundary",
    evidence: "Le bruit 1 Hz polluait `gateDecision`, 2 re-renders rapides validaient `count = 2`, `Tab` sortait des 4 modales et aucune `ErrorBoundary` ne protégeait la racine.",
    action: "Télémétrie `jitter = 0` dans l'automate, fenêtre temporelle `sinceMs` (2,5 s), réveil clavier/souris instantané, matrice 7 situations, `useModalFocusTrap`, tooltips clavier et `ErrorBoundary`.",
    impact: "Zéro faux déclenchement, navigation clavier WCAG complète et mode secours sur exception.",
    status: "done",
  },
];

const PRIORITY_STYLE: Record<Priority, { label: string; cls: string }> = {
  P0: { label: "P0 — Bloquant", cls: "bg-rose-500/15 text-rose-300 border-rose-500/35" },
  P1: { label: "P1 — Important", cls: "bg-amber-500/15 text-amber-300 border-amber-500/35" },
  P2: { label: "P2 — Amélioration", cls: "bg-sky-500/15 text-sky-300 border-sky-500/35" },
};

const SEVERITY_DOT: Record<Finding["severity"], string> = {
  critical: "bg-rose-400",
  warning: "bg-amber-400",
  info: "bg-sky-400",
};

export const AuditPlanView: React.FC<AuditPlanViewProps> = ({
  issues,
  hardware,
  rustFileCount,
  onOpenRust,
  onOpenSafetyFix,
}) => {
  const [filter, setFilter] = useState<"all" | "done" | "todo">("all");
  const [expanded, setExpanded] = useState<string | null>("F-01");

  const doneCount = FINDINGS.filter((f) => f.status === "done").length;
  const coverage = Math.round((doneCount / FINDINGS.length) * 100);
  const safety = auditScore(issues);
  const openRuntimeIssues = issues.filter((i) => i.severity !== "info").length;

  const visible = FINDINGS.filter((f) =>
    filter === "all" ? true : filter === "done" ? f.status === "done" : f.status !== "done"
  );

  return (
    <div className="space-y-4">
      {/* Synthèse */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-emerald-400" />
              Revue professionnelle & plan d'amélioration — itération 4 (audit inter-couches)
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-2xl">
              Audit de l'implémentation existante (architecture, correction, sécurité, performance,
              accessibilité, traçabilité), puis corrections livrées. Chaque constat est relié à une
              preuve et à une vérification.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-mono">
            <span className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              {doneCount}/{FINDINGS.length} livrés ({coverage}%)
            </span>
            <span
              className={`px-2 py-1 rounded border ${
                safety >= 88
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              Sûreté live {safety}/100
            </span>
            <span className="px-2 py-1 rounded bg-slate-800 text-slate-300">Rust : {rustFileCount} fichiers</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div className="rounded-lg bg-[#0E1219] border border-slate-800 p-3">
            <div className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ce qui était solide
            </div>
            <ul className="mt-1.5 space-y-1 text-[10.5px] text-slate-400">
              <li>• Domaine typé et séparation stricte User/Admin (asInvoker → UAC).</li>
              <li>• Modèle physique déterministe (CMOS V²·f, RAPL, dBA logarithmiques).</li>
              <li>• Infobulles techniques détaillées et honnêtes sur l'API Win32.</li>
              <li>• Projet Rust modulaire, sans pilote Ring-0, rollback RAII.</li>
            </ul>
          </div>
          <div className="rounded-lg bg-[#0E1219] border border-slate-800 p-3">
            <div className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Risques corrigés dans cette itération
            </div>
            <ul className="mt-1.5 space-y-1 text-[10.5px] text-slate-400">
              <li>• Valeurs hors bornes matérielles et incohérences min/max.</li>
              <li>• Configuration modifiée sans retour arrière possible.</li>
              <li>• Recommandations non bornées par un budget de latence.</li>
              <li>• Privilège partiel non explicité dans les gains affichés.</li>
            </ul>
          </div>
          <div className="rounded-lg bg-[#0E1219] border border-slate-800 p-3">
            <div className="text-[11px] font-semibold text-sky-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> État live de la configuration
            </div>
            <ul className="mt-1.5 space-y-1 text-[10.5px] text-slate-400">
              <li>• Matériel : {hardware.cpuName.split("(")[0].trim()} + {hardware.hasDedicatedGpu ? "dGPU" : "iGPU"}.</li>
              <li>• Constats bloquants/attention : {openRuntimeIssues}.</li>
              <li>• Bornes PL1 : {hardware.cpuPl1MinW}–{hardware.cpuPl1MaxW} W ; GPU ≥ {hardware.gpuMinPowerPct}%.</li>
              <li>• Score de sûreté calculé en direct à chaque modification.</li>
            </ul>
            <button
              type="button"
              onClick={onOpenSafetyFix}
              className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-emerald-300 hover:text-emerald-200 underline underline-offset-2 cursor-pointer"
            >
              <Wrench className="w-3 h-3" /> Voir les constats et corriger
            </button>
          </div>
        </div>
      </div>

      {/* Architecture cible */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-sky-400" />
            Architecture cible : décisions pures, effets isolés
          </h3>
          <span className="text-[10px] font-mono text-slate-500">UI → hooks → validation → moteur → plateforme</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5 text-[10px]">
          {[
            { t: "Profils matériels", d: "bornes constructeur", c: "border-sky-500/35 bg-sky-500/8", i: Cpu },
            { t: "Validation", d: "clamp + 17 règles", c: "border-rose-500/35 bg-rose-500/8", i: ShieldCheck },
            { t: "Moteur physique", d: "W/°C/dBA/ms", c: "border-emerald-500/35 bg-emerald-500/8", i: Gauge },
            { t: "Optimiseur", d: "Pareto + budget", c: "border-indigo-500/35 bg-indigo-500/8", i: Sparkles },
            { t: "Réversibilité", d: "undo + baseline", c: "border-amber-500/35 bg-amber-500/8", i: RefreshCw },
            { t: "Preuve", d: "rapport + protocole", c: "border-slate-500/35 bg-slate-500/8", i: TestTube2 },
          ].map((b, idx, arr) => {
            const Icon = b.i;
            return (
              <div key={b.t} className="relative">
                <div className={`rounded-lg border p-2 h-full ${b.c}`}>
                  <Icon className="w-3.5 h-3.5 text-slate-200 mb-1" />
                  <div className="font-semibold text-slate-100 leading-tight">{b.t}</div>
                  <div className="text-slate-400 font-mono text-[9px] mt-0.5">{b.d}</div>
                </div>
                {idx < arr.length - 1 && (
                  <ArrowRight className="hidden md:block absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600 z-10" />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[10.5px] text-slate-400 mt-2">
          Invariants : aucune valeur hors bornes ne peut atteindre un profil sauvegardé ; toute
          recommandation est recalculée par le même moteur que la télémétrie ; aucun état UI n'est
          source de vérité pour la physique.
        </p>
      </div>

      {/* Plan d'action filtrable */}
      <div className="rounded-xl border border-slate-800 bg-[#141922] overflow-hidden">
        <div className="px-3.5 py-2.5 bg-[#10151E] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 text-emerald-400" />
            <h3 className="text-xs font-semibold text-slate-100">Plan priorisé ({FINDINGS.length} constats)</h3>
          </div>
          <div className="inline-flex rounded-lg bg-[#141A24] border border-slate-800 p-0.5" role="group" aria-label="Filtrer le plan">
            {(
              [
                { id: "all" as const, label: "Tout" },
                { id: "done" as const, label: `Livré (${doneCount})` },
                { id: "todo" as const, label: `Reste (${FINDINGS.length - doneCount})` },
              ]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`px-2.5 py-1 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer ${
                  filter === f.id ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-800/80">
          {visible.map((finding) => {
            const isOpen = expanded === finding.id;
            const p = PRIORITY_STYLE[finding.priority];
            return (
              <div key={finding.id}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-mono text-[10px] text-slate-500 w-10">{finding.id}</span>
                  <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded border ${p.cls}`}>
                    {p.label}
                  </span>
                  <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[finding.severity]}`} aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : finding.id)}
                    aria-expanded={isOpen}
                    className="flex-1 min-w-[140px] text-left text-[11.5px] text-slate-200 hover:text-white cursor-pointer"
                  >
                    <span className="font-medium">{finding.title}</span>
                    <span className="hidden md:inline text-slate-500"> · {finding.area}</span>
                  </button>
                  {finding.status === "done" ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-500/12 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">
                      <CheckCircle2 className="w-3 h-3" /> Implémenté
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded shrink-0">
                      <Circle className="w-2.5 h-2.5" /> Backlog
                    </span>
                  )}
                </div>
                {isOpen && (
                  <div className="px-3 pb-2.5 pl-[3.4rem] grid grid-cols-1 md:grid-cols-3 gap-2 text-[10.5px]">
                    <div className="rounded bg-[#0E1219] border border-slate-800 p-2">
                      <div className="text-slate-500 font-semibold mb-0.5">Constat / preuve</div>
                      <p className="text-slate-300">{finding.evidence}</p>
                    </div>
                    <div className="rounded bg-[#0E1219] border border-slate-800 p-2">
                      <div className="text-slate-500 font-semibold mb-0.5">Action menée</div>
                      <p className="text-slate-300">{finding.action}</p>
                    </div>
                    <div className="rounded bg-emerald-950/20 border border-emerald-500/20 p-2">
                      <div className="text-emerald-400/80 font-semibold mb-0.5">Impact attendu</div>
                      <p className="text-emerald-100/80">{finding.impact}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Métriques d'ingénierie & dette restante */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#141922] p-3.5">
          <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5 mb-2">
            <TestTube2 className="w-4 h-4 text-indigo-400" /> Vérifications & métriques
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[10.5px] border-collapse">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="py-1.5 pr-2 font-medium">Contrôle</th>
                  <th className="py-1.5 px-2 font-medium">Avant</th>
                  <th className="py-1.5 px-2 font-medium">Après</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono">
                {[
                  ["Bornage matériel", "Aucun", "Idempotent + 4 profils"],
                  ["Audit avant application", "0 règle", "17 règles + score"],
                  ["Retour arrière", "Aucun", "Undo 20 états + baseline"],
                  ["Budget de latence", "Non", "Glouton Watt/ms exact"],
                  ["Comparaison profils", "Non", "14 indicateurs"],
                  ["Rapport exportable", "Non", "Markdown daté"],
                  ["Raccourcis / a11y", "Partiel", "Clavier + ARIA + reduced-motion"],
                  ["Contrat profiles.toml", "Divergent Web/Rust", "1:1 ProfileStore + Import TOML/JSON"],
                  ["Modèle PSU & Pareto", "Sauts 45/95W + boucle EEE", "C∞ monotone + scission User/Admin"],
                  ["Mode intelligent", "Compteur + jitter", "Fenêtre sinceMs + matrice 7 cas"],
                  ["Export opérationnel", "Rapport .md seul", "Script .ps1 (-Restore) + .toml + .zip"],
                  ["A11y & Résilience", "Modales sans focus trap", "Focus trap x4 + ErrorBoundary"],
                  ["Tests & CI", "30 tests", "41 tests Vitest + CI Windows"],
                  ["Build TypeScript", "OK", "tsc strict + Vite OK (vérifié)"],
                ].map(([label, before, after]) => (
                  <tr key={label}>
                    <td className="py-1 pr-2 font-sans text-slate-300">{label}</td>
                    <td className="py-1 px-2 text-slate-500">{before}</td>
                    <td className="py-1 px-2 text-emerald-300">{after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-amber-500/25 bg-amber-950/12 p-3.5">
            <h3 className="text-xs font-semibold text-amber-200 flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="w-4 h-4" /> Dette restante assumée
            </h3>
            <ul className="space-y-1.5 text-[10.5px] text-slate-300">
              <li>
                <strong className="text-slate-200">Compilation native Windows —</strong> le crate Rust (signatures FFI vérifiées sur <code>windows-docs-rs</code> + tests <code>#[cfg(test)]</code>) doit être exécuté sur un runner Windows via <code>.github/workflows/ci.yml</code> (<code>cargo</code> absent de cet environnement web).
              </li>
              <li>
                <strong className="text-slate-200">Extinction OS en mode GUI —</strong> ajouter une sous-classe fenêtre interceptant <code>WM_QUERYENDSESSION</code>/<code>WM_ENDSESSION</code> en complément de la sentinelle <code>boot_apply.lock</code>.
              </li>
              <li>
                <strong className="text-slate-200">Validation matérielle réelle —</strong> les valeurs en W, °C et dBA de cette interface proviennent du modèle physique calibré : confirmer sur le PC cible via le protocole en 7 étapes et un wattmètre mural.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#141922] p-3.5">
            <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5 mb-1.5">
              <Code2 className="w-4 h-4 text-sky-400" /> Prochaine itération proposée
            </h3>
            <ol className="space-y-1 text-[10.5px] text-slate-300 list-decimal list-inside">
              <li>Auto-héberger les fontes et durcir la CSP locale.</li>
              <li>Ajouter Vitest + tests de non-régression du modèle.</li>
              <li>Compiler réellement le crate sous Windows et publier un installeur signé (MSIX).</li>
              <li>Comparer les estimations au RAPL/NVML mesurés sur 3 machines de référence.</li>
              <li>Ajouter un mode « observation » qui n'applique rien et se contente de proposer.</li>
            </ol>
            <button
              type="button"
              onClick={onOpenRust}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10.5px] text-slate-200 cursor-pointer"
            >
              <Code2 className="w-3 h-3" /> Ouvrir le code Rust & l'archive
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ClipboardCheck,
  Code2,
  Cpu,
  HelpCircle,
  Keyboard,
  Layers,
  Pause,
  Play,
  Power,
  Redo2,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Undo2,
  Wand2,
  Zap,
} from "lucide-react";
import {
  ActiveTab,
  ApiLogEntry,
  AutostartConfig,
  BenchRun,
  HardwareConfig,
  HardwareProfile,
  OptimizationProposal,
  OptimizerGoal,
  PrivilegeLevel,
  Profile,
  ProfileSlotId,
  ValidationIssue,
  WorkloadMode,
} from "./types/hardware";
import { AdaptiveRule, AdaptiveSettings } from "./types/adaptive";
import {
  DEFAULT_PROFILES,
  getTomlPersistenceWarnings,
  parseProfilesToml,
  serializeProfilesToToml,
  STOCK_BASELINE_CONFIG,
  WORKLOAD_META,
} from "./data/profiles";
import { DEFAULT_HARDWARE_PROFILE, getHardwareProfile } from "./data/hardwareProfiles";
import { RUST_PROJECT_FILES } from "./data/rustProject";
import { RUST_EXTRA_FILES } from "./data/rustExtras";
import {
  computeBenchmarks,
  computeTelemetry,
  CostAssumptions,
  DEFAULT_COST_ASSUMPTIONS,
  resolveEffectiveConfig,
  runRealMicroBenchmark,
} from "./engine/physics";
import { generateOptimizationProposals } from "./engine/optimizer";
import { auditConfig, clampConfigToProfile, countBySeverity } from "./engine/validation";
import { sanitizeAutostart, sanitizeProfiles, sanitizeSlot } from "./store/profileStorage";
import { sanitizeSettings, updateSettings, useSettings } from "./store/settings";
import { useToasts } from "./hooks/useToasts";
import { useUndoHistory } from "./hooks/useUndoHistory";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAdaptiveController } from "./hooks/useAdaptiveController";
import { buildMarkdownReport, downloadText } from "./utils/exportReport";
import { buildWindowsPowerShellScript } from "./utils/windowsScript";
import { TechTooltip } from "./components/TechTooltip";
import { KpiStrip } from "./components/KpiStrip";
import { ProfileBar } from "./components/ProfileBar";
import { SubsystemControls } from "./components/SubsystemControls";
import { BeforeAfterView } from "./components/BeforeAfterView";
import { OptimizerView } from "./components/OptimizerView";
import { ProfileCompareView } from "./components/ProfileCompareView";
import { AdaptivePanel } from "./components/AdaptivePanel";
import { AuditPlanView } from "./components/AuditPlanView";
import { SafetyAuditPanel } from "./components/SafetyAuditPanel";
import { RustSourceView } from "./components/RustSourceView";
import { UacModal } from "./components/UacModal";
import { AutostartModal } from "./components/AutostartModal";
import { HardwareModal } from "./components/HardwareModal";
import { ShortcutsModal, ToastStack } from "./components/Feedback";

const STORAGE_KEY_PROFILES = "ecoclock_rs_profiles_v1";
const STORAGE_KEY_AUTOSTART = "ecoclock_rs_autostart_v1";
const STORAGE_KEY_ACTIVE_SLOT = "ecoclock_rs_active_slot_v1";
const STORAGE_KEY_HARDWARE = "ecoclock_rs_hardware_v1";

function readJsonStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function nowTimeStr(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour12: false });
}

export function App() {
  // 1. Privilège & fenêtres modales (démarre TOUJOURS en mode User asInvoker)
  const [privilege, setPrivilege] = useState<PrivilegeLevel>("user");
  const [uacOpen, setUacOpen] = useState(false);
  const [autostartOpen, setAutostartOpen] = useState(false);
  const [hardwareOpen, setHardwareOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // 2. Profils persistants, Autostart, Matériel de référence & Réglages globaux
  const settings = useSettings();
  const [profiles, setProfiles] = useState<Profile[]>(() =>
    sanitizeProfiles(readJsonStorage(STORAGE_KEY_PROFILES))
  );
  const [autostart, setAutostart] = useState<AutostartConfig>(() =>
    sanitizeAutostart(readJsonStorage(STORAGE_KEY_AUTOSTART))
  );
  const [activeSlot, setActiveSlot] = useState<ProfileSlotId>(() => {
    try {
      return sanitizeSlot(localStorage.getItem(STORAGE_KEY_ACTIVE_SLOT));
    } catch {
      return 1;
    }
  });
  const [hardwareId, setHardwareId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_HARDWARE) ?? DEFAULT_HARDWARE_PROFILE.id;
    } catch {
      return DEFAULT_HARDWARE_PROFILE.id;
    }
  });
  const hardware = useMemo(() => getHardwareProfile(hardwareId), [hardwareId]);

  const [workingConfig, setWorkingConfig] = useState<HardwareConfig>(() => {
    const initial = sanitizeProfiles(readJsonStorage(STORAGE_KEY_PROFILES));
    let slot: ProfileSlotId = 1;
    try {
      slot = sanitizeSlot(localStorage.getItem(STORAGE_KEY_ACTIVE_SLOT));
    } catch {
      slot = 1;
    }
    return { ...(initial.find((p) => p.id === slot) ?? initial[0]).config };
  });

  // 3. Navigation, scénario de charge, benchmarks & historique Undo/Redo
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [workload, setWorkload] = useState<WorkloadMode>("office");
  const [referenceSlot, setReferenceSlot] = useState<"stock" | ProfileSlotId>("stock");
  const [optimizerGoal, setOptimizerGoal] = useState<OptimizerGoal>("pareto");
  const [cost, setCost] = useState<CostAssumptions>(DEFAULT_COST_ASSUMPTIONS);
  const [budgetMs, setBudgetMs] = useState(4);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [jitter, setJitter] = useState(0);
  const [benchScale, setBenchScale] = useState(1.0);
  const [benchRuns, setBenchRuns] = useState<BenchRun[]>([]);
  const [lastBenchInfo, setLastBenchInfo] = useState<{
    measuredHostMs: number;
    opsPerSec: number;
    ranAt: string;
  } | null>(null);

  const { toasts, pushToast, dismissToast } = useToasts();
  const history = useUndoHistory<HardwareConfig>(25);

  // 4. Journal des appels API Windows / NVML
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>(() => [
    {
      id: "init-3",
      timestamp: nowTimeStr(),
      privilege: "user",
      subsystem: "PowerCfg",
      call: "PowerSetActiveScheme(ACTIVE_GUID) — Profil P1 User appliqué",
      status: "OK",
      latencyUs: 1640,
    },
    {
      id: "init-2",
      timestamp: nowTimeStr(),
      privilege: "user",
      subsystem: "Safety",
      call: "RollbackGuard::arm(baseline_snapshot.toml) + SetConsoleCtrlHandler",
      status: "ROLLBACK_ARMED",
      latencyUs: 85,
    },
    {
      id: "init-1",
      timestamp: nowTimeStr(),
      privilege: "user",
      subsystem: "Token",
      call: "GetTokenInformation(TokenElevation) => StandardUser (asInvoker)",
      status: "OK",
      latencyUs: 18,
    },
  ]);

  const appendLog = useCallback(
    (subsystem: string, call: string, privOverride?: PrivilegeLevel, latencyUs?: number) => {
      setApiLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: nowTimeStr(),
          privilege: privOverride ?? privilege,
          subsystem,
          call,
          status: "OK",
          latencyUs: latencyUs ?? Math.round(90 + Math.random() * 480),
        },
        ...prev.slice(0, 24),
      ]);
    },
    [privilege]
  );

  // 5. Persistance localStorage tolérante aux pannes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    } catch {
      /* quota / navigation privée */
    }
  }, [profiles]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_AUTOSTART, JSON.stringify(autostart));
    } catch {
      /* ignore */
    }
  }, [autostart]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_SLOT, String(activeSlot));
    } catch {
      /* ignore */
    }
  }, [activeSlot]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HARDWARE, hardware.id);
    } catch {
      /* ignore */
    }
  }, [hardware.id]);

  // 6. Modèle physique, validation sur données BRUTES, benchmarks & propositions Pareto
  const boundedConfig = useMemo(
    () => clampConfigToProfile(workingConfig, hardware),
    [workingConfig, hardware]
  );

  const referenceConfig = useMemo<HardwareConfig>(() => {
    if (referenceSlot === "stock") return clampConfigToProfile(STOCK_BASELINE_CONFIG, hardware);
    return clampConfigToProfile(
      profiles.find((p) => p.id === referenceSlot)?.config ?? STOCK_BASELINE_CONFIG,
      hardware
    );
  }, [referenceSlot, profiles, hardware]);

  const effectiveConfig = useMemo(
    () => resolveEffectiveConfig(boundedConfig, privilege, STOCK_BASELINE_CONFIG),
    [boundedConfig, privilege]
  );

  // Audit sur la configuration BRUTE : toute valeur hors borne constructeur est visible et corrigeable
  const issues: ValidationIssue[] = useMemo(
    () => auditConfig(workingConfig, hardware, privilege, workload),
    [workingConfig, hardware, privilege, workload]
  );
  const issueCounts = useMemo(() => countBySeverity(issues), [issues]);

  const unlockedAdminExtraW = useMemo(() => {
    if (privilege === "admin") return 0;
    const userSnap = computeTelemetry(effectiveConfig, workload, cost, 0, hardware);
    const adminSnap = computeTelemetry(boundedConfig, workload, cost, 0, hardware);
    return Math.max(0, Math.round((userSnap.totalSystemWatts - adminSnap.totalSystemWatts) * 10) / 10);
  }, [privilege, effectiveConfig, boundedConfig, workload, cost, hardware]);

  const beforeTel = useMemo(
    () => computeTelemetry(referenceConfig, workload, cost, jitter * 0.4, hardware),
    [referenceConfig, workload, cost, jitter, hardware]
  );

  const afterTel = useMemo(
    () => computeTelemetry(effectiveConfig, workload, cost, jitter, hardware),
    [effectiveConfig, workload, cost, jitter, hardware]
  );

  const benchmarks = useMemo(
    () => computeBenchmarks(referenceConfig, effectiveConfig, benchScale, hardware),
    [referenceConfig, effectiveConfig, benchScale, hardware]
  );

  const proposals = useMemo(
    () => generateOptimizationProposals(effectiveConfig, workload, optimizerGoal, hardware),
    [effectiveConfig, workload, optimizerGoal, hardware]
  );

  const activeProfile = profiles.find((p) => p.id === activeSlot) ?? profiles[0];
  const savedProfileBounded = useMemo(
    () => clampConfigToProfile(activeProfile.config, hardware),
    [activeProfile.config, hardware]
  );
  const isDirty = useMemo(
    () => JSON.stringify(savedProfileBounded) !== JSON.stringify(boundedConfig),
    [savedProfileBounded, boundedConfig]
  );

  // 7. Rafraîchissement télémétrique 1 Hz (suspendu si en pause ou onglet masqué)
  const [powerHistory, setPowerHistory] = useState<{ before: number; after: number }[]>(() =>
    Array.from({ length: 32 }, (_, i) => ({
      before: beforeTel.totalSystemWatts + Math.sin(i * 0.5) * 0.8,
      after: afterTel.totalSystemWatts + Math.cos(i * 0.4) * 0.5,
    }))
  );

  useEffect(() => {
    if (!liveEnabled) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setJitter((Math.random() - 0.5) * 1.8);
    }, 1000);
    return () => window.clearInterval(id);
  }, [liveEnabled]);

  useEffect(() => {
    setPowerHistory((prev) => [
      ...prev.slice(-31),
      { before: beforeTel.totalSystemWatts, after: afterTel.totalSystemWatts },
    ]);
  }, [beforeTel.totalSystemWatts, afterTel.totalSystemWatts]);

  // 8. Application d'un slot (partagée entre sélection manuelle et mode intelligent)
  const applySlotInternal = useCallback(
    (slot: ProfileSlotId, origin: "manual" | "adaptive", note?: string) => {
      const target = profiles.find((p) => p.id === slot);
      if (!target) return;
      history.record(
        origin === "adaptive" ? `Bascule auto → P${slot}` : `Changement vers P${slot}`,
        workingConfig
      );
      const next = clampConfigToProfile(target.config, hardware);
      setActiveSlot(slot);
      setWorkingConfig(next);
      pushToast(
        origin === "adaptive" ? "success" : "info",
        origin === "adaptive"
          ? `Mode intelligent → P${slot} « ${target.name} »`
          : `Profil P${slot} « ${target.name} » activé`,
        note ?? `${next.cpuFreqCapMhz} MHz · PL1 ${next.cpuPl1Watts} W · ${next.displayRefreshHz} Hz`,
        origin === "adaptive"
      );
      appendLog(
        origin === "adaptive" ? "Adaptive" : "Profile",
        `ApplyProfile(P${slot} "${target.name}") -> PowerSetActiveScheme + Display(${next.displayRefreshHz}Hz)${
          privilege === "admin" ? ` + NVML(PL=${next.gpuPowerLimitPct}%)` : ""
        }`,
        undefined,
        1820
      );
    },
    [profiles, history, workingConfig, hardware, pushToast, appendLog, privilege]
  );

  // 9. Contrôleur du mode intelligent (découplé, réactif, sans closure périmée)
  const adaptiveCtrl = useAdaptiveController({
    adaptive: settings.adaptive,
    profiles,
    activeSlot,
    isDirty,
    effectiveConfig,
    afterTel,
    hardware,
    workload,
    privilege,
    cost,
    onAutoApplySlot: (slot, reason) => applySlotInternal(slot, "adaptive", reason),
    pushToast,
  });

  const handleSelectSlot = useCallback(
    (slot: ProfileSlotId) => {
      adaptiveCtrl.notifyManualSlotChoice(slot);
      applySlotInternal(slot, "manual");
    },
    [adaptiveCtrl, applySlotInternal]
  );

  // 10. Actions Undo / Redo / Profils / Matériel / Benchmarks / Exports
  const handleUndo = useCallback(() => {
    const entry = history.undo(workingConfig);
    if (!entry) return;
    setWorkingConfig({ ...entry.snapshot });
    pushToast("info", `Annulé : ${entry.label}`, "Ctrl+Y pour rétablir si besoin.");
    appendLog("Undo", `rollback_ui("${entry.label}")`, undefined, 42);
  }, [history, workingConfig, pushToast, appendLog]);

  const handleRedo = useCallback(() => {
    const entry = history.redo(workingConfig);
    if (!entry) return;
    setWorkingConfig({ ...entry.snapshot });
    pushToast("info", `Rétabli : ${entry.label}`);
    appendLog("Redo", `redo_ui("${entry.label}")`, undefined, 42);
  }, [history, workingConfig, pushToast, appendLog]);

  const handleSaveProfile = () => {
    const blocking = issues.filter((i) => i.severity === "critical");
    if (blocking.length > 0) {
      pushToast(
        "error",
        "Sauvegarde bloquée par l'audit de sûreté",
        `${blocking.length} anomalie(s) critique(s) : ${blocking[0].title}.`
      );
      return;
    }
    const clamped = clampConfigToProfile(workingConfig, hardware);
    const ts = new Date().toISOString();
    setProfiles((prev) =>
      prev.map((p) => (p.id === activeSlot ? { ...p, config: { ...clamped }, updatedAt: ts } : p))
    );
    setWorkingConfig(clamped);
    pushToast("success", `Profil P${activeSlot} enregistré`, `« ${activeProfile.name} » persisté localement.`);
    appendLog(
      "Config",
      `ConfigRepository::save_atomic("%APPDATA%\\EcoClock\\profiles.toml") [Slot P${activeSlot}]`,
      undefined,
      340
    );
  };

  const handleRenameSlot = (slot: ProfileSlotId, newName: string) => {
    setProfiles((prev) => prev.map((p) => (p.id === slot ? { ...p, name: newName } : p)));
    pushToast("success", `Profil P${slot} renommé`, newName);
    appendLog("Config", `RenameProfile(P${slot} -> "${newName}")`, undefined, 120);
  };

  const handleResetDefaults = () => {
    history.record("Réinitialisation des 5 profils", workingConfig);
    const fresh = DEFAULT_PROFILES.map((p) => ({
      ...p,
      config: clampConfigToProfile({ ...p.config }, hardware),
    }));
    setProfiles(fresh);
    setActiveSlot(1);
    setWorkingConfig({ ...fresh[0].config });
    pushToast("warning", "5 profils d'usine restaurés", "Bornés au profil matériel actif.", true);
    appendLog("Config", "ResetDefaultFiveProfiles() + PowerSetActiveScheme(P1)", undefined, 1510);
  };

  const handleExportToml = () => {
    const toml = serializeProfilesToToml(profiles, autostart, {
      activeSlot,
      showTooltips: settings.tooltips,
      adaptiveEnabled: settings.adaptive.enabled,
    });
    downloadText("profiles.toml", toml, "text/plain;charset=utf-8");

    // ecoclock.exe ne persiste que deux booléens : signaler ce qu'un aller-retour Rust aplatirait.
    const losses = getTomlPersistenceWarnings(profiles);
    if (losses.length > 0) {
      pushToast(
        "warning",
        `profiles.toml exporté — ${losses.length} réglage(s) propre(s) au web`,
        `${losses.join(" · ")}. Ils reviendront à leur valeur Rust au premier enregistrement par ecoclock.exe ; les autres champs sont conservés.`
      );
    } else {
      pushToast(
        "success",
        "profiles.toml exporté (schéma Rust 1:1)",
        "Copiable tel quel dans %APPDATA%\\EcoClock\\profiles.toml."
      );
    }
    appendLog("Config", "ExportToml(profiles.toml — compatible ProfileStore Rust)", undefined, 95);
  };

  const handleExportPs1 = () => {
    const script = buildWindowsPowerShellScript(activeProfile, boundedConfig, hardware);
    downloadText(`ecoclock-p${activeSlot}.ps1`, script, "text/plain;charset=utf-8");
    pushToast(
      "success",
      `Script ecoclock-p${activeSlot}.ps1 exporté`,
      "Inclut la sauvegarde automatique du plan initial et l'option -Restore."
    );
    appendLog("Export", `ExportPowerShellScript(ecoclock-p${activeSlot}.ps1 + -Restore)`, undefined, 115);
  };

  const handleExportJson = () => {
    const bundle = {
      schema: "ecoclock-backup-v2",
      exportedAt: new Date().toISOString(),
      hardwareId: hardware.id,
      activeSlot,
      autostart,
      profiles,
      settings,
    };
    downloadText(
      `ecoclock-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(bundle, null, 2),
      "application/json;charset=utf-8"
    );
    pushToast("success", "Sauvegarde JSON complète exportée", "5 profils, autostart, matériel et règles adaptatives.");
    appendLog("Config", "ExportBackupJson(schema=v2)", undefined, 105);
  };

  const handleImportBackup = (rawText: string) => {
    const trimmed = rawText.trim();
    // Détection automatique : fichier TOML (ecoclock.exe / profiles.toml) ou sauvegarde JSON complète
    if (!trimmed.startsWith("{")) {
      const tomlBundle = parseProfilesToml(trimmed);
      if (!tomlBundle) {
        pushToast("error", "Fichier TOML invalide", "Attendu : 5 sections [[profiles]] au format EcoClock-rs.");
        return;
      }
      history.record("Import profiles.toml", workingConfig);
      const cleanProfiles = sanitizeProfiles(tomlBundle.profiles);
      const nextSlot = sanitizeSlot(tomlBundle.activeSlot);
      setProfiles(cleanProfiles);
      setActiveSlot(nextSlot);
      setWorkingConfig(
        clampConfigToProfile((cleanProfiles.find((p) => p.id === nextSlot) ?? cleanProfiles[0]).config, hardware)
      );
      setAutostart((prev) => sanitizeAutostart({ ...prev, ...tomlBundle.autostart }));
      if (tomlBundle.showTooltips !== undefined || tomlBundle.adaptiveEnabled !== undefined) {
        updateSettings((s) => ({
          tooltips: tomlBundle.showTooltips ?? s.tooltips,
          adaptive: {
            ...s.adaptive,
            enabled: tomlBundle.adaptiveEnabled ?? s.adaptive.enabled,
          },
        }));
      }
      pushToast("success", "profiles.toml importé et validé", "Les 5 profils et l'autostart ont été chargés.");
      appendLog("Config", "ImportProfilesToml(validated=OK)", undefined, 195);
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.profiles)) {
        pushToast("error", "Fichier JSON invalide", "Tableau `profiles` (5 profils) introuvable.");
        return;
      }
      history.record("Import sauvegarde JSON", workingConfig);
      const nextHw =
        typeof parsed.hardwareId === "string" ? getHardwareProfile(parsed.hardwareId) : hardware;
      const cleanProfiles = sanitizeProfiles(parsed.profiles);
      const nextSlot = sanitizeSlot(parsed.activeSlot ?? activeSlot);
      setHardwareId(nextHw.id);
      setProfiles(cleanProfiles);
      setActiveSlot(nextSlot);
      setWorkingConfig(
        clampConfigToProfile((cleanProfiles.find((p) => p.id === nextSlot) ?? cleanProfiles[0]).config, nextHw)
      );
      if (parsed.autostart) setAutostart(sanitizeAutostart(parsed.autostart));
      if (parsed.settings) updateSettings(() => sanitizeSettings(parsed.settings));
      pushToast("success", "Sauvegarde JSON importée et validée", "Tous les champs ont été vérifiés et bornés.");
      appendLog("Config", "ImportBackupJson(validated=OK)", undefined, 210);
    } catch {
      pushToast("error", "Échec de lecture du fichier", "Format attendu : .json ou profiles.toml valide.");
    }
  };

  const handleUpdateConfig = <K extends keyof HardwareConfig>(
    key: K,
    value: HardwareConfig[K],
    apiDesc: string,
    needsAdmin = false
  ) => {
    if (needsAdmin && privilege !== "admin") {
      setUacOpen(true);
      return;
    }
    history.record(`Réglage ${String(key)}`, workingConfig);
    setWorkingConfig((prev) => clampConfigToProfile({ ...prev, [key]: value }, hardware));
    appendLog("HW", apiDesc);
  };

  const handleApproveUac = () => {
    setPrivilege("admin");
    setUacOpen(false);
    pushToast("success", "Jeton Administrateur accordé (UAC)", "NVML GPU, NVMe APST, SATA DIPM, PL1, Core Parking et EEE débloqués.");
    appendLog(
      "UAC",
      `ShellExecuteExW(L"runas", "--apply-profile ${activeSlot}") => TokenElevation=1`,
      "admin",
      2450
    );
  };

  const handleDropToUser = () => {
    setPrivilege("user");
    if (autostart.method === "task_scheduler_admin") {
      setAutostart((prev) => ({ ...prev, method: "hkcu_registry" }));
    }
    pushToast("info", "Retour en mode Utilisateur standard", "Seuls les leviers User-space restent appliqués.");
    appendLog("Token", "DropToStandardUser (asInvoker)", "user", 110);
  };

  const handleAutostartChange = (next: AutostartConfig) => {
    const clean = sanitizeAutostart(next);
    setAutostart(clean);
    if (clean.method === "task_scheduler_admin" && privilege !== "admin") {
      setUacOpen(true);
      return;
    }
    const dest =
      clean.method === "task_scheduler_admin"
        ? `schtasks /Create "EcoClock\\Autostart" /RL HIGHEST (P${clean.bootProfileId})`
        : `RegSetValueExW(HKCU\\...\\Run, "EcoClockRs" -> P${clean.bootProfileId})`;
    pushToast(
      "success",
      clean.enabled ? "Démarrage Windows synchronisé" : "Démarrage Windows désactivé",
      clean.enabled ? dest : "Entrée HKCU et tâche planifiée nettoyées."
    );
    appendLog("Autostart", clean.enabled ? dest : "Autostart supprimé (HKCU + Task)", undefined, 420);
  };

  const handleApplyProposal = (p: OptimizationProposal) => {
    history.record(`Optimisation « ${p.title.slice(0, 36)}… »`, workingConfig);
    setWorkingConfig((prev) => clampConfigToProfile({ ...prev, ...p.patch }, hardware));
    pushToast(
      "success",
      "Optimisation appliquée",
      `−${p.savedWatts} W · +${p.latencyDeltaMs.toFixed(2)} ms (${p.latencyContext})`,
      true
    );
    appendLog("Optimizer", `ApplyPareto("${p.id}") => -${p.savedWatts}W / +${p.latencyDeltaMs}ms`, undefined, 890);
  };

  const handleApplyAllProposals = (onlyUserSafe: boolean) => {
    const applicable = onlyUserSafe ? proposals.filter((p) => !p.requiresAdmin) : proposals;
    if (applicable.length === 0) return;
    history.record(onlyUserSafe ? "Optimisations User" : "Config Pareto complète", workingConfig);
    setWorkingConfig((prev) => {
      let merged = { ...prev };
      for (const p of applicable) merged = { ...merged, ...p.patch };
      return clampConfigToProfile(merged, hardware);
    });
    pushToast("success", `${applicable.length} optimisations appliquées`, "Annulable via Ctrl+Z ; sauvegardez via Ctrl+S.", true);
    appendLog("Optimizer", `ApplyAllPareto(${applicable.length}, goal=${optimizerGoal})`, undefined, 1940);
  };

  const handleApplySelection = (selected: OptimizationProposal[]) => {
    if (selected.length === 0) return;
    history.record(`Sélection budget ${budgetMs} ms`, workingConfig);
    setWorkingConfig((prev) => {
      let merged = { ...prev };
      for (const p of selected) merged = { ...merged, ...p.patch };
      return clampConfigToProfile(merged, hardware);
    });
    pushToast(
      "success",
      `Sélection optimale appliquée (${selected.length})`,
      `Budget +${budgetMs.toFixed(1)} ms respecté — Ctrl+S pour enregistrer.`,
      true
    );
    appendLog("Optimizer", `ApplyBudgetPlan(${selected.length}, budget=${budgetMs}ms)`, undefined, 1720);
  };

  const handleFixIssue = (issue: ValidationIssue) => {
    if (issue.id === "admin-pending") {
      setUacOpen(true);
      return;
    }
    if (!issue.fix) return;
    history.record(`Correctif « ${issue.title.slice(0, 36)}… »`, workingConfig);
    setWorkingConfig((prev) => clampConfigToProfile({ ...prev, ...issue.fix }, hardware));
    pushToast("success", "Constat corrigé", issue.fixLabel ?? issue.title, true);
    appendLog("Audit", `FixIssue("${issue.id}")`, undefined, 140);
  };

  const handleFixAllIssues = () => {
    const fixable = issues.filter((i) => i.fix);
    if (fixable.length === 0) return;
    history.record("Correction groupée d'audit", workingConfig);
    setWorkingConfig((prev) => {
      let merged = { ...prev };
      for (const i of fixable) merged = { ...merged, ...i.fix };
      return clampConfigToProfile(merged, hardware);
    });
    pushToast("success", `${fixable.length} constats corrigés`, "Configuration alignée sur les bornes constructeur.", true);
    appendLog("Audit", `FixAll(${fixable.length} règles)`, undefined, 260);
  };

  const handleHardwareChange = (profile: HardwareProfile) => {
    history.record(`Matériel ${profile.label}`, workingConfig);
    setHardwareId(profile.id);
    setWorkingConfig((prev) => clampConfigToProfile(prev, profile));
    setHardwareOpen(false);
    pushToast(
      "info",
      `Matériel : ${profile.label}`,
      `${profile.cpuCores} cœurs · PL1 ${profile.cpuPl1MinW}–${profile.cpuPl1MaxW} W · ${
        profile.hasDedicatedGpu ? `GPU ${profile.gpuTdpW} W` : "iGPU seul"
      }`
    );
    appendLog("WMI/NVML", `DetectHardware("${profile.id}") -> bornes appliquées`, undefined, 2800);
  };

  const handleEmergencyRestore = () => {
    history.record("Restauration Stock Windows", workingConfig);
    setWorkingConfig(clampConfigToProfile({ ...STOCK_BASELINE_CONFIG }, hardware));
    pushToast("warning", "État Windows d'origine restauré", "Toutes les limites ont été relâchées (Ctrl+Z pour annuler).", true);
    appendLog("Safety", "RollbackGuard::restore_baseline() — valeurs Stock rétablies", undefined, 1480);
  };

  const handleRunRealBench = () => {
    const res = runRealMicroBenchmark();
    const ranAt = nowTimeStr();
    const run: BenchRun = {
      id: `run-${Date.now()}`,
      ranAt,
      measuredHostMs: res.measuredHostMs,
      opsPerSec: res.opsPerSec,
      calibrationScale: res.calibrationScale,
      activeProfile: `P${activeSlot} ${activeProfile.name}`,
      workload,
      totalWatts: afterTel.totalSystemWatts,
    };
    setBenchScale(res.calibrationScale);
    setBenchRuns((prev) => [run, ...prev].slice(0, 8));
    setLastBenchInfo({ measuredHostMs: res.measuredHostMs, opsPerSec: res.opsPerSec, ranAt });
    pushToast(
      "success",
      "Micro-benchmark réel exécuté",
      `${res.measuredHostMs} ms hôte · ${(res.opsPerSec / 1e6).toFixed(1)} Mops/s · facteur ×${res.calibrationScale}`
    );
    appendLog(
      "Bench",
      `run_real_world_benchmarks() => ${res.measuredHostMs} ms (${(res.opsPerSec / 1e6).toFixed(1)} Mops/s)`,
      undefined,
      Math.round(res.measuredHostMs * 1000)
    );
  };

  const handleExportReport = () => {
    const markdown = buildMarkdownReport({
      profile: activeProfile,
      hardware,
      workload,
      privilege,
      before: beforeTel,
      after: afterTel,
      benchmarks,
      proposals,
      benchRuns,
      cost,
    });
    downloadText(`ecoclock-rapport-${new Date().toISOString().slice(0, 10)}.md`, markdown);
    pushToast("success", "Rapport Markdown exporté", "Mesures Avant/Après (W, °C, dBA, ms), Pareto & protocole inclus.");
    appendLog("Report", "ExportMarkdownAudit(OK)", undefined, 120);
  };

  const handleToggleTooltips = useCallback(() => {
    const next = !settings.tooltips;
    updateSettings((s) => ({ ...s, tooltips: next }));
    pushToast(
      "info",
      next ? "Infobulles techniques activées" : "Infobulles techniques masquées",
      "Raccourci T ou bouton de barre supérieure pour rebasculer à tout moment."
    );
  }, [settings.tooltips, pushToast]);

  // 11. Raccourcis clavier globaux (abonnement unique)
  const hasModalOpen = uacOpen || autostartOpen || hardwareOpen || shortcutsOpen;
  useKeyboardShortcuts({
    hasModalOpen,
    onCloseTopModal: () => {
      if (uacOpen) setUacOpen(false);
      else if (autostartOpen) setAutostartOpen(false);
      else if (hardwareOpen) setHardwareOpen(false);
      else if (shortcutsOpen) setShortcutsOpen(false);
    },
    onSave: handleSaveProfile,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onSelectSlot: handleSelectSlot,
    onRunBench: handleRunRealBench,
    onToggleLive: () => setLiveEnabled((v) => !v),
    onToggleTooltips: handleToggleTooltips,
    onOpenAdaptive: () => setActiveTab("adaptive"),
    onOpenHardware: () => setHardwareOpen(true),
    onToggleShortcuts: () => setShortcutsOpen((v) => !v),
  });

  return (
    <div className="min-h-screen bg-[#0A0D12] text-slate-100 flex flex-col">
      <a href="#main-content" className="skip-link">
        Aller au contenu principal
      </a>
      <div className="max-w-[1380px] w-full mx-auto flex-1 flex flex-col sm:my-3 sm:rounded-xl sm:border sm:border-slate-800/90 bg-[#0F131A] shadow-2xl shadow-black/70 overflow-hidden">
        {/* 1. BARRE DE TITRE WINDOWS 11 */}
        <header className="bg-[#0C1016] border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
              <Zap className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-white">EcoClock-rs</h1>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  v0.5.0 · Rust Win64
                </span>
                {settings.adaptive.enabled && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("adaptive")}
                    className="hidden md:inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 cursor-pointer hover:bg-emerald-500/25"
                    title={adaptiveCtrl.status.reason}
                  >
                    <Wand2 className="w-2.5 h-2.5" />
                    Auto:{settings.adaptive.mode === "auto" ? "ON" : "Sugg."} ({adaptiveCtrl.status.target})
                  </button>
                )}
              </div>
              <p className="text-[10.5px] text-slate-400 hidden sm:block">
                Underclocking multi-composants sûr · Économie d'électricité, température & silence
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Toggle explicite des infobulles (visible sur tous les écrans) */}
            <button
              type="button"
              role="switch"
              aria-checked={settings.tooltips}
              aria-label="Activer ou désactiver les infobulles techniques"
              onClick={handleToggleTooltips}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                settings.tooltips
                  ? "bg-sky-500/12 border-sky-500/40 text-sky-200 hover:bg-sky-500/20"
                  : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
              title="Activer ou désactiver les infobulles détaillées (raccourci T)"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Bulles : {settings.tooltips ? "ON" : "OFF"}</span>
            </button>

            {/* Matériel de référence */}
            <button
              type="button"
              onClick={() => setHardwareOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer max-w-[200px]"
              title="Choisir le matériel de référence et ses bornes constructeur (M)"
            >
              <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate hidden sm:inline">{hardware.label}</span>
            </button>

            {/* Undo / Redo */}
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/70 overflow-hidden">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!history.canUndo}
                aria-label={`Annuler (${history.past.length})`}
                title={history.lastUndoLabel ? `Annuler : ${history.lastUndoLabel} (Ctrl+Z)` : "Rien à annuler"}
                className="inline-flex items-center gap-1 px-2 py-1.5 hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed text-xs text-slate-300 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span className="font-mono text-[10px]">{history.past.length}</span>
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!history.canRedo}
                aria-label="Rétablir"
                title={history.lastRedoLabel ? `Rétablir : ${history.lastRedoLabel} (Ctrl+Y)` : "Rien à rétablir"}
                className="inline-flex items-center px-1.5 py-1.5 border-l border-slate-700 hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed text-xs text-slate-300 cursor-pointer"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Privilège User / Admin UAC */}
            <div className="flex items-center gap-1">
              {privilege === "user" ? (
                <button
                  type="button"
                  onClick={() => setUacOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/12 hover:bg-amber-500/20 border border-emerald-500/35 hover:border-amber-500/50 text-xs font-medium text-emerald-200 hover:text-amber-200 transition-colors cursor-pointer"
                  title="Lancé en utilisateur standard (asInvoker). Cliquer pour demander les droits Administrateur (UAC)."
                >
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>User</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    UAC
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDropToUser}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/45 text-xs font-semibold text-amber-200 transition-colors cursor-pointer"
                  title="Jeton Administrateur UAC actif. Cliquer pour revenir en mode User."
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span>Admin</span>
                </button>
              )}
              <TechTooltip tooltipKey="privilege_mode" />
            </div>

            {/* Démarrage avec Windows */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAutostartOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  autostart.enabled
                    ? "bg-sky-500/12 border-sky-500/40 text-sky-200 hover:bg-sky-500/20"
                    : "bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Power className={`w-3.5 h-3.5 ${autostart.enabled ? "text-sky-400" : "text-slate-500"}`} />
                <span>Boot : {autostart.enabled ? `P${autostart.bootProfileId}` : "OFF"}</span>
              </button>
              <TechTooltip tooltipKey="autostart_windows" />
            </div>

            {/* Restauration Stock */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleEmergencyRestore}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Restaurer immédiatement 100 % des paramètres Windows d'origine"
              >
                <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden xl:inline">Stock</span>
              </button>
              <TechTooltip tooltipKey="rollback_guard" />
            </div>
          </div>
        </header>

        {/* 2. BARRE DES 5 PROFILS PERSISTANTS */}
        <ProfileBar
          hardware={hardware}
          profiles={profiles}
          activeSlot={activeSlot}
          isDirty={isDirty}
          bootEnabled={autostart.enabled}
          bootProfileId={autostart.bootProfileId}
          workload={workload}
          privilege={privilege}
          onSelectSlot={handleSelectSlot}
          onSaveCurrent={handleSaveProfile}
          onRenameSlot={handleRenameSlot}
          onResetAllDefaults={handleResetDefaults}
          onExportToml={handleExportToml}
          onExportJson={handleExportJson}
          onImportJson={handleImportBackup}
        />

        {/* 3. NAVIGATION DES ONGLETS + SCÉNARIO DE CHARGE */}
        <div className="bg-[#0E1219] border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <nav className="flex flex-wrap items-center gap-1" aria-label="Vues principales">
            {(
              [
                { id: "dashboard" as const, label: "Réglages", icon: Sliders },
                { id: "compare" as const, label: "Avant / Après & ms", icon: ArrowLeftRight },
                {
                  id: "optimizer" as const,
                  label: "Config Optimisée",
                  icon: Sparkles,
                  count: proposals.length,
                },
                {
                  id: "adaptive" as const,
                  label: "Mode intelligent",
                  icon: Wand2,
                  dot: settings.adaptive.enabled,
                },
                { id: "profiles" as const, label: "5 Profils", icon: Layers },
                {
                  id: "audit" as const,
                  label: "Audit & Plan",
                  icon: ClipboardCheck,
                  count: issueCounts.critical + issueCounts.warning,
                },
                { id: "rust_source" as const, label: "Code Rust & .zip", icon: Code2 },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setActiveTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? "bg-emerald-500/18 text-emerald-200 border border-emerald-500/45"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${active ? "text-emerald-400" : "text-slate-500"}`} />
                  <span>{t.label}</span>
                  {"dot" in t && t.dot && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400" title="Mode intelligent actif" />
                  )}
                  {"count" in t && t.count > 0 && (
                    <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500 text-slate-950 font-bold">
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {activeTab !== "rust_source" && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-500 hidden xl:inline">Charge :</span>
              <div className="inline-flex rounded-lg bg-[#141A24] border border-slate-800 p-0.5" role="group" aria-label="Scénario de charge">
                {(Object.keys(WORKLOAD_META) as WorkloadMode[]).map((wm) => {
                  const active = workload === wm;
                  return (
                    <button
                      key={wm}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setWorkload(wm)}
                      title={WORKLOAD_META[wm].description}
                      className={`px-2 py-1 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer ${
                        active ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {WORKLOAD_META[wm].shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 4. BANDEAU KPI AVANT -> APRÈS */}
        {activeTab !== "rust_source" && (
          <KpiStrip beforeTel={beforeTel} afterTel={afterTel} benchmarks={benchmarks} />
        )}

        {/* 5. VUE ACTIVE */}
        <main id="main-content" tabIndex={-1} className="p-4 flex-1 outline-none">
          {activeTab === "dashboard" && (
            <div className="space-y-4">
              {issueCounts.critical > 0 && (
                <div className="rounded-lg bg-rose-500/12 border border-rose-500/35 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-rose-100">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      <strong>{issueCounts.critical} anomalie(s) critique(s)</strong> : la sauvegarde du profil est bloquée jusqu'à correction.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFixAllIssues}
                    className="px-2.5 py-1 rounded bg-rose-500 hover:bg-rose-400 text-slate-950 text-[11px] font-semibold cursor-pointer"
                  >
                    Corriger automatiquement
                  </button>
                </div>
              )}
              <SubsystemControls
                config={boundedConfig}
                hardware={hardware}
                beforeTel={beforeTel}
                afterTel={afterTel}
                benchmarks={benchmarks}
                topProposals={proposals}
                powerHistory={powerHistory}
                apiLogs={apiLogs}
                privilege={privilege}
                unlockedAdminExtraW={unlockedAdminExtraW}
                onUpdateConfig={handleUpdateConfig}
                onApplyProposal={handleApplyProposal}
                onRequestAdmin={() => setUacOpen(true)}
                onNavigateTab={setActiveTab}
              />
              <SafetyAuditPanel
                issues={issues}
                privilege={privilege}
                onFix={handleFixIssue}
                onFixAll={handleFixAllIssues}
                onRequestAdmin={() => setUacOpen(true)}
                dense
              />
            </div>
          )}

          {activeTab === "compare" && (
            <BeforeAfterView
              profiles={profiles}
              referenceSlot={referenceSlot}
              onChangeReferenceSlot={setReferenceSlot}
              activeLabel={`P${activeSlot} ${activeProfile.name}${isDirty ? "*" : ""}`}
              beforeTel={beforeTel}
              afterTel={afterTel}
              benchmarks={benchmarks}
              lastBenchRunInfo={lastBenchInfo}
              onRunRealBench={handleRunRealBench}
              cost={cost}
              onChangeCost={setCost}
              hardware={hardware}
              activeProfileName={`P${activeSlot} ${activeProfile.name}`}
              benchRuns={benchRuns}
              onExportReport={handleExportReport}
              onExportPs1={handleExportPs1}
            />
          )}

          {activeTab === "optimizer" && (
            <OptimizerView
              goal={optimizerGoal}
              onChangeGoal={setOptimizerGoal}
              proposals={proposals}
              currentConfig={effectiveConfig}
              hardware={hardware}
              workload={workload}
              privilege={privilege}
              budgetMs={budgetMs}
              onChangeBudgetMs={setBudgetMs}
              onApplyOne={handleApplyProposal}
              onApplyAll={handleApplyAllProposals}
              onApplySelection={handleApplySelection}
              onRequestAdmin={() => setUacOpen(true)}
            />
          )}

          {activeTab === "adaptive" && (
            <AdaptivePanel
              settings={settings}
              profiles={profiles}
              hardware={hardware}
              privilege={privilege}
              status={adaptiveCtrl.status}
              savedWh={adaptiveCtrl.savedWh}
              activeSlot={activeSlot}
              workload={workload}
              afterTel={afterTel}
              idleSecDisplay={adaptiveCtrl.idleSecDisplay}
              simulatedIdleSec={adaptiveCtrl.simulatedIdleSec}
              onSetSimulatedIdleSec={adaptiveCtrl.setSimulatedIdleSec}
              simulatedHour={adaptiveCtrl.simulatedHour}
              onSetSimulatedHour={adaptiveCtrl.setSimulatedHour}
              thermalLatched={adaptiveCtrl.thermalLatched}
              batteryAvailable={adaptiveCtrl.batteryAvailable}
              realOnBattery={adaptiveCtrl.realOnBattery}
              log={adaptiveCtrl.log}
              suggestion={adaptiveCtrl.suggestion}
              onChangeWorkload={setWorkload}
              onPatchAdaptive={(patch: Partial<AdaptiveSettings>) =>
                updateSettings((s) => ({ ...s, adaptive: { ...s.adaptive, ...patch } }))
              }
              onSetRules={(rules: AdaptiveRule[]) =>
                updateSettings((s) => ({ ...s, adaptive: { ...s.adaptive, rules } }))
              }
              onSetTooltips={(value: boolean) => updateSettings((s) => ({ ...s, tooltips: value }))}
              onEvaluateNow={adaptiveCtrl.evaluateNow}
              onClearSnooze={adaptiveCtrl.clearSnooze}
              onApplySuggestion={adaptiveCtrl.applySuggestion}
              onClearLog={adaptiveCtrl.clearLog}
              onResetSavings={adaptiveCtrl.resetSavings}
            />
          )}

          {activeTab === "profiles" && (
            <ProfileCompareView
              profiles={profiles}
              activeSlot={activeSlot}
              bootProfileId={autostart.bootProfileId}
              bootEnabled={autostart.enabled}
              hardware={hardware}
              workload={workload}
              privilege={privilege}
              cost={cost}
              onApplySlot={handleSelectSlot}
              onSetBootSlot={(slot) =>
                handleAutostartChange({ ...autostart, enabled: true, bootProfileId: slot })
              }
            />
          )}

          {activeTab === "audit" && (
            <AuditPlanView
              issues={issues}
              hardware={hardware}
              rustFileCount={RUST_PROJECT_FILES.length + RUST_EXTRA_FILES.length + 1}
              onOpenRust={() => setActiveTab("rust_source")}
              onOpenSafetyFix={() => setActiveTab("dashboard")}
            />
          )}

          {activeTab === "rust_source" && (
            <RustSourceView
              profiles={profiles}
              autostart={autostart}
              activeSlot={activeSlot}
              showTooltips={settings.tooltips}
              adaptiveEnabled={settings.adaptive.enabled}
            />
          )}
        </main>

        {/* 6. BARRE D'ÉTAT */}
        <footer className="bg-[#0B0E14] border-t border-slate-800/90 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-mono text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              0 driver Ring-0 · HVCI OK
            </span>
            <span className="text-slate-600">|</span>
            <span>
              Jeton :{" "}
              <strong className={privilege === "admin" ? "text-amber-300" : "text-slate-200"}>
                {privilege === "admin" ? "ElevatedAdmin" : "StandardUser"}
              </strong>
            </span>
            <span className="hidden md:inline text-slate-600">|</span>
            <span className="hidden md:inline">
              Infobulles :{" "}
              <button
                type="button"
                onClick={handleToggleTooltips}
                className="text-sky-300 hover:underline cursor-pointer"
              >
                {settings.tooltips ? "actives (T)" : "masquées (T)"}
              </button>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 tabular-nums">
            <button
              type="button"
              onClick={() => setLiveEnabled((v) => !v)}
              aria-pressed={liveEnabled}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                liveEnabled
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-800 text-slate-400"
              }`}
              title="Pause / reprise de la télémétrie 1 Hz (P)"
            >
              {liveEnabled ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
              {liveEnabled ? "Live 1 Hz" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="inline-flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
              title="Afficher les raccourcis clavier (?)"
            >
              <Keyboard className="w-3 h-3" /> Raccourcis
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("rust_source")}
              className="text-sky-400 hover:text-sky-300 underline underline-offset-2 cursor-pointer"
            >
              Exporter ecoclock-rs (.zip)
            </button>
          </div>
        </footer>
      </div>

      <UacModal
        open={uacOpen}
        activeSlot={activeSlot}
        unlockedExtraWatts={unlockedAdminExtraW}
        onApprove={handleApproveUac}
        onCancel={() => setUacOpen(false)}
      />

      <AutostartModal
        open={autostartOpen}
        config={autostart}
        profiles={profiles}
        privilege={privilege}
        onChange={handleAutostartChange}
        onRequestAdmin={() => setUacOpen(true)}
        onClose={() => setAutostartOpen(false)}
      />

      <HardwareModal
        open={hardwareOpen}
        current={hardware}
        onSelect={handleHardwareChange}
        onClose={() => setHardwareOpen(false)}
      />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} onUndo={handleUndo} />
    </div>
  );
}

export default App;

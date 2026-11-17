import { useCallback, useEffect, useRef, useState } from "react";
import { AdaptiveSettings, AdaptiveStatus } from "../types/adaptive";
import {
  HardwareConfig,
  HardwareProfile,
  PrivilegeLevel,
  Profile,
  ProfileSlotId,
  TelemetrySnapshot,
  WorkloadMode,
} from "../types/hardware";
import { STOCK_BASELINE_CONFIG } from "../data/profiles";
import { clampConfigToProfile } from "../engine/validation";
import {
  computeBenchmarks,
  computeTelemetry,
  CostAssumptions,
  resolveEffectiveConfig,
} from "../engine/physics";
import {
  AdaptiveRuntimeState,
  createInitialRuntimeState,
  evaluateRules,
  gateDecision,
  stepAdaptiveEngine,
  updateThermalLatch,
} from "../engine/adaptive";
import { ToastData } from "../components/Feedback";

export interface AdaptiveLogEntry {
  id: string;
  at: string;
  text: string;
}

interface UseAdaptiveControllerArgs {
  adaptive: AdaptiveSettings;
  profiles: Profile[];
  activeSlot: ProfileSlotId;
  isDirty: boolean;
  effectiveConfig: HardwareConfig;
  afterTel: TelemetrySnapshot;
  hardware: HardwareProfile;
  workload: WorkloadMode;
  privilege: PrivilegeLevel;
  cost: CostAssumptions;
  onAutoApplySlot: (slot: ProfileSlotId, reason: string) => void;
  pushToast: (
    tone: ToastData["tone"],
    message: string,
    detail?: string,
    undoable?: boolean,
    action?: ToastData["action"]
  ) => void;
}

function nowTimeStr(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour12: false });
}

/**
 * Contrôleur complet du mode intelligent :
 * - Capteurs réels (inactivité utilisateur, API Battery avec cleanup propre, heure locale) + overrides de test interactif ;
 * - Intégration exacte en Wh de l'énergie économisée vs Stock via Δt réel ;
 * - Évaluation IMMÉDIATE lors d'un changement d'activation, de charge, de batterie ou de règles (plus d'attente aveugle de 5 s) ;
 * - Pause automatique (snooze) quand l'utilisateur sélectionne manuellement un profil, révocable en 1 clic.
 */
export function useAdaptiveController(args: UseAdaptiveControllerArgs) {
  const [status, setStatus] = useState<AdaptiveStatus>({
    state: "off",
    target: "—",
    matchedRuleId: null,
    reason: "Mode intelligent désactivé — vos réglages restent 100 % manuels.",
    gate: "",
  });
  const [log, setLog] = useState<AdaptiveLogEntry[]>([]);
  const [suggestion, setSuggestion] = useState<ProfileSlotId | null>(null);
  const [savedWh, setSavedWh] = useState(0);
  const [idleSecDisplay, setIdleSecDisplay] = useState(0);
  /** Simulation optionnelle d'inactivité (null = suivi réel des entrées souris/clavier). */
  const [simulatedIdleSec, setSimulatedIdleSec] = useState<number | null>(null);
  /** Simulation optionnelle de l'heure locale (null = horloge système réelle). */
  const [simulatedHour, setSimulatedHour] = useState<number | null>(null);
  const [batteryAvailable, setBatteryAvailable] = useState(false);
  const [realOnBattery, setRealOnBattery] = useState(false);
  const [thermalLatched, setThermalLatched] = useState(false);

  const runtimeRef = useRef<AdaptiveRuntimeState>(createInitialRuntimeState());
  const lastActivityMsRef = useRef<number>(Date.now());
  const lastEnergyMsRef = useRef<number>(Date.now());
  const evaluateRef = useRef<(immediate?: boolean) => void>(() => undefined);
  const latestRef = useRef({ ...args, simulatedIdleSec, simulatedHour, realOnBattery });
  latestRef.current = { ...args, simulatedIdleSec, simulatedHour, realOnBattery };

  // 1. Suivi local de l'inactivité + réveil instantané (< 5 ms) dès le retour clavier/souris
  useEffect(() => {
    let lastMove = 0;
    const recordActivity = (now: number) => {
      const wasIdleSec = (now - lastActivityMsRef.current) / 1000;
      lastActivityMsRef.current = now;
      const cur = latestRef.current;
      // Si l'utilisateur revient après une vraie période d'inactivité, réévalue sans attendre le tick de 3 s !
      if (wasIdleSec >= 10 && cur.adaptive.enabled && cur.simulatedIdleSec === null) {
        evaluateRef.current(false);
      }
    };
    const mark = () => recordActivity(Date.now());
    const markMove = () => {
      const now = Date.now();
      if (now - lastMove > 1000) {
        lastMove = now;
        recordActivity(now);
      }
    };
    window.addEventListener("pointerdown", mark, { passive: true });
    window.addEventListener("pointermove", markMove, { passive: true });
    window.addEventListener("keydown", mark, { passive: true });
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchstart", mark, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("pointermove", markMove);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchstart", mark);
    };
  }, []);

  // 2. API Battery (Chromium) avec désabonnement strict au démontage (zéro fuite d'écouteur)
  useEffect(() => {
    type BatteryManagerLike = {
      charging: boolean;
      addEventListener: (type: string, listener: () => void) => void;
      removeEventListener: (type: string, listener: () => void) => void;
    };
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery) return;

    let cancelled = false;
    let attachedBattery: BatteryManagerLike | null = null;
    let listener: (() => void) | null = null;

    nav
      .getBattery()
      .then((battery) => {
        if (cancelled) return;
        attachedBattery = battery;
        listener = () => setRealOnBattery(!battery.charging);
        setBatteryAvailable(true);
        listener();
        battery.addEventListener("chargingchange", listener);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (attachedBattery && listener) {
        attachedBattery.removeEventListener("chargingchange", listener);
      }
    };
  }, []);

  // 3. Fonction d'évaluation centrale (appelable sur tick périodique, changement de signal ou test immédiat)
  const evaluate = useCallback((immediate = false) => {
    const cur = latestRef.current;
    const ad = cur.adaptive;
    const now = Date.now();

    const idleSec =
      cur.simulatedIdleSec !== null
        ? cur.simulatedIdleSec
        : Math.max(0, Math.floor((now - lastActivityMsRef.current) / 1000));
    setIdleSecDisplay(idleSec);

    const onBattery = ad.batterySimulated ? ad.onBatterySim : cur.realOnBattery;
    const hour = cur.simulatedHour !== null ? cur.simulatedHour : new Date(now).getHours();

    // Télémétrie déterministe (jitter = 0) pour éviter tout faux déclenchement dû au bruit d'affichage 1 Hz
    const stockCfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, cur.hardware);
    const currentDet = computeTelemetry(cur.effectiveConfig, cur.workload, cur.cost, 0, cur.hardware);

    // Mise à jour du verrou thermique avec hystérésis de 5 °C
    const thermalRule = ad.rules.find((r) => r.enabled && r.condition.kind === "thermal");
    const thermalThreshold =
      thermalRule && thermalRule.condition.kind === "thermal" ? thermalRule.condition.tempC : 85;
    const nextThermal = thermalRule
      ? updateThermalLatch(runtimeRef.current.thermalLatched, currentDet.cpuTempC, thermalThreshold)
      : false;
    runtimeRef.current = { ...runtimeRef.current, thermalLatched: nextThermal };
    setThermalLatched(nextThermal);

    const match = evaluateRules(ad.rules, {
      idleSec,
      onBattery,
      workload: cur.workload,
      hour,
      thermalLatched: nextThermal,
      currentWatts: currentDet.totalSystemWatts,
    });

    let gate = null;
    if (ad.enabled && match.target && match.target !== cur.activeSlot) {
      const targetProfile = cur.profiles.find((p) => p.id === match.target);
      if (targetProfile) {
        const targetCfg = resolveEffectiveConfig(
          clampConfigToProfile(targetProfile.config, cur.hardware),
          cur.privilege,
          stockCfg
        );
        const targetW = computeTelemetry(targetCfg, cur.workload, cur.cost, 0, cur.hardware).totalSystemWatts;
        const benches = computeBenchmarks(cur.effectiveConfig, targetCfg, 1, cur.hardware);
        const latencyMs = Math.max(
          0,
          ...benches.filter((b) => b.id === "json" || b.id === "gpu_frame").map((b) => b.deltaMs)
        );
        gate = gateDecision({
          currentWatts: currentDet.totalSystemWatts,
          targetWatts: targetW,
          latencyMs,
          budgetMs: ad.budgetMs,
          minSavingW: ad.minSavingW,
          workload: cur.workload,
          protect: !!match.rule?.protect,
          thermalEmergency: match.rule?.condition.kind === "thermal",
          idleTriggered: match.rule?.condition.kind === "idle",
        });
      }
    }

    const out = stepAdaptiveEngine(runtimeRef.current, {
      nowMs: now,
      enabled: ad.enabled,
      mode: ad.mode,
      dwellSec: ad.dwellSec,
      immediate,
      activeSlot: cur.activeSlot,
      isDirty: cur.isDirty,
      match,
      gate,
    });

    runtimeRef.current = out.nextRuntime;
    setStatus(out.status);

    if (out.status.state !== "suggested") {
      setSuggestion(null);
    }

    if (out.effect.kind === "apply") {
      const { target, logText } = out.effect;
      cur.onAutoApplySlot(target, logText);
      setLog((prev) => [{ id: `${now}-${target}`, at: nowTimeStr(), text: logText }, ...prev].slice(0, 40));
    } else if (out.effect.kind === "suggest") {
      const { target, logText, isNew } = out.effect;
      setSuggestion(target);
      if (isNew || immediate) {
        setLog((prev) => [{ id: `${now}-sug-${target}`, at: nowTimeStr(), text: logText }, ...prev].slice(0, 40));
        cur.pushToast("info", `Mode intelligent : passer en P${target} ?`, `${match.reason} ${gate?.reason ?? ""}`, false, {
          label: `Appliquer P${target}`,
          run: () => {
            runtimeRef.current = {
              ...runtimeRef.current,
              pending: null,
              lastSwitchMs: Date.now(),
              lastSuggestedSlot: null,
            };
            setSuggestion(null);
            cur.onAutoApplySlot(target, `Suggestion acceptée → P${target}`);
          },
        });
      }
    }
  }, []);

  evaluateRef.current = evaluate;

  // 4. Réaction immédiate dès que l'utilisateur change un réglage, un curseur, un scénario ou une simulation
  useEffect(() => {
    evaluate(false);
  }, [
    evaluate,
    args.adaptive,
    args.effectiveConfig,
    args.workload,
    args.activeSlot,
    args.isDirty,
    args.privilege,
    args.hardware.id,
    realOnBattery,
    simulatedIdleSec,
    simulatedHour,
  ]);

  // 5. Boucle périodique (3 s) : intégration énergétique Δt exacte (sans jitter) + confirmation temporelle
  useEffect(() => {
    lastEnergyMsRef.current = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dtSec = Math.min(10, Math.max(0, (now - lastEnergyMsRef.current) / 1000));
      lastEnergyMsRef.current = now;
      if (document.hidden) return;

      const cur = latestRef.current;
      const stockCfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, cur.hardware);
      const stockW = computeTelemetry(stockCfg, cur.workload, cur.cost, 0, cur.hardware).totalSystemWatts;
      const currentW = computeTelemetry(cur.effectiveConfig, cur.workload, cur.cost, 0, cur.hardware).totalSystemWatts;
      if (currentW < stockW && dtSec > 0) {
        setSavedWh((prev) => prev + ((stockW - currentW) * dtSec) / 3600);
      }

      evaluate(false);
    }, 3000);
    return () => window.clearInterval(id);
  }, [evaluate]);

  /** Appelé quand l'utilisateur clique manuellement sur un profil P1..P5 : respecte son choix pendant manualSnoozeMin. */
  const notifyManualSlotChoice = useCallback((slot: ProfileSlotId) => {
    const ad = latestRef.current.adaptive;
    if (!ad.enabled || ad.manualSnoozeMin <= 0) return;
    const until = Date.now() + ad.manualSnoozeMin * 60 * 1000;
    runtimeRef.current = {
      ...runtimeRef.current,
      pending: null,
      snoozeUntilMs: until,
      lastSuggestedSlot: null,
    };
    setSuggestion(null);
    setLog((prev) =>
      [
        {
          id: `manual-${Date.now()}`,
          at: nowTimeStr(),
          text: `Choix manuel P${slot} · Mode auto mis en pause ${ad.manualSnoozeMin} min (priorité utilisateur).`,
        },
        ...prev,
      ].slice(0, 40)
    );
  }, []);

  const clearSnooze = useCallback(() => {
    runtimeRef.current = { ...runtimeRef.current, snoozeUntilMs: 0, pending: null };
    evaluate(false);
  }, [evaluate]);

  const applySuggestion = useCallback(() => {
    if (suggestion === null) return;
    const target = suggestion;
    runtimeRef.current = {
      ...runtimeRef.current,
      pending: null,
      lastSwitchMs: Date.now(),
      snoozeUntilMs: 0,
      lastSuggestedSlot: null,
    };
    setSuggestion(null);
    latestRef.current.onAutoApplySlot(target, `Suggestion confirmée → P${target}`);
    setLog((prev) =>
      [{ id: `acc-${Date.now()}`, at: nowTimeStr(), text: `Confirmé → P${target} appliqué.` }, ...prev].slice(0, 40)
    );
  }, [suggestion]);

  return {
    status,
    log,
    suggestion,
    savedWh,
    idleSecDisplay,
    simulatedIdleSec,
    setSimulatedIdleSec,
    simulatedHour,
    setSimulatedHour,
    batteryAvailable,
    realOnBattery,
    thermalLatched,
    evaluateNow: () => evaluate(true),
    notifyManualSlotChoice,
    clearSnooze,
    applySuggestion,
    clearLog: () => setLog([]),
    resetSavings: () => setSavedWh(0),
  };
}

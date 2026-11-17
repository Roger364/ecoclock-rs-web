import { describe, expect, it } from "vitest";
import {
  computeBenchmarks,
  computeCpuAllowedMaxMhz,
  computePsuWallPcWatts,
  computeTelemetry,
  cpuVoltageAtFreq,
  resolveEffectiveConfig,
  runRealMicroBenchmark,
} from "./physics";
import { auditConfig, auditScore, clampConfigToProfile } from "./validation";
import {
  createInitialRuntimeState,
  describeCondition,
  evaluateRules,
  findShadowedRules,
  gateDecision,
  inHourRange,
  insertRuleSmart,
  moveRule,
  simulatePolicyMatrix,
  stepAdaptiveEngine,
  updateThermalLatch,
} from "./adaptive";
import { buildBudgetPlan, generateOptimizationProposals } from "./optimizer";
import {
  DEFAULT_AUTOSTART,
  DEFAULT_PROFILES,
  escapeTomlString,
  getTomlPersistenceWarnings,
  parseProfilesToml,
  serializeProfilesToToml,
  STOCK_BASELINE_CONFIG,
} from "../data/profiles";
import { buildWindowsPowerShellScript } from "../utils/windowsScript";
import { HARDWARE_PROFILES } from "../data/hardwareProfiles";
import {
  ADAPTIVE_PRESETS,
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  sanitizeCondition,
  sanitizeSettings,
} from "../store/settings";
import { sanitizeAutostart, sanitizeProfiles, sanitizeSlot } from "../store/profileStorage";
import { AdaptiveRule } from "../types/adaptive";

describe("bornes matérielles & modèle physique", () => {
  it("clampConfigToProfile est idempotent pour chaque matériel et chaque profil", () => {
    for (const hw of HARDWARE_PROFILES) {
      for (const p of DEFAULT_PROFILES) {
        const once = clampConfigToProfile(p.config, hw);
        expect(clampConfigToProfile(once, hw)).toEqual(once);
      }
    }
  });

  it("aucun plafond CPU ne dépasse la spécification constructeur", () => {
    for (const hw of HARDWARE_PROFILES) {
      const max = computeCpuAllowedMaxMhz({ ...STOCK_BASELINE_CONFIG, cpuFreqCapMhz: 99_999 }, hw);
      expect(max).toBeLessThanOrEqual(hw.cpuFreqMaxMhz);
    }
  });

  it("le modèle respecte l'enveloppe PL1 en charge lourde et ne produit jamais de NaN", () => {
    for (const hw of HARDWARE_PROFILES) {
      for (const p of DEFAULT_PROFILES) {
        const cfg = clampConfigToProfile(p.config, hw);
        const tel = computeTelemetry(cfg, "heavy", undefined, 0, hw);
        expect(Number.isFinite(tel.totalSystemWatts)).toBe(true);
        expect(Number.isFinite(tel.systemNoiseDba)).toBe(true);
        expect(tel.cpuPackageWatts).toBeLessThanOrEqual(cfg.cpuPl1Watts + 0.2);
      }
    }
  });

  it("sur un Mini-PC iGPU seul, le rail GPU dédié vaut exactement 0 W, 0 RPM et l'écran est borné à 60 Hz", () => {
    const miniPc = HARDWARE_PROFILES.find((h) => !h.hasDedicatedGpu)!;
    const cfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, miniPc);
    expect(cfg.displayRefreshHz).toBe(60);
    const tel = computeTelemetry(cfg, "heavy", undefined, 0, miniPc);
    expect(tel.gpuBoardWatts).toBe(0);
    expect(tel.gpuFanRpm).toBe(0);
    expect(tel.igpuWatts).toBeGreaterThan(5);
  });

  it("la courbe d'alimentation 80+ Gold est strictement croissante (aucun paradoxe à 45 W ni 95 W)", () => {
    let prev = computePsuWallPcWatts(0);
    for (let dc = 0.5; dc <= 400; dc += 0.5) {
      const wall = computePsuWallPcWatts(dc);
      expect(wall).toBeGreaterThan(prev);
      // Économiser 0.5 W DC économise toujours plus de 0.5 W AC
      expect(wall - prev).toBeGreaterThan(0.5);
      prev = wall;
    }
  });

  it("baisser le plafond MHz réduit la puissance CPU et la température", () => {
    const hw = HARDWARE_PROFILES[0];
    const high = computeTelemetry({ ...STOCK_BASELINE_CONFIG, cpuFreqCapMhz: 5200 }, "office", undefined, 0, hw);
    const low = computeTelemetry({ ...STOCK_BASELINE_CONFIG, cpuFreqCapMhz: 3300 }, "office", undefined, 0, hw);
    expect(low.cpuPackageWatts).toBeLessThan(high.cpuPackageWatts);
    expect(low.cpuTempC).toBeLessThan(high.cpuTempC);
  });

  it("la tension VID croît de manière monotone avec la fréquence", () => {
    let prev = -Infinity;
    for (let f = 800; f <= 5200; f += 100) {
      const v = cpuVoltageAtFreq(f);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("le jeton User n'applique jamais les leviers Admin", () => {
    const desired = {
      ...STOCK_BASELINE_CONFIG,
      cpuPl1Watts: 30,
      gpuPowerLimitPct: 50,
      nvmeApst: "ps4_deep" as const,
      pcieAspm: "l1_substates" as const,
    };
    const eff = resolveEffectiveConfig(desired, "user");
    expect(eff.cpuPl1Watts).toBe(STOCK_BASELINE_CONFIG.cpuPl1Watts);
    expect(eff.gpuPowerLimitPct).toBe(STOCK_BASELINE_CONFIG.gpuPowerLimitPct);
    expect(eff.nvmeApst).toBe(STOCK_BASELINE_CONFIG.nvmeApst);
    expect(eff.pcieAspm).toBe("l1"); // dégradé proprement en L1 User
  });

  it("computeBenchmarks et runRealMicroBenchmark retournent des valeurs finies positives", () => {
    const r = runRealMicroBenchmark();
    expect(r.measuredHostMs).toBeGreaterThan(0);
    expect(r.calibrationScale).toBeGreaterThanOrEqual(0.88);
    expect(r.calibrationScale).toBeLessThanOrEqual(1.16);
    const benches = computeBenchmarks(STOCK_BASELINE_CONFIG, DEFAULT_PROFILES[0].config, r.calibrationScale);
    expect(benches).toHaveLength(6);
    for (const b of benches) {
      expect(b.beforeMs).toBeGreaterThan(0);
      expect(b.afterMs).toBeGreaterThan(0);
    }
  });
});

describe("audit de sûreté (sur données brutes)", () => {
  const hw = HARDWARE_PROFILES[0];

  it("signale min > max et fréquence hors spec comme critiques avec correctif", () => {
    const cfg = { ...STOCK_BASELINE_CONFIG, cpuMinPercent: 90, cpuMaxPercent: 50, cpuFreqCapMhz: 6500 };
    const issues = auditConfig(cfg, hw, "admin", "office");
    expect(issues.find((i) => i.id === "cpu-min-gt-max")?.severity).toBe("critical");
    expect(issues.find((i) => i.id === "cpu-freq-over-spec")?.severity).toBe("critical");
  });

  it("appliquer le correctif supprime le constat", () => {
    const cfg = { ...STOCK_BASELINE_CONFIG, cpuMinPercent: 90, cpuMaxPercent: 50 };
    const issue = auditConfig(cfg, hw, "admin", "office").find((i) => i.id === "cpu-min-gt-max")!;
    const fixed = clampConfigToProfile({ ...cfg, ...issue.fix }, hw);
    expect(auditConfig(fixed, hw, "admin", "office").some((i) => i.id === "cpu-min-gt-max")).toBe(false);
  });

  it("le score vaut 100 sans constat et baisse avec la gravité", () => {
    expect(auditScore([])).toBe(100);
    expect(
      auditScore([{ id: "x", severity: "critical", subsystem: "", title: "", detail: "", consequence: "" }])
    ).toBe(80);
  });
});

describe("mode intelligent : règles, priorité & détection de masquage", () => {
  const base = { idleSec: 0, onBattery: false, workload: "office" as const, currentWatts: 75 };

  it("une charge lourde normale est protégée (P5)", () => {
    const m = evaluateRules(DEFAULT_RULES, { ...base, workload: "heavy" });
    expect(m.rule?.id).toBe("protect-heavy");
    expect(m.target).toBe(5);
  });

  it("une inactivité prolongée bascule en silence (P2)", () => {
    expect(evaluateRules(DEFAULT_RULES, { ...base, idleSec: 200 }).target).toBe(2);
  });

  it("la condition power_above se déclenche au-dessus du seuil en Watts", () => {
    const capRule: AdaptiveRule = {
      id: "cap",
      enabled: true,
      label: "Plafond 110 W",
      condition: { kind: "power_above", watts: 110 },
      target: 1,
      protect: false,
    };
    expect(evaluateRules([capRule], { ...base, currentWatts: 95 }).target).toBeNull();
    expect(evaluateRules([capRule], { ...base, currentWatts: 125 }).target).toBe(1);
    expect(describeCondition(capRule)).toContain("110 W");
  });

  it("une plage horaire nocturne traverse minuit et une plage vide ne matche jamais", () => {
    expect(inHourRange(23, 22, 7)).toBe(true);
    expect(inHourRange(3, 22, 7)).toBe(true);
    expect(inHourRange(12, 22, 7)).toBe(false);
    expect(inHourRange(10, 9, 17)).toBe(true);
    expect(inHourRange(10, 10, 10)).toBe(false);
  });

  it("l'alerte thermique respecte une hystérésis de 5 °C", () => {
    let latched = updateThermalLatch(false, 84, 85);
    expect(latched).toBe(false);
    latched = updateThermalLatch(latched, 85, 85);
    expect(latched).toBe(true);
    latched = updateThermalLatch(latched, 81, 85);
    expect(latched).toBe(true);
    latched = updateThermalLatch(latched, 79.9, 85);
    expect(latched).toBe(false);
  });

  it("la règle thermique prend le relais quand le verrou est actif", () => {
    const m = evaluateRules(DEFAULT_RULES, { ...base, thermalLatched: true });
    expect(m.rule?.id).toBe("thermal");
    expect(m.target).toBe(2);
  });

  it("insertRuleSmart insère AVANT la règle always et évite tout code mort", () => {
    const custom: AdaptiveRule = {
      id: "custom-idle",
      enabled: true,
      label: "Pause 10 min",
      condition: { kind: "idle", seconds: 600 },
      target: 4,
      protect: false,
    };
    const next = insertRuleSmart(DEFAULT_RULES, custom);
    const customIdx = next.findIndex((r) => r.id === "custom-idle");
    const alwaysIdx = next.findIndex((r) => r.condition.kind === "always");
    expect(customIdx).toBeLessThan(alwaysIdx);
  });

  it("findShadowedRules détecte une règle après always et un idle plus long mal ordonné", () => {
    const rules: AdaptiveRule[] = [
      { id: "i1", enabled: true, label: "Idle 2m", condition: { kind: "idle", seconds: 120 }, target: 2, protect: false },
      { id: "i2", enabled: true, label: "Idle 5m", condition: { kind: "idle", seconds: 300 }, target: 4, protect: false },
      { id: "all", enabled: true, label: "Défaut", condition: { kind: "always" }, target: 1, protect: false },
      { id: "dead", enabled: true, label: "Jamais", condition: { kind: "battery" }, target: 2, protect: false },
    ];
    const shadowed = findShadowedRules(rules);
    expect(shadowed.has("i2")).toBe(true);
    expect(shadowed.has("dead")).toBe(true);
    expect(shadowed.has("i1")).toBe(false);

    // Remonter i2 au-dessus de i1 lève le masquage !
    const reordered = moveRule(rules, "i2", -1);
    expect(findShadowedRules(reordered).has("i2")).toBe(false);
  });

  it("aucun préréglage intégré ne contient de règle active masquée", () => {
    for (const preset of ADAPTIVE_PRESETS) {
      if (preset.patch.rules) {
        expect(findShadowedRules(preset.patch.rules).size).toBe(0);
      }
    }
  });
});

describe("porte de décision & automate stepAdaptiveEngine", () => {
  const baseGate = {
    currentWatts: 110,
    targetWatts: 60,
    latencyMs: 0.8,
    budgetMs: 3,
    minSavingW: 3,
    workload: "office" as const,
    protect: false,
  };

  it("refuse une économie sur charge lourde, sous seuil ou hors budget", () => {
    expect(gateDecision({ ...baseGate, workload: "heavy" }).allowed).toBe(false);
    expect(gateDecision({ ...baseGate, targetWatts: 109 }).allowed).toBe(false);
    expect(gateDecision({ ...baseGate, latencyMs: 5 }).allowed).toBe(false);
    expect(gateDecision(baseGate).allowed).toBe(true);
  });

  it("une urgence thermique outrepasse le budget de latence et la charge lourde", () => {
    const res = gateDecision({
      ...baseGate,
      latencyMs: 9.5,
      budgetMs: 0.5,
      workload: "heavy",
      thermalEmergency: true,
    });
    expect(res.allowed).toBe(true);
    expect(res.urgent).toBe(true);
  });

  it("en inactivité confirmée, le budget de latence est assoupli (≥ 8 ms)", () => {
    expect(gateDecision({ ...baseGate, latencyMs: 6.5, budgetMs: 2, idleTriggered: false }).allowed).toBe(false);
    expect(gateDecision({ ...baseGate, latencyMs: 6.5, budgetMs: 2, idleTriggered: true }).allowed).toBe(true);
  });

  it("un retour vers plus de performance est toujours autorisé et urgent", () => {
    const res = gateDecision({ ...baseGate, currentWatts: 55, targetWatts: 120, latencyMs: 0, protect: true });
    expect(res.allowed).toBe(true);
    expect(res.urgent).toBe(true);
  });

  it("stepAdaptiveEngine exige une vraie fenêtre temporelle (insensible aux re-renders rapides), respecte dwellSec, isDirty et snooze", () => {
    const idleRule = DEFAULT_RULES.find((r) => r.id === "idle")!;
    const match = { rule: idleRule, target: 2 as const, reason: "Inactif" };
    const gate = gateDecision({ ...baseGate, idleTriggered: true });

    // t = 1000 ms : détection initiale
    let rt = createInitialRuntimeState();
    const s1 = stepAdaptiveEngine(rt, {
      nowMs: 1_000,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 1,
      isDirty: false,
      match,
      gate,
    });
    expect(s1.status.state).toBe("waiting");
    expect(s1.effect.kind).toBe("none");
    rt = s1.nextRuntime;

    // t = 1050 ms (re-render rapide 50 ms plus tard) : NE DOIT PAS basculer prématurément !
    const rapid = stepAdaptiveEngine(rt, {
      nowMs: 1_050,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 1,
      isDirty: false,
      match,
      gate,
    });
    expect(rapid.status.state).toBe("waiting");
    expect(rapid.effect.kind).toBe("none");
    rt = rapid.nextRuntime;

    // Si isDirty = true, bloque proprement sans écraser
    const dirtyStep = stepAdaptiveEngine(rt, {
      nowMs: 4_000,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 1,
      isDirty: true,
      match,
      gate,
    });
    expect(dirtyStep.status.state).toBe("blocked");
    expect(dirtyStep.effect.kind).toBe("none");

    // t = 4000 ms (≥ 2500 ms de stabilité réelle) et propre : applique P2 !
    const s2 = stepAdaptiveEngine(rt, {
      nowMs: 4_000,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 1,
      isDirty: false,
      match,
      gate,
    });
    expect(s2.status.state).toBe("applied");
    expect(s2.effect).toMatchObject({ kind: "apply", target: 2 });
    rt = s2.nextRuntime;

    // Une autre bascule éco 10 s plus tard est retenue par dwellSec (60 s)
    const matchEco4 = { rule: { ...idleRule, target: 4 as const }, target: 4 as const, reason: "Veille" };
    const w1 = stepAdaptiveEngine(rt, {
      nowMs: 10_000,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 2,
      isDirty: false,
      match: matchEco4,
      gate,
    });
    const w2 = stepAdaptiveEngine(w1.nextRuntime, {
      nowMs: 14_000,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 2,
      isDirty: false,
      match: matchEco4,
      gate,
    });
    expect(w2.status.state).toBe("waiting");
    expect(w2.effect.kind).toBe("none");

    // Pause manuelle (snooze) respectée en usage normal, mais outrepassée par une urgence thermique !
    const snoozedRt = { ...rt, snoozeUntilMs: 500_000 };
    const snz = stepAdaptiveEngine(snoozedRt, {
      nowMs: 100_000,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 5,
      isDirty: false,
      match,
      gate,
    });
    expect(snz.status.state).toBe("snoozed");

    const thermalRule = DEFAULT_RULES.find((r) => r.id === "thermal")!;
    const hotGate = gateDecision({ ...baseGate, thermalEmergency: true });
    const hot = stepAdaptiveEngine(snoozedRt, {
      nowMs: 100_000,
      enabled: true,
      mode: "auto",
      dwellSec: 60,
      activeSlot: 5,
      isDirty: false,
      match: { rule: thermalRule, target: 2, reason: "Surchauffe" },
      gate: hotGate,
    });
    expect(hot.effect).toMatchObject({ kind: "apply", target: 2 });
  });

  it("simulatePolicyMatrix couvre les 7 situations : économise au repos/bureau, protège le build 100 % et refroidit à 88 °C", () => {
    const rows = simulatePolicyMatrix(DEFAULT_SETTINGS.adaptive, DEFAULT_PROFILES, HARDWARE_PROFILES[0], "admin");
    expect(rows).toHaveLength(7);
    const office = rows.find((r) => r.id === "office-day")!;
    const idle = rows.find((r) => r.id === "coffee-idle")!;
    const heavy = rows.find((r) => r.id === "heavy-build")!;
    const hot = rows.find((r) => r.id === "thermal-spike")!;

    expect(office.verdict).toBe("Économise");
    expect(office.savedWattsVsStock).toBeGreaterThan(20);
    expect(idle.chosenSlot).toBe(2);
    expect(heavy.verdict).toBe("Protégé 100 %");
    expect(heavy.chosenSlot).toBe(5);
    expect(hot.verdict).toBe("Refroidit");
    expect(hot.chosenSlot).toBe(2);
  });
});

describe("optimiseur Pareto : précision matérielle, convergence User & budget exact", () => {
  it("le total de latence combiné sélectionné reste strictement dans le budget", () => {
    for (const hw of HARDWARE_PROFILES) {
      const cfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, hw);
      const props = generateOptimizationProposals(cfg, "office", "pareto", hw);
      const plan = buildBudgetPlan(props, cfg, "office", 1, hw, true);
      expect(plan.totalLatencyMs).toBeLessThanOrEqual(1 + 1e-6);
      expect(plan.selected.length + plan.deferred.length).toBe(props.length);
    }
  });

  it("ne propose JAMAIS d'optimisation GPU dédié NVML sur un Mini-PC à iGPU seul", () => {
    const miniPc = HARDWARE_PROFILES.find((h) => !h.hasDedicatedGpu)!;
    const cfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, miniPc);
    for (const goal of ["pareto", "silent", "gaming_eco", "server_24_7"] as const) {
      const props = generateOptimizationProposals(cfg, "gaming", goal, miniPc);
      expect(props.some((p) => p.id === "gpu_power_sweetspot")).toBe(false);
    }
  });

  it("respecte les bornes VBIOS d'un GPU portable dans le patch proposé (jamais < gpuMinPowerPct)", () => {
    const laptop = HARDWARE_PROFILES.find((h) => h.id === "laptop-7840hs-4060")!;
    const cfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, laptop);
    const props = generateOptimizationProposals(cfg, "gaming", "server_24_7", laptop);
    const gpuProp = props.find((p) => p.id === "gpu_power_sweetspot")!;
    expect(gpuProp.patch.gpuPowerLimitPct).toBeGreaterThanOrEqual(laptop.gpuMinPowerPct);
    expect(gpuProp.proposedSummary).toContain(`PL ${laptop.gpuMinPowerPct}%`);
  });

  it("appliquer toutes les propositions User converge à 0 proposition User restante (aucune boucle infinie EEE)", () => {
    const hw = HARDWARE_PROFILES[0];
    const initial = clampConfigToProfile(STOCK_BASELINE_CONFIG, hw);
    const props = generateOptimizationProposals(initial, "office", "pareto", hw);
    const userProps = props.filter((p) => !p.requiresAdmin);
    expect(userProps.length).toBeGreaterThan(0);

    let afterUser = { ...initial };
    for (const p of userProps) afterUser = { ...afterUser, ...p.patch };
    const effectiveUser = resolveEffectiveConfig(clampConfigToProfile(afterUser, hw), "user", initial);

    const remainingUser = generateOptimizationProposals(effectiveUser, "office", "pareto", hw).filter(
      (p) => !p.requiresAdmin
    );
    expect(remainingUser).toHaveLength(0);
  });

  it("toute proposition retournée économise réellement ≥ 0,3 W (zéro gain fictif inventé)", () => {
    for (const hw of HARDWARE_PROFILES) {
      for (const wl of ["idle", "office", "gaming", "heavy"] as const) {
        const cfg = clampConfigToProfile(STOCK_BASELINE_CONFIG, hw);
        const props = generateOptimizationProposals(cfg, wl, "pareto", hw);
        for (const p of props) {
          expect(p.savedWatts).toBeGreaterThanOrEqual(0.3);
        }
      }
    }
  });
});

describe("blindage de la désérialisation (profils, autostart, conditions & TOML)", () => {
  it("rejette NaN, Infinity et displayRefreshHz invalides dans sanitizeProfiles", () => {
    const corrupted = DEFAULT_PROFILES.map((p, i) =>
      i === 0
        ? {
            ...p,
            name: "   ",
            config: {
              ...p.config,
              cpuFreqCapMhz: Number.NaN,
              cpuPl1Watts: Number.POSITIVE_INFINITY,
              gpuPowerLimitPct: Number.NEGATIVE_INFINITY,
              displayRefreshHz: 999,
              cpuTurboMode: "overclock-extreme",
            },
          }
        : p
    );
    const clean = sanitizeProfiles(corrupted);
    expect(clean[0].name).toBe(DEFAULT_PROFILES[0].name);
    expect(clean[0].config.cpuFreqCapMhz).toBe(DEFAULT_PROFILES[0].config.cpuFreqCapMhz);
    expect(clean[0].config.cpuPl1Watts).toBe(DEFAULT_PROFILES[0].config.cpuPl1Watts);
    expect(clean[0].config.gpuPowerLimitPct).toBe(DEFAULT_PROFILES[0].config.gpuPowerLimitPct);
    expect(clean[0].config.displayRefreshHz).toBe(DEFAULT_PROFILES[0].config.displayRefreshHz);
    expect(clean[0].config.cpuTurboMode).toBe(DEFAULT_PROFILES[0].config.cpuTurboMode);
  });

  it("rejette les variantes RuleCondition malformées sans jamais lever d'exception", () => {
    expect(sanitizeCondition({ kind: "workload", workload: "crypto_mining" })).toBeNull();
    expect(sanitizeCondition({ kind: "idle", seconds: Number.NaN })).toBeNull();
    expect(sanitizeCondition({ kind: "schedule", from: "soir", to: 7 })).toBeNull();
    expect(sanitizeCondition({ kind: "thermal", tempC: Number.POSITIVE_INFINITY })).toBeNull();
    expect(sanitizeCondition({ kind: "power_above", watts: "beaucoup" })).toBeNull();
    expect(sanitizeCondition({ kind: "schedule", from: -5, to: 99 })).toEqual({
      kind: "schedule",
      from: 0,
      to: 23,
    });
    expect(sanitizeCondition({ kind: "idle", seconds: 2 })).toEqual({ kind: "idle", seconds: 10 });
  });

  it("sanitizeSettings, sanitizeAutostart et sanitizeSlot résistent aux entrées arbitraires", () => {
    const s = sanitizeSettings({
      tooltips: "oui",
      adaptive: {
        budgetMs: "abc",
        mode: "x",
        manualSnoozeMin: 9999,
        rules: [{ id: "bad", label: "x", enabled: true, protect: false, target: 1, condition: { kind: "workload", workload: "nope" } }],
      },
    });
    expect(s.tooltips).toBe(DEFAULT_SETTINGS.tooltips);
    expect(s.adaptive.budgetMs).toBe(DEFAULT_SETTINGS.adaptive.budgetMs);
    expect(s.adaptive.mode).toBe("suggest");
    expect(s.adaptive.manualSnoozeMin).toBe(120);
    expect(s.adaptive.rules).toHaveLength(0);

    const auto = sanitizeAutostart({ bootProfileId: 99, safeBootDelaySec: Number.NaN, method: "rootkit" });
    expect(auto.bootProfileId).toBe(DEFAULT_AUTOSTART.bootProfileId);
    expect(auto.safeBootDelaySec).toBe(DEFAULT_AUTOSTART.safeBootDelaySec);
    expect(auto.method).toBe("hkcu_registry");

    expect(sanitizeSlot("3")).toBe(3);
    expect(sanitizeSlot("99")).toBe(1);
    expect(sanitizeSlot(null)).toBe(1);
  });

  it("escapeTomlString protège les antislashs, guillemets, retours ligne et caractères de contrôle", () => {
    const escaped = escapeTomlString('Bureau\\Nuit "Calme"\n\t\u0007');
    expect(escaped).toBe('Bureau\\\\Nuit \\"Calme\\"\\n\\t');
  });

  it("serializeProfilesToToml respecte le schéma ProfileStore Rust 1:1 et effectue un round-trip exact via parseProfilesToml", () => {
    const custom = DEFAULT_PROFILES.map((p, i) =>
      i === 0 ? { ...p, name: 'Profil C:\\Éco "Pareto"' } : p
    );
    const toml = serializeProfilesToToml(custom, DEFAULT_AUTOSTART, {
      activeSlot: 3,
      showTooltips: false,
      adaptiveEnabled: true,
    });

    // Vérifie les clés exactes attendues par serde dans src/domain.rs
    expect(toml).toContain("active_slot = 3");
    expect(toml).toContain("show_tooltips = false");
    expect(toml).toContain("adaptive_enabled = true");
    expect(toml).toContain('method = "hkcu_registry_run"');
    expect(toml).toContain("start_minimized = true");
    expect((toml.match(/\[\[profiles\]\]/g) ?? []).length).toBe(5);
    expect((toml.match(/\[profiles\.config\]/g) ?? []).length).toBe(5);

    const parsed = parseProfilesToml(toml);
    expect(parsed).not.toBeNull();
    expect(parsed!.activeSlot).toBe(3);
    expect(parsed!.showTooltips).toBe(false);
    expect(parsed!.adaptiveEnabled).toBe(true);

    const restored = sanitizeProfiles(parsed!.profiles);
    expect(restored[0].name).toBe('Profil C:\\Éco "Pareto"');
    for (let i = 0; i < 5; i++) {
      expect(restored[i].config).toEqual(custom[i].config);
    }
  });

  it("parseProfilesToml décode aussi un fichier TOML minimal écrit par ecoclock.exe (Rust pur)", () => {
    const toml = serializeProfilesToToml(DEFAULT_PROFILES, DEFAULT_AUTOSTART)
      .split("\n")
      .filter((l) => !l.startsWith("gpu_vram_policy") && !l.startsWith("timer_resolution"))
      .join("\n");
    const parsed = parseProfilesToml(toml);
    expect(parsed).not.toBeNull();
    const restored = sanitizeProfiles(parsed!.profiles);
    expect(restored[0].config.gpuVramPolicy).toBe("force_p8_idle");
    expect(restored[0].config.timerResolution).toBe("coalesced_15_6ms");
    expect(restored[0].config.pcieAspm).toBe("l1_substates");
    expect(restored[0].config.wifiPowerMode).toBe("medium_psp");
  });

  it("buildWindowsPowerShellScript génère un script sûr avec sauvegarde -Restore, neutralise les retours ligne et omet nvidia-smi sur iGPU", () => {
    const evilProfile = { ...DEFAULT_PROFILES[0], name: "Test\r\nRemove-Item -Recurse C:\\" };
    const desktopScript = buildWindowsPowerShellScript(
      evilProfile,
      DEFAULT_PROFILES[0].config,
      HARDWARE_PROFILES[0]
    );
    expect(desktopScript).toContain("param([switch]$Restore)");
    expect(desktopScript).toContain("baseline-scheme.pow");
    expect(desktopScript).toContain("nvidia-smi.exe -pl 132");
    expect(desktopScript).toContain("nvidia-smi.exe -lgc 210,1680");
    // Aucune ligne exécutable ne commence par Remove-Item (l'injection de retour ligne est neutralisée en commentaire)
    const injectedLine = desktopScript.split(/\r?\n/).some((l) => l.trim().startsWith("Remove-Item"));
    expect(injectedLine).toBe(false);

    const miniPc = HARDWARE_PROFILES.find((h) => !h.hasDedicatedGpu)!;
    const igpuScript = buildWindowsPowerShellScript(DEFAULT_PROFILES[0], DEFAULT_PROFILES[0].config, miniPc);
    expect(igpuScript).not.toContain("nvidia-smi.exe -pl");
  });

  it("verrouille le schéma : [profiles.config] contient exactement les 24 champs Rust + 2 extensions web", () => {
    // Source de vérité : struct HardwareConfig de src/data/rustProject.ts (serde snake_case).
    const RUST_FIELDS = [
      "cpu_max_percent",
      "cpu_min_percent",
      "cpu_freq_cap_mhz",
      "cpu_turbo",
      "cpu_epp_percent",
      "cpu_min_active_cores",
      "cpu_deep_cstates",
      "cpu_pl1_watts",
      "bg_eco_qos",
      "gpu_power_limit_pct",
      "gpu_clock_cap_mhz",
      "gpu_force_p8_idle",
      "gpu_zero_rpm",
      "igpu_eco_mode",
      "pcie_aspm",
      "nvme_apst",
      "nvme_idle_timeout_ms",
      "sata_alpm",
      "display_refresh_hz",
      "display_brightness_pct",
      "nic_eee_802_3az",
      "wifi_power",
      "usb_selective_suspend",
      "timer_coalescing",
    ];
    // Volontairement hors HardwareConfig Rust : conservent prefer_p5 / high_0_5ms en web↔web.
    const WEB_EXTENSIONS = ["gpu_vram_policy", "timer_resolution"];

    const toml = serializeProfilesToToml(DEFAULT_PROFILES, DEFAULT_AUTOSTART);
    const profileBlocks = toml.split("[[profiles]]").slice(1);
    expect(profileBlocks).toHaveLength(5);

    for (const block of profileBlocks) {
      const configPart = block.split("[profiles.config]")[1] ?? "";
      const keys = configPart
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
        .map((line) => line.slice(0, line.indexOf("=")).trim());

      expect(new Set(keys)).toEqual(new Set([...RUST_FIELDS, ...WEB_EXTENSIONS]));
      expect(keys).toHaveLength(RUST_FIELDS.length + WEB_EXTENSIONS.length);
    }
  });

  it("getTomlPersistenceWarnings nomme les créneaux que le binaire Rust aplatit, et eux seuls", () => {
    // État d'usine réel : P3 « Jeu » utilise prefer_p5, P5 « Stock » hérite du timer 0,5 ms.
    // Ces deux-là ne sont pas représentables par les booléens Rust (prefer_p5 ≠ force_p8_idle, 0,5 ms ≠ 1 ms).
    expect(getTomlPersistenceWarnings(DEFAULT_PROFILES)).toEqual([
      "P3 : VRAM prefer_p5 → reviendra à auto",
      "P5 : timer 0,5 ms → reviendra à 1 ms",
    ]);

    // Un jeu de profils uniquement composé d'états représentables ne doit rien signaler.
    const faithful = DEFAULT_PROFILES.map((p) => ({
      ...p,
      config: { ...p.config, timerResolution: "coalesced_15_6ms" as const, gpuVramPolicy: "force_p8_idle" as const },
    }));
    expect(getTomlPersistenceWarnings(faithful)).toEqual([]);

    // standard_1ms partage timer_coalescing=false avec coalesced : aucune perte annoncée.
    const standard = faithful.map((p) => ({ ...p, config: { ...p.config, timerResolution: "standard_1ms" as const } }));
    expect(getTomlPersistenceWarnings(standard)).toEqual([]);
  });

  it("ne propose l'EEE 802.3az que sur une machine réellement dotée d'un port Ethernet", () => {
    const wifiOnly = { ...HARDWARE_PROFILES[0], hasEthernet: false };
    const cfgWifi = clampConfigToProfile(STOCK_BASELINE_CONFIG, wifiOnly);
    expect(
      generateOptimizationProposals(cfgWifi, "office", "pareto", wifiOnly).some((p) => p.id === "nic_eee_802_3az")
    ).toBe(false);

    const wired = HARDWARE_PROFILES[0];
    const cfgWired = clampConfigToProfile(STOCK_BASELINE_CONFIG, wired);
    expect(
      generateOptimizationProposals(cfgWired, "office", "pareto", wired).some((p) => p.id === "nic_eee_802_3az")
    ).toBe(true);

    // Le clamp doit éteindre le réglage, pas seulement masquer la proposition :
    // un TOML importé d'une autre machine ne peut pas transporter un réglage inapplicable.
    expect(clampConfigToProfile({ ...cfgWired, nicEeeEnabled: true }, wifiOnly).nicEeeEnabled).toBe(false);
    expect(clampConfigToProfile({ ...cfgWired, nicEeeEnabled: true }, wired).nicEeeEnabled).toBe(true);
  });
});

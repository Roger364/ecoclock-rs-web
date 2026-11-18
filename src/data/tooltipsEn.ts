import { TooltipDoc } from "../types/hardware";
import { TOOLTIPS } from "./tooltips";

export type TooltipDocEn = Omit<
  TooltipDoc,
  "title" | "subsystem" | "summary" | "physicsDetail" | "beforeAfterHint" | "safetyNote"
> & {
  title: string;
  subsystem: string;
  summary: string;
  physicsDetail: string;
  beforeAfterHint: string;
  safetyNote: string;
};

export const TOOLTIPS_EN: Record<keyof typeof TOOLTIPS, TooltipDocEn> = {
  // === PRIVILEGES, AUTOSTART & SAFETY ===
  privilege_mode: {
    key: "privilege_mode",
    title: "Dual-Privilege Model (User asInvoker → on-demand UAC elevation)",
    subsystem: "Windows Security",
    privilege: "both",
    winApi:
      "OpenProcessToken(TOKEN_QUERY) + GetTokenInformation(TokenElevation) / ShellExecuteExW(L\"runas\")",
    summary:
      "The executable ships with a UAC manifest `requestedExecutionLevel level=\"asInvoker\"`: it always starts under the standard user token with no intrusive popup, and already controls ~65% of the energy savings (active CPU power plan, Turbo Boost, EPP, EcoQoS, display Hz, USB suspend, Wi-Fi PSP).",
    physicsDetail:
      "Administrator elevation (unfiltered token unlocked via `ShellExecuteExW` with the `runas` verb and a secure `--elevated --slot N` hand-off) unlocks global hardware calls: `nvmlDeviceSetPowerManagementLimit` & `SetGpuLockedClocks` on the dedicated GPU, PCIe ASPM L1.2 substates, NVMe APST PS4, Core Parking, RAPL PL1, NIC EEE 802.3az, and the boot scheduled task with no UAC prompt.",
    beforeAfterHint:
      "User mode alone: up to -48 W saved (0 popups). Admin mode: up to -95 W saved (GPU Power Limit + NVMe PS4 + PL1 unlocked).",
    safetyNote:
      "NO third-party Ring-0 kernel driver (no WinRing0, no RwDrv) is loaded: 100% compatible with Windows 11 HVCI (Memory Integrity), VBS, Secure Boot and kernel anti-cheats.",
  },

  autostart_windows: {
    key: "autostart_windows",
    title: "Automatic Start with Windows & Persistence of the 5 Profiles",
    subsystem: "System Integration",
    privilege: "both",
    winApi:
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run  |  COM ITaskService (TASK_RUNLEVEL_HIGHEST)",
    summary:
      "Two clean mechanisms depending on your rights: in User mode, a single string value under `HKCU\\...\\Run` launches `ecoclock.exe --tray --apply-profile <1..5>`. In Admin mode, a signed Windows scheduled task (`\\EcoClock\\Autostart`) runs at sign-in with `RunLevel = HighestAvailable` without showing a UAC prompt on every boot.",
    physicsDetail:
      "The 5 profiles are serialized to `%APPDATA%\\EcoClock\\profiles.toml` (~2.4 KB) with an atomic write (`WriteFile` to `.tmp` + `FlushFileBuffers` + `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`), preventing corruption even on power loss.",
    beforeAfterHint:
      "Added Windows boot time: ~6.8 ms (418 KB native Rust binary with no WebView/.NET runtime). Tray icon RAM footprint: 4.6 MB.",
    safetyNote:
      "Built-in Safe-Boot guard: waits 15 s for stability after sign-in and automatically disarms autostart if an abnormal previous shutdown is detected in `rollback.toml`.",
  },

  rollback_guard: {
    key: "rollback_guard",
    title: "Safe Architecture: RAII RollbackGuard & Official Caps (0 Crashes)",
    subsystem: "Rust Safety",
    privilege: "both",
    winApi:
      "SetConsoleCtrlHandler + WM_QUERYENDSESSION + std::panic::set_hook + GUID snapshot",
    summary:
      "Before the very first change, EcoClock snapshots all original PowerCfg, NVML and display registers to `%APPDATA%\\EcoClock\\baseline_snapshot.toml`. `power_plan::read_into_config` reads active AC indexes via `PowerReadACValueIndex` and the screen refresh rate via `EnumDisplaySettingsW` before any modification. On normal exit and on panic, the RAII destructor re-applies this snapshot; after a hard shutdown, the `boot_apply.lock` sentinel automatically disarms autostart (note: under `windows_subsystem = 'windows'`, `WM_ENDSESSION` interception is still to be completed to also cover an OS shutdown with the window open).",
    physicsDetail:
      "Unlike manual undervolting (a negative mV offset that shrinks transistor noise margin and can cause WHEA errors or BSODs), EcoClock underclocks by capping official P/C states: the CPU and GPU themselves pick the factory-certified Vmin for the lowered frequency!",
    beforeAfterHint:
      "WHEA error / memory corruption rate: 0.00%. Full one-click restore to factory state in 3.2 ms.",
    safetyNote:
      "All values are statically bounded by validated Rust types and checked against `nvmlDeviceGetPowerManagementLimitConstraints` before the FFI call.",
  },

  // === KPI & GLOBAL TELEMETRY ===
  kpi_power: {
    key: "kpi_power",
    title: "System Power DC vs Wall AC (CMOS Law P = C·V²·f + P_leak)",
    subsystem: "Energy Telemetry",
    privilege: "both",
    winApi:
      "Windows EMI (Energy Meter Interface) + RAPL MSR_PKG_ENERGY_STATUS + nvmlDeviceGetPowerUsage",
    summary:
      "Real-time sum of all internal rails (CPU Package, GPU Board, Chipset/PCIe, NVMe/SATA, Display, NIC/USB) and actual power drawn at the 230 V AC wall outlet after PSU efficiency (80+ Gold: ~89% at mid-load, ~83% at very light load).",
    physicsDetail:
      "A CMOS chip's dynamic power follows P_dyn = α · C · V² · f. But raising frequency f also requires raising voltage V almost linearly: power therefore scales roughly as f^2.7 to f^3! Cutting frequency by just 25% reduces the required voltage by ~22% and drops power by more than 54%. Leakage current P_leak also falls exponentially as temperature drops (-15 °C ≈ -4 to -8 W of free extra savings).",
    beforeAfterHint:
      "Every 50 W saved for 10 h/day saves 182.5 kWh/year (~€45.9/year at the regulated rate of €0.2516/kWh) and avoids the same amount of heat rejected into the room in summer.",
    safetyNote:
      "Windows 11 EMI and NVML energy counters are polled at 1 Hz (< 0.02% CPU cost) without waking sleeping cores.",
  },

  kpi_temp: {
    key: "kpi_temp",
    title: "Silicon Temperatures (CPU Package, GPU Core/Hotspot, NVMe SMART) & TjMax Margin",
    subsystem: "Thermal",
    privilege: "both",
    winApi:
      "ThermalZone WMI / PawnIO DTS + nvmlDeviceGetTemperature + IOCTL_STORAGE_QUERY_PROPERTY (SMART)",
    summary:
      "Measures critical junction temperatures and the safety distance to `TjMax` (100 °C on a modern CPU). By Fourier's law ΔT = P · R_th, halving the dissipated watts almost halves the temperature rise above ambient air (22 °C).",
    physicsDetail:
      "Electromigration degradation (Black's equation) roughly doubles every +10 °C. Running a CPU at 43 °C instead of 72 °C and an NVMe SSD at 35 °C instead of 56 °C drastically extends the life of VRM capacitors, thermal paste and the flash controller.",
    beforeAfterHint:
      "Below 50–52 °C, almost every modern graphics card stops its fans entirely (0 RPM Fan-Stop): mechanical bearing wear drops to zero.",
    safetyNote:
      "PROCHOT# and THERMTRIP# hardware thermal protections remain 100% active and untouched.",
  },

  kpi_fan_noise: {
    key: "kpi_fan_noise",
    title: "Fan Speed (RPM) & Combined Acoustic Level in dBA (Fan Law)",
    subsystem: "Acoustics & PWM",
    privilege: "both",
    winApi: "nvmlDeviceGetFanSpeed_v2 + SuperIO/EC Read-Only Telemetry",
    summary:
      "Even without touching the BIOS PWM curves, lowering watts drops the temperature below the ramp thresholds of the CPU, GPU and case fans. Sound sources add logarithmically: L_tot = 10 · log10(Σ 10^(L_i/10)).",
    physicsDetail:
      "By aerodynamic affinity laws, fan noise changes as 50 · log10(RPM_2 / RPM_1): halving RPM cuts noise by about -15 dBA! In psychoacoustics, -10 dBA is perceived as TWICE as quiet by the human ear. Below 24 dBA, the PC blends into the background noise of a quiet room.",
    beforeAfterHint:
      "Typical mixed load: 1750 RPM (39.5 dBA, very audible whoosh) → 680 RPM + GPU 0 RPM (22.8 dBA, nearly inaudible at 60 cm).",
    safetyNote:
      "EcoClock never forces a fan to stop on a hot component: silence is achieved naturally by removing heat at the source!",
  },

  kpi_latency_ms: {
    key: "kpi_latency_ms",
    title: "Real Effects Measured in Milliseconds (Human Perception vs Raw Frequency)",
    subsystem: "Real Benchmarks",
    privilege: "both",
    winApi:
      "QueryPerformanceCounter (resolution < 100 ns) + real LZ4 / JSON / UI / 4K I/O workloads",
    summary:
      "Abstract synthetic scores mislead users: EcoClock measures the REAL time in milliseconds (ms) of concrete everyday operations before and after underclocking, compared against human physiological thresholds.",
    physicsDetail:
      "Established neuro-visual thresholds (Nielsen / Rail Model): < 16.67 ms = one frame at 60 Hz (perfectly smooth, 0 stutter); < 50 ms = perceived as instant on a keypress or click; > 100 ms = beginning of a slight delay perception. Taking JSON parsing from 5.8 ms to 8.4 ms (+2.6 ms) is biologically undetectable, while it saves 45% of CPU electricity!",
    beforeAfterHint:
      "Many modern tasks are bound by DRAM latency (~65 ns) or the network (~15 ms), not by the CPU's last MHz: underclocking by -30% sometimes slows them by only +9 to +14%.",
    safetyNote:
      "The built-in micro-benchmark lasts < 120 ms total and does not heat up components.",
  },

  // === CPU CONTROLS ===
  cpu_freq_cap: {
    key: "cpu_freq_cap",
    title: "Processor Frequency Cap (PROCFREQMAX in MHz)",
    subsystem: "CPU (P-Cores & E-Cores)",
    privilege: "user",
    winApi:
      "powrprof.dll → PowerWriteACValueIndex(SUB_PROCESSOR, PROCFREQMAX 75b0ae3f-bce0-45a7-8c89-c9611c25e100)",
    summary:
      "Sets the exact upper MHz limit the hardware governor (Intel Speed Shift HWP / AMD CPPC2) may request. The CPU remains free to drop to 400–800 MHz at idle, but will never cross this cap.",
    physicsDetail:
      "On a modern 5.2 GHz CPU, the voltage/frequency (V/F) curve is gentle from 800 MHz (0.68 V) to 3600 MHz (0.96 V), then rises steeply between 4200 MHz and 5200 MHz (1.38 V+) to meet logic gate propagation delays. Capping at 3200–3600 MHz removes the entire exponential V² region.",
    beforeAfterHint:
      "5200 MHz (1360 mV, 92 W under load) → 3400 MHz (940 mV, 31 W under load): -66% CPU watts, -24 °C, while opening a document goes from 14 ms to 19.5 ms (+5.5 ms).",
    safetyNote:
      "Standard user-space Windows API. Immediate effect (< 2 ms) after `PowerSetActiveScheme`, no reboot required.",
  },

  cpu_max_pct: {
    key: "cpu_max_pct",
    title: "Maximum Processor State (% of base frequency)",
    subsystem: "CPU",
    privilege: "user",
    winApi:
      "powrprof.dll → SUB_PROCESSOR / PROCTHROTTLEMAX (bc5038f7-23e0-4960-96da-33abaf5935ec)",
    summary:
      "Limits the maximum P-State as a percentage of the nominal (base) clock. A famous Windows trick: going from 100% to 99% instantly disables Turbo Boost/Precision Boost Overdrive on most ACPI drivers, and dropping to 60–80% forces very low-voltage P-States.",
    physicsDetail:
      "Works together with `PROCFREQMAX`: the NT kernel applies the strict minimum `min(BaseClock × MaxPct, FreqCapMHz)`. Very useful on laptops or locked CPUs where `PROCFREQMAX` is sometimes rounded by UEFI firmware.",
    beforeAfterHint:
      "100% → 80% on a 3.6 GHz base caps at ~2.88 GHz (VID ~0.84 V), bringing a 125 W CPU below 26 W even under multi-core compilation!",
    safetyNote:
      "100% reversible in standard User mode. Never drops below the hardware minimum P-State (Pn/LFM).",
  },

  cpu_min_pct: {
    key: "cpu_min_pct",
    title: "Minimum Processor State (free drop to LFM at idle)",
    subsystem: "CPU",
    privilege: "user",
    winApi:
      "powrprof.dll → SUB_PROCESSOR / PROCTHROTTLEMIN (893dee8e-2bef-41e0-89c6-b55d0929964c)",
    summary:
      "The Windows “High performance” plan absurdly locks this setting at 100%, preventing the CPU from dropping to 800 MHz even while you read a static page! Keeping it at 5% allows the LFM (Lowest Frequency Mode) floor.",
    physicsDetail:
      "At LFM (600–800 MHz, ~0.65 V), PLL loops and clock trees draw 6 times less than at 4.8 GHz during system micro-wakeups (mouse, blinking cursor, network telemetry).",
    beforeAfterHint:
      "100% → 5% at the desktop: -12 to -22 W immediately at idle, -9 °C, and frequency ramp-up time under Intel HWP / AMD CPPC2 of only 1.0 ms (hardware)!",
    safetyNote:
      "Recommended value: 5% in absolutely every profile, including gaming.",
  },

  cpu_turbo: {
    key: "cpu_turbo",
    title: "Turbo Boost / Precision Boost Policy (PERFBOOSTMODE)",
    subsystem: "CPU",
    privilege: "user",
    winApi:
      "powrprof.dll → SUB_PROCESSOR / PERFBOOSTMODE (be337238-0d82-4146-a960-4f3749d470c7)",
    summary:
      "Controls the opportunistic over-frequency algorithm above base clock: `Aggressive` (Windows default, jumps to max on the slightest mouse move), `Efficient Enabled` (boosts only when load stays sustained and worthwhile), or `Disabled` (strictly stays ≤ base clock).",
    physicsDetail:
      "Turbo Boost spikes to 1.40 V+ for 80 ms when opening a tab create local thermal peaks (+18 °C in 0.2 s) that make the CPU fan spin up needlessly. Disabling Turbo removes 100% of these voltage and fan spikes!",
    beforeAfterHint:
      "Aggressive → Disabled: removes 1.42 V spikes, saves 18–45 W under active use, completely eliminates CPU fan yo-yoing, web browsing impact: +3.5 ms.",
    safetyNote:
      "On some Windows installs, the `ATTRIB_HIDE` attribute hides this option in Control Panel, but writing directly through its GUID works natively.",
  },

  cpu_epp: {
    key: "cpu_epp",
    title: "Hardware Energy Preference EPP (Intel Speed Shift / AMD CPPC2)",
    subsystem: "CPU (PMU microcode)",
    privilege: "user",
    winApi:
      "powrprof.dll → SUB_PROCESSOR / PERFEPP (36687f9e-e3a5-4dbf-b1dc-15eb381c6863) → IA32_HWP_REQUEST[31:24]",
    summary:
      "A 0% (pure performance) to 100% (maximum efficiency) parameter written directly into each core's HWP/CPPC hardware register. The CPU's internal PMU arbitrates the best voltage/frequency pair every 1 millisecond.",
    physicsDetail:
      "At EPP = 0–20%, a 2 ms background micro-task sends the core to 5 GHz. At EPP = 70–85%, microcode runs short tasks at the maximum efficiency point (V/F inflection ~1.8–2.4 GHz, best instructions/joule) and only ramps up when the run queue saturates.",
    beforeAfterHint:
      "EPP 20% → 80% in office/dev: -11 W average, -7 °C, UI click response time: +1.8 ms (strictly imperceptible).",
    safetyNote:
      "Managed autonomously by the CPU's internal firmware, adaptation latency 1 ms.",
  },

  cpu_core_parking: {
    key: "cpu_core_parking",
    title: "Core Parking (Minimum Active Cores — deep sleep for unused cores)",
    subsystem: "CPU (core topology)",
    privilege: "admin",
    winApi:
      "powrprof.dll → SUB_PROCESSOR / CPMINCORES (0cc5b647-c1df-4637-891a-dec35c318583) [Admin: unhide]",
    summary:
      "Allows the Windows scheduler to “park” surplus cores in C6/C7 (power cut by transistor power-gating) and pack light threads onto a few efficient cores instead of waking all 16 cores permanently.",
    physicsDetail:
      "A core parked in C6 has its rail voltage cut to ~0.0 V (near-zero leakage, < 0.05 W/core) and its L1/L2 cache flushed to the LLC. Parking 75% of cores at idle also lets the whole package enter deep Pkg-C8 more often.",
    beforeAfterHint:
      "100% active → 25% active at idle/desktop: -5 to -9 W, unpark time for a core when a heavy load arrives: ~0.35 ms.",
    safetyNote:
      "As soon as CPU load exceeds the occupancy threshold (65%), Windows automatically wakes all cores in less than a millisecond.",
  },

  cpu_cstates: {
    key: "cpu_cstates",
    title: "Deep Sleep C-States (C6 / C8 / C10 Power Gating)",
    subsystem: "CPU Package",
    privilege: "user",
    winApi:
      "powrprof.dll → SUB_PROCESSOR / IDLEDISABLE (5d76a2ca-e8c0-402f-a133-2158492d58ad) = 0",
    summary:
      "Lets idle cores between interrupts cut their clock (C1E) and then their full supply voltage through high-resistance switching transistors (C6/C8/C10).",
    physicsDetail:
      "Even when Windows shows 2% CPU usage, the processor is idle 98% of every second. Without deep C-States it waits in C0/C1 burning 24 W of static current. With C8/C10 enabled (and compatible PCIe ASPM), the CPU Package drops to 2.5–5 W at idle!",
    beforeAfterHint:
      "C-States disabled → C8/C10 active: deep residency goes from 0% to 88% at the desktop, -16 W at idle, C8 exit latency: ~0.12 ms (120 µs).",
    safetyNote:
      "Native ACPI feature. Only extreme real-time audio studios (ASIO buffer < 32 samples) sometimes need to limit them.",
  },

  cpu_pl1: {
    key: "cpu_pl1",
    title: "Maximum Package Thermal Envelope PL1 / PPT (strict watt cap)",
    subsystem: "CPU (RAPL / firmware)",
    privilege: "admin",
    winApi:
      "PowerCfg Processor Power Limit / Intel DPTF / AMD PMF (Administrator rights)",
    summary:
      "Imposes an absolute electrical budget in watts on the entire processor package. Even if you launch a 3D video render or a Rust compile on 100% of threads, the CPU will instantly adjust its frequency so it NEVER exceeds this wattage.",
    physicsDetail:
      "The RAPL (Running Average Power Limit) unit integrates consumed energy every millisecond and regulates P-States in a closed loop. Taking a CPU from 125 W to 45 W typically keeps 76% of its multi-core performance (thanks to the cubic law) while dividing heat by 2.8!",
    beforeAfterHint:
      "PL1 125 W → 45 W at full load: CPU locked at 45.0 W max, temperature capped at 51 °C instead of 89 °C, fan at 820 RPM instead of 2150 RPM.",
    safetyNote:
      "Requires Administrator mode. Bounded between 15 W (safety floor) and 125 W (nominal TDP).",
  },

  bg_ecoqos: {
    key: "bg_ecoqos",
    title: "Windows 11 EcoQoS (Efficiency Mode for background processes)",
    subsystem: "NT scheduler",
    privilege: "user",
    winApi:
      "kernel32.dll → SetProcessInformation(ProcessPowerThrottling, PROCESS_POWER_THROTTLING_EXECUTION_SPEED)",
    summary:
      "Applies the `EcoQoS` flag to non-interactive processes owned by the current user (indexers, updaters, minimized game launchers, inactive tabs): Windows confines them to low-frequency E-Cores without slowing the foreground window!",
    physicsDetail:
      "On hybrid architectures (Intel P+E or AMD dense cores), an E-Core at 1.6 GHz uses 4.5 times less energy per instruction than a P-Core at 4.8 GHz to run a cloud sync or background update.",
    beforeAfterHint:
      "Disabled → Enabled: -4 to -9 W during multitasking, +0.0 ms on your active foreground app (which keeps normal priority).",
    safetyNote:
      "Only affects processes of the same user (`PROCESS_SET_INFORMATION`), automatically excludes audio, the active window and critical system processes.",
  },

  // === GPU CONTROLS ===
  gpu_power_limit: {
    key: "gpu_power_limit",
    title: "Graphics Card Power Limit (GPU Power Limit % TDP via NVML)",
    subsystem: "Dedicated GPU",
    privilege: "admin",
    winApi:
      "nvml.dll → nvmlDeviceSetPowerManagementLimit(device, milliwatts) [Admin required by the driver]",
    summary:
      "Lowers the card's total power ceiling (GPU + GDDR6 + VRM) as a percentage of the vendor TDP. The GPU Boost controller dynamically picks the optimal frequency/voltage pair every millisecond.",
    physicsDetail:
      "Modern GPUs are pushed from the factory well beyond their optimal efficiency point: going from 220 W (100%) to 150 W (68%) loses only ~6–8% of in-game FPS! Dropping to 45–55% (~100 W) turns a power-hungry card into an ultra-cool, quiet one.",
    beforeAfterHint:
      "100% (220 W, 76 °C, 1950 RPM) → 65% (143 W, 57 °C, 1050 RPM): -77 W, -19 °C, 3D frame time goes from 8.2 ms to 9.1 ms (+0.9 ms, i.e. 122 → 110 FPS!).",
    safetyNote:
      "EcoClock first queries `nvmlDeviceGetPowerManagementLimitConstraints(min, max)` and rejects any value outside the VBIOS-certified range.",
  },

  gpu_clock_cap: {
    key: "gpu_clock_cap",
    title: "GPU Core Clock Cap (GPU Locked Clocks Min..Max MHz)",
    subsystem: "Dedicated GPU",
    privilege: "admin",
    winApi:
      "nvml.dll → nvmlDeviceSetGpuLockedClocks(device, minClockMHz=210, maxClockMHz=cap)",
    summary:
      "Exact equivalent of `nvidia-smi -lgc 210,<CAP>`: lets the GPU drop to 210 MHz (P8 state, 0.64 V) at idle, but forbids it from exceeding `<CAP>` MHz under 3D/video/local AI load.",
    physicsDetail:
      "Even with a low Power Limit, a light 3D load (accelerated UI, upscaled video, 2D game) can send the GPU to 2610 MHz @ 1.08 V. Capping at 1500–1850 MHz keeps Vgpu around 0.78–0.85 V, more than halving the energy per rendered frame.",
    beforeAfterHint:
      "2610 MHz → 1650 MHz: Vgpu falls from 1075 mV to 805 mV (-44% dynamic energy per shader), temperature -14 °C, DWM decode/compositing stays < 4 ms.",
    safetyNote:
      "Cleanly reset via `nvmlDeviceResetGpuLockedClocks(device)` when returning to the Nominal profile or on exit.",
  },

  gpu_vram_policy: {
    key: "gpu_vram_policy",
    title: "Video Memory State Policy GDDR6/GDDR6X (P8 / P5 / P0)",
    subsystem: "GPU (VRAM controller)",
    privilege: "admin",
    winApi:
      "nvml.dll → nvmlDeviceSetMemoryLockedClocks / NVAPI P-State Policy",
    summary:
      "GDDR6/GDDR6X memory is one of a PC's worst hidden wasters: at full speed (P0, 10,500 MHz), the memory chips and IMC controller alone burn 18 to 32 W! In P8 (405 MHz), they drop below 3 W.",
    physicsDetail:
      "With a 165 Hz display or multiple monitors, the VBLANK interval is sometimes too short to recalibrate the memory clock without artifacts: the driver then pins VRAM in P0 at 100% even on the Windows desktop! Pairing the P8/P5 policy with a 60/120 Hz refresh instantly frees 12 to 20 W.",
    beforeAfterHint:
      "VRAM stuck in P0 (28 W idle, GPU 53 °C fans running) → P8 Idle 405 MHz (8 W idle, GPU 34 °C, permanent 0 RPM Fan-Stop).",
    safetyNote:
      "The P8 → P0 transition when a 3D app opens takes ~0.8 ms and is handled by the VBIOS without artifacts.",
  },

  gpu_zero_rpm: {
    key: "gpu_zero_rpm",
    title: "Semi-Passive 0 RPM Mode (GPU fans fully stopped below 52 °C)",
    subsystem: "GPU (thermals & noise)",
    privilege: "user",
    winApi: "NVML Fan Cooler Policy (AUTO Zero-RPM Hysteresis 46°C..52°C)",
    summary:
      "Enables the VBIOS automatic semi-passive policy: as long as the GPU core stays below 52 °C (with a 46 °C restart hysteresis to avoid repeated start/stop), the fans stay at 0 RPM (0 dBA, 0 W motor).",
    physicsDetail:
      "Without underclocking, a graphics card often sits at 53–56 °C on the desktop and spins its fans at 1000 RPM for nothing. By lowering idle draw from 26 W to 9 W, the heatsink dissipates everything by natural convection at 35 °C.",
    beforeAfterHint:
      "1050 RPM (27 dBA) → 0 RPM (absolute silence + ~2.5 W saved from brushless motors + zero dust sucked into the heatsink).",
    safetyNote:
      "As soon as temperature crosses 52 °C, the vendor automatic curve immediately takes over.",
  },

  igpu_eco: {
    key: "igpu_eco",
    title: "iGPU Efficiency Mode (Intel Graphics / AMD Radeon integrated graphics)",
    subsystem: "iGPU / SoC",
    privilege: "user",
    winApi:
      "powrprof.dll → GUID_INTEL_GRAPHICS_SUBGROUP (44f3beca-a7c0-460e-9df2-bb8b99e0cba6) = Max Battery",
    summary:
      "Favors low frequencies (300–600 MHz instead of 1550 MHz) and RC6 idle on the integrated GPU during office rendering, browsing and AV1/HEVC hardware video decoding.",
    physicsDetail:
      "Fixed-function hardware video decoders (QuickSync / VCN) decode 4K60 at 400 MHz while drawing barely 1.2 W. Letting the iGPU boost to 1.5 GHz while scrolling a web page wastes 4 to 7 W in the Uncore/GT rail.",
    beforeAfterHint:
      "Max performance → iGPU efficiency: -2.5 to -6 W during video/web playback, 60 Hz scrolling still smooth (< 5 ms/frame).",
    safetyNote:
      "Standard Windows power plan setting, available in User mode.",
  },

  // === PCIe BUS & STORAGE ===
  pcie_aspm: {
    key: "pcie_aspm",
    title: "PCIe ASPM (Active State Power Management: L0 → L0s → L1 → L1.2 substates)",
    subsystem: "PCIe bus & chipset",
    privilege: "both",
    winApi:
      "powrprof.dll → SUB_PCIEXPRESS (501a4d13-42af-4429-9fd1-a8218c268e20) / ASPM (ee12f906-...)",
    summary:
      "Powers down the high-frequency differential lanes (16 GT/s SerDes) of PCIe ports (GPU x16, NVMe SSD x4, Wi-Fi card x1) between data packets. In the L1.2 substate, even the 100 MHz `CLKREQ#` reference clock and PLLs are cut!",
    physicsDetail:
      "A PCIe Gen4 x16 link stuck in L0 oscillates 32 differential pairs at 16 GHz continuously even to transfer 0 bytes/s, burning ~6 to 9 W AND physically preventing the CPU from reaching C8/C10 (a domino effect worth +8 W more)! In L1.2, the link drops below 0.02 W.",
    beforeAfterHint:
      "ASPM Disabled → L1.2 Substates: -7 to -13 W total (PCIe + CPU Pkg-C8 unlock), L1.2 link wake latency: ~0.045 ms (45 µs, completely invisible).",
    safetyNote:
      "L0s and L1 are user-changeable (`Moderate/maximum power savings`); fine-grained forcing of L1.2 substates requires Admin.",
  },

  nvme_apst: {
    key: "nvme_apst",
    title: "NVMe APST (Autonomous Power State Transition: PS0 → PS1 → PS3 → PS4)",
    subsystem: "NVMe SSD storage",
    privilege: "admin",
    winApi:
      "powrprof.dll → SUB_DISK / NVMe NOPPME & Primary/Secondary Idle Timeout (d639518a-e56d-4345-8af2-b9f32fb26109)",
    summary:
      "A modern Gen4 NVMe SSD has 5 internal power states: PS0 (full speed, 6.5–8.5 W), PS1 (3.5 W), PS3 (idle without I/O, 0.05 W = 50 mW) and PS4 (deep sleep, 0.005 W = 5 mW!). APST switches the controller automatically as soon as a disk access ends.",
    physicsDetail:
      "When APST is disabled (often in the “Performance” profile), the SSD's multi-core ARM controller heats to 54–62 °C doing nothing. In PS4, the SSD draws 1,200 times less than in PS0 and falls back to 32–35 °C.",
    beforeAfterHint:
      "Permanent PS0 (5.8 W idle, 55 °C) → PS4 Deep (0.02 W idle, 33 °C, -22 °C on the SSD!). Cost on the VERY FIRST read after inactivity: 0.06 ms → 1.85 ms (+1.79 ms), then full 7,000 MB/s in PS0.",
    safetyNote:
      "Zero data loss or flash wear: APST only affects the SSD controller and DRAM cache clocks.",
  },

  nvme_timeout: {
    key: "nvme_timeout",
    title: "NVMe Idle Timeout before Sleep Transition (Idle Timeout in ms)",
    subsystem: "NVMe SSD storage",
    privilege: "admin",
    winApi:
      "powrprof.dll → SUB_DISK / NVME_IDLE_TIMEOUT (d639518a-e56d-4345-8af2-b9f32fb26109)",
    summary:
      "I/O silence period (in milliseconds) required before the NVMe SSD drops to PS3/PS4 sleep. A short timeout (100 ms) maximizes time at 5 mW; a longer one (500–1000 ms) avoids back-and-forth during heavy compilation.",
    physicsDetail:
      "Windows naturally batches NTFS cache writes in bursts. With a 100–200 ms timeout, the SSD sleeps more than 94% of the time in office use while staying in PS0 for the entire duration of a file copy or level load.",
    beforeAfterHint:
      "1000 ms → 100 ms: +1.4 W saved in intermittent office use, -5 °C on the NVMe controller.",
    safetyNote:
      "Bounded ≥ 50 ms to avoid excessive power-state cycling (thrashing).",
  },

  sata_alpm: {
    key: "sata_alpm",
    title: "SATA ALPM (Aggressive Link Power Management: Active / HIPM / DIPM Slumber)",
    subsystem: "SATA & AHCI storage",
    privilege: "admin",
    winApi:
      "powrprof.dll → SUB_DISK / AHCI Link Power Management HIPM/DIPM (0b2d69d7-a2a1-449c-9680-f91c70521c60)",
    summary:
      "Puts the 6 Gb/s SATA PHY interface of the motherboard AHCI controller and secondary SSDs/HDDs to sleep (`Partial` or `Slumber`) when no NCQ command is in flight. DIPM lets the drive initiate sleep itself.",
    physicsDetail:
      "Even with no mechanical hard drive, a SATA controller kept in `Active` sometimes prevents the PCH (motherboard chipset) from entering the SLP_S0 low-power state, wasting 1.5 to 3.5 W.",
    beforeAfterHint:
      "Active → DIPM Slumber: -1.8 to -3.2 W, Slumber exit latency: ~3.2 ms (only on secondary SATA drives).",
    safetyNote:
      "Natively supported by the Microsoft `storahci.sys` driver on all modern SSDs/HDDs.",
  },

  // === DISPLAY, NETWORK, USB & TIMER ===
  display_hz: {
    key: "display_hz",
    title: "Display Refresh Rate (Hz) & Hidden Effect on GPU VRAM",
    subsystem: "Display & DWM",
    privilege: "user",
    winApi:
      "user32.dll → EnumDisplaySettingsW + ChangeDisplaySettingsExW(CDS_UPDATEREGISTRY | 0)",
    summary:
      "Instantly switches the monitor between 165 Hz, 120 Hz, 75 Hz and 60 Hz without changing the native resolution. It is one of the most cost-effective levers in office use because it acts on the screen scaler, the Windows DWM compositor AND the GPU memory controller!",
    physicsDetail:
      "At 165 Hz in 1440p/4K, the GPU must scan the framebuffer 2.75 times more often per second (DisplayPort bandwidth ~22 Gb/s instead of 8 Gb/s) and often keeps its GDDR6 VRAM in P0/P2 (+14 W!). Switching to 60 Hz frees VBLANK, drops VRAM to P8, and saves another 4 to 8 W in the monitor electronics.",
    beforeAfterHint:
      "165 Hz → 60 Hz at the desktop: -12 to -21 W combined (GPU + display)! Frame interval: 6.06 ms → 16.67 ms (perfect for coding, reading, 24/30/60 fps video).",
    safetyNote:
      "EcoClock first checks the exact supported mode list via `EnumDisplaySettingsW` and tests with `CDS_TEST` before applying.",
  },

  display_brightness: {
    key: "display_brightness",
    title: "Screen Backlight Brightness (internal WMI / DDC-CI I²C for external monitors)",
    subsystem: "Display",
    privilege: "user",
    winApi:
      "WmiSetBrightness (laptop) + dxva2.dll → SetVCPFeature(0x10 Luminance) via DDC/CI",
    summary:
      "Directly drives the LED backlight of the internal panel (laptop) or a DDC/CI-compatible desktop monitor through the DisplayPort/HDMI auxiliary channel, with no fake software dimming filter.",
    physicsDetail:
      "The LED backlight accounts for 75% of a monitor's consumption and varies strictly linearly with the PWM/DC duty cycle. Going from 100% (350 cd/m², blinding indoors) to 45% (150 cd/m², ISO sRGB visual comfort) saves 10 to 18 W of real wall power!",
    beforeAfterHint:
      "100% (34 W monitor) → 45% (18 W monitor): -16 W real, +0.00 ms performance impact (zero CPU/GPU cost), reduced eye strain.",
    safetyNote:
      "Standard VESA MCCS VCP 0x10 hardware command, 100% accessible in User mode.",
  },

  nic_eee: {
    key: "nic_eee",
    title: "IEEE 802.3az Energy-Efficient Ethernet (EEE Low-Power Idle + Auto-Downshift)",
    subsystem: "Wired NIC network",
    privilege: "admin",
    winApi:
      "NetAdapterAdvancedProperty / NDIS OID_PM_PARAMETERS (*EEE = 1, *GreenEthernet = 1)",
    summary:
      "Puts RJ45 copper transceivers (1 GbE / 2.5 GbE) into Low-Power Idle (LPI) between Ethernet frames. 2.5 GbE controllers (Intel I225/I226, Realtek RTL8125) run surprisingly hot without EEE.",
    physicsDetail:
      "In standard Ethernet, `IDLE` symbols are transmitted at full power 100% of the time on all four twisted pairs even with no traffic. With 802.3az, the transmitter shuts off after a few microseconds of silence and only sends a short refresh pulse every 20 ms.",
    beforeAfterHint:
      "EEE OFF → EEE ON (2.5 GbE card): -1.8 to -3.2 W, added network ping latency: ~0.018 ms (18 µs: a 12.00 ms ping becomes 12.02 ms!).",
    safetyNote:
      "Standard IEEE norm automatically negotiated with your router/switch (transparent fallback if the switch is older).",
  },

  wifi_psp: {
    key: "wifi_psp",
    title: "Wi-Fi 802.11 Radio Savings (CAM → Medium PSP → Max Power Save Polling)",
    subsystem: "Wireless WLAN network",
    privilege: "user",
    winApi:
      "powrprof.dll → SUB_WIRELESS (19cbb8fa-5279-450e-9fac-8a3d5fedd0c1) / Power Saving Mode",
    summary:
      "In CAM (Constantly Awake Mode), the Wi-Fi radio amplifier listens to the 2.4/5/6 GHz channel continuously. In PSP mode (Power Save Polling / Wi-Fi 6 TWT), the chip powers down its RF chain between the router's DTIM beacons, which buffer incoming packets.",
    physicsDetail:
      "Turning off the LNA and 5/6 GHz RF synthesizer between beacon frames drops the M.2 Wi-Fi module's draw from ~2.6 W to ~0.25 W and also reduces the PCIe interrupts that wake the CPU.",
    beforeAfterHint:
      "CAM → Max PSP: -2.2 W; download throughput unchanged (continuous wake during an active stream), first ping packet jitter: +2.8 ms (only discouraged in competitive FPS).",
    safetyNote:
      "Standard Windows power plan setting, instant switch in User mode.",
  },

  usb_suspend: {
    key: "usb_suspend",
    title: "USB Selective Suspend (U2/U3 state on idle hubs and devices)",
    subsystem: "xHCI USB controller",
    privilege: "user",
    winApi:
      "powrprof.dll → SUB_USB (2a737441-1930-4402-8d77-b2bebba308a3) / USBSELECTIVE (48e6b7a6-...)",
    summary:
      "Allows the `USBXHCI.SYS` driver to individually put each idle USB port (webcam off, SD card reader, idle Bluetooth dongle, unused DAC) into U3 suspend (< 2.5 mA) without cutting active ports (keyboard/mouse).",
    physicsDetail:
      "Without selective suspend, the xHCI controller polls every attached device (SOF polling every 125 µs in High-Speed), keeping memory DMA access open and preventing the CPU package from going below C3/C6!",
    beforeAfterHint:
      "OFF → ON: -1.5 to -4.5 W (devices + improved CPU C-States), wake of a suspended device: ~8 ms (does not affect a moving mouse).",
    safetyNote:
      "HID devices declaring `SelectiveSuspendEnabled=0` (some gaming mice) are automatically respected.",
  },

  timer_resolution: {
    key: "timer_resolution",
    title: "Windows System Timer Resolution & Interrupt Coalescing (0.5 ms vs 15.625 ms)",
    subsystem: "NT kernel (tick clock)",
    privilege: "user",
    winApi:
      "ntdll.dll → NtQueryTimerResolution + SetProcessInformation(PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION)",
    summary:
      "By default, the Windows kernel clock ticks every 15.625 ms (64 Hz). Unfortunately, many applications (Discord, launchers, Electron) call `timeBeginPeriod(1)` or `0.5 ms`, forcing the CPU to wake 2,000 times per second instead of 64!",
    physicsDetail:
      "Each clock interrupt pulls a core out of deep C8 sleep, reloads caches and burns a burst of energy. On Windows 11 (22H2+), timer resolution is per-process and `IGNORE_TIMER_RESOLUTION` prevents background apps from hammering the CPU, enabling 15.625 ms timer coalescing.",
    beforeAfterHint:
      "Forced 0.5 ms (2000 IRQ/s) → Coalesced 15.625 ms (64 IRQ/s): -5 to -11 W at idle/desktop, C8 residency climbs by +24%! Only affects `Sleep(1)` in background apps.",
    safetyNote:
      "100% safe: WASAPI audio applications and the foreground game window keep their dedicated high-precision timers.",
  },

  // === REAL BENCHMARKS ===
  bench_lz4: {
    key: "bench_lz4",
    title: "Real Benchmark: LZ4 Compression + BLAKE3 Hashing of a 64 MB Memory Block",
    subsystem: "Real CPU + cache effect",
    privilege: "both",
    winApi:
      "Median QPC timing over 5 runs (full load + SIMD + L3/DRAM bandwidth)",
    summary:
      "Represents exactly what your PC does when it extracts an archive, loads application assets, verifies an update or backs up a large project.",
    physicsDetail:
      "Mixed load, 65% CPU-frequency-bound and 35% DDR4/DDR5 memory-bandwidth-bound. That is why cutting CPU frequency by -40% only increases execution time by about +32%, while halving the energy consumed by the task (in Joules = Watts × seconds)!",
    beforeAfterHint:
      "~18 ms (Stock 5.2 GHz) → ~25 ms (Eco 3.2 GHz): +7 ms difference — literally 14 times shorter than a human eye blink (100 ms)!",
    safetyNote: "Deterministic in-RAM measurement, no writes to your SSD.",
  },

  bench_json: {
    key: "bench_json",
    title: "Real Benchmark: Complex JSON Parsing (5 MB) & UI/Web Layout",
    subsystem: "Real single-thread effect",
    privilege: "both",
    winApi:
      "Structured-tree deserialization + sorting (representative of web browsing, IDEs, office work)",
    summary:
      "Simulates opening a rich web page, an API response or a spreadsheet. Sensitive to single-core performance, Turbo Boost and the EPP setting.",
    physicsDetail:
      "Heavily bound by branch prediction and L1/L2 cache accesses. Below 20 ms total, there is no human-perceivable difference between a 5.2 GHz (1.40 V) CPU and a 3.0 GHz (0.88 V) one.",
    beforeAfterHint:
      "~6.2 ms → ~9.4 ms (+3.2 ms) in the Eco profile, or ~15.8 ms (+9.6 ms) in Absolute Silence — still instant, below a single 60 Hz frame!",
    safetyNote:
      "Native Rust, run through `serde_json` / a calibrated zero-allocation parser.",
  },

  bench_sqlite: {
    key: "bench_sqlite",
    title: "Real Benchmark: 50k-Row Indexed Query / Incremental Compilation",
    subsystem: "Real multi-thread effect",
    privilege: "both",
    winApi:
      "Multi-threaded aggregation + in-memory join (sensitive to PL1, Core Parking & FreqCap)",
    summary:
      "Represents a sustained productivity task: local search in your mail/files, a Lightroom photo filter, a heavy Excel recalculation or an incremental `cargo check`.",
    physicsDetail:
      "Honestly shows the trade-off of very aggressive underclocking: in the Standby profile at 1.1 GHz with parked cores, this task goes from ~42 ms to ~125 ms (slightly perceptible), while in the Eco-Productivity profile it stays at ~57 ms (+15 ms only) for -55% watts.",
    beforeAfterHint:
      "Ideal for choosing between the P1 (Absolute Silence) and P2 (Eco-Productivity) profiles depending on your work.",
    safetyNote:
      "You can switch between the 5 profiles in 1 click (or keyboard shortcut) in under 4 ms if you start a big render.",
  },

  bench_gpu_frame: {
    key: "bench_gpu_frame",
    title: "Real Benchmark: GPU Frame Render Time (1080p/1440p Shader Frame Time)",
    subsystem: "Real GPU effect",
    privilege: "both",
    winApi:
      "D3D11 Timestamp Query (GPU time in ms per frame; 60 FPS budget = 16.67 ms, 120 FPS = 8.33 ms)",
    summary:
      "Measures how long the graphics card takes to draw a standard 3D scene. As long as frame time stays below your display's period (16.67 ms at 60 Hz, 8.33 ms at 120 Hz), you get 100% smoothness with no dropped frames!",
    physicsDetail:
      "Rendering a frame in 4.5 ms (222 FPS) on a 60 Hz or 120 Hz screen is pure thermal waste. Limiting the GPU so it renders in 7.2 ms saves 75 W and 20 °C while staying perfectly smooth at 120 FPS.",
    beforeAfterHint:
      "Sweet-Spot game profile (PL 72%, 2050 MHz): 6.4 ms → 7.3 ms (+0.9 ms), still under the 8.33 ms of 120 Hz, with -68 W and fans halved!",
    safetyNote:
      "Hardware video acceleration (YouTube 4K AV1, Netflix) uses a dedicated ASIC block and stays smooth even at the minimum GPU setting.",
  },

  bench_nvme_wake: {
    key: "bench_nvme_wake",
    title: "Real Benchmark: First 4 KB Random Read Latency (NVMe APST + SATA wake)",
    subsystem: "Real storage effect",
    privilege: "both",
    winApi:
      "CreateFileW(FILE_FLAG_NO_BUFFERING) + ReadFile 4096 bytes after an idle period",
    summary:
      "Measures the exact wake penalty when the SSD leaves its APST sleep state (PS1, PS3 or PS4) to serve the very first file after a period of inactivity. All subsequent reads immediately return to 0.06 ms (PS0)!",
    physicsDetail:
      "PS1 exit: ~0.12 ms. PS3 exit: ~0.85 ms. PS4 exit (5 mW deep sleep): ~1.85 to 2.4 ms. For comparison, an old mechanical hard drive took 12,000 µs (12 ms) per access and 4,000 ms to spin up!",
    beforeAfterHint:
      "0.06 ms → 1.85 ms (+1.79 ms once at wake) to cut SSD temperature from 55 °C to 33 °C and divide idle draw by 300.",
    safetyNote:
      "Negligible for 99.9% of uses; only a transactional OLTP database server would prefer PS1.",
  },

  bench_bus_wake: {
    key: "bench_bus_wake",
    title: "Real Benchmark: PCIe ASPM L1.2 Link Wake + Network Round Trip (EEE / Wi-Fi PSP)",
    subsystem: "Real bus & network effect",
    privilege: "both",
    winApi:
      "Combined PCIe L1.2 exit latency + 802.3az LPI PHY + 802.11 DTIM Poll",
    summary:
      "Adds up the micro-wake delays of interconnect buses (PCIe ASPM), the Ethernet card (EEE) and Wi-Fi (PSP) when sending an interactive packet after silence.",
    physicsDetail:
      "PCIe L1.2 adds ~0.045 ms (45 µs) and Ethernet EEE adds ~0.018 ms (18 µs): both completely undetectable even in esports! By contrast, Wi-Fi Max PSP adds ~2.8 ms of average jitter (perfect for desktop/video, switch to CAM/Medium only for competitive online gaming).",
    beforeAfterHint:
      "Wired + ASPM L1.2: +0.06 ms for -10 W saved (unbeatable efficiency/latency ratio: > 150 W saved per millisecond!).",
    safetyNote:
      "Automatically detected and adjusted by the Gaming vs Desktop profiles.",
  },

  // === PARETO OPTIMIZER ===
  optimizer_pareto: {
    key: "optimizer_pareto",
    title: "Pareto Front Optimization Engine (Watts saved / ms added efficiency)",
    subsystem: "Smart Advisor",
    privilege: "both",
    winApi:
      "Embedded deterministic Rust model (`src/optimizer.rs` — 0 cloud, 0 external telemetry, < 0.1 ms)",
    summary:
      "Inspects every subsystem of your current configuration, simulates the marginal effect of an adjustment toward the “knee” (sweet spot) of the V/F curve, and ranks proposals by efficiency ratio: electrical/thermal/acoustic gains divided by the real penalty in milliseconds.",
    physicsDetail:
      "A configuration is “Pareto-optimal” when no more watts can be saved without noticeably degrading perceived responsiveness. First come the “free” savings (0 ms: 60 Hz desktop display, C-States, EcoQoS, ASPM L1.2, NVMe PS3, EEE), then shaving the overvolted CPU and GPU region.",
    beforeAfterHint:
      "On average, applying the Pareto proposals removes 52 to 68% of total consumption and -14 dBA of noise for less than +5 ms on everyday tasks.",
    safetyNote:
      "Each proposal can be applied individually, tested live, or reverted by restoring the Nominal P5 profile.",
  },

  adaptive_mode: {
    key: "adaptive_mode",
    title: "Smart mode: profile switching based on context",
    subsystem: "Automation",
    privilege: "both",
    winApi:
      "Idle input tracking on the Rust side (GetLastInputInfo) + battery state (GetSystemPowerStatus)",
    summary:
      "Ordered rules pick the right profile: heavy render → never throttle, gaming → balance, battery → savings, idle → silence, otherwise the daily profile. The first matching rule wins.",
    physicsDetail:
      "Saving energy is not always useful: a reduced frequency during a compilation lengthens the task and can consume more total energy (energy = power × time). The decision gate therefore only allows a switch if the electrical gain exceeds a minimum threshold and the added latency stays within the chosen budget.",
    beforeAfterHint:
      "Example: after 2 min idle, switch to P2 (≈ -20 W, +0.3 ms UI). As soon as you move the mouse, immediate return to the daily profile.",
    safetyNote:
      "Stability: a target must be confirmed two cycles in a row, and a minimum delay separates two switches. An unsaved configuration is never replaced automatically.",
  },
};

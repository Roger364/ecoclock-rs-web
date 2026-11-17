import { RustSourceFile } from "../types/hardware";

/** Modules additionnels du crate : moteur adaptatif Windows natif + CI Windows multi-features. */
export const RUST_EXTRA_FILES: RustSourceFile[] = [
  {
    path: "src/platform/adaptive.rs",
    layer: "Plateforme Win32",
    summary:
      "Mode intelligent natif : lecture GetLastInputInfo (inactivité), GetSystemPowerStatus (batterie), GetSystemTimes (charge CPU) & hystérésis.",
    content: `use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default)]
pub struct HostContext {
    pub idle_seconds: u32,
    pub on_battery: bool,
    pub cpu_busy_pct: u8,
    pub gpu_temp_c: f32,
}

#[derive(Debug, Default)]
pub struct CpuLoadSampler {
    prev_idle: u64,
    prev_total: u64,
}

impl CpuLoadSampler {
    /// Mesure la charge CPU globale réelle (%) par delta de GetSystemTimes (coût < 2 µs)
    pub fn sample_busy_pct(&mut self) -> u8 {
        #[cfg(windows)]
        {
            use windows::Win32::{Foundation::FILETIME, System::Threading::GetSystemTimes};
            let ft_u64 = |f: FILETIME| (u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime);
            let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
            // SAFETY: trois pointeurs locaux valides passés à GetSystemTimes.
            if unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.is_ok() {
                let i = ft_u64(idle);
                let total = ft_u64(kernel).saturating_add(ft_u64(user));
                // Premier échantillon d'amorçage : mémorise les compteurs sans renvoyer la moyenne depuis le boot
                if self.prev_total == 0 {
                    self.prev_idle = i;
                    self.prev_total = total;
                    return 0;
                }
                let d_idle = i.saturating_sub(self.prev_idle);
                let d_total = total.saturating_sub(self.prev_total);
                self.prev_idle = i;
                self.prev_total = total;
                if d_total > 0 {
                    let busy = d_total.saturating_sub(d_idle).saturating_mul(100) / d_total;
                    return u8::try_from(busy.min(100)).unwrap_or(100);
                }
            }
        }
        0
    }
}

/// Lit le nombre de secondes écoulées depuis la dernière entrée clavier/souris (GetLastInputInfo)
pub fn read_user_idle_seconds() -> u32 {
    #[cfg(windows)]
    {
        use std::mem::size_of;
        use windows::Win32::{
            System::SystemInformation::GetTickCount,
            UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        };
        let mut lii = LASTINPUTINFO {
            cbSize: u32::try_from(size_of::<LASTINPUTINFO>()).unwrap_or(8),
            dwTime: 0,
        };
        // SAFETY: cbSize est initialisé à la taille exacte de LASTINPUTINFO ; wrapping_sub gère le cycle 49,7 j.
        if unsafe { GetLastInputInfo(&mut lii) }.as_bool() {
            let now = unsafe { GetTickCount() };
            return (now.wrapping_sub(lii.dwTime) / 1000).min(86_400);
        }
    }
    0
}

/// Détecte si le PC fonctionne actuellement sur batterie (ACLineStatus == 0)
pub fn is_running_on_battery() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut sps = SYSTEM_POWER_STATUS::default();
        // SAFETY: structure locale valide remplie par GetSystemPowerStatus.
        if unsafe { GetSystemPowerStatus(&mut sps) }.is_ok() {
            return sps.ACLineStatus == 0;
        }
    }
    false
}

/// Règle pure : choisit le slot de profil (1..=5) selon le contexte, avec hystérésis thermique −5 °C
pub fn decide_target_slot(ctx: HostContext, thermal_latched: &mut bool, idle_threshold_s: u32) -> usize {
    *thermal_latched = if *thermal_latched {
        ctx.gpu_temp_c >= 78.0
    } else {
        ctx.gpu_temp_c >= 83.0
    };

    if *thermal_latched {
        return 2; // Urgence thermique : Silence / Refroidissement immédiat
    }
    if ctx.cpu_busy_pct >= 72 {
        return 5; // Compilation / rendu : ne jamais brider (race-to-idle)
    }
    if ctx.cpu_busy_pct >= 38 {
        return 3; // Jeu / création : Sweet-Spot frais
    }
    if ctx.idle_seconds >= idle_threshold_s {
        return 2; // Inactivité confirmée : Silence Absolu
    }
    if ctx.on_battery {
        return 1; // Batterie : sobriété Pareto
    }
    1 // Activité courante : Éco-Productivité
}

/// Contrôleur anti-oscillation (confirmation sur 2 cycles + délai minimal entre bascules éco)
pub struct AdaptiveGovernor {
    pending: Option<(usize, u8)>,
    last_switch: Option<Instant>,
    pub thermal_latched: bool,
    pub dwell: Duration,
    pub idle_threshold_s: u32,
}

impl Default for AdaptiveGovernor {
    fn default() -> Self {
        Self {
            pending: None,
            last_switch: None,
            thermal_latched: false,
            dwell: Duration::from_secs(60),
            idle_threshold_s: 120,
        }
    }
}

impl AdaptiveGovernor {
    pub fn poll(&mut self, current_slot: usize, ctx: HostContext, now: Instant) -> Option<usize> {
        let target = decide_target_slot(ctx, &mut self.thermal_latched, self.idle_threshold_s);
        if target == current_slot {
            self.pending = None;
            return None;
        }
        // Urgence thermique ou remontée en performance (P5/P3 sur charge) : réactivité immédiate
        let urgent = self.thermal_latched || target == 5 || target == 3;
        if !urgent {
            let count = match self.pending {
                Some((s, c)) if s == target => c.saturating_add(1),
                _ => 1,
            };
            self.pending = Some((target, count));
            if count < 2 {
                return None;
            }
            if let Some(prev) = self.last_switch {
                if now.duration_since(prev) < self.dwell {
                    return None;
                }
            }
        }
        self.pending = None;
        self.last_switch = Some(now);
        Some(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heavy_load_is_never_throttled_unless_overheating() {
        let mut latch = false;
        let slot = decide_target_slot(
            HostContext { idle_seconds: 500, on_battery: true, cpu_busy_pct: 85, gpu_temp_c: 65.0 },
            &mut latch,
            120,
        );
        assert_eq!(slot, 5);

        let hot = decide_target_slot(
            HostContext { idle_seconds: 0, on_battery: false, cpu_busy_pct: 85, gpu_temp_c: 84.0 },
            &mut latch,
            120,
        );
        assert_eq!(hot, 2);
        assert!(latch);
    }

    #[test]
    fn eco_switch_requires_two_cycles_and_respects_dwell() {
        let mut gov = AdaptiveGovernor::default();
        let t0 = Instant::now();
        let idle_ctx = HostContext { idle_seconds: 180, on_battery: false, cpu_busy_pct: 4, gpu_temp_c: 38.0 };

        assert_eq!(gov.poll(1, idle_ctx, t0), None); // cycle 1 : confirmation
        assert_eq!(gov.poll(1, idle_ctx, t0 + Duration::from_secs(5)), Some(2)); // cycle 2 : bascule
        // Une nouvelle bascule éco avant 60 s est bloquée par dwell
        let _ = gov.poll(2, HostContext { idle_seconds: 0, cpu_busy_pct: 5, ..idle_ctx }, t0 + Duration::from_secs(10));
        assert_eq!(
            gov.poll(2, HostContext { idle_seconds: 0, cpu_busy_pct: 5, ..idle_ctx }, t0 + Duration::from_secs(15)),
            None
        );
    }
}
`,
  },
  {
    path: ".github/workflows/ci.yml",
    layer: "Configuration",
    summary:
      "CI GitHub Windows : formatage, clippy strict (-D warnings), tests unitaires (avec et sans feature nvml) et build release.",
    content: `name: ci
on:
  push:
  pull_request:
jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - name: Check formatting
        run: cargo fmt --all -- --check
      - name: Clippy (default features + NVML)
        run: cargo clippy --all-targets -- -D warnings
      - name: Clippy (no NVML — AMD/Intel iGPU build)
        run: cargo clippy --no-default-features --all-targets -- -D warnings
      - name: Unit tests
        run: cargo test --all-targets
      - name: Release build (size-optimized)
        run: cargo build --release
`,
  },
];
